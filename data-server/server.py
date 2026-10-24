"""
Paradise data server — raw OHLC over HTTP for the Node API's "external" provider.

Contract (see docs/CONTRACT.md):
  GET /ohlc?ticker=QQQ&timeframe=D&limit=5000  ->  [{time, open, high, low, close, volume}, ...]
  * time is the bar's period start in unix SECONDS.
  * Prices are split-adjusted and NOT dividend-adjusted (auto_adjust=False, Close not Adj Close),
    matching the Yahoo fallback and NinjaTrader's default stock handling. The v1 server used
    auto_adjust=True, which silently dividend-adjusted every stock price.
  * No completeness flags, no alignment — the Node API owns the exchange calendar.
  * Rows are returned oldest first; the newest `limit` rows are kept.

Changes from v1: adjustment policy, seconds instead of ms, intraday periods matched to Yahoo's
limits, optional API key, limit default large enough for ATR + lookback, no 300-row truncation.
"""
from __future__ import annotations

import math
import os
from typing import Optional

import pandas as pd
import yfinance as yf
from fastapi import FastAPI, Header, HTTPException, Query

API_KEY = os.environ.get("DATA_API_KEY", "").strip()

# timeframe -> (yfinance interval, period). Intraday periods are Yahoo's maximums.
TIMEFRAMES = {
    "1M": ("1m", "7d"),
    "5M": ("5m", "60d"),
    "15M": ("15m", "60d"),
    "30M": ("30m", "60d"),
    "1H": ("60m", "730d"),
    "D": ("1d", "5y"),
    "W": ("1wk", "10y"),
    "M": ("1mo", "max"),
}

app = FastAPI(title="paradise-data-server", version="2.0.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/ohlc")
def ohlc(
    ticker: str = Query(..., min_length=1, max_length=24),
    timeframe: str = Query(...),
    limit: int = Query(5000, ge=1, le=20000),
    x_api_key: Optional[str] = Header(default=None),
) -> list[dict]:
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="invalid API key")
    tf = timeframe.strip().upper()
    if tf not in TIMEFRAMES:
        raise HTTPException(status_code=400, detail=f"timeframe must be one of {', '.join(TIMEFRAMES)}")
    interval, period = TIMEFRAMES[tf]

    try:
        df = yf.download(ticker, period=period, interval=interval, auto_adjust=False,
                         actions=False, prepost=False, progress=False, threads=False)
    except Exception as exc:  # network / upstream errors
        raise HTTPException(status_code=502, detail=f"upstream error: {exc}") from exc
    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"no data for {ticker} {tf}")
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    rows: list[dict] = []
    for ts, r in df.iterrows():
        # Blank prices go out as null, not dropped: the Node API drops such rows WITH a warning.
        o, h, l, c = (None if math.isnan(x) else x for x in (float(r[k]) for k in ("Open", "High", "Low", "Close")))
        v = r.get("Volume", 0)
        rows.append({
            "time": int(pd.Timestamp(ts).timestamp()),
            "open": o, "high": h, "low": l, "close": c,
            "volume": 0 if v is None or (isinstance(v, float) and math.isnan(v)) else int(v),
        })
    return rows[-limit:]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8000")))
