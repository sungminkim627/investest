import { Suspense } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { WorkspaceClient } from "@/components/portfolio/workspace-client";

export default async function WorkspacePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();

  let initialItems: Array<{
    id: string;
    name: string;
    holdings: { symbol: string; weight: number }[];
    start_value: number;
    contribution_amount: number;
    contribution_frequency: "weekly" | "monthly" | "yearly";
    rebalance_frequency: "none" | "monthly" | "quarterly" | "yearly";
  }> = [];

  if (session?.user) {
    const { data: portfolios } = await supabase
      .from("portfolios")
      .select("id,name,start_value,contribution_amount,contribution_frequency,rebalance_frequency,portfolio_holdings(symbol,weight)")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(4);

    initialItems = (portfolios ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      start_value: p.start_value ?? 10000,
      contribution_amount: p.contribution_amount ?? 0,
      contribution_frequency: p.contribution_frequency ?? "monthly",
      rebalance_frequency: p.rebalance_frequency ?? "monthly",
      holdings: (p.portfolio_holdings ?? []).map((h) => ({ symbol: h.symbol, weight: Number(h.weight) }))
    }));
  }

  return (
    <Suspense fallback={null}>
      <WorkspaceClient initialItems={initialItems} userId={session?.user?.id ?? null} />
    </Suspense>
  );
}
