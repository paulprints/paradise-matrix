import { describe, expect, it } from 'vitest';
import { CME_EQUITY, CRYPTO_UTC, XNYS, nextPeriodKey, nextTradingDay, periodBounds, periodKeyOf, weekKey } from '../src/data/calendar.ts';
import { iso, zonedToUnix } from '../src/data/time.ts';
import { normalizeBars } from '../src/data/bars.ts';

const at = (s: string) => Date.parse(s) / 1000;

describe('XNYS', () => {
  it('knows holidays and weekends', () => {
    expect(XNYS.isTradingDay('2026-04-03')).toBe(false); // Good Friday
    expect(XNYS.isTradingDay('2026-07-03')).toBe(false); // Independence Day observed
    expect(XNYS.isTradingDay('2026-07-04')).toBe(false); // Saturday
    expect(XNYS.isTradingDay('2026-09-08')).toBe(true);
    expect(XNYS.isTradingDay('2027-12-24')).toBe(false);
  });
  it('closes at 16:00 ET across DST, 13:00 on early-close days', () => {
    expect(iso(XNYS.sessionClose('2026-01-05'))).toBe('2026-01-05T21:00:00.000Z');
    expect(iso(XNYS.sessionClose('2026-09-08'))).toBe('2026-09-08T20:00:00.000Z');
    expect(iso(XNYS.sessionClose('2026-11-27'))).toBe('2026-11-27T18:00:00.000Z');
    expect(iso(XNYS.sessionOpen('2026-03-09'))).toBe('2026-03-09T13:30:00.000Z'); // first day of EDT
    expect(iso(XNYS.sessionOpen('2026-03-06'))).toBe('2026-03-06T14:30:00.000Z');
  });
  it('steps to the next trading day over weekends and holidays', () => {
    expect(nextTradingDay(XNYS, '2026-04-02')).toBe('2026-04-06');
    expect(nextPeriodKey(XNYS, 'D', '2026-09-04')).toBe('2026-09-08'); // Labor Day
  });
  it('weekly period ends at the last trading day (holiday Friday)', () => {
    expect(weekKey('2026-04-02')).toBe('2026-03-30');
    const b = periodBounds(XNYS, 'W', '2026-03-30')!;
    expect(iso(b.end)).toBe('2026-04-02T20:00:00.000Z');
  });
  it('monthly period runs first to last trading day', () => {
    const b = periodBounds(XNYS, 'M', '2026-01')!;
    expect(iso(b.start)).toBe('2026-01-02T14:30:00.000Z');
    expect(iso(b.end)).toBe('2026-01-30T21:00:00.000Z');
    expect(nextPeriodKey(XNYS, 'M', '2026-12')).toBe('2027-01');
  });
  it('maps instants to period keys', () => {
    expect(periodKeyOf(XNYS, 'W', at('2026-09-10T15:00:00Z'))).toBe('2026-09-07');
    expect(periodKeyOf(XNYS, 'M', at('2026-09-10T15:00:00Z'))).toBe('2026-09');
  });
});

describe('CME equity (approximate)', () => {
  it('evening session belongs to the next trading date', () => {
    expect(CME_EQUITY.sessionDateOf(zonedToUnix('2026-09-21', 18, 0, 'America/Chicago'))).toBe('2026-09-22');
    expect(CME_EQUITY.sessionDateOf(zonedToUnix('2026-09-25', 18, 0, 'America/Chicago'))).toBe('2026-09-28'); // Fri eve → Mon
    expect(CME_EQUITY.sessionDateOf(zonedToUnix('2026-09-22', 10, 0, 'America/Chicago'))).toBe('2026-09-22');
  });
  it('Monday opens Sunday 17:00 CT and closes 16:00 CT', () => {
    expect(iso(CME_EQUITY.sessionOpen('2026-09-21'))).toBe('2026-09-20T22:00:00.000Z');
    expect(iso(CME_EQUITY.sessionClose('2026-09-21'))).toBe('2026-09-21T21:00:00.000Z');
  });
  it('is flagged approximate', () => expect(CME_EQUITY.fidelity).toBe('approximate'));
});

describe('CRYPTO_UTC', () => {
  it('trades every day, 00:00–24:00 UTC', () => {
    expect(CRYPTO_UTC.isTradingDay('2026-11-21')).toBe(true); // Saturday
    expect(CRYPTO_UTC.isTradingDay('2026-12-25')).toBe(true);
    expect(iso(CRYPTO_UTC.sessionOpen('2026-11-21'))).toBe('2026-11-21T00:00:00.000Z');
    expect(iso(CRYPTO_UTC.sessionClose('2026-11-21'))).toBe('2026-11-22T00:00:00.000Z');
    expect(CRYPTO_UTC.sessionDateOf(at('2026-11-21T23:59:59Z'))).toBe('2026-11-21');
    expect(nextTradingDay(CRYPTO_UTC, '2026-11-20')).toBe('2026-11-21');
  });
  it('weeks run Monday 00:00 → next Monday 00:00 UTC; months cover every day', () => {
    expect(periodKeyOf(CRYPTO_UTC, 'W', at('2026-11-22T12:00:00Z'))).toBe('2026-11-16'); // Sunday
    const w = periodBounds(CRYPTO_UTC, 'W', '2026-11-16')!;
    expect([iso(w.start), iso(w.end)]).toEqual(['2026-11-16T00:00:00.000Z', '2026-11-23T00:00:00.000Z']);
    const m = periodBounds(CRYPTO_UTC, 'M', '2026-11')!;
    expect([iso(m.start), iso(m.end)]).toEqual(['2026-11-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z']);
  });
  it('keeps weekend daily bars (NYSE hours would drop them)', () => {
    const raw = ['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'].map((d) => ({ t: at(`${d}T00:00:00Z`), o: 1, h: 2, l: 0.5, c: 1.5, v: 1 }));
    const r = normalizeBars(raw, 'D', CRYPTO_UTC, at('2026-11-17T12:00:00Z'));
    expect(r.dropped).toBe(0);
    expect(r.bars.map((b) => b.complete)).toEqual([true, true, true, true]);
    expect(normalizeBars(raw, 'D', XNYS, at('2026-11-17T12:00:00Z')).dropped).toBe(2);
  });
});
