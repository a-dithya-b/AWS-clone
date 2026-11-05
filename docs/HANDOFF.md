# Handoff: where the build stands and how to continue

> For whoever picks this up next (a future Claude session or a person). Read this first, then
> `docs/PLAN.md` (the plan) and `README.md` (how to run). Update this file when you stop again.

**Last updated:** 2026-11-05 · **Branch:** `claude/clever-ramanujan-52grdi`

## 1. Status at a glance

| Phase | Server | Web UI | Notes |
|---|---|---|---|
| 1. Foundation | ✅ done | ✅ done | Sign-up/sign-in, console shell, CloudTrail event history |
| 2. IAM | ✅ done, 42 tests | 🟡 built; main flow passed in a browser, several pages never clicked (see §4) | Policy engine in `packages/iam-engine` (202 tests) |
| 3. SQS + simulator | ✅ done, 27 tests | ❌ not started | API + SSE stream + snapshot action ready for the UI |
| 4. Scenarios, polish, packaging | ❌ not started | ❌ not started | Design in §5 |
| 5. S3, then EC2 | 🟡 core hooks only | ❌ | Designs in §6 |

Test totals at handoff: shared 6, iam-engine 202, server 69. All passing.

## 2. Resume checklist

1. `git checkout claude/clever-ramanujan-52grdi && git pull`
2. `pnpm install` (Node ≥ 22.13; pnpm via `corepack enable pnpm` or `npm i -g pnpm`)
3. Check the baseline is green: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
4. Run it: `pnpm dev` (UI on :5173, API on :4747, dev data in `./.data/`) or `pnpm start` after a build.
5. Pick up the first unchecked item in §4, then §5 and §6, in order.

Before every commit, run `pnpm lint && pnpm typecheck && pnpm test`. Don't chain `pnpm lint | tail`
with `;` before `git commit`: that once let a failing lint through.

## 3. Architecture in one screen (read the code for details)

- **Service module contract:** `apps/server/src/core/service.ts`. A service is
  `defineService({ id, name, migrations, actions, seed?, start?, routes?, resetAccount?, validationErrorCode?, accessDeniedCode?, accessDeniedPrefix? })`.
  Each action is `defineAction({ name, iamAction, accessLevel, input (zod), resource?, resourceAccount?, resourcePolicies?, conditionKeys?, dataEvent?, record?, authorization?, handler })`.
  Register it in `apps/server/src/services/registry.ts` (server) and `apps/web/src/services/registry.ts` (web).
- **Pipeline:** `apps/server/src/core/pipeline.ts` handles `POST /api/services/:service/:action`
  in this order: session → zod → resource ARN → `deps.authorizer.authorize` → `recordEvent` → handler.
  AWS-style errors come from `AwsError` (`core/errors.ts`).
- **Authorizer:** `apps/server/src/services/iam/authorizer.ts`.
  - Root is always allowed in its own account, except for a resource-policy Deny.
  - Users and roles go through `@cloudlearn/iam-engine`.
  - Cross-account requests need an Allow from both the identity side and the resource policy.
  - `identityOnly` exists for AssumeRole, which checks the trust policy separately.
- **Auth routes** (console, not API): `apps/server/src/core/auth-routes.ts` handles root and IAM
  sign-in, `switch-role`, `switch-back`, `signout` and `session`.
- **Event log** (mini CloudTrail): `core/events.ts`.
  - Events are either `Management` or `Data` (data events are opt-in via `IncludeDataEvents`).
  - It's pruned to 20k events per account.
- **Live updates:** `core/event-bus.ts` is an in-process pub/sub. SQS publishes to topic = queue ARN.
  `GET /api/x/sqs/stream?queueUrl=` streams those events over SSE.
- **Database:** `node:sqlite`, one file at `~/.cloudlearn/cloudlearn.db`. Migrations are per service
  (`core/migrations.ts` + each service's `migrations.ts`). Never edit a migration that has shipped:
  add a new one.
- **Tests:** `apps/server/test/helpers.ts` gives you `createTestApp()` (in-memory DB, `FakeClock`,
  temp data dir) and `t.client()`, which gives each signed-in identity its own cookies.
  SQS time-based behavior is tested by calling `tick()` after `t.clock.advance()`.

## 4. Phase 2 (IAM): finish verifying the web UI

A subagent built the IAM console UI. **This main flow passed in a browser:** sign up → create
`alice` with the wizard (password plus IAMReadOnlyAccess) → create role `Admin` trusting alice →
the policy editor flags `"Action": "ListUsers"` → the simulator returns allowed and implicitDeny →
sign in as alice → list works, create is denied with the "Why?" dialog → switch to Admin → create
works → switch back. No console errors.

**To do, in order:**
1. **Re-test phone width.** `/iam/users/alice` and `/iam/roles/Admin` scrolled sideways by 130px.
   The fix (adding `relative` to the `overflow-x-auto` table wrappers) was applied but not
   re-tested. Rebuild, *restart the server*, and check every IAM page at 390px.
2. **Click through what was never tested in a browser:**
   - Dashboard: alias create/edit/delete.
   - Users: bulk delete, and the delete confirmation on user detail.
   - User detail: Groups tab add/remove, Security credentials enable/reset/disable.
   - Add permissions dialog (both tabs), create/edit inline policy, view an inherited group
     inline policy, Remove.
   - Groups: list, create and detail (none of these pages were opened).
   - Roles: delete, "This account" and custom trust options, edit trust policy.
   - Policies: Entities attach/detach, Versions set-default/delete, the Edit dialog, Delete.
   - Simulator: custom-policy mode.
   - Switch role: display name, and cross-account (two accounts on one machine).
   - Sign-in: the remembered account.
3. **Known small issues:**
   - Read-only actions (simulator, viewing an inline policy) refresh all IAM queries; scope the
     invalidation.
   - Right after deleting an entity from its own page, it may flash "NoSuchEntity" before
     navigating away.
   - The create-user wizard has no "require password reset" option, and the server stores but
     doesn't enforce `password_reset_required`.
4. Add these flows to a Playwright e2e suite in the repo, then tick Phase 2 in `docs/PLAN.md`.

The subagent's screenshots were in the scratchpad and won't survive the session. Take new ones.

Files from that work:
- `apps/web/src/services/iam/**`
- `components/{DataTable,ApiErrorAlert,EvaluationExplainer,PolicyEditor,PolicySummary,ConfirmDialog}.tsx`
- `components/ui/{dialog,tabs,controls}.tsx`
- `shell/ServiceLayout.tsx`
- `pages/SwitchRolePage.tsx`
- `lib/catalog.ts`
- edits to sign-in, the account menu and Console Home

The SQS, S3 and EC2 UIs should reuse these generic pieces.

## 5. Phase 3 (SQS): web UI and live simulator

The server is complete (`apps/server/src/services/sqs/`). Build `apps/web/src/services/sqs/` and
register it as available in the web registry.

- **Queues list:** `ListQueues`, then `GetQueueAttributes` per queue. Show type, available,
  in flight, delayed, and the DLQ.
- **Create queue form:** mirror AWS's fields and defaults.
  - Standard/FIFO toggle; a FIFO name must end in `.fifo`.
  - Visibility timeout 30s, retention 4d, delay 0, max size 256 KiB, receive wait 0,
    content-based dedup.
  - Dead-letter queue picker plus maxReceiveCount; RedriveAllowPolicy.
  - Access policy, using `PolicyEditor` with kind `resource`.
- **Queue detail tabs:** Details, Dead-letter queue, Access policy, Tags, Redrive (on DLQs:
  `StartMessageMoveTask` plus `ListMessageMoveTasks`). Actions: Purge (60s cooldown error), Delete.
- **Send and receive page** (the console has one): send with group/dedup IDs and attributes; poll
  with `ReceiveMessage` (`AttributeNames: ["All"]`, `MessageAttributeNames: ["All"]`); delete; change
  visibility. Show the server's `CloudLearnNote` when deleting with a stale receipt handle.
- **Live simulator:** the headline feature.
  - Load the initial state with `api.action("sqs","SimulatorSnapshot",{QueueUrl})`. It returns
    `ServerTime`, `Queue`, `Messages[]` (State available/inflight/delayed, VisibleAt, ExpiresAt,
    ReceiveCount, GroupId…) and the `DeadLetterQueue` with its messages.
  - Get live updates from `new EventSource("/api/x/sqs/stream?queueUrl=" + encodeURIComponent(url))`.
    Event names: `hello` (has serverTime, for clock offset), `sent`, `deduplicated`, `received`,
    `deleted`, `stale_delete`, `visible`, `delay_ended`, `visibility_changed`, `moved_to_dlq`,
    `redriven`, `expired`, `purged`, `attributes_changed`, `queue_deleted`, `ping`. The payload is
    `{topic, type, at, data: {queueArn, message?: MessageView, …}}`.
  - Lanes: **Available → In flight** (a countdown bar to VisibleAt, using the server-time offset)
    **→ Deleted** (recent), plus **Delayed** and a **DLQ** lane.
  - **Producer controls** run in the browser and call the real API, so IAM still applies:
    send N, or send at a rate.
  - **Consumer controls:** poll rate, processing time, failure rate, visibility-timeout override.
    A "processed twice" badge should appear when ReceiveCount > 1.
  - Callouts that teach the two lessons:
    1. processing that takes longer than the visibility timeout gets processed twice;
    2. failing more than maxReceiveCount times sends the message to the DLQ.
- Console Home learning path: mark SQS available.
- **Done when** (from PLAN): in the simulator you can show (a) duplicate processing, (b) a 100%
  failure rate filling the DLQ, and (c) `AmazonSQSReadOnlyAccess` denied on send.

## 6. Phase 5 (S3, then EC2): server designs, ready to implement

Core hooks are already in place:
- `ActionDef.resourceAccount`, because S3 ARNs have no account ID and cross-account rules need the
  bucket owner.
- `ServiceModule.accessDeniedCode` and `accessDeniedPrefix`. For EC2, set
  `"UnauthorizedOperation"` and `"You are not authorized to perform this operation. "`.
- `deps.dataDir`, for object bodies on disk. Tests get a temp dir.
- `deps.bus`.

### S3 (`apps/server/src/services/s3/`)

- **Tables:**
  - `s3_buckets`: name is the PK and **globally unique across accounts** (a lesson in itself).
    Columns: account_id, created_at, versioning (`Disabled|Enabled|Suspended`), policy JSON,
    public_access_block JSON (all four flags default **true**), tags JSON.
  - `s3_objects`: bucket, key, version_id, is_latest, is_delete_marker, size, etag (quoted md5),
    content_type, metadata JSON, last_modified, storage path under `dataDir/s3/`.
    Cap objects at 10 MB.
- **Actions → IAM actions:**
  - Buckets: CreateBucket→s3:CreateBucket, ListBuckets→s3:ListAllMyBuckets,
    HeadBucket/ListObjectsV2→s3:ListBucket, DeleteBucket (`BucketNotEmpty`),
    GetBucketLocation.
  - Policies and settings: Put/Get/DeleteBucketPolicy, GetBucketPolicyStatus,
    Put/Get/DeletePublicAccessBlock→s3:Put/GetBucketPublicAccessBlock,
    Put/GetBucketVersioning, Put/Get/DeleteBucketTagging.
  - Objects: PutObject, GetObject (`s3:GetObjectVersion` when VersionId is given), HeadObject,
    DeleteObject (a delete marker when versioning is on), DeleteObjects, ListObjectVersions→
    s3:ListBucketVersions, CopyObject.
  - ARNs: `arn:aws:s3:::bucket` and `arn:aws:s3:::bucket/key`. Bucket policy as
    `resourcePolicies`; bucket owner as `resourceAccount`.
- **Errors:** `NoSuchBucket` 404, `BucketAlreadyExists` 409 (another account owns it; AWS's
  "namespace is shared" wording), `BucketAlreadyOwnedByYou`, `BucketNotEmpty`, `NoSuchKey`,
  `InvalidBucketName` (3–63 chars, lowercase, no IP-like names, no `xn--`, no `..`),
  `NoSuchBucketPolicy`, `MalformedPolicy`.
- **Block Public Access:**
  - PutBucketPolicy with a public policy is AccessDenied when BlockPublicPolicy is on. A policy is
    public when it has an Allow with Principal `*` and no condition.
  - RestrictPublicBuckets blocks anonymous access.
- **Anonymous public URL:** `GET /api/x/s3/public/:bucket/*` with no session. Evaluate the bucket
  policy for principal `*`. This drives the lesson "make a bucket public, then lock it down".
- **Uploads:** raw upload and download routes under `/api/x/s3/` (authorized as
  s3:PutObject/GetObject), so files don't go through base64 JSON.

### EC2 (`apps/server/src/services/ec2/`)

Nothing real runs; everything is a simulation.

- **Tables:** instances, security groups, key pairs, and a default VPC with subnets per AZ
  (us-east-1a…f) created on first use per account.
- **Static catalogs:** AMIs (generic Linux/Windows images) and instance types (vCPU and memory).
- **IDs:** `i-` + 17 hex characters, `sg-`, `vpc-`, `subnet-`, `key-`.
- **Ticker state machine:** pending → running (~5s), stopping → stopped,
  shutting-down → terminated. Terminated instances are hidden after 1h. Use `start()` like SQS.
- **Actions:** DescribeImages, DescribeInstanceTypes, RunInstances (limit 20 → `InstanceLimitExceeded`),
  DescribeInstances, Start/Stop/Reboot/TerminateInstances (`IncorrectInstanceState`),
  ModifyInstanceAttribute DisableApiTermination (termination protection → `OperationNotPermitted`),
  Create/Describe/DeleteSecurityGroup (`DependencyViolation` while in use),
  Authorize/RevokeSecurityGroupIngress/Egress (`InvalidPermission.Duplicate`),
  Create/Describe/DeleteKeyPair (real PEM keys from `node:crypto`, private key shown once),
  DescribeVpcs, DescribeSubnets, DescribeAvailabilityZones, CreateTags/DeleteTags.
- **CloudLearn extra:** `CheckNetworkReachability` {InstanceId, Port, Protocol, SourceCidr}. It's
  authorized as ec2:DescribeSecurityGroups and explains which security-group rule allows the
  traffic, or why nothing does.
- Then the EC2 web UI: launch wizard, instances table with state badges, security group rule
  editor, reachability checker.

## 7. Phase 4: scenarios, reset, polish, packaging

- **Reset / delete account:**
  - `POST /api/auth/reset-account` (root only, body `{confirm: accountId}`) calls every
    `service.resetAccount`. **IAM has no `resetAccount` yet; add it.** It should delete IAM rows,
    clear the alias, delete api_events and non-root sessions.
  - Add a "Delete account" option too.
  - Add a UI in the account menu or IAM dashboard.
- **Scenario engine** (decision in PLAN §7.3; use data-driven checks so they serialize):
  - Definitions live in `packages/shared/src/scenarios/*.ts`: `{id, title, summary, level,
    services, minutes, steps: [{title, instructions (simple markdown), hint?, check: CheckSpec}]}`.
  - CheckSpec types:
    - IAM: `iamUserExists`, `iamUserHasLoginProfile`, `iamUserHasPolicy{policyName, via}`,
      `iamGroupHasPolicy`, `iamGroupHasMembers`, `iamRoleExists`, `iamRoleHasPolicy`.
    - `decision` runs the engine for any user, e.g. ExplicitDeny for an action.
    - `eventSeen{eventName, errorCode|null, principalType?, username?}`, since the scenario started.
    - SQS: `sqsQueueExists{fifo?, maxVisibilityTimeout?, hasRedrivePolicy?}`.
    - `observed{kind}`, backed by a new `observations(account_id, kind, at)` table that the SQS
      engine writes: `sqs.redelivered`, `sqs.moved_to_dlq`, `sqs.stale_delete`, `sqs.redriven`.
  - Server: `apps/server/src/scenarios/` with a `scenario_progress` table and
    `GET /api/scenarios`, `POST /api/scenarios/:id/start`, `GET /api/scenarios/:id` (evaluates
    checks), `POST /api/scenarios/:id/reset`.
  - Web: a scenarios page plus a side panel in the console showing the current step.
  - Starter scenarios:
    1. Your first IAM user.
    2. Explicit deny wins.
    3. Least privilege with a role (switch role, then create a queue).
    4. The visibility timeout race.
    5. Catch poison messages with a DLQ.
    6. (S3) Make a bucket public, then lock it down.
- **Packaging (`npx cloudlearn`):**
  - Rename `apps/server`'s package to `cloudlearn` (update the `--filter` uses in the root
    `package.json`).
  - Add `"bin": {"cloudlearn": "dist/index.mjs"}`, a shebang banner in `tsdown.config.ts`, and
    `files: ["dist"]`. Keep `private: true` until the name is checked on npm.
  - Add `--open`/`--no-open` (open the browser with `open`, `start` or `xdg-open`).
  - Test with `npm pack` and `npm exec --package ./cloudlearn-*.tgz cloudlearn`.
- **Polish:** dark mode (tokens are already in `styles.css`), empty and loading states, an
  accessibility pass, and a Playwright e2e suite in the repo (`e2e/`) that turns each phase's
  "Done when" into a test.
- **Docs:** CONTRIBUTING.md and "Adding a new service" (walk through the contract in §3), then
  update PLAN.md checkboxes and the README status.

## 8. Gotchas learned the hard way

- **Biome `--write` rewrites code.** It turned `new RegExp("…")` back into a regex literal. Re-run
  `typecheck` after any Biome write. The SQS control-character regex carries a `biome-ignore` on
  purpose.
- **TypeScript 7** (`tsc` is the native port) is strict about regex literals and gave TS1516 once.
- **Trust policies have no `Resource`.** The engine's `evaluate()` skips resource-based statements
  without one, so AssumeRole uses `evaluateTrustPolicy` plus `identityOnly: true`.
- **Testing SSE:** the shared `client().call` helper reads the whole body and hangs on a stream.
  Read the stream incrementally, as in the SSE test in `test/sqs.test.ts`.
- **Restart after rebuilding:** the production server reads `index.html` once at startup, so
  restart it after `pnpm build` or asset hashes 404.
- **SQLite warning:** `node:sqlite` prints an ExperimentalWarning, which is silenced in
  `core/warnings.ts`. It must run before node:sqlite loads, which is why `index.ts` dynamically
  imports `main.ts`.
- **Subagents:** when running them in parallel, give each strict file ownership (e.g. "only
  apps/web"), forbid `pnpm install` and commits, and use a different port (4800) for their e2e
  server.
- **Don't** use the AWS logo or "AWS" in the product name, and keep the footer disclaimer.
