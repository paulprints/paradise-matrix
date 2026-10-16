import { useEffect, useRef, useState } from 'react';
import type { LevelsResponse } from '@paradise/contract';
import { api, ApiError } from './api.ts';
import type { ViewState } from './lib/view.ts';

const LIVE_REFRESH_MS = 60_000;

/**
 * Fetches levels for the server-relevant part of the view. Client-only
 * settings (heat, groups, zoom) never trigger a request. Keeps the previous
 * result on screen while loading; refreshes live views every minute while visible.
 */
export function useLevels(view: ViewState, enabled: boolean) {
  const [data, setData] = useState<LevelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const ctrl = useRef<AbortController | null>(null);

  const key = JSON.stringify([view.symbol, view.timeframes, view.displacement, view.asOf, view.developing, view.profile]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(async () => {
      ctrl.current?.abort();
      const c = (ctrl.current = new AbortController());
      setLoading(true);
      try {
        const res = await api.levels({
          symbol: view.symbol, timeframes: view.timeframes, displacement: view.displacement,
          asOf: view.asOf, developing: view.developing, profile: view.profile,
        }, c.signal);
        setData(res);
        setError(null);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setError(e instanceof ApiError && e.status === 503
          ? 'Market data is unavailable right now. The last result stays on screen; try again shortly.'
          : (e as Error).message);
      } finally {
        if (ctrl.current === c) setLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [key, enabled, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled || view.asOf) return;
    const id = setInterval(() => { if (document.visibilityState === 'visible') setTick((t) => t + 1); }, LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [enabled, view.asOf]);

  return { data, error, loading, refresh: () => setTick((t) => t + 1) };
}
