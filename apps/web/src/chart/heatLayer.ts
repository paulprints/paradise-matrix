/**
 * Heat behind the candles, varying over time: each bar column uses the levels
 * valid at that bar's time, so the heat changes exactly when levels change.
 *
 * Two styles over the same values:
 *   halftone — ink dots sized by intensity (8 radius buckets → 8 fills)
 *   matrix   — the v1 colour scale as solid cells; low confluence fades toward
 *              transparent so candles stay readable (32 colour buckets → 32 fills)
 */
import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { contribution, viridisCss } from '../lib/heat.ts';
import type { RenderModel } from './model.ts';
import { intervalAt, type Interval } from './state.ts';
import { logicalToTime } from './time.ts';
import { logicalToX, type LogicalScale } from './coords.ts';

type CanvasRenderingTarget2D = Parameters<IPrimitivePaneRenderer['draw']>[0];

const DOT_CELL = 7;
const MATRIX_COL_PX = 3;
const MATRIX_ROW_PX = 4;
const DOT_BUCKETS = 8;
const COLOR_BUCKETS = 32;
const MIN_INTENSITY = 0.06;

export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag);
}

/** Matrix cell opacity: void stays nearly clear, terminal is strong but never hides candles. */
export const matrixAlpha = (t: number) => 0.12 + 0.6 * Math.min(1, Math.max(0, t));

export class HeatLayer implements ISeriesPrimitive<Time> {
  private p: SeriesAttachedParameter<Time> | null = null;
  private cache = new Map<Interval, Float32Array>();
  private cacheKey = '';
  private readonly renderer: IPrimitivePaneRenderer = { draw: (t) => this.draw(t) };
  private readonly views: readonly IPrimitivePaneView[] = [{ zOrder: () => 'bottom', renderer: () => this.renderer }];

  constructor(private readonly model: RenderModel) {}
  attached(p: SeriesAttachedParameter<Time>) { this.p = p; }
  detached() { this.p = null; }
  paneViews() { return this.views; }
  invalidate() { this.p?.requestUpdate(); }

  private draw(target: CanvasRenderingTarget2D) {
    const m = this.model;
    if (!this.p || !m.heat || !m.timeline.length || !m.times.length) return;
    const { chart, series } = this.p;
    const ts = chart.timeScale();
    const scale = ts as unknown as LogicalScale;
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const matrix = m.heatStyle === 'matrix';
    target.useBitmapCoordinateSpace(({ context: ctx, mediaSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const x0 = ts.logicalToCoordinate(0 as never), x1 = ts.logicalToCoordinate(1 as never);
      if (x0 === null || x1 === null) return;
      const pxPerBar = Math.abs(x1 - x0) || 1;
      const step = Math.max(1, Math.ceil((matrix ? MATRIX_COL_PX : DOT_CELL) / pxPerBar));
      const pTop = series.coordinateToPrice(0), pBot = series.coordinateToPrice(mediaSize.height);
      if (pTop === null || pBot === null) return;
      const priceStep = niceStep(((pTop - pBot) / mediaSize.height) * (matrix ? MATRIX_ROW_PX : DOT_CELL));
      const rowStart = Math.floor(pBot / priceStep) - 1, rowEnd = Math.ceil(pTop / priceStep) + 1;
      if (rowEnd - rowStart > 4000) return;
      const rows: Array<{ price: number; y: number; yTop: number; yBot: number; odd: boolean }> = [];
      for (let r = rowStart; r <= rowEnd; r++) {
        const price = r * priceStep;
        const y = series.priceToCoordinate(price), yt = series.priceToCoordinate(price + priceStep / 2), yb = series.priceToCoordinate(price - priceStep / 2);
        if (y !== null && yt !== null && yb !== null) rows.push({ price, y, yTop: yt, yBot: yb, odd: (r & 1) === 1 });
      }
      const key = `${m.version}|${priceStep}|${rowStart}|${rowEnd}`;
      if (key !== this.cacheKey) { this.cache.clear(); this.cacheKey = key; }
      const column = (iv: Interval): Float32Array => {
        let col = this.cache.get(iv);
        if (!col) {
          col = new Float32Array(rows.length);
          const scale = m.scaleOf(iv);
          for (let j = 0; j < rows.length; j++) {
            let s = 0;
            for (const idx of iv.active) {
              const seg = m.segments[idx]!;
              s += contribution(seg.tf, seg.developing, seg.price, rows[j]!.price, m.bandwidth);
            }
            col[j] = scale > 0 ? Math.min(1, s / scale) : 0;
          }
          this.cache.set(iv, col);
        }
        return col;
      };

      const buckets = matrix ? COLOR_BUCKETS : DOT_BUCKETS;
      const paths = Array.from({ length: buckets }, () => new Path2D());
      const kStart = Math.floor(range.from / step) * step - step, kEnd = Math.ceil(range.to) + step;
      for (let k = kStart; k <= kEnd; k += step) {
        const iv = intervalAt(m.timeline, logicalToTime(m.times, m.span, k));
        if (!iv) continue;
        const col = column(iv);
        if (matrix) {
          const xa = logicalToX(scale, k - step / 2), xb = logicalToX(scale, k + step / 2);
          if (xa === null || xb === null || xb < 0 || xa > mediaSize.width) continue;
          const left = Math.round(xa * hr), right = Math.round(xb * hr);
          for (let j = 0; j < rows.length; j++) {
            const it = col[j]!;
            if (it < MIN_INTENSITY) continue;
            const row = rows[j]!;
            const top = Math.round(row.yTop * vr), bottom = Math.round(row.yBot * vr);
            paths[Math.min(COLOR_BUCKETS - 1, Math.floor(it * COLOR_BUCKETS))]!.rect(left, top, right - left, bottom - top);
          }
        } else {
          for (let j = 0; j < rows.length; j++) {
            const it = col[j]!;
            if (it < MIN_INTENSITY) continue;
            const row = rows[j]!;
            const x = logicalToX(scale, row.odd ? k + step / 2 : k);
            if (x === null || x < -DOT_CELL || x > mediaSize.width + DOT_CELL) continue;
            const b = Math.min(DOT_BUCKETS - 1, Math.floor(it * DOT_BUCKETS));
            const r = (DOT_CELL / 2) * Math.sqrt((b + 0.5) / DOT_BUCKETS) * 0.92 * hr, cx = x * hr, cy = row.y * vr;
            paths[b]!.moveTo(cx + r, cy);
            paths[b]!.arc(cx, cy, r, 0, Math.PI * 2);
          }
        }
      }
      if (matrix) {
        for (let b = 0; b < COLOR_BUCKETS; b++) {
          const t = (b + 0.5) / COLOR_BUCKETS;
          ctx.fillStyle = viridisCss(t, matrixAlpha(t));
          ctx.fill(paths[b]!);
        }
      } else {
        ctx.fillStyle = m.palette.ink;
        ctx.globalAlpha = 0.55;
        for (const p of paths) ctx.fill(p);
        ctx.globalAlpha = 1;
      }
    });
  }
}
