// How much of the compiler's own source Fish checks: each src file, as a .fsh in a mirror of src
// with its relative imports renamed to match, checked as a program's entry with everything it
// imports. `--update` writes the baseline tests/selfhost.test.ts holds the source to.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { type Session } from "../src/compilation.ts";
import { cachedSession } from "../src/stdcache.ts";
import { CompileError } from "../src/diag.ts";
import { analyze } from "../src/main.ts";

export const BASELINE = join(import.meta.dir, "..", "tests", "selfhost.json");
export type Baseline = { failing: Record<string, string>; count: number };

// Each file's first error, or nothing when it checks. Each is checked as a module another file
// imports, needing no main(), since only main.ts runs.
export function survey(src = join(import.meta.dir, "..", "src")): Record<string, string | null> {
  const mirror = mkdtempSync(join(tmpdir(), "fish-selfhost-"));
  const files = readdirSync(src).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts")).sort();
  try {
    for (const f of files) mirrored(join(src, f), mirror);
    // Messages name the mirror's paths, which differ each run, so they name them from it.
    const session = cachedSession();
    return Object.fromEntries(files.map((f) => [f, firstError(session, join(mirror, f.replace(/\.ts$/, ".fsh")))?.replaceAll(mirror + "/", "").replaceAll(mirror, "src") ?? null]));
  } finally {
    rmSync(mirror, { recursive: true, force: true });
  }
}

// Copies the TypeScript file `file` into `dir` as Fish source, with its relative imports renamed
// to match; gives the copy's path.
export function mirrored(file: string, dir: string): string {
  const to = join(dir, basename(file).replace(/\.ts$/, ".fsh"));
  writeFileSync(to, readFileSync(file, "utf8").replace(/(["'])(\.{1,2}\/[^"']+)\.ts\1/g, "$1$2.fsh$1"));
  return to;
}

function firstError(session: Session, file: string): string | null {
  try {
    analyze(session, readFileSync(file, "utf8"), file);
    return null;
  } catch (e) {
    // An exception that isn't a CompileError is the checker failing on this file, which counts as
    // failing too, so the tracker can't be stopped by one.
    return e instanceof CompileError ? e.message : `internal error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

if (import.meta.main) {
  const results = survey();
  const failing = Object.fromEntries(Object.entries(results).filter((r): r is [string, string] => r[1] !== null));
  for (const [f, error] of Object.entries(results)) console.log(`${error === null ? "pass" : "fail"}  ${f}${error === null ? "" : `  ${error.split("\n")[0]}`}`);
  const count = Object.keys(failing).length;
  console.log(`\n${Object.keys(results).length - count} of ${Object.keys(results).length} files check`);
  if (process.argv.includes("--update")) writeFileSync(BASELINE, JSON.stringify({ failing, count } satisfies Baseline, null, 2) + "\n");
}
