import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { z } from 'zod';
import { TIMEFRAMES, type LevelsRequest, type LoginResponse } from '@paradise/contract';
import type { Config } from './config.ts';
import type { UserStore } from './auth/db.ts';
import { requireAdmin, requireAuth, signToken, type AuthedRequest } from './auth/tokens.ts';
import { InstrumentError } from './data/instruments.ts';
import { MarketDataError, type Market } from './data/market.ts';
import { computeLevels, RequestError } from './levels.ts';

export interface AppDeps { config: Config; store: UserStore; market: Market; now?: () => number }

const levelsSchema = z.object({
  symbol: z.string().trim().min(1).max(24),
  timeframes: z.array(z.enum(TIMEFRAMES as [string, ...string[]])).min(1).max(6),
  displacement: z.union([z.literal(0), z.literal(1)]).default(1),
  asOf: z.string().datetime({ offset: true }).nullish(),
  developing: z.boolean().default(false),
  profile: z.boolean().default(false),
});
const loginSchema = z.object({ username: z.string().trim().min(1).max(50), password: z.string().min(1).max(200) });
const newUserSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,50}$/, '3–50 chars: letters, digits, . _ -'),
  password: z.string().min(8).max(200),
  isAdmin: z.boolean().default(false),
});
const patchUserSchema = z.object({ password: z.string().min(8).max(200).optional(), isAdmin: z.boolean().optional() }).refine((p) => Object.keys(p).length > 0, 'nothing to update');

const wrap = (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req as AuthedRequest, res).catch(next);

export function createApp({ config, store, market, now }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || config.allowedOrigins.includes(origin)),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }));
  app.use(express.json({ limit: '32kb' }));
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
