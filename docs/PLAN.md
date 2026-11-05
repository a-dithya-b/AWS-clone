# CloudLearn — Build Plan

> Working name. See [Open decisions](#7-open-decisions) for naming.
> This file is the living plan: tick boxes as work lands, and edit it when a decision changes.

CloudLearn is a free, zero-signup-to-AWS learning simulator. Each AWS service is mocked by backend
logic, so mistakes have real consequences inside the sandbox (real `AccessDenied`, real visibility
timeouts, a DLQ that really fills up) and none outside it.

---

## 1. Guiding principles

1. **The rules are real, the cloud is not.** When a behavior is part of how AWS works (deny wins,
   visibility timeout, FIFO group blocking), copy it exactly. When it's infrastructure (regions,
   SigV4, billing), leave it out.
2. **Authorization can't be skipped.** Every service action goes through one pipeline that checks
   IAM. A handler can't run unless it has been declared with its IAM action name.
3. **Every API call is an event.** Each request is logged with its principal, action, resource and
   IAM decision (a mini CloudTrail). The same log drives the "why was I denied?" panel, the
   simulator, and later the guided scenarios.
4. **Pure core, thin edges.** The policy evaluator and the SQS state rules are plain functions with
   an injectable clock, so they can be unit-tested without a database or a server.
5. **Transferable vocabulary.** Use AWS action names, parameter names, ARNs, error codes, ID prefixes
   and policy JSON, so what learners pick up works on real AWS.

## 2. v1 scope

**In:** IAM (root + IAM users, groups, roles, managed + inline policies, policy evaluation, switch
role), SQS (Standard + FIFO, send/receive/delete, visibility timeout, delay, long polling, retention,
DLQ), the live SQS simulator, and a single fixed region (`us-east-1`).

**Out of scope for v1** (write these down so they don't creep in): multiple regions, permission
boundaries, SCPs and Organizations, MFA, SigV4 and real AWS CLI compatibility (see §7.4), billing,
SQS resource-based queue policies (stretch goal), batch APIs (stretch goal).

## 3. Architecture

### 3.1 Repo layout

```
cloudlearn/
├─ apps/
│  ├─ api/                     Express + TypeScript
│  │  ├─ src/core/             auth, request context, authorize pipeline, errors, event log, clock
│  │  ├─ src/services/
│  │  │  ├─ iam/               self-contained module (actions, handlers, repo)
│  │  │  ├─ sqs/
│  │  │  └─ registry.ts        ← one line per service
│  │  └─ prisma/schema/        multi-file schema: base.prisma, iam.prisma, sqs.prisma
│  └─ web/                     React + Vite + Tailwind + Radix
│     ├─ src/shell/            console chrome: top bar, service search, breadcrumbs, footer
│     ├─ src/services/
│     │  ├─ iam/               lazy-loaded route bundle
│     │  ├─ sqs/
│     │  └─ registry.ts        ← one line per service
│     └─ src/components/ui/    design-system components
├─ packages/
│  ├─ shared/                  types, zod schemas, ARN helpers, error codes, ID generators
│  ├─ iam-engine/              pure policy parser + evaluator (no I/O, no Express, no Prisma)
│  └─ tsconfig/                shared tsconfig presets
├─ docker-compose.yml
├─ turbo.json
└─ pnpm-workspace.yaml
```

### 3.2 The service module contract

This is what makes "add a folder + one registry line" work.

```ts
// apps/api/src/core/service.ts
export interface ActionDef<I, O> {
  name: string;                                  // "SendMessage"
  iamAction: string;                             // "sqs:SendMessage"
  input: ZodSchema<I>;                           // validated before anything else
  resource: (input: I, ctx: RequestCtx) => string; // ARN this call targets
  handler: (input: I, ctx: RequestCtx) => Promise<O>;
}

export interface ServiceModule {
  id: string;                                    // "sqs"
  actions: ActionDef<any, any>[];
  onStart?: (deps: CoreDeps) => void;            // background jobs (e.g. retention sweeper)
  realtime?: (io: Namespace, deps: CoreDeps) => void;
}
```

Each request runs this pipeline:

```
authenticate (JWT cookie → account + principal)
  → validate input (zod)
  → resolve resource ARN
  → authorize (root: allow | otherwise: iam-engine.evaluate)
  → record ApiEvent (always, including denials)
  → handler  |  AccessDenied error
```

Routes are generated from the registry (`POST /api/{service}/{Action}`), so an action can't skip
the pipeline.

On the frontend, each service exports a manifest:

```ts
export const sqsManifest: ServiceManifest = {
  id: "sqs", name: "Simple Queue Service", shortName: "SQS", category: "Application Integration",
  routes: lazy(() => import("./routes")),
};
```

### 3.3 API and error shape

- Internal JSON API shaped like AWS: action names and parameter names follow the AWS API reference
  (`QueueUrl`, `MaxNumberOfMessages`, `PolicyDocument`). This keeps a future AWS-CLI-compatible
  adapter cheap (§7.4).
- Errors use AWS codes and wording:
  ```json
  { "code": "AccessDenied",
    "message": "User: arn:aws:iam::123456789012:user/alice is not authorized to perform: sqs:SendMessage on resource: arn:aws:sqs:us-east-1:123456789012:orders because no identity-based policy allows the sqs:SendMessage action",
    "evaluation": { "decision": "ImplicitDeny", "matchedStatements": [] } }
  ```
  The `evaluation` field is our teaching addition. Real AWS doesn't return it.

### 3.4 Data model (first pass)

| Model | Key fields | Notes |
|---|---|---|
| `Account` | `id` (12 digits), `alias?`, `email`, `rootPasswordHash` | one per sign-up |
| `IamUser` | `id` (`AIDA…`), `accountId`, `name`, `path`, `passwordHash?` | password = console access |
| `IamGroup` / `GroupMember` | `id` (`AGPA…`), `name`, `path` | |
| `IamRole` | `id` (`AROA…`), `name`, `trustPolicy` (JSON), `maxSessionDuration` | |
| `Policy` | `id` (`ANPA…`), `accountId?` (null = AWS managed), `arn`, `name`, `defaultVersionId` | |
| `PolicyVersion` | `policyId`, `versionId` (`v1`…), `document` (JSON) | max 5 versions, like AWS |
| `PolicyAttachment` | `policyId`, `principalType`, `principalId` | user / group / role |
| `InlinePolicy` | `principalType`, `principalId`, `name`, `document` | |
| `Queue` | `accountId`, `name`, `arn`, `url`, `fifo`, `visibilityTimeout`, `retentionPeriod`, `delaySeconds`, `receiveWaitTime`, `redrivePolicy` (JSON), `contentBasedDedup` | |
| `Message` | `messageId`, `queueId`, `body`, `attributes`, `md5`, `sentAt`, `visibleAt`, `receiveCount`, `receiptHandle?`, `groupId?`, `dedupId?`, `sequenceNumber?`, `state` | `state` is kept for the simulator history |
| `FifoDedup` | `queueId`, `dedupId`, `expiresAt` | 5-minute window |
| `ApiEvent` | `accountId`, `principalArn`, `action`, `resourceArn`, `decision`, `matchedStatements`, `errorCode?`, `params`, `at` | the mini CloudTrail |

### 3.5 Auth

- Passwords hashed with argon2 (or bcrypt).
- JWT in an `httpOnly`, `SameSite=Strict` cookie. Socket.io reuses the same cookie.
- Claims: `accountId`, `principalType` (`root` | `user` | `assumed-role`), `principalArn`, `sessionName?`.
- Root sign-in uses email + password. IAM user sign-in uses account ID or alias + username +
  password, the same way the AWS console does it.
- Rate-limit the auth endpoints, and add `helmet`. Cheap to do, and good habits.

---

## 4. Phases

Sizes are relative (S/M/L), not time estimates. Each phase has a **Done when** demo you can run.

### Phase 0 — Machine setup (now)

- [ ] Switch Node to the current **LTS** line (Node 24 or 26) with `fnm` or `nvm`. Node 25 is an
      odd-numbered, short-lived release that is already end-of-life. Pin the version in `.nvmrc`
      and `engines`.
- [ ] Install pnpm with `npm install -g pnpm`. Corepack no longer ships with newer Node releases,
      so `corepack enable` may not be available. Pin it with `"packageManager"` in the root
      `package.json`.
- [ ] Install Docker Desktop and confirm `docker compose version` works.
- [ ] Copy the overview doc, designer brief and setup checklist into `docs/`, so they live next to
      the code.
- [ ] Rename the repo away from `AWS-clone` before it's public (see §6, Legal).

### Phase 1 — Foundation (M)

- [ ] **1.1 Monorepo skeleton:** pnpm workspaces, Turborepo tasks (`dev`, `build`, `lint`,
      `typecheck`, `test`), shared tsconfig, ESLint + Prettier, Vitest.
- [ ] **1.2 Docker Compose:** Postgres service with a named volume. In dev, the apps run on the
      host for fast reloads and only the DB runs in Docker.
- [ ] **1.3 API skeleton:** Express 5, pino logging, zod validation, AWS-shaped error handler,
      `GET /health`.
- [ ] **1.4 Prisma:** `Account` model, first migration, seed script.
- [ ] **1.5 Root auth:** sign-up (generates a 12-digit account ID), sign-in, sign-out, `GET /me`.
- [ ] **1.6 Web shell:** Vite + React + Tailwind + React Router, sign-up and sign-in pages, console
      chrome (top bar, service search, account menu, region label, footer disclaimer), service
      registry with an empty Console Home.
- [ ] **1.7 Core pipeline:** `ServiceModule` / `ActionDef`, route generation, `ApiEvent` logging,
      and an `authorize` step that allows everything for now. IAM plugs into this step in Phase 2.
- [ ] **1.8 CI:** GitHub Actions running lint, typecheck and test on every push.

**Done when:** `docker compose up -d db && pnpm dev` → sign up → you land on Console Home showing
your account ID, and CI is green.

### Phase 2 — IAM (L)

- [ ] **2.1 `iam-engine` (test-first):**
  - Parse and validate policy JSON: `Version`, `Statement` (object or array), `Sid`, `Effect`,
    `Action` / `NotAction`, `Resource` / `NotResource`, `Condition`.
  - Wildcard matching for `*` and `?`. Actions match case-insensitively, resources case-sensitively.
  - Evaluation: explicit Deny → any Allow → otherwise implicit deny. Return the decision **and**
    the statements that matched (the trace).
  - Conditions, starting with a small subset: `StringEquals`, `StringNotEquals`, `StringLike`,
    `Bool`, `ArnLike`, and the keys `aws:username`, `aws:PrincipalArn`, `aws:CurrentTime`. Unknown
    operators fail validation loudly.
  - Design the inputs to take *several policy sets* (identity-based now, resource-based later for
    S3 bucket policies and SQS queue policies) so Phase 5 doesn't require a rewrite.
  - Table-driven tests built from the examples in the AWS IAM docs.
- [ ] **2.2 Models + seed:** IAM tables from §3.4. Seed AWS-managed policies with their real JSON:
      `AdministratorAccess`, `IAMFullAccess`, `IAMReadOnlyAccess`, `AmazonSQSFullAccess`,
      `AmazonSQSReadOnlyAccess`, and a trimmed `ReadOnlyAccess` covering only the services we have.
- [ ] **2.3 IAM API:** `CreateUser`, `GetUser`, `ListUsers`, `DeleteUser` (with AWS's
      `DeleteConflict` when the user still has policies or groups), `CreateLoginProfile`, the group
      CRUD + `AddUserToGroup` / `RemoveUserFromGroup`, role CRUD with a trust policy, `CreatePolicy`,
      `CreatePolicyVersion`, `SetDefaultPolicyVersion`, `Attach*` / `Detach*`, `Put*` / `Get*` /
      `Delete*` for inline policies, and the `List*` endpoints.
- [ ] **2.4 IAM user sign-in:** account ID or alias + username + password.
- [ ] **2.5 Turn on enforcement:** the `authorize` step loads the principal's policies (user +
      groups + inline, or role) and calls the engine. Real AWS-style `AccessDenied` messages.
      Console pages show AWS-style "You don't have permission to `iam:ListUsers`" states.
- [ ] **2.6 Switch role:** `sts:AssumeRole` checks both the caller's permissions and the role's
      trust policy. The session becomes `arn:aws:sts::<acct>:assumed-role/<Role>/<session>`.
- [ ] **2.7 IAM console UI:** list and detail pages for users, groups, roles and policies, with
      tabs (Permissions, Groups, Security credentials, Trust relationships). Create wizards. A JSON
      policy editor (CodeMirror) with live validation, plus a readable policy summary.
- [ ] **2.8 Teaching extras:** a "Why was this denied?" drawer built from the evaluation trace, a
      Policy Simulator page (pick a principal, action and resource; see the result and the matched
      statements), and an activity log page over `ApiEvent`.

**Done when:** root creates user `alice` with no policies → alice signs in → listing users fails
with an accurate message → attach `IAMReadOnlyAccess` → listing works, creating still fails → add an
explicit `Deny` on `iam:ListUsers` to a group alice is in → listing fails again, even after you
attach `AdministratorAccess`.

### Phase 3 — SQS + simulator (L)

- [ ] **3.1 Queue lifecycle:** `CreateQueue` (enforce the `.fifo` suffix rule and validate
      attribute ranges), `GetQueueUrl`, `ListQueues`, `GetQueueAttributes`, `SetQueueAttributes`,
      `DeleteQueue`, `PurgeQueue` (with AWS's 60-second purge cooldown).
- [ ] **3.2 Messaging engine:**
  - `SendMessage` (`DelaySeconds`, message attributes, MD5 of the body), `ReceiveMessage`
    (`MaxNumberOfMessages` 1–10, `VisibilityTimeout` override, `WaitTimeSeconds` long polling up
    to 20 s), `DeleteMessage` by receipt handle (every receive issues a new handle),
    `ChangeMessageVisibility`.
  - Concurrency-safe receive in Postgres:
    `SELECT … WHERE visible_at <= now() … FOR UPDATE SKIP LOCKED` (via `$queryRaw`) and then set
    `visible_at = now() + timeout`.
  - Every time-based rule reads from an injected `Clock`, so tests can fast-forward time.
- [ ] **3.3 DLQ:** `RedrivePolicy` (`deadLetterTargetArn`, `maxReceiveCount`). When a receive would
      push `receiveCount` past the limit, move the message to the DLQ instead of returning it.
      Validate that the DLQ type matches (FIFO ↔ FIFO). Stretch: redrive back to the source queue.
- [ ] **3.4 FIFO:** require `MessageGroupId`, keep strict order within a group, and block a group
      while one of its messages is in flight. Deduplicate within 5 minutes (explicit
      `MessageDeduplicationId`, or content-based), and assign sequence numbers.
- [ ] **3.5 Background jobs:** a retention sweeper, plus a visibility ticker that emits
      "message became visible again" events for queues someone is watching.
- [ ] **3.6 SQS console UI:** queue list, a create-queue form that mirrors the AWS fields and
      defaults, queue detail tabs, and a "Send and receive messages" page (AWS has one too).
- [ ] **3.7 Live simulator** (Socket.io namespace `/sqs`, one room per queue ARN):
  - Columns: **Available → In flight (countdown bar) → Deleted**, with a **DLQ** lane.
  - Events: `sent`, `received`, `visible`, `deleted`, `moved_to_dlq`, `expired`, each carrying
    timestamps so the client can animate without extra round-trips.
  - Built-in **producer** (send N messages, set a rate) and **consumer** controls
    (processing time, failure rate, auto-delete on/off). These two knobs drive the main lessons:
    processing that takes longer than the timeout causes duplicates, and repeated failures send
    messages to the DLQ.
  - The simulator calls the same API as everything else, so IAM still applies.

**Done when:** you can reproduce three behaviors in the simulator: (a) a consumer slower than the
visibility timeout processes the same message twice, (b) a consumer with a 100% failure rate pushes
messages into the DLQ after `maxReceiveCount`, and (c) a user with `AmazonSQSReadOnlyAccess` gets
`AccessDenied` on send.

### Phase 4 — Intern test, polish, guided scenarios (M)

- [ ] **4.1 Scenario engine** (format in §7.3) and 3–5 starter scenarios:
      "Your first IAM user", "Least privilege", "Explicit deny wins", "Visibility timeout race",
      "Catch poison messages with a DLQ".
- [ ] **4.2 Intern test:** 3–5 testers, a written task list, and observation without helping. Log
      every point of confusion, then fix the top issues.
- [ ] **4.3 Polish:** empty, loading and error states. Keyboard and screen-reader basics.
      Dark mode if the design system makes it cheap.
- [ ] **4.4 Sandbox safety:** a "Reset my account" button and per-account quotas (for example 20
      queues, 10k messages, 50 users), which a public demo will need.
- [ ] **4.5 One-command run:** `docker compose up` builds and runs DB + API + web.
- [ ] **4.6 Docs for contributors:** README, CONTRIBUTING, and "Adding a new service" (walk through
      the registry contract).

### Phase 5 — S3, then EC2 (L each)

- **S3:** buckets, objects (stored on a Docker volume), prefixes, bucket policies, and Block Public
  Access. This is the first service with **resource-based policies**, so it extends the evaluator's
  multi-policy input from 2.1.
- **EC2:** a simulated instance state machine (pending → running → stopping → stopped →
  terminated), AMIs as a static catalog, key pairs, and security groups as data plus a
  "can X reach Y?" checker. No real VMs.

---

## 5. Testing strategy

| Layer | Tool | What to test |
|---|---|---|
| `iam-engine` | Vitest, table-driven | every evaluation rule; aim for close to 100% coverage, because this is the product's core |
| SQS state rules | Vitest + fake clock | visibility, delay, DLQ, FIFO blocking, dedup windows |
| API | Vitest + Supertest against a real Postgres in Docker | the pipeline end to end, AccessDenied paths, AWS error shapes |
| Web | Vitest + Testing Library | policy editor validation, simulator reducers |
| E2E | Playwright (Phase 4) | each phase's **Done when** demo becomes an automated test |

## 6. Legal and naming checklist

- [ ] No AWS logos, service icons or console screenshots in the repo or the UI.
- [ ] "AWS" appears nowhere in the product name, repo name, domain or npm scope.
- [ ] Footer: *"CloudLearn is an independent educational project and is not affiliated with, endorsed
      by, or sponsored by Amazon Web Services."*
- [ ] Service names used descriptively ("simulates Amazon SQS").
- [ ] Own visual identity: layout and terminology like the console, but our own colors, type and
      icons (see §7.1).
- [ ] Pick a license before going public (MIT or Apache-2.0).

## 7. Open decisions

Each has a recommendation and a "decide by" point, so none of them blocks starting.

### 7.1 Design system — decide before step 1.6

**Recommendation: shadcn/ui** (Radix primitives + Tailwind, copied into `src/components/ui/`) with
a custom theme.
- It fits the stack you already chose, and you own the component code, which is better for
  learning.
- Copy the console's *information architecture*: top bar, left service nav, breadcrumbs,
  filterable and paginated tables, a split view with a details panel, wizard-style create flows.
- Don't use Cloudscape (AWS's own open-source design system). It doesn't fit Radix/Tailwind, and
  it would make the product *look* like AWS, which works against the legal approach.
- Start with a small set: Button, Input, Select, Table, Tabs, Dialog, Drawer, Toast, Badge, Alert,
  Breadcrumb, and a JSON editor wrapper.

### 7.2 Project name — decide before going public (Phase 4)

**Recommendation:** keep `cloudlearn` as the code name (package scope `@cloudlearn/*`) and don't
block on it. Before launch, check that the name is free on GitHub, npm and a `.dev`/`.io` domain,
and run a basic trademark search. Generic "cloud + learn" names are often taken. Renaming one scope
string is cheap now and expensive after launch.

### 7.3 Guided-scenario format — decide at the end of Phase 3

**Recommendation:** declarative scenario files in TypeScript, checked against the `ApiEvent` log and
the current account state.

```ts
export default defineScenario({
  id: "dlq-poison-messages",
  title: "Catch poison messages with a DLQ",
  services: ["sqs"],
  steps: [
    { instructions: md`Create a Standard queue named **orders-dlq**.`,
      check: queueExists({ name: "orders-dlq" }) },
    { instructions: md`Create **orders** with a redrive policy, maxReceiveCount = 3.`,
      check: queueHasRedrive({ name: "orders", target: "orders-dlq", maxReceiveCount: 3 }) },
    { instructions: md`Open the simulator and set the consumer failure rate to 100%.`,
      check: eventSeen({ type: "sqs.moved_to_dlq", queue: "orders" }) },
  ],
});
```

- The scenarios show up as a side panel in the console, so learners do the real steps in the real
  UI rather than a sandboxed copy.
- Checks are small, reusable predicates per service, which keeps writing scenarios easy for future
  contributors.
- **Build the `ApiEvent` log in Phase 1** even though scenarios come later. It's the foundation.

### 7.4 AWS CLI / SDK compatibility — post-v1

Being able to run `aws sqs send-message --endpoint-url http://localhost:4000` against CloudLearn
would be a strong feature. It needs SigV4 verification, IAM access keys, and AWS's wire protocols.
Not for v1, but §3.3 keeps the internal API shaped so this can be added later as an adapter.

## 8. Next steps (the first sessions of work)

1. Phase 0: Node LTS, pnpm, Docker Desktop.
2. Choose the design system (§7.1). The recommendation lets you start right away.
3. Step 1.1: scaffold the monorepo.
4. Steps 1.2–1.4: Postgres in Compose, Express skeleton, Prisma `Account`.
5. Step 1.5: root sign-up and sign-in, end to end through to the web shell.
