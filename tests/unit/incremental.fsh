// `fishc watch` keeps each build's check for the next: a rebuild of a program whose files all read
// as they did checks nothing again, and one after an edit checks afresh.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Kept } from "../compiler/incremental.fsh";
import { builtKept } from "../compiler/main.fsh";
import { cachedSession } from "../compiler/stdcache.fsh";
import { hostTarget } from "../compiler/target.fsh";
import { removed, scratch, text } from "./support.fsh";

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function output(binary: string): string {
  const r = spawnSync(binary, []);
  return text(r.stdout);
}

// One of watch's builds of `entry` into `out`, from `kept`, giving what it keeps and the files it read.
function rebuild(entry: string, out: string, kept: Kept | undefined): [Kept, string[]] throws Error {
  let looked: string[] = [];
  try {
    let made = builtKept(cachedSession(), entry, out, false, "unwind", [], hostTarget(), false, false, looked, kept, undefined);
    return [made.kept, looked];
  } catch (e) {
    throw new Error(`the build failed: ${(e as { message: string }).message}`);
  }
}

const MAIN = `import { twice } from "./lib.fsh";

function main() {
  console.log(twice(21));
}
`;

test("a rebuild with every file as it was checks nothing again, and one after an edit checks afresh", () => {
  const dir = scratch("fish-incremental-");
  write(join(dir, "main.fsh"), MAIN);
  write(join(dir, "lib.fsh"), "export function twice(n: i64): i64 { return n * 2; }\n");
  const entry = join(dir, "main.fsh");
  const out = join(dir, "main");
  let [first, _looked] = rebuild(entry, out, undefined);
  assert(output(out) === "42\n", `the first build printed ${output(out)}`);
  const checks = first.checked.tables.counts.checks;
  assert(checks > 0, "the first build checked nothing");
  let [second, again] = rebuild(entry, out, first);
  assert(second.checked.tables.counts.checks === checks, `the rebuild checked ${second.checked.tables.counts.checks - checks} instances again`);
  assert(output(out) === "42\n", `the rebuild printed ${output(out)}`);
  assert(again.some((f) => f.endsWith("lib.fsh")), `the rebuild doesn't say it read lib.fsh: ${again.join(", ")}`);
  write(join(dir, "lib.fsh"), "export function twice(n: i64): i64 { return n + n + 1; }\n");
  let [third, _edited] = rebuild(entry, out, second);
  assert(third.checked.tables.counts.checks > 0, "the build after an edit checked nothing");
  assert(output(out) === "43\n", `the build after an edit printed ${output(out)}`);
  removed(dir);
}, { timeout: 120_000 });
