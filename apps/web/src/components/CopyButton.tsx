import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

/** A small icon button that copies text, like the copy icons next to ARNs in the AWS console. */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : `Copy ${label}`}
      title={copied ? "Copied" : `Copy ${label}`}
      className={cn(
        "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface-muted hover:text-fg",
        className,
      )}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard can be blocked (e.g. non-secure context); nothing useful to do.
        }
      }}
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  );
}
