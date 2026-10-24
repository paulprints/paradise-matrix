import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@paradise/contract';
import { api, SESSION_EXPIRED, tokenStore } from './api.ts';
import { ChartView, type ChartHandles } from './chart/ChartView.tsx';
import { Inspector, type ResolvedLevel } from './components/Inspector.tsx';
import { Ladder } from './components/Ladder.tsx';
import { Members } from './components/Members.tsx';
import { SignIn } from './components/SignIn.tsx';
import { ToolRail } from './components/ToolRail.tsx';
import { ShareBar } from './components/ShareBar.tsx';
import { ShareMenu } from './components/ShareMenu.tsx';
import { TopBar } from './components/TopBar.tsx';
import { personalSource, useDrawings, type SaveStatus } from './drawings/useDrawings.ts';
import { formatBarTime } from './lib/format.ts';
import type { HeatRow } from './lib/heat.ts';
import { parseView, serializeView, type ViewState } from './lib/view.ts';
import { parseShareRoute, viewFromConfig } from './share/route.ts';
import { usePresence } from './share/usePresence.ts';
import { useShare } from './share/useShare.ts';
import { useChart } from './useChart.ts';
import { useLevels } from './useLevels.ts';

type Theme = 'plate' | 'paper';
const readTheme = (): Theme => { try { return localStorage.getItem('pp_theme') === 'paper' ? 'paper' : 'plate'; } catch { return 'plate'; } };
const readDetails = (): boolean => { try { return localStorage.getItem('pp_details') !== '0'; } catch { return true; } };
const SAVE_LABEL: Record<SaveStatus, { label: string; warn?: boolean }> = { idle: { label: '' }, saving: { label: 'Saving' }, saved: { label: 'Saved' }, error: { label: 'Not saved', warn: true } };
const LIVE_LABEL: Record<string, { label: string; warn?: boolean }> = { live: { label: 'Live' }, connecting: { label: 'Joining' }, offline: { label: 'Offline', warn: true }, ended: { label: 'Ended', warn: true } };

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(!!tokenStore.get());
  const [notice, setNotice] = useState<string | null>(null);
  const [page, setPage] = useState<'matrix' | 'members'>(location.hash === '#members' ? 'members' : 'matrix');
  const [view, setViewState] = useState<ViewState>(() => parseView(location.search));
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [row, setRow] = useState<HeatRow | null>(null);
  const [handles, setHandles] = useState<ChartHandles | null>(null);
  const [details, setDetails] = useState(readDetails);
  // A shared chart lives at /c/<id>; its settings come from the share, not the address bar.
  const route = useMemo(() => parseShareRoute(location.pathname), []);
  const share = useShare(route, !!user);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('pp_theme', theme); } catch { /* ignore */ }
  }, [theme]);
  useEffect(() => {
    if (!tokenStore.get()) return;
    api.me().then(setUser).catch(() => tokenStore.clear()).finally(() => setChecking(false));
  }, []);
  useEffect(() => { try { localStorage.setItem('pp_details', details ? '1' : '0'); } catch { /* ignore */ } }, [details]);
  // "I" shows or hides the details panel (not while typing).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'i' || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]')) return;
      setDetails((d) => !d);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    const onExpired = () => { setUser(null); setNotice('Your session ended. Sign in again to continue.'); };
    window.addEventListener(SESSION_EXPIRED, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED, onExpired);
  }, []);
  useEffect(() => { if (!route) history.replaceState(null, '', serializeView(view) + (page === 'members' ? '#members' : '')); }, [view, page, route]);
  useEffect(() => { if (share.info) setViewState((v) => ({ ...v, ...viewFromConfig(share.info!.config) })); }, [share.info?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (share.info) document.title = `${share.info.title} · Paradise Matrix`; }, [share.info?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  const setView = useCallback((patch: Partial<ViewState>) => { setRow(null); setViewState((v) => ({ ...v, ...patch })); }, []);
  // On a shared chart, wait for the share before loading anything (its symbol and settings).
  const onMatrix = !!user && page === 'matrix' && (!route || !!share.info);
  const ladder = useLevels(view, onMatrix && view.view === 'ladder');
  const chart = useChart(view, onMatrix && view.view === 'chart');
  const mySource = useMemo(() => personalSource(view.symbol), [view.symbol]);
  const draw = useDrawings(route ? share.source : mySource, handles, onMatrix && view.view === 'chart');
  usePresence(share, handles, chart.state, view, setView);
  if (import.meta.env.DEV) {
    // Debug probe for browser tests: what this tab holds (drawings, share session).
    (window as unknown as { __pmApp?: unknown }).__pmApp = { drawings: draw.drawings, editable: draw.editable, view, share: { status: share.status, role: share.role, peers: share.peers.map((p) => p.username), presenter: share.presenterPeer?.username ?? null, following: share.following, ended: share.ended, locked: share.info?.locked } };
  }
  const exitShare = useCallback(() => { location.assign('/' + serializeView({ ...view, view: 'chart' })); }, [view]);

  const ladderLevels = useMemo(() => {
    const d = ladder.data;
    if (!d) return [];
    return d.levels.filter((l) => l.state === 'active' && l.price !== null && view.groups.includes(l.group)
      && (l.group !== 'profile' || view.profile) && (l.basis === 'confirmed' || view.developing));
  }, [ladder.data, view.groups, view.profile, view.developing]);

  const resolveLadder = useCallback((id: string): ResolvedLevel | undefined => {
    const l = ladderLevels.find((x) => x.id === id);
    return l ? { tf: l.tf, label: l.label, price: l.price!, developing: l.basis === 'developing', sourceLabel: l.source.label } : undefined;
  }, [ladderLevels]);
  const segById = useMemo(() => new Map((chart.state?.segments ?? []).map((s) => [s.id, s])), [chart.state]);
  const resolveChart = useCallback((id: string): ResolvedLevel | undefined => {
    const s = segById.get(id);
    const tz = chart.state?.instrument.timezone ?? 'America/New_York';
    return s ? { tf: s.tf, label: s.key.label, price: s.price, developing: s.developing, sourceLabel: formatBarTime(s.source, s.tf, tz) } : undefined;
  }, [segById, chart.state]);

  const more = useRef(0);
  const onNeedMore = useCallback(() => {
    const st = chart.state;
    // Only ask when the server filled the last request (otherwise there is no older data) and not too often.
    if (!st || chart.loading || !chart.canLoadMore || st.bars.length < chart.history || Date.now() - more.current < 2000) return;
    more.current = Date.now();
    chart.loadMore();
  }, [chart]);

  if (checking) return null;
  if (!user) return <SignIn notice={notice} sharing={!!route} onSignedIn={(u) => { setNotice(null); setUser(u); }} />;
  if (page === 'members' && user.isAdmin) return <Members me={user} onBack={() => setPage('matrix')} />;
  if (route && share.denied) {
    const d = share.denied;
    return (
      <div className="signin">
        <div className="share-gone" role="status" aria-live="polite">
          {d.access === 'pending' ? (
            <>
              <span className="waiting-dot" aria-hidden="true" />
              <h2>Waiting for {d.owner}</h2>
              <p className="dim">You’ve asked to join “{d.title}”. This page opens the chart as soon as {d.owner} lets you in.</p>
            </>
          ) : (
            <>
              <h2>No access</h2>
              <p className="dim">{d.owner} removed your access to “{d.title}”. Ask them if you think that’s a mistake.</p>
            </>
          )}
          <a className="btn" href="/">Go to your charts</a>
        </div>
      </div>
    );
  }
  if (route && !share.info) {
    return (
      <div className="signin">
        {share.error ? (
          <div className="share-gone"><h2>Can’t open this chart</h2><p className="dim">{share.error}</p><a className="btn" href="/">Go to your charts</a></div>
        ) : <p className="dim">Opening shared chart…</p>}
      </div>
    );
  }

  const isChart = view.view === 'chart';
  const error = isChart ? chart.error : ladder.error;
  const loading = isChart ? chart.loading : ladder.loading;
  return (
    <div className="shell">
      <div>
        <TopBar
          view={view} setView={setView} anchors={ladder.data?.anchors ?? []} user={user} loading={loading}
          theme={theme} onTheme={() => setTheme(theme === 'plate' ? 'paper' : 'plate')}
          onAdmin={() => setPage('members')} onSignOut={() => { api.logout(); setUser(null); }}
          symbolLocked={!!route}
          share={route ? undefined : <ShareMenu view={view} drawings={view.view === 'chart' ? draw.drawings : []} />}
        />
        {route && <ShareBar share={share} view={view} onExit={exitShare} />}
        {error && <div className="banner error" role="alert">{error}{!isChart && <> <button className="btn quiet" onClick={ladder.refresh}>Try again</button></>}</div>}
        {!isChart && view.asOf && <div className="banner past">Looking back: levels as they stood at that close. Developing levels are off.</div>}
      </div>
      {isChart ? (
        chart.state ? (
          <div className={`main ${draw.editable ? 'with-rail' : ''} ${details ? '' : 'no-side'}`}>
            {draw.editable && <ToolRail
              tool={draw.tool} setTool={draw.setTool} color={draw.color} setColor={draw.setColor}
              hasSelection={!!draw.selected} canExtend={draw.selectedDrawing?.kind === 'trend'}
              extended={draw.selectedDrawing?.kind === 'trend' && draw.selectedDrawing.extend}
              onExtend={draw.toggleExtend} onDelete={draw.removeSelected} onClear={draw.clearAll}
              status={route ? LIVE_LABEL[share.status]! : SAVE_LABEL[draw.status]} count={draw.drawings.length}
              scope={route ? 'on this shared chart, for everyone' : `on ${view.symbol}`}
            />}
            <div className="chart-wrap">
              <ChartView state={chart.state} groups={view.groups} heat={view.heat} heatStyle={view.heatStyle} theme={theme} onInspect={setRow} onNeedMore={onNeedMore} onReady={setHandles} />
              {draw.textPrompt && (
                <input
                  className="text-prompt" style={{ left: draw.textPrompt.x, top: draw.textPrompt.y - 14 }} autoFocus maxLength={200}
                  placeholder="Type a note, Enter to place" aria-label="Note text"
                  onKeyDown={(e) => { if (e.key === 'Enter') draw.submitText(e.currentTarget.value); if (e.key === 'Escape') draw.cancelText(); }}
                  onBlur={(e) => draw.submitText(e.currentTarget.value)}
                />
              )}
            </div>
            {details ? <Inspector data={chart.state} resolve={resolveChart} heatStyle={view.heatStyle} row={row} title="Read the chart" hint="Point at the chart to see which levels build the heat at that price and time." onClose={() => setDetails(false)} /> : <button className="side-tab" onClick={() => setDetails(true)} aria-controls="details-panel" aria-expanded={false} title="Show details (I)"><span>Details</span></button>}
          </div>
        ) : <div className="signin"><p className="dim">{error ? 'Nothing to show yet.' : `Loading ${view.symbol}…`}</p></div>
      ) : ladder.data ? (
        <div className={`main ${details ? '' : 'no-side'}`}>
          <Ladder data={ladder.data} levels={ladderLevels} heat={view.heat} heatStyle={view.heatStyle} zoom={view.zoom} onZoom={(zoom) => setView({ zoom })} onInspect={setRow} />
          {details ? <Inspector data={ladder.data} resolve={resolveLadder} heatStyle={view.heatStyle} row={row} onClose={() => setDetails(false)} /> : <button className="side-tab" onClick={() => setDetails(true)} aria-controls="details-panel" aria-expanded={false} title="Show details (I)"><span>Details</span></button>}
        </div>
      ) : (
        <div className="signin"><p className="dim">{error ? 'Nothing to show yet.' : `Loading ${view.symbol}…`}</p></div>
      )}
    </div>
  );
}
