import { type LookupEventsOutput, parseArn } from "@cloudlearn/shared";
import { z } from "zod";
import { lookupEvents } from "../../core/events";
import { defineAction, defineService } from "../../core/service";

/**
 * A mini CloudTrail over the API event log. Real CloudTrail's LookupEvents returns similar fields;
 * Decision and Evaluation are CloudLearn additions that explain each IAM decision.
 */
export const cloudtrailService = defineService({
  id: "cloudtrail",
  name: "CloudTrail",
  actions: [
    defineAction({
      name: "LookupEvents",
      iamAction: "cloudtrail:LookupEvents",
      accessLevel: "Read",
      // The console polls this. Logging every lookup would bury the events learners care about.
      record: false,
      input: z.object({
        MaxResults: z.number().int().min(1).max(50).default(50),
        NextToken: z.string().regex(/^\d+$/, "NextToken is not valid.").optional(),
        // Like CloudTrail, at most one lookup attribute.
        LookupAttributes: z
          .array(
            z.object({
              AttributeKey: z.enum(["EventName", "EventSource", "Username", "ResourceName"]),
              AttributeValue: z.string().min(1),
            }),
          )
          .max(1, "LookupAttributes accepts at most one attribute.")
          .default([]),
        /** CloudLearn addition: also return data events such as SendMessage. */
        IncludeDataEvents: z.boolean().default(false),
      }),
      handler: (input, { session, deps }): LookupEventsOutput => {
        const attr = input.LookupAttributes[0];
        const events = lookupEvents(deps.db, session.accountId, {
          limit: input.MaxResults + 1,
          beforeId: input.NextToken ? Number(input.NextToken) : undefined,
          includeDataEvents: input.IncludeDataEvents,
          eventName: attr?.AttributeKey === "EventName" ? attr.AttributeValue : undefined,
          eventSource: attr?.AttributeKey === "EventSource" ? attr.AttributeValue : undefined,
          username: attr?.AttributeKey === "Username" ? attr.AttributeValue : undefined,
          resourceName: attr?.AttributeKey === "ResourceName" ? attr.AttributeValue : undefined,
        });
        const page = events.slice(0, input.MaxResults);
        const hasMore = events.length > input.MaxResults;
        return {
          Events: page.map((e) => ({
            EventId: e.eventId,
            EventName: e.eventName,
            EventTime: e.eventTime,
            EventSource: e.eventSource,
            Username: usernameFromArn(e.principalArn),
            Resources:
              e.resourceArn && e.resourceArn !== "*" ? [{ ResourceName: e.resourceArn }] : [],
            EventCategory: e.category,
            IamAction: e.iamAction,
            PrincipalArn: e.principalArn,
            Decision: e.decision,
            ErrorCode: e.errorCode,
            ErrorMessage: e.errorMessage,
            Request: e.request,
            Evaluation: e.evaluation,
          })),
          ...(hasMore && page.length ? { NextToken: String(page[page.length - 1]?.id) } : {}),
        };
      },
    }),
  ],
});

/** CloudTrail shows "root" for the root user and the user or role name otherwise. */
function usernameFromArn(arn: string | null): string | null {
  if (!arn) return null;
  const resource = parseArn(arn)?.resource ?? "";
  if (resource === "root") return "root";
  return resource.split("/").pop() ?? null;
}
