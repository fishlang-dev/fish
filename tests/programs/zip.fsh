// case: zip_list_system_archives
// expect: a.txt file 5 | sub/ directory 0 | sub/b.txt file 3000
// expect: a.txt hello
// expect: stream: 3 entries
// Archives the system's zip made, listed from a path and read from a stream, a deflated file's
// data read back.
import { entries, list } from "fish:zip";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function* chunked(bytes: u8[]): AsyncGenerator<u8[]> {
  for (let at = 0; at < (bytes.length as i64); at += 300) yield bytes.slice(at, at + 300);
}

async function main(): Promise<void> throws IoError | Error {
  const dir = mkdtempSync(join(tmpdir(), "fish-zip-"));
  mkdirSync(join(dir, "src", "sub"), { recursive: true });
  writeFileSync(join(dir, "src", "a.txt"), "hello");
  writeFileSync(join(dir, "src", "sub", "b.txt"), "b".repeat(3000));
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
import { list } from "fish:zip";
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

async function main(): Promise<void> throws IoError {
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
