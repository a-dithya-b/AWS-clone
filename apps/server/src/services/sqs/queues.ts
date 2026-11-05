import { type PolicyDocument, validatePolicy } from "@cloudlearn/iam-engine";
import { DEFAULT_REGION, formatArn, generateToken, parseArn } from "@cloudlearn/shared";
import { buildCatalog } from "../../core/catalog";
import { all, type Db, get, run } from "../../core/db";
import { AwsError } from "../../core/errors";
import type { CoreDeps } from "../../core/service";

// ---------------------------------------------------------------- types and rows

export interface RedrivePolicy {
  deadLetterTargetArn: string;
  maxReceiveCount: number;
}

export interface RedriveAllowPolicy {
  redrivePermission: "allowAll" | "denyAll" | "byQueue";
  sourceQueueArns?: string[];
}

export interface Queue {
  id: string;
  accountId: string;
  name: string;
  arn: string;
  url: string;
  fifo: boolean;
  visibilityTimeout: number;
  messageRetentionPeriod: number;
  delaySeconds: number;
  receiveWaitTime: number;
  maximumMessageSize: number;
  contentBasedDedup: boolean;
  redrivePolicy: RedrivePolicy | null;
  redriveAllowPolicy: RedriveAllowPolicy | null;
  policy: PolicyDocument | null;
  extraAttributes: Record<string, string>;
  tags: Record<string, string>;
  nextSequence: number;
  lastPurgedAt: number | null;
  createdAt: number;
  lastModifiedAt: number;
}

interface QueueRow {
  id: string;
  account_id: string;
  name: string;
  arn: string;
  url: string;
  fifo: number;
  visibility_timeout: number;
  message_retention_period: number;
  delay_seconds: number;
  receive_wait_time: number;
  maximum_message_size: number;
  content_based_dedup: number;
  redrive_policy: string | null;
  redrive_allow_policy: string | null;
  policy: string | null;
  extra_attributes: string;
  tags: string;
  next_sequence: number;
  last_purged_at: number | null;
  created_at: number;
  last_modified_at: number;
}

const toQueue = (r: QueueRow): Queue => ({
  id: r.id,
  accountId: r.account_id,
  name: r.name,
  arn: r.arn,
  url: r.url,
  fifo: r.fifo === 1,
  visibilityTimeout: r.visibility_timeout,
  messageRetentionPeriod: r.message_retention_period,
  delaySeconds: r.delay_seconds,
  receiveWaitTime: r.receive_wait_time,
  maximumMessageSize: r.maximum_message_size,
  contentBasedDedup: r.content_based_dedup === 1,
  redrivePolicy: r.redrive_policy ? JSON.parse(r.redrive_policy) : null,
  redriveAllowPolicy: r.redrive_allow_policy ? JSON.parse(r.redrive_allow_policy) : null,
  policy: r.policy ? JSON.parse(r.policy) : null,
  extraAttributes: JSON.parse(r.extra_attributes),
  tags: JSON.parse(r.tags),
  nextSequence: r.next_sequence,
  lastPurgedAt: r.last_purged_at,
  createdAt: r.created_at,
  lastModifiedAt: r.last_modified_at,
});

// ---------------------------------------------------------------- names, URLs, ARNs

/** Same shape as real queue URLs, so learners recognize them. Nothing is ever sent there. */
export const queueUrl = (accountId: string, name: string) =>
  `https://sqs.${DEFAULT_REGION}.amazonaws.com/${accountId}/${name}`;

export const queueArn = (accountId: string, name: string) =>
  formatArn({ service: "sqs", region: DEFAULT_REGION, accountId, resource: name });

/** Accepts a queue URL (any host) and returns the account and name it points to. */
export function parseQueueUrl(url: string): { accountId: string; name: string } | null {
  const match = /\/(\d{12})\/([\w.-]{1,80})\/?$/.exec(url.split(/[?#]/)[0] ?? "");
  return match ? { accountId: match[1] as string, name: match[2] as string } : null;
}

export function arnForUrl(url: string): string {
  const parsed = parseQueueUrl(url);
  return parsed ? queueArn(parsed.accountId, parsed.name) : "*";
}

export const QUEUE_NAME_RULE =
  "Can only include alphanumeric characters, hyphens, or underscores. 1 to 80 in length";

export function checkQueueName(name: string, fifo: boolean) {
  const base = fifo ? name.replace(/\.fifo$/, "") : name;
  const valid = /^[A-Za-z0-9_-]+$/.test(base) && name.length <= 80 && base.length > 0;
  if (fifo && !name.endsWith(".fifo")) {
    throw new AwsError(
      "InvalidParameterValue",
      "The name of a FIFO queue can only include alphanumeric characters, hyphens, or underscores, must end with .fifo suffix and be 1 to 80 in length.",
    );
  }
  if (!fifo && name.endsWith(".fifo")) {
    throw new AwsError(
      "InvalidParameterValue",
      "The name of a standard queue can't end with .fifo. To create a FIFO queue, set the FifoQueue attribute to true.",
    );
  }
  if (!valid) throw new AwsError("InvalidParameterValue", `${QUEUE_NAME_RULE}.`);
}

// ---------------------------------------------------------------- queries

export const queueDoesNotExist = () =>
  new AwsError("QueueDoesNotExist", "The specified queue does not exist.", 400);

export function findQueue(db: Db, accountId: string, name: string): Queue | undefined {
  const r = get<QueueRow>(
    db,
    "SELECT * FROM sqs_queues WHERE account_id = ? AND name = ?",
    accountId,
    name,
  );
  return r && toQueue(r);
}

export function findQueueByArn(db: Db, arn: string): Queue | undefined {
  const r = get<QueueRow>(db, "SELECT * FROM sqs_queues WHERE arn = ?", arn);
  return r && toQueue(r);
}

export function findQueueById(db: Db, id: string): Queue | undefined {
  const r = get<QueueRow>(db, "SELECT * FROM sqs_queues WHERE id = ?", id);
  return r && toQueue(r);
}

export function findQueueByUrl(db: Db, url: string): Queue | undefined {
  const parsed = parseQueueUrl(url);
  return parsed ? findQueue(db, parsed.accountId, parsed.name) : undefined;
}

export function requireQueueByUrl(db: Db, url: string): Queue {
  const queue = findQueueByUrl(db, url);
  if (!queue) throw queueDoesNotExist();
  return queue;
}

export function listQueues(db: Db, accountId: string, prefix = ""): Queue[] {
  return all<QueueRow>(
    db,
    "SELECT * FROM sqs_queues WHERE account_id = ? AND substr(name, 1, ?) = ? ORDER BY name",
    accountId,
    prefix.length,
    prefix,
  ).map(toQueue);
}

export function listAllQueues(db: Db): Queue[] {
  return all<QueueRow>(db, "SELECT * FROM sqs_queues").map(toQueue);
}

export function deadLetterSourceQueues(db: Db, dlqArn: string): Queue[] {
  return all<QueueRow>(
    db,
    "SELECT * FROM sqs_queues WHERE json_extract(redrive_policy, '$.deadLetterTargetArn') = ? ORDER BY name",
    dlqArn,
  ).map(toQueue);
}

export interface MessageCounts {
  available: number;
  inFlight: number;
  delayed: number;
}

export function messageCounts(db: Db, queueId: string, now: number): MessageCounts {
  const r = get<{ available: number; in_flight: number; delayed: number }>(
    db,
    `SELECT
       COALESCE(SUM(visible_at <= ?), 0) AS available,
       COALESCE(SUM(visible_at > ? AND receive_count > 0), 0) AS in_flight,
       COALESCE(SUM(visible_at > ? AND receive_count = 0), 0) AS delayed
     FROM sqs_messages WHERE queue_id = ? AND expires_at > ?`,
    now,
    now,
    now,
    queueId,
    now,
  );
  return { available: r?.available ?? 0, inFlight: r?.in_flight ?? 0, delayed: r?.delayed ?? 0 };
}

// ---------------------------------------------------------------- attributes

/** Settable numeric attributes and their allowed ranges (from the SQS API reference). */
const NUMERIC: Record<string, [min: number, max: number, column: keyof QueueRow]> = {
  VisibilityTimeout: [0, 43200, "visibility_timeout"],
  MessageRetentionPeriod: [60, 1209600, "message_retention_period"],
  DelaySeconds: [0, 900, "delay_seconds"],
  ReceiveMessageWaitTimeSeconds: [0, 20, "receive_wait_time"],
  MaximumMessageSize: [1024, 1048576, "maximum_message_size"],
};

/** Accepted and echoed back, but they don't change behavior in the simulator. */
const PASSTHROUGH = new Set([
  "KmsMasterKeyId",
  "KmsDataKeyReusePeriodSeconds",
  "SqsManagedSseEnabled",
  "DeduplicationScope",
  "FifoThroughputLimit",
]);

const invalidValue = (name: string, reason?: string) =>
  new AwsError(
    "InvalidAttributeValue",
    `Invalid value for the parameter ${name}.${reason ? ` Reason: ${reason}` : ""}`,
  );

/**
 * Validates attributes for CreateQueue/SetQueueAttributes and returns column updates.
 * `queue` is the queue being configured (for SetQueueAttributes) or a draft (for CreateQueue).
 */
export function resolveAttributes(
  deps: CoreDeps,
  draft: { accountId: string; arn: string; fifo: boolean },
  attributes: Record<string, string>,
  mode: "create" | "set",
): Partial<Record<keyof QueueRow, string | number | null>> {
  const updates: Partial<Record<keyof QueueRow, string | number | null>> = {};
  const extra: Record<string, string> = {};

  for (const [name, value] of Object.entries(attributes)) {
    const numeric = NUMERIC[name];
    if (numeric) {
      const [min, max, column] = numeric;
      const n = Number(value);
      if (!/^\d+$/.test(value) || n < min || n > max) {
        throw invalidValue(name, `Must be between ${min} and ${max}.`);
      }
      updates[column] = n;
    } else if (name === "FifoQueue") {
      if (mode === "set")
        throw new AwsError(
          "InvalidAttributeName",
          "You can't change FifoQueue after a queue is created.",
        );
      if (value !== "true" && value !== "false") throw invalidValue(name);
    } else if (name === "ContentBasedDeduplication") {
      if (!draft.fifo)
        throw new AwsError("InvalidAttributeName", "Unknown Attribute ContentBasedDeduplication.");
      if (value !== "true" && value !== "false") throw invalidValue(name);
      updates.content_based_dedup = value === "true" ? 1 : 0;
    } else if (name === "RedrivePolicy") {
      updates.redrive_policy =
        value === "" ? null : JSON.stringify(parseRedrivePolicy(deps, draft, value));
    } else if (name === "RedriveAllowPolicy") {
      updates.redrive_allow_policy =
        value === "" ? null : JSON.stringify(parseRedriveAllowPolicy(value));
    } else if (name === "Policy") {
      if (value === "") {
        updates.policy = null;
      } else {
        const result = validatePolicy(value, {
          kind: "resource",
          catalog: buildCatalog(deps.services),
        });
        const error = result.issues.find((i) => i.severity === "error");
        if (!result.valid || !result.document) throw invalidValue("Policy", error?.message);
        updates.policy = JSON.stringify(result.document);
      }
    } else if (PASSTHROUGH.has(name)) {
      extra[name] = value;
    } else {
      throw new AwsError("InvalidAttributeName", `Unknown Attribute ${name}.`);
    }
  }
  if (Object.keys(extra).length) updates.extra_attributes = JSON.stringify(extra);
  return updates;
}

function parseRedrivePolicy(
  deps: CoreDeps,
  draft: { accountId: string; arn: string; fifo: boolean },
  value: string,
): RedrivePolicy {
  let parsed: { deadLetterTargetArn?: unknown; maxReceiveCount?: unknown };
  try {
    parsed = JSON.parse(value);
  } catch {
    throw invalidValue("RedrivePolicy", "Redrive policy is not a valid JSON map.");
  }
  const target = String(parsed.deadLetterTargetArn ?? "");
  const max = Number(parsed.maxReceiveCount);
  if (!target)
    throw invalidValue(
      "RedrivePolicy",
      "Redrive policy does not contain mandatory attribute: deadLetterTargetArn.",
    );
  if (!Number.isInteger(max) || max < 1 || max > 1000) {
    throw invalidValue(
      "RedrivePolicy",
      "Invalid value for maxReceiveCount: must be an integer from 1 to 1000.",
    );
  }
  if (target === draft.arn)
    throw invalidValue("RedrivePolicy", "A queue can't be its own dead-letter queue.");
  const dlq = findQueueByArn(deps.db, target);
  if (!dlq) throw invalidValue("RedrivePolicy", `Dead letter target does not exist: ${target}`);
  if (parseArn(target)?.accountId !== draft.accountId) {
    throw invalidValue(
      "RedrivePolicy",
      "Dead-letter queue must be in the same account as the source queue.",
    );
  }
  if (dlq.fifo !== draft.fifo) {
    throw invalidValue(
      "RedrivePolicy",
      "Dead-letter queue must be same type of queue as the source.",
    );
  }
  const allow = dlq.redriveAllowPolicy;
  if (
    allow &&
    (allow.redrivePermission === "denyAll" ||
      (allow.redrivePermission === "byQueue" && !allow.sourceQueueArns?.includes(draft.arn)))
  ) {
    throw invalidValue(
      "RedrivePolicy",
      `The dead-letter queue's RedriveAllowPolicy doesn't allow ${draft.arn} to use it.`,
    );
  }
  return { deadLetterTargetArn: target, maxReceiveCount: max };
}

function parseRedriveAllowPolicy(value: string): RedriveAllowPolicy {
  let parsed: { redrivePermission?: unknown; sourceQueueArns?: unknown };
  try {
    parsed = JSON.parse(value);
  } catch {
    throw invalidValue("RedriveAllowPolicy", "Not a valid JSON map.");
  }
  const permission = parsed.redrivePermission;
  if (permission !== "allowAll" && permission !== "denyAll" && permission !== "byQueue") {
    throw invalidValue(
      "RedriveAllowPolicy",
      "redrivePermission must be allowAll, denyAll or byQueue.",
    );
  }
  const sources = Array.isArray(parsed.sourceQueueArns)
    ? parsed.sourceQueueArns.map(String)
    : undefined;
  if (permission === "byQueue" && (!sources?.length || sources.length > 10)) {
    throw invalidValue("RedriveAllowPolicy", "byQueue needs 1 to 10 sourceQueueArns.");
  }
  return { redrivePermission: permission, ...(sources ? { sourceQueueArns: sources } : {}) };
}

export function insertQueue(
  db: Db,
  input: { accountId: string; name: string; fifo: boolean; now: number },
  updates: Partial<Record<keyof QueueRow, string | number | null>>,
): Queue {
  const id = generateToken(16);
  run(
    db,
    `INSERT INTO sqs_queues (id, account_id, name, arn, url, fifo, created_at, last_modified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.accountId,
    input.name,
    queueArn(input.accountId, input.name),
    queueUrl(input.accountId, input.name),
    input.fifo ? 1 : 0,
    input.now,
    input.now,
  );
  applyUpdates(db, id, updates, input.now);
  return findQueueById(db, id) as Queue;
}

export function applyUpdates(
  db: Db,
  queueId: string,
  updates: Partial<Record<keyof QueueRow, string | number | null>>,
  now: number,
) {
  const entries = Object.entries(updates);
  if (entries.length === 0) return;
  // Merge pass-through attributes rather than replacing them.
  const extraIndex = entries.findIndex(([k]) => k === "extra_attributes");
  if (extraIndex >= 0) {
    const current = findQueueById(db, queueId)?.extraAttributes ?? {};
    const entry = entries[extraIndex] as [string, string];
    entries[extraIndex] = [
      "extra_attributes",
      JSON.stringify({ ...current, ...JSON.parse(entry[1]) }),
    ];
  }
  const sets = entries.map(([k]) => `${k} = ?`).join(", ");
  run(
    db,
    `UPDATE sqs_queues SET ${sets}, last_modified_at = ? WHERE id = ?`,
    ...entries.map(([, v]) => v ?? null),
    now,
    queueId,
  );
}

/** Attributes that must match for CreateQueue on an existing name to succeed (it's idempotent). */
export function differingAttribute(
  queue: Queue,
  updates: Partial<Record<keyof QueueRow, string | number | null>>,
): string | null {
  const current: Partial<Record<keyof QueueRow, unknown>> = {
    visibility_timeout: queue.visibilityTimeout,
    message_retention_period: queue.messageRetentionPeriod,
    delay_seconds: queue.delaySeconds,
    receive_wait_time: queue.receiveWaitTime,
    maximum_message_size: queue.maximumMessageSize,
    content_based_dedup: queue.contentBasedDedup ? 1 : 0,
  };
  const names: Partial<Record<keyof QueueRow, string>> = {
    visibility_timeout: "VisibilityTimeout",
    message_retention_period: "MessageRetentionPeriod",
    delay_seconds: "DelaySeconds",
    receive_wait_time: "ReceiveMessageWaitTimeSeconds",
    maximum_message_size: "MaximumMessageSize",
    content_based_dedup: "ContentBasedDeduplication",
  };
  for (const [column, value] of Object.entries(updates) as [keyof QueueRow, unknown][]) {
    if (column in current && current[column] !== value) return names[column] ?? column;
  }
  return null;
}

/** All attributes as GetQueueAttributes returns them (every value is a string). */
export function queueAttributes(db: Db, queue: Queue, now: number): Record<string, string> {
  const counts = messageCounts(db, queue.id, now);
  return {
    QueueArn: queue.arn,
    ApproximateNumberOfMessages: String(counts.available),
    ApproximateNumberOfMessagesNotVisible: String(counts.inFlight),
    ApproximateNumberOfMessagesDelayed: String(counts.delayed),
    CreatedTimestamp: String(Math.floor(queue.createdAt / 1000)),
    LastModifiedTimestamp: String(Math.floor(queue.lastModifiedAt / 1000)),
    VisibilityTimeout: String(queue.visibilityTimeout),
    MaximumMessageSize: String(queue.maximumMessageSize),
    MessageRetentionPeriod: String(queue.messageRetentionPeriod),
    DelaySeconds: String(queue.delaySeconds),
    ReceiveMessageWaitTimeSeconds: String(queue.receiveWaitTime),
    SqsManagedSseEnabled: "true",
    ...(queue.fifo
      ? { FifoQueue: "true", ContentBasedDeduplication: String(queue.contentBasedDedup) }
      : {}),
    ...(queue.redrivePolicy ? { RedrivePolicy: JSON.stringify(queue.redrivePolicy) } : {}),
    ...(queue.redriveAllowPolicy
      ? { RedriveAllowPolicy: JSON.stringify(queue.redriveAllowPolicy) }
      : {}),
    ...(queue.policy ? { Policy: JSON.stringify(queue.policy) } : {}),
    ...queue.extraAttributes,
  };
}

export function deleteQueueRow(db: Db, queue: Queue, now: number) {
  run(db, "DELETE FROM sqs_queues WHERE id = ?", queue.id);
  run(
    db,
    "INSERT OR REPLACE INTO sqs_deleted_queues (account_id, name, deleted_at) VALUES (?, ?, ?)",
    queue.accountId,
    queue.name,
    now,
  );
}

export function recentlyDeleted(db: Db, accountId: string, name: string, now: number): boolean {
  const r = get<{ deleted_at: number }>(
    db,
    "SELECT deleted_at FROM sqs_deleted_queues WHERE account_id = ? AND name = ?",
    accountId,
    name,
  );
  return !!r && now - r.deleted_at < 60_000;
}

export function setTags(db: Db, queueId: string, tags: Record<string, string>) {
  run(db, "UPDATE sqs_queues SET tags = ? WHERE id = ?", JSON.stringify(tags), queueId);
}
