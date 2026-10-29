import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { CompileError, formatError } from "../src/diag.ts";
import { compile } from "../src/main.ts";
import { rustSymbol, trusted } from "../src/rust.ts";

// Building a shim runs cargo, which compiles the fixture crate and the shim from nothing in each
// test's own cache.
setDefaultTimeout(120_000);

const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const FIXTURE = join(import.meta.dir, "fixtures", "rust", "demo");
const root = realpathSync(mkdtempSync(join(tmpdir(), "fish-rust-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const DECLARATIONS = `declare module "rust:demo" {
  export function add(a: i64, b: i64): i64;
  export function half(x: f64): f64;
  export function shrink(x: f32): f32;
  export function even(n: u8): boolean;
  export function wrap(n: i8): i8;
  export function widths(a: u16, b: i16, c: u32, d: u64, e: isize): usize;
  export function bump(): void;
  export function bumps(): i64;
  export function check(n: i64): i64;
  @rust("util::mul") export function mul(a: i32, b: i32): i32;
}
`;

const MAIN_FSH = `import { add, half, shrink, even, wrap, widths, bump, bumps, mul } from "rust:demo";

function main() {
  bump();
  bump();
  console.log(add(40, 2), half(5.0), shrink(3.0), even(4), even(7), wrap(127), widths(1, 2, 3, 4, 5), bumps(), mul(6, 7));
}
`;

let made = 0;

// A package of its own, with the fixture crate copied beside it under rust/demo, and `files`.
function pkg(files: Record<string, string>, crates = `demo = { path = "rust/demo" }`): string {
  const dir = join(root, `p${made++}`);
  cpSync(FIXTURE, join(dir, "rust", "demo"), { recursive: true });
  const all = { "fish.toml": `[package]\nname = "app"\nversion = "0.1.0"\n\n[rust-dependencies]\n${crates}\n`, "src/rust.fsh": DECLARATIONS, ...files };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

// The first line of the compile error the package's entry gives.
function refused(dir: string): string {
  const file = join(dir, "src", "main.fsh");
  const src = readFileSync(file, "utf8");
  try {
    compile(src, file);
  } catch (e) {
    if (e instanceof CompileError) return formatError(e, "src/main.fsh", src).split("\n")[0]!;
    throw e;
  }
  throw new Error("the program compiled");
}

// The environment a build runs in: its own cache, and `path` for PATH.
function env(cache: string, path = process.env.PATH ?? "") {
  const vars: Record<string, string | undefined> = { ...process.env, XDG_CACHE_HOME: cache, PATH: path };
  delete vars.FISH_CACHE_DIR;
  return vars;
}

// Runs `fishc <args>` in `dir`.
function fishc(dir: string, args: string[], vars = env(join(dir, "cache"))) {
  const run = Bun.spawnSync([process.execPath, MAIN, ...args], { cwd: dir, env: vars });
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
}

function built(dir: string) {
  return Bun.spawnSync([join(dir, "target", "debug", "app")]);
}

test("a call of a Rust function is a call of its shim's symbol, with no unsafe", () => {
  const dir = pkg({ "src/main.fsh": MAIN_FSH });
  const file = join(dir, "src", "main.fsh");
  const ir = compile(readFileSync(file, "utf8"), file);
  for (const call of [
    `call i64 @"fsh_rust_4demo3add"(i64 40, i64 2, ptr `,
    `call double @"fsh_rust_4demo4half"(double 0x4014000000000000, ptr `,
    `call float @"fsh_rust_4demo6shrink"(float 0x4008000000000000, ptr `,
    `call zeroext i1 @"fsh_rust_4demo4even"(i8 zeroext 4, ptr `,
    `call signext i8 @"fsh_rust_4demo4wrap"(i8 signext 127, ptr `,
    `call i64 @"fsh_rust_4demo6widths"(i16 zeroext 1, i16 signext 2, i32 3, i64 4, i64 5, ptr `,
    `call void @"fsh_rust_4demo4bump"(ptr `,
    `call i32 @"fsh_rust_4demo4util3mul"(i32 6, i32 7, ptr `,
  ]) {
    expect(ir).toContain(call);
  }
  expect(ir).toContain(`declare i64 @"fsh_rust_4demo3add"(i64, i64, ptr)`);
  expect(ir).toContain("call void @fsh_rt_panic_rust(ptr ");
});

test("a crate's name with '-' is spelled with '_' in its shim's symbols", () => {
  const dir = pkg({
    "src/rust.fsh": `declare module "rust:my-crate" {\n  export function f(): i64;\n}\n`,
    "src/main.fsh": `import { f } from "rust:my-crate";\nfunction main() {\n  console.log(f());\n}\n`,
  }, `my-crate = { path = "rust/demo" }`);
  const file = join(dir, "src", "main.fsh");
  expect(compile(readFileSync(file, "utf8"), file)).toContain(`call i64 @"fsh_rust_8my_crate1f"(ptr `);
});

test("Rust declarations and imports are refused where they go wrong", () => {
  expect(refused(pkg({ "src/main.fsh": `import { add } from "rust:other";\nfunction main() {}\n` })))
    .toBe(`src/main.fsh:1:1: error: 'other' isn't a Rust dependency of this package; list it under [rust-dependencies] in fish.toml, as in other = "1.0"`);
  expect(refused(pkg({ "src/main.fsh": `import { nope } from "rust:demo";\nfunction main() {}\n` }))).toBe("src/main.fsh:1:10: error: 'rust:demo' has no export named 'nope'");
  const unsupported = pkg({
    "src/rust.fsh": `declare module "rust:demo" {\n  export function s(x: string): i64;\n}\n`,
    "src/main.fsh": `import { s } from "rust:demo";\nfunction main() {\n  console.log(s("a"));\n}\n`,
  });
  expect(refused(unsupported)).toBe("rust.fsh:2:21: error: a 'string' can't cross the Rust boundary yet; Rust functions take and give numbers and booleans");
  const returned = pkg({
    "src/rust.fsh": `declare module "rust:demo" {\n  export function s(): i64[];\n}\n`,
    "src/main.fsh": `import { s } from "rust:demo";\nfunction main() {\n  s();\n}\n`,
  });
  expect(refused(returned)).toBe("rust.fsh:2:24: error: a 'i64[]' can't cross the Rust boundary yet; Rust functions take and give numbers and booleans");
  const path = pkg({
    "src/rust.fsh": `const name = "x";\ndeclare module "rust:demo" {\n  @rust(name) export function s(): i64;\n}\n`,
    "src/main.fsh": `import { s } from "rust:demo";\nfunction main() {}\n`,
  });
  expect(refused(path)).toBe(`rust.fsh:3:4: error: @rust takes the item's path in the crate as a string literal, as in @rust("util::mul")`);
  const notPath = pkg({
    "src/rust.fsh": `declare module "rust:demo" {\n  @rust("a; b") export function s(): i64;\n}\n`,
    "src/main.fsh": `import { s } from "rust:demo";\nfunction main() {}\n`,
  });
  expect(refused(notPath)).toBe(`rust.fsh:2:9: error: this isn't a Rust path; write one from the crate's root, as in "util::mul"`);
  expect(refused(pkg({ "src/rust.fsh": "", "src/main.fsh": `import { s } from "rust:demo";\nfunction main() {}\n` })))
    .toBe(`src/main.fsh:1:1: error: no file of this package declares the functions of 'demo'; declare them in one, as in 'declare module "rust:demo" { export function f(x: i64): i64; }'`);
});

test("a package builds and runs with a Rust crate's functions", () => {
  const dir = pkg({ "src/main.fsh": MAIN_FSH });
  const run = fishc(dir, ["build"]);
  expect(run.err).toBe("");
  expect(run.code).toBe(0);
  expect(built(dir).stdout.toString()).toBe("42 2.5 1.5 true false -128 15 2 42\n");
});

// A package calling `top`, a crate with a build script that depends on `inner`, another path crate.
function layered(): string {
  return pkg({
    "rust/top/Cargo.toml": `[package]\nname = "top"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\ninner = { path = "../inner" }\n`,
    "rust/top/build.rs": `fn main() {\n    println!("cargo:rustc-env=BONUS=10");\n}\n`,
    "rust/top/src/lib.rs": `pub fn get() -> i64 {\n    inner::value() + env!("BONUS").parse::<i64>().unwrap()\n}\n`,
    "rust/inner/Cargo.toml": `[package]\nname = "inner"\nversion = "0.1.0"\nedition = "2021"\n`,
    "rust/inner/src/lib.rs": `pub fn value() -> i64 {\n    2\n}\n`,
    "src/rust.fsh": `declare module "rust:top" {\n  export function get(): i64;\n}\n`,
    "src/main.fsh": `import { get } from "rust:top";\n\nfunction main() {\n  console.log(get());\n}\n`,
  }, `top = { path = "rust/top" }`);
}

// The shim libraries built in the package's cache.
function shims(dir: string): string[] {
  return [...new Bun.Glob("fish/rust/*/target/**/libfsh_rust_shim.a").scanSync({ cwd: join(dir, "cache"), absolute: true })];
}

test("an unchanged shim isn't rebuilt, and a change to a crate, its dependencies or its build script is", () => {
  const dir = layered();
  const rebuilt = () => {
    const run = fishc(dir, ["build"]);
    expect(run).toEqual({ code: 0, out: "", err: "" });
    return built(dir).stdout.toString();
  };
  expect(rebuilt()).toBe("12\n");
  const [lib] = shims(dir);
  const made = statSync(lib!).mtimeMs;
  expect(rebuilt()).toBe("12\n");
  expect(statSync(lib!).mtimeMs).toBe(made);
  writeFileSync(join(dir, "rust", "inner", "src", "lib.rs"), `pub fn value() -> i64 {\n    3\n}\n`);
  expect(rebuilt()).toBe("13\n");
  writeFileSync(join(dir, "rust", "top", "build.rs"), `fn main() {\n    println!("cargo:rustc-env=BONUS=20");\n}\n`);
  expect(rebuilt()).toBe("23\n");
});

test("a deleted shim library or record is built again", () => {
  const dir = layered();
  expect(fishc(dir, ["build"]).code).toBe(0);
  const [lib] = shims(dir);
  rmSync(lib!);
  expect(fishc(dir, ["build"])).toEqual({ code: 0, out: "", err: "" });
  expect(existsSync(lib!)).toBe(true);
  rmSync(join(lib!, "..", "..", "..", "links.json"));
  expect(fishc(dir, ["build"])).toEqual({ code: 0, out: "", err: "" });
  expect(built(dir).stdout.toString()).toBe("12\n");
});

test("a shim built for a configured target is found where cargo puts it", () => {
  const dir = layered();
  const host = /^host: (.*)$/m.exec(Bun.spawnSync(["rustc", "-vV"]).stdout.toString())![1]!;
  mkdirSync(join(dir, ".cargo"));
  writeFileSync(join(dir, ".cargo", "config.toml"), `[build]\ntarget = "${host}"\n`);
  expect(fishc(dir, ["build"])).toEqual({ code: 0, out: "", err: "" });
  expect(built(dir).stdout.toString()).toBe("12\n");
  expect(shims(dir).some((l) => l.includes(`/target/${host}/release/`))).toBe(true);
  rmSync(join(dir, ".cargo"), { recursive: true });
  expect(fishc(dir, ["build"])).toEqual({ code: 0, out: "", err: "" });
  expect(built(dir).stdout.toString()).toBe("12\n");
});

test("a Rust panic's message keeps its NULs, and a payload that panics when dropped doesn't abort", () => {
  const dir = pkg({
    "src/rust.fsh": `declare module "rust:demo" {\n  export function nul(): i64;\n  export function bomb(): i64;\n}\n`,
    "src/main.fsh": `import { nul, bomb } from "rust:demo";\n\nfunction main() {\n  if (process.argv.length > 2) console.log(bomb());\n  console.log(nul());\n}\n`,
  });
  expect(fishc(dir, ["build"]).code).toBe(0);
  const nul = built(dir);
  expect([nul.exitCode, nul.stderr.toString()]).toEqual([101, "panicked at src/main.fsh:5:15:\nbefore\0after\n"]);
  const bomb = Bun.spawnSync([join(dir, "target", "debug", "app"), "x"]);
  expect([bomb.exitCode, bomb.stderr.toString()]).toEqual([101, "panicked at src/main.fsh:4:44:\na Rust panic with no message\n"]);
});

test("a macro can't make a function Rust, and the shim trusts no name the declarations didn't give", () => {
  const dir = pkg({
    "src/main.fsh": `macro function evil(input: AstStmt): AstStmt {
  let d = input;
  if (d.kind === "function") d.rust = { crate: "std", path: "fs::write", symbol: "fsh_rust_3std2fs5write" };
  return d;
}
@evil function y(n: i64): i64;
function main() {
  console.log(y(3));
}
`,
  });
  expect(refused(dir)).toStartWith("src/main.fsh:3:30: error: property 'rust' does not exist on type");
  expect(trusted({ crate: "demo", path: "util::mul", symbol: rustSymbol("demo", "util::mul") }).symbol).toBe("fsh_rust_4demo4util3mul");
  for (const name of [
    { crate: "std", path: "fs::write(x)", symbol: rustSymbol("std", "fs::write(x)") },
    { crate: "a b", path: "f", symbol: rustSymbol("a b", "f") },
    { crate: "demo", path: "add", symbol: "fsh_rust_x__y" },
  ]) {
    expect(() => trusted(name)).toThrow("internal error: a Rust function's name isn't one a declaration gives");
  }
});

test("only the package being built lists Rust crates", () => {
  const dir = pkg({
    "src/main.fsh": `import { twice } from "dep";\n\nfunction main() {\n  console.log(twice(5));\n}\n`,
    "dep/fish.toml": `[package]\nname = "dep"\nversion = "0.1.0"\n\n[rust-dependencies]\ndemo = { path = "../rust/demo" }\n`,
    "dep/src/lib.fsh": `import { add } from "rust:demo";\n\nexport function twice(a: i64): i64 {\n  return add(a, a);\n}\n`,
    "dep/src/rust.fsh": `declare module "rust:demo" {\n  export function add(a: i64, b: i64): i64;\n}\n`,
  }, `demo = { path = "rust/demo" }\n\n[dependencies]\ndep = { path = "dep" }`);
  const run = fishc(dir, ["build"]);
  expect(run.code).toBe(1);
  expect(run.err.split("\n")[0]).toBe("dep/fish.toml:5:1: error: the dependency 'dep' lists Rust crates under [rust-dependencies]; only the package being built may list them for now");
  expect(existsSync(join(dir, "cache", "fish", "rust"))).toBe(false);
});

test("declarations naming one Rust function share its shim function, and must agree on its types", () => {
  const dir = pkg({
    "src/rust.fsh": `declare module "rust:demo" {\n  export function add(a: i64, b: i64): i64;\n  @rust("add") export function plus(a: i64, b: i64): i64;\n}\n`,
    "src/main.fsh": `import { add, plus } from "rust:demo";\n\nfunction main() {\n  console.log(add(1, 2), plus(3, 4));\n}\n`,
  });
  expect(fishc(dir, ["build"])).toEqual({ code: 0, out: "", err: "" });
  expect(built(dir).stdout.toString()).toBe("3 7\n");
  const differing = pkg({
    "src/rust.fsh": `declare module "rust:demo" {\n  export function add(a: i64, b: i64): i64;\n  @rust("add") export function plus(a: i32, b: i32): i32;\n}\n`,
    "src/main.fsh": `import { add, plus } from "rust:demo";\n\nfunction main() {\n  console.log(add(1, 2), plus(3, 4));\n}\n`,
  });
  expect(refused(differing)).toBe("rust.fsh:3:3: error: 'demo::add' is declared elsewhere as (i64, i64): i64; declare it with the same types");
  // Each part of a path is told apart from the next, and two crates Rust reads as one are refused.
  expect(rustSymbol("a", "b__c")).not.toBe(rustSymbol("a__b", "c"));
  expect(refused(pkg({ "src/main.fsh": "function main() {}\n" }, `a-b = "1"\na_b = "1"`))).toContain("'a_b' and 'a-b' are the same crate in Rust");
});

test("a Rust panic is a Fish panic at the call", () => {
  const dir = pkg({ "src/main.fsh": `import { check } from "rust:demo";\n\nfunction main() {\n  console.log(check(1));\n  console.log(check(-2));\n}\n` });
  expect(fishc(dir, ["build"]).code).toBe(0);
  const run = built(dir);
  expect(run.exitCode).toBe(101);
  expect(run.stdout.toString()).toBe("1\n");
  expect(run.stderr.toString()).toBe("panicked at src/main.fsh:5:15:\nnegative: -2\n");
});

test("a build calling Rust without cargo on PATH says how to get it", () => {
  const dir = pkg({ "src/main.fsh": MAIN_FSH });
  const path = (process.env.PATH ?? "").split(delimiter).filter((d) => !existsSync(join(d, "cargo"))).join(delimiter);
  const run = fishc(dir, ["build"], env(join(dir, "cache"), path));
  expect(run.code).toBe(1);
  expect(run.err).toBe("this program calls Rust, which needs cargo to build, and cargo isn't on PATH; install Rust with rustup, from https://rustup.rs\n");
  // Checking alone never needs cargo.
  expect(fishc(dir, ["build", "--emit-llvm", "src/main.fsh"], env(join(dir, "cache"), path)).code).toBe(0);
});

test("two builds of one shim at once both succeed", async () => {
  const dir = pkg({ "src/main.fsh": MAIN_FSH });
  const vars = env(join(dir, "cache"));
  const runs = ["a", "b"].map((out) => Bun.spawn([process.execPath, MAIN, "build", "-o", join("target", out)], { cwd: dir, env: vars, stderr: "pipe" }));
  const ended = await Promise.all(runs.map(async (r) => ({ code: await r.exited, err: await new Response(r.stderr).text() })));
  expect(ended).toEqual([{ code: 0, err: "" }, { code: 0, err: "" }]);
  for (const out of ["a", "b"]) expect(Bun.spawnSync([join(dir, "target", out)]).stdout.toString()).toBe("42 2.5 1.5 true false -128 15 2 42\n");
});

test("fishc test runs a test that calls Rust", () => {
  const dir = pkg({ "src/main.fsh": `import { add } from "rust:demo";\n\nfunction main() {}\n\ntest("adds in Rust", () => {\n  assert(add(2, 3) === 5);\n});\n` });
  expect(fishc(dir, ["test"])).toEqual({ code: 0, out: "ok src/main.fsh > adds in Rust\n1 passed, 0 failed\n", err: "" });
});

test("a static library links the shim of the Rust it calls", () => {
  const dir = pkg({
    "src/lib.fsh": `import { add } from "rust:demo";\n\nexport function plus(a: i64, b: i64): i64 {\n  return add(a, b) * 2;\n}\n`,
    "main.c": `#include <stdio.h>\n#include "app.h"\nint main(void) {\n  printf("%lld\\n", (long long)plus(20, 1));\n  return 0;\n}\n`,
  });
  mkdirSync(join(dir, "out"));
  const run = fishc(dir, ["build", "src/lib.fsh", "--lib=static", "-o", "out/app"]);
  expect(run).toEqual({ code: 0, out: "", err: "" });
  const clang = Bun.spawnSync(["clang", join(dir, "main.c"), "-I", join(dir, "out"), join(dir, "out", "libapp.a"), "-lm", "-o", join(dir, "prog")]);
  expect(clang.stderr.toString()).toBe("");
  expect(Bun.spawnSync([join(dir, "prog")]).stdout.toString()).toBe("42\n");
});
