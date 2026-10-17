/** Chart anchors (time, price) ↔ pane pixels, for anything drawn by members: drawings and live cursors. */
import type { SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { Anchor } from '@paradise/contract';
import { logicalToX, xToLogical, type LogicalScale } from './coords.ts';
import type { RenderModel } from './model.ts';
import { logicalToTime, timeToLogical } from './time.ts';

export interface Pt { x: number; y: number }

export function projectAnchor(p: SeriesAttachedParameter<Time> | null, model: RenderModel, a: Anchor): Pt | null {
  if (!p || !model.times.length) return null;
  const x = logicalToX(p.chart.timeScale() as unknown as LogicalScale, timeToLogical(model.times, model.span, a.t));
  const y = p.series.priceToCoordinate(a.p);
  return x === null || y === null ? null : { x, y };
}

export function unprojectPoint(p: SeriesAttachedParameter<Time> | null, model: RenderModel, pt: Pt): Anchor | null {
  if (!p || !model.times.length) return null;
  const logical = xToLogical(p.chart.timeScale() as unknown as LogicalScale, pt.x);
  const price = p.series.coordinateToPrice(pt.y);
  return logical === null || price === null ? null : { t: Math.round(logicalToTime(model.times, model.span, logical)), p: price };
}
