// What the unit tests share: reading files, which fails the test rather than throwing, running the
// native fishc, and reading the flags the native fishc compiles the runtime with.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// The repository's root.
export function root(): string {
  return join(import.meta.dir, "..", "..");
}

export function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    assert(false, `can't read ${path}: ${e.message}`);
    return "";
  }
}

// The fishc the CLI tests run: FISHC, else `fishc` on PATH, as tests/run.fsh picks its compiler.
export function fishcPath(): string {
  return process.env.FISHC ?? "fishc";
}

// What a fishc run gave: its exit code, -1 when a signal ended it, and its output.
export type Ran = { code: i64; out: string; err: string };

// Runs fishc with `args` in `cwd`, with `stdin` piped in when given.
export function fishc(cwd: string, args: string[], stdin?: string): Ran {
  const run = stdin === undefined ? spawnSync(fishcPath(), args, { cwd }) : spawnSync(fishcPath(), args, { cwd, input: stdin });
  const failed = run.error;
  if (failed !== null) assert(false, `can't run ${fishcPath()}: ${failed.message}`);
  const decoder = new TextDecoder();
  return { code: run.status ?? -1, out: decoder.decode(run.stdout), err: decoder.decode(run.stderr) };
}

// Fails the test with both runs shown when `got` isn't the exit code and output wanted.
export function ran(got: Ref<Ran>, code: i64, out: string, err: string, what: string): void {
  assert(got.code === code && got.out === out && got.err === err, `${what}:\n--- expected\ncode ${code}\nstdout:\n${out}\nstderr:\n${err}\n--- got\ncode ${got.code}\nstdout:\n${got.out}\nstderr:\n${got.err}`);
}

// Fails the test with both values shown when they differ.
export function same(got: string, want: string, what: string): void {
  assert(got === want, `${what}:\n--- expected\n${want}\n--- got\n${got}`);
}

// How a reference runtime answered a script: how it exited and what it wrote.
export type Answer = { status: i64; stdout: string; stderr: string };

// Node's or Bun's answer for `script`, as recorded under `key` in tests/unit/references. The tests
// run neither runtime: `run`, which does, is called only when scripts/references.fsh sets
// FISH_REFERENCES=record, and what it gives is written there. A recording made for another script
// fails the test, since its answer isn't this script's.
export function reference(key: string, script: string, run: () => Answer): Answer {
  const file = join(import.meta.dir, "references", `${key}.txt`);
  const hash = createHash("sha256").update(script).digest("hex");
  if ((process.env.FISH_REFERENCES ?? "") === "record") {
    const got = run();
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `script ${hash}\nstatus ${got.status}\nstdout ${got.stdout.length}\n${got.stdout}\nstderr ${got.stderr.length}\n${got.stderr}\n`);
    } catch (e) {
      assert(false, `can't write ${file}: ${e.message}`);
    }
    return got;
  }
  const again = "record it with 'fishc run scripts/references.fsh'";
  let recorded = "";
  try {
    recorded = readFileSync(file, "utf8");
  } catch (_e) {
    assert(false, `no reference answer is recorded for '${key}'; ${again}`);
  }
  const head = /^script ([0-9a-f]+)\nstatus (-?\d+)\nstdout (\d+)\n/.exec(recorded);
  if (head === null) {
    assert(false, `${file} isn't a recorded answer; ${again}`);
    return { status: -1, stdout: "", stderr: "" };
  }
  assert(head[1]! === hash, `the answer recorded for '${key}' is another script's; ${again}`);
  const from = head[0]!.length as i64;
  const wrote = parseInt(head[3]!) ?? 0;
  const rest = recorded.slice(from + wrote + 1);
  const tail = /^stderr (\d+)\n/.exec(rest);
  if (tail === null) {
    assert(false, `${file} isn't a recorded answer; ${again}`);
    return { status: -1, stdout: "", stderr: "" };
  }
  const start = tail[0]!.length as i64;
  return { status: parseInt(head[2]!) ?? -1, stdout: recorded.slice(from, from + wrote), stderr: rest.slice(start, start + (parseInt(tail[1]!) ?? 0)) };
}

// The key of an answer that differs between systems, as a file call's does: one recording for each.
export function onSystem(key: string): string {
  return `${key}.${process.platform}`;
}

// A command run now, as an answer to record. Only a `run` given to `reference` calls this, so the
// tests run Node and Bun only when scripts/references.fsh asks.
export function ranFor(command: string, args: string[], cwd?: string): Answer {
  const run = cwd === undefined ? spawnSync(command, args) : spawnSync(command, args, { cwd });
  const failed = run.error;
  if (failed !== null) assert(false, `can't run ${command}: ${failed.message}`);
  return { status: run.status ?? -1, stdout: text(run.stdout), stderr: text(run.stderr) };
}

// The CPU time this process has used, in microseconds.
declare function clock(): i64;

// Fails the test unless `run` takes time linear in the size it is given: under 3.2 times as long
// for 2n as for n, where linear work takes about 2 and quadratic about 4. A ratio holds on a machine
// of any speed, which a limit in milliseconds doesn't. The time is the process's own, so tests
// running beside it don't add to it, and each is the fastest of three runs.
export function linear(n: usize, run: (size: usize) => void): void {
  let small: i64 = 0;
  let large: i64 = 0;
  for (let round = 0; round < 3; round++) {
    const started = unsafe { clock() };
    run(n);
    const half = unsafe { clock() };
    run(2 * n);
    const done = unsafe { clock() };
    if (round === 0 || half - started < small) small = half - started;
    if (round === 0 || done - half < large) large = done - half;
  }
  assert(large * 10 < small * 32, `size ${2 * n} took ${large / 1000}ms and size ${n} took ${small / 1000}ms, over 3.2 times as long`);
}

// Bytes as UTF-8 text.
export function text(bytes: Ref<u8[]>): string {
  return new TextDecoder().decode(bytes);
}

// A fresh directory under the system's temporary one, by its real path.
export function scratch(prefix: string): string {
  try {
    return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  } catch (e) {
    assert(false, `can't make a directory: ${e.message}`);
    return "";
  }
}

// Removes a directory `scratch` made.
export function removed(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (_e) {}
}

// Builds `source` as the program `name` in `dir` with the native fishc, giving the executable's
// path and failing the test when the build prints anything.
export function built(dir: string, name: string, source: string): string {
  const program = join(dir, `${name}.fsh`);
  try {
    writeFileSync(program, source);
  } catch (e) {
    assert(false, `can't write ${program}: ${e.message}`);
  }
  const out = join(dir, name);
  const run = fishc(dir, ["build", program, "-o", out]);
  same(run.err, "", `building ${name}`);
  assert(run.code === 0, `building ${name} exited with ${run.code}`);
  return out;
}

// A TCP port on 127.0.0.1 that was free a moment ago, asked of a Node child process, for a server
// that can't report the port it bound.
export function freePort(): i64 {
  const script = `const s = require("node:net").createServer().listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); });`;
  const run = spawnSync("node", ["-e", script]);
  const port = parseInt(text(run.stdout).trim());
  assert(port !== null, `no free port: ${text(run.stderr)}`);
  return port;
}

// The arguments the native fishc gives clang to compile the runtime, before its output, for a build
// of `file` with `flags` and a cache of its own under `root`, and the name of the object it was to
// write, its hash left out. A clang on PATH logs each runtime compile and fails it, so nothing is
// compiled and the build stops there.
export function runtimeArgs(root: string, file: string, flags: string[]): [string, string] {
  const bin = join(root, "shim");
  const log = join(root, "clang.log");
  try {
    writeFileSync(log, "");
    mkdirSync(bin, { recursive: true });
    const clang = Bun.which("clang");
    assert(clang !== null, "no clang on PATH");
    writeFileSync(join(bin, "clang"), `#!/bin/sh\ncase " $* " in\n  *" -x c - "*" -c -o "*) echo "$*" >> ${JSON.stringify(log)}; exit 1 ;;\nesac\nexec ${JSON.stringify(clang!)} "$@"\n`);
    chmodSync(join(bin, "clang"), 0o755);
  } catch (e) {
    assert(false, `can't make the clang shim: ${e.message}`);
  }
  const cache = join(root, `cache-${flags.join("")}`);
  spawnSync("env", [`FISH_CACHE_DIR=${cache}`, `PATH=${bin}:${process.env.PATH ?? ""}`, fishcPath(), "build", file, "-o", join(root, "main"), ...flags]);
  const lines = read(log).split("\n").filter((l) => l !== "");
  assert(lines.length === 1, `the runtime compiles logged:\n${lines.join("\n")}`);
  const at = lines[0].indexOf(" -c -o ");
  const object = lines[0].slice((at + 7) as i64).split("/").at(-1)!;
  const m = /^(.*)-[0-9a-f]{16}\.o/.exec(object);
  assert(m !== null, `the runtime's object: ${object}`);
  const name = m![1];
  return [lines[0].slice(0, at as i64), name];
}
