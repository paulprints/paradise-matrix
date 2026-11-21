import { describe, expect, it } from 'vitest';
import { normalizeBars } from '../src/data/bars.ts';
import { XNYS } from '../src/data/calendar.ts';
import { createMarket } from '../src/data/market.ts';
import { staticProvider } from '../src/data/providers.ts';
import { resolveInstrument } from '../src/data/instruments.ts';
import { profilePeriods } from '../src/levels.ts';
import { computeTpo, fourHourBlocks } from '../src/tpo.ts';
import { aggregate, at, syntheticIntraday } from './helpers.ts';

const DATES = ['2026-09-03', '2026-09-04', '2026-09-08', '2026-09-09'];
const five = syntheticIntraday(DATES, 5);
const thirty = aggregate(five, 6);
// Hourly bars per session (9:30, 10:30 … 15:30), the way providers deliver them.
const hour = DATES.flatMap((_, d) => { const day = five.slice(d * 78, d * 78 + 78); return [...aggregate(day, 12), ...aggregate(day.slice(72), 6)]; });
const NOW = at('2026-09-09T22:00:00Z'); // after the Sep 9 close
const market = () => createMarket([staticProvider('fx', { 'QQQ:5m': five, 'QQQ:30m': thirty, 'QQQ:1H': hour })], () => NOW);
const run = (extra: object = {}) => computeTpo({ symbol: 'QQQ', session: 'D', block: '30m', ...extra }, { market: market(), now: () => NOW });

describe('/api/tpo', () => {
  it('one daily profile per session, 13 letters of 30m, complete after the close', async () => {
    const r = await run();
    expect(r.profiles.map((p) => p.key)).toEqual(DATES);
    for (const p of r.profiles) {
      expect(p.periods).toHaveLength(13);
      expect(p.complete).toBe(true);
      expect(p.rows.flat().length).toBe(p.tpos);
    }
    expect(r.rowTicks * r.instrument.tick).toBeCloseTo(r.rowSize);
  });

  it('agrees with the Market Profile levels (same rows, same value area)', async () => {
    const r = await run();
    const bars = normalizeBars(thirty, '30m', XNYS, NOW).bars;
    const { periods } = profilePeriods('D', bars, resolveInstrument('QQQ'), NOW, false, bars[bars.length - 1]!.c, 'all');
    for (const pp of periods) {
      const p = r.profiles.find((x) => x.key === pp.key)!;
      expect(Object.fromEntries(pp.values)).toEqual({ VAH: p.vah, POC: p.poc, VAL: p.val });
    }
  });

  it('marks a level touched at the first later block that reaches it, and leaves the latest profile naked', async () => {
    const r = await run();
    const first = r.profiles[0]!, later = normalizeBars(thirty, '30m', XNYS, NOW).bars.filter((b) => b.t >= r.profiles[1]!.start);
    const hit = later.find((b) => b.l <= first.poc && b.h >= first.poc);
    expect(first.touched.poc).toBe(hit?.t ?? null);
    expect(Object.values(r.profiles[r.profiles.length - 1]!.touched).every((v) => v === null)).toBe(true);
  });

  it('honours row ticks, value area, initial balance and profile count', async () => {
    const r = await run({ rowTicks: 25, valueArea: 50, ibMinutes: 90, profiles: 2 });
    expect(r.rowSize).toBeCloseTo(0.25);
    expect(r.profiles).toHaveLength(2);
    const p = r.profiles[0]!;
    const blocks = normalizeBars(thirty, '30m', XNYS, NOW).bars.filter((b) => b.t >= p.start && b.t < p.end).slice(0, 3);
    expect(p.ibHigh).toBe(Math.max(...blocks.map((b) => b.h)));
    expect(p.vah - p.val).toBeLessThan((await run({ rowTicks: 25 })).profiles[2]!.vah - (await run({ rowTicks: 25 })).profiles[2]!.val + 1e-9);
  });

  it('4H blocks start at the open: 2 per regular session', async () => {
    const r = await run({ block: '4H' });
    for (const p of r.profiles) expect(p.periods.map((t) => new Date(t * 1000).toISOString().slice(11, 16))).toEqual(['13:30', '17:30']);
    const blocks = fourHourBlocks(normalizeBars(hour, '1H', XNYS, NOW).bars, XNYS);
    expect(blocks).toHaveLength(DATES.length * 2);
  });

  it('weekly sessions group the days of a week; a week whose history starts mid-week is skipped with a warning', async () => {
    const r = await run({ session: 'W', block: '1H' });
    expect(r.profiles.map((p) => [p.key, p.periods.length])).toEqual([['2026-09-07', 14]]); // Sep 8–9, 7 hourly blocks a day
    expect(r.warnings.join(' ')).toMatch(/2026-08-31: history starts mid-session; skipped/);
  });
});

describe('/api/tpo limits', () => {
  it('refuses a row height that would take too long to build, instead of blocking the server', async () => {
    // BTC-sized prices (same shape ×100): a 1-tick row means ~150k rows a day.
    const wide = five.map((b) => ({ ...b, o: b.o * 100, h: b.h * 100, l: b.l * 100, c: b.c * 100 }));
    const m = () => createMarket([staticProvider('fx', { 'QQQ:5m': wide })], () => NOW);
    const go = (extra: object) => computeTpo({ symbol: 'QQQ', session: 'D', block: '5m', ...extra }, { market: m(), now: () => NOW });
    await expect(go({ rowTicks: 1 })).rejects.toThrow(/too small/);
    expect((await go({})).profiles).toHaveLength(DATES.length); // automatic rows are fine
  });
  it('reports the initial balance it actually used when blocks cannot fit the minutes asked for', async () => {
    const r = await run({ block: '4H', ibMinutes: 60 });
    expect(r.ibMinutes).toBe(240);
    expect(r.warnings.join(' ')).toMatch(/initial balance is 240 min/);
    expect((await run({ block: '30m', ibMinutes: 60 })).warnings.join(' ')).not.toMatch(/initial balance/);
  });
  it('builds only the newest profiles asked for', async () => {
    const r = await run({ profiles: 2 });
    expect(r.profiles.map((p) => p.key)).toEqual(DATES.slice(-2));
  });
});
