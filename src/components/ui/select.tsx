import type { ComponentProps } from "react";

import { CONTROL_STYLES, FOCUS_RING_STYLES } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";

/** Native selection semantics, including form values, keyboard input, and multiple selection. */
export function Select({ className, multiple, ...props }: ComponentProps<"select">) {
  return (
    <select
      {...props}
      data-slot="select"
      multiple={multiple}
      className={cn(
        CONTROL_STYLES,
        FOCUS_RING_STYLES,
        multiple ? "min-h-24 py-2" : "h-[var(--control-height)]",
        className,
      )}
    />
  );
}
