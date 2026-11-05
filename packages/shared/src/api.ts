import type { Decision, EvaluationSummary } from "./errors";
import type { SessionInfo } from "./session";

// Response shapes shared by the server and the web app.

export type SessionResponse = { signedIn: false } | { signedIn: true; session: SessionInfo };

export interface GetCallerIdentityOutput {
  UserId: string;
  Account: string;
  Arn: string;
}

export interface TrailEvent {
  EventId: string;
  EventName: string;
  EventTime: string;
  EventSource: string;
  Username: string | null;
  Resources: { ResourceName: string }[];
  // CloudLearn additions:
  IamAction: string;
  PrincipalArn: string | null;
  Decision: Decision;
  ErrorCode: string | null;
  ErrorMessage: string | null;
  Request: unknown;
  Evaluation: EvaluationSummary | null;
}

export interface LookupEventsOutput {
  Events: TrailEvent[];
  NextToken?: string;
}
