// case: path_forms
// expect: a/c b.txt .txt / :
// expect: /x/y
import path from "node:path";
import { basename } from "path/posix";
import * as posix from "node:path/posix";
function main() {
  console.log(path.join("a", "b", "..", "c"), basename("/d/b.txt"), posix.extname("b.txt"), path.sep, posix.delimiter);
  console.log(path.resolve("/x", "y"));
}
// case: path_global
// expect: /a/b/
function main() {
  console.log(path.normalize("/a//b/"));
}
// case: path_unknown_member
// error: 'node:path' has no export named 'matchesGlob'
import path from "node:path";
function main() {
  console.log(path.matchesGlob("/a", "*"));
}
// case: path_parse
// expect: ||||||
// expect: |/|/||||
// expect: |||a||a|
// expect: |||.bashrc||.bashrc|
// expect: |||a||a|
// expect: |/|/|a||a|
// expect: |||a.b.c|.c|a.b|
// expect: |/|/a|b||b|
// expect: |/|/home/u|file.txt|.txt|file|
// expect: |/|/a|.b.|.|.b|
// expect: ||a/|b.c|.c|b|
// expect: ||a|..||..|
// expect: |/|/|.||.|
import { parse } from "node:path";
function main() {
  for (const p of ["", "/", "a", ".bashrc", "a/", "//a", "a.b.c", "/a/b/", "/home/u/file.txt", "/a/.b.", "a//b.c//", "a/..", "/."]) {
    const r = parse(p);
    console.log(`|${r.root}|${r.dir}|${r.base}|${r.ext}|${r.name}|`);
  }
}
// case: path_format
// expect: /home/f.txt /f.txt /x/f.t f.t d/f.e
// expect: [] //a / a/b n n. //
// expect: /home/u/file.txt a.b.c
import path from "node:path";
function main() {
  console.log(path.format({ root: "/", dir: "/home", base: "f.txt" }), path.format({ root: "/", base: "f.txt" }), path.format({ root: "/x/", name: "f", ext: ".t" }), path.format({ name: "f", ext: "t" }), path.format({ dir: "d", name: "f", ext: "e" }));
  console.log(`[${path.format({})}]`, path.format({ dir: "/", base: "a" }), path.format({ root: "/", dir: "/" }), path.format({ dir: "a", base: "b", name: "n", ext: ".e" }), path.format({ name: "n", ext: "" }), path.format({ name: "n", ext: "." }), path.format({ dir: "/", root: "/r" }));
  console.log(path.format(path.parse("/home/u/file.txt")), path.format(path.parse("a.b.c")));
}
// case: path_is_absolute
// expect: false true false true
import { isAbsolute } from "node:path";
function main() {
  console.log(isAbsolute(""), isAbsolute("/a"), isAbsolute("a/b"), isAbsolute("//"));
}
