# Migrating from v1 (heatmap-matrix-frontend / heatmap-matrix-backend)

v2 is a separate deployment. Run it next to v1, check it, then switch.

## 1. Users carry over

The SQLite schema is unchanged and bcryptjs verifies v1's bcrypt hashes. Point `DATABASE_PATH` at a **copy** of v1's `data/app.db` while you test, then at the real file when you switch. Admin flags carry over. Existing sessions do not (new secret, new token format), so everyone signs in once.

## 2. Server environment

| v1 | v2 | Note |
|---|---|---|
| `JWT_SECRET` optional (fell back to a hard-coded string) | **required** in production, 32+ chars | the server refuses to start otherwise |
| `DATABASE_URL` | `DATABASE_PATH` (`DATABASE_URL` still read) | |
| `FRONTEND_URL` + hard-coded origins + any ngrok/loca.lt/trycloudflare origin | `ALLOWED_ORIGINS` (comma list) | tunnel wildcards removed |
| `EXTERNAL_DATA_URL` default `http://73.72.145.180:8000` | no default; set it to use the data server | |
| `GOOGLE_AI_API_KEY`, `@google/genai` | removed | unused |

## 3. Data server

Replace v1's `server.py` with `data-server/server.py`. Differences: `auto_adjust=False` (v1 dividend-adjusted stock prices), timestamps in seconds, no 300-row cap, binds `127.0.0.1` by default (v1: `0.0.0.0` with `CORS *`), optional `DATA_API_KEY`.

## 4. Frontend

New Vercel project (or repoint the old one): Root Directory `apps/web`, env `VITE_API_URL`. Views are shareable URLs (`?s=QQQ&tf=M,W,D…`).

## 5. What members will notice

- PLDot and the 5/6 lines now match NinjaTrader; v1's values were wrong (see DESIGN.md).
- Levels show their timeframe, source bar and the bar they apply to. Point at any heat band to see which levels make it up.
- "Cumulative" became "pick several timeframes". The T-n slider steps back through completed bars.
- No more reversal alerts or "Terminal = reversal" teaching. Heat measures overlap only.

## 6. Repo hygiene in the old frontend repo

It contains course PDFs, the new-concepts RTF and `drummond-legacy-backup.zip`. The audit's rule is no redistribution of vendor/course material. Remove them from the old repo and its history (`git filter-repo --path calculationlogic --path drummond-legacy-backup.zip --invert-paths`) before it's ever shared. None of that material is in this repo.
