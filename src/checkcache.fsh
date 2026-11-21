// Where a finished check lives on disk, and how a later process knows the one it finds was made
// from this program by this compiler. The state itself is written after the envelope; this file is
// only the key and the wrapper, so a check that cannot be read is a miss rather than a failure.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir, partial } from "./mathlib.fsh";

// The format the envelope and the state after it are written in. A file in another format is a
// miss, never an error: the cache only ever saves work, so an older one is simply not this one.
export const CHECK_FORMAT: usize = 1;

const MAGIC = "fshcheck";

// What a cached check says about itself before its state: the format, the key of the inputs it was
// made from, and how much it holds, so a reader knows the counts before it decodes anything.
export type Envelope = { format: usize; key: string; instances: usize; bodies: usize; classes: usize; entries: usize };

// The key of a check: the compiler that made it, the flags that change what a check produces, the
// entry it started from, and every file it read with the text it read it with. A missing file is
// part of the key too, since one appearing changes a program as much as one edited.
export function checkKey(compiler: string, entry: string, editing: boolean, library: boolean, contents: Ref<Map<string, string | undefined>>): string {
  let hash = createHash("sha256");
  hash.update(`${CHECK_FORMAT}\0${compiler}\0${entry}\0${editing ? "editing" : "building"}\0${library ? "library" : "program"}\0`);
  let paths = [...contents.keys()];
  paths.sort();
  for (const path of paths) {
    const text = contents.get(path);
    hash.update(path);
    hash.update("\0");
    hash.update(text !== undefined ? text! : "\0absent");
    hash.update("\0");
  }
  return hash.digest("hex");
}

// The compiler's own identity: the binary running this build, by its path, its size and when it
// was last written. A check another `fishc` made is not this one's, whatever the sources say.
// Hashing the binary read 33 MB and cost more than a small program's whole check, so the key takes
// what a stat gives instead: a compiler built again is written again, and keys differently. A
// compiler copied over another of the same size with its timestamp kept would be missed, which is
// what `--no-check-cache` is for.
export function compilerDigest(): string {
  const path = process.execPath;
  try {
    const { size, mtimeMs } = statSync(path);
    return `${path}:${size}:${mtimeMs}`;
  } catch (_e) {
    return "unknown";
  }
}

// Where the check for `key` lives. Named by the key's first 16 hex digits, as a cached object is.
export function checkPath(key: string): string {
  return join(cacheDir(), "checks", `${key.slice(0, 16)}.fshcheck`);
}

// The envelope as the line a cached file starts with; the state follows it.
export function writtenEnvelope(e: Ref<Envelope>): string {
  return `${MAGIC} ${e.format} ${e.key} ${e.instances} ${e.bodies} ${e.classes} ${e.entries}\n`;
}

// The envelope a cached file starts with, when the file is one this compiler can use for `key`:
// undefined for another format, another key, or too little text to hold a line at all.
export function readEnvelope(text: string, key: string): Envelope | undefined {
  const end = text.indexOf("\n");
  if (end < 0) return undefined;
  const parts = text.slice(0, end).split(" ");
  if (parts.length !== 7 || parts[0] !== MAGIC) return undefined;
  const format = (Number(parts[1]!) ?? 0) as usize;
  if (format !== CHECK_FORMAT || parts[2]! !== key) return undefined;
  return { format, key, instances: (Number(parts[3]!) ?? 0) as usize, bodies: (Number(parts[4]!) ?? 0) as usize, classes: (Number(parts[5]!) ?? 0) as usize, entries: (Number(parts[6]!) ?? 0) as usize };
}

// Writes `state` under its envelope at `path`, through a temporary name of its own, so a build
// reading the cache never sees a half-written file and two builds writing at once leave one whole
// file rather than a mixture. Gives whether it was written: a cache that cannot be is not a build
// failure, and the caller carries on with the check it already has.
export function writeCheck(path: string, e: Ref<Envelope>, state: string): boolean {
  let temp = "";
  try {
    temp = partial(path);
    writeFileSync(temp, `${writtenEnvelope(e)}${state}`);
    renameSync(temp, path);
    return true;
  } catch (_e) {
    if (temp !== "") {
      try {
        rmSync(temp, { force: true });
      } catch (_removing) {}
    }
    return false;
  }
}

// The check cached at `path` for `key`, when there is one this compiler can read. A file that is
// missing, unreadable, in another format or another program's is a miss.
export function readCheck(path: string, key: string): { envelope: Envelope; state: string } | undefined {
  let text = "";
  try {
    if (!existsSync(path)) return undefined;
    text = readFileSync(path, "utf8");
  } catch (_e) {
    return undefined;
  }
  const envelope = readEnvelope(text, key);
  if (envelope === undefined) return undefined;
  const end = text.indexOf("\n");
  return { envelope: envelope!, state: text.slice((end + 1) as i64) };
}
