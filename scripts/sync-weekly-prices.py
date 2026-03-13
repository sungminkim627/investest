#!/usr/bin/env python3
"""
Backfill weekly adjusted-close prices (10Y) into public.prices_daily using yfinance.

- Reads symbols from public.instruments
- Downloads weekly prices in batches
- Upserts rows into prices_daily(symbol, market, date, adj_close)

Notes:
- Uses auto_adjust=True so 'Close' is adjusted close.
- Stores weekly points in prices_daily (schema-compatible with existing app).
"""

from __future__ import annotations

import json
import os
import time
import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pandas as pd
import yfinance as yf

UPSERT_CHUNK = 5000


@dataclass
class InstrumentSymbol:
    symbol: str
    market: str


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


def compact_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_symbol(value: Any) -> str:
    text = compact_text(value).upper().lstrip("^")
    if ":" in text:
        text = text.split(":")[-1]
    if " " in text:
        text = text.split(" ", 1)[0]
    return text


def fetch_instruments(supabase_url: str, service_key: str, page_size: int = 1000) -> List[InstrumentSymbol]:
    symbols: List[InstrumentSymbol] = []
    offset = 0

    while True:
        query = urlencode(
            {
                "select": "symbol,market",
                "order": "symbol.asc",
                "limit": str(page_size),
                "offset": str(offset),
            },
            safe="(),",
        )
        req = Request(
            f"{supabase_url}/rest/v1/instruments?{query}",
            headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
        )
        with urlopen(req, timeout=120) as response:
            payload = json.loads(response.read().decode("utf-8"))

        if not isinstance(payload, list) or len(payload) == 0:
            break

        for row in payload:
            symbol = normalize_symbol(row.get("symbol"))
            market = compact_text(row.get("market")).upper()
            if symbol:
                symbols.append(InstrumentSymbol(symbol=symbol, market=market or "US"))

        offset += len(payload)

    # dedupe by symbol+market
    deduped: Dict[Tuple[str, str], InstrumentSymbol] = {}
    for item in symbols:
        key = (item.symbol, item.market)
        if key not in deduped:
            deduped[key] = item
    return list(deduped.values())


def primary_yahoo_ticker(item: InstrumentSymbol) -> str:
    if item.market == "CANADA":
        return f"{item.symbol}.TO"
    return item.symbol


def fallback_yahoo_candidates(item: InstrumentSymbol) -> List[str]:
    if item.market == "CANADA":
        return [f"{item.symbol}.TO", f"{item.symbol}.NE", f"{item.symbol}.CN", item.symbol]
    return [item.symbol]


def extract_close_series(data: pd.DataFrame, yahoo_ticker: str) -> pd.Series:
    if data.empty:
        return pd.Series(dtype="float64")

    # Multi-ticker format
    if isinstance(data.columns, pd.MultiIndex):
        if yahoo_ticker in data.columns.get_level_values(0):
            frame = data[yahoo_ticker]
            if "Close" in frame.columns:
                return frame["Close"].dropna()
        return pd.Series(dtype="float64")

    # Single ticker format
    if "Close" in data.columns:
        return data["Close"].dropna()

    return pd.Series(dtype="float64")


def download_batch(
    yahoo_tickers: List[str], period: str, pause_seconds: float, max_attempts: int = 3
) -> pd.DataFrame:
    last_error: Optional[Exception] = None
    for attempt in range(1, max_attempts + 1):
        try:
            df = yf.download(
                tickers=yahoo_tickers,
                period=period,
                interval="1wk",
                group_by="ticker",
                auto_adjust=True,
                progress=False,
                threads=False,
            )
            if pause_seconds > 0:
                time.sleep(pause_seconds)
            return df
        except Exception as error:
            last_error = error
            wait = min(10.0, attempt * 1.5)
            print(f"[sync-weekly-prices] batch retry attempt={attempt}/{max_attempts} wait={wait:.1f}s error={error}")
            time.sleep(wait)

    if last_error:
        raise last_error
    return pd.DataFrame()


def rows_from_series(symbol: str, market: str, series: pd.Series) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    if series.empty:
        return rows

    for idx, val in series.items():
        if val is None or pd.isna(val):
            continue
        date_str = pd.Timestamp(idx).date().isoformat()
        rows.append({"symbol": symbol, "market": market, "date": date_str, "adj_close": float(val)})
    return rows


def upsert_prices(supabase_url: str, service_key: str, rows: List[Dict[str, Any]]) -> None:
    if not rows:
        return

    endpoint = f"{supabase_url}/rest/v1/prices_daily?on_conflict=symbol,market,date"
    for i in range(0, len(rows), UPSERT_CHUNK):
        chunk = rows[i : i + UPSERT_CHUNK]
        req = Request(
            endpoint,
            method="POST",
            data=json.dumps(chunk).encode("utf-8"),
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates",
            },
        )
        with urlopen(req, timeout=180):
            pass
        print(f"[sync-weekly-prices] Upserted {min(i + len(chunk), len(rows))}/{len(rows)} rows")


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    load_env_file(root / ".env.local")
    load_env_file(root / ".env")

    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not supabase_url or not service_key:
        print("Missing env vars: NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY")
        return 1

    parser = argparse.ArgumentParser(description="Sync weekly prices from Yahoo Finance into Supabase.")
    parser.add_argument(
        "--mode",
        choices=["incremental", "backfill"],
        default=None,
        help="incremental fetches recent window; backfill fetches full history window.",
    )
    args = parser.parse_args()

    batch_size = max(1, int(os.getenv("WEEKLY_PRICE_BATCH_SIZE", "100")))
    pause_seconds = max(0.0, float(os.getenv("WEEKLY_PRICE_PAUSE_SECONDS", "0.5")))
    mode = (args.mode or os.getenv("WEEKLY_PRICE_SYNC_MODE", "incremental")).strip().lower()
    if mode not in {"incremental", "backfill"}:
        print(f"Invalid WEEKLY_PRICE_SYNC_MODE={mode}. Use incremental or backfill.")
        return 1

    backfill_period = os.getenv("WEEKLY_PRICE_BACKFILL_PERIOD", "10y").strip() or "10y"
    incremental_period = os.getenv("WEEKLY_PRICE_INCREMENTAL_PERIOD", "3mo").strip() or "3mo"
    period = incremental_period if mode == "incremental" else backfill_period

    instruments = fetch_instruments(supabase_url, service_key)
    if not instruments:
        print("[sync-weekly-prices] No instruments found.")
        return 1

    print(
        f"[sync-weekly-prices] Symbols to process: {len(instruments)} "
        f"(mode={mode}, period={period}, interval=1wk)"
    )

    all_rows: List[Dict[str, Any]] = []
    missing_after_primary: List[InstrumentSymbol] = []

    # Primary pass in batches
    for i in range(0, len(instruments), batch_size):
        batch = instruments[i : i + batch_size]
        yahoo_tickers = [primary_yahoo_ticker(item) for item in batch]
        data = download_batch(yahoo_tickers, period=period, pause_seconds=pause_seconds)

        for item, yahoo_ticker in zip(batch, yahoo_tickers):
            series = extract_close_series(data, yahoo_ticker)
            if series.empty:
                missing_after_primary.append(item)
                continue
            all_rows.extend(rows_from_series(item.symbol, item.market, series))

        print(f"[sync-weekly-prices] Primary pass symbols {min(i + len(batch), len(instruments))}/{len(instruments)}")

    # Fallback pass for symbols with no data (mostly Canadian suffix mismatch)
    resolved = 0
    for item in missing_after_primary:
        found = False
        for yahoo_ticker in fallback_yahoo_candidates(item):
            data = download_batch([yahoo_ticker], period=period, pause_seconds=pause_seconds)
            series = extract_close_series(data, yahoo_ticker)
            if series.empty:
                continue
            all_rows.extend(rows_from_series(item.symbol, item.market, series))
            resolved += 1
            found = True
            break
        if not found:
            print(f"[sync-weekly-prices] No weekly data for symbol={item.symbol} market={item.market}")

    # Deduplicate in-memory just in case
    deduped: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    for row in all_rows:
        deduped[(row["symbol"], row["market"], row["date"])] = row

    final_rows = list(deduped.values())
    print(
        f"[sync-weekly-prices] Rows prepared: {len(final_rows)} "
        f"(fallback_resolved={resolved}/{len(missing_after_primary)})"
    )

    upsert_prices(supabase_url, service_key, final_rows)
    print(f"[sync-weekly-prices] Complete at {datetime.now(timezone.utc).isoformat()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
