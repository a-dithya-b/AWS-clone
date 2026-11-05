import { describe, expect, it } from "vitest";
import { summarizePolicy } from "./summarize";
import type { ActionCatalogEntry } from "./types";

const sqs = (
  action: string,
  accessLevel: ActionCatalogEntry["accessLevel"],
): ActionCatalogEntry => ({
  action: `sqs:${action}`,
  service: "sqs",
  serviceName: "Simple Queue Service",
  accessLevel,
});
const iam = (
  action: string,
  accessLevel: ActionCatalogEntry["accessLevel"],
): ActionCatalogEntry => ({
  action: `iam:${action}`,
  service: "iam",
  serviceName: "Identity and Access Management",
  accessLevel,
});

const catalog: ActionCatalogEntry[] = [
  sqs("ListQueues", "List"),
  sqs("GetQueueAttributes", "Read"),
  sqs("SendMessage", "Write"),
  sqs("DeleteQueue", "Write"),
  sqs("TagQueue", "Tagging"),
  iam("ListUsers", "List"),
  iam("GetUser", "Read"),
  iam("CreateUser", "Write"),
  iam("AttachUserPolicy", "Permissions management"),
];

describe("summarizePolicy", () => {
  it("reports full access", () => {
    const s = summarizePolicy(
      { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: "sqs:*", Resource: "*" }] },
      catalog,
    );
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({
      service: "sqs",
      effect: "Allow",
      access: "Full access",
      resources: ["*"],
      hasConditions: false,
    });
    expect(s.entries[0]?.levels).toEqual([
      { level: "List", actions: ["sqs:ListQueues"], total: 1 },
      { level: "Read", actions: ["sqs:GetQueueAttributes"], total: 1 },
      { level: "Write", actions: ["sqs:SendMessage", "sqs:DeleteQueue"], total: 2 },
      { level: "Tagging", actions: ["sqs:TagQueue"], total: 1 },
    ]);
  });

  it("reports limited access grouped by level", () => {
    const s = summarizePolicy(
      {
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Action: ["iam:Get*", "iam:List*"], Resource: "*" }],
      },
      catalog,
    );
    expect(s.entries[0]).toMatchObject({ service: "iam", access: "Limited" });
    expect(s.entries[0]?.levels.map((l) => l.level)).toEqual(["List", "Read"]);
  });

  it("handles NotAction (PowerUserAccess-style)", () => {
    const s = summarizePolicy(
      {
        Version: "2012-10-17",
        Statement: [
          { Effect: "Allow", NotAction: ["iam:*", "organizations:*", "account:*"], Resource: "*" },
        ],
      },
      catalog,
    );
    expect(s.entries.map((e) => [e.service, e.access])).toEqual([["sqs", "Full access"]]);
    // NotAction entries don't count as "unsupported services".
    expect(s.unsupportedServices).toEqual([]);
  });

  it("separates Allow and Deny, with Allow first, ordered by service name", () => {
    const s = summarizePolicy(
      {
        Version: "2012-10-17",
        Statement: [
          { Effect: "Deny", Action: "sqs:DeleteQueue", Resource: "arn:aws:sqs:*:*:prod-*" },
          {
            Effect: "Allow",
            Action: "*",
            Resource: "*",
            Condition: { Bool: { "aws:SecureTransport": "true" } },
          },
        ],
      },
      catalog,
    );
    expect(s.entries.map((e) => [e.service, e.effect, e.access])).toEqual([
      ["iam", "Allow", "Full access"],
      ["sqs", "Allow", "Full access"],
      ["sqs", "Deny", "Limited"],
    ]);
    expect(s.entries[0]?.hasConditions).toBe(true);
    expect(s.entries[2]?.resources).toEqual(["arn:aws:sqs:*:*:prod-*"]);
  });

  it("lists unsupported services and NotResource", () => {
    const s = summarizePolicy(
      {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["ec2:*", "lambda:Invoke*", "sqs:SendMessage"],
            NotResource: "arn:x",
          },
        ],
      },
      catalog,
    );
    expect(s.unsupportedServices).toEqual(["ec2", "lambda"]);
    expect(s.entries[0]?.resources).toEqual(["Not: arn:x"]);
  });

  it("merges resources across statements for the same service", () => {
    const s = summarizePolicy(
      {
        Version: "2012-10-17",
        Statement: [
          { Effect: "Allow", Action: "sqs:SendMessage", Resource: "arn:a" },
          { Effect: "Allow", Action: "sqs:ListQueues", Resource: ["arn:a", "arn:b"] },
        ],
      },
      catalog,
    );
    expect(s.entries[0]?.resources).toEqual(["arn:a", "arn:b"]);
    expect(s.entries[0]?.access).toBe("Limited");
  });
});
