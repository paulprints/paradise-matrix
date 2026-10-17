import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { Drawing, LiveServerMessage, ShareInfo } from '@paradise/contract';
import { LIVE_CLOSE } from '@paradise/contract';
import { staticProvider } from '../src/data/providers.ts';
import { SHARE_CONFIG as CONFIG, startServer } from './helpers.ts';

const line = (id: string, p = 700): Drawing => ({ id, kind: 'hline', color: 'ink', p });

/** A test client: queues server messages and lets a test await the next one of a type. */
class Client {
  readonly ws: WebSocket;
  private queue: LiveServerMessage[] = [];
  private waiters: Array<() => void> = [];
  closed: Promise<{ code: number; reason: string }>;
  constructor(url: string, origin?: string) {
    this.ws = new WebSocket(url, origin ? { origin } : {});
    this.ws.on('message', (raw) => { this.queue.push(JSON.parse(raw.toString())); this.waiters.splice(0).forEach((w) => w()); });
    this.closed = new Promise((r) => this.ws.on('close', (code, reason) => r({ code, reason: reason.toString() })));
  }
  opened() { return new Promise<void>((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); this.ws.once('unexpected-response', (_q, r) => rej(new Error(`HTTP ${r.statusCode}`))); }); }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  async next<T extends LiveServerMessage['type']>(type: T, ms = 2000): Promise<Extract<LiveServerMessage, { type: T }>> {
    const deadline = Date.now() + ms;
    for (;;) {
      const i = this.queue.findIndex((m) => m.type === type);
      if (i >= 0) return this.queue.splice(i, 1)[0] as Extract<LiveServerMessage, { type: T }>;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out waiting for ${type}; have ${JSON.stringify(this.queue.map((m) => m.type))}`);
      await new Promise<void>((r) => { const t = setTimeout(r, left); this.waiters.push(() => { clearTimeout(t); r(); }); });
    }
  }
  /** Resolve true if no message of this type arrives within ms. */
  async none(type: LiveServerMessage['type'], ms = 150) { await new Promise((r) => setTimeout(r, ms)); return !this.queue.some((m) => m.type === type); }
  close() { this.ws.close(); }
}

let s: Awaited<ReturnType<typeof startServer>>;
let wsUrl: string, tokA: string, tokB: string, tokC: string, share: ShareInfo, ids: Record<string, number>;
const clients: Client[] = [];
beforeEach(async () => {
  s = await startServer([staticProvider('none', {})], () => Date.now() / 1000);
  wsUrl = s.base.replace('http', 'ws') + '/api/live';
  ids = {};
  for (const [u, p] of [['alice', 'password-aaa'], ['bob', 'password-bbb'], ['carol', 'password-ccc']] as const) ids[u] = (await s.store.create(u, p)).id;
  const login = async (username: string, password: string) => (await s.call('POST', '/api/auth/login', { username, password })).body.token as string;
  [tokA, tokB, tokC] = await Promise.all([login('alice', 'password-aaa'), login('bob', 'password-bbb'), login('carol', 'password-ccc')]);
  share = (await s.call('POST', '/api/shares', { title: 'Room', config: CONFIG, drawings: [line('a')] }, tokA)).body.share;
});
afterEach(async () => { clients.splice(0).forEach((c) => c.close()); await s.close(); });

async function join(token: string, id = share.id) {
  const c = new Client(wsUrl);
  clients.push(c);
  await c.opened();
  c.send({ type: 'auth', token, share: id });
  return c;
}
/** The person opens the link (joining as the link allows), then the owner sets their role. */
async function grant(token: string, user: string, role: 'viewer' | 'editor' | 'removed') {
  await s.call('GET', `/api/shares/${share.id}`, undefined, token);
  if (role !== 'viewer') await s.call('PATCH', `/api/shares/${share.id}/members/${ids[user]}`, { role }, tokA);
}

describe('live rooms', () => {
  it('welcomes with role, peers, drawings and presenter; announces joins and leaves', async () => {
    const alice = await join(tokA);
    const w = await alice.next('welcome');
    expect(w.you).toMatchObject({ username: 'alice', role: 'owner' });
    expect(w.peers).toEqual([]);
    expect(w.drawings).toMatchObject([{ id: 'a', v: 1 }]);
    expect(w.presenter).toBeNull();
    expect(w.share.linkAccess).toBe('viewer');

    await grant(tokB, 'bob', 'editor');
    const bob = await join(tokB);
    const wb = await bob.next('welcome');
    expect(wb.you.role).toBe('editor');
    expect(wb.peers.map((p) => p.username)).toEqual(['alice']);
    expect(await alice.next('peer')).toMatchObject({ event: 'join', peer: { username: 'bob', role: 'editor' } });

    bob.close();
    const left = await alice.next('peer');
    expect(left).toMatchObject({ event: 'leave', peer: { username: 'bob' } });
    expect(s.live.stats()).toEqual({ rooms: 1, connections: 1 });
  });

  it('relays accepted ops to others (not the sender) and persists them', async () => {
    const alice = await join(tokA); await alice.next('welcome');
    await grant(tokB, 'bob', 'editor');
    const bob = await join(tokB); await bob.next('welcome');
    bob.send({ type: 'ops', ops: [{ id: 'b', v: 1, n: 3, d: line('b', 710) }, { id: 'a', v: 2, n: 1, del: true }] });
    const got = await alice.next('ops');
    expect(got.by).toMatch(/^[0-9a-f]{12}$/);
    expect(got.ops.map((o) => o.id)).toEqual(['b', 'a']);
    expect(await bob.none('ops')).toBe(true);
    expect((await s.shares.drawings(share.id)).map((d) => d.id)).toEqual(['b']);
  });

  it('rejects stale ops back to the sender with the winning state', async () => {
    const alice = await join(tokA); await alice.next('welcome');
    await grant(tokB, 'bob', 'editor');
    const bob = await join(tokB); await bob.next('welcome');
    alice.send({ type: 'ops', ops: [{ id: 'a', v: 2, n: 1, d: line('a', 701) }] });
    await bob.next('ops');
    bob.send({ type: 'ops', ops: [{ id: 'a', v: 2, n: 9, d: line('a', 999) }] });
    const r = await bob.next('reject');
    expect(r.ops).toEqual([{ id: 'a', v: 2, n: 1, d: line('a', 701) }]);
    expect(await alice.none('ops')).toBe(true);
  });

  it('viewers and locked charts are read-only; refused edits are undone with the stored state', async () => {
    const viewer = await join(tokB); // first open via the socket: joins as the link allows (viewer)
    expect((await viewer.next('welcome')).you.role).toBe('viewer');
    viewer.send({ type: 'ops', ops: [{ id: 'a', v: 5, n: 1, del: true }, { id: 'new', v: 1, n: 1, d: line('new') }] });
    const r = await viewer.next('reject');
    expect(r.reason).toMatch(/view-only/);
    expect(r.ops).toEqual([{ id: 'a', v: 1, n: expect.any(Number), d: line('a') }, { id: 'new', v: 0, n: 0, del: true }]);

    const owner = await join(tokA); await owner.next('welcome');
    await s.call('PATCH', `/api/shares/${share.id}`, { locked: true }, tokA);
    expect((await owner.next('share')).share.locked).toBe(true);
    const seen = await viewer.next('share');
    expect(seen.share.locked).toBe(true);
    expect(seen.role).toBe('viewer');
    owner.send({ type: 'ops', ops: [{ id: 'a', v: 9, n: 1, del: true }] });
    expect((await owner.next('reject')).reason).toMatch(/locked/);
    expect(await s.shares.drawings(share.id)).toHaveLength(1);
  });

  it('closes with 4401 for a bad sign-in, 4404 for an unknown share, 4403 while waiting or removed', async () => {
    const bad = await join('not-a-real-token-at-all');
    expect((await bad.closed).code).toBe(LIVE_CLOSE.auth);
    const none = await join(tokB, 'nope');
    expect((await none.closed).code).toBe(LIVE_CLOSE.gone);
    await s.call('PATCH', `/api/shares/${share.id}`, { linkAccess: 'approval' }, tokA);
    const waiting = await join(tokB);
    expect(await waiting.closed).toEqual({ code: LIVE_CLOSE.forbidden, reason: 'waiting for the owner' });
    await s.call('PATCH', `/api/shares/${share.id}/members/${ids.bob}`, { role: 'removed' }, tokA);
    const removed = await join(tokB);
    expect(await removed.closed).toEqual({ code: LIVE_CLOSE.forbidden, reason: 'access removed' });
    const early = new Client(wsUrl); clients.push(early); await early.opened();
    early.send({ type: 'ops', ops: [{ id: 'x', v: 1, n: 1, del: true }] });
    expect((await early.closed).code).toBe(LIVE_CLOSE.auth);
  });

  it('refuses cross-site upgrades and 404s other paths', async () => {
    const evil = new Client(wsUrl, 'https://evil.example');
    await expect(evil.opened()).rejects.toThrow(/403/);
    const ok = new Client(wsUrl, 'http://localhost:5173'); clients.push(ok);
    await ok.opened();
    const other = new Client(s.base.replace('http', 'ws') + '/api/other');
    await expect(other.opened()).rejects.toThrow(/404/);
  });

  it('relays cursors and presenter views; presenter is cleared on stop and on leave', async () => {
    const alice = await join(tokA); await alice.next('welcome');
    const bob = await join(tokB); await bob.next('welcome');
    const view = { chartTf: '5m', timeframes: ['D'], from: 1757424600, to: 1757440000 };
    alice.send({ type: 'present', on: true });
    const p = await bob.next('present');
    expect(p.presenter).toBeTruthy();
    expect((await alice.next('present')).presenter).toBe(p.presenter);
    alice.send({ type: 'presence', cursor: { t: 1757424600, p: 701.5 }, view });
    expect(await bob.next('presence')).toEqual({ type: 'presence', from: p.presenter, cursor: { t: 1757424600, p: 701.5 }, view });

    // A late joiner learns who is presenting.
    const carol = await join(tokC);
    expect((await carol.next('welcome')).presenter).toBe(p.presenter);

    alice.send({ type: 'present', on: false });
    expect((await bob.next('present')).presenter).toBeNull();
    alice.send({ type: 'present', on: true });
    await bob.next('present');
    alice.close();
    await bob.next('peer');
    expect((await bob.next('present')).presenter).toBeNull();
  });

  it('role changes reach open tabs at once: promoted, demoted, removed; deleting closes the room', async () => {
    const owner = await join(tokA); await owner.next('welcome');
    const bob = await join(tokB); expect((await bob.next('welcome')).you.role).toBe('viewer');
    const carol = await join(tokC); await carol.next('welcome');

    await s.call('PATCH', `/api/shares/${share.id}/members/${ids.bob}`, { role: 'editor' }, tokA);
    expect((await bob.next('share')).role).toBe('editor');
    expect(await carol.next('peer')).toMatchObject({ event: 'update', peer: { username: 'bob', role: 'editor' } });
    bob.send({ type: 'ops', ops: [{ id: 'b', v: 1, n: 1, d: line('b') }] });
    expect((await carol.next('ops')).ops[0]!.id).toBe('b');

    await s.call('PATCH', `/api/shares/${share.id}/members/${ids.bob}`, { role: 'viewer' }, tokA);
    expect((await bob.next('share')).role).toBe('viewer');
    bob.send({ type: 'ops', ops: [{ id: 'c', v: 1, n: 1, d: line('c') }] });
    expect((await bob.next('reject')).reason).toMatch(/view-only/);

    await s.call('PATCH', `/api/shares/${share.id}/members/${ids.bob}`, { role: 'removed' }, tokA);
    expect(await bob.closed).toEqual({ code: LIVE_CLOSE.forbidden, reason: 'access removed' });

    await s.call('DELETE', `/api/shares/${share.id}`, undefined, tokA);
    expect((await carol.closed).code).toBe(LIVE_CLOSE.gone);
  });

  it('keeps the owner’s people list live: requests, joins, who’s online', async () => {
    await s.call('PATCH', `/api/shares/${share.id}`, { linkAccess: 'approval' }, tokA);
    const owner = await join(tokA); await owner.next('welcome');
    expect((await owner.next('members')).members).toEqual([]); // sent when the owner arrives
    // Bob opens the link and has to wait: the owner hears about it immediately.
    expect((await s.call('GET', `/api/shares/${share.id}`, undefined, tokB)).status).toBe(403);
    expect((await owner.next('members')).members).toMatchObject([{ username: 'bob', role: 'pending', online: false }]);
    // Let him in; he connects and shows as online; leaving flips it back.
    await s.call('PATCH', `/api/shares/${share.id}/members/${ids.bob}`, { role: 'viewer' }, tokA);
    expect((await owner.next('members')).members[0]).toMatchObject({ role: 'viewer', online: false });
    const bob = await join(tokB); await bob.next('welcome');
    expect((await owner.next('members')).members[0]).toMatchObject({ online: true });
    bob.close();
    expect((await owner.next('members')).members[0]).toMatchObject({ online: false });
    // Non-owners never receive the list.
    const carol = await join(tokC);
    expect((await carol.closed).code).toBe(LIVE_CLOSE.forbidden); // approval mode: carol is now waiting
    expect((await owner.next('members')).members.map((m) => [m.username, m.role])).toEqual(expect.arrayContaining([['carol', 'pending'], ['bob', 'viewer']]));
  });

  it('a non-owner never receives the people list', async () => {
    const owner = await join(tokA); await owner.next('welcome');
    const bob = await join(tokB); await bob.next('welcome');
    await owner.next('members');
    const carol = await join(tokC); await carol.next('welcome');
    await owner.next('members');
    expect(await bob.none('members', 300)).toBe(true);
  });

  it('rate-limits floods of edits', async () => {
    const alice = await join(tokA); await alice.next('welcome');
    for (let i = 0; i < 3; i++) alice.send({ type: 'ops', ops: Array.from({ length: 100 }, (_, k) => ({ id: `f${i}-${k}`, v: 1, n: 1, d: line(`f${i}-${k}`) })) });
    const r = await alice.next('reject', 5000);
    expect(r.reason).toMatch(/slow down/);
    // The refused batch comes back as the stored state (never accepted → v0), so the sender rolls back.
    expect(r.ops).toHaveLength(100);
    expect(r.ops.every((o) => o.v === 0 && o.del)).toBe(true);
    expect(await s.shares.drawings(share.id)).toHaveLength(201);
  });

  it('reconnecting gets the full current state', async () => {
    const alice = await join(tokA); await alice.next('welcome');
    alice.send({ type: 'ops', ops: [{ id: 'b', v: 1, n: 1, d: line('b') }] });
    alice.send({ type: 'ping' });
    await alice.next('pong');
    alice.close();
    const again = await join(tokA);
    expect((await again.next('welcome')).drawings.map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('answers malformed messages with an error instead of crashing', async () => {
    const alice = await join(tokA); await alice.next('welcome');
    alice.ws.send('{not json');
    expect((await alice.next('error')).message).toMatch(/malformed/);
    alice.send({ type: 'ops', ops: [{ id: 'x', v: 1, n: 1 }] });
    expect(await alice.next('error')).toBeTruthy();
    alice.send({ type: 'ping' });
    await alice.next('pong');
  });
});
