// Fish.toml and the TOML subset it is written in, in process through the compiler's manifest
// module, since the tests read what `parseToml` and `readManifest` give, which no command prints.
// A parsed value is compared through `shown`, which writes it out with its keys in order, and a
// dependency is compared without its span, its `start` and `end` stripped.
import { CompileError, formatError } from "../../src/diag.fsh";
import { parseToml, readManifest, type Dependency, type Manifest, type RustDependency, type SpannedValue, type Table, type TomlValue } from "../../src/manifest.fsh";

// The first line of the error a manifest gives, as the CLI prints it.
function refused(src: string): string {
  try {
    const _m = readManifest(src, "/p");
  } catch (e) {
    return formatError(e, "fish.toml", src).split("\n")[0];
  }
  return "the manifest was accepted";
}

function is(got: string, want: string, what: string): void {
  assert(got === want, `${what}:\n--- expected\n${want}\n--- got\n${got}`);
}

function has(got: string, part: string, what: string): void {
  assert(got.includes(part), `${what}: expected it to contain\n${part}\n--- got\n${got}`);
}

// The manifest `src` gives, failing the test when it is refused.
function manifest(src: string): Manifest {
  try {
    return readManifest(src, "/p");
  } catch (e) {
    assert(false, `the manifest was refused: ${formatError(e, "fish.toml", src)}`);
    return { name: "", version: "", entry: "", lib: "", edition: "native", dependencies: [], dir: "" };
  }
}

function toml(src: string): Map<string, Table | Table[]> {
  try {
    return parseToml(src);
  } catch (e) {
    assert(false, `the TOML was refused: ${formatError(e, "fish.toml", src)}`);
    return new Map();
  }
}

// The message parsing `src` throws, or "" when it is read.
function tomlError(src: string): string {
  try {
    const _t = parseToml(src);
    return "";
  } catch (e) {
    return e.message;
  }
}

function table(tables: Ref<Map<string, Table | Table[]>>, name: string): Table {
  const t = tables.get(name);
  if (t === undefined || Array.isArray(t)) {
    assert(false, `no table [${name}]`);
    return { start: 0, end: 0, keys: new Map() };
  }
  return t.clone();
}

// A TOML value written out: strings quoted as JSON, tables as { k = v, ... } in their order.
function shown(v: Ref<TomlValue>): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return `${v}`;
  if (v instanceof Map) {
    let parts: string[] = [];
    for (const [k, e] of v.entries()) parts.push(`${k} = ${shown(e.value.value)}`);
    return `{${parts.join(", ")}}`;
  }
  if (Array.isArray(v)) {
    let parts: string[] = [];
    for (const e of v) parts.push(shown(e.value));
    return `[${parts.join(", ")}]`;
  }
  return `${v}`;
}

function values(t: Ref<Table>): string {
  let parts: string[] = [];
  for (const e of t.keys.values()) parts.push(shown(e.value.value));
  return `[${parts.join(", ")}]`;
}

function key(t: Ref<Table>, name: string): string {
  const e = t.keys.get(name);
  if (e === undefined) return "missing";
  return shown(e.value.value);
}

// A dependency without its span.
function dep(d: Ref<Dependency>): string {
  if ("path" in d) return JSON.stringify({ name: d.name, path: d.path });
  if ("git" in d) return JSON.stringify({ name: d.name, git: d.git, rev: d.rev });
  return JSON.stringify({ name: d.name, version: d.version });
}

function deps(m: Ref<Manifest>): string {
  return `[${m.dependencies.map((d) => dep(d)).join(",")}]`;
}

// The manifest's Rust dependencies with their spans zeroed, or undefined when it has no table.
function crates(m: Ref<Manifest>): RustDependency[] | undefined {
  if (m.rustDependencies === undefined) return undefined;
  return m.rustDependencies.map((d): RustDependency => ({ ...d, start: 0, end: 0 }));
}

test("a manifest gives the package's name, version and entry", () => {
  const src = `# a comment\n[package]\nname = "hello-world" # trailing\nversion = '1.2.3-beta.1'\n\n[dependencies]\n`;
  const want: Manifest = { name: "hello-world", version: "1.2.3-beta.1", entry: "src/main.fsh", lib: "src/lib.fsh", edition: "native", dependencies: [], dir: "/p" };
  const got = manifest(src);
  assert(got === want, `the manifest: ${got.name} ${got.version} ${got.entry} ${got.lib} ${got.edition} ${deps(got)} ${got.dir} ${got.rustDependencies !== undefined} ${got.registry ?? "no registry"}`);
  is(manifest(`[package]\nname = "a"\nversion = "0.1.0"\nedition = "ts-compat"\n`).edition, "ts-compat", "the ts-compat edition");
  is(manifest(`[package]\nname = "a"\nversion = "0.1.0"\nedition = "native"\n`).edition, "native", "the native edition");
  is(manifest(`[package]\r\n"name" = "a"\r\nversion = "0.1.0"\r\nentry = "app/start.fsh"\r\n`).entry, "app/start.fsh", "the entry");
});

test("the TOML subset reads strings with escapes, integers and booleans", () => {
  const tables = toml(`[t]\na = "x\\"\\u00e9\\n"\nb = 'c:\\raw'\nc = -12\nd = true\n`);
  const t = table(tables, "t");
  is(values(t), `[${JSON.stringify('x"é\n')}, ${JSON.stringify("c:\\raw")}, -12, true]`, "the values");
});

test("a manifest missing what it needs, or holding what it doesn't have, is refused where it is", () => {
  is(refused(""), "fish.toml:1:1: error[E0905]: fish.toml needs a [package] table with the package's name and version", "an empty manifest");
  is(refused(`[package]\nversion = "1.0.0"\n`), "fish.toml:1:1: error[E0905]: [package] needs a 'name'", "no name");
  is(refused(`[package]\nname = "a"\n`), "fish.toml:1:1: error[E0905]: [package] needs a 'version'", "no version");
  is(refused(`[package]\nname = "Hello"\nversion = "1.0.0"\n`), "fish.toml:2:8: error[E0905]: a package name is lowercase letters, digits and '-', starting with a letter, at most 64 characters", "an upper-case name");
  has(refused(`[package]\nname = "${"a".repeat(65)}"\nversion = "1.0.0"\n`), "at most 64 characters", "a long name");
  is(refused(`[package]\nname = "a"\nversion = "1.0"\n`), `fish.toml:3:11: error[E0905]: a version is MAJOR.MINOR.PATCH, as in "0.1.0", with an optional pre-release such as "1.0.0-beta.1"`, "a short version");
  has(refused(`[package]\nname = "a"\nversion = "01.0.0"\n`), "a version is MAJOR.MINOR.PATCH", "a leading zero");
  is(refused(`[package]\nname = 1\nversion = "1.0.0"\n`), `fish.toml:2:8: error[E0905]: 'name' is a string, as in name = "..."`, "a number name");
  is(refused(`[package]\nname = "a"\nversion = "1.0.0"\nentry = "main.ts"\n`), `fish.toml:4:9: error[E0905]: the entry is a .fsh file, as in entry = "src/main.fsh"`, "a .ts entry");
  is(refused(`[package]\nnmae = "a"\n`), "fish.toml:2:1: error[E0905]: [package] has no key 'nmae'; it has name, version, entry, lib, edition", "a misspelled key");
  is(refused(`[package]\nname = "a"\nversion = "1.0.0"\nedition = "ts"\n`), `fish.toml:4:11: error[E0905]: 'ts' isn't an edition; it is "native", the default, or "ts-compat" for TypeScript not yet migrated`, "an unknown edition");
  is(refused(`name = "a"\n`), "fish.toml:1:1: error[E0905]: 'name' belongs in a table, such as [package]", "a key outside a table");
  is(refused(`[package]\nname = "a"\nversion = "1.0.0"\n[dev]\n`), "fish.toml:4:1: error[E0905]: a manifest has no table [dev]; it has [package], [dependencies], [rust-dependencies] and [registry]", "an unknown table");
  is(refused(`[package]\nname = "a"\nname = "b"\n`), "fish.toml:3:1: error[E0904]: 'name' is given twice", "a key twice");
  is(refused(`[package]\nname = "a"\n[package]\n`), "fish.toml:3:1: error[E0904]: the table [package] is given twice", "a table twice");
});

test("TOML a manifest doesn't use is refused where it starts", () => {
  is(refused(`[package]\nname = ["a"]\n`), `fish.toml:2:8: error[E0905]: 'name' is a string, as in name = "..."`, "an array name");
  is(refused(`[package]\nname = 1.5\n`), "fish.toml:2:8: error[E0904]: this value is TOML Fish doesn't read in a manifest yet", "a float");
  is(refused(`[package]\nname = """a"""\n`), "fish.toml:2:8: error[E0904]: a multi-line string is TOML Fish doesn't read in a manifest yet", "a multi-line string");
  is(refused(`[package.x]\n`), "fish.toml:1:9: error[E0904]: a dotted key is TOML Fish doesn't read in a manifest yet", "a dotted key");
  is(refused(`[[package]]\n`), "fish.toml:1:1: error[E0905]: a manifest has no table [package]; it has [package], [dependencies], [rust-dependencies] and [registry]", "an array of packages");
  is(refused(`[package]\nname = "a\n`), "fish.toml:2:8: error[E0904]: this string isn't closed on its line", "an open string");
  is(refused(`[package]\nname = "a" b\n`), "fish.toml:2:12: error[E0904]: expected the end of the line here", "trailing text");
  is(refused(`[package]\nname "a"\n`), "fish.toml:2:6: error[E0904]: expected '=' after the key", "no '='");
  is(refused(`[package]\nname = "\\q"\n`), "fish.toml:2:9: error[E0904]: this escape isn't one TOML has", "\\q");
  is(refused(`[package]\nname = "\\U00110000"\n`), "fish.toml:2:9: error[E0904]: this escape isn't one TOML has", "\\U00110000");
  is(refused(`[package]\nname = "\\uD800"\n`), "fish.toml:2:9: error[E0904]: this escape isn't one TOML has", "\\uD800");
  is(refused(`[package]\nname = "a"\nversion = "1.0.0"\nentry = "/abs/main.fsh"\n`), `fish.toml:4:9: error[E0905]: the entry is a file inside the package, as in entry = "src/main.fsh"`, "an absolute entry");
});

test("inline tables and arrays of tables are read", () => {
  const tables = toml(`a = { x = 1, y = { z = "q" } , e = {} }\n[[p]]\nn = 1\n[[p]]\nn = 2\n`);
  is(key(table(tables, ""), "a"), `{x = 1, y = {z = "q"}, e = {}}`, "the inline table");
  const p = tables.get("p");
  if (p === undefined || !Array.isArray(p)) assert(false, "[[p]] isn't an array of tables");
  else is(`[${p.map((t) => key(t, "n")).join(", ")}]`, "[1, 2]", "the array of tables");
  has(tomlError(`[p]\n[[p]]\n`), "the table [p] is given twice", "[p] then [[p]]");
  has(tomlError(`a = { x = 1 y = 2 }\n`), "expected ',' or '}' in this inline table", "no comma");
  has(tomlError(`a = { x = 1, x = 2 }\n`), "'x' is given twice", "a key twice");
});

test("dependencies come from a path or a git commit, and lib names what a package exports", () => {
  const m = manifest(`[package]\nname = "app"\nversion = "0.1.0"\nlib = "src/api.fsh"\n[dependencies]\nutil = { path = "../util" }\nhttp = { git = "https://example.com/http.git", rev = "3f2a9c1" }\n`);
  is(m.lib, "src/api.fsh", "the lib");
  is(deps(m), `[{"name":"util","path":"../util"},{"git":"https://example.com/http.git","name":"http","rev":"3f2a9c1"}]`, "the dependencies");
  const pkg = `[package]\nname = "app"\nversion = "0.1.0"\n[dependencies]\n`;
  is(refused(pkg + `util = "1.0"\n`), `fish.toml:5:8: error[E0905]: a dependency is a table naming where it comes from, as in { version = "^1.2.0" }, { path = "../util" } or { git = "https://...", rev = "<commit>" }`, "a string dependency");
  has(refused(pkg + `Util = { path = "x" }\n`), "fish.toml:5:1: error[E0905]: 'Util' isn't a package name", "an upper-case dependency");
  is(refused(pkg + `util = { pth = "x" }\n`), "fish.toml:5:10: error[E0905]: a dependency has no key 'pth'; it has version, path, or git and rev", "a misspelled key");
  is(refused(pkg + `util = { path = "x", git = "y", rev = "abcdef1" }\n`), "fish.toml:5:8: error[E0905]: a dependency comes from one place: the registry by version, a path, or git", "two places");
  is(refused(pkg + `util = { git = "https://x" }\n`), `fish.toml:5:8: error[E0905]: a git dependency is pinned to a commit, as in rev = "3f2a9c1"; branches and tags move`, "no rev");
  is(refused(pkg + `util = { git = "https://x", rev = "main" }\n`), "fish.toml:5:35: error[E0905]: rev is a commit's hash, 7 to 40 lowercase hex digits; branches and tags move", "a branch rev");
  is(refused(pkg + `util = { git = "--upload-pack=x", rev = "abcdef1" }\n`), "fish.toml:5:16: error[E0905]: a git URL can't start with '-'", "a flag URL");
  is(refused(pkg + `util = { path = 1 }\n`), "fish.toml:5:17: error[E0905]: 'path' is a string", "a number path");
  is(refused(`[package]\nname = "a"\nversion = "1.0.0"\nlib = "x.ts"\n`), `fish.toml:4:7: error[E0905]: the lib is a .fsh file, as in lib = "src/lib.fsh"`, "a .ts lib");
});

test("a registry dependency names an npm-style version range", () => {
  const pkg = `[package]\nname = "app"\nversion = "0.1.0"\n[dependencies]\n`;
  is(deps(manifest(pkg + `http = { version = "^1.2.0" }\nlog = { version = ">=1.0.0 <2.0.0 || 3.x" }\n`)), `[{"name":"http","version":"^1.2.0"},{"name":"log","version":">=1.0.0 <2.0.0 || 3.x"}]`, "the dependencies");
  is(refused(pkg + `http = { version = "latest" }\n`), `fish.toml:5:20: error[E0905]: 'latest' isn't a version range; write one as package.json does, as in "^1.2.0" or ">=1.0.0 <2.0.0"`, "latest");
  is(refused(pkg + `http = { version = "^1.0.0", path = "../http" }\n`), "fish.toml:5:8: error[E0905]: a dependency comes from one place: the registry by version, a path, or git", "a version and a path");
  is(refused(pkg + `http = { version = "^1.0.0", rev = "abcdef1" }\n`), "fish.toml:5:36: error[E0905]: rev pins a git dependency; a registry one is chosen by its version range", "a version and a rev");
});

test("arrays are read over several lines, with comments and a trailing comma", () => {
  const t = table(toml(`[t]\na = ["x", 'y']\nb = [\n  1, # one\n  2,\n]\nc = []\n`), "t");
  is(`${key(t, "a")} ${key(t, "b")} ${key(t, "c")}`, `["x", "y"] [1, 2] []`, "the arrays");
  has(tomlError(`a = [1 2]\n`), "expected ',' or ']' in this array", "no comma");
  has(tomlError(`a = [1,\n`), "this array isn't closed", "an open array");
});

test("[rust-dependencies] takes Cargo's forms", () => {
  const pkg = `[package]\nname = "app"\nversion = "0.1.0"\n[rust-dependencies]\n`;
  const read = (lines: string): RustDependency[] | undefined => crates(manifest(pkg + lines));
  const one: RustDependency[] = [{ name: "serde", version: "1.0", start: 0, end: 0 }];
  assert(read(`serde = "1.0"\n`) === one, "serde = \"1.0\"");
  const featured: RustDependency[] = [{ name: "serde", version: "1", features: ["derive", "std"], defaultFeatures: false, start: 0, end: 0 }];
  assert(read(`serde = { version = "1", features = ["derive", "std"], default-features = false }\n`) === featured, "serde with features");
  const pathed: RustDependency[] = [{ name: "my_crate", path: "rust/my_crate", start: 0, end: 0 }];
  assert(read(`my_crate = { path = "rust/my_crate" }\n`) === pathed, "a path crate");
  const gits: RustDependency[] = [
    { name: "a-b", git: "https://example.com/a.git", rev: "3f2a9c1", start: 0, end: 0 },
    { name: "c", git: "https://x", tag: "v1", start: 0, end: 0 },
    { name: "d", git: "https://x", branch: "main", start: 0, end: 0 },
    { name: "e", git: "https://x", start: 0, end: 0 },
  ];
  assert(read(`a-b = { git = "https://example.com/a.git", rev = "3f2a9c1" }\nc = { git = "https://x", tag = "v1" }\nd = { git = "https://x", branch = "main" }\ne = { git = "https://x" }\n`) === gits, "git crates");
  const none: RustDependency[] = [];
  assert(crates(manifest(pkg)) === none, "an empty [rust-dependencies]");
  assert(manifest(`[package]\nname = "app"\nversion = "0.1.0"\n`).rustDependencies === undefined, "no [rust-dependencies]");
});

test("a malformed Rust dependency is refused where it is", () => {
  const pkg = `[package]\nname = "app"\nversion = "0.1.0"\n[rust-dependencies]\n`;
  is(refused(pkg + `1x = "1"\n`), "fish.toml:5:1: error[E0905]: '1x' isn't a crate name; a crate's name is letters, digits, '_' and '-', starting with a letter or '_'", "a digit name");
  has(refused(pkg + `a = 1\n`), "fish.toml:5:5: error[E0905]: a Rust dependency is a version", "a number");
  has(refused(pkg + `a = { features = ["x"] }\n`), "fish.toml:5:5: error[E0905]: a Rust dependency is a version", "no source");
  is(refused(pkg + `a = { verson = "1" }\n`), "fish.toml:5:7: error[E0905]: a Rust dependency has no key 'verson'; it has version, features, default-features, path, git, rev, tag, branch", "a misspelled key");
  is(refused(pkg + `a = { version = 1 }\n`), "fish.toml:5:17: error[E0905]: 'version' is a string", "a number version");
  is(refused(pkg + `a = { version = "1", features = "x" }\n`), `fish.toml:5:33: error[E0905]: 'features' is a list of strings, as in features = ["derive"]`, "a string features");
  is(refused(pkg + `a = { version = "1", features = [1] }\n`), `fish.toml:5:33: error[E0905]: 'features' is a list of strings, as in features = ["derive"]`, "number features");
  is(refused(pkg + `a = { version = "1", default-features = "no" }\n`), "fish.toml:5:41: error[E0905]: 'default-features' is true or false", "a string default-features");
  is(refused(pkg + `a = { path = "x", git = "y" }\n`), "fish.toml:5:5: error[E0905]: a Rust dependency comes from a path or from git, not both", "a path and git");
  is(refused(pkg + `a = { version = "1", rev = "abc" }\n`), "fish.toml:5:28: error[E0905]: rev, tag and branch choose a git dependency's commit; this one isn't from git", "a rev without git");
  is(refused(pkg + `a = { git = "y", rev = "abc", tag = "v1" }\n`), "fish.toml:5:37: error[E0905]: a git dependency takes one of rev, tag and branch", "a rev and a tag");
});
