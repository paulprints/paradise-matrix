import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TPO, loadTpo, periodPosition, saveTpo, tpoLetter } from '../src/lib/tpo.ts';
import { rampColor } from '../src/chart/tpoLayer.ts';

describe('TPO presentation', () => {
  afterEach(() => { try { localStorage.clear(); } catch { /* no storage */ } });
  it('letters run A–Z, a–z, then repeat', () => {
    expect([0, 25, 26, 51, 52].map(tpoLetter)).toEqual(['A', 'Z', 'a', 'z', 'A']);
  });
  it('colours run from the first stop to the last, quantised', () => {
    expect(rampColor(['#000000', '#ffffff'], 0)).toBe('rgb(0, 0, 0)');
    expect(rampColor(['#000000', '#ffffff'], 1)).toBe('rgb(255, 255, 255)');
    expect(rampColor(['#000000', '#ffffff'], 0.51)).toBe(rampColor(['#000000', '#ffffff'], 0.52));
    expect([periodPosition(0, 13), periodPosition(12, 13), periodPosition(0, 1)]).toEqual([0, 1, 0]);
  });
  it('settings round-trip and ignore unknown or mistyped keys', () => {
    if (typeof localStorage === 'undefined') return;
    saveTpo({ ...DEFAULT_TPO, block: '5m', rowTicks: 10 });
    expect(loadTpo()).toMatchObject({ block: '5m', rowTicks: 10 });
    localStorage.setItem('pp_tpo', JSON.stringify({ block: 5, bogus: true, valueArea: '80' }));
    expect(loadTpo()).toEqual(DEFAULT_TPO);
  });
});

import { ibLevels, keepNaked, peaksValleys } from '../src/lib/tpo.ts';

describe('TPO phase 2 helpers', () => {
  it('peaks and valleys beat every row within the window', () => {
    //          0  1  2  3  4  5  6  7  8
    const c = [1, 2, 5, 2, 1, 1, 0, 1, 3];
    expect(peaksValleys(c, 1)).toEqual({ peaks: [2], valleys: [6] });
    expect(peaksValleys(c, 2)).toEqual({ peaks: [2], valleys: [6] });
    expect(peaksValleys([3, 3, 3], 1)).toEqual({ peaks: [], valleys: [] }); // ties are neither
    expect(peaksValleys([1, 5, 1], 3)).toEqual({ peaks: [], valleys: [] }); // window runs off the profile
  });
  it('IB extensions are percentages of the IB range on each side', () => {
    expect(ibLevels(110, 100, [50, 0, 100, 0])).toEqual([['IBH', 110], ['IBL', 100], ['IBH +50%', 115], ['IBL −50%', 95], ['IBH +100%', 120], ['IBL −100%', 90]]);
  });
  it('the naked cap keeps the newest untouched levels and every touched one', () => {
    const l = [{ start: 1, touched: null }, { start: 2, touched: 9 }, { start: 3, touched: null }, { start: 4, touched: null }];
    expect([...keepNaked(l, 2)].map((x) => x.start).sort()).toEqual([2, 3, 4]);
    expect(keepNaked(l, 0).size).toBe(4);
  });
});
