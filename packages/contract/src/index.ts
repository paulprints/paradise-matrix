/**
 * Public API contract (v2).
 *
 * Everything the browser receives is described here. Level *prices* are
 * outputs; the formulas that produce them stay in @paradise/engine on the
 * server. Public ids/labels are assigned at the server edge (labels.ts) so
 * vendor naming never reaches the client.
 */

export type Timeframe = 'M' | 'W' | 'D' | '1H' | '30m' | '15m' | '5m' | '1m';
/** Coarse to fine. */
export const TIMEFRAMES: readonly Timeframe[] = ['M', 'W', 'D', '1H', '30m', '15m', '5m', '1m'];

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

// ---------------------------------------------------------------------------
// Chart (v2.1): candles + level history with validity windows
// ---------------------------------------------------------------------------

export interface ChartRequest {
  symbol: string;
  /** Candle timeframe shown on the chart. */
  chartTf: Timeframe;
  /** Timeframes whose levels are overlaid (may include chartTf). */
  overlays: Timeframe[];
  displacement?: Displacement;
  developing?: boolean;
  profile?: boolean;
  /** Most recent N chart bars (default 1000, max 5000). Level history covers the same window. */
  bars?: number;
  /**
   * Incremental update: unix seconds. Returns only chart bars with t ≥ since and segments
   * whose window ends after since. The client keeps everything older, which never changes.
   */
  since?: number;
}

export interface ChartBar {
  /** Period start, unix seconds. */
  t: number;
  o: number; h: number; l: number; c: number; v: number;
  complete: boolean;
}

/** Shared description of a level slot; segments refer to it by index. */
export interface LevelKey {
  slug: string;
  label: string;
  group: LevelGroup;
  family: string;
  side?: 'buy' | 'sell';
}

/**
 * One level, valid on one display bar of its timeframe.
 * [keyIndex, timeframe, price, from, to, basis (0 confirmed | 1 developing), sourceStart]
 * from/to: unix seconds of the display bar's start and end. sourceStart: start of the bar the arithmetic used.
 * Compact on purpose — a chart carries thousands of these.
 */
export type LevelSegment = [key: number, tf: Timeframe, price: number, from: number, to: number, basis: 0 | 1, source: number];

export interface ChartResponse {
  instrument: Instrument;
  generatedAt: string;
  dataSource: string;
  engineVersion: string;
  chartTf: Timeframe;
  bars: ChartBar[];
  keys: LevelKey[];
  segments: LevelSegment[];
  /** Current state of each overlay timeframe (same as /api/levels frames). */
  frames: Frame[];
  lastPrice: { price: number; time: string } | null;
  /** Echo of the request's since (null for a full load). */
  since: number | null;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Drawings (per member, per instrument)
// ---------------------------------------------------------------------------

/** A chart anchor: unix seconds and price. */
export interface Anchor { t: number; p: number }

export const DRAWING_COLORS = ['paper', 'ink', 'seal', 'alert', 'sky'] as const;
export type DrawingColor = (typeof DRAWING_COLORS)[number];

interface DrawingBase { id: string; color: DrawingColor }
export type Drawing =
  | (DrawingBase & { kind: 'trend'; a: Anchor; b: Anchor; extend: boolean })
  | (DrawingBase & { kind: 'hline'; p: number })
  | (DrawingBase & { kind: 'vline'; t: number })
  | (DrawingBase & { kind: 'rect'; a: Anchor; b: Anchor })
  | (DrawingBase & { kind: 'text'; a: Anchor; text: string })
  | (DrawingBase & { kind: 'brush'; pts: Anchor[] });
export type DrawingKind = Drawing['kind'];

export const DRAWING_LIMITS = { perSymbol: 500, brushPoints: 2000, textLength: 200 } as const;

export interface DrawingsResponse { symbol: string; drawings: Drawing[]; updatedAt: string | null }

// ---------------------------------------------------------------------------
// Shared charts (collaboration)
// ---------------------------------------------------------------------------

/** The view a shared chart opens with. The symbol is fixed for the share (drawings belong to it). */
export interface ShareConfig {
  symbol: string;
  chartTf: Timeframe;
  timeframes: Timeframe[];
  displacement: Displacement;
  developing: boolean;
  profile: boolean;
  heat: boolean;
  heatStyle: 'matrix' | 'halftone';
  groups: LevelGroup[];
}

export type ShareRole = 'owner' | 'editor' | 'viewer';

export interface ShareInfo {
  id: string;
  title: string;
  config: ShareConfig;
  owner: { id: number; username: string };
  /** Locked shares are read-only for everyone, owner included, until unlocked. */
  locked: boolean;
  createdAt: string;
  updatedAt: string;
  /** Link keys. Only returned to the owner. Rotating a key revokes old links. */
  viewKey?: string;
  editKey?: string;
}

/**
 * A drawing with its collaboration version. `v` increases with every edit; `n` is a
 * random tie-break regenerated on each edit. Highest v wins; on equal v, lower n wins.
 */
export type VersionedDrawing = Drawing & { v: number; n: number };

/** One change to one drawing. `d` is the full drawing (absent when deleted). */
export interface LiveOp { id: string; v: number; n: number; del?: true; d?: Drawing }

export interface ShareOpenResponse { share: ShareInfo; role: ShareRole; drawings: VersionedDrawing[] }

/** What a presenter is looking at; followers mirror it. Times are unix seconds. */
export interface PresenterView { chartTf: Timeframe; timeframes: Timeframe[]; from: number; to: number }

export interface Peer {
  /** Connection id (one member can be connected from two tabs). */
  id: string;
  userId: number;
  username: string;
  role: ShareRole;
  color: string;
}

export type LiveClientMessage =
  | { type: 'auth'; token: string; share: string; key?: string }
  | { type: 'ops'; ops: LiveOp[] }
  | { type: 'presence'; cursor: Anchor | null; view?: PresenterView }
  | { type: 'present'; on: boolean }
  | { type: 'ping' };

export type LiveServerMessage =
  | { type: 'welcome'; you: Peer; peers: Peer[]; drawings: VersionedDrawing[]; presenter: string | null; share: ShareInfo }
  | { type: 'ops'; by: string; ops: LiveOp[] }
  /** Your ops that lost; each carries the server's current state for that drawing. */
  | { type: 'reject'; ops: LiveOp[]; reason: string }
  | { type: 'peer'; event: 'join' | 'leave'; peer: Peer }
  | { type: 'presence'; from: string; cursor: Anchor | null; view?: PresenterView }
  | { type: 'present'; presenter: string | null }
  | { type: 'share'; share: ShareInfo }
  | { type: 'error'; message: string }
  | { type: 'pong' };

/** WebSocket close codes used by the live hub. */
export const LIVE_CLOSE = { auth: 4401, forbidden: 4403, gone: 4404, policy: 4408 } as const;
export const SHARE_LIMITS = { titleLength: 80, perOwner: 200 } as const;
/** Live edit budget per connection: `capacity` ops, refilled evenly over `windowMs`; at most `perMessage` per message. */
export const LIVE_OPS_BUDGET = { capacity: 200, windowMs: 10_000, perMessage: 100 } as const;

/**
 * Per-drawing convergence rule (Excalidraw's model), shared by server and
 * browser. Every edit bumps the drawing's version `v` and picks a fresh random
 * nonce `n`. Higher version wins; on a tie the lower nonce wins. Deletes are
 * tombstones, so a stale copy can't resurrect a deleted drawing.
 */
export function stampWins(incoming: { v: number; n: number }, current: { v: number; n: number } | null | undefined): boolean {
  if (!current) return true;
  return incoming.v > current.v || (incoming.v === current.v && incoming.n < current.n);
}
/** Random tie-break nonce in [0, 2^31). */
export const stampNonce = (): number => Math.floor(Math.random() * 2 ** 31);
