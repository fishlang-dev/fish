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
