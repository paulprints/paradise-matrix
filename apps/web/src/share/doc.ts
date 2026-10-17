/**
 * The browser's copy of a shared chart's drawings. Turns local edits into
 * versioned ops and folds in ops from others with the same rule the server
 * uses (contract `stampWins`), so every client converges.
 *
 * The server doesn't acknowledge accepted ops, only rejects. After a
 * reconnect, `rebase` merges the local copy with the server's and returns the
 * local states that still win, to resend; anything stale comes back as a
 * reject with the server's state.
 */
import { stampNonce, stampWins, type Drawing, type LiveOp, type VersionedDrawing } from '@paradise/contract';

interface Entry { v: number; n: number; d?: Drawing; del?: true }
const toOp = (id: string, e: Entry): LiveOp => (e.del ? { id, v: e.v, n: e.n, del: true } : { id, v: e.v, n: e.n, d: e.d! });
const same = (a: Drawing | undefined, b: Drawing) => !!a && JSON.stringify(a) === JSON.stringify(b);

export class SharedDoc {
  private items = new Map<string, Entry>();
  private order: string[] = [];

  constructor(private readonly nonce: () => number = stampNonce) {}

  /** Replace everything with the server's state. */
  load(drawings: VersionedDrawing[]) {
    this.items = new Map(drawings.map(({ v, n, ...d }) => [d.id, { v, n, d: d as Drawing }]));
    this.order = drawings.map((d) => d.id);
  }

  /** Live drawings in display order. */
  list(): Drawing[] {
    return this.order.flatMap((id) => { const e = this.items.get(id); return e && !e.del ? [e.d!] : []; });
  }

  /** Versioned state of one drawing (tests and debugging). */
  stamp(id: string): { v: number; n: number; del: boolean } | null {
    const e = this.items.get(id);
    return e ? { v: e.v, n: e.n, del: !!e.del } : null;
  }

  /** Local edit: the new full list → ops for whatever changed (applied locally at once). */
  diff(next: Drawing[]): LiveOp[] {
    const ops: LiveOp[] = [];
    const seen = new Set<string>();
    for (const d of next) {
      seen.add(d.id);
      const cur = this.items.get(d.id);
      if (cur && !cur.del && same(cur.d, d)) continue;
      const e: Entry = { v: (cur?.v ?? 0) + 1, n: this.nonce(), d };
      this.items.set(d.id, e);
      ops.push(toOp(d.id, e));
    }
    for (const [id, cur] of this.items) {
      if (cur.del || seen.has(id)) continue;
      const e: Entry = { v: cur.v + 1, n: this.nonce(), del: true };
      this.items.set(id, e);
      ops.push(toOp(id, e));
    }
    const nextIds = next.map((d) => d.id);
    this.order = [...nextIds, ...this.order.filter((id) => !seen.has(id) && this.items.has(id))];
    return ops;
  }

  /** Ops from another member: keep each only if it wins. Returns true if anything visible changed. */
  apply(ops: LiveOp[]): boolean {
    let changed = false;
    for (const op of ops) {
      const cur = this.items.get(op.id);
      if (!stampWins(op, cur)) continue;
      this.set(op);
      changed = true;
    }
    return changed;
  }

  /** The server refused our edit: take its state as-is (it is authoritative). */
  force(ops: LiveOp[]) {
    for (const op of ops) {
      if (op.v === 0) { this.items.delete(op.id); this.order = this.order.filter((x) => x !== op.id); continue; }
      this.set(op);
    }
  }

  /**
   * Reconnected: merge with the server's live drawings. Returns local states the
   * server should see again: edits it may have missed, and local drawings it
   * doesn't list (made offline, or deleted by someone else — the server decides).
   */
  rebase(server: VersionedDrawing[]): LiveOp[] {
    const local = this.items;
    const localOrder = this.order;
    this.load(server);
    const resend: LiveOp[] = [];
    for (const id of localOrder.concat([...local.keys()].filter((k) => !localOrder.includes(k)))) {
      const mine = local.get(id);
      if (!mine) continue;
      const theirs = this.items.get(id);
      if (theirs ? stampWins(mine, theirs) : !mine.del) {
        this.set({ ...toOp(id, mine) });
        resend.push(toOp(id, mine));
      }
    }
    return resend;
  }

  private set(op: LiveOp) {
    if (!this.items.has(op.id)) this.order.push(op.id);
    this.items.set(op.id, op.del ? { v: op.v, n: op.n, del: true } : { v: op.v, n: op.n, d: op.d! });
  }
}
