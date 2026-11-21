/**
 * Market Profile (TPO) levels — a separate level source from the Drummond
 * candidates. Never merged into or substituted for a DG line.
 *
 * Each intraday bar is one TPO period. A bar contributes one TPO to every
 * price row its [low, high] range touches (rows are multiples of rowSize; a
 * bar narrower than one row contributes to the row nearest its close).
 *
 * POC: row with the most TPOs; ties → nearest the profile's mid-range, then the
 * lower price (deterministic).
 * Value area: standard dual-row auction from the POC — compare the next two rows
 * above with the next two below, add the larger pair, repeat until ≥ 70% of TPOs.
 * Equal pairs add both sides.
 */
export const PROFILE_VERSION = 'profile-tpo@1';

export interface ProfileBar {
  readonly h: number;
  readonly l: number;
  readonly c: number;
}

export interface Profile {
  poc: number;
  vah: number;
  val: number;
  tpos: number;
  rows: number;
  periods: number;
}

const EPS = 1e-9;

export function computeProfile(bars: readonly ProfileBar[], rowSize: number, valueAreaPct = 0.7): Profile | null {
  if (!(rowSize > 0)) throw new RangeError('rowSize must be positive');
  if (!(valueAreaPct > 0 && valueAreaPct <= 1)) throw new RangeError('valueAreaPct must be in (0, 1]');
  if (bars.length === 0) return null;

  const counts = new Map<number, number>();
  for (const b of bars) {
    const r = rowRange(b, rowSize);
    if (!r) continue;
    for (let k = r[0]; k <= r[1]; k++) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  const keys = [...counts.keys()].sort((a, b) => a - b);
  const minK = keys[0]!, maxK = keys[keys.length - 1]!;
  const va = valueArea((k) => counts.get(k) ?? 0, minK, maxK, valueAreaPct);
  return { poc: rowPrice(va.poc, rowSize), vah: rowPrice(va.up, rowSize), val: rowPrice(va.dn, rowSize), tpos: va.total, rows: maxK - minK + 1, periods: bars.length };
}

/** Rows [lo, hi] (as multiples of rowSize) a bar touches; a sub-row bar takes the row nearest its close. Null for a broken bar. */
export function rowRange(b: ProfileBar, rowSize: number): [number, number] | null {
  if (!(b.h >= b.l)) return null;
  let lo = Math.ceil(b.l / rowSize - EPS);
  let hi = Math.floor(b.h / rowSize + EPS);
  if (hi < lo) lo = hi = Math.round(b.c / rowSize);
  return [lo, hi];
}

export const rowPrice = (k: number, rowSize: number) => Number((k * rowSize).toFixed(10));

/**
 * POC and value area over rows minK..maxK, weighted by `at(k)` (TPO count or volume).
 * POC ties → nearest mid-range, then lower. Expansion: 'two' compares the next two rows
 * on each side (standard), 'one' compares single rows; equal sides add both.
 */
export function valueArea(at: (k: number) => number, minK: number, maxK: number, pct: number, method: 'two' | 'one' = 'two'): { poc: number; up: number; dn: number; total: number } {
  const mid = (minK + maxK) / 2;
  let poc = minK, total = 0;
  for (let k = minK; k <= maxK; k++) {
    total += at(k);
    const better = at(k) > at(poc) || (at(k) === at(poc) && (Math.abs(k - mid) < Math.abs(poc - mid) - EPS));
    if (better) poc = k;
  }
  const n = method === 'two' ? 2 : 1;
  const target = pct * total;
  let up = poc, dn = poc, inside = at(poc);
  while (inside < target - EPS && (up < maxK || dn > minK)) {
    let above = 0, below = 0;
    for (let i = 1; i <= n; i++) { if (up + i <= maxK) above += at(up + i); if (dn - i >= minK) below += at(dn - i); }
    const canUp = up < maxK, canDn = dn > minK;
    const takeUp = canUp && (!canDn || above >= below);
    const takeDn = canDn && (!canUp || below >= above);
    if (takeUp) { const step = Math.min(n, maxK - up); for (let i = 1; i <= step; i++) inside += at(up + i); up += step; }
    if (takeDn) { const step = Math.min(n, dn - minK); for (let i = 1; i <= step; i++) inside += at(dn - i); dn -= step; }
  }
  return { poc, up, dn, total };
}

/**
 * Default row size: a "nice" multiple of tick near 0.05% of price, so a
 * session profile lands at a readable resolution for any instrument.
 */
export function defaultRowSize(price: number, tick: number): number {
  if (!(tick > 0)) throw new RangeError('tick must be positive');
  const raw = Math.max(tick, Math.abs(price) * 0.0005);
  const steps = [1, 2, 2.5, 4, 5, 10];
  const mult = raw / tick;
  const mag = 10 ** Math.floor(Math.log10(mult));
  const nice = steps.map((s) => s * mag).find((s) => s >= mult - EPS) ?? 10 * mag;
  return Number((Math.max(1, Math.round(nice)) * tick).toFixed(10));
}
