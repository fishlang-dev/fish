// The std `path` module against node's `path.posix`, over a table of
// inputs edge cases included, each call run through Fish and through node and compared line by line.
import { spawnSync } from "node:child_process";
import { built, ranFor, reference, removed, same, scratch, text } from "./support.fsh";

function quoted(s: string): string {
  return JSON.stringify(s);
}

function calls(): string[] {
  const paths = ["", ".", "..", "/", "//", "///a//b", "a", "a/", "/a", "/a/", "a/b/c", "a/./b", "a/../b", "../a", "../../a/b", "/../a", "/a/b/../../..", "a/b/../../..", ".hidden", "a/.hidden", "file.txt", "a/file.tar.gz", "a/b.", "a/.b.", "a/..", "a/...", "x/y/z/", "/foo/bar/baz/asdf/quux", "/foo/bar//baz/asdf/quux/..", "./a//b/./c/"];
  const pairs: [string, string][] = [["/a/b/c", "/a/d"], ["/data/orandea/test/aaa", "/data/orandea/impl/bbb"], ["/", "/foo"], ["/foo", "/"], ["/foo/bar", "/foo/bar/baz"], ["/foo/bar/baz", "/foo/bar"], ["a", "b"], ["a/b", "a"], ["", ""], ["/a", "/a"], ["a/b/c", "a/x/y"]];
  const suffixes: [string, string][] = [["/a/b.txt", ".txt"], ["b.txt", "b.txt"], ["/a/b.txt/", ".txt"], ["aaa", "a"], ["file.js", ".ts"], ["x", ""]];
  const formats = ["{}", "{ root: \"/\", dir: \"/home\", base: \"f.txt\" }", "{ root: \"/\", base: \"f.txt\" }", "{ root: \"/x/\", name: \"f\", ext: \".t\" }", "{ name: \"f\", ext: \"t\" }", "{ name: \"f\", ext: \".\" }", "{ dir: \"d\", base: \"b\", name: \"n\", ext: \"e\" }", "{ dir: \"/\", base: \"a\" }", "{ dir: \"/\", root: \"/r\" }", "{ root: \"/\", dir: \"/\" }", "{ dir: \"\", root: \"/\", name: \"n\" }"];
  let out: string[] = [];
  for (const p of paths) {
    const q = quoted(p);
    out = out.concat([`normalize(${q})`, `dirname(${q})`, `basename(${q})`, `extname(${q})`, `join(${q}, "x")`, `resolve("/root", ${q})`]);
  }
  for (const [a, b] of pairs) out = out.concat([`relative(${quoted(a)}, ${quoted(b)})`, `join(${quoted(a)}, ${quoted(b)})`, `resolve(${quoted(a)}, ${quoted(b)})`]);
  for (const [p, s] of suffixes) out.push(`basename(${quoted(p)}, ${quoted(s)})`);
  for (const p of paths) {
    const q = quoted(p);
    out = out.concat([`isAbsolute(${q})`, `[parse(${q}).root, parse(${q}).dir, parse(${q}).base, parse(${q}).ext, parse(${q}).name]`, `format(parse(${q}))`]);
  }
  for (const f of formats) out.push(`format(${f})`);
  out = out.concat([`join()`, `join("", "")`, `join("a", "", "b")`, `resolve("/x", "y", "/z", "w")`]);
  return out;
}

test("path gives what node's path.posix gives", () => {
  const dir = scratch("fish-path-");
  const all = calls();
  const lines = all.map((c) => `  console.log(JSON.stringify(${c}));`).join("\n");
  const out = built(dir, "main", `import { join, normalize, dirname, basename, extname, resolve, relative, isAbsolute, parse, format, sep, delimiter } from "node:path";\nfunction main() {\n${lines}\n  console.log(sep, delimiter);\n}\n`);
  const fish = text(spawnSync(out, [], { cwd: dir }).stdout);
  const script = `const { join, normalize, dirname, basename, extname, resolve, relative, isAbsolute, parse, format, sep, delimiter } = require("node:path").posix;\n${all.map((c) => `console.log(JSON.stringify(${c}));`).join("\n")}\nconsole.log(sep, delimiter);`;
  // A relative path resolves against the working directory, a new one each run, so the answer is
  // recorded with a name in its place.
  const node = reference("path-posix", script, () => {
    const got = ranFor("node", ["-e", script], dir);
    return { status: got.status, stdout: got.stdout.replaceAll(dir, "<dir>"), stderr: got.stderr };
  }).stdout;
  same(fish.replaceAll(dir, "<dir>"), node, "the output");
  removed(dir);
}, { timeout: 30_000 });

test("resolve starts from the working directory", () => {
  const dir = scratch("fish-path-");
  const out = built(dir, "cwd", `import path from "node:path";\nfunction main() { console.log(path.resolve("x/y"), path.resolve(), path.relative("x", ".")); }\n`);
  const fish = text(spawnSync(out, [], { cwd: dir }).stdout);
  const script = `const path = require("node:path"); console.log(path.resolve("x/y"), path.resolve(), path.relative("x", "."));`;
  // The directory is a new one each run, so the answer is recorded with a name in its place.
  const node = reference("path-resolve-cwd", script, () => {
    const got = ranFor("node", ["-e", script], dir);
    return { status: got.status, stdout: got.stdout.replaceAll(dir, "<dir>"), stderr: got.stderr };
  }).stdout;
  same(fish.replaceAll(dir, "<dir>"), node, "the output");
  removed(dir);
}, { timeout: 30_000 });
