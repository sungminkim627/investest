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
import random
import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import csv

import pandas as pd
import yfinance as yf

UPSERT_CHUNK = 5000

METADATA_FIELDS = [
    "symbol",
    "name",
    "asset_type",
    "market",
    "updated_at",
    "sector",
    "industry",
    "category",
    "long_business_summary",
    "market_cap",
    "forward_pe",
    "trailing_pe",
    "beta",
    "debt_to_equity",
    "return_on_equity",
    "total_revenue",
    "net_income_to_common",
    "dividend_yield",
    "year_change_1y",
]


@dataclass
class InstrumentSymbol:
    symbol: str
    market: str
    asset_type: str
    name: str


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


def to_yahoo_symbol(symbol: str) -> str:
    return symbol.replace("/", "-")


def fetch_instruments(supabase_url: str, service_key: str, page_size: int = 1000) -> List[InstrumentSymbol]:
    symbols: List[InstrumentSymbol] = []
    offset = 0

    while True:
        query = urlencode(
            {
                "select": "symbol,market,asset_type,name",
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
            asset_type = compact_text(row.get("asset_type")).upper() or "STOCK"
            name = compact_text(row.get("name"))
            if symbol:
                symbols.append(InstrumentSymbol(symbol=symbol, market=market or "US", asset_type=asset_type, name=name))

        offset += len(payload)

    # dedupe by symbol+market
    deduped: Dict[Tuple[str, str], InstrumentSymbol] = {}
    for item in symbols:
        key = (item.symbol, item.market)
        if key not in deduped:
            deduped[key] = item
    return list(deduped.values())


def primary_yahoo_ticker(item: InstrumentSymbol) -> str:
    base = to_yahoo_symbol(item.symbol)
    if item.market == "CANADA":
        return f"{base}.TO"
    return base


def fallback_yahoo_candidates(item: InstrumentSymbol) -> List[str]:
    base = to_yahoo_symbol(item.symbol)
    if item.market == "CANADA":
        return [f"{base}.TO", f"{base}.NE", f"{base}.CN", base]
    return [base]


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


def parse_number(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not pd.isna(parsed) and parsed != float("inf") and parsed != float("-inf"):
        return parsed
    return None


def parse_text(value: Any) -> Optional[str]:
    text = compact_text(value)
    return text if text else None


def is_rate_limited(message: str) -> bool:
    msg = message.lower()
    return "too many requests" in msg or "rate limited" in msg or "http error 429" in msg


def fetch_ticker_info(
    yahoo_ticker: str,
    max_attempts: int = 3,
    retry_delay: float = 1.5
) -> Tuple[Optional[Dict[str, Any]], bool]:
    last_error: Optional[Exception] = None
    for attempt in range(1, max_attempts + 1):
        try:
            info = yf.Ticker(yahoo_ticker).info
            if isinstance(info, dict) and info:
                return info, False
            return None, False
        except Exception as error:
            last_error = error
            msg = str(error)
            if is_rate_limited(msg):
                print(f"[sync-weekly-prices] metadata rate limited ticker={yahoo_ticker} error={msg}")
                return None, True
            if "HTTP Error 500" in msg:
                wait = retry_delay * attempt
                print(f"[sync-weekly-prices] metadata retry ticker={yahoo_ticker} attempt={attempt}/{max_attempts} wait={wait:.1f}s error={msg}")
                time.sleep(wait)
                continue
            print(f"[sync-weekly-prices] metadata fetch failed ticker={yahoo_ticker} error={error}")
            break
    if last_error and "HTTP Error 500" in str(last_error):
        print(f"[sync-weekly-prices] metadata failed after retries ticker={yahoo_ticker}")
    return None, False


def resolve_info_for_instrument(item: InstrumentSymbol, pause_seconds: float) -> Tuple[Optional[Dict[str, Any]], bool]:
    candidates = [primary_yahoo_ticker(item), *fallback_yahoo_candidates(item)]
    seen: set[str] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        info, rate_limited = fetch_ticker_info(candidate)
        if rate_limited:
            return None, True
        if pause_seconds > 0:
            time.sleep(pause_seconds)
        if info:
            return info, False
    return None, False


def fetch_info_batch(yahoo_tickers: List[str]) -> Tuple[Dict[str, Dict[str, Any]], bool]:
    tickers = yf.Tickers(" ".join(yahoo_tickers)).tickers
    results: Dict[str, Dict[str, Any]] = {}
    rate_limited = False
    for ticker, obj in tickers.items():
        try:
            info = obj.info
            if isinstance(info, dict) and info:
                results[ticker] = info
        except Exception as error:
            msg = str(error)
            print(f"[sync-weekly-prices] metadata fetch failed ticker={ticker} error={error}")
            if is_rate_limited(msg):
                rate_limited = True
    return results, rate_limited


def build_metadata_row(item: InstrumentSymbol, info: Dict[str, Any]) -> Dict[str, Any]:
    asset_type = item.asset_type.upper()
    sector = parse_text(info.get("sector"))
    industry = parse_text(info.get("industry"))
    category = parse_text(info.get("category")) or "Other"
    summary = parse_text(info.get("longBusinessSummary"))

    market_cap = parse_number(info.get("marketCap"))
    if market_cap is None and asset_type == "ETF":
        market_cap = parse_number(info.get("totalAssets"))

    row: Dict[str, Any] = {
        "symbol": item.symbol,
        "name": item.name,
        "asset_type": item.asset_type,
        "market": item.market,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "sector": sector,
        "industry": industry,
        "category": category,
        "long_business_summary": summary,
        "market_cap": market_cap,
        "forward_pe": parse_number(info.get("forwardPE")),
        "trailing_pe": parse_number(info.get("trailingPE")),
        "beta": parse_number(info.get("beta")),
        "debt_to_equity": parse_number(info.get("debtToEquity")),
        "return_on_equity": parse_number(info.get("returnOnEquity")),
        "total_revenue": parse_number(info.get("totalRevenue")),
        "net_income_to_common": parse_number(info.get("netIncomeToCommon")),
        "dividend_yield": parse_number(info.get("dividendYield")) or 0,
        "year_change_1y": parse_number(info.get("52WeekChange")),
    }
    # Keep a stable set of keys for PostgREST bulk upserts.
    return {field: row.get(field) for field in METADATA_FIELDS}


def upsert_instruments(supabase_url: str, service_key: str, rows: List[Dict[str, Any]]) -> None:
    if not rows:
        return
    endpoint = f"{supabase_url}/rest/v1/instruments?on_conflict=symbol"
    for i in range(0, len(rows), UPSERT_CHUNK):
        chunk = rows[i : i + UPSERT_CHUNK]
        payload = json.dumps(chunk).encode("utf-8")
        req = Request(
            endpoint,
            method="POST",
            data=payload,
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates",
            },
        )
        try:
            with urlopen(req, timeout=180):
                pass
            print(f"[sync-weekly-prices] Upserted metadata {min(i + len(chunk), len(rows))}/{len(rows)} rows")
        except Exception as error:
            detail = ""
            if hasattr(error, "read"):
                try:
                    detail = error.read().decode("utf-8")  # type: ignore[attr-defined]
                except Exception:
                    detail = ""
            print(f"[sync-weekly-prices] Metadata upsert failed chunk_start={i} error={error} detail={detail[:300]}")
            if "400" in str(error):
                print("[sync-weekly-prices] Metadata upsert returned 400. Check that the instruments metadata columns exist in Supabase.")
            raise


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    load_env_file(root / ".env.local")
    load_env_file(root / ".env")

    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not supabase_url or not service_key:
        print("Missing env vars: NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY")
        return 1

    parser = argparse.ArgumentParser(description="Sync weekly prices and metadata from Yahoo Finance into Supabase.")
    parser.add_argument(
        "--mode",
        choices=["incremental", "backfill"],
        default=None,
        help="incremental fetches recent window; backfill fetches full history window.",
    )
    parser.add_argument(
        "--prices-only",
        action="store_true",
        help="sync prices only (skip metadata)",
    )
    parser.add_argument(
        "--metadata-only",
        action="store_true",
        help="sync metadata only (skip prices)",
    )
    args = parser.parse_args()

    if args.prices_only and args.metadata_only:
        print("Cannot use --prices-only and --metadata-only together.")
        return 1

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
    missing_prices: List[str] = []

    if not args.metadata_only:
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
                missing_prices.append(item.symbol)

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
        if missing_prices:
            print(f"[sync-weekly-prices] Price data missing for {len(missing_prices)} symbols")
            print(f"[sync-weekly-prices] Missing price symbols (sample): {', '.join(missing_prices[:50])}")

    metadata_enabled = os.getenv("WEEKLY_METADATA_SYNC", "1").strip().lower() not in {"0", "false", "no"}
    if metadata_enabled and not args.prices_only:
        metadata_pause_seconds = max(0.0, float(os.getenv("WEEKLY_METADATA_PAUSE_SECONDS", "1.0")))
        metadata_pause_jitter_seconds = max(0.0, float(os.getenv("WEEKLY_METADATA_PAUSE_JITTER_SECONDS", "2.0")))
        metadata_batch_size = max(1, int(os.getenv("WEEKLY_METADATA_BATCH_SIZE", "40")))
        metadata_flush_size = int(os.getenv("WEEKLY_METADATA_FLUSH_SIZE", "0"))
        metadata_csv_path = Path(os.getenv("WEEKLY_METADATA_CSV_PATH", "data/metadata_sync.csv"))
        metadata_csv_path.parent.mkdir(parents=True, exist_ok=True)
        csv_exists = metadata_csv_path.exists()
        csv_file = metadata_csv_path.open("a", newline="", encoding="utf-8")
        csv_writer = csv.DictWriter(csv_file, fieldnames=METADATA_FIELDS)
        if not csv_exists:
            csv_writer.writeheader()
        metadata_rows: List[Dict[str, Any]] = []
        missing_metadata: List[str] = []
        stopped_due_to_rate_limit = False
        for i in range(0, len(instruments), metadata_batch_size):
            batch = instruments[i : i + metadata_batch_size]
            yahoo_tickers = [primary_yahoo_ticker(item) for item in batch]
            batch_info, rate_limited = fetch_info_batch(yahoo_tickers)
            if rate_limited:
                stopped_due_to_rate_limit = True
                print("[sync-weekly-prices] Metadata rate limited during batch; stopping early.")
                break

            for item in batch:
                info = batch_info.get(primary_yahoo_ticker(item))
                if not info:
                    info, rate_limited = resolve_info_for_instrument(item, metadata_pause_seconds)
                    if rate_limited:
                        stopped_due_to_rate_limit = True
                        print("[sync-weekly-prices] Metadata rate limited during fallback; stopping early.")
                        break
                if not info:
                    missing_metadata.append(item.symbol)
                    continue
                row = build_metadata_row(item, info)
                if row:
                    # Persist a backup copy before any upsert.
                    csv_writer.writerow({field: row.get(field) for field in METADATA_FIELDS})
                    csv_file.flush()
                    metadata_rows.append(row)

                if metadata_flush_size > 0 and len(metadata_rows) >= metadata_flush_size:
                    upsert_instruments(supabase_url, service_key, metadata_rows)
                    metadata_rows = []

            if stopped_due_to_rate_limit:
                break
            print(f"[sync-weekly-prices] Metadata fetched {min(i + len(batch), len(instruments))}/{len(instruments)}")
            if metadata_pause_seconds or metadata_pause_jitter_seconds:
                jitter = random.uniform(0.0, metadata_pause_jitter_seconds)
                time.sleep(metadata_pause_seconds + jitter)

        if metadata_rows:
            upsert_instruments(supabase_url, service_key, metadata_rows)
        if missing_metadata:
            print(f"[sync-weekly-prices] Metadata missing for {len(missing_metadata)} symbols")
            print(f"[sync-weekly-prices] Missing metadata symbols (sample): {', '.join(missing_metadata[:50])}")
        if stopped_due_to_rate_limit:
            print("[sync-weekly-prices] Metadata sync stopped early due to rate limiting.")
        csv_file.close()
    else:
        print("[sync-weekly-prices] Metadata sync skipped (WEEKLY_METADATA_SYNC=0)")
    print(f"[sync-weekly-prices] Complete at {datetime.now(timezone.utc).isoformat()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
