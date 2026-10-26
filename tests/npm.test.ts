import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { formatError } from "../src/diag.ts";
import { compile } from "../src/main.ts";

// What stops a program that type-checks with a package's declarations: a form that can't run
// yet, or a package with no JS to bundle, as these fixtures have only declarations.
const TYPE_CHECKED = /(reading this package's const isn't supported yet|this call gives a package's function a value with no JS form yet|has no JS Fish could bundle|turning a Fish value into a JS value isn't supported yet)/;

// Builds `main.fsh` in a project of these files, giving the compile error it stops at, with
// any note, as fishc prints it.
function stops(files: Record<string, string>): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "fish-npm-")));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    const entry = join(dir, "main.fsh");
    try {
      compile(files["main.fsh"]!, entry);
    } catch (e) {
      return formatError(e as never, "main.fsh", files["main.fsh"]!).replaceAll(dir + "/", "");
    }
    return "built";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CASE = `export declare function camelCase(s: string, keep?: boolean): string;
export declare function count(xs: string[]): number;
export declare function anyway(v: any): unknown;
export declare function each(f: (x: number) => void): void;
export declare function maybe(s: string | undefined): string | null;
export declare interface Options { deep: boolean }
`;

test("a package's functions type-check, and the program stops at its first use", () => {
  const out = stops({
    "node_modules/case/index.d.ts": CASE,
    "main.fsh": `import { camelCase, count, anyway, maybe } from "case";
function main() {
  const s: string = camelCase("foo bar", true);
  const n: f64 = count(["a", s]);
  const v: JsValue = anyway(1.5);
  const w = anyway(v);
  const m: string | null = maybe(null);
  console.log(s, n);
}
`,
  });
  expect(out).toMatch(TYPE_CHECKED);
});

test("a wrong argument is refused in TypeScript's terms", () => {
  expect(stops({
    "node_modules/case/index.d.ts": CASE,
    "main.fsh": "import { camelCase } from \"case\";\nfunction main() { const s = camelCase(5); }\n",
  })).toContain("error: argument of type 'i64' is not assignable to parameter of type 'string'");
});

test("a declaration Fish can't type is refused where it is declared, noting the call", () => {
  const out = stops({
    "node_modules/case/index.d.ts": CASE,
    "main.fsh": "import { each } from \"case\";\nfunction main() { each((x) => {}); }\n",
  });
  expect(out).toContain("node_modules/case/index.d.ts:4:33: error: 'each' from 'case' takes a '(x: number) => void', which can't cross between Fish and JS yet: functions crossing between Fish and JS aren't supported yet");
  expect(out).toContain("main.fsh:2:19: note: 'each' is called here");
});


const LIB = "export interface Options { deep?: boolean; name: string; nested?: Inner }\ninterface Inner { level: number }\nexport interface Result { readonly count: number; label: string; describe(prefix: string): string; parts(): string[] }\nexport declare function run(o: Options): Result;\nexport declare const VERSION: string;\nexport type Point = { x: number; y: number };\nexport declare function origin(): Point;\nexport declare function at(p: Point): string;\nexport declare class Box {\n  constructor(size: number, label?: string);\n  size: number;\n  readonly id: string;\n  grow(by: number): void;\n  static make(): Box;\n  static readonly MAX: number;\n  private secret: string;\n}\nexport declare function show(r: Result): void;\nexport declare function anything(v: any): void;\n";

test("consts, interfaces, object types and classes type-check as JS handles", () => {
  expect(stops({ "node_modules/lib/index.d.ts": LIB, "main.fsh": "import { run, VERSION, origin, at, Box, Options } from \"lib\";\nfunction main() {\n  const r = run({ name: \"x\", deep: true, nested: { level: 2 } });\n  const n: f64 = r.count;\n  r.label = \"new\";\n  const d: string = r.describe(\"p\");\n  const parts: string[] = r.parts();\n  const v: string = VERSION;\n  const p = origin();\n  const s: string = at(p);\n  const t: string = at({ x: 1.5, y: 2.5 });\n  const b = new Box(3, \"b\");\n  b.grow(2);\n  b.size = 4;\n  const id: string = b.id;\n  const m = Box.make();\n  const max: f64 = Box.MAX;\n  const o: Options = { name: \"kept\" };\n  run(o);\n}\n" })).toMatch(TYPE_CHECKED);
});

test("a handle's members, a Fish value for a shape, and a class are refused in TypeScript's terms", () => {
  const refused = (body: string) => stops({ "node_modules/lib/index.d.ts": LIB, "main.fsh": `import { run, Box, show, anything } from "lib";\nfunction main() { ${body} }\n` }).split("\n")[0]!.replace(/^.*error: /, "");
  expect(refused("run({ name: 5 });")).toBe("argument of type '{ name: i64 }' is not assignable to parameter of type 'Options': property 'name' is a 'i64', not a 'string'");
  expect(refused("run({ deep: true });")).toBe("argument of type '{ deep: boolean }' is not assignable to parameter of type 'Options': property 'name' is missing");
  expect(refused("const r = run({ name: \"a\" }); r.count = 1;")).toBe("'count' is read-only in its declaration");
  expect(refused("const r = run({ name: \"a\" }); const x = r.nope;")).toBe("property 'nope' does not exist on type 'Result'");
  expect(refused("const r = run({ name: \"a\" }); r.describe(1);")).toBe("argument of type 'i64' is not assignable to parameter of type 'string'");
  expect(refused("const r = run({ name: \"a\" }); const f = r.describe;")).toBe("'describe' is a method of 'Result'; call it, as in 'r.describe(...)'");
  expect(refused("const b = new Box(\"x\");")).toBe("argument of type '\"x\"' is not assignable to parameter of type 'number'");
  expect(refused("const x = Box.nope;")).toBe("property 'nope' does not exist on 'Box'");
  expect(refused("show({ count: 1, label: \"l\" });")).toBe("argument of type '{ count: i64; label: string }' is not assignable to parameter of type 'Result': its methods come only with a value JS made");
  expect(refused("const r = run({ name: \"a\" }); anything(r); anything([1, 2]); anything(\"s\");")).toMatch(TYPE_CHECKED);
});

test("a generic declaration is typed for each call's type arguments", () => {
  expect(stops({ "node_modules/gen/index.d.ts": "export declare function chunk<T>(xs: T[], n: number): T[][];\nexport declare function first<T>(xs: T[]): T | undefined;\nexport declare function pair<A, B>(a: A, b: B): [A, B];\nexport declare function wrap<T>(v: T): { value: T };\n", "main.fsh": "import { chunk, first, pair, wrap } from \"gen\";\nfunction main() {\n  const c: string[][] = chunk([\"a\", \"b\", \"c\"], 2);\n  const n: f64[][] = chunk([1.5, 2.5], 1);\n  const f: string | null = first([\"x\"]);\n  const p: [string, boolean] = pair(\"s\", true);\n  const w = wrap(3.5);\n  const v: f64 = w.value;\n}\n" })).toMatch(TYPE_CHECKED);
});

test("each signature of a function declared more than once is tried in order", () => {
  const OV = "export declare function format(d: number): string;\nexport declare function format(d: string, pattern: string): string;\nexport declare function format(d: boolean[]): number;\n";
  expect(stops({ "node_modules/ov/index.d.ts": OV, "main.fsh": "import { format } from \"ov\";\nfunction main() {\n  const a: string = format(1.5);\n  const b: string = format(\"x\", \"yyyy\");\n  const c: f64 = format([true]);\n}\n" })).toMatch(TYPE_CHECKED);
  expect(stops({ "node_modules/ov/index.d.ts": OV, "main.fsh": "import { format } from \"ov\";\nfunction main() { const a = format(true); }\n" })).toContain("error: no signature of 'format' takes (boolean); it takes (d: number), (d: string, pattern: string), (d: boolean[])");
  // The first that takes the arguments gives the result.
  expect(stops({ "node_modules/ov/index.d.ts": OV, "main.fsh": "import { format } from \"ov\";\nfunction main() { const a: f64 = format(1.5); }\n" })).toContain("error: type 'string' is not assignable to type 'number'");
});

const WHOLE = {"node_modules/dflt/index.d.ts": "export default function slug(s: string): string;\n", "node_modules/ns/index.d.ts": "export declare function a(n: number): string;\nexport declare const b: boolean;\n", "node_modules/lodashy/index.d.ts": "declare namespace _ {\n  function chunk<T>(xs: T[], n: number): T[][];\n  const VERSION: string;\n}\nexport = _;\n", "node_modules/lo/index.d.ts": "interface LoDashStatic {\n  chunk<T>(xs: T[], size?: number): T[][];\n  camelCase(s?: string): string;\n  VERSION: string;\n}\ndeclare const _: LoDashStatic;\nexport = _;\n"};

test("default, namespace and export = imports reach a package's declarations", () => {
  expect(stops({ ...WHOLE, "main.fsh": "import slug from \"dflt\";\nimport * as ns from \"ns\";\nimport _ from \"lodashy\";\nimport { chunk } from \"lodashy\";\nfunction main() {\n  const s: string = slug(\"Hello World\");\n  const t: string = ns.a(1.5);\n  const u: boolean = ns.b;\n  const c: string[][] = _.chunk([\"a\", \"b\"], 1);\n  const v: string = _.VERSION;\n  const d: f64[][] = chunk([1.5], 1);\n}\n" })).toMatch(TYPE_CHECKED);
  expect(stops({ ...WHOLE, "main.fsh": "import * as ns from \"ns\";\nfunction main() { const x = ns.nope; }\n" })).toContain("main.fsh:2:29: error: 'ns' has no export 'nope'");
});

test("a const of an interface with generic methods, as lodash declares itself", () => {
  expect(stops({ ...WHOLE, "main.fsh": "import _ from \"lo\";\nfunction main() {\n  const c: string[][] = _.chunk([\"a\", \"b\"], 1);\n  const d: f64[][] = _.chunk([1.5]);\n  const s: string = _.camelCase(\"x y\");\n  const v: string = _.VERSION;\n}\n" })).toMatch(TYPE_CHECKED);
});

const P = `export interface A { a: string }
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
const first = (out: string) => out.split("\n")[0]!.replace(/^.*error: /, "");

test("a Fish value made a JsValue stops the program, and an import not called builds", () => {
  expect(first(stops({ "node_modules/p/index.d.ts": P, "main.fsh": "function main() { const o: JsValue = 5; }\n" }))).toStartWith("turning a Fish value into a JS value isn't supported yet");
  expect(stops({ "node_modules/p/index.d.ts": P, "main.fsh": "import { f } from \"p\";\nfunction main() { console.log(\"hi\"); }\n" })).toBe("built");
});

test("overloads imported in two files keep their signatures apart", () => {
  expect(first(stops({
    "node_modules/p/index.d.ts": P,
    "lib.fsh": "import { format } from \"p\";\nexport function show(): string { return format(1.5); }\n",
    "main.fsh": "import { format } from \"p\";\nimport { show } from \"./lib\";\nfunction main() { const a = format(\"x\"); console.log(show()); }\n",
  }))).toMatch(TYPE_CHECKED);
});

test("a handle's members cross only what can, and a handle passes only with the methods asked for", () => {
  const refused = (body: string) => first(stops({ "node_modules/p/index.d.ts": P, "main.fsh": `import { getA, takeB, s, VERSION, child, K2 } from "p";\nfunction main() { ${body} }\n` }));
  expect(refused("s().each((x) => {});")).toBe("'each' of 'S' takes a '(x: number) => void', which can't cross between Fish and JS yet: functions crossing between Fish and JS aren't supported yet");
  expect(refused("takeB(getA());")).toBe("argument of type 'A' is not assignable to parameter of type 'B': property 'go' is missing");
  expect(refused("const v = VERSION();")).toBe("this expression is not callable: type 'string' has no call signatures");
  expect(refused("const c = child(); const a: string = c.a; const b: f64 = c.b; const k = new K2(); const ka: string = k.a;")).toMatch(TYPE_CHECKED);
});

test("a namespace's members are read where the name isn't rebound, and a default class names itself", () => {
  expect(first(stops({
    "node_modules/lodashy/index.d.ts": "declare namespace _ {\n  function chunk<T>(xs: T[], n: number): T[][];\n}\nexport = _;\n",
    "main.fsh": "import _ from \"lodashy\";\nfunction main() { const c: string[][] = _.chunk([\"a\"], 1); const ns = [{ n: 1 }].map((_) => _.n); }\n",
  }))).toMatch(TYPE_CHECKED);
  expect(first(stops({
    "node_modules/k/index.d.ts": "export default class K { static make(): K; size: number; }\n",
    "main.fsh": "import K from \"k\";\nfunction main() { const k = K.make(); const n: f64 = k.size; }\n",
  }))).toMatch(TYPE_CHECKED);
});

test("a package imported twice is one set of types, and a borrowed handle passes as the handle", () => {
  const R = "export interface R { with(o: R): R; put<T>(x: T): T; n: number }\nexport declare function f(): R;\nexport declare function g(r: R): void;\nexport declare function rs(): R[];\n";
  expect(first(stops({
    "node_modules/p/index.d.ts": R,
    "lib.fsh": "import { f } from \"p\";\nexport function make() { return f(); }\n",
    "main.fsh": "import { g, rs } from \"p\";\nimport { make } from \"./lib\";\nfunction main() { g(make()); for (const r of rs()) g(r); }\n",
  }))).toMatch(TYPE_CHECKED);
  // An index signature, which Fish can't type, comes only with a value JS made.
  expect(first(stops({
    "node_modules/p/index.d.ts": "export interface D { [k: string]: number }\nexport declare function take(d: D): void;\n",
    "main.fsh": "import { take } from \"p\";\nfunction main() { take({ a: \"x\" }); }\n",
  }))).toBe("argument of type '{ a: string }' is not assignable to parameter of type 'D': its index signature comes only with a value JS made");
});

test("a nested Fish value is checked against a recursive shape, part by part", () => {
  const U = "export interface U { child?: U; v: string }\nexport declare function takeU(u: U): void;\n";
  const refused = (arg: string) => first(stops({ "node_modules/p/index.d.ts": U, "main.fsh": `import { takeU } from "p";\nfunction main() { takeU(${arg}); }\n` }));
  expect(refused(`{ v: "a", child: { v: 5 } }`)).toBe("argument of type '{ child: { v: i64 }; v: string }' is not assignable to parameter of type 'U': property 'child' is a '{ v: i64 }', not a 'null | U'");
  expect(refused(`{ v: "a", child: { v: "b" } }`)).toMatch(TYPE_CHECKED);
});

test("a Fish class whose type refers to itself through an array is refused, not followed forever", () => {
  expect(first(stops({
    "node_modules/p/index.d.ts": "export interface L { items: L[]; v: string }\nexport declare function takeL(l: L): void;\n",
    "main.fsh": "import { takeL } from \"p\";\nclass K { v: string = \"a\"; items: K[] = []; }\nfunction main() { takeL(new K()); takeL({ v: \"a\", items: [{ v: \"b\", items: [] }] }); }\n",
  }))).toBe("argument of type 'K' is not assignable to parameter of type 'L': property 'items' is a 'K[]', not a 'L[]'");
});
