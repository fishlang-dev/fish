import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test builds programs, and links the Math runtime into each.
setDefaultTimeout(30_000);

const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const root = realpathSync(mkdtempSync(join(tmpdir(), "fish-deps-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// Runs `fishc` with `args` in `cwd`, giving the exit code and the first line of stderr.
function fishc(cwd: string, ...args: string[]) {
  const run = Bun.spawnSync(["bun", MAIN, ...args], { cwd });
  return { code: run.exitCode, err: run.stderr.toString().split("\n")[0]! };
}

// Writes `files` under `name` in the test's root, giving the directory.
function files(name: string, all: Record<string, string>): string {
  const at = join(root, name);
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(join(at, path, ".."), { recursive: true });
    writeFileSync(join(at, path), text);
  }
  return at;
}

const manifest = (name: string, deps = "") => `[package]\nname = "${name}"\nversion = "0.1.0"\n[dependencies]\n${deps}`;
const ran = (file: string) => Bun.spawnSync([file]).stdout.toString();

test("a path dependency is imported by name, with its own dependencies, from fishc build or a file in the package", () => {
  files("one/words", { "fish.toml": manifest("words"), "src/lib.fsh": `export function word(): string { return "fish"; }\n` });
  files("one/greet", { "fish.toml": manifest("greet", `words = { path = "../words" }\n`), "src/lib.fsh": `import { word } from "words";\nexport function greet(): string { return "hello " + word(); }\n` });
  const app = files("one/app", { "fish.toml": manifest("app", `greet = { path = "../greet" }\n`), "src/main.fsh": `import { greet } from "greet";\nfunction main() { console.log(greet()); }\n` });
  expect(fishc(app, "build")).toEqual({ code: 0, err: "" });
  expect(ran(join(app, "target", "debug", "app"))).toBe("hello fish\n");
  expect(fishc(app, "build", "src/main.fsh", "-o", "direct").code).toBe(0);
  expect(ran(join(app, "direct"))).toBe("hello fish\n");
});

test("two packages depending on a third from the same path share it, and one name can't come from two places", () => {
  files("two/base", { "fish.toml": manifest("base"), "src/lib.fsh": `export function n(): i64 { return 2; }\n` });
  files("two/left", { "fish.toml": manifest("left", `base = { path = "../base" }\n`), "src/lib.fsh": `import { n } from "base";\nexport function l(): i64 { return n(); }\n` });
  files("two/right", { "fish.toml": manifest("right", `base = { path = "../base" }\n`), "src/lib.fsh": `import { n } from "base";\nexport function r(): i64 { return n() * 10; }\n` });
  const app = files("two/app", { "fish.toml": manifest("app", `left = { path = "../left" }\nright = { path = "../right" }\n`), "src/main.fsh": `import { l } from "left";\nimport { r } from "right";\nfunction main() { console.log(l() + r()); }\n` });
  expect(fishc(app, "build")).toEqual({ code: 0, err: "" });
  expect(ran(join(app, "target", "debug", "app"))).toBe("22\n");
  files("two/base2", { "fish.toml": manifest("base"), "src/lib.fsh": `export function n(): i64 { return 3; }\n` });
  files("two/odd", { "fish.toml": manifest("odd", `base = { path = "../base2" }\n`), "src/lib.fsh": `export function o(): i64 { return 1; }\n` });
  const clash = files("two/clash", { "fish.toml": manifest("clash", `left = { path = "../left" }\nodd = { path = "../odd" }\n`), "src/main.fsh": `function main() {}\n` });
  expect(fishc(clash, "build").err).toBe("../odd/fish.toml:5:1: error[E0906]: 'base' already comes from '../base' in this program, so it can't also come from '../base2'");
});

test("a dependency that can't be used is refused where it is named", () => {
  files("bad/nolib", { "fish.toml": manifest("nolib") });
  files("bad/named", { "fish.toml": manifest("other"), "src/lib.fsh": "" });
  files("bad/plain", { "x.fsh": "" });
  files("bad/a", { "fish.toml": manifest("a", `b = { path = "../b" }\n`), "src/lib.fsh": "" });
  files("bad/b", { "fish.toml": manifest("b", `a = { path = "../a" }\n`), "src/lib.fsh": "" });
  const app = (deps: string) => files("bad/app", { "fish.toml": manifest("app", deps), "src/main.fsh": `function main() {}\n` });
  expect(fishc(app(`util = { path = "../nowhere" }\n`), "build").err).toBe("fish.toml:5:1: error[E0906]: can't find the directory '../nowhere' for 'util'");
  expect(fishc(app(`plain = { path = "../plain" }\n`), "build").err).toBe("fish.toml:5:1: error[E0906]: '../plain' has no fish.toml, so it isn't a Fish package");
  expect(fishc(app(`named = { path = "../named" }\n`), "build").err).toBe("fish.toml:5:1: error[E0906]: the package at '../named' is named 'other' in its fish.toml, not 'named'; depend on it by that name");
  expect(fishc(app(`nolib = { path = "../nolib" }\n`), "build").err).toBe(`../nolib/fish.toml:1:1: error[E0905]: the lib 'src/lib.fsh' doesn't exist; create it, or name another with lib = "..."`);
  expect(fishc(app(`a = { path = "../a" }\n`), "build").err).toBe("../b/fish.toml:5:1: error[E0906]: 'a' depends back on 'b': a -> b -> a; packages can't depend on each other in a cycle");
});

test("a package's lib is public, its other files' exports are package-private, and unexported names are file-private", () => {
  const util = `function clean(s: string): string { return s.trim(); }\nexport function slug(s: string): string { return clean(s).toLowerCase(); }\nexport function upper(s: string): string { return clean(s).toUpperCase(); }\n`;
  const words = (lib: string) => files("levels/words", { "fish.toml": manifest("words"), "src/util.fsh": util, "src/lib.fsh": lib });
  const lib = `import { slug } from "./util";\nexport { upper } from "./util";\nexport function title(s: string): string { return "[" + slug(s) + "]"; }\n`;
  words(lib);
  const app = (main: string) => files("levels/app", { "fish.toml": manifest("app", `words = { path = "../words" }\n`), "src/main.fsh": main });
  const ok = app(`import { title, upper } from "words";\nfunction main() { console.log(title(" Fish ")); console.log(upper(" fish ")); }\n`);
  expect(fishc(ok, "build")).toEqual({ code: 0, err: "" });
  expect(ran(join(ok, "target", "debug", "app"))).toBe("[fish]\nFISH\n");
  expect(fishc(app(`import { slug } from "words";\nfunction main() { console.log(slug("x")); }\n`), "build").err).toBe("src/main.fsh:1:10: error[E0903]: 'slug' is private to the package 'words'; only what its lib src/lib.fsh exports is public");
  expect(fishc(app(`import { nope } from "words";\nfunction main() {}\n`), "build").err).toBe("src/main.fsh:1:10: error[E0902]: the package 'words' has no export named 'nope' in its lib src/lib.fsh");
  expect(fishc(app(`import d from "words";\nfunction main() {}\n`), "build").err).toBe("src/main.fsh:1:1: error[E0902]: the package 'words' has no default export in its lib src/lib.fsh");
  words(`import { clean } from "./util";\nexport function title(s: string): string { return clean(s); }\n`);
  expect(fishc(app(`import { title } from "words";\nfunction main() { console.log(title("x")); }\n`), "build").err).toBe("../../words/src/lib.fsh:1:10: error[E0902]: '../../words/src/util.fsh' has no export named 'clean'; it declares 'clean' without exporting it, so add 'export' before that declaration");
});

test("a lib or entry can't be a nested package's file, and packages nested in each other keep their own messages", () => {
  const deep = { "deep/fish.toml": manifest("deep"), "deep/src/lib.fsh": `export function pub(): i64 { return 1; }\n`, "deep/src/inner.fsh": `export function secret(): i64 { return 42; }\n` };
  const outer = (lib: string, extra = "") => files("own/outer", { "fish.toml": `[package]\nname = "outer"\nversion = "0.1.0"\n${extra}[dependencies]\ndeep = { path = "./deep" }\n`, ...deep, "src/lib.fsh": lib });
  const app = (main: string) => files("own/app", { "fish.toml": manifest("app", `outer = { path = "../outer" }\n`), "src/main.fsh": main });
  outer("", `lib = "deep/src/inner.fsh"\n`);
  expect(fishc(app(`import { secret } from "outer";\nfunction main() { console.log(secret()); }\n`), "build").err).toBe("../outer/fish.toml:4:7: error[E0905]: the lib 'deep/src/inner.fsh' is a file inside the package 'deep'; a package's lib is one of its own files");
  outer(`import { pub } from "deep";\nexport function o(): i64 { return pub(); }\n`);
  expect(fishc(app(`import { pub } from "outer";\nfunction main() { console.log(pub()); }\n`), "build").err).toBe("src/main.fsh:1:10: error[E0902]: the package 'outer' has no export named 'pub' in its lib src/lib.fsh");
  const entry = files("own/entry", { "fish.toml": `[package]\nname = "entry"\nversion = "0.1.0"\nentry = "deep/src/m.fsh"\n[dependencies]\ndeep = { path = "./deep" }\n`, ...deep, "deep/src/m.fsh": `import { secret } from "./inner";\nfunction main() { console.log(secret()); }\n` });
  expect(fishc(entry, "build").err).toBe("fish.toml:4:9: error[E0905]: the entry 'deep/src/m.fsh' is a file inside the package 'deep'; a package's entry is one of its own files");
  const linkedEntry = files("own/linked-entry", { "fish.toml": `[package]\nname = "linked"\nversion = "0.1.0"\nentry = "src/d/m.fsh"\n[dependencies]\ndeep = { path = "./deep" }\n`, ...deep, "deep/src/m.fsh": `import { secret } from "./inner";\nfunction main() { console.log(secret()); }\n` });
  mkdirSync(join(linkedEntry, "src"), { recursive: true });
  Bun.spawnSync(["ln", "-sfn", "../deep/src", join(linkedEntry, "src", "d")]);
  expect(fishc(linkedEntry, "build").err).toBe("fish.toml:4:9: error[E0905]: the entry 'src/d/m.fsh' is a file inside the package 'deep'; a package's entry is one of its own files");
  const w = files("own/w", { "fish.toml": manifest("w"), "src/lib.fsh": `import { helper } from "./util";\nexport function pub(): i64 { return helper(); }\n`, "src/util.fsh": `export function helper(): i64 { return 7; }\n`, "examples/ex/fish.toml": manifest("ex", `w = { path = "../.." }\n`), "examples/ex/src/main.fsh": `import { helper } from "w";\nfunction main() { console.log(helper()); }\n` });
  expect(fishc(join(w, "examples", "ex"), "build").err).toBe("src/main.fsh:1:10: error[E0903]: 'helper' is private to the package 'w'; only what its lib src/lib.fsh exports is public");
});

test("a relative import into another package's directory is refused, directly or through a link", () => {
  const util = { "fish.toml": manifest("util"), "src/lib.fsh": `export function u(): i64 { return 1; }\n`, "src/inner.fsh": `export function i(): i64 { return 2; }\n` };
  const nested = (main: string) => files("nest/app", { "fish.toml": manifest("app", `util = { path = "./packages/util" }\n`), ...Object.fromEntries(Object.entries(util).map(([k, v]) => [`packages/util/${k}`, v])), "vendor/loose/fish.toml": manifest("loose"), "vendor/loose/x.fsh": `export function x(): i64 { return 3; }\n`, "src/main.fsh": main });
  expect(fishc(nested(`import { i } from "../packages/util/src/inner";\nfunction main() { console.log(i()); }\n`), "build").err).toBe("src/main.fsh:1:1: error[E0903]: '../packages/util/src/inner' is a file inside the package 'util'; import it by name, as 'util'");
  const linked = nested(`import { i } from "./link/inner";\nfunction main() { console.log(i()); }\n`);
  Bun.spawnSync(["ln", "-sfn", "../packages/util/src", join(linked, "src", "link")]);
  expect(fishc(linked, "build").err).toBe("src/main.fsh:1:1: error[E0903]: './link/inner' is a file inside the package 'util'; import it by name, as 'util'");
  const loose = nested(`import { x } from "../vendor/loose/x";\nimport { u } from "util";\nfunction main() { console.log(x() + u()); }\n`);
  expect(fishc(loose, "build")).toEqual({ code: 0, err: "" });
  expect(ran(join(loose, "target", "debug", "app"))).toBe("4\n");
  files("nest/outer", { "fish.toml": manifest("outer", `deep = { path = "./deep" }\n`), "deep/fish.toml": manifest("deep"), "deep/src/lib.fsh": "", "deep/src/x.fsh": `export function x(): i64 { return 5; }\n`, "src/lib.fsh": `import { x } from "../deep/src/x";\nexport function o(): i64 { return x(); }\n` });
  const top = files("nest/top", { "fish.toml": manifest("top", `outer = { path = "../outer" }\n`), "src/main.fsh": `import { o } from "outer";\nfunction main() { console.log(o()); }\n` });
  expect(fishc(top, "build").err).toBe("../../outer/src/lib.fsh:1:1: error[E0903]: '../deep/src/x' is a file inside the package 'deep'; import it by name, as 'deep'");
});

test("a dependency's inner files are private to it, by every import form, and a name not in fish.toml still reaches npm's packages", () => {
  files("sub/words", { "fish.toml": manifest("words"), "src/lib.fsh": `export function word(): string { return "w"; }\n`, "src/util.fsh": `export function w(): string { return "u"; }\nexport type W = { n: i64 };\n` });
  const rule = "'words/src/util' is a file inside the package 'words', and a package's files are private to it; import from 'words', which gives what its lib src/lib.fsh exports";
  for (const form of [`import { w } from "words/src/util";`, `import type { W } from "words/src/util";`, `export { w } from "words/src/util";`, `export * from "words/src/util";`]) {
    const app = files("sub/app", { "fish.toml": manifest("app", `words = { path = "../words" }\n`), "src/main.fsh": `${form}\nfunction main() {}\n` });
    expect([form, fishc(app, "build").err]).toEqual([form, `src/main.fsh:1:1: error[E0903]: ${rule}`]);
  }
  files("sub/mid", { "fish.toml": manifest("mid", `words = { path = "../words" }\n`), "src/lib.fsh": `import { w } from "words/src/util";\nexport function m(): string { return w(); }\n` });
  const top = files("sub/top", { "fish.toml": manifest("top", `mid = { path = "../mid" }\n`), "src/main.fsh": `import { m } from "mid";\nfunction main() { console.log(m()); }\n` });
  expect(fishc(top, "build").err).toBe(`../../mid/src/lib.fsh:1:1: error[E0903]: ${rule}`);
  const npm = files("sub/npm", { "fish.toml": manifest("npm"), "src/main.fsh": `import { x } from "nothing-installed";\nfunction main() {}\n` });
  expect(fishc(npm, "build").err).toContain("can't find the package 'nothing-installed'");
});

// A git repository at `name` holding `all`, committed, giving its directory and the commit.
function repository(name: string, all: Record<string, string>): [string, string] {
  const at = files(name, all);
  const git = (...args: string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: at }).stdout.toString().trim();
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "first");
  return [at, git("rev-parse", "HEAD")];
}

test("a git dependency pinned to a commit is fetched into the cache once, and read from there after", () => {
  const cache = join(root, "cache");
  const [repo, commit] = repository("git/words", { "fish.toml": manifest("words"), "src/lib.fsh": `export function word(): string { return "from git"; }\n` });
  const app = files("git/app", { "fish.toml": manifest("app", `words = { git = "file://${repo}", rev = "${commit.slice(0, 8)}" }\n`), "src/main.fsh": `import { word } from "words";\nfunction main() { console.log(word()); }\n` });
  const build = (env: Record<string, string> = {}) => {
    const run = Bun.spawnSync([process.execPath, MAIN, "build"], { cwd: app, env: { ...process.env, FISH_CACHE_DIR: cache, ...env } });
    return { code: run.exitCode, err: run.stderr.toString().split("\n")[0]! };
  };
  expect(build()).toEqual({ code: 0, err: "" });
  expect(ran(join(app, "target", "debug", "app"))).toBe("from git\n");
  rmSync(repo, { recursive: true, force: true });
  expect(build()).toEqual({ code: 0, err: "" });
  const other = (deps: string) => files("git/other", { "fish.toml": manifest("other", deps), "src/main.fsh": `function main() {}\n` });
  const gitless = (deps: string) => Bun.spawnSync([process.execPath, MAIN, "build"], { cwd: other(deps), env: { ...process.env, FISH_CACHE_DIR: join(root, "empty-cache"), PATH: "/nonexistent" } }).stderr.toString().split("\n")[0];
  expect(gitless(`w = { git = "file://${repo}", rev = "abcdef1" }\n`)).toBe(`fish.toml:5:1: error[E0906]: fetching 'file://${repo}' needs the git command, which isn't on PATH; install git`);
  const [repo2] = repository("git/second", { "fish.toml": manifest("second"), "src/lib.fsh": "" });
  const fetch = (deps: string) => Bun.spawnSync([process.execPath, MAIN, "build"], { cwd: other(deps), env: { ...process.env, FISH_CACHE_DIR: join(root, "empty-cache") } }).stderr.toString().split("\n")[0];
  expect(fetch(`second = { git = "file://${root}/git/nowhere", rev = "abcdef1" }\n`)).toStartWith(`fish.toml:5:1: error[E0906]: can't fetch 'file://${root}/git/nowhere': `);
  expect(fetch(`second = { git = "file://${repo2}", rev = "abcdef1" }\n`)).toBe(`fish.toml:5:1: error[E0906]: 'file://${repo2}' has no commit 'abcdef1'`);
});

test("fish.lock records every package, keeps itself when nothing changed, checks git files, and --locked holds it", () => {
  const cache = join(root, "lock-cache");
  const [repo, commit] = repository("lock/http", { "fish.toml": manifest("http"), "src/lib.fsh": `export function get(): string { return "ok"; }\n` });
  files("lock/util", { "fish.toml": manifest("util", `http = { git = "file://${repo}", rev = "${commit}" }\n`), "src/lib.fsh": `import { get } from "http";\nexport function u(): string { return get(); }\n` });
  const app = files("lock/app", { "fish.toml": manifest("app", `util = { path = "../util" }\n`), "src/main.fsh": `import { u } from "util";\nfunction main() { console.log(u()); }\n` });
  const build = (...args: string[]) => {
    const run = Bun.spawnSync([process.execPath, MAIN, "build", ...args], { cwd: app, env: { ...process.env, FISH_CACHE_DIR: cache } });
    return { code: run.exitCode, err: run.stderr.toString().split("\n")[0]! };
  };
  expect(build()).toEqual({ code: 0, err: "" });
  const lock = () => Bun.spawnSync(["cat", join(app, "fish.lock")]).stdout.toString();
  const written = lock();
  expect(written).toMatch(new RegExp(`^# Written by fishc build; it records exactly which packages a build used\\.\\nversion = 1\\n\\n\\[\\[package\\]\\]\\nname = "http"\\nsource = "git\\+file://${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}#${commit}"\\nchecksum = "sha256:[0-9a-f]{64}"\\n\\n\\[\\[package\\]\\]\\nname = "util"\\nsource = "path\\+\\.\\./util"\\n$`));
  expect(build("--locked")).toEqual({ code: 0, err: "" });
  expect(lock()).toBe(written);
  const cached = Bun.spawnSync(["find", cache, "-name", "lib.fsh", "-path", "*http*"]).stdout.toString().trim();
  writeFileSync(cached, `export function get(): string { return "tampered"; }\n`);
  expect(build().err).toMatch(/^fish\.lock:4:1: error\[E0906\]: the files of 'http' at .* no longer match its checksum in fish\.lock; delete that directory to fetch it again$/);
  writeFileSync(join(app, "fish.toml"), manifest("app", ""));
  writeFileSync(join(app, "src", "main.fsh"), `function main() {}\n`);
  expect(build("--locked").err).toBe("fish.lock:1:1: error[E0906]: fish.lock is out of date with fish.toml, and --locked keeps it as it is; build without --locked to update it, then commit it");
  expect(build()).toEqual({ code: 0, err: "" });
  expect(lock()).toBe("# Written by fishc build; it records exactly which packages a build used.\nversion = 1\n");
});

test("a dependency named like a Node built-in is that package, and node: still means the built-in", () => {
  files("builtin/util", { "fish.toml": manifest("util"), "src/lib.fsh": `export function mine(): string { return "mine"; }\n` });
  const app = files("builtin/app", { "fish.toml": manifest("app", `util = { path = "../util" }\n`), "src/main.fsh": `import { mine } from "util";\nimport { format } from "node:util";\nfunction main() { console.log(format("%s and std", mine())); }\n` });
  expect(fishc(app, "build")).toEqual({ code: 0, err: "" });
  expect(ran(join(app, "target", "debug", "app"))).toBe("mine and std\n");
});

// Builds the package at `dir` with its own cache, giving the exit code and stderr's first line.
function buildIn(dir: string, cache: string, env: Record<string, string> = {}, ...args: string[]) {
  const run = Bun.spawnSync([process.execPath, MAIN, "build", ...args], { cwd: dir, env: { ...process.env, FISH_CACHE_DIR: cache, ...env } });
  return { code: run.exitCode, err: run.stderr.toString().split("\n")[0]! };
}

// A repository's commit made with `git` run as `args` in it.
function gitIn(at: string, ...args: string[]): string {
  return Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: at }).stdout.toString().trim();
}

test("a git package holding a symbolic link is refused, and can't write through one", () => {
  const victim = files("attack/victim", { "target.txt": "SECRET" });
  const [evil] = repository("attack/evil", { "fish.toml": manifest("evil"), "src/lib.fsh": "" });
  Bun.spawnSync(["ln", "-s", join(victim, "target.txt"), join(evil, ".fish-commit")]);
  gitIn(evil, "add", ".");
  gitIn(evil, "commit", "-q", "-m", "link");
  const commit = gitIn(evil, "rev-parse", "HEAD");
  const app = files("attack/app", { "fish.toml": manifest("app", `evil = { git = "file://${evil}", rev = "${commit}" }\n`), "src/main.fsh": `function main() {}\n` });
  expect(buildIn(app, join(root, "attack-cache")).err).toBe(`fish.toml:5:1: error[E0906]: 'file://${evil}' holds a symbolic link at '.fish-commit'; a package from git can't, since a link reaches files its commit doesn't pin`);
  expect(Bun.spawnSync(["cat", join(victim, "target.txt")]).stdout.toString()).toBe("SECRET");
});

test("a git package can't reach outside its checkout through lib or a path dependency, nor a local lib through a link", () => {
  const [out] = repository("reach/out", { "fish.toml": `[package]\nname = "out"\nversion = "0.1.0"\nlib = "../../secret.fsh"\n`, "src/lib.fsh": "" });
  const [viaPath] = repository("reach/via", { "fish.toml": manifest("via", `local = { path = "/tmp" }\n`), "src/lib.fsh": "" });
  const app = (deps: string) => files("reach/app", { "fish.toml": manifest("app", deps), "src/main.fsh": `function main() {}\n` });
  const cache = join(root, "reach-cache");
  const head = (repo: string) => gitIn(repo, "rev-parse", "HEAD");
  expect(buildIn(app(`out = { git = "file://${out}", rev = "${head(out)}" }\n`), cache).err).toEndWith(`fish.toml:4:7: error[E0905]: the lib is a file inside the package, as in lib = "src/lib.fsh"`);
  expect(buildIn(app(`via = { git = "file://${viaPath}", rev = "${head(viaPath)}" }\n`), cache).err).toEndWith("fish.toml:5:1: error[E0906]: 'via' comes from git, so its dependencies must too; a path dependency would bring in files its commit doesn't pin");
  const outside = files("reach/elsewhere", { "lib.fsh": "" });
  files("reach/linked", { "fish.toml": manifest("linked"), "src/.keep": "" });
  Bun.spawnSync(["ln", "-s", join(outside, "lib.fsh"), join(root, "reach/linked/src/lib.fsh")]);
  expect(buildIn(app(`linked = { path = "../linked" }\n`), cache).err).toBe("../linked/fish.toml:1:1: error[E0905]: the lib 'src/lib.fsh' leads outside the package; it is a file inside it");
});

test("a short rev is the commit it starts, never a tag named like it, and short and full revs of one commit are one package", () => {
  const [repo, good] = repository("rev/repo", { "fish.toml": manifest("dep"), "src/lib.fsh": `export function v(): string { return "pinned"; }\n` });
  writeFileSync(join(repo, "src", "lib.fsh"), `export function v(): string { return "moved"; }\n`);
  gitIn(repo, "commit", "-q", "-am", "later");
  gitIn(repo, "tag", good.slice(0, 7));
  const cache = join(root, "rev-cache");
  const app = files("rev/app", { "fish.toml": manifest("app", `dep = { git = "file://${repo}", rev = "${good.slice(0, 7)}" }\n`), "src/main.fsh": `import { v } from "dep";\nfunction main() { console.log(v()); }\n` });
  expect(buildIn(app, cache)).toEqual({ code: 0, err: "" });
  expect(ran(join(app, "target", "debug", "app"))).toBe("pinned\n");
  files("rev/other", { "fish.toml": manifest("other", `dep = { git = "file://${repo}", rev = "${good}" }\n`), "src/lib.fsh": `import { v } from "dep";\nexport function o(): string { return v(); }\n` });
  const both = files("rev/both", { "fish.toml": manifest("both", `dep = { git = "file://${repo}", rev = "${good.slice(0, 7)}" }\nother = { path = "../other" }\n`), "src/main.fsh": `import { o } from "other";\nfunction main() { console.log(o()); }\n` });
  expect(buildIn(both, cache)).toEqual({ code: 0, err: "" });
  expect(ran(join(both, "target", "debug", "both"))).toBe("pinned\n");
});

test("a package can't depend on itself, a second route by another name is refused, and GIT_DIR doesn't reach the fetch", () => {
  const self = files("names/self", { "fish.toml": manifest("self", `me = { path = "." }\n`), "src/main.fsh": `function main() {}\n` });
  expect(fishc(self, "build").err).toBe("fish.toml:5:1: error[E0906]: 'me' depends back on 'self': self -> me; packages can't depend on each other in a cycle");
  files("names/util", { "fish.toml": manifest("util"), "src/lib.fsh": "" });
  files("names/b", { "fish.toml": manifest("b", `foo = { path = "../util" }\n`), "src/lib.fsh": "" });
  const app = files("names/app", { "fish.toml": manifest("app", `util = { path = "../util" }\nb = { path = "../b" }\n`), "src/main.fsh": `function main() {}\n` });
  expect(fishc(app, "build").err).toBe("../b/fish.toml:5:1: error[E0906]: the package at '../util' is named 'util' in its fish.toml, not 'foo'; depend on it by that name");
  const [repo, commit] = repository("names/repo", { "fish.toml": manifest("dep"), "src/lib.fsh": "" });
  const user = repository("names/user", { "x.txt": "x" })[0];
  const gitApp = files("names/gitapp", { "fish.toml": manifest("gitapp", `dep = { git = "file://${repo}", rev = "${commit}" }\n`), "src/main.fsh": `function main() {}\n` });
  expect(buildIn(gitApp, join(root, "names-cache"), { GIT_DIR: join(user, ".git"), GIT_WORK_TREE: user })).toEqual({ code: 0, err: "" });
});

test("the lock's version is checked, and a tampered package is named at its entry in the lock", () => {
  const [repo, commit] = repository("ver/repo", { "fish.toml": manifest("dep"), "src/lib.fsh": "" });
  const cache = join(root, "ver-cache");
  const app = files("ver/app", { "fish.toml": manifest("app", `dep = { git = "file://${repo}", rev = "${commit}" }\n`), "src/main.fsh": `function main() {}\n` });
  expect(buildIn(app, cache)).toEqual({ code: 0, err: "" });
  const lib = Bun.spawnSync(["find", cache, "-name", "lib.fsh"]).stdout.toString().trim();
  Bun.spawnSync(["ln", "-s", "/etc/hosts", join(lib, "..", "added.fsh")]);
  expect(buildIn(app, cache).err).toMatch(/^fish\.lock:4:1: error\[E0906\]: the files of 'dep' at .* no longer match its checksum in fish\.lock/);
  writeFileSync(join(app, "fish.lock"), "version = 2\n");
  expect(buildIn(app, cache).err).toBe("fish.lock:1:11: error[E0906]: this fish.lock isn't one this fishc writes, version 1; a newer fishc may have written it");
});

test("builds fetching the same package at once all succeed", async () => {
  const [repo, commit] = repository("race/repo", { "fish.toml": manifest("dep"), "src/lib.fsh": "" });
  for (let round = 0; round < 3; round++) {
    const cache = join(root, `race-cache-${round}`);
    const apps = [0, 1, 2, 3].map((i) => files(`race/app${round}${i}`, { "fish.toml": manifest("app", `dep = { git = "file://${repo}", rev = "${commit}" }\n`), "src/main.fsh": `function main() {}\n` }));
    const runs = apps.map((dir) => Bun.spawn([process.execPath, MAIN, "build"], { cwd: dir, env: { ...process.env, FISH_CACHE_DIR: cache }, stderr: "pipe" }));
    const codes = await Promise.all(runs.map(async (r) => [await r.exited, (await new Response(r.stderr).text()).split("\n")[0]]));
    expect(codes).toEqual([[0, ""], [0, ""], [0, ""], [0, ""]]);
  }
}, 120_000);

test("a branch named after the pinned commit's full hash can't stand in for it", () => {
  const [repo, good] = repository("branch/repo", { "fish.toml": manifest("dep"), "src/lib.fsh": `export function v(): string { return "pinned"; }\n` });
  writeFileSync(join(repo, "src", "lib.fsh"), `export function v(): string { return "moved"; }\n`);
  gitIn(repo, "commit", "-q", "-am", "later");
  gitIn(repo, "branch", good);
  const app = files("branch/app", { "fish.toml": manifest("app", `dep = { git = "file://${repo}", rev = "${good}" }\n`), "src/main.fsh": `import { v } from "dep";\nfunction main() { console.log(v()); }\n` });
  expect(buildIn(app, join(root, "branch-cache"))).toEqual({ code: 0, err: "" });
  expect(ran(join(app, "target", "debug", "app"))).toBe("pinned\n");
});

test("a dependency's relative imports stay inside it, while the program's own package may reach further", () => {
  files("rel/outside", { "lib.fsh": `export function hi(): string { return "outside"; }\n` });
  const [repo, commit] = repository("rel/repo", { "fish.toml": manifest("dep"), "src/lib.fsh": `import { hi } from "../../../outside/lib";\nexport function v(): string { return hi(); }\n` });
  const app = files("rel/app", { "fish.toml": manifest("app", `dep = { git = "file://${repo}", rev = "${commit}" }\n`), "src/main.fsh": `import { v } from "dep";\nfunction main() { console.log(v()); }\n` });
  expect(buildIn(app, join(root, "rel-cache")).err).toEndWith("src/lib.fsh:1:1: error[E0903]: '../../../outside/lib' leads outside the package 'dep'; a package imports its own files by path, and other packages by name");
  files("rel/shared", { "main.fsh": `function main() { console.log("outside"); }\n` });
  const own = files("rel/own", { "fish.toml": manifest("own"), "src/.keep": "" });
  Bun.spawnSync(["ln", "-s", join(root, "rel/shared/main.fsh"), join(own, "src/main.fsh")]);
  expect(fishc(own, "build")).toEqual({ code: 0, err: "" });
  expect(ran(join(own, "target", "debug", "own"))).toBe("outside\n");
});

test("the user's own git hooks don't run while a dependency is checked out", () => {
  const home = files("hooks/home", { "hooks/post-checkout": `#!/bin/sh\ntouch ${join(root, "hooks", "ran")}\n` });
  Bun.spawnSync(["chmod", "+x", join(home, "hooks", "post-checkout")]);
  writeFileSync(join(home, ".gitconfig"), `[core]\n\thooksPath = ${join(home, "hooks")}\n`);
  const [repo, commit] = repository("hooks/repo", { "fish.toml": manifest("dep"), "src/lib.fsh": "" });
  const app = files("hooks/app", { "fish.toml": manifest("app", `dep = { git = "file://${repo}", rev = "${commit}" }\n`), "src/main.fsh": `function main() {}\n` });
  expect(buildIn(app, join(root, "hooks-cache"), { HOME: home })).toEqual({ code: 0, err: "" });
  expect(Bun.file(join(root, "hooks", "ran")).size).toBe(0);
});
