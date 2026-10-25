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
// error: 'node:fs' has no export named 'openSync'
import * as fs from "node:fs";
function main(): void { fs.openSync("x"); }
