"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  FileSpreadsheet,
  Info,
  Layers,
  RefreshCw,
  Scale,
  Sparkles,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccuracyReport } from "@/lib/reports/accuracy";

export function AccuracyReportView({
  initialReport,
}: {
  initialReport?: AccuracyReport;
}) {
  const [report, setReport] = useState<AccuracyReport | null>(
    initialReport ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"fields" | "suppliers">("fields");

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/accuracy", { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to load accuracy report.");
      }
      const data = (await res.json()) as AccuracyReport;
      setReport(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load accuracy report.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-20">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition"
            >
              <ArrowLeft className="size-4" />
              Workbench
            </Link>
            <div className="h-4 w-px bg-slate-200" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-slate-950">
                  Extraction Accuracy & Supplier Reports
                </h1>
                <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-xs">
                  Week 5 Step 6
                </Badge>
              </div>
              <p className="text-xs text-slate-500">
                Verified extraction metrics, reviewer correction rates, and supplier profiles
              </p>
            </div>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadReport()}
            disabled={loading}
            className="text-xs"
          >
            <RefreshCw
              className={`size-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`}
            />
            {loading ? "Calculating..." : "Refresh Report"}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        {/* Rule 11: Distinguish synthetic demo data from labelled benchmark */}
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Sparkles className="size-5 text-amber-600 shrink-0" />
              <div>
                <span className="font-bold text-xs uppercase tracking-wider text-amber-900 block">
                  Dataset Classification
                </span>
                <span className="text-xs text-amber-800">
                  {report?.dataset.label ??
                    "Synthetic Demo Dataset (Development & Demonstration Set)"}
                </span>
              </div>
            </div>
            <Badge className="bg-amber-200 text-amber-950 border-amber-300 font-mono text-[11px] px-2.5 py-1">
              {report?.dataset.watermark ??
                "SYNTHETIC DEMO DATA — NOT CLIENT PRODUCTION BENCHMARK"}
            </Badge>
          </div>
        </div>

        {/* Rule 12: Do not claim 95% target without client 200-shipment set */}
        <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
          <div className="flex items-start gap-3">
            <Info className="size-5 text-blue-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="text-xs font-bold uppercase tracking-wider text-blue-900">
                Benchmark Integrity Notice
              </h3>
              <p className="text-xs text-blue-800 leading-relaxed">
                {report?.benchmarkTarget.disclaimer ??
                  "The 95% extraction accuracy target is a client benchmark KPI that can only be claimed against the official 200-shipment labelled evaluation set. Current metrics represent real evaluated synthetic demo shipments without fabrication."}
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Summary Metric Cards */}
        {report && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Overall Accuracy */}
            <Card className="border-slate-200 bg-white">
              <CardHeader className="py-3 px-4 border-b border-slate-100 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  AI Accuracy
                </CardTitle>
                <CheckCircle2 className="size-4 text-emerald-600" />
              </CardHeader>
              <CardContent className="p-4 space-y-1">
                <div className="text-2xl font-bold text-slate-900">
                  {report.summary.accuracy.formattedPercentage}
                </div>
                {/* Rule 10: Numerator, denominator & sample size */}
                <p className="text-xs font-medium text-slate-600">
                  {report.summary.accuracy.numerator} /{" "}
                  {report.summary.accuracy.denominator} evaluated
                </p>
                <p className="text-[11px] text-slate-400 font-mono">
                  sample size n = {report.summary.accuracy.sampleSize}
                </p>
              </CardContent>
            </Card>

            {/* Correction Rate */}
            <Card className="border-slate-200 bg-white">
              <CardHeader className="py-3 px-4 border-b border-slate-100 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Correction Rate
                </CardTitle>
                <Scale className="size-4 text-amber-600" />
              </CardHeader>
              <CardContent className="p-4 space-y-1">
                <div className="text-2xl font-bold text-slate-900">
                  {report.summary.correctionRate.formattedPercentage}
                </div>
                {/* Rule 10: Numerator, denominator & sample size */}
                <p className="text-xs font-medium text-slate-600">
                  {report.summary.correctionRate.numerator} /{" "}
                  {report.summary.correctionRate.denominator} corrected
                </p>
                <p className="text-[11px] text-slate-400 font-mono">
                  sample size n = {report.summary.correctionRate.sampleSize}
                </p>
              </CardContent>
            </Card>

            {/* Evaluated Fields (Rule 1) */}
            <Card className="border-slate-200 bg-white">
              <CardHeader className="py-3 px-4 border-b border-slate-100 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Evaluated Fields
                </CardTitle>
                <BarChart3 className="size-4 text-indigo-600" />
              </CardHeader>
              <CardContent className="p-4 space-y-1">
                <div className="text-2xl font-bold text-slate-900">
                  {report.summary.evaluated}
                </div>
                <p className="text-xs text-slate-600">
                  AI present & human-reviewed
                </p>
                <p className="text-[11px] text-slate-400">
                  Active in accuracy denominator
                </p>
              </CardContent>
            </Card>

            {/* Manual Entries (Rule 6) */}
            <Card className="border-slate-200 bg-white">
              <CardHeader className="py-3 px-4 border-b border-slate-100 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Manual Entries
                </CardTitle>
                <FileSpreadsheet className="size-4 text-slate-600" />
              </CardHeader>
              <CardContent className="p-4 space-y-1">
                <div className="text-2xl font-bold text-slate-900">
                  {report.summary.manualEntries}
                </div>
                <p className="text-xs text-slate-600">
                  Keyed from blank model value
                </p>
                <p className="text-[11px] text-slate-400">
                  Excluded from AI extraction
                </p>
              </CardContent>
            </Card>

            {/* Unreviewed Fields (Rule 7) */}
            <Card className="border-slate-200 bg-white">
              <CardHeader className="py-3 px-4 border-b border-slate-100 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Unreviewed Fields
                </CardTitle>
                <Layers className="size-4 text-slate-400" />
              </CardHeader>
              <CardContent className="p-4 space-y-1">
                <div className="text-2xl font-bold text-slate-900">
                  {report.summary.unreviewed}
                </div>
                <p className="text-xs text-slate-600">
                  Pending reviewer evaluation
                </p>
                <p className="text-[11px] text-slate-400">
                  Excluded from denominator
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Detailed Breakdown Tabs */}
        {report && (
          <Card className="border-slate-200 bg-white shadow-xs">
            <CardHeader className="border-b border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab("fields")}
                    className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      activeTab === "fields"
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    <BarChart3 className="size-3.5" />
                    Accuracy by Field ({report.byFieldKey.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("suppliers")}
                    className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      activeTab === "suppliers"
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    <Users className="size-3.5" />
                    Accuracy by Supplier ({report.bySupplier.length})
                  </button>
                </div>
                <span className="text-xs text-slate-500">
                  Total Observations: {report.summary.totalFields} fields
                </span>
              </div>
            </CardHeader>

            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3 px-4">
                      {activeTab === "fields" ? "Field Name" : "Supplier Name"}
                    </th>
                    <th className="py-3 px-3 text-right">Total</th>
                    <th className="py-3 px-3 text-right">Evaluated</th>
                    <th className="py-3 px-3 text-right">Correct</th>
                    <th className="py-3 px-3 text-right">Corrected</th>
                    <th className="py-3 px-3 text-right">Manual</th>
                    <th className="py-3 px-3 text-right">Unreviewed</th>
                    <th className="py-3 px-4 text-right">
                      Accuracy % (Ratio & N)
                    </th>
                    <th className="py-3 px-4 text-right">
                      Correction Rate (Ratio & N)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(activeTab === "fields" ? report.byFieldKey : report.bySupplier)
                    .length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="py-8 text-center text-slate-400 italic"
                      >
                        No extracted fields available in the current dataset.
                      </td>
                    </tr>
                  ) : (
                    (activeTab === "fields"
                      ? report.byFieldKey
                      : report.bySupplier
                    ).map((group) => (
                      <tr
                        key={group.groupKey}
                        className="hover:bg-slate-50/70 transition"
                      >
                        <td className="py-2.5 px-4 font-medium text-slate-900">
                          {group.groupLabel}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-600 font-mono">
                          {group.totalFields}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-900 font-semibold font-mono">
                          {group.evaluated}
                        </td>
                        <td className="py-2.5 px-3 text-right text-emerald-700 font-mono">
                          {group.correctAsExtracted}
                        </td>
                        <td className="py-2.5 px-3 text-right text-amber-700 font-mono">
                          {group.corrected}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-500 font-mono">
                          {group.manualEntries}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-400 font-mono">
                          {group.unreviewed}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <span className="font-bold text-slate-900">
                            {group.accuracy.formattedPercentage}
                          </span>
                          <span className="text-[10px] text-slate-500 block font-mono">
                            ({group.accuracy.numerator}/{group.accuracy.denominator}, n={group.accuracy.sampleSize})
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <span className="font-medium text-slate-700">
                            {group.correctionRate.formattedPercentage}
                          </span>
                          <span className="text-[10px] text-slate-500 block font-mono">
                            ({group.correctionRate.numerator}/{group.correctionRate.denominator}, n={group.correctionRate.sampleSize})
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
