import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompileError, formatError } from "../src/diag.ts";
import { build } from "../src/main.ts";
import { parse } from "../src/parser.ts";

// Each program in tests/programs states its expectations in comments:
//   // expect: <line>   the next line of stdout, in order
//   // error: <text>    compilation must fail with a message containing <text>
//   // panic: <text>    the program must exit with 101 and stderr containing <text>
//   // fails: <text>    the program must exit with 1, an error escaping main, and stderr
//                       containing <text>
//   // mode: release    build with --release
//   // mode: abort      build with --panic=abort: a panic aborts (SIGABRT) instead of exiting 101
//   // mode: parse      only parse; passing means it parsed
//   // link: <name>     link the C library <name>, as `--link <name>` does
// A program spanning several files is a directory holding `main.fsh`, whose comments say what
// to expect, and the files it imports.
const dir = join(import.meta.dir, "programs");
const tmp = mkdtempSync(join(tmpdir(), "fishc-"));

// A server program may take 30 seconds, since some wait on real time, like closing an idle
// connection; the rest keep bun's default, so a hang shows up quickly.
const programs = readdirSync(dir).filter((f) => f.endsWith(".fsh") || existsSync(join(dir, f, "main.fsh")));
for (const name of programs) {
  test(name, () => {
    const file = name.endsWith(".fsh") ? join(dir, name) : join(dir, name, "main.fsh");
    const src = readFileSync(file, "utf8");
    const expected = [...src.matchAll(/\/\/ expect: (.*)/g)].map((m) => m[1] + "\n").join("");
    const errors = [...src.matchAll(/\/\/ error: (.*)/g)].map((m) => m[1]!);
    const panics = [...src.matchAll(/\/\/ panic: (.*)/g)].map((m) => m[1]!);
    const failures = [...src.matchAll(/\/\/ fails: (.*)/g)].map((m) => m[1]!);
    const out = join(tmp, name.replace(/\.fsh$/, ""));
    const parseOnly = src.includes("// mode: parse");
    const links = [...src.matchAll(/\/\/ link: (\S+)/g)].map((m) => m[1]!);

    try {
      if (parseOnly) parse(src);
      else build(file, out, src.includes("// mode: release"), src.includes("// mode: abort") ? "abort" : "unwind", links);
    } catch (e) {
      if (!(e instanceof CompileError) || errors.length === 0) throw e;
      const message = formatError(e, name, src);
      for (const error of errors) expect(message).toContain(error);
      return;
    }
    expect(errors).toEqual([]);
    if (parseOnly) return;

    // Every program is checked for leaks: the runtime reports what is still allocated at exit.
    const run = Bun.spawnSync([out], { env: { ...process.env, FISH_LEAKS: "1" } });
    expect(run.stdout.toString()).toBe(expected);
    for (const text of [...panics, ...failures]) expect(run.stderr.toString()).toContain(text);
    // A panic that unwinds drops everything on the way out, so it leaks nothing either.
    if (!src.includes("// mode: abort")) expect(run.stderr.toString()).not.toContain("fish: leaked");
    if (panics.length > 0 && src.includes("// mode: abort")) expect(run.signalCode).toBe("SIGABRT");
    else expect(run.exitCode).toBe(panics.length > 0 ? 101 : failures.length > 0 ? 1 : 0);
  }, name.startsWith("http_") ? 30000 : undefined);
}
