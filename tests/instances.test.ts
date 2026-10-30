import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "../src/main.ts";

// Monomorphization compiles each generic function once per distinct set of type arguments,
// however many calls share it, and never compiles a definition check.
test("one function per instance", () => {
  const file = join(import.meta.dir, "programs", "generics.fsh");
  const ir = compile(readFileSync(file, "utf8"), file);
  const defined = (name: string) => ir.match(new RegExp(`^define .*@"fsh\\.${name}#[0-9a-z.]+"`, "gm"))?.length ?? 0;
  // identity runs on i64 (three calls, one explicit), boolean, and two object shapes.
  expect(defined("identity")).toBe(4);
  expect(defined("first")).toBe(2);
  expect(defined("getX")).toBe(3);
  expect(ir).not.toContain("@\"fsh.identity\"(");
});
