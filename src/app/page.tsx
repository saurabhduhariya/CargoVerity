import Link from "next/link";
import { ArrowRight, FileCheck2, FileText, GitCompareArrows, ListChecks, LockKeyhole, ShieldCheck, Upload } from "lucide-react";

import { FOCUS_RING_STYLES } from "@/components/ui/control-styles";
import { LandingNavigation } from "@/features/landing/landing-navigation";
import { LandingReviewPreview } from "@/features/landing/landing-review-preview";
import { cn } from "@/lib/utils";

const ctaStyles = "inline-flex min-h-11 max-w-full items-center justify-center gap-2 whitespace-normal rounded-control border px-5 py-3 text-center text-sm font-medium transition-colors duration-[var(--motion-fast)] sm:whitespace-nowrap motion-reduce:transition-none";

const workflow = [
  { icon: Upload, title: "Bring your documents together", description: "Upload an invoice, packing list and bill of lading into one shipment workspace." },
  { icon: GitCompareArrows, title: "Review against the source", description: "Inspect extracted fields, compare documents and resolve discrepancies with supporting evidence." },
  { icon: ShieldCheck, title: "Approve the current revision", description: "Submit for manager review. CSV export stays locked until the current revision is approved." },
];

export default function Home() {
  return (
    <div className="min-h-dvh bg-surface text-foreground">
      <a href="#main-content" className={cn("sr-only fixed left-4 top-4 z-50 rounded-control bg-surface px-4 py-3 text-sm font-medium focus:not-sr-only", FOCUS_RING_STYLES)}>Skip to content</a>
      <LandingNavigation />

      <main id="main-content" tabIndex={-1} className="outline-none">
        <section id="workbench" aria-labelledby="hero-title" className="mx-auto grid max-w-7xl gap-10 px-5 pb-14 pt-12 sm:px-8 sm:pb-16 sm:pt-16 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-12 lg:py-16">
          <div className="min-w-0">
            <p className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-primary"><FileCheck2 className="size-4" aria-hidden="true" />Human-controlled document review</p>
            <h1 id="hero-title" className="max-w-xl text-5xl font-semibold leading-[1.08] tracking-[-0.045em] [overflow-wrap:anywhere] sm:text-6xl xl:text-7xl">
              Every detail.{" "}<span className="block text-primary">Verified.</span>
            </h1>
            <p className="mt-6 max-w-md text-lg leading-8 text-foreground-secondary">
              Verify invoices, packing lists and bills of lading with source evidence, cross-checks and human approval.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/login" className={cn(ctaStyles, "border-transparent bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active", FOCUS_RING_STYLES)}>Open workbench <ArrowRight aria-hidden="true" className="size-4" /></Link>
              <a href="#workflow" className={cn(ctaStyles, "border-transparent text-foreground-secondary hover:bg-surface-subtle hover:text-foreground active:bg-neutral-surface", FOCUS_RING_STYLES)}>See how it works <ArrowRight className="size-4" aria-hidden="true" /></a>
            </div>
          </div>
          <LandingReviewPreview />
        </section>

        <div className="border-y border-border bg-background">
          <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:px-8">
            <p className="text-sm font-medium text-foreground-secondary">Three documents. One clear view.</p>
            <ul className="flex flex-wrap gap-x-7 gap-y-4 text-sm text-foreground-secondary">
              {["Commercial invoice", "Packing list", "Bill of lading"].map((label) => <li key={label} className="inline-flex items-center gap-2"><FileText className="size-4 text-muted-foreground" aria-hidden="true" />{label}</li>)}
            </ul>
          </div>
        </div>

        <section id="workflow" aria-labelledby="workflow-title" className="mx-auto max-w-7xl scroll-mt-8 px-5 py-16 sm:px-8 sm:py-24">
          <h2 id="workflow-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">From document to decision.</h2>
          <p className="mt-4 max-w-xl text-base leading-7 text-foreground-secondary">A focused review flow that keeps the source, the discrepancy and the next action connected.</p>
          <ol className="mt-10 grid gap-8 sm:mt-12 md:grid-cols-3 md:gap-10">
            {workflow.map(({ icon: Icon, title, description }, index) => (
              <li key={title} className="min-w-0">
                <div className="mb-5 flex items-center gap-4"><span className="flex size-11 shrink-0 items-center justify-center rounded-panel bg-selected text-primary"><Icon className="size-5" aria-hidden="true" /></span>{index < workflow.length - 1 ? <span className="hidden h-px flex-1 bg-border md:block" aria-hidden="true" /> : null}</div>
                <h3 className="text-lg font-semibold leading-7">{title}</h3>
                <p className="mt-3 max-w-sm text-sm leading-6 text-foreground-secondary">{description}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="human-control" aria-labelledby="control-title" className="scroll-mt-8 border-y border-border bg-background">
          <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[1fr_1fr] lg:gap-24">
            <div>
              <ShieldCheck className="mb-6 size-8 text-primary" aria-hidden="true" />
              <h2 id="control-title" className="max-w-md text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">AI assists.<br />People decide.</h2>
              <p className="mt-5 max-w-md text-base leading-7 text-foreground-secondary">Automation helps you find what needs attention. Reviewers own the corrections. Managers own the approval.</p>
            </div>
            <dl className="space-y-7 lg:pt-2">
              <div><dt className="flex items-start gap-4 text-base font-semibold"><FileCheck2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />Evidence, not assumptions</dt><dd className="ml-9 mt-2 text-sm leading-6 text-foreground-secondary">Inspect source quotes and page references where available. Uncertain fields keep their review reasons visible.</dd></div>
              <div><dt className="flex items-start gap-4 text-base font-semibold"><ListChecks className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />A traceable review history</dt><dd className="ml-9 mt-2 text-sm leading-6 text-foreground-secondary">Keep original results, corrections and human exception decisions distinct, with revision-aware audit history.</dd></div>
              <div><dt className="flex items-start gap-4 text-base font-semibold"><LockKeyhole className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />Approval before export</dt><dd className="ml-9 mt-2 text-sm leading-6 text-foreground-secondary">AI never approves or exports a shipment. Export requires manager approval of the current revision.</dd></div>
            </dl>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div><p className="font-semibold tracking-tight">CargoVerity</p><p className="mt-2 text-xs leading-5 text-muted-foreground">Synthetic-data demo. Not customs clearance or a filing service.</p></div>
        <Link href="/dashboard" className={cn("inline-flex min-h-11 w-fit items-center gap-2 rounded-control px-3 text-sm font-medium text-foreground-secondary hover:bg-surface-subtle hover:text-primary", FOCUS_RING_STYLES)}>View dashboard <ArrowRight className="size-4" aria-hidden="true" /></Link>
      </footer>
    </div>
  );
}
