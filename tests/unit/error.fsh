// Errors printed by Fish against node's, node's stacks cut to their first line as Fish has none:
// the same program, its types stripped for node by Bun's transpiler, as recorded.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { built, ranFor, reference, removed, same, scratch, text } from "./support.fsh";

function compare(name: string, source: string): void {
  const dir = scratch("fish-error-");
  const out = built(dir, name, source);
  const fish = spawnSync("env", ["FISH_LEAKS=1", out]);
  const typed = join(dir, `${name}.ts`);
  const script = join(dir, `${name}.mjs`);
  try {
    writeFileSync(typed, source);
  } catch (e) {
    assert(false, e.message);
  }
  const strip = `const { readFileSync, writeFileSync } = require("node:fs"); const [from, to] = process.argv.slice(1); writeFileSync(to, "Error.stackTraceLimit = 0;\\n" + new Bun.Transpiler({ loader: "ts" }).transformSync(readFileSync(from, "utf8")) + "\\nmain();\\n");`;
  const node = reference(`error-${name}`, source, () => {
    const stripped = ranFor("bun", ["-e", strip, typed, script]);
    same(stripped.stderr, "", "stripping the types");
    return ranFor("node", [script]);
  });
  same(text(fish.stderr), "", "the program's stderr");
  same(node.stderr, "", "node's stderr");
  same(text(fish.stdout), node.stdout, "the output");
  removed(dir);
}

test("errors print as node prints them with no stack", () => {
  compare("print", `class NotFound extends Error {
  constructor(message: string) { super(message); }
}
class MyError extends Error {
  constructor(message: string) { super(message); }
}
class Named extends Error {
  extra: i64[];
  constructor(message: string) {
    super(message);
    this.extra = [1];
    this.name = "Named";
  }
}
class Coded extends Error {
  code: i64;
  constructor(message: string, code: i64, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}
function main() {
  console.log(new Error("x"));
  console.log(new Error());
  console.log(new NotFound("nf"));
  console.log(new MyError("m"), new Named("n"), new Coded("", 1));
  console.log(new Coded("cd", 404, { cause: new Error("in") }));
  console.log({ e: new Error("x", { cause: new Error("y") }) });
  console.log([new Error("in array")]);
  console.log(new Error("a", { cause: new Error("b", { cause: new NotFound("c") }) }));
  console.log(new Error("long message ".repeat(8)));
  console.log(new Error("deep", { cause: new Error("1", { cause: new Error("2", { cause: new Error("3", { cause: new Error("4") }) }) }) }));
}
`);
}, { timeout: 30_000 });
