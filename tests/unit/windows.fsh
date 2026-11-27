// Windows builds through llvm-mingw: the targets' flags and refusals, an x86_64 program run under
// Wine in Docker, and an aarch64 program linked. The builds need llvm-mingw named in
// FISH_TEST_LLVM_MINGW, and the run Docker as well; without them those cases are skipped.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { forTarget, resolveTarget, type Target } from "../../src/target.fsh";
import { fishc, removed, same, scratch, text } from "./support.fsh";

function thrown(run: () => Target throws Error): string {
  try {
    const _t = run();
    return "";
  } catch (e) {
    return e.message;
  }
}

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

test("a Windows target builds with llvm-mingw's clang and links statically", () => {
  const t = resolveTarget("x86_64-w64-windows-gnu", "/w/llvm-mingw", undefined, undefined, (_p) => true);
  same(t.cc ?? "", "/w/llvm-mingw/bin/clang", "the clang");
  same(t.compile.slice(0, 2).join(" "), "-target x86_64-w64-windows-gnu", "compile");
  same(t.link.join(" "), "-static -lws2_32 -lntdll -lbcrypt", "link");
  same(t.ar, "/w/llvm-mingw/bin/llvm-ar", "ar");
  same(resolveTarget("aarch64-w64-windows-gnu", "/w/llvm-mingw", undefined, undefined, (_p) => true).compile[1]!, "aarch64-w64-windows-gnu", "aarch64");
});

test("a Windows target says where llvm-mingw comes from", () => {
  assert(thrown(() => resolveTarget("x86_64-w64-windows-gnu", undefined)).includes("github.com/mstorsjo/llvm-mingw"), "no sysroot");
  assert(thrown(() => resolveTarget("x86_64-w64-windows-gnu", "/w", undefined, undefined, (p) => p.endsWith("clang"))).includes("isn't an llvm-mingw toolchain for x86_64-w64-windows-gnu: it needs bin/clang and x86_64-w64-mingw32"), "not a toolchain");
});

test("Windows IR unwinds with the C personality's SEH form", () => {
  const ir = "define void @f() uwtable personality ptr @__gcc_personality_v0 {";
  same(forTarget(ir, resolveTarget("x86_64-w64-windows-gnu", "/w", undefined, undefined, (_p) => true)), "define void @f() uwtable personality ptr @__gcc_personality_seh0 {", "windows");
  same(forTarget(ir, { triple: "", compile: [], link: [], ar: "ar" }), ir, "the host");
});

test("a Windows build refuses what it can't build yet", () => {
  const dir = scratch("fish-windows-refuse-");
  write(join(dir, "main.fsh"), "function main() {}\n");
  for (const flag of ["--lib", "--static"]) {
    const run = fishc(dir, ["build", "main.fsh", "--target", "x86_64-w64-windows-gnu", flag]);
    assert(run.code !== 0 && run.err.includes(`leave out '${flag}'`), `${flag}: ${run.err}`);
  }
  removed(dir);
});

const PROGRAM = `async function work(n: i64): Promise<i64> {
  await sleep(5);
  return n * 2;
}
async function main(): Promise<void> throws IoError {
  const a = spawn(work(20));
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const c = await TcpStream.connect("127.0.0.1", listener.port);
  const server = await listener.accept();
  let bytes: u8[] = [1, 2, 3];
  await c.write(bytes);
  const got = await server.read(10);
  const n = await a;
  console.log("windows", n, got.length, Math.sqrt(2.0));
  const xs: i64[] = [];
  console.log(xs[got.length]);
}
`;

// Debian's Wine, for x86_64 programs, as the golden runner's --wine runs them too.
const WINE = "FROM debian:bookworm-slim\nRUN apt-get update && apt-get install -y --no-install-recommends wine wine64 && rm -rf /var/lib/apt/lists/*\nENV WINEDEBUG=-all WINEPREFIX=/root/.wine\nRUN (wine wineboot --init && wineserver -w) >/dev/null 2>&1 || true\n";

function docker(): boolean {
  if (Bun.which("docker") === null) return false;
  return spawnSync("docker", ["info"]).status === 0;
}

function wineImage(): boolean {
  if (spawnSync("docker", ["image", "inspect", "fish-wine"]).status === 0) return true;
  return spawnSync("docker", ["build", "-q", "--platform", "linux/amd64", "-t", "fish-wine", "-"], { input: WINE }).status === 0;
}

function built(cpu: string, toolchain: string): string {
  const dir = scratch(`fish-windows-${cpu}-`);
  write(join(dir, "main.fsh"), PROGRAM);
  const run = fishc(dir, ["build", "main.fsh", "--target", `${cpu}-w64-windows-gnu`, "--sysroot", toolchain]);
  same(run.err, "", `the ${cpu} build's stderr`);
  return dir;
}

test("a program built for x86_64 Windows runs under Wine", () => {
  const toolchain = process.env.FISH_TEST_LLVM_MINGW;
  if (toolchain === undefined || toolchain === "" || !docker()) {
    console.log("skipped: running a program built for x86_64 Windows needs FISH_TEST_LLVM_MINGW and Docker");
    return;
  }
  const dir = built("x86_64", toolchain);
  assert(wineImage(), "the fish-wine image didn't build");
  const run = spawnSync("docker", ["run", "--rm", "--platform", "linux/amd64", "-v", `${dir}:/w`, "fish-wine", "wine", "/w/main.exe"]);
  same(text(run.stdout), "windows 40 3 1.4142135623730951\n", "the program's output");
  assert(text(run.stderr).includes("index out of bounds"), `stderr: ${text(run.stderr)}`);
  assert(run.status === 101, `exit code ${run.status ?? -1}`);
  removed(dir);
});

test("a program built for aarch64 Windows links", () => {
  const toolchain = process.env.FISH_TEST_LLVM_MINGW;
  if (toolchain === undefined || toolchain === "") {
    console.log("skipped: building for aarch64 Windows needs FISH_TEST_LLVM_MINGW");
    return;
  }
  const dir = built("aarch64", toolchain);
  let bytes: u8[] = [];
  try {
    bytes = readFileSync(join(dir, "main.exe"));
  } catch (e) {
    assert(false, `main.exe: ${e.message}`);
  }
  // A PE file: "MZ", then at the offset its header names, "PE\0\0" and the machine, 0xAA64 for ARM64.
  assert(bytes[0]! === 0x4d && bytes[1]! === 0x5a, "an MZ header");
  const pe = (bytes[0x3c]! as usize) | ((bytes[0x3d]! as usize) << 8);
  assert(bytes[pe]! === 0x50 && bytes[pe + 1]! === 0x45, "a PE header");
  assert(bytes[pe + 4]! === 0x64 && bytes[pe + 5]! === 0xaa, "an ARM64 machine");
  removed(dir);
});
