import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync, chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { buildAsync, compile, ENGINE, runtimeUnits } from "../src/main.ts";
import { cachedObject, cachedObjectAsync, files, mathObjectsAsync } from "../src/mathlib.ts";
import { STD_SOURCE, stdKey } from "../src/std.ts";
import { newSession } from "../src/compilation.ts";

const session = newSession();

// A fresh cache compiles the Math runtime too, which takes seconds.
setDefaultTimeout(120_000);

const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const COMPILATION = join(import.meta.dir, "..", "src", "compilation.ts");
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
    const built = cachedObject(session, unit!);
    expect(cachedObject(session, unit!)).toBe(built);
    const edited = cachedObject(session, { ...unit!, stdin: `${unit!.stdin}\nint fsh_rt_edited;\n` });
    const flagged = cachedObject(session, { ...unit!, args: [...unit!.args, "-DFSH_FLAGGED"] });
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
    expect(() => cachedObject(session, { name: "broken", args: ["-x", "c", "-"], stdin: "this is not C", inputs: [] })).toThrow("clang failed building broken");
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
import { newSession } from ${JSON.stringify(COMPILATION)};
const session = newSession();
session.engineHook = true;
build(session, ${JSON.stringify(ENGINE_PROGRAM)}, ${JSON.stringify(out)});`;
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
import { newSession } from ${JSON.stringify(COMPILATION)};
const session = newSession();
await Promise.all(${JSON.stringify(outs)}.map((out) => buildAsync(session, ${JSON.stringify(HELLO)}, out)));`;
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
    const before = cachedObject(session, unit());
    appendFileSync(join(copy, "cutils.h"), "\n/* edited */\n");
    expect(cachedObject(session, unit())).not.toBe(before);
  } finally {
    if (was === undefined) delete process.env.FISH_CACHE_DIR;
    else process.env.FISH_CACHE_DIR = was;
  }
});

const STD = join(import.meta.dir, "..", "src", "std.ts");
const HTTP_PROGRAM = join(root, "http.fsh");
writeFileSync(HTTP_PROGRAM, `async function main(): Promise<void> {
  let app = new Router();
  app.get("/users/:id", async (req) => new Response("user " + req.param("id")));
  const res = await app.handle(new Request("http://h/users/7"));
  const body = await res.text();
  console.log(res.status, body);
}
`);

// How many times one session parsed std over two checks with the cache at `cache`.
function stdParsesIn(cache: string): string {
  const script = `import { stdFor } from ${JSON.stringify(STD)};
import { newCompilation, newSession } from ${JSON.stringify(COMPILATION)};
// Each copy's nodes have ids of their own, so the copies are compared without them.
const bare = (v) => Array.isArray(v) ? v.map(bare) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "id").map(([k, x]) => [k, bare(x)])) : v;
const session = newSession();
const [a, b] = [stdFor(newCompilation(session), []), stdFor(newCompilation(session), [])];
if (Bun.deepEquals(bare(a), bare(b))) console.log(session.std.parses);`;
  const run = Bun.spawnSync(["bun", "-e", script], { env: { ...process.env, FISH_CACHE_DIR: cache } });
  expect(run.stderr.toString()).toBe("");
  return run.stdout.toString().trim();
}

function emit(cache: string, file: string): string {
  const run = Bun.spawnSync(["bun", MAIN, "build", file, "--emit-llvm"], { env: { ...process.env, FISH_CACHE_DIR: cache } });
  expect(run.stderr.toString()).toBe("");
  expect(run.exitCode).toBe(0);
  return run.stdout.toString();
}

const stdTrees = (cache: string) => readdirSync(join(cache, "std")).map((f) => join(cache, "std", f));

test("std's parsed tree is cached once and loaded by later builds, with the same IR", () => {
  const cache = join(root, "std-tree");
  expect(stdParsesIn(cache)).toBe("1");
  const [tree] = stdTrees(cache);
  expect(stdTrees(cache)).toHaveLength(1);
  const written = statSync(tree!).mtimeMs;
  expect(stdParsesIn(cache)).toBe("0");
  expect(statSync(tree!).mtimeMs).toBe(written);
  for (const program of [HELLO, HTTP_PROGRAM]) {
    const fresh = join(root, `std-fresh-${program === HELLO ? "hello" : "http"}`);
    expect(emit(cache, program)).toBe(emit(fresh, program));
  }
});

test("a corrupt or truncated cached tree is parsed again and rewritten", () => {
  const cache = join(root, "std-corrupt");
  const expected = emit(cache, HELLO);
  const [tree] = stdTrees(cache);
  const good = readFileSync(tree!);
  for (const bad of [good.subarray(0, good.length / 2), Buffer.from("not a tree"), Buffer.alloc(0)]) {
    writeFileSync(tree!, bad);
    expect(stdParsesIn(cache)).toBe("1");
    expect(readFileSync(tree!).equals(good)).toBe(true);
    writeFileSync(tree!, bad);
    expect(emit(cache, HELLO)).toBe(expected);
  }
  expect(stdTrees(cache)).toEqual([tree!]);
});

test("a change to std or to a compiler source is a new key for std's tree", () => {
  const src = join(root, "src-copy");
  cpSync(join(import.meta.dir, "..", "src"), src, { recursive: true });
  const before = stdKey(STD_SOURCE, src);
  expect(stdKey(STD_SOURCE, src)).toBe(before);
  expect(stdKey(`${STD_SOURCE}\nfunction edited() {}\n`, src)).not.toBe(before);
  appendFileSync(join(src, "parser.ts"), "\n// edited\n");
  expect(stdKey(STD_SOURCE, src)).not.toBe(before);
});

test("std's tree has no key where no compiler source can be read", () => {
  const bare = join(root, "no-sources");
  mkdirSync(bare, { recursive: true });
  writeFileSync(join(bare, "fishc"), "a single-file executable");
  expect(stdKey(STD_SOURCE, bare)).toBeNull();
  expect(stdKey(STD_SOURCE, join(root, "missing"))).toBeNull();
  expect(stdKey(STD_SOURCE, join(import.meta.dir, "..", "src"))).toMatch(/^[0-9a-f]{16}$/);
});

// Runs `run` with the cache at `cache`.
async function cachedInAsync(cache: string, run: () => Promise<void>) {
  const was = process.env.FISH_CACHE_DIR;
  process.env.FISH_CACHE_DIR = cache;
  try {
    await run();
  } finally {
    if (was === undefined) delete process.env.FISH_CACHE_DIR;
    else process.env.FISH_CACHE_DIR = was;
  }
}

const stdObjects = (cache: string) => readdirSync(join(cache, "objects")).filter((f) => f.startsWith("std-")).sort();

// Each build is a process of its own, as a rebuild from the command line is.
test("a dev build keeps std's object across edits to the program's own code", () => {
  const cache = join(root, "split");
  const base = readFileSync(HTTP_PROGRAM, "utf8");
  const file = join(root, "edited.fsh");
  const out = join(root, "edited");
  const built = (src: string) => {
    writeFileSync(file, src);
    fishc(cache, "build", file, "-o", out);
    return Bun.spawnSync([out]).stdout.toString();
  };
  expect(built(base)).toBe("200 user 7\n");
  const first = stdObjects(cache);
  expect(first).toHaveLength(1);
  const edits: [string, string][] = [
    [base.replace('"user "', '"member "'), "200 member 7\n"],
    [base.replace('new Response("user " + req.param("id"))', '{ const id = req.param("id"); return new Response(id + " is a user"); }'), "200 7 is a user\n"],
    [base.replaceAll("body", "text"), "200 user 7\n"],
  ];
  for (const [src, expected] of edits) {
    expect(built(src)).toBe(expected);
    expect(stdObjects(cache)).toEqual(first);
  }
  const aggregate = base.replace("console.log(res.status, body);", "console.log(res.status, body, new AggregateError([1, 2]).errors.length);");
  expect(built(aggregate)).toBe("200 user 7 2\n");
  expect(stdObjects(cache)).toHaveLength(2);
});

// Every 10th case of the test programs that builds and runs as a dev executable, with no C
// library to link and no server to start.
function sampled(): { file: string; src: string }[] {
  const dir = join(import.meta.dir, "programs");
  const cases = readdirSync(dir)
    .filter((f) => f.endsWith(".fsh"))
    .flatMap((f) => readFileSync(join(dir, f), "utf8").split(/^\/\/ case: .*$/m).slice(1).map((src, i) => ({ name: `${f.slice(0, -4)}-${i}`, src })))
    .filter(({ src }) => !/\/\/ (error|mode|link):|serve\(|listen\(/.test(src));
  const folder = join(root, "sampled");
  mkdirSync(folder, { recursive: true });
  return cases
    .filter((_, i) => i % 10 === 0)
    .map(({ name, src }) => {
      const file = join(folder, `${name}.fsh`);
      writeFileSync(file, src);
      return { file, src };
    });
}

// Builds `file` both ways, runs each under the leak check, and gives what each run printed and how
// it ended.
async function bothWays(file: string, src: string) {
  const [split, whole] = [`${file}.split`, `${file}.whole`];
  await buildAsync(session, file, split);
  const ir = compile(session, src, file);
  const objects = (await Promise.all([...runtimeUnits(ir, false).map((u) => cachedObjectAsync(session, u)), mathObjectsAsync(session)])).flat();
  const clang = Bun.spawn(["clang", "-x", "ir", "-", "-x", "none", ...objects, "-funwind-tables", "-pthread", "-o", whole, "-O0", "-lm"], { stdin: new TextEncoder().encode(ir), stderr: "pipe" });
  expect(await clang.exited).toBe(0);
  const run = async (out: string) => {
    const done = Bun.spawn([out], { env: { ...process.env, FISH_LEAKS: "1" }, stdout: "pipe", stderr: "pipe", timeout: 10_000 });
    const [stdout, stderr] = await Promise.all([new Response(done.stdout).text(), new Response(done.stderr).text()]);
    // Tasks that panic together write their reports in whatever order they finish, so stderr is
    // compared as a set of lines.
    return { stdout, stderr: stderr.split("\n").sort().join("\n"), code: await done.exited };
  };
  return [await run(split), await run(whole)];
}

// Each compile in a process starts from the same type state, so a program compiled again after
// others gives the same IR: union order, tags and glue names don't depend on what came before.
test("compiling the same programs again in one process gives identical IR", () => {
  const json = readFileSync(join(import.meta.dir, "programs", "json.fsh"), "utf8");
  const failures = join(root, "json_parse_failures.fsh");
  writeFileSync(failures, json.split(/^\/\/ case: json_parse_failures$/m)[1]!.split(/^\/\/ case: /m)[0]!);
  const programs = [{ file: failures, src: readFileSync(failures, "utf8") }, ...sampled()];
  const rounds = [0, 1, 2].map(() => programs.map((p) => compile(session, p.src, p.file)));
  for (const [i, p] of programs.entries()) {
    expect({ file: p.file, ir: rounds[1]![i] }).toEqual({ file: p.file, ir: rounds[0]![i] });
    expect({ file: p.file, ir: rounds[2]![i] }).toEqual({ file: p.file, ir: rounds[0]![i] });
  }
});

// A process that builds many times, as a test runner or a daemon does, gives std's part the same
// text each time a program is built again, so it links the object it cached the first time.
test("a long-lived process reuses std's object when it builds a program again", async () => {
  const cache = join(root, "long-lived");
  const file = join(root, "long-lived.fsh");
  writeFileSync(file, readFileSync(HTTP_PROGRAM, "utf8"));
  const others = sampled().slice(0, 5);
  await cachedInAsync(cache, async () => {
    await buildAsync(session, file, join(root, "long-lived-1"));
    const first = stdObjects(cache);
    for (const p of others) compile(session, p.src, p.file);
    await buildAsync(session, file, join(root, "long-lived-2"));
    expect(stdObjects(cache)).toEqual(first);
  });
});

test("split and one-module dev builds of sampled test programs behave alike", async () => {
  const programs = sampled();
  expect(programs.length).toBeGreaterThan(50);
  await cachedInAsync(join(root, "sampled-cache"), async () => {
    for (let at = 0; at < programs.length; at += availableParallelism()) {
      const batch = programs.slice(at, at + availableParallelism());
      for (const [i, [split, whole]] of (await Promise.all(batch.map((p) => bothWays(p.file, p.src)))).entries()) {
        expect({ file: batch[i]!.file, ...split }).toEqual({ file: batch[i]!.file, ...whole });
      }
    }
  });
});
