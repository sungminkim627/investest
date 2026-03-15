#!/usr/bin/env python3
"""
Upload metadata_sync.csv into public.instruments via Supabase REST.

- Fills required NOT NULL fields (name, asset_type, market) from existing instruments table.
- Uses stable keys to satisfy PostgREST bulk upsert requirements.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode
from urllib.request import Request, urlopen


UPSERT_CHUNK = 500

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


def parse_optional_number(value: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    text = str(value).strip()
    if text == "":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def fetch_instrument_map(supabase_url: str, service_key: str, page_size: int = 1000) -> Dict[str, Dict[str, str]]:
    offset = 0
    mapping: Dict[str, Dict[str, str]] = {}
    while True:
        query = urlencode(
            {
                "select": "symbol,name,asset_type,market",
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
            symbol = str(row.get("symbol") or "").strip().upper()
            if not symbol:
                continue
            mapping[symbol] = {
                "name": str(row.get("name") or "").strip(),
                "asset_type": str(row.get("asset_type") or "").strip(),
                "market": str(row.get("market") or "").strip(),
            }

        offset += len(payload)
    return mapping


def coerce_row(raw: Dict[str, str], instrument_map: Dict[str, Dict[str, str]]) -> Optional[Dict[str, Any]]:
    symbol = str(raw.get("symbol") or "").strip().upper()
    if not symbol:
        return None

    base = instrument_map.get(symbol)
    if not base or not base.get("name") or not base.get("asset_type") or not base.get("market"):
        return None

    row: Dict[str, Any] = {
        "symbol": symbol,
        "name": base["name"],
        "asset_type": base["asset_type"],
        "market": base["market"],
        "updated_at": raw.get("updated_at") or None,
        "sector": raw.get("sector") or None,
        "industry": raw.get("industry") or None,
        "category": raw.get("category") or "Other",
        "long_business_summary": raw.get("long_business_summary") or None,
        "market_cap": parse_optional_number(raw.get("market_cap")),
        "forward_pe": parse_optional_number(raw.get("forward_pe")),
        "trailing_pe": parse_optional_number(raw.get("trailing_pe")),
        "beta": parse_optional_number(raw.get("beta")),
        "debt_to_equity": parse_optional_number(raw.get("debt_to_equity")),
        "return_on_equity": parse_optional_number(raw.get("return_on_equity")),
        "total_revenue": parse_optional_number(raw.get("total_revenue")),
        "net_income_to_common": parse_optional_number(raw.get("net_income_to_common")),
        "dividend_yield": parse_optional_number(raw.get("dividend_yield")) or 0,
        "year_change_1y": parse_optional_number(raw.get("year_change_1y")),
    }

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
        except Exception as error:
            detail = ""
            if hasattr(error, "read"):
                try:
                    detail = error.read().decode("utf-8")  # type: ignore[attr-defined]
                except Exception:
                    detail = ""
            print(f"[upload-metadata-csv] Upsert failed chunk_start={i} error={error} detail={detail[:300]}")
            raise
        print(f"[upload-metadata-csv] Upserted {min(i + len(chunk), len(rows))}/{len(rows)} rows")


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    load_env_file(root / ".env.local")
    load_env_file(root / ".env")

    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not supabase_url or not service_key:
        print("Missing env vars: NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY")
        return 1

    parser = argparse.ArgumentParser(description="Upload metadata_sync.csv into Supabase.")
    parser.add_argument("--path", default="data/metadata_sync.csv", help="Path to metadata CSV.")
    args = parser.parse_args()

    csv_path = Path(args.path)
    if not csv_path.exists():
        print(f"CSV not found: {csv_path}")
        return 1

    instrument_map = fetch_instrument_map(supabase_url, service_key)
    if not instrument_map:
        print("No instruments found to map required fields.")
        return 1

    rows: List[Dict[str, Any]] = []
    skipped = 0
    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for raw in reader:
            row = coerce_row(raw, instrument_map)
            if not row:
                skipped += 1
                continue
            rows.append(row)

    # Deduplicate by symbol (keep last row).
    deduped: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        deduped[row["symbol"]] = row
    rows = list(deduped.values())

    print(f"[upload-metadata-csv] Rows loaded: {len(rows)} (skipped={skipped})")
    upsert_instruments(supabase_url, service_key, rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
