import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Session } from "./compilation.ts";

// The runtime's `Math` functions: src/runtime/math.cpp over LLVM libc's correctly rounded ones,
// and CORE-MATH's hyperbolic ones, both vendored. Compiling them takes seconds, so each clang
// and target compiles them once into objects in a cache directory, which every program links.
// Each object is named by a hash of the sources, flags, clang and target, so a change to any of
// them builds anew. The C runtime and the JS engine are cached the same way.

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
export function cacheDir(): string {
  if (process.env.FISH_CACHE_DIR) return process.env.FISH_CACHE_DIR;
  const base = process.env.XDG_CACHE_HOME || (homedir() ? join(homedir(), ".cache") : tmpdir());
  return join(base, "fish");
}

export function files(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
}

// One object clang compiles and the cache keeps: `args` are its flags and input, `stdin` its source
// when the input is `-`, and `inputs` the other files its text depends on, such as headers.
export type Unit = { name: string; args: string[]; stdin?: string; inputs: string[] };

// `clang --version`, which names the target as well as the compiler, run once a session.
function clangVersion(session: Session): string {
  if (session.clang !== undefined) return session.clang;
  const clang = Bun.spawnSync(["clang", "--version"]);
  if (clang.exitCode !== 0) throw new Error(`clang failed:\n${clang.stderr.toString()}`);
  return (session.clang = clang.stdout.toString());
}

// Remembered by size and modification time too, so an edit in a long-lived session is seen.
function digestOf({ digests }: Session, path: string): string {
  const { size, mtimeMs } = statSync(path);
  const key = `${path}:${size}:${mtimeMs}`;
  let digest = digests.get(key);
  if (digest === undefined) digests.set(key, (digest = createHash("sha256").update(readFileSync(path)).digest("hex")));
  return digest;
}

// Where a unit's object lives, named by a hash of clang, the target, the flags and every source
// text, so a change to any of them is a new object rather than a stale one.
function objectPath(session: Session, u: Unit): string {
  const hash = createHash("sha256").update(clangVersion(session)).update(u.args.join("\0")).update("\0").update(u.stdin ?? "").update("\0");
  for (const f of u.inputs) hash.update(f).update(digestOf(session, f));
  return join(cacheDir(), "objects", `${u.name}-${hash.digest("hex").slice(0, 16)}.o`);
}

// Each object is built into a file of its own, then renamed into place, so builds running at
// once never see one half-written, and a failed build leaves nothing behind.
export function partial(out: string): string {
  mkdirSync(dirname(out), { recursive: true });
  return `${out}.${process.pid}.${Math.random().toString(36).slice(2)}`;
}

function finish(u: Unit, code: number | null, stderr: string, temp: string, out: string) {
  if (code !== 0) {
    rmSync(temp, { force: true });
    throw new Error(`clang failed building ${u.name}:\n${stderr}`);
  }
  renameSync(temp, out);
}

const command = (u: Unit, temp: string) => ["clang", ...u.args, "-c", "-o", temp];
const input = (u: Unit) => (u.stdin === undefined ? undefined : new TextEncoder().encode(u.stdin));

// Clang runs in an empty directory of its own, since a quoted include in source read from stdin
// is looked for in the working directory, which no key covers.
const emptyDir = () => mkdtempSync(join(tmpdir(), "fish-cc-"));

// The unit's object, compiled first if the cache has none.
export function cachedObject(session: Session, u: Unit): string {
  const out = objectPath(session, u);
  if (existsSync(out)) return out;
  const temp = partial(out);
  const cwd = emptyDir();
  try {
    const clang = Bun.spawnSync(command(u, temp), { stdin: input(u), cwd });
    finish(u, clang.exitCode, clang.stderr.toString(), temp, out);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
  return out;
}

// `cachedObject`, without blocking, each object compiled only once however many of a session's
// builds ask.
export function cachedObjectAsync(session: Session, u: Unit): Promise<string> {
  const { compiling } = session;
  const out = objectPath(session, u);
  if (existsSync(out)) return Promise.resolve(out);
  let done = compiling.get(out);
  if (!done) {
    done = (async () => {
      const temp = partial(out);
      const cwd = emptyDir();
      try {
        const clang = Bun.spawn(command(u, temp), { stdin: input(u), stderr: "pipe", cwd });
        const [code, stderr] = await Promise.all([clang.exited, new Response(clang.stderr).text()]);
        finish(u, code, stderr, temp, out);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
      return out;
    })().finally(() => compiling.delete(out));
    compiling.set(out, done);
  }
  return done;
}

function units(session: Session): Unit[] {
  if (session.mathUnits) return session.mathUnits;
  const inputs = [...files(LLVM_LIBC), ...files(join(CORE_MATH, "src"))];
  // A quoted include is looked for beside its source first, so the source's whole directory is
  // hashed.
  session.mathUnits = UNITS.map(({ source, flags }) => ({ name: basename(source).replace(/\.\w+$/, ""), args: [...flags, source], inputs: [...files(dirname(source)), ...inputs] }));
  return session.mathUnits;
}

// The objects to link, built first if this clang and target have none yet.
export function mathObjects(session: Session): string[] {
  return units(session).map((u) => cachedObject(session, u));
}

// `mathObjects`, without blocking.
export function mathObjectsAsync(session: Session): Promise<string[]> {
  return Promise.all(units(session).map((u) => cachedObjectAsync(session, u)));
}
