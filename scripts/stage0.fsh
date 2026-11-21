// What stage 0 is: the commit stage0.toml pins and the digest its binary is checked against.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// stage0.toml: the commit stage 0 is built from, and each target's digest of its binary.
export type Pinned = { commit: string; digests: Map<string, string> };

// The repository's stage0.toml, read as the few lines it holds: `commit = "..."`, then
// `"<arch>-<platform>" = "<sha256>"` lines under `[digests]`.
export function pinned(root: string): Pinned throws IoError | Error {
  const text = readFileSync(join(root, "stage0.toml"), "utf8");
  let commit = "";
  let digests = new Map<string, string>();
  let inDigests = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      inDigests = line === "[digests]";
      continue;
    }
    const m = /^"?([\w.-]+)"?\s*=\s*"([^"]*)"$/.exec(line);
    if (m === null) throw new Error(`stage0.toml: can't read '${line}'`);
    if (inDigests) digests.set(m[1]!, m[2]!);
    else if (m[1]! === "commit") commit = m[2]!;
  }
  if (commit === "") throw new Error("stage0.toml names no commit");
  return { commit, digests };
}

// This machine's target as stage0.toml names it.
export function hostKey(): string {
  return `${process.arch}-${process.platform}`;
}

function word(bytes: Ref<u8[]>, at: usize): usize {
  return (bytes[at]! as usize) | ((bytes[at + 1]! as usize) << 8) | ((bytes[at + 2]! as usize) << 16) | ((bytes[at + 3]! as usize) << 24);
}

// The sha256 of a binary without what every link makes anew: a 64-bit Mach-O's LC_UUID zeroed and
// its bytes from the code signature on left out, since two links of the same IR differ only there.
// A file of any other format is hashed whole.
export function stage0Digest(path: string): string throws IoError {
  let bytes = readFileSync(path);
  let end = bytes.length;
  if (bytes.length >= 32 && word(bytes, 0) === 0xfeedfacf) {
    const count = word(bytes, 16);
    let at: usize = 32;
    for (let i: usize = 0; i < count && at + 16 <= bytes.length; i++) {
      const command = word(bytes, at);
      const size = word(bytes, at + 4);
      if (command === 0x1b && at + 24 <= bytes.length) for (let k: usize = 8; k < 24; k++) bytes[at + k] = 0;
      if (command === 0x1d) end = word(bytes, at + 8);
      if (size === 0) break;
      at += size;
    }
  }
  if (end > bytes.length) end = bytes.length;
  return createHash("sha256").update(bytes.slice(0, end as i64)).digest("hex");
}
