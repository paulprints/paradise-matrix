/**
 * Live collaboration hub: one WebSocket room per shared chart.
 *
 *   connect /api/live → send {type:'auth', token, share, key} within 5 s
 *   → welcome (you, peers, drawings, presenter, share)
 *   → ops / presence / present messages, relayed to the room
 *
 * The server is authoritative for drawings (SharesStore.apply, same merge rule
 * as clients). Roles come from the share: owner and editors can change
 * drawings unless the share is locked; viewers only watch. Key rotation, lock
 * and delete take effect on open connections immediately.
 *
 * Browsers can't set headers on a WebSocket, so the JWT travels in the first
 * message (never in the URL, which proxies log). Origins are checked on the
 * upgrade to block cross-site WebSocket hijacking. A ping every 25 s keeps
 * Cloudflare's idle timeout from closing quiet rooms and detects dead peers.
 */
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import { z } from 'zod';
import { LIVE_CLOSE, LIVE_OPS_BUDGET, type LiveServerMessage, type Peer, type PresenterView, type ShareInfo, type ShareRole } from '@paradise/contract';
import type { Config } from '../config.ts';
import type { UserStore } from '../auth/db.ts';
import { anchorSchema, liveOpSchema, presenterViewSchema } from '../schemas.ts';
import type { SharesStore } from './store.ts';

export const LIVE_PATH = '/api/live';
const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_MS = 25_000;
const MAX_PAYLOAD = 256 * 1024;
/** Edit budget: a bucket of 200 ops refilled over 10 s. Mirrored by the browser's outbox (LIVE_OPS_BUDGET). */
const OPS_PER_10S = LIVE_OPS_BUDGET.capacity;
const PRESENCE_PER_S = 30;
const PEER_COLORS = ['#e0896b', '#8fb3d9', '#cda64b', '#b48ead', '#86bba0', '#d08770', '#88c0d0', '#ebcb8b'];

const clientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string().min(10).max(2000), share: z.string().min(1).max(40), key: z.string().max(100).optional() }),
  z.object({ type: z.literal('ops'), ops: z.array(liveOpSchema).min(1).max(LIVE_OPS_BUDGET.perMessage) }),
  z.object({ type: z.literal('presence'), cursor: anchorSchema.nullable(), view: presenterViewSchema.optional() }),
  z.object({ type: z.literal('present'), on: z.boolean() }),
  z.object({ type: z.literal('ping') }),
]);

interface Conn {
  ws: WebSocket;
  alive: boolean;
  peer?: Peer;
  shareId?: string;
  key?: string;
  opsBudget: { tokens: number; at: number };
  /** Messages from one connection are handled strictly in order. */
  inbox: Promise<void>;
  presence: { count: number; second: number };
}

interface Room { conns: Set<Conn>; presenter: string | null }

export interface LiveDeps { config: Config; store: UserStore; shares: SharesStore }

export class LiveHub {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  private readonly rooms = new Map<string, Room>();
  private readonly conns = new Set<Conn>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: LiveDeps) {}

  attach(server: Server) {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname !== LIVE_PATH) { // this server has no other WebSocket endpoints; don't leave the socket hanging
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      const origin = req.headers.origin;
      if (origin && !this.deps.config.allowedOrigins.includes(origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
    });
    this.heartbeat = setInterval(() => {
      for (const c of this.conns) {
        if (!c.alive) { c.ws.terminate(); continue; }
        c.alive = false;
        c.ws.ping();
      }
    }, HEARTBEAT_MS);
    server.on('close', () => this.close());
  }

  close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const c of this.conns) c.ws.terminate();
    this.wss.close();
  }

  /** Room sizes, for health/debug. */
  stats() { return { rooms: this.rooms.size, connections: this.conns.size }; }

  private send(c: Conn, m: LiveServerMessage) { if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(m)); }
  private broadcast(shareId: string, m: LiveServerMessage, except?: Conn) {
    const data = JSON.stringify(m);
    for (const c of this.rooms.get(shareId)?.conns ?? []) if (c !== except && c.ws.readyState === c.ws.OPEN) c.ws.send(data);
  }

  private onConnection(ws: WebSocket) {
    const c: Conn = { ws, alive: true, inbox: Promise.resolve(), opsBudget: { tokens: OPS_PER_10S, at: Date.now() }, presence: { count: 0, second: 0 } };
    this.conns.add(c);
    const authTimer = setTimeout(() => { if (!c.peer) ws.close(LIVE_CLOSE.auth, 'sign-in required'); }, AUTH_TIMEOUT_MS);
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', (raw: RawData) => {
      c.inbox = c.inbox.then(() => this.onMessage(c, raw)).catch((e) => { console.error('[live]', e); this.send(c, { type: 'error', message: 'internal error' }); });
    });
    ws.on('close', () => { clearTimeout(authTimer); this.leave(c); this.conns.delete(c); });
    ws.on('error', () => ws.terminate());
  }

  private async onMessage(c: Conn, raw: RawData) {
    c.alive = true;
    let msg: z.infer<typeof clientMessage>;
    try {
      const parsed = clientMessage.safeParse(JSON.parse(raw.toString()));
      if (!parsed.success) return this.send(c, { type: 'error', message: parsed.error.issues[0]?.message ?? 'invalid message' });
      msg = parsed.data;
    } catch {
      return this.send(c, { type: 'error', message: 'malformed message' });
    }
    if (msg.type === 'ping') return this.send(c, { type: 'pong' });
    if (msg.type === 'auth') return this.auth(c, msg.token, msg.share, msg.key);
    if (!c.peer || !c.shareId) return c.ws.close(LIVE_CLOSE.auth, 'sign-in required');

    if (msg.type === 'ops') {
      const access = await this.deps.shares.access(c.shareId, c.peer.userId, c.key);
      if (!access) return c.ws.close(LIVE_CLOSE.forbidden, 'access revoked');
      if (access.role === 'viewer' || access.share.locked) {
        const ids = [...new Set(msg.ops.map((o) => o.id))];
        return this.send(c, { type: 'reject', ops: await this.deps.shares.current(c.shareId, ids), reason: access.share.locked ? 'this chart is locked' : 'view-only link' });
      }
      if (!this.takeOps(c, msg.ops.length)) {
        // Refuse as a reject carrying the stored state, so the sender rolls back instead of drifting.
        return this.send(c, { type: 'reject', ops: await this.deps.shares.current(c.shareId, [...new Set(msg.ops.map((o) => o.id))]), reason: 'too many changes at once — slow down' });
      }
      const r = await this.deps.shares.apply(c.shareId, c.peer.userId, msg.ops);
      if (r.accepted.length) this.broadcast(c.shareId, { type: 'ops', by: c.peer.id, ops: r.accepted }, c);
      if (r.rejected.length) this.send(c, { type: 'reject', ops: r.rejected, reason: r.reason ?? 'rejected' });
      return;
    }
    if (msg.type === 'presence') {
      const sec = Math.floor(Date.now() / 1000);
      if (c.presence.second !== sec) c.presence = { count: 0, second: sec };
      if (++c.presence.count > PRESENCE_PER_S) return; // silently drop excess cursor updates
      return this.broadcast(c.shareId, { type: 'presence', from: c.peer.id, cursor: msg.cursor, ...(msg.view ? { view: msg.view as PresenterView } : {}) }, c);
    }
    if (msg.type === 'present') {
      const room = this.rooms.get(c.shareId)!;
      if (msg.on) room.presenter = c.peer.id;
      else if (room.presenter === c.peer.id) room.presenter = null;
      else return;
      return this.broadcast(c.shareId, { type: 'present', presenter: room.presenter });
    }
  }

  private takeOps(c: Conn, n: number): boolean {
    const now = Date.now(), b = c.opsBudget;
    b.tokens = Math.min(OPS_PER_10S, b.tokens + ((now - b.at) / LIVE_OPS_BUDGET.windowMs) * OPS_PER_10S);
    b.at = now;
    if (b.tokens < n) return false;
    b.tokens -= n;
    return true;
  }

  private async auth(c: Conn, token: string, shareId: string, key?: string) {
    if (c.peer) return this.send(c, { type: 'error', message: 'already signed in' });
    let userId: number;
    try { userId = Number((jwt.verify(token, this.deps.config.jwtSecret) as jwt.JwtPayload).sub); }
    catch { return c.ws.close(LIVE_CLOSE.auth, 'session expired'); }
    const user = await this.deps.store.byId(userId);
    if (!user) return c.ws.close(LIVE_CLOSE.auth, 'account no longer exists');
    const access = await this.deps.shares.access(shareId, userId, key);
    if (!access) return c.ws.close(LIVE_CLOSE.gone, 'shared chart not found');
    c.peer = { id: randomBytes(6).toString('hex'), userId, username: user.username, role: access.role, color: PEER_COLORS[userId % PEER_COLORS.length]! };
    c.shareId = shareId;
    c.key = key;
    let room = this.rooms.get(shareId);
    if (!room) this.rooms.set(shareId, (room = { conns: new Set(), presenter: null }));
    const peers = [...room.conns].map((x) => x.peer!).filter(Boolean);
    room.conns.add(c);
    this.send(c, { type: 'welcome', you: c.peer, peers, drawings: await this.deps.shares.drawings(shareId), presenter: room.presenter, share: access.share });
    this.broadcast(shareId, { type: 'peer', event: 'join', peer: c.peer }, c);
  }

  private leave(c: Conn) {
    if (!c.shareId || !c.peer) return;
    const room = this.rooms.get(c.shareId);
    if (!room || !room.conns.delete(c)) return;
    this.broadcast(c.shareId, { type: 'peer', event: 'leave', peer: c.peer });
    if (room.presenter === c.peer.id) { room.presenter = null; this.broadcast(c.shareId, { type: 'present', presenter: null }); }
    if (!room.conns.size) this.rooms.delete(c.shareId);
  }

  /**
   * Re-check every connection to a share after the owner changes it: rotated keys
   * disconnect old links, role changes take effect, everyone gets the new share info.
   */
  async refresh(shareId: string) {
    const room = this.rooms.get(shareId);
    if (!room) return;
    for (const c of [...room.conns]) {
      const access = await this.deps.shares.access(shareId, c.peer!.userId, c.key);
      if (!access) { c.ws.close(LIVE_CLOSE.forbidden, 'access revoked'); continue; }
      c.peer = { ...c.peer!, role: access.role as ShareRole };
      this.send(c, { type: 'share', share: access.role === 'owner' ? access.share : stripKeys(access.share) });
    }
  }

  /** The share was deleted: close its room. */
  closeShare(shareId: string) {
    for (const c of [...(this.rooms.get(shareId)?.conns ?? [])]) c.ws.close(LIVE_CLOSE.gone, 'shared chart deleted');
  }
}

const stripKeys = (s: ShareInfo): ShareInfo => { const { viewKey: _v, editKey: _e, ...rest } = s; return rest; };
