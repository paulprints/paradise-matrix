import type { AddressInfo } from 'node:net';
import { loadCapture, readJson } from '../../../packages/engine/test/fixtures.ts';
import { weekKey } from '../src/data/calendar.ts';
import { zonedToUnix } from '../src/data/time.ts';
import type { RawBar } from '../src/data/bars.ts';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { UserStore } from '../src/auth/db.ts';
import { createMarket } from '../src/data/market.ts';
import type { Provider } from '../src/data/providers.ts';
import { PUBLIC_NAMES } from '../src/labels.ts';

export { readJson };
export const at = (s: string) => Date.parse(s) / 1000;

/**
 * Turn a NinjaTrader capture into provider rows with Yahoo-style timestamps
 * (period start at the 09:30 ET open). NT labels W/M bars by period end.
 */
export function captureRows(captureId: string, upTo?: number): { rows: RawBar[]; capture: ReturnType<typeof loadCapture> } {
  const capture = loadCapture(`audit-${captureId}.jsonl`);
  const kind = capture.meta.bars_period_type as 'Day' | 'Week' | 'Month';
  const rows = capture.bars.slice(0, upTo === undefined ? undefined : upTo + 1).map((b) => {
    const date = b.bar_time_local.slice(0, 10);
    const start = kind === 'Day' ? date : kind === 'Week' ? weekKey(date) : `${date.slice(0, 7)}-01`;
    return { t: zonedToUnix(start, 9, 30, 'America/New_York'), o: +b.open, h: +b.high, l: +b.low, c: +b.close, v: 0 };
  });
  return { rows, capture };
}

export const SLUG_TO_PLOT = Object.fromEntries(Object.entries(PUBLIC_NAMES).map(([plot, n]) => [n.slug, plot]));

export async function startServer(providers: Provider[], now: () => number) {
  const config = loadConfig({ NODE_ENV: 'test', DATA_PROVIDERS: 'yahoo' });
  const store = await UserStore.open(':memory:');
  const app = createApp({ config, store, market: createMarket(providers, now), now });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { base, store, call, close: async () => { server.close(); await store.close(); } };
}

/** Deterministic regular-hours intraday bars (09:30–16:00 ET) for testing and demos. */
export function syntheticIntraday(dates: string[], spanMin: 1 | 5 | 15 | 30, base = 600): RawBar[] {
  const out: RawBar[] = [];
  let k = 0;
  for (const date of dates) {
    const open = zonedToUnix(date, 9, 30, 'America/New_York');
    for (let m = 0; m < 390; m += spanMin, k++) {
      const c = base + Math.sin(k / 7) * 3 + Math.cos(k / 23) * 5 + k * 0.01;
      const o = base + Math.sin((k - 1) / 7) * 3 + Math.cos((k - 1) / 23) * 5 + (k - 1) * 0.01;
      out.push({ t: open + m * 60, o, h: Math.max(o, c) + 0.4, l: Math.min(o, c) - 0.4, c, v: 1000 });
    }
  }
  return out;
}

/** Aggregate fine bars into coarser ones (same session grid). */
export function aggregate(rows: RawBar[], factor: number): RawBar[] {
  const out: RawBar[] = [];
  for (let i = 0; i + factor <= rows.length; i += factor) {
    const g = rows.slice(i, i + factor);
    out.push({ t: g[0]!.t, o: g[0]!.o, h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)), c: g[g.length - 1]!.c, v: g.reduce((s, x) => s + x.v, 0) });
  }
  return out;
}
