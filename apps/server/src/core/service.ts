import type { z } from "zod";
import type { Authorizer } from "./authorize";
import type { Clock } from "./clock";
import type { Db, Migration } from "./db";
import type { Session } from "./sessions";

/** Shared dependencies every handler can use. Passed in, never imported, so tests can swap them. */
export interface CoreDeps {
  db: Db;
  clock: Clock;
  authorizer: Authorizer;
  services: ServiceModule[];
}

export interface RequestContext {
  session: Session;
  deps: CoreDeps;
}

/**
 * One API action, such as SendMessage. The pipeline in pipeline.ts runs these steps in order:
 * validate `input`, resolve `resource`, authorize `iamAction`, record an event, call `handler`.
 * A handler can't run without going through authorization first.
 */
export interface ActionDef<S extends z.ZodType = z.ZodType, O = unknown> {
  /** The AWS API name, e.g. "SendMessage". Used in the URL: /api/services/sqs/SendMessage */
  name: string;
  /** The IAM action checked against policies, e.g. "sqs:SendMessage". */
  iamAction: string;
  input: S;
  /** "none" for the few actions AWS allows without any permissions, like sts:GetCallerIdentity. */
  authorization?: "required" | "none";
  /** Set to false for read-only console plumbing that would flood the activity log. */
  record?: boolean;
  /** The ARN this call targets. Defaults to "*". */
  resource?(input: z.output<S>, ctx: RequestContext): string;
  handler(input: z.output<S>, ctx: RequestContext): O | Promise<O>;
}

export type AnyActionDef = ActionDef<z.ZodType, unknown>;

export interface ServiceModule {
  /** Lowercase AWS service prefix, e.g. "sqs". Used in URLs and IAM actions. */
  id: string;
  name: string;
  /** CloudTrail-style event source. Defaults to `${id}.amazonaws.com`. */
  eventSource?: string;
  /** Error code for invalid input. IAM uses ValidationError; SQS uses InvalidParameterValue. */
  validationErrorCode?: string;
  migrations?: Migration[];
  actions: AnyActionDef[];
}

export const defineAction = <S extends z.ZodType, O>(def: ActionDef<S, O>): ActionDef<S, O> => def;
export const defineService = (service: ServiceModule): ServiceModule => service;
