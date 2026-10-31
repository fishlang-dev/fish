import { CompileError, formatError, named, type Names, type Note } from "../../src/diag.ts";

// Renders errors through src/diag.ts. Run by Bun and built by fishc, the two outputs must match.

function show(e: Ref<CompileError>, path: string, program: string, kind: string): void {
  console.log(formatError(e, path, program, kind));
  console.log("--");
}

export function main(): void {
  const program = "const x = 1;\nlet y = x + z;\n";
  show(new CompileError("cannot find name 'z'", 25, 26), "main.fsh", program, "error");
  show(new CompileError("unused variable 'y'", 17, 18), "main.fsh", program, "warning");

  const note: Note = { message: "moved here", start: 6, end: 7 };
  let moved = new CompileError("'x' was moved", 21, 22, note);
  show(moved, "a.fsh", program, "error");

  show(new CompileError("no main() function; execution starts there", 0, 0), "blank.fsh", "\nfunction f() {}\n", "error");
  show(new CompileError("unexpected end of file", 40, 41), "short.fsh", "let a = 1", "error");
  show(new CompileError("spans lines", 4, 20), "main.fsh", program, "error");
  show(new CompileError("after an emoji", 9, 10), "u.fsh", "s = \"😀\"; t;\n", "error");

  let other = new CompileError("in another file", 105, 108);
  other.sources = [{ base: 100, src: "\nlet q = 2;\n", file: "lib.fsh" }];
  show(other, "main.fsh", program, "error");

  const names: Names = { local: new Set(["Point@0"]), madeUp: new Map([["test@3", "test \"adds\""]]) };
  const renamed = named(new CompileError("'test@3' and 'Point@0' and 'helper-fsh2' and 'test@3-fsh1'", 0, 5), names);
  show(renamed, "main.fsh", program, "error");
}
