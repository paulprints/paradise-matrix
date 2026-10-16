/**
 * SECURE — server only.
 *
 * The 31 public-output hypotheses frozen in the 2026-09-23 audit
 * (fixtures/audit-2026-09-23/research_candidates.py), as one table.
 *
 * Everything is evaluated at RAW SOURCE INDEX n using that bar's OHLC and the
 * four before it. Where a level is *drawn* (displacement) is decided elsewhere
 * and never changes this arithmetic.
 *
 * Keys are the exact vendor plot names, for traceability against captures.
 * They are mapped to public names at the server edge and never sent as-is.
 * The Buy/Sell labels are preserved exactly, even where the arithmetic looks
 * counterintuitive — several families share a price but differ in availability,
 * so they must not be collapsed.
 */

export const FORMULA_VERSION = 'public-output-hypotheses-20260923-v1';
export const ENGINE_VERSION = 'dg-candidate@20260923-v1';

/** Equality margin. An audit uncertainty policy — NOT a claimed vendor epsilon. */
export const TOLERANCE = 1e-8;

/** Minimum index with a full input window (P2 reaches n−4). */
export const WARMUP_INDEX = 4;

export interface Hlc {
  readonly h: number;
  readonly l: number;
  readonly c: number;
}

export interface Ctx {
  H: number; L: number; C: number; H1: number; L1: number;
  /** A_n = (H+L+C)/3 */
  A: number;
  /** P_n = (A_n + A_{n-1} + A_{n-2}) / 3 */
  P: number; P1: number; P2: number;
  /** R = 2P − mean(L_n, L_{n−1}, L_{n−2}) */
  R: number;
  /** S = 2P − mean(H_n, H_{n−1}, H_{n−2}) */
  S: number;
  HH: number; LL: number; PH: number; PL: number;
}

export type Family =
  | 'zones' | 'envelope' | 'pldot' | '1-1' | 'channel'
  | '5-1' | '5-2' | '5-2x' | '5-3' | '5-9' | '5-9x'
  | '6-1' | '6-5' | '6-6' | '6-7';

export interface PlotSpec {
  readonly key: string;
  readonly family: Family;
  readonly side?: 'buy' | 'sell';
  readonly price: (c: Ctx) => number;
  /** Availability margins; every one must be strictly positive. Absent = available after warmup. */
  readonly when?: (c: Ctx) => number[];
}

const sell = 'sell' as const;
const buy = 'buy' as const;

export const PLOTS: readonly PlotSpec[] = [
  // Core / zones (the original seven)
  { key: 'Zone Six Top', family: 'zones', price: (c) => 2 * c.R - c.S },
  { key: 'Zone Five Top', family: 'zones', price: (c) => 2 * c.R - c.P },
  { key: 'Envelope Top', family: 'envelope', price: (c) => c.R },
  { key: 'PLDot', family: 'pldot', price: (c) => c.P },
  { key: 'Envelope Bottom', family: 'envelope', price: (c) => c.S },
  { key: 'Zone Two Bottom', family: 'zones', price: (c) => 2 * c.S - c.P },
  { key: 'Zone One Bottom', family: 'zones', price: (c) => 2 * c.S - c.R },
  // 1-1 and channel
  { key: 'H 1-1', family: '1-1', price: (c) => 2 * c.A - c.L },
  { key: 'L 1-1', family: '1-1', price: (c) => 2 * c.A - c.H },
  { key: '1-1 Dot', family: '1-1', price: (c) => c.A },
  { key: 'Main Channel', family: 'channel', price: (c) => 2 * c.P1 - c.P2 },
  // 5-series
  { key: '5-1 Sell', family: '5-1', side: sell, price: (c) => c.LL, when: (c) => [c.LL - c.C] },
  { key: '5-1 Buy', family: '5-1', side: buy, price: (c) => c.HH, when: (c) => [c.C - c.HH] },
  { key: '5-2 Sell', family: '5-2', side: sell, price: (c) => c.HH, when: (c) => [c.H - c.H1] },
  { key: '5-2 Buy', family: '5-2', side: buy, price: (c) => c.LL, when: (c) => [c.L1 - c.L] },
  { key: '5-2 Ex Sell', family: '5-2x', side: sell, price: (c) => 3 * c.H - 2 * c.H1, when: (c) => [c.H - c.H1] },
  { key: '5-2 Ex Buy', family: '5-2x', side: buy, price: (c) => 3 * c.L - 2 * c.L1, when: (c) => [c.L1 - c.L] },
  { key: '5-3 Sell', family: '5-3', side: sell, price: (c) => c.HH, when: (c) => [c.H1 - c.H, c.HH - c.C] },
  { key: '5-3 Buy', family: '5-3', side: buy, price: (c) => c.LL, when: (c) => [c.L - c.L1, c.C - c.LL] },
  { key: '5-9 Sell', family: '5-9', side: sell, price: (c) => 2 * c.H - c.L1 },
  { key: '5-9 Buy', family: '5-9', side: buy, price: (c) => 2 * c.L - c.H1 },
  { key: '5-9 Ex Sell', family: '5-9x', side: sell, price: (c) => 3 * c.H - 2 * c.L1 },
  { key: '5-9 Ex Buy', family: '5-9x', side: buy, price: (c) => 3 * c.L - 2 * c.H1 },
  // 6-series
  { key: '6-1 Sell', family: '6-1', side: sell, price: (c) => c.PL, when: (c) => [c.H - c.P, c.PL - c.C] },
  { key: '6-1 Buy', family: '6-1', side: buy, price: (c) => c.PH, when: (c) => [c.P - c.L, c.C - c.PH] },
  { key: '6-5 Sell', family: '6-5', side: sell, price: (c) => c.PH, when: (c) => [c.H - c.P, c.PH - c.C] },
  { key: '6-5 Buy', family: '6-5', side: buy, price: (c) => c.PL, when: (c) => [c.P - c.L, c.C - c.PL] },
  { key: '6-6 Sell', family: '6-6', side: sell, price: (c) => 3 * c.H - 2 * c.P2, when: (c) => [c.P2 - c.L, c.H - c.P2] },
  { key: '6-6 Buy', family: '6-6', side: buy, price: (c) => 3 * c.L - 2 * c.P2, when: (c) => [c.P2 - c.L, c.H - c.P2] },
  { key: '6-7 Sell', family: '6-7', side: sell, price: (c) => c.PL, when: (c) => [c.P - c.H] },
  { key: '6-7 Buy', family: '6-7', side: buy, price: (c) => c.PH, when: (c) => [c.L - c.P] },
];

export const PLOT_KEYS: readonly string[] = PLOTS.map((p) => p.key);

/** The seven core/zone outputs that predate the audit's extra 24. */
export const CORE_KEYS: readonly string[] = PLOT_KEYS.slice(0, 7);

/** Build the arithmetic context at raw index n. Throws RangeError without a full window. */
export function context(bars: readonly Hlc[], n: number): Ctx {
  if (!Number.isInteger(n) || n < WARMUP_INDEX || n >= bars.length) {
    throw new RangeError(`index ${n} needs bars ${n - WARMUP_INDEX}..${n} (have 0..${bars.length - 1})`);
  }
  const b = (i: number): Hlc => bars[i] as Hlc;
  const p = (i: number): number => {
    let s = 0;
    for (let j = 0; j < 3; j++) {
      const x = b(i - j);
      s += x.h + x.l + x.c;
    }
    return s / 9;
  };
  const cur = b(n);
  const prev = b(n - 1);
  const H = cur.h, L = cur.l, C = cur.c, H1 = prev.h, L1 = prev.l;
  const P = p(n), P1 = p(n - 1), P2 = p(n - 2);
  const A = (H + L + C) / 3;
  const R = 2 * P - (L + L1 + b(n - 2).l) / 3;
  const S = 2 * P - (H + H1 + b(n - 2).h) / 3;
  return { H, L, C, H1, L1, A, P, P1, P2, R, S, HH: 2 * H - H1, LL: 2 * L - L1, PH: 2 * P - H, PL: 2 * P - L };
}

export type Availability = 'active' | 'inactive' | 'boundary';

/** Audit rule: any margin < −tol → inactive; any |margin| ≤ tol → boundary; else active. */
export function availability(margins: readonly number[], tol = TOLERANCE): Availability {
  if (margins.some((m) => m < -tol)) return 'inactive';
  if (margins.some((m) => Math.abs(m) <= tol)) return 'boundary';
  return 'active';
}

export interface PlotValue {
  readonly spec: PlotSpec;
  readonly state: Availability;
  /** Unrounded candidate price (always computed, even when inactive — callers must respect state). */
  readonly candidate: number;
}

/** Evaluate all 31 plots at raw source index n. */
export function evaluate(bars: readonly Hlc[], n: number): PlotValue[] {
  const c = context(bars, n);
  return PLOTS.map((spec) => ({
    spec,
    state: spec.when ? availability(spec.when(c)) : 'active',
    candidate: spec.price(c),
  }));
}

/** P at index i (exported for facts/heat helpers). */
export function pivotAt(bars: readonly Hlc[], i: number): number | null {
  if (i < 2 || i >= bars.length) return null;
  let s = 0;
  for (let j = 0; j < 3; j++) {
    const x = bars[i - j] as Hlc;
    s += x.h + x.l + x.c;
  }
  return s / 9;
}
