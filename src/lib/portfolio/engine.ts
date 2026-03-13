import { addMonths, addWeeks, addYears, parseISO } from "date-fns";
import { HoldingInput, PortfolioMetrics, PricePoint, SeriesPoint, TimeRange } from "@/types";
import { getExpectedLatestCloseDate } from "@/lib/portfolio/market-calendar";

const DAYS_PER_YEAR = 252;

export function getDateRangeForTimeRange(range: TimeRange) {
  const endIso = getExpectedLatestCloseDate();
  const end = parseISO(endIso);
  const years = Number.parseInt(range, 10);
  const start = addYears(end, -years);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: endIso
  };
}

function dailyReturnsFromSeries(series: SeriesPoint[]) {
  const returns: number[] = [];
  for (let i = 1; i < series.length; i += 1) {
    const prev = series[i - 1]?.value ?? 0;
    const next = series[i]?.value ?? 0;
    if (prev <= 0) continue;
    returns.push(next / prev - 1);
  }
  return returns;
}

function estimatePeriodsPerYear(series: SeriesPoint[]) {
  if (series.length < 3) return DAYS_PER_YEAR;
  const diffsDays: number[] = [];
  for (let i = 1; i < series.length; i += 1) {
    const prev = parseISO(series[i - 1].date).getTime();
    const next = parseISO(series[i].date).getTime();
    const days = Math.max(1, Math.round((next - prev) / (1000 * 60 * 60 * 24)));
    diffsDays.push(days);
  }
  diffsDays.sort((a, b) => a - b);
  const median = diffsDays[Math.floor(diffsDays.length / 2)];
  if (median <= 2) return 252;
  if (median <= 4) return 104;
  if (median <= 8) return 52;
  if (median <= 16) return 26;
  return 12;
}

export function getProjectionMonthsFromSeries(series: SeriesPoint[]) {
  if (series.length < 2) return 0;
  const first = parseISO(series[0].date);
  const last = parseISO(series[series.length - 1].date);
  const months =
    (last.getUTCFullYear() - first.getUTCFullYear()) * 12 +
    (last.getUTCMonth() - first.getUTCMonth());
  return Math.max(1, months);
}

function stdDev(values: number[]) {
  if (!values.length) return 0;
  const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
  const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function calculateMaxDrawdown(series: SeriesPoint[]) {
  let peak = series[0]?.value ?? 0;
  let maxDrawdown = 0;
  for (const point of series) {
    if (point.value > peak) peak = point.value;
    if (peak > 0) {
      const drawdown = (point.value - peak) / peak;
      if (drawdown < maxDrawdown) maxDrawdown = drawdown;
    }
  }
  return maxDrawdown;
}

function riskScoreFromVolatilityAndDrawdown(annVol: number, maxDrawdown: number) {
  const volBucket = Math.min(7, Math.max(1, Math.round(annVol * 100 / 5)));
  const drawdownBucket = Math.min(3, Math.max(0, Math.round(Math.abs(maxDrawdown) * 100 / 10)));
  return Math.min(10, volBucket + drawdownBucket);
}

function normalizeWeights(holdings: HoldingInput[]) {
  const total = holdings.reduce((acc, h) => acc + h.weight, 0);
  if (total <= 0) throw new Error("Total holdings weight must be greater than zero");
  return holdings.map((h) => ({ ...h, weight: h.weight / total }));
}

function forwardFillPricesBySymbol(prices: PricePoint[], symbols: string[]) {
  const allDates = [...new Set(prices.map((p) => p.date))]
    .sort((a, b) => parseISO(a).getTime() - parseISO(b).getTime());

  const rawBySymbolDate = new Map<string, number>();
  for (const row of prices) {
    rawBySymbolDate.set(`${row.symbol}|${row.date}`, row.adjClose);
  }

  const filledBySymbolDate = new Map<string, number>();
  const hasRawBySymbolDate = new Map<string, boolean>();
  for (const symbol of symbols) {
    let lastPrice: number | undefined;
    for (const date of allDates) {
      const raw = rawBySymbolDate.get(`${symbol}|${date}`);
      if (raw !== undefined && Number.isFinite(raw) && raw > 0) {
        lastPrice = raw;
        hasRawBySymbolDate.set(`${symbol}|${date}`, true);
      } else {
        hasRawBySymbolDate.set(`${symbol}|${date}`, false);
      }
      if (lastPrice !== undefined) {
        filledBySymbolDate.set(`${symbol}|${date}`, lastPrice);
      }
    }
  }

  return { allDates, filledBySymbolDate, hasRawBySymbolDate };
}

function getRebalanceKey(date: string, frequency: RebalanceFrequency) {
  const year = date.slice(0, 4);
  const month = Number(date.slice(5, 7));
  if (frequency === "yearly") return year;
  if (frequency === "quarterly") {
    const quarter = Math.floor((month - 1) / 3) + 1;
    return `${year}-Q${quarter}`;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthlyRebalancedPortfolioSeries(
  holdings: HoldingInput[],
  prices: PricePoint[],
  startValue = 10000,
  frequency: RebalanceFrequency = "monthly"
): SeriesPoint[] {
  const normalized = normalizeWeights(holdings);
  const symbols = normalized.map((h) => h.symbol);
  const { allDates, filledBySymbolDate, hasRawBySymbolDate } = forwardFillPricesBySymbol(prices, symbols);

  let portfolioValue = startValue;
  let currentRebalanceKey = "";
  let unitsBySymbol = new Map<string, number>();
  const results: SeriesPoint[] = [];

  for (const date of allDates) {
    const rebalanceKey = getRebalanceKey(date, frequency);
    const rebalanceBoundary = rebalanceKey !== currentRebalanceKey || unitsBySymbol.size === 0;
    const allHoldingsHaveRawQuote = normalized.every((holding) => hasRawBySymbolDate.get(`${holding.symbol}|${date}`));
    const shouldRebalance = rebalanceBoundary && allHoldingsHaveRawQuote && rebalanceOnDate(date, frequency);

    if (shouldRebalance) {
      currentRebalanceKey = rebalanceKey;
      const investable: Array<{ symbol: string; weight: number; px: number }> = [];
      for (const holding of normalized) {
        const px = filledBySymbolDate.get(`${holding.symbol}|${date}`);
        if (!px || px <= 0) continue;
        investable.push({ symbol: holding.symbol, weight: holding.weight, px });
      }

      // If nothing is investable on this rebalance date, keep existing units (do not drop value).
      if (investable.length > 0) {
        const investableWeightSum = investable.reduce((acc, item) => acc + item.weight, 0);
        const nextUnits = new Map<string, number>();
        for (const item of investable) {
          const w = investableWeightSum > 0 ? item.weight / investableWeightSum : 0;
          nextUnits.set(item.symbol, (portfolioValue * w) / item.px);
        }
        unitsBySymbol = nextUnits;
      }
    }

    let dailyValue = 0;
    for (const holding of normalized) {
      const units = unitsBySymbol.get(holding.symbol);
      const px = filledBySymbolDate.get(`${holding.symbol}|${date}`);
      if (!units || !px) continue;
      dailyValue += units * px;
    }

    if (dailyValue > 0) {
      portfolioValue = dailyValue;
      results.push({ date, value: dailyValue });
    }
  }

  return results;
}

export function singleAssetSeries(symbol: string, prices: PricePoint[], startValue = 10000): SeriesPoint[] {
  const points = prices
    .filter((row) => row.symbol === symbol)
    .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime());

  if (!points.length) return [];
  const first = points[0].adjClose;
  return points.map((point) => ({
    date: point.date,
    value: startValue * (point.adjClose / first)
  }));
}

function computeAssetStatsFromPrices(prices: PricePoint[], symbol: string) {
  const points = prices
    .filter((row) => row.symbol === symbol)
    .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime());

  if (points.length < 2) {
    return { muLogAnnual: 0, sigmaAnnual: 0 };
  }

  const seriesPoints: SeriesPoint[] = points.map((point) => ({ date: point.date, value: point.adjClose }));
  const periodsPerYear = estimatePeriodsPerYear(seriesPoints);

  const logReturns: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1].adjClose;
    const next = points[i].adjClose;
    if (prev > 0 && next > 0) {
      logReturns.push(Math.log(next / prev));
    }
  }

  if (!logReturns.length) {
    return { muLogAnnual: 0, sigmaAnnual: 0 };
  }

  const mean = logReturns.reduce((acc, value) => acc + value, 0) / logReturns.length;
  const variance = logReturns.reduce((acc, value) => acc + (value - mean) ** 2, 0) / logReturns.length;
  const std = Math.sqrt(variance);

  return {
    muLogAnnual: mean * periodsPerYear,
    sigmaAnnual: std * Math.sqrt(periodsPerYear)
  };
}

export function computeMetrics(series: SeriesPoint[]): PortfolioMetrics {
  if (series.length < 2) {
    return {
      annualizedReturn: 0,
      annualizedVolatility: 0,
      maxDrawdown: 0
    };
  }

  const start = series[0].value;
  const end = series[series.length - 1].value;
  const periodsPerYear = estimatePeriodsPerYear(series);
  const years = (series.length - 1) / periodsPerYear;
  const annualizedReturn = years > 0 ? (end / start) ** (1 / years) - 1 : 0;

  const dailyReturns = dailyReturnsFromSeries(series);
  const annualizedVolatility = stdDev(dailyReturns) * Math.sqrt(periodsPerYear);
  const maxDrawdown = calculateMaxDrawdown(series);

  return {
    annualizedReturn,
    annualizedVolatility,
    maxDrawdown
  };
}

export function createComparisonPoints(
  portfolioProjection: SeriesPoint[],
  benchmarkProjection: SeriesPoint[]
) {
  if (!portfolioProjection.length || !benchmarkProjection.length) return [];

  const byDate = new Map<string, number>();
  for (const point of benchmarkProjection) {
    byDate.set(point.date, point.value);
  }

  const pickByIndex = (label: string, index: number) => {
    const portfolioPoint = portfolioProjection[index];
    if (!portfolioPoint) return null;
    const benchmarkValue = byDate.get(portfolioPoint.date);
    if (benchmarkValue === undefined) return null;
    return {
      label,
      portfolioValue: portfolioPoint.value,
      benchmarkValue,
      delta: portfolioPoint.value - benchmarkValue
    };
  };

  const points = [
    pickByIndex("3M", Math.min(12, portfolioProjection.length - 1)),
    pickByIndex("1Y", Math.min(52, portfolioProjection.length - 1)),
    pickByIndex("3Y", Math.min(156, portfolioProjection.length - 1))
  ].filter((point): point is NonNullable<typeof point> => point !== null);

  return points;
}

export function createComparisonSummary(metrics: PortfolioMetrics, benchmarkMetrics: PortfolioMetrics) {
  const returnDelta = metrics.annualizedReturn - benchmarkMetrics.annualizedReturn;
  const volDelta = metrics.annualizedVolatility - benchmarkMetrics.annualizedVolatility;
  let suggestion = "Risk/return profile is broadly aligned with the benchmark.";
  if (returnDelta < 0 && volDelta > 0) {
    suggestion = "Lower return with higher volatility: consider shifting toward higher‑quality or lower‑risk holdings.";
  } else if (returnDelta > 0 && volDelta < 0) {
    suggestion = "Higher return with lower volatility: strong risk-adjusted profile, maintain or rebalance thoughtfully.";
  } else if (returnDelta > 0 && volDelta > 0) {
    suggestion = "Higher return with higher volatility: suitable if you can tolerate swings; diversify if not.";
  } else if (returnDelta < 0 && volDelta < 0) {
    suggestion = "Lower return with lower volatility: suitable for conservative goals; add growth holdings if you want more upside.";
  }

  return suggestion;
}

export function computeRiskScore(metrics: PortfolioMetrics) {
  return riskScoreFromVolatilityAndDrawdown(metrics.annualizedVolatility, metrics.maxDrawdown);
}

export type RebalanceFrequency = "none" | "monthly" | "quarterly" | "yearly";

function rebalanceOnDate(date: string, frequency: RebalanceFrequency) {
  if (frequency === "none") return false;
  const month = Number(date.slice(5, 7));
  if (frequency === "monthly") return true;
  if (frequency === "quarterly") return month % 3 === 1;
  if (frequency === "yearly") return month === 1;
  return false;
}

function rebalanceStrategySeries(
  holdings: HoldingInput[],
  prices: PricePoint[],
  startValue: number,
  frequency: RebalanceFrequency
) {
  if (frequency === "none") {
    const normalized = normalizeWeights(holdings);
    const symbols = normalized.map((h) => h.symbol);
    const { allDates, filledBySymbolDate } = forwardFillPricesBySymbol(prices, symbols);

    const firstDate = allDates[0];
    if (!firstDate) return [];

    const unitsBySymbol = new Map<string, number>();
    for (const holding of normalized) {
      const px = filledBySymbolDate.get(`${holding.symbol}|${firstDate}`);
      if (!px || px <= 0) continue;
      unitsBySymbol.set(holding.symbol, (startValue * holding.weight) / px);
    }

    const results: SeriesPoint[] = [];
    for (const date of allDates) {
      let dailyValue = 0;
      for (const holding of normalized) {
        const units = unitsBySymbol.get(holding.symbol);
        const px = filledBySymbolDate.get(`${holding.symbol}|${date}`);
        if (!units || !px) continue;
        dailyValue += units * px;
      }
      if (dailyValue > 0) {
        results.push({ date, value: dailyValue });
      }
    }
    return results;
  }

  return monthlyRebalancedPortfolioSeries(holdings, prices, startValue, frequency);
}

export function buildPortfolioSeries(
  holdings: HoldingInput[],
  prices: PricePoint[],
  startValue = 10000,
  rebalanceFrequency: RebalanceFrequency = "monthly"
) {
  if (holdings.length === 1) {
    return singleAssetSeries(holdings[0].symbol, prices, startValue);
  }
  return rebalanceStrategySeries(holdings, prices, startValue, rebalanceFrequency);
}

export function buildProjectionSeriesFromAssets({
  holdings,
  prices,
  lastActualDate,
  lastActualValue,
  projectionStartDate,
  projectionMonths,
  contributionAmount,
  contributionFrequency,
  rebalanceFrequency
}: {
  holdings: HoldingInput[];
  prices: PricePoint[];
  lastActualDate: string;
  lastActualValue: number;
  projectionStartDate?: string;
  projectionMonths: number;
  contributionAmount: number;
  contributionFrequency: "weekly" | "monthly" | "yearly";
  rebalanceFrequency: RebalanceFrequency;
}): SeriesPoint[] {
  if (!holdings.length || projectionMonths <= 0) return [];

  const normalized = normalizeWeights(holdings);
  const statsBySymbol = new Map<string, { muLogAnnual: number; sigmaAnnual: number }>();
  for (const holding of normalized) {
    statsBySymbol.set(holding.symbol, computeAssetStatsFromPrices(prices, holding.symbol));
  }

  const buckets = new Map<string, number>();
  for (const holding of normalized) {
    buckets.set(holding.symbol, lastActualValue * holding.weight);
  }

  const startDate = projectionStartDate ?? lastActualDate;
  const points: SeriesPoint[] = [];
  const horizonEnd = addMonths(parseISO(startDate), projectionMonths);
  const dtYears = 7 / 365;
  const contributionFrequencyLocal = contributionFrequency;

  let cursor = parseISO(lastActualDate);
  const projectionStart = parseISO(startDate);

  let lastContributionKey: string | null = null;
  const shouldContribute = (date: Date) => {
    if (contributionAmount <= 0) return false;
    if (contributionFrequencyLocal === "weekly") return true;
    if (contributionFrequencyLocal === "yearly") {
      const key = `${date.getUTCFullYear()}`;
      if (key === lastContributionKey) return false;
      lastContributionKey = key;
      return true;
    }
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    if (key === lastContributionKey) return false;
    lastContributionKey = key;
    return true;
  };

  const applyStep = (applyContribution: boolean, date: Date) => {
    for (const holding of normalized) {
      const bucket = buckets.get(holding.symbol) ?? 0;
      const stats = statsBySymbol.get(holding.symbol) ?? { muLogAnnual: 0, sigmaAnnual: 0 };
      const growth = Math.exp((stats.muLogAnnual - 0.5 * stats.sigmaAnnual ** 2) * dtYears);
      buckets.set(holding.symbol, bucket * growth);
    }

    if (applyContribution && contributionAmount > 0) {
      for (const holding of normalized) {
        const prev = buckets.get(holding.symbol) ?? 0;
        buckets.set(holding.symbol, prev + contributionAmount * holding.weight);
      }
    }

    if (rebalanceOnDate(date.toISOString().slice(0, 10), rebalanceFrequency)) {
      const total = Array.from(buckets.values()).reduce((acc, value) => acc + value, 0);
      for (const holding of normalized) {
        buckets.set(holding.symbol, total * holding.weight);
      }
    }
  };

  while (cursor < projectionStart) {
    cursor = addWeeks(cursor, 1);
    applyStep(false, cursor);
  }

  cursor = projectionStart;
  const totalAtStart = Array.from(buckets.values()).reduce((acc, value) => acc + value, 0);
  points.push({ date: startDate, value: totalAtStart });

  let stepIndex = 0;
  while (cursor < horizonEnd) {
    cursor = addWeeks(cursor, 1);
    const applyContribution = shouldContribute(cursor);
    applyStep(applyContribution, cursor);
    const date = cursor.toISOString().slice(0, 10);
    const totalValue = Array.from(buckets.values()).reduce((acc, value) => acc + value, 0);
    points.push({ date, value: totalValue });
  }

  return points;
}
