import { expect, test } from "bun:test";
import { check } from "../src/check.ts";
import { newCompilation } from "../src/compilation.ts";
import { cachedSession } from "../src/stdcache.ts";
import { parse } from "../src/parser.ts";

const session = cachedSession();
// `src` checked as a program of its own, its nodes numbered by its compilation.
const checkSource = (src: string, library = false) => {
  const compilation = newCompilation(session);
  return check(compilation, parse(src, compilation.ids), library);
};

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
    expect(() => checkSource(src)).toThrow(expect.objectContaining({
      message: `${what} are not supported yet`, start, end: start + type.length,
    }));
  });
}

// Object type members besides plain properties: the rejected part is the third column.
const MEMBERS: [string, string, string][] = [
  ["{ f(): i64 }", "methods in object types", "f(): i64"],
  ["{ (): i64 }", "call signatures", "(): i64"],
  ["{ new (): i64 }", "construct signatures", "new (): i64"],
  ["{ readonly [k: string]: i64 }", "readonly index signatures", "readonly [k: string]: i64"],
  ["{ a: i64; [k: string]: i64 }", "index signatures beside other members", "[k: string]: i64"],
  ["{ get x(): i64 }", "accessors in object types", "get x(): i64"],
  ["{ [Symbol.iterator]: i64 }", "'[Symbol.iterator]' members", "Symbol.iterator"],
];

// Each kind of type `&` can't combine yet, rejected at that side.
const INTERSECTIONS: [string, string, string][] = [
  ["i64 & { a: i64 }", "intersections with primitive types", "i64"],
  ["{ a: i64 } & A", "intersections with classes", "A"],
  ["{ a: i64 } & (1 | 2)", "intersections with unions of other than object types", "1 | 2"],
];

for (const [type, what, part] of INTERSECTIONS) {
  test(type, () => {
    const src = `class A {}\nfunction f(p: ${type}) {}\nfunction main() {}`;
    const start = src.indexOf(part, src.indexOf("p:"));
    expect(() => checkSource(src)).toThrow(expect.objectContaining({
      message: `${what} are not supported yet`, start, end: start + part.length,
    }));
  });
}

for (const [type, what, part] of MEMBERS) {
  test(type, () => {
    const src = `function f(p: ${type}) {}\nfunction main() {}`;
    const start = src.indexOf(part, src.indexOf("{"));
    expect(() => checkSource(src)).toThrow(expect.objectContaining({
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
  ["class A { *[Symbol.iterator]() {} }", "'[Symbol.iterator]' members", "Symbol.iterator"],
  ["class A { [Symbol.iterator]() {} }", "'[Symbol.iterator]' members", "Symbol.iterator"],
];

for (const [decl, what, part] of CLASSES) {
  test(decl, () => {
    const src = `${decl}\nfunction main() {}`;
    const start = src.indexOf(part, decl.startsWith("class A") ? 7 : 0);
    expect(() => checkSource(src)).toThrow(expect.objectContaining({
      message: `${what} are not supported yet`, start, end: start + part.length,
    }));
  });
}

// Function signatures: the rejected part is the second column's text.
const SIGNATURES: [string, string, string][] = [
  ["(x: i64): asserts x is i64", "assertion signatures", "asserts x is i64"],
  ["(this: i64)", "'this' parameters", "this: i64"],
  ["(private x: i64)", "parameter properties", "private x: i64"],
  ["(@inject x: i64)", "decorators", "@inject x: i64"],
];

for (const [signature, what, part] of SIGNATURES) {
  test(signature, () => {
    const src = `function f${signature} {}\nfunction main() {}`;
    const start = src.indexOf(part);
    expect(() => checkSource(src)).toThrow(expect.objectContaining({
      message: `${what} are not supported yet`, start, end: start + part.length,
    }));
  });
}

// Each expression form that parses but has no meaning yet, as a `let` initializer.
const EXPRESSIONS: [string, string][] = [
  ["super", "'super' expressions"],
  ["[1, , 2]", "holes in array literals"],
  ["function () {}", "function expressions"],
  ["class {}", "class expressions"],
  ["true[0]", "indexed access expressions"],
  ["f<i64>", "instantiation expressions"],
  ["import.meta", "meta properties"],
  ["import('m')", "dynamic imports"],
  ["f?.()", "optional calls"],
  ["<i64>1", "type assertions"],
];

for (const [expr, what] of EXPRESSIONS) {
  test(expr, () => {
    const src = `function main() {\n  let x = ${expr}\n}`;
    const start = src.indexOf(expr, src.indexOf("="));
    expect(() => checkSource(src)).toThrow(expect.objectContaining({
      message: `${what} are not supported yet`, start, end: start + expr.length,
    }));
  });
}

// Object literal properties besides `key: value`, shorthand and spread: the rejected part is the
// second column.
const PROPERTIES: [string, string, string][] = [
  ["{ f() {} }", "methods in object literals", "f() {}"],
  ["{ get x() { return 1 } }", "accessors in object literals", "get x() { return 1 }"],
  ["{ [Symbol.iterator]: 1 }", "'[Symbol.iterator]' members", "Symbol.iterator"],
];

for (const [expr, what, part] of PROPERTIES) {
  test(expr, () => {
    const src = `function main() {\n  let x = ${expr}\n}`;
    const start = src.indexOf(part, src.indexOf("{", src.indexOf("=")));
    expect(() => checkSource(src)).toThrow(expect.objectContaining({
      message: `${what} are not supported yet`, start, end: start + part.length,
    }));
  });
}

// Operators that parse but have no meaning yet.
test("typeof 1", () => {
  const src = "function main() {\n  let x = typeof 1\n}";
  const start = src.indexOf("typeof 1");
  expect(() => checkSource(src)).toThrow(expect.objectContaining({
    message: "operator 'typeof' is not supported yet", start, end: start + "typeof 1".length,
  }));
});

// `in` takes a key written as a string literal, and an object, an instance, or a union of them.
const IN: [string, string, string][] = [
  ["const k = \"a\"\n  const o = { a: 1 }\n  let x = k in o", "k", "'in' tests a key written as a string literal, as in '\"name\" in v'; for a key known only at run time, keep the keys in a Set or the values in a Map"],
  ["const o: { a: i64 } | null = null\n  let x = \"a\" in o", "o", "'in' tests an object or a class instance for a key, and a 'null' has none to test; narrow the value to an object first"],
  ["const xs = [1]\n  let x = \"length\" in xs", "xs", "'in' tests an object or a class instance for a key, and an 'i64[]' has none to test; narrow the value to an object first"],
];
for (const [body, part, message] of IN) {
  test(`in: ${part}`, () => {
    const src = `function main() {\n  ${body}\n}`;
    const start = src.lastIndexOf(part);
    expect(() => checkSource(src)).toThrow(expect.objectContaining({ message, start, end: start + part.length }));
  });
}

test("in on a Dyn", () => {
  const src = "interface S { a(): i64 }\nclass C { a(): i64 { return 1 } }\nfunction f(s: Dyn<S>): boolean {\n  return \"a\" in s\n}\nfunction main() {\n  print(f(new C()))\n}";
  const start = src.indexOf("\"a\" in s");
  expect(() => checkSource(src)).toThrow(expect.objectContaining({
    message: "a 'Dyn<S>' keeps no record of its value's class, so 'in' can't test it; add a method to the interface that says", start, end: start + "\"a\" in s".length,
  }));
});

// Parentheses aren't part of the node, so the span covers what is inside them.
test("(1, 2)", () => {
  const src = "function main() {\n  let x = (1, 2)\n}";
  const start = src.indexOf("1, 2");
  expect(() => checkSource(src)).toThrow(expect.objectContaining({
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
    expect(() => checkSource(src)).toThrow(expect.objectContaining({
      message: `${what} are not supported yet`, start, end: start + stmt.length,
    }));
  });
}

for (const decl of ["import x from 'm'", "import fs = require('fs')"]) {
  test(decl, () => {
    const src = `${decl}\nfunction main() {}`;
    expect(() => checkSource(src)).toThrow(expect.objectContaining({
      message: "imports are not supported yet", start: 0, end: decl.length,
    }));
  });
}

for (const decl of ["export const x = 1", "export default 1", "export * from 'm'", "export { a }"]) {
  test(decl, () => {
    const src = `${decl}\nfunction main() {}`;
    expect(() => checkSource(src)).toThrow(expect.objectContaining({
      message: "exports are not supported yet", start: 0, end: decl.length,
    }));
  });
}

// A moved Promise can't be cloned, so the note on a later use offers no clone.
test("a moved Promise's note offers no clone", () => {
  const src = "async function main(): Promise<void> throws Error {\n  const r = Promise.withResolvers<i64>();\n  const p = r.promise;\n  const s = r;\n}";
  let thrown: unknown;
  try {
    checkSource(src);
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toMatchObject({ note: { message: "'r.promise' moved here: 'p' owns it now" } });
});

// A library has no main to start the runtime, so a timer outside an async function is refused.
test("a timer in a library's sync function is refused", () => {
  const src = "export function later(): void {\n  setTimeout(() => { console.log(\"x\"); }, 1);\n}";
  expect(() => checkSource(src, true)).toThrow("'setTimeout' can only be used inside an 'async' function here, where the runtime is running");
});

// `as const` names no type: only a literal can be asserted to its literal type.
test("x as const", () => {
  const src = "function main() {\n  const x = 1;\n  const y = x as const;\n}";
  const start = src.indexOf("x as");
  expect(() => checkSource(src)).toThrow(expect.objectContaining({
    message: "a 'const' assertion can only be applied to an enum member, or a string, number, boolean, array or object literal", start, end: start + 1,
  }));
});

// `this` as a type is refused outside an instance method's return and parameter types.
for (const [where, src] of [
  ["a function", "function f(): this {\n  return 1;\n}\nfunction main() {}"],
  ["a static method", "class B {\n  static make(): this {\n    return new B();\n  }\n}\nfunction main() {}"],
]) {
  test(`'this' as the return type of ${where}`, () => {
    const start = src!.indexOf("this");
    expect(() => checkSource(src!)).toThrow(expect.objectContaining({
      message: "'this' as a type is supported only in a class's instance methods: in the return type, where it is the receiver's own class, and in parameter types, where it is the class that declares the method", start, end: start + 4,
    }));
  });
}
