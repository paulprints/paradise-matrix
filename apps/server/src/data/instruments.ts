/**
 * Instrument resolution. One table replaces the old frontend regex guessing:
 * tick sizes, calendar and provider symbol all come from here.
 */
import type { Instrument } from '@paradise/contract';
import { CME_EQUITY, XNYS, type ExchangeCalendar } from './calendar.ts';

interface FutureSpec { tick: number; name: string; exchange: string; equityIndex?: boolean }

/** CME Group tick sizes (minimum price fluctuation, outright). */
export const FUTURES: Record<string, FutureSpec> = {
  ES: { tick: 0.25, name: 'E-mini S&P 500', exchange: 'CME', equityIndex: true },
  MES: { tick: 0.25, name: 'Micro E-mini S&P 500', exchange: 'CME', equityIndex: true },
  NQ: { tick: 0.25, name: 'E-mini Nasdaq-100', exchange: 'CME', equityIndex: true },
  MNQ: { tick: 0.25, name: 'Micro E-mini Nasdaq-100', exchange: 'CME', equityIndex: true },
  YM: { tick: 1, name: 'E-mini Dow', exchange: 'CBT', equityIndex: true },
  MYM: { tick: 1, name: 'Micro E-mini Dow', exchange: 'CBT', equityIndex: true },
  RTY: { tick: 0.1, name: 'E-mini Russell 2000', exchange: 'CME', equityIndex: true },
  M2K: { tick: 0.1, name: 'Micro E-mini Russell 2000', exchange: 'CME', equityIndex: true },
  GC: { tick: 0.1, name: 'Gold', exchange: 'CMX' },
  MGC: { tick: 0.1, name: 'Micro Gold', exchange: 'CMX' },
  SI: { tick: 0.005, name: 'Silver', exchange: 'CMX' },
  HG: { tick: 0.0005, name: 'Copper', exchange: 'CMX' },
  CL: { tick: 0.01, name: 'Crude Oil', exchange: 'NYM' },
  MCL: { tick: 0.01, name: 'Micro Crude Oil', exchange: 'NYM' },
  NG: { tick: 0.001, name: 'Natural Gas', exchange: 'NYM' },
  ZB: { tick: 1 / 32, name: '30-Year T-Bond', exchange: 'CBT' },
  ZN: { tick: 1 / 64, name: '10-Year T-Note', exchange: 'CBT' },
  ZF: { tick: 1 / 128, name: '5-Year T-Note', exchange: 'CBT' },
  ZT: { tick: 1 / 256, name: '2-Year T-Note', exchange: 'CBT' },
  '6E': { tick: 0.00005, name: 'Euro FX', exchange: 'CME' },
};

const MONTH_CODES = 'FGHJKMNQUVXZ';

export interface ResolvedInstrument extends Instrument {
  readonly cal: ExchangeCalendar;
}

export class InstrumentError extends Error {}

/**
 * Accepts: QQQ, BRK.B, NQ, /NQ, NQ=F, NQZ26, NQZ26.CME, MNQ 12-26.
 * Continuous futures map to Yahoo's front month (=F); specific contracts keep their month.
 */
export function resolveInstrument(input: string): ResolvedInstrument {
  const raw = input.trim().toUpperCase();
  if (!/^[A-Z0-9./=^ -]{1,24}$/.test(raw)) throw new InstrumentError(`Unrecognised symbol "${input}"`);

  const fut = matchFuture(raw);
  if (fut) {
    const spec = FUTURES[fut.root]!;
    const cal = spec.equityIndex ? CME_EQUITY : CME_EQUITY; // non-index products share the approximate Globex calendar
    return {
      symbol: fut.symbol, root: fut.root, kind: 'future', tick: spec.tick, cal,
      calendar: cal.id, calendarFidelity: cal.fidelity, timezone: cal.timezone,
      session: spec.equityIndex ? cal.session : `${cal.session}; ${spec.name} hours vary`,
      adjustment: 'none',
    };
  }
  if (raw.endsWith('=F')) throw new InstrumentError(`Unknown futures root in "${input}"`);
  const symbol = raw.replace(/\./g, '-'); // Yahoo class shares: BRK.B → BRK-B
  if (!/^\^?[A-Z][A-Z0-9-]{0,9}$/.test(symbol)) throw new InstrumentError(`Unrecognised symbol "${input}"`);
  return {
    symbol, root: raw, kind: 'equity', tick: 0.01, cal: XNYS,
    calendar: XNYS.id, calendarFidelity: XNYS.fidelity, timezone: XNYS.timezone, session: XNYS.session,
    adjustment: 'split',
  };
}

function matchFuture(raw: string): { root: string; symbol: string } | null {
  const s = raw.replace(/^\//, '');
  // Continuous: NQ, NQ=F
  const cont = s.replace(/=F$/, '');
  if (FUTURES[cont]) return { root: cont, symbol: `${cont}=F` };
  // NinjaTrader style: MNQ 12-26
  const nt = /^([A-Z0-9]{1,4}) (\d{2})-(\d{2})$/.exec(s);
  if (nt && FUTURES[nt[1]!]) {
    const m = Number(nt[2]);
    if (m >= 1 && m <= 12) return contract(nt[1]!, MONTH_CODES[m - 1]!, nt[3]!);
  }
  // Specific: NQZ26 or NQZ26.CME
  const sp = /^([A-Z0-9]{1,4}?)([FGHJKMNQUVXZ])(\d{2})(?:\.[A-Z]{3})?$/.exec(s);
  if (sp && FUTURES[sp[1]!]) return contract(sp[1]!, sp[2]!, sp[3]!);
  return null;
}

function contract(root: string, month: string, yy: string) {
  return { root, symbol: `${root}${month}${yy}.${FUTURES[root]!.exchange}` };
}
