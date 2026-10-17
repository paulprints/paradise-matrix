import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TIMEFRAMES, type BarRef, type LevelGroup, type Timeframe, type User } from '@paradise/contract';
import type { ViewState } from '../lib/view.ts';

interface Props {
  view: ViewState;
  setView: (patch: Partial<ViewState>) => void;
  anchors: Array<BarRef & { end: string }>;
  user: User;
  theme: 'plate' | 'paper';
  onTheme: () => void;
  onAdmin: () => void;
  onSignOut: () => void;
  loading: boolean;
}

const GROUP_LABELS: Record<LevelGroup, string> = {
  structure: 'Structure (pivot, bands, zones, channel)',
  range: 'Bar range (high, mid, low)',
  termination: 'Termination lines',
  profile: 'Market Profile',
};

function Popover({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <div className="pop" ref={ref}>
      <button className="btn quiet" aria-expanded={open} onClick={() => setOpen(!open)}>{label}</button>
      {open && <div className={`pop-panel ${wide ? 'help-panel' : ''}`} role="dialog" aria-label={label}>{children}</div>}
    </div>
  );
}

export function TopBar({ view, setView, anchors, user, theme, onTheme, onAdmin, onSignOut, loading }: Props) {
  const [symbol, setSymbol] = useState(view.symbol);
  useEffect(() => setSymbol(view.symbol), [view.symbol]);

  const toggleTf = (tf: Timeframe) => {
    const has = view.timeframes.includes(tf);
    if (has && view.timeframes.length === 1) return;
    const next = has ? view.timeframes.filter((t) => t !== tf) : TIMEFRAMES.filter((t) => t === tf || view.timeframes.includes(t));
    setView({ timeframes: next, asOf: null });
  };

  // Lookback: index into anchors (0 = most recent completed bar). Live sits before it.
  const idx = view.asOf ? anchors.findIndex((a) => a.end === view.asOf) : -1;
  const stamp = view.asOf ? (anchors[idx]?.label ?? new Date(view.asOf).toLocaleString()) : null;
  const goto = (i: number) => setView({ asOf: i < 0 ? null : anchors[Math.min(i, anchors.length - 1)]?.end ?? null });

  return (
    <header className="topbar">
      <div className="wordmark">Paradise<span>Matrix</span></div>
      <form className="field" onSubmit={(e) => { e.preventDefault(); if (symbol.trim()) setView({ symbol: symbol.trim().toUpperCase(), asOf: null }); }}>
        <label htmlFor="sym" className="sr-only">Symbol</label>
        <input id="sym" value={symbol} onChange={(e) => setSymbol(e.target.value)} spellCheck={false} autoComplete="off" placeholder="QQQ, NQ, ES…" />
        <button className="btn quiet" type="submit" style={{ padding: '2px 6px' }}>Load</button>
      </form>
      <div className="seg" role="group" aria-label="View">
        <button aria-pressed={view.view === 'chart'} onClick={() => setView({ view: 'chart' })}>Chart</button>
        <button aria-pressed={view.view === 'ladder'} onClick={() => setView({ view: 'ladder' })}>Ladder</button>
      </div>
      {view.view === 'chart' && (
        <label className="field compact">
          <span className="muted">Candles</span>
          <select value={view.chartTf} onChange={(e) => setView({ chartTf: e.target.value as Timeframe })} aria-label="Candle timeframe">
            {[...TIMEFRAMES].reverse().map((tf) => <option key={tf} value={tf}>{tf}</option>)}
          </select>
        </label>
      )}
      <div className="levels-tf">
        <span className="muted">Levels</span>
        <div className="seg" role="group" aria-label="Level timeframes (choose one or stack several)">
          {TIMEFRAMES.map((tf) => (
            <button key={tf} aria-pressed={view.timeframes.includes(tf)} onClick={() => toggleTf(tf)}>{tf}</button>
          ))}
        </div>
      </div>
      {view.view === 'ladder' && <div className="asof" role="group" aria-label="Look back">
        <button className="btn quiet" onClick={() => goto(idx + 1)} disabled={!anchors.length || idx >= anchors.length - 1} aria-label="One bar back">‹</button>
        <input
          type="range" min={-1} max={Math.max(0, anchors.length - 1)} value={idx} aria-label="Bars back"
          onChange={(e) => goto(Number(e.target.value))} disabled={!anchors.length}
        />
        <button className="btn quiet" onClick={() => goto(idx - 1)} disabled={idx < 0} aria-label="One bar forward">›</button>
        <span className={`stamp ${stamp ? 'past' : ''}`}>{stamp ? `As of ${stamp} close` : loading ? 'Live, updating' : 'Live'}</span>
        {stamp && <button className="btn quiet" onClick={() => goto(-1)}>Back to live</button>}
      </div>}
      {view.view === 'chart' && <span className="stamp muted">{loading ? 'Live, updating' : 'Live'}</span>}
      <div className="spacer" />
      <Popover label="Options">
        <h4>Show</h4>
        {(Object.keys(GROUP_LABELS) as LevelGroup[]).filter((g) => g !== 'profile').map((g) => (
          <label key={g} className="toggle">
            <input type="checkbox" checked={view.groups.includes(g)} onChange={(e) => setView({ groups: e.target.checked ? [...view.groups, g] : view.groups.filter((x) => x !== g) })} />
            {GROUP_LABELS[g]}
          </label>
        ))}
        <label className="toggle"><input type="checkbox" checked={view.profile} onChange={(e) => setView({ profile: e.target.checked })} />Market Profile (D/W/M)</label>
        <label className="toggle"><input type="checkbox" checked={view.developing} onChange={(e) => setView({ developing: e.target.checked })} disabled={!!view.asOf} />Developing levels (live only)</label>
        <label className="toggle"><input type="checkbox" checked={view.heat} onChange={(e) => setView({ heat: e.target.checked })} />Heat</label>
        <h4>Displacement</h4>
        <div className="seg" role="group" aria-label="Displacement">
          <button aria-pressed={view.displacement === 1} onClick={() => setView({ displacement: 1 })}>+1 normal</button>
          <button aria-pressed={view.displacement === 0} onClick={() => setView({ displacement: 0 })}>0</button>
        </div>
        <p className="note">+1 draws each bar’s levels on the next bar. The arithmetic is identical either way.</p>
      </Popover>
      <Popover label="Help" wide>
        <p><strong>Chart.</strong> Candles over the heat. Every level is drawn across exactly the bars it applied to, so when a 15m bar closes a new 15m level starts and the old one stays where it was. Thicker lines are higher timeframes. Scroll left for more history.</p>
        <p><strong>Drawing.</strong> Pick a tool on the left, then click (or drag) on the chart. Select a drawing to move it, recolour it or delete it. Drawings are saved to your account for each symbol.</p>
        <p><strong>Ladder.</strong> Each rule is one level, labelled with its timeframe and price. Gold is the last price.</p>
        <p><strong>Confirmed vs developing.</strong> Confirmed levels come from the last completed bar and don’t move during the session. Developing levels recalculate from the bar still forming.</p>
        <p><strong>Heat.</strong> Ink density shows how many levels overlap, weighted by timeframe (M 3, W 2, D 1). The scale is fixed by the frames you show (three overlapping levels of the heaviest frame fill it), so a quiet market looks quiet. Point at a band to see exactly which levels build it.</p>
        <p><strong>Timeframes.</strong> Pick one, or stack several to see higher-timeframe levels together.</p>
        <p><strong>Look back.</strong> Step to an earlier completed bar to see the levels as they stood at that close. Nothing after that moment is used.</p>
        <p><strong>Share.</strong> The address bar holds your view; copy it to share exactly what you see.</p>
      </Popover>
      <Popover label={user.username}>
        <p className="note">Signed in as {user.username}{user.isAdmin ? ' (admin)' : ''}.</p>
        <button className="btn" onClick={onTheme}>{theme === 'plate' ? 'Use light theme' : 'Use dark theme'}</button>
        {user.isAdmin && <button className="btn" onClick={onAdmin}>Manage members</button>}
        <button className="btn" onClick={onSignOut}>Sign out</button>
      </Popover>
    </header>
  );
}
