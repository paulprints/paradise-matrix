/**
 * Paces outgoing edits to stay inside the server's budget (LIVE_OPS_BUDGET):
 * a token bucket mirroring the server's, at most `perMessage` ops a message.
 * Several edits to one drawing while waiting collapse to the latest, so a long
 * drag or a big "clear all" sends only what's needed.
 */
import { LIVE_OPS_BUDGET, type LiveOp } from '@paradise/contract';

export class Outbox {
  private queue = new Map<string, LiveOp>();
  private tokens: number = LIVE_OPS_BUDGET.capacity;
  private at: number;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    /** Returns false if it couldn't send (offline): the batch is dropped; rejoin resends what matters. */
    private readonly send: (ops: LiveOp[]) => boolean,
    private readonly now: () => number = Date.now,
    // A little under the server's budget, so clock skew never trips its limit.
    private readonly budget = { capacity: LIVE_OPS_BUDGET.capacity - 10, windowMs: LIVE_OPS_BUDGET.windowMs, perMessage: LIVE_OPS_BUDGET.perMessage },
  ) {
    this.at = now();
    this.tokens = this.budget.capacity;
  }

  get pending() { return this.queue.size; }

  push(ops: LiveOp[]) {
    for (const op of ops) { this.queue.delete(op.id); this.queue.set(op.id, op); }
    this.flush();
  }

  /** Disconnected: nothing queued is worth sending later (rebase decides). */
  clear() {
    this.queue.clear();
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private refill() {
    const t = this.now();
    this.tokens = Math.min(this.budget.capacity, this.tokens + ((t - this.at) / this.budget.windowMs) * this.budget.capacity);
    this.at = t;
  }

  private flush() {
    if (this.timer) return;
    this.refill();
    while (this.queue.size && this.tokens >= 1) {
      const n = Math.min(this.budget.perMessage, Math.floor(this.tokens), this.queue.size);
      const batch = [...this.queue.values()].slice(0, n);
      for (const op of batch) this.queue.delete(op.id);
      this.tokens -= n;
      if (!this.send(batch)) { this.clear(); return; }
    }
    if (this.queue.size) {
      const need = Math.min(this.budget.perMessage, this.queue.size) - this.tokens;
      const wait = Math.max(50, Math.ceil((need / this.budget.capacity) * this.budget.windowMs));
      this.timer = setTimeout(() => { this.timer = null; this.flush(); }, wait);
    }
  }
}
