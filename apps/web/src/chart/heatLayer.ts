/**
 * Halftone heat behind the candles. One dot column per bar (thinned so dots
 * stay ~7px apart), rows on a price grid; each column uses the levels that were
 * valid at that bar's time, so the heat changes exactly when levels change.
 * Dots are batched into 8 radius buckets → 8 fills per frame.
 */
import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';

type CanvasRenderingTarget2D = Parameters<IPrimitivePaneRenderer['draw']>[0];
import { contribution } from '../lib/heat.ts';
import type { RenderModel } from './model.ts';
import { intervalAt, type Interval } from './state.ts';
import { logicalToTime } from './time.ts';
import { logicalToX, type LogicalScale } from './coords.ts';

const CELL = 7;
const BUCKETS = 8;
const MIN_INTENSITY = 0.06;

export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag);
}

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
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    target.useBitmapCoordinateSpace(({ context: ctx, mediaSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const x0 = ts.logicalToCoordinate(0 as never), x1 = ts.logicalToCoordinate(1 as never);
      if (x0 === null || x1 === null) return;
      const pxPerBar = Math.abs(x1 - x0) || 1;
      const step = Math.max(1, Math.ceil(CELL / pxPerBar));
      const pTop = series.coordinateToPrice(0), pBot = series.coordinateToPrice(mediaSize.height);
      if (pTop === null || pBot === null) return;
      const priceStep = niceStep(((pTop - pBot) / mediaSize.height) * CELL);
      const rowStart = Math.floor(pBot / priceStep), rowEnd = Math.ceil(pTop / priceStep);
      if (rowEnd - rowStart > 2000) return;
      const rows: Array<{ price: number; y: number; odd: boolean }> = [];
      for (let r = rowStart; r <= rowEnd; r++) {
        const price = r * priceStep, y = series.priceToCoordinate(price);
        if (y !== null) rows.push({ price, y, odd: (r & 1) === 1 });
      }
      const key = `${m.version}|${priceStep}|${rowStart}|${rowEnd}`;
      if (key !== this.cacheKey) { this.cache.clear(); this.cacheKey = key; }

      const paths = Array.from({ length: BUCKETS }, () => new Path2D());
      const radius = (b: number) => (CELL / 2) * Math.sqrt((b + 0.5) / BUCKETS) * 0.92;
      const kStart = Math.floor(range.from / step) * step - step, kEnd = Math.ceil(range.to) + step;
      for (let k = kStart; k <= kEnd; k += step) {
        const iv = intervalAt(m.timeline, logicalToTime(m.times, m.span, k));
        if (!iv) continue;
        let col = this.cache.get(iv);
        if (!col) {
          col = new Float32Array(rows.length);
          for (let j = 0; j < rows.length; j++) {
            let s = 0;
            for (const idx of iv.active) {
              const seg = m.segments[idx]!;
              s += contribution(seg.tf, seg.developing, seg.price, rows[j]!.price, m.bandwidth);
            }
            col[j] = Math.min(1, s / m.reference);
          }
          this.cache.set(iv, col);
        }
        for (let j = 0; j < rows.length; j++) {
          const it = col[j]!;
          if (it < MIN_INTENSITY) continue;
          const row = rows[j]!;
          const x = logicalToX(ts as unknown as LogicalScale, row.odd ? k + step / 2 : k);
          if (x === null || x < -CELL || x > mediaSize.width + CELL) continue;
          const b = Math.min(BUCKETS - 1, Math.floor(it * BUCKETS));
          const r = radius(b) * hr, cx = x * hr, cy = row.y * vr;
          paths[b]!.moveTo(cx + r, cy);
          paths[b]!.arc(cx, cy, r, 0, Math.PI * 2);
        }
      }
      ctx.fillStyle = m.palette.ink;
      ctx.globalAlpha = 0.55;
      for (const p of paths) ctx.fill(p);
      ctx.globalAlpha = 1;
    });
  }
}
