import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { load } from "../src/modules.ts";
import { exportsOf, findTypings } from "../src/typings.ts";

// A project directory holding these files, removed after `run`.
function project(files: Record<string, string>, run: (dir: string) => void) {
  // Its real path, as found files are given by theirs.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "fish-typings-")));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Where a specifier imported from `src/main.fsh` resolves, relative to the project.
function found(dir: string, specifier: string): string {
  const t = findTypings(join(dir, "src", "main.fsh"), specifier);
  return "file" in t ? relative(dir, t.file) : `missing: ${t.missing}`;
}

const json = (v: unknown) => JSON.stringify(v);

test("typings, types, main and index.d.ts, in that order", () => {
  project({
    "node_modules/a/package.json": json({ types: "no.d.ts", typings: "lib/a.d.ts" }),
    "node_modules/a/lib/a.d.ts": "",
    "node_modules/a2/package.json": json({ types: "gone.d.ts", main: "main.js" }),
    "node_modules/a2/main.d.ts": "",
    "node_modules/a2/index.d.ts": "",
    "node_modules/b/package.json": json({ typings: "b.d.ts" }),
    "node_modules/b/b.d.ts": "",
    "node_modules/c/package.json": json({ main: "dist/c.js" }),
    "node_modules/c/dist/c.d.ts": "",
    "node_modules/d/index.d.ts": "",
  }, (dir) => {
    expect(found(dir, "a")).toBe("node_modules/a/lib/a.d.ts");
    // A missing `types` file leaves index.d.ts, passing over `main`, as tsc does.
    expect(found(dir, "a2")).toBe("node_modules/a2/index.d.ts");
    expect(found(dir, "b")).toBe("node_modules/b/b.d.ts");
    expect(found(dir, "c")).toBe("node_modules/c/dist/c.d.ts");
    expect(found(dir, "d")).toBe("node_modules/d/index.d.ts");
  });
});

test("exports as a string, conditions in their own order, and subpath patterns", () => {
  project({
    "node_modules/e/package.json": json({ exports: "./e.js", types: "ignored.d.ts" }),
    "node_modules/e/e.d.ts": "",
    "node_modules/f/package.json": json({ exports: { require: "./f.cjs", import: "./f.mjs", types: "./types/f.d.ts" } }),
    "node_modules/f/f.d.mts": "",
    "node_modules/f/types/f.d.ts": "",
    "node_modules/g/package.json": json({
      exports: { ".": { types: "./g.d.ts" }, "./utils": { import: "./utils.mjs" }, "./features/*": "./dist/features/*.js", "./features/x/*": "./x/*.js", "./internal/*": null },
    }),
    "node_modules/g/g.d.ts": "",
    "node_modules/g/utils.d.mts": "",
    "node_modules/g/dist/features/one.d.ts": "",
    "node_modules/g/x/two.d.ts": "",
  }, (dir) => {
    expect(found(dir, "e")).toBe("node_modules/e/e.d.ts");
    expect(found(dir, "f")).toBe("node_modules/f/f.d.mts");
    expect(found(dir, "g")).toBe("node_modules/g/g.d.ts");
    expect(found(dir, "g/utils")).toBe("node_modules/g/utils.d.mts");
    expect(found(dir, "g/features/one")).toBe("node_modules/g/dist/features/one.d.ts");
    expect(found(dir, "g/features/x/two")).toBe("node_modules/g/x/two.d.ts");
    expect(found(dir, "g/internal/secret")).toContain("doesn't export './internal/secret' in its package.json 'exports'");
    expect(found(dir, "g/nope")).toContain("doesn't export './nope'");
  });
});

test("scoped packages, subpaths without exports, and @types", () => {
  project({
    "node_modules/@s/p/package.json": json({ types: "p.d.ts" }),
    "node_modules/@s/p/p.d.ts": "",
    "node_modules/h/sub.d.ts": "",
    "node_modules/h/dir/index.d.ts": "",
    "node_modules/h/index.js": "",
    "node_modules/i/index.js": "",
    "node_modules/@types/i/index.d.ts": "",
    "node_modules/@types/s__q/index.d.ts": "",
  }, (dir) => {
    expect(found(dir, "@s/p")).toBe("node_modules/@s/p/p.d.ts");
    expect(found(dir, "h/sub")).toBe("node_modules/h/sub.d.ts");
    expect(found(dir, "h/dir")).toBe("node_modules/h/dir/index.d.ts");
    expect(found(dir, "i")).toBe("node_modules/@types/i/index.d.ts");
    expect(found(dir, "@s/q")).toBe("node_modules/@types/s__q/index.d.ts");
  });
});

test("the nearest node_modules first, then those above", () => {
  project({
    "node_modules/j/index.d.ts": "",
    "src/node_modules/j/index.d.ts": "",
    "node_modules/k/index.d.ts": "",
    "src/node_modules/k/index.js": "",
  }, (dir) => {
    expect(found(dir, "j")).toBe("src/node_modules/j/index.d.ts");
    // One without declarations is passed over for one further up that has them.
    expect(found(dir, "k")).toBe("node_modules/k/index.d.ts");
  });
});

test("each miss says where it looked", () => {
  project({
    "node_modules/l/index.js": "",
    "node_modules/m/package.json": json({ types: "gone.d.ts" }),
    "node_modules/n/package.json": "{ not json",
  }, (dir) => {
    expect(found(dir, "none")).toBe(`missing: can't find the package 'none': no 'node_modules/none' in '${join(dir, "src")}' or any directory above it; install it with npm`);
    expect(found(dir, "l")).toBe("missing: 'l' has no TypeScript declarations: its package.json gives no 'types', and it has no index.d.ts, and there is no '@types/l'; Fish types a package from its declarations");
    expect(found(dir, "m")).toContain("'m' names 'gone.d.ts' as its 'types', which isn't there");
    expect(found(dir, "n")).toContain("'n' has a package.json that isn't JSON");
  });
});

const DECLARATIONS = `export declare function camelCase(s: string): string;
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

test("a declaration file's exports, through its re-exports", () => {
  project({
    "node_modules/p/index.d.ts": DECLARATIONS,
    "node_modules/p/more.d.ts": "export declare function fromMore(): void;\nexport default 1;\n",
  }, (dir) => {
    const read = exportsOf(join(dir, "node_modules/p/index.d.ts"));
    if (typeof read === "string") throw new Error(read);
    const exports = read.names;
    expect([...exports.keys()].sort()).toEqual(["Box", "Kind", "Mode", "OTHER", "Options", "VERSION", "camelCase", "default", "fromMore", "ns", "plain", "renamed", "shown"]);
    const at = (name: string) => {
      const d = exports.get(name)!;
      return `${relative(dir, d.file)}:${d.src.slice(0, d.at.start).split("\n").length}`;
    };
    expect([at("shown"), at("fromMore"), at("renamed"), at("default")]).toEqual(["node_modules/p/index.d.ts:8", "node_modules/p/more.d.ts:1", "node_modules/p/more.d.ts:1", "node_modules/p/index.d.ts:1"]);
  });
});

test("export = a namespace, and a types package's declare module", () => {
  project({
    "node_modules/q/index.d.ts": "declare function q(n: number): string;\ndeclare namespace q {\n  function chunk<T>(xs: T[], n: number): T[][];\n  const version: string;\n}\nexport = q;\n",
    "node_modules/@types/r/index.d.ts": "declare module \"r\" {\n  export function run(): void;\n}\ndeclare module \"r/other\" {\n  export const x: number;\n}\n",
    "node_modules/r/index.js": "",
  }, (dir) => {
    const q = exportsOf(join(dir, "node_modules/q/index.d.ts"));
    expect(typeof q === "string" ? q : [...q.names.keys()].sort()).toEqual(["chunk", "default", "version"]);
    const t = findTypings(join(dir, "main.fsh"), "r");
    const r = "file" in t ? exportsOf(t.file, "r") : t.missing;
    expect(typeof r === "string" ? r : [...r.names.keys()]).toEqual(["run"]);
  });
});

test("an import from a package that doesn't have the name is refused saying what it exports", () => {
  project({
    "node_modules/p/index.d.ts": DECLARATIONS,
    "node_modules/p/more.d.ts": "export declare function fromMore(): void;\n",
    "b.fsh": "import { nope } from \"p\";\nfunction main() {}\n",
    "c.fsh": "import { x } from \"absent\";\nfunction main() {}\n",
  }, (dir) => {
    const error = (file: string) => {
      try {
        load(join(dir, file));
      } catch (e) {
        return (e as Error).message;
      }
      return "loaded";
    };
    expect(error("b.fsh")).toBe("'p' has no export 'nope'; its declarations in 'node_modules/p/index.d.ts' export 'Box', 'Kind', 'Mode', 'OTHER', 'Options', 'VERSION', 'camelCase', 'default', 'fromMore', 'ns', 'plain', 'renamed', and 1 more");
    expect(error("c.fsh")).toStartWith("can't find the package 'absent'");
  });
});

test("a relative entry path searches from its directory up", () => {
  project({ "node_modules/p/index.d.ts": "", "src/main.fsh": "" }, (dir) => {
    const cwd = process.cwd();
    process.chdir(join(dir, "src"));
    try {
      const t = findTypings("main.fsh", "p");
      expect("file" in t ? relative(dir, t.file) : t.missing).toBe("node_modules/p/index.d.ts");
    } finally {
      process.chdir(cwd);
    }
  });
});

test("conditions and arrays fall through to one with a declaration, and null ends the search", () => {
  project({
    "node_modules/a/package.json": json({ exports: { ".": { import: "./esm/index.mjs", require: "./index.js", default: "./index.js" } } }),
    "node_modules/a/index.d.ts": "",
    "node_modules/b/package.json": json({ exports: { types: "./missing.d.ts", default: "./b.js" } }),
    "node_modules/b/b.d.ts": "",
    "node_modules/c/package.json": json({ exports: { ".": ["./nope.js", "./c.js"] } }),
    "node_modules/c/c.d.ts": "",
    "node_modules/d/package.json": json({ exports: { types: null, default: "./d.js" } }),
    "node_modules/d/d.d.ts": "",
    "node_modules/e/package.json": json({ exports: { "./*": "./one/*.js", "./*.js": "./two/*.js", "./x": "dist/x.js", "./y": "./../y.js", "./z": "./z" } }),
    "node_modules/e/two/f.d.ts": "",
    "node_modules/e/dist/x.d.ts": "",
    "node_modules/e/z.d.ts": "",
  }, (dir) => {
    expect(found(dir, "a")).toBe("node_modules/a/index.d.ts");
    expect(found(dir, "b")).toBe("node_modules/b/b.d.ts");
    expect(found(dir, "c")).toBe("node_modules/c/c.d.ts");
    expect(found(dir, "d")).toContain("doesn't export '.'");
    // The longer pattern wins a tie; a target must be written from './', stay inside, and name a file.
    expect(found(dir, "e/f.js")).toBe("node_modules/e/two/f.d.ts");
    for (const sub of ["x", "y", "z"]) expect(found(dir, `e/${sub}`)).toContain(`exports './${sub}', but none of what it maps it to has a declaration file`);
  });
});

test("a symlinked package resolves to its real path, and its own dependencies beside it", () => {
  project({
    "node_modules/.pnpm/a@1/node_modules/a/index.d.ts": "export * from 'dep';\n",
    "node_modules/.pnpm/a@1/node_modules/dep/index.d.ts": "export declare const fromDep: number;\n",
  }, (dir) => {
    symlinkSync(join(dir, "node_modules/.pnpm/a@1/node_modules/a"), join(dir, "node_modules/a"));
    const t = findTypings(join(dir, "src/main.fsh"), "a");
    if (!("file" in t)) throw new Error(t.missing);
    expect(relative(dir, t.file)).toBe("node_modules/.pnpm/a@1/node_modules/a/index.d.ts");
    const e = exportsOf(t.file, "a");
    expect(typeof e === "string" ? e : [...e.names.keys()]).toEqual(["fromDep"]);
  });
});

test("a subpath directory's own package.json, and package.json shapes that aren't one", () => {
  project({
    "node_modules/a/ops/package.json": json({ types: "../dist/ops.d.ts" }),
    "node_modules/a/dist/ops.d.ts": "",
    "node_modules/n/package.json": "null",
  }, (dir) => {
    expect(found(dir, "a/ops")).toBe("node_modules/a/dist/ops.d.ts");
    expect(found(dir, "n")).toContain("'n' has a package.json that isn't an object");
  });
});

// The names a declaration file's index exports, after writing the files.
function names(files: Record<string, string>, spec = "a"): string[] | string {
  let out: string[] | string = "";
  project(files, (dir) => {
    const t = findTypings(join(dir, "src/main.fsh"), spec);
    if (!("file" in t)) return void (out = t.missing);
    const e = exportsOf(t.file, spec);
    out = typeof e === "string" ? e : [...e.names.keys()].sort();
  });
  return out;
}

test("names imported and exported again, implicit exports, and cycles", () => {
  expect(names({
    "node_modules/a/index.d.ts": "import { A } from './x';\nimport * as ns from './x';\nimport D from './x';\nexport { A, ns, D };\nexport import z = require('./x');\n",
    "node_modules/a/x.d.ts": "export declare const A: number;\nexport default 1;\n",
  })).toEqual(["A", "D", "ns", "z"]);
  expect(names({ "node_modules/a/index.d.ts": "import { Y } from './y';\ndeclare const a: number;\nexport declare const b: Y;\n", "node_modules/a/y.d.ts": "export type Y = number;\n" })).toEqual(["a", "b"]);
  expect(names({ "node_modules/@types/r/index.d.ts": "declare module 'r' { function run(): void; const v: number; interface I {} }\n", "node_modules/r/index.js": "" }, "r")).toEqual(["I", "run", "v"]);
  expect(names({
    "node_modules/a/index.d.ts": "export * from './a';\nexport { a as viaB } from './b';\n",
    "node_modules/a/a.d.ts": "export * from './b';\nexport declare const a: number;\n",
    "node_modules/a/b.d.ts": "export * from './a';\nexport declare const b: number;\n",
  })).toEqual(["a", "b", "viaB"]);
});

test("export = an imported module, an object's members, and a namespace's own exports", () => {
  expect(names({ "node_modules/a/index.d.ts": "import X = require('./x');\nexport = X;\n", "node_modules/a/x.d.ts": "export declare const A: number;\n" })).toEqual(["A", "default"]);
  expect(names({ "node_modules/a/index.d.ts": "declare const o: { p: number; m(): void };\nexport = o;\n" })).toEqual(["default", "m", "p"]);
  expect(names({ "node_modules/a/index.d.ts": "declare namespace q { export { y }; const x: number; }\ndeclare const y: number;\nexport = q;\n" })).toEqual(["default", "y"]);
});

test("a Node built-in Fish lacks is named as one, and a re-export that can't be read is said", () => {
  project({
    "a.fsh": "import { createHash } from \"node:crypto\";\nfunction main() {}\n",
    "b.fsh": "import { x } from \"p\";\nfunction main() {}\n",
    "node_modules/p/index.d.ts": "export * from 'gone';\nexport * from './missing';\n",
  }, (dir) => {
    const error = (file: string) => {
      try {
        load(join(dir, file));
      } catch (e) {
        return (e as Error).message;
      }
      return "loaded";
    };
    expect(error("a.fsh")).toBe("'node:crypto' is a Node module Fish's std doesn't have yet");
    expect(error("b.fsh")).toStartWith("'p' has no export 'x'; its declarations in 'node_modules/p/index.d.ts' export nothing; re-exporting from 'gone' failed: can't find the package 'gone'");
  });
});

test("a declaration file of globals isn't a module, and a cycle of re-exports stays quick", () => {
  expect(names({ "node_modules/g/index.d.ts": "declare function $(s: string): void;\ndeclare const jq: number;\n" }, "g")).toEndWith("index.d.ts' declares globals, not a module");
  // Each file re-exports the next two, round a ring of 30.
  const ring: Record<string, string> = { "node_modules/a/index.d.ts": "export * from './f0';\n" };
  for (let i = 0; i < 30; i++) ring[`node_modules/a/f${i}.d.ts`] = `export * from './f${(i + 1) % 30}';\nexport * from './f${(i + 2) % 30}';\nexport declare const v${i}: number;\n`;
  const started = performance.now();
  expect((names(ring) as string[]).length).toBe(30);
  expect(performance.now() - started).toBeLessThan(2000);
});

test("a subpath's file comes before its directory, whose package.json exports don't count", () => {
  project({
    "node_modules/a/ops.d.ts": "",
    "node_modules/a/ops/package.json": json({ types: "other.d.ts" }),
    "node_modules/a/ops/other.d.ts": "",
    "node_modules/b/ops/package.json": json({ exports: "./e.js" }),
    "node_modules/b/ops/e.d.ts": "",
    "node_modules/b/ops/index.d.ts": "",
    "node_modules/c/ops/package.json": "{ not json",
    "node_modules/c/ops/index.d.ts": "",
    "node_modules/d/package.json": json({ exports: { ".": [null, "./d.js"] } }),
    "node_modules/d/d.d.ts": "",
  }, (dir) => {
    expect(found(dir, "a/ops")).toBe("node_modules/a/ops.d.ts");
    expect(found(dir, "b/ops")).toBe("node_modules/b/ops/index.d.ts");
    expect(found(dir, "c/ops")).toBe("node_modules/c/ops/index.d.ts");
    expect(found(dir, "d")).toContain("doesn't export '.'");
  });
});
