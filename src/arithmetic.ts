import { locate, sourceOf } from "./diag.ts";
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
  alloca(type: string): string;
  // Emits a call that may panic, so a panic unwinding through it drops what is live here.
  mayPanic(call: string): void;
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

export function lowering({ emit, temp, label, startBlock, cString, alloca, mayPanic }: Builder, src: string, file: string, release: boolean, intrinsics: Intrinsics) {
  return { operate, arithmetic, panicIf };

  function operate(op: BinaryOp, a: string, b: string, at: Span, type: Integer): string {
    if (op === "<<" || op === ">>" || op === ">>>") return shift(op, a, b, at, type);
    if (op === "**") return power(a, b, at, type);
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

  // Exponentiation by squaring, multiplying as `*` does, so an overflowing power panics with
  // the same message in debug builds and wraps in release. The base squares only while bits of
  // the exponent remain, so a power that fits never overflows on the way.
  function power(a: string, b: string, at: Span, type: Integer): string {
    const ty = `i${INTEGERS[type].bits}`;
    const [result, base, exponent] = [alloca(ty), alloca(ty), alloca("i32")];
    emit(`store ${ty} 1, ptr ${result}`);
    emit(`store ${ty} ${a}, ptr ${base}`);
    emit(`store i32 ${b}, ptr ${exponent}`);
    const [loop, odd, next, square, done] = [label(), label(), label(), label(), label()];
    const load = (ty: string, slot: string) => {
      const v = temp();
      emit(`${v} = load ${ty}, ptr ${slot}`);
      return v;
    };
    emit(`br label %${loop}`);
    startBlock(loop);
    const e = load("i32", exponent);
    const more = temp();
    emit(`${more} = icmp ne i32 ${e}, 0`);
    emit(`br i1 ${more}, label %${odd}, label %${done}`);
    startBlock(odd);
    const bit = temp();
    emit(`${bit} = and i32 ${e}, 1`);
    const set = temp();
    emit(`${set} = icmp ne i32 ${bit}, 0`);
    const times = label();
    emit(`br i1 ${set}, label %${times}, label %${next}`);
    startBlock(times);
    emit(`store ${ty} ${arithmetic("*", load(ty, result), load(ty, base), at, type)}, ptr ${result}`);
    emit(`br label %${next}`);
    startBlock(next);
    const rest = temp();
    emit(`${rest} = lshr i32 ${e}, 1`);
    emit(`store i32 ${rest}, ptr ${exponent}`);
    const left = temp();
    emit(`${left} = icmp ne i32 ${rest}, 0`);
    emit(`br i1 ${left}, label %${square}, label %${done}`);
    startBlock(square);
    const b2 = load(ty, base);
    emit(`store ${ty} ${arithmetic("*", b2, b2, at, type)}, ptr ${base}`);
    emit(`br label %${loop}`);
    startBlock(done);
    return load(ty, result);
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
    const place = sourceOf(src, file, at.start);
    const { line, col } = locate(place.src, place.offset);
    emit(`br i1 ${condition}, label %${fail}, label %${ok}`);
    startBlock(fail);
    mayPanic(`call void @fsh_rt_panic(ptr ${cString(`panicked at ${place.file}:${line}:${col}:\n${reason}\n`)})`);
    emit("unreachable");
    startBlock(ok);
  }
}
