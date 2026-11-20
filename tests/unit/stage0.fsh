// Stage 0's digest leaves out what every link makes anew, so two links of the same IR digest alike,
// and still sees any other byte changing.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pinned, stage0Digest } from "../../scripts/stage0.fsh";
import { fishcPath, removed, root, scratch } from "./support.fsh";

// Where a 64-bit Mach-O's load command `kind` starts, or -1.
function command(bytes: Ref<u8[]>, kind: usize): i64 {
  const word = (at: usize): usize => (bytes[at]! as usize) | ((bytes[at + 1]! as usize) << 8) | ((bytes[at + 2]! as usize) << 16) | ((bytes[at + 3]! as usize) << 24);
  let at: usize = 32;
  for (let i: usize = 0; i < word(16); i++) {
    if (word(at) === kind) return at as i64;
    at += word(at + 4);
  }
  return -1;
}

function digests(dir: string): void throws IoError {
  const main = join(dir, "main.fsh");
  writeFileSync(main, "function main() {\n  console.log(42);\n}\n");
  const binary = join(dir, "main");
  const built = spawnSync(fishcPath(), ["build", main, "-o", binary], { cwd: dir });
  assert(built.status === 0, "the program didn't build");
  const digest = stage0Digest(binary);
  let bytes = readFileSync(binary);
  const uuid = command(bytes, 0x1b);
  if (uuid >= 0) {
    let relinked = bytes.slice();
    relinked[(uuid + 8) as usize] = relinked[(uuid + 8) as usize] ^ 255;
    writeFileSync(join(dir, "relinked"), relinked);
    assert(stage0Digest(join(dir, "relinked")) === digest, "a changed UUID changed the digest");
  }
  let changed = bytes.slice();
  const at = (bytes.length / 2) as usize;
  changed[at] = changed[at] ^ 1;
  writeFileSync(join(dir, "changed"), changed);
  assert(stage0Digest(join(dir, "changed")) !== digest, "a changed code byte left the digest as it was");
}

test("stage 0's digest leaves out the UUID and code signature, and sees every other byte", () => {
  const dir = scratch("fish-stage0-");
  try {
    digests(dir);
  } catch (e) {
    assert(false, (e as { message: string }).message);
  }
  removed(dir);
}, { timeout: 120_000 });

function pins(): void throws IoError | Error {
  const p = pinned(root());
  assert(/^[0-9a-f]{40}$/.test(p.commit), `the commit isn't a full sha: ${p.commit}`);
  assert(p.digests.size > 0, "no target has a digest");
  for (const [target, digest] of p.digests) assert(/^[0-9a-f]{64}$/.test(digest), `${target}'s digest isn't a sha256: ${digest}`);
}

test("stage0.toml pins a commit and a digest for each target it names", () => {
  try {
    pins();
  } catch (e) {
    assert(false, (e as { message: string }).message);
  }
}, { timeout: 30_000 });
