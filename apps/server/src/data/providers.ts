/**
 * Market data providers. Each returns raw rows only — no completeness, no
 * alignment; bars.ts owns the contract.
 *
 * Adjustment policy: split-adjusted, NOT dividend-adjusted, for every provider
 * (Yahoo chart `quote` arrays are split-adjusted; the bundled data server uses
 * auto_adjust=False). Mixing policies across providers is what made the old
 * stack disagree with itself.
 */
import type { Timeframe } from '@paradise/contract';
import type { RawBar } from './bars.ts';

export interface Provider {
  readonly id: string;
  fetch(symbol: string, tf: Timeframe, signal?: AbortSignal): Promise<RawBar[]>;
}

export class ProviderError extends Error {
  constructor(readonly provider: string, message: string) { super(`${provider}: ${message}`); }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const YAHOO_PARAMS: Record<Timeframe, { interval: string; range: string }> = {
  '15m': { interval: '15m', range: '60d' },
  '30m': { interval: '30m', range: '60d' },
  '1H': { interval: '60m', range: '730d' },
  D: { interval: '1d', range: '5y' },
  W: { interval: '1wk', range: '10y' },
  M: { interval: '1mo', range: 'max' },
};

export function yahooProvider(fetchImpl: FetchLike = fetch, base = 'https://query1.finance.yahoo.com'): Provider {
  return {
    id: 'yahoo',
    async fetch(symbol, tf, signal) {
      const p = YAHOO_PARAMS[tf];
      const url = `${base}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${p.interval}&range=${p.range}&includePrePost=false&events=div%2Csplit`;
      const res = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0 (paradise-matrix)' }, signal: signal ?? AbortSignal.timeout(15_000) });
      if (!res.ok) throw new ProviderError('yahoo', `HTTP ${res.status} for ${symbol} ${tf}`);
      const json: any = await res.json();
      const r = json?.chart?.result?.[0];
      if (!r) throw new ProviderError('yahoo', json?.chart?.error?.description ?? `no data for ${symbol}`);
      const ts: number[] = r.timestamp ?? [];
      const q = r.indicators?.quote?.[0] ?? {};
      const out: RawBar[] = [];
      for (let i = 0; i < ts.length; i++) {
        const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
        if (o == null || h == null || l == null || c == null) continue;
        out.push({ t: ts[i]!, o, h, l, c, v: q.volume?.[i] ?? 0 });
      }
      if (!out.length) throw new ProviderError('yahoo', `empty series for ${symbol} ${tf}`);
      return out;
    },
  };
}

/** The bundled data-server (data-server/server.py) or any service returning [{time,open,high,low,close,volume}]. */
export function externalProvider(baseUrl: string, apiKey?: string, fetchImpl: FetchLike = fetch): Provider {
  return {
    id: 'external',
    async fetch(symbol, tf, signal) {
      const url = new URL('/ohlc', baseUrl);
      url.searchParams.set('ticker', symbol);
      url.searchParams.set('timeframe', tf);
      url.searchParams.set('limit', '5000');
      const headers: Record<string, string> = {};
      if (apiKey) headers['X-API-Key'] = apiKey;
      const res = await fetchImpl(url.toString(), { headers, signal: signal ?? AbortSignal.timeout(20_000) });
      if (!res.ok) throw new ProviderError('external', `HTTP ${res.status} for ${symbol} ${tf}`);
      const json: any = await res.json();
      const rows: any[] = Array.isArray(json) ? json : json?.candles ?? json?.data ?? [];
      const out: RawBar[] = rows.map((c) => {
        let t = typeof c.time === 'string' ? Date.parse(c.time) / 1000 : Number(c.time);
        if (t > 1e12) t = Math.floor(t / 1000);
        return { t, o: Number(c.open), h: Number(c.high), l: Number(c.low), c: Number(c.close), v: Number(c.volume ?? 0) };
      });
      if (!out.length) throw new ProviderError('external', `empty series for ${symbol} ${tf}`);
      return out;
    },
  };
}

/** Replays recorded rows; used by tests and offline demos. */
export function staticProvider(id: string, data: Record<string, RawBar[]>): Provider {
  return {
    id,
    async fetch(symbol, tf) {
      const rows = data[`${symbol}:${tf}`];
      if (!rows) throw new ProviderError(id, `no fixture for ${symbol}:${tf}`);
      return rows;
    },
  };
}
