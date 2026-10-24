/** Other members' cursors on a shared chart: a pointer in their colour with their name beside it. */
import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { Anchor } from '@paradise/contract';
import { approach, reducedMotion } from '../lib/motion.ts';
import { unprojectPoint, type Pt } from './anchor.ts';
import { logicalToX, type LogicalScale } from './coords.ts';
import type { RenderModel } from './model.ts';
import { withAlpha } from './theme.ts';
import { timeToLogical } from './time.ts';

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0];
export interface RemoteCursor { id: string; at: Anchor; name: string; color: string; presenting: boolean }

const LABEL_FONT = '600 11px Archivo, system-ui, sans-serif';
/** Cursor smoothing time constant (ms): updates arrive up to 30/s; this glides between them with ~50 ms lag. */
const CURSOR_TAU = 50;

export class PresenceLayer implements ISeriesPrimitive<Time> {
  private p: SeriesAttachedParameter<Time> | null = null;
  cursors: RemoteCursor[] = [];
  /** Where each cursor is drawn now, in (logical bar, price) so it stays pinned to the chart while you pan. */
  private shown = new Map<string, { l: number; p: number }>();
  private animating = false;
  private lastFrame = 0;
  private readonly renderer: IPrimitivePaneRenderer = { draw: (t) => this.draw(t) };
  private readonly views: readonly IPrimitivePaneView[] = [{ zOrder: () => 'top', renderer: () => this.renderer }];

  constructor(private readonly model: RenderModel) {}
  attached(p: SeriesAttachedParameter<Time>) { this.p = p; }
  detached() { this.p = null; }
  paneViews() { return this.views; }
  invalidate() { this.p?.requestUpdate(); }
  /** Pane pixels → anchor (for sending our own cursor). */
  unproject(pt: Pt): Anchor | null { return unprojectPoint(this.p, this.model, pt); }
  /** The main pane, excluding the axes. */
  size() { const s = this.p?.chart.paneSize(0); return { width: s?.width ?? 0, height: s?.height ?? 0 }; }

  /** Glide each cursor toward its latest position; returns pane pixels, or null if off-chart. */
  private place(c: RemoteCursor, dt: number, snap: boolean): (Pt & { moving: boolean }) | null {
    const m = this.model, p = this.p;
    if (!p || !m.times.length) return null;
    const target = { l: timeToLogical(m.times, m.span, c.at.t), p: c.at.p };
    const prev = this.shown.get(c.id);
    const cur = prev && !snap ? { l: approach(prev.l, target.l, dt, CURSOR_TAU), p: approach(prev.p, target.p, dt, CURSOR_TAU) } : target;
    this.shown.set(c.id, cur);
    const ts = p.chart.timeScale() as unknown as LogicalScale;
    const x = logicalToX(ts, cur.l), y = p.series.priceToCoordinate(cur.p);
    const tx = logicalToX(ts, target.l), ty = p.series.priceToCoordinate(target.p);
    if (x === null || y === null) return null;
    return { x, y, moving: tx !== null && ty !== null && Math.hypot(tx - x, ty - y) > 0.5 };
  }

  private draw(target: Target) {
    const now = performance.now();
    // After an idle spell, step one frame rather than the whole gap (which would jump).
    const dt = this.animating ? now - this.lastFrame : 16;
    this.lastFrame = now;
    const snap = reducedMotion();
    let moving = false;
    for (const id of this.shown.keys()) if (!this.cursors.some((c) => c.id === id)) this.shown.delete(id);
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const P = this.model.palette;
      for (const c of this.cursors) {
        const pt = this.place(c, dt, snap);
        if (!pt) continue;
        moving ||= pt.moving;
        if (pt.x < -20 || pt.y < -20 || pt.x > mediaSize.width + 20 || pt.y > mediaSize.height + 20) continue;
        const { x, y } = pt;
        // Pointer: a small arrow with a plate-coloured outline so it reads over candles and heat.
        ctx.beginPath();
        ctx.moveTo(x, y); ctx.lineTo(x, y + 14); ctx.lineTo(x + 4, y + 10.5); ctx.lineTo(x + 9.5, y + 11); ctx.closePath();
        ctx.fillStyle = c.color;
        ctx.strokeStyle = withAlpha(P.plate, 0.95);
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.fill();
        // Name tag.
        const label = c.presenting ? `${c.name} · presenting` : c.name;
        ctx.font = LABEL_FONT;
        const w = ctx.measureText(label).width + 10;
        const lx = Math.min(x + 10, mediaSize.width - w - 2), ly = y + 14;
        ctx.fillStyle = c.color;
        ctx.beginPath();
        ctx.roundRect(lx, ly, w, 17, 3);
        ctx.fill();
        ctx.fillStyle = P.plate;
        ctx.textBaseline = 'middle';
        ctx.fillText(label, lx + 5, ly + 9);
      }
    });
    this.animating = moving;
    if (moving) requestAnimationFrame(() => this.invalidate());
  }
}
