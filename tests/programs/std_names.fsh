// Std's modules by their own names: `std:<name>` names each one, `node:` and bare names still name
// the ones Node has, and `fish:` names nothing.
// case: std_names_import
// expect: a/b .fsh true
// expect: 3 6
// expect: aGk=
import { join, extname } from "std:path";
import { existsSync } from "std:fs";
import { tmpdir } from "std:os";
import { argv } from "std:process";
import { Buffer } from "std:buffer";
import assert from "std:assert";
import { format } from "std:util";
function main() {
  console.log(join("a", "b"), extname("x.fsh"), existsSync(tmpdir()));
  assert(argv.length > 0);
  console.log(format("%d", 3), "std:fs".length);
  console.log(Buffer.from("hi").toString("base64"));
}
// case: std_names_beside_node_names
// expect: x/y x/y x/y
// One module under its three names is one module: nothing is declared twice.
import { join } from "std:path";
import { join as joinNode } from "node:path";
import { join as joinBare } from "path";
function main() {
  console.log(join("x", "y"), joinNode("x", "y"), joinBare("x", "y"));
}
// case: std_names_fish_is_gone
// error: 'fish:tar' names no module: std's modules are named 'std:'; this one is 'std:tar'
import { list } from "fish:tar";
function main() {}
// case: std_names_fish_names_nothing
// error: 'fish:nope' names no module: std's modules are named 'std:'
import { x } from "fish:nope";
function main() {}
// case: std_names_unknown
// error: std has no module named 'nope'; it has 'assert', 'auth', 'buffer', 'build', 'child_process', 'compress', 'comptime', 'cors', 'crypto', 'durable', 'fs', 'fs/promises', 'grpc', 'inspect', 'log', 'mcu', 'os', 'path', 'postgres', 'process', 'query', 'redis', 's3', 'sim', 'sqlite', 'stdin', 'tar', 'tls', 'trace', 'url', 'util', 'zip', 'zlib'
import { x } from "std:nope";
function main() {}
// case: std_names_bun_has_no_std_name
// error: std has no module named 'bun'
import { which } from "std:bun";
function main() {}
// case: std_names_own_modules_have_no_bare_name
// error: tar
// `tar` alone is npm's package, which this program doesn't have.
import { list } from "tar";
function main() {}
// case: std_names_in_errors
// error: 'std:path' has no export named 'nope'
import { nope } from "node:path";
function main() {}
