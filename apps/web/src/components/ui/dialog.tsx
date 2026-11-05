import { X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A modal dialog. Controlled with `open`/`onOpenChange`, or pass a `trigger` to let it manage
 * itself. `footer` is pinned to the bottom so long content scrolls on its own.
 */
export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const width = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" }[size];
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <RadixDialog.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[min(90vh,56rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-surface shadow-2xl focus:outline-none",
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <RadixDialog.Title className="text-base font-semibold text-fg">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-0.5 text-sm text-muted">
                  {description}
                </RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-fg"
              aria-label="Close"
            >
              <X className="size-4" />
            </RadixDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
              {footer}
            </div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const DialogClose = RadixDialog.Close;
