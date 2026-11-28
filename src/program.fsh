import type { Compilation } from "./compilation.fsh";
import type { Span } from "./parser.fsh";

// What the checker shares with the loader and the build without importing either: where each of
// a program's files sits in the program's offsets, and the session's lockfile option.

// Each file after the entry starts at its own multiple of this, room for a 16 MiB file.
export const FILE_SPAN = 2 ** 24;

// The file a source offset is in, among a compilation's `files`, as written relative to the
// entry's directory.
export function fileAt(files: Ref<Compilation["files"]>, offset: usize): string {
  return files.findLast((f) => offset >= f.base)?.file ?? "";
}

// The name std's module holding a source offset is shown by, as "std:fs", or nothing when the
// offset is in a file of the program's own, whatever that file is named. std's prelude sits past
// every file, so an offset beyond the last file's span is in none of them.
export function stdModuleAt(files: Ref<Compilation["files"]>, offset: usize): string | undefined {
  const f = files.findLast((f) => offset >= f.base);
  return f !== undefined && f.std && offset - f.base < (FILE_SPAN as usize) ? f.file : undefined;
}

// The source text a span covers in the program last loaded; std's prelude is in none of its files.
export function textAt(files: Ref<Compilation["files"]>, at: Ref<Span>): string {
  const f = files.findLast((f) => at.start >= f.base);
  return f !== undefined && at.end - f.base <= f.src.length ? f.src.slice((at.start - f.base) as i64, (at.end - f.base) as i64) : "";
}

// Whether a build may change `fish.lock`, as `fishc build --locked` says it may not, for CI;
// and which registry packages `fishc update` moves past their locked versions, "all" for every one.
export type Locking = { locked: boolean; update?: Set<string> | "all" };
