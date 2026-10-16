import { describe, expect, it } from 'vitest';
import { InstrumentError, resolveInstrument } from '../src/data/instruments.ts';

describe('resolveInstrument', () => {
  it.each([
    ['QQQ', 'QQQ', 'equity', 0.01],
    ['brk.b', 'BRK-B', 'equity', 0.01],
    ['NQ', 'NQ=F', 'future', 0.25],
    ['/es', 'ES=F', 'future', 0.25],
    ['GC=F', 'GC=F', 'future', 0.1],   // old app: 0.25
    ['CL=F', 'CL=F', 'future', 0.01],  // old app: 0.25
    ['MNQ', 'MNQ=F', 'future', 0.25],
    ['MNQ 12-26', 'MNQZ26.CME', 'future', 0.25],
    ['NQZ26', 'NQZ26.CME', 'future', 0.25],
    ['ZN=F', 'ZN=F', 'future', 1 / 64],
    ['^VIX', '^VIX', 'equity', 0.01],
  ])('%s → %s', (input, symbol, kind, tick) => {
    const r = resolveInstrument(input);
    expect([r.symbol, r.kind, r.tick]).toEqual([symbol, kind, tick]);
  });
  it('equities use the exact NYSE calendar, futures the approximate CME one', () => {
    expect(resolveInstrument('SPY').calendarFidelity).toBe('exact');
    expect(resolveInstrument('ES').calendarFidelity).toBe('approximate');
    expect(resolveInstrument('SPY').adjustment).toBe('split');
  });
  it('rejects junk and unknown futures roots', () => {
    expect(() => resolveInstrument('XX=F')).toThrow(InstrumentError);
    expect(() => resolveInstrument('DROP TABLE;')).toThrow(InstrumentError);
    expect(() => resolveInstrument('')).toThrow(InstrumentError);
  });
});
