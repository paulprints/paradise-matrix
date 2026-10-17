import type { ReactNode } from 'react';
import { DRAWING_COLORS, type DrawingColor } from '@paradise/contract';
import type { Tool } from '../drawings/useDrawings.ts';

interface Props {
  tool: Tool;
  setTool: (t: Tool) => void;
  color: DrawingColor;
  setColor: (c: DrawingColor) => void;
  hasSelection: boolean;
  canExtend: boolean;
  extended: boolean;
  onExtend: () => void;
  onDelete: () => void;
  onClear: () => void;
  status: { label: string; warn?: boolean };
  count: number;
  /** Where "clear all" applies, for the confirmation. */
  scope: string;
}

// Small line icons drawn for this rail (24×24, stroke = currentColor).
const I = (d: ReactNode) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const ICONS: Record<Tool, ReactNode> = {
  cursor: I(<path d="M6 3l12 8-5.5 1.2L15 19l-2.4 1-2.6-6.6L6 17z" />),
  trend: I(<><path d="M5 18L19 6" /><circle cx="5" cy="18" r="1.8" /><circle cx="19" cy="6" r="1.8" /></>),
  hline: I(<><path d="M3 12h18" /><circle cx="12" cy="12" r="1.8" /></>),
  vline: I(<><path d="M12 3v18" /><circle cx="12" cy="12" r="1.8" /></>),
  rect: I(<rect x="5" y="7" width="14" height="10" rx="1" />),
  text: I(<><path d="M6 6h12M12 6v13" /></>),
  brush: I(<path d="M4 17c3 0 3-6 6-6s3 5 6 5 2-7 4-8" />),
};
const NAMES: Record<Tool, string> = {
  cursor: 'Select and move (Esc)', trend: 'Trend line', hline: 'Horizontal line', vline: 'Vertical line',
  rect: 'Rectangle', text: 'Text note', brush: 'Freehand',
};
const COLOR_VARS: Record<DrawingColor, string> = { paper: 'var(--paper)', ink: 'var(--ink)', seal: 'var(--seal)', alert: 'var(--alert)', sky: 'var(--sky)' };

export function ToolRail(p: Props) {
  return (
    <nav className="rail" aria-label="Drawing tools">
      <div className="rail-group" role="group" aria-label="Tools">
        {(Object.keys(ICONS) as Tool[]).map((t) => (
          <button key={t} className="rail-btn" aria-pressed={p.tool === t} title={NAMES[t]} aria-label={NAMES[t]} onClick={() => p.setTool(t)}>{ICONS[t]}</button>
        ))}
      </div>
      <div className="rail-group" role="group" aria-label="Colour">
        {DRAWING_COLORS.map((c) => (
          <button key={c} className="swatch-btn" aria-pressed={p.color === c} title={`Colour: ${c}`} aria-label={`Colour ${c}`} onClick={() => p.setColor(c)}>
            <i style={{ background: COLOR_VARS[c] }} />
          </button>
        ))}
      </div>
      <div className="rail-group" role="group" aria-label="Selection">
        {p.canExtend && (
          <button className="rail-btn" aria-pressed={p.extended} title="Extend line to the right" aria-label="Extend line to the right" onClick={p.onExtend}>
            {I(<><path d="M4 18L14 9" /><path d="M14 9l6-5" strokeDasharray="2 2.5" /></>)}
          </button>
        )}
        <button className="rail-btn" disabled={!p.hasSelection} title="Delete selected (Delete)" aria-label="Delete selected drawing" onClick={p.onDelete}>
          {I(<><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" /></>)}
        </button>
        <button className="rail-btn" disabled={!p.count} title="Clear all drawings on this symbol" aria-label="Clear all drawings" onClick={() => { if (confirm(`Remove all ${p.count} drawings ${p.scope}?`)) p.onClear(); }}>
          {I(<><path d="M4 4l16 16M20 4L4 20" /></>)}
        </button>
      </div>
      <span className={`rail-status ${p.status.warn ? 'warn' : 'muted'}`} role="status">{p.status.label}</span>
    </nav>
  );
}
