"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Trash2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface SavedPortfolio {
  id: string;
  name: string;
  created_at: string;
  holdings: { symbol: string; weight: number }[];
  start_value?: number | null;
  contribution_amount?: number | null;
  contribution_frequency?: "weekly" | "monthly" | "yearly" | null;
  rebalance_frequency?: "none" | "monthly" | "quarterly" | "yearly" | null;
}

interface Props {
  initialItems: SavedPortfolio[];
  userId: string;
}

export function SavedPortfoliosClient({ initialItems, userId }: Props) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [items, setItems] = useState(initialItems);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);

  const canCreate = items.length < 5;

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Save Portfolio</h2>
        <p className="text-sm text-muted-foreground">Free tier limit: 5 saved portfolios per account.</p>
        <div className="flex flex-wrap gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Portfolio name" className="max-w-sm" />
          <Button
            disabled={!canCreate || !name || loading}
            onClick={async () => {
              setCreateMessage(null);
              setLoading(true);
              try {
                const holdingsRaw = localStorage.getItem("investest:holdings") ?? "[]";
                const holdings = JSON.parse(holdingsRaw) as { symbol: string; weight: number }[];
                if (holdings.length > 10) {
                  throw new Error("Portfolio can contain at most 10 holdings.");
                }

                const { data, error } = await supabase
                  .from("portfolios")
                  .insert([{
                    user_id: userId,
                    name,
                    start_value: Number(localStorage.getItem("investest:startValue") ?? 0) || 0,
                    contribution_amount: Number(localStorage.getItem("investest:contributionAmount") ?? 0) || 0,
                    contribution_frequency: (localStorage.getItem("investest:contributionFrequency") as "weekly" | "monthly" | "yearly") ?? "monthly",
                    rebalance_frequency: (localStorage.getItem("investest:rebalanceFrequency") as "none" | "monthly" | "quarterly" | "yearly") ?? "monthly"
                  }])
                  .select("id,name,created_at")
                  .single();

                if (error || !data) throw error ?? new Error("Failed to create portfolio");

                if (holdings.length) {
                  const { error: holdingsError } = await supabase.from("portfolio_holdings").insert(
                    holdings.map((h) => ({
                      portfolio_id: data.id,
                      symbol: h.symbol.toUpperCase(),
                      weight: h.weight
                    }))
                  );

                  if (holdingsError) throw holdingsError;
                }

                setItems([{ ...data, holdings }, ...items]);
                setName("");
                setCreateMessage("Portfolio saved.");
              } catch (error) {
                setCreateMessage(error instanceof Error ? error.message : "Failed to save portfolio.");
              } finally {
                setLoading(false);
              }
            }}
          >
            Create
          </Button>
        </div>
        {createMessage ? <p className="text-xs text-muted-foreground">{createMessage}</p> : null}
      </Card>

      <div className="grid gap-3">
        {items.map((item) => (
          <Card key={item.id} className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-medium">{item.name}</p>
              <p className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleDateString()}</p>
            </div>
            {item.holdings.length ? (
              <div className="text-sm text-muted-foreground">
                {item.holdings.map((h) => `${h.symbol} ${h.weight}%`).join(" - ")}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No holdings saved.</div>
            )}
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>Start: ${Math.round(item.start_value ?? 0).toLocaleString()}</span>
              <span>Contribution: ${Math.round(item.contribution_amount ?? 0).toLocaleString()}</span>
              <span>Freq: {item.contribution_frequency ?? "monthly"}</span>
              <span>Rebalance: {item.rebalance_frequency ?? "monthly"}</span>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                className="gap-2"
                onClick={() => {
                  localStorage.setItem("investest:holdings", JSON.stringify(item.holdings));
                  localStorage.setItem("investest:buildDraft", JSON.stringify({ holdings: item.holdings }));
                  if (item.start_value !== null && item.start_value !== undefined) {
                    localStorage.setItem("investest:startValue", String(item.start_value));
                  }
                  if (item.contribution_amount !== null && item.contribution_amount !== undefined) {
                    localStorage.setItem("investest:contributionAmount", String(item.contribution_amount));
                  }
                  if (item.contribution_frequency) {
                    localStorage.setItem("investest:contributionFrequency", item.contribution_frequency);
                  }
                  if (item.rebalance_frequency) {
                    localStorage.setItem("investest:rebalanceFrequency", item.rebalance_frequency);
                  }
                  window.dispatchEvent(new CustomEvent("investest:holdings-updated"));
                  router.push("/workspace");
                }}
              >
                <Play className="h-3.5 w-3.5" /> Open
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="gap-2 border-red-200 text-red-700 hover:bg-red-50"
                disabled={deletingId === item.id}
                onClick={async () => {
                  setDeletingId(item.id);
                  try {
                    const { error } = await supabase
                      .from("portfolios")
                      .delete()
                      .eq("id", item.id)
                      .eq("user_id", userId);
                    if (error) throw error;
                    setItems((prev) => prev.filter((portfolio) => portfolio.id !== item.id));
                  } finally {
                    setDeletingId(null);
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> {deletingId === item.id ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
