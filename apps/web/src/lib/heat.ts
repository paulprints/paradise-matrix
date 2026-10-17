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
      const k = kernel((price - l.price) / bandwidth);
      if (k <= 0) continue;
      const w = TF_WEIGHT[l.tf] * k * (l.basis === 'developing' ? 0.5 : 1);
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
