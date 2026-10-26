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
import { INTRADAY_SECONDS, XNYS } from './calendar.ts';
import { localParts, localYmd } from './time.ts';

export interface Provider {
  readonly id: string;
  fetch(symbol: string, tf: Timeframe, signal?: AbortSignal): Promise<RawBar[]>;
}

export class ProviderError extends Error {
  constructor(readonly provider: string, message: string) { super(`${provider}: ${message}`); }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Longest span one bar of each timeframe can cover — bounds the session-summary match. */
const BAR_SPAN_S: Record<Timeframe, number> = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1H': 3600, D: 86_400, W: 7 * 86_400, M: 32 * 86_400 };

const YAHOO_PARAMS: Record<Timeframe, { interval: string; range: string }> = {
  '1m': { interval: '1m', range: '7d' },
  '5m': { interval: '5m', range: '60d' },
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
        // A blank (null) price must stay NaN, not become 0, so normalisation drops the row WITH a warning.
        return { t, o: Number(c.open ?? NaN), h: Number(c.high ?? NaN), l: Number(c.low ?? NaN), c: Number(c.close ?? NaN), v: Number(c.volume ?? 0) };
      });
      if (!out.length) throw new ProviderError('external', `empty series for ${symbol} ${tf}`);
      return out;
    },
  };
}

/** Massive history per timeframe, in days back from today (matches the Yahoo ranges above). M: from Massive's first record. */
const MASSIVE_PARAMS: Record<Timeframe, { span: string; days: number }> = {
  '1m': { span: '1/minute', days: 7 },
  '5m': { span: '5/minute', days: 60 },
  '15m': { span: '15/minute', days: 60 },
  '30m': { span: '30/minute', days: 60 },
  '1H': { span: '30/minute', days: 730 }, // Massive hours start on the clock (9:00); ours start at the 9:30 open, so pair up 30m bars
  D: { span: '1/day', days: 5 * 365 },
  W: { span: '1/week', days: 10 * 365 },
  M: { span: '1/month', days: 9000 },
};
const MASSIVE_MAX_PAGES = 40;

/**
 * Massive (formerly Polygon) stock and ETF bars, split-adjusted only (`adjusted=true`).
 * Plain US tickers only: indices (^SPX) and futures (ES=F, NQZ26.CME) are refused, so the
 * market falls through to the next provider (Yahoo) for them.
 * Intraday rows outside the regular session are dropped here, as Yahoo's includePrePost=false does.
 */
export function massiveProvider(apiKey: string, fetchImpl: FetchLike = fetch, base = 'https://api.massive.com', clock: () => number = () => Date.now() / 1000): Provider {
  return {
    id: 'massive',
    async fetch(symbol, tf, signal) {
      if (!/^[A-Z][A-Z0-9-]{0,9}$/.test(symbol)) throw new ProviderError('massive', `stocks and ETFs only, not ${symbol}`);
      const p = MASSIVE_PARAMS[tf];
      const now = clock();
      const from = localYmd(now - p.days * 86_400, 'America/New_York'), to = localYmd(now + 86_400, 'America/New_York');
      let url: string | null = `${base}/v2/aggs/ticker/${encodeURIComponent(symbol.replace(/-/g, '.'))}/range/${p.span}/${from}/${to}?adjusted=true&sort=asc&limit=50000`;
      const rows: any[] = [];
      for (let page = 0; url; page++) {
        if (page === MASSIVE_MAX_PAGES) throw new ProviderError('massive', `more than ${MASSIVE_MAX_PAGES} pages for ${symbol} ${tf}`);
        const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: signal ?? AbortSignal.timeout(20_000) });
        const json: any = await res.json().catch(() => ({}));
        if (!res.ok || json.status === 'ERROR' || json.status === 'NOT_AUTHORIZED') {
          throw new ProviderError('massive', `${json.error ?? json.message ?? `HTTP ${res.status}`} for ${symbol} ${tf}`);
        }
        rows.push(...(json.results ?? []));
        url = json.next_url ?? null;
      }
      let out: RawBar[] = rows.map((r) => ({
        // Massive's week bars start on Sunday 00:00 ET; the trading week (and our week key) starts Monday.
        t: Math.floor(r.t / 1000) + (tf === 'W' ? 86_400 : 0),
        o: Number(r.o ?? NaN), h: Number(r.h ?? NaN), l: Number(r.l ?? NaN), c: Number(r.c ?? NaN), v: Number(r.v ?? 0),
      }));
      if (INTRADAY_SECONDS[tf]) out = out.filter((b) => inRegularSession(b.t));
      if (tf === '1H') out = pairHalfHours(out);
      if (!out.some((b) => Number.isFinite(b.c))) throw new ProviderError('massive', `empty series for ${symbol} ${tf}`);
      return out;
    },
  };
}

function inRegularSession(t: number): boolean {
  const ymd = XNYS.sessionDateOf(t);
  return XNYS.isTradingDay(ymd) && t >= XNYS.sessionOpen(ymd) && t < XNYS.sessionClose(ymd);
}

/** Regular-session 30m bars → hours starting at :30 (9:30, 10:30, … 15:30), the same grid as Yahoo's 60m bars. */
export function pairHalfHours(bars: readonly RawBar[]): RawBar[] {
  const out: RawBar[] = [];
  for (const b of bars) {
    const prev = out[out.length - 1];
    if (prev && b.t - prev.t === 1800 && localParts(b.t, 'America/New_York').mi === 0) {
      out[out.length - 1] = { t: prev.t, o: prev.o, h: Math.max(prev.h, b.h), l: Math.min(prev.l, b.l), c: b.c, v: prev.v + b.v };
    } else out.push({ ...b });
  }
  return out;
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
