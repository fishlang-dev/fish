// case: tar_list_system_archives
// expect: plain: a.txt file 5 | sub/ directory 0 | sub/b.txt file 3
// expect: gzip: a.txt file 5 | sub/ directory 0 | sub/b.txt file 3
// expect: long: 120 true
// expect: stream: 3 entries
// Archives the system's tar made, plain and gzipped, from a path, bytes and a stream, and a
// path past ustar's 100 bytes.
import { list, entries, TarError, type TarHeader } from "fish:tar";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function shown(headers: Ref<TarHeader[]>): string {
  let parts: string[] = [];
  for (const h of headers) parts.push(h.path + " " + h.type + " " + String(h.size));
  parts.sort();
  return parts.join(" | ");
}

async function* chunked(bytes: u8[]): AsyncGenerator<u8[]> {
  for (let at = 0; at < (bytes.length as i64); at += 700) yield bytes.slice(at, at + 700);
}

async function main(): Promise<void> throws IoError | Error | TarError {
  const dir = mkdtempSync(join(tmpdir(), "fish-tar-"));
  mkdirSync(join(dir, "src", "sub"), { recursive: true });
  writeFileSync(join(dir, "src", "a.txt"), "hello");
  writeFileSync(join(dir, "src", "sub", "b.txt"), "bye");
  spawnSync("env", ["COPYFILE_DISABLE=1", "tar", "-cf", join(dir, "x.tar"), "-C", join(dir, "src"), "a.txt", "sub"]);
  spawnSync("env", ["COPYFILE_DISABLE=1", "tar", "-czf", join(dir, "x.tgz"), "-C", join(dir, "src"), "a.txt", "sub"]);
  const plain = await list(join(dir, "x.tar"));
  console.log("plain:", shown(plain));
  const gz = await list(readFileSync(join(dir, "x.tgz")));
  console.log("gzip:", shown(gz));
  const name = "d".repeat(60) + "/" + "f".repeat(59);
  mkdirSync(join(dir, "long", "d".repeat(60)), { recursive: true });
  writeFileSync(join(dir, "long", name), "x");
  spawnSync("env", ["COPYFILE_DISABLE=1", "tar", "-cf", join(dir, "long.tar"), "-C", join(dir, "long"), name]);
  const long = await list(join(dir, "long.tar"));
  console.log("long:", long[0]!.path.length, long[0]!.path === name);
  let count = 0;
  let all = entries(ReadableStream.from(chunked(readFileSync(join(dir, "x.tar")))));
  for await (const _e of all) count++;
  console.log("stream:", count, "entries");
  rmSync(dir, { recursive: true });
}
// case: tar_refusals
// expect: checksum: a tar header's checksum doesn't match; the archive is corrupt or isn't tar
// expect: entries: this tar archive holds more than 1 entries; raise maxEntries if it is trusted
// expect: bytes: this tar archive holds more than 4 bytes; raise maxBytes if it is trusted
// expect: ratio: true
// expect: fifo: true
// A corrupt header, each limit, and a FIFO are refused with TarError.
import { list, TarError } from "fish:tar";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function attempt(what: string, source: u8[], limits: { maxEntries?: i64; maxBytes?: i64; maxRatio?: i64 }): Promise<string> {
  try {
    const _h = await list(source, limits);
    return what + ": listed";
  } catch (e) {
    return what + ": " + e.message;
  }
}

async function main(): Promise<void> throws IoError | TarError {
  const dir = mkdtempSync(join(tmpdir(), "fish-tar-"));
  writeFileSync(join(dir, "a.txt"), "hello");
  writeFileSync(join(dir, "z.txt"), "0".repeat(100000));
  spawnSync("env", ["COPYFILE_DISABLE=1", "tar", "-cf", join(dir, "x.tar"), "-C", dir, "a.txt", "z.txt"]);
  spawnSync("env", ["COPYFILE_DISABLE=1", "tar", "-czf", join(dir, "z.tgz"), "-C", dir, "z.txt"]);
  let bytes = readFileSync(join(dir, "x.tar"));
  let corrupt = bytes.clone();
  corrupt[3] = 120;
  const checksumSaid = await attempt("checksum", corrupt, {});
  console.log(checksumSaid);
  const entriesSaid = await attempt("entries", bytes.clone(), { maxEntries: 1 });
  console.log(entriesSaid);
  const bytesSaid = await attempt("bytes", bytes.clone(), { maxBytes: 4 });
  console.log(bytesSaid);
  const ratio = await attempt("ratio", readFileSync(join(dir, "z.tgz")), { maxRatio: 2 });
  console.log("ratio:", ratio.includes("unpacks past its limits"));
  spawnSync("mkfifo", [join(dir, "pipe")]);
  spawnSync("env", ["COPYFILE_DISABLE=1", "tar", "-cf", join(dir, "f.tar"), "-C", dir, "pipe"]);
  const fifo = await attempt("fifo", readFileSync(join(dir, "f.tar")), {});
  console.log("fifo:", fifo.includes("is a device, FIFO or another special entry"));
  rmSync(dir, { recursive: true });
}
// case: tar_extract_and_read_back
// expect: a.txt hello
// expect: sub/b.txt bye
// expect: link -> a.txt
// expect: mode 493
// An archive the system's tar made, extracted and read back: files, a directory, a symlink and
// a file's mode.
import { extract, TarError } from "fish:tar";
import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main(): Promise<void> throws IoError | Error | TarError {
  const dir = mkdtempSync(join(tmpdir(), "fish-tar-"));
  mkdirSync(join(dir, "src", "sub"), { recursive: true });
  writeFileSync(join(dir, "src", "a.txt"), "hello");
  writeFileSync(join(dir, "src", "sub", "b.txt"), "bye");
  chmodSync(join(dir, "src", "sub", "b.txt"), 0o755);
  symlinkSync("a.txt", join(dir, "src", "link"));
  spawnSync("env", ["COPYFILE_DISABLE=1", "tar", "-cf", join(dir, "x.tar"), "-C", join(dir, "src"), "a.txt", "sub", "link"]);
  const out = join(dir, "out");
  const _written = await extract(join(dir, "x.tar"), out);
  console.log("a.txt", new TextDecoder().decode(readFileSync(join(out, "a.txt"))));
  console.log("sub/b.txt", new TextDecoder().decode(readFileSync(join(out, "sub", "b.txt"))));
  console.log("link ->", readlinkSync(join(out, "link")));
  console.log("mode", lstatSync(join(out, "sub", "b.txt")).mode & 0o777);
  rmSync(dir, { recursive: true });
}
// case: tar_extract_refuses_escapes
// expect: climbing: '../evil.txt' climbs out of the target, which extract refuses
// expect: absolute link: 'up' is a symlink to the absolute path '/tmp', which extract refuses
// expect: link out: '../../outside' climbs out of the target, which extract refuses
// expect: through a link: 'hop/x.txt' would be written through the symlink 'hop', which extract refuses
// expect: nothing outside: true
// Archives made with each escaping entry are refused, and nothing lands outside the target.
import { extract, pack, TarError } from "fish:tar";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

async function main(): Promise<void> throws IoError | ZlibError | TarError {
  const dir = mkdtempSync(join(tmpdir(), "fish-tar-"));
  // The climbing entry is packed from beside inner, so extracting it into dir/t1 would write
  // dir/evil.txt, which nothing else makes.
  const inner = join(dir, "a", "inner");
  mkdirSync(join(inner, "real"), { recursive: true });
  writeFileSync(join(dir, "a", "evil.txt"), "x");
  writeFileSync(join(inner, "real", "x.txt"), "x");
  symlinkSync("/tmp", join(inner, "up"));
  symlinkSync("../../outside", join(inner, "out"));
  symlinkSync("real", join(inner, "hop"));
  const climbing = await archive(["../evil.txt"], inner);
  await attempt("climbing", climbing, join(dir, "t1"));
  const absolute = await archive(["up"], inner);
  await attempt("absolute link", absolute, join(dir, "t2"));
  const linkOut = await archive(["out"], inner);
  await attempt("link out", linkOut, join(dir, "t3"));
  const through = await archive(["hop", "hop/x.txt"], inner);
  await attempt("through a link", through, join(dir, "t4"));
  console.log("nothing outside:", !existsSync(join(dir, "evil.txt")));
  rmSync(dir, { recursive: true });
}
// case: tar_pack_round_trip
// expect: entries: a.txt file 5 hello | sub/ directory 0 | sub/b.txt file 3 bye
// expect: long: true
// expect: system: a.txt|sub/|sub/b.txt
// expect: system gzip: a.txt|sub/|sub/b.txt
// An archive pack writes reads back through entries() and through the system's tar, plain and
// gzipped, with a long path kept through a PAX header.
import { create, entries, list, TarError } from "fish:tar";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { ZlibError } from "node:zlib";
import { join } from "node:path";

async function main(): Promise<void> throws IoError | ZlibError | Error | TarError {
  const dir = mkdtempSync(join(tmpdir(), "fish-tar-"));
  mkdirSync(join(dir, "src", "sub"), { recursive: true });
  writeFileSync(join(dir, "src", "a.txt"), "hello");
  writeFileSync(join(dir, "src", "sub", "b.txt"), "bye");
  await create(join(dir, "x.tar"), ["a.txt", "sub"], { cwd: join(dir, "src") });
  await create(join(dir, "x.tgz"), ["a.txt", "sub"], { cwd: join(dir, "src"), gzip: true });
  let parts: string[] = [];
  let all = entries(join(dir, "x.tar"));
  for await (const e of all) parts.push(e.path + " " + e.type + " " + String(e.size) + (e.type === "file" ? " " + new TextDecoder().decode(e.data) : ""));
  console.log("entries:", parts.join(" | "));
  const name = "d".repeat(150) + "/" + "f".repeat(120);
  mkdirSync(join(dir, "long", "d".repeat(150)), { recursive: true });
  writeFileSync(join(dir, "long", name), "x");
  await create(join(dir, "long.tar"), [name], { cwd: join(dir, "long") });
  const long = await list(join(dir, "long.tar"));
  console.log("long:", long[0]!.path === name);
  const t = spawnSync("tar", ["-tf", join(dir, "x.tar")]);
  console.log("system:", new TextDecoder().decode(t.stdout).trim().split("\n").join("|"));
  const z = spawnSync("tar", ["-tzf", join(dir, "x.tgz")]);
  console.log("system gzip:", new TextDecoder().decode(z.stdout).trim().split("\n").join("|"));
  rmSync(dir, { recursive: true });
}
