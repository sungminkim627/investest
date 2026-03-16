import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { AuthNavButton } from "@/components/layout/auth-nav-button";
import "./globals.css";

export const metadata: Metadata = {
  title: "Investest",
  description: "Portfolio intelligence with cached market data"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <header className="sticky top-0 z-40 border-b border-border/70 bg-white/85 backdrop-blur">
          <div className="container-page flex h-16 items-center justify-between">
            <Link href="/" className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <BarChart3 className="h-4 w-4" />
              </span>
              <span>Investest</span>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                Beta
              </span>
            </Link>
            <nav className="flex items-center gap-6 text-sm text-muted-foreground">
              <Link href="/workspace" className="hover:text-foreground">
                Workspace
              </Link>
              <Link href="/saved-portfolios" className="hover:text-foreground">
                Saved
              </Link>
              <AuthNavButton />
            </nav>
          </div>
        </header>
        <main className="container-page py-10">{children}</main>
        <footer className="mt-12 border-t border-border/70 bg-white/70">
          <div className="container-page py-8 text-xs text-muted-foreground">
            Investest - Not financial advice. Historical performance does not guarantee future results.
          </div>
        </footer>
      </body>
    </html>
  );
}
