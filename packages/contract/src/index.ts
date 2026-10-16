/**
 * Public API contract (v2).
 *
 * Everything the browser receives is described here. Level *prices* are
 * outputs; the formulas that produce them stay in @paradise/engine on the
 * server. Public ids/labels are assigned at the server edge (labels.ts) so
 * vendor naming never reaches the client.
 */

export type Timeframe = 'M' | 'W' | 'D' | '1H' | '30m' | '15m';
export const TIMEFRAMES: readonly Timeframe[] = ['M', 'W', 'D', '1H', '30m', '15m'];

/** Bars between the source bar used for arithmetic and the bar a level is drawn on. Normal is 1. */
export type Displacement = 0 | 1;

/**
 * active      – the line exists for this bar; price is set.
 * inactive    – its availability condition is false; price is null.
 * boundary    – a condition sits within 1e-8 of equality; vendor behaviour unresolved. price is null.
 */
export type LevelState = 'active' | 'inactive' | 'boundary';

/** confirmed: source bar is complete. developing: source bar is still forming (provisional). */
export type LevelBasis = 'confirmed' | 'developing';

/** UI grouping; also the unit of the visibility toggles. */
export type LevelGroup = 'structure' | 'range' | 'termination' | 'profile';

export interface BarRef {
  /** ISO-8601 UTC instant of the period start. */
  time: string;
  /** Exchange-local label: 2026-09-21 (D), wk 2026-09-21 (W), 2026-09 (M), 2026-09-21 10:30 (intraday). */
  label: string;
}

export interface Level {
  /** Unique within a response: `${tf}:${basis}:${slug}`. */
  id: string;
  /** Stable public slug, e.g. `pivot`, `band.upper`, `t51.s`. */
  slug: string;
  /** Public display label. */
  label: string;
  group: LevelGroup;
  /** Family slug used for toggles/legend, e.g. `zones`, `t5-1`, `profile`. */
  family: string;
  side?: 'buy' | 'sell';
  tf: Timeframe;
  state: LevelState;
  /** Full precision. Null unless state === 'active'. Round only for display. */
  price: number | null;
  basis: LevelBasis;
  source: BarRef & { complete: boolean };
  /** Bar the level is drawn on. label/time null when the calendar can't name it (never invented). */
  display: { time: string | null; label: string | null };
  displacement: Displacement;
  /** e.g. `dg-candidate@20260923-v1`, `profile-tpo@1`. */
  provenance: string;
}

export interface LocationFact {
  /** 0 = below the lowest zone … 7 = above the highest zone. */
  band: number;
  label: string;
}

export interface FrameFacts {
  /** Where the latest price sits among this frame's confirmed structure levels. */
  location: LocationFact | null;
  /** Direction of the pivot over consecutive source bars (sign and run length). */
  pivotDirection: { sign: -1 | 0 | 1; bars: number } | null;
  /** Consecutive closes on one side of the pivot drawn on their bar. */
  closesVsPivot: { side: 'above' | 'below' | 'on'; bars: number } | null;
}

export interface Frame {
  tf: Timeframe;
  /** Last complete bar used for confirmed levels (null when history is insufficient). */
  source: BarRef | null;
  display: { time: string | null; label: string | null };
  /** Forming bar used for developing levels, when requested and available. */
  developingSource: BarRef | null;
  /** Mean true range of the last 14 complete bars ending at source. Drives heat kernel width. */
  atr: number | null;
  facts: FrameFacts;
  barCount: number;
  warnings: string[];
}

export interface Instrument {
  /** Normalised provider symbol, e.g. QQQ, NQ=F, NQZ26.CME */
  symbol: string;
  /** Root / display symbol, e.g. QQQ, NQ */
  root: string;
  kind: 'equity' | 'future';
  tick: number;
  calendar: string;
  /** exact = full holiday calendar; approximate = weekday session rules only (see docs/CONTRACT.md). */
  calendarFidelity: 'exact' | 'approximate';
  timezone: string;
  session: string;
  /** Price adjustment policy of the bars. */
  adjustment: 'split' | 'none';
}

export interface LevelsRequest {
  symbol: string;
  /** Finest first or any order; the server sorts. One timeframe = single view; several = stacked view. */
  timeframes: Timeframe[];
  displacement?: Displacement;
  /** ISO instant. Null/absent = live. Past instants use only bars complete at that instant. */
  asOf?: string | null;
  developing?: boolean;
  profile?: boolean;
}

export interface LevelsResponse {
  instrument: Instrument;
  asOf: string | null;
  generatedAt: string;
  dataSource: string;
  engineVersion: string;
  /** Latest traded price (developing bar close when live; source close when as-of). */
  lastPrice: { price: number; time: string } | null;
  frames: Frame[];
  levels: Level[];
  /** Completed bars of the finest requested timeframe, newest first. Send `end` back as asOf to step back. */
  anchors: Array<BarRef & { end: string }>;
  warnings: string[];
}

export interface User {
  id: number;
  username: string;
  isAdmin: boolean;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
