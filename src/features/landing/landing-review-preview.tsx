"use client";

import { ArrowRight, Check, CheckCheck, RotateCcw, ScanLine, TriangleAlert } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const documents = [
  { id: "invoice", label: "Invoice", title: "Commercial invoice", reference: "INV-24811", detail: "Invoice total", detailValue: "USD 24,800" },
  { id: "packing", label: "Packing list", title: "Packing list", reference: "PKL-24811", detail: "Packages", detailValue: "120 cartons" },
  { id: "lading", label: "Bill of lading", title: "Bill of lading", reference: "BOL-24811", detail: "Port of discharge", detailValue: "Rotterdam" },
] as const;

// Authored synthetic excerpts and deliberately wrong extraction; never a shipment.
// All interactions stay in React state: no controller, API, storage or signed URLs.
export function LandingReviewPreview() {
  const [selected, setSelected] = useState("invoice");
  const [inspected, setInspected] = useState(false);
  const [corrected, setCorrected] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const invoiceTab = useRef<HTMLButtonElement>(null);
  const baseId = useId();

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
    <section aria-label="Interactive review example" className="min-w-0 rounded-dialog border border-border-strong bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-2 pt-5">
        <h2 className="text-base font-semibold">A closer look.</h2>
        <span className="text-xs text-foreground-secondary">Interactive demo</span>
      </div>

      <Tabs value={selected} onValueChange={setSelected} className="min-w-0">
        <TabsList aria-label="Sample documents" className="mx-2 grid h-auto grid-cols-3 items-stretch gap-0 rounded-none border-b border-border bg-transparent p-0 sm:mx-5 sm:gap-1">
          {documents.map((doc) => (
            <TabsTrigger key={doc.id} ref={doc.id === "invoice" ? invoiceTab : undefined} value={doc.id} className="h-auto min-h-11 min-w-0 shrink whitespace-normal rounded-none border-b-2 border-transparent px-0 py-3 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent sm:px-1 sm:text-sm">
              <span className="min-w-0 [overflow-wrap:anywhere]">{doc.label}</span>
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
              <div className="grid min-w-0 sm:grid-cols-2">
                <figure aria-label={`${doc.label} synthetic source, page 1`} className="min-w-0 bg-selected p-4 sm:mt-4">
                  <div className="mx-auto max-w-60 bg-surface px-4 py-5">
                    <p className="text-xs font-medium text-foreground-secondary">Synthetic excerpt</p>
                    <h3 className="mt-4 text-lg font-semibold leading-6">{doc.title}</h3>
                    <p className="mt-2 break-all font-mono text-xs text-foreground-secondary">{doc.reference}</p>
                    <dl className="mt-6">
                      <div className="border-t border-border pt-3">
                        <dt className="text-xs text-foreground-secondary">{doc.detail}</dt>
                        <dd className="mt-1 text-sm font-medium">{doc.detailValue}</dd>
                      </div>
                      <div id={evidenceId} className={cn("-mx-2 mt-4 rounded-small px-2 py-2 transition-colors duration-[var(--motion-normal)] motion-reduce:transition-none", showEvidence ? "bg-warning-surface ring-1 ring-warning-border" : "bg-background")}>
                        <dt className={cn("text-xs", showEvidence ? "text-warning" : "text-foreground-secondary")}>Gross weight</dt>
                        <dd className="mt-1 flex flex-wrap items-baseline gap-x-2 font-mono text-2xl font-medium tabular-nums">3,120 <span className="text-sm text-foreground-secondary">kg</span></dd>
                      </div>
                    </dl>
                  </div>
                  <figcaption className="mt-3 text-center text-xs text-info">Illustrative source · page 1</figcaption>
                </figure>

                <div className="flex min-w-0 flex-col justify-center px-4 py-6 sm:py-8">
                  <dl>
                    <dt className="text-sm font-medium text-foreground-secondary">Extracted gross weight</dt>
                    <dd className="mt-3 flex flex-wrap items-baseline gap-x-2 font-mono text-3xl font-medium tabular-nums">
                      <span>{needsReview ? "3,210" : "3,120"}</span><span className="text-base text-foreground-secondary">kg</span>
                    </dd>
                  </dl>
                  <p data-uncertain={needsReview} className={cn("mt-3 flex items-center gap-2 text-sm font-medium", needsReview ? "text-warning" : "text-success")}>
                    {needsReview ? <TriangleAlert className="size-4 shrink-0" aria-hidden="true" /> : <CheckCheck className="size-4 shrink-0" aria-hidden="true" />}
                    {needsReview ? "Needs review" : isInvoice ? "Corrected by you" : "Matches source"}
                  </p>
                  <p id={reasonId} className="mt-5 text-sm leading-6 text-foreground-secondary">
                    {needsReview
                      ? inspected ? "Source reads 3,120 kg, not 3,210 kg. Two digits were transposed." : "Does this match the document? Compare the weight with its source."
                      : isInvoice ? "Original extraction: 3,210 kg. Your correction stays in this demo."
                        : corrected ? "The sample weight agrees with your corrected invoice. The original extraction is retained for comparison."
                          : "The sample weight agrees with the invoice. Switch back to inspect the flagged extraction."}
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

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
        <p className="min-w-0 flex-1 basis-48 text-xs leading-5 text-foreground-secondary">Sample data only. Changes stay in this preview.<br />Not for customs filing.</p>
        <Button type="button" size="sm" variant="ghost" className="h-auto min-h-11 shrink-0 px-2 py-3 text-xs" onClick={reset}><RotateCcw className="size-3.5" aria-hidden="true" />Reset</Button>
      </div>
      <p role="status" aria-atomic="true" className="sr-only">{announcement}</p>
    </section>
  );
}
