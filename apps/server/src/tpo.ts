/**
 * /api/tpo — TPO (Market Profile) chart: one profile per day, week or month,
 * built from blocks of 5m, 30m, 1H or 4H (one letter each). The engine's
 * buildTpo does the arithmetic (shared with the Market Profile levels); this
 * module picks the bars, groups them by session and works out which levels
 * are still naked (not traded back to since their profile).
 */
import type { Timeframe, TpoBlockSize, TpoProfile, TpoRequest, TpoResponse } from '@paradise/contract';
import { buildTpo, defaultRowSize, TPO_VERSION } from '@paradise/engine';
import { COMPLETION_GRACE_S, normalizeBars, type Bar } from './data/bars.ts';
import { periodBounds, periodKeyOf, periodLabel, type ExchangeCalendar } from './data/calendar.ts';
import { resolveInstrument } from './data/instruments.ts';
import type { Market } from './data/market.ts';
import { iso } from './data/time.ts';
import { RequestError } from './levels.ts';

const BLOCK: Record<TpoBlockSize, { tf: Timeframe; minutes: number }> = {
  '5m': { tf: '5m', minutes: 5 }, '30m': { tf: '30m', minutes: 30 }, '1H': { tf: '1H', minutes: 60 }, '4H': { tf: '1H', minutes: 240 },
};
export const TPO_PROFILES_DEFAULT = 20;
export const TPO_PROFILES_MAX = 120;
/** Rows × blocks budget per request (~100 ms). A 1-tick row on a day of BTC is ~6e7. */
export const TPO_WORK_MAX = 2e7;

export interface TpoDeps { market: Market; now?: () => number }

/** 1H bars → 4H blocks counted from each session's open. */
export function fourHourBlocks(bars: readonly Bar[], cal: ExchangeCalendar): Bar[] {
  const out: Bar[] = [];
  let key = '';
  for (const b of bars) {
    const date = cal.sessionDateOf(b.t);
    const k = `${date}|${Math.floor((b.t - cal.sessionOpen(date)) / 14_400)}`;
    const prev = out[out.length - 1];
    if (prev && k === key) {
      out[out.length - 1] = { ...prev, h: Math.max(prev.h, b.h), l: Math.min(prev.l, b.l), c: b.c, v: prev.v + b.v, end: b.end, complete: b.complete };
    } else { out.push({ ...b }); key = k; }
  }
  return out;
}

export async function computeTpo(req: TpoRequest, deps: TpoDeps): Promise<TpoResponse> {
  const now = Math.floor((deps.now ?? (() => Date.now() / 1000))());
  const inst = resolveInstrument(req.symbol);
  const cal = inst.cal;
  const block = BLOCK[req.block];
  if (!block) throw new RequestError('unknown block size');
  const ibMinutes = req.ibMinutes ?? 60;
  const valueArea = req.valueArea ?? 70;
  const wanted = Math.max(1, Math.min(TPO_PROFILES_MAX, Math.floor(req.profiles ?? TPO_PROFILES_DEFAULT)));

  const set = await deps.market.fetchSet(inst.symbol, [block.tf]);
  let bars = normalizeBars(set.rows.get(block.tf) ?? [], block.tf, cal, now).bars;
  if (req.block === '4H') bars = fourHourBlocks(bars, cal);
  const warnings: string[] = [];
  const last = bars[bars.length - 1];
  if (!last) throw new RequestError(`no ${block.tf} bars for ${inst.symbol}`);

  const rowSize = req.rowTicks ? Number((req.rowTicks * inst.tick).toFixed(10)) : defaultRowSize(last.c, inst.tick);
  const ibBlocks = Math.max(1, Math.round(ibMinutes / block.minutes));
  const ibUsed = ibBlocks * block.minutes;
  if (ibUsed !== ibMinutes) warnings.push(`initial balance is ${ibUsed} min: whole ${req.block} blocks only (asked for ${ibMinutes})`);

  const groups = new Map<string, Bar[]>();
  for (const b of bars) {
    const k = periodKeyOf(cal, req.session, b.t);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(b);
  }
  // Only the newest sessions are returned, so only build those (+1 in case the oldest is skipped).
  const keys = [...groups.keys()].sort().slice(-(wanted + 1));
  // buildTpo costs about rows × blocks per session; a tiny row height on a wide range would block the server.
  let work = 0;
  for (const k of keys) {
    const g = groups.get(k)!;
    work += (Math.max(...g.map((b) => b.h)) - Math.min(...g.map((b) => b.l))) / rowSize * g.length;
  }
  if (work > TPO_WORK_MAX) throw new RequestError(`Row height ${rowSize} is too small for ${keys.length} ${req.session} profiles of ${inst.symbol}: raise it, or leave it on Auto`);
  const built: Array<{ p: Omit<TpoProfile, 'touched' | 'singlesTouched'>; blocks: Bar[] }> = [];
  for (const key of keys) {
    const bounds = periodBounds(cal, req.session, key);
    const blocks = groups.get(key)!;
    if (!bounds) continue;
    // History that starts mid-session would draw a truncated profile as if it were whole.
    if (blocks[0]!.t > bounds.start + 3600) { warnings.push(`${req.session} profile ${key}: history starts mid-session; skipped`); continue; }
    const t = buildTpo(blocks, { rowSize, valueArea: valueArea / 100, vaMethod: req.vaMethod ?? 'two', ibBlocks, tailMin: req.tailMin ?? 2 });
    if (!t) continue;
    const { rowSize: _r, ...rest } = t;
    built.push({
      blocks,
      p: {
        key, label: periodLabel(req.session, key, cal, bounds.start), start: bounds.start, end: bounds.end,
        complete: bounds.end + COMPLETION_GRACE_S <= now, periods: blocks.map((b) => b.t), ...rest, base: t.base * rowSize,
      },
    });
  }
  const kept = built.slice(-wanted);

  // Naked levels: the first later block whose range reaches the price.
  const firstTouch = (from: number, price: number, high = price) => {
    for (let j = from; j < kept.length; j++) for (const b of kept[j]!.blocks) if (b.l <= high && b.h >= price) return b.t;
    return null;
  };
  const profiles: TpoProfile[] = kept.map(({ p }, i) => ({
    ...p,
    touched: {
      poc: firstTouch(i + 1, p.poc), vah: firstTouch(i + 1, p.vah), val: firstTouch(i + 1, p.val),
      vpoc: firstTouch(i + 1, p.vpoc), vvah: firstTouch(i + 1, p.vvah), vval: firstTouch(i + 1, p.vval),
      high: firstTouch(i + 1, p.high), low: firstTouch(i + 1, p.low),
    },
    singlesTouched: p.singles.map(([lo, hi]) => firstTouch(i + 1, lo, hi)),
  }));

  return {
    instrument: {
      symbol: inst.symbol, root: inst.root, kind: inst.kind, tick: inst.tick, calendar: inst.calendar,
      calendarFidelity: inst.calendarFidelity, timezone: inst.timezone, session: inst.session, adjustment: inst.adjustment,
    },
    generatedAt: iso(now),
    dataSource: set.provider,
    engineVersion: TPO_VERSION,
    session: req.session, block: req.block, rowSize, rowTicks: Math.round(rowSize / inst.tick), valueArea, ibMinutes: ibUsed,
    profiles,
    warnings,
  };
}
