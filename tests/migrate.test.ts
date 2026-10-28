import { expect, test } from "bun:test";
import { CompileError } from "../src/diag.ts";
import { directive, rejects } from "../src/migrate.ts";
import { parse } from "../src/parser.ts";

// Each hit in `src` as its rule and the text it spans, in source order.
function hits(src: string): [string, string][] {
  return rejects(parse(src)).sort((a, b) => a.start - b.start || a.end - b.end).map((h) => [h.rule, src.slice(h.start, h.end)]);
}

test("R1 finds eval, Function and new Function", () => {
  expect(hits('eval("1");\nconst f = Function("x");\nconst g = new Function("a", "return a");\n')).toEqual([["R1", "eval"], ["R1", "Function"], ["R1", "new Function"]]);
  expect(hits("const e = evaluate(1);\nconst f = obj.eval(1);\n")).toEqual([]);
});

test("R2 finds prototype members and the Object calls that reshape a type", () => {
  expect(hits("A.prototype.m = f;\nObject.defineProperty(o, \"k\", {});\nObject.defineProperties(o, {});\nObject.setPrototypeOf(o, p);\n")).toEqual([
    ["R2", "A.prototype"], ["R2", "defineProperty"], ["R2", "defineProperties"], ["R2", "setPrototypeOf"],
  ]);
  expect(hits("const k = Object.keys(o);\nclass Shape { prototype = 1; }\nconst n = Shape.prototype;\n")).toEqual([]);
});

test("R3 finds delete", () => {
  expect(hits("delete o.k;\ndelete o[\"k\"];\n")).toEqual([["R3", "delete o.k"], ["R3", 'delete o["k"]']]);
  expect(hits("m.delete(k);\n")).toEqual([]);
});

test("R5 finds the arguments object, but not a binding of that name", () => {
  expect(hits("function f() {\n  return arguments[0];\n}\n")).toEqual([["R5", "arguments"]]);
  expect(hits("function f(...arguments: number[]) {\n  return arguments[0];\n}\n")).toEqual([]);
  expect(hits("const arguments = [1];\nconst n = arguments.length;\n")).toEqual([]);
});

test("R6 finds Symbol, but not a name the file declares", () => {
  expect(hits("const s = Symbol(\"s\");\nclass C {\n  *[Symbol.iterator]() {}\n}\nlet t: Symbol;\n")).toEqual([["R6", "Symbol"], ["R6", "Symbol"], ["R6", "Symbol"]]);
  expect(hits("import { Symbol } from \"./symbols\";\nconst s = Symbol(1);\n")).toEqual([]);
  expect(hits("class Symbol {}\nconst s = new Symbol();\nconst t: symbol = u;\n")).toEqual([]);
});

test("R7 finds declarations TypeScript merges, and module augmentation", () => {
  const src = "interface I { a: number }\nexport interface I { b: number }\nclass C {}\ninterface C { x: number }\nfunction f() {}\nnamespace f { export const y = 1; }\nnamespace N {}\nnamespace N {}\nenum E { A }\nenum E { B = 1 }\ndeclare module \"m\" { export const x: number; }\ndeclare global { var g: number; }\n";
  expect(hits(src).map(([rule, text]) => [rule, text.split("\n")[0]])).toEqual([
    ["R7", "export interface I { b: number }"], ["R7", "interface C { x: number }"], ["R7", "namespace f { export const y = 1; }"],
    ["R7", "namespace N {}"], ["R7", "enum E { B = 1 }"], ["R7", 'module "m" { export const x: number; }'], ["R7", "global { var g: number; }"],
  ]);
  expect(hits("interface I { a: number }\ninterface J { a: number }\nfunction g(): void;\nfunction g(x?: number) {}\nfunction h() {\n  interface I { b: number }\n}\n")).toEqual([]);
});

test("the edition directive is the first line, or the second after a shebang", () => {
  expect(directive("// @fish-edition ts-compat\nconst a = 1;\n")).toEqual({ edition: "ts-compat", start: 0, end: 26 });
  expect(directive("#!/usr/bin/env fishc\r\n// @fish-edition native\r\n")).toEqual({ edition: "native", start: 22, end: 45 });
  expect(directive("const a = 1;\n// @fish-edition ts-compat\n")).toBeUndefined();
  expect(directive("// a comment\n")).toBeUndefined();
  expect(() => directive("// @fish-edition  native\n")).toThrow(CompileError);
  expect(() => directive("//@fish-edition ts\n")).toThrow("an edition directive is written '// @fish-edition native' or '// @fish-edition ts-compat'");
});

test("only a class's own prototype member keeps its .prototype from counting", () => {
  expect(hits("const o = { prototype: 1 };\nFoo.prototype.x = 1;\n")).toEqual([["R2", "Foo.prototype"]]);
  expect(hits("type T = { prototype: number };\nFoo.prototype.x = 1;\n")).toEqual([["R2", "Foo.prototype"]]);
  expect(hits("class Shape {\n  prototype = 1;\n}\nconst a = Shape.prototype;\nconst b = Other.prototype;\n")).toEqual([["R2", "Other.prototype"]]);
  expect(hits("class Shape {\n  get prototype() {\n    return 1;\n  }\n}\nconst a = Shape.prototype;\n")).toEqual([]);
});

test("R7 finds an enum merged with a namespace, and declarations under export default", () => {
  expect(hits("enum E { A }\nnamespace E {}\n")).toEqual([["R7", "namespace E {}"]]);
  expect(hits("export default class A {}\ninterface A {}\n")).toEqual([["R7", "interface A {}"]]);
  expect(hits("interface B {}\nexport default function B() {}\n")).toEqual([["R7", "export default function B() {}"]]);
  expect(hits("export default function C() {}\nnamespace C {}\n")).toEqual([["R7", "namespace C {}"]]);
});

test("a very long array is walked without overflowing the stack", () => {
  const program = [{ kind: "expr", start: 0, end: 1, expr: { kind: "array", start: 0, end: 1, elements: Array.from({ length: 1_000_000 }, () => ({ kind: "int", start: 0, end: 1, value: 1n })) } }];
  expect(rejects(program)).toEqual([]);
});

test("a comment that only starts like the directive is an ordinary comment", () => {
  expect(directive("// @fish-edition-foo native\n")).toBeUndefined();
  expect(directive("// @fish-editions\n")).toBeUndefined();
  expect(() => directive("// @fish-edition\n")).toThrow(CompileError);
});
