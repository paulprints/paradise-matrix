import { describe, expect, it } from 'vitest';
import { COMPLETION_GRACE_S, confirmedIndexAt, displayRef, normalizeBars, type RawBar } from '../src/data/bars.ts';
import { XNYS } from '../src/data/calendar.ts';

const at = (s: string) => Date.parse(s) / 1000;
const row = (t: string, c = 100): RawBar => ({ t: at(t), o: c, h: c + 1, l: c - 1, c, v: 1000 });

describe('normalizeBars — daily', () => {
  const raw = [row('2026-09-03T13:30:00Z'), row('2026-09-04T13:30:00Z'), row('2026-09-08T13:30:00Z'), row('2026-09-09T13:30:00Z')];
  it('aligns to trading dates with exact session ends', () => {
    const { bars } = normalizeBars(raw, 'D', XNYS, at('2026-09-09T15:00:00Z'));
    expect(bars.map((b) => b.label)).toEqual(['2026-09-03', '2026-09-04', '2026-09-08', '2026-09-09']);
    expect(new Date(bars[3]!.end * 1000).toISOString()).toBe('2026-09-09T20:00:00.000Z');
  });
  it('marks the forming bar incomplete until close + grace', () => {
    const mid = normalizeBars(raw, 'D', XNYS, at('2026-09-09T15:00:00Z')).bars;
    expect(mid.map((b) => b.complete)).toEqual([true, true, true, false]);
    const justAfter = normalizeBars(raw, 'D', XNYS, at('2026-09-09T20:05:00Z')).bars;
    expect(justAfter[3]!.complete).toBe(false);
    const later = normalizeBars(raw, 'D', XNYS, at('2026-09-09T20:00:00Z') + COMPLETION_GRACE_S).bars;
    expect(later[3]!.complete).toBe(true);
  });
  it('drops malformed and off-calendar rows with a warning', () => {
    const bad = [...raw, { ...row('2026-09-10T13:30:00Z'), h: 90 }, row('2026-09-07T13:30:00Z') /* Labor Day */, { ...row('2026-09-11T13:30:00Z'), c: NaN }];
    const r = normalizeBars(bad, 'D', XNYS, at('2026-09-12T00:00:00Z'));
    expect(r.bars).toHaveLength(4);
    expect(r.dropped).toBe(3);
    expect(r.warnings[0]).toMatch(/3 malformed/);
  });
});

describe('normalizeBars — weekly/monthly provider quirks', () => {
  it('merges a trailing "live" row into its week, keeping the latest', () => {
    const raw = [row('2026-08-31T13:30:00Z', 100), row('2026-09-08T13:30:00Z', 101), row('2026-09-10T17:42:00Z', 105)];
    const { bars } = normalizeBars(raw, 'W', XNYS, at('2026-09-10T18:00:00Z'));
    expect(bars.map((b) => b.label)).toEqual(['wk 2026-08-31', 'wk 2026-09-07']);
    expect(bars[1]!.c).toBe(105);
    expect(bars.map((b) => b.complete)).toEqual([true, false]);
  });
  it('a month is complete only after its last session closes', () => {
    const raw = [row('2026-08-03T13:30:00Z'), row('2026-09-01T13:30:00Z')];
    expect(normalizeBars(raw, 'M', XNYS, at('2026-09-30T19:00:00Z')).bars.map((b) => b.complete)).toEqual([true, false]);
    expect(normalizeBars(raw, 'M', XNYS, at('2026-10-01T12:00:00Z')).bars.map((b) => b.complete)).toEqual([true, true]);
  });
});

describe('normalizeBars — intraday', () => {
  it('last hourly bar ends at the session close, not start + 60m', () => {
    const { bars } = normalizeBars([row('2026-09-09T19:30:00Z')], '1H', XNYS, at('2026-09-09T19:45:00Z'));
    expect(new Date(bars[0]!.end * 1000).toISOString()).toBe('2026-09-09T20:00:00.000Z');
    expect(bars[0]!.label).toBe('2026-09-09 15:30');
  });
});

describe('confirmedIndexAt / displayRef', () => {
  const raw = [row('2026-09-02T13:30:00Z'), row('2026-09-03T13:30:00Z'), row('2026-09-04T13:30:00Z')];
  const { bars } = normalizeBars(raw, 'D', XNYS, at('2026-09-05T00:00:00Z'));
  it('as-of picks the last bar complete at that instant', () => {
    expect(confirmedIndexAt(bars, null)).toBe(2);
    expect(confirmedIndexAt(bars, at('2026-09-04T15:00:00Z'))).toBe(1);
    expect(confirmedIndexAt(bars, at('2026-09-01T00:00:00Z'))).toBe(-1);
  });
  it('names the next display bar via the calendar (over Labor Day)', () => {
    expect(displayRef(bars, 3, 'D', XNYS)!.label).toBe('2026-09-08');
    expect(displayRef(bars, 1, 'D', XNYS)!.label).toBe('2026-09-03');
  });
  it('refuses to name an intraday bar across a session boundary', () => {
    const h = normalizeBars([row('2026-09-09T19:30:00Z')], '1H', XNYS, at('2026-09-10T00:00:00Z')).bars;
    expect(displayRef(h, 1, '1H', XNYS)).toBeNull();
  });
});
