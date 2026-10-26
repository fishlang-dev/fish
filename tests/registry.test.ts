import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readManifest } from "../src/manifest.ts";
import { DEFAULT_REGISTRY, openIndex, registryUrl, resolveVersions } from "../src/registry_index.ts";
import { formatVersion } from "../src/semver.ts";

setDefaultTimeout(30_000);

const root = realpathSync(mkdtempSync(join(tmpdir(), "fish-registry-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
process.env.FISH_CACHE_DIR = join(root, "cache");

const SHA = "a".repeat(64);
// An index line for `name` at `version`.
export const line = (name: string, version: string, dependencies: Record<string, string> = {}, extra: object = {}) => JSON.stringify({ name, version, dependencies, sha256: SHA, yanked: false, ...extra });

// A git repository at `name` holding an index: its config.json and each package's lines.
function index(name: string, packages: Record<string, string[]>, config: object = { dl: "file:///archives/{name}/{version}.tar.gz" }): string {
  const at = join(root, name);
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, "config.json"), JSON.stringify(config));
  for (const [pkg, lines] of Object.entries(packages)) {
    mkdirSync(join(at, pkg.slice(0, 2)), { recursive: true });
    writeFileSync(join(at, pkg.slice(0, 2), pkg), lines.join("\n") + "\n");
  }
  const git = (...args: string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: at });
  if (!Bun.spawnSync(["test", "-d", join(at, ".git")]).success) git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "index");
  return `file://${at}`;
}

test("an index is cloned once, read, and cloned again only when asked", () => {
  const url = index("one", { http: [line("http", "1.0.0"), line("http", "1.2.0", { log: "^2.0.0" }), line("http", "2.0.0-beta.1", {}, { yanked: true })] });
  const first = openIndex(url);
  expect(first.dl).toBe("file:///archives/{name}/{version}.tar.gz");
  expect(first.versions("http").map((e) => [formatVersion(e.version), [...e.dependencies], e.yanked])).toEqual([["1.0.0", [], false], ["1.2.0", [["log", "^2.0.0"]], false], ["2.0.0-beta.1", [], true]]);
  index("one", { http: [line("http", "1.0.0"), line("http", "1.3.0")] });
  expect(openIndex(url).versions("http").length).toBe(3);
  expect(openIndex(url, true).versions("http").map((e) => e.text)).toEqual(["1.0.0", "1.3.0"]);
  rmSync(join(root, "one"), { recursive: true, force: true });
  expect(openIndex(url).versions("http").length).toBe(2);
});

test("a missing package, a malformed line and a config without dl are refused saying where", () => {
  const url = index("bad", { ok: [line("ok", "1.0.0")], broken: [line("broken", "1.0.0"), "{not json"], wrong: [line("other", "1.0.0")], dep: [line("dep", "1.0.0", { x: "latest" })] });
  const reg = openIndex(url);
  expect(() => reg.versions("missing")).toThrow("the registry has no package 'missing'");
  expect(() => reg.versions("broken")).toThrow("the registry's entry for 'broken' is malformed at line 2: it isn't JSON");
  expect(() => reg.versions("wrong")).toThrow("the registry's entry for 'wrong' is malformed at line 1: it names 'other'");
  expect(() => reg.versions("dep")).toThrow("the registry's entry for 'dep' is malformed at line 1: its dependency 'x' isn't a name with a version range");
  const nodl = index("nodl", {}, { url: "x" });
  expect(() => openIndex(nodl)).toThrow(`the registry '${nodl}' has a config.json without a "dl" naming {name} and {version}`);
  expect(() => openIndex(`file://${root}/nowhere`)).toThrow(`can't read the registry 'file://${root}/nowhere'`);
});

test("FISH_REGISTRY, then the package's [registry], then Fish's own index, choose where to look", () => {
  const plain = readManifest(`[package]\nname = "a"\nversion = "1.0.0"\n`, "/p");
  const own = readManifest(`[package]\nname = "a"\nversion = "1.0.0"\n[registry]\nurl = "https://example.com/index"\n`, "/p");
  const saved = process.env.FISH_REGISTRY;
  delete process.env.FISH_REGISTRY;
  expect([registryUrl(plain), registryUrl(own)]).toEqual([DEFAULT_REGISTRY, "https://example.com/index"]);
  process.env.FISH_REGISTRY = "file:///env/index";
  expect(registryUrl(own)).toBe("file:///env/index");
  if (saved === undefined) delete process.env.FISH_REGISTRY;
  else process.env.FISH_REGISTRY = saved;
});

test("each name gets the highest version every range on it allows, through the chosen versions' own dependencies", () => {
  const url = index("resolve", {
    http: [line("http", "1.0.0", { log: "^1.0.0" }), line("http", "1.4.0", { log: "^1.2.0" }), line("http", "2.0.0", { log: "^2.0.0" }), line("http", "1.5.0-beta.1")],
    log: [line("log", "1.1.0"), line("log", "1.3.0"), line("log", "1.9.0", {}, { yanked: true }), line("log", "2.1.0")],
    db: [line("db", "0.4.0", { log: "~1.3.0" })],
  });
  const reg = openIndex(url);
  const pick = (roots: Record<string, [string, string][]>, locked?: Record<string, string>) =>
    Object.fromEntries([...resolveVersions(reg, new Map(Object.entries(roots).map(([n, rs]) => [n, rs.map(([range, by]) => ({ range, by }))])), new Map(Object.entries(locked ?? {})))].map(([n, e]) => [n, e.text]));
  expect(pick({ http: [["^1.0.0", "app"]] })).toEqual({ http: "1.4.0", log: "1.3.0" });
  expect(pick({ http: [["^1.0.0", "app"]], db: [["*", "app"]] })).toEqual({ http: "1.4.0", log: "1.3.0", db: "0.4.0" });
  expect(pick({ http: [["^1.5.0-beta.1", "app"]] })).toEqual({ http: "1.5.0-beta.1" });
  expect(pick({ log: [["^1.0.0", "app"]] })).toEqual({ log: "1.3.0" });
  expect(pick({ log: [["^1.0.0", "app"]] }, { log: "1.9.0" })).toEqual({ log: "1.9.0" });
  expect(pick({ log: [["^1.0.0", "app"]] }, { log: "1.1.0" })).toEqual({ log: "1.1.0" });
  expect(() => pick({ http: [["^2.0.0", "app"]], log: [["^1.0.0", "app"]] })).toThrow("no version of 'log' fits every range on it: '^1.0.0' from app, '^2.0.0' from http 2.0.0");
  expect(() => pick({ http: [["^3.0.0", "app"]] })).toThrow("no version of 'http' fits every range on it: '^3.0.0' from app");
});

const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const ARCHIVES = join(root, "archives");

// Adds `name` at `version` to the index at `reg`: the package's files packed as a .tar.gz in
// the archive folder, and its line, with the archive's sha256, in the index.
function publish(reg: string, name: string, version: string, lib: string, dependencies: Record<string, string> = {}, archive?: (dir: string) => Uint8Array) {
  const dir = join(root, "src-packages", name, version);
  mkdirSync(join(dir, "src"), { recursive: true });
  const deps = Object.entries(dependencies).map(([n, r]) => `${n} = { version = "${r}" }\n`).join("");
  writeFileSync(join(dir, "fish.toml"), `[package]\nname = "${name}"\nversion = "${version}"\n[dependencies]\n${deps}`);
  writeFileSync(join(dir, "src", "lib.fsh"), lib);
  const bytes = archive ? archive(dir) : Bun.spawnSync(["tar", "-cz", "-C", dir, "fish.toml", "src"], { env: { ...process.env, COPYFILE_DISABLE: "1" } }).stdout;
  mkdirSync(join(ARCHIVES, name), { recursive: true });
  writeFileSync(join(ARCHIVES, name, `${version}.tar.gz`), bytes);
  const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const at = join(root, reg);
  const file = join(at, name.slice(0, 2), name);
  mkdirSync(join(file, ".."), { recursive: true });
  const before = Bun.spawnSync(["cat", file]).stdout.toString();
  writeFileSync(file, before + JSON.stringify({ name, version, dependencies, sha256, yanked: false }) + "\n");
  writeFileSync(join(at, "config.json"), JSON.stringify({ dl: `file://${ARCHIVES}/{name}/{version}.tar.gz` }));
  const git = (...args: string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: at });
  if (!Bun.spawnSync(["test", "-d", join(at, ".git")]).success) git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", `${name} ${version}`);
  return `file://${at}`;
}

// Builds the package at `dir` against the index at `url` with its own cache.
function build(dir: string, url: string, cache: string, ...args: string[]) {
  const run = Bun.spawnSync([process.execPath, MAIN, "build", ...args], { cwd: dir, env: { ...process.env, FISH_REGISTRY: url, FISH_CACHE_DIR: cache } });
  return { code: run.exitCode, err: run.stderr.toString().split("\n")[0]! };
}

// A program at `name` depending on `deps` by version, whose main prints `expr`.
function app(name: string, deps: Record<string, string>, imports: string, expr: string): string {
  const dir = join(root, "apps", name);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "fish.toml"), `[package]\nname = "app"\nversion = "0.1.0"\n[dependencies]\n${Object.entries(deps).map(([n, r]) => `${n} = { version = "${r}" }\n`).join("")}`);
  writeFileSync(join(dir, "src", "main.fsh"), `${imports}\nfunction main() { console.log(${expr}); }\n`);
  return dir;
}

const ran = (file: string) => Bun.spawnSync([file]).stdout.toString();

test("a program depending on registry packages builds from their archives and runs", () => {
  publish("reg-a", "words", "1.0.0", `export function word(): string { return "old"; }\n`);
  publish("reg-a", "words", "1.4.0", `export function word(): string { return "fish"; }\n`);
  const url = publish("reg-a", "greet", "2.1.0", `import { word } from "words";\nexport function greet(): string { return "hello " + word(); }\n`, { words: "^1.2.0" });
  const dir = app("a", { greet: "^2.0.0" }, `import { greet } from "greet";`, "greet()");
  expect(build(dir, url, join(root, "cache-a"))).toEqual({ code: 0, err: "" });
  expect(ran(join(dir, "target", "debug", "app"))).toBe("hello fish\n");
});

test("archives that don't match, hold links or paths outside, fail to download, or are too large are refused", async () => {
  const cache = join(root, "cache-b");
  const tar = (dir: string, py: string) => {
    Bun.spawnSync(["python3", "-c", `import tarfile,io,sys\nt=tarfile.open('${dir}/x.tgz','w:gz')\n${py}\nt.close()`]);
    return Bun.spawnSync(["cat", `${dir}/x.tgz`]).stdout;
  };
  const add = (name: string, path: string) => `i=tarfile.TarInfo('${path}'); d=b'export function f(): i64 { return 1; }'; i.size=len(d); t.addfile(i, io.BytesIO(d))`;
  const url = publish("reg-b", "linked", "1.0.0", "", {}, (dir) => tar(dir, `i=tarfile.TarInfo('src/lib.fsh'); i.type=tarfile.SYMTYPE; i.linkname='/etc/hosts'; t.addfile(i)`));
  publish("reg-b", "absolute", "1.0.0", "", {}, (dir) => tar(dir, add("absolute", "/tmp/fish-evil.fsh")));
  publish("reg-b", "climbing", "1.0.0", "", {}, (dir) => tar(dir, add("climbing", "../../evil.fsh")));
  publish("reg-b", "tampered", "1.0.0", `export function f(): i64 { return 1; }\n`);
  writeFileSync(join(ARCHIVES, "tampered", "1.0.0.tar.gz"), "not what was listed");
  publish("reg-b", "gone", "1.0.0", `export function f(): i64 { return 1; }\n`);
  rmSync(join(ARCHIVES, "gone", "1.0.0.tar.gz"));
  publish("reg-b", "bomb", "1.0.0", "", {}, (dir) => {
    Bun.spawnSync(["python3", "-c", `import gzip; open('${dir}/b.gz','wb').write(gzip.compress(b'\\0'*(300*1024*1024), 9))`]);
    return Bun.spawnSync(["cat", `${dir}/b.gz`]).stdout;
  });
  publish("reg-b", "huge", "1.0.0", `export function f(): i64 { return 1; }\n`);
  Bun.spawnSync(["truncate", "-s", "65M", join(ARCHIVES, "huge", "1.0.0.tar.gz")]);
  const refused = (name: string) => build(app(`b-${name}`, { [name]: "^1.0.0" }, `import { f } from "${name}";`, "f()"), url, cache).err;
  expect(refused("linked")).toBe("fish.toml:5:1: error: can't use 'linked' 1.0.0 from the registry: its archive holds 'src/lib.fsh', which isn't a plain file or directory");
  expect(refused("absolute")).toBe("fish.toml:5:1: error: can't use 'absolute' 1.0.0 from the registry: its archive holds '/tmp/fish-evil.fsh', a path that leads outside it");
  expect(refused("climbing")).toBe("fish.toml:5:1: error: can't use 'climbing' 1.0.0 from the registry: its archive holds '../../evil.fsh', a path that leads outside it");
  expect(refused("tampered")).toStartWith("fish.toml:5:1: error: can't use 'tampered' 1.0.0 from the registry: its archive at file://");
  expect(refused("tampered")).toEndWith("doesn't match the sha256 the registry lists");
  expect(refused("gone")).toStartWith("fish.toml:5:1: error: can't use 'gone' 1.0.0 from the registry: its archive isn't at file://");
  expect(refused("bomb")).toBe("fish.toml:5:1: error: can't use 'bomb' 1.0.0 from the registry: its archive expands past 256 MiB");
  expect(refused("huge")).toEndWith("is larger than 64 MiB");
  expect(Bun.spawnSync(["test", "-e", "/tmp/fish-evil.fsh"]).success).toBe(false);
  expect(Bun.spawnSync(["find", cache, "-name", "evil.fsh"]).stdout.toString()).toBe("");
}, 120_000);

test("fish.lock pins registry versions, a locked build needs no index, and a changed range re-resolves", () => {
  publish("reg-c", "num", "1.0.0", `export function n(): i64 { return 1; }\n`);
  const url = publish("reg-c", "num", "1.5.0", `export function n(): i64 { return 15; }\n`);
  const cache = join(root, "cache-c");
  const dir = app("c", { num: "^1.0.0" }, `import { n } from "num";`, "n()");
  expect(build(dir, url, cache)).toEqual({ code: 0, err: "" });
  const lock = () => Bun.spawnSync(["cat", join(dir, "fish.lock")]).stdout.toString();
  expect(lock()).toMatch(new RegExp(`\\n\\[\\[package\\]\\]\\nname = "num"\\nversion = "1\\.5\\.0"\\nsource = "registry\\+${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\nchecksum = "sha256:[0-9a-f]{64}"\\n$`));
  publish("reg-c", "num", "1.9.0", `export function n(): i64 { return 19; }\n`);
  rmSync(join(root, "reg-c"), { recursive: true, force: true });
  expect(build(dir, url, cache)).toEqual({ code: 0, err: "" });
  expect(ran(join(dir, "target", "debug", "app"))).toBe("15\n");
  const url2 = publish("reg-c", "num", "2.0.0", `export function n(): i64 { return 20; }\n`);
  writeFileSync(join(dir, "fish.toml"), `[package]\nname = "app"\nversion = "0.1.0"\n[dependencies]\nnum = { version = "^2.0.0" }\n`);
  expect(build(dir, url2, cache, "--locked").err).toBe("fish.lock:1:1: error: fish.lock is out of date with fish.toml, and --locked keeps it as it is; build without --locked to update it, then commit it");
  expect(build(dir, url2, cache)).toEqual({ code: 0, err: "" });
  expect(lock()).toContain(`name = "num"\nversion = "2.0.0"`);
  expect(ran(join(dir, "target", "debug", "app"))).toBe("20\n");
});

// Runs `fishc` with `args` in `dir` against the index at `url`.
function fishc(dir: string, url: string, cache: string, ...args: string[]) {
  const run = Bun.spawnSync([process.execPath, MAIN, ...args], { cwd: dir, env: { ...process.env, FISH_REGISTRY: url, FISH_CACHE_DIR: cache } });
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString().split("\n")[0]! };
}

test("fishc add names a dependency at its latest version, keeping the rest of fish.toml as it was", () => {
  publish("reg-d", "http", "1.2.0", "");
  publish("reg-d", "http", "1.4.1", "");
  const url = publish("reg-d", "http", "2.0.0-beta.1", "");
  const cache = join(root, "cache-d");
  const dir = join(root, "apps", "d");
  mkdirSync(dir, { recursive: true });
  const toml = `# my app\n[package]\nname = "d"   # odd spacing\nversion = "0.1.0"\n\n[dependencies]\n# none yet\n\n[registry]\nurl = "${url}"\n`;
  writeFileSync(join(dir, "fish.toml"), toml);
  expect(fishc(dir, url, cache, "add", "http")).toEqual({ code: 0, out: "added http ^1.4.1\n", err: "" });
  expect(Bun.spawnSync(["cat", join(dir, "fish.toml")]).stdout.toString()).toBe(toml.replace("[dependencies]\n", `[dependencies]\nhttp = { version = "^1.4.1" }\n`));
  expect(fishc(dir, url, cache, "add", "http").err).toBe("fishc add: 'http' is already a dependency in fish.toml");
  expect(fishc(dir, url, cache, "add", "nothere").err).toBe("fishc add: the registry has no package 'nothere'");
  const bare = join(root, "apps", "d2");
  mkdirSync(bare, { recursive: true });
  writeFileSync(join(bare, "fish.toml"), `[package]\nname = "d2"\nversion = "0.1.0"`);
  expect(fishc(bare, url, cache, "add", "http@~1.2").out).toBe("added http ~1.2\n");
  expect(Bun.spawnSync(["cat", join(bare, "fish.toml")]).stdout.toString()).toBe(`[package]\nname = "d2"\nversion = "0.1.0"\n\n[dependencies]\nhttp = { version = "~1.2" }\n`);
  expect(fishc(bare, url, cache, "add", "x@latest").err).toBe("fishc add: 'latest' isn't a version range; write one as package.json does, as in ^1.2.0");
  expect(fishc(bare, url, cache, "add", "Bad").err).toStartWith("fishc add: 'Bad' isn't a package name");
});

test("fishc update moves locked versions to the newest that fit, all of them or one", () => {
  publish("reg-e", "aa", "1.0.0", `export function a(): i64 { return 10; }\n`);
  const url = publish("reg-e", "bb", "1.0.0", `export function b(): i64 { return 10; }\n`);
  const cache = join(root, "cache-e");
  const dir = app("e", { aa: "^1.0.0", bb: "^1.0.0" }, `import { a } from "aa";\nimport { b } from "bb";`, "a() + b()");
  expect(build(dir, url, cache)).toEqual({ code: 0, err: "" });
  publish("reg-e", "aa", "1.1.0", `export function a(): i64 { return 11; }\n`);
  publish("reg-e", "bb", "1.1.0", `export function b(): i64 { return 11; }\n`);
  const lock = () => Bun.spawnSync(["cat", join(dir, "fish.lock")]).stdout.toString();
  expect(fishc(dir, url, cache, "update", "aa").code).toBe(0);
  expect([lock().includes(`name = "aa"\nversion = "1.1.0"`), lock().includes(`name = "bb"\nversion = "1.0.0"`)]).toEqual([true, true]);
  expect(fishc(dir, url, cache, "update")).toEqual({ code: 0, out: "updated fish.lock\n", err: "" });
  expect(lock()).toContain(`name = "bb"\nversion = "1.1.0"`);
  expect(build(dir, url, cache)).toEqual({ code: 0, err: "" });
  expect(ran(join(dir, "target", "debug", "app"))).toBe("22\n");
});

// A package published with a fish.toml of its own, unlike `publish`'s.
function publishWith(reg: string, name: string, version: string, toml: string, files: Record<string, string>, listed: Record<string, string> = {}) {
  return publish(reg, name, version, "", listed, (dir) => {
    writeFileSync(join(dir, "fish.toml"), toml);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return Bun.spawnSync(["tar", "-cz", "-C", dir, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } }).stdout;
  });
}

test("every file of a registry package is in its checksum, target/ included, and a changed copy is refetched", () => {
  const url = publishWith("reg-f", "tg", "1.0.0", `[package]\nname = "tg"\nversion = "1.0.0"\nlib = "target/lib.fsh"\n`, { "target/lib.fsh": `export function t(): i64 { return 1; }\n` });
  const cache = join(root, "cache-f");
  const dir = app("f", { tg: "^1.0.0" }, `import { t } from "tg";`, "t()");
  expect(build(dir, url, cache)).toEqual({ code: 0, err: "" });
  const lib = Bun.spawnSync(["find", cache, "-path", "*tg/1.0.0/*/target/lib.fsh"]).stdout.toString().trim();
  writeFileSync(lib, `export function t(): i64 { return 666; }\n`);
  expect(build(dir, url, cache, "--locked").code).toBe(0);
  expect(ran(join(dir, "target", "debug", "app"))).toBe("1\n");
});

test("the registry and the archive's own fish.toml must agree, and one name can't be two packages", () => {
  const cache = join(root, "cache-g");
  publish("reg-g", "helper", "1.0.0", `export function h(): i64 { return 1; }\n`);
  publish("reg-g", "helper", "2.0.0", `export function h(): i64 { return 2; }\n`);
  publishWith("reg-g", "liar", "1.0.0", `[package]\nname = "liar"\nversion = "1.0.0"\n[dependencies]\nhelper = { version = "^2.0.0" }\n`, { "src/lib.fsh": `import { h } from "helper";\nexport function l(): i64 { return h(); }\n` }, { helper: "^1.0.0" });
  const url = publish("reg-g", "greet", "1.0.0", `export function g(): i64 { return 5; }\n`, { util: "^1.0.0" });
  publish("reg-g", "util", "1.0.0", "");
  expect(build(app("g1", { liar: "^1.0.0" }, `import { l } from "liar";`, "l()"), url, cache).err).toBe("fish.toml:5:1: error: the registry lists other dependencies for 'liar' 1.0.0 than its own fish.toml declares");
  const clash = app("g2", { greet: "^1.0.0" }, `import { g } from "greet";`, "g()");
  writeFileSync(join(clash, "fish.toml"), `[package]\nname = "app"\nversion = "0.1.0"\n[dependencies]\ngreet = { version = "^1.0.0" }\nutil = { path = "../util" }\n`);
  mkdirSync(join(root, "apps", "util", "src"), { recursive: true });
  writeFileSync(join(root, "apps", "util", "fish.toml"), `[package]\nname = "util"\nversion = "1.0.0"\n`);
  writeFileSync(join(root, "apps", "util", "src", "lib.fsh"), "");
  expect(build(clash, url, cache).err).toBe("fish.toml:5:1: error: 'util' comes from the registry for a registry package's dependency, but already comes from '../util' in this program");
});

test("without a lock the index is read as it is now, and concurrent first builds share one clone", async () => {
  const cache = join(root, "cache-h");
  const url = publish("reg-h", "one", "1.0.0", "");
  expect(build(app("h1", { one: "^1.0.0" }, ``, "1"), url, cache)).toEqual({ code: 0, err: "" });
  publish("reg-h", "two", "1.0.0", `export function t(): i64 { return 2; }\n`);
  expect(build(app("h2", { two: "^1.0.0" }, `import { t } from "two";`, "t()"), url, cache)).toEqual({ code: 0, err: "" });
  const fresh = join(root, "cache-h2");
  const dirs = [0, 1, 2, 3, 4, 5].map((i) => app(`h3-${i}`, { two: "^1.0.0" }, `import { t } from "two";`, "t()"));
  const runs = dirs.map((dir) => Bun.spawn([process.execPath, MAIN, "build"], { cwd: dir, env: { ...process.env, FISH_REGISTRY: url, FISH_CACHE_DIR: fresh }, stderr: "pipe" }));
  expect(await Promise.all(runs.map(async (r) => [await r.exited, (await new Response(r.stderr).text()).split("\n")[0]]))).toEqual(dirs.map(() => [0, ""]));
}, 120_000);

test("resolution settles before refusing, long chains settle, and cycles are refused", () => {
  const reg = (name: string, packages: Record<string, string[]>) => openIndex(index(name, packages));
  const pick = (r: ReturnType<typeof openIndex>, roots: Record<string, string>) => Object.fromEntries([...resolveVersions(r, new Map(Object.entries(roots).map(([n, range]) => [n, [{ range, by: "app" }]])))].map(([n, e]) => [n, e.text]));
  const r = reg("settle", { xx: [line("xx", "1.0.0", { cc: "^1.0.0" }), line("xx", "2.0.0", { cc: "^2.0.0" })], yy: [line("yy", "1.0.0", { xx: "^1.0.0", cc: "^1.0.0" })], cc: [line("cc", "1.0.0"), line("cc", "2.0.0")] });
  expect(pick(r, { xx: "*", yy: "*" })).toEqual({ xx: "1.0.0", yy: "1.0.0", cc: "1.0.0" });
  const chain: Record<string, string[]> = {};
  for (let i = 0; i < 120; i++) chain[`p${i}`] = [line(`p${i}`, "1.0.0", i < 119 ? { [`p${i + 1}`]: "^1.0.0" } : {})];
  expect(Object.keys(pick(reg("chain", chain), { p0: "^1.0.0" })).length).toBe(120);
  const cache = join(root, "cache-i");
  publish("reg-i", "ca", "1.0.0", "", { cb: "^1.0.0" });
  const url = publish("reg-i", "cb", "1.0.0", "", { ca: "^1.0.0" });
  expect(build(app("i", { ca: "^1.0.0" }, ``, "1"), url, cache).err).toBe("fish.toml:5:1: error: the registry packages ca -> cb -> ca depend on each other in a cycle");
}, 60_000);

test("index versions are plain and unique, archives must be plain files, and GNU long names unpack", () => {
  const r = openIndex(index("plain", { vv: [line("vv", "v1.0.0")], dd: [line("dd", "1.0.0"), line("dd", "1.0.0")] }));
  expect(() => r.versions("vv")).toThrow(`malformed at line 1: its version isn't a semantic version written plainly, as in "1.2.0"`);
  expect(() => r.versions("dd")).toThrow("malformed at line 2: version 1.0.0 is listed twice");
  const cache = join(root, "cache-j");
  const url = publish("reg-j", "dev", "1.0.0", "");
  writeFileSync(join(root, "reg-j", "config.json"), JSON.stringify({ dl: "file:///dev/zero#{name}{version}" }));
  Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "dev"], { cwd: join(root, "reg-j") });
  expect(build(app("j", { dev: "^1.0.0" }, ``, "1"), url, cache).err).toBe("fish.toml:5:1: error: can't use 'dev' 1.0.0 from the registry: its archive at file:///dev/zero#dev1.0.0 isn't a file");
  const long = "src/" + "a".repeat(120) + ".fsh";
  const gnu = publishWith("reg-k", "gnu", "1.0.0", `[package]\nname = "gnu"\nversion = "1.0.0"\n`, { "src/lib.fsh": `export function g(): i64 { return 7; }\n`, [long]: "" });
  const pythonGnu = Bun.spawnSync(["python3", "-c", `import tarfile,sys\nt=tarfile.open('${join(root, "gnu.tgz")}','w:gz',format=tarfile.GNU_FORMAT)\nt.add('${join(root, "src-packages", "gnu", "1.0.0")}', arcname='.')\nt.close()`]);
  expect(pythonGnu.exitCode).toBe(0);
  const bytes = Bun.spawnSync(["cat", join(root, "gnu.tgz")]).stdout;
  writeFileSync(join(ARCHIVES, "gnu", "1.0.0.tar.gz"), bytes);
  const indexFile = join(root, "reg-k", "gn", "gnu");
  writeFileSync(indexFile, JSON.stringify({ name: "gnu", version: "1.0.0", dependencies: {}, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"), yanked: false }) + "\n");
  Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "gnu"], { cwd: join(root, "reg-k") });
  const dir = app("k", { gnu: "^1.0.0" }, `import { g } from "gnu";`, "g()");
  expect(build(dir, gnu, join(root, "cache-k"))).toEqual({ code: 0, err: "" });
  expect(ran(join(dir, "target", "debug", "app"))).toBe("7\n");
});

test("fishc add keeps CRLF and quoted headers, refuses empty ranges, and update refuses unknown names", () => {
  const url = publish("reg-l", "lib", "1.0.0", "");
  const cache = join(root, "cache-l");
  const dir = join(root, "apps", "l");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "fish.toml"), `[package]\r\nname = "l"\r\nversion = "0.1.0"\r\n["dependencies"]\r\n`);
  expect(fishc(dir, url, cache, "add", "lib").out).toBe("added lib ^1.0.0\n");
  expect(Bun.spawnSync(["cat", join(dir, "fish.toml")]).stdout.toString()).toBe(`[package]\r\nname = "l"\r\nversion = "0.1.0"\r\n["dependencies"]\r\nlib = { version = "^1.0.0" }\r\n`);
  expect(fishc(dir, url, cache, "add", "x@").err).toBe("fishc add: '' isn't a version range; write one as package.json does, as in ^1.2.0");
  expect(fishc(dir, url, cache, "update", "nosuch").err).toBe("fishc update: 'nosuch' isn't a dependency from the registry in fish.toml");
});

test("fishc add writes into a CRLF fish.toml with no last line end", () => {
  const url = publish("reg-m", "lib", "1.0.0", "");
  const dir = join(root, "apps", "m");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "fish.toml"), `[package]\r\nname = "m"\r\nversion = "0.1.0"\r\n[dependencies]\r\nother = { version = "^1.0.0" }`);
  expect(fishc(dir, url, join(root, "cache-m"), "add", "lib").out).toBe("added lib ^1.0.0\n");
  expect(Bun.spawnSync(["cat", join(dir, "fish.toml")]).stdout.toString()).toBe(`[package]\r\nname = "m"\r\nversion = "0.1.0"\r\n[dependencies]\r\nother = { version = "^1.0.0" }\r\nlib = { version = "^1.0.0" }`);
});
