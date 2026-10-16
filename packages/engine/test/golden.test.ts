/**
 * Golden suite: the engine must reproduce the 2026-09-23 audit's per-plot
 * results for every native Daily/Weekly/Monthly capture — not approximately,
 * but the same counts the audit recorded in dwm-results.json.
 */
import { describe, expect, it } from 'vitest';
import { evaluate, PLOT_KEYS, CORE_KEYS, TOLERANCE } from '../src/formulas.ts';
import { allCaptures, readJson, toHlc } from './fixtures.ts';

interface PlotStats {
  rows: number; valid_price_count: number; price_matches: number; price_mismatches: number;
  availability_matches: number; availability_mismatches: number; boundary_sensitive: number; boundary_vendor_valid: number;
}
const FIELDS: (keyof PlotStats)[] = ['rows', 'valid_price_count', 'price_matches', 'price_mismatches', 'availability_matches', 'availability_mismatches', 'boundary_sensitive', 'boundary_vendor_valid'];

const audit = readJson<any[]>('dwm-evidence/dwm-results.json');
const byId = new Map(audit.map((r) => [r.metadata.capture_id, r]));

describe('audit golden reproduction (native D/W/M captures)', () => {
  const captures = allCaptures();
  it('loads all seven captures', () => expect(captures).toHaveLength(7));

  for (const cap of captures) {
    const id = cap.meta.capture_id as string;
    const label = `${cap.meta.symbol} ${cap.meta.bars_period_type} d=${cap.meta.displacement} (${id.slice(0, 8)})`;
    it(`${label}: per-plot stats equal the audit's`, () => {
      const expected = byId.get(id);
      expect(expected, 'capture present in dwm-results.json').toBeTruthy();
      expect(cap.end.double_read_unchanged && cap.end.bar_count_unchanged).toBe(true);

      const hlc = cap.bars.map(toHlc);
      const stats: Record<string, PlotStats> = {};
      for (const bar of cap.bars) {
        if (bar.excluded_potentially_developing || bar.index < 5) continue;
        for (const v of evaluate(hlc, bar.index)) {
          const s = (stats[v.spec.key] ??= Object.fromEntries(FIELDS.map((f) => [f, 0])) as unknown as PlotStats);
          const actual = bar.public_plots[v.spec.key]!;
          s.rows++;
          if (actual.valid && actual.value !== null) {
            s.valid_price_count++;
            if (Math.abs(v.candidate - Number(actual.value)) <= TOLERANCE) s.price_matches++;
            else s.price_mismatches++;
          }
          if (v.state === 'boundary') { s.boundary_sensitive++; s.boundary_vendor_valid += Number(actual.valid); }
          else if ((v.state === 'active') === actual.valid) s.availability_matches++;
          else s.availability_mismatches++;
        }
      }
      for (const key of PLOT_KEYS) {
        const want = expected.post_startup[key];
        const got = stats[key]!;
        for (const f of FIELDS) expect(got[f], `${key}.${f}`).toBe(want[f]);
      }
    });
  }
});

describe('audit headline table (README, fresh native captures)', () => {
  // Representative captures and the additional-24 totals stated in the audit README.
  const table: Array<[string, number, number]> = [
    ['4074ba563520446b9946537365318677', 3447, 2], // MNQ 12-26 Daily, d=0
    ['c137807ce33941c68b4041437212a1f8', 3226, 2], // QQQ Daily
    ['a6fbac399fea4cc18801dcb91f02afb6', 3456, 0], // QQQ Weekly
    ['0ffdce94d99649059085d81491dcf9e4', 2327, 3], // QQQ Monthly
  ];
  const extra = PLOT_KEYS.filter((k) => !CORE_KEYS.includes(k));
  const caps = new Map(allCaptures().map((c) => [c.meta.capture_id, c]));
  for (const [id, available, boundary] of table) {
    it(`${id.slice(0, 8)}: ${available} additional-plot matches, 0 mismatches, ${boundary} boundary`, () => {
      const cap = caps.get(id)!;
      const hlc = cap.bars.map(toHlc);
      let matches = 0, mismatches = 0, availMismatch = 0, bnd = 0, coreMismatch = 0;
      for (const bar of cap.bars) {
        if (bar.excluded_potentially_developing || bar.index < 5) continue;
        for (const v of evaluate(hlc, bar.index)) {
          const a = bar.public_plots[v.spec.key]!;
          const priceOk = !a.valid || Math.abs(v.candidate - Number(a.value)) <= TOLERANCE;
          if (CORE_KEYS.includes(v.spec.key)) { if (!priceOk) coreMismatch++; continue; }
          if (!extra.includes(v.spec.key)) continue;
          if (a.valid) priceOk ? matches++ : mismatches++;
          if (v.state === 'boundary') bnd++;
          else if ((v.state === 'active') !== a.valid) availMismatch++;
        }
      }
      expect({ matches, mismatches, availMismatch, bnd, coreMismatch }).toEqual({ matches: available, mismatches: 0, availMismatch: 0, bnd: boundary, coreMismatch: 0 });
    });
  }
});
