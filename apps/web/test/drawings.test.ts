import { describe, expect, it } from 'vitest';
import type { Drawing } from '@paradise/contract';
import { distToSegment, extendRay, hitTest, newId, simplify, translate, type Project } from '../src/drawings/geometry.ts';

// identity-ish projection: x = t, y = 1000 − p
const project: Project = (a) => ({ x: a.t, y: 1000 - a.p });
const size = { width: 800, height: 600 };
const mt = (s: string) => s.length * 7;

const D: Drawing[] = [
  { id: 'r', kind: 'rect', color: 'sky', a: { t: 100, p: 900 }, b: { t: 300, p: 800 } },
  { id: 't', kind: 'trend', color: 'seal', a: { t: 100, p: 500 }, b: { t: 200, p: 400 }, extend: false },
  { id: 'h', kind: 'hline', color: 'ink', p: 300 },
  { id: 'v', kind: 'vline', color: 'paper', t: 600 },
  { id: 'x', kind: 'text', color: 'alert', a: { t: 400, p: 950 }, text: 'Note' },
  { id: 'b', kind: 'brush', color: 'paper', pts: [{ t: 500, p: 100 }, { t: 550, p: 150 }, { t: 600, p: 100 }] },
];

describe('geometry', () => {
  it('distance to a segment clamps to endpoints', () => {
    expect(distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distToSegment({ x: 15, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });
  it('rays extend forward to the pane edge', () => {
    expect(extendRay({ x: 0, y: 0 }, { x: 10, y: 10 }, 800)).toEqual({ x: 800, y: 800 });
  });
  it('hit-tests each kind and returns the nearest', () => {
    const at = (x: number, y: number, sel: string | null = null) => hitTest(D, { x, y }, project, size, sel, mt)?.id ?? null;
    expect(at(150, 550)).toBe('t');      // on the trend line
    expect(at(200, 150)).toBe('r');      // inside the rectangle
    expect(at(50, 700)).toBe('h');       // on the horizontal line
    expect(at(600, 10)).toBe('v');       // on the vertical line
    expect(at(410, 48)).toBe('x');       // on the text
    expect(at(525, 875)).toBe('b');      // on the brush stroke
    expect(at(700, 400)).toBeNull();     // empty space
  });
  it('offers endpoint handles only on the selected drawing', () => {
    expect(hitTest(D, { x: 100, y: 500 }, project, size, null, mt)?.handle).toBe('body');
    expect(hitTest(D, { x: 100, y: 500 }, project, size, 't', mt)?.handle).toBe('a');
    expect(hitTest(D, { x: 201, y: 600 }, project, size, 't', mt)?.handle).toBe('b');
  });
  it('simplifies a noisy stroke but keeps corners', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i % 2 ? 0.3 : 0 }));
    expect(simplify(line, 1)).toHaveLength(2);
    const corner = [...Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0 })), ...Array.from({ length: 20 }, (_, i) => ({ x: 19, y: i + 1 }))];
    expect(simplify(corner, 1)).toEqual([{ x: 0, y: 0 }, { x: 19, y: 0 }, { x: 19, y: 20 }]);
  });
  it('translates every anchor and keeps times integral', () => {
    const t = translate(D[1]!, 10.4, 5) as Extract<Drawing, { kind: 'trend' }>;
    expect([t.a, t.b]).toEqual([{ t: 110, p: 505 }, { t: 210, p: 405 }]);
    expect((translate(D[2]!, 99, 1) as Extract<Drawing, { kind: 'hline' }>).p).toBe(301);
    expect((translate(D[5]!, 1, 1) as Extract<Drawing, { kind: 'brush' }>).pts).toHaveLength(3);
  });
  it('ids are short and unique', () => {
    const ids = new Set(Array.from({ length: 200 }, newId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(16);
  });
});
