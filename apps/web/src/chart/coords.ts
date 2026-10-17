/**
 * Lightweight Charts converts only WHOLE logical indexes: logicalToCoordinate(997.5)
 * returns 0 and coordinateToLogical rounds to a bar (observed on 5.2.1). Levels
 * and drawings start and end between bars, so interpolate between neighbours.
 */
export interface LogicalScale {
  logicalToCoordinate(logical: number): number | null;
  coordinateToLogical(x: number): number | null;
}

export function logicalToX(ts: LogicalScale, logical: number): number | null {
  const f = Math.floor(logical);
  const a = ts.logicalToCoordinate(f);
  if (a === null) return null;
  if (logical === f) return a;
  const b = ts.logicalToCoordinate(f + 1);
  return b === null ? null : a + (logical - f) * (b - a);
}

export function xToLogical(ts: LogicalScale, x: number): number | null {
  const l = ts.coordinateToLogical(x);
  if (l === null) return null;
  const a = ts.logicalToCoordinate(l), b = ts.logicalToCoordinate(l + 1);
  if (a === null || b === null || b === a) return l;
  return l + (x - a) / (b - a);
}
