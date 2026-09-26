import { useEffect, useRef } from "react";
import { AlertIcon } from "@/components/icons";

/**
 * Confirmation dialog for ending processes and changing services.
 * Deliberately plain and serious — no mascot, no playful copy: this is
 * where MoonTask must be at its most unambiguous, not its most charming.
 *
 * Uses the native <dialog> element for built-in modal semantics (focus
 * containment, Escape-to-close, backdrop) rather than a hand-rolled focus
 * trap. Enter confirms, Escape cancels.
 */
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  consequence: string;
  targetSummary: string;
  confirmLabel?: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  consequence,
  targetSummary,
  confirmLabel = "Yes, do it",
  busy,
  error,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      confirmButtonRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClose={() => {
        if (open) onCancel();
      }}
      className="m-auto overflow-visible bg-transparent p-0 text-(--mt-text) backdrop:bg-night-950/75 backdrop:backdrop-blur-sm"
    >
      <form
        method="dialog"
        className="mt-glass flex w-[min(90vw,32rem)] flex-col gap-4 border-error-500/40 bg-(--mt-solid) p-6"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm();
        }}
      >
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-error-500/15 text-(--mt-danger) ring-1 ring-error-500/40">
            <AlertIcon />
          </span>
          <h2 id="confirm-title" className="text-lg font-semibold">
            {title}
          </h2>
        </div>
        <p className="mt-inset max-h-48 overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-line text-(--mt-text-muted)">
          {targetSummary}
        </p>
        <p className="text-sm font-medium text-(--mt-danger)">{consequence}</p>

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-error-500/10 p-3 text-sm text-(--mt-danger) ring-1 ring-error-500/30"
          >
            {error}
          </p>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="mt-btn mt-btn-ghost">
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            type="submit"
            disabled={busy}
            className="mt-btn mt-btn-danger-solid"
          >
            {busy ? "Working …" : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
