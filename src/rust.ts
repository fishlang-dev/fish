import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Instance } from "./check.ts";
import { validCrate } from "./manifest.ts";
import { cacheDir } from "./mathlib.ts";
import type { RustCrate } from "./modules.ts";
import type { Func } from "./parser.ts";
import type { Type } from "./typing.ts";

// Rust functions reach Fish through a shim crate fishc generates: one `extern "C"` function per
// Rust function the program declares, which catches a panic and hands its message back to the
// call. The shim lives under `cacheDir()/rust/<hash>/`, the hash naming its files, and cargo
// builds it as a static library on every build that needs it: cargo's fingerprints notice what
// changed in the crates, their build scripts and the configuration, and do nothing when nothing did.

// A Rust function: its crate, its path from the crate's root, and the shim's C symbol for it.
export type RustName = { crate: string; path: string; symbol: string };

// The Rust function each function a Rust module declares names. It is kept off the AST, so a
// macro, which sees and makes AST, can't make a function Rust.
export const rustNames = new WeakMap<Func, RustName>();

export const RUST_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// A Rust function's shim symbol, from its crate and path, each part prefixed by its length so
// that no two functions share one, as `fsh_rust_4demo4util3mul` for `demo::util::mul`.
export const rustSymbol = (crate: string, path: string) => `fsh_rust_${[crate.replace(/-/g, "_"), ...path.split("::")].map((p) => `${p.length}${p}`).join("")}`;

// A Rust name the shim or the IR is about to be written from, checked again there, since the
// tree it came through isn't trusted to hold only what the declarations gave.
export function trusted(name: RustName): RustName {
  const { crate, path, symbol } = name;
  if (!validCrate(crate) || !path.split("::").every((p) => RUST_NAME.test(p)) || symbol !== rustSymbol(crate, path)) {
    throw new Error(`internal error: a Rust function's name isn't one a declaration gives: ${JSON.stringify(name)}`);
  }
  return name;
}

// What a program links for the Rust functions it calls: the shim's static library, then the
// system libraries it needs.
export type Shim = { lib: string; links: string[] };

const LIBRARY = "fsh_rust_shim";

// The shim the instances' Rust functions need, built by cargo; none when the program has none.
export function rustShim(crates: RustCrate[], instances: Instance[]): Shim | undefined {
  // One shim function per Rust function, however many declarations name it.
  const called = [...new Map(instances.filter((i) => i.body.rust).map((i) => [trusted(i.body.rust!).symbol, i])).values()];
  if (called.length === 0) return undefined;
  const cargo = Bun.which("cargo");
  if (!cargo) throw new Error("this program calls Rust, which needs cargo to build, and cargo isn't on PATH; install Rust with rustup, from https://rustup.rs");
  const files = { "Cargo.toml": manifest(crates), "src/lib.rs": source(called) };
  const h = createHash("sha256");
  for (const [name, text] of Object.entries(files)) h.update(`${name}\0${text}\0`);
  const dir = join(cacheDir(), "rust", h.digest("hex").slice(0, 16));
  // Written whole beside it and renamed into place, so a build running at once never sees half.
  if (!existsSync(dir)) {
    mkdirSync(join(cacheDir(), "rust"), { recursive: true });
    const temp = mkdtempSync(`${dir}.`);
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(temp, name, ".."), { recursive: true });
      writeFileSync(join(temp, name), text);
    }
    try {
      renameSync(temp, dir);
    } catch {
      rmSync(temp, { recursive: true, force: true });
    }
  }
  const record = join(dir, "links.json");
  let built = cargoBuild(cargo, dir);
  // rustc names the system libraries only when it compiles the shim, which a build before this
  // one did; without that build's record, the shim is compiled again to learn them.
  if (built.links === undefined && !existsSync(record)) {
    const now = new Date();
    utimesSync(join(dir, "src", "lib.rs"), now, now);
    built = cargoBuild(cargo, dir);
  }
  if (built.links !== undefined) {
    const temp = `${record}.${process.pid}`;
    writeFileSync(temp, JSON.stringify(built.links));
    renameSync(temp, record);
  }
  const links = built.links ?? (existsSync(record) ? (JSON.parse(readFileSync(record, "utf8")) as string[]) : undefined);
  if (links === undefined) throw new Error(`cargo didn't say which system libraries the Rust shim in ${dir} needs; build again`);
  return { lib: built.lib, links };
}

// Runs cargo on the shim, its own lock keeping two builds from writing `target/` at once. Gives the
// static library cargo says it made, and the system libraries rustc names when it compiles.
function cargoBuild(cargo: string, dir: string): { lib: string; links?: string[] } {
  const run = Bun.spawnSync([
    cargo, "rustc", "--release", "--lib", "--message-format=json-render-diagnostics", "--manifest-path", join(dir, "Cargo.toml"), "--target-dir", join(dir, "target"),
    "--", "--print", "native-static-libs",
  ], { stdout: "pipe", stderr: "pipe" });
  const stderr = run.stderr.toString();
  if (run.exitCode !== 0) throw new Error(`cargo failed building the Rust shim in ${dir}:\n${stderr}`);
  const lib = run.stdout.toString().split("\n").flatMap((line) => {
    if (!line.startsWith("{")) return [];
    const m = JSON.parse(line) as { reason?: string; target?: { name?: string }; filenames?: string[] };
    return m.reason === "compiler-artifact" && m.target?.name === LIBRARY ? (m.filenames ?? []).filter((f) => f.endsWith(".a")) : [];
  })[0];
  if (lib === undefined || !existsSync(lib)) throw new Error(`cargo built the Rust shim in ${dir} but didn't give its static library`);
  const links = /native-static-libs:(.*)/.exec(stderr)?.[1];
  return { lib, ...(links !== undefined && { links: links.trim().split(/\s+/).filter(Boolean) }) };
}

// The shim's Cargo.toml: a static library depending on each crate as the package lists it, with
// paths taken from the package.
function manifest(crates: RustCrate[]): string {
  const lines = new Map<string, string>();
  for (const { dependency: d, dir } of crates) {
    const fields = [
      d.version !== undefined && `version = ${JSON.stringify(d.version)}`,
      d.path !== undefined && `path = ${JSON.stringify(resolve(dir, d.path))}`,
      d.git !== undefined && `git = ${JSON.stringify(d.git)}`,
      ...(["rev", "tag", "branch"] as const).map((k) => d[k] !== undefined && `${k} = ${JSON.stringify(d[k])}`),
      d.features !== undefined && `features = [${d.features.map((f) => JSON.stringify(f)).join(", ")}]`,
      d.defaultFeatures !== undefined && `default-features = ${d.defaultFeatures}`,
    ].filter(Boolean);
    lines.set(d.name, `${JSON.stringify(d.name)} = { ${fields.join(", ")} }`);
  }
  return [
    "[package]", `name = "${LIBRARY}"`, `version = "0.0.0"`, `edition = "2021"`, "publish = false", "",
    "[lib]", `path = "src/lib.rs"`, `crate-type = ["staticlib"]`, "",
    "[dependencies]", ...[...lines.values()].sort(), "",
    "[profile.release]", `panic = "unwind"`, "",
    // A workspace of its own, so a cache directory inside another one isn't taken for its member.
    "[workspace]", "",
  ].join("\n");
}

const RUST_TYPES: Record<string, string> = { boolean: "bool", void: "()" };

function rustType(t: Type): string {
  return RUST_TYPES[t as string] ?? (t as string);
}

// The shim's source: each function calls its Rust function inside `caught`.
function source(called: Instance[]): string {
  const wrappers = called.map((i) => {
    const { crate, path, symbol } = trusted(i.body.rust!);
    const params = i.signature!.map((t, k) => `a${k}: ${rustType(t)}`);
    const args = i.signature!.map((_, k) => `a${k}`).join(", ");
    const returns = i.returns === "void" ? "" : ` -> ${rustType(i.returns)}`;
    return `#[no_mangle]\npub extern "C" fn ${symbol}(${[...params, "panicked: *mut *mut c_char"].join(", ")})${returns} {\n    caught(panicked, || ::${crate.replace(/-/g, "_")}::${path}(${args}))\n}\n`;
  });
  return `// Generated by fishc: each function calls a Rust function for Fish, as C calls it.
#![allow(non_snake_case)]
use std::os::raw::c_char;
use std::panic::{catch_unwind, set_hook, AssertUnwindSafe};
use std::sync::Once;

extern "C" {
    fn fsh_rt_rust_panicked(out: *mut *mut c_char, message: *const u8, length: usize);
}

// Runs f, a panic in it handed to the runtime for the call to raise as a Fish panic. Rust's own
// report of the panic is silenced, since Fish reports it at the call.
fn caught<T: Default>(out: *mut *mut c_char, f: impl FnOnce() -> T) -> T {
    static QUIET: Once = Once::new();
    QUIET.call_once(|| set_hook(Box::new(|_| {})));
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(value) => value,
        Err(payload) => {
            let message = payload.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| payload.downcast_ref::<String>().cloned()).unwrap_or_else(|| "a Rust panic with no message".to_string());
            unsafe { fsh_rt_rust_panicked(out, message.as_ptr(), message.len()) };
            // Dropping the payload could panic again, inside a function C called, which aborts.
            std::mem::forget(payload);
            T::default()
        }
    }
}

${wrappers.join("\n")}`;
}
