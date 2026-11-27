// Comptime file reads: the globs `[comptime] reads` lists in fish.toml, which paths they let
// std:comptime's readText and readBytes read, and programs built with them.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readManifest } from "../../src/manifest.fsh";
import { globMatches, listed, listedFiles, readable } from "../../src/reads.fsh";
import { built, fishc, removed, same, scratch, text } from "./support.fsh";

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function folder(path: string): void {
  try {
    mkdirSync(path, { recursive: true });
  } catch (e) {
    assert(false, `can't make ${path}: ${e.message}`);
  }
}

const MANIFEST = `[package]
name = "reader"
version = "0.1.0"
entry = "main.fsh"

[comptime]
reads = ["assets/*.txt", "schemas/**/*.json"]
`;

// A package in a fresh directory, its manifest and its assets written.
function pkg(): string {
  const dir = scratch("fish-reads-");
  write(join(dir, "fish.toml"), MANIFEST);
  folder(join(dir, "assets"));
  folder(join(dir, "schemas", "v1"));
  write(join(dir, "assets", "hello.txt"), "hello from a file\n");
  write(join(dir, "assets", "secret.bin"), "not listed");
  write(join(dir, "schemas", "v1", "user.json"), '{"type":"object"}');
  return dir;
}

test("a glob matches names within one directory, or any depth with **", () => {
  assert(globMatches("assets/*.txt", "assets/a.txt"), "* in a name");
  assert(!globMatches("assets/*.txt", "assets/deep/a.txt"), "* stays in its directory");
  assert(globMatches("schemas/**/*.json", "schemas/a.json"), "** of no directories");
  assert(globMatches("schemas/**/*.json", "schemas/v1/x/a.json"), "** of several");
  assert(globMatches("data?.csv", "data1.csv") && !globMatches("data?.csv", "data10.csv"), "? is one character");
  assert(!globMatches("a.txt", "abtxt"), "a dot is a dot");
  assert(listed(["x.txt", "assets/*.txt"], "assets/b.txt"), "any glob of several");
});

test("fish.toml's [comptime] reads lists globs inside the package", () => {
  const m = readManifest(MANIFEST, "/pkg");
  same((m.reads ?? []).join(" "), "assets/*.txt schemas/**/*.json", "the globs");
  same(readManifest('[package]\nname = "a"\nversion = "0.1.0"\n', "/pkg").reads === undefined ? "none" : "some", "none", "a manifest listing none");
  const cases: [string, string][] = [["reads = \"assets\"", "'reads' is a list of globs"], ["reads = [\"../other/*.txt\"]", "reaches outside the package"], ["reads = [\"/etc/passwd\"]", "reaches outside the package"], ["files = []", "[comptime] has no key 'files'"]];
  for (const [bad, said] of cases) {
    let message = "";
    try {
      readManifest(`[package]\nname = "a"\nversion = "0.1.0"\n\n[comptime]\n${bad}\n`, "/pkg");
    } catch (e) {
      message = e.message;
    }
    assert(message.includes(said), `${bad}: ${message}`);
  }
});

test("comptime may read a listed file inside the package, and nothing else", () => {
  const dir = pkg();
  const reads = { dir, globs: ["assets/*.txt", "schemas/**/*.json"] };
  const ok = readable(reads, "assets/hello.txt");
  assert("path" in ok, "a listed file");
  const refusals: [string, string][] = [["assets/secret.bin", "isn't listed under [comptime] reads"], ["../elsewhere.txt", "is outside the package"], ["/etc/hosts", "isn't a path inside the package"], ["assets/missing.txt", "doesn't exist"]];
  for (const [path, said] of refusals) {
    const got = readable(reads, path);
    assert("why" in got && got.why.includes(said), `${path}: ${"why" in got ? got.why : "allowed"}`);
  }
  same(listedFiles(reads).map((p) => p.slice(dir.length + 1)).join(" "), "assets/hello.txt schemas/v1/user.json", "every listed file, in order");
  removed(dir);
});

test("a top-level const reads a file's text and bytes while compiling", () => {
  const dir = pkg();
  const binary = built(dir, "main", `import { readBytes, readText } from "std:comptime";

const GREETING = readText("assets/hello.txt");
const SCHEMA = readBytes("schemas/v1/user.json");

function main() {
  console.log(GREETING.trim(), SCHEMA.length);
}
`);
  const run = spawnSync(binary, []);
  same(text(run.stdout), "hello from a file 17\n", "the program's output");
  removed(dir);
});

test("a read of a file fish.toml doesn't list is refused at the call", () => {
  const dir = pkg();
  write(join(dir, "main.fsh"), `import { readText } from "std:comptime";

const SECRET = readText("assets/secret.bin");

function main() {
  console.log(SECRET);
}
`);
  const run = fishc(dir, ["build", "main.fsh"]);
  assert(run.code === 1 && run.err.includes("main.fsh:3:16") && run.err.includes("'assets/secret.bin' isn't listed under [comptime] reads"), `stderr:\n${run.err}`);
  removed(dir);
});
