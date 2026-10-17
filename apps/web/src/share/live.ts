/**
 * One WebSocket to the live hub, kept open: signs in with the first message,
 * reconnects with capped exponential backoff (and at once when the browser
 * comes back online), and stops for good on close codes that mean "don't
 * retry" (signed out, link revoked, chart deleted).
 */
import { LIVE_CLOSE, type LiveClientMessage, type LiveServerMessage } from '@paradise/contract';

export type LiveStatus = 'connecting' | 'live' | 'offline' | 'ended';
export type EndReason = 'auth' | 'revoked' | 'gone';

export interface LiveOptions {
  url: string;
  auth: () => { token: string | null; share: string };
  onMessage: (m: LiveServerMessage) => void;
  onStatus: (s: LiveStatus, ended?: EndReason) => void;
  /** Injectable for tests. */
  WebSocket?: typeof WebSocket;
  random?: () => number;
}

export const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];
export const backoff = (attempt: number, random = Math.random) => {
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
  return Math.round(base * (0.75 + random() * 0.5)); // ±25% jitter so a restarted server isn't stampeded
};

export class LiveConnection {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly WS: typeof WebSocket;
  private readonly onlineNow = () => { if (!this.stopped && !this.ws) this.connect(true); };

  constructor(private readonly o: LiveOptions) {
    this.WS = o.WebSocket ?? WebSocket;
  }

  start() {
    this.stopped = false;
    if (typeof window !== 'undefined') window.addEventListener('online', this.onlineNow);
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onlineNow);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, 'bye');
  }

  /** Send if connected and signed in; otherwise drop (the doc resends what matters on rejoin). */
  send(m: LiveClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== this.WS.OPEN || !this.signedIn) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  }

  private signedIn = false;

  private connect(now = false) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (now) this.attempt = 0;
    this.o.onStatus('connecting');
    const ws = new this.WS(this.o.url);
    this.ws = ws;
    this.signedIn = false;
    ws.onopen = () => {
      const a = this.o.auth();
      if (!a.token) { this.end('auth'); this.ws = null; ws.close(1000); return; }
      ws.send(JSON.stringify({ type: 'auth', token: a.token, share: a.share } satisfies LiveClientMessage));
    };
    ws.onmessage = (e) => {
      let m: LiveServerMessage;
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.type === 'welcome') { this.signedIn = true; this.attempt = 0; this.o.onStatus('live'); }
      this.o.onMessage(m);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return; // superseded or stopped
      this.ws = null;
      this.signedIn = false;
      if (this.stopped) return;
      if (e.code === LIVE_CLOSE.auth) return this.end('auth');
      if (e.code === LIVE_CLOSE.forbidden) return this.end('revoked');
      if (e.code === LIVE_CLOSE.gone) return this.end('gone');
      this.o.onStatus('offline');
      this.timer = setTimeout(() => this.connect(), backoff(this.attempt++, this.o.random));
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private end(reason: EndReason) {
    this.stopped = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onlineNow);
    this.o.onStatus('ended', reason);
  }
}
