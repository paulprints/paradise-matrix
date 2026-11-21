/**
 * TPO (Market Profile) chart: the letters behind profile.ts's POC and value area.
 * Every block (one letter period) adds its index to each row its range touches,
 * using the same row rule and value-area auction as computeProfile, so the chart
 * and the Market Profile levels always agree.
 *
 * Everything here describes what traded; nothing predicts.
 *   single print: a row with exactly one letter
 *   poor high/low: the extreme row printed by two or more letters
 *   buying/selling tail: a run of single prints at the low/high, at least `tailMin` rows
 *   initial balance: range of the first `ibBlocks` blocks
 * Volume per row is ESTIMATED: each block's volume is spread evenly over the rows it touched.
 */
import { rowPrice, rowRange, valueArea } from './profile.ts';

export const TPO_VERSION = 'tpo@1';

export interface TpoBlock {
  readonly t: number;
  readonly o: number; readonly h: number; readonly l: number; readonly c: number; readonly v: number;
}

export interface TpoOptions {
  rowSize: number;
  /** (0, 1], default 0.7 */
  valueArea?: number;
  vaMethod?: 'two' | 'one';
  /** Blocks forming the initial balance (≥ 1). */
  ibBlocks?: number;
  /** Minimum single-print rows at an extreme to count as a tail (0 = never). */
  tailMin?: number;
}

export interface Tpo {
  rowSize: number;
  /** Row index of rows[0]; row i sits at price (base + i) × rowSize. */
  base: number;
  /** Letter (block) indexes per row, bottom → top. */
  rows: number[][];
  /** Estimated volume per row. */
  volume: number[];
  poc: number; vah: number; val: number;
  vpoc: number; vvah: number; vval: number;
  high: number; low: number; mid: number; open: number; close: number;
  ibHigh: number; ibLow: number;
  tpos: number; above: number; below: number;
  poorHigh: boolean; poorLow: boolean;
  /** Runs of single prints as [lowPrice, highPrice]. */
  singles: Array<[number, number]>;
  buyTail: number; sellTail: number;
  /** POC, VAH, VAL after each block (developing). */
  developing: Array<[number, number, number]>;
}

export function buildTpo(blocks: readonly TpoBlock[], o: TpoOptions): Tpo | null {
  const { rowSize } = o;
  if (!(rowSize > 0)) throw new RangeError('rowSize must be positive');
  const pct = o.valueArea ?? 0.7;
  if (!(pct > 0 && pct <= 1)) throw new RangeError('valueArea must be in (0, 1]');
  const method = o.vaMethod ?? 'two';
  const ranges = blocks.map((b) => rowRange(b, rowSize));
  const valid = ranges.filter((r): r is [number, number] => r !== null);
  if (!valid.length) return null;
  const base = Math.min(...valid.map((r) => r[0]));
  const top = Math.max(...valid.map((r) => r[1]));
  const rows: number[][] = Array.from({ length: top - base + 1 }, () => []);
  const volume = new Array<number>(rows.length).fill(0);
  const developing: Tpo['developing'] = [];
  let lo = Infinity, hi = -Infinity;
  const px = (k: number) => rowPrice(k, rowSize);

  ranges.forEach((r, i) => {
    if (r) {
      const share = (Number.isFinite(blocks[i]!.v) ? blocks[i]!.v : 0) / (r[1] - r[0] + 1);
      for (let k = r[0]; k <= r[1]; k++) { rows[k - base]!.push(i); volume[k - base]! += share; }
      lo = Math.min(lo, r[0]); hi = Math.max(hi, r[1]);
    }
    const va = valueArea((k) => rows[k - base]?.length ?? 0, lo, hi, pct, method);
    developing.push([px(va.poc), px(va.up), px(va.dn)]);
  });

  const count = (k: number) => rows[k - base]!.length;
  const tva = valueArea(count, base, top, pct, method);
  const vva = valueArea((k) => volume[k - base]!, base, top, pct, method);
  let above = 0, below = 0;
  for (let k = base; k <= top; k++) { if (k > tva.poc) above += count(k); if (k < tva.poc) below += count(k); }

  const singles: Tpo['singles'] = [];
  for (let k = base; k <= top; k++) {
    if (count(k) !== 1) continue;
    const last = singles[singles.length - 1];
    if (last && Math.abs(last[1] - px(k - 1)) < rowSize / 2) last[1] = px(k); else singles.push([px(k), px(k)]);
  }
  const run = (from: number, step: number) => { let n = 0; for (let k = from; k >= base && k <= top && count(k) === 1; k += step) n++; return n; };
  const tailMin = o.tailMin ?? 2;
  const ib = blocks.slice(0, Math.max(1, o.ibBlocks ?? 2)).filter((b) => b.h >= b.l);
  const first = blocks.find((b) => b.h >= b.l)!, lastB = [...blocks].reverse().find((b) => b.h >= b.l)!;

  return {
    rowSize, base, rows, volume,
    poc: px(tva.poc), vah: px(tva.up), val: px(tva.dn),
    vpoc: px(vva.poc), vvah: px(vva.up), vval: px(vva.dn),
    high: px(top), low: px(base), mid: px((base + top) / 2), open: first.o, close: lastB.c,
    ibHigh: Math.max(...ib.map((b) => b.h)), ibLow: Math.min(...ib.map((b) => b.l)),
    tpos: tva.total, above, below,
    poorHigh: count(top) >= 2, poorLow: count(base) >= 2,
    singles,
    buyTail: tailMin > 0 && run(base, 1) >= tailMin ? run(base, 1) : 0,
    sellTail: tailMin > 0 && run(top, -1) >= tailMin ? run(top, -1) : 0,
    developing,
  };
}
