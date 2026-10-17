/**
 * Shared charts: a config (symbol, timeframes, view settings), one link, a
 * people list, and a set of versioned drawings with tombstones. Lives in the
 * same SQLite file as users; deleting a user deletes their shares and
 * memberships.
 *
 * Access: the owner always; otherwise your row in shared_members. Opening the
 * link for the first time (`join`) adds you with the share's `linkAccess`
 * (viewer, editor, or pending approval). The owner changes anyone's role or
 * removes them; removed people stay listed so the link doesn't let them back.
 */
import { randomBytes } from 'node:crypto';
import type { Database } from 'sqlite';
import type { Drawing, LinkAccess, LiveOp, MemberRole, ShareConfig, ShareInfo, ShareMember, ShareRole, VersionedDrawing } from '@paradise/contract';
import { DRAWING_LIMITS } from '@paradise/contract';
import { nonce, wins } from './merge.ts';

interface ShareRow {
  id: string; owner_id: number; owner_name: string; title: string; config: string;
  link_access: LinkAccess; locked: number; created_at: string; updated_at: string;
}
interface MemberRow { user_id: number; username: string; role: MemberRole; joined_at: string; last_seen: string }

/** What a person may do with a share right now. `role` is null unless status is 'ok'. */
export interface Access { share: ShareInfo; role: ShareRole | null; status: 'ok' | 'pending' | 'removed' | 'none' }
interface DrawingRow { id: string; data: string; v: number; n: number; deleted: number }

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const shareId = () => Array.from(randomBytes(10), (b) => B62[b % 62]).join('');
/** Legacy columns from the two-link version; still filled so old databases stay valid, never used. */
const legacyKey = () => randomBytes(18).toString('base64url');
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
        link_access TEXT NOT NULL DEFAULT 'viewer',
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
      CREATE TABLE IF NOT EXISTS shared_members (
        chart_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chart_id, user_id),
        FOREIGN KEY (chart_id) REFERENCES shared_charts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    const cols = await db.all<{ name: string }[]>('PRAGMA table_info(shared_charts)');
    if (!cols.some((c) => c.name === 'link_access')) await db.exec(`ALTER TABLE shared_charts ADD COLUMN link_access TEXT NOT NULL DEFAULT 'viewer'`);
    return new SharesStore(db);
  }

  private async row(id: string): Promise<ShareRow | null> {
    return (await this.db.get<ShareRow>(
      `SELECT s.*, u.username AS owner_name FROM shared_charts s JOIN users u ON u.id = s.owner_id WHERE s.id = ?`, id)) ?? null;
  }

  private info(r: ShareRow): ShareInfo {
    return {
      id: r.id, title: r.title, config: JSON.parse(r.config) as ShareConfig,
      owner: { id: r.owner_id, username: r.owner_name }, locked: r.locked === 1,
      createdAt: r.created_at, updatedAt: r.updated_at, linkAccess: r.link_access,
    };
  }

  /** Read-only: what this person may do. null = no such share. */
  async access(id: string, userId: number): Promise<Access | null> {
    const r = await this.row(id);
    if (!r) return null;
    const share = this.info(r);
    if (r.owner_id === userId) return { share, role: 'owner', status: 'ok' };
    const m = await this.db.get<{ role: MemberRole }>('SELECT role FROM shared_members WHERE chart_id = ? AND user_id = ?', id, userId);
    if (!m) return { share, role: null, status: 'none' };
    if (m.role === 'viewer' || m.role === 'editor') return { share, role: m.role, status: 'ok' };
    return { share, role: null, status: m.role };
  }

  /**
   * Opening the link: first time, you're added with the share's link access
   * (or as pending); every time, last-seen is updated. Returns your access
   * and whether you were just added (so the owner can be told).
   */
  async join(id: string, userId: number): Promise<(Access & { added: boolean }) | null> {
    const a = await this.access(id, userId);
    if (!a) return null;
    if (a.role === 'owner') return { ...a, added: false };
    if (a.status === 'none') {
      const role: MemberRole = a.share.linkAccess === 'approval' ? 'pending' : a.share.linkAccess;
      await this.db.run('INSERT OR IGNORE INTO shared_members (chart_id, user_id, role) VALUES (?, ?, ?)', id, userId, role);
      return { ...(await this.access(id, userId))!, added: true };
    }
    await this.db.run('UPDATE shared_members SET last_seen = CURRENT_TIMESTAMP WHERE chart_id = ? AND user_id = ?', id, userId);
    return { ...a, added: false };
  }

  /** The people list (owner excluded), most recent first; `online` is filled in by the caller. */
  async members(id: string, online: ReadonlySet<number> = new Set()): Promise<ShareMember[]> {
    const rows = await this.db.all<MemberRow[]>(
      `SELECT m.user_id, u.username, m.role, m.joined_at, m.last_seen FROM shared_members m JOIN users u ON u.id = m.user_id
       WHERE m.chart_id = ? ORDER BY m.joined_at DESC, u.username`, id);
    return rows.map((r) => ({ userId: r.user_id, username: r.username, role: r.role, joinedAt: r.joined_at, lastSeen: r.last_seen, online: online.has(r.user_id) }));
  }

  /** Owner sets someone's role (or removes them). False if they've never opened the link. */
  async setMember(id: string, userId: number, role: Exclude<MemberRole, 'pending'>): Promise<boolean> {
    return ((await this.db.run('UPDATE shared_members SET role = ? WHERE chart_id = ? AND user_id = ?', role, id, userId)).changes ?? 0) > 0;
  }

  async get(id: string): Promise<ShareInfo | null> {
    const r = await this.row(id);
    return r ? this.info(r) : null;
  }

  async countByOwner(ownerId: number): Promise<number> {
    return (await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM shared_charts WHERE owner_id = ?', ownerId))!.n;
  }

  async listByOwner(ownerId: number): Promise<ShareInfo[]> {
    const rows = await this.db.all<ShareRow[]>(
      `SELECT s.*, u.username AS owner_name FROM shared_charts s JOIN users u ON u.id = s.owner_id WHERE s.owner_id = ? ORDER BY s.updated_at DESC, s.created_at DESC`, ownerId);
    return rows.map((r) => this.info(r));
  }

  async create(ownerId: number, title: string, config: ShareConfig, drawings: Drawing[], linkAccess: LinkAccess = 'viewer'): Promise<ShareInfo> {
    const id = shareId();
    await this.db.run('INSERT INTO shared_charts (id, owner_id, title, config, view_key, edit_key, link_access) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, ownerId, title, JSON.stringify(config), legacyKey(), legacyKey(), linkAccess);
    for (const d of drawings.slice(0, DRAWING_LIMITS.perSymbol)) {
      await this.db.run('INSERT INTO shared_drawings (chart_id, id, data, v, n, deleted, updated_by) VALUES (?, ?, ?, 1, ?, 0, ?)',
        id, d.id, JSON.stringify(d), nonce(), ownerId);
    }
    return (await this.get(id))!;
  }

  async update(id: string, patch: { title?: string; locked?: boolean; linkAccess?: LinkAccess; config?: ShareConfig }): Promise<ShareInfo | null> {
    if (patch.linkAccess !== undefined) await this.db.run('UPDATE shared_charts SET link_access = ? WHERE id = ?', patch.linkAccess, id);
    if (patch.config !== undefined) await this.db.run('UPDATE shared_charts SET config = ? WHERE id = ?', JSON.stringify(patch.config), id);
    if (patch.title !== undefined) await this.db.run('UPDATE shared_charts SET title = ? WHERE id = ?', patch.title, id);
    if (patch.locked !== undefined) await this.db.run('UPDATE shared_charts SET locked = ? WHERE id = ?', patch.locked ? 1 : 0, id);
    await this.db.run('UPDATE shared_charts SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', id);
    return this.get(id);
  }

  async remove(id: string): Promise<boolean> {
    await this.db.run('DELETE FROM shared_drawings WHERE chart_id = ?', id);
    await this.db.run('DELETE FROM shared_members WHERE chart_id = ?', id);
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
