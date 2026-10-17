/**
 * View state lives in the URL, so a view can be bookmarked or shared with
 * another member and reopens exactly (symbol, frames, as-of, options).
 */
import { TIMEFRAMES, type LevelGroup, type Timeframe } from '@paradise/contract';
import type { HeatStyle } from './heat.ts';

export interface ViewState {
  view: 'chart' | 'ladder';
  /** Candle timeframe for the chart view. */
  chartTf: Timeframe;
  symbol: string;
  timeframes: Timeframe[];
  displacement: 0 | 1;
  asOf: string | null;
  developing: boolean;
  profile: boolean;
  groups: LevelGroup[];
  heat: boolean;
  heatStyle: HeatStyle;
  /** Visible span as a multiple of the finest frame's ATR. */
  zoom: number;
}

export const DEFAULT_VIEW: ViewState = {
  view: 'chart',
  chartTf: '5m',
  symbol: 'QQQ',
  timeframes: ['D', '15m'],
  displacement: 1,
  asOf: null,
  developing: false,
  profile: false,
  groups: ['structure', 'range', 'profile'],
  heat: true,
  heatStyle: 'matrix',
  zoom: 8,
};

const GROUPS: LevelGroup[] = ['structure', 'range', 'termination', 'profile'];
export const ZOOM_STEPS = [3, 5, 8, 12, 20, 40];

export function parseView(search: string): ViewState {
  const q = new URLSearchParams(search);
  const v = { ...DEFAULT_VIEW };
  if (q.get('v') === 'ladder') v.view = 'ladder';
  const ct = q.get('ct');
  if (ct && (TIMEFRAMES as string[]).includes(ct)) v.chartTf = ct as Timeframe;
  const sym = q.get('s');
  if (sym && /^[A-Za-z0-9./=^ -]{1,24}$/.test(sym)) v.symbol = sym.toUpperCase();
  const tf = q.get('tf')?.split(',').filter((t): t is Timeframe => (TIMEFRAMES as string[]).includes(t));
  if (tf?.length) v.timeframes = TIMEFRAMES.filter((t) => tf.includes(t));
  if (q.get('d') === '0') v.displacement = 0;
  const asOf = q.get('asof');
  if (asOf && !Number.isNaN(Date.parse(asOf))) v.asOf = new Date(asOf).toISOString();
  v.developing = q.get('dev') === '1';
  v.profile = q.get('mp') === '1';
  const g = q.get('g')?.split(',').filter((x): x is LevelGroup => (GROUPS as string[]).includes(x));
  if (g) v.groups = g;
  if (q.get('heat') === '0') v.heat = false;
  if (q.get('hs') === 'halftone') v.heatStyle = 'halftone';
  const z = Number(q.get('z'));
  if (ZOOM_STEPS.includes(z)) v.zoom = z;
  return v;
}

export function serializeView(v: ViewState): string {
  const q = new URLSearchParams();
  if (v.view !== 'chart') q.set('v', v.view);
  if (v.chartTf !== DEFAULT_VIEW.chartTf) q.set('ct', v.chartTf);
  q.set('s', v.symbol);
  q.set('tf', v.timeframes.join(','));
  if (v.displacement === 0) q.set('d', '0');
  if (v.asOf) q.set('asof', v.asOf);
  if (v.developing) q.set('dev', '1');
  if (v.profile) q.set('mp', '1');
  if (v.groups.join(',') !== DEFAULT_VIEW.groups.join(',')) q.set('g', v.groups.join(','));
  if (!v.heat) q.set('heat', '0');
  if (v.heatStyle !== DEFAULT_VIEW.heatStyle) q.set('hs', v.heatStyle);
  if (v.zoom !== DEFAULT_VIEW.zoom) q.set('z', String(v.zoom));
  return `?${q.toString()}`;
}
