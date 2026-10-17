# Paradise Matrix

The Printers Paradise level matrix, rebuilt around the 2026-09-23 formula audit.

One pipeline, one noun: **bars → levels → views**. Every pixel on screen traces to a level, and every level traces to the bar its arithmetic came from.

```
packages/contract   API types shared by server and web (no math)
packages/engine     SERVER-ONLY level arithmetic: the 31 audited formulas as one table, frames, Market Profile
apps/server         Express API: data contract, exchange calendar, instruments, cache, auth, /api/levels
apps/web            React app: canvas chart (candles over time-varying heat, levels as validity steps, live updates,
                    drawing tools) built on TradingView Lightweight Charts; ladder view; inspector; members admin
data-server         Python OHLC service (the "external" provider), fixed adjustment policy
fixtures/           The audit's raw NinjaTrader captures; the golden test suite runs against them
docs/               DESIGN (why), CONTRACT (what), MIGRATION (from v1)
```

## What's verified

`npm test` runs every suite: engine golden reproduction, data contract, chart history, drawings, auth and web logic. The ones that matter most:

- **Golden reproduction.** For all 7 native Daily/Weekly/Monthly captures, the engine reproduces the audit's per-plot results *exactly* — every price match, availability match and boundary-sensitive count in `dwm-results.json`, plus the README headline table (3,447 / 3,226 / 3,456 / 2,327 additional-plot matches, 0 mismatches).
- **Data Box parity through the API.** The audit's QQQ bars go through the real HTTP endpoint; the 31 confirmed levels for the display bar equal what NinjaTrader's Data Box showed on 2026-09-09 (Daily), wk 2026-07-20 (Weekly) and 2026-01 (Monthly), with +1 displacement.
- **No look-ahead.** An as-of request returns exactly what you'd get by truncating history at that bar.
- **Boundaries.** Vendor names never appear in API responses; web code can't import the engine.

## Quick start

```bash
npm install
cp apps/server/.env.example apps/server/.env      # dev works without editing
npm run users -w apps/server -- add yourname --admin
npm run dev                                       # API :3001, web :5173
```

Node 20.12+. Live data comes from Yahoo directly, or from `data-server/` if `EXTERNAL_DATA_URL` is set.

```bash
npm run check                          # typecheck + all tests + production builds
npm run verify:live -w apps/server     # on a machine that can reach Yahoo: live data contract check
```

`verify:live` compares Yahoo's QQQ daily closes with the NinjaTrader capture (it fails if prices are dividend-adjusted), checks Weekly/Monthly period alignment for an equity and a future, and runs a full live levels request. It couldn't run from the build sandbox, so run it once before deploying.

## Deploy

**API (Windows host, PM2), replacing the v1 backend**
```bash
git pull && npm ci && npm run build -w apps/server
# apps/server/.env (exactly ".env", not ".env.txt"): NODE_ENV=production, PORT, JWT_SECRET (32+ chars),
# DATABASE_PATH -> a copy of v1's app.db kept OUTSIDE the repo, DATA_PROVIDERS=yahoo
cd apps/server                     # PM2 uses this as the working directory, which is where .env is read
pm2 start dist/server.js --name paradise-v2
pm2 logs paradise-v2               # first line must be "[config] loaded …\.env"
pm2 save
```
**Web (Vercel):** import the repo, set *Root Directory* to `apps/web`, set `VITE_API_URL` to the API origin. `apps/web/vercel.json` handles install/build.

**Data server (optional):** `cd data-server && pip install -r requirements.txt && python server.py` (binds 127.0.0.1:8000; set `HOST=0.0.0.0` only behind a firewall, and `DATA_API_KEY` to require a key).

See [docs/MIGRATION.md](docs/MIGRATION.md) for moving existing users and switching traffic.
