import { createHash, randomUUID } from "node:crypto";
import { generateToken } from "@cloudlearn/shared";
import { all, type Db, get, run, transaction } from "../../core/db";
import { AwsError } from "../../core/errors";
import type { CoreDeps } from "../../core/service";
import { type MessageAttributeValue, md5Hex, md5OfMessageAttributes } from "./md5";
import { findQueueByArn, findQueueById, type Queue } from "./queues";

// ---------------------------------------------------------------- rows and views

interface MessageRow {
  seq: number;
  message_id: string;
  queue_id: string;
  body: string;
  md5_body: string;
  message_attributes: string | null;
  md5_attributes: string | null;
  sender_id: string;
  sent_at: number;
  visible_at: number;
  expires_at: number;
  receive_count: number;
  first_received_at: number | null;
  receipt_handle: string | null;
  group_id: string | null;
  dedup_id: string | null;
  sequence_number: string | null;
  dlq_source_arn: string | null;
}

export type MessageState = "available" | "inflight" | "delayed";

/** What the simulator shows for each message. */
export interface MessageView {
  MessageId: string;
  Body: string;
  GroupId: string | null;
  ReceiveCount: number;
  SentAt: number;
  VisibleAt: number;
  ExpiresAt: number;
  State: MessageState;
  SequenceNumber: string | null;
  DeduplicationId: string | null;
  DeadLetterQueueSourceArn: string | null;
}

function stateOf(r: Pick<MessageRow, "visible_at" | "receive_count">, now: number): MessageState {
  if (r.visible_at <= now) return "available";
  return r.receive_count > 0 ? "inflight" : "delayed";
}

const PREVIEW = 500;

function toView(r: MessageRow, now: number): MessageView {
  return {
    MessageId: r.message_id,
    Body: r.body.length > PREVIEW ? `${r.body.slice(0, PREVIEW)}…` : r.body,
    GroupId: r.group_id,
    ReceiveCount: r.receive_count,
    SentAt: r.sent_at,
    VisibleAt: r.visible_at,
    ExpiresAt: r.expires_at,
    State: stateOf(r, now),
    SequenceNumber: r.sequence_number,
    DeduplicationId: r.dedup_id,
    DeadLetterQueueSourceArn: r.dlq_source_arn,
  };
}

/** Tells live views (the simulator) what happened. Topic = queue ARN. */
function publish(deps: CoreDeps, queueArn: string, type: string, data: Record<string, unknown>) {
  deps.bus.publish({
    topic: queueArn,
    type,
    at: deps.clock.now().toISOString(),
    data: { queueArn, ...data },
  });
}

export function listMessageViews(deps: CoreDeps, queue: Queue, limit = 500): MessageView[] {
  const now = deps.clock.now().getTime();
  return all<MessageRow>(
    deps.db,
    "SELECT * FROM sqs_messages WHERE queue_id = ? AND expires_at > ? ORDER BY seq LIMIT ?",
    queue.id,
    now,
    limit,
  ).map((r) => toView(r, now));
}

// ---------------------------------------------------------------- receipt handles

/** Looks like a real receipt handle (an opaque blob) but encodes which message it belongs to. */
function makeHandle(messageId: string): string {
  return `AQEB${Buffer.from(`${messageId}:${generateToken(32)}`).toString("base64url")}`;
}

function messageIdFromHandle(handle: string): string | null {
  if (!handle.startsWith("AQEB")) return null;
  const decoded = Buffer.from(handle.slice(4), "base64url").toString("utf8");
  const [id] = decoded.split(":");
  return id && /^[0-9a-f-]{36}$/.test(id) ? id : null;
}

const invalidHandle = (handle: string) =>
  new AwsError(
    "ReceiptHandleIsInvalid",
    `The input receipt handle "${handle.length > 40 ? `${handle.slice(0, 40)}…` : handle}" is not a valid receipt handle.`,
  );

// ---------------------------------------------------------------- send

export interface SendInput {
  MessageBody: string;
  DelaySeconds?: number;
  MessageAttributes?: Record<string, MessageAttributeValue>;
  MessageGroupId?: string;
  MessageDeduplicationId?: string;
}

export interface SendResult {
  MessageId: string;
  MD5OfMessageBody: string;
  MD5OfMessageAttributes?: string;
  SequenceNumber?: string;
}

// Characters SQS accepts in message bodies (XML 1.0 character ranges). Matching control
// characters is the point here.
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is intended
const INVALID_CHARS = /[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

function validateAttributes(attrs: Record<string, MessageAttributeValue>) {
  const names = Object.keys(attrs);
  if (names.length > 10) {
    throw new AwsError(
      "InvalidParameterValue",
      "Number of message attributes [" + names.length + "] exceeds the allowed maximum [10].",
    );
  }
  for (const name of names) {
    const a = attrs[name] as MessageAttributeValue;
    if (!/^(String|Number|Binary)(\..+)?$/.test(a.DataType)) {
      throw new AwsError(
        "InvalidParameterValue",
        `The type of message (user) attribute '${name}' is invalid. You must use only the following supported type prefixes: Binary, Number, String.`,
      );
    }
    const binary = a.DataType.startsWith("Binary");
    if (binary ? a.BinaryValue === undefined : a.StringValue === undefined) {
      throw new AwsError(
        "InvalidParameterValue",
        `Message (user) attribute '${name}' must contain a non-empty value of type '${binary ? "Binary" : "String"}'.`,
      );
    }
    if (a.DataType.startsWith("Number") && Number.isNaN(Number(a.StringValue))) {
      throw new AwsError(
        "InvalidParameterValue",
        `Can't cast the value of message (user) attribute '${name}' to a number.`,
      );
    }
  }
}

export function sendMessage(
  deps: CoreDeps,
  queue: Queue,
  input: SendInput,
  senderId: string,
): SendResult {
  const { db, clock } = deps;
  const size = Buffer.byteLength(input.MessageBody, "utf8");
  if (size > queue.maximumMessageSize) {
    throw new AwsError(
      "InvalidParameterValue",
      `One or more parameters are invalid. Reason: Message must be shorter than ${queue.maximumMessageSize} bytes.`,
    );
  }
  if (INVALID_CHARS.test(input.MessageBody)) {
    throw new AwsError(
      "InvalidMessageContents",
      "Invalid characters found. Valid unicode characters are #x9 | #xA | #xD | #x20 to #xD7FF | #xE000 to #xFFFD | #x10000 to #x10FFFF",
    );
  }
  const attrs = input.MessageAttributes ?? {};
  validateAttributes(attrs);

  let dedupId: string | null = null;
  if (queue.fifo) {
    if (!input.MessageGroupId) {
      throw new AwsError(
        "MissingParameter",
        "The request must contain the parameter MessageGroupId.",
      );
    }
    if (input.DelaySeconds !== undefined) {
      throw new AwsError(
        "InvalidParameterValue",
        `Value ${input.DelaySeconds} for parameter DelaySeconds is invalid. Reason: The request include parameter that is not valid for this queue type.`,
      );
    }
    dedupId =
      input.MessageDeduplicationId ??
      (queue.contentBasedDedup
        ? createHash("sha256").update(input.MessageBody).digest("hex")
        : null);
    if (!dedupId) {
      throw new AwsError(
        "InvalidParameterValue",
        "The queue should either have ContentBasedDeduplication enabled or MessageDeduplicationId provided explicitly",
      );
    }
  } else if (input.MessageDeduplicationId !== undefined) {
    throw new AwsError(
      "InvalidParameterValue",
      `Value ${input.MessageDeduplicationId} for parameter MessageDeduplicationId is invalid. Reason: The request include parameter that is not valid for this queue type.`,
    );
  }

  const md5Attrs = Object.keys(attrs).length ? md5OfMessageAttributes(attrs) : undefined;
  const md5Body = md5Hex(input.MessageBody);

  return transaction(db, () => {
    const now = clock.now().getTime();

    // FIFO: a repeated deduplication ID within 5 minutes is accepted but not enqueued again.
    if (queue.fifo && dedupId) {
      const seen = get<{ message_id: string; sequence_number: string | null }>(
        db,
        "SELECT message_id, sequence_number FROM sqs_dedup WHERE queue_id = ? AND dedup_id = ? AND expires_at > ?",
        queue.id,
        dedupId,
        now,
      );
      if (seen) {
        publish(deps, queue.arn, "deduplicated", {
          messageId: seen.message_id,
          deduplicationId: dedupId,
        });
        return {
          MessageId: seen.message_id,
          MD5OfMessageBody: md5Body,
          ...(md5Attrs ? { MD5OfMessageAttributes: md5Attrs } : {}),
          ...(seen.sequence_number ? { SequenceNumber: seen.sequence_number } : {}),
        };
      }
    }

    const messageId = randomUUID();
    let sequenceNumber: string | null = null;
    if (queue.fifo) {
      const r = get<{ n: number }>(
        db,
        "UPDATE sqs_queues SET next_sequence = next_sequence + 1 WHERE id = ? RETURNING next_sequence - 1 AS n",
        queue.id,
      );
      sequenceNumber = String(r?.n ?? 1).padStart(20, "0");
    }
    const delay = (input.DelaySeconds ?? queue.delaySeconds) * 1000;
    run(
      db,
      `INSERT INTO sqs_messages (message_id, queue_id, body, md5_body, message_attributes, md5_attributes,
         sender_id, sent_at, visible_at, expires_at, group_id, dedup_id, sequence_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      messageId,
      queue.id,
      input.MessageBody,
      md5Body,
      Object.keys(attrs).length ? JSON.stringify(attrs) : null,
      md5Attrs ?? null,
      senderId,
      now,
      now + delay,
      now + queue.messageRetentionPeriod * 1000,
      input.MessageGroupId ?? null,
      dedupId,
      sequenceNumber,
    );
    if (queue.fifo && dedupId) {
      run(
        db,
        "INSERT OR REPLACE INTO sqs_dedup (queue_id, dedup_id, message_id, sequence_number, expires_at) VALUES (?, ?, ?, ?, ?)",
        queue.id,
        dedupId,
        messageId,
        sequenceNumber,
        now + DEDUP_WINDOW_MS,
      );
    }
    const row = get<MessageRow>(
      db,
      "SELECT * FROM sqs_messages WHERE message_id = ?",
      messageId,
    ) as MessageRow;
    publish(deps, queue.arn, "sent", { message: toView(row, now) });

    return {
      MessageId: messageId,
      MD5OfMessageBody: md5Body,
      ...(md5Attrs ? { MD5OfMessageAttributes: md5Attrs } : {}),
      ...(sequenceNumber ? { SequenceNumber: sequenceNumber } : {}),
    };
  });
}

// ---------------------------------------------------------------- receive

export interface ReceiveOptions {
  max: number;
  visibilityTimeout?: number;
  /** System attributes to return, e.g. ["All"] or ["ApproximateReceiveCount"]. */
  attributeNames: string[];
  /** Message attributes to return: ["All"], [".*"], exact names or "prefix.*". */
  messageAttributeNames: string[];
}

export interface ReceivedMessage {
  MessageId: string;
  ReceiptHandle: string;
  MD5OfBody: string;
  Body: string;
  Attributes?: Record<string, string>;
  MessageAttributes?: Record<string, MessageAttributeValue>;
  MD5OfMessageAttributes?: string;
}

function systemAttributes(r: MessageRow, wanted: string[]): Record<string, string> | undefined {
  if (!wanted.length) return undefined;
  const all: Record<string, string | null> = {
    SenderId: r.sender_id,
    SentTimestamp: String(r.sent_at),
    ApproximateReceiveCount: String(r.receive_count),
    ApproximateFirstReceiveTimestamp: r.first_received_at ? String(r.first_received_at) : null,
    MessageGroupId: r.group_id,
    MessageDeduplicationId: r.dedup_id,
    SequenceNumber: r.sequence_number,
    DeadLetterQueueSourceArn: r.dlq_source_arn,
  };
  const pick = wanted.includes("All") ? Object.keys(all) : wanted;
  const out: Record<string, string> = {};
  for (const k of pick) {
    const v = all[k];
    if (v) out[k] = v;
  }
  return out;
}

function messageAttributes(r: MessageRow, wanted: string[]) {
  if (!r.message_attributes || !wanted.length) return undefined;
  const attrs = JSON.parse(r.message_attributes) as Record<string, MessageAttributeValue>;
  const matches = (name: string) =>
    wanted.some(
      (w) =>
        w === "All" ||
        w === ".*" ||
        w === name ||
        (w.endsWith(".*") && name.startsWith(w.slice(0, -1))),
    );
  const picked = Object.fromEntries(Object.entries(attrs).filter(([name]) => matches(name)));
  return Object.keys(picked).length ? picked : undefined;
}

/**
 * Moves a message to the queue's dead-letter queue. Its retention still counts from when it was
 * first sent, using the dead-letter queue's retention period (as in AWS).
 */
function moveToDeadLetterQueue(
  deps: CoreDeps,
  source: Queue,
  dlq: Queue,
  r: MessageRow,
  now: number,
) {
  run(
    deps.db,
    `UPDATE sqs_messages SET queue_id = ?, visible_at = ?, receipt_handle = NULL, dlq_source_arn = ?,
       expires_at = ? WHERE seq = ?`,
    dlq.id,
    now,
    source.arn,
    r.sent_at + dlq.messageRetentionPeriod * 1000,
    r.seq,
  );
  const moved = get<MessageRow>(
    deps.db,
    "SELECT * FROM sqs_messages WHERE seq = ?",
    r.seq,
  ) as MessageRow;
  const data = {
    messageId: r.message_id,
    sourceQueueArn: source.arn,
    deadLetterQueueArn: dlq.arn,
    receiveCount: r.receive_count,
    maxReceiveCount: source.redrivePolicy?.maxReceiveCount,
    message: toView(moved, now),
  };
  publish(deps, source.arn, "moved_to_dlq", data);
  publish(deps, dlq.arn, "moved_to_dlq", data);
}

/** One receive attempt, without waiting. */
export function receiveNow(
  deps: CoreDeps,
  queueId: string,
  opts: ReceiveOptions,
): ReceivedMessage[] {
  const { db, clock } = deps;
  return transaction(db, () => {
    const queue = findQueueById(db, queueId);
    if (!queue) return [];
    const now = clock.now().getTime();
    const candidates = all<MessageRow>(
      db,
      "SELECT * FROM sqs_messages WHERE queue_id = ? AND visible_at <= ? AND expires_at > ? ORDER BY seq LIMIT 500",
      queue.id,
      now,
      now,
    );

    // FIFO: while any message of a group is in flight, the rest of that group waits.
    const blockedGroups = new Set(
      queue.fifo
        ? all<{ group_id: string }>(
            db,
            "SELECT DISTINCT group_id FROM sqs_messages WHERE queue_id = ? AND visible_at > ? AND receive_count > 0",
            queue.id,
            now,
          ).map((r) => r.group_id)
        : [],
    );
    const redrive = queue.redrivePolicy;
    const dlq = redrive ? findQueueByArn(db, redrive.deadLetterTargetArn) : undefined;
    const timeout = (opts.visibilityTimeout ?? queue.visibilityTimeout) * 1000;

    const received: ReceivedMessage[] = [];
    for (const r of candidates) {
      if (received.length >= opts.max) break;
      if (queue.fifo && r.group_id && blockedGroups.has(r.group_id)) continue;

      // Received maxReceiveCount times already and still not deleted: off to the DLQ.
      if (redrive && dlq && r.receive_count >= redrive.maxReceiveCount) {
        moveToDeadLetterQueue(deps, queue, dlq, r, now);
        continue;
      }

      const handle = makeHandle(r.message_id);
      run(
        db,
        `UPDATE sqs_messages SET receive_count = receive_count + 1, receipt_handle = ?, visible_at = ?,
           first_received_at = COALESCE(first_received_at, ?) WHERE seq = ?`,
        handle,
        now + timeout,
        now,
        r.seq,
      );
      const updated = get<MessageRow>(
        db,
        "SELECT * FROM sqs_messages WHERE seq = ?",
        r.seq,
      ) as MessageRow;
      publish(deps, queue.arn, "received", {
        message: toView(updated, now),
        visibilityTimeout: timeout / 1000,
      });

      const attributes = systemAttributes(updated, opts.attributeNames);
      const msgAttrs = messageAttributes(updated, opts.messageAttributeNames);
      received.push({
        MessageId: updated.message_id,
        ReceiptHandle: handle,
        MD5OfBody: updated.md5_body,
        Body: updated.body,
        ...(attributes ? { Attributes: attributes } : {}),
        ...(msgAttrs
          ? {
              MessageAttributes: msgAttrs,
              MD5OfMessageAttributes: md5OfMessageAttributes(msgAttrs),
            }
          : {}),
      });
    }
    return received;
  });
}

const WAKE_EVENTS = new Set([
  "sent",
  "visible",
  "delay_ended",
  "visibility_changed",
  "moved_to_dlq",
  "redriven",
]);

/**
 * ReceiveMessage with long polling: if nothing is available, wait up to `waitSeconds` for a
 * message to arrive (instead of returning empty right away, which is short polling).
 */
export async function receiveMessages(
  deps: CoreDeps,
  queue: Queue,
  opts: ReceiveOptions,
  waitSeconds: number,
): Promise<ReceivedMessage[]> {
  const first = receiveNow(deps, queue.id, opts);
  if (first.length || waitSeconds <= 0) return first;

  return new Promise((resolve) => {
    let done = false;
    const finish = (messages: ReceivedMessage[]) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(messages);
    };
    const unsubscribe = deps.bus.subscribe(queue.arn, (event) => {
      if (!WAKE_EVENTS.has(event.type)) return;
      // Let the sender's transaction finish first.
      setImmediate(() => {
        if (done) return;
        const messages = receiveNow(deps, queue.id, opts);
        if (messages.length) finish(messages);
      });
    });
    const timer = setTimeout(() => finish([]), waitSeconds * 1000);
  });
}

// ---------------------------------------------------------------- delete and visibility

export interface DeleteResult {
  /** CloudLearn teaching note when a delete didn't remove anything. */
  CloudLearnNote?: string;
}

export function deleteMessage(deps: CoreDeps, queue: Queue, handle: string): DeleteResult {
  const messageId = messageIdFromHandle(handle);
  if (!messageId) throw invalidHandle(handle);
  return transaction(deps.db, () => {
    const now = deps.clock.now().getTime();
    const r = get<MessageRow>(
      deps.db,
      "SELECT * FROM sqs_messages WHERE message_id = ? AND queue_id = ?",
      messageId,
      queue.id,
    );
    if (!r) {
      return {
        CloudLearnNote:
          "This message was already deleted (or never existed). SQS still returns success.",
      };
    }
    if (r.receipt_handle !== handle) {
      // Real SQS behavior: an outdated receipt handle "succeeds" but may not delete anything.
      publish(deps, queue.arn, "stale_delete", { messageId, message: toView(r, now) });
      return {
        CloudLearnNote:
          "This receipt handle is from an earlier receive. The message was received again since then, so SQS accepted the request but did NOT delete the message. Always delete with the most recent receipt handle.",
      };
    }
    run(deps.db, "DELETE FROM sqs_messages WHERE seq = ?", r.seq);
    publish(deps, queue.arn, "deleted", { messageId, message: toView(r, now) });
    return {};
  });
}

export function changeVisibility(
  deps: CoreDeps,
  queue: Queue,
  handle: string,
  timeoutSeconds: number,
) {
  const messageId = messageIdFromHandle(handle);
  if (!messageId) throw invalidHandle(handle);
  const now = deps.clock.now().getTime();
  const r = get<MessageRow>(
    deps.db,
    "SELECT * FROM sqs_messages WHERE message_id = ? AND queue_id = ?",
    messageId,
    queue.id,
  );
  if (!r || r.receipt_handle !== handle) throw invalidHandle(handle);
  if (r.visible_at <= now) {
    throw new AwsError(
      "MessageNotInflight",
      "The message referred to isn't in flight. Its visibility timeout already expired.",
    );
  }
  run(
    deps.db,
    "UPDATE sqs_messages SET visible_at = ? WHERE seq = ?",
    now + timeoutSeconds * 1000,
    r.seq,
  );
  const updated = get<MessageRow>(
    deps.db,
    "SELECT * FROM sqs_messages WHERE seq = ?",
    r.seq,
  ) as MessageRow;
  publish(deps, queue.arn, "visibility_changed", {
    message: toView(updated, now),
    visibilityTimeout: timeoutSeconds,
  });
}

// ---------------------------------------------------------------- purge, DLQ redrive

export function purgeQueue(deps: CoreDeps, queue: Queue) {
  const now = deps.clock.now().getTime();
  if (queue.lastPurgedAt && now - queue.lastPurgedAt < 60_000) {
    throw new AwsError(
      "PurgeQueueInProgress",
      `Only one PurgeQueue operation on ${queue.name} is allowed every 60 seconds.`,
      403,
    );
  }
  transaction(deps.db, () => {
    const count =
      get<{ n: number }>(
        deps.db,
        "SELECT COUNT(*) AS n FROM sqs_messages WHERE queue_id = ?",
        queue.id,
      )?.n ?? 0;
    run(deps.db, "DELETE FROM sqs_messages WHERE queue_id = ?", queue.id);
    run(deps.db, "UPDATE sqs_queues SET last_purged_at = ? WHERE id = ?", now, queue.id);
    publish(deps, queue.arn, "purged", { count });
  });
}

/**
 * StartMessageMoveTask: moves messages out of a dead-letter queue, back to the queue each one
 * came from (or to `destination`). Done instantly in the simulator.
 */
export function redriveMessages(deps: CoreDeps, dlq: Queue, destination: Queue | null): number {
  const now = deps.clock.now().getTime();
  return transaction(deps.db, () => {
    const rows = all<MessageRow>(
      deps.db,
      "SELECT * FROM sqs_messages WHERE queue_id = ? ORDER BY seq",
      dlq.id,
    );
    let moved = 0;
    for (const r of rows) {
      const target =
        destination ?? (r.dlq_source_arn ? findQueueByArn(deps.db, r.dlq_source_arn) : undefined);
      if (!target) continue;
      run(
        deps.db,
        `UPDATE sqs_messages SET queue_id = ?, visible_at = ?, receive_count = 0, receipt_handle = NULL,
           first_received_at = NULL, dlq_source_arn = NULL, expires_at = ? WHERE seq = ?`,
        target.id,
        now,
        r.sent_at + target.messageRetentionPeriod * 1000,
        r.seq,
      );
      const updated = get<MessageRow>(
        deps.db,
        "SELECT * FROM sqs_messages WHERE seq = ?",
        r.seq,
      ) as MessageRow;
      const data = {
        messageId: r.message_id,
        fromQueueArn: dlq.arn,
        toQueueArn: target.arn,
        message: toView(updated, now),
      };
      publish(deps, dlq.arn, "redriven", data);
      publish(deps, target.arn, "redriven", data);
      moved++;
    }
    return moved;
  });
}

// ---------------------------------------------------------------- the ticker

/**
 * Runs every second. Visibility timeouts and delays end on their own, with no API call, so the
 * ticker announces those changes to live views. It also deletes messages past their retention
 * period and expired FIFO deduplication entries.
 */
export function tick(deps: CoreDeps, since: number, now: number) {
  const { db } = deps;
  const changed = all<MessageRow & { queue_arn: string }>(
    db,
    `SELECT m.*, q.arn AS queue_arn FROM sqs_messages m JOIN sqs_queues q ON q.id = m.queue_id
     WHERE m.visible_at > ? AND m.visible_at <= ? AND m.expires_at > ?`,
    since,
    now,
    now,
  );
  for (const r of changed) {
    publish(deps, r.queue_arn, r.receive_count > 0 ? "visible" : "delay_ended", {
      message: toView(r, now),
    });
  }

  const expired = all<MessageRow & { queue_arn: string }>(
    db,
    `SELECT m.*, q.arn AS queue_arn FROM sqs_messages m JOIN sqs_queues q ON q.id = m.queue_id
     WHERE m.expires_at <= ?`,
    now,
  );
  if (expired.length) {
    run(db, "DELETE FROM sqs_messages WHERE expires_at <= ?", now);
    for (const r of expired)
      publish(deps, r.queue_arn, "expired", { messageId: r.message_id, message: toView(r, now) });
  }
  run(db, "DELETE FROM sqs_dedup WHERE expires_at <= ?", now);
}
