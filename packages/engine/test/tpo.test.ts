import { describe, expect, it } from 'vitest';
import { buildTpo, type TpoBlock } from '../src/tpo.ts';
import { computeProfile } from '../src/profile.ts';

const blk = (t: number, l: number, h: number, v = 0, o = l, c = h): TpoBlock => ({ t, o, h, l, c, v });

describe('buildTpo', () => {
  // Rows 100..104. A: 100–104, B: 101–103, C: 101–103, D: 102, E: 102 (same shape as the profile test).
  const blocks = [blk(0, 100, 104, 50), blk(1, 101, 103, 30), blk(2, 101, 103, 30), blk(3, 102, 102, 10), blk(4, 102, 102, 10)];

  it('lists letters per row and agrees with computeProfile on POC and value area', () => {
    const t = buildTpo(blocks, { rowSize: 1, ibBlocks: 2 })!;
    expect(t.base).toBe(100);
    expect(t.rows).toEqual([[0], [0, 1, 2], [0, 1, 2, 3, 4], [0, 1, 2], [0]]);
    const p = computeProfile(blocks, 1)!;
    expect([t.poc, t.vah, t.val, t.tpos]).toEqual([p.poc, p.vah, p.val, p.tpos]);
    expect([t.high, t.low, t.mid]).toEqual([104, 100, 102]);
    expect([t.above, t.below]).toEqual([4, 4]);
    expect([t.ibHigh, t.ibLow]).toEqual([104, 100]);
  });

  it('finds single prints, tails and poor extremes', () => {
    const t = buildTpo(blocks, { rowSize: 1, tailMin: 1 })!;
    expect(t.singles).toEqual([[100, 100], [104, 104]]);
    expect([t.buyTail, t.sellTail]).toEqual([1, 1]);
    expect([t.poorHigh, t.poorLow]).toEqual([false, false]);
    const flatTop = buildTpo([blk(0, 100, 103), blk(1, 101, 103), blk(2, 101, 102)], { rowSize: 1 })!;
    expect(flatTop.poorHigh).toBe(true);
    expect(flatTop.singles).toEqual([[100, 100]]);
    expect(flatTop.buyTail).toBe(0); // one single row < default tailMin 2
  });

  it('estimates volume per row by spreading each block evenly, and builds a volume value area', () => {
    const t = buildTpo(blocks, { rowSize: 1 })!;
    expect(t.volume.reduce((a, b) => a + b, 0)).toBeCloseTo(130);
    expect(t.volume[2]).toBeCloseTo(10 + 10 + 10 + 10 + 10); // 50/5 + 30/3 + 30/3 + 10 + 10
    expect(t.vpoc).toBe(102);
  });

  it('tracks the developing POC after each block, ending at the final one', () => {
    const t = buildTpo(blocks, { rowSize: 1 })!;
    expect(t.developing).toHaveLength(5);
    expect(t.developing[0]![0]).toBe(102); // one letter 100–104: mid-range wins the tie
    expect(t.developing[4]).toEqual([t.poc, t.vah, t.val]);
  });

  it('one-row method compares single rows', () => {
    // POC 10 (4), above 11:3 12:0, below 9:2 8:2 → two-row takes below (4 > 3), one-row takes above (3 > 2)
    const b = [blk(0, 8, 11), blk(1, 8, 11), blk(2, 10, 11), blk(3, 10, 10)];
    expect(buildTpo(b, { rowSize: 1, valueArea: 0.6, vaMethod: 'two' })!.val).toBe(8);
    expect(buildTpo(b, { rowSize: 1, valueArea: 0.6, vaMethod: 'one' })!.vah).toBe(11);
  });

  it('empty → null; bad args throw', () => {
    expect(buildTpo([], { rowSize: 1 })).toBeNull();
    expect(() => buildTpo(blocks, { rowSize: 0 })).toThrow();
    expect(() => buildTpo(blocks, { rowSize: 1, valueArea: 2 })).toThrow();
  });
});
