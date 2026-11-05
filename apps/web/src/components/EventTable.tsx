import type { TrailEvent } from "@cloudlearn/shared";
import { ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelative } from "@/lib/format";
import { EvaluationExplainer } from "./EvaluationExplainer";
import { Badge } from "./ui/feedback";

export function DecisionBadge({ event }: { event: TrailEvent }) {
  if (event.Decision === "ExplicitDeny") return <Badge variant="danger">Denied (explicit)</Badge>;
  if (event.Decision === "ImplicitDeny" && event.ErrorCode === "AccessDenied")
    return <Badge variant="danger">Denied</Badge>;
  if (event.ErrorCode) return <Badge variant="warning">{event.ErrorCode}</Badge>;
  return <Badge variant="success">Allowed</Badge>;
}

function EventDetails({ event }: { event: TrailEvent }) {
  const rows: [string, string | null][] = [
    ["IAM action", event.IamAction],
    ["Principal ARN", event.PrincipalArn],
    ["Resource", event.Resources[0]?.ResourceName ?? null],
    ["Event source", event.EventSource],
    ["Event ID", event.EventId],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="text-muted">{k}</dt>
            <dd className="font-mono text-xs leading-5 break-all text-fg">{v ?? "—"}</dd>
          </Fragment>
        ))}
      </dl>
      <div className="space-y-3 text-sm">
        {event.ErrorMessage && (
          <div>
            <p className="font-medium text-fg">Error</p>
            <p className="text-muted">{event.ErrorMessage}</p>
          </div>
        )}
        {event.Evaluation && (
          <details
            className="rounded-md border border-border bg-surface p-3"
            open={event.Decision !== "Allow"}
          >
            <summary className="cursor-pointer font-medium text-fg">
              {event.Decision === "Allow" ? "Why was this allowed?" : "Why was this denied?"}
            </summary>
            <div className="mt-3">
              <EvaluationExplainer evaluation={event.Evaluation} />
            </div>
          </details>
        )}
        {event.Request != null && (
          <div>
            <p className="font-medium text-fg">Request</p>
            <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-surface-muted p-2 font-mono text-xs text-fg">
              {JSON.stringify(event.Request, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

/** CloudTrail-style event list. Click a row to see the details and the IAM decision. */
export function EventTable({
  events,
  compact = false,
}: {
  events: TrailEvent[];
  compact?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-surface-muted text-xs text-muted">
          <tr>
            <th className="w-8 py-2 pl-3" aria-label="Expand" />
            <th className="py-2 pr-4 font-medium">Event name</th>
            <th className="py-2 pr-4 font-medium">Event time</th>
            <th className="py-2 pr-4 font-medium">User name</th>
            {!compact && <th className="py-2 pr-4 font-medium">Event source</th>}
            <th className="py-2 pr-4 font-medium">Result</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const expanded = open === e.EventId;
            return (
              <Fragment key={e.EventId}>
                <tr
                  className={cn(
                    "cursor-pointer border-b border-border hover:bg-surface-muted",
                    expanded && "bg-surface-muted",
                  )}
                  onClick={() => setOpen(expanded ? null : e.EventId)}
                >
                  <td className="py-2 pl-3">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? "Hide" : "Show"} details for ${e.EventName}`}
                      className="flex cursor-pointer items-center text-muted"
                    >
                      <ChevronRight
                        className={cn("size-4 transition-transform", expanded && "rotate-90")}
                      />
                    </button>
                  </td>
                  <td className="py-2 pr-4 font-medium text-fg">{e.EventName}</td>
                  <td
                    className="py-2 pr-4 whitespace-nowrap text-muted"
                    title={formatDateTime(e.EventTime)}
                  >
                    {compact ? formatRelative(e.EventTime) : formatDateTime(e.EventTime)}
                  </td>
                  <td className="py-2 pr-4 text-fg">{e.Username ?? "—"}</td>
                  {!compact && <td className="py-2 pr-4 text-muted">{e.EventSource}</td>}
                  <td className="py-2 pr-4">
                    <DecisionBadge event={e} />
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-b border-border bg-surface-muted/50">
                    <td />
                    <td colSpan={compact ? 4 : 5} className="py-3 pr-4">
                      <EventDetails event={e} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
