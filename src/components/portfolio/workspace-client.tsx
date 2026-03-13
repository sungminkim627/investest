"use client";

import { BuildPortfolioClient } from "@/components/portfolio/build-portfolio-client";
import { DashboardClient } from "@/components/portfolio/dashboard-client";

export function WorkspaceClient() {
  return (
    <div className="space-y-6">
      <BuildPortfolioClient mode="workspace" />
      <DashboardClient />
    </div>
  );
}
