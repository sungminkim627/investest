#!/usr/bin/env python3
"""
Enrich public.instruments from FinanceDatabase via DataFrame joins.

Requirements:
  pip install financedatabase pandas

Updates columns (full-table rewrite via upsert):
- name (overwrites ticker-like names when enriched name exists)
- asset_type
- sector
- industry
- short_description (<= 180 chars)
- description (same as short_description for UI)
- tags
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pandas as pd

PROTECTED_SYMBOLS = {
    "SPY",
    "VOO",
    "VTI",
    "QQQ",
    "BND",
    "AGG",
    "VXUS",
    "AAPL",
    "MSFT",
    "NVDA",
    "AMZN",
    "GOOGL",
}


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
    if text.lower() in {"", "nan", "none", "null"}:
        return ""
    return text


def to_short_description(value: Any, max_length: int = 180) -> Optional[str]:
    compact = compact_text(value)
    if not compact:
        return None
    if len(compact) <= max_length:
        return compact
    trimmed = compact[: max_length - 1]
    break_at = max(
        trimmed.rfind(". "),
        trimmed.rfind("; "),
        trimmed.rfind(", "),
        trimmed.rfind(" "),
    )
    safe = trimmed[:break_at] if break_at >= int(max_length * 0.55) else trimmed
    return f"{safe.strip()}..."


def normalize_symbol(raw: Any) -> str:
    text = compact_text(raw).upper().lstrip("^")
    if ":" in text:
        text = text.split(":")[-1]
    if " " in text:
        text = text.split(" ", 1)[0]
    return text


def symbol_aliases(symbol: str) -> List[str]:
    base = normalize_symbol(symbol)
    if not base:
        return []

    aliases = {
        base,
        base.replace(".", "-"),
        base.replace("-", "."),
        base.replace("/", "-"),
        base.replace("/", "."),
    }

    for token in list(aliases):
        if "." in token:
            aliases.add(token.split(".", 1)[0])
        if "-" in token:
            aliases.add(token.split("-", 1)[0])

    return [item for item in aliases if item]


def tags_list(*values: Any) -> List[str]:
    out: List[str] = []
    for value in values:
        item = compact_text(value)
        if not item:
            continue
        if item.lower() not in [x.lower() for x in out]:
            out.append(item)
    return out


def fetch_supabase_instruments(*, supabase_url: str, service_key: str, page_size: int = 1000) -> pd.DataFrame:
    endpoint = f"{supabase_url}/rest/v1/instruments"
    offset = 0
    rows: List[Dict[str, Any]] = []

    while True:
        query = urlencode(
            {
                "select": "symbol,name,asset_type,description,short_description,sector,industry,tags,is_active",
                "is_active": "eq.true",
                "order": "symbol.asc",
                "limit": str(page_size),
                "offset": str(offset),
            },
            safe="(),",
        )
        req = Request(
            f"{endpoint}?{query}",
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
            },
        )
        with urlopen(req, timeout=120) as response:
            payload = json.loads(response.read().decode("utf-8"))

        if not isinstance(payload, list) or len(payload) == 0:
            break

        rows.extend(payload)
        offset += len(payload)

    if not rows:
        return pd.DataFrame(columns=["symbol"])

    df = pd.DataFrame(rows)
    if df.empty:
        return df

    df["symbol"] = df["symbol"].map(normalize_symbol)
    df = df[df["symbol"] != ""].copy()
    return df


def extract_symbol_series(df: pd.DataFrame) -> pd.Series:
    for col in ["symbol", "ticker", "yf_ticker", "yahoo_ticker", "trading_symbol"]:
        if col in df.columns:
            return df[col].map(normalize_symbol)
    return df.index.to_series().map(normalize_symbol)


def build_financedatabase_frames() -> tuple[pd.DataFrame, pd.DataFrame]:
    import financedatabase as fd  # type: ignore

    print("[sync-instrument-profiles] Loading FinanceDatabase equities...")
    eq = fd.Equities().select()
    print("[sync-instrument-profiles] Loading FinanceDatabase ETFs...")
    etf = fd.ETFs().select()

    df_eq = eq.reset_index(drop=False)
    df_eq["symbol"] = extract_symbol_series(df_eq)
    df_eq = df_eq[df_eq["symbol"] != ""].copy()
    if "name" not in df_eq.columns:
        df_eq["name"] = None
    if "summary" not in df_eq.columns:
        df_eq["summary"] = None
    if "sector" not in df_eq.columns:
        df_eq["sector"] = None
    if "industry" not in df_eq.columns:
        df_eq["industry"] = None

    df_eq["name_enriched"] = df_eq["name"].map(compact_text).replace("", None)
    df_eq["short_description_enriched"] = df_eq["summary"].map(to_short_description)
    df_eq["asset_type_enriched"] = "equity"
    df_eq["tags_enriched"] = df_eq.apply(
        lambda r: tags_list("equity", r.get("sector"), r.get("industry")),
        axis=1,
    )
    df_eq = df_eq[
        ["symbol", "name_enriched", "asset_type_enriched", "sector", "industry", "short_description_enriched", "tags_enriched"]
    ].drop_duplicates("symbol")

    df_etf = etf.reset_index(drop=False)
    df_etf["symbol"] = extract_symbol_series(df_etf)
    df_etf = df_etf[df_etf["symbol"] != ""].copy()

    for col in ["name", "category_group", "category", "family"]:
        if col not in df_etf.columns:
            df_etf[col] = None

    df_etf["name_enriched"] = df_etf["name"].map(compact_text).replace("", None)
    df_etf["sector"] = df_etf["category_group"]
    df_etf["industry"] = df_etf["category"]
    df_etf["short_description_enriched"] = df_etf.apply(
        lambda r: to_short_description(
            " ".join(
                part
                for part in [
                    f"ETF category: {compact_text(r.get('category_group'))}." if compact_text(r.get("category_group")) else "",
                    f"Focus: {compact_text(r.get('category'))}." if compact_text(r.get("category")) else "",
                    f"Provider: {compact_text(r.get('family'))}." if compact_text(r.get("family")) else "",
                ]
                if part
            )
        ),
        axis=1,
    )
    df_etf["asset_type_enriched"] = "etf"
    df_etf["tags_enriched"] = df_etf.apply(
        lambda r: tags_list("etf", r.get("category_group"), r.get("category"), r.get("family")),
        axis=1,
    )
    df_etf = df_etf[
        ["symbol", "name_enriched", "asset_type_enriched", "sector", "industry", "short_description_enriched", "tags_enriched"]
    ].drop_duplicates("symbol")

    return df_eq, df_etf


def expand_alias_df(df: pd.DataFrame) -> pd.DataFrame:
    rows: List[Dict[str, Any]] = []
    for _, rec in df.iterrows():
        aliases = symbol_aliases(rec["symbol"])
        for alias in aliases:
            row = rec.to_dict()
            row["alias_symbol"] = alias
            rows.append(row)
    out = pd.DataFrame(rows)
    if out.empty:
        return out
    return out.drop_duplicates("alias_symbol")


def choose_name(current_name: Any, symbol: str, enriched_name: Any) -> Optional[str]:
    candidate = compact_text(enriched_name)
    if not candidate:
        return None

    curr = compact_text(current_name)
    curr_symbol = normalize_symbol(curr)
    target_symbol = normalize_symbol(symbol)

    # Overwrite if current name is missing/ticker-like; otherwise keep unless user asked latest data overwrite.
    if not curr or curr_symbol == target_symbol:
        return candidate

    # User requested overwrite with newest data, so prefer enriched name whenever available.
    return candidate


def build_updates_df(df_supa: pd.DataFrame, eq_alias: pd.DataFrame, etf_alias: pd.DataFrame) -> pd.DataFrame:
    base = df_supa.copy()
    base["alias_symbol"] = base["symbol"]

    m_etf = base.merge(etf_alias, on="alias_symbol", how="left", suffixes=("", "_etf"))
    m_eq = base.merge(eq_alias, on="alias_symbol", how="left", suffixes=("", "_eq"))

    def col(df: pd.DataFrame, *names: str) -> pd.Series:
        for name in names:
            if name in df.columns:
                return df[name]
        return pd.Series([None] * len(df), index=df.index)

    out = base[["symbol", "name", "asset_type", "sector", "industry", "short_description", "description", "tags"]].copy()

    out["name_new"] = col(m_etf, "name_enriched_etf", "name_enriched").combine_first(col(m_eq, "name_enriched_eq", "name_enriched"))
    out["asset_type_new"] = col(m_etf, "asset_type_enriched_etf", "asset_type_enriched").combine_first(col(m_eq, "asset_type_enriched_eq", "asset_type_enriched"))
    out["sector_new"] = col(m_etf, "sector_etf", "sector").combine_first(col(m_eq, "sector_eq", "sector"))
    out["industry_new"] = col(m_etf, "industry_etf", "industry").combine_first(col(m_eq, "industry_eq", "industry"))
    out["short_description_new"] = col(m_etf, "short_description_enriched_etf", "short_description_enriched").combine_first(col(m_eq, "short_description_enriched_eq", "short_description_enriched"))
    out["tags_new"] = col(m_etf, "tags_enriched_etf", "tags_enriched").combine_first(col(m_eq, "tags_enriched_eq", "tags_enriched"))

    out["name_up"] = out.apply(
        lambda r: choose_name(r["name"], r["symbol"], r["name_new"])
        or compact_text(r["name"])
        or normalize_symbol(r["symbol"]),
        axis=1,
    )
    out["asset_type_up"] = out.apply(
        lambda r: compact_text(r["asset_type"]) or compact_text(r["asset_type_new"]) or None,
        axis=1,
    )
    out["sector_up"] = out.apply(
        lambda r: compact_text(r["sector"]) or compact_text(r["sector_new"]) or None,
        axis=1,
    )
    out["industry_up"] = out.apply(
        lambda r: compact_text(r["industry"]) or compact_text(r["industry_new"]) or None,
        axis=1,
    )
    out["short_description_up"] = out.apply(
        lambda r: compact_text(r["short_description"]) or compact_text(r["short_description_new"]) or None,
        axis=1,
    )
    out["description_up"] = out["short_description_up"]
    out["tags_up"] = out.apply(lambda r: r["tags"] if isinstance(r["tags"], list) and r["tags"] else r["tags_new"], axis=1)

    updates = out[
        ["symbol", "name_up", "asset_type_up", "sector_up", "industry_up", "short_description_up", "description_up", "tags_up"]
    ].rename(
        columns={
            "name_up": "name",
            "asset_type_up": "asset_type",
            "sector_up": "sector",
            "industry_up": "industry",
            "short_description_up": "short_description",
            "description_up": "description",
            "tags_up": "tags",
        }
    )

    updates = updates.dropna(how="all", subset=["name", "asset_type", "sector", "industry", "short_description", "description", "tags"])
    updates = updates.drop_duplicates("symbol")
    updates["name"] = updates["name"].map(compact_text)
    updates["name"] = updates.apply(
        lambda r: r["name"] if compact_text(r["name"]) else normalize_symbol(r["symbol"]),
        axis=1,
    )
    return updates


def sanitize_row_for_json(row: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key, value in row.items():
        if key == "tags":
            if isinstance(value, list):
                out[key] = [compact_text(v) for v in value if compact_text(v)]
            elif value is None:
                out[key] = []
            else:
                cleaned = compact_text(value)
                out[key] = [cleaned] if cleaned else []
            continue

        if isinstance(value, float) and pd.isna(value):
            out[key] = None
            continue
        if pd.isna(value) if not isinstance(value, (list, dict, str, bytes)) else False:
            out[key] = None
            continue
        out[key] = value
    return out


def upsert_instruments(*, supabase_url: str, service_key: str, rows: List[Dict[str, Any]]) -> None:
    if not rows:
        return

    endpoint = f"{supabase_url}/rest/v1/instruments?on_conflict=symbol"
    req = Request(
        endpoint,
        method="POST",
        data=json.dumps(rows).encode("utf-8"),
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        },
    )
    try:
        with urlopen(req, timeout=180):
            return
    except HTTPError as error:
        body = ""
        try:
            body = error.read().decode("utf-8", errors="replace")
        except Exception:
            body = "<no body>"
        raise RuntimeError(f"Supabase upsert failed: HTTP {error.code} {error.reason}. Body: {body}") from error


def fetch_active_symbol_name_rows(*, supabase_url: str, service_key: str, page_size: int = 1000) -> List[Dict[str, Any]]:
    endpoint = f"{supabase_url}/rest/v1/instruments"
    offset = 0
    rows: List[Dict[str, Any]] = []

    while True:
        query = urlencode(
            {
                "select": "symbol,name,sector,industry,short_description,asset_type",
                "is_active": "eq.true",
                "order": "symbol.asc",
                "limit": str(page_size),
                "offset": str(offset),
            },
            safe="(),",
        )
        req = Request(
            f"{endpoint}?{query}",
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
            },
        )
        with urlopen(req, timeout=120) as response:
            payload = json.loads(response.read().decode("utf-8"))

        if not isinstance(payload, list) or len(payload) == 0:
            break

        rows.extend(payload)
        offset += len(payload)

    return rows


def delete_by_symbols(*, supabase_url: str, service_key: str, symbols: List[str], chunk_size: int = 200) -> int:
    if not symbols:
        return 0

    endpoint = f"{supabase_url}/rest/v1/instruments"
    deleted = 0

    for i in range(0, len(symbols), chunk_size):
        chunk = symbols[i : i + chunk_size]
        condition = f"in.({','.join(chunk)})"
        query = urlencode(
            {
                "is_active": "eq.true",
                "symbol": condition,
            },
            safe="(),.-_/",
        )
        url = f"{endpoint}?{query}"
        req = Request(
            url,
            method="DELETE",
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Prefer": "return=minimal",
            },
        )
        try:
            with urlopen(req, timeout=180):
                deleted += len(chunk)
        except HTTPError as error:
            body = ""
            try:
                body = error.read().decode("utf-8", errors="replace")
            except Exception:
                body = "<no body>"
            raise RuntimeError(f"Supabase cleanup failed: HTTP {error.code} {error.reason}. Body: {body}") from error

    return deleted


def delete_instruments_without_names(*, supabase_url: str, service_key: str) -> int:
    rows = fetch_active_symbol_name_rows(supabase_url=supabase_url, service_key=service_key)
    to_delete: List[str] = []
    for row in rows:
        symbol = normalize_symbol(row.get("symbol"))
        name = compact_text(row.get("name"))
        sector = compact_text(row.get("sector"))
        industry = compact_text(row.get("industry"))
        short_description = compact_text(row.get("short_description"))
        asset_type = compact_text(row.get("asset_type"))
        if not symbol:
            continue
        if symbol in PROTECTED_SYMBOLS:
            continue
        if not name:
            to_delete.append(symbol)
            continue
        # Only delete ticker-like names if the row is otherwise low-quality (no enrichment fields).
        if normalize_symbol(name) == symbol and not sector and not industry and not short_description and not asset_type:
            to_delete.append(symbol)

    unique_symbols = sorted(set(to_delete))
    return delete_by_symbols(supabase_url=supabase_url, service_key=service_key, symbols=unique_symbols)


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    load_env_file(root / ".env.local")
    load_env_file(root / ".env")

    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        print("Missing env vars: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 1

    page_size = max(100, int(os.getenv("INSTRUMENT_SYNC_PAGE_SIZE", "1000")))
    df_supa = fetch_supabase_instruments(supabase_url=supabase_url, service_key=service_key, page_size=page_size)
    if df_supa.empty:
        print("[sync-instrument-profiles] No active instruments found.")
        return 0

    df_eq, df_etf = build_financedatabase_frames()
    eq_alias = expand_alias_df(df_eq)
    etf_alias = expand_alias_df(df_etf)

    print(f"[sync-instrument-profiles] Lookup coverage: equity_keys={len(eq_alias)} etf_keys={len(etf_alias)}")

    updates_df = build_updates_df(df_supa, eq_alias, etf_alias)
    if updates_df.empty:
        print("[sync-instrument-profiles] No matched records.")
        return 0

    now_iso = datetime.now(timezone.utc).isoformat()
    updates_df["updated_at"] = now_iso

    rows = [sanitize_row_for_json(row) for row in updates_df.to_dict(orient="records")]
    chunk_size = 500
    total = len(rows)
    for i in range(0, total, chunk_size):
        chunk = rows[i : i + chunk_size]
        upsert_instruments(supabase_url=supabase_url, service_key=service_key, rows=chunk)
        print(f"[sync-instrument-profiles] Upserted {min(i + len(chunk), total)}/{total}")

    print(f"[sync-instrument-profiles] Complete: rewritten={total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
