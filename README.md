# CloudLearn (working name)

A free, open-source AWS learning simulator that runs on your own laptop. Services such as IAM and
SQS are mocked by backend logic, so you can learn hands-on with no AWS account, no credit card, and
no surprise bills. A missing permission gives a real `AccessDenied`, and every API call shows up in
an activity log that explains why it was allowed or denied.

> CloudLearn is an independent educational project and is not affiliated with, endorsed by, or
> sponsored by Amazon Web Services.

**Status:** Phase 1 (foundation) is done: sign-up, sign-in, the console shell, and a CloudTrail-style
event history. IAM is next. See the [build plan](docs/PLAN.md).

## Run it

You need [Node.js](https://nodejs.org) 22.13 or newer and [pnpm](https://pnpm.io)
(`npm install -g pnpm`). Nothing else: no Docker, no database server.

```bash
pnpm install
```

```bash
pnpm build
```

```bash
pnpm start
```

Then open http://localhost:4747. Your data is stored in `~/.cloudlearn/`. Run
`pnpm start --help` for options such as `--port` and `--data-dir`.

## Develop

```bash
pnpm dev
```

This starts the API server on port 4747 (restarts on changes) and Vite on port 5173 (hot reload).
Open http://localhost:5173. Dev data goes in `./.data/`, separate from your real sandbox.

| Command | What it does |
|---|---|
| `pnpm test` | Run all tests (in-memory database, no setup) |
| `pnpm typecheck` | Type-check every package |
| `pnpm lint` | Lint and format-check with Biome (`pnpm format` fixes) |
| `pnpm build` | Build the web app and bundle the server into `apps/server/dist` |

## How it's organized

```
apps/server      Hono API on Node's built-in SQLite. Each AWS service is a module in src/services/.
apps/web         React console. Each service is a lazy-loaded bundle in src/services/.
packages/shared  ARNs, AWS-style IDs, error messages and types used by both sides.
```

Every API call goes through one pipeline: session → validate → authorize → record → handler. Adding
a service means adding a folder and one line in each registry. See
[docs/PLAN.md §3](docs/PLAN.md#3-architecture).
