import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export type BadgeVariant = "default" | "outline" | "info" | "success" | "warning" | "error";

export type BadgeProps = ComponentProps<"span"> & {
  variant?: BadgeVariant;
};

const variantStyles = {
  default: "border-neutral-border bg-neutral-surface text-neutral",
  outline: "border-border-strong bg-transparent text-foreground-secondary",
  info: "border-info-border bg-info-surface text-info",
  success: "border-success-border bg-success-surface text-success",
  warning: "border-warning-border bg-warning-surface text-warning",
  error: "border-danger-border bg-danger-surface text-danger",
} satisfies Record<BadgeVariant, string>;

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      {...props}
      data-slot="badge"
      data-variant={variant}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-small border px-2 py-1 text-xs font-medium",
        variantStyles[variant],
        className,
      )}
    />
  );
}
