import { describe, expect, it } from 'vitest';
import { candleColors, loadCandles, saveCandles } from '../src/lib/candles.ts';
import type { Palette } from '../src/chart/theme.ts';

const P = { plate: '#000000', paper: '#ffffff', alert: '#ff0000' } as Palette;

describe('candle colours', () => {
  it('follow the theme until the member sets a part', () => {
    expect(candleColors(P)).toMatchObject({ upColor: '#000000', wickUpColor: '#ffffff', downColor: '#ff0000' });
    expect(candleColors(P, { upColor: '#22ab94' })).toMatchObject({ upColor: '#22ab94', wickUpColor: '#ffffff' });
  });
  it('round-trip, keeping only known parts with #rrggbb values', () => {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
    saveCandles({ upColor: '#22ab94', downColor: 'red', wickUpColor: '#22AB94', bogus: '#123456' } as any);
    expect(loadCandles()).toEqual({ upColor: '#22ab94', wickUpColor: '#22AB94' });
  });
});
