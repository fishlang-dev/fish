import { existsSync, readFileSync } from "node:fs";
import type { Checked, CheckerParts } from "./check.ts";
import type { Loaded } from "./modules.ts";

// What `fishc watch` keeps from one build for the next: the checked program, what its checker held
// besides its tables, the files it was loaded from, and each file a build of it reads or looked
// for with its text then, undefined for one that was missing.
export type Kept = { checked: Checked; parts: CheckerParts; loaded: Loaded; contents: Map<string, string | undefined> };

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
