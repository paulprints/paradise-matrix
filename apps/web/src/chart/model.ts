/**
 * Shared, mutable render model read by the canvas layers at draw time. React
 * owns the data; the chart reads this object on every frame without re-render.
 */
import { bandwidthFor, peakScore, type HeatStyle } from '../lib/heat.ts';
import type { Interval, Segment } from './state.ts';
import { buildTimeline, justConfirmed } from './state.ts';
import type { Palette } from './theme.ts';

export class RenderModel {
  times: number[] = [];
  span = 60;
  segments: Segment[] = [];
  timeline: Interval[] = [];
  bandwidth = 1;
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
  private scales = new Map<Interval, number>();

  /** Heat scale for one period: its peak score (see lib/heat.ts). */
  scaleOf(iv: Interval): number {
    let s = this.scales.get(iv);
    if (s === undefined) {
      s = peakScore(iv.active.map((i) => this.segments[i]!), this.bandwidth);
      this.scales.set(iv, s);
    }
    return s;
  }

  /** `settle`: this is a live update of the same series, so a confirmation may animate. */
  setSegments(segments: Segment[], finestAtr: number | null, settle = false) {
    const confirmed = settle ? justConfirmed(this.segments, segments) : new Set<string>();
    if (confirmed.size) { this.settled = confirmed; this.settledAt = performance.now(); }
    this.segments = segments;
    this.timeline = buildTimeline(segments);
    this.scales.clear();
    const prices = segments.map((s) => s.price);
    const span = prices.length ? Math.max(...prices) - Math.min(...prices) : 1;
    this.bandwidth = bandwidthFor(finestAtr, span || 1);
    this.version++;
  }
}
