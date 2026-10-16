import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@paradise/contract';
import { api, SESSION_EXPIRED, tokenStore } from './api.ts';
import { Inspector } from './components/Inspector.tsx';
import { Ladder } from './components/Ladder.tsx';
import { Members } from './components/Members.tsx';
import { SignIn } from './components/SignIn.tsx';
import { TopBar } from './components/TopBar.tsx';
import type { HeatRow } from './lib/heat.ts';
import { parseView, serializeView, type ViewState } from './lib/view.ts';
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

  const setView = useCallback((patch: Partial<ViewState>) => setViewState((v) => ({ ...v, ...patch })), []);
  const { data, error, loading, refresh } = useLevels(view, !!user && page === 'matrix');

  const visible = useMemo(() => {
    if (!data) return [];
    return data.levels.filter((l) => l.state === 'active' && l.price !== null && view.groups.includes(l.group)
      && (l.group !== 'profile' || view.profile) && (l.basis === 'confirmed' || view.developing));
  }, [data, view.groups, view.profile, view.developing]);

  if (checking) return null;
  if (!user) return <SignIn notice={notice} onSignedIn={(u) => { setNotice(null); setUser(u); }} />;
  if (page === 'members' && user.isAdmin) return <Members me={user} onBack={() => setPage('matrix')} />;

  return (
    <div className="shell">
      <div>
        <TopBar
          view={view} setView={setView} anchors={data?.anchors ?? []} user={user} loading={loading}
          theme={theme} onTheme={() => setTheme(theme === 'plate' ? 'paper' : 'plate')}
          onAdmin={() => setPage('members')} onSignOut={() => { api.logout(); setUser(null); }}
        />
        {error && <div className="banner error" role="alert">{error} <button className="btn quiet" onClick={refresh}>Try again</button></div>}
        {view.asOf && <div className="banner past">Looking back: levels as they stood at that close. Developing levels are off.</div>}
      </div>
      {data ? (
        <div className="main">
          <Ladder data={data} levels={visible} heat={view.heat} zoom={view.zoom} onZoom={(zoom) => setView({ zoom })} onInspect={setRow} />
          <Inspector data={data} levels={visible} row={row} />
        </div>
      ) : (
        <div className="signin"><p className="dim">{error ? 'Nothing to show yet.' : `Loading ${view.symbol}…`}</p></div>
      )}
    </div>
  );
}
