import Link from "next/link";
import { ArrowRight, CheckCircle2, FileCheck2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12 sm:py-20">
      <section className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">CargoVerity</p>
          <Link href="/login" className="text-sm font-medium text-slate-600 hover:text-blue-700">Sign in</Link>
        </div>
        <div className="grid gap-12 py-16 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
              Every document. Every detail. Verified.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              A human-controlled customs document workbench for invoices, packing lists and bills of lading.
              Extract evidence, resolve discrepancies and export only after approval.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login"><Button size="lg">Open workbench <ArrowRight className="size-4" /></Button></Link>
              <Link href="/dashboard"><Button size="lg" variant="outline">View dashboard</Button></Link>
            </div>
          </div>
          <Card className="overflow-hidden">
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center gap-3 rounded-xl bg-blue-50 p-4">
                <FileCheck2 className="size-5 text-blue-700" />
                <div><p className="font-semibold text-slate-950">Evidence-first extraction</p><p className="text-sm text-slate-600">Every value keeps a quote and page reference.</p></div>
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-emerald-50 p-4">
                <CheckCircle2 className="size-5 text-emerald-700" />
                <div><p className="font-semibold text-slate-950">Deterministic cross-checks</p><p className="text-sm text-slate-600">Arithmetic and document comparisons stay reviewable.</p></div>
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-amber-50 p-4">
                <ShieldCheck className="size-5 text-amber-700" />
                <div><p className="font-semibold text-slate-950">Approval before export</p><p className="text-sm text-slate-600">AI never approves or exports a shipment.</p></div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
