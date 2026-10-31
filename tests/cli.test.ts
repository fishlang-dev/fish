import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test builds programs, and links the Math runtime into each.
setDefaultTimeout(30_000);

const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const root = realpathSync(mkdtempSync(join(tmpdir(), "fish-cli-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// Runs `fishc` with `args` in the directory `cwd`.
function fishc(cwd: string, ...args: string[]) {
  const run = Bun.spawnSync(["bun", MAIN, ...args], { cwd });
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
}

// A directory under the test's root holding `files`.
function dir(name: string, files: Record<string, string> = {}): string {
  const at = join(root, name);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(at, path, ".."), { recursive: true });
    writeFileSync(join(at, path), text);
  }
  mkdirSync(at, { recursive: true });
  return at;
}

const ran = (file: string) => Bun.spawnSync([file]).stdout.toString();

test("fishc build with no file builds the package around the working directory into target", () => {
  const p = dir("app", { "fish.toml": `[package]\nname = "app"\nversion = "0.1.0"\n`, "src/main.fsh": `function main() { console.log("from app"); }\n` });
  expect(fishc(p, "build")).toEqual({ code: 0, out: "", err: "" });
  expect(ran(join(p, "target", "debug", "app"))).toBe("from app\n");
  expect(fishc(join(p, "src"), "build", "--release").code).toBe(0);
  expect(ran(join(p, "target", "release", "app"))).toBe("from app\n");
  expect(fishc(p, "build", "-o", "elsewhere").code).toBe(0);
  expect(ran(join(p, "elsewhere"))).toBe("from app\n");
});

test("a package's entry and its errors are found through the manifest", () => {
  const p = dir("entry", { "fish.toml": `[package]\nname = "entry"\nversion = "1.0.0"\nentry = "app/start.fsh"\n`, "app/start.fsh": `function main() { const x: i64 = "no"; }\n` });
  const bad = fishc(p, "build");
  expect([bad.code, bad.err.split("\n")[0]]).toEqual([1, `app/start.fsh:1:34: error: type '"no"' is not assignable to type 'i64'`]);
  const gone = dir("gone", { "fish.toml": `[package]\nname = "gone"\nversion = "1.0.0"\nentry = "src/app.fsh"\n` });
  expect(fishc(gone, "build").err.split("\n")[0]).toBe(`fish.toml:4:9: error[E0905]: the entry 'src/app.fsh' doesn't exist; create it, or name another with entry = "..."`);
  const typo = dir("typo", { "fish.toml": `[package]\nname = "typo"\nverison = "1.0.0"\n` });
  expect(fishc(join(typo), "build").err.split("\n")[0]).toBe("fish.toml:3:1: error[E0905]: [package] has no key 'verison'; it has name, version, entry, lib, edition");
});

test("fishc build with no file and no package says how to make one", () => {
  const none = dir("none");
  expect(existsSync(join(root, "fish.toml"))).toBe(false);
  expect(fishc(none, "build")).toEqual({ code: 2, out: "", err: "fishc build: no fish.toml here or in any directory above; give a file to build, or make a package with 'fishc new <name>' or 'fishc init'\n" });
});

test("fishc new makes a package that builds and greets", () => {
  const here = dir("news");
  expect(fishc(here, "new", "hello")).toEqual({ code: 0, out: "created the package 'hello' in hello/\n", err: "" });
  const p = join(here, "hello");
  expect(Bun.file(join(p, "fish.toml")).size).toBeGreaterThan(0);
  expect(Bun.spawnSync(["cat", join(p, ".gitignore")]).stdout.toString()).toBe("/target\n");
  expect(fishc(p, "build").code).toBe(0);
  expect(ran(join(p, "target", "debug", "hello"))).toBe("Hello from hello!\n");
});

test("fishc init makes a package where it is run, keeping code already there", () => {
  const fresh = dir("tool");
  expect(fishc(fresh, "init")).toEqual({ code: 0, out: "created the package 'tool'\n", err: "" });
  expect(fishc(fresh, "build").code).toBe(0);
  expect(ran(join(fresh, "target", "debug", "tool"))).toBe("Hello from tool!\n");
  const existing = dir("existing", { "src/main.fsh": `function main() { console.log("mine"); }\n`, ".gitignore": "/out\n" });
  expect(fishc(existing, "init", "kept").code).toBe(0);
  expect(fishc(existing, "build").code).toBe(0);
  expect(ran(join(existing, "target", "debug", "kept"))).toBe("mine\n");
  expect(Bun.spawnSync(["cat", join(existing, ".gitignore")]).stdout.toString()).toBe("/out\n");
});

test("new and init refuse bad names and overwriting", () => {
  const here = dir("refusals", { "taken/file.txt": "x" });
  const rule = "a package name is lowercase letters, digits and '-', starting with a letter, at most 64 characters";
  expect(fishc(here, "new", "Bad_Name")).toEqual({ code: 2, out: "", err: `fishc new: 'Bad_Name' isn't a package name: ${rule}\n` });
  expect(fishc(here, "new", "taken").err).toBe("fishc new: 'taken' already exists and isn't empty; choose another name, or run 'fishc init' inside it\n");
  expect(fishc(here, "new").code).toBe(2);
  const odd = dir("Odd Dir");
  expect(fishc(odd, "init").err).toBe(`fishc init: this directory's name 'Odd Dir' isn't a package name: ${rule}; give one, as in 'fishc init my-app'\n`);
  expect(fishc(odd, "init", "odd").code).toBe(0);
  expect(fishc(odd, "init", "odd")).toEqual({ code: 2, out: "", err: "fishc init: there is already a fish.toml here\n" });
});

const COMPAT = "this file is in the TS-compat edition, which Fish doesn't compile; run 'fishc lint' to find what to change, then mark it '// @fish-edition native'";
const manifestOf = (name: string, extra = "") => `[package]\nname = "${name}"\nversion = "0.1.0"\n${extra}\n[dependencies]\n`;

test("a TS-compat package's files are refused by build and test, at each file's first line", () => {
  const pkg = dir("compat-pkg", { "fish.toml": manifestOf("compat-pkg", 'edition = "ts-compat"\n'), "src/main.fsh": 'function main() {\n  console.log("hi");\n}\n' });
  expect(fishc(pkg, "build")).toEqual({ code: 1, out: "", err: `src/main.fsh:1:1: error[E0006]: ${COMPAT}\n 1 | function main() {\n   | ^^^^^^^^^^^^^^^^^\n` });
  const tested = Bun.spawnSync(["bun", MAIN, "test"], { cwd: pkg });
  expect(tested.exitCode).toBe(1);
  expect(tested.stderr.toString()).toBe(`src/main.fsh:1:1: error[E0006]: ${COMPAT}\n 1 | function main() {\n   | ^^^^^^^^^^^^^^^^^\n`);
});

test("a file's directive sets its edition, over its package's, after any shebang", () => {
  const pkg = dir("directives", {
    "fish.toml": manifestOf("directives", 'edition = "ts-compat"\n'),
    "src/main.fsh": '#!/usr/bin/env fishc\n// @fish-edition native\nimport { two } from "./two.fsh";\nfunction main() {\n  console.log(two());\n}\n',
    "src/two.fsh": "// @fish-edition native\nexport function two(): i64 {\n  return 2;\n}\n",
  });
  expect(fishc(pkg, "build").code).toBe(0);
  expect(ran(join(pkg, "target", "debug", "directives"))).toBe("2\n");
  // An imported file marked TS-compat is refused at its directive, in a native package too.
  const mixed = dir("mixed-editions", {
    "main.fsh": 'import { two } from "./two.fsh";\nfunction main() {\n  console.log(two());\n}\n',
    "two.fsh": "// @fish-edition ts-compat\nexport function two(): i64 {\n  return 2;\n}\n",
  });
  expect(fishc(mixed, "build", "main.fsh")).toEqual({ code: 1, out: "", err: `two.fsh:1:1: error[E0006]: ${COMPAT}\n 1 | // @fish-edition ts-compat\n   | ^^^^^^^^^^^^^^^^^^^^^^^^^^\n` });
  const unknown = dir("unknown-edition", { "main.fsh": "#!/usr/bin/env fishc\n// @fish-edition typescript\nfunction main() {}\n" });
  expect(fishc(unknown, "build", "main.fsh")).toEqual({ code: 1, out: "", err: "main.fsh:2:1: error[E0005]: an edition directive is written '// @fish-edition native' or '// @fish-edition ts-compat'\n 2 | // @fish-edition typescript\n   | ^^^^^^^^^^^^^^^^^^^^^^^^^^^\n" });
});

test("a dependency's TS-compat file is refused where the dependency is built", () => {
  dir("compat-dep/words", { "fish.toml": manifestOf("words", 'edition = "ts-compat"\n'), "src/lib.fsh": 'export function word(): string {\n  return "fish";\n}\n' });
  const app = dir("compat-dep/app", { "fish.toml": manifestOf("app", "").replace("[dependencies]\n", '[dependencies]\nwords = { path = "../words" }\n'), "src/main.fsh": 'import { word } from "words";\nfunction main() {\n  console.log(word());\n}\n' });
  const { code, err } = fishc(app, "build");
  expect(code).toBe(1);
  expect(err).toBe(`../../words/src/lib.fsh:1:1: error[E0006]: ${COMPAT}\n 1 | export function word(): string {\n   | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n`);
});

test("only a debug build keeps frames for panic backtraces", () => {
  const at = dir("backtrace-frames", { "main.fsh": "function twice(n: i64): i64 {\n  return n * 2;\n}\nfunction main() {\n  console.log(twice(3));\n}\n" });
  const debug = fishc(at, "build", "main.fsh", "--emit-llvm");
  expect(debug.code).toBe(0);
  expect(debug.out).toContain("store ptr %fsh.site, ptr @fsh_rt_frames");
  const release = fishc(at, "build", "main.fsh", "--release", "--emit-llvm");
  expect(release.code).toBe(0);
  expect(release.out).not.toMatch(/fsh_rt_frames|%fsh\.(site|name|link|prev)/);
});

test("fishc check checks a file or package without building, exiting 1 on an error", () => {
  const p = dir("checked", { "fish.toml": `[package]\nname = "checked"\nversion = "0.1.0"\n`, "src/main.fsh": `function main() { console.log("ok"); }\n`, "bad.fsh": `function main() {\n  const n: i64 = "no";\n}\n` });
  expect(fishc(p, "check")).toEqual({ code: 0, out: "", err: "" });
  expect(fishc(p, "check", "src/main.fsh")).toEqual({ code: 0, out: "", err: "" });
  expect(existsSync(join(p, "target"))).toBe(false);
  const bad = fishc(p, "check", "bad.fsh");
  expect(bad.code).toBe(1);
  expect(bad.err).toBe(fishc(p, "build", "bad.fsh").err);
  expect(bad.err).toContain("bad.fsh:2:18: error:");
});

test("fishc run builds and runs a program with its arguments and exit code", () => {
  const program = `import { argv, exit } from "node:process";\nfunction main() {\n  const args = argv();\n  console.log(args.slice(2).join(","));\n  if (args.length > 3) exit(3);\n}\n`;
  const p = dir("runs", { "fish.toml": `[package]\nname = "runs"\nversion = "0.1.0"\n`, "src/main.fsh": program, "one.fsh": program, "bad.fsh": `function main() {\n  const n: i64 = "no";\n}\n` });
  expect(fishc(p, "run", "one.fsh", "a")).toEqual({ code: 0, out: "a\n", err: "" });
  expect(fishc(p, "run", "one.fsh", "--", "a", "--flag")).toEqual({ code: 3, out: "a,--flag\n", err: "" });
  expect(fishc(p, "run", "--", "x")).toEqual({ code: 0, out: "x\n", err: "" });
  expect(existsSync(join(p, "target", "debug", "runs"))).toBe(true);
  const bad = fishc(p, "run", "bad.fsh");
  expect(bad.code).toBe(1);
  expect(bad.out).toBe("");
  expect(bad.err).toContain("error:");
});
