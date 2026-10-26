import { useEffect, useRef } from 'react';
import { CandlestickSeries, createChart, CrosshairMode, type IChartApi, type ISeriesApi, type MouseEventParams, type Time, type UTCTimestamp } from 'lightweight-charts';
import type { LevelGroup } from '@paradise/contract';
import { contribution, zoneOf, type HeatRow, type HeatStyle } from '../lib/heat.ts';
import { decimalsForTick, formatBarTime, formatPrice, formatTick } from '../lib/format.ts';
import { reducedMotion } from '../lib/motion.ts';
import { HeatLayer } from './heatLayer.ts';
import { LevelsLayer } from './levelsLayer.ts';
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
const candleColors = (P: Palette) => ({
  upColor: P.plate, borderUpColor: P.paper, wickUpColor: P.paper,
  downColor: P.alert, borderDownColor: P.alert, wickDownColor: P.alert,
  priceLineColor: P.seal,
});

/** Latest bars, default zoom, price axis fitted to the candles. */
export function resetView(chart: IChartApi, series: ISeriesApi<'Candlestick'>) {
  series.priceScale().setAutoScale(true);
  const width = chart.timeScale().width(), gutter = labelGutter(width);
  const spacing = Math.max(2, Math.min(14, (width - gutter) / INITIAL_BARS));
  chart.timeScale().applyOptions({ barSpacing: spacing, rightOffset: Math.ceil(gutter / spacing) });
  chart.timeScale().scrollToRealTime();
}

export function ChartView({ state, groups, heat, heatStyle, theme, onInspect, onNeedMore, onReady }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const h = useRef<{ chart: IChartApi; series: ISeriesApi<'Candlestick'>; model: RenderModel; heat: HeatLayer; levels: LevelsLayer } | null>(null);
  const shown = useRef<{ symbol: string; tf: string; first: number; times: number[] } | null>(null);
  const cb = useRef({ onInspect, onNeedMore });
  cb.current = { onInspect, onNeedMore };

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
    const series = chart.addSeries(CandlestickSeries, { ...candleColors(P), priceLineWidth: 1, lastValueVisible: true });
    const model = new RenderModel();
    model.palette = P;
    const heatL = new HeatLayer(model), levelsL = new LevelsLayer(model);
    series.attachPrimitive(heatL);
    series.attachPrimitive(levelsL);
    h.current = { chart, series, model, heat: heatL, levels: levelsL };

    const onMove = (p: MouseEventParams<Time>) => {
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
    c.series.applyOptions(candleColors(P));
    c.heat.invalidate();
  }, [theme]);

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
      <button
        className="btn chart-reset" title="Jump to the latest bars and fit the price axis (or double-click the price axis)"
        onClick={() => { const c = h.current; if (c) resetView(c.chart, c.series); }}
      >Reset view</button>
    </>
  );
}
