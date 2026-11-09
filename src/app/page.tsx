import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { FOCUS_RING_STYLES } from "@/components/ui/control-styles";
import { LandingNavigation } from "@/features/landing/landing-navigation";
import { LandingReviewPreview } from "@/features/landing/landing-review-preview";
import { cn } from "@/lib/utils";

const ctaStyles = "inline-flex min-h-11 max-w-full items-center justify-center gap-2 whitespace-normal rounded-control border px-5 py-3 text-center text-sm font-medium transition-colors duration-[var(--motion-fast)] sm:whitespace-nowrap motion-reduce:transition-none";

const extracted = ["Parties", "Invoice number and date", "Currency", "Incoterm", "Line items with HSN", "Packages", "Weights", "Containers"];

const steps = [
  { title: "Upload", screen: "Shipment", description: "Drop the invoice, packing list and bill of lading into one shipment. Scans and photos are accepted." },
  { title: "Review", screen: "Review", description: "The document sits beside its fields. Uncertain values are marked amber. Confirm with Enter, correct with a reason." },
  { title: "Approve and export", screen: "Export", description: "The manager approves the checked revision. The CSV follows your filing software's import layout." },
];

const ledger = [
  { label: "Data entry", working: "1,100 shipments × 45 min × 12 months", result: "9,900 h", amount: "₹34.65 lakh" },
  { label: "Amended Bills of Entry", working: "13,200 shipments × 3% × ₹9,000", result: "396 cases", amount: "₹35.64 lakh" },
];

const guards = [
  { title: "Uncertain fields need a person", description: "Low-confidence values and fields in a failed check must be confirmed or corrected. Open source pages and quotes where available." },
  { title: "Mismatches stay on record", description: "Totals, packages and weights are compared across all three documents. An accepted difference needs evidence and manager sign-off." },
  { title: "Unreadable pages go to manual entry", description: "Skewed or bilingual scans the model cannot read are marked for manual entry, never guessed." },
  { title: "Every correction is counted", description: "Original values, edits and decisions stay in history, with accuracy reported by field and by supplier." },
];

export default function Home() {
  return (
    <div className="min-h-dvh bg-surface text-foreground">
      <a href="#main-content" className={cn("sr-only fixed left-4 top-4 z-50 rounded-control bg-surface px-4 py-3 text-sm font-medium focus:not-sr-only", FOCUS_RING_STYLES)}>Skip to content</a>
      <LandingNavigation />

      <main id="main-content" tabIndex={-1} className="outline-none">
        <section id="workbench" aria-labelledby="hero-title" className="mx-auto grid max-w-7xl gap-12 px-5 pb-16 pt-12 sm:px-8 sm:pt-16 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:gap-16 lg:pb-24 lg:pt-20">
          <div className="min-w-0">
            <h1 id="hero-title" className="max-w-xl text-[2.75rem] font-semibold leading-[1.04] tracking-[-0.03em] text-balance [overflow-wrap:anywhere] sm:text-6xl">
              Stop retyping what the PDF already says.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-8 text-foreground-secondary">
              Drop in a shipment&rsquo;s documents. CargoVerity extracts the fields, marks the ones it is unsure of, and checks totals, packages and weights across all three before anything reaches your filing software.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/login" className={cn(ctaStyles, "border-transparent bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active", FOCUS_RING_STYLES)}>Open workbench <ArrowRight aria-hidden="true" className="size-4" /></Link>
              <a href="#workflow" className={cn(ctaStyles, "border-transparent text-foreground-secondary hover:bg-surface-subtle hover:text-foreground active:bg-neutral-surface", FOCUS_RING_STYLES)}>See how it works</a>
            </div>
          </div>
          <LandingReviewPreview />
        </section>

        <div className="border-y border-border bg-background">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-5 sm:px-8 lg:flex-row lg:items-baseline lg:gap-10">
            <p className="shrink-0 text-sm font-medium">Extracted with a confidence score</p>
            <ul aria-label="Extracted fields" className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-foreground-secondary">
              {extracted.map((label) => <li key={label}>{label}</li>)}
            </ul>
          </div>
        </div>

        <section id="workflow" aria-labelledby="workflow-title" className="mx-auto max-w-7xl scroll-mt-8 px-5 py-20 sm:px-8 sm:py-28">
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
            <h2 id="workflow-title" className="max-w-md text-3xl font-semibold leading-tight tracking-[-0.02em] sm:text-4xl">Three documents in. One checked file out.</h2>
            <p className="max-w-lg text-base leading-7 text-foreground-secondary lg:justify-self-end">Your filing software stays as it is. CargoVerity replaces the Excel checklist and the WhatsApp doubts in between.</p>
          </div>
          <ol className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
            {steps.map(({ title, screen, description }) => (
              <li key={title} className="min-w-0 border-t border-foreground pt-5">
                <div className="flex items-baseline justify-between gap-3"><h3 className="text-lg font-semibold">{title}</h3><span className="font-mono text-xs text-muted-foreground">{screen}</span></div>
                <p className="mt-3 max-w-sm text-sm leading-6 text-foreground-secondary">{description}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="cost" aria-labelledby="cost-title" className="scroll-mt-8 border-y border-border bg-background">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
            <div>
              <h2 id="cost-title" className="max-w-sm text-3xl font-semibold leading-tight tracking-[-0.02em] sm:text-4xl">What retyping costs a year</h2>
              <p className="mt-5 max-w-sm text-base leading-7 text-foreground-secondary">Company A&rsquo;s own figures for its 14-person documentation team at Nhava Sheva, at ₹350 per staff hour.</p>
            </div>
            <div className="min-w-0">
              <table className="w-full text-left text-sm [overflow-wrap:anywhere]">
                <caption className="sr-only">Annual cost of manual document entry</caption>
                <thead><tr className="border-b border-foreground text-xs text-muted-foreground"><th scope="col" className="pb-3 font-medium">Cost</th><th scope="col" className="hidden pb-3 font-medium sm:table-cell">Working</th><th scope="col" className="pb-3 text-right font-medium">Per year</th></tr></thead>
                <tbody>
                  {ledger.map((row) => <tr key={row.label} className="border-b border-border align-baseline">
                    <th scope="row" className="py-4 pr-4 font-medium">{row.label}<span className="mt-1 block font-mono text-xs font-normal text-muted-foreground sm:hidden">{row.working}</span></th>
                    <td className="hidden py-4 pr-4 font-mono text-xs text-foreground-secondary sm:table-cell">{row.working} <span className="text-muted-foreground">= {row.result}</span></td>
                    <td className="sm:whitespace-nowrap py-4 text-right font-mono tabular-nums">{row.amount}</td>
                  </tr>)}
                </tbody>
                <tfoot><tr><th scope="row" className="pt-5 text-base font-semibold">Total</th><td className="hidden sm:table-cell" /><td className="sm:whitespace-nowrap pt-5 text-right font-mono text-2xl font-semibold tabular-nums">₹70.29 lakh</td></tr></tfoot>
              </table>
              <dl className="mt-12 grid gap-6 sm:grid-cols-3">
                {[["Entry time per shipment", "45 → under 15 min"], ["Field accuracy, 200 past shipments", "95%"], ["Amended Bills of Entry", "Halved in 3 months"]].map(([label, value]) => <div key={label} className="border-l border-border-strong pl-4"><dt className="text-xs text-muted-foreground">Target · {label}</dt><dd className="mt-2 text-base font-semibold">{value}</dd></div>)}
              </dl>
            </div>
          </div>
        </section>

        <section id="human-control" aria-labelledby="control-title" className="mx-auto max-w-7xl scroll-mt-8 px-5 py-20 sm:px-8 sm:py-28">
          <h2 id="control-title" className="max-w-2xl text-3xl font-semibold leading-tight tracking-[-0.02em] sm:text-4xl">Nothing exports until a person has cleared it.</h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-foreground-secondary">AI never approves or exports a shipment. Executives confirm the data, the documentation manager approves it.</p>
          <dl className="mt-14 grid gap-x-12 gap-y-10 sm:grid-cols-2">
            {guards.map(({ title, description }) => <div key={title} className="min-w-0"><dt className="text-base font-semibold">{title}</dt><dd className="mt-2 max-w-md text-sm leading-6 text-foreground-secondary">{description}</dd></div>)}
          </dl>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p className="text-xs leading-5 text-muted-foreground"><span className="font-semibold text-foreground">CargoVerity</span> · Document verification for freight forwarders and customs brokers.</p>
          <Link href="/dashboard" className={cn("inline-flex min-h-11 w-fit items-center gap-2 rounded-control px-3 text-sm font-medium text-foreground-secondary hover:bg-surface-subtle hover:text-foreground", FOCUS_RING_STYLES)}>Go to shipments <ArrowRight className="size-4" aria-hidden="true" /></Link>
        </div>
      </footer>
    </div>
  );
}
