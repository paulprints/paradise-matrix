import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { User } from '@paradise/contract';
import { toPublic, type UserRow, type UserStore } from './db.ts';

export interface AuthedRequest extends Request { user?: User }

/** A short fingerprint of the password hash: changing the password invalidates every token signed before. */
export const passwordVersion = (passwordHash: string) => createHash('sha256').update(passwordHash).digest('base64url').slice(0, 12);

export function signToken(user: User, passwordHash: string, secret: string, expiresIn: string): string {
  return jwt.sign({ sub: String(user.id), username: user.username, pv: passwordVersion(passwordHash) }, secret, { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] });
}

/** The user a token belongs to, or null if it's invalid, expired, the account is gone, or the password changed since. */
export async function tokenUser(store: UserStore, token: string, secret: string): Promise<UserRow | null> {
  let payload: jwt.JwtPayload;
  try { payload = jwt.verify(token, secret) as jwt.JwtPayload; } catch { return null; }
  const row = await store.byId(Number(payload.sub));
  return row && payload.pv === passwordVersion(row.password_hash) ? row : null;
}

/**
 * Verifies the JWT, then re-reads the user so deleted users, password resets
 * and admin changes take effect immediately (one indexed SQLite lookup per request).
 */
export function requireAuth(store: UserStore, secret: string) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return void res.status(401).json({ error: 'Not signed in' });
    const row = await tokenUser(store, h.slice(7), secret);
    if (!row) return void res.status(401).json({ error: 'Session expired' });
    const u = toPublic(row);
    req.user = { id: u.id, username: u.username, isAdmin: u.isAdmin };
    next();
  };
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user?.isAdmin) return void res.status(403).json({ error: 'Admin access required' });
  next();
}
