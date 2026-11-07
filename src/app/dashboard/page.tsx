import { connection } from "next/server";

import { DashboardShell } from "@/features/dashboard/dashboard-shell";
import { requirePageAppUser } from "@/lib/auth-page";
import { getSupabaseBrowserConfig } from "@/lib/supabase/browser-config";

export const instant = false;

export default async function DashboardPage() {
  // Supabase session validation is request-time work and may read the current time.
  await connection();

  if (!getSupabaseBrowserConfig()) {
    return <SetupRequired />;
  }

  const { appUser } = await requirePageAppUser("/dashboard");

  return <DashboardShell email={appUser.email} role={appUser.role} />;
}

function SetupRequired() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="max-w-lg rounded-2xl border border-amber-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">Setup required</p>
        <h1 className="mt-4 text-2xl font-semibold text-slate-950">Configure Supabase before signing in</h1>
        <p className="mt-3 text-slate-600">Copy <code>.env.example</code> to <code>.env</code> and add the browser-safe Supabase URL and anon/publishable key. The service-role key remains server-only.</p>
      </div>
    </main>
  );
}
