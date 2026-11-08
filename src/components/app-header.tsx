"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, LogOut } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { FOCUS_RING_STYLES } from "@/components/ui/control-styles";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

export function AppHeader({ active, email, role }: { active: "shipments" | "reports"; email: string; role: "EXECUTIVE" | "MANAGER" }) {
  const router = useRouter();
  const account = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roleLabel = role === "MANAGER" ? "Manager" : "Executive";

  async function signOut() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await getSupabaseBrowserClient().auth.signOut();
      if (result.error) throw result.error;
      router.push("/"); router.refresh();
    } catch { setError("Could not sign out. Try again."); setBusy(false); }
  }

  return <>
    <a href="#main-content" className={cn("sr-only fixed left-4 top-4 z-50 rounded-control bg-surface px-4 py-3 focus:not-sr-only", FOCUS_RING_STYLES)}>Skip to content</a>
    <header className="relative z-20 shrink-0 border-b border-border bg-surface">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-8 px-4 sm:px-6 lg:px-8">
        <Link href="/dashboard" aria-label="CargoVerity shipments" className={cn("inline-flex min-h-14 items-center rounded-control", FOCUS_RING_STYLES)}><Brand /></Link>
        <nav aria-label="Application" className="order-3 -mx-1 flex w-full gap-5 sm:order-none sm:mx-0 sm:w-auto">
          {([{ key: "shipments", href: "/dashboard", label: "Shipments" }, { key: "reports", href: "/reports", label: "Accuracy" }] as const).map((item) => <Link key={item.key} href={item.href} aria-current={active === item.key ? "page" : undefined} className={cn("inline-flex min-h-11 items-center border-b-2 px-1 text-sm font-medium transition-colors duration-[var(--motion-fast)] sm:min-h-14", active === item.key ? "border-foreground text-foreground" : "border-transparent text-foreground-secondary hover:text-foreground", FOCUS_RING_STYLES)}>{item.label}</Link>)}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <details ref={account} className="group relative" onKeyDown={(event) => { if (event.key === "Escape" && account.current) { account.current.open = false; account.current.querySelector("summary")?.focus(); } }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}>
            <summary aria-label={`Account: ${roleLabel}`} className={cn("flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-control px-1 text-sm text-foreground [&::-webkit-details-marker]:hidden", FOCUS_RING_STYLES)}>
              <span aria-hidden="true" className="inline-flex size-7 items-center justify-center rounded-full bg-surface-subtle text-xs font-semibold uppercase text-foreground-secondary">{email.slice(0, 1)}</span>
              <span data-testid="current-role" className="font-medium">{roleLabel}</span>
              <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground group-open:rotate-180" />
            </summary>
            <div className="absolute right-0 top-full z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-panel border border-border bg-surface p-2 shadow-overlay">
              <p className="break-all px-2 pb-2 pt-1 text-sm text-foreground-secondary">{email}</p>
              <Button type="button" variant="ghost" className="w-full justify-start border-t border-border" loading={busy} onClick={() => void signOut()}><LogOut aria-hidden="true" className="size-4" />Sign out</Button>
              {error ? <p role="alert" className="px-2 pt-2 text-sm text-danger">{error}</p> : null}
            </div>
          </details>
        </div>
      </div>
    </header>
  </>;
}
