"use client";

import { useRef, useState } from "react";
import { FileCheck2, Upload } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";

type DocumentDropzoneProps = {
  id: string;
  title: string;
  file: File | null;
  disabled: boolean;
  invalid: boolean;
  describedBy: string;
  onSelect: (file: File | null) => void;
  onError: (message: string) => void;
};

export function DocumentDropzone({ id, title, file, disabled, invalid, describedBy, onSelect, onError }: DocumentDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  return <div
    className={cn("relative rounded-panel border border-dashed transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring", dragging && !disabled ? "border-foreground bg-selected" : file ? "border-border-strong bg-background" : "border-control-border bg-background hover:bg-surface-subtle", invalid && "border-danger", disabled && "bg-disabled text-disabled-foreground")}
    onDragEnter={(event) => { event.preventDefault(); if (!disabled) { depth.current++; setDragging(true); } }}
    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? "none" : "copy"; }}
    onDragLeave={(event) => { event.preventDefault(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
    onDrop={(event) => {
      event.preventDefault(); depth.current = 0; setDragging(false);
      if (disabled) return;
      if (event.dataTransfer.files.length !== 1) { onError("Choose one document for this slot."); return; }
      onSelect(event.dataTransfer.files[0]);
    }}
  >
    <input id={id} type="file" className="sr-only" accept="application/pdf,image/png,image/jpeg" disabled={disabled} aria-label={title} aria-invalid={invalid || undefined} aria-describedby={describedBy} onChange={(event) => onSelect(event.target.files?.[0] ?? null)} />
    <label htmlFor={id} className={cn("flex min-h-32 flex-col items-center justify-center gap-3 p-5 text-center", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
      {file ? <FileCheck2 aria-hidden="true" className="size-6 text-primary" strokeWidth={1.5} /> : <Upload aria-hidden="true" className="size-6 text-muted-foreground" strokeWidth={1.5} />}
      <span className="min-w-0 max-w-full break-words text-sm font-medium">{file ? file.name : "Drop a document here"}</span>
      <span className="text-sm text-foreground-secondary">{file ? `${formatBytes(file.size)} · Choose another file` : <>or <span className="font-medium text-foreground underline decoration-border-strong underline-offset-4">browse files</span></>}</span>
    </label>
  </div>;
}
