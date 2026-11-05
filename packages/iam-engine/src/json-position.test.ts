import { describe, expect, it } from "vitest";
import { findJsonError } from "./json-position";

describe("findJsonError", () => {
  it.each([
    ['{"a": 1}', null],
    ['[1, 2, {"b": [true, null, "x\\n"]}]', null],
    [
      '{"a": 1,}',
      { position: 8, message: "Unexpected '}', expected a property name in double quotes" },
    ],
    ['{"a" 1}', { position: 5, message: "Unexpected '1', expected ':'" }],
    ['{"a": 1 "b": 2}', { position: 8, message: "Unexpected '\"', expected ',' or '}'" }],
    ["[1, 2", { position: 5, message: "Unexpected end of input, expected ',' or ']'" }],
    ['{"a": "x', { position: 8, message: "Unterminated string" }],
    ["{} x", { position: 3, message: "Unexpected 'x' after the end of the document" }],
    [
      "{'a': 1}",
      { position: 1, message: "Unexpected ''', expected a property name in double quotes" },
    ],
  ])("%s", (text, expected) => {
    expect(findJsonError(text)).toEqual(expected);
  });
});
