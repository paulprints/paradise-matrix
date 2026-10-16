/** Time-zone helpers built on Intl (no dependencies). All instants are unix seconds. */

export interface LocalParts {
  y: number; m: number; d: number; h: number; mi: number; s: number;
  /** 0 = Sunday … 6 = Saturday */
  wd: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(sec: number, tz: string): LocalParts {
  const out: Record<string, string> = {};
  for (const p of fmt(tz).formatToParts(new Date(sec * 1000))) out[p.type] = p.value;
  return { y: +out.year!, m: +out.month!, d: +out.day!, h: +out.hour!, mi: +out.minute!, s: +out.second!, wd: WD[out.weekday!]! };
}

/** Offset (seconds) of tz from UTC at the given instant. */
function offsetAt(sec: number, tz: string): number {
  const p = localParts(sec, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) / 1000 - sec;
}

/** Instant of a wall-clock time in tz. */
export function zonedToUnix(ymd: string, hh: number, mm: number, tz: string): number {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm) / 1000;
  let t = guess - offsetAt(guess, tz);
  const t2 = guess - offsetAt(t, tz); // second pass handles DST edges
  if (t2 !== t) t = t2;
  return t;
}

export const pad = (n: number) => String(n).padStart(2, '0');
export const ymdOf = (p: Pick<LocalParts, 'y' | 'm' | 'd'>) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;
export const localYmd = (sec: number, tz: string) => ymdOf(localParts(sec, tz));

/** Calendar arithmetic on YYYY-MM-DD strings (zone-free). */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export const iso = (sec: number) => new Date(sec * 1000).toISOString();
