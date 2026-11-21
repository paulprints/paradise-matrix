/**
 * Time ↔ chart-index mapping. Lightweight Charts places bar i at logical index i
 * (spanning i−0.5 … i+0.5) and collapses gaps (nights, weekends). Levels and
 * drawings live in real time, so we convert:
 *   - inside a bar: proportional position within the bar
 *   - inside a gap: the gap collapses to the boundary between the two bars
 *   - before the first bar: linear extrapolation by bar span
 *   - after the last bar: by bar span too, but counting only time some level
 *     covers (`open`, the level timeline). Closed hours (nights, weekends) have
 *     no level window, so they collapse like past gaps and the next session
 *     sits right after the last bar. Past the last window: linear again.
 */

/** Sorted, non-overlapping windows (the level timeline). */
export type Windows = readonly { from: number; to: number }[];

/** First window ending after t (windows are sorted), so future lookups skip the history. */
function firstEndingAfter(open: Windows, t: number): number {
  let lo = 0, hi = open.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (open[mid]!.to <= t) lo = mid + 1; else hi = mid; }
  return lo;
}

/** Seconds of [a, b] inside the windows, plus everything after the last window ends. */
function openSeconds(open: Windows, a: number, b: number): number {
  let s = 0;
  for (let k = firstEndingAfter(open, a); k < open.length; k++) {
    const w = open[k]!;
    if (w.from >= b) break;
    s += Math.min(b, w.to) - Math.max(a, w.from);
  }
  const end = open.length ? open[open.length - 1]!.to : -Infinity;
  return s + Math.max(0, b - Math.max(a, end));
}

/** The time at which `need` open seconds have passed since `a` (inverse of openSeconds). */
function afterOpen(open: Windows, a: number, need: number): number {
  let left = need;
  for (let k = firstEndingAfter(open, a); k < open.length; k++) {
    const w = open[k]!;
    const from = Math.max(a, w.from), len = w.to - from;
    if (left <= len) return from + left;
    left -= len;
  }
  return Math.max(a, open.length ? open[open.length - 1]!.to : a) + left;
}

/** Index of the last bar starting at or before t; −1 if none. */
export function barIndexAt(times: readonly number[], t: number): number {
  let lo = 0, hi = times.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export function timeToLogical(times: readonly number[], span: number, t: number, open?: Windows): number {
  const n = times.length;
  if (!n) return 0;
  const i = barIndexAt(times, t);
  if (i < 0) return (t - times[0]!) / span - 0.5;
  const frac = (t - times[i]!) / span;
  if (i < n - 1) return i - 0.5 + Math.min(1, frac);
  const lastEnd = times[n - 1]! + span;
  if (!open?.length || t <= lastEnd) return n - 1.5 + frac;
  return n - 0.5 + openSeconds(open, lastEnd, t) / span;
}

export function logicalToTime(times: readonly number[], span: number, logical: number, open?: Windows): number {
  const n = times.length;
  if (!n) return 0;
  const i = Math.round(logical);
  if (i < 0) return times[0]! + (logical + 0.5) * span; // extrapolate left of the first bar
  if (logical > n - 0.5 && open?.length) return afterOpen(open, times[n - 1]! + span, (logical - (n - 0.5)) * span); // future: open time only
  if (i > n - 1) return times[n - 1]! + (logical - (n - 1) + 0.5) * span; // into the future
  return times[i]! + (logical - (i - 0.5)) * span;
}

/** Median spacing between consecutive bars (robust to session gaps). */
export function barSpan(times: readonly number[], fallback = 60): number {
  if (times.length < 2) return fallback;
  const d: number[] = [];
  for (let i = Math.max(1, times.length - 200); i < times.length; i++) d.push(times[i]! - times[i - 1]!);
  d.sort((a, b) => a - b);
  return d[d.length >> 1]! || fallback;
}
