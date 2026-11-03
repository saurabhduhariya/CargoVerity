import Link from "next/link";

import { ReviewPanel } from "@/features/review/review-panel";

export const instant = false;

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main className="min-h-screen bg-slate-50 px-6 py-8"><div className="mx-auto max-w-5xl"><Link className="text-sm font-medium text-blue-700" href="/dashboard">← Back to dashboard</Link><h1 className="mt-5 text-3xl font-semibold tracking-tight text-slate-950">Evidence review</h1><p className="mt-2 text-slate-600">Confirm or correct extracted values before a manager can approve an export.</p><div className="mt-8"><ReviewPanel documentId={id} /></div></div></main>;
}
