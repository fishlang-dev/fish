import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { formatError } from "../src/diag.ts";
import { build } from "../src/main.ts";
import { sanitized } from "./sanitized.ts";

// Each test builds a program with the JS engine, whose sources take several seconds to compile.
setDefaultTimeout(30_000);

const root = realpathSync(mkdtempSync(join(tmpdir(), "fish-packages-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// Packages a test's project has in node_modules: their JS and declarations.
const PACKAGES: Record<string, string> = {
  "node_modules/esm/package.json": JSON.stringify({ name: "esm", type: "module", exports: { ".": { types: "./index.d.ts", import: "./dist/index.js", require: "./dist/index.cjs" } } }),
  "node_modules/esm/dist/index.js": `import { helper } from "./helper.js";
export const VERSION = helper("one");
export const COUNT = 2.5;
export const ON = true;
export const WRONG = 7;
export function shout(s) { return helper(s) + "!"; }
export function add(a, b) { return a + b; }
export function maybe(s) { return s === undefined ? null : "got " + s; }
export function kind(v) { return v === null ? "e" : typeof v === "string" ? "s" : typeof v === "number" ? "n" : "b"; }
export function either(flag) { return flag ? "yes" : 42; }
export function show(x) { return typeof x + ":" + x; }
export function boom() { throw new RangeError("too far"); }
export function liar() { return 5; }
export function same(x) { return x; }
export function count(xs) { return xs.length; }
export function chunk(xs, n) { const out = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; }
export function pair() { return ["a", 1]; }
export function swap(p) { return [p[1], p[0]]; }
export function describe(o) { return o.name + ":" + (o.deep === undefined ? "?" : o.deep) + ":" + Object.keys(o).length; }
export function make(n) { return { count: n, label: "made" }; }
export function relabel(r) { return r.label + r.count; }
export function identical(a, b) { return a === b; }
export function strings() { return ["a", 2]; }
export function id(v) { return v; }
export function maybeObj(b) { return b ? { count: 1, label: "m" } : null; }
export function rb() { return 7; }
export async function twice(n) { await null; return n * 2; }
export async function fail(m) { await null; throw new TypeError(m); }
export async function nothing() {}
let pending;
export function later() { return new Promise((r) => { pending = r; }); }
export function release(v) { pending(v); }
export function each(xs, f) { for (const x of xs) f(x); }
export function mapped(xs, f) { return xs.map((x) => f(x)); }
let kept = null;
export function keep(f) { kept = f; }
export function fire(s) { return kept === null ? "none" : kept(s); }
export function forget() { kept = null; }
export function misuse(f) { return f("not a number"); }
export async function plusOne(p) { const v = await p; return v + 1; }
export function ignore(p) { return "ignored"; }
export function never() { return new Promise(() => {}); }
export function withOpts(o) { return o.cb(1); }
export function deep(o) { return o.inner.v; }
export function listed(o) { return o.list.length; }
export function optional() { try { return require("not-installed-anywhere").x; } catch { return "caught"; } }
export class Slot { constructor() { this.handler = (s) => s; this.done = Promise.resolve("none"); } fire(s) { return this.handler(s); } async settled() { return await this.done; } }
export class Emitter { constructor() { this.handlers = []; } on(f) { this.handlers.push(f); } emit(s) { return this.handlers.map((f) => f(s)).join(","); } }
export function sn(b) { return b ? ["a"] : [1, 2]; }
export function at() { return ["t", 9]; }
export function ov(b) { return { a: b ? "s" : 1 }; }
export function nested(k) { return k === "n" ? null : { inner: k === "i" ? null : { v: 1 } }; }
let made = 0;
export class Box {
  constructor(size, name) { this.size = size; this.id = (name ?? "box") + (++made); }
  grow(by) { this.size += by; return this.size; }
  describe() { return this.id + ":" + this.size; }
  static make() { return new Box(1, "made"); }
  static MAX = 10;
}
`,
  "node_modules/esm/dist/helper.js": "export function helper(s) { return s.toUpperCase(); }\n",
  "node_modules/esm/index.d.ts": `export declare const VERSION: string;
export declare const COUNT: number;
export declare const ON: boolean;
export declare const WRONG: string;
export declare function shout(s: string): string;
export declare function add(a: number, b: number): number;
export declare function maybe(s?: string): string | null;
export declare function kind(v: string | number | boolean | null): "s" | "n" | "b" | "e";
export declare function either(flag: boolean): string | number;
export declare function show(x: string): string;
export declare function show(x: number): string;
export declare function boom(): void;
export declare function liar(): string;
export declare function same(x: any): unknown;
export interface Options { name: string; deep?: boolean }
export interface Result { count: number; label: string }
export declare function count(xs: string[]): number;
export declare function chunk(xs: string[], n: number): string[][];
export declare function pair(): [string, number];
export declare function swap(p: [string, number]): [number, string];
export declare function describe(o: Options): string;
export declare function make(n: number): Result;
export declare function relabel(r: Result): string;
export declare function identical(a: Result, b: Result): boolean;
export declare function strings(): string[];
export declare function id<T>(v: T): T;
export declare function maybeObj(b: boolean): Result | null;
export declare function rb(): Result | boolean;
export declare function twice(n: number): Promise<number>;
export declare function fail(m: string): Promise<string>;
export declare function nothing(): Promise<void>;
export declare function later(): Promise<string>;
export declare function release(v: string): void;
export declare function each(xs: number[], f: (x: number) => void): void;
export declare function mapped(xs: string[], f: (s: string) => string): string[];
export declare function keep(f: (s: string) => string): void;
export declare function fire(s: string): string;
export declare function forget(): void;
export declare function misuse(f: (n: number) => number): number;
export declare function plusOne(p: Promise<number>): Promise<number>;
export declare function ignore(p: Promise<void>): string;
export declare function never(): Promise<string>;
export declare function withOpts(o: { cb: (x: number) => number }): number;
export declare function deep(o: { inner: { v: number } }): number;
export declare function listed(o: { list: string[] }): number;
export declare function optional(): string;
export declare class Emitter { on(f: (s: string) => string): void; emit(s: string): string; }
export declare class Slot { handler: (s: string) => string; done: Promise<string>; fire(s: string): string; settled(): Promise<string>; }
export declare function sn(b: boolean): string[] | number[];
export declare function at(): string[] | [string, number];
export declare function ov(b: boolean): { a: string } | { a: number };
export declare function nested(k: string): { inner: { v: number } | null } | null;
export interface Labeled { label: string }
export declare class Box {
  constructor(size: number, name?: string);
  size: number;
  readonly id: string;
  grow(by: number): number;
  describe(): string;
  static make(): Box;
  static MAX: number;
}
`,
  "node_modules/cjs/package.json": JSON.stringify({ name: "cjs", main: "lib.js", types: "lib.d.ts" }),
  "node_modules/cjs/lib.js": "exports.n = 3;\nexports.name = 'cjs';\n",
  "node_modules/cjs/lib.d.ts": "export declare const n: number;\nexport declare const name: string;\n",
  "node_modules/needsfs/package.json": JSON.stringify({ name: "needsfs", main: "i.js", types: "i.d.ts" }),
  "node_modules/needsfs/i.js": "const fs = require('fs');\nexports.size = fs.statSync('.').size;\n",
  "node_modules/needsfs/i.d.ts": "export declare const size: number;\n",
  "node_modules/shimmed/package.json": JSON.stringify({ name: "shimmed", main: "i.js", types: "i.d.ts" }),
  "node_modules/shimmed/i.js": `const path = require("path");
const os = require("node:os");
exports.paths = () => [path.join("a", "../b", "c.txt"), path.resolve("/x", "y", ".."), path.relative("/a/b/c", "/a/d"), path.dirname("/a/b/c"), path.basename("/a/b/c.txt", ".txt"), path.extname("x.tar.gz"), path.normalize("/a//b/../c/"), path.posix.sep].join("|");
exports.platform = () => os.platform();
exports.home = () => process.env.HOME;
exports.unset = () => process.env.FISH_SHIM_SURELY_UNSET === undefined;
exports.args = () => process.argv.slice(2).join(",");
exports.mode = () => process.env.NODE_ENV;
exports.written = () => { process.env.FISH_SHIM_WRITTEN ||= "set"; const kept = process.env.FISH_SHIM_WRITTEN; delete process.env.FISH_SHIM_WRITTEN; return kept + ("FISH_SHIM_WRITTEN" in process.env); };
`,
  "node_modules/shimmed/i.d.ts": "export declare function paths(): string;\nexport declare function platform(): string;\nexport declare function home(): string;\nexport declare function unset(): boolean;\nexport declare function args(): string;\nexport declare function mode(): string;\nexport declare function written(): string;\n",
  "node_modules/files/package.json": JSON.stringify({ name: "files", type: "module", main: "i.js", types: "i.d.ts" }),
  "node_modules/files/i.js": `import { readFile, writeFile } from "node:fs/promises";
export async function roundTrip(path, text) { await writeFile(path, text); const back = await readFile(path, "utf8"); const bytes = await readFile(path); return back + ":" + bytes.length + ":" + (bytes instanceof Uint8Array) + ":" + String(bytes) + ":" + bytes.toString(); }
export function ordered(path) { const log = []; Promise.resolve().then(() => log.push("micro")); readFile(path); log.push("sync"); return log.join(); }
export async function missing(path) { try { await readFile(path); return "read"; } catch (e) { return e.code + " " + e.syscall; } }
`,
  "node_modules/files/i.d.ts": "export declare function roundTrip(path: string, text: string): Promise<string>;\nexport declare function missing(path: string): Promise<string>;\nexport declare function ordered(path: string): string;\n",
  "node_modules/usescrypto/package.json": JSON.stringify({ name: "usescrypto", main: "i.js", types: "i.d.ts" }),
  "node_modules/usescrypto/i.js": "exports.id = require('crypto').randomUUID;\n",
  "node_modules/usescrypto/i.d.ts": "export declare function id(): string;\n",
  "node_modules/typesonly/package.json": JSON.stringify({ name: "typesonly", types: "index.d.ts" }),
  "node_modules/typesonly/index.d.ts": "export declare const gone: string;\n",
};

let made = 0;

// Builds `main` in a project with the packages above and runs it, reporting the leak count;
// or gives the compile error it stops at, as fishc prints it.
function project(main: string, files: Record<string, string> = {}): string {
  const dir = join(root, `p${made++}`);
  for (const [path, text] of Object.entries({ ...PACKAGES, ...files, "main.fsh": main })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

function run(main: string, args: string[] = [], env: Record<string, string> = {}): { stdout: string; stderr: string; exitCode: number | null } | string {
  const dir = project(main);
  const [entry, out] = [join(dir, "main.fsh"), join(dir, "main")];
  try {
    build(entry, out);
  } catch (e) {
    return formatError(e as never, "main.fsh", main).split("\n")[0]!.replaceAll(`${dir}/`, "");
  }
  const ran = Bun.spawnSync([out, ...args], { env: { ...process.env, FISH_LEAKS: "1", ...env } });
  return { stdout: ran.stdout.toString(), stderr: ran.stderr.toString().replaceAll(`${dir}/`, ""), exitCode: ran.exitCode };
}

test("a package's consts are read from its JS, ESM and CommonJS alike", () => {
  expect(run(`import { VERSION, COUNT, ON } from "esm";
import { n, name } from "cjs";
function main() {
  console.log(VERSION, COUNT, ON, n, name);
}
`)).toEqual({ stdout: "ONE 2.5 true 3 cjs\n", stderr: "", exitCode: 0 });
});

test("a const that isn't what its declaration says panics where it is read", () => {
  expect(run(`import { WRONG } from "esm";
function main() {
  const w = WRONG;
}
`)).toEqual({ stdout: "", stderr: "panicked at main.fsh:3:13:\n'WRONG' from 'esm' is a number, where its declaration says 'string'\n", exitCode: 101 });
});

test("a package needing a Node built-in, or with no JS, is refused", () => {
  expect(run(`import { size } from "needsfs";\nfunction main() { console.log(size); }\n`)).toBe("main.fsh:1:1: error: 'needsfs' needs Node's 'fs' module, which a package's JS can't use in Fish yet");
  expect(run(`import { gone } from "typesonly";\nfunction main() { console.log(gone); }\n`)).toStartWith("main.fsh:1:1: error: 'typesonly' has no JS Fish could bundle: ");
});

test("a program importing a package it never reaches at run time isn't bundled", () => {
  expect(run(`import { size } from "needsfs";\nfunction main() { console.log(1); }\n`)).toEqual({ stdout: "1\n", stderr: "", exitCode: 0 });
});

test("a package's functions are called with values converted both ways, under ASan with no leaks", () => {
  const main = `import { shout, add, maybe, kind, either, show, same } from "esm";
function main() {
  const n: i64 = 2;
  const word = "h" + "i";
  console.log(shout(word), add(1.5, 2), add(n as f64, 3));
  console.log(maybe(), maybe("x"));
  console.log(kind("a"), kind(1), kind(true), kind(null));
  const yes = either(true);
  const no = either(false);
  console.log(yes, no, show("a"), show(2));
  const back = same("text");
  if (typeof back === "string") console.log(back.length);
  shout("dropped");
}
`;
  const dir = project(main);
  expect(sanitized(join(dir, "main.fsh"), main)).toEqual({ stdout: "HI! 3.5 5\nnull got x\ns n b e\nyes 42 string:a number:2\n4\n", stderr: "", exitCode: 0 });
});

test("a JS throw, or a result that isn't what its declaration says, panics at the call", () => {
  expect(run(`import { boom } from "esm";\nfunction main() {\n  boom();\n}\n`)).toEqual({ stdout: "", stderr: "panicked at main.fsh:3:3:\nuncaught exception in JS: RangeError: too far\n", exitCode: 101 });
  expect(run(`import { liar } from "esm";\nfunction main() {\n  console.log(liar());\n}\n`)).toEqual({ stdout: "", stderr: "panicked at main.fsh:3:15:\n'liar' from 'esm' gave a number, where its declaration says 'string'\n", exitCode: 101 });
});

test("an overload's signature is the one called", () => {
  expect(run(`import { show } from "esm";\nfunction main() {\n  console.log(show(1), show("1"));\n}\n`)).toEqual({ stdout: "number:1 string:1\n", stderr: "", exitCode: 0 });
});

test("arrays, tuples and objects are copied across, and a handle passes as itself, with no leaks", () => {
  const main = `import { count, chunk, pair, swap, describe, make, relabel, identical } from "esm";
function main() {
  const xs = ["a", "b", "c"];
  console.log(count(xs), count(["z"]), xs.length);
  const c = chunk(xs, 2);
  console.log(c.length, c[0].length, c[1][0]);
  const [s, n] = pair();
  const t: [string, f64] = ["b", 2];
  console.log(s, n, swap(t)[0], swap(pair())[1]);
  console.log(describe({ name: "x" }), describe({ name: "y", deep: true }));
  const r = make(3);
  const other = make(3);
  console.log(relabel(r), relabel(make(4)), identical(r, r), identical(r, other));
}
`;
  const dir = project(main);
  expect(sanitized(join(dir, "main.fsh"), main)).toEqual({ stdout: "3 1 3\n2 2 c\na 1 2 a\nx:?:1 y:true:2\nmade3 made4 true false\n", stderr: "", exitCode: 0 });
});

test("an array whose elements aren't what the declaration says panics naming them", () => {
  const ran = run(`import { strings } from "esm";\nfunction main() {\n  console.log(strings());\n}\n`);
  expect(ran).toMatchObject({ stdout: "", exitCode: 101 });
  expect((ran as { stderr: string }).stderr).toStartWith("panicked at main.fsh:3:15:\n'strings' from 'esm' gave an array holding a number, where its declaration says 'string'\n");
});

test("a package's classes are made, their fields read and written, and their methods and statics used", () => {
  const main = `import { Box, make, relabel } from "esm";
function main() {
  const b = new Box(3);
  console.log(b.size, b.id, b.grow(2), b.size);
  b.size = 9;
  b.grow(1);
  console.log(b.describe());
  const m = Box.make();
  console.log(m.describe(), Box.MAX);
  const r = make(5);
  r.label = "new";
  console.log(r.count, r.label, relabel(r), new Box(1, "n").id);
}
`;
  const dir = project(main);
  expect(sanitized(join(dir, "main.fsh"), main)).toEqual({ stdout: "3 box1 5 5\nbox1:10\nmade2:1 10\n5 new new5 n3\n", stderr: "", exitCode: 0 });
});

test("a compound assignment to a handle's property waits", () => {
  expect(run(`import { Box } from "esm";\nfunction main() {\n  const b = new Box(1);\n  b.size += 1;\n}\n`)).toBe("main.fsh:4:3: error: compound assignments to a package's properties are not supported yet");
});

test("results of every type the checker lets cross are read as declared", () => {
  const main = `import { id, maybeObj, Box } from "esm";
function main() {
  const i: i64 = id(5);
  const u: u8 = id(200 as u8);
  const f: f32 = id(1.5 as f32);
  const xs: i64[] = id([1, 2]);
  const given: [i64, string] = [3, "x"];
  const t = id(given);
  const n: i64 | null = id(7);
  const m = maybeObj(true);
  console.log(i, u, f, xs.length, t[1], n, m !== null, maybeObj(false) === null);
  let boxes: Box[] = [];
  boxes.push(new Box(1));
  console.log(boxes.length);
}
`;
  const dir = project(main);
  expect(sanitized(join(dir, "main.fsh"), main)).toEqual({ stdout: "5 200 1.5 2 x 7 true true\n1\n", stderr: "", exitCode: 0 });
});

test("a result no member of its declared union takes panics", () => {
  expect(run(`import { rb } from "esm";\nfunction main() {\n  const r = rb();\n}\n`)).toEqual({ stdout: "", stderr: "panicked at main.fsh:3:13:\n'rb' from 'esm' gave a number, where its declaration says 'boolean | Result'\n", exitCode: 101 });
});

test("a Fish value can't become a handle, and a package can't run while compiling", () => {
  expect(run(`import { Result } from "esm";\nfunction main() {\n  const r: Result = { count: 1, label: "x" };\n}\n`)).toStartWith("main.fsh:3:21: error: turning a Fish value into a JS value isn't supported yet");
  expect(run(`import { id } from "esm";\nconst X = id("x");\nfunction main() {}\n`)).toBe("main.fsh:2:7: error: 'id' from the package 'esm' can't run while compiling: comptime code only computes values");
});

test("a union's members of one JS kind are told apart by what they hold", () => {
  const main = `import { sn, at, ov, nested } from "esm";
function main() {
  console.log(sn(true), sn(false), at());
  const kept = [ov(true), ov(false)];
  const none = nested("n");
  const empty = nested("i");
  const full = nested("x");
  console.log(kept.length, none === null, empty !== null && empty.inner === null, full !== null && full.inner !== null);
}
`;
  const dir = project(main);
  expect(sanitized(join(dir, "main.fsh"), main)).toEqual({ stdout: "[ 'a' ] [ 1, 2 ] [ 't', 9 ]\n2 true true true\n", stderr: "", exitCode: 0 });
});

test("a generic Fish function forwards its type parameter to a package", () => {
  expect(run(`import { id } from "esm";\nfunction g<T>(x: T): T {\n  return id(x);\n}\nfunction main() {\n  console.log(g("ok"), g(3));\n}\n`)).toEqual({ stdout: "ok 3\n", stderr: "", exitCode: 0 });
});

test("an empty value is undefined in a property written with ?, and null in one that isn't", () => {
  expect(run(`import { describe } from "esm";\nfunction main() {\n  const deep: boolean | null = null;\n  console.log(describe({ name: "z", deep }));\n}\n`)).toEqual({ stdout: "z:?:2\n", stderr: "", exitCode: 0 });
});

test("a handle meets another declaration of its type, in another file or a shape it fits", () => {
  const main = `import { make } from "esm";
import type { Labeled } from "esm";
import { counted } from "./lib.fsh";
function main() {
  const r = make(2);
  const l: Labeled = make(3);
  const ls: Labeled[] = [make(4), l.clone()];
  const maybe: Labeled | null = r.clone();
  console.log(counted(r), l.label, ls.length, maybe !== null);
}
`;
  const dir = project(main, { "lib.fsh": `import { relabel } from "esm";\nimport type { Result } from "esm";\nexport function counted(r: Result): string {\n  return relabel(r);\n}\n` });
  expect(sanitized(join(dir, "main.fsh"), main)).toEqual({ stdout: "made2 made 2 true\n", stderr: "", exitCode: 0 });
});

test("a Fish type holding itself has no JS form yet", () => {
  expect(run(`import { id } from "esm";\ntype Tree = { v: f64; kids: Tree[] };\nfunction main() {\n  const t: Tree = { v: 1, kids: [] };\n  const u = id(t);\n}\n`)).toBe("node_modules/esm/index.d.ts:26:34: error: 'id' from 'esm' takes a 'Tree', which can't cross between Fish and JS yet: a type holding itself has no JS form yet");
});

test("a package's promises are awaited, a rejection thrown as a JsError, and a later settling wakes its task", () => {
  const main = `import { twice, fail, nothing, later, release } from "esm";
async function waits(): Promise<string> throws JsError {
  const v = await later();
  return v;
}
async function main(): Promise<void> throws JsError {
  const n = await twice(21);
  await nothing();
  console.log(n);
  try {
    const s = await fail("bad input");
  } catch (e) {
    console.log(e.name, e.message);
    console.log(e);
  }
  const t = spawn(waits());
  await sleep(20);
  release("released");
  const got = await t;
  console.log(got);
}
`;
  const dir = project(main);
  expect(sanitized(join(dir, "main.fsh"), main)).toEqual({ stdout: "42\nJsError bad input\n[JsError: bad input]\nreleased\n", stderr: "", exitCode: 0 });
});

test("awaiting a package's promise is a throw to catch or declare", () => {
  expect(run(`import { twice } from "esm";\nasync function main() {\n  const n = await twice(1);\n}\n`)).toStartWith("main.fsh:3:13: error: 'main' must declare 'throws JsError'");
});

test("Fish callbacks are called by JS during a call and kept for later, and freed when JS drops them", () => {
  const main = `import { each, mapped, keep, fire, forget, twice } from "esm";
function shout(s: string): string {
  return s.toUpperCase();
}
function main() {
  const total = shared({ sum: new Atomic<i64>(0) });
  const seen = total.clone();
  each([1, 2, 3], (x) => { seen.sum.add(x as i64); });
  console.log(total.sum.load());
  console.log(mapped(["a", "b"], shout), mapped(["c"], (s) => s + make(4).count));
  const prefix = "got ";
  keep((s) => prefix + s);
  console.log(fire("one"), fire("two"));
  forget();
  console.log(fire("three"));
}
import { make } from "esm";
`;
  const dir = project(main);
  expect(sanitized(join(dir, "main.fsh"), main)).toEqual({ stdout: "6\n[ 'A', 'B' ] [ 'c4' ]\ngot one got two\nnone\n", stderr: "", exitCode: 0 });
});

test("a callback holding what isn't Send is refused, and one JS gives the wrong value panics", () => {
  expect(run(`import { keep } from "esm";\nfunction main() {\n  const c = new Cell<i64>(0);\n  keep((s) => { c.set(1); return s; });\n}\n`)).toBe("main.fsh:4:8: error: a '(s: string) => string' may cross to another thread, so it can't hold a 'Cell<i64>', which changes without a lock");
  const misused = run(`import { misuse } from "esm";\nfunction main() {\n  console.log(misuse((n) => n + 1));\n}\n`);
  expect(misused).toMatchObject({ stdout: "", exitCode: 101 });
  expect((misused as { stderr: string }).stderr).toStartWith("panicked at main.fsh:3:22:\na callback was given a string, where its declaration says 'number'\n");
});

test("a Fish future given to JS is a promise, running as a task from when it is given", () => {
  const main = `import { plusOne, ignore } from "esm";
async function seven(): Promise<f64> {
  await sleep(5);
  return 7;
}
async function done(): Promise<void> {
  await sleep(5);
  console.log("ran though ignored");
}
async function main(): Promise<void> throws JsError {
  const n = await plusOne(seven());
  console.log(n, ignore(done()));
  await sleep(50);
}
`;
  const dir = project(main);
  expect(sanitized(join(dir, "main.fsh"), main)).toEqual({ stdout: "8 ignored\nran though ignored\n", stderr: "", exitCode: 0 });
});

test("a future is given to JS only inside an async function, and only one that can't throw", () => {
  expect(run(`import { ignore } from "esm";\nasync function done(): Promise<void> {}\nfunction main() {\n  console.log(ignore(done()));\n}\n`)).toBe("main.fsh:4:22: error: a Promise given to JS starts running as a task when it is given, so it is given only inside an 'async' function");
  expect(run(`import { plusOne } from "esm";\nclass Bad { message: string = "b"; }\nasync function fails(): Promise<f64> throws Bad {\n  throw new Bad();\n}\nasync function main(): Promise<void> throws JsError {\n  const n = await plusOne(fails());\n}\n`)).toStartWith("main.fsh:7:27: error: a stored 'Promise<number>' can't throw yet");
});

test("callbacks from fields and given to a handle's methods, kept at exit, and an await that never settles, leak nothing", () => {
  const main = `import { keep, fire, Emitter, make, never, relabel } from "esm";
class Holder {
  f: (s: string) => string;
  constructor() { this.f = (s) => s + "!"; }
}
async function waits(): Promise<string> throws JsError {
  const s = await never();
  return s;
}
async function soon(): Promise<string> throws JsError {
  await sleep(5);
  return "soon";
}
async function main(): Promise<void> throws JsError {
  const h = new Holder();
  keep(h.f);
  const e = new Emitter();
  const r = make(1);
  e.on((s) => s + relabel(r));
  e.on((s) => s.toUpperCase());
  console.log(fire("x"), e.emit("a"));
  const first = await Promise.race([waits(), soon()]);
  console.log(first);
}
`;
  const dir = project(main);
  expect(sanitized(join(dir, "main.fsh"), main)).toEqual({ stdout: "x! amade1,A\nsoon\n", stderr: "", exitCode: 0 });
});

test("a callback or a Promise written to a handle's property goes to JS, and isn't read back", () => {
  const main = `import { Slot } from "esm";
async function later(): Promise<string> {
  return "later";
}
async function main(): Promise<void> throws JsError {
  const s = new Slot();
  const tail = "?";
  s.handler = (t) => t + tail;
  s.done = later();
  const settled = await s.settled();
  console.log(s.fire("why"), settled);
}
`;
  const dir = project(main);
  expect(sanitized(join(dir, "main.fsh"), main)).toEqual({ stdout: "why? later\n", stderr: "", exitCode: 0 });
  expect(run(`import { Slot } from "esm";\nfunction main() {\n  const s = new Slot();\n  const f = s.handler;\n}\n`)).toBe("main.fsh:4:13: error: reading property 'handler' of 'Slot' isn't supported yet: it holds a function, which Fish can give JS but not read back");
  expect(run(`import { Slot } from "esm";\nfunction main() {\n  const s = new Slot();\n  const f = (s.handler = (t) => t);\n}\n`)).toBe("main.fsh:4:14: error: a callback or a Promise written to property 'handler' goes to JS, so the assignment has no value to use; write it as a statement of its own");
});

test("calling into JS under a Lock panics, and a handle dropped under one is freed later", () => {
  const main = `import { make, relabel } from "esm";
function main() {
  const l = new Lock([make(1), make(2)]);
  l.update((xs) => { xs.pop(); });
  const m = make(3);
  console.log(relabel(m));
}
`;
  const dir = project(main);
  expect(sanitized(join(dir, "main.fsh"), main)).toEqual({ stdout: "made3\n", stderr: "", exitCode: 0 });
  const locked = run(`import { shout } from "esm";\nfunction main() {\n  const l = new Lock("a");\n  l.update((v) => { v = shout(v); });\n}\n`);
  expect(locked).toEqual({ stdout: "", stderr: "panicked at main.fsh:4:25:\ncalled into JS while holding a Lock, which a callback JS runs may wait for; call the package before 'update' or after it\n", exitCode: 101 });
});

test("a callback inside an object given to JS waits", () => {
  expect(run(`import { withOpts } from "esm";\nfunction main() {\n  console.log(withOpts({ cb: (x) => x + 1 }));\n}\n`)).toStartWith("node_modules/esm/index.d.ts:");
});

test("a nested object given to JS takes numbers as JS does, and an optional require runs", () => {
  expect(run(`import { deep, optional, listed } from "esm";\nfunction main() {\n  console.log(deep({ inner: { v: 5 } }), optional(), listed({ list: [] }));\n}\n`)).toEqual({ stdout: "5 caught 0\n", stderr: "", exitCode: 0 });
});

test("bundled JS's path, os and process are Fish's, and another Node module is refused naming it", () => {
  const main = `import { paths, platform, home, unset, args, mode, written } from "shimmed";
import * as path from "node:path";
import * as os from "node:os";
function main() {
  console.log(paths());
  console.log([path.join("a", "../b", "c.txt"), path.resolve("/x", "y", ".."), path.relative("/a/b/c", "/a/d"), path.dirname("/a/b/c"), path.basename("/a/b/c.txt", ".txt"), path.extname("x.tar.gz"), path.normalize("/a//b/../c/"), path.sep].join("|"));
  console.log(platform() === os.platform(), home() === process.env.HOME, unset(), args(), mode(), written());
}
`;
  expect(run(main, ["one", "two"], { NODE_ENV: "production" })).toEqual({ stdout: "b/c.txt|/x|../../d|/a/b|c|.gz|/a/c/|/\nb/c.txt|/x|../../d|/a/b|c|.gz|/a/c/|/\ntrue true true one,two production setfalse\n", stderr: "", exitCode: 0 });
  expect(run(`import { id } from "usescrypto";\nfunction main() { console.log(id()); }\n`)).toBe("main.fsh:1:1: error: 'usescrypto' needs Node's 'crypto' module, which a package's JS can't use in Fish yet");
});

test("bundled JS's fs/promises reads and writes through Fish's blocking pool, a failure as Node's error", () => {
  const dir = project("");
  const main = `import { roundTrip, missing } from "files";
async function main(): Promise<void> throws JsError {
  const r = await roundTrip(${JSON.stringify(join(dir, "written.txt"))}, "héllo");
  const m = await missing(${JSON.stringify(join(dir, "absent.txt"))});
  console.log(r, m);
}
`;
  expect(sanitized(join(dir, "main.fsh"), main)).toEqual({ stdout: "héllo:6:true:héllo:héllo ENOENT open\n", stderr: "", exitCode: 0 });
  // With no async runtime the file is read at once, and the promise's jobs still wait for the
  // calling JS to finish.
  expect(run(`import { ordered } from "files";\nfunction main() { console.log(ordered(${JSON.stringify(join(dir, "written.txt"))})); }\n`)).toEqual({ stdout: "sync\n", stderr: "", exitCode: 0 });
});
