import { Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiErrorAlert } from "@/components/ApiErrorAlert";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CopyButton } from "@/components/CopyButton";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/feedback";
import { Field } from "@/components/ui/form";
import { Tabs } from "@/components/ui/tabs";
import { formatDateTime } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";
import { deleteGroupCompletely, iamCall, useGroups, useIam, useIamMutation } from "../api";
import { PermissionsPanel } from "../components/PermissionsPanel";
import { PolicyPicker, UserPicker } from "../components/pickers";
import type { GetGroupOutput, IamGroupListItem, IamUser } from "../types";

const crumbs = [
  { label: "IAM", to: "/iam" },
  { label: "User groups", to: "/iam/groups" },
];

export function GroupsPage() {
  useTitle("User groups");
  const groups = useGroups();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const remove = useIamMutation(async (names: string[]) => {
    for (const n of names) await deleteGroupCompletely(n);
  });
  return (
    <>
      <PageHeader
        crumbs={[{ label: "IAM", to: "/iam" }, { label: "User groups" }]}
        title="User groups"
        description="A group is a collection of users. Attach policies to the group, and every member gets them."
      />
      <DataTable<IamGroupListItem>
        title="User groups"
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
              <Link to="/iam/groups/create">
                <Plus className="size-4" aria-hidden /> Create group
              </Link>
            </Button>
          </>
        }
        rows={groups.data?.Groups}
        isLoading={groups.isPending}
        error={groups.error}
        getRowId={(g) => g.GroupName}
        selectionMode="multi"
        selected={selected}
        onSelectedChange={setSelected}
        filterText={(g) => g.GroupName}
        filterPlaceholder="Search groups"
        emptyMessage="No groups yet. Groups make it easy to give many users the same permissions."
        columns={[
          {
            key: "name",
            header: "Group name",
            cell: (g) => (
              <Link
                to={`/iam/groups/${encodeURIComponent(g.GroupName)}`}
                className="font-medium text-brand hover:underline"
              >
                {g.GroupName}
              </Link>
            ),
          },
          { key: "users", header: "Users", cell: (g) => g.UserCount },
          { key: "policies", header: "Policies", cell: (g) => g.PolicyCount },
          {
            key: "created",
            header: "Created",
            hideOnMobile: true,
            cell: (g) => <span className="text-muted">{formatDateTime(g.CreateDate)}</span>,
          },
        ]}
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={(o) => {
          setConfirming(o);
          remove.reset();
        }}
        title={`Delete ${selected.length === 1 ? selected[0] : `${selected.length} groups`}?`}
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
        <p>
          Members are removed and policies detached first (DeleteGroup fails with DeleteConflict
          otherwise). The users themselves aren't deleted.
        </p>
      </ConfirmDialog>
    </>
  );
}

export function CreateGroupPage() {
  useTitle("Create user group");
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [users, setUsers] = useState<string[]>([]);
  const [policies, setPolicies] = useState<string[]>([]);
  const valid = /^[\w+=,.@-]{1,128}$/.test(name);
  const create = useIamMutation(async () => {
    await iamCall("CreateGroup", { GroupName: name });
    for (const u of users) await iamCall("AddUserToGroup", { GroupName: name, UserName: u });
    for (const arn of policies)
      await iamCall("AttachGroupPolicy", { GroupName: name, PolicyArn: arn });
  });
  return (
    <>
      <PageHeader crumbs={[...crumbs, { label: "Create user group" }]} title="Create user group" />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Name the group" />
          <CardBody className="max-w-xl">
            <Field
              label="User group name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={name && !valid ? "Use up to 128 letters, numbers and +=,.@-_" : undefined}
              hint="Name it after a job role, e.g. developers or auditors."
              autoFocus
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Add users to the group" description="Optional." />
          <CardBody>
            <UserPicker selected={users} onChange={setUsers} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Attach permissions policies"
            description="Optional. Every member gets these permissions."
          />
          <CardBody>
            <PolicyPicker selected={policies} onChange={setPolicies} />
          </CardBody>
        </Card>
        <ApiErrorAlert error={create.error} />
        <div className="flex justify-end gap-2">
          <Button asChild variant="ghost">
            <Link to="/iam/groups">Cancel</Link>
          </Button>
          <Button
            disabled={!valid || create.isPending}
            onClick={() =>
              create.mutate(undefined, {
                onSuccess: () => navigate(`/iam/groups/${encodeURIComponent(name)}`),
              })
            }
          >
            {create.isPending ? "Creating…" : "Create user group"}
          </Button>
        </div>
      </div>
    </>
  );
}

function MembersTab({ name, users }: { name: string; users: IamUser[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const add = useIamMutation(async () => {
    for (const u of picked) await iamCall("AddUserToGroup", { GroupName: name, UserName: u });
  });
  const remove = useIamMutation(async () => {
    for (const u of selected)
      await iamCall("RemoveUserFromGroup", { GroupName: name, UserName: u });
  });
  return (
    <>
      <DataTable<IamUser>
        title="Users in this group"
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={!selected.length || remove.isPending}
              onClick={() => remove.mutate(undefined, { onSuccess: () => setSelected([]) })}
            >
              Remove users
            </Button>
            <Button size="sm" onClick={() => setAdding(true)}>
              Add users
            </Button>
          </>
        }
        rows={users}
        error={remove.error}
        getRowId={(u) => u.UserName}
        selectionMode="multi"
        selected={selected}
        onSelectedChange={setSelected}
        emptyMessage="No users in this group."
        columns={[
          {
            key: "name",
            header: "User name",
            cell: (u) => (
              <Link
                to={`/iam/users/${encodeURIComponent(u.UserName)}`}
                className="font-medium text-brand hover:underline"
              >
                {u.UserName}
              </Link>
            ),
          },
          {
            key: "created",
            header: "Created",
            hideOnMobile: true,
            cell: (u) => <span className="text-muted">{formatDateTime(u.CreateDate)}</span>,
          },
        ]}
      />
      <Dialog
        open={adding}
        onOpenChange={(o) => {
          setAdding(o);
          setPicked([]);
          add.reset();
        }}
        size="lg"
        title={`Add users to ${name}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              disabled={!picked.length || add.isPending}
              onClick={() => add.mutate(undefined, { onSuccess: () => setAdding(false) })}
            >
              Add users
            </Button>
          </>
        }
      >
        <UserPicker selected={picked} onChange={setPicked} exclude={users.map((u) => u.UserName)} />
        <ApiErrorAlert error={add.error} className="mt-3" />
      </Dialog>
    </>
  );
}

export function GroupDetailPage() {
  const { name = "" } = useParams();
  useTitle(name);
  const navigate = useNavigate();
  const group = useIam<GetGroupOutput>("GetGroup", { GroupName: name, MaxItems: 1000 });
  const [deleting, setDeleting] = useState(false);
  const remove = useIamMutation(() => deleteGroupCompletely(name));
  return (
    <>
      <PageHeader
        crumbs={[...crumbs, { label: name }]}
        title={name}
        actions={
          <Button variant="danger" size="sm" onClick={() => setDeleting(true)}>
            Delete
          </Button>
        }
      />
      {group.isPending ? (
        <Spinner />
      ) : group.isError ? (
        <ApiErrorAlert error={group.error} />
      ) : (
        <>
          <Card className="mb-6">
            <CardHeader title="Summary" />
            <CardBody>
              <dl className="grid gap-4 text-sm sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted">ARN</dt>
                  <dd className="flex items-start gap-1 font-mono text-xs break-all text-fg">
                    {group.data.Group.Arn}
                    <CopyButton value={group.data.Group.Arn} label="ARN" />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Created</dt>
                  <dd className="text-fg">{formatDateTime(group.data.Group.CreateDate)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
          <Tabs
            urlParam="tab"
            tabs={[
              {
                id: "users",
                label: `Users (${group.data.Users.length})`,
                content: <MembersTab name={name} users={group.data.Users} />,
              },
              {
                id: "permissions",
                label: "Permissions",
                content: <PermissionsPanel kind="group" name={name} />,
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
        onConfirm={() => remove.mutate(undefined, { onSuccess: () => navigate("/iam/groups") })}
      >
        <p>Members are removed and policies detached first, then the group is deleted.</p>
      </ConfirmDialog>
    </>
  );
}
