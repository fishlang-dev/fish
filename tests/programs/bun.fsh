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
// error: 'Bun.spawn' isn't in Fish's subset of Bun yet; it has
function main() {
  Bun.spawn(["true"]);
}
// case: bun_env_write
// error: setting 'Bun.env' isn't supported yet; it is read-only here
function main() {
  Bun.env.X = "y";
}
