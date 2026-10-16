/**
 * Label placement for the ladder: keeps labels at least `gap` px apart while
 * staying as close as possible to their rule. Greedy downward pass, then an
 * upward pass to pull the stack back inside bounds.
 */
export interface Placed<T> { item: T; y: number; labelY: number }

export function placeLabels<T>(items: Array<{ item: T; y: number }>, gap: number, top: number, bottom: number): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  const out: Placed<T>[] = sorted.map((s) => ({ ...s, labelY: Math.min(Math.max(s.y, top), bottom) }));
  for (let i = 1; i < out.length; i++) out[i]!.labelY = Math.max(out[i]!.labelY, out[i - 1]!.labelY + gap);
  if (out.length && out[out.length - 1]!.labelY > bottom) {
    out[out.length - 1]!.labelY = bottom;
    for (let i = out.length - 2; i >= 0; i--) out[i]!.labelY = Math.min(out[i]!.labelY, out[i + 1]!.labelY - gap);
  }
  return out;
}
