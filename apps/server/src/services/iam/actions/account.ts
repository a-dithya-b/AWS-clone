import { z } from "zod";
import { findAccountByAlias, findAccountById, setAccountAlias } from "../../../core/accounts";
import { defineAction } from "../../../core/service";
import {
  alreadyExists,
  MAX_ATTACHED_POLICIES,
  MAX_GROUPS_PER_USER,
  MAX_POLICY_VERSIONS,
  noSuchEntity,
} from "../common";
import { countFor } from "../repo";

const AccountAlias = z
  .string()
  .min(3, "AccountAlias must be at least 3 characters.")
  .max(63, "AccountAlias must be 63 characters or fewer.")
  .regex(
    /^[a-z0-9]([a-z0-9]|-(?!-)){1,61}[a-z0-9]$/,
    "AccountAlias can contain only lowercase letters, digits and single hyphens, and must start and end with a letter or digit.",
  );

export const accountActions = [
  defineAction({
    name: "CreateAccountAlias",
    iamAction: "iam:CreateAccountAlias",
    accessLevel: "Write",
    input: z.object({ AccountAlias }),
    handler: (i, { session, deps }) => {
      const owner = findAccountByAlias(deps.db, i.AccountAlias);
      if (owner && owner.id !== session.accountId) {
        throw alreadyExists(`The account alias ${i.AccountAlias} already exists.`);
      }
      // An account has at most one alias; a new one replaces the old.
      setAccountAlias(deps.db, session.accountId, i.AccountAlias);
      return {};
    },
  }),

  defineAction({
    name: "DeleteAccountAlias",
    iamAction: "iam:DeleteAccountAlias",
    accessLevel: "Write",
    input: z.object({ AccountAlias }),
    handler: (i, { session, deps }) => {
      const account = findAccountById(deps.db, session.accountId);
      if (account?.alias !== i.AccountAlias) {
        throw noSuchEntity(`The account alias ${i.AccountAlias} cannot be found.`);
      }
      setAccountAlias(deps.db, session.accountId, null);
      return {};
    },
  }),

  defineAction({
    name: "ListAccountAliases",
    iamAction: "iam:ListAccountAliases",
    accessLevel: "List",
    input: z.object({}),
    handler: (_i, { session, deps }) => {
      const alias = findAccountById(deps.db, session.accountId)?.alias;
      return { AccountAliases: alias ? [alias] : [], IsTruncated: false };
    },
  }),

  defineAction({
    name: "GetAccountSummary",
    iamAction: "iam:GetAccountSummary",
    accessLevel: "List",
    input: z.object({}),
    handler: (_i, { session, deps }) => {
      const n = (table: string) => countFor(deps.db, table, session.accountId);
      return {
        SummaryMap: {
          Users: n("iam_users"),
          Groups: n("iam_groups"),
          Roles: n("iam_roles"),
          Policies: n("iam_policies"),
          UsersQuota: 5000,
          GroupsQuota: 300,
          RolesQuota: 1000,
          PoliciesQuota: 1500,
          AttachedPoliciesPerUserQuota: MAX_ATTACHED_POLICIES,
          AttachedPoliciesPerGroupQuota: MAX_ATTACHED_POLICIES,
          AttachedPoliciesPerRoleQuota: MAX_ATTACHED_POLICIES,
          GroupsPerUserQuota: MAX_GROUPS_PER_USER,
          PolicyVersionsInUseQuota: MAX_POLICY_VERSIONS,
          AccountMFAEnabled: 0,
        },
      };
    },
  }),

  defineAction({
    name: "GetAccountPasswordPolicy",
    iamAction: "iam:GetAccountPasswordPolicy",
    accessLevel: "Read",
    input: z.object({}),
    handler: () => ({
      PasswordPolicy: {
        MinimumPasswordLength: 8,
        RequireSymbols: false,
        RequireNumbers: false,
        RequireUppercaseCharacters: false,
        RequireLowercaseCharacters: false,
        AllowUsersToChangePassword: true,
        ExpirePasswords: false,
      },
    }),
  }),
];
