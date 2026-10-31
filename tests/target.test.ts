import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOST_TARGET, hostTriple, resolveTarget } from "../src/target.ts";

const mac = "aarch64-apple-darwin";
const linux = "x86_64-unknown-linux-gnu";
const has = () => "/usr/bin/tool";
const none = () => null;

test("the host's triple", () => {
  expect(hostTriple("darwin", "arm64")).toBe(mac);
  expect(hostTriple("linux", "x64")).toBe(linux);
  expect(hostTriple("win32", "x64")).toBeUndefined();
  expect(hostTriple("linux", "ia32")).toBeUndefined();
});

test("no target, or the host's, builds as before", () => {
  expect(resolveTarget(undefined, undefined, mac, none)).toBe(HOST_TARGET);
  expect(resolveTarget(mac, undefined, mac, none)).toBe(HOST_TARGET);
  expect(resolveTarget(undefined, "", mac, none)).toBe(HOST_TARGET);
  expect(resolveTarget(undefined, "/s", mac, none)).toEqual({ triple: mac, compile: ["--sysroot", "/s"], link: [], ar: "ar" });
});

test("the other macOS architecture needs neither sysroot nor lld", () => {
  expect(resolveTarget("x86_64-apple-darwin", undefined, mac, none)).toEqual({ triple: "x86_64-apple-darwin", compile: ["-target", "x86_64-apple-darwin", "-Wno-override-module", "-mmacosx-version-min=10.12"], link: [], ar: "ar" });
});

test("Linux from macOS takes a sysroot and lld", () => {
  expect(resolveTarget(linux, "/s", mac, has)).toEqual({ triple: linux, compile: ["-target", linux, "-Wno-override-module", "--sysroot", "/s"], link: ["-fuse-ld=lld"], ar: "llvm-ar" });
  expect(() => resolveTarget(linux, undefined, mac, has)).toThrow("fishc build: building for x86_64-unknown-linux-gnu from macOS needs a Linux sysroot");
  expect(() => resolveTarget(linux, "/s", mac, none)).toThrow("'ld.lld' isn't on PATH; install it with 'brew install lld'");
});

test("from a Linux host", () => {
  const arm = "aarch64-unknown-linux-gnu";
  expect(resolveTarget(arm, undefined, linux, has)).toEqual({ triple: arm, compile: ["-target", arm, "-Wno-override-module"], link: ["-fuse-ld=lld"], ar: "ar" });
  expect(() => resolveTarget(arm, undefined, linux, none)).toThrow("install it with your package manager's lld package");
  expect(() => resolveTarget(mac, undefined, linux, has)).toThrow("needs a macOS SDK");
  expect(() => resolveTarget(mac, "/sdk", linux, (t) => (t === "ld64.lld" ? null : "/x"))).toThrow("'ld64.lld' isn't on PATH");
  expect(resolveTarget(mac, "/sdk", linux, has)).toEqual({ triple: mac, compile: ["-target", mac, "-Wno-override-module", "-mmacosx-version-min=11.0", "--sysroot", "/sdk"], link: ["-fuse-ld=lld"], ar: "llvm-ar" });
});

test("a relative sysroot is made absolute", () => {
  expect(resolveTarget(linux, "roots/linux", mac, has).compile).toContain(join(process.cwd(), "roots/linux"));
});

test("an unknown triple", () => {
  expect(() => resolveTarget("riscv64-unknown-linux-gnu", undefined, mac, has)).toThrow("fishc build: unknown target 'riscv64-unknown-linux-gnu'; use one of aarch64-apple-darwin,");
});

// With a Linux sysroot named in FISH_TEST_SYSROOT_ARM64 or FISH_TEST_SYSROOT_AMD64, programs built
// for that Linux target run in Docker; without one, or without Docker, the case is skipped.
const docker = Bun.which("docker") !== null && Bun.spawnSync(["docker", "info"]).exitCode === 0;
const PROGRAM = `async function work(n: i64): Promise<i64> {
  await sleep(5);
  return n * 2;
}
async function main() {
  const a = spawn(work(20));
  const x = await a;
  console.log("linux", x, Math.sqrt(2.0));
  const xs: i64[] = [];
  console.log(xs[x as usize]);
}
`;
for (const [arch, cpu] of [["arm64", "aarch64"], ["amd64", "x86_64"]] as const) {
  const sysroot = process.env[`FISH_TEST_SYSROOT_${arch.toUpperCase()}`];
  test.skipIf(!sysroot || !docker || hostTriple() === `${cpu}-unknown-linux-gnu`)(`runs a program built for ${cpu} Linux`, () => {
    const dir = mkdtempSync(join(tmpdir(), "fish-target-"));
    writeFileSync(join(dir, "main.fsh"), PROGRAM);
    const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", join(dir, "main.fsh"), "-o", join(dir, "main"), "--target", `${cpu}-unknown-linux-gnu`, "--sysroot", sysroot!]);
    expect(built.stderr.toString()).toBe("");
    const run = Bun.spawnSync(["docker", "run", "--rm", "--platform", `linux/${arch}`, "-v", `${dir}:/w`, "debian:bookworm", "/w/main"]);
    expect(run.stdout.toString()).toBe("linux 40 1.4142135623730951\n");
    expect(run.stderr.toString()).toContain("index out of bounds");
    expect(run.exitCode).toBe(101);
  }, 600000);
}

test("FISH_SYSROOT leaves a build for the host alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "fish-target-"));
  writeFileSync(join(dir, "main.fsh"), 'function main() {\n  console.log("host");\n}\n');
  for (const named of [[], ["--target", hostTriple()!]]) {
    const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", join(dir, "main.fsh"), "-o", join(dir, "main"), ...named], { env: { ...process.env, FISH_SYSROOT: "/nonexistent" } });
    expect(built.stderr.toString()).toBe("");
    expect(Bun.spawnSync([join(dir, "main")]).stdout.toString()).toBe("host\n");
  }
}, 120000);
