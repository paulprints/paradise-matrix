import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Drawing } from '@paradise/contract';
import { DRAWING_LIMITS, SHARE_LIMITS } from '@paradise/contract';
import { staticProvider } from '../src/data/providers.ts';
import { wins } from '../src/shares/merge.ts';
import { SHARE_CONFIG as CONFIG, startServer } from './helpers.ts';
const line = (id: string, p = 700): Drawing => ({ id, kind: 'hline', color: 'ink', p });

let s: Awaited<ReturnType<typeof startServer>>;
let tokA: string, tokB: string, aliceId: number, bobId: number;
beforeEach(async () => {
  s = await startServer([staticProvider('none', {})], () => Date.now() / 1000);
  aliceId = (await s.store.create('alice', 'password-aaa')).id;
  bobId = (await s.store.create('bob', 'password-bbb')).id;
  tokA = (await s.call('POST', '/api/auth/login', { username: 'alice', password: 'password-aaa' })).body.token;
  tokB = (await s.call('POST', '/api/auth/login', { username: 'bob', password: 'password-bbb' })).body.token;
});
afterEach(async () => { await s.close(); });

describe('merge rule', () => {
  it('higher version wins; equal versions break ties by lower nonce; anything beats nothing', () => {
    expect(wins({ v: 2, n: 9 }, { v: 1, n: 0 })).toBe(true);
    expect(wins({ v: 1, n: 0 }, { v: 2, n: 9 })).toBe(false);
    expect(wins({ v: 3, n: 4 }, { v: 3, n: 5 })).toBe(true);
    expect(wins({ v: 3, n: 5 }, { v: 3, n: 4 })).toBe(false);
    expect(wins({ v: 3, n: 5 }, { v: 3, n: 5 })).toBe(false); // an exact echo is not a change
    expect(wins({ v: 1, n: 0 }, null)).toBe(true);
  });

  it('converges regardless of delivery order', () => {
    const states = [{ v: 2, n: 50 }, { v: 2, n: 10 }, { v: 1, n: 0 }, { v: 3, n: 99 }, { v: 3, n: 7 }];
    const fold = (xs: typeof states) => xs.reduce<(typeof states)[number] | null>((cur, x) => (wins(x, cur) ? x : cur), null);
    const perms = (xs: typeof states): (typeof states)[] => xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
    for (const p of perms(states)) expect(fold(p)).toEqual({ v: 3, n: 7 });
  });
});

describe('shares store', () => {
  it('applies ops, keeps tombstones, rejects stale edits with the stored state', async () => {
    const share = await s.shares.create(aliceId, 'T', CONFIG, [line('a')]);
    const [a] = await s.shares.drawings(share.id);
    expect(a).toMatchObject({ id: 'a', v: 1 });

    const edit = await s.shares.apply(share.id, bobId, [{ id: 'a', v: 2, n: 5, d: line('a', 701) }]);
    expect(edit.accepted).toHaveLength(1);
    const stale = await s.shares.apply(share.id, aliceId, [{ id: 'a', v: 2, n: 6, d: line('a', 999) }]);
    expect(stale.rejected).toEqual([{ id: 'a', v: 2, n: 5, d: line('a', 701) }]);
    expect(stale.reason).toMatch(/newer/);

    await s.shares.apply(share.id, bobId, [{ id: 'a', v: 3, n: 1, del: true }]);
    expect(await s.shares.drawings(share.id)).toEqual([]);
    // A late copy of the old version can't resurrect it.
    const zombie = await s.shares.apply(share.id, aliceId, [{ id: 'a', v: 2, n: 0, d: line('a') }]);
    expect(zombie.rejected[0]).toMatchObject({ id: 'a', v: 3, del: true });
    expect(await s.shares.current(share.id, ['a', 'nope'])).toEqual([{ id: 'a', v: 3, n: 1, del: true }, { id: 'nope', v: 0, n: 0, del: true }]);
  });

  it('serializes concurrent applies: storage always holds the winning stamp', async () => {
    const share = await s.shares.create(aliceId, 'Race', CONFIG, [line('a')]);
    // Fire many competing edits at once, in a shuffled order; the stored state must be the max stamp.
    const ops = Array.from({ length: 40 }, (_, i) => ({ id: 'a', v: 2 + (i % 7), n: (i * 7919) % 1000, d: line('a', 700 + i) }));
    const shuffled = [...ops].sort(() => Math.random() - 0.5);
    const results = await Promise.all(shuffled.map((op) => s.shares.apply(share.id, bobId, [op])));
    const best = ops.reduce((w, o) => (wins(o, w) ? o : w));
    const [stored] = await s.shares.drawings(share.id);
    expect(stored).toMatchObject({ v: best.v, n: best.n, p: (best.d as { p: number }).p });
    // Every accepted op beat whatever was stored before it, so the last accepted one is the winner.
    const accepted = results.flatMap((r) => r.accepted);
    expect(accepted.at(-1)).toEqual(best);
  });

  it('caps live drawings per chart; deleting frees room', async () => {
    const many = Array.from({ length: DRAWING_LIMITS.perSymbol }, (_, i) => line(`d${i}`));
    const share = await s.shares.create(aliceId, 'Full', CONFIG, many);
    const over = await s.shares.apply(share.id, aliceId, [{ id: 'extra', v: 1, n: 1, d: line('extra') }]);
    expect(over.rejected).toHaveLength(1);
    expect(over.reason).toMatch(/500/);
    await s.shares.apply(share.id, aliceId, [{ id: 'd0', v: 2, n: 1, del: true }, { id: 'extra', v: 1, n: 1, d: line('extra') }]);
    expect((await s.shares.drawings(share.id)).length).toBe(DRAWING_LIMITS.perSymbol);
  });

  it('upgrades a database from the two-link version: existing shares open to viewers', async () => {
    const { UserStore } = await import('../src/auth/db.ts');
    const { SharesStore } = await import('../src/shares/store.ts');
    const users = await UserStore.open(':memory:');
    const owner = await users.create('olduser', 'password-old');
    await users.db.exec(`CREATE TABLE shared_charts (id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, title TEXT NOT NULL, config TEXT NOT NULL,
      view_key TEXT NOT NULL, edit_key TEXT NOT NULL, locked INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await users.db.run(`INSERT INTO shared_charts (id, owner_id, title, config, view_key, edit_key) VALUES ('Legacy0001', ?, 'Old', ?, 'v', 'e')`, owner.id, JSON.stringify(CONFIG));
    const upgraded = await SharesStore.open(users.db);
    expect(await upgraded.get('Legacy0001')).toMatchObject({ title: 'Old', linkAccess: 'viewer' });
    const fresh = await upgraded.create(owner.id, 'New', CONFIG, []);
    expect(fresh.linkAccess).toBe('viewer');
    await users.close();
  });

  it('deleting the owner deletes their shares and drawings', async () => {
    const share = await s.shares.create(bobId, 'Bye', CONFIG, [line('a')]);
    await s.store.remove(bobId);
    expect(await s.shares.get(share.id)).toBeNull();
    expect(await s.shares.drawings(share.id)).toEqual([]);
  });
});

describe('share REST', () => {
  const create = async (body: Record<string, unknown> = {}) =>
    (await s.call('POST', '/api/shares', { title: 'Opening drive', config: CONFIG, drawings: [line('a'), line('b', 705)], ...body }, tokA));
  const setRole = (id: string, userId: number, role: string) => s.call('PATCH', `/api/shares/${id}/members/${userId}`, { role }, tokA);

  it('creates a share from the current view (symbol resolved); one link, viewers by default', async () => {
    const res = await create();
    expect(res.status).toBe(201);
    const share = res.body.share;
    expect(share).toMatchObject({ title: 'Opening drive', owner: { username: 'alice' }, locked: false, linkAccess: 'viewer', config: { ...CONFIG, symbol: 'QQQ' } });
    expect(share.id).toMatch(/^[0-9A-Za-z]{10}$/);
    expect(share).not.toHaveProperty('viewKey');

    const own = await s.call('GET', `/api/shares/${share.id}`, undefined, tokA);
    expect(own.body.role).toBe('owner');
    expect(own.body.drawings.map((d: Drawing) => d.id)).toEqual(['a', 'b']);

    // Bob opens the link: he's added to the people list as a viewer.
    expect((await s.call('GET', `/api/shares/${share.id}`, undefined, tokB)).body.role).toBe('viewer');
    const people = (await s.call('GET', `/api/shares/${share.id}/members`, undefined, tokA)).body.members;
    expect(people).toMatchObject([{ userId: bobId, username: 'bob', role: 'viewer', online: false }]);
  });

  it('the owner chooses what each person can do; removed people can’t come back through the link', async () => {
    const { id } = (await create()).body.share;
    await s.call('GET', `/api/shares/${id}`, undefined, tokB);
    expect((await setRole(id, bobId, 'editor')).body.members[0].role).toBe('editor');
    expect((await s.call('GET', `/api/shares/${id}`, undefined, tokB)).body.role).toBe('editor');
    await setRole(id, bobId, 'removed');
    const denied = await s.call('GET', `/api/shares/${id}`, undefined, tokB);
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ error: 'alice removed your access to this chart.', details: { access: 'removed', title: 'Opening drive', owner: 'alice' } });
    expect((await s.call('POST', `/api/shares/${id}/copy`, undefined, tokB)).status).toBe(404);
    await setRole(id, bobId, 'viewer');
    expect((await s.call('GET', `/api/shares/${id}`, undefined, tokB)).status).toBe(200);
  });

  it('with approval required, newcomers wait until the owner lets them in', async () => {
    const { id } = (await create({ linkAccess: 'approval' })).body.share;
    const wait = await s.call('GET', `/api/shares/${id}`, undefined, tokB);
    expect(wait.status).toBe(403);
    expect(wait.body).toMatchObject({ error: 'Waiting for alice to let you in.', details: { access: 'pending' } });
    expect((await s.call('GET', `/api/shares/${id}/members`, undefined, tokA)).body.members[0]).toMatchObject({ username: 'bob', role: 'pending' });
    await setRole(id, bobId, 'editor');
    expect((await s.call('GET', `/api/shares/${id}`, undefined, tokB)).body.role).toBe('editor');
  });

  it('changing link access affects newcomers only', async () => {
    const { id } = (await create()).body.share;
    await s.call('GET', `/api/shares/${id}`, undefined, tokB);
    expect((await s.call('PATCH', `/api/shares/${id}`, { linkAccess: 'editor' }, tokA)).body.share.linkAccess).toBe('editor');
    expect((await s.call('GET', `/api/shares/${id}`, undefined, tokB)).body.role).toBe('viewer');
    const carolId = (await s.store.create('carol', 'password-ccc')).id;
    const tokC = (await s.call('POST', '/api/auth/login', { username: 'carol', password: 'password-ccc' })).body.token;
    expect((await s.call('GET', `/api/shares/${id}`, undefined, tokC)).body.role).toBe('editor');
    expect(carolId).toBeGreaterThan(0);
    expect((await s.call('PATCH', `/api/shares/${id}`, { linkAccess: 'everyone' }, tokA)).status).toBe(400);
  });

  it('answers 404 for unknown shares and 401 when signed out; old ?k= links still open', async () => {
    const { id } = (await create()).body.share;
    expect((await s.call('GET', `/api/shares/nope`, undefined, tokB)).status).toBe(404);
    expect((await s.call('GET', `/api/shares/${id}`)).status).toBe(401);
    expect((await s.call('POST', '/api/shares', { title: 'x', config: CONFIG })).status).toBe(401);
    expect((await s.call('GET', `/api/shares/${id}?k=old-edit-key`, undefined, tokB)).body.role).toBe('viewer');
  });

  it('validates input', async () => {
    expect((await create({ title: '' })).status).toBe(400);
    expect((await create({ title: 'x'.repeat(SHARE_LIMITS.titleLength + 1) })).status).toBe(400);
    expect((await create({ config: { ...CONFIG, chartTf: '7m' } })).status).toBe(400);
    expect((await create({ drawings: [{ id: 'z', kind: 'circle', color: 'ink' }] })).status).toBe(400);
    expect((await create({ config: { ...CONFIG, symbol: 'XX=F' } })).status).toBe(400);
    expect((await create({ linkAccess: 'public' })).status).toBe(400);
    const { id } = (await create()).body.share;
    expect((await setRole(id, bobId, 'editor')).status).toBe(404); // never opened it
    expect((await setRole(id, bobId, 'pending')).status).toBe(400);
    expect((await setRole(id, bobId, 'owner')).status).toBe(400);
  });

  it('lists my shares newest first', async () => {
    await create({ title: 'one' });
    await create({ title: 'two' });
    const mine = (await s.call('GET', '/api/shares', undefined, tokA)).body.shares;
    expect(mine.map((x: { title: string }) => x.title).sort()).toEqual(['one', 'two']);
    expect((await s.call('GET', '/api/shares', undefined, tokB)).body.shares).toEqual([]);
  });

  it('owner can rename, lock and save a starting view (the symbol never changes)', async () => {
    const share = (await create()).body.share;
    expect((await s.call('PATCH', `/api/shares/${share.id}`, { title: 'Renamed', locked: true }, tokA)).body.share).toMatchObject({ title: 'Renamed', locked: true });
    expect((await s.call('PATCH', `/api/shares/${share.id}`, {}, tokA)).status).toBe(400);
    const saved = (await s.call('PATCH', `/api/shares/${share.id}`, { config: { ...CONFIG, symbol: 'SPY', chartTf: '15m' } }, tokA)).body.share;
    expect(saved.config).toMatchObject({ symbol: 'QQQ', chartTf: '15m' });
  });

  it('only the owner can change settings, manage people or delete, even an editor', async () => {
    const share = (await create()).body.share;
    await s.call('GET', `/api/shares/${share.id}`, undefined, tokB);
    await setRole(share.id, bobId, 'editor');
    expect((await s.call('PATCH', `/api/shares/${share.id}`, { title: 'mine now' }, tokB)).status).toBe(404);
    expect((await s.call('GET', `/api/shares/${share.id}/members`, undefined, tokB)).status).toBe(404);
    expect((await s.call('PATCH', `/api/shares/${share.id}/members/${bobId}`, { role: 'editor' }, tokB)).status).toBe(404);
    expect((await s.call('DELETE', `/api/shares/${share.id}`, undefined, tokB)).status).toBe(404);
    expect((await s.call('DELETE', `/api/shares/${share.id}`, undefined, tokA)).status).toBe(204);
    expect((await s.call('GET', `/api/shares/${share.id}`, undefined, tokA)).status).toBe(404);
  });

  it('copy to my charts appends with fresh ids under the share’s instrument, within the limit', async () => {
    const share = (await create()).body.share;
    await s.call('PUT', '/api/drawings', { symbol: 'QQQ', drawings: [line('mine')] }, tokB);
    expect((await s.call('POST', `/api/shares/${share.id}/copy`, undefined, tokB)).status).toBe(404); // hasn't opened it
    await s.call('GET', `/api/shares/${share.id}`, undefined, tokB);
    const copy = await s.call('POST', `/api/shares/${share.id}/copy`, undefined, tokB);
    expect(copy.body).toEqual({ copied: 2, skipped: 0, symbol: 'QQQ' });
    const got = (await s.call('GET', '/api/drawings?symbol=QQQ', undefined, tokB)).body.drawings as Drawing[];
    expect(got).toHaveLength(3);
    expect(got[0]!.id).toBe('mine');
    expect(new Set(got.map((d) => d.id)).size).toBe(3);
    expect(got.slice(1).map((d) => (d as { p: number }).p)).toEqual([700, 705]);
    expect(got.slice(1).every((d) => !('v' in d) && !('n' in d))).toBe(true);

    await s.call('PUT', '/api/drawings', { symbol: 'QQQ', drawings: Array.from({ length: DRAWING_LIMITS.perSymbol - 1 }, (_, i) => line(`m${i}`)) }, tokB);
    expect((await s.call('POST', `/api/shares/${share.id}/copy`, undefined, tokB)).body).toMatchObject({ copied: 1, skipped: 1 });
  });

  it('enforces the per-owner share limit', async () => {
    for (let i = 0; i < SHARE_LIMITS.perOwner; i++) await s.shares.create(aliceId, `s${i}`, CONFIG, []);
    const res = await create();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/200/);
  });

  it('deleting a member’s account removes them from people lists', async () => {
    const { id } = (await create()).body.share;
    await s.call('GET', `/api/shares/${id}`, undefined, tokB);
    await s.store.remove(bobId);
    expect((await s.call('GET', `/api/shares/${id}/members`, undefined, tokA)).body.members).toEqual([]);
  });
});
