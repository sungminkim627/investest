"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PerformanceChart } from "@/components/portfolio/performance-chart";
import { AnalyzeResponse, HoldingInput, TimeRange } from "@/types";
import { Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip, Cell } from "recharts";

const BENCHMARKS = ["SPY", "QQQ", "VTI", "AGG"] as const;
const RANGES: TimeRange[] = ["1Y", "3Y", "5Y", "10Y"];
type RebalanceFrequencyOption = "none" | "monthly" | "quarterly" | "yearly";

const DEFAULT_HOLDINGS: HoldingInput[] = [
  { symbol: "VTI", weight: 60 },
  { symbol: "VXUS", weight: 25 },
  { symbol: "BND", weight: 15 }
];
const ALLOCATION_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#ef4444", "#7c3aed", "#0891b2", "#0ea5e9", "#14b8a6", "#84cc16", "#f97316"];

function MetricCard({
  label,
  info,
  portfolioValue,
  benchmarkValue,
  extra
}: {
  label: string;
  info: string;
  portfolioValue: string;
  benchmarkValue: string;
  extra?: string;
}) {
  return (
    <Card className="relative space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="group relative">
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="pointer-events-none absolute right-0 top-5 z-20 hidden w-56 rounded-lg border border-border bg-white p-2 text-[11px] leading-snug text-muted-foreground shadow-soft group-hover:block">
            {info}
          </div>
        </div>
      </div>
      <div className="space-y-0.5">
        <p className="text-lg font-semibold">Portfolio: {portfolioValue}</p>
        <p className="text-sm text-muted-foreground">Benchmark: {benchmarkValue}</p>
      </div>
      {extra ? <p className="text-xs text-muted-foreground">{extra}</p> : null}
    </Card>
  );
}

export function DashboardClient() {
  const [benchmarkSymbol, setBenchmarkSymbol] = useState<(typeof BENCHMARKS)[number]>("SPY");
  const [timeRange, setTimeRange] = useState<TimeRange>("5Y");
  const [holdings, setHoldings] = useState<HoldingInput[]>(DEFAULT_HOLDINGS);
  const [startValue, setStartValue] = useState(10000);
  const [contributionAmount, setContributionAmount] = useState(0);
  const [contributionFrequency, setContributionFrequency] = useState<"weekly" | "monthly" | "yearly">("monthly");
  const [rebalanceFrequency, setRebalanceFrequency] = useState<RebalanceFrequencyOption>("monthly");
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const lastRequestKeyRef = useRef<string>("");

  const hydrateFromStorage = () => {
    const fromStorage = window.localStorage.getItem("investest:holdings");
    const savedBenchmark = window.localStorage.getItem("investest:benchmark");
    const savedRange = window.localStorage.getItem("investest:timeRange");
    const savedStartValue = window.localStorage.getItem("investest:startValue");
    const savedContributionAmount = window.localStorage.getItem("investest:contributionAmount");
    const savedContributionFrequency = window.localStorage.getItem("investest:contributionFrequency");
    const savedRebalanceFrequency = window.localStorage.getItem("investest:rebalanceFrequency");

    if (fromStorage) {
      try {
        const parsed = JSON.parse(fromStorage) as HoldingInput[];
        if (Array.isArray(parsed) && parsed.length) {
          setHoldings(parsed);
        }
      } catch {
        // Ignore invalid local storage.
      }
    }

    if (savedBenchmark && BENCHMARKS.includes(savedBenchmark as (typeof BENCHMARKS)[number])) {
      setBenchmarkSymbol(savedBenchmark as (typeof BENCHMARKS)[number]);
    }

    if (savedRange && RANGES.includes(savedRange as TimeRange)) {
      setTimeRange(savedRange as TimeRange);
    }
    if (savedStartValue && Number.isFinite(Number(savedStartValue))) {
      setStartValue(Number(savedStartValue));
    }
    if (savedContributionAmount && Number.isFinite(Number(savedContributionAmount))) {
      setContributionAmount(Number(savedContributionAmount));
    }
    if (savedContributionFrequency === "weekly" || savedContributionFrequency === "monthly" || savedContributionFrequency === "yearly") {
      setContributionFrequency(savedContributionFrequency);
    }
    if (
      savedRebalanceFrequency === "none" ||
      savedRebalanceFrequency === "monthly" ||
      savedRebalanceFrequency === "quarterly" ||
      savedRebalanceFrequency === "yearly"
    ) {
      setRebalanceFrequency(savedRebalanceFrequency);
    }
  };

  useEffect(() => {
    hydrateFromStorage();
    setIsHydrated(true);

    const onHoldingsUpdated = () => hydrateFromStorage();
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key.startsWith("investest:")) {
        hydrateFromStorage();
      }
    };

    window.addEventListener("investest:holdings-updated", onHoldingsUpdated as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("investest:holdings-updated", onHoldingsUpdated as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;

    const requestKey = JSON.stringify({
      holdings: holdings.map((h) => ({ symbol: h.symbol.toUpperCase(), weight: h.weight })),
      benchmarkSymbol,
      timeRange,
      startValue,
      contributionAmount,
      contributionFrequency,
      rebalanceFrequency
    });

    if (requestKey === lastRequestKeyRef.current) {
      return;
    }
    lastRequestKeyRef.current = requestKey;

    const controller = new AbortController();

    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            holdings,
            benchmarkSymbol,
            timeRange,
            startValue,
            contributionAmount,
            contributionFrequency,
            rebalanceFrequency
          }),
          signal: controller.signal
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: "Analyze request failed" }));
          throw new Error(err.error ?? "Analyze request failed");
        }
        setData((await response.json()) as AnalyzeResponse);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error(error);
        }
      } finally {
        setLoading(false);
      }
    };

    window.localStorage.setItem("investest:benchmark", benchmarkSymbol);
    window.localStorage.setItem("investest:timeRange", timeRange);
    load();
    return () => controller.abort();
  }, [benchmarkSymbol, timeRange, holdings, isHydrated, startValue, contributionAmount, contributionFrequency, rebalanceFrequency]);

  const allocationItems = useMemo(
    () => holdings.map((h) => ({ ...h, pct: `${h.weight.toFixed(1)}%` })),
    [holdings]
  );
  const allocationColumnOne = allocationItems.slice(0, 5);
  const allocationColumnTwo = allocationItems.slice(5, 10);

  if (!isHydrated) {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">Loading portfolio...</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card id="analysis-section">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="text-base font-semibold">Performance</p>
            <div className="group relative">
              <Info className="h-4 w-4 text-muted-foreground" />
              <div className="pointer-events-none absolute left-0 top-6 z-20 hidden w-72 rounded-lg border border-border bg-white p-2 text-[11px] leading-snug text-muted-foreground shadow-soft group-hover:block">
                Projections are modeled using each asset’s historical growth and volatility over the selected time range.
                We extend those return/volatility estimates forward and apply your contribution and rebalancing
                schedule. This is a statistical estimate, not a guarantee of future performance.
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Benchmark</span>
              <Select value={benchmarkSymbol} onValueChange={(value) => setBenchmarkSymbol(value as (typeof BENCHMARKS)[number])}>
                <SelectTrigger className="h-9 w-24">
                  <SelectValue placeholder="Benchmark" />
                </SelectTrigger>
                <SelectContent>
                  {BENCHMARKS.map((symbol) => (
                    <SelectItem key={symbol} value={symbol}>
                      {symbol}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Time Range</span>
              <div className="flex gap-2">
                {RANGES.map((range) => (
                  <Button key={range} variant={timeRange === range ? "default" : "secondary"} onClick={() => setTimeRange(range)} size="sm">
                    {range}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Running analysis...</p>
        ) : (
          <PerformanceChart
            portfolio={data?.portfolioSeries ?? []}
            benchmark={data?.benchmarkSeries ?? []}
            portfolioProjection={data?.portfolioProjection ?? []}
            benchmarkProjection={data?.benchmarkProjection ?? []}
          />
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard
          label="Annualized Return"
          info="Average yearly growth rate implied by historical performance over the selected period."
          portfolioValue={`${((data?.metrics.annualizedReturn ?? 0) * 100).toFixed(2)}%`}
          benchmarkValue={`${((data?.benchmarkMetrics.annualizedReturn ?? 0) * 100).toFixed(2)}%`}
        />
        <MetricCard
          label="Annualized Volatility"
          info="How much returns fluctuate year to year. Higher means a bumpier ride."
          portfolioValue={`${((data?.metrics.annualizedVolatility ?? 0) * 100).toFixed(2)}%`}
          benchmarkValue={`${((data?.benchmarkMetrics.annualizedVolatility ?? 0) * 100).toFixed(2)}%`}
        />
        <MetricCard
          label="Max Drawdown"
          info="Largest historical drop from a previous peak. Shows worst observed decline."
          portfolioValue={`${((data?.metrics.maxDrawdown ?? 0) * 100).toFixed(2)}%`}
          benchmarkValue={`${((data?.benchmarkMetrics.maxDrawdown ?? 0) * 100).toFixed(2)}%`}
        />
        <MetricCard
          label="Risk Score"
          info="A 1-10 score based on volatility and drawdown. Lower is steadier, higher is riskier."
          portfolioValue={`${data?.riskScore ?? 0}/10`}
          benchmarkValue={`${data?.benchmarkRiskScore ?? 0}/10`}
          extra={`Volatility context: ${((data?.metrics.annualizedVolatility ?? 0) * 100).toFixed(1)}% (portfolio) vs ${((data?.benchmarkMetrics.annualizedVolatility ?? 0) * 100).toFixed(1)}% (benchmark)`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Allocation Breakdown</p>
          <div className="h-28 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={allocationItems} dataKey="weight" nameKey="symbol" outerRadius={46} innerRadius={24} paddingAngle={2}>
                  {allocationItems.map((item, index) => (
                    <Cell key={item.symbol} fill={ALLOCATION_COLORS[index % ALLOCATION_COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip formatter={(value: number) => `${Number(value).toFixed(1)}%`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid gap-3 text-xs" style={{ gridTemplateColumns: allocationColumnTwo.length ? "1fr 1fr" : "1fr" }}>
            <div className="space-y-1">
              {allocationColumnOne.map((item, index) => (
                <div key={item.symbol} className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length] }} />
                    {item.symbol}
                  </span>
                  <span className="text-muted-foreground">{item.pct}</span>
                </div>
              ))}
            </div>
            {allocationColumnTwo.length ? (
              <div className="space-y-1">
                {allocationColumnTwo.map((item, index) => (
                  <div key={item.symbol} className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: ALLOCATION_COLORS[(index + 5) % ALLOCATION_COLORS.length] }} />
                      {item.symbol}
                    </span>
                    <span className="text-muted-foreground">{item.pct}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </Card>

        <Card>
          <p className="mb-2 text-base font-semibold">Benchmark Comparison</p>
          <div className="space-y-2 text-sm text-muted-foreground">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span>Annualized return</span>
                <span className="text-right">
                  Portfolio {((data?.metrics.annualizedReturn ?? 0) * 100).toFixed(2)}% · Benchmark {((data?.benchmarkMetrics.annualizedReturn ?? 0) * 100).toFixed(2)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Volatility</span>
                <span className="text-right">
                  Portfolio {((data?.metrics.annualizedVolatility ?? 0) * 100).toFixed(2)}% · Benchmark {((data?.benchmarkMetrics.annualizedVolatility ?? 0) * 100).toFixed(2)}%
                </span>
              </div>
            </div>
            <p>{data?.comparisonSummary ?? "Annualized return and volatility summary unavailable."}</p>
            <div className="pt-2">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Projection Values</p>
              {(data?.comparisonPoints ?? []).map((point) => (
                <div key={point.label} className="flex items-center justify-between">
                  <span>{point.label} projection</span>
                  <span className="text-right">
                    Portfolio ${Math.round(point.portfolioValue).toLocaleString()} · Benchmark ${Math.round(point.benchmarkValue).toLocaleString()} (
                    {point.delta >= 0 ? "+" : ""}
                    {Math.round(point.delta).toLocaleString()})
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

    </div>
  );
}
