import { accessDeniedMessage, type EvaluationSummary } from "@cloudlearn/shared";
import { Hono } from "hono";
import { AwsError } from "./errors";
import { recordEvent } from "./events";
import { type AppEnv, parseInput, readJsonBody } from "./http";
import type { AnyActionDef, CoreDeps, RequestContext, ServiceModule } from "./service";

/**
 * Generates POST /:service/:action routes from the service registry. Every action call goes through
 * the same steps: session → validate → resolve resource → authorize → record → handler.
 */
export function serviceRoutes(deps: CoreDeps) {
  const index = new Map<string, { service: ServiceModule; actions: Map<string, AnyActionDef> }>();
  for (const service of deps.services) {
    if (index.has(service.id)) throw new Error(`Duplicate service id: ${service.id}`);
    index.set(service.id, {
      service,
      actions: new Map(service.actions.map((a) => [a.name, a])),
    });
  }

  const routes = new Hono<AppEnv>();

  routes.post("/:service/:action", async (c) => {
    const entry = index.get(c.req.param("service"));
    const action = entry?.actions.get(c.req.param("action"));
    if (!entry || !action) {
      throw new AwsError(
        "InvalidAction",
        `The action ${c.req.param("action")} is not valid for this endpoint.`,
        404,
      );
    }
    const { service } = entry;

    const session = c.get("session");
    if (!session) {
      throw new AwsError(
        "MissingAuthenticationToken",
        "You are not signed in. Sign in and try again.",
        401,
      );
    }

    const raw = await readJsonBody(c);
    const ctx: RequestContext = { session, deps };
    const time = deps.clock.now();

    const record = (fields: {
      resourceArn: string | null;
      evaluation: EvaluationSummary;
      error?: AwsError;
    }) => {
      if (action.record === false) return;
      recordEvent(deps.db, {
        accountId: session.accountId,
        time,
        eventSource: service.eventSource ?? `${service.id}.amazonaws.com`,
        eventName: action.name,
        iamAction: action.iamAction,
        principalArn: session.principal.arn,
        principalType: session.principal.type,
        resourceArn: fields.resourceArn,
        decision: fields.evaluation.decision,
        errorCode: fields.error?.code ?? null,
        errorMessage: fields.error?.message ?? null,
        request: raw,
        evaluation: fields.evaluation,
      });
    };

    // 1. Validate. Invalid requests are still recorded, like CloudTrail does.
    let input: unknown;
    try {
      input = parseInput(action.input, raw, service.validationErrorCode);
    } catch (err) {
      if (err instanceof AwsError) {
        record({
          resourceArn: null,
          evaluation: {
            decision: "ImplicitDeny",
            reason: "The request was invalid, so it was not evaluated.",
            matchedStatements: [],
          },
          error: err,
        });
      }
      throw err;
    }

    // 2. Resolve the target resource and authorize.
    const resource = action.resource ? action.resource(input, ctx) : "*";
    const evaluation: EvaluationSummary =
      action.authorization === "none"
        ? {
            decision: "Allow",
            reason: `${action.iamAction} doesn't need any permissions. Every signed-in principal can call it.`,
            matchedStatements: [],
          }
        : deps.authorizer.authorize({ session, action: action.iamAction, resource });

    if (evaluation.decision !== "Allow") {
      const err = new AwsError(
        "AccessDenied",
        accessDeniedMessage({
          principalArn: session.principal.arn,
          action: action.iamAction,
          resource,
          decision: evaluation.decision,
        }),
        403,
        evaluation,
      );
      record({ resourceArn: resource, evaluation, error: err });
      throw err;
    }

    // 3. Run the handler.
    try {
      const result = await action.handler(input, ctx);
      record({ resourceArn: resource, evaluation });
      return c.json(result ?? {});
    } catch (err) {
      record({
        resourceArn: resource,
        evaluation,
        error:
          err instanceof AwsError ? err : new AwsError("InternalFailure", "Internal error", 500),
      });
      throw err;
    }
  });

  return routes;
}
