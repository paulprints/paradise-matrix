# Rules for anyone (human or AI) changing this repo

1. **`packages/engine` is server-only.** Never import it from `apps/web`; a test enforces this. It holds the audited formulas.
2. **The golden suite is the spec.** `packages/engine/test/golden.test.ts` must pass unmodified. Don't change formulas, tolerances or availability rules to make a feature work. New formulas need captured vendor evidence added to `fixtures/` first.
3. **Never round internally.** Prices are full precision until the display formatter.
4. **Never fabricate a level.** Inactive and boundary levels have `price: null`. Too little history means no levels plus a warning, never zeros.
5. **Never guess time.** Completeness comes from `apps/server/src/data/calendar.ts`. If a date can't be named, return null.
6. **One provider per response.** Don't merge timeframes from different providers.
7. **Names live in `apps/server/src/labels.ts` only.** Vendor plot names must never reach a response (tested).
8. **Facts, not forecasts.** Don't add trend/exhaustion/reversal claims without written rules and outcome tests.
9. **Chart coordinates go through `apps/web/src/chart/coords.ts`.** The charting library converts only whole bar indexes. Never call `logicalToCoordinate` with a fractional value.
10. Keep the Lightweight Charts attribution logo on (licence requirement; see NOTICE).
11. **Shared drawings converge by one rule: `stampWins` in `packages/contract`.** Server and browser must both use it; never add a second merge rule. Every edit bumps `v`; deletes are tombstones. `SharesStore.apply` is serialized per chart. Keep it that way.
12. **Live auth goes in the first message, never the URL**, and the upgrade checks `Origin`. Owner actions that change access must call `LiveHub.refresh` / `closeShare` so open connections follow.
13. Run `npm run check` before committing.

Map: `packages/contract` (API types, `stampWins`) → `packages/engine` (formulas.ts table, frame.ts source/display, profile.ts TPO) → `apps/server` (data/: providers, bars, calendar, instruments, market cache; levels.ts orchestration; app.ts routes; auth/) → `apps/web` (lib/heat.ts presentation; chart/: state.ts merge and timeline, time.ts time↔index, coords.ts, heatLayer/levelsLayer canvas primitives, ChartView.tsx; drawings/: geometry, layer, useDrawings; components/Ladder.tsx). Server chart history: `apps/server/src/chart.ts`. Shared charts: `apps/server/src/shares/` (store.ts persistence + apply, live.ts WebSocket rooms, routes.ts REST) → `apps/web/src/share/` (doc.ts versioned copy, live.ts reconnecting socket, outbox.ts pacing, useShare.ts session, usePresence.ts cursors/presenting) and `chart/presenceLayer.ts`.
