// Lock-order checking is compiled into debug builds only.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile, runtimeUnits } from "../../src/main.fsh";
import { cachedSession } from "../../src/mathlib.fsh";
import { removed, scratch } from "./support.fsh";

const PROGRAM = `function main() {
  const a = new Lock(1);
  const s = shared({ n: 0 });
  a.update((x) => { s.update((v) => { v.n += x; }); });
}
`;

function irOf(tmp: string, release: boolean): string {
  const file = join(tmp, "main.fsh");
  try {
    writeFileSync(file, PROGRAM);
    return compile(cachedSession(), PROGRAM, file, release);
  } catch (e) {
    assert(false, `main.fsh: ${e.message}`);
    return "";
  }
}

function checking(ir: string, release: boolean): boolean {
  try {
    return runtimeUnits([ir], release).some((u) => (u.stdin ?? "").startsWith("#define FSH_LOCK_ORDER"));
  } catch (e) {
    assert(false, `runtimeUnits: ${e.message}`);
    return false;
  }
}

test("a debug build checks lock order and a release build compiles none of it", () => {
  const tmp = scratch("fish-lockorder-");
  const debug = irOf(tmp, false);
  const release = irOf(tmp, true);
  assert(debug.includes("call i32 @fsh_rt_lock_at("), "the debug build doesn't take its locks through fsh_rt_lock_at");
  assert(debug.includes("call i32 @fsh_rt_lock_new("), "the debug build gives its locks no ids");
  assert(checking(debug, false), "the debug runtime isn't built with lock-order checking");
  assert(!release.includes("call i32 @fsh_rt_lock_at(") && !release.includes("call i32 @fsh_rt_lock_new("), "the release build calls lock-order checking");
  assert(release.includes("call i32 @fsh_rt_lock("), "the release build doesn't take its locks with fsh_rt_lock");
  assert(!checking(release, true), "the release runtime is built with lock-order checking");
  removed(tmp);
}, { timeout: 60_000 });
