import { NextRequest, NextResponse } from "next/server";
import { startOfWeek, addWeeks, parseISO } from "date-fns";
import { z } from "zod";
import {
  buildProjectionSeriesFromAssets,
  computeMetrics,
  computeRiskScore,
  getDateRangeForTimeRange,
  getProjectionMonthsFromSeries,
  scaleSeriesToEndValue,
  singleAssetSeries
} from "@/lib/portfolio/engine";
import { getOrFetchPricesForSymbols } from "@/lib/portfolio/cache";
import { BenchmarkResponse, TimeRange } from "@/types";

const bodySchema = z.object({
  benchmarkSymbol: z.enum(["SPY", "QQQ", "VTI", "AGG"]),
  timeRange: z.enum(["1Y", "3Y", "5Y", "10Y"]),
  startValue: z.number().positive().optional(),
  contributionAmount: z.number().min(0).optional(),
  contributionFrequency: z.enum(["weekly", "monthly", "yearly"]).optional(),
  rebalanceFrequency: z.enum(["none", "monthly", "quarterly", "yearly"]).optional()
});

async function loadBenchmarkPrices(symbol: string, timeRange: TimeRange) {
  const { startDate, endDate } = getDateRangeForTimeRange(timeRange);
  console.info(`[benchmark] symbol=${symbol} range=${timeRange} (${startDate}..${endDate})`);
  return getOrFetchPricesForSymbols([symbol], startDate, endDate);
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid benchmark payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const body = parsed.data;
    const symbol = body.benchmarkSymbol.toUpperCase();
    const allPrices = await loadBenchmarkPrices(symbol, body.timeRange);
    const startValue = body.startValue ?? 10000;

    const rawSeries = singleAssetSeries(symbol, allPrices, 1);
    const benchmarkSeries = scaleSeriesToEndValue(rawSeries, startValue);
    const metrics = computeMetrics(benchmarkSeries);
    const projectionMonths = getProjectionMonthsFromSeries(benchmarkSeries);
    const projectionStartDate = (() => {
      const last = benchmarkSeries[benchmarkSeries.length - 1]?.date;
      if (!last) return undefined;
      const latestDate = parseISO(last);
      const weekStart = startOfWeek(latestDate, { weekStartsOn: 1 });
      const aligned = weekStart <= latestDate ? addWeeks(weekStart, 1) : weekStart;
      return aligned.toISOString().slice(0, 10);
    })();

    const benchmarkProjection = benchmarkSeries.length
      ? buildProjectionSeriesFromAssets({
          holdings: [{ symbol, weight: 100 }],
          prices: allPrices,
          lastActualDate: benchmarkSeries[benchmarkSeries.length - 1].date,
          lastActualValue: benchmarkSeries[benchmarkSeries.length - 1].value,
          projectionStartDate,
          projectionMonths,
          contributionAmount: body.contributionAmount ?? 0,
          contributionFrequency: body.contributionFrequency ?? "monthly",
          rebalanceFrequency: body.rebalanceFrequency ?? "none"
        })
      : [];

    const response: BenchmarkResponse = {
      benchmarkSeries,
      benchmarkProjection,
      metrics,
      riskScore: computeRiskScore(metrics)
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    const details =
      process.env.NODE_ENV === "development" && error instanceof Error && error.stack
        ? error.stack
        : undefined;
    return NextResponse.json({ error: message, details }, { status: 500 });
  }
}
