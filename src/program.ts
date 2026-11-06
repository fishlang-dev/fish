import type { Compilation } from "./compilation.ts";
import type { Span } from "./parser.ts";

// What the checker shares with the loader and the build without importing either: where each of
// a program's files sits in the program's offsets, and the session's lockfile option.

// Each file after the entry starts at its own multiple of this, room for a 16 MiB file.
export const FILE_SPAN = 2 ** 24;

// The file a source offset is in, among a compilation's `files`, as written relative to the
// entry's directory.
export function fileAt(files: Compilation["files"], offset: usize): string {
  return files.findLast((f) => offset >= f.base)?.file ?? "";
}

// The name std's module holding a source offset is shown by, as "node:fs", or nothing when the
// offset is in a file of the program's own, whatever that file is named.
export function stdModuleAt(files: Compilation["files"], offset: usize): string | undefined {
  const f = files.findLast((f) => offset >= f.base);
  return f !== undefined && f.std ? f.file : undefined;
}

// The source text a span covers in the program last loaded; std's prelude is in none of its files.
export function textAt(files: Compilation["files"], at: Span): string {
  const f = files.findLast((f) => at.start >= f.base);
  return f !== undefined && at.end - f.base <= f.src.length ? f.src.slice((at.start - f.base) as i64, (at.end - f.base) as i64) : "";
}

// Whether a build may change `fish.lock`, as `fishc build --locked` says it may not, for CI;
// and which registry packages `fishc update` moves past their locked versions, "all" for every one.
export type Locking = { locked: boolean; update?: Set<string> | "all" };
