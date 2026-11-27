import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { CompileError } from "./diag.fsh";
import { parseRange } from "./semver.fsh";
import { validCrate } from "./rust.fsh";

// A package another depends on, from a local path, a git repository pinned to a commit, or the
// registry by a version range, and where its entry is in the depending package's `fish.toml`.
// `capabilities` is what the depending package grants it, when it says.
export type Dependency = { name: string; start: usize; end: usize; capabilities?: Capability[] } & ({ path: string } | { git: string; rev: string } | { version: string });

// A package as its `fish.toml` describes it, `dir` being where that file was found; `lib` is
// what a package depending on it imports, `entry` the program it builds.
// `edition`: "ts-compat" marks TypeScript not yet migrated, which a build refuses and `fishc lint`
// reads.
// `rustDependencies` is the `[rust-dependencies]` table, when the manifest has one.
// `capabilities` is what the package says it uses of what a dependency must be granted.
export type Manifest = { name: string; version: string; entry: string; lib: string; edition: Edition; capabilities: Capability[]; dependencies: Dependency[]; rustDependencies?: RustDependency[]; registry?: string; dir: string };
// A Rust crate the package's `declare module "rust:<crate>"` declarations call, in Cargo's terms.
export type RustDependency = {
  name: string; start: usize; end: usize; version?: string; features?: string[]; defaultFeatures?: boolean; path?: string; git?: string; rev?: string; tag?: string; branch?: string;
};
export type Edition = "native" | "ts-compat";
// What a dependency's code may reach beyond computing: the network, files, C and other native
// code, `unsafe`, and other programs.
export type Capability = "net" | "fs" | "ffi" | "unsafe" | "spawn";
export const CAPABILITIES: Capability[] = ["net", "fs", "ffi", "unsafe", "spawn"];

export const MANIFEST = "fish.toml";

// A package name: lowercase letters, digits and '-', starting with a letter, as npm's and cargo's.
export const NAME_RULE = "a package name is lowercase letters, digits and '-', starting with a letter, at most 64 characters";
export const validName = (name: string) => /^[a-z][a-z0-9-]{0,63}$/.test(name);

export type Spanned<T> = { value: T; start: usize; end: usize };
export type Entries = Map<string, { key: Spanned<string>; value: SpannedValue }>;
export type TomlValue = string | i64 | boolean | Entries | SpannedValue[];
// Named, so the type in TomlValue's arrays and the one written elsewhere are the same to Fish.
export type SpannedValue = { value: TomlValue; start: usize; end: usize };
export type Table = { start: usize; end: usize; keys: Entries };

// TOML's one-character escapes in a basic string.
const SIMPLE_ESCAPES = new Map<string, string>([['"', '"'], ["\\", "\\"], ["n", "\n"], ["t", "\t"], ["r", "\r"], ["b", "\b"], ["f", "\f"]]);

// One `[table]` or `[[table]]` header and the keys under it, as written.
type Section = { name: string; array: boolean; table: Table };

// A position in TOML source and the reading done from it. Every read is through `char`, which gives
// "" past the end.
class TomlReader {
  src: string;
  at: usize;

  constructor(src: string) {
    this.src = src;
    this.at = 0;
  }

  char(k: usize): string {
    return this.src.charAt(k as i64);
  }

  ahead(text: string): boolean {
    return this.src.startsWith(text, this.at as i64);
  }

  space(this: Mut<this>) {
    while (this.char(this.at) === " " || this.char(this.at) === "\t") this.at++;
  }

  comment(this: Mut<this>) {
    if (this.char(this.at) === "#") while (this.at < this.src.length && this.char(this.at) !== "\n") this.at++;
  }

  /** @throws {CompileError} */
  endOfLine(this: Mut<this>) {
    this.space();
    this.comment();
    if (this.ahead("\r\n")) this.at++;
    if (this.at < this.src.length && this.char(this.at) !== "\n") throw new CompileError("E0904", "expected the end of the line here", this.at, this.at + 1);
    this.at++;
  }

  /** @throws {CompileError} */
  key(this: Mut<this>, dotted: boolean = false): Spanned<string> {
    const start = this.at;
    if (this.char(this.at) === '"' || this.char(this.at) === "'") {
      const s = this.string();
      return { value: s.value, start, end: this.at };
    }
    while (/^[A-Za-z0-9_-]$/.test(this.char(this.at))) this.at++;
    if (this.at === start) throw new CompileError("E0904", "expected a key here", start, start + 1);
    if (this.char(this.at) === "." && !dotted) throw unread(this.at, "a dotted key");
    return { value: this.src.slice(start as i64, this.at as i64), start, end: this.at };
  }

  /** @throws {CompileError} */
  string(this: Mut<this>): Spanned<string> {
    const start = this.at;
    const quote = this.char(this.at);
    if (this.ahead(quote.repeat(3))) throw unread(this.at, "a multi-line string");
    this.at++;
    let value = "";
    while (this.char(this.at) !== quote) {
      if (this.at >= this.src.length || this.char(this.at) === "\n") throw new CompileError("E0904", "this string isn't closed on its line", start, this.at);
      if (quote === '"' && this.char(this.at) === "\\") {
        const simple = SIMPLE_ESCAPES.get(this.char(this.at + 1));
        if (simple !== undefined) {
          value += simple;
          this.at += 2;
          continue;
        }
        const escape = this.char(this.at + 1);
        const hex: usize = escape === "u" ? 4 : escape === "U" ? 8 : 0;
        const digits = this.src.slice((this.at + 2) as i64, (this.at + 2 + hex) as i64);
        const code = hex === 0 || !/^[0-9A-Fa-f]+$/.test(digits) || digits.length !== hex ? -1 : parseInt(digits, 16)!;
        if (code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new CompileError("E0904", "this escape isn't one TOML has", this.at, this.at + 2);
        value += String.fromCodePoint(code as u32);
        this.at += 2 + hex;
        continue;
      }
      value += this.char(this.at);
      this.at++;
    }
    this.at++;
    return { value, start, end: this.at };
  }

  // One `key = value` into `keys`, a key given twice refused.
  /** @throws {CompileError} */
  entry(this: Mut<this>, keys: Mut<Entries>) {
    const k = this.key();
    this.space();
    if (this.char(this.at) !== "=") throw new CompileError("E0904", "expected '=' after the key", this.at, this.at + 1);
    this.at++;
    this.space();
    const v = this.value();
    if (keys.has(k.value)) throw new CompileError("E0904", `'${k.value}' is given twice`, k.start, k.end);
    keys.set(k.value, { key: k, value: v });
  }

  // `{ a = 1, b = "x" }`, on one line, as TOML has it.
  /** @throws {CompileError} */
  inline(this: Mut<this>): SpannedValue {
    const start = this.at;
    let keys: Entries = new Map();
    this.at++;
    this.space();
    if (this.char(this.at) === "}") {
      this.at++;
      return { value: keys, start, end: this.at };
    }
    for (;;) {
      this.entry(keys);
      this.space();
      if (this.char(this.at) === "}") break;
      if (this.char(this.at) !== ",") throw new CompileError("E0904", "expected ',' or '}' in this inline table", this.at, this.at + 1);
      this.at++;
      this.space();
    }
    this.at++;
    return { value: keys, start, end: this.at };
  }

  /** @throws {CompileError} */
  value(this: Mut<this>): SpannedValue {
    const start = this.at;
    const first = this.char(this.at);
    if (first === '"' || first === "'") {
      const s = this.string();
      return { value: s.value, start: s.start, end: s.end };
    }
    if (first === "{") return this.inline();
    if (first === "[") return this.array();
    const found = /^[^\s#,}\]]+/.exec(this.src.slice(this.at as i64));
    const word = found === null ? "" : found[0]!;
    this.at += word.length;
    if (word === "true" || word === "false") return { value: word === "true", start, end: this.at };
    if (/^[+-]?(0|[1-9]\d*)$/.test(word)) return { value: parseInt(word)!, start, end: this.at };
    if (word === "") throw new CompileError("E0904", "expected a value after '='", start, start + 1);
    throw unread(start, "this value");
  }

  // Blank space, line ends and comments, which an array may hold between its values.
  gap(this: Mut<this>) {
    for (;;) {
      this.space();
      this.comment();
      if (this.char(this.at) === "\n") this.at += 1;
      else if (this.ahead("\r\n")) this.at += 2;
      else return;
    }
  }

  // `["a", "b"]`, over several lines if need be, with a trailing comma allowed.
  /** @throws {CompileError} */
  array(this: Mut<this>): SpannedValue {
    const start = this.at;
    let values: SpannedValue[] = [];
    this.at++;
    for (this.gap(); this.char(this.at) !== "]"; this.gap()) {
      if (this.at >= this.src.length) throw new CompileError("E0904", "this array isn't closed", start, start + 1);
      values.push(this.value());
      this.gap();
      if (this.char(this.at) === "]") break;
      if (this.char(this.at) !== ",") throw new CompileError("E0904", "expected ',' or ']' in this array", this.at, this.at + 1);
      this.at++;
    }
    this.at++;
    const all: TomlValue = values;
    return { value: all, start, end: this.at };
  }
}

function unread(start: usize, what: string): CompileError {
  return new CompileError("E0904", `${what} is TOML Fish doesn't read in a manifest yet`, start, start + 1);
}

// The TOML a manifest and a lockfile use: comments, `[table]` and `[[array of tables]]` headers,
// bare and quoted keys, basic and literal strings, integers, booleans and inline tables. Anything
// else is refused where it starts rather than misread.
/** @throws {CompileError} */
export function parseToml(src: string): Map<string, Table | Table[]> {
  let r = new TomlReader(src);
  let sections: Section[] = [{ name: "", array: false, table: { start: 0, end: 0, keys: new Map() } }];
  // Whether each table named so far is an array of tables.
  let arrays = new Map<string, boolean>([["", false]]);
  while (r.at < src.length) {
    r.space();
    if (r.char(r.at) === "\n" || r.char(r.at) === "#" || r.ahead("\r\n") || r.at >= src.length) {
      r.endOfLine();
      continue;
    }
    if (r.char(r.at) === "[") {
      const start = r.at;
      const array = r.char(r.at + 1) === "[";
      r.at += array ? 2 : 1;
      r.space();
      // `[dependencies.x]` is the one dotted name a manifest has: x's table under [dependencies].
      let name = r.key(true);
      while (r.char(r.at) === ".") {
        r.at++;
        const part = r.key(true);
        name = { value: `${name.value}.${part.value}`, start: name.start, end: part.end };
      }
      r.space();
      if (!r.ahead(array ? "]]" : "]")) throw new CompileError("E0904", `expected '${array ? "]]" : "]"}' to close the table's name`, r.at, r.at + 1);
      r.at += array ? 2 : 1;
      const had = arrays.get(name.value);
      if (had !== undefined && !(array && had)) throw new CompileError("E0904", `the table [${name.value}] is given twice`, start, r.at);
      arrays.set(name.value, array);
      sections.push({ name: name.value, array, table: { start, end: r.at, keys: new Map() } });
      r.endOfLine();
      continue;
    }
    r.entry(sections[sections.length - 1]!.table.keys);
    r.endOfLine();
  }
  let tables = new Map<string, Table | Table[]>();
  while (sections.length > 0) {
    const s = sections.shift()!;
    const had = tables.get(s.name);
    if (!s.array) tables.set(s.name, s.table);
    else if (had === undefined) tables.set(s.name, [s.table]);
    else if (Array.isArray(had)) tables.set(s.name, [...had, s.table]);
  }
  return tables;
}

// What a package's `fish.toml` says, checked: a `[package]` with a name and version, an optional
// entry, and nothing a manifest doesn't have, so a misspelled key isn't silently ignored.
/** @throws {CompileError} */
export function readManifest(src: string, dir: string): Manifest {
  const tables = parseToml(src);
  const known = new Map<string, string[]>([["", []], ["package", ["name", "version", "entry", "lib", "edition", "capabilities"]], ["dependencies", []], ["rust-dependencies", []], ["registry", ["url"]]]);
  for (const [name, found] of tables) {
    if (name.startsWith("dependencies.")) {
      if (Array.isArray(found)) throw new CompileError("E0905", `a dependency is one table; write [${name}] once`, found[0]!.start, found[0]!.end);
      continue;
    }
    const keys = known.get(name);
    const missing = `a manifest has no table [${name}]; it has [package], [dependencies], [rust-dependencies] and [registry]`;
    if (Array.isArray(found)) throw new CompileError("E0905", missing, found[0]!.start, found[0]!.end);
    if (keys === undefined) throw new CompileError("E0905", missing, found.start, found.end);
    for (const { key } of found.keys.values()) {
      if (name !== "dependencies" && name !== "rust-dependencies" && !keys.includes(key.value)) {
        throw new CompileError("E0905", name === "" ? `'${key.value}' belongs in a table, such as [package]` : `[${name}] has no key '${key.value}'; it has ${keys.join(", ")}`, key.start, key.end);
      }
    }
  }
  const pkg = tables.get("package");
  if (pkg === undefined || Array.isArray(pkg)) throw new CompileError("E0905", `${MANIFEST} needs a [package] table with the package's name and version`, 0, 1);
  const name = required(pkg, "name");
  if (!validName(name.value)) throw new CompileError("E0905", NAME_RULE, name.start, name.end);
  const version = required(pkg, "version");
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(\.(0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/.test(version.value)) {
    throw new CompileError("E0905", "a version is MAJOR.MINOR.PATCH, as in \"0.1.0\", with an optional pre-release such as \"1.0.0-beta.1\"", version.start, version.end);
  }
  const entry = packageFile(pkg, "entry", "src/main.fsh");
  const lib = packageFile(pkg, "lib", "src/lib.fsh");
  const edition = textIn(pkg.keys, "edition", true);
  if (edition !== undefined && edition.value !== "native" && edition.value !== "ts-compat") throw new CompileError("E0905", `'${edition.value}' isn't an edition; it is "native", the default, or "ts-compat" for TypeScript not yet migrated`, edition.start, edition.end);
  const chosen: Edition = edition !== undefined && edition.value === "ts-compat" ? "ts-compat" : "native";
  let dependencies: Dependency[] = [];
  const listed = tables.get("dependencies");
  if (listed !== undefined && !Array.isArray(listed)) for (const e of listed.keys.values()) dependencies.push(dependency(e.key, e.value));
  for (const [tableName, found] of tables) {
    if (!tableName.startsWith("dependencies.") || Array.isArray(found)) continue;
    const named = tableName.slice("dependencies.".length as i64);
    // The header's span stands for the key, and the table for its value.
    const key: Spanned<string> = { value: named, start: found.start, end: found.end };
    if (dependencies.some((d) => d.name === named)) throw new CompileError("E0905", `'${named}' is listed under [dependencies] already; give it in one place`, found.start, found.end);
    const value: SpannedValue = { value: found.keys.clone(), start: found.start, end: found.end };
    dependencies.push(dependency(key, value));
  }
  const capabilities = capabilityList(pkg.keys.get("capabilities"));
  let rustDependencies: RustDependency[] | undefined = undefined;
  const crates = tables.get("rust-dependencies");
  if (crates !== undefined && !Array.isArray(crates)) {
    let all: RustDependency[] = [];
    // Rust spells a crate's '-' as '_', so two such names would be one crate in Rust code.
    let spelled = new Map<string, string>();
    for (const e of crates.keys.values()) {
      const d = rustDependency(e.key, e.value);
      const other = spelled.get(d.name.replace(/-/g, "_"));
      if (other !== undefined) throw new CompileError("E0905", `'${d.name}' and '${other}' are the same crate in Rust, which reads '-' as '_'; list it once`, d.start, d.end);
      spelled.set(d.name.replace(/-/g, "_"), d.name);
      all.push(d);
    }
    rustDependencies = all;
  }
  let registry: string | undefined = undefined;
  const index = tables.get("registry");
  if (index !== undefined && !Array.isArray(index)) {
    const url = index.keys.get("url");
    if (url !== undefined) {
      const written = url.value.value;
      if (typeof written !== "string" || written.startsWith("-")) throw new CompileError("E0905", "the registry's url is a string naming its index, as in url = \"https://...\"", url.value.start, url.value.end);
      registry = written;
    }
  }
  return { name: name.value, version: version.value, entry, lib, edition: chosen, capabilities, dependencies, rustDependencies, registry, dir };
}

// A `capabilities = ["net", ...]` list, each name one of the five and given once; none when absent.
/** @throws {CompileError} */
function capabilityList(found: Ref<{ key: Spanned<string>; value: SpannedValue } | undefined>): Capability[] {
  if (found === undefined) return [];
  const form = `'capabilities' is a list of ${CAPABILITIES.map((c) => `"${c}"`).join(", ")}, as in capabilities = ["net"]`;
  const list: Ref<TomlValue> = found.value.value;
  if (!Array.isArray(list)) throw new CompileError("E0905", form, found.value.start, found.value.end);
  let all: Capability[] = [];
  for (const v of list) {
    const written: Ref<TomlValue> = v.value;
    if (typeof written !== "string") throw new CompileError("E0905", form, v.start, v.end);
    const known = CAPABILITIES.find((c) => c === written);
    if (known === undefined) throw new CompileError("E0905", `'${written}' isn't a capability; ${form}`, v.start, v.end);
    if (all.includes(known)) throw new CompileError("E0905", `'${written}' is listed twice`, v.start, v.end);
    all.push(known);
  }
  return all;
}

// The string at `field` in `keys`, if it is there; anything else there is refused, with how a
// string is written when `example` says so.
/** @throws {CompileError} */
function textIn(keys: Ref<Entries>, field: string, example: boolean): Spanned<string> | undefined {
  const found = keys.get(field);
  if (found === undefined) return undefined;
  const written = found.value.value;
  if (typeof written !== "string") throw new CompileError("E0905", example ? `'${field}' is a string, as in ${field} = "..."` : `'${field}' is a string`, found.value.start, found.value.end);
  return { value: written, start: found.value.start, end: found.value.end };
}

/** @throws {CompileError} */
function required(pkg: Ref<Table>, field: string): Spanned<string> {
  const found = textIn(pkg.keys, field, true);
  if (found === undefined) throw new CompileError("E0905", `[package] needs a '${field}'`, pkg.start, pkg.end);
  return found;
}

// The package's `entry` or `lib`, a .fsh file inside it, or `fallback` when it names none.
/** @throws {CompileError} */
function packageFile(pkg: Ref<Table>, field: string, fallback: string): string {
  const found = textIn(pkg.keys, field, true);
  if (found === undefined) return fallback;
  if (!found.value.endsWith(".fsh")) throw new CompileError("E0905", `the ${field} is a .fsh file, as in ${field} = "${fallback}"`, found.start, found.end);
  if (isAbsolute(found.value) || normalize(found.value).split(sep)[0] === "..") throw new CompileError("E0905", `the ${field} is a file inside the package, as in ${field} = "${fallback}"`, found.start, found.end);
  return found.value;
}

// A `[rust-dependencies]` entry in one of Cargo's forms: `name = "1.2"`, or a table with `version`,
// `features`, `default-features`, and `path`, or `git` with one of `rev`, `tag` and `branch`.
/** @throws {CompileError} */
function rustDependency(key: Ref<Spanned<string>>, value: Ref<SpannedValue>): RustDependency {
  let made: RustDependency = { name: key.value, start: key.start, end: value.end };
  if (!validCrate(key.value)) throw new CompileError("E0905", `'${key.value}' isn't a crate name; a crate's name is letters, digits, '_' and '-', starting with a letter or '_'`, key.start, key.end);
  if (typeof value.value === "string") {
    made.version = value.value;
    return made;
  }
  const form = "a Rust dependency is a version, as in \"1.2\", or a table as Cargo takes it, as in { version = \"1.2\", features = [\"derive\"] }, { path = \"../crate\" } or { git = \"https://...\", rev = \"<commit>\" }";
  if (!(value.value instanceof Map)) throw new CompileError("E0905", form, value.start, value.end);
  const entries: Ref<Entries> = value.value;
  const keys = ["version", "features", "default-features", "path", "git", "rev", "tag", "branch"];
  for (const { key: k } of entries.values()) {
    if (!keys.includes(k.value)) throw new CompileError("E0905", `a Rust dependency has no key '${k.value}'; it has ${keys.join(", ")}`, k.start, k.end);
  }
  const version = textIn(entries, "version", false);
  const path = textIn(entries, "path", false);
  const git = textIn(entries, "git", false);
  const rev = textIn(entries, "rev", false);
  const tag = textIn(entries, "tag", false);
  const branch = textIn(entries, "branch", false);
  let named: string[] | undefined = undefined;
  const features = entries.get("features");
  if (features !== undefined) {
    const list = features.value.value;
    const wrong = "'features' is a list of strings, as in features = [\"derive\"]";
    if (!Array.isArray(list)) throw new CompileError("E0905", wrong, features.value.start, features.value.end);
    let all: string[] = [];
    for (const f of list) {
      if (typeof f.value !== "string") throw new CompileError("E0905", wrong, features.value.start, features.value.end);
      all.push(f.value);
    }
    named = all;
  }
  let on: boolean | undefined = undefined;
  const defaults = entries.get("default-features");
  if (defaults !== undefined) {
    const written = defaults.value.value;
    if (typeof written !== "boolean") throw new CompileError("E0905", "'default-features' is true or false", defaults.value.start, defaults.value.end);
    on = written;
  }
  if (path !== undefined && git !== undefined) throw new CompileError("E0905", "a Rust dependency comes from a path or from git, not both", value.start, value.end);
  if (version === undefined && path === undefined && git === undefined) throw new CompileError("E0905", form, value.start, value.end);
  let pins: { start: usize; end: usize }[] = [];
  if (rev !== undefined) pins.push({ start: rev.start, end: rev.end });
  if (tag !== undefined) pins.push({ start: tag.start, end: tag.end });
  if (branch !== undefined) pins.push({ start: branch.start, end: branch.end });
  if (pins.length > 0 && git === undefined) throw new CompileError("E0905", "rev, tag and branch choose a git dependency's commit; this one isn't from git", pins[0]!.start, pins[0]!.end);
  if (pins.length > 1) throw new CompileError("E0905", "a git dependency takes one of rev, tag and branch", pins[1]!.start, pins[1]!.end);
  if (version !== undefined) made.version = version.value;
  if (named !== undefined) made.features = named;
  if (on !== undefined) made.defaultFeatures = on;
  if (path !== undefined) made.path = path.value;
  if (git !== undefined) made.git = git.value;
  if (rev !== undefined) made.rev = rev.value;
  if (tag !== undefined) made.tag = tag.value;
  if (branch !== undefined) made.branch = branch.value;
  return made;
}

// A `[dependencies]` entry: `{ path = "..." }`, or `{ git = "...", rev = "..." }` pinned to a commit.
/** @throws {CompileError} */
function dependency(key: Ref<Spanned<string>>, value: Ref<SpannedValue>): Dependency {
  if (!validName(key.value)) throw new CompileError("E0905", `'${key.value}' isn't a package name: ${NAME_RULE}`, key.start, key.end);
  const form = "a dependency is a table naming where it comes from, as in { version = \"^1.2.0\" }, { path = \"../util\" } or { git = \"https://...\", rev = \"<commit>\" }";
  if (!(value.value instanceof Map)) throw new CompileError("E0905", form, value.start, value.end);
  const entries: Ref<Entries> = value.value;
  for (const { key: k } of entries.values()) {
    if (!["version", "path", "git", "rev", "capabilities"].includes(k.value)) throw new CompileError("E0905", `a dependency has no key '${k.value}'; it has version, path, or git and rev, and capabilities`, k.start, k.end);
  }
  const capabilities = entries.has("capabilities") ? capabilityList(entries.get("capabilities")) : undefined;
  const version = textIn(entries, "version", false);
  const path = textIn(entries, "path", false);
  const git = textIn(entries, "git", false);
  const rev = textIn(entries, "rev", false);
  const places = (version !== undefined ? 1 : 0) + (path !== undefined ? 1 : 0) + (git !== undefined ? 1 : 0);
  if (places > 1) throw new CompileError("E0905", "a dependency comes from one place: the registry by version, a path, or git", value.start, value.end);
  const name = key.value;
  const start = key.start;
  const end = value.end;
  if (version !== undefined) {
    if (rev !== undefined) throw new CompileError("E0905", "rev pins a git dependency; a registry one is chosen by its version range", rev.start, rev.end);
    if (parseRange(version.value) === undefined) throw new CompileError("E0905", `'${version.value}' isn't a version range; write one as package.json does, as in "^1.2.0" or ">=1.0.0 <2.0.0"`, version.start, version.end);
    return { name, start, end, capabilities, version: version.value };
  }
  if (path !== undefined) return { name, start, end, capabilities, path: path.value };
  if (git === undefined) throw new CompileError("E0905", form, value.start, value.end);
  if (git.value.startsWith("-")) throw new CompileError("E0905", "a git URL can't start with '-'", git.start, git.end);
  if (rev === undefined) throw new CompileError("E0905", "a git dependency is pinned to a commit, as in rev = \"3f2a9c1\"; branches and tags move", value.start, value.end);
  if (!/^[0-9a-f]{7,40}$/.test(rev.value)) throw new CompileError("E0905", "rev is a commit's hash, 7 to 40 lowercase hex digits; branches and tags move", rev.start, rev.end);
  return { name, start, end, capabilities, git: git.value, rev: rev.value };
}

// The nearest `fish.toml` at or above `from`.
export function findManifest(from: string): string | undefined {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const file = join(dir, MANIFEST);
    if (existsSync(file)) return file;
    if (dirname(dir) === dir) return undefined;
  }
}

// Reads and checks the manifest at `file`, whose entry, or lib, must exist when `needs` says so.
// An error in it renders against it, wherever it was reached from.
/** @throws {CompileError | IoError} */
export function loadManifest(file: string, needs?: "entry" | "lib"): Manifest {
  const src = readFileSync(file, "utf8");
  try {
    const manifest = readManifest(src, dirname(file));
    const pkg = packageTable(src);
    for (const field of ["entry", "lib"]) {
      const at = spanOf(pkg, field);
      const named = field === "entry" ? manifest.entry : manifest.lib;
      const path = join(manifest.dir, named);
      if (!existsSync(path)) {
        if (field === needs) throw new CompileError("E0905", `the ${field} '${named}' doesn't exist; create it, or name another with ${field} = "..."`, at.start, at.end);
        continue;
      }
      // A dependency's link can't carry the file out of the package either; the program's own may.
      if (needs === "lib" && !realpathSync(path).startsWith(realpathSync(manifest.dir) + sep)) throw new CompileError("E0905", `the ${field} '${named}' leads outside the package; it is a file inside it`, at.start, at.end);
    }
    return manifest;
  } catch (e) {
    if (e instanceof CompileError) throw inManifest(e, file, src);
    throw e;
  }
}

// The [package] table of a manifest `readManifest` has already accepted.
/** @throws {CompileError} */
function packageTable(src: string): Table {
  const pkg = parseToml(src).get("package");
  if (pkg === undefined || Array.isArray(pkg)) throw new CompileError("E0905", `${MANIFEST} needs a [package] table with the package's name and version`, 0, 1);
  return pkg;
}

// Where a [package] table's `field` is written, or the table's own place without it.
function spanOf(pkg: Ref<Table>, field: string): { start: usize; end: usize } {
  const entry = pkg.keys.get(field);
  return entry !== undefined ? { start: entry.value.start, end: entry.value.end } : { start: pkg.start, end: pkg.end };
}

// An error about the manifest at `file`, at its `entry` or `lib` key or else its [package] table.
/** @throws {CompileError | IoError} */
export function fieldError(file: string, field: "entry" | "lib", message: string): CompileError {
  const src = readFileSync(file, "utf8");
  const pkg = packageTable(src);
  const at = spanOf(pkg, field);
  return inManifest(new CompileError("E0905", message, at.start, at.end), file, src);
}

// Has a compile error found in the manifest at `file` render against that file.
/** @throws {IoError} */
export function inManifest(e: CompileError, file: string, given?: string): CompileError {
  if (e.sources.length === 0) {
    const src = given ?? readFileSync(file, "utf8");
    const shown = relative(resolve(), file);
    e.sources = [{ base: 0, src, file: shown !== "" ? shown : file }];
  }
  return e;
}

// A new package named `name` in `dir`: its manifest, and a greeting entry and a `.gitignore`
// where there are none, so a directory already holding code keeps it.
/** @throws {IoError} */
export function createPackage(dir: string, name: string): void {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, MANIFEST), `[package]\nname = "${name}"\nversion = "0.1.0"\n\n[dependencies]\n`);
  const entry = join(dir, "src", "main.fsh");
  if (!existsSync(entry)) writeFileSync(entry, `function main() {\n  console.log("Hello from ${name}!");\n}\n`);
  const ignore = join(dir, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "/target\n");
}

// Whether `dir` is missing or holds nothing, so a new package can be made there.
/** @throws {IoError} */
export function vacant(dir: string): boolean {
  return !existsSync(dir) || readdirSync(dir).length === 0;
}

// `fish.toml`'s text with `line` added to its [dependencies], after the last entry there or a new
// table at the end, every other byte as it was.
export function withDependency(src: string, line: string): string {
  // A file written with CRLF line ends keeps them.
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  let lines = src.split("\n");
  const header = lines.findIndex((l) => /^\s*\[\s*("dependencies"|'dependencies'|dependencies)\s*\]\s*(#.*)?\r?$/.test(l));
  if (header < 0) return `${src}${src === "" || src.endsWith("\n") ? "" : eol}${eol}[dependencies]${eol}${line}${eol}`;
  let at = header as usize;
  for (let i = at + 1; i < lines.length && !/^\s*\[/.test(lines[i]!); i++) if (/^\s*[^\s#]/.test(lines[i]!)) at = i;
  // A line added after a last line that has no line end takes over that missing end: the old last
  // line gets one, and the new one, now last, goes without.
  const last = at === lines.length - 1 && !src.endsWith("\n");
  if (last) lines[at] += eol === "\r\n" ? "\r" : "";
  else if (eol === "\r\n") line += "\r";
  lines.splice((at + 1) as i64, 0, line);
  return lines.join("\n");
}
