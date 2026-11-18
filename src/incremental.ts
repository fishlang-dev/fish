import { existsSync, readFileSync } from "node:fs";
import { loweredFile, type Checked, type CheckerParts } from "./check.ts";
import { relinkedFile, reparsedFile, type Loaded } from "./modules.ts";
import type { Stmt } from "./parser.ts";
import type { CompileError } from "./diag.ts";
import { testOf } from "./tests.ts";

// What `fishc watch` keeps from one build for the next: the checked program, what its checker held
// besides its tables, the files it was loaded from, and each file a build of it reads or looked
// for with its text then, undefined for one that was missing; and how many builds in a row have
// started from what an earlier one kept, 0 for one checked afresh.
export type Kept = { checked: Checked; parts: CheckerParts; loaded: Loaded; contents: Map<string, string | undefined>; carried: usize };

// The text each of the program's own files was loaded with, by path, then each other file in
// `looked` as it reads now, and `manifest` as it read before the build. Std's modules aren't
// files; a declaration file's path follows its `dts:` key.
/** @throws {IoError} */
export function loadedContents(loaded: Ref<Loaded>, looked: Ref<string[]>, manifest: string | undefined, manifestText: string | undefined): Map<string, string | undefined> {
  let contents = new Map<string, string | undefined>();
  for (const m of loaded.modules) {
    if (m.path.startsWith("std:")) continue;
    contents.set(m.path.startsWith("dts:") ? m.path.slice(4) : m.path, m.src);
  }
  for (const f of looked) if (!contents.has(f)) contents.set(f, textOf(f));
  if (manifest !== undefined) contents.set(manifest, manifestText);
  return contents;
}

// Whether every file in `contents` still reads as it did.
/** @throws {IoError} */
export function unchanged(contents: Ref<Map<string, string | undefined>>): boolean {
  for (const [f, text] of contents) if (textOf(f) !== text) return false;
  return true;
}

/** @throws {IoError} */
export function textOf(f: string): string | undefined {
  return existsSync(f) ? readFileSync(f, "utf8") : undefined;
}

// The file at `index` of the kept program read again from `text`: parsed, its tests left out,
// linked and lowered as a build does each, ready to check in place of what it held; or why it
// can't be. Either way the kept program holds the new file now.
/** @throws {CompileError} */
export function reloaded(kept: Mut<Kept>, index: usize, text: string): { statements: Stmt[]; fallback: string | undefined } {
  let parsed = reparsedFile(kept.checked.tables.ids, kept.loaded, index, text);
  if (parsed.fallback !== undefined) return parsed;
  let statements: Stmt[] = [];
  while (parsed.statements.length > 0) {
    const s = parsed.statements.shift()!;
    if (testOf(s) === undefined) statements.push(s);
  }
  let linked = relinkedFile(kept.checked.tables.ids, kept.loaded, index, text, statements, false);
  if (linked.fallback !== undefined) return linked;
  return loweredFile(kept.checked.tables, linked.statements, false);
}
