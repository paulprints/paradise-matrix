import { describe, expect, it } from 'vitest';
import type { ChartResponse, LevelKey, LevelSegment } from '@paradise/contract';
import { barIndexAt, barSpan, logicalToTime, timeToLogical } from '../src/chart/time.ts';
import { applyChart, buildTimeline, intervalAt } from '../src/chart/state.ts';

describe('time ↔ logical', () => {
  // three 5m bars, a gap (overnight), two more
  const times = [0, 300, 600, 10_000, 10_300];
  it('maps bar starts to left edges and positions within bars proportionally', () => {
    expect(timeToLogical(times, 300, 0)).toBe(-0.5);
    expect(timeToLogical(times, 300, 150)).toBe(0);
    expect(timeToLogical(times, 300, 600)).toBe(1.5);
  });
  it('collapses gaps to the boundary between bars', () => {
    expect(timeToLogical(times, 300, 5000)).toBe(2.5);
    expect(timeToLogical(times, 300, 10_000)).toBe(2.5);
  });
  it('extrapolates into the future and the past', () => {
    expect(timeToLogical(times, 300, 10_600)).toBe(4.5);
    expect(timeToLogical(times, 300, 10_900)).toBe(5.5);
    expect(timeToLogical(times, 300, -300)).toBe(-1.5);
  });
  it('logicalToTime inverts it inside bars and in the future', () => {
    for (const t of [0, 150, 299, 300, 10_000, 10_450, 11_000, 12_345, -600]) {
      expect(logicalToTime(times, 300, timeToLogical(times, 300, t))).toBeCloseTo(t, 6);
    }
  });
  it('barIndexAt and barSpan', () => {
    expect([barIndexAt(times, -1), barIndexAt(times, 0), barIndexAt(times, 9_999), barIndexAt(times, 99_999)]).toEqual([-1, 0, 2, 4]);
    expect(barSpan(times)).toBe(300);
    expect(barSpan([5])).toBe(60);
  });
});

const keys: LevelKey[] = [{ slug: 'pivot', label: 'Pivot', group: 'structure', family: 'pivot' }, { slug: 'band.upper', label: 'Upper Band', group: 'structure', family: 'bands' }];
const resp = (segments: LevelSegment[], bars: number[], since: number | null): ChartResponse => ({
  instrument: { symbol: 'QQQ', root: 'QQQ', kind: 'equity', tick: 0.01, calendar: 'XNYS', calendarFidelity: 'exact', timezone: 'America/New_York', session: '', adjustment: 'split' },
  generatedAt: '', dataSource: 't', engineVersion: 'e', chartTf: '5m',
  bars: bars.map((t) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 0, complete: true })),
  keys, segments, frames: [], lastPrice: null, since, warnings: [],
});

describe('applyChart', () => {
  it('full load replaces; increment keeps final history and replaces the live tail', () => {
    const full = applyChart(null, resp([[0, '15m', 10, 0, 900, 0, -900], [0, '15m', 11, 900, 1800, 0, 0], [0, '15m', 12, 1800, 2700, 1, 900]], [0, 300, 600, 900, 1200], null));
    expect(full.bars).toHaveLength(5);
    expect(full.segments).toHaveLength(3);
    const next = applyChart(full, resp([[0, '15m', 11.5, 900, 1800, 0, 0], [0, '15m', 13, 1800, 2700, 1, 900]], [1200, 1500], 1200));
    expect(next.bars.map((b) => b.t)).toEqual([0, 300, 600, 900, 1200, 1500]);
    expect(next.segments.map((s) => s.price)).toEqual([10, 11.5, 13]);
    expect(next.segments[2]!.developing).toBe(true);
  });
  it('a different chart timeframe is a full replace', () => {
    const a = applyChart(null, resp([], [0, 300], null));
    const b = applyChart(a, { ...resp([], [0, 900], 900), chartTf: '15m' });
    expect(b.bars.map((x) => x.t)).toEqual([0, 900]);
  });
});

describe('timeline', () => {
  it('splits into constant intervals and finds them', () => {
    const s = applyChart(null, resp([[0, 'D', 100, 0, 3000, 0, -1], [1, '15m', 101, 0, 900, 0, -1], [1, '15m', 102, 900, 1800, 0, 0]], [], null)).segments;
    const tl = buildTimeline(s);
    expect(tl.map((i) => [i.from, i.to, i.active.length])).toEqual([[0, 900, 2], [900, 1800, 2], [1800, 3000, 1]]);
    expect(intervalAt(tl, 950)!.from).toBe(900);
    expect(intervalAt(tl, 3000)).toBeNull();
    expect(intervalAt([], 1)).toBeNull();
  });
});

import { logicalToX, xToLogical } from '../src/chart/coords.ts';

describe('coords — interpolation around whole-index-only conversion', () => {
  // Mimics Lightweight Charts 5.2.1: whole indexes only (fractional → 0), reverse conversion rounds.
  const ts = {
    logicalToCoordinate: (l: number) => (Number.isInteger(l) ? 100 + l * 8 : 0),
    coordinateToLogical: (x: number) => Math.round((x - 100) / 8),
  };
  it('interpolates fractional positions instead of collapsing to 0', () => {
    expect(ts.logicalToCoordinate(997.5)).toBe(0); // the library behaviour we work around
    expect(logicalToX(ts, 997.5)).toBe(100 + 997.5 * 8);
    expect(logicalToX(ts, 3)).toBe(124);
    expect(logicalToX(ts, -0.5)).toBe(96);
  });
  it('recovers sub-bar positions from pixels', () => {
    for (const l of [0, 0.25, 3.5, 10.75, 1005.4]) expect(xToLogical(ts, 100 + l * 8)).toBeCloseTo(l, 9);
  });
  it('null passes through', () => {
    const none = { logicalToCoordinate: () => null, coordinateToLogical: () => null };
    expect(logicalToX(none, 1.5)).toBeNull();
    expect(xToLogical(none, 10)).toBeNull();
  });
});
