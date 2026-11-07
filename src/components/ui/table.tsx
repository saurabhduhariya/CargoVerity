import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

type TableProps = ComponentProps<"table"> & {
  containerClassName?: string;
  containerLabel?: string;
};

export function Table({ className, containerClassName, containerLabel, ...props }: TableProps) {
  return (
    <div
      data-slot="table-container"
      className={cn("relative w-full overflow-x-auto", containerClassName)}
      role={containerLabel ? "region" : undefined}
      aria-label={containerLabel}
      tabIndex={containerLabel ? 0 : undefined}
    >
      <table {...props} data-slot="table" className={cn("w-full caption-bottom text-left text-sm text-foreground", className)} />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead {...props} data-slot="table-header" className={cn("bg-surface-subtle", className)} />;
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody {...props} data-slot="table-body" className={cn("[&_tr:last-child]:border-0", className)} />;
}

export function TableFooter({ className, ...props }: ComponentProps<"tfoot">) {
  return <tfoot {...props} data-slot="table-footer" className={cn("border-t border-border bg-surface-subtle font-medium", className)} />;
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      {...props}
      data-slot="table-row"
      className={cn(
        "border-b border-border transition-colors duration-[var(--motion-fast)] hover:bg-surface-subtle aria-selected:bg-selected data-[state=selected]:bg-selected motion-reduce:transition-none",
        className,
      )}
    />
  );
}

export function TableHead({ className, numeric = false, scope = "col", ...props }: ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      {...props}
      data-slot="table-head"
      scope={scope}
      className={cn(
        "h-[var(--table-header-height)] px-4 py-3 text-left align-middle text-xs font-semibold text-foreground-secondary",
        numeric && "text-right",
        className,
      )}
    />
  );
}

export function TableCell({ className, numeric = false, ...props }: ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      {...props}
      data-slot="table-cell"
      className={cn(
        "h-[var(--table-row-height)] px-4 py-3 align-middle",
        numeric && "text-right font-mono whitespace-nowrap tabular-nums",
        className,
      )}
    />
  );
}

export function TableCaption({ className, ...props }: ComponentProps<"caption">) {
  return <caption {...props} data-slot="table-caption" className={cn("mt-4 text-left text-xs text-muted-foreground", className)} />;
}
