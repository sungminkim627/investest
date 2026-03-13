#!/usr/bin/env python3
"""
Delete all rows from public.prices_daily using Supabase REST API.
Use before a full re-download/backfill.
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


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


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    load_env_file(root / ".env.local")
    load_env_file(root / ".env")

    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not supabase_url or not service_key:
        print("Missing env vars: NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY")
        return 1

    # id=not.is.null deletes all rows while keeping table/schema.
    query = urlencode({"id": "not.is.null"}, safe="(),.-_")
    req = Request(
        f"{supabase_url}/rest/v1/prices_daily?{query}",
        method="DELETE",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Prefer": "return=minimal",
        },
    )
    with urlopen(req, timeout=180):
        pass

    print("[clear-prices-daily] Cleared all rows from public.prices_daily")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
