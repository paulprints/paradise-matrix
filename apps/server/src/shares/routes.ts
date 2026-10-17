/** REST for shared charts. Live editing happens over the WebSocket hub (live.ts). */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { DRAWING_LIMITS, LINK_ACCESS, SHARE_LIMITS, type Drawing, type LinkAccess, type ShareConfig, type ShareDenied, type ShareOpenResponse } from '@paradise/contract';
import type { UserStore } from '../auth/db.ts';
import type { AuthedRequest } from '../auth/tokens.ts';
import { resolveInstrument } from '../data/instruments.ts';
import { drawingSchema, shareConfigSchema, titleSchema } from '../schemas.ts';
import type { LiveHub } from './live.ts';
import { newDrawingId, type SharesStore } from './store.ts';

const linkAccess = z.enum(LINK_ACCESS as [LinkAccess, ...LinkAccess[]]);
const createSchema = z.object({
  title: titleSchema, config: shareConfigSchema, linkAccess: linkAccess.default('viewer'),
  drawings: z.array(drawingSchema).max(DRAWING_LIMITS.perSymbol).default([]),
});
const patchSchema = z.object({ title: titleSchema.optional(), locked: z.boolean().optional(), linkAccess: linkAccess.optional(), config: shareConfigSchema.optional() })
  .refine((p) => Object.keys(p).length > 0, 'nothing to update');
const memberSchema = z.object({ role: z.enum(['viewer', 'editor', 'removed']) });

const wrap = (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req as AuthedRequest, res).catch(next);
const NOT_FOUND = 'This shared chart doesn’t exist, or it was deleted.';

export function shareRoutes(deps: { store: UserStore; shares: SharesStore; live: LiveHub | null }) {
  const { store, shares, live } = deps;
  const r = Router();

  /** The owner of share :id, or answer 404 (non-owners never learn more). */
  const owned = async (req: AuthedRequest, res: Response) => {
    const a = await shares.access(req.params.id!, req.user!.id);
    if (!a || a.role !== 'owner') { res.status(404).json({ error: 'Not found' }); return null; }
    return a;
  };

  r.post('/', wrap(async (req, res) => {
    const body = createSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message ?? 'Invalid share', details: body.error.flatten() });
    if ((await shares.countByOwner(req.user!.id)) >= SHARE_LIMITS.perOwner) return res.status(400).json({ error: `You can keep up to ${SHARE_LIMITS.perOwner} shared charts. Delete some first.` });
    const config: ShareConfig = { ...(body.data.config as ShareConfig), symbol: resolveInstrument(body.data.config.symbol).symbol };
    res.status(201).json({ share: await shares.create(req.user!.id, body.data.title, config, body.data.drawings as Drawing[], body.data.linkAccess) });
  }));

  r.get('/', wrap(async (req, res) => res.json({ shares: await shares.listByOwner(req.user!.id) })));

  /** Open a shared chart. First visit adds you to its people list (as the link allows). */
  r.get('/:id', wrap(async (req, res) => {
    const a = await shares.join(req.params.id!, req.user!.id);
    if (!a) return res.status(404).json({ error: NOT_FOUND });
    if (a.added) void live?.notifyMembers(a.share.id);
    if (a.status !== 'ok' || !a.role) {
      const details: ShareDenied = { access: a.status === 'pending' ? 'pending' : 'removed', title: a.share.title, owner: a.share.owner.username };
      return res.status(403).json({
        error: details.access === 'pending' ? `Waiting for ${details.owner} to let you in.` : `${details.owner} removed your access to this chart.`,
        details,
      });
    }
    const out: ShareOpenResponse = { share: a.share, role: a.role, drawings: await shares.drawings(a.share.id) };
    res.json(out);
  }));

  r.patch('/:id', wrap(async (req, res) => {
    const a = await owned(req, res);
    if (!a) return;
    const body = patchSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message ?? 'Invalid update' });
    // A share is always about one instrument: a saved starting view keeps the symbol.
    const patch = { ...body.data, config: body.data.config ? { ...(body.data.config as ShareConfig), symbol: a.share.config.symbol } : undefined };
    const share = await shares.update(a.share.id, patch);
    await live?.refresh(a.share.id);
    res.json({ share });
  }));

  r.delete('/:id', wrap(async (req, res) => {
    const a = await owned(req, res);
    if (!a) return;
    live?.closeShare(a.share.id);
    await shares.remove(a.share.id);
    res.status(204).end();
  }));

  /** Owner: everyone who has opened the link, with their access and whether they're here now. */
  r.get('/:id/members', wrap(async (req, res) => {
    const a = await owned(req, res);
    if (!a) return;
    res.json({ members: await shares.members(a.share.id, live?.onlineUsers(a.share.id)) });
  }));

  /** Owner: let someone view or edit, or remove them. Open tabs follow at once. */
  r.patch('/:id/members/:userId', wrap(async (req, res) => {
    const a = await owned(req, res);
    if (!a) return;
    const body = memberSchema.safeParse(req.body);
    const userId = Number(req.params.userId);
    if (!body.success || !Number.isInteger(userId)) return res.status(400).json({ error: 'Choose viewer, editor or removed' });
    if (!(await shares.setMember(a.share.id, userId, body.data.role))) return res.status(404).json({ error: 'That person hasn’t opened this chart' });
    await live?.refresh(a.share.id);
    res.json({ members: await shares.members(a.share.id, live?.onlineUsers(a.share.id)) });
  }));

  /** Copy the shared drawings into your own drawings for that instrument (new ids, appended). */
  r.post('/:id/copy', wrap(async (req, res) => {
    const a = await shares.access(req.params.id!, req.user!.id);
    if (!a || a.status !== 'ok') return res.status(404).json({ error: 'Not found' });
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
