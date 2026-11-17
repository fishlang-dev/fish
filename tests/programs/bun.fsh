// case: bun_global_values
// expect: 1.4.3 true true true
function main() {
  console.log(Bun.version, Bun.argv.length === process.argv.length, Bun.env.FISH_NOT_SET_ANYWHERE === null, Bun.env["PATH"] === process.env.PATH);
}
// case: bun_imports
// expect: true /bin/sh
import { which, env } from "bun";
import * as B from "bun";
function main() {
  console.log(env.FISH_NOT_SET_ANYWHERE === null, which("sh") === B.which("sh") ? "/bin/sh" : "differs");
}
// case: bun_file_text
// expect: 5 héllo true
async function main(): Promise<void> throws IoError {
  const dir = Bun.env.TMPDIR ?? "/tmp";
  const path = dir + "/fish-bun-file-text/x.txt";
  const n = await Bun.write(path, "héllo");
  const text = await Bun.file(path).text();
  const there = await Bun.file(path).exists();
  console.log(n - 1, text, there);
}
// case: bun_spawn_sync_env
// expect: bar 0 true
function main(): void throws IoError {
  const r = Bun.spawnSync(["sh", "-c", "printf \"$FOO\""], { env: { FOO: "bar" } });
  console.log(new TextDecoder().decode(r.stdout), r.exitCode, r.success);
}
// case: bun_unknown_member
// error: 'Bun.build' isn't in Fish's subset of Bun yet; it has 'file', 'stdin', 'write', 'env', 'argv', 'sleepSync', 'version', 'which', 'spawnSync', 'sleep', 'serve', 'spawn'
function main() {
  Bun.build(["true"]);
}
// case: bun_env_write
// error: setting 'Bun.env' isn't supported yet; it is read-only here
function main() {
  Bun.env.X = "y";
}
// case: bun_spawn_exited_after_a_lost_race
// expect: first 0
// expect: second 1 0
// A child's exit awaited by the loser of a race is still seen by the next reader.
async function exitOf(exited: Promise<i64>, at: i64): Promise<i64> {
  const _code = await exited;
  return at;
}

async function main(): Promise<void> throws IoError {
  const a = Bun.spawn(["sleep", "0.1"], { stdout: "ignore", stderr: "ignore" });
  const b = Bun.spawn(["sleep", "0.4"], { stdout: "ignore", stderr: "ignore" });
  const first = await Promise.race([exitOf(a.exited, 0), exitOf(b.exited, 1)]);
  console.log("first", first);
  const second = await Promise.race([exitOf(b.exited, 1)]);
  const code = await b.exited;
  console.log("second", second, code);
}
// case: bun_spawn_exited_with_a_background_grandchild
// expect: 0 promptly "out\n"
// A child's exit is seen when the child ends, though a process it left in the background still
// holds its pipes, and what it wrote before then is kept.
async function main(): Promise<void> throws IoError {
  const start = Date.now();
  const child = Bun.spawn(["sh", "-c", "echo out; sleep 5 &"], { stdout: "pipe", stderr: "pipe" });
  const code = await child.exited;
  const took = Date.now() - start;
  const o = new Response(child.stdout);
  const out = await o.text();
  console.log(code, took < 3000 ? "promptly" : "late", JSON.stringify(out));
}
