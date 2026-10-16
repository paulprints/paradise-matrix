import { describe, expect, it, vi } from 'vitest';
import { externalProvider, yahooProvider } from '../src/data/providers.ts';
import { createMarket } from '../src/data/market.ts';

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('yahooProvider', () => {
  it('parses chart JSON and skips null rows', async () => {
    const f = vi.fn(() => json({ chart: { result: [{ timestamp: [1, 2, 3], indicators: { quote: [{ open: [1, null, 3], high: [2, 2, 4], low: [0.5, 1, 2], close: [1.5, 1.5, 3.5], volume: [10, 20, 30] }] } }] } }));
    const rows = await yahooProvider(f as any).fetch('QQQ', 'D');
    expect(rows).toEqual([{ t: 1, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }, { t: 3, o: 3, h: 4, l: 2, c: 3.5, v: 30 }]);
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
