import type { ComponentProps } from "react";

import { CONTROL_STYLES, FOCUS_RING_STYLES } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";

export function Textarea({ className, rows = 3, readOnly, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      {...props}
      data-slot="textarea"
      rows={rows}
      readOnly={readOnly}
      className={cn(
        CONTROL_STYLES,
        FOCUS_RING_STYLES,
        "min-h-24 resize-y py-2",
        readOnly && "bg-surface-subtle",
        className,
      )}
    />
  );
}
