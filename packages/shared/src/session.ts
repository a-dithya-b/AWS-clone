import { z } from "zod";

export type PrincipalType = "root" | "user" | "assumed-role";

export interface Principal {
  type: PrincipalType;
  /** Display name: the account name for root, the user name for IAM users. */
  name: string;
  arn: string;
  /** Unique ID: the account ID for root, AIDA… for users, AROA…:session for roles. */
  id: string;
}

export interface SessionInfo {
  accountId: string;
  accountName: string;
  accountAlias: string | null;
  principal: Principal;
  signedInAt: string;
  expiresAt: string;
  /** Set while using a switched role: who you were before, for "Switch back". */
  switchedFrom?: { principalName: string; principalArn: string; accountId: string };
}

export const SwitchRoleInput = z.object({
  /** 12-digit account ID or alias that owns the role. */
  account: z.string().trim().min(1, "Enter the account ID or alias."),
  roleName: z
    .string()
    .trim()
    .min(1, "Enter the role name.")
    .max(64)
    .regex(/^[\w+=,.@-]+$/, "Role names can contain letters, numbers and +=,.@-_ only."),
  /** Shown in the top bar instead of the role name. Optional. */
  displayName: z.string().trim().max(64).optional(),
});
export type SwitchRoleInput = z.infer<typeof SwitchRoleInput>;

export const SignUpInput = z.object({
  email: z.email("Enter a valid email address."),
  accountName: z
    .string()
    .trim()
    .min(1, "Enter an account name.")
    .max(50, "Account name must be 50 characters or fewer."),
  password: z.string().min(8, "Password must be at least 8 characters.").max(128),
});
export type SignUpInput = z.infer<typeof SignUpInput>;

export const RootSignInInput = z.object({
  type: z.literal("root"),
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export const IamUserSignInInput = z.object({
  type: z.literal("iam"),
  /** 12-digit account ID or account alias. */
  account: z.string().trim().min(1, "Enter your account ID or alias."),
  username: z.string().trim().min(1, "Enter your IAM user name."),
  password: z.string().min(1, "Enter your password."),
});

export const SignInInput = z.discriminatedUnion("type", [RootSignInInput, IamUserSignInInput]);
export type SignInInput = z.infer<typeof SignInInput>;
