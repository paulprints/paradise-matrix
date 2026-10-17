/**
 * Chart data state: decoding the compact wire format, merging live increments,
 * and the timeline of which levels are active when (for heat and hover).
 */
import type { ChartBar, ChartResponse, Frame, Instrument, LevelKey, LevelSegment, Timeframe } from '@paradise/contract';

export interface Segment {
  /** Stable id: tf, key and window start identify a segment uniquely. */
  id: string;
  key: LevelKey;
  tf: Timeframe;
  price: number;
  from: number;
  to: number;
  developing: boolean;
  source: number;
}

export interface ChartState {
  instrument: Instrument;
  chartTf: Timeframe;
  bars: ChartBar[];
  segments: Segment[];
  frames: Frame[];
  lastPrice: ChartResponse['lastPrice'];
  dataSource: string;
  engineVersion: string;
  warnings: string[];
  generatedAt: string;
}

export function decode(keys: readonly LevelKey[], s: LevelSegment): Segment {
  const [k, tf, price, from, to, basis, source] = s;
  return { id: `${tf}:${basis}:${k}:${from}`, key: keys[k]!, tf, price, from, to, developing: basis === 1, source };
}

/**
 * Apply a response. A full load (since = null) replaces everything. An increment
 * replaces bars from `since` on and every segment whose window ends after `since`;
 * older segments are final and kept (server tests prove the replay is exact).
 */
export function applyChart(prev: ChartState | null, res: ChartResponse): ChartState {
  const segs = res.segments.map((s) => decode(res.keys, s));
  const base = {
    instrument: res.instrument, chartTf: res.chartTf, frames: res.frames, lastPrice: res.lastPrice,
    dataSource: res.dataSource, engineVersion: res.engineVersion, warnings: res.warnings, generatedAt: res.generatedAt,
  };
  if (res.since === null || !prev || prev.chartTf !== res.chartTf) return { ...base, bars: res.bars, segments: sortSegments(segs) };
  const since = res.since;
  const bars = [...prev.bars.filter((b) => b.t < since), ...res.bars];
  const segments = sortSegments([...prev.segments.filter((s) => s.to <= since), ...segs]);
  return { ...base, bars, segments };
}

const sortSegments = (s: Segment[]) => s.sort((a, b) => a.from - b.from || a.to - b.to);

export interface Interval {
  from: number;
  to: number;
  /** Indexes into the segment array active throughout [from, to). */
  active: number[];
}

/** Sweep segment windows into constant intervals (the set of active levels only changes at boundaries). */
export function buildTimeline(segments: readonly Segment[]): Interval[] {
  if (!segments.length) return [];
  const points = new Set<number>();
  for (const s of segments) { points.add(s.from); points.add(s.to); }
  const edges = [...points].sort((a, b) => a - b);
  const starts = new Map<number, number[]>(), ends = new Map<number, number[]>();
  segments.forEach((s, i) => {
    (starts.get(s.from) ?? starts.set(s.from, []).get(s.from)!).push(i);
    (ends.get(s.to) ?? ends.set(s.to, []).get(s.to)!).push(i);
  });
  const active = new Set<number>();
  const out: Interval[] = [];
  for (let e = 0; e < edges.length - 1; e++) {
    const t = edges[e]!;
    for (const i of ends.get(t) ?? []) active.delete(i);
    for (const i of starts.get(t) ?? []) active.add(i);
    if (active.size) out.push({ from: t, to: edges[e + 1]!, active: [...active] });
  }
  return out;
}

/** Interval containing t, by binary search; null in a gap with no levels. */
export function intervalAt(timeline: readonly Interval[], t: number): Interval | null {
  let lo = 0, hi = timeline.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, iv = timeline[mid]!;
    if (t < iv.from) hi = mid - 1;
    else if (t >= iv.to) lo = mid + 1;
    else return iv;
  }
  return null;
}
