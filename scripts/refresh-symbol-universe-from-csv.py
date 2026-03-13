#!/usr/bin/env python3
"""
Rebuild Investest instruments from local CSV exports.

Dynamic file detection in UNIVERSE_CSV_DIR using filename keywords:
- ETF + US
- ETF + CAN
- STOCK + US
- STOCK + CAN

Target schema:
  symbol text primary key,
  name text not null,
  asset_type text not null,      -- 'Stock' or 'ETF'
  market text not null,          -- 'US' or 'CANADA'
  exchange text,
  valuation numeric,
  currency text,
  sector text,
  industry text,
  category text,
  updated_at timestamptz
"""

from __future__ import annotations

import csv
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen

UPSERT_CHUNK = 500


@dataclass(frozen=True)
class CsvJob:
    path: Path
    asset_type: str  # Stock or ETF
    market: str  # US or CANADA
    limit: int


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
    text = "" if value is None else str(value)
    text = text.replace("\u00a0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    if text.lower() in {"", "nan", "none", "null", "n/a"}:
        return ""
    return text


def normalize_symbol(raw: Any) -> str:
    text = compact_text(raw).upper().lstrip("^")
    if ":" in text:
        text = text.split(":")[-1]
    if " " in text:
        text = text.split(" ", 1)[0]
    return text


def parse_float(value: Any) -> Optional[float]:
    text = compact_text(value)
    if not text:
        return None
    text = text.replace(",", "")
    try:
        return float(text)
    except ValueError:
        return None


def load_csv_rows(path: Path) -> List[Dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        return [dict(row) for row in reader]


def detect_csv_jobs(csv_dir: Path) -> List[CsvJob]:
    limits = {
        ("Stock", "US"): int(os.getenv("CSV_TOP_US_STOCKS", "1000")),
        ("Stock", "CANADA"): int(os.getenv("CSV_TOP_CA_STOCKS", "250")),
        ("ETF", "US"): int(os.getenv("CSV_TOP_US_ETFS", "500")),
        ("ETF", "CANADA"): int(os.getenv("CSV_TOP_CA_ETFS", "250")),
    }
    jobs: List[CsvJob] = []
    seen = set()

    for path in sorted(csv_dir.glob("*.csv")):
        name = path.name.upper()

        is_etf = "ETF" in name
        is_stock = "STOCK" in name
        if is_etf == is_stock:
            continue

        market: Optional[str] = None
        if "CAN" in name:
            market = "CANADA"
        elif "US" in name or "USA" in name or "AMERICA" in name:
            market = "US"

        if market is None:
            continue

        asset_type = "ETF" if is_etf else "Stock"
        key = (asset_type, market)
        if key in seen:
            # Keep first deterministic match to avoid ambiguity.
            continue
        seen.add(key)
        jobs.append(CsvJob(path=path, asset_type=asset_type, market=market, limit=max(1, limits[(asset_type, market)])))

    required = {("Stock", "US"), ("Stock", "CANADA"), ("ETF", "US"), ("ETF", "CANADA")}
    found = {(j.asset_type, j.market) for j in jobs}
    missing = required - found
    if missing:
        missing_text = ", ".join([f"{a}-{m}" for a, m in sorted(missing)])
        raise RuntimeError(f"Missing required CSV file groups: {missing_text}")

    return jobs


def get_case_insensitive(row: Dict[str, str], key: str) -> str:
    key_lower = key.lower()
    for k, v in row.items():
        if k.lower() == key_lower:
            return v
    return ""


def build_rows_from_jobs(jobs: List[CsvJob]) -> List[Dict[str, Any]]:
    all_rows: List[Dict[str, Any]] = []
    now_iso = datetime.now(timezone.utc).isoformat()

    for job in jobs:
        rows = load_csv_rows(job.path)
        if not rows:
            print(f"[sync-universe-csv] Empty CSV: {job.path.name}")
            continue

        # Validate core columns based on the provided TradingView CSV headers.
        required = ["Symbol", "Description"]
        for col in required:
            if get_case_insensitive(rows[0], col) == "":
                # check presence by header keys even if first value blank
                if col.lower() not in [h.lower() for h in rows[0].keys()]:
                    raise RuntimeError(f"Missing required column '{col}' in {job.path.name}")

        for row in rows:
            symbol = normalize_symbol(get_case_insensitive(row, "Symbol"))
            if not symbol:
                continue
            if job.asset_type == "Stock" and "." in symbol:
                symbol = symbol.replace(".", "-")

            name = compact_text(get_case_insensitive(row, "Description")) or symbol
            exchange = compact_text(get_case_insensitive(row, "Exchange")) or None

            if job.asset_type == "Stock":
                valuation = parse_float(get_case_insensitive(row, "Market capitalization"))
                currency = compact_text(get_case_insensitive(row, "Market capitalization - Currency")) or None
                sector = compact_text(get_case_insensitive(row, "Sector")) or None
                industry = compact_text(get_case_insensitive(row, "Industry")) or None
                category = None
            else:
                valuation = parse_float(get_case_insensitive(row, "Assets under management"))
                currency = compact_text(get_case_insensitive(row, "Assets under management - Currency")) or None
                sector = compact_text(get_case_insensitive(row, "Asset class")) or None
                industry = compact_text(get_case_insensitive(row, "Focus")) or None
                category = compact_text(get_case_insensitive(row, "Category")) or None

            all_rows.append(
                {
                    "symbol": symbol,
                    "name": name,
                    "asset_type": job.asset_type,
                    "market": job.market,
                    "exchange": exchange,
                    "valuation": valuation,
                    "currency": currency,
                    "sector": sector,
                    "industry": industry,
                    "category": category,
                    "updated_at": now_iso,
                }
            )

        print(f"[sync-universe-csv] Loaded {len(rows)} rows from {job.path.name} ({job.asset_type}/{job.market})")

    # Deduplicate by symbol: keep row with highest valuation.
    by_symbol: Dict[str, Dict[str, Any]] = {}
    for row in all_rows:
        symbol = row["symbol"]
        existing = by_symbol.get(symbol)
        if existing is None:
            by_symbol[symbol] = row
            continue

        v1 = existing.get("valuation")
        v2 = row.get("valuation")
        score1 = float(v1) if isinstance(v1, (int, float)) else -1.0
        score2 = float(v2) if isinstance(v2, (int, float)) else -1.0

        if score2 > score1:
            by_symbol[symbol] = row

    deduped_rows = list(by_symbol.values())

    # Apply target caps by (asset_type, market) using valuation rank.
    capped: List[Dict[str, Any]] = []
    for job in jobs:
        group = [r for r in deduped_rows if r["asset_type"] == job.asset_type and r["market"] == job.market]
        group.sort(key=lambda r: float(r["valuation"]) if isinstance(r.get("valuation"), (int, float)) else -1.0, reverse=True)
        capped.extend(group[: job.limit])

    return capped


class SupabaseRepository:
    def __init__(self, supabase_url: str, service_key: str) -> None:
        self.supabase_url = supabase_url
        self.service_key = service_key

    def _request(self, method: str, path_with_query: str, body: Optional[Dict[str, Any]] = None, timeout: int = 180) -> Any:
        req = Request(
            f"{self.supabase_url}/rest/v1/{path_with_query}",
            method=method,
            data=(json.dumps(body).encode("utf-8") if body is not None else None),
            headers={
                "apikey": self.service_key,
                "Authorization": f"Bearer {self.service_key}",
                "Content-Type": "application/json",
            },
        )
        with urlopen(req, timeout=timeout) as response:
            payload = response.read().decode("utf-8")
            return json.loads(payload) if payload else None

    def fetch_all_symbols(self, page_size: int = 1000) -> List[str]:
        out: List[str] = []
        offset = 0
        while True:
            query = urlencode(
                {
                    "select": "symbol",
                    "order": "symbol.asc",
                    "limit": str(page_size),
                    "offset": str(offset),
                },
                safe="(),",
            )
            payload = self._request("GET", f"instruments?{query}")
            if not isinstance(payload, list) or len(payload) == 0:
                break
            out.extend([normalize_symbol(r.get("symbol")) for r in payload if normalize_symbol(r.get("symbol"))])
            offset += len(payload)
        return out

    def delete_symbols(self, symbols: List[str], chunk_size: int = 200) -> int:
        if not symbols:
            return 0
        deleted = 0
        for i in range(0, len(symbols), chunk_size):
            chunk = symbols[i : i + chunk_size]
            condition = f"in.({','.join(chunk)})"
            query = urlencode({"symbol": condition}, safe="(),.-_/")
            req = Request(
                f"{self.supabase_url}/rest/v1/instruments?{query}",
                method="DELETE",
                headers={
                    "apikey": self.service_key,
                    "Authorization": f"Bearer {self.service_key}",
                    "Prefer": "return=minimal",
                },
            )
            with urlopen(req, timeout=180):
                pass
            deleted += len(chunk)
        return deleted

    def replace_instruments(self, rows: List[Dict[str, Any]]) -> None:
        existing = self.fetch_all_symbols()
        if existing:
            deleted = self.delete_symbols(existing)
            print(f"[sync-universe-csv] Deleted existing rows: {deleted}")

        endpoint = f"{self.supabase_url}/rest/v1/instruments?on_conflict=symbol"
        for i in range(0, len(rows), UPSERT_CHUNK):
            chunk = rows[i : i + UPSERT_CHUNK]
            req = Request(
                endpoint,
                method="POST",
                data=json.dumps(chunk).encode("utf-8"),
                headers={
                    "apikey": self.service_key,
                    "Authorization": f"Bearer {self.service_key}",
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates",
                },
            )
            with urlopen(req, timeout=180):
                pass
            print(f"[sync-universe-csv] Upserted {min(i + len(chunk), len(rows))}/{len(rows)}")


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    load_env_file(root / ".env.local")
    load_env_file(root / ".env")

    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not supabase_url or not service_key:
        print("Missing env vars: NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY", file=sys.stderr)
        return 1

    csv_dir = Path(os.getenv("UNIVERSE_CSV_DIR", str(root / "data" / "universe")))
    if not csv_dir.exists():
        print(f"CSV directory not found: {csv_dir}", file=sys.stderr)
        return 1

    jobs = detect_csv_jobs(csv_dir)
    print("[sync-universe-csv] Discovered files:")
    for j in jobs:
        print(f"  - {j.path.name} ({j.asset_type}/{j.market})")

    rows = build_rows_from_jobs(jobs)
    if not rows:
        print("No rows produced from CSVs.", file=sys.stderr)
        return 1

    repo = SupabaseRepository(supabase_url=supabase_url, service_key=service_key)
    repo.replace_instruments(rows)

    print(f"[sync-universe-csv] Complete: instruments={len(rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
