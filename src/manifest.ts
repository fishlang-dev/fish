import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CompileError } from "./diag.ts";

// A package as its `fish.toml` describes it, `dir` being where that file was found.
export type Manifest = { name: string; version: string; entry: string; dir: string };

export const MANIFEST = "fish.toml";

// A package name: lowercase letters, digits and '-', starting with a letter, as npm's and cargo's.
export const NAME_RULE = "a package name is lowercase letters, digits and '-', starting with a letter, at most 64 characters";
export const validName = (name: string) => /^[a-z][a-z0-9-]{0,63}$/.test(name);

type Spanned<T> = { value: T; start: number; end: number };
type Table = { start: number; end: number; keys: Map<string, { key: Spanned<string>; value: Spanned<string | number | boolean> }> };

// The TOML a manifest uses: comments, `[table]` headers, bare and quoted keys, basic and literal
// strings, integers and booleans. Anything else is refused where it starts rather than misread.
export function parseToml(src: string): Map<string, Table> {
  const tables = new Map<string, Table>();
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
        if (hex === 0 || !/^[0-9A-Fa-f]+$/.test(digits) || digits.length !== hex) throw new CompileError("this escape isn't one TOML has", at, at + 2);
        value += String.fromCodePoint(parseInt(digits, 16));
        at += 2 + hex;
        continue;
      }
      value += src[at];
      at++;
    }
    at++;
    return { value, start, end: at };
  };
  const value = (): Spanned<string | number | boolean> => {
    const start = at;
    if (src[at] === '"' || src[at] === "'") return string();
    const word = /^[^\s#]+/.exec(src.slice(at))?.[0] ?? "";
    at += word.length;
    if (word === "true" || word === "false") return { value: word === "true", start, end: at };
    if (/^[+-]?(0|[1-9]\d*)$/.test(word)) return { value: Number(word), start, end: at };
    if (word === "") throw new CompileError("expected a value after '='", start, start + 1);
    throw unread(start, word.startsWith("[") ? "an array" : word.startsWith("{") ? "an inline table" : "this value");
  };
  while (at < src.length) {
    space();
    if (src[at] === "\n" || src[at] === "#" || src.startsWith("\r\n", at) || at >= src.length) {
      endOfLine();
      continue;
    }
    if (src[at] === "[") {
      const start = at;
      if (src[at + 1] === "[") throw unread(at, "an array of tables");
      at++;
      space();
      const name = key();
      space();
      if (src[at] !== "]") throw new CompileError("expected ']' to close the table's name", at, at + 1);
      at++;
      if (tables.has(name.value)) throw new CompileError(`the table [${name.value}] is given twice`, start, at);
      current = { start, end: at, keys: new Map() };
      tables.set(name.value, current);
      endOfLine();
      continue;
    }
    const k = key();
    space();
    if (src[at] !== "=") throw new CompileError("expected '=' after the key", at, at + 1);
    at++;
    space();
    const v = value();
    if (current.keys.has(k.value)) throw new CompileError(`'${k.value}' is given twice`, k.start, k.end);
    current.keys.set(k.value, { key: k, value: v });
    endOfLine();
  }
  return tables;
}

// What a package's `fish.toml` says, checked: a `[package]` with a name and version, an optional
// entry, and nothing a manifest doesn't have, so a misspelled key isn't silently ignored.
export function readManifest(src: string, dir: string): Manifest {
  const tables = parseToml(src);
  const known: Record<string, string[]> = { "": [], package: ["name", "version", "entry"], dependencies: [] };
  for (const [name, table] of tables) {
    if (!(name in known)) throw new CompileError(`a manifest has no table [${name}]; it has [package] and [dependencies]`, table.start, table.end);
    for (const { key } of table.keys.values()) {
      if (name === "dependencies") throw new CompileError("dependencies aren't supported yet; a package builds from its own files for now", key.start, key.end);
      if (!known[name]!.includes(key.value)) {
        throw new CompileError(name === "" ? `'${key.value}' belongs in a table, such as [package]` : `[${name}] has no key '${key.value}'; it has ${known[name]!.join(", ")}`, key.start, key.end);
      }
    }
  }
  const pkg = tables.get("package");
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
  const entry = text("entry");
  if (entry && !entry.value.endsWith(".fsh")) throw new CompileError("the entry is a .fsh file, as in entry = \"src/main.fsh\"", entry.start, entry.end);
  return { name: name.value, version: version.value, entry: entry?.value ?? "src/main.fsh", dir };
}

// The nearest `fish.toml` at or above `from`.
export function findManifest(from: string): string | undefined {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const file = join(dir, MANIFEST);
    if (existsSync(file)) return file;
    if (dirname(dir) === dir) return undefined;
  }
}

// Reads and checks the manifest at `file`, whose entry must exist.
export function loadManifest(file: string): Manifest {
  const src = readFileSync(file, "utf8");
  const manifest = readManifest(src, dirname(file));
  if (!existsSync(join(manifest.dir, manifest.entry))) {
    const pkg = parseToml(src).get("package")!;
    const at = pkg.keys.get("entry")?.value ?? pkg;
    throw new CompileError(`the entry '${manifest.entry}' doesn't exist; create it, or name another with entry = "..."`, at.start, at.end);
  }
  return manifest;
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
