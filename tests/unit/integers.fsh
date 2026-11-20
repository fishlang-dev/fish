// The compiler's source names its numbers with Fish's types (src/fish.d.ts aliases them for tsc),
// because Fish reads `number` as `f64`, which can't index an array or mix with a length.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { parse, type Stmt } from "../../src/parser.fsh";
import { walk } from "../../src/nodes.fsh";
import { read, root } from "./support.fsh";

// Type nodes naming `number` in a file of src.
function numberTypes(file: string): i64 {
  let program: Stmt[] = [];
  try {
    program = parse(read(join(root(), "src", file)), { last: 0 });
  } catch (e) {
    assert(false, `${file} doesn't parse: ${e.message}`);
  }
  let count = new Atomic(0);
  walk({ of: "stmts", node: program }, (n) => {
    if (n.of === "typeNode" && n.node.kind === "ref" && n.node.name === "number") count.add(1);
  });
  return count.load();
}

test("the compiler's source writes Fish's number types, not number", () => {
  let files: string[] = [];
  try {
    files = readdirSync(join(root(), "src")).filter((f) => f.endsWith(".fsh"));
  } catch (e) {
    assert(false, e.message);
  }
  files.sort();
  let found: string[] = [];
  for (const f of files) {
    const n = numberTypes(f);
    if (n > 0) found.push(`${f}: ${n}`);
  }
  assert(found.length === 0, `files naming number: ${found.join(", ")}`);
});
