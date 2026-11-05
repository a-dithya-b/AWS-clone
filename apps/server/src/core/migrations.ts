import type { Migration } from "./db";

export const coreMigrations: Migration[] = [
  {
    id: "core:001_accounts_sessions_events",
    sql: `
      CREATE TABLE accounts (
        id                 TEXT PRIMARY KEY,               -- 12-digit account ID
        email              TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name               TEXT NOT NULL,
        alias              TEXT UNIQUE,
        root_password_hash TEXT NOT NULL,
        created_at         TEXT NOT NULL
      );

      CREATE TABLE sessions (
        token          TEXT PRIMARY KEY,
        account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        principal_type TEXT NOT NULL,                      -- root | user | assumed-role
        principal_name TEXT NOT NULL,
        principal_arn  TEXT NOT NULL,
        principal_id   TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        expires_at     TEXT NOT NULL
      );

      -- A mini CloudTrail: one row per API call, denials included.
      CREATE TABLE api_events (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id      TEXT NOT NULL UNIQUE,
        account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        event_time    TEXT NOT NULL,
        event_source  TEXT NOT NULL,                       -- e.g. sqs.amazonaws.com
        event_name    TEXT NOT NULL,                       -- e.g. SendMessage
        iam_action    TEXT NOT NULL,                       -- e.g. sqs:SendMessage
        principal_arn TEXT,
        principal_type TEXT,
        resource_arn  TEXT,
        decision      TEXT NOT NULL,                       -- Allow | ExplicitDeny | ImplicitDeny
        error_code    TEXT,
        error_message TEXT,
        request       TEXT,                                -- JSON
        evaluation    TEXT                                 -- JSON
      );
      CREATE INDEX api_events_account_time ON api_events(account_id, id DESC);
    `,
  },
  {
    id: "core:002_role_sessions",
    sql: `
      -- Switched-role sessions remember the role and the session to return to ("Switch back").
      ALTER TABLE sessions ADD COLUMN role_id TEXT;
      ALTER TABLE sessions ADD COLUMN parent_token TEXT;
      CREATE INDEX sessions_principal ON sessions(principal_id);
      CREATE INDEX sessions_role ON sessions(role_id);
    `,
  },
];
