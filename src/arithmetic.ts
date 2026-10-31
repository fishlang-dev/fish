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

// `where` gives an expression's `file:line:col`, for panic messages.
export function lowering({ emit, temp, label, startBlock, cString, alloca, mayPanic }: Builder, where: (at: Span) => string, release: boolean, intrinsics: Intrinsics) {
  return { operate, arithmetic, panicIf, method };

  function operate(op: BinaryOp, a: string, b: string, at: Span, type: Integer): string {
    if (op === "<<" || op === ">>" || op === ">>>") return shift(op, a, b, at, type);
    if (op === "**") return power(a, b, type, (x, y) => arithmetic("*", x, y, at, type));
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
    const [wrapping, checked, opVerb] = ARITHMETIC[op];
    if (release) {
      const result = temp();
      emit(`${result} = ${wrapping} i${INTEGERS[type].bits} ${a}, ${b}`);
      return result;
    }
    const [result, overflow] = overflowing(checked, a, b, type);
    panicIf(overflow, `attempt to ${verb ?? opVerb} with overflow`, at);
    return result;
  }

  // Exponentiation by squaring, multiplying with `multiply`: as `*` does for `**`, so an
  // overflowing power panics with the same message in debug builds and wraps in release. The base
  // squares only while bits of the exponent remain, so a power that fits never overflows on the
  // way, as Rust's `checked_pow` relies on.
  function power(a: string, b: string, type: Integer, multiply: (x: string, y: string) => string): string {
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
    emit(`store ${ty} ${multiply(load(ty, result), load(ty, base))}, ptr ${result}`);
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
    emit(`store ${ty} ${multiply(b2, b2)}, ptr ${base}`);
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

  // `x.checkedAdd(y)` and its kin, the same in every build: the value, and for checked and
  // overflowing methods whether the operation overflowed, which is when checked gives null. Only
  // wrapping and saturating division by zero panics, as Rust's do. `b` is a `u32` for shifts and
  // powers.
  function method(family: string, operation: string, a: string, b: string, at: Span, type: Integer): [string, string?] {
    const { bits, signed } = INTEGERS[type];
    const ty = `i${bits}`;
    const [min, max] = range(type);
    const op = (line: string) => {
      const v = temp();
      emit(`${v} = ${line}`);
      return v;
    };
    const saturated = (name: string, x: string, y: string) => {
      const intrinsic = `@llvm.${signed ? "s" : "u"}${name}.sat.${ty}`;
      intrinsics.add(`declare ${ty} ${intrinsic}(${ty}, ${ty})`);
      return op(`call ${ty} ${intrinsic}(${ty} ${x}, ${ty} ${y})`);
    };
    switch (operation) {
      case "Add":
      case "Sub":
      case "Mul": {
        const name = operation.toLowerCase();
        if (family === "saturating" && name !== "mul") return [saturated(name, a, b)];
        const [v, over] = overflowing(name, a, b, type);
        if (family !== "saturating") return [v, over];
        // An overflowing product is past MIN when exactly one operand is negative.
        const bound = signed ? op(`select i1 ${op(`icmp slt ${ty} ${op(`xor ${ty} ${a}, ${b}`)}, 0`)}, ${ty} ${min}, ${ty} ${max}`) : String(max);
        return [op(`select i1 ${over}, ${ty} ${bound}, ${ty} ${v}`)];
      }
      case "Neg":
        if (family === "saturating") return [saturated("sub", "0", a)];
        return [op(`sub ${ty} 0, ${a}`), signed ? op(`icmp eq ${ty} ${a}, ${min}`) : op(`icmp ne ${ty} ${a}, 0`)];
      case "Div":
      case "Rem": {
        const [instruction, byZero] = DIVISION[operation === "Div" ? "/" : "%"];
        const zero = op(`icmp eq ${ty} ${b}, 0`);
        if (family !== "checked") panicIf(zero, byZero, at);
        const overflow = signed ? op(`and i1 ${op(`icmp eq ${ty} ${a}, ${min}`)}, ${op(`icmp eq ${ty} ${b}, -1`)}`) : "false";
        const bad = family === "checked" ? op(`or i1 ${zero}, ${overflow}`) : overflow;
        // Dividing by 1 instead keeps LLVM's undefined cases out: MIN / 1 is wrapping's MIN, and
        // MIN % 1 its 0.
        const v = op(`${signed ? "s" : "u"}${instruction} ${ty} ${a}, ${op(`select i1 ${bad}, ${ty} 1, ${ty} ${b}`)}`);
        if (family === "saturating") return [op(`select i1 ${overflow}, ${ty} ${max}, ${ty} ${v}`)];
        return [v, bad];
      }
      case "Shl":
      case "Shr": {
        const masked = op(`and i32 ${b}, ${bits - 1}`);
        const amount = bits === 32 ? masked : op(`${bits < 32 ? "trunc" : "zext"} i32 ${masked} to ${ty}`);
        const instruction = operation === "Shl" ? "shl" : signed ? "ashr" : "lshr";
        return [op(`${instruction} ${ty} ${a}, ${amount}`), op(`icmp uge i32 ${b}, ${bits}`)];
      }
    }
    const flag = alloca("i1");
    emit(`store i1 false, ptr ${flag}`);
    const v = power(a, b, type, (x, y) => {
      const [product, over] = overflowing("mul", x, y, type);
      const was = op(`load i1, ptr ${flag}`);
      emit(`store i1 ${op(`or i1 ${was}, ${over}`)}, ptr ${flag}`);
      return product;
    });
    const over = op(`load i1, ptr ${flag}`);
    if (family !== "saturating") return [v, over];
    // A negative base to an odd power is past MIN.
    const bound = signed ? op(`select i1 ${op(`and i1 ${op(`icmp slt ${ty} ${a}, 0`)}, ${op(`trunc i32 ${b} to i1`)}`)}, ${ty} ${min}, ${ty} ${max}`) : String(max);
    return [op(`select i1 ${over}, ${ty} ${bound}, ${ty} ${v}`)];
  }

  // The wrapped result of `add`, `sub` or `mul` and whether it overflowed.
  function overflowing(name: string, a: string, b: string, type: Integer): [string, string] {
    const { bits, signed } = INTEGERS[type];
    const ty = `i${bits}`;
    const intrinsic = `@llvm.${signed ? "s" : "u"}${name}.with.overflow.${ty}`;
    intrinsics.add(`declare { ${ty}, i1 } ${intrinsic}(${ty}, ${ty})`);
    const [pair, v, over] = [temp(), temp(), temp()];
    emit(`${pair} = call { ${ty}, i1 } ${intrinsic}(${ty} ${a}, ${ty} ${b})`);
    emit(`${v} = extractvalue { ${ty}, i1 } ${pair}, 0`);
    emit(`${over} = extractvalue { ${ty}, i1 } ${pair}, 1`);
    return [v, over];
  }

  function panicIf(condition: string, reason: string, at: Span) {
    const fail = label();
    const ok = label();
    emit(`br i1 ${condition}, label %${fail}, label %${ok}`);
    startBlock(fail);
    mayPanic(`call void @fsh_rt_panic(ptr ${cString(`panicked at ${where(at)}:\n${reason}\n`)})`);
    emit("unreachable");
    startBlock(ok);
  }
}
