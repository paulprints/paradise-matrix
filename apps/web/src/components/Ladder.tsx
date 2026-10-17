import { memo, useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent } from 'react';
import type { Level, LevelsResponse } from '@paradise/contract';
import { bandwidthFor, computeHeat, viridisCss, ZONES, type HeatRow, type HeatStyle, type Zone } from '../lib/heat.ts';
import { formatPrice } from '../lib/format.ts';
import { placeLabels } from '../lib/layout.ts';
import { ZOOM_STEPS } from '../lib/view.ts';

interface Props {
  data: LevelsResponse;
  levels: Level[];
  heat: boolean;
  heatStyle?: HeatStyle;
  zoom: number;
  onZoom: (z: number) => void;
  onInspect: (row: HeatRow | null) => void;
}

const AXIS_W = 62;
const PAD_Y = 18;
const CELL = 7;
const LABEL_GAP = 15;
const TF_RANK: Record<string, number> = { M: 0, W: 1, D: 2, '1H': 3, '30m': 4, '15m': 5, '5m': 6, '1m': 7 };

/** Lower = more important. Decides which levels keep a text label when space runs out. */
export function labelPriority(l: Level): number {
  const g = l.group === 'structure' ? (l.slug === 'pivot' || l.slug.startsWith('band') ? 0 : 1)
    : l.group === 'profile' ? 2 : l.group === 'range' ? 3 : 4;
  return (l.basis === 'developing' ? 10 : 0) + g * 10 + (TF_RANK[l.tf] ?? 6) * 0.1;
}

function useSize<T extends Element>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e!.contentRect.width, h: e!.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function niceStep(span: number, target = 8): number {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
}

export interface ZoneBlock { zone: Zone; from: number; to: number; peak: number }

/** Contiguous runs of the same zone (rows are ordered top → bottom), with each run's peak intensity. */
export function zoneBlocks(rows: readonly Pick<HeatRow, 'zone' | 'intensity'>[]): ZoneBlock[] {
  const out: ZoneBlock[] = [];
  rows.forEach((r, i) => {
    const last = out[out.length - 1];
    if (last && last.zone === r.zone) { last.to = i; last.peak = Math.max(last.peak, r.intensity); }
    else out.push({ zone: r.zone, from: i, to: i, peak: r.intensity });
  });
  return out;
}

/**
 * The v1 "Energy Matrix" column: every row painted on the viridis scale
 * (purple = little overlap, yellow = heaviest), each zone run labelled with its
 * name and peak. Percentages are on the fixed scale, not relative to the max.
 */
const MatrixColumn = memo(function MatrixColumn({ rows, x0, x1, top, bottom }: { rows: HeatRow[]; x0: number; x1: number; top: number; bottom: number }) {
  if (!rows.length) return null;
  const h = (bottom - top) / rows.length;
  return <g aria-hidden="true">{rows.map((r, i) => <rect key={i} x={x0} y={top + i * h} width={x1 - x0} height={h + 0.6} fill={viridisCss(r.intensity)} />)}</g>;
});

/** Zone names and peaks, drawn above the level rules so lines never strike through them. */
function MatrixLabels({ rows, x0, top, bottom }: { rows: HeatRow[]; x0: number; top: number; bottom: number }) {
  if (!rows.length) return null;
  const h = (bottom - top) / rows.length;
  return (
    <g aria-hidden="true">
      {zoneBlocks(rows).map((b) => {
        const y0 = top + b.from * h, y1 = top + (b.to + 1) * h;
        if (y1 - y0 < 18) return null;
        return (
          <text key={b.from} className="zone-lab" x={x0 + 8} y={(y0 + y1) / 2 + 4}>
            {ZONES[b.zone].label} <tspan className="num">{Math.round(b.peak * 100)}%</tspan>
          </text>
        );
      })}
    </g>
  );
}

/** Halftone dots: radius ∝ √intensity, alternate rows offset half a cell. Memoised — the expensive layer. */
const Halftone = memo(function Halftone({ rows, x0, x1, top, bottom, min, max }: { rows: HeatRow[]; x0: number; x1: number; top: number; bottom: number; min: number; max: number }) {
  if (!rows.length) return null;
  const dots: JSX.Element[] = [];
  const h = bottom - top;
  let line = 0;
  for (let y = top + CELL / 2; y < bottom; y += CELL, line++) {
    const price = max - ((y - top) / h) * (max - min);
    const idx = Math.round(((max - price) / (max - min)) * (rows.length - 1));
    const it = rows[Math.min(rows.length - 1, Math.max(0, idx))]!.intensity;
    if (it < 0.06) continue;
    const r = (CELL / 2) * Math.sqrt(it) * 0.92;
    const offset = line % 2 ? CELL / 2 : 0;
    for (let x = x0 + CELL / 2 + offset; x < x1; x += CELL) dots.push(<circle key={`${line}-${x}`} className="dot" cx={x} cy={y} r={r} />);
  }
  return <g aria-hidden="true">{dots}</g>;
});

export function Ladder({ data, levels, heat, heatStyle = 'matrix', zoom, onZoom, onInspect }: Props) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const [cursor, setCursor] = useState<number | null>(null);
  const tick = data.instrument.tick;
  const finest = data.frames[data.frames.length - 1];
  const center = data.lastPrice?.price ?? levels.find((l) => l.slug === 'pivot')?.price ?? 0;
  const atr = finest?.atr ?? null;

  const { min, max } = useMemo(() => {
    const span = atr ? atr * zoom : Math.max(...levels.map((l) => Math.abs((l.price ?? center) - center)), center * 0.01) * 2.2;
    return { min: center - span / 2, max: center + span / 2 };
  }, [atr, zoom, center, levels]);

  const top = PAD_Y, bottom = Math.max(PAD_Y + 10, h - PAD_Y);
  const y = (p: number) => top + ((max - p) / (max - min)) * (bottom - top);
  const priceAt = (py: number) => max - ((py - top) / (bottom - top)) * (max - min);

  const narrow = w < 560;
  const stripX0 = AXIS_W;
  const stripX1 = AXIS_W + (narrow ? Math.max(56, (w - AXIS_W) * 0.26) : Math.max(90, Math.min(300, (w - AXIS_W) * 0.38)));
  const labelX = stripX1 + (narrow ? 22 : 42);

  const rows = useMemo(
    () => computeHeat({ levels, min, max, rows: Math.max(60, Math.round((bottom - top) / 3)), bandwidth: bandwidthFor(atr, max - min) }),
    [levels, min, max, bottom, top, atr],
  );

  const inView = levels.filter((l) => l.price !== null && l.price >= min && l.price <= max);
  const above = levels.filter((l) => l.price !== null && l.price > max).length;
  const below = levels.filter((l) => l.price !== null && l.price < min).length;
  const capacity = Math.max(1, Math.floor((bottom - top) / LABEL_GAP));
  const labelled = new Set([...inView].sort((a, b) => labelPriority(a) - labelPriority(b)).slice(0, capacity).map((l) => l.id));
  const unlabelled = inView.filter((l) => !labelled.has(l.id));
  const placed = placeLabels(inView.filter((l) => labelled.has(l.id)).map((l) => ({ item: l, y: y(l.price!) })), LABEL_GAP, top + 6, bottom - 4);

  const step = niceStep(max - min);
  const ticks: number[] = [];
  for (let p = Math.ceil(min / step) * step; p <= max; p += step) ticks.push(p);

  const rowAt = (price: number) => {
    if (!rows.length) return null;
    const i = Math.round(((max - price) / (max - min)) * (rows.length - 1));
    return rows[Math.min(rows.length - 1, Math.max(0, i))]!;
  };
  const inspect = (price: number | null) => {
    setCursor(price);
    onInspect(price === null ? null : rowAt(price));
  };
  useEffect(() => { if (cursor !== null) onInspect(rowAt(cursor)); /* refresh on data change */ }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const py = e.clientY - r.top;
    if (py >= top && py <= bottom) inspect(priceAt(py));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const stepPx = (max - min) / ((bottom - top) / 6);
    const cur = cursor ?? center;
    if (e.key === 'ArrowUp') { inspect(Math.min(max, cur + stepPx)); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { inspect(Math.max(min, cur - stepPx)); e.preventDefault(); }
    else if (e.key === 'Escape') inspect(null);
    else if (e.key === '+' || e.key === '=') zoomBy(-1);
    else if (e.key === '-') zoomBy(1);
  };
  const zi = ZOOM_STEPS.indexOf(zoom);
  const zoomBy = (d: number) => { const n = ZOOM_STEPS[zi + d]; if (n) onZoom(n); };

  const levelClass = (l: Level) =>
    l.group === 'profile' ? 'profile' : l.basis === 'developing' ? 'dev' : l.group === 'structure' && (l.slug === 'pivot' || l.slug.startsWith('band')) ? 'strong' : '';

  return (
    <div ref={ref} className="ladder-wrap">
      {w > 0 && h > 0 && (
        <svg
          className="ladder" width={w} height={h} tabIndex={0} role="img"
          aria-label={`Level ladder for ${data.instrument.root}. ${inView.length} levels in view. Use arrow keys to inspect, plus and minus to zoom.`}
          onPointerMove={onPointer} onPointerDown={onPointer} onPointerLeave={(e) => e.pointerType === 'mouse' && inspect(null)} onKeyDown={onKey}
        >
          <rect className="gutter" x={0} y={0} width={AXIS_W - 8} height={h} />
          {ticks.map((p) => (
            <text key={p} className="axis" x={AXIS_W - 14} y={y(p) + 4} textAnchor="end">{formatPrice(p, step < 1 ? tick : Math.max(tick, 1))}</text>
          ))}
          {heat && (heatStyle === 'matrix'
            ? <MatrixColumn rows={rows} x0={stripX0} x1={stripX1} top={top} bottom={bottom} />
            : <Halftone rows={rows} x0={stripX0} x1={stripX1} top={top} bottom={bottom} min={min} max={max} />)}
          {unlabelled.map((l) => (
            <line key={l.id} className={`rule faint ${levelClass(l)}`} x1={stripX0} x2={stripX1 + 10} y1={y(l.price!)} y2={y(l.price!)} />
          ))}
          {placed.map(({ item: l, y: ly, labelY }) => {
            const cls = levelClass(l);
            return (
              <g key={l.id}>
                <line className={`rule ${cls}`} x1={stripX0} x2={labelX - 18} y1={ly} y2={ly} />
                <path className="leader" d={`M${labelX - 18} ${ly} L${labelX - 6} ${labelY}`} fill="none" />
                <text className={`lab ${cls}`} x={labelX} y={labelY + 4}>
                  <tspan className="tf">{l.tf}</tspan> {l.label} <tspan dx="4">{formatPrice(l.price!, tick)}</tspan>
                </text>
              </g>
            );
          })}
          {heat && heatStyle === 'matrix' && <MatrixLabels rows={rows} x0={stripX0} top={top} bottom={bottom} />}
          {data.lastPrice && (
            <g>
              <line className="price-line" x1={AXIS_W - 8} x2={w} y1={y(center)} y2={y(center)} />
              <g className="price-tag" transform={`translate(0 ${y(center) - 10})`}>
                <rect width={AXIS_W - 4} height={20} rx={3} />
                <text x={(AXIS_W - 4) / 2} y={14} textAnchor="middle">{formatPrice(center, tick)}</text>
              </g>
            </g>
          )}
          {cursor !== null && <line className="cursor" x1={stripX0} x2={w} y1={y(cursor)} y2={y(cursor)} />}
        </svg>
      )}
      {above > 0 && <div className="offscale top">{above} more above</div>}
      {below > 0 && <div className="offscale bottom">{below} more below</div>}
      {unlabelled.length > 0 && <div className="offscale hint">{unlabelled.length} unlabelled; point to inspect or zoom in</div>}
      <div className="zoom">
        <button className="btn" onClick={() => zoomBy(-1)} disabled={zi <= 0} aria-label="Zoom in">+</button>
        <button className="btn" onClick={() => zoomBy(1)} disabled={zi >= ZOOM_STEPS.length - 1} aria-label="Zoom out">−</button>
      </div>
    </div>
  );
}
