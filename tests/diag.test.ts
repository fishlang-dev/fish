import { expect, test } from "bun:test";
import { CompileError, formatError } from "../src/diag.ts";

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
