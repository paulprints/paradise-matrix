import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { User } from '@paradise/contract';
import { toPublic, type UserStore } from './db.ts';

export interface AuthedRequest extends Request { user?: User }

export function signToken(user: User, secret: string, expiresIn: string): string {
  return jwt.sign({ sub: String(user.id), username: user.username }, secret, { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] });
}

/**
 * Verifies the JWT, then re-reads the user so deleted users and admin changes
 * take effect immediately (one indexed SQLite lookup per request).
 */
export function requireAuth(store: UserStore, secret: string) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return void res.status(401).json({ error: 'Not signed in' });
    let id: number;
    try {
      const payload = jwt.verify(h.slice(7), secret) as jwt.JwtPayload;
      id = Number(payload.sub);
    } catch {
      return void res.status(401).json({ error: 'Session expired' });
    }
    const row = await store.byId(id);
    if (!row) return void res.status(401).json({ error: 'Account no longer exists' });
    const u = toPublic(row);
    req.user = { id: u.id, username: u.username, isAdmin: u.isAdmin };
    next();
  };
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user?.isAdmin) return void res.status(403).json({ error: 'Admin access required' });
  next();
}
