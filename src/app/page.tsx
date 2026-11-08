import Link from "next/link";
import { ArrowRight, CheckCircle2, FileCheck2, ShieldCheck } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { FOCUS_RING_STYLES } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";

const ctaStyles = "inline-flex min-h-11 items-center justify-center gap-2 rounded-control border px-5 py-2 text-sm font-medium";

export default function Home() {
  return (
    <main className="min-h-dvh bg-background px-6 py-12 text-foreground sm:py-20">
      <section className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">CargoVerity</p>
          <Link href="/login" className={cn("inline-flex min-h-11 items-center rounded-control px-2 text-sm font-medium text-foreground-secondary hover:text-primary", FOCUS_RING_STYLES)}>Sign in</Link>
        </div>
        <div className="grid gap-12 py-16 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
              Every document. Every detail. Verified.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-foreground-secondary">
              A human-controlled customs document workbench for invoices, packing lists and bills of lading.
              Extract evidence, resolve discrepancies and export only after approval.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className={cn(ctaStyles, "border-transparent bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active", FOCUS_RING_STYLES)}>Open workbench <ArrowRight aria-hidden="true" className="size-4" /></Link>
              <Link href="/dashboard" className={cn(ctaStyles, "border-control-border bg-surface hover:bg-surface-subtle active:bg-neutral-surface", FOCUS_RING_STYLES)}>View dashboard</Link>
            </div>
          </div>
          <Card className="overflow-hidden">
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center gap-3 rounded-panel bg-info-surface p-4">
                <FileCheck2 aria-hidden="true" className="size-5 shrink-0 text-info" />
                <div><p className="font-semibold">Evidence-first extraction</p><p className="text-sm text-foreground-secondary">Inspect source quotes and page references where available.</p></div>
              </div>
              <div className="flex items-center gap-3 rounded-panel bg-success-surface p-4">
                <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-success" />
                <div><p className="font-semibold">Deterministic cross-checks</p><p className="text-sm text-foreground-secondary">Arithmetic and document comparisons stay reviewable.</p></div>
              </div>
              <div className="flex items-center gap-3 rounded-panel bg-warning-surface p-4">
                <ShieldCheck aria-hidden="true" className="size-5 shrink-0 text-warning" />
                <div><p className="font-semibold">Approval before export</p><p className="text-sm text-foreground-secondary">AI never approves or exports a shipment.</p></div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
