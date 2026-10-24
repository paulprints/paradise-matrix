/**
 * Level segments: each level drawn across exactly the bars it was valid for.
 * Width encodes timeframe (M thickest), colour encodes group, dashes mark
 * developing levels, dots mark Market Profile. Current levels get labels at
 * the right edge (collision-resolved, priority-thinned like the ladder).
 */
import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';

type CanvasRenderingTarget2D = Parameters<IPrimitivePaneRenderer['draw']>[0];
import { formatPrice } from '../lib/format.ts';
import { placeLabels } from '../lib/layout.ts';
import type { RenderModel } from './model.ts';
import type { Segment } from './state.ts';
import { timeToLogical } from './time.ts';
import { logicalToX, type LogicalScale } from './coords.ts';
import { withAlpha } from './theme.ts';
import { easeOut, MOTION } from '../lib/motion.ts';

const TF_WIDTH: Record<string, number> = { M: 2.5, W: 2, D: 1.5 };
const TF_RANK: Record<string, number> = { M: 0, W: 1, D: 2, '1H': 3, '30m': 4, '15m': 5, '5m': 6, '1m': 7 };
const LABEL_GAP = 15;

export function segmentPriority(s: Segment): number {
  const g = s.key.group === 'structure' ? (s.key.slug === 'pivot' || s.key.slug.startsWith('band') ? 0 : 1)
    : s.key.group === 'profile' ? 2 : s.key.group === 'range' ? 3 : 4;
  return (s.developing ? 10 : 0) + g * 10 + (TF_RANK[s.tf] ?? 8) * 0.1;
}

type Style = 'strong' | 'normal' | 'range' | 'term' | 'profile' | 'dev';
const styleOf = (s: Segment): Style =>
  s.developing ? 'dev' : s.key.group === 'profile' ? 'profile' : s.key.group === 'termination' ? 'term' : s.key.group === 'range' ? 'range'
    : s.key.slug === 'pivot' || s.key.slug.startsWith('band') ? 'strong' : 'normal';

export class LevelsLayer implements ISeriesPrimitive<Time> {
  private p: SeriesAttachedParameter<Time> | null = null;
  private readonly lines: IPrimitivePaneRenderer = { draw: (t) => this.drawLines(t) };
  private readonly labels: IPrimitivePaneRenderer = { draw: (t) => this.drawLabels(t) };
  private readonly views: readonly IPrimitivePaneView[] = [
    { zOrder: () => 'bottom', renderer: () => this.lines },
    { zOrder: () => 'top', renderer: () => this.labels },
  ];

  constructor(private readonly model: RenderModel) {}
  attached(p: SeriesAttachedParameter<Time>) { this.p = p; }
  detached() { this.p = null; }
  paneViews() { return this.views; }
  invalidate() { this.p?.requestUpdate(); }

  private x(t: number): number | null {
    const m = this.model;
    return logicalToX(this.p!.chart.timeScale() as unknown as LogicalScale, timeToLogical(m.times, m.span, t));
  }

  private drawLines(target: CanvasRenderingTarget2D) {
    const m = this.model;
    if (!this.p || !m.times.length) return;
    const { series } = this.p;
    // Settle: a level that just became final fades from developing (dashed) to its confirmed style, once.
    const progress = (performance.now() - m.settledAt) / MOTION.slow;
    const settling = progress < 1 ? m.settled : null;
    if (settling) requestAnimationFrame(() => this.invalidate());
    target.useBitmapCoordinateSpace(({ context: ctx, mediaSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const batches = new Map<string, Path2D>();
      const settle: Array<{ s: Segment; path: Path2D; w: number }> = [];
      for (const s of m.segments) {
        const xa = this.x(s.from), xb = this.x(s.to);
        if (xa === null || xb === null || xb < 0 || xa > mediaSize.width) continue;
        const y = series.priceToCoordinate(s.price);
        if (y === null || y < -2 || y > mediaSize.height + 2) continue;
        const w = Math.max(1, Math.round((TF_WIDTH[s.tf] ?? 1) * vr));
        const key = `${styleOf(s)}|${w}`;
        const settles = !!settling?.has(s.id);
        const path = settles ? new Path2D() : batches.get(key) ?? new Path2D();
        if (settles) settle.push({ s, path, w }); else batches.set(key, path);
        const yb = Math.round(y * vr) + (w % 2 ? 0.5 : 0);
        path.moveTo(Math.round(xa * hr), yb);
        path.lineTo(Math.round(xb * hr), yb);
      }
      const P = m.palette;
      const color: Record<Style, string> = {
        strong: P.paper, normal: withAlpha(P.paperDim, 0.85), range: P.sage, term: withAlpha(P.ink, 0.75), profile: P.ink, dev: P.sage,
      };
      ctx.lineCap = 'butt';
      for (const [key, path] of batches) {
        const [style, w] = key.split('|') as [Style, string];
        ctx.strokeStyle = color[style];
        ctx.lineWidth = Number(w);
        ctx.setLineDash(style === 'dev' ? [4 * hr, 3 * hr] : style === 'profile' ? [1 * hr, 3 * hr] : []);
        ctx.stroke(path);
      }
      const e = easeOut(progress);
      for (const { s, path, w } of settle) {
        ctx.lineWidth = w;
        ctx.globalAlpha = 1 - e;
        ctx.strokeStyle = color.dev;
        ctx.setLineDash([4 * hr, 3 * hr]);
        ctx.stroke(path);
        ctx.globalAlpha = e;
        ctx.strokeStyle = color[styleOf(s)];
        ctx.setLineDash(styleOf(s) === 'profile' ? [1 * hr, 3 * hr] : []);
        ctx.stroke(path);
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    });
  }

  /** Segments current at the latest bar, plus developing ones. */
  currentSegments(): Segment[] {
    const m = this.model;
    const tNow = m.times[m.times.length - 1];
    if (tNow === undefined) return [];
    return m.segments.filter((s) => s.developing || (s.from <= tNow && tNow < s.to));
  }

  private drawLabels(target: CanvasRenderingTarget2D) {
    const m = this.model;
    if (!this.p || !m.times.length) return;
    const { series } = this.p;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const cur = this.currentSegments()
        .map((s) => ({ s, y: series.priceToCoordinate(s.price) as number | null }))
        .filter((o): o is { s: Segment; y: number } => o.y !== null && o.y >= 0 && o.y <= mediaSize.height);
      const capacity = Math.max(1, Math.floor(mediaSize.height / LABEL_GAP) - 1);
      const keep = [...cur].sort((a, b) => segmentPriority(a.s) - segmentPriority(b.s)).slice(0, capacity);
      const placed = placeLabels(keep.map((o) => ({ item: o.s, y: o.y })), LABEL_GAP, 8, mediaSize.height - 8);
      ctx.font = '600 11px Archivo, system-ui, sans-serif';
      (ctx as CanvasRenderingContext2D & { fontStretch?: string }).fontStretch = 'condensed';
      ctx.textBaseline = 'middle';
      const P = m.palette;
      for (const { item: s, y, labelY } of placed) {
        const text = `${s.tf} ${s.key.label}  ${formatPrice(s.price, m.tick)}`;
        const w = ctx.measureText(text).width;
        const x = mediaSize.width - w - 10;
        ctx.strokeStyle = withAlpha(P.paperDim, 0.35);
        ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.lineTo(x - 3, labelY); ctx.stroke();
        ctx.fillStyle = withAlpha(P.plate, 0.85);
        ctx.fillRect(x - 3, labelY - 7, w + 6, 14);
        ctx.fillStyle = s.developing ? P.sage : styleOf(s) === 'strong' ? P.paper : P.paperDim;
        ctx.fillText(text, x, labelY);
      }
    });
  }
}
