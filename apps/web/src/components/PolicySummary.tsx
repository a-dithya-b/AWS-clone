import { type PolicyDocument, summarizePolicy } from "@cloudlearn/iam-engine";
import { useMemo } from "react";
import { useCatalog } from "@/lib/catalog";
import { Alert, Badge, Spinner } from "./ui/feedback";

/** A readable summary of a policy: per service, what it allows or denies and on which resources. */
export function PolicySummary({ document }: { document: PolicyDocument }) {
  const catalog = useCatalog();
  const summary = useMemo(
    () => (catalog.data ? summarizePolicy(document, catalog.data) : null),
    [catalog.data, document],
  );

  if (catalog.isPending) return <Spinner />;
  if (!summary) return <Alert variant="error">Couldn't load the action catalog.</Alert>;

  return (
    <div className="space-y-3">
      {summary.entries.length === 0 ? (
        <p className="text-sm text-muted">
          This policy doesn't match any action CloudLearn simulates.
        </p>
      ) : (
        <div className="relative overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Service</th>
                <th className="px-3 py-2 font-medium">Effect</th>
                <th className="px-3 py-2 font-medium">Access level</th>
                <th className="px-3 py-2 font-medium">Resource</th>
                <th className="px-3 py-2 font-medium">Conditions</th>
              </tr>
            </thead>
            <tbody>
              {summary.entries.map((e) => (
                <tr
                  key={`${e.service}-${e.effect}`}
                  className="border-b border-border last:border-0 align-top"
                >
                  <td className="px-3 py-2 font-medium text-fg">{e.serviceName}</td>
                  <td className="px-3 py-2">
                    <Badge variant={e.effect === "Deny" ? "danger" : "success"}>{e.effect}</Badge>
                  </td>
                  <td className="px-3 py-2 text-fg">
                    {e.access === "Full access" ? (
                      <span className="font-medium">Full access</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {e.levels.map((l) => (
                          <li key={l.level}>
                            <span className="text-fg">Limited: {l.level}</span>{" "}
                            <span className="text-xs text-muted">
                              ({l.actions.length} of {l.total})
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs break-all text-fg">
                    {e.resources.map((r) => (
                      <div key={r}>{r === "*" ? "All resources" : r}</div>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-muted">{e.hasConditions ? "Yes" : "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {summary.unsupportedServices.length > 0 && (
        <p className="text-xs text-muted">
          Also mentions services CloudLearn doesn't simulate:{" "}
          {summary.unsupportedServices.join(", ")}.
        </p>
      )}
    </div>
  );
}
