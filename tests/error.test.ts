import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Errors printed by Fish against node's, node's stacks cut to their first line as Fish has none:
// the same program, its types stripped for node.
const tmp = mkdtempSync(join(tmpdir(), "fish-error-"));
const strip = new Bun.Transpiler({ loader: "ts" });

function compare(name: string, source: string) {
  const program = join(tmp, `${name}.fsh`);
  writeFileSync(program, source);
  const out = join(tmp, name);
  const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  expect(built.stderr.toString()).toBe("");
  const fish = Bun.spawnSync([out], { env: { ...process.env, FISH_LEAKS: "1" } });
  const script = join(tmp, `${name}.mjs`);
  writeFileSync(script, `Error.stackTraceLimit = 0;\n${strip.transformSync(source)}\nmain();\n`);
  const node = Bun.spawnSync(["node", script]);
  expect(fish.stderr.toString()).toBe("");
  expect(node.stderr.toString()).toBe("");
  expect(fish.stdout.toString()).toBe(node.stdout.toString());
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
});
