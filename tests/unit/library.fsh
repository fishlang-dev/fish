// Fish built into static and shared libraries with the native fishc's
// `--lib`, and C programs built against them. What the checker refuses to export is read from
// `fishc build --lib`'s errors, and an ordinary program's from `fishc check`.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fishc, removed, same, scratch, text } from "./support.fsh";

function libSource(): string {
  return `
function square(n: i64): i64 {
  return n * n;
}

export function add(a: i32, b: i32): i32 {
  return a + b;
}

export function sumSquares(n: i64): i64 {
  let total = 0;
  for (let i = 1; i <= n; i++) total += square(i);
  return total;
}

export function isEven(n: u8): boolean {
  return n % 2 === 0;
}

export function scale(x: f64, by: f32): f64 {
  return x * (by as f64);
}

export function widen(n: i8): i64 {
  return n as i64;
}

export function fill(at: MutPtr<u8>, count: usize, value: u8) {
  for (let i = 0; i < (count as i64); i++) {
    unsafe {
      at.offset(i).write(value);
    }
  }
}

export function first(at: Ptr<i32>): i32 {
  return unsafe { at.read() };
}

export function greet() {
  const name = "fish" + 1;
  console.log(\`hello from \${name}\`);
}

export function explode(n: i64): i64 {
  const xs = [1, 2];
  return xs[n as usize];
}
`;
}

function cProgram(): string {
  return String.raw`
#include <stdio.h>
#include "mathy.h"
int main(int argc, char **argv) {
  unsigned char buf[4] = {0};
  int32_t xs[2] = {42, 7};
  fill(buf, 3, 9);
  printf("%d %lld %d %d %.2f %lld\n", add(2, 40), (long long)sumSquares(3), isEven(4), isEven(255), scale(1.5, 2.0f), (long long)widen(-3));
  printf("%d %d %d %d %d\n", buf[0], buf[1], buf[2], buf[3], first(xs));
  fflush(stdout);
  greet();
  if (argc > 1) printf("%lld\n", (long long)explode(5));
  return 0;
}
`;
}

function expected(): string {
  return "42 14 1 0 3.00 -3\n9 9 9 0 42\nhello from fish1\n";
}

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    assert(false, `can't read ${path}: ${e.message}`);
    return "";
  }
}

function made(dir: string): string {
  try {
    mkdirSync(dir);
  } catch (e) {
    assert(false, `can't make ${dir}: ${e.message}`);
  }
  return dir;
}

// Builds `file` into a library at `out` with the native fishc, failing the test on any output.
function buildLibrary(file: string, out: string, kind: string, panic: string = "unwind"): void {
  const run = fishc(join(file, ".."), ["build", file, "-o", out, `--lib=${kind}`, `--panic=${panic}`]);
  same(run.err, "", `building ${file} as a ${kind} library`);
  assert(run.code === 0, `building ${file} as a ${kind} library exited with ${run.code}`);
}

// Builds the library and the C program linked to it in a directory of its own under `tmp`.
function library(tmp: string, kind: string, panic: string = "unwind"): string {
  const dir = made(join(tmp, `${kind}-${panic}`));
  write(join(dir, "mathy.fsh"), libSource());
  write(join(dir, "main.c"), cProgram());
  buildLibrary(join(dir, "mathy.fsh"), join(dir, "mathy"), kind, panic);
  const linked = kind === "static" ? [join(dir, "libmathy.a"), "-lm"] : [`-L${dir}`, "-lmathy"];
  const clang = spawnSync("clang", [join(dir, "main.c"), ...linked, "-o", join(dir, "prog")]);
  assert(clang.status === 0, `clang failed:\n${text(clang.stderr)}`);
  return dir;
}

type Ran = { code: i64 | null; signal: string | null; out: string; err: string };

function run(dir: string, args: string[]): Ran {
  try {
    const done = Bun.spawnSync([join(dir, "prog"), ...args], { env: { PATH: process.env.PATH ?? "", FISH_LEAKS: "1", DYLD_LIBRARY_PATH: dir, LD_LIBRARY_PATH: dir } });
    return { code: done.exitCode, signal: done.signalCode, out: text(done.stdout), err: text(done.stderr) };
  } catch (e) {
    assert(false, `can't run ${dir}/prog: ${e.message}`);
    return { code: null, signal: null, out: "", err: "" };
  }
}

function calls(kind: string): void {
  const tmp = scratch("fish-library-");
  const result = run(library(tmp, kind), []);
  same(result.out, expected(), "the C program's stdout");
  same(result.err, "", "the C program's stderr");
  assert(result.code === 0, `the C program exited with ${result.code ?? -1}`);
  removed(tmp);
}

function aborts(kind: string, panic: string): void {
  const tmp = scratch("fish-library-");
  const result = run(library(tmp, kind, panic), ["explode"]);
  assert(result.err.includes("index out of bounds"), `the C program's stderr:\n${result.err}`);
  assert(result.signal === "SIGABRT", `the C program ended with ${result.signal ?? `code ${result.code ?? -1}`}`);
  removed(tmp);
}

test("a C program calls a static library's exports", () => {
  calls("static");
});

test("a panic in a static library's export aborts instead of unwinding into C, built to unwind", () => {
  aborts("static", "unwind");
});

test("a panic in a static library's export aborts instead of unwinding into C, built to abort", () => {
  aborts("static", "abort");
});

test("a C program calls a shared library's exports", () => {
  calls("shared");
});

test("a panic in a shared library's export aborts instead of unwinding into C, built to unwind", () => {
  aborts("shared", "unwind");
});

test("a panic in a shared library's export aborts instead of unwinding into C, built to abort", () => {
  aborts("shared", "abort");
});

test("the header declares each export in C's types", () => {
  const tmp = scratch("fish-library-");
  const header = readText(join(library(tmp, "static"), "mathy.h"));
  for (const line of ["int32_t add(int32_t a, int32_t b);", "bool isEven(uint8_t n);", "double scale(double x, float by);", "void fill(uint8_t *at, size_t count, uint8_t value);", "int32_t first(const int32_t *at);", "void greet(void);", 'extern "C" {']) {
    assert(header.includes(line), `the header has no ${line}:\n${header}`);
  }
  assert(!header.includes("square"), `the header names square:\n${header}`);
  removed(tmp);
});

test("two Fish libraries link into one C program, from C and C++", () => {
  const dir = scratch("fish-library-");
  write(join(dir, "la.fsh"), "function helper(n: i64): i64 { return n + 1; }\nexport function fromA(n: i64): i64 { return helper(n); }\n");
  write(join(dir, "lb.fsh"), "function helper(n: i64): i64 { return n * 100; }\nexport function fromB(n: i64): i64 { return helper(n); }\nexport function pp(a: Ptr<Ptr<u8>>, b: Ptr<MutPtr<u8>>, c: MutPtr<MutPtr<u8>>, int: i64): i64 { return int; }\n");
  buildLibrary(join(dir, "la.fsh"), join(dir, "la"), "static");
  buildLibrary(join(dir, "lb.fsh"), join(dir, "1lb"), "static");
  const header = readText(join(dir, "1lb.h"));
  assert(header.includes("int64_t pp(const uint8_t *const *a, uint8_t *const *b, uint8_t **c, int64_t);"), `1lb.h:\n${header}`);
  assert(header.includes("#ifndef FISH_1LB_H"), `1lb.h has no guard:\n${header}`);
  const program = '#include <stdio.h>\n#include "la.h"\n#include "1lb.h"\nint main(void) { uint8_t *rows[1] = {0}; printf("%lld %lld %lld\\n", (long long)fromA(1), (long long)fromB(1), (long long)pp(0, rows, rows, 7)); return 0; }\n';
  const builds: [string, string, string[]][] = [["two.c", "clang", ["-std=c99"]], ["two.cpp", "clang++", []]];
  for (const [file, compiler, flags] of builds) {
    write(join(dir, file), program);
    const built = spawnSync(compiler, [...flags, "-Wall", "-Werror", join(dir, file), join(dir, "libla.a"), join(dir, "lib1lb.a"), "-lm", "-o", join(dir, "two")]);
    assert(built.status === 0, `${compiler} failed:\n${text(built.stderr)}`);
    same(text(spawnSync(join(dir, "two"), []).stdout), "2 100 7\n", `the program built by ${compiler}`);
  }
  removed(dir);
});

// What a library can't export to C, and why.
test("what a library can't export to C, and why", () => {
  const rows: [string, string][] = [
    ["export function f(s: string): i64 { return 1; }", "an exported function's parameter can't be a 'string' in a library"],
    ['export function f(): string { return "a"; }', "an exported function can't return a 'string' in a library"],
    ["export function f(a: i64, b: i64 = 1): i64 { return a + b; }", "an exported function's parameter can't have a default in a library, since C callers pass every argument"],
    ["export function f<T>(x: T): i64 { return 1; }", "a library can't export a generic function to C"],
    ["export function f(): i64 throws string { return 1; }", "a library can't export a function that throws to C"],
    ["export function* f(): Generator<i64> { yield 1; }", "a library can't export a generator to C"],
    ["export function fsh_rt_alloc(): i64 { return 1; }", "a library can't export 'fsh_rt_alloc' to C"],
    ["export function free(n: i64): i64 { return n; }", "since C's library or the Fish runtime already uses that name"],
    ["export function exit(n: i64): i64 { return n; }", "since C's library or the Fish runtime already uses that name"],
    ["export function int(n: i64): i64 { return n; }", "isn't a C or C++ keyword"],
    ["function helper(): i64 { return 1; }", "a library has nothing for C to call"],
    ["export function pow(a: f64): f64 { return a; }", "since C's library or the Fish runtime already uses that name"],
    ["export function _Unwind_Resume(a: i64): i64 { return a; }", "since C's library or the Fish runtime already uses that name"],
  ];
  const dir = scratch("fish-library-");
  let failures: string[] = [];
  for (let i: usize = 0; i < rows.length; i++) {
    const [src, message] = rows[i];
    const file = join(dir, `refused${i}.fsh`);
    write(file, src);
    const got = fishc(dir, ["build", file, "--lib", "-o", join(dir, `refused${i}`)]);
    if (got.code !== 1 || !got.err.includes(message)) failures.push(`${src}\n  expected exit 1 with ${message}, got exit ${got.code}:\n${got.err}`);
  }
  assert(failures.length === 0, failures.join("\n"));
  removed(dir);
});

test("a library may export names that only appear in the runtime's comments", () => {
  const dir = scratch("fish-library-");
  const file = join(dir, "names.fsh");
  write(file, "export function start(n: i64): i64 { return n; }\nexport function end(n: i64): i64 { return n; }");
  const got = fishc(dir, ["build", file, "--lib", "-o", join(dir, "names")]);
  same(got.err, "", "building the library");
  assert(got.code === 0, `building the library exited with ${got.code}`);
  removed(dir);
});

test("outside a library an export is an ordinary function", () => {
  const dir = scratch("fish-library-");
  const file = join(dir, "plain.fsh");
  write(file, 'export function f(s: string): string { return s; }\nfunction main() { console.log(f("x")); }');
  const got = fishc(dir, ["check", file]);
  same(got.err, "", "checking the program");
  assert(got.code === 0, `checking the program exited with ${got.code}`);
  removed(dir);
});

test("a library in several files gives C only its entry file's exports", () => {
  const dir = scratch("fish-library-");
  write(join(dir, "api.fsh"), 'import { twice } from "./util";\nexport function quad(n: i64): i64 { return twice(twice(n)); }\n');
  write(join(dir, "util.fsh"), "export function twice(n: i64): i64 { return n * 2; }\n");
  write(join(dir, "main.c"), '#include <stdio.h>\n#include "api.h"\nint main(void) { printf("%lld\\n", (long long)quad(3)); return 0; }\n');
  buildLibrary(join(dir, "api.fsh"), join(dir, "api"), "static");
  const header = readText(join(dir, "api.h"));
  assert(header.includes("int64_t quad(int64_t n);"), `api.h:\n${header}`);
  assert(!header.includes("twice"), `api.h names twice:\n${header}`);
  const clang = spawnSync("clang", [join(dir, "main.c"), join(dir, "libapi.a"), "-lm", "-o", join(dir, "prog")]);
  same(text(clang.stderr), "", "clang's stderr");
  same(run(dir, []).out, "12\n", "the C program");
  removed(dir);
});

test("a library's export list names C functions, and a re-export in its entry is refused", () => {
  const dir = scratch("fish-library-");
  write(join(dir, "api.fsh"), "function quad(n: i64): i64 { return n * 4; }\nexport { quad };\n");
  buildLibrary(join(dir, "api.fsh"), join(dir, "api"), "static");
  const header = readText(join(dir, "api.h"));
  assert(header.includes("int64_t quad(int64_t n);"), `api.h:\n${header}`);
  write(join(dir, "re.fsh"), 'export { quad } from "./api";\n');
  const re = fishc(dir, ["build", join(dir, "re.fsh"), "--lib=static", "-o", join(dir, "re")]);
  assert(re.code === 1 && re.err.includes("write 'export function' on the function itself"), `the re-export built with exit ${re.code}:\n${re.err}`);
  removed(dir);
});
