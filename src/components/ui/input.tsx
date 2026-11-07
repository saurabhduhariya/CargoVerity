import type { ComponentProps } from "react";

import { CONTROL_STYLES, FOCUS_RING_STYLES } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";

export function Input({ className, readOnly, ...props }: ComponentProps<"input">) {
  return (
    <input
      {...props}
      data-slot="input"
      readOnly={readOnly}
      className={cn(
        CONTROL_STYLES,
        FOCUS_RING_STYLES,
        "h-[var(--control-height)] file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        readOnly && "bg-surface-subtle",
        className,
      )}
    />
  );
}
