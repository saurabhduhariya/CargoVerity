import { LoginForm } from "@/features/auth/login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-md">
        <p className="text-center text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">CargoVerity</p>
        <h1 className="mt-4 text-center text-3xl font-semibold text-slate-950">Sign in to the workbench</h1>
        <p className="mt-3 text-center text-sm text-slate-600">Use the Supabase Auth account configured for this demo.</p>
        <LoginForm />
      </div>
    </main>
  );
}
