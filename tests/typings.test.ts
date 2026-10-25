import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { load } from "../src/modules.ts";
import { exportsOf, findTypings } from "../src/typings.ts";

// A project directory holding these files, removed after `run`.
function project(files: Record<string, string>, run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "fish-typings-"));
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

test("types, typings, main and index.d.ts, in that order", () => {
  project({
    "node_modules/a/package.json": json({ types: "lib/a.d.ts", typings: "no.d.ts" }),
    "node_modules/a/lib/a.d.ts": "",
    "node_modules/b/package.json": json({ typings: "b.d.ts" }),
    "node_modules/b/b.d.ts": "",
    "node_modules/c/package.json": json({ main: "dist/c.js" }),
    "node_modules/c/dist/c.d.ts": "",
    "node_modules/d/index.d.ts": "",
  }, (dir) => {
    expect(found(dir, "a")).toBe("node_modules/a/lib/a.d.ts");
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
    const exports = exportsOf(join(dir, "node_modules/p/index.d.ts"));
    if (typeof exports === "string") throw new Error(exports);
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
    expect(q instanceof Map ? [...q.keys()].sort() : q).toEqual(["chunk", "default", "version"]);
    const t = findTypings(join(dir, "main.fsh"), "r");
    const r = "file" in t ? exportsOf(t.file, "r") : t.missing;
    expect(r instanceof Map ? [...r.keys()] : r).toEqual(["run"]);
  });
});

test("an import from a package is refused naming where its name is declared, or what it exports", () => {
  project({
    "node_modules/p/index.d.ts": DECLARATIONS,
    "node_modules/p/more.d.ts": "export declare function fromMore(): void;\n",
    "a.fsh": "import { camelCase } from \"p\";\nfunction main() {}\n",
    "b.fsh": "import { nope } from \"p\";\nfunction main() {}\n",
    "c.fsh": "import { x } from \"absent\";\nfunction main() {}\n",
    "d.fsh": "import p from \"p\";\nfunction main() {}\n",
  }, (dir) => {
    const error = (file: string) => {
      try {
        load(join(dir, file));
      } catch (e) {
        return (e as Error).message;
      }
      return "loaded";
    };
    expect(error("a.fsh")).toBe("'camelCase' from 'p' is declared at node_modules/p/index.d.ts:1:1, but using npm packages isn't supported yet");
    expect(error("b.fsh")).toBe("'p' has no export 'nope'; its declarations in 'node_modules/p/index.d.ts' export 'Box', 'Kind', 'Mode', 'OTHER', 'Options', 'VERSION', 'camelCase', 'default', 'fromMore', 'ns', 'plain', 'renamed', and 1 more");
    expect(error("c.fsh")).toStartWith("can't find the package 'absent'");
    expect(error("d.fsh")).toBe("the default export of 'p' is declared at node_modules/p/index.d.ts:1:1, but using npm packages isn't supported yet");
  });
});
