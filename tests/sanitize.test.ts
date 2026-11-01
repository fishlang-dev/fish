import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeUnits } from "../src/main.ts";
import { HOST_TARGET, instrumented, resolveTarget, sanitizedTarget, staticTarget } from "../src/target.ts";

// `fishc build --sanitize address|thread`: the program, std and the C runtime instrumented by one
// of clang's sanitizers, its reports naming .fsh lines.
setDefaultTimeout(120_000);

const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const root = mkdtempSync(join(tmpdir(), "fish-sanitize-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// Why clang can't build for the host with `kind`, or undefined when it can.
function unsupported(kind: string): string | undefined {
  try {
    sanitizedTarget(HOST_TARGET, [kind]);
    return undefined;
  } catch (e) {
    return (e as Error).message;
  }
}
const noAddress = unsupported("address");
const noThread = unsupported("thread");
if (noAddress) console.log(`skipping address sanitizer builds: ${noAddress}`);
if (noThread) console.log(`skipping thread sanitizer builds: ${noThread}`);

// Builds `src` as `main.fsh` in a directory of its own with `args`, then runs it.
function run(name: string, src: string, args: string[]) {
  const dir = join(root, name);
  mkdirSync(dir);
  writeFileSync(join(dir, "main.fsh"), src);
  const built = Bun.spawnSync(["bun", MAIN, "build", "main.fsh", "-o", "main", ...args], { cwd: dir });
  if (built.exitCode !== 0) throw new Error(built.stderr.toString());
  const done = Bun.spawnSync([join(dir, "main")], { cwd: dir });
  return { code: done.exitCode, out: done.stdout.toString(), err: done.stderr.toString() };
}

function fishc(...args: string[]) {
  const done = Bun.spawnSync(["bun", MAIN, "build", ...args], { cwd: root });
  return [done.exitCode, done.stderr.toString()];
}

const has = () => "/bin/lld";
const anywhere = (_: string) => "/runtime";

test("a sanitizer instruments every compile and keeps frame pointers", () => {
  // A runtime directory holding no sanitizer library refuses the target.
  expect(() => sanitizedTarget(HOST_TARGET, ["address"], "aarch64-apple-darwin", () => root)).toThrow("fishc build: clang has no address sanitizer runtime for aarch64-apple-darwin; build for a target it has one for, such as the host's own");
  const dir = join(root, "runtime");
  mkdirSync(dir);
  writeFileSync(join(dir, "libclang_rt.tsan_osx_dynamic.dylib"), "");
  writeFileSync(join(dir, "libclang_rt.asan-x86_64.a"), "");
  const mac = sanitizedTarget(HOST_TARGET, ["thread"], "aarch64-apple-darwin", () => dir);
  expect(mac).toEqual({ ...HOST_TARGET, compile: ["-fsanitize=thread", "-fno-omit-frame-pointer"], sanitize: "thread" });
  const linux = resolveTarget("x86_64-unknown-linux-gnu", "/s", "aarch64-apple-darwin", has);
  expect(sanitizedTarget(linux, ["address"], "aarch64-apple-darwin", () => dir).compile).toEqual([...linux.compile, "-fsanitize=address", "-fno-omit-frame-pointer"]);
  expect(() => sanitizedTarget(linux, ["thread"], "aarch64-apple-darwin", () => dir)).toThrow("clang has no thread sanitizer runtime for x86_64-unknown-linux-gnu");
});

test("one known sanitizer at a time, for a target clang has its runtime for", () => {
  expect(() => sanitizedTarget(HOST_TARGET, ["memory"], "aarch64-apple-darwin", anywhere)).toThrow("fishc build: unknown sanitizer 'memory'; use one of address, thread");
  expect(() => sanitizedTarget(HOST_TARGET, ["address", "thread"], "aarch64-apple-darwin", anywhere)).toThrow("fishc build: --sanitize takes one sanitizer at a time; address and thread can't instrument the same build");
  const musl = resolveTarget("x86_64-unknown-linux-musl", "/s", "aarch64-apple-darwin", has);
  expect(() => sanitizedTarget(musl, ["address"], "aarch64-apple-darwin", anywhere)).toThrow("clang has no address sanitizer runtime for x86_64-unknown-linux-musl");
  expect(() => sanitizedTarget(staticTarget(musl, "aarch64-apple-darwin"), ["thread"], "aarch64-apple-darwin", anywhere)).toThrow("fishc build: --sanitize=thread links clang's sanitizer runtime, which a --static build can't; leave out one of them");
});

test("each definition in the IR is marked for the sanitizer, and an unsanitized build's left alone", () => {
  const ir = 'define internal void @"fsh.constants"() {\ndefine internal { i64, ptr } @"fsh.f"(ptr %p) uwtable personality ptr @__gcc_personality_v0 {\ndeclare void @free(ptr)\n  ; define x {';
  expect(instrumented(ir, { ...HOST_TARGET, sanitize: "thread" })).toBe('define internal void @"fsh.constants"() sanitize_thread {\ndefine internal { i64, ptr } @"fsh.f"(ptr %p) sanitize_thread uwtable personality ptr @__gcc_personality_v0 {\ndeclare void @free(ptr)\n  ; define x {');
  expect(instrumented(ir, { ...HOST_TARGET, sanitize: "address" })).toContain("sanitize_address uwtable personality");
  expect(instrumented(ir, HOST_TARGET)).toBe(ir);
});

test("an instrumented runtime is cached apart from a plain one", () => {
  const [plain] = runtimeUnits("", false);
  const [address] = runtimeUnits("", false, false, { ...HOST_TARGET, compile: ["-fsanitize=address", "-fno-omit-frame-pointer"], sanitize: "address" });
  expect(address!.args).toEqual(["-x", "c", "-", "-fsanitize=address", "-fno-omit-frame-pointer", ...plain!.args.slice(3)]);
});

test("--sanitize refused where it can't apply", () => {
  writeFileSync(join(root, "lib.fsh"), "export function f(): i64 {\n  return 1;\n}\n");
  expect(fishc("lib.fsh", "--sanitize", "address", "--lib", "-o", "libf.a")).toEqual([2, "fishc build: '--sanitize' can't build a library; build the program that uses it with '--sanitize' instead\n"]);
  expect(fishc("lib.fsh", "--sanitize", "address", "--emit-llvm")).toEqual([2, "fishc build: '--emit-llvm' prints the IR before clang instruments it, so '--sanitize' doesn't apply; leave it out\n"]);
  expect(fishc("lib.fsh", "--sanitize=address,thread")).toEqual([1, "fishc build: --sanitize takes one sanitizer at a time; address and thread can't instrument the same build\n"]);
  expect(fishc("lib.fsh", "--sanitize", "address", "--sanitize", "thread")).toEqual([1, "fishc build: --sanitize takes one sanitizer at a time; address and thread can't instrument the same build\n"]);
});

test.skipIf(noAddress !== undefined)("the address sanitizer reports a use after free at its .fsh lines", () => {
  const src = `declare function malloc(size: usize): MutPtr<i64>;
declare function free(p: MutPtr<i64>): void;

function main() {
  const p = unsafe { malloc(8) };
  unsafe {
    p.write(1);
    free(p);
  }
  console.log(unsafe { p.read() });
}
`;
  const { code, err } = run("use-after-free", src, ["--sanitize", "address"]);
  expect(code).not.toBe(0);
  expect(err).toContain("ERROR: AddressSanitizer: heap-use-after-free");
  expect(err).toMatch(/READ of size 8 [^\n]*\n\s+#0 [^\n]* in fsh\.main [^\n]*main\.fsh:10/);
  expect(err).toMatch(/freed by thread T0 here:\n[^\n]*\n\s+#1 [^\n]* in fsh\.main [^\n]*main\.fsh:8/);
});

test.skipIf(noThread !== undefined)("the thread sanitizer reports two tasks racing on raw memory", () => {
  const src = `async function bump(address: usize): Promise<i64> {
  for (let i = 0; i < 100000; i++) {
    unsafe {
      const p = address as MutPtr<i64>;
      p.write(p.read() + 1);
    }
  }
  return 0;
}

async function main() {
  let count = 0;
  const address = unsafe { mutPtrOf(count) as usize };
  const a = spawn(bump(address));
  const b = spawn(bump(address));
  await a;
  await b;
  console.log("done");
}
`;
  const { code, err } = run("race", src, ["--sanitize", "thread"]);
  expect(code).not.toBe(0);
  expect(err).toContain("WARNING: ThreadSanitizer: data race");
  expect(err).toMatch(/#0 fsh\.bump [^\n]*main\.fsh:5/);
});
