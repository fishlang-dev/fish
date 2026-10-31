import { expect, test } from "bun:test";
import { CompileError, formatError } from "../src/diag.ts";
import { parseToml, readManifest, type Table } from "../src/manifest.ts";

// The first line of the error a manifest gives, as the CLI prints it.
function refused(src: string): string {
  try {
    readManifest(src, "/p");
  } catch (e) {
    if (e instanceof CompileError) return formatError(e, "fish.toml", src).split("\n")[0]!;
    throw e;
  }
  throw new Error("the manifest was accepted");
}

test("a manifest gives the package's name, version and entry", () => {
  const src = `# a comment\n[package]\nname = "hello-world" # trailing\nversion = '1.2.3-beta.1'\n\n[dependencies]\n`;
  expect(readManifest(src, "/p")).toEqual({ name: "hello-world", version: "1.2.3-beta.1", entry: "src/main.fsh", lib: "src/lib.fsh", edition: "native", dependencies: [], dir: "/p" });
  expect(readManifest(`[package]\nname = "a"\nversion = "0.1.0"\nedition = "ts-compat"\n`, "/p").edition).toBe("ts-compat");
  expect(readManifest(`[package]\nname = "a"\nversion = "0.1.0"\nedition = "native"\n`, "/p").edition).toBe("native");
  expect(readManifest(`[package]\r\n"name" = "a"\r\nversion = "0.1.0"\r\nentry = "app/start.fsh"\r\n`, "/p").entry).toBe("app/start.fsh");
});

test("the TOML subset reads strings with escapes, integers and booleans", () => {
  const t = parseToml(`[t]\na = "x\\"\\u00e9\\n"\nb = 'c:\\raw'\nc = -12\nd = true\n`).get("t") as Table;
  expect([...t.keys.values()].map((k) => k.value.value)).toEqual(['x"é\n', "c:\\raw", -12, true]);
});

test("a manifest missing what it needs, or holding what it doesn't have, is refused where it is", () => {
  expect(refused("")).toBe("fish.toml:1:1: error[E0905]: fish.toml needs a [package] table with the package's name and version");
  expect(refused(`[package]\nversion = "1.0.0"\n`)).toBe("fish.toml:1:1: error[E0905]: [package] needs a 'name'");
  expect(refused(`[package]\nname = "a"\n`)).toBe("fish.toml:1:1: error[E0905]: [package] needs a 'version'");
  expect(refused(`[package]\nname = "Hello"\nversion = "1.0.0"\n`)).toBe("fish.toml:2:8: error[E0905]: a package name is lowercase letters, digits and '-', starting with a letter, at most 64 characters");
  expect(refused(`[package]\nname = "${"a".repeat(65)}"\nversion = "1.0.0"\n`)).toContain("at most 64 characters");
  expect(refused(`[package]\nname = "a"\nversion = "1.0"\n`)).toBe(`fish.toml:3:11: error[E0905]: a version is MAJOR.MINOR.PATCH, as in "0.1.0", with an optional pre-release such as "1.0.0-beta.1"`);
  expect(refused(`[package]\nname = "a"\nversion = "01.0.0"\n`)).toContain("a version is MAJOR.MINOR.PATCH");
  expect(refused(`[package]\nname = 1\nversion = "1.0.0"\n`)).toBe(`fish.toml:2:8: error[E0905]: 'name' is a string, as in name = "..."`);
  expect(refused(`[package]\nname = "a"\nversion = "1.0.0"\nentry = "main.ts"\n`)).toBe(`fish.toml:4:9: error[E0905]: the entry is a .fsh file, as in entry = "src/main.fsh"`);
  expect(refused(`[package]\nnmae = "a"\n`)).toBe("fish.toml:2:1: error[E0905]: [package] has no key 'nmae'; it has name, version, entry, lib, edition");
  expect(refused(`[package]\nname = "a"\nversion = "1.0.0"\nedition = "ts"\n`)).toBe(`fish.toml:4:11: error[E0905]: 'ts' isn't an edition; it is "native", the default, or "ts-compat" for TypeScript not yet migrated`);
  expect(refused(`name = "a"\n`)).toBe("fish.toml:1:1: error[E0905]: 'name' belongs in a table, such as [package]");
  expect(refused(`[package]\nname = "a"\nversion = "1.0.0"\n[dev]\n`)).toBe("fish.toml:4:1: error[E0905]: a manifest has no table [dev]; it has [package], [dependencies], [rust-dependencies] and [registry]");
  expect(refused(`[package]\nname = "a"\nname = "b"\n`)).toBe("fish.toml:3:1: error[E0904]: 'name' is given twice");
  expect(refused(`[package]\nname = "a"\n[package]\n`)).toBe("fish.toml:3:1: error[E0904]: the table [package] is given twice");
});

test("TOML a manifest doesn't use is refused where it starts", () => {
  expect(refused(`[package]\nname = ["a"]\n`)).toBe(`fish.toml:2:8: error[E0905]: 'name' is a string, as in name = "..."`);
  expect(refused(`[package]\nname = 1.5\n`)).toBe("fish.toml:2:8: error[E0904]: this value is TOML Fish doesn't read in a manifest yet");
  expect(refused(`[package]\nname = """a"""\n`)).toBe("fish.toml:2:8: error[E0904]: a multi-line string is TOML Fish doesn't read in a manifest yet");
  expect(refused(`[package.x]\n`)).toBe("fish.toml:1:9: error[E0904]: a dotted key is TOML Fish doesn't read in a manifest yet");
  expect(refused(`[[package]]\n`)).toBe("fish.toml:1:1: error[E0905]: a manifest has no table [package]; it has [package], [dependencies], [rust-dependencies] and [registry]");
  expect(refused(`[package]\nname = "a\n`)).toBe("fish.toml:2:8: error[E0904]: this string isn't closed on its line");
  expect(refused(`[package]\nname = "a" b\n`)).toBe("fish.toml:2:12: error[E0904]: expected the end of the line here");
  expect(refused(`[package]\nname "a"\n`)).toBe("fish.toml:2:6: error[E0904]: expected '=' after the key");
  expect(refused(`[package]\nname = "\\q"\n`)).toBe("fish.toml:2:9: error[E0904]: this escape isn't one TOML has");
  expect(refused(`[package]\nname = "\\U00110000"\n`)).toBe("fish.toml:2:9: error[E0904]: this escape isn't one TOML has");
  expect(refused(`[package]\nname = "\\uD800"\n`)).toBe("fish.toml:2:9: error[E0904]: this escape isn't one TOML has");
  expect(refused(`[package]\nname = "a"\nversion = "1.0.0"\nentry = "/abs/main.fsh"\n`)).toBe(`fish.toml:4:9: error[E0905]: the entry is a file inside the package, as in entry = "src/main.fsh"`);
});

test("inline tables and arrays of tables are read", () => {
  const toml = parseToml(`a = { x = 1, y = { z = "q" } , e = {} }\n[[p]]\nn = 1\n[[p]]\nn = 2\n`);
  const a = (toml.get("") as Table).keys.get("a")!.value.value as Map<string, { value: { value: unknown } }>;
  expect([...a.keys()]).toEqual(["x", "y", "e"]);
  expect(((a.get("y")!.value.value as Map<string, { value: { value: unknown } }>).get("z")!.value.value)).toBe("q");
  expect((toml.get("p") as Table[]).map((t) => t.keys.get("n")!.value.value)).toEqual([1, 2]);
  expect(() => parseToml(`[p]\n[[p]]\n`)).toThrow("the table [p] is given twice");
  expect(() => parseToml(`a = { x = 1 y = 2 }\n`)).toThrow("expected ',' or '}' in this inline table");
  expect(() => parseToml(`a = { x = 1, x = 2 }\n`)).toThrow("'x' is given twice");
});

test("dependencies come from a path or a git commit, and lib names what a package exports", () => {
  const m = readManifest(`[package]\nname = "app"\nversion = "0.1.0"\nlib = "src/api.fsh"\n[dependencies]\nutil = { path = "../util" }\nhttp = { git = "https://example.com/http.git", rev = "3f2a9c1" }\n`, "/p");
  expect(m.lib).toBe("src/api.fsh");
  expect(m.dependencies.map(({ start, end, ...d }) => d)).toEqual([{ name: "util", path: "../util" }, { name: "http", git: "https://example.com/http.git", rev: "3f2a9c1" }]);
  const pkg = `[package]\nname = "app"\nversion = "0.1.0"\n[dependencies]\n`;
  expect(refused(pkg + `util = "1.0"\n`)).toBe(`fish.toml:5:8: error[E0905]: a dependency is a table naming where it comes from, as in { version = "^1.2.0" }, { path = "../util" } or { git = "https://...", rev = "<commit>" }`);
  expect(refused(pkg + `Util = { path = "x" }\n`)).toContain("fish.toml:5:1: error[E0905]: 'Util' isn't a package name");
  expect(refused(pkg + `util = { pth = "x" }\n`)).toBe("fish.toml:5:10: error[E0905]: a dependency has no key 'pth'; it has version, path, or git and rev");
  expect(refused(pkg + `util = { path = "x", git = "y", rev = "abcdef1" }\n`)).toBe("fish.toml:5:8: error[E0905]: a dependency comes from one place: the registry by version, a path, or git");
  expect(refused(pkg + `util = { git = "https://x" }\n`)).toBe(`fish.toml:5:8: error[E0905]: a git dependency is pinned to a commit, as in rev = "3f2a9c1"; branches and tags move`);
  expect(refused(pkg + `util = { git = "https://x", rev = "main" }\n`)).toBe("fish.toml:5:35: error[E0905]: rev is a commit's hash, 7 to 40 lowercase hex digits; branches and tags move");
  expect(refused(pkg + `util = { git = "--upload-pack=x", rev = "abcdef1" }\n`)).toBe("fish.toml:5:16: error[E0905]: a git URL can't start with '-'");
  expect(refused(pkg + `util = { path = 1 }\n`)).toBe("fish.toml:5:17: error[E0905]: 'path' is a string");
  expect(refused(`[package]\nname = "a"\nversion = "1.0.0"\nlib = "x.ts"\n`)).toBe(`fish.toml:4:7: error[E0905]: the lib is a .fsh file, as in lib = "src/lib.fsh"`);
});

test("a registry dependency names an npm-style version range", () => {
  const pkg = `[package]\nname = "app"\nversion = "0.1.0"\n[dependencies]\n`;
  expect(readManifest(pkg + `http = { version = "^1.2.0" }\nlog = { version = ">=1.0.0 <2.0.0 || 3.x" }\n`, "/p").dependencies.map(({ start, end, ...d }) => d)).toEqual([{ name: "http", version: "^1.2.0" }, { name: "log", version: ">=1.0.0 <2.0.0 || 3.x" }]);
  expect(refused(pkg + `http = { version = "latest" }\n`)).toBe(`fish.toml:5:20: error[E0905]: 'latest' isn't a version range; write one as package.json does, as in "^1.2.0" or ">=1.0.0 <2.0.0"`);
  expect(refused(pkg + `http = { version = "^1.0.0", path = "../http" }\n`)).toBe("fish.toml:5:8: error[E0905]: a dependency comes from one place: the registry by version, a path, or git");
  expect(refused(pkg + `http = { version = "^1.0.0", rev = "abcdef1" }\n`)).toBe("fish.toml:5:36: error[E0905]: rev pins a git dependency; a registry one is chosen by its version range");
});

test("arrays are read over several lines, with comments and a trailing comma", () => {
  const t = parseToml(`[t]\na = ["x", 'y']\nb = [\n  1, # one\n  2,\n]\nc = []\n`).get("t") as Table;
  const values = (k: string) => (t.keys.get(k)!.value.value as { value: unknown }[]).map((v) => v.value);
  expect([values("a"), values("b"), values("c")]).toEqual([["x", "y"], [1, 2], []]);
  expect(() => parseToml(`a = [1 2]\n`)).toThrow("expected ',' or ']' in this array");
  expect(() => parseToml(`a = [1,\n`)).toThrow("this array isn't closed");
});

test("[rust-dependencies] takes Cargo's forms", () => {
  const pkg = `[package]\nname = "app"\nversion = "0.1.0"\n[rust-dependencies]\n`;
  const read = (lines: string) => readManifest(pkg + lines, "/p").rustDependencies!.map(({ start, end, ...d }) => d);
  expect(read(`serde = "1.0"\n`)).toEqual([{ name: "serde", version: "1.0" }]);
  expect(read(`serde = { version = "1", features = ["derive", "std"], default-features = false }\n`)).toEqual([{ name: "serde", version: "1", features: ["derive", "std"], defaultFeatures: false }]);
  expect(read(`my_crate = { path = "rust/my_crate" }\n`)).toEqual([{ name: "my_crate", path: "rust/my_crate" }]);
  expect(read(`a-b = { git = "https://example.com/a.git", rev = "3f2a9c1" }\nc = { git = "https://x", tag = "v1" }\nd = { git = "https://x", branch = "main" }\ne = { git = "https://x" }\n`)).toEqual([
    { name: "a-b", git: "https://example.com/a.git", rev: "3f2a9c1" }, { name: "c", git: "https://x", tag: "v1" }, { name: "d", git: "https://x", branch: "main" }, { name: "e", git: "https://x" },
  ]);
  expect(readManifest(pkg, "/p").rustDependencies).toEqual([]);
  expect(readManifest(`[package]\nname = "app"\nversion = "0.1.0"\n`, "/p").rustDependencies).toBeUndefined();
});

test("a malformed Rust dependency is refused where it is", () => {
  const pkg = `[package]\nname = "app"\nversion = "0.1.0"\n[rust-dependencies]\n`;
  expect(refused(pkg + `1x = "1"\n`)).toBe("fish.toml:5:1: error[E0905]: '1x' isn't a crate name; a crate's name is letters, digits, '_' and '-', starting with a letter or '_'");
  expect(refused(pkg + `a = 1\n`)).toContain("fish.toml:5:5: error[E0905]: a Rust dependency is a version");
  expect(refused(pkg + `a = { features = ["x"] }\n`)).toContain("fish.toml:5:5: error[E0905]: a Rust dependency is a version");
  expect(refused(pkg + `a = { verson = "1" }\n`)).toBe("fish.toml:5:7: error[E0905]: a Rust dependency has no key 'verson'; it has version, features, default-features, path, git, rev, tag, branch");
  expect(refused(pkg + `a = { version = 1 }\n`)).toBe("fish.toml:5:17: error[E0905]: 'version' is a string");
  expect(refused(pkg + `a = { version = "1", features = "x" }\n`)).toBe(`fish.toml:5:33: error[E0905]: 'features' is a list of strings, as in features = ["derive"]`);
  expect(refused(pkg + `a = { version = "1", features = [1] }\n`)).toBe(`fish.toml:5:33: error[E0905]: 'features' is a list of strings, as in features = ["derive"]`);
  expect(refused(pkg + `a = { version = "1", default-features = "no" }\n`)).toBe("fish.toml:5:41: error[E0905]: 'default-features' is true or false");
  expect(refused(pkg + `a = { path = "x", git = "y" }\n`)).toBe("fish.toml:5:5: error[E0905]: a Rust dependency comes from a path or from git, not both");
  expect(refused(pkg + `a = { version = "1", rev = "abc" }\n`)).toBe("fish.toml:5:28: error[E0905]: rev, tag and branch choose a git dependency's commit; this one isn't from git");
  expect(refused(pkg + `a = { git = "y", rev = "abc", tag = "v1" }\n`)).toBe("fish.toml:5:37: error[E0905]: a git dependency takes one of rev, tag and branch");
});
