import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { z } from 'zod';
import { DRAWING_COLORS, DRAWING_LIMITS, TIMEFRAMES, type ChartRequest, type DrawingsResponse, type LevelsRequest, type LoginResponse } from '@paradise/contract';
import type { Config } from './config.ts';
import type { UserStore } from './auth/db.ts';
import { requireAdmin, requireAuth, signToken, type AuthedRequest } from './auth/tokens.ts';
import { computeChart } from './chart.ts';
import type { LiveHub } from './shares/live.ts';
import { shareRoutes } from './shares/routes.ts';
import type { SharesStore } from './shares/store.ts';
import { drawingSchema } from './schemas.ts';
import { InstrumentError, resolveInstrument } from './data/instruments.ts';
import { MarketDataError, type Market } from './data/market.ts';
import { computeLevels, RequestError } from './levels.ts';

export interface AppDeps { config: Config; store: UserStore; market: Market; shares?: SharesStore; live?: LiveHub | null; now?: () => number }

const levelsSchema = z.object({
  symbol: z.string().trim().min(1).max(24),
  timeframes: z.array(z.enum(TIMEFRAMES as [string, ...string[]])).min(1).max(6),
  displacement: z.union([z.literal(0), z.literal(1)]).default(1),
  asOf: z.string().datetime({ offset: true }).nullish(),
  developing: z.boolean().default(false),
  profile: z.boolean().default(false),
});
const tf = z.enum(TIMEFRAMES as [string, ...string[]]);
const chartSchema = z.object({
  symbol: z.string().trim().min(1).max(24),
  chartTf: tf,
  overlays: z.array(tf).max(8).default([]),
  displacement: z.union([z.literal(0), z.literal(1)]).default(1),
  developing: z.boolean().default(false),
  profile: z.boolean().default(false),
  bars: z.number().int().min(50).max(5000).optional(),
  since: z.number().int().min(0).optional(),
});
const drawingsSchema = z.object({ symbol: z.string().trim().min(1).max(24), drawings: z.array(drawingSchema).max(DRAWING_LIMITS.perSymbol) });
const loginSchema = z.object({ username: z.string().trim().min(1).max(50), password: z.string().min(1).max(200) });
const newUserSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,50}$/, '3–50 chars: letters, digits, . _ -'),
  password: z.string().min(8).max(200),
  isAdmin: z.boolean().default(false),
});
const patchUserSchema = z.object({ password: z.string().min(8).max(200).optional(), isAdmin: z.boolean().optional() }).refine((p) => Object.keys(p).length > 0, 'nothing to update');

const wrap = (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req as AuthedRequest, res).catch(next);

export function createApp({ config, store, market, shares, live = null, now }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || config.allowedOrigins.includes(origin)),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }));
  app.use(express.json({ limit: '512kb' })); // drawings with freehand strokes can be a few hundred KB
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: 'draft-7', legacyHeaders: false }));

  const auth = requireAuth(store, config.jwtSecret);
  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, skipSuccessfulRequests: true, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many attempts — try again in 15 minutes' } });
  const clientIp = (req: Request) => (req.headers['cf-connecting-ip'] as string | undefined) ?? req.ip ?? null;

  app.get('/health', (_req, res) => { res.json({ status: 'ok', providers: market.providers }); });

  app.post('/api/auth/login', loginLimiter, wrap(async (req, res) => {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Username and password are required' });
    const user = await store.verify(body.data.username, body.data.password);
    await store.recordLogin({ username: body.data.username.toLowerCase(), userId: user?.id, ip: clientIp(req), userAgent: req.headers['user-agent'] ?? null, ok: !!user, error: user ? null : 'invalid credentials' });
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });
    const pub = { id: user.id, username: user.username, isAdmin: user.is_admin === 1 };
    const out: LoginResponse = { token: signToken(pub, config.jwtSecret, config.jwtExpiresIn), user: pub };
    res.json(out);
  }));

  app.get('/api/auth/me', auth, (req: AuthedRequest, res) => { res.json({ user: req.user }); });

  app.post('/api/levels', auth, wrap(async (req, res) => {
    const body = levelsSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Invalid request', details: body.error.flatten() });
    res.json(await computeLevels(body.data as LevelsRequest, { market, now }));
  }));

  app.post('/api/chart', auth, wrap(async (req, res) => {
    const body = chartSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Invalid request', details: body.error.flatten() });
    res.json(await computeChart(body.data as ChartRequest, { market, now }));
  }));

  // Drawings are stored per member and per resolved instrument (NQ and /NQ share drawings).
  app.get('/api/drawings', auth, wrap(async (req, res) => {
    const symbol = resolveInstrument(String(req.query.symbol ?? '')).symbol;
    const row = await store.getDrawings(req.user!.id, symbol);
    const out: DrawingsResponse = { symbol, drawings: row ? JSON.parse(row.data) : [], updatedAt: row?.updatedAt ?? null };
    res.json(out);
  }));
  app.put('/api/drawings', auth, wrap(async (req, res) => {
    const body = drawingsSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message ?? 'Invalid drawings', details: body.error.flatten() });
    const symbol = resolveInstrument(body.data.symbol).symbol;
    const updatedAt = await store.putDrawings(req.user!.id, symbol, JSON.stringify(body.data.drawings));
    const out: DrawingsResponse = { symbol, drawings: body.data.drawings as DrawingsResponse['drawings'], updatedAt };
    res.json(out);
  }));

  if (shares) app.use('/api/shares', auth, shareRoutes({ store, shares, live }));

  const admin = express.Router();
  admin.use(auth, requireAdmin);
  admin.get('/users', wrap(async (_req, res) => res.json({ users: await store.list() })));
  admin.post('/users', wrap(async (req, res) => {
    const body = newUserSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message ?? 'Invalid user' });
    if (await store.byUsername(body.data.username)) return res.status(409).json({ error: 'Username already exists' });
    res.status(201).json({ user: await store.create(body.data.username, body.data.password, body.data.isAdmin) });
  }));
  admin.patch('/users/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    const body = patchUserSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message ?? 'Invalid update' });
    if (body.data.isAdmin === false && id === req.user!.id) return res.status(400).json({ error: 'You cannot remove your own admin access' });
    const u = await store.update(id, body.data);
    return u ? res.json({ user: u }) : res.status(404).json({ error: 'No such user' });
  }));
  admin.delete('/users/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user!.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    return (await store.remove(id)) ? res.status(204).end() : res.status(404).json({ error: 'No such user' });
  }));
  admin.get('/login-history', wrap(async (req, res) => {
    const username = typeof req.query.username === 'string' ? req.query.username : undefined;
    res.json({ entries: await store.loginHistory(username, Number(req.query.limit ?? 100) || 100) });
  }));
  app.use('/api/admin', admin);

  app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof RequestError || err instanceof InstrumentError) return void res.status(400).json({ error: err.message });
    if (err instanceof MarketDataError) return void res.status(503).json({ error: 'Market data unavailable', details: err.attempts });
    if ((err as any)?.type === 'entity.parse.failed') return void res.status(400).json({ error: 'Malformed JSON' });
    console.error('[server] unhandled', err);
    res.status(500).json({ error: config.nodeEnv === 'production' ? 'Internal error' : String((err as Error)?.message ?? err) });
  });
  return app;
}
