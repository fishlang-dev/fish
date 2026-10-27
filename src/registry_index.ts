import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync } from "node:fs";
import { basename, join } from "node:path";
import { firstLine, git } from "./git.ts";
import { validName, type Manifest } from "./manifest.ts";
import { cacheDir } from "./mathlib.ts";
import { compare, formatVersion, parseRange, parseVersion, satisfies, type Version } from "./semver.ts";

// The registry's index when nothing names another.
export const DEFAULT_REGISTRY = "https://github.com/fishlang-dev/registry";

// One version of a package as the index lists it.
export type IndexEntry = { name: string; version: Version; text: string; dependencies: Map<string, string>; sha256: string; yanked: boolean; unsafe: boolean };

// A registry's index, cloned into the cache: where its archives are, and each package's versions.
export type Index = { url: string; dl: string; versions(name: string): IndexEntry[] };

// The index a program uses: FISH_REGISTRY, else its own package's [registry], else Fish's.
export function registryUrl(root: Manifest): string {
  return process.env.FISH_REGISTRY || root.registry || DEFAULT_REGISTRY;
}

// The index at `url`, cloned into the cache once and cloned again only when `refresh` asks. Each
// clone is a directory of its own and `current` links to the newest, swapped in one rename, so a
// build reads one whole clone however many others are fetching at the same moment.
export function openIndex(url: string, refresh = false): Index {
  if (url.startsWith("-")) throw new Error(`the registry '${url}' can't start with '-'`);
  const base = join(cacheDir(), "index", `${url.replace(/^[a-z+]+:\/\//, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(-60)}-${createHash("sha256").update(url).digest("hex").slice(0, 12)}`);
  const current = join(base, "current");
  if (refresh || !existsSync(join(current, "config.json"))) clone(url, base);
  const dir = realpathSync(current);
  // A clone in use is kept fresh, so another build's cleanup of hour-old clones leaves it alone.
  const now = new Date();
  utimesSync(dir, now, now);
  let config: unknown;
  try {
    config = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
  } catch {
    throw new Error(`the registry '${url}' has no readable config.json`);
  }
  const dl = (config as { dl?: unknown })?.dl;
  if (typeof dl !== "string" || !dl.includes("{name}") || !dl.includes("{version}")) throw new Error(`the registry '${url}' has a config.json without a "dl" naming {name} and {version}`);
  return { url, dl, versions: (name) => versions(url, dir, name) };
}

// A fresh clone beside the others, then `current` pointed at it; clones an hour old are removed.
function clone(url: string, base: string) {
  if (!Bun.which("git")) throw new Error(`reading the registry '${url}' needs the git command, which isn't on PATH; install git`);
  mkdirSync(base, { recursive: true });
  const work = mkdtempSync(join(base, "clone-"));
  const done = git(work, "clone", "--quiet", "--depth", "1", "--", url, ".");
  if (done.exitCode !== 0) {
    rmSync(work, { recursive: true, force: true });
    throw new Error(`can't read the registry '${url}': ${firstLine(done.stderr.toString())}`);
  }
  const link = join(base, `current.${process.pid}`);
  rmSync(link, { force: true });
  symlinkSync(basename(work), link);
  renameSync(link, join(base, "current"));
  const keep = realpathSync(join(base, "current"));
  for (const e of readdirSync(base)) {
    const old = join(base, e);
    try {
      if (e.startsWith("clone-") && old !== work && realpathSync(old) !== keep && Date.now() - statSync(old).mtimeMs > 3_600_000) rmSync(old, { recursive: true, force: true });
    } catch {}
  }
}

// A package's versions from its index file, two letters deep as crates.io keeps it, each line one
// version; a line that isn't one is refused naming where it is.
export function versions(url: string, dir: string, name: string): IndexEntry[] {
  if (!validName(name)) throw new Error(`'${name}' isn't a package name`);
  const file = join(dir, name.slice(0, 2), name);
  if (!existsSync(file)) throw new Error(`the registry has no package '${name}'`);
  const seen = new Set<string>();
  return readFileSync(file, "utf8").split("\n").flatMap((line, i): IndexEntry[] => {
    if (line.trim() === "") return [];
    const bad = (why: string) => new Error(`the registry's entry for '${name}' is malformed at line ${i + 1}: ${why}`);
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line);
    } catch {
      throw bad("it isn't JSON");
    }
    if (raw.name !== name) throw bad(`it names '${String(raw.name)}'`);
    const version = typeof raw.version === "string" ? parseVersion(raw.version) : undefined;
    // Written exactly as it's printed, since it goes into URLs, cache paths and the lock.
    if (!version || formatVersion(version) !== raw.version) throw bad("its version isn't a semantic version written plainly, as in \"1.2.0\"");
    if (seen.has(raw.version as string)) throw bad(`version ${raw.version} is listed twice`);
    seen.add(raw.version as string);
    if (typeof raw.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(raw.sha256)) throw bad("its sha256 isn't 64 hex digits");
    const deps = raw.dependencies ?? {};
    if (typeof deps !== "object" || deps === null || Array.isArray(deps)) throw bad("its dependencies aren't an object");
    const dependencies = new Map<string, string>();
    for (const [dep, range] of Object.entries(deps)) {
      if (!validName(dep) || typeof range !== "string" || !parseRange(range)) throw bad(`its dependency '${dep}' isn't a name with a version range`);
      dependencies.set(dep, range);
    }
    if (raw.unsafe !== undefined && typeof raw.unsafe !== "boolean") throw bad("its unsafe isn't true or false");
    return [{ name, version, text: raw.version as string, dependencies, sha256: raw.sha256, yanked: raw.yanked === true, unsafe: raw.unsafe === true }];
  });
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

export function resolveVersions(index: Index, roots: Map<string, Request[]>, locked = new Map<string, string>()): Map<string, IndexEntry> {
  let chosen = new Map<string, IndexEntry>();
  const read = new Map<string, IndexEntry[]>();
  const versionsOf = (name: string) => {
    if (!read.has(name)) {
      try {
        read.set(name, index.versions(name));
      } catch (e) {
        throw new Unresolved(e instanceof Error ? e.message : String(e), name);
      }
    }
    return read.get(name)!;
  };
  // Only a round that changes a choice already made counts toward the limit, so a long chain of
  // new packages always settles.
  for (let changes = 0; changes < 100; ) {
    const requests = new Map([...roots].map(([name, rs]) => [name, [...rs]]));
    for (const entry of chosen.values()) {
      for (const [dep, range] of entry.dependencies) requests.set(dep, [...(requests.get(dep) ?? []), { range, by: `${entry.name} ${entry.text}` }]);
    }
    const next = new Map<string, IndexEntry>();
    const unfit = new Map<string, Request[]>();
    for (const [name, rs] of requests) {
      const ranges = rs.map((r) => parseRange(r.range)!);
      const fits = (e: IndexEntry) => ranges.every((r) => satisfies(e.version, r));
      const all = versionsOf(name);
      const kept = all.find((e) => e.text === locked.get(name) && fits(e));
      const best = kept ?? all.filter((e) => !e.yanked && fits(e)).sort((a, b) => compare(a.version, b.version)).at(-1);
      if (best) next.set(name, best);
      else unfit.set(name, rs);
    }
    const settled = next.size === chosen.size && [...next].every(([name, e]) => chosen.get(name)?.text === e.text);
    if (settled) {
      const [name, rs] = [...unfit][0] ?? [];
      if (name) throw new Unresolved(`no version of '${name}' fits every range on it: ${rs!.map((r) => `'${r.range}' from ${r.by}`).join(", ")}`, name);
      return next;
    }
    if ([...chosen].some(([name, e]) => next.get(name)?.text !== e.text)) changes++;
    chosen = next;
  }
  throw new Error("the registry's versions keep changing which others fit; pin one of them to a narrower range");
}
