// Ports tests/migrate.test.ts. Each hit is shown as one string, its action or rule and the text it
// spans, so a list of them compares with `===` and prints in full when it differs.
import { CompileError } from "../compiler/diag.fsh";
import { directive, fix, migrations, rejects, surveyHits, type Hit, type Parsed } from "../compiler/migrate.fsh";
import { parse, parseWithComments, type Stmt } from "../compiler/parser.fsh";
import { same } from "./support.fsh";

// Fails the test with both lists shown when they differ.
function list(got: Ref<string[]>, want: Ref<string[]>, what: string): void {
  assert(got === want, `${what}:\n--- expected\n${want.join("\n")}\n--- got\n${got.join("\n")}`);
}

function program(src: string): Stmt[] {
  try {
    return parse(src, { last: 0 });
  } catch (e) {
    assert(false, `${src} doesn't parse: ${e.message}`);
    return [];
  }
}

function parsedOf(src: string): Parsed {
  try {
    return parseWithComments(src, { last: 0 });
  } catch (e) {
    assert(false, `${src} doesn't parse: ${e.message}`);
    return { program: [], comments: [], tokens: [] };
  }
}

function migrationsOf(src: string): Hit[] {
  return migrations(parsedOf(src), src);
}

// `found` in source order, by start and then by end.
function inOrder(found: Hit[]): Hit[] {
  let xs = found;
  xs.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
  return xs;
}

function spanned(src: string, h: Ref<Hit>): string {
  return src.slice(h.start as i64, h.end as i64);
}

// Each hit in `src` as its rule and the text it spans, in source order.
function hits(src: string): string[] {
  return inOrder(rejects(program(src))).map((h) => `${h.rule} ${spanned(src, h)}`);
}

// The directive of `src` as its edition and span, or what it throws.
function directiveOf(src: string): string {
  try {
    const d = directive(src);
    return d === undefined ? "none" : `${d.edition} ${d.start} ${d.end}`;
  } catch (e) {
    return `throws ${e.message}`;
  }
}

test("R1 finds eval, Function and new Function", () => {
  list(hits('eval("1");\nconst f = Function("x");\nconst g = new Function("a", "return a");\n'), ["R1 eval", "R1 Function", "R1 new Function"], "calls");
  list(hits("const e = evaluate(1);\nconst f = obj.eval(1);\n"), [], "other names");
});

test("R2 finds prototype members and the Object calls that reshape a type", () => {
  list(hits('A.prototype.m = f;\nObject.defineProperty(o, "k", {});\nObject.defineProperties(o, {});\nObject.setPrototypeOf(o, p);\n'), ["R2 A.prototype", "R2 defineProperty", "R2 defineProperties", "R2 setPrototypeOf"], "reshaping");
  list(hits("const k = Object.keys(o);\nclass Shape { prototype = 1; }\nconst n = Shape.prototype;\n"), [], "others");
});

test("R3 finds delete", () => {
  list(hits('delete o.k;\ndelete o["k"];\n'), ["R3 delete o.k", 'R3 delete o["k"]'], "delete");
  list(hits("m.delete(k);\n"), [], "a delete method");
});

test("R5 finds the arguments object, but not a binding of that name", () => {
  list(hits("function f() {\n  return arguments[0];\n}\n"), ["R5 arguments"], "arguments");
  list(hits("function f(...arguments: number[]) {\n  return arguments[0];\n}\n"), [], "a rest parameter");
  list(hits("const arguments = [1];\nconst n = arguments.length;\n"), [], "a const");
});

test("R6 finds Symbol, but not a name the file declares", () => {
  list(hits('const s = Symbol("s");\nclass C {\n  *[Symbol.asyncIterator]() {}\n}\nlet t: Symbol;\n'), ["R6 Symbol", "R6 Symbol", "R6 Symbol"], "Symbol");
  list(hits("class C {\n  *[Symbol.iterator]() {}\n}\ninterface I {\n  [Symbol.iterator](): Iterator<i64>;\n}\nconst it = c[Symbol.iterator]();\nconst o = { [Symbol.iterator]: 1 };\n"), ["R6 Symbol"], "Symbol.iterator");
  list(hits('import { Symbol } from "./symbols";\nconst s = Symbol(1);\n'), [], "an import");
  list(hits("class Symbol {}\nconst s = new Symbol();\nconst t: symbol = u;\n"), [], "a class");
});

test("R7 finds declarations TypeScript merges, and module augmentation", () => {
  const src = 'interface I { a: number }\nexport interface I { b: number }\nclass C {}\ninterface C { x: number }\nfunction f() {}\nnamespace f { export const y = 1; }\nnamespace N {}\nnamespace N {}\nenum E { A }\nenum E { B = 1 }\ndeclare module "m" { export const x: number; }\ndeclare global { var g: number; }\n';
  list(hits(src).map((h) => h.split("\n")[0]!), [
    "R7 export interface I { b: number }", "R7 interface C { x: number }", "R7 namespace f { export const y = 1; }",
    "R7 namespace N {}", "R7 enum E { B = 1 }", 'R7 module "m" { export const x: number; }', "R7 global { var g: number; }",
  ], "merged");
  list(hits("interface I { a: number }\ninterface J { a: number }\nfunction g(): void;\nfunction g(x?: number) {}\nfunction h() {\n  interface I { b: number }\n}\n"), [], "not merged");
});

test("the edition directive is the first line, or the second after a shebang", () => {
  same(directiveOf("// @fish-edition ts-compat\nconst a = 1;\n"), "ts-compat 0 26", "the first line");
  same(directiveOf("#!/usr/bin/env fishc\r\n// @fish-edition native\r\n"), "native 22 45", "after a shebang");
  same(directiveOf("const a = 1;\n// @fish-edition ts-compat\n"), "none", "a later line");
  same(directiveOf("// a comment\n"), "none", "a comment");
  assert(directiveOf("// @fish-edition  native\n").startsWith("throws "), "two spaces don't throw");
  const bad = directiveOf("//@fish-edition ts\n");
  assert(bad.startsWith("throws ") && bad.includes("an edition directive is written '// @fish-edition native' or '// @fish-edition ts-compat'"), `no space: ${bad}`);
});

test("only a class's own prototype member keeps its .prototype from counting", () => {
  list(hits("const o = { prototype: 1 };\nFoo.prototype.x = 1;\n"), ["R2 Foo.prototype"], "an object's");
  list(hits("type T = { prototype: number };\nFoo.prototype.x = 1;\n"), ["R2 Foo.prototype"], "a type's");
  list(hits("class Shape {\n  prototype = 1;\n}\nconst a = Shape.prototype;\nconst b = Other.prototype;\n"), ["R2 Other.prototype"], "a field");
  list(hits("class Shape {\n  get prototype() {\n    return 1;\n  }\n}\nconst a = Shape.prototype;\n"), [], "a getter");
});

test("R7 finds an enum merged with a namespace, and declarations under export default", () => {
  list(hits("enum E { A }\nnamespace E {}\n"), ["R7 namespace E {}"], "an enum");
  list(hits("export default class A {}\ninterface A {}\n"), ["R7 interface A {}"], "a default class");
  list(hits("interface B {}\nexport default function B() {}\n"), ["R7 export default function B() {}"], "a default function");
  list(hits("export default function C() {}\nnamespace C {}\n"), ["R7 namespace C {}"], "a namespace");
});

// Bun's test builds the million-element array as nodes; a Fish object literal of the AST's
// recursive types isn't taken where an `Expr` is, so here the parser makes it.
test("a very long array is walked without overflowing the stack", () => {
  const found = rejects(program(`[${"1,".repeat(1000000)}];\n`));
  assert(found.length === 0, `${found.length} hits`);
});

test("a comment that only starts like the directive is an ordinary comment", () => {
  same(directiveOf("// @fish-edition-foo native\n"), "none", "a longer name");
  same(directiveOf("// @fish-editions\n"), "none", "a plural");
  assert(directiveOf("// @fish-edition\n").startsWith("throws "), "no edition doesn't throw");
});

// Each auto or guided hit in `src` as its action and rule and the text it spans, in source order.
function found(src: string): string[] {
  return inOrder(migrationsOf(src).filter((h) => h.action !== "reject")).map((h) => `${h.action} ${h.rule} ${spanned(src, h)}`);
}

function fixed(src: string): string {
  try {
    return fix(src).text;
  } catch (e) {
    assert(false, `fixing ${src} throws ${e.message}`);
    return "";
  }
}

function fixedCount(src: string): usize {
  try {
    return fix(src).fixed;
  } catch (e) {
    assert(false, `fixing throws ${e.message}`);
    return 0;
  }
}

test("A1 makes a var const when nothing assigns it again, and let otherwise", () => {
  list(found("var a = 1;\nvar b = 2;\nb = 3;\nvar c;\nfor (var i = 0; i < 3; i++) {}\n"), ["auto A1 var", "auto A1 var", "guided G7 b = 3", "auto A1 var", "auto A1 var"], "hits");
  same(fixed("var a = 1;\nvar b = 2;\nb = 3;\nvar c;\nfor (var i = 0; i < 3; i++) {}\nvar [d, e] = f;\n[d] = g;\n"), "const a = 1;\nlet b = 2;\nb = 3;\nlet c;\nfor (let i = 0; i < 3; i++) {}\nlet [d, e] = f;\n[d] = g;\n", "fixed");
  list(found("declare var g: number;\nlet h = 1;\nconst k = 2;\n"), [], "no var");
});

test("A3 makes == strict when both sides' types show, and reports any other", () => {
  const src = 'const s = "a";\nconst n = 1;\nconst x = s == "b" && n != 2 && typeof v == "string" && xs.length == 0 && true != false;\nconst y = u == v || s == n || w == null;\n';
  list(found(src), [
    'auto A3 s == "b"', "auto A3 n != 2", 'auto A3 typeof v == "string"', "auto A3 xs.length == 0", "auto A3 true != false",
    "guided A3 u == v", "guided A3 s == n", "guided A3 w == null",
  ], "hits");
  same(fixed(src), 'const s = "a";\nconst n = 1;\nconst x = s === "b" && n !== 2 && typeof v === "string" && xs.length === 0 && true !== false;\nconst y = u == v || s == n || w == null;\n', "fixed");
});

test("A8 moves the type of a JSON.parse cast into its type argument", () => {
  same(fixed("const u = JSON.parse(text) as User;\nconst v = JSON.parse(text);\nconst w = other.parse(t) as User;\n"), "const u = JSON.parse<User>(text);\nconst v = JSON.parse(text);\nconst w = other.parse(t) as User;\n", "fixed");
});

test("A9 makes a function expression an arrow function unless it uses its own this", () => {
  const src = "const a = function (x: number): number {\n  return x;\n};\nconst b = async function named(){ return 1; };\nconst c = function () { return this.n; };\nconst d = function* () { yield 1; };\nconst e = function f(n: number): number { return n > 0 ? f(n - 1) : 0; };\nconst g = function () { return arguments.length; };\n";
  list(found(src), ["auto A9 function ", "auto A9 async function named"], "hits");
  same(fixed(src).split("\n").slice(0, 4).join("\n"), "const a = (x: number): number => {\n  return x;\n};\nconst b = async () => { return 1; };", "fixed");
});

test("A10 renames a relative .ts import to .fsh, and leaves other specifiers", () => {
  const src = 'import { a } from "./a.ts";\nexport * from "../b/c.ts";\nexport { d } from "./d.ts";\nimport e from "e.ts";\nimport f from "./f";\nimport type { G } from "./g.d.ts";\n';
  list(found(src), ['auto A10 "./a.ts"', 'auto A10 "../b/c.ts"', 'auto A10 "./d.ts"'], "hits");
  same(fixed(src), 'import { a } from "./a.fsh";\nexport * from "../b/c.fsh";\nexport { d } from "./d.fsh";\nimport e from "e.ts";\nimport f from "./f";\nimport type { G } from "./g.d.ts";\n', "fixed");
});

test("A2 makes nullable types and optional properties and parameters Options, leaving ?. and ?? as written", () => {
  const src = 'interface U {\n  a: string | null;\n  b?: number;\n  c: undefined | Date | null;\n}\nfunction f(x?: string, y?: number | undefined, z: (string | undefined)[] = []): string {\n  return x?.trim() ?? y?.toString() ?? z[0] ?? "";\n}\n';
  same(fixed(src), 'interface U {\n  a: Option<string>;\n  b: Option<number>;\n  c: Option<Date>;\n}\nfunction f(x: Option<string>, y: Option<number>, z: (Option<string>)[] = []): string {\n  return x?.trim() ?? y?.toString() ?? z[0] ?? "";\n}\n', "fixed");
  same(fixed("function g(p?: (A | B)[]) {}\n"), "function g(p: Option<(A | B)[]>) {}\n", "an optional array");
  same(fixed("let q: (string | number)[] | undefined;\nlet r: null | (() => void);\nconst s = JSON.parse(t) as (A | B)[];\n"), "let q: Option<(string | number)[]>;\nlet r: Option<(() => void)>;\nconst s = JSON.parse<(A | B)[]>(t);\n", "parenthesised");
  list(found("let a: string;\nlet b: null;\n"), [], "not nullable");
});

test("A4 makes a top-level counter an Atomic, and leaves a let used any other way", () => {
  const src = "let hits = 0;\nfunction hit() {\n  hits++;\n  hits += 5;\n  hits--;\n  hits -= 2;\n  console.log(hits);\n}\n";
  same(fixed(src), "const hits = new Atomic(0);\nfunction hit() {\n  hits.add(1);\n  hits.add(5);\n  hits.sub(1);\n  hits.sub(2);\n  console.log(hits.load());\n}\n", "fixed");
  same(fixed("let n: number = -1;\nn++;\n"), "const n = new Atomic(-1);\nn.add(1);\n", "annotated");
  const others = ["let a = 0;\na = 5;\n", "let a = 0;\nconst b = a++;\n", "let a = 0;\na *= 2;\n", "let a = 0;\na += b;\n", 'let a = "x";\n', "let a = 0, b = 1;\n", "let a = 0;\nfunction f(a: number) { a++; }\n", "let a = 0;\nconst o = { a };\n", "function f() {\n  let a = 0;\n  a++;\n}\n"];
  for (const other of others) list(found(other).filter((h) => h.startsWith("auto A4")), [], other);
});

test("A5 borrows an object parameter only read as Ref, marked for review", () => {
  const src = 'type Point = { x: number };\ninterface Shape { area: number }\nfunction f(p: Point, s: Shape, xs: number[], m: Map<string, number>, t: [number, string], o: { a: number }) {\n  return p.x + s.area + xs[0] + m.get("a") + t[0] + o.a + size(p);\n}\n';
  same(fixed(src), 'type Point = { x: number };\ninterface Shape { area: number }\nfunction f(p: Ref<Point> /* fish: review */, s: Ref<Shape> /* fish: review */, xs: Ref<number[]> /* fish: review */, m: Ref<Map<string, number>> /* fish: review */, t: Ref<[number, string]> /* fish: review */, o: Ref<{ a: number }> /* fish: review */) {\n  return p.x + s.area + xs[0] + m.get("a") + t[0] + o.a + size(p);\n}\n', "fixed");
});

test("A6 borrows a changed object parameter as Mut, for each kind of change", () => {
  let changes = ["p.x = 1", "p.x += 1", "p.x++", "--p.inner.y", "p[0] = 1", "delete p.x"];
  for (const m of ["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin", "set", "delete", "clear", "add"]) changes.push(`p.${m}(1)`);
  changes.push("p.items.push(1)");
  for (const change of changes) same(fixed(`function f(p: Thing) {\n  ${change};\n}\n`), `function f(p: Mut<Thing> /* fish: review */) {\n  ${change};\n}\n`, change);
});

test("A5 and A6 leave primitives, generics, owned and already-borrowed parameters alone", () => {
  const src = 'type Id = string;\nenum Color { Red }\nfunction f<T>(n: number, s: string, b: boolean, id: Id, c: Color, t: T, u: "a" | "b", g: (x: number) => void, kept: Thing, back: Thing, r: Ref<Thing>, d: Thing = make(), o?: Thing, ...rest: Thing[]) {\n  store.add(kept);\n  this.items = [kept];\n  return back;\n}\nfunction unused(p: Thing) {}\ntype F = (p: Thing) => void;\n';
  list(found(src).filter((h) => /A[56]/.test(h)), [], "parameters");
  list(found("class C {\n  constructor(p: Thing) {\n    this.p = p;\n  }\n}\n").filter((h) => /A[56]/.test(h)), [], "a constructor's");
});

test("A7 gives a method changing its fields a Mut receiver, marked for review", () => {
  const src = "class Counter {\n  n = 0;\n  items: number[] = [];\n  inc(): void {\n    this.n++;\n  }\n  @log add<T>(x: number) {\n    this.items.push(x);\n  }\n  read(): number {\n    return this.n;\n  }\n  static make() {\n    this.count = 1;\n  }\n  later() {\n    return function () { this.n = 2; };\n  }\n  arrow() {\n    const f = () => { this.n = 3; };\n  }\n  given(this: Mut<this>) {\n    this.n = 4;\n  }\n}\n";
  const out = fixed(src);
  for (const line of ["  inc(this: Mut<this> /* fish: review */): void {\n", "  @log add<T>(this: Mut<this> /* fish: review */, x: number) {\n", "  arrow(this: Mut<this> /* fish: review */) {\n"]) assert(out.includes(line), `missing ${line} in:\n${out}`);
  list(found("const o = {\n  n: 0,\n  inc() {\n    this.n++;\n  },\n};\n"), [], "an object literal's method");
  for (const kept of ["  read(): number {", "  static make() {", "  later() {", "  given(this: Mut<this>) {"]) assert(out.includes(kept), `missing ${kept} in:\n${out}`);
});

test("A7 lends a chaining method's this return type as Mut<this>", () => {
  const out = fixed("class B {\n  n = 0;\n  add(x: number): this {\n    this.n += x;\n    return this;\n  }\n}\n");
  assert(out.includes("  add(this: Mut<this> /* fish: review */, x: number): Mut<this> {\n"), out);
});

test("a review marker left in the file is reported as guided until it is removed", () => {
  const src = 'function f(p: Ref<Thing> /* fish: review */, q: Mut<Thing> /* fish: review */) {\n  q.x = p.x;\n}\nclass C {\n  m(this: Mut<this> /* fish: review */) {}\n}\n// /* fish: review */\nconst s = "/* fish: review */";\n';
  list(found(src), ["guided A5 /* fish: review */", "guided A6 /* fish: review */", "guided A6 /* fish: review */"], "hits");
  same(fixed(src), src, "fixed");
  assert(fixedCount(src) === 0, "something was fixed");
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
    const got = fixed(src);
    same(got, out, src);
    try {
      parse(got, { last: 0 });
    } catch (e) {
      assert(false, `${got} doesn't parse: ${e.message}`);
    }
  }
});

test("A9 makes an arrow only where an arrow function means the same and parses", () => {
  const unsafe = ["const f = function () { return 1; }.bind(this);\n", "const f = function () { return 1; }.call(o);\n", "const f = a || function () {};\n", "(function () { go(); })();\n", "const o = new function () {}();\n", "x = function () { return 1 }\n(1);\n", "const f = c ? function () {} : null;\n", "class A { f = function () {}; }\n"];
  for (const src of unsafe) same(fixed(src), src, src);
  const safe = ["g(function () {});\n", "const f = function () {};\n", "f = function () {};\n", "function h() {\n  return function () {};\n}\n", "const o = { f: function () {} };\n", "const a = [function () {}];\n", "g((function () {}));\n"];
  for (const src of safe) {
    const got = fixed(src);
    assert(!got.includes("function ()"), `${src} gave ${got}`);
  }
});

test("A9 leaves a function constructed or given a prototype under its name", () => {
  for (const src of ["const F = function () {};\nconst o = new F();\n", "const F = function () {};\nF.prototype.x = 1;\n", "let G;\nG = function () {};\nnew G();\n"]) same(fixed(src), src, src);
});

// Each A1 hit in `src` as its action and the reason its message gives.
function a1(src: string): string[] {
  return migrationsOf(src).filter((h) => h.rule === "A1").map((h) => {
    const parts = (h.message ?? "").split(": ");
    return `${h.action}: ${parts.length > 1 ? parts[1]! : ""}`;
  });
}

test("A1 rewrites a var only where function scoping can't matter, and says why otherwise", () => {
  const reason = (why: string) => `guided: ${why}; rename or move it, then use 'let' or 'const'`;
  list(a1("for (var i = 0; i < 3; i++) {\n  fs.push(() => i);\n}\n"), [reason("a closure in the loop captures it")], "a closure");
  list(a1("var x = 1;\nif (c) {\n  var x = 2;\n}\n"), [reason("it is declared again in the same function"), reason("it is declared again in the same function")], "declared twice");
  list(a1("if (c) {\n  var x = 1;\n}\nconsole.log(x);\n"), [reason("it is used outside the block it is declared in")], "used outside");
  list(a1("try {\n  var r = 1;\n} catch {\n  r = 2;\n}\n"), [reason("it is used outside the block it is declared in")], "used in catch");
  list(a1("console.log(x);\nvar x = 1;\n"), [reason("it is used before its declaration")], "used before");
  list(a1("f();\nvar x = 1;\nfunction f() {\n  x = 2;\n}\n"), [reason("a function using it is called before its declaration")], "called before");
  list(a1("var x = 1;\nfunction x() {}\n"), [reason("it is declared again in the same function")], "a function");
  same(fixed("function x() {\n  var x = 1;\n  return x;\n}\n"), "function x() {\n  const x = 1;\n  return x;\n}\n", "inside a function of its name");
  list(a1("function f(x: number) {\n  var x = 2;\n}\n"), [reason("it is declared again in the same function")], "a parameter");
  same(fixed("function f() {\n  var x = 1;\n  for (var i = 0; i < 3; i++) {\n    x += i;\n  }\n  return x;\n}\nfunction g() {\n  var y = 2;\n  return () => y;\n}\n"), "function f() {\n  let x = 1;\n  for (let i = 0; i < 3; i++) {\n    x += i;\n  }\n  return x;\n}\nfunction g() {\n  const y = 2;\n  return () => y;\n}\n", "fixed");
});

test("A4 leaves a counter whose name is bound again by a catch, a function, a class, an enum or an import", () => {
  const rebound = ["try {} catch (n) {}", "function g() {\n  function n() {}\n}", "class n {}", "enum n { A }", 'import { n } from "./x.fsh";'];
  for (const other of rebound) same(fixed(`let n = 0;\nn++;\n${other}\n`), `let n = 0;\nn++;\n${other}\n`, other);
});

test("A4 leaves an exported counter", () => {
  for (const src of ["export let n = 0;\nn++;\n", "let n = 0;\nn++;\nexport { n };\n", "let n = 0;\nn++;\nexport default n;\n"]) same(fixed(src), src, src);
});

test("A4 is linear in the uses of a counter", () => {
  const src = `let n = 0;\nn++;\n${"console.log(n);\n".repeat(20000)}`;
  const started = performance.now();
  const count = fixedCount(src);
  const took = performance.now() - started;
  assert(count === 1, `${count} fixed`);
  assert(took < 5000, `took ${took} ms`);
});

test("A3 reads a name's literal only from a const, or a let nothing assigns, unannotated and bound once", () => {
  same(fixed('const a = "x";\nlet b = 1;\nconst ok = a == "y" && b == 2;\n'), 'const a = "x";\nlet b = 1;\nconst ok = a === "y" && b === 2;\n', "fixed");
  for (const src of ['let a = "x";\na = y;\nconst k = a == "y";\n', 'const a: any = "x";\nconst k = a == "y";\n', 'const a = "x";\nfunction f(a: any) {\n  return a == "y";\n}\n', 'const a = "x";\ntry {} catch (a) {\n  g(a == "y");\n}\n']) {
    same(fixed(src), src, src);
  }
});

test("A6 finds changes through Object.assign, destructuring, the file's Mut functions and methods, and aliases of this", () => {
  list(found("function f(p: Pt) {\n  Object.assign(p, { x: 1 });\n}\n"), ["auto A6 Pt"], "Object.assign");
  list(found("function f(p: Pt) {\n  [p.x, p.y] = [1, 2];\n}\n"), ["auto A6 Pt"], "destructuring");
  list(found("function set(q: Pt) {\n  q.x = 1;\n}\nfunction pass(r: Pt) {\n  set(r);\n}\nfunction twice(s: Pt) {\n  pass(s);\n}\n"), ["auto A6 Pt", "auto A6 Pt", "auto A6 Pt"], "functions");
  list(found("function g(q: Mut<Pt>) {}\nfunction f(p: Pt) {\n  g(p);\n}\n"), ["auto A6 Pt"], "a Mut parameter");
  const methods = "class Pt {\n  x = 0;\n  bump() {\n    this.x++;\n  }\n  twice() {\n    this.bump();\n  }\n  aliased() {\n    const self = this;\n    self.x = 2;\n  }\n}\nfunction f(p: Pt) {\n  p.twice();\n}\n";
  list(found(methods), ["auto A7 bump(", "auto A7 twice(", "auto A7 aliased(", "auto A6 Pt"], "methods");
});

test("A10 renames an import only when its .fsh is there or being made, and never one with attributes", () => {
  const src = 'import { a } from "./a.ts";\nimport { b } from "./b.ts";\nimport c from "./c.ts" with { type: "json" };\n';
  let text = "";
  try {
    text = fix(src, (s: string): "rename" | "ambiguous" | undefined => (s !== "./b.ts" ? "rename" : undefined)).text;
  } catch (e) {
    assert(false, e.message);
  }
  same(text, 'import { a } from "./a.fsh";\nimport { b } from "./b.ts";\nimport c from "./c.ts" with { type: "json" };\n', "fixed");
});

test("the survey's hits come without edits, A3 counted fixable or not", () => {
  const given = surveyHits(program("var a = 1;\nconst b = a == 1 || x != y;\nconst u = JSON.parse(s) as U;\n"));
  let rules = given.map((h) => h.rule);
  rules.sort();
  list(rules, ["A1", "A3", "A3", "A8"], "rules");
  assert(!given.some((h) => h.edits !== undefined), "a hit has edits");
});

test("A1 leaves a var in a loop whose value carries from one turn to the next", () => {
  const reason = "guided: its value carries from one turn of the loop to the next; rename or move it, then use 'let' or 'const'";
  for (const src of ["for (let i = 0; i < 3; i++) {\n  var last;\n  if (i > 0) console.log(last);\n  last = i;\n}\n", "while (c) {\n  var seen;\n  if (seen) break;\n  seen = true;\n}\n", "while (c) {\n  var n = n + 1;\n  use(n);\n}\n", "for (const x of xs) {\n  if (c) {\n    var k;\n  }\n}\n"]) {
    list(a1(src), [reason], src);
    same(fixed(src), src, src);
  }
  same(fixed("for (const x of xs) {\n  var y = x * 2;\n  use(y);\n}\n"), "for (const x of xs) {\n  const y = x * 2;\n  use(y);\n}\n", "fixed");
});

test("A1's scope check is linear in the file", () => {
  let parts: string[] = [];
  for (let i: i64 = 0; i < 8000; i++) parts.push(`function f${i}() {\n  var a = 1;\n  var b = a + 1;\n  return b;\n}\n`);
  const src = parts.join("");
  const started = performance.now();
  const count = fixedCount(src);
  const took = performance.now() - started;
  assert(count === 16000, `${count} fixed`);
  assert(took < 5000, `took ${took} ms`);
});

test("A9 after return keeps the arrow on the return's line", () => {
  same(fixed("function g() {\n  return function\n  (x) { return x; };\n}\n"), "function g() {\n  return (x) => { return x; };\n}\n", "unnamed");
  same(fixed("function g() {\n  return function h\n  (x) { return x; };\n}\n"), "function g() {\n  return (x) => { return x; };\n}\n", "named");
  const commented = "function g() {\n  return function // c\n  (x) { return x; };\n}\n";
  same(fixed(commented), commented, "commented");
});

test("A9 leaves a property's function constructed through the object", () => {
  const src = "const o = { f: function () { return 1; } };\nnew o.f();\n";
  same(fixed(src), src, "fixed");
});

test("a fix a comment blocks is reported as one to make by hand", () => {
  const src = "let x: string /* | */ | null;\n";
  const a2 = migrationsOf(src).filter((h) => h.rule === "A2");
  assert(a2.length > 0, "no A2 hit");
  const hit: Ref<Hit> = a2[0]!;
  assert(hit.edits === undefined, "the hit has edits");
  same(hit.message ?? "", "a comment sits where this change would go, so it can't be made automatically; make it by hand: 'string /* | */ | null' becomes 'Option<string>'", "the message");
});

test("collecting each name's uses is linear in the file", () => {
  let parts: string[] = [];
  for (let i: i64 = 0; i < 16000; i++) parts.push(`function f${i}() { let x = 1; for (let i = 0; i < 2; i++) x += i; return x; }`);
  const src = parts.join("\n");
  const started = performance.now();
  migrationsOf(src);
  const took = performance.now() - started;
  assert(took < 4000, `took ${took} ms`);
});

// Each guided hit in `src` as its rule and the text it spans, in source order, and the messages.
function guidedIn(src: string): string[] {
  let all = migrationsOf(src).filter((h) => h.action === "guided" && h.rule.startsWith("G"));
  all.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return all.map((h) => `${h.rule} ${spanned(src, h)}`);
}

function messageOf(src: string, rule: string): string {
  const all = migrationsOf(src);
  for (const h of all) if (h.rule === rule) return h.message ?? "(no message)";
  return "(no hit)";
}

function startingWith(xs: string[], prefix: string): string[] {
  return xs.filter((h) => h.startsWith(prefix));
}

test("G1 reports any, suggesting a concrete type, a union, unknown or Json", () => {
  list(guidedIn("function f(x: any): any[] {\n  return [x];\n}\n"), ["G1 any", "G1 any"], "hits");
  same(messageOf("let x: any;\n", "G1"), "'any' turns type checking off, which Fish doesn't do; choose a concrete type, a union, 'unknown' narrowed with 'typeof' or 'instanceof' before use, or the dynamic 'Json' value", "the message");
  list(guidedIn("let x: unknown;\nconst any = 1;\n"), [], "not any");
});

test("G4 reports a class extending one used as a type, and leaves a base never named as a type", () => {
  const src = "class Shape {}\nclass Circle extends Shape {}\nfunction area(s: Shape) {\n  return 1;\n}\n";
  list(guidedIn(src), ["G4 class Circle extends Shape {}"], "hits");
  same(messageOf(src, "G4"), "this class extends one that is also used as a type, so a subclass stands in for its base, which Fish's embedded bases don't allow; extract an interface for what they share, and hold the base as a field", "the message");
  for (const used of ["let s: Shape;", "class Box { s: Shape = new Circle(); }", "function make(): Shape[] {\n  return [];\n}"]) list(guidedIn(`class Shape {}\nclass Circle extends Shape {}\n${used}\n`), ["G4 class Circle extends Shape {}"], used);
  list(guidedIn("class Animal {}\nclass Dog extends Animal {}\nconst d: Dog = new Dog();\n"), [], "the subclass as a type");
  list(guidedIn("interface Named {}\nclass Base {}\nclass Thing extends Base implements Named {}\n"), [], "an interface");
});

test("G5 reports instanceof a class others extend, and leaves Error and classes nothing extends", () => {
  const src = "class Shape {}\nclass Circle extends Shape {}\nfunction f(x: object) {\n  return x instanceof Shape;\n}\n";
  list(guidedIn(src), ["G5 x instanceof Shape"], "hits");
  same(messageOf(src, "G5"), "'instanceof' tests a class that others extend, and Fish has no subclass checks at run time; 'match' on an interface or an enum instead", "the message");
  list(guidedIn("class Box {}\nfunction f(e: unknown) {\n  return e instanceof Error || e instanceof Box;\n}\n"), [], "Error and Box");
});

test("G6 reports a string key: a literal, a template, a string name or a for...in key; a numeric index is left", () => {
  const src = 'function f(o: Rec, k: string) {\n  const name = "a";\n  for (const key in o) g(o[key]);\n  return o["x"] + o[`y${1}`] + o[name] + o[k];\n}\n';
  list(guidedIn(src), ["G6 o[key]", 'G6 o["x"]', "G6 o[`y${1}`]", "G6 o[name]", "G6 o[k]"], "hits");
  same(messageOf(src, "G6"), "indexing with a string key, or testing one with 'in' that isn't written as a literal, reads the object as a dictionary, which a Fish object isn't; declare it as one, '{ [k: string]: T }' or 'Record<string, T>', or use a 'Map<string, T>'", "the message");
  list(startingWith(guidedIn("function f(xs: number[], i: number) {\n  const j = 2;\n  return xs[0] + xs[i] + xs[j];\n}\n"), "G6"), [], "numeric indexes");
});

test("G6 reports 'in' with any key but a string literal, as the checker refuses them; a string literal narrows, so it is left", () => {
  const src = 'function f(o: Rec, k: string, xs: number[]) {\n  return k in o || "a" in o || 0 in xs;\n}\n';
  list(guidedIn(src), ["G6 k in o", "G6 0 in xs"], "hits");
});

test("G6 and R3 leave a dictionary: a name declared with an index signature, 'Record<string, V>' or an alias of one, or a field its class declares so", () => {
  const src = 'type D = { [k: string]: number };\nclass C {\n  items: Record<string, string> = {};\n  f(k: string) {\n    delete this.items[k];\n    return this.items[k];\n  }\n}\nclass E {\n  items: Rec;\n  f(k: string) {\n    return this.items[k];\n  }\n}\nfunction f(a: D, b: { [k: string]: number }, c: Rec, k: string) {\n  delete a[k];\n  delete c.x;\n  return a[k] + b[k] + c[k] + (k in a ? 1 : 0) + (k in c ? 1 : 0);\n}\n';
  let all = surveyHits(program(src)).filter((h) => h.rule === "G6" || h.rule === "R3");
  all.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  list(all.map((h) => `${h.rule} ${spanned(src, h)}`), ["G6 this.items[k]", "R3 delete c.x", "G6 c[k]", "G6 k in c"], "hits");
});

test("G7 reports top-level code with side effects, suggesting main() or a Lazy", () => {
  list(guidedIn('"use strict";\nsetup();\nfunction main() {}\nmain();\nmain().catch(report);\n'), ["G7 setup()"], "hits");
  same(messageOf("setup();\n", "G7"), "top-level code runs when the module loads, which Fish doesn't do; move it into 'main()', or into a 'Lazy<T>' for a value made once", "the message");
});

test("G8 reports isNaN of a parse, direct or through a name, and leaves isNaN of a plain value", () => {
  const src = "function f(s: string, x: number) {\n  const n = parseInt(s);\n  return isNaN(parseFloat(s)) || Number.isNaN(Number(s)) || isNaN(n) || Number.isNaN(Number.parseInt(s));\n}\n";
  list(guidedIn(src), ["G8 isNaN(parseFloat(s))", "G8 isNaN(Number(s))", "G8 isNaN(n)", "G8 isNaN(Number.parseInt(s))"], "hits");
  same(messageOf(src, "G8"), "parsing gives an 'Option' in Fish rather than NaN; 'match' on the parsed 'Option' instead of checking 'isNaN'", "the message");
  list(guidedIn("function f(x: number) {\n  const y = x * 2;\n  return isNaN(x) || Number.isNaN(y);\n}\n"), [], "plain values");
});

test("G9 reports .call, .apply and .bind, and G10 an async forEach callback", () => {
  const src = "function f(g: Fn, xs: number[]) {\n  g.call(o, 1);\n  g.apply(o, []);\n  const h = g.bind(o);\n  xs.forEach(async (x) => {\n    await h(x);\n  });\n  xs.forEach((x) => h(x));\n}\n";
  list(guidedIn(src), ["G9 call(o, 1)", "G9 apply(o, [])", "G9 bind(o)", "G10 forEach(async (x) => {\n    await h(x);\n  })"], "hits");
  same(messageOf(src, "G9"), "'.call', '.apply' and '.bind' choose a function's 'this' at run time; pass the receiver as an argument, or use a closure", "G9's message");
  same(messageOf(src, "G10"), "'forEach' doesn't wait for an async callback; use 'for...of' with 'await', or spawn a task for each", "G10's message");
});

test("guided hits are never fixed", () => {
  const src = "let x: any = 1;\nsetup();\n";
  same(fixed(src), src, "fixed");
  assert(fixedCount(src) === 0, "something was fixed");
  assert(migrationsOf(src).filter((h) => h.action === "guided").every((h) => h.edits === undefined), "a guided hit has edits");
});

test("G2 reports a dropped call to the file's async function or Promise method, and leaves one awaited, returned, assigned or voided", () => {
  const decls = "async function save(): Promise<void> {}\nconst load = async () => 1;\nclass Store {\n  flush(): Promise<void> {\n    return done;\n  }\n}\n";
  const src = `${decls}async function main() {\n  const store = new Store();\n  save();\n  load();\n  store.flush();\n  await save();\n  void save();\n  const p = save();\n  later = load();\n  sync();\n  return save();\n}\n`;
  list(startingWith(guidedIn(src), "G2"), ["G2 save()", "G2 load()", "G2 store.flush()"], "hits");
  same(messageOf(src, "G2"), "the promise this call gives is dropped, and a Fish future runs only when it is awaited; add 'await', or wrap the call in 'spawn()' to run it on its own", "the message");
});

test("G3 reports a number used as an index or as a counter against .length, and leaves one used only in arithmetic", () => {
  const src = "function f(xs: number[], at: number, scale: number) {\n  let total = 0;\n  for (let i = 0; i < xs.length; i++) total += xs[at] * scale;\n  let k: number = 1;\n  return xs[k] + total * scale;\n}\n";
  list(startingWith(guidedIn(src), "G3"), ["G3 at", "G3 i", "G3 k"], "hits");
  same(messageOf(src, "G3"), "this 'number' counts or indexes, and a Fish 'number' is a float; make it 'i64', or 'usize' for an index", "the message");
  list(startingWith(guidedIn("function f(a: number, b: number) {\n  let c = a * b;\n  return c + 1;\n}\n"), "G3"), [], "arithmetic");
  list(startingWith(guidedIn("let i = 0;\nfunction g(xs: string[], i: string) {\n  return xs[0] + i;\n}\n"), "G3"), [], "a string parameter");
});

test("G11 reports an alias changed through one name while the other is still used, naming the three fixes", () => {
  const fixes = "hold one value, changed through one while the other is still used, which Fish's ownership refuses; share it as 'shared<T>', give one its own '.clone()', or restructure so one name is used at a time";
  const flagged = [
    "function f() {\n  const a = { n: 1 };\n  const b = a;\n  b.n = 2;\n  return a.n;\n}\n",
    "function f() {\n  const a = [1];\n  const b = a;\n  a.push(2);\n  return b.length;\n}\n",
    "function f() {\n  const a = new Box();\n  let b = make();\n  b = a;\n  b.n++;\n  use(a);\n}\n",
    "function f() {\n  const a = load();\n  const b = a;\n  Object.assign(a, { n: 1 });\n  delete b.k;\n  use(b);\n}\n",
  ];
  for (const src of flagged) {
    const g11 = startingWith(guidedIn(src), "G11");
    assert(g11.length === 1, `${src}: ${g11.length} G11 hits`);
    const message = messageOf(src, "G11");
    assert(/^'b' and 'a' /.test(message), `${src}: ${message}`);
  }
  same(messageOf(flagged[0]!, "G11"), `'b' and 'a' ${fixes}`, "the message");
  list(startingWith(guidedIn(flagged[0]!), "G11"), ["G11 b = a"], "the first's hit");
  const left = [
    "function f() {\n  const a = 1;\n  let b = a;\n  b++;\n  return a;\n}\n",
    "function f() {\n  const a = { n: 1 };\n  const b = a;\n  return a.n + b.n;\n}\n",
    "function f() {\n  const a = { n: 1 };\n  const b = a;\n  use(a);\n  b.n = 2;\n  return b;\n}\n",
    "function f(a: Thing) {\n  const b = a;\n  b.n = 2;\n  return a;\n}\n",
  ];
  for (const src of left) list(startingWith(guidedIn(src), "G11"), [], src);
});

test("the guided rules are linear in the file", () => {
  let parts: string[] = [];
  for (let i: i64 = 0; i < 8000; i++) parts.push(`function f${i}(xs: string, i: number) {\n  const a = { n: i };\n  const b = a;\n  b.n = 2;\n  for (let j = 0; j < xs.length; j++) g(xs[i] + a.n);\n  save();\n}\n`);
  const src = parts.join("");
  const started = performance.now();
  const g11 = migrationsOf(src).filter((h) => h.rule === "G11").length;
  const took = performance.now() - started;
  assert(g11 === 8000, `${g11} G11 hits`);
  assert(took < 5000, `took ${took} ms`);
});

test("G2 finds async class methods, object-literal methods and interface or type methods giving a Promise", () => {
  const src = "class Store {\n  async save(): Promise<void> {}\n  async flush() {}\n}\nconst api = {\n  async post() {},\n  put: async () => 1,\n};\ninterface Remote {\n  send(): Promise<void>;\n}\ntype Peer = { ping(): Promise<void> };\nfunction run(s: Store, r: Remote, p: Peer) {\n  s.flush();\n  api.post();\n  api.put();\n  r.send();\n  p.ping();\n}\n";
  list(startingWith(guidedIn(src), "G2"), ["G2 s.flush()", "G2 api.post()", "G2 api.put()", "G2 r.send()", "G2 p.ping()"], "hits");
});

test("G2 ties a method call to its declaration through the receiver, and leaves an unknown receiver or an async generator", () => {
  const src = 'class Cache {\n  async set(k: string, v: string) {}\n  refresh() {\n    this.set("a", "b");\n  }\n}\nfunction f(m: Map<string, number>, c: Ref<Cache>, other: Thing) {\n  m.set("a", 1);\n  c.set("a", "b");\n  const made = new Cache();\n  made.set("a", "b");\n  other.set("a", "b");\n  unknown.set("a", "b");\n}\n';
  list(startingWith(guidedIn(src), "G2"), ['G2 this.set("a", "b")', 'G2 c.set("a", "b")', 'G2 made.set("a", "b")'], "hits");
  list(startingWith(guidedIn("async function* lines() {}\nclass A {\n  async *more() {}\n}\nfunction f(a: A) {\n  lines();\n  a.more();\n}\n"), "G2"), [], "async generators");
  list(startingWith(guidedIn("async function save() {}\nfunction f(save: () => void) {\n  save();\n}\n"), "G2"), [], "a parameter of the name");
});

test("G6 reads a name's string-ness from the binding it resolves to, and an index never gets both G6 and G3", () => {
  const src = "function a(o: Rec) {\n  for (const i in o) g(o[i]);\n}\nfunction b(xs: number[]) {\n  for (let i = 0; i < xs.length; i++) g(xs[i]);\n}\nfunction c(key: string) {\n  return key;\n}\nfunction d(xs: number[], key: number) {\n  return xs[key];\n}\n";
  list(guidedIn(src), ["G6 o[i]", "G3 i", "G3 key"], "hits");
});

test("G4 and G5 see through a generic base", () => {
  const src = "class Base<T> {}\nclass Sub extends Base<string> {}\nfunction f(b: Base<string>, x: object) {\n  return x instanceof Base;\n}\n";
  list(guidedIn(src), ["G4 class Sub extends Base<string> {}", "G5 x instanceof Base"], "hits");
});

test("G3 and G11 are linear in the uses of one name", () => {
  const n: usize = 16000;
  const blocks = `function f(xs: number[]) {\n${"  { let k = 0; g(xs[k]); }\n".repeat(n)}}\n`;
  let parts: string[] = [];
  for (let i: usize = 0; i < n; i++) parts.push(`  const b${i} = a;\n  a.n = ${i};\n  use(b${i});\n`);
  const aliases = `function h() {\n  const a = { n: 1 };\n${parts.join("")}}\n`;
  const started = performance.now();
  const g3 = migrationsOf(blocks).filter((h) => h.rule === "G3").length;
  const g11 = migrationsOf(aliases).filter((h) => h.rule === "G11").length;
  const took = performance.now() - started;
  assert(g3 === n, `${g3} G3 hits`);
  assert(g11 === n, `${g11} G11 hits`);
  assert(took < 5000, `took ${took} ms`);
});
