/**
 * Motion tokens for canvas animations; the same values live in styles.css as
 * --dur-fast / --dur-base / --dur-slow and --ease-out. Animate only state
 * changes (confirmed, refused, connected), never data values.
 */
export const MOTION = { fast: 120, base: 200, slow: 320 } as const;

/** The house ease-out (cubic), matching --ease-out. t in [0, 1]. */
export const easeOut = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

export const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Frame-rate independent smoothing: move `cur` toward `target`, covering ~63%
 * of the gap every `tau` ms. No overshoot, so a cursor never passes its target.
 */
export const approach = (cur: number, target: number, dtMs: number, tau: number): number =>
  target + (cur - target) * Math.exp(-Math.max(0, dtMs) / tau);
