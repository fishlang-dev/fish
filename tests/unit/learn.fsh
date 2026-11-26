// `fishc learn`: each exercise fails with the error it teaches until it is fixed, and the command
// writes them and goes through them in order.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CompileError } from "../../src/diag.fsh";
import { EXERCISES, exerciseText, type Exercise } from "../../src/learn.fsh";
import { analyze } from "../../src/main.fsh";
import { cachedSession } from "../../src/mathlib.fsh";
import { fishc, read, removed, same, scratch } from "./support.fsh";

// The code of the first error checking `src` gives, or "" when it checks.
function errorOf(dir: string, name: string, src: string): string {
  const file = join(dir, name);
  try {
    writeFileSync(file, src);
    analyze(cachedSession(), src, file);
    return "";
  } catch (e) {
    if (e instanceof CompileError) return e.errors.length > 0 ? e.errors[0]!.code : e.code;
    assert(false, `${name}: ${e.message}`);
    return "";
  }
}

test("each exercise fails with the error it teaches as given, and compiles once solved", () => {
  const dir = scratch("fish-learn-");
  const all = EXERCISES;
  for (let i: usize = 0; i < all.length; i++) {
    const e: Ref<Exercise> = all[i]!;
    same(errorOf(dir, e.file, exerciseText(i, e)), e.error, `${e.file} as given`);
    same(errorOf(dir, e.file, e.solved), "", `${e.file} solved`);
  }
  removed(dir);
}, { timeout: 300_000 });

test("fishc learn writes the exercises, shows the first that doesn't compile, and gives its hint", () => {
  const dir = scratch("fish-learn-");
  const all = EXERCISES;
  const first = fishc(dir, ["learn", "--check"]);
  assert(first.code === 1 && first.out.startsWith(`exercise 1 of ${all.length}: fish-learn/01_moves.fsh\n`) && first.err.includes("error[E0201]"), `${first.code}\n${first.out}\n${first.err}`);
  same(read(join(dir, "fish-learn", all[1]!.file)), exerciseText(1, all[1]!), "the second exercise as written");
  same(fishc(dir, ["learn", "hint"]).out, `fish-learn/01_moves.fsh: ${all[0]!.hint}\n`, "the first hint");
  try {
    mkdirSync(join(dir, "fish-learn"), { recursive: true });
    for (const e of all) writeFileSync(join(dir, "fish-learn", e.file), e.solved);
  } catch (e) {
    assert(false, e.message);
  }
  const done = fishc(dir, ["learn", "--check"]);
  same(`${done.code} ${done.out}`, `0 every one of the ${all.length} exercises compiles; you've finished the tutorial\n`, "every exercise solved");
  removed(dir);
}, { timeout: 300_000 });
