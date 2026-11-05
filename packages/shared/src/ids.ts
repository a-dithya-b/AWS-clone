/**
 * ID generators that follow AWS conventions, so learners see the same shapes as in real AWS.
 * https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html#identifiers-unique-ids
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function randomInts(count: number, max: number): number[] {
  const bytes = new Uint32Array(count);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b % max);
}

/** A 12-digit AWS account ID that doesn't start with 0. */
export function generateAccountId(): string {
  const [first = 0, ...rest] = randomInts(12, 10);
  return String((first % 9) + 1) + rest.join("");
}

/** Unique-ID prefixes AWS uses for IAM entities. */
export const IamIdPrefix = {
  user: "AIDA",
  group: "AGPA",
  role: "AROA",
  managedPolicy: "ANPA",
  accessKey: "AKIA",
} as const;

export type IamIdPrefix = (typeof IamIdPrefix)[keyof typeof IamIdPrefix];

/** e.g. AIDAJQABLZS4A3QDU576Q (prefix + 17 base32 characters, 21 in total). */
export function generateIamId(prefix: IamIdPrefix): string {
  return (
    prefix +
    randomInts(17, 32)
      .map((i) => BASE32[i])
      .join("")
  );
}

export function generateToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
