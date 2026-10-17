/**
 * Heat is a VIEW of levels — presentation, not proprietary math. Every band
 * can be traced to the levels that make it up.
 *
 *   score(p) = Σ w(tf) · k(|p − price| / h)       k(u) = (1 − u²)² for |u| < 1
 *
 * h scales with the finest frame's average true range, so it follows the
 * instrument and timeframe, never the tick size. Intensity is score / REF where
 * REF = three coincident levels of the heaviest timeframe in view. It depends
 * only on which frames are shown — never on the data — so a quiet ladder looks
 * quiet: "Terminal" must be earned, it is not guaranteed by normalising to max.
 */
import type { Level, Timeframe } from '@paradise/contract';

export const HEAT_VERSION = 'heat@1';

/** halftone: ink dots sized by intensity. matrix: the v1 colour scale as solid cells. */
export type HeatStyle = 'halftone' | 'matrix';

/** The v1 "Energy Matrix" colour stops (viridis): purple (void) → blue → teal → lime → yellow (terminal). */
export const VIRIDIS: ReadonlyArray<readonly [pos: number, r: number, g: number, b: number]> = [
  [0, 68, 1, 84], [0.25, 59, 82, 139], [0.5, 33, 145, 140], [0.75, 94, 201, 98], [1, 253, 231, 37],
];

/** Colour for intensity t ∈ [0, 1] as [r, g, b]. */
export function viridis(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  for (let i = 0; i < VIRIDIS.length - 1; i++) {
    const [p0, r0, g0, b0] = VIRIDIS[i]!, [p1, r1, g1, b1] = VIRIDIS[i + 1]!;
    if (x <= p1) {
      const u = (x - p0) / (p1 - p0);
      return [Math.round(r0 + (r1 - r0) * u), Math.round(g0 + (g1 - g0) * u), Math.round(b0 + (b1 - b0) * u)];
    }
  }
  const [, r, g, b] = VIRIDIS[VIRIDIS.length - 1]!;
  return [r, g, b];
}

export const viridisCss = (t: number, alpha = 1) => { const [r, g, b] = viridis(t); return `rgba(${r}, ${g}, ${b}, ${alpha})`; };

/** CSS gradient of the scale, for legends. */
export const VIRIDIS_GRADIENT = `linear-gradient(90deg, ${VIRIDIS.map(([p, r, g, b]) => `rgb(${r}, ${g}, ${b}) ${p * 100}%`).join(', ')})`;
export const TF_WEIGHT: Record<Timeframe, number> = { M: 3, W: 2, D: 1, '1H': 0.75, '30m': 0.6, '15m': 0.5, '5m': 0.4, '1m': 0.3 };
/** Coincident levels of the heaviest frame in view that saturate the scale. */
export const REFERENCE_COUNT = 3;
export const KERNEL_ATR_FRACTION = 0.3;

export type Zone = 'terminal' | 'friction' | 'transit' | 'void';
export const ZONES: Record<Zone, { label: string; min: number; meaning: string }> = {
  terminal: { label: 'Terminal', min: 0.85, meaning: 'Heaviest confluence: several weighted levels overlap here.' },
  friction: { label: 'Friction', min: 0.65, meaning: 'Strong overlap of levels.' },
  transit: { label: 'Transit', min: 0.45, meaning: 'Some overlap.' },
  void: { label: 'Void', min: 0, meaning: 'Little confluence: levels here stand mostly alone.' },
};
export const zoneOf = (intensity: number): Zone =>
  intensity >= ZONES.terminal.min ? 'terminal' : intensity >= ZONES.friction.min ? 'friction' : intensity >= ZONES.transit.min ? 'transit' : 'void';

export interface HeatRow {
  price: number;
  score: number;
  /** 0..1 on the fixed reference scale. */
  intensity: number;
  zone: Zone;
  contributors: Array<{ id: string; weight: number }>;
}

export interface HeatInput {
  levels: readonly Level[];
  min: number;
  max: number;
  rows?: number;
  /** Kernel half-width in price units. */
  bandwidth: number;
}

const kernel = (u: number) => (Math.abs(u) >= 1 ? 0 : (1 - u * u) ** 2);

/** Weight one level contributes at `price`. Shared by the ladder and the chart. */
export function contribution(tf: Timeframe, developing: boolean, levelPrice: number, price: number, bandwidth: number): number {
  const k = kernel((price - levelPrice) / bandwidth);
  return k <= 0 ? 0 : TF_WEIGHT[tf] * k * (developing ? 0.5 : 1);
}

export function computeHeat({ levels, min, max, rows = 200, bandwidth }: HeatInput): HeatRow[] {
  if (!(max > min) || !(bandwidth > 0) || rows < 2) return [];
  const priced = levels.filter((l): l is Level & { price: number } => l.state === 'active' && l.price !== null);
  const step = (max - min) / (rows - 1);
  const reference = referenceScore(priced);
  const out: HeatRow[] = [];
  for (let i = rows - 1; i >= 0; i--) {
    const price = min + i * step;
    let score = 0;
    const contributors: HeatRow['contributors'] = [];
    for (const l of priced) {
      const w = contribution(l.tf, l.basis === 'developing', l.price, price, bandwidth);
      if (w <= 0) continue;
      score += w;
      contributors.push({ id: l.id, weight: w });
    }
    contributors.sort((a, b) => b.weight - a.weight);
    const intensity = reference > 0 ? Math.min(1, score / reference) : 0;
    out.push({ price, score, intensity, zone: zoneOf(intensity), contributors });
  }
  return out;
}

export function referenceScore(levels: readonly Pick<Level, 'tf'>[]): number {
  let heaviest = 0;
  for (const l of levels) heaviest = Math.max(heaviest, TF_WEIGHT[l.tf]);
  return REFERENCE_COUNT * heaviest;
}

export function bandwidthFor(atr: number | null | undefined, span: number): number {
  return atr && atr > 0 ? atr * KERNEL_ATR_FRACTION : span / 40;
}
