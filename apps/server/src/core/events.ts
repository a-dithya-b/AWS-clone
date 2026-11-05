import type { Decision, EvaluationSummary, PrincipalType } from "@cloudlearn/shared";
import { generateToken } from "@cloudlearn/shared";
import { all, type Db, run } from "./db";

/** One recorded API call. The activity log, the "why denied?" panel and scenarios all read these. */
export interface ApiEvent {
  id: number;
  eventId: string;
  accountId: string;
  eventTime: string;
  eventSource: string;
  eventName: string;
  iamAction: string;
  principalArn: string | null;
  principalType: PrincipalType | null;
  resourceArn: string | null;
  decision: Decision;
  errorCode: string | null;
  errorMessage: string | null;
  request: unknown;
  evaluation: EvaluationSummary | null;
}

export type ApiEventInput = Omit<ApiEvent, "id" | "eventId" | "eventTime"> & { time: Date };

interface ApiEventRow {
  id: number;
  event_id: string;
  account_id: string;
  event_time: string;
  event_source: string;
  event_name: string;
  iam_action: string;
  principal_arn: string | null;
  principal_type: PrincipalType | null;
  resource_arn: string | null;
  decision: Decision;
  error_code: string | null;
  error_message: string | null;
  request: string | null;
  evaluation: string | null;
}

/** Hide secrets before they're written to the log, like CloudTrail does. */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) =>
        /password|secret/i.test(k) ? [k, "HIDDEN_DUE_TO_SECURITY_REASONS"] : [k, redact(v)],
      ),
    );
  }
  return value;
}

export function recordEvent(db: Db, e: ApiEventInput): void {
  const eventId = [8, 4, 4, 4, 12].map((n) => generateToken(n / 2)).join("-");
  run(
    db,
    `INSERT INTO api_events (event_id, account_id, event_time, event_source, event_name, iam_action,
       principal_arn, principal_type, resource_arn, decision, error_code, error_message, request,
       evaluation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    eventId,
    e.accountId,
    e.time.toISOString(),
    e.eventSource,
    e.eventName,
    e.iamAction,
    e.principalArn,
    e.principalType,
    e.resourceArn,
    e.decision,
    e.errorCode,
    e.errorMessage,
    e.request === undefined ? null : JSON.stringify(redact(e.request)),
    e.evaluation ? JSON.stringify(e.evaluation) : null,
  );
}

/** Newest first. `beforeId` continues from a previous page. */
export function lookupEvents(
  db: Db,
  accountId: string,
  { limit, beforeId }: { limit: number; beforeId?: number },
): ApiEvent[] {
  const rows =
    beforeId === undefined
      ? all<ApiEventRow>(
          db,
          "SELECT * FROM api_events WHERE account_id = ? ORDER BY id DESC LIMIT ?",
          accountId,
          limit,
        )
      : all<ApiEventRow>(
          db,
          "SELECT * FROM api_events WHERE account_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
          accountId,
          beforeId,
          limit,
        );
  return rows.map((r) => ({
    id: r.id,
    eventId: r.event_id,
    accountId: r.account_id,
    eventTime: r.event_time,
    eventSource: r.event_source,
    eventName: r.event_name,
    iamAction: r.iam_action,
    principalArn: r.principal_arn,
    principalType: r.principal_type,
    resourceArn: r.resource_arn,
    decision: r.decision,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    request: r.request ? JSON.parse(r.request) : null,
    evaluation: r.evaluation ? JSON.parse(r.evaluation) : null,
  }));
}
