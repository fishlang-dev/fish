// Differential testing against Bun: runs each golden program that is also TypeScript under Bun and
// reports those that print something other than what the program expects of fishc.
//   fishc run scripts/differential.fsh -- [<pattern>]
//
// Opt in: nothing in the golden run or `fishc test` runs this, and nothing else here runs Bun. It
// needs `bun` on PATH, and its answers are those of the Bun it finds, whose version it prints.
//
// A program is compared when it states only what it prints: `expect:` lines and none of `error:`,
// `panic:`, `fails:`, `stderr:`, `stdin:`, `link:` or `mode: parse`, and it is a file or a case of
// one, not a directory. It is written out as a `.ts` file whose `console.log` prints as Node's
// does, which is what fishc follows, with a call of its `main`, and run where the golden runner
// runs it. A program Bun refuses, or that ends in an error or runs past its limit there, is not
// TypeScript as far as this goes, and is only counted.
//
// `tests/differential.txt` lists the programs known to print something else, each under a
// `## <why>` line. A program that differs and isn't listed fails the run, and so does one listed
// that prints the same again or is gone, so the list stays true. A pattern keeps the programs
// whose name contains it.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { binaryName, directive, environment, programsOf, ran, type Program } from "../tests/harness.fsh";

const PREAMBLE = 'import { formatWithOptions as __format } from "node:util";\nconsole.log = (...values: unknown[]) => { process.stdout.write(__format({}, ...values) + "\\n"); };\n';
// The directives that state more than what a program prints.
const UNCOMPARED = ["error", "panic", "fails", "stderr", "stdin", "link"];
const LIMIT = 10000;

function compared(src: string): boolean {
  if (src.includes("// mode: parse") || directive(src, "expect").length === 0) return false;
  return !UNCOMPARED.some((key) => directive(src, key).length > 0);
}

function declaresMain(src: string): boolean {
  return src.split("\n").some((line) => /^(export )?(async )?function main\(/.test(line));
}

// The programs the list names, each with the reason it is under.
function listed(text: string): Map<string, string> {
  let out = new Map<string, string>();
  let why = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("## ")) why = line.slice(3);
    else if (line !== "" && !line.startsWith("#")) out.set(line, why);
  }
  return out;
}

// The first line two outputs disagree on, as Bun printed it and as the program expects it.
function firstDifference(got: string, expected: string): string {
  const a = got.split("\n");
  const b = expected.split("\n");
  let i = 0;
  while (i < a.length && i < b.length && a[i]! === b[i]!) i++;
  return `  bun:  ${i < a.length ? a[i]! : "<nothing>"}\n  fish: ${i < b.length ? b[i]! : "<nothing>"}`;
}

async function main(): Promise<void> throws IoError {
  const pattern = process.argv.length > 2 ? process.argv[2]! : "";
  const root = join(import.meta.dir, "..");
  const dir = join(root, "tests", "programs");
  const env = environment("NO_COLOR");
  let version = "";
  try {
    const asked = await ran(["bun", "--version"], root, env.clone(), null, LIMIT);
    if (asked.exitCode === 0) version = asked.stdout.trim();
  } catch (_e) {}
  if (version === "") {
    console.error("differential: this compares fishc's programs with Bun's answers, and 'bun' isn't on PATH");
    process.exit(2);
  }
  const allowed = listed(readFileSync(join(root, "tests", "differential.txt"), "utf8"));
  const tmp = mkdtempSync(join(tmpdir(), "fish-differential-"));
  const started = performance.now();
  let entries = readdirSync(dir).filter((f) => f.endsWith(".fsh"));
  entries.sort();
  let seen = new Set<string>();
  let same = 0;
  let differ = 0;
  let other = 0;
  let uncompared = 0;
  let unexpected: string[] = [];
  let stale: string[] = [];
  for (const entry of entries) {
    for (const p of programsOf(dir, tmp, entry)) {
      if (!p.name.includes(pattern)) continue;
      seen.add(p.name);
      if (p.problem !== "" || !compared(p.src)) {
        uncompared++;
        continue;
      }
      const folder = join(tmp, "ts", binaryName(p.name));
      mkdirSync(folder, { recursive: true });
      const file = join(folder, "main.ts");
      writeFileSync(file, PREAMBLE + p.src + (declaresMain(p.src) ? "\nawait main();\n" : "\n"));
      const run = await ran(["bun", "run", file], root, env.clone(), null, LIMIT);
      if (run.timedOut || run.exitCode !== 0 || run.signal !== "") {
        other++;
        continue;
      }
      let expected = "";
      for (const line of directive(p.src, "expect")) expected += line + "\n";
      if (run.stdout === expected) {
        same++;
        if (allowed.has(p.name)) stale.push(`${p.name}: listed, but it prints the same under Bun now`);
      } else if (allowed.has(p.name)) differ++;
      else unexpected.push(`${p.name}\n${firstDifference(run.stdout, expected)}`);
    }
  }
  // A listed program that wasn't run at all is gone, renamed, or no longer compared.
  if (pattern === "") for (const name of allowed.keys()) if (!seen.has(name)) stale.push(`${name}: listed, but no such program`);
  for (const u of unexpected) console.log(`differs ${u}\n`);
  for (const s of stale) console.log(`stale ${s}\n`);
  const seconds = ((performance.now() - started) / 1000).toFixed(0);
  console.log(`bun ${version}: ${same} same, ${differ} differ as listed, ${unexpected.length} differ unlisted, ${stale.length} stale, ${other} not TypeScript, ${uncompared} not compared, in ${seconds}s`);
  if (unexpected.length > 0 || stale.length > 0) process.exit(1);
}
