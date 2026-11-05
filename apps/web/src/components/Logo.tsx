import { cn } from "@/lib/cn";

/** CloudLearn's own mark: a cloud with a check, for "learn safely". */
export function Logo({
  className,
  tone = "light",
}: {
  className?: string;
  tone?: "light" | "dark";
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="7" fill="#0f766e" />
        <path
          d="M10 21.5h12.5a4.5 4.5 0 0 0 .6-8.96A6 6 0 0 0 11.6 12a4.75 4.75 0 0 0-1.6 9.5Z"
          fill="none"
          stroke="#ccfbf1"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <path
          d="m13.5 17.5 2 2 3.5-4"
          fill="none"
          stroke="#5eead4"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={tone === "light" ? "text-topbar-fg" : "text-fg"}>
        Cloud<span className={tone === "light" ? "text-accent" : "text-brand"}>Learn</span>
      </span>
    </span>
  );
}
