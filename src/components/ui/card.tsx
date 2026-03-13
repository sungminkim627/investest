import * as React from "react";
import { cn } from "@/lib/utils/cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card/95 p-5 shadow-soft backdrop-blur supports-[backdrop-filter]:bg-white/80",
        className
      )}
      {...props}
    />
  );
}
