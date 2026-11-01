import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CompileError, CompileErrors, formatError, shown } from "../src/diag.ts";
import { errorsOf } from "../src/lsp.ts";

const src = "let a = 1\nuse(a)\n";

test("an error renders its line with a caret underline", () => {
  expect(formatError(new CompileError("E0201", "bad", 14, 15), "f.fsh", src)).toBe(
    ["f.fsh:2:5: error[E0201]: bad", " 2 | use(a)", "   |     ^"].join("\n"),
  );
});

test("an error's code renders after its kind, and a note's line shows none", () => {
  const e = new CompileError("E0201", "bad", 14, 15, { message: "moved here", start: 4, end: 5 });
  expect(formatError(e, "f.fsh", src).split("\n").filter((l) => l.startsWith("f.fsh"))).toEqual(["f.fsh:2:5: error[E0201]: bad", "f.fsh:1:5: note: moved here"]);
  expect(formatError(e, "f.fsh", src, "warning").split("\n")[0]).toBe("f.fsh:2:5: warning[E0201]: bad");
  expect(formatError(e, "f.fsh", src, "reject var").split("\n")[0]).toBe("f.fsh:2:5: reject var: bad");
});

test("a note renders after the error at its own location", () => {
  const e = new CompileError("E0201", "bad", 14, 15, { message: "moved here", start: 4, end: 5 });
  expect(formatError(e, "f.fsh", src)).toBe(
    ["f.fsh:2:5: error[E0201]: bad", " 2 | use(a)", "   |     ^", "f.fsh:1:5: note: moved here", " 1 | let a = 1", "   |     ^"].join("\n"),
  );
});

test("an error at the start of a file that opens with a newline points at its first line", () => {
  expect(formatError(new CompileError("E0405", "no main() function; execution starts there", 0, 0), "f.fsh", "\nfunction f() {}\n")).toBe(
    ["f.fsh:1:1: error[E0405]: no main() function; execution starts there", " 1 | ", "   | ^"].join("\n"),
  );
});

test("several errors render a blank line apart, then a line counting them, with no code", () => {
  const group = new CompileErrors([new CompileError("E0201", "first", 4, 5), new CompileError("E0301", "second", 14, 15)]);
  expect(formatError(group, "f.fsh", src)).toBe(
    [
      ["f.fsh:1:5: error[E0201]: first", " 1 | let a = 1", "   |     ^"].join("\n"),
      ["f.fsh:2:5: error[E0301]: second", " 2 | use(a)", "   |     ^"].join("\n"),
      "error: could not compile due to 2 previous errors",
    ].join("\n\n"),
  );
  expect([group.code, group.message, group.start]).toEqual(["E0201", "first", 4]);
  expect(errorsOf(group).map((e) => e.message)).toEqual(["first", "second"]);
  expect(errorsOf(new CompileError("E0201", "one", 0))).toHaveLength(1);
});

test("colour paints the location, the label and the caret line, and nothing else", () => {
  const e = new CompileError("E0201", "bad", 14, 15, { message: "moved here", start: 4, end: 5 });
  expect(formatError(e, "f.fsh", src, "error", true).split("\n")).toEqual([
    "\x1b[1mf.fsh:2:5:\x1b[0m \x1b[1;31merror[E0201]\x1b[0m: bad",
    " 2 | use(a)",
    "   |     \x1b[1;31m^\x1b[0m",
    "\x1b[1mf.fsh:1:5:\x1b[0m \x1b[1mnote\x1b[0m: moved here",
    " 1 | let a = 1",
    "   |     \x1b[1m^\x1b[0m",
  ]);
  expect(formatError(e, "f.fsh", src, "warning", true)).toContain("\x1b[1;33mwarning[E0201]\x1b[0m");
  expect(formatError(new CompileErrors([e, e]), "f.fsh", src, "error", true).split("\n").at(-1)).toBe("\x1b[1;31merror\x1b[0m\x1b[1m: could not compile due to 2 previous errors\x1b[0m");
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
