import { AlertCircle, CheckCircle2, Inbox, Info, LoaderCircle, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

type FeedbackKind = "loading" | "empty" | "error" | "success" | "info";

type FeedbackStateProps = Omit<ComponentProps<"section">, "title"> & {
  kind: FeedbackKind;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  headingLevel?: 2 | 3;
};

const icons = {
  loading: LoaderCircle,
  empty: Inbox,
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
} satisfies Record<FeedbackKind, LucideIcon>;

const iconStyles = {
  loading: "text-info motion-safe:animate-spin",
  empty: "text-muted-foreground",
  error: "text-danger",
  success: "text-success",
  info: "text-info",
} satisfies Record<FeedbackKind, string>;

export function FeedbackState({
  kind,
  title,
  description,
  action,
  headingLevel = 2,
  className,
  role,
  children,
  ...props
}: FeedbackStateProps) {
  const Icon = icons[kind];
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const announcementRole = role ?? (kind === "error" ? "alert" : kind === "loading" || kind === "success" ? "status" : undefined);

  return (
    <section
      {...props}
      data-slot="feedback-state"
      data-state={kind}
      role={announcementRole}
      className={cn("flex min-w-0 flex-col items-start gap-3 py-8", className)}
    >
      <Icon aria-hidden="true" className={cn("size-5 shrink-0", iconStyles[kind])} />
      <div className="max-w-[70ch] space-y-1">
        <Heading className="text-base font-semibold text-foreground">{title}</Heading>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
      {action ? <div className="flex flex-wrap items-center gap-3">{action}</div> : null}
    </section>
  );
}
