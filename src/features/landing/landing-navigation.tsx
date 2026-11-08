"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useRef, useState } from "react";

import { FOCUS_RING_STYLES } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";

const links = [
  { href: "#workbench", label: "Workbench" },
  { href: "#workflow", label: "Workflow" },
  { href: "#human-control", label: "Human control" },
];
const linkStyles = cn("inline-flex min-h-11 items-center rounded-control px-3 text-sm font-medium text-foreground-secondary transition-colors duration-[var(--motion-fast)] hover:bg-surface-subtle hover:text-foreground motion-reduce:transition-none", FOCUS_RING_STYLES);

export function LandingNavigation() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);

  return (
    <header className="border-b border-border bg-surface">
      <nav aria-label="Main navigation" className="mx-auto max-w-7xl px-5 sm:px-8" onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          toggle.current?.focus();
        }
      }}>
        <div className="flex min-h-18 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 md:h-18 md:flex-nowrap md:py-0">
          <Link href="/" aria-label="CargoVerity home" className={cn("inline-flex min-h-11 shrink-0 items-center rounded-control text-lg font-semibold tracking-tight", FOCUS_RING_STYLES)}>Cargo<span className="text-primary">Verity</span></Link>
          <div className="hidden items-center gap-1 md:flex">{links.map(({ href, label }) => <a key={href} href={href} className={linkStyles}>{label}</a>)}</div>
          <div className="flex items-center gap-2">
            <Link href="/login" className={cn("inline-flex min-h-11 items-center justify-center rounded-control border border-control-border px-4 text-sm font-medium hover:bg-surface-subtle active:bg-neutral-surface", FOCUS_RING_STYLES)}>Sign in</Link>
            <button ref={toggle} type="button" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="mobile-navigation" className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-control hover:bg-surface-subtle md:hidden", FOCUS_RING_STYLES)} onClick={() => setOpen(!open)}>{open ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}</button>
          </div>
        </div>
        <div id="mobile-navigation" hidden={!open} className="border-t border-border py-3 md:hidden">
          {links.map(({ href, label }) => <a key={href} href={href} className={cn(linkStyles, "flex")} onClick={() => setOpen(false)}>{label}</a>)}
        </div>
      </nav>
    </header>
  );
}
