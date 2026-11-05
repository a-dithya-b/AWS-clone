import type { ActionCatalogEntry } from "@cloudlearn/iam-engine";
import { useQuery } from "@tanstack/react-query";

/** Every IAM action CloudLearn simulates, for the policy editor and the simulator. */
export function useCatalog() {
  return useQuery({
    queryKey: ["meta", "catalog"],
    queryFn: async () => {
      const res = await fetch("/api/meta/catalog", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`Couldn't load the action catalog (HTTP ${res.status}).`);
      return ((await res.json()) as { actions: ActionCatalogEntry[] }).actions;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}
