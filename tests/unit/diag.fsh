// Ports tests/diag.test.ts. A group is made with `compileErrors`, since a `CompileErrors` isn't taken
// where a `CompileError` is.
import { join } from "node:path";
import { CompileError, compileErrors, formatError, shown } from "../../src/diag.fsh";
import { errorsOf } from "../../src/lsp.fsh";
import { read, root, same } from "./support.fsh";

function src(): string {
  return "let a = 1\nuse(a)\n";
}

function noted(): CompileError {
  return new CompileError("E0201", "bad", 14, 15, { message: "moved here", start: 4, end: 5 });
}

test("an error renders its line with a caret underline", () => {
  same(formatError(new CompileError("E0201", "bad", 14, 15), "f.fsh", src()), ["f.fsh:2:5: error[E0201]: bad", " 2 | use(a)", "   |     ^"].join("\n"), "rendered");
});

test("an error's code renders after its kind, and a note's line shows none", () => {
  const e = noted();
  same(formatError(e, "f.fsh", src()).split("\n").filter((l) => l.startsWith("f.fsh")).join("\n"), "f.fsh:2:5: error[E0201]: bad\nf.fsh:1:5: note: moved here", "location lines");
  same(formatError(e, "f.fsh", src(), "warning").split("\n")[0]!, "f.fsh:2:5: warning[E0201]: bad", "as a warning");
  same(formatError(e, "f.fsh", src(), "reject var").split("\n")[0]!, "f.fsh:2:5: reject var: bad", "as a rejection");
});

test("a note renders after the error at its own location", () => {
  same(formatError(noted(), "f.fsh", src()), ["f.fsh:2:5: error[E0201]: bad", " 2 | use(a)", "   |     ^", "f.fsh:1:5: note: moved here", " 1 | let a = 1", "   |     ^"].join("\n"), "rendered");
});

test("an error at the start of a file that opens with a newline points at its first line", () => {
  same(formatError(new CompileError("E0405", "no main() function; execution starts there", 0, 0), "f.fsh", "\nfunction f() {}\n"), ["f.fsh:1:1: error[E0405]: no main() function; execution starts there", " 1 | ", "   | ^"].join("\n"), "rendered");
});

test("several errors render a blank line apart, then a line counting them, with no code", () => {
  const group = compileErrors([new CompileError("E0201", "first", 4, 5), new CompileError("E0301", "second", 14, 15)]);
  same(
    formatError(group, "f.fsh", src()),
    [
      ["f.fsh:1:5: error[E0201]: first", " 1 | let a = 1", "   |     ^"].join("\n"),
      ["f.fsh:2:5: error[E0301]: second", " 2 | use(a)", "   |     ^"].join("\n"),
      "error: could not compile due to 2 previous errors",
    ].join("\n\n"),
    "rendered",
  );
  same(`${group.code} ${group.message} ${group.start}`, "E0201 first 4", "the group's first error");
  same(errorsOf(group.clone()).map((e) => e.message).join(", "), "first, second", "its errors");
  assert(errorsOf(new CompileError("E0201", "one", 0)).length === 1, "a single error is one");
});

test("colour paints the location, the label and the caret line, and nothing else", () => {
  const e = noted();
  same(
    formatError(e, "f.fsh", src(), "error", true),
    [
      "\x1b[1mf.fsh:2:5:\x1b[0m \x1b[1;31merror[E0201]\x1b[0m: bad",
      " 2 | use(a)",
      "   |     \x1b[1;31m^\x1b[0m",
      "\x1b[1mf.fsh:1:5:\x1b[0m \x1b[1mnote\x1b[0m: moved here",
      " 1 | let a = 1",
      "   |     \x1b[1m^\x1b[0m",
    ].join("\n"),
    "coloured",
  );
  assert(formatError(e, "f.fsh", src(), "warning", true).includes("\x1b[1;33mwarning[E0201]\x1b[0m"), "a warning is yellow");
  const lines = formatError(compileErrors([noted(), noted()]), "f.fsh", src(), "error", true).split("\n");
  same(lines[lines.length - 1]!, "\x1b[1;31merror\x1b[0m\x1b[1m: could not compile due to 2 previous errors\x1b[0m", "the count line");
});

test("only names the compiler made up are rewritten in messages, never text a user wrote", () => {
  const names = { local: new Set<string>(), madeUp: new Map([['test "made"', "the test 'made'"]]) };
  same(shown(`'test "made"-fsh3' throws`, names), "the test 'made' throws", "a made-up name");
  same(shown(`can't find the package 'test "\\x"'`, names), `can't find the package 'test "\\x"'`, "a package name");
  same(shown(`can't find 'test "other"'`, names), `can't find 'test "other"'`, "another name");
  same(shown("'helper-fsh2' is unused", names), "'helper' is unused", "a hoisted name");
});

test("diagnostics import nothing, so they compile without the rest of the compiler", () => {
  const source = read(join(root(), "src", "diag.fsh"));
  same(source.split("\n").filter((line) => line.startsWith("import ")).join("\n"), "", "imports");
});
