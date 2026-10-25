// case: os_imports
// expect: true true true true
import os from "node:os";
import { platform, availableParallelism as cpus } from "node:os";
function main() {
  const p = os.platform();
  console.log(p === "darwin" || p === "linux", platform() === p, cpus() === os.availableParallelism(), os.hostname().length > 0);
}
// case: os_global
// expect: true
function main() {
  console.log(os.tmpdir().length > 0);
}
// case: os_shadowed
// expect: mine local loop true
type Box = { platform: string };
function show(os: Box): string { return os.platform; }
function main() {
  const first = show({ platform: "mine" });
  let second = "";
  {
    const os: Box = { platform: "local" };
    second = os.platform;
  }
  let third = "";
  for (const os of [{ platform: "loop" }]) third = os.platform;
  console.log(first, second, third, os.platform().length > 0);
}
// case: os_own_name
// expect: user
const os = { platform: "user" };
function main() {
  console.log(os.platform);
}
// case: os_name_clash
// expect: mine true
function hostname(): string { return "mine"; }
function main() {
  console.log(hostname(), os.hostname().length > 0);
}
// case: os_unknown_member
// error: 'node:os' has no export named 'cpus'; it has 'hostname', 'tmpdir', 'homedir', 'platform', 'availableParallelism'
import os from "node:os";
function main() {
  console.log(os.cpus());
}
// case: os_unknown_import
// error: 'node:os' has no export named 'nope'
import { nope } from "os";
function main() {
  console.log(nope());
}
