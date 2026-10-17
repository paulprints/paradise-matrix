# Contract

## API

All routes except `/health` and `/api/auth/login` require `Authorization: Bearer <token>`. Types: `packages/contract/src/index.ts`.

| Method | Path | Body / query | Result |
|---|---|---|---|
| GET | `/health` | | `{status, providers}` |
| POST | `/api/auth/login` | `{username, password}` | `{token, user}` (10 failures / 15 min / IP) |
| GET | `/api/auth/me` | | `{user}` |
| POST | `/api/levels` | `LevelsRequest` | `LevelsResponse` (ladder: current levels) |
| POST | `/api/chart` | `ChartRequest` | `ChartResponse` (candles + level history) |
| GET | `/api/drawings` | `?symbol` | `DrawingsResponse` (yours, for that instrument) |
| PUT | `/api/drawings` | `{symbol, drawings}` | `DrawingsResponse` (replaces the set) |
| POST | `/api/shares` | `{title, config: ShareConfig, drawings, linkAccess?}` | 201 `{share}` (200 per owner) |
| GET | `/api/shares` | | `{shares}` (yours) |
| GET | `/api/shares/:id` | | `ShareOpenResponse` `{share, role, drawings}`. First visit adds you to the people list. 403 `{error, details: ShareDenied}` while waiting or if removed; 404 if no such share |
| PATCH | `/api/shares/:id` | `{title?, locked?, linkAccess?, config?}` | `{share}`; owner only (404 otherwise) |
| DELETE | `/api/shares/:id` | | 204; owner only; closes the live room |
| GET | `/api/shares/:id/members` | | `{members: ShareMember[]}`; owner only |
| PATCH | `/api/shares/:id/members/:userId` | `{role: 'viewer'\|'editor'\|'removed'}` | `{members}`; owner only; open tabs follow at once |
| POST | `/api/shares/:id/copy` | | `{copied, skipped, symbol}`: appends the drawings to yours, new ids, within the 500 limit |
| WS | `/api/live` | see *Live collaboration* | |
| GET | `/api/admin/users` | | `{users}` |
| POST | `/api/admin/users` | `{username, password, isAdmin?}` | 201 `{user}` |
| PATCH | `/api/admin/users/:id` | `{password?, isAdmin?}` | `{user}` |
| DELETE | `/api/admin/users/:id` | | 204 |
| GET | `/api/admin/login-history` | `?username&limit` | `{entries}` |

Errors: `{error, details?}` with 400 (input, unknown symbol, future asOf), 401, 403, 404, 503 (all providers failed; `details` lists each attempt).

### `LevelsRequest`
```jsonc
{ "symbol": "QQQ",               // QQQ, BRK.B, NQ, /ES, NQ=F, NQZ26, NQZ26.CME, "MNQ 12-26"
  "timeframes": ["M","W","D"],   // one = single view, several = stacked
  "displacement": 1,             // 1 normal, or 0
  "asOf": null,                  // ISO instant; send an anchor's `end` to step back
  "developing": false,           // live only
  "profile": false }             // adds Market Profile for requested D/W/M frames
```

### `Level`
| Field | Meaning |
|---|---|
| `id` | `${tf}:${basis}:${slug}`, unique per response |
| `slug`, `label`, `group`, `family`, `side` | Public naming (see `labels.ts`). `side` is the vendor Buy/Sell family label, **not** an entry instruction |
| `state` | `active` (price set), `inactive`, `boundary` (within 1e-8 of an equality; vendor behaviour unresolved) |
| `price` | Full precision; null unless active. Round only for display |
| `basis` | `confirmed` (source bar complete) or `developing` (forming bar) |
| `source` | Bar the arithmetic used: `{time, label, complete}` |
| `display` | Bar the level is drawn on (`source + displacement`). `label/time` null when the calendar can't name it honestly |
| `provenance` | `dg-candidate@20260923-v1`, or `profile-tpo@1 row=<size>` |

### `ChartRequest` / `ChartResponse`
```jsonc
{ "symbol": "QQQ", "chartTf": "5m", "overlays": ["D", "15m"], "displacement": 1,
  "developing": false, "profile": false,
  "bars": 1000,          // most recent chart bars (50–5000); level history covers the same window
  "since": 1788973200 }  // optional: incremental update
```
The response carries `bars` (`{t,o,h,l,c,v,complete}`), `keys` (level descriptions) and `segments`. Each segment is a tuple
`[keyIndex, tf, price, from, to, basis, source]`: one level on one display bar, valid from `from` to `to` (unix seconds, that bar's window), computed from the bar starting at `source`. `basis` is 0 for confirmed and 1 for developing. With +1 displacement, a 15m bar's levels are valid for the next 15m bar. They stay in the history after the next bar's levels replace them.

**Incremental updates.** With `since`, only bars with `t ≥ since` and segments whose window ends after `since` are returned. The client keeps everything else, because a segment that ended before `since` never changes. A test proves the merged result equals a full load. The web app polls with `since` = start of its newest bar, every 5 s (1m) up to 2 min (W/M).

**Drawings** are stored per member and per *resolved* instrument (`NQ`, `/NQ` and `NQ=F` share). Kinds: `trend` (optional right extension), `hline`, `vline`, `rect`, `text` (≤200 chars), `brush` (≤2000 points). Each has an `id` and a colour (`paper`, `ink`, `seal`, `alert`, `sky`). Limit: 500 per instrument. Anchors are `{t: unix seconds, p: price}`.

## Shared charts

A share is one instrument (`config.symbol` never changes, even when the owner saves a new starting view), a starting view, one link (`/c/<id>`), a people list and a set of versioned drawings. Members must be signed in.

Access is the people list, managed by the owner like the members admin page. Opening the link the first time adds you with the share's `linkAccess`: `viewer` (default), `editor`, or `approval` (you're `pending` until the owner lets you in; the waiting page re-checks every 3 s). The owner can set anyone to viewer or editor, or `removed`. Removed people stay listed, so the link doesn't let them back in until the owner restores them. Changing `linkAccess` affects newcomers only. A locked share is read-only for everyone, owner included. Links from the two-link version (`?k=…`) still open; the key is ignored.

### Live collaboration (`/api/live`)

WebSocket, JSON messages (`LiveClientMessage` / `LiveServerMessage`).

1. Connect, then send `{type:'auth', token, share}` within 5 s. The token goes in the message, never the URL (proxies log URLs). Browsers' `Origin` must be in `ALLOWED_ORIGINS`.
2. Server answers `welcome {you, peers, drawings, presenter, share}`, and tells the room `peer {event:'join'}`.
3. Then:

| Client → server | Server → others | Server → sender |
|---|---|---|
| `ops {ops: LiveOp[]}` (≤100) | `ops {by, ops}` (accepted only) | `reject {ops, reason}`: the stored state of every refused op |
| `presence {cursor, view?}` (≤30/s; extras dropped) | `presence {from, cursor, view?}` | |
| `present {on}` | `present {presenter}` (everyone, sender included) | |
| `ping` | | `pong` |

Owner changes arrive as `share {share, role}` (your role included, so a promotion or demotion applies without reloading); other members' role changes as `peer {event:'update'}`. The owner's tabs also get `members {members}` whenever someone joins, asks to join, comes online or leaves, or has their access changed. Close codes: `4401` sign-in required or expired, `4403` removed or still waiting, `4404` share not found or deleted (clients don't retry these); anything else, reconnect with backoff. The server pings every 25 s.

**Convergence.** Each drawing carries `v` (bumped on every edit) and `n` (random). `stampWins` in the contract decides between two states: higher `v` wins, equal `v` → lower `n`. Deletes are tombstones (`del`), so a late copy can't resurrect a drawing. The server applies ops one chart at a time, in order, and stores only winners. Not acknowledging accepted ops is deliberate: after reconnecting, the client resends whatever still beats the server's copy, and the server rejects the rest with its state.

**Limits.** 500 live drawings per chart, 100 ops per message, an edit budget of 200 ops per 10 s per connection (`LIVE_OPS_BUDGET`; over-budget ops are rejected with the stored state, and the browser paces itself to stay under it), 256 KB per message.

## Time

- **Bar times** are period starts (UTC ISO). **Labels** are exchange-local: `2026-09-08` (D), `wk 2026-09-07` (W, Monday), `2026-09` (M), `2026-09-08 10:30` (intraday).
- **Completeness:** a bar is complete when `now ≥ period end + grace`. The grace is 15 min for D/W/M (feeds settle late), and `min(60 s, span/4)` intraday, so 15 s for 1m and 60 s otherwise. A flat 15-minute grace would hold a 5m chart three bars behind. Period end = session close (D), last trading session's close (W/M), or `min(start + interval, session close)` intraday.
- **Calendars:** `XNYS` (exact: NYSE holidays and 1 pm early closes, 2024–2027) for equities; `CME-EQUITY` (approximate: Globex 17:00–16:00 CT, NYSE holidays as non-trading, early halts not modelled) for futures. Outside the tabulated years only weekday rules apply, and the response warns.
- **as-of:** bars that start after `asOf` are dropped; each frame uses the last bar complete at `asOf`; developing is off. `anchors[i].end` is exactly the instant at which bar `i` became complete.

## Data

Providers return `{t, o, h, l, c, v}` rows. Adjustment: **split-adjusted, not dividend-adjusted** for every provider (Yahoo chart `quote` arrays; data-server `auto_adjust=False`). Futures are unadjusted; continuous `=F` symbols are Yahoo's front month, and specific contracts are available (`NQZ26`). Normalisation drops malformed or off-calendar rows (with a warning, never silently) and merges duplicate rows in one period, keeping the latest (Yahoo's trailing "live" weekly/monthly row).

**Yahoo's blank latest close.** After a session ends, Yahoo can publish the newest bar with open/high/low/volume but a blank close (observed 2026-10-16). When the response's session summary (`meta.regularMarketTime`) falls inside that exact bar, its `regularMarketPrice` becomes the close and the frame carries a warning saying so. Nothing else is ever filled in; any other incomplete row is dropped with a warning.

**Stale data.** For live Daily frames, if the newest complete bar is older than the calendar's last closed session, the frame's first warning reads `<provider> data is behind: newest complete daily bar is …, but the … session has closed`.

Timeframes: `1m` (Yahoo: 7 days), `5m` and `15m`/`30m` (60 days), `1H` (730 days), `D` (5 years), `W` (10 years), `M` (max). Intraday display bars that pass a session close roll into the next session's open, via the calendar.

Cache TTL: 1m 10 s, 5m 15 s, 15m 30 s, 30m 45 s, 1H 60 s, D 2 min, W 5 min, M 10 min; concurrent identical fetches share one request.

## Engine arithmetic

See `packages/engine/src/formulas.ts` (SECURE, server only) and `fixtures/audit-2026-09-23/AUDIT-README.md`. Any change to it must keep `packages/engine/test/golden.test.ts` passing unmodified.
