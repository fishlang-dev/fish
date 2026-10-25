import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { findTypings } from "../src/typings.ts";

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
