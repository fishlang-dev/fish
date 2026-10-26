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
  expect(readManifest(src, "/p")).toEqual({ name: "hello-world", version: "1.2.3-beta.1", entry: "src/main.fsh", lib: "src/lib.fsh", dependencies: [], dir: "/p" });
  expect(readManifest(`[package]\r\n"name" = "a"\r\nversion = "0.1.0"\r\nentry = "app/start.fsh"\r\n`, "/p").entry).toBe("app/start.fsh");
});

test("the TOML subset reads strings with escapes, integers and booleans", () => {
  const t = parseToml(`[t]\na = "x\\"\\u00e9\\n"\nb = 'c:\\raw'\nc = -12\nd = true\n`).get("t") as Table;
  expect([...t.keys.values()].map((k) => k.value.value)).toEqual(['x"é\n', "c:\\raw", -12, true]);
});

test("a manifest missing what it needs, or holding what it doesn't have, is refused where it is", () => {
  expect(refused("")).toBe("fish.toml:1:1: error: fish.toml needs a [package] table with the package's name and version");
  expect(refused(`[package]\nversion = "1.0.0"\n`)).toBe("fish.toml:1:1: error: [package] needs a 'name'");
  expect(refused(`[package]\nname = "a"\n`)).toBe("fish.toml:1:1: error: [package] needs a 'version'");
  expect(refused(`[package]\nname = "Hello"\nversion = "1.0.0"\n`)).toBe("fish.toml:2:8: error: a package name is lowercase letters, digits and '-', starting with a letter, at most 64 characters");
  expect(refused(`[package]\nname = "${"a".repeat(65)}"\nversion = "1.0.0"\n`)).toContain("at most 64 characters");
  expect(refused(`[package]\nname = "a"\nversion = "1.0"\n`)).toBe(`fish.toml:3:11: error: a version is MAJOR.MINOR.PATCH, as in "0.1.0", with an optional pre-release such as "1.0.0-beta.1"`);
  expect(refused(`[package]\nname = "a"\nversion = "01.0.0"\n`)).toContain("a version is MAJOR.MINOR.PATCH");
  expect(refused(`[package]\nname = 1\nversion = "1.0.0"\n`)).toBe(`fish.toml:2:8: error: 'name' is a string, as in name = "..."`);
  expect(refused(`[package]\nname = "a"\nversion = "1.0.0"\nentry = "main.ts"\n`)).toBe(`fish.toml:4:9: error: the entry is a .fsh file, as in entry = "src/main.fsh"`);
  expect(refused(`[package]\nnmae = "a"\n`)).toBe("fish.toml:2:1: error: [package] has no key 'nmae'; it has name, version, entry, lib");
  expect(refused(`name = "a"\n`)).toBe("fish.toml:1:1: error: 'name' belongs in a table, such as [package]");
  expect(refused(`[package]\nname = "a"\nversion = "1.0.0"\n[dev]\n`)).toBe("fish.toml:4:1: error: a manifest has no table [dev]; it has [package], [dependencies] and [registry]");
  expect(refused(`[package]\nname = "a"\nname = "b"\n`)).toBe("fish.toml:3:1: error: 'name' is given twice");
  expect(refused(`[package]\nname = "a"\n[package]\n`)).toBe("fish.toml:3:1: error: the table [package] is given twice");
});

test("TOML a manifest doesn't use is refused where it starts", () => {
  expect(refused(`[package]\nname = ["a"]\n`)).toBe("fish.toml:2:8: error: an array is TOML Fish doesn't read in a manifest yet");
  expect(refused(`[package]\nname = 1.5\n`)).toBe("fish.toml:2:8: error: this value is TOML Fish doesn't read in a manifest yet");
  expect(refused(`[package]\nname = """a"""\n`)).toBe("fish.toml:2:8: error: a multi-line string is TOML Fish doesn't read in a manifest yet");
  expect(refused(`[package.x]\n`)).toBe("fish.toml:1:9: error: a dotted key is TOML Fish doesn't read in a manifest yet");
  expect(refused(`[[package]]\n`)).toBe("fish.toml:1:1: error: a manifest has no table [package]; it has [package], [dependencies] and [registry]");
  expect(refused(`[package]\nname = "a\n`)).toBe("fish.toml:2:8: error: this string isn't closed on its line");
  expect(refused(`[package]\nname = "a" b\n`)).toBe("fish.toml:2:12: error: expected the end of the line here");
  expect(refused(`[package]\nname "a"\n`)).toBe("fish.toml:2:6: error: expected '=' after the key");
  expect(refused(`[package]\nname = "\\q"\n`)).toBe("fish.toml:2:9: error: this escape isn't one TOML has");
  expect(refused(`[package]\nname = "\\U00110000"\n`)).toBe("fish.toml:2:9: error: this escape isn't one TOML has");
  expect(refused(`[package]\nname = "\\uD800"\n`)).toBe("fish.toml:2:9: error: this escape isn't one TOML has");
  expect(refused(`[package]\nname = "a"\nversion = "1.0.0"\nentry = "/abs/main.fsh"\n`)).toBe(`fish.toml:4:9: error: the entry is a file inside the package, as in entry = "src/main.fsh"`);
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
  expect(refused(pkg + `util = "1.0"\n`)).toBe(`fish.toml:5:8: error: a dependency is a table naming where it comes from, as in { version = "^1.2.0" }, { path = "../util" } or { git = "https://...", rev = "<commit>" }`);
  expect(refused(pkg + `Util = { path = "x" }\n`)).toContain("fish.toml:5:1: error: 'Util' isn't a package name");
  expect(refused(pkg + `util = { pth = "x" }\n`)).toBe("fish.toml:5:10: error: a dependency has no key 'pth'; it has version, path, or git and rev");
  expect(refused(pkg + `util = { path = "x", git = "y", rev = "abcdef1" }\n`)).toBe("fish.toml:5:8: error: a dependency comes from one place: the registry by version, a path, or git");
  expect(refused(pkg + `util = { git = "https://x" }\n`)).toBe(`fish.toml:5:8: error: a git dependency is pinned to a commit, as in rev = "3f2a9c1"; branches and tags move`);
  expect(refused(pkg + `util = { git = "https://x", rev = "main" }\n`)).toBe("fish.toml:5:35: error: rev is a commit's hash, 7 to 40 lowercase hex digits; branches and tags move");
  expect(refused(pkg + `util = { git = "--upload-pack=x", rev = "abcdef1" }\n`)).toBe("fish.toml:5:16: error: a git URL can't start with '-'");
  expect(refused(pkg + `util = { path = 1 }\n`)).toBe("fish.toml:5:17: error: 'path' is a string");
  expect(refused(`[package]\nname = "a"\nversion = "1.0.0"\nlib = "x.ts"\n`)).toBe(`fish.toml:4:7: error: the lib is a .fsh file, as in lib = "src/lib.fsh"`);
});

test("a registry dependency names an npm-style version range", () => {
  const pkg = `[package]\nname = "app"\nversion = "0.1.0"\n[dependencies]\n`;
  expect(readManifest(pkg + `http = { version = "^1.2.0" }\nlog = { version = ">=1.0.0 <2.0.0 || 3.x" }\n`, "/p").dependencies.map(({ start, end, ...d }) => d)).toEqual([{ name: "http", version: "^1.2.0" }, { name: "log", version: ">=1.0.0 <2.0.0 || 3.x" }]);
  expect(refused(pkg + `http = { version = "latest" }\n`)).toBe(`fish.toml:5:20: error: 'latest' isn't a version range; write one as package.json does, as in "^1.2.0" or ">=1.0.0 <2.0.0"`);
  expect(refused(pkg + `http = { version = "^1.0.0", path = "../http" }\n`)).toBe("fish.toml:5:8: error: a dependency comes from one place: the registry by version, a path, or git");
  expect(refused(pkg + `http = { version = "^1.0.0", rev = "abcdef1" }\n`)).toBe("fish.toml:5:36: error: rev pins a git dependency; a registry one is chosen by its version range");
});
