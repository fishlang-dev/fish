// case: watch_change
// expect: change f.txt
// expect: ended
import { watch } from "node:fs/promises";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";

async function poke(dir: string, c: AbortController): Promise<void> throws IoError {
  await sleep(100);
  writeFileSync(dir + "/f.txt", "b");
  await sleep(200);
  c.abort();
}

async function main() throws IoError {
  const dir = realpathSync(mkdtempSync("/tmp/fish-watch-"));
  writeFileSync(dir + "/f.txt", "a");
  const c = new AbortController();
  const p = spawn(poke(dir, c.clone()));
  let seen: string[] = [];
  for await (const e of watch(dir + "/f.txt", { signal: c.signal })) {
    const line = e.eventType + " " + (e.filename ?? "null");
    if (!seen.includes(line)) seen.push(line);
  }
  seen.push("ended");
  await p;
  for (const line of seen) console.log(line);
  rmSync(dir, { recursive: true });
}
// case: watch_rename
// expect: rename new.txt
// expect: ended
import { watch } from "node:fs/promises";
import { mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";

async function poke(dir: string, c: AbortController): Promise<void> throws IoError {
  await sleep(100);
  writeFileSync(dir + "/new.txt", "x");
  await sleep(100);
  unlinkSync(dir + "/new.txt");
  await sleep(200);
  c.abort();
}

async function main() throws IoError {
  const dir = realpathSync(mkdtempSync("/tmp/fish-watch-"));
  const c = new AbortController();
  const p = spawn(poke(dir, c.clone()));
  let seen: string[] = [];
  let renames = 0;
  for await (const e of watch(dir, { signal: c.signal })) {
    if (e.eventType === "rename") renames++;
    const line = e.eventType + " " + (e.filename ?? "null");
    if (!seen.includes(line)) seen.push(line);
  }
  seen.push("ended");
  await p;
  for (const line of seen) console.log(line);
  if (renames < 2) console.log("only", renames, "renames");
  rmSync(dir, { recursive: true });
}
// case: watch_recursive
// expect: rename sub/g.txt
// expect: change sub/g.txt
// expect: ended
import { watch } from "node:fs/promises";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";

async function poke(dir: string, c: AbortController): Promise<void> throws IoError {
  await sleep(100);
  writeFileSync(dir + "/sub/g.txt", "x");
  await sleep(150);
  writeFileSync(dir + "/sub/g.txt", "y");
  await sleep(200);
  c.abort();
}

async function main() throws IoError {
  const dir = realpathSync(mkdtempSync("/tmp/fish-watch-"));
  mkdirSync(dir + "/sub");
  const c = new AbortController();
  const p = spawn(poke(dir, c.clone()));
  let seen: string[] = [];
  for await (const e of watch(dir, { recursive: true, signal: c.signal })) {
    const line = e.eventType + " " + (e.filename ?? "null");
    if (!seen.includes(line)) seen.push(line);
  }
  seen.push("ended");
  await p;
  for (const line of seen) console.log(line);
  rmSync(dir, { recursive: true });
}
// case: watch_not_recursive
// expect: rename top.txt
// expect: ended
import { watch } from "node:fs/promises";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";

async function poke(dir: string, c: AbortController): Promise<void> throws IoError {
  await sleep(100);
  writeFileSync(dir + "/sub/g.txt", "x");
  await sleep(100);
  writeFileSync(dir + "/top.txt", "x");
  await sleep(200);
  c.abort();
}

async function main() throws IoError {
  const dir = realpathSync(mkdtempSync("/tmp/fish-watch-"));
  mkdirSync(dir + "/sub");
  const c = new AbortController();
  const p = spawn(poke(dir, c.clone()));
  let seen: string[] = [];
  for await (const e of watch(dir, { signal: c.signal })) {
    const line = e.eventType + " " + (e.filename ?? "null");
    if (!seen.includes(line)) seen.push(line);
  }
  seen.push("ended");
  await p;
  for (const line of seen) console.log(line);
  rmSync(dir, { recursive: true });
}
// case: watch_abort_ends
// expect: ended
// expect: done true
import { watch } from "node:fs/promises";

async function stop(c: AbortController): Promise<void> {
  await sleep(50);
  c.abort();
}

async function main() throws IoError {
  const c = new AbortController();
  const p = spawn(stop(c.clone()));
  let changes = watch(".", { signal: c.signal });
  while (true) {
    const r = await changes.next();
    if (r.done === true) break;
    console.log("event", r.value.eventType);
  }
  console.log("ended");
  await p;
  const r = await changes.next();
  console.log("done", r.done);
}
// case: watch_already_aborted
// expect: ended
import { watch } from "node:fs/promises";

async function main() throws IoError {
  const c = new AbortController();
  c.abort();
  for await (const e of watch(".", { signal: c.signal })) console.log("event", e.eventType);
  console.log("ended");
}
// case: watch_missing
// expect: ENOENT watch ENOENT: no such file or directory, watch 'no-such-dir-to-watch'
import { watch } from "node:fs/promises";

async function main() {
  try {
    for await (const e of watch("no-such-dir-to-watch")) console.log("event", e.eventType);
  } catch (e) {
    console.log(e.code, e.syscall, e.message);
  }
}
// case: watch_race_next
// expect: nothing yet
// expect: rename late.txt
// expect: done
import { watch, FileChangeInfo } from "node:fs/promises";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";

async function next(g: Mut<AsyncGenerator<FileChangeInfo>>): Promise<string> {
  const r = await g.next();
  if (r.done === false) return r.value.eventType + " " + (r.value.filename ?? "null");
  return "done";
}

async function timeout(ms: i64): Promise<string> {
  await sleep(ms);
  return "nothing yet";
}

async function main() throws IoError {
  const dir = realpathSync(mkdtempSync("/tmp/fish-watch-"));
  const c = new AbortController();
  let changes = watch(dir, { signal: c.signal });
  const first = await Promise.race([next(changes), timeout(100)]);
  console.log(first);
  writeFileSync(dir + "/late.txt", "x");
  const second = await Promise.race([next(changes), timeout(2000)]);
  console.log(second);
  c.abort();
  while (true) {
    const more = await next(changes);
    if (more === "done") break;
  }
  console.log("done");
  rmSync(dir, { recursive: true });
}
// case: watch_null_byte
// expect: ERR_INVALID_ARG_VALUE The argument 'path' must be a string, Uint8Array, or URL without null bytes. Received "a\u0000b"
import { watch } from "node:fs/promises";

function main() {
  try {
    watch("a\0b");
  } catch (e) {
    console.log(e.code, e.message);
  }
}
