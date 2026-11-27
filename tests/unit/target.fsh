// Resolving a build target's clang flags, and the builds that use them,
// run through the native fishc. The Docker cases run only with a sysroot named in the environment.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { copyTarget, dockerfile, dockerfilePath, HOST_TARGET, hostTarget, hostTriple, linkerFlags, resolveTarget, runsOnMusl, staticTarget, type Target } from "../../src/target.fsh";
import { fishcPath, removed, same, scratch, text } from "./support.fsh";

const mac = "aarch64-apple-darwin";
const linux = "x86_64-unknown-linux-gnu";

function has(_tool: string): string | null {
  return "/usr/bin/tool";
}

function none(_tool: string): string | null {
  return null;
}

// The message `run` throws, or "" when it throws nothing.
function thrown(run: () => Target throws Error): string {
  try {
    const _t = run();
    return "";
  } catch (e) {
    return e.message;
  }
}

function throwsWith(run: () => Target throws Error, message: string): void {
  const got = thrown(run);
  assert(got.includes(message), `expected a throw containing ${message}, got: ${got === "" ? "no throw" : got}`);
}

function equal(got: Ref<Target>, want: Ref<Target>, what: string): void {
  assert(got === want, `${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
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

test("the host's triple", () => {
  assert(hostTriple("darwin", "arm64") === mac, "darwin arm64");
  assert(hostTriple("linux", "x64", false) === linux, "linux x64");
  assert(hostTriple("linux", "arm64", true) === "aarch64-unknown-linux-musl", "linux arm64 musl");
  assert(hostTriple("win32", "x64") === undefined, "win32");
  assert(hostTriple("linux", "ia32") === undefined, "ia32");
});

test("the host's libc is the running process's, whatever is on disk", () => {
  assert(!runsOnMusl("7f00-7f10 r-xp 00000000 08:01 12 /usr/lib/x86_64-linux-gnu/libc.so.6\n"), "glibc mapping");
  assert(runsOnMusl("7f00-7f10 r-xp 00000000 08:01 12 /lib/ld-musl-x86_64.so.1\n"), "musl mapping");
  assert(!runsOnMusl(""), "no mappings");
  if (process.platform === "linux") assert(hostTriple()!.endsWith("-musl") === runsOnMusl(), "the host's own libc");
  // Off Linux there are no mappings to read, so a Linux triple asked for there is glibc's.
  assert(hostTriple("linux", "arm64") === (runsOnMusl() ? "aarch64-unknown-linux-musl" : "aarch64-unknown-linux-gnu"), "linux arm64");
});

test("no target, or the host's, builds as before", () => {
  try {
    equal(resolveTarget(undefined, undefined, mac, none), HOST_TARGET, "no target");
    equal(resolveTarget(mac, undefined, mac, none), HOST_TARGET, "the host's");
    equal(resolveTarget(undefined, "", mac, none), HOST_TARGET, "an empty sysroot");
    const want: Target = { triple: mac, compile: ["--sysroot", "/s"], link: [], ar: "ar" };
    equal(resolveTarget(undefined, "/s", mac, none), want, "a sysroot");
  } catch (e) {
    assert(false, e.message);
  }
});

test("the other macOS architecture needs neither sysroot nor lld", () => {
  try {
    const want: Target = { triple: "x86_64-apple-darwin", compile: ["-target", "x86_64-apple-darwin", "-Wno-override-module", "-mmacosx-version-min=10.12"], link: [], ar: "ar" };
    equal(resolveTarget("x86_64-apple-darwin", undefined, mac, none), want, "x86_64 macOS");
  } catch (e) {
    assert(false, e.message);
  }
});

test("Linux from macOS takes a sysroot and lld", () => {
  try {
    const want: Target = { triple: linux, compile: ["-target", linux, "-Wno-override-module", "--sysroot", "/s"], link: ["-fuse-ld=lld"], ar: "llvm-ar" };
    equal(resolveTarget(linux, "/s", mac, has), want, "linux from macOS");
  } catch (e) {
    assert(false, e.message);
  }
  throwsWith(() => resolveTarget(linux, undefined, mac, has), "fishc build: building for x86_64-unknown-linux-gnu from macOS needs a Linux sysroot");
  throwsWith(() => resolveTarget(linux, "/s", mac, none), "'ld.lld' isn't on PATH; install it with 'brew install lld'");
});

test("from a Linux host", () => {
  const arm = "aarch64-unknown-linux-gnu";
  try {
    const want: Target = { triple: arm, compile: ["-target", arm, "-Wno-override-module"], link: ["-fuse-ld=lld"], ar: "ar" };
    equal(resolveTarget(arm, undefined, linux, has), want, "arm linux");
    const sdk: Target = { triple: mac, compile: ["-target", mac, "-Wno-override-module", "-mmacosx-version-min=11.0", "--sysroot", "/sdk"], link: ["-fuse-ld=lld"], ar: "llvm-ar" };
    equal(resolveTarget(mac, "/sdk", linux, has), sdk, "macOS from linux");
  } catch (e) {
    assert(false, e.message);
  }
  throwsWith(() => resolveTarget(arm, undefined, linux, none), "install it with your package manager's lld package");
  throwsWith(() => resolveTarget(mac, undefined, linux, has), "needs a macOS SDK");
  throwsWith(() => resolveTarget(mac, "/sdk", linux, (t) => (t === "ld64.lld" ? null : "/x")), "'ld64.lld' isn't on PATH");
});

// The flags `target` links with when `found` names the linkers on PATH, or the message thrown.
function linkedWith(target: Ref<Target>, host: string, found: string[]): string {
  try {
    return linkerFlags(target, host, (t) => (found.includes(t) ? `/bin/${t}` : null)).join(" ");
  } catch (e) {
    return `error: ${e.message}`;
  }
}

test("the fastest linker found links, else the platform's", () => {
  const host = hostTarget();
  assert(linkedWith(host, linux, ["ld.mold", "ld.lld"]) === "-fuse-ld=mold", "mold first on Linux");
  assert(linkedWith(host, linux, ["ld.lld"]) === "-fuse-ld=lld", "then lld");
  assert(linkedWith(host, linux, []) === "", "the platform's when neither is found");
  assert(linkedWith(host, mac, ["ld64.lld", "ld64.mold"]) === "", "Apple's linker on macOS");
  const system: Target = { ...hostTarget(), linker: "system" };
  assert(linkedWith(system, linux, ["ld.mold"]) === "", "--linker system");
  const lld: Target = { ...hostTarget(), linker: "lld" };
  assert(linkedWith(lld, mac, ["ld64.lld"]) === "-fuse-ld=lld", "--linker lld on macOS");
  assert(linkedWith(lld, linux, []).includes("'--linker lld' links with 'ld.lld', which isn't on PATH"), `missing: ${linkedWith(lld, linux, [])}`);
  const odd: Target = { ...hostTarget(), linker: "gold" };
  assert(linkedWith(odd, linux, ["ld.gold"]).includes("unknown linker 'gold'"), "unknown");
  const cross: Target = { triple: linux, compile: [], link: ["-fuse-ld=lld"], ar: "llvm-ar", linker: "mold" };
  assert(linkedWith(cross, mac, ["ld.mold"]) === "", "a target's own linker is kept");
  const toLinux: Target = { ...hostTarget(), triple: linux };
  assert(linkedWith(toLinux, mac, ["ld.mold", "ld64.lld"]) === "-fuse-ld=mold", "the target's OS decides");
});

test("a relative sysroot is made absolute", () => {
  try {
    const t = resolveTarget(linux, "roots/linux", mac, has);
    assert(t.compile.includes(join(process.cwd(), "roots/linux")), `got ${JSON.stringify(t.compile)}`);
  } catch (e) {
    assert(false, e.message);
  }
});

test("an unknown triple", () => {
  throwsWith(() => resolveTarget("riscv64-unknown-linux-gnu", undefined, mac, has), "fishc build: unknown target 'riscv64-unknown-linux-gnu'; use one of aarch64-apple-darwin,");
});

// Whether Docker is installed and its daemon answers.
function docker(): boolean {
  if (Bun.which("docker") === null) return false;
  return spawnSync("docker", ["info"]).status === 0;
}

function program(): string {
  return `async function work(n: i64): Promise<i64> {
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
}

// With a Linux sysroot named in FISH_TEST_SYSROOT_ARM64 or FISH_TEST_SYSROOT_AMD64, programs built
// for that Linux target run in Docker; without one, or without Docker, the case is skipped.
function linuxRun(arch: string, cpu: string): void {
  const sysroot = arch === "arm64" ? process.env.FISH_TEST_SYSROOT_ARM64 : process.env.FISH_TEST_SYSROOT_AMD64;
  if (sysroot === undefined || sysroot === "" || !docker() || hostTriple() === `${cpu}-unknown-linux-gnu`) {
    console.log(`skipped: runs a program built for ${cpu} Linux needs FISH_TEST_SYSROOT_${arch.toUpperCase()} and Docker`);
    return;
  }
  const dir = scratch("fish-target-");
  write(join(dir, "main.fsh"), program());
  const built = spawnSync(fishcPath(), ["build", join(dir, "main.fsh"), "-o", join(dir, "main"), "--target", `${cpu}-unknown-linux-gnu`, "--sysroot", sysroot]);
  same(text(built.stderr), "", "the build's stderr");
  const run = spawnSync("docker", ["run", "--rm", "--platform", `linux/${arch}`, "-v", `${dir}:/w`, "debian:bookworm", "/w/main"]);
  same(text(run.stdout), "linux 40 1.4142135623730951\n", "the program's output");
  assert(text(run.stderr).includes("index out of bounds"), `stderr: ${text(run.stderr)}`);
  assert(run.status === 101, `exit code ${run.status ?? -1}`);
  removed(dir);
}

test("runs a program built for aarch64 Linux", () => {
  linuxRun("arm64", "aarch64");
});

test("runs a program built for x86_64 Linux", () => {
  linuxRun("amd64", "x86_64");
});

// With a musl sysroot, such as an extracted Alpine root with musl-dev and gcc, named in
// FISH_TEST_SYSROOT_MUSL_ARM64 or FISH_TEST_SYSROOT_MUSL_AMD64, a static build runs alone in an
// image built from the Dockerfile written beside it.
function staticRun(arch: string, cpu: string): void {
  const sysroot = arch === "arm64" ? process.env.FISH_TEST_SYSROOT_MUSL_ARM64 : process.env.FISH_TEST_SYSROOT_MUSL_AMD64;
  if (sysroot === undefined || sysroot === "" || !docker()) {
    console.log(`skipped: runs a static program for ${cpu} Linux from scratch needs FISH_TEST_SYSROOT_MUSL_${arch.toUpperCase()} and Docker`);
    return;
  }
  const dir = scratch("fish-static-");
  write(join(dir, "main.fsh"), program());
  const built = spawnSync(fishcPath(), ["build", join(dir, "main.fsh"), "-o", join(dir, "app"), "--target", `${cpu}-unknown-linux-musl`, "--sysroot", sysroot, "--static", "--dockerfile"]);
  same(text(built.stderr), "", "the build's stderr");
  same(readText(join(dir, "Dockerfile")), 'FROM scratch\nCOPY ["app","/app"]\nENTRYPOINT ["/app"]\n', "the Dockerfile");
  const image = `fish-static-test-${arch}`;
  assert(spawnSync("docker", ["build", "-q", "--platform", `linux/${arch}`, "-t", image, dir]).status === 0, "docker build failed");
  const run = spawnSync("docker", ["run", "--rm", "--platform", `linux/${arch}`, image]);
  spawnSync("docker", ["rmi", "-f", image]);
  same(text(run.stdout), "linux 40 1.4142135623730951\n", "the program's output");
  assert(text(run.stderr).includes("index out of bounds"), `stderr: ${text(run.stderr)}`);
  assert(text(run.stderr).includes("stack backtrace:\n   0: main at "), `stderr: ${text(run.stderr)}`);
  assert(run.status === 101, `exit code ${run.status ?? -1}`);
  removed(dir);
}

test("runs a static program for aarch64 Linux from scratch", () => {
  staticRun("arm64", "aarch64");
});

test("runs a static program for x86_64 Linux from scratch", () => {
  staticRun("amd64", "x86_64");
});

// A musl target is refused before the build without lld, so it would never reach the Dockerfile.
test("a build with --dockerfile keeps the user's own Dockerfile", () => {
  if (Bun.which("ld.lld") === null) {
    console.log("skipped: no ld.lld on PATH");
    return;
  }
  const dir = scratch("fish-dockerfile-");
  write(join(dir, "main.fsh"), 'function main() {\n  console.log("app");\n}\n');
  write(join(dir, "Dockerfile"), "FROM node\n");
  const sysroot = scratch("fish-sysroot-");
  const built = spawnSync(fishcPath(), ["build", join(dir, "main.fsh"), "-o", join(dir, "app"), "--target", "aarch64-unknown-linux-musl", "--sysroot", sysroot, "--static", "--dockerfile"]);
  assert(text(built.stderr).includes("fishc build: '--dockerfile' would replace"), `stderr: ${text(built.stderr)}`);
  assert(built.status === 1, `exit code ${built.status ?? -1}`);
  same(readText(join(dir, "Dockerfile")), "FROM node\n", "the user's Dockerfile");
  removed(dir);
  removed(sysroot);
});

test("FISH_SYSROOT leaves a build for the host alone", () => {
  const dir = scratch("fish-target-");
  write(join(dir, "main.fsh"), 'function main() {\n  console.log("host");\n}\n');
  const nameds: string[][] = [[], ["--target", hostTriple()!]];
  for (const named of nameds) {
    const built = spawnSync("env", ["FISH_SYSROOT=/nonexistent", fishcPath(), "build", join(dir, "main.fsh"), "-o", join(dir, "main"), ...named]);
    same(text(built.stderr), "", `the build's stderr with ${JSON.stringify(named)}`);
    same(text(spawnSync(join(dir, "main"), []).stdout), "host\n", "the program's output");
  }
  removed(dir);
}, { timeout: 120_000 });

test("Linux over musl takes a musl sysroot from any host whose libc isn't musl", () => {
  const arm = "aarch64-unknown-linux-musl";
  try {
    const want: Target = { triple: arm, compile: ["-target", arm, "-Wno-override-module", "--sysroot", "/s"], link: ["-fuse-ld=lld"], ar: "llvm-ar" };
    equal(resolveTarget(arm, "/s", mac, has), want, "arm musl from macOS");
    const x86: Target = { triple: "x86_64-unknown-linux-musl", compile: ["-target", "x86_64-unknown-linux-musl", "-Wno-override-module", "--sysroot", "/s"], link: ["-fuse-ld=lld"], ar: "ar" };
    equal(resolveTarget("x86_64-unknown-linux-musl", "/s", linux, has), x86, "x86_64 musl from linux");
    // On a musl host, its own triple is a plain build, and glibc is the other libc.
    equal(resolveTarget("x86_64-unknown-linux-musl", undefined, "x86_64-unknown-linux-musl", none), HOST_TARGET, "a musl host's own");
  } catch (e) {
    assert(false, e.message);
  }
  throwsWith(() => resolveTarget(arm, undefined, mac, has), "from macOS needs a musl sysroot, a directory holding the target's /usr/include and /usr/lib with musl and libgcc, such as the root of an Alpine Linux system with musl-dev and gcc installed; give it with --sysroot <dir> or FISH_SYSROOT");
  throwsWith(() => resolveTarget("x86_64-unknown-linux-musl", undefined, linux, has), "from Linux needs a musl sysroot");
  throwsWith(() => resolveTarget(linux, undefined, "x86_64-unknown-linux-musl", has), "needs a Linux sysroot");
});

test("--static links only musl targets statically", () => {
  const arm = "aarch64-unknown-linux-musl";
  try {
    const musl = resolveTarget(arm, "/s", mac, has);
    const linked: Target = { triple: musl.triple, compile: [...musl.compile], link: ["-fuse-ld=lld", "-static"], ar: musl.ar };
    equal(staticTarget(copyTarget(musl), mac), linked, "a musl target");
    const host: Target = { triple: "", compile: [], link: ["-static"], ar: "ar" };
    equal(staticTarget(hostTarget(), arm), host, "a musl host");
  } catch (e) {
    assert(false, e.message);
  }
  throwsWith(() => staticTarget(hostTarget(), mac), "fishc build: --static links musl into the binary, so it builds only for a musl target; pass --target aarch64-unknown-linux-musl with a musl sysroot in --sysroot or FISH_SYSROOT");
  throwsWith(() => staticTarget(resolveTarget(linux, "/s", mac, has), mac), "pass --target x86_64-unknown-linux-musl");
  throwsWith(() => staticTarget(hostTarget(), linux), "pass --target x86_64-unknown-linux-musl");
});

function dockerfileRefusal(name: string): string {
  try {
    const _d = dockerfile(name);
    return "";
  } catch (e) {
    return e.message;
  }
}

test("a Dockerfile holding only the binary", () => {
  try {
    same(dockerfile("dist/api"), 'FROM scratch\nCOPY ["api","/api"]\nENTRYPOINT ["/api"]\n', "dist/api");
    same(dockerfile("my app"), 'FROM scratch\nCOPY ["my app","/my app"]\nENTRYPOINT ["/my app"]\n', "my app");
  } catch (e) {
    assert(false, e.message);
  }
  for (const name of ["a$b", "a*", "a?", "a[1]", "a\\b", 'a"b', "it's"]) {
    const got = dockerfileRefusal(name);
    const want = `fishc build: a Dockerfile reads $, *, ?, [, quotes and \\ in '${name}' specially, so '--dockerfile' can't copy it; choose another name with -o`;
    assert(got.includes(want), `${name}: expected ${want}, got: ${got}`);
  }
});

function pathRefusal(binary: string): string {
  try {
    const _p = dockerfilePath(binary);
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : (e as IoError).message;
  }
}

test("the Dockerfile goes beside the binary, never over the user's own or the binary", () => {
  const dir = scratch("fish-dockerfile-");
  const binary = join(dir, "dist", "api");
  try {
    same(dockerfilePath(binary), join(dir, "dist", "Dockerfile"), "with no Dockerfile");
    mkdirSync(join(dir, "dist"));
    const own = dockerfile(binary);
    writeFileSync(join(dir, "dist", "Dockerfile"), own);
    same(dockerfilePath(binary), join(dir, "dist", "Dockerfile"), "over its own");
    writeFileSync(join(dir, "dist", "Dockerfile"), "FROM node\n");
  } catch (e) {
    assert(false, e instanceof Error ? e.message : (e as IoError).message);
  }
  const kept = pathRefusal(binary);
  const want = `fishc build: '--dockerfile' would replace ${join(dir, "dist", "Dockerfile")}, which holds something else; move it, or build into another directory with -o`;
  assert(kept.includes(want), `expected ${want}, got: ${kept}`);
  for (const name of ["Dockerfile", "dockerfile"]) {
    const got = pathRefusal(join(dir, name));
    const named = `fishc build: '--dockerfile' writes ${join(dir, "Dockerfile")}, which is the binary's own name; choose another name with -o`;
    assert(got.includes(named), `${name}: expected ${named}, got: ${got}`);
  }
  removed(dir);
});

test("--static and --dockerfile refused where they can't apply", () => {
  if (hostTriple()?.endsWith("-musl") ?? true) {
    console.log("skipped: the host is musl or not a target");
    return;
  }
  const dir = scratch("fish-target-");
  write(join(dir, "main.fsh"), 'function main() {\n  console.log("host");\n}\n');
  const fishc = (args: string[]) => spawnSync(fishcPath(), ["build", join(dir, "main.fsh"), "-o", join(dir, "main"), ...args]);
  const host = fishc(["--static"]);
  assert(text(host.stderr).includes("fishc build: --static links musl into the binary, so it builds only for a musl target"), `stderr: ${text(host.stderr)}`);
  assert(host.status === 1, `--static exited with ${host.status ?? -1}`);
  const lib = fishc(["--static", "--lib"]);
  same(text(lib.stderr), "fishc build: '--static' builds an executable, not a library; leave out '--lib', or '--static'\n", "--static --lib");
  assert(lib.status === 2, `--static --lib exited with ${lib.status ?? -1}`);
  const image = fishc(["--dockerfile"]);
  same(text(image.stderr), "fishc build: '--dockerfile' writes an image holding only the binary, which needs it built with '--static'\n", "--dockerfile");
  assert(image.status === 2, `--dockerfile exited with ${image.status ?? -1}`);
  for (const flag of ["--static", "--dockerfile"]) {
    const ir = fishc([flag, "--emit-llvm"]);
    same(text(ir.stderr), "fishc build: '--emit-llvm' prints the IR without linking it, so '--static' and '--dockerfile' don't apply; leave them out\n", `${flag} --emit-llvm`);
    assert(ir.status === 2, `${flag} --emit-llvm exited with ${ir.status ?? -1}`);
  }
  assert(!existsSync(join(dir, "main")), "a binary was written");
  assert(!existsSync(join(dir, "Dockerfile")), "a Dockerfile was written");
  removed(dir);
});
