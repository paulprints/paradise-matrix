# Paradise Drummond Core — formula and benchmark handoff

Research checkpoint: 23 September 2026. Private engineering handoff for the Market State agent.

## Outcome and Brett's decisions

The standalone research calculator now covers **31 numeric public plots**: the existing seven core/zone outputs plus **24 additional outputs**, including 1-1, Main Channel, 5-1, 5-2, 5-2 extensions, 5-3, 5-9 and extensions, and 6-1/6-5/6-6/6-7. The additional formulas were inferred from public NinjaTrader outputs, frozen, and then checked against separate saved data and new native Daily/Weekly/Monthly captures. They are research hypotheses with measured evidence, not recovered vendor source or an assertion of universal parity.

Brett explicitly wants Daily, Weekly, and Monthly key levels computed from OHLC, alongside Market Profile. **Keep MP.** Preserve source, timeframe, confirmation state, and provenance for each level. Buy/Sell are vendor plot labels, not automatic entry instructions.

Brett clarified twice that **normal displacement is +1**. The particular MNQ Daily benchmark chart intentionally had **0**. Both settings were confirmed in actual capture metadata; QQQ's indicator properties also showed 1. Do not change this into a calendar-day offset or silently assume all charts use the same setting.

The Python research calculation and display adapter are included. The extra 24 plots have **not** been integrated into the production receiver or TradingView Pine indicator by this checkpoint. No deployment, merge, production strategy activation, orders, or account changes were performed.

## Indexing and displacement: the critical contract

All arithmetic below is for **raw absolute source index n**, including that source bar's OHLC. The public recorder reads `Values[p].GetValueAt(n)` and `IsValidDataPointAt(n)` alongside `Bars.GetHigh/GetLow/GetClose(n)`. It does not read a visually displaced chart location as if it were the source index.

For a displayed bar with index **j** and indicator displacement **d**:

`source_index = j - d`; equivalently `display_index = source_index + d`.

At the normal +1 setting, the value drawn at today's native Daily bar is calculated through the preceding source bar. At 0, the same calculation is drawn at its own source bar. Moving the drawing does not alter the underlying OHLC arithmetic. On Weekly and Monthly charts this means one native week/month bar, not one day. Use actual series indices and session/calendar metadata across weekends and holidays.

Direct QQQ Data Box observations confirmed this mapping:

| Frame | Displayed bar label | Raw source label | Displacement | Raw fields matched | Independently calculated fields matched |
|---|---|---|---:|---:|---:|
| Daily | 2026-09-09 | 2026-09-08 | +1 | 39/39 | 31/31 |
| Weekly | 2026-07-24 | 2026-07-17 | +1 | 39/39 | 31/31 |
| Monthly | 2026-01-31 | 2025-12-31 | +1 | 39/39 | 31/31 |

The 39-field checks include `n/a`. They do **not** mean all 39 formulas are known. Eight near/far fields remain unresolved and were `n/a`. Monthly bar labels can be period-end dates beyond the wall-clock observation date; do not infer completion from the label alone.

Static/confirmed: use only source bars explicitly known to be complete. Developing: recalculate from a forming source bar, record its timestamp, and mark the result provisional. With normal +1 displacement, the forming raw bar projects to the next scheduled display bar. A complete future target timestamp requires the exchange/session calendar; the included adapter refuses to invent a missing display bar.

`display_levels.py` defaults to displacement 1 and requires an explicit `confirmed_through_index`. It returns both source and display timestamps. It calculates from OHLC without needing NinjaTrader plot values. It exposes inactive or boundary-sensitive line values as null; `display_value` alone is formatted to two decimals. No internal rounding to cents or ticks is introduced.

## Formula ledger

Definitions at raw source index n:

- H, L, C = high, low, close at n; H1/L1 = high/low at n−1.
- A_n = (H + L + C) / 3.
- P_n = (A_n + A_(n−1) + A_(n−2)) / 3.
- P1 = P_(n−1); P2 = P_(n−2).
- R = 2P_n − mean(L_n, L_(n−1), L_(n−2)).
- S = 2P_n − mean(H_n, H_(n−1), H_(n−2)).
- HH = 2H − H1; LL = 2L − L1; PH = 2P_n − H; PL = 2P_n − L.

The full family needs five source bars because P2 reaches n−4. Validation below excludes indices below 5 and the last two rows. This is a conservative benchmark selection, not a claim about the vendor's minimum startup requirement.

| Public plot | Unrounded candidate value | Availability hypothesis away from equality |
|---|---|---|
| Zone Six Top | 2R − S | Available after warmup |
| Zone Five Top | 2R − P_n | Available after warmup |
| Envelope Top | R | Available after warmup |
| PLDot | P_n | Available after warmup |
| Envelope Bottom | S | Available after warmup |
| Zone Two Bottom | 2S − P_n | Available after warmup |
| Zone One Bottom | 2S − R | Available after warmup |
| H 1-1 | 2A_n − L | Available after warmup |
| L 1-1 | 2A_n − H | Available after warmup |
| 1-1 Dot | A_n | Available after warmup |
| Main Channel | 2P1 − P2 | Available after warmup |
| 5-1 Sell | LL | LL > C |
| 5-1 Buy | HH | C > HH |
| 5-2 Sell | HH | H > H1 |
| 5-2 Buy | LL | L < L1 |
| 5-2 Ex Sell | 3H − 2H1 | H > H1 |
| 5-2 Ex Buy | 3L − 2L1 | L < L1 |
| 5-3 Sell | HH | H < H1 and HH > C |
| 5-3 Buy | LL | L > L1 and C > LL |
| 5-9 Sell | 2H − L1 | Available after warmup |
| 5-9 Buy | 2L − H1 | Available after warmup |
| 5-9 Ex Sell | 3H − 2L1 | Available after warmup |
| 5-9 Ex Buy | 3L − 2H1 | Available after warmup |
| 6-1 Sell | PL | H > P_n and PL > C |
| 6-1 Buy | PH | L < P_n and C > PH |
| 6-5 Sell | PH | H > P_n and PH > C |
| 6-5 Buy | PL | L < P_n and C > PL |
| 6-6 Sell | 3H − 2P2 | L < P2 < H |
| 6-6 Buy | 3L − 2P2 | L < P2 < H |
| 6-7 Sell | PL | H < P_n |
| 6-7 Buy | PH | L > P_n |

The Sell/Buy labels above are deliberately preserved exactly even where the arithmetic appears counterintuitive. Several families share a candidate price but have different availability conditions. Do not collapse these into one always-on line.

Availability was checked separately from price. Comparisons with a margin within 1e−8 of equality are marked **boundary_sensitive**, unless another necessary condition is clearly false. This is an audit uncertainty policy, **not** evidence that the vendor uses a 1e−8 epsilon. Binary floating-point arithmetic can change equality results; exact equality behavior remains unresolved. Use neither price rounding nor a fabricated zero to hide it.

## Evidence and benchmark results

Frozen candidate SHA-256: `855f5ac8d89d060eecf02530ccfeff071c6e6b3667da37cb534895ead2264c14`.

Price tolerance: absolute 1e−8, with Decimal precision 34 in the independent calculator. Test comparisons use full serialized values; the UI checks use the platform's two-decimal display. A match count is a count of available plot values, not trades, profits, or independent live ticks.

### Development data, Sep 18

These captures were used during formula/rule exploration, so they are not an untouched test set.

| Data | Additional-24 price matches / available | Availability mismatches | Equality-sensitive comparisons |
|---|---:|---:|---:|
| QQQ Weekly | 9,555 / 9,555 | 0 | 2 |
| QQQ 1-minute | 167,623 / 167,623 | 0 | 3,784 |
| MNQ 1-minute | 160,974 / 160,982 | 13 | 3,112 |

Preserved MNQ exceptions: H 1-1 and L 1-1 at index 337; Main Channel at 338–341; 6-7 Buy at 338–339. The 13 availability mismatches are recorded in `sep18-development-results.json`. Existing seven-component mismatches around 337–339 and earlier startup issues in the Sep18 audit remain unresolved. Do not overwrite those failures with the later passing results. The unstable capture `644c701c585f4f50ad78aec6b4188671` remains rejected.

### Frozen formulas against Sep 20–22 captures

Of 31 later historical captures, 26 passed the recorder's double-read/bar-count stability gates; five were rejected. Repeated captures frequently contain the same history. The deduplicated analysis therefore excludes exact Sep18 five-bar input windows and repeated later input windows.

| Distinct new input windows | Windows | Additional-24 price matches / available | Availability mismatches | Boundary-sensitive |
|---|---:|---:|---:|---:|
| MNQ 1-minute | 3,733 | 50,308 / 50,308 | 0 | 1,082 |
| QQQ 1-minute | 1,170 | 15,545 / 15,545 | 0 | 503 |
| QQQ Weekly | 1 | 15 / 15 | 0 | 0 |
| MNQ Weekly | 380 | 5,137 / 5,137 | 0 | 0 |
| Total | **5,284** | **71,005 / 71,005** | **0** | **1,585** |

There were 125,231 decisive availability matches. The analysis excluded 21,566 exact development overlaps and 87,538 repeated later windows. Identity includes symbol, timeframe, session, source timestamp, and five OHLC windows; serialized decimal strings were retained without normalization. See `distinct-input-results.json` and `audit_unique.py`. Reproduction of that full later-capture run requires the saved server captures and its `capture-inventory.json`; the compact handoff includes the result tables, not every repeated minute capture.

### Fresh native Daily / Weekly / Monthly captures, Sep 23

| Representative capture | Native bars | Displacement | Additional-24 price matches / available | Availability mismatches | Boundary-sensitive |
|---|---:|---:|---:|---:|---:|
| MNQ 12-26 Daily | 261 | 0 | 3,447 / 3,447 | 0 | 2 |
| QQQ Daily | 251 | +1 | 3,226 / 3,226 | 0 | 2 |
| QQQ Weekly | 262 | +1 | 3,456 / 3,456 | 0 | 0 |
| QQQ Monthly | 181 | +1 | 2,327 / 2,327 | 0 | 3 |

All seven original components also had zero price mismatches in these fresh captures. Duplicate MNQ Daily recorders and QQQ settings-on/off captures are preserved in the raw evidence but are **not** counted as independent observations. The fresh Weekly history substantially overlaps prior Weekly evidence. The two Daily series plus Monthly contribute 672 frame-distinct windows and 9,000 available additional-plot comparisons; these frames did not occur in the earlier 5,284-window test set.

The raw JSONL files, capture settings, timestamps, plot validity, two-pass stability flags, Data Box text, and per-plot results are in `dwm-evidence/`. All captured bars are native platform Day/Week/Month series. They were not synthesized from minute data. Futures contract merge settings, settlement/feed provenance, stock adjustment policy, and complete exchange-calendar fidelity still need an explicit production data contract.

No capture is certified as a tick-atomic live observation. The recorder reads public chart data in two passes and excludes the last two bars for these historical comparisons. `Realtime` indicator state by itself does not establish live parity or feed identity. Certified live observation count remains zero.

## Near/far, terminations, and concepts: what is known versus missing

The installed Classic Tools indicator exposes 39 plots. The unresolved eight are Near R Top/Bot, Near S Top/Bot, Far R Top/Bot, and Far S Top/Bot. These were invalid with the switches off. During this audit the **actual Near/Far and Five/Six switches were turned on** on the separate QQQ research chart and native Daily/Weekly/Monthly captures were taken. The eight near/far public series still had zero valid historical values in those captures. Therefore their region boundaries, internal selection/state rules, and whether alternative rendering paths carry them remain unknown. This result does not prove the vendor has no near/far calculation.

The 5/6-series candidate prices and observed availability rules are a concrete advance toward termination levels. A valid termination line is not proof of an exhausted move, completed reversal, trend confirmation, or an executable buy/sell setup. Those market-process rules need their own definitions and evidence.

The locally installed vendor documentation, revised 21 August 2021, describes classic lines, near/far areas, 5/2 and 5/9 extensions, dot refresh, Main Channel, 6/6 and 6/7, trend/congestion phases, Flow, walk-forward behavior, higher/lower timeframe coordination, and separate native Daily versus intraday data. It does not provide complete formulas or all activation rules. TradeStation/MultiCharts-specific settings and databases must not be presumed identical to this NinjaTrader package.

The official public Gold syllabus establishes further topics such as yes/no patterns, congestion entrance/action/exit, reversals, exhausts, block/dotted lines, and timeframe combinations. It advertises formula/course material, but the public syllabus is **not** access to that material. No complete private course or flashcard formula set was obtained. No unavailable concepts were filled in with guessed rules.

Useful next research measurements can include normalized PLDot slope, zone/envelope location, distance to active 1-1 and 5/6 levels, confirmed breaks versus rejections, excursion beyond a boundary followed by a close back inside, and higher-timeframe agreement. These are proposed engineering features until explicitly specified and benchmarked. A flat slope alone is not an established definition of congestion, and an extreme zone touch alone is not exhaustion.

## Installed-source provenance and inspection boundaries

- Server Windows user: paul. NinjaTrader 8.1.6.3 was previously recorded; this checkpoint directly read the installed indicator assembly metadata as DrummondNTSilverPackage 1.0.0.7.
- Vendor DLL SHA-256 rechecked in this audit: `c96aff37cbc874e547b4ccd5d278e5435c4bfdc5ced05d83fb635076a67fe1ad`.
- Original Sep18 raw archive SHA-256: `7af288f8e8662115dfed17173eb08a668ea42d4263ddf8ef6754ff212d414b0a`.
- Local documentation: `DG4 Professional Software Documentation.rtf` in the downloaded TradeStation Silver release ZIP. RTF SHA-256: `78bd3330e377d5c91b9e921ddff3fea22f1573852a44a13ebc3ef471148862a4`.
- The available exported C# wrappers/stubs expose public plot getters and settings but have empty protected calculation bodies. They are not usable source for the vendor engine. The protected DLL was not modified or bypassed. No vendor DLL or course files are redistributed in this handoff.
- Recorder reads public chart series and metadata only; historical feed identity remained unresolved in its metadata.
- Before chart work, 13 workspace XML files were copied to the server research folder's `workspace-backup-before-daily-audit/`.
- Two temporary Daily recorder instances were removed after collection, leaving that chart's three original vendor indicators. The separate QQQ research chart was restored to 1 Minute, Near/Far/FiveSix off, its existing recorder retained, and minimized. No displacement was changed. Workspace XML backups were not overwritten onto live charts.

## Receiver / TradingView integration handoff

Starting reference: [receiver PR #62](https://github.com/brettlaeraz-lang/paradise-market-state-receiver/pull/62), branch `feat/shared-drummond-core`, head inspected `56828a0af29085c04596e5cb5cdfe084ee31f8e7`. PR remained open/draft at inspection. Main inspected at `529612601debb9a98e61168685aa9e28c39a180e`. Read the current repository `docs/DRUMMOND.md` and `AGENTS.md` before integrating; recheck refs because these are a checkpoint, not a permanent current-head claim.

The existing shared engine already provides the seven core/zone values. Prior Pine work includes those values, slope classification, higher-timeframe Daily/Weekly overlays, and two-decimal presentation. These features must not be mistaken for delivery of the additional 24 plots. The local `receiver-validation` checkout was stale/detached with Pine edits; it was not used to overwrite current main.

Required implementation steps:

1. Port the frozen extra-24 arithmetic and explicit nullable availability states into the shared engine in an isolated branch. Preserve original seven-component tests and known failures. Keep equality-sensitive cases visible in diagnostics.
2. Add the source/display contract above, normal default +1, and an explicit 0 option. Source bar OHLC must drive arithmetic regardless of drawing offset. Include the supplied real Data Box checks as regression fixtures.
3. Supply native Daily, Weekly, Monthly OHLC with instrument, session, timezone, feed, adjustment/contract policy, source close state, source timestamp, and display period. Existing receiver coverage observed in docs is 1m/5m/15m/30m/1h/1D; Weekly/Monthly production transport was not connected here.
4. Preserve MP as its own level source. Combine nearby Drummond and MP levels only with clear provenance and tolerance rules; retain distinct labels and timeframe. Never substitute a Drummond line for a volume-profile-derived level.
5. Port only documented behavior into Pine; handle confirmed and developing higher-timeframe values explicitly, avoid future leak, distinguish source timeframe from display timeframe, and retain two-decimal formatting only at presentation.
6. Resolve MNQ historical anomalies, equality handling, startup behavior, and atomic live sampling before promoting an exact-parity flag. Additional symbols/contracts and native MNQ Monthly behavior still need broader coverage.
7. Define market-process confirmation separately from level calculation. Trend, exhaustion, congestion, acceptance/rejection, and trading entries need specified rules and outcome testing; this audit makes no profitability claim.

Public-facing Paradise content should retain the project's existing naming restrictions; this private audit uses the exact vendor labels for engineering traceability. No shared repository memory, public post, or message to another agent was published by this checkpoint. Relay this package or incorporate it through the authorized repository workflow.

## Reproduce the portable checks

Python standard library only, no network or NinjaTrader required for the included evidence:

```bash
python verify_display_alignment.py
python build_level_examples.py
python research_candidates.py dwm-evidence/raw/audit-c137807ce33941c68b4041437212a1f8.jsonl --output daily-recheck.json
```

`verify_display_alignment.py` checks 31 independent formula/availability outputs against each actual Daily/Weekly/Monthly Data Box observation. `display-adapter-checks.json` contains its successful run. `research_candidates.py` compares a capture's raw OHLC arithmetic and validity to its public output arrays. Startup/tail exclusions and rejected captures remain visible.

`historical-level-examples.json` contains independently calculated MNQ Daily and QQQ Daily/Weekly/Monthly examples, with the five source OHLC bars and both source/display timestamps. They are explicitly dated historical examples, not current prices. The normal +1 display date differs from the original MNQ chart's 0-displacement date; both settings are recorded. `build_level_examples.py` passes OHLC only into the calculator, proving that the calculated examples do not depend on imported NinjaTrader indicator prices.

The bundle's `SHA256SUMS.json` identifies the exact delivered files. Numeric evidence, formula inference, UI alignment observations, and unverified concept rules are deliberately labeled separately.

## Primary external references

- [NinjaTrader Displacement documentation](https://ninjatrader.com/support/helpGuides/nt8/displacement.htm): display offset semantics.
- [NinjaTrader indicator settings](https://ninjatrader.com/support/helpguides/nt8/working_with_indicators.htm): displacement and Data Box controls.
- [Drummond Geometry official site](https://www.drummondgeometry.com/).
- [Official Silver description](https://drummondgeometry.kartra.com/page/LPg142): supported feature families and native Daily/intraday distinctions.
- [Official Gold course syllabus](https://drummondgeometry.kartra.com/page/dtk145): conceptual scope, not a supplied formula source.
- [Official free webinar page](https://drummondgeometry.kartra.com/page/FreeWebinar): further concept-study material.

The formula and numerical claims in this report are supported by the captured outputs and included calculations, not attributed to the public marketing pages.
