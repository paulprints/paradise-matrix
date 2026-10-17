/**
 * The bar contract. Providers hand over raw rows; this module turns them into
 * period-aligned bars with explicit start/end and completeness, judged against
 * the exchange calendar at a given instant.
 */
import type { Timeframe } from '@paradise/contract';
import type { EngineBar } from '@paradise/engine';
import { INTRADAY_SECONDS, nextPeriodKey, nextTradingDay, periodBounds, periodKeyOf, periodLabel, type ExchangeCalendar } from './calendar.ts';

export interface RawBar {
  t: number; o: number; h: number; l: number; c: number; v: number;
  /** Set by a provider when a field came from somewhere other than the bar row itself. */
  note?: string;
}

export interface Bar extends EngineBar {
  readonly key: string;
  readonly label: string;
  /** Instant (unix s) from which the bar counts as final: end + graceFor(tf). */
  readonly ready: number;
}

export interface NormalizeResult { bars: Bar[]; dropped: number; warnings: string[] }

/** Daily/weekly/monthly feeds settle late: wait 15 minutes after the close. */
export const COMPLETION_GRACE_S = 15 * 60;

/**
 * Grace before a bar counts as final. Intraday bars settle within seconds; a
 * 15-minute grace there would hold a 5m chart three bars behind.
 */
export function graceFor(tf: Timeframe): number {
  const span = INTRADAY_SECONDS[tf];
  return span ? Math.min(60, span / 4) : COMPLETION_GRACE_S;
}

const finite = (r: RawBar) => [r.t, r.o, r.h, r.l, r.c].every((x) => typeof x === 'number' && Number.isFinite(x));
const sane = (r: RawBar) => r.h >= r.l && r.h >= Math.min(r.o, r.c) && r.l <= Math.max(r.o, r.c) && r.l > 0;

export function normalizeBars(raw: readonly RawBar[], tf: Timeframe, cal: ExchangeCalendar, now: number): NormalizeResult {
  const warnings: string[] = [];
  let dropped = 0;
  const byKey = new Map<string, { r: RawBar; start: number; end: number; key: string }>();

  for (const r of [...raw].sort((a, b) => a.t - b.t)) {
    if (!finite(r) || !sane(r)) { dropped++; continue; }
    let key: string, start: number, end: number;
    if (tf === 'D' || tf === 'W' || tf === 'M') {
      key = periodKeyOf(cal, tf, r.t);
      const b = periodBounds(cal, tf, key);
      if (!b) { dropped++; continue; } // a row on a non-trading period
      ({ start, end } = b);
    } else {
      const span = INTRADAY_SECONDS[tf]!;
      start = r.t;
      key = String(start);
      const sessionEnd = cal.sessionClose(cal.sessionDateOf(start));
      end = Math.min(start + span, sessionEnd > start ? sessionEnd : start + span);
    }
    // Two rows in one period (e.g. a provider's trailing "live" row): keep the later one.
    const prev = byKey.get(key);
    if (!prev || r.t >= prev.r.t) byKey.set(key, { r, start, end, key });
  }
  if (dropped) warnings.push(`${dropped} malformed or off-calendar ${tf} row(s) dropped`);
  for (const { r, key } of byKey.values()) if (r.note) warnings.push(`${tf} ${periodLabel(tf, key, cal, r.t)}: ${r.note}`);

  const grace = graceFor(tf);
  const bars = [...byKey.values()]
    .sort((a, b) => a.start - b.start)
    .map(({ r, start, end, key }) => ({
      key, t: start, end, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v || 0,
      ready: end + grace,
      complete: now >= end + grace,
      label: periodLabel(tf, key, cal, start),
    }));

  // Completeness is monotonic: anything before a complete bar is complete.
  let seen = false, repaired = false;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i]!.complete) seen = true;
    else if (seen) { bars[i] = { ...bars[i]!, complete: true }; repaired = true; }
  }
  if (repaired) warnings.push('completeness ordering repaired');
  return { bars, dropped, warnings };
}

/** Index of the last bar complete at `asOf` (unix s). −1 when none. */
export function confirmedIndexAt(bars: readonly Bar[], asOf: number | null): number {
  for (let i = bars.length - 1; i >= 0; i--) {
    const b = bars[i]!;
    if (asOf === null ? b.complete : b.ready <= asOf && b.complete) return i;
  }
  return -1;
}

/**
 * Name the display bar at `index`, which may be past the data, with its time window.
 * D/W/M: the next calendar periods. Intraday: steps bar by bar, rolling into the next
 * trading session's open at a session close. Null when there is nothing to anchor to.
 */
export function displayRef(bars: readonly Bar[], index: number, tf: Timeframe, cal: ExchangeCalendar): { time: number; end: number; label: string } | null {
  const b = bars[index];
  if (b) return { time: b.t, end: b.end, label: b.label };
  const last = bars[bars.length - 1];
  if (!last || index < 0) return null;
  const k = index - (bars.length - 1);
  if (tf === 'D' || tf === 'W' || tf === 'M') {
    const key = nextPeriodKey(cal, tf, last.key, k);
    const bounds = periodBounds(cal, tf, key);
    return bounds ? { time: bounds.start, end: bounds.end, label: periodLabel(tf, key, cal, bounds.start) } : null;
  }
  const span = INTRADAY_SECONDS[tf]!;
  let t = last.t;
  for (let n = 0; n < k; n++) {
    const date = cal.sessionDateOf(t);
    const next = t + span;
    t = next < cal.sessionClose(date) ? next : cal.sessionOpen(nextTradingDay(cal, date));
  }
  const close = cal.sessionClose(cal.sessionDateOf(t));
  return { time: t, end: Math.min(t + span, close > t ? close : t + span), label: periodLabel(tf, String(t), cal, t) };
}
