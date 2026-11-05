import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

const variants = {
  primary: "bg-brand text-brand-fg hover:bg-brand-hover",
  secondary: "border border-border bg-surface text-fg hover:bg-surface-muted",
  ghost: "text-fg hover:bg-surface-muted",
  danger: "bg-danger text-white hover:opacity-90",
  link: "h-auto px-0 text-brand underline-offset-4 hover:underline",
};

const sizes = {
  sm: "h-8 px-3 text-sm",
  md: "h-9 px-4 text-sm",
  lg: "h-10 px-5 text-base",
};

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  /** Render the child element (e.g. a Link) with button styles. */
  asChild?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  asChild,
  className,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50",
        sizes[size],
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
