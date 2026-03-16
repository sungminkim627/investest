import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

interface InstrumentRow {
  symbol: string;
  name: string;
  market: string | null;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  category: string | null;
  asset_type: string | null;
  long_business_summary?: string | null;
  market_cap?: number | null;
  forward_pe?: number | null;
  trailing_pe?: number | null;
  beta?: number | null;
  debt_to_equity?: number | null;
  return_on_equity?: number | null;
  total_revenue?: number | null;
  net_income_to_common?: number | null;
  year_change_1y?: number | null;
}

const POPULAR_DEFAULT_SYMBOLS = ["SPY", "VOO", "VTI", "QQQ", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "BND"] as const;

type PresetId =
  | "us_large_cap"
  | "canadian_dividend"
  | "tech_sector"
  | "emerging_markets"
  | "bond_funds"
  | "high_yield"
  | "growth"
  | "value";

interface SearchFilters {
  assetType?: string;
  market?: string;
  sector?: string;
  industry?: string;
  category?: string;
  theme?: string;
  sectorOther?: boolean;
  industryOther?: boolean;
  categoryOther?: boolean;
}

const PRESET_FILTERS: Record<PresetId, SearchFilters> = {
  us_large_cap: { assetType: "STOCK", market: "US", theme: "Large" },
  canadian_dividend: { market: "CANADA", theme: "Dividend" },
  tech_sector: { theme: "Tech" },
  emerging_markets: { theme: "Emerging" },
  bond_funds: { assetType: "ETF", theme: "Bond" },
  high_yield: { theme: "High Yield" },
  growth: { theme: "Growth" },
  value: { theme: "Value" }
};

const FILTER_TOP_N = 15;

function quoteForIn(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function fetchTopFieldValues(assetType: string, field: "sector" | "industry" | "category", topN = FILTER_TOP_N): Promise<string[]> {
  const res = await supabaseAdmin.from("instruments").select(field).eq("asset_type", assetType).limit(5000);
  if (res.error) throw new Error(`Filter value lookup failed for ${field}: ${res.error.message}`);

  const counts = new Map<string, number>();
  for (const row of (res.data ?? []) as Array<Record<string, string | null>>) {
    const raw = String(row[field] ?? "").trim();
    if (!raw) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], undefined, { sensitivity: "base" }))
    .slice(0, topN)
    .map(([value]) => value);
}

function mergeUniqueRows(groups: InstrumentRow[][], limit = 10): InstrumentRow[] {
  const map = new Map<string, InstrumentRow>();
  for (const group of groups) {
    for (const row of group) {
      if (!map.has(row.symbol)) map.set(row.symbol, row);
      if (map.size >= limit) break;
    }
    if (map.size >= limit) break;
  }
  return [...map.values()].slice(0, limit);
}

function sortByValuation(rows: InstrumentRow[]) {
  return [...rows].sort((a, b) => {
    const aVal = a.market_cap ?? Number.NEGATIVE_INFINITY;
    const bVal = b.market_cap ?? Number.NEGATIVE_INFINITY;
    if (aVal !== bVal) return bVal - aVal;
    const symbolCmp = a.symbol.localeCompare(b.symbol, undefined, { numeric: true, sensitivity: "base" });
    if (symbolCmp !== 0) return symbolCmp;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

function applyBaseFilters(builder: any, filters: SearchFilters, otherFieldExclusions: Partial<Record<"sector" | "industry" | "category", string[]>> = {}) {
  let query = builder;

  if (filters.assetType) query = query.eq("asset_type", filters.assetType);
  if (filters.market) query = query.eq("market", filters.market);
  if (filters.sector && !filters.sectorOther) query = query.eq("sector", filters.sector);
  if (filters.industry && !filters.industryOther) query = query.eq("industry", filters.industry);
  if (filters.category && !filters.categoryOther) query = query.eq("category", filters.category);
  if (filters.sectorOther) {
    const values = otherFieldExclusions.sector ?? [];
    query = query.not("sector", "is", null).neq("sector", "");
    if (values.length) query = query.not("sector", "in", `(${values.map(quoteForIn).join(",")})`);
  }
  if (filters.industryOther) {
    const values = otherFieldExclusions.industry ?? [];
    query = query.not("industry", "is", null).neq("industry", "");
    if (values.length) query = query.not("industry", "in", `(${values.map(quoteForIn).join(",")})`);
  }
  if (filters.categoryOther) {
    const values = otherFieldExclusions.category ?? [];
    query = query.not("category", "is", null).neq("category", "");
    if (values.length) query = query.not("category", "in", `(${values.map(quoteForIn).join(",")})`);
  }
  if (filters.theme) {
    query = query.or(`sector.ilike.%${filters.theme}%,industry.ilike.%${filters.theme}%,category.ilike.%${filters.theme}%,name.ilike.%${filters.theme}%`);
  }

  return query;
}

function mapResult(row: InstrumentRow) {
  const descriptor = [row.sector, row.industry, row.category].filter(Boolean).join(" - ") || null;
  return {
    symbol: row.symbol,
    name: row.name,
    exchange: row.exchange ?? null,
    country: row.market ?? null,
    sector: row.sector ?? null,
    industry: row.industry ?? null,
    description: descriptor,
    assetType: row.asset_type ?? null,
    longBusinessSummary: row.long_business_summary ?? null,
    marketCap: row.market_cap ?? null,
    forwardPE: row.forward_pe ?? null,
    trailingPE: row.trailing_pe ?? null,
    beta: row.beta ?? null,
    debtToEquity: row.debt_to_equity ?? null,
    returnOnEquity: row.return_on_equity ?? null,
    totalRevenue: row.total_revenue ?? null,
    netIncomeToCommon: row.net_income_to_common ?? null,
    yearChange1Y: row.year_change_1y ?? null
  };
}

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("query") ?? "";
    const trimmedQuery = query.trim();
    const normalizedQuery = trimmedQuery.toUpperCase();
    const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "100");
    const rawOffset = Number(request.nextUrl.searchParams.get("offset") ?? "0");
    const limit = Number.isFinite(rawLimit) ? Math.max(5, Math.min(50, Math.trunc(rawLimit))) : 20;
    const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0;
    const overfetch = Math.min(500, offset + limit + 20);

    const presetIdRaw = request.nextUrl.searchParams.get("preset") ?? "";
    const presetId = (presetIdRaw in PRESET_FILTERS ? presetIdRaw : "") as PresetId | "";

    const rawAssetType = request.nextUrl.searchParams.get("assetType");
    const normalizedAssetType = rawAssetType ? rawAssetType.trim().toUpperCase() : undefined;
    const explicitFilters: SearchFilters = {
      assetType: normalizedAssetType ?? undefined,
      market: request.nextUrl.searchParams.get("market") ?? undefined,
      sector: request.nextUrl.searchParams.get("sector") === "__other__" ? undefined : (request.nextUrl.searchParams.get("sector") ?? undefined),
      industry: request.nextUrl.searchParams.get("industry") === "__other__" ? undefined : (request.nextUrl.searchParams.get("industry") ?? undefined),
      category: request.nextUrl.searchParams.get("category") === "__other__" ? undefined : (request.nextUrl.searchParams.get("category") ?? undefined),
      sectorOther: request.nextUrl.searchParams.get("sector") === "__other__",
      industryOther: request.nextUrl.searchParams.get("industry") === "__other__",
      categoryOther: request.nextUrl.searchParams.get("category") === "__other__"
    };

    const filters: SearchFilters = {
      ...(presetId ? PRESET_FILTERS[presetId] : {}),
      ...Object.fromEntries(Object.entries(explicitFilters).filter(([, v]) => Boolean(v)))
    };

    const hasFilters = Object.keys(filters).length > 0;
    const otherFieldExclusions: Partial<Record<"sector" | "industry" | "category", string[]>> = {};
    const needsOtherLookups = Boolean(filters.assetType) && (filters.sectorOther || filters.industryOther || filters.categoryOther);
    if (needsOtherLookups) {
      const assetType = String(filters.assetType);
      const [topSectors, topIndustries, topCategories] = await Promise.all([
        filters.sectorOther ? fetchTopFieldValues(assetType, "sector") : Promise.resolve([]),
        filters.industryOther ? fetchTopFieldValues(assetType, "industry") : Promise.resolve([]),
        filters.categoryOther ? fetchTopFieldValues(assetType, "category") : Promise.resolve([])
      ]);
      otherFieldExclusions.sector = topSectors;
      otherFieldExclusions.industry = topIndustries;
      otherFieldExclusions.category = topCategories;
    }

    if (trimmedQuery.length < 1 && !hasFilters) {
      const defaults = await supabaseAdmin
        .from("instruments")
        .select("symbol,name,market,exchange,sector,industry,category,asset_type,long_business_summary,market_cap,forward_pe,trailing_pe,beta,debt_to_equity,return_on_equity,total_revenue,net_income_to_common,year_change_1y")
        .in("symbol", [...POPULAR_DEFAULT_SYMBOLS])
        .limit(20);

      if (defaults.error) throw new Error(`Instrument default search failed: ${defaults.error.message}`);

      const bySymbol = new Map<string, InstrumentRow>();
      for (const row of (defaults.data ?? []) as InstrumentRow[]) {
        bySymbol.set(row.symbol.toUpperCase(), row);
      }

      const orderedPopular = POPULAR_DEFAULT_SYMBOLS
        .map((symbol) => bySymbol.get(symbol))
        .filter((row): row is InstrumentRow => Boolean(row));

      if (orderedPopular.length >= offset + limit) {
        return NextResponse.json({
          results: orderedPopular.slice(offset, offset + limit).map(mapResult)
        });
      }

      const fallback = await supabaseAdmin
        .from("instruments")
        .select("symbol,name,market,exchange,sector,industry,category,asset_type,long_business_summary,market_cap,forward_pe,trailing_pe,beta,debt_to_equity,return_on_equity,total_revenue,net_income_to_common,year_change_1y")
        .order("market_cap", { ascending: false, nullsFirst: false })
        .order("symbol", { ascending: true })
        .limit(overfetch);

      if (fallback.error) throw new Error(`Instrument fallback search failed: ${fallback.error.message}`);

      const mergedDefaults = mergeUniqueRows([orderedPopular, (fallback.data ?? []) as InstrumentRow[]], overfetch);
      return NextResponse.json({
        results: mergedDefaults.slice(offset, offset + limit).map(mapResult),
        total: mergedDefaults.length
      });
    }

    if (trimmedQuery.length < 1 && hasFilters) {
      let filteredQuery = supabaseAdmin
        .from("instruments")
        .select("symbol,name,market,exchange,sector,industry,category,asset_type,long_business_summary,market_cap,forward_pe,trailing_pe,beta,debt_to_equity,return_on_equity,total_revenue,net_income_to_common,year_change_1y");

      filteredQuery = applyBaseFilters(filteredQuery, filters, otherFieldExclusions)
        .order("market_cap", { ascending: false, nullsFirst: false })
        .order("symbol", { ascending: true })
        .limit(overfetch);

      const filtered = await filteredQuery;
      if (filtered.error) throw new Error(`Instrument filtered search failed: ${filtered.error.message}`);

      const countQuery = applyBaseFilters(
        supabaseAdmin.from("instruments").select("symbol", { count: "exact", head: true }),
        filters,
        otherFieldExclusions
      );
      const countRes = await countQuery;
      if (countRes.error) throw new Error(`Instrument filtered count failed: ${countRes.error.message}`);

      return NextResponse.json({
        results: ((filtered.data ?? []) as InstrumentRow[]).slice(offset, offset + limit).map(mapResult),
        total: countRes.count ?? (filtered.data ?? []).length
      });
    }

    let bySymbolPrefix = supabaseAdmin
      .from("instruments")
      .select("symbol,name,market,exchange,sector,industry,category,asset_type,long_business_summary,market_cap,forward_pe,trailing_pe,beta,debt_to_equity,return_on_equity,total_revenue,net_income_to_common,year_change_1y")
      .ilike("symbol", `${normalizedQuery}%`)
      .order("market_cap", { ascending: false, nullsFirst: false })
      .order("symbol", { ascending: true })
      .limit(overfetch);

    let byNameContains = supabaseAdmin
      .from("instruments")
      .select("symbol,name,market,exchange,sector,industry,category,asset_type,long_business_summary,market_cap,forward_pe,trailing_pe,beta,debt_to_equity,return_on_equity,total_revenue,net_income_to_common,year_change_1y")
      .ilike("name", `%${trimmedQuery}%`)
      .order("market_cap", { ascending: false, nullsFirst: false })
      .order("symbol", { ascending: true })
      .limit(overfetch);

    let byMetaContains = supabaseAdmin
      .from("instruments")
      .select("symbol,name,market,exchange,sector,industry,category,asset_type,long_business_summary,market_cap,forward_pe,trailing_pe,beta,debt_to_equity,return_on_equity,total_revenue,net_income_to_common,year_change_1y")
      .or(`sector.ilike.%${trimmedQuery}%,industry.ilike.%${trimmedQuery}%,category.ilike.%${trimmedQuery}%`)
      .order("market_cap", { ascending: false, nullsFirst: false })
      .order("symbol", { ascending: true })
      .limit(overfetch);

    bySymbolPrefix = applyBaseFilters(bySymbolPrefix, filters, otherFieldExclusions);
    byNameContains = applyBaseFilters(byNameContains, filters, otherFieldExclusions);
    byMetaContains = applyBaseFilters(byMetaContains, filters, otherFieldExclusions);

    const [symbolRes, nameRes, metaRes] = await Promise.all([bySymbolPrefix, byNameContains, byMetaContains]);

    if (symbolRes.error) throw new Error(`Instrument symbol search failed: ${symbolRes.error.message}`);
    if (nameRes.error) throw new Error(`Instrument name search failed: ${nameRes.error.message}`);
    if (metaRes.error) throw new Error(`Instrument metadata search failed: ${metaRes.error.message}`);

    const merged = sortByValuation(
      mergeUniqueRows(
        [
          (symbolRes.data ?? []) as InstrumentRow[],
          (nameRes.data ?? []) as InstrumentRow[],
          (metaRes.data ?? []) as InstrumentRow[]
        ],
        overfetch
      )
    );

    let totalCount = merged.length;
    if (trimmedQuery.length > 0) {
      let countQuery = supabaseAdmin
        .from("instruments")
        .select("symbol", { count: "exact", head: true })
        .or(`symbol.ilike.${normalizedQuery}%,name.ilike.%${trimmedQuery}%,sector.ilike.%${trimmedQuery}%,industry.ilike.%${trimmedQuery}%,category.ilike.%${trimmedQuery}%`);
      countQuery = applyBaseFilters(countQuery, filters, otherFieldExclusions);
      const countRes = await countQuery;
      if (countRes.error) throw new Error(`Instrument search count failed: ${countRes.error.message}`);
      if (typeof countRes.count === "number") totalCount = countRes.count;
    }

    return NextResponse.json({
      results: merged.slice(offset, offset + limit).map(mapResult),
      total: totalCount
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
}
