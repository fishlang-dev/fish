// Ports tests/publish.test.ts: `fishc publish` run as the native fishc on packages in git
// repositories of a scratch directory, against registry indexes that are local git repositories
// and a gh stub, so nothing leaves the machine. The archive is unpacked in process through the
// compiler's tar module, which imports nothing else. The Bun test's direct calls of `unsafeUses`
// are made through `fishc publish --dry-run`, which prints every use it finds and refuses a file
// that doesn't parse.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { untar } from "../compiler/tar.fsh";
import { fishcPath, read, removed, same, scratch, text } from "./support.fsh";

type Ran = { code: i64; out: string; err: string };

// Runs git in `cwd` as a test author.
function gitIn(cwd: string, args: string[]): string {
  return text(spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd }).stdout).trim();
}

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

function made(path: string): void {
  try {
    mkdirSync(path, { recursive: true });
  } catch (e) {
    assert(false, `can't make ${path}: ${e.message}`);
  }
}

function gone(path: string): void {
  try {
    rmSync(path, { recursive: true });
  } catch (e) {
    assert(false, `can't remove ${path}: ${e.message}`);
  }
}

function defaultToml(name: string): string {
  return `[package]\nname = "${name}"\nversion = "1.0.0"\n`;
}

// A package `name` under `root` in its own git repository holding `files`, committed.
function pkg(root: string, name: string, files: Ref<[string, string][]>, toml: string = defaultToml(name)): string {
  const dir = join(root, name);
  write(join(dir, "fish.toml"), toml);
  for (const [path, contents] of files) write(join(dir, path), contents);
  gitIn(dir, ["init", "-q"]);
  gitIn(dir, ["add", "."]);
  gitIn(dir, ["commit", "-q", "-m", "first"]);
  return dir;
}

// Runs fishc with `args` in `dir`, with `vars` set and `stdin` piped in.
function run(dir: string, args: string[], vars: Ref<string[]>, stdin: string = ""): Ran {
  const r = spawnSync("env", [...vars, fishcPath(), ...args], { cwd: dir, input: stdin });
  return { code: r.status ?? -1, out: text(r.stdout), err: text(r.stderr) };
}

// Runs fishc with `args` in `dir` with the shared cache, stderr trimmed.
function fishc(root: string, dir: string, args: string[]): Ran {
  const r = run(dir, args, [`FISH_CACHE_DIR=${join(root, "cache")}`]);
  return { code: r.code, out: r.out, err: r.err.trim() };
}

function sha256(bytes: Ref<u8[]>): string {
  return createHash("sha256").update(bytes.clone()).digest("hex");
}

test("a dry run packs exactly the tracked files into a reproducible archive, and lists them", () => {
  const root = scratch("fish-publish-");
  const deep = `src/${"deep/".repeat(30)}x.fsh`;
  const dir = pkg(root, "words", [["src/lib.fsh", `export function w(): string { return "w"; }\n`], ["README.md", "hi\n"], ["bin/run.sh", "#!/bin/sh\n"], [deep, ""]]);
  try {
    chmodSync(join(dir, "bin/run.sh"), 0o755);
  } catch (e) {
    assert(false, e.message);
  }
  gitIn(dir, ["add", "."]);
  gitIn(dir, ["commit", "-q", "-m", "exec"]);
  write(join(dir, "untracked.txt"), "secret");
  const first = fishc(root, dir, ["publish", "--dry-run"]);
  assert(first.code === 0, `the dry run exited with ${first.code}: ${first.err}`);
  assert(/^packed words 1\.0\.0: 5 files, \d+ KiB, sha256 [0-9a-f]{64}\n  README\.md\n  bin\/run\.sh\n  fish\.toml\n  src\/(deep\/){30}x\.fsh\n  src\/lib\.fsh\nwrote target\/publish\/words-1\.0\.0\.tar\.gz\nno unsafe in words or its dependencies\n$/.test(first.out), `the dry run printed:\n${first.out}`);
  try {
    const archive = readFileSync(join(dir, "target/publish/words-1.0.0.tar.gz"));
    const unpacked = untar(new Uint8Array(gunzipSync(archive)), 1 << 30);
    same(unpacked.map((f) => f.path).join("\n"), ["README.md", "bin/run.sh", "fish.toml", deep, "src/lib.fsh"].join("\n"), "the archive's files");
  } catch (e) {
    assert(false, `can't unpack the archive: ${e.message}`);
  }
  same(fishc(root, dir, ["publish", "--dry-run"]).out, first.out, "the second dry run");
  const tarList = text(spawnSync("tar", ["-tvzf", join(dir, "target/publish/words-1.0.0.tar.gz")]).stdout);
  assert(tarList.includes("-rwxr-xr-x"), `tar lists:\n${tarList}`);
  removed(root);
}, { timeout: 60_000 });

test("uncommitted changes, packages outside git, missing libs, links and non-registry dependencies are refused", () => {
  const root = scratch("fish-publish-");
  const dirty = pkg(root, "dirty", [["src/lib.fsh", ""]]);
  write(join(dirty, "src/lib.fsh"), "changed");
  same(fishc(root, dirty, ["publish", "--dry-run"]).err, "fishc publish: these tracked files have changes not yet committed: src/lib.fsh; commit them, or publish with --allow-dirty", "a dirty package");
  const allowed = fishc(root, dirty, ["publish", "--dry-run", "--allow-dirty"]);
  assert(allowed.code === 0, `--allow-dirty exited with ${allowed.code}: ${allowed.err}`);
  const loose = join(root, "loose");
  write(join(loose, "fish.toml"), `[package]\nname = "loose"\nversion = "1.0.0"\n`);
  write(join(loose, "src/lib.fsh"), "");
  same(fishc(root, loose, ["publish", "--dry-run"]).err, `fishc publish: the package at ${loose} isn't in a git repository; publishing packs the files git tracks`, "a package outside git");
  const nolib = pkg(root, "nolib", [["src/main.fsh", ""]]);
  same(fishc(root, nolib, ["publish", "--dry-run"]).err.split("\n")[0], `fish.toml:1:1: error[E0905]: the lib 'src/lib.fsh' doesn't exist; create it, or name another with lib = "..."`, "no lib");
  const linked = pkg(root, "linked", [["src/lib.fsh", ""]]);
  spawnSync("ln", ["-s", "/etc/hosts", join(linked, "hosts")]);
  gitIn(linked, ["add", "."]);
  gitIn(linked, ["commit", "-q", "-m", "link"]);
  same(fishc(root, linked, ["publish", "--dry-run"]).err, "fishc publish: 'hosts' is a symbolic link, which a package can't hold", "a link");
  const pathed = pkg(root, "pathed", [["src/lib.fsh", ""]], `[package]\nname = "pathed"\nversion = "1.0.0"\n[dependencies]\nutil = { path = "../util" }\n`);
  same(fishc(root, pathed, ["publish", "--dry-run"]).err, "fishc publish: 'util' is a path or git dependency, and a published package depends only on the registry; give it a version range", "a path dependency");
  same(fishc(root, pathed, ["publish", "--yes"]).err, "usage: fishc publish [--dry-run] [--allow-dirty] [--submit [--fork <url>] [--yes]]", "--yes without --submit");
  removed(root);
}, { timeout: 60_000 });

test("every unsafe block, unsafe expression and C declaration is found with its place", () => {
  const root = scratch("fish-publish-");
  const dir = pkg(root, "uses", [
    ["src/lib.fsh", `declare function strlen(s: Ptr<u8>): usize;\nexport function n(p: Ptr<u8>): usize {\n  const k = unsafe { strlen(p) };\n  unsafe {\n    strlen(p);\n  }\n  return k;\n}\n`],
    ["src/clean.fsh", `export function c(): i64 { return 1; }\n`],
    ["README.md", "unsafe { not fish }"],
  ]);
  const listed = fishc(root, dir, ["publish", "--dry-run"]);
  same(listed.out.split("\n").filter((l) => l.startsWith("unsafe:")).join("\n"), ["unsafe: src/lib.fsh:1:1 C declaration of 'strlen'", "unsafe: src/lib.fsh:3:13 unsafe expression", "unsafe: src/lib.fsh:4:3 unsafe block"].join("\n"), `the uses found (stderr: ${listed.err})`);
  const bad = pkg(root, "bad", [["src/lib.fsh", ""], ["src/bad.fsh", "function ("]]);
  const refused = fishc(root, bad, ["publish", "--dry-run"]).err;
  assert(refused.includes("src/bad.fsh doesn't parse:"), `a file that doesn't parse: ${refused}`);
  removed(root);
}, { timeout: 60_000 });

// A registry index at `name` under `root` whose packages are `lines`, each a JSON line, committed,
// with archives under `root`'s archives folder.
function index(root: string, name: string, lines: Ref<[string, string[]][]>): string {
  const at = join(root, name);
  write(join(at, "config.json"), JSON.stringify({ dl: `file://${join(root, "archives")}/{name}/{version}.tar.gz` }));
  for (const [pkgName, entries] of lines) write(join(at, pkgName.slice(0, 2), pkgName), entries.join("\n") + "\n");
  gitIn(at, ["init", "-q"]);
  gitIn(at, ["add", "."]);
  gitIn(at, ["commit", "-q", "-m", "index"]);
  return `file://${at}`;
}

function entry(name: string, version: string, sha: string, unsafe: boolean | null): string {
  const flag = unsafe === null ? "" : `,"unsafe":${unsafe}`;
  return `{"name":${JSON.stringify(name)},"version":${JSON.stringify(version)},"dependencies":{},"sha256":${JSON.stringify(sha)},"yanked":false${flag}}`;
}

test("publish reports its own unsafe and dependencies the index marks, and fishc add notes a marked package", () => {
  const root = scratch("fish-publish-");
  const sha = "a".repeat(64);
  const url = index(root, "unsafe-index", [["ffi", [entry("ffi", "1.2.0", sha, true)]], ["pure", [entry("pure", "1.0.0", sha, null)]]]);
  const dir = pkg(root, "cbind", [["src/lib.fsh", `declare function abs(n: i32): i32;\nexport function a(): i32 { return unsafe { abs(-5) }; }\n`]], `[package]\nname = "cbind"\nversion = "1.0.0"\n[dependencies]\nffi = { version = "^1.0.0" }\npure = { version = "^1.0.0" }\n`);
  const vars = [`FISH_CACHE_DIR=${join(root, "cache-u")}`, `FISH_REGISTRY=${url}`];
  const r = run(dir, ["publish", "--dry-run"], vars);
  same(r.out.split("\n").filter((l) => l.startsWith("unsafe:")).join("\n"), ["unsafe: src/lib.fsh:1:1 C declaration of 'abs'", "unsafe: src/lib.fsh:2:35 unsafe expression", "unsafe: the dependency 'ffi' 1.2.0 uses unsafe"].join("\n"), `the uses found (stderr: ${r.err})`);
  const adder = pkg(root, "adder", []);
  const added = run(adder, ["add", "ffi"], vars);
  same(`${added.out}|${added.err}`, "added ffi ^1.2.0\n|note: 'ffi' 1.2.0 uses unsafe\n", "fishc add");
  removed(root);
}, { timeout: 60_000 });

test("a build that brings a package marked unsafe into the lock says so, and records it", () => {
  const root = scratch("fish-publish-");
  const src = pkg(root, "marked", [["src/lib.fsh", `export function m(): i64 { return 3; }\n`]]);
  const archive = spawnSync("env", ["COPYFILE_DISABLE=1", "tar", "-cz", "-C", src, "fish.toml", "src"]).stdout;
  writeBytes(join(root, "archives", "marked", "1.0.0.tar.gz"), archive);
  const url = index(root, "marked-index", [["marked", [entry("marked", "1.0.0", sha256(archive), true)]]]);
  const app = pkg(root, "uses-marked", [["src/main.fsh", `import { m } from "marked";\nfunction main() { console.log(m()); }\n`]], `[package]\nname = "app"\nversion = "0.1.0"\n[dependencies]\nmarked = { version = "^1.0.0" }\n`);
  const vars = [`FISH_CACHE_DIR=${join(root, "cache-m")}`, `FISH_REGISTRY=${url}`];
  same(run(app, ["build"], vars).err, "note: 'marked' 1.0.0 from the registry uses unsafe\n", "the first build");
  const lock = read(join(app, "fish.lock"));
  assert(lock.includes(`name = "marked"\nversion = "1.0.0"\nsource = "registry+${url}"\nchecksum = "sha256:`), `the lock:\n${lock}`);
  assert(lock.endsWith("\nunsafe = true\n"), `the lock:\n${lock}`);
  same(run(app, ["build"], vars).err, "", "the second build");
  removed(root);
}, { timeout: 60_000 });

// A home directory whose git config names an author, as publishing commits under the user's own.
function home(root: string): string {
  const dir = join(root, "home");
  write(join(dir, ".gitconfig"), "[user]\n\tname = Author\n\temail = author@example.com\n");
  return dir;
}

// An empty index at `name` under `root`, on a main branch, whose archives are at `dl`.
function emptyIndex(root: string, name: string, dl: string): string {
  const indexDir = join(root, name);
  write(join(indexDir, "config.json"), JSON.stringify({ dl }));
  gitIn(indexDir, ["init", "-q", "-b", "main"]);
  gitIn(indexDir, ["add", "."]);
  gitIn(indexDir, ["commit", "-q", "-m", "empty index"]);
  return indexDir;
}

type IndexLine = { name: string; version: string; dependencies: Map<string, string>; yanked: boolean; unsafe: boolean };

test("publish prepares the archive and its line on a branch of the index, and a build installs it from there", () => {
  const root = scratch("fish-publish-");
  const indexDir = emptyIndex(root, "real-index", `file://${join(root, "cache-p", "publish")}/greet-HASH/archives/{name}/{version}.tar.gz`);
  const url = `file://${indexDir}`;
  const dir = pkg(root, "greet", [["src/lib.fsh", `export function greet(): string { return "hi from the registry"; }\n`]]);
  const vars = [`FISH_CACHE_DIR=${join(root, "cache-p")}`, `FISH_REGISTRY=${url}`, `HOME=${home(root)}`];
  const r = run(dir, ["publish"], vars);
  assert(r.code === 0 && r.err === "", `publish exited with ${r.code}: ${r.err}`);
  const m = /^prepared publish\/greet-1\.0\.0 in (\S+): archives\/greet\/1\.0\.0\.tar\.gz and its index line$/m.exec(r.out);
  assert(m !== null, `publish printed:\n${r.out}`);
  const clone = m![1];
  assert(r.out.includes("run 'fishc publish --submit' to push it to your fork and open a pull request"), `publish printed:\n${r.out}`);
  same(gitIn(clone, ["log", "-1", "--format=%an %s"]), "Author greet 1.0.0", "the commit");
  same(gitIn(clone, ["show", "--name-only", "--format=", "HEAD"]), "archives/greet/1.0.0.tar.gz\ngr/greet", "the commit's files");
  const written = read(join(clone, "gr", "greet"));
  try {
    const line = JSON.parse<IndexLine>(written);
    assert(line.name === "greet" && line.version === "1.0.0" && line.dependencies.size === 0 && !line.yanked && !line.unsafe, `the index line: ${written}`);
  } catch (e) {
    assert(false, `the index line isn't one: ${e.message}: ${written}`);
  }
  const hash = clone.split("greet-")[1];
  write(join(clone, "config.json"), JSON.stringify({ dl: `file://${clone}/archives/{name}/{version}.tar.gz` }));
  gitIn(clone, ["commit", "-qam", "point dl at this clone"]);
  assert(/^[0-9a-f]{12}$/.test(hash), `the clone's hash: ${hash}`);
  const app = pkg(root, "installs", [["src/main.fsh", `import { greet } from "greet";\nfunction main() { console.log(greet()); }\n`]], `[package]\nname = "app"\nversion = "0.1.0"\n[dependencies]\ngreet = { version = "^1.0.0" }\n`);
  const b = run(app, ["build"], [`FISH_CACHE_DIR=${join(root, "cache-q")}`, `FISH_REGISTRY=file://${clone}`, `HOME=${home(root)}`]);
  assert(b.code === 0 && b.err === "", `the build exited with ${b.code}: ${b.err}`);
  same(text(spawnSync(join(app, "target", "debug", "app"), []).stdout), "hi from the registry\n", "the program");
  gitIn(indexDir, ["fetch", "-q", clone, "publish/greet-1.0.0"]);
  gitIn(indexDir, ["merge", "-q", "--ff-only", "FETCH_HEAD"]);
  same(run(dir, ["publish"], vars).err.trim(), "fishc publish: 'greet' 1.0.0 is already in the registry; raise the version in fish.toml to publish again", "publishing again");
  removed(root);
}, { timeout: 60_000 });

// A directory for PATH holding git and, unless `gh` is null, a gh stub that records its arguments
// in `log` and runs `gh` as its shell body.
function bin(root: string, name: string, log: string, gh: string | null): string {
  const dir = join(root, name);
  made(dir);
  const git = Bun.which("git");
  assert(git !== null, "no git on PATH");
  spawnSync("ln", ["-sf", git!, join(dir, "git")]);
  if (gh !== null) {
    write(join(dir, "gh"), `#!/bin/sh\nprintf '%s\\n' "$@" >> '${log}'\n${gh}\n`);
    try {
      chmodSync(join(dir, "gh"), 0o755);
    } catch (e) {
      assert(false, e.message);
    }
  }
  return dir;
}

test("--submit asks, pushes the prepared branch to the fork and opens a pull request with gh", () => {
  const root = scratch("fish-publish-");
  const indexDir = emptyIndex(root, "submit-index", "file:///nowhere/{name}/{version}.tar.gz");
  const fork = join(root, "fork.git");
  gitIn(root, ["init", "-q", "--bare", fork]);
  const dir = pkg(root, "sent", [["src/lib.fsh", "export function f(): i64 { return 1; }\n"]]);
  const log = join(root, "gh.log");
  const vars = (path: string): string[] => [`PATH=${path}`, `FISH_CACHE_DIR=${join(root, "cache-s")}`, `FISH_REGISTRY=file://${indexDir}`, `HOME=${home(root)}`];
  const submit = (path: string, args: string[]): Ran => {
    const r = run(dir, ["publish", "--submit", "--fork", fork, ...args], vars(path), "n\n");
    return { code: r.code, out: r.out, err: r.err.trim() };
  };
  const kept = "the release is still prepared on publish/sent-1.0.0";
  same(submit(bin(root, "bin-none", log, null), ["--yes"]).err, "fishc publish: submitting needs GitHub's gh command, which isn't on PATH; install it, or push the prepared branch and open the pull request yourself", "no gh");
  const ok = bin(root, "bin-ok", log, "echo https://github.com/fishlang-dev/registry/pull/7");
  same(submit(ok, []).err, `fishc publish: nothing was pushed; ${kept}`, "declining");
  same(gitIn(fork, ["branch", "--list"]), "", "the fork's branches");
  const badFork = run(dir, ["publish", "--submit", "--fork", join(root, "no-such-fork"), "--yes"], vars(ok));
  assert(badFork.err.includes(`can't push to ${join(root, "no-such-fork")}: `), `a missing fork: ${badFork.err}`);
  assert(badFork.err.trim().endsWith(kept), `a missing fork: ${badFork.err}`);
  write(log, "");
  const sent = submit(ok, ["--yes"]);
  assert(sent.code === 0 && sent.err === "", `submitting exited with ${sent.code}: ${sent.err}`);
  assert(sent.out.endsWith("opened https://github.com/fishlang-dev/registry/pull/7\n"), `submitting printed:\n${sent.out}`);
  same(gitIn(fork, ["log", "-1", "--format=%s", "publish/sent-1.0.0"]), "sent 1.0.0", "the pushed commit");
  const args = read(log).split("\n");
  same(args.slice(0, 8).join(" "), "pr create --base main --head publish/sent-1.0.0 --title sent 1.0.0", "gh's arguments");
  same(submit(bin(root, "bin-fail", log, "echo 'HTTP 403: no access' >&2; exit 1"), ["--yes"]).err, `fishc publish: gh pr create failed: HTTP 403: no access; ${kept}`, "gh failing");
  const moved = submit(ok, ["--yes", "--allow-dirty"]);
  assert(moved.code === 0 && moved.err === "", `submitting again exited with ${moved.code}: ${moved.err}`);
  write(join(dir, "src/lib.fsh"), "export function f(): i64 { return 2; }\n");
  const rejected = submit(ok, ["--yes", "--allow-dirty"]).err;
  assert(rejected.startsWith(`fishc publish: can't push to ${fork}: ! [rejected]`), `a changed release: ${rejected}`);
  removed(root);
}, { timeout: 60_000 });

test("a lib or import git doesn't track, and a dirty link or deleted file, are refused", () => {
  const root = scratch("fish-publish-");
  const nolib = pkg(root, "untracked-lib", [["src/lib.fsh", "export function f(): i64 { return 1; }\n"]]);
  gitIn(nolib, ["rm", "-q", "--cached", "src/lib.fsh"]);
  gitIn(nolib, ["commit", "-q", "-m", "untrack"]);
  same(fishc(root, nolib, ["publish", "--dry-run"]).err, "fishc publish: git doesn't track the lib 'src/lib.fsh', so the archive would leave it out; add and commit it", "an untracked lib");
  const noimport = pkg(root, "untracked-import", [["src/lib.fsh", `import { g } from "./util/g";\nexport function f(): i64 { return g(); }\n`]]);
  write(join(noimport, "src/util/g.fsh"), "export function g(): i64 { return 1; }\n");
  same(fishc(root, noimport, ["publish", "--dry-run"]).err, "fishc publish: 'src/lib.fsh' imports './util/g', which the archive doesn't hold; if git doesn't track it, add and commit it", "an untracked import");
  gitIn(noimport, ["add", "."]);
  gitIn(noimport, ["commit", "-q", "-m", "track"]);
  const tracked = fishc(root, noimport, ["publish", "--dry-run"]);
  assert(tracked.code === 0, `the tracked import exited with ${tracked.code}: ${tracked.err}`);
  const dirty = pkg(root, "dirty-link", [["src/lib.fsh", "export function f(): i64 { return 1; }\n"], ["NOTES.txt", "notes\n"]]);
  gone(join(dirty, "NOTES.txt"));
  same(fishc(root, dirty, ["publish", "--dry-run", "--allow-dirty"]).err, "fishc publish: git tracks 'NOTES.txt' but it has been deleted; commit the deletion or restore it", "a deleted file");
  spawnSync("ln", ["-s", "/etc/hosts", join(dirty, "NOTES.txt")]);
  same(fishc(root, dirty, ["publish", "--dry-run", "--allow-dirty"]).err, "fishc publish: 'NOTES.txt' is a symbolic link, leads through one, or isn't a plain file, which a package can't hold", "a file become a link");
  const linkedDir = pkg(root, "dirty-dir", [["src/lib.fsh", "export function f(): i64 { return 1; }\n"], ["docs/a.txt", "a\n"]]);
  const outside = join(root, "outside-docs");
  write(join(outside, "a.txt"), "secret\n");
  gone(join(linkedDir, "docs"));
  spawnSync("ln", ["-s", outside, join(linkedDir, "docs")]);
  same(fishc(root, linkedDir, ["publish", "--dry-run", "--allow-dirty"]).err, "fishc publish: 'docs/a.txt' is a symbolic link, leads through one, or isn't a plain file, which a package can't hold", "a directory become a link");
  const broken = pkg(root, "broken-import", [["src/lib.fsh", `import { g } from "./g";\nexport function f(): i64 { return g(); }\n`], ["src/g.fsh", "export function g(: i64 {}\n"]]);
  const parsed = fishc(root, broken, ["publish", "--dry-run"]).err;
  assert(parsed.startsWith("fishc publish: src/g.fsh doesn't parse: "), `an import that doesn't parse: ${parsed}`);
  const escaping = pkg(root, "escaping-import", [["src/lib.fsh", `import { g } from "../../../../../../../../../../../../tmp/g";\nexport function f(): i64 { return g(); }\n`]]);
  same(fishc(root, escaping, ["publish", "--dry-run"]).err, "fishc publish: 'src/lib.fsh' imports '../../../../../../../../../../../../tmp/g', which the archive doesn't hold; if git doesn't track it, add and commit it", "an import leaving the package");
  removed(root);
}, { timeout: 60_000 });

test("--submit to a GitHub index asks before forking, and pushes the same release again after the index moves", () => {
  const root = scratch("fish-publish-");
  const indexDir = emptyIndex(root, "gh-index", "file:///nowhere/{name}/{version}.tar.gz");
  const fork = join(root, "gh-fork.git");
  gitIn(root, ["init", "-q", "--bare", fork]);
  // GitHub's URLs led to local repositories, so nothing leaves the machine.
  const ghHome = join(root, "gh-home");
  write(join(ghHome, ".gitconfig"), `[user]\n\tname = Author\n\temail = a@example.com\n[url "file://${indexDir}"]\n\tinsteadOf = https://github.com/fishlang-dev/registry\n[url "file://${fork}"]\n\tinsteadOf = https://github.com/tester/registry.git\n`);
  const log = join(root, "gh2.log");
  const path = bin(root, "bin-gh", log, `case "$1" in api) echo tester;; pr) echo https://github.com/fishlang-dev/registry/pull/9;; esac`);
  const dir = pkg(root, "forked", [["src/lib.fsh", "export function f(): i64 { return 1; }\n"]]);
  const vars = [`PATH=${path}`, `HOME=${ghHome}`, `FISH_CACHE_DIR=${join(root, "cache-g")}`, "FISH_REGISTRY=https://github.com/fishlang-dev/registry"];
  const submit = (args: string[]): Ran => {
    const r = run(dir, ["publish", "--submit", ...args], vars, "n\n");
    return { code: r.code, out: r.out, err: r.err.trim() };
  };
  write(log, "");
  same(submit([]).err, "fishc publish: nothing was pushed; the release is still prepared on publish/forked-1.0.0", "declining");
  assert(!read(log).includes("fork"), `gh was asked to fork:\n${read(log)}`);
  const sent = submit(["--yes"]);
  assert(sent.code === 0 && sent.err === "", `submitting exited with ${sent.code}: ${sent.err}`);
  const calls = read(log).split("\n");
  const repo = calls.indexOf("repo") as i64;
  same(calls.slice(repo, repo + 3).join(" "), "repo fork fishlang-dev/registry", "gh forking");
  const pr = calls.indexOf("pr") as i64;
  same(calls.slice(pr, pr + 8).join(" "), "pr create --repo fishlang-dev/registry --base main --head tester:publish/forked-1.0.0", "gh opening the pull request");
  const pushed = gitIn(fork, ["rev-parse", "publish/forked-1.0.0"]);
  write(join(indexDir, "other"), "another release\n");
  gitIn(indexDir, ["add", "."]);
  gitIn(indexDir, ["commit", "-q", "-m", "another release"]);
  const again = submit(["--yes"]);
  assert(again.code === 0 && again.err === "", `submitting again exited with ${again.code}: ${again.err}`);
  same(gitIn(fork, ["rev-parse", "publish/forked-1.0.0"]), pushed, "the fork's branch");
  // A branch left at its base, as by a commit that failed, is prepared afresh rather than reused.
  let clones: string[] = [];
  try {
    clones = readdirSync(join(root, "cache-g", "publish"));
  } catch (e) {
    assert(false, e.message);
  }
  const clone = join(root, "cache-g", "publish", clones[0]);
  gitIn(clone, ["reset", "-q", "--hard", "origin/HEAD"]);
  const retried = run(dir, ["publish"], vars);
  assert(retried.code === 0 && retried.err === "", `publishing again exited with ${retried.code}: ${retried.err}`);
  removed(root);
}, { timeout: 60_000 });
