// case: tar_list_system_archives
// expect: plain: a.txt file 5 | sub/ directory 0 | sub/b.txt file 3
// expect: gzip: a.txt file 5 | sub/ directory 0 | sub/b.txt file 3
// expect: long: 120 true
// expect: stream: 3 entries
// Archives the system's tar made, plain and gzipped, from a path, bytes and a stream, and a
// path past ustar's 100 bytes.
import { list, entries } from "fish:tar";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function shown(headers: Ref<{ path: string; type: string; size: i64 }[]>): string {
  let parts: string[] = [];
  for (const h of headers) parts.push(h.path + " " + h.type + " " + String(h.size));
  parts.sort();
  return parts.join(" | ");
}

async function* chunked(bytes: u8[]): AsyncGenerator<u8[]> {
  for (let at = 0; at < (bytes.length as i64); at += 700) yield bytes.slice(at, at + 700);
}

async function main(): Promise<void> throws IoError | Error {
  const dir = mkdtempSync(join(tmpdir(), "fish-tar-"));
  mkdirSync(join(dir, "src", "sub"), { recursive: true });
  writeFileSync(join(dir, "src", "a.txt"), "hello");
  writeFileSync(join(dir, "src", "sub", "b.txt"), "bye");
  const env = { COPYFILE_DISABLE: "1", PATH: process.env.PATH ?? "/usr/bin:/bin" };
  spawnSync("tar", ["-cf", join(dir, "x.tar"), "-C", join(dir, "src"), "a.txt", "sub"], { env });
  spawnSync("tar", ["-czf", join(dir, "x.tgz"), "-C", join(dir, "src"), "a.txt", "sub"], { env });
  const plain = await list(join(dir, "x.tar"));
  console.log("plain:", shown(plain));
  const gz = await list(readFileSync(join(dir, "x.tgz")));
  console.log("gzip:", shown(gz));
  const name = "d".repeat(60) + "/" + "f".repeat(59);
  mkdirSync(join(dir, "long", "d".repeat(60)), { recursive: true });
  writeFileSync(join(dir, "long", name), "x");
  spawnSync("tar", ["-cf", join(dir, "long.tar"), "-C", join(dir, "long"), name], { env });
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
import { list } from "fish:tar";
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

async function main(): Promise<void> throws IoError {
  const dir = mkdtempSync(join(tmpdir(), "fish-tar-"));
  writeFileSync(join(dir, "a.txt"), "hello");
  writeFileSync(join(dir, "z.txt"), "0".repeat(100000));
  const env = { COPYFILE_DISABLE: "1", PATH: process.env.PATH ?? "/usr/bin:/bin" };
  spawnSync("tar", ["-cf", join(dir, "x.tar"), "-C", dir, "a.txt", "z.txt"], { env });
  spawnSync("tar", ["-czf", join(dir, "z.tgz"), "-C", dir, "z.txt"], { env });
  let bytes = readFileSync(join(dir, "x.tar"));
  let corrupt = bytes.clone();
  corrupt[3] = 120;
  console.log(await attempt("checksum", corrupt, {}));
  console.log(await attempt("entries", bytes.clone(), { maxEntries: 1 }));
  console.log(await attempt("bytes", bytes.clone(), { maxBytes: 4 }));
  const ratio = await attempt("ratio", readFileSync(join(dir, "z.tgz")), { maxRatio: 2 });
  console.log("ratio:", ratio.includes("unpacks past its limits"));
  spawnSync("mkfifo", [join(dir, "pipe")]);
  spawnSync("tar", ["-cf", join(dir, "f.tar"), "-C", dir, "pipe"], { env });
  const fifo = await attempt("fifo", readFileSync(join(dir, "f.tar")), {});
  console.log("fifo:", fifo.includes("is a device, FIFO or another special entry"));
  rmSync(dir, { recursive: true });
}
