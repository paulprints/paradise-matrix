import { useEffect, useRef, useState } from 'react';
import { CandlestickSeries, createChart, CrosshairMode, type IChartApi, type ISeriesApi, type MouseEventParams, type Time, type UTCTimestamp } from 'lightweight-charts';
import type { LevelGroup, TpoResponse } from '@paradise/contract';
import { contribution, zoneOf, type HeatRow, type HeatStyle } from '../lib/heat.ts';
import { decimalsForTick, formatBarTime, formatPrice, formatTick } from '../lib/format.ts';
import { reducedMotion } from '../lib/motion.ts';
import { HeatLayer } from './heatLayer.ts';
import { LevelsLayer } from './levelsLayer.ts';
import { TpoLayer, type TpoHit } from './tpoLayer.ts';
import { DEFAULT_TPO, tpoLetter, type TpoSettings } from '../lib/tpo.ts';
import { candleColors, type CandleColors } from '../lib/candles.ts';
import { RenderModel } from './model.ts';
import { intervalAt, type ChartState } from './state.ts';
import { readPalette, withAlpha, type Palette } from './theme.ts';
import { barSpan, logicalToTime } from './time.ts';

export interface ChartHandles {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
  model: RenderModel;
  container: HTMLDivElement;
}

interface Props {
  state: ChartState;
  groups: LevelGroup[];
  heat: boolean;
  heatStyle: HeatStyle;
  theme: string;
  onInspect: (row: HeatRow | null) => void;
  onNeedMore: () => void;
  onReady?: (h: ChartHandles | null) => void;
  /** TPO profiles to draw (null = off). */
  tpo?: { data: TpoResponse | null; settings: TpoSettings } | null;
  /** The member's own candle colours (unset parts follow the theme). */
  candles?: CandleColors;
}

const INTRADAY = new Set(['1m', '5m', '15m', '30m', '1H']);
/**
 * Empty space right of the newest bar, where current-level labels and next-bar levels live.
 * Set as a bar count: `rightOffsetPixels` is accepted but not applied on 5.2.1 (observed).
 */
const labelGutter = (width: number) => Math.round(Math.min(200, Math.max(110, width * 0.22)));
const INITIAL_BARS = 160;

function chartColors(P: Palette) {
  return {
    layout: { background: { color: P.plate }, textColor: P.sage, fontFamily: 'Archivo, system-ui, sans-serif', fontSize: 11, attributionLogo: true },
    grid: { vertLines: { color: withAlpha(P.rule, 0.35) }, horzLines: { color: withAlpha(P.rule, 0.35) } },
    rightPriceScale: { borderColor: P.rule },
    timeScale: { borderColor: P.rule },
    crosshair: {
      vertLine: { color: withAlpha(P.paperDim, 0.5), labelBackgroundColor: P.plate2 },
      horzLine: { color: withAlpha(P.paperDim, 0.5), labelBackgroundColor: P.plate2 },
    },
  };
}

/** Latest bars, default zoom, price axis fitted to the candles. */
export function resetView(chart: IChartApi, series: ISeriesApi<'Candlestick'>) {
  series.priceScale().setAutoScale(true);
  const width = chart.timeScale().width(), gutter = labelGutter(width);
  const spacing = Math.max(2, Math.min(14, (width - gutter) / INITIAL_BARS));
  chart.timeScale().applyOptions({ barSpacing: spacing, rightOffset: Math.ceil(gutter / spacing) });
  chart.timeScale().scrollToRealTime();
}

export function ChartView({ state, groups, heat, heatStyle, theme, onInspect, onNeedMore, onReady, tpo, candles }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const h = useRef<{ chart: IChartApi; series: ISeriesApi<'Candlestick'>; model: RenderModel; heat: HeatLayer; levels: LevelsLayer; tpo: TpoLayer } | null>(null);
  const shown = useRef<{ symbol: string; tf: string; first: number; times: number[] } | null>(null);
  const cb = useRef({ onInspect, onNeedMore });
  cb.current = { onInspect, onNeedMore };
  const [tip, setTip] = useState<{ x: number; y: number; hit: TpoHit } | null>(null);
  const tpoHover = useRef(false);
  tpoHover.current = !!tpo?.data && !!tpo.settings.hover;

  // Mount once.
  useEffect(() => {
    const el = box.current!;
    const P = readPalette();
    const chart = createChart(el, {
      autoSize: true,
      ...chartColors(P),
      crosshair: { mode: CrosshairMode.Normal, ...chartColors(P).crosshair },
      timeScale: { ...chartColors(P).timeScale, rightOffset: 24, barSpacing: 7, minBarSpacing: 0.5 },
      rightPriceScale: { ...chartColors(P).rightPriceScale, scaleMargins: { top: 0.08, bottom: 0.08 } },
    });
    const series = chart.addSeries(CandlestickSeries, { ...candleColors(P, candles), priceLineColor: P.seal, priceLineWidth: 1, lastValueVisible: true });
    const model = new RenderModel();
    model.palette = P;
    const heatL = new HeatLayer(model), levelsL = new LevelsLayer(model), tpoL = new TpoLayer(model);
    series.attachPrimitive(heatL);
    series.attachPrimitive(tpoL);
    series.attachPrimitive(levelsL);
    h.current = { chart, series, model, heat: heatL, levels: levelsL, tpo: tpoL };

    const onMove = (p: MouseEventParams<Time>) => {
      const hit = tpoHover.current && p.point ? tpoL.hit(p.point.x, p.point.y) : null;
      setTip(hit && p.point ? { x: p.point.x, y: p.point.y, hit } : null);
      if (!p.point || p.logical === undefined) return cb.current.onInspect(null);
      const price = series.coordinateToPrice(p.point.y);
      if (price === null) return cb.current.onInspect(null);
      const iv = intervalAt(model.timeline, logicalToTime(model.times, model.span, p.logical));
      const contributors: HeatRow['contributors'] = [];
      let score = 0;
      for (const idx of iv?.active ?? []) {
        const s = model.segments[idx]!;
        const w = contribution(s.tf, s.developing, s.price, price, model.bandwidth);
        if (w > 0) { score += w; contributors.push({ id: s.id, weight: w }); }
      }
      contributors.sort((a, b) => b.weight - a.weight);
      const intensity = Math.min(1, score / model.reference);
      cb.current.onInspect({ price, score, intensity, zone: zoneOf(intensity), contributors });
    };
    chart.subscribeCrosshairMove(onMove);
    const onRange = (r: { from: number; to: number } | null) => { if (r && r.from < 15) cb.current.onNeedMore(); };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    onReady?.({ chart, series, model, container: el });
    if (import.meta.env.DEV) (window as unknown as { __pm?: unknown }).__pm = { chart, series, model };
    return () => {
      onReady?.(null);
      chart.unsubscribeCrosshairMove(onMove);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.remove();
      h.current = null;
      shown.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Theme.
  useEffect(() => {
    const c = h.current;
    if (!c) return;
    const P = readPalette();
    c.model.palette = P;
    c.chart.applyOptions(chartColors(P));
    c.series.applyOptions({ priceLineColor: P.seal });
    c.heat.invalidate();
    c.tpo.invalidate();
  }, [theme]);

  // TPO profiles; candles in the member's colours, or hidden (transparent) so the TPO letters read cleanly.
  useEffect(() => { h.current?.tpo.set(tpo?.data ?? null, tpo?.settings ?? DEFAULT_TPO); }, [tpo?.data, tpo?.settings]);
  const hideCandles = !!tpo?.settings.hideCandles;
  useEffect(() => {
    const c = h.current;
    if (!c) return;
    const clear = 'rgba(0, 0, 0, 0)';
    c.series.applyOptions(hideCandles
      ? { upColor: clear, downColor: clear, borderUpColor: clear, borderDownColor: clear, wickUpColor: clear, wickDownColor: clear }
      : candleColors(readPalette(), candles));
  }, [hideCandles, theme, candles]);

  // Data.
  useEffect(() => {
    const c = h.current;
    if (!c) return;
    const { instrument, chartTf, bars } = state;
    const tz = instrument.timezone, tick = instrument.tick;
    const data = bars.map((b) => ({ time: b.t as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c }));
    const prev = shown.current;
    const first = bars[0]?.t ?? 0;
    const sameSeries = prev && prev.symbol === instrument.symbol && prev.tf === chartTf;

    if (!sameSeries) {
      // A new symbol or timeframe: fit the price axis to the new candles. Scrolling or dragging
      // the axis turns auto-scale off, and the library would otherwise keep the old symbol's range.
      c.series.priceScale().setAutoScale(true);
      c.chart.applyOptions({
        localization: { timeFormatter: (t: Time) => formatBarTime(t as number, chartTf, tz), priceFormatter: (p: number) => formatPrice(p, tick) },
        timeScale: { timeVisible: INTRADAY.has(chartTf), secondsVisible: false, tickMarkFormatter: (t: Time, kind: number) => formatTick(t as number, kind, tz) },
      });
      c.series.applyOptions({ priceFormat: { type: 'price', precision: decimalsForTick(tick), minMove: tick } });
      c.series.setData(data);
      resetView(c.chart, c.series);
    } else if (first < prev.first) {
      // More history arrived on the left: keep the view where it was.
      const range = c.chart.timeScale().getVisibleLogicalRange();
      const shift = bars.findIndex((b) => b.t === prev.first);
      c.series.setData(data);
      if (range && shift > 0) c.chart.timeScale().setVisibleLogicalRange({ from: range.from + shift, to: range.to + shift });
    } else {
      // Live increment: update the forming bar and append new ones.
      const lastShown = prev.times[prev.times.length - 1] ?? -Infinity;
      for (const d of data) if ((d.time as number) >= lastShown) c.series.update(d);
    }
    shown.current = { symbol: instrument.symbol, tf: chartTf, first, times: bars.map((b) => b.t) };

    const m = c.model;
    m.times = bars.map((b) => b.t);
    m.span = barSpan(m.times);
    m.tick = tick;
    m.tz = tz;
    m.heat = heat;
    m.heatStyle = heatStyle;
    const finest = state.frames[state.frames.length - 1];
    m.setSegments(state.segments.filter((s) => groups.includes(s.key.group)), finest?.atr ?? null, !!sameSeries && !reducedMotion());
    c.heat.invalidate();
    c.levels.invalidate();
  }, [state, groups, heat, heatStyle]);

  return (
    <>
      <div ref={box} className="chart-box" />
      {tip && tpo?.data && <TpoTip tip={tip} data={tpo.data} stats={tpo.settings.hoverStats} tz={state.instrument.timezone} flip={tip.x > (box.current?.clientWidth ?? 0) - 300} up={tip.y > (box.current?.clientHeight ?? 0) - 190} />}
      <button
        className="btn chart-reset" title="Jump to the latest bars and fit the price axis (or double-click the price axis)"
        onClick={() => { const c = h.current; if (c) resetView(c.chart, c.series); }}
      >Reset view</button>
    </>
  );
}

const TIP_TF: Record<string, string> = { '5m': '5m', '30m': '30m', '1H': '1H', '4H': '1H' };

/** TPO hover card: the cell under the pointer, plus the profile's figures when asked. */
function TpoTip({ tip, data, stats, tz, flip, up }: { tip: { x: number; y: number; hit: TpoHit }; data: TpoResponse; stats: boolean; tz: string; flip: boolean; up: boolean }) {
  const { profile: p, price, count, letter } = tip.hit;
  const tick = data.instrument.tick;
  const f = (v: number) => formatPrice(v, tick);
  const rows: Array<[string, string]> = [];
  if (letter !== null) rows.push([`Letter ${tpoLetter(letter)}`, formatBarTime(p.periods[letter]!, TIP_TF[data.block]!, tz)]);
  if (price !== null) rows.push([f(price), `${count} TPO${count === 1 ? '' : 's'}`]);
  if (stats) {
    rows.push(['POC', f(p.poc)], ['Value area', `${f(p.val)} – ${f(p.vah)}`], ['High / low', `${f(p.high)} / ${f(p.low)}`],
      ['Initial balance', `${f(p.ibLow)} – ${f(p.ibHigh)}`], ['TPOs', `${p.tpos} (${p.above} above, ${p.below} below POC)`], ['Span', `${p.periods.length} letters of ${data.block}`]);
  }
  return (
    <div className="tpo-tip" role="tooltip" style={{ ...(flip ? { right: `calc(100% - ${tip.x - 14}px)` } : { left: tip.x + 14 }), ...(up ? { bottom: `calc(100% - ${tip.y - 14}px)` } : { top: tip.y + 14 }) }}>
      <strong>{p.label}{p.complete ? '' : ' · developing'}</strong>
      {rows.map(([k, v]) => <div key={k}><span className="muted">{k}</span> {v}</div>)}
    </div>
  );
}
