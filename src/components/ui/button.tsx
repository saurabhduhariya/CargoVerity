import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";

import { FOCUS_RING_STYLES } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";

export type ButtonProps = ComponentProps<"button"> & {
  variant?: "default" | "outline" | "ghost" | "destructive" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  loading?: boolean;
};

const variantStyles = {
  default: "border-transparent bg-primary text-primary-foreground enabled:hover:bg-primary-hover enabled:active:bg-primary-active",
  outline: "border-control-border bg-surface text-foreground enabled:hover:bg-surface-subtle enabled:active:bg-neutral-surface",
  ghost: "border-transparent bg-transparent text-foreground-secondary enabled:hover:bg-surface-subtle enabled:active:bg-neutral-surface",
  destructive: "border-transparent bg-danger text-primary-foreground enabled:hover:bg-danger-hover enabled:active:bg-danger-active",
  link: "border-transparent bg-transparent text-primary underline-offset-4 enabled:hover:underline enabled:active:text-primary-active",
} satisfies Record<NonNullable<ButtonProps["variant"]>, string>;

const sizeStyles = {
  default: "h-[var(--control-height)] px-4",
  sm: "h-[var(--control-height-sm)] px-3",
  lg: "h-[var(--control-height-lg)] px-5",
  icon: "h-[var(--control-height)] w-[var(--control-height)] shrink-0 p-0",
} satisfies Record<NonNullable<ButtonProps["size"]>, string>;

export function Button({
  className,
  variant = "default",
  size = "default",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      disabled={disabled || loading}
      aria-busy={loading ? true : props["aria-busy"]}
      className={cn(
        "inline-flex min-h-min min-w-0 max-w-full items-center justify-center gap-2 rounded-control border text-sm font-medium whitespace-normal [overflow-wrap:anywhere] transition-colors duration-[var(--motion-fast)] ease-[var(--ease-state)] disabled:cursor-not-allowed disabled:border-border-strong disabled:bg-disabled disabled:text-disabled-foreground motion-reduce:transition-none",
        FOCUS_RING_STYLES,
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
    >
      {loading ? <LoaderCircle aria-hidden="true" className="size-4 shrink-0 motion-safe:animate-spin" /> : null}
      {children}
    </button>
  );
}
