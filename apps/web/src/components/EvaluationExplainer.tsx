import type { EvaluationSummary } from "@cloudlearn/shared";
import { Badge } from "./ui/feedback";

const decisionLabel = {
  Allow: { text: "Allowed", variant: "success" },
  ExplicitDeny: { text: "Explicitly denied", variant: "danger" },
  ImplicitDeny: { text: "Implicitly denied", variant: "danger" },
} as const;

const typeLabel: Record<string, string> = {
  "aws-managed": "AWS managed",
  "customer-managed": "Customer managed",
  inline: "Inline",
  "resource-based": "Resource-based",
  trust: "Trust policy",
};

export function DecisionBadge({ decision }: { decision: EvaluationSummary["decision"] }) {
  const d = decisionLabel[decision];
  return <Badge variant={d.variant}>{d.text}</Badge>;
}

export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre
      className={`overflow-auto rounded-md bg-surface-muted p-3 font-mono text-xs leading-5 text-fg ${className ?? "max-h-72"}`}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** Explains an IAM decision: what was decided, why, which statements decided it, what was checked. */
export function EvaluationExplainer({ evaluation }: { evaluation: EvaluationSummary }) {
  const policies = evaluation.policiesEvaluated ?? [];
  return (
    <div className="space-y-5 text-sm">
      <div className="space-y-2">
        <DecisionBadge decision={evaluation.decision} />
        <p className="text-fg">{evaluation.reason}</p>
      </div>

      <section>
        <h3 className="mb-2 font-semibold text-fg">
          {evaluation.decision === "ExplicitDeny"
            ? "Statements that denied it"
            : evaluation.decision === "Allow"
              ? "Statements that allowed it"
              : "Statements that matched"}
        </h3>
        {evaluation.matchedStatements.length === 0 ? (
          <p className="text-muted">
            None. IAM denies everything by default, so with no matching Allow the request is denied
            (an <em>implicit</em> deny).
          </p>
        ) : (
          <ul className="space-y-3">
            {evaluation.matchedStatements.map((m) => (
              <li
                key={`${m.policyId}-${m.statementIndex}`}
                className="rounded-md border border-border p-3"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-medium text-fg">{m.policyName}</span>
                  <Badge>{typeLabel[m.policyType] ?? m.policyType}</Badge>
                  <Badge variant={m.effect === "Deny" ? "danger" : "success"}>{m.effect}</Badge>
                  {m.sid && <span className="text-xs text-muted">Sid: {m.sid}</span>}
                  {m.attachedVia && <span className="text-xs text-muted">via {m.attachedVia}</span>}
                </div>
                <JsonBlock value={m.statement} className="max-h-48" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-fg">Policies evaluated ({policies.length})</h3>
        {policies.length === 0 ? (
          <p className="text-muted">No policies apply to this identity.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {policies.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="text-fg">{p.name}</span>
                <Badge>{typeLabel[p.type] ?? p.type}</Badge>
                {p.attachedVia && <span className="text-xs text-muted">via {p.attachedVia}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
