import { generateToken, type Principal, type SessionInfo } from "@cloudlearn/shared";
import { findAccountById } from "./accounts";
import type { Clock } from "./clock";
import { type Db, get, run } from "./db";

export const SESSION_COOKIE = "cloudlearn_session";
/** Local app, so sessions last a while. AWS console sessions are shorter. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface Session extends SessionInfo {
  token: string;
  /** For switched-role sessions: the IAM role's unique ID. */
  roleId: string | null;
  /** For switched-role sessions: the session to return to. */
  parentToken: string | null;
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
  role_id: string | null;
  parent_token: string | null;
}

export interface CreateSessionOptions {
  ttlMs?: number;
  roleId?: string;
  parentToken?: string;
}

export function createSession(
  db: Db,
  clock: Clock,
  accountId: string,
  principal: Principal,
  opts: CreateSessionOptions = {},
): Session {
  const now = clock.now();
  const token = generateToken();
  run(
    db,
    `INSERT INTO sessions (token, account_id, principal_type, principal_name, principal_arn,
       principal_id, created_at, expires_at, role_id, parent_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    token,
    accountId,
    principal.type,
    principal.name,
    principal.arn,
    principal.id,
    now.toISOString(),
    new Date(now.getTime() + (opts.ttlMs ?? SESSION_TTL_MS)).toISOString(),
    opts.roleId ?? null,
    opts.parentToken ?? null,
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

  let switchedFrom: SessionInfo["switchedFrom"];
  if (row.parent_token) {
    const parent = get<SessionRow>(db, "SELECT * FROM sessions WHERE token = ?", row.parent_token);
    if (parent) {
      switchedFrom = {
        principalName: parent.principal_name,
        principalArn: parent.principal_arn,
        accountId: parent.account_id,
      };
    }
  }

  return {
    token: row.token,
    expiresAt: row.expires_at,
    roleId: row.role_id,
    parentToken: row.parent_token,
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
    ...(switchedFrom ? { switchedFrom } : {}),
  };
}

export function deleteSession(db: Db, token: string) {
  run(db, "DELETE FROM sessions WHERE token = ?", token);
}

/** Ends every session of a principal, e.g. when its IAM user is deleted. */
export function deleteSessionsForPrincipal(db: Db, principalId: string) {
  run(db, "DELETE FROM sessions WHERE principal_id = ? OR role_id = ?", principalId, principalId);
}

/** The public view of a session: everything except the secret token and internal IDs. */
export function toSessionInfo(session: Session): SessionInfo {
  const { token: _token, roleId: _roleId, parentToken: _parentToken, ...info } = session;
  return info;
}
