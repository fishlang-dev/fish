import { expect, test } from "bun:test";
import { check } from "../src/check.ts";
import { parse } from "../src/parser.ts";

// Each type form that parses but has no meaning yet, and the rejection it gets.
const TYPES: [string, string][] = [
  ["Array<i64>", "generic types"],
  ["'a'", "literal types"],
  ["-1", "literal types"],
  ["i64[]", "array types"],
  ["i64 | boolean", "union types"],
  ["A & B", "intersection types"],
  ["keyof A", "'keyof' types"],
  ["readonly i64[]", "'readonly' types"],
  ["unique symbol", "'unique' types"],
  ["A[K]", "indexed access types"],
  ["typeof x", "'typeof' types"],
  ["[i64, i64]", "tuple types"],
  ["{ x: i64 }", "object types"],
  ["(x: i64) => i64", "function types"],
  ["new () => i64", "constructor types"],
  ["import('m').A", "import types"],
  ["A extends B ? i64 : boolean", "conditional types"],
  ["{ [K in A]: i64 }", "mapped types"],
  ["infer U", "'infer' types"],
  ["`a${B}`", "template literal types"],
];

for (const [type, what] of TYPES) {
  test(type, () => {
    const src = `function main() {\n  let x: ${type} = 1\n}`;
    const start = src.indexOf(type);
    expect(() => check(parse(src))).toThrow(expect.objectContaining({
      message: `${what} are not supported yet`, start, end: start + type.length,
    }));
  });
}

// Function signatures: the rejected part is the second column's text.
const SIGNATURES: [string, string, string][] = [
  ["(x: i64): x is i64", "type predicates", "x is i64"],
  ["(this: i64)", "'this' parameters", "this: i64"],
  ["<T>(x: i64)", "generic functions", "T"],
  ["(x: i64 = 1)", "default parameter values", "x: i64 = 1"],
];

for (const [signature, what, part] of SIGNATURES) {
  test(signature, () => {
    const src = `function f${signature} {}\nfunction main() {}`;
    const start = src.indexOf(part);
    expect(() => check(parse(src))).toThrow(expect.objectContaining({
      message: `${what} are not supported yet`, start, end: start + part.length,
    }));
  });
}

// Each expression form that parses but has no meaning yet, as a `let` initializer.
const EXPRESSIONS: [string, string][] = [
  ["1.5", "floating-point numbers"],
  ["1n", "bigint literals"],
  ["null", "'null' values"],
  ["this", "'this' expressions"],
  ["super", "'super' expressions"],
  ["/a+/g", "regular expressions"],
  ["`a${1}b`", "template literals"],
  ["[1, 2]", "array literals"],
  ["{ a: 1 }", "object literals"],
  ["function () {}", "function expressions"],
  ["a[0]", "indexed access expressions"],
  ["new C()", "'new' expressions"],
  ["f<i64>", "instantiation expressions"],
  ["import.meta", "meta properties"],
  ["import('m')", "dynamic imports"],
  ["a!", "non-null assertions"],
  ["f?.()", "optional calls"],
  ["f<i64>()", "type arguments on calls"],
  ["tag`a`", "tagged templates"],
];

for (const [expr, what] of EXPRESSIONS) {
  test(expr, () => {
    const src = `function main() {\n  let x = ${expr}\n}`;
    const start = src.indexOf(expr, src.indexOf("="));
    expect(() => check(parse(src))).toThrow(expect.objectContaining({
      message: `${what} are not supported yet`, start, end: start + expr.length,
    }));
  });
}
