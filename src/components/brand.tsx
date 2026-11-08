import { cn } from "@/lib/utils";

/** Three documents, read as one: three ruled lines that agree, with a single check. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-control bg-primary text-primary-foreground", className)}>
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5.5h8M4 10h8M4 14.5h5" strokeWidth="1.6" />
        <path d="m12 14.25 1.6 1.6L16.5 13" strokeWidth="1.6" />
      </svg>
    </span>
  );
}

export function Brand() {
  return <span className="inline-flex items-center gap-2"><BrandMark /><span className="text-[15px] font-semibold tracking-heading text-foreground">CargoVerity</span></span>;
}
