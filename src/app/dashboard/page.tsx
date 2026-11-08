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
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-lg rounded-panel border border-border bg-surface p-8">
        <h1 className="text-2xl font-semibold text-foreground">Connect your workspace</h1>
        <p className="mt-3 text-sm leading-6 text-foreground-secondary">Copy <code>.env.example</code> to <code>.env</code> and add the Supabase URL and publishable key to enable sign-in.</p>
      </div>
    </main>
  );
}
