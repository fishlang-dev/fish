// `fishc fmt`: Fish files formatted in place, checked for CI, or piped through.

import { randomBytes } from "node:crypto";
import { accessSync, closeSync, constants, fchmodSync, fstatSync, ftruncateSync, linkSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { CompileError, formatError } from "./diag.ts";
import { MANIFEST } from "./manifest.ts";
import { format } from "./printer.ts";

const SKIPPED = new Set(["target", "node_modules"]);

type Problem = (message: string) => void;

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));
const shown = (path: string) => relative(process.cwd(), path) || path;

// Every `.fsh` file under `dir`, in name order. Build output, dependencies, hidden directories and
// packages nested below are left out; links to directories aren't followed, so a search stays
// inside the tree and can't loop. A directory that can't be read is reported and skipped.
export function fishFiles(dir: string, problem: Problem, top = true): string[] {
  let entries;
  try {
    if (!top && lstatSync(join(dir, MANIFEST), { throwIfNoEntry: false })) return [];
    entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch (e) {
    problem(`fishc fmt: can't read '${shown(dir)}': ${reason(e)}`);
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !SKIPPED.has(entry.name) && !entry.name.startsWith(".")) found.push(...fishFiles(path, problem, false));
    else if (entry.isFile() && entry.name.endsWith(".fsh")) found.push(path);
  }
  return found;
}

// Formats the files `paths` name, a directory standing for its `.fsh` files, rewriting those that
// change; with `check`, writes nothing and lists them instead. Gives the exit code: 1 when a file
// isn't formatted under `check` or couldn't be formatted, else 0.
export function formatPaths(paths: string[], check: boolean): i64 {
  let code = 0;
  const problem = (message: string) => {
    console.error(message);
    code = 1;
  };
  const files: string[] = [];
  for (const path of paths) {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat) problem(`fishc fmt: can't find '${path}'`);
    else if (statSync(path, { throwIfNoEntry: false })?.isDirectory()) files.push(...fishFiles(path, problem));
    else files.push(path);
  }
  const seen = new Set<string>();
  for (const file of files) {
    let real: string;
    let bytes: Buffer;
    try {
      real = realpathSync(file);
      bytes = readFileSync(real);
    } catch (e) {
      problem(`fishc fmt: can't read '${shown(file)}': ${reason(e)}`);
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);
    const text = decoded(bytes, shown(file), problem);
    const out = text === undefined ? undefined : formatted(text, shown(file), problem);
    if (out === undefined || out === text) continue;
    if (check) {
      console.log(shown(file));
      code = 1;
      continue;
    }
    const error = rewrite(real, out, bytes);
    if (error) problem(`fishc fmt: can't write '${shown(file)}': ${error}`);
  }
  return code;
}

// Formats standard input to standard output; with `check`, writes nothing and gives 1 when the
// input isn't formatted.
export function formatStdin(check: boolean): i64 {
  let code = 0;
  const problem = (message: string) => {
    console.error(message);
    code = 1;
  };
  const text = decoded(readFileSync(0), "<stdin>", problem);
  const out = text === undefined ? undefined : formatted(text, "<stdin>", problem);
  if (out === undefined) return code;
  if (check) return out === text ? 0 : 1;
  try {
    writeAll(1, Buffer.from(out));
  } catch (e) {
    // The reader went away, as `| head` does; nothing more can be said to it.
    if ((e as { code?: string }).code === "EPIPE") return 1;
    throw e;
  }
  return 0;
}

// The text of `bytes`, refused rather than read with replacement characters, which would then be
// written back over the bytes they stand for.
function decoded(bytes: Uint8Array, name: string, problem: Problem): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    problem(`fishc fmt: '${name}' isn't valid UTF-8, so it's left as it was`);
    return undefined;
  }
}

function formatted(text: string, name: string, problem: Problem): string | undefined {
  try {
    return format(text);
  } catch (e) {
    if (e instanceof CompileError) problem(formatError(e, name, text));
    else problem(`fishc fmt: '${name}' was left as it was, because of a bug in the formatter (${reason(e).split(":")[0]}); please report it`);
    return undefined;
  }
}

// Writes all of `bytes` to `fd` before returning, as the process may exit straight after and a
// pipe takes only part of a large write at once.
function writeAll(fd: i32, bytes: Buffer) {
  for (let at = 0; at < bytes.length; ) {
    try {
      at += writeSync(fd, bytes, at, bytes.length - at);
    } catch (e) {
      if ((e as { code?: string }).code !== "EAGAIN") throw e;
      Bun.sleepSync(1);
    }
  }
}

// Replaces `file` with `text`, keeping its permissions; a file the user can't write is left alone,
// as a plain write would refuse it. The new text goes to a temporary file created fresh under a
// random name, so it can't be a link planted to redirect the write, then renamed over the file, so
// a crash never leaves it half written. A file with several hard links is written in place
// instead, as a rename would cut it off from the others. Gives what went wrong, if anything.
// Given `to`, the new text goes there instead and `file` is removed: the temporary file is linked
// to `to`, which fails rather than replace a file already there, so `to` appears whole or not at
// all, and only then is `file` removed.
export function rewrite(file: string, text: string, original: Buffer, to?: string): string | undefined {
  let temporary: string | undefined;
  try {
    accessSync(file, constants.W_OK);
    const stat = statSync(file);
    if (stat.nlink > 1 && to === undefined) return inPlace(file, Buffer.from(text), original, stat);
    // The name is cut short so a long one still leaves room for the suffix.
    const path = join(dirname(file), `.${basename(file).slice(0, 100)}.fmt-${randomBytes(6).toString("hex")}`);
    const fd = openSync(path, "wx", 0o600);
    temporary = path;
    try {
      writeAll(fd, Buffer.from(text));
      fchmodSync(fd, stat.mode & 0o7777);
    } finally {
      closeSync(fd);
    }
    if (to === undefined) {
      renameSync(path, file);
      temporary = undefined;
      return undefined;
    }
    linkSync(path, to);
    rmSync(path);
    temporary = undefined;
    try {
      unlinkSync(file);
    } catch (e) {
      return `'${shown(to)}' was written, but '${shown(file)}' couldn't be removed: ${reason(e)}`;
    }
    return undefined;
  } catch (e) {
    if (temporary) rmSync(temporary, { force: true });
    return reason(e);
  }
}

// Writes `bytes` over `file` in place, never through a link swapped in since it was looked at;
// if the write fails partway, as when the disk is full, the original bytes are put back.
function inPlace(file: string, bytes: Buffer, original: Buffer, seen: { dev: u64; ino: u64 }): string | undefined {
  const changed = "it changed while it was being formatted";
  let fd: i32;
  try {
    fd = openSync(file, constants.O_WRONLY | constants.O_NOFOLLOW);
  } catch (e) {
    // A link put where the file was is refused rather than written through.
    if ((e as { code?: string }).code === "ELOOP") return changed;
    throw e;
  }
  try {
    const now = fstatSync(fd);
    if (now.dev !== seen.dev || now.ino !== seen.ino) return changed;
    try {
      ftruncateSync(fd, 0);
      writeAll(fd, bytes);
      return undefined;
    } catch (e) {
      try {
        ftruncateSync(fd, 0);
        for (let at = 0; at < original.length; ) at += writeSync(fd, original, at, original.length - at, at);
        return `${reason(e)}; the original was written back`;
      } catch {
        return `${reason(e)}; the original couldn't be written back`;
      }
    }
  } finally {
    closeSync(fd);
  }
}
