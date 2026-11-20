// Ports tests/registry.test.ts: registry indexes that are local git repositories, read in process
// through the compiler's registry_index module where the Bun test calls it, and builds, `fishc add`
// and `fishc update` run as the native fishc. The Bun test sets FISH_CACHE_DIR, and FISH_REGISTRY
// for one test, in its own process; Fish can't set `process.env`, so an in-process test runs itself
// again in a child process with them set: `again` starts this test binary on the same test,
// FISH_REGISTRY_TEST_ROOT naming the directory the parent made. Concurrent builds are background
// jobs of one shell.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { argv } from "node:process";
import { readManifest } from "../../src/manifest.fsh";
import { DEFAULT_REGISTRY, openIndex, registryUrl, resolveVersions, Index, type Request } from "../../src/registry_index.fsh";
import { formatVersion } from "../../src/semver.fsh";
import { fishcPath, read, removed, same, scratch, text } from "./support.fsh";

// The directory the parent test made, in the child `again` starts, else "".
function childRoot(): string {
  return process.env.FISH_REGISTRY_TEST_ROOT ?? "";
}

// Runs this test again in a child process with the cache under `root`, `vars` given to env first.
function again(root: string, vars: string[]): void {
  const run = spawnSync("env", [...vars, `FISH_REGISTRY_TEST_ROOT=${root}`, `FISH_CACHE_DIR=${join(root, "cache")}`, process.execPath, argv()[2]]);
  assert(run.status === 0, `the test's child process failed:\n${text(run.stdout)}${text(run.stderr)}`);
}

const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function write(path: string, contents: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function writeBytes(path: string, bytes: Ref<u8[]>): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes.clone());
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function gitIn(cwd: string, args: string[]): void {
  spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd });
}

function depsJson(deps: Ref<[string, string][]>): string {
  return `{${deps.map(([n, r]) => `${JSON.stringify(n)}:${JSON.stringify(r)}`).join(",")}}`;
}

// An index line for `name` at `version`.
function line(name: string, version: string, deps: [string, string][] = [], yanked: boolean = false, sha: string = SHA): string {
  return `{"name":${JSON.stringify(name)},"version":${JSON.stringify(version)},"dependencies":${depsJson(deps)},"sha256":${JSON.stringify(sha)},"yanked":${yanked}}`;
}

// A git repository at `name` under `root` holding an index: its config.json and each package's lines.
function index(root: string, name: string, packages: Ref<[string, string[]][]>, config: string = `{"dl":"file:///archives/{name}/{version}.tar.gz"}`): string {
  const at = join(root, name);
  write(join(at, "config.json"), config);
  for (const [pkg, lines] of packages) write(join(at, pkg.slice(0, 2), pkg), lines.join("\n") + "\n");
  if (!existsSync(join(at, ".git"))) gitIn(at, ["init", "-q"]);
  gitIn(at, ["add", "."]);
  gitIn(at, ["commit", "-q", "-m", "index"]);
  return `file://${at}`;
}

function opened(url: string, refresh: boolean = false): Index {
  try {
    return openIndex(url, refresh);
  } catch (e) {
    assert(false, `can't open ${url}: ${e.message}`);
    return new Index(url, "", "");
  }
}

function openError(url: string): string {
  try {
    const _i = openIndex(url);
    return "";
  } catch (e) {
    return e.message;
  }
}

// Each version of `name`, written as its version, dependencies and whether it is yanked.
function listed(reg: Ref<Index>, name: string): string {
  try {
    let parts: string[] = [];
    for (const e of reg.versions(name)) {
      let deps: string[] = [];
      for (const [d, r] of e.dependencies) deps.push(`${d} ${r}`);
      parts.push(`${formatVersion(e.version)} [${deps.join(", ")}] ${e.yanked}`);
    }
    return parts.join("; ");
  } catch (e) {
    return `refused: ${e.message}`;
  }
}

function texts(reg: Ref<Index>, name: string): string {
  try {
    return reg.versions(name).map((e) => e.text).join(", ");
  } catch (e) {
    return `refused: ${e.message}`;
  }
}

function versionsError(reg: Ref<Index>, name: string): string {
  try {
    const _v = reg.versions(name);
    return "";
  } catch (e) {
    return e.message;
  }
}

// The versions resolution picks for `roots`, each a name and its ranges with who asked, written
// `name version` sorted by name, or the message it refuses with.
function pick(reg: Ref<Index>, roots: Ref<[string, [string, string][]][]>, locked: [string, string][] = []): string {
  let requests = new Map<string, Request[]>();
  for (const [n, rs] of roots) requests.set(n, rs.map(([range, by]): Request => ({ range, by })));
  let held = new Map<string, string>();
  for (const [n, v] of locked) held.set(n, v);
  try {
    const picked = resolveVersions(reg, requests, held);
    let parts: string[] = [];
    for (const [n, e] of picked) parts.push(`${n} ${e.text}`);
    parts.sort();
    return parts.join(", ");
  } catch (e) {
    return `refused: ${e.message}`;
  }
}

function has(got: string, part: string, what: string): void {
  assert(got.includes(part), `${what}: expected it to contain\n${part}\n--- got\n${got}`);
}

test("an index is cloned once, read, and cloned again only when asked", () => {
  const root = childRoot();
  if (root === "") {
    const r = scratch("fish-registry-");
    again(r, []);
    removed(r);
    return;
  }
  const url = index(root, "one", [["http", [line("http", "1.0.0"), line("http", "1.2.0", [["log", "^2.0.0"]]), line("http", "2.0.0-beta.1", [], true)]]]);
  const first = opened(url);
  same(first.dl, "file:///archives/{name}/{version}.tar.gz", "the dl");
  same(listed(first, "http"), "1.0.0 [] false; 1.2.0 [log ^2.0.0] false; 2.0.0-beta.1 [] true", "the versions");
  index(root, "one", [["http", [line("http", "1.0.0"), line("http", "1.3.0")]]]);
  same(texts(opened(url), "http"), "1.0.0, 1.2.0, 2.0.0-beta.1", "the versions before a refresh");
  same(texts(opened(url, true), "http"), "1.0.0, 1.3.0", "the versions after a refresh");
  removed(join(root, "one"));
  same(texts(opened(url), "http"), "1.0.0, 1.3.0", "the versions once the index is gone");
}, { timeout: 30_000 });

test("a missing package, a malformed line and a config without dl are refused saying where", () => {
  const root = childRoot();
  if (root === "") {
    const r = scratch("fish-registry-");
    again(r, []);
    removed(r);
    return;
  }
  const url = index(root, "bad", [["ok", [line("ok", "1.0.0")]], ["broken", [line("broken", "1.0.0"), "{not json"]], ["wrong", [line("other", "1.0.0")]], ["dep", [line("dep", "1.0.0", [["x", "latest"]])]]]);
  const reg = opened(url);
  has(versionsError(reg, "missing"), "the registry has no package 'missing'", "a missing package");
  has(versionsError(reg, "broken"), "the registry's entry for 'broken' is malformed at line 2: it isn't JSON", "a line that isn't JSON");
  has(versionsError(reg, "wrong"), "the registry's entry for 'wrong' is malformed at line 1: it names 'other'", "a line naming another package");
  has(versionsError(reg, "dep"), "the registry's entry for 'dep' is malformed at line 1: its dependency 'x' isn't a name with a version range", "a bad range");
  const nodl = index(root, "nodl", [], `{"url":"x"}`);
  has(openError(nodl), `the registry '${nodl}' has a config.json without a "dl" naming {name} and {version}`, "no dl");
  has(openError(`file://${root}/nowhere`), `can't read the registry 'file://${root}/nowhere'`, "a missing index");
}, { timeout: 30_000 });

test("FISH_REGISTRY, then the package's [registry], then Fish's own index, choose where to look", () => {
  const root = childRoot();
  if (root === "") {
    const r = scratch("fish-registry-");
    again(r, ["-u", "FISH_REGISTRY", "FISH_REGISTRY_TEST_SET=0"]);
    again(r, ["FISH_REGISTRY=file:///env/index", "FISH_REGISTRY_TEST_SET=1"]);
    removed(r);
    return;
  }
  try {
    const plain = readManifest(`[package]\nname = "a"\nversion = "1.0.0"\n`, "/p");
    const own = readManifest(`[package]\nname = "a"\nversion = "1.0.0"\n[registry]\nurl = "https://example.com/index"\n`, "/p");
    if (process.env.FISH_REGISTRY_TEST_SET === "1") same(registryUrl(own), "file:///env/index", "FISH_REGISTRY over [registry]");
    else same(`${registryUrl(plain)} ${registryUrl(own)}`, `${DEFAULT_REGISTRY} https://example.com/index`, "without FISH_REGISTRY");
  } catch (e) {
    assert(false, e.message);
  }
}, { timeout: 30_000 });

test("each name gets the highest version every range on it allows, through the chosen versions' own dependencies", () => {
  const root = childRoot();
  if (root === "") {
    const r = scratch("fish-registry-");
    again(r, []);
    removed(r);
    return;
  }
  const url = index(root, "resolve", [
    ["http", [line("http", "1.0.0", [["log", "^1.0.0"]]), line("http", "1.4.0", [["log", "^1.2.0"]]), line("http", "2.0.0", [["log", "^2.0.0"]]), line("http", "1.5.0-beta.1")]],
    ["log", [line("log", "1.1.0"), line("log", "1.3.0"), line("log", "1.9.0", [], true), line("log", "2.1.0")]],
    ["db", [line("db", "0.4.0", [["log", "~1.3.0"]])]],
  ]);
  const reg = opened(url);
  same(pick(reg, [["http", [["^1.0.0", "app"]]]]), "http 1.4.0, log 1.3.0", "^1.0.0 on http");
  same(pick(reg, [["http", [["^1.0.0", "app"]]], ["db", [["*", "app"]]]]), "db 0.4.0, http 1.4.0, log 1.3.0", "http and db");
  same(pick(reg, [["http", [["^1.5.0-beta.1", "app"]]]]), "http 1.5.0-beta.1", "a pre-release");
  same(pick(reg, [["log", [["^1.0.0", "app"]]]]), "log 1.3.0", "yanked passed over");
  same(pick(reg, [["log", [["^1.0.0", "app"]]]], [["log", "1.9.0"]]), "log 1.9.0", "a locked yanked version");
  same(pick(reg, [["log", [["^1.0.0", "app"]]]], [["log", "1.1.0"]]), "log 1.1.0", "a locked lower version");
  has(pick(reg, [["http", [["^2.0.0", "app"]]], ["log", [["^1.0.0", "app"]]]]), "no version of 'log' fits every range on it: '^1.0.0' from app, '^2.0.0' from http 2.0.0", "conflicting ranges");
  has(pick(reg, [["http", [["^3.0.0", "app"]]]]), "no version of 'http' fits every range on it: '^3.0.0' from app", "no version");
}, { timeout: 30_000 });

// Adds `name` at `version` to the index at `reg` under `root`: the package's files packed as a
// .tar.gz in the archive folder, made by `archive` when given, and its line, with the archive's
// sha256, in the index.
function publish(root: string, reg: string, name: string, version: string, lib: string, deps: [string, string][] = [], archive: ((dir: string) => u8[]) | null = null): string {
  const dir = join(root, "src-packages", name, version);
  write(join(dir, "fish.toml"), `[package]\nname = "${name}"\nversion = "${version}"\n[dependencies]\n${deps.map(([n, r]) => `${n} = { version = "${r}" }\n`).join("")}`);
  write(join(dir, "src", "lib.fsh"), lib);
  const bytes = archive !== null ? archive(dir) : spawnSync("env", ["COPYFILE_DISABLE=1", "tar", "-cz", "-C", dir, "fish.toml", "src"]).stdout;
  const archives = join(root, "archives");
  writeBytes(join(archives, name, `${version}.tar.gz`), bytes);
  const sha256 = createHash("sha256").update(bytes.clone()).digest("hex");
  const at = join(root, reg);
  const file = join(at, name.slice(0, 2), name);
  const before = existsSync(file) ? read(file) : "";
  write(file, before + line(name, version, deps, false, sha256) + "\n");
  write(join(at, "config.json"), `{"dl":${JSON.stringify(`file://${archives}/{name}/{version}.tar.gz`)}}`);
  if (!existsSync(join(at, ".git"))) gitIn(at, ["init", "-q"]);
  gitIn(at, ["add", "."]);
  gitIn(at, ["commit", "-q", "-m", `${name} ${version}`]);
  return `file://${at}`;
}

type Got = { code: i64; out: string; err: string };

// Runs fishc with `args` in `dir` against the index at `url` with its cache at `cache`, stderr cut
// to its first line.
function fishc(dir: string, url: string, cache: string, args: string[]): Got {
  const r = spawnSync("env", [`FISH_REGISTRY=${url}`, `FISH_CACHE_DIR=${cache}`, fishcPath(), ...args], { cwd: dir });
  return { code: r.status ?? -1, out: text(r.stdout), err: text(r.stderr).split("\n")[0] };
}

function build(dir: string, url: string, cache: string, args: string[] = []): Got {
  return fishc(dir, url, cache, ["build", ...args]);
}

function built(got: Ref<Got>, what: string): void {
  assert(got.code === 0 && got.err === "", `${what}: exited with ${got.code}: ${got.err}`);
}

// A program at `name` depending on `deps` by version, whose main prints `expr`.
function app(root: string, name: string, deps: Ref<[string, string][]>, imports: string, expr: string): string {
  const dir = join(root, "apps", name);
  write(join(dir, "fish.toml"), `[package]\nname = "app"\nversion = "0.1.0"\n[dependencies]\n${deps.map(([n, r]) => `${n} = { version = "${r}" }\n`).join("")}`);
  write(join(dir, "src", "main.fsh"), `${imports}\nfunction main() { console.log(${expr}); }\n`);
  return dir;
}

function ran(file: string): string {
  return text(spawnSync(file, []).stdout);
}

test("a program depending on registry packages builds from their archives and runs", () => {
  const root = scratch("fish-registry-");
  publish(root, "reg-a", "words", "1.0.0", `export function word(): string { return "old"; }\n`);
  publish(root, "reg-a", "words", "1.4.0", `export function word(): string { return "fish"; }\n`);
  const url = publish(root, "reg-a", "greet", "2.1.0", `import { word } from "words";\nexport function greet(): string { return "hello " + word(); }\n`, [["words", "^1.2.0"]]);
  const dir = app(root, "a", [["greet", "^2.0.0"]], `import { greet } from "greet";`, "greet()");
  built(build(dir, url, join(root, "cache-a")), "fishc build");
  same(ran(join(dir, "target", "debug", "app")), "hello fish\n", "the program");
  removed(root);
}, { timeout: 30_000 });

// A tar.gz written by Python's tarfile at `dir`, with `py` adding its entries to `t`.
function pyTar(dir: string, py: string): u8[] {
  spawnSync("python3", ["-c", `import tarfile,io,sys\nt=tarfile.open('${dir}/x.tgz','w:gz')\n${py}\nt.close()`]);
  return spawnSync("cat", [`${dir}/x.tgz`]).stdout;
}

function pyAdd(path: string): string {
  return `i=tarfile.TarInfo('${path}'); d=b'export function f(): i64 { return 1; }'; i.size=len(d); t.addfile(i, io.BytesIO(d))`;
}

test("archives that don't match, hold links or paths outside, fail to download, or are too large are refused", () => {
  const root = scratch("fish-registry-");
  const cache = join(root, "cache-b");
  const archives = join(root, "archives");
  const url = publish(root, "reg-b", "linked", "1.0.0", "", [], (dir) => pyTar(dir, `i=tarfile.TarInfo('src/lib.fsh'); i.type=tarfile.SYMTYPE; i.linkname='/etc/hosts'; t.addfile(i)`));
  publish(root, "reg-b", "absolute", "1.0.0", "", [], (dir) => pyTar(dir, pyAdd("/tmp/fish-evil.fsh")));
  publish(root, "reg-b", "climbing", "1.0.0", "", [], (dir) => pyTar(dir, pyAdd("../../evil.fsh")));
  publish(root, "reg-b", "tampered", "1.0.0", `export function f(): i64 { return 1; }\n`);
  write(join(archives, "tampered", "1.0.0.tar.gz"), "not what was listed");
  publish(root, "reg-b", "gone", "1.0.0", `export function f(): i64 { return 1; }\n`);
  removed(join(archives, "gone", "1.0.0.tar.gz"));
  publish(root, "reg-b", "bomb", "1.0.0", "", [], (dir) => {
    spawnSync("python3", ["-c", `import gzip; open('${dir}/b.gz','wb').write(gzip.compress(b'\\0'*(300*1024*1024), 9))`]);
    return spawnSync("cat", [`${dir}/b.gz`]).stdout;
  });
  publish(root, "reg-b", "huge", "1.0.0", `export function f(): i64 { return 1; }\n`);
  spawnSync("truncate", ["-s", "65M", join(archives, "huge", "1.0.0.tar.gz")]);
  const refused = (name: string): string => build(app(root, `b-${name}`, [[name, "^1.0.0"]], `import { f } from "${name}";`, "f()"), url, cache).err;
  same(refused("linked"), "fish.toml:5:1: error[E0906]: can't use 'linked' 1.0.0 from the registry: its archive holds 'src/lib.fsh', which isn't a plain file or directory", "a link");
  same(refused("absolute"), "fish.toml:5:1: error[E0906]: can't use 'absolute' 1.0.0 from the registry: its archive holds '/tmp/fish-evil.fsh', a path that leads outside it", "an absolute path");
  same(refused("climbing"), "fish.toml:5:1: error[E0906]: can't use 'climbing' 1.0.0 from the registry: its archive holds '../../evil.fsh', a path that leads outside it", "a climbing path");
  const tampered = refused("tampered");
  assert(tampered.startsWith("fish.toml:5:1: error[E0906]: can't use 'tampered' 1.0.0 from the registry: its archive at file://") && tampered.endsWith("doesn't match the sha256 the registry lists"), `a tampered archive: ${tampered}`);
  const missing = refused("gone");
  assert(missing.startsWith("fish.toml:5:1: error[E0906]: can't use 'gone' 1.0.0 from the registry: its archive isn't at file://"), `a missing archive: ${missing}`);
  same(refused("bomb"), "fish.toml:5:1: error[E0906]: can't use 'bomb' 1.0.0 from the registry: its archive expands past 256 MiB", "a bomb");
  const huge = refused("huge");
  assert(huge.endsWith("is larger than 64 MiB"), `a huge archive: ${huge}`);
  assert(!existsSync("/tmp/fish-evil.fsh"), "/tmp/fish-evil.fsh was written");
  same(text(spawnSync("find", [cache, "-name", "evil.fsh"]).stdout), "", "evil.fsh in the cache");
  removed(root);
}, { timeout: 120_000 });

test("fish.lock pins registry versions, a locked build needs no index, and a changed range re-resolves", () => {
  const root = scratch("fish-registry-");
  publish(root, "reg-c", "num", "1.0.0", `export function n(): i64 { return 1; }\n`);
  const url = publish(root, "reg-c", "num", "1.5.0", `export function n(): i64 { return 15; }\n`);
  const cache = join(root, "cache-c");
  const dir = app(root, "c", [["num", "^1.0.0"]], `import { n } from "num";`, "n()");
  built(build(dir, url, cache), "the first build");
  const lockFile = join(dir, "fish.lock");
  const lock = read(lockFile);
  const tail = `\n[[package]]\nname = "num"\nversion = "1.5.0"\nsource = "registry+${url}"\nchecksum = "sha256:`;
  const at = lock.lastIndexOf(tail);
  assert(at >= 0 && /^[0-9a-f]{64}"\n$/.test(lock.slice((at as i64) + (tail.length as i64))), `the lock:\n${lock}`);
  publish(root, "reg-c", "num", "1.9.0", `export function n(): i64 { return 19; }\n`);
  removed(join(root, "reg-c"));
  built(build(dir, url, cache), "the build without the index");
  same(ran(join(dir, "target", "debug", "app")), "15\n", "the locked program");
  const url2 = publish(root, "reg-c", "num", "2.0.0", `export function n(): i64 { return 20; }\n`);
  write(join(dir, "fish.toml"), `[package]\nname = "app"\nversion = "0.1.0"\n[dependencies]\nnum = { version = "^2.0.0" }\n`);
  same(build(dir, url2, cache, ["--locked"]).err, "fish.lock:1:1: error[E0906]: fish.lock is out of date with fish.toml, and --locked keeps it as it is; build without --locked to update it, then commit it", "a stale lock");
  built(build(dir, url2, cache), "the build re-resolving");
  has(read(lockFile), `name = "num"\nversion = "2.0.0"`, "the lock");
  same(ran(join(dir, "target", "debug", "app")), "20\n", "the program");
  removed(root);
}, { timeout: 30_000 });

test("fishc add names a dependency at its latest version, keeping the rest of fish.toml as it was", () => {
  const root = scratch("fish-registry-");
  publish(root, "reg-d", "http", "1.2.0", "");
  publish(root, "reg-d", "http", "1.4.1", "");
  const url = publish(root, "reg-d", "http", "2.0.0-beta.1", "");
  const cache = join(root, "cache-d");
  const dir = join(root, "apps", "d");
  const toml = `# my app\n[package]\nname = "d"   # odd spacing\nversion = "0.1.0"\n\n[dependencies]\n# none yet\n\n[registry]\nurl = "${url}"\n`;
  write(join(dir, "fish.toml"), toml);
  const added = fishc(dir, url, cache, ["add", "http"]);
  assert(added.code === 0 && added.out === "added http ^1.4.1\n" && added.err === "", `fishc add http: ${added.code} ${added.out} ${added.err}`);
  same(read(join(dir, "fish.toml")), toml.replace("[dependencies]\n", `[dependencies]\nhttp = { version = "^1.4.1" }\n`), "the manifest");
  same(fishc(dir, url, cache, ["add", "http"]).err, "fishc add: 'http' is already a dependency in fish.toml", "adding it again");
  same(fishc(dir, url, cache, ["add", "nothere"]).err, "fishc add: the registry has no package 'nothere'", "a missing package");
  const bare = join(root, "apps", "d2");
  write(join(bare, "fish.toml"), `[package]\nname = "d2"\nversion = "0.1.0"`);
  same(fishc(bare, url, cache, ["add", "http@~1.2"]).out, "added http ~1.2\n", "fishc add http@~1.2");
  same(read(join(bare, "fish.toml")), `[package]\nname = "d2"\nversion = "0.1.0"\n\n[dependencies]\nhttp = { version = "~1.2" }\n`, "the bare manifest");
  same(fishc(bare, url, cache, ["add", "x@latest"]).err, "fishc add: 'latest' isn't a version range; write one as package.json does, as in ^1.2.0", "latest");
  const bad = fishc(bare, url, cache, ["add", "Bad"]).err;
  assert(bad.startsWith("fishc add: 'Bad' isn't a package name"), `an upper-case name: ${bad}`);
  removed(root);
}, { timeout: 30_000 });

test("fishc update moves locked versions to the newest that fit, all of them or one", () => {
  const root = scratch("fish-registry-");
  publish(root, "reg-e", "aa", "1.0.0", `export function a(): i64 { return 10; }\n`);
  const url = publish(root, "reg-e", "bb", "1.0.0", `export function b(): i64 { return 10; }\n`);
  const cache = join(root, "cache-e");
  const dir = app(root, "e", [["aa", "^1.0.0"], ["bb", "^1.0.0"]], `import { a } from "aa";\nimport { b } from "bb";`, "a() + b()");
  built(build(dir, url, cache), "the first build");
  publish(root, "reg-e", "aa", "1.1.0", `export function a(): i64 { return 11; }\n`);
  publish(root, "reg-e", "bb", "1.1.0", `export function b(): i64 { return 11; }\n`);
  const lockFile = join(dir, "fish.lock");
  const one = fishc(dir, url, cache, ["update", "aa"]);
  assert(one.code === 0, `fishc update aa exited with ${one.code}: ${one.err}`);
  const lock = read(lockFile);
  assert(lock.includes(`name = "aa"\nversion = "1.1.0"`) && lock.includes(`name = "bb"\nversion = "1.0.0"`), `the lock after updating aa:\n${lock}`);
  const all = fishc(dir, url, cache, ["update"]);
  assert(all.code === 0 && all.out === "updated fish.lock\n" && all.err === "", `fishc update: ${all.code} ${all.out} ${all.err}`);
  has(read(lockFile), `name = "bb"\nversion = "1.1.0"`, "the lock after updating all");
  built(build(dir, url, cache), "the build after updating");
  same(ran(join(dir, "target", "debug", "app")), "22\n", "the program");
  removed(root);
}, { timeout: 30_000 });

// A package published with a fish.toml of its own, unlike `publish`'s.
function publishWith(root: string, reg: string, name: string, version: string, toml: string, files: [string, string][], listedDeps: [string, string][] = []): string {
  return publish(root, reg, name, version, "", listedDeps, (dir) => {
    write(join(dir, "fish.toml"), toml);
    for (const [path, contents] of files) write(join(dir, path), contents);
    return spawnSync("env", ["COPYFILE_DISABLE=1", "tar", "-cz", "-C", dir, "."]).stdout;
  });
}

test("every file of a registry package is in its checksum, target/ included, and a changed copy is refetched", () => {
  const root = scratch("fish-registry-");
  const url = publishWith(root, "reg-f", "tg", "1.0.0", `[package]\nname = "tg"\nversion = "1.0.0"\nlib = "target/lib.fsh"\n`, [["target/lib.fsh", `export function t(): i64 { return 1; }\n`]]);
  const cache = join(root, "cache-f");
  const dir = app(root, "f", [["tg", "^1.0.0"]], `import { t } from "tg";`, "t()");
  built(build(dir, url, cache), "the first build");
  const lib = text(spawnSync("find", [cache, "-path", "*tg/1.0.0/*/target/lib.fsh"]).stdout).trim();
  write(lib, `export function t(): i64 { return 666; }\n`);
  const locked = build(dir, url, cache, ["--locked"]);
  assert(locked.code === 0, `the locked build exited with ${locked.code}: ${locked.err}`);
  same(ran(join(dir, "target", "debug", "app")), "1\n", "the program");
  removed(root);
}, { timeout: 30_000 });

test("the registry and the archive's own fish.toml must agree, and one name can't be two packages", () => {
  const root = scratch("fish-registry-");
  const cache = join(root, "cache-g");
  publish(root, "reg-g", "helper", "1.0.0", `export function h(): i64 { return 1; }\n`);
  publish(root, "reg-g", "helper", "2.0.0", `export function h(): i64 { return 2; }\n`);
  publishWith(root, "reg-g", "liar", "1.0.0", `[package]\nname = "liar"\nversion = "1.0.0"\n[dependencies]\nhelper = { version = "^2.0.0" }\n`, [["src/lib.fsh", `import { h } from "helper";\nexport function l(): i64 { return h(); }\n`]], [["helper", "^1.0.0"]]);
  const url = publish(root, "reg-g", "greet", "1.0.0", `export function g(): i64 { return 5; }\n`, [["util", "^1.0.0"]]);
  publish(root, "reg-g", "util", "1.0.0", "");
  same(build(app(root, "g1", [["liar", "^1.0.0"]], `import { l } from "liar";`, "l()"), url, cache).err, "fish.toml:5:1: error[E0906]: the registry lists other dependencies for 'liar' 1.0.0 than its own fish.toml declares", "a disagreeing archive");
  const clash = app(root, "g2", [["greet", "^1.0.0"]], `import { g } from "greet";`, "g()");
  write(join(clash, "fish.toml"), `[package]\nname = "app"\nversion = "0.1.0"\n[dependencies]\ngreet = { version = "^1.0.0" }\nutil = { path = "../util" }\n`);
  write(join(root, "apps", "util", "fish.toml"), `[package]\nname = "util"\nversion = "1.0.0"\n`);
  write(join(root, "apps", "util", "src", "lib.fsh"), "");
  same(build(clash, url, cache).err, "fish.toml:5:1: error[E0906]: 'util' comes from the registry for a registry package's dependency, but already comes from '../util' in this program", "one name from two places");
  removed(root);
}, { timeout: 30_000 });

test("without a lock the index is read as it is now, and concurrent first builds share one clone", () => {
  const root = scratch("fish-registry-");
  const cache = join(root, "cache-h");
  const url = publish(root, "reg-h", "one", "1.0.0", "");
  built(build(app(root, "h1", [["one", "^1.0.0"]], ``, "1"), url, cache), "the first build");
  publish(root, "reg-h", "two", "1.0.0", `export function t(): i64 { return 2; }\n`);
  built(build(app(root, "h2", [["two", "^1.0.0"]], `import { t } from "two";`, "t()"), url, cache), "the build of a newer package");
  const fresh = join(root, "cache-h2");
  let script = "";
  let dirs: string[] = [];
  for (const i of [0, 1, 2, 3, 4, 5]) {
    const dir = app(root, `h3-${i}`, [["two", "^1.0.0"]], `import { t } from "two";`, "t()");
    script += `(cd ${JSON.stringify(dir)} && FISH_REGISTRY=${JSON.stringify(url)} FISH_CACHE_DIR=${JSON.stringify(fresh)} ${JSON.stringify(fishcPath())} build 2> err; echo $? > code) &\n`;
    dirs.push(dir);
  }
  spawnSync("sh", ["-c", `${script}wait\n`]);
  const codes = dirs.map((d) => `[${read(join(d, "code")).trim()}, ${JSON.stringify(read(join(d, "err")).split("\n")[0])}]`);
  same(codes.join(" "), dirs.map((_d) => `[0, ""]`).join(" "), "the concurrent builds");
  removed(root);
}, { timeout: 120_000 });

test("resolution settles before refusing, long chains settle, and cycles are refused", () => {
  const root = childRoot();
  if (root === "") {
    const r = scratch("fish-registry-");
    again(r, []);
    removed(r);
    return;
  }
  const r = opened(index(root, "settle", [["xx", [line("xx", "1.0.0", [["cc", "^1.0.0"]]), line("xx", "2.0.0", [["cc", "^2.0.0"]])]], ["yy", [line("yy", "1.0.0", [["xx", "^1.0.0"], ["cc", "^1.0.0"]])]], ["cc", [line("cc", "1.0.0"), line("cc", "2.0.0")]]]));
  same(pick(r, [["xx", [["*", "app"]]], ["yy", [["*", "app"]]]]), "cc 1.0.0, xx 1.0.0, yy 1.0.0", "the settled choice");
  let chain: [string, string[]][] = [];
  for (let i = 0; i < 120; i++) chain.push([`p${i}`, [line(`p${i}`, "1.0.0", i < 119 ? [[`p${i + 1}`, "^1.0.0"]] : [])]]);
  const picked = pick(opened(index(root, "chain", chain)), [["p0", [["^1.0.0", "app"]]]]);
  assert(picked.split(", ").length === 120, `the chain: ${picked}`);
  const cache = join(root, "cache-i");
  publish(root, "reg-i", "ca", "1.0.0", "", [["cb", "^1.0.0"]]);
  const url = publish(root, "reg-i", "cb", "1.0.0", "", [["ca", "^1.0.0"]]);
  same(build(app(root, "i", [["ca", "^1.0.0"]], ``, "1"), url, cache).err, "fish.toml:5:1: error[E0906]: the registry packages ca -> cb -> ca depend on each other in a cycle", "a cycle");
}, { timeout: 60_000 });

test("index versions are plain and unique, archives must be plain files, and GNU long names unpack", () => {
  const root = childRoot();
  if (root === "") {
    const r = scratch("fish-registry-");
    again(r, []);
    removed(r);
    return;
  }
  const r = opened(index(root, "plain", [["vv", [line("vv", "v1.0.0")]], ["dd", [line("dd", "1.0.0"), line("dd", "1.0.0")]]]));
  has(versionsError(r, "vv"), `malformed at line 1: its version isn't a semantic version written plainly, as in "1.2.0"`, "a v-prefixed version");
  has(versionsError(r, "dd"), "malformed at line 2: version 1.0.0 is listed twice", "a version twice");
  const cache = join(root, "cache-j");
  const url = publish(root, "reg-j", "dev", "1.0.0", "");
  write(join(root, "reg-j", "config.json"), `{"dl":"file:///dev/zero#{name}{version}"}`);
  gitIn(join(root, "reg-j"), ["commit", "-qam", "dev"]);
  same(build(app(root, "j", [["dev", "^1.0.0"]], ``, "1"), url, cache).err, "fish.toml:5:1: error[E0906]: can't use 'dev' 1.0.0 from the registry: its archive at file:///dev/zero#dev1.0.0 isn't a file", "a device as the archive");
  const long = "src/" + "a".repeat(120) + ".fsh";
  const gnu = publishWith(root, "reg-k", "gnu", "1.0.0", `[package]\nname = "gnu"\nversion = "1.0.0"\n`, [["src/lib.fsh", `export function g(): i64 { return 7; }\n`], [long, ""]]);
  const pythonGnu = spawnSync("python3", ["-c", `import tarfile,sys\nt=tarfile.open('${join(root, "gnu.tgz")}','w:gz',format=tarfile.GNU_FORMAT)\nt.add('${join(root, "src-packages", "gnu", "1.0.0")}', arcname='.')\nt.close()`]);
  assert(pythonGnu.status === 0, `python3 failed: ${text(pythonGnu.stderr)}`);
  const bytes = spawnSync("cat", [join(root, "gnu.tgz")]).stdout;
  writeBytes(join(root, "archives", "gnu", "1.0.0.tar.gz"), bytes);
  write(join(root, "reg-k", "gn", "gnu"), line("gnu", "1.0.0", [], false, createHash("sha256").update(bytes.clone()).digest("hex")) + "\n");
  gitIn(join(root, "reg-k"), ["commit", "-qam", "gnu"]);
  const dir = app(root, "k", [["gnu", "^1.0.0"]], `import { g } from "gnu";`, "g()");
  built(build(dir, gnu, join(root, "cache-k")), "the GNU archive's build");
  same(ran(join(dir, "target", "debug", "app")), "7\n", "the program");
}, { timeout: 30_000 });

test("fishc add keeps CRLF and quoted headers, refuses empty ranges, and update refuses unknown names", () => {
  const root = scratch("fish-registry-");
  const url = publish(root, "reg-l", "lib", "1.0.0", "");
  const cache = join(root, "cache-l");
  const dir = join(root, "apps", "l");
  write(join(dir, "fish.toml"), `[package]\r\nname = "l"\r\nversion = "0.1.0"\r\n["dependencies"]\r\n`);
  same(fishc(dir, url, cache, ["add", "lib"]).out, "added lib ^1.0.0\n", "fishc add lib");
  same(read(join(dir, "fish.toml")), `[package]\r\nname = "l"\r\nversion = "0.1.0"\r\n["dependencies"]\r\nlib = { version = "^1.0.0" }\r\n`, "the manifest");
  same(fishc(dir, url, cache, ["add", "x@"]).err, "fishc add: '' isn't a version range; write one as package.json does, as in ^1.2.0", "an empty range");
  same(fishc(dir, url, cache, ["update", "nosuch"]).err, "fishc update: 'nosuch' isn't a dependency from the registry in fish.toml", "an unknown name");
  removed(root);
}, { timeout: 30_000 });

test("fishc add writes into a CRLF fish.toml with no last line end", () => {
  const root = scratch("fish-registry-");
  const url = publish(root, "reg-m", "lib", "1.0.0", "");
  const dir = join(root, "apps", "m");
  write(join(dir, "fish.toml"), `[package]\r\nname = "m"\r\nversion = "0.1.0"\r\n[dependencies]\r\nother = { version = "^1.0.0" }`);
  same(fishc(dir, url, join(root, "cache-m"), ["add", "lib"]).out, "added lib ^1.0.0\n", "fishc add lib");
  same(read(join(dir, "fish.toml")), `[package]\r\nname = "m"\r\nversion = "0.1.0"\r\n[dependencies]\r\nother = { version = "^1.0.0" }\r\nlib = { version = "^1.0.0" }`, "the manifest");
  removed(root);
}, { timeout: 30_000 });
