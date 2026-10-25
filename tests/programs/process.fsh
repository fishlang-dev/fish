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
// error: 'node:process' has no export named 'pid'
import process from "node:process";
function main() {
  console.log(process.pid);
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
