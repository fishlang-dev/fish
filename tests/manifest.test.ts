import { expect, test } from "bun:test";
import { CompileError, formatError } from "../src/diag.ts";
import { parseToml, readManifest } from "../src/manifest.ts";

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
  expect(readManifest(src, "/p")).toEqual({ name: "hello-world", version: "1.2.3-beta.1", entry: "src/main.fsh", dir: "/p" });
  expect(readManifest(`[package]\r\n"name" = "a"\r\nversion = "0.1.0"\r\nentry = "app/start.fsh"\r\n`, "/p").entry).toBe("app/start.fsh");
});

test("the TOML subset reads strings with escapes, integers and booleans", () => {
  const t = parseToml(`[t]\na = "x\\"\\u00e9\\n"\nb = 'c:\\raw'\nc = -12\nd = true\n`).get("t")!;
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
  expect(refused(`[package]\nnmae = "a"\n`)).toBe("fish.toml:2:1: error: [package] has no key 'nmae'; it has name, version, entry");
  expect(refused(`name = "a"\n`)).toBe("fish.toml:1:1: error: 'name' belongs in a table, such as [package]");
  expect(refused(`[package]\nname = "a"\nversion = "1.0.0"\n[dev]\n`)).toBe("fish.toml:4:1: error: a manifest has no table [dev]; it has [package] and [dependencies]");
  expect(refused(`[package]\nname = "a"\nname = "b"\n`)).toBe("fish.toml:3:1: error: 'name' is given twice");
  expect(refused(`[package]\nname = "a"\n[package]\n`)).toBe("fish.toml:3:1: error: the table [package] is given twice");
  expect(refused(`[package]\nname = "a"\nversion = "1.0.0"\n[dependencies]\nhttp = "1.0"\n`)).toBe("fish.toml:5:1: error: dependencies aren't supported yet; a package builds from its own files for now");
});

test("TOML a manifest doesn't use is refused where it starts", () => {
  expect(refused(`[package]\nname = ["a"]\n`)).toBe("fish.toml:2:8: error: an array is TOML Fish doesn't read in a manifest yet");
  expect(refused(`[package]\nname = { a = 1 }\n`)).toBe("fish.toml:2:8: error: an inline table is TOML Fish doesn't read in a manifest yet");
  expect(refused(`[package]\nname = 1.5\n`)).toBe("fish.toml:2:8: error: this value is TOML Fish doesn't read in a manifest yet");
  expect(refused(`[package]\nname = """a"""\n`)).toBe("fish.toml:2:8: error: a multi-line string is TOML Fish doesn't read in a manifest yet");
  expect(refused(`[package.x]\n`)).toBe("fish.toml:1:9: error: a dotted key is TOML Fish doesn't read in a manifest yet");
  expect(refused(`[[package]]\n`)).toBe("fish.toml:1:1: error: an array of tables is TOML Fish doesn't read in a manifest yet");
  expect(refused(`[package]\nname = "a\n`)).toBe("fish.toml:2:8: error: this string isn't closed on its line");
  expect(refused(`[package]\nname = "a" b\n`)).toBe("fish.toml:2:12: error: expected the end of the line here");
  expect(refused(`[package]\nname "a"\n`)).toBe("fish.toml:2:6: error: expected '=' after the key");
  expect(refused(`[package]\nname = "\\q"\n`)).toBe("fish.toml:2:9: error: this escape isn't one TOML has");
});
