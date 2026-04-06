"use client";

import { parseISO } from "date-fns";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SeriesPoint } from "@/types";

const COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#ef4444", "#7c3aed", "#0891b2", "#0ea5e9"];

export interface SeriesEntry {
  id: string;
  name: string;
  color?: string;
  series: SeriesPoint[];
  projection?: SeriesPoint[];
}

interface Props {
  series: SeriesEntry[];
  benchmark?: SeriesPoint[];
  benchmarkProjection?: SeriesPoint[];
  showProjection?: boolean;
}

interface ChartRow {
  date: string;
  ts: number;
  [key: string]: number | string | undefined;
}

function toYearMonthLabel(ts: number) {
  const d = new Date(ts);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function forwardFillRows(
  rows: ChartRow[],
  actualKeys: { key: string; lastActualTs?: number }[],
  projectionKeys: { key: string; projectionStartTs?: number }[]
) {
  const lastByKey: Record<string, number | undefined> = {};
  return rows.map((row) => {
    const next: ChartRow = { ...row };
    for (const { key, lastActualTs } of actualKeys) {
      const value = row[key];
      if (typeof value === "number") {
        lastByKey[key] = value;
      }
      const inWindow = lastActualTs === undefined || row.ts <= lastActualTs;
      next[key] = inWindow ? (row[key] ?? lastByKey[key]) : undefined;
    }

    for (const { key, projectionStartTs } of projectionKeys) {
      const inWindow = projectionStartTs !== undefined && row.ts >= projectionStartTs;
      if (!inWindow) {
        next[key] = undefined;
      }
    }

    return next;
  });
}

export function PerformanceChartMulti({ series, benchmark = [], benchmarkProjection = [], showProjection = false }: Props) {
  const byDate = new Map<string, ChartRow>();
  const actualKeys: { key: string; lastActualTs?: number }[] = [];
  const projectionKeys: { key: string; projectionStartTs?: number }[] = [];
  const seriesKeys: string[] = [];
  const projectionSeriesKeys: string[] = [];

  for (const item of series) {
    const key = `p_${item.id}`;
    seriesKeys.push(key);
    actualKeys.push({
      key,
      lastActualTs: item.series.length ? parseISO(item.series[item.series.length - 1].date).getTime() : undefined
    });
    for (const point of item.series) {
      const row = byDate.get(point.date) ?? { date: point.date, ts: parseISO(point.date).getTime() };
      row[key] = point.value;
      byDate.set(point.date, row);
    }

    if (showProjection && item.projection?.length) {
      const projKey = `p_${item.id}_proj`;
      projectionSeriesKeys.push(projKey);
      projectionKeys.push({
        key: projKey,
        projectionStartTs: item.projection.length ? parseISO(item.projection[0].date).getTime() : undefined
      });
      for (const point of item.projection) {
        const row = byDate.get(point.date) ?? { date: point.date, ts: parseISO(point.date).getTime() };
        row[projKey] = point.value;
        byDate.set(point.date, row);
      }
    }
  }

  if (benchmark.length) {
    const key = "benchmark";
    seriesKeys.push(key);
    actualKeys.push({
      key,
      lastActualTs: benchmark.length ? parseISO(benchmark[benchmark.length - 1].date).getTime() : undefined
    });
    for (const point of benchmark) {
      const row = byDate.get(point.date) ?? { date: point.date, ts: parseISO(point.date).getTime() };
      row[key] = point.value;
      byDate.set(point.date, row);
    }
  }
  if (showProjection && benchmarkProjection.length) {
    const key = "benchmark_proj";
    projectionSeriesKeys.push(key);
    projectionKeys.push({
      key,
      projectionStartTs: benchmarkProjection.length ? parseISO(benchmarkProjection[0].date).getTime() : undefined
    });
    for (const point of benchmarkProjection) {
      const row = byDate.get(point.date) ?? { date: point.date, ts: parseISO(point.date).getTime() };
      row[key] = point.value;
      byDate.set(point.date, row);
    }
  }

  const data = forwardFillRows([...byDate.values()].sort((a, b) => (a.date > b.date ? 1 : -1)), actualKeys, projectionKeys);
  const todayUtcTs = new Date(new Date().toISOString().slice(0, 10)).getTime();

  return (
    <div className="h-full w-full">
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
          <YAxis tickFormatter={(v) => `$${Math.round(Number(v)).toLocaleString()}`} tick={{ fontSize: 11 }} />
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

          {series.map((item) => {
            const key = `p_${item.id}`;
            const color = item.color ?? COLORS[0];
            return (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={item.name}
                stroke={color}
                strokeWidth={2.5}
                dot={false}
                connectNulls
              />
            );
          })}
          {showProjection
            ? series.map((item) => {
                const key = `p_${item.id}_proj`;
                const color = item.color ?? COLORS[0];
                return (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={`${item.name} (proj)`}
                    stroke={color}
                    strokeOpacity={0.55}
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    connectNulls
                  />
                );
              })
            : null}
          {benchmark.length ? (
            <Line type="monotone" dataKey="benchmark" name="Benchmark" stroke="#9ca3af" strokeWidth={2} dot={false} connectNulls />
          ) : null}
          {showProjection && benchmarkProjection.length ? (
            <Line
              type="monotone"
              dataKey="benchmark_proj"
              name="Benchmark (proj)"
              stroke="#d1d5db"
              strokeOpacity={0.7}
              strokeWidth={2}
              dot={false}
              strokeDasharray="5 5"
              connectNulls
            />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
