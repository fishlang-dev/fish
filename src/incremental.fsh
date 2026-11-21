import { existsSync, readFileSync } from "node:fs";
import { loweredFile, type Checked, type CheckerParts } from "./check.fsh";
import { relinkedFile, reparsedFile, type Loaded } from "./modules.fsh";
import type { Stmt } from "./parser.fsh";
import { memberKey, type Replaced } from "./edits.fsh";
import type { CompileError } from "./diag.fsh";
import type { Emitted } from "./codegen.fsh";
import type { InstanceId } from "./arenas.fsh";
import { testOf } from "./tests.fsh";

// What `fishc watch` keeps from one build for the next: the checked program, what its checker held
// besides its tables, the files it was loaded from, and each file a build of it reads or looked
// for with its text then, undefined for one that was missing; and how many builds in a row have
// started from what an earlier one kept, 0 for one checked afresh.
// `emitted` is what the last build's codegen made, absent while only a check has run,
// `rechecked` the instances checked again since it, and `units` each unit's last text and the
// object built from it, by the unit's name.
export type Kept = { checked: Checked; parts: CheckerParts; loaded: Loaded; contents: Map<string, string | undefined>; carried: usize; emitted?: Emitted; rechecked?: Set<InstanceId>; units?: Map<string, string[]> };

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

// The map from the kept check's positions in a file to its text after an edit, from `was`, the
// map to its text before, undefined when the kept positions are that text's own, `length` long,
// and the edit's unchanged stretches `moves`. A kept position the edit changed maps to nothing.
export function composedMoves(was: Ref<[usize, usize, usize][] | undefined>, length: usize, moves: Ref<[usize, usize, usize][]>): [usize, usize, usize][] {
  let before: [usize, usize, usize][] = [];
  if (was === undefined) before.push([0, length, 0]);
  else for (const [a, b, x] of was!) before.push([a, b, x]);
  let out: [usize, usize, usize][] = [];
  for (const [a, b, x] of before) {
    const y = x + (b - a);
    for (const [c, d, z] of moves) {
      const lo = x > c ? x : c;
      const hi = y < d ? y : d;
      if (lo < hi || (lo === hi && a === b)) out.push([a + (lo - x), a + (hi - x), z + (lo - c)]);
    }
  }
  return out;
}

// The first kept position past every one a file's map, or its text `length` long, has used, where
// a body read again is put.
export function spillFrom(was: Ref<[usize, usize, usize][] | undefined>, length: usize): usize {
  let at = length + 1;
  if (was !== undefined) for (const [_a, b, _x] of was!) if (b + 1 > at) at = b + 1;
  return at;
}

// The statements of each body `wanted` names, out of a file read again: a function's by its name,
// a member's by its class's name and its key. Gives undefined when one isn't found or takes a
// parameter with a default, whose lowering writes statements at the parameter.
export function takenBodies(given: Stmt[], wanted: Ref<{ owner: string | undefined; name: string; whole: boolean }[]>): Replaced[] | undefined {
  let statements = given;
  let out: Replaced[] = [];
  while (statements.length > 0) {
    let s = statements.shift()!;
    let d = s.kind === "export" ? s.body : s;
    if (d.kind === "function") {
      const named = d.name;
      const w = wanted.find((w) => w.owner === undefined && w.name === named);
      if (w === undefined) continue;
      if (d.body === undefined || d.params.some((p) => p.default !== undefined)) return undefined;
      if (w!.whole) out.push({ owner: undefined, name: named, statements: [], func: d });
      else out.push({ owner: undefined, name: named, statements: d.body! });
      continue;
    }
    if (d.kind !== "class" || d.name === undefined) continue;
    const owner = d.name!;
    while (d.members.length > 0) {
      let m = d.members.shift()!;
      const key = memberKey(m);
      if (!wanted.some((w) => w.owner === owner && w.name === key)) continue;
      if (m.kind !== "method" && m.kind !== "get" && m.kind !== "set") return undefined;
      if (m.body === undefined || m.params.some((p) => p.default !== undefined)) return undefined;
      out.push({ owner, name: key, statements: m.body! });
    }
  }
  return out.length === wanted.length ? out : undefined;
}
