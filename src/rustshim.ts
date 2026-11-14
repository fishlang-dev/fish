import type { Tables } from "./compilation.ts";
import { bodyOf } from "./arenas.ts";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { InstanceId } from "./arenas.ts";
import type { Checked } from "./check.ts";
import type { Body } from "./classes.ts";
import type { Type } from "./typing.ts";
import { cacheDir } from "./mathlib.ts";
import type { RustDependency } from "./manifest.ts";
import type { RustCrate } from "./modules.ts";
import { crossed, dropSymbol, rustClassOf, rustSymbol, trusted, type Crossing, type RustClass, type RustName } from "./rust.ts";

// Rust functions reach Fish through a shim crate fishc generates: one `extern "C"` function per
// Rust function the program declares, which catches a panic and hands its message back to the
// call. The shim lives under `cacheDir()/rust/<hash>/`, the hash naming its files, and cargo
// builds it as a static library on every build that needs it: cargo's fingerprints notice what
// changed in the crates, their build scripts and the configuration, and do nothing when nothing did.

// What a program links for the Rust functions it calls: the shim's static library, then the
// system libraries it needs.
export type Shim = { lib: string; links: string[] };

const LIBRARY = "fsh_rust_shim";

// The shim the instances' Rust functions need, built by cargo; none when the program has none.
/** @throws {Error | IoError | JsonError} */
export function rustShim(crates: Ref<RustCrate[]>, checked: Ref<Checked>): Shim | undefined {
  const tables: Ref<Tables> = checked.tables;
  // One shim function per Rust function, however many declarations name it.
  // The first declaration of each, as code generation declares it; the checker makes the rest agree.
  let seen = new Map<string, InstanceId>();
  for (const id of checked.instances) {
    const rust: Ref<RustName | undefined> = bodyOf(tables.arenas, tables.arenas.instanceOf(id)).rust;
    if (rust !== undefined && !seen.has(trusted(rust).symbol)) seen.set(rust.symbol, id);
  }
  const called = [...seen.values()];
  if (called.length === 0) return undefined;
  const cargo = Bun.which("cargo");
  if (cargo === null) throw new Error("this program calls Rust, which needs cargo to build, and cargo isn't on PATH; install Rust with rustup, from https://rustup.rs");
  const files: [string, string][] = [["Cargo.toml", manifest(crates)], ["src/lib.rs", source(tables, called)]];
  let h = createHash("sha256");
  for (const [name, text] of files) h.update(`${name}\0${text}\0`);
  const dir = join(cacheDir(), "rust", h.digest("hex").slice(0, 16));
  // Written whole beside it and renamed into place, so a build running at once never sees half.
  if (!existsSync(dir)) {
    mkdirSync(join(cacheDir(), "rust"), { recursive: true });
    const temp = mkdtempSync(`${dir}.`);
    for (const [name, text] of files) {
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
    const now = Date.now();
    utimesSync(join(dir, "src", "lib.rs"), new Date(now), new Date(now));
    built = cargoBuild(cargo, dir);
  }
  if (built.links !== undefined) {
    const temp = `${record}.${process.pid}`;
    writeFileSync(temp, JSON.stringify(built.links));
    renameSync(temp, record);
  }
  const links = built.links !== undefined ? built.links : existsSync(record) ? JSON.parse<string[]>(readFileSync(record, "utf8")) : undefined;
  if (links === undefined) throw new Error(`cargo didn't say which system libraries the Rust shim in ${dir} needs; build again`);
  return { lib: built.lib, links };
}

// Runs cargo on the shim, its own lock keeping two builds from writing `target/` at once. Gives the
// static library cargo says it made, and the system libraries rustc names when it compiles.
/** @throws {Error | IoError | JsonError} */
function cargoBuild(cargo: string, dir: string): { lib: string; links?: string[] } {
  const run = Bun.spawnSync([
    cargo, "rustc", "--release", "--lib", "--message-format=json-render-diagnostics", "--manifest-path", join(dir, "Cargo.toml"), "--target-dir", join(dir, "target"),
    "--", "--print", "native-static-libs",
  ], { stdout: "pipe", stderr: "pipe" });
  const stderr = new TextDecoder().decode(run.stderr);
  if (run.exitCode !== 0) throw new Error(`cargo failed building the Rust shim in ${dir}:\n${stderr}`);
  let lib: string | undefined = undefined;
  for (const line of new TextDecoder().decode(run.stdout).split("\n")) {
    if (!line.startsWith("{")) continue;
    const m = JSON.parse<CargoMessage>(line);
    const target = m.target;
    if (lib !== undefined || m.reason !== "compiler-artifact" || target === undefined || target.name !== LIBRARY || m.filenames === undefined) continue;
    lib = m.filenames.find((f) => f.endsWith(".a"));
  }
  if (lib === undefined || !existsSync(lib)) throw new Error(`cargo built the Rust shim in ${dir} but didn't give its static library`);
  const found = /native-static-libs:(.*)/.exec(stderr);
  const links = found === null ? undefined : found[1];
  if (links === undefined) return { lib };
  return { lib, links: links.trim().split(/\s+/).filter((l) => l !== "") };
}

// The fields of a line of cargo's JSON messages the build reads.
type CargoMessage = { reason?: string; target?: { name?: string }; filenames?: string[] };

// The shim's Cargo.toml: a static library depending on each crate as the package lists it, with
// paths taken from the package.
function manifest(crates: Ref<RustCrate[]>): string {
  let lines = new Map<string, string>();
  for (const c of crates) {
    const d: Ref<RustDependency> = c.dependency;
    let fields: string[] = [];
    if (d.version !== undefined) fields.push(`version = ${JSON.stringify(d.version)}`);
    if (d.path !== undefined) fields.push(`path = ${JSON.stringify(resolve(c.dir, d.path))}`);
    if (d.git !== undefined) fields.push(`git = ${JSON.stringify(d.git)}`);
    if (d.rev !== undefined) fields.push(`rev = ${JSON.stringify(d.rev)}`);
    if (d.tag !== undefined) fields.push(`tag = ${JSON.stringify(d.tag)}`);
    if (d.branch !== undefined) fields.push(`branch = ${JSON.stringify(d.branch)}`);
    if (d.features !== undefined) fields.push(`features = [${d.features.map((f) => JSON.stringify(f)).join(", ")}]`);
    if (d.defaultFeatures !== undefined) fields.push(`default-features = ${d.defaultFeatures}`);
    lines.set(d.name, `${JSON.stringify(d.name)} = { ${fields.join(", ")} }`);
  }
  let dependencies = [...lines.values()];
  dependencies.sort();
  return [
    "[package]", `name = "${LIBRARY}"`, `version = "0.0.0"`, `edition = "2021"`, "publish = false", "",
    "[lib]", `path = "src/lib.rs"`, `crate-type = ["staticlib"]`, "",
    "[dependencies]", ...dependencies, "",
    "[profile.release]", `panic = "unwind"`, "",
    // A workspace of its own, so a cache directory inside another one isn't taken for its member.
    "[workspace]", "",
  ].join("\n");
}

const RUST_TYPES = new Map<string, string>([["boolean", "bool"], ["void", "()"]]);

// The Rust type of a number or a boolean crossing as itself, the only crossing that has one.
function plainType(c: Ref<Crossing>): string {
  if (c.kind !== "plain" || typeof c.type !== "string") return "";
  const named = RUST_TYPES.get(c.type);
  return named !== undefined ? named : c.type;
}

// A Rust type's path in the shim, from the crate's root.
function typePath(c: Ref<RustClass>): string {
  trusted({ crate: c.crate, path: c.path, symbol: rustSymbol(c.crate, c.path) });
  return `::${c.crate.replace(/-/g, "_")}::${c.path}`;
}

// The C parameters of the shim a crossing value takes, as Rust declares them.
function rustParams(c: Ref<Crossing>, name: string): string[] {
  if (c.kind === "plain") return [`${name}: ${plainType(c)}`];
  if (c.kind === "handle" || c.kind === "lent") return [`${name}: *mut ${typePath(c.of)}`];
  if (c.kind === "string") return [`${name}: *const FishStr`];
  if (c.kind === "array") return [`${name}: *const u8`, `${name}_n: i64`];
  const of: Ref<Crossing> = c.of;
  return of.kind === "plain" || of.kind === "array" ? [`${name}_some: bool`, ...rustParams(of, name)] : rustParams(of, name);
}

// The statement making what a parameter is held as during the call, if it needs holding.
function holder(c: Ref<Crossing>, name: string): string | undefined {
  switch (c.kind) {
    case "string":
      return `let mut ${name}_h = text_of(${name});`;
    case "array": {
      const element: Ref<Crossing> = c.element;
      if (c.lent && element.kind === "plain") return `let mut ${name}_h = Lent { slice: ${elementsOf(element, name)}, vec: std::cell::OnceCell::new() };`;
      return `let mut ${name}_h = ${elementsOf(element, name)}${element.kind === "plain" ? ".to_vec()" : ""};`;
    }
    case "option": {
      const of: Ref<Crossing> = c.of;
      if (of.kind === "string") return `let mut ${name}_h = if ${name}.is_null() { None } else { Some(text_of(${name})) };`;
      if (of.kind === "array") {
        const element: Ref<Crossing> = of.element;
        return `let mut ${name}_h = if ${name}_some { Some(${elementsOf(element, name)}${element.kind === "plain" ? ".to_vec()" : ""}) } else { None };`;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

// The elements of the array parameter `name`, as Rust values.
function elementsOf(e: Ref<Crossing>, name: string): string {
  if (e.kind === "string") return `slice::<*const FishStr>(${name}, ${name}_n).iter().map(|&s| from_fish(s)).collect::<Vec<String>>()`;
  if (e.kind === "handle") return `slice::<*mut ${typePath(e.of)}>(${name}, ${name}_n).iter().map(|&p| *Box::from_raw(p)).collect::<Vec<_>>()`;
  return `slice::<${plainType(e)}>(${name}, ${name}_n)`;
}

// The Rust expression a parameter is given as.
function argument(c: Ref<Crossing>, name: string): string {
  if (c.kind === "plain") return name;
  if (c.kind === "handle") return `*Box::from_raw(${name})`;
  if (c.kind === "lent") return `${c.mutable ? "lend_mut" : "lend"}(${name}, &scope)`;
  if (c.kind === "option") {
    const of: Ref<Crossing> = c.of;
    if (of.kind === "plain") return `if ${name}_some { Some(${name}) } else { None }`;
    if (of.kind === "handle") return `if ${name}.is_null() { None } else { Some(*Box::from_raw(${name})) }`;
  }
  return `Take::take(&mut ${name}_h)`;
}

// The shim's Rust return type, and its out-parameter, for what a function gives.
/** @throws {Error} */
function rustGives(c: Ref<Crossing | undefined>): { returns: string; out?: string } {
  if (c === undefined) return { returns: "" };
  switch (c.kind) {
    case "plain":
      return { returns: ` -> ${plainType(c)}` };
    case "handle":
      return { returns: ` -> *mut ${typePath(c.of)}` };
    case "string":
      return { returns: " -> *mut FishStr" };
    case "array":
      return { returns: "", out: "out: *mut FishArray" };
    case "option": {
      const of: Ref<Crossing> = c.of;
      if (of.kind === "plain") return { returns: " -> bool", out: `out: *mut ${plainType(of)}` };
      if (of.kind === "array") return { returns: " -> bool", out: "out: *mut FishArray" };
      if (of.kind === "string") return { returns: " -> *mut FishStr" };
      if (of.kind === "handle") return { returns: ` -> *mut ${typePath(of.of)}` };
      throw new Error("internal error: an Option of a borrow given by Rust");
    }
  }
  throw new Error("internal error: a borrow given by Rust");
}

// What the shim gives back for the Rust value `r`.
/** @throws {Error} */
function given(c: Ref<Crossing | undefined>, r: string): string {
  if (c === undefined) return r;
  switch (c.kind) {
    case "plain":
      return r;
    case "handle":
      return `handle(${r})`;
    case "string":
      return `GiveStr::give(${r})`;
    case "array":
      return givenArray(c.element, r);
    case "option": {
      const of: Ref<Crossing> = c.of;
      if (of.kind === "plain") return `match ${r} { Some(v) => { *out = v; true } None => false }`;
      if (of.kind === "array") return `match ${r} { Some(v) => { ${givenArray(of.element, "v")}; true } None => false }`;
      if (of.kind === "string") return `match ${r} { Some(s) => GiveStr::give(s), None => std::ptr::null_mut() }`;
      return `match ${r} { Some(v) => handle(v), None => std::ptr::null_mut() }`;
    }
  }
  throw new Error("internal error: a borrow given by Rust");
}

// The Rust sequence `v` given to Fish as an array. Each element is typed from the Fish
// declaration, which fixes how the array is laid out, so a Rust sequence of anything else is
// cargo's type error.
function givenArray(e: Ref<Crossing>, v: string): string {
  const each = e.kind === "string" ? "|s| GiveStr::give(s) as *mut u8" : e.kind === "handle" ? `|v: ${typePath(e.of)}| handle(v) as *mut u8` : `|v: ${plainType(e)}| v`;
  return `give_array(${v}, out, ${each})`;
}

// The Rust types a crossing names, for their drops and Send assertions.
function classesIn(c: Ref<Crossing>): RustClass[] {
  if (c.kind === "handle" || c.kind === "lent") return [{ ...c.of }];
  if (c.kind === "option") return classesIn(c.of);
  if (c.kind === "array") return classesIn(c.element);
  return [];
}

// The shim function calling the Rust function instance `i` declares, noting the Rust types it
// names in `types`.
/** @throws {Error} */
function wrapper(tables: Ref<Tables>, id: InstanceId, types: Mut<Map<string, RustClass>>): string {
  const i = tables.arenas.instanceOf(id);
  const b = bodyOf(tables.arenas, i);
  const rust: Ref<RustName | undefined> = b.rust;
  if (rust === undefined) throw new Error("internal error: a Rust shim for a function that isn't Rust");
  const { crate, path, symbol } = trusted(rust);
  const bowner = b.owner;
  const owner = bowner !== undefined ? rustClassOf(tables.typing, bowner) : undefined;
  const bself: Ref<Body["self"]> = b.self;
  const self = owner !== undefined && bself !== undefined && !bself.constructor ? bself : undefined;
  const constructor = owner !== undefined && bself !== undefined && bself.constructor;
  if (owner !== undefined) types.set(typePath(owner), { ...owner });
  const signature: Ref<Type[] | undefined> = i.signature;
  let crossings: Crossing[] = [];
  if (signature !== undefined) for (const t of signature) crossings.push(crossed(tables.typing, t));
  const gives = constructor && bowner !== undefined ? crossed(tables.typing, bowner, true) : i.returns === "void" ? undefined : crossed(tables.typing, i.returns, true);
  for (const c of crossings) for (const k of classesIn(c)) types.set(typePath(k), { ...k });
  if (gives !== undefined) for (const k of classesIn(gives)) types.set(typePath(k), { ...k });
  const { returns, out } = rustGives(gives);
  // A `Result`'s `Err` goes to its own slot, as Fish's text for an `Error`, or as the Rust value.
  const throws = i.throws;
  const error = throws !== undefined ? rustClassOf(tables.typing, throws) : undefined;
  if (error !== undefined) types.set(typePath(error), { ...error });
  let params: string[] = [];
  if (self !== undefined && owner !== undefined) params.push(`this: *mut ${typePath(owner)}`);
  let holders: string[] = [];
  let args: string[] = [];
  if (self !== undefined) args.push(self.owned === true ? "*Box::from_raw(this)" : self.mutable ? "lend_mut(this, &scope)" : "lend(this, &scope)");
  for (let k: usize = 0; k < crossings.length; k++) {
    const c: Ref<Crossing> = crossings[k]!;
    for (const p of rustParams(c, `a${k}`)) params.push(p);
    const held = holder(c, `a${k}`);
    if (held !== undefined) holders.push(held);
    args.push(argument(c, `a${k}`));
  }
  if (out !== undefined) params.push(out);
  if (throws !== undefined) params.push(`err: *mut *mut u8`);
  params.push("panicked: *mut *mut c_char");
  const call = `::${crate.replace(/-/g, "_")}::${path}(${args.join(", ")})`;
  const failed = error !== undefined ? `handle::<${typePath(error)}>(e) as *mut u8` : "GiveStr::give(e.to_string()) as *mut u8";
  const fallible = throws !== undefined ? `match ${call} {\n            Ok(v) => ${given(gives, "v")},\n            Err(e) => {\n                *err = ${failed};\n                std::mem::zeroed()\n            }\n        }` : given(gives, call);
  // Every reference made from a pointer Fish gave lives only as long as \`scope\`, the call.
  holders.unshift("let scope = ();");
  holders.push(fallible);
  const body = holders.join("\n        ");
  return `#[no_mangle]\npub extern "C" fn ${symbol}(${params.join(", ")})${returns} {\n    caught(panicked, || unsafe {\n        ${body}\n    })\n}\n`;
}

// The shim's source: each function calls its Rust function inside `caught`, its parameters
// converted to what Rust's inference picks among the forms each crossing allows; each Rust type
// gets a drop function and an assertion that it is Send.
/** @throws {Error} */
function source(tables: Ref<Tables>, called: Ref<InstanceId[]>): string {
  let types = new Map<string, RustClass>();
  let wrappers: string[] = [];
  for (const id of called) wrappers.push(wrapper(tables, id, types));
  const drops = [...types.values()].map((c) => {
    const named = dropSymbol({ ...c });
    const at = typePath(c);
    const send = `const _: fn() = || {\n    fn send<T: Send + 'static>() {}\n    send::<${at}>();\n};\n\n`;
    return `${send}#[no_mangle]\npub extern "C" fn ${named}(this: *mut ${at}, panicked: *mut *mut c_char) {\n    if !this.is_null() {\n        caught(panicked, || unsafe { drop(Box::from_raw(this)) })\n    }\n}\n`;
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
