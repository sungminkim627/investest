import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SavedPortfoliosClient } from "@/components/portfolio/saved-portfolios-client";

export default async function SavedPortfoliosPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session) {
    return (
      <div className="mx-auto max-w-md space-y-4 rounded-2xl border border-border bg-white p-6 shadow-soft">
        <h1 className="text-xl font-semibold">Sign in required</h1>
        <p className="text-sm text-muted-foreground">Use Google OAuth to access and save portfolios.</p>
        <form
          action={async () => {
            "use server";
            const supabaseAction = await createSupabaseServerClient();
            const { data } = await supabaseAction.auth.signInWithOAuth({
              provider: "google",
              options: {
                redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/auth/callback`
              }
            });
            if (data.url) redirect(data.url);
          }}
        >
          <Button type="submit">Continue with Google</Button>
        </form>
      </div>
    );
  }

  const { data: portfolios, error } = await supabase
    .from("portfolios")
    .select("id,name,created_at,start_value,contribution_amount,contribution_frequency,rebalance_frequency,portfolio_holdings(symbol,weight)")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return <p className="text-sm text-red-600">Failed to load saved portfolios: {error.message}</p>;
  }

  const items = (portfolios ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    created_at: p.created_at,
    start_value: p.start_value ?? null,
    contribution_amount: p.contribution_amount ?? null,
    contribution_frequency: p.contribution_frequency ?? null,
    rebalance_frequency: p.rebalance_frequency ?? null,
    holdings: (p.portfolio_holdings ?? []).map((h) => ({ symbol: h.symbol, weight: Number(h.weight) }))
  }));

  return <SavedPortfoliosClient initialItems={items} userId={session.user.id} />;
}
