/**
 * SECURE — server only.
 *
 * Turns one timeframe's bars into levels for a display bar, following the
 * audit's source/display contract:
 *
 *   source_index = display_index − displacement
 *
 * Confirmed levels use the last complete source bar; developing levels use the
 * forming bar and are provisional. This module never decides completeness and
 * never invents calendar dates — the caller supplies both.
 */
import { CORE_KEYS, ENGINE_VERSION, evaluate, pivotAt, TOLERANCE, WARMUP_INDEX, type Availability, type Family, type Hlc } from './formulas.ts';

export interface EngineBar extends Hlc {
  readonly o: number;
  readonly v: number;
  /** Period start, unix seconds. */
  readonly t: number;
  /** Period end, unix seconds (session close for D, last session close for W/M). */
  readonly end: number;
  readonly complete: boolean;
}

export type Basis = 'confirmed' | 'developing';

export interface EngineLevel {
  readonly plot: string;
  readonly family: Family;
  readonly side?: 'buy' | 'sell';
  readonly state: Availability;
  /** Unrounded; null unless active. */
  readonly price: number | null;
  readonly basis: Basis;
  readonly sourceIndex: number;
  /** May equal bars.length (the next, not-yet-existing bar). */
  readonly displayIndex: number;
  readonly displacement: 0 | 1;
  readonly provenance: string;
}

export interface FrameFactsRaw {
  /** Count of the seven core levels strictly below the latest price: 0..7. */
  locationBand: number | null;
  pivotDirection: { sign: -1 | 0 | 1; bars: number } | null;
  closesVsPivot: { side: 'above' | 'below' | 'on'; bars: number } | null;
}

export interface EngineFrame {
  readonly sourceIndex: number | null;
  readonly displayIndex: number | null;
  readonly developingIndex: number | null;
  readonly atr: number | null;
  readonly facts: FrameFactsRaw;
  readonly levels: EngineLevel[];
  readonly warnings: string[];
}

export interface FrameInput {
  readonly bars: readonly EngineBar[];
  readonly displacement: 0 | 1;
  /** Last bar the caller certifies as complete (as of the request instant). −1 if none. */
  readonly confirmedIndex: number;
  /** Forming bar to compute developing levels from, or null. Must be > confirmedIndex. */
  readonly developingIndex: number | null;
  /** Latest price for location facts; null to skip. */
  readonly lastPrice: number | null;
}

const ATR_BARS = 14;
const RUN_CAP = 50;

export function levelsAt(bars: readonly Hlc[], sourceIndex: number, basis: Basis, displacement: 0 | 1): EngineLevel[] {
  return evaluate(bars, sourceIndex).map((v) => ({
    plot: v.spec.key,
    family: v.spec.family,
    ...(v.spec.side ? { side: v.spec.side } : {}),
    state: v.state,
    price: v.state === 'active' ? v.candidate : null,
    basis,
    sourceIndex,
    displayIndex: sourceIndex + displacement,
    displacement,
    provenance: ENGINE_VERSION,
  }));
}

/** Mean true range of up to 14 bars ending at `end` (inclusive). */
export function averageTrueRange(bars: readonly Hlc[], end: number, n = ATR_BARS): number | null {
  if (end < 1) return null;
  let sum = 0, count = 0;
  for (let i = end; i >= 1 && count < n; i--) {
    const b = bars[i]!, p = bars[i - 1]!;
    sum += Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c));
    count++;
  }
  return count ? sum / count : null;
}

function sign(x: number): -1 | 0 | 1 {
  return x > TOLERANCE ? 1 : x < -TOLERANCE ? -1 : 0;
}

export function pivotDirection(bars: readonly Hlc[], s: number): FrameFactsRaw['pivotDirection'] {
  const d0 = (i: number) => {
    const a = pivotAt(bars, i), b = pivotAt(bars, i - 1);
    return a === null || b === null ? null : sign(a - b);
  };
  const first = d0(s);
  if (first === null) return null;
  if (first === 0) return { sign: 0, bars: 0 };
  let run = 0;
  for (let i = s; run < RUN_CAP; i--) {
    if (d0(i) !== first) break;
    run++;
  }
  return { sign: first, bars: run };
}

/** Closes compared with the pivot drawn on their own bar: P(i − displacement). */
export function closesVsPivot(bars: readonly Hlc[], s: number, displacement: 0 | 1): FrameFactsRaw['closesVsPivot'] {
  const sideAt = (i: number): 'above' | 'below' | 'on' | null => {
    const p = pivotAt(bars, i - displacement);
    if (p === null) return null;
    const k = sign(bars[i]!.c - p);
    return k > 0 ? 'above' : k < 0 ? 'below' : 'on';
  };
  const first = sideAt(s);
  if (!first) return null;
  let run = 0;
  for (let i = s; run < RUN_CAP; i--) {
    if (sideAt(i) !== first) break;
    run++;
  }
  return { side: first, bars: run };
}

export function locationBand(levels: readonly EngineLevel[], price: number): number | null {
  const core = levels.filter((l) => CORE_KEYS.includes(l.plot) && l.price !== null);
  if (core.length !== CORE_KEYS.length) return null;
  return core.filter((l) => (l.price as number) < price).length;
}

export function buildFrame(input: FrameInput): EngineFrame {
  const { bars, displacement, confirmedIndex, developingIndex, lastPrice } = input;
  const warnings: string[] = [];
  if (displacement !== 0 && displacement !== 1) throw new TypeError('displacement must be 0 or 1');
  if (confirmedIndex >= bars.length) throw new RangeError('confirmedIndex beyond bars');
  if (developingIndex !== null && (developingIndex <= confirmedIndex || developingIndex >= bars.length)) {
    throw new RangeError('developingIndex must be a forming bar after confirmedIndex');
  }

  const levels: EngineLevel[] = [];
  let sourceIndex: number | null = null;
  if (confirmedIndex >= WARMUP_INDEX) {
    sourceIndex = confirmedIndex;
    levels.push(...levelsAt(bars, sourceIndex, 'confirmed', displacement));
  } else {
    warnings.push(`needs ${WARMUP_INDEX + 1} complete bars, have ${Math.max(0, confirmedIndex + 1)}`);
  }

  let devIndex: number | null = null;
  if (developingIndex !== null && developingIndex >= WARMUP_INDEX) {
    devIndex = developingIndex;
    levels.push(...levelsAt(bars, devIndex, 'developing', displacement));
  }

  const confirmed = levels.filter((l) => l.basis === 'confirmed');
  const facts: FrameFactsRaw = {
    locationBand: sourceIndex !== null && lastPrice !== null ? locationBand(confirmed, lastPrice) : null,
    pivotDirection: sourceIndex !== null ? pivotDirection(bars, sourceIndex) : null,
    closesVsPivot: sourceIndex !== null ? closesVsPivot(bars, sourceIndex, displacement) : null,
  };

  return {
    sourceIndex,
    displayIndex: sourceIndex === null ? null : sourceIndex + displacement,
    developingIndex: devIndex,
    atr: sourceIndex === null ? null : averageTrueRange(bars, sourceIndex),
    facts,
    levels,
    warnings,
  };
}
