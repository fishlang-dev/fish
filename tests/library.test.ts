import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "../src/check.ts";
import { buildLibrary } from "../src/main.ts";
import { parse } from "../src/parser.ts";

// Fish built into libraries, and C programs built against them.
const tmp = mkdtempSync(join(tmpdir(), "fish-library-"));

const LIBRARY = `
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

const PROGRAM = `
#include <stdio.h>
#include "mathy.h"
int main(int argc, char **argv) {
  unsigned char buf[4] = {0};
  int32_t xs[2] = {42, 7};
  fill(buf, 3, 9);
  printf("%d %lld %d %d %.2f %lld\\n", add(2, 40), (long long)sumSquares(3), isEven(4), isEven(255), scale(1.5, 2.0f), (long long)widen(-3));
  printf("%d %d %d %d %d\\n", buf[0], buf[1], buf[2], buf[3], first(xs));
  fflush(stdout);
  greet();
  if (argc > 1) printf("%lld\\n", (long long)explode(5));
  return 0;
}
`;

function library(kind: "static" | "shared", panic: "unwind" | "abort" = "unwind"): string {
  const dir = mkdtempSync(join(tmp, `${kind}-`));
  writeFileSync(join(dir, "mathy.fsh"), LIBRARY);
  writeFileSync(join(dir, "main.c"), PROGRAM);
  buildLibrary(join(dir, "mathy.fsh"), join(dir, "mathy"), kind, false, panic);
  const linked = kind === "static" ? [join(dir, "libmathy.a"), "-lm"] : [`-L${dir}`, "-lmathy"];
  const clang = Bun.spawnSync(["clang", join(dir, "main.c"), ...linked, "-o", join(dir, "prog")]);
  if (clang.exitCode !== 0) throw new Error(clang.stderr.toString());
  return dir;
}

function run(dir: string, ...args: string[]) {
  return Bun.spawnSync([join(dir, "prog"), ...args], { env: { ...process.env, FISH_LEAKS: "1", DYLD_LIBRARY_PATH: dir, LD_LIBRARY_PATH: dir } });
}

const EXPECTED = "42 14 1 0 3.00 -3\n9 9 9 0 42\nhello from fish1\n";

for (const kind of ["static", "shared"] as const) {
  test(`a C program calls a ${kind} library's exports`, () => {
    const result = run(library(kind));
    expect(result.stdout.toString()).toBe(EXPECTED);
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  });

  for (const panic of ["unwind", "abort"] as const) {
    test(`a panic in a ${kind} library's export aborts instead of unwinding into C, built to ${panic}`, () => {
      const result = run(library(kind, panic), "explode");
      expect(result.stderr.toString()).toContain("index out of bounds");
      expect(result.signalCode).toBe("SIGABRT");
    });
  }
}

test("the header declares each export in C's types", () => {
  const header = readFileSync(join(library("static"), "mathy.h"), "utf8");
  expect(header).toContain("int32_t add(int32_t a, int32_t b);");
  expect(header).toContain("bool isEven(uint8_t n);");
  expect(header).toContain("double scale(double x, float by);");
  expect(header).toContain("void fill(uint8_t *at, size_t count, uint8_t value);");
  expect(header).toContain("int32_t first(const int32_t *at);");
  expect(header).toContain("void greet(void);");
  expect(header).toContain('extern "C" {');
  expect(header).not.toContain("square");
});

test("two Fish libraries link into one C program, from C and C++", () => {
  const dir = mkdtempSync(join(tmp, "two-"));
  writeFileSync(join(dir, "la.fsh"), "function helper(n: i64): i64 { return n + 1; }\nexport function fromA(n: i64): i64 { return helper(n); }\n");
  writeFileSync(join(dir, "lb.fsh"), "function helper(n: i64): i64 { return n * 100; }\nexport function fromB(n: i64): i64 { return helper(n); }\nexport function pp(a: Ptr<Ptr<u8>>, b: Ptr<MutPtr<u8>>, c: MutPtr<MutPtr<u8>>, int: i64): i64 { return int; }\n");
  buildLibrary(join(dir, "la.fsh"), join(dir, "la"), "static");
  buildLibrary(join(dir, "lb.fsh"), join(dir, "1lb"), "static");
  const header = readFileSync(join(dir, "1lb.h"), "utf8");
  expect(header).toContain("int64_t pp(const uint8_t *const *a, uint8_t *const *b, uint8_t **c, int64_t);");
  expect(header).toContain("#ifndef FISH_1LB_H");
  const program = '#include <stdio.h>\n#include "la.h"\n#include "1lb.h"\nint main(void) { uint8_t *rows[1] = {0}; printf("%lld %lld %lld\\n", (long long)fromA(1), (long long)fromB(1), (long long)pp(0, rows, rows, 7)); return 0; }\n';
  for (const [file, compiler, flags] of [["two.c", "clang", ["-std=c99"]], ["two.cpp", "clang++", []]] as const) {
    writeFileSync(join(dir, file), program);
    const built = Bun.spawnSync([compiler, ...flags, "-Wall", "-Werror", join(dir, file), join(dir, "libla.a"), join(dir, "lib1lb.a"), "-lm", "-o", join(dir, "two")]);
    if (built.exitCode !== 0) throw new Error(built.stderr.toString());
    expect(Bun.spawnSync([join(dir, "two")]).stdout.toString()).toBe("2 100 7\n");
  }
});

// What a library can't export to C, and why.
for (const [src, message] of [
  ["export function f(s: string): i64 { return 1; }", "an exported function's parameter can't be a 'string' in a library"],
  ["export function f(): string { return \"a\"; }", "an exported function can't return a 'string' in a library"],
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
]) {
  test(src!, () => {
    expect(() => check(parse(src!), true)).toThrow(message!);
  });
}

test("a library may export names that only appear in the runtime's comments", () => {
  expect(() => check(parse("export function start(n: i64): i64 { return n; }\nexport function end(n: i64): i64 { return n; }"), true)).not.toThrow();
});

test("outside a library an export is an ordinary function", () => {
  expect(() => check(parse("export function f(s: string): string { return s; }\nfunction main() { console.log(f(\"x\")); }"))).not.toThrow();
});
