import { describe, expect, it } from "vitest";
import { formatArn, parseArn, rootArn } from "./arn";
import { generateAccountId, generateIamId } from "./ids";

describe("arn", () => {
  it("formats and parses round-trip", () => {
    const arn = formatArn({
      service: "sqs",
      region: "us-east-1",
      accountId: "123456789012",
      resource: "orders",
    });
    expect(arn).toBe("arn:aws:sqs:us-east-1:123456789012:orders");
    expect(parseArn(arn)).toEqual({
      partition: "aws",
      service: "sqs",
      region: "us-east-1",
      accountId: "123456789012",
      resource: "orders",
    });
  });

  it("keeps colons inside the resource part", () => {
    expect(parseArn("arn:aws:logs:us-east-1:1:log-group:x:*")?.resource).toBe("log-group:x:*");
  });

  it("rejects non-ARNs", () => {
    expect(parseArn("not-an-arn")).toBeNull();
  });

  it("builds the root user ARN with no region", () => {
    expect(rootArn("123456789012")).toBe("arn:aws:iam::123456789012:root");
  });
});

describe("ids", () => {
  it("generates 12-digit account IDs that don't start with 0", () => {
    for (let i = 0; i < 200; i++) expect(generateAccountId()).toMatch(/^[1-9]\d{11}$/);
  });

  it("generates IAM unique IDs with the right prefix and length", () => {
    expect(generateIamId("AIDA")).toMatch(/^AIDA[A-Z2-7]{17}$/);
  });
});
