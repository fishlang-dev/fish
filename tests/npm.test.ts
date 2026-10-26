import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { formatError } from "../src/diag.ts";
import { compile } from "../src/main.ts";

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
  expect(out).toContain("main.fsh:3:21: error: running a package's code needs a JS engine, which Fish doesn't have yet");
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
  expect(stops({ "node_modules/lib/index.d.ts": LIB, "main.fsh": "import { run, VERSION, origin, at, Box, Options } from \"lib\";\nfunction main() {\n  const r = run({ name: \"x\", deep: true, nested: { level: 2 } });\n  const n: f64 = r.count;\n  r.label = \"new\";\n  const d: string = r.describe(\"p\");\n  const parts: string[] = r.parts();\n  const v: string = VERSION;\n  const p = origin();\n  const s: string = at(p);\n  const t: string = at({ x: 1.5, y: 2.5 });\n  const b = new Box(3, \"b\");\n  b.grow(2);\n  b.size = 4;\n  const id: string = b.id;\n  const m = Box.make();\n  const max: f64 = Box.MAX;\n  const o: Options = { name: \"kept\" };\n  run(o);\n}\n" })).toContain("main.fsh:3:13: error: running a package's code needs a JS engine");
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
  expect(refused("const r = run({ name: \"a\" }); anything(r); anything([1, 2]); anything(\"s\");")).toStartWith("running a package's code needs a JS engine");
});

test("a generic declaration is typed for each call's type arguments", () => {
  expect(stops({ "node_modules/gen/index.d.ts": "export declare function chunk<T>(xs: T[], n: number): T[][];\nexport declare function first<T>(xs: T[]): T | undefined;\nexport declare function pair<A, B>(a: A, b: B): [A, B];\nexport declare function wrap<T>(v: T): { value: T };\n", "main.fsh": "import { chunk, first, pair, wrap } from \"gen\";\nfunction main() {\n  const c: string[][] = chunk([\"a\", \"b\", \"c\"], 2);\n  const n: f64[][] = chunk([1.5, 2.5], 1);\n  const f: string | null = first([\"x\"]);\n  const p: [string, boolean] = pair(\"s\", true);\n  const w = wrap(3.5);\n  const v: f64 = w.value;\n}\n" })).toContain("main.fsh:3:25: error: running a package's code needs a JS engine");
});

test("each signature of a function declared more than once is tried in order", () => {
  const OV = "export declare function format(d: number): string;\nexport declare function format(d: string, pattern: string): string;\nexport declare function format(d: boolean[]): number;\n";
  expect(stops({ "node_modules/ov/index.d.ts": OV, "main.fsh": "import { format } from \"ov\";\nfunction main() {\n  const a: string = format(1.5);\n  const b: string = format(\"x\", \"yyyy\");\n  const c: f64 = format([true]);\n}\n" })).toContain("main.fsh:3:21: error: running a package's code needs a JS engine");
  expect(stops({ "node_modules/ov/index.d.ts": OV, "main.fsh": "import { format } from \"ov\";\nfunction main() { const a = format(true); }\n" })).toContain("error: no signature of 'format' takes (boolean); it takes (d: number), (d: string, pattern: string), (d: boolean[])");
  // The first that takes the arguments gives the result.
  expect(stops({ "node_modules/ov/index.d.ts": OV, "main.fsh": "import { format } from \"ov\";\nfunction main() { const a: f64 = format(1.5); }\n" })).toContain("error: type 'string' is not assignable to type 'number'");
});
