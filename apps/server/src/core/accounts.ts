import { generateAccountId } from "@cloudlearn/shared";
import { type Db, get, run } from "./db";

export interface Account {
  id: string;
  email: string;
  name: string;
  alias: string | null;
  rootPasswordHash: string;
  createdAt: string;
}

interface AccountRow {
  id: string;
  email: string;
  name: string;
  alias: string | null;
  root_password_hash: string;
  created_at: string;
}

const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  email: r.email,
  name: r.name,
  alias: r.alias,
  rootPasswordHash: r.root_password_hash,
  createdAt: r.created_at,
});

export function findAccountByEmail(db: Db, email: string): Account | undefined {
  const row = get<AccountRow>(db, "SELECT * FROM accounts WHERE email = ?", email);
  return row && toAccount(row);
}

export function findAccountById(db: Db, id: string): Account | undefined {
  const row = get<AccountRow>(db, "SELECT * FROM accounts WHERE id = ?", id);
  return row && toAccount(row);
}

export function createAccount(
  db: Db,
  input: { email: string; name: string; rootPasswordHash: string; now: Date },
): Account {
  // Account IDs are random; retry on the (very unlikely) collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = generateAccountId();
    if (findAccountById(db, id)) continue;
    run(
      db,
      "INSERT INTO accounts (id, email, name, root_password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
      id,
      input.email,
      input.name,
      input.rootPasswordHash,
      input.now.toISOString(),
    );
    return findAccountById(db, id) as Account;
  }
  throw new Error("Could not allocate an account ID");
}
