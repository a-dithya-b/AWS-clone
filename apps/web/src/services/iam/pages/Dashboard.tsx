import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ShieldAlert, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { ApiErrorAlert } from "@/components/ApiErrorAlert";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CopyButton } from "@/components/CopyButton";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Spinner } from "@/components/ui/feedback";
import { Field } from "@/components/ui/form";
import { SESSION_KEY, useRequiredSession } from "@/lib/session";
import { useTitle } from "@/lib/useTitle";
import { iamCall, signInUrl, useIam, useIamMutation } from "../api";
import type { AccountSummary } from "../types";

function AliasDialog({
  open,
  onOpenChange,
  current,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  current: string | null;
}) {
  const [alias, setAlias] = useState(current ?? "");
  const queryClient = useQueryClient();
  const save = useIamMutation(() => iamCall("CreateAccountAlias", { AccountAlias: alias }));
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setAlias(current ?? "");
        save.reset();
        onOpenChange(o);
      }}
      size="sm"
      title={current ? "Edit account alias" : "Create account alias"}
      description="A friendly name IAM users can type instead of the 12-digit account ID when they sign in."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!alias || save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () => {
                  queryClient.invalidateQueries({ queryKey: SESSION_KEY });
                  onOpenChange(false);
                },
              })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label="Account alias"
          value={alias}
          onChange={(e) => setAlias(e.target.value.toLowerCase())}
          hint="3–63 lowercase letters, digits and hyphens. Must be unique."
        />
        <ApiErrorAlert error={save.error} />
      </div>
    </Dialog>
  );
}

export function IamDashboard() {
  useTitle("IAM Dashboard");
  const session = useRequiredSession();
  const queryClient = useQueryClient();
  const summary = useIam<AccountSummary>("GetAccountSummary");
  const aliases = useIam<{ AccountAliases: string[] }>("ListAccountAliases");
  const alias = aliases.data?.AccountAliases[0] ?? session.accountAlias;
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const remove = useIamMutation(() => iamCall("DeleteAccountAlias", { AccountAlias: alias }));
  const url = signInUrl(alias ?? session.accountId);

  const counts = [
    { label: "User groups", key: "Groups", to: "/iam/groups" },
    { label: "Users", key: "Users", to: "/iam/users" },
    { label: "Roles", key: "Roles", to: "/iam/roles" },
    { label: "Customer managed policies", key: "Policies", to: "/iam/policies?scope=Local" },
  ];

  return (
    <>
      <PageHeader
        title="IAM Dashboard"
        description="Identity and Access Management decides who can sign in to this account and what each identity is allowed to do."
      />

      {session.principal.type === "root" && (
        <Alert
          variant="warning"
          title="Security recommendation: stop using the root user"
          className="mb-6"
        >
          <p>
            Create an IAM user with administrator permissions and use it for daily work. Keep the
            root user for the few tasks only it can do.
          </p>
          <Button asChild size="sm" className="mt-2">
            <Link to="/iam/users/create">
              <UserPlus className="size-4" aria-hidden /> Create an IAM user
            </Link>
          </Button>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="IAM resources" description="What exists in this account right now." />
          <CardBody>
            {summary.isPending ? (
              <Spinner />
            ) : summary.isError ? (
              <ApiErrorAlert error={summary.error} />
            ) : (
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {counts.map((c) => (
                  <div key={c.key}>
                    <dt className="text-xs text-muted">{c.label}</dt>
                    <dd>
                      <Link to={c.to} className="text-2xl font-semibold text-brand hover:underline">
                        {summary.data.SummaryMap[c.key] ?? 0}
                      </Link>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="AWS account" />
          <CardBody className="space-y-4 text-sm">
            <div>
              <p className="text-xs text-muted">Account ID</p>
              <p className="flex items-center gap-1 font-mono text-fg">
                {session.accountId}
                <CopyButton value={session.accountId} label="account ID" />
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Account alias</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-fg">{alias ?? "None"}</span>
                <Button variant="link" size="sm" onClick={() => setEditing(true)}>
                  {alias ? "Edit" : "Create"}
                </Button>
                {alias && (
                  <Button
                    variant="link"
                    size="sm"
                    className="text-danger"
                    onClick={() => setDeleting(true)}
                  >
                    Delete
                  </Button>
                )}
              </div>
              <ApiErrorAlert error={aliases.error} />
            </div>
            <div>
              <p className="text-xs text-muted">Sign-in URL for IAM users in this account</p>
              <p className="flex items-start gap-1 font-mono text-xs break-all text-fg">
                {url}
                <CopyButton value={url} label="sign-in URL" />
              </p>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Things to try" />
        <CardBody>
          <ul className="grid gap-3 sm:grid-cols-2">
            {[
              {
                to: "/iam/users/create",
                title: "Create a user and sign in as them",
                body: "Give them a console password, then sign in in a private window.",
              },
              {
                to: "/iam/policies/create",
                title: "Write your first policy",
                body: "Allow one action, then watch everything else stay denied.",
              },
              {
                to: "/iam/roles/create",
                title: "Create a role to switch into",
                body: "Learn trust policies and temporary permissions.",
              },
              {
                to: "/iam/simulator",
                title: "Test permissions without risk",
                body: "The policy simulator explains every decision.",
              },
            ].map((t) => (
              <li key={t.to}>
                <Link
                  to={t.to}
                  className="group flex h-full items-start gap-3 rounded-md border border-border p-3 hover:border-brand"
                >
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 text-sm font-medium text-fg group-hover:text-brand">
                      {t.title} <ArrowRight className="size-3.5" aria-hidden />
                    </span>
                    <span className="text-xs text-muted">{t.body}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <AliasDialog open={editing} onOpenChange={setEditing} current={alias ?? null} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete account alias?"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: SESSION_KEY });
              setDeleting(false);
            },
          })
        }
      >
        <p>IAM users will need the 12-digit account ID to sign in.</p>
      </ConfirmDialog>
    </>
  );
}
