import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type TypographyVariant = "page-title" | "section-title" | "body" | "label" | "caption" | "data";
type TypographyElement = "h1" | "h2" | "h3" | "h4" | "p" | "span";

type TypographyProps = HTMLAttributes<HTMLElement> & {
  as?: TypographyElement;
  variant?: TypographyVariant;
};

const defaultElements = {
  "page-title": "h1",
  "section-title": "h2",
  body: "p",
  label: "span",
  caption: "p",
  data: "span",
} satisfies Record<TypographyVariant, TypographyElement>;

const variantStyles = {
  "page-title": "text-2xl font-semibold tracking-heading text-foreground",
  "section-title": "text-lg font-semibold text-foreground",
  body: "text-sm text-foreground",
  label: "text-sm font-medium text-foreground-secondary",
  caption: "text-xs text-muted-foreground",
  data: "font-mono text-sm text-foreground tabular-nums",
} satisfies Record<TypographyVariant, string>;

export function Typography({ as, variant = "body", className, ...props }: TypographyProps) {
  const Element = as ?? defaultElements[variant];
  return <Element {...props} data-slot="typography" data-variant={variant} className={cn(variantStyles[variant], className)} />;
}
