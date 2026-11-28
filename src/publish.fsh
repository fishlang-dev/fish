import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { ZlibError } from "node:zlib";
import { MAX_DOWNLOAD, MAX_UNPACKED } from "./dependencies.fsh";
import { firstLine, git } from "./git.fsh";
import { loadManifest, MANIFEST, readManifest, type Capability, type Dependency, type Manifest } from "./manifest.fsh";
import { workspaceOf, type Member } from "./workspace.fsh";
import { MAX_ENTRIES, tar, untar, type TarFile } from "./tar.fsh";
import { CompileError, locate } from "./diag.fsh";
import { resolveSpecifier, specifierOf } from "./modules.fsh";
import { parse, type Span, type Stmt } from "./parser.fsh";
import { walkWhile, type Ids } from "./nodes.fsh";
import { cacheDir } from "./mathlib.fsh";
import { openIndex, registryUrl, resolveVersions, sparseBase, versions, type IndexEntry, type Request, type Unresolved } from "./registry_index.fsh";

// A package packed for the registry: its manifest, the archive's bytes and sha256, where it was
// written, and the files it holds.
export type Packed = { manifest: Manifest; bytes: Uint8Array; sha256: string; file: string; files: string[]; unsafe: UnsafeUse[] };

// Packs the package whose manifest is `file`: the files git tracks in its directory, checked as a
// build would check them once they come back from the registry. Refused while tracked files have
// changes, unless `dirty` allows it.
/** @throws {CompileError | Error | IoError | ZlibError} */
export function pack(file: string, dirty = false): Packed {
  let manifest = loadManifest(file, "lib");
  const dir = manifest.dir;
  const shipped = publishedManifest(file, manifest);
  const outside = readManifest(shipped, dir).dependencies.find((d) => !("version" in d));
  if (outside !== undefined) throw new Error(`'${outside.name}' is a path or git dependency, and a published package depends only on the registry; give it a version range`);
  if (git(dir, "rev-parse", "--show-toplevel").exitCode !== 0) throw new Error(`the package at ${dir} isn't in a git repository; publishing packs the files git tracks`);
  const changed = text(git(dir, "status", "--porcelain=v1", "-z", "--untracked-files=no", "--", ".").stdout);
  if (changed !== "" && !dirty) {
    const names = changed.split("\0").filter((l) => l !== "").map((l) => l.slice(3));
    throw new Error(`these tracked files have changes not yet committed: ${names.join(", ")}; commit them, or publish with --allow-dirty`);
  }
  const listed = git(dir, "ls-files", "-s", "-z", "--", ".");
  if (listed.exitCode !== 0) throw new Error(`git can't list the package's files: ${firstLine(text(listed.stderr))}`);
  let files: { path: string; data: Uint8Array; executable: boolean }[] = [];
  for (const line of text(listed.stdout).split("\0")) {
    if (line === "") continue;
    const parts = line.split("\t");
    const meta = parts[0]!;
    const path = parts[1]!;
    const mode = meta.split(" ")[0]!;
    if (mode === "120000") throw new Error(`'${path}' is a symbolic link, which a package can't hold`);
    if (mode === "160000") throw new Error(`'${path}' is a git submodule, which a package can't hold`);
    // With --allow-dirty the bytes come from the working tree, which may no longer match the index.
    const stat = lstatSync(join(dir, path), { throwIfNoEntry: false });
    if (stat === undefined) throw new Error(`git tracks '${path}' but it has been deleted; commit the deletion or restore it`);
    if (!stat.isFile() || !realpathSync(join(dir, path)).startsWith(realpathSync(dir) + sep)) throw new Error(`'${path}' is a symbolic link, leads through one, or isn't a plain file, which a package can't hold`);
    // The manifest goes out as published, its workspace's members named by version.
    const data = path === MANIFEST ? new Uint8Array(new TextEncoder().encode(shipped)) : new Uint8Array(readFileSync(join(dir, path)));
    files.push({ path, data, executable: mode === "100755" });
  }
  if (!files.some((f) => f.path === MANIFEST)) throw new Error(`git doesn't track ${MANIFEST}; add and commit it`);
  if (files.length > (MAX_ENTRIES as usize)) throw new Error(`the package has ${files.length} files, more than the ${MAX_ENTRIES} a build accepts`);
  let size: usize = 0;
  for (const f of files) size += f.data.length;
  if (size > (MAX_UNPACKED as usize)) throw new Error(`the package's files come to more than the ${MAX_UNPACKED / 1024 / 1024} MiB a build accepts`);
  // No name and no time in the gzip header, so the same files always make the same archive. The
  // archive is made of a copy, as the files are compared with what it unpacks into.
  const bytes = new Uint8Array(gzipSync(tar(files.map((f) => ({ path: f.path, data: f.data.slice(), executable: f.executable }))), { level: 9 }));
  if (bytes.length > (MAX_DOWNLOAD as usize)) throw new Error(`the archive is larger than the ${MAX_DOWNLOAD / 1024 / 1024} MiB a build downloads`);
  // What a build will unpack must be exactly these files, with this manifest.
  const back = untar(new Uint8Array(gunzipSync(bytes.slice())), MAX_UNPACKED as usize);
  const same = back.length === files.length && back.every((f) => {
    const original = files.find((o) => o.path === f.path);
    return original !== undefined && sameBytes(original.data, f.data);
  });
  const inside = back.find((f) => f.path === MANIFEST);
  if (!same || inside === undefined) throw new Error("the archive didn't unpack back into the same files");
  const unpacked = readManifest(new TextDecoder().decode(inside.data.slice()), dir);
  if (unpacked.name !== manifest.name || unpacked.version !== manifest.version) throw new Error("the archive's fish.toml doesn't match the package's");
  // The index line and the unsafe check read the dependencies as the archive declares them.
  manifest.dependencies = [...unpacked.dependencies];
  readsBack(back, normalize(manifest.lib));
  const out = join(dir, "target", "publish");
  mkdirSync(out, { recursive: true });
  const archive = join(out, `${manifest.name}-${manifest.version}.tar.gz`);
  writeFileSync(archive, bytes.slice());
  let sources: { path: string; text: string }[] = [];
  for (const f of back) sources.push({ path: f.path, text: new TextDecoder().decode(f.data.slice()) });
  const uses = unsafeUses(sources);
  const sha256 = createHash("sha256").update(bytes.slice()).digest("hex");
  let paths = files.map((f) => f.path);
  paths.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { manifest, bytes, sha256, file: archive, files: paths, unsafe: uses };
}

// The fish.toml a package publishes: a path dependency on a member of its workspace written as
// `^<that member's version>`, once the registry has that version, and an entry taken from the
// workspace written as the workspace gives it. Every other byte is as the file stands.
/** @throws {CompileError | Error | IoError} */
function publishedManifest(file: string, manifest: Ref<Manifest>): string {
  const src = readFileSync(file, "utf8");
  const ws = workspaceOf(manifest.dir);
  let listed: string[] | undefined = undefined;
  let edits: { start: usize; end: usize; text: string }[] = [];
  const parsed = readManifest(src, manifest.dir);
  for (const raw of parsed.dependencies) {
    const d = manifest.dependencies.find((x) => x.name === raw.name)!;
    let range: string | undefined = undefined;
    if ("path" in d && ws !== undefined) {
      const at = resolve(manifest.dir, d.path);
      const real = existsSync(at) ? realpathSync(at) : at;
      const sibling = ws.members.find((m) => m.dir === real);
      if (sibling !== undefined) range = `^${publishedVersion(sibling, manifest, ws.dir)}`;
    } else if ("version" in d && "workspace" in raw) range = d.version;
    if (range === undefined) continue;
    edits.push(entryEdit(src, raw, range!, d.capabilities));
  }
  edits.sort((a, b) => (a.start > b.start ? -1 : a.start < b.start ? 1 : 0));
  let out = src;
  for (const e of edits) out = `${out.slice(0, e.start as i64)}${e.text}${out.slice(e.end as i64)}`;
  return out;
}

// The version of the workspace member `sibling` a published package depends on, refused until the
// registry has it.
/** @throws {CompileError | Error | IoError} */
function publishedVersion(sibling: Ref<Member>, manifest: Ref<Manifest>, root: string): string {
  const own = readManifest(readFileSync(join(sibling.dir, MANIFEST), "utf8"), sibling.dir);
  const released = openIndex(registryUrl(manifest), true).versions(own.name);
  if (!released.some((e) => e.text === own.version && !e.yanked)) {
    const near = relative(root, sibling.dir);
    throw new Error(`'${own.name}' is the workspace's member at '${near !== "" ? near : "."}', and the registry doesn't have its version ${own.version} yet; publish it first, with 'fishc publish -p ${own.name}'`);
  }
  return own.version;
}

// The text replacing a [dependencies] entry with one naming `range` from the registry: the inline
// entry from its key to its value's end, or a `[dependencies.<name>]` table to the next table.
function entryEdit(src: string, raw: Ref<Dependency>, range: string, capabilities: Ref<Capability[] | undefined>): { start: usize; end: usize; text: string } {
  const granted = capabilities !== undefined ? `capabilities = [${capabilities.map((c) => `"${c}"`).join(", ")}]` : "";
  if (src.charAt(raw.start as i64) !== "[") return { start: raw.start, end: raw.end, text: `${raw.name} = { version = "${range}"${granted !== "" ? `, ${granted}` : ""} }` };
  let end = src.length;
  for (let at = src.indexOf("\n", raw.end as i64); at >= 0; at = src.indexOf("\n", at + 1)) {
    if (src.slice(at + 1).trimStart().startsWith("[")) {
      end = (at + 1) as usize;
      break;
    }
  }
  return { start: raw.start, end, text: `[dependencies.${raw.name}]\nversion = "${range}"\n${granted !== "" ? `${granted}\n` : ""}${end < src.length ? "\n" : ""}` };
}

// What a process wrote, as text.
function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function sameBytes(a: Ref<Uint8Array>, b: Ref<Uint8Array>): boolean {
  if (a.length !== b.length) return false;
  for (let i: usize = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Refuses an archive missing its lib, or a file the lib reaches through relative imports, as
// happens when git doesn't track one: unpacked by itself, it wouldn't build.
/** @throws {CompileError | Error | IoError} */
function readsBack(files: Ref<TarFile[]>, lib: string) {
  if (!files.some((f) => f.path === lib)) throw new Error(`git doesn't track the lib '${lib}', so the archive would leave it out; add and commit it`);
  const at = mkdtempSync(join(tmpdir(), "fish-publish-"));
  try {
    for (const f of files) {
      mkdirSync(dirname(join(at, f.path)), { recursive: true });
      writeFileSync(join(at, f.path), f.data.slice());
    }
    let seen = new Set<string>();
    visitUnpacked(at, join(at, lib), seen);
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
}

// Refuses `file`, unpacked under `at`, when it doesn't parse or imports through a relative path a
// file the archive doesn't hold, then looks at each file it imports that way.
/** @throws {CompileError | Error | IoError} */
function visitUnpacked(at: string, file: string, seen: Mut<Set<string>>): void {
  if (seen.has(file)) return;
  seen.add(file);
  let program: Stmt[] = [];
  let ids: Ids = { last: 0 };
  try {
    program = parse(readFileSync(file, "utf8"), ids);
  } catch (e) {
    throw new Error(`${relative(at, file)} doesn't parse: ${e instanceof Error ? e.message : (e as IoError).message}`);
  }
  // Each statement is taken out of the program, since reading its specifier takes it.
  while (program.length > 0) {
    const s = program.shift()!;
    const span: Span = { start: s.start, end: s.end };
    const specifier = specifierOf(s);
    if (specifier === undefined || !/^\.\.?(\/|$)/.test(specifier)) continue;
    let found: string | undefined = undefined;
    try {
      let looked: string[] = [];
      found = resolveSpecifier(file, specifier, span, looked);
    } catch (e) {
      if (!(e instanceof CompileError)) throw e;
    }
    if (found === undefined || !found.startsWith(at + sep)) throw new Error(`'${relative(at, file)}' imports '${specifier}', which the archive doesn't hold; if git doesn't track it, add and commit it`);
    visitUnpacked(at, found, seen);
  }
}

// One use of unsafe: where it is, and what it is.
export type UnsafeUse = { file: string; line: usize; col: usize; what: string };

// Every `unsafe` block or expression, and every C declaration, in a package's .fsh files, as the
// design doc asks the package manager to flag them.
/** @throws {Error} */
export function unsafeUses(files: Ref<{ path: string; text: string }[]>): UnsafeUse[] {
  let uses: UnsafeUse[] = [];
  for (const f of files) {
    if (!f.path.endsWith(".fsh")) continue;
    const path = f.path;
    const text = f.text;
    let program: Stmt[] = [];
    let ids: Ids = { last: 0 };
    try {
      program = parse(text, ids);
    } catch (e) {
      throw new Error(`${path} doesn't parse: ${(e as CompileError).message}`);
    }
    walkWhile({ of: "stmts", node: program }, (n) => {
      if (n.of === "stmt" && n.node.kind === "unsafe") uses.push(useAt(path, text, n.node.start, "unsafe block"));
      if (n.of === "expr" && n.node.kind === "unsafe") uses.push(useAt(path, text, n.node.start, "unsafe expression"));
      if (n.of === "stmt" && n.node.kind === "declare") {
        uses.push(useAt(path, text, n.node.start, n.node.body.kind === "function" ? `C declaration of '${n.node.body.name}'` : "C declaration"));
        return false;
      }
      return true;
    });
  }
  uses.sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line < b.line ? -1 : 1;
    return a.col < b.col ? -1 : a.col > b.col ? 1 : 0;
  });
  return uses;
}

function useAt(file: string, text: string, start: usize, what: string): UnsafeUse {
  const { line, col } = locate(text, start);
  return { file, line, col, what };
}

// The registry dependencies a build of this package would use that the index marks as using
// unsafe, at the versions resolution picks.
/** @throws {Error | IoError | Unresolved} */
export function unsafeDependencies(manifest: Ref<Manifest>): IndexEntry[] {
  let roots = new Map<string, Request[]>();
  for (const d of manifest.dependencies) if ("version" in d) roots.set(d.name, [{ range: d.version, by: manifest.name }]);
  if (roots.size === 0) return [];
  const index = openIndex(registryUrl(manifest), true);
  const picked = resolveVersions(index, roots);
  let found: IndexEntry[] = [];
  for (const name of [...picked.keys()]) {
    const e = picked.get(name)!;
    if (e.unsafe) found.push(e);
  }
  return found;
}

// A release prepared in a working clone of the index: its branch, and where the clone is.
export type Prepared = { branch: string; clone: string; archive: string; line: string };

// The archive and its index line committed on a branch of a full clone of the index, brought up
// to the index's default branch first, so a version already published there is refused.
/** @throws {Error | IoError} */
export function prepare(packed: Ref<Packed>): Prepared {
  const { name, version } = packed.manifest;
  const url = registryUrl(packed.manifest);
  if (Bun.which("git") === null) throw new Error("publishing needs the git command, which isn't on PATH; install git");
  const clone = join(cacheDir(), "publish", `${name}-${createHash("sha256").update(url).digest("hex").slice(0, 12)}`);
  /** @throws {Error | IoError} */
  function run(args: string[]): string {
    const done = git(clone, ...args);
    if (done.exitCode !== 0) throw new Error(`git ${args[0]} in the index's clone failed: ${firstLine(text(done.stderr))}`);
    return text(done.stdout).trim();
  }
  if (!existsSync(join(clone, ".git"))) {
    mkdirSync(clone, { recursive: true });
    run(["clone", "--quiet", "--", url, "."]);
  } else {
    run(["fetch", "--quiet", "origin"]);
    run(["remote", "set-head", "origin", "--auto"]);
  }
  const branch = `publish/${name}-${version}`;
  const earlier = text(git(clone, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`).stdout).trim();
  run(["checkout", "--quiet", "--force", "-B", branch, "origin/HEAD"]);
  run(["clean", "--quiet", "-fdx"]);
  if (existsSync(join(clone, name.slice(0, 2), name)) && versions(url, clone, name).some((e) => e.text === version)) {
    throw new Error(`'${name}' ${version} is already in the registry; raise the version in ${MANIFEST} to publish again`);
  }
  const archive = join("archives", name, `${version}.tar.gz`);
  mkdirSync(join(clone, "archives", name), { recursive: true });
  writeFileSync(join(clone, archive), packed.bytes.slice());
  let dependencies: { [name: string]: string } = {};
  for (const d of packed.manifest.dependencies) if ("version" in d) dependencies[d.name] = d.version;
  const line = JSON.stringify({ name, version, dependencies, sha256: packed.sha256, yanked: false, unsafe: packed.unsafe.length > 0 });
  const file = join(name.slice(0, 2), name);
  mkdirSync(join(clone, name.slice(0, 2)), { recursive: true });
  const before = existsSync(join(clone, file)) ? readFileSync(join(clone, file), "utf8") : "";
  writeFileSync(join(clone, file), `${before}${before === "" || before.endsWith("\n") ? "" : "\n"}${line}\n`);
  run(["add", "--", archive, file]);
  const committed = git(clone, "commit", "--quiet", "-m", `${name} ${version}`);
  if (committed.exitCode !== 0) throw new Error(`can't commit the release in the index's clone: ${firstLine(text(committed.stderr))}; set git's user.name and user.email`);
  // The same release prepared again keeps its earlier commit, even on an older base, so a branch
  // already pushed to the fork can be pushed again after a failed submit.
  // An earlier commit that never got the release, as when its commit failed, holds no archive.
  /** @throws {IoError} */
  function blob(rev: string): string {
    return text(git(clone, "rev-parse", "--verify", "--quiet", `${rev}:${archive}`).stdout).trim();
  }
  if (earlier !== "" && blob(earlier) !== "" && blob(earlier) === blob("HEAD") && text(git(clone, "show", `${earlier}:${file}`).stdout).endsWith(`${line}\n`)) {
    run(["reset", "--quiet", "--hard", earlier]);
  }
  return { branch, clone, archive, line };
}

// Sends a release to a registry server, authorized by FISH_REGISTRY_TOKEN, its index line's fields
// as headers beside the archive; gives the package's URL there. The token goes to curl in a file in
// a directory only this user can read, so no other process sees it in curl's arguments.
/** @throws {Error | IoError} */
export function upload(packed: Ref<Packed>): string {
  const url = registryUrl(packed.manifest);
  const base = sparseBase(url)!.replace(/\/index$/, "");
  const token = process.env.FISH_REGISTRY_TOKEN ?? "";
  if (token === "") throw new Error(`publishing to '${url}' needs FISH_REGISTRY_TOKEN set to a token the registry gave you`);
  if (/[\r\n]/.test(token)) throw new Error("FISH_REGISTRY_TOKEN holds a line break");
  if (Bun.which("curl") === null) throw new Error("publishing needs the curl command, which isn't on PATH; install curl");
  const { name, version } = packed.manifest;
  let dependencies: { [name: string]: string } = {};
  for (const d of packed.manifest.dependencies) if ("version" in d) dependencies[d.name] = d.version;
  const dir = mkdtempSync(join(tmpdir(), "fish-publish-"));
  const headers = join(dir, "headers");
  try {
    writeFileSync(headers, `authorization: Bearer ${token}\nfish-dependencies: ${JSON.stringify(dependencies)}\nfish-unsafe: ${packed.unsafe.length > 0 ? "true" : "false"}\ncontent-type: application/gzip\n`);
    const target = `${base}/api/v1/packages/${name}/${version}`;
    const sent = Bun.spawnSync(["curl", "-q", "--silent", "--show-error", "--fail-with-body", "--proto", "=https,http", "--max-time", "600", "-X", "PUT", "-H", `@${headers}`, "--data-binary", `@${packed.file}`, "--", target], { stdout: "pipe", stderr: "pipe" });
    if (sent.exitCode !== 0) {
      const body = text(sent.stdout).trim();
      const said = body !== "" ? body : text(sent.stderr).trim().replace(/^curl: \(\d+\) /, "");
      throw new Error(`the registry refused ${name} ${version}: ${said}`);
    }
    return `${base}/api/v1/packages/${name}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A GitHub repository's owner/name, from an https or ssh URL, when it is one.
function githubSlug(url: string): string | undefined {
  const found = /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?\/?$/.exec(url);
  return found === null ? undefined : found[1];
}

// Pushes a prepared release to the author's fork and opens a pull request against the index with
// gh, after `confirm` agrees; the prepared branch stays either way, so a failed submit can be
// tried again.
/** @throws {Error | IoError} */
export function submit(prepared: Ref<Prepared>, manifest: Ref<Manifest>, fork: string | undefined, confirm: (question: string) => boolean): string {
  if (Bun.which("gh") === null) throw new Error("submitting needs GitHub's gh command, which isn't on PATH; install it, or push the prepared branch and open the pull request yourself");
  const index = registryUrl(manifest);
  const slug = githubSlug(index);
  /** @throws {Error | IoError} */
  function gh(args: string[]): string {
    const done = Bun.spawnSync(["gh", ...args], { cwd: prepared.clone, stdout: "pipe", stderr: "pipe" });
    if (done.exitCode !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${firstLine(text(done.stderr))}; the release is still prepared on ${prepared.branch}`);
    return text(done.stdout).trim();
  }
  // An empty --fork names no fork to make, though the push still goes to it.
  const forked = fork !== undefined && fork !== "";
  if (!forked && slug === undefined) throw new Error(`the registry '${index}' isn't on GitHub, so name where to push with --fork <url>`);
  let target = fork ?? "";
  if (fork === undefined && slug !== undefined) target = `https://github.com/${gh(["api", "user", "--jq", ".login"])}/${slug.split("/")[1]}.git`;
  const head = text(git(prepared.clone, "rev-parse", "--abbrev-ref", "origin/HEAD").stdout).trim().replace(/^origin\//, "");
  const base = head !== "" ? head : "main";
  const forking = !forked && slug !== undefined ? `fork ${slug} to your account, ` : "";
  if (!confirm(`${forking}push ${prepared.branch} to ${target} and open a pull request against ${index} (${base})? [y/N] `)) throw new Error(`nothing was pushed; the release is still prepared on ${prepared.branch}`);
  if (!forked && slug !== undefined) gh(["repo", "fork", slug, "--clone=false", "--remote=false"]);
  // gh's credentials, since builds' git leaves out the system config where a keychain helper lives.
  const credentials = ["-c", "credential.helper=!gh auth git-credential"];
  const pushed = git(prepared.clone, ...credentials, "push", "--quiet", "--", target, `${prepared.branch}:${prepared.branch}`);
  if (pushed.exitCode !== 0) throw new Error(`can't push to ${target}: ${firstLine(text(pushed.stderr))}; the release is still prepared on ${prepared.branch}`);
  const pushedTo = githubSlug(target);
  const owner = pushedTo === undefined ? undefined : pushedTo.split("/")[0];
  const { name, version } = manifest;
  const branch = owner !== undefined ? `${owner}:${prepared.branch}` : prepared.branch;
  const title = `${name} ${version}`;
  const body = `Publishes ${name} ${version}: its archive and index line, prepared by fishc publish.\n\n${prepared.line}`;
  if (slug !== undefined) return gh(["pr", "create", "--repo", slug, "--base", base, "--head", branch, "--title", title, "--body", body]);
  return gh(["pr", "create", "--base", base, "--head", branch, "--title", title, "--body", body]);
}
