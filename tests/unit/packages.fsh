// Npm packages a program imports, bundled into the JS engine, built by the native fishc from the
// command line. The build under AddressSanitizer is `fishc build --sanitize address`, which
// instruments the program, std, the runtime and the engine, and runs with FISH_LEAKS=1; a compile
// error is the first line fishc prints, as `formatError` gives it.
// Two tests are left out until the native fishc stops crashing on a function a declaration file
// declares more than once, which both call: the values converted both ways under ASan, and an
// overload's signature being the one called.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fishc, removed, same, scratch, text } from "./support.fsh";

// Packages a test's project has in node_modules: their JS and declarations.
function packages(): [string, string][] {
  return [
    ["node_modules/esm/package.json", "{\"name\":\"esm\",\"type\":\"module\",\"exports\":{\".\":{\"types\":\"./index.d.ts\",\"import\":\"./dist/index.js\",\"require\":\"./dist/index.cjs\"}}}"],
    ["node_modules/esm/dist/index.js", `import { helper } from "./helper.js";
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
`],
    ["node_modules/esm/dist/helper.js", "export function helper(s) { return s.toUpperCase(); }\n"],
    ["node_modules/esm/index.d.ts", `export declare const VERSION: string;
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
`],
    ["node_modules/cjs/package.json", "{\"name\":\"cjs\",\"main\":\"lib.js\",\"types\":\"lib.d.ts\"}"],
    ["node_modules/cjs/lib.js", "exports.n = 3;\nexports.name = 'cjs';\n"],
    ["node_modules/cjs/lib.d.ts", "export declare const n: number;\nexport declare const name: string;\n"],
    ["node_modules/needsfs/package.json", "{\"name\":\"needsfs\",\"main\":\"i.js\",\"types\":\"i.d.ts\"}"],
    ["node_modules/needsfs/i.js", "const fs = require('fs');\nexports.size = fs.statSync('.').size;\n"],
    ["node_modules/needsfs/i.d.ts", "export declare const size: number;\n"],
    ["node_modules/shimmed/package.json", "{\"name\":\"shimmed\",\"main\":\"i.js\",\"types\":\"i.d.ts\"}"],
    ["node_modules/shimmed/i.js", `const path = require("path");
const os = require("node:os");
exports.paths = () => [path.join("a", "../b", "c.txt"), path.resolve("/x", "y", ".."), path.relative("/a/b/c", "/a/d"), path.dirname("/a/b/c"), path.basename("/a/b/c.txt", ".txt"), path.extname("x.tar.gz"), path.normalize("/a//b/../c/"), path.posix.sep].join("|");
exports.platform = () => os.platform();
exports.home = () => process.env.HOME;
exports.unset = () => process.env.FISH_SHIM_SURELY_UNSET === undefined;
exports.args = () => process.argv.slice(2).join(",");
exports.mode = () => process.env.NODE_ENV;
exports.written = () => { process.env.FISH_SHIM_WRITTEN ||= "set"; const kept = process.env.FISH_SHIM_WRITTEN; delete process.env.FISH_SHIM_WRITTEN; return kept + ("FISH_SHIM_WRITTEN" in process.env); };
`],
    ["node_modules/shimmed/i.d.ts", "export declare function paths(): string;\nexport declare function platform(): string;\nexport declare function home(): string;\nexport declare function unset(): boolean;\nexport declare function args(): string;\nexport declare function mode(): string;\nexport declare function written(): string;\n"],
    ["node_modules/files/package.json", "{\"name\":\"files\",\"type\":\"module\",\"main\":\"i.js\",\"types\":\"i.d.ts\"}"],
    ["node_modules/files/i.js", `import { readFile, writeFile } from "node:fs/promises";
export async function roundTrip(path, text) { await writeFile(path, text); const back = await readFile(path, "utf8"); const bytes = await readFile(path); return back + ":" + bytes.length + ":" + (bytes instanceof Uint8Array) + ":" + String(bytes) + ":" + bytes.toString(); }
export function ordered(path) { const log = []; Promise.resolve().then(() => log.push("micro")); readFile(path); log.push("sync"); return log.join(); }
export async function missing(path) { try { await readFile(path); return "read"; } catch (e) { return e.code + " " + e.syscall; } }
`],
    ["node_modules/files/i.d.ts", "export declare function roundTrip(path: string, text: string): Promise<string>;\nexport declare function missing(path: string): Promise<string>;\nexport declare function ordered(path: string): string;\n"],
    ["node_modules/usescrypto/package.json", "{\"name\":\"usescrypto\",\"main\":\"i.js\",\"types\":\"i.d.ts\"}"],
    ["node_modules/usescrypto/i.js", "exports.id = require('crypto').randomUUID;\n"],
    ["node_modules/usescrypto/i.d.ts", "export declare function id(): string;\n"],
    ["node_modules/typesonly/package.json", "{\"name\":\"typesonly\",\"types\":\"index.d.ts\"}"],
    ["node_modules/typesonly/index.d.ts", "export declare const gone: string;\n"],
  ];
}

// A run of a built program.
type Out = { stdout: string; stderr: string; exitCode: i64 };

function shown(o: Ref<Out>): string {
  return `exit ${o.exitCode}\nstdout:\n${o.stdout}\nstderr:\n${o.stderr}`;
}

function sameOut(got: Ref<Out>, want: Ref<Out>, what: string): void {
  assert(got === want, `${what}:\n--- expected\n${shown(want)}\n--- got\n${shown(got)}`);
}

// A run that panicked with stderr starting `start`.
function panicked(got: Ref<Out>, start: string, what: string): void {
  assert(got.stdout === "" && got.exitCode === 101 && got.stderr.startsWith(start), `${what}: expected a panic starting\n${start}\n--- got\n${shown(got)}`);
}

function write(path: string, contents: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

// A project `name` under `root` with the packages above, `files` and `main.fsh`, giving its
// directory.
function project(root: string, name: string, main: string, files: [string, string][] = []): string {
  const dir = join(root, name);
  for (const [path, contents] of packages()) write(join(dir, path), contents);
  for (const [path, contents] of files) write(join(dir, path), contents);
  write(join(dir, "main.fsh"), main);
  return dir;
}

// Runs the program built at `out` with FISH_LEAKS=1, `vars` and `args`, paths in `dir` shown
// relative to it.
function execute(dir: string, out: string, args: string[], vars: string[]): Out {
  const run = spawnSync("env", ["FISH_LEAKS=1", ...vars, out, ...args]);
  return { stdout: text(run.stdout), stderr: text(run.stderr).replaceAll(`${dir}/`, ""), exitCode: run.status ?? -1 };
}

// Builds `main.fsh` in `dir` with `flags`, failing the test on any compile error; warnings are
// let through.
function builtIn(dir: string, flags: string[]): string {
  const b = fishc(dir, ["build", "main.fsh", "-o", "main", ...flags]);
  assert(b.code === 0, `the build failed:\n${b.err}`);
  return join(dir, "main");
}

// Builds `main` in a project of its own and runs it, reporting the leak count.
function run(root: string, name: string, main: string, args: string[] = [], vars: string[] = []): Out {
  const dir = project(root, name, main);
  return execute(dir, builtIn(dir, []), args, vars);
}

// The compile error a build of `main` stops at, its first line as fishc prints it.
function refusal(root: string, name: string, main: string): string {
  const dir = project(root, name, main);
  const b = fishc(dir, ["build", "main.fsh", "-o", "main"]);
  if (b.code === 0) return "the program was built";
  return b.err.split("\n")[0].replaceAll(`${dir}/`, "");
}

// The program `main` in `dir` built and run under AddressSanitizer, reporting leaks.
function sanitized(dir: string, main: string): Out {
  write(join(dir, "main.fsh"), main);
  return execute(dir, builtIn(dir, ["--sanitize", "address"]), [], []);
}

function ok(stdout: string): Out {
  return { stdout, stderr: "", exitCode: 0 };
}

test("a package's consts are read from its JS, ESM and CommonJS alike", () => {
  const root = scratch("fish-packages-");
  sameOut(run(root, "p", `import { VERSION, COUNT, ON } from "esm";
import { n, name } from "cjs";
function main() {
  console.log(VERSION, COUNT, ON, n, name);
}
`), ok("ONE 2.5 true 3 cjs\n"), "the program");
  removed(root);
}, { timeout: 30_000 });

test("a const that isn't what its declaration says panics where it is read", () => {
  const root = scratch("fish-packages-");
  sameOut(run(root, "p", `import { WRONG } from "esm";
function main() {
  const w = WRONG;
}
`), { stdout: "", stderr: "panicked at main.fsh:3:13:\n'WRONG' from 'esm' is a number, where its declaration says 'string'\nstack backtrace:\n   0: main at main.fsh:3:13\n", exitCode: 101 }, "the program");
  removed(root);
}, { timeout: 30_000 });

test("a package needing a Node built-in, or with no JS, is refused", () => {
  const root = scratch("fish-packages-");
  same(refusal(root, "p0", `import { size } from "needsfs";\nfunction main() { console.log(size); }\n`), "main.fsh:1:1: error[E1005]: 'needsfs' needs Node's 'fs' module, which a package's JS can't use in Fish yet", "a package needing fs");
  const none = refusal(root, "p1", `import { gone } from "typesonly";\nfunction main() { console.log(gone); }\n`);
  assert(none.startsWith("main.fsh:1:1: error[E0901]: 'typesonly' has no JS Fish could bundle: "), `a package with no JS: ${none}`);
  removed(root);
}, { timeout: 30_000 });

test("a program importing a package it never reaches at run time isn't bundled", () => {
  const root = scratch("fish-packages-");
  sameOut(run(root, "p", `import { size } from "needsfs";\nfunction main() { console.log(1); }\n`), ok("1\n"), "the program");
  removed(root);
}, { timeout: 30_000 });

test("a JS throw, or a result that isn't what its declaration says, panics at the call", () => {
  const root = scratch("fish-packages-");
  sameOut(run(root, "p0", `import { boom } from "esm";\nfunction main() {\n  boom();\n}\n`), { stdout: "", stderr: "panicked at main.fsh:3:3:\nuncaught exception in JS: RangeError: too far\nstack backtrace:\n   0: main at main.fsh:3:3\n", exitCode: 101 }, "a throw");
  sameOut(run(root, "p1", `import { liar } from "esm";\nfunction main() {\n  console.log(liar());\n}\n`), { stdout: "", stderr: "panicked at main.fsh:3:15:\n'liar' from 'esm' gave a number, where its declaration says 'string'\nstack backtrace:\n   0: main at main.fsh:3:15\n", exitCode: 101 }, "a wrong result");
  removed(root);
}, { timeout: 30_000 });

test("arrays, tuples and objects are copied across, and a handle passes as itself, with no leaks", () => {
  const root = scratch("fish-packages-");
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
  sameOut(sanitized(project(root, "p", main), main), ok("3 1 3\n2 2 c\na 1 2 a\nx:?:1 y:true:2\nmade3 made4 true false\n"), "the program");
  removed(root);
}, { timeout: 30_000 });

test("an array whose elements aren't what the declaration says panics naming them", () => {
  const root = scratch("fish-packages-");
  panicked(run(root, "p", `import { strings } from "esm";\nfunction main() {\n  console.log(strings());\n}\n`), "panicked at main.fsh:3:15:\n'strings' from 'esm' gave an array holding a number, where its declaration says 'string'\n", "the program");
  removed(root);
}, { timeout: 30_000 });

test("a package's classes are made, their fields read and written, and their methods and statics used", () => {
  const root = scratch("fish-packages-");
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
  sameOut(sanitized(project(root, "p", main), main), ok("3 box1 5 5\nbox1:10\nmade2:1 10\n5 new new5 n3\n"), "the program");
  removed(root);
}, { timeout: 30_000 });

test("a compound assignment to a handle's property waits", () => {
  const root = scratch("fish-packages-");
  same(refusal(root, "p", `import { Box } from "esm";\nfunction main() {\n  const b = new Box(1);\n  b.size += 1;\n}\n`), "main.fsh:4:3: error[E0801]: compound assignments to a package's properties are not supported yet", "the refusal");
  removed(root);
}, { timeout: 30_000 });

test("results of every type the checker lets cross are read as declared", () => {
  const root = scratch("fish-packages-");
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
  sameOut(sanitized(project(root, "p", main), main), ok("5 200 1.5 2 x 7 true true\n1\n"), "the program");
  removed(root);
}, { timeout: 30_000 });

test("a result no member of its declared union takes panics", () => {
  const root = scratch("fish-packages-");
  sameOut(run(root, "p", `import { rb } from "esm";\nfunction main() {\n  const r = rb();\n}\n`), { stdout: "", stderr: "panicked at main.fsh:3:13:\n'rb' from 'esm' gave a number, where its declaration says 'boolean | Result'\nstack backtrace:\n   0: main at main.fsh:3:13\n", exitCode: 101 }, "the program");
  removed(root);
}, { timeout: 30_000 });

test("a Fish value can't become a handle, and a package can't run while compiling", () => {
  const root = scratch("fish-packages-");
  const handle = refusal(root, "p0", `import { Result } from "esm";\nfunction main() {\n  const r: Result = { count: 1, label: "x" };\n}\n`);
  assert(handle.startsWith("main.fsh:3:21: error[E1005]: turning a Fish value into a JS value isn't supported yet"), `a Fish value as a handle: ${handle}`);
  same(refusal(root, "p1", `import { id } from "esm";\nconst X = id("x");\nfunction main() {}\n`), "main.fsh:2:7: error[E1101]: 'id' from the package 'esm' can't run while compiling: comptime code only computes values", "a package while compiling");
  removed(root);
}, { timeout: 30_000 });

test("a union's members of one JS kind are told apart by what they hold", () => {
  const root = scratch("fish-packages-");
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
  sameOut(sanitized(project(root, "p", main), main), ok("[ 'a' ] [ 1, 2 ] [ 't', 9 ]\n2 true true true\n"), "the program");
  removed(root);
}, { timeout: 30_000 });

test("a generic Fish function forwards its type parameter to a package", () => {
  const root = scratch("fish-packages-");
  sameOut(run(root, "p", `import { id } from "esm";\nfunction g<T>(x: T): T {\n  return id(x);\n}\nfunction main() {\n  console.log(g("ok"), g(3));\n}\n`), ok("ok 3\n"), "the program");
  removed(root);
}, { timeout: 30_000 });

test("an empty value is undefined in a property written with ?, and null in one that isn't", () => {
  const root = scratch("fish-packages-");
  sameOut(run(root, "p", `import { describe } from "esm";\nfunction main() {\n  const deep: boolean | null = null;\n  console.log(describe({ name: "z", deep }));\n}\n`), ok("z:?:2\n"), "the program");
  removed(root);
}, { timeout: 30_000 });

test("a handle meets another declaration of its type, in another file or a shape it fits", () => {
  const root = scratch("fish-packages-");
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
  const dir = project(root, "p", main, [["lib.fsh", `import { relabel } from "esm";\nimport type { Result } from "esm";\nexport function counted(r: Result): string {\n  return relabel(r);\n}\n`]]);
  sameOut(sanitized(dir, main), ok("made2 made 2 true\n"), "the program");
  removed(root);
}, { timeout: 30_000 });

test("a Fish type holding itself has no JS form yet", () => {
  const root = scratch("fish-packages-");
  same(refusal(root, "p", `import { id } from "esm";\ntype Tree = { v: f64; kids: Tree[] };\nfunction main() {\n  const t: Tree = { v: 1, kids: [] };\n  const u = id(t);\n}\n`), "node_modules/esm/index.d.ts:26:34: error[E1005]: 'id' from 'esm' takes a 'Tree', which can't cross between Fish and JS yet: a type holding itself has no JS form yet", "the refusal");
  removed(root);
}, { timeout: 30_000 });

test("a package's promises are awaited, a rejection thrown as a JsError, and a later settling wakes its task", () => {
  const root = scratch("fish-packages-");
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
  sameOut(sanitized(project(root, "p", main), main), ok("42\nJsError bad input\n[JsError: bad input]\nreleased\n"), "the program");
  removed(root);
}, { timeout: 30_000 });

test("awaiting a package's promise is a throw to catch or declare", () => {
  const root = scratch("fish-packages-");
  const got = refusal(root, "p", `import { twice } from "esm";\nasync function main() {\n  const n = await twice(1);\n}\n`);
  assert(got.startsWith("main.fsh:3:13: error[E0602]: 'main' must declare 'throws JsError'"), `the refusal: ${got}`);
  removed(root);
}, { timeout: 30_000 });

test("Fish callbacks are called by JS during a call and kept for later, and freed when JS drops them", () => {
  const root = scratch("fish-packages-");
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
  sameOut(sanitized(project(root, "p", main), main), ok("6\n[ 'A', 'B' ] [ 'c4' ]\ngot one got two\nnone\n"), "the program");
  removed(root);
}, { timeout: 30_000 });

// fishc test's own limit bounds the run, so a lock the panic left held fails the test rather than
// hanging it.
test("a task panicking in a callback JS runs ends the program, since the panic would cross JS's frames", () => {
  const root = scratch("fish-packages-");
  const main = `import { each } from "esm";
async function boom(): Promise<void> {
  await yieldNow();
  const xs = [1];
  each([1], (x) => { console.log(xs[3]); });
}
async function use(): Promise<void> {
  await sleep(10);
  each([1], (x) => {});
}
async function main() {
  try {
    await spawn(boom()).join();
  } catch (e) {
    console.log("caught");
  }
  await spawn(use());
  console.log("done");
}
`;
  sameOut(run(root, "p", main), {
    stdout: "",
    stderr: "panicked at main.fsh:5:34:\nindex out of bounds: the len is 1 but the index is 3\nstack backtrace:\n   0: <arrow 5:13> at main.fsh:5:34\n   1: boom at main.fsh:5:3\nspawned at main.fsh:13:11\n",
    exitCode: 101,
  }, "the program");
  removed(root);
}, { timeout: 30_000 });

test("a callback holding what isn't Send is refused, and one JS gives the wrong value panics", () => {
  const root = scratch("fish-packages-");
  same(refusal(root, "p0", `import { keep } from "esm";\nfunction main() {\n  const c = new Cell<i64>(0);\n  keep((s) => { c.set(1); return s; });\n}\n`), "main.fsh:4:8: error[E0303]: a '(s: string) => string' may cross to another thread, so it can't hold a 'Cell<i64>', which changes without a lock", "a Cell in a callback");
  panicked(run(root, "p1", `import { misuse } from "esm";\nfunction main() {\n  console.log(misuse((n) => n + 1));\n}\n`), "panicked at main.fsh:3:22:\na callback was given a string, where its declaration says 'number'\n", "a misused callback");
  removed(root);
}, { timeout: 30_000 });

test("a Fish future given to JS is a promise, running as a task from when it is given", () => {
  const root = scratch("fish-packages-");
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
  sameOut(sanitized(project(root, "p", main), main), ok("8 ignored\nran though ignored\n"), "the program");
  removed(root);
}, { timeout: 30_000 });

test("a future is given to JS only inside an async function, and only one that can't throw", () => {
  const root = scratch("fish-packages-");
  same(refusal(root, "p0", `import { ignore } from "esm";\nasync function done(): Promise<void> {}\nfunction main() {\n  console.log(ignore(done()));\n}\n`), "main.fsh:4:22: error[E1005]: a Promise given to JS starts running as a task when it is given, so it is given only inside an 'async' function", "a future outside async code");
  const thrown = refusal(root, "p1", `import { plusOne } from "esm";\nclass Bad { message: string = "b"; }\nasync function fails(): Promise<f64> throws Bad {\n  throw new Bad();\n}\nasync function main(): Promise<void> throws JsError {\n  const n = await plusOne(fails());\n}\n`);
  assert(thrown.startsWith("main.fsh:7:27: error[E0602]: a stored 'Promise<number>' can't throw yet"), `a throwing future: ${thrown}`);
  removed(root);
}, { timeout: 30_000 });

test("callbacks from fields and given to a handle's methods, kept at exit, and an await that never settles, leak nothing", () => {
  const root = scratch("fish-packages-");
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
  sameOut(sanitized(project(root, "p", main), main), ok("x! amade1,A\nsoon\n"), "the program");
  removed(root);
}, { timeout: 30_000 });

test("a callback or a Promise written to a handle's property goes to JS, and isn't read back", () => {
  const root = scratch("fish-packages-");
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
  sameOut(sanitized(project(root, "p0", main), main), ok("why? later\n"), "the program");
  same(refusal(root, "p1", `import { Slot } from "esm";\nfunction main() {\n  const s = new Slot();\n  const f = s.handler;\n}\n`), "main.fsh:4:13: error[E0801]: reading property 'handler' of 'Slot' isn't supported yet: it holds a function, which Fish can give JS but not read back", "reading a callback back");
  same(refusal(root, "p2", `import { Slot } from "esm";\nfunction main() {\n  const s = new Slot();\n  const f = (s.handler = (t) => t);\n}\n`), "main.fsh:4:14: error[E1005]: a callback or a Promise written to property 'handler' goes to JS, so the assignment has no value to use; write it as a statement of its own", "using the assignment's value");
  removed(root);
}, { timeout: 30_000 });

test("calling into JS under a Lock panics, and a handle dropped under one is freed later", () => {
  const root = scratch("fish-packages-");
  const main = `import { make, relabel } from "esm";
function main() {
  const l = new Lock([make(1), make(2)]);
  l.update((xs) => { xs.pop(); });
  const m = make(3);
  console.log(relabel(m));
}
`;
  sameOut(sanitized(project(root, "p0", main), main), ok("made3\n"), "the program");
  sameOut(run(root, "p1", `import { shout } from "esm";\nfunction main() {\n  const l = new Lock("a");\n  l.update((v) => { v = shout(v); });\n}\n`), { stdout: "", stderr: "panicked at main.fsh:4:25:\ncalled into JS while holding a Lock, which a callback JS runs may wait for; call the package before 'update' or after it\nstack backtrace:\n   0: <arrow 4:12> at main.fsh:4:25\n   1: main at main.fsh:4:3\n", exitCode: 101 }, "calling under a Lock");
  removed(root);
}, { timeout: 30_000 });

test("a callback inside an object given to JS waits", () => {
  const root = scratch("fish-packages-");
  const got = refusal(root, "p", `import { withOpts } from "esm";\nfunction main() {\n  console.log(withOpts({ cb: (x) => x + 1 }));\n}\n`);
  assert(got.startsWith("node_modules/esm/index.d.ts:"), `the refusal: ${got}`);
  removed(root);
}, { timeout: 30_000 });

test("a nested object given to JS takes numbers as JS does, and an optional require runs", () => {
  const root = scratch("fish-packages-");
  sameOut(run(root, "p", `import { deep, optional, listed } from "esm";\nfunction main() {\n  console.log(deep({ inner: { v: 5 } }), optional(), listed({ list: [] }));\n}\n`), ok("5 caught 0\n"), "the program");
  removed(root);
}, { timeout: 30_000 });

test("bundled JS's path, os and process are Fish's, and another Node module is refused naming it", () => {
  const root = scratch("fish-packages-");
  const main = `import { paths, platform, home, unset, args, mode, written } from "shimmed";
import * as path from "node:path";
import * as os from "node:os";
function main() {
  console.log(paths());
  console.log([path.join("a", "../b", "c.txt"), path.resolve("/x", "y", ".."), path.relative("/a/b/c", "/a/d"), path.dirname("/a/b/c"), path.basename("/a/b/c.txt", ".txt"), path.extname("x.tar.gz"), path.normalize("/a//b/../c/"), path.sep].join("|"));
  console.log(platform() === os.platform(), home() === process.env.HOME, unset(), args(), mode(), written());
}
`;
  sameOut(run(root, "p0", main, ["one", "two"], ["NODE_ENV=production"]), ok("b/c.txt|/x|../../d|/a/b|c|.gz|/a/c/|/\nb/c.txt|/x|../../d|/a/b|c|.gz|/a/c/|/\ntrue true true one,two production setfalse\n"), "the program");
  same(refusal(root, "p1", `import { id } from "usescrypto";\nfunction main() { console.log(id()); }\n`), "main.fsh:1:1: error[E1005]: 'usescrypto' needs Node's 'crypto' module, which a package's JS can't use in Fish yet", "a package needing crypto");
  removed(root);
}, { timeout: 30_000 });

test("bundled JS's fs/promises reads and writes through Fish's blocking pool, a failure as Node's error", () => {
  const root = scratch("fish-packages-");
  const dir = project(root, "p0", "");
  const main = `import { roundTrip, missing } from "files";
async function main(): Promise<void> throws JsError {
  const r = await roundTrip(${JSON.stringify(join(dir, "written.txt"))}, "héllo");
  const m = await missing(${JSON.stringify(join(dir, "absent.txt"))});
  console.log(r, m);
}
`;
  sameOut(sanitized(dir, main), ok("héllo:6:true:héllo:héllo ENOENT open\n"), "the program");
  // With no async runtime the file is read at once, and the promise's jobs still wait for the
  // calling JS to finish.
  sameOut(run(root, "p1", `import { ordered } from "files";\nfunction main() { console.log(ordered(${JSON.stringify(join(dir, "written.txt"))})); }\n`), ok("sync\n"), "a read with no async runtime");
  removed(root);
}, { timeout: 30_000 });
