# CloudLearn — Build Plan

> Working name. See [Open decisions](#7-open-decisions) for naming.
> This file is the living plan: tick boxes as work lands, and edit it when a decision changes.

CloudLearn is a free, open-source AWS learning simulator that **runs on the learner's own laptop**.
There's no AWS account and no hosting. Each AWS service is mocked by backend logic, so mistakes have
real consequences inside the sandbox (a real `AccessDenied`, real visibility timeouts, a DLQ that
really fills up) and none outside it.

---

## 1. Guiding principles

1. **The rules are real, the cloud is not.** When a behavior is part of how AWS works (deny wins,
   visibility timeout, FIFO group blocking), copy it exactly. When it's infrastructure (regions,
   SigV4, billing), leave it out.
2. **One command, nothing else to install.** Node is the only prerequisite: no Docker, no database
   server, no native modules to compile. The goal is `npx cloudlearn`.
3. **Authorization can't be skipped.** Every service action goes through one pipeline that checks
   IAM. A handler can't run unless it has been declared with its IAM action name.
4. **Every API call is an event.** Each request is logged with its principal, action, resource and
   IAM decision (a mini CloudTrail). The same log drives the "why was I denied?" panel, the
   simulator, and later the guided scenarios.
5. **Pure core, thin edges.** The policy evaluator and the SQS state rules are plain functions with
   an injectable clock, so they can be unit-tested without a server.
6. **Transferable vocabulary.** Use AWS action names, parameter names, ARNs, error codes, ID prefixes
   and policy JSON, so what learners pick up works on real AWS.

## 2. v1 scope

**In:** IAM (root + IAM users, groups, roles, managed + inline policies, policy evaluation, switch
role), SQS (Standard + FIFO, send/receive/delete, visibility timeout, delay, long polling, retention,
DLQ), the live SQS simulator, a CloudTrail-style event history, and a single fixed region
(`us-east-1`).

**Out of scope for v1** (write these down so they don't creep in): hosting or multi-user servers,
multiple regions, permission boundaries, SCPs and Organizations, MFA, SigV4 and real AWS CLI
compatibility (see §7.4), billing, SQS resource-based queue policies (stretch goal), batch APIs
(stretch goal).

## 3. Architecture

### 3.1 Tech stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node ≥ 22.13 (LTS), TypeScript | One prerequisite for learners |
| Server | [Hono](https://hono.dev) on `@hono/node-server` | Small, typed, fast; `app.request()` makes API tests trivial |
| Database | SQLite via Node's built-in `node:sqlite` | A single file in `~/.cloudlearn/`; nothing to install or compile |
| Validation | zod, shared by the server and the web forms | One set of rules on both sides |
| Realtime (Phase 3) | Server-Sent Events | The simulator only needs server → browser pushes; built into browsers and Hono |
| Web | React 19, Vite, Tailwind v4, Radix UI, TanStack Query, React Router | |
| Components | Our own shadcn-style components on Radix + Tailwind | We own the code; our own look (see §7.1) |
| Tests | Vitest (in-memory SQLite, fake clock), Playwright for end-to-end | No Docker needed to run tests |
| Lint/format | Biome | One fast tool instead of ESLint + Prettier |
| Monorepo | pnpm workspaces | Turborepo was overkill at this size |
| Packaging | tsdown bundles the server; the built web app ships inside it | Prepares for `npx cloudlearn` |

### 3.2 Repo layout

```
apps/
├─ server/                     Hono + node:sqlite
│  ├─ src/core/                db + migrations, sessions, auth routes, action pipeline,
│  │                           authorizer, event log, clock, config, local-server security
│  ├─ src/services/
│  │  ├─ sts/                  GetCallerIdentity
│  │  ├─ cloudtrail/           LookupEvents over the event log
│  │  └─ registry.ts           ← one line per service
│  └─ test/                    API tests (in-memory DB, fake clock)
└─ web/                        React + Vite
   ├─ src/shell/               console chrome: top bar, services menu, search, account menu
   ├─ src/services/
   │  ├─ cloudtrail/           lazy-loaded route bundle
   │  └─ registry.ts           ← one entry per service
   ├─ src/pages/               sign-in, sign-up, Console Home, coming-soon, 404
   └─ src/components/ui/       design-system components
packages/
├─ shared/                     ARN helpers, AWS-style IDs, error messages, zod schemas, API types
└─ iam-engine/                 (Phase 2) pure policy parser + evaluator, no I/O
```

### 3.3 The service module contract

This is what makes "add a folder + one registry line" work.

```ts
export const stsService = defineService({
  id: "sts",
  name: "Security Token Service",
  migrations: [],                       // the service's own SQLite tables
  actions: [
    defineAction({
      name: "GetCallerIdentity",        // URL: POST /api/services/sts/GetCallerIdentity
      iamAction: "sts:GetCallerIdentity",
      authorization: "none",            // the rare actions AWS allows with no permissions
      input: z.object({}),
      resource: (input, ctx) => "*",    // the ARN this call targets
      handler: (input, { session, deps }) => ({ /* ... */ }),
    }),
  ],
});
```

Every request runs the same pipeline (`apps/server/src/core/pipeline.ts`):

```
session → validate input (zod) → resolve resource ARN
  → authorize (deps.authorizer: root allowed; IAM policy evaluation from Phase 2)
  → record event (always, including denials and invalid requests)
  → handler  |  AccessDenied
```

The authorizer is injected, so Phase 2 swaps `rootOnlyAuthorizer` for the IAM evaluator without
touching any service.

On the web side, each service adds one entry to `apps/web/src/services/registry.ts`. The entry has
`load: () => import("./sqs/routes")` for a lazy route bundle, or `status: "coming-soon"` with a
roadmap.

### 3.4 API and error shape

- `POST /api/services/{service}/{Action}` with a JSON body. Action and parameter names follow the
  AWS API reference (`QueueUrl`, `MaxNumberOfMessages`, `PolicyDocument`).
- Errors use AWS codes and wording, plus our teaching addition, `evaluation`:
  ```json
  { "code": "AccessDenied",
    "message": "User: arn:aws:iam::123456789012:user/alice is not authorized to perform: sqs:SendMessage on resource: arn:aws:sqs:us-east-1:123456789012:orders because no identity-based policy allows the sqs:SendMessage action",
    "evaluation": { "decision": "ImplicitDeny", "reason": "…", "matchedStatements": [] } }
  ```
- Sign-up, sign-in and sign-out live at `/api/auth/*`. They're console pages in AWS, not API actions.

### 3.5 Data model

All in one SQLite file. Each service owns its tables through its own migrations.

| Table | Key columns | Status |
|---|---|---|
| `accounts` | `id` (12 digits), `email`, `name`, `alias?`, `root_password_hash` | ✅ Phase 1 |
| `sessions` | `token`, `account_id`, `principal_type/name/arn/id`, `expires_at` | ✅ Phase 1 |
| `api_events` | `event_source`, `event_name`, `iam_action`, `principal_arn`, `resource_arn`, `decision`, `error_code`, `request` (JSON), `evaluation` (JSON) | ✅ Phase 1 |
| `iam_users` | `id` (`AIDA…`), `name`, `path`, `password_hash?` | Phase 2 |
| `iam_groups` / `iam_group_members` | `id` (`AGPA…`), `name`, `path` | Phase 2 |
| `iam_roles` | `id` (`AROA…`), `name`, `trust_policy` (JSON), `max_session_duration` | Phase 2 |
| `iam_policies` / `iam_policy_versions` | `id` (`ANPA…`), `arn`, `account_id?` (null = AWS managed), `version_id`, `document` | Phase 2 |
| `iam_policy_attachments` / `iam_inline_policies` | principal type + id, policy | Phase 2 |
| `sqs_queues` | `name`, `arn`, `url`, `fifo`, attributes, `redrive_policy` | Phase 3 |
| `sqs_messages` | `message_id`, `body`, `visible_at`, `receive_count`, `receipt_handle?`, `group_id?`, `dedup_id?`, `sequence_number?`, `state` | Phase 3 |

### 3.6 Security for a local server

This is still a web server on the learner's machine, so the server:

- Binds to `127.0.0.1` by default.
- Rejects requests whose `Host` isn't `localhost`, `127.0.0.1` or `[::1]`. This blocks DNS-rebinding
  attacks from malicious websites.
- Accepts only `Content-Type: application/json`, so other sites can't send simple form posts.
- Uses `HttpOnly`, `SameSite=Strict` session cookies.
- Hashes passwords with scrypt (built into Node) and never writes them to the event log.

---

## 4. Phases

Sizes are relative (S/M/L), not time estimates. Each phase has a **Done when** demo you can run.

### Phase 0 — Machine setup ✅

- [x] Node 22.13+ (LTS) and pnpm. Docker is no longer needed.
- [ ] Copy the overview doc, designer brief and setup checklist into `docs/`.
- [ ] Rename the GitHub repo away from `AWS-clone` before it's public (see §6).

### Phase 1 — Foundation (M) ✅

- [x] **1.1 Monorepo skeleton:** pnpm workspaces, shared tsconfig, Biome, Vitest.
- [x] **1.2 Server skeleton:** Hono, AWS-shaped error handler, `GET /api/health`, CLI flags
      (`--port`, `--host`, `--data-dir`).
- [x] **1.3 Database:** `node:sqlite`, migration runner (core + per-service), nested transactions.
- [x] **1.4 Root auth:** sign-up (generates a 12-digit account ID), sign-in, sign-out, sessions.
      Failed and successful sign-ins are recorded as `ConsoleLogin` events, as in CloudTrail.
- [x] **1.5 Core pipeline:** `defineService` / `defineAction`, generated routes, injectable
      authorizer, event log.
- [x] **1.6 First services:** `sts:GetCallerIdentity` and `cloudtrail:LookupEvents`.
- [x] **1.7 Web shell:** sign-in and sign-up pages, console chrome (services menu, service search,
      region, account menu, footer disclaimer), Console Home, CloudTrail event history (lazy
      bundle), coming-soon pages from the registry, mobile layout.
- [x] **1.8 CI:** lint, typecheck, test and build on Linux, macOS and Windows with Node 22 and 24.
- [x] **1.9 One-command run:** `pnpm build && pnpm start` serves everything from one process.

**Done when:** `pnpm dev` → sign up → you land on Console Home showing your account ID and your
`ConsoleLogin` event, and CI is green.

### Phase 2 — IAM (L) ← next

- [ ] **2.1 `packages/iam-engine` (test-first):**
  - Parse and validate policy JSON: `Version`, `Statement` (object or array), `Sid`, `Effect`,
    `Action` / `NotAction`, `Resource` / `NotResource`, `Condition`.
  - Wildcard matching for `*` and `?`. Actions match case-insensitively, resources case-sensitively.
  - Evaluation: explicit Deny → any Allow → otherwise implicit deny. Return the decision **and**
    the statements that matched (the trace).
  - Conditions, starting with a small subset: `StringEquals`, `StringNotEquals`, `StringLike`,
    `Bool`, `ArnLike`, and the keys `aws:username`, `aws:PrincipalArn`, `aws:CurrentTime`. Unknown
    operators fail validation loudly.
  - Design the inputs to take *several policy sets* (identity-based now, resource-based later for
    S3 bucket policies and SQS queue policies).
  - Table-driven tests built from the examples in the AWS IAM docs.
- [ ] **2.2 Tables + seed:** IAM tables from §3.5. Seed AWS-managed policies with their real JSON:
      `AdministratorAccess`, `IAMFullAccess`, `IAMReadOnlyAccess`, `AmazonSQSFullAccess`,
      `AmazonSQSReadOnlyAccess`, and a trimmed `ReadOnlyAccess` covering only the services we have.
- [ ] **2.3 IAM API:** users (with AWS's `DeleteConflict` when a user still has attachments),
      login profiles, groups and membership, roles with trust policies, `CreatePolicy`,
      `CreatePolicyVersion` (max 5), `SetDefaultPolicyVersion`, `Attach*` / `Detach*`, inline
      `Put*` / `Get*` / `Delete*`, the `List*` endpoints, and `CreateAccountAlias`.
- [ ] **2.4 IAM user sign-in:** account ID or alias + username + password (the radio button is
      already on the sign-in page).
- [ ] **2.5 Turn on enforcement:** an IAM authorizer replaces `rootOnlyAuthorizer`. Console pages
      show "You don't have permission to `iam:ListUsers`" states.
- [ ] **2.6 Switch role:** `sts:AssumeRole` checks the caller's permissions and the role's trust
      policy. The session becomes `arn:aws:sts::<acct>:assumed-role/<Role>/<session>`.
- [ ] **2.7 IAM console UI:** list and detail pages for users, groups, roles and policies, with
      tabs. Create wizards. A JSON policy editor (CodeMirror) with live validation and a readable
      summary.
- [ ] **2.8 Teaching extras:** a "Why was this denied?" drawer built from the evaluation trace, and
      a Policy Simulator page.

**Done when:** root creates user `alice` with no policies → alice signs in → listing users fails
with an accurate message → attach `IAMReadOnlyAccess` → listing works, creating still fails → add an
explicit `Deny` on `iam:ListUsers` to a group alice is in → listing fails again, even after you
attach `AdministratorAccess`.

### Phase 3 — SQS + simulator (L)

- [ ] **3.1 Queue lifecycle:** `CreateQueue` (`.fifo` suffix rule, attribute ranges), `GetQueueUrl`,
      `ListQueues`, `GetQueueAttributes`, `SetQueueAttributes`, `DeleteQueue`, `PurgeQueue`
      (60-second cooldown).
- [ ] **3.2 Messaging engine:** `SendMessage` (`DelaySeconds`, attributes, MD5), `ReceiveMessage`
      (`MaxNumberOfMessages`, `VisibilityTimeout` override, `WaitTimeSeconds` long polling),
      `DeleteMessage` by receipt handle (a new handle on every receive), `ChangeMessageVisibility`.
      `node:sqlite` is synchronous and single-process, so a receive inside one transaction is
      atomic with no row locking needed. All time comes from the injected `Clock`.
- [ ] **3.3 DLQ:** `RedrivePolicy` (`deadLetterTargetArn`, `maxReceiveCount`). Move a message to the
      DLQ when a receive would exceed the limit. FIFO ↔ FIFO only. Stretch: redrive back.
- [ ] **3.4 FIFO:** `MessageGroupId`, strict order per group, a group stays blocked while one of its
      messages is in flight, 5-minute dedup window (explicit or content-based), sequence numbers.
- [ ] **3.5 Background jobs:** a retention sweeper, plus a visibility ticker for queues someone is
      watching.
- [ ] **3.6 SQS console UI:** queue list, create-queue form with AWS's fields and defaults, detail
      tabs, and a "Send and receive messages" page.
- [ ] **3.7 Live simulator** (Server-Sent Events per queue): columns **Available → In flight
      (countdown) → Deleted**, plus a **DLQ** lane. Built-in producer and consumer controls
      (rate, processing time, failure rate, auto-delete) to demonstrate duplicate processing and
      DLQ routing. It calls the same API, so IAM still applies.

**Done when:** you can reproduce three behaviors in the simulator: (a) a consumer slower than the
visibility timeout processes a message twice, (b) a 100% failure rate pushes messages into the DLQ,
and (c) a user with `AmazonSQSReadOnlyAccess` gets `AccessDenied` on send.

### Phase 4 — Intern test, polish, guided scenarios (M)

- [ ] **4.1 Scenario engine** (format in §7.3) and 3–5 starter scenarios.
- [ ] **4.2 Intern test:** 3–5 testers, a written task list, no helping. Fix the top issues.
- [ ] **4.3 Polish:** empty, loading and error states, accessibility pass, dark mode.
- [ ] **4.4 Reset:** "Reset my account" in the UI and a `--reset` CLI flag.
- [ ] **4.5 Publish to npm:** `npx cloudlearn` opens the browser automatically. Check the bundle on
      macOS, Windows and Linux.
- [ ] **4.6 Docs for contributors:** CONTRIBUTING and "Adding a new service".

### Phase 5 — S3, then EC2 (L each)

- **S3:** buckets, objects (stored as files in the data folder), prefixes, bucket policies, and
  Block Public Access. This is the first service with **resource-based policies**.
- **EC2:** a simulated instance state machine, AMIs as a static catalog, key pairs, and security
  groups with a "can X reach Y?" checker. No real VMs.

---

## 5. Testing strategy

| Layer | Tool | What to test |
|---|---|---|
| `shared`, `iam-engine` | Vitest, table-driven | every evaluation rule; close to 100% coverage on the engine |
| Server API | Vitest + `app.request()` + in-memory SQLite + `FakeClock` | the pipeline end to end, AccessDenied paths, AWS error shapes, time-based rules |
| Web | Vitest + Testing Library | policy editor validation, simulator state |
| End to end | Playwright | each phase's **Done when** demo |

Run everything with `pnpm test`. No Docker or database setup needed.

## 6. Legal and naming checklist

- [ ] No AWS logos, service icons or console screenshots in the repo or the UI. (The icons are
      generic Lucide icons on our own colors.)
- [ ] "AWS" appears nowhere in the product name, repo name, domain or npm package name.
- [x] Footer disclaimer on every page.
- [x] Service names used descriptively ("simulates Amazon SQS").
- [x] Own visual identity: console-like layout and terminology with our own teal palette, type
      and logo.
- [ ] Pick a license before going public. `package.json` says MIT for now.

## 7. Open decisions

### 7.1 Design system — ✅ decided

Our own shadcn-style components (`apps/web/src/components/ui/`) on Radix primitives and Tailwind v4
tokens (`apps/web/src/styles.css`). The layout copies the console's *information architecture*
(top bar, services menu, search, breadcrumbs, cards, tables with detail rows). The look is our
own: a teal brand color, the CloudLearn logo, and system fonts so the app works offline.

### 7.2 Project name — decide before publishing to npm (Phase 4)

Keep `cloudlearn` as the working name. Before publishing, check that it's free on npm and GitHub
and run a basic trademark search. The npm package name matters most now, because it's what
learners will type.

### 7.3 Guided-scenario format — decide at the end of Phase 3

**Recommendation:** declarative scenario files in TypeScript, checked against the event log and
the current account state. They appear as a side panel in the console, so learners do the real
steps in the real UI.

```ts
export default defineScenario({
  id: "dlq-poison-messages",
  title: "Catch poison messages with a DLQ",
  steps: [
    { instructions: md`Create a Standard queue named **orders-dlq**.`,
      check: queueExists({ name: "orders-dlq" }) },
    { instructions: md`Create **orders** with a redrive policy, maxReceiveCount = 3.`,
      check: queueHasRedrive({ name: "orders", target: "orders-dlq", maxReceiveCount: 3 }) },
    { instructions: md`Open the simulator and set the consumer failure rate to 100%.`,
      check: eventSeen({ eventName: "MoveToDeadLetterQueue", queue: "orders" }) },
  ],
});
```

### 7.4 AWS CLI / SDK compatibility — post-v1, now more attractive

Because CloudLearn runs locally, `aws sqs send-message --endpoint-url http://localhost:4747` would
let learners practice the real CLI against their sandbox. It needs SigV4 verification, IAM access
keys and AWS's wire protocols. The internal API already uses AWS action and parameter names, so
this can be added later as an adapter.

## 8. Next steps

1. 2.1: build `packages/iam-engine` test-first.
2. 2.2–2.3: IAM tables, seeded managed policies, IAM API actions.
3. 2.4–2.5: IAM user sign-in and the IAM authorizer.
