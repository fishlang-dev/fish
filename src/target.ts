import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Build targets: the four v1 platforms and Linux over musl for static binaries, named by their
// Rust triples, and the clang flags that build for one from the host fishc runs on.

export const TARGETS = ["aarch64-apple-darwin", "x86_64-apple-darwin", "aarch64-unknown-linux-gnu", "x86_64-unknown-linux-gnu", "aarch64-unknown-linux-musl", "x86_64-unknown-linux-musl"];

// `compile` goes to every clang compile, and `compile` then `link` to the final link. The host's
// own target has both empty, so its builds and cache keys are what they were before targets.
// `ar` archives a static library: the host's own can't index another OS's objects.
export type Target = { triple: string; compile: string[]; link: string[]; ar: string };

export const HOST_TARGET: Target = { triple: "", compile: [], link: [], ar: "ar" };

const osOf = (triple: string) => (triple.includes("-apple-") ? "macOS" : "Linux");
const musl = (triple: string) => triple.endsWith("-musl");

// The triple of the machine running fishc, if it is one of the targets.
// A Linux host is musl's when musl's dynamic loader is where Alpine and other musl systems put it.
export function hostTriple(platform: string = process.platform, arch: string = process.arch, onMusl?: boolean): string | undefined {
  const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : undefined;
  if (!cpu) return undefined;
  if (platform === "darwin") return `${cpu}-apple-darwin`;
  if (platform === "linux") return `${cpu}-unknown-linux-${onMusl ?? existsSync(`/lib/ld-musl-${cpu}.so.1`) ? "musl" : "gnu"}`;
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
