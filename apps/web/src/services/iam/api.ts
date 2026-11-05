import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import type {
  ListGroupsOutput,
  ListPoliciesOutput,
  ListRolesOutput,
  ListUsersOutput,
  PrincipalKind,
} from "./types";
import { kindLabel } from "./types";

/** Every IAM query key starts with "iam", so one invalidation refreshes the whole console. */
export function useIam<T>(action: string, input: object = {}, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["iam", action, input],
    queryFn: () => api.action<T>("iam", action, input),
    enabled: opts.enabled,
  });
}

export const iamCall = <T = unknown>(action: string, input: object = {}) =>
  api.action<T>("iam", action, input);

/** A mutation that refreshes all IAM data (and the session, which shows the account alias). */
export function useIamMutation<I, O = unknown>(fn: (input: I) => Promise<O>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["iam"] });
    },
  });
}

export const useUsers = () => useIam<ListUsersOutput>("ListUsers", { MaxItems: 1000 });
export const useGroups = () => useIam<ListGroupsOutput>("ListGroups", { MaxItems: 1000 });
export const useRoles = () => useIam<ListRolesOutput>("ListRoles", { MaxItems: 1000 });
export const usePolicies = (scope: "All" | "AWS" | "Local" = "All") =>
  useIam<ListPoliciesOutput>("ListPolicies", { Scope: scope, MaxItems: 1000 });

const nameKey = (kind: PrincipalKind) => `${kindLabel[kind]}Name`;

/** Calls an action and ignores NoSuchEntity (used when cleaning up before a delete). */
async function ignoreMissing(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    if (!(err instanceof ApiError && err.code === "NoSuchEntity")) throw err;
  }
}

/** Detaches every managed policy and deletes every inline policy of a user, group or role. */
async function removeAllPolicies(kind: PrincipalKind, name: string) {
  const label = kindLabel[kind];
  const key = nameKey(kind);
  const attached = await iamCall<{ AttachedPolicies: { PolicyArn: string }[] }>(
    `ListAttached${label}Policies`,
    { [key]: name },
  );
  for (const p of attached.AttachedPolicies) {
    await iamCall(`Detach${label}Policy`, { [key]: name, PolicyArn: p.PolicyArn });
  }
  const inline = await iamCall<{ PolicyNames: string[] }>(`List${label}Policies`, { [key]: name });
  for (const policyName of inline.PolicyNames) {
    await iamCall(`Delete${label}Policy`, { [key]: name, PolicyName: policyName });
  }
}

/**
 * Deletes a user the way the console does: the API refuses (DeleteConflict) while the user still
 * has a password, groups or policies, so remove those first.
 */
export async function deleteUserCompletely(name: string) {
  await ignoreMissing(iamCall("DeleteLoginProfile", { UserName: name }));
  const groups = await iamCall<{ Groups: { GroupName: string }[] }>("ListGroupsForUser", {
    UserName: name,
    MaxItems: 1000,
  });
  for (const g of groups.Groups) {
    await iamCall("RemoveUserFromGroup", { GroupName: g.GroupName, UserName: name });
  }
  await removeAllPolicies("user", name);
  await iamCall("DeleteUser", { UserName: name });
}

export async function deleteGroupCompletely(name: string) {
  const group = await iamCall<{ Users: { UserName: string }[] }>("GetGroup", {
    GroupName: name,
    MaxItems: 1000,
  });
  for (const u of group.Users) {
    await iamCall("RemoveUserFromGroup", { GroupName: name, UserName: u.UserName });
  }
  await removeAllPolicies("group", name);
  await iamCall("DeleteGroup", { GroupName: name });
}

export async function deleteRoleCompletely(name: string) {
  await removeAllPolicies("role", name);
  await iamCall("DeleteRole", { RoleName: name });
}

/** Deletes a customer managed policy: detach everywhere, drop old versions, then delete. */
export async function deletePolicyCompletely(arn: string) {
  const entities = await iamCall<{
    PolicyUsers: { UserName: string }[];
    PolicyGroups: { GroupName: string }[];
    PolicyRoles: { RoleName: string }[];
  }>("ListEntitiesForPolicy", { PolicyArn: arn });
  for (const u of entities.PolicyUsers)
    await iamCall("DetachUserPolicy", { UserName: u.UserName, PolicyArn: arn });
  for (const g of entities.PolicyGroups)
    await iamCall("DetachGroupPolicy", { GroupName: g.GroupName, PolicyArn: arn });
  for (const r of entities.PolicyRoles)
    await iamCall("DetachRolePolicy", { RoleName: r.RoleName, PolicyArn: arn });
  const versions = await iamCall<{ Versions: { VersionId: string; IsDefaultVersion: boolean }[] }>(
    "ListPolicyVersions",
    { PolicyArn: arn },
  );
  for (const v of versions.Versions.filter((v) => !v.IsDefaultVersion)) {
    await iamCall("DeletePolicyVersion", { PolicyArn: arn, VersionId: v.VersionId });
  }
  await iamCall("DeletePolicy", { PolicyArn: arn });
}

/** Generates a password that satisfies the default policy (and is hard to guess). */
export function generatePassword(length = 16): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/** URL an IAM user opens to sign in to this account. */
export const signInUrl = (account: string) =>
  `${window.location.origin}/signin?account=${encodeURIComponent(account)}`;

export const policyPath = (arn: string) => `/iam/policies/${encodeURIComponent(arn)}`;
