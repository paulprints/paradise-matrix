/**
 * Time ↔ chart-index mapping. Lightweight Charts places bar i at logical index i
 * (spanning i−0.5 … i+0.5) and collapses gaps (nights, weekends). Levels and
 * drawings live in real time, so we convert:
 *   - inside a bar: proportional position within the bar
 *   - inside a gap: the gap collapses to the boundary between the two bars
 *   - before the first / after the last bar: linear extrapolation by bar span,
 *     so next-bar levels and drawings can extend into the empty future area.
 */

/** Index of the last bar starting at or before t; −1 if none. */
export function barIndexAt(times: readonly number[], t: number): number {
  let lo = 0, hi = times.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export function timeToLogical(times: readonly number[], span: number, t: number): number {
  const n = times.length;
  if (!n) return 0;
  const i = barIndexAt(times, t);
  if (i < 0) return (t - times[0]!) / span - 0.5;
  const frac = (t - times[i]!) / span;
  return i - 0.5 + (i < n - 1 ? Math.min(1, frac) : frac);
}

export function logicalToTime(times: readonly number[], span: number, logical: number): number {
  const n = times.length;
  if (!n) return 0;
  const i = Math.round(logical);
  if (i < 0) return times[0]! + (logical + 0.5) * span; // extrapolate left of the first bar
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
