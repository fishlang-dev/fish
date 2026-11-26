// What fishc holds live as a stage ends, by function and by allocation site, largest first. Runs a
// `--leaks` build of fishc with FISH_MEM_STOP naming the stage, so it ends there, and reads the
// report its runtime prints at exit. Bytes are what was asked for: a `--leaks` build adds a header
// to each block, so the process is resident at more than the total here.
//   fishc run scripts/build.fsh -- --leaks -o build/fishc-leaks
// `--json <path>` also writes every row to a snapshot, and `--diff` compares two snapshots, runs no
// fishc, and prints what changed by function and by site, the largest change first.
//   fishc run scripts/memsites.fsh -- <parse|check|codegen> [--fishc <path>] [--top <n>] [--json <path>] <fishc arguments>
//   fishc run scripts/memsites.fsh -- --diff <before.json> <after.json> [--top <n>]
// as in `fishc run scripts/memsites.fsh -- check check src/main.fsh`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { changes, readSnapshot, sites, snapshot, snapshotJson, total, type Change, type Report, type Row, type Snapshot } from "./sites.fsh";

const ROOT = resolve(import.meta.dir, "..");
const USAGE = "usage: fishc run scripts/memsites.fsh -- <parse|check|codegen> [--fishc <path>] [--top <n>] [--json <path>] <fishc arguments>\n       fishc run scripts/memsites.fsh -- --diff <before.json> <after.json> [--top <n>]";

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

function signed(n: i64): string {
  return n > 0 ? `+${n}` : `${n}`;
}

// The first `top` of `rows`, one per line under `title`: bytes before and after, and the change.
function diffTable(title: string, rows: Ref<Change[]>, top: usize): string {
  let out = `\n${title}\n${"before".padStart(14)}${"after".padStart(14)}${"bytes".padStart(14)}${"count".padStart(11)}  where\n`;
  for (let i: usize = 0; i < rows.length && i < top; i++) {
    const c: Ref<Change> = rows[i]!;
    const where = c.site === "" ? c.name : `${c.site} in ${c.name}`;
    out += `${`${c.before}`.padStart(14)}${`${c.after}`.padStart(14)}${signed(c.bytes).padStart(14)}${signed(c.count).padStart(11)}  ${where}\n`;
  }
  if (rows.length > top) out += `${"".padStart(53)}  and ${rows.length - top} more\n`;
  return out;
}

function snapshotAt(path: string): Snapshot throws IoError {
  if (!existsSync(path)) fail(`no snapshot at ${path}; write one with --json <path>`);
  try {
    return readSnapshot(readFileSync(path, "utf8"));
  } catch (e) {
    return fail(`${path}: ${(e as { message: string }).message}`);
  }
}

function diff(before: string, after: string, top: usize): void throws IoError {
  const a = snapshotAt(before);
  const b = snapshotAt(after);
  const bytes = (b.bytes as i64) - (a.bytes as i64);
  const count = (b.count as i64) - (a.count as i64);
  console.log(`live after ${a.stage}: ${a.count} allocations, ${a.bytes} bytes (${mib(a.bytes)}), at ${a.sites.length} sites`);
  console.log(`live after ${b.stage}: ${b.count} allocations, ${b.bytes} bytes (${mib(b.bytes)}), at ${b.sites.length} sites`);
  console.log(`change: ${signed(bytes)} bytes (${bytes < 0 ? "-" : bytes > 0 ? "+" : ""}${mib((bytes < 0 ? -bytes : bytes) as usize)}), ${signed(count)} allocations`);
  process.stdout.write(diffTable("by function", changes(a.functions, b.functions), top));
  process.stdout.write(diffTable("by site", changes(a.sites, b.sites), top));
}

function main(): void throws IoError {
  const args = process.argv.slice(2);
  const stage = args.length > 0 ? args[0]! : "";
  const diffing = stage === "--diff";
  if (!diffing && stage !== "parse" && stage !== "check" && stage !== "codegen") fail(USAGE);
  let fishc = join(ROOT, "build", "fishc-leaks");
  let top: usize = 30;
  let json = "";
  let at: usize = diffing ? 3 : 1;
  if (diffing && args.length < 3) fail(USAGE);
  while (at + 1 < args.length && (args[at]! === "--fishc" || args[at]! === "--top" || args[at]! === "--json")) {
    if (args[at]! === "--fishc") fishc = resolve(args[at + 1]!);
    else if (args[at]! === "--json") json = resolve(args[at + 1]!);
    else if (/^\d+$/.test(args[at + 1]!)) top = Number(args[at + 1]!)! as usize;
    else fail(`--top takes a number, not '${args[at + 1]!}'`);
    at += 2;
  }
  if (diffing) {
    if (at !== args.length || fishc !== join(ROOT, "build", "fishc-leaks") || json !== "") fail(USAGE);
    diff(resolve(args[1]!), resolve(args[2]!), top);
    return;
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
  const s = snapshot(stage, read);
  if (json !== "") writeFileSync(json, snapshotJson(s));
  process.stdout.write(table("by function", s.functions, top));
  process.stdout.write(table("by site", s.sites, top));
}
