import { NextRequest, NextResponse } from "next/server";
import { startOfWeek, addWeeks, parseISO } from "date-fns";
import { z } from "zod";
import {
  buildPortfolioSeries,
  buildProjectionSeriesFromAssets,
  computeMetrics,
  computeRiskScore,
  createComparisonPoints,
  createComparisonSummary,
  getDateRangeForTimeRange,
  getProjectionMonthsFromSeries,
  singleAssetSeries
} from "@/lib/portfolio/engine";
import { getOrFetchPricesForSymbols } from "@/lib/portfolio/cache";
import { AnalyzeResponse, HoldingInput, TimeRange } from "@/types";

const bodySchema = z.object({
  holdings: z.array(
    z.object({
      symbol: z.string().min(1),
      weight: z.number().positive()
    })
  ).max(10, "Portfolio can contain at most 10 holdings."),
  benchmarkSymbol: z.enum(["SPY", "QQQ", "VTI", "AGG"]),
  timeRange: z.enum(["1Y", "3Y", "5Y", "10Y"]),
  startValue: z.number().positive().optional(),
  contributionAmount: z.number().min(0).optional(),
  contributionFrequency: z.enum(["weekly", "monthly", "yearly"]).optional(),
  rebalanceFrequency: z.enum(["none", "monthly", "quarterly", "yearly"]).optional()
});

async function loadAllPrices(holdings: HoldingInput[], benchmarkSymbol: string, timeRange: TimeRange) {
  const { startDate, endDate } = getDateRangeForTimeRange(timeRange);
  const symbols = [...new Set([...holdings.map((h) => h.symbol.toUpperCase()), benchmarkSymbol])];
  console.info(
    `[analyze] symbols=${symbols.join(",")} benchmark=${benchmarkSymbol} range=${timeRange} (${startDate}..${endDate})`
  );

  return getOrFetchPricesForSymbols(symbols, startDate, endDate);
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid analyze payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const body = parsed.data;
    const normalizedHoldings = body.holdings.map((h) => ({ ...h, symbol: h.symbol.toUpperCase() }));
    const allPrices = await loadAllPrices(normalizedHoldings, body.benchmarkSymbol, body.timeRange);

    const startValue = body.startValue ?? 10000;
    const portfolioSeries = buildPortfolioSeries(
      normalizedHoldings,
      allPrices,
      startValue,
      body.rebalanceFrequency ?? "monthly"
    );
    const benchmarkSeries = singleAssetSeries(body.benchmarkSymbol, allPrices, startValue);

    const metrics = computeMetrics(portfolioSeries);
    const benchmarkMetrics = computeMetrics(benchmarkSeries);

    const projectionMonths = Math.max(
      getProjectionMonthsFromSeries(portfolioSeries),
      getProjectionMonthsFromSeries(benchmarkSeries)
    );
    const projectionStartDate = (() => {
      const pLast = portfolioSeries[portfolioSeries.length - 1]?.date;
      const bLast = benchmarkSeries[benchmarkSeries.length - 1]?.date;
      const latest = pLast && bLast ? (pLast > bLast ? pLast : bLast) : pLast ?? bLast;
      if (!latest) return undefined;
      const latestDate = parseISO(latest);
      const weekStart = startOfWeek(latestDate, { weekStartsOn: 1 });
      const aligned = weekStart <= latestDate ? addWeeks(weekStart, 1) : weekStart;
      return aligned.toISOString().slice(0, 10);
    })();
    const portfolioProjection = portfolioSeries.length
      ? buildProjectionSeriesFromAssets({
          holdings: normalizedHoldings,
          prices: allPrices,
          lastActualDate: portfolioSeries[portfolioSeries.length - 1].date,
          lastActualValue: portfolioSeries[portfolioSeries.length - 1].value,
          projectionStartDate,
          projectionMonths,
          contributionAmount: body.contributionAmount ?? 0,
          contributionFrequency: body.contributionFrequency ?? "monthly",
          rebalanceFrequency: body.rebalanceFrequency ?? "monthly"
        })
      : [];
    const benchmarkProjection = benchmarkSeries.length
      ? buildProjectionSeriesFromAssets({
          holdings: [{ symbol: body.benchmarkSymbol, weight: 100 }],
          prices: allPrices,
          lastActualDate: benchmarkSeries[benchmarkSeries.length - 1].date,
          lastActualValue: benchmarkSeries[benchmarkSeries.length - 1].value,
          projectionStartDate,
          projectionMonths,
          contributionAmount: body.contributionAmount ?? 0,
          contributionFrequency: body.contributionFrequency ?? "monthly",
          rebalanceFrequency: "none"
        })
      : [];

    const response: AnalyzeResponse = {
      portfolioSeries,
      benchmarkSeries,
      portfolioProjection,
      benchmarkProjection,
      metrics,
      benchmarkMetrics,
      riskScore: computeRiskScore(metrics),
      benchmarkRiskScore: computeRiskScore(benchmarkMetrics),
      comparisonPoints: createComparisonPoints(portfolioProjection, benchmarkProjection),
      comparisonSummary: createComparisonSummary(metrics, benchmarkMetrics)
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    const details =
      process.env.NODE_ENV === "development" && error instanceof Error && error.stack
        ? error.stack
        : undefined;
    return NextResponse.json(
      { error: message, details },
      { status: 500 }
    );
  }
}
