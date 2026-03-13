import Link from "next/link";
import { ArrowRight, BarChart3, Globe, HeartHandshake } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const templates = [
  {
    name: "S&P 500 Core",
    description: "Single-core US market exposure.",
    risk: "Aggressive",
    query: "SPY:100"
  },
  {
    name: "Classic 60/40",
    description: "Balanced equity and bond mix.",
    risk: "Balanced",
    query: "VTI:60,BND:40"
  },
  {
    name: "Global Diversified",
    description: "US, international equities, plus bonds.",
    risk: "Balanced",
    query: "VTI:50,VXUS:30,BND:20"
  }
];

export default function LandingPage() {
  return (
    <div className="space-y-10">
      <section className="subtle-grid overflow-hidden rounded-3xl border border-border bg-white/85 p-8 shadow-soft md:p-12">
        <p className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">Investest V1</p>
        <h1 className="mt-4 max-w-4xl text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
          Test portfolio decisions before you invest real capital.
        </h1>
        <p className="mt-4 max-w-2xl text-base text-muted-foreground md:text-lg">
          Build a portfolio, see how it would have behaved, and compare it to a real benchmark before you commit cash.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/workspace">
            <Button size="lg" className="gap-2">
              Start Building <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/workspace#analysis">
            <Button variant="secondary" size="lg">
              Open Dashboard
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

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Start from a template</h2>
          <p className="text-sm text-muted-foreground">Popular allocations you can edit in seconds.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {templates.map((template) => (
            <Card key={template.name} className="flex flex-col gap-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">{template.risk}</p>
              <h3 className="text-xl font-semibold">{template.name}</h3>
              <p className="flex-1 text-sm text-muted-foreground">{template.description}</p>
              <Link href={`/workspace?template=${encodeURIComponent(template.query)}`}>
                <Button variant="secondary" className="w-full">Use Template</Button>
              </Link>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
