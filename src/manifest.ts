import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { CompileError } from "./diag.ts";
import { parseRange } from "./semver.ts";

// A package another depends on, from a local path, a git repository pinned to a commit, or the
// registry by a version range, and where its entry is in the depending package's `fish.toml`.
export type Dependency = { name: string; start: number; end: number } & ({ path: string } | { git: string; rev: string } | { version: string });

// A package as its `fish.toml` describes it, `dir` being where that file was found; `lib` is
// what a package depending on it imports, `entry` the program it builds.
// `edition`: "ts-compat" marks TypeScript not yet migrated, which a build refuses and `fishc lint`
// reads.
// `rustDependencies` is the `[rust-dependencies]` table, when the manifest has one.
export type Manifest = { name: string; version: string; entry: string; lib: string; edition: Edition; dependencies: Dependency[]; rustDependencies?: RustDependency[]; registry?: string; dir: string };
// A Rust crate the package's `declare module "rust:<crate>"` declarations call, in Cargo's terms.
export type RustDependency = {
  name: string; start: number; end: number; version?: string; features?: string[]; defaultFeatures?: boolean; path?: string; git?: string; rev?: string; tag?: string; branch?: string;
};
export type Edition = "native" | "ts-compat";

export const MANIFEST = "fish.toml";

// A package name: lowercase letters, digits and '-', starting with a letter, as npm's and cargo's.
export const NAME_RULE = "a package name is lowercase letters, digits and '-', starting with a letter, at most 64 characters";
export const validName = (name: string) => /^[a-z][a-z0-9-]{0,63}$/.test(name);

export type Spanned<T> = { value: T; start: number; end: number };
export type Entries = Map<string, { key: Spanned<string>; value: Spanned<TomlValue> }>;
export type TomlValue = string | number | boolean | Entries | Spanned<TomlValue>[];
export type Table = { start: number; end: number; keys: Entries };

// The TOML a manifest and a lockfile use: comments, `[table]` and `[[array of tables]]` headers,
// bare and quoted keys, basic and literal strings, integers, booleans and inline tables. Anything
// else is refused where it starts rather than misread.
export function parseToml(src: string): Map<string, Table | Table[]> {
  const tables = new Map<string, Table | Table[]>();
  let current: Table = { start: 0, end: 0, keys: new Map() };
  tables.set("", current);
  let at = 0;
  const unread = (start: number, what: string) => new CompileError(`${what} is TOML Fish doesn't read in a manifest yet`, start, start + 1);
  const space = () => {
    while (at < src.length && (src[at] === " " || src[at] === "\t")) at++;
  };
  const endOfLine = () => {
    space();
    if (src[at] === "#") while (at < src.length && src[at] !== "\n") at++;
    if (src.startsWith("\r\n", at)) at++;
    if (at < src.length && src[at] !== "\n") throw new CompileError("expected the end of the line here", at, at + 1);
    at++;
  };
  const key = (): Spanned<string> => {
    const start = at;
    if (src[at] === '"' || src[at] === "'") {
      const s = string();
      return { value: s.value, start, end: at };
    }
    while (at < src.length && /[A-Za-z0-9_-]/.test(src[at]!)) at++;
    if (at === start) throw new CompileError("expected a key here", start, start + 1);
    if (src[at] === ".") throw unread(at, "a dotted key");
    return { value: src.slice(start, at), start, end: at };
  };
  const string = (): Spanned<string> => {
    const start = at;
    const quote = src[at]!;
    if (src.startsWith(quote.repeat(3), at)) throw unread(at, "a multi-line string");
    at++;
    let value = "";
    while (src[at] !== quote) {
      if (at >= src.length || src[at] === "\n") throw new CompileError("this string isn't closed on its line", start, at);
      if (quote === '"' && src[at] === "\\") {
        const escape = src[at + 1];
        const simple: Record<string, string> = { '"': '"', "\\": "\\", n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };
        if (escape !== undefined && escape in simple) {
          value += simple[escape];
          at += 2;
          continue;
        }
        const hex = escape === "u" ? 4 : escape === "U" ? 8 : 0;
        const digits = src.slice(at + 2, at + 2 + hex);
        const code = parseInt(digits, 16);
        if (hex === 0 || !/^[0-9A-Fa-f]+$/.test(digits) || digits.length !== hex || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new CompileError("this escape isn't one TOML has", at, at + 2);
        value += String.fromCodePoint(code);
        at += 2 + hex;
        continue;
      }
      value += src[at];
      at++;
    }
    at++;
    return { value, start, end: at };
  };
  // One `key = value` into `keys`, a key given twice refused.
  const entry = (keys: Entries) => {
    const k = key();
    space();
    if (src[at] !== "=") throw new CompileError("expected '=' after the key", at, at + 1);
    at++;
    space();
    const v = value();
    if (keys.has(k.value)) throw new CompileError(`'${k.value}' is given twice`, k.start, k.end);
    keys.set(k.value, { key: k, value: v });
  };
  // `{ a = 1, b = "x" }`, on one line, as TOML has it.
  const inline = (): Spanned<Entries> => {
    const start = at;
    const keys: Entries = new Map();
    at++;
    space();
    if (src[at] === "}") {
      at++;
      return { value: keys, start, end: at };
    }
    for (;;) {
      entry(keys);
      space();
      if (src[at] === "}") break;
      if (src[at] !== ",") throw new CompileError("expected ',' or '}' in this inline table", at, at + 1);
      at++;
      space();
    }
    at++;
    return { value: keys, start, end: at };
  };
  const value = (): Spanned<TomlValue> => {
    const start = at;
    if (src[at] === '"' || src[at] === "'") return string();
    if (src[at] === "{") return inline();
    if (src[at] === "[") return array();
    const word = /^[^\s#,}\]]+/.exec(src.slice(at))?.[0] ?? "";
    at += word.length;
    if (word === "true" || word === "false") return { value: word === "true", start, end: at };
    if (/^[+-]?(0|[1-9]\d*)$/.test(word)) return { value: Number(word), start, end: at };
    if (word === "") throw new CompileError("expected a value after '='", start, start + 1);
    throw unread(start, "this value");
  };
  // Blank space, line ends and comments, which an array may hold between its values.
  const gap = () => {
    for (;;) {
      space();
      if (src[at] === "#") while (at < src.length && src[at] !== "\n") at++;
      if (src[at] === "\n" || src.startsWith("\r\n", at)) at += src[at] === "\n" ? 1 : 2;
      else return;
    }
  };
  // `["a", "b"]`, over several lines if need be, with a trailing comma allowed.
  const array = (): Spanned<TomlValue> => {
    const start = at;
    const values: Spanned<TomlValue>[] = [];
    at++;
    for (gap(); src[at] !== "]"; gap()) {
      if (at >= src.length) throw new CompileError("this array isn't closed", start, start + 1);
      values.push(value());
      gap();
      if (src[at] === "]") break;
      if (src[at] !== ",") throw new CompileError("expected ',' or ']' in this array", at, at + 1);
      at++;
    }
    at++;
    return { value: values, start, end: at };
  };
  while (at < src.length) {
    space();
    if (src[at] === "\n" || src[at] === "#" || src.startsWith("\r\n", at) || at >= src.length) {
      endOfLine();
      continue;
    }
    if (src[at] === "[") {
      const start = at;
      const array = src[at + 1] === "[";
      at += array ? 2 : 1;
      space();
      const name = key();
      space();
      if (!src.startsWith(array ? "]]" : "]", at)) throw new CompileError(`expected '${array ? "]]" : "]"}' to close the table's name`, at, at + 1);
      at += array ? 2 : 1;
      current = { start, end: at, keys: new Map() };
      const had = tables.get(name.value);
      if (array && (had === undefined || Array.isArray(had))) {
        if (had) had.push(current);
        else tables.set(name.value, [current]);
      } else if (had !== undefined) {
        throw new CompileError(`the table [${name.value}] is given twice`, start, at);
      } else tables.set(name.value, current);
      endOfLine();
      continue;
    }
    entry(current.keys);
    endOfLine();
  }
  return tables;
}

// What a package's `fish.toml` says, checked: a `[package]` with a name and version, an optional
// entry, and nothing a manifest doesn't have, so a misspelled key isn't silently ignored.
export function readManifest(src: string, dir: string): Manifest {
  const tables = parseToml(src);
  const known: Record<string, string[]> = { "": [], package: ["name", "version", "entry", "lib", "edition"], dependencies: [], "rust-dependencies": [], registry: ["url"] };
  for (const [name, found] of tables) {
    const table = Array.isArray(found) ? found[0]! : found;
    if (!(name in known) || Array.isArray(found)) throw new CompileError(`a manifest has no table [${name}]; it has [package], [dependencies], [rust-dependencies] and [registry]`, table.start, table.end);
    for (const { key } of table.keys.values()) {
      if (name !== "dependencies" && name !== "rust-dependencies" && !known[name]!.includes(key.value)) {
        throw new CompileError(name === "" ? `'${key.value}' belongs in a table, such as [package]` : `[${name}] has no key '${key.value}'; it has ${known[name]!.join(", ")}`, key.start, key.end);
      }
    }
  }
  const pkg = tables.get("package") as Table | undefined;
  if (!pkg) throw new CompileError(`${MANIFEST} needs a [package] table with the package's name and version`, 0, 1);
  const text = (field: string): Spanned<string> | undefined => {
    const found = pkg.keys.get(field);
    if (found && typeof found.value.value !== "string") throw new CompileError(`'${field}' is a string, as in ${field} = "..."`, found.value.start, found.value.end);
    return found?.value as Spanned<string> | undefined;
  };
  const required = (field: string): Spanned<string> => text(field) ?? (() => { throw new CompileError(`[package] needs a '${field}'`, pkg.start, pkg.end); })();
  const name = required("name");
  if (!validName(name.value)) throw new CompileError(NAME_RULE, name.start, name.end);
  const version = required("version");
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(\.(0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/.test(version.value)) {
    throw new CompileError("a version is MAJOR.MINOR.PATCH, as in \"0.1.0\", with an optional pre-release such as \"1.0.0-beta.1\"", version.start, version.end);
  }
  const file = (field: string, fallback: string) => {
    const found = text(field);
    if (found && !found.value.endsWith(".fsh")) throw new CompileError(`the ${field} is a .fsh file, as in ${field} = "${fallback}"`, found.start, found.end);
    if (found && (isAbsolute(found.value) || normalize(found.value).split(sep)[0] === "..")) throw new CompileError(`the ${field} is a file inside the package, as in ${field} = "${fallback}"`, found.start, found.end);
    return found?.value ?? fallback;
  };
  const entry = file("entry", "src/main.fsh");
  const lib = file("lib", "src/lib.fsh");
  const edition = text("edition");
  if (edition && edition.value !== "native" && edition.value !== "ts-compat") throw new CompileError(`'${edition.value}' isn't an edition; it is "native", the default, or "ts-compat" for TypeScript not yet migrated`, edition.start, edition.end);
  const listed = tables.get("dependencies") as Table | undefined;
  const dependencies = [...(listed?.keys.values() ?? [])].map(({ key, value }) => dependency(key, value));
  const crates = tables.get("rust-dependencies") as Table | undefined;
  const rustDependencies = crates && [...crates.keys.values()].map(({ key, value }) => rustDependency(key, value));
  // Rust spells a crate's '-' as '_', so two such names would be one crate in Rust code.
  const spelled = new Map<string, string>();
  for (const d of rustDependencies ?? []) {
    const other = spelled.get(d.name.replace(/-/g, "_"));
    if (other !== undefined) throw new CompileError(`'${d.name}' and '${other}' are the same crate in Rust, which reads '-' as '_'; list it once`, d.start, d.end);
    spelled.set(d.name.replace(/-/g, "_"), d.name);
  }
  const registry = (tables.get("registry") as Table | undefined)?.keys.get("url")?.value;
  if (registry && (typeof registry.value !== "string" || registry.value.startsWith("-"))) throw new CompileError("the registry's url is a string naming its index, as in url = \"https://...\"", registry.start, registry.end);
  return { name: name.value, version: version.value, entry, lib, edition: (edition?.value ?? "native") as Edition, dependencies, ...(rustDependencies && { rustDependencies }), ...(registry && { registry: registry.value as string }), dir };
}

// A crate's name as Cargo takes it.
export const validCrate = (name: string) => /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name);

// A `[rust-dependencies]` entry in one of Cargo's forms: `name = "1.2"`, or a table with `version`,
// `features`, `default-features`, and `path`, or `git` with one of `rev`, `tag` and `branch`.
function rustDependency(key: Spanned<string>, value: Spanned<TomlValue>): RustDependency {
  const at = { name: key.value, start: key.start, end: value.end };
  if (!validCrate(key.value)) throw new CompileError(`'${key.value}' isn't a crate name; a crate's name is letters, digits, '_' and '-', starting with a letter or '_'`, key.start, key.end);
  if (typeof value.value === "string") return { ...at, version: value.value };
  const form = "a Rust dependency is a version, as in \"1.2\", or a table as Cargo takes it, as in { version = \"1.2\", features = [\"derive\"] }, { path = \"../crate\" } or { git = \"https://...\", rev = \"<commit>\" }";
  if (!(value.value instanceof Map)) throw new CompileError(form, value.start, value.end);
  const entries = value.value;
  const keys = ["version", "features", "default-features", "path", "git", "rev", "tag", "branch"];
  for (const { key: k } of entries.values()) {
    if (!keys.includes(k.value)) throw new CompileError(`a Rust dependency has no key '${k.value}'; it has ${keys.join(", ")}`, k.start, k.end);
  }
  const text = (field: string): Spanned<string> | undefined => {
    const found = entries.get(field);
    if (found && typeof found.value.value !== "string") throw new CompileError(`'${field}' is a string`, found.value.start, found.value.end);
    return found?.value as Spanned<string> | undefined;
  };
  const [version, path, git, rev, tag, branch] = ["version", "path", "git", "rev", "tag", "branch"].map(text);
  const features = entries.get("features")?.value;
  const named = Array.isArray(features?.value) ? features.value : undefined;
  if (features && (!named || named.some((f) => typeof f.value !== "string"))) throw new CompileError("'features' is a list of strings, as in features = [\"derive\"]", features.start, features.end);
  const defaults = entries.get("default-features")?.value;
  if (defaults && typeof defaults.value !== "boolean") throw new CompileError("'default-features' is true or false", defaults.start, defaults.end);
  if (path && git) throw new CompileError("a Rust dependency comes from a path or from git, not both", value.start, value.end);
  if (!version && !path && !git) throw new CompileError(form, value.start, value.end);
  const pins = [rev, tag, branch].filter((p) => p !== undefined);
  if (pins.length > 0 && !git) throw new CompileError("rev, tag and branch choose a git dependency's commit; this one isn't from git", pins[0]!.start, pins[0]!.end);
  if (pins.length > 1) throw new CompileError("a git dependency takes one of rev, tag and branch", pins[1]!.start, pins[1]!.end);
  return {
    ...at, ...(version && { version: version.value }), ...(named && { features: named.map((f) => f.value as string) }), ...(defaults && { defaultFeatures: defaults.value as boolean }),
    ...(path && { path: path.value }), ...(git && { git: git.value }), ...(rev && { rev: rev.value }), ...(tag && { tag: tag.value }), ...(branch && { branch: branch.value }),
  };
}

// A `[dependencies]` entry: `{ path = "..." }`, or `{ git = "...", rev = "..." }` pinned to a commit.
function dependency(key: Spanned<string>, value: Spanned<TomlValue>): Dependency {
  const at = { name: key.value, start: key.start, end: value.end };
  if (!validName(key.value)) throw new CompileError(`'${key.value}' isn't a package name: ${NAME_RULE}`, key.start, key.end);
  const form = "a dependency is a table naming where it comes from, as in { version = \"^1.2.0\" }, { path = \"../util\" } or { git = \"https://...\", rev = \"<commit>\" }";
  if (!(value.value instanceof Map)) throw new CompileError(form, value.start, value.end);
  const entries = value.value;
  const text = (field: string): Spanned<string> | undefined => {
    const found = entries.get(field);
    if (found && typeof found.value.value !== "string") throw new CompileError(`'${field}' is a string`, found.value.start, found.value.end);
    return found?.value as Spanned<string> | undefined;
  };
  for (const { key: k } of entries.values()) {
    if (!["version", "path", "git", "rev"].includes(k.value)) throw new CompileError(`a dependency has no key '${k.value}'; it has version, path, or git and rev`, k.start, k.end);
  }
  const [version, path, git, rev] = [text("version"), text("path"), text("git"), text("rev")];
  if ([version, path, git].filter(Boolean).length > 1) throw new CompileError("a dependency comes from one place: the registry by version, a path, or git", value.start, value.end);
  if (version) {
    if (rev) throw new CompileError("rev pins a git dependency; a registry one is chosen by its version range", rev.start, rev.end);
    if (!parseRange(version.value)) throw new CompileError(`'${version.value}' isn't a version range; write one as package.json does, as in "^1.2.0" or ">=1.0.0 <2.0.0"`, version.start, version.end);
    return { ...at, version: version.value };
  }
  if (path) return { ...at, path: path.value };
  if (!git) throw new CompileError(form, value.start, value.end);
  if (git.value.startsWith("-")) throw new CompileError("a git URL can't start with '-'", git.start, git.end);
  if (!rev) throw new CompileError("a git dependency is pinned to a commit, as in rev = \"3f2a9c1\"; branches and tags move", value.start, value.end);
  if (!/^[0-9a-f]{7,40}$/.test(rev.value)) throw new CompileError("rev is a commit's hash, 7 to 40 lowercase hex digits; branches and tags move", rev.start, rev.end);
  return { ...at, git: git.value, rev: rev.value };
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
export function loadManifest(file: string, needs?: "entry" | "lib"): Manifest {
  const src = readFileSync(file, "utf8");
  try {
    const manifest = readManifest(src, dirname(file));
    const pkg = parseToml(src).get("package") as Table;
    for (const field of ["entry", "lib"] as const) {
      const at = pkg.keys.get(field)?.value ?? pkg;
      const path = join(manifest.dir, manifest[field]);
      if (!existsSync(path)) {
        if (field === needs) throw new CompileError(`the ${field} '${manifest[field]}' doesn't exist; create it, or name another with ${field} = "..."`, at.start, at.end);
        continue;
      }
      // A dependency's link can't carry the file out of the package either; the program's own may.
      if (needs === "lib" && !realpathSync(path).startsWith(realpathSync(manifest.dir) + sep)) throw new CompileError(`the ${field} '${manifest[field]}' leads outside the package; it is a file inside it`, at.start, at.end);
    }
    return manifest;
  } catch (e) {
    throw inManifest(e, file, src);
  }
}

// An error about the manifest at `file`, at its `entry` or `lib` key or else its [package] table.
export function fieldError(file: string, field: "entry" | "lib", message: string): unknown {
  const src = readFileSync(file, "utf8");
  const pkg = parseToml(src).get("package") as Table;
  const at = pkg.keys.get(field)?.value ?? pkg;
  return inManifest(new CompileError(message, at.start, at.end), file, src);
}

// Has a compile error found in the manifest at `file` render against that file.
export function inManifest(e: unknown, file: string, src = readFileSync(file, "utf8")): unknown {
  if (e instanceof CompileError && e.sources.length === 0) e.sources = [{ base: 0, src, file: relative(process.cwd(), file) || file }];
  return e;
}

// A new package named `name` in `dir`: its manifest, and a greeting entry and a `.gitignore`
// where there are none, so a directory already holding code keeps it.
export function createPackage(dir: string, name: string): void {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, MANIFEST), `[package]\nname = "${name}"\nversion = "0.1.0"\n\n[dependencies]\n`);
  const entry = join(dir, "src", "main.fsh");
  if (!existsSync(entry)) writeFileSync(entry, `function main() {\n  console.log("Hello from ${name}!");\n}\n`);
  const ignore = join(dir, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "/target\n");
}

// Whether `dir` is missing or holds nothing, so a new package can be made there.
export const vacant = (dir: string) => !existsSync(dir) || readdirSync(dir).length === 0;

// `fish.toml`'s text with `line` added to its [dependencies], after the last entry there or a new
// table at the end, every other byte as it was.
export function withDependency(src: string, line: string): string {
  // A file written with CRLF line ends keeps them.
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.split("\n");
  const header = lines.findIndex((l) => /^\s*\[\s*("dependencies"|'dependencies'|dependencies)\s*\]\s*(#.*)?\r?$/.test(l));
  if (header < 0) return `${src}${src === "" || src.endsWith("\n") ? "" : eol}${eol}[dependencies]${eol}${line}${eol}`;
  let at = header;
  for (let i = header + 1; i < lines.length && !/^\s*\[/.test(lines[i]!); i++) if (/^\s*[^\s#]/.test(lines[i]!)) at = i;
  // A line added after a last line that has no line end takes over that missing end: the old last
  // line gets one, and the new one, now last, goes without.
  const last = at === lines.length - 1 && !src.endsWith("\n");
  if (last) lines[at] += eol === "\r\n" ? "\r" : "";
  else if (eol === "\r\n") line += "\r";
  lines.splice(at + 1, 0, line);
  return lines.join("\n");
}
