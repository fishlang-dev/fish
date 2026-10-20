import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompileError, formatError } from "../src/diag.ts";
import { build } from "../src/main.ts";
import { parse } from "../src/parser.ts";

// Each program in tests/programs states its expectations in comments:
//   // expect: <line>   the next line of stdout, in order
//   // error: <text>    compilation must fail with a message containing <text>
//   // panic: <text>    the program must exit with 101 and stderr containing <text>
//   // mode: release    build with --release
//   // mode: parse      only parse; passing means it parsed
const dir = join(import.meta.dir, "programs");
const tmp = mkdtempSync(join(tmpdir(), "fishc-"));

for (const name of readdirSync(dir).filter((f) => f.endsWith(".fsh"))) {
  test(name, () => {
    const file = join(dir, name);
    const src = readFileSync(file, "utf8");
    const expected = [...src.matchAll(/\/\/ expect: (.*)/g)].map((m) => m[1] + "\n").join("");
    const errors = [...src.matchAll(/\/\/ error: (.*)/g)].map((m) => m[1]!);
    const panics = [...src.matchAll(/\/\/ panic: (.*)/g)].map((m) => m[1]!);
    const out = join(tmp, name.replace(/\.fsh$/, ""));
    const parseOnly = src.includes("// mode: parse");

    try {
      if (parseOnly) parse(src);
      else build(file, out, src.includes("// mode: release"));
    } catch (e) {
      if (!(e instanceof CompileError) || errors.length === 0) throw e;
      const message = formatError(e, name, src);
      for (const error of errors) expect(message).toContain(error);
      return;
    }
    expect(errors).toEqual([]);
    if (parseOnly) return;

    const run = Bun.spawnSync([out]);
    expect(run.stdout.toString()).toBe(expected);
    for (const panic of panics) expect(run.stderr.toString()).toContain(panic);
    expect(run.exitCode).toBe(panics.length > 0 ? 101 : 0);
  });
}
