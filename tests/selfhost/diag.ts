import { CompileError, formatError, named, type Names, type Note } from "../../src/diag.ts";

// Renders errors through src/diag.ts. Run by Bun and built by fishc, the two outputs must match.

function show(e: Ref<CompileError>, path: string, program: string, kind: string): void {
  console.log(formatError(e, path, program, kind));
  console.log("--");
}

export function main(): void {
  const program = "const x = 1;\nlet y = x + z;\n";
  show(new CompileError("E0001", "cannot find name 'z'", 25, 26), "main.fsh", program, "error");
  show(new CompileError("E0001", "unused variable 'y'", 17, 18), "main.fsh", program, "warning");

  const note: Note = { message: "moved here", start: 6, end: 7 };
  let moved = new CompileError("E0001", "'x' was moved", 21, 22, note);
  show(moved, "a.fsh", program, "error");

  show(new CompileError("E0001", "no main() function; execution starts there", 0, 0), "blank.fsh", "\nfunction f() {}\n", "error");
  show(new CompileError("E0001", "unexpected end of file", 40, 41), "short.fsh", "let a = 1", "error");
  show(new CompileError("E0001", "spans lines", 4, 20), "main.fsh", program, "error");
  show(new CompileError("E0001", "after an emoji", 9, 10), "u.fsh", "s = \"😀\"; t;\n", "error");

  let other = new CompileError("E0001", "in another file", 105, 108);
  other.sources = [{ base: 100, src: "\nlet q = 2;\n", file: "lib.fsh" }];
  show(other, "main.fsh", program, "error");

  const names: Names = { local: new Set(["Point@0"]), madeUp: new Map([["test@3", "test \"adds\""]]) };
  const renamed = named(new CompileError("E0001", "'test@3' and 'Point@0' and 'helper-fsh2' and 'test@3-fsh1'", 0, 5), names);
  show(renamed, "main.fsh", program, "error");

  // A group as CompileErrors makes it, which Fish can't pass as its base class.
  let group = new CompileError("E0401", "first", 4, 5);
  group.errors = [new CompileError("E0401", "first", 4, 5), new CompileError("E0201", "second", 14, 15)];
  show(named(group, { local: new Set<string>(), madeUp: new Map<string, string>() }), "main.fsh", program, "error");
}
