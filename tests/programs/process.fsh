// case: process_exit_nested
// expect: before
function stop() { process.exit(0); }
function main() {
  console.log("before");
  stop();
}
// case: process_exit_async
// expect: started
async function work(): Promise<void> {
  console.log("started");
  process.exit(0);
}
async function main(): Promise<void> {
  await work();
  console.log("never");
}
// case: process_imports
// expect: true true
import process from "node:process";
import { env } from "process";
function main() {
  console.log(process.argv.length >= 2, env("FISH_NOT_SET_ANYWHERE") === null);
}
// case: process_env_write
// error: setting 'process.env' isn't supported yet; it is read-only here
function main() {
  process.env.X = "y";
}
// case: process_env_whole
// error: 'process.env' is read by key, as in 'process.env.HOME' or 'process.env[name]'
function main() {
  const all = process.env;
}
// case: process_exit_code_type
// error: is not assignable to parameter of type 'i64'
function main() {
  process.exit("1");
}
// case: process_unknown_member
// error: 'node:process' has no export named 'ppid'
import process from "node:process";
function main() {
  console.log(process.ppid);
}
// case: process_named_values
// expect: true true true
import { argv, env } from "node:process";
function count(argv: string[]): usize { return argv.length; }
function main() {
  const all = argv;
  console.log(all.length === argv.length, env.FISH_NOT_SET_ANYWHERE === null, count(["x"]) === 1);
}
// case: process_named_table_whole
// error: 'env' is read by key, as in 'env.HOME' or 'env[name]'
import { env } from "node:process";
function main() {
  const e = env;
}
// case: process_platform_arch
// expect: true true true true
import { platform } from "node:process";
function main() {
  const p = process.platform;
  const a = process.arch;
  console.log(p === "darwin" || p === "linux", a === "arm64" || a === "x64", platform === p, process.execPath === process.argv[0]);
}
// case: process_env_entries
// The runner sets FISH_LEAKS=1 in the environment it runs programs with.
// expect: 1 true true
function main() {
  const all = Object.entries(process.env);
  let leaks = "";
  for (const [k, v] of all) if (k === "FISH_LEAKS") leaks = v;
  const keys = Object.keys(process.env);
  console.log(leaks, keys.includes("FISH_LEAKS"), keys.length === all.length);
}
// case: process_signal_listeners
// A listener stops a signal ending the program, runs once per delivery, and doesn't keep the
// program running after main returns.
// expect: once
// expect: 3
// expect: kill() failed: ESRCH: No such process ESRCH kill
async function main(): Promise<void> throws IoError {
  const { promise: got, resolve } = Promise.withResolvers<string>();
  process.once("SIGUSR1", () => resolve("once"));
  const count = shared({ n: new Atomic(0) });
  const counting = count.clone();
  process.on("SIGUSR2", () => { counting.n.add(1); });
  process.kill(process.pid, "SIGUSR1");
  const first = await got;
  console.log(first);
  for (let i = 0; i < 3; i++) {
    process.kill(process.pid, "SIGUSR2");
    await sleep(30);
  }
  console.log(count.n.load());
  try {
    process.kill(999999, 0);
  } catch (e) {
    console.log(e.message, e.code, e.syscall);
  }
}
// case: process_signals_generator
// expect: SIGHUP
// expect: SIGUSR1
import { signals } from "node:process";
async function main(): Promise<void> throws IoError {
  let seen = signals("SIGHUP", "SIGUSR1");
  process.kill(process.pid, "SIGHUP");
  const a = await seen.next();
  if (a.done === false) console.log(a.value);
  process.kill(process.pid, "SIGUSR1");
  const b = await seen.next();
  if (b.done === false) console.log(b.value);
}
// case: process_cwd_chdir
// expect: true true
// expect: true
// expect: ENOENT: no such file or directory, chdir '/' -> '/fish-no-such-dir' ENOENT chdir /
// The working directory is the process's, so path.resolve sees a change made by chdir.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { resolve } from "node:path";
function main(): void throws IoError {
  const start = process.cwd();
  const dir = realpathSync(mkdtempSync("/tmp/fish-cwd-"));
  process.chdir(dir);
  console.log(process.cwd() === dir, resolve("a") === dir + "/a");
  process.chdir("..");
  console.log(process.cwd() === realpathSync("/tmp"));
  process.chdir("/");
  try {
    process.chdir("/fish-no-such-dir");
  } catch (e) {
    console.log(e.message, e.code, e.syscall, e.path);
  }
  process.chdir(start);
  rmSync(dir, { recursive: true });
}
// case: process_stdout_write
// expect: ab c
// expect: true
function main() {
  process.stdout.write("a");
  process.stdout.write("b ");
  console.log("c");
  console.log(process.stdout.write(""));
}
// case: process_stderr_write
// stderr: one two
// stderr: three
function main() {
  process.stderr.write("one ");
  console.error("two");
  process.stderr.write("three\n");
}
// case: process_stdout_write_bytes
// expect: héllo
import { stdout } from "node:process";
function main() {
  const bytes: u8[] = new TextEncoder().encode("hé");
  stdout.write(bytes);
  process.stdout.write(Buffer.from("llo\n"));
}
// case: process_stdout_write_panic
// expect: kept
// panic: stop
function main() {
  process.stdout.write("kept\n");
  assert(false, "stop");
}
// case: process_stdout_write_task
// expect: from task
// expect: done
async function task(): Promise<void> {
  process.stdout.write("from ");
  process.stdout.write("task\n");
}
async function main(): Promise<void> {
  const t = spawn(task());
  await t;
  process.stdout.write("done\n");
}
// case: process_stdout_unsupported
// error: 'process.stdout.columns' isn't supported yet; Fish's streams have 'write(chunk)' and 'isTTY'
function main() {
  const width = process.stdout.columns;
}
// case: process_stream_is_tty
// expect: false
// expect: false
function main() {
  console.log(process.stdout.isTTY);
  console.log(process.stderr.isTTY);
}
