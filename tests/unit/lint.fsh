// Runs `fishc lint` as the native fishc. Each test makes its own
// directory and removes it at its end.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { REJECTS } from "../../src/migrate.fsh";
import { fishc, ran, read, same, type Ran } from "./support.fsh";

// A fresh directory for one test, by its real path.
function fresh(): string {
  try {
    return realpathSync(mkdtempSync(join(tmpdir(), "fish-lint-")));
  } catch (e) {
    assert(false, `can't make a directory: ${e.message}`);
    return "";
  }
}

function done(top: string): void {
  try {
    rmSync(top, { recursive: true, force: true });
  } catch (_e) {}
}

// Runs `fishc lint` with `args` in the directory `cwd`.
function lint(cwd: string, args: string[]): Ran {
  return fishc(cwd, ["lint", ...args]);
}

// A directory under `top` holding `files`.
function dir(top: string, name: string, files: Ref<[string, string][]>): string {
  const at = join(top, name);
  try {
    for (const [path, text] of files) {
      mkdirSync(dirname(join(at, path)), { recursive: true });
      writeFileSync(join(at, path), text);
    }
  } catch (e) {
    assert(false, `can't write ${name}: ${e.message}`);
  }
  return at;
}

function reject(rule: string): string {
  return REJECTS[rule]!;
}

function guidedG7(): string {
  return "top-level code runs when the module loads, which Fish doesn't do; move it into 'main()', or into a 'Lazy<T>' for a value made once";
}

function compat(): string {
  return '[package]\nname = "ported"\nversion = "0.1.0"\nedition = "ts-compat"\n';
}

// The lines of `out` that `keep` holds to.
function linesOf(out: string, keep: (l: string) => boolean): string {
  return out.split("\n").filter((l) => keep(l)).join("\n");
}

test("a TS-compat package's hits are reported in file and position order, then counted", () => {
  const top = fresh();
  const pkg = dir(top, "ported", [
    ["fish.toml", compat()],
    ["src/main.fsh", 'function f() {\n  delete o.k;\n  return arguments[0];\n}\nconst x = eval("1");\n'],
    ["src/a.fsh", "interface I { a: number }\ninterface I { b: number }\n"],
    ["src/clean.fsh", "export function g(): i64 {\n  return 1;\n}\n"],
  ]);
  const out = [
    `src/a.fsh:2:1: reject R7: ${reject("R7")}`, " 2 | interface I { b: number }", "   | ^^^^^^^^^^^^^^^^^^^^^^^^^",
    `src/main.fsh:2:3: reject R3: ${reject("R3")}`, " 2 |   delete o.k;", "   |   ^^^^^^^^^^",
    `src/main.fsh:3:10: reject R5: ${reject("R5")}`, " 3 |   return arguments[0];", "   |          ^^^^^^^^^",
    `src/main.fsh:5:11: reject R1: ${reject("R1")}`, ' 5 | const x = eval("1");', "   |           ^^^^",
    "4 to change in 2 files", "",
  ].join("\n");
  ran(lint(pkg, []), 1, out, "", "lint");
  done(top);
});

test("a clean TS-compat file exits 0, and a native one named is said to have nothing to lint", () => {
  const top = fresh();
  const files = dir(top, "clean", [["done.fsh", "// @fish-edition ts-compat\nconst n = 1;\n"], ["native.fsh", "const s = Symbol();\n"]]);
  ran(lint(files, ["done.fsh"]), 0, "0 to change in 0 files\n", "", "lint done.fsh");
  ran(lint(files, ["native.fsh"]), 0, "fishc lint: 'native.fsh' is in the native edition, so there's nothing to lint\n0 to change in 0 files\n", "", "lint native.fsh");
  done(top);
});

test("directories and the package are searched as fishc fmt searches them, skipping native files found there", () => {
  const top = fresh();
  const pkg = dir(top, "searched", [
    ["fish.toml", compat()],
    ["src/deep/one.fsh", 'eval("1");\n'],
    ["src/native.fsh", "// @fish-edition native\nconst s = Symbol();\n"],
    ["target/out.fsh", 'eval("2");\n'],
    ["node_modules/dep/x.fsh", 'eval("3");\n'],
    [".hidden/x.fsh", 'eval("4");\n'],
    ["nested/fish.toml", compat().replace("ported", "nested")],
    ["nested/src/x.fsh", 'eval("5");\n'],
  ]);
  // With no paths, the package around the working directory, from wherever in it.
  const all = lint(join(pkg, "src", "deep"), []);
  assert(all.code === 1, `exit code ${all.code}`);
  same(linesOf(all.out, (l) => l.includes("reject")), `one.fsh:1:1: reject R1: ${reject("R1")}`, "the rejects");
  assert(all.out.endsWith("2 to change in 1 file\n"), `stdout: ${all.out}`);
  const named = lint(top, ["searched/src"]);
  same(linesOf(named.out, (l) => l.includes("reject")), `searched/src/deep/one.fsh:1:1: reject R1: ${reject("R1")}`, "the rejects, named");
  done(top);
});

test("a file that doesn't parse is reported as a build reports it, and the rest are still linted", () => {
  const top = fresh();
  const pkg = dir(top, "unparsed", [["fish.toml", compat()], ["src/a.fsh", "const = ;\n"], ["src/b.fsh", "delete o.k;\n"]]);
  ran(
    lint(pkg, []),
    1,
    `src/b.fsh:1:1: reject R3: ${reject("R3")}\n 1 | delete o.k;\n   | ^^^^^^^^^^\nsrc/b.fsh:1:1: guided G7: ${guidedG7()}\n 1 | delete o.k;\n   | ^^^^^^^^^^\n2 to change in 1 file\n`,
    "src/a.fsh:1:7: error[E0001]: expected an identifier, found '='\n 1 | const = ;\n   |       ^\n",
    "lint",
  );
  done(top);
});

test("unknown flags, a missing path and no package are refused", () => {
  const top = fresh();
  const pkg = dir(top, "flags", [["fish.toml", compat()], ["src/a.fsh", "const n = 1;\n"]]);
  for (const flag of ["--fixes", "--release"]) {
    const run = lint(pkg, [flag]);
    assert(run.code === 2, `${flag}: exit code ${run.code}`);
  }
  ran(lint(pkg, ["--panic=abort"]), 2, "", "usage: fishc lint [<path>...] [--fix]\n", "--panic=abort");
  const missing = lint(pkg, ["nope.fsh"]);
  assert(missing.code === 1, `nope.fsh: exit code ${missing.code}`);
  same(missing.err, "fishc lint: can't find 'nope.fsh'\n", "nope.fsh's stderr");
  const loose = dir(top, "loose", [["x.txt", ""]]);
  const outside = lint(loose, []);
  assert(outside.code === 2, `outside a package: exit code ${outside.code}`);
  done(top);
});

test("a broken manifest is reported once, and its package's files are skipped", () => {
  const top = fresh();
  const pkg = dir(top, "broken-manifest", [["fish.toml", '[package]\nname = "a"\nversion = "1.0.0"\nedition = "ts"\n'], ["src/a.fsh", 'eval("1");\n'], ["src/b.fsh", 'eval("2");\n']]);
  ran(lint(pkg, []), 1, "0 to change in 0 files\n", `fish.toml:4:11: error[E0905]: 'ts' isn't an edition; it is "native", the default, "rc" for reference-counted objects, or "ts-compat" for TypeScript not yet migrated\n 4 | edition = "ts"\n   |           ^^^^\n`, "lint");
  done(top);
});

function ported(): string {
  return `var total = 0;
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
}

test("the auto rules are reported with the change each would make", () => {
  const top = fresh();
  const pkg = dir(top, "auto-report", [["fish.toml", compat()], ["src/main.fsh", ported()]]);
  const run = lint(pkg, []);
  assert(run.code === 1, `exit code ${run.code}`);
  same(
    linesOf(run.out, (l) => l.startsWith("src/")),
    [
      "src/main.fsh:1:1: auto A1: 'var' becomes 'const', as nothing assigns it again",
      "src/main.fsh:3:14: auto A3: '==' becomes '===', as both sides are strings",
      "src/main.fsh:4:15: guided A3: '==' converts between types, which Fish doesn't; compare with '===' once both sides have the same type",
      "src/main.fsh:5:14: auto A8: 'JSON.parse(s) as T' becomes 'JSON.parse<T>(s)', which checks the value as it parses it",
      "src/main.fsh:6:15: auto A9: the function expression becomes an arrow function, as it doesn't use its own 'this'",
      "src/main.fsh:9:18: auto A5: 'p' is only read here, so it is borrowed as 'Ref<Point>'; the marker asks you to confirm it",
      `src/main.fsh:12:1: reject R3: ${reject("R3")}`,
      `src/main.fsh:12:1: guided G7: ${guidedG7()}`,
    ].join("\n"),
    "the hits",
  );
  assert(run.out.includes(" 1 | var total = 0;\n   | ^^^\n"), `stdout: ${run.out}`);
  assert(run.out.endsWith("8 to change in 1 file\n"), `stdout: ${run.out}`);
  done(top);
});

test("--fix writes every fix, keeps the rest as written, and reports what is left", () => {
  const top = fresh();
  const pkg = dir(top, "auto-fix", [["fish.toml", compat()], ["src/main.fsh", ported()]]);
  const run = lint(pkg, ["--fix"]);
  same(read(join(pkg, "src/main.fsh")), `const total = 0;
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
`, "the fixed file");
  assert(run.code === 1, `exit code ${run.code}`);
  same(
    linesOf(run.out, (l) => l.startsWith("src") || l.startsWith("fixed")),
    [
      "fixed 5 in src/main.fsh",
      "src/main.fsh:4:15: guided A3: '==' converts between types, which Fish doesn't; compare with '===' once both sides have the same type",
      "src/main.fsh:9:29: guided A5: an ownership type the lint inserted: check it, then remove the marker",
      `src/main.fsh:12:1: reject R3: ${reject("R3")}`,
      `src/main.fsh:12:1: guided G7: ${guidedG7()}`,
    ].join("\n"),
    "what is left",
  );
  assert(run.out.endsWith("4 to change in 1 file\n"), `stdout: ${run.out}`);
  done(top);
});

test("fixes that overlap are settled over rounds", () => {
  const top = fresh();
  const file = join(dir(top, "rounds", [["x.fsh", "// @fish-edition ts-compat\nlet a: Array<string | null> | null;\nconst b = JSON.parse(c == 1 ? d : e) as T;\nconst f = 1 == 2;\n"]]), "x.fsh");
  const run = lint(join(top, "rounds"), ["x.fsh", "--fix"]);
  same(read(file), "// @fish-edition ts-compat\nlet a: Option<Array<Option<string>>>;\nconst b = JSON.parse<T>(c == 1 ? d : e);\nconst f = 1 === 2;\n", "the fixed file");
  same(run.out.split("\n")[0]!, "fixed 4 in x.fsh", "the first line");
  assert(run.code === 1, `exit code ${run.code}`);
  done(top);
});

test("a named .ts file is renamed to .fsh under --fix, and refused when the .fsh exists", () => {
  const top = fresh();
  const at = dir(top, "typescript", [["util.ts", 'import { a } from "./a.ts";\nimport { b } from "./b.ts";\nvar n = 1;\n'], ["a.fsh", "export const a = 1;\n"], ["clash.ts", "var n = 1;\n"], ["clash.fsh", "kept\n"]]);
  const plain = lint(at, ["util.ts"]);
  same(plain.out.split("\n")[0]!, "util.ts:1:1: auto A10: the file becomes 'util.fsh', its Fish name; 'fishc lint --fix' renames it", "the first line");
  ran(lint(at, ["util.ts", "--fix"]), 0, "fixed 2 in util.ts\nrenamed util.ts to util.fsh\n0 to change in 0 files\n", "", "lint util.ts --fix");
  assert(!existsSync(join(at, "util.ts")), "util.ts is still there");
  // An import whose .fsh file isn't there, and isn't being made, keeps its name.
  same(read(join(at, "util.fsh")), 'import { a } from "./a.fsh";\nimport { b } from "./b.ts";\nconst n = 1;\n', "util.fsh");
  const refused = lint(at, ["clash.ts", "--fix"]);
  assert(refused.code === 1, `clash.ts: exit code ${refused.code}`);
  same(refused.err, "fishc lint: 'clash.ts' isn't fixed, since 'clash.fsh', its Fish name, already exists\n", "clash.ts's stderr");
  same(read(join(at, "clash.ts")), "var n = 1;\n", "clash.ts");
  same(read(join(at, "clash.fsh")), "kept\n", "clash.fsh");
  done(top);
});

test("--fix leaves a file with nothing to fix, and one that doesn't parse, untouched", () => {
  const top = fresh();
  try {
    const pkg = dir(top, "untouched", [["fish.toml", compat()], ["src/clean.fsh", "export function g(): i64 {\n  return 1;\n}\n"], ["src/broken.fsh", "var a = ;\n"]]);
    const before = statSync(join(pkg, "src/clean.fsh"));
    const run = lint(pkg, ["--fix"]);
    const after = statSync(join(pkg, "src/clean.fsh"));
    assert(after.ino === before.ino && after.mtimeMs === before.mtimeMs, `clean.fsh changed: inode ${before.ino} then ${after.ino}, mtime ${before.mtimeMs} then ${after.mtimeMs}`);
    same(read(join(pkg, "src/broken.fsh")), "var a = ;\n", "broken.fsh");
    ran(run, 1, "0 to change in 0 files\n", "src/broken.fsh:1:9: error[E0001]: expected an expression, found ';'\n 1 | var a = ;\n   |         ^\n", "lint --fix");
  } catch (e) {
    assert(false, e.message);
  }
  done(top);
});

test("a named .d.ts file isn't linted or renamed", () => {
  const top = fresh();
  const at = dir(top, "declarations", [["types.d.ts", "declare var x: number;\n"]]);
  ran(lint(at, ["types.d.ts", "--fix"]), 0, "fishc lint: 'types.d.ts' is a declaration file, which describes JavaScript rather than holding code to port, so it isn't linted\n0 to change in 0 files\n", "", "lint types.d.ts --fix");
  same(read(join(at, "types.d.ts")), "declare var x: number;\n", "types.d.ts");
  assert(!existsSync(join(at, "types.d.fsh")), "types.d.fsh was made");
  done(top);
});

test("an import of a .ts file renamed in the same run becomes .fsh", () => {
  const top = fresh();
  const at = dir(top, "together", [["a.ts", 'import { b } from "./b.ts";\nexport const a = b;\n'], ["b.ts", "export const b = 1;\n"]]);
  const run = lint(at, ["a.ts", "b.ts", "--fix"]);
  assert(run.code === 0, `exit code ${run.code}: ${run.err}`);
  same(read(join(at, "a.fsh")), 'import { b } from "./b.fsh";\nexport const a = b;\n', "a.fsh");
  assert(existsSync(join(at, "b.fsh")), "b.fsh wasn't made");
  done(top);
});

test("an import is renamed only to a .ts file whose rename is settled, and both names there is left to you", () => {
  const top = fresh();
  const broken = dir(top, "settled-broken", [["a.ts", 'import { b } from "./b.ts";\nconsole.log(b);\n'], ["b.ts", "export const b = = 1;\n"]]);
  const first = lint(broken, ["a.ts", "b.ts", "--fix"]);
  assert(first.code === 1, `exit code ${first.code}`);
  same(read(join(broken, "a.fsh")), 'import { b } from "./b.ts";\nconsole.log(b);\n', "a.fsh");
  same(read(join(broken, "b.ts")), "export const b = = 1;\n", "b.ts");
  const both = dir(top, "settled-both", [["a.ts", 'import { b } from "./b.ts";\nconsole.log(b);\n'], ["b.ts", "export const b = 1;\n"], ["b.fsh", "export const x = 1;\n"]]);
  const run = lint(both, ["a.ts", "b.ts", "--fix"]);
  assert(run.code === 1, `exit code ${run.code}`);
  same(run.err, "fishc lint: 'b.ts' isn't fixed, since 'b.fsh', its Fish name, already exists\n", "stderr");
  same(read(join(both, "a.fsh")), 'import { b } from "./b.ts";\nconsole.log(b);\n', "a.fsh, beside both");
  assert(run.out.includes("a.fsh:1:19: guided A10: both './b.ts' and './b.fsh' are there, so which this imports is yours to choose\n"), `stdout: ${run.out}`);
  done(top);
});

test("a settled rename that fails when written says which files already import its new name", () => {
  const top = fresh();
  try {
    const at = dir(top, "settled-fails", [["a.ts", 'import { b } from "./b.ts";\nconsole.log(b);\n'], ["b.ts", "export const b = 1;\n"]]);
    chmodSync(join(at, "b.ts"), 0o444);
    const run = lint(at, ["a.ts", "b.ts", "--fix"]);
    chmodSync(join(at, "b.ts"), 0o644);
    assert(run.code === 1, `exit code ${run.code}`);
    same(read(join(at, "a.fsh")), 'import { b } from "./b.fsh";\nconsole.log(b);\n', "a.fsh");
    assert(/^fishc lint: can't write 'b\.ts': .*; 'a\.fsh' already imports its '\.fsh' name, which isn't there\n$/.test(run.err), `stderr: ${run.err}`);
  } catch (e) {
    assert(false, e.message);
  }
  done(top);
});

function guidedSrc(): string {
  return `async function save(): Promise<void> {}
function main(s: string, at: number) {
  const o = { n: 1 };
  const p = o;
  p.n = 2;
  save();
  return s[at] + o.n;
}
`;
}

test("guided hits print with their suggestion, and --fix leaves them as written and still reports them", () => {
  const top = fresh();
  const pkg = dir(top, "guided", [["fish.toml", compat()], ["src/main.fsh", guidedSrc()]]);
  const expected = [
    "src/main.fsh:2:26: guided G3: this 'number' counts or indexes, and a Fish 'number' is a float; make it 'i64', or 'usize' for an index",
    " 2 | function main(s: string, at: number) {",
    "   |                          ^^",
    "src/main.fsh:4:9: guided G11: 'p' and 'o' hold one value, changed through one while the other is still used, which Fish's ownership refuses; share it as 'shared<T>', give one its own '.clone()', or restructure so one name is used at a time",
    " 4 |   const p = o;",
    "   |         ^^^^^",
    "src/main.fsh:6:3: guided G2: the promise this call gives is dropped, and a Fish future runs only when it is awaited; add 'await', or wrap the call in 'spawn()' to run it on its own",
    " 6 |   save();",
    "   |   ^^^^^^",
    "3 to change in 1 file",
    "",
  ].join("\n");
  ran(lint(pkg, []), 1, expected, "", "lint");
  ran(lint(pkg, ["--fix"]), 1, expected, "", "lint --fix");
  same(read(join(pkg, "src/main.fsh")), guidedSrc(), "the file");
  done(top);
});
