"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  busy?: boolean;
  className?: string;
};

/** The owner handles mutations, error feedback, and closing after successful confirmation. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  busy = false,
  className,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      data-slot="confirm-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      aria-busy={busy || undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClose={(event) => {
        // Strict Mode can reopen the dialog before a cleanup's queued close event arrives.
        if (open && !event.currentTarget.open) onClose();
      }}
      className={cn(
        "fixed inset-0 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100vw_-_2rem)] max-w-lg overflow-y-auto rounded-dialog border-0 bg-surface p-0 text-foreground shadow-overlay backdrop:bg-foreground/35",
        className,
      )}
    >
      <div className="space-y-3 p-6">
        <h2 id={`${id}-title`} className="text-lg font-semibold">{title}</h2>
        {description ? <p id={`${id}-description`} className="text-sm text-foreground-secondary">{description}</p> : null}
        {children}
      </div>
      <div className="flex flex-wrap justify-end gap-3 border-t border-border px-6 py-4">
        <Button ref={cancelRef} type="button" variant="outline" disabled={busy} onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button type="button" variant={variant} loading={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
