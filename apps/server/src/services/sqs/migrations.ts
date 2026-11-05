import type { Migration } from "../../core/db";

export const sqsMigrations: Migration[] = [
  {
    id: "sqs:001_queues_messages",
    sql: `
      CREATE TABLE sqs_queues (
        id                       TEXT PRIMARY KEY,
        account_id               TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name                     TEXT NOT NULL,              -- queue names are case-sensitive
        arn                      TEXT NOT NULL UNIQUE,
        url                      TEXT NOT NULL UNIQUE,
        fifo                     INTEGER NOT NULL DEFAULT 0,
        visibility_timeout       INTEGER NOT NULL DEFAULT 30,
        message_retention_period INTEGER NOT NULL DEFAULT 345600,
        delay_seconds            INTEGER NOT NULL DEFAULT 0,
        receive_wait_time        INTEGER NOT NULL DEFAULT 0,
        maximum_message_size     INTEGER NOT NULL DEFAULT 262144,
        content_based_dedup      INTEGER NOT NULL DEFAULT 0,
        redrive_policy           TEXT,                       -- JSON {deadLetterTargetArn, maxReceiveCount}
        redrive_allow_policy     TEXT,                       -- JSON
        policy                   TEXT,                       -- JSON queue (resource-based) policy
        extra_attributes         TEXT NOT NULL DEFAULT '{}', -- accepted but not simulated (e.g. KMS)
        tags                     TEXT NOT NULL DEFAULT '{}',
        next_sequence            INTEGER NOT NULL DEFAULT 1,
        last_purged_at           INTEGER,                    -- epoch ms
        created_at               INTEGER NOT NULL,
        last_modified_at         INTEGER NOT NULL,
        UNIQUE (account_id, name)
      );

      -- Times are epoch milliseconds so the visibility math is simple integer comparisons.
      CREATE TABLE sqs_messages (
        seq               INTEGER PRIMARY KEY AUTOINCREMENT, -- arrival order
        message_id        TEXT NOT NULL UNIQUE,
        queue_id          TEXT NOT NULL REFERENCES sqs_queues(id) ON DELETE CASCADE,
        body              TEXT NOT NULL,
        md5_body          TEXT NOT NULL,
        message_attributes TEXT,                             -- JSON
        md5_attributes    TEXT,
        sender_id         TEXT NOT NULL,
        sent_at           INTEGER NOT NULL,
        visible_at        INTEGER NOT NULL,                  -- > now: delayed or in flight
        expires_at        INTEGER NOT NULL,                  -- retention period ends
        receive_count     INTEGER NOT NULL DEFAULT 0,
        first_received_at INTEGER,
        receipt_handle    TEXT,                              -- latest handle; null before first receive
        group_id          TEXT,
        dedup_id          TEXT,
        sequence_number   TEXT,
        dlq_source_arn    TEXT                               -- set when moved to a dead-letter queue
      );
      CREATE INDEX sqs_messages_queue_visible ON sqs_messages(queue_id, visible_at, seq);
      CREATE INDEX sqs_messages_expires ON sqs_messages(expires_at);
      CREATE INDEX sqs_messages_visible ON sqs_messages(visible_at);

      -- FIFO deduplication: the same MessageDeduplicationId within 5 minutes is accepted but dropped.
      CREATE TABLE sqs_dedup (
        queue_id        TEXT NOT NULL REFERENCES sqs_queues(id) ON DELETE CASCADE,
        dedup_id        TEXT NOT NULL,
        message_id      TEXT NOT NULL,
        sequence_number TEXT,
        expires_at      INTEGER NOT NULL,
        PRIMARY KEY (queue_id, dedup_id)
      );

      -- AWS makes you wait 60 seconds before reusing a deleted queue's name.
      CREATE TABLE sqs_deleted_queues (
        account_id TEXT NOT NULL,
        name       TEXT NOT NULL,
        deleted_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, name)
      );

      -- DLQ redrive tasks (StartMessageMoveTask).
      CREATE TABLE sqs_move_tasks (
        task_handle     TEXT PRIMARY KEY,
        account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        source_arn      TEXT NOT NULL,
        destination_arn TEXT,
        status          TEXT NOT NULL,
        moved           INTEGER NOT NULL,
        to_move         INTEGER NOT NULL,
        started_at      INTEGER NOT NULL
      );
    `,
  },
];
