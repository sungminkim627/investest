"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Edit3, Eye, EyeOff, Info, Plus, Trash2, X } from "lucide-react";
import { BuildPortfolioClient, prefetchSearchCache } from "@/components/portfolio/build-portfolio-client";
import { PerformanceChartMulti, type SeriesEntry } from "@/components/portfolio/performance-chart-multi";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AnalyzeResponse, BenchmarkResponse, HoldingInput, TimeRange } from "@/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { signInWithGoogleIdToken } from "@/lib/auth/google";
import { ResponsiveContainer as RechartsResponsiveContainer } from "recharts";

const BENCHMARKS = ["SPY", "QQQ", "VTI", "AGG"] as const;
const RANGES: TimeRange[] = ["1Y", "3Y", "5Y", "10Y"];
type RebalanceFrequencyOption = "none" | "monthly" | "quarterly" | "yearly";
const PORTFOLIO_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#ef4444", "#7c3aed", "#0891b2", "#0ea5e9", "#14b8a6"];

function HoldingsPopover({ label, hasHoldings }: { label: string; hasHoldings: boolean }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = 260;
    const left = Math.min(rect.left, window.innerWidth - width - 12);
    setPos({ top: rect.bottom + 6, left: Math.max(12, left) });
  }, [open]);

  if (!hasHoldings) {
    return <p className="mt-1 text-[10px] text-muted-foreground">No holdings yet</p>;
  }

  return (
    <div className="mt-1 text-[10px] text-muted-foreground">
      <p
        ref={triggerRef}
        className="truncate"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {label}
      </p>
      {open && pos
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[120] w-64 rounded-lg border border-border bg-white p-2 text-[11px] leading-snug text-muted-foreground shadow-soft"
              style={{ top: pos.top, left: pos.left }}
            >
              {label}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function InfoPopover({
  content,
  width = 240,
  align = "right"
}: {
  content: string;
  width?: number;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const leftBase = align === "right" ? rect.right - width : rect.left;
    const left = Math.min(leftBase, window.innerWidth - width - 12);
    setPos({ top: rect.bottom + 8, left: Math.max(12, left) });
  }, [open, width, align]);

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <Info className="h-3.5 w-3.5 text-muted-foreground" />
      </span>
      {open && pos
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[120] rounded-lg border border-border bg-white p-2 text-[11px] leading-snug text-muted-foreground shadow-soft"
              style={{ top: pos.top, left: pos.left, width }}
            >
              {content}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function MetricCard({
  label,
  info,
  rows
}: {
  label: string;
  info: string;
  rows: { name: string; valueLabel: string; rawValue: number; color?: string }[];
}) {
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <InfoPopover content={info} width={240} align="right" />
      </div>
      {rows.length ? (
        <div className="space-y-1 text-sm">
          {rows.map((row, index) => (
            <div key={`${label}-${row.name}`} className="flex items-center justify-between">
              <span className="flex min-w-0 items-center gap-2 truncate">
                <span className="inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color ?? "#9ca3af" }} />
                <span className="truncate">{index + 1}. {row.name}</span>
              </span>
              <span className="text-muted-foreground">{row.valueLabel}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Run analysis to see rankings.</p>
      )}
    </Card>
  );
}

interface PortfolioItem {
  id: string;
  name: string;
  holdings: HoldingInput[];
  start_value: number;
  contribution_amount: number;
  contribution_frequency: "weekly" | "monthly" | "yearly";
  rebalance_frequency: RebalanceFrequencyOption;
  isGuest?: boolean;
  locked?: boolean;
  isNew?: boolean;
  color?: string;
}

interface Props {
  initialItems: PortfolioItem[];
  userId?: string | null;
}

function loadGuestPortfolio(): PortfolioItem {
  const holdingsRaw = localStorage.getItem("investest:holdings") ?? "[]";
  const holdings = (JSON.parse(holdingsRaw) as HoldingInput[]).map((h) => ({
    symbol: h.symbol.toUpperCase(),
    weight: h.weight
  }));
  const resolvedHoldings = holdings.length ? holdings : [{ symbol: "SPY", weight: 100 }];
  const startValue = Number(localStorage.getItem("investest:startValue") ?? 10000) || 10000;
  const contributionAmount = Number(localStorage.getItem("investest:contributionAmount") ?? 0) || 0;
  const contributionFrequency = (localStorage.getItem("investest:contributionFrequency") as "weekly" | "monthly" | "yearly") ?? "monthly";
  const rebalanceFrequency = (localStorage.getItem("investest:rebalanceFrequency") as RebalanceFrequencyOption) ?? "none";
  return {
    id: "guest",
    name: "My Portfolio",
    holdings: resolvedHoldings,
    start_value: startValue,
    contribution_amount: contributionAmount,
    contribution_frequency: contributionFrequency,
    rebalance_frequency: rebalanceFrequency,
    isGuest: true
  };
}

export function WorkspaceClient({ initialItems, userId }: Props) {
  const supabase = createSupabaseBrowserClient();
  const isLoggedIn = Boolean(userId);
  const authReloadedRef = useRef(false);
  const [items, setItems] = useState<PortfolioItem[]>(initialItems);
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set(initialItems.map((item) => item.id)));
  const [analysisById, setAnalysisById] = useState<Record<string, AnalyzeResponse>>({});
  const [benchmarkData, setBenchmarkData] = useState<BenchmarkResponse | null>(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [dirtyById, setDirtyById] = useState<Record<string, boolean>>({});
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [isHydrated, setIsHydrated] = useState(false);
  const [benchmarkSymbol, setBenchmarkSymbol] = useState<(typeof BENCHMARKS)[number]>("SPY");
  const [benchmarkStartValue, setBenchmarkStartValue] = useState("10,000");
  const [benchmarkContributionAmount, setBenchmarkContributionAmount] = useState("");
  const [benchmarkContributionFrequency, setBenchmarkContributionFrequency] = useState<"weekly" | "monthly" | "yearly">("monthly");
  const [benchmarkRebalanceFrequency, setBenchmarkRebalanceFrequency] = useState<RebalanceFrequencyOption>("none");
  const [benchmarkVisible, setBenchmarkVisible] = useState(true);
  const [draftBenchmarkSymbol, setDraftBenchmarkSymbol] = useState<(typeof BENCHMARKS)[number]>("SPY");
  const [draftBenchmarkStartValue, setDraftBenchmarkStartValue] = useState("10,000");
  const [draftBenchmarkContributionAmount, setDraftBenchmarkContributionAmount] = useState("");
  const [draftBenchmarkContributionFrequency, setDraftBenchmarkContributionFrequency] = useState<"weekly" | "monthly" | "yearly">("monthly");
  const [draftBenchmarkRebalanceFrequency, setDraftBenchmarkRebalanceFrequency] = useState<RebalanceFrequencyOption>("none");
  const [timeRange, setTimeRange] = useState<TimeRange>("5Y");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingBenchmark, setEditingBenchmark] = useState(false);

  const handleSignIn = useCallback(async () => {
    await signInWithGoogleIdToken();
  }, []);

  const applyColors = (itemsToColor: PortfolioItem[]) => {
    if (typeof window === "undefined") return itemsToColor;
    const stored = window.localStorage.getItem("investest:portfolioColors");
    let map: Record<string, string> = {};
    try {
      map = stored ? JSON.parse(stored) : {};
    } catch {
      map = {};
    }
    const used = new Set(Object.values(map));
    const nextColor = () => PORTFOLIO_COLORS.find((c) => !used.has(c)) ?? PORTFOLIO_COLORS[0];

    const updated = itemsToColor.map((item) => {
      if (item.color) return item;
      const fromMap = map[item.id];
      if (fromMap) {
        used.add(fromMap);
        return { ...item, color: fromMap };
      }
      const color = nextColor();
      used.add(color);
      map[item.id] = color;
      return { ...item, color };
    });

    window.localStorage.setItem("investest:portfolioColors", JSON.stringify(map));
    return updated;
  };

  useEffect(() => {
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event) => {
      if (authReloadedRef.current) return;
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        authReloadedRef.current = true;
        window.location.reload();
      }
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (isLoggedIn) return;
    const guest = loadGuestPortfolio();
    const colored = applyColors([guest]);
    setItems(colored);
    setActiveIds(new Set([guest.id]));
  }, [isLoggedIn]);

  useEffect(() => {
    const savedBenchmark = window.localStorage.getItem("investest:benchmark");
    const savedRange = window.localStorage.getItem("investest:timeRange");
    const savedBenchmarkStart = window.localStorage.getItem("investest:benchmarkStartValue");
    const savedBenchmarkContribution = window.localStorage.getItem("investest:benchmarkContributionAmount");
    const savedBenchmarkFrequency = window.localStorage.getItem("investest:benchmarkContributionFrequency");
    const savedBenchmarkRebalance = window.localStorage.getItem("investest:benchmarkRebalanceFrequency");
    const savedBenchmarkVisible = window.localStorage.getItem("investest:benchmarkVisible");
    if (savedBenchmark && BENCHMARKS.includes(savedBenchmark as (typeof BENCHMARKS)[number])) {
      setBenchmarkSymbol(savedBenchmark as (typeof BENCHMARKS)[number]);
    }
    if (savedRange && RANGES.includes(savedRange as TimeRange)) {
      setTimeRange(savedRange as TimeRange);
    }
    if (savedBenchmarkStart) {
      const raw = savedBenchmarkStart.replace(/[^0-9]/g, "");
      setBenchmarkStartValue(raw ? Number(raw).toLocaleString() : "");
    }
    if (savedBenchmarkContribution) {
      const raw = savedBenchmarkContribution.replace(/[^0-9]/g, "");
      setBenchmarkContributionAmount(raw ? Number(raw).toLocaleString() : "");
    }
    if (savedBenchmarkFrequency === "weekly" || savedBenchmarkFrequency === "monthly" || savedBenchmarkFrequency === "yearly") {
      setBenchmarkContributionFrequency(savedBenchmarkFrequency);
    }
    if (savedBenchmarkRebalance === "none" || savedBenchmarkRebalance === "monthly" || savedBenchmarkRebalance === "quarterly" || savedBenchmarkRebalance === "yearly") {
      setBenchmarkRebalanceFrequency(savedBenchmarkRebalance);
    }
    if (savedBenchmarkVisible === "false") {
      setBenchmarkVisible(false);
    }
    setDraftBenchmarkSymbol(
      savedBenchmark && BENCHMARKS.includes(savedBenchmark as (typeof BENCHMARKS)[number])
        ? (savedBenchmark as (typeof BENCHMARKS)[number])
        : "SPY"
    );
    setDraftBenchmarkStartValue(savedBenchmarkStart ? Number(savedBenchmarkStart.replace(/[^0-9]/g, "") || 0).toLocaleString() : "10,000");
    setDraftBenchmarkContributionAmount(
      savedBenchmarkContribution ? Number(savedBenchmarkContribution.replace(/[^0-9]/g, "") || 0).toLocaleString() : ""
    );
    if (savedBenchmarkFrequency === "weekly" || savedBenchmarkFrequency === "monthly" || savedBenchmarkFrequency === "yearly") {
      setDraftBenchmarkContributionFrequency(savedBenchmarkFrequency);
    }
    if (savedBenchmarkRebalance === "none" || savedBenchmarkRebalance === "monthly" || savedBenchmarkRebalance === "quarterly" || savedBenchmarkRebalance === "yearly") {
      setDraftBenchmarkRebalanceFrequency(savedBenchmarkRebalance);
    }
    setItems((prev) => applyColors(prev));
    setIsHydrated(true);
  }, []);

  const maxSlots = 4;
  const lockedSlots = !isLoggedIn ? Math.max(0, maxSlots - 1) : 0;

  const visibleItems = items.slice(0, maxSlots);
  const emptySlots = isLoggedIn ? Math.max(0, maxSlots - visibleItems.length) : 0;
  const activeItems = visibleItems.filter((item) => activeIds.has(item.id));

  const toggleActive = (id: string) => {
    setActiveIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const openEditor = (item: PortfolioItem) => {
    setEditingId(item.id);
  };

  const closeEditor = () => {
    setEditingId(null);
  };

  const addNewPortfolio = () => {
    if (!isLoggedIn) return;
    if (visibleItems.length >= maxSlots) return;
    const stored = window.localStorage.getItem("investest:portfolioColors");
    const map: Record<string, string> = stored ? JSON.parse(stored) : {};
    const used = new Set(Object.values(map));
    const nextColor = PORTFOLIO_COLORS.find((c) => !used.has(c)) ?? PORTFOLIO_COLORS[0];
    const newItem: PortfolioItem = {
      id: `new-${Date.now()}`,
      name: "Untitled",
      holdings: [],
      start_value: 10000,
      contribution_amount: 0,
      contribution_frequency: "monthly",
      rebalance_frequency: "none",
      isNew: true,
      color: nextColor
    };
    setItems((prev) => [newItem, ...prev]);
    setActiveIds((prev) => new Set(prev).add(newItem.id));
    setDirtyById((prev) => ({ ...prev, [newItem.id]: true }));
    openEditor(newItem);
  };

  const [analysisMetaById, setAnalysisMetaById] = useState<Record<string, { timeRange: TimeRange }>>({});

  const buildAnalysisCacheKey = useCallback((item: PortfolioItem) => {
    const holdingsKey = [...item.holdings]
      .map((h) => ({ symbol: h.symbol.toUpperCase(), weight: Number(h.weight) }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .map((h) => `${h.symbol}:${h.weight}`)
      .join(",");
    return [
      "analysis",
      item.id,
      timeRange,
      item.start_value,
      item.contribution_amount,
      item.contribution_frequency,
      item.rebalance_frequency,
      holdingsKey
    ].join("|");
  }, [
    timeRange
  ]);

  const getCachedAnalysis = useCallback((item: PortfolioItem) => {
    if (typeof window === "undefined") return null;
    const key = buildAnalysisCacheKey(item);
    const raw = window.localStorage.getItem(`investest:${key}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { ts: number; payload: AnalyzeResponse };
      if (!parsed?.payload) return null;
      const ageMs = Date.now() - parsed.ts;
      if (ageMs > 1000 * 60 * 60 * 12) return null; // 12h cache
      return parsed.payload;
    } catch {
      return null;
    }
  }, [buildAnalysisCacheKey]);

  const setCachedAnalysis = useCallback((item: PortfolioItem, payload: AnalyzeResponse) => {
    if (typeof window === "undefined") return;
    const key = buildAnalysisCacheKey(item);
    window.localStorage.setItem(`investest:${key}`, JSON.stringify({ ts: Date.now(), payload }));
  }, [buildAnalysisCacheKey]);

  const runAnalysisFor = useCallback(async (toRun: PortfolioItem[]) => {
    if (!toRun.length) return;

    window.localStorage.setItem("investest:timeRange", timeRange);

    await Promise.all(
      toRun.map(async (item) => {
        const cached = getCachedAnalysis(item);
        if (cached) {
          setAnalysisById((prev) => ({ ...prev, [item.id]: cached }));
          setAnalysisMetaById((prev) => ({ ...prev, [item.id]: { timeRange } }));
          setDirtyById((prev) => ({ ...prev, [item.id]: false }));
          return;
        }
        setLoadingIds((prev) => new Set(prev).add(item.id));
        try {
          const response = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              holdings: item.holdings,
              timeRange,
              startValue: item.start_value,
              contributionAmount: item.contribution_amount,
              contributionFrequency: item.contribution_frequency,
              rebalanceFrequency: item.rebalance_frequency
            })
          });
          if (!response.ok) {
            const err = await response.json().catch(() => ({ error: "Analyze request failed" }));
            throw new Error(err.error ?? "Analyze request failed");
          }
          const payload = (await response.json()) as AnalyzeResponse;
          setAnalysisById((prev) => ({ ...prev, [item.id]: payload }));
          setAnalysisMetaById((prev) => ({ ...prev, [item.id]: { timeRange } }));
          setDirtyById((prev) => ({ ...prev, [item.id]: false }));
          setCachedAnalysis(item, payload);
        } catch (error) {
          console.error(error);
        } finally {
          setLoadingIds((prev) => {
            const next = new Set(prev);
            next.delete(item.id);
            return next;
          });
        }
      })
    );
  }, [
    getCachedAnalysis,
    setCachedAnalysis,
    timeRange
  ]);

  const runAnalysis = async () => {
    const toRun = visibleItems.filter((item) => {
      if (!item.holdings.length) return false;
      const meta = analysisMetaById[item.id];
      if (!meta) return true;
      if (meta.timeRange !== timeRange) return true;
      return dirtyById[item.id] || !analysisById[item.id];
    });
    await runAnalysisFor(toRun);
  };

  useEffect(() => {
    if (!isHydrated) return;
    const toRun = visibleItems.filter((item) => {
      if (!item.holdings.length) return false;
      const meta = analysisMetaById[item.id];
      if (!meta) return true;
      return meta.timeRange !== timeRange;
    });
    if (toRun.length) {
      void runAnalysisFor(toRun);
    }
  }, [
    analysisMetaById,
    isHydrated,
    runAnalysisFor,
    timeRange,
    visibleItems
  ]);

  const runBenchmarkAnalysis = useCallback(async (override?: {
    symbol: (typeof BENCHMARKS)[number];
    startValue: string;
    contributionAmount: string;
    contributionFrequency: "weekly" | "monthly" | "yearly";
    rebalanceFrequency: RebalanceFrequencyOption;
  }) => {
    setBenchmarkLoading(true);
    const ctx = override ?? {
      symbol: benchmarkSymbol,
      startValue: benchmarkStartValue,
      contributionAmount: benchmarkContributionAmount,
      contributionFrequency: benchmarkContributionFrequency,
      rebalanceFrequency: benchmarkRebalanceFrequency
    };
    try {
      const response = await fetch("/api/benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          benchmarkSymbol: ctx.symbol,
          timeRange,
          startValue: Number(ctx.startValue.replace(/,/g, "")) || 10000,
          contributionAmount: Number(ctx.contributionAmount.replace(/,/g, "")) || 0,
          contributionFrequency: ctx.contributionFrequency,
          rebalanceFrequency: ctx.rebalanceFrequency
        })
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Benchmark request failed" }));
        throw new Error(err.error ?? "Benchmark request failed");
      }
      const payload = (await response.json()) as BenchmarkResponse;
      setBenchmarkData(payload);
    } catch (error) {
      console.error(error);
    } finally {
      setBenchmarkLoading(false);
    }
  }, [
    benchmarkContributionAmount,
    benchmarkContributionFrequency,
    benchmarkRebalanceFrequency,
    benchmarkStartValue,
    benchmarkSymbol,
    timeRange
  ]);

  useEffect(() => {
    if (!isHydrated) return;
    void runBenchmarkAnalysis();
  }, [
    benchmarkContributionAmount,
    benchmarkContributionFrequency,
    benchmarkRebalanceFrequency,
    benchmarkStartValue,
    benchmarkSymbol,
    isHydrated,
    runBenchmarkAnalysis,
    timeRange
  ]);

  useEffect(() => {
    if (!isHydrated) return;
    void prefetchSearchCache();
  }, [isHydrated]);


  const handleCommit = async (payload: {
    name: string;
    holdings: HoldingInput[];
    startValue: number;
    contributionAmount: number;
    contributionFrequency: "weekly" | "monthly" | "yearly";
    rebalanceFrequency: RebalanceFrequencyOption;
  }) => {
    if (!editingId) return;
    const nextName = payload.name.trim() || "Untitled";

    const updated: PortfolioItem = {
      ...items.find((item) => item.id === editingId)!,
      name: nextName,
      holdings: payload.holdings,
      start_value: payload.startValue,
      contribution_amount: payload.contributionAmount,
      contribution_frequency: payload.contributionFrequency,
      rebalance_frequency: payload.rebalanceFrequency
    };

    setItems((prev) => prev.map((item) => (item.id === editingId ? updated : item)));
    setDirtyById((prev) => ({ ...prev, [editingId]: true }));

    if (updated.isGuest) {
      localStorage.setItem("investest:holdings", JSON.stringify(updated.holdings));
      localStorage.setItem("investest:startValue", String(updated.start_value));
      localStorage.setItem("investest:contributionAmount", String(updated.contribution_amount));
      localStorage.setItem("investest:contributionFrequency", updated.contribution_frequency);
      localStorage.setItem("investest:rebalanceFrequency", updated.rebalance_frequency);
      window.dispatchEvent(new CustomEvent("investest:holdings-updated"));
      await runAnalysisFor([updated]);
      closeEditor();
      return;
    }

    if (updated.isNew) {
      try {
        const { data: created, error: createError } = await supabase
          .from("portfolios")
          .insert([{
            user_id: userId,
            name: updated.name,
            start_value: updated.start_value,
            contribution_amount: updated.contribution_amount,
            contribution_frequency: updated.contribution_frequency,
            rebalance_frequency: updated.rebalance_frequency
          }])
          .select("id")
          .single();

        if (createError || !created) throw createError ?? new Error("Failed to create portfolio");

        if (updated.holdings.length) {
          const { error: holdingsError } = await supabase.from("portfolio_holdings").insert(
            updated.holdings.map((h) => ({
              portfolio_id: created.id,
              symbol: h.symbol.toUpperCase(),
              weight: h.weight
            }))
          );
          if (holdingsError) throw holdingsError;
        }

        const updatedWithId = { ...updated, id: created.id, isNew: false };
        setItems((prev) =>
          prev.map((item) =>
            item.id === editingId ? updatedWithId : item
          )
        );
        setActiveIds((prev) => {
          const next = new Set(prev);
          next.delete(editingId);
          next.add(created.id);
          return next;
        });
        setDirtyById((prev) => {
          const next = { ...prev };
          delete next[editingId];
          next[created.id] = false;
          return next;
        });
        await runAnalysisFor([updatedWithId]);
      } catch (error) {
        console.error(error);
      }
      closeEditor();
      return;
    }

    if (isLoggedIn && userId && !updated.isGuest) {
      try {
        await supabase
          .from("portfolios")
          .update({
            name: updated.name,
            start_value: updated.start_value,
            contribution_amount: updated.contribution_amount,
            contribution_frequency: updated.contribution_frequency,
            rebalance_frequency: updated.rebalance_frequency
          })
          .eq("id", updated.id)
          .eq("user_id", userId);

        await supabase.from("portfolio_holdings").delete().eq("portfolio_id", updated.id);
        if (updated.holdings.length) {
          await supabase.from("portfolio_holdings").insert(
            updated.holdings.map((h) => ({
              portfolio_id: updated.id,
              symbol: h.symbol.toUpperCase(),
              weight: h.weight
            }))
          );
        }
      } catch (error) {
        console.error(error);
      }
    }

    await runAnalysisFor([updated]);
    closeEditor();
  };

  const handleDelete = async (item: PortfolioItem) => {
    if (item.isNew) {
      setItems((prev) => prev.filter((p) => p.id !== item.id));
      setActiveIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      setDirtyById((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }
    if (item.isGuest) {
      localStorage.setItem("investest:holdings", JSON.stringify([]));
      localStorage.setItem("investest:startValue", "10000");
      localStorage.setItem("investest:contributionAmount", "0");
      localStorage.setItem("investest:contributionFrequency", "monthly");
      localStorage.setItem("investest:rebalanceFrequency", "none");
      const cleared = loadGuestPortfolio();
      const colored = applyColors([cleared]);
      setItems(colored);
      setActiveIds(new Set([cleared.id]));
      setAnalysisById({});
      setDirtyById({});
      window.dispatchEvent(new CustomEvent("investest:holdings-updated"));
      return;
    }

    try {
      await supabase.from("portfolio_holdings").delete().eq("portfolio_id", item.id);
      await supabase.from("portfolios").delete().eq("id", item.id).eq("user_id", userId);
    } catch (error) {
      console.error(error);
    }

    setItems((prev) => prev.filter((p) => p.id !== item.id));
    setActiveIds((prev) => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
    setAnalysisById((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    setDirtyById((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
  };

  const chartSeries = useMemo(() => {
    return activeItems.flatMap((item) => {
      const data = analysisById[item.id];
      if (!data) return [];
      const entry: SeriesEntry = {
        id: item.id,
        name: item.name,
        color: item.color,
        series: data.portfolioSeries,
        projection: data.portfolioProjection
      };
      return [entry];
    });
  }, [activeItems, analysisById]);

  const activeCount = activeItems.length;
  const benchmarkSeries = benchmarkVisible ? benchmarkData?.benchmarkSeries ?? [] : [];
  const benchmarkProjection = benchmarkVisible ? benchmarkData?.benchmarkProjection ?? [] : [];
  const benchmarkMetrics = benchmarkVisible ? benchmarkData?.metrics ?? null : null;
  const benchmarkRisk = benchmarkVisible ? benchmarkData?.riskScore ?? null : null;

  const buildRanking = (
    selector: (data: AnalyzeResponse) => number | null | undefined,
    format: (value: number) => string,
    higherIsBetter = true,
    benchmarkValue?: number | null
  ) => {
    const rows: { name: string; valueLabel: string; rawValue: number; color?: string }[] = [];
    for (const item of activeItems) {
      const data = analysisById[item.id];
      if (!data) continue;
      const value = selector(data);
      if (value === null || value === undefined || Number.isNaN(value)) continue;
      rows.push({ name: item.name, valueLabel: format(value), rawValue: value, color: item.color });
    }
    if (benchmarkValue !== null && benchmarkValue !== undefined && !Number.isNaN(benchmarkValue)) {
      rows.push({ name: "Benchmark", valueLabel: format(benchmarkValue), rawValue: benchmarkValue, color: "#9ca3af" });
    }
    return rows.sort((a, b) => (higherIsBetter ? b.rawValue - a.rawValue : a.rawValue - b.rawValue));
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.6fr]">
        <div>
          <Card className="flex h-[510px] flex-col space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <p className="text-base font-semibold">Performance</p>
                <span className="text-xs text-muted-foreground">{activeCount} active</span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
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
            <div className="flex-1 min-h-0">
              {chartSeries.length || (benchmarkVisible && benchmarkSeries.length) ? (
                <PerformanceChartMulti series={chartSeries} benchmark={benchmarkSeries} benchmarkProjection={benchmarkProjection} showProjection />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-muted-foreground">{benchmarkLoading ? "Loading benchmark..." : "Run analysis to see performance."}</p>
                </div>
              )}
            </div>
            <p className="text-[10px] leading-snug text-muted-foreground">
              Projections are modeled using each asset’s historical growth and volatility over the selected time range. We extend those
              return/volatility estimates forward and apply your contribution and rebalancing schedule. This is a statistical estimate,
              not a guarantee of future performance.
            </p>
          </Card>
        </div>

        <Card className="flex h-[510px] flex-col space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Portfolios</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={addNewPortfolio}
                disabled={!isLoggedIn || visibleItems.length >= maxSlots}
                className="h-8 px-3 text-xs"
              >
                <Plus className="h-3.5 w-3.5" /> New
              </Button>
            </div>
          </div>
          <div className="space-y-2 overflow-y-auto pr-1">
            <div className={`rounded-lg border p-2 ${benchmarkVisible ? "border-emerald-200 bg-emerald-50/60" : "border-border bg-slate-50 text-slate-500"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-3.5 w-3.5 rounded-full border border-border bg-slate-200" />
                  <p className="text-[11px] font-semibold text-slate-900">Benchmark · {benchmarkSymbol}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border text-slate-600"
                    onClick={() => setBenchmarkVisible((prev) => !prev)}
                    aria-label={benchmarkVisible ? "Hide benchmark" : "Show benchmark"}
                  >
                    {benchmarkVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border text-slate-600"
                    onClick={() => {
                      setDraftBenchmarkSymbol(benchmarkSymbol);
                      setDraftBenchmarkStartValue(benchmarkStartValue);
                      setDraftBenchmarkContributionAmount(benchmarkContributionAmount);
                      setDraftBenchmarkContributionFrequency(benchmarkContributionFrequency);
                      setDraftBenchmarkRebalanceFrequency(benchmarkRebalanceFrequency);
                      setEditingBenchmark(true);
                    }}
                    aria-label="Edit benchmark"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground truncate">
                Start ${Number(benchmarkStartValue.replace(/,/g, "")) || 10000} · Contrib ${Number(benchmarkContributionAmount.replace(/,/g, "")) || 0} / {benchmarkContributionFrequency} · Rebalance {benchmarkRebalanceFrequency}
              </div>
            </div>
            {visibleItems.map((item) => {
              const active = activeIds.has(item.id);
              const dirty = dirtyById[item.id];
              const loading = loadingIds.has(item.id);
              const sortedHoldings = [...item.holdings].sort((a, b) => b.weight - a.weight);
              const holdingLabel = sortedHoldings.length
                ? sortedHoldings.map((h) => `${h.symbol.toUpperCase()} ${h.weight.toFixed(1)}%`).join(" · ")
                : "No holdings yet";
              return (
                <div
                  key={item.id}
                  className={`rounded-lg border p-2 transition ${
                    active ? "border-emerald-500 bg-emerald-50" : "border-border bg-slate-50 text-slate-500"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <button
                            className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border"
                            style={{ backgroundColor: item.color ?? PORTFOLIO_COLORS[0] }}
                            onClick={() => setConfirmDeleteId((prev) => (prev === `color-${item.id}` ? null : `color-${item.id}`))}
                            aria-label="Choose color"
                          />
                          {confirmDeleteId === `color-${item.id}` ? (
                            <div className="absolute left-0 top-6 z-20 flex w-36 flex-wrap gap-1 rounded-lg border border-border bg-white p-2 shadow-soft">
                              {PORTFOLIO_COLORS.map((color) => (
                                <button
                                  key={`${item.id}-${color}`}
                                  type="button"
                                  aria-label="Select color"
                                  className={`h-5 w-5 rounded-full border ${item.color === color ? "border-slate-900" : "border-border"}`}
                                  style={{ backgroundColor: color }}
                                  onClick={() => {
                                    setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, color } : p)));
                                    const stored = window.localStorage.getItem("investest:portfolioColors");
                                    let map: Record<string, string> = {};
                                    try {
                                      map = stored ? JSON.parse(stored) : {};
                                    } catch {
                                      map = {};
                                    }
                                    map[item.id] = color;
                                    window.localStorage.setItem("investest:portfolioColors", JSON.stringify(map));
                                    setConfirmDeleteId(null);
                                  }}
                                />
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <p className="text-[11px] font-semibold truncate">{item.name}</p>
                      </div>
                      <HoldingsPopover label={holdingLabel} hasHoldings={sortedHoldings.length > 0} />
                      {!isLoggedIn && item.isGuest ? (
                        <p className="mt-1 text-[10px] text-muted-foreground">Tip: Click the pencil to edit holdings.</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {dirty ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Edited</span> : null}
                      {loading ? <span className="text-[10px] text-muted-foreground">Updating...</span> : null}
                      <button
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border text-slate-600"
                        onClick={() => toggleActive(item.id)}
                        aria-label={active ? "Hide portfolio" : "Show portfolio"}
                      >
                        {active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border text-slate-600"
                        onClick={() => openEditor(item)}
                        aria-label="Edit portfolio"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      {!item.isGuest ? (
                        <div className="relative">
                          <button
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border text-slate-600"
                            onClick={() => setConfirmDeleteId((prev) => (prev === item.id ? null : item.id))}
                            aria-label="Delete portfolio"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          {confirmDeleteId === item.id ? (
                            <div className="absolute right-0 top-10 z-20 w-40 rounded-lg border border-border bg-white p-2 text-xs shadow-soft">
                              <p className="text-[11px] text-muted-foreground">Delete this portfolio?</p>
                              <div className="mt-2 flex items-center justify-end gap-2">
                                <button
                                  className="text-[11px] text-muted-foreground"
                                  onClick={() => setConfirmDeleteId(null)}
                                >
                                  Cancel
                                </button>
                                <button
                                  className="rounded bg-red-600 px-2 py-1 text-[11px] font-semibold text-white"
                                  onClick={() => {
                                    setConfirmDeleteId(null);
                                    handleDelete(item);
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground truncate">
                    Start ${Math.round(item.start_value).toLocaleString()} · Contrib ${Math.round(item.contribution_amount).toLocaleString()} / {item.contribution_frequency} · Rebalance {item.rebalance_frequency}
                  </div>
                </div>
              );
            })}
            {Array.from({ length: emptySlots }).map((_, index) => (
              <div key={`empty-${index}`} className="rounded-lg border border-dashed border-border bg-white/70 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-3.5 w-3.5 rounded-full border border-border bg-slate-200" />
                      <p className="text-[11px] font-semibold text-muted-foreground">Empty slot</p>
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">Create a new portfolio to use this slot.</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                  <span>Start: —</span>
                  <span>Contrib: —</span>
                  <span>Freq: —</span>
                  <span>Rebalance: —</span>
                </div>
              </div>
            ))}
            {!isLoggedIn && lockedSlots > 0 ? (
              <div className="relative rounded-lg border border-dashed border-border bg-white/70 p-2">
                <div className="rounded-lg border border-border bg-white p-2 blur-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-3.5 w-3.5 rounded-full border border-border bg-slate-200" />
                        <p className="text-sm font-semibold text-muted-foreground">Locked slot</p>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">Sign in to unlock more portfolios.</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                    <span>Start: —</span>
                    <span>Contrib: —</span>
                    <span>Freq: —</span>
                    <span>Rebalance: —</span>
                  </div>
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <Button size="sm" onClick={handleSignIn}>
                      Log in
                    </Button>
                    <p className="text-[11px] text-muted-foreground">
                      to unlock more portfolios and save them
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Annualized Return"
          info="Average yearly growth rate implied by historical performance over the selected period."
          rows={buildRanking(
            (data) => data.metrics.annualizedReturn,
            (value) => `${(value * 100).toFixed(2)}%`,
            true,
            benchmarkMetrics?.annualizedReturn ?? null
          )}
        />
        <MetricCard
          label="Annualized Volatility"
          info="How much returns fluctuate year to year. Higher means a bumpier ride."
          rows={buildRanking(
            (data) => data.metrics.annualizedVolatility,
            (value) => `${(value * 100).toFixed(2)}%`,
            false,
            benchmarkMetrics?.annualizedVolatility ?? null
          )}
        />
        <MetricCard
          label="Max Drawdown"
          info="Largest historical drop from a previous peak. Shows worst observed decline."
          rows={buildRanking(
            (data) => data.metrics.maxDrawdown,
            (value) => `${(value * 100).toFixed(2)}%`,
            false,
            benchmarkMetrics?.maxDrawdown ?? null
          )}
        />
        <MetricCard
          label="Risk Score"
          info="A 1-10 score based on volatility and drawdown. Lower is steadier, higher is riskier."
          rows={buildRanking(
            (data) => data.riskScore,
            (value) => `${value.toFixed(1)}/10`,
            false,
            benchmarkRisk ?? null
          )}
        />
      </div>


      {editingId
        ? (() => {
            const current = items.find((item) => item.id === editingId);
            if (!current) return null;
            return createPortal(
              <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-6">
                <div className="flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-white p-6 shadow-xl" style={{ maxHeight: "90vh" }}>
                  <EditPortfolioModal
                    item={current}
                    onCommit={handleCommit}
                    commitButtonId={`edit-portfolio-save-${editingId}`}
                    onClose={closeEditor}
                  />
                </div>
              </div>,
              document.body
            );
          })()
        : null}
      {editingBenchmark
        ? createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-6">
              <div className="w-full max-w-xl rounded-2xl border border-border bg-white p-6 shadow-xl">
                <div className="flex items-center justify-between gap-3 pb-4">
                  <p className="text-lg font-semibold">Benchmark Settings</p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={async () => {
                        const nextCtx = {
                          symbol: draftBenchmarkSymbol,
                          startValue: draftBenchmarkStartValue || "0",
                          contributionAmount: draftBenchmarkContributionAmount || "",
                          contributionFrequency: draftBenchmarkContributionFrequency,
                          rebalanceFrequency: draftBenchmarkRebalanceFrequency
                        };
                        setBenchmarkSymbol(nextCtx.symbol);
                        setBenchmarkStartValue(nextCtx.startValue);
                        setBenchmarkContributionAmount(nextCtx.contributionAmount);
                        setBenchmarkContributionFrequency(nextCtx.contributionFrequency);
                        setBenchmarkRebalanceFrequency(nextCtx.rebalanceFrequency);
                        window.localStorage.setItem("investest:benchmark", nextCtx.symbol);
                        window.localStorage.setItem("investest:benchmarkStartValue", nextCtx.startValue);
                        window.localStorage.setItem("investest:benchmarkContributionAmount", nextCtx.contributionAmount);
                        window.localStorage.setItem("investest:benchmarkContributionFrequency", nextCtx.contributionFrequency);
                        window.localStorage.setItem("investest:benchmarkRebalanceFrequency", nextCtx.rebalanceFrequency);
                        window.localStorage.setItem("investest:benchmarkVisible", String(benchmarkVisible));
                        await runBenchmarkAnalysis(nextCtx);
                        setEditingBenchmark(false);
                      }}
                    >
                      Save
                    </Button>
                    <button
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-slate-600"
                      onClick={() => setEditingBenchmark(false)}
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="grid gap-3">
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Benchmark</p>
                    <Select value={draftBenchmarkSymbol} onValueChange={(value) => setDraftBenchmarkSymbol(value as (typeof BENCHMARKS)[number])}>
                      <SelectTrigger className="h-9 w-28">
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
                  <div className="grid gap-2 rounded-xl border border-border p-3 text-[11px] text-muted-foreground md:grid-cols-2">
                    <div className="space-y-1">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Start Amount</p>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={draftBenchmarkStartValue}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^0-9]/g, "");
                          if (!raw) {
                            setDraftBenchmarkStartValue("");
                            return;
                          }
                          setDraftBenchmarkStartValue(Number(raw).toLocaleString());
                        }}
                        placeholder="0"
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Contribution</p>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={draftBenchmarkContributionAmount}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^0-9]/g, "");
                          if (!raw) {
                            setDraftBenchmarkContributionAmount("");
                            return;
                          }
                          setDraftBenchmarkContributionAmount(Number(raw).toLocaleString());
                        }}
                        placeholder="0"
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Frequency</p>
                      <Select value={draftBenchmarkContributionFrequency} onValueChange={(value) => setDraftBenchmarkContributionFrequency(value as "weekly" | "monthly" | "yearly")}>
                        <SelectTrigger className="h-8">
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
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Rebalancing</p>
                        <InfoPopover
                          content="Rebalancing keeps your target weights on schedule by trimming winners and topping up laggards. With no rebalancing, existing holdings are left alone and new contributions follow the target ratios."
                          width={260}
                          align="right"
                        />
                      </div>
                      <Select value={draftBenchmarkRebalanceFrequency} onValueChange={(value) => setDraftBenchmarkRebalanceFrequency(value as RebalanceFrequencyOption)}>
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder="No rebalancing" />
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
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

const EditPortfolioModal = memo(function EditPortfolioModal({
  item,
  onCommit,
  commitButtonId,
  onClose
}: {
  item: PortfolioItem;
  onCommit: (payload: {
    name: string;
    holdings: HoldingInput[];
    startValue: number;
    contributionAmount: number;
    contributionFrequency: "weekly" | "monthly" | "yearly";
    rebalanceFrequency: RebalanceFrequencyOption;
  }) => void;
  commitButtonId: string;
  onClose: () => void;
}) {
  const nameRef = useRef<HTMLInputElement | null>(null);
  const defaultName = item.name;
  const [startValueInput, setStartValueInput] = useState(
    item.start_value !== undefined && item.start_value !== null ? Number(item.start_value).toLocaleString() : "10,000"
  );
  const [contributionAmountInput, setContributionAmountInput] = useState(
    item.contribution_amount !== undefined && item.contribution_amount !== null
      ? Number(item.contribution_amount).toLocaleString()
      : ""
  );
  const [contributionFrequency, setContributionFrequency] = useState<"weekly" | "monthly" | "yearly">(
    item.contribution_frequency ?? "monthly"
  );
  const [rebalanceFrequency, setRebalanceFrequency] = useState<RebalanceFrequencyOption>(
    item.rebalance_frequency ?? "none"
  );

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <p className="text-lg font-semibold">Edit Portfolio</p>
            <div className="group relative">
              <Input
                ref={nameRef}
                defaultValue={defaultName}
                placeholder="Portfolio name"
                className="h-9 w-56 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                disabled={item.isGuest}
              />
              {item.isGuest ? (
                <div className="pointer-events-none absolute left-0 top-10 z-30 hidden w-56 rounded-lg border border-border bg-white p-2 text-[11px] text-muted-foreground shadow-soft group-hover:block">
                  Log in to customize and save portfolios.
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                document.getElementById(commitButtonId)?.click();
              }}
            >
              Save
            </Button>
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-slate-600"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="grid gap-2 rounded-xl border border-border p-3 text-[11px] text-muted-foreground md:grid-cols-4">
          <div className="space-y-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Start Amount</p>
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
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Contribution</p>
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
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Frequency</p>
            <Select value={contributionFrequency} onValueChange={(value) => setContributionFrequency(value as "weekly" | "monthly" | "yearly")}>
              <SelectTrigger className="h-8">
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
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Rebalancing</p>
              <InfoPopover
                content="Rebalancing keeps your target weights on schedule by trimming winners and topping up laggards. With no rebalancing, existing holdings are left alone and new contributions follow the target ratios."
                width={260}
                align="right"
              />
            </div>
            <Select
              value={rebalanceFrequency}
              onValueChange={(value) => setRebalanceFrequency(value as RebalanceFrequencyOption)}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="No rebalancing" />
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
      </div>
      <div className="flex-1 overflow-y-auto pr-1">
        <EditPortfolioForm
        item={item}
        commitButtonId={commitButtonId}
        onCommit={(payload) => {
          const nameValue = item.isGuest ? defaultName : nameRef.current?.value?.trim() || "Untitled";
          onCommit({ ...payload, name: nameValue });
        }}
        externalInputs={{
          startValueInput,
          setStartValueInput,
          contributionAmountInput,
          setContributionAmountInput,
          contributionFrequency,
          setContributionFrequency,
          rebalanceFrequency,
          setRebalanceFrequency
        }}
        />
      </div>
    </div>
  );
});

const EditPortfolioForm = memo(function EditPortfolioForm({
  item,
  commitButtonId,
  onCommit,
  externalInputs
}: {
  item: PortfolioItem;
  commitButtonId: string;
  onCommit: (payload: {
    name: string;
    holdings: HoldingInput[];
    startValue: number;
    contributionAmount: number;
    contributionFrequency: "weekly" | "monthly" | "yearly";
    rebalanceFrequency: RebalanceFrequencyOption;
  }) => void;
  externalInputs: {
    startValueInput: string;
    setStartValueInput: (value: string) => void;
    contributionAmountInput: string;
    setContributionAmountInput: (value: string) => void;
    contributionFrequency: "weekly" | "monthly" | "yearly";
    setContributionFrequency: (value: "weekly" | "monthly" | "yearly") => void;
    rebalanceFrequency: RebalanceFrequencyOption;
    setRebalanceFrequency: (value: RebalanceFrequencyOption) => void;
  };
}) {
  return (
    <BuildPortfolioClient
      mode="workspace"
      initialName={item.name}
      initialHoldings={item.holdings}
      initialStartValue={item.start_value}
      initialContributionAmount={item.contribution_amount}
      initialContributionFrequency={item.contribution_frequency}
      initialRebalanceFrequency={item.rebalance_frequency}
      persistToLocalStorage={false}
      showSavePortfolio={false}
      showRunAnalysis={false}
      showContributionPanel={false}
      externalInputs={externalInputs}
      commitLabel="Save Changes"
      commitButtonId={commitButtonId}
      hideCommitButton
      onCommit={onCommit}
    />
  );
});
