import { Suspense } from "react";
import { WorkspaceClient } from "@/components/portfolio/workspace-client";

export default function WorkspacePage() {
  return (
    <Suspense fallback={null}>
      <WorkspaceClient />
    </Suspense>
  );
}
