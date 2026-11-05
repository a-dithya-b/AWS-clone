import { useQueries } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { ApiErrorAlert } from "@/components/ApiErrorAlert";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DataTable } from "@/components/DataTable";
import { JsonBlock } from "@/components/EvaluationExplainer";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/feedback";
import { Tabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { iamCall, policyPath, useIam, useIamMutation } from "../api";
import {
  isAwsManaged,
  kindLabel,
  type ListAttachedPoliciesOutput,
  type ListGroupsForUserOutput,
  type ListInlinePoliciesOutput,
  type PrincipalKind,
} from "../types";
import { InlinePolicyDialog } from "./InlinePolicyDialog";
import { GroupPicker, PolicyPicker } from "./pickers";

interface PermissionRow {
  id: string;
  name: string;
  type: "AWS managed" | "Customer managed" | "Inline";
  arn?: string;
  /** "Directly" or "Group <name>". */
  via: string;
  direct: boolean;
}

function attachedRows(
  policies: ListAttachedPoliciesOutput | undefined,
  via: string,
  direct: boolean,
): PermissionRow[] {
  return (policies?.AttachedPolicies ?? []).map((p) => ({
    id: `${via}:${p.PolicyArn}`,
    name: p.PolicyName,
    type: isAwsManaged(p.PolicyArn) ? "AWS managed" : "Customer managed",
    arn: p.PolicyArn,
    via,
    direct,
  }));
}

function inlineRows(
  names: ListInlinePoliciesOutput | undefined,
  via: string,
  direct: boolean,
): PermissionRow[] {
  return (names?.PolicyNames ?? []).map((n) => ({
    id: `${via}:inline:${n}`,
    name: n,
    type: "Inline",
    via,
    direct,
  }));
}

/**
 * All the permissions of a user, group or role in one table: managed policies, inline policies
 * and (for users) the ones inherited from groups, with add/remove actions.
 */
export function PermissionsPanel({ kind, name }: { kind: PrincipalKind; name: string }) {
  const label = kindLabel[kind];
  const key = `${label}Name`;
  const attached = useIam<ListAttachedPoliciesOutput>(`ListAttached${label}Policies`, {
    [key]: name,
  });
  const inline = useIam<ListInlinePoliciesOutput>(`List${label}Policies`, { [key]: name });
  const groups = useIam<ListGroupsForUserOutput>(
    "ListGroupsForUser",
    { UserName: name, MaxItems: 1000 },
    { enabled: kind === "user" },
  );

  // For users: each group's policies, shown as "inherited".
  const groupNames = groups.data?.Groups.map((g) => g.GroupName) ?? [];
  const groupPolicies = useQueries({
    queries: groupNames.flatMap((g) => [
      {
        queryKey: ["iam", "ListAttachedGroupPolicies", { GroupName: g }],
        queryFn: () =>
          api.action<ListAttachedPoliciesOutput>("iam", "ListAttachedGroupPolicies", {
            GroupName: g,
          }),
      },
      {
        queryKey: ["iam", "ListGroupPolicies", { GroupName: g }],
        queryFn: () =>
          api.action<ListInlinePoliciesOutput>("iam", "ListGroupPolicies", { GroupName: g }),
      },
    ]),
  });

  const rows: PermissionRow[] = [
    ...attachedRows(attached.data, "Directly", true),
    ...inlineRows(inline.data, "Directly", true),
    ...groupNames.flatMap((g, i) => [
      ...attachedRows(
        groupPolicies[i * 2]?.data as ListAttachedPoliciesOutput | undefined,
        `Group ${g}`,
        false,
      ),
      ...inlineRows(
        groupPolicies[i * 2 + 1]?.data as ListInlinePoliciesOutput | undefined,
        `Group ${g}`,
        false,
      ),
    ]),
  ];

  const [adding, setAdding] = useState(false);
  const [inlineOpen, setInlineOpen] = useState(false);
  const [editing, setEditing] = useState<{ name: string; document: unknown } | undefined>();
  const [viewing, setViewing] = useState<
    { name: string; document: unknown; via: string } | undefined
  >();
  const [removing, setRemoving] = useState<PermissionRow | undefined>();

  const remove = useIamMutation((row: PermissionRow) =>
    row.type === "Inline"
      ? iamCall(`Delete${label}Policy`, { [key]: name, PolicyName: row.name })
      : iamCall(`Detach${label}Policy`, { [key]: name, PolicyArn: row.arn }),
  );
  const openInline = useIamMutation(async (row: PermissionRow) => {
    const groupName = row.direct ? undefined : row.via.replace(/^Group /, "");
    const res = await iamCall<{ PolicyDocument: unknown }>(
      groupName ? "GetGroupPolicy" : `Get${label}Policy`,
      groupName
        ? { GroupName: groupName, PolicyName: row.name }
        : { [key]: name, PolicyName: row.name },
    );
    if (row.direct) setEditing({ name: row.name, document: res.PolicyDocument });
    else setViewing({ name: row.name, document: res.PolicyDocument, via: row.via });
  });

  return (
    <>
      <DataTable<PermissionRow>
        title="Permissions policies"
        description={
          kind === "user"
            ? "Policies attached directly, inline, and inherited from the user's groups."
            : `Policies that apply to this ${kind}.`
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setInlineOpen(true)}>
              Create inline policy
            </Button>
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden /> Add permissions
            </Button>
          </>
        }
        rows={rows}
        isLoading={attached.isPending || inline.isPending}
        error={attached.error ?? inline.error ?? groups.error}
        getRowId={(r) => r.id}
        filterText={(r) => `${r.name} ${r.via}`}
        filterPlaceholder="Search permissions"
        emptyMessage={`No permissions. Without a policy that allows an action, this ${kind} is denied everything.`}
        columns={[
          {
            key: "name",
            header: "Policy name",
            cell: (r) =>
              r.arn ? (
                <Link to={policyPath(r.arn)} className="font-medium text-brand hover:underline">
                  {r.name}
                </Link>
              ) : (
                <button
                  type="button"
                  className="cursor-pointer font-medium text-brand hover:underline"
                  onClick={() => openInline.mutate(r)}
                >
                  {r.name}
                </button>
              ),
          },
          {
            key: "type",
            header: "Type",
            cell: (r) => (
              <Badge
                variant={
                  r.type === "Inline" ? "warning" : r.type === "AWS managed" ? "neutral" : "brand"
                }
              >
                {r.type}
              </Badge>
            ),
          },
          {
            key: "via",
            header: "Attached via",
            cell: (r) => <span className="text-muted">{r.via}</span>,
          },
          {
            key: "actions",
            header: <span className="sr-only">Actions</span>,
            className: "text-right",
            cell: (r) =>
              r.direct ? (
                <Button variant="ghost" size="sm" onClick={() => setRemoving(r)}>
                  Remove
                </Button>
              ) : null,
          },
        ]}
      />
      <ApiErrorAlert error={openInline.error} className="mt-3" />

      <AddPermissionsDialog
        open={adding}
        onOpenChange={setAdding}
        kind={kind}
        name={name}
        attachedArns={attached.data?.AttachedPolicies.map((p) => p.PolicyArn) ?? []}
        currentGroups={groupNames}
      />
      <InlinePolicyDialog
        open={inlineOpen}
        onOpenChange={setInlineOpen}
        kind={kind}
        entityName={name}
      />
      <InlinePolicyDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(undefined)}
        kind={kind}
        entityName={name}
        existing={editing}
      />
      <Dialog
        open={!!viewing}
        onOpenChange={(o) => !o && setViewing(undefined)}
        title={`Inline policy ${viewing?.name ?? ""}`}
        description={`Inherited from ${viewing?.via}. Edit it on the group's page.`}
        size="lg"
      >
        {viewing && <JsonBlock value={viewing.document} className="max-h-[60vh]" />}
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => {
          if (!o) {
            setRemoving(undefined);
            remove.reset();
          }
        }}
        title={removing?.type === "Inline" ? "Delete inline policy?" : "Remove policy?"}
        confirmLabel={removing?.type === "Inline" ? "Delete" : "Remove"}
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() =>
          removing && remove.mutate(removing, { onSuccess: () => setRemoving(undefined) })
        }
      >
        <p>
          {removing?.type === "Inline"
            ? `The inline policy ${removing?.name} will be deleted permanently.`
            : `${removing?.name} will be detached from ${kind} ${name}. The policy itself isn't deleted.`}
        </p>
      </ConfirmDialog>
    </>
  );
}

function AddPermissionsDialog({
  open,
  onOpenChange,
  kind,
  name,
  attachedArns,
  currentGroups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: PrincipalKind;
  name: string;
  attachedArns: string[];
  currentGroups: string[];
}) {
  const [policies, setPolicies] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const label = kindLabel[kind];
  const save = useIamMutation(async () => {
    for (const arn of policies) {
      await iamCall(`Attach${label}Policy`, { [`${label}Name`]: name, PolicyArn: arn });
    }
    for (const g of groups) await iamCall("AddUserToGroup", { GroupName: g, UserName: name });
  });
  const close = (o: boolean) => {
    if (!o) {
      setPolicies([]);
      setGroups([]);
      save.reset();
    }
    onOpenChange(o);
  };

  const policyPicker = (
    <PolicyPicker selected={policies} onChange={setPolicies} exclude={attachedArns} />
  );
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="xl"
      title={`Add permissions to ${name}`}
      footer={
        <>
          <span className="mr-auto text-sm text-muted">
            {policies.length} {policies.length === 1 ? "policy" : "policies"}
            {kind === "user" && `, ${groups.length} ${groups.length === 1 ? "group" : "groups"}`}{" "}
            selected
          </span>
          <Button variant="secondary" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            disabled={(!policies.length && !groups.length) || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: () => close(false) })}
          >
            {save.isPending ? "Adding…" : "Add permissions"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {kind === "user" ? (
          <Tabs
            tabs={[
              { id: "policies", label: "Attach policies directly", content: policyPicker },
              {
                id: "groups",
                label: "Add user to groups",
                content: (
                  <div className="space-y-2">
                    <p className="text-sm text-muted">
                      Best practice: manage permissions through groups, so people with the same job
                      get the same access.
                    </p>
                    <GroupPicker selected={groups} onChange={setGroups} exclude={currentGroups} />
                  </div>
                ),
              },
            ]}
          />
        ) : (
          policyPicker
        )}
        <ApiErrorAlert error={save.error} />
      </div>
    </Dialog>
  );
}
