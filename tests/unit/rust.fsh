// Ports tests/rust.test.ts: Rust crates a package calls through a generated shim, built by the
// native fishc with cargo from the command line. Where the Bun test compiles in process, a build
// with `--emit-llvm` gives the IR, or the compile error it stops at, before cargo or clang runs.
// Each package has its own cache, as the Bun test's do, so cargo builds its shim from nothing.
// The shim's name checks run in process through the compiler's rust module; a name it refuses
// panics, so that check runs in a child process `again` starts on the same test.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { argv } from "node:process";
import { rustSymbol, trusted } from "../compiler/rust.fsh";
import { fishcPath, ran, removed, root as repo, same, scratch, text, type Ran } from "./support.fsh";

function fixture(): string {
  return join(repo(), "tests", "fixtures", "rust", "demo");
}

function declarations(): string {
  return `declare module "rust:demo" {
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
}

function mainFsh(): string {
  return `import { add, half, shrink, even, wrap, widths, bump, bumps, mul } from "rust:demo";

function main() {
  bump();
  bump();
  console.log(add(40, 2), half(5.0), shrink(3.0), even(4), even(7), wrap(127), widths(1, 2, 3, 4, 5), bumps(), mul(6, 7));
}
`;
}

function write(path: string, contents: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function entries(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch (e) {
    assert(false, `can't list ${dir}: ${e.message}`);
    return [];
  }
}

// A package of its own under `root`, with the fixture crate copied beside it under rust/demo,
// and `files`.
function pkg(root: string, files: Ref<[string, string][]>, crates: string = `demo = { path = "rust/demo" }`): string {
  const dir = join(root, `p${entries(root).length}`);
  try {
    mkdirSync(join(dir, "rust"), { recursive: true });
  } catch (e) {
    assert(false, `can't make ${dir}: ${e.message}`);
  }
  const copied = spawnSync("cp", ["-R", fixture(), join(dir, "rust", "demo")]);
  assert(copied.status === 0, `can't copy the fixture: ${text(copied.stderr)}`);
  write(join(dir, "fish.toml"), `[package]\nname = "app"\nversion = "0.1.0"\n\n[rust-dependencies]\n${crates}\n`);
  write(join(dir, "src", "rust.fsh"), declarations());
  for (const [path, contents] of files) write(join(dir, path), contents);
  return dir;
}

function path(): string {
  return process.env.PATH ?? "";
}

// Runs `fishc <args>` in `dir` with its own cache and `PATH` for PATH.
function fishc(dir: string, args: string[], withPath: string = path()): Ran {
  const run = spawnSync("env", ["-u", "FISH_CACHE_DIR", `XDG_CACHE_HOME=${join(dir, "cache")}`, `PATH=${withPath}`, fishcPath(), ...args], { cwd: dir });
  return { code: run.status ?? -1, out: text(run.stdout), err: text(run.stderr) };
}

function clean(got: Ref<Ran>, what: string): void {
  ran(got, 0, "", "", what);
}

// The IR the package's entry compiles to.
function ir(dir: string): string {
  const run = fishc(dir, ["build", "src/main.fsh", "--emit-llvm"]);
  assert(run.code === 0, `the program didn't compile:\n${run.err}`);
  return run.out;
}

// The first line of the compile error the package's entry gives.
function refused(dir: string): string {
  const run = fishc(dir, ["build", "src/main.fsh", "--emit-llvm"]);
  assert(run.code !== 0, "the program compiled");
  return run.err.split("\n")[0];
}

function has(got: string, part: string, what: string): void {
  assert(got.includes(part), `${what}: expected it to contain\n${part}\n--- got\n${got}`);
}

// A run of the package's program: its exit code, stdout and stderr.
type Out = { code: i64; out: string; err: string };

function program(dir: string, args: string[] = [], vars: string[] = []): Out {
  const run = spawnSync("env", [...vars, join(dir, "target", "debug", "app"), ...args]);
  return { code: run.status ?? -1, out: text(run.stdout), err: text(run.stderr) };
}

function built(dir: string): string {
  return program(dir).out;
}

// Runs the package's program with the leak check on.
function checked(dir: string, args: string[] = []): Out {
  return program(dir, args, ["FISH_LEAKS=1"]);
}

function sameOut(got: Ref<Out>, code: i64, out: string, err: string, what: string): void {
  assert(got.code === code && got.out === out && got.err === err, `${what}:\n--- expected\ncode ${code}\nstdout:\n${out}\nstderr:\n${err}\n--- got\ncode ${got.code}\nstdout:\n${got.out}\nstderr:\n${got.err}`);
}

test("a call of a Rust function is a call of its shim's symbol, with no unsafe", () => {
  const root = scratch("fish-rust-");
  const code = ir(pkg(root, [["src/main.fsh", mainFsh()]]));
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
    assert(code.includes(call), `the IR has no ${call}`);
  }
  assert(code.includes(`declare i64 @"fsh_rust_4demo3add"(i64, i64, ptr)`), "the IR doesn't declare add");
  assert(code.includes("call void @fsh_rt_panic_rust(ptr "), "the IR doesn't call fsh_rt_panic_rust");
  removed(root);
});

test("a crate's name with '-' is spelled with '_' in its shim's symbols", () => {
  const root = scratch("fish-rust-");
  const dir = pkg(root, [
    ["src/rust.fsh", `declare module "rust:my-crate" {\n  export function f(): i64;\n}\n`],
    ["src/main.fsh", `import { f } from "rust:my-crate";\nfunction main() {\n  console.log(f());\n}\n`],
  ], `my-crate = { path = "rust/demo" }`);
  assert(ir(dir).includes(`call i64 @"fsh_rust_8my_crate1f"(ptr `), "the IR has no call of fsh_rust_8my_crate1f");
  removed(root);
});

test("Rust declarations and imports are refused where they go wrong", () => {
  const root = scratch("fish-rust-");
  same(refused(pkg(root, [["src/main.fsh", `import { add } from "rust:other";\nfunction main() {}\n`]])), `src/main.fsh:1:1: error[E1004]: 'other' isn't a Rust dependency of this package; list it under [rust-dependencies] in fish.toml, as in other = "1.0"`, "a crate not listed");
  same(refused(pkg(root, [["src/main.fsh", `import { nope } from "rust:demo";\nfunction main() {}\n`]])), "src/main.fsh:1:10: error[E0902]: 'rust:demo' has no export named 'nope'", "a name not declared");
  const unsupported = pkg(root, [
    ["src/rust.fsh", `declare module "rust:demo" {\n  export function s(x: Map<string, i64>): i64;\n}\n`],
    ["src/main.fsh", `import { s } from "rust:demo";\nfunction main() {\n}\n`],
  ]);
  same(refused(unsupported), "rust.fsh:2:21: error[E1004]: a Rust function can't take a 'Map<string, i64>': maps can't cross the Rust boundary yet", "a map parameter");
  const returned = pkg(root, [
    ["src/rust.fsh", `declare module "rust:demo" {\n  export function s(): [i64, i64];\n}\n`],
    ["src/main.fsh", `import { s } from "rust:demo";\nfunction main() {\n  s();\n}\n`],
  ]);
  same(refused(returned), "rust.fsh:2:24: error[E1004]: the Rust function 's' can't give a '[i64, i64]': tuples can't cross the Rust boundary yet", "a tuple result");
  const named = pkg(root, [
    ["src/rust.fsh", `const name = "x";\ndeclare module "rust:demo" {\n  @rust(name) export function s(): i64;\n}\n`],
    ["src/main.fsh", `import { s } from "rust:demo";\nfunction main() {}\n`],
  ]);
  same(refused(named), `rust.fsh:3:4: error[E1004]: @rust takes the item's path in the crate as a string literal, as in @rust("util::mul")`, "a path that isn't a literal");
  const notPath = pkg(root, [
    ["src/rust.fsh", `declare module "rust:demo" {\n  @rust("a; b") export function s(): i64;\n}\n`],
    ["src/main.fsh", `import { s } from "rust:demo";\nfunction main() {}\n`],
  ]);
  same(refused(notPath), `rust.fsh:2:9: error[E1004]: this isn't a Rust path; write one from the crate's root, as in "util::mul"`, "a path that isn't Rust's");
  same(refused(pkg(root, [["src/rust.fsh", ""], ["src/main.fsh", `import { s } from "rust:demo";\nfunction main() {}\n`]])), `src/main.fsh:1:1: error[E1004]: no file of this package declares the functions of 'demo'; declare them in one, as in 'declare module "rust:demo" { export function f(x: i64): i64; }'`, "no declarations");
  removed(root);
});

test("a package builds and runs with a Rust crate's functions", () => {
  const root = scratch("fish-rust-");
  const dir = pkg(root, [["src/main.fsh", mainFsh()]]);
  const run = fishc(dir, ["build"]);
  same(run.err, "", "the build's stderr");
  assert(run.code === 0, `the build exited with ${run.code}`);
  same(built(dir), "42 2.5 1.5 true false -128 15 2 42\n", "the program");
  removed(root);
});

// A package calling `top`, a crate with a build script that depends on `inner`, another path crate.
function layered(root: string): string {
  return pkg(root, [
    ["rust/top/Cargo.toml", `[package]\nname = "top"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\ninner = { path = "../inner" }\n`],
    ["rust/top/build.rs", `fn main() {\n    println!("cargo:rustc-env=BONUS=10");\n}\n`],
    ["rust/top/src/lib.rs", `pub fn get() -> i64 {\n    inner::value() + env!("BONUS").parse::<i64>().unwrap()\n}\n`],
    ["rust/inner/Cargo.toml", `[package]\nname = "inner"\nversion = "0.1.0"\nedition = "2021"\n`],
    ["rust/inner/src/lib.rs", `pub fn value() -> i64 {\n    2\n}\n`],
    ["src/rust.fsh", `declare module "rust:top" {\n  export function get(): i64;\n}\n`],
    ["src/main.fsh", `import { get } from "rust:top";\n\nfunction main() {\n  console.log(get());\n}\n`],
  ], `top = { path = "rust/top" }`);
}

// The shim libraries built in the package's cache: fish/rust/*/target/**/libfsh_rust_shim.a.
function shims(dir: string): string[] {
  const cache = join(dir, "cache");
  const run = spawnSync("find", [join(cache, "fish", "rust"), "-name", "libfsh_rust_shim.a"]);
  let found: string[] = [];
  for (const line of text(run.stdout).split("\n")) {
    if (line === "") continue;
    if (/^fish\/rust\/[^\/]+\/target\/(.*\/)?libfsh_rust_shim\.a$/.test(line.slice((cache.length + 1) as i64))) found.push(line);
  }
  return found;
}

function mtime(path: string): f64 {
  try {
    return statSync(path).mtimeMs;
  } catch (e) {
    assert(false, `can't stat ${path}: ${e.message}`);
    return 0;
  }
}

function remove(path: string): void {
  try {
    rmSync(path, { recursive: true });
  } catch (e) {
    assert(false, `can't remove ${path}: ${e.message}`);
  }
}

function rebuilt(dir: string, what: string): string {
  clean(fishc(dir, ["build"]), what);
  return built(dir);
}

test("an unchanged shim isn't rebuilt, and a change to a crate, its dependencies or its build script is", () => {
  const root = scratch("fish-rust-");
  const dir = layered(root);
  same(rebuilt(dir, "the first build"), "12\n", "the program");
  const libs = shims(dir);
  assert(libs.length > 0, "no shim library was built");
  const lib = libs[0];
  const made = mtime(lib);
  same(rebuilt(dir, "an unchanged build"), "12\n", "the program unchanged");
  assert(mtime(lib) === made, "the unchanged shim was rebuilt");
  write(join(dir, "rust", "inner", "src", "lib.rs"), `pub fn value() -> i64 {\n    3\n}\n`);
  same(rebuilt(dir, "a build after a dependency changed"), "13\n", "the program after a dependency changed");
  write(join(dir, "rust", "top", "build.rs"), `fn main() {\n    println!("cargo:rustc-env=BONUS=20");\n}\n`);
  same(rebuilt(dir, "a build after the build script changed"), "23\n", "the program after the build script changed");
  removed(root);
});

test("a deleted shim library or record is built again", () => {
  const root = scratch("fish-rust-");
  const dir = layered(root);
  const first = fishc(dir, ["build"]);
  assert(first.code === 0, `the first build failed:\n${first.err}`);
  const libs = shims(dir);
  assert(libs.length > 0, "no shim library was built");
  const lib = libs[0];
  remove(lib);
  clean(fishc(dir, ["build"]), "a build after the library was deleted");
  assert(existsSync(lib), "the library wasn't built again");
  remove(join(lib, "..", "..", "..", "links.json"));
  clean(fishc(dir, ["build"]), "a build after the record was deleted");
  same(built(dir), "12\n", "the program");
  removed(root);
});

test("a shim built for a configured target is found where cargo puts it", () => {
  const root = scratch("fish-rust-");
  const dir = layered(root);
  const m = /^host: (.*)$/m.exec(text(spawnSync("rustc", ["-vV"]).stdout));
  assert(m !== null, "rustc -vV names no host");
  const host = m![1];
  write(join(dir, ".cargo", "config.toml"), `[build]\ntarget = "${host}"\n`);
  clean(fishc(dir, ["build"]), "a build for the configured target");
  same(built(dir), "12\n", "the program");
  assert(shims(dir).some((l) => l.includes(`/target/${host}/release/`)), `no shim under target/${host}/release: ${JSON.stringify(shims(dir))}`);
  remove(join(dir, ".cargo"));
  clean(fishc(dir, ["build"]), "a build for the host");
  same(built(dir), "12\n", "the program for the host");
  removed(root);
});

test("a Rust panic's message keeps its NULs, and a payload that panics when dropped doesn't abort", () => {
  const root = scratch("fish-rust-");
  const dir = pkg(root, [
    ["src/rust.fsh", `declare module "rust:demo" {\n  export function nul(): i64;\n  export function bomb(): i64;\n}\n`],
    ["src/main.fsh", `import { nul, bomb } from "rust:demo";\n\nfunction main() {\n  if (process.argv.length > 2) console.log(bomb());\n  console.log(nul());\n}\n`],
  ]);
  const b = fishc(dir, ["build"]);
  assert(b.code === 0, `the build failed:\n${b.err}`);
  const nul = program(dir);
  assert(nul.code === 101 && nul.err === "panicked at src/main.fsh:5:15:\nbefore\0after\nstack backtrace:\n   0: main at src/main.fsh:5:15\n", `nul: code ${nul.code}, stderr ${JSON.stringify(nul.err)}`);
  const bomb = program(dir, ["x"]);
  assert(bomb.code === 101 && bomb.err === "panicked at src/main.fsh:4:44:\na Rust panic with no message\nstack backtrace:\n   0: main at src/main.fsh:4:44\n", `bomb: code ${bomb.code}, stderr ${JSON.stringify(bomb.err)}`);
  removed(root);
});

// The names `trusted` must refuse, by index.
function untrusted(i: usize): { crate: string; path: string; symbol: string } {
  if (i === 0) return { crate: "std", path: "fs::write(x)", symbol: rustSymbol("std", "fs::write(x)") };
  if (i === 1) return { crate: "a b", path: "f", symbol: rustSymbol("a b", "f") };
  return { crate: "demo", path: "add", symbol: "fsh_rust_x__y" };
}

test("a macro can't make a function Rust, and the shim trusts no name the declarations didn't give", () => {
  // In the child `again` starts, the name to refuse.
  const which = process.env.FISH_RUST_UNTRUSTED;
  if (which !== undefined) {
    const _t = trusted(untrusted(parseInt(which)! as usize));
    return;
  }
  const root = scratch("fish-rust-");
  const dir = pkg(root, [
    ["src/main.fsh", `macro function evil(input: AstStmt): AstStmt {
  let d = input;
  if (d.kind === "function") d.rust = { crate: "std", path: "fs::write", symbol: "fsh_rust_3std2fs5write" };
  return d;
}
@evil function y(n: i64): i64;
function main() {
  console.log(y(3));
}
`],
  ]);
  const macro = refused(dir);
  assert(macro.startsWith("src/main.fsh:3:30: error[E0502]: property 'rust' does not exist on type"), `the macro: ${macro}`);
  same(trusted({ crate: "demo", path: "util::mul", symbol: rustSymbol("demo", "util::mul") }).symbol, "fsh_rust_4demo4util3mul", "a trusted name");
  // A refused name panics, so each is tried in a child process.
  for (let i = 0; i < 3; i++) {
    const run = spawnSync("env", [`FISH_RUST_UNTRUSTED=${i}`, process.execPath, argv()[2]]);
    const err = text(run.stderr) + text(run.stdout);
    assert(run.status !== 0 && err.includes("internal error: a Rust function's name isn't one a declaration gives"), `name ${i}: exit ${run.status ?? -1}:\n${err}`);
  }
  removed(root);
});

test("only the package being built lists Rust crates", () => {
  const root = scratch("fish-rust-");
  const dir = pkg(root, [
    ["src/main.fsh", `import { twice } from "dep";\n\nfunction main() {\n  console.log(twice(5));\n}\n`],
    ["dep/fish.toml", `[package]\nname = "dep"\nversion = "0.1.0"\n\n[rust-dependencies]\ndemo = { path = "../rust/demo" }\n`],
    ["dep/src/lib.fsh", `import { add } from "rust:demo";\n\nexport function twice(a: i64): i64 {\n  return add(a, a);\n}\n`],
    ["dep/src/rust.fsh", `declare module "rust:demo" {\n  export function add(a: i64, b: i64): i64;\n}\n`],
  ], `demo = { path = "rust/demo" }\n\n[dependencies]\ndep = { path = "dep" }`);
  const run = fishc(dir, ["build"]);
  assert(run.code === 1, `the build exited with ${run.code}`);
  same(run.err.split("\n")[0], "dep/fish.toml:5:1: error[E0906]: the dependency 'dep' lists Rust crates under [rust-dependencies]; only the package being built may list them for now", "the error");
  assert(!existsSync(join(dir, "cache", "fish", "rust")), "a shim was built");
  removed(root);
});

test("declarations naming one Rust function share its shim function, and must agree on its types", () => {
  const root = scratch("fish-rust-");
  const dir = pkg(root, [
    ["src/rust.fsh", `declare module "rust:demo" {\n  export function add(a: i64, b: i64): i64;\n  @rust("add") export function plus(a: i64, b: i64): i64;\n}\n`],
    ["src/main.fsh", `import { add, plus } from "rust:demo";\n\nfunction main() {\n  console.log(add(1, 2), plus(3, 4));\n}\n`],
  ]);
  clean(fishc(dir, ["build"]), "the build");
  same(built(dir), "3 7\n", "the program");
  const differing = pkg(root, [
    ["src/rust.fsh", `declare module "rust:demo" {\n  export function add(a: i64, b: i64): i64;\n  @rust("add") export function plus(a: i32, b: i32): i32;\n}\n`],
    ["src/main.fsh", `import { add, plus } from "rust:demo";\n\nfunction main() {\n  console.log(add(1, 2), plus(3, 4));\n}\n`],
  ]);
  same(refused(differing), "rust.fsh:3:3: error[E1004]: 'demo::add' is declared elsewhere as (i64, i64): i64; declare it with the same types", "differing types");
  // Each part of a path is told apart from the next, and two crates Rust reads as one are refused.
  assert(rustSymbol("a", "b__c") !== rustSymbol("a__b", "c"), "two paths share a symbol");
  has(refused(pkg(root, [["src/main.fsh", "function main() {}\n"]], `a-b = "1"\na_b = "1"`)), "'a_b' and 'a-b' are the same crate in Rust", "two crates Rust reads as one");
  removed(root);
});

test("a Rust panic is a Fish panic at the call", () => {
  const root = scratch("fish-rust-");
  const dir = pkg(root, [["src/main.fsh", `import { check } from "rust:demo";\n\nfunction main() {\n  console.log(check(1));\n  console.log(check(-2));\n}\n`]]);
  const b = fishc(dir, ["build"]);
  assert(b.code === 0, `the build failed:\n${b.err}`);
  sameOut(program(dir), 101, "1\n", "panicked at src/main.fsh:5:15:\nnegative: -2\nstack backtrace:\n   0: main at src/main.fsh:5:15\n", "the program");
  removed(root);
});

test("a build calling Rust without cargo on PATH says how to get it", () => {
  const root = scratch("fish-rust-");
  const dir = pkg(root, [["src/main.fsh", mainFsh()]]);
  const without = path().split(":").filter((d) => !existsSync(join(d, "cargo"))).join(":");
  const run = fishc(dir, ["build"], without);
  assert(run.code === 1, `the build exited with ${run.code}`);
  same(run.err, "this program calls Rust, which needs cargo to build, and cargo isn't on PATH; install Rust with rustup, from https://rustup.rs\n", "the error");
  // Checking alone never needs cargo.
  const llvm = fishc(dir, ["build", "--emit-llvm", "src/main.fsh"], without);
  assert(llvm.code === 0, `--emit-llvm without cargo exited with ${llvm.code}:\n${llvm.err}`);
  removed(root);
});

test("two builds of one shim at once both succeed", () => {
  const root = scratch("fish-rust-");
  const dir = pkg(root, [["src/main.fsh", mainFsh()]]);
  // Both builds as background jobs of one shell, each writing its exit code and stderr.
  const fishcAt = JSON.stringify(fishcPath());
  const script = `unset FISH_CACHE_DIR; export XDG_CACHE_HOME=${JSON.stringify(join(dir, "cache"))}
for out in a b; do (${fishcAt} build -o target/$out 2> err-$out; echo $? > code-$out) & done
wait`;
  spawnSync("sh", ["-c", script], { cwd: dir });
  for (const out of ["a", "b"]) {
    const code = spawnSync("cat", [join(dir, `code-${out}`)]);
    const err = spawnSync("cat", [join(dir, `err-${out}`)]);
    assert(text(code.stdout) === "0\n" && text(err.stdout) === "", `build ${out}: exit ${text(code.stdout)}stderr:\n${text(err.stdout)}`);
    same(text(spawnSync(join(dir, "target", out), []).stdout), "42 2.5 1.5 true false -128 15 2 42\n", `program ${out}`);
  }
  removed(root);
});

test("fishc test runs a test that calls Rust", () => {
  const root = scratch("fish-rust-");
  const dir = pkg(root, [["src/main.fsh", `import { add } from "rust:demo";\n\nfunction main() {}\n\ntest("adds in Rust", () => {\n  assert(add(2, 3) === 5);\n});\n`]]);
  ran(fishc(dir, ["test"]), 0, "ok src/main.fsh > adds in Rust\n1 passed, 0 failed\n", "", "fishc test");
  removed(root);
});

test("a static library links the shim of the Rust it calls", () => {
  const root = scratch("fish-rust-");
  const dir = pkg(root, [
    ["src/lib.fsh", `import { add } from "rust:demo";\n\nexport function plus(a: i64, b: i64): i64 {\n  return add(a, b) * 2;\n}\n`],
    ["main.c", `#include <stdio.h>\n#include "app.h"\nint main(void) {\n  printf("%lld\\n", (long long)plus(20, 1));\n  return 0;\n}\n`],
  ]);
  try {
    mkdirSync(join(dir, "out"));
  } catch (e) {
    assert(false, `can't make out: ${e.message}`);
  }
  clean(fishc(dir, ["build", "src/lib.fsh", "--lib=static", "-o", "out/app"]), "the library's build");
  const clang = spawnSync("clang", [join(dir, "main.c"), "-I", join(dir, "out"), join(dir, "out", "libapp.a"), "-lm", "-o", join(dir, "prog")]);
  same(text(clang.stderr), "", "clang's stderr");
  same(text(spawnSync(join(dir, "prog"), []).stdout), "42\n", "the C program");
  removed(root);
});

function handlesD(): string {
  return `declare module "rust:demo" {
  export class Counter {
    constructor(start: i64);
    @rust("zero") static empty(): Counter;
    get(): i64;
    add(this: Mut<this>, n: i64): void;
    finish(this: Own<this>): i64;
    fail(): i64;
    clone(): Counter;
  }
  export class Bare {
    static make(): Bare;
  }
  export class Racy {
    constructor();
    bump(): i64;
    get(): i64;
  }
  export function total(c: Ref<Counter>): i64;
  export function bump_counter(c: Mut<Counter>): void;
  export function consume(c: Counter): i64;
  export function drops(): i64;
}
`;
}

// A package declaring the fixture's Rust types, its entry the imports and then `program`.
function handles(root: string, program: string, decls: string = handlesD()): string {
  return pkg(root, [["src/rust.fsh", decls], ["src/main.fsh", `import { Counter, Bare, Racy, total, consume, drops, bump_counter } from "rust:demo";\n` + program]]);
}

test("a Rust type's constructor, statics and methods of each receiver are calls of its shim", () => {
  const root = scratch("fish-rust-");
  const code = ir(handles(root, `function main() {
  const c = new Counter(1);
  let e = Counter.empty();
  e.add(2);
  bump_counter(e);
  console.log(c.get(), total(c), consume(c.clone()), e.finish());
}
`));
  for (const call of [
    `ptr @"fsh_rust_4demo7Counter3new"(i64 1, ptr `,
    `ptr @"fsh_rust_4demo7Counter4zero"(ptr `,
    `void @"fsh_rust_4demo7Counter3add"(ptr %`,
    `void @"fsh_rust_4demo12bump_counter"(ptr %`,
    `i64 @"fsh_rust_4demo7Counter3get"(ptr %`,
    `i64 @"fsh_rust_4demo5total"(ptr %`,
    `ptr @"fsh_rust_4demo7Counter5clone"(ptr %`,
    `i64 @"fsh_rust_4demo7consume"(ptr %`,
    `i64 @"fsh_rust_4demo7Counter6finish"(ptr %`,
    `void @"fsh_rust_4demo7Counter_drop"(ptr %`,
  ]) {
    assert(code.includes(`call ${call}`) || code.includes(`invoke ${call}`), `the IR neither calls nor invokes ${call}`);
  }
  removed(root);
});

test("Rust handles move and borrow as Fish values do, and cross threads", () => {
  const root = scratch("fish-rust-");
  same(refused(handles(root, `function main() {\n  const c = new Counter(1);\n  consume(c);\n  console.log(c.get());\n}\n`)), "src/main.fsh:5:15: error[E0201]: 'c' was moved, so it can't be used here", "a use after a move");
  same(refused(handles(root, `function look(c: Ref<Counter>) {\n  c.add(1);\n}\nfunction main() {}\n`)), "src/main.fsh:3:3: error[E0206]: cannot call 'add' on 'c' because it is a shared reference ('Ref'), which only reads", "a Mut method through a Ref");
  const sent = handles(root, `async function run(c: Counter): Promise<i64> {\n  return c.get();\n}\nasync function main() {\n  const n = await spawn(run(new Counter(1)));\n  console.log(n);\n}\n`);
  const _code = ir(sent);
  removed(root);
});

test("what a Rust handle can't do is refused where it is written", () => {
  const root = scratch("fish-rust-");
  const cases: [string, string][] = [
    [`function main() {\n  const a = new Counter(1);\n  console.log(a === new Counter(2));\n}\n`, "src/main.fsh:4:15: error[E0112]: values of type 'Counter' can't be compared with '===': a Rust 'Counter' isn't compared from Fish; compare what its methods give"],
    [`function main() {\n  const a = new Counter(1);\n  console.log(a);\n}\n`, "src/main.fsh:4:15: error[E1004]: printing a 'Counter' isn't supported, since it holds a Rust value; print what its methods give"],
    [`function main() {\n  const a = new Counter(1);\n  const o = { ...a };\n}\n`, "src/main.fsh:4:15: error[E1004]: a Rust 'Counter' has no fields Fish can read, so it can't be spread; call its methods for what it holds"],
    [`function main() {\n  const b = Bare.make();\n  const c = b.clone();\n}\n`, "src/main.fsh:4:13: error[E0213]: can't clone a Rust 'Bare' unless its class declares 'clone(): Bare', which calls its Clone"],
    [`function main() {\n  const xs = [new Counter(1)];\n  const ys = xs.clone();\n}\n`, "src/main.fsh:4:14: error[E0213]: can't clone a value holding a Rust 'Counter' as a whole; clone each 'Counter' with its 'clone()'"],
    [`function main() {\n  const b = new Bare();\n}\n`, "src/main.fsh:3:13: error[E1004]: the Rust type 'Bare' declares no constructor; declare one, as in 'constructor(x: i64);', or make it with a static function"],
  ];
  let wrong: string[] = [];
  for (const [program, error] of cases) {
    const got = refused(handles(root, program));
    if (got !== error) wrong.push(`--- expected\n${error}\n--- got\n${got}`);
  }
  const declared: [string, string][] = [
    [`  export class A extends B {}`, "rust.fsh:2:26: error[E1004]: a Rust type's class can't extend another"],
    [`  export class A implements I {}`, "rust.fsh:2:29: error[E1004]: a Rust type's class can't implement an interface yet"],
    [`  export class A {\n    x: i64;\n  }`, "rust.fsh:3:5: error[E1004]: a Rust type's class declares a constructor, static functions and methods, without bodies; Rust fields aren't read from Fish"],
    [`  export class A {\n    get(): i64 {\n      return 1;\n    }\n  }`, "rust.fsh:3:5: error[E1004]: a Rust type's members are declared without bodies; the crate has them"],
    [`  @rust.other export class A {}`, `rust.fsh:2:4: error[E1004]: a Rust type takes only '@rust("path::to::Type")'`],
    [`  @rust.local export class A {}`, "rust.fsh:2:4: error[E1004]: Rust types that aren't Send aren't supported yet: Fish moves values between threads, so a Rust type must be Send"],
    [`  export class A {\n    @rust("a::b") get(): i64;\n  }`, `rust.fsh:3:11: error[E1004]: a member's Rust name is one name, as in "with_value"`],
  ];
  for (const [body, error] of declared) {
    const got = refused(handles(root, `function main() {}\n`, `declare module "rust:demo" {\n${body}\n}\n`));
    if (got !== error) wrong.push(`--- expected\n${error}\n--- got\n${got}`);
  }
  assert(wrong.length === 0, wrong.join("\n"));
  const lentRefused = pkg(root, [["src/rust.fsh", `declare module "rust:demo" {\n  export class A {\n    static make(): A;\n    peek(): Ref<A>;\n  }\n}\n`], ["src/main.fsh", `import { A } from "rust:demo";\nfunction main() {\n  A.make();\n}\n`]]);
  same(refused(lentRefused), "rust.fsh:4:13: error[E1004]: the Rust function 'A.peek' can't give a 'Ref<A>': a borrow's lifetime can't cross from Rust yet; give the value itself", "a lent result");
  const union = pkg(root, [["src/rust.fsh", `declare module "rust:demo" {\n  export class A {\n    static make(): A;\n    named(s: i64 | string): i64;\n  }\n}\n`], ["src/main.fsh", `import { A } from "rust:demo";\nfunction main() {\n  A.make();\n}\n`]]);
  same(refused(union), "rust.fsh:4:11: error[E1004]: a Rust function can't take a 'i64 | string': unions other than 'T | null' can't cross the Rust boundary yet; Rust enums other than Option and Result aren't supported", "a union parameter");
  removed(root);
});

test("a Rust type lives in Fish: made, called, lent, moved, cloned and dropped once", () => {
  const root = scratch("fish-rust-");
  const dir = handles(root, `function scoped() {
  const c = new Counter(7);
  console.log(c.get());
}

function main() {
  const c = new Counter(1);
  let e = Counter.empty();
  e.add(2);
  bump_counter(e);
  console.log(c.get(), e.get(), total(c));
  const d = c.clone();
  console.log(consume(d), drops());
  console.log(e.finish(), drops());
  scoped();
  console.log(drops());
}
`);
  clean(fishc(dir, ["build"]), "the build");
  sameOut(program(dir), 0, "1 102 1\n1001 1\n1020 2\n7\n3\n", "", "the program");
  removed(root);
});

test("a Rust type that isn't Send is refused by the build, naming Send", () => {
  const root = scratch("fish-rust-");
  const dir = handles(root, `function main() {\n  console.log(new Pinned().same());\n}\n`, handlesD().replace("  export function total", "  export class Pinned {\n    constructor();\n    same(): boolean;\n  }\n  export function total"));
  write(join(dir, "src", "main.fsh"), `import { Pinned } from "rust:demo";\nfunction main() {\n  console.log(new Pinned().same());\n}\n`);
  const run = fishc(dir, ["build"]);
  assert(run.code === 1, `the build exited with ${run.code}`);
  has(run.err, "cannot be sent between threads safely", "the build's stderr");
  has(run.err, "Send", "the build's stderr");
  removed(root);
});

test("a panic in a Rust method is a Fish panic at the call", () => {
  const root = scratch("fish-rust-");
  const dir = handles(root, `function main() {\n  const c = new Counter(4);\n  console.log(c.get());\n  console.log(c.fail());\n}\n`);
  const b = fishc(dir, ["build"]);
  assert(b.code === 0, `the build failed:\n${b.err}`);
  sameOut(program(dir), 101, "4\n", "panicked at src/main.fsh:5:15:\ncounter at 4\nstack backtrace:\n   0: main at src/main.fsh:5:15\n", "the program");
  removed(root);
});

function grumpy(root: string, main: string): string {
  return pkg(root, [["src/rust.fsh", `declare module "rust:demo" {\n  export class Grumpy {\n    constructor();\n  }\n}\n`], ["src/main.fsh", main]]);
}

test("a panic in a Rust value's drop is a Fish panic", () => {
  const root = scratch("fish-rust-");
  const dir = grumpy(root, `import { Grumpy } from "rust:demo";\n\nfunction main() {\n  const g = new Grumpy();\n  console.log("made");\n}\n`);
  const b = fishc(dir, ["build"]);
  assert(b.code === 0, `the build failed:\n${b.err}`);
  sameOut(program(dir), 101, "made\n", "panicked while dropping a Rust 'Grumpy':\ngrumpy to the end\nstack backtrace:\n   0: main at src/main.fsh:6:1\n", "the program");
  removed(root);
});

test("a drop panicking while a panic unwinds walks no frame the unwind left", () => {
  const root = scratch("fish-rust-");
  const dir = grumpy(root, `import { Grumpy } from "rust:demo";\nfunction inner(n: i64): i64 {\n  const a = [1, 2, 3, 4, 5, 6, 7, 8];\n  const b = [a[0], a[1], a[2]];\n  return b[n as usize];\n}\nfunction deeper(n: i64): i64 {\n  const xs = [n, n + 1];\n  return inner(xs[0]) + inner(xs[1]);\n}\nfunction holds(n: i64): i64 {\n  const g = new Grumpy();\n  const v = deeper(n);\n  return v;\n}\nfunction main() {\n  console.log(holds(9));\n}\n`);
  const b = fishc(dir, ["build"]);
  assert(b.code === 0, `the build failed:\n${b.err}`);
  const run = program(dir);
  const first = "panicked at src/main.fsh:5:10:\nindex out of bounds: the len is 3 but the index is 9\nstack backtrace:\n   0: inner at src/main.fsh:5:10\n   1: deeper at src/main.fsh:9:10\n   2: holds at src/main.fsh:13:13\n   3: main at src/main.fsh:17:15\n";
  sameOut({ code: run.code, out: "", err: run.err }, 101, "", `${first}panicked while dropping a Rust 'Grumpy':\ngrumpy to the end\n`, "the program");
  removed(root);
});

test("a Rust handle is owned by a spawned task, and shared between tasks, and dropped once", () => {
  const root = scratch("fish-rust-");
  const dir = handles(root, `async function doubled(c: Counter): Promise<i64> {
  return c.get() * 2;
}

async function work(state: shared<Counter>, n: i64): Promise<i64> {
  state.update((c) => c.add(n));
  return n;
}

async function both(): Promise<i64> {
  const state = shared<Counter>(new Counter(0));
  const a = spawn(work(state.clone(), 1));
  const b = spawn(work(state.clone(), 2));
  await a;
  await b;
  return state.update((c) => c.get());
}

async function main() {
  const n = await spawn(doubled(new Counter(21)));
  console.log(n, drops());
  const total = await both();
  console.log(total, drops());
}
`);
  clean(fishc(dir, ["build"]), "the build");
  sameOut(program(dir), 0, "42 1\n3 2\n", "", "the program");
  removed(root);
});

test("a Rust handle made for an Own method moves into it, never copied", () => {
  const root = scratch("fish-rust-");
  const dir = handles(root, `function mk(): Counter {
  return new Counter(5);
}

function pick(b: boolean): Counter | null {
  if (b) return new Counter(6);
  return null;
}

function main() {
  const c = new Counter(3);
  console.log(new Counter(4).finish(), mk().finish(), Counter.empty().finish(), c.clone().finish(), drops());
  const a = pick(true);
  if (a !== null) console.log(a.get(), pick(false) === null, drops());
}
`);
  clean(fishc(dir, ["build"]), "the build");
  sameOut(program(dir), 0, "40 50 0 30 4\n6 true 4\n", "", "the program");
  removed(root);
});

test("a shared value gives its Rust values only inside update, so they need only be Send", () => {
  const root = scratch("fish-rust-");
  same(refused(handles(root, `async function main() {\n  const s = shared<{ c: Counter }>({ c: new Counter(1) });\n  console.log(s.c.get());\n}\n`)), "src/main.fsh:4:15: error[E1004]: 'c' holds a Rust 'Counter', which a shared value gives only inside 'update', as in 's.update((v) => v.c...)'", "a call through the shared value");
  same(refused(handles(root, `async function main() {\n  const s = shared<{ c: Counter }>({ c: new Counter(1) });\n  const c = s.c;\n}\n`)), "src/main.fsh:4:13: error[E1004]: 'c' holds a Rust 'Counter', which a shared value gives only inside 'update', as in 's.update((v) => v.c...)'", "a read of the shared value");
  const dir = handles(root, `async function work(s: shared<{ r: Racy }>): Promise<i64> {
  for (let i = 0; i < 200; i++) {
    s.update((v) => v.r.bump());
    if (i % 10 === 0) await yieldNow();
  }
  return 0;
}

async function main() {
  const s = shared<{ r: Racy }>({ r: new Racy() });
  const a = spawn(work(s.clone()));
  const b = spawn(work(s.clone()));
  await a;
  await b;
  console.log(s.update((v) => v.r.get()));
}
`);
  clean(fishc(dir, ["build"]), "the build");
  same(built(dir), "400\n", "the program");
  removed(root);
});

test("no class extends a Rust type", () => {
  const root = scratch("fish-rust-");
  same(refused(handles(root, `class Mine extends Counter {\n  constructor() {\n    super(1);\n  }\n}\nfunction main() {}\n`)), "src/main.fsh:2:20: error[E1004]: a class can't extend the Rust type 'Counter'; hold one in a field instead", "extending Counter");
  same(refused(handles(root, `class Mine extends Bare {}\nfunction main() {}\n`)), "src/main.fsh:2:20: error[E1004]: a class can't extend the Rust type 'Bare'; hold one in a field instead", "extending Bare");
  removed(root);
});

test("a static and a method naming one Rust function are refused, and so is a Dyn of a Rust type", () => {
  const root = scratch("fish-rust-");
  const twice = pkg(root, [["src/rust.fsh", `declare module "rust:demo" {\n  export class Counter {\n    constructor(start: i64);\n    @rust("zero") again(): Counter;\n    static zero(): Counter;\n  }\n}\n`], ["src/main.fsh", `import { Counter } from "rust:demo";\nfunction main() {}\n`]]);
  same(refused(twice), "rust.fsh:5:5: error[E1004]: 'demo::Counter::zero' is declared elsewhere as (&self): Counter; declare it with the same types", "a static and a method");
  same(refused(handles(root, `interface Getter {\n  get(): i64;\n}\nfunction main() {\n  const d: Dyn<Getter> = new Counter(4);\n}\n`)), "src/main.fsh:6:26: error[E1004]: a Rust 'Counter' can't become a 'Dyn<Getter>' yet; call its methods on it, or take it as a generic parameter", "a Dyn");
  removed(root);
});

test("a Rust value moves through shorthand properties, '??' and destructuring defaults", () => {
  const root = scratch("fish-rust-");
  const dir = handles(root, `function mk(c: Counter): { c: Counter } {
  return { c };
}

function or(c: Counter | null): Counter {
  return c ?? Counter.empty();
}

function given({ a = new Counter(9) }: { a?: Counter }): i64 {
  return a.finish();
}

function main() {
  {
    const f = new Counter(4);
    const o = { f, n: 1 };
    console.log(o.f.get(), mk(new Counter(1)).c.get());
  }
  console.log(drops());
  {
    const a: Counter | null = null;
    const b = a ?? new Counter(3);
    const c: Counter | null = new Counter(2);
    const d = c ?? new Counter(5);
    console.log(b.get(), d.get(), or(null).get(), or(new Counter(6)).get(), drops());
  }
  console.log(drops());
  {
    const { a = new Counter(8) }: { a?: Counter } = {};
    console.log(a.get(), given({}), given({ a: new Counter(1) }), drops());
  }
  console.log(drops());
}
`);
  clean(fishc(dir, ["build"]), "the build");
  sameOut(program(dir), 0, "4 1\n2\n3 2 0 6 2\n6\n8 90 10 8\n9\n", "", "the program");
  has(refused(handles(root, `function main() {\n  const a: Counter | null = new Counter(1);\n  const b = a ?? new Counter(2);\n  const c = a ?? new Counter(3);\n}\n`)), "'a' was moved", "a second '??' of a moved value");
  removed(root);
});

test("a future holding a Rust value is boxed by moving it: stored as a Promise, through a function value, and as a handler", () => {
  const root = scratch("fish-rust-");
  const dir = handles(root, `async function hold(): Promise<i64> {
  const c = new Counter(5);
  await yieldNow();
  return c.get();
}

async function counted(_req: Request): Promise<Response> {
  const c = new Counter(7);
  await yieldNow();
  return new Response(\`count \${c.get()}\`);
}

async function main() {
  const f: () => Promise<i64> = hold;
  const a = await f();
  const d: Promise<i64> = hold();
  const b = await d;
  console.log(a, b, drops());
  let app = new Router();
  app.get("/n", counted);
  app.get("/m", async (_req) => {
    const c = new Counter(3);
    await yieldNow();
    return new Response(\`m \${c.get()}\`);
  });
  const n = await app.handle(new Request("/n"));
  const nb = await n.text();
  const m = await app.handle(new Request("/m"));
  const mb = await m.text();
  console.log(nb, mb, drops());
}
`);
  clean(fishc(dir, ["build"]), "the build");
  sameOut(program(dir), 0, "5 5 2\ncount 7 m 3 4\n", "", "the program");
  removed(root);
});

test("copying a boxed future holding a Rust value panics naming its type; one holding none copies", () => {
  const root = scratch("fish-rust-");
  const dir = handles(root, `async function hold(): Promise<i64> {
  const c = new Counter(5);
  await yieldNow();
  return c.get();
}

async function plain(): Promise<i64> {
  await yieldNow();
  return 2;
}

async function main() {
  const fine: Promise<i64>[] = [plain(), plain()];
  const kept = fine.slice(0, 1);
  console.log(kept.length);
  const ps: Promise<i64>[] = [hold(), hold()];
  const qs = ps.slice(0, 1);
  console.log(qs.length);
}
`);
  clean(fishc(dir, ["build"]), "the build");
  sameOut(program(dir), 101, "1\n", "panicked while copying a Dyn:\nits value holds a Rust 'Counter', which is moved, never copied; await the futures holding one, or move them rather than copy them\nstack backtrace:\n   0: main at src/main.fsh:18:14\n", "the program");
  removed(root);
});

function textD(): string {
  return `declare module "rust:demo" {
  export class Counter {
    constructor(start: i64);
    @rust("named") static named(name: string): Counter;
    get(): i64;
    describe(): string;
    tag(prefix: string | null): string | null;
  }
  @rust("text::greet") export function greet(name: string): string;
  @rust("text::shout") export function shout(s: string): string;
  @rust("text::label") export function label(): string;
  @rust("text::chars") export function chars(s: string): usize;
  @rust("text::code_points") export function codePoints(s: string): string;
  @rust("text::halve") export function halve(n: i64 | null): i64 | null;
  @rust("text::flip") export function flip(b: boolean | null): boolean | null;
  @rust("text::bracket") export function bracket(s: string | null): string | null;
  @rust("text::find") export function find(start: i64): Counter | null;
  @rust("text::value_or_zero") export function valueOrZero(c: Counter | null): i64;
  export function drops(): i64;
}
`;
}

test("strings and Options cross to Rust and back, whichever Rust types take and give them", () => {
  const root = scratch("fish-rust-");
  const dir = pkg(root, [
    ["src/rust.fsh", textD()],
    ["src/main.fsh", `import { Counter, greet, shout, label, chars, codePoints, halve, flip, bracket, find, valueOrZero, drops } from "rust:demo";

function main() {
  const who = "fish";
  console.log(greet(who), shout("loud " + who), label(), chars("héllo"));
  console.log(codePoints("a\\uD800b"), codePoints("é"));
  console.log(halve(9), halve(null), flip(true), flip(null));
  console.log(bracket("x"), bracket(null));
  const c = find(4);
  if (c !== null) console.log(c.get(), c.describe(), c.tag("#"), c.tag(null));
  console.log(find(0) === null, valueOrZero(find(3)), valueOrZero(null));
  const n = Counter.named("four");
  console.log(n.get(), drops());
}
`],
  ]);
  clean(fishc(dir, ["build"]), "the build");
  sameOut(checked(dir), 0, "hello, fish LOUD FISH a static label 5\n61 FFFD 62 E9\n4 null false null\n<x> null\n4 counter 4 #4 null\ntrue 3 0\n4 1\n", "", "the program");
  removed(root);
});

// The first line of the error declaring `body` in the demo crate's module gives.
function declaredF(root: string, body: string, counter: boolean = false): string {
  const head = counter ? `  export class Counter {\n    constructor(start: i64);\n  }\n` : "";
  return refused(pkg(root, [["src/rust.fsh", `declare module "rust:demo" {\n${head}  ${body}\n}\n`], ["src/main.fsh", `import { f } from "rust:demo";\nfunction main() {}\n`]]));
}

test("what can't cross the Rust boundary yet is refused at its type", () => {
  const root = scratch("fish-rust-");
  same(declaredF(root, "export function f(m: Map<string, i64>): i64;"), "rust.fsh:2:21: error[E1004]: a Rust function can't take a 'Map<string, i64>': maps can't cross the Rust boundary yet", "a map");
  same(declaredF(root, "export function f(): [i64, i64];"), "rust.fsh:2:24: error[E1004]: the Rust function 'f' can't give a '[i64, i64]': tuples can't cross the Rust boundary yet", "a tuple");
  same(declaredF(root, "export function f(x: i64 | string): i64;"), "rust.fsh:2:21: error[E1004]: a Rust function can't take a 'i64 | string': unions other than 'T | null' can't cross the Rust boundary yet; Rust enums other than Option and Result aren't supported", "a union");
  same(declaredF(root, "export function f(): Ref<i64[]>;"), "rust.fsh:2:24: error[E1004]: the Rust function 'f' can't give a 'Ref<i64[]>': a borrow's lifetime can't cross from Rust yet; give the value itself", "a lent result");
  same(declaredF(root, "export function f(x: Mut<i64[]>): void;"), "rust.fsh:2:21: error[E1004]: a Rust function can't take a 'Mut<i64[]>': 'Mut<T[]>' would be '&mut [T]', which can't cross yet; pass the array, which moves it", "a mutable slice");
  removed(root);
});

function fallibleD(): string {
  return `declare module "rust:demo" {
  export class Oops {
    code(): i64;
  }
  export class Counter {
    @rust("try_new") constructor(start: i64) throws Oops;
    get(): i64;
    @rust("checked_add") add(this: Mut<this>, n: i64): i64 throws Error;
  }
  @rust("fallible::parse") export function parse(s: string): i64 throws Error;
  @rust("fallible::check") export function check(n: i64): i64 throws Oops;
  @rust("fallible::touch") export function touch(ok: boolean): void throws Error;
  @rust("fallible::oops_drops") export function oopsDrops(): i64;
}
`;
}

test("a Rust Result is a Fish throws: Err caught as an Error or as a Rust value, propagated, and dropped once", () => {
  const root = scratch("fish-rust-");
  const dir = pkg(root, [["src/rust.fsh", fallibleD()], ["src/main.fsh", `import { Oops, Counter, parse, check, touch, oopsDrops } from "rust:demo";

function doubled(n: i64): i64 throws Oops {
  return check(n) + 1;
}

function main() {
  try {
    console.log(parse("42"));
    console.log(parse("4x2"));
  } catch (e) {
    console.log("caught:", e.message);
  }
  try {
    console.log(check(5));
    console.log(check(-3));
  } catch (e) {
    console.log("oops", e.code(), oopsDrops());
  }
  console.log(oopsDrops());
  try {
    console.log(doubled(2));
    console.log(doubled(-7));
  } catch (e) {
    console.log("propagated", e.code());
  }
  try {
    touch(true);
    console.log("touched");
    touch(false);
  } catch (e) {
    console.log("caught:", e.message);
  }
  try {
    let c = new Counter(1);
    try {
      console.log(c.add(2));
      console.log(c.add(9223372036854775807));
    } catch (e) {
      console.log("caught:", e.message);
    }
  } catch (e) {
    console.log("unexpected", e.code());
  }
  try {
    const d = new Counter(-1);
    console.log(d.get());
  } catch (e) {
    console.log("no counter", e.code());
  }
  console.log(oopsDrops());
}
`]]);
  clean(fishc(dir, ["build"]), "the build");
  sameOut(checked(dir), 0, "42\ncaught: invalid digit found in string\n10\noops -3 0\n1\n5\npropagated -7\ntouched\ncaught: touch failed\n3\ncaught: 3 + 9223372036854775807 overflows\nno counter -1\n3\n", "", "the program");
  removed(root);
});

test("a fallible Rust call needs a throws clause or a catch, and throws only Error or a Rust type", () => {
  const root = scratch("fish-rust-");
  same(refused(pkg(root, [["src/rust.fsh", fallibleD()], ["src/main.fsh", `import { parse } from "rust:demo";\nfunction main() {\n  console.log(parse("1"));\n}\n`]])), "src/main.fsh:3:15: error[E0602]: 'main' must declare 'throws Error' after its return type since 'parse' can throw 'Error', or catch it with try/catch", "an uncaught call");
  same(refused(pkg(root, [["src/rust.fsh", `declare module "rust:demo" {\n  export function f(): i64 throws string;\n}\n`], ["src/main.fsh", `import { f } from "rust:demo";\nfunction main() {}\n`]])), "rust.fsh:2:35: error[E1004]: the Rust function 'f' throws a Rust 'Err' as Fish's 'Error', made from its Display text, or as a Rust type declared in a 'rust:' block, not as a 'string'", "throws string");
  same(refused(pkg(root, [["src/main.fsh", `class A {\n  n: i64 = 0;\n  constructor() throws Error {\n    throw new Error("no");\n  }\n}\nfunction main() {}\n`]])), "src/main.fsh:4:5: error[E0602]: a constructor can only throw before it assigns its first field, so a failed 'new' leaves nothing half built; field initializers count as assigned first, so check and throw before assigning, then assign the fields", "a constructor throwing late");
  removed(root);
});

function vectorsD(): string {
  return `declare module "rust:demo" {
  export class Counter {
    constructor(start: i64);
    get(): i64;
  }
  @rust("vectors::sum") export function sum(xs: Ref<i64[]>): i64;
  @rust("vectors::len_vec") export function lenVec(xs: Ref<i64[]>): usize;
  @rust("vectors::doubled") export function doubled(xs: i64[]): i64[];
  @rust("vectors::flags") export function flags(xs: boolean[]): boolean[];
  @rust("vectors::words") export function words(s: string): string[];
  @rust("vectors::statics") export function statics(): string[];
  @rust("vectors::joined") export function joined(xs: Ref<string[]>): string;
  @rust("vectors::owned_join") export function ownedJoin(xs: string[]): string;
  @rust("vectors::counters") export function counters(n: i64): Counter[];
  @rust("vectors::total_all") export function totalAll(cs: Counter[]): i64;
  @rust("vectors::maybe_list") export function maybeList(n: i64): i64[] | null;
  @rust("vectors::count_opt") export function countOpt(xs: i64[] | null): i64;
  export function drops(): i64;
}
`;
}

test("arrays cross to Rust as vectors and slices and back, Rust values moved both ways and dropped once", () => {
  const root = scratch("fish-rust-");
  const dir = pkg(root, [["src/rust.fsh", vectorsD()], ["src/main.fsh", `import { Counter, sum, lenVec, doubled, flags, words, statics, joined, ownedJoin, counters, totalAll, maybeList, countOpt, drops } from "rust:demo";

function main() {
  const xs: i64[] = [1, 2, 3];
  const empty: i64[] = [];
  console.log(sum(xs), lenVec(xs), sum(empty), doubled([4, 5]), doubled(empty));
  console.log(flags([true, false]), words("to be  or"), statics());
  const names = ["x", "y" + "z"];
  console.log(joined(names), ownedJoin(["p", "q"]), names.length);
  {
    const cs = counters(3);
    console.log(cs.length, cs[2].get(), drops());
    console.log(totalAll(cs), drops());
    const more = counters(2);
    console.log(more[0].get(), drops());
  }
  console.log(drops());
  console.log(maybeList(3), maybeList(0), countOpt([7, 8]), countOpt(null));
}
`]]);
  clean(fishc(dir, ["build"]), "the build");
  sameOut(checked(dir), 0, "6 3 0 [ 8, 10 ] []\n[ false, true ] [ 'to', 'be', 'or' ] [ 'a', 'b' ]\nx+yz p-q 2\n3 3 0\n6 3\n1 3\n5\n[ 0, 1, 2 ] null 2 -1\n", "", "the program");
  removed(root);
});

test("a slice of Rust values, an array of arrays and a mutable slice are refused at their types", () => {
  const root = scratch("fish-rust-");
  same(declaredF(root, "export function f(xs: Ref<Counter[]>): i64;", true), "rust.fsh:5:21: error[E1004]: a Rust function can't take a 'Ref<Counter[]>': a slice of Rust values can't be lent, since Fish holds each in its own box; pass the array, which moves them", "a slice of Rust values");
  same(declaredF(root, "export function f(xs: i64[][]): i64;", true), "rust.fsh:5:21: error[E1004]: a Rust function can't take a 'i64[][]': arrays of arrays can't cross the Rust boundary yet", "an array of arrays taken");
  same(declaredF(root, "export function f(): string[][];", true), "rust.fsh:5:24: error[E1004]: the Rust function 'f' can't give a 'string[][]': arrays of arrays can't cross the Rust boundary yet", "an array of arrays given");
  same(declaredF(root, "export function f(xs: Mut<i64[]>): void;", true), "rust.fsh:5:21: error[E1004]: a Rust function can't take a 'Mut<i64[]>': 'Mut<T[]>' would be '&mut [T]', which can't cross yet; pass the array, which moves it", "a mutable slice");
  removed(root);
});

function edgesD(): string {
  return `declare module "rust:demo" {
  export class Counter {
    constructor(start: i64);
    get(): i64;
  }
  @rust("edges::consume_all") export function consumeAll(s: string, xs: i64[], c: Counter, fail: boolean): i64 throws Error;
  @rust("edges::boom") export function boom(s: string, xs: Ref<i64[]>, words: string[], c: Counter): i64;
  @rust("edges::opt_words") export function optWords(xs: string[] | null): i64;
  @rust("edges::opt_counters") export function optCounters(cs: Counter[] | null): i64;
  @rust("edges::bytes") export function bytes(xs: Ref<u8[]>): u8[];
  @rust("edges::scale") export function scale(xs: f32[]): f32[];
  @rust("vectors::sum") export function sum(xs: Ref<i64[]>): i64;
  @rust("text::code_points") export function codePoints(s: string): string;
  export function drops(): i64;
}
`;
}

test("Err and panic paths give up converted arguments, and Options of arrays, small numbers, temporaries, fields and surrogates cross", () => {
  const root = scratch("fish-rust-");
  const dir = pkg(root, [["src/rust.fsh", edgesD()], ["src/main.fsh", `import { Counter, consumeAll, boom, optWords, optCounters, bytes, scale, sum, codePoints, drops } from "rust:demo";

type Holder = { xs: i64[] };

function main() {
  const name = "n" + "ame";
  try {
    console.log(consumeAll(name, [1, 2], new Counter(5), false), drops());
    console.log(consumeAll("x" + name, [1, 2, 3], new Counter(6), true));
  } catch (e) {
    console.log("caught:", e.message, drops());
  }
  console.log(optWords(["ab", "c" + "d"]), optWords(null), optCounters([new Counter(2), new Counter(3)]), optCounters(null), drops());
  const raw: u8[] = [1, 2, 255];
  const f: f32[] = [1.5, 2];
  console.log(bytes(raw), scale(f));
  const h: Holder = { xs: [4, 5] };
  console.log(sum([1, 2, 3]), sum(h.xs));
  const high = "\\uD83D";
  console.log(codePoints("ab\\uD800"), codePoints(high + "\\uDE00"));
  if (process.argv.length > 2) boom("s" + name, h.xs, ["w", "v" + name], new Counter(9));
}
`]]);
  clean(fishc(dir, ["build"]), "the build");
  const out = "7 1\ncaught: failed with xname 3 6 2\n4 -1 5 -1 4\n[ 255, 2, 1 ] [ 2.25, 3 ]\n6 9\n61 62 FFFD 1F600\n";
  sameOut(checked(dir), 0, out, "", "the program");
  sameOut(checked(dir, ["x"]), 101, out, "panicked at src/main.fsh:21:32:\nboom sname 2 2 9\nstack backtrace:\n   0: main at src/main.fsh:21:32\n", "the program that panics");
  removed(root);
});

test("a returned array whose Rust elements aren't the declared ones is cargo's type error", () => {
  const root = scratch("fish-rust-");
  for (const decl of ['@rust("edges::small") export function f(n: i64): i64[];', 'export class Oops {\n    code(): i64;\n  }\n  @rust("vectors::counters") export function f(n: i64): Oops[];']) {
    const dir = pkg(root, [["src/rust.fsh", `declare module "rust:demo" {\n  ${decl}\n}\n`], ["src/main.fsh", `import { f } from "rust:demo";\nfunction main() {\n  console.log(f(1).length);\n}\n`]]);
    const run = fishc(dir, ["build"]);
    assert(run.code === 1, `${decl}: the build exited with ${run.code}`);
    has(run.err, "type mismatch in closure arguments", decl);
  }
  removed(root);
});

function twiceD(root: string, body: string): string {
  return refused(pkg(root, [["src/rust.fsh", `declare module "rust:demo" {\n  export class Oops {\n    code(): i64;\n  }\n${body}}\n`], ["src/main.fsh", `import { a, b } from "rust:demo";\nfunction main() {}\n`]]));
}

test("declarations of one Rust function agree on what they throw, and a static and a constructor that agree share it", () => {
  const root = scratch("fish-rust-");
  same(twiceD(root, `  @rust("fallible::check") export function a(n: i64): i64 throws Oops;\n  @rust("fallible::check") export function b(n: i64): i64;\n`), "rust.fsh:6:3: error[E1004]: 'demo::fallible::check' is declared elsewhere as (i64): i64 throws Oops; declare it with the same types", "one throwing and one not");
  same(twiceD(root, `  @rust("fallible::parse") export function a(s: string): i64 throws Error;\n  @rust("fallible::parse") export function b(s: string): i64 throws Oops;\n`), "rust.fsh:6:3: error[E1004]: 'demo::fallible::parse' is declared elsewhere as (string): i64 throws Error; declare it with the same types", "two throwing differently");
  const dir = pkg(root, [
    ["src/rust.fsh", `declare module "rust:demo" {\n  export class Counter {\n    constructor(start: i64);\n    @rust("new") static make(start: i64): Counter;\n    get(): i64;\n  }\n}\n`],
    ["src/main.fsh", `import { Counter } from "rust:demo";\nfunction main() {\n  console.log(new Counter(2).get(), Counter.make(3).get());\n}\n`],
  ]);
  clean(fishc(dir, ["build"]), "the build");
  sameOut(checked(dir), 0, "2 3\n", "", "the program");
  removed(root);
});

test("a Rust value Fish holds can't borrow what the call was given, and one that owns its data can be held", () => {
  const root = scratch("fish-rust-");
  const borrowing: [string, string][] = [
    ['@rust("borrow::many") export function f(s: string): Holder[];', 'const hs = f("abc" + "def");\n  console.log(hs[0].get());'],
    ['@rust("borrow::bad") export function f(s: string): i64 throws Holder;', 'try {\n    console.log(f("abc" + "def"));\n  } catch (e) {\n    console.log(e.get());\n  }'],
  ];
  for (const [decl, use] of borrowing) {
    const dir = pkg(root, [
      ["src/rust.fsh", `declare module "rust:demo" {\n  @rust("borrow::Holder") export class Holder {\n    get(): string;\n  }\n  ${decl}\n}\n`],
      ["src/main.fsh", `import { Holder, f } from "rust:demo";\nfunction main() {\n  ${use}\n}\n`],
    ]);
    const run = fishc(dir, ["build"]);
    assert(run.code === 1, `${decl}: the build exited with ${run.code}`);
    has(run.err, "does not live long enough", decl);
  }
  const dir = pkg(root, [
    ["src/rust.fsh", `declare module "rust:demo" {\n  @rust("borrow::Owner") export class Owner {\n    get(): string;\n  }\n  @rust("borrow::owned") export function owned(s: string): Owner[];\n  @rust("borrow::owned_err") export function ownedErr(s: string): i64 throws Owner;\n}\n`],
    ["src/main.fsh", `import { Owner, owned, ownedErr } from "rust:demo";\nfunction main() {\n  const hs = owned("abc" + "def");\n  const junk = "zzzzzz" + "yyyyyy";\n  try {\n    console.log(ownedErr("e" + "rr"));\n  } catch (e) {\n    console.log(hs[0].get(), e.get(), junk);\n  }\n}\n`],
  ]);
  clean(fishc(dir, ["build"]), "the build");
  sameOut(checked(dir), 0, "abcdef err zzzzzzyyyyyy\n", "", "the program");
  removed(root);
});

function borrowD(member: string, looks: boolean): string {
  return `declare module "rust:demo" {
  export class Counter {
    constructor(start: i64);
  }
  @rust("borrow::Peek") export class Peek {
    first(): i64;
  }
  @rust("borrow::Look") export class Look {
    read(): i64;
  }
  @rust("borrow::Item") export class Item {
    get(): i64;
  }
  @rust("borrow::Bag") export class Bag {
    constructor(n: i64);
    ${member}
  }
  ${looks ? `@rust("borrow::looks") export function looks(c: Ref<Counter>): Look[];` : ""}
}
`;
}

// Only the function a case calls is declared, since each declared one goes into the shim.
function borrowBuild(root: string, member: string, use: string, looks: boolean): [string, Ran] {
  const dir = pkg(root, [
    ["src/rust.fsh", borrowD(member, looks)],
    ["src/main.fsh", `import { Counter, Peek, Look, Item, Bag${looks ? ", looks" : ""} } from "rust:demo";\nfunction main() {\n  ${use}\n}\n`],
  ]);
  return [dir, fishc(dir, ["build"])];
}

test("a Rust value Fish holds can't borrow the receiver or a lent Rust value, and one owning its data can be held", () => {
  const root = scratch("fish-rust-");
  const cases: [string, string, boolean][] = [
    ["views(): Peek[];", "const b = new Bag(3);\n  console.log(b.views().length);", false],
    ["viewe(): i64 throws Peek;", "const b = new Bag(3);\n  try {\n    console.log(b.viewe());\n  } catch (e) {\n    console.log(e.first());\n  }", false],
    ["", "const c = new Counter(41);\n  console.log(looks(c).length);", true],
  ];
  for (const [member, use, looks] of cases) {
    const [_dir, run] = borrowBuild(root, member, use, looks);
    assert(run.code === 1, `${use}: the build exited with ${run.code}`);
    has(run.err, "does not live long enough", use);
  }
  const [dir, run] = borrowBuild(root, "items(): Item[];", "const items = new Bag(3).items();\n  const junk = [9, 9, 9];\n  console.log(items[0].get(), items.length, junk.length);", false);
  clean(run, "the build");
  sameOut(checked(dir), 0, "3 3 3\n", "", "the program");
  removed(root);
});
