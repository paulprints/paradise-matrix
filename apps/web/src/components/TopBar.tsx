import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TIMEFRAMES, type BarRef, type LevelGroup, type Timeframe, type User } from '@paradise/contract';
import type { ViewState } from '../lib/view.ts';
import { TPO_BLOCKS } from '@paradise/contract';
import type { TpoSettings } from '../lib/tpo.ts';
import { CANDLE_PARTS, candleColors, type CandleColors } from '../lib/candles.ts';
import { readPalette } from '../chart/theme.ts';

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
  /** On a shared chart the instrument is fixed. */
  symbolLocked?: boolean;
  /** Extra controls before the account menu (the Share menu). */
  share?: ReactNode;
  tpo: TpoSettings;
  candles: CandleColors;
  setCandles: (c: CandleColors) => void;
  setTpo: (patch: Partial<TpoSettings>) => void;
}

const GROUP_LABELS: Record<LevelGroup, string> = {
  structure: 'Structure (pivot, bands, zones, channel)',
  range: 'Bar range (high, mid, low)',
  termination: 'Termination lines',
  profile: 'Market Profile',
};

export function Popover({ label, children, wide, onOpen, className }: { label: ReactNode; children: ReactNode | ((close: () => void) => ReactNode); wide?: boolean; onOpen?: () => void; className?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open) onOpen?.(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
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
      <button className={`btn quiet ${className ?? ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>{label}</button>
      {open && <div className={`pop-panel ${wide ? 'help-panel' : ''}`} role="dialog" aria-label={typeof label === 'string' ? label : undefined}>{typeof children === 'function' ? children(() => setOpen(false)) : children}</div>}
    </div>
  );
}

export function TopBar({ view, setView, anchors, user, theme, onTheme, onAdmin, onSignOut, loading, symbolLocked, share, tpo, setTpo, candles, setCandles }: Props) {
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
      <form className="field" onSubmit={(e) => { e.preventDefault(); if (!symbolLocked && symbol.trim()) setView({ symbol: symbol.trim().toUpperCase(), asOf: null }); }}>
        <label htmlFor="sym" className="sr-only">Symbol</label>
        <input id="sym" value={symbol} onChange={(e) => setSymbol(e.target.value)} spellCheck={false} autoComplete="off" placeholder="QQQ, NQ, ES…" readOnly={symbolLocked} title={symbolLocked ? 'A shared chart is about one instrument' : undefined} />
        {!symbolLocked && <button className="btn quiet" type="submit" style={{ padding: '2px 6px' }}>Load</button>}
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
      {share}
      <Popover label="Options">
        <h4>Show</h4>
        {(Object.keys(GROUP_LABELS) as LevelGroup[]).filter((g) => g !== 'profile').map((g) => (
          <label key={g} className="toggle">
            <input type="checkbox" checked={view.groups.includes(g)} onChange={(e) => setView({ groups: e.target.checked ? [...view.groups, g] : view.groups.filter((x) => x !== g) })} />
            {GROUP_LABELS[g]}
          </label>
        ))}
        <label className="toggle"><input type="checkbox" checked={view.developing} onChange={(e) => setView({ developing: e.target.checked })} disabled={!!view.asOf} />Developing levels (live only)</label>
        <h4>Heat</h4>
        <div className="seg" role="group" aria-label="Heat">
          <button aria-pressed={!view.heat} onClick={() => setView({ heat: false })}>Off</button>
          <button aria-pressed={view.heat && view.heatStyle === 'matrix'} onClick={() => setView({ heat: true, heatStyle: 'matrix' })}>Matrix</button>
          <button aria-pressed={view.heat && view.heatStyle === 'halftone'} onClick={() => setView({ heat: true, heatStyle: 'halftone' })}>Halftone</button>
        </div>
        <h4>Displacement</h4>
        <div className="seg" role="group" aria-label="Displacement">
          <button aria-pressed={view.displacement === 1} onClick={() => setView({ displacement: 1 })}>+1 forward</button>
          <button aria-pressed={view.displacement === 0} onClick={() => setView({ displacement: 0 })}>0 same bar</button>
        </div>
        {view.view === 'chart' && <CandleColorsPicker key={theme} candles={candles} setCandles={setCandles} />}
      </Popover>
      {view.view === 'chart' && <TpoMenu on={view.tpo} setOn={(on) => setView({ tpo: on })} s={tpo} set={setTpo} />}
      <Popover label={user.username}>
        <p className="note">Signed in as {user.username}{user.isAdmin ? ' (admin)' : ''}.</p>
        <button className="btn" onClick={onTheme}>{theme === 'plate' ? 'Use light theme' : 'Use dark theme'}</button>
        {user.isAdmin && <button className="btn" onClick={onAdmin}>Manage members</button>}
        <button className="btn" onClick={onSignOut}>Sign out</button>
      </Popover>
    </header>
  );
}

const IB_MINUTES = Array.from({ length: 16 }, (_, i) => (i + 1) * 15);

function TpoMenu({ on, setOn, s, set }: { on: boolean; setOn: (on: boolean) => void; s: TpoSettings; set: (patch: Partial<TpoSettings>) => void }) {
  const seg = <T extends string>(label: string, value: T, options: Array<[T, string]>, pick: (v: T) => void) => (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => <button key={v} aria-pressed={value === v} onClick={() => pick(v)}>{text}</button>)}
    </div>
  );
  const num = (label: string, value: number, min: number, max: number, pick: (v: number) => void) => (
    <label className="field compact">
      <span className="muted">{label}</span>
      <input type="number" min={min} max={max} step={1} value={value} aria-label={label} style={{ width: 60 }}
        onChange={(e) => { const v = Math.round(Number(e.target.value)); if (v >= min && v <= max) pick(v); }} />
    </label>
  );
  const check = (key: keyof TpoSettings, text: string) => (
    <label className="toggle"><input type="checkbox" checked={!!s[key]} onChange={(e) => set({ [key]: e.target.checked })} />{text}</label>
  );
  return (
    <Popover label={on ? 'TPO ●' : 'TPO'}>
      <label className="toggle"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />Show TPO profiles</label>
      <h4>Profile</h4>
      {seg('Session', s.session, [['D', 'Daily'], ['W', 'Weekly'], ['M', 'Monthly']], (session) => set({ session }))}
      <p className="note">Each letter covers</p>
      {seg('Block size', s.block, TPO_BLOCKS.map((b) => [b, b] as [typeof b, string]), (block) => set({ block }))}
      <label className="field compact">
        <span className="muted">Row height (ticks)</span>
        <input type="number" min={1} step={1} value={s.rowTicks ?? ''} placeholder="Auto" aria-label="Row height in ticks, empty for automatic"
          onChange={(e) => { const v = Math.floor(Number(e.target.value)); set({ rowTicks: e.target.value === '' || !(v >= 1) ? null : v }); }} style={{ width: 70 }} />
      </label>
      <label className="field compact">
        <span className="muted">Value area %</span>
        <input type="number" min={50} max={95} step={5} value={s.valueArea} aria-label="Value area percent"
          onChange={(e) => { const v = Math.round(Number(e.target.value)); if (v >= 50 && v <= 95) set({ valueArea: v }); }} style={{ width: 60 }} />
      </label>
      {seg('Value area method', s.vaMethod, [['two', 'Two rows'], ['one', 'One row']], (vaMethod) => set({ vaMethod }))}
      <label className="field compact">
        <span className="muted">Initial balance</span>
        <select value={s.ibMinutes} onChange={(e) => set({ ibMinutes: Number(e.target.value) })} aria-label="Initial balance minutes">
          {IB_MINUTES.map((m) => <option key={m} value={m}>{m} min</option>)}
        </select>
      </label>
      <h4>Cells</h4>
      {seg('Block display', s.display, [['blocks+letters', 'Blocks + letters'], ['letters', 'Letters'], ['blocks', 'Blocks']], (display) => set({ display }))}
      {seg('Outside value area', s.outsideVaFlat ? 'flat' : 'fade', [['flat', 'Grey outside VA'], ['fade', 'Faded outside VA']], (v) => set({ outsideVaFlat: v === 'flat' }))}
      <h4>Show</h4>
      {check('poc', 'Point of control (POC)')}
      {check('va', 'Value area high / low')}
      {check('fillVa', 'Fill value area')}
      {check('ibRange', 'Initial balance range')}
      {check('singles', 'Single prints')}
      {check('poorExtremes', 'Poor highs / lows')}
      {check('nakedPoc', 'Naked POC')}
      {check('nakedVa', 'Naked VAH / VAL')}
      {check('labels', 'Labels')}
      {check('hideCandles', 'Hide candles')}
      {check('midpoint', 'Midpoint')}
      <p className="note">Lines end at</p>
      {seg('Extend lines', s.extend, [['profile', 'Profile'], ['period', 'Period end'], ['right', 'Right edge']], (extend) => set({ extend }))}
      {num('Max naked levels (0 = all)', s.maxNaked, 0, 500, (maxNaked) => set({ maxNaked }))}
      {num('Profile spacing (px)', s.spacing, 0, 40, (spacing) => set({ spacing }))}
      <h4>Developing and prior</h4>
      {check('devPoc', 'Developing POC')}
      {check('devVa', 'Developing value area')}
      {check('devAll', 'Developing on every profile')}
      {check('prior', 'Prior-session levels (pPOC, pVAH, pVAL, pHi, pLo)')}
      {check('priorEvery', 'Prior levels on every profile')}
      <h4>Initial balance</h4>
      {check('ibLines', 'IB high / low lines')}
      <p className="note">Extensions, % of the IB range (0 = off)</p>
      <div className="row">{s.ibExt.map((v, i) => <input key={i} type="number" min={0} max={1000} step={25} value={v} aria-label={`IB extension ${i + 1} percent`} style={{ width: 58 }}
        onChange={(e) => { const x = Math.round(Number(e.target.value) / 25) * 25; if (x >= 0 && x <= 1000) { const ibExt = [...s.ibExt] as TpoSettings['ibExt']; ibExt[i] = x; set({ ibExt }); } }} />)}</div>
      {num('Opening range (first N letters, 0 = off)', s.openingRange, 0, 52, (openingRange) => set({ openingRange }))}
      {num('Closing range (last N letters, 0 = off)', s.closingRange, 0, 52, (closingRange) => set({ closingRange }))}
      <h4>Peaks and valleys</h4>
      {seg('Peaks and valleys', s.peaksValleys, [['off', 'Off'], ['both', 'Both'], ['peaks', 'Peaks'], ['valleys', 'Valleys']], (peaksValleys) => set({ peaksValleys }))}
      {s.peaksValleys !== 'off' && num('Sensitivity (rows each side)', s.pvSensitivity, 1, 20, (pvSensitivity) => set({ pvSensitivity }))}
      <h4>Colour</h4>
      {check('sessionColors', 'Colour each session differently')}
      {check('highlightEnds', 'Highlight first and last letter')}
      {check('customColors', 'Custom early → late colours')}
      {s.customColors && <div className="row">{s.colors.map((c, i) => <input key={i} type="color" value={c} aria-label={`Colour ${i + 1} (${['earliest', 'second', 'third', 'latest'][i]})`}
        onChange={(e) => { const colors = [...s.colors] as TpoSettings['colors']; colors[i] = e.target.value; set({ colors }); }} />)}</div>}
      <h4>Hover</h4>
      {check('hover', 'Show hover inspector')}
      {s.hover && check('hoverStats', 'Profile statistics on hover')}
    </Popover>
  );
}

/** Body, border and wick colours for up and down candles; unset parts follow the theme. */
function CandleColorsPicker({ candles, setCandles }: { candles: CandleColors; setCandles: (c: CandleColors) => void }) {
  const shown = candleColors(readPalette(), candles);
  return (
    <>
      <h4>Candles</h4>
      <div className="candle-grid">
        <span /><span className="muted">Up</span><span className="muted">Down</span>
        {CANDLE_PARTS.map(([name, up, down]) => (
          <div className="candle-row" key={name}>
            <span>{name}</span>
            <input type="color" value={shown[up]} aria-label={`${name}, up candles`} onChange={(e) => setCandles({ ...candles, [up]: e.target.value })} />
            <input type="color" value={shown[down]} aria-label={`${name}, down candles`} onChange={(e) => setCandles({ ...candles, [down]: e.target.value })} />
          </div>
        ))}
      </div>
      {Object.keys(candles).length > 0 && <button className="btn quiet" onClick={() => setCandles({})}>Reset to theme</button>}
    </>
  );
}
