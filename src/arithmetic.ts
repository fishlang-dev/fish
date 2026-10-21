import { locate } from "./diag.ts";
import type { ArithmeticOp, BinaryOp, Span } from "./parser.ts";
import { INTEGERS, range, type Integer } from "./typing.ts";

// Lowering for the integer operators at each width, whose overflow and division checks panic
// as Rust's do.

// What the operator lowering needs from the function being emitted.
export type Builder = {
  emit(line: string): void;
  temp(): string;
  label(): string;
  startBlock(name: string): void;
  cString(s: string): string;
};

// The wrapping instruction, the checked intrinsic without its signedness, and the verb for
// each panic message.
const ARITHMETIC: Record<"+" | "-" | "*", [string, string, string]> = {
  "+": ["add", "add", "add"],
  "-": ["sub", "sub", "subtract"],
  "*": ["mul", "mul", "multiply"],
};

// LLVM leaves x / 0 and, for signed types, MIN / -1 undefined, so both panic in every build,
// as in Rust.
const DIVISION: Record<"/" | "%", [string, string, string]> = {
  "/": ["div", "attempt to divide by zero", "attempt to divide with overflow"],
  "%": ["rem", "attempt to calculate the remainder with a divisor of zero", "attempt to calculate the remainder with overflow"],
};

// The direction named in the overflow panic. A shift by a negative amount or by the width or
// more panics in debug builds and uses the amount's low bits in release, as Rust's do. `>>`
// keeps the sign of a signed type; `>>>` never does.
const SHIFTS: Record<"<<" | ">>" | ">>>", string> = { "<<": "left", ">>": "right", ">>>": "right" };

const BITWISE: Partial<Record<BinaryOp, string>> = { "&": "and", "|": "or", "^": "xor" };

// Each overflow-checking intrinsic the lowered code calls, which the module declares.
export type Intrinsics = Set<string>;

export function lowering({ emit, temp, label, startBlock, cString }: Builder, src: string, file: string, release: boolean, intrinsics: Intrinsics) {
  return { operate, arithmetic };

  function operate(op: BinaryOp, a: string, b: string, at: Span, type: Integer): string {
    if (op === "<<" || op === ">>" || op === ">>>") return shift(op, a, b, at, type);
    const bitwise = BITWISE[op];
    if (!bitwise) return arithmetic(op as ArithmeticOp, a, b, at, type);
    const result = temp();
    emit(`${result} = ${bitwise} i${INTEGERS[type].bits} ${a}, ${b}`);
    return result;
  }

  function shift(op: keyof typeof SHIFTS, a: string, b: string, at: Span, type: Integer): string {
    const { bits, signed } = INTEGERS[type];
    const ty = `i${bits}`;
    let amount = b;
    if (release) {
      amount = temp();
      emit(`${amount} = and ${ty} ${b}, ${bits - 1}`);
    } else {
      const overflow = temp();
      emit(`${overflow} = icmp ugt ${ty} ${b}, ${bits - 1}`);
      panicIf(overflow, `attempt to shift ${SHIFTS[op]} with overflow`, at);
    }
    const result = temp();
    const instruction = op === "<<" ? "shl" : op === ">>" && signed ? "ashr" : "lshr";
    emit(`${result} = ${instruction} ${ty} ${a}, ${amount}`);
    return result;
  }

  function arithmetic(op: ArithmeticOp, a: string, b: string, at: Span, type: Integer, verb?: string): string {
    if (op === "/" || op === "%") return division(op, a, b, at, type);
    const { bits, signed } = INTEGERS[type];
    const ty = `i${bits}`;
    const [wrapping, checked, opVerb] = ARITHMETIC[op];
    const result = temp();
    if (release) {
      emit(`${result} = ${wrapping} ${ty} ${a}, ${b}`);
      return result;
    }
    const intrinsic = `@llvm.${signed ? "s" : "u"}${checked}.with.overflow.${ty}`;
    intrinsics.add(`declare { ${ty}, i1 } ${intrinsic}(${ty}, ${ty})`);
    const pair = temp();
    const overflow = temp();
    emit(`${pair} = call { ${ty}, i1 } ${intrinsic}(${ty} ${a}, ${ty} ${b})`);
    emit(`${result} = extractvalue { ${ty}, i1 } ${pair}, 0`);
    emit(`${overflow} = extractvalue { ${ty}, i1 } ${pair}, 1`);
    panicIf(overflow, `attempt to ${verb ?? opVerb} with overflow`, at);
    return result;
  }

  function division(op: "/" | "%", a: string, b: string, at: Span, type: Integer): string {
    const { bits, signed } = INTEGERS[type];
    const ty = `i${bits}`;
    const [instruction, byZero, overflow] = DIVISION[op];
    const zero = temp();
    emit(`${zero} = icmp eq ${ty} ${b}, 0`);
    panicIf(zero, byZero, at);
    if (signed) {
      const [min, minusOne, both] = [temp(), temp(), temp()];
      emit(`${min} = icmp eq ${ty} ${a}, ${range(type)[0]}`);
      emit(`${minusOne} = icmp eq ${ty} ${b}, -1`);
      emit(`${both} = and i1 ${min}, ${minusOne}`);
      panicIf(both, overflow, at);
    }
    const result = temp();
    emit(`${result} = ${signed ? "s" : "u"}${instruction} ${ty} ${a}, ${b}`);
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
