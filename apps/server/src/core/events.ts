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
  /**
   * Like CloudTrail: "Management" events (creating queues, changing policies) are shown by
   * default; "Data" events (sending or receiving messages) are high-volume and opt-in.
   */
  category: EventCategory;
}

export type EventCategory = "Management" | "Data";

export type ApiEventInput = Omit<ApiEvent, "id" | "eventId" | "eventTime" | "category"> & {
  time: Date;
  category?: EventCategory;
};

/** Keep the log from growing forever when the simulator runs for hours. */
const MAX_EVENTS_PER_ACCOUNT = 20000;
let insertsSincePrune = 0;

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
  category: EventCategory;
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
       evaluation, category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    e.category ?? "Management",
  );
  if (++insertsSincePrune >= 500) {
    insertsSincePrune = 0;
    run(
      db,
      `DELETE FROM api_events WHERE account_id = ? AND id <= (
         SELECT id FROM api_events WHERE account_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`,
      e.accountId,
      e.accountId,
      MAX_EVENTS_PER_ACCOUNT,
    );
  }
}

export interface LookupFilter {
  limit: number;
  beforeId?: number;
  includeDataEvents?: boolean;
  /** Exact-match filters, like CloudTrail's LookupAttributes. */
  eventName?: string;
  eventSource?: string;
  username?: string;
  resourceName?: string;
}

/** Newest first. `beforeId` continues from a previous page. */
export function lookupEvents(db: Db, accountId: string, f: LookupFilter): ApiEvent[] {
  const where = ["account_id = ?"];
  const params: (string | number)[] = [accountId];
  if (f.beforeId !== undefined) {
    where.push("id < ?");
    params.push(f.beforeId);
  }
  if (!f.includeDataEvents) where.push("category = 'Management'");
  if (f.eventName) {
    where.push("event_name = ?");
    params.push(f.eventName);
  }
  if (f.eventSource) {
    where.push("event_source = ?");
    params.push(f.eventSource);
  }
  if (f.resourceName) {
    where.push("resource_arn = ?");
    params.push(f.resourceName);
  }
  if (f.username) {
    // Matches "root" or the last segment of the principal ARN (user name or role session).
    where.push("(principal_arn LIKE ? OR (? = 'root' AND principal_type = 'root'))");
    params.push(`%/${f.username}`, f.username);
  }
  const rows = all<ApiEventRow>(
    db,
    `SELECT * FROM api_events WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`,
    ...params,
    f.limit,
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
    category: r.category,
  }));
}
