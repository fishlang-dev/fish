import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { unsafeUses } from "../src/publish.ts";
import { untar } from "../src/tar.ts";

setDefaultTimeout(60_000);

const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const root = realpathSync(mkdtempSync(join(tmpdir(), "fish-publish-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// Runs git in `cwd` as a test author.
const gitIn = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd }).stdout.toString().trim();

// A package `name` in its own git repository holding `files`, committed.
function pkg(name: string, files: Record<string, string>, toml = `[package]\nname = "${name}"\nversion = "1.0.0"\n`): string {
  const dir = join(root, name);
  for (const [path, text] of Object.entries({ "fish.toml": toml, ...files })) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  gitIn(dir, "init", "-q");
  gitIn(dir, "add", ".");
  gitIn(dir, "commit", "-q", "-m", "first");
  return dir;
}

// Runs `fishc` with `args` in `dir`.
function fishc(dir: string, ...args: string[]) {
  const run = Bun.spawnSync([process.execPath, MAIN, ...args], { cwd: dir, env: { ...process.env, FISH_CACHE_DIR: join(root, "cache") } });
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString().trim() };
}

test("a dry run packs exactly the tracked files into a reproducible archive, and lists them", () => {
  const dir = pkg("words", { "src/lib.fsh": `export function w(): string { return "w"; }\n`, "README.md": "hi\n", "bin/run.sh": "#!/bin/sh\n", [`src/${"deep/".repeat(30)}x.fsh`]: "" });
  chmodSync(join(dir, "bin/run.sh"), 0o755);
  gitIn(dir, "add", ".");
  gitIn(dir, "commit", "-q", "-m", "exec");
  writeFileSync(join(dir, "untracked.txt"), "secret");
  const first = fishc(dir, "publish", "--dry-run");
  expect(first.code).toBe(0);
  expect(first.out).toMatch(/^packed words 1\.0\.0: 5 files, \d+ KiB, sha256 [0-9a-f]{64}\n  README\.md\n  bin\/run\.sh\n  fish\.toml\n  src\/(deep\/){30}x\.fsh\n  src\/lib\.fsh\nwrote target\/publish\/words-1\.0\.0\.tar\.gz\nno unsafe in words or its dependencies\n$/);
  const archive = Bun.spawnSync(["cat", join(dir, "target/publish/words-1.0.0.tar.gz")]).stdout;
  const unpacked = untar(new Uint8Array(gunzipSync(archive)), 1 << 30);
  expect(unpacked.map((f) => f.path)).toEqual(["README.md", "bin/run.sh", "fish.toml", `src/${"deep/".repeat(30)}x.fsh`, "src/lib.fsh"]);
  expect(fishc(dir, "publish", "--dry-run").out).toBe(first.out);
  const tarList = Bun.spawnSync(["tar", "-tvzf", join(dir, "target/publish/words-1.0.0.tar.gz")]).stdout.toString();
  expect(tarList).toContain("-rwxr-xr-x");
});

test("uncommitted changes, packages outside git, missing libs, links and non-registry dependencies are refused", () => {
  const dirty = pkg("dirty", { "src/lib.fsh": "" });
  writeFileSync(join(dirty, "src/lib.fsh"), "changed");
  expect(fishc(dirty, "publish", "--dry-run").err).toBe("fishc publish: these tracked files have changes not yet committed: src/lib.fsh; commit them, or publish with --allow-dirty");
  expect(fishc(dirty, "publish", "--dry-run", "--allow-dirty").code).toBe(0);
  const loose = join(root, "loose");
  mkdirSync(join(loose, "src"), { recursive: true });
  writeFileSync(join(loose, "fish.toml"), `[package]\nname = "loose"\nversion = "1.0.0"\n`);
  writeFileSync(join(loose, "src/lib.fsh"), "");
  expect(fishc(loose, "publish", "--dry-run").err).toBe(`fishc publish: the package at ${loose} isn't in a git repository; publishing packs the files git tracks`);
  const nolib = pkg("nolib", { "src/main.fsh": "" });
  expect(fishc(nolib, "publish", "--dry-run").err.split("\n")[0]).toBe(`fish.toml:1:1: error: the lib 'src/lib.fsh' doesn't exist; create it, or name another with lib = "..."`);
  const linked = pkg("linked", { "src/lib.fsh": "" });
  Bun.spawnSync(["ln", "-s", "/etc/hosts", join(linked, "hosts")]);
  gitIn(linked, "add", ".");
  gitIn(linked, "commit", "-q", "-m", "link");
  expect(fishc(linked, "publish", "--dry-run").err).toBe("fishc publish: 'hosts' is a symbolic link, which a package can't hold");
  const pathed = pkg("pathed", { "src/lib.fsh": "" }, `[package]\nname = "pathed"\nversion = "1.0.0"\n[dependencies]\nutil = { path = "../util" }\n`);
  expect(fishc(pathed, "publish", "--dry-run").err).toBe("fishc publish: 'util' is a path or git dependency, and a published package depends only on the registry; give it a version range");
  expect(fishc(pathed, "publish", "--yes").err).toBe("usage: fishc publish [--dry-run] [--allow-dirty] [--submit [--fork <url>] [--yes]]");
});

test("every unsafe block, unsafe expression and C declaration is found with its place", () => {
  const uses = unsafeUses([
    { path: "src/lib.fsh", text: `declare function strlen(s: Ptr<u8>): usize;\nexport function n(p: Ptr<u8>): usize {\n  const k = unsafe { strlen(p) };\n  unsafe {\n    strlen(p);\n  }\n  return k;\n}\n` },
    { path: "src/clean.fsh", text: `export function c(): i64 { return 1; }\n` },
    { path: "README.md", text: "unsafe { not fish }" },
  ]);
  expect(uses.map((u) => `${u.file}:${u.line}:${u.col} ${u.what}`)).toEqual(["src/lib.fsh:1:1 C declaration of 'strlen'", "src/lib.fsh:3:13 unsafe expression", "src/lib.fsh:4:3 unsafe block"]);
  expect(() => unsafeUses([{ path: "src/bad.fsh", text: "function (" }])).toThrow("src/bad.fsh doesn't parse:");
});

// A registry index at `name` whose packages are `lines`, committed, with archives at `archives`.
function index(name: string, lines: Record<string, object[]>): string {
  const at = join(root, name);
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, "config.json"), JSON.stringify({ dl: `file://${join(root, "archives")}/{name}/{version}.tar.gz` }));
  for (const [pkgName, entries] of Object.entries(lines)) {
    mkdirSync(join(at, pkgName.slice(0, 2)), { recursive: true });
    writeFileSync(join(at, pkgName.slice(0, 2), pkgName), entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
  gitIn(at, "init", "-q");
  gitIn(at, "add", ".");
  gitIn(at, "commit", "-q", "-m", "index");
  return `file://${at}`;
}

test("publish reports its own unsafe and dependencies the index marks, and fishc add notes a marked package", () => {
  const sha = "a".repeat(64);
  const url = index("unsafe-index", { ffi: [{ name: "ffi", version: "1.2.0", dependencies: {}, sha256: sha, yanked: false, unsafe: true }], pure: [{ name: "pure", version: "1.0.0", dependencies: {}, sha256: sha, yanked: false }] });
  const dir = pkg("cbind", { "src/lib.fsh": `declare function abs(n: i32): i32;\nexport function a(): i32 { return unsafe { abs(-5) }; }\n` }, `[package]\nname = "cbind"\nversion = "1.0.0"\n[dependencies]\nffi = { version = "^1.0.0" }\npure = { version = "^1.0.0" }\n`);
  const run = Bun.spawnSync([process.execPath, MAIN, "publish", "--dry-run"], { cwd: dir, env: { ...process.env, FISH_CACHE_DIR: join(root, "cache-u"), FISH_REGISTRY: url } });
  expect(run.stdout.toString().split("\n").filter((l) => l.startsWith("unsafe:"))).toEqual(["unsafe: src/lib.fsh:1:1 C declaration of 'abs'", "unsafe: src/lib.fsh:2:35 unsafe expression", "unsafe: the dependency 'ffi' 1.2.0 uses unsafe"]);
  const adder = pkg("adder", {});
  const added = Bun.spawnSync([process.execPath, MAIN, "add", "ffi"], { cwd: adder, env: { ...process.env, FISH_CACHE_DIR: join(root, "cache-u"), FISH_REGISTRY: url } });
  expect([added.stdout.toString(), added.stderr.toString()]).toEqual(["added ffi ^1.2.0\n", "note: 'ffi' 1.2.0 uses unsafe\n"]);
});

test("a build that brings a package marked unsafe into the lock says so, and records it", () => {
  const src = pkg("marked", { "src/lib.fsh": `export function m(): i64 { return 3; }\n` });
  const archive = Bun.spawnSync(["tar", "-cz", "-C", src, "fish.toml", "src"], { env: { ...process.env, COPYFILE_DISABLE: "1" } }).stdout;
  mkdirSync(join(root, "archives", "marked"), { recursive: true });
  writeFileSync(join(root, "archives", "marked", "1.0.0.tar.gz"), archive);
  const sha256 = new Bun.CryptoHasher("sha256").update(archive).digest("hex");
  const url = index("marked-index", { marked: [{ name: "marked", version: "1.0.0", dependencies: {}, sha256, yanked: false, unsafe: true }] });
  const app = pkg("uses-marked", { "src/main.fsh": `import { m } from "marked";\nfunction main() { console.log(m()); }\n` }, `[package]\nname = "app"\nversion = "0.1.0"\n[dependencies]\nmarked = { version = "^1.0.0" }\n`);
  const build = () => Bun.spawnSync([process.execPath, MAIN, "build"], { cwd: app, env: { ...process.env, FISH_CACHE_DIR: join(root, "cache-m"), FISH_REGISTRY: url } }).stderr.toString();
  expect(build()).toBe("note: 'marked' 1.0.0 from the registry uses unsafe\n");
  expect(Bun.spawnSync(["cat", join(app, "fish.lock")]).stdout.toString()).toContain(`name = "marked"\nversion = "1.0.0"\nsource = "registry+${url}"\nchecksum = "sha256:`);
  expect(Bun.spawnSync(["cat", join(app, "fish.lock")]).stdout.toString()).toEndWith("\nunsafe = true\n");
  expect(build()).toBe("");
});

// A home directory whose git config names an author, as publishing commits under the user's own.
function home(): string {
  const dir = join(root, "home");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".gitconfig"), "[user]\n\tname = Author\n\temail = author@example.com\n");
  return dir;
}

test("publish prepares the archive and its line on a branch of the index, and a build installs it from there", () => {
  const indexDir = join(root, "real-index");
  mkdirSync(indexDir, { recursive: true });
  writeFileSync(join(indexDir, "config.json"), JSON.stringify({ dl: `file://${join(root, "cache-p", "publish")}/greet-HASH/archives/{name}/{version}.tar.gz` }));
  gitIn(indexDir, "init", "-q", "-b", "main");
  gitIn(indexDir, "add", ".");
  gitIn(indexDir, "commit", "-q", "-m", "empty index");
  const url = `file://${indexDir}`;
  const dir = pkg("greet", { "src/lib.fsh": `export function greet(): string { return "hi from the registry"; }\n` });
  const env = { ...process.env, FISH_CACHE_DIR: join(root, "cache-p"), FISH_REGISTRY: url, HOME: home() };
  const run = Bun.spawnSync([process.execPath, MAIN, "publish"], { cwd: dir, env });
  const out = run.stdout.toString();
  expect([run.exitCode, run.stderr.toString()]).toEqual([0, ""]);
  const clone = /^prepared publish\/greet-1\.0\.0 in (\S+): archives\/greet\/1\.0\.0\.tar\.gz and its index line$/m.exec(out)![1]!;
  expect(out).toContain("run 'fishc publish --submit' to push it to your fork and open a pull request");
  expect(gitIn(clone, "log", "-1", "--format=%an %s")).toBe("Author greet 1.0.0");
  expect(gitIn(clone, "show", "--name-only", "--format=", "HEAD").split("\n")).toEqual(["archives/greet/1.0.0.tar.gz", "gr/greet"]);
  const line = JSON.parse(Bun.spawnSync(["cat", join(clone, "gr", "greet")]).stdout.toString());
  expect(line).toMatchObject({ name: "greet", version: "1.0.0", dependencies: {}, yanked: false, unsafe: false });
  const hash = clone.split("greet-")[1];
  writeFileSync(join(clone, "config.json"), JSON.stringify({ dl: `file://${clone}/archives/{name}/{version}.tar.gz` }));
  gitIn(clone, "commit", "-qam", "point dl at this clone");
  expect(hash).toMatch(/^[0-9a-f]{12}$/);
  const app = pkg("installs", { "src/main.fsh": `import { greet } from "greet";\nfunction main() { console.log(greet()); }\n` }, `[package]\nname = "app"\nversion = "0.1.0"\n[dependencies]\ngreet = { version = "^1.0.0" }\n`);
  const built = Bun.spawnSync([process.execPath, MAIN, "build"], { cwd: app, env: { ...env, FISH_CACHE_DIR: join(root, "cache-q"), FISH_REGISTRY: `file://${clone}` } });
  expect([built.exitCode, built.stderr.toString()]).toEqual([0, ""]);
  expect(Bun.spawnSync([join(app, "target", "debug", "app")]).stdout.toString()).toBe("hi from the registry\n");
  gitIn(indexDir, "fetch", "-q", clone, "publish/greet-1.0.0");
  gitIn(indexDir, "merge", "-q", "--ff-only", "FETCH_HEAD");
  const again = Bun.spawnSync([process.execPath, MAIN, "publish"], { cwd: dir, env });
  expect(again.stderr.toString().trim()).toBe("fishc publish: 'greet' 1.0.0 is already in the registry; raise the version in fish.toml to publish again");
});

// A directory for PATH holding git and, unless `gh` is undefined, a gh stub that records its
// arguments in `log` and runs `gh` as its shell body.
function bin(name: string, log: string, gh: string | undefined): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  Bun.spawnSync(["ln", "-sf", Bun.which("git")!, join(dir, "git")]);
  if (gh !== undefined) {
    writeFileSync(join(dir, "gh"), `#!/bin/sh\nprintf '%s\\n' "$@" >> '${log}'\n${gh}\n`);
    chmodSync(join(dir, "gh"), 0o755);
  }
  return dir;
}

test("--submit asks, pushes the prepared branch to the fork and opens a pull request with gh", () => {
  const indexDir = join(root, "submit-index");
  mkdirSync(indexDir, { recursive: true });
  writeFileSync(join(indexDir, "config.json"), JSON.stringify({ dl: "file:///nowhere/{name}/{version}.tar.gz" }));
  gitIn(indexDir, "init", "-q", "-b", "main");
  gitIn(indexDir, "add", ".");
  gitIn(indexDir, "commit", "-q", "-m", "empty index");
  const fork = join(root, "fork.git");
  gitIn(root, "init", "-q", "--bare", fork);
  const dir = pkg("sent", { "src/lib.fsh": "export function f(): i64 { return 1; }\n" });
  const log = join(root, "gh.log");
  const env = (path: string) => ({ ...process.env, PATH: path, FISH_CACHE_DIR: join(root, "cache-s"), FISH_REGISTRY: `file://${indexDir}`, HOME: home() });
  const submit = (path: string, ...args: string[]) => {
    const run = Bun.spawnSync([process.execPath, MAIN, "publish", "--submit", "--fork", fork, ...args], { cwd: dir, env: env(path), stdin: Buffer.from("n\n") });
    return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString().trim() };
  };
  const kept = "the release is still prepared on publish/sent-1.0.0";
  const noGh = submit(bin("bin-none", log, undefined), "--yes");
  expect(noGh.err).toBe("fishc publish: submitting needs GitHub's gh command, which isn't on PATH; install it, or push the prepared branch and open the pull request yourself");
  const ok = bin("bin-ok", log, "echo https://github.com/fishlang-dev/registry/pull/7");
  const declined = submit(ok);
  expect(declined.err).toBe(`fishc publish: nothing was pushed; ${kept}`);
  expect(gitIn(fork, "branch", "--list")).toBe("");
  const badFork = Bun.spawnSync([process.execPath, MAIN, "publish", "--submit", "--fork", join(root, "no-such-fork"), "--yes"], { cwd: dir, env: env(ok) });
  expect(badFork.stderr.toString()).toContain(`can't push to ${join(root, "no-such-fork")}: `);
  expect(badFork.stderr.toString().trim()).toEndWith(kept);
  writeFileSync(log, "");
  const sent = submit(ok, "--yes");
  expect([sent.code, sent.err]).toEqual([0, ""]);
  expect(sent.out).toEndWith("opened https://github.com/fishlang-dev/registry/pull/7\n");
  expect(gitIn(fork, "log", "-1", "--format=%s", "publish/sent-1.0.0")).toBe("sent 1.0.0");
  const args = Bun.spawnSync(["cat", log]).stdout.toString().split("\n");
  expect(args.slice(0, 8)).toEqual(["pr", "create", "--base", "main", "--head", "publish/sent-1.0.0", "--title", "sent 1.0.0"]);
  const failing = submit(bin("bin-fail", log, "echo 'HTTP 403: no access' >&2; exit 1"), "--yes");
  expect(failing.err).toBe(`fishc publish: gh pr create failed: HTTP 403: no access; ${kept}`);
  const moved = submit(ok, "--yes", "--allow-dirty");
  expect([moved.code, moved.err]).toEqual([0, ""]);
  writeFileSync(join(dir, "src/lib.fsh"), "export function f(): i64 { return 2; }\n");
  const rejected = submit(ok, "--yes", "--allow-dirty");
  expect(rejected.err).toStartWith(`fishc publish: can't push to ${fork}: ! [rejected]`);
});

test("a lib or import git doesn't track, and a dirty link or deleted file, are refused", () => {
  const nolib = pkg("untracked-lib", { "src/lib.fsh": "export function f(): i64 { return 1; }\n" });
  gitIn(nolib, "rm", "-q", "--cached", "src/lib.fsh");
  gitIn(nolib, "commit", "-q", "-m", "untrack");
  expect(fishc(nolib, "publish", "--dry-run").err).toBe("fishc publish: git doesn't track the lib 'src/lib.fsh', so the archive would leave it out; add and commit it");
  const noimport = pkg("untracked-import", { "src/lib.fsh": `import { g } from "./util/g";\nexport function f(): i64 { return g(); }\n` });
  mkdirSync(join(noimport, "src/util"));
  writeFileSync(join(noimport, "src/util/g.fsh"), "export function g(): i64 { return 1; }\n");
  expect(fishc(noimport, "publish", "--dry-run").err).toBe("fishc publish: 'src/lib.fsh' imports './util/g', which the archive doesn't hold; if git doesn't track it, add and commit it");
  gitIn(noimport, "add", ".");
  gitIn(noimport, "commit", "-q", "-m", "track");
  expect(fishc(noimport, "publish", "--dry-run").code).toBe(0);
  const dirty = pkg("dirty-link", { "src/lib.fsh": "export function f(): i64 { return 1; }\n", "NOTES.txt": "notes\n" });
  rmSync(join(dirty, "NOTES.txt"));
  expect(fishc(dirty, "publish", "--dry-run", "--allow-dirty").err).toBe("fishc publish: git tracks 'NOTES.txt' but it has been deleted; commit the deletion or restore it");
  Bun.spawnSync(["ln", "-s", "/etc/hosts", join(dirty, "NOTES.txt")]);
  expect(fishc(dirty, "publish", "--dry-run", "--allow-dirty").err).toBe("fishc publish: 'NOTES.txt' is a symbolic link, leads through one, or isn't a plain file, which a package can't hold");
  const linkedDir = pkg("dirty-dir", { "src/lib.fsh": "export function f(): i64 { return 1; }\n", "docs/a.txt": "a\n" });
  const outside = join(root, "outside-docs");
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "a.txt"), "secret\n");
  rmSync(join(linkedDir, "docs"), { recursive: true });
  Bun.spawnSync(["ln", "-s", outside, join(linkedDir, "docs")]);
  expect(fishc(linkedDir, "publish", "--dry-run", "--allow-dirty").err).toBe("fishc publish: 'docs/a.txt' is a symbolic link, leads through one, or isn't a plain file, which a package can't hold");
  const broken = pkg("broken-import", { "src/lib.fsh": `import { g } from "./g";\nexport function f(): i64 { return g(); }\n`, "src/g.fsh": "export function g(: i64 {}\n" });
  expect(fishc(broken, "publish", "--dry-run").err).toStartWith("fishc publish: src/g.fsh doesn't parse: ");
  const escaping = pkg("escaping-import", { "src/lib.fsh": `import { g } from "../../../../../../../../../../../../tmp/g";\nexport function f(): i64 { return g(); }\n` });
  expect(fishc(escaping, "publish", "--dry-run").err).toBe("fishc publish: 'src/lib.fsh' imports '../../../../../../../../../../../../tmp/g', which the archive doesn't hold; if git doesn't track it, add and commit it");
});

test("--submit to a GitHub index asks before forking, and pushes the same release again after the index moves", () => {
  const indexDir = join(root, "gh-index");
  mkdirSync(indexDir, { recursive: true });
  writeFileSync(join(indexDir, "config.json"), JSON.stringify({ dl: "file:///nowhere/{name}/{version}.tar.gz" }));
  gitIn(indexDir, "init", "-q", "-b", "main");
  gitIn(indexDir, "add", ".");
  gitIn(indexDir, "commit", "-q", "-m", "empty index");
  const fork = join(root, "gh-fork.git");
  gitIn(root, "init", "-q", "--bare", fork);
  // GitHub's URLs led to local repositories, so nothing leaves the machine.
  const ghHome = join(root, "gh-home");
  mkdirSync(ghHome, { recursive: true });
  writeFileSync(join(ghHome, ".gitconfig"), `[user]\n\tname = Author\n\temail = a@example.com\n[url "file://${indexDir}"]\n\tinsteadOf = https://github.com/fishlang-dev/registry\n[url "file://${fork}"]\n\tinsteadOf = https://github.com/tester/registry.git\n`);
  const log = join(root, "gh2.log");
  const path = bin("bin-gh", log, `case "$1" in api) echo tester;; pr) echo https://github.com/fishlang-dev/registry/pull/9;; esac`);
  const dir = pkg("forked", { "src/lib.fsh": "export function f(): i64 { return 1; }\n" });
  const submit = (...args: string[]) => {
    const run = Bun.spawnSync([process.execPath, MAIN, "publish", "--submit", ...args], { cwd: dir, env: { ...process.env, PATH: path, HOME: ghHome, FISH_CACHE_DIR: join(root, "cache-g"), FISH_REGISTRY: "https://github.com/fishlang-dev/registry" }, stdin: Buffer.from("n\n") });
    return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString().trim() };
  };
  writeFileSync(log, "");
  expect(submit().err).toBe("fishc publish: nothing was pushed; the release is still prepared on publish/forked-1.0.0");
  expect(Bun.spawnSync(["cat", log]).stdout.toString()).not.toContain("fork");
  const sent = submit("--yes");
  expect([sent.code, sent.err]).toEqual([0, ""]);
  const calls = Bun.spawnSync(["cat", log]).stdout.toString().split("\n");
  expect(calls.slice(calls.indexOf("repo"), calls.indexOf("repo") + 3)).toEqual(["repo", "fork", "fishlang-dev/registry"]);
  expect(calls.slice(calls.indexOf("pr"), calls.indexOf("pr") + 8)).toEqual(["pr", "create", "--repo", "fishlang-dev/registry", "--base", "main", "--head", "tester:publish/forked-1.0.0"]);
  const pushed = gitIn(fork, "rev-parse", "publish/forked-1.0.0");
  writeFileSync(join(indexDir, "other"), "another release\n");
  gitIn(indexDir, "add", ".");
  gitIn(indexDir, "commit", "-q", "-m", "another release");
  const again = submit("--yes");
  expect([again.code, again.err]).toEqual([0, ""]);
  expect(gitIn(fork, "rev-parse", "publish/forked-1.0.0")).toBe(pushed);
  // A branch left at its base, as by a commit that failed, is prepared afresh rather than reused.
  const clone = join(root, "cache-g", "publish", readdirSync(join(root, "cache-g", "publish"))[0]!);
  gitIn(clone, "reset", "-q", "--hard", "origin/HEAD");
  const retried = Bun.spawnSync([process.execPath, MAIN, "publish"], { cwd: dir, env: { ...process.env, PATH: path, HOME: ghHome, FISH_CACHE_DIR: join(root, "cache-g"), FISH_REGISTRY: "https://github.com/fishlang-dev/registry" } });
  expect([retried.exitCode, retried.stderr.toString()]).toEqual([0, ""]);
});
