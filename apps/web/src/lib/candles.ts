/**
 * Candle colours, like TradingView's Symbol settings: body, border and wick, each
 * for up and down candles. Kept per browser; anything not set follows the theme.
 */
import type { Palette } from '../chart/theme.ts';

export const CANDLE_PARTS = [
  ['Body', 'upColor', 'downColor'],
  ['Borders', 'borderUpColor', 'borderDownColor'],
  ['Wick', 'wickUpColor', 'wickDownColor'],
] as const;
export type CandleKey = (typeof CANDLE_PARTS)[number][1 | 2];
export type CandleColors = Partial<Record<CandleKey, string>>;

/** The theme's candles, with the member's own colours on top. */
export const candleColors = (P: Palette, own: CandleColors = {}): Record<CandleKey, string> => ({
  upColor: P.plate, borderUpColor: P.paper, wickUpColor: P.paper,
  downColor: P.alert, borderDownColor: P.alert, wickDownColor: P.alert,
  ...own,
});

const KEY = 'pp_candles';
const HEX = /^#[0-9a-f]{6}$/i;
const KEYS = new Set<string>(CANDLE_PARTS.flatMap(([, up, down]) => [up, down]));

export function loadCandles(): CandleColors {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    // Only known parts with a #rrggbb value; anything else falls back to the theme.
    return Object.fromEntries(Object.entries(raw).filter(([k, v]) => KEYS.has(k) && typeof v === 'string' && HEX.test(v)));
  } catch { return {}; }
}
export function saveCandles(c: CandleColors) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode */ } }
