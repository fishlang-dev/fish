// Blocking calls: an async function calling a function '@blocking' marks, directly or through sync
// functions, warns, pointing to 'spawnBlocking'; nothing 'spawnBlocking' runs warns.
// case: blocking_direct
// expect: 5
// warning: blocking_direct.fsh:6:3: warning[W0004]: 'writeFileSync' blocks the thread this async function runs on; call it inside 'spawnBlocking(() => ...)' to run it on the blocking pool
// warning: blocking_direct.fsh:7:10: warning[W0004]: 'readFileSync' blocks the thread this async function runs on
import { readFileSync, writeFileSync } from "node:fs";
async function save(): Promise<u8[]> throws IoError {
  writeFileSync("/tmp/fish_blocking_direct.txt", "hello");
  return readFileSync("/tmp/fish_blocking_direct.txt");
}
async function main() throws IoError {
  const bytes = await save();
  console.log(bytes.length);
}
// case: blocking_main_quiet
// expect: 5
// warning: blocking_main_quiet.fsh:9:9: warning[W0001]: unused variable 'unused'
import { readFileSync, writeFileSync } from "node:fs";
async function main() throws IoError {
  writeFileSync("/tmp/fish_blocking_main_quiet.txt", "hello");
  const bytes = readFileSync("/tmp/fish_blocking_main_quiet.txt");
  [1].forEach((_n) => Bun.sleepSync(1));
  console.log(bytes.length);
  const unused = 1;
}
// case: blocking_chain
// expect: 5
// warning: blocking_chain.fsh:14:13: warning[W0004]: 'load' blocks the thread this async function runs on, by calling 'readFileSync' (load -> read -> readFileSync); call it inside 'spawnBlocking(() => ...)'
// warning: blocking_chain.fsh:16:3: warning[W0004]: 'pause' blocks the thread this async function runs on, by calling 'sleepSync' (pause -> sleepSync)
import { readFileSync, writeFileSync } from "node:fs";
function read(path: string): u8[] throws IoError {
  return readFileSync(path);
}
function load(path: string): i64 throws IoError {
  return read(path).length as i64;
}
function pause() { Bun.sleepSync(1); }
async function main() throws IoError {
  writeFileSync("/tmp/fish_blocking_chain.txt", "hello");
  const n = load("/tmp/fish_blocking_chain.txt");
  console.log(n);
  pause();
}
// case: blocking_spawned
// expect: 5
// expect: 5
// expect: 5
// warning: blocking_spawned.fsh:23:9: warning[W0001]: unused variable 'unused'
import { readFileSync, writeFileSync } from "node:fs";
function load(): i64 throws IoError {
  return readFileSync("/tmp/fish_blocking_spawned.txt").length as i64;
}
function prepare() throws IoError {
  writeFileSync("/tmp/fish_blocking_spawned.txt", "hello");
}
async function main() throws IoError {
  await spawnBlocking(() => prepare());
  const a = await spawnBlocking(() => readFileSync("/tmp/fish_blocking_spawned.txt").length);
  console.log(a);
  const b = await spawnBlocking(load);
  console.log(b);
  const c = await spawnBlocking(() => {
    const read = () => readFileSync("/tmp/fish_blocking_spawned.txt");
    return read().length;
  });
  console.log(c);
  const unused = 1;
}
// case: blocking_marked
// expect: 3
// expect: 2
// expect: 1
// warning: blocking_marked.fsh:17:49: warning[W0004]: 'crunch' blocks
@blocking
function crunch(n: i64): i64 {
  let total = 0;
  for (let i = 0; i < n; i++) total += 1;
  return total;
}
@blocking
declare function usleep(microseconds: u32): i32;
async function main() {
  const three = crunch(3);
  const slept = unsafe { usleep(1) } as i64;
  console.log(three);
  const twice = async (n: i64): Promise<i64> => crunch(n) + 1;
  [1].forEach((n) => console.log(crunch(n) + slept + 1 - slept));
  const once = await twice(0);
  console.log(once);
}
// case: blocking_quiet
// expect: {"a":1} 2 HELLO
// expect: 3
// warning: blocking_quiet.fsh:19:9: warning[W0001]: unused variable 'unused'
function size(m: Ref<Map<string, i64>>): i64 {
  return m.size as i64 + 1;
}
function generated(): i64 {
  return 2;
}
async function later(): Promise<i64> {
  return 3;
}
async function main() {
  let m = new Map<string, i64>();
  m.set("a", 1);
  console.log(JSON.stringify({ a: 1 }), size(m), "hello".toUpperCase());
  const three = await later();
  console.log(three + generated() - 2);
  const unused = 1;
}
// case: blocking_sync_main
// expect: 5
// warning: blocking_sync_main.fsh:7:9: warning[W0001]: unused variable 'unused'
import { readFileSync, writeFileSync } from "node:fs";
function main() throws IoError {
  writeFileSync("/tmp/fish_blocking_sync_main.txt", "hello");
  console.log(readFileSync("/tmp/fish_blocking_sync_main.txt").length);
  const unused = 1;
}
