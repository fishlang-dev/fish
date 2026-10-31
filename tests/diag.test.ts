import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CompileError, formatError, shown } from "../src/diag.ts";

const src = "let a = 1\nuse(a)\n";

test("an error renders its line with a caret underline", () => {
  expect(formatError(new CompileError("bad", 14, 15), "f.fsh", src)).toBe(
    ["f.fsh:2:5: error: bad", " 2 | use(a)", "   |     ^"].join("\n"),
  );
});

test("a note renders after the error at its own location", () => {
  const e = new CompileError("bad", 14, 15, { message: "moved here", start: 4, end: 5 });
  expect(formatError(e, "f.fsh", src)).toBe(
    ["f.fsh:2:5: error: bad", " 2 | use(a)", "   |     ^", "f.fsh:1:5: note: moved here", " 1 | let a = 1", "   |     ^"].join("\n"),
  );
});

test("only names the compiler made up are rewritten in messages, never text a user wrote", () => {
  const names = { local: new Set<string>(), madeUp: new Map([['test "made"', "the test 'made'"]]) };
  expect(shown(`'test "made"-fsh3' throws`, names)).toBe("the test 'made' throws");
  expect(shown(`can't find the package 'test "\\x"'`, names)).toBe(`can't find the package 'test "\\x"'`);
  expect(shown(`can't find 'test "other"'`, names)).toBe(`can't find 'test "other"'`);
  expect(shown("'helper-fsh2' is unused", names)).toBe("'helper' is unused");
});

test("diagnostics import nothing, so they compile without the rest of the compiler", () => {
  const source = readFileSync(join(import.meta.dir, "..", "src", "diag.ts"), "utf8");
  expect(source.split("\n").filter((line) => line.startsWith("import "))).toEqual([]);
});
