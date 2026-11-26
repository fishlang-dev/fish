// Where `fishc <file.fsh>` keeps a script's binary between runs, and how a run knows the binary it
// finds was built from the script as it is now, by this fishc.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { compilerDigest } from "./checkcache.fsh";
import { LOCKFILE } from "./dependencies.fsh";
import { findManifest } from "./manifest.fsh";
import { cacheDir, partial } from "./mathlib.fsh";

function sha256(text: string): string {
  let hash = createHash("sha256");
  hash.update(text);
  return hash.digest("hex");
}

// The directory a script's binary and record live in, named by the script's real path.
/** @throws {IoError} */
export function scriptDir(script: string): string {
  return join(cacheDir(), "scripts", sha256(realpathSync(script)).slice(0, 16));
}

// What the binary was built from, one line each: this fishc, then every file the build looked at
// with the hash of its text, or `absent`, since a file appearing changes a program as much as one
// edited. The package's manifest and lockfile are in it too, so a changed dependency rebuilds.
export function scriptRecord(script: string, looked: Ref<string[]>): string {
  let paths = [...looked];
  const manifest = findManifest(dirname(script));
  if (manifest !== undefined) {
    paths.push(manifest!);
    paths.push(join(dirname(manifest!), LOCKFILE));
  }
  paths.sort();
  let lines = [compilerDigest()];
  let last = "";
  for (const path of paths) {
    if (path === last) continue;
    last = path;
    let state = "absent";
    try {
      if (existsSync(path)) state = sha256(readFileSync(path, "utf8"));
    } catch (_e) {
      state = "unreadable";
    }
    lines.push(`${path}\t${state}`);
  }
  return `${lines.join("\n")}\n`;
}

// The cached binary for `script` when its record still holds: the same fishc, and every file it
// lists unchanged. Undefined is a miss, never an error: the cache only ever saves a build.
export function cachedScript(script: string): string | undefined {
  try {
    const dir = scriptDir(script);
    const binary = join(dir, "program");
    const record = join(dir, "record");
    if (!existsSync(binary) || !existsSync(record)) return undefined;
    const text = readFileSync(record, "utf8");
    let looked: string[] = [];
    const lines = text.split("\n");
    for (let i = 1; i < lines.length; i++) {
      const tab = lines[i]!.indexOf("\t");
      if (tab > 0) looked.push(lines[i]!.slice(0, tab));
    }
    return scriptRecord(script, looked) === text ? binary : undefined;
  } catch (_e) {
    return undefined;
  }
}

// Puts a binary built at `built` in place for `script` with its record, each through a rename, so a
// run reading the cache never sees half of either. Gives where the binary now is.
/** @throws {IoError} */
export function keepScript(script: string, built: string, looked: Ref<string[]>): string {
  const dir = scriptDir(script);
  const binary = join(dir, "program");
  const record = join(dir, "record");
  // The record goes first and the binary last, so a run between the two sees an old binary under a
  // new record, or a new binary under a new record: never a new record vouching for an old binary
  // that a later check would accept, since the old binary's own record is then gone.
  const temp = partial(record);
  writeFileSync(temp, "");
  renameSync(temp, record);
  renameSync(built, binary);
  const filled = partial(record);
  writeFileSync(filled, scriptRecord(script, looked));
  renameSync(filled, record);
  return binary;
}

// Where a script's build writes before it is kept: beside the cache, so the rename stays on one disk.
/** @throws {IoError} */
export function scriptBuildPath(script: string): string {
  return partial(join(scriptDir(script), "program"));
}
