import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} data-slot="card" className={cn("min-w-0 rounded-panel border border-border bg-surface text-foreground", className)} />;
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} data-slot="card-header" className={cn("border-b border-border p-5", className)} />;
}

export function CardTitle({ className, as: Heading = "h2", ...props }: ComponentProps<"h2"> & { as?: "h2" | "h3" | "h4" }) {
  return <Heading {...props} data-slot="card-title" className={cn("text-lg font-semibold text-foreground", className)} />;
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p {...props} data-slot="card-description" className={cn("mt-1 text-sm text-muted-foreground", className)} />;
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} data-slot="card-content" className={cn("p-5", className)} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} data-slot="card-footer" className={cn("flex flex-wrap items-center gap-3 border-t border-border px-5 py-4", className)} />;
}
