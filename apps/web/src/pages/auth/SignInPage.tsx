import { type FormEvent, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { ApiErrorAlert } from "@/components/ApiErrorAlert";
import { Button } from "@/components/ui/button";
import { RadioCards } from "@/components/ui/controls";
import { Field } from "@/components/ui/form";
import { useSession, useSignIn } from "@/lib/session";
import { safeNextPath, useTitle } from "@/lib/useTitle";
import { AuthLayout } from "./AuthLayout";

type SignInAs = "root" | "iam";

const LAST_ACCOUNT_KEY = "cloudlearn:last-iam-account";

function readLastAccount(): string {
  try {
    return localStorage.getItem(LAST_ACCOUNT_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberAccount(account: string) {
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, account);
  } catch {
    // Storage can be unavailable (private mode); remembering is only a convenience.
  }
}

export function SignInPage() {
  useTitle("Sign in");
  const session = useSession();
  const signIn = useSignIn();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const accountParam = params.get("account");
  const [as, setAs] = useState<SignInAs>(accountParam ? "iam" : "root");
  const [email, setEmail] = useState("");
  const [account, setAccount] = useState(() => accountParam ?? readLastAccount());
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  if (session.data?.signedIn) return <Navigate to={next} replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const done = { onSuccess: () => navigate(next, { replace: true }) };
    if (as === "root") {
      signIn.mutate({ type: "root", email, password }, done);
    } else {
      rememberAccount(account);
      signIn.mutate({ type: "iam", account, username, password }, done);
    }
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
        <RadioCards
          name="signInAs"
          legend="Sign in as"
          value={as}
          onChange={(v) => {
            setAs(v);
            signIn.reset();
          }}
          options={[
            {
              value: "root",
              title: "Root user",
              description: "The account owner. Can do everything, so use it sparingly.",
            },
            {
              value: "iam",
              title: "IAM user",
              description: "A user inside an account, with only the permissions it's been given.",
            },
          ]}
        />

        {as === "root" ? (
          <Field
            label="Root user email address"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        ) : (
          <>
            <Field
              label="Account ID (12 digits) or account alias"
              autoComplete="organization"
              required
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
            <Field
              label="IAM user name"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </>
        )}
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <ApiErrorAlert error={signIn.error} title="Couldn't sign in" />

        <Button type="submit" className="w-full" disabled={signIn.isPending}>
          {signIn.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}
