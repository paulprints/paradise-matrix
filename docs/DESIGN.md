# Design

Why the system is shaped the way it is. The 2026-09-23 audit is the source of truth for level arithmetic; this file explains how the product is built around it.

## The problem with v1

v1 merged three layers the audit insists stay separate. Measured against the audit's own NinjaTrader captures:

| | v1 result |
|---|---|
| Envelope Top/Bottom, 1-1 High/Low | 927/927 correct |
| PLDot displayed | **1/927** correct (the right value existed internally as "livePlDot" but was never shown) |
| 5/6 lines matching any vendor value | **2/4,767**, and 78% collapsed onto PLDot or the prior high/low |
| Strongest heat row | landed on the *wrong* PLDot every time (MNQ: ~97 points off) |

Other v1 problems: no data contract (dividend-adjusted vs raw prices depending on source; forming bars treated as complete; Weekly/Monthly always "stale"), lookback counted in bars per timeframe (T-5 Daily rewound Monthly by 5 *months*), heat width tied to tick size, heat normalised to its own max (so "Terminal" always existed), reversal language the audit says nothing supports.

## Principles

1. **One noun.** `Level` carries price, availability state, timeframe, source bar, display bar, displacement and provenance. Heat, ladder, facts and inspector are all functions of `Level[]`.
2. **The engine is a table.** The 31 formulas live in one declarative array mirroring `research_candidates.py`. Availability uses the audit's rule: any margin < −1e-8 → inactive, any |margin| ≤ 1e-8 → boundary, else active. Inactive and boundary levels have no price.
3. **Source ≠ display.** `source_index = display_index − displacement`. Normal displacement is +1; 0 is explicit. Moving the drawing never changes the arithmetic.
4. **The data edge owns time.** Providers return raw rows. `bars.ts` aligns them to exchange periods and decides completeness against an exchange calendar. The engine is told which bar is confirmed and never guesses. Calendar errors are conservative: an unknown early close marks a bar complete *later*, never earlier.
5. **One provider per response.** If any timeframe fails, the whole set moves to the next provider. Prices from different adjustment policies never meet.
6. **Confirmed by default, developing on request.** Confirmed levels come from the last complete bar and don't move all session. Developing levels come from the forming bar, are drawn dashed, and are disabled in lookback (they would leak the future).
7. **Lookback is a moment in time.** `asOf` is an instant; every timeframe uses the last bar complete at that instant.
8. **Market Profile is its own source.** TPO POC/VAH/VAL for the prior completed D/W/M period, built from 30-minute bars, labelled separately, never merged into a Drummond line.
9. **Heat is presentation and is honest.** Kernel width = 0.3 × the finest frame's average range (never tick size). Weights M 3 / W 2 / D 1 / 1H 0.75 / 30m 0.6 / 15m 0.5; developing ×0.5. Fixed scale: three coincident levels of the heaviest frame in view fill it. Every band lists its contributors. Zone names (Terminal/Friction/Transit/Void) describe confluence only.
10. **Facts, not forecasts.** v1's market type, R-vals and structure were undefined or buggy. v2 shows only derived facts: location among the structure levels, pivot direction run, consecutive closes vs the pivot drawn on their bar. Trend/congestion/exhaustion return only with written rules and outcome tests (audit step 7).
11. **Naming at one edge.** The engine keeps exact vendor keys for traceability; `apps/server/src/labels.ts` is the only place public names exist. A test fails if a vendor name reaches a response.

## The chart (v2.1)

How TradingView renders, as seen in its open-source engine, Lightweight Charts:
- Everything is painted on `<canvas>`, at device-pixel resolution, so 1px lines stay crisp.
- Time is a bar index. Bars are evenly spaced and gaps (nights, weekends) collapse. Zoom and scroll are just a bar spacing and an offset.
- Plugins ("primitives") draw at three depths (`bottom`, `normal`, `top`), in CSS-pixel or bitmap-pixel space. They can add axis labels and report what's under the cursor.

We build on Lightweight Charts 5.2.1 (Apache-2.0, see NOTICE) instead of re-implementing scales, pan and zoom, and the crosshair. Our own work is three primitives and the data model:

| Layer | Depth | What it draws |
|---|---|---|
| `HeatLayer` | bottom | Halftone heat. One dot column per bar, thinned so dots stay about 7px apart. Each column uses the levels valid at that bar's time (a sweep-built timeline of constant intervals). Dots are batched into 8 radius buckets, so a frame is 8 fills. |
| `LevelsLayer` | bottom + top | Each level as a step across exactly its validity window. Width encodes timeframe (M thickest), colour encodes group, dashes mark developing levels, dots mark profile. Current levels get collision-free labels in a reserved gutter right of the newest bar. |
| `DrawingsLayer` | top | Member drawings with hit-testing (cursor feedback through the library's `hitTest`) and selection handles. |

Two library behaviours we work around (observed on 5.2.1, and covered by tests):
- `logicalToCoordinate` converts only whole indexes. Fractional values return 0, and `coordinateToLogical` rounds. `chart/coords.ts` interpolates between neighbouring bars. Segment windows begin and end between bars, so without this every line collapsed to the left edge.
- `rightOffsetPixels` is accepted but not applied, so the label gutter is set as a bar count at load.

Measured: zoom frames render within one display refresh (about 35 ms across 2 animation frames at 60 Hz, with 1,000 candles and about 3,800 level segments). The Ladder view remains for a quick single-column read.

## What was deliberately removed

Market type/R-vals/structure, the tutorial and scenario trainer (they taught "Terminal = high probability reversal"), the price alert, Single vs Cumulative modes (now: choose one or more timeframes), the virtual-scroll grid (the ladder fits the screen; zoom changes span), Tailwind, frontend tick guessing, and v1's request-time logging of password hashes.

## Decisions taken (revisit freely)

| Decision | Choice | Why / how to change |
|---|---|---|
| Engine home | This repo, golden-tested against the audit fixtures | If the receiver's shared engine (PR #62) becomes canonical, both must run `packages/engine/test/golden.test.ts` in CI |
| Heat location | Browser (`apps/web/src/lib/heat.ts`) | Level prices already reach the browser; kernel is presentation. Formulas stay server-side |
| Heat weights | Tiered by timeframe, all families equal | One table: `TF_WEIGHT` |
| Default visibility | Structure + bar range; terminations and profile opt-in | Options menu, persisted in the URL |
| Public labels | Neutral placeholders (Pivot, Upper Band, T5-1 S…) | Review against Paradise naming rules in `labels.ts` |

## Open items carried from the audit

- Near/Far R/S (8 plots) remain unknown; not implemented.
- MNQ Sep18 anomalies at indices 337–341 remain unresolved in the audit; exact-parity is not claimed.
- Exact vendor equality behaviour is unresolved; equality-sensitive values are exposed as `boundary` with no price.
- Live, tick-atomic parity is uncertified (zero certified live observations).
- The CME calendar is approximate (Globex early halts not modelled). The response says so.
