"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, BarChart3, CheckCircle2, ChevronDown, FileText, LogOut, Package, Plus, RefreshCw, Search, SlidersHorizontal } from "lucide-react";

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
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { documentStateLabel, formatQueueDate, matchesQueueView, mergeSupplierOptions, queueActionLabel, queuePriority, type QueueView } from "./queue-presentation";

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
  return <div className="flex flex-wrap gap-1.5 lg:flex-nowrap">
    {([ ["CI", "Commercial Invoice", shipment.documentSlots.invoice], ["PL", "Packing List", shipment.documentSlots.packingList], ["BL", "Bill of Lading", shipment.documentSlots.billOfLading] ] as const).map(([code, name, slot]) => (
      <span key={code} title={`${name}: ${documentStateLabel(slot.status, slot.present)}`} className={`inline-flex items-center gap-1 rounded-small border px-1.5 py-1 text-xs ${!slot.present ? "border-warning-border bg-warning-surface text-warning" : slot.status === "FAILED" ? "border-danger-border bg-danger-surface text-danger" : "border-border bg-surface-subtle text-foreground-secondary"}`}>
        {slot.present ? <FileText aria-hidden="true" className="size-3" /> : <span aria-hidden="true">—</span>}
        <span>{code}</span><span className="sr-only">: {name}, {documentStateLabel(slot.status, slot.present)}</span>
      </span>
    ))}
    <span className="sr-only">{shipment.documentSlots.presentCount} of 3 uploaded</span>
  </div>;
}

function ReviewSummary({ shipment }: { shipment: EnrichedShipment }) {
  const checks = shipment.checksSummary;
  return <div className="space-y-1 text-xs">
    {checks.blockingUnresolved > 0 ? <p className="font-medium text-danger">{checks.blockingUnresolved} blocking check{checks.blockingUnresolved === 1 ? "" : "s"}</p> : null}
    {shipment.reviewRequiredCount > 0 ? <p className="text-warning">{shipment.reviewRequiredCount} review flag{shipment.reviewRequiredCount === 1 ? "" : "s"}</p> : null}
    {checks.total > 0 ? <p className="text-foreground-secondary">{checks.passed}/{checks.total} machine checks passed{checks.resolved > 0 ? ` · ${checks.resolved} exception approved` : ""}</p> : <p className="text-muted-foreground">Checks not run · rev {shipment.currentRevision}</p>}
  </div>;
}

function NextAction({ shipment }: { shipment: EnrichedShipment }) {
  return <div className="space-y-1.5">
    <Link href={shipment.nextAction.href} className={`inline-flex min-h-11 items-center gap-2 rounded-control text-sm font-medium text-primary hover:underline lg:min-h-9 ${linkFocus}`}>
      {queueActionLabel(shipment)}<ArrowRight aria-hidden="true" className="size-4 shrink-0" />
    </Link>
    <p className="max-w-64 text-xs text-foreground-secondary">{shipment.nextAction.type === "export" ? "Approval recorded. Export guards apply in review." : shipment.nextAction.type === "submit" ? "Inspect readiness in the review workspace." : shipment.nextAction.description}</p>
  </div>;
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
  const [signingOut, setSigningOut] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [countsOpen, setCountsOpen] = useState(false);
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

  async function signOut() {
    setSigningOut(true);
    try {
      const result = await getSupabaseBrowserClient().auth.signOut();
      if (result.error) throw result.error;
      router.push("/"); router.refresh();
    } catch { setError("Could not sign out. Please try again."); setSigningOut(false); }
  }

  const visible = shipments.filter((shipment) => matchesQueueView(shipment, view));
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const rows = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return <main className="min-h-screen bg-background text-foreground">
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3"><Package aria-hidden="true" className="size-5 text-primary" /><span className="font-semibold">CargoVerity</span><Badge> Synthetic demo </Badge></div>
        <nav aria-label="Application" className="flex flex-wrap items-center gap-3">
          <Link href="/reports" className={`inline-flex min-h-11 items-center gap-2 rounded-control text-sm text-foreground-secondary hover:text-primary ${linkFocus}`}><BarChart3 aria-hidden="true" className="size-4" />Reports</Link>
          <span data-testid="current-role" className="text-xs text-muted-foreground">{role === "MANAGER" ? "Manager" : "Executive"}</span>
          <Button type="button" variant="ghost" size="sm" loading={signingOut} onClick={() => void signOut()}><LogOut aria-hidden="true" className="size-4" />Sign out</Button>
        </nav>
      </div>
    </header>
    <div className="mx-auto max-w-[1440px] space-y-4 px-4 py-5 sm:space-y-6 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><Typography variant="page-title">Shipment operations</Typography><p className="mt-1 text-sm text-foreground-secondary">Document intake, review, and next actions.</p><p className="mt-2 break-all text-xs text-muted-foreground">{email} · {role === "MANAGER" ? "All accessible shipments" : "Your shipments"}</p></div>
        <div className="flex gap-2"><Button type="button" variant="outline" disabled={loading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw aria-hidden="true" className="size-4" />Refresh queue</Button><Button ref={newShipmentRef} type="button" aria-expanded={showCreate} aria-controls="new-shipment-form" onClick={() => setShowCreate((value) => !value)}><Plus aria-hidden="true" className="size-4" />New shipment</Button></div>
      </div>

      <section id="new-shipment-form" hidden={!showCreate} aria-labelledby="create-heading" className="rounded-panel border border-border bg-surface p-5">
        <Typography id="create-heading" variant="section-title">New synthetic shipment</Typography><p className="mt-1 text-sm text-foreground-secondary">Start with a unique reference. Party details can be left blank.</p>
        <form onSubmit={createShipment} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2"><Label htmlFor="reference">Shipment reference <span className="text-muted-foreground">(required)</span></Label><Input ref={referenceRef} id="reference" required minLength={3} maxLength={80} placeholder="QA-DEMO-2026-01" className="font-mono" value={reference} disabled={creating} onChange={(event) => setReference(event.target.value)} /></div>
            {([ ["supplier", "Supplier name", supplierName, setSupplierName], ["importer", "Importer name", importerName, setImporterName], ["exporter", "Exporter name", exporterName, setExporterName] ] as const).map(([id, label, value, update]) => <div key={id} className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} maxLength={200} value={value} disabled={creating} onChange={(event) => update(event.target.value)} /></div>)}
          </div>
          {createError ? <FeedbackState kind="error" title="Shipment not created" description={createError} /> : null}
          <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={creating} onClick={() => { setShowCreate(false); newShipmentRef.current?.focus(); }}>Close form</Button><Button type="submit" loading={creating}>Create shipment<ArrowRight aria-hidden="true" className="size-4" /></Button></div>
        </form>
      </section>

      <section aria-label="Shipment counts for current server filters" className="rounded-panel border border-border bg-surface">
        <div className="flex items-center justify-between gap-2 px-4 py-2 lg:hidden"><p className="text-sm text-foreground-secondary"><span className="whitespace-nowrap font-mono font-semibold tabular-nums text-foreground">{loading ? "—" : stats?.totalShipments ?? "—"}</span> shipments</p><Button type="button" variant="ghost" size="sm" aria-expanded={countsOpen} aria-controls="queue-counts" onClick={() => setCountsOpen((value) => !value)}>Queue totals<ChevronDown aria-hidden="true" className={`size-4 ${countsOpen ? "rotate-180" : ""}`} /></Button></div>
        <div id="queue-counts" hidden={!desktop && !countsOpen} className="grid grid-cols-2 divide-x divide-border lg:grid-cols-4">
          {([ ["Shipments", stats?.totalShipments, "text-foreground"], ["Review pending", stats?.highRiskReviewPending, "text-warning"], ["Awaiting approval", stats?.awaitingManagerApproval, "text-foreground"], ["Approved / exported", stats?.clearedOrExported, "text-foreground"] ] as const).map(([label, count, tone]) => <div key={label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-3 sm:px-5 sm:py-4"><span className="text-sm text-foreground-secondary">{label}</span>{loading ? <Skeleton className="h-6 w-8" /> : <span className={`font-mono text-xl font-semibold tabular-nums ${tone}`}>{count ?? "—"}</span>}</div>)}
        </div>
        <p hidden={!desktop && !countsOpen} className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Current filters · approval is not customs clearance.</p>
      </section>

      <section aria-labelledby="queue-heading" className="min-w-0 rounded-panel border border-border bg-surface">
        <div className="space-y-3 border-b border-border p-4 sm:space-y-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><Typography id="queue-heading" variant="section-title">Operations queue</Typography><span className="text-xs text-muted-foreground">{sortOption === "risk" ? "Server priority · highest first" : sortOption === "date_desc" ? "Created · newest first" : "Created · oldest first"}</span></div>
          <div role="group" aria-label="Queue views" className="flex gap-2 overflow-x-auto sm:flex-wrap">
            {([ ["all", "All shipments"], ["attention", "Needs action"], ["documents", "Missing documents"], ["approval", "Awaiting approval"] ] as const).map(([key, label]) => <Button key={key} type="button" size="sm" variant="ghost" aria-pressed={view === key} className={`shrink-0 whitespace-nowrap ${view === key ? "border-info-border bg-selected text-info" : ""}`} onClick={() => changeFilter(() => setView(key), false)}>{label}<span className="shrink-0 whitespace-nowrap font-mono text-xs tabular-nums">{loading ? "—" : shipments.filter((shipment) => matchesQueueView(shipment, key)).length}</span></Button>)}
          </div>
          <div className="grid items-end gap-3 lg:grid-cols-[minmax(220px,1.6fr)_1fr_1fr_1fr]">
            <div className="space-y-2"><Label htmlFor="shipment-search">Search shipments</Label><div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" /><Input id="shipment-search" type="search" maxLength={80} placeholder="Reference, supplier, or party" value={search} onChange={(event) => changeFilter(() => setSearch(event.target.value))} className="pl-9" /></div></div>
            <div className="flex items-center justify-between gap-2 lg:hidden"><Button type="button" variant="ghost" className="px-0" aria-expanded={filtersOpen} aria-controls="queue-secondary-filters queue-date-filters" onClick={() => setFiltersOpen((value) => !value)}><SlidersHorizontal aria-hidden="true" className="size-4" />Filters & sort<ChevronDown aria-hidden="true" className={`size-4 ${filtersOpen ? "rotate-180" : ""}`} /></Button>{hasFilters || sortOption !== "risk" ? <Button type="button" variant="link" size="sm" onClick={clearFilters}>Reset filters</Button> : null}</div>
              <div id="queue-secondary-filters" hidden={!desktop && !filtersOpen} className="grid gap-3 sm:grid-cols-2 lg:contents">
            <div className="space-y-2"><Label htmlFor="status-filter">Status</Label><Select id="status-filter" aria-label="Filter shipment status" value={statusFilter} onChange={(event) => changeFilter(() => setStatusFilter(event.target.value))}><option value="">All statuses</option>{["DRAFT", "IN_REVIEW", "EXTRACTING", "NEEDS_REVIEW", "READY_FOR_APPROVAL", "APPROVED", "EXPORTED"].map((status) => <option key={status} value={status}>{status === "READY_FOR_APPROVAL" ? "Awaiting approval" : status.toLowerCase().replaceAll("_", " ")}</option>)}</Select></div>
            <div className="space-y-2"><Label htmlFor="supplier-filter">Supplier</Label><Select id="supplier-filter" aria-label="Filter supplier" value={supplierFilter} onChange={(event) => changeFilter(() => setSupplierFilter(event.target.value))}><option value="">All suppliers</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</Select></div>
            <div className="space-y-2"><Label htmlFor="sort-filter">Sort</Label><Select id="sort-filter" aria-label="Sort shipments" value={sortOption} onChange={(event) => changeFilter(() => setSortOption(event.target.value))}><option value="risk">Priority · highest first</option><option value="date_desc">Newest created</option><option value="date_asc">Oldest created</option></Select></div>
              </div>
          </div>
          <div id="queue-date-filters" hidden={!desktop && !filtersOpen} className="flex flex-wrap items-center justify-between gap-3">
            <details className="group min-w-0"><summary className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-control text-sm text-foreground-secondary hover:text-primary ${linkFocus}`}><SlidersHorizontal aria-hidden="true" className="size-4" />Created date (UTC){fromDate || toDate ? <Badge>Active</Badge> : null}<ChevronDown aria-hidden="true" className="size-4 group-open:rotate-180" /></summary><div className="grid gap-3 py-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="from-date">From date</Label><Input id="from-date" type="date" aria-label="Filter from date" value={fromDate} max={toDate || undefined} onChange={(event) => changeFilter(() => setFromDate(event.target.value))} /></div><div className="space-y-2"><Label htmlFor="to-date">To date</Label><Input id="to-date" type="date" aria-label="Filter to date" value={toDate} min={fromDate || undefined} aria-invalid={invalidDates || undefined} aria-describedby={invalidDates ? "date-error" : undefined} onChange={(event) => changeFilter(() => setToDate(event.target.value))} /></div></div></details>
            {hasFilters || sortOption !== "risk" ? <Button type="button" variant="link" size="sm" className="hidden lg:inline-flex" onClick={clearFilters}>Reset filters</Button> : <span className="text-xs text-muted-foreground">CI: Invoice · PL: Packing List · BL: Bill of Lading</span>}
          </div>
          {invalidDates ? <p id="date-error" role="alert" className="text-sm text-danger">From date must be on or before to date. Adjust the range to load results.</p> : null}
        </div>

        {error ? <FeedbackState kind="error" className="m-4" title="Queue unavailable" description={error} action={<Button type="button" variant="outline" onClick={() => setRefresh((value) => value + 1)}>Try again</Button>} /> : null}
        <div aria-busy={loading || undefined}>
          {invalidDates ? <FeedbackState kind="empty" title="Choose a valid date range" description="The previous results are hidden until the date range is corrected." /> : loading ? <div role="status" className="space-y-4 p-5"><span className="sr-only">Loading shipment queue</span>{[0, 1, 2, 3].map((key) => <Skeleton key={key} className="h-20 w-full" />)}</div> : error ? null : rows.length === 0 ? <FeedbackState kind="empty" title={hasFilters ? "No shipments match these filters" : "Your queue is ready for its first shipment"} description={hasFilters ? "Try another search, change the queue view, or reset your filters." : "Create a synthetic shipment, then add an Invoice, Packing List, and Bill of Lading."} action={<Button type="button" variant="outline" onClick={hasFilters ? clearFilters : () => setShowCreate(true)}>{hasFilters ? "Reset filters" : "New shipment"}</Button>} /> : <>
            <div className="hidden lg:block"><Table containerLabel="Shipment operations queue" className="min-w-[980px]"><TableHeader><TableRow><TableHead className="w-[24%]">Shipment / supplier</TableHead><TableHead>Status</TableHead><TableHead>Documents</TableHead><TableHead className="w-[18%]">Current revision review</TableHead><TableHead>Priority</TableHead><TableHead className="w-[23%]">Next action</TableHead></TableRow></TableHeader><TableBody>{rows.map((shipment) => { const priority = queuePriority(shipment); return <TableRow key={shipment.id}><TableCell><Link href={`/shipments/${shipment.id}`} className={`break-all rounded-small font-mono font-medium text-foreground hover:text-primary ${linkFocus}`}>{shipment.reference}</Link><p className="mt-1 text-sm text-foreground-secondary">{shipment.supplier?.name ?? "Supplier not assigned"}</p><p className="mt-1 text-xs text-muted-foreground">rev {shipment.currentRevision} · Updated {formatQueueDate(shipment.updatedAt)}</p></TableCell><TableCell><StatusBadge status={shipment.status} /></TableCell><TableCell><DocumentSummary shipment={shipment} /><p className="mt-1.5 text-xs text-muted-foreground">{shipment.documentSlots.presentCount}/3 uploaded</p></TableCell><TableCell><ReviewSummary shipment={shipment} /></TableCell><TableCell><Badge variant={priority.variant}>{priority.label}</Badge></TableCell><TableCell><NextAction shipment={shipment} /></TableCell></TableRow>; })}</TableBody></Table></div>
            <ul className="divide-y divide-border lg:hidden">{rows.map((shipment) => { const priority = queuePriority(shipment); return <li key={shipment.id} className="space-y-2 p-4 sm:space-y-3"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><Link href={`/shipments/${shipment.id}`} className={`break-all rounded-small font-mono text-sm font-semibold text-foreground hover:text-primary ${linkFocus}`}>{shipment.reference}</Link><p className="mt-1 text-sm text-foreground-secondary">{shipment.supplier?.name ?? "Supplier not assigned"}</p></div><StatusBadge status={shipment.status} /></div><div className="flex flex-wrap items-center justify-between gap-2"><DocumentSummary shipment={shipment} /><Badge variant={priority.variant}>{priority.label}</Badge></div><NextAction shipment={shipment} /><div className="flex flex-wrap items-end justify-between gap-2 border-t border-border pt-3"><ReviewSummary shipment={shipment} /><p className="text-xs text-muted-foreground">rev {shipment.currentRevision} · {formatQueueDate(shipment.updatedAt)}</p></div></li>; })}</ul>
          </>}
        </div>
        {!loading && !error && !invalidDates ? <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3"><p role="status" className="text-sm text-foreground-secondary">{visible.length === 0 ? "0 shipments" : `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, visible.length)} of ${visible.length} shipments`}</p><nav aria-label="Queue pagination" className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</Button><span className="text-xs text-muted-foreground">{currentPage} / {totalPages}</span><Button type="button" variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>Next</Button></nav></footer> : null}
      </section>
      <p className="flex items-start gap-2 text-xs text-muted-foreground"><CheckCircle2 aria-hidden="true" className="size-4 shrink-0" />Priorities use saved document, review, and check states. Final submission, approval, and export eligibility is verified by the server.</p>
    </div>
  </main>;
}
