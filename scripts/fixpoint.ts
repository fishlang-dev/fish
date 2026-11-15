// The bootstrap fixpoint: Bun builds the compiler's own source into a native fishc, that fishc
// builds the source again, and that one again, each generation printing the source's IR. The
// second and third generations' IR must be identical. `--from <fishc>` starts from a generation 1
// already built, and `--out <dir>` keeps the mirror, binaries and IR there. Run by hand: a chain
// takes about an hour.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { build } from "../src/main.ts";
import { cachedSession } from "../src/stdcache.ts";
import { mirrored } from "./selfhost.ts";

const { values } = parseArgs({ options: { from: { type: "string" }, out: { type: "string" } } });
const root = join(import.meta.dir, "..");
const out = values.out ?? mkdtempSync(join(tmpdir(), "fish-fixpoint-"));
const src = join(out, "src");
mkdirSync(src, { recursive: true });
try {
  symlinkSync(join(root, "vendor"), join(out, "vendor"));
} catch {}
for (const f of readdirSync(join(root, "src"))) if (f.endsWith(".ts") && !f.endsWith(".d.ts")) mirrored(join(root, "src", f), src);

function timed<T>(label: string, f: () => T): T {
  const started = performance.now();
  const result = f();
  console.log(`${label} in ${((performance.now() - started) / 1000).toFixed(0)}s`);
  return result;
}

function run(fishc: string, args: string[]): string {
  const r = Bun.spawnSync([fishc, "build", "main.fsh", "--release", ...args], { cwd: src, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${fishc} build ${args.join(" ")} exited with ${r.exitCode}:\n${r.stderr.toString().slice(0, 4000)}`);
  return r.stdout.toString();
}

// The first lines at which two IR texts differ, with a little context.
function firstDifference(a: string, b: string): string | null {
  if (a === b) return null;
  const as = a.split("\n");
  const bs = b.split("\n");
  let i = 0;
  while (i < as.length && i < bs.length && as[i] === bs[i]) i++;
  const near = (xs: string[]) => xs.slice(Math.max(0, i - 2), i + 3).map((l) => "  " + l.slice(0, 300)).join("\n");
  return `line ${i + 1} of ${as.length} against ${bs.length}:\n${near(as)}\n---\n${near(bs)}`;
}

let gen1 = values.from;
if (gen1 === undefined) {
  gen1 = join(out, "gen1");
  const errors = timed("generation 1 built by Bun", () => build(cachedSession(), join(src, "main.fsh"), gen1!, true));
  if (errors.length > 0) throw new Error(errors.map((e) => e.message).join("\n"));
}
const ir: string[] = [];
let fishc = gen1;
for (let gen = 1; gen <= 3; gen++) {
  ir.push(timed(`generation ${gen} printed the IR`, () => run(fishc, ["--emit-llvm"])));
  writeFileSync(join(out, `gen${gen}.ll`), ir[gen - 1]!);
  if (gen === 3) break;
  const next = join(out, `gen${gen + 1}`);
  timed(`generation ${gen + 1} built by generation ${gen}`, () => run(fishc, ["-o", next]));
  fishc = next;
}
const native = firstDifference(ir[0]!, ir[1]!);
console.log(native === null ? "generations 1 and 2 emit identical IR" : `generations 1 and 2 differ at ${native}`);
const fixpoint = firstDifference(ir[1]!, ir[2]!);
console.log(fixpoint === null ? `fixpoint: generations 2 and 3 emit identical IR (${readFileSync(join(out, "gen3.ll")).length} bytes)` : `no fixpoint: generations 2 and 3 differ at ${fixpoint}`);
console.log(`kept in ${out}`);
process.exit(fixpoint === null ? 0 : 1);
