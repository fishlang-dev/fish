// What the golden runner and the differential script share: a test program and its directives,
// the cases of a file, and running a command under a time limit.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// A test's program: a file, a directory's `main.fsh`, or a case of a file, written out as its own
// file; or what is wrong with a file's cases.
export type Program = { name: string; label: string; file: string; src: string; problem: string };

// What building and running a program gave: the build's printed errors, or its warnings and how
// the program ended.
export type Outcome = { failed: boolean; printed: string; warnings: string[]; stdout: string; stderr: string; exitCode: i64; signal: string; timedOut: boolean };

const DIRECTIVES = ["expect", "error", "warning", "panic", "fails", "stderr", "mode", "link", "stdin"];

// Every value a directive takes in a source, in order: the rest of each line after `// <key>: `.
export function directive(src: string, key: string): string[] {
  const marker = `// ${key}: `;
  let found: string[] = [];
  for (const line of src.split("\n")) {
    const at = line.indexOf(marker);
    if (at >= 0) found.push(line.slice(at + (marker.length as i64)));
  }
  return found;
}

function isDirective(line: string): boolean {
  return DIRECTIVES.some((key) => line.startsWith(`// ${key}: `));
}

// A case's name is letters, digits, '_' and '-'.
function isName(name: string): boolean {
  if (name === "") return false;
  for (const c of name) if (!/^[\w-]$/.test(c)) return false;
  return true;
}

// A test's name made safe as a file name, as the runner names each program's binary.
export function binaryName(name: string): string {
  const bare = name.endsWith(".fsh") ? name.slice(0, (name.length as i64) - 4) : name;
  let out = "";
  let run = false;
  for (const c of bare) {
    if (/^[\w.-]$/.test(c)) {
      out += c;
      run = false;
    } else if (!run) {
      out += "_";
      run = true;
    }
  }
  return out;
}

export function programsOf(dir: string, tmp: string, entry: string): Program[] throws IoError {
  const file = entry.endsWith(".fsh") ? join(dir, entry) : join(dir, entry, "main.fsh");
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  if (!entry.endsWith(".fsh") || !lines.some((l) => l.startsWith("// case: "))) return [{ name: entry, label: entry, file, src, problem: "" }];
  const problem = (message: string, line: usize): Program[] => [{ name: entry, label: entry, file, src, problem: `${entry}:${line}: ${message}` }];
  let names: string[] = [];
  let starts: usize[] = [];
  let bodies: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("// case: ")) {
      const name = line.slice(9).trim();
      if (!isName(name)) return problem(`a case's name is letters, digits, '_' and '-', not '${name}'`, i + 1);
      if (names.includes(name)) return problem(`the case '${name}' is named twice`, i + 1);
      names.push(name);
      starts.push(i + 1);
      bodies.push([]);
    } else if (bodies.length > 0) bodies[bodies.length - 1]!.push(line);
    else if (isDirective(line)) return problem("this directive comes before the first case, so it belongs to none", i + 1);
  }
  for (let c = 0; c < names.length; c++) if (bodies[c]!.every((l) => l.trim() === "")) return problem(`the case '${names[c]!}' is empty`, starts[c]!);
  const folder = join(tmp, "cases", entry.slice(0, (entry.length as i64) - 4));
  mkdirSync(folder, { recursive: true });
  let out: Program[] = [];
  for (let c = 0; c < names.length; c++) {
    const text = bodies[c]!.join("\n");
    const path = join(folder, `${names[c]!}.fsh`);
    writeFileSync(path, text);
    out.push({ name: `${entry} > ${names[c]!}`, label: `${names[c]!}.fsh`, file: path, src: text, problem: "" });
  }
  return out;
}

export function environment(extra: string): { [name: string]: string } {
  let env: { [name: string]: string } = {};
  // A program that serves would trace to whatever collector the runner's own environment names.
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("OTEL_")) env[k] = v;
  env[extra] = "1";
  return env;
}

// Kills a child still running after its limit, recording that it timed out.
type Watch = { done: Atomic<boolean>; timedOut: Atomic<boolean> };

async function watchdog(pid: i64, ms: i64, w: shared<Watch>): Promise<void> {
  await Bun.sleep(ms);
  if (w.done.load()) return;
  w.timedOut.store(true);
  try {
    process.kill(pid, "SIGKILL");
  } catch (_e) {}
}

// Runs a command to its end, killing it after `ms`, giving its exit code, signal, output and
// whether it timed out.
export async function ran(cmd: string[], cwd: string, env: { [name: string]: string }, stdin: u8[] | null, ms: i64): Promise<Outcome> throws IoError {
  const child = stdin === null ? Bun.spawn(cmd, { cwd, env, stdout: "pipe", stderr: "pipe" }) : Bun.spawn(cmd, { cwd, env, stdin: stdin!, stdout: "pipe", stderr: "pipe" });
  const w = shared<Watch>({ done: new Atomic(false), timedOut: new Atomic(false) });
  spawn(watchdog(child.pid, ms, w.clone()));
  const code = await child.exited;
  w.done.store(true);
  let stdout = "";
  for await (const t of child.stdout) stdout += t;
  let stderr = "";
  for await (const t of child.stderr) stderr += t;
  return { failed: false, printed: "", warnings: [], stdout, stderr, exitCode: child.exitCode ?? code, signal: child.signalCode ?? "", timedOut: w.timedOut.load() };
}
