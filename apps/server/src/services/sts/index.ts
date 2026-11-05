import type { GetCallerIdentityOutput } from "@cloudlearn/shared";
import { z } from "zod";
import { defineAction, defineService } from "../../core/service";

/**
 * STS (Security Token Service). Phase 1 only has GetCallerIdentity, the "who am I?" call. AssumeRole
 * comes with IAM roles in Phase 2.
 */
export const stsService = defineService({
  id: "sts",
  name: "Security Token Service",
  actions: [
    defineAction({
      name: "GetCallerIdentity",
      iamAction: "sts:GetCallerIdentity",
      accessLevel: "Read",
      // In AWS this call works even when every permission is denied. Same here.
      authorization: "none",
      input: z.object({}),
      handler: (_input, { session }): GetCallerIdentityOutput => ({
        UserId: session.principal.id,
        Account: session.accountId,
        Arn: session.principal.arn,
      }),
    }),
  ],
});
