import { describe, expect, it } from 'vitest';
import type { Level } from '@paradise/contract';
import { bandwidthFor, computeHeat, referenceScore, zoneOf } from '../src/lib/heat.ts';

const lvl = (id: string, price: number | null, tf: Level['tf'] = 'D', extra: Partial<Level> = {}): Level => ({
  id, slug: id, label: id, group: 'structure', family: 'x', tf, state: price === null ? 'inactive' : 'active', price, basis: 'confirmed',
  source: { time: '', label: '', complete: true }, display: { time: null, label: null }, displacement: 1, provenance: 't', ...extra,
});

describe('computeHeat', () => {
  it('peaks at a level, falls to zero outside the kernel, and lists contributors', () => {
    const rows = computeHeat({ levels: [lvl('a', 100)], min: 90, max: 110, rows: 201, bandwidth: 2 });
    const at = (p: number) => rows.reduce((b, r) => (Math.abs(r.price - p) < Math.abs(b.price - p) ? r : b));
    expect(at(100).score).toBeCloseTo(1);
    expect(at(103).score).toBe(0);
    expect(at(100).contributors.map((c) => c.id)).toEqual(['a']);
    expect(rows[0]!.price).toBeCloseTo(110); // top row first
  });
  it('weights by timeframe and halves developing levels', () => {
    const rows = computeHeat({ levels: [lvl('m', 100, 'M'), lvl('d', 100, 'D', { basis: 'developing' })], min: 99, max: 101, rows: 3, bandwidth: 1 });
    expect(rows[1]!.score).toBeCloseTo(3 + 0.5);
  });
  it('uses a fixed scale: a lone daily level is never "terminal"', () => {
    const rows = computeHeat({ levels: [lvl('a', 100)], min: 99, max: 101, rows: 3, bandwidth: 1 });
    expect(rows[1]!.intensity).toBeCloseTo(1 / 3);
    expect(rows[1]!.zone).toBe('void');
  });
  it('reference scales with the heaviest frame shown: a lone monthly level is not terminal in a stacked view', () => {
    expect(referenceScore([lvl('d', 1, 'D')])).toBe(3);
    expect(referenceScore([lvl('d', 1, 'D'), lvl('m', 1, 'M')])).toBe(9);
    const rows = computeHeat({ levels: [lvl('m', 100, 'M'), lvl('d', 90, 'D')], min: 99, max: 101, rows: 3, bandwidth: 1 });
    expect(rows[1]!.intensity).toBeCloseTo(1 / 3);
    expect(rows[1]!.zone).toBe('void');
    const cluster = computeHeat({ levels: [lvl('m', 100, 'M'), lvl('w', 100, 'W'), lvl('d1', 100, 'D'), lvl('d2', 100, 'D'), lvl('d3', 100.1, 'D')], min: 99, max: 101, rows: 3, bandwidth: 1 });
    expect(['friction', 'terminal']).toContain(cluster[1]!.zone);
  });
  it('three coincident daily levels saturate to terminal', () => {
    const rows = computeHeat({ levels: [lvl('a', 100), lvl('b', 100), lvl('c', 100)], min: 99, max: 101, rows: 3, bandwidth: 1 });
    expect(rows[1]!.zone).toBe('terminal');
  });
  it('ignores inactive levels and degenerate inputs', () => {
    expect(computeHeat({ levels: [lvl('x', null)], min: 0, max: 1, rows: 5, bandwidth: 1 }).every((r) => r.score === 0)).toBe(true);
    expect(computeHeat({ levels: [], min: 1, max: 1, bandwidth: 1 })).toEqual([]);
    expect(computeHeat({ levels: [], min: 0, max: 1, bandwidth: 0 })).toEqual([]);
  });
  it('heat does not depend on tick size — bandwidth comes from ATR', () => {
    expect(bandwidthFor(10, 100)).toBeCloseTo(3);
    expect(bandwidthFor(null, 100)).toBeCloseTo(2.5);
  });
  it('zone thresholds', () => {
    expect([0.9, 0.7, 0.5, 0.1].map(zoneOf)).toEqual(['terminal', 'friction', 'transit', 'void']);
  });
});

import { viridis, VIRIDIS, VIRIDIS_GRADIENT } from '../src/lib/heat.ts';
import { zoneBlocks } from '../src/components/Ladder.tsx';
import { matrixAlpha } from '../src/chart/heatLayer.ts';

describe('matrix heat (v1 colour scale)', () => {
  it('hits the v1 stops exactly and clamps outside [0, 1]', () => {
    expect(viridis(0)).toEqual([68, 1, 84]);
    expect(viridis(0.5)).toEqual([33, 145, 140]);
    expect(viridis(1)).toEqual([253, 231, 37]);
    expect(viridis(-3)).toEqual(viridis(0));
    expect(viridis(9)).toEqual(viridis(1));
    expect(viridis(NaN)).toEqual(viridis(0));
  });
  it('gets brighter as intensity rises (perceived luminance increases)', () => {
    const lum = (t: number) => { const [r, g, b] = viridis(t); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    for (let t = 0; t < 1; t += 0.05) expect(lum(t + 0.05)).toBeGreaterThan(lum(t));
  });
  it('interpolates between stops', () => {
    expect(viridis(0.125)).toEqual([64, 42, 112]);
    expect(VIRIDIS_GRADIENT).toContain('rgb(253, 231, 37) 100%');
    expect(VIRIDIS).toHaveLength(5);
  });
  it('chart cells fade toward clear at low intensity but never hide candles', () => {
    expect(matrixAlpha(0)).toBeCloseTo(0.12);
    expect(matrixAlpha(1)).toBeCloseTo(0.72);
    expect(matrixAlpha(2)).toBeCloseTo(0.72);
  });
  it('zone blocks group contiguous rows and keep each run’s peak', () => {
    const rows = [0.9, 0.95, 0.7, 0.5, 0.1, 0.2, 0.88].map((intensity) => ({ intensity, zone: zoneOf(intensity) }));
    expect(zoneBlocks(rows)).toEqual([
      { zone: 'terminal', from: 0, to: 1, peak: 0.95 },
      { zone: 'friction', from: 2, to: 2, peak: 0.7 },
      { zone: 'transit', from: 3, to: 3, peak: 0.5 },
      { zone: 'void', from: 4, to: 5, peak: 0.2 },
      { zone: 'terminal', from: 6, to: 6, peak: 0.88 },
    ]);
    expect(zoneBlocks([])).toEqual([]);
  });
});
