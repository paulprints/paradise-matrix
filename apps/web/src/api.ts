import type { ChartRequest, ChartResponse, Drawing, DrawingsResponse, LevelsRequest, LevelsResponse, LoginResponse, LinkAccess, MemberRole, ShareConfig, ShareInfo, ShareMember, ShareOpenResponse, User } from '@paradise/contract';

export const API_ORIGIN: string | undefined = import.meta.env.VITE_API_URL || undefined;
const BASE = `${(API_ORIGIN ?? '').replace(/\/+$/, '')}/api`;
const TOKEN_KEY = 'pp_token';

export const tokenStore = {
  get: (): string | null => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) { super(message); }
}

/** Fired when the server rejects the session; the app returns to sign-in. */
export const SESSION_EXPIRED = 'pp:session-expired';

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method, signal,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'Can’t reach the server. Check your connection and try again.');
  }
  if (res.status === 401 && path !== '/auth/login') {
    tokenStore.clear();
    window.dispatchEvent(new Event(SESSION_EXPIRED));
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.details);
  return data as T;
}

export const api = {
  async login(username: string, password: string): Promise<User> {
    const r = await request<LoginResponse>('POST', '/auth/login', { username, password });
    tokenStore.set(r.token);
    return r.user;
  },
  me: () => request<{ user: User }>('GET', '/auth/me').then((r) => r.user),
  logout: () => tokenStore.clear(),
  levels: (req: LevelsRequest, signal?: AbortSignal) => request<LevelsResponse>('POST', '/levels', req, signal),
  chart: (req: ChartRequest, signal?: AbortSignal) => request<ChartResponse>('POST', '/chart', req, signal),
  drawings: (symbol: string, signal?: AbortSignal) => request<DrawingsResponse>('GET', `/drawings?symbol=${encodeURIComponent(symbol)}`, undefined, signal),
  saveDrawings: (symbol: string, drawings: Drawing[]) => request<DrawingsResponse>('PUT', '/drawings', { symbol, drawings }),
  createShare: (title: string, config: ShareConfig, drawings: Drawing[], linkAccess: LinkAccess) => request<{ share: ShareInfo }>('POST', '/shares', { title, config, drawings, linkAccess }).then((r) => r.share),
  myShares: (signal?: AbortSignal) => request<{ shares: ShareInfo[] }>('GET', '/shares', undefined, signal).then((r) => r.shares),
  openShare: (id: string, signal?: AbortSignal) => request<ShareOpenResponse>('GET', `/shares/${encodeURIComponent(id)}`, undefined, signal),
  shareMembers: (id: string, signal?: AbortSignal) => request<{ members: ShareMember[] }>('GET', `/shares/${encodeURIComponent(id)}/members`, undefined, signal).then((r) => r.members),
  setShareMember: (id: string, userId: number, role: Exclude<MemberRole, 'pending'>) => request<{ members: ShareMember[] }>('PATCH', `/shares/${encodeURIComponent(id)}/members/${userId}`, { role }).then((r) => r.members),
  updateShare: (id: string, patch: { title?: string; locked?: boolean; linkAccess?: LinkAccess; config?: ShareConfig }) => request<{ share: ShareInfo }>('PATCH', `/shares/${encodeURIComponent(id)}`, patch).then((r) => r.share),
  deleteShare: (id: string) => request<void>('DELETE', `/shares/${encodeURIComponent(id)}`),
  copyShare: (id: string) => request<{ copied: number; skipped: number; symbol: string }>('POST', `/shares/${encodeURIComponent(id)}/copy`),
  users: () => request<{ users: Array<User & { createdAt: string }> }>('GET', '/admin/users').then((r) => r.users),
  createUser: (username: string, password: string, isAdmin: boolean) => request<{ user: User }>('POST', '/admin/users', { username, password, isAdmin }),
  updateUser: (id: number, patch: { password?: string; isAdmin?: boolean }) => request<{ user: User }>('PATCH', `/admin/users/${id}`, patch),
  deleteUser: (id: number) => request<void>('DELETE', `/admin/users/${id}`),
  loginHistory: (limit = 50) => request<{ entries: Array<Record<string, any>> }>('GET', `/admin/login-history?limit=${limit}`).then((r) => r.entries),
};
