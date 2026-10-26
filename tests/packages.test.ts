import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { formatError } from "../src/diag.ts";
import { build } from "../src/main.ts";
import { sanitized } from "./sanitized.ts";

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
`,
  "node_modules/cjs/package.json": JSON.stringify({ name: "cjs", main: "lib.js", types: "lib.d.ts" }),
  "node_modules/cjs/lib.js": "exports.n = 3;\nexports.name = 'cjs';\n",
  "node_modules/cjs/lib.d.ts": "export declare const n: number;\nexport declare const name: string;\n",
  "node_modules/needsfs/package.json": JSON.stringify({ name: "needsfs", main: "i.js", types: "i.d.ts" }),
  "node_modules/needsfs/i.js": "const fs = require('fs');\nexports.size = fs.statSync('.').size;\n",
  "node_modules/needsfs/i.d.ts": "export declare const size: number;\n",
  "node_modules/typesonly/package.json": JSON.stringify({ name: "typesonly", types: "index.d.ts" }),
  "node_modules/typesonly/index.d.ts": "export declare const gone: string;\n",
};

let made = 0;

// Builds `main` in a project with the packages above and runs it, reporting the leak count;
// or gives the compile error it stops at, as fishc prints it.
function project(main: string): string {
  const dir = join(root, `p${made++}`);
  for (const [path, text] of Object.entries({ ...PACKAGES, "main.fsh": main })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

function run(main: string): { stdout: string; stderr: string; exitCode: number | null } | string {
  const dir = project(main);
  const [entry, out] = [join(dir, "main.fsh"), join(dir, "main")];
  try {
    build(entry, out);
  } catch (e) {
    return formatError(e as never, "main.fsh", main).split("\n")[0]!.replaceAll(`${dir}/`, "");
  }
  const ran = Bun.spawnSync([out], { env: { ...process.env, FISH_LEAKS: "1" } });
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
