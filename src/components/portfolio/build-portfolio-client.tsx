"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Info, Plus, Sparkles, Trash2 } from "lucide-react";
import { HoldingInput } from "@/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const MAX_HOLDINGS = 10;

const STARTER_PORTFOLIOS: { id: string; name: string; description: string; holdings: HoldingInput[] }[] = [
  {
    id: "scratch",
    name: "Build from Scratch",
    description: "Start with an empty portfolio and add holdings manually.",
    holdings: []
  },
  {
    id: "sp500",
    name: "S&P 500 Core",
    description: "Single-fund US large-cap market exposure.",
    holdings: [{ symbol: "SPY", weight: 100 }]
  },
  {
    id: "6040",
    name: "Classic 60/40",
    description: "Balanced stock and bond allocation.",
    holdings: [
      { symbol: "VTI", weight: 60 },
      { symbol: "BND", weight: 40 }
    ]
  },
  {
    id: "threefund",
    name: "Three-Fund",
    description: "Broad US + international stocks with bond ballast.",
    holdings: [
      { symbol: "VTI", weight: 60 },
      { symbol: "VXUS", weight: 20 },
      { symbol: "BND", weight: 20 }
    ]
  }
];

interface SearchResult {
  symbol: string;
  name: string;
  exchange?: string | null;
  country?: string | null;
  sector?: string | null;
  industry?: string | null;
  description?: string | null;
  assetType?: string | null;
  longBusinessSummary?: string | null;
  marketCap?: number | null;
  forwardPE?: number | null;
  trailingPE?: number | null;
  beta?: number | null;
  debtToEquity?: number | null;
  returnOnEquity?: number | null;
  totalRevenue?: number | null;
  netIncomeToCommon?: number | null;
  dividendYield?: number | null;
  yearChange1Y?: number | null;
  yearChange3Y?: number | null;
  yearChange5Y?: number | null;
  yearChange10Y?: number | null;
}

interface FilterOption {
  value: string;
  label: string;
  count: number;
}

function parseTemplate(value: string): HoldingInput[] {
  return value
    .split(",")
    .map((pair) => {
      const [symbol, weight] = pair.split(":");
      return { symbol: (symbol ?? "").toUpperCase(), weight: Number(weight ?? 0) };
    })
    .filter((row) => row.symbol && Number.isFinite(row.weight) && row.weight > 0);
}

type BuildRow = HoldingInput & { id: string };
type BuildPortfolioMode = "page" | "workspace";
type RebalanceFrequencyOption = "none" | "monthly" | "quarterly" | "yearly";

function createRow(symbol = "", weight = 0): BuildRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    symbol,
    weight
  };
}

function formatLargeCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(1)}T`;
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value).toLocaleString()}`;
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return `${(value * 100).toFixed(digits)}%`;
}

function sizeBadge(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value >= 200_000_000_000) return "Mega Cap";
  if (value >= 10_000_000_000) return "Large Cap";
  if (value >= 2_000_000_000) return "Mid Cap";
  if (value >= 300_000_000) return "Small Cap";
  return "Micro Cap";
}

function riskBadge(beta: number | null | undefined) {
  if (beta === null || beta === undefined || !Number.isFinite(beta)) return { label: "Risk N/A", tone: "slate" as const };
  if (beta < 0.8) return { label: "Low Risk", tone: "emerald" as const };
  if (beta <= 1.2) return { label: "Market Risk", tone: "amber" as const };
  return { label: "High Risk", tone: "rose" as const };
}

function growthBadge(change1y: number | null | undefined) {
  if (change1y === null || change1y === undefined || !Number.isFinite(change1y)) {
    return { label: "Growth N/A", tone: "slate" as const };
  }
  if (change1y < 0) return { label: "Declining", tone: "rose" as const };
  if (change1y < 0.08) return { label: "Steady Growth", tone: "amber" as const };
  return { label: "High Growth", tone: "emerald" as const };
}

function scoreBadge(value: number | null | undefined, goodThreshold: number, okThreshold: number) {
  if (value === null || value === undefined || !Number.isFinite(value)) return { label: "N/A", tone: "slate" as const };
  if (value >= goodThreshold) return { label: "Good", tone: "emerald" as const };
  if (value >= okThreshold) return { label: "Okay", tone: "amber" as const };
  return { label: "Weak", tone: "rose" as const };
}

const badgeToneClasses: Record<"emerald" | "amber" | "rose" | "slate", string> = {
  emerald: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  rose: "bg-rose-100 text-rose-700",
  slate: "bg-slate-100 text-slate-600"
};

export function BuildPortfolioClient({ mode = "page" }: { mode?: BuildPortfolioMode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [rows, setRows] = useState<BuildRow[]>([]);
  const [weightInputByRowId, setWeightInputByRowId] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savePortfolioName, setSavePortfolioName] = useState("");
  const [savePortfolioBusy, setSavePortfolioBusy] = useState(false);
  const [savePortfolioMessage, setSavePortfolioMessage] = useState<string | null>(null);
  const [selectedStarterId, setSelectedStarterId] = useState<string | null>(mode === "workspace" ? "scratch" : null);
  const [searchQuery, setSearchQuery] = useState("");
  const [assetTypeFilter, setAssetTypeFilter] = useState<"Stock" | "ETF">("Stock");
  const [sectorFilter, setSectorFilter] = useState<string>("all");
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sectorOptions, setSectorOptions] = useState<FilterOption[]>([]);
  const [industryOptions, setIndustryOptions] = useState<FilterOption[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<FilterOption[]>([]);
  const [filterMatchCount, setFilterMatchCount] = useState<number | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchPage, setSearchPage] = useState(0);
  const [hasMoreResults, setHasMoreResults] = useState(true);
  const [totalSearchResults, setTotalSearchResults] = useState<number | null>(null);
  const isWorkspace = mode === "workspace";
  const [startValueInput, setStartValueInput] = useState("10000");
  const [contributionAmountInput, setContributionAmountInput] = useState("");
  const [contributionFrequency, setContributionFrequency] = useState<"weekly" | "monthly" | "yearly">("monthly");
  const [rebalanceFrequency, setRebalanceFrequency] = useState<RebalanceFrequencyOption>("monthly");

  const applyHoldings = (holdings: HoldingInput[]) => {
    const nextRows = holdings.map((h) => createRow(h.symbol, h.weight));
    setRows(nextRows);
    setWeightInputByRowId(
      Object.fromEntries(nextRows.map((row) => [row.id, row.weight > 0 ? String(row.weight) : ""]))
    );
  };

  useEffect(() => {
    setWeightInputByRowId((prev) => {
      const next: Record<string, string> = { ...prev };
      const rowIds = new Set(rows.map((row) => row.id));

      rows.forEach((row) => {
        if (next[row.id] === undefined) {
          next[row.id] = row.weight > 0 ? String(row.weight) : "";
        }
      });

      Object.keys(next).forEach((id) => {
        if (!rowIds.has(id)) {
          delete next[id];
        }
      });

      return next;
    });
  }, [rows]);

  useEffect(() => {
    const template = searchParams.get("template");
    if (template) {
      const parsed = parseTemplate(template);
      if (parsed.length) {
        applyHoldings(parsed);
        setSelectedStarterId("custom");
      }
      return;
    }

    const savedDraft = window.localStorage.getItem("investest:buildDraft");
    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft) as { holdings?: HoldingInput[] };
        if (Array.isArray(parsed.holdings) && parsed.holdings.length) {
          applyHoldings(parsed.holdings);
          setSelectedStarterId("custom");
        }
      } catch {
        // ignore draft parse errors
      }
    }
  }, [searchParams]);

  useEffect(() => {
    const savedStartValue = window.localStorage.getItem("investest:startValue");
    const savedContributionAmount = window.localStorage.getItem("investest:contributionAmount");
    const savedContributionFrequency = window.localStorage.getItem("investest:contributionFrequency");
    const savedRebalanceFrequency = window.localStorage.getItem("investest:rebalanceFrequency");

    if (savedStartValue && Number.isFinite(Number(savedStartValue))) {
      setStartValueInput(String(savedStartValue));
    }
    if (savedContributionAmount && Number.isFinite(Number(savedContributionAmount))) {
      setContributionAmountInput(String(savedContributionAmount));
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
  }, []);

  useEffect(() => {
    if (selectedStarterId === null) return;

    let cancelled = false;
    const trimmed = searchQuery.trim();
    const delay = trimmed.length > 0 ? 300 : 0;

    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const params = new URLSearchParams({ query: trimmed, limit: "100", offset: String(searchPage * 100) });
        params.set("assetType", assetTypeFilter);
        if (sectorFilter !== "all") {
          params.set("sector", sectorFilter);
        }
        if (industryFilter !== "all") {
          params.set("industry", industryFilter);
        }
        if (assetTypeFilter === "ETF" && categoryFilter !== "all") {
          params.set("category", categoryFilter);
        }
        const res = await fetch(`/api/search?${params.toString()}`);
        if (!res.ok) {
          if (!cancelled) setSearchResults([]);
          return;
        }
        const data = (await res.json()) as { results?: SearchResult[]; total?: number };
        if (!cancelled) {
          const incoming = data.results ?? [];
          setSearchResults(incoming);
          const total = typeof data.total === "number" ? data.total : null;
          setTotalSearchResults(total);
          if (total !== null) {
            setHasMoreResults((searchPage + 1) * 100 < total);
          } else {
            setHasMoreResults(incoming.length === 100);
          }
        }
      } finally {
        if (!cancelled) {
          setSearchLoading(false);
        }
      }
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, selectedStarterId, assetTypeFilter, sectorFilter, industryFilter, categoryFilter, searchPage]);

  useEffect(() => {
    if (selectedStarterId === null) return;

    let cancelled = false;
    (async () => {
      const params = new URLSearchParams({ assetType: assetTypeFilter, top: "15" });
      if (sectorFilter !== "all") params.set("sector", sectorFilter);
      if (industryFilter !== "all") params.set("industry", industryFilter);
      if (assetTypeFilter === "ETF" && categoryFilter !== "all") params.set("category", categoryFilter);
      const res = await fetch(`/api/search/filters?${params.toString()}`);
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as {
        totalMatches?: number;
        sector?: FilterOption[];
        industry?: FilterOption[];
        category?: FilterOption[];
      };
      setFilterMatchCount(data.totalMatches ?? null);
      setSectorOptions(data.sector ?? []);
      setIndustryOptions(data.industry ?? []);
      setCategoryOptions(data.category ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedStarterId, assetTypeFilter, sectorFilter, industryFilter, categoryFilter]);

  useEffect(() => {
    setSectorFilter("all");
    setIndustryFilter("all");
    setCategoryFilter("all");
  }, [assetTypeFilter]);

  useEffect(() => {
    setSearchPage(0);
    setHasMoreResults(true);
    setTotalSearchResults(null);
  }, [searchQuery, assetTypeFilter, sectorFilter, industryFilter, categoryFilter]);

  const totalWeight = useMemo(() => rows.reduce((acc, row) => acc + row.weight, 0), [rows]);
  const startValue = Number.isFinite(Number(startValueInput.replace(/,/g, "")))
    ? Number(startValueInput.replace(/,/g, ""))
    : 0;
  const contributionAmount = Number.isFinite(Number(contributionAmountInput.replace(/,/g, "")))
    ? Number(contributionAmountInput.replace(/,/g, ""))
    : 0;

  const normalizeWeights = () => {
    if (!rows.length) return;
    const sum = rows.reduce((acc, row) => acc + row.weight, 0);
    const base = sum <= 0 ? 100 / rows.length : (1 / sum) * 100;
    const normalizedRows = rows.map((row) => ({ ...row, weight: Number((row.weight * base).toFixed(2)) }));
    setRows(normalizedRows);
    setWeightInputByRowId(
      Object.fromEntries(normalizedRows.map((row) => [row.id, row.weight > 0 ? String(row.weight) : ""]))
    );
  };

  const saveConfig = () => {
    const filtered = rows.filter((row) => row.symbol.trim() && row.weight > 0);
    localStorage.setItem(
      "investest:holdings",
      JSON.stringify(filtered.map((row) => ({ symbol: row.symbol, weight: row.weight } satisfies HoldingInput)))
    );
    localStorage.setItem("investest:startValue", String(startValue));
    localStorage.setItem("investest:contributionAmount", String(contributionAmount));
    localStorage.setItem("investest:contributionFrequency", contributionFrequency);
    localStorage.setItem("investest:rebalanceFrequency", rebalanceFrequency);
    window.dispatchEvent(new CustomEvent("investest:holdings-updated"));
  };

  useEffect(() => {
    const holdingsDraft = rows
      .filter((row) => row.symbol.trim().length > 0 || row.weight > 0)
      .map((row) => ({ symbol: row.symbol.toUpperCase(), weight: row.weight } satisfies HoldingInput));
    window.localStorage.setItem("investest:buildDraft", JSON.stringify({ holdings: holdingsDraft }));
  }, [rows]);

  const selectedSymbols = new Set(rows.map((row) => row.symbol.toUpperCase()));
  const activeHoldings = rows
    .filter((row) => row.symbol.trim().length > 0 && row.weight > 0)
    .map((row) => ({ symbol: row.symbol.toUpperCase(), weight: row.weight }));

  const savePortfolio = async () => {
    setSavePortfolioMessage(null);
    if (!savePortfolioName.trim()) {
      setSavePortfolioMessage("Enter a portfolio name.");
      return;
    }
    if (!activeHoldings.length) {
      setSavePortfolioMessage("Add at least one holding before saving.");
      return;
    }
    if (activeHoldings.length > MAX_HOLDINGS) {
      setSavePortfolioMessage(`Portfolio can contain at most ${MAX_HOLDINGS} holdings.`);
      return;
    }

    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` }
      });
      return;
    }

    setSavePortfolioBusy(true);
    try {
      const { count, error: countError } = await supabase
        .from("portfolios")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);

      if (countError) throw countError;
      if ((count ?? 0) >= 5) {
        setSavePortfolioMessage("Free tier limit reached (5 portfolios). Delete one to save another.");
        return;
      }

      const { data: portfolio, error: portfolioError } = await supabase
        .from("portfolios")
        .insert([{
          user_id: user.id,
          name: savePortfolioName.trim(),
          start_value: startValue,
          contribution_amount: contributionAmount,
          contribution_frequency: contributionFrequency,
          rebalance_frequency: rebalanceFrequency
        }])
        .select("id")
        .single();

      if (portfolioError || !portfolio) throw portfolioError ?? new Error("Failed to create portfolio");

      const { error: holdingsError } = await supabase.from("portfolio_holdings").insert(
        activeHoldings.map((h) => ({
          portfolio_id: portfolio.id,
          symbol: h.symbol,
          weight: h.weight
        }))
      );
      if (holdingsError) throw holdingsError;

      setSavePortfolioMessage("Portfolio saved.");
      setSavePortfolioName("");
    } catch (saveError) {
      setSavePortfolioMessage(saveError instanceof Error ? saveError.message : "Failed to save portfolio.");
    } finally {
      setSavePortfolioBusy(false);
    }
  };

  return (
    <div className={isWorkspace ? "w-full space-y-4" : "mx-auto max-w-4xl space-y-4"}>
      {!isWorkspace ? (
        <Card className="space-y-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Choose a Starting Point</h2>
            <p className="text-sm text-muted-foreground">Pick a starter, then edit holdings.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {STARTER_PORTFOLIOS.map((starter) => {
              const selected = selectedStarterId === starter.id;
              return (
                <button
                  key={starter.id}
                  type="button"
                  onClick={() => {
                    setSelectedStarterId(starter.id);
                    applyHoldings(starter.holdings);
                    setSearchQuery("");
                    setSearchResults([]);
                  }}
                  className={`rounded-xl border p-3 text-left transition ${selected ? "border-emerald-500 bg-emerald-50" : "border-border bg-white hover:bg-slate-50"}`}
                >
                  <p className="text-sm font-semibold">{starter.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{starter.description}</p>
                  {starter.holdings.length ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {starter.holdings.map((h) => `${h.symbol} ${h.weight}%`).join(" - ")}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">No default holdings.</p>
                  )}
                </button>
              );
            })}
          </div>
        </Card>
      ) : null}

      {selectedStarterId !== null ? (
        <>
          <div className={isWorkspace ? "grid gap-4 xl:grid-cols-2" : "grid gap-4 lg:grid-cols-2"}>
            <Card className={`flex flex-col space-y-4 ${isWorkspace ? "h-[540px]" : "min-h-[600px]"}`}>
              <div>
                <h2 className={isWorkspace ? "text-base font-semibold tracking-tight" : "text-xl font-semibold tracking-tight"}>Find Instruments</h2>
                <p className="text-sm text-muted-foreground">Search by ticker or company/fund name, then add to your portfolio.</p>
              </div>

              <Input
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                }}
                placeholder="Search ticker or name (e.g. AAPL, Apple, Vanguard)"
              />

              <div className="flex items-center gap-2">
                <div className="inline-flex items-center rounded-full border border-border bg-white p-1 text-xs">
                  <Button
                    type="button"
                    size="sm"
                    variant={assetTypeFilter === "Stock" ? "default" : "secondary"}
                    onClick={() => setAssetTypeFilter("Stock")}
                    className="h-8 rounded-full px-3"
                  >
                    Stock
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={assetTypeFilter === "ETF" ? "default" : "secondary"}
                    onClick={() => setAssetTypeFilter("ETF")}
                    className="h-8 rounded-full px-3"
                  >
                    ETF
                  </Button>
                </div>
                <div className="flex flex-1 items-center gap-2">
                  <Select value={sectorFilter} onValueChange={setSectorFilter}>
                  <SelectTrigger className="h-7 w-[120px] text-[11px]">
                    <SelectValue placeholder="Sector" />
                  </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sectors</SelectItem>
                      {sectorOptions.map((sector) => (
                      <SelectItem key={sector.value} value={sector.value}>
                        {sector.label} ({sector.count})
                      </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={industryFilter} onValueChange={setIndustryFilter}>
                  <SelectTrigger className="h-7 w-[120px] text-[11px]">
                    <SelectValue placeholder="Industry" />
                  </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Industries</SelectItem>
                      {industryOptions.map((industry) => (
                      <SelectItem key={industry.value} value={industry.value}>
                        {industry.label} ({industry.count})
                      </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {assetTypeFilter === "ETF" ? (
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                      <SelectTrigger className="h-7 w-[120px] text-[11px]">
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {categoryOptions.map((category) => (
                        <SelectItem key={category.value} value={category.value}>
                          {category.label} ({category.count})
                        </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {sectorFilter !== "all" ? <span className="rounded-full border px-2 py-0.5">Sector: {sectorFilter}</span> : null}
                {industryFilter !== "all" ? <span className="rounded-full border px-2 py-0.5">Industry: {industryFilter}</span> : null}
                {assetTypeFilter === "ETF" && categoryFilter !== "all" ? <span className="rounded-full border px-2 py-0.5">Category: {categoryFilter}</span> : null}
              </div>


              <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-white p-1 shadow-soft">
                {searchLoading ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">Searching...</div>
                ) : searchResults.length === 0 && searchQuery.trim().length > 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">No results</div>
                ) : searchResults.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">No popular instruments available</div>
                ) : (
                  searchResults.map((result, index) => {
                    const alreadyAdded = selectedSymbols.has(result.symbol.toUpperCase());
                    const atLimit = rows.length >= MAX_HOLDINGS;
                    const disabled = alreadyAdded || atLimit;
                    const sizeValue = result.marketCap ?? null;
                    const risk = riskBadge(result.beta ?? null);
                    const growth = growthBadge(result.yearChange1Y ?? result.yearChange3Y ?? null);
                    const sizeLabel = sizeBadge(sizeValue);
                    const roeLabel = scoreBadge(result.returnOnEquity ?? null, 0.15, 0.05);
                    const peValue = result.trailingPE ?? result.forwardPE ?? null;
                    const peBadge = peValue === null || peValue === undefined || !Number.isFinite(peValue)
                      ? { label: "N/A", tone: "slate" as const }
                      : peValue <= 15
                        ? { label: "Good", tone: "emerald" as const }
                        : peValue <= 30
                          ? { label: "Okay", tone: "amber" as const }
                          : { label: "Expensive", tone: "rose" as const };
                    const revenueLabel = formatLargeCurrency(result.totalRevenue ?? null);
                    const profitLabel = formatLargeCurrency(result.netIncomeToCommon ?? null);
                    const roePct = formatPercent(result.returnOnEquity ?? null, 0);
                    const peText = peValue !== null && peValue !== undefined && Number.isFinite(peValue) ? peValue.toFixed(1) : null;
                    const dividendText = formatPercent(result.dividendYield ?? null, 1);

                    return (
                      <div
                        key={`${result.symbol}-${result.exchange}-${result.name}-${index}`}
                        className="flex items-start justify-between gap-3 rounded-lg px-3 py-2 hover:bg-slate-50"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium">{result.symbol} - {result.name}</p>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeToneClasses[risk.tone]}`}
                              title={result.beta !== null && result.beta !== undefined && Number.isFinite(result.beta)
                                ? `Beta: ${result.beta.toFixed(2)}`
                                : "Beta not available"}
                            >
                              {risk.label}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeToneClasses[growth.tone]}`}
                              title={(() => {
                                const v1 = formatPercent(result.yearChange1Y ?? null, 1);
                                const v3 = formatPercent(result.yearChange3Y ?? null, 1);
                                if (v1 && v3) return `1Y: ${v1} · 3Y avg: ${v3}`;
                                if (v1) return `1Y: ${v1}`;
                                if (v3) return `3Y avg: ${v3}`;
                                return "Growth data not available";
                              })()}
                            >
                              {growth.label}
                            </span>
                            {sizeLabel ? (
                              <span
                                className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
                                title={sizeValue ? `Size: ${formatLargeCurrency(sizeValue)}` : "Size not available"}
                              >
                                {sizeLabel}
                              </span>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {[result.sector, result.industry].filter(Boolean).join(" | ") || [result.exchange, result.country, result.assetType].filter(Boolean).join(" - ")}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
                            <span>
                              ROE: {roePct ?? "—"}{" "}
                              <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badgeToneClasses[roeLabel.tone]}`}>
                                {roeLabel.label}
                              </span>
                            </span>
                            <span>
                              P/E: {peText ?? "—"}{" "}
                              <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badgeToneClasses[peBadge.tone]}`}>
                                {peBadge.label}
                              </span>
                            </span>
                            <span>Rev: {revenueLabel ?? "—"}</span>
                            <span>Profit: {profitLabel ?? "—"}</span>
                            {dividendText ? <span>Yield: {dividendText}</span> : null}
                          </div>
                          {result.longBusinessSummary ? (
                            <p className="mt-1 text-[11px] leading-snug text-slate-500">
                              {result.longBusinessSummary.length > 140
                                ? `${result.longBusinessSummary.slice(0, 140)}...`
                                : result.longBusinessSummary}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {result.longBusinessSummary ? (
                            <span
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-[11px] font-semibold text-slate-600"
                              title={result.longBusinessSummary}
                              aria-label="Summary"
                            >
                              i
                            </span>
                          ) : null}
                          <Button
                            type="button"
                            size="sm"
                            variant={alreadyAdded ? "secondary" : "default"}
                            disabled={disabled}
                            onClick={() => {
                              if (disabled) return;
                              const next = createRow(result.symbol.toUpperCase(), 0);
                              setRows((prev) => [...prev, next]);
                              setWeightInputByRowId((prev) => ({ ...prev, [next.id]: "" }));
                            }}
                            className="shrink-0"
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" /> {alreadyAdded ? "Added" : "Add"}
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {totalSearchResults !== null
                    ? `${Math.min(searchPage * 100 + 1, totalSearchResults)}-${Math.min((searchPage + 1) * 100, totalSearchResults)} of ${totalSearchResults} matches`
                    : `Page ${searchPage + 1}`}
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={searchPage === 0 || searchLoading}
                    onClick={() => setSearchPage((prev) => Math.max(0, prev - 1))}
                  >
                    Prev
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!hasMoreResults || searchLoading}
                    onClick={() => setSearchPage((prev) => prev + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </Card>

            <Card className={`flex flex-col space-y-4 ${isWorkspace ? "h-[540px]" : "min-h-[600px]"}`}>
              <div>
                <h2 className={isWorkspace ? "text-base font-semibold tracking-tight" : "text-xl font-semibold tracking-tight"}>Build Portfolio</h2>
                <p className="text-sm text-muted-foreground">Set target allocations for selected instruments.</p>
              </div>
              <p className="text-xs text-muted-foreground">{rows.length}/{MAX_HOLDINGS} holdings selected.</p>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Save Portfolio</p>
                <div className="flex gap-2">
                  <Input
                    value={savePortfolioName}
                    onChange={(e) => setSavePortfolioName(e.target.value)}
                    placeholder="Portfolio name"
                    className="w-full"
                  />
                  <Button size="sm" onClick={savePortfolio} disabled={savePortfolioBusy}>
                    {savePortfolioBusy ? "Saving..." : "Save"}
                  </Button>
                </div>
                {savePortfolioMessage ? <p className="text-xs text-muted-foreground">{savePortfolioMessage}</p> : null}
              </div>

              <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border p-2">
                {rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No holdings selected yet. Use the search list to add instruments.</p>
                ) : (
                  rows.map((row, index) => (
                    <div className={`grid gap-2 rounded-lg p-1 ${isWorkspace ? "grid-cols-[1fr_120px_auto]" : "md:grid-cols-[1fr_140px_auto]"}`} key={row.id}>
                      <div className="flex items-center rounded-md border border-input bg-slate-50 px-3 text-sm font-medium">
                        {row.symbol}
                      </div>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={weightInputByRowId[row.id] ?? ""}
                        onChange={(event) => {
                          const raw = event.target.value;
                          if (!/^\d*\.?\d*$/.test(raw)) return;
                          setWeightInputByRowId((prev) => ({ ...prev, [row.id]: raw }));
                          const parsedWeight = raw.trim() === "" ? 0 : Number(raw);
                          const updated = [...rows];
                          updated[index] = { ...updated[index], weight: Number.isFinite(parsedWeight) ? parsedWeight : 0 };
                          setRows(updated);
                        }}
                        onBlur={() => {
                          const raw = weightInputByRowId[row.id] ?? "";
                          if (raw.trim() === "") return;
                          const normalized = Number(raw);
                          if (!Number.isFinite(normalized)) return;
                          setWeightInputByRowId((prev) => ({ ...prev, [row.id]: String(normalized) }));
                        }}
                        placeholder="Weight %"
                      />
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setRows(rows.filter((_, rowIndex) => rowIndex !== index));
                          setWeightInputByRowId((prev) => {
                            const copy = { ...prev };
                            delete copy[row.id];
                            return copy;
                          });
                        }}
                        aria-label="Delete holding"
                        className="w-full p-0 md:h-10 md:w-10"
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  ))
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={normalizeWeights}>Normalize</Button>
              </div>

              <p className={`text-sm ${Math.abs(totalWeight - 100) < 0.01 ? "text-emerald-700" : "text-amber-700"}`}>
                Total Weight: {totalWeight.toFixed(2)}%
              </p>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
            </Card>
          </div>

          <Card className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Starting Amount & Contributions</h3>
              <p className="text-xs text-muted-foreground">Applies when you run analysis.</p>
            </div>
            <div className="grid gap-2 md:grid-cols-4">
              <div className="space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Start Amount</p>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={startValueInput}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, "");
                    if (!raw) {
                      setStartValueInput("");
                      return;
                    }
                    setStartValueInput(Number(raw).toLocaleString());
                  }}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Contribution</p>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={contributionAmountInput}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, "");
                    if (!raw) {
                      setContributionAmountInput("");
                      return;
                    }
                    setContributionAmountInput(Number(raw).toLocaleString());
                  }}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Frequency</p>
                <Select value={contributionFrequency} onValueChange={(value) => setContributionFrequency(value as "weekly" | "monthly" | "yearly")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Monthly" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Rebalancing</p>
                  <div className="group relative">
                    <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    <div className="pointer-events-none absolute right-0 top-5 z-20 hidden w-56 rounded-lg border border-border bg-white p-2 text-[11px] leading-snug text-muted-foreground shadow-soft group-hover:block">
                      Rebalancing keeps target weights by selling winners and buying laggards on a schedule.
                    </div>
                  </div>
                </div>
                <Select
                  value={rebalanceFrequency}
                  onValueChange={(value) => setRebalanceFrequency(value as RebalanceFrequencyOption)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Monthly" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No rebalancing</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>

          <Button
            size="lg"
            className="w-full gap-2"
            disabled={saving}
            onClick={async () => {
              setError(null);

              const activeRows = rows.filter((row) => row.weight > 0 || row.symbol.trim().length > 0);
              if (!activeRows.length) {
                setError("Add at least one valid ticker.");
                return;
              }
              if (activeRows.length > MAX_HOLDINGS) {
                setError(`Portfolio can contain at most ${MAX_HOLDINGS} holdings.`);
                return;
              }

              if (Math.abs(totalWeight - 100) > 0.01) {
                setError("Total portfolio weight must equal 100%.");
                return;
              }

              if (!Number.isFinite(startValue) || startValue <= 0) {
                setError("Starting amount must be greater than zero.");
                return;
              }
              if (!Number.isFinite(contributionAmount) || contributionAmount < 0) {
                setError("Contribution amount must be zero or greater.");
                return;
              }

              setSaving(true);
              try {
                const symbols = [...new Set(activeRows.map((row) => row.symbol.toUpperCase()))];
                const { data, error: dbError } = await supabase
                  .from("instruments")
                  .select("symbol")
                  .in("symbol", symbols);

                if (dbError) {
                  setError(`Ticker validation failed: ${dbError.message}`);
                  return;
                }

                const found = new Set((data ?? []).map((item) => item.symbol));
                const missing = symbols.filter((symbol) => !found.has(symbol));
                if (missing.length) {
                  setError(`Invalid ticker(s): ${missing.join(", ")}. Please select from search results.`);
                  return;
                }

                saveConfig();
                if (pathname === "/workspace") {
                  const target = document.getElementById("analysis-section");
                  target?.scrollIntoView({ behavior: "smooth", block: "start" });
                  window.location.hash = "analysis";
                } else {
                  router.push("/workspace#analysis");
                }
              } finally {
                setSaving(false);
              }
            }}
          >
            <Sparkles className="h-4 w-4" /> {saving ? "Validating..." : "Run Analysis"}
          </Button>
        </>
      ) : null}
    </div>
  );
}
