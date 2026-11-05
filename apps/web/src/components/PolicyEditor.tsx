import { type PolicyKind, type ValidationResult, validatePolicy } from "@cloudlearn/iam-engine";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { linter, lintGutter } from "@codemirror/lint";
import CodeMirror from "@uiw/react-codemirror";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useCatalog } from "@/lib/catalog";
import { cn } from "@/lib/cn";
import { PolicySummary } from "./PolicySummary";

const extensions = [json(), linter(jsonParseLinter()), lintGutter()];

/** Validates a policy as you type, with the catalog of simulated actions for helpful warnings. */
export function usePolicyValidation(text: string, kind: PolicyKind): ValidationResult {
  const catalog = useCatalog();
  return useMemo(
    () => validatePolicy(text, { kind, catalog: catalog.data }),
    [text, kind, catalog.data],
  );
}

export const policyTemplates: Record<PolicyKind, object> = {
  identity: {
    Version: "2012-10-17",
    Statement: [{ Sid: "Statement1", Effect: "Allow", Action: [], Resource: [] }],
  },
  trust: {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { AWS: "arn:aws:iam::123456789012:root" },
        Action: "sts:AssumeRole",
      },
    ],
  },
  resource: {
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { AWS: "*" }, Action: [], Resource: [] }],
  },
};

export const formatPolicyJson = (value: unknown) => JSON.stringify(value, null, 2);

/**
 * JSON policy editor with live validation (AWS-style errors and warnings) and a Summary view.
 * Use `usePolicyValidation` in the parent to decide whether the policy can be saved.
 */
export function PolicyEditor({
  value,
  onChange,
  kind,
  height = "320px",
  label = "Policy editor",
}: {
  value: string;
  onChange: (value: string) => void;
  kind: PolicyKind;
  height?: string;
  label?: string;
}) {
  const [view, setView] = useState<"json" | "summary">("json");
  const result = usePolicyValidation(value, kind);
  const errors = result.issues.filter((i) => i.severity === "error");
  const warnings = result.issues.filter((i) => i.severity === "warning");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-fg">{label}</span>
        {kind === "identity" && (
          <fieldset className="inline-flex rounded-md border border-border p-0.5">
            <legend className="sr-only">View</legend>
            {(["json", "summary"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "cursor-pointer rounded px-3 py-1 text-xs font-medium",
                  view === v ? "bg-brand text-brand-fg" : "text-muted hover:text-fg",
                )}
              >
                {v === "json" ? "JSON" : "Summary"}
              </button>
            ))}
          </fieldset>
        )}
      </div>

      {view === "json" || kind !== "identity" ? (
        <div className="overflow-hidden rounded-md border border-border text-sm">
          <CodeMirror
            value={value}
            onChange={onChange}
            height={height}
            extensions={extensions}
            aria-label={label}
            basicSetup={{ foldGutter: true, highlightActiveLine: true }}
          />
        </div>
      ) : result.document ? (
        <PolicySummary document={result.document} />
      ) : (
        <p className="text-sm text-muted">Fix the JSON errors to see a summary.</p>
      )}

      <div aria-live="polite" className="space-y-1.5 text-sm">
        {errors.length === 0 && warnings.length === 0 && (
          <p className="flex items-center gap-2 text-success">
            <CircleCheck className="size-4" aria-hidden /> No issues found.
          </p>
        )}
        {errors.map((i) => (
          <p key={`e-${i.path}-${i.message}`} className="flex gap-2 text-danger">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <span className="font-medium">Error</span>
              {i.path && <span className="font-mono text-xs"> {i.path}</span>}: {i.message}
            </span>
          </p>
        ))}
        {warnings.map((i) => (
          <p key={`w-${i.path}-${i.message}`} className="flex gap-2 text-warning">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <span className="font-medium">Warning</span>
              {i.path && <span className="font-mono text-xs"> {i.path}</span>}: {i.message}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}
