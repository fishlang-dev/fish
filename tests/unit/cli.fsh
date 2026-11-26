// The `fishc` commands, run as the native fishc. Each test makes its own
// directory and removes it at its end. `indented` alone is called in process, with Node's
// `JSON.stringify` as its reference.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { indented } from "../../src/main.fsh";
import { fishcPath, ran, ranFor, read, reference, removed, same, scratch, text, type Ran } from "./support.fsh";

// Runs the native fishc with `args` in `cwd`, without the variables that decide whether output is
// coloured, and with `vars`, each `NAME=value`, set.
function fishcIn(cwd: string, args: string[], vars: string[] = []): Ran {
  const run = spawnSync("env", ["-u", "FORCE_COLOR", "-u", "NO_COLOR", ...vars, fishcPath(), ...args], { cwd });
  return { code: run.status ?? -1, out: text(run.stdout), err: text(run.stderr) };
}

// A directory under `root` holding `files`.
function dir(root: string, name: string, files: [string, string][] = []): string {
  const at = join(root, name);
  try {
    for (const [path, contents] of files) {
      mkdirSync(dirname(join(at, path)), { recursive: true });
      writeFileSync(join(at, path), contents);
    }
    mkdirSync(at, { recursive: true });
  } catch (e) {
    assert(false, `can't make ${at}: ${e.message}`);
  }
  return at;
}

function ranOut(file: string): string {
  return text(spawnSync(file, []).stdout);
}

function firstLine(s: string): string {
  return s.split("\n")[0];
}

test("fishc build with no file builds the package around the working directory into target", () => {
  const root = scratch("fish-cli-");
  const p = dir(root, "app", [["fish.toml", `[package]\nname = "app"\nversion = "0.1.0"\n`], ["src/main.fsh", `function main() { console.log("from app"); }\n`]]);
  ran(fishcIn(p, ["build"]), 0, "", "", "fishc build");
  same(ranOut(join(p, "target", "debug", "app")), "from app\n", "the debug build");
  assert(fishcIn(join(p, "src"), ["build", "--release"]).code === 0, "the release build failed");
  same(ranOut(join(p, "target", "release", "app")), "from app\n", "the release build");
  assert(fishcIn(p, ["build", "-o", "elsewhere"]).code === 0, "the -o build failed");
  same(ranOut(join(p, "elsewhere")), "from app\n", "the -o build");
  removed(root);
}, { timeout: 30_000 });

test("a package's entry and its errors are found through the manifest", () => {
  const root = scratch("fish-cli-");
  const p = dir(root, "entry", [["fish.toml", `[package]\nname = "entry"\nversion = "1.0.0"\nentry = "app/start.fsh"\n`], ["app/start.fsh", `function main() { const x: i64 = "no"; }\n`]]);
  const bad = fishcIn(p, ["build"]);
  assert(bad.code === 1, `exited with ${bad.code}`);
  same(firstLine(bad.err), `app/start.fsh:1:34: error[E0101]: type '"no"' is not assignable to type 'i64'`, "the entry's error");
  const gone = dir(root, "gone", [["fish.toml", `[package]\nname = "gone"\nversion = "1.0.0"\nentry = "src/app.fsh"\n`]]);
  same(firstLine(fishcIn(gone, ["build"]).err), `fish.toml:4:9: error[E0905]: the entry 'src/app.fsh' doesn't exist; create it, or name another with entry = "..."`, "a missing entry");
  const typo = dir(root, "typo", [["fish.toml", `[package]\nname = "typo"\nverison = "1.0.0"\n`]]);
  same(firstLine(fishcIn(typo, ["build"]).err), "fish.toml:3:1: error[E0905]: [package] has no key 'verison'; it has name, version, entry, lib, edition", "a misspelled key");
  removed(root);
}, { timeout: 30_000 });

test("fishc build with no file and no package says how to make one", () => {
  const root = scratch("fish-cli-");
  const none = dir(root, "none");
  assert(!existsSync(join(root, "fish.toml")), "a fish.toml in the root");
  ran(fishcIn(none, ["build"]), 2, "", "fishc build: no fish.toml here or in any directory above; give a file to build, or make a package with 'fishc new <name>' or 'fishc init'\n", "fishc build");
  removed(root);
}, { timeout: 30_000 });

test("fishc new makes a package that builds and greets", () => {
  const root = scratch("fish-cli-");
  const here = dir(root, "news");
  ran(fishcIn(here, ["new", "hello"]), 0, "created the package 'hello' in hello/\n", "", "fishc new");
  const p = join(here, "hello");
  try {
    assert(statSync(join(p, "fish.toml")).size > 0, "an empty fish.toml");
  } catch (e) {
    assert(false, e.message);
  }
  same(read(join(p, ".gitignore")), "/target\n", "the .gitignore");
  assert(fishcIn(p, ["build"]).code === 0, "the build failed");
  same(ranOut(join(p, "target", "debug", "hello")), "Hello from hello!\n", "the program");
  removed(root);
}, { timeout: 30_000 });

test("fishc init makes a package where it is run, keeping code already there", () => {
  const root = scratch("fish-cli-");
  const fresh = dir(root, "tool");
  ran(fishcIn(fresh, ["init"]), 0, "created the package 'tool'\n", "", "fishc init");
  assert(fishcIn(fresh, ["build"]).code === 0, "the fresh build failed");
  same(ranOut(join(fresh, "target", "debug", "tool")), "Hello from tool!\n", "the fresh program");
  const existing = dir(root, "existing", [["src/main.fsh", `function main() { console.log("mine"); }\n`], [".gitignore", "/out\n"]]);
  assert(fishcIn(existing, ["init", "kept"]).code === 0, "fishc init kept failed");
  assert(fishcIn(existing, ["build"]).code === 0, "the existing build failed");
  same(ranOut(join(existing, "target", "debug", "kept")), "mine\n", "the existing program");
  same(read(join(existing, ".gitignore")), "/out\n", "the kept .gitignore");
  removed(root);
}, { timeout: 30_000 });

test("new and init refuse bad names and overwriting", () => {
  const root = scratch("fish-cli-");
  const here = dir(root, "refusals", [["taken/file.txt", "x"]]);
  const rule = "a package name is lowercase letters, digits and '-', starting with a letter, at most 64 characters";
  ran(fishcIn(here, ["new", "Bad_Name"]), 2, "", `fishc new: 'Bad_Name' isn't a package name: ${rule}\n`, "a bad name");
  same(fishcIn(here, ["new", "taken"]).err, "fishc new: 'taken' already exists and isn't empty; choose another name, or run 'fishc init' inside it\n", "a taken name");
  assert(fishcIn(here, ["new"]).code === 2, "fishc new with no name");
  const odd = dir(root, "Odd Dir");
  same(fishcIn(odd, ["init"]).err, `fishc init: this directory's name 'Odd Dir' isn't a package name: ${rule}; give one, as in 'fishc init my-app'\n`, "an odd directory");
  assert(fishcIn(odd, ["init", "odd"]).code === 0, "fishc init odd failed");
  ran(fishcIn(odd, ["init", "odd"]), 2, "", "fishc init: there is already a fish.toml here\n", "a second init");
  removed(root);
}, { timeout: 30_000 });

function compat(): string {
  return "this file is in the TS-compat edition, which Fish doesn't compile; run 'fishc lint' to find what to change, then mark it '// @fish-edition native'";
}

function manifestOf(name: string, extra: string): string {
  return `[package]\nname = "${name}"\nversion = "0.1.0"\n${extra}\n[dependencies]\n`;
}

test("a TS-compat package's files are refused by build and test, at each file's first line", () => {
  const root = scratch("fish-cli-");
  const pkg = dir(root, "compat-pkg", [["fish.toml", manifestOf("compat-pkg", 'edition = "ts-compat"\n')], ["src/main.fsh", 'function main() {\n  console.log("hi");\n}\n']]);
  const refusal = `src/main.fsh:1:1: error[E0006]: ${compat()}\n 1 | function main() {\n   | ^^^^^^^^^^^^^^^^^\n`;
  ran(fishcIn(pkg, ["build"]), 1, "", refusal, "fishc build");
  const tested = fishcIn(pkg, ["test"]);
  assert(tested.code === 1, `fishc test exited with ${tested.code}`);
  same(tested.err, refusal, "fishc test's stderr");
  removed(root);
}, { timeout: 30_000 });

test("a file's directive sets its edition, over its package's, after any shebang", () => {
  const root = scratch("fish-cli-");
  const pkg = dir(root, "directives", [
    ["fish.toml", manifestOf("directives", 'edition = "ts-compat"\n')],
    ["src/main.fsh", '#!/usr/bin/env fishc\n// @fish-edition native\nimport { two } from "./two.fsh";\nfunction main() {\n  console.log(two());\n}\n'],
    ["src/two.fsh", "// @fish-edition native\nexport function two(): i64 {\n  return 2;\n}\n"],
  ]);
  assert(fishcIn(pkg, ["build"]).code === 0, "the build failed");
  same(ranOut(join(pkg, "target", "debug", "directives")), "2\n", "the program");
  // An imported file marked TS-compat is refused at its directive, in a native package too.
  const mixed = dir(root, "mixed-editions", [
    ["main.fsh", 'import { two } from "./two.fsh";\nfunction main() {\n  console.log(two());\n}\n'],
    ["two.fsh", "// @fish-edition ts-compat\nexport function two(): i64 {\n  return 2;\n}\n"],
  ]);
  ran(fishcIn(mixed, ["build", "main.fsh"]), 1, "", `two.fsh:1:1: error[E0006]: ${compat()}\n 1 | // @fish-edition ts-compat\n   | ^^^^^^^^^^^^^^^^^^^^^^^^^^\n`, "a TS-compat import");
  const unknown = dir(root, "unknown-edition", [["main.fsh", "#!/usr/bin/env fishc\n// @fish-edition typescript\nfunction main() {}\n"]]);
  ran(fishcIn(unknown, ["build", "main.fsh"]), 1, "", "main.fsh:2:1: error[E0005]: an edition directive is written '// @fish-edition native' or '// @fish-edition ts-compat'\n 2 | // @fish-edition typescript\n   | ^^^^^^^^^^^^^^^^^^^^^^^^^^^\n", "an unknown edition");
  removed(root);
}, { timeout: 30_000 });

test("a dependency's TS-compat file is refused where the dependency is built", () => {
  const root = scratch("fish-cli-");
  dir(root, "compat-dep/words", [["fish.toml", manifestOf("words", 'edition = "ts-compat"\n')], ["src/lib.fsh", 'export function word(): string {\n  return "fish";\n}\n']]);
  const app = dir(root, "compat-dep/app", [["fish.toml", manifestOf("app", "").replace("[dependencies]\n", '[dependencies]\nwords = { path = "../words" }\n')], ["src/main.fsh", 'import { word } from "words";\nfunction main() {\n  console.log(word());\n}\n']]);
  const built = fishcIn(app, ["build"]);
  assert(built.code === 1, `exited with ${built.code}`);
  same(built.err, `../../words/src/lib.fsh:1:1: error[E0006]: ${compat()}\n 1 | export function word(): string {\n   | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n`, "the build's stderr");
  removed(root);
}, { timeout: 30_000 });

test("only a debug build keeps frames for panic backtraces", () => {
  const root = scratch("fish-cli-");
  const at = dir(root, "backtrace-frames", [["main.fsh", "function twice(n: i64): i64 {\n  return n * 2;\n}\nfunction main() {\n  console.log(twice(3));\n}\n"]]);
  const debug = fishcIn(at, ["build", "main.fsh", "--emit-llvm"]);
  assert(debug.code === 0, `the debug build exited with ${debug.code}`);
  assert(debug.out.includes("store ptr %fsh.site, ptr @fsh_rt_frames"), "the debug IR keeps no frames");
  const release = fishcIn(at, ["build", "main.fsh", "--release", "--emit-llvm"]);
  assert(release.code === 0, `the release build exited with ${release.code}`);
  assert(!/fsh_rt_frames|%fsh\.(site|name|link|prev)/.test(release.out), "the release IR keeps frames");
  removed(root);
}, { timeout: 30_000 });

test("fishc check checks a file or package without building, exiting 1 on an error", () => {
  const root = scratch("fish-cli-");
  const p = dir(root, "checked", [["fish.toml", `[package]\nname = "checked"\nversion = "0.1.0"\n`], ["src/main.fsh", `function main() { console.log("ok"); }\n`], ["bad.fsh", `function main() {\n  const n: i64 = "no";\n}\n`]]);
  ran(fishcIn(p, ["check"]), 0, "", "", "fishc check");
  ran(fishcIn(p, ["check", "src/main.fsh"]), 0, "", "", "fishc check src/main.fsh");
  assert(!existsSync(join(p, "target")), "check made a target directory");
  const bad = fishcIn(p, ["check", "bad.fsh"]);
  assert(bad.code === 1, `exited with ${bad.code}`);
  same(bad.err, fishcIn(p, ["build", "bad.fsh"]).err, "check's error against build's");
  assert(bad.err.includes("bad.fsh:2:18: error[E0101]:"), `stderr: ${bad.err}`);
  removed(root);
}, { timeout: 30_000 });

test("fishc run builds and runs a program with its arguments and exit code", () => {
  const root = scratch("fish-cli-");
  const program = `import { argv, exit } from "node:process";\nfunction main() {\n  const args = argv();\n  console.log(args.slice(2).join(","));\n  if (args.length > 3) exit(3);\n}\n`;
  const p = dir(root, "runs", [["fish.toml", `[package]\nname = "runs"\nversion = "0.1.0"\n`], ["src/main.fsh", program], ["one.fsh", program], ["bad.fsh", `function main() {\n  const n: i64 = "no";\n}\n`]]);
  ran(fishcIn(p, ["run", "one.fsh", "a"]), 0, "a\n", "", "fishc run one.fsh a");
  ran(fishcIn(p, ["run", "one.fsh", "--", "a", "--flag"]), 3, "a,--flag\n", "", "fishc run one.fsh -- a --flag");
  ran(fishcIn(p, ["run", "--", "x"]), 0, "x\n", "", "fishc run -- x");
  assert(existsSync(join(p, "target", "debug", "runs")), "no target/debug/runs");
  const bad = fishcIn(p, ["run", "bad.fsh"]);
  assert(bad.code === 1, `exited with ${bad.code}`);
  same(bad.out, "", "stdout");
  assert(bad.err.includes("error[E0101]:"), `stderr: ${bad.err}`);
  removed(root);
}, { timeout: 30_000 });

test("fishc explain prints a code's explanation, and refuses a code that isn't one", () => {
  const root = scratch("fish-cli-");
  const explained = fishcIn(root, ["explain", "e0201"]);
  assert(explained.code === 0, `exited with ${explained.code}`);
  same(firstLine(explained.out), "E0201: use of a moved value", "the title");
  same(explained.err, "", "stderr");
  assert(explained.out.includes("In TypeScript, both names would refer to the same object"), `stdout: ${explained.out}`);
  ran(fishcIn(root, ["explain", "E9999"]), 2, "", "fishc explain: 'E9999' isn't an error code; a code looks like E0201 or W0001, as an error shows it\n", "an unknown code");
  same(fishcIn(root, ["explain"]).err, "usage: fishc explain <code>\n", "no code");
  removed(root);
}, { timeout: 30_000 });

test("fishc check reports every error, with a closing count, painted only when asked for", () => {
  const root = scratch("fish-cli-");
  const p = dir(root, "several", [["main.fsh", `function a(): i64 {\n  return "x";\n}\nfunction b(): void {\n  const s: string = 1;\n}\nfunction main() {\n  b();\n  console.log(a());\n}\n`]]);
  const plain = fishcIn(p, ["check", "main.fsh"]);
  assert(plain.code === 1, `exited with ${plain.code}`);
  same(plain.err.split("\n").filter((l) => l.includes("error")).join("\n"), [
    `main.fsh:2:10: error[E0101]: type '"x"' is not assignable to return type 'i64'`,
    "main.fsh:5:21: error[E0101]: type 'i64' is not assignable to type 'string'",
    "error: could not compile due to 2 previous errors",
  ].join("\n"), "the error lines");
  const painted = (vars: string[]) => fishcIn(p, ["check", "main.fsh"], vars).err;
  const forced = painted(["FORCE_COLOR=1"]);
  assert(forced.includes("\x1b[1mmain.fsh:2:10:\x1b[0m \x1b[1;31merror[E0101]\x1b[0m"), `FORCE_COLOR=1 gave: ${JSON.stringify(forced)}`);
  same(painted(["FORCE_COLOR=0"]), plain.err, "FORCE_COLOR=0");
  same(painted(["NO_COLOR=1"]), plain.err, "NO_COLOR=1");
  removed(root);
}, { timeout: 30_000 });

type Stage = { stage: string; ms: f64; note: string | null };

// Each `--timings` line as its stage, milliseconds and note; the numbers are only checked to parse.
function stages(err: string): Stage[] {
  let found: Stage[] = [];
  for (const l of err.trimEnd().split("\n")) {
    const m = /^(\w+) +(\d+\.\d) ms(?: \((.+)\))?$/.exec(l);
    assert(m !== null, `not a timings line: ${l}`);
    const ms = parseFloat(m![2]);
    assert(ms !== null, `not a number: ${l}`);
    const note = m![3];
    found.push({ stage: m![1], ms: ms!, note });
  }
  return found;
}

function names(err: string): string {
  return stages(err).map((s) => s.stage).join(",");
}

function timedProgram(): string {
  return `function fib(n: i64): i64 { return n < 2 ? n : fib(n - 1) + fib(n - 2); }\nconst N = comptime fib(10);\nfunction main() { console.log(N); }\n`;
}

test("fishc check --timings prints each front-end stage's time, then the total", () => {
  const root = scratch("fish-cli-");
  const p = dir(root, "timings-check", [["main.fsh", timedProgram()]]);
  const checked = fishcIn(p, ["check", "main.fsh", "--timings"]);
  assert(checked.code === 0, `exited with ${checked.code}`);
  same(checked.out, "", "stdout");
  same(names(checked.err), "parse,macros,check,moves,comptime,total", "check's stages");
  ran(fishcIn(p, ["check", "main.fsh"]), 0, "", "", "fishc check without --timings");
  const ir = fishcIn(p, ["build", "main.fsh", "--emit-llvm", "--timings"]);
  assert(ir.out.includes('@"fsh.main"'), "no fsh.main in the IR");
  same(names(ir.err), "parse,macros,check,moves,comptime,codegen,total", "--emit-llvm's stages");
  const bad = fishcIn(p, ["check", "--timings", dir(root, "timings-bad", [["bad.fsh", `function main() { const n: i64 = "no"; }\n`]]) + "/bad.fsh"]);
  assert(bad.code === 1, `exited with ${bad.code}`);
  assert(!bad.err.includes(" ms"), `a failed check printed timings: ${bad.err}`);
  removed(root);
}, { timeout: 30_000 });

test("fishc build and run --timings print every stage, saying which objects were built or cached", () => {
  const root = scratch("fish-cli-");
  const p = dir(root, "timings-build", [["main.fsh", timedProgram()]]);
  const all = "parse,macros,check,moves,comptime,codegen,compile,runtime,link,total";
  // A cache of its own, so the first build compiles the runtime's objects and the second reuses them.
  const cache = [`FISH_CACHE_DIR=${join(p, "cache")}`];
  const first = fishcIn(p, ["build", "main.fsh", "--timings"], cache.clone());
  same(names(first.err), all, "the first build's stages");
  const firstNote = stages(first.err)[7].note ?? "";
  assert(/^built runtime, std, .+; 0 cached$/.test(firstNote), `the first build's runtime note: ${firstNote}`);
  const again = fishcIn(p, ["build", "main.fsh", "--timings"], cache);
  assert(again.code === 0, `the second build exited with ${again.code}`);
  const againNote = stages(again.err)[7].note ?? "";
  assert(/^\d+ cached$/.test(againNote), `the second build's runtime note: ${againNote}`);
  same(ranOut(join(p, "main")), "55\n", "the program");
  const run = fishcIn(p, ["run", "main.fsh", "--timings", "--release"]);
  assert(run.code === 0, `fishc run exited with ${run.code}`);
  same(run.out, "55\n", "fishc run's output");
  same(names(run.err), all, "fishc run's stages");
  ran(fishcIn(p, ["build", "main.fsh", "--lib", "--timings"]), 2, "", "fishc build: '--timings' times an executable's build; leave out '--lib' to time the program it would be built from\n", "--lib --timings");
  removed(root);
}, { timeout: 30_000 });

// Node's `JSON.stringify(JSON.parse(s), null, 2)` for each of `inputs`.
function nodeIndented(inputs: Ref<string[]>): string[] {
  const script = `console.log(JSON.stringify(JSON.parse(process.argv[1]).map((s) => JSON.stringify(JSON.parse(s), null, 2))));`;
  const given = JSON.stringify(inputs);
  const run = reference("cli-json-indented", `${script}\n${given}`, () => ranFor("node", ["-e", script, given]));
  assert(run.status === 0, `node failed: ${run.stderr}`);
  try {
    return JSON.parse<string[]>(run.stdout);
  } catch (e) {
    assert(false, `node gave: ${run.stdout}`);
    return [];
  }
}

test("indented lays compact JSON out as JSON.stringify does with an indent of 2", () => {
  // JSON.stringify's compact output for each value the layout is checked on.
  const values = [`{"a":1,"b":[1,2,{"c":"x,y:\\"z"}],"d":{},"e":[],"f":null,"g":"\\\\"}`, "[]", "{}", "[[]]", `"s"`, "3", `{"n":{"m":{}}}`];
  const want = nodeIndented(values);
  assert(want.length === values.length, "node gave too few");
  for (let i: usize = 0; i < values.length; i++) same(indented(values[i]), want[i], values[i]);
}, { timeout: 30_000 });

test("fishc parse parses a file without checking it, and reports a syntax error", () => {
  const root = scratch("fish-cli-");
  const at = dir(root, "parse-only", [["ok.fsh", "function f(): i64 { return undefinedName; }\n"], ["bad.fsh", "function f( {\n"]]);
  ran(fishcIn(at, ["parse", "ok.fsh"]), 0, "", "", "fishc parse ok.fsh");
  const bad = fishcIn(at, ["parse", "bad.fsh"]);
  assert(bad.code === 1, `exited with ${bad.code}`);
  assert(bad.err.includes("bad.fsh:2:1: error[E0001]"), `stderr: ${bad.err}`);
  removed(root);
}, { timeout: 30_000 });
