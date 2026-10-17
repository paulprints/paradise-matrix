import { describe, expect, it } from 'vitest';
import type { ChartResponse, LevelSegment } from '@paradise/contract';
import { levelsAt } from '@paradise/engine';
import { computeChart, LEVEL_KEYS } from '../src/chart.ts';
import { normalizeBars } from '../src/data/bars.ts';
import { XNYS } from '../src/data/calendar.ts';
import { createMarket } from '../src/data/market.ts';
import { staticProvider } from '../src/data/providers.ts';
import { aggregate, at, captureRows, syntheticIntraday } from './helpers.ts';

const DATES = ['2026-09-03', '2026-09-04', '2026-09-08', '2026-09-09'];
const five = syntheticIntraday(DATES, 5);
const fifteen = aggregate(five, 3);
const daily = captureRows('c137807ce33941c68b4041437212a1f8', 241).rows; // through 2026-09-09
const NOW = at('2026-09-09T17:07:00Z'); // 13:07 ET Sep 9 — mid-session
const cut = (rows: typeof five) => rows.filter((r) => r.t < NOW); // provider only has bars that have started
const market = () => createMarket([staticProvider('fx', { 'QQQ:5m': cut(five), 'QQQ:15m': cut(fifteen), 'QQQ:D': daily })], () => NOW);
const PIVOT = LEVEL_KEYS.findIndex((k) => k.slug === 'pivot');
const segs = (r: ChartResponse, tf: string, key = PIVOT, basis = 0) => r.segments.filter((s) => s[1] === tf && s[0] === key && s[5] === basis);
const run = (extra: object = {}) => computeChart({ symbol: 'QQQ', chartTf: '5m', overlays: ['15m', 'D'], ...extra }, { market: market(), now: () => NOW });

describe('/api/chart level history', () => {
  it('each 15m bar’s levels are valid for exactly the next 15m bar, contiguously', async () => {
    const r = await run();
    const p = segs(r, '15m');
    expect(p.length).toBeGreaterThan(40);
    for (const s of p) expect(s[4] - s[3]).toBe(900);
    for (let i = 1; i < p.length; i++) {
      const prev = p[i - 1]!, cur = p[i]!;
      // contiguous within a session; a session boundary jumps to the next open
      if (cur[3] !== prev[4]) expect(new Date(cur[3] * 1000).toISOString().slice(11, 16)).toBe('13:30');
      expect(cur[6]).toBeGreaterThan(prev[6]);
    }
  });

  it('a segment’s price is the engine’s level for its source bar (displacement +1)', async () => {
    const r = await run();
    const tb = normalizeBars(cut(fifteen), '15m', XNYS, NOW).bars;
    for (const s of segs(r, '15m').slice(-5)) {
      const i = tb.findIndex((b) => b.t === s[6]);
      expect(tb[i + 1]?.t ?? null).toBe(tb[i + 1] ? s[3] : null);
      const pivot = levelsAt(tb, i, 'confirmed', 1).find((l) => l.plot === 'PLDot')!.price;
      expect(s[2]).toBe(pivot);
    }
  });

  it('the forming 15m bar shows confirmed levels from the bar before it; old levels stay put', async () => {
    const r = await run();
    const last = segs(r, '15m').at(-1)!;
    // 13:07 ET → forming 15m bar is 13:00–13:15; its levels come from 12:45
    expect(new Date(last[3] * 1000).toISOString()).toBe('2026-09-09T17:00:00.000Z');
    expect(new Date(last[6] * 1000).toISOString()).toBe('2026-09-09T16:45:00.000Z');
  });

  it('developing levels from the forming bar are drawn on the NEXT bar window', async () => {
    const r = await run({ developing: true });
    const dev = segs(r, '15m', PIVOT, 1);
    expect(dev).toHaveLength(1);
    expect(new Date(dev[0]![3] * 1000).toISOString()).toBe('2026-09-09T17:15:00.000Z');
    expect(new Date(dev[0]![6] * 1000).toISOString()).toBe('2026-09-09T17:00:00.000Z');
  });

  it('daily levels span the whole display session', async () => {
    const r = await run();
    const d = segs(r, 'D');
    const today = d.at(-1)!;
    expect([today[3], today[4]].map((x) => new Date(x * 1000).toISOString())).toEqual(['2026-09-09T13:30:00.000Z', '2026-09-09T20:00:00.000Z']);
    expect(new Date(today[6] * 1000).toISOString().slice(0, 10)).toBe('2026-09-08');
  });

  it('Friday’s last 15m levels open Monday’s session (calendar rollover, Labor Day skipped)', async () => {
    const r = await run();
    const rollover = segs(r, '15m').find((s) => new Date(s[6] * 1000).toISOString() === '2026-09-04T19:45:00.000Z')!;
    expect(new Date(rollover[3] * 1000).toISOString()).toBe('2026-09-08T13:30:00.000Z');
  });

  it('incremental updates replay to exactly the full result', async () => {
    const full = await run({ developing: true });
    const since = full.bars.at(-3)!.t;
    const inc = await run({ developing: true, since });
    expect(inc.since).toBe(since);
    expect(inc.bars.every((b) => b.t >= since)).toBe(true);
    expect(inc.segments.every((s) => s[4] > since)).toBe(true);
    // client merge rule: keep segments that ended at or before since, add the increment
    const older = full.segments.filter((s) => s[4] <= since);
    const key = (s: LevelSegment) => s.join('|');
    expect(new Set([...older, ...inc.segments].map(key))).toEqual(new Set(full.segments.map(key)));
    expect(inc.segments.length).toBeLessThan(full.segments.length / 4);
  });

  it('history covers only the chart window; bars limit works; candles-only works', async () => {
    const r = await run({ bars: 100 });
    expect(r.bars).toHaveLength(100);
    expect(r.segments.every((s) => s[4] > r.bars[0]!.t)).toBe(true);
    const bare = await computeChart({ symbol: 'QQQ', chartTf: '5m', overlays: [] }, { market: market(), now: () => NOW });
    expect(bare.segments).toHaveLength(0);
    expect(bare.frames).toHaveLength(0);
    expect(bare.bars.length).toBeGreaterThan(200);
  });

  it('frames and keys match /api/levels vocabulary; no vendor names', async () => {
    const r = await run();
    expect(r.frames.map((f) => f.tf)).toEqual(['D', '15m']);
    expect(r.keys[PIVOT]).toMatchObject({ slug: 'pivot', label: 'Pivot', group: 'structure' });
    expect(JSON.stringify(r)).not.toMatch(/PLDot|Envelope|Zone (Six|Five|Two|One)|Main Channel|Sell|Buy/);
    expect(r.bars.at(-1)!.complete).toBe(false);
  });
});
