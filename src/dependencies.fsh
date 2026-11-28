import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readlinkSync, readSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { CompileError } from "./diag.fsh";
import { firstLine, git as run } from "./git.fsh";
import { openIndex, registryUrl, resolveVersions, Unresolved, type Index, type IndexEntry, type Request } from "./registry_index.fsh";
import { parseRange, parseVersion, satisfies } from "./semver.fsh";
import { untar, type TarFile } from "./tar.fsh";
import { cacheDir } from "./mathlib.fsh";
import type { Locking } from "./program.fsh";
import { fieldError, findManifest, inManifest, loadManifest, MANIFEST, parseToml, type Dependency, type Manifest, type Table, type TomlValue } from "./manifest.fsh";

// A Fish package of a program: its manifest, its real directory, the packages its dependencies
// name, by the names it imports them under, each by its directory, and for one from git, the
// commit it was fetched at.
export type Package = { manifest: Manifest; dir: string; deps: Map<string, string>; git?: { url: string; commit: string }; registry?: { url: string; version: string; unsafe: boolean } };

// Where in which manifest a dependency is written, for an error about it.
type Blame = { file: string; start: usize; end: usize };

// An error about a dependency, shown against the manifest that lists it.
/** @throws {IoError} */
function failure(at: Ref<Blame>, message: string): CompileError {
  return inManifest(new CompileError("E0906", message, at.start, at.end), at.file);
}

// A registry dependency of one of the program's own packages, by the package's place, and where
// it is written.
type Wanted = { pkg: usize; name: string; version: string; blame: Blame };

// A registry package resolution chose: from the index, with its listed dependencies, or from the
// lock and cache, whose own manifest was checked against the index when it was first unpacked.
type Chosen = { name: string; text: string; deps?: Map<string, string>; unsafe: boolean; dir?: string; entry?: IndexEntry };

// The packages found so far, the program's own first, each by its directory and by its name.
class Resolver {
  packages: Package[] = [];
  byDir = new Map<string, usize>();
  byName = new Map<string, usize>();
  // Registry dependencies wait until every range on each name is known, then take one version.
  wanted: Wanted[] = [];

  add(this: Mut<this>, pkg: Package): usize {
    const at = this.packages.length;
    this.byDir.set(pkg.dir, at);
    this.packages.push(pkg);
    return at;
  }

  take(this: Own<this>): Package[] {
    return this.packages;
  }

  // Each package's dependencies come from its own manifest; a package reached twice from the
  // same place is one package.
  /** @throws {CompileError | Error | IoError} */
  visit(this: Mut<this>, at: usize, path: usize[]): void {
    const deps = [...this.packages[at]!.manifest.dependencies];
    const here = this.packages[at]!.dir;
    const pkgName = this.packages[at]!.manifest.name;
    const fromGit = this.packages[at]!.git !== undefined;
    for (const dep of deps) {
      const blame: Blame = { file: join(here, MANIFEST), start: dep.start, end: dep.end };
      // What a commit pins can't reach past it to files on this machine.
      if (fromGit && "path" in dep) throw failure(blame, `'${pkgName}' comes from git, so its dependencies must too; a path dependency would bring in files its commit doesn't pin`);
      if ("version" in dep) {
        this.wanted.push({ pkg: at, name: dep.name, version: dep.version, blame });
        continue;
      }
      let dir = "";
      let git: { url: string; commit: string } | undefined = undefined;
      if ("path" in dep) dir = located(here, dep, blame);
      else {
        const [d, g] = fetched(dep, blame);
        dir = d;
        git = g;
      }
      let chain = [...path];
      chain.push(at);
      for (let i: usize = 0; i < chain.length; i++) {
        if (this.packages[chain[i]!]!.dir !== dir) continue;
        let names: string[] = [];
        for (let k = i; k < chain.length; k++) names.push(this.packages[chain[k]!]!.manifest.name);
        throw failure(blame, `'${dep.name}' depends back on '${pkgName}': ${names.join(" -> ")} -> ${dep.name}; packages can't depend on each other in a cycle`);
      }
      // One commit is one package, however much of its hash a manifest wrote.
      let found = this.byDir.get(dir);
      if (found === undefined && git !== undefined) {
        for (let i: usize = 0; i < this.packages.length; i++) {
          const other: Ref<{ url: string; commit: string } | undefined> = this.packages[i]!.git;
          if (other !== undefined && other.url === git.url && other.commit === git.commit) {
            found = i;
            break;
          }
        }
      }
      if (found === undefined) {
        if (git !== undefined && !existsSync(join(dir, MANIFEST))) throw failure(blame, `'${git.url}' has no ${MANIFEST} at its top, so it isn't a Fish package`);
        const manifest = loadManifest(join(dir, MANIFEST), "lib");
        named(manifest.name, dir, dep.name, here, blame);
        const other = this.byName.get(dep.name);
        if (other !== undefined) throw failure(blame, `'${dep.name}' already comes from '${relative(here, this.packages[other]!.dir)}' in this program, so it can't also come from '${relative(here, dir)}'`);
        const made = this.add({ manifest, dir, deps: new Map<string, string>(), git });
        this.byName.set(dep.name, made);
        this.visit(made, chain);
        found = made;
      }
      named(this.packages[found]!.manifest.name, this.packages[found]!.dir, dep.name, here, blame);
      const target = this.packages[found]!.dir;
      this.packages[at]!.deps.set(dep.name, target);
    }
  }

  // The registry packages the program's own packages ask for, one version of each name, fetched
  // and linked to whoever asked; a registry package's own dependencies are all the registry's.
  /** @throws {CompileError | Error | IoError} */
  fromRegistry(this: Mut<this>, locking: Ref<Locking>): void {
    let first = new Map<string, Blame>();
    let roots = new Map<string, Request[]>();
    for (const w of this.wanted) {
      if (!first.has(w.name)) first.set(w.name, { file: w.blame.file, start: w.blame.start, end: w.blame.end });
      const other = this.byName.get(w.name);
      const asker: Ref<Package> = this.packages[w.pkg]!;
      if (other !== undefined) throw failure(w.blame, `'${w.name}' already comes from '${relative(asker.dir, this.packages[other]!.dir)}' in this program, so it can't also come from the registry`);
      const had = roots.get(w.name);
      let asked: Request[] = had !== undefined ? had : [];
      asked.push({ range: w.version, by: asker.manifest.name });
      roots.set(w.name, asked);
    }
    const root: Ref<Package> = this.packages[0]!;
    const url = registryUrl(root.manifest);
    const rootDir = root.dir;
    let lockedHere = lockedVersions(rootDir, url);
    const update: Ref<Set<string> | "all" | undefined> = locking.update;
    if (update === "all") lockedHere.clear();
    else if (update !== undefined) for (const name of update) lockedHere.delete(name);
    let pinned = new Map<string, string>();
    for (const [name, l] of lockedHere) pinned.set(name, l.version);
    // The lock and the cache answer a build on their own whenever they can, so it needs no network.
    const offline = update !== undefined ? undefined : fromLock(url, roots, lockedHere);
    let chosen: Chosen[] = [];
    let index: Index | undefined = undefined;
    if (offline !== undefined) chosen = offline;
    else {
      try {
        // What the lock can't answer is asked of the index as it is now, not as it was last cloned.
        const opened = openIndex(url, true);
        const picked = resolveVersions(opened, roots, pinned);
        for (const name of [...picked.keys()]) {
          const e = picked.get(name)!;
          let deps = new Map<string, string>();
          for (const [k, v] of e.dependencies) deps.set(k, v);
          chosen.push({ name: e.name, text: e.text, deps, unsafe: e.unsafe, entry: e });
        }
        index = opened;
      } catch (e) {
        throw blamed(first, e, undefined);
      }
    }
    // One name, one package: a registry pick can't stand for the program's own or a path or git one.
    for (const entry of chosen) {
      const other = this.byName.get(entry.name);
      if (other !== undefined) {
        const shown = relative(rootDir, this.packages[other]!.dir);
        throw blamed(first, new Error(`'${entry.name}' comes from the registry for a registry package's dependency, but already comes from '${shown !== "" ? shown : "."}' in this program`), entry.name);
      }
    }
    let made = new Map<string, usize>();
    for (const entry of chosen) {
      let dir = "";
      try {
        const known = entry.dir;
        const listed: Ref<IndexEntry | undefined> = entry.entry;
        if (known !== undefined) dir = known;
        else if (index !== undefined && listed !== undefined) dir = unpacked(index, listed);
      } catch (e) {
        throw blamed(first, e instanceof Error ? new Error(`can't use '${entry.name}' ${entry.text} from the registry: ${e.message}`) : e, entry.name);
      }
      const manifest = loadManifest(join(dir, MANIFEST), "lib");
      if (manifest.name !== entry.name || manifest.version !== entry.text) throw blamed(first, new Error(`the registry's archive of '${entry.name}' ${entry.text} holds '${manifest.name}' ${manifest.version}`), entry.name);
      const outside = manifest.dependencies.find((d) => !("version" in d));
      if (outside !== undefined) throw blamed(first, new Error(`'${entry.name}' ${entry.text} from the registry depends on '${outside.name}' by path or git; a registry package depends only on the registry`), entry.name);
      // Resolution followed the index's dependencies, so the archive must declare the same ones.
      let declared = new Map<string, string>();
      for (const d of manifest.dependencies) if ("version" in d) declared.set(d.name, d.version);
      const listed: Ref<Map<string, string> | undefined> = entry.deps;
      if (listed !== undefined) {
        let differ = declared.size !== listed.size;
        for (const [n, r] of listed) if (declared.get(n) !== r) differ = true;
        if (differ) throw blamed(first, new Error(`the registry lists other dependencies for '${entry.name}' ${entry.text} than its own ${MANIFEST} declares`), entry.name);
      }
      const at = this.add({ manifest, dir, deps: new Map<string, string>(), registry: { url, version: entry.text, unsafe: entry.unsafe } });
      made.set(entry.name, at);
      this.byName.set(entry.name, at);
    }
    for (const at of made.values()) {
      const deps = [...this.packages[at]!.manifest.dependencies];
      for (const d of deps) {
        const target = this.packages[made.get(d.name)!]!.dir;
        this.packages[at]!.deps.set(d.name, target);
      }
    }
    for (const w of this.wanted) {
      const target = this.packages[made.get(w.name)!]!.dir;
      this.packages[w.pkg]!.deps.set(w.name, target);
    }
    // As with path and git packages, registry packages can't depend on each other in a cycle.
    let visiting: string[] = [];
    let done = new Set<string>();
    for (const at of made.values()) this.cycles(at, visiting, done, first);
  }

  /** @throws {CompileError | IoError} */
  private cycles(this: Mut<this>, at: usize, visiting: Mut<string[]>, done: Mut<Set<string>>, first: Ref<Map<string, Blame>>): void {
    const name = this.packages[at]!.manifest.name;
    const loop = visiting.indexOf(name);
    if (loop >= 0) throw blamed(first, new Error(`the registry packages ${[...visiting.slice(loop), name].join(" -> ")} depend on each other in a cycle`), visiting[0]);
    if (done.has(name)) return;
    visiting.push(name);
    const deps = [...this.packages[at]!.deps.values()];
    for (const dir of deps) this.cycles(this.byDir.get(dir)!, visiting, done, first);
    visiting.pop();
    done.add(name);
  }
}

// The packages a program whose entry is `entry` is built from, the one holding the entry first,
// or none when no `fish.toml` is at or above it. Each package's dependencies come from its own
// manifest; a package reached twice from the same place is one package. `locking` says how the
// lockfile may change.
/** @throws {CompileError | Error | IoError} */
export function resolvePackages(entry: string, locking: Ref<Locking>): Package[] | undefined {
  const file = findManifest(dirname(resolve(entry)));
  if (file === undefined) return undefined;
  let r = new Resolver();
  const manifest = loadManifest(file);
  const name = manifest.name;
  const root = r.add({ manifest, dir: realpathSync(dirname(file)), deps: new Map<string, string>() });
  r.byName.set(name, root);
  r.visit(root, []);
  if (r.wanted.length > 0) r.fromRegistry(locking);
  const packages = r.take();
  // A lib inside a package nested in this one would build as that package's file, and reach
  // what is private to it.
  for (const p of packages) {
    const lib = join(p.dir, p.manifest.lib);
    const holder = existsSync(lib) ? packageOf(packages, lib) : undefined;
    if (holder !== undefined && holder.dir !== p.dir) throw fieldError(join(p.dir, MANIFEST), "lib", `the lib '${p.manifest.lib}' is a file inside the package '${holder.manifest.name}'; a package's lib is one of its own files`);
  }
  // A crate's build script and macros run on the machine building, so for now only the package
  // being built chooses its crates.
  for (let i: usize = 1; i < packages.length; i++) {
    const p: Ref<Package> = packages[i]!;
    if (p.manifest.rustDependencies === undefined) continue;
    const manifestFile = join(p.dir, MANIFEST);
    const src = readFileSync(manifestFile, "utf8");
    const table = parseToml(src).get("rust-dependencies");
    const start = table !== undefined && !Array.isArray(table) ? table.start : 0;
    const end = table !== undefined && !Array.isArray(table) ? table.end : 1;
    throw inManifest(new CompileError("E0906", `the dependency '${p.manifest.name}' lists Rust crates under [rust-dependencies]; only the package being built may list them for now`, start, end), manifestFile, src);
  }
  lock(locking, packages);
  return packages;
}

export const LOCKFILE = "fish.lock";

// A lockfile table's string or boolean at `key`, when it has one of that kind there.
function stringAt(t: Ref<Table>, key: string): string | undefined {
  const found = t.keys.get(key);
  if (found === undefined) return undefined;
  const v = found.value.value;
  return typeof v === "string" ? v : undefined;
}

function trueAt(t: Ref<Table>, key: string): boolean {
  const found = t.keys.get(key);
  return found !== undefined && found.value.value === true;
}

type LockEntry = { name: string; source: string; checksum: string | undefined; version: string | undefined; unsafe: boolean };

// Writes `fish.lock` beside the root package's manifest when what it resolves to has changed,
// after checking that each git package's files still hash to what the lock recorded.
/** @throws {CompileError | IoError} */
function lock(locking: Ref<Locking>, packages: Ref<Package[]>): void {
  const rootDir = packages[0]!.dir;
  const file = join(rootDir, LOCKFILE);
  const had = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  if (packages.length === 1 && had === undefined) return;
  const recorded = had === undefined ? new Map<string, Table>() : locked(file, had);
  let entries: LockEntry[] = [];
  for (let i: usize = 1; i < packages.length; i++) {
    const p: Ref<Package> = packages[i]!;
    const git: Ref<{ url: string; commit: string } | undefined> = p.git;
    const registry: Ref<{ url: string; version: string; unsafe: boolean } | undefined> = p.registry;
    const near = relative(rootDir, p.dir);
    const source = git !== undefined ? `git+${git.url}#${git.commit}` : registry !== undefined ? `registry+${registry.url}` : `path+${near !== "" ? near : "."}`;
    const checksum = git !== undefined || registry !== undefined ? `sha256:${checksumOf(p.dir)}` : undefined;
    const before = recorded.get(p.manifest.name);
    // The same source at the same version should be the same files; a new version is just new.
    const same = before !== undefined && stringAt(before, "source") === source && stringAt(before, "version") === (registry !== undefined ? registry.version : undefined);
    if (before !== undefined && checksum !== undefined && same && stringAt(before, "checksum") !== checksum) {
      throw inManifest(new CompileError("E0906", `the files of '${p.manifest.name}' at ${p.dir} no longer match its checksum in ${LOCKFILE}; delete that directory to fetch it again`, before.start, before.end), file, had);
    }
    // The package manager flags a dependency that uses unsafe when it first enters the lock.
    if (registry !== undefined && registry.unsafe && (before === undefined || !trueAt(before, "unsafe"))) console.error(`note: '${p.manifest.name}' ${registry.version} from the registry uses unsafe`);
    entries.push({ name: p.manifest.name, source, checksum, version: registry !== undefined ? registry.version : undefined, unsafe: registry !== undefined && registry.unsafe });
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  let lines = ["# Written by fishc build; it records exactly which packages a build used.", "version = 1"];
  for (const e of entries) {
    const version = e.version !== undefined ? `\nversion = "${e.version}"` : "";
    const sum = e.checksum !== undefined ? `\nchecksum = "${e.checksum}"` : "";
    lines.push(`\n[[package]]\nname = "${e.name}"${version}\nsource = ${JSON.stringify(e.source)}${sum}${e.unsafe ? "\nunsafe = true" : ""}`);
  }
  const text = lines.join("\n") + "\n";
  if (text === had) return;
  if (locking.locked) throw inManifest(new CompileError("E0906", `${LOCKFILE} is out of date with ${MANIFEST}, and --locked keeps it as it is; build without --locked to update it, then commit it`, 0, 1), had === undefined ? join(rootDir, MANIFEST) : file, had);
  // Written beside it and moved over it, so a build reading it never sees half a lock.
  const next = `${file}.${randomUUID()}.tmp`;
  writeFileSync(next, text);
  renameSync(next, file);
}

// An error at the program's own request for the package it is about, or its first one.
/** @throws {IoError} */
function blamed(first: Ref<Map<string, Blame>>, e: unknown, about: string | undefined): CompileError {
  const message = e instanceof Error ? e.message : e instanceof IoError ? e.message : "it failed";
  const name = about ?? (e instanceof Unresolved ? e.pkg : undefined);
  const at = first.get(name ?? "");
  if (at !== undefined) return failure(at, message);
  for (const b of first.values()) return failure(b, message);
  return new CompileError("E0906", message, 0, 1);
}

// The registry versions `fish.lock` holds for packages from this index, by name, and the checksum
// of each one's files.
/** @throws {CompileError | IoError} */
function lockedVersions(rootDir: string, url: string): Map<string, { version: string; checksum: string; unsafe: boolean }> {
  const file = join(rootDir, LOCKFILE);
  let found = new Map<string, { version: string; checksum: string; unsafe: boolean }>();
  if (!existsSync(file)) return found;
  for (const [name, t] of locked(file, readFileSync(file, "utf8"))) {
    const version = stringAt(t, "version");
    const checksum = stringAt(t, "checksum");
    if (stringAt(t, "source") === `registry+${url}` && version !== undefined && checksum !== undefined) found.set(name, { version, checksum: checksum.replace(/^sha256:/, ""), unsafe: trueAt(t, "unsafe") });
  }
  return found;
}

// The registry packages, straight from the lock and the cache, when the locked versions still fit
// every range and each is already unpacked; undefined when the index has to be asked.
/** @throws {CompileError | IoError} */
function fromLock(url: string, roots: Ref<Map<string, Request[]>>, pinned: Ref<Map<string, { version: string; checksum: string; unsafe: boolean }>>): Chosen[] | undefined {
  let chosen = new Map<string, string>();
  let queue: { name: string; ranges: string[] }[] = [];
  for (const [name, rs] of roots) queue.push({ name, ranges: rs.map((r) => r.range) });
  while (queue.length > 0) {
    const { name, ranges } = queue.pop()!;
    const held = pinned.get(name);
    if (held === undefined) return undefined;
    const dir = cachedCopy(url, name, held.version, held.checksum);
    const version = parseVersion(held.version);
    if (dir === undefined || version === undefined) return undefined;
    for (const r of ranges) if (!satisfies(version, parseRange(r)!)) return undefined;
    if (chosen.has(name)) continue;
    chosen.set(name, dir);
    const listed = loadManifest(join(dir, MANIFEST)).dependencies;
    for (const d of listed) {
      if (!("version" in d)) return undefined;
      queue.push({ name: d.name, ranges: [d.version] });
    }
  }
  let out: Chosen[] = [];
  for (const [name, dir] of chosen) {
    const held = pinned.get(name)!;
    out.push({ name, text: held.version, unsafe: held.unsafe, dir });
  }
  return out;
}

// Where a registry package's versions are unpacked in the cache, one directory per archive by its
// sha256, so builds unpacking the same archive at once write the same files to the same place.
function versionDir(url: string, name: string, version: string): string {
  return join(cacheDir(), "registry", createHash("sha256").update(url).digest("hex").slice(0, 12), name, version);
}

// Whether `dir` holds a finished unpack whose files still hash to what its marker recorded.
/** @throws {IoError} */
function intact(dir: string): string | undefined {
  if (!existsSync(`${dir}.files`) || !existsSync(join(dir, MANIFEST))) return undefined;
  const sum = readFileSync(`${dir}.files`, "utf8").trim();
  return sum === checksumOf(dir) ? sum : undefined;
}

// The unpacked copy of this version whose files hash to `checksum`, as the lock recorded it.
/** @throws {IoError} */
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
/** @throws {Error | IoError} */
function unpacked(index: Ref<Index>, entry: Ref<IndexEntry>): string {
  const dir = join(versionDir(index.url, entry.name, entry.text), entry.sha256);
  if (intact(dir) !== undefined) return realpathSync(dir);
  const url = index.dl.replaceAll("{name}", entry.name).replaceAll("{version}", entry.text);
  const archive = download(url);
  if (createHash("sha256").update(archive.slice()).digest("hex") !== entry.sha256) throw new Error(`its archive at ${url} doesn't match the sha256 the registry lists`);
  let files: TarFile[] = [];
  try {
    // Capped while it expands, so a small archive can't blow up into a huge one in memory.
    const tar = gunzipSync(archive, { maxOutputLength: MAX_UNPACKED + 1024 * 1024 });
    files = untar(tar, MAX_UNPACKED as usize);
  } catch (e) {
    if (e instanceof Error && e.name === "RangeError") throw new Error(`its archive expands past ${MAX_UNPACKED / 1024 / 1024} MiB`);
    throw new Error(e instanceof Error && e.message.startsWith("its archive") ? e.message : "its archive isn't a gzipped tar");
  }
  mkdirSync(join(dir, ".."), { recursive: true });
  const work = mkdtempSync(`${dir}.unpack-`);
  const changed = `${dir}.changed-${randomUUID()}`;
  try {
    while (files.length > 0) {
      const f = files.shift()!;
      mkdirSync(join(work, dirname(f.path)), { recursive: true });
      writeFileSync(join(work, f.path), f.data);
    }
    const sum = checksumOf(work);
    // A copy here whose files were changed by hand since its marker was written is moved aside;
    // any other build unpacking this archive now writes these same files. One with no marker yet
    // is another build's, moved in whole and about to be marked, and moving it would pull it out
    // from under that build's own check of it.
    if (existsSync(`${dir}.files`) && intact(dir) === undefined) {
      try {
        renameSync(dir, changed);
      } catch (_e) {
        // Moved aside by another build meanwhile.
      }
    }
    try {
      renameSync(work, dir);
    } catch (e) {
      if (!existsSync(dir)) throw e;
    }
    const next = `${dir}.files.${randomUUID()}.tmp`;
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
/** @throws {Error | IoError} */
function download(url: string): Uint8Array {
  if (url.startsWith("file://")) {
    let path = "";
    try {
      path = fileURLToPath(url);
    } catch (_e) {
      throw new Error(`its archive isn't at ${url}`);
    }
    if (!existsSync(path)) throw new Error(`its archive isn't at ${url}`);
    // A device, pipe or terminal could be read forever, so only a plain file is an archive.
    const fd = openSync(path, "r");
    try {
      const info = fstatSync(fd);
      if (!info.isFile()) throw new Error(`its archive at ${url} isn't a file`);
      if (info.size > MAX_DOWNLOAD) throw new Error(`its archive at ${url} is larger than ${MAX_DOWNLOAD / 1024 / 1024} MiB`);
      let bytes = new Uint8Array(info.size);
      readSync(fd, bytes, 0, info.size, 0);
      return bytes;
    } finally {
      closeSync(fd);
    }
  }
  if (!/^https?:\/\//.test(url)) throw new Error(`its archive's URL ${url} isn't http, https or file`);
  if (Bun.which("curl") === null) throw new Error("downloading needs the curl command, which isn't on PATH; install curl");
  // `-q` first keeps the user's ~/.curlrc out of it, and a time limit keeps a stalled server from
  // holding the build forever.
  const got = Bun.spawnSync(["curl", "-q", "--fail", "--silent", "--show-error", "--location", "--proto", "=https,http", "--proto-redir", "=https,http", "--max-filesize", String(MAX_DOWNLOAD), "--max-time", "600", "--", url], { stdout: "pipe", stderr: "pipe" });
  if (got.exitCode !== 0) {
    const said = new TextDecoder().decode(got.stderr).trim().replace(/^curl: \(\d+\) /, "");
    throw new Error(`can't download ${url}: ${said !== "" ? said : "curl failed"}`);
  }
  return got.stdout;
}

// A package is depended on by the name its own manifest gives it, however it was reached.
/** @throws {CompileError | IoError} */
function named(own: string, dir: string, name: string, by: string, blame: Ref<Blame>): void {
  const shown = relative(by, dir);
  if (own !== name) throw failure(blame, `the package at '${shown !== "" ? shown : "."}' is named '${own}' in its ${MANIFEST}, not '${name}'; depend on it by that name`);
}

// The packages a lockfile records, by name.
/** @throws {CompileError | IoError} */
function locked(file: string, src: string): Map<string, Table> {
  try {
    const toml = parseToml(src);
    const top = toml.get("");
    const version = top !== undefined && !Array.isArray(top) ? top.keys.get("version") : undefined;
    if (version === undefined || !isOne(version.value.value)) {
      throw new CompileError("E0906", `this ${LOCKFILE} isn't one this fishc writes, version 1; a newer fishc may have written it`, version !== undefined ? version.value.start : 0, version !== undefined ? version.value.end : 1);
    }
    const found = toml.get("package");
    let tables: Table[] = found === undefined ? [] : Array.isArray(found) ? found : [found];
    let byName = new Map<string, Table>();
    while (tables.length > 0) {
      const t = tables.shift()!;
      byName.set(stringAt(t, "name") ?? "undefined", t);
    }
    return byName;
  } catch (e) {
    if (e instanceof CompileError) throw inManifest(e, file, src);
    throw e;
  }
}

function isOne(v: Ref<TomlValue>): boolean {
  return typeof v === "number" && v === 1;
}

// A fetched package's files, by their paths inside it.
/** @throws {IoError} */
function filesUnder(dir: string, at: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(join(dir, at))) {
    const path = at !== "" ? `${at}/${name}` : name;
    // A link is hashed as where it points, so adding or changing one changes the sum.
    if (lstatSync(join(dir, path)).isDirectory()) out = out.concat(filesUnder(dir, path));
    else out.push(path);
  }
  return out;
}

// The sha256 of every file of a fetched package, by sorted relative path: it is a copy nothing
// should change, so any change to anything a build could read from it changes the sum.
/** @throws {IoError} */
export function checksumOf(dir: string): string {
  let hash = createHash("sha256");
  let paths = filesUnder(dir, "");
  paths.sort();
  for (const path of paths) {
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
  } catch (_e) {
    return undefined;
  }
}

// The first symbolic link under `dir`, as a path inside it.
/** @throws {IoError} */
function firstLink(dir: string, at: string = ""): string | undefined {
  for (const name of readdirSync(join(dir, at))) {
    const path = at !== "" ? `${at}/${name}` : name;
    const info = lstatSync(join(dir, path));
    if (info.isSymbolicLink()) return path;
    const inner = info.isDirectory() ? firstLink(dir, path) : undefined;
    if (inner !== undefined) return inner;
  }
  return undefined;
}

// The real directory a path dependency names, which must hold a Fish package.
/** @throws {CompileError | IoError} */
function located(from: string, dep: Ref<Extract<Dependency, { path: string }>>, blame: Ref<Blame>): string {
  const dir = resolve(from, dep.path);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw failure(blame, `can't find the directory '${dep.path}' for '${dep.name}'`);
  if (!existsSync(join(dir, MANIFEST))) throw failure(blame, `'${dep.path}' has no ${MANIFEST}, so it isn't a Fish package`);
  return realpathSync(dir);
}

// A git dependency's files at its commit, fetched once into the cache and read from there after,
// each repository and commit in a directory of its own. The commit it resolved to is kept beside
// that directory, outside what the repository put in it.
/** @throws {CompileError | IoError} */
function fetched(dep: Ref<Extract<Dependency, { git: string }>>, blame: Ref<Blame>): [string, { url: string; commit: string }] {
  const repo = join(cacheDir(), "git", `${dep.git.replace(/^[a-z+]+:\/\//, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(-60)}-${createHash("sha256").update(dep.git).digest("hex").slice(0, 12)}`);
  const dir = join(repo, dep.rev);
  const marker = `${dir}.commit`;
  if (!existsSync(marker) || !existsSync(dir)) {
    if (Bun.which("git") === null) throw failure(blame, `fetching '${dep.git}' needs the git command, which isn't on PATH; install git`);
    mkdirSync(repo, { recursive: true });
    const work = mkdtempSync(join(repo, ".fetch-"));
    const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
    try {
      const clone = run(work, "clone", "--quiet", "--no-checkout", "--", dep.git, ".");
      if (clone.exitCode !== 0) throw failure(blame, `can't fetch '${dep.git}': ${firstLine(text(clone.stderr))}`);
      // The commit whose hash starts with rev, never a branch or tag that happens to be named like it.
      const objects = text(run(work, "rev-parse", "--disambiguate=" + dep.rev).stdout).split("\n").filter((o) => o !== "");
      let commits: string[] = [];
      for (const o of objects) if (text(run(work, "cat-file", "-t", o).stdout).trim() === "commit") commits.push(o);
      if (commits.length === 0) throw failure(blame, `'${dep.git}' has no commit '${dep.rev}'`);
      if (commits.length > 1) throw failure(blame, `'${dep.rev}' starts the hashes of ${commits.length} commits of '${dep.git}'; give more of its digits`);
      const commit = commits[0]!;
      // `^{commit}` makes the full hash an object name, so a branch named like it can't stand in.
      if (run(work, "-c", "advice.detachedHead=false", "checkout", "--quiet", "--detach", `${commit}^{commit}`).exitCode !== 0) throw failure(blame, `can't check out '${dep.rev}' of '${dep.git}'`);
      if (text(run(work, "rev-parse", "HEAD").stdout).trim() !== commit) throw failure(blame, `checking out '${dep.rev}' of '${dep.git}' gave another commit`);
      rmSync(join(work, ".git"), { recursive: true, force: true });
      const link = firstLink(work);
      if (link !== undefined) throw failure(blame, `'${dep.git}' holds a symbolic link at '${link}'; a package from git can't, since a link reaches files its commit doesn't pin`);
      // The commit is recorded first and the files moved into place whole, so a build sees both
      // only once the fetch is done; another build that fetched the same commit first has
      // already put the same files there.
      const next = `${marker}.${randomUUID()}.tmp`;
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
  if (!/^[0-9a-f]{40}$/.test(commit)) throw failure(blame, `the cached copy of '${dep.git}' is damaged; delete ${dir} to fetch it again`);
  return [realpathSync(dir), { url: dep.git, commit }];
}

// The package holding `file`: the one whose directory holds it most closely, so a package nested
// in another's directory owns its own files.
/** @throws {IoError} */
export function packageOf(packages: Ref<Package[]>, file: string): Ref<Package> | undefined {
  const real = realpathSync(file);
  let best: usize | undefined = undefined;
  for (let i: usize = 0; i < packages.length; i++) {
    const dir = packages[i]!.dir;
    if (real.startsWith(dir + "/") && (best === undefined || dir.length > packages[best]!.dir.length)) best = i;
  }
  return best === undefined ? undefined : packages[best]!;
}

// The dependency package holding `file`, not the program's own, which may reach further.
/** @throws {IoError} */
export function dependencyOf(packages: Ref<Package[]>, file: string): Ref<Package> | undefined {
  const owner = packageOf(packages, file);
  return owner !== undefined && owner.dir === packages[0]!.dir ? undefined : owner;
}

// The library file a bare import names, when the package holding the importing file depends on
// a Fish package of that name; undefined sends it on to npm's packages.
/** @throws {CompileError | IoError} */
export function dependencyLib(packages: Ref<Package[]>, from: string, specifier: string, at: { start: usize; end: usize }): string | undefined {
  const owner = packageOf(packages, from);
  if (owner === undefined) return undefined;
  const scoped = specifier.startsWith("@");
  const name = specifier.split("/").slice(0, scoped ? 2 : 1).join("/");
  const depDir = owner.deps.get(name);
  if (depDir === undefined) return undefined;
  for (const dep of packages) {
    if (dep.dir !== depDir) continue;
    // A package's lib is its public face: its other files' exports are for its own files alone.
    if (name !== specifier) throw new CompileError("E0903", `'${specifier}' is a file inside the package '${name}', and a package's files are private to it; import from '${name}', which gives what its lib ${dep.manifest.lib} exports`, at.start, at.end);
    return join(dep.dir, dep.manifest.lib);
  }
  return undefined;
}
