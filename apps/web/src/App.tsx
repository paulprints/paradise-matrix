import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@paradise/contract';
import { api, SESSION_EXPIRED, tokenStore } from './api.ts';
import { ChartView, type ChartHandles } from './chart/ChartView.tsx';
import { Inspector, type ResolvedLevel } from './components/Inspector.tsx';
import { Ladder } from './components/Ladder.tsx';
import { Members } from './components/Members.tsx';
import { SignIn } from './components/SignIn.tsx';
import { ToolRail } from './components/ToolRail.tsx';
import { TopBar } from './components/TopBar.tsx';
import { useDrawings } from './drawings/useDrawings.ts';
import { formatBarTime } from './lib/format.ts';
import type { HeatRow } from './lib/heat.ts';
import { parseView, serializeView, type ViewState } from './lib/view.ts';
import { useChart } from './useChart.ts';
import { useLevels } from './useLevels.ts';

type Theme = 'plate' | 'paper';
const readTheme = (): Theme => { try { return localStorage.getItem('pp_theme') === 'paper' ? 'paper' : 'plate'; } catch { return 'plate'; } };

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(!!tokenStore.get());
  const [notice, setNotice] = useState<string | null>(null);
  const [page, setPage] = useState<'matrix' | 'members'>(location.hash === '#members' ? 'members' : 'matrix');
  const [view, setViewState] = useState<ViewState>(() => parseView(location.search));
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [row, setRow] = useState<HeatRow | null>(null);
  const [handles, setHandles] = useState<ChartHandles | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('pp_theme', theme); } catch { /* ignore */ }
  }, [theme]);
  useEffect(() => {
    if (!tokenStore.get()) return;
    api.me().then(setUser).catch(() => tokenStore.clear()).finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    const onExpired = () => { setUser(null); setNotice('Your session ended. Sign in again to continue.'); };
    window.addEventListener(SESSION_EXPIRED, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED, onExpired);
  }, []);
  useEffect(() => { history.replaceState(null, '', serializeView(view) + (page === 'members' ? '#members' : '')); }, [view, page]);

  const setView = useCallback((patch: Partial<ViewState>) => { setRow(null); setViewState((v) => ({ ...v, ...patch })); }, []);
  const onMatrix = !!user && page === 'matrix';
  const ladder = useLevels(view, onMatrix && view.view === 'ladder');
  const chart = useChart(view, onMatrix && view.view === 'chart');
  const draw = useDrawings(view.symbol, handles, onMatrix && view.view === 'chart');

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
  if (!user) return <SignIn notice={notice} onSignedIn={(u) => { setNotice(null); setUser(u); }} />;
  if (page === 'members' && user.isAdmin) return <Members me={user} onBack={() => setPage('matrix')} />;

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
        />
        {error && <div className="banner error" role="alert">{error}{!isChart && <> <button className="btn quiet" onClick={ladder.refresh}>Try again</button></>}</div>}
        {!isChart && view.asOf && <div className="banner past">Looking back: levels as they stood at that close. Developing levels are off.</div>}
      </div>
      {isChart ? (
        chart.state ? (
          <div className="main with-rail">
            <ToolRail
              tool={draw.tool} setTool={draw.setTool} color={draw.color} setColor={draw.setColor}
              hasSelection={!!draw.selected} canExtend={draw.selectedDrawing?.kind === 'trend'}
              extended={draw.selectedDrawing?.kind === 'trend' && draw.selectedDrawing.extend}
              onExtend={draw.toggleExtend} onDelete={draw.removeSelected} onClear={draw.clearAll}
              status={draw.status} count={draw.drawings.length}
            />
            <div className="chart-wrap">
              <ChartView state={chart.state} groups={view.groups} heat={view.heat} theme={theme} onInspect={setRow} onNeedMore={onNeedMore} onReady={setHandles} />
              {draw.textPrompt && (
                <input
                  className="text-prompt" style={{ left: draw.textPrompt.x, top: draw.textPrompt.y - 14 }} autoFocus maxLength={200}
                  placeholder="Type a note, Enter to place" aria-label="Note text"
                  onKeyDown={(e) => { if (e.key === 'Enter') draw.submitText(e.currentTarget.value); if (e.key === 'Escape') draw.cancelText(); }}
                  onBlur={(e) => draw.submitText(e.currentTarget.value)}
                />
              )}
            </div>
            <Inspector data={chart.state} resolve={resolveChart} row={row} title="Read the chart" hint="Point at the chart to see which levels build the heat at that price and time." />
          </div>
        ) : <div className="signin"><p className="dim">{error ? 'Nothing to show yet.' : `Loading ${view.symbol}…`}</p></div>
      ) : ladder.data ? (
        <div className="main">
          <Ladder data={ladder.data} levels={ladderLevels} heat={view.heat} zoom={view.zoom} onZoom={(zoom) => setView({ zoom })} onInspect={setRow} />
          <Inspector data={ladder.data} resolve={resolveLadder} row={row} />
        </div>
      ) : (
        <div className="signin"><p className="dim">{error ? 'Nothing to show yet.' : `Loading ${view.symbol}…`}</p></div>
      )}
    </div>
  );
}
