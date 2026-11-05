import type { GetCallerIdentityOutput, LookupEventsOutput } from "@cloudlearn/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CircleCheck, CircleDashed } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { ApiErrorAlert, isAccessDenied } from "@/components/ApiErrorAlert";
import { CopyButton } from "@/components/CopyButton";
import { EventTable } from "@/components/EventTable";
import { PageHeader } from "@/components/PageHeader";
import { ServiceIcon } from "@/components/ServiceIcon";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, Badge, Spinner } from "@/components/ui/feedback";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useRequiredSession } from "@/lib/session";
import { useTitle } from "@/lib/useTitle";
import { services } from "@/services/registry";

function IdentityCard() {
  const identity = useQuery({
    queryKey: ["sts", "GetCallerIdentity"],
    queryFn: () => api.action<GetCallerIdentityOutput>("sts", "GetCallerIdentity"),
  });
  const rows: { label: string; value?: string; help: string }[] = [
    { label: "Account", value: identity.data?.Account, help: "Your 12-digit account ID." },
    {
      label: "UserId",
      value: identity.data?.UserId,
      help: "A unique ID for you. For the root user, it's the account ID.",
    },
    {
      label: "Arn",
      value: identity.data?.Arn,
      help: "Amazon Resource Name: the full name IAM policies use to refer to you.",
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Who am I?"
        description={
          <>
            The result of <code className="font-mono text-xs">sts:GetCallerIdentity</code>, the call
            that works with no permissions at all.
          </>
        }
      />
      <CardBody>
        {identity.isPending ? (
          <Spinner />
        ) : identity.isError ? (
          <ApiErrorAlert error={identity.error} />
        ) : (
          <dl className="space-y-3">
            {rows.map((r) => (
              <div key={r.label}>
                <dt className="text-xs font-medium text-muted">{r.label}</dt>
                <dd className="flex items-start gap-1 font-mono text-sm break-all text-fg">
                  {r.value}
                  {r.value && <CopyButton value={r.value} label={r.label} />}
                </dd>
                <p className="text-xs text-muted">{r.help}</p>
              </div>
            ))}
          </dl>
        )}
      </CardBody>
    </Card>
  );
}

function RecentActivityCard() {
  const events = useQuery({
    queryKey: ["cloudtrail", "LookupEvents", "recent"],
    queryFn: () => api.action<LookupEventsOutput>("cloudtrail", "LookupEvents", { MaxResults: 8 }),
    refetchInterval: 5000,
  });
  return (
    <Card>
      <CardHeader
        title="Recent activity"
        description="Every API call in your account is recorded, including denied ones."
        actions={
          <Link
            to="/cloudtrail"
            className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
          >
            Event history <ArrowRight className="size-3.5" />
          </Link>
        }
      />
      {events.isPending ? (
        <CardBody>
          <Spinner />
        </CardBody>
      ) : events.isError ? (
        <CardBody>
          {isAccessDenied(events.error) ? (
            <div className="space-y-3 text-sm">
              <p className="text-fg">
                You can't see the activity log: your identity isn't allowed{" "}
                <code className="font-mono text-xs">cloudtrail:LookupEvents</code>. That's IAM
                working as intended. Everything is denied unless a policy allows it.
              </p>
              <ApiErrorAlert error={events.error} title="Why can't I see this?" />
            </div>
          ) : (
            <ApiErrorAlert error={events.error} />
          )}
        </CardBody>
      ) : events.data.Events.length === 0 ? (
        <CardBody className="text-sm text-muted">No activity yet.</CardBody>
      ) : (
        <EventTable events={events.data.Events} compact />
      )}
    </Card>
  );
}

function ServicesCard() {
  return (
    <Card>
      <CardHeader title="Services" description="New services unlock as CloudLearn grows." />
      <CardBody className="grid gap-3 sm:grid-cols-2">
        {services.map((s) => (
          <Link
            key={s.id}
            to={`/${s.id}`}
            className="group flex items-start gap-3 rounded-md border border-border p-3 hover:border-brand hover:bg-brand-soft/40"
          >
            <ServiceIcon service={s} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-fg group-hover:text-brand">
                  {s.shortName}
                </p>
                {s.status === "coming-soon" && <Badge>{s.roadmap?.phase ?? "Soon"}</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-muted">{s.description}</p>
            </div>
          </Link>
        ))}
      </CardBody>
    </Card>
  );
}

function LearningPathCard() {
  const session = useRequiredSession();
  const summary = useQuery({
    queryKey: ["iam", "GetAccountSummary", {}],
    queryFn: () => api.action<{ SummaryMap: Record<string, number> }>("iam", "GetAccountSummary"),
    retry: false,
  });
  const events = useQuery({
    queryKey: ["cloudtrail", "LookupEvents", "recent"],
    queryFn: () => api.action<LookupEventsOutput>("cloudtrail", "LookupEvents", { MaxResults: 8 }),
    retry: false,
  });
  const type = session.principal.type;
  const sawDenied = events.data?.Events.some((e) => e.ErrorCode === "AccessDenied") ?? false;
  const steps: { title: string; body: ReactNode; done?: boolean }[] = [
    { title: "Create your sandbox account", body: "You did this already.", done: true },
    {
      title: "Create an IAM user with a console password",
      body: (
        <>
          As root, open{" "}
          <Link to="/iam/users/create" className="text-brand hover:underline">
            IAM → Create user
          </Link>
          .
        </>
      ),
      done: (summary.data?.SummaryMap.Users ?? 0) > 0 || type !== "root",
    },
    {
      title: "Sign in as that IAM user",
      body: "Use the sign-in URL from the IAM dashboard, ideally in a private window.",
      done: type !== "root",
    },
    {
      title: "Get an AccessDenied and read why",
      body: "Try something your user isn't allowed to do, then click “Why was this denied?”.",
      done: sawDenied,
    },
    {
      title: "Switch into a role",
      body: "Create a role that trusts your user, then use Switch role in the account menu.",
      done: type === "assumed-role",
    },
    { title: "SQS: queues and the live simulator", body: "Arrives in Phase 3." },
  ];
  return (
    <Card>
      <CardHeader title="Learning path" />
      <CardBody>
        <ol className="space-y-3">
          {steps.map((s) => (
            <li key={s.title} className="flex gap-3">
              {s.done ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-label="Done" />
              ) : (
                <CircleDashed
                  className="mt-0.5 size-4 shrink-0 text-muted"
                  aria-label="Not done yet"
                />
              )}
              <div>
                <p
                  className={cn(
                    "text-sm font-medium",
                    s.done ? "text-muted line-through" : "text-fg",
                  )}
                >
                  {s.title}
                </p>
                <p className="text-xs text-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}

export function ConsoleHomePage() {
  useTitle("Console Home");
  const session = useRequiredSession();
  const [params] = useSearchParams();
  const welcome = params.get("welcome") === "1";

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <PageHeader title="Console Home" description={`Account ${session.accountName}`} />

      <div className="mb-6 space-y-3">
        {welcome && (
          <Alert variant="success" title="Your sandbox account is ready">
            Account ID <span className="font-mono">{session.accountId}</span>. It exists only on
            this computer, so experiment freely: nothing here can cost money.
          </Alert>
        )}
        {session.principal.type === "root" && (
          <Alert variant="warning" title="You're signed in as the root user">
            <p>
              The root user can do anything, and IAM policies can't limit it. In real AWS you'd use
              it only for a few account-level tasks and do daily work as an IAM user.
            </p>
            <Link
              to="/iam/users/create"
              className="mt-1 inline-flex items-center gap-1 font-medium text-brand hover:underline"
            >
              Create an IAM user <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </Alert>
        )}
        {session.principal.type === "assumed-role" && (
          <Alert variant="info" title={`You're using the role ${session.principal.name}`}>
            Your user's own permissions are set aside; the role's permissions apply until you switch
            back or the session expires.
          </Alert>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <ServicesCard />
          <RecentActivityCard />
        </div>
        <div className="space-y-6">
          <IdentityCard />
          <LearningPathCard />
        </div>
      </div>
    </div>
  );
}
