import { type ReactNode, useState } from "react";
import { ApiErrorAlert } from "./ApiErrorAlert";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Field } from "./ui/form";

/**
 * Confirmation dialog. With `confirmText`, the user must type it to enable the button, like the
 * console's "type the name to delete" prompts.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel = "Delete",
  confirmText,
  danger = true,
  onConfirm,
  pending,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
  pending?: boolean;
  error?: unknown;
}) {
  const [typed, setTyped] = useState("");
  const ready = !confirmText || typed === confirmText;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setTyped("");
        onOpenChange(o);
      }}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={!ready || pending}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-fg">
        {children}
        {confirmText && (
          <Field
            label={`To confirm, type “${confirmText}”`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
        )}
        <ApiErrorAlert error={error} />
      </div>
    </Dialog>
  );
}
