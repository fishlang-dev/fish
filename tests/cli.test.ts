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
  expect(fishc(gone, "build").err.split("\n")[0]).toBe(`fish.toml:4:9: error: the entry 'src/app.fsh' doesn't exist; create it, or name another with entry = "..."`);
  const typo = dir("typo", { "fish.toml": `[package]\nname = "typo"\nverison = "1.0.0"\n` });
  expect(fishc(join(typo), "build").err.split("\n")[0]).toBe("fish.toml:3:1: error: [package] has no key 'verison'; it has name, version, entry, lib");
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
