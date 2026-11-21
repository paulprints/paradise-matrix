/**
 * TPO chart settings (kept per browser, like chart preferences) and small
 * presentation helpers. The profile arithmetic lives on the server (/api/tpo).
 */
import type { TpoBlockSize } from '@paradise/contract';

export interface TpoSettings {
  session: 'D' | 'W' | 'M';
  block: TpoBlockSize;
  /** null = automatic row height. */
  rowTicks: number | null;
  valueArea: number;
  vaMethod: 'two' | 'one';
  ibMinutes: number;
  display: 'blocks+letters' | 'letters' | 'blocks';
  /** Letters outside the value area: one flat colour (true) or faded (false). */
  outsideVaFlat: boolean;
  poc: boolean;
  va: boolean;
  fillVa: boolean;
  ibRange: boolean;
  singles: boolean;
  poorExtremes: boolean;
  nakedPoc: boolean;
  nakedVa: boolean;
  labels: boolean;
  /** Hide the candles so the letters read cleanly (OpenMarket's "Hide bars"). */
  hideCandles: boolean;
  /** Gap between neighbouring profiles, px. */
  spacing: number;
  /** Where POC, value area, IB, midpoint and peak/valley lines stop. */
  extend: 'profile' | 'period' | 'right';
  /** Untouched naked levels kept on the chart, newest first (0 = all). */
  maxNaked: number;
  midpoint: boolean;
  /** Developing POC trail on the newest profile (or every profile with devAll). */
  devPoc: boolean;
  devVa: boolean;
  devAll: boolean;
  /** The previous session's POC, VAH, VAL, high and low carried onto the newest profile (or every profile). */
  prior: boolean;
  priorEvery: boolean;
  /** IB high/low lines plus extensions (percent of the IB range; 0 = off). */
  ibLines: boolean;
  ibExt: [number, number, number, number];
  /** First / last N letters marked (0 = off). */
  openingRange: number;
  closingRange: number;
  peaksValleys: 'off' | 'both' | 'peaks' | 'valleys';
  /** Rows compared on each side to find a peak or valley. */
  pvSensitivity: number;
  /** First and last letter of each profile coloured. */
  highlightEnds: boolean;
  /** Each profile in one of four cycling colours instead of early → late. */
  sessionColors: boolean;
  /** Own early → late colours instead of the theme's. */
  customColors: boolean;
  colors: [string, string, string, string];
  hover: boolean;
  hoverStats: boolean;
}

export const DEFAULT_TPO: TpoSettings = {
  session: 'D', block: '30m', rowTicks: null, valueArea: 70, vaMethod: 'two', ibMinutes: 60,
  display: 'blocks+letters', outsideVaFlat: true,
  poc: true, va: true, fillVa: false, ibRange: true, singles: true, poorExtremes: true, nakedPoc: true, nakedVa: false, labels: true, hideCandles: false,
  spacing: 3, extend: 'profile', maxNaked: 0, midpoint: false,
  devPoc: false, devVa: false, devAll: false, prior: false, priorEvery: false,
  ibLines: false, ibExt: [0, 0, 0, 0], openingRange: 0, closingRange: 0,
  peaksValleys: 'off', pvSensitivity: 3, highlightEnds: false, sessionColors: false,
  customColors: false, colors: ['#33001a', '#cc0033', '#ff6600', '#ffd966'],
  hover: true, hoverStats: false,
};

/** OpenMarket's defaults for the colours that have no theme equivalent. */
export const TPO_COLORS = {
  sessions: ['#4f8cff', '#22c39b', '#f2a33c', '#a06bff'],
  start: '#3b82f6', end: '#eb1d4e', peak: '#42a5f5', valley: '#ab47bc', midpoint: '#9e9e9e',
} as const;

const KEY = 'pp_tpo';
export function loadTpo(): TpoSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const out = { ...DEFAULT_TPO };
    // Keep only known keys whose type matches the default (old or hand-edited values are ignored).
    for (const k of Object.keys(DEFAULT_TPO) as Array<keyof TpoSettings>) {
      const v = raw[k];
      const d = DEFAULT_TPO[k];
      const ok = Array.isArray(d)
        ? Array.isArray(v) && v.length === d.length && v.every((x, i) => typeof x === typeof d[i])
        : typeof v === typeof d || (k === 'rowTicks' && (v === null || Number.isInteger(v)));
      if (v !== undefined && ok) (out as Record<string, unknown>)[k] = v;
    }
    return out;
  } catch { return { ...DEFAULT_TPO }; }
}
export function saveTpo(s: TpoSettings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } }

/** Letter for period i: A–Z, then a–z, then repeating. */
export const tpoLetter = (i: number) => {
  const n = ((i % 52) + 52) % 52;
  return String.fromCharCode(n < 26 ? 65 + n : 97 + n - 26);
};

/** Position 0..1 of period i in a session of n periods (early → late colour). */
export const periodPosition = (i: number, n: number) => (n > 1 ? i / (n - 1) : 0);

/**
 * Peaks and valleys of a profile: rows whose letter count is strictly above (peak)
 * or below (valley) every row within `n` rows on each side. Returns row indexes.
 */
export function peaksValleys(counts: readonly number[], n: number): { peaks: number[]; valleys: number[] } {
  const peaks: number[] = [], valleys: number[] = [];
  const w = Math.max(1, Math.floor(n));
  for (let i = w; i < counts.length - w; i++) {
    let hi = true, lo = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (counts[j]! >= counts[i]!) hi = false;
      if (counts[j]! <= counts[i]!) lo = false;
    }
    if (hi) peaks.push(i);
    if (lo) valleys.push(i);
  }
  return { peaks, valleys };
}

/** IB high/low and each extension above the high and below the low, as [name, price]. */
export function ibLevels(high: number, low: number, ext: readonly number[]): Array<[string, number]> {
  const range = high - low;
  const out: Array<[string, number]> = [['IBH', high], ['IBL', low]];
  for (const pct of ext) if (pct > 0) out.push([`IBH +${pct}%`, high + (range * pct) / 100], [`IBL −${pct}%`, low - (range * pct) / 100]);
  return out;
}

/**
 * Which untouched naked levels to draw: the newest `max` (0 = all). Levels already
 * traded back to always stay, drawn up to the touch.
 */
export function keepNaked<T extends { start: number; touched: number | null }>(levels: readonly T[], max: number): Set<T> {
  const open = levels.filter((l) => l.touched === null).sort((a, b) => b.start - a.start);
  const keep = new Set(levels.filter((l) => l.touched !== null));
  for (const l of max > 0 ? open.slice(0, max) : open) keep.add(l);
  return keep;
}
