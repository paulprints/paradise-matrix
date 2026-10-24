import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { loadConfig, ConfigError } from '../src/config.ts';
import { staticProvider } from '../src/data/providers.ts';
import { startServer } from './helpers.ts';

let s: Awaited<ReturnType<typeof startServer>>;
beforeEach(async () => { s = await startServer([staticProvider('none', {})], () => Date.now() / 1000); });
afterEach(async () => { await s.close(); });

const login = async (u: string, p: string) => s.call('POST', '/api/auth/login', { username: u, password: p });

describe('auth', () => {
  it('first user is admin; login returns a token; /me reflects the user', async () => {
    const admin = await s.store.create('Boss', 'password-123');
    expect(admin).toMatchObject({ username: 'boss', isAdmin: true });
    const r = await login('BOSS', 'password-123');
    expect(r.status).toBe(200);
    const me = await s.call('GET', '/api/auth/me', undefined, r.body.token);
    expect(me.body.user).toEqual({ id: admin.id, username: 'boss', isAdmin: true });
  });

  it('wrong password and unknown user give the same 401, and are recorded', async () => {
    await s.store.create('boss', 'password-123');
    const a = await login('boss', 'nope-nope');
    const b = await login('ghost', 'nope-nope');
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body).toEqual(b.body);
    expect((await s.store.loginHistory(undefined, 10)).filter((x: any) => x.login_status === 'failed')).toHaveLength(2);
  });

  it('accepts hashes written by the v1 backend (bcrypt, 12 rounds)', async () => {
    await s.store.create('legacy', 'placeholder-pw');
    const u = await s.store.byUsername('legacy');
    const v1Hash = bcrypt.hashSync('old-password', 12).replace(/^\$2a\$/, '$2b$'); // native bcrypt writes $2b$
    await (s.store as any).db.run('UPDATE users SET password_hash = ? WHERE id = ?', v1Hash, u!.id);
    expect((await login('legacy', 'old-password')).status).toBe(200);
  });

  it('protected routes need a valid token; deleted users lose access immediately', async () => {
    expect((await s.call('POST', '/api/levels', { symbol: 'QQQ', timeframes: ['D'] })).status).toBe(401);
    expect((await s.call('GET', '/api/auth/me', undefined, 'garbage')).status).toBe(401);
    await s.store.create('boss', 'password-123');
    const member = await s.store.create('member', 'password-456');
    const tok = (await login('member', 'password-456')).body.token;
    expect((await s.call('GET', '/api/auth/me', undefined, tok)).status).toBe(200);
    await s.store.remove(member.id);
    expect((await s.call('GET', '/api/auth/me', undefined, tok)).status).toBe(401);
  });

  it('a password reset signs out every earlier session', async () => {
    await s.store.create('boss', 'password-123');
    const member = await s.store.create('member', 'password-456');
    const adminTok = (await login('boss', 'password-123')).body.token;
    const old = (await login('member', 'password-456')).body.token;
    expect((await s.call('PATCH', `/api/admin/users/${member.id}`, { password: 'brand-new-pass' }, adminTok)).status).toBe(200);
    expect((await s.call('GET', '/api/auth/me', undefined, old)).status).toBe(401);
    const fresh = (await login('member', 'brand-new-pass')).body.token;
    expect((await s.call('GET', '/api/auth/me', undefined, fresh)).status).toBe(200);
    expect((await s.call('GET', '/api/auth/me', undefined, adminTok)).status).toBe(200); // others unaffected
  });

  it('admin routes: create, list, promote, reset, delete — with guard rails', async () => {
    const boss = await s.store.create('boss', 'password-123');
    await s.store.create('member', 'password-456');
    const adminTok = (await login('boss', 'password-123')).body.token;
    const memberTok = (await login('member', 'password-456')).body.token;

    expect((await s.call('GET', '/api/admin/users', undefined, memberTok)).status).toBe(403);
    const created = await s.call('POST', '/api/admin/users', { username: 'newbie', password: 'long-enough' }, adminTok);
    expect(created.status).toBe(201);
    expect(created.body.user.isAdmin).toBe(false);
    expect((await s.call('POST', '/api/admin/users', { username: 'newbie', password: 'long-enough' }, adminTok)).status).toBe(409);
    expect((await s.call('POST', '/api/admin/users', { username: 'x', password: 'short' }, adminTok)).status).toBe(400);

    const id = created.body.user.id;
    expect((await s.call('PATCH', `/api/admin/users/${id}`, { isAdmin: true }, adminTok)).body.user.isAdmin).toBe(true);
    expect((await s.call('PATCH', `/api/admin/users/${id}`, { password: 'another-long-one' }, adminTok)).status).toBe(200);
    expect((await login('newbie', 'another-long-one')).status).toBe(200);

    expect((await s.call('PATCH', `/api/admin/users/${boss.id}`, { isAdmin: false }, adminTok)).status).toBe(400);
    expect((await s.call('DELETE', `/api/admin/users/${boss.id}`, undefined, adminTok)).status).toBe(400);
    expect((await s.call('DELETE', `/api/admin/users/${id}`, undefined, adminTok)).status).toBe(204);
    expect((await s.call('GET', '/api/admin/users', undefined, adminTok)).body.users).toHaveLength(2);
    expect((await s.call('GET', '/api/admin/login-history?limit=5', undefined, adminTok)).body.entries.length).toBeGreaterThan(0);
  });

  it('health is public', async () => {
    expect((await s.call('GET', '/health')).body.status).toBe('ok');
  });
});

describe('config', () => {
  it('refuses to start in production without a strong JWT secret', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' })).toThrow(ConfigError);
    expect(loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32) }).jwtSecret).toHaveLength(32);
  });
  it('drops the external provider when no URL is configured', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).providers).toEqual(['yahoo']);
    expect(loadConfig({ NODE_ENV: 'test', EXTERNAL_DATA_URL: 'http://x:8000' }).providers).toEqual(['external', 'yahoo']);
    expect(() => loadConfig({ NODE_ENV: 'test', DATA_PROVIDERS: 'external' })).toThrow(ConfigError);
  });
});
