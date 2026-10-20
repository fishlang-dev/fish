import { CompileError } from "./diag.ts";
import type { Expr, Func } from "./parser.ts";

const I64_MAX = (1n << 63n) - 1n;

// Lowers the program to LLVM IR text. The module names no target triple, so clang uses the host's.
// User functions live under `fsh.` so the C entry point `main` can wrap Fish's `main()`.
export function codegen(funcs: Func[]): string {
  const defined = new Set<string>();
  for (const f of funcs) {
    if (defined.has(f.name)) throw new CompileError(`'${f.name}' is already defined`, f.start, f.end);
    defined.add(f.name);
  }
  if (!defined.has("main")) throw new CompileError("no main() function; execution starts there", 0, 0);

  const globals: string[] = [];
  const body: string[] = [];

  for (const f of funcs) {
    body.push(`define void @"fsh.${f.name}"() {`, "entry:");
    for (const s of f.body) body.push(`  ${call(s.expr)}`);
    body.push("  ret void", "}", "");
  }

  return [
    ...globals,
    "",
    "declare i32 @printf(ptr, ...)",
    "",
    ...body,
    "define i32 @main() {",
    '  call void @"fsh.main"()',
    "  ret i32 0",
    "}",
    "",
  ].join("\n");

  function call(e: Expr): string {
    if (e.kind !== "call") throw new CompileError("only calls are supported as statements so far", e.start, e.end);
    const { callee } = e;
    if (callee.kind === "ident" && defined.has(callee.name)) {
      if (e.args.length > 0) throw new CompileError(`'${callee.name}' takes no arguments`, e.start, e.end);
      return `call void @"fsh.${callee.name}"()`;
    }
    const isConsoleLog =
      callee.kind === "member" && callee.name === "log" &&
      callee.object.kind === "ident" && callee.object.name === "console";
    if (isConsoleLog || (callee.kind === "ident" && callee.name === "print")) return print(e.args);
    const name = callee.kind === "ident" ? `'${callee.name}'` : "this expression";
    throw new CompileError(`unknown function ${name}`, callee.start, callee.end);
  }

  // `console.log` and `print` are the same: arguments joined by spaces, then a newline.
  // String literals are folded into the printf format at compile time.
  function print(args: Expr[]): string {
    let format = "";
    const values: string[] = [];
    args.forEach((a, i) => {
      if (i > 0) format += " ";
      if (a.kind === "string") {
        format += a.value.replaceAll("%", "%%");
      } else if (a.kind === "int") {
        if (a.value > I64_MAX) throw new CompileError("integer literal does not fit in i64", a.start, a.end);
        format += "%lld";
        values.push(`, i64 ${a.value}`);
      } else {
        throw new CompileError("only string and integer literals can be printed so far", a.start, a.end);
      }
    });
    return `call i32 (ptr, ...) @printf(ptr ${cString(format + "\n")}${values.join("")})`;
  }

  function cString(s: string): string {
    const bytes = new TextEncoder().encode(s + "\0");
    let lit = "";
    for (const b of bytes) {
      const plain = b >= 0x20 && b < 0x7f && b !== 0x22 && b !== 0x5c;
      lit += plain ? String.fromCharCode(b) : "\\" + b.toString(16).padStart(2, "0").toUpperCase();
    }
    const name = `@.str.${globals.length}`;
    globals.push(`${name} = private unnamed_addr constant [${bytes.length} x i8] c"${lit}"`);
    return name;
  }
}
