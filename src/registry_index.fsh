import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync } from "node:fs";
import { basename, join } from "node:path";
import { firstLine, git } from "./git.fsh";
import { validName, type Manifest } from "./manifest.fsh";
import { cacheDir } from "./mathlib.fsh";
import { compare, formatVersion, parseRange, parseVersion, satisfies, type Range, type Version } from "./semver.fsh";

// The registry's index when nothing names another.
export const DEFAULT_REGISTRY = "https://github.com/fishlang-dev/registry";

// One version of a package as the index lists it.
export type IndexEntry = { name: string; version: Version; text: string; dependencies: Map<string, string>; sha256: string; yanked: boolean; unsafe: boolean };

// A registry's index, cloned into the cache: where its archives are, and each package's versions.
export class Index {
  readonly url: string;
  readonly dl: string;
  readonly dir: string;

  constructor(url: string, dl: string, dir: string) {
    this.url = url;
    this.dl = dl;
    this.dir = dir;
  }

  /** @throws {Error | IoError} */
  versions(name: string): IndexEntry[] {
    return versions(this.url, this.dir, name);
  }
}

// The index a program uses: FISH_REGISTRY, else its own package's [registry], else Fish's.
export function registryUrl(root: Ref<Manifest>): string {
  const env = process.env.FISH_REGISTRY;
  if (env !== undefined && env !== "") return env;
  const own = root.registry;
  if (own !== undefined && own !== "") return own;
  return DEFAULT_REGISTRY;
}

// The index at `url`, cloned into the cache once and cloned again only when `refresh` asks. Each
// clone is a directory of its own and `current` links to the newest, swapped in one rename, so a
// build reads one whole clone however many others are fetching at the same moment.
/** @throws {Error | IoError} */
export function openIndex(url: string, refresh: boolean = false): Index {
  if (url.startsWith("-")) throw new Error(`the registry '${url}' can't start with '-'`);
  const base = join(cacheDir(), "index", `${url.replace(/^[a-z+]+:\/\//, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(-60)}-${createHash("sha256").update(url).digest("hex").slice(0, 12)}`);
  const current = join(base, "current");
  if (refresh || !existsSync(join(current, "config.json"))) clone(url, base);
  const dir = realpathSync(current);
  // A clone in use is kept fresh, so another build's cleanup of hour-old clones leaves it alone.
  utimesSync(dir, new Date(), new Date());
  let dl: unknown = undefined;
  try {
    dl = JSON.parse<{ dl?: string }>(readFileSync(join(dir, "config.json"), "utf8")).dl;
  } catch (_e) {
    throw new Error(`the registry '${url}' has no readable config.json`);
  }
  if (typeof dl !== "string" || !dl.includes("{name}") || !dl.includes("{version}")) throw new Error(`the registry '${url}' has a config.json without a "dl" naming {name} and {version}`);
  return new Index(url, dl, dir);
}

// A fresh clone beside the others, then `current` pointed at it; clones an hour old are removed.
/** @throws {Error | IoError} */
function clone(url: string, base: string) {
  if (Bun.which("git") === null) throw new Error(`reading the registry '${url}' needs the git command, which isn't on PATH; install git`);
  mkdirSync(base, { recursive: true });
  const work = mkdtempSync(join(base, "clone-"));
  const done = git(work, "clone", "--quiet", "--depth", "1", "--", url, ".");
  if (done.exitCode !== 0) {
    rmSync(work, { recursive: true, force: true });
    throw new Error(`can't read the registry '${url}': ${firstLine(new TextDecoder().decode(done.stderr))}`);
  }
  const link = join(base, `current.${randomUUID()}`);
  rmSync(link, { force: true });
  symlinkSync(basename(work), link);
  renameSync(link, join(base, "current"));
  const keep = realpathSync(join(base, "current"));
  for (const e of readdirSync(base)) {
    const old = join(base, e);
    try {
      if (e.startsWith("clone-") && old !== work && realpathSync(old) !== keep && (Date.now() as f64) - statSync(old).mtimeMs > 3_600_000) rmSync(old, { recursive: true, force: true });
    } catch (_e) {
      // Removed by another build meanwhile.
    }
  }
}

// An index file's line as JSON says it; what it holds is checked by `versions`, since TypeScript
// takes JSON.parse's word for the types and Fish doesn't.
type IndexLine = { name?: string; version?: string; sha256?: string; dependencies?: { [name: string]: string }; yanked?: boolean; unsafe?: boolean };

const isString = (v: Ref<unknown>): boolean => typeof v === "string";
// JSON's null is a value here, not a field left out, under TypeScript.
const present = (v: Ref<unknown>): boolean => v !== undefined && v !== null;
const isObject = (v: Ref<unknown>): boolean => typeof v === "object" && v !== null && !Array.isArray(v);

/** @throws {Error} */
function indexLine(line: string, at: string): IndexLine {
  try {
    JSON.parse(line);
  } catch (_e) {
    throw new Error(`${at}: it isn't JSON`);
  }
  if (!line.trimStart().startsWith("{")) throw new Error(`${at}: it names 'undefined'`);
  try {
    return JSON.parse<IndexLine>(line);
  } catch (_e) {
    throw new Error(`${at}: its fields aren't the types an index line's are`);
  }
}

// A package's versions from its index file, two letters deep as crates.io keeps it, each line one
// version; a line that isn't one is refused naming where it is.
/** @throws {Error | IoError} */
export function versions(url: string, dir: string, name: string): IndexEntry[] {
  if (!validName(name)) throw new Error(`'${name}' isn't a package name`);
  const file = join(dir, name.slice(0, 2), name);
  if (!existsSync(file)) throw new Error(`the registry has no package '${name}'`);
  let seen = new Set<string>();
  let entries: IndexEntry[] = [];
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i: usize = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    const at = `the registry's entry for '${name}' is malformed at line ${i + 1}`;
    const raw = indexLine(line, at);
    const named = raw.name;
    if (named !== name) throw new Error(`${at}: it names '${named === undefined ? "undefined" : named}'`);
    const written = raw.version;
    const text = written !== undefined && isString(written) ? written : "";
    const version = text !== "" ? parseVersion(text) : undefined;
    // Written exactly as it's printed, since it goes into URLs, cache paths and the lock.
    if (version === undefined || formatVersion(version) !== text) throw new Error(`${at}: its version isn't a semantic version written plainly, as in "1.2.0"`);
    if (seen.has(text)) throw new Error(`${at}: version ${text} is listed twice`);
    seen.add(text);
    const sum = raw.sha256;
    if (sum === undefined || !isString(sum) || !/^[0-9a-f]{64}$/.test(sum)) throw new Error(`${at}: its sha256 isn't 64 hex digits`);
    const deps = raw.dependencies;
    const listed = present(deps);
    if (listed && !isObject(deps)) throw new Error(`${at}: its dependencies aren't an object`);
    let dependencies = new Map<string, string>();
    if (deps !== undefined && listed) {
      for (const [dep, range] of Object.entries(deps)) {
        if (!validName(dep) || !isString(range) || parseRange(range) === undefined) throw new Error(`${at}: its dependency '${dep}' isn't a name with a version range`);
        dependencies.set(dep, range);
      }
    }
    const unsafe = raw.unsafe;
    if (unsafe !== undefined && typeof (unsafe as unknown) !== "boolean") throw new Error(`${at}: its unsafe isn't true or false`);
    entries.push({ name, version, text, dependencies, sha256: sum, yanked: raw.yanked === true, unsafe: unsafe === true });
  }
  return entries;
}

// A range on a package, and who asked for it, for saying so when no version fits.
export type Request = { range: string; by: string };

// One version for each registry package a program needs: for every name, the highest version
// every range on it allows, the ranges coming from the program's own packages and from each
// chosen version's dependencies, repeated until no choice changes. A version the lock holds is
// kept while it still fits, yanked or not; otherwise yanked versions are passed over. A name no
// version fits in one round may fit once a version asking for it is dropped, so only the settled
// choice is refused.
// It doesn't backtrack: ranges only a lower version of another package could satisfy are refused.
// A resolution failure, and the package it is about, for pointing at who asked for it.
export class Unresolved extends Error {
  pkg: string;
  constructor(message: string, pkg: string) {
    super(message);
    this.pkg = pkg;
  }
}

// Whether a version is in every one of a name's ranges.
function fitsAll(e: Ref<IndexEntry>, ranges: Ref<Range[]>): boolean {
  for (const r of ranges) if (!satisfies(e.version, r)) return false;
  return true;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : e instanceof IoError ? e.message : "it failed";
}

/** @throws {Error | IoError | Unresolved} */
export function resolveVersions(index: Ref<Index>, roots: Ref<Map<string, Request[]>>, locked: Map<string, string> = new Map<string, string>()): Map<string, IndexEntry> {
  let chosen = new Map<string, IndexEntry>();
  let read = new Map<string, IndexEntry[]>();
  // Only a round that changes a choice already made counts toward the limit, so a long chain of
  // new packages always settles.
  for (let changes = 0; changes < 100; ) {
    let requests = new Map<string, Request[]>();
    for (const [name, rs] of roots) requests.set(name, [...rs]);
    for (const entry of chosen.values()) {
      for (const [dep, range] of entry.dependencies) {
        const had = requests.get(dep);
        let asked: Request[] = had !== undefined ? had : [];
        asked.push({ range, by: `${entry.name} ${entry.text}` });
        requests.set(dep, asked);
      }
    }
    let next = new Map<string, IndexEntry>();
    let unfit = new Map<string, Request[]>();
    for (const [name, rs] of requests) {
      let ranges: Range[] = [];
      for (const r of rs) ranges.push(parseRange(r.range)!);
      if (!read.has(name)) {
        try {
          read.set(name, index.versions(name));
        } catch (e) {
          throw new Unresolved(messageOf(e), name);
        }
      }
      const all = read.get(name)!;
      const want = locked.get(name);
      let best = all.find((e) => e.text === want && fitsAll(e, ranges));
      if (best === undefined) {
        let fitting = all.filter((e) => !e.yanked && fitsAll(e, ranges));
        fitting.sort((a, b) => compare(a.version, b.version));
        best = fitting.at(-1);
      }
      if (best !== undefined) next.set(name, best);
      else unfit.set(name, [...rs]);
    }
    let settled = next.size === chosen.size;
    for (const [name, e] of next) {
      const was = chosen.get(name);
      if (was === undefined || was.text !== e.text) settled = false;
    }
    if (settled) {
      for (const [name, rs] of unfit) throw new Unresolved(`no version of '${name}' fits every range on it: ${rs.map((r) => `'${r.range}' from ${r.by}`).join(", ")}`, name);
      return next;
    }
    let moved = false;
    for (const [name, e] of chosen) {
      const now = next.get(name);
      if (now === undefined || now.text !== e.text) moved = true;
    }
    if (moved) changes++;
    chosen = next;
  }
  throw new Error("the registry's versions keep changing which others fit; pin one of them to a narrower range");
}
