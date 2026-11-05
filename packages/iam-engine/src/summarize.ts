import { matchesPattern } from "./match";
import { normalizePolicy } from "./normalize";
import type {
  AccessLevel,
  ActionCatalogEntry,
  Effect,
  PolicyDocument,
  PolicySummary,
  ServiceSummary,
} from "./types";

const LEVEL_ORDER: AccessLevel[] = ["List", "Read", "Write", "Permissions management", "Tagging"];

interface Group {
  service: string;
  effect: Effect;
  actions: Set<string>;
  resources: string[];
  hasConditions: boolean;
}

/** Summarizes what a policy allows and denies per service, like the console's policy summary. */
export function summarizePolicy(doc: PolicyDocument, catalog: ActionCatalogEntry[]): PolicySummary {
  const { statements } = normalizePolicy(doc);
  const catalogServices = new Set(catalog.map((e) => e.service.toLowerCase()));
  const unsupported = new Set<string>();
  const groups = new Map<string, Group>();

  for (const st of statements) {
    for (const action of st.action ?? []) {
      if (action === "*" || !action.includes(":")) continue;
      const service = action.slice(0, action.indexOf(":")).toLowerCase();
      if (!catalogServices.has(service)) unsupported.add(service);
    }

    const matches = (e: ActionCatalogEntry, patterns: string[]) =>
      patterns.some((p) => matchesPattern(p, e.action, { caseInsensitive: true }));
    const matched = st.action
      ? catalog.filter((e) => matches(e, st.action ?? []))
      : st.notAction
        ? catalog.filter((e) => !matches(e, st.notAction ?? []))
        : [];

    const resources = st.resource ?? st.notResource?.map((r) => `Not: ${r}`) ?? [];
    for (const entry of matched) {
      const key = `${entry.service}|${st.effect}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          service: entry.service,
          effect: st.effect,
          actions: new Set(),
          resources: [],
          hasConditions: false,
        };
        groups.set(key, group);
      }
      group.actions.add(entry.action);
      for (const r of resources) if (!group.resources.includes(r)) group.resources.push(r);
      if (st.condition && Object.keys(st.condition).length > 0) group.hasConditions = true;
    }
  }

  const entries: ServiceSummary[] = [...groups.values()].map((g) => {
    const serviceActions = catalog.filter((e) => e.service === g.service);
    const levels = LEVEL_ORDER.map((level) => {
      const inLevel = serviceActions.filter((e) => e.accessLevel === level);
      return {
        level,
        actions: inLevel.filter((e) => g.actions.has(e.action)).map((e) => e.action),
        total: inLevel.length,
      };
    }).filter((l) => l.actions.length > 0);
    return {
      service: g.service,
      serviceName: serviceActions[0]?.serviceName ?? g.service,
      effect: g.effect,
      access: g.actions.size === serviceActions.length ? "Full access" : "Limited",
      levels,
      resources: g.resources,
      hasConditions: g.hasConditions,
    };
  });

  entries.sort(
    (a, b) =>
      a.serviceName.localeCompare(b.serviceName) ||
      (a.effect === b.effect ? 0 : a.effect === "Allow" ? -1 : 1),
  );
  return { entries, unsupportedServices: [...unsupported].sort() };
}
