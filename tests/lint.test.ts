import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REJECTS } from "../src/migrate.ts";

const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const root = realpathSync(mkdtempSync(join(tmpdir(), "fish-lint-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// Runs `fishc lint` with `args` in the directory `cwd`.
function lint(cwd: string, ...args: string[]) {
  const run = Bun.spawnSync(["bun", MAIN, "lint", ...args], { cwd });
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
}

// A directory under the test's root holding `files`.
function dir(name: string, files: Record<string, string>): string {
  const at = join(root, name);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(at, path, ".."), { recursive: true });
    writeFileSync(join(at, path), text);
  }
  return at;
}

const COMPAT = '[package]\nname = "ported"\nversion = "0.1.0"\nedition = "ts-compat"\n';

test("a TS-compat package's hits are reported in file and position order, then counted", () => {
  const pkg = dir("ported", {
    "fish.toml": COMPAT,
    "src/main.fsh": 'function f() {\n  delete o.k;\n  return arguments[0];\n}\nconst x = eval("1");\n',
    "src/a.fsh": "interface I { a: number }\ninterface I { b: number }\n",
    "src/clean.fsh": "export function g(): i64 {\n  return 1;\n}\n",
  });
  expect(lint(pkg)).toEqual({
    code: 1,
    out: [
      `src/a.fsh:2:1: reject R7: ${REJECTS.R7}`, " 2 | interface I { b: number }", "   | ^^^^^^^^^^^^^^^^^^^^^^^^^",
      `src/main.fsh:2:3: reject R3: ${REJECTS.R3}`, " 2 |   delete o.k;", "   |   ^^^^^^^^^^",
      `src/main.fsh:3:10: reject R5: ${REJECTS.R5}`, " 3 |   return arguments[0];", "   |          ^^^^^^^^^",
      `src/main.fsh:5:11: reject R1: ${REJECTS.R1}`, ' 5 | const x = eval("1");', "   |           ^^^^",
      "4 to change in 2 files", "",
    ].join("\n"),
    err: "",
  });
});

test("a clean TS-compat file exits 0, and a native one named is said to have nothing to lint", () => {
  const files = dir("clean", { "done.fsh": "// @fish-edition ts-compat\nconst n = 1;\n", "native.fsh": "const s = Symbol();\n" });
  expect(lint(files, "done.fsh")).toEqual({ code: 0, out: "0 to change in 0 files\n", err: "" });
  expect(lint(files, "native.fsh")).toEqual({ code: 0, out: "fishc lint: 'native.fsh' is in the native edition, so there's nothing to lint\n0 to change in 0 files\n", err: "" });
});

test("directories and the package are searched as fishc fmt searches them, skipping native files found there", () => {
  const pkg = dir("searched", {
    "fish.toml": COMPAT,
    "src/deep/one.fsh": 'eval("1");\n',
    "src/native.fsh": "// @fish-edition native\nconst s = Symbol();\n",
    "target/out.fsh": 'eval("2");\n',
    "node_modules/dep/x.fsh": 'eval("3");\n',
    ".hidden/x.fsh": 'eval("4");\n',
    "nested/fish.toml": COMPAT.replace("ported", "nested"),
    "nested/src/x.fsh": 'eval("5");\n',
  });
  // With no paths, the package around the working directory, from wherever in it.
  const all = lint(join(pkg, "src", "deep"));
  expect(all.code).toBe(1);
  expect(all.out.split("\n").filter((l) => l.includes("reject"))).toEqual([`one.fsh:1:1: reject R1: ${REJECTS.R1}`]);
  expect(all.out).toEndWith("1 to change in 1 file\n");
  const named = lint(root, "searched/src");
  expect(named.out.split("\n").filter((l) => l.includes("reject"))).toEqual([`searched/src/deep/one.fsh:1:1: reject R1: ${REJECTS.R1}`]);
});

test("a file that doesn't parse is reported as a build reports it, and the rest are still linted", () => {
  const pkg = dir("unparsed", { "fish.toml": COMPAT, "src/a.fsh": "const = ;\n", "src/b.fsh": "delete o.k;\n" });
  const { code, out, err } = lint(pkg);
  expect(code).toBe(1);
  expect(err).toBe("src/a.fsh:1:7: error: expected an identifier, found '='\n 1 | const = ;\n   |       ^\n");
  expect(out).toBe(`src/b.fsh:1:1: reject R3: ${REJECTS.R3}\n 1 | delete o.k;\n   | ^^^^^^^^^^\n1 to change in 1 file\n`);
});

test("unknown flags, a missing path and no package are refused", () => {
  const pkg = dir("flags", { "fish.toml": COMPAT, "src/a.fsh": "const n = 1;\n" });
  expect(lint(pkg, "--fix").code).toBe(2);
  expect(lint(pkg, "--release").code).toBe(2);
  expect(lint(pkg, "--panic=abort")).toEqual({ code: 2, out: "", err: "usage: fishc lint [<path>...]\n" });
  const missing = lint(pkg, "nope.fsh");
  expect(missing.code).toBe(1);
  expect(missing.err).toBe("fishc lint: can't find 'nope.fsh'\n");
  const loose = dir("loose", { "x.txt": "" });
  expect(lint(loose).code).toBe(2);
});

test("a broken manifest is reported once, and its package's files are skipped", () => {
  const pkg = dir("broken-manifest", { "fish.toml": '[package]\nname = "a"\nversion = "1.0.0"\nedition = "ts"\n', "src/a.fsh": 'eval("1");\n', "src/b.fsh": 'eval("2");\n' });
  const { code, out, err } = lint(pkg);
  expect(code).toBe(1);
  expect(err).toBe(`fish.toml:4:11: error: 'ts' isn't an edition; it is "native", the default, or "ts-compat" for TypeScript not yet migrated\n 4 | edition = "ts"\n   |           ^^^^\n`);
  expect(out).toBe("0 to change in 0 files\n");
});
