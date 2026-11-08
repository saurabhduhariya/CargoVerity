"use client";

import { FormEvent, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FOCUS_RING_STYLES } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import type { LoginReason } from "@/lib/auth-paths";
import { describeAuthError, LOGIN_REASON_MESSAGES as REASON_MESSAGES } from "@/lib/auth-messages";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export function LoginForm({
  reason = null,
  nextPath = null,
}: {
  reason?: LoginReason | null;
  nextPath?: string | null;
}) {
  // The streamed query form and its hidden fallback can coexist in the DOM.
  const formId = useId();
  const emailId = `${formId}-email`;
  const passwordId = `${formId}-password`;
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(reason ? REASON_MESSAGES[reason] : null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const result = mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });

      if (result.error) throw result.error;
      if (mode === "sign-up") {
        setMessage(
          "Account created. Confirm your email if asked; an administrator must then assign a CargoVerity role before you can use the workbench.",
        );
      } else {
        router.push(nextPath ?? "/dashboard");
        router.refresh();
      }
    } catch (error) {
      setMessage(describeAuthError(error, mode));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-7">
        {mode === "sign-up" ? <h2 className="mb-5 text-base font-semibold">Create an account</h2> : null}
        <form className="space-y-4" aria-busy={busy} onSubmit={submit}>
          <div className="space-y-2"><Label htmlFor={emailId}>Email</Label><Input id={emailId} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} required /></div>
          <div className="space-y-2"><Label htmlFor={passwordId}>Password</Label><div className="relative"><Input id={passwordId} type={showPassword ? "text" : "password"} className="pr-12" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} required /><button type="button" disabled={busy} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-control text-muted-foreground hover:text-foreground" onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}</button></div></div>
          {message ? <p role="alert" data-testid="login-message" className="rounded-control border border-warning-border bg-warning-surface p-3 text-sm text-warning">{message}</p> : null}
          <Button className="!mt-6 w-full" type="submit" loading={busy}>{busy ? (mode === "sign-in" ? "Signing in…" : "Creating account…") : mode === "sign-in" ? "Sign in" : "Create account"}</Button>
        </form>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 border-t border-border pt-3">
        <Button className="h-auto min-h-11 px-0 py-2 text-foreground-secondary hover:text-foreground" variant="ghost" type="button" disabled={busy} onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setMessage(null); }}>
          {mode === "sign-in" ? "Need an account? Create one" : "Already have an account? Sign in"}
        </Button>
        <Link className={cn("flex min-h-11 items-center rounded-control text-sm text-foreground-secondary hover:text-foreground", FOCUS_RING_STYLES)} href="/">Return home</Link>
        </div>
    </div>
  );
}
