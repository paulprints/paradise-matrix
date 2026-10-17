/** Validation shared by REST routes and the live hub. */
import { z } from 'zod';
import { DRAWING_COLORS, DRAWING_LIMITS, SHARE_LIMITS, TIMEFRAMES } from '@paradise/contract';

const finite = z.number().finite();
const anchor = z.object({ t: z.number().int().min(0), p: finite });
const base = { id: z.string().min(1).max(40), color: z.enum(DRAWING_COLORS) };
export const drawingSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('trend'), a: anchor, b: anchor, extend: z.boolean() }),
  z.object({ ...base, kind: z.literal('hline'), p: finite }),
  z.object({ ...base, kind: z.literal('vline'), t: z.number().int().min(0) }),
  z.object({ ...base, kind: z.literal('rect'), a: anchor, b: anchor }),
  z.object({ ...base, kind: z.literal('text'), a: anchor, text: z.string().trim().min(1).max(DRAWING_LIMITS.textLength) }),
  z.object({ ...base, kind: z.literal('brush'), pts: z.array(anchor).min(2).max(DRAWING_LIMITS.brushPoints) }),
]);

const tf = z.enum(TIMEFRAMES as [string, ...string[]]);
export const shareConfigSchema = z.object({
  symbol: z.string().trim().min(1).max(24),
  chartTf: tf,
  timeframes: z.array(tf).min(1).max(8),
  displacement: z.union([z.literal(0), z.literal(1)]),
  developing: z.boolean(),
  profile: z.boolean(),
  heat: z.boolean(),
  heatStyle: z.enum(['matrix', 'halftone']),
  groups: z.array(z.enum(['structure', 'range', 'termination', 'profile'])).max(4),
});

export const liveOpSchema = z.object({
  id: z.string().min(1).max(40),
  v: z.number().int().min(1).max(2 ** 31),
  n: z.number().int().min(0).max(2 ** 31),
  del: z.literal(true).optional(),
  d: drawingSchema.optional(),
}).refine((o) => (o.del ? !o.d : !!o.d && o.d.id === o.id), 'an op carries a drawing with the same id, or del');

export const anchorSchema = anchor;
export const presenterViewSchema = z.object({ chartTf: tf, timeframes: z.array(tf).max(8), from: z.number().finite(), to: z.number().finite() });
export const titleSchema = z.string().trim().min(1).max(SHARE_LIMITS.titleLength);
