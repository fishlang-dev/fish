import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { formatError } from "../src/diag.ts";
import { build } from "../src/main.ts";

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
`,
  "node_modules/esm/dist/helper.js": "export function helper(s) { return s.toUpperCase(); }\n",
  "node_modules/esm/index.d.ts": `export declare const VERSION: string;
export declare const COUNT: number;
export declare const ON: boolean;
export declare const WRONG: string;
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
function run(main: string): { stdout: string; stderr: string; exitCode: number | null } | string {
  const dir = join(root, `p${made++}`);
  for (const [path, text] of Object.entries({ ...PACKAGES, "main.fsh": main })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
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
