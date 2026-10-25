import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The std `path` module against node's `path.posix`, over a table of inputs edge cases included,
// each call run through Fish and through node and compared line by line.
const tmp = mkdtempSync(join(tmpdir(), "fish-path-"));

const PATHS = ["", ".", "..", "/", "//", "///a//b", "a", "a/", "/a", "/a/", "a/b/c", "a/./b", "a/../b", "../a", "../../a/b", "/../a", "/a/b/../../..", "a/b/../../..", ".hidden", "a/.hidden", "file.txt", "a/file.tar.gz", "a/b.", "a/.b.", "a/..", "a/...", "x/y/z/", "/foo/bar/baz/asdf/quux", "/foo/bar//baz/asdf/quux/..", "./a//b/./c/"];
const PAIRS: [string, string][] = [["/a/b/c", "/a/d"], ["/data/orandea/test/aaa", "/data/orandea/impl/bbb"], ["/", "/foo"], ["/foo", "/"], ["/foo/bar", "/foo/bar/baz"], ["/foo/bar/baz", "/foo/bar"], ["a", "b"], ["a/b", "a"], ["", ""], ["/a", "/a"], ["a/b/c", "a/x/y"]];
const SUFFIXES: [string, string][] = [["/a/b.txt", ".txt"], ["b.txt", "b.txt"], ["/a/b.txt/", ".txt"], ["aaa", "a"], ["file.js", ".ts"], ["x", ""]];

const calls: string[] = [
  ...PATHS.flatMap((p) => [`normalize(${JSON.stringify(p)})`, `dirname(${JSON.stringify(p)})`, `basename(${JSON.stringify(p)})`, `extname(${JSON.stringify(p)})`, `join(${JSON.stringify(p)}, "x")`, `resolve("/root", ${JSON.stringify(p)})`]),
  ...PAIRS.flatMap(([a, b]) => [`relative(${JSON.stringify(a)}, ${JSON.stringify(b)})`, `join(${JSON.stringify(a)}, ${JSON.stringify(b)})`, `resolve(${JSON.stringify(a)}, ${JSON.stringify(b)})`]),
  ...SUFFIXES.map(([p, s]) => `basename(${JSON.stringify(p)}, ${JSON.stringify(s)})`),
  `join()`, `join("", "")`, `join("a", "", "b")`, `resolve("/x", "y", "/z", "w")`,
];

test("path gives what node's path.posix gives", () => {
  const program = join(tmp, "main.fsh");
  writeFileSync(program, `import { join, normalize, dirname, basename, extname, resolve, relative, sep, delimiter } from "node:path";
function main() {
${calls.map((c) => `  console.log(JSON.stringify(${c}));`).join("\n")}
  console.log(sep, delimiter);
}
`);
  const out = join(tmp, "main");
  const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  expect(built.stderr.toString()).toBe("");
  const fish = Bun.spawnSync([out]).stdout.toString();
  const script = `const { join, normalize, dirname, basename, extname, resolve, relative, sep, delimiter } = require("node:path").posix;\n${calls.map((c) => `console.log(JSON.stringify(${c}));`).join("\n")}\nconsole.log(sep, delimiter);`;
  const node = Bun.spawnSync(["node", "-e", script]).stdout.toString();
  expect(fish).toBe(node);
});

test("resolve starts from the working directory", () => {
  const program = join(tmp, "cwd.fsh");
  writeFileSync(program, `import path from "node:path";\nfunction main() { console.log(path.resolve("x/y"), path.resolve(), path.relative("x", ".")); }\n`);
  const out = join(tmp, "cwd");
  Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  const fish = Bun.spawnSync([out], { cwd: tmp }).stdout.toString();
  const node = Bun.spawnSync(["node", "-e", `const path = require("node:path"); console.log(path.resolve("x/y"), path.resolve(), path.relative("x", "."));`], { cwd: tmp }).stdout.toString();
  expect(fish).toBe(node);
});
