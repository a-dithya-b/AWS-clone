import { useEffect } from "react";

export function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} | CloudLearn`;
  }, [title]);
}

/** Only allow same-site paths as redirect targets (no "//evil.example"). */
export function safeNextPath(next: string | null, fallback = "/console"): string {
  return next?.startsWith("/") && !next.startsWith("//") ? next : fallback;
}
