import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { staticProvider } from '../src/data/providers.ts';
import { startServer } from './helpers.ts';

let s: Awaited<ReturnType<typeof startServer>>;
let tokA: string, tokB: string;
beforeEach(async () => {
  s = await startServer([staticProvider('none', {})], () => Date.now() / 1000);
  await s.store.create('alice', 'password-aaa');
  await s.store.create('bob', 'password-bbb');
  tokA = (await s.call('POST', '/api/auth/login', { username: 'alice', password: 'password-aaa' })).body.token;
  tokB = (await s.call('POST', '/api/auth/login', { username: 'bob', password: 'password-bbb' })).body.token;
});
afterEach(async () => { await s.close(); });

const sample = [
  { id: 'a1', kind: 'trend', color: 'seal', a: { t: 1757424600, p: 700 }, b: { t: 1757428200, p: 710 }, extend: true },
  { id: 'a2', kind: 'hline', color: 'ink', p: 705.5 },
  { id: 'a3', kind: 'vline', color: 'paper', t: 1757424600 },
  { id: 'a4', kind: 'rect', color: 'sky', a: { t: 1757424600, p: 700 }, b: { t: 1757428200, p: 710 } },
  { id: 'a5', kind: 'text', color: 'alert', a: { t: 1757424600, p: 712 }, text: 'Watch the open' },
  { id: 'a6', kind: 'brush', color: 'paper', pts: [{ t: 1757424600, p: 700 }, { t: 1757425000, p: 701 }, { t: 1757425400, p: 699 }] },
];

describe('drawings', () => {
  it('round-trips all six kinds, per member', async () => {
    const put = await s.call('PUT', '/api/drawings', { symbol: 'QQQ', drawings: sample }, tokA);
    expect(put.status).toBe(200);
    expect(put.body.updatedAt).toBeTruthy();
    const got = await s.call('GET', '/api/drawings?symbol=QQQ', undefined, tokA);
    expect(got.body.drawings).toEqual(sample);
    expect((await s.call('GET', '/api/drawings?symbol=QQQ', undefined, tokB)).body.drawings).toEqual([]);
  });

  it('keys by resolved instrument: NQ, /NQ and NQ=F share drawings', async () => {
    await s.call('PUT', '/api/drawings', { symbol: '/nq', drawings: sample.slice(0, 1) }, tokA);
    const got = await s.call('GET', '/api/drawings?symbol=NQ=F', undefined, tokA);
    expect(got.body).toMatchObject({ symbol: 'NQ=F', drawings: sample.slice(0, 1) });
  });

  it('replaces the whole set on save (deletions persist)', async () => {
    await s.call('PUT', '/api/drawings', { symbol: 'QQQ', drawings: sample }, tokA);
    await s.call('PUT', '/api/drawings', { symbol: 'QQQ', drawings: [] }, tokA);
    expect((await s.call('GET', '/api/drawings?symbol=QQQ', undefined, tokA)).body.drawings).toEqual([]);
  });

  it('refuses a save based on a stale copy (another tab saved since) and returns what is stored', async () => {
    const first = await s.call('PUT', '/api/drawings', { symbol: 'QQQ', drawings: [sample[0]], baseUpdatedAt: null }, tokA);
    expect(first.status).toBe(200);
    expect((await s.call('PUT', '/api/drawings', { symbol: 'QQQ', drawings: [], baseUpdatedAt: null }, tokA)).status).toBe(409);
    const base = first.body.updatedAt;
    // Tab 1 saves on top of what both tabs loaded...
    const tab1 = await s.call('PUT', '/api/drawings', { symbol: 'QQQ', drawings: [sample[0], sample[1]], baseUpdatedAt: base }, tokA);
    expect(tab1.status).toBe(200);
    expect(tab1.body.updatedAt).not.toBe(base);
    // ...so tab 2, still on the old copy, can't wipe tab 1's line.
    const tab2 = await s.call('PUT', '/api/drawings', { symbol: 'QQQ', drawings: [], baseUpdatedAt: base }, tokA);
    expect(tab2.status).toBe(409);
    expect(tab2.body.details).toEqual({ symbol: 'QQQ', drawings: [sample[0], sample[1]], updatedAt: tab1.body.updatedAt });
    expect((await s.call('GET', '/api/drawings?symbol=QQQ', undefined, tokA)).body.drawings).toEqual([sample[0], sample[1]]);
  });

  it('validates shape and limits', async () => {
    const bad = async (d: unknown) => (await s.call('PUT', '/api/drawings', { symbol: 'QQQ', drawings: [d] }, tokA)).status;
    expect(await bad({ ...sample[1], color: 'hotpink' })).toBe(400);
    expect(await bad({ ...sample[4], text: 'x'.repeat(201) })).toBe(400);
    expect(await bad({ ...sample[5], pts: Array.from({ length: 2001 }, (_, i) => ({ t: i, p: 1 })) })).toBe(400);
    expect(await bad({ id: 'z', kind: 'circle', color: 'ink' })).toBe(400);
    expect(await bad({ ...sample[1], p: 'NaN' })).toBe(400);
    expect((await s.call('PUT', '/api/drawings', { symbol: 'XX=F', drawings: [] }, tokA)).status).toBe(400);
  });

  it('requires sign-in; deleting a member deletes their drawings', async () => {
    expect((await s.call('GET', '/api/drawings?symbol=QQQ')).status).toBe(401);
    await s.call('PUT', '/api/drawings', { symbol: 'QQQ', drawings: sample }, tokB);
    const bob = await s.store.byUsername('bob');
    await s.store.remove(bob!.id);
    expect(await s.store.getDrawings(bob!.id, 'QQQ')).toBeNull();
  });
});
