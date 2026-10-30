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
  expect(refused(unsupported)).toBe("rust.fsh:2:21: error: a 'string' can't cross the Rust boundary yet; Rust functions take and give numbers, booleans and Rust types");
  const returned = pkg({
    "src/rust.fsh": `declare module "rust:demo" {\n  export function s(): i64[];\n}\n`,
    "src/main.fsh": `import { s } from "rust:demo";\nfunction main() {\n  s();\n}\n`,
  });
  expect(refused(returned)).toBe("rust.fsh:2:24: error: a 'i64[]' can't cross the Rust boundary yet; Rust functions take and give numbers, booleans and Rust types");
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

const HANDLES = `declare module "rust:demo" {
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

const IMPORTS = `import { Counter, Bare, Racy, total, consume, drops, bump_counter } from "rust:demo";\n`;

// A package declaring the fixture's Rust types, its entry `IMPORTS` and then `program`.
function handles(program: string, declarations = HANDLES): string {
  return pkg({ "src/rust.fsh": declarations, "src/main.fsh": IMPORTS + program });
}

test("a Rust type's constructor, statics and methods of each receiver are calls of its shim", () => {
  const dir = handles(`function main() {
  const c = new Counter(1);
  let e = Counter.empty();
  e.add(2);
  bump_counter(e);
  console.log(c.get(), total(c), consume(c.clone()), e.finish());
}
`);
  const file = join(dir, "src", "main.fsh");
  const ir = compile(readFileSync(file, "utf8"), file);
  for (const call of [
    `call ptr @"fsh_rust_4demo7Counter3new"(i64 1, ptr `,
    `call ptr @"fsh_rust_4demo7Counter4zero"(ptr `,
    `call void @"fsh_rust_4demo7Counter3add"(ptr %`,
    `call void @"fsh_rust_4demo12bump_counter"(ptr %`,
    `call i64 @"fsh_rust_4demo7Counter3get"(ptr %`,
    `call i64 @"fsh_rust_4demo5total"(ptr %`,
    `call ptr @"fsh_rust_4demo7Counter5clone"(ptr %`,
    `call i64 @"fsh_rust_4demo7consume"(ptr %`,
    `call i64 @"fsh_rust_4demo7Counter6finish"(ptr %`,
    `call void @"fsh_rust_4demo7Counter_drop"(ptr %`,
  ]) {
    expect(ir).toMatch(new RegExp(`(call|invoke) ${call.slice("call ".length).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
});

test("Rust handles move and borrow as Fish values do, and cross threads", () => {
  expect(refused(handles(`function main() {\n  const c = new Counter(1);\n  consume(c);\n  console.log(c.get());\n}\n`))).toBe("src/main.fsh:5:15: error: 'c' was moved, so it can't be used here");
  expect(refused(handles(`function look(c: Ref<Counter>) {\n  c.add(1);\n}\nfunction main() {}\n`))).toBe("src/main.fsh:3:3: error: cannot call 'add' on 'c' because it is a shared reference ('Ref'), which only reads");
  const sent = handles(`async function run(c: Counter): Promise<i64> {\n  return c.get();\n}\nasync function main() {\n  const n = await spawn(run(new Counter(1)));\n  console.log(n);\n}\n`);
  const file = join(sent, "src", "main.fsh");
  expect(() => compile(readFileSync(file, "utf8"), file)).not.toThrow();
});

test("what a Rust handle can't do is refused where it is written", () => {
  const cases: [string, string][] = [
    [`function main() {\n  const a = new Counter(1);\n  console.log(a === new Counter(2));\n}\n`, "src/main.fsh:4:15: error: values of type 'Counter' can't be compared with '===': a Rust 'Counter' isn't compared from Fish; compare what its methods give"],
    [`function main() {\n  const a = new Counter(1);\n  console.log(a);\n}\n`, "src/main.fsh:4:15: error: printing a 'Counter' isn't supported, since it holds a Rust value; print what its methods give"],
    [`function main() {\n  const a = new Counter(1);\n  const o = { ...a };\n}\n`, "src/main.fsh:4:15: error: a Rust 'Counter' has no fields Fish can read, so it can't be spread; call its methods for what it holds"],
    [`function main() {\n  const b = Bare.make();\n  const c = b.clone();\n}\n`, "src/main.fsh:4:13: error: can't clone a Rust 'Bare' unless its class declares 'clone(): Bare', which calls its Clone"],
    [`function main() {\n  const xs = [new Counter(1)];\n  const ys = xs.clone();\n}\n`, "src/main.fsh:4:14: error: can't clone a value holding a Rust 'Counter' as a whole; clone each 'Counter' with its 'clone()'"],
    [`function main() {\n  const b = new Bare();\n}\n`, "src/main.fsh:3:13: error: the Rust type 'Bare' declares no constructor; declare one, as in 'constructor(x: i64);', or make it with a static function"],
  ];
  for (const [program, error] of cases) expect(refused(handles(program))).toBe(error);
  const declared = (body: string) => refused(handles(`function main() {}\n`, `declare module "rust:demo" {\n${body}\n}\n`));
  expect(declared(`  export class A extends B {}`)).toBe("rust.fsh:2:26: error: a Rust type's class can't extend another");
  expect(declared(`  export class A implements I {}`)).toBe("rust.fsh:2:29: error: a Rust type's class can't implement an interface yet");
  expect(declared(`  export class A {\n    x: i64;\n  }`)).toBe("rust.fsh:3:5: error: a Rust type's class declares a constructor, static functions and methods, without bodies; Rust fields aren't read from Fish");
  expect(declared(`  export class A {\n    get(): i64 {\n      return 1;\n    }\n  }`)).toBe("rust.fsh:3:5: error: a Rust type's members are declared without bodies; the crate has them");
  expect(declared(`  @rust.other export class A {}`)).toBe(`rust.fsh:2:4: error: a Rust type takes only '@rust("path::to::Type")'`);
  expect(declared(`  @rust.local export class A {}`)).toBe("rust.fsh:2:4: error: Rust types that aren't Send aren't supported yet: Fish moves values between threads, so a Rust type must be Send");
  expect(declared(`  export class A {\n    @rust("a::b") get(): i64;\n  }`)).toBe(`rust.fsh:3:11: error: a member's Rust name is one name, as in "with_value"`);
  const lent = pkg({ "src/rust.fsh": `declare module "rust:demo" {\n  export class A {\n    static make(): A;\n    peek(): Ref<A>;\n  }\n}\n`, "src/main.fsh": `import { A } from "rust:demo";\nfunction main() {\n  A.make();\n}\n` });
  expect(refused(lent)).toBe("rust.fsh:4:13: error: the Rust function 'A.peek' can't give a 'Ref<A>': a borrow's lifetime can't cross from Rust yet; give the value itself");
  const text = pkg({ "src/rust.fsh": `declare module "rust:demo" {\n  export class A {\n    static make(): A;\n    named(s: string): i64;\n  }\n}\n`, "src/main.fsh": `import { A } from "rust:demo";\nfunction main() {\n  A.make();\n}\n` });
  expect(refused(text)).toBe("rust.fsh:4:11: error: a 'string' can't cross the Rust boundary yet; Rust functions take and give numbers, booleans and Rust types");
});

test("a Rust type lives in Fish: made, called, lent, moved, cloned and dropped once", () => {
  const dir = handles(`function scoped() {
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
  expect(fishc(dir, ["build"])).toEqual({ code: 0, out: "", err: "" });
  const run = built(dir);
  expect([run.exitCode, run.stdout.toString(), run.stderr.toString()]).toEqual([0, "1 102 1\n1001 1\n1020 2\n7\n3\n", ""]);
});

test("a Rust type that isn't Send is refused by the build, naming Send", () => {
  const dir = handles(`function main() {\n  console.log(new Pinned().same());\n}\n`, HANDLES.replace("  export function total", "  export class Pinned {\n    constructor();\n    same(): boolean;\n  }\n  export function total"));
  writeFileSync(join(dir, "src", "main.fsh"), `import { Pinned } from "rust:demo";\nfunction main() {\n  console.log(new Pinned().same());\n}\n`);
  const run = fishc(dir, ["build"]);
  expect(run.code).toBe(1);
  expect(run.err).toContain("cannot be sent between threads safely");
  expect(run.err).toContain("Send");
});
test("a panic in a Rust method is a Fish panic at the call", () => {
  const dir = handles(`function main() {\n  const c = new Counter(4);\n  console.log(c.get());\n  console.log(c.fail());\n}\n`);
  expect(fishc(dir, ["build"]).code).toBe(0);
  const run = built(dir);
  expect([run.exitCode, run.stdout.toString(), run.stderr.toString()]).toEqual([101, "4\n", "panicked at src/main.fsh:5:15:\ncounter at 4\n"]);
});

test("a panic in a Rust value's drop is a Fish panic", () => {
  const dir = pkg({
    "src/rust.fsh": `declare module "rust:demo" {\n  export class Grumpy {\n    constructor();\n  }\n}\n`,
    "src/main.fsh": `import { Grumpy } from "rust:demo";\n\nfunction main() {\n  const g = new Grumpy();\n  console.log("made");\n}\n`,
  });
  expect(fishc(dir, ["build"]).code).toBe(0);
  const run = built(dir);
  expect([run.exitCode, run.stdout.toString(), run.stderr.toString()]).toEqual([101, "made\n", "panicked while dropping a Rust 'Grumpy':\ngrumpy to the end\n"]);
});

test("a Rust handle is owned by a spawned task, and shared between tasks, and dropped once", () => {
  const dir = handles(`async function doubled(c: Counter): Promise<i64> {
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
  expect(fishc(dir, ["build"])).toEqual({ code: 0, out: "", err: "" });
  const run = built(dir);
  expect([run.exitCode, run.stdout.toString(), run.stderr.toString()]).toEqual([0, "42 1\n3 2\n", ""]);
});

test("a Rust handle made for an Own method moves into it, never copied", () => {
  const dir = handles(`function mk(): Counter {
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
  expect(fishc(dir, ["build"])).toEqual({ code: 0, out: "", err: "" });
  const run = built(dir);
  expect([run.exitCode, run.stdout.toString(), run.stderr.toString()]).toEqual([0, "40 50 0 30 4\n6 true 4\n", ""]);
});

test("a shared value gives its Rust values only inside update, so they need only be Send", () => {
  expect(refused(handles(`async function main() {\n  const s = shared<{ c: Counter }>({ c: new Counter(1) });\n  console.log(s.c.get());\n}\n`)))
    .toBe("src/main.fsh:4:15: error: 'c' holds a Rust 'Counter', which a shared value gives only inside 'update', as in 's.update((v) => v.c...)'");
  expect(refused(handles(`async function main() {\n  const s = shared<{ c: Counter }>({ c: new Counter(1) });\n  const c = s.c;\n}\n`)))
    .toBe("src/main.fsh:4:13: error: 'c' holds a Rust 'Counter', which a shared value gives only inside 'update', as in 's.update((v) => v.c...)'");
  const dir = handles(`async function work(s: shared<{ r: Racy }>): Promise<i64> {
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
  expect(fishc(dir, ["build"])).toEqual({ code: 0, out: "", err: "" });
  expect(built(dir).stdout.toString()).toBe("400\n");
});

test("no class extends a Rust type", () => {
  expect(refused(handles(`class Mine extends Counter {\n  constructor() {\n    super(1);\n  }\n}\nfunction main() {}\n`))).toBe("src/main.fsh:2:20: error: a class can't extend the Rust type 'Counter'; hold one in a field instead");
  expect(refused(handles(`class Mine extends Bare {}\nfunction main() {}\n`))).toBe("src/main.fsh:2:20: error: a class can't extend the Rust type 'Bare'; hold one in a field instead");
});

test("a static and a method naming one Rust function are refused, and so is a Dyn of a Rust type", () => {
  const twice = pkg({ "src/rust.fsh": `declare module "rust:demo" {\n  export class Counter {\n    constructor(start: i64);\n    @rust("zero") again(): Counter;\n    static zero(): Counter;\n  }\n}\n`, "src/main.fsh": `import { Counter } from "rust:demo";\nfunction main() {}\n` });
  expect(refused(twice)).toBe("rust.fsh:5:5: error: 'demo::Counter::zero' is declared elsewhere as (&self): Counter; declare it with the same types");
  expect(refused(handles(`interface Getter {\n  get(): i64;\n}\nfunction main() {\n  const d: Dyn<Getter> = new Counter(4);\n}\n`)))
    .toBe("src/main.fsh:6:26: error: a Rust 'Counter' can't become a 'Dyn<Getter>' yet; call its methods on it, or take it as a generic parameter");
});

test("a Rust value moves through shorthand properties, '??' and destructuring defaults", () => {
  const dir = handles(`function mk(c: Counter): { c: Counter } {
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
  expect(fishc(dir, ["build"])).toEqual({ code: 0, out: "", err: "" });
  const run = built(dir);
  expect([run.exitCode, run.stdout.toString(), run.stderr.toString()]).toEqual([0, "4 1\n2\n3 2 0 6 2\n6\n8 90 10 8\n9\n", ""]);
  expect(refused(handles(`function main() {\n  const a: Counter | null = new Counter(1);\n  const b = a ?? new Counter(2);\n  const c = a ?? new Counter(3);\n}\n`))).toContain("'a' was moved");
});

test("a future holding a Rust value is boxed by moving it: stored as a Promise, through a function value, and as a handler", () => {
  const dir = handles(`async function hold(): Promise<i64> {
  const c = new Counter(5);
  await yieldNow();
  return c.get();
}

async function counted(req: Request): Promise<Response> {
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
  app.get("/m", async (req) => {
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
  expect(fishc(dir, ["build"])).toEqual({ code: 0, out: "", err: "" });
  const run = built(dir);
  expect([run.exitCode, run.stdout.toString(), run.stderr.toString()]).toEqual([0, "5 5 2\ncount 7 m 3 4\n", ""]);
});
