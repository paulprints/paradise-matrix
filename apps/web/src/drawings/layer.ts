/** Renders member drawings above everything else (zOrder 'top'), plus selection handles and the stroke in progress. */
import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, PrimitiveHoveredItem, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { Drawing } from '@paradise/contract';
import type { RenderModel } from '../chart/model.ts';
import { drawingColor, withAlpha } from '../chart/theme.ts';
import { projectAnchor, unprojectPoint } from '../chart/anchor.ts';
import { extendRay, hitTest, type Pt } from './geometry.ts';
import { easeOut, MOTION } from '../lib/motion.ts';

/** A refused edit's outline fades over this long: long enough to catch the eye as the drawing snaps back. */
const FLASH_MS = MOTION.slow * 3;

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0];
export const TEXT_FONT = '600 13px Archivo, system-ui, sans-serif';

export class DrawingsLayer implements ISeriesPrimitive<Time> {
  p: SeriesAttachedParameter<Time> | null = null;
  drawings: Drawing[] = [];
  draft: Drawing | null = null;
  selected: string | null = null;
  private flashed: ReadonlySet<string> = new Set();
  private flashAt = 0;
  private measureCtx: CanvasRenderingContext2D | null = null;
  private readonly renderer: IPrimitivePaneRenderer = { draw: (t) => this.draw(t) };
  private readonly views: readonly IPrimitivePaneView[] = [{ zOrder: () => 'top', renderer: () => this.renderer }];

  constructor(private readonly model: RenderModel) {}
  attached(p: SeriesAttachedParameter<Time>) { this.p = p; }
  detached() { this.p = null; }
  paneViews() { return this.views; }
  invalidate() { this.p?.requestUpdate(); }

  /** Anchor (time, price) → pane pixels. */
  project = (a: { t: number; p: number }): Pt | null => projectAnchor(this.p, this.model, a);

  /** Pane pixels → anchor. */
  unproject = (pt: Pt): { t: number; p: number } | null => unprojectPoint(this.p, this.model, pt);

  measure = (s: string): number => {
    this.measureCtx ??= document.createElement('canvas').getContext('2d');
    if (!this.measureCtx) return s.length * 7;
    this.measureCtx.font = TEXT_FONT;
    return this.measureCtx.measureText(s).width;
  };

  /** Outline these drawings briefly: the server refused an edit to them and they just moved back. */
  flash(ids: readonly string[]) {
    this.flashed = new Set(ids);
    this.flashAt = performance.now();
    this.invalidate();
  }

  /** Screen box around a drawing, for the flash outline. */
  private box(d: Drawing, size: { width: number; height: number }): { x0: number; y0: number; x1: number; y1: number } | null {
    if (d.kind === 'hline') { const y = this.project({ t: this.model.times[0] ?? 0, p: d.p })?.y; return y === undefined ? null : { x0: 0, x1: size.width, y0: y, y1: y }; }
    if (d.kind === 'vline') { const x = this.project({ t: d.t, p: 0 })?.x; return x === undefined ? null : { x0: x, x1: x, y0: 0, y1: size.height }; }
    const anchors = d.kind === 'brush' ? d.pts : d.kind === 'text' ? [d.a] : [d.a, d.b];
    const pts = anchors.map(this.project).filter((p): p is Pt => !!p);
    if (!pts.length) return null;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const right = d.kind === 'text' ? pts[0]!.x + this.measure(d.text) : Math.max(...xs);
    return { x0: Math.min(...xs), x1: right, y0: Math.min(...ys) - (d.kind === 'text' ? 13 : 0), y1: Math.max(...ys) + (d.kind === 'text' ? 5 : 0) };
  }

  /** The main pane, excluding the price and time axes. */
  size(): { width: number; height: number } {
    const s = this.p?.chart.paneSize(0);
    return { width: s?.width ?? 0, height: s?.height ?? 0 };
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const hit = hitTest(this.drawings, { x, y }, this.project, this.size(), this.selected, this.measure);
    if (!hit) return null;
    return { externalId: hit.id, zOrder: 'top', cursorStyle: hit.handle === 'body' ? 'move' : 'grab', distance: hit.distance, hitTestPriority: 1 };
  }

  private draw(target: Target) {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const P = this.model.palette;
      const all = this.draft ? [...this.drawings, this.draft] : this.drawings;
      for (const d of all) {
        const sel = d.id === this.selected || d === this.draft;
        const color = drawingColor(P, d.color);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = sel ? 2 : 1.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        const handles: Pt[] = [];
        if (d.kind === 'trend') {
          const a = this.project(d.a), b = this.project(d.b);
          if (!a || !b) continue;
          const end = d.extend ? extendRay(a, b, mediaSize.width) : b;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(end.x, end.y); ctx.stroke();
          handles.push(a, b);
        } else if (d.kind === 'rect') {
          const a = this.project(d.a), b = this.project(d.b);
          if (!a || !b) continue;
          const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
          ctx.fillStyle = withAlpha(color, 0.12);
          ctx.fillRect(x, y, w, h);
          ctx.strokeRect(x, y, w, h);
          handles.push(a, b);
        } else if (d.kind === 'hline') {
          const y = this.project({ t: this.model.times[0] ?? 0, p: d.p })?.y;
          if (y === undefined) continue;
          ctx.setLineDash([6, 4]);
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(mediaSize.width, y); ctx.stroke();
          ctx.setLineDash([]);
        } else if (d.kind === 'vline') {
          const x = this.project({ t: d.t, p: 0 })?.x;
          if (x === undefined) continue;
          ctx.setLineDash([6, 4]);
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, mediaSize.height); ctx.stroke();
          ctx.setLineDash([]);
        } else if (d.kind === 'text') {
          const a = this.project(d.a);
          if (!a) continue;
          ctx.font = TEXT_FONT;
          ctx.textBaseline = 'alphabetic';
          ctx.lineWidth = 4;
          ctx.strokeStyle = withAlpha(P.plate, 0.9);
          ctx.strokeText(d.text, a.x, a.y);
          ctx.fillText(d.text, a.x, a.y);
          if (sel) { ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(a.x - 3, a.y - 13, this.measure(d.text) + 6, 18); }
        } else if (d.kind === 'brush') {
          const pts = d.pts.map(this.project).filter((p): p is Pt => !!p);
          if (pts.length < 2) continue;
          ctx.beginPath();
          ctx.moveTo(pts[0]!.x, pts[0]!.y);
          for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
        if (sel && d !== this.draft) {
          for (const hp of handles) {
            ctx.fillStyle = P.plate;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(hp.x, hp.y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
        }
      }
      const t = (performance.now() - this.flashAt) / FLASH_MS;
      if (t < 1 && this.flashed.size) {
        ctx.strokeStyle = withAlpha(P.alert, 1 - easeOut(t));
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        for (const d of this.drawings) {
          const b = this.flashed.has(d.id) ? this.box(d, mediaSize) : null;
          if (b) { ctx.beginPath(); ctx.roundRect(b.x0 - 6, b.y0 - 6, b.x1 - b.x0 + 12, b.y1 - b.y0 + 12, 4); ctx.stroke(); }
        }
        requestAnimationFrame(() => this.invalidate());
      }
    });
  }
}
