import type { GetCallerIdentityOutput, LookupEventsOutput } from "@cloudlearn/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CircleCheck, CircleDashed } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
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
          <Alert variant="error">{identity.error.message}</Alert>
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
          <Alert variant="error">{events.error.message}</Alert>
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
  const steps: { title: string; body: ReactNode; done?: boolean }[] = [
    {
      title: "Create your sandbox account",
      body: "You're signed in as its root user.",
      done: true,
    },
    {
      title: "Explore the activity log",
      body: "Open a row in Recent activity to see why it was allowed.",
    },
    { title: "IAM: users, groups and policies", body: "Arrives in Phase 2." },
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
            The root user can do anything, and its access can't be limited by IAM policies. In real
            AWS, you'd use it only for a few account-level tasks and do daily work as an IAM user.
            You'll practice that once IAM arrives.
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
