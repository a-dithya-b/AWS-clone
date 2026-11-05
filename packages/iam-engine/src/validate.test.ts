import { describe, expect, it } from "vitest";
import type { ActionCatalogEntry, PolicyKind } from "./types";
import { parsePolicyJson, validatePolicy } from "./validate";

const catalog: ActionCatalogEntry[] = [
  {
    action: "sqs:SendMessage",
    service: "sqs",
    serviceName: "Simple Queue Service",
    accessLevel: "Write",
  },
  {
    action: "sqs:ListQueues",
    service: "sqs",
    serviceName: "Simple Queue Service",
    accessLevel: "List",
  },
  {
    action: "cloudtrail:LookupEvents",
    service: "cloudtrail",
    serviceName: "CloudTrail",
    accessLevel: "Read",
  },
];

const identity = (statement: unknown, extra: Record<string, unknown> = {}) => ({
  Version: "2012-10-17",
  Statement: statement,
  ...extra,
});

const ok = { Effect: "Allow", Action: "sqs:SendMessage", Resource: "*" };

const errors = (input: unknown, kind: PolicyKind = "identity") =>
  validatePolicy(input, { kind }).issues.filter((i) => i.severity === "error");

describe("parsePolicyJson", () => {
  it("parses valid JSON", () => {
    expect(parsePolicyJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("reports syntax errors with a line and column", () => {
    const r = parsePolicyJson('{\n  "Version": "2012-10-17",\n  "Statement": [}\n}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/^This policy contains a syntax error: /);
      expect(r.message).toMatch(/\(line 3, column \d+\)$/);
    }
  });

  it("reports an empty policy", () => {
    expect(parsePolicyJson("  ")).toEqual({
      ok: false,
      message: "This policy contains a syntax error: the policy is empty.",
    });
  });
});

describe("validatePolicy: documents", () => {
  it("accepts a valid policy and returns the document", () => {
    const doc = identity([ok]);
    const r = validatePolicy(JSON.stringify(doc), { kind: "identity" });
    expect(r).toEqual({ valid: true, issues: [], document: doc });
  });

  it("accepts a single statement object", () => {
    expect(validatePolicy(identity(ok), { kind: "identity" }).valid).toBe(true);
  });

  it("reports invalid JSON", () => {
    const r = validatePolicy("{nope", { kind: "identity" });
    expect(r.valid).toBe(false);
    expect(r.document).toBeUndefined();
    expect(r.issues[0]?.message).toMatch(/^This policy contains a syntax error/);
  });

  it.each<[string, unknown, string, string]>([
    ["not an object", [], "Syntax errors in policy.", ""],
    ["null", null, "Syntax errors in policy.", ""],
    ["missing Statement", { Version: "2012-10-17" }, "Syntax errors in policy.", "Statement"],
    ["unknown top-level key", { ...identity([ok]), Foo: 1 }, "Syntax errors in policy.", "Foo"],
    [
      "bad Version",
      identity([ok], { Version: "2020-01-01" }),
      "The policy failed legacy parsing",
      "Version",
    ],
    ["Statement not object/array", identity("x"), "Syntax errors in policy.", "Statement"],
    ["empty Statement array", identity([]), "Syntax errors in policy.", "Statement"],
    ["Id not string", identity([ok], { Id: 3 }), "Syntax errors in policy.", "Id"],
  ])("%s", (_name, input, message, path) => {
    expect(errors(input)).toContainEqual({ severity: "error", message, path });
  });

  it("warns when Version is missing, but stays valid", () => {
    const r = validatePolicy({ Statement: [ok] }, { kind: "identity" });
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([
      {
        severity: "warning",
        message:
          'Add a Version of "2012-10-17". Without it, policy variables like ${aws:username} won\'t work.',
        path: "Version",
      },
    ]);
  });

  it("accepts the legacy 2008-10-17 version", () => {
    expect(
      validatePolicy(identity([ok], { Version: "2008-10-17" }), { kind: "identity" }).valid,
    ).toBe(true);
  });
});

describe("validatePolicy: statements", () => {
  it.each<[string, Record<string, unknown>, string, string]>([
    ["unknown statement key", { ...ok, Foo: 1 }, "Syntax errors in policy.", "Statement[0].Foo"],
    [
      "missing Effect",
      { Action: "sqs:*", Resource: "*" },
      "Missing required field Effect",
      "Statement[0].Effect",
    ],
    ["invalid Effect", { ...ok, Effect: "allow" }, "Invalid effect: allow", "Statement[0].Effect"],
    [
      "no actions",
      { Effect: "Allow", Resource: "*" },
      "Policy statement must contain actions.",
      "Statement[0]",
    ],
    [
      "both Action and NotAction",
      { ...ok, NotAction: "iam:*" },
      "Statement cannot contain both Action and NotAction.",
      "Statement[0]",
    ],
    [
      "action without vendor",
      { ...ok, Action: "SendMessage" },
      "Actions/Conditions must be prefaced by a vendor, e.g., iam, sdb, ec2, etc.",
      "Statement[0].Action",
    ],
    [
      "action with a space",
      { ...ok, Action: ["sqs:*", "sqs: Send"] },
      "Actions/Conditions must be prefaced by a vendor, e.g., iam, sdb, ec2, etc.",
      "Statement[0].Action[1]",
    ],
    ["Action wrong type", { ...ok, Action: 5 }, "Syntax errors in policy.", "Statement[0].Action"],
    [
      "Action empty array",
      { ...ok, Action: [] },
      "Syntax errors in policy.",
      "Statement[0].Action",
    ],
    [
      "Principal in identity policy",
      { ...ok, Principal: "*" },
      "Policy document should not specify a principal.",
      "Statement[0].Principal",
    ],
    [
      "NotPrincipal in identity policy",
      { ...ok, NotPrincipal: "*" },
      "Policy document should not specify a principal.",
      "Statement[0].NotPrincipal",
    ],
    [
      "no resources",
      { Effect: "Allow", Action: "sqs:*" },
      "Policy statement must contain resources.",
      "Statement[0]",
    ],
    [
      "both Resource and NotResource",
      { ...ok, NotResource: "*" },
      "Statement cannot contain both Resource and NotResource.",
      "Statement[0]",
    ],
    [
      "resource not an ARN",
      { ...ok, Resource: "my-queue" },
      'Resource my-queue must be in ARN format or "*".',
      "Statement[0].Resource",
    ],
    [
      "bad Sid characters",
      { ...ok, Sid: "my-sid" },
      "Statement IDs (SID) must be alpha-numeric. Check that your input satisfies the regular expression [0-9A-Za-z]*",
      "Statement[0].Sid",
    ],
    [
      "unknown condition operator",
      { ...ok, Condition: { StringEqual: { "aws:username": "a" } } },
      "Invalid Condition type : StringEqual",
      "Statement[0].Condition.StringEqual",
    ],
    [
      "condition key without vendor",
      { ...ok, Condition: { StringEquals: { username: "a" } } },
      "Actions/Conditions must be prefaced by a vendor, e.g., iam, sdb, ec2, etc.",
      "Statement[0].Condition.StringEquals.username",
    ],
    [
      "condition not an object",
      { ...ok, Condition: "x" },
      "Syntax errors in policy.",
      "Statement[0].Condition",
    ],
    [
      "condition operator not an object",
      { ...ok, Condition: { StringEquals: "x" } },
      "Syntax errors in policy.",
      "Statement[0].Condition.StringEquals",
    ],
    [
      "condition value an object",
      { ...ok, Condition: { StringEquals: { "aws:username": { a: 1 } } } },
      "Syntax errors in policy.",
      "Statement[0].Condition.StringEquals.aws:username",
    ],
  ])("%s", (_name, statement, message, path) => {
    expect(errors(identity([statement]))).toContainEqual({ severity: "error", message, path });
  });

  it("uses a plain path for a single statement object", () => {
    expect(errors(identity({ ...ok, Effect: "Nope" }))).toContainEqual({
      severity: "error",
      message: "Invalid effect: Nope",
      path: "Statement.Effect",
    });
  });

  it("rejects duplicate Sids", () => {
    expect(
      errors(
        identity([
          { ...ok, Sid: "A" },
          { ...ok, Sid: "A" },
        ]),
      ),
    ).toContainEqual({
      severity: "error",
      message: "Statement IDs (SID) in a single policy must be unique.",
      path: "Statement[1].Sid",
    });
  });

  it("accepts wildcards, NotAction/NotResource and conditions", () => {
    const st = {
      Sid: "PowerUser1",
      Effect: "Allow",
      NotAction: ["iam:*", "organizations:*"],
      NotResource: "arn:aws:s3:::secret/*",
      Condition: {
        "ForAnyValue:StringLikeIfExists": { "aws:TagKeys": ["a*"] },
        Bool: { "aws:SecureTransport": true },
      },
    };
    expect(errors(identity([st]))).toEqual([]);
  });
});

describe("validatePolicy: resource and trust policies", () => {
  const trust = (st: Record<string, unknown>) =>
    identity([{ Effect: "Allow", Action: "sts:AssumeRole", ...st }]);

  it("accepts a normal trust policy", () => {
    expect(
      errors(trust({ Principal: { AWS: "arn:aws:iam::123456789012:root" } }), "trust"),
    ).toEqual([]);
  });

  it.each<[string, Record<string, unknown>, string, string]>([
    ["missing principal", {}, "AssumeRolePolicy policy must specify a principal.", "Statement[0]"],
    [
      "Resource present",
      { Principal: "*", Resource: "*" },
      "Has prohibited field Resource",
      "Statement[0].Resource",
    ],
    [
      "bad principal shape",
      { Principal: { Bogus: "x" } },
      "Syntax errors in policy.",
      "Statement[0].Principal",
    ],
    [
      "principal not * string",
      { Principal: "everyone" },
      "Syntax errors in policy.",
      "Statement[0].Principal",
    ],
    [
      "both Principal and NotPrincipal",
      { Principal: "*", NotPrincipal: "*" },
      "Statement cannot contain both Principal and NotPrincipal.",
      "Statement[0]",
    ],
  ])("trust: %s", (_name, st, message, path) => {
    expect(errors(trust(st), "trust")).toContainEqual({ severity: "error", message, path });
  });

  it("resource policies need a principal and a resource", () => {
    const e = errors(identity([{ Effect: "Allow", Action: "s3:GetObject" }]), "resource");
    expect(e).toContainEqual({
      severity: "error",
      message: "Policy document must specify a principal.",
      path: "Statement[0]",
    });
    expect(e).toContainEqual({
      severity: "error",
      message: "Policy statement must contain resources.",
      path: "Statement[0]",
    });
  });

  it("accepts a valid bucket policy", () => {
    const doc = identity([
      {
        Effect: "Allow",
        Principal: { AWS: ["123456789012"] },
        Action: "s3:GetObject",
        Resource: "arn:aws:s3:::b/*",
      },
    ]);
    expect(errors(doc, "resource")).toEqual([]);
  });
});

describe("validatePolicy: catalog warnings", () => {
  const warnings = (actions: string[]) =>
    validatePolicy(identity([{ Effect: "Allow", Action: actions, Resource: "*" }]), {
      kind: "identity",
      catalog,
    }).issues;

  it("warns about services CloudLearn doesn't simulate", () => {
    expect(warnings(["ec2:RunInstances"])).toEqual([
      {
        severity: "warning",
        message:
          'CloudLearn doesn\'t simulate the "ec2" service, so this action has no effect here.',
        path: "Statement[0].Action[0]",
      },
    ]);
  });

  it("warns about misspelled actions in simulated services", () => {
    expect(warnings(["sqs:SendMesage", "cloudtrail:Nope"])).toEqual([
      {
        severity: "warning",
        message: '"sqs:SendMesage" doesn\'t match any SQS action. Check the spelling.',
        path: "Statement[0].Action[0]",
      },
      {
        severity: "warning",
        message: '"cloudtrail:Nope" doesn\'t match any CloudTrail action. Check the spelling.',
        path: "Statement[0].Action[1]",
      },
    ]);
  });

  it("doesn't warn for valid patterns, any case", () => {
    expect(warnings(["sqs:*", "SQS:sendmessage", "sqs:List*", "*"])).toEqual([]);
  });

  it("warnings don't make the policy invalid", () => {
    const r = validatePolicy(identity([{ Effect: "Allow", Action: "ec2:*", Resource: "*" }]), {
      kind: "identity",
      catalog,
    });
    expect(r.valid).toBe(true);
  });
});
