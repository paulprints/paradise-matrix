import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const AUDIT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/audit-2026-09-23');
export const RAW_DIR = join(AUDIT_DIR, 'dwm-evidence/raw');

export interface CaptureBar {
  index: number;
  bar_time_local: string;
  open: string; high: string; low: string; close: string;
  excluded_potentially_developing: boolean;
  public_plots: Record<string, { valid: boolean; value: string | null }>;
}
export interface Capture {
  file: string;
  meta: Record<string, any>;
  end: Record<string, any>;
  bars: CaptureBar[];
}

export function loadCapture(file: string): Capture {
  const lines = readFileSync(join(RAW_DIR, file), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const recs = lines.map((l) => JSON.parse(l));
  const bars = recs.filter((r) => r.kind === 'bar') as CaptureBar[];
  bars.sort((a, b) => a.index - b.index);
  bars.forEach((b, i) => { if (b.index !== i) throw new Error(`${file}: non-contiguous index ${b.index}`); });
  return { file, meta: recs[0], end: recs[recs.length - 1], bars };
}

export function allCaptures(): Capture[] {
  return readdirSync(RAW_DIR).filter((f) => f.endsWith('.jsonl')).sort().map(loadCapture);
}

export function readJson<T = any>(rel: string): T {
  return JSON.parse(readFileSync(join(AUDIT_DIR, rel), 'utf8'));
}

export const toHlc = (b: CaptureBar) => ({ h: Number(b.high), l: Number(b.low), c: Number(b.close) });
