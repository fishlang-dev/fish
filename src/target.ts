import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

// Build targets: the four v1 platforms and Linux over musl for static binaries, named by their
// Rust triples, and the clang flags that build for one from the host fishc runs on.

export const TARGETS = ["aarch64-apple-darwin", "x86_64-apple-darwin", "aarch64-unknown-linux-gnu", "x86_64-unknown-linux-gnu", "aarch64-unknown-linux-musl", "x86_64-unknown-linux-musl"];

// `compile` goes to every clang compile, and `compile` then `link` to the final link. The host's
// own target has both empty, so its builds and cache keys are what they were before targets.
// `ar` archives a static library: the host's own can't index another OS's objects. `sanitize`
// names the sanitizer a build is instrumented with, if any.
export type Target = { triple: string; compile: string[]; link: string[]; ar: string; sanitize?: string };

export const HOST_TARGET: Target = { triple: "", compile: [], link: [], ar: "ar" };

const osOf = (triple: string) => (triple.includes("-apple-") ? "macOS" : "Linux");
const musl = (triple: string) => triple.endsWith("-musl");

// The triple of the machine running fishc, if it is one of the targets.
// Whether the running process has musl as its libc. The process is asked rather than the disk: a
// glibc system can have musl's loader installed beside its own. Node's report names the glibc
// version a process runs on, and has none under musl.
export function runsOnMusl(header: { glibcVersionRuntime?: string } = (process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header): boolean {
  return header.glibcVersionRuntime === undefined;
}

export function hostTriple(platform: string = process.platform, arch: string = process.arch, onMusl?: boolean): string | undefined {
  const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : undefined;
  if (!cpu) return undefined;
  if (platform === "darwin") return `${cpu}-apple-darwin`;
  if (platform === "linux") return `${cpu}-unknown-linux-${onMusl ?? runsOnMusl() ? "musl" : "gnu"}`;
  return undefined;
}

// The target `triple` names, built from `host` with `sysroot` when given. A target on another OS
// needs that OS's libraries from a sysroot and lld to link them, as does any other target on a
// Linux host, whose system linker knows one architecture; Apple's linker knows both of its own.
// Linux over the other libc, musl or glibc, needs that libc's sysroot too.
// Throws an Error whose message is the user-facing reason.
export function resolveTarget(triple: string | undefined, sysroot: string | undefined, host: string | undefined = hostTriple(), which: (tool: string) => string | null = Bun.which): Target {
  // Cached objects compile in an empty directory of their own, where a relative path means nothing.
  sysroot = sysroot ? resolve(sysroot) : undefined;
  if (triple === undefined || triple === host) return sysroot ? { ...HOST_TARGET, triple: host ?? "", compile: ["--sysroot", sysroot] } : HOST_TARGET;
  if (!TARGETS.includes(triple)) throw new Error(`fishc build: unknown target '${triple}'; use one of ${TARGETS.join(", ")}`);
  const os = osOf(triple);
  const foreign = host === undefined || osOf(host) !== os;
  if ((foreign || musl(triple) !== musl(host!)) && !sysroot) {
    const what = musl(triple)
      ? "a musl sysroot, a directory holding the target's /usr/include and /usr/lib with musl and libgcc, such as the root of an Alpine Linux system with musl-dev and gcc installed"
      : os === "Linux"
        ? "a Linux sysroot, a directory holding the target's /usr/include and /usr/lib with glibc and libgcc"
        : "a macOS SDK, such as the MacOSX.sdk directory from Xcode's command-line tools";
    throw new Error(`fishc build: building for ${triple} from ${host ? osOf(host) : "this machine"} needs ${what}; give it with --sysroot <dir> or FISH_SYSROOT`);
  }
  const lld = foreign || osOf(host!) === "Linux";
  const linker = os === "Linux" ? "ld.lld" : "ld64.lld";
  if (lld && !which(linker)) {
    const install = host && osOf(host) === "macOS" ? "'brew install lld'" : "your package manager's lld package, such as 'apt install lld'";
    throw new Error(`fishc build: building for ${triple} links with lld, and '${linker}' isn't on PATH; install it with ${install}`);
  }
  // The IR names no triple, which clang warns of when given one. A darwin triple names no macOS
  // version, which clang off a Mac reads as one too old for thread-locals; the oldest each
  // architecture's Rust target supports is used, as Rust does.
  const macos = os === "macOS" ? [`-mmacosx-version-min=${triple.startsWith("x86_64") ? "10.12" : "11.0"}`] : [];
  return { triple, compile: ["-target", triple, "-Wno-override-module", ...macos, ...(sysroot ? ["--sysroot", sysroot] : [])], link: lld ? ["-fuse-ld=lld"] : [], ar: foreign ? "llvm-ar" : "ar" };
}

// `target` linked into one binary with no libc or loader to find at run time. Only musl is: glibc
// can't look up names or users from a static binary.
export function staticTarget(target: Target, host: string | undefined = hostTriple()): Target {
  const triple = target.triple || host;
  if (!triple || !musl(triple)) {
    const cpu = triple?.split("-")[0] ?? "x86_64";
    throw new Error(`fishc build: --static links musl into the binary, so it builds only for a musl target; pass --target ${cpu}-unknown-linux-musl with a musl sysroot in --sysroot or FISH_SYSROOT`);
  }
  return { ...target, link: [...target.link, "-static"] };
}

// A container image holding only the static binary at `binary`, built from the directory it's in.
// COPY reads `$` as a variable, `*`, `?` and `[` as a pattern, and removes quotes and backslashes,
// even in its JSON form.
export function dockerfile(binary: string): string {
  const name = basename(binary);
  if (/[$*?[\\"']/.test(name)) throw new Error(`fishc build: a Dockerfile reads $, *, ?, [, quotes and \\ in '${name}' specially, so '--dockerfile' can't copy it; choose another name with -o`);
  return `FROM scratch\nCOPY ${JSON.stringify([name, `/${name}`])}\nENTRYPOINT ${JSON.stringify([`/${name}`])}\n`;
}

// Where `--dockerfile` writes for `binary`, beside it. A Dockerfile already there is replaced only
// when it is the one this would write, so a rebuild works and the user's own is kept.
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
function clangRuntimeDir(triple: string): string {
  const done = Bun.spawnSync(["clang", `--target=${triple}`, "-print-runtime-dir"]);
  if (done.exitCode !== 0) throw new Error(`clang failed:\n${done.stderr.toString()}`);
  return done.stdout.toString().trim();
}

// `target` with every compile instrumented by clang's `kind` sanitizer and its runtime linked, so
// the C runtime and std are checked as well as the program. Frame pointers are kept so reports show
// whole stacks. Clang ships the runtimes per target, and none for musl, so a target it has none for
// is refused. Throws an Error whose message is the user-facing reason.
export function sanitizedTarget(target: Target, kinds: string[], host: string | undefined = hostTriple(), runtimeDir: (triple: string) => string = clangRuntimeDir): Target {
  const unknown = kinds.find((k) => !SANITIZERS.includes(k));
  if (unknown !== undefined) throw new Error(`fishc build: unknown sanitizer '${unknown}'; use one of ${SANITIZERS.join(", ")}`);
  if (kinds.length > 1) throw new Error("fishc build: --sanitize takes one sanitizer at a time; address and thread can't instrument the same build");
  const kind = kinds[0]!;
  const triple = target.triple || host;
  if (target.link.includes("-static")) throw new Error(`fishc build: --sanitize=${kind} links clang's sanitizer runtime, which a --static build can't; leave out one of them`);
  const [cpu] = triple?.split("-") ?? [];
  const lib = kind === "address" ? "asan" : "tsan";
  const names = triple?.includes("-apple-") ? [`libclang_rt.${lib}_osx_dynamic.dylib`] : [`libclang_rt.${lib}.a`, `libclang_rt.${lib}-${cpu}.a`];
  if (!triple || musl(triple) || !names.some((n) => existsSync(join(runtimeDir(triple), n)))) throw new Error(`fishc build: clang has no ${kind} sanitizer runtime for ${triple ?? "this machine"}; build for a target it has one for, such as the host's own`);
  const flags = [`-fsanitize=${kind}`, "-fno-omit-frame-pointer"];
  return { ...target, compile: [...target.compile, ...flags], sanitize: kind };
}

// Clang's front end marks each function a sanitizer should instrument, and Fish's IR carries no
// such marks, so each definition in `ir` is given one for `target`'s sanitizer.
export function instrumented(ir: string, target: Target): string {
  if (!target.sanitize) return ir;
  const attribute = target.sanitize === "address" ? "sanitize_address" : "sanitize_thread";
  return ir.replace(/^(define [^\n]*?)( uwtable| \{$)/gm, `$1 ${attribute}$2`);
}
