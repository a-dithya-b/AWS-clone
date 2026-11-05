import { accessDeniedMessage } from "@cloudlearn/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../../core/http";
import type { CoreDeps } from "../../core/service";
import { findQueueByArn, findQueueByUrl } from "./queues";

/**
 * GET /api/x/sqs/stream?queueUrl=… — a Server-Sent Events stream of everything that happens to a
 * queue (and its dead-letter queue): sends, receives, deletes, visibility changes, DLQ moves.
 * Watching a queue needs the same permission as GetQueueAttributes.
 */
export function sqsRoutes(deps: CoreDeps) {
  const routes = new Hono<AppEnv>();

  routes.get("/stream", (c) => {
    const session = c.get("session");
    if (!session)
      return c.json({ code: "MissingAuthenticationToken", message: "You are not signed in." }, 401);
    const queue = findQueueByUrl(deps.db, c.req.query("queueUrl") ?? "");
    if (!queue)
      return c.json(
        { code: "QueueDoesNotExist", message: "The specified queue does not exist." },
        400,
      );

    const policies = queue.policy
      ? [
          {
            id: `${queue.arn}/policy`,
            name: `${queue.name} queue policy`,
            type: "resource-based" as const,
            document: queue.policy,
          },
        ]
      : [];
    const evaluation = deps.authorizer.authorize({
      session,
      action: "sqs:GetQueueAttributes",
      resource: queue.arn,
      resourcePolicies: policies,
    });
    if (evaluation.decision !== "Allow") {
      return c.json(
        {
          code: "AccessDenied",
          message: accessDeniedMessage({
            principalArn: session.principal.arn,
            action: "sqs:GetQueueAttributes",
            resource: queue.arn,
            decision: evaluation.decision,
          }),
          evaluation,
        },
        403,
      );
    }

    const topics = [queue.arn];
    const dlq = queue.redrivePolicy
      ? findQueueByArn(deps.db, queue.redrivePolicy.deadLetterTargetArn)
      : undefined;
    if (dlq) topics.push(dlq.arn);

    return streamSSE(c, async (stream) => {
      const unsubscribes = topics.map((topic) =>
        deps.bus.subscribe(topic, (event) => {
          void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        }),
      );
      await stream.writeSSE({
        event: "hello",
        data: JSON.stringify({ serverTime: deps.clock.now().getTime(), topics }),
      });
      // Keep the connection alive through proxies and let the browser notice drops.
      const heartbeat = setInterval(() => {
        void stream.writeSSE({ event: "ping", data: String(deps.clock.now().getTime()) });
      }, 15_000);
      await new Promise<void>((resolve) => stream.onAbort(resolve));
      clearInterval(heartbeat);
      for (const unsubscribe of unsubscribes) unsubscribe();
    });
  });

  return routes;
}
