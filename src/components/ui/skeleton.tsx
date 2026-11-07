import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** A quiet placeholder; the owning loading region supplies the accessible status. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} data-slot="skeleton" aria-hidden="true" className={cn("max-w-full rounded-control bg-surface-subtle", className)} />;
}
