// Compares the native checker with the Bun one: each test program checked by both, reporting those
// where they differ on accepting it or on the error code, and the native panics by where they stop.
// Usage: bun scripts/nativediff.ts <native-checker> [every-nth-program] [jobs]
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "../src/check.ts";
import { newCompilation } from "../src/compilation.ts";
import { parse } from "../src/parser.ts";
import { cachedSession } from "../src/stdcache.ts";

const [binary, everyArg, jobsArg] = process.argv.slice(2);
if (binary === undefined) throw new Error("usage: bun scripts/nativediff.ts <native-checker> [every-nth-program] [jobs]");
const every = Number(everyArg ?? 1);
const jobs = Number(jobsArg ?? 8);

const programs = join(import.meta.dir, "..", "tests", "programs");
const cases: { name: string; source: string }[] = [];
for (const f of readdirSync(programs).filter((n) => n.endsWith(".fsh")).sort()) {
  for (const part of readFileSync(join(programs, f), "utf8").split(/^(?=\/\/ case: )/m)) {
    if (/^\/\/ mode: parse/m.test(part) || part.trim() === "") continue;
    cases.push({ name: /^\/\/ case: (\S+)/.exec(part)?.[1] ?? f, source: part });
  }
}
const chosen = cases.filter((_, i) => i % every === 0);

const session = cachedSession();
function bunVerdict(source: string): string {
  const compilation = newCompilation(session);
  try {
    check(compilation, parse(source, compilation.ids));
    return "accepted";
  } catch (e) {
    const code = (e as { code?: string }).code;
    return code !== undefined ? `rejected ${code}` : "crashed";
  }
}

const dir = mkdtempSync(join(tmpdir(), "fish-diff-"));
type Row = { name: string; bun: string; native: string; detail: string };
const rows: Row[] = [];
let next = 0;

async function worker(): Promise<void> {
  while (next < chosen.length) {
    const i = next++;
    const { name, source } = chosen[i]!;
    const path = join(dir, `p${i}.fsh`);
    writeFileSync(path, source);
    const p = Bun.spawn([binary!, path], { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => p.kill(9), 120_000);
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const exit = await p.exited;
    clearTimeout(timer);
    const line = out.split("\n").find((l) => l.startsWith("accepted") || l.startsWith("rejected")) ?? "";
    const native = line.startsWith("accepted") ? "accepted" : line.startsWith("rejected") ? line.split(" ").slice(0, 2).join(" ") : exit === 101 || err.includes("panicked at") ? "panicked" : `exit ${exit}`;
    const stop = /panicked at ([^\n]+)\n([^\n]*)/.exec(err);
    rows.push({ name, bun: "", native, detail: stop ? `${stop[1]} ${stop[2]}` : line.split(" ").slice(2).join(" ") });
    rows[rows.length - 1]!.bun = bunVerdict(source);
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
rmSync(dir, { recursive: true, force: true });

const differing = rows.filter((r) => r.bun !== r.native);
console.log(`${rows.length} programs: ${rows.length - differing.length} agree, ${differing.length} differ`);
const groups = new Map<string, Row[]>();
for (const r of differing) {
  const key = `${r.bun} / ${r.native} / ${r.detail.slice(0, 120)}`;
  groups.set(key, [...(groups.get(key) ?? []), r]);
}
for (const [key, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(list.length).padStart(5)}x ${key}\n       e.g. ${list.slice(0, 3).map((r) => r.name).join(", ")}`);
}
