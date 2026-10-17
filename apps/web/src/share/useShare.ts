/**
 * A shared chart session: opens the share over REST (role, settings), then
 * keeps a live connection for drawings, presence and presenting. Exposes a
 * DrawingSource so the normal drawing tools work unchanged on shared charts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Anchor, Drawing, LiveOp, LiveServerMessage, Peer, PresenterView, ShareConfig, ShareInfo, ShareRole } from '@paradise/contract';
import { API_ORIGIN, ApiError, api, SESSION_EXPIRED, tokenStore } from '../api.ts';
import type { DrawingSource } from '../drawings/useDrawings.ts';
import { SharedDoc } from './doc.ts';
import { LiveConnection, type EndReason, type LiveStatus } from './live.ts';
import { Outbox } from './outbox.ts';
import { liveUrl, type ShareRoute } from './route.ts';

export interface CursorInfo { peer: Peer; at: Anchor }
const NOTICE_MS = 4500;

export function useShare(route: ShareRoute | null, enabled: boolean) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [role, setRole] = useState<ShareRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [ended, setEnded] = useState<EndReason | null>(null);
  const [you, setYou] = useState<Peer | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [presenter, setPresenter] = useState<string | null>(null);
  const [presenterView, setPresenterView] = useState<PresenterView | null>(null);
  const [following, setFollowing] = useState(false);
  const [notice, setNoticeState] = useState<string | null>(null);

  const doc = useRef(new SharedDoc());
  const conn = useRef<LiveConnection | null>(null);
  const outbox = useRef<Outbox | null>(null);
  const drawingListeners = useRef(new Set<(d: Drawing[]) => void>());
  const cursors = useRef(new Map<string, Anchor>());
  const cursorListeners = useRef(new Set<() => void>());
  const peersRef = useRef<Peer[]>([]);
  const presenterRef = useRef<string | null>(null);
  const youRef = useRef<Peer | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setNotice = useCallback((m: string | null) => {
    setNoticeState(m);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    if (m) noticeTimer.current = setTimeout(() => setNoticeState(null), NOTICE_MS);
  }, []);
  const emitDrawings = () => { const d = doc.current.list(); drawingListeners.current.forEach((cb) => cb(d)); };
  const emitCursors = () => cursorListeners.current.forEach((cb) => cb());
  const updatePeers = (next: Peer[]) => { peersRef.current = next; setPeers(next); };
  const updatePresenter = (p: string | null) => {
    presenterRef.current = p;
    setPresenter(p);
    if (!p) setPresenterView(null);
    // Following starts when someone else presents; it's the point of presenting. Members can stop.
    setFollowing(!!p && p !== youRef.current?.id);
  };

  const onMessage = useCallback((m: LiveServerMessage) => {
    switch (m.type) {
      case 'welcome': {
        youRef.current = m.you;
        setYou(m.you);
        setRole(m.you.role);
        setInfo(m.share);
        updatePeers(m.peers);
        cursors.current.clear();
        updatePresenter(m.presenter);
        const resend = doc.current.rebase(m.drawings);
        if (resend.length) outbox.current?.push(resend);
        emitDrawings();
        emitCursors();
        break;
      }
      case 'ops':
        if (doc.current.apply(m.ops)) emitDrawings();
        break;
      case 'reject':
        doc.current.force(m.ops);
        emitDrawings();
        setNotice(`Change not saved: ${m.reason}.`);
        break;
      case 'peer':
        if (m.event === 'join') updatePeers([...peersRef.current.filter((p) => p.id !== m.peer.id), m.peer]);
        else { updatePeers(peersRef.current.filter((p) => p.id !== m.peer.id)); cursors.current.delete(m.peer.id); emitCursors(); }
        break;
      case 'presence':
        if (m.cursor) cursors.current.set(m.from, m.cursor); else cursors.current.delete(m.from);
        if (m.view && m.from === presenterRef.current) setPresenterView(m.view);
        emitCursors();
        break;
      case 'present':
        updatePresenter(m.presenter);
        break;
      case 'share':
        setInfo(m.share);
        break;
      case 'error':
        setNotice(m.message);
        break;
    }
  }, [setNotice]);

  // Open over REST, then go live.
  useEffect(() => {
    if (!route || !enabled) return;
    const ctrl = new AbortController();
    setError(null);
    setEnded(null);
    api.openShare(route.id, route.key, ctrl.signal).then((r) => {
      setInfo(r.share);
      setRole(r.role);
      doc.current.load(r.drawings);
      emitDrawings();
      const c = new LiveConnection({
        url: liveUrl(API_ORIGIN, location),
        auth: () => ({ token: tokenStore.get(), share: route.id, ...(route.key ? { key: route.key } : {}) }),
        onMessage,
        onStatus: (s, reason) => {
          setStatus(s);
          if (s !== 'live') { outbox.current?.clear(); cursors.current.clear(); emitCursors(); }
          if (s === 'ended') {
            setEnded(reason ?? null);
            updatePeers([]);
            updatePresenter(null);
            if (reason === 'auth') { tokenStore.clear(); window.dispatchEvent(new Event(SESSION_EXPIRED)); }
          }
        },
      });
      outbox.current = new Outbox((ops: LiveOp[]) => c.send({ type: 'ops', ops }));
      conn.current = c;
      c.start();
    }).catch((e) => {
      if ((e as Error).name === 'AbortError') return;
      setError(e instanceof ApiError && e.status === 404 ? 'This shared chart doesn’t exist, or the link was revoked. Ask its owner for a new link.' : (e as Error).message);
    });
    return () => {
      ctrl.abort();
      conn.current?.stop();
      conn.current = null;
      outbox.current?.clear();
      outbox.current = null;
    };
  }, [route?.id, route?.key, enabled, onMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  const editable = !!role && role !== 'viewer' && !!info && !info.locked && !ended;

  const source = useMemo<DrawingSource | null>(() => (route && info ? {
    id: `share:${route.id}:${editable ? 'rw' : 'ro'}`,
    editable,
    load: async () => doc.current.list(),
    save: (next) => { const ops = doc.current.diff(next); if (ops.length) outbox.current?.push(ops); },
    subscribe: (cb) => { drawingListeners.current.add(cb); return () => { drawingListeners.current.delete(cb); }; },
  } : null), [route?.id, !!info, editable]); // eslint-disable-line react-hooks/exhaustive-deps

  const cursorFeed = useMemo(() => ({
    subscribe: (cb: () => void) => { cursorListeners.current.add(cb); return () => { cursorListeners.current.delete(cb); }; },
    list: (): CursorInfo[] => [...cursors.current].flatMap(([id, at]) => { const peer = peersRef.current.find((p) => p.id === id); return peer ? [{ peer, at }] : []; }),
  }), []);

  const own = useCallback(async (patch: { title?: string; locked?: boolean; rotate?: 'view' | 'edit'; config?: ShareConfig }) => {
    if (!info) return;
    try { setInfo(await api.updateShare(info.id, patch)); }
    catch (e) { setNotice((e as Error).message); }
  }, [info, setNotice]);

  return {
    active: !!route, info, role, error, status, ended, editable, you, peers, presenter, presenterView, following, notice, source, cursors: cursorFeed,
    presenting: !!you && presenter === you.id,
    presenterPeer: peers.find((p) => p.id === presenter) ?? (you && presenter === you.id ? you : null),
    setFollowing: (on: boolean) => setFollowing(on && !!presenterRef.current && presenterRef.current !== youRef.current?.id),
    present: (on: boolean) => conn.current?.send({ type: 'present', on }),
    sendPresence: (cursor: Anchor | null, view?: PresenterView) => conn.current?.send({ type: 'presence', cursor, ...(view ? { view } : {}) }),
    rename: (title: string) => own({ title }),
    setLocked: (locked: boolean) => own({ locked }),
    rotate: (which: 'view' | 'edit') => own({ rotate: which }),
    saveView: (config: ShareConfig) => own({ config }).then(() => setNotice('Saved as the starting view for everyone who opens this chart.')),
    remove: async () => { if (!info) return false; try { await api.deleteShare(info.id); return true; } catch (e) { setNotice((e as Error).message); return false; } },
    copyToMine: async () => {
      if (!info || !route) return;
      try {
        const r = await api.copyShare(info.id, route.key);
        setNotice(r.copied ? `Copied ${r.copied} drawing${r.copied === 1 ? '' : 's'} to your ${r.symbol} chart${r.skipped ? ` (${r.skipped} skipped: your chart is full)` : ''}.` : r.skipped ? `Your ${r.symbol} chart is full (500 drawings).` : 'Nothing to copy yet.');
      } catch (e) { setNotice((e as Error).message); }
    },
  };
}

export type ShareSession = ReturnType<typeof useShare>;
