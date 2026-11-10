// Every error in an LLVM IR file at once, where clang stops at the first: splits it into chunks of
// functions, each declaring the functions it leaves out, and compiles the chunks in parallel. A
// failing function is swapped for its declaration and its chunk compiled again.
// Usage: bun scripts/irsplit.ts file.ll [chunks] [jobs]
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Fn = { name: string; declared: string; lines: string[] };

// `define internal T @f(T %a) attrs {` as `declare T @f(T %a)`.
function declaration(line: string): string {
  const name = /@("[^"]+"|[\w.$]+)\(/.exec(line)!;
  const at = name.index;
  let depth = 0;
  // A quoted name may itself hold parentheses, so the list is looked for after it.
  let end = at + name[0].length - 1;
  for (; end < line.length; end++) {
    if (line[end] === "(") depth++;
    else if (line[end] === ")" && --depth === 0) break;
  }
  const head = line.slice("define ".length, at).replace(/\b(internal|private|linkonce_odr|weak|hidden|dso_local|protected)\b\s*/g, "");
  return `declare ${head}${line.slice(at, end + 1)}`;
}

const [file, chunksArg, jobsArg] = process.argv.slice(2);
if (file === undefined) throw new Error("usage: bun scripts/irsplit.ts file.ll [chunks] [jobs]");
const chunks = Number(chunksArg ?? 24);
const jobs = Number(jobsArg ?? 6);
const lines = readFileSync(file, "utf8").split("\n");
const header: string[] = [];
const fns: Fn[] = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i]!;
  if (!line.startsWith("define ")) {
    header.push(line);
    continue;
  }
  let close = i;
  while (lines[close] !== "}") close++;
  fns.push({ name: /@("[^"]+"|[\w.$]+)\(/.exec(line)?.[1] ?? line.slice(0, 80), declared: declaration(line), lines: lines.slice(i, close + 1) });
  i = close;
}
console.log(`${fns.length} functions in ${chunks} chunks, ${jobs} at a time`);

const dir = mkdtempSync(join(tmpdir(), "irsplit-"));
const errors: string[] = [];

async function compileChunk(chunk: number): Promise<void> {
  const bad = new Set<Fn>();
  const path = join(dir, `c${chunk}.ll`);
  for (;;) {
    const out = [...header];
    const starts = new Map<number, Fn>();
    fns.forEach((f, i) => {
      if (i % chunks !== chunk || bad.has(f)) return void out.push(f.declared);
      starts.set(out.length + 1, f);
      out.push(...f.lines);
    });
    writeFileSync(path, out.join("\n"));
    const p = Bun.spawn(["clang", "-c", "-x", "ir", path, "-o", "/dev/null", "-O0", "-w"], { stderr: "pipe" });
    const stderr = await new Response(p.stderr).text();
    if ((await p.exited) === 0) return;
    const m = /\.ll:(\d+):\d+: error: (.*)/.exec(stderr);
    if (m === null) return void errors.push(`chunk ${chunk}: ${stderr.split("\n").slice(0, 3).join(" ")}`);
    const line = Number(m[1]);
    const hit = [...starts].find(([start, f]) => start <= line && line < start + f.lines.length)?.[1];
    if (hit === undefined) return void errors.push(`chunk ${chunk}, outside any function, line ${line}: ${m[2]} | ${out[line - 1]?.slice(0, 160)}`);
    errors.push(`${hit.name}: ${m[2]} | ${out[line - 1]?.trim().slice(0, 160)}`);
    bad.add(hit);
  }
}

let next = 0;
await Promise.all(Array.from({ length: jobs }, async () => {
  while (next < chunks) await compileChunk(next++);
}));
rmSync(dir, { recursive: true, force: true });
console.log(`${errors.length} error(s)`);
for (const e of errors) console.log(`  ${e}`);
