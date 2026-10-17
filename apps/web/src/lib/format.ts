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

const dtf = new Map<string, Intl.DateTimeFormat>();
function parts(t: number, tz: string): Record<string, string> {
  let f = dtf.get(tz);
  if (!f) dtf.set(tz, (f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })));
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(t * 1000))) o[p.type] = p.value;
  return o;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Bar label in the exchange's time zone, matching the server's labels. */
export function formatBarTime(t: number, tf: string, tz: string): string {
  const p = parts(t, tz);
  const date = `${p.year}-${p.month}-${p.day}`;
  if (tf === 'D') return date;
  if (tf === 'W') return `wk ${date}`;
  if (tf === 'M') return `${p.year}-${p.month}`;
  return `${date} ${p.hour}:${p.minute}`;
}

/** Axis tick labels, coarse to fine: 0 year, 1 month, 2 day, 3 time. */
export function formatTick(t: number, kind: number, tz: string): string {
  const p = parts(t, tz);
  if (kind === 0) return p.year!;
  if (kind === 1) return MONTHS[Number(p.month) - 1]!;
  if (kind === 2) return `${MONTHS[Number(p.month) - 1]} ${Number(p.day)}`;
  return `${p.hour}:${p.minute}`;
}

export const TF_NAMES: Record<string, string> = { M: 'Monthly', W: 'Weekly', D: 'Daily', '1H': '1 hour', '30m': '30 min', '15m': '15 min', '5m': '5 min', '1m': '1 min' };
