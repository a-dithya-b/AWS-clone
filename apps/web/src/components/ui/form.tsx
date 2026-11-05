import { type ComponentProps, type ReactNode, useId } from "react";
import { cn } from "@/lib/cn";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg shadow-xs placeholder:text-muted/70 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  // biome-ignore lint/a11y/noLabelWithoutControl: callers pass htmlFor
  return <label className={cn("text-sm font-medium text-fg", className)} {...props} />;
}

interface FieldProps extends Omit<ComponentProps<"input">, "id"> {
  label: string;
  hint?: ReactNode;
  error?: string;
}

/** A labelled input with an optional hint and error, wired up for screen readers. */
export function Field({ label, hint, error, className, ...props }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(hint && hintId, error && errorId) || undefined}
        {...props}
      />
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
