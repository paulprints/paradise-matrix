import { useEffect, useState } from 'react';
import type { TpoResponse } from '@paradise/contract';
import { api } from './api.ts';
import type { TpoSettings } from './lib/tpo.ts';

const POLL_MS = 30_000;

/** TPO profiles for the chart: loads when the settings change, refreshes every 30 s while the tab is visible. */
export function useTpo(symbol: string, s: TpoSettings, enabled: boolean) {
  const [data, setData] = useState<TpoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const req = { symbol, session: s.session, block: s.block, ...(s.rowTicks ? { rowTicks: s.rowTicks } : {}), valueArea: s.valueArea, vaMethod: s.vaMethod, ibMinutes: s.ibMinutes, profiles: s.session === 'D' ? 30 : 12 };
  const key = JSON.stringify(req);

  useEffect(() => {
    // New symbol or settings: drop the old profiles, so a failed load never leaves another chart's letters on screen.
    setData(null);
    if (!enabled) return;
    const ctrl = new AbortController();
    const load = () => api.tpo(req, ctrl.signal)
      .then((r) => { setData(r); setError(null); })
      .catch((e) => { if ((e as Error).name !== 'AbortError') setError((e as Error).message); });
    void load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => { ctrl.abort(); clearInterval(id); };
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data: enabled ? data : null, error: enabled ? error : null };
}
