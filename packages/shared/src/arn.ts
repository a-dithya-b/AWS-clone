import { PARTITION } from "./constants";

export interface ArnParts {
  partition?: string;
  service: string;
  region?: string;
  accountId?: string;
  resource: string;
}

/** Builds an ARN: arn:partition:service:region:account-id:resource */
export function formatArn({
  partition = PARTITION,
  service,
  region = "",
  accountId = "",
  resource,
}: ArnParts): string {
  return `arn:${partition}:${service}:${region}:${accountId}:${resource}`;
}

/** Parses an ARN, or returns null if the string isn't one. The resource part may contain colons. */
export function parseArn(arn: string): Required<ArnParts> | null {
  const parts = arn.split(":");
  if (parts.length < 6 || parts[0] !== "arn") return null;
  const [, partition, service, region, accountId, ...rest] = parts;
  if (!partition || !service) return null;
  return {
    partition,
    service,
    region: region ?? "",
    accountId: accountId ?? "",
    resource: rest.join(":"),
  };
}

export const rootArn = (accountId: string) =>
  formatArn({ service: "iam", accountId, resource: "root" });
