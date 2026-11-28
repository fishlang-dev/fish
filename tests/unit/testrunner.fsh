// `fishc test` run as the native fishc on small packages in a
// scratch directory. The two tests the Bun one makes in process are made through the command line:
// the test program `buildTests` writes is kept by a clang on PATH that copies what it links, and
// a test program that can't be started is one that clang removes once linked.
import type { Subprocess } from "bun";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { usageOf } from "../../src/commands.fsh";
import { fishcPath, read, removed, same, scratch, text } from "./support.fsh";

type Ran = { code: i64; out: string; err: string };

function shown(r: Ref<Ran>): string {
  return `code ${r.code}\nstdout:\n${r.out}\nstderr:\n${r.err}`;
}

function equal(got: Ref<Ran>, want: Ref<Ran>, what: string): void {
  assert(got === want, `${what}:\n--- expected\n${shown(want)}\n--- got\n${shown(got)}`);
}

// Runs `fishc test` with `args` in the directory `cwd`, with `vars`, each `NAME=value`, set.
function fishcTest(cwd: string, args: string[], vars: string[] = []): Ran {
  const run = spawnSync("env", [...vars, fishcPath(), "test", ...args], { cwd });
  return { code: run.status ?? -1, out: text(run.stdout), err: text(run.stderr) };
}

function write(path: string, contents: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

// A package `name` under `root` holding `files` beside its manifest.
function pkg(root: string, name: string, files: Ref<[string, string][]>): string {
  const at = join(root, name);
  write(join(at, "fish.toml"), `[package]\nname = "${name}"\nversion = "0.1.0"\n`);
  for (const [path, contents] of files) write(join(at, path), contents);
  return at;
}

function mixed(): string {
  return `function main() {}
test("passes", () => {
  assert(1 + 1 === 2);
});
test("panics", () => {
  console.log("about to panic");
  const xs: i64[] = [];
  console.log(xs[3]);
});
test("asserts", () => {
  assert(2 > 3, "two isn't more than three");
});
test("throws", () => {
  throw new Error("thrown out");
});
test("awaits", async () => {
  await sleep(1);
  assert(true);
});
test("hangs", () => {
  while (true) {}
});
test("passes last", function () {
  console.log("never shown");
});
`;
}

test("each test runs in its own process and is reported in order, a hung one failed after the limit", () => {
  const root = scratch("fish-test-");
  const got = fishcTest(pkg(root, "mixed", [["src/main.fsh", mixed()]]), []);
  same(
    got.out,
    [
      "ok src/main.fsh > passes",
      "FAIL src/main.fsh > panics",
      "about to panic",
      "panicked at src/main.fsh:8:15:",
      "index out of bounds: the len is 0 but the index is 3",
      "stack backtrace:",
      '   0: test "panics" at src/main.fsh:8:15',
      "FAIL src/main.fsh > asserts",
      "panicked at src/main.fsh:11:3:",
      "two isn't more than three",
      "stack backtrace:",
      '   0: test "asserts" at src/main.fsh:11:3',
      "FAIL src/main.fsh > throws",
      "Error: [Error: thrown out]",
      "ok src/main.fsh > awaits",
      "FAIL src/main.fsh > hangs",
      "timed out after 10s",
      "ok src/main.fsh > passes last",
      "3 passed, 4 failed",
      "",
    ].join("\n"),
    "the report",
  );
  assert(got.code === 1, `exited with ${got.code}`);
  removed(root);
}, { timeout: 60_000 });

function passing(): string {
  return `function main() {}
test("adds", () => {
  assert(1 + 1 === 2);
});
test("adds again", async () => {
  assert(2 + 2 === 4);
});
test("subtracts", () => {
  assert(2 - 1 === 1);
});
`;
}

test("a package whose tests all pass exits 0", () => {
  const root = scratch("fish-test-");
  equal(fishcTest(pkg(root, "passing", [["src/main.fsh", passing()]]), []), { code: 0, out: "ok src/main.fsh > adds\nok src/main.fsh > adds again\nok src/main.fsh > subtracts\n3 passed, 0 failed\n", err: "" }, "fishc test");
  removed(root);
}, { timeout: 60_000 });

test("a filter runs only the tests whose name holds it, and one matching none exits 1", () => {
  const root = scratch("fish-test-");
  const dir = pkg(root, "filtered", [["src/main.fsh", passing()]]);
  equal(fishcTest(dir, ["adds"]), { code: 0, out: "ok src/main.fsh > adds\nok src/main.fsh > adds again\n2 passed, 0 failed\n", err: "" }, "fishc test adds");
  equal(fishcTest(dir, ["multiplies"]), { code: 1, out: "", err: "fishc test: no test's name contains 'multiplies'\n" }, "fishc test multiplies");
  const two = fishcTest(dir, ["a", "b"]);
  assert(two.code === 2, `fishc test a b exited with ${two.code}`);
  removed(root);
}, { timeout: 30_000 });

test("a file runs only its own tests, a filter builds only the files it can match, and either matching nothing says so", () => {
  const root = scratch("fish-test-");
  const dir = pkg(root, "picked", [
    ["src/main.fsh", passing()],
    ["src/other.fsh", 'export const n: i64 = 1;\ntest("other adds", () => {\n  assert(n + n === 2);\n});\n'],
    ["src/broken.fsh", 'test("never built", () => {\n  const n: i64 = "two";\n});\n'],
    ["src/none.fsh", "export const m: i64 = 2;\n"],
  ]);
  equal(fishcTest(dir, ["src/other.fsh"]), { code: 0, out: "ok src/other.fsh > other adds\n1 passed, 0 failed\n", err: "" }, "fishc test src/other.fsh");
  equal(fishcTest(dir, ["subtracts"]), { code: 0, out: "ok src/main.fsh > subtracts\n1 passed, 0 failed\n", err: "" }, "fishc test subtracts");
  equal(fishcTest(dir, ["src/none.fsh"]), { code: 1, out: "", err: "fishc test: 'src/none.fsh' has no tests\n" }, "fishc test src/none.fsh");
  equal(fishcTest(dir, ["divides"]), { code: 1, out: "", err: "fishc test: no test's name contains 'divides'\n" }, "fishc test divides");
  removed(root);
}, { timeout: 60_000 });

// A directory holding a clang that runs the real one, then does `then` with the path it linked,
// `$out`, when that is a test program.
function clangShim(root: string, then: string): string {
  const bin = join(root, "shim");
  try {
    mkdirSync(bin, { recursive: true });
    const clang = Bun.which("clang");
    assert(clang !== null, "no clang on PATH");
    writeFileSync(join(bin, "clang"), `#!/bin/sh\n${JSON.stringify(clang!)} "$@" || exit $?\nout=""; prev=""\nfor a in "$@"; do [ "$prev" = "-o" ] && out=$a; prev=$a; done\nif [ "$(basename "$out")" = tests ]; then ${then}; fi\n`);
    chmodSync(join(bin, "clang"), 0o755);
  } catch (e) {
    assert(false, `can't make the clang shim: ${e.message}`);
  }
  return `PATH=${bin}:${process.env.PATH ?? ""}`;
}

test("the test program lists its tests and runs one by its index", () => {
  const root = scratch("fish-test-");
  const out = join(root, "kept-tests");
  const path = clangShim(root, `cp "$out" ${JSON.stringify(out)}`);
  const ran = fishcTest(pkg(root, "listed", [["src/main.fsh", passing()]]), [], [path]);
  same(ran.out, "ok src/main.fsh > adds\nok src/main.fsh > adds again\nok src/main.fsh > subtracts\n3 passed, 0 failed\n", "the tests fishc test ran");
  same(text(spawnSync(out, ["--list"]).stdout), "adds\nadds again\nsubtracts\n", "the test program's list");
  const one = spawnSync(out, ["1"]).status ?? -1;
  assert(one === 0, `running test 1 exited with ${one}`);
  const nine = spawnSync(out, ["9"]).status ?? -1;
  assert(nine === 2, `running test 9 exited with ${nine}`);
  removed(root);
}, { timeout: 30_000 });

test("a package with no tests says so and exits 0", () => {
  const root = scratch("fish-test-");
  equal(fishcTest(pkg(root, "untested", [["src/main.fsh", "function main() {}\n"]]), []), { code: 0, out: "no tests found\n", err: "" }, "fishc test");
  removed(root);
}, { timeout: 30_000 });

test("a compile error in a test is reported as a build reports it", () => {
  const root = scratch("fish-test-");
  const got = fishcTest(pkg(root, "broken", [["src/main.fsh", 'function main() {}\ntest("typed", () => {\n  const n: i64 = "two";\n});\n']]), []);
  equal(got, { code: 1, out: "", err: `src/main.fsh:3:18: error[E0101]: type '"two"' is not assignable to type 'i64'\n 3 |   const n: i64 = "two";\n   |                  ^^^^^\n` }, "fishc test");
  removed(root);
}, { timeout: 30_000 });

test("outside a package, fishc test says where it runs", () => {
  const root = scratch("fish-test-");
  const dir = join(root, "loose");
  try {
    mkdirSync(dir);
  } catch (e) {
    assert(false, e.message);
  }
  const got = fishcTest(dir, []);
  assert(got.code === 2, `exited with ${got.code}`);
  assert(got.err.includes("tests run inside a package"), `stderr:\n${got.err}`);
  removed(root);
}, { timeout: 30_000 });

test("tests in every file of the package are found and run, each reported with its file", () => {
  const root = scratch("fish-test-");
  const dir = pkg(root, "several", [
    ["src/main.fsh", 'import { greet } from "./lib.fsh";\nfunction main() {\n  console.log(greet("you"));\n}\ntest("main greets", () => {\n  assert(greet("a") === "hello a");\n});\n'],
    ["src/lib.fsh", 'import { twice } from "./util/math.fsh";\nexport function greet(name: string): string {\n  return `hello ${name}`;\n}\nfunction shout(s: string): string {\n  return s.toUpperCase();\n}\ntest("lib calls its own function", () => {\n  assert(shout("a") === "A");\n});\ntest("lib calls an imported one", () => {\n  assert(twice(2) === 4);\n});\n'],
    ["src/util/math.fsh", 'export function twice(n: i64): i64 {\n  return n * 2;\n}\ntest("twice", () => {\n  assert(twice(3) === 6);\n});\n'],
    ["tools/unused.fsh", 'function main() {\n  console.log("a file nothing imports, with its own main");\n}\ntest("found anyway", () => {});\n'],
    ["target/debug/stale.fsh", 'test("build output", () => {\n  assert(false);\n});\n'],
    ["node_modules/dep/index.fsh", 'test("a dependency", () => {\n  assert(false);\n});\n'],
    [".hidden/x.fsh", 'test("hidden", () => {\n  assert(false);\n});\n'],
    ["nested/fish.toml", '[package]\nname = "nested"\nversion = "0.1.0"\n'],
    ["nested/src/main.fsh", 'function main() {}\ntest("a nested package", () => {\n  assert(false);\n});\n'],
  ]);
  equal(fishcTest(dir, []), { code: 0, out: ["ok src/lib.fsh > lib calls its own function", "ok src/lib.fsh > lib calls an imported one", "ok src/main.fsh > main greets", "ok src/util/math.fsh > twice", "ok tools/unused.fsh > found anyway", "5 passed, 0 failed", ""].join("\n"), err: "" }, "fishc test");
  // The package's own build still runs its main, and leaves its tests out.
  const built = spawnSync(fishcPath(), ["build"], { cwd: dir });
  assert(built.status === 0, `fishc build exited with ${built.status ?? -1}:\n${text(built.stderr)}`);
  same(text(spawnSync(join(dir, "target", "debug", "several"), []).stdout), "hello you\n", "the package's program");
  removed(root);
}, { timeout: 30_000 });

test("a test name used twice in a package is refused at its second use", () => {
  const root = scratch("fish-test-");
  const dir = pkg(root, "twice", [["src/a.fsh", 'test("same", () => {});\n'], ["src/b.fsh", 'function helper() {}\ntest("same", () => {});\n']]);
  const got = fishcTest(dir, []);
  assert(got.code === 1, `exited with ${got.code}`);
  same(got.err, `src/b.fsh:2:6: error[E1106]: there is already a test named 'same' in 'src/a.fsh'; give each test a name of its own\n 2 | test("same", () => {});\n   |      ^^^^^^\n`, "stderr");
  removed(root);
}, { timeout: 30_000 });

function system(): string {
  return "declare function system(command: Ptr<u8>): i32;\nfunction main() {}\n";
}

test("a child a test leaves running neither holds up its verdict nor outlives it", () => {
  const root = scratch("fish-test-");
  const dir = pkg(root, "children", [["src/main.fsh", `${system()}test("leaves a child behind", () => {\n  unsafe { system(cString("sleep 37 &")); }\n});\ntest("waits on a child past the limit", () => {\n  unsafe { system(cString("sleep 26")); }\n});\n`]]);
  const started = Date.now();
  const got = fishcTest(dir, []);
  const took = Date.now() - started;
  assert(took < 20000, `fishc test took ${took} ms`);
  same(got.out, "ok src/main.fsh > leaves a child behind\nFAIL src/main.fsh > waits on a child past the limit\ntimed out after 10s\n1 passed, 1 failed\n", "the report");
  assert(got.code === 1, `exited with ${got.code}`);
  same(text(spawnSync("pgrep", ["-f", "sleep (37|26)$"]).stdout), "", "the children still running");
  removed(root);
}, { timeout: 30_000 });

// Whether the test program built in `temp` is running its one test.
function spinning(temp: string): boolean {
  return text(spawnSync("pgrep", ["-f", `${temp}/fishc-test-[^/]*/tests 0$`]).stdout).trim() !== "";
}

test("stopped by SIGTERM, fishc test ends its tests and removes its build", async () => {
  const root = scratch("fish-test-");
  const dir = pkg(root, "stopped", [["src/main.fsh", 'function main() {}\ntest("spins", () => {\n  while (true) {}\n});\n']]);
  let temp = "";
  let child: Subprocess | null = null;
  try {
    temp = mkdtempSync(join(root, "tmp-"));
    child = Bun.spawn(["env", `TMPDIR=${temp}`, fishcPath(), "test"], { cwd: dir, stdout: "ignore", stderr: "ignore" });
  } catch (e) {
    assert(false, e.message);
  }
  for (let waited = 0; !spinning(temp) && waited < 8000; waited += 100) await sleep(100);
  const started = spinning(temp);
  let code: i64 = -1;
  if (child !== null) {
    child.kill("SIGTERM");
    code = await child.exited;
  }
  await sleep(100);
  const still = spinning(temp);
  if (still) spawnSync("pkill", ["-9", "-f", temp]);
  assert(started, "the test never started");
  assert(code === 143, `fishc test exited with ${code}`);
  assert(!still, "the test is still running");
  try {
    same(JSON.stringify(readdirSync(temp)), "[]", "what is left in the temporary directory");
  } catch (e) {
    assert(false, e.message);
  }
  removed(root);
}, { timeout: 30_000 });

test("a test calling its file's main reaches it", () => {
  const root = scratch("fish-test-");
  const dir = pkg(root, "callsmain", [["src/main.fsh", 'function main() {\n  console.log("hello");\n}\ntest("main runs", () => {\n  main();\n  assert(false);\n});\n']]);
  same(fishcTest(dir, []).out, 'FAIL src/main.fsh > main runs\nhello\npanicked at src/main.fsh:6:3:\nassertion failed: false\nstack backtrace:\n   0: test "main runs" at src/main.fsh:6:3\n0 passed, 1 failed\n', "the report");
  removed(root);
}, { timeout: 30_000 });

test("a failing test with no output is told by its exit code or signal", () => {
  const root = scratch("fish-test-");
  const dir = pkg(root, "silent", [["src/main.fsh", `${system()}test("exits", () => {\n  process.exit(3);\n});\ntest("is killed", () => {\n  unsafe { system(cString("kill -9 $PPID")); }\n});\n`]]);
  same(fishcTest(dir, []).out, "FAIL src/main.fsh > exits\nexited with 3\nFAIL src/main.fsh > is killed\nkilled by SIGKILL\n0 passed, 2 failed\n", "the report");
  removed(root);
}, { timeout: 30_000 });

test("a diagnostic names a test as the test, and --panic=abort is refused", () => {
  const root = scratch("fish-test-");
  const dir = pkg(root, "named", [["src/main.fsh", 'class Oops {}\nfunction main() {}\ntest("throws its own", () => {\n  throw new Oops();\n});\n']]);
  const named = fishcTest(dir, []);
  assert(named.err.includes("which isn't the 'Error' that the test 'throws its own' throws"), `stderr:\n${named.err}`);
  const aborting = fishcTest(dir, ["--panic=abort"]);
  assert(aborting.code === 2, `--panic=abort exited with ${aborting.code}`);
  same(aborting.err, `${usageOf("test")}\n`, "--panic=abort's stderr");
  removed(root);
}, { timeout: 30_000 });

test("a test that can't be started fails rather than stalling the report", () => {
  const root = scratch("fish-test-");
  const path = clangShim(root, `rm -f "$out"`);
  const got = fishcTest(pkg(root, "missing", [["src/main.fsh", 'function main() {}\ntest("missing", () => {});\n']]), [], [path]);
  assert(got.out.startsWith("FAIL src/main.fsh > missing\nthe test couldn't be run:"), `the report:\n${got.out}${got.err}`);
  assert(got.code === 1, `exited with ${got.code}`);
  removed(root);
}, { timeout: 30_000 });

test("a test whose name has a dot in it runs, beside a helper that can throw", () => {
  const root = scratch("fish-test-");
  const helper = 'function read(): string throws Error {\n  return "x";\n}\n';
  const body = 'test("reads a.txt", () => {\n  let got = "";\n  try {\n    got = read();\n  } catch (e) {\n    assert(false, e.message);\n  }\n  assert(got === "x");\n});\n';
  equal(fishcTest(pkg(root, "dotted", [["src/main.fsh", `function main() {}\n${helper}${body}`]]), []), { code: 0, out: "ok src/main.fsh > reads a.txt\n1 passed, 0 failed\n", err: "" }, "fishc test");
  removed(root);
}, { timeout: 30_000 });

test("fishc test --release builds the tests optimized and runs them", () => {
  const root = scratch("fish-test-");
  const at = pkg(root, "released", [["src/main.fsh", passing()]]);
  const plain = fishcTest(at, []);
  equal(fishcTest(at, ["--release"]), plain, "fishc test --release against fishc test");
  assert(plain.code === 0, `fishc test exited with ${plain.code}`);
  removed(root);
}, { timeout: 30_000 });

// Properties: each run over generated inputs, a failing one shrunk to its smallest and printed with
// the seed that replays it.
function properties(): string {
  return `function main() {}
type Point = { x: i64; y: i64 };
property("reversing twice gives the array back", (xs: i64[]) => {
  let ys = xs.toReversed().toReversed();
  assert(ys.length === xs.length);
  for (let i = 0; i < xs.length; i++) assert(ys[i] === xs[i]);
});
property("points add either way round", (a: Point, b: Point, flip: boolean) => {
  const one = flip ? a.x.wrappingAdd(b.x) : b.x.wrappingAdd(a.x);
  assert(one === a.x.wrappingAdd(b.x));
});
property("strings and unions", (s: string, k: "a" | "b" | null, t: [u8, f64]) => {
  assert(s.length >= 0);
  assert(k === null || k === "a" || k === "b");
  assert(t[0] <= 255);
});
property("no number is over 50", (n: i64) => {
  assert(n <= 50, "too big");
});
`;
}

test("a property runs over generated inputs and a failure is shrunk to the smallest", () => {
  const root = scratch("fish-props-");
  try {
    const dir = pkg(root, "props", [["src/main.fsh", properties()]]);
    const got = fishcTest(dir, ["--seed", "7"]);
    assert(got.code === 1, `the run's exit code: ${shown(got)}`);
    for (const name of ["reversing twice gives the array back", "points add either way round", "strings and unions"]) assert(got.out.includes(`ok src/main.fsh > ${name}\n`), `'${name}' passes:\n${shown(got)}`);
    assert(got.out.includes("FAIL src/main.fsh > no number is over 50\n"), `the failing property:\n${shown(got)}`);
    assert(got.out.includes("'fishc test --seed 7' runs it again"), `the seed is printed:\n${shown(got)}`);
    assert(got.out.includes("  n = 51\n"), `the failure shrinks to 51:\n${shown(got)}`);
    // The same seed draws the same inputs.
    const again = fishcTest(dir, ["--seed", "7", "over 50"]);
    const line = (out: string) => out.split("\n").find((l) => l.startsWith("property ")) ?? "";
    same(line(again.out), line(got.out), "the replay's failure");
  } finally {
    removed(root);
  }
});

test("a property's parameters need their types written, as types it can generate", () => {
  const root = scratch("fish-props-");
  try {
    const untyped = pkg(root, "untyped", [["src/main.fsh", `function main() {}\nproperty("p", (n) => {});\n`]]);
    assert(fishcTest(untyped, []).err.includes("a property is written as 'property(\"name\", (x: T, ...) => { ... })'"), "an untyped parameter");
    const map = pkg(root, "map", [["src/main.fsh", `function main() {}\nproperty("p", (m: Map<string, i64>) => {});\n`]]);
    assert(fishcTest(map, []).err.includes("a property's parameter can't be a 'Map<string, i64>' yet"), "a type with no generator");
  } finally {
    removed(root);
  }
});

function documentedLib(): string {
  return `/** Adds two numbers.
 *
 * \`\`\`fsh
 * console.log(add(1, 2));
 * // expect: 3
 * \`\`\`
 */
export function add(a: i64, b: i64): i64 {
  return a + b;
}

/** Wrong on purpose.
 *
 * \`\`\`fsh
 * console.log(add(2, 2));
 * // expect: 5
 * \`\`\`
 */
export function twice(a: i64): i64 {
  return add(a, a);
}
`;
}

test("the examples in doc comments run as tests, their expect lines checked, unless --no-doc", () => {
  const root = scratch("fish-doctests-");
  try {
    const dir = pkg(root, "doctests", [["src/main.fsh", "function main() {}\n"], ["src/lib.fsh", documentedLib()]]);
    const got = fishcTest(dir, []);
    assert(got.code === 1, `the run's exit code: ${shown(got)}`);
    assert(got.out.includes("ok src/lib.fsh > doc example at src/lib.fsh:3\n"), `the right example passes:\n${shown(got)}`);
    assert(got.out.includes("FAIL src/lib.fsh > doc example at src/lib.fsh:14\n--- expected\n5\n--- printed\n4\n"), `the wrong one fails naming both:\n${shown(got)}`);
    const skipped = fishcTest(dir, ["--no-doc"]);
    same(skipped.out, "no tests found\n", "--no-doc runs none");
  } finally {
    removed(root);
  }
});

test("fishc doc writes an index and a page per module, with signatures, comments and examples", () => {
  const root = scratch("fish-doc-");
  try {
    const dir = pkg(root, "site", [["src/main.fsh", "function main() {}\n"], ["src/lib.fsh", documentedLib()]]);
    const run = spawnSync(fishcPath(), ["doc"], { cwd: dir });
    assert(run.status === 0, `fishc doc: ${text(run.stderr)}`);
    same(text(run.stdout), "wrote 2 module pages and an index to build/doc\n", "its report");
    const page = read(join(dir, "build", "doc", "src_lib.html"));
    assert(page.includes('id="add"') && page.includes("export function add(a: i64, b: i64): i64") && page.includes("<p>Adds two numbers.</p>") && page.includes("console.log(add(1, 2));"), page);
    const index = read(join(dir, "build", "doc", "index.html"));
    assert(index.includes('<a href="src_lib.html">src/lib.fsh</a>') && index.includes('["twice","function","src_lib.html#twice"]'), index);
  } finally {
    removed(root);
  }
});
