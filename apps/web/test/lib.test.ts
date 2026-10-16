import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decimalsForTick, formatDelta, formatPrice } from '../src/lib/format.ts';
import { placeLabels } from '../src/lib/layout.ts';
import { DEFAULT_VIEW, parseView, serializeView } from '../src/lib/view.ts';

describe('format', () => {
  it('decimals follow the tick, minimum two', () => {
    expect([0.01, 0.25, 1, 0.005, 0.0005, 1 / 64].map(decimalsForTick)).toEqual([2, 2, 2, 3, 4, 6]);
    expect(formatPrice(30824.4444, 0.25)).toBe('30,824.44');
    expect(formatPrice(2.5, 0.0005)).toBe('2.5000');
    expect(formatDelta(-1.5, 0.01)).toBe('−1.50');
  });
});

describe('placeLabels', () => {
  it('keeps labels apart and inside bounds while staying near their rule', () => {
    const out = placeLabels([{ item: 'a', y: 100 }, { item: 'b', y: 101 }, { item: 'c', y: 102 }, { item: 'd', y: 300 }], 15, 0, 400);
    const ys = out.map((o) => o.labelY);
    expect(ys).toEqual([100, 115, 130, 300]);
    const crowded = placeLabels(Array.from({ length: 5 }, (_, i) => ({ item: i, y: 395 })), 15, 0, 400);
    expect(crowded[crowded.length - 1]!.labelY).toBe(400);
    for (let i = 1; i < crowded.length; i++) expect(crowded[i]!.labelY - crowded[i - 1]!.labelY).toBeGreaterThanOrEqual(15);
  });
});

describe('view <-> URL', () => {
  it('round-trips', () => {
    const v = { ...DEFAULT_VIEW, symbol: 'NQ', timeframes: ['D' as const, '1H' as const], displacement: 0 as const, asOf: '2026-09-08T20:15:00.000Z', developing: true, profile: true, heat: false, zoom: 12, groups: ['structure' as const] };
    expect(parseView(serializeView(v))).toEqual(v);
  });
  it('defaults and rejects junk', () => {
    expect(parseView('')).toEqual(DEFAULT_VIEW);
    const v = parseView('?s=<script>&tf=X,D,9&z=7&asof=nope');
    expect(v.symbol).toBe('QQQ');
    expect(v.timeframes).toEqual(['D']);
    expect(v.zoom).toBe(DEFAULT_VIEW.zoom);
    expect(v.asOf).toBeNull();
  });
});

describe('boundary: proprietary engine never ships to the browser', () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  const src = join(__dirname, '../src');
  it('no web source imports @paradise/engine or engine paths', () => {
    for (const f of walk(src)) expect(readFileSync(f, 'utf8'), f).not.toMatch(/@paradise\/engine|packages\/engine/);
  });
  it('web package does not depend on the engine', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })).not.toContain('@paradise/engine');
  });
});
