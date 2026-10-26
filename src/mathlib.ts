import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

// The runtime's `Math` functions: src/runtime/math.cpp over LLVM libc's correctly rounded ones,
// and CORE-MATH's hyperbolic ones, both vendored. Compiling them takes seconds, so each clang
// and target compiles them once into objects in a cache directory, which every program links.
// The directory is named by a hash of the sources, flags, clang and target, so a change to any
// of them builds anew.

// The functions it defines, which an export can't replace.
export const MATH_RUNTIME = ["acos", "acosh", "asin", "asinh", "atan", "atan2", "atanh", "cbrt", "cos", "cosh", "exp", "expm1", "hypot", "log", "log10", "log1p", "log2", "pow", "sin", "sinh", "tan", "tanh"];

const VENDOR = join(import.meta.dir, "..", "vendor");
const LLVM_LIBC = join(VENDOR, "llvm-libc", "libc");
const CORE_MATH = join(VENDOR, "core-math");
// Without contraction into fused multiply-adds, so every target computes the same steps and the
// exact two-term arithmetic the functions round with stays exact. Position-independent, so a
// shared library can hold them.
const COMMON = ["-O2", "-ffp-contract=off", "-fPIC"];
const UNITS: { source: string; flags: string[] }[] = [
  { source: join(import.meta.dir, "runtime", "math.cpp"), flags: ["-x", "c++", "-std=c++17", "-fno-exceptions", "-fno-rtti", `-I${LLVM_LIBC}`, ...COMMON] },
  ...["acosh", "asinh", "atanh", "cosh", "sinh", "tanh"].map((f) => ({ source: join(CORE_MATH, "src", "binary64", f, `${f}.c`), flags: ["-x", "c", "-std=c11", ...COMMON] })),
];

// FISH_CACHE_DIR, else the user's cache directory, else the system's temporary one.
function cacheDir(): string {
  if (process.env.FISH_CACHE_DIR) return process.env.FISH_CACHE_DIR;
  const base = process.env.XDG_CACHE_HOME || (homedir() ? join(homedir(), ".cache") : tmpdir());
  return join(base, "fish");
}

function files(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
}

let where: string | undefined;

// The directory holding the objects for this clang and target, whether or not they are built.
function directory(): string {
  if (where) return where;
  const clang = Bun.spawnSync(["clang", "--version"]);
  if (clang.exitCode !== 0) throw new Error(`clang failed:\n${clang.stderr.toString()}`);
  const hash = createHash("sha256").update(clang.stdout);
  for (const u of UNITS) hash.update(u.flags.join(" ")).update(readFileSync(u.source));
  for (const f of [...files(LLVM_LIBC), ...files(join(CORE_MATH, "src"))]) hash.update(f.slice(VENDOR.length)).update(readFileSync(f));
  return (where = join(cacheDir(), `math-${hash.digest("hex").slice(0, 16)}`));
}

const objectOf = (dir: string, source: string) => join(dir, `${basename(source).replace(/\.\w+$/, "")}.o`);

// Each object is built into a file of its own, then renamed into place, so builds running at
// once never see one half-written.
function partial(out: string): string {
  return `${out}.${process.pid}.${Math.random().toString(36).slice(2)}`;
}

function finish(code: number | null, stderr: string, temp: string, out: string) {
  if (code !== 0) {
    rmSync(temp, { force: true });
    throw new Error(`clang failed building the Math runtime:\n${stderr}`);
  }
  renameSync(temp, out);
}

// The objects to link, built first if this clang and target have none yet.
export function mathObjects(): string[] {
  const dir = directory();
  mkdirSync(dir, { recursive: true });
  return UNITS.map(({ source, flags }) => {
    const out = objectOf(dir, source);
    if (existsSync(out)) return out;
    const temp = partial(out);
    const clang = Bun.spawnSync(["clang", ...flags, "-c", source, "-o", temp]);
    finish(clang.exitCode, clang.stderr.toString(), temp, out);
    return out;
  });
}

let building: Promise<string[]> | undefined;

// `mathObjects`, without blocking, built at once and only once however many builds ask.
export function mathObjectsAsync(): Promise<string[]> {
  return (building ??= (async () => {
    const dir = directory();
    mkdirSync(dir, { recursive: true });
    return Promise.all(
      UNITS.map(async ({ source, flags }) => {
        const out = objectOf(dir, source);
        if (existsSync(out)) return out;
        const temp = partial(out);
        const clang = Bun.spawn(["clang", ...flags, "-c", source, "-o", temp], { stderr: "pipe" });
        const [code, stderr] = await Promise.all([clang.exited, new Response(clang.stderr).text()]);
        finish(code, stderr, temp, out);
        return out;
      }),
    );
  })().catch((e) => {
    building = undefined;
    throw e;
  }));
}
