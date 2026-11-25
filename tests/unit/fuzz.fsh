// `fishc fuzz`: top-level `fuzz()` blocks stripped from normal builds, compiled with libFuzzer,
// and run to find panics and uncaught errors with reproducing inputs.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fishc, removed, scratch, text } from "./support.fsh";

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function makeDir(path: string): void {
  try {
    mkdirSync(path, { recursive: true });
  } catch (e) {
    assert(false, `can't mkdir ${path}: ${e.message}`);
  }
}

function listDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch (e) {
    assert(false, `can't readdir ${path}: ${e.message}`);
    return [];
  }
}

function readBytes(path: string): u8[] {
  try {
    return readFileSync(path);
  } catch (e) {
    assert(false, `can't read ${path}: ${e.message}`);
    return [];
  }
}

test("fishc fuzz finds a planted panic bug, reports the reproducing input, and replays it", () => {
  const dir = scratch("fish-fuzz-panic-");
  try {
    const file = join(dir, "target.fsh");
    const artifacts = join(dir, "artifacts");
    write(
      file,
      `function checkMagic(data: Ref<u8[]>) {
  if (data.length >= 4 && data[0] === 70 && data[1] === 73 && data[2] === 83 && data[3] === 72) {
    assert(false, "found FISH magic");
  }
}

fuzz("magic", (data) => {
  checkMagic(data);
});

function main() {
  console.log("normal build works");
}
`,
    );
    // Normal build strips fuzz() blocks and runs cleanly.
    const bin = join(dir, "app");
    const built = fishc(dir, ["build", file, "-o", bin]);
    assert(built.code === 0, `normal build failed: ${built.err}`);
    const ran = spawnSync(bin, [], { cwd: dir });
    assert(ran.status === 0, "normal binary exited non-zero");
    assert(text(ran.stdout).includes("normal build works"), "normal binary output mismatch");

    // --list discovers the fuzz target without running clang.
    const listed = fishc(dir, ["fuzz", file, "--list"]);
    assert(listed.code === 0, `fuzz --list failed: ${listed.err}`);
    assert(listed.out.includes("target.fsh > magic"), `unexpected --list output: ${listed.out}`);

    // Coverage-guided fuzzing finds the 4-byte FISH magic and reports the reproducer.
    const fuzzed = fishc(dir, ["fuzz", file, "--artifacts", artifacts, "--max-time", "30"]);
    assert(fuzzed.code === 1, `expected crash exit 1, got ${fuzzed.code}: ${fuzzed.out}\n${fuzzed.err}`);
    assert(fuzzed.err.includes("found FISH magic"), `missing panic message: ${fuzzed.err}`);
    assert(fuzzed.err.includes("FAIL "), `missing FAIL summary: ${fuzzed.err}`);
    assert(fuzzed.err.includes("reproducing input:"), `missing reproducer path: ${fuzzed.err}`);
    assert(fuzzed.err.includes("46 49 53 48"), `missing hex magic in reproducer: ${fuzzed.err}`);

    // Find the saved crash artifact and replay it directly.
    const files = listDir(artifacts).filter((f) => f.startsWith("crash-"));
    assert(files.length > 0, `no crash artifact saved in ${artifacts}`);
    const crashPath = join(artifacts, files[0]!);
    const bytes = readBytes(crashPath);
    assert(bytes.length >= 4 && bytes[0] === 70 && bytes[1] === 73 && bytes[2] === 83 && bytes[3] === 72, "saved artifact did not contain FISH magic");

    const replayed = fishc(dir, ["fuzz", file, "--replay", crashPath]);
    assert(replayed.code === 1, `expected replay crash exit 1, got ${replayed.code}`);
    assert(replayed.err.includes("found FISH magic"), `replay did not reproduce panic: ${replayed.err}`);
  } finally {
    removed(dir);
  }
}, { timeout: 60_000 });

test("fishc fuzz passes a clean target under --runs and supports Ref<u8[]> and --no-asan", () => {
  const dir = scratch("fish-fuzz-clean-");
  try {
    const file = join(dir, "clean.fsh");
    const corpus = join(dir, "corpus");
    write(
      file,
      `fuzz("sum", (data: Ref<u8[]>) => {
  let acc: usize = 0;
  for (let i: usize = 0; i < data.length; i++) {
    acc = (acc + (data[i]! as usize)) & 0xffff;
  }
  assert(acc <= 0xffff);
});
`,
    );
    const res = fishc(dir, ["fuzz", file, "--runs", "300", "--corpus", corpus, "--no-asan"]);
    assert(res.code === 0, `clean fuzz failed: ${res.out}\n${res.err}`);
    assert(res.out.includes("ok ") && res.out.includes("> sum"), `missing ok line: ${res.out}`);
    assert(existsSync(corpus), "corpus directory should be created");
  } finally {
    removed(dir);
  }
}, { timeout: 60_000 });

test("fishc fuzz catches uncaught Error throws and discovers targets in a package", () => {
  const dir = scratch("fish-fuzz-pkg-");
  try {
    makeDir(join(dir, "src"));
    write(join(dir, "fish.toml"), `[package]\nname = "fuzzpkg"\nversion = "0.1.0"\n`);
    write(
      join(dir, "src", "main.fsh"),
      `function parseTag(data: u8[]): void throws Error {
  if (data.length >= 2 && data[0] === 0xde && data[1] === 0xad) {
    throw new Error("bad tag");
  }
}

fuzz("tag", (data) => {
  parseTag(data);
});

fuzz("safe", (data: Uint8Array) => {
  if (data.length > 0 && data[0] === 0) return;
});

function main() {}
`,
    );
    const listed = fishc(dir, ["fuzz", "--list"]);
    assert(listed.code === 0, `pkg --list failed: ${listed.err}`);
    assert(listed.out.includes("> tag") && listed.out.includes("> safe"), `missing targets in list: ${listed.out}`);

    // Ambiguous multiple targets without --runs/--max-time fails with exit 2.
    const amb = fishc(dir, ["fuzz"]);
    assert(amb.code === 2, `expected exit 2 for multiple targets without limit, got ${amb.code}`);

    // Filtering to "tag" catches the thrown Error and saves a reproducer.
    const artifacts = join(dir, "art");
    const hit = fishc(dir, ["fuzz", "tag", "--artifacts", artifacts, "--max-time", "20"]);
    assert(hit.code === 1, `expected crash on thrown Error, got ${hit.code}: ${hit.err}`);
    assert(hit.err.includes("Error: bad tag"), `missing thrown Error text: ${hit.err}`);
    assert(hit.err.includes("de ad"), `missing hex bytes de ad: ${hit.err}`);
  } finally {
    removed(dir);
  }
}, { timeout: 60_000 });

test("fishc fuzz rejects async targets, wrong parameter types, and malformed fuzz() blocks", () => {
  const dir = scratch("fish-fuzz-bad-");
  try {
    const asyncFile = join(dir, "async.fsh");
    write(asyncFile, `fuzz("a", async (data) => {});\n`);
    const r1 = fishc(dir, ["fuzz", asyncFile, "--list"]);
    assert(r1.code === 1 && r1.err.includes("can't be async"), `expected async refusal: ${r1.err}`);

    const wrongType = join(dir, "wrong.fsh");
    write(wrongType, `fuzz("w", (s: string) => {});\n`);
    const r2 = fishc(dir, ["fuzz", wrongType, "--list"]);
    assert(r2.code === 1 && r2.err.includes("must be 'u8[]'"), `expected param type refusal: ${r2.err}`);

    const dup = join(dir, "dup.fsh");
    write(dup, `fuzz("d", (a) => {});\nfuzz("d", (b) => {});\n`);
    const r3 = fishc(dir, ["fuzz", dup, "--list"]);
    assert(r3.code === 1 && r3.err.includes("already a fuzz target named 'd'"), `expected duplicate refusal: ${r3.err}`);
  } finally {
    removed(dir);
  }
});
