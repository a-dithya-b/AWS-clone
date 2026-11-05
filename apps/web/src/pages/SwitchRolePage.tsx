import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ApiErrorAlert } from "@/components/ApiErrorAlert";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { Field } from "@/components/ui/form";
import { useRequiredSession, useSwitchRole } from "@/lib/session";
import { useTitle } from "@/lib/useTitle";

/** The console's "Switch role" page: assume a role and get its permissions temporarily. */
export function SwitchRolePage() {
  useTitle("Switch role");
  const session = useRequiredSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const switchRole = useSwitchRole();
  const [account, setAccount] = useState(params.get("account") ?? session.accountId);
  const [roleName, setRoleName] = useState(params.get("roleName") ?? "");
  const [displayName, setDisplayName] = useState(params.get("displayName") ?? "");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    switchRole.mutate(
      { account, roleName, displayName: displayName || undefined },
      { onSuccess: () => navigate("/console") },
    );
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Switch role"
        description="Switching to a role swaps your permissions for the role's, temporarily. Your IAM user's own permissions don't apply while you're in the role."
      />
      {session.principal.type === "root" && (
        <Alert variant="warning" className="mb-4" title="The root user can't switch roles">
          Sign in as an IAM user first. That's how AWS works too.
        </Alert>
      )}
      <Card>
        <CardBody>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field
              label="Account ID or alias"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              hint="The account that owns the role. It can be another sandbox account on this computer."
            />
            <Field
              label="Role name"
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              autoFocus={!roleName}
            />
            <Field
              label="Display name (optional)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              hint="Shown in the top bar while you use the role."
            />
            <ApiErrorAlert error={switchRole.error} />
            <div className="flex justify-end gap-2">
              <Button asChild variant="ghost">
                <Link to="/console">Cancel</Link>
              </Button>
              <Button type="submit" disabled={!account || !roleName || switchRole.isPending}>
                {switchRole.isPending ? "Switching…" : "Switch role"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
      <div className="mt-6 space-y-2 text-sm text-muted">
        <p className="font-medium text-fg">What has to be true to switch?</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            The role's trust policy must allow you (or your whole account) to call sts:AssumeRole.
          </li>
          <li>
            If it trusts the whole account rather than you by name, your own policies must also
            allow sts:AssumeRole on the role.
          </li>
          <li>
            The session ends after the role's maximum session duration. Then you're back to signing
            in.
          </li>
        </ul>
      </div>
    </div>
  );
}
