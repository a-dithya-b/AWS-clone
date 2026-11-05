import type { AccessLevel, ContextValue, PolicySource } from "@cloudlearn/iam-engine";
import type { z } from "zod";
import type { Authorizer } from "./authorize";
import type { Clock } from "./clock";
import type { Db, Migration } from "./db";
import type { EventBus } from "./event-bus";
import type { Session } from "./sessions";

/** Shared dependencies every handler can use. Passed in, never imported, so tests can swap them. */
export interface CoreDeps {
  db: Db;
  clock: Clock;
  authorizer: Authorizer;
  services: ServiceModule[];
  /** In-process events (e.g. "a message moved"), used by live views such as the SQS simulator. */
  bus: EventBus;
  /** Folder for files services store outside SQLite (e.g. S3 object bodies). */
  dataDir: string;
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
  /** Access level shown in policy summaries, as in the AWS Service Authorization Reference. */
  accessLevel: AccessLevel;
  input: S;
  /** "none" for the few actions AWS allows without any permissions, like sts:GetCallerIdentity. */
  authorization?: "required" | "none";
  /** Set to false for read-only console plumbing that would flood the activity log. */
  record?: boolean;
  /** The ARN this call targets. Defaults to "*". */
  resource?(input: z.output<S>, ctx: RequestContext): string;
  /** Resource-based policies that also apply, e.g. an S3 bucket policy. */
  resourcePolicies?(input: z.output<S>, ctx: RequestContext): PolicySource[];
  /** Service-specific condition keys, e.g. { "s3:prefix": "photos/" }. */
  conditionKeys?(input: z.output<S>, ctx: RequestContext): Record<string, ContextValue>;
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
  /** Runs at startup after migrations, e.g. to insert AWS-managed policies. Must be idempotent. */
  seed?(deps: CoreDeps): void;
  /** Starts background work (e.g. timers). Returns a function that stops it. */
  start?(deps: CoreDeps): () => void;
  /** Deletes everything this service stores for an account ("Reset my account"). */
  resetAccount?(deps: CoreDeps, accountId: string): void;
  actions: AnyActionDef[];
}

export const defineAction = <S extends z.ZodType, O>(def: ActionDef<S, O>): ActionDef<S, O> => def;
export const defineService = (service: ServiceModule): ServiceModule => service;
