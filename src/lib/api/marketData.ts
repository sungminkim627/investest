import { addYears, format } from "date-fns";
import { env } from "@/lib/supabase/env";

export interface MarketSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  description?: string | null;
  assetType?: string | null;
}

export interface MarketEodPoint {
  symbol: string;
  date: string;
  adjClose: number;
}

interface TiingoSearchResponse {
  ticker: string;
  name: string;
  exchangeCode?: string;
}

interface TiingoTickerMetadataResponse {
  ticker: string;
  name?: string;
  exchangeCode?: string;
  assetType?: string;
  description?: string;
}

interface TiingoPriceRow {
  date: string;
  adjClose: number;
}

function toShortDescription(value?: string | null, maxLength = 180): string | null {
  const compact = String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!compact) return null;
  if (compact.length <= maxLength) return compact;
  const trimmed = compact.slice(0, maxLength - 1);
  const breakAt = Math.max(trimmed.lastIndexOf(". "), trimmed.lastIndexOf("; "), trimmed.lastIndexOf(", "), trimmed.lastIndexOf(" "));
  const safe = breakAt >= Math.floor(maxLength * 0.55) ? trimmed.slice(0, breakAt) : trimmed;
  return `${safe.trim()}...`;
}

// Tiingo is selected because it provides reliable US/ETF symbol search + adjusted EOD history on a simple REST API.
export async function searchTickers(query: string): Promise<MarketSearchResult[]> {
  if (!query.trim()) return [];

  const url = new URL(`${env.MARKET_DATA_BASE_URL}/tiingo/utilities/search`);
  url.searchParams.set("query", query);
  url.searchParams.set("token", env.MARKET_DATA_API_KEY);

  const response = await fetch(url, { next: { revalidate: 300 } });
  if (!response.ok) {
    throw new Error(`Ticker search failed with status ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(`Ticker search returned unexpected payload: ${JSON.stringify(payload).slice(0, 300)}`);
  }
  const data = payload as TiingoSearchResponse[];
  const normalized = data
    .map((item) => ({
      symbol: (item.ticker ?? "").toUpperCase().trim(),
      name: (item.name ?? "").trim(),
      exchange: (item.exchangeCode ?? "N/A").trim() || "N/A"
    }))
    .filter((item) => item.symbol.length > 0);

  const seen = new Set<string>();
  const deduped: MarketSearchResult[] = [];
  for (const item of normalized) {
    const key = `${item.symbol}|${item.exchange}|${item.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= 10) break;
  }

  return deduped;
}

export async function fetchHistoricalAdjustedClose(symbol: string, startDate: string, endDate: string): Promise<MarketEodPoint[]> {
  const boundedStart = format(addYears(new Date(endDate), -10), "yyyy-MM-dd");
  const normalizedStart = startDate < boundedStart ? boundedStart : startDate;

  const url = new URL(`${env.MARKET_DATA_BASE_URL}/tiingo/daily/${encodeURIComponent(symbol)}/prices`);
  url.searchParams.set("startDate", normalizedStart);
  url.searchParams.set("endDate", endDate);
  url.searchParams.set("resampleFreq", "daily");
  url.searchParams.set("token", env.MARKET_DATA_API_KEY);
  console.info(`[tiingo] fetch symbol=${symbol.toUpperCase()} range=${normalizedStart}..${endDate}`);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Historical price fetch failed for ${symbol}: ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(
      `Historical price payload for ${symbol} was not an array: ${JSON.stringify(payload).slice(0, 300)}`
    );
  }
  const rows = payload as TiingoPriceRow[];
  return rows
    .filter((row) => Number.isFinite(row.adjClose))
    .map((row) => ({
      symbol: symbol.toUpperCase(),
      date: row.date.slice(0, 10),
      adjClose: row.adjClose
    }));
}

export async function fetchTickerMetadata(symbol: string): Promise<MarketSearchResult | null> {
  const upper = symbol.toUpperCase();
  const url = new URL(`${env.MARKET_DATA_BASE_URL}/tiingo/daily/${encodeURIComponent(upper)}`);
  url.searchParams.set("token", env.MARKET_DATA_API_KEY);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    return null;
  }

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as TiingoTickerMetadataResponse;
  return {
    symbol: (data.ticker ?? upper).toUpperCase(),
    name: (data.name ?? upper).trim(),
    exchange: (data.exchangeCode ?? "N/A").trim() || "N/A",
    description: toShortDescription(data.description),
    assetType: data.assetType?.trim() || null
  };
}
