import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const FILTER_TOP_N = 15;
const OTHER_VALUE = "__other__";

type AssetType = "Stock" | "ETF";
type FilterField = "sector" | "industry" | "category";

interface OptionItem {
  value: string;
  label: string;
  count: number;
}

interface InstrumentFacetRow {
  sector: string | null;
  industry: string | null;
  category: string | null;
}

function toClean(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function buildCounts(rows: InstrumentFacetRow[], field: FilterField) {
  const map = new Map<string, number>();
  for (const row of rows) {
    const raw = toClean(row[field]);
    if (!raw) continue;
    map.set(raw, (map.get(raw) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], undefined, { sensitivity: "base" }));
}

async function fetchAssetRows(assetType: AssetType): Promise<InstrumentFacetRow[]> {
  const rows: InstrumentFacetRow[] = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("instruments")
      .select("sector,industry,category")
      .eq("asset_type", assetType)
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`Failed to fetch filter rows: ${error.message}`);
    const batch = (data ?? []) as InstrumentFacetRow[];
    if (!batch.length) break;
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += batch.length;
  }

  return rows;
}

function includeSelectedOption(
  options: OptionItem[],
  counts: Array<[string, number]>,
  selected: string
) {
  if (!selected || selected === "all" || selected === OTHER_VALUE) return options;
  if (options.some((opt) => opt.value === selected)) return options;
  const selectedCount = counts.find(([value]) => value === selected)?.[1] ?? 0;
  return [...options, { value: selected, label: selected, count: selectedCount }];
}

function matchesField(
  row: InstrumentFacetRow,
  field: FilterField,
  selected: string | null,
  topSets: Partial<Record<FilterField, Set<string>>>
) {
  if (!selected || selected === "all") return true;
  const value = toClean(row[field]);
  if (!value) return false;
  if (selected === OTHER_VALUE) {
    const topSet = topSets[field] ?? new Set<string>();
    return !topSet.has(value);
  }
  return value === selected;
}

function toOptions(
  counts: Array<[string, number]>,
  topN: number,
  selected: string | null
) {
  const top = counts.slice(0, topN).map(([value, count]) => ({ value, label: value, count }));
  const otherCount = counts.slice(topN).reduce((sum, [, count]) => sum + count, 0);
  let options = [...top];
  if (otherCount > 0) options.push({ value: OTHER_VALUE, label: "Other", count: otherCount });
  options = includeSelectedOption(options, counts, selected ?? "");
  return options;
}

export async function GET(request: NextRequest) {
  try {
    const rawAssetType = request.nextUrl.searchParams.get("assetType");
    const assetType: AssetType = rawAssetType === "ETF" ? "ETF" : "Stock";
    const rawTop = Number(request.nextUrl.searchParams.get("top") ?? FILTER_TOP_N);
    const topN = Number.isFinite(rawTop) ? Math.max(10, Math.min(20, Math.trunc(rawTop))) : FILTER_TOP_N;
    const selected = {
      sector: request.nextUrl.searchParams.get("sector"),
      industry: request.nextUrl.searchParams.get("industry"),
      category: request.nextUrl.searchParams.get("category")
    };

    const rows = await fetchAssetRows(assetType);
    const baseCounts = {
      sector: buildCounts(rows, "sector"),
      industry: buildCounts(rows, "industry"),
      category: buildCounts(rows, "category")
    };
    const topSets: Partial<Record<FilterField, Set<string>>> = {
      sector: new Set(baseCounts.sector.slice(0, topN).map(([value]) => value)),
      industry: new Set(baseCounts.industry.slice(0, topN).map(([value]) => value)),
      category: new Set(baseCounts.category.slice(0, topN).map(([value]) => value))
    };

    const rowsForSector = rows.filter(
      (row) =>
        matchesField(row, "industry", selected.industry, topSets) &&
        (assetType === "ETF" ? matchesField(row, "category", selected.category, topSets) : true)
    );
    const rowsForIndustry = rows.filter(
      (row) =>
        matchesField(row, "sector", selected.sector, topSets) &&
        (assetType === "ETF" ? matchesField(row, "category", selected.category, topSets) : true)
    );
    const rowsForCategory = rows.filter(
      (row) => matchesField(row, "sector", selected.sector, topSets) && matchesField(row, "industry", selected.industry, topSets)
    );
    const rowsForTotalMatches = rows.filter(
      (row) =>
        matchesField(row, "sector", selected.sector, topSets) &&
        matchesField(row, "industry", selected.industry, topSets) &&
        (assetType === "ETF" ? matchesField(row, "category", selected.category, topSets) : true)
    );

    const sectorOptions = toOptions(buildCounts(rowsForSector, "sector"), topN, selected.sector);
    const industryOptions = toOptions(buildCounts(rowsForIndustry, "industry"), topN, selected.industry);
    const categoryOptions = assetType === "ETF"
      ? toOptions(buildCounts(rowsForCategory, "category"), topN, selected.category)
      : [];

    return NextResponse.json({
      assetType,
      topN,
      totalMatches: rowsForTotalMatches.length,
      appliedFilters: selected,
      sector: sectorOptions,
      industry: industryOptions,
      category: categoryOptions
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
}
