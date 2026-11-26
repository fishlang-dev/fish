// case: zip_list_system_archives
// expect: a.txt file 5 | sub/ directory 0 | sub/b.txt file 3000
// expect: a.txt hello
// expect: stream: 3 entries
// Archives the system's zip made, listed from a path and read from a stream, a deflated file's
// data read back.
import { entries, list, ZipError } from "std:zip";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Text that deflates at well under the default 100:1 limit, unlike a run of one letter.
function varied(size: i64): string {
  let t = "";
  for (let i = 0; (t.length as i64) < size; i++) t += String(i * 7919 % 10007) + ",";
  return t.slice(0, size);
}

async function* chunked(bytes: u8[]): AsyncGenerator<u8[]> {
  for (let at = 0; at < (bytes.length as i64); at += 300) yield bytes.slice(at, at + 300);
}

async function main(): Promise<void> throws IoError | Error | ZipError {
  const dir = mkdtempSync(join(tmpdir(), "fish-zip-"));
  mkdirSync(join(dir, "src", "sub"), { recursive: true });
  writeFileSync(join(dir, "src", "a.txt"), "hello");
  writeFileSync(join(dir, "src", "sub", "b.txt"), varied(3000));
  spawnSync("zip", ["-q", "-r", join(dir, "x.zip"), "a.txt", "sub"], { cwd: join(dir, "src") });
  const headers = await list(join(dir, "x.zip"));
  let parts: string[] = [];
  for (const h of headers) parts.push(h.path + " " + h.type + " " + String(h.size));
  parts.sort();
  console.log(parts.join(" | "));
  let all = entries(ReadableStream.from(chunked(readFileSync(join(dir, "x.zip")))));
  let count = 0;
  for await (const e of all) {
    count++;
    if (e.path === "a.txt") console.log("a.txt", new TextDecoder().decode(e.data));
  }
  console.log("stream:", count, "entries");
  rmSync(dir, { recursive: true });
}
// case: zip_refusals
// expect: crc: true
// expect: encrypted: 'a.txt' is encrypted, which isn't read
// expect: entries: this zip archive holds more than 1 entries; raise maxEntries if it is trusted
// expect: bytes: true
// expect: ratio: 'z.txt' unpacks more than 2 bytes per byte packed; raise maxRatio if it is trusted
// expect: not zip: this isn't a zip archive: it has no end of central directory record
// A corrupt entry, an encrypted one, each limit and bytes that aren't zip are refused.
import { list, ZipError } from "std:zip";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function attempt(source: u8[], limits: { maxEntries?: i64; maxBytes?: i64; maxRatio?: i64 }): Promise<string> {
  try {
    const _h = await list(source, limits);
    return "listed";
  } catch (e) {
    return e.message;
  }
}

async function main(): Promise<void> throws IoError | ZipError {
  const dir = mkdtempSync(join(tmpdir(), "fish-zip-"));
  writeFileSync(join(dir, "a.txt"), "hello");
  writeFileSync(join(dir, "z.txt"), "0".repeat(100000));
  spawnSync("zip", ["-q", "-0", join(dir, "a.zip"), "a.txt"], { cwd: dir });
  spawnSync("zip", ["-q", "-P", "secret", join(dir, "e.zip"), "a.txt"], { cwd: dir });
  spawnSync("zip", ["-q", join(dir, "z.zip"), "a.txt", "z.txt"], { cwd: dir });
  let stored = readFileSync(join(dir, "a.zip"));
  // The stored entry's data is the file's text as it is, so a byte of "hello" is flipped.
  let corrupt = stored.clone();
  for (let i = 0; i + 5 <= (corrupt.length as i64); i++) {
    if (new TextDecoder().decode(corrupt.slice(i, i + 5)) === "hello") {
      corrupt[i as usize] = 88;
      break;
    }
  }
  const crc = await attempt(corrupt, {});
  console.log("crc:", crc.includes("fails its CRC-32 check"));
  const encrypted = await attempt(readFileSync(join(dir, "e.zip")), {});
  console.log("encrypted:", encrypted);
  const many = await attempt(readFileSync(join(dir, "z.zip")), { maxEntries: 1 });
  console.log("entries:", many);
  const bytes = await attempt(readFileSync(join(dir, "z.zip")), { maxBytes: 1000 });
  console.log("bytes:", bytes.includes("raise maxBytes"));
  const ratio = await attempt(readFileSync(join(dir, "z.zip")), { maxRatio: 2 });
  console.log("ratio:", ratio);
  const notZip = await attempt(new TextEncoder().encode("just text"), {});
  console.log("not zip:", notZip);
  rmSync(dir, { recursive: true });
}
// case: zip_extract_and_refusals
// expect: a.txt hello
// expect: link -> a.txt
// expect: climbing: '../evil.txt' climbs out of the target, which extract refuses
// expect: absolute link: 'up' is a symlink to the absolute path '/tmp', which extract refuses
// expect: through a link: 'hop/x.txt' would be written through the symlink 'hop', which extract refuses
// expect: nothing outside: true
// An archive the system's zip made extracted and read back, and archives with each escaping
// entry refused with nothing written outside the target.
import { extract, pack, ZipError } from "std:zip";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { ZlibError } from "node:zlib";
import { join } from "node:path";

async function archive(paths: string[], cwd: string): Promise<u8[]> throws IoError | ZlibError {
  let out: u8[] = [];
  let chunks = pack(paths, { cwd });
  for await (const chunk of chunks) for (const b of chunk) out.push(b);
  return out;
}

async function attempt(what: string, bytes: u8[], to: string): Promise<void> {
  try {
    const _w = await extract(bytes, to);
    console.log(what + ": extracted");
  } catch (e) {
    console.log(what + ": " + e.message);
  }
}

async function main(): Promise<void> throws IoError | ZlibError | Error | ZipError {
  const dir = mkdtempSync(join(tmpdir(), "fish-zip-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "a.txt"), "hello");
  symlinkSync("a.txt", join(dir, "src", "link"));
  spawnSync("zip", ["-q", "-y", join(dir, "x.zip"), "a.txt", "link"], { cwd: join(dir, "src") });
  const out = join(dir, "out");
  const _w = await extract(join(dir, "x.zip"), out);
  console.log("a.txt", new TextDecoder().decode(readFileSync(join(out, "a.txt"))));
  console.log("link ->", readlinkSync(join(out, "link")));
  const inner = join(dir, "a", "inner");
  mkdirSync(join(inner, "real"), { recursive: true });
  writeFileSync(join(dir, "a", "evil.txt"), "x");
  writeFileSync(join(inner, "real", "x.txt"), "x");
  symlinkSync("/tmp", join(inner, "up"));
  symlinkSync("real", join(inner, "hop"));
  const climbing = await archive(["../evil.txt"], inner);
  await attempt("climbing", climbing, join(dir, "t1"));
  const absolute = await archive(["up"], inner);
  await attempt("absolute link", absolute, join(dir, "t2"));
  const through = await archive(["hop", "hop/x.txt"], inner);
  await attempt("through a link", through, join(dir, "t3"));
  console.log("nothing outside:", !existsSync(join(dir, "evil.txt")));
  rmSync(dir, { recursive: true });
}
// case: zip_create_round_trip
// expect: entries: a.txt file 5 hello | big.txt file 50000 | sub/ directory 0 | sub/b.txt file 3 bye
// expect: unzip -t: No errors detected in compressed data
// expect: unzip -l: a.txt big.txt sub/ sub/b.txt
// An archive create writes reads back through entries() and through the system's unzip, which
// tests every entry's CRC.
import { create, entries, ZipError } from "std:zip";

function varied(size: i64): string {
  let t = "";
  for (let i = 0; (t.length as i64) < size; i++) t += String(i * 7919 % 10007) + ",";
  return t.slice(0, size);
}
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { ZlibError } from "node:zlib";
import { join } from "node:path";

async function main(): Promise<void> throws IoError | ZlibError | Error | ZipError {
  const dir = mkdtempSync(join(tmpdir(), "fish-zip-"));
  mkdirSync(join(dir, "src", "sub"), { recursive: true });
  writeFileSync(join(dir, "src", "a.txt"), "hello");
  writeFileSync(join(dir, "src", "big.txt"), varied(50000));
  writeFileSync(join(dir, "src", "sub", "b.txt"), "bye");
  await create(join(dir, "x.zip"), ["a.txt", "big.txt", "sub"], { cwd: join(dir, "src") });
  let parts: string[] = [];
  let all = entries(join(dir, "x.zip"));
  for await (const e of all) parts.push(e.path + " " + e.type + " " + String(e.size) + (e.type === "file" && e.size < 10 ? " " + new TextDecoder().decode(e.data) : ""));
  console.log("entries:", parts.join(" | "));
  const tested = new TextDecoder().decode(spawnSync("unzip", ["-t", join(dir, "x.zip")]).stdout);
  console.log("unzip -t:", tested.includes("No errors detected in compressed data") ? "No errors detected in compressed data" : tested);
  const listed = new TextDecoder().decode(spawnSync("unzip", ["-Z1", join(dir, "x.zip")]).stdout);
  console.log("unzip -l:", listed.trim().split("\n").join(" "));
  rmSync(dir, { recursive: true });
}
// case: zip_extract_refuses_symlink_chains
// expect: forward: 'a/b/c/s2' follows symlinks out of the target, which extract refuses
// expect: forward clean: true
// expect: reverse: 'a/b/c/s2' follows symlinks out of the target, which extract refuses
// expect: reverse clean: true
// expect: three-hop: 'a/b/c/t3' follows symlinks out of the target, which extract refuses
// expect: three-hop clean: true
// expect: ro dir: 'ro/b/c/a2' follows symlinks out of the target, which extract refuses
// expect: ro dir clean: true
// expect: mixed-case: true
// expect: self loop: 'a/loop' follows too many symlinks, which extract refuses
// expect: self loop clean: true
// expect: mutual loop: 'a/x' follows too many symlinks, which extract refuses
// expect: mutual loop clean: true
// expect: safe chain: ok
// Multi-hop symlink chains (forward, reverse, 3-hop, read-only dir, mixed-case) and loops are refused (F-2394).
import { extract, pack, ZipError } from "std:zip";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { ZlibError } from "node:zlib";
import { join } from "node:path";

async function archive(paths: string[], cwd: string): Promise<u8[]> throws IoError | ZlibError {
  let out: u8[] = [];
  let chunks = pack(paths, { cwd });
  for await (const chunk of chunks) for (const b of chunk) out.push(b);
  return out;
}

async function attempt(what: string, bytes: u8[], to: string): Promise<void> {
  try {
    const _w = await extract(bytes, to);
    console.log(what + ": extracted");
  } catch (e) {
    console.log(what + ": " + e.message);
  }
}

async function main(): Promise<void> throws IoError | ZlibError | ZipError {
  const dir = mkdtempSync(join(tmpdir(), "fish-zip-chain-"));
  const src = join(dir, "src");
  mkdirSync(join(src, "a", "b", "c"), { recursive: true });
  mkdirSync(join(src, "ro", "b", "c"), { recursive: true });
  symlinkSync("../../..", join(src, "a", "b", "c", "s1"));
  symlinkSync("s1/../../..", join(src, "a", "b", "c", "s2"));
  symlinkSync("S1/../../..", join(src, "a", "b", "c", "s2_ci"));
  symlinkSync("../../..", join(src, "ro", "b", "c", "z1"));
  symlinkSync("z1/../../..", join(src, "ro", "b", "c", "a2"));
  chmodSync(join(src, "ro", "b", "c"), 0o555);
  symlinkSync("../../..", join(src, "a", "b", "c", "t1"));
  symlinkSync("t1/a", join(src, "a", "b", "c", "t2"));
  symlinkSync("t2/../..", join(src, "a", "b", "c", "t3"));
  symlinkSync("loop", join(src, "a", "loop"));
  symlinkSync("y", join(src, "a", "x"));
  symlinkSync("x", join(src, "a", "y"));
  writeFileSync(join(src, "a", "ok.txt"), "ok");
  symlinkSync("..", join(src, "a", "b", "up1"));
  symlinkSync("up1/ok.txt", join(src, "a", "b", "to_ok"));

  const fwd = await archive(["a/b/c/s1", "a/b/c/s2"], src);
  const outFwd = join(dir, "fwd");
  await attempt("forward", fwd, outFwd);
  console.log("forward clean:", lstatSync(join(outFwd, "a", "b", "c", "s1"), { throwIfNoEntry: false }) === undefined && lstatSync(join(outFwd, "a", "b", "c", "s2"), { throwIfNoEntry: false }) === undefined);

  const rev = await archive(["a/b/c/s2", "a/b/c/s1"], src);
  const outRev = join(dir, "rev");
  await attempt("reverse", rev, outRev);
  console.log("reverse clean:", lstatSync(join(outRev, "a", "b", "c", "s1"), { throwIfNoEntry: false }) === undefined && lstatSync(join(outRev, "a", "b", "c", "s2"), { throwIfNoEntry: false }) === undefined);

  const three = await archive(["a/b/c/t3", "a/b/c/t2", "a/b/c/t1"], src);
  const outThree = join(dir, "three");
  await attempt("three-hop", three, outThree);
  console.log("three-hop clean:", lstatSync(join(outThree, "a", "b", "c", "t1"), { throwIfNoEntry: false }) === undefined && lstatSync(join(outThree, "a", "b", "c", "t2"), { throwIfNoEntry: false }) === undefined && lstatSync(join(outThree, "a", "b", "c", "t3"), { throwIfNoEntry: false }) === undefined);

  const roDir = await archive(["ro/b/c"], src);
  const outRo = join(dir, "ro");
  await attempt("ro dir", roDir, outRo);
  console.log("ro dir clean:", lstatSync(join(outRo, "ro", "b", "c", "z1"), { throwIfNoEntry: false }) === undefined && lstatSync(join(outRo, "ro", "b", "c", "a2"), { throwIfNoEntry: false }) === undefined);

  writeFileSync(join(dir, "case_probe"), "x");
  const caseInsensitive = lstatSync(join(dir, "CASE_PROBE"), { throwIfNoEntry: false }) !== undefined;
  if (caseInsensitive) {
    const revCi = await archive(["a/b/c/s2_ci", "a/b/c/s1"], src);
    const outCi = join(dir, "ci");
    let refused = false;
    try {
      const _w = await extract(revCi, outCi);
    } catch (e) {
      refused = e.message.includes("follows symlinks out of the target");
    }
    const clean = lstatSync(join(outCi, "a", "b", "c", "s1"), { throwIfNoEntry: false }) === undefined && lstatSync(join(outCi, "a", "b", "c", "s2_ci"), { throwIfNoEntry: false }) === undefined;
    console.log("mixed-case:", refused && clean);
  } else {
    console.log("mixed-case:", true);
  }

  const selfLoop = await archive(["a/loop"], src);
  const outSelf = join(dir, "self");
  await attempt("self loop", selfLoop, outSelf);
  console.log("self loop clean:", lstatSync(join(outSelf, "a", "loop"), { throwIfNoEntry: false }) === undefined);

  const mutLoop = await archive(["a/x", "a/y"], src);
  const outMut = join(dir, "mut");
  await attempt("mutual loop", mutLoop, outMut);
  console.log("mutual loop clean:", lstatSync(join(outMut, "a", "x"), { throwIfNoEntry: false }) === undefined && lstatSync(join(outMut, "a", "y"), { throwIfNoEntry: false }) === undefined);

  const safe = await archive(["a/ok.txt", "a/b/up1", "a/b/to_ok"], src);
  const outSafe = join(dir, "safe");
  const _w = await extract(safe, outSafe);
  console.log("safe chain:", new TextDecoder().decode(readFileSync(join(outSafe, "a", "b", "to_ok"))));
  chmodSync(join(src, "ro", "b", "c"), 0o755);
  rmSync(dir, { recursive: true });
}
