import { createHash } from "node:crypto";
import { closeSync, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readlinkSync, readSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { CompileError } from "./diag.ts";
import { firstLine, git as run } from "./git.ts";
import { openIndex, registryUrl, resolveVersions, Unresolved, type Index, type IndexEntry, type Request } from "./registry_index.ts";
import { parseRange, parseVersion, satisfies } from "./semver.ts";
import { untar } from "./tar.ts";
import { cacheDir } from "./mathlib.ts";
import { fieldError, findManifest, inManifest, loadManifest, MANIFEST, parseToml, type Dependency, type Manifest, type Table } from "./manifest.ts";

// A Fish package of a program: its manifest, its real directory, the packages its dependencies
// name, by the names it imports them under, and for one from git, the commit it was fetched at.
export type Package = { manifest: Manifest; dir: string; deps: Map<string, Package>; git?: { url: string; commit: string }; registry?: { url: string; version: string; unsafe: boolean } };

// The packages a program whose entry is `entry` is built from, the one holding the entry first,
// or none when no `fish.toml` is at or above it. Each package's dependencies come from its own
// manifest; a package reached twice from the same place is one package. `locking` says how the
// lockfile may change.
export function resolvePackages(entry: string, locking: Locking): Package[] | undefined {
  const file = findManifest(dirname(resolve(entry)));
  if (!file) return undefined;
  const root: Package = { manifest: loadManifest(file), dir: realpathSync(dirname(file)), deps: new Map() };
  const byDir = new Map([[root.dir, root]]);
  const byName = new Map([[root.manifest.name, root]]);
  // Registry dependencies wait until every range on each name is known, then take one version.
  const wanted: Wanted[] = [];
  const visit = (pkg: Package, path: Package[]) => {
    for (const dep of pkg.manifest.dependencies) {
      const where = join(pkg.dir, MANIFEST);
      const fail = (message: string) => inManifest(new CompileError(message, dep.start, dep.end), where);
      // What a commit pins can't reach past it to files on this machine.
      if (pkg.git && "path" in dep) throw fail(`'${pkg.manifest.name}' comes from git, so its dependencies must too; a path dependency would bring in files its commit doesn't pin`);
      if ("version" in dep) {
        wanted.push({ pkg, dep, fail });
        continue;
      }
      const [dir, git] = "path" in dep ? [located(pkg, dep, fail)] : fetched(dep, fail);
      const chain = [...path, pkg];
      const cycle = chain.findIndex((p) => p.dir === dir);
      if (cycle >= 0) throw fail(`'${dep.name}' depends back on '${pkg.manifest.name}': ${chain.slice(cycle).map((p) => p.manifest.name).join(" -> ")} -> ${dep.name}; packages can't depend on each other in a cycle`);
      // One commit is one package, however much of its hash a manifest wrote.
      let found = byDir.get(dir) ?? (git && [...byDir.values()].find((p) => p.git?.url === git.url && p.git.commit === git.commit));
      if (!found) {
        if (git && !existsSync(join(dir, MANIFEST))) throw fail(`'${git.url}' has no ${MANIFEST} at its top, so it isn't a Fish package`);
        found = { manifest: loadManifest(join(dir, MANIFEST), "lib"), dir, deps: new Map(), ...(git && { git }) };
        named(found, dep.name, pkg, fail);
        const other = byName.get(dep.name);
        if (other) throw fail(`'${dep.name}' already comes from '${relative(pkg.dir, other.dir)}' in this program, so it can't also come from '${relative(pkg.dir, dir)}'`);
        byDir.set(dir, found);
        byName.set(dep.name, found);
        visit(found, chain);
      }
      named(found, dep.name, pkg, fail);
      pkg.deps.set(dep.name, found);
    }
  };
  visit(root, []);
  if (wanted.length > 0) fromRegistry(locking, root, wanted, byName, byDir);
  const packages = [...byDir.values()];
  // A lib inside a package nested in this one would build as that package's file, and reach
  // what is private to it.
  for (const p of packages) {
    const lib = join(p.dir, p.manifest.lib);
    const holder = existsSync(lib) ? packageOf(packages, lib) : undefined;
    if (holder && holder !== p) throw fieldError(join(p.dir, MANIFEST), "lib", `the lib '${p.manifest.lib}' is a file inside the package '${holder.manifest.name}'; a package's lib is one of its own files`);
  }
  // A crate's build script and macros run on the machine building, so for now only the package
  // being built chooses its crates.
  for (const p of packages.slice(1)) {
    if (!p.manifest.rustDependencies) continue;
    const file = join(p.dir, MANIFEST);
    const src = readFileSync(file, "utf8");
    const table = parseToml(src).get("rust-dependencies") as Table;
    throw inManifest(new CompileError(`the dependency '${p.manifest.name}' lists Rust crates under [rust-dependencies]; only the package being built may list them for now`, table.start, table.end), file, src);
  }
  lock(locking, packages);
  return packages;
}

export const LOCKFILE = "fish.lock";

// Whether a build may change `fish.lock`, as `fishc build --locked` says it may not, for CI;
// and which registry packages `fishc update` moves past their locked versions, "all" for every one.
export type Locking = { locked: boolean; update?: Set<string> | "all" };

// Writes `fish.lock` beside the root package's manifest when what it resolves to has changed,
// after checking that each git package's files still hash to what the lock recorded.
function lock(locking: Locking, packages: Package[]) {
  const [root, ...deps] = packages;
  const file = join(root!.dir, LOCKFILE);
  const had = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  if (deps.length === 0 && had === undefined) return;
  const recorded = had === undefined ? new Map<string, Table>() : locked(file, had);
  const entries = deps.map((p) => {
    const source = p.git ? `git+${p.git.url}#${p.git.commit}` : p.registry ? `registry+${p.registry.url}` : `path+${relative(root!.dir, p.dir) || "."}`;
    const checksum = p.git || p.registry ? `sha256:${checksumOf(p.dir)}` : undefined;
    const before = recorded.get(p.manifest.name);
    const was = before?.keys.get("checksum")?.value.value;
    // The same source at the same version should be the same files; a new version is just new.
    const same = before?.keys.get("source")?.value.value === source && before?.keys.get("version")?.value.value === p.registry?.version;
    if (checksum && same && was !== checksum) {
      throw inManifest(new CompileError(`the files of '${p.manifest.name}' at ${p.dir} no longer match its checksum in ${LOCKFILE}; delete that directory to fetch it again`, before!.start, before!.end), file, had);
    }
    // The package manager flags a dependency that uses unsafe when it first enters the lock.
    if (p.registry?.unsafe && before?.keys.get("unsafe")?.value.value !== true) console.error(`note: '${p.manifest.name}' ${p.registry.version} from the registry uses unsafe`);
    return { name: p.manifest.name, source, checksum, version: p.registry?.version, unsafe: p.registry?.unsafe };
  });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const text = ["# Written by fishc build; it records exactly which packages a build used.", "version = 1", ...entries.map((e) => `\n[[package]]\nname = "${e.name}"${e.version ? `\nversion = "${e.version}"` : ""}\nsource = ${JSON.stringify(e.source)}${e.checksum ? `\nchecksum = "${e.checksum}"` : ""}${e.unsafe ? "\nunsafe = true" : ""}`)].join("\n") + "\n";
  if (text === had) return;
  if (locking.locked) throw inManifest(new CompileError(`${LOCKFILE} is out of date with ${MANIFEST}, and --locked keeps it as it is; build without --locked to update it, then commit it`, 0, 1), had === undefined ? join(root!.dir, MANIFEST) : file, had);
  // Written beside it and moved over it, so a build reading it never sees half a lock.
  const next = `${file}.${process.pid}.tmp`;
  writeFileSync(next, text);
  renameSync(next, file);
}

// A registry dependency of one of the program's own packages, and how to point at it.
type Wanted = { pkg: Package; dep: Extract<Dependency, { version: string }>; fail: (message: string) => unknown };

// The registry packages the program's own packages ask for, one version of each name, fetched
// and linked to whoever asked; a registry package's own dependencies are all the registry's.
function fromRegistry(locking: Locking, root: Package, wanted: Wanted[], byName: Map<string, Package>, byDir: Map<string, Package>) {
  const first = new Map<string, (message: string) => unknown>();
  const roots = new Map<string, Request[]>();
  for (const { pkg, dep, fail } of wanted) {
    if (!first.has(dep.name)) first.set(dep.name, fail);
    const other = byName.get(dep.name);
    if (other) throw fail(`'${dep.name}' already comes from '${relative(pkg.dir, other.dir)}' in this program, so it can't also come from the registry`);
    roots.set(dep.name, [...(roots.get(dep.name) ?? []), { range: dep.version, by: pkg.manifest.name }]);
  }
  // An error is shown at the program's own request for the package it is about, or its first one.
  const blame = (e: unknown, about?: string) => {
    const message = e instanceof Error ? e.message : String(e);
    const name = about ?? (e instanceof Unresolved ? e.pkg : undefined);
    return (first.get(name ?? "") ?? first.values().next().value!)(message);
  };
  const url = registryUrl(root.manifest);
  const lockedHere = lockedVersions(root, url);
  const update = locking.update;
  if (update === "all") lockedHere.clear();
  else for (const name of update ?? []) lockedHere.delete(name);
  const pinned = new Map([...lockedHere].map(([name, l]) => [name, l.version]));
  // The lock and the cache answer a build on their own whenever they can, so it needs no network.
  const offline = update ? undefined : fromLock(url, roots, lockedHere);
  let chosen: Chosen[];
  if (offline) chosen = offline;
  else {
    try {
      // What the lock can't answer is asked of the index as it is now, not as it was last cloned.
      const index = openIndex(url, true);
      chosen = [...resolveVersions(index, roots, pinned).values()].map((e) => ({ name: e.name, text: e.text, deps: e.dependencies, unsafe: e.unsafe, dir: () => unpacked(index, e) }));
    } catch (e) {
      throw blame(e);
    }
  }
  // One name, one package: a registry pick can't stand for the program's own or a path or git one.
  for (const entry of chosen) {
    const other = byName.get(entry.name);
    if (other) throw blame(new Error(`'${entry.name}' comes from the registry for a registry package's dependency, but already comes from '${relative(root.dir, other.dir) || "."}' in this program`), entry.name);
  }
  const made = new Map<string, Package>();
  for (const entry of chosen) {
    let dir: string;
    try {
      dir = entry.dir();
    } catch (e) {
      throw blame(e instanceof Error ? new Error(`can't use '${entry.name}' ${entry.text} from the registry: ${e.message}`) : e, entry.name);
    }
    const manifest = loadManifest(join(dir, MANIFEST), "lib");
    if (manifest.name !== entry.name || manifest.version !== entry.text) throw blame(new Error(`the registry's archive of '${entry.name}' ${entry.text} holds '${manifest.name}' ${manifest.version}`), entry.name);
    const outside = manifest.dependencies.find((d) => !("version" in d));
    if (outside) throw blame(new Error(`'${entry.name}' ${entry.text} from the registry depends on '${outside.name}' by path or git; a registry package depends only on the registry`), entry.name);
    // Resolution followed the index's dependencies, so the archive must declare the same ones.
    const declared = new Map(manifest.dependencies.map((d) => [d.name, (d as { version: string }).version]));
    const listed = entry.deps;
    if (listed && (declared.size !== listed.size || [...listed].some(([n, r]) => declared.get(n) !== r))) {
      throw blame(new Error(`the registry lists other dependencies for '${entry.name}' ${entry.text} than its own ${MANIFEST} declares`), entry.name);
    }
    const pkg: Package = { manifest, dir, deps: new Map(), registry: { url, version: entry.text, unsafe: entry.unsafe } };
    made.set(entry.name, pkg);
    byDir.set(dir, pkg);
    byName.set(entry.name, pkg);
  }
  for (const pkg of made.values()) for (const d of pkg.manifest.dependencies) pkg.deps.set(d.name, made.get(d.name)!);
  for (const { pkg, dep } of wanted) pkg.deps.set(dep.name, made.get(dep.name)!);
  // As with path and git packages, registry packages can't depend on each other in a cycle.
  const visiting: string[] = [];
  const done = new Set<string>();
  const walk = (pkg: Package) => {
    const name = pkg.manifest.name;
    const at = visiting.indexOf(name);
    if (at >= 0) throw blame(new Error(`the registry packages ${[...visiting.slice(at), name].join(" -> ")} depend on each other in a cycle`), visiting[0]);
    if (done.has(name)) return;
    visiting.push(name);
    for (const dep of pkg.deps.values()) walk(dep);
    visiting.pop();
    done.add(name);
  };
  for (const pkg of made.values()) walk(pkg);
}

// A registry package resolution chose: from the index, with its listed dependencies, or from the
// lock and cache, whose own manifest was checked against the index when it was first unpacked.
type Chosen = { name: string; text: string; deps?: Map<string, string>; unsafe: boolean; dir: () => string };

// The registry versions `fish.lock` holds for packages from this index, by name, and the checksum
// of each one's files.
function lockedVersions(root: Package, url: string): Map<string, { version: string; checksum: string; unsafe: boolean }> {
  const file = join(root.dir, LOCKFILE);
  if (!existsSync(file)) return new Map();
  const found = new Map<string, { version: string; checksum: string; unsafe: boolean }>();
  for (const [name, t] of locked(file, readFileSync(file, "utf8"))) {
    const [version, checksum] = [t.keys.get("version")?.value.value, t.keys.get("checksum")?.value.value];
    const unsafe = t.keys.get("unsafe")?.value.value === true;
    if (t.keys.get("source")?.value.value === `registry+${url}` && typeof version === "string" && typeof checksum === "string") found.set(name, { version, checksum: checksum.replace(/^sha256:/, ""), unsafe });
  }
  return found;
}

// The registry packages, straight from the lock and the cache, when the locked versions still fit
// every range and each is already unpacked; undefined when the index has to be asked.
function fromLock(url: string, roots: Map<string, Request[]>, pinned: Map<string, { version: string; checksum: string; unsafe: boolean }>): Chosen[] | undefined {
  const chosen = new Map<string, string>();
  const queue = [...roots].map(([name, rs]) => ({ name, ranges: rs.map((r) => r.range) }));
  while (queue.length > 0) {
    const { name, ranges } = queue.pop()!;
    const lock = pinned.get(name);
    const version = lock?.version;
    const dir = lock && cachedCopy(url, name, lock.version, lock.checksum);
    if (!version || !dir || !ranges.every((r) => satisfies(parseVersion(version)!, parseRange(r)!))) return undefined;
    if (chosen.has(name)) continue;
    chosen.set(name, dir);
    for (const d of loadManifest(join(dir, MANIFEST)).dependencies) {
      if (!("version" in d)) return undefined;
      queue.push({ name: d.name, ranges: [d.version] });
    }
  }
  return [...chosen].map(([name, dir]) => ({ name, text: pinned.get(name)!.version, unsafe: pinned.get(name)!.unsafe, dir: () => dir }));
}

// Where a registry package's versions are unpacked in the cache, one directory per archive by its
// sha256, so builds unpacking the same archive at once write the same files to the same place.
const versionDir = (url: string, name: string, version: string) => join(cacheDir(), "registry", createHash("sha256").update(url).digest("hex").slice(0, 12), name, version);

// Whether `dir` holds a finished unpack whose files still hash to what its marker recorded.
function intact(dir: string): string | undefined {
  if (!existsSync(`${dir}.files`) || !existsSync(join(dir, MANIFEST))) return undefined;
  const sum = readFileSync(`${dir}.files`, "utf8").trim();
  return sum === checksumOf(dir) ? sum : undefined;
}

// The unpacked copy of this version whose files hash to `checksum`, as the lock recorded it.
function cachedCopy(url: string, name: string, version: string, checksum: string): string | undefined {
  const parent = versionDir(url, name, version);
  if (!existsSync(parent)) return undefined;
  for (const e of readdirSync(parent)) {
    const dir = join(parent, e);
    if (/^[0-9a-f]{64}$/.test(e) && intact(dir) === checksum) return realpathSync(dir);
  }
  return undefined;
}

export const MAX_DOWNLOAD = 64 * 1024 * 1024;
export const MAX_UNPACKED = 256 * 1024 * 1024;

// A registry package's files, from its archive, unpacked once into the cache after its sha256
// matched the index's; the archive is refused rather than partly unpacked, and a copy whose files
// changed since is unpacked again.
function unpacked(index: Index, entry: IndexEntry): string {
  const dir = join(versionDir(index.url, entry.name, entry.text), entry.sha256);
  if (intact(dir)) return realpathSync(dir);
  const url = index.dl.replaceAll("{name}", entry.name).replaceAll("{version}", entry.text);
  const archive = download(url);
  if (createHash("sha256").update(archive).digest("hex") !== entry.sha256) throw new Error(`its archive at ${url} doesn't match the sha256 the registry lists`);
  let files;
  try {
    // Capped while it expands, so a small archive can't blow up into a huge one in memory.
    const tar = gunzipSync(archive, { maxOutputLength: MAX_UNPACKED + 1024 * 1024 });
    files = untar(new Uint8Array(tar.buffer, tar.byteOffset, tar.byteLength), MAX_UNPACKED);
  } catch (e) {
    if (e instanceof RangeError) throw new Error(`its archive expands past ${MAX_UNPACKED / 1024 / 1024} MiB`);
    throw new Error(e instanceof Error && e.message.startsWith("its archive") ? e.message : "its archive isn't a gzipped tar");
  }
  mkdirSync(join(dir, ".."), { recursive: true });
  const work = mkdtempSync(`${dir}.unpack-`);
  const changed = `${dir}.changed-${process.pid}`;
  try {
    for (const f of files) {
      mkdirSync(join(work, dirname(f.path)), { recursive: true });
      writeFileSync(join(work, f.path), f.data);
    }
    const sum = checksumOf(work);
    // A copy here whose files were changed by hand is moved aside; any other build unpacking this
    // archive now writes these same files.
    if (existsSync(dir) && !intact(dir)) {
      try {
        renameSync(dir, changed);
      } catch {}
    }
    try {
      renameSync(work, dir);
    } catch (e) {
      if (!existsSync(dir)) throw e;
    }
    const next = `${dir}.files.${process.pid}.tmp`;
    writeFileSync(next, sum + "\n");
    renameSync(next, `${dir}.files`);
    if (checksumOf(dir) !== sum) throw new Error("its unpacked files changed while it was being unpacked; build again");
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(changed, { recursive: true, force: true });
  }
  return realpathSync(dir);
}

// An archive's bytes: a file:// URL read directly, any other through curl, refused past the limit.
function download(url: string): Uint8Array {
  if (url.startsWith("file://")) {
    const path = decodeURIComponent(new URL(url).pathname);
    if (!existsSync(path)) throw new Error(`its archive isn't at ${url}`);
    // A device, pipe or terminal could be read forever, so only a plain file is an archive.
    const fd = openSync(path, "r");
    try {
      const info = fstatSync(fd);
      if (!info.isFile()) throw new Error(`its archive at ${url} isn't a file`);
      if (info.size > MAX_DOWNLOAD) throw new Error(`its archive at ${url} is larger than ${MAX_DOWNLOAD / 1024 / 1024} MiB`);
      const bytes = new Uint8Array(info.size);
      readSync(fd, bytes, 0, info.size, 0);
      return bytes;
    } finally {
      closeSync(fd);
    }
  }
  if (!/^https?:\/\//.test(url)) throw new Error(`its archive's URL ${url} isn't http, https or file`);
  if (!Bun.which("curl")) throw new Error("downloading needs the curl command, which isn't on PATH; install curl");
  // `-q` first keeps the user's ~/.curlrc out of it, and a time limit keeps a stalled server from
  // holding the build forever.
  const got = Bun.spawnSync(["curl", "-q", "--fail", "--silent", "--show-error", "--location", "--proto", "=https,http", "--proto-redir", "=https,http", "--max-filesize", String(MAX_DOWNLOAD), "--max-time", "600", "--", url], { stdout: "pipe", stderr: "pipe" });
  if (got.exitCode !== 0) throw new Error(`can't download ${url}: ${got.stderr.toString().trim().replace(/^curl: \(\d+\) /, "") || "curl failed"}`);
  return got.stdout;
}

// A package is depended on by the name its own manifest gives it, however it was reached.
function named(found: Package, name: string, by: Package, fail: (message: string) => unknown) {
  if (found.manifest.name !== name) throw fail(`the package at '${relative(by.dir, found.dir) || "."}' is named '${found.manifest.name}' in its ${MANIFEST}, not '${name}'; depend on it by that name`);
}

// The packages a lockfile records, by name.
function locked(file: string, src: string): Map<string, Table> {
  try {
    const toml = parseToml(src);
    const version = (toml.get("") as Table).keys.get("version");
    if (version?.value.value !== 1) throw new CompileError(`this ${LOCKFILE} isn't one this fishc writes, version 1; a newer fishc may have written it`, version?.value.start ?? 0, version?.value.end ?? 1);
    const found = toml.get("package") ?? [];
    return new Map((Array.isArray(found) ? found : [found]).map((t) => [String(t.keys.get("name")?.value.value), t]));
  } catch (e) {
    throw inManifest(e, file, src);
  }
}

// The sha256 of every file of a fetched package, by sorted relative path: it is a copy nothing
// should change, so any change to anything a build could read from it changes the sum.
export function checksumOf(dir: string): string {
  const hash = createHash("sha256");
  const walk = (at: string): string[] =>
    readdirSync(join(dir, at), { withFileTypes: true }).flatMap((e) => {
      const path = at ? `${at}/${e.name}` : e.name;
      // A link is hashed as where it points, so adding or changing one changes the sum.
      return e.isDirectory() ? walk(path) : [path];
    });
  for (const path of walk("").sort()) {
    const at = join(dir, path);
    const link = linkTarget(at);
    hash.update(path).update("\0").update(link === undefined ? readFileSync(at) : `-> ${link}`).update("\0");
  }
  return hash.digest("hex");
}

// Where a symbolic link at `at` points, or undefined when it isn't one.
function linkTarget(at: string): string | undefined {
  try {
    return readlinkSync(at);
  } catch {
    return undefined;
  }
}

// The first symbolic link under `dir`, as a path inside it.
function firstLink(dir: string, at = ""): string | undefined {
  for (const e of readdirSync(join(dir, at), { withFileTypes: true })) {
    const path = at ? `${at}/${e.name}` : e.name;
    if (e.isSymbolicLink()) return path;
    const inner = e.isDirectory() ? firstLink(dir, path) : undefined;
    if (inner) return inner;
  }
  return undefined;
}

// The real directory a path dependency names, which must hold a Fish package.
function located(pkg: Package, dep: Extract<Dependency, { path: string }>, fail: (message: string) => unknown): string {
  const dir = resolve(pkg.dir, dep.path);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw fail(`can't find the directory '${dep.path}' for '${dep.name}'`);
  if (!existsSync(join(dir, MANIFEST))) throw fail(`'${dep.path}' has no ${MANIFEST}, so it isn't a Fish package`);
  return realpathSync(dir);
}

// A git dependency's files at its commit, fetched once into the cache and read from there after,
// each repository and commit in a directory of its own. The commit it resolved to is kept beside
// that directory, outside what the repository put in it.
function fetched(dep: Extract<Dependency, { git: string }>, fail: (message: string) => unknown): [string, { url: string; commit: string }] {
  const repo = join(cacheDir(), "git", `${dep.git.replace(/^[a-z+]+:\/\//, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(-60)}-${createHash("sha256").update(dep.git).digest("hex").slice(0, 12)}`);
  const dir = join(repo, dep.rev);
  const marker = `${dir}.commit`;
  if (!existsSync(marker) || !existsSync(dir)) {
    if (!Bun.which("git")) throw fail(`fetching '${dep.git}' needs the git command, which isn't on PATH; install git`);
    mkdirSync(repo, { recursive: true });
    const work = mkdtempSync(join(repo, ".fetch-"));
    try {
      const git = (...args: string[]) => run(work, ...args);
      const clone = git("clone", "--quiet", "--no-checkout", "--", dep.git, ".");
      if (clone.exitCode !== 0) throw fail(`can't fetch '${dep.git}': ${firstLine(clone.stderr.toString())}`);
      // The commit whose hash starts with rev, never a branch or tag that happens to be named like it.
      const objects = git("rev-parse", "--disambiguate=" + dep.rev).stdout.toString().split("\n").filter((o) => o !== "");
      const commits = objects.filter((o) => git("cat-file", "-t", o).stdout.toString().trim() === "commit");
      if (commits.length === 0) throw fail(`'${dep.git}' has no commit '${dep.rev}'`);
      if (commits.length > 1) throw fail(`'${dep.rev}' starts the hashes of ${commits.length} commits of '${dep.git}'; give more of its digits`);
      const commit = commits[0]!;
      // `^{commit}` makes the full hash an object name, so a branch named like it can't stand in.
      if (git("-c", "advice.detachedHead=false", "checkout", "--quiet", "--detach", `${commit}^{commit}`).exitCode !== 0) throw fail(`can't check out '${dep.rev}' of '${dep.git}'`);
      if (git("rev-parse", "HEAD").stdout.toString().trim() !== commit) throw fail(`checking out '${dep.rev}' of '${dep.git}' gave another commit`);
      rmSync(join(work, ".git"), { recursive: true, force: true });
      const link = firstLink(work);
      if (link) throw fail(`'${dep.git}' holds a symbolic link at '${link}'; a package from git can't, since a link reaches files its commit doesn't pin`);
      // The commit is recorded first and the files moved into place whole, so a build sees both
      // only once the fetch is done; another build that fetched the same commit first has
      // already put the same files there.
      const next = `${marker}.${process.pid}.tmp`;
      writeFileSync(next, commit + "\n");
      renameSync(next, marker);
      try {
        renameSync(work, dir);
      } catch (e) {
        if (!existsSync(dir)) throw e;
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  const commit = readFileSync(marker, "utf8").trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw fail(`the cached copy of '${dep.git}' is damaged; delete ${dir} to fetch it again`);
  return [realpathSync(dir), { url: dep.git, commit }];
}

// The package holding `file`: the one whose directory holds it most closely, so a package nested
// in another's directory owns its own files.
export function packageOf(packages: Package[], file: string): Package | undefined {
  const real = realpathSync(file);
  return packages.filter((p) => real.startsWith(p.dir + "/")).sort((a, b) => b.dir.length - a.dir.length)[0];
}

// The dependency package holding `file`, not the program's own, which may reach further.
export function dependencyOf(packages: Package[], file: string): Package | undefined {
  const owner = packageOf(packages, file);
  return owner === packages[0] ? undefined : owner;
}

// The library file a bare import names, when the package holding the importing file depends on
// a Fish package of that name; undefined sends it on to npm's packages.
export function dependencyLib(packages: Package[], from: string, specifier: string, at: { start: usize; end: usize }): string | undefined {
  const owner = packageOf(packages, from);
  if (!owner) return undefined;
  const scoped = specifier.startsWith("@");
  const name = specifier.split("/").slice(0, scoped ? 2 : 1).join("/");
  const dep = owner.deps.get(name);
  if (!dep) return undefined;
  // A package's lib is its public face: its other files' exports are for its own files alone.
  if (name !== specifier) throw new CompileError(`'${specifier}' is a file inside the package '${name}', and a package's files are private to it; import from '${name}', which gives what its lib ${dep.manifest.lib} exports`, at.start, at.end);
  return join(dep.dir, dep.manifest.lib);
}
