import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { BuildInfo } from "./compilation.fsh";
import { cacheDir } from "./mathlib.fsh";

// Build targets: the four v1 platforms and Linux over musl for static binaries, named by their
// Rust triples, and the clang flags that build for one from the host fishc runs on.

export const TARGETS = ["aarch64-apple-darwin", "x86_64-apple-darwin", "aarch64-unknown-linux-gnu", "x86_64-unknown-linux-gnu", "aarch64-unknown-linux-musl", "x86_64-unknown-linux-musl", "wasm32-wasip1", "browser", "x86_64-w64-windows-gnu", "aarch64-w64-windows-gnu", "lambda", "lambda-arm64", "edge", "js"];

// A WebAssembly module over WASI preview 1, the same module with a JavaScript loader giving it
// those calls in a page, and one answering a request a Workers-style fetch hands it.
export const isWasm = (triple: string) => triple === "wasm32-wasip1" || triple === "browser" || triple === "edge";

// An AWS Lambda function's bootstrap: a static Linux executable over musl, zipped.
export const isLambda = (triple: string) => triple === "lambda" || triple === "lambda-arm64";
const lambdaCpu = (triple: string) => (triple === "lambda-arm64" ? "aarch64" : "x86_64");

// Windows over the MinGW ABI, with UCRT as its C library.
export const isWindows = (triple: string) => triple.endsWith("-w64-windows-gnu");

// `compile` goes to every clang compile, and `compile` then `link` to the final link. The host's
// own target has both empty, so its builds and cache keys are what they were before targets.
// `ar` archives a static library: the host's own can't index another OS's objects. `sanitize`
// names the sanitizer a build is instrumented with, if any. `cc` is the clang a target is built
// with, when it isn't the one on PATH.
export type Target = { triple: string; compile: string[]; link: string[]; ar: string; sanitize?: string; cc?: string };

export const HOST_TARGET: Target = { triple: "", compile: [], link: [], ar: "ar" };

// The host as a target, made fresh for a caller to own.
export function hostTarget(): Target {
  return { triple: "", compile: [], link: [], ar: "ar" };
}

// A copy of `target` for a caller to own.
export function copyTarget(target: Ref<Target>): Target {
  return { triple: target.triple, compile: [...target.compile], link: [...target.link], ar: target.ar, sanitize: target.sanitize, cc: target.cc };
}

const osOf = (triple: string) => (triple.includes("-apple-") ? "macOS" : "Linux");
const musl = (triple: string) => triple.endsWith("-musl");

// The triple of the machine running fishc, if it is one of the targets.
// Whether the running process has musl as its libc. The process is asked rather than the disk: a
// glibc system can have musl's loader installed beside its own. A process on glibc has libc.so.6
// among its mappings, and one on musl doesn't; off Linux there are none to read.
export function runsOnMusl(maps: string = ownMappings()): boolean {
  return maps !== "" && !maps.includes("/libc.so.6");
}

function ownMappings(): string {
  try {
    return readFileSync("/proc/self/maps", "utf8");
  } catch (_e) {
    return "";
  }
}

export function hostTriple(platform: string = process.platform, arch: string = process.arch, onMusl?: boolean): string | undefined {
  const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : undefined;
  if (cpu === undefined) return undefined;
  if (platform === "darwin") return `${cpu}-apple-darwin`;
  if (platform === "linux") return `${cpu}-unknown-linux-${onMusl ?? runsOnMusl() ? "musl" : "gnu"}`;
  return undefined;
}

// The target `triple` names, built from `host` with `sysroot` when given. A target on another OS
// needs that OS's libraries from a sysroot and lld to link them, as does any other target on a
// Linux host, whose system linker knows one architecture; Apple's linker knows both of its own.
// Linux over the other libc, musl or glibc, needs that libc's sysroot too.
// Throws an Error whose message is the user-facing reason. `host` is the machine's own when left out.
/** @throws {Error} */
export function resolveTarget(triple: string | undefined, sysroot: string | undefined, given?: string, which?: (tool: string) => string | null, found?: (path: string) => boolean): Target {
  if (triple !== undefined && isWasm(triple)) return wasmTarget(triple, sysroot, which, found);
  if (triple !== undefined && isWindows(triple)) return windowsTarget(triple, sysroot, found);
  if (triple !== undefined && isLambda(triple)) return { ...staticTarget(resolveTarget(`${lambdaCpu(triple)}-unknown-linux-musl`, sysroot, given, which)), triple };
  const host = given ?? hostTriple();
  // Cached objects compile in an empty directory of their own, where a relative path means nothing.
  sysroot = sysroot !== undefined && sysroot !== "" ? resolve(sysroot) : undefined;
  if (triple === undefined || triple === host) return sysroot !== undefined ? { ...HOST_TARGET, triple: host ?? "", compile: ["--sysroot", sysroot] } : HOST_TARGET;
  if (!TARGETS.includes(triple)) throw new Error(`fishc build: unknown target '${triple}'; use one of ${TARGETS.join(", ")}`);
  const os = osOf(triple);
  const foreign = host === undefined || osOf(host) !== os;
  if ((foreign || musl(triple) !== musl(host!)) && sysroot === undefined) {
    const what = musl(triple)
      ? "a musl sysroot, a directory holding the target's /usr/include and /usr/lib with musl and libgcc, such as the root of an Alpine Linux system with musl-dev and gcc installed"
      : os === "Linux"
        ? "a Linux sysroot, a directory holding the target's /usr/include and /usr/lib with glibc and libgcc"
        : "a macOS SDK, such as the MacOSX.sdk directory from Xcode's command-line tools";
    throw new Error(`fishc build: building for ${triple} from ${host !== undefined ? osOf(host) : "this machine"} needs ${what}; give it with --sysroot <dir> or FISH_SYSROOT`);
  }
  const lld = foreign || osOf(host!) === "Linux";
  const linker = os === "Linux" ? "ld.lld" : "ld64.lld";
  if (lld && (which === undefined ? Bun.which(linker) : which(linker)) === null) {
    const install = host !== undefined && osOf(host) === "macOS" ? "'brew install lld'" : "your package manager's lld package, such as 'apt install lld'";
    throw new Error(`fishc build: building for ${triple} links with lld, and '${linker}' isn't on PATH; install it with ${install}`);
  }
  // The IR names no triple, which clang warns of when given one. A darwin triple names no macOS
  // version, which clang off a Mac reads as one too old for thread-locals; the oldest each
  // architecture's Rust target supports is used, as Rust does.
  const macos: string[] = os === "macOS" ? [`-mmacosx-version-min=${triple.startsWith("x86_64") ? "10.12" : "11.0"}`] : [];
  const roots: string[] = sysroot !== undefined ? ["--sysroot", sysroot] : [];
  const link: string[] = lld ? ["-fuse-ld=lld"] : [];
  return { triple, compile: ["-target", triple, "-Wno-override-module", ...macos, ...roots], link, ar: foreign ? "llvm-ar" : "ar" };
}

// Where Homebrew's wasi-libc and wasi-runtimes put the sysroot and compiler-rt's builtins.
const WASI_SYSROOTS = ["/opt/homebrew/opt/wasi-libc/share/wasi-sysroot", "/usr/local/opt/wasi-libc/share/wasi-sysroot"];
const WASI_BUILTINS = ["/opt/homebrew/opt/wasi-runtimes/share/wasi-runtimes/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a", "/usr/local/opt/wasi-runtimes/share/wasi-runtimes/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a"];

// wasm32-wasip1 over wasi-libc. WASI has no signals, process clocks or mmap of its own, which
// wasi-libc emulates in libraries of their own. The module exports `_start`, linked by wasm-ld with
// compiler-rt's builtins for the 128-bit and float arithmetic LLVM calls out to; clang's own
// resource directory has none for wasm32, so the archive is named on the link. Its stack is 8 MiB,
// as a native thread's is, since deep recursion is ordinary Fish.
/** @throws {Error} */
function wasmTarget(triple: string, sysroot: string | undefined, which?: (tool: string) => string | null, found?: (path: string) => boolean): Target {
  const exists = (path: string): boolean => (found === undefined ? existsSync(path) : found(path));
  const root = sysroot !== undefined && sysroot !== "" ? resolve(sysroot) : WASI_SYSROOTS.find((d) => exists(d));
  if (root === undefined) throw new Error(`fishc build: building for ${triple} needs a WASI sysroot, wasi-libc's headers and libraries; install it with 'brew install wasi-libc wasi-runtimes', or give one with --sysroot <dir> or FISH_SYSROOT`);
  if ((which === undefined ? Bun.which("wasm-ld") : which("wasm-ld")) === null) throw new Error(`fishc build: building for ${triple} links with wasm-ld, which isn't on PATH; install it with 'brew install lld', or your package manager's lld package`);
  const builtins = [join(root, "lib", "wasm32-wasip1", "libclang_rt.builtins-wasm32.a"), ...WASI_BUILTINS].find((f) => exists(f));
  if (builtins === undefined) throw new Error(`fishc build: building for ${triple} links compiler-rt's builtins for wasm32, which weren't found; install them with 'brew install wasi-runtimes'`);
  const emulated = ["-D_WASI_EMULATED_SIGNAL", "-D_WASI_EMULATED_PROCESS_CLOCKS", "-D_WASI_EMULATED_GETPID", "-D_WASI_EMULATED_MMAN"];
  const libraries = ["-lwasi-emulated-signal", "-lwasi-emulated-process-clocks", "-lwasi-emulated-getpid", "-lwasi-emulated-mman"];
  return { triple, compile: ["-target", "wasm32-wasip1", "--sysroot", root, "-Wno-override-module", ...emulated], link: ["-nodefaultlibs", "-lc", ...libraries, builtins, "-Wl,-z,stack-size=8388608"], ar: "llvm-ar" };
}

// Windows through llvm-mingw, a toolchain holding a clang, lld, compiler-rt, libunwind and the
// MinGW-w64 headers and libraries for each CPU, named by --sysroot or FISH_SYSROOT. Its clang reads
// the configuration beside it for a MinGW triple, which links with lld, compiler-rt and libunwind,
// so it builds rather than the clang on PATH. Linked statically, an executable needs no DLL beyond
// the system's own: winpthreads and libunwind are inside it. Winsock, ntdll's AFD calls the reactor
// polls sockets with, and the system's random source are Windows libraries.
/** @throws {Error} */
function windowsTarget(triple: string, sysroot: string | undefined, found?: (path: string) => boolean): Target {
  const exists = (path: string): boolean => (found === undefined ? existsSync(path) : found(path));
  const cpu = triple.split("-")[0]!;
  const mingw = `${cpu}-w64-mingw32`;
  const get = `download llvm-mingw's ucrt release for this machine from https://github.com/mstorsjo/llvm-mingw/releases, unpack it, and give its directory with --sysroot <dir> or FISH_SYSROOT`;
  if (sysroot === undefined || sysroot === "") throw new Error(`fishc build: building for ${triple} needs llvm-mingw; ${get}`);
  const root = resolve(sysroot);
  const cc = join(root, "bin", "clang");
  if (!exists(cc) || !exists(join(root, mingw))) throw new Error(`fishc build: ${root} isn't an llvm-mingw toolchain for ${triple}: it needs bin/clang and ${mingw}; ${get}`);
  return { triple, compile: ["-target", triple, "-Wno-override-module", "-D_WIN32_WINNT=0x0A00"], link: ["-static", "-lws2_32", "-lntdll", "-lbcrypt"], ar: join(root, "bin", "llvm-ar"), cc };
}

// Windows unwinds through SEH, whose tables name a personality of their own: the C personality's
// SEH form, which libunwind gives as GCC does.
export function forTarget(ir: string, target: Ref<Target>): string {
  return isWindows(target.triple) ? ir.replaceAll("@__gcc_personality_v0", "@__gcc_personality_seh0") : ir;
}

// The flags that give a build threads: none for wasm32-wasip1, whose runtime runs on one.
export function threading(target: Ref<Target>): string[] {
  return isWasm(target.triple) ? [] : ["-pthread"];
}

// `target` linked into one binary with no libc or loader to find at run time. Only musl is: glibc
// can't look up names or users from a static binary.
/** @throws {Error} */
export function staticTarget(target: Target, given?: string): Target {
  const triple = target.triple !== "" ? target.triple : given ?? hostTriple();
  if (triple === undefined || !musl(triple)) {
    const cpu = triple === undefined ? "x86_64" : triple.split("-")[0]!;
    throw new Error(`fishc build: --static links musl into the binary, so it builds only for a musl target; pass --target ${cpu}-unknown-linux-musl with a musl sysroot in --sysroot or FISH_SYSROOT`);
  }
  return { ...target, link: [...target.link, "-static"] };
}

// A container image holding only the static binary at `binary`, built from the directory it's in.
// COPY reads `$` as a variable, `*`, `?` and `[` as a pattern, and removes quotes and backslashes,
// even in its JSON form.
/** @throws {Error} */
export function dockerfile(binary: string): string {
  const name = basename(binary);
  if (/[$*?[\\"']/.test(name)) throw new Error(`fishc build: a Dockerfile reads $, *, ?, [, quotes and \\ in '${name}' specially, so '--dockerfile' can't copy it; choose another name with -o`);
  return `FROM scratch\nCOPY ${JSON.stringify([name, `/${name}`])}\nENTRYPOINT ${JSON.stringify([`/${name}`])}\n`;
}

// Where `--dockerfile` writes for `binary`, beside it. A Dockerfile already there is replaced only
// when it is the one this would write, so a rebuild works and the user's own is kept.
/** @throws {Error | IoError} */
export function dockerfilePath(binary: string): string {
  const text = dockerfile(binary);
  const at = join(dirname(binary), "Dockerfile");
  // Compared without case, as macOS's file system names files.
  if (basename(binary).toLowerCase() === "dockerfile") throw new Error(`fishc build: '--dockerfile' writes ${at}, which is the binary's own name; choose another name with -o`);
  if (existsSync(at) && readFileSync(at, "utf8") !== text) throw new Error(`fishc build: '--dockerfile' would replace ${at}, which holds something else; move it, or build into another directory with -o`);
  return at;
}

export const SANITIZERS = ["address", "thread"];

// The directory where clang keeps its runtime libraries for `triple`, sanitizers' among them.
/** @throws {Error | IoError} */
type RuntimeDir = (triple: string) => string;

/** @throws {Error | IoError} */
function clangRuntimeDir(triple: string): string {
  const done = Bun.spawnSync(["clang", `--target=${triple}`, "-print-runtime-dir"]);
  if (done.exitCode !== 0) throw new Error(`clang failed:\n${new TextDecoder().decode(done.stderr)}`);
  return new TextDecoder().decode(done.stdout).trim();
}

// Whether clang finds the library `name` among its own for `triple`. A system may keep a runtime
// beside the directory `-print-runtime-dir` names and still link it from there, as Ubuntu 26.04
// does; asked for a file, clang gives its path when it has it and the bare name back when not.
function clangFinds(triple: string, name: string, cc = "clang"): boolean {
  try {
    const done = Bun.spawnSync([cc, `--target=${triple}`, `-print-file-name=${name}`]);
    if (done.exitCode !== 0) return false;
    const path = new TextDecoder().decode(done.stdout).trim();
    return path !== name && existsSync(path);
  } catch (_e) {
    return false;
  }
}

function clangHasRuntime(cc: string, triple: string, names: Ref<string[]>): boolean {
  try {
    const rt = Bun.spawnSync([cc, `--target=${triple}`, "-print-runtime-dir"]);
    if (rt.exitCode === 0) {
      const dir = new TextDecoder().decode(rt.stdout).trim();
      if (dir !== "" && names.some((n) => existsSync(join(dir, n)))) return true;
    }
  } catch (_e) {
    return false;
  }
  return names.some((n) => clangFinds(triple, n, cc));
}

// Finds a clang binary that ships libFuzzer (and ASan when requested). Apple's system clang omits
// libFuzzer, so Homebrew LLVM is probed after FISH_CLANG and PATH's clang.
/** @throws {Error | IoError} */
export function findFuzzerClang(asan = true, given?: string): string {
  const triple = given ?? hostTriple();
  if (triple === undefined || musl(triple)) {
    throw new Error(`fishc fuzz: libFuzzer isn't available for ${triple ?? "this machine"}`);
  }
  const cpu = triple.split("-")[0]!;
  const darwin = triple.includes("-apple-");
  const fuzzerNames = darwin ? ["libclang_rt.fuzzer_osx.a"] : ["libclang_rt.fuzzer.a", `libclang_rt.fuzzer-${cpu}.a`];
  const asanNames = darwin ? ["libclang_rt.asan_osx_dynamic.dylib"] : ["libclang_rt.asan.a", `libclang_rt.asan-${cpu}.a`];
  let candidates: string[] = [];
  const envCc = process.env.FISH_CLANG;
  if (envCc !== undefined && envCc !== "") {
    candidates.push(envCc.includes("/") ? resolve(envCc) : envCc);
  }
  for (const cc of ["clang", "/opt/homebrew/opt/llvm/bin/clang", "/usr/local/opt/llvm/bin/clang"]) {
    if (!candidates.includes(cc)) candidates.push(cc);
  }
  let sawFuzzer = false;
  for (const cc of candidates) {
    let available = false;
    if (cc.includes("/")) {
      try {
        available = existsSync(cc) && statSync(cc).isFile();
      } catch (_e) {
        available = false;
      }
    } else {
      available = Bun.which(cc) !== null;
    }
    if (!available) continue;
    if (!clangHasRuntime(cc, triple, fuzzerNames)) continue;
    sawFuzzer = true;
    if (!asan || clangHasRuntime(cc, triple, asanNames)) return cc;
  }
  if (sawFuzzer && asan) {
    throw new Error("fishc fuzz: found libFuzzer clang without an AddressSanitizer runtime; pass --no-asan to fuzz without AddressSanitizer");
  }
  const hint = darwin ? "install LLVM with 'brew install llvm' or set FISH_CLANG" : "install clang with libFuzzer (e.g. 'apt install clang') or set FISH_CLANG";
  throw new Error(`fishc fuzz: no clang with libFuzzer was found; ${hint}`);
}

// Target flags for coverage-guided fuzzing with libFuzzer (and ASan unless disabled).
export function fuzzerTarget(asan = true): Target {
  const compile = asan ? ["-fsanitize=fuzzer-no-link,address", "-fno-omit-frame-pointer"] : ["-fsanitize=fuzzer-no-link", "-fno-omit-frame-pointer"];
  const link = asan ? ["-fsanitize=fuzzer,address"] : ["-fsanitize=fuzzer"];
  if (asan) return { triple: "", compile, link, ar: "ar", sanitize: "address" };
  return { triple: "", compile, link, ar: "ar" };
}

// `target` with every compile instrumented by clang's `kind` sanitizer and its runtime linked, so
// the C runtime and std are checked as well as the program. Frame pointers are kept so reports show
// whole stacks. Clang ships the runtimes per target, and none for musl, so a target it has none for
// is refused. Throws an Error whose message is the user-facing reason.
/** @throws {Error | IoError} */
export function sanitizedTarget(target: Target, kinds: string[], given?: string, runtimeDir?: RuntimeDir): Target {
  const unknown = kinds.find((k) => !SANITIZERS.includes(k));
  if (unknown !== undefined) throw new Error(`fishc build: unknown sanitizer '${unknown}'; use one of ${SANITIZERS.join(", ")}`);
  if (kinds.length > 1) throw new Error("fishc build: --sanitize takes one sanitizer at a time; address and thread can't instrument the same build");
  const kind = kinds[0]!;
  const triple = target.triple !== "" ? target.triple : given ?? hostTriple();
  if (target.link.includes("-static")) throw new Error(`fishc build: --sanitize=${kind} links clang's sanitizer runtime, which a --static build can't; leave out one of them`);
  const cpu = triple === undefined ? undefined : triple.split("-")[0];
  const lib = kind === "address" ? "asan" : "tsan";
  const names = triple !== undefined && triple.includes("-apple-") ? [`libclang_rt.${lib}_osx_dynamic.dylib`] : [`libclang_rt.${lib}.a`, `libclang_rt.${lib}-${cpu ?? ""}.a`];
  let found = false;
  if (triple !== undefined && !musl(triple)) {
    const dir = runtimeDir === undefined ? clangRuntimeDir(triple) : runtimeDir(triple);
    found = names.some((n) => existsSync(join(dir, n))) || (runtimeDir === undefined && names.some((n) => clangFinds(triple, n)));
  }
  if (!found) throw new Error(`fishc build: clang has no ${kind} sanitizer runtime for ${triple ?? "this machine"}; build for a target it has one for, such as the host's own`);
  const flags = [`-fsanitize=${kind}`, "-fno-omit-frame-pointer"];
  return { ...target, compile: [...target.compile, ...flags], sanitize: kind };
}

// Clang's front end marks each function a sanitizer should instrument, and Fish's IR carries no
// such marks, so each definition in `ir` is given one for `target`'s sanitizer. Each is kept out of
// line too: a function inlined into one with no debug info, such as a task's poll, loses its
// lines, and a report would name no .fsh line for it.
export function instrumented(ir: string, target: Ref<Target>): string {
  if (target.sanitize === undefined) return ir;
  const attribute = `${target.sanitize === "address" ? "sanitize_address" : "sanitize_thread"} noinline`;
  return ir.replace(/^(define [^\n]*\))( uwtable| \{$)/gm, `$1 ${attribute}$2`);
}

// Where OpenSSL, or libbrotlienc, is for a target: the flags to compile and link its runtime
// with, or why it isn't there.
export type OpenSsl = { compile: string[]; link: string[] } | { missing: string };

const LIBS = ["-lssl", "-lcrypto"];
const INSTALL = "install it (brew install openssl@3 on macOS, apt install libssl-dev on Debian and Ubuntu, apk add openssl-dev on Alpine) and build the program again";

// OpenSSL for `target`: on this machine through pkg-config, else Homebrew's openssl@3, else the
// system's headers; for another target or a sysroot, only in the sysroot, never this machine's.
// What pkg-config says a package is compiled and linked with, if it is there and knows.
function pkgConfigFlags(name: string): string[] | undefined {
  if (Bun.which("pkg-config") === null) return undefined;
  try {
    const asked = Bun.spawnSync(["pkg-config", "--cflags", "--libs", name]);
    if (asked.exitCode !== 0) return undefined;
    return new TextDecoder().decode(asked.stdout).trim().split(/\s+/).filter((f) => f !== "");
  } catch (_e) {
    return undefined;
  }
}

export function findOpenSsl(target: Ref<Target>): OpenSsl {
  const at = target.compile.indexOf("--sysroot");
  const sysroot = at >= 0 ? target.compile[(at + 1) as usize] : undefined;
  if (sysroot !== undefined || target.compile.includes("-target")) {
    if (sysroot !== undefined && existsSync(join(sysroot, "usr", "include", "openssl", "ssl.h"))) return { compile: [], link: [...LIBS] };
    const local = sysroot === undefined ? undefined : join(sysroot, "usr", "local");
    if (local !== undefined && existsSync(join(local, "include", "openssl", "ssl.h"))) return { compile: ["-I", join(local, "include")], link: ["-L", join(local, "lib"), ...LIBS] };
    const where = sysroot === undefined ? "no sysroot was given" : `the sysroot ${sysroot} has no OpenSSL headers`;
    return { missing: `TLS needs OpenSSL built for ${target.triple}, and ${where}; install OpenSSL's headers and libraries into a sysroot for that target and build the program again` };
  }
  const flags = pkgConfigFlags("openssl");
  if (flags !== undefined) return { compile: flags.filter((f) => f.startsWith("-I")), link: flags.filter((f) => !f.startsWith("-I")) };
  for (const dir of ["/opt/homebrew/opt/openssl@3", "/usr/local/opt/openssl@3"]) {
    if (existsSync(join(dir, "include", "openssl", "ssl.h"))) return { compile: ["-I", join(dir, "include")], link: ["-L", join(dir, "lib"), ...LIBS] };
  }
  if (existsSync("/usr/include/openssl/ssl.h")) return { compile: [], link: [...LIBS] };
  return { missing: `TLS needs OpenSSL, which wasn't found when this program was built; ${INSTALL}` };
}

const BROTLI = ["-lbrotlienc", "-lbrotlicommon"];

// libbrotlienc for `target`, which std:compress's brotli runtime is compiled and linked with:
// found as OpenSSL is, through pkg-config, Homebrew's prefix or the system's headers, and only in
// the sysroot for another target; or why it isn't there.
export function findBrotli(target: Ref<Target>): OpenSsl {
  const at = target.compile.indexOf("--sysroot");
  const sysroot = at >= 0 ? target.compile[(at + 1) as usize] : undefined;
  if (sysroot !== undefined || target.compile.includes("-target")) {
    if (sysroot !== undefined && existsSync(join(sysroot, "usr", "include", "brotli", "encode.h"))) return { compile: [], link: [...BROTLI] };
    const where = sysroot === undefined ? "no sysroot was given" : `the sysroot ${sysroot} has no brotli headers`;
    return { missing: `fishc build: std:compress needs libbrotlienc built for ${target.triple}, and ${where}; install brotli's headers and libraries into a sysroot for that target and build the program again` };
  }
  const flags = pkgConfigFlags("libbrotlienc");
  if (flags !== undefined) return { compile: flags.filter((f) => f.startsWith("-I")), link: flags.filter((f) => !f.startsWith("-I")) };
  for (const dir of ["/opt/homebrew/opt/brotli", "/usr/local/opt/brotli"]) {
    if (existsSync(join(dir, "include", "brotli", "encode.h"))) return { compile: ["-I", join(dir, "include")], link: ["-L", join(dir, "lib"), ...BROTLI] };
  }
  if (existsSync("/usr/include/brotli/encode.h")) return { compile: [], link: [...BROTLI] };
  return { missing: "fishc build: std:compress needs libbrotlienc, which wasn't found; install brotli (brew install brotli on macOS, apt install libbrotli-dev on Debian and Ubuntu, apk add brotli-dev on Alpine) and build the program again" };
}

// The flags of a build instrumented for profile-guided optimization: running it writes
// default.profraw in its working directory. Fish hands clang IR, so the instrumentation is
// LLVM's IR-level kind; clang's front-end kind would find no source to count.
export const PGO_INSTRUMENT = ["-fprofile-generate", "-Xclang", "-fprofile-instrument-path=default.profraw"];

// `target` with `flags` added to every clang call it makes, the runtime's and the link's included.
export function withFlags(target: Target, flags: string[]): Target {
  return { ...target, compile: [...target.compile, ...flags] };
}

// The llvm-profdata of the clang that builds, else the one on PATH, else Xcode's on macOS.
function profileTool(): string | undefined {
  try {
    const beside = new TextDecoder().decode(Bun.spawnSync(["clang", "-print-prog-name=llvm-profdata"]).stdout).trim();
    if (beside.startsWith("/") && existsSync(beside)) return beside;
  } catch (_e) {
    // clang's own answer is only the first place looked.
  }
  const onPath = Bun.which("llvm-profdata");
  if (onPath !== null) return onPath;
  if (process.platform !== "darwin") return undefined;
  try {
    const found = Bun.spawnSync(["xcrun", "-f", "llvm-profdata"]);
    const path = new TextDecoder().decode(found.stdout).trim();
    return found.exitCode === 0 && path !== "" ? path : undefined;
  } catch (_e) {
    return undefined;
  }
}

// The flags of a release build optimized with `profiles`: raw profiles from instrumented runs, an
// indexed .profdata, or several of either, merged by llvm-profdata into one kept under the
// cache by its digest, so cached objects built from a profile never outlive a change to it.
/** @throws {Error | IoError} */
export function pgoUse(profiles: Ref<string[]>): string[] {
  for (const p of profiles) if (!existsSync(p)) throw new Error(`fishc build: the profile '${p}' doesn't exist; build with '--pgo-instrument', run the program it writes, and pass the default.profraw the run leaves`);
  const tool = profileTool();
  if (tool === undefined) throw new Error("fishc build: '--pgo' merges profiles with llvm-profdata, which wasn't found beside clang or on PATH; install LLVM (apt install llvm on Debian and Ubuntu, or Xcode's command line tools on macOS) and put its bin directory on PATH");
  const dir = join(cacheDir(), "pgo");
  mkdirSync(dir, { recursive: true });
  const merging = join(dir, `merging-${process.pid}.profdata`);
  const merged = Bun.spawnSync([tool, "merge", "-o", merging, ...profiles]);
  if (merged.exitCode !== 0) throw new Error(`fishc build: llvm-profdata couldn't merge the profiles:\n${new TextDecoder().decode(merged.stderr).trim()}`);
  const digest = createHash("sha256").update(readFileSync(merging)).digest("hex").slice(0, 16);
  const kept = join(dir, `${digest}.profdata`);
  renameSync(merging, kept);
  // A function the profile doesn't know, or knows from other code, is optimized without it.
  return [`-fprofile-use=${kept}`, "-Wno-profile-instr-unprofiled", "-Wno-profile-instr-out-of-date", "-Wno-backend-plugin"];
}

// The OS, CPU and libc `std:build` names for a build of `info`.
export function buildFacts(info: Ref<BuildInfo>): { os: string; arch: string; libc: string } {
  const triple = info.triple !== "" ? info.triple : hostTriple() ?? "";
  if (isWasm(triple)) return { os: "wasi", arch: "wasm32", libc: "wasi" };
  if (isLambda(triple)) return { os: "linux", arch: lambdaCpu(triple), libc: "musl" };
  if (isWindows(triple)) return { os: "windows", arch: triple.startsWith("x86_64") ? "x86_64" : "aarch64", libc: "ucrt" };
  const os = triple.includes("-apple-") ? "macos" : "linux";
  const arch = triple.startsWith("x86_64") ? "x86_64" : "aarch64";
  const libc = triple.includes("-apple-") ? "darwin" : triple.endsWith("-musl") ? "musl" : "gnu";
  return { os, arch, libc };
}

// The source of `std:build` for a build of `info`: the target's OS, CPU and libc, whether it is a
// release build, and the `--flag`s it was given, as constants a `comptime` condition reads.
export function buildModule(info: Ref<BuildInfo>): string {
  const { os, arch, libc } = buildFacts(info);
  const names = info.flags.map((f) => JSON.stringify(f.name)).join(", ");
  const values = info.flags.map((f) => (f.value === null ? "null" : JSON.stringify(f.value))).join(", ");
  return `
export type Os = "macos" | "linux" | "wasi" | "windows";
export type Arch = "x86_64" | "aarch64" | "wasm32";
export type Libc = "darwin" | "gnu" | "musl" | "wasi" | "ucrt";
export const target: { os: Os; arch: Arch; libc: Libc; release: boolean } = { os: "${os}", arch: "${arch}", libc: "${libc}", release: ${info.release} };
// The build's --flag options, by name: a bare --flag name has no value, so get gives null for it.
export class BuildFlags {
  names: string[];
  values: (string | null)[];
  constructor(names: string[], values: (string | null)[]) {
    this.names = names;
    this.values = values;
  }
  has(name: string): boolean {
    for (const n of this.names) if (n === name) return true;
    return false;
  }
  get(name: string): string | null {
    for (let i: usize = 0; i < this.names.length; i++) if (this.names[i] === name) return this.values[i];
    return null;
  }
}
export const flags: BuildFlags = new BuildFlags([${names}], [${values}]);
`;
}
