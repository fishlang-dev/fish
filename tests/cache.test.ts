import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync, chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENGINE, runtimeUnits } from "../src/main.ts";
import { cachedObject, files } from "../src/mathlib.ts";

// A fresh cache compiles the Math runtime too, which takes seconds.
setDefaultTimeout(120_000);

const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const root = mkdtempSync(join(tmpdir(), "fish-cache-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const HELLO = join(root, "hello.fsh");
writeFileSync(HELLO, `function main() { console.log("hello"); }\n`);

function fishc(cache: string, ...args: string[]) {
  const run = Bun.spawnSync(["bun", MAIN, ...args], { env: { ...process.env, FISH_CACHE_DIR: cache } });
  expect(run.stderr.toString()).toBe("");
  expect(run.exitCode).toBe(0);
}

// The runtime objects in `cache`, each with its modification time.
const runtimes = (cache: string) =>
  readdirSync(join(cache, "objects"))
    .filter((f) => f.startsWith("runtime"))
    .sort()
    .map((f) => [f, statSync(join(cache, "objects", f)).mtimeMs]);

test("the runtime is compiled once per cache, and once more for a release build", () => {
  const cache = join(root, "cache");
  const out = join(root, "hello");
  fishc(cache, "build", HELLO, "-o", out);
  const first = runtimes(cache);
  expect(first).toHaveLength(1);
  fishc(cache, "build", HELLO, "-o", out);
  expect(runtimes(cache)).toEqual(first);
  expect(Bun.spawnSync([out]).stdout.toString()).toBe("hello\n");
  fishc(cache, "build", HELLO, "-o", out, "--release");
  expect(runtimes(cache)).toHaveLength(2);
  expect(Bun.spawnSync([out]).stdout.toString()).toBe("hello\n");
  expect(readdirSync(join(cache, "objects")).filter((f) => !f.endsWith(".o"))).toEqual([]);
});

test("a change to the runtime's source or flags is a new object", () => {
  const was = process.env.FISH_CACHE_DIR;
  process.env.FISH_CACHE_DIR = join(root, "unit");
  try {
    const [unit] = runtimeUnits("", false);
    const built = cachedObject(unit!);
    expect(cachedObject(unit!)).toBe(built);
    const edited = cachedObject({ ...unit!, stdin: `${unit!.stdin}\nint fsh_rt_edited;\n` });
    const flagged = cachedObject({ ...unit!, args: [...unit!.args, "-DFSH_FLAGGED"] });
    expect(new Set([built, edited, flagged]).size).toBe(3);
    expect(readdirSync(join(root, "unit", "objects"))).toHaveLength(3);
  } finally {
    if (was === undefined) delete process.env.FISH_CACHE_DIR;
    else process.env.FISH_CACHE_DIR = was;
  }
});

test("a failed compile leaves nothing in the cache", () => {
  const was = process.env.FISH_CACHE_DIR;
  process.env.FISH_CACHE_DIR = join(root, "failed");
  try {
    expect(() => cachedObject({ name: "broken", args: ["-x", "c", "-"], stdin: "this is not C", inputs: [] })).toThrow("clang failed building broken");
    expect(readdirSync(join(root, "failed", "objects"))).toEqual([]);
  } finally {
    if (was === undefined) delete process.env.FISH_CACHE_DIR;
    else process.env.FISH_CACHE_DIR = was;
  }
});

test("static and shared libraries link the cached runtime, built position-independent", () => {
  const cache = join(root, "lib");
  const lib = join(root, "adder.fsh");
  writeFileSync(lib, `export function add(a: i32, b: i32): i32 { return a + b; }\n`);
  fishc(cache, "build", lib, "-o", join(root, "adder"), "--lib=static");
  const first = runtimes(cache);
  expect(first).toHaveLength(1);
  fishc(cache, "build", lib, "-o", join(root, "adder"), "--lib=shared");
  expect(runtimes(cache)).toEqual(first);
  const archive = Bun.spawnSync(["ar", "t", join(root, "libadder.a")]).stdout.toString();
  expect(archive).toContain(first[0]![0] as string);
  const c = join(root, "use.c");
  writeFileSync(c, `#include "adder.h"\n#include <stdio.h>\nint main(void) { printf("%d\\n", add(2, 3)); }\n`);
  const out = join(root, "use");
  expect(Bun.spawnSync(["clang", c, "-I", root, join(root, "libadder.a"), "-lm", "-pthread", "-o", out]).exitCode).toBe(0);
  expect(Bun.spawnSync([out]).stdout.toString()).toBe("5\n");
  fishc(cache, "build", HELLO, "-o", join(root, "hello-pie"));
  expect(runtimes(cache)).toHaveLength(2);
});

const ENGINE_PROGRAM = join(root, "engine.fsh");
writeFileSync(ENGINE_PROGRAM, `import { evaluate } from "fish:engine";\nfunction main() {\n  const v = evaluate("export default 1;");\n  console.log("ok");\n}\n`);

// Builds the program calling the engine into `out` with the cache at `cache`, from `cwd`.
function buildEngine(cache: string, out: string, cwd = root) {
  const script = `import { build } from ${JSON.stringify(MAIN)};
import { allowEngineHook } from ${JSON.stringify(join(import.meta.dir, "..", "src", "modules.ts"))};
allowEngineHook(true);
build(${JSON.stringify(ENGINE_PROGRAM)}, ${JSON.stringify(out)});`;
  const run = Bun.spawnSync(["bun", "-e", script], { cwd, env: { ...process.env, FISH_CACHE_DIR: cache } });
  expect(run.stderr.toString()).toBe("");
  expect(run.exitCode).toBe(0);
  expect(Bun.spawnSync([out]).stdout.toString()).toBe("ok\n");
}

test("a program calling the JS engine compiles the engine once", () => {
  const cache = join(root, "engine");
  const out = join(root, "engine-bin");
  const engine = () => readdirSync(join(cache, "objects")).filter((f) => /^(quickjs|libregexp|libunicode|dtoa|runtime-js)-/.test(f)).sort().map((f) => [f, statSync(join(cache, "objects", f)).mtimeMs]);
  buildEngine(cache, out);
  const first = engine();
  expect(first).toHaveLength(5);
  buildEngine(cache, out);
  expect(engine()).toEqual(first);
});

test("headers in the working directory never reach a cached object", () => {
  const evil = join(root, "evil");
  mkdirSync(join(evil, "shared", "math"), { recursive: true });
  for (const header of ["quickjs.h", "cutils.h", "shared/math/acos.h"]) writeFileSync(join(evil, header), `#error poisoned\nint fsh_poisoned = 1;\n`);
  const cache = join(root, "poison");
  buildEngine(cache, join(root, "poison-bin"), evil);
  for (const f of readdirSync(join(cache, "objects"))) expect(readFileSync(join(cache, "objects", f)).includes("fsh_poisoned")).toBe(false);
});

test("builds running at once compile each object once", () => {
  const cache = join(root, "concurrent");
  const bin = join(root, "shim");
  const log = join(root, "clang.log");
  mkdirSync(bin);
  writeFileSync(join(bin, "clang"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(Bun.which("clang")!)} "$@"\n`);
  chmodSync(join(bin, "clang"), 0o755);
  const outs = [1, 2, 3, 4].map((i) => join(root, `concurrent-${i}`));
  const script = `import { buildAsync } from ${JSON.stringify(MAIN)};
await Promise.all(${JSON.stringify(outs)}.map((out) => buildAsync(${JSON.stringify(HELLO)}, out)));`;
  const run = Bun.spawnSync(["bun", "-e", script], { env: { ...process.env, FISH_CACHE_DIR: cache, PATH: `${bin}:${process.env.PATH}` } });
  expect(run.stderr.toString()).toBe("");
  expect(run.exitCode).toBe(0);
  for (const out of outs) expect(Bun.spawnSync([out]).stdout.toString()).toBe("hello\n");
  const compiles = readFileSync(log, "utf8").split("\n").filter((line) => / -c -o /.test(line));
  const objects = readdirSync(join(cache, "objects"));
  expect(objects.every((f) => f.endsWith(".o"))).toBe(true);
  expect(compiles).toHaveLength(objects.length);
  expect(compiles.filter((line) => line.includes("/runtime-"))).toHaveLength(1);
});

test("an edit to a hashed engine header is a new object", () => {
  const ir = "  call void @fsh_rt_js_eval()";
  for (const unit of runtimeUnits(ir, false)) expect(unit.inputs).toEqual(files(ENGINE));
  const was = process.env.FISH_CACHE_DIR;
  process.env.FISH_CACHE_DIR = join(root, "header");
  try {
    const copy = join(root, "engine-copy");
    cpSync(ENGINE, copy, { recursive: true });
    const unit = () => ({ name: "header", args: ["-x", "c", "-", "-I", copy], stdin: `#include "quickjs.h"\nint fsh_probe;\n`, inputs: files(copy) });
    const before = cachedObject(unit());
    appendFileSync(join(copy, "cutils.h"), "\n/* edited */\n");
    expect(cachedObject(unit())).not.toBe(before);
  } finally {
    if (was === undefined) delete process.env.FISH_CACHE_DIR;
    else process.env.FISH_CACHE_DIR = was;
  }
});
