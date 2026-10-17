/** Screen-space geometry for drawing tools. Pure, so it's tested without a canvas. */
import type { Drawing } from '@paradise/contract';

export interface Pt { x: number; y: number }
export type Project = (a: { t: number; p: number }) => Pt | null;

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const u = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}

/** Extend a→b to the pane's right edge (rays only go forward in time). */
export function extendRay(a: Pt, b: Pt, width: number): Pt {
  if (b.x === a.x) return b;
  const slope = (b.y - a.y) / (b.x - a.x);
  const x = b.x > a.x ? width : 0;
  return { x, y: a.y + slope * (x - a.x) };
}

export type Handle = 'a' | 'b' | 'body';
export interface Hit { id: string; handle: Handle; distance: number }

const TOL = 6;

/** Topmost drawing under the cursor, preferring endpoint handles of the selected one. */
export function hitTest(drawings: readonly Drawing[], pt: Pt, project: Project, size: { width: number; height: number }, selected: string | null, measureText: (s: string) => number): Hit | null {
  let best: Hit | null = null;
  const consider = (h: Hit) => { if (h.distance <= TOL && (!best || h.distance < best.distance)) best = h; };
  for (let i = drawings.length - 1; i >= 0; i--) {
    const d = drawings[i]!;
    if (d.kind === 'trend' || d.kind === 'rect') {
      const a = project(d.a), b = project(d.b);
      if (!a || !b) continue;
      if (d.id === selected) {
        consider({ id: d.id, handle: 'a', distance: Math.hypot(pt.x - a.x, pt.y - a.y) - 2 });
        consider({ id: d.id, handle: 'b', distance: Math.hypot(pt.x - b.x, pt.y - b.y) - 2 });
      }
      if (d.kind === 'trend') consider({ id: d.id, handle: 'body', distance: distToSegment(pt, a, d.extend ? extendRay(a, b, size.width) : b) });
      else {
        const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)], [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
        const inside = pt.x >= x0 && pt.x <= x1 && pt.y >= y0 && pt.y <= y1;
        const edge = Math.min(distToSegment(pt, { x: x0, y: y0 }, { x: x1, y: y0 }), distToSegment(pt, { x: x1, y: y0 }, { x: x1, y: y1 }),
          distToSegment(pt, { x: x1, y: y1 }, { x: x0, y: y1 }), distToSegment(pt, { x: x0, y: y1 }, { x: x0, y: y0 }));
        consider({ id: d.id, handle: 'body', distance: inside ? Math.min(edge, TOL - 1) : edge });
      }
    } else if (d.kind === 'hline') {
      const y = project({ t: 0, p: d.p })?.y;
      if (y !== undefined) consider({ id: d.id, handle: 'body', distance: Math.abs(pt.y - y) });
    } else if (d.kind === 'vline') {
      const x = project({ t: d.t, p: 0 })?.x;
      if (x !== undefined) consider({ id: d.id, handle: 'body', distance: Math.abs(pt.x - x) });
    } else if (d.kind === 'text') {
      const a = project(d.a);
      if (!a) continue;
      const w = measureText(d.text);
      const inside = pt.x >= a.x - 2 && pt.x <= a.x + w + 2 && pt.y >= a.y - 10 && pt.y <= a.y + 6;
      if (inside) consider({ id: d.id, handle: 'body', distance: 0 });
    } else if (d.kind === 'brush') {
      const pts = d.pts.map(project).filter((p): p is Pt => !!p);
      for (let k = 1; k < pts.length; k++) consider({ id: d.id, handle: 'body', distance: distToSegment(pt, pts[k - 1]!, pts[k]!) });
    }
  }
  return best;
}

/** Ramer–Douglas–Peucker: keeps a freehand stroke's shape with far fewer points. */
export function simplify(points: readonly Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return [...points];
  let maxD = 0, idx = 0;
  const a = points[0]!, b = points[points.length - 1]!;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distToSegment(points[i]!, a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= epsilon) return [a, b];
  return [...simplify(points.slice(0, idx + 1), epsilon).slice(0, -1), ...simplify(points.slice(idx), epsilon)];
}

/** Move every anchor of a drawing by a time/price delta. */
export function translate(d: Drawing, dt: number, dp: number): Drawing {
  const mv = (a: { t: number; p: number }) => ({ t: Math.round(a.t + dt), p: a.p + dp });
  switch (d.kind) {
    case 'trend': case 'rect': return { ...d, a: mv(d.a), b: mv(d.b) };
    case 'hline': return { ...d, p: d.p + dp };
    case 'vline': return { ...d, t: Math.round(d.t + dt) };
    case 'text': return { ...d, a: mv(d.a) };
    case 'brush': return { ...d, pts: d.pts.map(mv) };
  }
}

export const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 16);
