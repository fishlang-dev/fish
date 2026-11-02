// import.meta's members are constants fixed while compiling: the file's real path where it was
// built, its name, its directory, its file URL, and whether it is the entry file.

// case: import_meta_names
// expect: import_meta_names.fsh
// expect: true
// expect: true
// expect: true
// expect: true
import { basename, dirname, join } from "node:path";

function main() {
  console.log(import.meta.file);
  console.log(basename(import.meta.path) === import.meta.file);
  console.log(dirname(import.meta.path) === import.meta.dir);
  console.log(join(import.meta.dir, import.meta.file) === import.meta.path);
  console.log(import.meta.url === `file://${import.meta.path}`);
}

// case: import_meta_main
// expect: entry
function main() {
  if (import.meta.main) console.log("entry");
  else console.log("imported");
}

// case: import_meta_top_level
// expect: import_meta_top_level.fsh
const FILE: string = import.meta.file;

function main() {
  console.log(FILE);
}

// case: import_meta_comptime
// expect: 24
const LENGTH = comptime import.meta.file.length

function main() {
  console.log(LENGTH);
}

// case: import_meta_other
// error: meta properties are not supported yet
function main() {
  console.log(import.meta.env);
}
