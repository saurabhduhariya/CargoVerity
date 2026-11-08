"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ChevronDown, Plus, RefreshCw, Search, SlidersHorizontal } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FeedbackState } from "@/components/ui/feedback-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Typography } from "@/components/ui/typography";
import type { EnrichedShipment } from "@/lib/shipments";
import { buildLoginPath } from "@/lib/auth-paths";
import { documentStateLabel, formatQueueDate, matchesQueueView, mergeSupplierOptions, queueActionLabel, type QueueView } from "./queue-presentation";

type DashboardStats = { totalShipments: number; highRiskReviewPending: number; awaitingManagerApproval: number; clearedOrExported: number };
const PAGE_SIZE = 20;
const linkFocus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const desktopQuery = "(min-width: 1024px)";
function subscribeDesktop(onChange: () => void) {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const getDesktopSnapshot = () => window.matchMedia(desktopQuery).matches;
const getServerSnapshot = () => false;

function DocumentSummary({ shipment }: { shipment: EnrichedShipment }) {
  return <div className="flex gap-1">
    {([ ["CI", "Commercial Invoice", shipment.documentSlots.invoice], ["PL", "Packing List", shipment.documentSlots.packingList], ["BL", "Bill of Lading", shipment.documentSlots.billOfLading] ] as const).map(([code, name, slot]) => (
      <span key={code} title={`${name}: ${documentStateLabel(slot.status, slot.present)}`} className={`inline-flex h-6 min-w-8 items-center justify-center rounded-small border px-1.5 font-mono text-[11px] font-medium ${!slot.present ? "border-dashed border-control-border bg-transparent text-muted-foreground" : slot.status === "FAILED" ? "border-danger-border bg-danger-surface text-danger" : slot.status === "REVIEW_REQUIRED" ? "border-warning-border bg-warning-surface text-warning" : "border-transparent bg-neutral-surface text-foreground"}`}>
        <span aria-hidden="true">{code}</span><span className="sr-only">{name}, {documentStateLabel(slot.status, slot.present)}</span>
      </span>
    ))}
    <span className="sr-only">{shipment.documentSlots.presentCount} of 3 uploaded</span>
  </div>;
}

function ReviewSummary({ shipment }: { shipment: EnrichedShipment }) {
  const checks = shipment.checksSummary;
  const parts: React.ReactNode[] = [];
  if (checks.blockingUnresolved > 0) parts.push(<span key="b" className="font-medium text-danger">{checks.blockingUnresolved} blocking check{checks.blockingUnresolved === 1 ? "" : "s"}</span>);
  if (shipment.reviewRequiredCount > 0) parts.push(<span key="r" className="font-medium text-warning">{shipment.reviewRequiredCount} field{shipment.reviewRequiredCount === 1 ? "" : "s"} to review</span>);
  if (checks.total > 0 && !parts.length) parts.push(<span key="c" className="text-foreground-secondary">{checks.passed}/{checks.total} checks passed{checks.resolved > 0 ? ` · ${checks.resolved} exception` : ""}</span>);
  if (!parts.length) parts.push(<span key="n" className="text-muted-foreground">Checks not run</span>);
  return <p className="flex flex-col gap-0.5 text-sm">{parts}</p>;
}

function NextAction({ shipment }: { shipment: EnrichedShipment }) {
  const urgent = shipment.nextAction.urgency === "high";
  const done = shipment.nextAction.urgency === "none" || shipment.nextAction.type === "completed";
  return <Link href={shipment.nextAction.href} className={`group inline-flex min-h-11 items-center gap-2 rounded-control text-sm font-medium lg:min-h-9 ${done ? "text-foreground-secondary hover:text-foreground" : "text-foreground"} ${linkFocus}`}>
    {urgent ? <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warning-strong" /> : null}
    {urgent ? <span className="sr-only">High priority: </span> : null}
    <span className="underline decoration-transparent underline-offset-4 group-hover:decoration-current">{queueActionLabel(shipment)}</span><ArrowRight aria-hidden="true" className="size-4 shrink-0 transition-transform duration-[var(--motion-fast)] group-hover:translate-x-0.5 motion-reduce:transition-none" />
  </Link>;
}

export function DashboardShell({ email, role }: { email: string; role: "EXECUTIVE" | "MANAGER" }) {
  const router = useRouter();
  const [shipments, setShipments] = useState<EnrichedShipment[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortOption, setSortOption] = useState("risk");
  const [view, setView] = useState<QueueView>("all");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [reference, setReference] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [importerName, setImporterName] = useState("");
  const [exporterName, setExporterName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const desktop = useSyncExternalStore(subscribeDesktop, getDesktopSnapshot, getServerSnapshot);
  const referenceRef = useRef<HTMLInputElement>(null);
  const newShipmentRef = useRef<HTMLButtonElement>(null);
  const invalidDates = Boolean(fromDate && toDate && fromDate > toDate);
  const hasFilters = Boolean(search || statusFilter || supplierFilter || fromDate || toDate || view !== "all");

  const redirectOnAuthFailure = useCallback((response: Response, data: { code?: string }) => {
    if (response.status === 401) { router.replace(buildLoginPath({ reason: "session-expired" })); return true; }
    if (response.status === 403 && data.code === "ACCOUNT_NOT_PROVISIONED") { router.replace(buildLoginPath({ reason: "not-provisioned" })); return true; }
    return false;
  }, [router]);

  useEffect(() => {
    if (invalidDates) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ sort: sortOption });
      for (const [key, value] of Object.entries({ search: search.trim(), status: statusFilter, supplierId: supplierFilter, fromDate, toDate })) if (value) params.set(key, value);
      try {
        const response = await fetch(`/api/shipments?${params}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (controller.signal.aborted || redirectOnAuthFailure(response, data)) return;
        if (!response.ok) throw new Error(data.error ?? "Could not load shipments. Try refreshing the queue.");
        setShipments(data.shipments ?? []);
        setStats(data.stats ?? null);
        setSuppliers((previous) => mergeSupplierOptions(previous, data.shipments ?? []));
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load shipments. Try refreshing the queue.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, search ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, statusFilter, supplierFilter, fromDate, toDate, sortOption, refresh, invalidDates, redirectOnAuthFailure]);

  useEffect(() => { if (showCreate) referenceRef.current?.focus(); }, [showCreate]);

  function changeFilter(update: () => void, reload = true) { update(); setPage(1); if (reload) setLoading(true); }
  function clearFilters() {
    if (search || statusFilter || supplierFilter || fromDate || toDate || sortOption !== "risk") setLoading(true);
    setSearch(""); setStatusFilter(""); setSupplierFilter(""); setFromDate(""); setToDate(""); setSortOption("risk"); setView("all"); setPage(1);
  }

  async function createShipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setCreating(true); setCreateError(null);
    try {
      const response = await fetch("/api/shipments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference, importerName, exporterName, supplierName }) });
      const data = await response.json();
      if (redirectOnAuthFailure(response, data)) return;
      if (!response.ok) throw new Error(data.error ?? "Could not create shipment.");
      router.push(`/shipments/${data.shipment.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Network error creating shipment. Your entries are retained; try again.");
      setCreating(false);
    }
  }

  const visible = shipments.filter((shipment) => matchesQueueView(shipment, view));
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const rows = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const summary = ([ [stats?.totalShipments, "shipments", ""], [stats?.highRiskReviewPending, "to review", "text-warning"], [stats?.awaitingManagerApproval, "awaiting approval", ""], [stats?.clearedOrExported, "approved or exported", ""] ] as const);

  return <div className="min-h-screen bg-background text-foreground">
    <AppHeader active="shipments" email={email} role={role} />
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1440px] space-y-5 px-4 py-6 outline-none sm:px-6 sm:py-8 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Typography variant="page-title">Shipments</Typography>
          <p aria-label="Shipment counts for current server filters" className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-foreground-secondary">
            {summary.map(([count, label, tone]) => <span key={label} className="whitespace-nowrap"><span className={`font-mono font-medium tabular-nums ${count ? tone || "text-foreground" : "text-foreground"}`}>{loading || count === undefined ? "—" : count}</span> {label}</span>)}
          </p>
        </div>
        <div className="flex gap-2"><Button type="button" variant="outline" aria-label="Refresh queue" title="Refresh queue" size="icon" disabled={loading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw aria-hidden="true" className="size-4" /></Button><Button ref={newShipmentRef} type="button" aria-expanded={showCreate} aria-controls="new-shipment-form" onClick={() => setShowCreate((value) => !value)}><Plus aria-hidden="true" className="size-4" />New shipment</Button></div>
      </div>

      <section id="new-shipment-form" hidden={!showCreate} aria-labelledby="create-heading" className="rounded-panel border border-border bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><Typography id="create-heading" variant="section-title">New shipment</Typography><p className="text-sm text-muted-foreground">Only the reference is required.</p></div>
        <form onSubmit={createShipment} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2"><Label htmlFor="reference">Shipment reference</Label><Input ref={referenceRef} id="reference" required minLength={3} maxLength={80} placeholder="SHP-24811" className="font-mono" value={reference} disabled={creating} onChange={(event) => setReference(event.target.value)} /></div>
            {([ ["supplier", "Supplier", supplierName, setSupplierName], ["importer", "Importer", importerName, setImporterName], ["exporter", "Exporter", exporterName, setExporterName] ] as const).map(([id, label, value, update]) => <div key={id} className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} maxLength={200} value={value} disabled={creating} onChange={(event) => update(event.target.value)} /></div>)}
          </div>
          {createError ? <FeedbackState kind="error" title="Shipment not created" description={createError} /> : null}
          <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" disabled={creating} onClick={() => { setShowCreate(false); newShipmentRef.current?.focus(); }}>Cancel</Button><Button type="submit" loading={creating}>Create shipment<ArrowRight aria-hidden="true" className="size-4" /></Button></div>
        </form>
      </section>

      <section aria-labelledby="queue-heading" className="min-w-0 overflow-hidden rounded-panel border border-border bg-surface">
        <h2 id="queue-heading" className="sr-only">Operations queue</h2>
        <div role="group" aria-label="Queue views" className="flex flex-wrap gap-x-1 border-b border-border px-3">
          {([ ["all", "All shipments"], ["attention", "Needs action"], ["documents", "Missing documents"], ["approval", "Awaiting approval"] ] as const).map(([key, label]) => <Button key={key} type="button" size="sm" variant="ghost" aria-pressed={view === key} className={`min-h-12 shrink-0 whitespace-nowrap rounded-none border-0 border-b-2 px-3 enabled:hover:bg-transparent enabled:hover:text-foreground ${view === key ? "border-foreground text-foreground" : "border-transparent text-foreground-secondary"}`} onClick={() => changeFilter(() => setView(key), false)}>{label}<span className={`shrink-0 whitespace-nowrap font-mono text-xs tabular-nums ${view === key ? "text-foreground" : "text-muted-foreground"}`}>{loading ? "—" : shipments.filter((shipment) => matchesQueueView(shipment, key)).length}</span></Button>)}
        </div>
        <div className="space-y-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="grid items-center gap-2 lg:grid-cols-[minmax(240px,1.6fr)_1fr_1fr_1fr_auto]">
            <div><Label htmlFor="shipment-search" className="sr-only">Search shipments</Label><div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="shipment-search" type="search" maxLength={80} placeholder="Search reference, supplier or party" value={search} onChange={(event) => changeFilter(() => setSearch(event.target.value))} className="pl-9" /></div></div>
            <div className="flex items-center justify-between gap-2 lg:hidden"><Button type="button" variant="ghost" className="px-0" aria-expanded={filtersOpen} aria-controls="queue-secondary-filters queue-date-filters" onClick={() => setFiltersOpen((value) => !value)}><SlidersHorizontal aria-hidden="true" className="size-4" />Filters and sort<ChevronDown aria-hidden="true" className={`size-4 ${filtersOpen ? "rotate-180" : ""}`} /></Button>{hasFilters || sortOption !== "risk" ? <Button type="button" variant="link" size="sm" onClick={clearFilters}>Reset filters</Button> : null}</div>
            <div id="queue-secondary-filters" hidden={!desktop && !filtersOpen} className="grid gap-2 sm:grid-cols-2 lg:contents">
              <div><Label htmlFor="status-filter" className="sr-only">Status</Label><Select id="status-filter" aria-label="Filter shipment status" value={statusFilter} onChange={(event) => changeFilter(() => setStatusFilter(event.target.value))}><option value="">All statuses</option>{["DRAFT", "IN_REVIEW", "EXTRACTING", "NEEDS_REVIEW", "READY_FOR_APPROVAL", "APPROVED", "EXPORTED"].map((status) => <option key={status} value={status}>{status === "READY_FOR_APPROVAL" ? "Awaiting approval" : status.charAt(0) + status.slice(1).toLowerCase().replaceAll("_", " ")}</option>)}</Select></div>
              <div><Label htmlFor="supplier-filter" className="sr-only">Supplier</Label><Select id="supplier-filter" aria-label="Filter supplier" value={supplierFilter} onChange={(event) => changeFilter(() => setSupplierFilter(event.target.value))}><option value="">All suppliers</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</Select></div>
              <div><Label htmlFor="sort-filter" className="sr-only">Sort</Label><Select id="sort-filter" aria-label="Sort shipments" value={sortOption} onChange={(event) => changeFilter(() => setSortOption(event.target.value))}><option value="risk">Most urgent first</option><option value="date_desc">Newest first</option><option value="date_asc">Oldest first</option></Select></div>
            </div>
            <div id="queue-date-filters" hidden={!desktop && !filtersOpen} className="flex items-center gap-1">
              <details className="group relative min-w-0"><summary className={`inline-flex min-h-[var(--control-height)] cursor-pointer list-none items-center gap-2 rounded-control px-2 text-sm text-foreground-secondary hover:text-foreground [&::-webkit-details-marker]:hidden ${linkFocus}`}><SlidersHorizontal aria-hidden="true" className="size-4" />Created date (UTC){fromDate || toDate ? <Badge>Active</Badge> : null}<ChevronDown aria-hidden="true" className="size-4 group-open:rotate-180" /></summary><div className="z-20 mt-2 grid gap-3 rounded-panel border border-border bg-surface p-3 sm:grid-cols-2 lg:absolute lg:right-0 lg:w-80 lg:shadow-overlay"><div className="space-y-2"><Label htmlFor="from-date">From</Label><Input id="from-date" type="date" aria-label="Filter from date" value={fromDate} max={toDate || undefined} onChange={(event) => changeFilter(() => setFromDate(event.target.value))} /></div><div className="space-y-2"><Label htmlFor="to-date">To</Label><Input id="to-date" type="date" aria-label="Filter to date" value={toDate} min={fromDate || undefined} aria-invalid={invalidDates || undefined} aria-describedby={invalidDates ? "date-error" : undefined} onChange={(event) => changeFilter(() => setToDate(event.target.value))} /></div></div></details>
              {hasFilters || sortOption !== "risk" ? <Button type="button" variant="link" size="sm" className="hidden whitespace-nowrap lg:inline-flex" onClick={clearFilters}>Reset filters</Button> : null}
            </div>
          </div>
          {invalidDates ? <p id="date-error" role="alert" className="text-sm text-danger">From date must be on or before to date. Adjust the range to load results.</p> : null}
        </div>

        {error ? <FeedbackState kind="error" className="m-4" title="Queue unavailable" description={error} action={<Button type="button" variant="outline" onClick={() => setRefresh((value) => value + 1)}>Try again</Button>} /> : null}
        <div aria-busy={loading || undefined}>
          {invalidDates ? <FeedbackState kind="empty" className="px-5" title="Choose a valid date range" description="Results are hidden until the date range is corrected." /> : loading ? <div role="status" className="divide-y divide-border"><span className="sr-only">Loading shipment queue</span>{[0, 1, 2, 3, 4].map((key) => <div key={key} className="flex items-center gap-6 px-5 py-4"><Skeleton className="h-9 w-56" /><Skeleton className="h-6 w-24" /><Skeleton className="h-6 w-28" /><Skeleton className="ml-auto h-6 w-36" /></div>)}</div> : error ? null : rows.length === 0 ? <FeedbackState kind="empty" className="px-5" title={hasFilters ? "No shipments match these filters" : "No shipments yet"} description={hasFilters ? "Change the search or view, or reset the filters." : "Create a shipment, then add its invoice, packing list and bill of lading."} action={<Button type="button" variant="outline" onClick={hasFilters ? clearFilters : () => setShowCreate(true)}>{hasFilters ? "Reset filters" : "New shipment"}</Button>} /> : <>
            <div className="hidden lg:block"><Table containerLabel="Shipment operations queue" className="min-w-[980px]"><TableHeader><TableRow className="hover:bg-transparent"><TableHead className="w-[28%] pl-5">Shipment</TableHead><TableHead>Status</TableHead><TableHead>Documents</TableHead><TableHead>Review</TableHead><TableHead>Updated</TableHead><TableHead className="w-[22%] pr-5">Next action</TableHead></TableRow></TableHeader><TableBody>{rows.map((shipment) => <TableRow key={shipment.id}><TableCell className="pl-5"><Link href={`/shipments/${shipment.id}`} className={`break-all rounded-small font-mono text-[13px] font-medium text-foreground hover:underline ${linkFocus}`}>{shipment.reference}</Link><p className="mt-0.5 truncate text-sm text-foreground-secondary">{shipment.supplier?.name ?? "No supplier"}</p></TableCell><TableCell><StatusBadge status={shipment.status} /></TableCell><TableCell><DocumentSummary shipment={shipment} /></TableCell><TableCell><ReviewSummary shipment={shipment} /></TableCell><TableCell className="whitespace-nowrap text-sm text-foreground-secondary"><span className="font-mono text-[13px] tabular-nums">{formatQueueDate(shipment.updatedAt)}</span><span className="mt-0.5 block font-mono text-xs text-muted-foreground">rev {shipment.currentRevision}</span></TableCell><TableCell className="pr-5"><NextAction shipment={shipment} /></TableCell></TableRow>)}</TableBody></Table></div>
            <ul className="divide-y divide-border lg:hidden">{rows.map((shipment) => <li key={shipment.id} className="space-y-3 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><Link href={`/shipments/${shipment.id}`} className={`break-all rounded-small font-mono text-sm font-semibold text-foreground ${linkFocus}`}>{shipment.reference}</Link><p className="mt-0.5 text-sm text-foreground-secondary">{shipment.supplier?.name ?? "No supplier"}</p></div><StatusBadge status={shipment.status} /></div><div className="flex flex-wrap items-center justify-between gap-2"><DocumentSummary shipment={shipment} /><ReviewSummary shipment={shipment} /></div><div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2"><NextAction shipment={shipment} /><p className="font-mono text-xs text-muted-foreground">rev {shipment.currentRevision} · {formatQueueDate(shipment.updatedAt)}</p></div></li>)}</ul>
          </>}
        </div>
        {!loading && !error && !invalidDates && visible.length > 0 ? <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3"><p role="status" className="text-sm text-foreground-secondary">{`${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, visible.length)} of ${visible.length}`}</p>{totalPages > 1 ? <nav aria-label="Queue pagination" className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</Button><span className="font-mono text-xs tabular-nums text-muted-foreground">{currentPage} / {totalPages}</span><Button type="button" variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>Next</Button></nav> : null}</footer> : null}
      </section>
    </main>
  </div>;
}
