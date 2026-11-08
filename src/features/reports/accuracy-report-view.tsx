"use client";

import { useRef, useState } from "react";
import { RefreshCw, Search } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FeedbackState } from "@/components/ui/feedback-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Typography } from "@/components/ui/typography";
import type { AccuracyGroupMetrics, AccuracyReport, MetricRatio } from "@/lib/reports/accuracy";
import { displayDate, formatFieldLabel } from "@/features/review/review-presentation";

/** A zero denominator is no measurement, not a measured 0% accuracy. */
export function measuredPercentage(ratio: MetricRatio): string {
  return ratio.denominator > 0 ? ratio.formattedPercentage : "Not evaluated";
}

export function filterReportGroups(groups: AccuracyGroupMetrics[], search: string, sort: string) {
  const query = search.trim().toLowerCase();
  return groups.filter((group) => `${group.groupLabel} ${group.groupKey}`.toLowerCase().includes(query)).sort((a, b) => {
    if (sort === "name") return a.groupLabel.localeCompare(b.groupLabel);
    if (sort === "corrections") return b.corrected - a.corrected || b.evaluated - a.evaluated || a.groupLabel.localeCompare(b.groupLabel);
    return b.evaluated - a.evaluated || a.groupLabel.localeCompare(b.groupLabel);
  });
}

function Ratio({ ratio }: { ratio: MetricRatio }) {
  return <div className="space-y-1"><p className="whitespace-nowrap font-mono font-medium tabular-nums">{measuredPercentage(ratio)}</p><p className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">{ratio.numerator}/{ratio.denominator} · {ratio.sampleSize} shipments</p></div>;
}

function Breakdown({ groups, kind, search, sort }: { groups: AccuracyGroupMetrics[]; kind: "fields" | "suppliers"; search: string; sort: string }) {
  const rows = filterReportGroups(groups, search, sort);
  return <>
    <p role="status" className="px-4 py-3 text-sm text-foreground-secondary">{rows.length} of {groups.length} {kind === "fields" ? "fields" : "suppliers"}<span className="text-muted-foreground"> · percentages use evaluated fields only</span></p>
    <Table containerLabel={`Scrollable ${kind} report`} className="min-w-[1100px]">
      <TableHeader><TableRow><TableHead>{kind === "fields" ? "Field" : "Supplier"}</TableHead><TableHead numeric>Total</TableHead><TableHead numeric>Evaluated</TableHead><TableHead numeric>Unchanged</TableHead><TableHead numeric>Corrected</TableHead><TableHead numeric>Manual</TableHead><TableHead numeric>Unreviewed</TableHead><TableHead numeric>Absent / N/A</TableHead><TableHead numeric>Extraction agreement</TableHead><TableHead numeric>Correction rate</TableHead></TableRow></TableHeader>
      <TableBody>{rows.length ? rows.map((group) => <TableRow key={group.groupKey}>
        <TableCell className="max-w-64 break-words font-medium">{kind === "fields" ? formatFieldLabel(group.groupKey) : group.groupLabel}</TableCell>
        <TableCell numeric>{group.totalFields}</TableCell><TableCell numeric>{group.evaluated}</TableCell><TableCell numeric>{group.correctAsExtracted}</TableCell><TableCell numeric>{group.corrected}</TableCell><TableCell numeric>{group.manualEntries}</TableCell><TableCell numeric>{group.unreviewed}</TableCell><TableCell numeric>{group.notApplicable}</TableCell>
        <TableCell numeric><Ratio ratio={group.accuracy} /></TableCell><TableCell numeric><Ratio ratio={group.correctionRate} /></TableCell>
      </TableRow>) : <TableRow><TableCell colSpan={10}><FeedbackState kind="empty" title={search.trim() ? "No matching report groups" : "No fields in this dataset"} description={search.trim() ? "Clear or change the search to inspect the available groups." : "Upload and review documents to populate this report. No accuracy is claimed for an empty dataset."} /></TableCell></TableRow>}</TableBody>
    </Table>
  </>;
}

export function AccuracyReportView({ initialReport, email, role }: { initialReport?: AccuracyReport; email?: string; role?: "EXECUTIVE" | "MANAGER" }) {
  const [report, setReport] = useState<AccuracyReport | null>(initialReport ?? null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("fields");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("evaluated");

  async function loadReport() {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/reports/accuracy", { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "The report could not be refreshed. Retry the saved-data request.");
      }
      setReport(await response.json() as AccuracyReport);
    } catch (err) { setError(err instanceof Error ? err.message : "The report could not be refreshed."); }
    finally { inFlight.current = false; setLoading(false); }
  }

  return <div className="min-h-dvh bg-background text-foreground">
    {email && role ? <AppHeader active="reports" email={email} role={role} /> : null}
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1440px] space-y-5 px-4 py-5 outline-none sm:space-y-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><Typography as="h1" variant="page-title">Extraction accuracy</Typography><p className="mt-1.5 text-sm text-foreground-secondary">By field and supplier, measured against saved review decisions.{report ? <span className="text-muted-foreground"> · Updated <span className="font-mono text-xs">{displayDate(report.generatedAt)}</span></span> : null}</p></div><Button type="button" variant="outline" size="sm" loading={loading} onClick={() => void loadReport()}>{loading ? null : <RefreshCw aria-hidden="true" className="size-4" />}Refresh report</Button></div>
      {error ? <FeedbackState kind="error" title="Report refresh failed" description={`${error}${report ? " The previous snapshot remains below; its timestamp has not changed." : ""}`} action={<Button type="button" variant="outline" disabled={loading} onClick={() => void loadReport()}>Retry report</Button>} /> : loading ? <FeedbackState kind="loading" title="Refreshing report from saved data" description="Existing results remain the previous snapshot until the request completes." /> : null}
      {!report ? <FeedbackState kind={loading ? "loading" : "empty"} title={loading ? "Loading report" : "Report not loaded"} description="Fetch the authorized dataset. No metrics are shown until the server returns them." action={!loading ? <Button type="button" onClick={() => void loadReport()}>Load report</Button> : undefined} /> : <>
        <section aria-label="Dataset and benchmark scope" className="flex flex-wrap items-start gap-x-3 gap-y-2 text-sm text-foreground-secondary">
          <Badge variant="outline">{report.dataset.type === "SYNTHETIC_DEMO" ? "Sample shipments" : "Labelled benchmark"}</Badge>
          <details className="min-w-0 flex-1"><summary className="min-h-11 cursor-pointer rounded-small py-0.5 sm:min-h-7">{report.dataset.type === "SYNTHETIC_DEMO" ? `Sample shipments, not the 200-shipment benchmark · ${report.benchmarkTarget.targetPercentage}% target not established` : report.dataset.label}</summary><div className="max-w-prose space-y-2 py-3"><p>{report.dataset.watermark}</p><p className="leading-6">{report.benchmarkTarget.disclaimer}</p></div></details>
        </section>
        <section aria-label="Measured extraction results" className="overflow-hidden rounded-panel border border-border bg-surface">
          <div className="grid sm:grid-cols-2">
            {([["Extraction agreement", report.summary.accuracy, "evaluated fields unchanged after review", true], ["Reviewer correction rate", report.summary.correctionRate, "evaluated fields differ from the proposal", false]] as const).map(([title, ratio, caption, showTarget], index) => {
              const measured = ratio.denominator > 0;
              const percent = measured ? (ratio.numerator / ratio.denominator) * 100 : 0;
              return <div key={title} className={`space-y-3 p-5 ${index === 0 ? "border-b border-border sm:border-b-0 sm:border-r" : ""}`}>
                <h2 className="text-sm font-medium text-foreground-secondary">{title}</h2>
                <p className="font-mono text-3xl font-semibold tabular-nums tracking-tight">{measuredPercentage(ratio)}</p>
                {showTarget ? <div aria-hidden="true" className="relative h-1.5 rounded-full bg-surface-subtle"><div className="h-full rounded-full bg-foreground" style={{ width: `${Math.min(100, percent)}%` }} /><span className="absolute -top-1 h-3.5 w-px bg-warning-strong" style={{ left: `${report.benchmarkTarget.targetPercentage}%` }} /></div> : null}
                <p className="text-sm text-foreground-secondary"><span className="font-mono tabular-nums">{ratio.numerator} / {ratio.denominator}</span> {caption}{showTarget ? <span className="text-muted-foreground"> · target {report.benchmarkTarget.targetPercentage}%</span> : null}</p>
                <p className="text-xs text-muted-foreground">Sample: <span className="font-mono tabular-nums">{ratio.sampleSize}</span> shipments with evaluated fields</p>
              </div>;
            })}
          </div>
          <dl className="grid grid-cols-2 gap-4 border-t border-border bg-background/60 px-5 py-4 sm:grid-cols-5">{[["Recorded fields", report.summary.totalFields], ["Evaluated", report.summary.evaluated], ["Manual entries", report.summary.manualEntries], ["Unreviewed", report.summary.unreviewed], ["Absent / not applicable", report.summary.notApplicable]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-mono text-base font-medium tabular-nums">{value}</dd></div>)}</dl>
        </section>
        <section className="overflow-hidden rounded-panel border border-border bg-surface" aria-label="Report breakdown">
          <Tabs value={tab} onValueChange={(value) => { setTab(value); setSearch(""); }}>
            <TabsList aria-label="Report breakdown" className="flex-wrap px-2"><TabsTrigger value="fields">By field ({report.byFieldKey.length})</TabsTrigger><TabsTrigger value="suppliers">By supplier ({report.bySupplier.length})</TabsTrigger><TabsTrigger value="method">Method & targets</TabsTrigger></TabsList>
            {tab !== "method" ? <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"><div className="w-full sm:max-w-sm"><Label htmlFor="report-search" className="sr-only">Search {tab === "fields" ? "fields" : "suppliers"}</Label><div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" /><Input id="report-search" className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tab === "fields" ? "Search fields" : "Search suppliers"} /></div></div><div className="w-full sm:w-auto"><Label htmlFor="report-sort" className="sr-only">Sort groups</Label><Select id="report-sort" value={sort} onChange={(event) => setSort(event.target.value)}><option value="evaluated">Most evaluated</option><option value="corrections">Most corrections</option><option value="name">Name A–Z</option></Select></div>{search ? <Button type="button" variant="link" size="sm" onClick={() => setSearch("")}>Clear search</Button> : null}</div> : null}
            <TabsContent value="fields" className="pt-0"><Breakdown groups={report.byFieldKey} kind="fields" search={search} sort={sort} /></TabsContent>
            <TabsContent value="suppliers" className="pt-0"><Breakdown groups={report.bySupplier} kind="suppliers" search={search} sort={sort} /></TabsContent>
            <TabsContent value="method" className="space-y-5 p-4 sm:p-5">
              <section className="space-y-3"><h2 className="text-base font-semibold">What is measured</h2><p className="max-w-prose text-sm leading-6 text-foreground-secondary">Extraction agreement compares extracted values with saved human-reviewed values. Model confidence is not measured accuracy.</p><p className="max-w-prose text-sm leading-6 text-foreground-secondary">Manual, unreviewed, absent and not-applicable fields are excluded. Sample size counts shipments with at least one evaluated field. Results use the latest completed extraction of each current document, limited to shipments you can access.</p></section>
              <section className="space-y-3 border-t border-border pt-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">Client extraction benchmark · {report.benchmarkTarget.targetPercentage}% target</h2><Badge variant="outline">{report.benchmarkTarget.targetClaimed ? "Server reports target claimed" : "Target not claimed"}</Badge></div><p className="max-w-prose text-sm leading-6 text-foreground-secondary">{report.benchmarkTarget.disclaimer}</p><p className="text-sm text-foreground-secondary">The labelled 200-shipment ground-truth evaluation is required; synthetic demo results do not establish this target.</p></section>
              <section className="space-y-3 border-t border-border pt-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">Entry time · under 15 minutes target</h2><Badge variant="outline">Not measured with real reviewers</Badge></div><p className="max-w-prose text-sm leading-6 text-foreground-secondary">Measure from document upload through extraction, checks, review and submission. No client-reviewer duration or manual-keying baseline is provided by this report. No duration or speed-up is claimed.</p></section>
              <section className="space-y-3 border-t border-border pt-5"><h2 className="text-base font-semibold">Amended filings · evaluation plan</h2><p className="max-w-prose text-sm leading-6 text-foreground-secondary">Compare a 90-day historical baseline with a 90-day post-rollout window using actual filing and amendment records. No reduction is measured here. CargoVerity assists document verification; it does not file directly, classify HSN codes, or calculate duties.</p></section>
            </TabsContent>
          </Tabs>
        </section>
      </>}
    </main>
  </div>;
}
