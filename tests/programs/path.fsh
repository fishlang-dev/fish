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
// error: 'node:path' has no export named 'parse'
import path from "node:path";
function main() {
  console.log(path.parse("/a"));
}
