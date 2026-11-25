// Each table is one test looping over its rows, every failing row
// reported with the message and span it expected and the ones it got.
import { check } from "../../src/check.fsh";
import { newCompilation } from "../../src/compilation.fsh";
import { CompileError } from "../../src/diag.fsh";
import { runtimeNames } from "../../src/main.fsh";
import { parse } from "../../src/parser.fsh";
import { cachedSession } from "../../src/mathlib.fsh";

// The error `src`, checked as a program of its own, is refused with; code "none" when it checks.
function refusal(src: string, library: boolean): CompileError {
  try {
    let compilation = newCompilation(cachedSession());
    const program = parse(src, compilation.ids);
    check(compilation, program, library ? runtimeNames() : false);
  } catch (e) {
    if (e instanceof CompileError) return e;
    return new CompileError("internal", `an internal error: ${e.message}`, 0, 0);
  }
  return new CompileError("none", "it checked", 0, 0);
}

function shown(message: string, start: i64, end: i64): string {
  return `${message} at ${start}-${end}`;
}

// Adds to `failed` unless checking `src` is refused with `message` at `start` to `end`.
function refusedAt(failed: Mut<string[]>, name: string, src: string, message: string, start: i64, end: i64): void {
  const e = refusal(src, false);
  const got = e.code === "none" ? "it checked" : shown(e.message, e.start as i64, e.end as i64);
  const want = shown(message, start, end);
  if (got !== want) failed.push(`${name}:\n--- expected\n${want}\n--- got\n${got}`);
}

function refuses(name: string, src: string, message: string, start: i64, end: i64): void {
  let failed: string[] = [];
  refusedAt(failed, name, src, message, start, end);
  assert(failed.length === 0, failed.join("\n\n"));
}

function len(s: string): i64 {
  return s.length as i64;
}

// Each type form that parses but has no meaning yet, and the rejection it gets.
const TYPES: [string, string][] = [
  ["ReadonlyArray<i64>", "'ReadonlyArray' types"],
  ["readonly i64", "'readonly' types"],
  ["unique symbol", "'unique' types"],
  ["typeof x.y", "'typeof' types other than of a top-level function or const"],
  ["new () => i64", "constructor types"],
  ["import('m').A", "import types"],
];

test("type forms", () => {
  let failed: string[] = [];
  for (const row of TYPES) {
    const type = row[0];
    const src = `function main() {\n  let x: ${type} = 1\n}`;
    const start = src.indexOf(type);
    refusedAt(failed, type, src, `${row[1]} are not supported yet`, start, start + len(type));
  }
  assert(failed.length === 0, failed.join("\n\n"));
});

// Object type members besides plain properties: the rejected part is the third column.
const MEMBERS: [string, string, string][] = [
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

test("intersections", () => {
  let failed: string[] = [];
  for (const row of INTERSECTIONS) {
    const src = `class A {}\nfunction f(p: ${row[0]}) {}\nfunction main() {}`;
    const start = src.indexOf(row[2], src.indexOf("p:"));
    refusedAt(failed, row[0], src, `${row[1]} are not supported yet`, start, start + len(row[2]));
  }
  assert(failed.length === 0, failed.join("\n\n"));
});

test("object type members", () => {
  let failed: string[] = [];
  for (const row of MEMBERS) {
    const src = `function f(p: ${row[0]}) {}\nfunction main() {}`;
    const start = src.indexOf(row[2], src.indexOf("{"));
    refusedAt(failed, row[0], src, `${row[1]} are not supported yet`, start, start + len(row[2]));
  }
  assert(failed.length === 0, failed.join("\n\n"));
});

// References side by side in a union are refused at the first one that isn't beside nothing.
test("Ref<A> | Ref<B>", () => {
  const src = "class A {}\nclass B {}\nfunction f(p: Ref<A> | Ref<B>) {}\nfunction main() {}";
  const start = src.indexOf("Ref<A>");
  refuses("Ref<A> | Ref<B>", src, `unions of bare references are not supported yet; hold each in an object member with a tag, like '{ kind: "a"; node: Ref<A> }'`, start, start + len("Ref<A>"));
});

// Class forms that parse but have no meaning yet: the rejected part is the third column.
const CLASSES: [string, string, string][] = [
  ["abstract class A { abstract n: i64 }", "abstract fields", "abstract n: i64"],
  ["abstract class A<T> {}", "generic abstract classes", "abstract class A<T> {}"],
  ["class A extends f() {}", "base class expressions", "f()"],
  ["class A<T> { static readonly n = 1 }\nconst a = new A<i64>()", "static fields in generic classes", "static readonly n = 1"],
  ["class A { n!: i64 }", "definite assignment assertions", "n!: i64"],
  ["class A { [k: string]: i64 }", "index signatures", "[k: string]: i64"],
  ["class A { static {} }", "static blocks", "static {}"],
  ["class A<T> { static get n(): i64 { return 1 } }\nconst a = new A<i64>()", "static accessors in generic classes", "static get n(): i64 { return 1 }"],
  ["class A { [Symbol.iterator] = 1 }", "'[Symbol.iterator]' members", "Symbol.iterator"],
  ["class A { *[Symbol.asyncIterator]() {} }", "'[Symbol.asyncIterator]' members", "Symbol.asyncIterator"],
];

test("class forms", () => {
  let failed: string[] = [];
  for (const row of CLASSES) {
    const decl = row[0];
    const src = `${decl}\nfunction main() {}`;
    const start = src.indexOf(row[2], decl.startsWith("class A") ? 7 : 0);
    refusedAt(failed, decl, src, `${row[1]} are not supported yet`, start, start + len(row[2]));
  }
  assert(failed.length === 0, failed.join("\n\n"));
});

// Function signatures: the rejected part is the second column's text.
const SIGNATURES: [string, string, string][] = [
  ["(x: i64): asserts x is i64", "assertion signatures", "asserts x is i64"],
  ["(this: i64)", "'this' parameters", "this: i64"],
  ["(private x: i64)", "parameter properties", "private x: i64"],
  ["(@inject x: i64)", "decorators", "@inject x: i64"],
];

test("function signatures", () => {
  let failed: string[] = [];
  for (const row of SIGNATURES) {
    const src = `function f${row[0]} {}\nfunction main() {}`;
    const start = src.indexOf(row[2]);
    refusedAt(failed, row[0], src, `${row[1]} are not supported yet`, start, start + len(row[2]));
  }
  assert(failed.length === 0, failed.join("\n\n"));
});

// Each expression form that parses but has no meaning yet, as a `let` initializer, with the rest
// of its message in the third column.
const EXPRESSIONS: [string, string, string][] = [
  ["super", "'super' expressions", ""],
  ["[1, , 2]", "holes in array literals", ""],
  ["function () {}", "function expressions", ""],
  ["class {}", "class expressions", ""],
  ["true[0]", "indexed access expressions", ""],
  ["f<i64>", "instantiation expressions", ""],
  ["import.meta", "meta properties", "; 'import.meta' is read through its members path, file, dir, url, main, dirname, filename, or destructured into them"],
  ["import('m')", "dynamic imports", ""],
  ["f?.()", "optional calls", ""],
  ["<i64>1", "type assertions", ""],
];

test("expression forms", () => {
  let failed: string[] = [];
  for (const row of EXPRESSIONS) {
    const expr = row[0];
    const src = `function main() {\n  let x = ${expr}\n}`;
    const start = src.indexOf(expr, src.indexOf("="));
    refusedAt(failed, expr, src, `${row[1]} are not supported yet${row[2]}`, start, start + len(expr));
  }
  assert(failed.length === 0, failed.join("\n\n"));
});

// Object literal properties besides `key: value`, shorthand and spread: the rejected part is the
// second column.
const PROPERTIES: [string, string, string][] = [
  ["{ f() {} }", "methods in object literals", "f() {}"],
  ["{ get x() { return 1 } }", "accessors in object literals", "get x() { return 1 }"],
  ["{ [Symbol.iterator]: 1 }", "'[Symbol.iterator]' members", "Symbol.iterator"],
];

test("object literal properties", () => {
  let failed: string[] = [];
  for (const row of PROPERTIES) {
    const src = `function main() {\n  let x = ${row[0]}\n}`;
    const start = src.indexOf(row[2], src.indexOf("{", src.indexOf("=")));
    refusedAt(failed, row[0], src, `${row[1]} are not supported yet`, start, start + len(row[2]));
  }
  assert(failed.length === 0, failed.join("\n\n"));
});

// Operators that parse but have no meaning yet.
test("typeof 1", () => {
  const src = "function main() {\n  let x = typeof 1\n}";
  const start = src.indexOf("typeof 1");
  refuses("typeof 1", src, "operator 'typeof' is not supported yet", start, start + len("typeof 1"));
});

// `in` takes a key written as a string literal, and an object, an instance, or a union of them.
const IN: [string, string, string][] = [
  ["const k = \"a\"\n  const o = { a: 1 }\n  let x = k in o", "k", "'in' tests a key written as a string literal, as in '\"name\" in v'; for a key known only at run time, keep the keys in a Set or the values in a Map"],
  ["const o: { a: i64 } | null = null\n  let x = \"a\" in o", "o", "'in' tests an object or a class instance for a key, and a 'null' has none to test; narrow the value to an object first"],
  ["const xs = [1]\n  let x = \"length\" in xs", "xs", "'in' tests an object or a class instance for a key, and an 'i64[]' has none to test; narrow the value to an object first"],
];

test("in", () => {
  let failed: string[] = [];
  for (const row of IN) {
    const src = `function main() {\n  ${row[0]}\n}`;
    const start = src.lastIndexOf(row[1]);
    refusedAt(failed, `in: ${row[1]}`, src, row[2], start, start + len(row[1]));
  }
  assert(failed.length === 0, failed.join("\n\n"));
});

test("in on a Dyn", () => {
  const src = "interface S { a(): i64 }\nclass C { a(): i64 { return 1 } }\nfunction f(s: Dyn<S>): boolean {\n  return \"a\" in s\n}\nfunction main() {\n  print(f(new C()))\n}";
  const start = src.indexOf("\"a\" in s");
  refuses("in on a Dyn", src, "a 'Dyn<S>' keeps no record of its value's class, so 'in' can't test it; add a method to the interface that says", start, start + len("\"a\" in s"));
});

// An interface-typed value is destructured by its fields, never as a whole.
test("rest over an interface's fields", () => {
  const src = "type H = { a: i64; f(): i64 }\nfunction g(h: H) {\n  const { a, ...more } = h\n}\nfunction main() {}";
  const start = src.indexOf("more");
  refuses("rest over an interface's fields", src, "rest patterns over an interface's fields are not supported yet", start, start + len("more"));
});

// Parentheses aren't part of the node, so the span covers what is inside them.
test("(1, 2)", () => {
  const src = "function main() {\n  let x = (1, 2)\n}";
  const start = src.indexOf("1, 2");
  refuses("(1, 2)", src, "comma expressions are not supported yet", start, start + 4);
});

// Statements that parse but have no meaning yet, inside main().
const STATEMENTS: [string, string][] = [
  ["function* inner() {}", "nested generator functions"],
  ["debugger", "'debugger' statements"],
  ["for (const k in o) {}", "'for...in' loops"],
  ["namespace N {}", "namespaces"],
  ["declare const x: i64", "ambient declarations"],
];

test("statements", () => {
  let failed: string[] = [];
  for (const row of STATEMENTS) {
    const stmt = row[0];
    const src = `function main() {\n  ${stmt}\n}`;
    const start = src.indexOf(stmt);
    refusedAt(failed, stmt, src, `${row[1]} are not supported yet`, start, start + len(stmt));
  }
  assert(failed.length === 0, failed.join("\n\n"));
});

test("imports", () => {
  let failed: string[] = [];
  for (const decl of ["import x from 'm'", "import fs = require('fs')"]) {
    refusedAt(failed, decl, `${decl}\nfunction main() {}`, "imports are not supported yet", 0, len(decl));
  }
  assert(failed.length === 0, failed.join("\n\n"));
});

test("exports", () => {
  let failed: string[] = [];
  for (const decl of ["export const x = 1", "export default 1", "export * from 'm'", "export { a }"]) {
    refusedAt(failed, decl, `${decl}\nfunction main() {}`, "exports are not supported yet", 0, len(decl));
  }
  assert(failed.length === 0, failed.join("\n\n"));
});

// A moved Promise can't be cloned, so the note on a later use offers no clone.
test("a moved Promise's note offers no clone", () => {
  const src = "async function main(): Promise<void> throws Error {\n  const r = Promise.withResolvers<i64>();\n  const p = r.promise;\n  const s = r;\n}";
  const e = refusal(src, false);
  const note = e.note === undefined ? "no note" : e.note.message;
  assert(note === "'r.promise' moved here: 'p' owns it now", `${e.message}: ${note}`);
});

// A library has no main to start the runtime, so a timer outside an async function is refused.
test("a timer in a library's sync function is refused", () => {
  const src = "export function later(): void {\n  setTimeout(() => { console.log(\"x\"); }, 1);\n}";
  const e = refusal(src, true);
  assert(e.message.includes("'setTimeout' can only be used inside an 'async' function here, where the runtime is running"), e.message);
});

// `as const` names no type: only a literal can be asserted to its literal type.
test("x as const", () => {
  const src = "function main() {\n  const x = 1;\n  const y = x as const;\n}";
  const start = src.indexOf("x as");
  refuses("x as const", src, "a 'const' assertion can only be applied to an enum member, or a string, number, boolean, array or object literal", start, start + 1);
});

// `this` as a type is refused outside an instance method's return and parameter types.
const THIS_TYPES: [string, string][] = [
  ["a function", "function f(): this {\n  return 1;\n}\nfunction main() {}"],
  ["a static method", "class B {\n  static make(): this {\n    return new B();\n  }\n}\nfunction main() {}"],
];

test("'this' as a return type outside an instance method", () => {
  let failed: string[] = [];
  for (const row of THIS_TYPES) {
    const src = row[1];
    const start = src.indexOf("this");
    refusedAt(failed, `'this' as the return type of ${row[0]}`, src, "'this' as a type is supported only in a class's instance methods: in the return type, where it is the receiver's own class, and in parameter types, where it is the class that declares the method", start, start + 4);
  }
  assert(failed.length === 0, failed.join("\n\n"));
});

// A top-level const holds a function only as an arrow written in place.
test("a top-level const holding a function value", () => {
  const src = "function twice(x: i64): i64 {\n  return x * 2;\n}\nconst f = twice;\nfunction main() {}";
  const start = src.indexOf("twice;");
  refuses("a top-level const holding a function value", src, "a top-level const holding a function is supported when its value is an arrow written in place, as in 'const f = (x: i64) => ...'; declare the function with 'function', or call it by its own name", start, start + 5);
});

// A written type on a generic arrow const is refused at that type.
test("a generic arrow const with a written type", () => {
  const src = "const f: <T>(x: T) => T = <T>(x: T) => x;\nfunction main() {}";
  const start = src.indexOf("<T>(x: T) =>");
  refuses("a generic arrow const with a written type", src, "a const holding a generic arrow takes its type from the arrow; drop the const's written type", start, start + len("<T>(x: T) => T"));
});

test("values() on an array of references", () => {
  const src = "class B {}\nfunction main() {\n  const b = new B();\n  let rs: Ref<B>[] = [b];\n  for (const r of rs.values()) {}\n}";
  const start = src.indexOf("rs.values");
  refuses("values() on an array of references", src, "calls to 'values' on arrays of references are not supported yet", start, start + len("rs.values"));
});

test("owned values spread into an array of references", () => {
  const src = "class B {}\nfunction main() {\n  let xs = [new B()];\n  const rs: Ref<B>[] = [...xs];\n}";
  const start = src.indexOf("...xs") + 3;
  refuses("owned values spread into an array of references", src, "spreads of owned values into arrays of references are not supported yet", start, start + 2);
});

// An optional interface parameter is taken, but a default on one is still refused at the parameter.
test("a default on an interface-typed parameter", () => {
  const src = "interface Shape { area(): f64; }\nclass Sq { area(): f64 { return 1; } }\nfunction f(x: Shape = new Sq()): f64 { return x.area(); }\nfunction g(x?: Shape): f64 { return x === undefined ? 0 : x.area(); }\nfunction main() { f(); g(); }";
  const start = src.indexOf("x: Shape =");
  refuses("a default on an interface-typed parameter", src, "defaults on parameters of type 'Shape' are not supported yet", start, src.indexOf("): f64 {", start));
});

// A loop over a tuple lends elements of one type that doesn't copy, but a union of references
// to differing types can't be held, so it is refused at the tuple.
test("for...of over a tuple of differing owned types", () => {
  const src = "class C {}\nfunction main() { const t: [C, string] = [new C(), \"a\"]; for (const x of t) console.log(x); }";
  const start = src.indexOf("t) console");
  refuses("for...of over a tuple of differing owned types", src, "'for...of' loops over a tuple whose elements differ in type and don't all copy are not supported yet", start, start + 1);
});

// `String.raw` called as a function takes its strings as literals and no value past the last one.
const RAW_CALLS: [string, string, string][] = [
  ["String.raw(s, 1)", "s", "'String.raw' called as a function takes '{ raw: [...] }' holding an array of string literals first, so its text is known while compiling"],
  ["String.raw({ raw: [s] })", "{ raw: [s] }", "'String.raw' called as a function takes '{ raw: [...] }' holding an array of string literals first, so its text is known while compiling"],
  ["String.raw({ raw: [\"a\", \"b\"] }, 1, 2, 3)", "2, 3", "'String.raw' has 2 string(s) here, so it takes at most 1 value(s) after them"],
  ["String.raw({ raw: [\"a\", \"b\"] }, ...xs)", "...xs", "'String.raw' takes its values one by one, not spread"],
  ["String.raw<i64>`a`", "String.raw<i64>`a`", "'String.raw' takes no type arguments"],
];

test("String.raw called as a function", () => {
  let failed: string[] = [];
  for (const row of RAW_CALLS) {
    const call = row[0];
    const src = `function main() {\n  const s = "a";\n  const xs = [1];\n  console.log(${call});\n}`;
    const start = src.indexOf(call) + call.indexOf(row[1]);
    refusedAt(failed, call, src, row[2], start, start + len(row[1]));
  }
  assert(failed.length === 0, failed.join("\n\n"));
});
