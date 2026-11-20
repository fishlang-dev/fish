// Programs type-checked against npm packages' declarations, built by the
// native fishc with `--emit-llvm`, which stops before clang. A compile error is what fishc
// prints, as `formatError` gives it.
// Four tests are left out until the native fishc stops crashing on what they build, where Bun's
// run of the compiler gives its answer: importing a function a declaration file declares more than
// once (two tests), a class passed where an interface names itself through an array, and an
// interface whose method takes and returns itself, made in one file and passed in another.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fishc, removed, same, scratch } from "./support.fsh";

// What stops a program that type-checks with a package's declarations: a form that can't run
// yet, or a package with no JS to bundle, as these fixtures have only declarations.
function typeChecked(out: string): boolean {
  return /(reading this package's const isn't supported yet|this call gives a package's function a value with no JS form yet|has no JS Fish could bundle|turning a Fish value into a JS value isn't supported yet)/.test(out);
}

function checks(out: string, what: string): void {
  assert(typeChecked(out), `${what}: expected the program to type-check, got:\n${out}`);
}

function has(out: string, part: string, what: string): void {
  assert(out.includes(part), `${what}: expected it to contain\n${part}\n--- got\n${out}`);
}

// Builds `main.fsh` in a project of these files, giving the compile error it stops at, with
// any note, as fishc prints it, or "built".
function stops(files: Ref<[string, string][]>): string {
  const dir = scratch("fish-npm-");
  for (const [path, contents] of files) {
    try {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), contents);
    } catch (e) {
      assert(false, `can't write ${path}: ${e.message}`);
    }
  }
  const run = fishc(dir, ["build", "main.fsh", "--emit-llvm"]);
  removed(dir);
  if (run.code === 0) return "built";
  const err = run.err.endsWith("\n") ? run.err.slice(0, -1) : run.err;
  return err.replaceAll(dir + "/", "");
}

function first(out: string): string {
  return out.split("\n")[0].replace(/^.*error\[\w+\]: /, "");
}

function caseD(): string {
  return `export declare function camelCase(s: string, keep?: boolean): string;
export declare function count(xs: string[]): number;
export declare function anyway(v: any): unknown;
export declare function each(f: (x: number) => void): void;
export declare function maybe(s: string | undefined): string | null;
export declare interface Options { deep: boolean }
`;
}

test("a package's functions type-check, and the program stops at its first use", () => {
  checks(stops([
    ["node_modules/case/index.d.ts", caseD()],
    ["main.fsh", `import { camelCase, count, anyway, maybe } from "case";
function main() {
  const s: string = camelCase("foo bar", true);
  const n: f64 = count(["a", s]);
  const v: JsValue = anyway(1.5);
  const w = anyway(v);
  const m: string | null = maybe(null);
  console.log(s, n);
}
`],
  ]), "the program");
});

test("a wrong argument is refused in TypeScript's terms", () => {
  has(stops([
    ["node_modules/case/index.d.ts", caseD()],
    ["main.fsh", "import { camelCase } from \"case\";\nfunction main() { const s = camelCase(5); }\n"],
  ]), "error[E0101]: argument of type 'i64' is not assignable to parameter of type 'string'", "the error");
});

test("a declaration Fish can't type is refused where it is declared, noting the call", () => {
  const out = stops([
    ["node_modules/case/index.d.ts", "export declare function counts(m: Map<string, number>): void;\n"],
    ["main.fsh", "import { counts } from \"case\";\nfunction main() { counts(new Map<string, f64>()); }\n"],
  ]);
  has(out, "node_modules/case/index.d.ts:1:35: error[E1005]: 'counts' from 'case' takes a 'Map<string, number>', which can't cross between Fish and JS yet: Fish has no JS form for it", "the error");
  has(out, "main.fsh:2:19: note: 'counts' is called here", "the note");
});

function lib(): string {
  return "export interface Options { deep?: boolean; name: string; nested?: Inner }\ninterface Inner { level: number }\nexport interface Result { readonly count: number; label: string; describe(prefix: string): string; parts(): string[] }\nexport declare function run(o: Options): Result;\nexport declare const VERSION: string;\nexport type Point = { x: number; y: number };\nexport declare function origin(): Point;\nexport declare function at(p: Point): string;\nexport declare class Box {\n  constructor(size: number, label?: string);\n  size: number;\n  readonly id: string;\n  grow(by: number): void;\n  static make(): Box;\n  static readonly MAX: number;\n  private secret: string;\n}\nexport declare function show(r: Result): void;\nexport declare function anything(v: any): void;\n";
}

test("consts, interfaces, object types and classes type-check as JS handles", () => {
  checks(stops([["node_modules/lib/index.d.ts", lib()], ["main.fsh", "import { run, VERSION, origin, at, Box, Options } from \"lib\";\nfunction main() {\n  const r = run({ name: \"x\", deep: true, nested: { level: 2 } });\n  const n: f64 = r.count;\n  r.label = \"new\";\n  const d: string = r.describe(\"p\");\n  const parts: string[] = r.parts();\n  const v: string = VERSION;\n  const p = origin();\n  const s: string = at(p);\n  const t: string = at({ x: 1.5, y: 2.5 });\n  const b = new Box(3, \"b\");\n  b.grow(2);\n  b.size = 4;\n  const id: string = b.id;\n  const m = Box.make();\n  const max: f64 = Box.MAX;\n  const o: Options = { name: \"kept\" };\n  run(o);\n}\n"]]), "the program");
});

function libRefused(body: string): string {
  return first(stops([["node_modules/lib/index.d.ts", lib()], ["main.fsh", `import { run, Box, show, anything } from "lib";\nfunction main() { ${body} }\n`]]));
}

test("a handle's members, a Fish value for a shape, and a class are refused in TypeScript's terms", () => {
  same(libRefused("run({ name: 5 });"), "argument of type '{ name: i64 }' is not assignable to parameter of type 'Options': property 'name' is a 'i64', not a 'string'", "a wrong field");
  same(libRefused("run({ deep: true });"), "argument of type '{ deep: boolean }' is not assignable to parameter of type 'Options': property 'name' is missing", "a missing field");
  same(libRefused("const r = run({ name: \"a\" }); r.count = 1;"), "'count' is read-only in its declaration", "a read-only write");
  same(libRefused("const r = run({ name: \"a\" }); const x = r.nope;"), "property 'nope' does not exist on type 'Result'", "a missing member");
  same(libRefused("const r = run({ name: \"a\" }); r.describe(1);"), "argument of type 'i64' is not assignable to parameter of type 'string'", "a method's wrong argument");
  same(libRefused("const r = run({ name: \"a\" }); const f = r.describe;"), "'describe' is a method of 'Result'; call it, as in 'r.describe(...)'", "a method as a value");
  same(libRefused("const b = new Box(\"x\");"), "argument of type '\"x\"' is not assignable to parameter of type 'number'", "a constructor's wrong argument");
  same(libRefused("const x = Box.nope;"), "property 'nope' does not exist on 'Box'", "a missing static");
  same(libRefused("show({ count: 1, label: \"l\" });"), "argument of type '{ count: i64; label: string }' is not assignable to parameter of type 'Result': its methods come only with a value JS made", "a Fish value for an interface with methods");
  checks(libRefused("const r = run({ name: \"a\" }); anything(r); anything([1, 2]); anything(\"s\");"), "values given as any");
});

test("a generic declaration is typed for each call's type arguments", () => {
  checks(stops([["node_modules/gen/index.d.ts", "export declare function chunk<T>(xs: T[], n: number): T[][];\nexport declare function first<T>(xs: T[]): T | undefined;\nexport declare function pair<A, B>(a: A, b: B): [A, B];\nexport declare function wrap<T>(v: T): { value: T };\n"], ["main.fsh", "import { chunk, first, pair, wrap } from \"gen\";\nfunction main() {\n  const c: string[][] = chunk([\"a\", \"b\", \"c\"], 2);\n  const n: f64[][] = chunk([1.5, 2.5], 1);\n  const f: string | null = first([\"x\"]);\n  const p: [string, boolean] = pair(\"s\", true);\n  const w = wrap(3.5);\n  const v: f64 = w.value;\n}\n"]]), "the program");
});

function whole(main: string): [string, string][] {
  return [
    ["node_modules/dflt/index.d.ts", "export default function slug(s: string): string;\n"],
    ["node_modules/ns/index.d.ts", "export declare function a(n: number): string;\nexport declare const b: boolean;\n"],
    ["node_modules/lodashy/index.d.ts", "declare namespace _ {\n  function chunk<T>(xs: T[], n: number): T[][];\n  const VERSION: string;\n}\nexport = _;\n"],
    ["node_modules/lo/index.d.ts", "interface LoDashStatic {\n  chunk<T>(xs: T[], size?: number): T[][];\n  camelCase(s?: string): string;\n  VERSION: string;\n}\ndeclare const _: LoDashStatic;\nexport = _;\n"],
    ["main.fsh", main],
  ];
}

test("default, namespace and export = imports reach a package's declarations", () => {
  checks(stops(whole("import slug from \"dflt\";\nimport * as ns from \"ns\";\nimport _ from \"lodashy\";\nimport { chunk } from \"lodashy\";\nfunction main() {\n  const s: string = slug(\"Hello World\");\n  const t: string = ns.a(1.5);\n  const u: boolean = ns.b;\n  const c: string[][] = _.chunk([\"a\", \"b\"], 1);\n  const v: string = _.VERSION;\n  const d: f64[][] = chunk([1.5], 1);\n}\n")), "the program");
  has(stops(whole("import * as ns from \"ns\";\nfunction main() { const x = ns.nope; }\n")), "main.fsh:2:29: error[E0902]: 'ns' has no export 'nope'", "a missing namespace member");
});

test("a const of an interface with generic methods, as lodash declares itself", () => {
  checks(stops(whole("import _ from \"lo\";\nfunction main() {\n  const c: string[][] = _.chunk([\"a\", \"b\"], 1);\n  const d: f64[][] = _.chunk([1.5]);\n  const s: string = _.camelCase(\"x y\");\n  const v: string = _.VERSION;\n}\n")), "the program");
});

function p(): string {
  return `export interface A { a: string }
export interface B { a: string; go(): string }
export declare function getA(): A;
export declare function takeB(b: B): void;
export interface S { each(f: (x: number) => void): void; read(): string }
export declare function s(): S;
export declare const VERSION: string;
export interface Base { a: string }
export interface Child extends Base { b: number }
export declare function child(): Child;
export declare class K1 { a: string }
export declare class K2 extends K1 { b: number }
export declare function f(s: string): string;
export declare function format(d: number): string;
export declare function format(d: string): string;
`;
}

test("a Fish value made a JsValue stops the program, and an import not called builds", () => {
  const made = first(stops([["node_modules/p/index.d.ts", p()], ["main.fsh", "function main() { const o: JsValue = 5; }\n"]]));
  assert(made.startsWith("turning a Fish value into a JS value isn't supported yet"), `a Fish value as a JsValue: ${made}`);
  same(stops([["node_modules/p/index.d.ts", p()], ["main.fsh", "import { f } from \"p\";\nfunction main() { console.log(\"hi\"); }\n"]]), "built", "an import not called");
});

function pRefused(body: string): string {
  return first(stops([["node_modules/p/index.d.ts", p()], ["main.fsh", `import { getA, takeB, s, VERSION, child, K2 } from "p";\nfunction main() { ${body} }\n`]]));
}

test("a handle's members cross only what can, and a handle passes only with the methods asked for", () => {
  // A method takes a callback as a package's function does; this fixture has no JS to run it.
  checks(pRefused("s().each((x) => {});"), "a method taking a callback");
  same(pRefused("takeB(getA());"), "argument of type 'A' is not assignable to parameter of type 'B': property 'go' is missing", "a handle without the method");
  same(pRefused("const v = VERSION();"), "this expression is not callable: type 'string' has no call signatures", "calling a const");
  checks(pRefused("const c = child(); const a: string = c.a; const b: f64 = c.b; const k = new K2(); const ka: string = k.a;"), "inherited members");
});

test("a namespace's members are read where the name isn't rebound, and a default class names itself", () => {
  checks(first(stops([
    ["node_modules/lodashy/index.d.ts", "declare namespace _ {\n  function chunk<T>(xs: T[], n: number): T[][];\n}\nexport = _;\n"],
    ["main.fsh", "import _ from \"lodashy\";\nfunction main() { const c: string[][] = _.chunk([\"a\"], 1); const ns = [{ n: 1 }].map((_) => _.n); }\n"],
  ])), "a namespace");
  checks(first(stops([
    ["node_modules/k/index.d.ts", "export default class K { static make(): K; size: number; }\n"],
    ["main.fsh", "import K from \"k\";\nfunction main() { const k = K.make(); const n: f64 = k.size; }\n"],
  ])), "a default class");
});

function uRefused(arg: string): string {
  return first(stops([["node_modules/p/index.d.ts", "export interface U { child?: U; v: string }\nexport declare function takeU(u: U): void;\n"], ["main.fsh", `import { takeU } from "p";\nfunction main() { takeU(${arg}); }\n`]]));
}

test("a nested Fish value is checked against a recursive shape, part by part", () => {
  same(uRefused(`{ v: "a", child: { v: 5 } }`), "argument of type '{ child: { v: i64 }; v: string }' is not assignable to parameter of type 'U': property 'child' is a '{ v: i64 }', not a 'null | U'", "a wrong nested field");
  checks(uRefused(`{ v: "a", child: { v: "b" } }`), "a nested value that fits");
});

test("a package's JSDoc @throws tags don't make its functions throw in Fish", () => {
  const d = "/** @throws {TypeError} when s is empty */\nexport declare function up(s: string): string;\n/**\n * @throws INVALID_PARAM\n */\nexport declare function down(s: string): string;\n";
  checks(stops([["node_modules/t/index.d.ts", d], ["main.fsh", "import { up, down } from \"t\";\nfunction main() {\n  const a: string = up(\"a\");\n  const b: string = down(\"B\");\n}\n"]]), "the program");
});
