"use client";

import { ArrowRight, Check, CheckCheck, RotateCcw, ScanLine, TriangleAlert } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const documents = [
  { id: "invoice", label: "Invoice", title: "Commercial invoice", reference: "INV-24811", detail: "Invoice total", detailValue: "USD 16,320", weight: "3,120" },
  { id: "packing", label: "Packing list", title: "Packing list", reference: "PKL-24811", detail: "Quantity", detailValue: "2,400 LED panels", weight: "3,165" },
  { id: "lading", label: "Bill of lading", title: "Bill of lading", reference: "BOL-24811", detail: "Port of discharge", detailValue: "Nhava Sheva", weight: "3,165" },
] as const;

const weightByDocument = [["INV", "3,120"], ["PKL", "3,165"], ["BOL", "3,165"]] as const;

// Authored sample excerpts with a deliberately wrong extraction; never a real shipment.
// All interactions stay in React state: no controller, API, storage or signed URLs.
export function LandingReviewPreview() {
  const [selected, setSelected] = useState("invoice");
  const [inspected, setInspected] = useState(false);
  const [corrected, setCorrected] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const invoiceTab = useRef<HTMLButtonElement>(null);
  const baseId = useId();
  // 1 = extracted, 2 = compared with the source, 3 = corrected
  const step = corrected ? 3 : inspected ? 2 : 1;

  function inspectInvoice() {
    setSelected("invoice");
    setInspected(true);
    invoiceTab.current?.focus();
    setAnnouncement(corrected
      ? "Corrected invoice shown. Current weight is 3,120 kg; original sample extraction was 3,210 kg. No shipment was changed."
      : "Invoice source highlighted. Page 1 reads 3,120 kg; the sample extraction reads 3,210 kg.");
  }

  function reset() {
    setSelected("invoice");
    setInspected(false);
    setCorrected(false);
    setAnnouncement("Example reset. No shipment was changed.");
  }

  return (
    <section aria-label="Interactive review example" className="min-w-0 overflow-hidden rounded-dialog border border-border-strong bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-5 pb-3 pt-5">
        <div className="min-w-0">
          <h2 className="font-mono text-sm font-medium">SHP-24811</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Company B (China) · LED panel light 40W</p>
        </div>
        <span className="text-xs text-muted-foreground">Interactive example</span>
      </div>

      <Tabs value={selected} onValueChange={setSelected} className="min-w-0">
        <TabsList aria-label="Sample documents" className="mx-2 grid h-auto grid-cols-3 items-stretch gap-0 rounded-none border-b border-border bg-transparent p-0 sm:mx-5 sm:gap-1">
          {documents.map((doc) => (
            <TabsTrigger key={doc.id} ref={doc.id === "invoice" ? invoiceTab : undefined} value={doc.id} className="h-auto min-h-11 min-w-0 shrink whitespace-normal rounded-none border-b-2 border-transparent px-0 py-3 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent sm:px-1 sm:text-sm">
              <span className="min-w-0 [overflow-wrap:anywhere]">{doc.label}</span>
              {doc.id === "invoice" ? <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full transition-colors duration-[var(--motion-normal)] motion-reduce:transition-none", corrected ? "bg-success" : "bg-warning-strong")} /> : null}
            </TabsTrigger>
          ))}
        </TabsList>

        {documents.map((doc) => {
          const isInvoice = doc.id === "invoice";
          const needsReview = isInvoice && !corrected;
          const showEvidence = isInvoice && inspected;
          const evidenceId = `${baseId}-evidence-${doc.id}`;
          const reasonId = `${baseId}-reason-${doc.id}`;

          return (
            <TabsContent key={doc.id} value={doc.id} className="pt-0">
              <div className="grid min-w-0 sm:grid-cols-[1fr_1.05fr]">
                <figure aria-label={`${doc.label} synthetic source, page 1`} className="min-w-0 bg-viewer-background px-5 pb-4 pt-5 sm:px-6">
                  <div className="mx-auto max-w-64 rounded-small bg-surface px-4 pb-4 pt-5 shadow-[0_1px_2px_rgb(21_23_28/10%),0_10px_24px_-8px_rgb(21_23_28/18%)]">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-xs font-medium text-foreground-secondary">Sample excerpt</p>
                      <p className="break-all font-mono text-[11px] text-muted-foreground">{doc.reference}</p>
                    </div>
                    <h3 className="mt-3 text-base font-semibold leading-6">{doc.title}</h3>
                    <div aria-hidden="true" className="mt-3 space-y-1.5">
                      <div className="h-1 w-full rounded-full bg-border" />
                      <div className="h-1 w-4/5 rounded-full bg-border" />
                      <div className="h-1 w-3/5 rounded-full bg-border" />
                    </div>
                    <dl className="mt-5">
                      <div className="border-t border-border pt-3">
                        <dt className="text-xs text-foreground-secondary">{doc.detail}</dt>
                        <dd className="mt-1 text-sm font-medium">{doc.detailValue}</dd>
                      </div>
                      <div id={evidenceId} className="relative isolate -mx-2 mt-4 rounded-small px-2 py-2">
                        <span aria-hidden="true" className={cn("absolute inset-0 -z-10 origin-left rounded-small bg-warning-surface ring-1 ring-warning-strong transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none", showEvidence ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0")} />
                        <dt className={cn("text-xs transition-colors duration-[var(--motion-normal)] motion-reduce:transition-none", showEvidence ? "text-warning" : "text-foreground-secondary")}>Gross weight</dt>
                        <dd className="mt-1 flex flex-wrap items-baseline gap-x-2 font-mono text-2xl font-medium tabular-nums">{doc.weight} <span className="text-sm text-foreground-secondary">kg</span></dd>
                      </div>
                    </dl>
                  </div>
                  <figcaption className="mt-3 text-center text-xs text-foreground-secondary">Illustrative source · page 1</figcaption>
                </figure>

                <div className="flex min-w-0 flex-col justify-center px-5 py-6 sm:px-6 sm:py-8">
                  {isInvoice ? <div aria-hidden="true" className="mb-5 flex gap-1.5">
                    {[1, 2, 3].map((segment) => <span key={segment} className={cn("h-1 flex-1 rounded-full transition-colors duration-[var(--motion-normal)] motion-reduce:transition-none", step >= segment ? (corrected ? "bg-success" : segment === 1 && step === 1 ? "bg-warning-strong" : "bg-foreground") : "bg-border")} />)}
                  </div> : null}
                  <dl>
                    <dt className="text-sm font-medium text-foreground-secondary">Extracted gross weight</dt>
                    <dd className={cn("mt-2 flex flex-wrap items-baseline gap-x-2 rounded-control border px-3 py-2.5 font-mono text-3xl font-medium tabular-nums transition-colors duration-[var(--motion-normal)] motion-reduce:transition-none", needsReview ? "border-warning-strong bg-warning-surface" : "border-border-strong bg-surface-subtle")}>
                      <span>{needsReview ? "3,210" : doc.weight}</span><span className="text-base text-foreground-secondary">kg</span>
                    </dd>
                  </dl>
                  <p data-uncertain={needsReview} className={cn("mt-3 flex items-center gap-2 text-sm font-medium", needsReview ? "text-warning" : "text-success")}>
                    {needsReview ? <TriangleAlert className="size-4 shrink-0" aria-hidden="true" /> : <CheckCheck className="size-4 shrink-0" aria-hidden="true" />}
                    {needsReview ? "Needs review" : isInvoice ? "Corrected by you" : "Matches source"}
                  </p>
                  <p id={reasonId} className="mt-3 text-sm leading-6 text-foreground-secondary">
                    {needsReview
                      ? inspected ? "Source: 3,120 kg. Two digits were transposed." : "Check this weight against the invoice."
                      : isInvoice ? "Original: 3,210 kg. The packing list still differs by 45 kg."
                        : "This document reads 3,165 kg. The invoice source reads 3,120 kg."}
                  </p>

                  {needsReview ? (
                    <Button type="button" aria-describedby={reasonId} aria-controls={evidenceId} className="mt-5 h-auto min-h-11 w-full px-3 py-3" onClick={inspected ? () => {
                      setCorrected(true);
                      setAnnouncement("Weight corrected to 3,120 kg in this example only. Original extraction: 3,210 kg. No shipment was changed.");
                    } : () => {
                      setInspected(true);
                      setAnnouncement("Source highlighted. Gross weight is 3,120 kg on page 1, not the extracted 3,210 kg.");
                    }}>
                      {inspected ? <Check className="size-4 shrink-0" aria-hidden="true" /> : <ScanLine className="size-4 shrink-0" aria-hidden="true" />}
                      {inspected ? "Use source value" : "Compare with source"}
                    </Button>
                  ) : (
                    <Button type="button" variant="ghost" className="mt-5 h-auto min-h-11 w-full px-3 py-3" onClick={isInvoice ? reset : inspectInvoice}>
                      {isInvoice ? "Try again" : corrected ? "View corrected invoice" : "Compare with invoice"}<ArrowRight className="size-4 shrink-0" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>
            </TabsContent>
          );
        })}
      </Tabs>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-warning-border bg-warning-surface px-5 py-3 text-sm text-warning">
        <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
        <span className="font-medium">Cross-document difference</span>
        <ul aria-label="Gross weight by document, kg" className="order-last flex w-full gap-1.5 font-mono text-xs tabular-nums sm:order-none sm:w-auto">
          {weightByDocument.map(([code, weight]) => <li key={code} className="rounded-small bg-surface/70 px-1.5 py-0.5 ring-1 ring-warning-border"><span className="text-warning/80">{code}</span> {weight}</li>)}
        </ul>
        <span className="font-mono tabular-nums sm:ml-auto">45 kg</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
        <p className="min-w-0 flex-1 basis-48 text-xs leading-5 text-foreground-secondary">Sample data only. Changes stay in this preview. Not for customs filing.</p>
        <Button type="button" size="sm" variant="ghost" className="h-auto min-h-11 shrink-0 px-2 py-3 text-xs" onClick={reset}><RotateCcw className="size-3.5" aria-hidden="true" />Reset</Button>
      </div>
      <p role="status" aria-atomic="true" className="sr-only">{announcement}</p>
    </section>
  );
}
