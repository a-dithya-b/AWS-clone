import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiErrorAlert } from "@/components/ApiErrorAlert";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CopyButton } from "@/components/CopyButton";
import { DataTable } from "@/components/DataTable";
import { JsonBlock } from "@/components/EvaluationExplainer";
import { PageHeader } from "@/components/PageHeader";
import { formatPolicyJson, PolicyEditor, usePolicyValidation } from "@/components/PolicyEditor";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { RadioCards, SelectField, Steps, Textarea } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Spinner } from "@/components/ui/feedback";
import { Field, Label } from "@/components/ui/form";
import { Tabs } from "@/components/ui/tabs";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useRequiredSession } from "@/lib/session";
import { useTitle } from "@/lib/useTitle";
import { deleteRoleCompletely, iamCall, useIam, useIamMutation, useRoles, useUsers } from "../api";
import { PermissionsPanel } from "../components/PermissionsPanel";
import { PolicyPicker, UserPicker } from "../components/pickers";
import type { IamRole } from "../types";

const crumbs = [
  { label: "IAM", to: "/iam" },
  { label: "Roles", to: "/iam/roles" },
];

export const switchRoleUrl = (accountId: string, roleName: string) =>
  `${window.location.origin}/switchrole?account=${accountId}&roleName=${encodeURIComponent(roleName)}`;

/** Who a trust policy trusts, in one short line for the roles table. */
function trustedEntities(role: IamRole): string {
  const statements = Array.isArray(role.AssumeRolePolicyDocument.Statement)
    ? role.AssumeRolePolicyDocument.Statement
    : [role.AssumeRolePolicyDocument.Statement];
  const names = statements.flatMap((s) => {
    const p = s.Principal;
    if (!p) return [];
    if (p === "*") return ["Anyone"];
    const aws = p.AWS === undefined ? [] : Array.isArray(p.AWS) ? p.AWS : [p.AWS];
    const svc = p.Service === undefined ? [] : Array.isArray(p.Service) ? p.Service : [p.Service];
    return [
      ...aws.map((a) =>
        a.endsWith(":root") ? `Account ${a.split(":")[4]}` : (a.split(":").pop() ?? a),
      ),
      ...svc.map((x) => `Service: ${x}`),
    ];
  });
  return names.join(", ") || "—";
}

export function RolesPage() {
  useTitle("Roles");
  const roles = useRoles();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const remove = useIamMutation(async (names: string[]) => {
    for (const n of names) await deleteRoleCompletely(n);
  });
  return (
    <>
      <PageHeader
        crumbs={[{ label: "IAM", to: "/iam" }, { label: "Roles" }]}
        title="Roles"
        description="A role is an identity with permissions but no password. Trusted users switch into it and get temporary credentials."
      />
      <DataTable<IamRole>
        title="Roles"
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={!selected.length}
              onClick={() => setConfirming(true)}
            >
              Delete
            </Button>
            <Button asChild size="sm">
              <Link to="/iam/roles/create">
                <Plus className="size-4" aria-hidden /> Create role
              </Link>
            </Button>
          </>
        }
        rows={roles.data?.Roles}
        isLoading={roles.isPending}
        error={roles.error}
        getRowId={(r) => r.RoleName}
        selectionMode="multi"
        selected={selected}
        onSelectedChange={setSelected}
        filterText={(r) => `${r.RoleName} ${r.Description}`}
        filterPlaceholder="Search roles"
        emptyMessage="No roles yet."
        columns={[
          {
            key: "name",
            header: "Role name",
            cell: (r) => (
              <Link
                to={`/iam/roles/${encodeURIComponent(r.RoleName)}`}
                className="font-medium text-brand hover:underline"
              >
                {r.RoleName}
              </Link>
            ),
          },
          {
            key: "trusted",
            header: "Trusted entities",
            cell: (r) => <span className="break-all text-muted">{trustedEntities(r)}</span>,
          },
          {
            key: "lastUsed",
            header: "Last used",
            hideOnMobile: true,
            cell: (r) =>
              r.RoleLastUsed ? (
                formatRelative(r.RoleLastUsed.LastUsedDate)
              ) : (
                <span className="text-muted">Never</span>
              ),
          },
        ]}
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={(o) => {
          setConfirming(o);
          remove.reset();
        }}
        title={`Delete ${selected.length === 1 ? selected[0] : `${selected.length} roles`}?`}
        confirmText={selected.length === 1 ? selected[0] : "delete"}
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() =>
          remove.mutate(selected, {
            onSuccess: () => {
              setSelected([]);
              setConfirming(false);
            },
          })
        }
      >
        <p>Policies are removed first, then the role. Anyone currently using the role loses it.</p>
      </ConfirmDialog>
    </>
  );
}

type TrustMode = "account" | "user" | "custom";

export function CreateRolePage() {
  useTitle("Create role");
  const session = useRequiredSession();
  const navigate = useNavigate();
  const users = useUsers();
  const [step, setStep] = useState(0);
  const [trustMode, setTrustMode] = useState<TrustMode>("account");
  const [trustUser, setTrustUser] = useState<string[]>([]);
  const [customTrust, setCustomTrust] = useState(() =>
    formatPolicyJson({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: `arn:aws:iam::${session.accountId}:root` },
          Action: "sts:AssumeRole",
        },
      ],
    }),
  );
  const [policies, setPolicies] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [maxSession, setMaxSession] = useState(3600);
  const customValidation = usePolicyValidation(customTrust, "trust");

  const userArn = users.data?.Users.find((u) => u.UserName === trustUser[0])?.Arn;
  const trustDocument = useMemo(() => {
    if (trustMode === "custom") return customTrust;
    const principal = trustMode === "account" ? `arn:aws:iam::${session.accountId}:root` : userArn;
    return formatPolicyJson({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Principal: { AWS: principal }, Action: "sts:AssumeRole" }],
    });
  }, [trustMode, customTrust, session.accountId, userArn]);

  const trustReady =
    trustMode === "account" ||
    (trustMode === "user" && !!userArn) ||
    (trustMode === "custom" && customValidation.valid);
  const nameValid = /^[\w+=,.@-]{1,64}$/.test(name);

  const create = useIamMutation(async () => {
    await iamCall("CreateRole", {
      RoleName: name,
      AssumeRolePolicyDocument: trustDocument,
      Description: description || undefined,
      MaxSessionDuration: maxSession,
    });
    for (const arn of policies)
      await iamCall("AttachRolePolicy", { RoleName: name, PolicyArn: arn });
  });

  return (
    <>
      <PageHeader crumbs={[...crumbs, { label: "Create role" }]} title="Create role" />
      <Steps steps={["Trusted entity", "Permissions", "Name and review"]} current={step} />

      {step === 0 && (
        <Card>
          <CardHeader
            title="Who can use this role?"
            description="The trust policy decides who may switch into (assume) the role."
          />
          <CardBody className="space-y-4">
            <RadioCards
              name="trust"
              value={trustMode}
              onChange={setTrustMode}
              columns={3}
              options={[
                {
                  value: "account",
                  title: "This account",
                  description:
                    "Any identity in this account whose own policies allow sts:AssumeRole.",
                },
                {
                  value: "user",
                  title: "A specific IAM user",
                  description: "Only this user; no extra permission needed.",
                },
                {
                  value: "custom",
                  title: "Custom trust policy",
                  description: "Write the trust policy JSON yourself.",
                },
              ]}
            />
            {trustMode === "account" && (
              <Alert variant="info">
                Trusting the account (
                <code className="font-mono text-xs">arn:aws:iam::{session.accountId}:root</code>)
                doesn't let everyone in. It delegates the decision: a user also needs a policy
                allowing <code className="font-mono text-xs">sts:AssumeRole</code> on this role.
              </Alert>
            )}
            {trustMode === "user" && (
              <UserPicker single selected={trustUser} onChange={setTrustUser} />
            )}
            {trustMode === "custom" && (
              <PolicyEditor
                value={customTrust}
                onChange={setCustomTrust}
                kind="trust"
                label="Trust policy"
                height="240px"
              />
            )}
            {trustMode !== "custom" && (
              <div>
                <Label>Trust policy that will be created</Label>
                <JsonBlock value={JSON.parse(trustDocument)} className="mt-1.5 max-h-56" />
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardHeader title="Add permissions" description="What anyone using the role can do." />
          <CardBody>
            <PolicyPicker selected={policies} onChange={setPolicies} />
          </CardBody>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader title="Name, review and create" />
          <CardBody className="max-w-2xl space-y-4">
            <Field
              label="Role name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={name && !nameValid ? "Use up to 64 letters, numbers and +=,.@-_" : undefined}
              autoFocus
            />
            <div className="grid gap-1.5">
              <Label htmlFor="role-description">Description</Label>
              <Textarea
                id="role-description"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
              />
            </div>
            <SelectField
              label="Maximum session duration"
              value={maxSession}
              onChange={(e) => setMaxSession(Number(e.target.value))}
              hint="How long a switched-role session lasts before you must switch again."
            >
              {[1, 2, 4, 8, 12].map((h) => (
                <option key={h} value={h * 3600}>
                  {h} hour{h > 1 ? "s" : ""}
                </option>
              ))}
            </SelectField>
            <div>
              <Label>Trust policy</Label>
              <JsonBlock value={safeParse(trustDocument)} className="mt-1.5 max-h-48" />
            </div>
            <p className="text-sm text-fg">
              <span className="text-muted">Permissions:</span>{" "}
              {policies.length ? `${policies.length} policies` : "None"}
            </p>
            <ApiErrorAlert error={create.error} />
          </CardBody>
        </Card>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button asChild variant="ghost">
          <Link to="/iam/roles">Cancel</Link>
        </Button>
        {step > 0 && (
          <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>
            Previous
          </Button>
        )}
        {step < 2 ? (
          <Button disabled={step === 0 && !trustReady} onClick={() => setStep((s) => s + 1)}>
            Next
          </Button>
        ) : (
          <Button
            disabled={!nameValid || create.isPending}
            onClick={() =>
              create.mutate(undefined, {
                onSuccess: () => navigate(`/iam/roles/${encodeURIComponent(name)}`),
              })
            }
          >
            {create.isPending ? "Creating…" : "Create role"}
          </Button>
        )}
      </div>
    </>
  );
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function TrustTab({ role }: { role: IamRole }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const validation = usePolicyValidation(text, "trust");
  const save = useIamMutation(() =>
    iamCall("UpdateAssumeRolePolicy", { RoleName: role.RoleName, PolicyDocument: text }),
  );
  return (
    <Card>
      <CardHeader
        title="Trusted entities"
        description="Entities that can assume this role under the conditions in the trust policy."
        actions={
          <Button
            size="sm"
            onClick={() => {
              setText(formatPolicyJson(role.AssumeRolePolicyDocument));
              save.reset();
              setEditing(true);
            }}
          >
            Edit trust policy
          </Button>
        }
      />
      <CardBody>
        <JsonBlock value={role.AssumeRolePolicyDocument} className="max-h-96" />
      </CardBody>
      <Dialog
        open={editing}
        onOpenChange={setEditing}
        size="lg"
        title="Edit trust policy"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              disabled={!validation.valid || save.isPending}
              onClick={() => save.mutate(undefined, { onSuccess: () => setEditing(false) })}
            >
              Update policy
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <PolicyEditor value={text} onChange={setText} kind="trust" label="Trust policy" />
          <ApiErrorAlert error={save.error} />
        </div>
      </Dialog>
    </Card>
  );
}

export function RoleDetailPage() {
  const { name = "" } = useParams();
  useTitle(name);
  const navigate = useNavigate();
  const session = useRequiredSession();
  const role = useIam<{ Role: IamRole }>("GetRole", { RoleName: name });
  const [deleting, setDeleting] = useState(false);
  const remove = useIamMutation(() => deleteRoleCompletely(name));
  const link = switchRoleUrl(session.accountId, name);
  return (
    <>
      <PageHeader
        crumbs={[...crumbs, { label: name }]}
        title={name}
        description={role.data?.Role.Description || undefined}
        actions={
          <Button variant="danger" size="sm" onClick={() => setDeleting(true)}>
            Delete
          </Button>
        }
      />
      {role.isPending ? (
        <Spinner />
      ) : role.isError ? (
        <ApiErrorAlert error={role.error} />
      ) : (
        <>
          <Card className="mb-6">
            <CardHeader title="Summary" />
            <CardBody>
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted">ARN</dt>
                  <dd className="flex items-start gap-1 font-mono text-xs break-all text-fg">
                    {role.data.Role.Arn}
                    <CopyButton value={role.data.Role.Arn} label="ARN" />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Created</dt>
                  <dd className="text-fg">{formatDateTime(role.data.Role.CreateDate)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Maximum session duration</dt>
                  <dd className="text-fg">{role.data.Role.MaxSessionDuration / 3600} hour(s)</dd>
                </div>
                <div className="sm:col-span-2 lg:col-span-4">
                  <dt className="text-xs text-muted">Link to switch roles in console</dt>
                  <dd className="flex items-start gap-1 font-mono text-xs break-all text-fg">
                    <Link
                      to={`/switchrole?account=${session.accountId}&roleName=${encodeURIComponent(name)}`}
                      className="text-brand hover:underline"
                    >
                      {link}
                    </Link>
                    <CopyButton value={link} label="switch role link" />
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>
          <Tabs
            urlParam="tab"
            tabs={[
              {
                id: "permissions",
                label: "Permissions",
                content: <PermissionsPanel kind="role" name={name} />,
              },
              {
                id: "trust",
                label: "Trust relationships",
                content: <TrustTab role={role.data.Role} />,
              },
            ]}
          />
        </>
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={(o) => {
          setDeleting(o);
          remove.reset();
        }}
        title={`Delete ${name}?`}
        confirmText={name}
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate(undefined, { onSuccess: () => navigate("/iam/roles") })}
      >
        <p>Policies are removed first, then the role. Anyone using the role right now loses it.</p>
      </ConfirmDialog>
    </>
  );
}
