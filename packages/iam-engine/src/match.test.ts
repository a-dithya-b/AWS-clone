import { describe, expect, it } from "vitest";
import { matchesPattern } from "./match";
import { substituteVariables } from "./variables";

describe("matchesPattern", () => {
  it.each([
    ["*", "anything", true, true],
    ["sqs:*", "sqs:SendMessage", true, true],
    ["sqs:Send*", "sqs:SendMessage", true, true],
    ["sqs:send*", "SQS:SendMessage", true, true],
    ["sqs:send*", "sqs:SendMessage", false, false],
    ["iam:Get*", "iam:ListUsers", true, false],
    ["s3:?etObject", "s3:GetObject", true, true],
    ["s3:?etObject", "s3:GGetObject", true, false],
    ["arn:aws:sqs:*:123456789012:orders", "arn:aws:sqs:us-east-1:123456789012:orders", false, true],
    ["arn:aws:sqs:*:*:orders", "arn:aws:sqs:us-east-1:1:orders-dlq", false, false],
    ["arn:aws:s3:::bucket/*", "arn:aws:s3:::bucket/", false, true],
    ["a.b", "axb", false, false], // regex characters are literal
    ["(x)+", "(x)+", false, true],
    ["", "", false, true],
  ])("%s vs %s (ci=%s) → %s", (pattern, value, ci, expected) => {
    expect(matchesPattern(pattern, value, { caseInsensitive: ci })).toBe(expected);
  });
});

describe("substituteVariables", () => {
  const ctx = {
    "aws:username": "alice",
    "aws:MultiFactorAuthPresent": true,
    "aws:EpochTime": 5,
    "aws:TagKeys": ["a"],
  };
  it.each<[string, string | null]>([
    ["arn:aws:iam::*:user/${aws:username}", "arn:aws:iam::*:user/alice"],
    ["${AWS:UserName}", "alice"],
    ["${aws:MultiFactorAuthPresent}", "true"],
    ["${aws:EpochTime}", "5"],
    ["${aws:TagKeys}", null],
    ["${aws:missing}", null],
    ["${aws:missing, 'nobody'}", "nobody"],
    ["${ aws:missing , 'x' }", "x"],
    ["${*}${?}${$}", "*?$"],
    ["no variables here", "no variables here"],
  ])("%s → %s", (text, expected) => {
    expect(substituteVariables(text, ctx)).toBe(expected);
  });
});
