import { Brand } from "@/components/brand";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route loading states. They render the moment a link is clicked (they are part of the
 * prefetched route shell), so the screen changes immediately while the server loads data.
 */

function HeaderSkeleton() {
  return (
    <header className="shrink-0 border-b border-border bg-surface">
      <div className="mx-auto flex min-h-14 max-w-[1440px] items-center gap-8 px-4 sm:px-6 lg:px-8">
        <Brand />
        <div className="hidden gap-5 sm:flex"><Skeleton className="h-4 w-20" /><Skeleton className="h-4 w-20" /></div>
        <Skeleton className="ml-auto size-7 rounded-full" />
      </div>
    </header>
  );
}

export function AppPageSkeleton({ label, variant = "list" }: { label: string; variant?: "list" | "detail" }) {
  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <HeaderSkeleton />
      <main role="status" aria-live="polite" aria-busy="true" className="mx-auto max-w-[1440px] space-y-6 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <span className="sr-only">{label}</span>
        <div className="space-y-3">
          {variant === "detail" ? <Skeleton className="h-4 w-24" /> : null}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-2"><Skeleton className="h-7 w-64" /><Skeleton className="h-5 w-32" /></div>
            <Skeleton className="h-10 w-36" />
          </div>
        </div>
        {variant === "detail" ? (
          <div className="grid gap-4 lg:grid-cols-3">
            {[0, 1, 2].map((item) => <Skeleton key={item} className="h-56 rounded-panel" />)}
          </div>
        ) : (
          <div className="overflow-hidden rounded-panel border border-border bg-surface">
            {[0, 1, 2, 3, 4, 5].map((item) => (
              <div key={item} className="flex items-center gap-6 border-b border-border px-4 py-4 last:border-b-0">
                <Skeleton className="h-4 w-40" /><Skeleton className="hidden h-4 w-28 sm:block" /><Skeleton className="hidden h-4 w-24 md:block" /><Skeleton className="ml-auto h-4 w-24" />
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export function ReviewWorkspaceSkeleton() {
  return (
    <div className="flex h-dvh min-h-[560px] w-full flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border bg-surface px-3 sm:px-5">
        <div className="flex min-h-14 items-center gap-3 py-2">
          <Skeleton className="size-9" />
          <div className="space-y-1.5"><Skeleton className="h-4 w-48" /><Skeleton className="hidden h-3 w-32 sm:block" /></div>
          <div className="ml-auto flex gap-2"><Skeleton className="h-8 w-32" /><Skeleton className="h-8 w-36" /></div>
        </div>
      </header>
      <main role="status" aria-live="polite" aria-busy="true" className="flex min-h-0 flex-1 flex-col gap-2.5 px-2 py-2.5 sm:px-4 lg:px-5">
        <span className="sr-only">Loading review workspace</span>
        <Skeleton className="h-9 w-full max-w-md" />
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(390px,0.7fr)]">
          <div className="hidden min-h-0 rounded-panel border border-border bg-viewer-background lg:block" />
          <div className="min-h-0 space-y-4 rounded-panel border border-border bg-surface p-4">
            <Skeleton className="h-8 w-56" />
            {[0, 1, 2, 3, 4].map((item) => <div key={item} className="space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-10 w-full" /></div>)}
          </div>
        </div>
      </main>
    </div>
  );
}
