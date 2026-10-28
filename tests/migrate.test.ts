import { expect, test } from "bun:test";
import { CompileError } from "../src/diag.ts";
import { directive, fix, migrations, rejects, surveyHits } from "../src/migrate.ts";
import { parse, parseWithComments } from "../src/parser.ts";

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

// Each auto or guided hit in `src` as its action and rule and the text it spans, in source order.
function found(src: string): string[] {
  return migrations(parseWithComments(src), src).filter((h) => h.action !== "reject").sort((a, b) => a.start - b.start || a.end - b.end).map((h) => `${h.action} ${h.rule} ${src.slice(h.start, h.end)}`);
}

const fixed = (src: string) => fix(src).text;

test("A1 makes a var const when nothing assigns it again, and let otherwise", () => {
  expect(found("var a = 1;\nvar b = 2;\nb = 3;\nvar c;\nfor (var i = 0; i < 3; i++) {}\n")).toEqual(["auto A1 var", "auto A1 var", "auto A1 var", "auto A1 var"]);
  expect(fixed("var a = 1;\nvar b = 2;\nb = 3;\nvar c;\nfor (var i = 0; i < 3; i++) {}\nvar [d, e] = f;\n[d] = g;\n")).toBe("const a = 1;\nlet b = 2;\nb = 3;\nlet c;\nfor (let i = 0; i < 3; i++) {}\nlet [d, e] = f;\n[d] = g;\n");
  expect(found("declare var g: number;\nlet h = 1;\nconst k = 2;\n")).toEqual([]);
});

test("A3 makes == strict when both sides' types show, and reports any other", () => {
  const src = 'const s = "a";\nconst n = 1;\nconst x = s == "b" && n != 2 && typeof v == "string" && xs.length == 0 && true != false;\nconst y = u == v || s == n || w == null;\n';
  expect(found(src)).toEqual([
    'auto A3 s == "b"', "auto A3 n != 2", 'auto A3 typeof v == "string"', "auto A3 xs.length == 0", "auto A3 true != false",
    "guided A3 u == v", "guided A3 s == n", "guided A3 w == null",
  ]);
  expect(fixed(src)).toBe('const s = "a";\nconst n = 1;\nconst x = s === "b" && n !== 2 && typeof v === "string" && xs.length === 0 && true !== false;\nconst y = u == v || s == n || w == null;\n');
});

test("A8 moves the type of a JSON.parse cast into its type argument", () => {
  expect(fixed("const u = JSON.parse(text) as User;\nconst v = JSON.parse(text);\nconst w = other.parse(t) as User;\n")).toBe("const u = JSON.parse<User>(text);\nconst v = JSON.parse(text);\nconst w = other.parse(t) as User;\n");
});

test("A9 makes a function expression an arrow function unless it uses its own this", () => {
  const src = "const a = function (x: number): number {\n  return x;\n};\nconst b = async function named(){ return 1; };\nconst c = function () { return this.n; };\nconst d = function* () { yield 1; };\nconst e = function f(n: number): number { return n > 0 ? f(n - 1) : 0; };\nconst g = function () { return arguments.length; };\n";
  expect(found(src)).toEqual(["auto A9 function ", "auto A9 async function named"]);
  expect(fixed(src).split("\n").slice(0, 4).join("\n")).toBe("const a = (x: number): number => {\n  return x;\n};\nconst b = async () => { return 1; };");
});

test("A10 renames a relative .ts import to .fsh, and leaves other specifiers", () => {
  const src = 'import { a } from "./a.ts";\nexport * from "../b/c.ts";\nexport { d } from "./d.ts";\nimport e from "e.ts";\nimport f from "./f";\nimport type { G } from "./g.d.ts";\n';
  expect(found(src)).toEqual(['auto A10 "./a.ts"', 'auto A10 "../b/c.ts"', 'auto A10 "./d.ts"']);
  expect(fixed(src)).toBe('import { a } from "./a.fsh";\nexport * from "../b/c.fsh";\nexport { d } from "./d.fsh";\nimport e from "e.ts";\nimport f from "./f";\nimport type { G } from "./g.d.ts";\n');
});

test("A2 makes nullable types and optional properties and parameters Options, leaving ?. and ?? as written", () => {
  const src = "interface U {\n  a: string | null;\n  b?: number;\n  c: undefined | Date | null;\n}\nfunction f(x?: string, y?: number | undefined, z: (string | undefined)[] = []): string {\n  return x?.trim() ?? y?.toString() ?? z[0] ?? \"\";\n}\n";
  expect(fixed(src)).toBe("interface U {\n  a: Option<string>;\n  b: Option<number>;\n  c: Option<Date>;\n}\nfunction f(x: Option<string>, y: Option<number>, z: (Option<string>)[] = []): string {\n  return x?.trim() ?? y?.toString() ?? z[0] ?? \"\";\n}\n");
  expect(fixed("function g(p?: (A | B)[]) {}\n")).toBe("function g(p: Option<(A | B)[]>) {}\n");
  expect(fixed("let q: (string | number)[] | undefined;\nlet r: null | (() => void);\nconst s = JSON.parse(t) as (A | B)[];\n")).toBe("let q: Option<(string | number)[]>;\nlet r: Option<(() => void)>;\nconst s = JSON.parse<(A | B)[]>(t);\n");
  expect(found("let a: string;\nlet b: null;\n")).toEqual([]);
});

test("A4 makes a top-level counter an Atomic, and leaves a let used any other way", () => {
  const src = "let hits = 0;\nfunction hit() {\n  hits++;\n  hits += 5;\n  hits--;\n  hits -= 2;\n  console.log(hits);\n}\n";
  expect(fixed(src)).toBe("const hits = new Atomic(0);\nfunction hit() {\n  hits.add(1);\n  hits.add(5);\n  hits.sub(1);\n  hits.sub(2);\n  console.log(hits.load());\n}\n");
  expect(fixed("let n: number = -1;\nn++;\n")).toBe("const n = new Atomic(-1);\nn.add(1);\n");
  for (const other of ["let a = 0;\na = 5;\n", "let a = 0;\nconst b = a++;\n", "let a = 0;\na *= 2;\n", "let a = 0;\na += b;\n", 'let a = "x";\n', "let a = 0, b = 1;\n", "let a = 0;\nfunction f(a: number) { a++; }\n", "let a = 0;\nconst o = { a };\n", "function f() {\n  let a = 0;\n  a++;\n}\n"]) {
    expect(found(other).filter((h) => h.startsWith("auto A4"))).toEqual([]);
  }
});

test("A5 borrows an object parameter only read as Ref, marked for review", () => {
  const src = "type Point = { x: number };\ninterface Shape { area: number }\nfunction f(p: Point, s: Shape, xs: number[], m: Map<string, number>, t: [number, string], o: { a: number }) {\n  return p.x + s.area + xs[0] + m.get(\"a\") + t[0] + o.a + size(p);\n}\n";
  expect(fixed(src)).toBe("type Point = { x: number };\ninterface Shape { area: number }\nfunction f(p: Ref<Point> /* fish: review */, s: Ref<Shape> /* fish: review */, xs: Ref<number[]> /* fish: review */, m: Ref<Map<string, number>> /* fish: review */, t: Ref<[number, string]> /* fish: review */, o: Ref<{ a: number }> /* fish: review */) {\n  return p.x + s.area + xs[0] + m.get(\"a\") + t[0] + o.a + size(p);\n}\n");
});

test("A6 borrows a changed object parameter as Mut, for each kind of change", () => {
  const changes = ["p.x = 1", "p.x += 1", "p.x++", "--p.inner.y", "p[0] = 1", "delete p.x", ...["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin", "set", "delete", "clear", "add"].map((m) => `p.${m}(1)`), "p.items.push(1)"];
  for (const change of changes) expect(fixed(`function f(p: Thing) {\n  ${change};\n}\n`)).toBe(`function f(p: Mut<Thing> /* fish: review */) {\n  ${change};\n}\n`);
});

test("A5 and A6 leave primitives, generics, owned and already-borrowed parameters alone", () => {
  const src = "type Id = string;\nenum Color { Red }\nfunction f<T>(n: number, s: string, b: boolean, id: Id, c: Color, t: T, u: \"a\" | \"b\", g: (x: number) => void, kept: Thing, back: Thing, r: Ref<Thing>, d: Thing = make(), o?: Thing, ...rest: Thing[]) {\n  store.add(kept);\n  this.items = [kept];\n  return back;\n}\nfunction unused(p: Thing) {}\ntype F = (p: Thing) => void;\n";
  expect(found(src).filter((h) => /A[56]/.test(h))).toEqual([]);
  expect(found("class C {\n  constructor(p: Thing) {\n    this.p = p;\n  }\n}\n").filter((h) => /A[56]/.test(h))).toEqual([]);
});

test("A7 gives a method changing its fields a Mut receiver, marked for review", () => {
  const src = "class Counter {\n  n = 0;\n  items: number[] = [];\n  inc(): void {\n    this.n++;\n  }\n  @log add<T>(x: number) {\n    this.items.push(x);\n  }\n  read(): number {\n    return this.n;\n  }\n  static make() {\n    this.count = 1;\n  }\n  later() {\n    return function () { this.n = 2; };\n  }\n  arrow() {\n    const f = () => { this.n = 3; };\n  }\n  given(this: Mut<this>) {\n    this.n = 4;\n  }\n}\n";
  const out = fixed(src);
  expect(out).toContain("  inc(this: Mut<this> /* fish: review */): void {\n");
  expect(out).toContain("  @log add<T>(this: Mut<this> /* fish: review */, x: number) {\n");
  expect(out).toContain("  arrow(this: Mut<this> /* fish: review */) {\n");
  expect(found("const o = {\n  n: 0,\n  inc() {\n    this.n++;\n  },\n};\n")).toEqual([]);
  for (const kept of ["  read(): number {", "  static make() {", "  later() {", "  given(this: Mut<this>) {"]) expect(out).toContain(kept);
});

test("a review marker left in the file is reported as guided until it is removed", () => {
  const src = "function f(p: Ref<Thing> /* fish: review */, q: Mut<Thing> /* fish: review */) {\n  q.x = p.x;\n}\nclass C {\n  m(this: Mut<this> /* fish: review */) {}\n}\n// /* fish: review */\nconst s = \"/* fish: review */\";\n";
  expect(found(src)).toEqual(["guided A5 /* fish: review */", "guided A6 /* fish: review */", "guided A6 /* fish: review */"]);
  expect(fix(src)).toEqual({ text: src, fixed: 0 });
});

test("positions come from tokens, so comments and strings holding ( : { == or | are passed over", () => {
  const cases: [string, string][] = [
    ["let x: string /* | */ | null;\n", "let x: string /* | */ | null;\n"],
    ["let x: '(' | null = null;\nf(x);\n", "let x: Option<'('> = null;\nf(x);\n"],
    ["let x: 'a|b' | null;\n", "let x: Option<'a|b'>;\n"],
    ["function f(p /* : */ : Pt) {\n  return p.x;\n}\n", "function f(p /* : */ : Ref<Pt> /* fish: review */) {\n  return p.x;\n}\n"],
    ["const f = function (x) /* { */ { return x; };\n", "const f = (x) /* { */ => { return x; };\n"],
    ["const g = function /* ( */ (x) { return x; };\n", "const g = /* ( */ (x) => { return x; };\n"],
    ["if (1 /* == */ == 1) {}\n", "if (1 /* == */ === 1) {}\n"],
    ["const v = JSON.parse(s) as '(';\nk();\n", "const v = JSON.parse<'('>(s);\nk();\n"],
    ["class A {\n  x = 0;\n  [k('a')]() {\n    this.x = 1;\n  }\n}\n", "class A {\n  x = 0;\n  [k('a')](this: Mut<this> /* fish: review */) {\n    this.x = 1;\n  }\n}\n"],
    ["class A {\n  x = 0;\n  m /* ( */ () {\n    this.x = 1;\n  }\n}\n", "class A {\n  x = 0;\n  m /* ( */ (this: Mut<this> /* fish: review */) {\n    this.x = 1;\n  }\n}\n"],
    ["let r: null | (() => void);\n", "let r: Option<(() => void)>;\n"],
  ];
  for (const [src, out] of cases) {
    expect(fixed(src)).toBe(out);
    expect(() => parse(fixed(src))).not.toThrow();
  }
});

test("A9 makes an arrow only where an arrow function means the same and parses", () => {
  const unsafe = ["const f = function () { return 1; }.bind(this);\n", "const f = function () { return 1; }.call(o);\n", "const f = a || function () {};\n", "(function () { go(); })();\n", "const o = new function () {}();\n", "x = function () { return 1 }\n(1);\n", "const f = c ? function () {} : null;\n", "class A { f = function () {}; }\n"];
  for (const src of unsafe) expect(fixed(src)).toBe(src);
  const safe = ["g(function () {});\n", "const f = function () {};\n", "f = function () {};\n", "function h() {\n  return function () {};\n}\n", "const o = { f: function () {} };\n", "const a = [function () {}];\n", "g((function () {}));\n"];
  for (const src of safe) expect(fixed(src)).not.toContain("function ()");
});

test("A9 leaves a function constructed or given a prototype under its name", () => {
  for (const src of ["const F = function () {};\nconst o = new F();\n", "const F = function () {};\nF.prototype.x = 1;\n", "let G;\nG = function () {};\nnew G();\n"]) expect(fixed(src)).toBe(src);
});

test("A1 rewrites a var only where function scoping can't matter, and says why otherwise", () => {
  const guided = (src: string) => migrations(parseWithComments(src), src).filter((h) => h.rule === "A1").map((h) => `${h.action}: ${h.message!.split(": ")[1]}`);
  expect(guided("for (var i = 0; i < 3; i++) {\n  fs.push(() => i);\n}\n")).toEqual(["guided: a closure in the loop captures it; rename or move it, then use 'let' or 'const'"]);
  expect(guided("var x = 1;\nif (c) {\n  var x = 2;\n}\n")).toEqual(Array(2).fill("guided: it is declared again in the same function; rename or move it, then use 'let' or 'const'"));
  expect(guided("if (c) {\n  var x = 1;\n}\nconsole.log(x);\n")).toEqual(["guided: it is used outside the block it is declared in; rename or move it, then use 'let' or 'const'"]);
  expect(guided("try {\n  var r = 1;\n} catch {\n  r = 2;\n}\n")).toEqual(["guided: it is used outside the block it is declared in; rename or move it, then use 'let' or 'const'"]);
  expect(guided("console.log(x);\nvar x = 1;\n")).toEqual(["guided: it is used before its declaration; rename or move it, then use 'let' or 'const'"]);
  expect(guided("f();\nvar x = 1;\nfunction f() {\n  x = 2;\n}\n")).toEqual(["guided: a function using it is called before its declaration; rename or move it, then use 'let' or 'const'"]);
  expect(guided("var x = 1;\nfunction x() {}\n")).toEqual(["guided: it is declared again in the same function; rename or move it, then use 'let' or 'const'"]);
  expect(fixed("function x() {\n  var x = 1;\n  return x;\n}\n")).toBe("function x() {\n  const x = 1;\n  return x;\n}\n");
  expect(guided("function f(x: number) {\n  var x = 2;\n}\n")).toEqual(["guided: it is declared again in the same function; rename or move it, then use 'let' or 'const'"]);
  expect(fixed("function f() {\n  var x = 1;\n  for (var i = 0; i < 3; i++) {\n    x += i;\n  }\n  return x;\n}\nfunction g() {\n  var y = 2;\n  return () => y;\n}\n")).toBe("function f() {\n  let x = 1;\n  for (let i = 0; i < 3; i++) {\n    x += i;\n  }\n  return x;\n}\nfunction g() {\n  const y = 2;\n  return () => y;\n}\n");
});

test("A4 leaves a counter whose name is bound again by a catch, a function, a class, an enum or an import", () => {
  const rebound = ["try {} catch (n) {}", "function g() {\n  function n() {}\n}", "class n {}", "enum n { A }", 'import { n } from "./x.fsh";'];
  for (const other of rebound) expect(fixed(`let n = 0;\nn++;\n${other}\n`)).toBe(`let n = 0;\nn++;\n${other}\n`);
});

test("A4 leaves an exported counter", () => {
  for (const src of ["export let n = 0;\nn++;\n", "let n = 0;\nn++;\nexport { n };\n", "let n = 0;\nn++;\nexport default n;\n"]) expect(fixed(src)).toBe(src);
});

test("A4 is linear in the uses of a counter", () => {
  const src = `let n = 0;\nn++;\n${"console.log(n);\n".repeat(20000)}`;
  const started = performance.now();
  expect(fix(src).fixed).toBe(1);
  expect(performance.now() - started).toBeLessThan(5000);
});

test("A3 reads a name's literal only from a const, or a let nothing assigns, unannotated and bound once", () => {
  expect(fixed('const a = "x";\nlet b = 1;\nconst ok = a == "y" && b == 2;\n')).toBe('const a = "x";\nlet b = 1;\nconst ok = a === "y" && b === 2;\n');
  for (const src of ['let a = "x";\na = y;\nconst k = a == "y";\n', 'const a: any = "x";\nconst k = a == "y";\n', 'const a = "x";\nfunction f(a: any) {\n  return a == "y";\n}\n', 'const a = "x";\ntry {} catch (a) {\n  g(a == "y");\n}\n']) {
    expect(fixed(src)).toBe(src);
  }
});

test("A6 finds changes through Object.assign, destructuring, the file's Mut functions and methods, and aliases of this", () => {
  expect(found("function f(p: Pt) {\n  Object.assign(p, { x: 1 });\n}\n")).toEqual(["auto A6 Pt"]);
  expect(found("function f(p: Pt) {\n  [p.x, p.y] = [1, 2];\n}\n")).toEqual(["auto A6 Pt"]);
  expect(found("function set(q: Pt) {\n  q.x = 1;\n}\nfunction pass(r: Pt) {\n  set(r);\n}\nfunction twice(s: Pt) {\n  pass(s);\n}\n")).toEqual(["auto A6 Pt", "auto A6 Pt", "auto A6 Pt"]);
  expect(found("function g(q: Mut<Pt>) {}\nfunction f(p: Pt) {\n  g(p);\n}\n")).toEqual(["auto A6 Pt"]);
  const methods = "class Pt {\n  x = 0;\n  bump() {\n    this.x++;\n  }\n  twice() {\n    this.bump();\n  }\n  aliased() {\n    const self = this;\n    self.x = 2;\n  }\n}\nfunction f(p: Pt) {\n  p.twice();\n}\n";
  expect(found(methods)).toEqual(["auto A7 bump(", "auto A7 twice(", "auto A7 aliased(", "auto A6 Pt"]);
});

test("A10 renames an import only when its .fsh is there or being made, and never one with attributes", () => {
  const src = 'import { a } from "./a.ts";\nimport { b } from "./b.ts";\nimport c from "./c.ts" with { type: "json" };\n';
  expect(fix(src, (s) => (s !== "./b.ts" ? "rename" : undefined)).text).toBe('import { a } from "./a.fsh";\nimport { b } from "./b.ts";\nimport c from "./c.ts" with { type: "json" };\n');
});

test("the survey's hits come without edits, A3 counted fixable or not", () => {
  const hits = surveyHits(parse('var a = 1;\nconst b = a == 1 || x != y;\nconst u = JSON.parse(s) as U;\n'));
  expect(hits.map((h) => h.rule).sort()).toEqual(["A1", "A3", "A3", "A8"]);
  expect(hits.some((h) => h.edits)).toBe(false);
});

test("A1 leaves a var in a loop whose value carries from one turn to the next", () => {
  const carried = (src: string) => migrations(parseWithComments(src), src).filter((h) => h.rule === "A1").map((h) => `${h.action}: ${h.message!.split(": ")[1]}`);
  const reason = "guided: its value carries from one turn of the loop to the next; rename or move it, then use 'let' or 'const'";
  for (const src of ["for (let i = 0; i < 3; i++) {\n  var last;\n  if (i > 0) console.log(last);\n  last = i;\n}\n", "while (c) {\n  var seen;\n  if (seen) break;\n  seen = true;\n}\n", "while (c) {\n  var n = n + 1;\n  use(n);\n}\n", "for (const x of xs) {\n  if (c) {\n    var k;\n  }\n}\n"]) {
    expect(carried(src)).toEqual([reason]);
    expect(fixed(src)).toBe(src);
  }
  expect(fixed("for (const x of xs) {\n  var y = x * 2;\n  use(y);\n}\n")).toBe("for (const x of xs) {\n  const y = x * 2;\n  use(y);\n}\n");
});

test("A1's scope check is linear in the file", () => {
  const src = Array.from({ length: 8000 }, (_, i) => `function f${i}() {\n  var a = 1;\n  var b = a + 1;\n  return b;\n}\n`).join("");
  const started = performance.now();
  expect(fix(src).fixed).toBe(16000);
  expect(performance.now() - started).toBeLessThan(5000);
});

test("A9 after return keeps the arrow on the return's line", () => {
  expect(fixed("function g() {\n  return function\n  (x) { return x; };\n}\n")).toBe("function g() {\n  return (x) => { return x; };\n}\n");
  expect(fixed("function g() {\n  return function h\n  (x) { return x; };\n}\n")).toBe("function g() {\n  return (x) => { return x; };\n}\n");
  const commented = "function g() {\n  return function // c\n  (x) { return x; };\n}\n";
  expect(fixed(commented)).toBe(commented);
});

test("A9 leaves a property's function constructed through the object", () => {
  const src = "const o = { f: function () { return 1; } };\nnew o.f();\n";
  expect(fixed(src)).toBe(src);
});

test("a fix a comment blocks is reported as one to make by hand", () => {
  const src = "let x: string /* | */ | null;\n";
  const [hit] = migrations(parseWithComments(src), src).filter((h) => h.rule === "A2");
  expect(hit!.edits).toBeUndefined();
  expect(hit!.message).toBe("a comment sits where this change would go, so it can't be made automatically; make it by hand: 'string /* | */ | null' becomes 'Option<string>'");
});

test("collecting each name's uses is linear in the file", () => {
  const src = Array.from({ length: 16000 }, (_, i) => `function f${i}() { let x = 1; for (let i = 0; i < 2; i++) x += i; return x; }`).join("\n");
  const started = performance.now();
  const program = parseWithComments(src);
  migrations(program, src);
  expect(performance.now() - started).toBeLessThan(4000);
});
