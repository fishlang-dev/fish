import { llvm, type Slots } from "./layout.ts";
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

// `console.log` and `print` are the same: arguments joined by spaces, then a newline. String
// literals and literal values are folded into the printf format at compile time. A union is
// printed by branching on its tag, so the format is flushed before it and each branch prints
// its member.
export function print(args: Expr[], b: Slots, value: (e: Expr) => string, typeOf: (e: Expr) => Type, convert: Convert) {
  const { emit, temp, label, startBlock, cString } = b;
  let format = "";
  let values: string[] = [];
  args.forEach((a, i) => {
    if (i > 0) format += " ";
    if (a.kind === "string") format += escape(a.value);
    else piece(value(a), typeOf(a));
  });
  format += "\n";
  flush();

  function piece(v: string, type: Type) {
    if (typeof type !== "string" && type.kind === "literal") {
      format += escape(String(type.value));
    } else if (type === "boolean") {
      const text = temp();
      emit(`${text} = select i1 ${v}, ptr @.true, ptr @.false`);
      format += "%s";
      values.push(`, ptr ${text}`);
    } else if (typeof type !== "string" && type.kind === "union") {
      flush();
      const tag = temp();
      emit(`${tag} = extractvalue ${llvm(type)} ${v}, 0`);
      const cases = type.members.map(() => label());
      const end = label();
      emit(`switch i32 ${tag}, label %${end} [ ${cases.map((c, i) => `i32 ${i}, label %${c}`).join(" ")} ]`);
      type.members.forEach((member, i) => {
        startBlock(cases[i]!);
        piece(convert(v, type, member), member);
        flush();
        emit(`br label %${end}`);
      });
      startBlock(end);
    } else {
      format += "%lld";
      values.push(`, i64 ${v}`);
    }
  }

  function flush() {
    if (format === "") return;
    emit(`call i32 (ptr, ...) @printf(ptr ${cString(format)}${values.join("")})`);
    format = "";
    values = [];
  }
}

const escape = (text: string) => text.replaceAll("%", "%%");

type Convert = (v: string, from: Type, to: Type) => string;
