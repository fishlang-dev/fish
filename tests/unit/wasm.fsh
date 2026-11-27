// WebAssembly builds: the targets' flags and refusals, programs built for wasm32-wasip1 run under
// wasmtime, and the browser loader serving every WASI call a built module imports. The runs need
// Homebrew's wasi-libc and wasi-runtimes (or FISH_SYSROOT) and wasmtime on PATH, and are skipped
// without them.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveTarget, threading, type Target } from "../../src/target.fsh";
import { browserFiles, loader, WASI_CALLS } from "../../src/wasi.fsh";
import { fishc, removed, same, scratch, text } from "./support.fsh";

function has(_tool: string): string | null {
  return "/usr/bin/tool";
}

function none(_tool: string): string | null {
  return null;
}

function thrown(run: () => Target throws Error): string {
  try {
    const _t = run();
    return "";
  } catch (e) {
    return e.message;
  }
}

test("wasm32-wasip1 compiles over the sysroot and links wasi-libc's emulations and the builtins", () => {
  const t = resolveTarget("wasm32-wasip1", "/w/sysroot", undefined, has, (_p) => true);
  same(t.triple, "wasm32-wasip1", "triple");
  same(t.compile.slice(0, 4).join(" "), "-target wasm32-wasip1 --sysroot /w/sysroot", "compile");
  assert(t.compile.includes("-D_WASI_EMULATED_SIGNAL"), "emulated signals");
  assert(t.link.includes("-lwasi-emulated-mman"), "emulated mmap");
  same(t.link[t.link.length - 2]!, "/w/sysroot/lib/wasm32-wasip1/libclang_rt.builtins-wasm32.a", "builtins");
  same(threading(t).join(" "), "", "no threads");
  same(resolveTarget("browser", "/w/sysroot", undefined, has, (_p) => true).compile[1]!, "wasm32-wasip1", "browser is the same module");
});

test("wasm32-wasip1 says what to install when its parts are missing", () => {
  assert(thrown(() => resolveTarget("wasm32-wasip1", undefined, undefined, has, (_p) => false)).includes("brew install wasi-libc wasi-runtimes"), "no sysroot");
  assert(thrown(() => resolveTarget("wasm32-wasip1", "/w", undefined, none, (_p) => true)).includes("links with wasm-ld"), "no wasm-ld");
  assert(thrown(() => resolveTarget("wasm32-wasip1", "/w", undefined, has, (p) => !p.endsWith(".a"))).includes("compiler-rt's builtins"), "no builtins");
});

test("a browser build names its module and loader alike", () => {
  const files = browserFiles("dist/app.js");
  same(files.module, "dist/app.wasm", "module");
  same(files.loader, "dist/app.js", "loader");
  same(browserFiles("app").loader, "app.js", "no extension");
  assert(loader("app.wasm").includes('const MODULE = "app.wasm";'), "the loader names its module");
});

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function refused(dir: string, flag: string, said: string): void {
  const run = fishc(dir, ["build", "main.fsh", "--target", "wasm32-wasip1", flag]);
  assert(run.code !== 0 && run.err.includes(said), `${flag}: ${run.err}`);
}

test("a wasm build refuses what a module can't be", () => {
  const dir = scratch("fish-wasm-refuse-");
  write(join(dir, "main.fsh"), "function main() {}\n");
  refused(dir, "--lib", "not a library");
  refused(dir, "--static", "leave out '--static'");
  refused(dir, "--panic=unwind", "can't unwind");
  refused(dir, "--profile", "leave out '--profile'");
  removed(dir);
});

// Whether a wasm32-wasip1 build and wasmtime are both here.
function ready(): boolean {
  if (Bun.which("wasmtime") === null) return false;
  return thrown(() => resolveTarget("wasm32-wasip1", process.env.FISH_SYSROOT)) === "";
}

const PROGRAM = `import { readFileSync } from "node:fs";
async function work(n: i64): Promise<i64> {
  await sleep(20);
  return n * 2;
}
async function main() {
  const words = ["wasm", "runs", "fish"];
  let counts = new Map<string, i64>();
  for (const w of words) counts.set(w, w.length);
  const started = Date.now();
  const a = spawn(work(20));
  const b = spawn(work(1));
  console.log(words.join(" "), counts.get("fish") ?? 0, await a, await b, Math.sqrt(2.0));
  console.log(Date.now() - started >= 20, readFileSync("data.txt", "utf8").trim());
  const xs: i64[] = [];
  console.log(xs[words.length]);
}
`;

// An unsigned LEB128 at `at[0]`, moving past it.
function leb(bytes: Ref<u8[]>, at: Mut<usize[]>): usize {
  let n: usize = 0;
  let shift: usize = 0;
  while (true) {
    const b = bytes[at[0]!]!;
    at[0] = at[0]! + 1;
    n = n | (((b & 0x7f) as usize) << shift);
    if ((b & 0x80) === 0) return n;
    shift += 7;
  }
  return n;
}

function name(bytes: Ref<u8[]>, at: Mut<usize[]>): string {
  const length = leb(bytes, at);
  const start = at[0]!;
  at[0] = start + length;
  return new TextDecoder().decode(bytes.slice(start as i64, (start + length) as i64));
}

// A module's imports as `module.field`, read from its import section.
function importsOf(bytes: Ref<u8[]>): string[] {
  let out: string[] = [];
  let at: usize[] = [8];
  while (at[0]! < bytes.length) {
    const id = bytes[at[0]!]!;
    at[0] = at[0]! + 1;
    const size = leb(bytes, at);
    const end = at[0]! + size;
    if (id === 2) {
      const count = leb(bytes, at);
      for (let i: usize = 0; i < count; i++) {
        const module = name(bytes, at);
        const field = name(bytes, at);
        const kind = bytes[at[0]!]!;
        at[0] = at[0]! + 1;
        out.push(`${module}.${field}`);
        if (kind === 0) leb(bytes, at);
        else if (kind === 1) {
          at[0] = at[0]! + 1;
          if ((bytes[at[0]!]! & 1) === 1) {
            at[0] = at[0]! + 1;
            leb(bytes, at);
            leb(bytes, at);
          } else {
            at[0] = at[0]! + 1;
            leb(bytes, at);
          }
        } else if (kind === 2) {
          const flags = bytes[at[0]!]!;
          at[0] = at[0]! + 1;
          leb(bytes, at);
          if ((flags & 1) === 1) leb(bytes, at);
        } else at[0] = at[0]! + 2;
      }
      return out;
    }
    at[0] = end;
  }
  return out;
}

test("a program built for wasm32-wasip1 runs under wasmtime", () => {
  if (!ready()) {
    console.log("skipped: running a wasm32-wasip1 build needs wasi-libc, wasi-runtimes and wasmtime");
    return;
  }
  const dir = scratch("fish-wasm-");
  write(join(dir, "main.fsh"), PROGRAM);
  write(join(dir, "data.txt"), "read through WASI\n");
  const built = fishc(dir, ["build", "main.fsh", "--target", "wasm32-wasip1"]);
  same(built.err, "", "the build's stderr");
  assert(existsSync(join(dir, "main.wasm")), "main.wasm was written");
  const run = spawnSync("wasmtime", ["run", "--dir", ".", "main.wasm"], { cwd: dir });
  same(text(run.stdout), "wasm runs fish 4 40 2 1.4142135623730951\ntrue read through WASI\n", "the program's output");
  assert(text(run.stderr).includes("index out of bounds"), `stderr: ${text(run.stderr)}`);
  assert(run.status === 101, `exit code ${run.status ?? -1}`);
  removed(dir);
});

test("the browser loader serves every WASI call a built module imports", () => {
  if (!ready()) {
    console.log("skipped: a browser build needs wasi-libc and wasi-runtimes");
    return;
  }
  const dir = scratch("fish-browser-");
  write(join(dir, "main.fsh"), PROGRAM);
  const built = fishc(dir, ["build", "main.fsh", "--target", "browser"]);
  same(built.err, "", "the build's stderr");
  let bytes: u8[] = [];
  let script = "";
  try {
    bytes = readFileSync(join(dir, "main.wasm"));
    script = readFileSync(join(dir, "main.js"), "utf8");
  } catch (e) {
    assert(false, `the browser build's files: ${e.message}`);
  }
  const imports = importsOf(bytes);
  for (const call of ["wasi_snapshot_preview1.fd_write", "wasi_snapshot_preview1.proc_exit", "wasi_snapshot_preview1.clock_time_get"]) assert(imports.includes(call), `the module imports ${call}: ${imports.join(", ")}`);
  for (const name of imports) {
    assert(name.startsWith("wasi_snapshot_preview1."), `an import from outside WASI: ${name}`);
    const call = name.slice(23);
    assert(WASI_CALLS.includes(call) && script.includes(`"${call}"`), `the loader serves ${call}`);
  }
  assert(script.includes("export async function run("), "the loader exports run");
  removed(dir);
});
