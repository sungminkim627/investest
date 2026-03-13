#!/usr/bin/env python3
"""
Analyze instruments.category coverage and counts by asset_type from Supabase.

Outputs:
- notebooks/category_counts_by_asset_type.csv
- notebooks/category_counts_etf.csv
- notebooks/category_counts_stock.csv
- notebooks/category_counts_etf_category.csv
- notebooks/category_counts_etf_sector.csv
- notebooks/category_counts_etf_industry.csv
- notebooks/category_counts_stock_sector.csv
- notebooks/category_counts_stock_industry.csv
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pandas as pd


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


def fetch_instruments(supabase_url: str, service_key: str, page_size: int = 1000) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    offset = 0
    while True:
        query = urlencode(
            {
                "select": "symbol,name,asset_type,market,sector,industry,category,valuation",
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
        rows.extend(payload)
        offset += len(payload)
    return rows


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    load_env_file(root / ".env.local")
    load_env_file(root / ".env")

    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not supabase_url or not service_key:
        print("Missing env vars: NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY")
        return 1

    rows = fetch_instruments(supabase_url=supabase_url, service_key=service_key)
    if not rows:
        print("[analyze-instrument-categories] No rows returned from instruments.")
        return 1

    df = pd.DataFrame(rows)
    df["asset_type_norm"] = df["asset_type"].map(compact_text).str.upper()
    df["category_norm"] = df["category"].map(compact_text)
    df["sector_norm"] = df["sector"].map(compact_text)
    df["industry_norm"] = df["industry"].map(compact_text)

    summary = (
        df.groupby("asset_type_norm", dropna=False)
        .agg(
            total=("symbol", "count"),
            category_blank=("category_norm", lambda s: (s == "").sum()),
            category_non_blank=("category_norm", lambda s: (s != "").sum()),
        )
        .sort_values("total", ascending=False)
    )
    summary["blank_pct"] = (summary["category_blank"] / summary["total"] * 100).round(2)

    grouped = (
        df[df["category_norm"] != ""]
        .groupby(["asset_type_norm", "category_norm"], dropna=False)
        .size()
        .reset_index(name="count")
        .sort_values(["asset_type_norm", "count", "category_norm"], ascending=[True, False, True])
    )

    etf = grouped[grouped["asset_type_norm"] == "ETF"].copy()
    stock = grouped[grouped["asset_type_norm"] == "STOCK"].copy()
    if stock.empty:
        stock_df = df[df["asset_type_norm"] == "STOCK"].copy()
        stock_df["category_norm"] = (
            stock_df["category_norm"]
            .where(stock_df["category_norm"] != "", stock_df["industry_norm"])
            .where(lambda s: s != "", stock_df["sector_norm"])
            .where(lambda s: s != "", "(Uncategorized)")
        )
        stock = (
            stock_df.groupby("category_norm", dropna=False)
            .size()
            .reset_index(name="count")
            .sort_values(["count", "category_norm"], ascending=[False, True])
        )

    out_dir = root / "notebooks"
    out_dir.mkdir(parents=True, exist_ok=True)
    grouped.to_csv(out_dir / "category_counts_by_asset_type.csv", index=False)
    etf.to_csv(out_dir / "category_counts_etf.csv", index=False)
    stock.to_csv(out_dir / "category_counts_stock.csv", index=False)

    etf_df = df[df["asset_type_norm"] == "ETF"].copy()
    stock_df = df[df["asset_type_norm"] == "STOCK"].copy()

    def count_non_blank(frame: pd.DataFrame, column: str) -> pd.DataFrame:
        value = frame[column].map(compact_text)
        out = (
            frame.assign(_value=value)
            .query("_value != ''")
            .groupby("_value", dropna=False)
            .size()
            .reset_index(name="count")
            .rename(columns={"_value": column})
            .sort_values(["count", column], ascending=[False, True])
        )
        return out

    etf_category = count_non_blank(etf_df, "category")
    etf_sector = count_non_blank(etf_df, "sector")
    etf_industry = count_non_blank(etf_df, "industry")
    stock_sector = count_non_blank(stock_df, "sector")
    stock_industry = count_non_blank(stock_df, "industry")

    etf_category.to_csv(out_dir / "category_counts_etf_category.csv", index=False)
    etf_sector.to_csv(out_dir / "category_counts_etf_sector.csv", index=False)
    etf_industry.to_csv(out_dir / "category_counts_etf_industry.csv", index=False)
    stock_sector.to_csv(out_dir / "category_counts_stock_sector.csv", index=False)
    stock_industry.to_csv(out_dir / "category_counts_stock_industry.csv", index=False)

    print(f"[analyze-instrument-categories] Loaded rows: {len(df):,}")
    print("[analyze-instrument-categories] Asset type coverage:")
    print(summary.to_string())
    print(f"[analyze-instrument-categories] Wrote {out_dir / 'category_counts_by_asset_type.csv'}")
    print(f"[analyze-instrument-categories] Wrote {out_dir / 'category_counts_etf.csv'}")
    print(f"[analyze-instrument-categories] Wrote {out_dir / 'category_counts_stock.csv'}")
    print(f"[analyze-instrument-categories] Wrote {out_dir / 'category_counts_etf_category.csv'}")
    print(f"[analyze-instrument-categories] Wrote {out_dir / 'category_counts_etf_sector.csv'}")
    print(f"[analyze-instrument-categories] Wrote {out_dir / 'category_counts_etf_industry.csv'}")
    print(f"[analyze-instrument-categories] Wrote {out_dir / 'category_counts_stock_sector.csv'}")
    print(f"[analyze-instrument-categories] Wrote {out_dir / 'category_counts_stock_industry.csv'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
