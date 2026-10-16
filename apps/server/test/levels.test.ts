/**
 * End-to-end through the real HTTP API, fed the audit's NinjaTrader bars:
 * the server's confirmed levels for a display bar must equal what the
 * NinjaTrader Data Box showed on that bar.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LevelsResponse } from '@paradise/contract';
import { staticProvider, type Provider } from '../src/data/providers.ts';
import { at, captureRows, readJson, SLUG_TO_PLOT, startServer } from './helpers.ts';

const DAILY = 'c137807ce33941c68b4041437212a1f8';
const WEEKLY = 'a6fbac399fea4cc18801dcb91f02afb6';
const MONTHLY = '0ffdce94d99649059085d81491dcf9e4';

async function withServer(providers: Provider[], now: number, fn: (call: Awaited<ReturnType<typeof startServer>>['call'], token: string) => Promise<void>) {
  const s = await startServer(providers, () => now);
  try {
    await s.store.create('tester', 'correct-horse-battery');
    const login = await s.call('POST', '/api/auth/login', { username: 'tester', password: 'correct-horse-battery' });
    await fn(s.call, login.body.token);
  } finally { await s.close(); }
}

describe('Data Box parity through the API', () => {
  const cases = [
    { frame: 'daily', tf: 'D', id: DAILY, now: '2026-09-09T15:00:00Z', source: '2026-09-08', display: '2026-09-09' },
    { frame: 'weekly', tf: 'W', id: WEEKLY, now: '2026-07-22T15:00:00Z', source: 'wk 2026-07-13', display: 'wk 2026-07-20' },
    { frame: 'monthly', tf: 'M', id: MONTHLY, now: '2026-01-15T15:00:00Z', source: '2025-12', display: '2026-01' },
  ] as const;
  for (const c of cases) {
    it(`${c.frame}: display ${c.display} ← source ${c.source}, all 31 fields equal the Data Box`, async () => {
      const obs = readJson(`dwm-evidence/${c.frame}-alignment-results.json`);
      const { rows } = captureRows(c.id, obs.display_bar_index);
      await withServer([staticProvider('fixture', { [`QQQ:${c.tf}`]: rows })], at(c.now), async (call, token) => {
        const r = await call('POST', '/api/levels', { symbol: 'QQQ', timeframes: [c.tf] }, token);
        expect(r.status).toBe(200);
        const body = r.body as LevelsResponse;
        expect(body.frames[0]!.source!.label).toBe(c.source);
        expect(body.frames[0]!.display.label).toBe(c.display);
        const checks = new Map<string, any>(obs.checks.map((x: any) => [x.plot, x]));
        const confirmed = body.levels.filter((l) => l.basis === 'confirmed');
        expect(confirmed).toHaveLength(31);
        for (const l of confirmed) {
          const plot = SLUG_TO_PLOT[l.slug]!;
          expect(l.price === null ? 'n/a' : l.price.toFixed(2), `${l.slug} (${plot})`).toBe(checks.get(plot).displayed);
          expect(l.display.label).toBe(c.display);
          expect(l.source.complete).toBe(true);
          expect(l.displacement).toBe(1);
        }
        // Vendor names never cross the API boundary.
        expect(JSON.stringify(body)).not.toMatch(/PLDot|Envelope|Zone (Six|Five|Two|One)|Main Channel|Sell|Buy|[HL] 1-1|1-1 Dot/);
      });
    });
  }
});

describe('/api/levels behaviour', () => {
  const { rows: daily } = captureRows(DAILY, 241); // through 2026-09-09
  const provider = staticProvider('fixture', { 'QQQ:D': daily });
  const midSession = at('2026-09-09T15:00:00Z');

  it('developing levels come from the forming bar and are drawn on the next trading day', async () => {
    await withServer([provider], midSession, async (call, token) => {
      const body = (await call('POST', '/api/levels', { symbol: 'QQQ', timeframes: ['D'], developing: true }, token)).body as LevelsResponse;
      const dev = body.levels.filter((l) => l.basis === 'developing');
      expect(dev).toHaveLength(31);
      expect(dev[0]!.source).toMatchObject({ label: '2026-09-09', complete: false });
      expect(dev[0]!.display.label).toBe('2026-09-10');
      expect(body.frames[0]!.developingSource!.label).toBe('2026-09-09');
      expect(body.lastPrice!.price).toBe(daily[241]!.c);
    });
  });

  it('displacement 0 draws confirmed levels on their own source bar', async () => {
    await withServer([provider], midSession, async (call, token) => {
      const body = (await call('POST', '/api/levels', { symbol: 'QQQ', timeframes: ['D'], displacement: 0 }, token)).body as LevelsResponse;
      expect(body.frames[0]!.display.label).toBe('2026-09-08');
      expect(body.levels.every((l) => l.displacement === 0)).toBe(true);
    });
  });

  it('as-of uses only bars complete at that instant and disables developing', async () => {
    await withServer([provider], midSession, async (call, token) => {
      const live = (await call('POST', '/api/levels', { symbol: 'QQQ', timeframes: ['D'] }, token)).body as LevelsResponse;
      const anchor = live.anchors[10]!;
      const past = (await call('POST', '/api/levels', { symbol: 'QQQ', timeframes: ['D'], asOf: anchor.end, developing: true }, token)).body as LevelsResponse;
      expect(past.frames[0]!.source!.label).toBe(anchor.label);
      expect(past.levels.some((l) => l.basis === 'developing')).toBe(false);
      expect(past.anchors[0]!.label).toBe(anchor.label);
      expect(past.asOf).toBe(anchor.end);
      // Same answer as truncating history at the anchor: no look-ahead.
      const idx = daily.findIndex((r) => new Date(r.t * 1000).toISOString().slice(0, 10) === anchor.label);
      const trunc = staticProvider('trunc', { 'QQQ:D': daily.slice(0, idx + 1) });
      await withServer([trunc], at('2026-12-31T00:00:00Z'), async (call2, token2) => {
        const t = (await call2('POST', '/api/levels', { symbol: 'QQQ', timeframes: ['D'] }, token2)).body as LevelsResponse;
        expect(t.levels.map((l) => l.price)).toEqual(past.levels.map((l) => l.price));
      });
    });
  });

  it('stacked request returns coarse-to-fine frames with per-timeframe sources', async () => {
    const w = captureRows(WEEKLY).rows.filter((r) => r.t < at('2026-09-09T00:00:00Z'));
    const m = captureRows(MONTHLY).rows.filter((r) => r.t < at('2026-09-09T00:00:00Z'));
    const p = staticProvider('fixture', { 'QQQ:D': daily, 'QQQ:W': w, 'QQQ:M': m });
    await withServer([p], midSession, async (call, token) => {
      const body = (await call('POST', '/api/levels', { symbol: 'QQQ', timeframes: ['D', 'M', 'W'] }, token)).body as LevelsResponse;
      expect(body.frames.map((f) => f.tf)).toEqual(['M', 'W', 'D']);
      expect(body.frames.map((f) => f.source!.label)).toEqual(['2026-08', 'wk 2026-08-31', '2026-09-08']);
      expect(body.levels.filter((l) => l.basis === 'confirmed')).toHaveLength(93);
      for (const f of body.frames) expect(f.atr).toBeGreaterThan(0);
    });
  });

  it('never mixes providers: one failing timeframe moves the whole set to the next provider', async () => {
    const partial = staticProvider('primary', { 'QQQ:D': daily }); // no W
    const w = captureRows(WEEKLY).rows.filter((r) => r.t < midSession);
    const full = staticProvider('backup', { 'QQQ:D': daily, 'QQQ:W': w });
    await withServer([partial, full], midSession, async (call, token) => {
      const body = (await call('POST', '/api/levels', { symbol: 'QQQ', timeframes: ['W', 'D'] }, token)).body as LevelsResponse;
      expect(body.dataSource).toBe('backup');
    });
  });

  it('503 when every provider fails; 400 for bad input', async () => {
    await withServer([staticProvider('empty', {})], midSession, async (call, token) => {
      expect((await call('POST', '/api/levels', { symbol: 'QQQ', timeframes: ['D'] }, token)).status).toBe(503);
      expect((await call('POST', '/api/levels', { symbol: 'XX=F', timeframes: ['D'] }, token)).status).toBe(400);
      expect((await call('POST', '/api/levels', { symbol: 'QQQ', timeframes: [] }, token)).status).toBe(400);
      expect((await call('POST', '/api/levels', { symbol: 'QQQ', timeframes: ['D'], displacement: 2 }, token)).status).toBe(400);
      expect((await call('POST', '/api/levels', { symbol: 'QQQ', timeframes: ['D'], asOf: '2099-01-01T00:00:00Z' }, token)).status).toBe(400);
      expect((await call('POST', '/api/levels', '{bad json', token)).status).toBe(400);
    });
  });
});

describe('profile levels', () => {
  it('builds POC/VAH/VAL for the prior completed session, drawn on the next', async () => {
    const { rows: daily } = captureRows(DAILY, 241);
    // Synthetic 30m bars for 2026-09-08 (complete) and 2026-09-09 (forming), centred near the D close.
    const base = daily[240]!.c;
    const thirty = (date: string, n: number, centre: number) => Array.from({ length: n }, (_, i) => {
      const t = at(`${date}T13:30:00Z`) + i * 1800;
      const c = centre + Math.sin(i) * 0.6;
      return { t, o: c, h: c + 0.3, l: c - 0.3, c, v: 0 };
    });
    const p = staticProvider('fixture', { 'QQQ:D': daily, 'QQQ:30m': [...thirty('2026-09-08', 13, base), ...thirty('2026-09-09', 3, base + 2)] });
    await withServer([p], at('2026-09-09T15:00:00Z'), async (call, token) => {
      const body = (await call('POST', '/api/levels', { symbol: 'QQQ', timeframes: ['D'], profile: true, developing: true }, token)).body as LevelsResponse;
      const prof = body.levels.filter((l) => l.group === 'profile');
      const confirmed = prof.filter((l) => l.basis === 'confirmed');
      expect(confirmed.map((l) => l.slug)).toEqual(['vah', 'poc', 'val']);
      expect(confirmed[0]!.source.label).toBe('2026-09-08');
      expect(confirmed[0]!.display.label).toBe('2026-09-09');
      expect(confirmed[0]!.price!).toBeGreaterThanOrEqual(confirmed[1]!.price!);
      expect(confirmed[1]!.price!).toBeGreaterThanOrEqual(confirmed[2]!.price!);
      expect(prof.filter((l) => l.basis === 'developing')).toHaveLength(3);
      expect(body.engineVersion).toMatch(/profile-tpo@1/);
    });
  });
});
