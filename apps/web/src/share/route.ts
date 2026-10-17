/** Shared-chart URLs, link building, and conversion between a share's config and the view. */
import type { ShareConfig } from '@paradise/contract';
import type { ViewState } from '../lib/view.ts';

export interface ShareRoute { id: string }

/** `/c/<id>` → route. (Links from the two-link version carry `?k=…`; it's ignored, the id is what matters.) */
export function parseShareRoute(pathname: string): ShareRoute | null {
  const m = /^\/c\/([0-9A-Za-z]{6,20})\/?$/.exec(pathname);
  return m ? { id: m[1]! } : null;
}

export const shareLink = (origin: string, id: string) => `${origin}/c/${id}`;

/** WebSocket endpoint: next to the API when it lives elsewhere, else this origin (Vite proxies it in dev). */
export function liveUrl(apiBase: string | undefined, loc: { protocol: string; host: string }): string {
  if (apiBase) {
    const u = new URL(apiBase.replace(/\/+$/, '') + '/api/live');
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return u.toString();
  }
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/api/live`;
}

export const configFromView = (v: ViewState): ShareConfig => ({
  symbol: v.symbol, chartTf: v.chartTf, timeframes: v.timeframes, displacement: v.displacement,
  developing: v.developing, profile: v.profile, heat: v.heat, heatStyle: v.heatStyle, groups: v.groups,
});

export const viewFromConfig = (c: ShareConfig): Partial<ViewState> => ({
  view: 'chart', asOf: null, symbol: c.symbol, chartTf: c.chartTf, timeframes: c.timeframes, displacement: c.displacement,
  developing: c.developing, profile: c.profile, heat: c.heat, heatStyle: c.heatStyle, groups: c.groups,
});
