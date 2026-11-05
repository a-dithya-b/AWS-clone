import type { Migration } from "../../core/db";

export const iamMigrations: Migration[] = [
  {
    id: "iam:001_entities",
    sql: `
      -- IAM names are unique per account, ignoring case, like in AWS.
      CREATE TABLE iam_users (
        id                 TEXT PRIMARY KEY,               -- AIDA…
        account_id         TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name               TEXT NOT NULL COLLATE NOCASE,
        path               TEXT NOT NULL DEFAULT '/',
        arn                TEXT NOT NULL,
        password_hash      TEXT,                           -- null = no console access
        password_reset_required INTEGER NOT NULL DEFAULT 0,
        password_last_used TEXT,
        created_at         TEXT NOT NULL,
        UNIQUE (account_id, name)
      );

      CREATE TABLE iam_groups (
        id         TEXT PRIMARY KEY,                       -- AGPA…
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name       TEXT NOT NULL COLLATE NOCASE,
        path       TEXT NOT NULL DEFAULT '/',
        arn        TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (account_id, name)
      );

      CREATE TABLE iam_group_members (
        group_id TEXT NOT NULL REFERENCES iam_groups(id) ON DELETE CASCADE,
        user_id  TEXT NOT NULL REFERENCES iam_users(id) ON DELETE CASCADE,
        added_at TEXT NOT NULL,
        PRIMARY KEY (group_id, user_id)
      );

      CREATE TABLE iam_roles (
        id                   TEXT PRIMARY KEY,             -- AROA…
        account_id           TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name                 TEXT NOT NULL COLLATE NOCASE,
        path                 TEXT NOT NULL DEFAULT '/',
        arn                  TEXT NOT NULL,
        description          TEXT,
        trust_policy         TEXT NOT NULL,                -- JSON
        max_session_duration INTEGER NOT NULL DEFAULT 3600,
        last_used_at         TEXT,
        created_at           TEXT NOT NULL,
        UNIQUE (account_id, name)
      );

      -- Managed policies. account_id is NULL for AWS-managed policies, shared by every account.
      CREATE TABLE iam_policies (
        id                 TEXT PRIMARY KEY,               -- ANPA…
        account_id         TEXT REFERENCES accounts(id) ON DELETE CASCADE,
        name               TEXT NOT NULL COLLATE NOCASE,
        path               TEXT NOT NULL DEFAULT '/',
        arn                TEXT NOT NULL UNIQUE,
        description        TEXT,
        default_version_id TEXT NOT NULL,
        next_version       INTEGER NOT NULL DEFAULT 2,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
      CREATE UNIQUE INDEX iam_policies_name ON iam_policies(IFNULL(account_id, 'aws'), name);

      CREATE TABLE iam_policy_versions (
        policy_id  TEXT NOT NULL REFERENCES iam_policies(id) ON DELETE CASCADE,
        version_id TEXT NOT NULL,                          -- v1, v2, …
        document   TEXT NOT NULL,                          -- JSON
        created_at TEXT NOT NULL,
        PRIMARY KEY (policy_id, version_id)
      );

      CREATE TABLE iam_policy_attachments (
        policy_id      TEXT NOT NULL REFERENCES iam_policies(id) ON DELETE CASCADE,
        account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        principal_type TEXT NOT NULL,                      -- user | group | role
        principal_id   TEXT NOT NULL,
        attached_at    TEXT NOT NULL,
        PRIMARY KEY (policy_id, principal_type, principal_id)
      );
      CREATE INDEX iam_policy_attachments_principal ON iam_policy_attachments(principal_type, principal_id);

      CREATE TABLE iam_inline_policies (
        account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        principal_type TEXT NOT NULL,                      -- user | group | role
        principal_id   TEXT NOT NULL,
        name           TEXT NOT NULL COLLATE NOCASE,
        document       TEXT NOT NULL,                      -- JSON
        created_at     TEXT NOT NULL,
        PRIMARY KEY (principal_type, principal_id, name)
      );
    `,
  },
];
