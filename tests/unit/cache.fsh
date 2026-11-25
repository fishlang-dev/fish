// The object cache, through the native fishc where a build from the command line shows it, and in
// process where a test calls the compiler. Fish can't set `process.env` yet, so a test that moves
// FISH_CACHE_DIR or PATH for its in-process builds runs itself again in a child process with them
// set: `again` starts this test binary on the same test, FISH_CACHE_TEST_ROOT naming the directory
// the parent made, and fails with the child's output. std's parsed-tree cache isn't tested here:
// that cache is stdcache.ts's alone, and a compiler built by Fish parses std in each session. The
// slower tests take two-minute limits.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { argv } from "node:process";
import { CompileError, formatError } from "../../src/diag.fsh";
import { build, buildAsync, compile, engineDir, runtimeLinks, runtimeUnits } from "../../src/main.fsh";
import { buildSession, cachedObject, cachedObjectAsync, files, mathObjectsAsync, type Unit } from "../../src/mathlib.fsh";
import { checkKey, checkPath, readCheck, readEnvelope, writeCheck, writtenEnvelope, type Envelope } from "../../src/checkcache.fsh";
import { newSession } from "../../src/compilation.fsh";
import { hostTarget } from "../../src/target.fsh";
import { cachedSession } from "../../src/stdcache.fsh";
import { fishcPath, read, removed, root as repo, same, scratch, text } from "./support.fsh";

// The directory the parent test made, in the child `again` starts, else "".
function childRoot(): string {
  return process.env.FISH_CACHE_TEST_ROOT ?? "";
}

// Runs this test again in a child process in `cwd`, with the cache at `cache` and `vars` set.
function again(root: string, cache: string, cwd: string, vars: string[]): void {
  const run = spawnSync("env", [`FISH_CACHE_TEST_ROOT=${root}`, `FISH_CACHE_DIR=${cache}`, ...vars, process.execPath, argv()[2]], { cwd });
  assert(run.status === 0, `the test's child process failed:\n${text(run.stdout)}${text(run.stderr)}`);
}

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function made(path: string): void {
  try {
    mkdirSync(path, { recursive: true });
  } catch (e) {
    assert(false, `can't make ${path}: ${e.message}`);
  }
}

function listed(dir: string): string[] {
  try {
    let names = readdirSync(dir);
    names.sort();
    return names;
  } catch (e) {
    assert(false, `can't list ${dir}: ${e.message}`);
    return [];
  }
}

function mtime(path: string): f64 {
  try {
    return statSync(path).mtimeMs;
  } catch (e) {
    assert(false, `can't stat ${path}: ${e.message}`);
    return 0;
  }
}

function failure(e: CompileError | Error | IoError | JsonError): string {
  if (e instanceof CompileError) return formatError(e, "", "");
  return (e as { message: string }).message;
}

// Runs the native fishc with `args` and the cache at `cache`, failing on any stderr or exit code.
function fishc(cache: string, args: string[]): void {
  const run = spawnSync("env", [`FISH_CACHE_DIR=${cache}`, fishcPath(), ...args]);
  same(text(run.stderr), "", `fishc ${args.join(" ")}`);
  assert(run.status === 0, `fishc ${args.join(" ")} exited with ${run.status ?? -1}`);
}

function ranOut(file: string): string {
  return text(spawnSync(file, []).stdout);
}

function hello(root: string): string {
  const file = join(root, "hello.fsh");
  write(file, `function main() { console.log("hello"); }\n`);
  return file;
}

// The objects in `cache` whose names start with `prefix`, each with its modification time.
function stamped(cache: string, prefix: string): string {
  const names = listed(join(cache, "objects")).filter((f) => f.startsWith(prefix));
  return JSON.stringify(names.map((f) => [f, mtime(join(cache, "objects", f))]));
}

function count(cache: string, prefix: string): usize {
  return listed(join(cache, "objects")).filter((f) => f.startsWith(prefix)).length;
}

test("the runtime is compiled once per cache, and once more for a release build", () => {
  const root = scratch("fish-cache-");
  const program = hello(root);
  const cache = join(root, "cache");
  const out = join(root, "hello");
  fishc(cache, ["build", program, "-o", out]);
  const first = stamped(cache, "runtime");
  assert(count(cache, "runtime") === 1, `the runtime's objects: ${first}`);
  fishc(cache, ["build", program, "-o", out]);
  same(stamped(cache, "runtime"), first, "the runtime's objects after a second build");
  same(ranOut(out), "hello\n", "the program");
  fishc(cache, ["build", program, "-o", out, "--release"]);
  assert(count(cache, "runtime") === 2, `the runtime's objects after a release build: ${stamped(cache, "runtime")}`);
  same(ranOut(out), "hello\n", "the release program");
  same(JSON.stringify(listed(join(cache, "objects")).filter((f) => !f.endsWith(".o"))), "[]", "what else is in the cache");
  removed(root);
}, { timeout: 120_000 });

test("a change to the runtime's source or flags is a new object", () => {
  const root = childRoot();
  if (root === "") {
    const r = scratch("fish-cache-");
    again(r, join(r, "unit"), r, []);
    removed(r);
    return;
  }
  let session = cachedSession();
  try {
    const units = runtimeUnits("", false);
    const unit: Ref<Unit> = units[0];
    const built = cachedObject(session, unit);
    const twice = cachedObject(session, unit);
    same(twice, built, "the object built again");
    const edited: Unit = { name: unit.name, args: [...unit.args], stdin: `${unit.stdin ?? ""}\nint fsh_rt_edited;\n`, inputs: [...unit.inputs] };
    const editedObject = cachedObject(session, edited);
    const flagged: Unit = { name: unit.name, args: [...unit.args, "-DFSH_FLAGGED"], stdin: unit.stdin, inputs: [...unit.inputs] };
    const flaggedObject = cachedObject(session, flagged);
    assert(new Set([built, editedObject, flaggedObject]).size === 3, `the objects: ${built}, ${editedObject}, ${flaggedObject}`);
    assert(listed(join(root, "unit", "objects")).length === 3, `the cache holds ${JSON.stringify(listed(join(root, "unit", "objects")))}`);
  } catch (e) {
    assert(false, failure(e));
  }
}, { timeout: 120_000 });

test("a failed compile leaves nothing in the cache", () => {
  const root = childRoot();
  if (root === "") {
    const r = scratch("fish-cache-");
    again(r, join(r, "failed"), r, []);
    removed(r);
    return;
  }
  let session = cachedSession();
  let message = "";
  try {
    const broken: Unit = { name: "broken", args: ["-x", "c", "-"], stdin: "this is not C", inputs: [] };
    const _object = cachedObject(session, broken);
  } catch (e) {
    message = failure(e);
  }
  assert(message.includes("clang failed building broken"), `expected a clang failure, got: ${message === "" ? "an object" : message}`);
  same(JSON.stringify(listed(join(root, "failed", "objects"))), "[]", "the cache");
}, { timeout: 120_000 });

test("static and shared libraries link the cached runtime, built position-independent", () => {
  const root = scratch("fish-cache-");
  const program = hello(root);
  const cache = join(root, "lib");
  const lib = join(root, "adder.fsh");
  write(lib, `export function add(a: i32, b: i32): i32 { return a + b; }\n`);
  fishc(cache, ["build", lib, "-o", join(root, "adder"), "--lib=static"]);
  const first = listed(join(cache, "objects")).filter((f) => f.startsWith("runtime"));
  assert(first.length === 1, `the runtime's objects: ${JSON.stringify(first)}`);
  const stamps = stamped(cache, "runtime");
  fishc(cache, ["build", lib, "-o", join(root, "adder"), "--lib=shared"]);
  same(stamped(cache, "runtime"), stamps, "the runtime's objects after a shared build");
  const archive = text(spawnSync("ar", ["t", join(root, "libadder.a")]).stdout);
  assert(archive.includes(first[0]), `the archive holds:\n${archive}`);
  const c = join(root, "use.c");
  write(c, `#include "adder.h"\n#include <stdio.h>\nint main(void) { printf("%d\\n", add(2, 3)); }\n`);
  const out = join(root, "use");
  const linked = spawnSync("clang", [c, "-I", root, join(root, "libadder.a"), "-lm", "-pthread", "-o", out]);
  assert(linked.status === 0, `clang failed:\n${text(linked.stderr)}`);
  same(ranOut(out), "5\n", "the C program");
  fishc(cache, ["build", program, "-o", join(root, "hello-pie")]);
  assert(count(cache, "runtime") === 2, `the runtime's objects after an executable: ${stamped(cache, "runtime")}`);
  removed(root);
}, { timeout: 120_000 });

function engineProgram(root: string): string {
  const file = join(root, "engine.fsh");
  write(file, `import { evaluate } from "std:engine";\nfunction main() {\n  const v = evaluate("export default 1;");\n  console.log("ok");\n}\n`);
  return file;
}

// Builds the program calling the engine into `out`, in a session allowing the test hook.
function buildEngine(program: string, out: string): void {
  let session = cachedSession();
  session.engineHook = true;
  try {
    const _warnings = build(session, program, out);
  } catch (e) {
    assert(false, failure(e));
  }
  same(ranOut(out), "ok\n", "the program calling the engine");
}

function engineObjects(cache: string): string {
  const names = listed(join(cache, "objects")).filter((f) => /^(quickjs|libregexp|libunicode|dtoa|runtime-js)-/.test(f));
  return JSON.stringify(names.map((f) => [f, mtime(join(cache, "objects", f))]));
}

test("a program calling the JS engine compiles the engine once", () => {
  const root = childRoot();
  if (root === "") {
    const r = scratch("fish-cache-");
    again(r, join(r, "engine"), r, []);
    removed(r);
    return;
  }
  const cache = join(root, "engine");
  const program = engineProgram(root);
  const out = join(root, "engine-bin");
  buildEngine(program, out);
  const first = engineObjects(cache);
  assert(listed(join(cache, "objects")).filter((f) => /^(quickjs|libregexp|libunicode|dtoa|runtime-js)-/.test(f)).length === 5, `the engine's objects: ${first}`);
  buildEngine(program, out);
  same(engineObjects(cache), first, "the engine's objects after a second build");
}, { timeout: 120_000 });

test("headers in the working directory never reach a cached object", () => {
  const root = childRoot();
  if (root === "") {
    const r = scratch("fish-cache-");
    const evil = join(r, "evil");
    made(join(evil, "shared", "math"));
    for (const header of ["quickjs.h", "cutils.h", "shared/math/acos.h"]) write(join(evil, header), `#error poisoned\nint fsh_poisoned = 1;\n`);
    again(r, join(r, "poison"), evil, []);
    removed(r);
    return;
  }
  const cache = join(root, "poison");
  buildEngine(engineProgram(root), join(root, "poison-bin"));
  for (const f of listed(join(cache, "objects"))) {
    try {
      const bytes = readFileSync(join(cache, "objects", f));
      assert(!text(bytes).includes("fsh_poisoned"), `${f} holds the poisoned header`);
    } catch (e) {
      assert(false, `can't read ${f}: ${e.message}`);
    }
  }
}, { timeout: 120_000 });

// Builds `program` into `out` in a session of its own, giving the failure or "".
async function builtQuietly(program: string, out: string): Promise<string> {
  try {
    const _warnings = await buildAsync(cachedSession(), program, out);
    return "";
  } catch (e) {
    return failure(e);
  }
}

test("builds running at once compile each object once", async () => {
  const root = childRoot();
  if (root === "") {
    const r = scratch("fish-cache-");
    const bin = join(r, "shim");
    const log = join(r, "clang.log");
    made(bin);
    const clang = Bun.which("clang");
    assert(clang !== null, "no clang on PATH");
    write(join(bin, "clang"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(clang!)} "$@"\n`);
    try {
      chmodSync(join(bin, "clang"), 0o755);
    } catch (e) {
      assert(false, e.message);
    }
    again(r, join(r, "concurrent"), r, [`PATH=${bin}:${process.env.PATH ?? ""}`]);
    removed(r);
    return;
  }
  const cache = join(root, "concurrent");
  const program = hello(root);
  const outs = [1, 2, 3, 4].map((i) => join(root, `concurrent-${i}`));
  let builds: Promise<string>[] = [];
  for (const out of outs) builds.push(builtQuietly(program, out));
  const failures = await Promise.all(builds);
  for (const f of failures) assert(f === "", f);
  for (const out of outs) same(ranOut(out), "hello\n", out);
  const compiles = read(join(root, "clang.log")).split("\n").filter((line) => / -c -o /.test(line));
  const objects = listed(join(cache, "objects"));
  assert(objects.every((f) => f.endsWith(".o")), `the cache holds ${JSON.stringify(objects)}`);
  assert(compiles.length === objects.length, `${compiles.length} compiles for ${objects.length} objects:\n${compiles.join("\n")}`);
  const runtimes = compiles.filter((line) => line.includes("/runtime-"));
  assert(runtimes.length === 1, `the runtime was compiled ${runtimes.length} times`);
}, { timeout: 120_000 });

test("an edit to a hashed engine header is a new object", () => {
  const root = childRoot();
  if (root === "") {
    const r = scratch("fish-cache-");
    again(r, join(r, "header"), r, []);
    removed(r);
    return;
  }
  let session = cachedSession();
  try {
    const ir = "  call void @fsh_rt_js_eval()";
    const engine = files(engineDir());
    for (const unit of runtimeUnits(ir, false)) assert(unit.inputs === engine, `${unit.name}'s inputs: ${JSON.stringify(unit.inputs)}`);
    const copy = join(root, "engine-copy");
    const copied = spawnSync("cp", ["-R", engineDir(), copy]);
    assert(copied.status === 0, `cp failed: ${text(copied.stderr)}`);
    const before = cachedObject(session, { name: "header", args: ["-x", "c", "-", "-I", copy], stdin: `#include "quickjs.h"\nint fsh_probe;\n`, inputs: files(copy) });
    const header = join(copy, "cutils.h");
    writeFileSync(header, `${readFileSync(header, "utf8")}\n/* edited */\n`);
    const after = cachedObject(session, { name: "header", args: ["-x", "c", "-", "-I", copy], stdin: `#include "quickjs.h"\nint fsh_probe;\n`, inputs: files(copy) });
    assert(after !== before, `the edited header gave the same object ${after}`);
  } catch (e) {
    assert(false, failure(e));
  }
}, { timeout: 120_000 });

function httpProgram(): string {
  return `async function main(): Promise<void> {
  let app = new Router();
  app.get("/users/:id", async (req) => new Response("user " + req.param("id")));
  const res = await app.handle(new Request("http://h/users/7"));
  const body = await res.text();
  console.log(res.status, body);
}
`;
}

function stdObjects(cache: string): string[] {
  return listed(join(cache, "objects")).filter((f) => f.startsWith("std-"));
}

// Each build is a process of its own, as a rebuild from the command line is.
test("a dev build keeps std's object across edits to the program's own code", () => {
  const root = scratch("fish-cache-");
  const cache = join(root, "split");
  const base = httpProgram();
  const file = join(root, "edited.fsh");
  const out = join(root, "edited");
  const built = (src: string) => {
    write(file, src);
    fishc(cache, ["build", file, "-o", out]);
    return ranOut(out);
  };
  same(built(base), "200 user 7\n", "the program");
  const first = stdObjects(cache);
  assert(first.length === 1, `std's objects: ${JSON.stringify(first)}`);
  const edits: [string, string][] = [
    [base.replace('"user "', '"member "'), "200 member 7\n"],
    [base.replace('new Response("user " + req.param("id"))', '{ const id = req.param("id"); return new Response(id + " is a user"); }'), "200 7 is a user\n"],
    [base.replaceAll("body", "text"), "200 user 7\n"],
  ];
  for (const [src, expected] of edits) {
    same(built(src), expected, "the edited program");
    assert(stdObjects(cache) === first, `std's objects after an edit: ${JSON.stringify(stdObjects(cache))}`);
  }
  const aggregate = base.replace("console.log(res.status, body);", "console.log(res.status, body, new AggregateError([1, 2]).errors.length);");
  same(built(aggregate), "200 user 7 2\n", "the program using more of std");
  assert(stdObjects(cache).length === 2, `std's objects after using more of it: ${JSON.stringify(stdObjects(cache))}`);
  removed(root);
}, { timeout: 120_000 });

test("a dev build compiles again only the objects of the files whose code changed", () => {
  const root = scratch("fish-cache-");
  const cache = join(root, "per-file");
  const dir = join(root, "per-file-src");
  made(dir);
  write(join(dir, "a.fsh"), `export function twice(n: i64): i64 { return n * 2; }\n`);
  write(join(dir, "main.fsh"), `import { twice } from "./a.fsh";\nimport { greet } from "./b.fsh";\nfunction main() { console.log(greet("fish"), twice(21)); }\n`);
  const out = join(root, "per-file-out");
  const built = (b: string) => {
    write(join(dir, "b.fsh"), b);
    fishc(cache, ["build", join(dir, "main.fsh"), "-o", out]);
    return ranOut(out);
  };
  const objectsOf = (name: string) => listed(join(cache, "objects")).filter((f) => f.startsWith(`file-${name}.fsh-`));
  same(built(`export function greet(s: string): string { return "hi " + s; }\n`), "hi fish 42\n", "the program");
  const a = objectsOf("a");
  const b = objectsOf("b");
  assert(a.length === 1, `a.fsh's objects: ${JSON.stringify(a)}`);
  assert(b.length === 1, `b.fsh's objects: ${JSON.stringify(b)}`);
  same(built(`export function greet(s: string): string { return "hello " + s; }\n`), "hello fish 42\n", "the edited program");
  assert(objectsOf("a") === a, `a.fsh's objects after editing b.fsh: ${JSON.stringify(objectsOf("a"))}`);
  assert(objectsOf("b").length === 2, `b.fsh's objects after editing it: ${JSON.stringify(objectsOf("b"))}`);
  removed(root);
}, { timeout: 120_000 });

type Program = { file: string; src: string };

// Every 10th case of the test programs that builds and runs as a dev executable, with no C
// library to link and no server to start, written into `folder`.
function sampled(folder: string): Program[] {
  const dir = join(repo(), "tests", "programs");
  let cases: Program[] = [];
  for (const f of listed(dir)) {
    if (!f.endsWith(".fsh")) continue;
    const pieces = read(join(dir, f)).split(/^\/\/ case: .*$/m);
    for (let i: usize = 1; i < pieces.length; i++) {
      const src = pieces[i];
      if (/\/\/ (error|mode|link):|serve\(|listen\(/.test(src)) continue;
      cases.push({ file: `${f.slice(0, -4)}-${i - 1}`, src });
    }
  }
  made(folder);
  let chosen: Program[] = [];
  for (let i: usize = 0; i < cases.length; i += 10) {
    const file = join(folder, `${cases[i].file}.fsh`);
    write(file, cases[i].src);
    chosen.push({ file, src: cases[i].src });
  }
  return chosen;
}

function irOf(p: Ref<Program>): string {
  try {
    const ir = compile(cachedSession(), p.src, p.file);
    return ir;
  } catch (e) {
    assert(false, `${p.file}: ${failure(e)}`);
    return "";
  }
}

// Each compile in a process starts from the same type state, so a program compiled again after
// others gives the same IR: union order, tags and glue names don't depend on what came before.
test("compiling the same programs again in one process gives identical IR", () => {
  const root = scratch("fish-cache-");
  const json = read(join(repo(), "tests", "programs", "json.fsh"));
  const failures = join(root, "json_parse_failures.fsh");
  const after = json.split(/^\/\/ case: json_parse_failures$/m)[1];
  write(failures, after.split(/^\/\/ case: /m)[0]);
  let programs: Program[] = [{ file: failures, src: read(failures) }];
  for (const p of sampled(join(root, "sampled"))) programs.push(p.clone());
  let rounds: string[][] = [];
  for (let round = 0; round < 3; round++) rounds.push(programs.map((p) => irOf(p)));
  for (let i: usize = 0; i < programs.length; i++) {
    assert(rounds[1][i] === rounds[0][i], `${programs[i].file}: the second round's IR differs`);
    assert(rounds[2][i] === rounds[0][i], `${programs[i].file}: the third round's IR differs`);
  }
  removed(root);
}, { timeout: 300_000 });

// A process that builds many times, as a test runner or a daemon does, gives std's part the same
// text each time a program is built again, so it links the object it cached the first time.
test("a long-lived process reuses std's object when it builds a program again", async () => {
  const root = childRoot();
  if (root === "") {
    const r = scratch("fish-cache-");
    again(r, join(r, "long-lived"), r, []);
    removed(r);
    return;
  }
  const cache = join(root, "long-lived");
  const file = join(root, "long-lived.fsh");
  write(file, httpProgram());
  const others = sampled(join(root, "sampled")).slice(0, 5);
  try {
    const _first = await buildAsync(cachedSession(), file, join(root, "long-lived-1"));
    const first = stdObjects(cache);
    for (const p of others) {
      const _ir = compile(cachedSession(), p.src, p.file);
    }
    const _second = await buildAsync(cachedSession(), file, join(root, "long-lived-2"));
    assert(stdObjects(cache) === first, `std's objects: ${JSON.stringify(first)}, then ${JSON.stringify(stdObjects(cache))}`);
  } catch (e) {
    assert(false, failure(e));
  }
}, { timeout: 120_000 });

type Outcome = { stdout: string; stderr: string; code: i64 };

// Runs `out` under the leak check. Tasks that panic together write their reports in whatever
// order they finish, so stderr is compared as a set of lines.
function outcome(out: string): Outcome {
  const done = spawnSync("env", ["FISH_LEAKS=1", out]);
  let lines = text(done.stderr).split("\n");
  lines.sort();
  return { stdout: text(done.stdout), stderr: lines.join("\n"), code: done.status ?? -1 };
}

// Builds `p` both ways, split and as one module, runs each under the leak check, and gives what
// the two runs differ in, or "" when they behave alike.
async function bothWays(p: Program): Promise<string> {
  const split = `${p.file}.split`;
  const whole = `${p.file}.whole`;
  try {
    const _warnings = await buildAsync(cachedSession(), p.file, split);
    const ir = compile(cachedSession(), p.src, p.file);
    let session = cachedSession();
    let objects: string[] = [];
    for (const u of runtimeUnits(ir, false)) {
      const object = await cachedObjectAsync(session, u.clone());
      objects.push(object);
    }
    const math = await mathObjectsAsync(session);
    for (const m of math) objects.push(m);
    const clang = spawnSync("clang", ["-x", "ir", "-", "-x", "none", ...objects, "-funwind-tables", "-pthread", "-o", whole, "-O0", "-lm", ...runtimeLinks(ir, hostTarget())], { input: ir });
    if (clang.status !== 0) return `${p.file}: clang failed:\n${text(clang.stderr)}`;
  } catch (e) {
    return `${p.file}: ${failure(e)}`;
  }
  const a = outcome(split);
  const b = outcome(whole);
  if (a.stdout === b.stdout && a.stderr === b.stderr && a.code === b.code) return "";
  return `${p.file}: split ${JSON.stringify(a)}, one module ${JSON.stringify(b)}`;
}

test("split and one-module dev builds of sampled test programs behave alike", async () => {
  const root = childRoot();
  if (root === "") {
    const r = scratch("fish-cache-");
    again(r, join(r, "sampled-cache"), r, []);
    removed(r);
    return;
  }
  const programs = sampled(join(root, "sampled"));
  assert(programs.length > 50, `only ${programs.length} sampled programs`);
  const width = availableParallelism() as usize;
  let differing: string[] = [];
  for (let at: usize = 0; at < programs.length; at += width) {
    let batch: Promise<string>[] = [];
    for (let i = at; i < at + width && i < programs.length; i++) batch.push(bothWays(programs[i].clone()));
    const results = await Promise.all(batch);
    for (const r of results) if (r !== "") differing.push(r);
  }
  assert(differing.length === 0, differing.join("\n"));
}, { timeout: 420_000 });

test("giving a session the build caches again keeps the ones it has", () => {
  let session = buildSession(newSession());
  session.digests.set("a.c:1:1", "digest");
  const again = buildSession(session);
  assert(again.digests.get("a.c:1:1") === "digest", `the digest: ${again.digests.get("a.c:1:1") ?? "none"}`);
}, { timeout: 120_000 });

// The key of a check, over the files it read: the same inputs give the same key, and any change to
// what a check reads or how it is made gives another.
function keyed(contents: Ref<Map<string, string | undefined>>, compiler = "c1", entry = "/p/main.fsh", editing = false, library = false): string {
  return checkKey(compiler, entry, editing, library, contents);
}

function twoFiles(lib: string | undefined): Map<string, string | undefined> {
  let contents = new Map<string, string | undefined>();
  contents.set("/p/main.fsh", "function main() {}\n");
  contents.set("/p/lib.fsh", lib);
  return contents;
}

test("a check's key covers its files, its compiler, its entry and the flags that change a check", () => {
  const same = keyed(twoFiles("export const n = 1;\n")) === keyed(twoFiles("export const n = 1;\n"));
  assert(same, "the same inputs gave two keys");
  const base = keyed(twoFiles("export const n = 1;\n"));
  assert(keyed(twoFiles("export const n = 2;\n")) !== base, "an edited file gave the same key");
  assert(keyed(twoFiles(undefined)) !== base, "a file that is no longer there gave the same key");
  assert(keyed(twoFiles("export const n = 1;\n"), "c2") !== base, "another compiler gave the same key");
  assert(keyed(twoFiles("export const n = 1;\n"), "c1", "/q/main.fsh") !== base, "another entry gave the same key");
  assert(keyed(twoFiles("export const n = 1;\n"), "c1", "/p/main.fsh", true) !== base, "checking for an editor gave the same key");
  assert(keyed(twoFiles("export const n = 1;\n"), "c1", "/p/main.fsh", false, true) !== base, "a library check gave the same key");
  let moved = new Map<string, string | undefined>();
  moved.set("/p/lib.fsh", "export const n = 1;\n");
  moved.set("/p/main.fsh", "function main() {}\n");
  assert(keyed(moved) === base, "the key followed the order the files were put in");
  let swapped = new Map<string, string | undefined>();
  swapped.set("/p/main.fsh", "export const n = 1;\n");
  swapped.set("/p/lib.fsh", "function main() {}\n");
  assert(keyed(swapped) !== base, "two files with each other's text gave the same key");
  let joined = new Map<string, string | undefined>();
  joined.set("/p/main.fsh", "function main() {}\n/p/lib.fsh");
  joined.set("/p/lib.fsh", "export const n = 1;\n");
  assert(keyed(joined) !== base, "a path written into a file's text gave the same key");
  assert(checkPath(base).endsWith(`${base.slice(0, 16)}.fshcheck`), `the path ${checkPath(base)} isn't named by the key`);
});

test("a cached check is read back only when it is this compiler's, this program's and whole", () => {
  const dir = scratch("fish-checkcache-");
  const path = join(dir, "one.fshcheck");
  const key = keyed(twoFiles("export const n = 1;\n"));
  const envelope: Envelope = { format: 1, key, instances: 7, bodies: 5, classes: 2, entries: 99 };
  assert(writeCheck(path, envelope, "the state"), "the check wasn't written");
  const back = readCheck(path, key);
  assert(back !== undefined, "a check written wasn't read back");
  assert(back!.state === "the state", `the state read back as '${back!.state}'`);
  assert(back!.envelope.instances === 7 && back!.envelope.entries === 99, "the counts didn't survive");
  assert(readCheck(path, `${key.slice(0, 63)}0`) === undefined, "another program's key was taken for this one's");
  assert(readCheck(join(dir, "none.fshcheck"), key) === undefined, "a missing file wasn't a miss");
  const line = writtenEnvelope(envelope);
  assert(readEnvelope(line.slice(0, 12), key) === undefined, "a truncated envelope was read");
  assert(readEnvelope(`${line.replace(" 1 ", " 2 ")}the state`, key) === undefined, "another format was read");
  assert(readEnvelope(`fshother 1 ${key} 1 1 1 1\nthe state`, key) === undefined, "another file's first line was read as an envelope");
  // Nothing is left beside a written check: the temporary name is renamed, never left.
  let left: string[] = [];
  try {
    for (const name of readdirSync(dir)) if (name !== "one.fshcheck") left.push(name);
  } catch (e) {
    assert(false, `can't read ${dir}: ${e.message}`);
  }
  assert(left.length === 0, `the cache left ${left.join(", ")}`);
  removed(dir);
});
