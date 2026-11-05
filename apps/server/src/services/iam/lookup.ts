import { rootArn } from "@cloudlearn/shared";
import type { RequestContext } from "../../core/service";
import { noSuchEntity } from "./common";
import {
  findGroup,
  findPolicy,
  findRole,
  findUser,
  type IamGroup,
  type IamRole,
  type IamUser,
  iamArn,
  type ManagedPolicy,
} from "./repo";

// Look up entities in the caller's account, throwing NoSuchEntity with AWS's wording.

export function requireUser(ctx: RequestContext, name: string): IamUser {
  const user = findUser(ctx.deps.db, ctx.session.accountId, name);
  if (!user) throw noSuchEntity(`The user with name ${name} cannot be found.`);
  return user;
}

export function requireGroup(ctx: RequestContext, name: string): IamGroup {
  const group = findGroup(ctx.deps.db, ctx.session.accountId, name);
  if (!group) throw noSuchEntity(`The group with name ${name} cannot be found.`);
  return group;
}

export function requireRole(ctx: RequestContext, name: string): IamRole {
  const role = findRole(ctx.deps.db, ctx.session.accountId, name);
  if (!role) throw noSuchEntity(`The role with name ${name} cannot be found.`);
  return role;
}

export function requirePolicy(ctx: RequestContext, arn: string): ManagedPolicy {
  const policy = findPolicy(ctx.deps.db, ctx.session.accountId, arn);
  if (!policy) throw noSuchEntity(`Policy ${arn} does not exist or is not attachable.`);
  return policy;
}

/** The ARN a request targets: the entity's real ARN if it exists, else the ARN it would have. */
export function userArn(ctx: RequestContext, name: string, path = "/"): string {
  return (
    findUser(ctx.deps.db, ctx.session.accountId, name)?.arn ??
    iamArn(ctx.session.accountId, "user", path, name)
  );
}

export function groupArn(ctx: RequestContext, name: string, path = "/"): string {
  return (
    findGroup(ctx.deps.db, ctx.session.accountId, name)?.arn ??
    iamArn(ctx.session.accountId, "group", path, name)
  );
}

export function roleArn(ctx: RequestContext, name: string, path = "/"): string {
  return (
    findRole(ctx.deps.db, ctx.session.accountId, name)?.arn ??
    iamArn(ctx.session.accountId, "role", path, name)
  );
}

/** The caller's own ARN as an IAM resource (for GetUser with no name, ChangePassword…). */
export function callerUserArn(ctx: RequestContext): string {
  return ctx.session.principal.type === "root"
    ? rootArn(ctx.session.accountId)
    : ctx.session.principal.arn;
}
