import { expect, test } from "bun:test";
import { check } from "../src/check.ts";
import { parse } from "../src/parser.ts";

// Each type form that parses but has no meaning yet, and the rejection it gets.
const TYPES: [string, string][] = [
  ["Array<i64>", "array types"],
  ["i64[]", "array types"],
  ["keyof A", "'keyof' types"],
  ["readonly i64[]", "'readonly' types"],
  ["unique symbol", "'unique' types"],
  ["A[K]", "indexed access types"],
  ["typeof x", "'typeof' types"],
  ["[i64, i64]", "tuple types"],
  ["<T>(x: T) => T", "generic function types"],
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

// Object type members besides plain properties: the rejected part is the third column.
const MEMBERS: [string, string, string][] = [
  ["{ f(): i64 }", "methods in object types", "f(): i64"],
  ["{ (): i64 }", "call signatures", "(): i64"],
  ["{ new (): i64 }", "construct signatures", "new (): i64"],
  ["{ [k: string]: i64 }", "index signatures", "[k: string]: i64"],
  ["{ get x(): i64 }", "accessors in object types", "get x(): i64"],
  ["{ [k]: i64 }", "computed property names", "k"],
];

// Each kind of type `&` can't combine yet, rejected at that side.
const INTERSECTIONS: [string, string, string][] = [
  ["i64 & { a: i64 }", "intersections with primitive types", "i64"],
  ["{ a: i64 } & A", "intersections with classes", "A"],
  ["{ a: i64 } & (1 | 2)", "intersections with unions", "1 | 2"],
];

for (const [type, what, part] of INTERSECTIONS) {
  test(type, () => {
    const src = `class A {}\nfunction f(p: ${type}) {}\nfunction main() {}`;
    const start = src.indexOf(part, src.indexOf("p:"));
    expect(() => check(parse(src))).toThrow(expect.objectContaining({
      message: `${what} are not supported yet`, start, end: start + part.length,
    }));
  });
}

for (const [type, what, part] of MEMBERS) {
  test(type, () => {
    const src = `function f(p: ${type}) {}\nfunction main() {}`;
    const start = src.indexOf(part, src.indexOf("{"));
    expect(() => check(parse(src))).toThrow(expect.objectContaining({
      message: `${what} are not supported yet`, start, end: start + part.length,
    }));
  });
}

// Class forms that parse but have no meaning yet: the rejected part is the third column.
const CLASSES: [string, string, string][] = [
  ["abstract class A {}", "abstract classes", "abstract class A {}"],
  ["class A extends f() {}", "base class expressions", "f()"],
  ["class A { static n = 1 }", "static fields", "static n = 1"],
  ["class A { override n = 1 }", "'override' modifiers", "override n = 1"],
  ["class A { n!: i64 }", "definite assignment assertions", "n!: i64"],
  ["class A { [k: string]: i64 }", "index signatures", "[k: string]: i64"],
  ["class A { static {} }", "static blocks", "static {}"],
  ["class A { static get n(): i64 { return 1 } }", "static accessors", "static get n(): i64 { return 1 }"],
  ["class A { *g() {} }", "generator methods", "*g() {}"],
  ["class A { m<T>() {} }", "generic methods", "T"],
  ["class A { async m() {} }", "'async' modifiers", "async m() {}"],
];

for (const [decl, what, part] of CLASSES) {
  test(decl, () => {
    const src = `${decl}\nfunction main() {}`;
    const start = src.indexOf(part, decl.startsWith("class A") ? 7 : 0);
    expect(() => check(parse(src))).toThrow(expect.objectContaining({
      message: `${what} are not supported yet`, start, end: start + part.length,
    }));
  });
}

// Function signatures: the rejected part is the second column's text.
const SIGNATURES: [string, string, string][] = [
  ["(x: i64): x is i64", "type predicates", "x is i64"],
  ["(this: i64)", "'this' parameters", "this: i64"],
  ["(x: i64 = 1)", "default parameter values", "x: i64 = 1"],
  ["({ a }: i64)", "destructuring patterns", "{ a }"],
  ["(private x: i64)", "parameter properties", "private x: i64"],
  ["(@inject x: i64)", "decorators", "@inject x: i64"],
  ["(comptime n: i64)", "comptime parameters", "comptime n: i64"],
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
  ["1n", "bigint literals"],
  ["super", "'super' expressions"],
  ["/a+/g", "regular expressions"],
  ["`a${1}b`", "template literals"],
  ["[1, 2]", "array literals"],
  ["function () {}", "function expressions"],
  ["async (x: i64) => x", "async arrow functions"],
  ["<T>(x: T) => x", "generic arrow functions"],
  ["1 |> % + 1", "'|>' expressions"],
  ["comptime 1", "comptime expressions"],
  ["match (1) { case _ => 2 }", "match expressions"],
  ["class {}", "class expressions"],
  ["a[0]", "indexed access expressions"],
  ["f<i64>", "instantiation expressions"],
  ["import.meta", "meta properties"],
  ["import('m')", "dynamic imports"],
  ["a!", "non-null assertions"],
  ["f?.()", "optional calls"],
  ["a?.b", "optional chains"],
  ["console?.log(1)", "optional calls"],
  ["true as boolean", "'as' conversions other than between numbers"],
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

// Object literal properties besides `key: value` and shorthand: the rejected part is the
// second column.
const PROPERTIES: [string, string, string][] = [
  ["{ ...a }", "spread elements", "...a"],
  ["{ f() {} }", "methods in object literals", "f() {}"],
  ["{ get x() { return 1 } }", "accessors in object literals", "get x() { return 1 }"],
  ["{ [k]: 1 }", "computed property names", "k"],
];

for (const [expr, what, part] of PROPERTIES) {
  test(expr, () => {
    const src = `function main() {\n  let x = ${expr}\n}`;
    const start = src.indexOf(part, src.indexOf("{", src.indexOf("=")));
    expect(() => check(parse(src))).toThrow(expect.objectContaining({
      message: `${what} are not supported yet`, start, end: start + part.length,
    }));
  });
}

// Operators that parse but have no meaning yet.
for (const expr of ["a ?? b", "a in b", "typeof 1", "await 1"]) {
  test(expr, () => {
    const src = `function main() {\n  let x = ${expr}\n}`;
    const op = expr.match(/\?\?|\bin\b|typeof|await/)![0];
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
  ["debugger", "'debugger' statements"],
  ["comptime { print(1) }", "comptime blocks"],
  ["let a = 1, b = 2", "declarations of several variables at once"],
  ["[a] = [1]", "destructuring assignments"],
  ["for (const k in o) {}", "'for...in' loops"],
  ["for (const x of xs) {}", "'for...of' loops"],
  ["for await (const x of xs) {}", "'for await...of' loops"],
  ["throw 1", "'throw' statements"],
  ["try {} finally {}", "'try' statements"],
  ["class A {}", "local classes"],
  ["@sealed class A {}", "decorators"],
  ["enum E { A }", "local enums"],
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

test("macro function", () => {
  const decl = "macro function m(input: Ast): Ast { return input }";
  expect(() => check(parse(`${decl}\nfunction main() {}`))).toThrow(expect.objectContaining({
    message: "macros are not supported yet", start: 0, end: decl.length,
  }));
});
