/**
 * The ONE place public naming lives. Engine plot keys are exact vendor labels
 * (kept for traceability against captures); nothing below the API boundary
 * sends them to clients. Review these labels against Paradise's public naming
 * rules — changing a label here changes it everywhere.
 */
import type { LevelGroup } from '@paradise/contract';

export interface PublicName { slug: string; label: string; group: LevelGroup; family: string }

const T = (fam: string, short: string) => ({
  sell: { slug: `${short}.s`, label: `${fam.replace(/^t/, 'T')} S`, group: 'termination' as const, family: fam },
  buy: { slug: `${short}.b`, label: `${fam.replace(/^t/, 'T')} B`, group: 'termination' as const, family: fam },
});
const t51 = T('t5-1', 't51'), t52 = T('t5-2', 't52'), t52x = T('t5-2x', 't52x'), t53 = T('t5-3', 't53'), t59 = T('t5-9', 't59'),
  t59x = T('t5-9x', 't59x'), t61 = T('t6-1', 't61'), t65 = T('t6-5', 't65'), t66 = T('t6-6', 't66'), t67 = T('t6-7', 't67');

export const PUBLIC_NAMES: Record<string, PublicName> = {
  'Zone Six Top': { slug: 'zone.u2', label: 'Upper Zone 2', group: 'structure', family: 'zones' },
  'Zone Five Top': { slug: 'zone.u1', label: 'Upper Zone 1', group: 'structure', family: 'zones' },
  'Envelope Top': { slug: 'band.upper', label: 'Upper Band', group: 'structure', family: 'bands' },
  PLDot: { slug: 'pivot', label: 'Pivot', group: 'structure', family: 'pivot' },
  'Envelope Bottom': { slug: 'band.lower', label: 'Lower Band', group: 'structure', family: 'bands' },
  'Zone Two Bottom': { slug: 'zone.l1', label: 'Lower Zone 1', group: 'structure', family: 'zones' },
  'Zone One Bottom': { slug: 'zone.l2', label: 'Lower Zone 2', group: 'structure', family: 'zones' },
  'Main Channel': { slug: 'channel', label: 'Pivot Channel', group: 'structure', family: 'channel' },
  'H 1-1': { slug: 'range.high', label: 'Range High', group: 'range', family: 'range' },
  'L 1-1': { slug: 'range.low', label: 'Range Low', group: 'range', family: 'range' },
  '1-1 Dot': { slug: 'range.mid', label: 'Range Mid', group: 'range', family: 'range' },
  '5-1 Sell': t51.sell, '5-1 Buy': t51.buy,
  '5-2 Sell': t52.sell, '5-2 Buy': t52.buy,
  '5-2 Ex Sell': t52x.sell, '5-2 Ex Buy': t52x.buy,
  '5-3 Sell': t53.sell, '5-3 Buy': t53.buy,
  '5-9 Sell': t59.sell, '5-9 Buy': t59.buy,
  '5-9 Ex Sell': t59x.sell, '5-9 Ex Buy': t59x.buy,
  '6-1 Sell': t61.sell, '6-1 Buy': t61.buy,
  '6-5 Sell': t65.sell, '6-5 Buy': t65.buy,
  '6-6 Sell': t66.sell, '6-6 Buy': t66.buy,
  '6-7 Sell': t67.sell, '6-7 Buy': t67.buy,
  POC: { slug: 'poc', label: 'Profile POC', group: 'profile', family: 'profile' },
  VAH: { slug: 'vah', label: 'Value High', group: 'profile', family: 'profile' },
  VAL: { slug: 'val', label: 'Value Low', group: 'profile', family: 'profile' },
};

export function publicName(plot: string): PublicName {
  const n = PUBLIC_NAMES[plot];
  if (!n) throw new Error(`no public name for plot "${plot}"`);
  return n;
}

/** Location bands, indexed by how many of the seven structure levels sit below price. */
export const LOCATION_LABELS = [
  'Below Lower Zone 2',
  'Lower Zone 2 – Lower Zone 1',
  'Lower Zone 1 – Lower Band',
  'Lower Band – Pivot',
  'Pivot – Upper Band',
  'Upper Band – Upper Zone 1',
  'Upper Zone 1 – Upper Zone 2',
  'Above Upper Zone 2',
] as const;
