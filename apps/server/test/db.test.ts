import { describe, expect, it } from "vitest";
import { all, openDatabase, run, runMigrations, transaction } from "../src/core/db";

describe("database helpers", () => {
  it("applies each migration once", () => {
    const db = openDatabase(":memory:");
    const migrations = [{ id: "t:001", sql: "CREATE TABLE t (x INTEGER)" }];
    expect(runMigrations(db, migrations)).toEqual(["t:001"]);
    expect(runMigrations(db, migrations)).toEqual([]);
  });

  it("rolls back a failed transaction, including nested ones", () => {
    const db = openDatabase(":memory:");
    db.exec("CREATE TABLE t (x INTEGER)");
    expect(() =>
      transaction(db, () => {
        run(db, "INSERT INTO t VALUES (1)");
        transaction(db, () => run(db, "INSERT INTO t VALUES (2)"));
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(all(db, "SELECT * FROM t")).toEqual([]);
  });
});
