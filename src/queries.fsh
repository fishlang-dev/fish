// Every check of a program passes through here: the clean path, and the kept one a rebuild takes.
// A `Queries` holds what one program is checked with and the check the last run of it kept, so a
// rebuild whose files all read as they did is not checked again, and one after an edit checks only
// the bodies that changed. `fishc build`, `fishc check` and `fishc watch` all drive it; the
// language server holds one per program, and the cache on disk reads and writes one here.
import { readFileSync } from "node:fs";
import type { InstanceId } from "./arenas.fsh";
import { expanded, sourced } from "./analysis.fsh";
import { checkKeeping, recheckKept, type Checked, type CheckerParts } from "./check.fsh";
import { newCompilation, partEnd, partStart, stageEnd, stageStart, type Compilation, type Session } from "./compilation.fsh";
import { CompileError, copyNames, type Source } from "./diag.fsh";
import { classified, type Changed, type Edit, type Replaced } from "./edits.fsh";
import { composedMoves, loadedContents, reloaded, spillFrom, takenBodies, textOf as fileText, unchanged, type Kept } from "./incremental.fsh";
import { load, type Loaded } from "./modules.fsh";
import { movedStmt } from "./nodes.fsh";
import type { Stmt } from "./parser.fsh";
import { FILE_SPAN } from "./program.fsh";

// What one program is checked with: everything a check of it needs that is not the check itself.
// A kept check is passed in and handed back rather than held here, since it is an owned value
// whose every move is a copy of the checker's tables; whoever generates from one keeps it.
export class Queries {
  entry: string;
  manifest: string | undefined;

  // `entry` is the program's entry file and `manifest` its package's, which a build may read.
  constructor(entry: string, manifest: string | undefined) {
    this.entry = entry;
    this.manifest = manifest;
  }

  // The program checked: `kept`, when every file it read still reads as it did; that check with
  // the edited bodies checked again, where they can be; or the program checked afresh.
  /** @throws {CompileError | Error | IoError} */
  checked(this: Ref<this>, session: Session, looked: Mut<string[]>, kept: Kept | undefined): Kept {
    return checkedFrom(session, this.entry, looked, kept, this.manifest);
  }
}

// The program checked: `kept`'s, given `session`, when every file it read reads as it did, or else
// loaded and checked afresh.
/** @throws {CompileError | Error | IoError} */
function checkedFrom(session: Session, file: string, looked: Mut<string[]>, kept: Kept | undefined, manifest: string | undefined): Kept {
  if (kept !== undefined) {
    let reused = kept!;
    reused.checked.tables.session = session;
    const comparing = partStart(reused.checked.tables.session);
    const same = unchanged(reused.contents);
    partEnd(reused.checked.tables.session, "reload compare", comparing);
    if (same) {
      for (const f of reused.contents.keys()) looked.push(f);
      reused.carried++;
      reused.rechecked = new Set<InstanceId>();
      return reused;
    }
    let { done, session: back } = rechecked(reused);
    if (done !== undefined) {
      let carried = done!;
      for (const f of carried.contents.keys()) looked.push(f);
      carried.carried++;
      return carried;
    }
    return checkedAfresh(back!, file, looked, manifest);
  }
  return checkedAfresh(session, file, looked, manifest);
}

// The program loaded and checked afresh, with what to keep of it.
/** @throws {CompileError | Error | IoError} */
function checkedAfresh(session: Session, file: string, looked: Mut<string[]>, manifest: string | undefined): Kept {
  const manifestText = manifest !== undefined ? fileText(manifest) : undefined;
  let made = checkedSourceKeeping(newCompilation(session), file, readFileSync(file, "utf8"), false, looked);
  const contents = loadedContents(made.loaded, looked, manifest, manifestText);
  return { checked: made.checked, parts: made.parts, loaded: made.loaded, contents, carried: 0 };
}

// The kept program checked again after edits to its own files, rechecking only their bodies when
// each edit changed nothing else; or the session back, for a build afresh, when one did, a file
// other than the program's own changed, or the recheck can't stand for a clean check.
/** @throws {CompileError | IoError} */
function rechecked(kept: Kept): { done: Kept | undefined; session: Session | undefined } {
  let k = kept;
  let edits: [usize, string][] = [];
  let fresh = false;
  const reading = partStart(k.checked.tables.session);
  for (const [f, text] of k.contents) {
    const now = fileText(f);
    if (now === text) continue;
    const index = k.loaded.modules.findIndex((m) => m.path === f);
    if (index < 0 || now === undefined) fresh = true;
    else edits.push([index as usize, now!]);
  }
  partEnd(k.checked.tables.session, "reload read", reading);
  const classifying = partStart(k.checked.tables.session);
  let classes: Edit[] = [];
  for (const [index, now] of edits) {
    const edit = classified(k.loaded.modules[index]!.src, now);
    if (edit.fallback !== undefined || edit.changed.some((c) => c.name === "constructor")) fresh = true;
    classes.push(edit);
  }
  partEnd(k.checked.tables.session, "reload classify", classifying);
  if (fresh) return spent(k);
  const started = stageStart(k.checked.tables.session);
  let bodies: Replaced[] = [];
  let at: usize = 0;
  for (const [index, now] of edits) {
    const edit: Ref<Edit> = classes[at]!;
    at++;
    const base = k.loaded.modules[index]!.base;
    const file = k.loaded.modules[index]!.file;
    const before = k.loaded.modules[index]!.src;
    // A changed body is named in the program as its file's link names it.
    let wanted: { owner: string | undefined; name: string; whole: boolean }[] = [];
    for (const c of edit.changed) wanted.push(c.owner !== undefined ? { owner: uniqueIn(k.loaded, index, c.owner!), name: c.name, whole: false } : { owner: undefined, name: uniqueIn(k.loaded, index, c.name), whole: c.whole });
    let r = reloaded(k, index, now);
    if (r.fallback !== undefined) return spent(k);
    let taken = takenBodies(r.statements, wanted);
    if (taken === undefined) return spent(k);
    // The entry has no source of its own until a kept check maps its positions.
    const known = k.loaded.sources.findIndex((x) => x.base === base);
    if (known < 0) k.loaded.sources.unshift({ base, src: before, file });
    const s: usize = known < 0 ? 0 : (known as usize);
    const mapped: Ref<[usize, usize, usize][] | undefined> = k.loaded.sources[s]!.moves;
    const was: [usize, usize, usize][] | undefined = mapped !== undefined ? [...mapped!] : undefined;
    let moves = composedMoves(was, before.length, edit.moves);
    let spill = spillFrom(was, before.length);
    // Each body read again is put past every position the kept check holds, mapped to where it is.
    let found = taken!;
    while (found.length > 0) {
      let body = found.shift()!;
      const ci = wanted.findIndex((w) => w.owner === body.owner && w.name === body.name);
      const c: Ref<Changed> = edit.changed[ci as usize]!;
      const by = (spill as i64) - (c.start as i64);
      let moved: Stmt[] = [];
      while (body.statements.length > 0) moved.push(movedStmt(body.statements.shift()!, by));
      moves.push([spill, spill + (c.end - c.start), c.start]);
      spill = spill + (c.end - c.start) + 1;
      if (body.func !== undefined) {
        const whole = movedStmt(body.func!, by);
        if (whole.kind === "function") bodies.push({ owner: undefined, name: body.name, statements: [], func: whole });
      } else bodies.push({ owner: body.owner, name: body.name, statements: moved });
    }
    if (spill >= (FILE_SPAN as usize)) return spent(k);
    k.loaded.sources[s]!.src = now;
    k.loaded.sources[s]!.moves = moves;
    k.contents.set(k.loaded.modules[index]!.path, now);
  }
  let { checked, parts, loaded, contents } = k;
  let made: { checked: Checked; parts: CheckerParts; fallback: string | undefined; rechecked: Set<InstanceId> } | undefined = undefined;
  try {
    made = recheckKept(checked, parts, bodies);
  } catch (e) {
    if (e instanceof CompileError) throw sourced(e, undefined, loaded.sources);
    throw e;
  }
  let done = made!;
  if (done.fallback !== undefined) {
    let { tables } = done.checked;
    return { done: undefined, session: tables.session };
  }
  for (let i: usize = 0; i < done.checked.warnings.length; i++) done.checked.warnings[i]!.sources = [...loaded.sources];
  stageEnd(done.checked.tables.session, "check", started);
  return { done: { checked: done.checked, parts: done.parts, loaded, contents, carried: k.carried, emitted: k.emitted, rechecked: done.rechecked, units: k.units }, session: undefined };
}

// The name a top-level declaration of the file at `index` has in the program.
function uniqueIn(loaded: Ref<Loaded>, index: usize, written: string): string {
  if (loaded.links === undefined) return written;
  const d = loaded.links![index]!.own.get(written);
  return d !== undefined ? d.unique : written;
}

// A kept program given up on: its session, for a build afresh.
function spent(kept: Kept): { done: Kept | undefined; session: Session | undefined } {
  let { checked } = kept;
  let { tables } = checked;
  return { done: undefined, session: tables.session };
}

// The program whose entry is `file`, with text `src`, loaded and checked, with each warning given
// its files. `looked` is given the files it read or looked for, whether or not they load.
/** @throws {CompileError | Error | IoError} */
export function checkedSource(compilation: Compilation, file: string, src: string, taken: Set<string> | false, looked: Mut<string[]>): { checked: Checked; loaded: Loaded } {
  let made = checkedSourceKeeping(compilation, file, src, taken, looked);
  return { checked: made.checked, loaded: made.loaded };
}

// `checkedSource`, giving back what the checker kept besides its tables as well.
/** @throws {CompileError | Error | IoError} */
export function checkedSourceKeeping(compilation: Compilation, file: string, src: string, taken: Set<string> | false, looked: Mut<string[]>): { checked: Checked; loaded: Loaded; parts: CheckerParts } {
  let program = compilation;
  const library = taken !== false;
  let modules = loadedFrom(program, file, src, looked);
  let statements: Stmt[] = [];
  try {
    statements = expanded(program, modules, library);
  } catch (e) {
    if (e instanceof CompileError) throw sourced(e, copyNames(program.names), modules.sources);
    throw e;
  }
  let { checked, parts } = checkedProgram(program, statements, taken, modules.sources);
  for (let i: usize = 0; i < checked.warnings.length; i++) checked.warnings[i]!.sources = [...modules.sources];
  return { checked, loaded: modules, parts };
}

// The program's files loaded, timed as the parse stage.
/** @throws {CompileError | Error | IoError} */
function loadedFrom(compilation: Mut<Compilation>, file: string, src: string, looked: Mut<string[]>): Loaded {
  const started = stageStart(compilation.session);
  try {
    return load(compilation, file, src);
  } finally {
    stageEnd(compilation.session, "parse", started);
    for (const f of compilation.looked) looked.push(f);
  }
}

// `check` of a whole program, timed as the check stage, its errors given the program's files.
/** @throws {CompileError} */
export function checkedProgram(compilation: Compilation, program: Stmt[], taken: Set<string> | false, sources: Ref<Source[]>): { checked: Checked; parts: CheckerParts } {
  const started = stageStart(compilation.session);
  let made: { checked: Checked; parts: CheckerParts } | undefined = undefined;
  try {
    made = checkKeeping(compilation, program, taken, false, false);
  } catch (e) {
    if (e instanceof CompileError) throw sourced(e, undefined, sources);
    throw e;
  }
  let done = made!;
  stageEnd(done.checked.tables.session, "check", started);
  return done;
}
