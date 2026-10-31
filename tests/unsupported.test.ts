import { expect, test } from "bun:test";
import { check } from "../src/check.ts";
import { parse } from "../src/parser.ts";

// Each type form that parses but has no meaning yet, and the rejection it gets.
const TYPES: [string, string][] = [
  ["ReadonlyArray<i64>", "'ReadonlyArray' types"],
  ["readonly i64", "'readonly' types"],
  ["unique symbol", "'unique' types"],
  ["typeof x.y", "'typeof' types other than of a top-level function or const"],
  ["new () => i64", "constructor types"],
  ["import('m').A", "import types"],
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
  ["abstract class A { abstract n: i64 }", "abstract fields", "abstract n: i64"],
  ["abstract class A<T> {}", "generic abstract classes", "abstract class A<T> {}"],
  ["class A extends f() {}", "base class expressions", "f()"],
  ["class A<T> { static readonly n = 1 }\nconst a = new A<i64>()", "static fields in generic classes", "static readonly n = 1"],
  ["class A { override n = 1 }", "'override' modifiers", "override n = 1"],
  ["class A { n!: i64 }", "definite assignment assertions", "n!: i64"],
  ["class A { [k: string]: i64 }", "index signatures", "[k: string]: i64"],
  ["class A { static {} }", "static blocks", "static {}"],
  ["class A<T> { static get n(): i64 { return 1 } }\nconst a = new A<i64>()", "static accessors in generic classes", "static get n(): i64 { return 1 }"],
  ["class A { *g() {} }", "generator methods", "*g() {}"],
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
  ["1n", "bigint literals"],
  ["super", "'super' expressions"],
  ["[1, , 2]", "holes in array literals"],
  ["function () {}", "function expressions"],
  ["class {}", "class expressions"],
  ["true[0]", "indexed access expressions"],
  ["f<i64>", "instantiation expressions"],
  ["import.meta", "meta properties"],
  ["import('m')", "dynamic imports"],
  ["f?.()", "optional calls"],
  ["true as boolean", "'as' conversions other than between numbers"],
  ["1 satisfies i64", "'satisfies' expressions"],
  ["<i64>1", "type assertions"],
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

// Object literal properties besides `key: value`, shorthand and spread: the rejected part is the
// second column.
const PROPERTIES: [string, string, string][] = [
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
for (const expr of ["a in b", "typeof 1"]) {
  test(expr, () => {
    const src = `function main() {\n  let x = ${expr}\n}`;
    const op = expr.match(/\bin\b|typeof/)![0];
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
  ["function* inner() {}", "nested generator functions"],
  ["debugger", "'debugger' statements"],
  ["for (const k in o) {}", "'for...in' loops"],
  ["namespace N {}", "namespaces"],
  ["declare const x: i64", "ambient declarations"],
];

for (const [stmt, what] of STATEMENTS) {
  test(stmt, () => {
    const src = `function main() {\n  ${stmt}\n}`;
    const start = src.indexOf(stmt);
    expect(() => check(parse(src))).toThrow(expect.objectContaining({
      message: `${what} are not supported yet`, start, end: start + stmt.length,
    }));
  });
}

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

// A moved Promise can't be cloned, so the note on a later use offers no clone.
test("a moved Promise's note offers no clone", () => {
  const src = "async function main(): Promise<void> throws Error {\n  const r = Promise.withResolvers<i64>();\n  const p = r.promise;\n  const s = r;\n}";
  let thrown: unknown;
  try {
    check(parse(src));
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toMatchObject({ note: { message: "'r.promise' moved here: 'p' owns it now" } });
});

// A library has no main to start the runtime, so a timer outside an async function is refused.
test("a timer in a library's sync function is refused", () => {
  const src = "export function later(): void {\n  setTimeout(() => { console.log(\"x\"); }, 1);\n}";
  expect(() => check(parse(src), true)).toThrow("'setTimeout' can only be used inside an 'async' function here, where the runtime is running");
});
