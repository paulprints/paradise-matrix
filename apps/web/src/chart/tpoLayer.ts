/**
 * TPO chart: each session's profile drawn in that session's own time span —
 * one cell per letter period per price row, coloured early → late, with POC,
 * value area, initial balance, single prints, poor extremes, naked levels
 * (lines that run on until price trades back to them), prior-session levels,
 * developing POC/VA trails, peaks and valleys. Hover hit-testing for the inspector.
 */
import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { TpoProfile, TpoResponse } from '@paradise/contract';
import { formatPrice } from '../lib/format.ts';
import { DEFAULT_TPO, ibLevels, keepNaked, peaksValleys, periodPosition, TPO_COLORS, tpoLetter, type TpoSettings } from '../lib/tpo.ts';
import { logicalToX, type LogicalScale } from './coords.ts';
import type { RenderModel } from './model.ts';
import { withAlpha, type Palette } from './theme.ts';
import { timeToLogical } from './time.ts';

type CanvasRenderingTarget2D = Parameters<IPrimitivePaneRenderer['draw']>[0];
type Ctx = CanvasRenderingContext2D;

const CELL_MAX = 11;
const COLOR_STEPS = 16;
const LETTER_MIN = { w: 6, h: 8 };

/** Early → late letter colours, from the theme. */
export const periodStops = (P: Palette) => [P.sky, P.ink, P.seal, P.alert];

function hexRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Colour at position f ∈ [0, 1] along the stops (quantised so cells can be batched by colour). */
export function rampColor(stops: readonly string[], f: number): string {
  const q = Math.round(Math.min(1, Math.max(0, f)) * (COLOR_STEPS - 1)) / (COLOR_STEPS - 1);
  const x = q * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), u = x - i;
  const a = hexRgb(stops[i]!), b = hexRgb(stops[i + 1]!);
  if (!a || !b) return stops[Math.round(x)]!;
  return `rgb(${a.map((v, k) => Math.round(v + (b[k]! - v) * u)).join(', ')})`;
}

/** What the pointer is over: a profile, and the cell's row and letter when on one. */
export interface TpoHit {
  profile: TpoProfile;
  /** Price of the row under the pointer, or null outside the profile's rows. */
  price: number | null;
  /** Letters on that row. */
  count: number;
  letter: number | null;
}

type Naked = { profile: TpoProfile; name: string; price: number; touched: number | null; start: number; color: string; w: number };

export class TpoLayer implements ISeriesPrimitive<Time> {
  private p: SeriesAttachedParameter<Time> | null = null;
  private data: TpoResponse | null = null;
  private s: TpoSettings = DEFAULT_TPO;
  private width = 0;
  /** Where each profile was drawn, for hover hit-testing. */
  private geo: Array<{ profile: TpoProfile; xa: number; cw: number; end: number }> = [];
  private readonly cells: IPrimitivePaneRenderer = { draw: (t) => this.draw(t) };
  private readonly views: readonly IPrimitivePaneView[] = [{ zOrder: () => 'bottom', renderer: () => this.cells }];

  constructor(private readonly model: RenderModel) {}
  attached(p: SeriesAttachedParameter<Time>) { this.p = p; }
  detached() { this.p = null; }
  paneViews() { return this.views; }
  invalidate() { this.p?.requestUpdate(); }
  set(data: TpoResponse | null, settings: TpoSettings) { this.data = data; this.s = settings; this.invalidate(); }

  /** The profile (and cell) at a point in media pixels, as last drawn. */
  hit(px: number, py: number): TpoHit | null {
    const d = this.data, series = this.p?.series;
    if (!d || !series) return null;
    const g = this.geo.find((o) => px >= o.xa && px <= o.end);
    if (!g) return null;
    const raw = series.coordinateToPrice(py);
    if (raw === null) return null;
    const k = Math.round((raw - g.profile.base) / d.rowSize);
    const row = g.profile.rows[k];
    if (!row) return { profile: g.profile, price: null, count: 0, letter: null };
    const j = Math.floor((px - g.xa) / g.cw);
    return { profile: g.profile, price: g.profile.base + k * d.rowSize, count: row.length, letter: row[j] ?? null };
  }

  private x(t: number): number | null {
    const m = this.model;
    return logicalToX(this.p!.chart.timeScale() as unknown as LogicalScale, timeToLogical(m.times, m.span, t));
  }

  private draw(target: CanvasRenderingTarget2D) {
    const d = this.data, m = this.model;
    this.geo = [];
    if (!this.p || !d || !m.times.length) return;
    const s = this.s, P = m.palette;
    // Naked levels across all profiles, capped to the newest N untouched ones.
    const naked: Naked[] = [];
    for (const p of d.profiles) {
      if (!p.complete) continue;
      if (s.nakedPoc) naked.push({ profile: p, name: 'nPOC', price: p.poc, touched: p.touched.poc, start: p.start, color: P.paper, w: 1.5 });
      if (s.nakedVa) naked.push(
        { profile: p, name: 'nVAH', price: p.vah, touched: p.touched.vah, start: p.start, color: P.paperDim, w: 1 },
        { profile: p, name: 'nVAL', price: p.val, touched: p.touched.val, start: p.start, color: P.paperDim, w: 1 },
      );
    }
    const keep = keepNaked(naked, s.maxNaked);
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      this.width = mediaSize.width;
      ctx.save();
      d.profiles.forEach((p, i) => this.profile(ctx, p, i, d, naked.filter((l) => l.profile === p && keep.has(l)), mediaSize.width, mediaSize.height));
      ctx.restore();
    });
  }

  private profile(ctx: Ctx, p: TpoProfile, index: number, d: TpoResponse, naked: Naked[], W: number, H: number) {
    const { series } = this.p!;
    const s = this.s, P = this.model.palette, tick = this.model.tick;
    const last = index === d.profiles.length - 1;
    const xa = this.x(p.start), xb = this.x(p.end);
    if (xa === null || xb === null || xb < 0) return;
    const y = (price: number) => series.priceToCoordinate(price);
    const rs = d.rowSize;
    const y0 = y(p.base), y1 = y(p.base + rs);
    if (y0 === null || y1 === null) return;
    const rowH = Math.abs(y0 - y1);
    const widest = Math.max(1, ...p.rows.map((r) => r.length));
    const spacing = Math.max(0, s.spacing);
    const cw = Math.min(CELL_MAX, Math.max(0, xb - xa - spacing) / widest);
    const lineEnd = xb - spacing;
    // Lines stop at the profile's widest row by default; past it they would run over this session's candles.
    const profEnd = Math.min(lineEnd, xa + widest * cw);
    const extEnd = s.extend === 'profile' ? profEnd : s.extend === 'period' ? lineEnd : W;
    const room = (s.extend === 'right' ? W : lineEnd) - profEnd > 75;
    const n = p.periods.length;

    // Naked levels run right from the profile until price trades back to them.
    for (const l of naked) {
      const yy = y(l.price);
      const end = l.touched === null ? W : this.x(l.touched);
      if (yy === null || end === null || end <= profEnd || yy < 0 || yy > H) continue;
      ctx.strokeStyle = withAlpha(l.color, 0.7); ctx.lineWidth = l.w; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(profEnd, yy); ctx.lineTo(Math.min(end, W), yy); ctx.stroke();
      if (s.labels && l.touched === null) this.label(ctx, `${l.name} ${formatPrice(l.price, tick)}`, lineEnd + 4, yy - 6, withAlpha(l.color, 0.9));
    }
    ctx.setLineDash([]);
    if (xa > W || cw <= 0) return;
    this.geo.push({ profile: p, xa, cw, end: profEnd });

    if (s.fillVa) {
      const a = y(p.vah + rs / 2), b = y(p.val - rs / 2);
      if (a !== null && b !== null) { ctx.fillStyle = withAlpha(P.sky, 0.08); ctx.fillRect(xa, a, profEnd - xa, b - a); }
    }

    // Cells, batched by colour.
    const stops = s.customColors ? s.colors : periodStops(P);
    const flat = withAlpha(P.paperDim, 0.45);
    const batches = new Map<string, { alpha: number; path: Path2D }>();
    const text: Array<{ x: number; y: number; t: string; c: string }> = [];
    const showLetters = s.display !== 'blocks' && cw >= LETTER_MIN.w && rowH >= LETTER_MIN.h;
    const gap = cw >= 4 && rowH >= 4 ? 1 : 0;
    // Opening / closing range: the first N letters, and the last N of a finished profile.
    const inRange = (letter: number) => letter < s.openingRange || (p.complete && s.closingRange > 0 && letter >= n - s.closingRange);
    p.rows.forEach((row, i) => {
      const price = p.base + i * rs;
      const yc = y(price);
      if (yc === null || yc < -rowH || yc > H + rowH) return;
      const inVa = price >= p.val - rs / 4 && price <= p.vah + rs / 4;
      row.forEach((letter, j) => {
        const cx = xa + j * cw;
        if (cx > W) return;
        const base = s.sessionColors ? TPO_COLORS.sessions[index % 4]! : rampColor(stops, periodPosition(letter, n));
        const marked = inRange(letter) ? P.paper
          : s.highlightEnds && letter === 0 ? TPO_COLORS.start
          : s.highlightEnds && p.complete && letter === n - 1 ? TPO_COLORS.end : null;
        const color = marked ?? (inVa || !s.outsideVaFlat ? base : flat);
        const faded = !marked && !inVa && !s.outsideVaFlat;
        if (s.display !== 'letters' || !showLetters) {
          const alpha = (s.display === 'blocks+letters' && showLetters && !marked ? 0.5 : 0.85) * (faded ? 0.3 : 1);
          const key = `${color}|${alpha}`;
          const b = batches.get(key) ?? { alpha, path: new Path2D() };
          b.path.rect(cx, yc - rowH / 2 + gap / 2, cw - gap, rowH - gap);
          batches.set(key, b);
        }
        if (showLetters) {
          const c = s.display === 'letters' ? (faded ? withAlpha(P.paperDim, 0.3) : color) : marked === P.paper ? P.plate : P.paper;
          text.push({ x: cx + cw / 2, y: yc, t: tpoLetter(letter), c });
        }
      });
    });
    for (const [key, b] of batches) { ctx.globalAlpha = b.alpha; ctx.fillStyle = key.split('|')[0]!; ctx.fill(b.path); }
    ctx.globalAlpha = 1;
    if (text.length) {
      ctx.font = `600 ${Math.min(11, Math.floor(rowH * 0.9))}px Archivo, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const t of text) { ctx.fillStyle = t.c; ctx.fillText(t.t, t.x, t.y + 0.5); }
    }

    // Single prints: tint the one-letter cells.
    if (s.singles) {
      ctx.fillStyle = withAlpha(P.alert, 0.35);
      for (const [lo, hi] of p.singles) {
        const a = y(hi + rs / 2), b = y(lo - rs / 2);
        if (a !== null && b !== null) ctx.fillRect(xa, a, cw, b - a);
      }
    }
    // Poor high / low: a bar over the flat extreme.
    if (s.poorExtremes) {
      const mark = (price: number, edge: 1 | -1, name: string) => {
        const yy = y(price + (edge * rs) / 2);
        if (yy === null) return;
        const len = Math.min(widest, 4) * cw;
        ctx.fillStyle = P.seal; ctx.fillRect(xa, yy - 1, len, 2);
        if (s.labels && xb - xa > 70) this.label(ctx, name, xa + len + 3, yy, P.seal);
      };
      if (p.poorHigh) mark(p.high, 1, 'poor high');
      if (p.poorLow) mark(p.low, -1, 'poor low');
    }
    // Initial balance range: a bar along the left edge.
    if (s.ibRange) {
      const a = y(p.ibHigh), b = y(p.ibLow);
      if (a !== null && b !== null) { ctx.fillStyle = P.paper; ctx.fillRect(xa - 3, a, 2, b - a); }
    }

    // Horizontal levels from the profile's left edge to the chosen extension.
    const hline = (price: number, color: string, name: string | null, dash: number[]) => {
      const yy = y(price);
      if (yy === null || yy < 0 || yy > H) return;
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(xa, yy); ctx.lineTo(extEnd, yy); ctx.stroke();
      if (name && s.labels && room) this.label(ctx, `${name} ${formatPrice(price, tick)}`, profEnd + 4, yy, color);
    };
    if (s.midpoint) hline(p.mid, TPO_COLORS.midpoint, 'Mid', [2, 3]);
    if (s.ibLines) for (const [name, price] of ibLevels(p.ibHigh, p.ibLow, s.ibExt)) hline(price, name.length > 3 ? P.paperDim : withAlpha(P.paper, 0.75), name, [6, 3]);
    if (s.peaksValleys !== 'off') {
      const { peaks, valleys } = peaksValleys(p.rows.map((r) => r.length), s.pvSensitivity);
      if (s.peaksValleys !== 'valleys') for (const k of peaks) hline(p.base + k * rs, TPO_COLORS.peak, null, [1, 2]);
      if (s.peaksValleys !== 'peaks') for (const k of valleys) hline(p.base + k * rs, TPO_COLORS.valley, null, [1, 2]);
    }
    // The previous session's levels carried onto this profile.
    const prev = d.profiles[index - 1];
    if (s.prior && prev && (s.priorEvery || last)) {
      hline(prev.poc, withAlpha(P.paper, 0.8), 'pPOC', [2, 2]);
      hline(prev.vah, P.paperDim, 'pVAH', [2, 2]);
      hline(prev.val, P.paperDim, 'pVAL', [2, 2]);
      hline(prev.high, P.paperDim, 'pHi', [2, 2]);
      hline(prev.low, P.paperDim, 'pLo', [2, 2]);
    }
    // Value area: dashed lines on the outer edges of the VAH and VAL rows, so they never strike through letters.
    if (s.va) {
      for (const [price, edge, name] of [[p.vah, rs / 2, 'VAH'], [p.val, -rs / 2, 'VAL']] as const) {
        const yy = y(price + edge);
        if (yy === null || yy < 0 || yy > H) continue;
        ctx.strokeStyle = P.paperDim; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(xa, yy); ctx.lineTo(extEnd, yy); ctx.stroke();
        if (s.labels && room) this.label(ctx, `${name} ${formatPrice(price, tick)}`, profEnd + 4, yy, P.paperDim);
      }
    }
    // POC: the row outlined (OpenMarket style), continuing as a line when extended.
    const pa = y(p.poc + rs / 2), pb = y(p.poc - rs / 2), pc = y(p.poc);
    if (s.poc && pa !== null && pb !== null && pc !== null && pc >= 0 && pc <= H) {
      ctx.setLineDash([]); ctx.strokeStyle = P.paper; ctx.lineWidth = 1.5;
      ctx.strokeRect(xa - 0.5, pa, profEnd - xa + 1, Math.max(2, pb - pa));
      if (extEnd > profEnd) { ctx.beginPath(); ctx.moveTo(profEnd, pc); ctx.lineTo(extEnd, pc); ctx.stroke(); }
      if (s.labels && room) this.label(ctx, `POC ${formatPrice(p.poc, tick)}`, profEnd + 4, pc, P.paper);
    }
    // Developing POC / value area: where each stood after every letter, stepped across the session.
    if ((s.devPoc || s.devVa) && (s.devAll || last) && n > 0) {
      const xs = p.periods.map((t) => this.x(t));
      const blockS = n > 1 ? p.periods[n - 1]! - p.periods[n - 2]! : 1800;
      const tail = this.x(Math.min(p.end, p.periods[n - 1]! + blockS));
      const trail = (k: 0 | 1 | 2, color: string, w: number) => {
        ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash([]);
        ctx.beginPath();
        let started = false;
        p.developing.forEach((v, j) => {
          const from = xs[j], to = j + 1 < n ? xs[j + 1] : tail, yy = y(v[k]);
          if (from == null || to == null || yy === null) return;
          if (started) ctx.lineTo(from, yy); else { ctx.moveTo(from, yy); started = true; }
          ctx.lineTo(to, yy);
        });
        ctx.stroke();
      };
      if (s.devVa) { trail(1, withAlpha(P.paperDim, 0.8), 1); trail(2, withAlpha(P.paperDim, 0.8), 1); }
      if (s.devPoc) trail(0, withAlpha(P.paper, 0.9), 1.5);
    }
    ctx.setLineDash([]);
  }

  private label(ctx: Ctx, text: string, x: number, y: number, color: string) {
    ctx.font = '600 10px Archivo, system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width;
    // Keep labels inside the pane (a level of the latest profile starts at the right edge).
    if (x + w + 4 > this.width) x = this.width - w - 4;
    ctx.fillStyle = withAlpha(this.model.palette.plate, 0.8);
    ctx.fillRect(x - 2, y - 6, w + 4, 12);
    ctx.fillStyle = color; ctx.fillText(text, x, y + 0.5);
  }
}
