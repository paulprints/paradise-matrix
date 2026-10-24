/**
 * User store. Schema is identical to the v1 backend, so DATABASE_PATH can point
 * at the existing app.db. bcryptjs verifies the existing bcrypt ($2b$) hashes.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import bcrypt from 'bcryptjs';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';

const ROUNDS = 12;
let dummyHash: string | null = null;
const dummy = () => (dummyHash ??= bcrypt.hashSync('timing-equaliser', ROUNDS));

export interface UserRow { id: number; username: string; password_hash: string; is_admin: number; created_at: string }
export interface PublicUser { id: number; username: string; isAdmin: boolean; createdAt: string }
export interface LoginRecord { username: string; userId?: number | null; ip?: string | null; userAgent?: string | null; ok: boolean; error?: string | null }

export const toPublic = (u: UserRow): PublicUser => ({ id: u.id, username: u.username, isAdmin: u.is_admin === 1, createdAt: u.created_at });

export class UserStore {
  private constructor(readonly db: Database) {}

  static async open(path: string): Promise<UserStore> {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const db = await open({ filename: path, driver: sqlite3.Database });
    await db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS login_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        login_status TEXT NOT NULL,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS drawings (
        user_id INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, symbol),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    const cols = await db.all<{ name: string }[]>(`PRAGMA table_info(users)`);
    if (!cols.some((c) => c.name === 'is_admin')) {
      await db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0; UPDATE users SET is_admin = 1 WHERE id = 1;');
    }
    return new UserStore(db);
  }

  close() { return this.db.close(); }

  async count(): Promise<number> {
    return (await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users'))!.n;
  }

  async byId(id: number): Promise<UserRow | null> {
    return (await this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', id)) ?? null;
  }

  async byUsername(username: string): Promise<UserRow | null> {
    return (await this.db.get<UserRow>('SELECT * FROM users WHERE username = ?', username.trim().toLowerCase())) ?? null;
  }

  async list(): Promise<PublicUser[]> {
    return (await this.db.all<UserRow[]>('SELECT * FROM users ORDER BY id')).map(toPublic);
  }

  /** The very first user becomes admin. */
  async create(username: string, password: string, isAdmin = false): Promise<PublicUser> {
    const first = (await this.count()) === 0;
    const hash = await bcrypt.hash(password, ROUNDS);
    const r = await this.db.run('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)', username.trim().toLowerCase(), hash, isAdmin || first ? 1 : 0);
    return toPublic((await this.byId(r.lastID!))!);
  }

  async update(id: number, patch: { password?: string; isAdmin?: boolean }): Promise<PublicUser | null> {
    if (patch.password !== undefined) await this.db.run('UPDATE users SET password_hash = ? WHERE id = ?', await bcrypt.hash(patch.password, ROUNDS), id);
    if (patch.isAdmin !== undefined) await this.db.run('UPDATE users SET is_admin = ? WHERE id = ?', patch.isAdmin ? 1 : 0, id);
    const u = await this.byId(id);
    return u ? toPublic(u) : null;
  }

  async remove(id: number): Promise<boolean> {
    return ((await this.db.run('DELETE FROM users WHERE id = ?', id)).changes ?? 0) > 0;
  }

  async adminCount(): Promise<number> {
    return (await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1'))!.n;
  }

  /** Constant-ish time: always runs one bcrypt compare, even for unknown users. */
  async verify(username: string, password: string): Promise<UserRow | null> {
    const u = await this.byUsername(username);
    const ok = await bcrypt.compare(password, u?.password_hash ?? dummy());
    return u && ok ? u : null;
  }

  async getDrawings(userId: number, symbol: string): Promise<{ data: string; updatedAt: string } | null> {
    const r = await this.db.get<{ data: string; updated_at: string }>('SELECT data, updated_at FROM drawings WHERE user_id = ? AND symbol = ?', userId, symbol);
    return r ? { data: r.data, updatedAt: r.updated_at } : null;
  }

  /**
   * Save the whole set. With `base` (the updatedAt the caller loaded; null = nothing saved yet)
   * it only writes if nothing changed since, and returns null otherwise. Without it, it always writes.
   */
  async putDrawings(userId: number, symbol: string, data: string, base?: string | null): Promise<string | null> {
    // Millisecond stamps, so two saves within one second still differ.
    const NOW = `strftime('%Y-%m-%d %H:%M:%f', 'now')`;
    const r = base === undefined
      ? await this.db.run(`INSERT INTO drawings (user_id, symbol, data, updated_at) VALUES (?, ?, ?, ${NOW})
          ON CONFLICT(user_id, symbol) DO UPDATE SET data = excluded.data, updated_at = ${NOW}`, userId, symbol, data)
      : base === null
        ? await this.db.run(`INSERT INTO drawings (user_id, symbol, data, updated_at) VALUES (?, ?, ?, ${NOW}) ON CONFLICT(user_id, symbol) DO NOTHING`, userId, symbol, data)
        : await this.db.run(`UPDATE drawings SET data = ?, updated_at = ${NOW} WHERE user_id = ? AND symbol = ? AND updated_at = ?`, data, userId, symbol, base);
    if (!r.changes) return null;
    return (await this.getDrawings(userId, symbol))!.updatedAt;
  }

  async recordLogin(r: LoginRecord): Promise<void> {
    await this.db.run(
      'INSERT INTO login_history (user_id, username, ip_address, user_agent, login_status, error_message) VALUES (?, ?, ?, ?, ?, ?)',
      r.userId ?? null, r.username.slice(0, 100), r.ip ?? null, r.userAgent?.slice(0, 300) ?? null, r.ok ? 'success' : 'failed', r.error ?? null,
    );
  }

  async loginHistory(username: string | undefined, limit: number) {
    const lim = Math.max(1, Math.min(500, limit));
    return username
      ? this.db.all('SELECT * FROM login_history WHERE username = ? ORDER BY id DESC LIMIT ?', username.toLowerCase(), lim)
      : this.db.all('SELECT * FROM login_history ORDER BY id DESC LIMIT ?', lim);
  }
}
