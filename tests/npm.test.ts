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

test("importing what isn't a function is refused for now", () => {
  expect(stops({
    "node_modules/case/index.d.ts": CASE,
    "main.fsh": "import { Options } from \"case\";\nfunction main() {}\n",
  })).toContain("'Options' from 'case' is an interface, and only functions of a package can be imported so far");
});
