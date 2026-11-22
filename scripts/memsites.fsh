// What fishc holds live as a stage ends, by function and by allocation site, largest first. Runs a
// `--leaks` build of fishc with FISH_MEM_STOP naming the stage, so it ends there, and reads the
// report its runtime prints at exit. Bytes are what was asked for: a `--leaks` build adds a header
// to each block, so the process is resident at more than the total here.
//   fishc run scripts/build.fsh -- --leaks -o build/fishc-leaks
//   fishc run scripts/memsites.fsh -- <parse|check|codegen> [--fishc <path>] [--top <n>] <fishc arguments>
// as in `fishc run scripts/memsites.fsh -- check check src/main.fsh`.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { byFunction, largest, sites, total, type Report, type Row } from "./sites.fsh";

const ROOT = resolve(import.meta.dir, "..");
const USAGE = "usage: fishc run scripts/memsites.fsh -- <parse|check|codegen> [--fishc <path>] [--top <n>] <fishc arguments>";

function fail(message: string): never {
  console.error(`memsites: ${message}`);
  return process.exit(1);
}

function mib(bytes: usize): string {
  return `${((bytes as f64) / 1048576).toFixed(1)} MiB`;
}

// The first `top` of `rows`, one per line under `title`.
function table(title: string, rows: Ref<Row[]>, top: usize): string {
  let out = `\n${title}\n${"bytes".padStart(14)}${"count".padStart(11)}  where\n`;
  for (let i: usize = 0; i < rows.length && i < top; i++) {
    const r: Ref<Row> = rows[i]!;
    const where = r.site === "" ? r.name : `${r.site} in ${r.name}`;
    out += `${`${r.bytes}`.padStart(14)}${`${r.count}`.padStart(11)}  ${where}\n`;
  }
  if (rows.length > top) out += `${"".padStart(25)}  and ${rows.length - top} more\n`;
  return out;
}

function main(): void throws IoError {
  const args = process.argv.slice(2);
  const stage = args.length > 0 ? args[0]! : "";
  if (stage !== "parse" && stage !== "check" && stage !== "codegen") fail(USAGE);
  let fishc = join(ROOT, "build", "fishc-leaks");
  let top: usize = 30;
  let at: usize = 1;
  while (at + 1 < args.length && (args[at]! === "--fishc" || args[at]! === "--top")) {
    if (args[at]! === "--fishc") fishc = resolve(args[at + 1]!);
    else if (/^\d+$/.test(args[at + 1]!)) top = Number(args[at + 1]!)! as usize;
    else fail(`--top takes a number, not '${args[at + 1]!}'`);
    at += 2;
  }
  const rest = args.slice(at as i64);
  if (rest.length === 0) fail(USAGE);
  if (!existsSync(fishc)) fail(`no ${fishc}; build it with 'fishc run scripts/build.fsh -- --leaks -o build/fishc-leaks'`);

  // `env` adds the one variable to this process's environment, which fishc needs the rest of.
  const ran = Bun.spawnSync(["env", `FISH_MEM_STOP=${stage}`, fishc, ...rest], { stdout: "inherit" });
  const text = new TextDecoder().decode(ran.stderr);
  let report: Report | undefined = undefined;
  try {
    report = sites(text);
  } catch (e) {
    process.stderr.write(text);
    fail(`${(e as { message: string }).message}; is ${fishc} a '--leaks' build, and does '${rest.join(" ")}' reach the ${stage} stage?`);
  }
  const read = report!;
  process.stderr.write(`${read.before}\n`);
  const summed = total(read.rows);
  if (summed !== read.bytes) fail(`the report's rows hold ${summed} bytes, and its own total is ${read.bytes}`);
  console.log(`live after ${stage}: ${read.count} allocations, ${read.bytes} bytes (${mib(read.bytes)}), at ${read.rows.length} sites`);
  const functions = largest(byFunction(read.rows));
  process.stdout.write(table("by function", functions, top));
  process.stdout.write(table("by site", largest(read.rows), top));
}
