import type { ActionCatalogEntry } from "@cloudlearn/iam-engine";
import type { ServiceModule } from "./service";

/** Every IAM action CloudLearn simulates, for policy validation, summaries and autocomplete. */
export function buildCatalog(services: ServiceModule[]): ActionCatalogEntry[] {
  const seen = new Set<string>();
  const entries: ActionCatalogEntry[] = [];
  for (const service of services) {
    for (const action of service.actions) {
      if (seen.has(action.iamAction)) continue;
      seen.add(action.iamAction);
      entries.push({
        action: action.iamAction,
        service: action.iamAction.split(":")[0] ?? service.id,
        serviceName: service.name,
        accessLevel: action.accessLevel,
      });
    }
  }
  return entries.sort((a, b) => a.action.localeCompare(b.action));
}
