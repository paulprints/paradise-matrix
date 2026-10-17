/**
 * Shared charts: a config (symbol, timeframes, view settings), view/edit link
 * keys, and a set of versioned drawings with tombstones. Lives in the same
 * SQLite file as users; deleting a user deletes their shares.
 */
import { randomBytes } from 'node:crypto';
import type { Database } from 'sqlite';
import type { Drawing, LiveOp, ShareConfig, ShareInfo, ShareRole, VersionedDrawing } from '@paradise/contract';
import { DRAWING_LIMITS } from '@paradise/contract';
import { nonce, wins } from './merge.ts';

interface ShareRow {
  id: string; owner_id: number; owner_name: string; title: string; config: string;
  view_key: string; edit_key: string; locked: number; created_at: string; updated_at: string;
}
interface DrawingRow { id: string; data: string; v: number; n: number; deleted: number }

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const shareId = () => Array.from(randomBytes(10), (b) => B62[b % 62]).join('');
export const linkKey = () => randomBytes(18).toString('base64url');
export const newDrawingId = () => randomBytes(8).toString('hex');

export interface ApplyResult { accepted: LiveOp[]; rejected: LiveOp[]; reason: string | null }

export class SharesStore {
  /** Per-chart queue: apply() reads, compares and writes, which must not interleave for one chart. */
  private readonly queues = new Map<string, Promise<unknown>>();
  private constructor(private readonly db: Database) {}

  private serial<T>(chartId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(chartId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.queues.set(chartId, tail);
    void tail.then(() => { if (this.queues.get(chartId) === tail) this.queues.delete(chartId); });
    return run;
  }

  static async open(db: Database): Promise<SharesStore> {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS shared_charts (
        id TEXT PRIMARY KEY,
        owner_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        config TEXT NOT NULL,
        view_key TEXT NOT NULL,
        edit_key TEXT NOT NULL,
        locked INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS shared_charts_owner ON shared_charts(owner_id);
      CREATE TABLE IF NOT EXISTS shared_drawings (
        chart_id TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        v INTEGER NOT NULL,
        n INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        updated_by INTEGER,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chart_id, id),
        FOREIGN KEY (chart_id) REFERENCES shared_charts(id) ON DELETE CASCADE
      );
    `);
    return new SharesStore(db);
  }

  private async row(id: string): Promise<ShareRow | null> {
    return (await this.db.get<ShareRow>(
      `SELECT s.*, u.username AS owner_name FROM shared_charts s JOIN users u ON u.id = s.owner_id WHERE s.id = ?`, id)) ?? null;
  }

  private info(r: ShareRow, withKeys: boolean): ShareInfo {
    return {
      id: r.id, title: r.title, config: JSON.parse(r.config) as ShareConfig,
      owner: { id: r.owner_id, username: r.owner_name }, locked: r.locked === 1,
      createdAt: r.created_at, updatedAt: r.updated_at,
      ...(withKeys ? { viewKey: r.view_key, editKey: r.edit_key } : {}),
    };
  }

  /** Role for a user holding an optional link key; null = no access (callers answer 404). */
  async access(id: string, userId: number, key?: string | null): Promise<{ share: ShareInfo; role: ShareRole } | null> {
    const r = await this.row(id);
    if (!r) return null;
    const role: ShareRole | null = r.owner_id === userId ? 'owner' : key && key === r.edit_key ? 'editor' : key && key === r.view_key ? 'viewer' : null;
    return role ? { share: this.info(r, role === 'owner'), role } : null;
  }

  async get(id: string, withKeys = false): Promise<ShareInfo | null> {
    const r = await this.row(id);
    return r ? this.info(r, withKeys) : null;
  }

  async countByOwner(ownerId: number): Promise<number> {
    return (await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM shared_charts WHERE owner_id = ?', ownerId))!.n;
  }

  async listByOwner(ownerId: number): Promise<ShareInfo[]> {
    const rows = await this.db.all<ShareRow[]>(
      `SELECT s.*, u.username AS owner_name FROM shared_charts s JOIN users u ON u.id = s.owner_id WHERE s.owner_id = ? ORDER BY s.updated_at DESC, s.created_at DESC`, ownerId);
    return rows.map((r) => this.info(r, true));
  }

  async create(ownerId: number, title: string, config: ShareConfig, drawings: Drawing[]): Promise<ShareInfo> {
    const id = shareId();
    await this.db.run('INSERT INTO shared_charts (id, owner_id, title, config, view_key, edit_key) VALUES (?, ?, ?, ?, ?, ?)',
      id, ownerId, title, JSON.stringify(config), linkKey(), linkKey());
    for (const d of drawings.slice(0, DRAWING_LIMITS.perSymbol)) {
      await this.db.run('INSERT INTO shared_drawings (chart_id, id, data, v, n, deleted, updated_by) VALUES (?, ?, ?, 1, ?, 0, ?)',
        id, d.id, JSON.stringify(d), nonce(), ownerId);
    }
    return (await this.get(id, true))!;
  }

  async update(id: string, patch: { title?: string; locked?: boolean; rotate?: 'view' | 'edit'; config?: ShareConfig }): Promise<ShareInfo | null> {
    if (patch.config !== undefined) await this.db.run('UPDATE shared_charts SET config = ? WHERE id = ?', JSON.stringify(patch.config), id);
    if (patch.title !== undefined) await this.db.run('UPDATE shared_charts SET title = ? WHERE id = ?', patch.title, id);
    if (patch.locked !== undefined) await this.db.run('UPDATE shared_charts SET locked = ? WHERE id = ?', patch.locked ? 1 : 0, id);
    if (patch.rotate) await this.db.run(`UPDATE shared_charts SET ${patch.rotate === 'view' ? 'view_key' : 'edit_key'} = ? WHERE id = ?`, linkKey(), id);
    await this.db.run('UPDATE shared_charts SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', id);
    return this.get(id, true);
  }

  async remove(id: string): Promise<boolean> {
    await this.db.run('DELETE FROM shared_drawings WHERE chart_id = ?', id);
    return ((await this.db.run('DELETE FROM shared_charts WHERE id = ?', id)).changes ?? 0) > 0;
  }

  /** Live drawings (tombstones excluded). */
  async drawings(id: string): Promise<VersionedDrawing[]> {
    const rows = await this.db.all<DrawingRow[]>('SELECT id, data, v, n, deleted FROM shared_drawings WHERE chart_id = ? AND deleted = 0 ORDER BY rowid', id);
    return rows.map((r) => ({ ...(JSON.parse(r.data) as Drawing), v: r.v, n: r.n }));
  }

  /** Stored state for these ids as ops (a never-seen id reads as a v0 tombstone). Used to undo refused edits. */
  async current(chartId: string, ids: string[]): Promise<LiveOp[]> {
    const out: LiveOp[] = [];
    for (const id of ids) {
      const cur = await this.db.get<DrawingRow>('SELECT id, data, v, n, deleted FROM shared_drawings WHERE chart_id = ? AND id = ?', chartId, id);
      out.push(stateOp(id, cur));
    }
    return out;
  }

  /**
   * Apply ops with the convergence rule. Losing ops come back as `rejected`,
   * each carrying the stored state so the sender can correct itself.
   */
  apply(chartId: string, userId: number, ops: LiveOp[]): Promise<ApplyResult> {
    return this.serial(chartId, () => this.applyNow(chartId, userId, ops));
  }

  private async applyNow(chartId: string, userId: number, ops: LiveOp[]): Promise<ApplyResult> {
    const accepted: LiveOp[] = [], rejected: LiveOp[] = [];
    let reason: string | null = null;
    let liveCount = (await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM shared_drawings WHERE chart_id = ? AND deleted = 0', chartId))!.n;
    for (const op of ops) {
      const cur = await this.db.get<DrawingRow>('SELECT id, data, v, n, deleted FROM shared_drawings WHERE chart_id = ? AND id = ?', chartId, op.id);
      const curOp = () => stateOp(op.id, cur);
      if (!wins(op, cur)) { rejected.push(curOp()); reason ??= 'a newer edit already exists'; continue; }
      const creating = !op.del && (!cur || cur.deleted === 1);
      if (creating && liveCount >= DRAWING_LIMITS.perSymbol) { rejected.push(curOp()); reason = `this chart already has ${DRAWING_LIMITS.perSymbol} drawings`; continue; }
      await this.db.run(
        `INSERT INTO shared_drawings (chart_id, id, data, v, n, deleted, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(chart_id, id) DO UPDATE SET data = excluded.data, v = excluded.v, n = excluded.n, deleted = excluded.deleted, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
        chartId, op.id, op.del ? (cur?.data ?? '{}') : JSON.stringify(op.d), op.v, op.n, op.del ? 1 : 0, userId,
      );
      if (creating) liveCount++;
      else if (op.del && cur && cur.deleted === 0) liveCount--;
      accepted.push(op);
    }
    if (accepted.length) await this.db.run('UPDATE shared_charts SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', chartId);
    return { accepted, rejected, reason };
  }
}

const stateOp = (id: string, cur: DrawingRow | undefined): LiveOp =>
  !cur ? { id, v: 0, n: 0, del: true }
    : cur.deleted ? { id, v: cur.v, n: cur.n, del: true }
    : { id, v: cur.v, n: cur.n, d: JSON.parse(cur.data) as Drawing };
