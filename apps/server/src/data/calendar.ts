/**
 * Exchange calendars. The data edge — not the engine — decides when a bar is
 * complete, and names the next display bar. Errors are designed to be
 * conservative: an unknown early close means a bar is marked complete later,
 * never earlier.
 */
import type { Timeframe } from '@paradise/contract';
import { addDays, localParts, localYmd, pad, weekdayOf, zonedToUnix } from './time.ts';

export interface ExchangeCalendar {
  readonly id: string;
  readonly fidelity: 'exact' | 'approximate';
  readonly timezone: string;
  readonly session: string;
  /** Years whose holidays are tabulated; outside them only weekday rules apply. */
  readonly coveredYears: readonly [number, number];
  isTradingDay(ymd: string): boolean;
  /** Session close instant (unix s) for a trading date. */
  sessionClose(ymd: string): number;
  /** Session open instant (unix s) for a trading date (may fall on the prior calendar day). */
  sessionOpen(ymd: string): number;
  /** Trading date an instant belongs to (may roll forward for evening sessions). */
  sessionDateOf(sec: number): string;
}

// NYSE full-day closures and 1:00 pm early closes. Source: NYSE holiday schedules.
const XNYS_HOLIDAYS = new Set([
  '2024-01-01', '2024-01-15', '2024-02-19', '2024-03-29', '2024-05-27', '2024-06-19', '2024-07-04', '2024-09-02', '2024-11-28', '2024-12-25',
  '2025-01-01', '2025-01-09', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);
const XNYS_EARLY = new Set(['2024-07-03', '2024-11-29', '2024-12-24', '2025-07-03', '2025-11-28', '2025-12-24', '2026-11-27', '2026-12-24', '2027-11-26']);
const COVERED: readonly [number, number] = [2024, 2027];

const isWeekday = (ymd: string) => { const w = weekdayOf(ymd); return w >= 1 && w <= 5; };

export const XNYS: ExchangeCalendar = {
  id: 'XNYS',
  fidelity: 'exact',
  timezone: 'America/New_York',
  session: 'US equities regular hours 09:30–16:00 ET',
  coveredYears: COVERED,
  isTradingDay: (ymd) => isWeekday(ymd) && !XNYS_HOLIDAYS.has(ymd),
  sessionOpen: (ymd) => zonedToUnix(ymd, 9, 30, 'America/New_York'),
  sessionClose: (ymd) => zonedToUnix(ymd, XNYS_EARLY.has(ymd) ? 13 : 16, 0, 'America/New_York'),
  sessionDateOf: (sec) => localYmd(sec, 'America/New_York'),
};

/**
 * CME equity-index futures, approximated: Globex 17:00 CT (prior day) → 16:00 CT.
 * NYSE holidays are treated as non-trading days (their abbreviated Globex
 * sessions are merged into the next day's bar by most charting templates).
 * CME-specific early halts are NOT modelled → fidelity 'approximate'.
 */
export const CME_EQUITY: ExchangeCalendar = {
  id: 'CME-EQUITY',
  fidelity: 'approximate',
  timezone: 'America/Chicago',
  session: 'CME Globex ETH 17:00–16:00 CT (approximate calendar)',
  coveredYears: COVERED,
  isTradingDay: (ymd) => isWeekday(ymd) && !XNYS_HOLIDAYS.has(ymd),
  sessionOpen(ymd) {
    let prev = addDays(ymd, -1);
    while (!isWeekday(prev) && weekdayOf(prev) !== 0) prev = addDays(prev, -1); // Sunday evening opens Monday
    return zonedToUnix(prev, 17, 0, 'America/Chicago');
  },
  sessionClose: (ymd) => zonedToUnix(ymd, 16, 0, 'America/Chicago'),
  sessionDateOf(sec) {
    const p = localParts(sec, 'America/Chicago');
    let ymd = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
    if (p.h >= 17) ymd = addDays(ymd, 1);
    while (!CME_EQUITY.isTradingDay(ymd)) ymd = addDays(ymd, 1);
    return ymd;
  },
};

export function nextTradingDay(cal: ExchangeCalendar, ymd: string): string {
  let d = addDays(ymd, 1);
  for (let i = 0; i < 15 && !cal.isTradingDay(d); i++) d = addDays(d, 1);
  return d;
}
export function prevTradingDay(cal: ExchangeCalendar, ymd: string): string {
  let d = addDays(ymd, -1);
  for (let i = 0; i < 15 && !cal.isTradingDay(d); i++) d = addDays(d, -1);
  return d;
}

/** Monday of the ISO week containing ymd. */
export const weekKey = (ymd: string) => addDays(ymd, -((weekdayOf(ymd) + 6) % 7));
export const monthKey = (ymd: string) => ymd.slice(0, 7);

export const INTRADAY_SECONDS: Partial<Record<Timeframe, number>> = { '15m': 900, '30m': 1800, '1H': 3600 };
export const isIntraday = (tf: Timeframe) => tf in INTRADAY_SECONDS;

/** Trading dates belonging to a D/W/M period key. */
function periodDays(cal: ExchangeCalendar, tf: 'D' | 'W' | 'M', key: string): string[] {
  if (tf === 'D') return cal.isTradingDay(key) ? [key] : [];
  const days: string[] = [];
  if (tf === 'W') {
    for (let i = 0; i < 5; i++) { const d = addDays(key, i); if (cal.isTradingDay(d)) days.push(d); }
  } else {
    for (let d = `${key}-01`; d.startsWith(key); d = addDays(d, 1)) if (cal.isTradingDay(d)) days.push(d);
  }
  return days;
}

/** Period key for an instant (D: trading date, W: Monday of week, M: YYYY-MM). */
export function periodKeyOf(cal: ExchangeCalendar, tf: 'D' | 'W' | 'M', sec: number): string {
  const ymd = cal.sessionDateOf(sec);
  return tf === 'D' ? ymd : tf === 'W' ? weekKey(ymd) : monthKey(ymd);
}

export function periodBounds(cal: ExchangeCalendar, tf: 'D' | 'W' | 'M', key: string): { start: number; end: number } | null {
  const days = periodDays(cal, tf, key);
  if (!days.length) return null;
  return { start: cal.sessionOpen(days[0]!), end: cal.sessionClose(days[days.length - 1]!) };
}

/** Key of the k-th period after `key` that contains at least one trading day. */
export function nextPeriodKey(cal: ExchangeCalendar, tf: 'D' | 'W' | 'M', key: string, k = 1): string {
  let cur = key;
  for (let n = 0; n < k; n++) {
    for (let guard = 0; guard < 24; guard++) {
      if (tf === 'D') cur = addDays(cur, 1);
      else if (tf === 'W') cur = addDays(cur, 7);
      else { const [y, m] = cur.split('-').map(Number) as [number, number]; cur = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`; }
      if (periodDays(cal, tf, cur).length) break;
    }
  }
  return cur;
}

export function periodLabel(tf: Timeframe, key: string, cal: ExchangeCalendar, start: number): string {
  if (tf === 'D') return key;
  if (tf === 'W') return `wk ${key}`;
  if (tf === 'M') return key;
  const p = localParts(start, cal.timezone);
  return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
}

export function calendarCovers(cal: ExchangeCalendar, sec: number): boolean {
  const y = localParts(sec, cal.timezone).y;
  return y >= cal.coveredYears[0] && y <= cal.coveredYears[1];
}
