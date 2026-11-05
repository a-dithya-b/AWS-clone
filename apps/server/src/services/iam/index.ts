import { createHash } from "node:crypto";
import { transaction } from "../../core/db";
import { defineService } from "../../core/service";
import { accountActions } from "./actions/account";
import { attachmentActions } from "./actions/attachments";
import { groupActions } from "./actions/groups";
import { policyActions } from "./actions/policies";
import { roleActions } from "./actions/roles";
import { simulateActions } from "./actions/simulate";
import { userActions } from "./actions/users";
import { awsManagedPolicies } from "./managed-policies";
import { iamMigrations } from "./migrations";
import {
  awsManagedPolicyArn,
  defaultDocument,
  findPolicy,
  insertPolicy,
  overwriteDefaultDocument,
} from "./repo";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Stable IDs for AWS-managed policies, so they stay the same across restarts and machines. */
function stablePolicyId(name: string): string {
  const bytes = createHash("sha256").update(`aws-managed:${name}`).digest();
  return `ANPA${Array.from(bytes.subarray(0, 17), (b) => BASE32[b % 32]).join("")}`;
}

export const iamService = defineService({
  id: "iam",
  name: "Identity and Access Management",
  migrations: iamMigrations,
  seed({ db, clock }) {
    transaction(db, () => {
      for (const seed of awsManagedPolicies) {
        const arn = awsManagedPolicyArn(seed.name);
        const existing = findPolicy(db, "", arn);
        if (!existing) {
          insertPolicy(db, {
            id: stablePolicyId(seed.name),
            accountId: null,
            name: seed.name,
            path: "/",
            arn,
            description: seed.description,
            document: seed.document,
            now: clock.now(),
          });
        } else if (JSON.stringify(defaultDocument(db, existing)) !== JSON.stringify(seed.document)) {
          overwriteDefaultDocument(db, existing, seed.document);
        }
      }
    });
  },
  actions: [
    ...userActions,
    ...groupActions,
    ...roleActions,
    ...policyActions,
    ...attachmentActions,
    ...accountActions,
    ...simulateActions,
  ],
});
