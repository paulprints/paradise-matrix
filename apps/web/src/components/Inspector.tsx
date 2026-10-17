import type { Frame, Instrument } from '@paradise/contract';
import { VIRIDIS_GRADIENT, viridisCss, ZONES, type HeatRow, type HeatStyle } from '../lib/heat.ts';
import { formatPrice, TF_NAMES } from '../lib/format.ts';

/** What the inspector needs from either view (ladder or chart). */
export interface InspectorContext {
  instrument: Instrument;
  frames: Frame[];
  dataSource: string;
  engineVersion: string;
  warnings: string[];
}
export interface ResolvedLevel { tf: string; label: string; price: number; developing: boolean; sourceLabel: string }

interface Props { data: InspectorContext; resolve: (id: string) => ResolvedLevel | undefined; row: HeatRow | null; hint?: string; title?: string; heatStyle?: HeatStyle; onClose?: () => void }

function pivotText(f: Frame): string {
  const d = f.facts.pivotDirection;
  if (!d) return '—';
  if (d.sign === 0) return 'Flat';
  return `${d.sign > 0 ? 'Rising' : 'Falling'} ${d.bars} bar${d.bars === 1 ? '' : 's'}`;
}
function closesText(f: Frame): string {
  const c = f.facts.closesVsPivot;
  if (!c) return '—';
  return c.side === 'on' ? 'Closed on the pivot' : `${c.bars} close${c.bars === 1 ? '' : 's'} ${c.side}`;
}

export function Inspector({ data, resolve, row, hint, title = 'Read the ladder', heatStyle = 'matrix', onClose }: Props) {
  const tick = data.instrument.tick;
  return (
    <aside className="side" id="details-panel" aria-label="Details">
      {onClose && (
        <button className="side-close" onClick={onClose} aria-label="Hide details panel" title="Hide details (I)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      )}
      <section aria-live="polite">
        {row ? (
          <>
            <div className="band-head">
              <h2 className="num">{formatPrice(row.price, tick)}</h2>
              <span className="band-zone">{ZONES[row.zone].label}</span>
            </div>
            <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(row.intensity * 100)} aria-label="Confluence">
              <i style={{ width: `${Math.round(row.intensity * 100)}%`, ...(heatStyle === 'matrix' ? { background: viridisCss(row.intensity) } : {}) }} />
            </div>
            <p className="note">{ZONES[row.zone].meaning}</p>
            {row.contributors.length > 0 && (
              <ul className="contrib" style={{ marginTop: 10 }}>
                {row.contributors.slice(0, 10).map((c) => {
                  const l = resolve(c.id);
                  if (!l) return null;
                  return (
                    <li key={c.id}>
                      <span className="tf-tag">{l.tf}</span>
                      <span>{l.label}{l.developing ? ' (developing)' : ''}<br /><span className="muted">from {l.sourceLabel}</span></span>
                      <span className="num">{formatPrice(l.price, tick)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <>
            <h2>{title}</h2>
            <p className="note">{hint ?? 'Point at the ladder (or focus it and use the arrow keys) to see which levels build each band.'}</p>
          </>
        )}
      </section>

      <section>
        <h2>Frames</h2>
        {data.frames.map((f) => (
          <div className="frame" key={f.tf}>
            <h3>{TF_NAMES[f.tf]}</h3>
            {f.source ? (
              <>
                <div className="row"><span>Levels from</span><span>{f.source.label} close</span></div>
                <div className="row"><span>Drawn on</span><span>{f.display.label ?? 'next bar'}</span></div>
                {f.developingSource && <div className="row"><span>Developing from</span><span>{f.developingSource.label} (forming)</span></div>}
                <div className="row"><span>Price is</span><span>{f.facts.location?.label ?? '—'}</span></div>
                <div className="row"><span>Pivot</span><span>{pivotText(f)}</span></div>
                <div className="row"><span>Closes vs pivot</span><span>{closesText(f)}</span></div>
                <div className="row"><span>Avg range (14)</span><span className="num">{f.atr ? formatPrice(f.atr, tick) : '—'}</span></div>
              </>
            ) : <p className="warn">Not enough completed bars yet.</p>}
            {f.warnings.map((w) => <p className="warn" key={w}>{w}</p>)}
          </div>
        ))}
      </section>

      <section className="legend" aria-label="Legend">
        <h2>Key</h2>
        <div><svg className="swatch" width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="var(--paper)" /></svg>Confirmed level (completed bar)</div>
        <div><svg className="swatch" width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="var(--sage)" strokeDasharray="3 3" /></svg>Developing level (forming bar, provisional)</div>
        <div><svg className="swatch" width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="var(--ink)" strokeDasharray="1 3" strokeWidth="2" /></svg>Market Profile (value area, POC)</div>
        {heatStyle === 'matrix'
          ? <div><span className="swatch grad" style={{ background: VIRIDIS_GRADIENT }} />Heat: purple = little overlap, yellow = heaviest</div>
          : <div><svg className="swatch" width="22" height="8">{[3, 9, 15, 21].map((x, i) => <circle key={x} cx={x} cy="4" r={0.8 + i * 0.8} fill="var(--ink)" />)}</svg>Heat: denser ink = more levels overlap</div>}
        <div><svg className="swatch" width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="var(--seal)" strokeWidth="2" /></svg>Last price</div>
        <p className="note">Levels describe where price may react. They aren’t entry signals, and heat isn’t a reversal forecast.</p>
      </section>

      <section className="legend">
        <h2>Source</h2>
        <p className="note">
          {data.instrument.root}, {data.instrument.session}. Prices {data.instrument.adjustment === 'split' ? 'split-adjusted, not dividend-adjusted' : 'unadjusted'}.
          Data: {data.dataSource}. Engine {data.engineVersion}.
        </p>
        {data.warnings.map((w) => <p className="warn" key={w}>{w}</p>)}
      </section>
    </aside>
  );
}
