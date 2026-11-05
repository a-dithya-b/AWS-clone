import {
  type ContextValue,
  type Evaluation,
  evaluate,
  type PolicySource,
} from "@cloudlearn/iam-engine";
import { DEFAULT_REGION, parseArn } from "@cloudlearn/shared";
import { z } from "zod";
import { defineAction } from "../../../core/service";
import { policiesForGroup, policiesForRole, policiesForUser } from "../authorizer";
import { DocumentInput, invalidInput, noSuchEntity, parseDocument } from "../common";
import { findGroup, findRole, findUser } from "../repo";

const ActionNames = z
  .array(z.string().regex(/^[\w-]+:[\w*?]+$/, "Each action must look like service:Action."))
  .min(1, "Give at least one action.")
  .max(100);
const ResourceArns = z.array(z.string().min(1)).max(100).default(["*"]);
const ContextEntries = z
  .array(
    z.object({
      ContextKeyName: z.string().min(1),
      ContextKeyValues: z.array(z.string()),
      ContextKeyType: z.string().optional(),
    }),
  )
  .default([]);

const DECISION_NAMES = {
  Allow: "allowed",
  ExplicitDeny: "explicitDeny",
  ImplicitDeny: "implicitDeny",
} as const;

function toContext(entries: z.output<typeof ContextEntries>): Record<string, ContextValue> {
  return Object.fromEntries(
    entries.map((e) => {
      const values = e.ContextKeyValues;
      const isList = e.ContextKeyType?.endsWith("List");
      const bool = e.ContextKeyType === "boolean";
      if (bool) return [e.ContextKeyName, values[0] === "true"];
      return [e.ContextKeyName, isList ? values : (values[0] ?? "")];
    }),
  );
}

function results(
  policies: PolicySource[],
  principalArn: string,
  accountId: string,
  actions: string[],
  resources: string[],
  context: Record<string, ContextValue>,
) {
  return actions.flatMap((action) =>
    resources.map((resource) => {
      const evaluation: Evaluation = evaluate({
        identityPolicies: policies,
        request: {
          principalArn,
          principalAccount: accountId,
          action,
          resource,
          context: { "aws:RequestedRegion": DEFAULT_REGION, ...context },
        },
      });
      return {
        EvalActionName: action,
        EvalResourceName: resource,
        EvalDecision: DECISION_NAMES[evaluation.decision],
        MatchedStatements: evaluation.matchedStatements.map((m) => ({
          SourcePolicyId: m.policyName,
          SourcePolicyType: m.policyType,
        })),
        /** CloudLearn addition: the full explanation. */
        Evaluation: evaluation,
      };
    }),
  );
}

export const simulateActions = [
  defineAction({
    name: "SimulatePrincipalPolicy",
    iamAction: "iam:SimulatePrincipalPolicy",
    accessLevel: "Read",
    input: z.object({
      PolicySourceArn: z.string().startsWith("arn:aws:iam::"),
      ActionNames,
      ResourceArns,
      ContextEntries,
    }),
    resource: (i) => i.PolicySourceArn,
    handler: (i, { session, deps }) => {
      const parsed = parseArn(i.PolicySourceArn);
      if (!parsed || parsed.accountId !== session.accountId) {
        throw invalidInput("PolicySourceArn must be a user, group or role in this account.");
      }
      const [kind, ...rest] = parsed.resource.split("/");
      const name = rest.pop() ?? "";
      const context = toContext(i.ContextEntries);
      let policies: PolicySource[];
      if (kind === "user") {
        const user = findUser(deps.db, session.accountId, name);
        if (!user) throw noSuchEntity(`The user with name ${name} cannot be found.`);
        policies = policiesForUser(deps.db, user);
        context["aws:username"] ??= user.name;
        context["aws:userid"] ??= user.id;
      } else if (kind === "group") {
        const group = findGroup(deps.db, session.accountId, name);
        if (!group) throw noSuchEntity(`The group with name ${name} cannot be found.`);
        policies = policiesForGroup(deps.db, group);
      } else if (kind === "role") {
        const role = findRole(deps.db, session.accountId, name);
        if (!role) throw noSuchEntity(`The role with name ${name} cannot be found.`);
        policies = policiesForRole(deps.db, role);
      } else {
        throw invalidInput("PolicySourceArn must be a user, group or role ARN.");
      }
      return {
        EvaluationResults: results(
          policies,
          i.PolicySourceArn,
          session.accountId,
          i.ActionNames,
          i.ResourceArns,
          context,
        ),
        IsTruncated: false,
      };
    },
  }),

  defineAction({
    name: "SimulateCustomPolicy",
    iamAction: "iam:SimulateCustomPolicy",
    accessLevel: "Read",
    input: z.object({
      PolicyInputList: z.array(DocumentInput).min(1).max(10),
      ActionNames,
      ResourceArns,
      ContextEntries,
      CallerArn: z.string().optional(),
    }),
    handler: (i, { session, deps }) => {
      const policies: PolicySource[] = i.PolicyInputList.map((doc, index) => ({
        id: `PolicyInputList.${index + 1}`,
        name: `Policy ${index + 1}`,
        type: "inline",
        document: parseDocument(deps, doc, "identity"),
      }));
      return {
        EvaluationResults: results(
          policies,
          i.CallerArn ?? `arn:aws:iam::${session.accountId}:user/SimulatedUser`,
          session.accountId,
          i.ActionNames,
          i.ResourceArns,
          toContext(i.ContextEntries),
        ),
        IsTruncated: false,
      };
    },
  }),
];
