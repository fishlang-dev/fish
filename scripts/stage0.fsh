// What stage 0 is: the commit stage0.toml pins and the digest its binary is checked against.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// stage0.toml: the commit stage 0 is built from and each target's digest of its binary. Once stage 0
// is a release, also its tag, where releases are downloaded from, each target's sha256 of the
// release's tarball, and the chain of commits it can be built from instead: the first built from
// TypeScript by Bun, each later one by the one before.
export type Pinned = { commit: string; digests: Map<string, string>; release?: string; releases?: string; tarballs: Map<string, string>; chain: string[] };

// The repository's stage0.toml, read as the few lines it holds: `key = "..."` lines, `chain` as a
// list of strings, then `"<arch>-<platform>" = "<sha256>"` lines under `[digests]` and `[tarballs]`.
export function pinned(root: string): Pinned throws IoError | Error {
  const text = readFileSync(join(root, "stage0.toml"), "utf8");
  let p: Pinned = { commit: "", digests: new Map<string, string>(), tarballs: new Map<string, string>(), chain: [] };
  let section = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("[") && line.endsWith("]") && !line.includes("=")) {
      section = line;
      continue;
    }
    const list = /^chain\s*=\s*\[(.*)\]$/.exec(line);
    if (list !== null && section === "") {
      for (const item of list[1]!.split(",")) {
        const quoted = /^\s*"([0-9a-f]+)"\s*$/.exec(item);
        if (quoted !== null) p.chain.push(quoted[1]!);
      }
      continue;
    }
    const m = /^"?([\w.-]+)"?\s*=\s*"([^"]*)"$/.exec(line);
    if (m === null) throw new Error(`stage0.toml: can't read '${line}'`);
    if (section === "[digests]") p.digests.set(m[1]!, m[2]!);
    else if (section === "[tarballs]") p.tarballs.set(m[1]!, m[2]!);
    else if (m[1]! === "commit") p.commit = m[2]!;
    else if (m[1]! === "release") p.release = m[2]!;
    else if (m[1]! === "releases") p.releases = m[2]!;
  }
  if (p.commit === "") throw new Error("stage0.toml names no commit");
  return p;
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

// The release tarball of `release` for `target`, as release.fsh names it.
export function tarballName(release: string, target: string): string {
  return `fishc-${release.startsWith("v") ? release.slice(1) : release}-${target}.tar.gz`;
}

// stage0.toml written from `p`, the form pinned() reads.
export function written(p: Ref<Pinned>): string {
  let out = "# The fishc that builds the compiler: the commit it is built from, and for each target the sha256\n";
  out += "# of its binary with the Mach-O UUID zeroed and the code signature left out, which every link makes\n";
  out += "# anew. Once stage 0 is a release, bootstrap.sh downloads its tarball and checks it against\n";
  out += "# [tarballs]; `chain` rebuilds it from source instead, its first commit built from TypeScript by\n";
  out += "# Bun and each later one by the one before. Changed by scripts/promote.fsh.\n";
  out += `commit = "${p.commit}"\n`;
  if (p.release !== undefined) out += `release = "${p.release!}"\n`;
  if (p.releases !== undefined) out += `releases = "${p.releases!}"\n`;
  if (p.chain.length > 0) out += `chain = [${p.chain.map((c) => `"${c}"`).join(", ")}]\n`;
  out += "\n[digests]\n";
  for (const [k, v] of p.digests) out += `"${k}" = "${v}"\n`;
  if (p.tarballs.size > 0) {
    out += "\n[tarballs]\n";
    for (const [k, v] of p.tarballs) out += `"${k}" = "${v}"\n`;
  }
  return out;
}
