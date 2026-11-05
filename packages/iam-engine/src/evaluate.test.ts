import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluate";
import { evaluateTrustPolicy } from "./trust";
import type { EvalRequest, PolicyDocument, PolicySource } from "./types";

const ACCT = "123456789012";
const ALICE = `arn:aws:iam::${ACCT}:user/alice`;
const QUEUE = `arn:aws:sqs:us-east-1:${ACCT}:orders`;

const policy = (
  name: string,
  document: PolicyDocument,
  extra: Partial<PolicySource> = {},
): PolicySource => ({
  id: `arn:aws:iam::${ACCT}:policy/${name}`,
  name,
  type: "customer-managed",
  attachedVia: "user/alice",
  document,
  ...extra,
});

const req = (action: string, resource: string, extra: Partial<EvalRequest> = {}): EvalRequest => ({
  principalArn: ALICE,
  principalAccount: ACCT,
  action,
  resource,
  context: { "aws:username": "alice" },
  ...extra,
});

const allowAll = policy(
  "AdministratorAccess",
  {
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Action: "*", Resource: "*" }],
  },
  { id: "arn:aws:iam::aws:policy/AdministratorAccess", type: "aws-managed" },
);

const sqsFull = policy(
  "AmazonSQSFullAccess",
  {
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Action: ["sqs:*"], Resource: "*" }],
  },
  { type: "aws-managed" },
);

const denySqs = policy(
  "NoSqs",
  {
    Version: "2012-10-17",
    Statement: { Sid: "DenyQueues", Effect: "Deny", Action: "sqs:*", Resource: "*" },
  },
  { attachedVia: "group/devs" },
);

describe("evaluate: the basics", () => {
  it("denies by default when nothing is attached", () => {
    const r = evaluate({ identityPolicies: [], request: req("sqs:SendMessage", QUEUE) });
    expect(r.decision).toBe("ImplicitDeny");
    expect(r.matchedStatements).toEqual([]);
    expect(r.reason).toBe(
      "No policies are attached to this identity, so every action is denied by default.",
    );
  });

  it("allows when a statement matches and explains which policy", () => {
    const r = evaluate({ identityPolicies: [sqsFull], request: req("sqs:SendMessage", QUEUE) });
    expect(r.decision).toBe("Allow");
    expect(r.reason).toBe('Allowed by policy "AmazonSQSFullAccess" (attached via user/alice).');
    expect(r.matchedStatements).toHaveLength(1);
    expect(r.matchedStatements[0]).toMatchObject({
      policyName: "AmazonSQSFullAccess",
      effect: "Allow",
      statementIndex: 0,
    });
  });

  it("implicitly denies when policies exist but none match", () => {
    const r = evaluate({ identityPolicies: [sqsFull], request: req("iam:ListUsers", "*") });
    expect(r.decision).toBe("ImplicitDeny");
    expect(r.reason).toBe(
      "None of the 1 policy that apply to this identity allow iam:ListUsers on *. Everything is denied unless a policy allows it.",
    );
    expect(r.policiesEvaluated).toEqual([
      {
        id: sqsFull.id,
        name: "AmazonSQSFullAccess",
        type: "aws-managed",
        attachedVia: "user/alice",
      },
    ]);
  });

  it("an explicit Deny beats an Allow from another policy", () => {
    const r = evaluate({
      identityPolicies: [allowAll, denySqs],
      request: req("sqs:SendMessage", QUEUE),
    });
    expect(r.decision).toBe("ExplicitDeny");
    expect(r.matchedStatements.map((m) => m.sid)).toEqual(["DenyQueues"]);
    expect(r.reason).toBe(
      'Denied explicitly by statement "DenyQueues" in policy "NoSqs" (attached via group/devs). An explicit Deny always wins, even over an Allow.',
    );
  });

  it("matches actions case-insensitively and resources case-sensitively", () => {
    const p = policy("p", {
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Action: "SQS:sendmessage", Resource: QUEUE }],
    });
    expect(
      evaluate({ identityPolicies: [p], request: req("sqs:SendMessage", QUEUE) }).decision,
    ).toBe("Allow");
    expect(
      evaluate({ identityPolicies: [p], request: req("sqs:SendMessage", QUEUE.toUpperCase()) })
        .decision,
    ).toBe("ImplicitDeny");
  });

  it("an identity statement with no Resource never applies", () => {
    const p = policy("p", { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: "*" }] });
    expect(
      evaluate({ identityPolicies: [p], request: req("sqs:SendMessage", QUEUE) }).decision,
    ).toBe("ImplicitDeny");
  });

  it("collects every matching Allow", () => {
    const r = evaluate({
      identityPolicies: [allowAll, sqsFull],
      request: req("sqs:SendMessage", QUEUE),
    });
    expect(r.matchedStatements).toHaveLength(2);
    expect(r.reason).toMatch(/1 other statement also allows it\.$/);
  });

  it("names inline policies in the reason", () => {
    const p = policy(
      "Inline1",
      { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: "sqs:*", Resource: "*" }] },
      { type: "inline" },
    );
    expect(evaluate({ identityPolicies: [p], request: req("sqs:ListQueues", "*") }).reason).toBe(
      'Allowed by inline policy "Inline1" (attached via user/alice).',
    );
  });
});

describe("evaluate: NotAction and NotResource", () => {
  // PowerUserAccess-style: everything except IAM, Organizations and Account management.
  const powerUser = policy(
    "PowerUserAccess",
    {
      Version: "2012-10-17",
      Statement: [
        { Effect: "Allow", NotAction: ["iam:*", "organizations:*", "account:*"], Resource: "*" },
      ],
    },
    { type: "aws-managed" },
  );

  it.each([
    ["sqs:SendMessage", "Allow"],
    ["s3:GetObject", "Allow"],
    ["iam:CreateUser", "ImplicitDeny"],
    ["IAM:ListUsers", "ImplicitDeny"],
    ["organizations:ListAccounts", "ImplicitDeny"],
  ])("PowerUserAccess: %s → %s", (action, decision) => {
    expect(evaluate({ identityPolicies: [powerUser], request: req(action, "*") }).decision).toBe(
      decision,
    );
  });

  it("NotResource excludes the listed resources", () => {
    const p = policy("p", {
      Version: "2012-10-17",
      Statement: [
        { Effect: "Allow", Action: "sqs:*", NotResource: `arn:aws:sqs:*:${ACCT}:secret-*` },
      ],
    });
    expect(
      evaluate({ identityPolicies: [p], request: req("sqs:SendMessage", QUEUE) }).decision,
    ).toBe("Allow");
    expect(
      evaluate({
        identityPolicies: [p],
        request: req("sqs:SendMessage", `arn:aws:sqs:us-east-1:${ACCT}:secret-q`),
      }).decision,
    ).toBe("ImplicitDeny");
  });

  it("Deny with NotResource denies everything else", () => {
    const p = policy("p", {
      Version: "2012-10-17",
      Statement: [
        { Effect: "Allow", Action: "*", Resource: "*" },
        { Effect: "Deny", Action: "sqs:DeleteQueue", NotResource: QUEUE },
      ],
    });
    expect(
      evaluate({ identityPolicies: [p], request: req("sqs:DeleteQueue", QUEUE) }).decision,
    ).toBe("Allow");
    expect(
      evaluate({ identityPolicies: [p], request: req("sqs:DeleteQueue", `${QUEUE}-2`) }).decision,
    ).toBe("ExplicitDeny");
  });
});

describe("evaluate: policy variables", () => {
  // IAMUserChangePassword-style statement.
  const changePassword = policy(
    "IAMUserChangePassword",
    {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["iam:ChangePassword"],
          Resource: ["arn:aws:iam::*:user/${aws:username}"],
        },
        { Effect: "Allow", Action: ["iam:GetAccountPasswordPolicy"], Resource: "*" },
      ],
    },
    { type: "aws-managed" },
  );

  it("lets alice change only her own password", () => {
    expect(
      evaluate({ identityPolicies: [changePassword], request: req("iam:ChangePassword", ALICE) })
        .decision,
    ).toBe("Allow");
    expect(
      evaluate({
        identityPolicies: [changePassword],
        request: req("iam:ChangePassword", `arn:aws:iam::${ACCT}:user/bob`),
      }).decision,
    ).toBe("ImplicitDeny");
  });

  it("doesn't match when the variable has no value", () => {
    expect(
      evaluate({
        identityPolicies: [changePassword],
        request: req("iam:ChangePassword", ALICE, { context: {} }),
      }).decision,
    ).toBe("ImplicitDeny");
  });

  it("treats variables literally without Version 2012-10-17", () => {
    const old = policy("old", {
      Version: "2008-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "iam:ChangePassword",
          Resource: "arn:aws:iam::*:user/${aws:username}",
        },
      ],
    });
    expect(
      evaluate({ identityPolicies: [old], request: req("iam:ChangePassword", ALICE) }).decision,
    ).toBe("ImplicitDeny");
    expect(
      evaluate({
        identityPolicies: [old],
        request: req("iam:ChangePassword", `arn:aws:iam::${ACCT}:user/\${aws:username}`),
      }).decision,
    ).toBe("Allow");
  });

  it("${*} is a literal asterisk, not a wildcard", () => {
    const p = policy("p", {
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Action: "s3:GetObject", Resource: "arn:aws:s3:::b/${*}" }],
    });
    expect(
      evaluate({ identityPolicies: [p], request: req("s3:GetObject", "arn:aws:s3:::b/*") })
        .decision,
    ).toBe("Allow");
    expect(
      evaluate({ identityPolicies: [p], request: req("s3:GetObject", "arn:aws:s3:::b/x") })
        .decision,
    ).toBe("ImplicitDeny");
  });
});

describe("evaluate: conditions", () => {
  it("applies the statement only when the condition holds", () => {
    const p = policy("p", {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "sqs:*",
          Resource: "*",
          Condition: { StringEquals: { "aws:username": "bob" } },
        },
      ],
    });
    expect(evaluate({ identityPolicies: [p], request: req("sqs:ListQueues", "*") }).decision).toBe(
      "ImplicitDeny",
    );
  });

  it("a conditional Deny only blocks when it matches", () => {
    const deny = policy("d", {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Deny",
          Action: "*",
          Resource: "*",
          Condition: { Bool: { "aws:SecureTransport": "false" } },
        },
      ],
    });
    const secure = req("sqs:ListQueues", "*", { context: { "aws:SecureTransport": true } });
    const insecure = req("sqs:ListQueues", "*", { context: { "aws:SecureTransport": false } });
    expect(evaluate({ identityPolicies: [allowAll, deny], request: secure }).decision).toBe(
      "Allow",
    );
    expect(evaluate({ identityPolicies: [allowAll, deny], request: insecure }).decision).toBe(
      "ExplicitDeny",
    );
  });
});

describe("evaluate: resource-based policies", () => {
  const bucketPolicy = (principal: PolicyDocument["Statement"] extends never ? never : unknown) =>
    policy(
      "BucketPolicy",
      {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: principal as never,
            Action: "s3:GetObject",
            Resource: "arn:aws:s3:::b/*",
          },
        ],
      },
      { type: "resource-based", attachedVia: undefined },
    );

  const get = (principalArn = ALICE) => req("s3:GetObject", "arn:aws:s3:::b/k", { principalArn });

  it.each<[string, unknown, string, string]>([
    ["Principal *", "*", ALICE, "Allow"],
    ["AWS *", { AWS: "*" }, ALICE, "Allow"],
    ["account ID", { AWS: ACCT }, ALICE, "Allow"],
    ["account root ARN", { AWS: `arn:aws:iam::${ACCT}:root` }, ALICE, "Allow"],
    ["exact user ARN", { AWS: [ALICE] }, ALICE, "Allow"],
    ["other user ARN", { AWS: `arn:aws:iam::${ACCT}:user/bob` }, ALICE, "ImplicitDeny"],
    ["other account", { AWS: "999999999999" }, ALICE, "ImplicitDeny"],
    [
      "role ARN matches assumed-role session",
      { AWS: `arn:aws:iam::${ACCT}:role/Ops` },
      `arn:aws:sts::${ACCT}:assumed-role/Ops/alice`,
      "Allow",
    ],
    [
      "role ARN with path",
      { AWS: `arn:aws:iam::${ACCT}:role/team/Ops` },
      `arn:aws:sts::${ACCT}:assumed-role/Ops/s`,
      "Allow",
    ],
    [
      "different role",
      { AWS: `arn:aws:iam::${ACCT}:role/Other` },
      `arn:aws:sts::${ACCT}:assumed-role/Ops/s`,
      "ImplicitDeny",
    ],
    ["service principal never matches", { Service: "ec2.amazonaws.com" }, ALICE, "ImplicitDeny"],
  ])("%s", (_name, principal, principalArn, decision) => {
    const r = evaluate({
      identityPolicies: [],
      resourcePolicies: [bucketPolicy(principal)],
      request: get(principalArn),
    });
    expect(r.decision).toBe(decision);
  });

  it("NotPrincipal applies to everyone except the named principal", () => {
    const deny = policy(
      "BP",
      {
        Version: "2012-10-17",
        Statement: [
          { Effect: "Deny", NotPrincipal: { AWS: ALICE }, Action: "s3:*", Resource: "*" },
        ],
      },
      { type: "resource-based" },
    );
    expect(
      evaluate({ identityPolicies: [allowAll], resourcePolicies: [deny], request: get() }).decision,
    ).toBe("Allow");
    expect(
      evaluate({
        identityPolicies: [allowAll],
        resourcePolicies: [deny],
        request: get(`arn:aws:iam::${ACCT}:user/bob`),
      }).decision,
    ).toBe("ExplicitDeny");
  });

  it("a resource-policy Deny beats an identity Allow", () => {
    const deny = policy(
      "BP",
      {
        Version: "2012-10-17",
        Statement: [{ Effect: "Deny", Principal: "*", Action: "s3:GetObject", Resource: "*" }],
      },
      { type: "resource-based" },
    );
    const r = evaluate({ identityPolicies: [allowAll], resourcePolicies: [deny], request: get() });
    expect(r.decision).toBe("ExplicitDeny");
    expect(r.reason).toMatch(/resource-based policy "BP"/);
    expect(r.policiesEvaluated.map((p) => p.type)).toEqual(["aws-managed", "resource-based"]);
  });
});

describe("evaluateTrustPolicy", () => {
  const trust = (principal: unknown, extra: Record<string, unknown> = {}) => ({
    id: `arn:aws:iam::${ACCT}:role/Ops`,
    name: "Ops",
    type: "trust" as const,
    document: {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow" as const,
          Principal: principal as never,
          Action: "sts:AssumeRole",
          ...extra,
        },
      ],
    },
  });
  const assume = (principalArn = ALICE) =>
    req("sts:AssumeRole", `arn:aws:iam::${ACCT}:role/Ops`, { principalArn });

  it("names the caller explicitly", () => {
    const r = evaluateTrustPolicy({ trustPolicy: trust({ AWS: ALICE }), request: assume() });
    expect(r.decision).toBe("Allow");
    expect(r.principalNamedExplicitly).toBe(true);
    expect(r.reason).toMatch(/no extra identity permission is needed/);
  });

  it.each([[{ AWS: `arn:aws:iam::${ACCT}:root` }], [{ AWS: ACCT }], ["*"]])(
    "trusting the account (%j) needs identity permission too",
    (principal) => {
      const r = evaluateTrustPolicy({ trustPolicy: trust(principal), request: assume() });
      expect(r.decision).toBe("Allow");
      expect(r.principalNamedExplicitly).toBe(false);
      expect(r.reason).toMatch(/also needs sts:AssumeRole/);
    },
  );

  it("denies other principals", () => {
    const r = evaluateTrustPolicy({
      trustPolicy: trust({ AWS: `arn:aws:iam::${ACCT}:user/bob` }),
      request: assume(),
    });
    expect(r.decision).toBe("ImplicitDeny");
    expect(r.reason).toBe(`The role's trust policy doesn't allow ${ALICE} to assume it.`);
  });

  it("requires the action to match", () => {
    const t = trust({ AWS: ALICE });
    const r = evaluateTrustPolicy({
      trustPolicy: t,
      request: { ...assume(), action: "sts:TagSession" },
    });
    expect(r.decision).toBe("ImplicitDeny");
  });

  it("an explicit Deny in the trust policy wins", () => {
    const t = trust({ AWS: ACCT });
    t.document.Statement.push({
      Effect: "Deny" as never,
      Principal: { AWS: ALICE } as never,
      Action: "sts:AssumeRole",
    });
    const r = evaluateTrustPolicy({ trustPolicy: t, request: assume() });
    expect(r.decision).toBe("ExplicitDeny");
    expect(r.principalNamedExplicitly).toBe(false);
  });

  it("honors conditions", () => {
    const t = trust({ AWS: ACCT }, { Condition: { StringEquals: { "aws:username": "bob" } } });
    expect(evaluateTrustPolicy({ trustPolicy: t, request: assume() }).decision).toBe(
      "ImplicitDeny",
    );
  });

  it("a role session can be trusted by role ARN", () => {
    const t = {
      ...trust({ AWS: `arn:aws:iam::${ACCT}:role/Jump` }),
    };
    const r = evaluateTrustPolicy({
      trustPolicy: t,
      request: assume(`arn:aws:sts::${ACCT}:assumed-role/Jump/me`),
    });
    expect(r.decision).toBe("Allow");
    expect(r.principalNamedExplicitly).toBe(true);
  });
});
