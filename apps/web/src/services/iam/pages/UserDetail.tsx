import { FlaskConical } from "lucide-react";
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
import { Badge, Spinner } from "@/components/ui/feedback";
import { Field } from "@/components/ui/form";
import { Tabs } from "@/components/ui/tabs";
import { ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";
import { deleteUserCompletely, generatePassword, iamCall, useIam, useIamMutation } from "../api";
import { PermissionsPanel } from "../components/PermissionsPanel";
import { GroupPicker } from "../components/pickers";
import type { IamGroup, IamUser, ListGroupsForUserOutput, LoginProfile } from "../types";

function GroupsTab({ name }: { name: string }) {
  const groups = useIam<ListGroupsForUserOutput>("ListGroupsForUser", {
    UserName: name,
    MaxItems: 1000,
  });
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const add = useIamMutation(async () => {
    for (const g of picked) await iamCall("AddUserToGroup", { GroupName: g, UserName: name });
  });
  const remove = useIamMutation(async () => {
    for (const g of selected)
      await iamCall("RemoveUserFromGroup", { GroupName: g, UserName: name });
  });
  return (
    <>
      <DataTable<IamGroup>
        title="User groups membership"
        description="The user gets every permission of every group it belongs to."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={!selected.length || remove.isPending}
              onClick={() => remove.mutate(undefined, { onSuccess: () => setSelected([]) })}
            >
              Remove
            </Button>
            <Button size="sm" onClick={() => setAdding(true)}>
              Add user to groups
            </Button>
          </>
        }
        rows={groups.data?.Groups}
        isLoading={groups.isPending}
        error={groups.error ?? remove.error}
        getRowId={(g) => g.GroupName}
        selectionMode="multi"
        selected={selected}
        onSelectedChange={setSelected}
        emptyMessage="This user isn't in any group."
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
          {
            key: "arn",
            header: "ARN",
            hideOnMobile: true,
            cell: (g) => <span className="font-mono text-xs text-muted">{g.Arn}</span>,
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
        title={`Add ${name} to groups`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              disabled={!picked.length || add.isPending}
              onClick={() => add.mutate(undefined, { onSuccess: () => setAdding(false) })}
            >
              Add to groups
            </Button>
          </>
        }
      >
        <GroupPicker
          selected={picked}
          onChange={setPicked}
          exclude={groups.data?.Groups.map((g) => g.GroupName)}
        />
        <ApiErrorAlert error={add.error} className="mt-3" />
      </Dialog>
    </>
  );
}

function CredentialsTab({ name }: { name: string }) {
  const profile = useIam<{ LoginProfile: LoginProfile }>("GetLoginProfile", { UserName: name });
  const noProfile = profile.error instanceof ApiError && profile.error.code === "NoSuchEntity";
  const [dialog, setDialog] = useState<"enable" | "reset" | "disable" | null>(null);
  const [password, setPassword] = useState("");
  const save = useIamMutation(() =>
    dialog === "enable"
      ? iamCall("CreateLoginProfile", { UserName: name, Password: password })
      : dialog === "reset"
        ? iamCall("UpdateLoginProfile", { UserName: name, Password: password })
        : iamCall("DeleteLoginProfile", { UserName: name }),
  );
  const open = (d: typeof dialog) => {
    setPassword(generatePassword());
    save.reset();
    setDialog(d);
  };

  return (
    <Card>
      <CardHeader
        title="Console sign-in"
        description="A console password lets this user sign in on the CloudLearn sign-in page."
        actions={
          profile.isPending ? null : noProfile ? (
            <Button size="sm" onClick={() => open("enable")}>
              Enable console access
            </Button>
          ) : profile.data ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => open("disable")}>
                Disable
              </Button>
              <Button size="sm" onClick={() => open("reset")}>
                Reset password
              </Button>
            </>
          ) : null
        }
      />
      <CardBody className="text-sm">
        {profile.isPending ? (
          <Spinner />
        ) : noProfile ? (
          <p className="text-muted">Console access is disabled: this user has no password.</p>
        ) : profile.error ? (
          <ApiErrorAlert error={profile.error} />
        ) : (
          <p className="text-fg">
            Console access is <Badge variant="success">Enabled</Badge>
          </p>
        )}
        <p className="mt-4 text-xs text-muted">
          Access keys for the AWS CLI aren't simulated yet. CloudLearn is console-only for now.
        </p>
      </CardBody>
      {dialog === "disable" ? (
        <ConfirmDialog
          open
          onOpenChange={() => setDialog(null)}
          title="Disable console access?"
          confirmLabel="Disable"
          pending={save.isPending}
          error={save.error}
          onConfirm={() => save.mutate(undefined, { onSuccess: () => setDialog(null) })}
        >
          <p>
            The user's password is deleted (DeleteLoginProfile). Sessions already signed in keep
            working until they sign out.
          </p>
        </ConfirmDialog>
      ) : (
        <Dialog
          open={!!dialog}
          onOpenChange={(o) => !o && setDialog(null)}
          size="sm"
          title={dialog === "enable" ? "Enable console access" : "Reset console password"}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                disabled={password.length < 8 || save.isPending}
                onClick={() => save.mutate(undefined, { onSuccess: () => setDialog(null) })}
              >
                Save password
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="flex items-end gap-1">
              <Field
                className="flex-1"
                label="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                hint="At least 8 characters. Copy it now."
              />
              <CopyButton value={password} label="password" className="mb-6" />
            </div>
            <ApiErrorAlert error={save.error} />
          </div>
        </Dialog>
      )}
    </Card>
  );
}

export function UserDetailPage() {
  const { name = "" } = useParams();
  useTitle(name);
  const navigate = useNavigate();
  const user = useIam<{ User: IamUser }>("GetUser", { UserName: name });
  const profile = useIam<{ LoginProfile: LoginProfile }>("GetLoginProfile", { UserName: name });
  const [deleting, setDeleting] = useState(false);
  const remove = useIamMutation(() => deleteUserCompletely(name));

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "IAM", to: "/iam" },
          { label: "Users", to: "/iam/users" },
          { label: name },
        ]}
        title={name}
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <Link
                to={`/iam/simulator?principal=${encodeURIComponent(user.data?.User.Arn ?? "")}`}
              >
                <FlaskConical className="size-4" aria-hidden /> Simulate permissions
              </Link>
            </Button>
            <Button variant="danger" size="sm" onClick={() => setDeleting(true)}>
              Delete
            </Button>
          </>
        }
      />
      {user.isPending ? (
        <Spinner />
      ) : user.isError ? (
        <ApiErrorAlert error={user.error} />
      ) : (
        <>
          <Card className="mb-6">
            <CardHeader title="Summary" />
            <CardBody>
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted">ARN</dt>
                  <dd className="flex items-start gap-1 font-mono text-xs break-all text-fg">
                    {user.data.User.Arn}
                    <CopyButton value={user.data.User.Arn} label="ARN" />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Created</dt>
                  <dd className="text-fg">{formatDateTime(user.data.User.CreateDate)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Console access</dt>
                  <dd>
                    {profile.data ? (
                      <Badge variant="success">Enabled</Badge>
                    ) : (
                      <Badge>Disabled</Badge>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Last console sign-in</dt>
                  <dd className="text-fg">
                    {user.data.User.PasswordLastUsed
                      ? formatDateTime(user.data.User.PasswordLastUsed)
                      : "Never"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Unique ID</dt>
                  <dd className="font-mono text-xs text-fg">{user.data.User.UserId}</dd>
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
                content: <PermissionsPanel kind="user" name={name} />,
              },
              { id: "groups", label: "Groups", content: <GroupsTab name={name} /> },
              {
                id: "credentials",
                label: "Security credentials",
                content: <CredentialsTab name={name} />,
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
        onConfirm={() => remove.mutate(undefined, { onSuccess: () => navigate("/iam/users") })}
      >
        <p>
          The console first removes the user's password, groups and policies (the DeleteUser API
          alone would return DeleteConflict), then deletes the user.
        </p>
      </ConfirmDialog>
    </>
  );
}
