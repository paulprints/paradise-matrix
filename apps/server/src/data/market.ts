/**
 * Market data service: one provider per response (never mixed), parallel
 * timeframe fetches, a TTL cache and in-flight de-duplication.
 */
import type { Timeframe } from '@paradise/contract';
import type { RawBar } from './bars.ts';
import type { Provider } from './providers.ts';

const TTL_S: Record<Timeframe, number> = { '1m': 10, '5m': 15, '15m': 30, '30m': 45, '1H': 60, D: 120, W: 300, M: 600 };
const MAX_ENTRIES = 400;

export interface FetchedSet { provider: string; rows: Map<Timeframe, RawBar[]> }

export interface Market {
  fetchSet(symbol: string, tfs: readonly Timeframe[]): Promise<FetchedSet>;
  readonly providers: readonly string[];
}

export function createMarket(providers: readonly Provider[], clock: () => number = () => Date.now() / 1000): Market {
  if (!providers.length) throw new Error('at least one provider is required');
  const cache = new Map<string, { at: number; rows: RawBar[] }>();
  const inflight = new Map<string, Promise<RawBar[]>>();

  async function get(p: Provider, symbol: string, tf: Timeframe): Promise<RawBar[]> {
    const key = `${p.id}|${symbol}|${tf}`;
    const hit = cache.get(key);
    if (hit && clock() - hit.at < TTL_S[tf]) return hit.rows;
    const pending = inflight.get(key);
    if (pending) return pending;
    const job = p.fetch(symbol, tf)
      .then((rows) => {
        cache.delete(key);
        cache.set(key, { at: clock(), rows });
        while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
        return rows;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  }

  return {
    providers: providers.map((p) => p.id),
    async fetchSet(symbol, tfs) {
      const errors: string[] = [];
      for (const p of providers) {
        try {
          const results = await Promise.all(tfs.map((tf) => get(p, symbol, tf)));
          return { provider: p.id, rows: new Map(tfs.map((tf, i) => [tf, results[i]!])) };
        } catch (e: any) {
          errors.push(e?.message ?? String(e));
        }
      }
      throw new MarketDataError(errors);
    },
  };
}

export class MarketDataError extends Error {
  constructor(readonly attempts: string[]) { super(`All data providers failed: ${attempts.join('; ')}`); }
}
