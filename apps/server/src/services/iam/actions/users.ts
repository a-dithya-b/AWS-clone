import { rootArn } from "@cloudlearn/shared";
import { z } from "zod";
import { transaction } from "../../../core/db";
import { AwsError } from "../../../core/errors";
import { hashPassword, verifyPassword } from "../../../core/passwords";
import { defineAction } from "../../../core/service";
import { deleteSessionsForPrincipal } from "../../../core/sessions";
import {
  alreadyExists,
  deleteConflict,
  formatGroup,
  formatUser,
  noSuchEntity,
  Pagination,
  Path,
  paginate,
  UserName,
} from "../common";
import { callerUserArn, requireUser, userArn } from "../lookup";
import {
  attachedPolicies,
  deleteUserRow,
  findUser,
  findUserById,
  groupsForUser,
  inlinePolicies,
  insertUser,
  listUsers,
  setUserPassword,
} from "../repo";

/** IAM's default password policy, simplified: at least 8 characters. */
export const Password = z.string().max(128);

function checkPasswordPolicy(password: string) {
  if (password.length < 8) {
    throw new AwsError(
      "PasswordPolicyViolation",
      "Password should have a minimum length of 8.",
      400,
    );
  }
}

export const userActions = [
  defineAction({
    name: "CreateUser",
    iamAction: "iam:CreateUser",
    accessLevel: "Write",
    input: z.object({ UserName, Path }),
    resource: (i, ctx) => userArn(ctx, i.UserName, i.Path),
    handler: (i, { session, deps }) => {
      if (findUser(deps.db, session.accountId, i.UserName)) {
        throw alreadyExists(`User with name ${i.UserName} already exists.`);
      }
      return {
        User: formatUser(
          insertUser(deps.db, session.accountId, i.UserName, i.Path, deps.clock.now()),
        ),
      };
    },
  }),

  defineAction({
    name: "GetUser",
    iamAction: "iam:GetUser",
    accessLevel: "Read",
    // With no UserName, IAM returns the caller.
    input: z.object({ UserName: UserName.optional() }),
    resource: (i, ctx) => (i.UserName ? userArn(ctx, i.UserName) : callerUserArn(ctx)),
    handler: (i, ctx) => {
      const { session, deps } = ctx;
      if (!i.UserName) {
        if (session.principal.type === "root") {
          const account = session;
          return {
            User: {
              UserId: account.accountId,
              Arn: rootArn(account.accountId),
              CreateDate: session.signedInAt,
            },
          };
        }
        if (session.principal.type !== "user") {
          throw new AwsError(
            "ValidationError",
            "Must specify userName when calling with non-User credentials",
          );
        }
        const self = findUserById(deps.db, session.principal.id);
        if (!self)
          throw noSuchEntity(`The user with name ${session.principal.name} cannot be found.`);
        return { User: formatUser(self) };
      }
      return { User: formatUser(requireUser(ctx, i.UserName)) };
    },
  }),

  defineAction({
    name: "ListUsers",
    iamAction: "iam:ListUsers",
    accessLevel: "List",
    input: z.object({ PathPrefix: z.string().startsWith("/").default("/"), ...Pagination }),
    handler: (i, { session, deps }) => {
      const users = listUsers(deps.db, session.accountId, i.PathPrefix).map((u) => ({
        ...formatUser(u),
        // CloudLearn additions for the console's user table:
        ConsoleAccess: u.passwordHash !== null,
        GroupCount: groupsForUser(deps.db, u.id).length,
      }));
      const { items, ...page } = paginate(users, i.Marker, i.MaxItems);
      return { Users: items, ...page };
    },
  }),

  defineAction({
    name: "DeleteUser",
    iamAction: "iam:DeleteUser",
    accessLevel: "Write",
    input: z.object({ UserName }),
    resource: (i, ctx) => userArn(ctx, i.UserName),
    handler: (i, ctx) => {
      const { db } = ctx.deps;
      const user = requireUser(ctx, i.UserName);
      // IAM refuses to delete a user that still has things attached. The console removes them
      // for you first; the API makes you do it.
      if (user.passwordHash)
        throw deleteConflict("Cannot delete entity, must delete login profile first.");
      if (groupsForUser(db, user.id).length)
        throw deleteConflict("Cannot delete entity, must remove user from all groups first.");
      if (attachedPolicies(db, "user", user.id).length)
        throw deleteConflict("Cannot delete entity, must detach all policies first.");
      if (inlinePolicies(db, "user", user.id).length)
        throw deleteConflict("Cannot delete entity, must delete policies first.");
      transaction(db, () => {
        deleteUserRow(db, user.id);
        deleteSessionsForPrincipal(db, user.id);
      });
      return {};
    },
  }),

  defineAction({
    name: "ListGroupsForUser",
    iamAction: "iam:ListGroupsForUser",
    accessLevel: "List",
    input: z.object({ UserName, ...Pagination }),
    resource: (i, ctx) => userArn(ctx, i.UserName),
    handler: (i, ctx) => {
      const groups = groupsForUser(ctx.deps.db, requireUser(ctx, i.UserName).id).map(formatGroup);
      const { items, ...page } = paginate(groups, i.Marker, i.MaxItems);
      return { Groups: items, ...page };
    },
  }),

  // ---------------------------------------------------------------- console passwords

  defineAction({
    name: "CreateLoginProfile",
    iamAction: "iam:CreateLoginProfile",
    accessLevel: "Write",
    input: z.object({ UserName, Password, PasswordResetRequired: z.boolean().default(false) }),
    resource: (i, ctx) => userArn(ctx, i.UserName),
    handler: async (i, ctx) => {
      const user = requireUser(ctx, i.UserName);
      if (user.passwordHash)
        throw alreadyExists(`Login Profile for user ${i.UserName} already exists.`);
      checkPasswordPolicy(i.Password);
      setUserPassword(
        ctx.deps.db,
        user.id,
        await hashPassword(i.Password),
        i.PasswordResetRequired,
      );
      return {
        LoginProfile: {
          UserName: user.name,
          CreateDate: ctx.deps.clock.now().toISOString(),
          PasswordResetRequired: i.PasswordResetRequired,
        },
      };
    },
  }),

  defineAction({
    name: "GetLoginProfile",
    iamAction: "iam:GetLoginProfile",
    accessLevel: "Read",
    input: z.object({ UserName }),
    resource: (i, ctx) => userArn(ctx, i.UserName),
    handler: (i, ctx) => {
      const user = requireUser(ctx, i.UserName);
      if (!user.passwordHash)
        throw noSuchEntity(`Login Profile for User ${i.UserName} cannot be found.`);
      return {
        LoginProfile: {
          UserName: user.name,
          CreateDate: user.createdAt,
          PasswordResetRequired: user.passwordResetRequired,
        },
      };
    },
  }),

  defineAction({
    name: "UpdateLoginProfile",
    iamAction: "iam:UpdateLoginProfile",
    accessLevel: "Write",
    input: z.object({
      UserName,
      Password: Password.optional(),
      PasswordResetRequired: z.boolean().optional(),
    }),
    resource: (i, ctx) => userArn(ctx, i.UserName),
    handler: async (i, ctx) => {
      const user = requireUser(ctx, i.UserName);
      if (!user.passwordHash)
        throw noSuchEntity(`Login Profile for User ${i.UserName} cannot be found.`);
      let hash = user.passwordHash;
      if (i.Password !== undefined) {
        checkPasswordPolicy(i.Password);
        hash = await hashPassword(i.Password);
      }
      setUserPassword(
        ctx.deps.db,
        user.id,
        hash,
        i.PasswordResetRequired ?? user.passwordResetRequired,
      );
      return {};
    },
  }),

  defineAction({
    name: "DeleteLoginProfile",
    iamAction: "iam:DeleteLoginProfile",
    accessLevel: "Write",
    input: z.object({ UserName }),
    resource: (i, ctx) => userArn(ctx, i.UserName),
    handler: (i, ctx) => {
      const user = requireUser(ctx, i.UserName);
      if (!user.passwordHash)
        throw noSuchEntity(`Login Profile for User ${i.UserName} cannot be found.`);
      setUserPassword(ctx.deps.db, user.id, null);
      return {};
    },
  }),

  defineAction({
    name: "ChangePassword",
    iamAction: "iam:ChangePassword",
    accessLevel: "Write",
    input: z.object({ OldPassword: Password, NewPassword: Password }),
    resource: (_i, ctx) => callerUserArn(ctx),
    handler: async (i, { session, deps }) => {
      if (session.principal.type !== "user") {
        throw new AwsError(
          "InvalidUserType",
          "Only IAM users can change their own password with ChangePassword.",
        );
      }
      const user = findUserById(deps.db, session.principal.id);
      if (!user?.passwordHash)
        throw noSuchEntity(`Login Profile for User ${session.principal.name} cannot be found.`);
      if (!(await verifyPassword(i.OldPassword, user.passwordHash))) {
        throw new AwsError("InvalidAuthenticationCode", "The old password was incorrect.", 403);
      }
      checkPasswordPolicy(i.NewPassword);
      setUserPassword(deps.db, user.id, await hashPassword(i.NewPassword), false);
      return {};
    },
  }),
];
