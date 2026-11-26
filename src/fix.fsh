import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { CompileError, copyNames, locate, sourceOf, type Fix, type FixKind, type Source, type TextEdit } from "./diag.fsh";
import { parse, type Stmt } from "./parser.fsh";
import { Queries } from "./queries.fsh";
import { STD_BASE } from "./std.fsh";
import { cachedSession } from "./stdcache.fsh";

// Multi-round, trial-verifying auto-fixer for Fish borrow, move, and mutability errors.
// Candidate fixes on each diagnostic are tried in preference order (shared borrow -> mutable
// borrow / let -> clone) against an in-memory re-check so borrows are preferred whenever the
// callee supports them, falling back to `.clone()` only when ownership is genuinely required.

export type AppliedFix = { file: string; line: usize; kind: FixKind; message: string };
export type FixReport = {
  applied: AppliedFix[];
  remaining: CompileError[];
  edited: Map<string, string>;
  originals: Map<string, string>;
};

type FileEdit = { path: string; start: usize; end: usize; text: string };
type SpanRange = { start: usize; end: usize };

const MAX_ROUNDS: usize = 128;

function copyMap(src: Ref<Map<string, string>>): Map<string, string> {
  let out = new Map<string, string>();
  for (const [k, v] of src) out.set(k, v);
  return out;
}

function isNonProjectSource(file: string): boolean {
  return file === "<std>" || file === "bun" || file.startsWith("std:") || file.startsWith("node:") || file.startsWith("fish:");
}

function isOwnershipCode(code: string): boolean {
  return code === "E0201" || code === "E0202" || code === "E0206" || code === "E0207" || code === "E0214" || code === "E0215";
}

// Flattens a CompileError (or grouped CompileErrors) into individual errors carrying sources and names.
function flattenErrors(err: CompileError): CompileError[] {
  if (err.errors.length === 0) return [err];
  let out: CompileError[] = [];
  for (const e of err.errors) {
    let copy = e.clone();
    if (copy.sources.length === 0) {
      let sources: Source[] = [];
      for (const s of err.sources) sources.push({ base: s.base, src: s.src, file: s.file });
      copy.sources = sources;
    }
    if (copy.names.local.size === 0 && copy.names.madeUp.size === 0) copy.names = copyNames(err.names);
    out.push(copy);
  }
  return out;
}

// Runs a clean in-memory check over `entry` with unsaved buffers `open`.
/** @throws {Error | IoError} */
function checkBuffers(entry: string, manifest: string | undefined, open: Ref<Map<string, string>>, editing: boolean): CompileError[] {
  let looked: string[] = [];
  let queries = new Queries(entry, manifest, copyMap(open), editing);
  let session = cachedSession();
  session.checkCache = false;
  try {
    queries.checked(session, looked, undefined);
    return [];
  } catch (e) {
    if (e instanceof CompileError) return flattenErrors(e);
    throw e;
  }
}

function enclosingInList(stmts: Ref<Stmt[]>, offset: usize): SpanRange | undefined {
  for (const s of stmts) {
    if (offset < s.start || offset > s.end) continue;
    const hit = enclosingInStmt(s, offset);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function enclosingInStmt(s: Ref<Stmt>, offset: usize): SpanRange | undefined {
  if (s.kind === "export") return enclosingInStmt(s.body, offset);
  if (s.kind === "exportDefault") {
    if (s.declaration !== undefined) return enclosingInStmt(s.declaration!, offset);
    return undefined;
  }
  if (s.kind === "function") {
    if (s.body !== undefined) {
      const nested = enclosingInList(s.body!, offset);
      if (nested !== undefined) return nested;
    }
    return { start: s.start, end: s.end };
  }
  if (s.kind === "class") {
    for (const m of s.members) {
      if (offset >= m.start && offset <= m.end) {
        if (m.kind === "method" && m.body !== undefined) {
          const nested = enclosingInList(m.body!, offset);
          if (nested !== undefined) return nested;
        }
        return { start: m.start, end: m.end };
      }
    }
    return undefined;
  }
  if (s.kind === "block" || s.kind === "comptime" || s.kind === "unsafe") return enclosingInList(s.body, offset);
  if (s.kind === "namespace" && s.body !== undefined) return enclosingInList(s.body!, offset);
  if (s.kind === "if") {
    const thenHit = enclosingInList(s.then, offset);
    if (thenHit !== undefined) return thenHit;
    if (s.else !== undefined) return enclosingInList(s.else!, offset);
    return undefined;
  }
  if (s.kind === "while" || s.kind === "doWhile" || s.kind === "for" || s.kind === "forIn" || s.kind === "forOf") return enclosingInList(s.body, offset);
  if (s.kind === "labeled") return enclosingInStmt(s.body, offset);
  if (s.kind === "try") {
    const tryHit = enclosingInList(s.block, offset);
    if (tryHit !== undefined) return tryHit;
    if (s.handler !== undefined) {
      const catchHit = enclosingInList(s.handler!, offset);
      if (catchHit !== undefined) return catchHit;
    }
    if (s.finalizer !== undefined) return enclosingInList(s.finalizer!, offset);
    return undefined;
  }
  if (s.kind === "switch") {
    for (const c of s.cases) {
      const caseHit = enclosingInList(c.body, offset);
      if (caseHit !== undefined) return caseHit;
    }
    return undefined;
  }
  return undefined;
}

// Finds the innermost enclosing function or class method span containing `offset` in a parsed AST.
function enclosingCallable(stmts: Ref<Stmt[]>, offset: usize): SpanRange | undefined {
  return enclosingInList(stmts, offset);
}

// Resolves a single program-space TextEdit into a validated file-local edit inside `projectRoot`.
/** @throws {IoError} */
function resolveFileEdit(
  entry: string,
  entrySrc: string,
  projectRoot: string,
  open: Ref<Map<string, string>>,
  sources: Ref<Source[]>,
  start: usize,
  end: usize,
  text: string,
  kind: FixKind,
): FileEdit | undefined {
  if (start >= STD_BASE || end >= STD_BASE || start > end) return undefined;
  const s = sourceOf(entrySrc, entry, start, sources);
  const e = sourceOf(entrySrc, entry, end, sources);
  if (s.file !== e.file || s.offset > e.offset) return undefined;
  if (isNonProjectSource(s.file)) return undefined;
  const rawPath = s.file === entry ? entry : resolve(dirname(entry), s.file);
  if (!existsSync(rawPath)) return undefined;
  let path = rawPath;
  try {
    path = realpathSync(rawPath);
  } catch (_e) {
    return undefined;
  }
  const rootPrefix = projectRoot.endsWith(sep) ? projectRoot : projectRoot + sep;
  if (path !== projectRoot && !path.startsWith(rootPrefix)) return undefined;
  if (path.includes(`${sep}node_modules${sep}`)) return undefined;
  const current = open.get(path) ?? readFileSync(path, "utf8");
  if (e.offset > current.length) return undefined;
  // Guard token replacements against stale or macro-expanded spans.
  if (kind === "mut" && text === "let" && current.slice(s.offset as i64, e.offset as i64) !== "const") return undefined;
  if (kind === "mut" && text === "Mut" && current.slice(s.offset as i64, e.offset as i64) !== "Ref") return undefined;
  return { path, start: s.offset, end: e.offset, text };
}

type TrialApplied = {
  next: Map<string, string>;
  primaryFile: string;
  primaryOffset: usize;
  primaryLine: usize;
  calleeSpan?: SpanRange;
  edits: FileEdit[];
};

// Adjusts a file offset after applying a set of non-overlapping edits to the same file.
function shiftedOffset(offset: usize, edits: Ref<FileEdit[]>, filePath: string): usize {
  let delta: i64 = 0;
  for (const ed of edits) {
    if (ed.path !== filePath) continue;
    if (ed.end <= offset) delta += (ed.text.length as i64) - ((ed.end - ed.start) as i64);
  }
  const shifted = (offset as i64) + delta;
  return shifted > 0 ? (shifted as usize) : 0;
}

// Re-parses `filePath` from `open` and finds the enclosing callable at `offset`.
/** @throws {IoError} */
function callableAt(open: Ref<Map<string, string>>, filePath: string, offset: usize): SpanRange | undefined {
  const text = open.get(filePath) ?? readFileSync(filePath, "utf8");
  try {
    const parsed = parse(text, { last: 0 });
    return enclosingCallable(parsed, offset);
  } catch (_e) {
    return undefined;
  }
}

// Applies a Fix's edits onto a copy of `open`, verifying no overlaps and clean re-parse.
/** @throws {IoError} */
function applyFixCandidate(
  entry: string,
  projectRoot: string,
  open: Ref<Map<string, string>>,
  sources: Ref<Source[]>,
  fix: Ref<Fix>,
): TrialApplied | undefined {
  if (fix.edits.length === 0) return undefined;
  const entrySrc = open.get(entry) ?? readFileSync(entry, "utf8");
  let byFile = new Map<string, FileEdit[]>();
  let allEdits: FileEdit[] = [];
  let primaryFile = "";
  let primaryOffset: usize = 0;
  let primaryLine: usize = 1;
  for (let i: usize = 0; i < fix.edits.length; i++) {
    const ed: Ref<TextEdit> = fix.edits[i]!;
    const resolved = resolveFileEdit(entry, entrySrc, projectRoot, open, sources, ed.start, ed.end, ed.text, fix.kind);
    if (resolved === undefined) return undefined;
    const editPath = resolved.path;
    if (i === 0) {
      primaryFile = editPath;
      primaryOffset = resolved.start;
      const cur = open.get(editPath) ?? readFileSync(editPath, "utf8");
      primaryLine = locate(cur, resolved.start).line;
    }
    allEdits.push({ path: resolved.path, start: resolved.start, end: resolved.end, text: resolved.text });
    const existing = byFile.get(editPath);
    if (existing === undefined) byFile.set(editPath, [resolved]);
    else {
      let list: FileEdit[] = existing;
      list.push(resolved);
      byFile.set(editPath, list);
    }
  }
  let next = copyMap(open);
  let calleeSpan: SpanRange | undefined = undefined;
  for (const [path, rawEdits] of byFile) {
    let edits = [...rawEdits];
    edits.sort((a, b) => (a.start !== b.start ? (b.start as i64) - (a.start as i64) : (b.end as i64) - (a.end as i64)));
    // Reject overlapping edits within one fix.
    for (let i: usize = 1; i < edits.length; i++) {
      if (edits[i]!.end > edits[i - 1]!.start) return undefined;
    }
    let text = next.get(path) ?? readFileSync(path, "utf8");
    for (const ed of edits) {
      text = text.slice(0, ed.start as i64) + ed.text + text.slice(ed.end as i64);
    }
    // Every edited file must still parse cleanly before we spend a full type check on it.
    let parsed: Stmt[] = [];
    try {
      parsed = parse(text, { last: 0 });
    } catch (_e) {
      return undefined;
    }
    if (path === primaryFile) calleeSpan = enclosingCallable(parsed, primaryOffset);
    next.set(path, text);
  }
  return { next, primaryFile, primaryOffset, primaryLine, calleeSpan, edits: allEdits };
}

function errorFileAndOffset(entry: string, entrySrc: string, e: Ref<CompileError>): { path: string; offset: usize; line: usize } | undefined {
  if (e.start >= STD_BASE) return undefined;
  const loc = sourceOf(entrySrc, entry, e.start, e.sources);
  if (isNonProjectSource(loc.file)) return undefined;
  const raw = loc.file === entry ? entry : resolve(dirname(entry), loc.file);
  if (!existsSync(raw)) return undefined;
  let path = raw;
  try {
    path = realpathSync(raw);
  } catch (_e) {
    return undefined;
  }
  return { path, offset: loc.offset, line: locate(loc.src, loc.offset).line };
}

function errorKey(entry: string, entrySrc: string, e: Ref<CompileError>): string {
  const loc = sourceOf(entrySrc, entry, e.start, e.sources);
  const pos = locate(loc.src, loc.offset);
  return `${loc.file}:${pos.line}:${e.code}:${e.message}`;
}

function errorTag(entry: string, entrySrc: string, e: Ref<CompileError>): string {
  const loc = sourceOf(entrySrc, entry, e.start, e.sources);
  return `${loc.file}:${e.code}:${e.message}`;
}

/** @throws {IoError} */
function hasErrorKey(entry: string, open: Ref<Map<string, string>>, errors: Ref<CompileError[]>, target: string): boolean {
  const entrySrc = open.get(entry) ?? readFileSync(entry, "utf8");
  for (const e of errors) if (errorKey(entry, entrySrc, e) === target) return true;
  return false;
}

// Whether any error in `errors` lies inside `calleeSpan` of `filePath` (meaning the edited callee
// body itself cannot borrow that parameter).
/** @throws {IoError} */
function hasErrorInCallable(entry: string, open: Ref<Map<string, string>>, errors: Ref<CompileError[]>, filePath: string, span: Ref<SpanRange>): boolean {
  const entrySrc = open.get(entry) ?? readFileSync(entry, "utf8");
  for (const e of errors) {
    const loc = errorFileAndOffset(entry, entrySrc, e);
    if (loc !== undefined && loc.path === filePath && loc.offset >= span.start && loc.offset <= span.end) return true;
  }
  return false;
}

// Checks whether an equal-count callee-borrow trial introduced a regression (such as breaking a
// typed callback, subclass override, or interface implementation) by comparing against `.clone()`.
/** @throws {Error | IoError} */
function borrowSafeWithClone(
  entry: string,
  beforeOpen: Ref<Map<string, string>>,
  beforeErrors: Ref<CompileError[]>,
  trialOpen: Ref<Map<string, string>>,
  trialErrors: Ref<CompileError[]>,
  cloneOpen: Ref<Map<string, string>>,
  cloneErrors: Ref<CompileError[]>,
): boolean {
  if (cloneErrors.length < trialErrors.length) return false;
  const beforeSrc = beforeOpen.get(entry) ?? readFileSync(entry, "utf8");
  const trialSrc = trialOpen.get(entry) ?? readFileSync(entry, "utf8");
  const cloneSrc = cloneOpen.get(entry) ?? readFileSync(entry, "utf8");
  let allowed = new Set<string>();
  for (const e of beforeErrors) allowed.add(errorTag(entry, beforeSrc, e));
  for (const e of cloneErrors) allowed.add(errorTag(entry, cloneSrc, e));
  for (const e of trialErrors) {
    if (!allowed.has(errorTag(entry, trialSrc, e))) return false;
  }
  return true;
}

// When no `.clone()` fallback exists, reject if the borrow introduced a non-ownership error.
/** @throws {Error | IoError} */
function borrowSafeWithoutClone(
  entry: string,
  beforeOpen: Ref<Map<string, string>>,
  beforeErrors: Ref<CompileError[]>,
  trialOpen: Ref<Map<string, string>>,
  trialErrors: Ref<CompileError[]>,
): boolean {
  const beforeSrc = beforeOpen.get(entry) ?? readFileSync(entry, "utf8");
  const trialSrc = trialOpen.get(entry) ?? readFileSync(entry, "utf8");
  let beforeTags = new Set<string>();
  for (const e of beforeErrors) beforeTags.add(errorTag(entry, beforeSrc, e));
  for (const e of trialErrors) {
    if (!beforeTags.has(errorTag(entry, trialSrc, e)) && !isOwnershipCode(e.code)) return false;
  }
  return true;
}

function stateSignature(open: Ref<Map<string, string>>): string {
  let keys: string[] = [];
  for (const k of open.keys()) keys.push(k);
  keys.sort();
  let parts: string[] = [];
  for (const k of keys) parts.push(`${k}\0${open.get(k) ?? ""}`);
  return parts.join("\u0001");
}

function commitMap(open: Mut<Map<string, string>>, originals: Mut<Map<string, string>>, next: Ref<Map<string, string>>): void {
  for (const [p, t] of next) {
    if (!originals.has(p)) {
      let orig = "";
      try {
        orig = readFileSync(p, "utf8");
      } catch (_e) {
        orig = "";
      }
      originals.set(p, orig);
    }
    open.set(p, t);
  }
}

// Runs the multi-round trial-verifying fix loop over `entry` (within `projectRoot`).
/** @throws {Error | IoError} */
export function fixProgram(
  entryFile: string,
  manifest: string | undefined,
  projectRoot: string,
): FixReport {
  const entry = realpathSync(resolve(entryFile));
  const root = realpathSync(resolve(projectRoot));
  let open = new Map<string, string>();
  let originals = new Map<string, string>();
  const entryOrig = readFileSync(entry, "utf8");
  originals.set(entry, entryOrig);
  open.set(entry, entryOrig);

  let editing = false;
  let errors = checkBuffers(entry, manifest, open, editing);
  // If a standalone file has no `main`, switch to editing mode so library modules and tests fix too.
  if (errors.length === 1 && errors[0]!.code === "E0405" && errors[0]!.start === 0 && errors[0]!.end === 0) {
    editing = true;
    errors = checkBuffers(entry, manifest, open, editing);
  }

  let seen = new Set<string>();
  seen.add(stateSignature(open));

  let applied: AppliedFix[] = [];
  for (let round: usize = 0; round < MAX_ROUNDS && errors.length > 0; round++) {
    let nextErrors: CompileError[] | undefined = undefined;
    const entrySrc = open.get(entry) ?? entryOrig;
    for (let ei: usize = 0; ei < errors.length && nextErrors === undefined; ei++) {
      const err: Ref<CompileError> = errors[ei]!;
      if (err.fixes.length === 0) continue;
      const key = errorKey(entry, entrySrc, err);
      const directMut = err.code === "E0206" || err.code === "E0207";
      // Lazy `.clone()` baseline for comparing equal-count callee-borrow trials against regressions.
      let cloneChecked = false;
      let cloneOpen: Map<string, string> | undefined = undefined;
      let cloneErrors: CompileError[] | undefined = undefined;
      // Try fixes in exact preference order: borrow -> mut -> clone.
      for (let fi: usize = 0; fi < err.fixes.length && nextErrors === undefined; fi++) {
        const candidate: Ref<Fix> = err.fixes[fi]!;
        const trial = applyFixCandidate(entry, root, open, err.sources, candidate);
        if (trial === undefined) continue;
        const sig = stateSignature(trial.next);
        if (seen.has(sig)) continue;
        const after = checkBuffers(entry, manifest, trial.next, editing);
        const targetGone = !hasErrorKey(entry, trial.next, after, key);
        if (!targetGone) continue;

        // If this candidate changed a callee parameter to borrow (Ref/Mut) for a move error,
        // reject it whenever the callee body itself now fails to check.
        const calleeBorrow = !directMut && (candidate.kind === "borrow" || candidate.kind === "mut");
        if (calleeBorrow && trial.calleeSpan !== undefined && hasErrorInCallable(entry, trial.next, after, trial.primaryFile, trial.calleeSpan!)) {
          continue;
        }

        // Accept immediately when total errors drop without introducing non-ownership regressions,
        // or when a direct mutability fix or verified borrow/clone unblocks checking cleanly.
        let acceptDirect =
          after.length < errors.length &&
          (!calleeBorrow || after.length === 0 || (trial.calleeSpan !== undefined && borrowSafeWithoutClone(entry, open, errors, trial.next, after)));
        if (!acceptDirect && after.length === errors.length && (!calleeBorrow || candidate.kind === "borrow")) {
          if (!calleeBorrow) {
            acceptDirect = true;
          } else if (trial.calleeSpan !== undefined) {
            if (!cloneChecked) {
              cloneChecked = true;
              for (const cf of err.fixes) {
                if (cf.kind !== "clone") continue;
                const ct = applyFixCandidate(entry, root, open, err.sources, cf);
                if (ct !== undefined) {
                  cloneErrors = checkBuffers(entry, manifest, ct.next, editing);
                  cloneOpen = ct.next;
                }
                break;
              }
            }
            acceptDirect =
              cloneOpen !== undefined && cloneErrors !== undefined
                ? borrowSafeWithClone(entry, open, errors, trial.next, after, cloneOpen!, cloneErrors!)
                : borrowSafeWithoutClone(entry, open, errors, trial.next, after);
          }
        }
        if (acceptDirect) {
          seen.add(sig);
          commitMap(open, originals, trial.next);
          applied.push({ file: trial.primaryFile, line: trial.primaryLine, kind: candidate.kind, message: candidate.message });
          nextErrors = after;
          break;
        }

        // 1-step mut lookahead: upgrading a callee param to `Mut<T>` may reveal `const x` -> `let x`
        // or `Ref<T>` -> `Mut<T>` at a caller; accept both together if the callee stays clean and
        // error count drops (or progresses cleanly without introducing regressions).
        if (calleeBorrow && candidate.kind === "mut" && after.length === errors.length) {
          let paired = false;
          for (let ai: usize = 0; ai < after.length && !paired; ai++) {
            const follow: Ref<CompileError> = after[ai]!;
            for (const ffix of follow.fixes) {
              if (ffix.kind !== "mut") continue;
              const trial2 = applyFixCandidate(entry, root, trial.next, follow.sources, ffix);
              if (trial2 === undefined) continue;
              const sig2 = stateSignature(trial2.next);
              if (seen.has(sig2)) continue;
              const after2 = checkBuffers(entry, manifest, trial2.next, editing);
              const calleeOffset2 = shiftedOffset(trial.primaryOffset, trial2.edits, trial.primaryFile);
              const calleeSpan2 = callableAt(trial2.next, trial.primaryFile, calleeOffset2);
              if (calleeSpan2 !== undefined && hasErrorInCallable(entry, trial2.next, after2, trial.primaryFile, calleeSpan2!)) continue;
              const followKey = errorKey(entry, trial.next.get(entry) ?? entryOrig, follow);
              let acceptPair =
                after2.length < errors.length &&
                (after2.length === 0 || (calleeSpan2 !== undefined && borrowSafeWithoutClone(entry, open, errors, trial2.next, after2)));
              if (!acceptPair && after2.length === errors.length && calleeSpan2 !== undefined && !hasErrorKey(entry, trial2.next, after2, followKey)) {
                if (!cloneChecked) {
                  cloneChecked = true;
                  for (const cf of err.fixes) {
                    if (cf.kind !== "clone") continue;
                    const ct = applyFixCandidate(entry, root, open, err.sources, cf);
                    if (ct !== undefined) {
                      cloneErrors = checkBuffers(entry, manifest, ct.next, editing);
                      cloneOpen = ct.next;
                    }
                    break;
                  }
                }
                acceptPair =
                  cloneOpen !== undefined && cloneErrors !== undefined
                    ? borrowSafeWithClone(entry, open, errors, trial2.next, after2, cloneOpen!, cloneErrors!)
                    : borrowSafeWithoutClone(entry, open, errors, trial2.next, after2);
              }
              if (acceptPair) {
                seen.add(sig2);
                commitMap(open, originals, trial2.next);
                applied.push({ file: trial.primaryFile, line: trial.primaryLine, kind: candidate.kind, message: candidate.message });
                applied.push({ file: trial2.primaryFile, line: trial2.primaryLine, kind: ffix.kind, message: ffix.message });
                nextErrors = after2;
                paired = true;
                break;
              }
            }
          }
        }
      }
    }
    if (nextErrors === undefined) break;
    errors = nextErrors!;
  }

  let edited = new Map<string, string>();
  for (const [path, text] of open) {
    const orig = originals.get(path);
    if (orig !== undefined && orig !== text) edited.set(path, text);
  }
  return { applied, remaining: errors, edited, originals };
}

// Formats a relative file display path for CLI output.
export function displayFixPath(path: string, cwd: string): string {
  let base = cwd;
  try {
    base = realpathSync(cwd);
  } catch (_e) {
    base = cwd;
  }
  const rel = relative(base, path);
  return rel !== "" ? rel : path;
}
