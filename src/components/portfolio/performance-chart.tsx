"use client";

import { parseISO } from "date-fns";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SeriesPoint } from "@/types";

interface Props {
  portfolio: SeriesPoint[];
  benchmark: SeriesPoint[];
  portfolioProjection: SeriesPoint[];
  benchmarkProjection: SeriesPoint[];
}

interface ChartRow {
  date: string;
  ts: number;
  portfolio?: number;
  benchmark?: number;
  portfolioProjected?: number;
  benchmarkProjected?: number;
}

function toYearMonthLabel(ts: number) {
  const d = new Date(ts);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}


// Forward-fill sparse series on the unified timeline with bounded windows.
function forwardFill(
  data: ChartRow[],
  windows: {
    portfolioLastActualTs?: number;
    benchmarkLastActualTs?: number;
    portfolioProjectionStartTs?: number;
    benchmarkProjectionStartTs?: number;
  }
): ChartRow[] {
  let lastPortfolio: number | undefined;
  let lastBenchmark: number | undefined;

  return data.map((row) => {
    if (row.portfolio !== undefined) lastPortfolio = row.portfolio;
    if (row.benchmark !== undefined) lastBenchmark = row.benchmark;

    const inPortfolioActualWindow =
      windows.portfolioLastActualTs === undefined || row.ts <= windows.portfolioLastActualTs;
    const inBenchmarkActualWindow =
      windows.benchmarkLastActualTs === undefined || row.ts <= windows.benchmarkLastActualTs;
    const inPortfolioProjectionWindow =
      windows.portfolioProjectionStartTs !== undefined && row.ts >= windows.portfolioProjectionStartTs;
    const inBenchmarkProjectionWindow =
      windows.benchmarkProjectionStartTs !== undefined && row.ts >= windows.benchmarkProjectionStartTs;

    return {
      ...row,
      portfolio: inPortfolioActualWindow ? (row.portfolio ?? lastPortfolio) : undefined,
      benchmark: inBenchmarkActualWindow ? (row.benchmark ?? lastBenchmark) : undefined,
      portfolioProjected: inPortfolioProjectionWindow ? row.portfolioProjected : undefined,
      benchmarkProjected: inBenchmarkProjectionWindow ? row.benchmarkProjected : undefined
    };
  });
}

export function PerformanceChart({
  portfolio,
  benchmark,
  portfolioProjection,
  benchmarkProjection
}: Props) {
  const byDate = new Map<string, ChartRow>();

  for (const point of portfolio) {
    byDate.set(point.date, {
      date: point.date,
      ts: parseISO(point.date).getTime(),
      portfolio: point.value,
      benchmark: byDate.get(point.date)?.benchmark,
      portfolioProjected: byDate.get(point.date)?.portfolioProjected,
      benchmarkProjected: byDate.get(point.date)?.benchmarkProjected
    });
  }
  for (const point of benchmark) {
    byDate.set(point.date, {
      date: point.date,
      ts: parseISO(point.date).getTime(),
      benchmark: point.value,
      portfolio: byDate.get(point.date)?.portfolio,
      portfolioProjected: byDate.get(point.date)?.portfolioProjected,
      benchmarkProjected: byDate.get(point.date)?.benchmarkProjected
    });
  }

  for (const point of portfolioProjection) {
    byDate.set(point.date, {
      date: point.date,
      ts: parseISO(point.date).getTime(),
      portfolio: byDate.get(point.date)?.portfolio,
      benchmark: byDate.get(point.date)?.benchmark,
      portfolioProjected: point.value,
      benchmarkProjected: byDate.get(point.date)?.benchmarkProjected
    });
  }
  for (const point of benchmarkProjection) {
    byDate.set(point.date, {
      date: point.date,
      ts: parseISO(point.date).getTime(),
      portfolio: byDate.get(point.date)?.portfolio,
      benchmark: byDate.get(point.date)?.benchmark,
      portfolioProjected: byDate.get(point.date)?.portfolioProjected,
      benchmarkProjected: point.value
    });
  }

  const rawData = [...byDate.values()].sort((a, b) => (a.date > b.date ? 1 : -1));
  const data = forwardFill(rawData, {
    portfolioLastActualTs: portfolio.length ? parseISO(portfolio[portfolio.length - 1].date).getTime() : undefined,
    benchmarkLastActualTs: benchmark.length ? parseISO(benchmark[benchmark.length - 1].date).getTime() : undefined,
    portfolioProjectionStartTs:
      portfolioProjection.length ? parseISO(portfolioProjection[0].date).getTime() : undefined,
    benchmarkProjectionStartTs:
      benchmarkProjection.length ? parseISO(benchmarkProjection[0].date).getTime() : undefined
  });
  const todayUtcTs = new Date(new Date().toISOString().slice(0, 10)).getTime();

  return (
    <div className="h-[360px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <XAxis
            dataKey="ts"
            type="number"
            domain={["dataMin", "dataMax"]}
            scale="time"
            tick={{ fontSize: 11 }}
            tickFormatter={(value: number) => toYearMonthLabel(value)}
            interval="preserveStartEnd"
          />
          <YAxis tickFormatter={(v) => `$${Math.round(v).toLocaleString()}`} tick={{ fontSize: 11 }} />
          <Tooltip
            labelFormatter={(label: number) => toYearMonthLabel(label)}
            formatter={(value: number) => `$${Math.round(value).toLocaleString()}`}
          />
          <ReferenceLine
            x={todayUtcTs}
            stroke="#94a3b8"
            strokeDasharray="3 3"
            ifOverflow="extendDomain"
            label={{ value: "Today", position: "top", fill: "#64748b", fontSize: 11 }}
          />
          <Line type="monotone" dataKey="portfolio" stroke="#2563eb" strokeWidth={2.5} dot={false} connectNulls />
          <Line type="monotone" dataKey="benchmark" stroke="#9ca3af" strokeWidth={2.2} dot={false} connectNulls />
          <Line type="monotone" dataKey="portfolioProjected" stroke="#60a5fa" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />
          <Line type="monotone" dataKey="benchmarkProjected" stroke="#d1d5db" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
