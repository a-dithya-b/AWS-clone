import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { ApiErrorAlert } from "@/components/ApiErrorAlert";
import { CopyButton } from "@/components/CopyButton";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CheckboxCard, RadioCards, Steps } from "@/components/ui/controls";
import { Alert } from "@/components/ui/feedback";
import { Field } from "@/components/ui/form";
import { useRequiredSession } from "@/lib/session";
import { useTitle } from "@/lib/useTitle";
import { generatePassword, iamCall, signInUrl, useIamMutation, usePolicies } from "../api";
import { GroupPicker, PolicyPicker } from "../components/pickers";

const NAME_RE = /^[\w+=,.@-]{1,64}$/;

type PermissionMode = "groups" | "policies" | "none";

export function CreateUserPage() {
  useTitle("Create user");
  const session = useRequiredSession();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [console_, setConsole] = useState(true);
  const [passwordMode, setPasswordMode] = useState<"auto" | "custom">("auto");
  const [password, setPassword] = useState(() => generatePassword());
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<PermissionMode>("policies");
  const [groups, setGroups] = useState<string[]>([]);
  const [policies, setPolicies] = useState<string[]>([]);
  const allPolicies = usePolicies();

  const nameError =
    name && !NAME_RE.test(name) ? "Use up to 64 letters, numbers and +=,.@-_" : undefined;
  const passwordError = console_ && password.length < 8 ? "At least 8 characters." : undefined;

  const create = useIamMutation(async () => {
    await iamCall("CreateUser", { UserName: name });
    if (console_) await iamCall("CreateLoginProfile", { UserName: name, Password: password });
    if (mode === "groups")
      for (const g of groups) await iamCall("AddUserToGroup", { GroupName: g, UserName: name });
    if (mode === "policies")
      for (const arn of policies)
        await iamCall("AttachUserPolicy", { UserName: name, PolicyArn: arn });
  });

  const account = session.accountAlias ?? session.accountId;

  if (create.isSuccess) {
    const url = signInUrl(account);
    return (
      <>
        <PageHeader
          crumbs={[
            { label: "IAM", to: "/iam" },
            { label: "Users", to: "/iam/users" },
            { label: "Create user" },
          ]}
          title="User created"
        />
        <Alert variant="success" title={`User ${name} was created`} className="mb-6">
          {console_
            ? "Save the password now: like in AWS, it won't be shown again."
            : "This user has no console password. You can add one later under Security credentials."}
        </Alert>
        {console_ && (
          <Card>
            <CardHeader
              title="Console sign-in details"
              description="Share these with the user. To try them yourself, open the URL in a private window so you stay signed in here."
            />
            <CardBody>
              <dl className="space-y-3 text-sm">
                {[
                  ["Console sign-in URL", url],
                  ["User name", name],
                  ["Console password", password],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-muted">{k}</dt>
                    <dd className="flex items-center gap-1 font-mono break-all text-fg">
                      {v}
                      <CopyButton value={v as string} label={k as string} />
                    </dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
        )}
        <div className="mt-6 flex gap-2">
          <Button asChild>
            <Link to={`/iam/users/${encodeURIComponent(name)}`}>View user</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/iam/users">Back to users</Link>
          </Button>
        </div>
      </>
    );
  }

  const policyNames = (allPolicies.data?.Policies ?? [])
    .filter((p) => policies.includes(p.Arn))
    .map((p) => p.PolicyName);

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "IAM", to: "/iam" },
          { label: "Users", to: "/iam/users" },
          { label: "Create user" },
        ]}
        title="Create user"
      />
      <Steps steps={["User details", "Permissions", "Review and create"]} current={step} />

      {step === 0 && (
        <Card>
          <CardHeader title="User details" />
          <CardBody className="max-w-xl space-y-5">
            <Field
              label="User name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={nameError}
              hint="Unique in this account, ignoring case. Letters, numbers and +=,.@-_"
              autoFocus
            />
            <CheckboxCard
              checked={console_}
              onChange={setConsole}
              title="Provide access to the console"
              description="Gives the user a password so they can sign in on the CloudLearn sign-in page."
            />
            {console_ && (
              <div className="space-y-3">
                <RadioCards
                  name="passwordMode"
                  legend="Console password"
                  value={passwordMode}
                  onChange={(v) => {
                    setPasswordMode(v);
                    setPassword(v === "auto" ? generatePassword() : "");
                    setShowPassword(v === "custom");
                  }}
                  columns={2}
                  options={[
                    {
                      value: "auto",
                      title: "Autogenerated password",
                      description: "You'll see it once after creating the user.",
                    },
                    {
                      value: "custom",
                      title: "Custom password",
                      description: "At least 8 characters.",
                    },
                  ]}
                />
                <div className="flex items-end gap-2">
                  <Field
                    className="flex-1"
                    label="Password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    readOnly={passwordMode === "auto"}
                    error={passwordError}
                    autoComplete="new-password"
                  />
                  <Button
                    variant="secondary"
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((s) => !s)}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                  {passwordMode === "auto" && (
                    <Button
                      variant="secondary"
                      type="button"
                      aria-label="Generate a new password"
                      onClick={() => setPassword(generatePassword())}
                    >
                      <RefreshCw className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardHeader
            title="Set permissions"
            description="Without any policy, the user can sign in but is denied every action."
          />
          <CardBody className="space-y-4">
            <RadioCards
              name="permissionMode"
              value={mode}
              onChange={setMode}
              columns={3}
              options={[
                {
                  value: "groups",
                  title: "Add user to group",
                  description: "Recommended: permissions by job role.",
                },
                {
                  value: "policies",
                  title: "Attach policies directly",
                  description: "Quick, but harder to manage at scale.",
                },
                {
                  value: "none",
                  title: "No permissions",
                  description: "See default deny in action.",
                },
              ]}
            />
            {mode === "groups" && <GroupPicker selected={groups} onChange={setGroups} />}
            {mode === "policies" && <PolicyPicker selected={policies} onChange={setPolicies} />}
          </CardBody>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader title="Review and create" />
          <CardBody>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted">User name</dt>
                <dd className="font-medium text-fg">{name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Console access</dt>
                <dd className="text-fg">
                  {console_
                    ? `Enabled (${passwordMode === "auto" ? "autogenerated" : "custom"} password)`
                    : "Disabled"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted">Permissions</dt>
                <dd className="text-fg">
                  {mode === "groups" &&
                    (groups.length ? `Groups: ${groups.join(", ")}` : "No groups selected")}
                  {mode === "policies" &&
                    (policyNames.length
                      ? `Policies: ${policyNames.join(", ")}`
                      : "No policies selected")}
                  {mode === "none" && "None. Every action will be denied."}
                </dd>
              </div>
            </dl>
            <ApiErrorAlert error={create.error} className="mt-4" />
            {create.isError && (
              <p className="mt-2 text-sm text-muted">
                Some steps may have succeeded. Check the{" "}
                <Link className="text-brand hover:underline" to="/iam/users">
                  users list
                </Link>
                .
              </p>
            )}
          </CardBody>
        </Card>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button asChild variant="ghost">
          <Link to="/iam/users">Cancel</Link>
        </Button>
        {step > 0 && (
          <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>
            Previous
          </Button>
        )}
        {step < 2 ? (
          <Button
            disabled={step === 0 && (!name || !!nameError || !!passwordError)}
            onClick={() => setStep((s) => s + 1)}
          >
            Next
          </Button>
        ) : (
          <Button disabled={create.isPending} onClick={() => create.mutate(undefined)}>
            {create.isPending ? "Creating…" : "Create user"}
          </Button>
        )}
      </div>
    </>
  );
}
