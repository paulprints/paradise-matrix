import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api.ts';
import { applyChart, type ChartState } from './chart/state.ts';
import type { ViewState } from './lib/view.ts';

/** How often a live chart asks for new data, by chart timeframe. */
const POLL_MS: Record<string, number> = { '1m': 5_000, '5m': 10_000, '15m': 15_000, '30m': 30_000, '1H': 30_000, D: 60_000, W: 120_000, M: 120_000 };

/**
 * Full load when the view changes; then incremental polls (`since` = start of
 * the newest bar) merged into state. Polls pause while the tab is hidden.
 */
export function useChart(view: ViewState, enabled: boolean) {
  const [state, setState] = useState<ChartState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState(1000);
  const stateRef = useRef<ChartState | null>(null);
  stateRef.current = state;
  const key = JSON.stringify([view.symbol, view.chartTf, view.timeframes, view.displacement, view.developing, view.profile, history]);

  const request = (since?: number) => ({
    symbol: view.symbol, chartTf: view.chartTf, overlays: view.timeframes, displacement: view.displacement,
    developing: view.developing, profile: view.profile, bars: history, ...(since !== undefined ? { since } : {}),
  });

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    setLoading(true);
    api.chart(request(), ctrl.signal)
      .then((res) => { setState(applyChart(null, res)); setError(null); })
      .catch((e) => { if ((e as Error).name !== 'AbortError') setError(message(e)); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const id = setInterval(async () => {
      const cur = stateRef.current;
      if (!cur || document.visibilityState !== 'visible') return;
      const last = cur.bars[cur.bars.length - 1];
      if (!last) return;
      try {
        const res = await api.chart(request(last.t));
        if (!stopped) { setState((prev) => applyChart(prev, res)); setError(null); }
      } catch (e) {
        if (!stopped) setError(message(e));
      }
    }, POLL_MS[view.chartTf] ?? 30_000);
    return () => { stopped = true; clearInterval(id); };
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    state, error, loading,
    /** Ask for more history when the user scrolls to the left edge. */
    loadMore: () => setHistory((h) => (h >= 5000 ? h : Math.min(5000, h * 2))),
    canLoadMore: history < 5000,
    history,
  };
}

const message = (e: unknown) => e instanceof ApiError && e.status === 503
  ? 'Market data is unavailable right now. The chart keeps the last data; it will retry.'
  : (e as Error).message;
