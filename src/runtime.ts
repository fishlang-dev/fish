import type { Builder } from "./arithmetic.ts";
import type { Expr } from "./parser.ts";
import type { Type } from "./typing.ts";

// What compiled programs call into: libc's printf, and the panic routine.

// A panic prints its location and reason to stderr and exits with 101, like a Rust panic
// on the main thread. With nothing to unwind yet, that is all panic=unwind does. stdout is
// flushed first so earlier output stays ahead of the message even when piped.
export const RUNTIME = [
  "declare i32 @printf(ptr, ...)",
  "declare i32 @dprintf(i32, ptr, ...)",
  "declare i32 @fflush(ptr)",
  "declare void @exit(i32) noreturn",
  "declare { i64, i1 } @llvm.sadd.with.overflow.i64(i64, i64)",
  "declare { i64, i1 } @llvm.ssub.with.overflow.i64(i64, i64)",
  "declare { i64, i1 } @llvm.smul.with.overflow.i64(i64, i64)",
  "",
  '@.panic.format = private unnamed_addr constant [3 x i8] c"%s\\00"',
  '@.true = private unnamed_addr constant [5 x i8] c"true\\00"',
  '@.false = private unnamed_addr constant [6 x i8] c"false\\00"',
  "",
  'define internal void @"fsh.panic"(ptr %message) noreturn cold {',
  "  call i32 @fflush(ptr null)",
  "  call i32 (i32, ptr, ...) @dprintf(i32 2, ptr @.panic.format, ptr %message)",
  "  call void @exit(i32 101)",
  "  unreachable",
  "}",
];

// `console.log` and `print` are the same: arguments joined by spaces, then a newline.
// String literals are folded into the printf format at compile time.
export function print(args: Expr[], { emit, temp, cString }: Builder, value: (e: Expr) => string, typeOf: (e: Expr) => Type) {
  let format = "";
  const values: string[] = [];
  args.forEach((a, i) => {
    if (i > 0) format += " ";
    const type = typeOf(a);
    if (a.kind === "string") {
      format += a.value.replaceAll("%", "%%");
    } else if (typeof type !== "string" && type.kind === "literal") {
      // A literal's value is known, though what produces it still runs.
      value(a);
      format += String(type.value).replaceAll("%", "%%");
    } else if (type === "boolean") {
      const text = temp();
      emit(`${text} = select i1 ${value(a)}, ptr @.true, ptr @.false`);
      format += "%s";
      values.push(`, ptr ${text}`);
    } else {
      format += "%lld";
      values.push(`, i64 ${value(a)}`);
    }
  });
  emit(`call i32 (ptr, ...) @printf(ptr ${cString(format + "\n")}${values.join("")})`);
}
