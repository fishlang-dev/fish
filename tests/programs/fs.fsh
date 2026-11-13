// case: fs_encoding_not_literal
// error: 'readFile' takes its encoding as a literal, like "utf8" or { encoding: "utf8" }, so its type is known while compiling
import { readFile } from "node:fs/promises";
async function main(): Promise<void> throws IoError {
  const e = "utf8";
  const t = await readFile("x", e);
}
// case: fs_encoding_unknown
// error: 'readFile' knows the "utf8" encoding so far, not "latin1"
import { readFile } from "node:fs/promises";
async function main(): Promise<void> throws IoError {
  const t = await readFile("x", "latin1");
}
// case: fs_types
// expect: true
import { readFile } from "node:fs/promises";
async function main(): Promise<void> {
  try {
    const bytes: u8[] = await readFile("/nonexistent-fish-file");
  } catch (e) {
    console.log(e.code === "ENOENT");
  }
}
// case: fs_unknown_member
// error: 'node:fs/promises' has no export named 'readdir'
import * as fs from "node:fs/promises";
async function main(): Promise<void> {
  fs.readdir(".");
}
// case: fs_encoding_shadowed
// expect: x:utf8
// expect: y:utf8
import { readFile } from "node:fs/promises";
function local(): void {
  const readFile = (p: string, e: string): string => `${p}:${e}`;
  console.log(readFile("x", "utf8"));
}
function nested(): void {
  function readFile(p: string, e: string): string {
    return `${p}:${e}`;
  }
  console.log(readFile("y", "utf8"));
}
async function main(): Promise<void> {
  local();
  nested();
}
// case: fs_encoding_parameter
// expect: in.txt:utf8
import { readFile } from "node:fs/promises";
function load(readFile: (p: string, e: string) => string): string {
  return readFile("in.txt", "utf8");
}
async function main(): Promise<void> {
  console.log(load((p: string, e: string): string => `${p}:${e}`));
}
// case: fs_sync_in_async
// expect: true fish
// The blocking calls work inside async functions, as Node lets them.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
async function main(): Promise<void> throws IoError {
  writeFileSync("/tmp/fish-sync-in-async.txt", "fish");
  console.log(existsSync("/tmp/fish-sync-in-async.txt"), readFileSync("/tmp/fish-sync-in-async.txt", "utf8"));
}
// case: fs_sync_unknown_member
// error: 'node:fs' has no export named 'appendFileSync'
import * as fs from "node:fs";
function main(): void { fs.appendFileSync("x"); }
// case: fs_read_sync_offset_without_length
// error: no overload of 'readSync' takes (i64, Uint8Array, i64)
import { readSync } from "node:fs";
function main(): void throws IoError {
  let b = new Uint8Array(4);
  readSync(0, b, 1);
}
// case: fs_write_sync_other_encoding
// error: no overload of 'writeSync' takes (i64, "ab", i64, "hex")
import { writeSync } from "node:fs";
function main(): void throws IoError {
  writeSync(1, "ab", 0, "hex");
}
// case: fs_descriptor_block_std_only
// error: a C function can't return a 'FileDescriptor'
declare function fsh_rt_fd_hold(fd: i64): __FileDescriptor;
function main() {
  const held = unsafe { fsh_rt_fd_hold(1) };
}
// case: fs_readdir_file_types
// expect: a false true false true
// expect: b.txt true false false true
// expect: c false false true true
// expect: a,b.txt,c 3
// A link is an entry of its own kind, not its target's.
import { mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
function main(): void throws IoError {
  const dir = mkdtempSync("/tmp/fish-dirent-");
  writeFileSync(dir + "/b.txt", "hi");
  mkdirSync(dir + "/a");
  symlinkSync("b.txt", dir + "/c");
  let entries = readdirSync(dir, { withFileTypes: true });
  entries.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  for (const e of entries) console.log(e.name, e.isFile(), e.isDirectory(), e.isSymbolicLink(), e.parentPath === dir);
  let names = readdirSync(dir);
  names.sort();
  console.log(names.join(","), readdirSync(dir, { withFileTypes: false }).length);
  rmSync(dir, { recursive: true });
}
// case: fs_readdir_file_types_missing
// expect: ENOENT
import { readdirSync } from "node:fs";
function main() {
  try {
    readdirSync("/fish-no-such-dir", { withFileTypes: true });
  } catch (e) {
    console.log(e.code);
  }
}
// case: fs_read_descriptor
// expect: ab 0
import { openSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
function main(): void throws IoError {
  const dir = mkdtempSync("/tmp/fish-fd-");
  writeFileSync(dir + "/in.txt", "ab");
  const fd = openSync(dir + "/in.txt");
  console.log(readFileSync(fd, "utf8"), readFileSync(fd).length);
  rmSync(dir, { recursive: true });
}
// case: fs_stat_fields
// expect: 1 2 true true true
// expect: 1000000 2000000 1970-01-01T00:33:20.000Z true true
// expect: true true true
import { closeSync, fstatSync, linkSync, mkdtempSync, openSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
function same(a: { dev: u64; ino: u64 }, b: { dev: u64; ino: u64 }): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}
function main(): void throws IoError {
  const dir = mkdtempSync("/tmp/fish-stat-");
  writeFileSync(dir + "/f", "hi");
  writeFileSync(dir + "/g", "hi");
  const one = statSync(dir + "/f").nlink;
  linkSync(dir + "/f", dir + "/h");
  const s = statSync(dir + "/f");
  console.log(one, s.nlink, same(statSync(dir + "/f"), statSync(dir + "/h")), !same(statSync(dir + "/f"), statSync(dir + "/g")), s.dev === statSync(dir).dev);
  utimesSync(dir + "/f", 1000, 2000);
  const t = statSync(dir + "/f");
  console.log(t.atimeMs, t.mtimeMs, t.mtime.toISOString(), t.ctimeMs > t.mtimeMs, t.birthtimeMs >= 0);
  const fd = openSync(dir + "/f");
  const u = fstatSync(fd);
  console.log(same(fstatSync(fd), statSync(dir + "/f")), u.uid === t.uid && u.gid === t.gid, u.mtimeMs === t.mtimeMs && u.atimeMs === t.atimeMs && u.ctimeMs === t.ctimeMs && u.birthtimeMs === t.birthtimeMs);
  closeSync(fd);
  rmSync(dir, { recursive: true });
}
// case: fs_stat_throw_if_no_entry
// expect: true true
// expect: true true
// expect: ENOENT ENOTDIR
// expect: true
import { lstatSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
function main(): void throws IoError {
  const dir = mkdtempSync("/tmp/fish-stat-");
  writeFileSync(dir + "/f", "hi");
  symlinkSync("missing", dir + "/ln");
  console.log(statSync(dir + "/none", { throwIfNoEntry: false }) === undefined, statSync(dir + "/f/x", { throwIfNoEntry: false }) === undefined);
  console.log(statSync(dir + "/f", { throwIfNoEntry: false })?.isFile() ?? false, lstatSync(dir + "/ln", { throwIfNoEntry: false })?.isSymbolicLink() ?? false);
  let codes: string[] = [];
  for (const p of [dir + "/none", dir + "/f/x"]) {
    try {
      statSync(p, { throwIfNoEntry: true });
    } catch (e) {
      codes.push(e.code);
    }
  }
  console.log(codes.join(" "));
  console.log(statSync(dir + "/ln", { throwIfNoEntry: false }) === undefined);
  rmSync(dir, { recursive: true });
}
// case: fs_open_flags
// expect: ELOOP
// expect: hello
import { closeSync, constants, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeSync } from "node:fs";
function main(): void throws IoError {
  const dir = mkdtempSync("/tmp/fish-flags-");
  symlinkSync("target", dir + "/ln");
  try {
    openSync(dir + "/ln", constants.O_WRONLY | constants.O_NOFOLLOW);
  } catch (e) {
    console.log(e.code);
  }
  const fd = openSync(dir + "/f", constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_TRUNC | constants.O_APPEND | constants.O_SYNC);
  writeSync(fd, "hello");
  closeSync(fd);
  const r = openSync(dir + "/f", constants.O_RDONLY);
  console.log(readFileSync(r, "utf8"));
  closeSync(r);
  rmSync(dir, { recursive: true });
}
