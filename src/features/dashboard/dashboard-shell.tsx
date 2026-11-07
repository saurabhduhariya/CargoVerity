"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  FileText,
  Filter,
  LogOut,
  Package,
  Plus,
  RefreshCw,
  ShipWheel,
  SlidersHorizontal,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocumentUpload } from "@/features/documents/document-upload";
import { EnrichedShipment } from "@/lib/shipments";
import { buildLoginPath } from "@/lib/auth-paths";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type DashboardStats = {
  totalShipments: number;
  highRiskReviewPending: number;
  awaitingManagerApproval: number;
  clearedOrExported: number;
};

export function DashboardShell({ email, role }: { email: string; role: "EXECUTIVE" | "MANAGER" }) {
  const [shipments, setShipments] = useState<EnrichedShipment[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);

  // New Shipment Form State
  const [reference, setReference] = useState("");
  const [importerName, setImporterName] = useState("");
  const [exporterName, setExporterName] = useState("");
  const [supplierName, setSupplierName] = useState("");

  // Filter & Search State (Rules 6 & 7)
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortOption, setSortOption] = useState<"risk" | "date_desc" | "date_asc">("risk");

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  /** Returns true when the response means the session is gone and the user was redirected. */
  const redirectOnAuthFailure = useCallback(
    (response: Response, data: { code?: string } | null) => {
      if (response.status === 401) {
        router.replace(buildLoginPath({ reason: "session-expired" }));
        return true;
      }
      if (response.status === 403 && data?.code === "ACCOUNT_NOT_PROVISIONED") {
        router.replace(buildLoginPath({ reason: "not-provisioned" }));
        return true;
      }
      return false;
    },
    [router],
  );

  const loadShipments = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (supplierFilter) params.set("supplierId", supplierFilter);
    if (fromDate) params.set("fromDate", fromDate);
    if (toDate) params.set("toDate", toDate);
    if (sortOption) params.set("sort", sortOption);

    try {
      const response = await fetch(`/api/shipments?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (redirectOnAuthFailure(response, data)) return;
      if (!response.ok) {
        setError(data.error ?? "Could not load shipments.");
      } else {
        setError(null);
        setShipments(data.shipments ?? []);
        if (data.stats) setStats(data.stats);
      }
    } catch {
      setError("Could not load shipments.");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, supplierFilter, fromDate, toDate, sortOption, redirectOnAuthFailure]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (supplierFilter) params.set("supplierId", supplierFilter);
    if (fromDate) params.set("fromDate", fromDate);
    if (toDate) params.set("toDate", toDate);
    if (sortOption) params.set("sort", sortOption);

    void fetch(`/api/shipments?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() }))
      .then(({ response, data }) => {
        if (!active) return;
        if (redirectOnAuthFailure(response, data)) return;
        if (!response.ok) {
          setError(data.error ?? "Could not load shipments.");
        } else {
          setShipments(data.shipments ?? []);
          if (data.stats) setStats(data.stats);
        }
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setError("Could not load shipments.");
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [search, statusFilter, supplierFilter, fromDate, toDate, sortOption, redirectOnAuthFailure]);

  async function createShipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const response = await fetch("/api/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference,
          importerName,
          exporterName,
          supplierName,
        }),
      });
      const data = await response.json();
      if (redirectOnAuthFailure(response, data)) return;
      if (!response.ok) {
        setError(data.error ?? "Could not create shipment.");
      } else {
        setReference("");
        setImporterName("");
        setExporterName("");
        setSupplierName("");
        router.push(`/shipments/${data.shipment.id}`);
      }
    } catch {
      setError("Network error creating shipment.");
    }
  }

  async function signOut() {
    await getSupabaseBrowserClient().auth.signOut();
    router.push("/");
    router.refresh();
  }

  function clearFilters() {
    setSearch("");
    setStatusFilter("");
    setSupplierFilter("");
    setFromDate("");
    setToDate("");
    setSortOption("risk");
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 pb-12">
      {/* Top App Header */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-20">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">
              CargoVerity
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Customs Clearance Workbench · {email} ·{" "}
              <span data-testid="current-role">{role === "MANAGER" ? "Manager" : "Executive"}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/reports"
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              <BarChart3 className="size-3.5 text-indigo-600" />
              Accuracy & Supplier Reports
            </Link>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="size-4" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {/* Title & Workbench Description */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
              Shipment Status & Action Queue
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Review document slots, cross-check discrepancies, and take next actions from draft to customs export.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadShipments()}
            disabled={loading}
            className="text-xs"
          >
            <RefreshCw
              className={`size-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`}
            />
            Refresh Queue
          </Button>
        </div>

        {error ? (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 flex items-center gap-2"
          >
            <AlertCircle className="size-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        ) : null}

        {/* Rule 9: Real stored operational KPIs (Never fabricate metrics) */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-slate-200 bg-white">
              <CardHeader className="py-3 px-4 border-b border-slate-100 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Total Shipments
                </CardTitle>
                <Package className="size-4 text-slate-400" />
              </CardHeader>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-slate-900">
                  {stats.totalShipments}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Accessible shipment records
                </p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white">
              <CardHeader className="py-3 px-4 border-b border-slate-100 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  High-Risk Review
                </CardTitle>
                <AlertTriangle className="size-4 text-rose-600" />
              </CardHeader>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-rose-700">
                  {stats.highRiskReviewPending}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Blocking discrepancies & uncertain fields
                </p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white">
              <CardHeader className="py-3 px-4 border-b border-slate-100 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Pending Manager Approval
                </CardTitle>
                <Clock className="size-4 text-amber-600" />
              </CardHeader>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-amber-700">
                  {stats.awaitingManagerApproval}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Awaiting sign-off decision
                </p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white">
              <CardHeader className="py-3 px-4 border-b border-slate-100 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Approved / Exported
                </CardTitle>
                <CheckCircle2 className="size-4 text-emerald-600" />
              </CardHeader>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-emerald-700">
                  {stats.clearedOrExported}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Cleared for customs or exported
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Action Panel: Create New Shipment & Shipment Queue */}
        <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          {/* Create New Shipment Card */}
          <Card className="border-slate-200 bg-white">
            <CardHeader className="border-b border-slate-100 p-4">
              <CardTitle className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <Plus className="size-4 text-blue-700" /> New Synthetic Shipment
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <form className="space-y-4" onSubmit={createShipment}>
                <div className="space-y-1.5">
                  <Label htmlFor="reference" className="text-xs font-semibold">
                    Shipment Reference *
                  </Label>
                  <Input
                    id="reference"
                    placeholder="SHP-2026-DEMO-01"
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    required
                    className="text-xs font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="supplier" className="text-xs font-semibold">
                    Supplier Name
                  </Label>
                  <Input
                    id="supplier"
                    placeholder="Apex Global Supplies Ltd"
                    value={supplierName}
                    onChange={(event) => setSupplierName(event.target.value)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="importer" className="text-xs font-semibold">
                    Importer Name
                  </Label>
                  <Input
                    id="importer"
                    placeholder="Target Customs Logistics Inc"
                    value={importerName}
                    onChange={(event) => setImporterName(event.target.value)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="exporter" className="text-xs font-semibold">
                    Exporter Name
                  </Label>
                  <Input
                    id="exporter"
                    placeholder="Global Tech Exports GmbH"
                    value={exporterName}
                    onChange={(event) => setExporterName(event.target.value)}
                    className="text-xs"
                  />
                </div>
                <Button type="submit" className="w-full text-xs font-semibold">
                  <ShipWheel className="size-4 mr-1.5" /> Create Shipment
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Shipment Queue Card */}
          <Card className="border-slate-200 bg-white shadow-xs">
            <CardHeader className="border-b border-slate-100 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <SlidersHorizontal className="size-4 text-slate-600" />
                  Shipment Queue ({shipments.length})
                </CardTitle>
                <span className="text-[11px] text-slate-400">
                  Sorted by: {sortOption === "risk" ? "High-Risk First" : sortOption === "date_desc" ? "Newest First" : "Oldest First"}
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              {/* Rules 6 & 7: Search and Filter Controls */}
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                <div className="sm:col-span-2 lg:col-span-1">
                  <Input
                    aria-label="Search shipments"
                    placeholder="Search reference or supplier..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="text-xs h-9"
                  />
                </div>
                <div>
                  <select
                    aria-label="Filter shipment status"
                    className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-700"
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                  >
                    <option value="">All Statuses</option>
                    <option value="DRAFT">Draft</option>
                    <option value="NEEDS_REVIEW">Needs Review</option>
                    <option value="READY_FOR_APPROVAL">Ready for Approval</option>
                    <option value="APPROVED">Approved</option>
                    <option value="EXPORTED">Exported</option>
                  </select>
                </div>
                <div>
                  <select
                    aria-label="Filter supplier"
                    className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-700 truncate"
                    value={supplierFilter}
                    onChange={(event) => setSupplierFilter(event.target.value)}
                  >
                    <option value="">All Suppliers</option>
                    {Array.from(
                      new Map(
                        shipments
                          .filter((s) => s.supplier)
                          .map((s) => [s.supplier!.id, s.supplier!.name]),
                      ).entries(),
                    ).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Date Filters & Sort Control (Rule 7 & 8) */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 border-t border-slate-100 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5 text-slate-500">
                    <Calendar className="size-3.5" />
                    <span>From:</span>
                    <input
                      type="date"
                      aria-label="Filter from date"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-500">
                    <span>To:</span>
                    <input
                      type="date"
                      aria-label="Filter to date"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                      className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 text-slate-500">
                    <Filter className="size-3.5" />
                    <span>Sort:</span>
                    <select
                      aria-label="Sort shipments"
                      value={sortOption}
                      onChange={(e) =>
                        setSortOption(
                          e.target.value as "risk" | "date_desc" | "date_asc",
                        )
                      }
                      className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 font-medium"
                    >
                      <option value="risk">High-Risk Review First</option>
                      <option value="date_desc">Newest First</option>
                      <option value="date_asc">Oldest First</option>
                    </select>
                  </div>
                  {(search || statusFilter || supplierFilter || fromDate || toDate || sortOption !== "risk") && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="text-[11px] font-semibold text-blue-600 hover:text-blue-800"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              {/* Shipments List */}
              {loading ? (
                <div className="py-12 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                  <RefreshCw className="size-5 animate-spin text-slate-400" />
                  <span>Loading shipment queue...</span>
                </div>
              ) : shipments.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  No shipments matching current filters. Try resetting filters or create a new shipment.
                </div>
              ) : (
                <div className="space-y-3">
                  {shipments.map((s) => {
                    const isHighRisk = s.riskScore >= 80;

                    return (
                      <div
                        key={s.id}
                        className={`rounded-xl border p-4 transition ${
                          isHighRisk
                            ? "border-amber-200 bg-amber-50/20 hover:border-amber-300"
                            : "border-slate-200 bg-white hover:border-slate-300"
                        }`}
                      >
                        {/* Row 1: Reference, Supplier, Status, Revision, Risk (Rule 1 & 4) */}
                        <div className="flex flex-wrap items-center justify-between gap-2.5">
                          <div>
                            <div className="flex items-center gap-2">
                              <Link
                                className="font-mono text-sm font-bold text-slate-900 hover:text-blue-700"
                                href={`/shipments/${s.id}`}
                              >
                                {s.reference}
                              </Link>
                              <Badge className="text-[10px] bg-slate-100 border border-slate-200 text-slate-700">
                                rev {s.currentRevision}
                              </Badge>
                              {isHighRisk && (
                                <Badge className="text-[10px] bg-rose-100 border border-rose-200 text-rose-800 font-semibold">
                                  High Risk
                                </Badge>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-slate-500">
                              Supplier:{" "}
                              <strong className="text-slate-700">
                                {s.supplier?.name ?? "Supplier pending"}
                              </strong>{" "}
                              · Importer:{" "}
                              <span className="text-slate-600">
                                {s.importerName ?? "Not assigned"}
                              </span>
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <Badge
                              className={`text-xs ${
                                s.status === "APPROVED"
                                  ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                                  : s.status === "EXPORTED"
                                    ? "bg-blue-100 text-blue-800 border-blue-300"
                                    : s.status === "READY_FOR_APPROVAL"
                                      ? "bg-purple-100 text-purple-800 border-purple-300"
                                      : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {s.status.replaceAll("_", " ")}
                            </Badge>
                          </div>
                        </div>

                        {/* Row 2: Document Slots (Rule 2) & Checks Summary (Rule 3) */}
                        <div className="mt-3.5 grid gap-3 sm:grid-cols-2 pt-3 border-t border-slate-100 text-xs">
                          {/* Rule 2: CI / PL / BL Document Slots Presence & Extraction */}
                          <div className="space-y-1.5">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                              Required Document Slots
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {/* CI Slot */}
                              <div
                                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium border ${
                                  s.documentSlots.invoice.present
                                    ? "bg-slate-50 text-slate-800 border-slate-200"
                                    : "bg-rose-50 text-rose-700 border-rose-200"
                                }`}
                              >
                                <FileText className="size-3 text-slate-500" />
                                <span>CI:</span>
                                <span>
                                  {s.documentSlots.invoice.present
                                    ? s.documentSlots.invoice.status?.toLowerCase() ?? "present"
                                    : "Missing"}
                                </span>
                              </div>

                              {/* PL Slot */}
                              <div
                                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium border ${
                                  s.documentSlots.packingList.present
                                    ? "bg-slate-50 text-slate-800 border-slate-200"
                                    : "bg-rose-50 text-rose-700 border-rose-200"
                                }`}
                              >
                                <FileSpreadsheet className="size-3 text-slate-500" />
                                <span>PL:</span>
                                <span>
                                  {s.documentSlots.packingList.present
                                    ? s.documentSlots.packingList.status?.toLowerCase() ?? "present"
                                    : "Missing"}
                                </span>
                              </div>

                              {/* BL Slot */}
                              <div
                                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium border ${
                                  s.documentSlots.billOfLading.present
                                    ? "bg-slate-50 text-slate-800 border-slate-200"
                                    : "bg-rose-50 text-rose-700 border-rose-200"
                                }`}
                              >
                                <Package className="size-3 text-slate-500" />
                                <span>BL:</span>
                                <span>
                                  {s.documentSlots.billOfLading.present
                                    ? s.documentSlots.billOfLading.status?.toLowerCase() ?? "present"
                                    : "Missing"}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Rule 3: Cross-Checks Summary for Current Revision */}
                          <div className="space-y-1.5">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                              Revision Cross-Checks
                            </span>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {s.checksSummary.total === 0 ? (
                                <span className="text-slate-400 italic text-[11px]">
                                  No checks recorded for rev {s.currentRevision}
                                </span>
                              ) : (
                                <>
                                  <Badge className="text-[10px] bg-emerald-50 text-emerald-800 border-emerald-200">
                                    {s.checksSummary.passed} Passed
                                  </Badge>
                                  {s.checksSummary.blockingUnresolved > 0 ? (
                                    <Badge className="text-[10px] bg-rose-100 text-rose-900 border-rose-300 font-bold">
                                      {s.checksSummary.blockingUnresolved} Mismatch
                                    </Badge>
                                  ) : s.checksSummary.resolved > 0 ? (
                                    <Badge className="text-[10px] bg-blue-50 text-blue-800 border-blue-200">
                                      {s.checksSummary.resolved} Resolved
                                    </Badge>
                                  ) : null}
                                  {s.checksSummary.incomplete > 0 && (
                                    <Badge className="text-[10px] bg-amber-50 text-amber-800 border-amber-200">
                                      {s.checksSummary.incomplete} Incomplete
                                    </Badge>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Row 3: Next Action CTA (Rule 5) */}
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
                          <p className="text-[11px] text-slate-500">
                            {s.nextAction.description}
                          </p>

                          <div className="flex items-center gap-2">
                            <Link
                              href={`/shipments/${s.id}`}
                              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                            >
                              Documents
                            </Link>

                            <Link
                              href={s.nextAction.href}
                              className={`flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-semibold text-white shadow-xs transition ${
                                s.nextAction.type === "approve"
                                  ? "bg-purple-600 hover:bg-purple-700"
                                  : s.nextAction.type === "export"
                                    ? "bg-emerald-600 hover:bg-emerald-700"
                                    : s.nextAction.type === "resolve"
                                      ? "bg-rose-600 hover:bg-rose-700"
                                      : s.nextAction.type === "submit"
                                        ? "bg-indigo-600 hover:bg-indigo-700"
                                        : "bg-blue-600 hover:bg-blue-700"
                              }`}
                            >
                              {s.nextAction.label}
                              <ArrowRight className="size-3" />
                            </Link>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Existing Document Upload Section */}
        {shipments.length > 0 ? (
          <DocumentUpload
            shipments={shipments.map(({ id, reference }) => ({
              id,
              reference,
            }))}
          />
        ) : null}
      </div>
    </main>
  );
}
