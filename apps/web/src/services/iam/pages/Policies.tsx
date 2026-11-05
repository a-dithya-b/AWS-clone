import { Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ApiErrorAlert } from "@/components/ApiErrorAlert";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CopyButton } from "@/components/CopyButton";
import { DataTable } from "@/components/DataTable";
import { JsonBlock } from "@/components/EvaluationExplainer";
import { PageHeader } from "@/components/PageHeader";
import {
  formatPolicyJson,
  PolicyEditor,
  policyTemplates,
  usePolicyValidation,
} from "@/components/PolicyEditor";
import { PolicySummary } from "@/components/PolicySummary";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select, SelectField, Textarea } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, Spinner } from "@/components/ui/feedback";
import { Field, Label } from "@/components/ui/form";
import { Tabs } from "@/components/ui/tabs";
import { formatDateTime } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";
import {
  deletePolicyCompletely,
  iamCall,
  policyPath,
  useGroups,
  useIam,
  useIamMutation,
  usePolicies,
  useRoles,
  useUsers,
} from "../api";
import { PolicyTypeBadge } from "../components/pickers";
import type {
  IamPolicy,
  ListEntitiesForPolicyOutput,
  PolicyVersion,
  PrincipalKind,
} from "../types";
import { kindLabel } from "../types";

const crumbs = [
  { label: "IAM", to: "/iam" },
  { label: "Policies", to: "/iam/policies" },
];
const MAX_VERSIONS = 5;

export function PoliciesPage() {
  useTitle("Policies");
  const [params, setParams] = useSearchParams();
  const scope = (params.get("scope") as "All" | "AWS" | "Local" | null) ?? "All";
  const policies = usePolicies();
  const rows = policies.data?.Policies.filter((p) => scope === "All" || p.Scope === scope);
  return (
    <>
      <PageHeader
        crumbs={[{ label: "IAM", to: "/iam" }, { label: "Policies" }]}
        title="Policies"
        description="A policy is a JSON document that allows or denies actions on resources. Attach it to users, groups or roles."
      />
      <DataTable<IamPolicy>
        title="Policies"
        actions={
          <Button asChild size="sm">
            <Link to="/iam/policies/create">
              <Plus className="size-4" aria-hidden /> Create policy
            </Link>
          </Button>
        }
        rows={rows}
        isLoading={policies.isPending}
        error={policies.error}
        getRowId={(p) => p.Arn}
        filterText={(p) => `${p.PolicyName} ${p.Description}`}
        filterPlaceholder="Search policies"
        toolbar={
          <Select
            aria-label="Policy type"
            className="w-auto"
            value={scope}
            onChange={(e) =>
              setParams(
                (p) => {
                  p.set("scope", e.target.value);
                  return p;
                },
                { replace: true },
              )
            }
          >
            <option value="All">All types</option>
            <option value="AWS">AWS managed</option>
            <option value="Local">Customer managed</option>
          </Select>
        }
        emptyMessage={scope === "Local" ? "You haven't created any policies yet." : "No policies."}
        columns={[
          {
            key: "name",
            header: "Policy name",
            cell: (p) => (
              <Link to={policyPath(p.Arn)} className="font-medium text-brand hover:underline">
                {p.PolicyName}
              </Link>
            ),
          },
          { key: "type", header: "Type", cell: (p) => <PolicyTypeBadge scope={p.Scope} /> },
          { key: "used", header: "Attached entities", cell: (p) => p.AttachmentCount },
          {
            key: "description",
            header: "Description",
            hideOnMobile: true,
            cell: (p) => <span className="text-muted">{p.Description}</span>,
          },
        ]}
      />
    </>
  );
}

export function CreatePolicyPage() {
  useTitle("Create policy");
  const navigate = useNavigate();
  const [text, setText] = useState(() => formatPolicyJson(policyTemplates.identity));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const validation = usePolicyValidation(text, "identity");
  const nameValid = /^[\w+=,.@-]{1,128}$/.test(name);
  const create = useIamMutation(() =>
    iamCall<{ Policy: IamPolicy }>("CreatePolicy", {
      PolicyName: name,
      PolicyDocument: text,
      Description: description || undefined,
    }),
  );
  return (
    <>
      <PageHeader
        crumbs={[...crumbs, { label: "Create policy" }]}
        title="Create policy"
        description="Write the policy as JSON. CloudLearn checks it as you type, exactly like IAM will when you save."
      />
      <div className="space-y-6">
        <Card>
          <CardBody>
            <PolicyEditor value={text} onChange={setText} kind="identity" height="360px" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Policy details" />
          <CardBody className="max-w-2xl space-y-4">
            <Field
              label="Policy name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={name && !nameValid ? "Use up to 128 letters, numbers and +=,.@-_" : undefined}
            />
            <div className="grid gap-1.5">
              <Label htmlFor="policy-description">Description (optional)</Label>
              <Textarea
                id="policy-description"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
              />
            </div>
            <ApiErrorAlert error={create.error} />
          </CardBody>
        </Card>
        <div className="flex justify-end gap-2">
          <Button asChild variant="ghost">
            <Link to="/iam/policies">Cancel</Link>
          </Button>
          <Button
            disabled={!nameValid || !validation.valid || create.isPending}
            onClick={() =>
              create.mutate(undefined, { onSuccess: (r) => navigate(policyPath(r.Policy.Arn)) })
            }
          >
            {create.isPending ? "Creating…" : "Create policy"}
          </Button>
        </div>
      </div>
    </>
  );
}

function EntitiesTab({ arn }: { arn: string }) {
  const entities = useIam<ListEntitiesForPolicyOutput>("ListEntitiesForPolicy", { PolicyArn: arn });
  const users = useUsers();
  const groups = useGroups();
  const roles = useRoles();
  const [attaching, setAttaching] = useState(false);
  const [kind, setKind] = useState<PrincipalKind>("user");
  const [target, setTarget] = useState("");
  const rows = [
    ...(entities.data?.PolicyUsers.map((u) => ({ kind: "user" as const, name: u.UserName })) ?? []),
    ...(entities.data?.PolicyGroups.map((g) => ({ kind: "group" as const, name: g.GroupName })) ??
      []),
    ...(entities.data?.PolicyRoles.map((r) => ({ kind: "role" as const, name: r.RoleName })) ?? []),
  ];
  const options =
    kind === "user"
      ? (users.data?.Users.map((u) => u.UserName) ?? [])
      : kind === "group"
        ? (groups.data?.Groups.map((g) => g.GroupName) ?? [])
        : (roles.data?.Roles.map((r) => r.RoleName) ?? []);
  const attach = useIamMutation(() =>
    iamCall(`Attach${kindLabel[kind]}Policy`, {
      [`${kindLabel[kind]}Name`]: target,
      PolicyArn: arn,
    }),
  );
  const detach = useIamMutation((row: { kind: PrincipalKind; name: string }) =>
    iamCall(`Detach${kindLabel[row.kind]}Policy`, {
      [`${kindLabel[row.kind]}Name`]: row.name,
      PolicyArn: arn,
    }),
  );
  const paths = { user: "users", group: "groups", role: "roles" };
  return (
    <>
      <DataTable
        title="Entities attached"
        description="Users, groups and roles this policy applies to."
        actions={
          <Button size="sm" onClick={() => setAttaching(true)}>
            Attach
          </Button>
        }
        rows={rows}
        isLoading={entities.isPending}
        error={entities.error ?? detach.error}
        getRowId={(r) => `${r.kind}:${r.name}`}
        emptyMessage="Not attached to anything."
        columns={[
          {
            key: "name",
            header: "Entity name",
            cell: (r) => (
              <Link
                to={`/iam/${paths[r.kind]}/${encodeURIComponent(r.name)}`}
                className="font-medium text-brand hover:underline"
              >
                {r.name}
              </Link>
            ),
          },
          { key: "type", header: "Type", cell: (r) => <Badge>{kindLabel[r.kind]}</Badge> },
          {
            key: "actions",
            header: <span className="sr-only">Actions</span>,
            className: "text-right",
            cell: (r) => (
              <Button
                variant="ghost"
                size="sm"
                disabled={detach.isPending}
                onClick={() => detach.mutate(r)}
              >
                Detach
              </Button>
            ),
          },
        ]}
      />
      <Dialog
        open={attaching}
        onOpenChange={(o) => {
          setAttaching(o);
          attach.reset();
          setTarget("");
        }}
        size="sm"
        title="Attach policy"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAttaching(false)}>
              Cancel
            </Button>
            <Button
              disabled={!target || attach.isPending}
              onClick={() => attach.mutate(undefined, { onSuccess: () => setAttaching(false) })}
            >
              Attach policy
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <SelectField
            label="Entity type"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as PrincipalKind);
              setTarget("");
            }}
          >
            <option value="user">User</option>
            <option value="group">User group</option>
            <option value="role">Role</option>
          </SelectField>
          <SelectField
            label={`${kindLabel[kind]} name`}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </SelectField>
          <ApiErrorAlert error={attach.error} />
        </div>
      </Dialog>
    </>
  );
}

function VersionsTab({ arn, versions }: { arn: string; versions: PolicyVersion[] }) {
  const setDefault = useIamMutation((v: string) =>
    iamCall("SetDefaultPolicyVersion", { PolicyArn: arn, VersionId: v }),
  );
  const remove = useIamMutation((v: string) =>
    iamCall("DeletePolicyVersion", { PolicyArn: arn, VersionId: v }),
  );
  const [viewing, setViewing] = useState<PolicyVersion | undefined>();
  return (
    <>
      <DataTable<PolicyVersion>
        title="Policy versions"
        description={`A managed policy keeps up to ${MAX_VERSIONS} versions. Exactly one is the default (the one IAM uses). Set an older one as default to roll back.`}
        rows={versions}
        error={setDefault.error ?? remove.error}
        getRowId={(v) => v.VersionId}
        columns={[
          {
            key: "version",
            header: "Version",
            cell: (v) => (
              <button
                type="button"
                className="cursor-pointer font-medium text-brand hover:underline"
                onClick={() => setViewing(v)}
              >
                {v.VersionId}
              </button>
            ),
          },
          {
            key: "default",
            header: "Default",
            cell: (v) => (v.IsDefaultVersion ? <Badge variant="success">Default</Badge> : null),
          },
          {
            key: "created",
            header: "Created",
            hideOnMobile: true,
            cell: (v) => <span className="text-muted">{formatDateTime(v.CreateDate)}</span>,
          },
          {
            key: "actions",
            header: <span className="sr-only">Actions</span>,
            className: "text-right whitespace-nowrap",
            cell: (v) =>
              v.IsDefaultVersion ? null : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={setDefault.isPending}
                    onClick={() => setDefault.mutate(v.VersionId)}
                  >
                    Set as default
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(v.VersionId)}
                  >
                    Delete
                  </Button>
                </>
              ),
          },
        ]}
      />
      <Dialog
        open={!!viewing}
        onOpenChange={(o) => !o && setViewing(undefined)}
        size="lg"
        title={`Version ${viewing?.VersionId ?? ""}`}
      >
        {viewing && <JsonBlock value={viewing.Document} className="max-h-[60vh]" />}
      </Dialog>
    </>
  );
}

export function PolicyDetailPage() {
  // The ARN contains "/", so the route is a splat (policies/*). Decode in case it arrives encoded.
  const { "*": raw = "" } = useParams();
  const arn = raw.includes("%") ? decodeURIComponent(raw) : raw;
  const navigate = useNavigate();
  const policy = useIam<{ Policy: IamPolicy }>("GetPolicy", { PolicyArn: arn });
  const versions = useIam<{ Versions: PolicyVersion[] }>("ListPolicyVersions", { PolicyArn: arn });
  useTitle(policy.data?.Policy.PolicyName ?? "Policy");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const validation = usePolicyValidation(text, "identity");
  const save = useIamMutation(() =>
    iamCall("CreatePolicyVersion", { PolicyArn: arn, PolicyDocument: text, SetAsDefault: true }),
  );
  const remove = useIamMutation(() => deletePolicyCompletely(arn));

  const current = versions.data?.Versions.find((v) => v.IsDefaultVersion);
  const p = policy.data?.Policy;
  const customer = p?.Scope === "Local";
  const versionCount = versions.data?.Versions.length ?? 0;

  return (
    <>
      <PageHeader
        crumbs={[...crumbs, { label: p?.PolicyName ?? "…" }]}
        title={p?.PolicyName ?? "Policy"}
        description={p?.Description || undefined}
        actions={
          customer ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={!current}
                onClick={() => {
                  setText(formatPolicyJson(current?.Document));
                  save.reset();
                  setEditing(true);
                }}
              >
                Edit
              </Button>
              <Button variant="danger" size="sm" onClick={() => setDeleting(true)}>
                Delete
              </Button>
            </>
          ) : undefined
        }
      />
      {policy.isPending ? (
        <Spinner />
      ) : policy.isError ? (
        <ApiErrorAlert error={policy.error} />
      ) : (
        <>
          <Card className="mb-6">
            <CardHeader title="Policy details" />
            <CardBody>
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted">Type</dt>
                  <dd>{p && <PolicyTypeBadge scope={p.Scope} />}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Default version</dt>
                  <dd className="text-fg">{p?.DefaultVersionId}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Attached entities</dt>
                  <dd className="text-fg">{p?.AttachmentCount}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Edited</dt>
                  <dd className="text-fg">{p && formatDateTime(p.UpdateDate)}</dd>
                </div>
                <div className="sm:col-span-2 lg:col-span-4">
                  <dt className="text-xs text-muted">ARN</dt>
                  <dd className="flex items-start gap-1 font-mono text-xs break-all text-fg">
                    {arn}
                    <CopyButton value={arn} label="ARN" />
                  </dd>
                </div>
              </dl>
              {!customer && (
                <p className="mt-4 text-xs text-muted">
                  AWS managed policies are maintained by AWS. You can attach them but not change
                  them.
                </p>
              )}
            </CardBody>
          </Card>
          <Tabs
            urlParam="tab"
            tabs={[
              {
                id: "permissions",
                label: "Permissions",
                content: (
                  <Card>
                    <CardHeader
                      title="Permissions defined in this policy"
                      description={`Version ${p?.DefaultVersionId}`}
                    />
                    <CardBody className="space-y-4">
                      {versions.isPending ? (
                        <Spinner />
                      ) : versions.isError ? (
                        <ApiErrorAlert error={versions.error} />
                      ) : current ? (
                        <>
                          <PolicySummary document={current.Document} />
                          <JsonBlock value={current.Document} className="max-h-[28rem]" />
                        </>
                      ) : null}
                    </CardBody>
                  </Card>
                ),
              },
              { id: "entities", label: "Entities attached", content: <EntitiesTab arn={arn} /> },
              ...(customer && versions.data
                ? [
                    {
                      id: "versions",
                      label: `Policy versions (${versionCount})`,
                      content: <VersionsTab arn={arn} versions={versions.data.Versions} />,
                    },
                  ]
                : []),
            ]}
          />
        </>
      )}

      <Dialog
        open={editing}
        onOpenChange={setEditing}
        size="lg"
        title={`Edit ${p?.PolicyName ?? "policy"}`}
        description="Saving creates a new version and makes it the default. The old version is kept so you can roll back."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              disabled={!validation.valid || save.isPending}
              onClick={() => save.mutate(undefined, { onSuccess: () => setEditing(false) })}
            >
              Save changes
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {versionCount >= MAX_VERSIONS && (
            <Alert variant="warning">
              This policy already has {MAX_VERSIONS} versions, the maximum. Delete an old version on
              the Policy versions tab first, or IAM will reject the change with LimitExceeded.
            </Alert>
          )}
          <PolicyEditor value={text} onChange={setText} kind="identity" />
          <ApiErrorAlert error={save.error} />
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleting}
        onOpenChange={(o) => {
          setDeleting(o);
          remove.reset();
        }}
        title={`Delete ${p?.PolicyName}?`}
        confirmText={p?.PolicyName}
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate(undefined, { onSuccess: () => navigate("/iam/policies") })}
      >
        <p>
          The console detaches it everywhere and deletes old versions first (DeletePolicy fails with
          DeleteConflict otherwise).
        </p>
      </ConfirmDialog>
    </>
  );
}
