import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_CLOSE, stampWins, type Drawing, type LiveOp, type VersionedDrawing } from '@paradise/contract';
import { SharedDoc } from '../src/share/doc.ts';
import { BACKOFF_MS, backoff, LiveConnection } from '../src/share/live.ts';
import { Outbox } from '../src/share/outbox.ts';
import { configFromView, liveUrl, parseShareRoute, shareLink, viewFromConfig } from '../src/share/route.ts';
import { DEFAULT_VIEW } from '../src/lib/view.ts';

const line = (id: string, p = 700): Drawing => ({ id, kind: 'hline', color: 'ink', p });
const seq = () => { let i = 100; return () => i++; };

/** A minimal stand-in for the server's apply(): same rule, returns accepted/rejected. */
class FakeServer {
  state = new Map<string, LiveOp>();
  apply(ops: LiveOp[]) {
    const accepted: LiveOp[] = [], rejected: LiveOp[] = [];
    for (const op of ops) {
      const cur = this.state.get(op.id);
      if (stampWins(op, cur)) { this.state.set(op.id, op); accepted.push(op); }
      else rejected.push(cur ?? { id: op.id, v: 0, n: 0, del: true });
    }
    return { accepted, rejected };
  }
  live(): VersionedDrawing[] { return [...this.state.values()].filter((o) => !o.del).map((o) => ({ ...o.d!, v: o.v, n: o.n })); }
}

describe('SharedDoc', () => {
  it('turns edits into minimal versioned ops and keeps display order', () => {
    const doc = new SharedDoc(seq());
    doc.load([{ ...line('a'), v: 1, n: 5 }, { ...line('b', 701), v: 1, n: 6 }]);
    expect(doc.diff([line('a'), line('b', 701)])).toEqual([]);
    const ops = doc.diff([line('a', 699), line('b', 701), line('c', 702)]);
    expect(ops).toEqual([{ id: 'a', v: 2, n: 100, d: line('a', 699) }, { id: 'c', v: 1, n: 101, d: line('c', 702) }]);
    expect(doc.diff([line('a', 699), line('c', 702)])).toEqual([{ id: 'b', v: 2, n: 102, del: true }]);
    expect(doc.list().map((d) => d.id)).toEqual(['a', 'c']);
  });

  it('remote ops apply only when they win; a re-created id gets a higher version than its tombstone', () => {
    const doc = new SharedDoc(seq());
    doc.load([{ ...line('a'), v: 3, n: 5 }]);
    expect(doc.apply([{ id: 'a', v: 2, n: 0, d: line('a', 1) }])).toBe(false);
    expect(doc.apply([{ id: 'a', v: 4, n: 9, del: true }])).toBe(true);
    expect(doc.list()).toEqual([]);
    expect(doc.diff([line('a', 5)])[0]).toMatchObject({ id: 'a', v: 5 });
  });

  it('force takes the server state; a v0 reject removes a drawing the server never accepted', () => {
    const doc = new SharedDoc(seq());
    doc.diff([line('x')]);
    doc.force([{ id: 'x', v: 0, n: 0, del: true }]);
    expect(doc.list()).toEqual([]);
    expect(doc.stamp('x')).toBeNull();
    doc.load([{ ...line('a'), v: 2, n: 1 }]);
    doc.diff([line('a', 999)]);
    doc.force([{ id: 'a', v: 2, n: 1, d: line('a') }]);
    expect(doc.list()).toEqual([line('a')]);
  });

  it('three members converge whatever order the server and peers see their ops in', () => {
    for (let trial = 0; trial < 50; trial++) {
      const server = new FakeServer();
      const docs = [new SharedDoc(), new SharedDoc(), new SharedDoc()];
      const seed = [line('a'), line('b'), line('c')];
      const initial = docs[0]!.diff(seed);
      server.apply(initial);
      docs.forEach((d) => d.load(server.live()));
      // Everyone edits concurrently from the same starting point.
      const batches = docs.map((d, i) => d.diff(i === 0 ? [line('a', 1), line('b'), line('c')] : i === 1 ? [line('a', 2), line('c')] : [line('a'), line('b'), line('c', 3), line('d')]));
      const order = [0, 1, 2].sort(() => Math.random() - 0.5);
      for (const i of order) {
        const { accepted, rejected } = server.apply(batches[i]!);
        docs.forEach((d, j) => { if (j !== i) d.apply(accepted); });
        docs[i]!.force(rejected);
      }
      const truth = JSON.stringify(server.live().map(({ v: _v, n: _n, ...d }) => d).sort((x, y) => x.id.localeCompare(y.id)));
      for (const d of docs) expect(JSON.stringify([...d.list()].sort((x, y) => x.id.localeCompare(y.id)))).toBe(truth);
    }
  });

  it('rebase after a reconnect keeps offline work, adopts newer remote work, and lets the server settle unknowns', () => {
    const server = new FakeServer();
    const me = new SharedDoc(seq());
    server.apply(me.diff([line('a'), line('b'), line('gone')]));
    me.load(server.live());
    // Offline: I edit a and add n. Meanwhile someone edits b and deletes 'gone'.
    me.diff([line('a', 650), line('b'), line('gone'), line('n')]);
    const b = server.state.get('b')!, g = server.state.get('gone')!;
    server.apply([{ id: 'b', v: b.v + 1, n: 1, d: line('b', 720) }, { id: 'gone', v: g.v + 1, n: 1, del: true }]);

    const resend = me.rebase(server.live());
    expect(resend.map((o) => o.id).sort()).toEqual(['a', 'gone', 'n']);
    const { rejected } = server.apply(resend);
    me.force(rejected);
    expect(me.list()).toEqual(server.live().map(({ v: _v, n: _n, ...d }) => d));
    expect(me.list().map((d) => [d.id, (d as { p: number }).p])).toEqual([['a', 650], ['b', 720], ['n', 700]]);
  });
});

describe('share routes', () => {
  it('parses /c/<id>?k=<key> and nothing else', () => {
    expect(parseShareRoute('/c/AbC123xyZ0', '?k=abcdefghij_-12')).toEqual({ id: 'AbC123xyZ0', key: 'abcdefghij_-12' });
    expect(parseShareRoute('/c/AbC123xyZ0/', '')).toEqual({ id: 'AbC123xyZ0', key: null });
    expect(parseShareRoute('/c/AbC123xyZ0', '?k=<script>')).toEqual({ id: 'AbC123xyZ0', key: null });
    expect(parseShareRoute('/', '?s=QQQ')).toBeNull();
    expect(parseShareRoute('/c/../x', '')).toBeNull();
  });

  it('builds links and the live URL next to the API', () => {
    expect(shareLink('https://app.example', 'abc123', 'k-1/+')).toBe('https://app.example/c/abc123?k=k-1%2F%2B');
    expect(shareLink('https://app.example', 'abc123')).toBe('https://app.example/c/abc123');
    expect(liveUrl('https://api.printersbackend.org', { protocol: 'https:', host: 'x' })).toBe('wss://api.printersbackend.org/api/live');
    expect(liveUrl('http://localhost:3002/', { protocol: 'http:', host: 'x' })).toBe('ws://localhost:3002/api/live');
    expect(liveUrl(undefined, { protocol: 'https:', host: 'paradise.app' })).toBe('wss://paradise.app/api/live');
    expect(liveUrl('', { protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/api/live');
  });

  it('round-trips the view through a share config', () => {
    const v = { ...DEFAULT_VIEW, symbol: 'SPY', chartTf: '15m' as const, heatStyle: 'halftone' as const, developing: true };
    expect({ ...DEFAULT_VIEW, ...viewFromConfig(configFromView(v)) }).toEqual(v);
  });
});

/** Fake browser WebSocket driven by the test. */
class FakeWS {
  static OPEN = 1;
  static all: FakeWS[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { FakeWS.all.push(this); }
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
  open() { this.readyState = 1; this.onopen?.(); }
  recv(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}
const welcome = { type: 'welcome', you: { id: 'p', userId: 1, username: 'a', role: 'owner', color: '#fff' }, peers: [], drawings: [], presenter: null, share: {} };

describe('LiveConnection', () => {
  beforeEach(() => { vi.useFakeTimers(); FakeWS.all = []; });
  afterEach(() => vi.useRealTimers());
  const make = (token: string | null = 'tok') => {
    const statuses: string[] = [], msgs: unknown[] = [];
    const conn = new LiveConnection({
      url: 'ws://x/api/live', auth: () => ({ token, share: 's1', key: 'k1' }),
      onMessage: (m) => msgs.push(m), onStatus: (s, r) => statuses.push(r ? `${s}:${r}` : s),
      WebSocket: FakeWS as unknown as typeof WebSocket, random: () => 0.5,
    });
    return { conn, statuses, msgs };
  };

  it('signs in with the first message and only sends once welcomed', () => {
    const { conn, statuses } = make();
    conn.start();
    const ws = FakeWS.all[0]!;
    expect(conn.send({ type: 'ping' })).toBe(false);
    ws.open();
    expect(ws.sent[0]).toEqual({ type: 'auth', token: 'tok', share: 's1', key: 'k1' });
    expect(conn.send({ type: 'ping' })).toBe(false);
    ws.recv(welcome);
    expect(conn.send({ type: 'ping' })).toBe(true);
    expect(statuses).toEqual(['connecting', 'live']);
    conn.stop();
  });

  it('reconnects with growing, capped backoff and resets after a welcome', () => {
    const { conn, statuses } = make();
    conn.start();
    for (let i = 0; i < 8; i++) {
      FakeWS.all.at(-1)!.drop();
      const wait = BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)]!;
      vi.advanceTimersByTime(wait - 1);
      expect(FakeWS.all.length).toBe(i + 1);
      vi.advanceTimersByTime(1);
      expect(FakeWS.all.length).toBe(i + 2);
    }
    const ws = FakeWS.all.at(-1)!;
    ws.open(); ws.recv(welcome); ws.drop();
    vi.advanceTimersByTime(BACKOFF_MS[0]!);
    expect(FakeWS.all.length).toBe(10);
    expect(statuses.filter((s) => s === 'offline').length).toBe(9);
    conn.stop();
  });

  it('stops for good on sign-in, revoked and deleted close codes', () => {
    for (const [code, reason] of [[LIVE_CLOSE.auth, 'auth'], [LIVE_CLOSE.forbidden, 'revoked'], [LIVE_CLOSE.gone, 'gone']] as const) {
      FakeWS.all = [];
      const { conn, statuses } = make();
      conn.start();
      FakeWS.all[0]!.drop(code);
      vi.advanceTimersByTime(60_000);
      expect(FakeWS.all.length).toBe(1);
      expect(statuses.at(-1)).toBe(`ended:${reason}`);
      conn.stop();
    }
  });

  it('ends without a token, and stop() prevents any reconnect', () => {
    const a = make(null);
    a.conn.start();
    FakeWS.all[0]!.open();
    expect(a.statuses.at(-1)).toBe('ended:auth');
    FakeWS.all = [];
    const b = make();
    b.conn.start();
    b.conn.stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeWS.all.length).toBe(1);
  });

  it('jitters within ±25%', () => {
    expect(backoff(0, () => 0)).toBe(375);
    expect(backoff(0, () => 1)).toBe(625);
    expect(backoff(99, () => 0.5)).toBe(15000);
  });
});

describe('Outbox', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const op = (id: string, v = 1): LiveOp => ({ id, v, n: 1, del: true });

  it('sends at once within budget, in messages of at most 100, collapsing repeats', () => {
    const sent: LiveOp[][] = [];
    const box = new Outbox((b) => { sent.push(b); return true; }, () => Date.now());
    box.push([op('a'), op('b'), op('a', 2)]);
    expect(sent).toEqual([[op('b'), op('a', 2)]]);
    box.push(Array.from({ length: 150 }, (_, i) => op(`x${i}`)));
    expect(sent.slice(1).map((b) => b.length)).toEqual([100, 50]);
  });

  it('paces a large batch to the server budget instead of tripping its limit', () => {
    const sent: Array<{ at: number; n: number }> = [];
    const box = new Outbox((b) => { sent.push({ at: Date.now(), n: b.length }); return true; }, () => Date.now());
    box.push(Array.from({ length: 500 }, (_, i) => op(`d${i}`)));
    expect(sent.reduce((s, x) => s + x.n, 0)).toBe(190);
    vi.advanceTimersByTime(20_000);
    expect(sent.reduce((s, x) => s + x.n, 0)).toBe(500);
    expect(box.pending).toBe(0);
    // Server-side check: replay against a bucket of 200 / 10 s; it never runs dry.
    let tokens = 200, last = sent[0]!.at;
    for (const s of sent) { tokens = Math.min(200, tokens + ((s.at - last) / 10_000) * 200); last = s.at; tokens -= s.n; expect(tokens).toBeGreaterThanOrEqual(0); expect(s.n).toBeLessThanOrEqual(100); }
  });

  it('drops the queue when offline', () => {
    let online = false;
    const box = new Outbox(() => online, () => Date.now());
    box.push([op('a')]);
    expect(box.pending).toBe(0);
    online = true;
    box.push(Array.from({ length: 300 }, (_, i) => op(`d${i}`)));
    box.clear();
    vi.advanceTimersByTime(30_000);
    expect(box.pending).toBe(0);
  });
});
