/**
 * Drawing tools controller. Pointer input on the chart container is captured
 * while a tool is active (so the chart doesn't pan), and while dragging a
 * selected drawing.
 *
 * Where drawings live is a DrawingSource: your own drawings per instrument
 * (saved debounced over REST), or a shared chart (every change becomes live
 * ops; other members' changes arrive through `subscribe`). The tools don't
 * know which.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Drawing, DrawingColor, DrawingKind, DrawingsResponse } from '@paradise/contract';
import { api, ApiError } from '../api.ts';
import type { ChartHandles } from '../chart/ChartView.tsx';
import { hitTest, newId, simplify, translate, type Handle, type Pt } from './geometry.ts';
import { DrawingsLayer } from './layer.ts';

export type Tool = 'cursor' | DrawingKind;
export interface TextPrompt { x: number; y: number; anchor: { t: number; p: number } }
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface DrawingSource {
  /** Identity: the drawings reload when it changes. */
  id: string;
  editable: boolean;
  load(signal: AbortSignal): Promise<Drawing[]>;
  /** Persist a local change (the full new list). */
  save(next: Drawing[], report: (s: SaveStatus) => void): void;
  /** Changes made elsewhere (shared charts; another tab's save for your own). */
  subscribe?(onChange: (drawings: Drawing[]) => void): () => void;
}

const SAVE_DEBOUNCE_MS = 600;

/**
 * Your own drawings for one instrument. Each save carries the version it was
 * based on; if another tab or device saved in between, the server refuses (409)
 * and this tab takes the stored drawings instead of overwriting them.
 */
export function personalSource(symbol: string): DrawingSource {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let base: string | null = null;
  let conflicts = 0;
  let saving = Promise.resolve();
  let onChange: ((d: Drawing[]) => void) | null = null;
  return {
    id: `me:${symbol}`,
    editable: true,
    load: (signal) => api.drawings(symbol, signal).then((r) => { base = r.updatedAt; return r.drawings; }),
    save: (next, report) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        report('saving');
        const seen = conflicts;
        // One save at a time, so each is based on the version the previous one stored.
        saving = saving.then(() => {
          if (seen !== conflicts) return report('error'); // edited before the reload: that list is stale
          return api.saveDrawings(symbol, next, base)
            .then((r) => { base = r.updatedAt; report('saved'); })
            .catch((e) => {
              if (e instanceof ApiError && e.status === 409 && e.details) {
                const cur = e.details as DrawingsResponse;
                conflicts++;
                base = cur.updatedAt;
                onChange?.(cur.drawings);
              }
              report('error');
            });
        });
      }, SAVE_DEBOUNCE_MS);
    },
    subscribe: (fn) => { onChange = fn; return () => { onChange = null; }; },
  };
}

export function useDrawings(source: DrawingSource | null, handles: ChartHandles | null, enabled: boolean) {
  const [drawings, setDrawingsState] = useState<Drawing[]>([]);
  const [tool, setTool] = useState<Tool>('cursor');
  const [color, setColor] = useState<DrawingColor>('seal');
  const [selected, setSelected] = useState<string | null>(null);
  const [textPrompt, setTextPrompt] = useState<TextPrompt | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const editable = !!source?.editable;
  const layer = useRef<DrawingsLayer | null>(null);
  const live = useRef({ drawings, tool, color, selected, source, editable });
  live.current = { drawings, tool, color, selected, source, editable };

  const sync = useCallback((d: Drawing[], sel = live.current.selected) => {
    if (!layer.current) return;
    layer.current.drawings = d;
    layer.current.selected = sel;
    layer.current.invalidate();
  }, []);

  /** Change drawings and persist through the source. */
  const commit = useCallback((next: Drawing[]) => {
    const src = live.current.source;
    if (!src?.editable) return;
    live.current.drawings = next;
    setDrawingsState(next);
    sync(next);
    src.save(next, setStatus);
  }, [sync]);

  // Load from the source (only once signed in and on the chart), and follow changes made elsewhere.
  useEffect(() => {
    if (!enabled || !source) return;
    const ctrl = new AbortController();
    setSelected(null);
    source.load(ctrl.signal)
      .then((d) => { if (!ctrl.signal.aborted) { live.current.drawings = d; setDrawingsState(d); sync(d, null); setStatus('idle'); } })
      .catch((e) => { if ((e as Error).name !== 'AbortError') setStatus('error'); });
    const unsubscribe = source.subscribe?.((d) => {
      live.current.drawings = d;
      setDrawingsState(d);
      const sel = live.current.selected && d.some((x) => x.id === live.current.selected) ? live.current.selected : null;
      if (sel !== live.current.selected) setSelected(sel);
      sync(d, sel);
    });
    return () => { ctrl.abort(); unsubscribe?.(); };
  }, [source, sync, enabled]);

  // Read-only: no tools.
  useEffect(() => { if (!editable) { setTool('cursor'); setTextPrompt(null); } }, [editable]);

  // Attach the layer to the chart.
  useEffect(() => {
    if (!handles) return;
    const l = new DrawingsLayer(handles.model);
    handles.series.attachPrimitive(l);
    layer.current = l;
    sync(live.current.drawings);
    return () => { handles.series.detachPrimitive(l); layer.current = null; };
  }, [handles, sync]);

  // While a tool is active the chart must not pan or zoom.
  useEffect(() => {
    handles?.chart.applyOptions({ handleScroll: tool === 'cursor', handleScale: tool === 'cursor' });
    if (handles) handles.container.style.cursor = tool === 'cursor' ? '' : 'crosshair';
  }, [tool, handles]);

  useEffect(() => { sync(drawings, selected); }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pointer controller.
  useEffect(() => {
    if (!handles) return;
    const el = handles.container;
    const L = () => layer.current!;
    let gesture:
      | { kind: 'create'; draft: Drawing; brush?: Pt[] }
      | { kind: 'drag'; id: string; handle: Handle; start: { t: number; p: number }; original: Drawing }
      | null = null;

    const local = (e: PointerEvent): Pt | null => {
      const canvasRect = el.getBoundingClientRect();
      const pt = { x: e.clientX - canvasRect.left, y: e.clientY - canvasRect.top };
      const { width, height } = L().size();
      return pt.x >= 0 && pt.y >= 0 && pt.x <= width && pt.y <= height ? pt : null;
    };
    const capture = (e: PointerEvent) => { e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); };

    const down = (e: PointerEvent) => {
      if (!layer.current || e.button !== 0 || !live.current.editable) return;
      const pt = local(e);
      if (!pt) return;
      const anchor = L().unproject(pt);
      if (!anchor) return;
      const { tool: t, color: c, drawings: ds, selected: sel } = live.current;
      if (t === 'cursor') {
        const hit = hitTest(ds, pt, L().project, L().size(), sel, L().measure);
        if (!hit) { if (sel) setSelected(null); return; }
        capture(e);
        setSelected(hit.id);
        handles.chart.applyOptions({ handleScroll: false, handleScale: false });
        gesture = { kind: 'drag', id: hit.id, handle: hit.handle, start: anchor, original: ds.find((d) => d.id === hit.id)! };
        return;
      }
      capture(e);
      const id = newId();
      if (t === 'hline') { commit([...ds, { id, kind: 'hline', color: c, p: anchor.p }]); setSelected(id); setTool('cursor'); return; }
      if (t === 'vline') { commit([...ds, { id, kind: 'vline', color: c, t: anchor.t }]); setSelected(id); setTool('cursor'); return; }
      if (t === 'text') { setTextPrompt({ x: pt.x, y: pt.y, anchor }); return; }
      const draft: Drawing = t === 'trend' ? { id, kind: 'trend', color: c, a: anchor, b: anchor, extend: false }
        : t === 'rect' ? { id, kind: 'rect', color: c, a: anchor, b: anchor }
        : { id, kind: 'brush', color: c, pts: [anchor] };
      gesture = { kind: 'create', draft, brush: t === 'brush' ? [pt] : undefined };
      L().draft = draft;
      L().invalidate();
    };

    const move = (e: PointerEvent) => {
      if (!gesture || !layer.current) return;
      const rect = el.getBoundingClientRect();
      const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const anchor = L().unproject(pt);
      if (!anchor) return;
      e.preventDefault(); e.stopPropagation();
      if (gesture.kind === 'create') {
        const d = gesture.draft;
        if (d.kind === 'brush') { gesture.brush!.push(pt); gesture.draft = { ...d, pts: [...d.pts, anchor] }; }
        else if (d.kind === 'trend' || d.kind === 'rect') gesture.draft = { ...d, b: anchor };
        L().draft = gesture.draft;
      } else {
        const g = gesture;
        const o = g.original;
        let next: Drawing;
        if (g.handle === 'body') next = translate(o, anchor.t - g.start.t, anchor.p - g.start.p);
        else if (o.kind === 'trend' || o.kind === 'rect') next = { ...o, [g.handle]: anchor };
        else next = o;
        const ds = live.current.drawings.map((d) => (d.id === g.id ? next : d));
        live.current.drawings = ds;
        L().drawings = ds;
      }
      L().invalidate();
    };

    const up = (e: PointerEvent) => {
      if (!gesture || !layer.current) return;
      e.stopPropagation();
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      const g = gesture;
      gesture = null;
      if (g.kind === 'create') {
        L().draft = null;
        let d = g.draft;
        const project = L().project;
        if (d.kind === 'brush') {
          const keep = simplify(g.brush!, 1.5);
          const pts = keep.map((p) => L().unproject(p)).filter((a): a is { t: number; p: number } => !!a).slice(0, 2000);
          d = { ...d, pts };
          if (pts.length < 2) { L().invalidate(); return; }
        } else if (d.kind === 'trend' || d.kind === 'rect') {
          const a = project(d.a), b = project(d.b);
          if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) < 4) { L().invalidate(); return; }
        }
        commit([...live.current.drawings, d]);
        setSelected(d.id);
        if (d.kind !== 'brush') setTool('cursor');
      } else {
        handles.chart.applyOptions({ handleScroll: live.current.tool === 'cursor', handleScale: live.current.tool === 'cursor' });
        commit(live.current.drawings);
      }
    };

    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move, true);
    el.addEventListener('pointerup', up, true);
    el.addEventListener('pointercancel', up, true);
    return () => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move, true);
      el.removeEventListener('pointerup', up, true);
      el.removeEventListener('pointercancel', up, true);
    };
  }, [handles, commit]);

  // Keyboard: Delete removes the selection, Escape cancels.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select') || !live.current.editable) return;
      const { selected: sel, drawings: ds } = live.current;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { commit(ds.filter((d) => d.id !== sel)); setSelected(null); e.preventDefault(); }
      else if (e.key === 'Escape') { setTool('cursor'); setSelected(null); setTextPrompt(null); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [commit]);

  const selectedDrawing = drawings.find((d) => d.id === selected) ?? null;
  return {
    drawings, tool, setTool, color, selected, selectedDrawing, status, textPrompt, editable,
    setColor: (c: DrawingColor) => {
      setColor(c);
      if (selected) commit(drawings.map((d) => (d.id === selected ? { ...d, color: c } : d)));
    },
    toggleExtend: () => {
      if (selectedDrawing?.kind === 'trend') commit(drawings.map((d) => (d.id === selected && d.kind === 'trend' ? { ...d, extend: !d.extend } : d)));
    },
    removeSelected: () => { if (selected) { commit(drawings.filter((d) => d.id !== selected)); setSelected(null); } },
    clearAll: () => { commit([]); setSelected(null); },
    submitText: (text: string) => {
      const p = textPrompt;
      setTextPrompt(null);
      setTool('cursor');
      const trimmed = text.trim().slice(0, 200);
      if (!p || !trimmed) return;
      const id = newId();
      commit([...drawings, { id, kind: 'text', color, a: p.anchor, text: trimmed }]);
      setSelected(id);
    },
    cancelText: () => { setTextPrompt(null); setTool('cursor'); },
  };
}
