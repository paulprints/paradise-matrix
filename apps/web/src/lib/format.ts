/** Display-only formatting. Values stay unrounded everywhere else. */
export function decimalsForTick(tick: number): number {
  if (!(tick > 0)) return 2;
  for (let d = 0; d <= 8; d++) if (Math.abs(Math.round(tick * 10 ** d) - tick * 10 ** d) < 1e-9) return Math.max(d, 2);
  return 4;
}

export function formatPrice(price: number, tick: number): string {
  const d = decimalsForTick(tick);
  return price.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** 32nds for treasury futures would go here; decimal is the documented default. */
export function formatDelta(delta: number, tick: number): string {
  const s = formatPrice(Math.abs(delta), tick);
  return delta > 0 ? `+${s}` : delta < 0 ? `−${s}` : s;
}

export const TF_NAMES: Record<string, string> = { M: 'Monthly', W: 'Weekly', D: 'Daily', '1H': '1 hour', '30m': '30 min', '15m': '15 min', '5m': '5 min', '1m': '1 min' };
