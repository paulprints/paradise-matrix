/** Canvas can't read CSS variables directly; resolve the design tokens once per theme change. */
export interface Palette {
  plate: string; plate2: string; rule: string; paper: string; paperDim: string;
  sage: string; ink: string; seal: string; alert: string; sky: string;
}

export function readPalette(el: Element = document.documentElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    plate: v('--plate', '#14211c'), plate2: v('--plate-2', '#1a2a24'), rule: v('--rule', '#2b3b34'),
    paper: v('--paper', '#e8e3d3'), paperDim: v('--paper-dim', '#b9b6a8'), sage: v('--sage', '#6f8178'),
    ink: v('--ink', '#86bba0'), seal: v('--seal', '#cda64b'), alert: v('--alert', '#e0896b'), sky: v('--sky', '#8fb3d9'),
  };
}

/** Drawing colour names → palette. */
export const drawingColor = (p: Palette, c: string) => ({ paper: p.paper, ink: p.ink, seal: p.seal, alert: p.alert, sky: p.sky } as Record<string, string>)[c] ?? p.paper;

export function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
