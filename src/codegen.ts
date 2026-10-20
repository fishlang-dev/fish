import { isPrint, type Checked, type Local, type Type } from "./check.ts";
import { locate } from "./diag.ts";
import type { BinaryOp, Expr, Param, Span, Stmt } from "./parser.ts";

const LLVM: Record<Type, string> = { i64: "i64", void: "void" };

const I64_MIN = -(1n << 63n);

// The wrapping instruction, the checked intrinsic and the verb for each panic message.
const ARITHMETIC: Record<"+" | "-" | "*", [string, string, string]> = {
  "+": ["add", "sadd", "add"],
  "-": ["sub", "ssub", "subtract"],
  "*": ["mul", "smul", "multiply"],
};

// LLVM leaves x / 0 and MIN / -1 undefined, so both panic in every build, as in Rust.
const DIVISION: Record<"/" | "%", [string, string, string]> = {
  "/": ["sdiv", "attempt to divide by zero", "attempt to divide with overflow"],
  "%": ["srem", "attempt to calculate the remainder with a divisor of zero", "attempt to calculate the remainder with overflow"],
};

// A panic prints its location and reason to stderr and exits with 101, like a Rust panic
// on the main thread. With nothing to unwind yet, that is all panic=unwind does. stdout is
// flushed first so earlier output stays ahead of the message even when piped.
const RUNTIME = [
  "declare i32 @printf(ptr, ...)",
  "declare i32 @dprintf(i32, ptr, ...)",
  "declare i32 @fflush(ptr)",
  "declare void @exit(i32) noreturn",
  "declare { i64, i1 } @llvm.sadd.with.overflow.i64(i64, i64)",
  "declare { i64, i1 } @llvm.ssub.with.overflow.i64(i64, i64)",
  "declare { i64, i1 } @llvm.smul.with.overflow.i64(i64, i64)",
  "",
  '@.panic.format = private unnamed_addr constant [3 x i8] c"%s\\00"',
  "",
  'define internal void @"fsh.panic"(ptr %message) noreturn cold {',
  "  call i32 @fflush(ptr null)",
  "  call i32 (i32, ptr, ...) @dprintf(i32 2, ptr @.panic.format, ptr %message)",
  "  call void @exit(i32 101)",
  "  unreachable",
  "}",
];

export type Options = { src: string; file: string; release: boolean };

// Lowers a checked program to LLVM IR text. The module names no target triple, so clang uses the host's.
// User functions live under `fsh.` so the C entry point `main` can wrap Fish's `main()`.
// Release builds wrap on overflow; debug builds panic.
export function codegen({ funcs, types, locals, returns }: Checked, { src, file, release }: Options): string {
  const globals: string[] = [];
  const out: string[] = [];
  // Allocas go in the entry block, where mem2reg promotes them and loops don't grow the stack.
  let allocas: string[] = [];
  let body: string[] = [];
  let temps = 0;
  let labels = 0;
  let currentFunction = "";

  for (const f of funcs) {
    currentFunction = f.name;
    allocas = [];
    body = [];
    temps = 0;
    labels = 0;
    const type = returnType(f.name);
    // Parameters are copied into slots like any other binding.
    const params = f.params.map((p) => {
      const local = resolved(p);
      allocas.push(`  ${slot(local)} = alloca ${LLVM[local.type]}`);
      emit(`store ${LLVM[local.type]} %${p.name}.arg, ptr ${slot(local)}`);
      return `${LLVM[local.type]} %${p.name}.arg`;
    });
    f.body.forEach(statement);
    // The last block is unreachable when every path returned; the checker guarantees it for values.
    const end = type === "void" ? "ret void" : "unreachable";
    out.push(`define ${LLVM[type]} @"fsh.${f.name}"(${params.join(", ")}) {`, "entry:", ...allocas, ...body, `  ${end}`, "}", "");
  }

  return [
    ...globals,
    "",
    ...RUNTIME,
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

  function label(): string {
    return `L${labels++}`;
  }

  function slot(local: Local): string {
    return `%${local.name}.${local.id}`;
  }

  function returnType(name: string): Type {
    const type = returns.get(name);
    if (!type) throw new Error(`internal error: no return type for ${name}`);
    return type;
  }

  function resolved(node: Expr | Stmt | Param): Local {
    const local = locals.get(node);
    if (!local) throw new Error("internal error: unresolved name");
    return local;
  }

  function statement(s: Stmt) {
    switch (s.kind) {
      case "expr":
        if (s.expr.kind === "call") call(s.expr.callee, s.expr.args);
        return;
      case "return":
        emit(s.value ? `ret ${LLVM[returnType(currentFunction)]} ${value(s.value)}` : "ret void");
        // Anything after a return goes in a fresh block that nothing branches to.
        body.push(`${label()}:`);
        return;
      case "let": {
        const local = resolved(s);
        allocas.push(`  ${slot(local)} = alloca ${LLVM[local.type]}`);
        emit(`store ${LLVM[local.type]} ${value(s.init)}, ptr ${slot(local)}`);
        return;
      }
      case "assign": {
        const local = resolved(s);
        // The target is read before the right-hand side runs, as in JavaScript.
        const result = s.op === "=" ? value(s.value) : arithmetic(s.op, value(s.target), value(s.value), s);
        emit(`store ${LLVM[local.type]} ${result}, ptr ${slot(local)}`);
        return;
      }
    }
  }

  // Returns the call's result, or undefined for a call that returns nothing.
  function call(callee: Expr, args: Expr[]): string | undefined {
    if (callee.kind === "ident" && returns.has(callee.name)) {
      const type = returnType(callee.name);
      const values = args.map((a) => `${LLVM[types.get(a)!]} ${value(a)}`);
      const invoke = `call ${LLVM[type]} @"fsh.${callee.name}"(${values.join(", ")})`;
      if (type === "void") {
        emit(invoke);
        return undefined;
      }
      const result = temp();
      emit(`${result} = ${invoke}`);
      return result;
    }
    if (isPrint(callee)) print(args);
    return undefined;
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
      case "call": {
        const result = call(e.callee, e.args);
        if (!result) throw new Error("internal error: void call used as a value");
        return result;
      }
      case "unary":
        return arithmetic("-", "0", value(e.operand), e, "negate");
      case "binary":
        return arithmetic(e.op, value(e.left), value(e.right), e);
      default:
        throw new Error(`internal error: no lowering for ${e.kind}`);
    }
  }

  function arithmetic(op: BinaryOp, a: string, b: string, at: Span, verb?: string): string {
    if (op === "/" || op === "%") return division(op, a, b, at);
    const [wrapping, checked, opVerb] = ARITHMETIC[op];
    const result = temp();
    if (release) {
      emit(`${result} = ${wrapping} i64 ${a}, ${b}`);
      return result;
    }
    const pair = temp();
    const overflow = temp();
    emit(`${pair} = call { i64, i1 } @llvm.${checked}.with.overflow.i64(i64 ${a}, i64 ${b})`);
    emit(`${result} = extractvalue { i64, i1 } ${pair}, 0`);
    emit(`${overflow} = extractvalue { i64, i1 } ${pair}, 1`);
    panicIf(overflow, `attempt to ${verb ?? opVerb} with overflow`, at);
    return result;
  }

  function division(op: "/" | "%", a: string, b: string, at: Span): string {
    const [instruction, byZero, overflow] = DIVISION[op];
    const zero = temp();
    emit(`${zero} = icmp eq i64 ${b}, 0`);
    panicIf(zero, byZero, at);
    const [min, minusOne, both] = [temp(), temp(), temp()];
    emit(`${min} = icmp eq i64 ${a}, ${I64_MIN}`);
    emit(`${minusOne} = icmp eq i64 ${b}, -1`);
    emit(`${both} = and i1 ${min}, ${minusOne}`);
    panicIf(both, overflow, at);
    const result = temp();
    emit(`${result} = ${instruction} i64 ${a}, ${b}`);
    return result;
  }

  function panicIf(condition: string, reason: string, at: Span) {
    const fail = label();
    const ok = label();
    const { line, col } = locate(src, at.start);
    emit(`br i1 ${condition}, label %${fail}, label %${ok}`);
    body.push(`${fail}:`);
    emit(`call void @"fsh.panic"(ptr ${cString(`panicked at ${file}:${line}:${col}:\n${reason}\n`)})`);
    emit("unreachable");
    body.push(`${ok}:`);
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
