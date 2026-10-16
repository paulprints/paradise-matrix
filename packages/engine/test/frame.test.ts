import { describe, expect, it } from 'vitest';
import { buildFrame, levelsAt, averageTrueRange, closesVsPivot, pivotDirection, type EngineBar } from '../src/frame.ts';
import { evaluate } from '../src/formulas.ts';
import { loadCapture, readJson, toHlc } from './fixtures.ts';

const asEngine = (file: string): EngineBar[] =>
  loadCapture(file).bars.map((b, i) => ({ ...toHlc(b), o: Number(b.open), v: 0, t: i, end: i, complete: !b.excluded_potentially_developing }));

describe('display alignment — real NinjaTrader Data Box observations', () => {
  for (const frame of ['daily', 'weekly', 'monthly']) {
    const obs = readJson(`dwm-evidence/${frame}-alignment-results.json`);
    it(`${frame}: display ${obs.display_bar_time.slice(0, 10)} ← source ${obs.source_bar_time.slice(0, 10)} (d=${obs.displacement}) matches all 31 fields`, () => {
      const cap = loadCapture(`audit-${obs.capture_id}.jsonl`);
      const bars = asEngine(`audit-${obs.capture_id}.jsonl`);
      // The display bar is the one the user looks at; its levels come from display − d.
      const source = obs.display_bar_index - obs.displacement;
      expect(source).toBe(obs.source_bar_index);
      expect(cap.bars[source]!.bar_time_local).toBe(obs.source_bar_time);
      expect(cap.bars[obs.display_bar_index]!.bar_time_local).toBe(obs.display_bar_time);
      const lv = levelsAt(bars, source, 'confirmed', obs.displacement);
      const checks = new Map<string, any>(obs.checks.map((c: any) => [c.plot, c]));
      let compared = 0;
      for (const l of lv) {
        const c = checks.get(l.plot);
        if (!c) continue;
        expect(l.state, l.plot).not.toBe('boundary');
        expect(l.price === null ? 'n/a' : l.price.toFixed(2), l.plot).toBe(c.displayed);
        expect(l.displayIndex).toBe(obs.display_bar_index);
        compared++;
      }
      expect(compared).toBe(31);
    });
  }
});

describe('buildFrame', () => {
  const bars = asEngine('audit-c137807ce33941c68b4041437212a1f8.jsonl');
  const last = bars.length - 1;

  it('confirmed levels come from the confirmed bar and are drawn displacement bars later', () => {
    const f = buildFrame({ bars, displacement: 1, confirmedIndex: last - 1, developingIndex: last, lastPrice: bars[last]!.c });
    const confirmed = f.levels.filter((l) => l.basis === 'confirmed');
    const developing = f.levels.filter((l) => l.basis === 'developing');
    expect(confirmed).toHaveLength(31);
    expect(developing).toHaveLength(31);
    expect(confirmed.every((l) => l.sourceIndex === last - 1 && l.displayIndex === last)).toBe(true);
    expect(developing.every((l) => l.sourceIndex === last && l.displayIndex === last + 1)).toBe(true);
    expect(f.facts.locationBand).toBeGreaterThanOrEqual(0);
    expect(f.facts.locationBand).toBeLessThanOrEqual(7);
  });

  it('displacement 0 draws at the source bar; arithmetic is identical', () => {
    const a = buildFrame({ bars, displacement: 0, confirmedIndex: 100, developingIndex: null, lastPrice: null });
    const b = buildFrame({ bars, displacement: 1, confirmedIndex: 100, developingIndex: null, lastPrice: null });
    expect(a.levels.map((l) => l.price)).toEqual(b.levels.map((l) => l.price));
    expect(a.displayIndex).toBe(100);
    expect(b.displayIndex).toBe(101);
  });

  it('inactive and boundary levels expose no price', () => {
    for (let i = 5; i < 200; i++) {
      for (const l of levelsAt(bars, i, 'confirmed', 1)) if (l.state !== 'active') expect(l.price).toBeNull();
    }
  });

  it('refuses too little history instead of fabricating levels', () => {
    const f = buildFrame({ bars: bars.slice(0, 4), displacement: 1, confirmedIndex: 3, developingIndex: null, lastPrice: 1 });
    expect(f.levels).toHaveLength(0);
    expect(f.sourceIndex).toBeNull();
    expect(f.warnings[0]).toMatch(/needs 5 complete bars/);
  });

  it('rejects a developing index that is not after the confirmed one', () => {
    expect(() => buildFrame({ bars, displacement: 1, confirmedIndex: 50, developingIndex: 50, lastPrice: null })).toThrow(RangeError);
    expect(() => buildFrame({ bars, displacement: 2 as 1, confirmedIndex: 50, developingIndex: null, lastPrice: null })).toThrow(TypeError);
  });

  it('never reads bars after the source (no future leak)', () => {
    const cut = 120;
    const full = levelsAt(bars, cut, 'confirmed', 1).map((l) => l.price);
    const truncated = levelsAt(bars.slice(0, cut + 1), cut, 'confirmed', 1).map((l) => l.price);
    expect(truncated).toEqual(full);
  });
});

describe('facts', () => {
  const mk = (cs: number[]) => cs.map((c) => ({ h: c + 1, l: c - 1, c }));
  it('pivot direction counts a rising run', () => {
    expect(pivotDirection(mk([1, 2, 3, 4, 5, 6, 7, 8]), 7)).toEqual({ sign: 1, bars: 5 });
  });
  it('pivot direction flat', () => {
    expect(pivotDirection(mk([5, 5, 5, 5, 5, 5]), 5)).toEqual({ sign: 0, bars: 0 });
  });
  it('closes vs pivot uses the pivot drawn on each bar (displacement-aware)', () => {
    const b = mk([10, 10, 10, 11, 12, 13, 14]);
    expect(closesVsPivot(b, 6, 1)).toEqual({ side: 'above', bars: 4 });
    expect(closesVsPivot(b, 6, 0)!.side).toBe('above');
  });
  it('ATR is the mean true range including gaps', () => {
    const b = [{ h: 10, l: 9, c: 9.5 }, { h: 12, l: 11, c: 11.5 }]; // gap: TR = 12 − 9.5
    expect(averageTrueRange(b, 1)).toBeCloseTo(2.5);
    expect(averageTrueRange(b, 0)).toBeNull();
  });
  it('evaluate rejects insufficient windows', () => {
    expect(() => evaluate(mk([1, 2, 3, 4]), 3)).toThrow(RangeError);
  });
});
