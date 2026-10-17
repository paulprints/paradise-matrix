/**
 * /api/chart — candles plus level HISTORY: every level, on every display bar of
 * its timeframe, with the exact time window it was valid for. A 15m level
 * computed from the 10:00 bar (displacement 1) is valid 10:15–10:30 and stays
 * drawn there after the 10:30 levels replace it.
 *
 * One provider for everything in the response (pinned), so candles, levels and
 * frames always come from the same data.
 */
import type { ChartBar, ChartRequest, ChartResponse, LevelKey, LevelSegment, Timeframe } from '@paradise/contract';
import { levelsAt, PLOT_KEYS } from '@paradise/engine';
import { confirmedIndexAt, displayRef, normalizeBars, type Bar } from './data/bars.ts';
import { resolveInstrument } from './data/instruments.ts';
import type { FetchedSet, Market } from './data/market.ts';
import { iso } from './data/time.ts';
import { PUBLIC_NAMES } from './labels.ts';
import { computeLevels, ORDER, profilePeriods, RequestError } from './levels.ts';

export const CHART_BARS_DEFAULT = 1000;
export const CHART_BARS_MAX = 5000;

/** Fixed dictionary: every engine plot, then the profile slots. Indexes are stable within a response. */
const KEY_PLOTS = [...PLOT_KEYS, 'VAH', 'POC', 'VAL'];
export const LEVEL_KEYS: LevelKey[] = KEY_PLOTS.map((plot) => {
  const n = PUBLIC_NAMES[plot]!;
  const side = plot.endsWith(' Sell') ? 'sell' : plot.endsWith(' Buy') ? 'buy' : undefined;
  return { slug: n.slug, label: n.label, group: n.group, family: n.family, ...(side ? { side } : {}) };
});
const KEY_INDEX = new Map(KEY_PLOTS.map((p, i) => [p, i]));

export interface ChartDeps { market: Market; now?: () => number }

/** A market that only replays one already-fetched set (keeps every part of a response on one provider). */
function pinned(set: FetchedSet): Market {
  return {
    providers: [set.provider],
    async fetchSet(_symbol, tfs) {
      const rows = new Map(tfs.map((tf) => {
        const r = set.rows.get(tf);
        if (!r) throw new Error(`internal: ${tf} not in pinned set`);
        return [tf, r] as const;
      }));
      return { provider: set.provider, rows };
    },
  };
}

export async function computeChart(req: ChartRequest, deps: ChartDeps): Promise<ChartResponse> {
  const now = Math.floor((deps.now ?? (() => Date.now() / 1000))());
  const inst = resolveInstrument(req.symbol);
  const chartTf = req.chartTf;
  const overlays = ORDER.filter((tf) => req.overlays.includes(tf));
  const d = req.displacement ?? 1;
  const nBars = Math.max(50, Math.min(CHART_BARS_MAX, Math.floor(req.bars ?? CHART_BARS_DEFAULT)));
  const since = req.since ?? null;
  if (since !== null && (!Number.isFinite(since) || since < 0)) throw new RequestError('since must be unix seconds');
  const profileTfs = req.profile ? overlays.filter((tf): tf is 'D' | 'W' | 'M' => tf === 'D' || tf === 'W' || tf === 'M') : [];
  const needed = [...new Set<Timeframe>([chartTf, ...overlays, ...(profileTfs.length ? ['30m' as const] : [])])];

  const set = await deps.market.fetchSet(inst.symbol, needed);
  const current = overlays.length
    ? await computeLevels({ symbol: req.symbol, timeframes: overlays, displacement: d, developing: req.developing, profile: req.profile }, { market: pinned(set), now: () => now })
    : null;

  const norm = new Map<Timeframe, Bar[]>();
  const bars = (tf: Timeframe) => {
    let b = norm.get(tf);
    if (!b) norm.set(tf, (b = normalizeBars(set.rows.get(tf) ?? [], tf, inst.cal, now).bars));
    return b;
  };

  const chartBars = bars(chartTf).slice(-nBars);
  const windowStart = chartBars[0]?.t ?? now;
  const cutoff = Math.max(windowStart, since ?? -Infinity);
  const segments: LevelSegment[] = [];

  for (const tf of overlays) {
    const tb = bars(tf);
    const confirmed = confirmedIndexAt(tb, null);
    const last = tb.length - 1;
    const push = (i: number, basis: 'confirmed' | 'developing') => {
      const w = displayRef(tb, i + d, tf, inst.cal);
      if (!w || w.end <= cutoff) return;
      for (const l of levelsAt(tb, i, basis, d)) {
        if (l.price === null) continue;
        segments.push([KEY_INDEX.get(l.plot)!, tf, l.price, w.time, w.end, basis === 'developing' ? 1 : 0, tb[i]!.t]);
      }
    };
    for (let i = 4; i <= confirmed; i++) push(i, 'confirmed');
    if (req.developing && last > confirmed && last >= 4 && !tb[last]!.complete) push(last, 'developing');
  }

  for (const tf of profileTfs) {
    const price = chartBars[chartBars.length - 1]?.c ?? null;
    const { periods } = profilePeriods(tf, bars('30m'), inst, now, !!req.developing, price, 'all');
    for (const pp of periods) {
      if (!pp.display || pp.display.end <= cutoff) continue;
      for (const [plot, value] of pp.values) {
        segments.push([KEY_INDEX.get(plot)!, tf, value, pp.display.start, pp.display.end, pp.basis === 'developing' ? 1 : 0, pp.source.start]);
      }
    }
  }

  const outBars: ChartBar[] = chartBars
    .filter((b) => since === null || b.t >= since)
    .map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, complete: b.complete }));
  const lastBar = chartBars[chartBars.length - 1];

  return {
    instrument: current?.instrument ?? {
      symbol: inst.symbol, root: inst.root, kind: inst.kind, tick: inst.tick, calendar: inst.calendar,
      calendarFidelity: inst.calendarFidelity, timezone: inst.timezone, session: inst.session, adjustment: inst.adjustment,
    },
    generatedAt: iso(now),
    dataSource: set.provider,
    engineVersion: current?.engineVersion ?? 'candles-only',
    chartTf,
    bars: outBars,
    keys: LEVEL_KEYS,
    segments,
    frames: current?.frames ?? [],
    lastPrice: lastBar ? { price: lastBar.c, time: iso(Math.min(now, lastBar.end)) } : null,
    since,
    warnings: current?.warnings ?? [],
  };
}

