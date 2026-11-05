import { describe, expect, it } from "vitest";
import { evaluateConditions, isKnownOperator } from "./conditions";
import { buildContext } from "./normalize";
import type { ConditionBlock, ContextValue } from "./types";

const check = (block: ConditionBlock, ctx: Record<string, ContextValue>, vars = true) =>
  evaluateConditions(block, buildContext(ctx), vars);

describe("condition operators", () => {
  const user = { "aws:username": "alice" };
  it.each<[string, ConditionBlock, Record<string, ContextValue>, boolean]>([
    ["StringEquals match", { StringEquals: { "aws:username": "alice" } }, user, true],
    ["StringEquals mismatch", { StringEquals: { "aws:username": "bob" } }, user, false],
    ["StringEquals is case-sensitive", { StringEquals: { "aws:username": "Alice" } }, user, false],
    ["keys are case-insensitive", { StringEquals: { "AWS:UserName": "alice" } }, user, true],
    ["multiple values OR", { StringEquals: { "aws:username": ["bob", "alice"] } }, user, true],
    ["StringNotEquals", { StringNotEquals: { "aws:username": "bob" } }, user, true],
    [
      "StringNotEquals any listed value fails",
      { StringNotEquals: { "aws:username": ["bob", "alice"] } },
      user,
      false,
    ],
    ["StringEqualsIgnoreCase", { StringEqualsIgnoreCase: { "aws:username": "ALICE" } }, user, true],
    [
      "StringNotEqualsIgnoreCase",
      { StringNotEqualsIgnoreCase: { "aws:username": "ALICE" } },
      user,
      false,
    ],
    ["StringLike", { StringLike: { "aws:username": "al*" } }, user, true],
    ["StringLike ?", { StringLike: { "aws:username": "alic?" } }, user, true],
    ["StringNotLike", { StringNotLike: { "aws:username": "b*" } }, user, true],
    ["NumericLessThan", { NumericLessThan: { "s3:max-keys": "10" } }, { "s3:max-keys": 5 }, true],
    [
      "NumericLessThan false",
      { NumericLessThan: { "s3:max-keys": 10 } },
      { "s3:max-keys": "10" },
      false,
    ],
    [
      "NumericLessThanEquals",
      { NumericLessThanEquals: { "s3:max-keys": 10 } },
      { "s3:max-keys": "10" },
      true,
    ],
    [
      "NumericGreaterThan",
      { NumericGreaterThan: { "s3:max-keys": 1 } },
      { "s3:max-keys": 2 },
      true,
    ],
    [
      "NumericGreaterThanEquals",
      { NumericGreaterThanEquals: { "s3:max-keys": 3 } },
      { "s3:max-keys": 2 },
      false,
    ],
    ["NumericEquals", { NumericEquals: { "s3:max-keys": "2" } }, { "s3:max-keys": 2 }, true],
    ["NumericNotEquals", { NumericNotEquals: { "s3:max-keys": "2" } }, { "s3:max-keys": 2 }, false],
    ["Numeric with junk", { NumericEquals: { "s3:max-keys": "x" } }, { "s3:max-keys": 2 }, false],
    [
      "DateLessThan ISO",
      { DateLessThan: { "aws:CurrentTime": "2030-01-01T00:00:00Z" } },
      { "aws:CurrentTime": "2026-11-05T00:00:00Z" },
      true,
    ],
    [
      "DateGreaterThan ISO",
      { DateGreaterThan: { "aws:CurrentTime": "2030-01-01T00:00:00Z" } },
      { "aws:CurrentTime": "2026-11-05T00:00:00Z" },
      false,
    ],
    [
      "DateGreaterThanEquals epoch",
      { DateGreaterThanEquals: { "aws:EpochTime": "1000" } },
      { "aws:EpochTime": 1000 },
      true,
    ],
    [
      "DateEquals mixed formats",
      { DateEquals: { "aws:CurrentTime": "1970-01-01T00:16:40Z" } },
      { "aws:CurrentTime": "1000" },
      true,
    ],
    [
      "DateNotEquals",
      { DateNotEquals: { "aws:CurrentTime": "2020-01-01" } },
      { "aws:CurrentTime": "2021-01-01" },
      true,
    ],
    [
      "DateLessThanEquals",
      { DateLessThanEquals: { "aws:CurrentTime": "2020-01-01T00:00:00Z" } },
      { "aws:CurrentTime": "2020-01-01T00:00:00Z" },
      true,
    ],
    [
      "Bool true",
      { Bool: { "aws:SecureTransport": "true" } },
      { "aws:SecureTransport": true },
      true,
    ],
    [
      "Bool false",
      { Bool: { "aws:SecureTransport": "false" } },
      { "aws:SecureTransport": true },
      false,
    ],
    [
      "Bool policy boolean",
      { Bool: { "aws:SecureTransport": true } },
      { "aws:SecureTransport": "TRUE" },
      true,
    ],
    [
      "ArnLike",
      { ArnLike: { "aws:PrincipalArn": "arn:aws:iam::*:user/a*" } },
      { "aws:PrincipalArn": "arn:aws:iam::1:user/alice" },
      true,
    ],
    [
      "ArnEquals",
      { ArnEquals: { "aws:PrincipalArn": "arn:aws:iam::1:user/alice" } },
      { "aws:PrincipalArn": "arn:aws:iam::1:user/alice" },
      true,
    ],
    [
      "ArnNotLike",
      { ArnNotLike: { "aws:PrincipalArn": "arn:aws:iam::*:role/*" } },
      { "aws:PrincipalArn": "arn:aws:iam::1:user/alice" },
      true,
    ],
    [
      "ArnNotEquals",
      { ArnNotEquals: { "aws:PrincipalArn": "arn:aws:iam::1:user/alice" } },
      { "aws:PrincipalArn": "arn:aws:iam::1:user/alice" },
      false,
    ],
    [
      "IpAddress CIDR",
      { IpAddress: { "aws:SourceIp": "127.0.0.0/8" } },
      { "aws:SourceIp": "127.0.0.1" },
      true,
    ],
    [
      "IpAddress outside",
      { IpAddress: { "aws:SourceIp": "10.0.0.0/8" } },
      { "aws:SourceIp": "127.0.0.1" },
      false,
    ],
    [
      "IpAddress exact",
      { IpAddress: { "aws:SourceIp": "127.0.0.1" } },
      { "aws:SourceIp": "127.0.0.1" },
      true,
    ],
    [
      "NotIpAddress",
      { NotIpAddress: { "aws:SourceIp": "10.0.0.0/8" } },
      { "aws:SourceIp": "127.0.0.1" },
      true,
    ],
    [
      "operators AND",
      { StringEquals: { "aws:username": "alice" }, Bool: { "aws:SecureTransport": "false" } },
      { ...user, "aws:SecureTransport": true },
      false,
    ],
    [
      "keys AND",
      { StringEquals: { "aws:username": "alice", "aws:PrincipalType": "User" } },
      { ...user, "aws:PrincipalType": "User" },
      true,
    ],
    [
      "keys AND fails",
      { StringEquals: { "aws:username": "alice", "aws:PrincipalType": "User" } },
      { ...user, "aws:PrincipalType": "Account" },
      false,
    ],
    ["unknown operator is false", { StringSorta: { "aws:username": "alice" } }, user, false],
  ])("%s", (_name, block, ctx, expected) => {
    expect(check(block, ctx)).toBe(expected);
  });
});

describe("missing keys", () => {
  it.each<[string, ConditionBlock, boolean]>([
    ["positive operator → false", { StringEquals: { "aws:missing": "x" } }, false],
    ["negated operator → true", { StringNotEquals: { "aws:missing": "x" } }, true],
    ["StringNotLike → true", { StringNotLike: { "aws:missing": "x*" } }, true],
    ["ArnNotLike → true", { ArnNotLike: { "aws:missing": "arn:*" } }, true],
    ["IfExists → true", { StringEqualsIfExists: { "aws:missing": "x" } }, true],
    [
      "IfExists still checks a present key",
      { StringEqualsIfExists: { "aws:username": "bob" } },
      false,
    ],
    ["Null true when absent", { Null: { "aws:missing": "true" } }, true],
    ["Null false when absent", { Null: { "aws:missing": "false" } }, false],
    ["Null true when present", { Null: { "aws:username": "true" } }, false],
    ["Null false when present", { Null: { "aws:username": "false" } }, true],
    ["ForAllValues missing → true", { "ForAllValues:StringEquals": { "aws:TagKeys": "a" } }, true],
    ["ForAnyValue missing → false", { "ForAnyValue:StringEquals": { "aws:TagKeys": "a" } }, false],
  ])("%s", (_name, block, expected) => {
    expect(check(block, { "aws:username": "alice" })).toBe(expected);
  });
});

describe("set operators", () => {
  const ctx = { "aws:TagKeys": ["env", "team"] };
  it.each<[string, ConditionBlock, boolean]>([
    [
      "ForAllValues all allowed",
      { "ForAllValues:StringEquals": { "aws:TagKeys": ["env", "team", "x"] } },
      true,
    ],
    [
      "ForAllValues one not allowed",
      { "ForAllValues:StringEquals": { "aws:TagKeys": ["env"] } },
      false,
    ],
    ["ForAnyValue one matches", { "ForAnyValue:StringEquals": { "aws:TagKeys": ["team"] } }, true],
    ["ForAnyValue none match", { "ForAnyValue:StringEquals": { "aws:TagKeys": ["cost"] } }, false],
    ["ForAnyValue negated", { "ForAnyValue:StringNotEquals": { "aws:TagKeys": ["env"] } }, true],
    ["ForAllValues negated", { "ForAllValues:StringNotEquals": { "aws:TagKeys": ["cost"] } }, true],
    [
      "ForAllValues StringLike",
      { "ForAllValues:StringLike": { "aws:TagKeys": ["e*", "t*"] } },
      true,
    ],
  ])("%s", (_name, block, expected) => {
    expect(check(block, ctx)).toBe(expected);
  });

  it("ForAllValues with an empty list → true", () => {
    expect(
      check({ "ForAllValues:StringEquals": { "aws:TagKeys": "x" } }, { "aws:TagKeys": [] }),
    ).toBe(true);
  });
});

describe("policy variables in condition values", () => {
  it("substitutes when enabled", () => {
    const block = { StringEquals: { "s3:prefix": "home/${aws:username}/" } };
    const ctx = { "aws:username": "alice", "s3:prefix": "home/alice/" };
    expect(check(block, ctx, true)).toBe(true);
    expect(check(block, ctx, false)).toBe(false);
  });
});

describe("isKnownOperator", () => {
  it.each([
    ["StringEquals", true],
    ["ForAnyValue:StringLikeIfExists", true],
    ["Null", true],
    ["NullIfExists", false],
    ["ForAllValues:Null", false],
    ["StringEqual", false],
    ["IfExists", false],
  ])("%s → %s", (op, expected) => {
    expect(isKnownOperator(op)).toBe(expected);
  });
});
