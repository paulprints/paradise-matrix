/**
 * Live data check — run on a machine that can reach Yahoo:
 *   npm run verify:live -w apps/server
 *
 * 1. Adjustment policy: Yahoo QQQ daily closes vs the NinjaTrader capture in
 *    fixtures/ (split-adjusted, not dividend-adjusted, should agree to cents;
 *    dividend adjustment would drift older bars by ~0.5%+).
 * 2. Period alignment: W/M rows map to unique, ordered periods with sane
 *    completeness for an equity and a future.
 * 3. A full live /api/levels computation for QQQ (M,W,D) and NQ (D).
 * Exits non-zero on any failure.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeBars } from './data/bars.ts';
import { resolveInstrument } from './data/instruments.ts';
import { createMarket } from './data/market.ts';
import { yahooProvider } from './data/providers.ts';
import { computeLevels } from './levels.ts';

async function main() {
  const fails: string[] = [];
  const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
  const now = Date.now() / 1000;
  const yahoo = yahooProvider();

  // 1. adjustment policy
  const capPath = fileURLToPath(new URL('../../../fixtures/audit-2026-09-23/dwm-evidence/raw/audit-c137807ce33941c68b4041437212a1f8.jsonl', import.meta.url));
  const nt = new Map<string, number>();
  for (const line of readFileSync(capPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean)) {
    const r = JSON.parse(line);
    if (r.kind === 'bar' && !r.excluded_potentially_developing) nt.set(r.bar_time_local.slice(0, 10), Number(r.close));
  }
  const qqq = resolveInstrument('QQQ');
  const d = normalizeBars(await yahoo.fetch('QQQ', 'D'), 'D', qqq.cal, now).bars;
  const diffs = d.filter((b) => nt.has(b.key)).map((b) => ({ key: b.key, diff: b.c - nt.get(b.key)! }));
  const maxAbs = Math.max(...diffs.map((x) => Math.abs(x.diff)));
  const oldest = diffs.slice(0, 20), newest = diffs.slice(-20);
  const drift = Math.abs(oldest.reduce((s, x) => s + x.diff, 0) / oldest.length - newest.reduce((s, x) => s + x.diff, 0) / newest.length);
  console.log(`      ${diffs.length} overlapping QQQ daily closes; max |Yahoo − NinjaTrader| = ${maxAbs.toFixed(4)}; old-vs-new mean drift = ${drift.toFixed(4)}`);
  check(diffs.length > 200, 'Yahoo daily history overlaps the NinjaTrader capture');
  check(drift < 0.05, 'no dividend-adjustment drift between oldest and newest bars');
  check(maxAbs < 0.06, 'closes agree to within a few cents (feed differences only)');

  // 2. alignment
  for (const sym of ['QQQ', 'NQ']) {
    const inst = resolveInstrument(sym);
    for (const tf of ['W', 'M'] as const) {
      const n = normalizeBars(await yahoo.fetch(inst.symbol, tf), tf, inst.cal, now);
      const keys = n.bars.map((b) => b.key);
      check(new Set(keys).size === keys.length && keys.every((k, i) => i === 0 || k > keys[i - 1]!), `${sym} ${tf}: ${keys.length} unique ordered periods (dropped ${n.dropped})`);
      const incomplete = n.bars.filter((b) => !b.complete).length;
      check(incomplete <= 1, `${sym} ${tf}: at most one forming bar (last: ${n.bars.at(-1)?.label}, complete=${n.bars.at(-1)?.complete})`);
    }
  }

  // 3. live levels
  const market = createMarket([yahoo]);
  for (const [symbol, timeframes] of [['QQQ', ['M', 'W', 'D']], ['NQ', ['D']]] as const) {
    const r = await computeLevels({ symbol, timeframes: [...timeframes], developing: true, profile: true }, { market });
    const confirmed = r.levels.filter((l) => l.basis === 'confirmed' && l.group !== 'profile');
    check(confirmed.length === 31 * timeframes.length, `${symbol}: ${confirmed.length} confirmed levels, last price ${r.lastPrice?.price}`);
    for (const f of r.frames) console.log(`      ${f.tf}: from ${f.source?.label} → drawn on ${f.display.label}; ${f.facts.location?.label ?? 'no location'}${f.warnings.length ? `; warnings: ${f.warnings.join(' | ')}` : ''}`);
    for (const w of r.warnings) console.log(`      note: ${w}`);
  }

  console.log(fails.length ? `\n${fails.length} check(s) failed` : '\nAll live checks passed');
  process.exitCode = fails.length ? 1 : 0;
}

main().catch((e: any) => {
  console.error(`FAIL  live checks could not run: ${e?.message ?? e}${e?.cause?.message ? ` (${e.cause.message})` : ''}`);
  console.error('      Is this machine online and able to reach query1.finance.yahoo.com?');
  process.exitCode = 1;
});
