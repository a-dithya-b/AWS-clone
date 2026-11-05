import { generateToken, type Principal, type SessionInfo } from "@cloudlearn/shared";
import { findAccountById } from "./accounts";
import type { Clock } from "./clock";
import { type Db, get, run } from "./db";

export const SESSION_COOKIE = "cloudlearn_session";
/** Local app, so sessions last a while. AWS console sessions are shorter. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface Session extends SessionInfo {
  token: string;
  expiresAt: string;
}

interface SessionRow {
  token: string;
  account_id: string;
  principal_type: Principal["type"];
  principal_name: string;
  principal_arn: string;
  principal_id: string;
  created_at: string;
  expires_at: string;
}

export function createSession(
  db: Db,
  clock: Clock,
  accountId: string,
  principal: Principal,
): Session {
  const now = clock.now();
  const token = generateToken();
  run(
    db,
    `INSERT INTO sessions (token, account_id, principal_type, principal_name, principal_arn,
       principal_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    token,
    accountId,
    principal.type,
    principal.name,
    principal.arn,
    principal.id,
    now.toISOString(),
    new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  );
  return findSession(db, clock, token) as Session;
}

export function findSession(db: Db, clock: Clock, token: string): Session | undefined {
  const row = get<SessionRow>(db, "SELECT * FROM sessions WHERE token = ?", token);
  if (!row) return undefined;
  if (new Date(row.expires_at) <= clock.now()) {
    deleteSession(db, token);
    return undefined;
  }
  const account = findAccountById(db, row.account_id);
  if (!account) return undefined;
  return {
    token: row.token,
    expiresAt: row.expires_at,
    accountId: account.id,
    accountName: account.name,
    accountAlias: account.alias,
    signedInAt: row.created_at,
    principal: {
      type: row.principal_type,
      name: row.principal_name,
      arn: row.principal_arn,
      id: row.principal_id,
    },
  };
}

export function deleteSession(db: Db, token: string) {
  run(db, "DELETE FROM sessions WHERE token = ?", token);
}

/** The public view of a session: everything except the secret token. */
export function toSessionInfo(session: Session): SessionInfo {
  const { token: _token, expiresAt: _expiresAt, ...info } = session;
  return info;
}
