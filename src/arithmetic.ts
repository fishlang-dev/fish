import { locate } from "./diag.ts";
import type { ArithmeticOp, BinaryOp, Span } from "./parser.ts";

// Lowering for the i64 operators, whose overflow and division checks panic as Rust's do.

// What the operator lowering needs from the function being emitted.
export type Builder = {
  emit(line: string): void;
  temp(): string;
  label(): string;
  startBlock(name: string): void;
  cString(s: string): string;
};

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

// The instruction and the direction named in the overflow panic. A shift by a negative
// amount or by 64 or more panics in debug builds and uses the amount's low six bits in
// release, as Rust's do.
const SHIFTS: Record<"<<" | ">>" | ">>>", [string, string]> = {
  "<<": ["shl", "left"],
  ">>": ["ashr", "right"],
  ">>>": ["lshr", "right"],
};

const BITWISE: Partial<Record<BinaryOp, string>> = { "&": "and", "|": "or", "^": "xor" };

export function lowering({ emit, temp, label, startBlock, cString }: Builder, src: string, file: string, release: boolean) {
  return { operate, arithmetic };

  function operate(op: BinaryOp, a: string, b: string, at: Span): string {
    if (op === "<<" || op === ">>" || op === ">>>") return shift(op, a, b, at);
    const bitwise = BITWISE[op];
    if (!bitwise) return arithmetic(op as ArithmeticOp, a, b, at);
    const result = temp();
    emit(`${result} = ${bitwise} i64 ${a}, ${b}`);
    return result;
  }

  function shift(op: keyof typeof SHIFTS, a: string, b: string, at: Span): string {
    const [instruction, direction] = SHIFTS[op];
    let amount = b;
    if (release) {
      amount = temp();
      emit(`${amount} = and i64 ${b}, 63`);
    } else {
      const overflow = temp();
      emit(`${overflow} = icmp ugt i64 ${b}, 63`);
      panicIf(overflow, `attempt to shift ${direction} with overflow`, at);
    }
    const result = temp();
    emit(`${result} = ${instruction} i64 ${a}, ${amount}`);
    return result;
  }

  function arithmetic(op: ArithmeticOp, a: string, b: string, at: Span, verb?: string): string {
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
    startBlock(fail);
    emit(`call void @"fsh.panic"(ptr ${cString(`panicked at ${file}:${line}:${col}:\n${reason}\n`)})`);
    emit("unreachable");
    startBlock(ok);
  }
}
