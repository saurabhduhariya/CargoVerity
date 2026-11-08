import Link from "next/link";

import { FOCUS_RING_STYLES } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { Brand } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12 text-foreground">
      <section className="w-full max-w-lg space-y-5">
        <Brand />
        <h1 className="text-3xl font-semibold tracking-heading">Page not found</h1>
        <p className="text-sm leading-6 text-foreground-secondary">Check the address or return to your shipments.</p>
        <nav aria-label="Page recovery" className="flex flex-wrap gap-3">
          <Link href="/dashboard" className={cn("inline-flex min-h-11 items-center justify-center rounded-control border border-transparent bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover active:bg-primary-active", FOCUS_RING_STYLES)}>Go to shipments</Link>
          <Link href="/" className={cn("inline-flex min-h-11 items-center justify-center rounded-control border border-border-strong bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-subtle", FOCUS_RING_STYLES)}>Return home</Link>
        </nav>
      </section>
    </main>
  );
}
