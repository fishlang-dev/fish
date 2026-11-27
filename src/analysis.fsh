// A program loaded, its macros expanded and its files linked, as every compile and check starts.
import { checkCapabilities } from "./capabilities.fsh";
import { check, type Checked } from "./check.fsh";
import { newCompilation, stageEnd, stageStart, type Compilation, type Session } from "./compilation.fsh";
import { CompileError, copyNames, named, type Names, type Source } from "./diag.fsh";
import { expandMacros } from "./macros.fsh";
import { flatten, load, type Loaded } from "./modules.fsh";
import type { Stmt } from "./parser.fsh";
import { liftFuzz, stripFuzz } from "./fuzz.fsh";
import { liftTests, stripTests } from "./tests.fsh";

// Checks the program whose entry is `file`, with text `src`, without building it, its package's
// tests included. The file may be one another imports, so it needs no `main`. `read` reads the
// files it imports before the disk. It compiles within `session`, whose caches it uses.
/** @throws {CompileError | Error | IoError} */
export function analyze(session: Session, src: string, file: string, read?: (path: string) => string | undefined): { checked: Checked; sources: Source[] } {
  let compilation = newCompilation(session);
  let loaded = load(compilation, file, src, read);
  let program: Stmt[] = [];
  try {
    const first = loaded.modules[0]!.pkg;
    let own: string[] = [];
    for (const m of loaded.modules) if (m.pkg === first && !m.path.startsWith("std:")) own.push(m.path);
    liftTests(compilation, loaded.modules, own);
    liftFuzz(compilation, loaded.modules, own);
    program = expanded(compilation, loaded, false);
  } catch (e) {
    if (e instanceof CompileError) throw sourced(e, copyNames(compilation.names), loaded.sources);
    throw e;
  }
  try {
    return { checked: check(compilation, program, false, false, true), sources: loaded.sources };
  } catch (e) {
    if (e instanceof CompileError) throw sourced(e, undefined, loaded.sources);
    throw e;
  }
}

// The program's files with their macros expanded, linked into one program. Tests not lifted
// already are left out.
/** @throws {CompileError | Error} */
export function expanded(compilation: Mut<Compilation>, loaded: Mut<Loaded>, library: boolean): Stmt[] {
  let started = stageStart(compilation.session);
  stripTests(loaded);
  stripFuzz(loaded);
  expandMacros(compilation, loaded, library, (round, macros) => check(round, macros, false, true));
  // After macros, so what a dependency's own macros write is held to its capabilities too.
  checkCapabilities(loaded);
  stageEnd(compilation.session, "macros", started);
  started = stageStart(compilation.session);
  const program = flatten(compilation, loaded, library);
  stageEnd(compilation.session, "check", started);
  return program;
}

// A compile error given the program's other files to render against, and, when it was thrown
// before a check named it, the names its compilation made up.
export function sourced(e: CompileError, names: Names | undefined, sources: Ref<Source[]>): CompileError {
  let out = names === undefined ? e : named(e, names);
  out.sources = [...sources];
  return out;
}
