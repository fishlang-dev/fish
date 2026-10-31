import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTests } from "../src/main.ts";
import { runTests, type Test } from "../src/tests.ts";
import { newSession } from "../src/compilation.ts";

const session = newSession();

// Each test builds a package's tests and runs them.
setDefaultTimeout(30_000);

const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const root = realpathSync(mkdtempSync(join(tmpdir(), "fish-test-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// Runs `fishc test` with `args` in the directory `cwd`.
function fishc(cwd: string, ...args: string[]) {
  const run = Bun.spawnSync(["bun", MAIN, "test", ...args], { cwd });
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
}

// A package under the test's root holding `files` beside its manifest.
function pkg(name: string, files: Record<string, string>): string {
  const at = join(root, name);
  for (const [path, text] of Object.entries({ "fish.toml": `[package]\nname = "${name}"\nversion = "0.1.0"\n`, ...files })) {
    mkdirSync(join(at, path, ".."), { recursive: true });
    writeFileSync(join(at, path), text);
  }
  return at;
}

const MIXED = `function main() {}
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

test("each test runs in its own process and is reported in order, a hung one failed after the limit", () => {
  const { code, out } = fishc(pkg("mixed", { "src/main.fsh": MIXED }));
  expect(out).toBe(
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
  );
  expect(code).toBe(1);
}, 60_000);

const PASSING = `function main() {}
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

test("a package whose tests all pass exits 0", () => {
  expect(fishc(pkg("passing", { "src/main.fsh": PASSING }))).toEqual({ code: 0, out: "ok src/main.fsh > adds\nok src/main.fsh > adds again\nok src/main.fsh > subtracts\n3 passed, 0 failed\n", err: "" });
});

test("a filter runs only the tests whose name holds it, and one matching none exits 1", () => {
  const dir = pkg("filtered", { "src/main.fsh": PASSING });
  expect(fishc(dir, "adds")).toEqual({ code: 0, out: "ok src/main.fsh > adds\nok src/main.fsh > adds again\n2 passed, 0 failed\n", err: "" });
  expect(fishc(dir, "multiplies")).toEqual({ code: 1, out: "", err: "fishc test: no test's name contains 'multiplies'\n" });
  expect(fishc(dir, "a", "b").code).toBe(2);
});

test("the test program lists its tests and runs one by its index", () => {
  const out = join(mkdtempSync(join(root, "bin-")), "tests");
  const tests = buildTests(session, pkg("listed", { "src/main.fsh": PASSING }), out);
  expect(tests.map((t) => t.name)).toEqual(["adds", "adds again", "subtracts"]);
  expect(Bun.spawnSync([out, "--list"]).stdout.toString()).toBe("adds\nadds again\nsubtracts\n");
  expect(Bun.spawnSync([out, "1"]).exitCode).toBe(0);
  expect(Bun.spawnSync([out, "9"]).exitCode).toBe(2);
});

test("a package with no tests says so and exits 0", () => {
  expect(fishc(pkg("untested", { "src/main.fsh": "function main() {}\n" }))).toEqual({ code: 0, out: "no tests found\n", err: "" });
});

test("a compile error in a test is reported as a build reports it", () => {
  const { code, out, err } = fishc(pkg("broken", { "src/main.fsh": 'function main() {}\ntest("typed", () => {\n  const n: i64 = "two";\n});\n' }));
  expect(code).toBe(1);
  expect(out).toBe("");
  expect(err).toBe(`src/main.fsh:3:18: error[E0101]: type '"two"' is not assignable to type 'i64'\n 3 |   const n: i64 = "two";\n   |                  ^^^^^\n`);
});

test("outside a package, fishc test says where it runs", () => {
  const dir = join(root, "loose");
  mkdirSync(dir);
  const { code, err } = fishc(dir);
  expect(code).toBe(2);
  expect(err).toContain("tests run inside a package");
});

test("tests in every file of the package are found and run, each reported with its file", () => {
  const dir = pkg("several", {
    "src/main.fsh": 'import { greet } from "./lib.fsh";\nfunction main() {\n  console.log(greet("you"));\n}\ntest("main greets", () => {\n  assert(greet("a") === "hello a");\n});\n',
    "src/lib.fsh": 'import { twice } from "./util/math.fsh";\nexport function greet(name: string): string {\n  return `hello ${name}`;\n}\nfunction shout(s: string): string {\n  return s.toUpperCase();\n}\ntest("lib calls its own function", () => {\n  assert(shout("a") === "A");\n});\ntest("lib calls an imported one", () => {\n  assert(twice(2) === 4);\n});\n',
    "src/util/math.fsh": 'export function twice(n: i64): i64 {\n  return n * 2;\n}\ntest("twice", () => {\n  assert(twice(3) === 6);\n});\n',
    "tools/unused.fsh": 'function main() {\n  console.log("a file nothing imports, with its own main");\n}\ntest("found anyway", () => {});\n',
    "target/debug/stale.fsh": 'test("build output", () => {\n  assert(false);\n});\n',
    "node_modules/dep/index.fsh": 'test("a dependency", () => {\n  assert(false);\n});\n',
    ".hidden/x.fsh": 'test("hidden", () => {\n  assert(false);\n});\n',
    "nested/fish.toml": '[package]\nname = "nested"\nversion = "0.1.0"\n',
    "nested/src/main.fsh": 'function main() {}\ntest("a nested package", () => {\n  assert(false);\n});\n',
  });
  expect(fishc(dir)).toEqual({
    code: 0,
    out: ["ok src/lib.fsh > lib calls its own function", "ok src/lib.fsh > lib calls an imported one", "ok src/main.fsh > main greets", "ok src/util/math.fsh > twice", "ok tools/unused.fsh > found anyway", "5 passed, 0 failed", ""].join("\n"),
    err: "",
  });
  // The package's own build still runs its main, and leaves its tests out.
  const built = Bun.spawnSync(["bun", MAIN, "build"], { cwd: dir });
  expect(built.exitCode).toBe(0);
  expect(Bun.spawnSync([join(dir, "target", "debug", "several")]).stdout.toString()).toBe("hello you\n");
});

test("a test name used twice in a package is refused at its second use", () => {
  const dir = pkg("twice", {
    "src/a.fsh": 'test("same", () => {});\n',
    "src/b.fsh": 'function helper() {}\ntest("same", () => {});\n',
  });
  const { code, err } = fishc(dir);
  expect(code).toBe(1);
  expect(err).toBe(`src/b.fsh:2:6: error[E1106]: there is already a test named 'same' in 'src/a.fsh'; give each test a name of its own\n 2 | test("same", () => {});\n   |      ^^^^^^\n`);
});

const SYSTEM = "declare function system(command: Ptr<u8>): i32;\nfunction main() {}\n";

test("a child a test leaves running neither holds up its verdict nor outlives it", () => {
  const dir = pkg("children", {
    "src/main.fsh": `${SYSTEM}test("leaves a child behind", () => {\n  unsafe { system(cString("sleep 30 &")); }\n});\ntest("waits on a child past the limit", () => {\n  unsafe { system(cString("sleep 25")); }\n});\n`,
  });
  const started = Date.now();
  const { code, out } = fishc(dir);
  expect(Date.now() - started).toBeLessThan(20_000);
  expect(out).toBe("ok src/main.fsh > leaves a child behind\nFAIL src/main.fsh > waits on a child past the limit\ntimed out after 10s\n1 passed, 1 failed\n");
  expect(code).toBe(1);
  expect(Bun.spawnSync(["pgrep", "-f", "sleep (30|25)$"]).stdout.toString()).toBe("");
}, 30_000);

test("stopped by SIGTERM, fishc test ends its tests and removes its build", async () => {
  const dir = pkg("stopped", { "src/main.fsh": 'function main() {}\ntest("spins", () => {\n  while (true) {}\n});\n' });
  const temp = mkdtempSync(join(root, "tmp-"));
  const child = Bun.spawn(["bun", MAIN, "test"], { cwd: dir, env: { ...process.env, TMPDIR: temp }, stdout: "pipe", stderr: "pipe" });
  // The test program, built in the temporary directory, running its one test.
  const spinning = () => Bun.spawnSync(["pgrep", "-f", `${temp}/fishc-test-[^/]*/tests 0$`]).stdout.toString().trim() !== "";
  for (let waited = 0; !spinning() && waited < 15_000; waited += 100) await Bun.sleep(100);
  expect(spinning()).toBe(true);
  child.kill("SIGTERM");
  expect(await child.exited).toBe(143);
  await Bun.sleep(100);
  expect(spinning()).toBe(false);
  expect(readdirSync(temp)).toEqual([]);
}, 30_000);

test("a test calling its file's main reaches it", () => {
  const dir = pkg("callsmain", { "src/main.fsh": 'function main() {\n  console.log("hello");\n}\ntest("main runs", () => {\n  main();\n  assert(false);\n});\n' });
  expect(fishc(dir).out).toBe("FAIL src/main.fsh > main runs\nhello\npanicked at src/main.fsh:6:3:\nassertion failed: false\nstack backtrace:\n   0: test \"main runs\" at src/main.fsh:6:3\n0 passed, 1 failed\n");
});

test("a failing test with no output is told by its exit code or signal", () => {
  const dir = pkg("silent", {
    "src/main.fsh": `${SYSTEM}test("exits", () => {\n  process.exit(3);\n});\ntest("is killed", () => {\n  unsafe { system(cString("kill -9 $PPID")); }\n});\n`,
  });
  expect(fishc(dir).out).toBe("FAIL src/main.fsh > exits\nexited with 3\nFAIL src/main.fsh > is killed\nkilled by SIGKILL\n0 passed, 2 failed\n");
});

test("a diagnostic names a test as the test, and --panic=abort is refused", () => {
  const dir = pkg("named", { "src/main.fsh": 'class Oops {}\nfunction main() {}\ntest("throws its own", () => {\n  throw new Oops();\n});\n' });
  expect(fishc(dir).err).toContain("which isn't the 'Error' that the test 'throws its own' throws");
  const aborting = fishc(dir, "--panic=abort");
  expect(aborting.code).toBe(2);
  expect(aborting.err).toBe("usage: fishc test [<filter>]\n");
});

test("a test that can't be started fails rather than stalling the report", async () => {
  const tests = [{ name: "missing", index: 0, async: false, module: { file: "a.fsh" } }] as unknown as Test[];
  const written: string[] = [];
  const [write, log] = [process.stdout.write, console.log];
  process.stdout.write = ((s: string) => written.push(s) > 0) as typeof process.stdout.write;
  console.log = (s: string) => void written.push(`${s}\n`);
  try {
    expect(await runTests(new Set(), join(root, "no-such-binary"), tests, root)).toBe(1);
  } finally {
    [process.stdout.write, console.log] = [write, log];
  }
  expect(written.join("")).toStartWith("FAIL a.fsh > missing\nthe test couldn't be run:");
});
