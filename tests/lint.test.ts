import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  expect(lint(pkg, "--fixes").code).toBe(2);
  expect(lint(pkg, "--release").code).toBe(2);
  expect(lint(pkg, "--panic=abort")).toEqual({ code: 2, out: "", err: "usage: fishc lint [<path>...] [--fix]\n" });
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

const PORTED = `var total = 0;
const name = "a";
const same = name == "b";
const loose = a == b;
const user = JSON.parse(text) as User;
const twice = function (n: number): number {
  return n * 2;
};
function show(p: Point) {
  return p.x;
}
delete user.age;
`;

test("the auto rules are reported with the change each would make", () => {
  const pkg = dir("auto-report", { "fish.toml": COMPAT, "src/main.fsh": PORTED });
  const { code, out } = lint(pkg);
  expect(code).toBe(1);
  expect(out.split("\n").filter((l) => /^src\//.test(l))).toEqual([
    "src/main.fsh:1:1: auto A1: 'var' becomes 'const', as nothing assigns it again",
    "src/main.fsh:3:14: auto A3: '==' becomes '===', as both sides are strings",
    "src/main.fsh:4:15: guided A3: '==' converts between types, which Fish doesn't; compare with '===' once both sides have the same type",
    "src/main.fsh:5:14: auto A8: 'JSON.parse(s) as T' becomes 'JSON.parse<T>(s)', which checks the value as it parses it",
    "src/main.fsh:6:15: auto A9: the function expression becomes an arrow function, as it doesn't use its own 'this'",
    "src/main.fsh:9:18: auto A5: 'p' is only read here, so it is borrowed as 'Ref<Point>'; the marker asks you to confirm it",
    `src/main.fsh:12:1: reject R3: ${REJECTS.R3}`,
  ]);
  expect(out).toContain(" 1 | var total = 0;\n   | ^^^\n");
  expect(out).toEndWith("7 to change in 1 file\n");
});

test("--fix writes every fix, keeps the rest as written, and reports what is left", () => {
  const pkg = dir("auto-fix", { "fish.toml": COMPAT, "src/main.fsh": PORTED });
  const { code, out } = lint(pkg, "--fix");
  expect(readFileSync(join(pkg, "src/main.fsh"), "utf8")).toBe(`const total = 0;
const name = "a";
const same = name === "b";
const loose = a == b;
const user = JSON.parse<User>(text);
const twice = (n: number): number => {
  return n * 2;
};
function show(p: Ref<Point> /* fish: review */) {
  return p.x;
}
delete user.age;
`);
  expect(code).toBe(1);
  expect(out.split("\n").filter((l) => /^(src|fixed)/.test(l))).toEqual([
    "fixed 5 in src/main.fsh",
    "src/main.fsh:4:15: guided A3: '==' converts between types, which Fish doesn't; compare with '===' once both sides have the same type",
    "src/main.fsh:9:29: guided A5: an ownership type the lint inserted: check it, then remove the marker",
    `src/main.fsh:12:1: reject R3: ${REJECTS.R3}`,
  ]);
  expect(out).toEndWith("3 to change in 1 file\n");
});

test("fixes that overlap are settled over rounds", () => {
  const file = join(dir("rounds", { "x.fsh": "// @fish-edition ts-compat\nlet a: Array<string | null> | null;\nconst b = JSON.parse(c == 1 ? d : e) as T;\nconst f = 1 == 2;\n" }), "x.fsh");
  const { code, out } = lint(join(root, "rounds"), "x.fsh", "--fix");
  expect(readFileSync(file, "utf8")).toBe("// @fish-edition ts-compat\nlet a: Option<Array<Option<string>>>;\nconst b = JSON.parse<T>(c == 1 ? d : e);\nconst f = 1 === 2;\n");
  expect(out.split("\n")[0]).toBe("fixed 4 in x.fsh");
  expect(code).toBe(1);
});

test("a named .ts file is renamed to .fsh under --fix, and refused when the .fsh exists", () => {
  const at = dir("typescript", { "util.ts": 'import { a } from "./a.ts";\nimport { b } from "./b.ts";\nvar n = 1;\n', "a.fsh": "export const a = 1;\n", "clash.ts": "var n = 1;\n", "clash.fsh": "kept\n" });
  const plain = lint(at, "util.ts");
  expect(plain.out.split("\n")[0]).toBe("util.ts:1:1: auto A10: the file becomes 'util.fsh', its Fish name; 'fishc lint --fix' renames it");
  const fixed = lint(at, "util.ts", "--fix");
  expect(fixed).toEqual({ code: 0, out: "fixed 2 in util.ts\nrenamed util.ts to util.fsh\n0 to change in 0 files\n", err: "" });
  expect(existsSync(join(at, "util.ts"))).toBe(false);
  // An import whose .fsh file isn't there, and isn't being made, keeps its name.
  expect(readFileSync(join(at, "util.fsh"), "utf8")).toBe('import { a } from "./a.fsh";\nimport { b } from "./b.ts";\nconst n = 1;\n');
  const refused = lint(at, "clash.ts", "--fix");
  expect(refused.code).toBe(1);
  expect(refused.err).toBe("fishc lint: 'clash.ts' isn't fixed, since 'clash.fsh', its Fish name, already exists\n");
  expect(readFileSync(join(at, "clash.ts"), "utf8")).toBe("var n = 1;\n");
  expect(readFileSync(join(at, "clash.fsh"), "utf8")).toBe("kept\n");
});

test("--fix leaves a file with nothing to fix, and one that doesn't parse, untouched", () => {
  const pkg = dir("untouched", { "fish.toml": COMPAT, "src/clean.fsh": "export function g(): i64 {\n  return 1;\n}\n", "src/broken.fsh": "var a = ;\n" });
  const before = statSync(join(pkg, "src/clean.fsh"));
  const { code, out, err } = lint(pkg, "--fix");
  const after = statSync(join(pkg, "src/clean.fsh"));
  expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
  expect(readFileSync(join(pkg, "src/broken.fsh"), "utf8")).toBe("var a = ;\n");
  expect(err).toBe("src/broken.fsh:1:9: error: expected an expression, found ';'\n 1 | var a = ;\n   |         ^\n");
  expect(out).toBe("0 to change in 0 files\n");
  expect(code).toBe(1);
});

test("a named .d.ts file isn't linted or renamed", () => {
  const at = dir("declarations", { "types.d.ts": "declare var x: number;\n" });
  expect(lint(at, "types.d.ts", "--fix")).toEqual({ code: 0, out: "fishc lint: 'types.d.ts' is a declaration file, which describes JavaScript rather than holding code to port, so it isn't linted\n0 to change in 0 files\n", err: "" });
  expect(readFileSync(join(at, "types.d.ts"), "utf8")).toBe("declare var x: number;\n");
  expect(existsSync(join(at, "types.d.fsh"))).toBe(false);
});

test("an import of a .ts file renamed in the same run becomes .fsh", () => {
  const at = dir("together", { "a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n', "b.ts": "export const b = 1;\n" });
  const { code } = lint(at, "a.ts", "b.ts", "--fix");
  expect(code).toBe(0);
  expect(readFileSync(join(at, "a.fsh"), "utf8")).toBe('import { b } from "./b.fsh";\nexport const a = b;\n');
  expect(existsSync(join(at, "b.fsh"))).toBe(true);
});

test("an import is renamed only to a .ts file whose rename is settled, and both names there is left to you", () => {
  const broken = dir("settled-broken", { "a.ts": 'import { b } from "./b.ts";\nconsole.log(b);\n', "b.ts": "export const b = = 1;\n" });
  expect(lint(broken, "a.ts", "b.ts", "--fix").code).toBe(1);
  expect(readFileSync(join(broken, "a.fsh"), "utf8")).toBe('import { b } from "./b.ts";\nconsole.log(b);\n');
  expect(readFileSync(join(broken, "b.ts"), "utf8")).toBe("export const b = = 1;\n");
  const both = dir("settled-both", { "a.ts": 'import { b } from "./b.ts";\nconsole.log(b);\n', "b.ts": "export const b = 1;\n", "b.fsh": "export const x = 1;\n" });
  const { code, out, err } = lint(both, "a.ts", "b.ts", "--fix");
  expect(code).toBe(1);
  expect(err).toBe("fishc lint: 'b.ts' isn't fixed, since 'b.fsh', its Fish name, already exists\n");
  expect(readFileSync(join(both, "a.fsh"), "utf8")).toBe('import { b } from "./b.ts";\nconsole.log(b);\n');
  expect(out).toContain("a.fsh:1:19: guided A10: both './b.ts' and './b.fsh' are there, so which this imports is yours to choose\n");
});

test("a settled rename that fails when written says which files already import its new name", () => {
  const at = dir("settled-fails", { "a.ts": 'import { b } from "./b.ts";\nconsole.log(b);\n', "b.ts": "export const b = 1;\n" });
  chmodSync(join(at, "b.ts"), 0o444);
  const { code, err } = lint(at, "a.ts", "b.ts", "--fix");
  chmodSync(join(at, "b.ts"), 0o644);
  expect(code).toBe(1);
  expect(readFileSync(join(at, "a.fsh"), "utf8")).toBe('import { b } from "./b.fsh";\nconsole.log(b);\n');
  expect(err).toMatch(/^fishc lint: can't write 'b\.ts': .*; 'a\.fsh' already imports its '\.fsh' name, which isn't there\n$/);
});
