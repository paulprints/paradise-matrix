import { describe, expect, it } from 'vitest';
import type { LevelKey } from '@paradise/contract';
import { approach, easeOut } from '../src/lib/motion.ts';
import { justConfirmed, type Segment } from '../src/chart/state.ts';

const key: LevelKey = { slug: 'pivot', label: 'Pivot', group: 'structure', family: 'pivot' } as LevelKey;
const seg = (developing: boolean, k = 0, from = 1000, tf: Segment['tf'] = '15m'): Segment =>
  ({ id: `${tf}:${developing ? 1 : 0}:${k}:${from}`, key, tf, price: 100, from, to: from + 900, developing, source: from - 900 });

describe('motion helpers', () => {
  it('easeOut runs 0 → 1, front-loaded, clamped', () => {
    expect([easeOut(-1), easeOut(0), easeOut(1), easeOut(2)]).toEqual([0, 0, 1, 1]);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });

  it('approach closes the gap without overshoot, independent of frame rate', () => {
    expect(approach(0, 100, 0, 50)).toBe(0);
    const one = approach(0, 100, 32, 50);
    const two = approach(approach(0, 100, 16, 50), 100, 16, 50);
    expect(one).toBeCloseTo(two, 9); // two 16 ms frames == one 32 ms frame
    expect(approach(0, 100, 1000, 50)).toBeLessThanOrEqual(100);
    expect(approach(0, 100, 1000, 50)).toBeGreaterThan(99.99);
  });
});

describe('justConfirmed', () => {
  it('finds confirmed segments that replace a developing one (same tf, level, window)', () => {
    const prev = [seg(false, 0, 100), seg(true, 0, 1000), seg(true, 3, 1000)];
    const next = [seg(false, 0, 100), seg(false, 0, 1000), seg(true, 0, 1900)];
    expect([...justConfirmed(prev, next)]).toEqual(['15m:0:0:1000']);
  });

  it('ignores confirmed segments with no developing predecessor, and other timeframes', () => {
    expect(justConfirmed([seg(true, 0, 1000, 'D')], [seg(false, 0, 1000, '15m'), seg(false, 0, 5000, 'D')]).size).toBe(0);
    expect(justConfirmed([], [seg(false)]).size).toBe(0);
  });
});
