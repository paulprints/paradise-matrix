/**
 * Orchestrates one /api/levels request: resolve instrument → fetch one
 * provider's bars for every needed timeframe → normalise against the exchange
 * calendar → engine frames → public levels with provenance.
 */
import type { Frame, Level, LevelsRequest, LevelsResponse, Timeframe } from '@paradise/contract';
import { buildFrame, computeProfile, defaultRowSize, ENGINE_VERSION, PROFILE_VERSION, type EngineLevel } from '@paradise/engine';
import { COMPLETION_GRACE_S, confirmedIndexAt, displayRef, normalizeBars, type Bar } from './data/bars.ts';
import { calendarCovers, lastClosedSession, nextPeriodKey, periodBounds, periodKeyOf, periodLabel, type ExchangeCalendar } from './data/calendar.ts';
import { resolveInstrument, type ResolvedInstrument } from './data/instruments.ts';
import type { Market } from './data/market.ts';
import { iso } from './data/time.ts';
import { LOCATION_LABELS, publicName } from './labels.ts';

export const ORDER: Timeframe[] = ['M', 'W', 'D', '1H', '30m', '15m', '5m', '1m'];
const ANCHOR_LIMIT = 150;

export class RequestError extends Error {}

export interface LevelsDeps { market: Market; now?: () => number }

export async function computeLevels(req: LevelsRequest, deps: LevelsDeps): Promise<LevelsResponse> {
  const now = Math.floor((deps.now ?? (() => Date.now() / 1000))());
  const inst = resolveInstrument(req.symbol);
  const tfs = ORDER.filter((tf) => req.timeframes.includes(tf));
  if (!tfs.length) throw new RequestError('at least one timeframe is required');
  const displacement = req.displacement ?? 1;
  const asOf = req.asOf ? Math.floor(Date.parse(req.asOf) / 1000) : null;
  if (asOf !== null && !Number.isFinite(asOf)) throw new RequestError('asOf must be an ISO-8601 instant');
  if (asOf !== null && asOf > now) throw new RequestError('asOf cannot be in the future');
  const live = asOf === null;
  const wantDeveloping = live && !!req.developing;
  const profileTfs = req.profile ? tfs.filter((tf): tf is 'D' | 'W' | 'M' => tf === 'D' || tf === 'W' || tf === 'M') : [];
  const fetchTfs = profileTfs.length && !tfs.includes('30m') ? [...tfs, '30m' as const] : tfs;

  const set = await deps.market.fetchSet(inst.symbol, fetchTfs);
  const warnings: string[] = [];
  if (inst.calendarFidelity === 'approximate') warnings.push(`${inst.calendar} calendar is approximate: session-specific early closes are not modelled`);
  if (!calendarCovers(inst.cal, asOf ?? now)) warnings.push(`holiday table covers ${inst.cal.coveredYears.join('–')}; weekday rules only beyond it`);

  const barsByTf = new Map<Timeframe, Bar[]>();
  const normWarnings = new Map<Timeframe, string[]>();
  for (const tf of fetchTfs) {
    const n = normalizeBars(set.rows.get(tf) ?? [], tf, inst.cal, now);
    // As-of: bars that had not started yet are unknowable at that instant.
    barsByTf.set(tf, asOf === null ? n.bars : n.bars.filter((b) => b.t < asOf));
    normWarnings.set(tf, n.warnings);
  }

  const finest = tfs[tfs.length - 1]!;
  const finestBars = barsByTf.get(finest)!;
  const finestConfirmed = confirmedIndexAt(finestBars, asOf);
  const lastBar = live ? finestBars[finestBars.length - 1] : finestBars[finestConfirmed];
  const lastPrice = lastBar ? { price: lastBar.c, time: iso(live ? Math.min(now, lastBar.end) : lastBar.end) } : null;

  const frames: Frame[] = [];
  const levels: Level[] = [];
  for (const tf of tfs) {
    const bars = barsByTf.get(tf)!;
    const confirmedIndex = confirmedIndexAt(bars, asOf);
    const last = bars.length - 1;
    const developingIndex = wantDeveloping && last > confirmedIndex && !bars[last]!.complete ? last : null;
    const staleness: string[] = [];
    if (live && tf === 'D' && confirmedIndex >= 0) {
      const expected = lastClosedSession(inst.cal, now, COMPLETION_GRACE_S);
      const have = bars[confirmedIndex]!.key;
      if (have < expected) staleness.push(`${set.provider} data is behind: newest complete daily bar is ${have}, but the ${expected} session has closed. Levels use ${have}.`);
    }
    const f = buildFrame({ bars, displacement, confirmedIndex, developingIndex, lastPrice: lastPrice?.price ?? null });
    const ref = (i: number | null) => (i === null ? null : { time: iso(bars[i]!.t), label: bars[i]!.label });
    const disp = (i: number | null) => {
      const d = i === null ? null : displayRef(bars, i, tf, inst.cal);
      return { time: d ? iso(d.time) : null, label: d?.label ?? null };
    };
    frames.push({
      tf,
      source: ref(f.sourceIndex),
      display: disp(f.displayIndex),
      developingSource: ref(f.developingIndex),
      atr: f.atr,
      facts: {
        location: f.facts.locationBand === null ? null : { band: f.facts.locationBand, label: LOCATION_LABELS[f.facts.locationBand]! },
        pivotDirection: f.facts.pivotDirection,
        closesVsPivot: f.facts.closesVsPivot,
      },
      barCount: bars.length,
      warnings: [...staleness, ...(normWarnings.get(tf) ?? []), ...f.warnings],
    });
    for (const l of f.levels) levels.push(toPublic(l, tf, bars, inst));

    if (profileTfs.includes(tf as 'D')) {
      const p = profileLevels(tf as 'D' | 'W' | 'M', barsByTf.get('30m')!, inst, asOf ?? now, wantDeveloping, lastPrice?.price ?? null);
      levels.push(...p.levels);
      frames[frames.length - 1]!.warnings.push(...p.warnings);
    }
  }

  const anchors = finestBars
    .slice(0, finestConfirmed + 1)
    .slice(-ANCHOR_LIMIT)
    .reverse()
    .map((b) => ({ time: iso(b.t), label: b.label, end: iso(b.ready) }));

  return {
    instrument: {
      symbol: inst.symbol, root: inst.root, kind: inst.kind, tick: inst.tick, calendar: inst.calendar,
      calendarFidelity: inst.calendarFidelity, timezone: inst.timezone, session: inst.session, adjustment: inst.adjustment,
    },
    asOf: asOf === null ? null : iso(asOf),
    generatedAt: iso(now),
    dataSource: set.provider,
    engineVersion: profileTfs.length ? `${ENGINE_VERSION}+${PROFILE_VERSION}` : ENGINE_VERSION,
    lastPrice,
    frames,
    levels,
    anchors,
    warnings,
  };
}

function toPublic(l: EngineLevel, tf: Timeframe, bars: Bar[], inst: ResolvedInstrument): Level {
  const n = publicName(l.plot);
  const src = bars[l.sourceIndex]!;
  const d = displayRef(bars, l.displayIndex, tf, inst.cal);
  return {
    id: `${tf}:${l.basis}:${n.slug}`,
    slug: n.slug, label: n.label, group: n.group, family: n.family,
    ...(l.side ? { side: l.side } : {}),
    tf, state: l.state, price: l.price, basis: l.basis,
    source: { time: iso(src.t), label: src.label, complete: l.basis === 'confirmed' },
    display: { time: d ? iso(d.time) : null, label: d?.label ?? null },
    displacement: l.displacement,
    provenance: l.provenance,
  };
}

export interface ProfilePeriod {
  key: string;
  basis: 'confirmed' | 'developing';
  source: { start: number; label: string };
  /** The period the profile applies to (the next one). Null if the calendar can't name it. */
  display: { start: number; end: number; label: string } | null;
  values: Array<['VAH' | 'POC' | 'VAL', number]>;
  rowSize: number;
}

/**
 * Market Profile per D/W/M period from intraday bars. A completed period's
 * profile applies to the NEXT period (displacement 1). `which` picks every
 * completed period ('all', for chart history) or only the latest ('latest').
 * The current, unfinished period is included as developing when asked.
 */
export function profilePeriods(
  tf: 'D' | 'W' | 'M', intraday: readonly Bar[], inst: ResolvedInstrument, ref: number, developing: boolean, price: number | null,
  which: 'latest' | 'all' = 'latest',
): { periods: ProfilePeriod[]; warnings: string[] } {
  const warnings: string[] = [];
  const cal: ExchangeCalendar = inst.cal;
  if (!intraday.length || price === null) return { periods: [], warnings: ['no intraday bars for profile'] };
  const groups = new Map<string, Bar[]>();
  for (const b of intraday) {
    const k = periodKeyOf(cal, tf, b.t);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(b);
  }
  const rowSize = defaultRowSize(price, inst.tick);
  const keys = [...groups.keys()].sort();
  const completed = keys.filter((k) => { const b = periodBounds(cal, tf, k); return b && b.end + COMPLETION_GRACE_S <= ref; });
  const periods: ProfilePeriod[] = [];

  const emit = (key: string, basis: 'confirmed' | 'developing') => {
    const bounds = periodBounds(cal, tf, key)!;
    const bars = groups.get(key)!;
    if (bars[0]!.t > bounds.start + 3600) {
      if (which === 'latest' || basis === 'developing') warnings.push(`${tf} profile ${key}: intraday history starts mid-period; skipped`);
      return;
    }
    const prof = computeProfile(bars, rowSize);
    if (!prof) return;
    const nextKey = nextPeriodKey(cal, tf, key);
    const nb = periodBounds(cal, tf, nextKey);
    periods.push({
      key, basis, rowSize,
      source: { start: bounds.start, label: periodLabel(tf, key, cal, bounds.start) },
      display: nb ? { start: nb.start, end: nb.end, label: periodLabel(tf, nextKey, cal, nb.start) } : null,
      values: [['VAH', prof.vah], ['POC', prof.poc], ['VAL', prof.val]],
    });
  };

  const lastDone = completed[completed.length - 1];
  if (!lastDone) warnings.push(`no completed ${tf} period in intraday history for profile`);
  for (const k of which === 'all' ? completed : lastDone ? [lastDone] : []) emit(k, 'confirmed');
  const current = keys[keys.length - 1];
  if (developing && current && current !== lastDone) emit(current, 'developing');
  return { periods, warnings };
}

/** Latest profile levels for /api/levels. */
export function profileLevels(
  tf: 'D' | 'W' | 'M', intraday: readonly Bar[], inst: ResolvedInstrument, ref: number, developing: boolean, price: number | null,
): { levels: Level[]; warnings: string[] } {
  const { periods, warnings } = profilePeriods(tf, intraday, inst, ref, developing, price, 'latest');
  const levels: Level[] = periods.flatMap((pp) => pp.values.map(([plot, value]) => {
    const n = publicName(plot);
    return {
      id: `${tf}:${pp.basis}:${n.slug}`, slug: n.slug, label: n.label, group: n.group, family: n.family,
      tf, state: 'active' as const, price: value, basis: pp.basis,
      source: { time: iso(pp.source.start), label: pp.source.label, complete: pp.basis === 'confirmed' },
      display: { time: pp.display ? iso(pp.display.start) : null, label: pp.display?.label ?? null },
      displacement: 1 as const,
      provenance: `${PROFILE_VERSION} row=${pp.rowSize}`,
    };
  }));
  return { levels, warnings };
}
