export default function Home() {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-slate-50 px-6 py-16">
      <section className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-10 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">
          CargoVerity
        </p>
        <h1 className="mt-5 max-w-2xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
          Every document. Every detail. Verified.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
          The application foundation is ready for the shipment, extraction and
          review workflow.
        </p>
        <div className="mt-8 grid gap-3 text-sm text-slate-700 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="font-semibold text-slate-950">Next.js</p>
            <p className="mt-1">App Router foundation</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="font-semibold text-slate-950">TypeScript</p>
            <p className="mt-1">Strict application baseline</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="font-semibold text-slate-950">Node 24</p>
            <p className="mt-1">Pinned runtime contract</p>
          </div>
        </div>
      </section>
    </main>
  );
}
