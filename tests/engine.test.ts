import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENGINE, ENGINE_SOURCES } from "../src/main.ts";

// The vendored engine on its own, as clang builds it into a program that calls it.
test("the vendored engine evaluates JS", () => {
  const dir = mkdtempSync(join(tmpdir(), "fish-engine-"));
  try {
    const main = join(dir, "main.c");
    writeFileSync(main, `#include "quickjs.h"
#include <stdio.h>
int main(void) {
  JSRuntime *rt = JS_NewRuntime();
  JSContext *cx = JS_NewContext(rt);
  JSValue v = JS_Eval(cx, "[1, 2, 3].map((x) => x * 2).join(',')", 36, "<test>", JS_EVAL_TYPE_GLOBAL);
  const char *s = JS_ToCString(cx, v);
  puts(s);
  JS_FreeCString(cx, s);
  JS_FreeValue(cx, v);
  JS_FreeContext(cx);
  JS_FreeRuntime(rt);
}
`);
    const out = join(dir, "main");
    const built = Bun.spawnSync(["clang", "-I", ENGINE, main, ...ENGINE_SOURCES, "-lm", "-pthread", "-o", out]);
    expect(built.exitCode).toBe(0);
    expect(Bun.spawnSync([out]).stdout.toString()).toBe("2,4,6\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
