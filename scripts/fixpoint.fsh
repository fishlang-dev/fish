// The bootstrap fixpoint, with no Bun: a native fishc given with `--from` builds the compiler's own
// source into a second fishc, that one builds a third, and each prints the source's IR. The second
// and third generations' IR must be identical. `--out <dir>` keeps the mirror, binaries and IR
// there. Run by hand: a chain takes about an hour.
//   fishc run scripts/fixpoint.fsh -- --from <fishc> [--out <dir>]
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The value after `flag` in the arguments, or undefined.
function option(args: Ref<string[]>, flag: string): string | undefined {
  for (let i: usize = 0; i + 1 < args.length; i++) if (args[i]! === flag) return args[i + 1]!.clone();
  return undefined;
}

function linked(target: string, path: string): void throws IoError {
  if (lstatSync(path, { throwIfNoEntry: false }) === undefined) symlinkSync(target, path);
}

// The compiler's source as Fish in `to`, as scripts/mirror.fsh writes it, with the runtime's C
// sources inside it and vendor beside it, where a build from the mirror looks for them.
function mirror(root: string, out: string, to: string): usize throws IoError {
  const src = join(root, "src");
  mkdirSync(to, { recursive: true });
  let n: usize = 0;
  for (const f of readdirSync(src)) {
    if (!f.endsWith(".ts") || f.endsWith(".d.ts")) continue;
    const twin = join(src, f.slice(0, (f.length as i64) - 3) + ".fsh");
    const text = readFileSync(existsSync(twin) ? twin : join(src, f), "utf8");
    writeFileSync(join(to, f.slice(0, (f.length as i64) - 3) + ".fsh"), text.replace(/(["'])(\.{1,2}\/[^"']+)\.ts\1/g, "$1$2.fsh$1"));
    n++;
  }
  linked(join(src, "runtime"), join(to, "runtime"));
  linked(join(root, "vendor"), join(out, "vendor"));
  return n;
}

// Runs `fishc build main.fsh --release` in `src` with `args`, sending its stdout to `into`, and
// says how long it took; the IR runs to hundreds of megabytes, so it goes to a file, not a string.
function build(fishc: string, src: string, args: string, into: string, label: string): boolean {
  const started = performance.now();
  const r = spawnSync("sh", ["-c", `"$0" build main.fsh --release ${args} > "$1"`, fishc, into], { cwd: src });
  console.log(`${label} in ${Math.round((performance.now() - started) / 1000)}s`);
  if (r.status === 0) return true;
  console.error(`${fishc} build ${args} exited with ${r.status ?? -1}:\n${new TextDecoder().decode(r.stderr).slice(0, 4000)}`);
  return false;
}

// Where two IR files first differ, as cmp says, or undefined when they are the same.
function difference(a: string, b: string): string | undefined {
  const r = spawnSync("cmp", [a, b]);
  if (r.status === 0) return undefined;
  return new TextDecoder().decode(r.stdout).trim();
}

function main(): void throws IoError {
  const args = process.argv.slice(2);
  const from = option(args, "--from");
  if (from === undefined) {
    console.error("usage: fishc run scripts/fixpoint.fsh -- --from <fishc> [--out <dir>]");
    process.exit(2);
  }
  const root = join(import.meta.dir, "..");
  const out = option(args, "--out") ?? mkdtempSync(join(tmpdir(), "fish-fixpoint-"));
  const src = join(out, "src");
  console.log(`mirrored ${mirror(root, out, src)} files`);
  let fishc: string = from!;
  for (let gen = 1; gen <= 3; gen++) {
    if (!build(fishc, src, "--emit-llvm", join(out, `gen${gen}.ll`), `generation ${gen} printed the IR`)) process.exit(1);
    if (gen === 3) break;
    const next = join(out, `gen${gen + 1}`);
    if (!build(fishc, src, `-o "${next}"`, join(out, `gen${gen + 1}.out`), `generation ${gen + 1} built by generation ${gen}`)) process.exit(1);
    fishc = next;
  }
  const native = difference(join(out, "gen1.ll"), join(out, "gen2.ll"));
  console.log(native === undefined ? "generations 1 and 2 emit identical IR" : `generations 1 and 2 differ: ${native}`);
  const fixpoint = difference(join(out, "gen2.ll"), join(out, "gen3.ll"));
  console.log(fixpoint === undefined ? `fixpoint: generations 2 and 3 emit identical IR (${statSync(join(out, "gen3.ll")).size} bytes)` : `no fixpoint: generations 2 and 3 differ: ${fixpoint}`);
  console.log(`kept in ${out}`);
  process.exit(fixpoint === undefined ? 0 : 1);
}
