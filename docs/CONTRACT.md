# Contract

## API

All routes except `/health` and `/api/auth/login` require `Authorization: Bearer <token>`. Types: `packages/contract/src/index.ts`.

| Method | Path | Body / query | Result |
|---|---|---|---|
| GET | `/health` | | `{status, providers}` |
| POST | `/api/auth/login` | `{username, password}` | `{token, user}` (10 failures / 15 min / IP) |
| GET | `/api/auth/me` | | `{user}` |
| POST | `/api/levels` | `LevelsRequest` | `LevelsResponse` |
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

## Time

- **Bar times** are period starts (UTC ISO). **Labels** are exchange-local: `2026-09-08` (D), `wk 2026-09-07` (W, Monday), `2026-09` (M), `2026-09-08 10:30` (intraday).
- **Completeness:** a bar is complete when `now ≥ period end + 15 min`. Period end = session close (D), last trading session's close (W/M), or `min(start + interval, session close)` intraday.
- **Calendars:** `XNYS` (exact: NYSE holidays and 1 pm early closes, 2024–2027) for equities; `CME-EQUITY` (approximate: Globex 17:00–16:00 CT, NYSE holidays as non-trading, early halts not modelled) for futures. Outside the tabulated years only weekday rules apply, and the response warns.
- **as-of:** bars that start after `asOf` are dropped; each frame uses the last bar complete at `asOf`; developing is off. `anchors[i].end` is exactly the instant at which bar `i` became complete.

## Data

Providers return `{t, o, h, l, c, v}` rows. Adjustment: **split-adjusted, not dividend-adjusted** for every provider (Yahoo chart `quote` arrays; data-server `auto_adjust=False`). Futures are unadjusted; continuous `=F` symbols are Yahoo's front month, and specific contracts are available (`NQZ26`). Normalisation drops malformed or off-calendar rows (with a warning) and merges duplicate rows in one period, keeping the latest (Yahoo's trailing "live" weekly/monthly row).

Cache TTL: 15m 30 s, 30m 45 s, 1H 60 s, D 2 min, W 5 min, M 10 min; concurrent identical fetches share one request.

## Engine arithmetic

See `packages/engine/src/formulas.ts` (SECURE, server only) and `fixtures/audit-2026-09-23/AUDIT-README.md`. Any change to it must keep `packages/engine/test/golden.test.ts` passing unmodified.
