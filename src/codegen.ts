import { isPrint, type Checked, type Local, type Type } from "./check.ts";
import type { Expr, Stmt } from "./parser.ts";

const LLVM: Record<Type, string> = { i64: "i64" };

// Lowers a checked program to LLVM IR text. The module names no target triple, so clang uses the host's.
// User functions live under `fsh.` so the C entry point `main` can wrap Fish's `main()`.
export function codegen({ funcs, locals }: Checked): string {
  const userFuncs = new Set(funcs.map((f) => f.name));
  const globals: string[] = [];
  const out: string[] = [];
  // Allocas go in the entry block, where mem2reg promotes them and loops don't grow the stack.
  let allocas: string[] = [];
  let body: string[] = [];
  let temps = 0;

  for (const f of funcs) {
    allocas = [];
    body = [];
    temps = 0;
    f.body.forEach(statement);
    out.push(`define void @"fsh.${f.name}"() {`, "entry:", ...allocas, ...body, "  ret void", "}", "");
  }

  return [
    ...globals,
    "",
    "declare i32 @printf(ptr, ...)",
    "",
    ...out,
    "define i32 @main() {",
    '  call void @"fsh.main"()',
    "  ret i32 0",
    "}",
    "",
  ].join("\n");

  function emit(line: string) {
    body.push(`  ${line}`);
  }

  function temp(): string {
    return `%t${temps++}`;
  }

  function slot(local: Local): string {
    return `%${local.name}.${local.id}`;
  }

  function resolved(node: Expr | Stmt): Local {
    const local = locals.get(node);
    if (!local) throw new Error("internal error: unresolved name");
    return local;
  }

  function statement(s: Stmt) {
    switch (s.kind) {
      case "expr":
        if (s.expr.kind === "call") call(s.expr.callee, s.expr.args);
        return;
      case "let": {
        const local = resolved(s);
        allocas.push(`  ${slot(local)} = alloca ${LLVM[local.type]}`);
        emit(`store ${LLVM[local.type]} ${value(s.init)}, ptr ${slot(local)}`);
        return;
      }
    }
  }

  function call(callee: Expr, args: Expr[]) {
    if (callee.kind === "ident" && userFuncs.has(callee.name)) emit(`call void @"fsh.${callee.name}"()`);
    else if (isPrint(callee)) print(args);
  }

  function value(e: Expr): string {
    switch (e.kind) {
      case "int":
        return String(e.value);
      case "ident": {
        const local = resolved(e);
        const t = temp();
        emit(`${t} = load ${LLVM[local.type]}, ptr ${slot(local)}`);
        return t;
      }
      default:
        throw new Error(`internal error: no lowering for ${e.kind}`);
    }
  }

  // `console.log` and `print` are the same: arguments joined by spaces, then a newline.
  // String literals are folded into the printf format at compile time.
  function print(args: Expr[]) {
    let format = "";
    const values: string[] = [];
    args.forEach((a, i) => {
      if (i > 0) format += " ";
      if (a.kind === "string") {
        format += a.value.replaceAll("%", "%%");
      } else {
        format += "%lld";
        values.push(`, i64 ${value(a)}`);
      }
    });
    emit(`call i32 (ptr, ...) @printf(ptr ${cString(format + "\n")}${values.join("")})`);
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
