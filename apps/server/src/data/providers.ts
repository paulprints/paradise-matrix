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

/** Longest span one bar of each timeframe can cover — bounds the session-summary match. */
const BAR_SPAN_S: Record<Timeframe, number> = { '15m': 900, '30m': 1800, '1H': 3600, D: 86_400, W: 7 * 86_400, M: 32 * 86_400 };

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
      const meta = r.meta ?? {};
      const out: RawBar[] = [];
      for (let i = 0; i < ts.length; i++) {
        let o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
        let note: string | undefined;
        // Yahoo sometimes publishes the latest bar with open/high/low but a blank close
        // for a while after the session ends. Its session summary (meta) carries the
        // real last price for that same session — use it only when the summary's
        // timestamp falls inside this exact bar.
        const last = i === ts.length - 1;
        const price = meta.regularMarketPrice, at = meta.regularMarketTime;
        if (last && c == null && o != null && h != null && l != null && Number.isFinite(price)
            && Number.isFinite(at) && at >= ts[i]! && at < ts[i]! + BAR_SPAN_S[tf]) {
          c = price;
          h = Math.max(h, price);
          l = Math.min(l, price);
          note = `close ${price} taken from Yahoo's session price (bar row had a blank close)`;
        }
        // Incomplete rows are passed on as NaN so normalisation drops them WITH a warning.
        if (o == null || h == null || l == null || c == null) { o = h = l = c = NaN; }
        out.push({ t: ts[i]!, o, h, l, c, v: q.volume?.[i] ?? 0, ...(note ? { note } : {}) });
      }
      if (!out.some((b) => Number.isFinite(b.c))) throw new ProviderError('yahoo', `empty series for ${symbol} ${tf}`);
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
