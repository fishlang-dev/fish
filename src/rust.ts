import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Instance } from "./check.ts";
import { validCrate } from "./manifest.ts";
import { cacheDir } from "./mathlib.ts";
import type { RustCrate } from "./modules.ts";
import type { ClassMember, ClassNode, Func } from "./parser.ts";
import type { ClassType, Type } from "./typing.ts";
import { WeakNodeMap } from "./nodes.ts";

// Rust functions reach Fish through a shim crate fishc generates: one `extern "C"` function per
// Rust function the program declares, which catches a panic and hands its message back to the
// call. The shim lives under `cacheDir()/rust/<hash>/`, the hash naming its files, and cargo
// builds it as a static library on every build that needs it: cargo's fingerprints notice what
// changed in the crates, their build scripts and the configuration, and do nothing when nothing did.

// A Rust function: its crate, its path from the crate's root, and the shim's C symbol for it.
export type RustName = { crate: string; path: string; symbol: string };

// The Rust function each function, constructor and method a Rust module declares names. It is
// kept off the AST, so a macro, which sees and makes AST, can't make a function Rust.
export const rustNames = new WeakNodeMap<Func | ClassMember, RustName>();

// A Rust type a class names: its crate and its path from the crate's root. Fish moves its values
// between threads, so it must be Send, which the shim asserts.
export type RustClass = { crate: string; path: string; name: string };

// The Rust type of each class a Rust module declares, by its declaration, and by its type once
// the checker has one.
export const rustClassNodes = new WeakNodeMap<ClassNode, RustClass>();
export const rustClasses = new WeakMap<ClassType, RustClass>();

// The field a handle's class holds its boxed Rust value in.
export const HANDLE = "#handle";

// The Rust type a type is, when it is one.
export const rustClassOf = (t: Type): RustClass | undefined => (typeof t !== "string" && t.kind === "class" ? rustClasses.get(t) : undefined);

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

// The symbol of the shim function that drops a Rust type's boxed value. No member's symbol ends
// so, since each of a symbol's parts is spelled after its length.
export const dropSymbol = (c: RustClass) => `${trusted({ crate: c.crate, path: c.path, symbol: rustSymbol(c.crate, c.path) }).symbol}_drop`;

// What a program links for the Rust functions it calls: the shim's static library, then the
// system libraries it needs.
export type Shim = { lib: string; links: string[] };

const LIBRARY = "fsh_rust_shim";

// The shim the instances' Rust functions need, built by cargo; none when the program has none.
export function rustShim(crates: RustCrate[], instances: Instance[]): Shim | undefined {
  // One shim function per Rust function, however many declarations name it.
  // The first declaration of each, as code generation declares it; the checker makes the rest agree.
  const called = [...instances.filter((i) => i.body.rust).reduce((seen, i) => (seen.has(trusted(i.body.rust!).symbol) ? seen : seen.set(i.body.rust!.symbol, i)), new Map<string, Instance>()).values()];
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

// How a Fish value crosses the Rust boundary: a number or boolean as itself, a Rust type as the
// pointer to its box, owned or lent, a string as a pointer to Fish's string, an Option as one of
// those that may be empty, and an array as its elements, owned or lent.
export type Crossing =
  | { kind: "plain"; type: Type }
  | { kind: "handle"; of: RustClass }
  | { kind: "lent"; of: RustClass; mutable: boolean }
  | { kind: "string" }
  | { kind: "option"; of: Crossing; inner: Type }
  | { kind: "array"; element: Crossing; elementType: Type; lent: boolean };

// How a type crosses as a parameter, or as what a function gives, or why it can't yet.
export function crossingOf(t: Type, giving: boolean): Crossing | string {
  if (t === "boolean" || (typeof t === "string" && t !== "void" && t !== "string" && t !== "null" && t !== "never")) return { kind: "plain", type: t };
  if (t === "string") return { kind: "string" };
  if (typeof t === "string") return `a '${t}' can't cross the Rust boundary`;
  const rust = rustClassOf(t);
  if (rust) return { kind: "handle", of: rust };
  if (t.kind === "ref") {
    if (giving) return "a borrow's lifetime can't cross from Rust yet; give the value itself";
    const lent = rustClassOf(t.to);
    if (lent) return { kind: "lent", of: lent, mutable: t.mutable };
    if (typeof t.to !== "string" && t.to.kind === "array") {
      if (t.mutable) return "'Mut<T[]>' would be '&mut [T]', which can't cross yet; pass the array, which moves it";
      return arrayCrossing(t.to.element, true);
    }
    return "only Rust types and arrays can be lent to Rust";
  }
  if (t.kind === "union") {
    const others = t.members.filter((m) => m !== "null");
    if (!t.members.includes("null") || others.length !== 1) return "unions other than 'T | null' can't cross the Rust boundary yet; Rust enums other than Option and Result aren't supported";
    const of = crossingOf(others[0]!, giving);
    if (typeof of === "string") return of;
    if (of.kind === "lent" || of.kind === "option") return "an Option can't hold a borrow or another Option across the Rust boundary yet";
    return { kind: "option", of, inner: others[0]! };
  }
  if (t.kind === "array") return arrayCrossing(t.element, false);
  if (t.kind === "object" && t.tuple) return "tuples can't cross the Rust boundary yet";
  if (t.kind === "map") return "maps can't cross the Rust boundary yet";
  return "it can't cross the Rust boundary yet; Rust functions take and give numbers, booleans, strings, arrays, Options of those and Rust types";
}

function arrayCrossing(element: Type, lent: boolean): Crossing | string {
  const of = crossingOf(element, false);
  if (typeof of === "string") return of;
  if (of.kind === "array") return "arrays of arrays can't cross the Rust boundary yet";
  if (of.kind !== "plain" && of.kind !== "string" && of.kind !== "handle") return "an array crossing the Rust boundary holds numbers, booleans, strings or Rust types";
  if (lent && of.kind === "handle") return "a slice of Rust values can't be lent, since Fish holds each in its own box; pass the array, which moves them";
  return { kind: "array", element: of, elementType: element, lent };
}

// A crossing the checker allowed, which code generation trusts.
export function crossed(t: Type, giving = false): Crossing {
  const c = crossingOf(t, giving);
  if (typeof c === "string") throw new Error(`internal error: a '${t}' reached the Rust boundary: ${c}`);
  return c;
}

// A Rust type's path in the shim, from the crate's root.
function typePath(c: RustClass): string {
  trusted({ crate: c.crate, path: c.path, symbol: rustSymbol(c.crate, c.path) });
  return `::${c.crate.replace(/-/g, "_")}::${c.path}`;
}

// The C parameters of the shim a crossing value takes, as Rust declares them.
function rustParams(c: Crossing, name: string): string[] {
  switch (c.kind) {
    case "plain":
      return [`${name}: ${RUST_TYPES[c.type as string] ?? c.type}`];
    case "handle":
    case "lent":
      return [`${name}: *mut ${typePath(c.of)}`];
    case "string":
      return [`${name}: *const FishStr`];
    case "array":
      return [`${name}: *const u8`, `${name}_n: i64`];
    case "option":
      return c.of.kind === "plain" || c.of.kind === "array" ? [`${name}_some: bool`, ...rustParams(c.of, name)] : rustParams(c.of, name);
  }
}

// The statement making what a parameter is held as during the call, if it needs holding.
function holder(c: Crossing, name: string): string | undefined {
  const elements = (e: Crossing) => (e.kind === "string" ? `slice::<*const FishStr>(${name}, ${name}_n).iter().map(|&s| from_fish(s)).collect::<Vec<String>>()`
    : e.kind === "handle" ? `slice::<*mut ${typePath(e.of)}>(${name}, ${name}_n).iter().map(|&p| *Box::from_raw(p)).collect::<Vec<_>>()`
    : `slice::<${RUST_TYPES[(e as { type: string }).type] ?? (e as { type: string }).type}>(${name}, ${name}_n)`);
  switch (c.kind) {
    case "string":
      return `let mut ${name}_h = text_of(${name});`;
    case "array":
      if (c.lent && c.element.kind === "plain") return `let mut ${name}_h = Lent { slice: ${elements(c.element)}, vec: std::cell::OnceCell::new() };`;
      return `let mut ${name}_h = ${elements(c.element)}${c.element.kind === "plain" ? ".to_vec()" : ""};`;
    case "option": {
      if (c.of.kind === "string") return `let mut ${name}_h = if ${name}.is_null() { None } else { Some(text_of(${name})) };`;
      if (c.of.kind === "array") return `let mut ${name}_h = if ${name}_some { Some(${elements((c.of as { element: Crossing }).element)}${(c.of as { element: Crossing }).element.kind === "plain" ? ".to_vec()" : ""}) } else { None };`;
      return undefined;
    }
    default:
      return undefined;
  }
}

// The Rust expression a parameter is given as.
function argument(c: Crossing, name: string): string {
  switch (c.kind) {
    case "plain":
      return name;
    case "handle":
      return `*Box::from_raw(${name})`;
    case "lent":
      return `${c.mutable ? "lend_mut" : "lend"}(${name}, &scope)`;
    case "string":
    case "array":
      return `Take::take(&mut ${name}_h)`;
    case "option":
      if (c.of.kind === "plain") return `if ${name}_some { Some(${name}) } else { None }`;
      if (c.of.kind === "handle") return `if ${name}.is_null() { None } else { Some(*Box::from_raw(${name})) }`;
      return `Take::take(&mut ${name}_h)`;
  }
}

// The shim's Rust return type, and its out-parameter, for what a function gives.
function rustGives(c: Crossing | undefined): { returns: string; out?: string } {
  if (!c) return { returns: "" };
  switch (c.kind) {
    case "plain":
      return { returns: ` -> ${RUST_TYPES[c.type as string] ?? c.type}` };
    case "handle":
      return { returns: ` -> *mut ${typePath(c.of)}` };
    case "string":
      return { returns: " -> *mut FishStr" };
    case "array":
      return { returns: "", out: "out: *mut FishArray" };
    case "option":
      if (c.of.kind === "plain") return { returns: " -> bool", out: `out: *mut ${RUST_TYPES[c.of.type as string] ?? c.of.type}` };
      if (c.of.kind === "array") return { returns: " -> bool", out: "out: *mut FishArray" };
      return { returns: c.of.kind === "string" ? " -> *mut FishStr" : ` -> *mut ${typePath((c.of as { of: RustClass }).of)}` };
    case "lent":
      throw new Error("internal error: a borrow given by Rust");
  }
}

// What the shim gives back for the Rust value `r`.
function given(c: Crossing | undefined, r: string): string {
  if (!c) return r;
  // Each element is typed from the Fish declaration, which fixes how the array is laid out, so a
  // Rust sequence of anything else is cargo's type error.
  const array = (e: Crossing, v: string) => `give_array(${v}, out, ${e.kind === "string" ? "|s| GiveStr::give(s) as *mut u8"
    : e.kind === "handle" ? `|v: ${typePath(e.of)}| handle(v) as *mut u8` : `|v: ${RUST_TYPES[(e as { type: string }).type] ?? (e as { type: string }).type}| v`})`;
  switch (c.kind) {
    case "plain":
      return r;
    case "handle":
      return `handle(${r})`;
    case "string":
      return `GiveStr::give(${r})`;
    case "array":
      return array(c.element, r);
    case "option":
      if (c.of.kind === "plain") return `match ${r} { Some(v) => { *out = v; true } None => false }`;
      if (c.of.kind === "array") return `match ${r} { Some(v) => { ${array((c.of as { element: Crossing }).element, "v")}; true } None => false }`;
      if (c.of.kind === "string") return `match ${r} { Some(s) => GiveStr::give(s), None => std::ptr::null_mut() }`;
      return `match ${r} { Some(v) => handle(v), None => std::ptr::null_mut() }`;
    case "lent":
      throw new Error("internal error: a borrow given by Rust");
  }
}

// The Rust types a crossing names, for their drops and Send assertions.
function classesIn(c: Crossing): RustClass[] {
  return c.kind === "handle" || c.kind === "lent" ? [c.of] : c.kind === "option" ? classesIn(c.of) : c.kind === "array" ? classesIn(c.element) : [];
}

// The shim's source: each function calls its Rust function inside `caught`, its parameters
// converted to what Rust's inference picks among the forms each crossing allows; each Rust type
// gets a drop function and an assertion that it is Send.
function source(called: Instance[]): string {
  const types = new Map<string, RustClass>();
  const note = (c: RustClass) => types.set(typePath(c), c);
  const wrappers = called.map((i) => {
    const { crate, path, symbol } = trusted(i.body.rust!);
    const owner = i.body.owner && rustClassOf(i.body.owner);
    const self = owner && i.body.self && !i.body.self.constructor ? i.body.self : undefined;
    const constructor = owner && i.body.self?.constructor;
    if (owner) note(owner);
    const crossings = i.signature!.map((t) => crossed(t));
    const gives = constructor ? crossed(i.body.owner!, true) : i.returns === "void" ? undefined : crossed(i.returns, true);
    [...crossings, ...(gives ? [gives] : [])].flatMap(classesIn).forEach(note);
    const { returns, out } = rustGives(gives);
    // A `Result`'s `Err` goes to its own slot, as Fish's text for an `Error`, or as the Rust value.
    const error = i.throws && rustClassOf(i.throws);
    if (error) note(error);
    const err = i.throws ? `err: *mut *mut u8` : undefined;
    const params = [...(self ? [`this: *mut ${typePath(owner!)}`] : []), ...crossings.flatMap((c, k) => rustParams(c, `a${k}`)), ...(out ? [out] : []), ...(err ? [err] : []), "panicked: *mut *mut c_char"];
    const holders = crossings.flatMap((c, k) => holder(c, `a${k}`) ?? []);
    const receiver = self ? [self.owned ? "*Box::from_raw(this)" : self.mutable ? "lend_mut(this, &scope)" : "lend(this, &scope)"] : [];
    const args = [...receiver, ...crossings.map((c, k) => argument(c, `a${k}`))].join(", ");
    const call = `::${crate.replace(/-/g, "_")}::${path}(${args})`;
    const fallible = i.throws ? `match ${call} {\n            Ok(v) => ${given(gives, "v")},\n            Err(e) => {\n                *err = ${error ? `handle::<${typePath(error)}>(e) as *mut u8` : "GiveStr::give(e.to_string()) as *mut u8"};\n                std::mem::zeroed()\n            }\n        }` : given(gives, call);
    // Every reference made from a pointer Fish gave lives only as long as \`scope\`, the call.
    const body = ["let scope = ();", ...holders, fallible].join("\n        ");
    return `#[no_mangle]\npub extern "C" fn ${symbol}(${params.join(", ")})${returns} {\n    caught(panicked, || unsafe {\n        ${body}\n    })\n}\n`;
  });
  const drops = [...types.values()].map((c) => {
    const at = typePath(c);
    const send = `const _: fn() = || {\n    fn send<T: Send + 'static>() {}\n    send::<${at}>();\n};\n\n`;
    return `${send}#[no_mangle]\npub extern "C" fn ${dropSymbol(c)}(this: *mut ${at}, panicked: *mut *mut c_char) {\n    if !this.is_null() {\n        caught(panicked, || unsafe { drop(Box::from_raw(this)) })\n    }\n}\n`;
  });
  return `${PRELUDE}\n${[...wrappers, ...drops].join("\n")}`;
}

const PRELUDE = `// Generated by fishc: each function calls a Rust function for Fish, as C calls it.
#![allow(non_snake_case, unused_unsafe, unused_mut, dead_code)]
use std::os::raw::c_char;
use std::panic::{catch_unwind, set_hook, AssertUnwindSafe};
use std::sync::Once;

// Fish's own string, which only the runtime looks inside.
#[repr(C)]
pub struct FishStr {
    _private: [u8; 0],
}

// A Fish array: its elements' buffer, from Fish's allocator, its length and its capacity.
#[repr(C)]
pub struct FishArray {
    data: *mut u8,
    length: i64,
    capacity: i64,
}

extern "C" {
    fn fsh_rt_rust_panicked(out: *mut *mut c_char, message: *const u8, length: usize);
    fn fsh_rt_rust_str_bytes(s: *const FishStr, length: *mut i64) -> *const u8;
    fn fsh_rt_rust_str(bytes: *const u8, length: i64) -> *mut FishStr;
    fn fsh_rt_alloc(size: i64) -> *mut u8;
}

// Runs f, a panic in it handed to the runtime for the call to raise as a Fish panic, and zero
// given back instead, which the call never reads. Rust's own report of the panic is silenced,
// since Fish reports it at the call.
fn caught<T>(out: *mut *mut c_char, f: impl FnOnce() -> T) -> T {
    static QUIET: Once = Once::new();
    QUIET.call_once(|| set_hook(Box::new(|_| {})));
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(value) => value,
        Err(payload) => {
            let message = payload.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| payload.downcast_ref::<String>().cloned()).unwrap_or_else(|| "a Rust panic with no message".to_string());
            unsafe { fsh_rt_rust_panicked(out, message.as_ptr(), message.len()) };
            // Dropping the payload could panic again, inside a function C called, which aborts.
            std::mem::forget(payload);
            // Only numbers, booleans, () and pointers are given, for each of which zero is a value.
            unsafe { std::mem::zeroed() }
        }
    }
}

// A reference to what a pointer from Fish points at, a receiver or a lent Rust value, borrowed
// only for the call that \`scope\` stands for: a raw pointer's referent would otherwise be
// borrowed for as long as Rust likes, \`'static\` included, and a value keeping it could escape.
unsafe fn lend<'a, T>(p: *mut T, _scope: &'a ()) -> &'a T {
    &*p
}
unsafe fn lend_mut<'a, T>(p: *mut T, _scope: &'a ()) -> &'a mut T {
    &mut *p
}

// A Rust value boxed as a Fish handle. Fish keeps it as long as it likes, so it can't borrow
// anything, least of all what the call was given: a Rust value that does is cargo's error here.
fn handle<T: 'static>(v: T) -> *mut T {
    Box::into_raw(Box::new(v))
}

// A Fish array's elements, which an empty one may have no buffer for.
unsafe fn slice<T>(p: *const u8, n: i64) -> &'static [T] {
    if n == 0 { &[] } else { std::slice::from_raw_parts(p as *const T, n as usize) }
}

// A Fish string as Rust text. Fish strings are WTF-8, so a lone surrogate becomes U+FFFD, as
// TextEncoder makes it.
unsafe fn from_fish(s: *const FishStr) -> String {
    let mut n = 0i64;
    let p = fsh_rt_rust_str_bytes(s, &mut n);
    let bytes = if n == 0 { &[][..] } else { std::slice::from_raw_parts(p, n as usize) };
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_owned();
    }
    let mut fixed = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 0xED && i + 2 < bytes.len() && bytes[i + 1] >= 0xA0 {
            fixed.extend_from_slice("\\u{FFFD}".as_bytes());
            i += 3;
        } else {
            fixed.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&fixed).into_owned()
}

// A Fish string as Rust text for one call: Fish's own bytes when they are UTF-8, which the call
// borrows, a copy only when a lone surrogate had to be replaced, and a String made only for a
// Rust \`String\` or \`&String\`.
struct Text {
    text: std::borrow::Cow<'static, str>,
    owned: std::cell::OnceCell<String>,
}
unsafe fn text_of(s: *const FishStr) -> Text {
    let mut n = 0i64;
    let p = fsh_rt_rust_str_bytes(s, &mut n);
    let bytes: &'static [u8] = if n == 0 { &[] } else { std::slice::from_raw_parts(p, n as usize) };
    let text = match std::str::from_utf8(bytes) {
        Ok(text) => std::borrow::Cow::Borrowed(text),
        Err(_) => std::borrow::Cow::Owned(from_fish(s)),
    };
    Text { text, owned: std::cell::OnceCell::new() }
}

// What a parameter is held as for the call, given as each Rust type it may be declared as;
// Rust's inference picks the one the function takes.
trait Take<'a, H> {
    fn take(h: &'a mut H) -> Self;
}
impl<'a> Take<'a, Text> for String {
    fn take(h: &'a mut Text) -> Self { std::mem::take(&mut h.text).into_owned() }
}
impl<'a> Take<'a, Text> for &'a str {
    fn take(h: &'a mut Text) -> Self { &h.text }
}
impl<'a> Take<'a, Text> for &'a String {
    fn take(h: &'a mut Text) -> Self { h.owned.get_or_init(|| h.text.to_string()) }
}
impl<'a, H, T: Take<'a, H>> Take<'a, Option<H>> for Option<T> {
    fn take(h: &'a mut Option<H>) -> Self { h.as_mut().map(T::take) }
}
impl<'a, T> Take<'a, Vec<T>> for Vec<T> {
    fn take(h: &'a mut Vec<T>) -> Self { std::mem::take(h) }
}
impl<'a, T> Take<'a, Vec<T>> for Box<[T]> {
    fn take(h: &'a mut Vec<T>) -> Self { std::mem::take(h).into_boxed_slice() }
}
impl<'a, T> Take<'a, Vec<T>> for &'a [T] {
    fn take(h: &'a mut Vec<T>) -> Self { h.as_slice() }
}
impl<'a, T> Take<'a, Vec<T>> for &'a Vec<T> {
    fn take(h: &'a mut Vec<T>) -> Self { h }
}

// A lent array of numbers or booleans, Fish's own elements, copied only for a Rust \`&Vec<T>\`.
struct Lent<T: 'static> {
    slice: &'static [T],
    vec: std::cell::OnceCell<Vec<T>>,
}
impl<'a, T: Copy> Take<'a, Lent<T>> for &'a [T] {
    fn take(h: &'a mut Lent<T>) -> Self { h.slice }
}
impl<'a, T: Copy> Take<'a, Lent<T>> for &'a Vec<T> {
    fn take(h: &'a mut Lent<T>) -> Self { h.vec.get_or_init(|| h.slice.to_vec()) }
}

// A Rust string given to Fish, as each Rust type it may be.
trait GiveStr {
    fn give(self) -> *mut FishStr;
}
impl GiveStr for &str {
    fn give(self) -> *mut FishStr { unsafe { fsh_rt_rust_str(self.as_ptr(), self.len() as i64) } }
}
impl GiveStr for String {
    fn give(self) -> *mut FishStr { self.as_str().give() }
}
impl GiveStr for &String {
    fn give(self) -> *mut FishStr { self.as_str().give() }
}
impl GiveStr for Box<str> {
    fn give(self) -> *mut FishStr { (&*self).give() }
}
impl GiveStr for std::borrow::Cow<'_, str> {
    fn give(self) -> *mut FishStr { (&*self).give() }
}

// A Rust sequence given to Fish as an array, as each Rust type it may be.
trait GiveVec<T> {
    fn into_vec(self) -> Vec<T>;
}
impl<T> GiveVec<T> for Vec<T> {
    fn into_vec(self) -> Vec<T> { self }
}
impl<T> GiveVec<T> for Box<[T]> {
    fn into_vec(self) -> Vec<T> { self.into_vec() }
}

// Writes a Rust sequence into a Fish array, each element made by \`each\`, in a buffer from Fish's
// allocator, so Fish frees it.
unsafe fn give_array<T, E, V: GiveVec<T>>(v: V, out: *mut FishArray, each: impl Fn(T) -> E) {
    let items: Vec<E> = v.into_vec().into_iter().map(each).collect();
    let n = items.len();
    let data = if n == 0 { std::ptr::null_mut() } else { fsh_rt_alloc((n * std::mem::size_of::<E>()) as i64) };
    if n > 0 {
        std::ptr::copy_nonoverlapping(items.as_ptr() as *const u8, data, n * std::mem::size_of::<E>());
    }
    *out = FishArray { data, length: n as i64, capacity: n as i64 };
}
`;
