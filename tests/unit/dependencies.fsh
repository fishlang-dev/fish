// Path and git dependencies, package privacy and fish.lock, each
// through `fishc build` run as the native fishc in a scratch directory of the test's own. The Bun
// test's concurrent builds are four background jobs of one shell.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fishcPath, read, removed, same, scratch, text } from "./support.fsh";

// A build's exit code and the first line of its stderr.
type Got = { code: i64; err: string };

function first(s: string): string {
  return s.split("\n")[0];
}

// Runs fishc with `args` in `cwd`, with `vars`, each `NAME=value`, set.
function fishc(cwd: string, args: string[], vars: string[] = []): Got {
  const run = spawnSync("env", [...vars, fishcPath(), ...args], { cwd });
  return { code: run.status ?? -1, err: first(text(run.stderr)) };
}

// Builds the package at `dir` with its cache at `cache`, and `vars` set.
function buildIn(dir: string, cache: string, vars: string[] = [], args: string[] = []): Got {
  return fishc(dir, ["build", ...args], [`FISH_CACHE_DIR=${cache}`, ...vars]);
}

function built(got: Ref<Got>, what: string): void {
  assert(got.code === 0 && got.err === "", `${what}: exited with ${got.code}: ${got.err}`);
}

function write(path: string, contents: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

// Writes `all` under `name` in `root`, giving the directory.
function files(root: string, name: string, all: Ref<[string, string][]>): string {
  const at = join(root, name);
  for (const [path, contents] of all) write(join(at, path), contents);
  return at;
}

function manifest(name: string, deps: string = ""): string {
  return `[package]\nname = "${name}"\nversion = "0.1.0"\n[dependencies]\n${deps}`;
}

function ran(file: string): string {
  return text(spawnSync(file, []).stdout);
}

function link(target: string, at: string): void {
  spawnSync("ln", ["-sfn", target, at]);
}

// A repository's output from git run as `args` in `at`.
function gitIn(at: string, args: string[]): string {
  return text(spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: at }).stdout).trim();
}

// A git repository at `name` holding `all`, committed, giving its directory and the commit.
function repository(root: string, name: string, all: Ref<[string, string][]>): [string, string] {
  const at = files(root, name, all);
  gitIn(at, ["init", "-q"]);
  gitIn(at, ["add", "."]);
  gitIn(at, ["commit", "-q", "-m", "first"]);
  return [at, gitIn(at, ["rev-parse", "HEAD"])];
}

test("a path dependency is imported by name, with its own dependencies, from fishc build or a file in the package", () => {
  const root = scratch("fish-deps-");
  files(root, "one/words", [["fish.toml", manifest("words")], ["src/lib.fsh", `export function word(): string { return "fish"; }\n`]]);
  files(root, "one/greet", [["fish.toml", manifest("greet", `words = { path = "../words" }\n`)], ["src/lib.fsh", `import { word } from "words";\nexport function greet(): string { return "hello " + word(); }\n`]]);
  const app = files(root, "one/app", [["fish.toml", manifest("app", `greet = { path = "../greet" }\n`)], ["src/main.fsh", `import { greet } from "greet";\nfunction main() { console.log(greet()); }\n`]]);
  built(fishc(app, ["build"]), "fishc build");
  same(ran(join(app, "target", "debug", "app")), "hello fish\n", "the program");
  const direct = fishc(app, ["build", "src/main.fsh", "-o", "direct"]);
  assert(direct.code === 0, `fishc build src/main.fsh exited with ${direct.code}: ${direct.err}`);
  same(ran(join(app, "direct")), "hello fish\n", "the program built from its file");
  removed(root);
}, { timeout: 30_000 });

test("two packages depending on a third from the same path share it, and one name can't come from two places", () => {
  const root = scratch("fish-deps-");
  files(root, "two/base", [["fish.toml", manifest("base")], ["src/lib.fsh", `export function n(): i64 { return 2; }\n`]]);
  files(root, "two/left", [["fish.toml", manifest("left", `base = { path = "../base" }\n`)], ["src/lib.fsh", `import { n } from "base";\nexport function l(): i64 { return n(); }\n`]]);
  files(root, "two/right", [["fish.toml", manifest("right", `base = { path = "../base" }\n`)], ["src/lib.fsh", `import { n } from "base";\nexport function r(): i64 { return n() * 10; }\n`]]);
  const app = files(root, "two/app", [["fish.toml", manifest("app", `left = { path = "../left" }\nright = { path = "../right" }\n`)], ["src/main.fsh", `import { l } from "left";\nimport { r } from "right";\nfunction main() { console.log(l() + r()); }\n`]]);
  built(fishc(app, ["build"]), "fishc build");
  same(ran(join(app, "target", "debug", "app")), "22\n", "the program");
  files(root, "two/base2", [["fish.toml", manifest("base")], ["src/lib.fsh", `export function n(): i64 { return 3; }\n`]]);
  files(root, "two/odd", [["fish.toml", manifest("odd", `base = { path = "../base2" }\n`)], ["src/lib.fsh", `export function o(): i64 { return 1; }\n`]]);
  const clash = files(root, "two/clash", [["fish.toml", manifest("clash", `left = { path = "../left" }\nodd = { path = "../odd" }\n`)], ["src/main.fsh", `function main() {}\n`]]);
  same(fishc(clash, ["build"]).err, "../odd/fish.toml:5:1: error[E0906]: 'base' already comes from '../base' in this program, so it can't also come from '../base2'", "the clash");
  removed(root);
}, { timeout: 30_000 });

test("a dependency that can't be used is refused where it is named", () => {
  const root = scratch("fish-deps-");
  files(root, "bad/nolib", [["fish.toml", manifest("nolib")]]);
  files(root, "bad/named", [["fish.toml", manifest("other")], ["src/lib.fsh", ""]]);
  files(root, "bad/plain", [["x.fsh", ""]]);
  files(root, "bad/a", [["fish.toml", manifest("a", `b = { path = "../b" }\n`)], ["src/lib.fsh", ""]]);
  files(root, "bad/b", [["fish.toml", manifest("b", `a = { path = "../a" }\n`)], ["src/lib.fsh", ""]]);
  const app = (deps: string): string => files(root, "bad/app", [["fish.toml", manifest("app", deps)], ["src/main.fsh", `function main() {}\n`]]);
  same(fishc(app(`util = { path = "../nowhere" }\n`), ["build"]).err, "fish.toml:5:1: error[E0906]: can't find the directory '../nowhere' for 'util'", "a missing directory");
  same(fishc(app(`plain = { path = "../plain" }\n`), ["build"]).err, "fish.toml:5:1: error[E0906]: '../plain' has no fish.toml, so it isn't a Fish package", "no fish.toml");
  same(fishc(app(`named = { path = "../named" }\n`), ["build"]).err, "fish.toml:5:1: error[E0906]: the package at '../named' is named 'other' in its fish.toml, not 'named'; depend on it by that name", "another name");
  same(fishc(app(`nolib = { path = "../nolib" }\n`), ["build"]).err, `../nolib/fish.toml:1:1: error[E0905]: the lib 'src/lib.fsh' doesn't exist; create it, or name another with lib = "..."`, "no lib");
  same(fishc(app(`a = { path = "../a" }\n`), ["build"]).err, "../b/fish.toml:5:1: error[E0906]: 'a' depends back on 'b': a -> b -> a; packages can't depend on each other in a cycle", "a cycle");
  removed(root);
}, { timeout: 30_000 });

test("a package's lib is public, its other files' exports are package-private, and unexported names are file-private", () => {
  const root = scratch("fish-deps-");
  const util = `function clean(s: string): string { return s.trim(); }\nexport function slug(s: string): string { return clean(s).toLowerCase(); }\nexport function upper(s: string): string { return clean(s).toUpperCase(); }\n`;
  const words = (lib: string): string => files(root, "levels/words", [["fish.toml", manifest("words")], ["src/util.fsh", util], ["src/lib.fsh", lib]]);
  words(`import { slug } from "./util";\nexport { upper } from "./util";\nexport function title(s: string): string { return "[" + slug(s) + "]"; }\n`);
  const app = (main: string): string => files(root, "levels/app", [["fish.toml", manifest("app", `words = { path = "../words" }\n`)], ["src/main.fsh", main]]);
  const ok = app(`import { title, upper } from "words";\nfunction main() { console.log(title(" Fish ")); console.log(upper(" fish ")); }\n`);
  built(fishc(ok, ["build"]), "fishc build");
  same(ran(join(ok, "target", "debug", "app")), "[fish]\nFISH\n", "the program");
  same(fishc(app(`import { slug } from "words";\nfunction main() { console.log(slug("x")); }\n`), ["build"]).err, "src/main.fsh:1:10: error[E0903]: 'slug' is private to the package 'words'; only what its lib src/lib.fsh exports is public", "a private name");
  same(fishc(app(`import { nope } from "words";\nfunction main() {}\n`), ["build"]).err, "src/main.fsh:1:10: error[E0902]: the package 'words' has no export named 'nope' in its lib src/lib.fsh", "a missing name");
  same(fishc(app(`import d from "words";\nfunction main() {}\n`), ["build"]).err, "src/main.fsh:1:1: error[E0902]: the package 'words' has no default export in its lib src/lib.fsh", "a default import");
  words(`import { clean } from "./util";\nexport function title(s: string): string { return clean(s); }\n`);
  same(fishc(app(`import { title } from "words";\nfunction main() { console.log(title("x")); }\n`), ["build"]).err, "../../words/src/lib.fsh:1:10: error[E0902]: '../../words/src/util.fsh' has no export named 'clean'; it declares 'clean' without exporting it, so add 'export' before that declaration", "an unexported name");
  removed(root);
}, { timeout: 30_000 });

test("a lib or entry can't be a nested package's file, and packages nested in each other keep their own messages", () => {
  const root = scratch("fish-deps-");
  const deep: [string, string][] = [["deep/fish.toml", manifest("deep")], ["deep/src/lib.fsh", `export function pub(): i64 { return 1; }\n`], ["deep/src/inner.fsh", `export function secret(): i64 { return 42; }\n`]];
  const outer = (lib: string, extra: string): string => files(root, "own/outer", [...deep, ["fish.toml", `[package]\nname = "outer"\nversion = "0.1.0"\n${extra}[dependencies]\ndeep = { path = "./deep" }\n`], ["src/lib.fsh", lib]]);
  const app = (main: string): string => files(root, "own/app", [["fish.toml", manifest("app", `outer = { path = "../outer" }\n`)], ["src/main.fsh", main]]);
  outer("", `lib = "deep/src/inner.fsh"\n`);
  same(fishc(app(`import { secret } from "outer";\nfunction main() { console.log(secret()); }\n`), ["build"]).err, "../outer/fish.toml:4:7: error[E0905]: the lib 'deep/src/inner.fsh' is a file inside the package 'deep'; a package's lib is one of its own files", "a nested lib");
  outer(`import { pub } from "deep";\nexport function o(): i64 { return pub(); }\n`, "");
  same(fishc(app(`import { pub } from "outer";\nfunction main() { console.log(pub()); }\n`), ["build"]).err, "src/main.fsh:1:10: error[E0902]: the package 'outer' has no export named 'pub' in its lib src/lib.fsh", "a nested package's export");
  const entry = files(root, "own/entry", [...deep, ["fish.toml", `[package]\nname = "entry"\nversion = "0.1.0"\nentry = "deep/src/m.fsh"\n[dependencies]\ndeep = { path = "./deep" }\n`], ["deep/src/m.fsh", `import { secret } from "./inner";\nfunction main() { console.log(secret()); }\n`]]);
  same(fishc(entry, ["build"]).err, "fish.toml:4:9: error[E0905]: the entry 'deep/src/m.fsh' is a file inside the package 'deep'; a package's entry is one of its own files", "a nested entry");
  const linkedEntry = files(root, "own/linked-entry", [...deep, ["fish.toml", `[package]\nname = "linked"\nversion = "0.1.0"\nentry = "src/d/m.fsh"\n[dependencies]\ndeep = { path = "./deep" }\n`], ["deep/src/m.fsh", `import { secret } from "./inner";\nfunction main() { console.log(secret()); }\n`]]);
  try {
    mkdirSync(join(linkedEntry, "src"), { recursive: true });
  } catch (e) {
    assert(false, e.message);
  }
  link("../deep/src", join(linkedEntry, "src", "d"));
  same(fishc(linkedEntry, ["build"]).err, "fish.toml:4:9: error[E0905]: the entry 'src/d/m.fsh' is a file inside the package 'deep'; a package's entry is one of its own files", "an entry through a link");
  const w = files(root, "own/w", [["fish.toml", manifest("w")], ["src/lib.fsh", `import { helper } from "./util";\nexport function pub(): i64 { return helper(); }\n`], ["src/util.fsh", `export function helper(): i64 { return 7; }\n`], ["examples/ex/fish.toml", manifest("ex", `w = { path = "../.." }\n`)], ["examples/ex/src/main.fsh", `import { helper } from "w";\nfunction main() { console.log(helper()); }\n`]]);
  same(fishc(join(w, "examples", "ex"), ["build"]).err, "src/main.fsh:1:10: error[E0903]: 'helper' is private to the package 'w'; only what its lib src/lib.fsh exports is public", "a package inside its dependency");
  removed(root);
}, { timeout: 30_000 });

test("a relative import into another package's directory is refused, directly or through a link", () => {
  const root = scratch("fish-deps-");
  const nested = (main: string): string => files(root, "nest/app", [
    ["fish.toml", manifest("app", `util = { path = "./packages/util" }\n`)],
    ["packages/util/fish.toml", manifest("util")],
    ["packages/util/src/lib.fsh", `export function u(): i64 { return 1; }\n`],
    ["packages/util/src/inner.fsh", `export function i(): i64 { return 2; }\n`],
    ["vendor/loose/fish.toml", manifest("loose")],
    ["vendor/loose/x.fsh", `export function x(): i64 { return 3; }\n`],
    ["src/main.fsh", main],
  ]);
  same(fishc(nested(`import { i } from "../packages/util/src/inner";\nfunction main() { console.log(i()); }\n`), ["build"]).err, "src/main.fsh:1:1: error[E0903]: '../packages/util/src/inner' is a file inside the package 'util'; import it by name, as 'util'", "a relative import");
  const linked = nested(`import { i } from "./link/inner";\nfunction main() { console.log(i()); }\n`);
  link("../packages/util/src", join(linked, "src", "link"));
  same(fishc(linked, ["build"]).err, "src/main.fsh:1:1: error[E0903]: './link/inner' is a file inside the package 'util'; import it by name, as 'util'", "an import through a link");
  const loose = nested(`import { x } from "../vendor/loose/x";\nimport { u } from "util";\nfunction main() { console.log(x() + u()); }\n`);
  built(fishc(loose, ["build"]), "fishc build");
  same(ran(join(loose, "target", "debug", "app")), "4\n", "the program");
  files(root, "nest/outer", [["fish.toml", manifest("outer", `deep = { path = "./deep" }\n`)], ["deep/fish.toml", manifest("deep")], ["deep/src/lib.fsh", ""], ["deep/src/x.fsh", `export function x(): i64 { return 5; }\n`], ["src/lib.fsh", `import { x } from "../deep/src/x";\nexport function o(): i64 { return x(); }\n`]]);
  const top = files(root, "nest/top", [["fish.toml", manifest("top", `outer = { path = "../outer" }\n`)], ["src/main.fsh", `import { o } from "outer";\nfunction main() { console.log(o()); }\n`]]);
  same(fishc(top, ["build"]).err, "../../outer/src/lib.fsh:1:1: error[E0903]: '../deep/src/x' is a file inside the package 'deep'; import it by name, as 'deep'", "a dependency's relative import");
  removed(root);
}, { timeout: 30_000 });

test("a dependency's inner files are private to it, by every import form, and a name not in fish.toml still reaches npm's packages", () => {
  const root = scratch("fish-deps-");
  files(root, "sub/words", [["fish.toml", manifest("words")], ["src/lib.fsh", `export function word(): string { return "w"; }\n`], ["src/util.fsh", `export function w(): string { return "u"; }\nexport type W = { n: i64 };\n`]]);
  const rule = "'words/src/util' is a file inside the package 'words', and a package's files are private to it; import from 'words', which gives what its lib src/lib.fsh exports";
  for (const form of [`import { w } from "words/src/util";`, `import type { W } from "words/src/util";`, `export { w } from "words/src/util";`, `export * from "words/src/util";`]) {
    const app = files(root, "sub/app", [["fish.toml", manifest("app", `words = { path = "../words" }\n`)], ["src/main.fsh", `${form}\nfunction main() {}\n`]]);
    same(fishc(app, ["build"]).err, `src/main.fsh:1:1: error[E0903]: ${rule}`, form);
  }
  files(root, "sub/mid", [["fish.toml", manifest("mid", `words = { path = "../words" }\n`)], ["src/lib.fsh", `import { w } from "words/src/util";\nexport function m(): string { return w(); }\n`]]);
  const top = files(root, "sub/top", [["fish.toml", manifest("top", `mid = { path = "../mid" }\n`)], ["src/main.fsh", `import { m } from "mid";\nfunction main() { console.log(m()); }\n`]]);
  same(fishc(top, ["build"]).err, `../../mid/src/lib.fsh:1:1: error[E0903]: ${rule}`, "a dependency's import");
  const npm = files(root, "sub/npm", [["fish.toml", manifest("npm")], ["src/main.fsh", `import { x } from "nothing-installed";\nfunction main() {}\n`]]);
  const missing = fishc(npm, ["build"]).err;
  assert(missing.includes("can't find the package 'nothing-installed'"), `an npm name: ${missing}`);
  removed(root);
}, { timeout: 30_000 });

test("a git dependency pinned to a commit is fetched into the cache once, and read from there after", () => {
  const root = scratch("fish-deps-");
  const cache = join(root, "cache");
  const [repo, commit] = repository(root, "git/words", [["fish.toml", manifest("words")], ["src/lib.fsh", `export function word(): string { return "from git"; }\n`]]);
  const app = files(root, "git/app", [["fish.toml", manifest("app", `words = { git = "file://${repo}", rev = "${commit.slice(0, 8)}" }\n`)], ["src/main.fsh", `import { word } from "words";\nfunction main() { console.log(word()); }\n`]]);
  built(buildIn(app, cache), "the first build");
  same(ran(join(app, "target", "debug", "app")), "from git\n", "the program");
  removed(repo);
  built(buildIn(app, cache), "the build without the repository");
  const other = (deps: string): string => files(root, "git/other", [["fish.toml", manifest("other", deps)], ["src/main.fsh", `function main() {}\n`]]);
  same(buildIn(other(`w = { git = "file://${repo}", rev = "abcdef1" }\n`), join(root, "empty-cache"), ["PATH=/nonexistent"]).err, `fish.toml:5:1: error[E0906]: fetching 'file://${repo}' needs the git command, which isn't on PATH; install git`, "no git");
  const [repo2, _c] = repository(root, "git/second", [["fish.toml", manifest("second")], ["src/lib.fsh", ""]]);
  const nowhere = buildIn(other(`second = { git = "file://${root}/git/nowhere", rev = "abcdef1" }\n`), join(root, "empty-cache")).err;
  assert(nowhere.startsWith(`fish.toml:5:1: error[E0906]: can't fetch 'file://${root}/git/nowhere': `), `a missing repository: ${nowhere}`);
  same(buildIn(other(`second = { git = "file://${repo2}", rev = "abcdef1" }\n`), join(root, "empty-cache")).err, `fish.toml:5:1: error[E0906]: 'file://${repo2}' has no commit 'abcdef1'`, "a missing commit");
  removed(root);
}, { timeout: 30_000 });

test("fish.lock records every package, keeps itself when nothing changed, checks git files, and --locked holds it", () => {
  const root = scratch("fish-deps-");
  const cache = join(root, "lock-cache");
  const [repo, commit] = repository(root, "lock/http", [["fish.toml", manifest("http")], ["src/lib.fsh", `export function get(): string { return "ok"; }\n`]]);
  files(root, "lock/util", [["fish.toml", manifest("util", `http = { git = "file://${repo}", rev = "${commit}" }\n`)], ["src/lib.fsh", `import { get } from "http";\nexport function u(): string { return get(); }\n`]]);
  const app = files(root, "lock/app", [["fish.toml", manifest("app", `util = { path = "../util" }\n`)], ["src/main.fsh", `import { u } from "util";\nfunction main() { console.log(u()); }\n`]]);
  built(buildIn(app, cache), "the first build");
  const lockFile = join(app, "fish.lock");
  const written = read(lockFile);
  const head = `# Written by fishc build; it records exactly which packages a build used.\nversion = 1\n\n[[package]]\nname = "http"\nsource = "git+file://${repo}#${commit}"\nchecksum = "sha256:`;
  assert(written.startsWith(head) && /^[0-9a-f]{64}"\n\n\[\[package\]\]\nname = "util"\nsource = "path\+\.\.\/util"\n$/.test(written.slice(head.length as i64)), `the lock:\n${written}`);
  built(buildIn(app, cache, [], ["--locked"]), "the locked build");
  same(read(lockFile), written, "the lock after a locked build");
  const cached = text(spawnSync("find", [cache, "-name", "lib.fsh", "-path", "*http*"]).stdout).trim();
  write(cached, `export function get(): string { return "tampered"; }\n`);
  const tampered = buildIn(app, cache).err;
  assert(/^fish\.lock:4:1: error\[E0906\]: the files of 'http' at .* no longer match its checksum in fish\.lock; delete that directory to fetch it again$/.test(tampered), `a tampered package: ${tampered}`);
  write(join(app, "fish.toml"), manifest("app", ""));
  write(join(app, "src", "main.fsh"), `function main() {}\n`);
  same(buildIn(app, cache, [], ["--locked"]).err, "fish.lock:1:1: error[E0906]: fish.lock is out of date with fish.toml, and --locked keeps it as it is; build without --locked to update it, then commit it", "a stale lock");
  built(buildIn(app, cache), "the build updating the lock");
  same(read(lockFile), "# Written by fishc build; it records exactly which packages a build used.\nversion = 1\n", "the emptied lock");
  removed(root);
}, { timeout: 30_000 });

test("a dependency named like a Node built-in is that package, and node: still means the built-in", () => {
  const root = scratch("fish-deps-");
  files(root, "builtin/util", [["fish.toml", manifest("util")], ["src/lib.fsh", `export function mine(): string { return "mine"; }\n`]]);
  const app = files(root, "builtin/app", [["fish.toml", manifest("app", `util = { path = "../util" }\n`)], ["src/main.fsh", `import { mine } from "util";\nimport { format } from "node:util";\nfunction main() { console.log(format("%s and std", mine())); }\n`]]);
  built(fishc(app, ["build"]), "fishc build");
  same(ran(join(app, "target", "debug", "app")), "mine and std\n", "the program");
  removed(root);
}, { timeout: 30_000 });

test("a git package holding a symbolic link is refused, and can't write through one", () => {
  const root = scratch("fish-deps-");
  const victim = files(root, "attack/victim", [["target.txt", "SECRET"]]);
  const [evil, _c] = repository(root, "attack/evil", [["fish.toml", manifest("evil")], ["src/lib.fsh", ""]]);
  spawnSync("ln", ["-s", join(victim, "target.txt"), join(evil, ".fish-commit")]);
  gitIn(evil, ["add", "."]);
  gitIn(evil, ["commit", "-q", "-m", "link"]);
  const commit = gitIn(evil, ["rev-parse", "HEAD"]);
  const app = files(root, "attack/app", [["fish.toml", manifest("app", `evil = { git = "file://${evil}", rev = "${commit}" }\n`)], ["src/main.fsh", `function main() {}\n`]]);
  same(buildIn(app, join(root, "attack-cache")).err, `fish.toml:5:1: error[E0906]: 'file://${evil}' holds a symbolic link at '.fish-commit'; a package from git can't, since a link reaches files its commit doesn't pin`, "a linked file");
  same(read(join(victim, "target.txt")), "SECRET", "the file the link names");
  removed(root);
}, { timeout: 30_000 });

test("a git package can't reach outside its checkout through lib or a path dependency, nor a local lib through a link", () => {
  const root = scratch("fish-deps-");
  const [out, outCommit] = repository(root, "reach/out", [["fish.toml", `[package]\nname = "out"\nversion = "0.1.0"\nlib = "../../secret.fsh"\n`], ["src/lib.fsh", ""]]);
  const [viaPath, viaCommit] = repository(root, "reach/via", [["fish.toml", manifest("via", `local = { path = "/tmp" }\n`)], ["src/lib.fsh", ""]]);
  const app = (deps: string): string => files(root, "reach/app", [["fish.toml", manifest("app", deps)], ["src/main.fsh", `function main() {}\n`]]);
  const cache = join(root, "reach-cache");
  const lib = buildIn(app(`out = { git = "file://${out}", rev = "${outCommit}" }\n`), cache).err;
  assert(lib.endsWith(`fish.toml:4:7: error[E0905]: the lib is a file inside the package, as in lib = "src/lib.fsh"`), `a lib outside: ${lib}`);
  const via = buildIn(app(`via = { git = "file://${viaPath}", rev = "${viaCommit}" }\n`), cache).err;
  assert(via.endsWith("fish.toml:5:1: error[E0906]: 'via' comes from git, so its dependencies must too; a path dependency would bring in files its commit doesn't pin"), `a path dependency: ${via}`);
  const outside = files(root, "reach/elsewhere", [["lib.fsh", ""]]);
  files(root, "reach/linked", [["fish.toml", manifest("linked")], ["src/.keep", ""]]);
  spawnSync("ln", ["-s", join(outside, "lib.fsh"), join(root, "reach/linked/src/lib.fsh")]);
  same(buildIn(app(`linked = { path = "../linked" }\n`), cache).err, "../linked/fish.toml:1:1: error[E0905]: the lib 'src/lib.fsh' leads outside the package; it is a file inside it", "a linked lib");
  removed(root);
}, { timeout: 30_000 });

test("a short rev is the commit it starts, never a tag named like it, and short and full revs of one commit are one package", () => {
  const root = scratch("fish-deps-");
  const [repo, good] = repository(root, "rev/repo", [["fish.toml", manifest("dep")], ["src/lib.fsh", `export function v(): string { return "pinned"; }\n`]]);
  write(join(repo, "src", "lib.fsh"), `export function v(): string { return "moved"; }\n`);
  gitIn(repo, ["commit", "-q", "-am", "later"]);
  gitIn(repo, ["tag", good.slice(0, 7)]);
  const cache = join(root, "rev-cache");
  const app = files(root, "rev/app", [["fish.toml", manifest("app", `dep = { git = "file://${repo}", rev = "${good.slice(0, 7)}" }\n`)], ["src/main.fsh", `import { v } from "dep";\nfunction main() { console.log(v()); }\n`]]);
  built(buildIn(app, cache), "the short rev");
  same(ran(join(app, "target", "debug", "app")), "pinned\n", "the program");
  files(root, "rev/other", [["fish.toml", manifest("other", `dep = { git = "file://${repo}", rev = "${good}" }\n`)], ["src/lib.fsh", `import { v } from "dep";\nexport function o(): string { return v(); }\n`]]);
  const both = files(root, "rev/both", [["fish.toml", manifest("both", `dep = { git = "file://${repo}", rev = "${good.slice(0, 7)}" }\nother = { path = "../other" }\n`)], ["src/main.fsh", `import { o } from "other";\nfunction main() { console.log(o()); }\n`]]);
  built(buildIn(both, cache), "short and full revs");
  same(ran(join(both, "target", "debug", "both")), "pinned\n", "the program with both");
  removed(root);
}, { timeout: 30_000 });

test("a package can't depend on itself, a second route by another name is refused, and GIT_DIR doesn't reach the fetch", () => {
  const root = scratch("fish-deps-");
  const self = files(root, "names/self", [["fish.toml", manifest("self", `me = { path = "." }\n`)], ["src/main.fsh", `function main() {}\n`]]);
  same(fishc(self, ["build"]).err, "fish.toml:5:1: error[E0906]: 'me' depends back on 'self': self -> me; packages can't depend on each other in a cycle", "a package depending on itself");
  files(root, "names/util", [["fish.toml", manifest("util")], ["src/lib.fsh", ""]]);
  files(root, "names/b", [["fish.toml", manifest("b", `foo = { path = "../util" }\n`)], ["src/lib.fsh", ""]]);
  const app = files(root, "names/app", [["fish.toml", manifest("app", `util = { path = "../util" }\nb = { path = "../b" }\n`)], ["src/main.fsh", `function main() {}\n`]]);
  same(fishc(app, ["build"]).err, "../b/fish.toml:5:1: error[E0906]: the package at '../util' is named 'util' in its fish.toml, not 'foo'; depend on it by that name", "a second name");
  const [repo, commit] = repository(root, "names/repo", [["fish.toml", manifest("dep")], ["src/lib.fsh", ""]]);
  const [user, _c] = repository(root, "names/user", [["x.txt", "x"]]);
  const gitApp = files(root, "names/gitapp", [["fish.toml", manifest("gitapp", `dep = { git = "file://${repo}", rev = "${commit}" }\n`)], ["src/main.fsh", `function main() {}\n`]]);
  built(buildIn(gitApp, join(root, "names-cache"), [`GIT_DIR=${join(user, ".git")}`, `GIT_WORK_TREE=${user}`]), "the build with GIT_DIR set");
  removed(root);
}, { timeout: 30_000 });

test("the lock's version is checked, and a tampered package is named at its entry in the lock", () => {
  const root = scratch("fish-deps-");
  const [repo, commit] = repository(root, "ver/repo", [["fish.toml", manifest("dep")], ["src/lib.fsh", ""]]);
  const cache = join(root, "ver-cache");
  const app = files(root, "ver/app", [["fish.toml", manifest("app", `dep = { git = "file://${repo}", rev = "${commit}" }\n`)], ["src/main.fsh", `function main() {}\n`]]);
  built(buildIn(app, cache), "the first build");
  const lib = text(spawnSync("find", [cache, "-name", "lib.fsh"]).stdout).trim();
  spawnSync("ln", ["-s", "/etc/hosts", join(lib, "..", "added.fsh")]);
  const tampered = buildIn(app, cache).err;
  assert(/^fish\.lock:4:1: error\[E0906\]: the files of 'dep' at .* no longer match its checksum in fish\.lock/.test(tampered), `a file added: ${tampered}`);
  write(join(app, "fish.lock"), "version = 2\n");
  same(buildIn(app, cache).err, "fish.lock:1:11: error[E0906]: this fish.lock isn't one this fishc writes, version 1; a newer fishc may have written it", "a newer lock");
  removed(root);
}, { timeout: 30_000 });

test("builds fetching the same package at once all succeed", () => {
  const root = scratch("fish-deps-");
  const [repo, commit] = repository(root, "race/repo", [["fish.toml", manifest("dep")], ["src/lib.fsh", ""]]);
  for (let round = 0; round < 3; round++) {
    const cache = join(root, `race-cache-${round}`);
    let script = "";
    for (const i of [0, 1, 2, 3]) {
      const dir = files(root, `race/app${round}${i}`, [["fish.toml", manifest("app", `dep = { git = "file://${repo}", rev = "${commit}" }\n`)], ["src/main.fsh", `function main() {}\n`]]);
      script += `(cd ${JSON.stringify(dir)} && FISH_CACHE_DIR=${JSON.stringify(cache)} ${JSON.stringify(fishcPath())} build 2> err; echo $? > code) &\n`;
    }
    spawnSync("sh", ["-c", `${script}wait\n`]);
    let codes: string[] = [];
    for (const i of [0, 1, 2, 3]) codes.push(`[${read(join(root, `race/app${round}${i}`, "code")).trim()}, ${JSON.stringify(first(read(join(root, `race/app${round}${i}`, "err"))))}]`);
    same(codes.join(" "), `[0, ""] [0, ""] [0, ""] [0, ""]`, `round ${round}`);
  }
  removed(root);
}, { timeout: 120_000 });

test("a branch named after the pinned commit's full hash can't stand in for it", () => {
  const root = scratch("fish-deps-");
  const [repo, good] = repository(root, "branch/repo", [["fish.toml", manifest("dep")], ["src/lib.fsh", `export function v(): string { return "pinned"; }\n`]]);
  write(join(repo, "src", "lib.fsh"), `export function v(): string { return "moved"; }\n`);
  gitIn(repo, ["commit", "-q", "-am", "later"]);
  gitIn(repo, ["branch", good]);
  const app = files(root, "branch/app", [["fish.toml", manifest("app", `dep = { git = "file://${repo}", rev = "${good}" }\n`)], ["src/main.fsh", `import { v } from "dep";\nfunction main() { console.log(v()); }\n`]]);
  built(buildIn(app, join(root, "branch-cache")), "fishc build");
  same(ran(join(app, "target", "debug", "app")), "pinned\n", "the program");
  removed(root);
}, { timeout: 30_000 });

test("a dependency's relative imports stay inside it, while the program's own package may reach further", () => {
  const root = scratch("fish-deps-");
  files(root, "rel/outside", [["lib.fsh", `export function hi(): string { return "outside"; }\n`]]);
  const [repo, commit] = repository(root, "rel/repo", [["fish.toml", manifest("dep")], ["src/lib.fsh", `import { hi } from "../../../outside/lib";\nexport function v(): string { return hi(); }\n`]]);
  const app = files(root, "rel/app", [["fish.toml", manifest("app", `dep = { git = "file://${repo}", rev = "${commit}" }\n`)], ["src/main.fsh", `import { v } from "dep";\nfunction main() { console.log(v()); }\n`]]);
  const reached = buildIn(app, join(root, "rel-cache")).err;
  assert(reached.endsWith("src/lib.fsh:1:1: error[E0903]: '../../../outside/lib' leads outside the package 'dep'; a package imports its own files by path, and other packages by name"), `a dependency's import: ${reached}`);
  files(root, "rel/shared", [["main.fsh", `function main() { console.log("outside"); }\n`]]);
  const own = files(root, "rel/own", [["fish.toml", manifest("own")], ["src/.keep", ""]]);
  spawnSync("ln", ["-s", join(root, "rel/shared/main.fsh"), join(own, "src/main.fsh")]);
  built(fishc(own, ["build"]), "fishc build");
  same(ran(join(own, "target", "debug", "own")), "outside\n", "the program");
  removed(root);
}, { timeout: 30_000 });

test("the user's own git hooks don't run while a dependency is checked out", () => {
  const root = scratch("fish-deps-");
  const home = files(root, "hooks/home", [["hooks/post-checkout", `#!/bin/sh\ntouch ${join(root, "hooks", "ran")}\n`]]);
  spawnSync("chmod", ["+x", join(home, "hooks", "post-checkout")]);
  write(join(home, ".gitconfig"), `[core]\n\thooksPath = ${join(home, "hooks")}\n`);
  const [repo, commit] = repository(root, "hooks/repo", [["fish.toml", manifest("dep")], ["src/lib.fsh", ""]]);
  const app = files(root, "hooks/app", [["fish.toml", manifest("app", `dep = { git = "file://${repo}", rev = "${commit}" }\n`)], ["src/main.fsh", `function main() {}\n`]]);
  built(buildIn(app, join(root, "hooks-cache"), [`HOME=${home}`]), "fishc build");
  assert(!existsSync(join(root, "hooks", "ran")), "the hook ran");
  removed(root);
}, { timeout: 30_000 });

// Runs fishc with `args` in `cwd` with its cache at `cache`, keeping all of its output.
function whole(cwd: string, cache: string, args: string[]): { code: i64; out: string; err: string } {
  const run = spawnSync("env", [`FISH_CACHE_DIR=${cache}`, fishcPath(), ...args], { cwd });
  return { code: run.status ?? -1, out: text(run.stdout), err: text(run.stderr) };
}

test("a workspace's members share one fish.lock at its root, depend on each other by path, and take [workspace.dependencies]", () => {
  const root = scratch("fish-deps-");
  const cache = join(root, "ws-cache");
  const [repo, commit] = repository(root, "ws-http", [["fish.toml", manifest("http")], ["src/lib.fsh", `export function get(): string { return "ok"; }\n`]]);
  const ws = join(root, "ws");
  write(join(ws, "fish.toml"), `[workspace]\nmembers = ["app", "libs/*"]\n\n[workspace.dependencies]\nhttp = { git = "file://${repo}", rev = "${commit}" }\n`);
  files(ws, "libs/util", [["fish.toml", manifest("util", `http = { workspace = true }\n`)], ["src/lib.fsh", `import { get } from "http";\nexport function u(): string { return get(); }\n`]]);
  write(join(ws, "libs", "notes", "readme.txt"), "not a package\n");
  const app = files(ws, "app", [["fish.toml", manifest("app", `util = { path = "../libs/util" }\n`)], ["src/main.fsh", `import { u } from "util";\nfunction main() { console.log(u()); }\n`]]);
  built(buildIn(app, cache), "the member's build");
  same(ran(join(app, "target", "debug", "app")), "ok\n", "the member's program");
  assert(!existsSync(join(app, "fish.lock")), "the member wrote a lock of its own");
  const lock = read(join(ws, "fish.lock"));
  assert(lock.includes(`name = "http"`) && !lock.includes(`name = "util"`) && !lock.includes(`name = "app"`), `the workspace's lock:\n${lock}`);
  const all = whole(ws, cache, ["build"]);
  assert(all.code === 0 && all.err === "==> app\n==> util: a library with no entry, checked by the members that import it\n", `fishc build at the root: ${all.code}\n${all.err}`);
  const one = whole(ws, cache, ["build", "-p", "app"]);
  assert(one.code === 0 && one.err === "", `fishc build -p app: ${one.code}\n${one.err}`);
  same(whole(ws, cache, ["build", "-p", "nope"]).err, "fishc build: the workspace has no member 'nope'; it has app, util\n", "-p naming no member");
  same(whole(ws, cache, ["build", "-p", "app", "app/src/main.fsh"]).err, "fishc build: '-p' chooses the member to run in; give a file or path, or '-p', not both\n", "-p with a file");
  same(whole(ws, cache, ["build", "-o", "out"]).err, "fishc build: '-o' names one output, and a workspace's root runs every member; choose one with -p <name>\n", "-o at the root");
  same(whole(ws, cache, ["run", "-p", "app"]).err, "fishc run: '-p' chooses a workspace member for build, check, test, fmt, add and publish\n", "-p on run");
  write(join(app, "src", "main.fsh"), `function main() { const x: i64 = "no"; }\n`);
  const failing = whole(ws, cache, ["check"]);
  assert(failing.code === 1 && failing.err.startsWith("==> app\n") && failing.err.includes("error[E0101]") && failing.err.endsWith("==> util: a library with no entry, checked by the members that import it\nfishc check: 1 of 2 members failed: app\n"), `a failing member: ${failing.code}\n${failing.err}`);
  removed(root);
}, { timeout: 120_000 });

test("a workspace refuses a missing, unpackaged, outside, duplicate or nested member, and an inherited name it doesn't declare", () => {
  const root = scratch("fish-deps-");
  const cache = join(root, "ws-cache");
  const lib: [string, string] = ["src/lib.fsh", ""];
  const cases: [string, string, [string, string][]][] = [
    [`members = ["gone"]`, "the member 'gone' doesn't exist; make a package there with 'fishc new', or leave it out", []],
    [`members = ["empty"]`, "the member 'empty' has no fish.toml; make a package there with 'fishc init', or leave it out", [["empty/readme.txt", ""]]],
    [`members = ["../x"]`, "a member is a directory inside the workspace", []],
    [`members = ["a", "b"]`, "two members are named 'same', at 'a' and 'b'; a name is one package in a workspace", [["a/fish.toml", manifest("same")], ["b/fish.toml", manifest("same")]]],
    [`members = ["a"]`, "this package is a member of a workspace, so it can't be a workspace itself", [["a/fish.toml", `${manifest("a")}[workspace]\nmembers = []\n`]]],
  ];
  let n = 0;
  for (const [members, message, all] of cases) {
    const ws = files(root, `bad${n}`, [["fish.toml", `[workspace]\n${members}\n`], ...all]);
    n++;
    const got = fishc(ws, ["build"], [`FISH_CACHE_DIR=${cache}`]);
    assert(got.code === 1 && got.err.includes(`error[E0905]: ${message}`), `${members}: ${got.code}: ${got.err}`);
  }
  const ws = files(root, "undeclared", [["fish.toml", `[workspace]\nmembers = ["app"]\n`], ["app/fish.toml", manifest("app", `util = { workspace = true }\n`)], ["app/src/main.fsh", "function main() {}\n"]]);
  assert(buildIn(join(ws, "app"), cache).err.includes("error[E0905]: the workspace's [workspace.dependencies] has no 'util'; declare it there"), "an undeclared name");
  const alone = files(root, "alone", [["fish.toml", manifest("alone", `util = { workspace = true }\n`)], lib, ["src/main.fsh", "function main() {}\n"]]);
  assert(buildIn(alone, cache).err.includes("error[E0905]: 'util' comes from the workspace, but this package isn't a member of one; say where it comes from instead"), "a package in no workspace");
  removed(root);
}, { timeout: 60_000 });
