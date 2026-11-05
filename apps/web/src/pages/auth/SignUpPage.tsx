import { SignUpInput } from "@cloudlearn/shared";
import { type FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { ApiErrorAlert } from "@/components/ApiErrorAlert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { useSession, useSignUp } from "@/lib/session";
import { useTitle } from "@/lib/useTitle";
import { AuthLayout } from "./AuthLayout";

type Errors = Partial<Record<"email" | "accountName" | "password" | "confirm", string>>;

export function SignUpPage() {
  useTitle("Create account");
  const session = useSession();
  const signUp = useSignUp();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", accountName: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Errors>({});

  if (session.data?.signedIn && !signUp.isSuccess) return <Navigate to="/console" replace />;

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Same schema the server uses, so the rules can't drift apart.
    const parsed = SignUpInput.safeParse(form);
    const next: Errors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof Errors;
        next[key] ??= issue.message;
      }
    }
    if (form.password !== form.confirm) next.confirm = "Passwords don't match.";
    setErrors(next);
    if (!parsed.success || next.confirm) return;
    signUp.mutate(parsed.data, {
      onSuccess: () => navigate("/console?welcome=1", { replace: true }),
    });
  };

  return (
    <AuthLayout
      title="Create a sandbox account"
      subtitle={
        <>
          Already have one?{" "}
          <Link to="/signin" className="font-medium text-brand hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field
          label="Root user email address"
          type="email"
          autoComplete="email"
          hint="Used to sign in as the root user. Nothing is ever sent to it."
          value={form.email}
          onChange={set("email")}
          error={errors.email}
        />
        <Field
          label="Account name"
          autoComplete="organization"
          hint="A friendly name for this account, like “my-sandbox”."
          value={form.accountName}
          onChange={set("accountName")}
          error={errors.accountName}
        />
        <Field
          label="Root user password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters."
          value={form.password}
          onChange={set("password")}
          error={errors.password}
        />
        <Field
          label="Confirm root user password"
          type="password"
          autoComplete="new-password"
          value={form.confirm}
          onChange={set("confirm")}
          error={errors.confirm}
        />

        <ApiErrorAlert error={signUp.error} title="Couldn't create the account" />

        <Button type="submit" className="w-full" disabled={signUp.isPending}>
          {signUp.isPending ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}
