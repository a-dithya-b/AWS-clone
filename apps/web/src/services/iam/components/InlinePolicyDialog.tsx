import { useEffect, useState } from "react";
import { ApiErrorAlert } from "@/components/ApiErrorAlert";
import {
  formatPolicyJson,
  PolicyEditor,
  policyTemplates,
  usePolicyValidation,
} from "@/components/PolicyEditor";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/form";
import { iamCall, useIamMutation } from "../api";
import { kindLabel, type PrincipalKind } from "../types";

/** Create or edit an inline policy on a user, group or role (Put{Kind}Policy). */
export function InlinePolicyDialog({
  open,
  onOpenChange,
  kind,
  entityName,
  existing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: PrincipalKind;
  entityName: string;
  /** When editing: the policy name and its current document. */
  existing?: { name: string; document: unknown };
}) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const validation = usePolicyValidation(text, "identity");

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? "");
    setText(formatPolicyJson(existing?.document ?? policyTemplates.identity));
  }, [open, existing]);

  const label = kindLabel[kind];
  const save = useIamMutation(() =>
    iamCall(`Put${label}Policy`, {
      [`${label}Name`]: entityName,
      PolicyName: name,
      PolicyDocument: text,
    }),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        save.reset();
        onOpenChange(o);
      }}
      size="lg"
      title={existing ? `Edit inline policy ${existing.name}` : "Create inline policy"}
      description={`An inline policy belongs only to ${kind} ${entityName} and is deleted with it.`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name || !validation.valid || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: () => onOpenChange(false) })}
          >
            {save.isPending ? "Saving…" : "Save policy"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Policy name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!!existing}
          placeholder="e.g. ReadOrdersQueue"
        />
        <PolicyEditor value={text} onChange={setText} kind="identity" height="280px" />
        <ApiErrorAlert error={save.error} />
      </div>
    </Dialog>
  );
}
