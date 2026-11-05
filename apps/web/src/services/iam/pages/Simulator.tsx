import type { ActionCatalogEntry } from "@cloudlearn/iam-engine";
import { ChevronRight, Play } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { ApiErrorAlert } from "@/components/ApiErrorAlert";
import { EvaluationExplainer } from "@/components/EvaluationExplainer";
import { PageHeader } from "@/components/PageHeader";
import {
  formatPolicyJson,
  PolicyEditor,
  policyTemplates,
  usePolicyValidation,
} from "@/components/PolicyEditor";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { RadioCards, SelectField } from "@/components/ui/controls";
import { Badge, Spinner } from "@/components/ui/feedback";
import { Field } from "@/components/ui/form";
import { useCatalog } from "@/lib/catalog";
import { cn } from "@/lib/cn";
import { useTitle } from "@/lib/useTitle";
import { iamCall, useGroups, useIamMutation, useRoles, useUsers } from "../api";
import type { SimulationOutput, SimulationResult } from "../types";

const decisionBadge = {
  allowed: <Badge variant="success">Allowed</Badge>,
  explicitDeny: <Badge variant="danger">Denied (explicit)</Badge>,
  implicitDeny: <Badge variant="danger">Denied (implicit)</Badge>,
};

function ActionPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (a: string[]) => void;
}) {
  const catalog = useCatalog();
  const [query, setQuery] = useState("");
  const byService = useMemo(() => {
    const map = new Map<string, ActionCatalogEntry[]>();
    for (const a of catalog.data ?? []) {
      if (query && !a.action.toLowerCase().includes(query.toLowerCase())) continue;
      map.set(a.serviceName, [...(map.get(a.serviceName) ?? []), a]);
    }
    return [...map];
  }, [catalog.data, query]);
  const set = new Set(selected);
  if (catalog.isPending) return <Spinner />;
  return (
    <div className="space-y-3">
      <Field
        label="Search actions"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="e.g. ListUsers"
      />
      <div className="max-h-80 space-y-3 overflow-y-auto rounded-md border border-border p-3">
        {byService.length === 0 && <p className="text-sm text-muted">No actions match.</p>}
        {byService.map(([service, actions]) => {
          const all = actions.every((a) => set.has(a.action));
          return (
            <fieldset key={service}>
              <legend className="mb-1 flex items-center gap-2 text-sm font-semibold text-fg">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 cursor-pointer accent-brand"
                    checked={all}
                    onChange={() =>
                      onChange(
                        all
                          ? selected.filter((s) => !actions.some((a) => a.action === s))
                          : [...new Set([...selected, ...actions.map((a) => a.action)])],
                      )
                    }
                  />
                  {service} <span className="font-normal text-muted">({actions.length})</span>
                </label>
              </legend>
              <div className="grid gap-x-4 gap-y-1 pl-6 sm:grid-cols-2 lg:grid-cols-3">
                {actions.map((a) => (
                  <label
                    key={a.action}
                    className="flex cursor-pointer items-center gap-2 text-sm text-fg"
                  >
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer accent-brand"
                      checked={set.has(a.action)}
                      onChange={() =>
                        onChange(
                          set.has(a.action)
                            ? selected.filter((s) => s !== a.action)
                            : [...selected, a.action],
                        )
                      }
                    />
                    <span className="truncate font-mono text-xs">{a.action.split(":")[1]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
      <p className="text-xs text-muted">{selected.length} action(s) selected</p>
    </div>
  );
}

function Results({ results }: { results: SimulationResult[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-surface-muted text-xs text-muted">
          <tr>
            <th className="w-8 py-2 pl-3" aria-label="Expand" />
            <th className="px-3 py-2 font-medium">Action</th>
            <th className="px-3 py-2 font-medium">Resource</th>
            <th className="px-3 py-2 font-medium">Result</th>
            <th className="hidden px-3 py-2 font-medium md:table-cell">Matched statements</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <Fragment key={`${r.EvalActionName}-${r.EvalResourceName}`}>
              <tr
                className="cursor-pointer border-b border-border hover:bg-surface-muted"
                onClick={() => setOpen(open === i ? null : i)}
              >
                <td className="py-2 pl-3">
                  <button
                    type="button"
                    aria-expanded={open === i}
                    aria-label={`Explain ${r.EvalActionName}`}
                    className="cursor-pointer text-muted"
                  >
                    <ChevronRight
                      className={cn("size-4 transition-transform", open === i && "rotate-90")}
                    />
                  </button>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-fg">{r.EvalActionName}</td>
                <td className="px-3 py-2 font-mono text-xs break-all text-muted">
                  {r.EvalResourceName}
                </td>
                <td className="px-3 py-2">{decisionBadge[r.EvalDecision]}</td>
                <td className="hidden px-3 py-2 text-muted md:table-cell">
                  {r.MatchedStatements.map((m) => m.SourcePolicyId).join(", ") || "—"}
                </td>
              </tr>
              {open === i && (
                <tr className="border-b border-border bg-surface-muted/50">
                  <td />
                  <td colSpan={4} className="px-3 py-4">
                    <EvaluationExplainer evaluation={r.Evaluation} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SimulatorPage() {
  useTitle("Policy simulator");
  const [params] = useSearchParams();
  const users = useUsers();
  const groups = useGroups();
  const roles = useRoles();
  const [mode, setMode] = useState<"principal" | "custom">("principal");
  const [principal, setPrincipal] = useState(params.get("principal") ?? "");
  const [policy, setPolicy] = useState(() => formatPolicyJson(policyTemplates.identity));
  const [actions, setActions] = useState<string[]>([]);
  const [resource, setResource] = useState("*");
  const validation = usePolicyValidation(policy, "identity");

  const run = useIamMutation(() =>
    mode === "principal"
      ? iamCall<SimulationOutput>("SimulatePrincipalPolicy", {
          PolicySourceArn: principal,
          ActionNames: actions,
          ResourceArns: [resource || "*"],
        })
      : iamCall<SimulationOutput>("SimulateCustomPolicy", {
          PolicyInputList: [policy],
          ActionNames: actions,
          ResourceArns: [resource || "*"],
        }),
  );

  const ready = actions.length > 0 && (mode === "principal" ? !!principal : validation.valid);

  return (
    <>
      <PageHeader
        crumbs={[{ label: "IAM", to: "/iam" }, { label: "Policy simulator" }]}
        title="Policy simulator"
        description="Ask IAM what would happen, without actually doing it. Every result explains which statements decided it."
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="1. What to test" />
          <CardBody className="space-y-4">
            <RadioCards
              name="simMode"
              value={mode}
              onChange={setMode}
              columns={2}
              options={[
                {
                  value: "principal",
                  title: "An existing identity",
                  description: "A user, group or role in this account.",
                },
                {
                  value: "custom",
                  title: "A policy you write",
                  description: "Try out JSON before saving it.",
                },
              ]}
            />
            {mode === "principal" ? (
              <SelectField
                label="Identity"
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
              >
                <option value="">Choose a user, group or role…</option>
                <optgroup label="Users">
                  {users.data?.Users.map((u) => (
                    <option key={u.Arn} value={u.Arn}>
                      {u.UserName}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="User groups">
                  {groups.data?.Groups.map((g) => (
                    <option key={g.Arn} value={g.Arn}>
                      {g.GroupName}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Roles">
                  {roles.data?.Roles.map((r) => (
                    <option key={r.Arn} value={r.Arn}>
                      {r.RoleName}
                    </option>
                  ))}
                </optgroup>
              </SelectField>
            ) : (
              <PolicyEditor value={policy} onChange={setPolicy} kind="identity" height="260px" />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="2. Actions and resource" />
          <CardBody className="space-y-4">
            <ActionPicker selected={actions} onChange={setActions} />
            <Field
              label="Resource ARN"
              value={resource}
              onChange={(e) => setResource(e.target.value)}
              hint='Use "*" for all resources, or an ARN like arn:aws:sqs:us-east-1:123456789012:orders.'
            />
            <Button disabled={!ready || run.isPending} onClick={() => run.mutate(undefined)}>
              <Play className="size-4" aria-hidden />{" "}
              {run.isPending ? "Running…" : "Run simulation"}
            </Button>
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="Results" description="Click a row to see why." />
        {run.error ? (
          <CardBody>
            <ApiErrorAlert error={run.error} />
          </CardBody>
        ) : run.data ? (
          <Results results={run.data.EvaluationResults} />
        ) : (
          <CardBody className="text-sm text-muted">
            Pick what to test and run the simulation.
          </CardBody>
        )}
      </Card>
    </>
  );
}
