/**
 * Presence on a shared chart: draws other members' cursors, sends ours
 * (throttled), and handles presenting: the presenter's candle timeframe, level
 * timeframes and visible time range go out with their presence; followers
 * apply them. Any pan or zoom by a follower stops following, the way
 * whiteboard tools do.
 */
import { useEffect, useRef } from 'react';
import type { PresenterView, Timeframe } from '@paradise/contract';
import type { ChartHandles } from '../chart/ChartView.tsx';
import { PresenceLayer } from '../chart/presenceLayer.ts';
import type { ChartState } from '../chart/state.ts';
import { logicalToTime, timeToLogical } from '../chart/time.ts';
import type { ViewState } from '../lib/view.ts';
import type { ShareSession } from './useShare.ts';

const CURSOR_MS = 50;      // 20 updates/s, under the server's 30/s
const VIEW_MS = 120;
const VIEW_HEARTBEAT_MS = 2000; // so members who start following catch up quickly

export function sameView(a: PresenterView, b: PresenterView, span: number) {
  return a.chartTf === b.chartTf && a.timeframes.join() === b.timeframes.join()
    && Math.abs(a.from - b.from) < span / 4 && Math.abs(a.to - b.to) < span / 4;
}

export function usePresence(
  share: ShareSession, handles: ChartHandles | null, state: ChartState | null,
  view: ViewState, setView: (patch: Partial<ViewState>) => void,
) {
  const layer = useRef<PresenceLayer | null>(null);
  const live = useRef({ share, view, state });
  live.current = { share, view, state };
  const lastCursor = useRef<{ t: number; p: number } | null>(null);
  const active = share.active && share.status === 'live';

  // Draw others' cursors.
  useEffect(() => {
    if (!handles || !share.active) return;
    const l = new PresenceLayer(handles.model);
    handles.series.attachPrimitive(l);
    layer.current = l;
    const paint = () => {
      const { share: s } = live.current;
      l.cursors = s.cursors.list().map(({ peer, at }) => ({ at, name: peer.username, color: peer.color, presenting: peer.id === s.presenter }));
      l.invalidate();
    };
    paint();
    const off = share.cursors.subscribe(paint);
    return () => { off(); handles.series.detachPrimitive(l); layer.current = null; };
  }, [handles, share.active, share.cursors]);

  // Current visible range as a presenter view.
  const currentView = (): PresenterView | null => {
    const { state: st, view: v } = live.current;
    const range = handles?.chart.timeScale().getVisibleLogicalRange();
    if (!st || !range || !handles) return null;
    const m = handles.model;
    return { chartTf: st.chartTf as Timeframe, timeframes: v.timeframes, from: Math.round(logicalToTime(m.times, m.span, range.from)), to: Math.round(logicalToTime(m.times, m.span, range.to)) };
  };

  // Send our cursor.
  useEffect(() => {
    if (!handles || !active) return;
    const el = handles.container;
    let last = 0, pending: ReturnType<typeof setTimeout> | null = null, latest: PointerEvent | null = null;
    const send = () => {
      pending = null;
      last = Date.now();
      const l = layer.current, e = latest;
      if (!l || !e) return;
      const r = el.getBoundingClientRect(), { width, height } = l.size();
      const pt = { x: e.clientX - r.left, y: e.clientY - r.top };
      const at = pt.x >= 0 && pt.y >= 0 && pt.x <= width && pt.y <= height ? l.unproject(pt) : null;
      lastCursor.current = at;
      const s = live.current.share;
      s.sendPresence(at, s.presenting ? currentView() ?? undefined : undefined);
    };
    const move = (e: PointerEvent) => {
      latest = e;
      if (pending) return;
      pending = setTimeout(send, Math.max(0, CURSOR_MS - (Date.now() - last)));
    };
    const leave = () => { if (pending) clearTimeout(pending); pending = null; lastCursor.current = null; live.current.share.sendPresence(null); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); if (pending) clearTimeout(pending); };
  }, [handles, active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Presenting: broadcast the view when it changes, and as a heartbeat.
  useEffect(() => {
    if (!handles || !active || !share.presenting) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const push = () => { timer = null; const v = currentView(); if (v) live.current.share.sendPresence(lastCursor.current, v); };
    const onRange = () => { if (!timer) timer = setTimeout(push, VIEW_MS); };
    handles.chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    push();
    const beat = setInterval(push, VIEW_HEARTBEAT_MS);
    return () => { handles.chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange); clearInterval(beat); if (timer) clearTimeout(timer); };
  }, [handles, active, share.presenting, view.chartTf, view.timeframes.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // Following: adopt the presenter's frames, then their visible range once those candles are loaded.
  const pv = share.following ? share.presenterView : null;
  useEffect(() => {
    if (!pv) return;
    const v = live.current.view;
    if (v.chartTf !== pv.chartTf || v.timeframes.join() !== pv.timeframes.join()) { setView({ chartTf: pv.chartTf, timeframes: pv.timeframes }); return; }
    if (!handles || !state || state.chartTf !== pv.chartTf) return;
    const m = handles.model;
    if (!m.times.length) return;
    const cur = currentView();
    if (cur && sameView(cur, pv, m.span)) return;
    handles.chart.timeScale().setVisibleLogicalRange({ from: timeToLogical(m.times, m.span, pv.from), to: timeToLogical(m.times, m.span, pv.to) });
  }, [pv, handles, state, setView]);

  // A follower who pans, zooms or scrolls takes back control.
  useEffect(() => {
    if (!handles || !share.following) return;
    const el = handles.container;
    const stop = () => live.current.share.setFollowing(false);
    el.addEventListener('pointerdown', stop);
    el.addEventListener('wheel', stop, { passive: true });
    return () => { el.removeEventListener('pointerdown', stop); el.removeEventListener('wheel', stop); };
  }, [handles, share.following]);
}
