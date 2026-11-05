import { beforeEach, describe, expect, it } from "vitest";
import { tick } from "../src/services/sqs/messages";
import { createTestApp, ok, type TestClient } from "./helpers";

let t: ReturnType<typeof createTestApp>;
let root: TestClient;
let accountId: string;

const sqs = (c: TestClient, action: string, input: unknown = {}) => c.action("sqs", action, input);

async function createQueue(name: string, attributes: Record<string, string> = {}) {
  return ok(await sqs(root, "CreateQueue", { QueueName: name, Attributes: attributes }))
    .QueueUrl as string;
}

const send = async (url: string, body: string, extra: Record<string, unknown> = {}) =>
  ok(await sqs(root, "SendMessage", { QueueUrl: url, MessageBody: body, ...extra }));

const receive = async (url: string, extra: Record<string, unknown> = {}) =>
  (ok(await sqs(root, "ReceiveMessage", { QueueUrl: url, AttributeNames: ["All"], ...extra }))
    .Messages ?? []) as {
    MessageId: string;
    Body: string;
    ReceiptHandle: string;
    Attributes: Record<string, string>;
  }[];

/** Move the fake clock and run the background ticker, as the real server does every second. */
function advance(ms: number) {
  const before = t.clock.now().getTime();
  t.clock.advance(ms);
  tick(t.deps, before, t.clock.now().getTime());
}

beforeEach(async () => {
  t = createTestApp();
  root = t.client();
  accountId = ok(await root.signUp()).session.accountId;
});

describe("queues", () => {
  it("creates queues with real-looking URLs and ARNs, idempotently", async () => {
    const url = await createQueue("orders");
    expect(url).toBe(`https://sqs.us-east-1.amazonaws.com/${accountId}/orders`);
    expect(await createQueue("orders")).toBe(url);
    const conflict = await sqs(root, "CreateQueue", {
      QueueName: "orders",
      Attributes: { VisibilityTimeout: "60" },
    });
    expect(conflict.body).toMatchObject({ code: "QueueAlreadyExists" });
    const attrs = ok(await sqs(root, "GetQueueAttributes", { QueueUrl: url })).Attributes;
    expect(attrs).toMatchObject({
      QueueArn: `arn:aws:sqs:us-east-1:${accountId}:orders`,
      VisibilityTimeout: "30",
    });
  });

  it("enforces FIFO naming and attribute ranges", async () => {
    expect(
      (await sqs(root, "CreateQueue", { QueueName: "jobs", Attributes: { FifoQueue: "true" } }))
        .body.message,
    ).toMatch(/must end with \.fifo/);
    expect((await sqs(root, "CreateQueue", { QueueName: "jobs.fifo" })).body.code).toBe(
      "InvalidParameterValue",
    );
    const bad = await sqs(root, "CreateQueue", {
      QueueName: "x",
      Attributes: { VisibilityTimeout: "50000" },
    });
    expect(bad.body).toMatchObject({ code: "InvalidAttributeValue" });
    expect(
      (await sqs(root, "CreateQueue", { QueueName: "x", Attributes: { Nope: "1" } })).body.code,
    ).toBe("InvalidAttributeName");
  });

  it("makes you wait 60 seconds to reuse a deleted queue's name", async () => {
    const url = await createQueue("temp");
    ok(await sqs(root, "DeleteQueue", { QueueUrl: url }));
    expect((await sqs(root, "CreateQueue", { QueueName: "temp" })).body.code).toBe(
      "QueueDeletedRecently",
    );
    advance(61_000);
    await createQueue("temp");
  });

  it("lists queues by prefix", async () => {
    await createQueue("orders");
    await createQueue("orders-dlq");
    await createQueue("payments");
    expect(ok(await sqs(root, "ListQueues", { QueueNamePrefix: "orders" })).QueueUrls).toHaveLength(
      2,
    );
  });

  it("rejects a dead-letter queue of the wrong type", async () => {
    const dlq = await createQueue("dlq.fifo", { FifoQueue: "true" });
    const dlqArn = ok(await sqs(root, "GetQueueAttributes", { QueueUrl: dlq })).Attributes.QueueArn;
    const res = await sqs(root, "CreateQueue", {
      QueueName: "std",
      Attributes: {
        RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 3 }),
      },
    });
    expect(res.body.message).toMatch(/must be same type of queue/);
  });
});

describe("messages", () => {
  it("sends and receives with the MD5 of the body", async () => {
    const url = await createQueue("q");
    const sent = await send(url, "hello");
    expect(sent.MD5OfMessageBody).toBe("5d41402abc4b2a76b9719d911017c592");
    const [m] = await receive(url);
    expect(m).toMatchObject({ MessageId: sent.MessageId, Body: "hello" });
    expect(m?.Attributes.ApproximateReceiveCount).toBe("1");
  });

  it("hides received messages until the visibility timeout ends, then redelivers them", async () => {
    const url = await createQueue("q", { VisibilityTimeout: "30" });
    await send(url, "job");
    const [first] = await receive(url);
    expect(await receive(url)).toHaveLength(0); // in flight
    advance(29_000);
    expect(await receive(url)).toHaveLength(0);
    advance(1_000);
    const [again] = await receive(url);
    expect(again?.MessageId).toBe(first?.MessageId);
    expect(again?.Attributes.ApproximateReceiveCount).toBe("2");

    // The old receipt handle "succeeds" but doesn't delete anything (real SQS behavior).
    const stale = ok(
      await sqs(root, "DeleteMessage", { QueueUrl: url, ReceiptHandle: first?.ReceiptHandle }),
    );
    expect(stale.CloudLearnNote).toMatch(/did NOT delete/);
    advance(30_000);
    expect(await receive(url)).toHaveLength(1);
  });

  it("deletes with the latest receipt handle; rejects garbage handles", async () => {
    const url = await createQueue("q");
    await send(url, "job");
    const [m] = await receive(url);
    ok(await sqs(root, "DeleteMessage", { QueueUrl: url, ReceiptHandle: m?.ReceiptHandle }));
    advance(31_000);
    expect(await receive(url)).toHaveLength(0);
    expect(
      (await sqs(root, "DeleteMessage", { QueueUrl: url, ReceiptHandle: "garbage" })).body.code,
    ).toBe("ReceiptHandleIsInvalid");
  });

  it("ChangeMessageVisibility to 0 makes a message available right away", async () => {
    const url = await createQueue("q");
    await send(url, "job");
    const [m] = await receive(url);
    ok(
      await sqs(root, "ChangeMessageVisibility", {
        QueueUrl: url,
        ReceiptHandle: m?.ReceiptHandle,
        VisibilityTimeout: 0,
      }),
    );
    expect(await receive(url)).toHaveLength(1);
  });

  it("delays messages", async () => {
    const url = await createQueue("q");
    await send(url, "later", { DelaySeconds: 10 });
    expect(await receive(url)).toHaveLength(0);
    const attrs = ok(await sqs(root, "GetQueueAttributes", { QueueUrl: url })).Attributes;
    expect(attrs.ApproximateNumberOfMessagesDelayed).toBe("1");
    advance(10_000);
    expect(await receive(url)).toHaveLength(1);
  });

  it("deletes messages after the retention period", async () => {
    const url = await createQueue("q", { MessageRetentionPeriod: "60" });
    await send(url, "short-lived");
    advance(61_000);
    expect(await receive(url)).toHaveLength(0);
  });

  it("long polling waits for a message to arrive", async () => {
    const url = await createQueue("q");
    const pending = receive(url, { WaitTimeSeconds: 5 });
    setTimeout(() => void send(url, "arrived"), 50);
    const messages = await pending;
    expect(messages[0]?.Body).toBe("arrived");
  });

  it("enforces the 60-second purge cooldown", async () => {
    const url = await createQueue("q");
    await send(url, "a");
    ok(await sqs(root, "PurgeQueue", { QueueUrl: url }));
    expect(await receive(url)).toHaveLength(0);
    expect((await sqs(root, "PurgeQueue", { QueueUrl: url })).body.code).toBe(
      "PurgeQueueInProgress",
    );
  });

  it("handles batches with partial failures", async () => {
    const url = await createQueue("q");
    const res = ok(
      await sqs(root, "SendMessageBatch", {
        QueueUrl: url,
        Entries: [
          { Id: "a", MessageBody: "one" },
          { Id: "b", MessageBody: "two", MessageDeduplicationId: "x" },
        ],
      }),
    );
    expect(res.Successful).toHaveLength(1);
    expect(res.Failed[0]).toMatchObject({ Id: "b", Code: "InvalidParameterValue" });
    expect((await sqs(root, "SendMessageBatch", { QueueUrl: url, Entries: [] })).body.code).toBe(
      "EmptyBatchRequest",
    );
  });
});

describe("dead-letter queues", () => {
  async function setup(maxReceiveCount = 2) {
    const dlq = await createQueue("orders-dlq");
    const dlqArn = ok(await sqs(root, "GetQueueAttributes", { QueueUrl: dlq })).Attributes.QueueArn;
    const src = await createQueue("orders", {
      VisibilityTimeout: "10",
      RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount }),
    });
    return { src, dlq, dlqArn };
  }

  it("moves a message to the DLQ after maxReceiveCount receives without a delete", async () => {
    const { src, dlq } = await setup(2);
    await send(src, "poison");
    expect(await receive(src)).toHaveLength(1);
    advance(10_000);
    expect(await receive(src)).toHaveLength(1);
    advance(10_000);
    expect(await receive(src)).toHaveLength(0); // third attempt: moved instead
    const [dead] = await receive(dlq);
    expect(dead?.Body).toBe("poison");
    expect(dead?.Attributes.DeadLetterQueueSourceArn).toBe(
      `arn:aws:sqs:us-east-1:${accountId}:orders`,
    );
    expect(ok(await sqs(root, "ListDeadLetterSourceQueues", { QueueUrl: dlq })).queueUrls).toEqual([
      src,
    ]);
  });

  it("redrives messages back to the source queue", async () => {
    const { src, dlqArn } = await setup(1);
    await send(src, "retry-me");
    await receive(src);
    advance(10_000);
    await receive(src); // moves to DLQ
    const task = ok(await sqs(root, "StartMessageMoveTask", { SourceArn: dlqArn }));
    expect(task.TaskHandle).toBeTruthy();
    const [back] = await receive(src);
    expect(back?.Body).toBe("retry-me");
    expect(back?.Attributes.ApproximateReceiveCount).toBe("1");
    const tasks = ok(await sqs(root, "ListMessageMoveTasks", { SourceArn: dlqArn })).Results;
    expect(tasks[0]).toMatchObject({ Status: "COMPLETED", ApproximateNumberOfMessagesMoved: 1 });
  });
});

describe("FIFO queues", () => {
  const fifo = (name = "jobs.fifo", extra: Record<string, string> = {}) =>
    createQueue(name, { FifoQueue: "true", ...extra });

  it("requires a MessageGroupId and a deduplication ID (or content-based dedup)", async () => {
    const url = await fifo();
    expect((await sqs(root, "SendMessage", { QueueUrl: url, MessageBody: "x" })).body.code).toBe(
      "MissingParameter",
    );
    expect(
      (await sqs(root, "SendMessage", { QueueUrl: url, MessageBody: "x", MessageGroupId: "g" }))
        .body.message,
    ).toMatch(/ContentBasedDeduplication/);
  });

  it("drops duplicates within 5 minutes", async () => {
    const url = await fifo();
    const a = await send(url, "pay $10", {
      MessageGroupId: "g",
      MessageDeduplicationId: "order-1",
    });
    const b = await send(url, "pay $10", {
      MessageGroupId: "g",
      MessageDeduplicationId: "order-1",
    });
    expect(b.MessageId).toBe(a.MessageId);
    expect(a.SequenceNumber).toMatch(/^\d{20}$/);
    expect(await receive(url, { MaxNumberOfMessages: 10 })).toHaveLength(1);
    advance(5 * 60_000 + 1);
    const c = await send(url, "pay $10", {
      MessageGroupId: "g",
      MessageDeduplicationId: "order-1",
    });
    expect(c.MessageId).not.toBe(a.MessageId);
  });

  it("content-based deduplication hashes the body", async () => {
    const url = await fifo("cb.fifo", { ContentBasedDeduplication: "true" });
    const a = await send(url, "same", { MessageGroupId: "g" });
    const b = await send(url, "same", { MessageGroupId: "g" });
    expect(b.MessageId).toBe(a.MessageId);
  });

  it("keeps order within a group and blocks the group while a message is in flight", async () => {
    const url = await fifo("ordered.fifo", { ContentBasedDeduplication: "true" });
    await send(url, "A1", { MessageGroupId: "A" });
    await send(url, "A2", { MessageGroupId: "A" });
    await send(url, "B1", { MessageGroupId: "B" });

    const [first] = await receive(url);
    expect(first?.Body).toBe("A1");
    const [second] = await receive(url);
    expect(second?.Body).toBe("B1"); // A2 waits: group A has A1 in flight
    expect(await receive(url)).toHaveLength(0);

    ok(await sqs(root, "DeleteMessage", { QueueUrl: url, ReceiptHandle: first?.ReceiptHandle }));
    const [third] = await receive(url);
    expect(third?.Body).toBe("A2");
  });

  it("rejects per-message delays", async () => {
    const url = await fifo("d.fifo", { ContentBasedDeduplication: "true" });
    const res = await sqs(root, "SendMessage", {
      QueueUrl: url,
      MessageBody: "x",
      MessageGroupId: "g",
      DelaySeconds: 5,
    });
    expect(res.body.code).toBe("InvalidParameterValue");
  });
});

describe("SQS and IAM", () => {
  it("AmazonSQSReadOnlyAccess can list but not send (Phase 3 'done when' c)", async () => {
    const url = await createQueue("orders");
    ok(await root.action("iam", "CreateUser", { UserName: "reader" }));
    ok(
      await root.action("iam", "CreateLoginProfile", {
        UserName: "reader",
        Password: "reader-pass-1",
      }),
    );
    ok(
      await root.action("iam", "AttachUserPolicy", {
        UserName: "reader",
        PolicyArn: "arn:aws:iam::aws:policy/AmazonSQSReadOnlyAccess",
      }),
    );
    const reader = t.client();
    ok(await reader.signInIam(accountId, "reader", "reader-pass-1"));
    expect(ok(await sqs(reader, "ListQueues")).QueueUrls).toEqual([url]);
    const denied = await sqs(reader, "SendMessage", { QueueUrl: url, MessageBody: "hi" });
    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe(
      `User: arn:aws:iam::${accountId}:user/reader is not authorized to perform: sqs:SendMessage on resource: arn:aws:sqs:us-east-1:${accountId}:orders because no identity-based policy allows the sqs:SendMessage action`,
    );
  });

  it("a queue policy grants another account access; without it, cross-account calls are denied", async () => {
    const url = await createQueue("shared");
    const other = t.client();
    const otherId = ok(await other.signUp({ email: "other@example.com", accountName: "other" }))
      .session.accountId;

    const denied = await sqs(other, "SendMessage", { QueueUrl: url, MessageBody: "hi" });
    expect(denied.status).toBe(403);
    expect(denied.body.evaluation.reason).toMatch(/another account/);

    ok(
      await sqs(root, "SetQueueAttributes", {
        QueueUrl: url,
        Attributes: {
          Policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: { AWS: `arn:aws:iam::${otherId}:root` },
                Action: "sqs:SendMessage",
                Resource: `arn:aws:sqs:us-east-1:${accountId}:shared`,
              },
            ],
          }),
        },
      }),
    );
    ok(await sqs(other, "SendMessage", { QueueUrl: url, MessageBody: "hi" }));
    expect((await sqs(other, "ReceiveMessage", { QueueUrl: url })).status).toBe(403);
  });

  it("records data events only when asked", async () => {
    const url = await createQueue("q");
    await send(url, "x");
    const mgmt = ok(await root.action("cloudtrail", "LookupEvents")).Events.map(
      (e: { EventName: string }) => e.EventName,
    );
    expect(mgmt).toContain("CreateQueue");
    expect(mgmt).not.toContain("SendMessage");
    const all = ok(
      await root.action("cloudtrail", "LookupEvents", { IncludeDataEvents: true }),
    ).Events;
    expect(all.find((e: { EventName: string }) => e.EventName === "SendMessage")).toMatchObject({
      EventCategory: "Data",
    });
  });
});

describe("simulator", () => {
  it("snapshots every message with its state, including the DLQ", async () => {
    const dlq = await createQueue("dlq");
    const dlqArn = ok(await sqs(root, "GetQueueAttributes", { QueueUrl: dlq })).Attributes.QueueArn;
    const url = await createQueue("q", {
      RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 5 }),
    });
    await send(url, "a");
    await send(url, "b", { DelaySeconds: 30 });
    await send(url, "c");
    await receive(url);
    const snap = ok(await sqs(root, "SimulatorSnapshot", { QueueUrl: url }));
    expect(
      snap.Messages.map((m: { Body: string; State: string }) => `${m.Body}:${m.State}`),
    ).toEqual(["a:inflight", "b:delayed", "c:available"]);
    expect(snap.DeadLetterQueue).toMatchObject({ Name: "dlq", Messages: [] });
  });

  it("streams queue events over Server-Sent Events", async () => {
    const url = await createQueue("live");
    const login = await t.app.request("/api/auth/signin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "root",
        email: "learner@example.com",
        password: "correct-horse",
      }),
    });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const controller = new AbortController();
    const res = await t.app.request(`/api/x/sqs/stream?queueUrl=${encodeURIComponent(url)}`, {
      headers: { cookie },
      signal: controller.signal,
    });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await readUntil("event: hello");
    await send(url, "streamed!");
    await readUntil("streamed!");
    expect(text).toMatch(/event: sent/);
    controller.abort();
    await reader.cancel().catch(() => {});
  });

  it("the stream requires permission to read the queue", async () => {
    const url = await createQueue("live");
    ok(await root.action("iam", "CreateUser", { UserName: "nobody" }));
    ok(
      await root.action("iam", "CreateLoginProfile", {
        UserName: "nobody",
        Password: "nobody-pass-1",
      }),
    );
    const nobody = t.client();
    ok(await nobody.signInIam(accountId, "nobody", "nobody-pass-1"));
    const res = await nobody.call("GET", `/api/x/sqs/stream?queueUrl=${encodeURIComponent(url)}`);
    expect(res.status).toBe(403);
  });
});
