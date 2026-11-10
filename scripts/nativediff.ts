// Compares the native checker with the Bun one: each single-file test program checked by both,
// reporting those where they differ on accepting it, the error code or where the error is, and the
// native panics by where they stop. A directory program needs the loader, which isn't compiled.
// Usage: bun scripts/nativediff.ts <native-checker> [every-nth-program] [jobs]
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "../src/check.ts";
import { newCompilation } from "../src/compilation.ts";
import { CompileError, formatError } from "../src/diag.ts";
import { parse } from "../src/parser.ts";
import { build } from "../src/main.ts";
import { cachedSession } from "../src/stdcache.ts";
import { mirrorChecker } from "./nativeprobe.ts";

export type Row = { name: string; bun: string; native: string; detail: string };

// Builds the native checker in `dir`, optimized since unoptimized frames overflow the stack.
export function buildChecker(dir: string): string {
  const out = join(dir, "checker");
  build(cachedSession(), mirrorChecker(dir), out, true);
  return out;
}

export type Comparison = {
  compared: number;
  // Programs parse and check alone don't reach what they test, needing imports, macros or
  // decorators: both checkers refuse these at the same place, which proves little.
  unreached: string[];
  differing: Row[];
};

// Whether checking a program alone gives what the program says it should.
function reached(source: string, verdict: string, message: string): boolean {
  const expected = [...source.matchAll(/\/\/ error: (.*)/g)].map((m) => m[1]!.trim());
  if (expected.length === 0) return verdict === "accepted";
  return verdict.startsWith("rejected") && expected.some((text) => message.includes(text));
}

// The test programs the two checkers don't give one verdict on, and how far the comparison went.
export async function differences(binary: string, every = 1, jobs = 8): Promise<Comparison> {
  const programs = join(import.meta.dir, "..", "tests", "programs");
  const cases: { name: string; source: string }[] = [];
  for (const f of readdirSync(programs).filter((n) => n.endsWith(".fsh")).sort()) {
    for (const part of readFileSync(join(programs, f), "utf8").split(/^(?=\/\/ case: )/m)) {
      if (/^\/\/ mode: parse/m.test(part) || part.trim() === "") continue;
      cases.push({ name: /^\/\/ case: (\S+)/.exec(part)?.[1] ?? f, source: part.replace(/^\/\/ case: .*\n/, "") });
    }
  }
  const chosen = cases.filter((_, i) => i % every === 0);

  const session = cachedSession();
  function bunVerdict(source: string): { verdict: string; message: string } {
    const compilation = newCompilation(session);
    try {
      check(compilation, parse(source, compilation.ids));
      return { verdict: "accepted", message: "" };
    } catch (e) {
      if (!(e instanceof CompileError)) return { verdict: "crashed", message: "" };
      return { verdict: `rejected ${e.code} ${e.start}`, message: formatError(e, "program.fsh", source) };
    }
  }

  const dir = mkdtempSync(join(tmpdir(), "fish-diff-"));
  const rows: Row[] = [];
  const unreached: string[] = [];
  let next = 0;

  async function worker(): Promise<void> {
    while (next < chosen.length) {
      const i = next++;
      const { name, source } = chosen[i]!;
      const path = join(dir, `p${i}.fsh`);
      writeFileSync(path, source);
      const p = Bun.spawn([binary, path], { stdout: "pipe", stderr: "pipe" });
      const timer = setTimeout(() => p.kill(9), 120_000);
      const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      const exit = await p.exited;
      clearTimeout(timer);
      const line = out.split("\n").find((l) => l.startsWith("accepted") || l.startsWith("rejected")) ?? "";
      // A verdict counts only from a run that also finished cleanly: tearing down can crash too.
      const verdict = exit !== 0 ? "" : line;
      const native = verdict.startsWith("accepted") ? "accepted" : verdict.startsWith("rejected") ? verdict.split(" ").slice(0, 3).join(" ") : exit === 101 || err.includes("panicked at") ? "panicked" : `exit ${exit}`;
      const stop = /panicked at ([^\n]+)\n([^\n]*)/.exec(err);
      const bun = bunVerdict(source);
      if (!reached(source, bun.verdict, bun.message)) unreached.push(name);
      rows.push({ name, bun: bun.verdict, native, detail: stop ? `${stop[1]} ${stop[2]}` : line.split(" ").slice(3).join(" ") });
    }
  }
  await Promise.all(Array.from({ length: jobs }, worker));
  rmSync(dir, { recursive: true, force: true });
  return { compared: rows.length, unreached, differing: rows.filter((r) => r.bun !== r.native) };
}

if (import.meta.main) {
  const [binary, everyArg, jobsArg] = process.argv.slice(2);
  if (binary === undefined) throw new Error("usage: bun scripts/nativediff.ts <native-checker> [every-nth-program] [jobs]");
  const [every, jobs] = [Number(everyArg ?? 1), Number(jobsArg ?? 8)];
  if (!(every >= 1 && jobs >= 1)) throw new Error("every-nth-program and jobs must be at least 1");
  const { compared, unreached, differing } = await differences(binary, every, jobs);
  console.log(`${compared} programs compared, ${unreached.length} not reached by checking alone, ${differing.length} differ`);
  const groups = new Map<string, Row[]>();
  for (const r of differing) {
    const key = `${r.bun} / ${r.native} / ${r.detail.slice(0, 120)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const [key, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${String(list.length).padStart(5)}x ${key}\n       e.g. ${list.slice(0, 3).map((r) => r.name).join(", ")}`);
  }
}
