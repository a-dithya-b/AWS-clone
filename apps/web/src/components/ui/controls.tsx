import { type ComponentProps, type ReactNode, useId } from "react";
import { cn } from "@/lib/cn";
import { Label } from "./form";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg shadow-xs placeholder:text-muted/70 aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 w-full cursor-pointer rounded-md border border-border bg-surface px-2.5 text-sm text-fg shadow-xs",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

/** A labelled select. */
export function SelectField({
  label,
  hint,
  className,
  children,
  ...props
}: Omit<ComponentProps<"select">, "id"> & { label: string; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} {...props}>
        {children}
      </Select>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Checkbox({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <input
      type="checkbox"
      className={cn("size-4 shrink-0 cursor-pointer accent-brand", className)}
      {...props}
    />
  );
}

/** A checkbox with a title and optional description, as one clickable card. */
export function CheckboxCard({
  checked,
  onChange,
  title,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex gap-3 rounded-md border p-3",
        checked ? "border-brand bg-brand-soft" : "border-border",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-brand"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium text-fg">{title}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

/** A group of radio options rendered as selectable cards. */
export function RadioCards<T extends string>({
  name,
  value,
  onChange,
  options,
  legend,
  columns = 1,
}: {
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; title: ReactNode; description?: ReactNode; disabled?: boolean }[];
  legend?: ReactNode;
  columns?: 1 | 2 | 3;
}) {
  return (
    <fieldset>
      {legend && <legend className="mb-2 text-sm font-medium text-fg">{legend}</legend>}
      <div
        className={cn(
          "grid gap-2",
          columns === 2 && "sm:grid-cols-2",
          columns === 3 && "sm:grid-cols-3",
        )}
      >
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex gap-3 rounded-md border p-3",
              value === o.value ? "border-brand bg-brand-soft" : "border-border",
              o.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
              className="mt-1 accent-brand"
            />
            <span>
              <span className="block text-sm font-medium text-fg">{o.title}</span>
              {o.description && <span className="block text-xs text-muted">{o.description}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Numbered progress for multi-step wizards (Create user, Create role…). */
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mb-6 flex flex-wrap gap-x-6 gap-y-2" aria-label="Progress">
      {steps.map((s, i) => (
        <li
          key={s}
          aria-current={i === current ? "step" : undefined}
          className="flex items-center gap-2 text-sm"
        >
          <span
            className={cn(
              "inline-flex size-6 items-center justify-center rounded-full border text-xs font-semibold",
              i < current && "border-brand bg-brand text-brand-fg",
              i === current && "border-brand text-brand",
              i > current && "border-border text-muted",
            )}
          >
            {i + 1}
          </span>
          <span className={cn(i === current ? "font-medium text-fg" : "text-muted")}>{s}</span>
        </li>
      ))}
    </ol>
  );
}
