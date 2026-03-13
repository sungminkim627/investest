import { addYears, isWithinInterval, parseISO } from "date-fns";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchHistoricalAdjustedClose } from "@/lib/api/marketData";
import { PricePoint } from "@/types";
import { getExpectedLatestCloseDate, nextDate, shiftDate } from "@/lib/portfolio/market-calendar";

const inFlightBackfills = new Map<string, Promise<void>>();

interface SymbolMarket {
  symbol: string;
  market: string;
}

async function resolveSymbolMarkets(symbols: string[]): Promise<SymbolMarket[]> {
  const uniqueSymbols = [...new Set(symbols.map((s) => s.toUpperCase()))];
  if (!uniqueSymbols.length) return [];

  const { data, error } = await supabaseAdmin
    .from("instruments")
    .select("symbol,market")
    .in("symbol", uniqueSymbols);

  if (error) {
    throw new Error(`Failed to resolve symbol markets: ${error.message}`);
  }

  const marketBySymbol = new Map<string, string>();
  for (const row of data ?? []) {
    const symbol = String(row.symbol ?? "").toUpperCase();
    const market = String(row.market ?? "").toUpperCase() || "US";
    if (symbol && !marketBySymbol.has(symbol)) {
      marketBySymbol.set(symbol, market);
    }
  }

  return uniqueSymbols.map((symbol) => ({ symbol, market: marketBySymbol.get(symbol) ?? "US" }));
}

export async function getCachedPrices(symbol: string, market: string, startDate: string, endDate: string): Promise<PricePoint[]> {
  const { data, error } = await supabaseAdmin
    .from("prices_daily")
    .select("symbol,date,adj_close")
    .eq("symbol", symbol)
    .eq("market", market)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });

  if (error) {
    throw new Error(`Failed to load cached prices: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    symbol: row.symbol,
    date: row.date,
    adjClose: Number(row.adj_close)
  }));
}

function filterRange(points: PricePoint[], startDate: string, endDate: string) {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  return points.filter((point) => {
    const date = parseISO(point.date);
    return isWithinInterval(date, { start, end });
  });
}

async function getLatestCachedDateByMarket(symbol: string, market: string, endDate: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("prices_daily")
    .select("date")
    .eq("symbol", symbol)
    .eq("market", market)
    .lte("date", endDate)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get latest cached date for ${symbol} (${market}): ${error.message}`);
  }
  return data?.date ?? null;
}

async function backfillSymbolIncremental(symbol: string, market: string, startDate: string, endDate: string) {
  const lockKey = `${symbol}|${market}|${startDate}|${endDate}`;
  const inFlight = inFlightBackfills.get(lockKey);

  if (inFlight) {
    console.info(`[prices] symbol=${symbol} market=${market} waiting_for_inflight_backfill=true`);
    await inFlight;
    return;
  }

  const task = (async () => {
    const fetched = await fetchHistoricalAdjustedClose(symbol, startDate, endDate);
    if (!fetched.length) {
      console.info(`[prices] symbol=${symbol} tiingo_rows=0`);
      return;
    }

    const { error } = await supabaseAdmin.from("prices_daily").upsert(
      fetched.map((row) => ({
        symbol: row.symbol,
        market,
        date: row.date,
        adj_close: row.adjClose
      })),
      { onConflict: "symbol,market,date", ignoreDuplicates: true }
    );
    if (error) throw new Error(`Failed to backfill prices: ${error.message}`);
    console.info(`[prices] symbol=${symbol} market=${market} upsert_status=ok rows=${fetched.length}`);
  })().finally(() => {
    inFlightBackfills.delete(lockKey);
  });

  inFlightBackfills.set(lockKey, task);
  await task;
}

function getTenYearStartDate(endDate: string) {
  return addYears(parseISO(endDate), -10).toISOString().slice(0, 10);
}

export async function getOrFetchPricesForSymbols(symbols: string[], startDate: string, endDate: string): Promise<PricePoint[]> {
  const symbolMarkets = await resolveSymbolMarkets(symbols);
  const uniqueSymbols = symbolMarkets.map((item) => item.symbol);
  const expectedLatestClose = getExpectedLatestCloseDate();
  const acceptableLatestWithLeeway = shiftDate(expectedLatestClose, -1);
  const latestDatePairs = await Promise.all(
    symbolMarkets.map(async ({ symbol, market }) => {
      const latest = await getLatestCachedDateByMarket(symbol, market, endDate);
      return { symbol, market, latest };
    })
  );

  const latestByKey = new Map(latestDatePairs.map((x) => [`${x.symbol}|${x.market}`, x.latest]));
  const latestKnownDates = latestDatePairs.map((x) => x.latest).filter((v): v is string => Boolean(v));
  const globalLatest = latestKnownDates.length
    ? latestKnownDates.reduce((acc, cur) => (cur > acc ? cur : acc), latestKnownDates[0])
    : null;

  const allAtLeastLeeway = latestDatePairs.every((row) => row.latest !== null && row.latest >= acceptableLatestWithLeeway);
  console.info(
    `[prices] expected_latest_close=${expectedLatestClose} acceptable_latest_with_leeway=${acceptableLatestWithLeeway} global_latest=${globalLatest ?? "none"} all_at_least_leeway=${allAtLeastLeeway}`
  );

  const toFetch = allAtLeastLeeway
    ? []
    : symbolMarkets.filter(({ symbol, market }) => {
      const latest = latestByKey.get(`${symbol}|${market}`);
      if (!latest) return true;
      return latest < acceptableLatestWithLeeway;
    });

  console.info(
    `[prices] symbols=${symbolMarkets.map((x) => `${x.symbol}:${x.market}`).join(",")} symbols_to_fetch=${toFetch.map((x) => `${x.symbol}:${x.market}`).join(",") || "none"}`
  );

  await Promise.all(
    toFetch.map(async ({ symbol, market }) => {
      const latest = latestByKey.get(`${symbol}|${market}`);
      const fetchStart = latest ? nextDate(latest) : getTenYearStartDate(endDate);
      if (fetchStart > endDate) {
        console.info(`[prices] symbol=${symbol} market=${market} skip_fetch=true reason=fetchStart_after_endDate`);
        return;
      }
      console.info(`[prices] symbol=${symbol} market=${market} fetch_start=${fetchStart} fetch_end=${endDate}`);
      await backfillSymbolIncremental(symbol, market, fetchStart, endDate);
    })
  );

  const allRows = await Promise.all(symbolMarkets.map(({ symbol, market }) => getCachedPrices(symbol, market, startDate, endDate)));
  for (let i = 0; i < symbolMarkets.length; i += 1) {
    console.info(`[prices] symbol=${symbolMarkets[i].symbol} market=${symbolMarkets[i].market} final_rows=${allRows[i].length}`);
  }
  return filterRange(allRows.flat(), startDate, endDate);
}
