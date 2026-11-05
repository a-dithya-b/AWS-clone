import { z } from "zod";
import { type AnyActionDef, defineAction, type RequestContext } from "../../../core/service";
import {
  DocumentInput,
  GroupName,
  limitExceeded,
  MAX_ATTACHED_POLICIES,
  noSuchEntity,
  PolicyArn,
  PolicyName,
  parseDocument,
  RoleName,
  UserName,
} from "../common";
import { groupArn, requireGroup, requirePolicy, requireRole, requireUser, roleArn, userArn } from "../lookup";
import { attach, attachedPolicies, deleteInline, detach, inlinePolicies, type PrincipalKind, putInline } from "../repo";

/**
 * Managed-policy attachments and inline policies work the same way for users, groups and roles,
 * so the 27 actions (Attach/Detach/ListAttached + Put/Get/Delete/List × 3) are generated here.
 */
interface Kind {
  kind: PrincipalKind;
  /** "User" → AttachUserPolicy, UserName, … */
  label: "User" | "Group" | "Role";
  nameSchema: z.ZodString;
  find: (ctx: RequestContext, name: string) => { id: string; name: string };
  arn: (ctx: RequestContext, name: string) => string;
}

const kinds: Kind[] = [
  { kind: "user", label: "User", nameSchema: UserName, find: requireUser, arn: userArn },
  { kind: "group", label: "Group", nameSchema: GroupName, find: requireGroup, arn: groupArn },
  { kind: "role", label: "Role", nameSchema: RoleName, find: requireRole, arn: roleArn },
];

function actionsFor(k: Kind): AnyActionDef[] {
  const nameKey = `${k.label}Name` as const;
  const nameOf = (i: Record<string, unknown>) => i[nameKey] as string;
  const withName = <T extends z.ZodRawShape>(shape: T) => z.object({ [nameKey]: k.nameSchema, ...shape });

  return [
    defineAction({
      name: `Attach${k.label}Policy`,
      iamAction: `iam:Attach${k.label}Policy`,
      accessLevel: "Permissions management",
      input: withName({ PolicyArn }),
      resource: (i, ctx) => k.arn(ctx, nameOf(i)),
      handler: (i, ctx) => {
        const entity = k.find(ctx, nameOf(i));
        const policy = requirePolicy(ctx, i.PolicyArn as string);
        const current = attachedPolicies(ctx.deps.db, k.kind, entity.id);
        if (!current.some((p) => p.id === policy.id) && current.length >= MAX_ATTACHED_POLICIES) {
          throw limitExceeded(`Cannot exceed quota for PoliciesPer${k.label}: ${MAX_ATTACHED_POLICIES}`);
        }
        attach(ctx.deps.db, ctx.session.accountId, policy.id, k.kind, entity.id, ctx.deps.clock.now());
        return {};
      },
    }),

    defineAction({
      name: `Detach${k.label}Policy`,
      iamAction: `iam:Detach${k.label}Policy`,
      accessLevel: "Permissions management",
      input: withName({ PolicyArn }),
      resource: (i, ctx) => k.arn(ctx, nameOf(i)),
      handler: (i, ctx) => {
        const entity = k.find(ctx, nameOf(i));
        const policy = requirePolicy(ctx, i.PolicyArn as string);
        if (!attachedPolicies(ctx.deps.db, k.kind, entity.id).some((p) => p.id === policy.id)) {
          throw noSuchEntity(`Policy ${policy.arn} was not found.`);
        }
        detach(ctx.deps.db, policy.id, k.kind, entity.id);
        return {};
      },
    }),

    defineAction({
      name: `ListAttached${k.label}Policies`,
      iamAction: `iam:ListAttached${k.label}Policies`,
      accessLevel: "List",
      input: withName({}),
      resource: (i, ctx) => k.arn(ctx, nameOf(i)),
      handler: (i, ctx) => {
        const entity = k.find(ctx, nameOf(i));
        return {
          AttachedPolicies: attachedPolicies(ctx.deps.db, k.kind, entity.id).map((p) => ({
            PolicyName: p.name,
            PolicyArn: p.arn,
          })),
          IsTruncated: false,
        };
      },
    }),

    defineAction({
      name: `Put${k.label}Policy`,
      iamAction: `iam:Put${k.label}Policy`,
      accessLevel: "Permissions management",
      input: withName({ PolicyName, PolicyDocument: DocumentInput }),
      resource: (i, ctx) => k.arn(ctx, nameOf(i)),
      handler: (i, ctx) => {
        const entity = k.find(ctx, nameOf(i));
        const document = parseDocument(ctx.deps, i.PolicyDocument, "identity");
        putInline(
          ctx.deps.db,
          ctx.session.accountId,
          k.kind,
          entity.id,
          i.PolicyName as string,
          document,
          ctx.deps.clock.now(),
        );
        return {};
      },
    }),

    defineAction({
      name: `Get${k.label}Policy`,
      iamAction: `iam:Get${k.label}Policy`,
      accessLevel: "Read",
      input: withName({ PolicyName }),
      resource: (i, ctx) => k.arn(ctx, nameOf(i)),
      handler: (i, ctx) => {
        const entity = k.find(ctx, nameOf(i));
        const policy = inlinePolicies(ctx.deps.db, k.kind, entity.id).find(
          (p) => p.name.toLowerCase() === (i.PolicyName as string).toLowerCase(),
        );
        if (!policy) {
          throw noSuchEntity(`The ${k.kind} policy with name ${i.PolicyName} cannot be found.`);
        }
        return { [nameKey]: entity.name, PolicyName: policy.name, PolicyDocument: policy.document };
      },
    }),

    defineAction({
      name: `Delete${k.label}Policy`,
      iamAction: `iam:Delete${k.label}Policy`,
      accessLevel: "Permissions management",
      input: withName({ PolicyName }),
      resource: (i, ctx) => k.arn(ctx, nameOf(i)),
      handler: (i, ctx) => {
        const entity = k.find(ctx, nameOf(i));
        const exists = inlinePolicies(ctx.deps.db, k.kind, entity.id).some(
          (p) => p.name.toLowerCase() === (i.PolicyName as string).toLowerCase(),
        );
        if (!exists) throw noSuchEntity(`The ${k.kind} policy with name ${i.PolicyName} cannot be found.`);
        deleteInline(ctx.deps.db, k.kind, entity.id, i.PolicyName as string);
        return {};
      },
    }),

    defineAction({
      name: `List${k.label}Policies`,
      iamAction: `iam:List${k.label}Policies`,
      accessLevel: "List",
      input: withName({}),
      resource: (i, ctx) => k.arn(ctx, nameOf(i)),
      handler: (i, ctx) => {
        const entity = k.find(ctx, nameOf(i));
        return {
          PolicyNames: inlinePolicies(ctx.deps.db, k.kind, entity.id).map((p) => p.name),
          IsTruncated: false,
        };
      },
    }),
  ] as AnyActionDef[];
}

export const attachmentActions: AnyActionDef[] = kinds.flatMap(actionsFor);
