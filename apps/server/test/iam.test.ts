import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, ok, type TestClient } from "./helpers";

const ADMIN = "arn:aws:iam::aws:policy/AdministratorAccess";
const IAM_READ_ONLY = "arn:aws:iam::aws:policy/IAMReadOnlyAccess";

let t: ReturnType<typeof createTestApp>;
let root: TestClient;
let accountId: string;

/** Creates an IAM user with a console password. */
async function createUser(name: string, password = "user-password-1") {
  ok(await root.action("iam", "CreateUser", { UserName: name }));
  ok(await root.action("iam", "CreateLoginProfile", { UserName: name, Password: password }));
}

async function signIn(name: string, password = "user-password-1") {
  const c = t.client();
  ok(await c.signInIam(accountId, name, password));
  return c;
}

beforeEach(async () => {
  t = createTestApp();
  root = t.client();
  accountId = ok(await root.signUp()).session.accountId;
});

describe("IAM: the Phase 2 'done when' story", () => {
  it("default deny → allow via managed policy → explicit deny wins over AdministratorAccess", async () => {
    await createUser("alice");
    const alice = await signIn("alice");

    // 1. No policies: everything is denied, with AWS's exact wording.
    const denied = await alice.action("iam", "ListUsers");
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("AccessDenied");
    expect(denied.body.message).toBe(
      `User: arn:aws:iam::${accountId}:user/alice is not authorized to perform: iam:ListUsers on resource: * because no identity-based policy allows the iam:ListUsers action`,
    );
    expect(denied.body.evaluation.reason).toMatch(/No policies are attached/);

    // 2. Read-only: listing works, creating doesn't.
    ok(
      await root.action("iam", "AttachUserPolicy", { UserName: "alice", PolicyArn: IAM_READ_ONLY }),
    );
    expect(ok(await alice.action("iam", "ListUsers")).Users).toHaveLength(1);
    expect((await alice.action("iam", "CreateUser", { UserName: "eve" })).status).toBe(403);

    // 3. A group with an explicit Deny beats even AdministratorAccess.
    ok(await root.action("iam", "CreateGroup", { GroupName: "no-listing" }));
    ok(
      await root.action("iam", "PutGroupPolicy", {
        GroupName: "no-listing",
        PolicyName: "DenyListUsers",
        PolicyDocument: JSON.stringify({
          Version: "2012-10-17",
          Statement: [{ Sid: "NoList", Effect: "Deny", Action: "iam:ListUsers", Resource: "*" }],
        }),
      }),
    );
    ok(await root.action("iam", "AddUserToGroup", { GroupName: "no-listing", UserName: "alice" }));
    ok(await root.action("iam", "AttachUserPolicy", { UserName: "alice", PolicyArn: ADMIN }));

    const explicit = await alice.action("iam", "ListUsers");
    expect(explicit.status).toBe(403);
    expect(explicit.body.message).toMatch(/with an explicit deny in an identity-based policy$/);
    expect(explicit.body.evaluation.decision).toBe("ExplicitDeny");
    expect(explicit.body.evaluation.matchedStatements[0]).toMatchObject({
      policyName: "DenyListUsers",
      attachedVia: "group/no-listing",
      sid: "NoList",
    });
    // Other actions still work through AdministratorAccess.
    ok(await alice.action("iam", "ListGroups"));
  });

  it("records denied calls in the event log with the evaluation", async () => {
    await createUser("alice");
    const alice = await signIn("alice");
    await alice.action("iam", "ListUsers");
    const events = ok(await root.action("cloudtrail", "LookupEvents")).Events;
    const denied = events.find((e: { EventName: string }) => e.EventName === "ListUsers");
    expect(denied).toMatchObject({
      Username: "alice",
      ErrorCode: "AccessDenied",
      Decision: "ImplicitDeny",
    });
  });
});

describe("IAM users", () => {
  it("rejects duplicate names regardless of case, like AWS", async () => {
    ok(await root.action("iam", "CreateUser", { UserName: "Alice" }));
    const res = await root.action("iam", "CreateUser", { UserName: "alice" });
    expect(res.body.code).toBe("EntityAlreadyExists");
  });

  it("validates names", async () => {
    const res = await root.action("iam", "CreateUser", { UserName: "bad name!" });
    expect(res.body.code).toBe("ValidationError");
  });

  it("refuses to delete a user that still has a password, groups or policies", async () => {
    await createUser("bob");
    ok(await root.action("iam", "CreateGroup", { GroupName: "devs" }));
    ok(await root.action("iam", "AddUserToGroup", { GroupName: "devs", UserName: "bob" }));
    ok(await root.action("iam", "AttachUserPolicy", { UserName: "bob", PolicyArn: ADMIN }));

    const steps: [string, Record<string, string>][] = [
      ["DeleteLoginProfile", { UserName: "bob" }],
      ["RemoveUserFromGroup", { GroupName: "devs", UserName: "bob" }],
      ["DetachUserPolicy", { UserName: "bob", PolicyArn: ADMIN }],
    ];
    for (const [action, input] of steps) {
      const res = await root.action("iam", "DeleteUser", { UserName: "bob" });
      expect(res.body.code).toBe("DeleteConflict");
      ok(await root.action("iam", action, input));
    }
    ok(await root.action("iam", "DeleteUser", { UserName: "bob" }));
    expect((await root.action("iam", "GetUser", { UserName: "bob" })).body.code).toBe(
      "NoSuchEntity",
    );
  });

  it("ends a deleted user's sessions", async () => {
    await createUser("bob");
    const bob = await signIn("bob");
    ok(await root.action("iam", "DeleteLoginProfile", { UserName: "bob" }));
    ok(await root.action("iam", "DeleteUser", { UserName: "bob" }));
    expect((await bob.call("GET", "/api/auth/session")).body).toEqual({ signedIn: false });
  });

  it("IAM users can't sign in without a console password or with the wrong one", async () => {
    ok(await root.action("iam", "CreateUser", { UserName: "nopass" }));
    const c = t.client();
    expect((await c.signInIam(accountId, "nopass", "whatever-123")).status).toBe(401);
    await createUser("carol");
    expect((await c.signInIam(accountId, "carol", "wrong-password")).status).toBe(401);
    expect((await c.signInIam(accountId, "CAROL", "user-password-1")).status).toBe(200);
  });

  it("signs in with the account alias", async () => {
    ok(await root.action("iam", "CreateAccountAlias", { AccountAlias: "my-team" }));
    await createUser("dave");
    const c = t.client();
    const res = ok(await c.signInIam("my-team", "dave", "user-password-1"));
    expect(res.session.principal).toMatchObject({
      type: "user",
      name: "dave",
      arn: `arn:aws:iam::${accountId}:user/dave`,
    });
    expect(res.session.accountAlias).toBe("my-team");
  });

  it("IAMUserChangePassword lets users change only their own password (${aws:username})", async () => {
    await createUser("alice");
    await createUser("bob");
    ok(
      await root.action("iam", "AttachUserPolicy", {
        UserName: "alice",
        PolicyArn: "arn:aws:iam::aws:policy/IAMUserChangePassword",
      }),
    );
    const alice = await signIn("alice");
    ok(
      await alice.action("iam", "ChangePassword", {
        OldPassword: "user-password-1",
        NewPassword: "new-password-2",
      }),
    );
    expect(
      (await alice.action("iam", "UpdateLoginProfile", { UserName: "bob", Password: "hacked-123" }))
        .status,
    ).toBe(403);
    expect((await t.client().signInIam(accountId, "alice", "new-password-2")).status).toBe(200);
  });
});

describe("IAM policies", () => {
  const doc = (action: string) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Action: action, Resource: "*" }],
    });

  it("seeds AWS managed policies", async () => {
    const res = ok(await root.action("iam", "ListPolicies", { Scope: "AWS" }));
    const names = res.Policies.map((p: { PolicyName: string }) => p.PolicyName);
    expect(names).toEqual(
      expect.arrayContaining(["AdministratorAccess", "AmazonSQSFullAccess", "PowerUserAccess"]),
    );
  });

  it("rejects malformed policies with AWS's messages", async () => {
    const bad = await root.action("iam", "CreatePolicy", {
      PolicyName: "Bad",
      PolicyDocument: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Action: "ListUsers", Resource: "*" }],
      }),
    });
    expect(bad.body).toMatchObject({
      code: "MalformedPolicyDocument",
      message: "Actions/Conditions must be prefaced by a vendor, e.g., iam, sdb, ec2, etc.",
    });
    const principal = await root.action("iam", "CreatePolicy", {
      PolicyName: "Bad",
      PolicyDocument: {
        Statement: [{ Effect: "Allow", Principal: "*", Action: "s3:*", Resource: "*" }],
      },
    });
    expect(principal.body.message).toBe("Policy document should not specify a principal.");
  });

  it("manages versions: max 5, can't delete the default, SetAsDefault changes behavior", async () => {
    const { Policy } = ok(
      await root.action("iam", "CreatePolicy", {
        PolicyName: "P",
        PolicyDocument: doc("iam:ListUsers"),
      }),
    );
    await createUser("alice");
    ok(await root.action("iam", "AttachUserPolicy", { UserName: "alice", PolicyArn: Policy.Arn }));
    const alice = await signIn("alice");
    ok(await alice.action("iam", "ListUsers"));

    ok(
      await root.action("iam", "CreatePolicyVersion", {
        PolicyArn: Policy.Arn,
        PolicyDocument: doc("iam:ListGroups"),
        SetAsDefault: true,
      }),
    );
    expect((await alice.action("iam", "ListUsers")).status).toBe(403);
    ok(await alice.action("iam", "ListGroups"));

    for (let i = 0; i < 3; i++) {
      ok(
        await root.action("iam", "CreatePolicyVersion", {
          PolicyArn: Policy.Arn,
          PolicyDocument: doc("iam:ListRoles"),
        }),
      );
    }
    const limit = await root.action("iam", "CreatePolicyVersion", {
      PolicyArn: Policy.Arn,
      PolicyDocument: doc("iam:ListRoles"),
    });
    expect(limit.body.code).toBe("LimitExceeded");
    expect(
      (await root.action("iam", "DeletePolicyVersion", { PolicyArn: Policy.Arn, VersionId: "v2" }))
        .body.code,
    ).toBe("DeleteConflict");

    // Can't delete while attached or with extra versions.
    expect((await root.action("iam", "DeletePolicy", { PolicyArn: Policy.Arn })).body.code).toBe(
      "DeleteConflict",
    );
  });

  it("doesn't let you change AWS managed policies", async () => {
    const res = await root.action("iam", "CreatePolicyVersion", {
      PolicyArn: ADMIN,
      PolicyDocument: doc("s3:*"),
    });
    expect(res.body.code).toBe("InvalidInput");
  });

  it("limits attached managed policies to 10", async () => {
    ok(await root.action("iam", "CreateUser", { UserName: "many" }));
    for (let i = 0; i < 10; i++) {
      const { Policy } = ok(
        await root.action("iam", "CreatePolicy", {
          PolicyName: `P${i}`,
          PolicyDocument: doc("s3:GetObject"),
        }),
      );
      ok(await root.action("iam", "AttachUserPolicy", { UserName: "many", PolicyArn: Policy.Arn }));
    }
    const res = await root.action("iam", "AttachUserPolicy", {
      UserName: "many",
      PolicyArn: ADMIN,
    });
    expect(res.body.code).toBe("LimitExceeded");
  });

  it("simulates a principal's policies", async () => {
    await createUser("alice");
    ok(
      await root.action("iam", "AttachUserPolicy", { UserName: "alice", PolicyArn: IAM_READ_ONLY }),
    );
    const res = ok(
      await root.action("iam", "SimulatePrincipalPolicy", {
        PolicySourceArn: `arn:aws:iam::${accountId}:user/alice`,
        ActionNames: ["iam:ListUsers", "iam:CreateUser"],
      }),
    );
    expect(res.EvaluationResults.map((r: { EvalDecision: string }) => r.EvalDecision)).toEqual([
      "allowed",
      "implicitDeny",
    ]);
  });

  it("exposes the action catalog", async () => {
    const res = ok(await root.call("GET", "/api/meta/catalog"));
    expect(res.actions).toContainEqual({
      action: "iam:CreateUser",
      service: "iam",
      serviceName: "Identity and Access Management",
      accessLevel: "Write",
    });
  });
});

describe("roles and switch role", () => {
  const trust = (principal: string) => ({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { AWS: principal }, Action: "sts:AssumeRole" }],
  });

  async function createRole(name: string, principal: string, policyArn = ADMIN) {
    ok(
      await root.action("iam", "CreateRole", {
        RoleName: name,
        AssumeRolePolicyDocument: trust(principal),
      }),
    );
    ok(await root.action("iam", "AttachRolePolicy", { RoleName: name, PolicyArn: policyArn }));
  }

  const switchRole = (c: TestClient, roleName: string, account = accountId) =>
    c.call("POST", "/api/auth/switch-role", { account, roleName });

  it("the root user can't switch roles", async () => {
    await createRole("Admin", `arn:aws:iam::${accountId}:root`);
    const res = await switchRole(root, "Admin");
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/root user can't switch roles/);
  });

  it("trusting the account root also requires sts:AssumeRole in the user's own policies", async () => {
    await createRole("Admin", `arn:aws:iam::${accountId}:root`);
    await createUser("alice");
    const alice = await signIn("alice");
    const denied = await switchRole(alice, "Admin");
    expect(denied.status).toBe(403);
    expect(denied.body.evaluation.reason).toMatch(
      /your own policies must also allow sts:AssumeRole/,
    );

    ok(
      await root.action("iam", "PutUserPolicy", {
        UserName: "alice",
        PolicyName: "AssumeAdmin",
        PolicyDocument: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: "sts:AssumeRole",
              Resource: `arn:aws:iam::${accountId}:role/Admin`,
            },
          ],
        }),
      }),
    );
    const res = ok(await switchRole(alice, "Admin"));
    expect(res.session.principal).toMatchObject({
      type: "assumed-role",
      arn: `arn:aws:sts::${accountId}:assumed-role/Admin/alice`,
    });
    expect(res.session.switchedFrom).toMatchObject({ principalName: "alice" });

    // The role's permissions now apply…
    ok(await alice.action("iam", "CreateUser", { UserName: "made-by-role" }));
    const who = ok(await alice.action("sts", "GetCallerIdentity"));
    expect(who.Arn).toBe(`arn:aws:sts::${accountId}:assumed-role/Admin/alice`);

    // …until you switch back.
    ok(await alice.call("POST", "/api/auth/switch-back", {}));
    expect((await alice.action("iam", "CreateUser", { UserName: "x" })).status).toBe(403);
  });

  it("a trust policy naming the user directly is enough on its own", async () => {
    await createUser("bob");
    await createRole("ReadOnly", `arn:aws:iam::${accountId}:user/bob`, IAM_READ_ONLY);
    const bob = await signIn("bob");
    ok(await switchRole(bob, "ReadOnly"));
    ok(await bob.action("iam", "ListUsers"));
    expect((await bob.action("iam", "CreateUser", { UserName: "nope" })).status).toBe(403);
  });

  it("a role that doesn't trust you can't be assumed", async () => {
    await createUser("carol");
    await createRole("Other", `arn:aws:iam::${accountId}:user/someone-else`);
    const carol = await signIn("carol");
    const res = await switchRole(carol, "Other");
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/is not authorized to perform: sts:AssumeRole/);
  });

  it("role sessions expire after MaxSessionDuration", async () => {
    await createUser("bob");
    await createRole("ReadOnly", `arn:aws:iam::${accountId}:user/bob`, IAM_READ_ONLY);
    const bob = await signIn("bob");
    ok(await switchRole(bob, "ReadOnly"));
    t.clock.advance(3600 * 1000 + 1);
    expect((await bob.call("GET", "/api/auth/session")).body).toEqual({ signedIn: false });
  });

  it("rejects trust policies without a principal", async () => {
    const res = await root.action("iam", "CreateRole", {
      RoleName: "Bad",
      AssumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Action: "sts:AssumeRole" }],
      },
    });
    expect(res.body.code).toBe("MalformedPolicyDocument");
  });
});
