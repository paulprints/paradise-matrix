import { describe, expect, it } from 'vitest';
import { computeProfile, defaultRowSize } from '../src/profile.ts';

describe('computeProfile (TPO)', () => {
  it('finds POC and a 70% value area', () => {
    // Rows 100..104. Distribution (TPOs): 100:1 101:3 102:5 103:3 104:1  total 13
    const bars = [
      { l: 100, h: 104, c: 102 },
      { l: 101, h: 103, c: 102 },
      { l: 101, h: 103, c: 102 },
      { l: 102, h: 102, c: 102 },
      { l: 102, h: 102, c: 102 },
    ];
    const p = computeProfile(bars, 1)!;
    expect(p.poc).toBe(102);
    expect(p.tpos).toBe(13);
    // 70% of 13 = 9.1 → POC(5) + equal pairs both sides (101+100 = 4, 103+104 = 4) → whole range
    expect(p.val).toBe(100);
    expect(p.vah).toBe(104);
  });

  it('expands toward the heavier side', () => {
    const bars = [
      ...Array(6).fill({ l: 10, h: 10, c: 10 }),
      ...Array(4).fill({ l: 11, h: 12, c: 11 }),
      { l: 8, h: 8, c: 8 },
    ];
    const p = computeProfile(bars, 1)!;
    expect(p.poc).toBe(10);
    expect(p.val).toBe(10);
    expect(p.vah).toBe(12);
  });

  it('assigns a sub-row bar to the row nearest its close', () => {
    const p = computeProfile([{ l: 100.1, h: 100.2, c: 100.2 }], 0.5)!;
    expect(p.poc).toBe(100);
    expect(p.tpos).toBe(1);
  });

  it('handles fractional row sizes without float drift', () => {
    const p = computeProfile([{ l: 0.3, h: 0.6, c: 0.4 }, { l: 0.3, h: 0.4, c: 0.3 }], 0.1)!;
    expect([p.val, p.poc, p.vah].every((x) => Math.abs(x * 10 - Math.round(x * 10)) < 1e-9)).toBe(true);
    expect(p.poc).toBe(0.4); // 0.3 and 0.4 tie at 2 TPOs; 0.4 is nearer mid-range (0.45)
  });

  it('empty input → null; bad args throw', () => {
    expect(computeProfile([], 1)).toBeNull();
    expect(() => computeProfile([{ l: 1, h: 2, c: 1 }], 0)).toThrow();
  });
});

describe('defaultRowSize', () => {
  it('is a tick multiple near 0.05% of price', () => {
    expect(defaultRowSize(600, 0.01)).toBe(0.4);   // 0.30 raw → nice 40 ticks
    expect(defaultRowSize(30000, 0.25)).toBe(25);  // 15 raw → 60 ticks → nice 100 ticks
    expect(defaultRowSize(2, 0.01)).toBe(0.01);
    const r = defaultRowSize(4700, 0.1);
    expect(Math.abs(r / 0.1 - Math.round(r / 0.1))).toBeLessThan(1e-9);
  });
});
