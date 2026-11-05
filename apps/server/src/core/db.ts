import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export type Db = DatabaseSync;
export type SqlParam = SQLInputValue;

export interface Migration {
  /** Unique and stable, e.g. "core:001_accounts". Never rename one that has shipped. */
  id: string;
  sql: string;
}

export function openDatabase(file: string): Db {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return db;
}

/** Applies migrations that haven't run yet, in order. Returns the IDs it applied. */
export function runMigrations(db: Db, migrations: Migration[]): string[] {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(all<{ id: string }>(db, "SELECT id FROM _migrations").map((r) => r.id));
  const ran: string[] = [];
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    transaction(db, () => {
      db.exec(m.sql);
      run(
        db,
        "INSERT INTO _migrations (id, applied_at) VALUES (?, ?)",
        m.id,
        new Date().toISOString(),
      );
    });
    ran.push(m.id);
  }
  return ran;
}

let savepointCounter = 0;

/** Runs fn atomically. Nested calls use savepoints, so they compose safely. */
export function transaction<T>(db: Db, fn: () => T): T {
  const name = `sp_${++savepointCounter}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
    throw err;
  }
}

// Small typed helpers. node:sqlite returns plain objects; the caller states the row shape.

export function all<T>(db: Db, sql: string, ...params: SqlParam[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T>(db: Db, sql: string, ...params: SqlParam[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(db: Db, sql: string, ...params: SqlParam[]) {
  return db.prepare(sql).run(...params);
}
