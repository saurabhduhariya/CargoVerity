import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label {...props} data-slot="label" className={cn("text-sm font-medium text-foreground-secondary", className)} />;
}
