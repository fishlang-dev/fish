// Where a package's declarations are found and what they export, in process through the compiler's
// typings module, and the refusals a program's imports get, from `fishc check`, which loads the
// program without building it. JSON is written as text, since Fish's JSON.stringify sorts an
// object's keys and `exports` conditions keep their order.
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { exportsOf, findTypings } from "../../src/typings.fsh";
import { fishc, removed, same, scratch } from "./support.fsh";

// A project directory holding these files, by its real path, as found files are given by theirs.
function project(files: Ref<[string, string][]>): string {
  const dir = scratch("fish-typings-");
  for (const [path, contents] of files) {
    try {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), contents);
    } catch (e) {
      assert(false, `can't write ${path}: ${e.message}`);
    }
  }
  return dir;
}

// Where a specifier imported from `src/main.fsh` resolves, relative to the project.
function found(dir: string, specifier: string): string {
  const t = findTypings(join(dir, "src", "main.fsh"), specifier);
  return "file" in t ? relative(dir, t.file) : `missing: ${t.missing}`;
}

function at(dir: string, specifier: string, want: string): void {
  same(found(dir, specifier), want, `'${specifier}'`);
}

function near(dir: string, specifier: string, part: string): void {
  const got = found(dir, specifier);
  assert(got.includes(part), `'${specifier}': expected it to contain\n${part}\n--- got\n${got}`);
}

// A file's export names, sorted when `sorted`, or why it has none.
function exported(file: string, specifier: string | undefined, sorted: boolean): string[] | string {
  try {
    const e = exportsOf({ last: 0 }, file, specifier);
    if (typeof e === "string") return e;
    let names: string[] = [];
    for (const k of e.names.keys()) names.push(k);
    if (sorted) names.sort();
    return names;
  } catch (e) {
    return `threw: ${e.message}`;
  }
}

function shown(v: Ref<string[] | string>): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

// The message a check of `file` in `dir` stops at, or "loaded".
function refusal(dir: string, file: string): string {
  const run = fishc(dir, ["check", file]);
  if (run.code === 0) return "loaded";
  return run.err.split("\n")[0].replace(/^[^ ]*: error\[\w+\]: /, "");
}

test("typings, types, main and index.d.ts, in that order", () => {
  const dir = project([
    ["node_modules/a/package.json", `{"types":"no.d.ts","typings":"lib/a.d.ts"}`],
    ["node_modules/a/lib/a.d.ts", ""],
    ["node_modules/a2/package.json", `{"types":"gone.d.ts","main":"main.js"}`],
    ["node_modules/a2/main.d.ts", ""],
    ["node_modules/a2/index.d.ts", ""],
    ["node_modules/b/package.json", `{"typings":"b.d.ts"}`],
    ["node_modules/b/b.d.ts", ""],
    ["node_modules/c/package.json", `{"main":"dist/c.js"}`],
    ["node_modules/c/dist/c.d.ts", ""],
    ["node_modules/d/index.d.ts", ""],
  ]);
  at(dir, "a", "node_modules/a/lib/a.d.ts");
  // A missing `types` file leaves index.d.ts, passing over `main`, as tsc does.
  at(dir, "a2", "node_modules/a2/index.d.ts");
  at(dir, "b", "node_modules/b/b.d.ts");
  at(dir, "c", "node_modules/c/dist/c.d.ts");
  at(dir, "d", "node_modules/d/index.d.ts");
  removed(dir);
});

test("exports as a string, conditions in their own order, and subpath patterns", () => {
  const dir = project([
    ["node_modules/e/package.json", `{"exports":"./e.js","types":"ignored.d.ts"}`],
    ["node_modules/e/e.d.ts", ""],
    ["node_modules/f/package.json", `{"exports":{"require":"./f.cjs","import":"./f.mjs","types":"./types/f.d.ts"}}`],
    ["node_modules/f/f.d.mts", ""],
    ["node_modules/f/types/f.d.ts", ""],
    ["node_modules/g/package.json", `{"exports":{".":{"types":"./g.d.ts"},"./utils":{"import":"./utils.mjs"},"./features/*":"./dist/features/*.js","./features/x/*":"./x/*.js","./internal/*":null}}`],
    ["node_modules/g/g.d.ts", ""],
    ["node_modules/g/utils.d.mts", ""],
    ["node_modules/g/dist/features/one.d.ts", ""],
    ["node_modules/g/x/two.d.ts", ""],
  ]);
  at(dir, "e", "node_modules/e/e.d.ts");
  at(dir, "f", "node_modules/f/f.d.mts");
  at(dir, "g", "node_modules/g/g.d.ts");
  at(dir, "g/utils", "node_modules/g/utils.d.mts");
  at(dir, "g/features/one", "node_modules/g/dist/features/one.d.ts");
  at(dir, "g/features/x/two", "node_modules/g/x/two.d.ts");
  near(dir, "g/internal/secret", "doesn't export './internal/secret' in its package.json 'exports'");
  near(dir, "g/nope", "doesn't export './nope'");
  removed(dir);
});

test("scoped packages, subpaths without exports, and @types", () => {
  const dir = project([
    ["node_modules/@s/p/package.json", `{"types":"p.d.ts"}`],
    ["node_modules/@s/p/p.d.ts", ""],
    ["node_modules/h/sub.d.ts", ""],
    ["node_modules/h/dir/index.d.ts", ""],
    ["node_modules/h/index.js", ""],
    ["node_modules/i/index.js", ""],
    ["node_modules/@types/i/index.d.ts", ""],
    ["node_modules/@types/s__q/index.d.ts", ""],
  ]);
  at(dir, "@s/p", "node_modules/@s/p/p.d.ts");
  at(dir, "h/sub", "node_modules/h/sub.d.ts");
  at(dir, "h/dir", "node_modules/h/dir/index.d.ts");
  at(dir, "i", "node_modules/@types/i/index.d.ts");
  at(dir, "@s/q", "node_modules/@types/s__q/index.d.ts");
  removed(dir);
});

test("the nearest node_modules first, then those above", () => {
  const dir = project([
    ["node_modules/j/index.d.ts", ""],
    ["src/node_modules/j/index.d.ts", ""],
    ["node_modules/k/index.d.ts", ""],
    ["src/node_modules/k/index.js", ""],
  ]);
  at(dir, "j", "src/node_modules/j/index.d.ts");
  // One without declarations is passed over for one further up that has them.
  at(dir, "k", "node_modules/k/index.d.ts");
  removed(dir);
});

test("each miss says where it looked", () => {
  const dir = project([
    ["node_modules/l/index.js", ""],
    ["node_modules/m/package.json", `{"types":"gone.d.ts"}`],
    ["node_modules/n/package.json", "{ not json"],
  ]);
  at(dir, "none", `missing: can't find the package 'none': no 'node_modules/none' in '${join(dir, "src")}' or any directory above it; install it with npm`);
  at(dir, "l", "missing: 'l' has no TypeScript declarations: its package.json gives no 'types', and it has no index.d.ts, and there is no '@types/l'; Fish types a package from its declarations");
  near(dir, "m", "'m' names 'gone.d.ts' as its 'types', which isn't there");
  near(dir, "n", "'n' has a package.json that isn't JSON");
  removed(dir);
});

function declarations(): string {
  return `export declare function camelCase(s: string): string;
export function plain(n: number): number;
export declare const VERSION: string, OTHER: number;
export interface Options { deep?: boolean; }
export type Mode = "a" | "b";
export declare class Box<T> { get(): T; }
export declare enum Kind { A, B }
declare function hidden(): void;
export { hidden as shown };
export * from "./more";
export * as ns from "./more";
export { fromMore as renamed } from "./more.js";
export default camelCase;
`;
}

test("a declaration file's exports, through its re-exports", () => {
  const dir = project([
    ["node_modules/p/index.d.ts", declarations()],
    ["node_modules/p/more.d.ts", "export declare function fromMore(): void;\nexport default 1;\n"],
  ]);
  try {
    const read = exportsOf({ last: 0 }, join(dir, "node_modules/p/index.d.ts"));
    assert(typeof read !== "string", `the exports: ${typeof read === "string" ? read : ""}`);
    if (typeof read === "string") return;
    let keys: string[] = [];
    for (const k of read.names.keys()) keys.push(k);
    keys.sort();
    same(JSON.stringify(keys), JSON.stringify(["Box", "Kind", "Mode", "OTHER", "Options", "VERSION", "camelCase", "default", "fromMore", "ns", "plain", "renamed", "shown"]), "the names");
    let where: string[] = [];
    for (const name of ["shown", "fromMore", "renamed", "default"]) {
      const d = read.names.get(name)!;
      where.push(`${relative(dir, d.file)}:${d.src.slice(0, d.at.start as i64).split("\n").length}`);
    }
    same(JSON.stringify(where), JSON.stringify(["node_modules/p/index.d.ts:8", "node_modules/p/more.d.ts:1", "node_modules/p/more.d.ts:1", "node_modules/p/index.d.ts:1"]), "where each is declared");
  } catch (e) {
    assert(false, `reading the exports threw: ${e.message}`);
  }
  removed(dir);
});

test("export = a namespace, and a types package's declare module", () => {
  const dir = project([
    ["node_modules/q/index.d.ts", "declare function q(n: number): string;\ndeclare namespace q {\n  function chunk<T>(xs: T[], n: number): T[][];\n  const version: string;\n}\nexport = q;\n"],
    ["node_modules/@types/r/index.d.ts", "declare module \"r\" {\n  export function run(): void;\n}\ndeclare module \"r/other\" {\n  export const x: number;\n}\n"],
    ["node_modules/r/index.js", ""],
  ]);
  same(shown(exported(join(dir, "node_modules/q/index.d.ts"), undefined, true)), JSON.stringify(["chunk", "default", "version"]), "q's names");
  const t = findTypings(join(dir, "main.fsh"), "r");
  const r = "file" in t ? shown(exported(t.file, "r", false)) : t.missing;
  same(r, JSON.stringify(["run"]), "r's names");
  removed(dir);
});

test("an import from a package that doesn't have the name is refused saying what it exports", () => {
  const dir = project([
    ["node_modules/p/index.d.ts", declarations()],
    ["node_modules/p/more.d.ts", "export declare function fromMore(): void;\n"],
    ["b.fsh", "import { nope } from \"p\";\nfunction main() {}\n"],
    ["c.fsh", "import { x } from \"absent\";\nfunction main() {}\n"],
  ]);
  same(refusal(dir, "b.fsh"), "'p' has no export 'nope'; its declarations in 'node_modules/p/index.d.ts' export 'Box', 'Kind', 'Mode', 'OTHER', 'Options', 'VERSION', 'camelCase', 'default', 'fromMore', 'ns', 'plain', 'renamed', and 1 more", "a missing name");
  const absent = refusal(dir, "c.fsh");
  assert(absent.startsWith("can't find the package 'absent'"), `a missing package: ${absent}`);
  removed(dir);
});

test("a relative entry path searches from its directory up", () => {
  const dir = project([["node_modules/p/index.d.ts", ""], ["src/main.fsh", ""]]);
  const cwd = process.cwd();
  try {
    process.chdir(join(dir, "src"));
    const t = findTypings("main.fsh", "p");
    process.chdir(cwd);
    same("file" in t ? relative(dir, t.file) : t.missing, "node_modules/p/index.d.ts", "the found file");
  } catch (e) {
    assert(false, `can't change directory: ${e.message}`);
  }
  removed(dir);
});

test("conditions and arrays fall through to one with a declaration, and null ends the search", () => {
  const dir = project([
    ["node_modules/a/package.json", `{"exports":{".":{"import":"./esm/index.mjs","require":"./index.js","default":"./index.js"}}}`],
    ["node_modules/a/index.d.ts", ""],
    ["node_modules/b/package.json", `{"exports":{"types":"./missing.d.ts","default":"./b.js"}}`],
    ["node_modules/b/b.d.ts", ""],
    ["node_modules/c/package.json", `{"exports":{".":["./nope.js","./c.js"]}}`],
    ["node_modules/c/c.d.ts", ""],
    ["node_modules/d/package.json", `{"exports":{"types":null,"default":"./d.js"}}`],
    ["node_modules/d/d.d.ts", ""],
    ["node_modules/e/package.json", `{"exports":{"./*":"./one/*.js","./*.js":"./two/*.js","./x":"dist/x.js","./y":"./../y.js","./z":"./z"}}`],
    ["node_modules/e/two/f.d.ts", ""],
    ["node_modules/e/dist/x.d.ts", ""],
    ["node_modules/e/z.d.ts", ""],
  ]);
  at(dir, "a", "node_modules/a/index.d.ts");
  at(dir, "b", "node_modules/b/b.d.ts");
  at(dir, "c", "node_modules/c/c.d.ts");
  near(dir, "d", "doesn't export '.'");
  // The longer pattern wins a tie; a target must be written from './', stay inside, and name a file.
  at(dir, "e/f.js", "node_modules/e/two/f.d.ts");
  for (const sub of ["x", "y", "z"]) near(dir, `e/${sub}`, `exports './${sub}', but none of what it maps it to has a declaration file`);
  removed(dir);
});

test("a symlinked package resolves to its real path, and its own dependencies beside it", () => {
  const dir = project([
    ["node_modules/.pnpm/a@1/node_modules/a/index.d.ts", "export * from 'dep';\n"],
    ["node_modules/.pnpm/a@1/node_modules/dep/index.d.ts", "export declare const fromDep: number;\n"],
  ]);
  try {
    symlinkSync(join(dir, "node_modules/.pnpm/a@1/node_modules/a"), join(dir, "node_modules/a"));
  } catch (e) {
    assert(false, `can't link: ${e.message}`);
  }
  const t = findTypings(join(dir, "src/main.fsh"), "a");
  assert("file" in t, `not found: ${"missing" in t ? t.missing : ""}`);
  if ("file" in t) {
    same(relative(dir, t.file), "node_modules/.pnpm/a@1/node_modules/a/index.d.ts", "the found file");
    same(shown(exported(t.file, "a", false)), JSON.stringify(["fromDep"]), "its names");
  }
  removed(dir);
});

test("a subpath directory's own package.json, and package.json shapes that aren't one", () => {
  const dir = project([
    ["node_modules/a/ops/package.json", `{"types":"../dist/ops.d.ts"}`],
    ["node_modules/a/dist/ops.d.ts", ""],
    ["node_modules/n/package.json", "null"],
  ]);
  at(dir, "a/ops", "node_modules/a/dist/ops.d.ts");
  near(dir, "n", "'n' has a package.json that isn't an object");
  removed(dir);
});

// The names a declaration file's index exports, sorted, after writing the files, or why it has none.
function names(files: Ref<[string, string][]>, spec: string = "a"): string {
  const dir = project(files);
  const t = findTypings(join(dir, "src/main.fsh"), spec);
  const out = "file" in t ? shown(exported(t.file, spec, true)) : t.missing;
  removed(dir);
  return out;
}

test("names imported and exported again, implicit exports, and cycles", () => {
  same(names([
    ["node_modules/a/index.d.ts", "import { A } from './x';\nimport * as ns from './x';\nimport D from './x';\nexport { A, ns, D };\nexport import z = require('./x');\n"],
    ["node_modules/a/x.d.ts", "export declare const A: number;\nexport default 1;\n"],
  ]), JSON.stringify(["A", "D", "ns", "z"]), "names exported again");
  same(names([["node_modules/a/index.d.ts", "import { Y } from './y';\ndeclare const a: number;\nexport declare const b: Y;\n"], ["node_modules/a/y.d.ts", "export type Y = number;\n"]]), JSON.stringify(["a", "b"]), "implicit exports");
  same(names([["node_modules/@types/r/index.d.ts", "declare module 'r' { function run(): void; const v: number; interface I {} }\n"], ["node_modules/r/index.js", ""]], "r"), JSON.stringify(["I", "run", "v"]), "a declare module");
  same(names([
    ["node_modules/a/index.d.ts", "export * from './a';\nexport { a as viaB } from './b';\n"],
    ["node_modules/a/a.d.ts", "export * from './b';\nexport declare const a: number;\n"],
    ["node_modules/a/b.d.ts", "export * from './a';\nexport declare const b: number;\n"],
  ]), JSON.stringify(["a", "b", "viaB"]), "a cycle");
});

test("export = an imported module, an object's members, and a namespace's own exports", () => {
  same(names([["node_modules/a/index.d.ts", "import X = require('./x');\nexport = X;\n"], ["node_modules/a/x.d.ts", "export declare const A: number;\n"]]), JSON.stringify(["A", "default"]), "an imported module");
  same(names([["node_modules/a/index.d.ts", "declare const o: { p: number; m(): void };\nexport = o;\n"]]), JSON.stringify(["default", "m", "p"]), "an object's members");
  same(names([["node_modules/a/index.d.ts", "declare namespace q { export { y }; const x: number; }\ndeclare const y: number;\nexport = q;\n"]]), JSON.stringify(["default", "y"]), "a namespace's own exports");
});

test("a Node built-in Fish lacks is named as one, and a re-export that can't be read is said", () => {
  const dir = project([
    ["a.fsh", "import { Readable } from \"node:stream\";\nfunction main() {}\n"],
    ["b.fsh", "import { x } from \"p\";\nfunction main() {}\n"],
    ["node_modules/p/index.d.ts", "export * from 'gone';\nexport * from './missing';\n"],
  ]);
  same(refusal(dir, "a.fsh"), "'node:stream' is a Node module Fish's std doesn't have yet", "a Node built-in");
  const b = refusal(dir, "b.fsh");
  assert(b.startsWith("'p' has no export 'x'; its declarations in 'node_modules/p/index.d.ts' export nothing; re-exporting from 'gone' failed: can't find the package 'gone'"), `a re-export that can't be read: ${b}`);
  removed(dir);
});

test("a declaration file of globals isn't a module, and a cycle of re-exports stays quick", () => {
  const globals = names([["node_modules/g/index.d.ts", "declare function $(s: string): void;\ndeclare const jq: number;\n"]], "g");
  assert(globals.endsWith("index.d.ts' declares globals, not a module"), `globals: ${globals}`);
  // Each file re-exports the next two, round a ring of 30.
  let ring: [string, string][] = [["node_modules/a/index.d.ts", "export * from './f0';\n"]];
  for (let i = 0; i < 30; i++) ring.push([`node_modules/a/f${i}.d.ts`, `export * from './f${(i + 1) % 30}';\nexport * from './f${(i + 2) % 30}';\nexport declare const v${i}: number;\n`]);
  const dir = project(ring);
  const started = performance.now();
  const t = findTypings(join(dir, "src/main.fsh"), "a");
  const got = "file" in t ? exported(t.file, "a", true) : t.missing;
  const took = performance.now() - started;
  removed(dir);
  assert(typeof got !== "string" && got.length === 30, `the ring's names: ${shown(got)}`);
  assert(took < 2000, `reading the ring took ${took} ms`);
});

test("a subpath's file comes before its directory, whose package.json exports don't count", () => {
  const dir = project([
    ["node_modules/a/ops.d.ts", ""],
    ["node_modules/a/ops/package.json", `{"types":"other.d.ts"}`],
    ["node_modules/a/ops/other.d.ts", ""],
    ["node_modules/b/ops/package.json", `{"exports":"./e.js"}`],
    ["node_modules/b/ops/e.d.ts", ""],
    ["node_modules/b/ops/index.d.ts", ""],
    ["node_modules/c/ops/package.json", "{ not json"],
    ["node_modules/c/ops/index.d.ts", ""],
    ["node_modules/d/package.json", `{"exports":{".":[null,"./d.js"]}}`],
    ["node_modules/d/d.d.ts", ""],
  ]);
  at(dir, "a/ops", "node_modules/a/ops.d.ts");
  at(dir, "b/ops", "node_modules/b/ops/index.d.ts");
  at(dir, "c/ops", "node_modules/c/ops/index.d.ts");
  near(dir, "d", "doesn't export '.'");
  removed(dir);
});
