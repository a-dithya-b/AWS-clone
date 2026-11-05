import { type FormEvent, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { useSession, useSignIn } from "@/lib/session";
import { safeNextPath, useTitle } from "@/lib/useTitle";
import { AuthLayout } from "./AuthLayout";

type SignInAs = "root" | "iam";

const options: { value: SignInAs; title: string; description: string; disabled?: boolean }[] = [
  {
    value: "root",
    title: "Root user",
    description: "The account owner. Can do everything, so use it sparingly.",
  },
  {
    value: "iam",
    title: "IAM user",
    description:
      "A user inside an account, with only the permissions it's given. Arrives with IAM.",
    disabled: true,
  },
];

export function SignInPage() {
  useTitle("Sign in");
  const session = useSession();
  const signIn = useSignIn();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const [as, setAs] = useState<SignInAs>("root");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (session.data?.signedIn) return <Navigate to={next} replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    signIn.mutate(
      { type: "root", email, password },
      { onSuccess: () => navigate(next, { replace: true }) },
    );
  };

  return (
    <AuthLayout
      title="Sign in"
      subtitle={
        <>
          New here?{" "}
          <Link to="/signup" className="font-medium text-brand hover:underline">
            Create a sandbox account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg">Sign in as</legend>
          <div className="grid gap-2">
            {options.map((o) => (
              <label
                key={o.value}
                className={cn(
                  "flex gap-3 rounded-md border p-3",
                  as === o.value ? "border-brand bg-brand-soft" : "border-border",
                  o.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                )}
              >
                <input
                  type="radio"
                  name="signInAs"
                  value={o.value}
                  checked={as === o.value}
                  disabled={o.disabled}
                  onChange={() => setAs(o.value)}
                  className="mt-1 accent-brand"
                />
                <span>
                  <span className="block text-sm font-medium text-fg">{o.title}</span>
                  <span className="block text-xs text-muted">{o.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <Field
          label="Root user email address"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {signIn.error && <Alert variant="error">{signIn.error.message}</Alert>}

        <Button type="submit" className="w-full" disabled={signIn.isPending}>
          {signIn.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}
