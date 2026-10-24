import { describe, expect, it, vi } from 'vitest';
import { externalProvider, yahooProvider } from '../src/data/providers.ts';
import { createMarket } from '../src/data/market.ts';

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('yahooProvider', () => {
  it('parses chart JSON and passes incomplete rows on as NaN (normalisation drops them with a warning)', async () => {
    const f = vi.fn(() => json({ chart: { result: [{ timestamp: [1, 2, 3], indicators: { quote: [{ open: [1, null, 3], high: [2, 2, 4], low: [0.5, 1, 2], close: [1.5, 1.5, 3.5], volume: [10, 20, 30] }] } }] } }));
    const rows = await yahooProvider(f as any).fetch('QQQ', 'D');
    expect(rows).toEqual([{ t: 1, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }, { t: 2, o: NaN, h: NaN, l: NaN, c: NaN, v: 20 }, { t: 3, o: 3, h: 4, l: 2, c: 3.5, v: 30 }]);
    expect((f.mock.calls[0] as any)[0]).toContain('interval=1d');
  });
  it('surfaces HTTP and API errors', async () => {
    await expect(yahooProvider((() => json({}, 429)) as any).fetch('QQQ', 'D')).rejects.toThrow(/HTTP 429/);
    await expect(yahooProvider((() => json({ chart: { error: { description: 'No data found' } } })) as any).fetch('ZZZ', 'D')).rejects.toThrow(/No data found/);
  });
});

describe('externalProvider', () => {
  it('accepts ms or s or ISO timestamps', async () => {
    const f = vi.fn(() => json([{ time: 1758000000000, open: 1, high: 2, low: 1, close: 2 }, { time: '2026-09-10T13:30:00Z', open: 1, high: 2, low: 1, close: 2, volume: 5 }]));
    const rows = await externalProvider('http://data:8000', 'k', f as any).fetch('QQQ', 'D');
    expect(rows.map((r) => r.t)).toEqual([1758000000, Date.parse('2026-09-10T13:30:00Z') / 1000]);
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe('http://data:8000/ohlc?ticker=QQQ&timeframe=D&limit=5000');
    expect(init.headers['X-API-Key']).toBe('k');
  });
});

describe('externalProvider — blank prices', () => {
  it('passes null prices on as NaN (not 0), so normalisation drops the row with a warning', async () => {
    const f = vi.fn(() => json([{ time: 1, open: 1, high: 2, low: 1, close: 2 }, { time: 2, open: 1, high: 2, low: 1, close: null }]));
    const rows = await externalProvider('http://data:8000', undefined, f as any).fetch('QQQ', 'D');
    expect(rows[0]!.c).toBe(2);
    expect(Number.isNaN(rows[1]!.c)).toBe(true);
  });
});

describe('market cache', () => {
  it('caches within TTL, de-duplicates in-flight requests, refetches after TTL', async () => {
    let t = 1000;
    const fetch = vi.fn(async () => [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 0 }]);
    const m = createMarket([{ id: 'p', fetch }], () => t);
    await Promise.all([m.fetchSet('QQQ', ['D']), m.fetchSet('QQQ', ['D'])]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await m.fetchSet('QQQ', ['D']);
    expect(fetch).toHaveBeenCalledTimes(1);
    t += 121;
    await m.fetchSet('QQQ', ['D']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('yahooProvider — incomplete latest bar (observed 2026-10-16)', () => {
  // Real shape: Oct 16 row had o/h/l/v but close=null after the session; meta had the last price.
  const t15 = Date.parse('2026-10-15T13:30:00Z') / 1000, t16 = Date.parse('2026-10-16T13:30:00Z') / 1000;
  const body = (meta: object, close16: number | null = null) => ({ chart: { result: [{
    meta, timestamp: [t15, t16],
    indicators: { quote: [{ open: [730, 725.4810180664062], high: [731, 725.9400024414062], low: [726, 707.22998046875], close: [728, close16], volume: [1, 66250770] }] },
  }] } });

  it('fills the blank close from the session price when it belongs to that bar', async () => {
    const meta = { regularMarketPrice: 709.8, regularMarketTime: Date.parse('2026-10-16T20:00:00Z') / 1000 };
    const rows = await yahooProvider((() => json(body(meta))) as any).fetch('QQQ', 'D');
    expect(rows[1]).toMatchObject({ o: 725.4810180664062, h: 725.9400024414062, l: 707.22998046875, c: 709.8 });
    expect(rows[1]!.note).toMatch(/close 709.8 taken from Yahoo's session price/);
    expect(rows[0]!.note).toBeUndefined();
  });

  it('does not borrow a session price from a different bar', async () => {
    const meta = { regularMarketPrice: 709.8, regularMarketTime: Date.parse('2026-10-19T20:00:00Z') / 1000 };
    const rows = await yahooProvider((() => json(body(meta))) as any).fetch('QQQ', 'D');
    expect(Number.isNaN(rows[1]!.c)).toBe(true); // passed on as NaN → dropped WITH a warning
  });

  it('a complete row is left untouched', async () => {
    const meta = { regularMarketPrice: 709.8, regularMarketTime: Date.parse('2026-10-16T20:00:00Z') / 1000 };
    const rows = await yahooProvider((() => json(body(meta, 709.79))) as any).fetch('QQQ', 'D');
    expect(rows[1]!.c).toBe(709.79);
    expect(rows[1]!.note).toBeUndefined();
  });
});
