import { Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/feedback";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";
import { deleteUserCompletely, useIamMutation, useUsers } from "../api";
import type { IamUserListItem } from "../types";

export function UsersPage() {
  useTitle("Users");
  const users = useUsers();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const remove = useIamMutation(async (names: string[]) => {
    for (const n of names) await deleteUserCompletely(n);
  });
  const confirmText = selected.length === 1 ? selected[0] : "delete";

  return (
    <>
      <PageHeader
        crumbs={[{ label: "IAM", to: "/iam" }, { label: "Users" }]}
        title="Users"
        description="An IAM user is a person or application that signs in to this account with its own credentials and only the permissions you give it."
      />
      <DataTable<IamUserListItem>
        title="Users"
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
              <Link to="/iam/users/create">
                <Plus className="size-4" aria-hidden /> Create user
              </Link>
            </Button>
          </>
        }
        rows={users.data?.Users}
        isLoading={users.isPending}
        error={users.error}
        getRowId={(u) => u.UserName}
        selectionMode="multi"
        selected={selected}
        onSelectedChange={setSelected}
        filterText={(u) => u.UserName}
        filterPlaceholder="Search users"
        emptyMessage="No users yet. Create one to stop using the root user."
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
          { key: "groups", header: "Groups", cell: (u) => u.GroupCount },
          {
            key: "console",
            header: "Console access",
            cell: (u) =>
              u.ConsoleAccess ? <Badge variant="success">Enabled</Badge> : <Badge>Disabled</Badge>,
          },
          {
            key: "lastUsed",
            header: "Last sign-in",
            hideOnMobile: true,
            cell: (u) =>
              u.PasswordLastUsed ? (
                formatRelative(u.PasswordLastUsed)
              ) : (
                <span className="text-muted">Never</span>
              ),
          },
          {
            key: "created",
            header: "Created",
            hideOnMobile: true,
            cell: (u) => (
              <span className="whitespace-nowrap text-muted">{formatDateTime(u.CreateDate)}</span>
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
        title={`Delete ${selected.length === 1 ? selected[0] : `${selected.length} users`}?`}
        confirmText={confirmText}
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
          The console removes the user's password, group memberships and policies first, then
          deletes the user. (The <code className="font-mono text-xs">DeleteUser</code> API alone
          would fail with <code className="font-mono text-xs">DeleteConflict</code> while any of
          those exist.)
        </p>
        <p>Anyone signed in as this user is signed out.</p>
      </ConfirmDialog>
    </>
  );
}
