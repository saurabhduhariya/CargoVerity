import { Suspense } from "react";
import Link from "next/link";
import { Brand } from "@/components/brand";

import { LoginForm } from "@/features/auth/login-form";
import { parseLoginReason, safeNextPath } from "@/lib/auth-paths";

type LoginSearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default function LoginPage({ searchParams }: { searchParams: LoginSearchParams }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="px-6 sm:px-8"><Link href="/" aria-label="CargoVerity home" className="inline-flex min-h-18 items-center rounded-control"><Brand /></Link></header>
      <main className="flex flex-1 items-start justify-center px-6 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-[400px] rounded-dialog border border-border bg-surface p-6 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-heading">Sign in</h1>
          <p className="mt-2 text-sm text-foreground-secondary">Documentation executives and managers.</p>
          {/* The static shell (and a usable form) prerenders; the reason/next query streams in. */}
          <Suspense fallback={<LoginForm />}>
            <LoginFormWithQuery searchParams={searchParams} />
          </Suspense>
        </div>
      </main>
      <footer className="px-6 py-6 text-center text-xs text-muted-foreground">Synthetic-data demo</footer>
    </div>
  );
}

async function LoginFormWithQuery({ searchParams }: { searchParams: LoginSearchParams }) {
  const query = await searchParams;
  return <LoginForm reason={parseLoginReason(query.reason)} nextPath={safeNextPath(query.next)} />;
}
