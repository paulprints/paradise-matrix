/** Other members' cursors on a shared chart: a pointer in their colour with their name beside it. */
import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { Anchor } from '@paradise/contract';
import { projectAnchor, unprojectPoint, type Pt } from './anchor.ts';
import type { RenderModel } from './model.ts';
import { withAlpha } from './theme.ts';

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0];
export interface RemoteCursor { at: Anchor; name: string; color: string; presenting: boolean }

const LABEL_FONT = '600 11px Archivo, system-ui, sans-serif';

export class PresenceLayer implements ISeriesPrimitive<Time> {
  private p: SeriesAttachedParameter<Time> | null = null;
  cursors: RemoteCursor[] = [];
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

  private draw(target: Target) {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const P = this.model.palette;
      for (const c of this.cursors) {
        const pt = projectAnchor(this.p, this.model, c.at);
        if (!pt || pt.x < -20 || pt.y < -20 || pt.x > mediaSize.width + 20 || pt.y > mediaSize.height + 20) continue;
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
  }
}
