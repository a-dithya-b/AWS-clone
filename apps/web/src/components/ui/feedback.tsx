import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const alertStyles = {
  info: { box: "border-info-border bg-info-soft", icon: "text-info", Icon: Info },
  success: {
    box: "border-success-border bg-success-soft",
    icon: "text-success",
    Icon: CircleCheck,
  },
  warning: {
    box: "border-warning-border bg-warning-soft",
    icon: "text-warning",
    Icon: TriangleAlert,
  },
  error: { box: "border-danger-border bg-danger-soft", icon: "text-danger", Icon: CircleAlert },
};

export function Alert({
  variant = "info",
  title,
  children,
  className,
}: {
  variant?: keyof typeof alertStyles;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const { box, icon, Icon } = alertStyles[variant];
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-md border px-4 py-3 text-sm", box, className)}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", icon)} aria-hidden />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-semibold text-fg">{title}</p>}
        {children && <div className="text-fg/90">{children}</div>}
      </div>
    </div>
  );
}

const badgeStyles = {
  neutral: "border-border bg-surface-muted text-muted",
  brand: "border-transparent bg-brand-soft text-brand",
  success: "border-success-border bg-success-soft text-success",
  danger: "border-danger-border bg-danger-soft text-danger",
  warning: "border-warning-border bg-warning-soft text-warning",
};

export function Badge({
  variant = "neutral",
  children,
  className,
}: {
  variant?: keyof typeof badgeStyles;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        badgeStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <span
      role="status"
      className={cn("inline-flex items-center gap-2 text-sm text-muted", className)}
    >
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      {label}
    </span>
  );
}
