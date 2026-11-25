import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Session } from "./compilation.fsh";

// The runtime's `Math` functions: src/runtime/math.cpp over LLVM libc's correctly rounded ones,
// and CORE-MATH's hyperbolic ones, both vendored. Compiling them takes seconds, so each clang
// and target compiles them once into objects in a cache directory, which every program links.
// Each object is named by a hash of the sources, flags, clang and target, so a change to any of
// them builds anew. The C runtime and the JS engine are cached the same way.

// The functions it defines, which an export can't replace.
export const MATH_RUNTIME = ["acos", "acosh", "asin", "asinh", "atan", "atan2", "atanh", "cbrt", "cos", "cosh", "exp", "expm1", "hypot", "log", "log10", "log1p", "log2", "pow", "sin", "sinh", "tan", "tanh"];

// Where the vendored sources and the math runtime's are: `../share/fishc` beside the executable, as
// a release unpacks them, or else the source tree this fishc was built from. Found when a build
// first needs them rather than while compiling, which a compiler built by Fish would otherwise do.
export function sourceRoot(): string {
  const shared = join(dirname(process.execPath), "..", "share", "fishc");
  if (existsSync(join(shared, "vendor"))) return shared;
  return join(import.meta.dir, "..");
}

function vendor(): string {
  return join(sourceRoot(), "vendor");
}

// Without contraction into fused multiply-adds, so every target computes the same steps and the
// exact two-term arithmetic the functions round with stays exact. Position-independent, so a
// shared library can hold them.
function mathSources(): { source: string; flags: string[] }[] {
  const common = ["-O2", "-ffp-contract=off", "-fPIC"];
  const libc = join(vendor(), "llvm-libc", "libc");
  let sources = [{ source: join(sourceRoot(), "src", "runtime", "math.cpp"), flags: ["-x", "c++", "-std=c++17", "-fno-exceptions", "-fno-rtti", `-I${libc}`, ...common] }];
  for (const f of ["acosh", "asinh", "atanh", "cosh", "sinh", "tanh"]) sources.push({ source: join(vendor(), "core-math", "src", "binary64", f, `${f}.c`), flags: ["-x", "c", "-std=c11", ...common] });
  return sources;
}

// FISH_CACHE_DIR, else the user's cache directory, else the system's temporary one.
export function cacheDir(): string {
  const given = process.env.FISH_CACHE_DIR;
  if (given !== undefined && given !== "") return given;
  const xdg = process.env.XDG_CACHE_HOME;
  const home = homedir();
  const base = xdg !== undefined && xdg !== "" ? xdg : home !== "" ? join(home, ".cache") : tmpdir();
  return join(base, "fish");
}

/** @throws {IoError} */
export function files(dir: string): string[] {
  let names = readdirSync(dir);
  names.sort();
  let found: string[] = [];
  for (const name of names) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found = found.concat(files(path));
    else found.push(path);
  }
  return found;
}

// One object clang compiles and the cache keeps: `args` are its flags and input, `stdin` its source
// when the input is `-`, and `inputs` the other files its text depends on, such as headers.
export type Unit = { name: string; args: string[]; stdin?: string; inputs: string[] };

// A session that builds objects as well as compiling, with the caches only building reads.
// `clang`: `clang --version`, which names the target as well as the compiler.
// `digests`: each source a cached object depends on, hashed, by path, size and modification time.
// `mathUnits`: the Math runtime's objects to compile.
export type BuildSession = Session & { clang?: string; digests: Map<string, string>; mathUnits?: Unit[] };

// `session` given the caches building needs, keeping any it already has.
export function buildSession(session: Session & { clang?: string; digests?: Map<string, string>; mathUnits?: Unit[] }): BuildSession {
  return { ...session, digests: session.digests ?? new Map<string, string>() };
}

// `clang --version`, which names the target as well as the compiler, run once a session.
/** @throws {Error | IoError} */
function clangVersion(session: Mut<BuildSession>): string {
  const known = session.clang;
  if (known !== undefined) return known;
  const clang = Bun.spawnSync(["clang", "--version"]);
  if (clang.exitCode !== 0) throw new Error(`clang failed:\n${new TextDecoder().decode(clang.stderr)}`);
  const version = new TextDecoder().decode(clang.stdout);
  session.clang = version;
  return version;
}

// Remembered by size and modification time too, so an edit in a long-lived session is seen.
/** @throws {IoError} */
function digestOf(session: Mut<BuildSession>, path: string): string {
  const { size, mtimeMs } = statSync(path);
  const key = `${path}:${size}:${mtimeMs}`;
  const known = session.digests.get(key);
  if (known !== undefined) return known;
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  session.digests.set(key, digest);
  return digest;
}

// Where a unit's object lives, named by a hash of clang, the target, the flags and every source
// text, so a change to any of them is a new object rather than a stale one.
/** @throws {Error | IoError} */
export function objectPath(session: Mut<BuildSession>, u: Ref<Unit>): string {
  const version = clangVersion(session);
  let hash = createHash("sha256");
  hash.update(version).update(u.args.join("\0")).update("\0").update(u.stdin ?? "").update("\0");
  for (const f of u.inputs) {
    const digest = digestOf(session, f);
    hash.update(f).update(digest);
  }
  return join(cacheDir(), "objects", `${u.name}-${hash.digest("hex").slice(0, 16)}.o`);
}

// Each object is built into a file of its own, then renamed into place, so builds running at
// once never see one half-written, and a failed build leaves nothing behind.
/** @throws {IoError} */
export function partial(out: string): string {
  mkdirSync(dirname(out), { recursive: true });
  return `${out}.${randomUUID()}`;
}

/** @throws {Error | IoError} */
function finish(u: Ref<Unit>, code: i64 | null, stderr: string, temp: string, out: string) {
  if (code !== 0) {
    rmSync(temp, { force: true });
    throw new Error(`clang failed building ${u.name}:\n${stderr}`);
  }
  renameSync(temp, out);
}

const command = (u: Ref<Unit>, temp: string): string[] => ["clang", ...u.args, "-c", "-o", temp];
const input = (u: Ref<Unit>): Uint8Array | undefined => (u.stdin === undefined ? undefined : new TextEncoder().encode(u.stdin));

// Clang runs in an empty directory of its own, since a quoted include in source read from stdin
// is looked for in the working directory, which no key covers.
/** @throws {IoError} */
function emptyDir(): string {
  return mkdtempSync(join(tmpdir(), "fish-cc-"));
}

// What a clang compiling `u` is taken to hold at its peak: clang itself, and its source many times
// over once it is parsed and optimized. The compiler's own units measured 50 to 100 bytes for each
// byte of IR, the most where a few very large functions fill a unit.
const CLANG_BASE = 100_000_000;
const CLANG_PER_BYTE = 100;

function clangBytes(u: Ref<Unit>): i64 {
  return CLANG_BASE + ((u.stdin ?? "").length as i64) * CLANG_PER_BYTE;
}

// This machine's memory in bytes, or 0 when it can't be read.
function machineMemory(): i64 {
  try {
    if (process.platform === "linux") {
      const found = /^MemTotal:\s+(\d+) kB/m.exec(readFileSync("/proc/meminfo", "utf8"));
      return found === null ? 0 : (parseInt(found[1]!) ?? 0) * 1024;
    }
    const asked = Bun.spawnSync(["sysctl", "-n", "hw.memsize"]);
    return asked.exitCode === 0 ? parseInt(new TextDecoder().decode(asked.stdout).trim()) ?? 0 : 0;
  } catch (_e) {
    return 0;
  }
}

const quoted = (s: string): string => "'" + s.replaceAll("'", "'\\''") + "'";

// The units at `wanted` compiled into their places in `outs`, in that order and `jobs` at a time:
// xargs runs a shell script for each, which gives clang the unit's source and keeps its errors
// and exit code in files of the unit's own, and starts the next as one ends. Throws the first
// failure once every object that did compile is in the cache.
/** @throws {Error | IoError} */
function compiledTogether(units: Ref<Unit[]>, outs: Ref<string[]>, wanted: Ref<usize[]>, jobs: usize): void {
  const work = mkdtempSync(join(tmpdir(), "fish-cc-"));
  const cwd = join(work, "empty");
  mkdirSync(cwd);
  try {
    let temps: string[] = [];
    let scripts: string[] = [];
    for (let k: usize = 0; k < wanted.length; k++) {
      const u: Ref<Unit> = units[wanted[k]!]!;
      const temp = partial(outs[wanted[k]!]!);
      temps.push(temp);
      const at = join(work, `${k}`);
      let from = "/dev/null";
      if (u.stdin !== undefined) {
        from = `${at}.in`;
        writeFileSync(from, u.stdin!);
      }
      let words: string[] = [];
      for (const word of command(u, temp)) words.push(quoted(word));
      writeFileSync(`${at}.sh`, `cd ${quoted(cwd)} && ${words.join(" ")} < ${quoted(from)} 2> ${quoted(`${at}.err`)}\necho $? > ${quoted(`${at}.code`)}\n`);
      scripts.push(`${at}.sh`);
    }
    Bun.spawnSync(["xargs", "-0", "-n", "1", "-P", `${jobs}`, "sh"], { stdin: new TextEncoder().encode(scripts.join("\0")) });
    let failed: string | undefined = undefined;
    for (let k: usize = 0; k < wanted.length; k++) {
      const at = join(work, `${k}`);
      const code = existsSync(`${at}.code`) ? parseInt(readFileSync(`${at}.code`, "utf8").trim()) ?? 1 : 1;
      if (code === 0) {
        renameSync(temps[k]!, outs[wanted[k]!]!);
        continue;
      }
      rmSync(temps[k]!, { force: true });
      const stderr = existsSync(`${at}.err`) ? readFileSync(`${at}.err`, "utf8") : "";
      if (failed === undefined) failed = `clang failed building ${units[wanted[k]!]!.name}:\n${stderr}`;
    }
    if (failed !== undefined) throw new Error(failed!);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// The units' objects, in their order, those the cache has none of compiled first: largest first,
// as many at a time as the machine has cores, and no more than the largest that many are taken to
// fit in half its memory, since the first to run together are the largest there are. A build of
// many small files uses every core, and one of a few huge ones stays in memory.
/** @throws {Error | IoError} */
export function cachedObjects(session: Mut<BuildSession>, units: Ref<Unit[]>): string[] {
  let outs: string[] = [];
  let missing: usize[] = [];
  for (let i: usize = 0; i < units.length; i++) {
    const out = objectPath(session, units[i]!);
    if (!existsSync(out)) missing.push(i);
    else if (session.timings !== undefined) session.timings!.objects.cached++;
    outs.push(out);
  }
  if (missing.length === 0) return outs;
  if (session.timings !== undefined) for (const i of missing) session.timings!.objects.built.push(units[i]!.name);
  missing.sort((a, b) => clangBytes(units[b]!) - clangBytes(units[a]!));
  const cores = availableParallelism() as usize;
  const budget = missing.length > 1 ? machineMemory() / 2 : 0;
  let jobs: usize = 1;
  let held = clangBytes(units[missing[0]!]!);
  while (jobs < missing.length && jobs < cores) {
    held += clangBytes(units[missing[jobs]!]!);
    if (held > budget) break;
    jobs++;
  }
  compiledTogether(units, outs, missing, jobs);
  return outs;
}

// One unit's object, compiled first if the cache has none.
/** @throws {Error | IoError} */
export function cachedObject(session: Mut<BuildSession>, u: Ref<Unit>): string {
  return cachedObjects(session, [u.clone()])[0]!;
}

// One unit's object, compiled first if the cache has none, without blocking. A lock file beside the object keeps builds running at once, in
// this process or another, from compiling it twice: the rest wait for it to be there instead.
/** @throws {Error | IoError} */
export async function cachedObjectAsync(session: Mut<BuildSession>, u: Unit): Promise<string> {
  const out = objectPath(session, u);
  return await objectAsync(u, out);
}

// The object at `out`, `objectPath`'s for `u`, compiled first if the cache has none. It reads no
// session, so builds running at once can each wait on their own.
/** @throws {Error | IoError} */
export async function objectAsync(u: Ref<Unit>, out: string): Promise<string> {
  const lock = `${out}.lock`;
  while (!existsSync(out)) {
    if (!claimed(lock)) {
      // ponytail: polled, as no waiting a Bun and a Fish build share is cheaper; a wait on the
      // compile itself if many builds contend.
      await Bun.sleep(20);
      continue;
    }
    try {
      if (!existsSync(out)) await compiledAsync(u, out);
    } catch (e) {
      rmSync(lock, { force: true });
      throw e;
    }
    rmSync(lock, { force: true });
  }
  return out;
}

// Whether this build made the lock and so compiles the object. A lock older than any compile takes
// was left by a build that died, and is cleared for the next try.
/** @throws {IoError} */
function claimed(lock: string): boolean {
  mkdirSync(dirname(lock), { recursive: true });
  try {
    closeSync(openSync(lock, "wx"));
    return true;
  } catch (_e) {
    try {
      if ((Date.now() as f64) - statSync(lock).mtimeMs > 300_000) rmSync(lock, { force: true });
    } catch (_gone) {
      // Removed by its build in the meantime.
    }
    return false;
  }
}

/** @throws {Error | IoError} */
async function compiledAsync(u: Ref<Unit>, out: string): Promise<void> {
  const temp = partial(out);
  const cwd = emptyDir();
  try {
    const clang = Bun.spawn(command(u, temp), { stdin: input(u), stderr: "pipe", cwd });
    const errors = new Response(clang.stderr);
    const [code, stderr] = await Promise.all([clang.exited, errors.text()]);
    finish(u, code, stderr, temp, out);
  } catch (e) {
    rmSync(cwd, { recursive: true, force: true });
    throw e;
  }
  rmSync(cwd, { recursive: true, force: true });
}

/** @throws {IoError} */
function units(session: Mut<BuildSession>): Unit[] {
  const known: Ref<Unit[] | undefined> = session.mathUnits;
  if (known !== undefined) return [...known];
  const inputs = [...files(join(vendor(), "llvm-libc", "libc")), ...files(join(vendor(), "core-math", "src"))];
  // A quoted include is looked for beside its source first, so the source's whole directory is
  // hashed.
  let made: Unit[] = [];
  for (const { source, flags } of mathSources()) made.push({ name: basename(source).replace(/\.\w+$/, ""), args: [...flags, source], inputs: [...files(dirname(source)), ...inputs] });
  session.mathUnits = [...made];
  return made;
}

// The objects to link, built first if this clang and target have none yet. `target` is the
// clang flags of a target other than the host's.
/** @throws {Error | IoError} */
export function mathObjects(session: Mut<BuildSession>, target: string[] = []): string[] {
  let all: Unit[] = [];
  for (const u of units(session)) all.push(target.length === 0 ? u : { ...u, args: [...target, ...u.args] });
  return cachedObjects(session, all);
}

// `mathObjects`, without blocking: every path is found first, then each object compiled in turn.
// ponytail: one at a time, as Fish can't map to promises yet; Promise.all over them once it can.
/** @throws {Error | IoError} */
export async function mathObjectsAsync(session: Mut<BuildSession>): Promise<string[]> {
  const all = units(session);
  let outs: string[] = [];
  for (const u of all) outs.push(objectPath(session, u));
  let objects: string[] = [];
  for (let i: usize = 0; i < all.length; i++) {
    const object = await objectAsync(all[i]!, outs[i]!);
    objects.push(object);
  }
  return objects;
}
