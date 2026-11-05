import type { PolicySource } from "@cloudlearn/iam-engine";
import { generateToken } from "@cloudlearn/shared";
import { z } from "zod";
import { all, run, transaction } from "../../core/db";
import { AwsError } from "../../core/errors";
import { type AnyActionDef, defineAction, type RequestContext } from "../../core/service";
import {
  changeVisibility,
  deleteMessage,
  listMessageViews,
  purgeQueue,
  receiveMessages,
  redriveMessages,
  sendMessage,
} from "./messages";
import {
  applyUpdates,
  arnForUrl,
  checkQueueName,
  deadLetterSourceQueues,
  deleteQueueRow,
  differingAttribute,
  findQueue,
  findQueueByArn,
  findQueueByUrl,
  insertQueue,
  listQueues,
  type Queue,
  queueArn,
  queueAttributes,
  queueDoesNotExist,
  recentlyDeleted,
  requireQueueByUrl,
  resolveAttributes,
  setTags,
} from "./queues";

// ---------------------------------------------------------------- shared input pieces

const QueueUrl = z.string().min(1, "QueueUrl is required.");
const Attributes = z.record(z.string(), z.string());
const MessageAttributes = z.record(
  z.string().min(1).max(256),
  z.object({
    DataType: z.string().min(1),
    StringValue: z.string().optional(),
    BinaryValue: z.string().optional(),
  }),
);
// MessageGroupId / MessageDeduplicationId: 1-128 printable ASCII characters.
const FifoToken = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\x21-\x7E]+$/, "Must be 1-128 printable ASCII characters without spaces.");
const VisibilityTimeout = z.number().int().min(0).max(43200);
const BatchEntryId = z
  .string()
  .regex(
    /^[\w-]{1,80}$/,
    "A batch entry id can only contain alphanumeric characters, hyphens and underscores. It can be at most 80 letters long.",
  );

const SendFields = {
  MessageBody: z.string().min(1, "The request must contain the parameter MessageBody."),
  DelaySeconds: z.number().int().min(0).max(900).optional(),
  MessageAttributes: MessageAttributes.optional(),
  MessageGroupId: FifoToken.optional(),
  MessageDeduplicationId: FifoToken.optional(),
};

/** The queue policy, if any, takes part in authorization (resource-based policy). */
function queuePolicies(url: string, ctx: RequestContext): PolicySource[] {
  const queue = findQueueByUrl(ctx.deps.db, url);
  return queue?.policy
    ? [
        {
          id: `${queue.arn}/policy`,
          name: `${queue.name} queue policy`,
          type: "resource-based",
          document: queue.policy,
        },
      ]
    : [];
}

const byUrl = {
  resource: (i: { QueueUrl: string }) => arnForUrl(i.QueueUrl),
  resourcePolicies: (i: { QueueUrl: string }, ctx: RequestContext) =>
    queuePolicies(i.QueueUrl, ctx),
};

function checkBatch(entries: { Id: string }[]) {
  if (entries.length === 0)
    throw new AwsError(
      "EmptyBatchRequest",
      "There should be at least one SendMessageBatchRequestEntry in the request.",
    );
  if (entries.length > 10)
    throw new AwsError(
      "TooManyEntriesInBatchRequest",
      `Maximum number of entries per request are 10. You have sent ${entries.length}.`,
    );
  const ids = new Set(entries.map((e) => e.Id));
  if (ids.size !== entries.length)
    throw new AwsError(
      "BatchEntryIdsNotDistinct",
      "Id values must be unique within a batch request.",
    );
}

function batchFailure(id: string, err: unknown) {
  if (err instanceof AwsError)
    return { Id: id, SenderFault: true, Code: err.code, Message: err.message };
  throw err;
}

const senderId = (ctx: RequestContext) => ctx.session.principal.id;
const nowMs = (ctx: RequestContext) => ctx.deps.clock.now().getTime();

// ---------------------------------------------------------------- actions

export const sqsActions: AnyActionDef[] = [
  defineAction({
    name: "CreateQueue",
    iamAction: "sqs:CreateQueue",
    accessLevel: "Write",
    input: z.object({
      QueueName: z.string().min(1).max(80),
      Attributes: Attributes.default({}),
      tags: z.record(z.string(), z.string()).default({}),
    }),
    resource: (i, ctx) => queueArn(ctx.session.accountId, i.QueueName),
    handler: (i, ctx) => {
      const { db } = ctx.deps;
      const accountId = ctx.session.accountId;
      const fifo = i.Attributes.FifoQueue === "true";
      checkQueueName(i.QueueName, fifo);
      const arn = queueArn(accountId, i.QueueName);
      const updates = resolveAttributes(ctx.deps, { accountId, arn, fifo }, i.Attributes, "create");

      const existing = findQueue(db, accountId, i.QueueName);
      if (existing) {
        // CreateQueue is idempotent: same name and same attributes returns the existing queue.
        const differs =
          existing.fifo !== fifo ? "FifoQueue" : differingAttribute(existing, updates);
        if (differs) {
          throw new AwsError(
            "QueueAlreadyExists",
            `A queue already exists with the same name and a different value for attribute ${differs}`,
          );
        }
        return { QueueUrl: existing.url };
      }
      if (recentlyDeleted(db, accountId, i.QueueName, nowMs(ctx))) {
        throw new AwsError(
          "QueueDeletedRecently",
          "You must wait 60 seconds after deleting a queue before you can create another queue with the same name.",
        );
      }
      const queue = transaction(db, () =>
        insertQueueWithTags(ctx, i.QueueName, fifo, updates, i.tags),
      );
      return { QueueUrl: queue.url };
    },
  }),

  defineAction({
    name: "GetQueueUrl",
    iamAction: "sqs:GetQueueUrl",
    accessLevel: "Read",
    input: z.object({
      QueueName: z.string().min(1).max(80),
      QueueOwnerAWSAccountId: z
        .string()
        .regex(/^\d{12}$/)
        .optional(),
    }),
    resource: (i, ctx) => queueArn(i.QueueOwnerAWSAccountId ?? ctx.session.accountId, i.QueueName),
    handler: (i, ctx) => {
      const queue = findQueue(
        ctx.deps.db,
        i.QueueOwnerAWSAccountId ?? ctx.session.accountId,
        i.QueueName,
      );
      if (!queue) throw queueDoesNotExist();
      return { QueueUrl: queue.url };
    },
  }),

  defineAction({
    name: "ListQueues",
    iamAction: "sqs:ListQueues",
    accessLevel: "List",
    input: z.object({
      QueueNamePrefix: z.string().max(80).default(""),
      MaxResults: z.number().int().min(1).max(1000).optional(),
      NextToken: z.string().regex(/^\d+$/).optional(),
    }),
    handler: (i, ctx) => {
      const urls = listQueues(ctx.deps.db, ctx.session.accountId, i.QueueNamePrefix).map(
        (q) => q.url,
      );
      if (!i.MaxResults) return { QueueUrls: urls };
      const start = i.NextToken ? Number(i.NextToken) : 0;
      const page = urls.slice(start, start + i.MaxResults);
      const next = start + i.MaxResults;
      return { QueueUrls: page, ...(next < urls.length ? { NextToken: String(next) } : {}) };
    },
  }),

  defineAction({
    name: "GetQueueAttributes",
    iamAction: "sqs:GetQueueAttributes",
    accessLevel: "Read",
    input: z.object({ QueueUrl, AttributeNames: z.array(z.string()).default(["All"]) }),
    ...byUrl,
    handler: (i, ctx) => {
      const queue = requireQueueByUrl(ctx.deps.db, i.QueueUrl);
      const attrs = queueAttributes(ctx.deps.db, queue, nowMs(ctx));
      if (i.AttributeNames.includes("All")) return { Attributes: attrs };
      const picked: Record<string, string> = {};
      for (const name of i.AttributeNames) {
        if (
          !(name in attrs) &&
          ![
            "FifoQueue",
            "ContentBasedDeduplication",
            "RedrivePolicy",
            "RedriveAllowPolicy",
            "Policy",
          ].includes(name)
        ) {
          throw new AwsError("InvalidAttributeName", `Unknown Attribute ${name}.`);
        }
        if (attrs[name] !== undefined) picked[name] = attrs[name] as string;
      }
      return { Attributes: picked };
    },
  }),

  defineAction({
    name: "SetQueueAttributes",
    iamAction: "sqs:SetQueueAttributes",
    accessLevel: "Write",
    input: z.object({ QueueUrl, Attributes }),
    ...byUrl,
    handler: (i, ctx) => {
      const queue = requireQueueByUrl(ctx.deps.db, i.QueueUrl);
      const updates = resolveAttributes(ctx.deps, queue, i.Attributes, "set");
      applyUpdates(ctx.deps.db, queue.id, updates, nowMs(ctx));
      ctx.deps.bus.publish({
        topic: queue.arn,
        type: "attributes_changed",
        at: ctx.deps.clock.now().toISOString(),
        data: { queueArn: queue.arn, attributes: Object.keys(i.Attributes) },
      });
      return {};
    },
  }),

  defineAction({
    name: "DeleteQueue",
    iamAction: "sqs:DeleteQueue",
    accessLevel: "Write",
    input: z.object({ QueueUrl }),
    ...byUrl,
    handler: (i, ctx) => {
      const queue = requireQueueByUrl(ctx.deps.db, i.QueueUrl);
      transaction(ctx.deps.db, () => deleteQueueRow(ctx.deps.db, queue, nowMs(ctx)));
      ctx.deps.bus.publish({
        topic: queue.arn,
        type: "queue_deleted",
        at: ctx.deps.clock.now().toISOString(),
        data: { queueArn: queue.arn },
      });
      return {};
    },
  }),

  defineAction({
    name: "PurgeQueue",
    iamAction: "sqs:PurgeQueue",
    accessLevel: "Write",
    input: z.object({ QueueUrl }),
    ...byUrl,
    handler: (i, ctx) => {
      purgeQueue(ctx.deps, requireQueueByUrl(ctx.deps.db, i.QueueUrl));
      return {};
    },
  }),

  // ---------------------------------------------------------------- messages (data events)

  defineAction({
    name: "SendMessage",
    iamAction: "sqs:SendMessage",
    accessLevel: "Write",
    dataEvent: true,
    input: z.object({ QueueUrl, ...SendFields }),
    ...byUrl,
    handler: (i, ctx) => {
      const { QueueUrl: url, ...send } = i;
      return sendMessage(ctx.deps, requireQueueByUrl(ctx.deps.db, url), send, senderId(ctx));
    },
  }),

  defineAction({
    name: "SendMessageBatch",
    iamAction: "sqs:SendMessage",
    accessLevel: "Write",
    dataEvent: true,
    input: z.object({
      QueueUrl,
      Entries: z.array(z.object({ Id: BatchEntryId, ...SendFields })).max(1000),
    }),
    ...byUrl,
    handler: (i, ctx) => {
      const queue = requireQueueByUrl(ctx.deps.db, i.QueueUrl);
      checkBatch(i.Entries);
      const total = i.Entries.reduce((n, e) => n + Buffer.byteLength(e.MessageBody, "utf8"), 0);
      if (total > queue.maximumMessageSize) {
        throw new AwsError(
          "BatchRequestTooLong",
          `Batch requests cannot be longer than ${queue.maximumMessageSize} bytes. You have sent ${total} bytes.`,
        );
      }
      const Successful: unknown[] = [];
      const Failed: unknown[] = [];
      for (const { Id, ...send } of i.Entries) {
        try {
          Successful.push({ Id, ...sendMessage(ctx.deps, queue, send, senderId(ctx)) });
        } catch (err) {
          Failed.push(batchFailure(Id, err));
        }
      }
      return { Successful, Failed };
    },
  }),

  defineAction({
    name: "ReceiveMessage",
    iamAction: "sqs:ReceiveMessage",
    accessLevel: "Read",
    dataEvent: true,
    input: z.object({
      QueueUrl,
      MaxNumberOfMessages: z
        .number()
        .int()
        .min(1, "MaxNumberOfMessages must be between 1 and 10.")
        .max(10, "MaxNumberOfMessages must be between 1 and 10.")
        .default(1),
      VisibilityTimeout: VisibilityTimeout.optional(),
      WaitTimeSeconds: z.number().int().min(0).max(20).optional(),
      AttributeNames: z.array(z.string()).default([]),
      MessageSystemAttributeNames: z.array(z.string()).default([]),
      MessageAttributeNames: z.array(z.string()).default([]),
      ReceiveRequestAttemptId: z.string().max(128).optional(),
    }),
    ...byUrl,
    handler: async (i, ctx) => {
      const queue = requireQueueByUrl(ctx.deps.db, i.QueueUrl);
      const messages = await receiveMessages(
        ctx.deps,
        queue,
        {
          max: i.MaxNumberOfMessages,
          visibilityTimeout: i.VisibilityTimeout,
          attributeNames: [...i.AttributeNames, ...i.MessageSystemAttributeNames],
          messageAttributeNames: i.MessageAttributeNames,
        },
        i.WaitTimeSeconds ?? queue.receiveWaitTime,
      );
      // Like the real API, an empty receive returns no Messages key at all.
      return messages.length ? { Messages: messages } : {};
    },
  }),

  defineAction({
    name: "DeleteMessage",
    iamAction: "sqs:DeleteMessage",
    accessLevel: "Write",
    dataEvent: true,
    input: z.object({ QueueUrl, ReceiptHandle: z.string().min(1) }),
    ...byUrl,
    handler: (i, ctx) =>
      deleteMessage(ctx.deps, requireQueueByUrl(ctx.deps.db, i.QueueUrl), i.ReceiptHandle),
  }),

  defineAction({
    name: "DeleteMessageBatch",
    iamAction: "sqs:DeleteMessage",
    accessLevel: "Write",
    dataEvent: true,
    input: z.object({
      QueueUrl,
      Entries: z.array(z.object({ Id: BatchEntryId, ReceiptHandle: z.string().min(1) })).max(1000),
    }),
    ...byUrl,
    handler: (i, ctx) => {
      const queue = requireQueueByUrl(ctx.deps.db, i.QueueUrl);
      checkBatch(i.Entries);
      const Successful: unknown[] = [];
      const Failed: unknown[] = [];
      for (const e of i.Entries) {
        try {
          deleteMessage(ctx.deps, queue, e.ReceiptHandle);
          Successful.push({ Id: e.Id });
        } catch (err) {
          Failed.push(batchFailure(e.Id, err));
        }
      }
      return { Successful, Failed };
    },
  }),

  defineAction({
    name: "ChangeMessageVisibility",
    iamAction: "sqs:ChangeMessageVisibility",
    accessLevel: "Write",
    dataEvent: true,
    input: z.object({ QueueUrl, ReceiptHandle: z.string().min(1), VisibilityTimeout }),
    ...byUrl,
    handler: (i, ctx) => {
      changeVisibility(
        ctx.deps,
        requireQueueByUrl(ctx.deps.db, i.QueueUrl),
        i.ReceiptHandle,
        i.VisibilityTimeout,
      );
      return {};
    },
  }),

  defineAction({
    name: "ChangeMessageVisibilityBatch",
    iamAction: "sqs:ChangeMessageVisibility",
    accessLevel: "Write",
    dataEvent: true,
    input: z.object({
      QueueUrl,
      Entries: z
        .array(z.object({ Id: BatchEntryId, ReceiptHandle: z.string().min(1), VisibilityTimeout }))
        .max(1000),
    }),
    ...byUrl,
    handler: (i, ctx) => {
      const queue = requireQueueByUrl(ctx.deps.db, i.QueueUrl);
      checkBatch(i.Entries);
      const Successful: unknown[] = [];
      const Failed: unknown[] = [];
      for (const e of i.Entries) {
        try {
          changeVisibility(ctx.deps, queue, e.ReceiptHandle, e.VisibilityTimeout);
          Successful.push({ Id: e.Id });
        } catch (err) {
          Failed.push(batchFailure(e.Id, err));
        }
      }
      return { Successful, Failed };
    },
  }),

  // ---------------------------------------------------------------- dead-letter queues

  defineAction({
    name: "ListDeadLetterSourceQueues",
    iamAction: "sqs:ListDeadLetterSourceQueues",
    accessLevel: "List",
    input: z.object({ QueueUrl }),
    ...byUrl,
    handler: (i, ctx) => {
      const queue = requireQueueByUrl(ctx.deps.db, i.QueueUrl);
      // The real API uses lowercase "queueUrls" here.
      return { queueUrls: deadLetterSourceQueues(ctx.deps.db, queue.arn).map((q) => q.url) };
    },
  }),

  defineAction({
    name: "StartMessageMoveTask",
    iamAction: "sqs:StartMessageMoveTask",
    accessLevel: "Write",
    input: z.object({
      SourceArn: z.string().startsWith("arn:aws:sqs:"),
      DestinationArn: z.string().startsWith("arn:aws:sqs:").optional(),
      MaxNumberOfMessagesPerSecond: z.number().int().min(1).max(500).optional(),
    }),
    resource: (i) => i.SourceArn,
    handler: (i, ctx) => {
      const { db } = ctx.deps;
      const source = findQueueByArn(db, i.SourceArn);
      if (!source || source.accountId !== ctx.session.accountId) throw queueDoesNotExist();
      if (deadLetterSourceQueues(db, source.arn).length === 0) {
        throw new AwsError(
          "InvalidParameterValue",
          "Source queue must be configured as a Dead Letter Queue.",
        );
      }
      let destination: Queue | null = null;
      if (i.DestinationArn) {
        destination = findQueueByArn(db, i.DestinationArn) ?? null;
        if (!destination)
          throw new AwsError(
            "ResourceNotFoundException",
            "The resource that you specified for the DestinationArn parameter doesn't exist.",
          );
      }
      const toMove =
        all<{ n: number }>(
          db,
          "SELECT COUNT(*) AS n FROM sqs_messages WHERE queue_id = ?",
          source.id,
        )[0]?.n ?? 0;
      const moved = redriveMessages(ctx.deps, source, destination);
      const taskHandle = Buffer.from(
        JSON.stringify({ taskId: generateToken(8), sourceArn: source.arn }),
      ).toString("base64");
      run(
        db,
        `INSERT INTO sqs_move_tasks (task_handle, account_id, source_arn, destination_arn, status, moved, to_move, started_at)
         VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?, ?)`,
        taskHandle,
        ctx.session.accountId,
        source.arn,
        i.DestinationArn ?? null,
        moved,
        toMove,
        nowMs(ctx),
      );
      return { TaskHandle: taskHandle };
    },
  }),

  defineAction({
    name: "ListMessageMoveTasks",
    iamAction: "sqs:ListMessageMoveTasks",
    accessLevel: "Read",
    input: z.object({
      SourceArn: z.string().startsWith("arn:aws:sqs:"),
      MaxResults: z.number().int().min(1).max(10).default(1),
    }),
    resource: (i) => i.SourceArn,
    handler: (i, ctx) => {
      const rows = all<{
        task_handle: string;
        source_arn: string;
        destination_arn: string | null;
        status: string;
        moved: number;
        to_move: number;
        started_at: number;
      }>(
        ctx.deps.db,
        "SELECT * FROM sqs_move_tasks WHERE account_id = ? AND source_arn = ? ORDER BY started_at DESC LIMIT ?",
        ctx.session.accountId,
        i.SourceArn,
        i.MaxResults,
      );
      return {
        Results: rows.map((r) => ({
          TaskHandle: r.task_handle,
          Status: r.status,
          SourceArn: r.source_arn,
          ...(r.destination_arn ? { DestinationArn: r.destination_arn } : {}),
          ApproximateNumberOfMessagesMoved: r.moved,
          ApproximateNumberOfMessagesToMove: r.to_move,
          StartedTimestamp: r.started_at,
        })),
      };
    },
  }),

  // ---------------------------------------------------------------- tags

  defineAction({
    name: "TagQueue",
    iamAction: "sqs:TagQueue",
    accessLevel: "Tagging",
    input: z.object({ QueueUrl, Tags: z.record(z.string().min(1).max(128), z.string().max(256)) }),
    ...byUrl,
    handler: (i, ctx) => {
      const queue = requireQueueByUrl(ctx.deps.db, i.QueueUrl);
      const tags = { ...queue.tags, ...i.Tags };
      if (Object.keys(tags).length > 50)
        throw new AwsError(
          "InvalidParameterValue",
          "Too many tags added for queue. The maximum is 50.",
        );
      setTags(ctx.deps.db, queue.id, tags);
      return {};
    },
  }),

  defineAction({
    name: "UntagQueue",
    iamAction: "sqs:UntagQueue",
    accessLevel: "Tagging",
    input: z.object({ QueueUrl, TagKeys: z.array(z.string()).min(1) }),
    ...byUrl,
    handler: (i, ctx) => {
      const queue = requireQueueByUrl(ctx.deps.db, i.QueueUrl);
      const tags = { ...queue.tags };
      for (const key of i.TagKeys) delete tags[key];
      setTags(ctx.deps.db, queue.id, tags);
      return {};
    },
  }),

  defineAction({
    name: "ListQueueTags",
    iamAction: "sqs:ListQueueTags",
    accessLevel: "Read",
    input: z.object({ QueueUrl }),
    ...byUrl,
    handler: (i, ctx) => ({ Tags: requireQueueByUrl(ctx.deps.db, i.QueueUrl).tags }),
  }),

  // ---------------------------------------------------------------- CloudLearn: simulator snapshot

  defineAction({
    // Not an AWS API: the simulator's read-only view of every message and its state. It's
    // authorized like GetQueueAttributes because it only reads.
    name: "SimulatorSnapshot",
    iamAction: "sqs:GetQueueAttributes",
    accessLevel: "Read",
    record: false,
    input: z.object({ QueueUrl }),
    ...byUrl,
    handler: (i, ctx) => {
      const { deps, session } = ctx;
      const queue = requireQueueByUrl(deps.db, i.QueueUrl);
      const now = nowMs(ctx);
      let deadLetterQueue: unknown = null;
      const dlq = queue.redrivePolicy
        ? findQueueByArn(deps.db, queue.redrivePolicy.deadLetterTargetArn)
        : undefined;
      if (dlq) {
        const allowed =
          deps.authorizer.authorize({
            session,
            action: "sqs:GetQueueAttributes",
            resource: dlq.arn,
          }).decision === "Allow";
        deadLetterQueue = allowed
          ? { Url: dlq.url, Arn: dlq.arn, Name: dlq.name, Messages: listMessageViews(deps, dlq) }
          : { Url: dlq.url, Arn: dlq.arn, Name: dlq.name, AccessDenied: true, Messages: [] };
      }
      return {
        ServerTime: now,
        Queue: {
          Url: queue.url,
          Arn: queue.arn,
          Name: queue.name,
          Fifo: queue.fifo,
          Attributes: queueAttributes(deps.db, queue, now),
        },
        Messages: listMessageViews(deps, queue),
        DeadLetterQueue: deadLetterQueue,
      };
    },
  }),
];

function insertQueueWithTags(
  ctx: RequestContext,
  name: string,
  fifo: boolean,
  updates: ReturnType<typeof resolveAttributes>,
  tags: Record<string, string>,
): Queue {
  const queue = insertQueue(
    ctx.deps.db,
    { accountId: ctx.session.accountId, name, fifo, now: nowMs(ctx) },
    updates,
  );
  if (Object.keys(tags).length) setTags(ctx.deps.db, queue.id, tags);
  return queue;
}
