// Every check of a program passes through here: the clean path, and the kept one a rebuild takes.
// A `Queries` holds what one program is checked with and the check the last run of it kept, so a
// rebuild whose files all read as they did is not checked again, and one after an edit checks only
// the bodies that changed. `fishc build`, `fishc check` and `fishc watch` all drive it; the
// language server holds one per program, and the cache on disk reads and writes one here.
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { InstanceId } from "./arenas.fsh";
import { expanded, sourced } from "./analysis.fsh";
import { checkKeeping, recheckKept, type Checked, type CheckerParts } from "./check.fsh";
import { newCompilation, partEnd, partStart, stageEnd, stageStart, stopAfter, type Compilation, type Session } from "./compilation.fsh";
import { checkKey, checkPath, compilerDigest, readCheck, writeCheck, type Envelope } from "./checkcache.fsh";
import { CompileError, copyNames, type Source } from "./diag.fsh";
import { classified, type Changed, type Edit, type Replaced } from "./edits.fsh";
import { composedMoves, loadedContents, reloaded, spillFrom, takenBodies, textIn, unchanged, type Kept } from "./incremental.fsh";
import { load, type Loaded } from "./modules.fsh";
import { movedStmt } from "./nodes.fsh";
import type { Stmt } from "./parser.fsh";
import { liftFuzz } from "./fuzz.fsh";
import { liftTests } from "./tests.fsh";
import { FILE_SPAN } from "./program.fsh";

// What one program is checked with: everything a check of it needs that is not the check itself.
// A kept check is passed in and handed back rather than held here, since it is an owned value
// whose every move is a copy of the checker's tables; whoever generates from one keeps it.
export class Queries {
  entry: string;
  manifest: string | undefined;
  open: Map<string, string>;
  editing: boolean;

  // `entry` is the program's entry file, `manifest` its package's, which a build may read, and
  // `open` the text of any file an editor holds unsaved, by path, which is read before the disk.
  // `editing` checks as an editor needs it rather than as a build does: the package's tests are
  // lifted into the program, so an error inside a `test` block is reported, and the entry needs
  // no `main`, since it may be a file another imports.
  constructor(entry: string, manifest: string | undefined, open: Map<string, string>, editing = false) {
    this.entry = entry;
    this.manifest = manifest;
    this.open = open;
    this.editing = editing;
  }

  // The program checked: `kept`, when every file it read still reads as it did; that check with
  // the edited bodies checked again, where they can be; or the program checked afresh.
  /** @throws {CompileError | Error | IoError} */
  checked(this: Ref<this>, session: Session, looked: Mut<string[]>, kept: Kept | undefined): Kept {
    return checkedFrom(session, this.entry, looked, kept, this.manifest, this.open, this.editing);
  }
}

// The program checked: `kept`'s, given `session`, when every file it read reads as it did, or else
// loaded and checked afresh.
/** @throws {CompileError | Error | IoError} */
function checkedFrom(session: Session, file: string, looked: Mut<string[]>, kept: Kept | undefined, manifest: string | undefined, open: Ref<Map<string, string>>, editing: boolean): Kept {
  if (kept !== undefined) {
    let reused = kept;
    reused.checked.tables.session = session;
    const comparing = partStart(reused.checked.tables.session);
    const same = unchanged(reused.contents, open);
    partEnd(reused.checked.tables.session, "reload compare", comparing);
    if (same) {
      for (const f of reused.contents.keys()) looked.push(f);
      reused.carried++;
      reused.rechecked = new Set<InstanceId>();
      return reused;
    }
    let { done, session: back } = rechecked(reused, open);
    if (done !== undefined) {
      let carried = done;
      for (const f of carried.contents.keys()) looked.push(f);
      carried.carried++;
      return carried;
    }
    return checkedAfresh(back!, file, looked, manifest, open, editing);
  }
  return checkedAfresh(session, file, looked, manifest, open, editing);
}

// The program loaded and checked afresh, with what to keep of it.
/** @throws {CompileError | Error | IoError} */
function checkedAfresh(session: Session, file: string, looked: Mut<string[]>, manifest: string | undefined, open: Ref<Map<string, string>>, editing: boolean): Kept {
  const manifestText = manifest !== undefined ? textIn(open, manifest!) : undefined;
  const src = textIn(open, file);
  let compilation = newCompilation(session);
  let loaded = loadedFrom(compilation, file, src !== undefined ? src! : readFileSync(file, "utf8"), looked, open);
  stopAfter(compilation.session, "parse");
  // Every file the load read, which is what the cached check is keyed by.
  const contents = loadedContents(loaded, looked, manifest, manifestText, open);
  // std:build's text is made from the build's target and flags rather than read, so it keys too.
  let entry = file;
  for (const m of loaded.modules) if (m.path === "std:build") entry = `${file}\0${m.src}`;
  const key = cached(compilation.session) ? checkKey(compilerDigest(), entry, editing, false, contents) : "";
  // The check on disk is looked for before this one is made, since restoring it is what the cache
  // is for. Until it carries the state, a hit is only noted and the check still runs.
  const found = key !== "" ? readCheck(checkPath(key), key) : undefined;
  noteCache(compilation.session, found !== undefined ? "cache hit" : "cache miss");
  let made = checkedLoaded(compilation, loaded, false, editing);
  if (key !== "" && found === undefined) kept(key, made.checked);
  return { checked: made.checked, parts: made.parts, loaded: made.loaded, contents, carried: 0 };
}

// Whether this run may read and write cached checks. `FISH_NO_CHECK_CACHE` turns it off, which
// `--no-check-cache` sets, so a build can be made to check whatever the cache holds.
function cached(session: Ref<Session>): boolean {
  return session.checkCache !== false && process.env.FISH_NO_CHECK_CACHE === undefined;
}

// What the check stage's line says about the cache, when a run is timing itself.
function noteCache(session: Mut<Session>, note: string): void {
  if (session.timings !== undefined) session.timings!.notes.set("check", note);
}

// Writes the check for `key` to the cache. Until the state is encoded, that is the envelope and
// its counts alone. A cache that cannot be written is not a failure.
function kept(key: string, checked: Ref<Checked>): void {
  const envelope: Envelope = { format: 1, key, instances: checked.tables.arenas.instanceCount(), bodies: checked.tables.arenas.bodyCount(), classes: checked.tables.arenas.classCount(), entries: 0 };
  writeCheck(checkPath(key), envelope, "");
}

// The kept program checked again after edits to its own files, rechecking only their bodies when
// each edit changed nothing else; or the session back, for a build afresh, when one did, a file
// other than the program's own changed, or the recheck can't stand for a clean check.
/** @throws {CompileError | IoError} */
function rechecked(kept: Kept, open: Ref<Map<string, string>>): { done: Kept | undefined; session: Session | undefined } {
  let k = kept;
  let edits: [usize, string][] = [];
  let fresh = false;
  const reading = partStart(k.checked.tables.session);
  for (const [f, text] of k.contents) {
    const now = textIn(open, f);
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
    let found = taken;
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
  let done = recheckedSourced(checked, parts, bodies, loaded.sources);
  if (done.fallback !== undefined) {
    let { tables } = done.checked;
    return { done: undefined, session: tables.session };
  }
  for (let i: usize = 0; i < done.checked.warnings.length; i++) done.checked.warnings[i]!.sources = [...loaded.sources];
  stageEnd(done.checked.tables.session, "check", started);
  stopAfter(done.checked.tables.session, "check");
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
  let none = new Map<string, string>();
  let made = checkedSourceKeeping(compilation, file, src, taken, looked, none, false);
  return { checked: made.checked, loaded: made.loaded };
}

// `checkedSource`, giving back what the checker kept besides its tables as well.
/** @throws {CompileError | Error | IoError} */
export function checkedSourceKeeping(compilation: Compilation, file: string, src: string, taken: Set<string> | false, looked: Mut<string[]>, open: Ref<Map<string, string>>, editing: boolean): { checked: Checked; loaded: Loaded; parts: CheckerParts } {
  let program = compilation;
  let modules = loadedFrom(program, file, src, looked, open);
  stopAfter(program.session, "parse");
  return checkedLoaded(program, modules, taken, editing);
}

// The program loaded, then expanded and checked. Apart from the load so that whatever drives a
// check can read the files it holds, and so key it, before deciding to check at all.
/** @throws {CompileError | Error | IoError} */
export function checkedLoaded(compilation: Compilation, loaded: Loaded, taken: Set<string> | false, editing: boolean): { checked: Checked; loaded: Loaded; parts: CheckerParts } {
  let program = compilation;
  let modules = loaded;
  const library = taken !== false;
  let statements: Stmt[] = [];
  try {
    // An editor checks the package's tests too, so an error inside a `test` block is reported;
    // a build leaves them out.
    if (editing) {
      const first = modules.modules[0]!.pkg;
      let own: string[] = [];
      for (const m of modules.modules) if (m.pkg === first && !m.path.startsWith("std:")) own.push(m.path);
      liftTests(program, modules.modules, own);
      liftFuzz(program, modules.modules, own);
    }
    statements = expanded(program, modules, library);
  } catch (e) {
    if (e instanceof CompileError) throw sourced(e, copyNames(program.names), modules.sources);
    throw e;
  }
  let { checked, parts } = checkedProgram(program, statements, taken, modules.sources, editing);
  for (let i: usize = 0; i < checked.warnings.length; i++) checked.warnings[i]!.sources = [...modules.sources];
  return { checked, loaded: modules, parts };
}

// The program's files loaded, timed as the parse stage.
/** @throws {CompileError | Error | IoError} */
function loadedFrom(compilation: Mut<Compilation>, file: string, src: string, looked: Mut<string[]>, open: Ref<Map<string, string>>): Loaded {
  const started = stageStart(compilation.session);
  // The loader keeps the reader, so it owns the texts it answers from rather than borrowing the
  // holder's: a copy of a handful of open documents against a program's whole parse.
  let held = new Map<string, string>();
  for (const [path, text] of open) held.set(path, text);
  try {
    return load(compilation, file, src, move (path): string | undefined => {
      let out = held.get(resolve(path));
      if (out === undefined) {
        try {
          out = held.get(realpathSync(path));
        } catch (_e) {}
      }
      return out;
    });
  } finally {
    stageEnd(compilation.session, "parse", started);
    for (const f of compilation.looked) looked.push(f);
  }
}

// `checkKeeping` and `recheckKept`, their errors given the program's files. Each is a function of
// its own so that the checked program is returned straight from the call: kept in a local across
// the `try` and unwrapped after it, as `made!`, every array and map in it would be copied while
// the original stayed alive beside the copy, the whole checked program held twice.
/** @throws {CompileError} */
function checkedSourced(compilation: Compilation, program: Stmt[], taken: Set<string> | false, sources: Ref<Source[]>, module: boolean): { checked: Checked; parts: CheckerParts } {
  try {
    return checkKeeping(compilation, program, taken, false, module);
  } catch (e) {
    if (e instanceof CompileError) throw sourced(e, undefined, sources);
    throw e;
  }
}

/** @throws {CompileError} */
function recheckedSourced(checked: Checked, parts: CheckerParts, bodies: Replaced[], sources: Ref<Source[]>): { checked: Checked; parts: CheckerParts; fallback: string | undefined; rechecked: Set<InstanceId> } {
  try {
    return recheckKept(checked, parts, bodies);
  } catch (e) {
    if (e instanceof CompileError) throw sourced(e, undefined, sources);
    throw e;
  }
}

// `check` of a whole program, timed as the check stage, its errors given the program's files.
/** @throws {CompileError} */
export function checkedProgram(compilation: Compilation, program: Stmt[], taken: Set<string> | false, sources: Ref<Source[]>, module = false): { checked: Checked; parts: CheckerParts } {
  const started = stageStart(compilation.session);
  let done = checkedSourced(compilation, program, taken, sources, module);
  stageEnd(done.checked.tables.session, "check", started);
  stopAfter(done.checked.tables.session, "check");
  return done;
}
