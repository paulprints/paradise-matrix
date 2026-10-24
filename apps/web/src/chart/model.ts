/**
 * Shared, mutable render model read by the canvas layers at draw time. React
 * owns the data; the chart reads this object on every frame without re-render.
 */
import type { Timeframe } from '@paradise/contract';
import { bandwidthFor, referenceScore, type HeatStyle } from '../lib/heat.ts';
import type { Interval, Segment } from './state.ts';
import { buildTimeline, justConfirmed } from './state.ts';
import type { Palette } from './theme.ts';

export class RenderModel {
  times: number[] = [];
  span = 60;
  segments: Segment[] = [];
  timeline: Interval[] = [];
  bandwidth = 1;
  reference = 3;
  heat = true;
  heatStyle: HeatStyle = 'matrix';
  tick = 0.01;
  tz = 'America/New_York';
  palette!: Palette;
  /** Bumped whenever data changes; layers key their caches on it. */
  version = 0;
  /** Segments that just went from developing to confirmed, and when (for the settle animation). */
  settled: ReadonlySet<string> = new Set();
  settledAt = 0;

  /** `settle`: this is a live update of the same series, so a confirmation may animate. */
  setSegments(segments: Segment[], finestAtr: number | null, settle = false) {
    const confirmed = settle ? justConfirmed(this.segments, segments) : new Set<string>();
    if (confirmed.size) { this.settled = confirmed; this.settledAt = performance.now(); }
    this.segments = segments;
    this.timeline = buildTimeline(segments);
    const prices = segments.map((s) => s.price);
    const span = prices.length ? Math.max(...prices) - Math.min(...prices) : 1;
    this.bandwidth = bandwidthFor(finestAtr, span || 1);
    this.reference = referenceScore(segments.map((s) => ({ tf: s.tf as Timeframe })));
    this.version++;
  }
}
