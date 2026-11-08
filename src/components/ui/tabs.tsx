"use client";

import {
  createContext,
  useContext,
  useId,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from "react";

import { FOCUS_RING_STYLES } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";

type TabsContextValue = {
  value: string;
  select: (value: string) => void;
  baseId: string;
  orientation: "horizontal" | "vertical";
  activationMode: "automatic" | "manual";
  loop: boolean;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs() {
  const context = useContext(TabsContext);
  if (!context) throw new Error("Tabs components must be rendered inside Tabs.");
  return context;
}

type TabsProps = Omit<ComponentProps<"div">, "defaultValue"> & {
  orientation?: "horizontal" | "vertical";
  activationMode?: "automatic" | "manual";
  loop?: boolean;
} & (
  | { value: string; onValueChange: (value: string) => void; defaultValue?: never }
  | { defaultValue: string; value?: never; onValueChange?: (value: string) => void }
);

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  orientation = "horizontal",
  activationMode = "automatic",
  loop = true,
  className,
  children,
  ...props
}: TabsProps) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? value ?? "");
  const baseId = useId();
  const selectedValue = value ?? internalValue;

  function select(nextValue: string) {
    if (nextValue === selectedValue) return;
    if (value === undefined) setInternalValue(nextValue);
    onValueChange?.(nextValue);
  }

  return (
    <TabsContext.Provider value={{ value: selectedValue, select, baseId, orientation, activationMode, loop }}>
      <div {...props} data-slot="tabs" data-orientation={orientation} className={cn("min-w-0", className)}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, ...props }: Omit<ComponentProps<"div">, "role" | "aria-orientation">) {
  const { orientation } = useTabs();

  return (
    <div
      {...props}
      data-slot="tabs-list"
      role="tablist"
      aria-orientation={orientation}
      className={cn(
        "flex gap-1 border-b border-border px-1",
        orientation === "vertical" ? "flex-col items-stretch" : "items-center overflow-x-auto",
        className,
      )}
    />
  );
}

type TabsTriggerProps = Omit<ComponentProps<"button">, "id" | "role" | "tabIndex" | "aria-controls" | "aria-selected"> & {
  value: string;
};

export function TabsTrigger({ value, className, disabled, onClick, onKeyDown, ...props }: TabsTriggerProps) {
  const context = useTabs();
  const active = value === context.value;
  const valueId = encodeURIComponent(value);

  function navigate(event: KeyboardEvent<HTMLButtonElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled || event.altKey || event.ctrlKey || event.metaKey) return;

    const list = event.currentTarget.closest('[role="tablist"]');
    if (!list) return;

    const vertical = context.orientation === "vertical";
    const rtl = !vertical && getComputedStyle(list).direction === "rtl";
    const previousKey = vertical ? "ArrowUp" : rtl ? "ArrowRight" : "ArrowLeft";
    const nextKey = vertical ? "ArrowDown" : rtl ? "ArrowLeft" : "ArrowRight";
    if (![previousKey, nextKey, "Home", "End"].includes(event.key)) return;

    event.preventDefault();
    const triggers = Array.from(list.querySelectorAll<HTMLButtonElement>('[data-slot="tabs-trigger"]:not(:disabled)'));
    const currentIndex = triggers.indexOf(event.currentTarget);
    if (currentIndex < 0) return;

    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = triggers.length - 1;
    else nextIndex += event.key === nextKey ? 1 : -1;

    nextIndex = context.loop
      ? (nextIndex + triggers.length) % triggers.length
      : Math.max(0, Math.min(triggers.length - 1, nextIndex));

    const nextTrigger = triggers[nextIndex];
    nextTrigger.focus();
    if (context.activationMode === "automatic" && nextTrigger.dataset.value !== undefined) {
      context.select(nextTrigger.dataset.value);
    }
  }

  return (
    <button
      {...props}
      data-slot="tabs-trigger"
      data-value={value}
      data-state={active ? "active" : "inactive"}
      id={`${context.baseId}-tab-${valueId}`}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`${context.baseId}-panel-${valueId}`}
      tabIndex={active ? 0 : -1}
      disabled={disabled}
      onKeyDown={navigate}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && !disabled) context.select(value);
      }}
      className={cn(
        "-mb-px inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-none border-b-2 border-transparent px-3 text-sm font-medium text-foreground-secondary transition-colors duration-[var(--motion-fast)] enabled:hover:text-foreground data-[state=active]:border-foreground data-[state=active]:text-foreground disabled:cursor-not-allowed disabled:text-disabled-foreground motion-reduce:transition-none",
        FOCUS_RING_STYLES,
        className,
      )}
    />
  );
}

type TabsContentProps = Omit<ComponentProps<"div">, "id" | "role" | "aria-labelledby" | "hidden"> & {
  value: string;
};

/** Keep panels mounted so switching tabs does not discard local form drafts. */
export function TabsContent({ value, className, tabIndex = 0, ...props }: TabsContentProps) {
  const { value: selectedValue, baseId } = useTabs();
  const active = value === selectedValue;
  const valueId = encodeURIComponent(value);

  return (
    <div
      {...props}
      data-slot="tabs-content"
      data-state={active ? "active" : "inactive"}
      id={`${baseId}-panel-${valueId}`}
      role="tabpanel"
      aria-labelledby={`${baseId}-tab-${valueId}`}
      hidden={!active}
      tabIndex={tabIndex}
      className={cn("min-w-0 pt-4 data-[state=inactive]:hidden", FOCUS_RING_STYLES, className)}
    />
  );
}
