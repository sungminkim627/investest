import Link from "next/link";
import { ArrowRight, BarChart3, Globe, HeartHandshake } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="space-y-10">
      <section className="subtle-grid overflow-hidden rounded-3xl border border-border bg-white/85 p-8 shadow-soft md:p-12">
        <p className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">Investest V1</p>
        <h1 className="mt-4 max-w-4xl text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
          Test investing ideas without the complexity.
        </h1>
        <p className="mt-4 max-w-2xl text-base text-muted-foreground md:text-lg">
          Build a simple portfolio, run it through real history, and compare it to a benchmark in minutes.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/workspace">
            <Button size="lg" className="h-12 gap-2 px-7 text-base">
              Start Building <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          {
            icon: Globe,
            title: "Market Coverage",
            desc: "Top ~1,250 US + Canadian stocks and ~750 ETFs, ranked by size, across the funds people actually buy."
          },
          {
            icon: BarChart3,
            title: "Clarity Before You Buy",
            desc: "See return, volatility, drawdown, and risk score in one clean dashboard."
          },
          {
            icon: HeartHandshake,
            title: "Invest With Context",
            desc: "Compare your plan to benchmarks, add contributions, and test rebalancing choices."
          }
        ].map((item) => (
          <Card key={item.title} className="space-y-3">
            <item.icon className="h-5 w-5 text-emerald-700" />
            <p className="text-base font-semibold">{item.title}</p>
            <p className="text-sm text-muted-foreground">{item.desc}</p>
          </Card>
        ))}
      </section>

    </div>
  );
}
