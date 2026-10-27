import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, relative, sep } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { MAX_DOWNLOAD, MAX_UNPACKED } from "./dependencies.ts";
import { firstLine, git } from "./git.ts";
import { loadManifest, MANIFEST, readManifest, type Manifest } from "./manifest.ts";
import { MAX_ENTRIES, tar, untar } from "./tar.ts";
import { CompileError, locate } from "./diag.ts";
import { resolveSpecifier, specifierOf } from "./modules.ts";
import { parse, type Stmt } from "./parser.ts";
import { cacheDir } from "./mathlib.ts";
import { openIndex, registryUrl, resolveVersions, versions, type IndexEntry } from "./registry_index.ts";

// A package packed for the registry: its manifest, the archive's bytes and sha256, where it was
// written, and the files it holds.
export type Packed = { manifest: Manifest; bytes: Uint8Array; sha256: string; file: string; files: string[]; unsafe: UnsafeUse[] };

// Packs the package whose manifest is `file`: the files git tracks in its directory, checked as a
// build would check them once they come back from the registry. Refused while tracked files have
// changes, unless `dirty` allows it.
export function pack(file: string, dirty = false): Packed {
  const manifest = loadManifest(file, "lib");
  const dir = manifest.dir;
  const outside = manifest.dependencies.find((d) => !("version" in d));
  if (outside) throw new Error(`'${outside.name}' is a path or git dependency, and a published package depends only on the registry; give it a version range`);
  if (git(dir, "rev-parse", "--show-toplevel").exitCode !== 0) throw new Error(`the package at ${dir} isn't in a git repository; publishing packs the files git tracks`);
  const changed = git(dir, "status", "--porcelain=v1", "-z", "--untracked-files=no", "--", ".").stdout.toString();
  if (changed !== "" && !dirty) {
    const names = changed.split("\0").filter(Boolean).map((l) => l.slice(3));
    throw new Error(`these tracked files have changes not yet committed: ${names.join(", ")}; commit them, or publish with --allow-dirty`);
  }
  const listed = git(dir, "ls-files", "-s", "-z", "--", ".");
  if (listed.exitCode !== 0) throw new Error(`git can't list the package's files: ${firstLine(listed.stderr.toString())}`);
  const files = listed.stdout.toString().split("\0").filter(Boolean).map((line) => {
    const [meta, path] = line.split("\t") as [string, string];
    const mode = meta.split(" ")[0]!;
    if (mode === "120000") throw new Error(`'${path}' is a symbolic link, which a package can't hold`);
    if (mode === "160000") throw new Error(`'${path}' is a git submodule, which a package can't hold`);
    // With --allow-dirty the bytes come from the working tree, which may no longer match the index.
    const stat = lstatSync(join(dir, path), { throwIfNoEntry: false });
    if (!stat) throw new Error(`git tracks '${path}' but it has been deleted; commit the deletion or restore it`);
    if (!stat.isFile() || !realpathSync(join(dir, path)).startsWith(realpathSync(dir) + sep)) throw new Error(`'${path}' is a symbolic link, leads through one, or isn't a plain file, which a package can't hold`);
    return { path, data: new Uint8Array(readFileSync(join(dir, path))), executable: mode === "100755" };
  });
  if (!files.some((f) => f.path === MANIFEST)) throw new Error(`git doesn't track ${MANIFEST}; add and commit it`);
  if (files.length > MAX_ENTRIES) throw new Error(`the package has ${files.length} files, more than the ${MAX_ENTRIES} a build accepts`);
  const size = files.reduce((n, f) => n + f.data.length, 0);
  if (size > MAX_UNPACKED) throw new Error(`the package's files come to more than the ${MAX_UNPACKED / 1024 / 1024} MiB a build accepts`);
  // No name and no time in the gzip header, so the same files always make the same archive.
  const bytes = new Uint8Array(gzipSync(tar(files), { level: 9 }));
  if (bytes.length > MAX_DOWNLOAD) throw new Error(`the archive is larger than the ${MAX_DOWNLOAD / 1024 / 1024} MiB a build downloads`);
  // What a build will unpack must be exactly these files, with this manifest.
  const back = untar(new Uint8Array(gunzipSync(bytes)), MAX_UNPACKED);
  const same = back.length === files.length && back.every((f) => {
    const original = files.find((o) => o.path === f.path);
    return original !== undefined && Buffer.compare(Buffer.from(original.data), Buffer.from(f.data)) === 0;
  });
  if (!same) throw new Error("the archive didn't unpack back into the same files");
  const unpacked = readManifest(new TextDecoder().decode(back.find((f) => f.path === MANIFEST)!.data), dir);
  if (unpacked.name !== manifest.name || unpacked.version !== manifest.version) throw new Error("the archive's fish.toml doesn't match the package's");
  readsBack(back, normalize(manifest.lib));
  const out = join(dir, "target", "publish");
  mkdirSync(out, { recursive: true });
  const archive = join(out, `${manifest.name}-${manifest.version}.tar.gz`);
  writeFileSync(archive, bytes);
  const unsafe = unsafeUses(back.map((f) => ({ path: f.path, text: new TextDecoder().decode(f.data) })));
  return { manifest, bytes, sha256: createHash("sha256").update(bytes).digest("hex"), file: archive, files: files.map((f) => f.path).sort(), unsafe };
}

// Refuses an archive missing its lib, or a file the lib reaches through relative imports, as
// happens when git doesn't track one: unpacked by itself, it wouldn't build.
function readsBack(files: { path: string; data: Uint8Array }[], lib: string) {
  if (!files.some((f) => f.path === lib)) throw new Error(`git doesn't track the lib '${lib}', so the archive would leave it out; add and commit it`);
  const at = mkdtempSync(join(tmpdir(), "fish-publish-"));
  try {
    for (const f of files) {
      mkdirSync(dirname(join(at, f.path)), { recursive: true });
      writeFileSync(join(at, f.path), f.data);
    }
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      let program: Stmt[];
      try {
        program = parse(readFileSync(file, "utf8"));
      } catch (e) {
        throw new Error(`${relative(at, file)} doesn't parse: ${e instanceof Error ? e.message : e}`);
      }
      for (const s of program) {
        const specifier = specifierOf(s);
        if (specifier === undefined || !/^\.\.?(\/|$)/.test(specifier)) continue;
        let found: string | undefined;
        try {
          found = resolveSpecifier(file, specifier, s);
        } catch (e) {
          if (!(e instanceof CompileError)) throw e;
        }
        if (found === undefined || !found.startsWith(at + sep)) throw new Error(`'${relative(at, file)}' imports '${specifier}', which the archive doesn't hold; if git doesn't track it, add and commit it`);
        visit(found);
      }
    };
    visit(join(at, lib));
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
}

// One use of unsafe: where it is, and what it is.
export type UnsafeUse = { file: string; line: number; col: number; what: string };

// Every `unsafe` block or expression, and every C declaration, in a package's .fsh files, as the
// design doc asks the package manager to flag them.
export function unsafeUses(files: { path: string; text: string }[]): UnsafeUse[] {
  const uses: UnsafeUse[] = [];
  for (const { path, text } of files.filter((f) => f.path.endsWith(".fsh"))) {
    let program: Stmt[];
    try {
      program = parse(text);
    } catch (e) {
      throw new Error(`${path} doesn't parse: ${e instanceof Error ? e.message : e}`);
    }
    const note = (node: { start: number }, what: string) => {
      const { line, col } = locate(text, node.start);
      uses.push({ file: path, line, col, what });
    };
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node !== "object" || node === null) return;
      const n = node as { kind?: unknown; start?: number; body?: unknown; expr?: unknown };
      if (n.kind === "unsafe" && typeof n.start === "number") note(n as { start: number }, "body" in n ? "unsafe block" : "unsafe expression");
      if (n.kind === "declare" && typeof n.start === "number") {
        const body = n.body as { kind?: string; name?: string } | undefined;
        note(n as { start: number }, body?.kind === "function" ? `C declaration of '${body.name}'` : "C declaration");
        return;
      }
      for (const value of Object.values(node)) walk(value);
    };
    walk(program);
  }
  return uses.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.col - b.col));
}

// The registry dependencies a build of this package would use that the index marks as using
// unsafe, at the versions resolution picks.
export function unsafeDependencies(manifest: Manifest): IndexEntry[] {
  const roots = new Map(manifest.dependencies.map((d) => [d.name, [{ range: (d as { version: string }).version, by: manifest.name }]]));
  if (roots.size === 0) return [];
  return [...resolveVersions(openIndex(registryUrl(manifest), true), roots).values()].filter((e) => e.unsafe);
}

// A release prepared in a working clone of the index: its branch, and where the clone is.
export type Prepared = { branch: string; clone: string; archive: string; line: string };

// The archive and its index line committed on a branch of a full clone of the index, brought up
// to the index's default branch first, so a version already published there is refused.
export function prepare(packed: Packed): Prepared {
  const { name, version } = packed.manifest;
  const url = registryUrl(packed.manifest);
  if (!Bun.which("git")) throw new Error("publishing needs the git command, which isn't on PATH; install git");
  const clone = join(cacheDir(), "publish", `${name}-${createHash("sha256").update(url).digest("hex").slice(0, 12)}`);
  const run = (...args: string[]) => {
    const done = git(clone, ...args);
    if (done.exitCode !== 0) throw new Error(`git ${args[0]} in the index's clone failed: ${firstLine(done.stderr.toString())}`);
    return done.stdout.toString().trim();
  };
  if (!existsSync(join(clone, ".git"))) {
    mkdirSync(clone, { recursive: true });
    run("clone", "--quiet", "--", url, ".");
  } else {
    run("fetch", "--quiet", "origin");
    run("remote", "set-head", "origin", "--auto");
  }
  const branch = `publish/${name}-${version}`;
  const earlier = git(clone, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`).stdout.toString().trim();
  run("checkout", "--quiet", "--force", "-B", branch, "origin/HEAD");
  run("clean", "--quiet", "-fdx");
  if (existsSync(join(clone, name.slice(0, 2), name)) && versions(url, clone, name).some((e) => e.text === version)) {
    throw new Error(`'${name}' ${version} is already in the registry; raise the version in ${MANIFEST} to publish again`);
  }
  const archive = join("archives", name, `${version}.tar.gz`);
  mkdirSync(join(clone, "archives", name), { recursive: true });
  writeFileSync(join(clone, archive), packed.bytes);
  const dependencies = Object.fromEntries(packed.manifest.dependencies.map((d) => [d.name, (d as { version: string }).version]));
  const line = JSON.stringify({ name, version, dependencies, sha256: packed.sha256, yanked: false, unsafe: packed.unsafe.length > 0 });
  const file = join(name.slice(0, 2), name);
  mkdirSync(join(clone, name.slice(0, 2)), { recursive: true });
  const before = existsSync(join(clone, file)) ? readFileSync(join(clone, file), "utf8") : "";
  writeFileSync(join(clone, file), `${before}${before === "" || before.endsWith("\n") ? "" : "\n"}${line}\n`);
  run("add", "--", archive, file);
  const committed = git(clone, "commit", "--quiet", "-m", `${name} ${version}`);
  if (committed.exitCode !== 0) throw new Error(`can't commit the release in the index's clone: ${firstLine(committed.stderr.toString())}; set git's user.name and user.email`);
  // The same release prepared again keeps its earlier commit, even on an older base, so a branch
  // already pushed to the fork can be pushed again after a failed submit.
  // An earlier commit that never got the release, as when its commit failed, holds no archive.
  const blob = (rev: string) => git(clone, "rev-parse", "--verify", "--quiet", `${rev}:${archive}`).stdout.toString().trim();
  if (earlier && blob(earlier) !== "" && blob(earlier) === blob("HEAD") && git(clone, "show", `${earlier}:${file}`).stdout.toString().endsWith(`${line}\n`)) {
    run("reset", "--quiet", "--hard", earlier);
  }
  return { branch, clone, archive, line };
}

// A GitHub repository's owner/name, from an https or ssh URL, when it is one.
const githubSlug = (url: string) => /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?\/?$/.exec(url)?.[1];

// Pushes a prepared release to the author's fork and opens a pull request against the index with
// gh, after `confirm` agrees; the prepared branch stays either way, so a failed submit can be
// tried again.
export function submit(prepared: Prepared, manifest: Manifest, fork: string | undefined, confirm: (question: string) => boolean): string {
  if (!Bun.which("gh")) throw new Error("submitting needs GitHub's gh command, which isn't on PATH; install it, or push the prepared branch and open the pull request yourself");
  const index = registryUrl(manifest);
  const slug = githubSlug(index);
  const gh = (...args: string[]) => {
    const done = Bun.spawnSync(["gh", ...args], { cwd: prepared.clone, stdout: "pipe", stderr: "pipe" });
    if (done.exitCode !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${firstLine(done.stderr.toString())}; the release is still prepared on ${prepared.branch}`);
    return done.stdout.toString().trim();
  };
  if (!fork && !slug) throw new Error(`the registry '${index}' isn't on GitHub, so name where to push with --fork <url>`);
  const target = fork ?? `https://github.com/${gh("api", "user", "--jq", ".login")}/${slug!.split("/")[1]}.git`;
  const base = git(prepared.clone, "rev-parse", "--abbrev-ref", "origin/HEAD").stdout.toString().trim().replace(/^origin\//, "") || "main";
  const forking = fork ? "" : `fork ${slug} to your account, `;
  if (!confirm(`${forking}push ${prepared.branch} to ${target} and open a pull request against ${index} (${base})? [y/N] `)) throw new Error(`nothing was pushed; the release is still prepared on ${prepared.branch}`);
  if (!fork) gh("repo", "fork", slug!, "--clone=false", "--remote=false");
  // gh's credentials, since builds' git leaves out the system config where a keychain helper lives.
  const credentials = ["-c", "credential.helper=!gh auth git-credential"];
  const pushed = git(prepared.clone, ...credentials, "push", "--quiet", "--", target, `${prepared.branch}:${prepared.branch}`);
  if (pushed.exitCode !== 0) throw new Error(`can't push to ${target}: ${firstLine(pushed.stderr.toString())}; the release is still prepared on ${prepared.branch}`);
  const owner = githubSlug(target)?.split("/")[0];
  const { name, version } = manifest;
  return gh("pr", "create", ...(slug ? ["--repo", slug] : []), "--base", base, "--head", owner ? `${owner}:${prepared.branch}` : prepared.branch, "--title", `${name} ${version}`, "--body", `Publishes ${name} ${version}: its archive and index line, prepared by fishc publish.\n\n${prepared.line}`);
}
