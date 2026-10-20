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
  ["({ a }: i64)", "destructuring patterns", "{ a }"],
  ["(private x: i64)", "parameter properties", "private x: i64"],
  ["(@inject x: i64)", "decorators", "@inject x: i64"],
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
  ["(x: i64) => x", "arrow functions"],
  ["1 |> % + 1", "'|>' expressions"],
  ["class {}", "class expressions"],
  ["a[0]", "indexed access expressions"],
  ["new C()", "'new' expressions"],
  ["f<i64>", "instantiation expressions"],
  ["import.meta", "meta properties"],
  ["import('m')", "dynamic imports"],
  ["a!", "non-null assertions"],
  ["f?.()", "optional calls"],
  ["f<i64>()", "type arguments on calls"],
  ["i++", "increment and decrement expressions"],
  ["a ? 1 : 2", "conditional expressions"],
  ["y = 1", "assignment expressions"],
  ["1 as i64", "'as' expressions"],
  ["1 satisfies i64", "'satisfies' expressions"],
  ["<i64>1", "type assertions"],
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

// Operators that parse but have no meaning yet.
for (const expr of ["2 ** 3", "1 | 2", "1 << 2", "a ?? b", "a in b", "typeof 1", "~1", "await 1"]) {
  test(expr, () => {
    const src = `function main() {\n  let x = ${expr}\n}`;
    const op = expr.match(/\*\*|\||<<|\?\?|\bin\b|typeof|~|await/)![0];
    const start = src.indexOf(expr);
    expect(() => check(parse(src))).toThrow(expect.objectContaining({
      message: `operator '${op}' is not supported yet`, start, end: start + expr.length,
    }));
  });
}

// Parentheses aren't part of the node, so the span covers what is inside them.
test("(1, 2)", () => {
  const src = "function main() {\n  let x = (1, 2)\n}";
  const start = src.indexOf("1, 2");
  expect(() => check(parse(src))).toThrow(expect.objectContaining({
    message: "comma expressions are not supported yet", start, end: start + 4,
  }));
});

// Statements that parse but have no meaning yet, inside main().
const STATEMENTS: [string, string][] = [
  ["function inner() {}", "nested functions"],
  ["{ print(1) }", "block statements"],
  ["debugger", "'debugger' statements"],
  ["let a = 1, b = 2", "declarations of several variables at once"],
  ["[a] = [1]", "destructuring assignments"],
  ["for (;;) {}", "'for' loops"],
  ["for (const k in o) {}", "'for...in' loops"],
  ["for (const x of xs) {}", "'for...of' loops"],
  ["for await (const x of xs) {}", "'for await...of' loops"],
  ["do {} while (true)", "'do...while' loops"],
  ["switch (1) {}", "'switch' statements"],
  ["here: print(1)", "labeled statements"],
  ["break", "'break' statements"],
  ["continue", "'continue' statements"],
  ["throw 1", "'throw' statements"],
  ["try {} finally {}", "'try' statements"],
  ["class A {}", "classes"],
  ["@sealed class A {}", "decorators"],
  ["enum E { A }", "enums"],
  ["namespace N {}", "namespaces"],
  ["declare const x: i64", "ambient declarations"],
];

test("let x: i64", () => {
  const src = "function main() {\n  let x: i64\n}";
  const start = src.indexOf("x: i64");
  expect(() => check(parse(src))).toThrow(expect.objectContaining({
    message: "declarations without an initializer are not supported yet", start, end: start + 6,
  }));
});

for (const [stmt, what] of STATEMENTS) {
  test(stmt, () => {
    const src = `function main() {\n  ${stmt}\n}`;
    const start = src.indexOf(stmt);
    expect(() => check(parse(src))).toThrow(expect.objectContaining({
      message: `${what} are not supported yet`, start, end: start + stmt.length,
    }));
  });
}

// Declarations that parse but have no meaning yet, at the top level.
for (const [decl, what] of [["async function f() {}", "async functions"], ["function* f() {}", "generator functions"]]) {
  test(decl!, () => {
    const src = `${decl}\nfunction main() {}`;
    expect(() => check(parse(src))).toThrow(expect.objectContaining({
      message: `${what} are not supported yet`, start: 0, end: decl!.length,
    }));
  });
}

test("a function without a body", () => {
  const src = "function f(): void\nfunction main() {}";
  expect(() => check(parse(src))).toThrow(expect.objectContaining({
    message: "functions without a body are not supported yet", start: 0, end: "function f(): void".length,
  }));
});

for (const decl of ["import x from 'm'", "import fs = require('fs')"]) {
  test(decl, () => {
    const src = `${decl}\nfunction main() {}`;
    expect(() => check(parse(src))).toThrow(expect.objectContaining({
      message: "imports are not supported yet", start: 0, end: decl.length,
    }));
  });
}

for (const decl of ["export const x = 1", "export default 1", "export * from 'm'", "export { a }"]) {
  test(decl, () => {
    const src = `${decl}\nfunction main() {}`;
    expect(() => check(parse(src))).toThrow(expect.objectContaining({
      message: "exports are not supported yet", start: 0, end: decl.length,
    }));
  });
}
