/** REST for shared charts. Live editing happens over the WebSocket hub (live.ts). */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { DRAWING_LIMITS, SHARE_LIMITS, type Drawing, type ShareConfig, type ShareOpenResponse } from '@paradise/contract';
import type { UserStore } from '../auth/db.ts';
import type { AuthedRequest } from '../auth/tokens.ts';
import { resolveInstrument } from '../data/instruments.ts';
import { drawingSchema, shareConfigSchema, titleSchema } from '../schemas.ts';
import type { LiveHub } from './live.ts';
import { newDrawingId, type SharesStore } from './store.ts';

const createSchema = z.object({ title: titleSchema, config: shareConfigSchema, drawings: z.array(drawingSchema).max(DRAWING_LIMITS.perSymbol).default([]) });
const patchSchema = z.object({ title: titleSchema.optional(), locked: z.boolean().optional(), rotate: z.enum(['view', 'edit']).optional(), config: shareConfigSchema.optional() })
  .refine((p) => Object.keys(p).length > 0, 'nothing to update');

const wrap = (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req as AuthedRequest, res).catch(next);
const keyOf = (req: Request) => (typeof req.query.k === 'string' ? req.query.k : null);

export function shareRoutes(deps: { store: UserStore; shares: SharesStore; live: LiveHub | null }) {
  const { store, shares, live } = deps;
  const r = Router();

  r.post('/', wrap(async (req, res) => {
    const body = createSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message ?? 'Invalid share', details: body.error.flatten() });
    if ((await shares.countByOwner(req.user!.id)) >= SHARE_LIMITS.perOwner) return res.status(400).json({ error: `You can keep up to ${SHARE_LIMITS.perOwner} shared charts. Delete some first.` });
    const config: ShareConfig = { ...(body.data.config as ShareConfig), symbol: resolveInstrument(body.data.config.symbol).symbol };
    res.status(201).json({ share: await shares.create(req.user!.id, body.data.title, config, body.data.drawings as Drawing[]) });
  }));

  r.get('/', wrap(async (req, res) => res.json({ shares: await shares.listByOwner(req.user!.id) })));

  r.get('/:id', wrap(async (req, res) => {
    const a = await shares.access(req.params.id!, req.user!.id, keyOf(req));
    if (!a) return res.status(404).json({ error: 'This shared chart doesn’t exist, or the link was revoked.' });
    const out: ShareOpenResponse = { share: a.share, role: a.role, drawings: await shares.drawings(a.share.id) };
    res.json(out);
  }));

  r.patch('/:id', wrap(async (req, res) => {
    const a = await shares.access(req.params.id!, req.user!.id, null);
    if (!a || a.role !== 'owner') return res.status(404).json({ error: 'Not found' });
    const body = patchSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message ?? 'Invalid update' });
    const patch = { ...body.data, config: body.data.config ? { ...(body.data.config as ShareConfig), symbol: a.share.config.symbol } : undefined };
    const share = await shares.update(a.share.id, patch);
    await live?.refresh(a.share.id);
    res.json({ share });
  }));

  r.delete('/:id', wrap(async (req, res) => {
    const a = await shares.access(req.params.id!, req.user!.id, null);
    if (!a || a.role !== 'owner') return res.status(404).json({ error: 'Not found' });
    live?.closeShare(a.share.id);
    await shares.remove(a.share.id);
    res.status(204).end();
  }));

  /** Copy the shared drawings into your own drawings for that instrument (new ids, appended). */
  r.post('/:id/copy', wrap(async (req, res) => {
    const a = await shares.access(req.params.id!, req.user!.id, keyOf(req));
    if (!a) return res.status(404).json({ error: 'Not found' });
    const symbol = a.share.config.symbol;
    const mine: Drawing[] = JSON.parse((await store.getDrawings(req.user!.id, symbol))?.data ?? '[]');
    const room = Math.max(0, DRAWING_LIMITS.perSymbol - mine.length);
    const all = await shares.drawings(a.share.id);
    const theirs = all.slice(0, room).map(({ v: _v, n: _n, ...d }) => ({ ...d, id: newDrawingId() }) as Drawing);
    if (theirs.length) await store.putDrawings(req.user!.id, symbol, JSON.stringify([...mine, ...theirs]));
    res.json({ copied: theirs.length, skipped: all.length - theirs.length, symbol });
  }));

  return r;
}
