# Audit fixtures (2026-09-23)

From the Paradise Drummond formula audit handoff (see `AUDIT-README.md`, the original report). These files are the golden test data. Don't edit them.

- `dwm-evidence/raw/*.jsonl`: 7 native NinjaTrader Daily/Weekly/Monthly captures (OHLC + all 39 public plot values and validity).
- `dwm-evidence/dwm-results.json`: the audit's per-plot comparison for those captures. The engine must reproduce it exactly.
- `dwm-evidence/*-alignment-results.json`: real Data Box observations (display vs source bar).
- `research_candidates.py`, `display_levels.py`: the frozen reference calculator and adapter (formula version `public-output-hypotheses-20260923-v1`).
- `SHA256SUMS.json`: hashes of the original delivery. Verify with `python3 -c` over the listed paths.

These are captured public chart outputs, not vendor source. No vendor DLL, documentation or course material is included.
