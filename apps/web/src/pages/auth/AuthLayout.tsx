import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { Footer } from "@/shell/Footer";

/** Centered card used by the sign-in and sign-up pages. */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-1 flex-col items-center px-4 py-10 sm:py-16">
        <Logo tone="dark" className="mb-8 text-xl" />
        <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-semibold text-fg">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        <p className="mt-6 max-w-md text-center text-xs text-muted">
          Everything you create lives only on this computer. No AWS account, no credit card, no
          bill.
        </p>
      </div>
      <Footer />
    </div>
  );
}
