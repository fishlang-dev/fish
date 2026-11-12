import type { ArithmeticOp, BinaryOp, Span } from "./parser.ts";
import { integerInfo, range, type Integer } from "./typing.ts";

// Lowering for the integer operators at each width, whose overflow and division checks panic
// as Rust's do.

// What the operator lowering needs from the function being emitted.
export interface Builder {
  emit(this: Mut<this>, line: string): void;
  temp(this: Mut<this>): string;
  label(this: Mut<this>): string;
  startBlock(this: Mut<this>, name: string): void;
  cString(this: Mut<this>, s: string): string;
  alloca(this: Mut<this>, type: string): string;
  // Emits a call that may panic, so a panic unwinding through it drops what is live here.
  mayPanic(this: Mut<this>, call: string): void;
  // An expression's `file:line:col`, for panic messages.
  where(at: Ref<Span>): string;
  release: boolean;
  // Each overflow-checking intrinsic the lowered code calls, which the module declares.
  intrinsics: Set<string>;
}

// The wrapping instruction, the checked intrinsic without its signedness, and the verb for
// each panic message.
function arithmeticOf(op: "+" | "-" | "*"): [string, string, string] {
  if (op === "+") return ["add", "add", "add"];
  if (op === "-") return ["sub", "sub", "subtract"];
  return ["mul", "mul", "multiply"];
}

// LLVM leaves x / 0 and, for signed types, MIN / -1 undefined, so both panic in every build,
// as in Rust.
function divisionOf(op: "/" | "%"): [string, string, string] {
  if (op === "/") return ["div", "attempt to divide by zero", "attempt to divide with overflow"];
  return ["rem", "attempt to calculate the remainder with a divisor of zero", "attempt to calculate the remainder with overflow"];
}

// The direction named in the overflow panic. A shift by a negative amount or by the width or
// more panics in debug builds and uses the amount's low bits in release, as Rust's do. `>>`
// keeps the sign of a signed type; `>>>` never does.
type Shift = "<<" | ">>" | ">>>";
const shiftDirection = (op: Shift): string => (op === "<<" ? "left" : "right");

function bitwiseOf(op: BinaryOp): string | undefined {
  if (op === "&") return "and";
  if (op === "|") return "or";
  if (op === "^") return "xor";
  return undefined;
}

// The integer operators lowered into the function `host` is emitting.
export class Lowering<H extends Builder> {
  host: Mut<H>;

  constructor(host: Mut<H>) {
    this.host = host;
  }

  operate(this: Mut<this>, op: BinaryOp, a: string, b: string, at: Ref<Span>, type: Integer): string {
    if (op === "<<" || op === ">>" || op === ">>>") return this.shift(op, a, b, at, type);
    if (op === "**") return this.power(a, b, type, at, undefined);
    const bitwise = bitwiseOf(op);
    if (bitwise === undefined) return this.arithmetic(op as ArithmeticOp, a, b, at, type);
    const result = this.host.temp();
    this.host.emit(`${result} = ${bitwise} i${integerInfo(type).bits} ${a}, ${b}`);
    return result;
  }

  shift(this: Mut<this>, op: Shift, a: string, b: string, at: Ref<Span>, type: Integer): string {
    const { bits, signed } = integerInfo(type);
    const ty = `i${bits}`;
    let amount = b;
    if (this.host.release) {
      amount = this.host.temp();
      this.host.emit(`${amount} = and ${ty} ${b}, ${bits - 1}`);
    } else {
      const overflow = this.host.temp();
      this.host.emit(`${overflow} = icmp ugt ${ty} ${b}, ${bits - 1}`);
      this.panicIf(overflow, `attempt to shift ${shiftDirection(op)} with overflow`, at);
    }
    const result = this.host.temp();
    const instruction = op === "<<" ? "shl" : op === ">>" && signed ? "ashr" : "lshr";
    this.host.emit(`${result} = ${instruction} ${ty} ${a}, ${amount}`);
    return result;
  }

  arithmetic(this: Mut<this>, op: ArithmeticOp, a: string, b: string, at: Ref<Span>, type: Integer, verb?: string): string {
    if (op === "/" || op === "%") return this.division(op, a, b, at, type);
    const [wrapping, checked, opVerb] = arithmeticOf(op);
    if (this.host.release) {
      const result = this.host.temp();
      this.host.emit(`${result} = ${wrapping} i${integerInfo(type).bits} ${a}, ${b}`);
      return result;
    }
    const [result, overflow] = this.overflowing(checked, a, b, type);
    this.panicIf(overflow, `attempt to ${verb ?? opVerb} with overflow`, at);
    return result;
  }

  // Exponentiation by squaring. With no `flag` it multiplies as `*` does, so an overflowing
  // power panics with the same message in debug builds and wraps in release; with one, each
  // product's overflow is or-ed into that `i1` slot. The base squares only while bits of the
  // exponent remain, so a power that fits never overflows on the way, as Rust's `checked_pow`
  // relies on.
  power(this: Mut<this>, a: string, b: string, type: Integer, at: Ref<Span>, flag: string | undefined): string {
    const ty = `i${integerInfo(type).bits}`;
    const [result, base, exponent] = [this.host.alloca(ty), this.host.alloca(ty), this.host.alloca("i32")];
    this.host.emit(`store ${ty} 1, ptr ${result}`);
    this.host.emit(`store ${ty} ${a}, ptr ${base}`);
    this.host.emit(`store i32 ${b}, ptr ${exponent}`);
    const [loop, odd, next, square, done] = [this.host.label(), this.host.label(), this.host.label(), this.host.label(), this.host.label()];
    this.host.emit(`br label %${loop}`);
    this.host.startBlock(loop);
    const e = this.loaded("i32", exponent);
    const more = this.host.temp();
    this.host.emit(`${more} = icmp ne i32 ${e}, 0`);
    this.host.emit(`br i1 ${more}, label %${odd}, label %${done}`);
    this.host.startBlock(odd);
    const bit = this.host.temp();
    this.host.emit(`${bit} = and i32 ${e}, 1`);
    const set = this.host.temp();
    this.host.emit(`${set} = icmp ne i32 ${bit}, 0`);
    const times = this.host.label();
    this.host.emit(`br i1 ${set}, label %${times}, label %${next}`);
    this.host.startBlock(times);
    const sofar = this.loaded(ty, result);
    const factor = this.loaded(ty, base);
    const product = this.times(sofar, factor, type, at, flag);
    this.host.emit(`store ${ty} ${product}, ptr ${result}`);
    this.host.emit(`br label %${next}`);
    this.host.startBlock(next);
    const rest = this.host.temp();
    this.host.emit(`${rest} = lshr i32 ${e}, 1`);
    this.host.emit(`store i32 ${rest}, ptr ${exponent}`);
    const left = this.host.temp();
    this.host.emit(`${left} = icmp ne i32 ${rest}, 0`);
    this.host.emit(`br i1 ${left}, label %${square}, label %${done}`);
    this.host.startBlock(square);
    const b2 = this.loaded(ty, base);
    const squared = this.times(b2, b2, type, at, flag);
    this.host.emit(`store ${ty} ${squared}, ptr ${base}`);
    this.host.emit(`br label %${loop}`);
    this.host.startBlock(done);
    return this.loaded(ty, result);
  }

  loaded(this: Mut<this>, ty: string, slot: string): string {
    const v = this.host.temp();
    this.host.emit(`${v} = load ${ty}, ptr ${slot}`);
    return v;
  }

  // One product inside a power: checked as `*` is, or wrapping with its overflow kept in `flag`.
  times(this: Mut<this>, x: string, y: string, type: Integer, at: Ref<Span>, flag: string | undefined): string {
    if (flag === undefined) return this.arithmetic("*", x, y, at, type);
    const [product, over] = this.overflowing("mul", x, y, type);
    const was = this.host.temp();
    this.host.emit(`${was} = load i1, ptr ${flag}`);
    const either = this.host.temp();
    this.host.emit(`${either} = or i1 ${was}, ${over}`);
    this.host.emit(`store i1 ${either}, ptr ${flag}`);
    return product;
  }

  division(this: Mut<this>, op: "/" | "%", a: string, b: string, at: Ref<Span>, type: Integer): string {
    const { bits, signed } = integerInfo(type);
    const ty = `i${bits}`;
    const [instruction, byZero, overflow] = divisionOf(op);
    const zero = this.host.temp();
    this.host.emit(`${zero} = icmp eq ${ty} ${b}, 0`);
    this.panicIf(zero, byZero, at);
    if (signed) {
      const [min, minusOne, both] = [this.host.temp(), this.host.temp(), this.host.temp()];
      this.host.emit(`${min} = icmp eq ${ty} ${a}, ${range(type)[0]}`);
      this.host.emit(`${minusOne} = icmp eq ${ty} ${b}, -1`);
      this.host.emit(`${both} = and i1 ${min}, ${minusOne}`);
      this.panicIf(both, overflow, at);
    }
    const result = this.host.temp();
    this.host.emit(`${result} = ${signed ? "s" : "u"}${instruction} ${ty} ${a}, ${b}`);
    return result;
  }

  // `x.checkedAdd(y)` and its kin, the same in every build: the value, and for checked and
  // overflowing methods whether the operation overflowed, which is when checked gives null. Only
  // wrapping and saturating division by zero panics, as Rust's do. `b` is a `u32` for shifts and
  // powers.
  method(this: Mut<this>, family: string, operation: string, a: string, b: string, at: Ref<Span>, type: Integer): [string, string?] {
    const { bits, signed } = integerInfo(type);
    const ty = `i${bits}`;
    const [min, max] = range(type);
    switch (operation) {
      case "Add":
      case "Sub":
      case "Mul": {
        const name = operation.toLowerCase();
        if (family === "saturating" && name !== "mul") return [this.saturated(name, a, b, type)];
        const [v, over] = this.overflowing(name, a, b, type);
        if (family !== "saturating") return [v, over];
        // An overflowing product is past MIN when exactly one operand is negative.
        let bound = String(max);
        if (signed) {
          const mixed = this.computed(`xor ${ty} ${a}, ${b}`);
          const negative = this.computed(`icmp slt ${ty} ${mixed}, 0`);
          bound = this.computed(`select i1 ${negative}, ${ty} ${min}, ${ty} ${max}`);
        }
        return [this.computed(`select i1 ${over}, ${ty} ${bound}, ${ty} ${v}`)];
      }
      case "Neg": {
        if (family === "saturating") return [this.saturated("sub", "0", a, type)];
        const negated = this.computed(`sub ${ty} 0, ${a}`);
        const over = signed ? this.computed(`icmp eq ${ty} ${a}, ${min}`) : this.computed(`icmp ne ${ty} ${a}, 0`);
        return [negated, over];
      }
      case "Div":
      case "Rem": {
        const [instruction, byZero] = divisionOf(operation === "Div" ? "/" : "%");
        const zero = this.computed(`icmp eq ${ty} ${b}, 0`);
        if (family !== "checked") this.panicIf(zero, byZero, at);
        let overflow = "false";
        if (signed) {
          const lowest = this.computed(`icmp eq ${ty} ${a}, ${min}`);
          const minusOne = this.computed(`icmp eq ${ty} ${b}, -1`);
          overflow = this.computed(`and i1 ${lowest}, ${minusOne}`);
        }
        const bad = family === "checked" ? this.computed(`or i1 ${zero}, ${overflow}`) : overflow;
        // Dividing by 1 instead keeps LLVM's undefined cases out: MIN / 1 is wrapping's MIN, and
        // MIN % 1 its 0.
        const divisor = this.computed(`select i1 ${bad}, ${ty} 1, ${ty} ${b}`);
        const v = this.computed(`${signed ? "s" : "u"}${instruction} ${ty} ${a}, ${divisor}`);
        if (family === "saturating") return [this.computed(`select i1 ${overflow}, ${ty} ${max}, ${ty} ${v}`)];
        return [v, bad];
      }
      case "Shl":
      case "Shr": {
        const masked = this.computed(`and i32 ${b}, ${bits - 1}`);
        const amount = bits === 32 ? masked : this.computed(`${bits < 32 ? "trunc" : "zext"} i32 ${masked} to ${ty}`);
        const instruction = operation === "Shl" ? "shl" : signed ? "ashr" : "lshr";
        const shifted = this.computed(`${instruction} ${ty} ${a}, ${amount}`);
        const past = this.computed(`icmp uge i32 ${b}, ${bits}`);
        return [shifted, past];
      }
    }
    const flag = this.host.alloca("i1");
    this.host.emit(`store i1 false, ptr ${flag}`);
    const v = this.power(a, b, type, at, flag);
    const over = this.computed(`load i1, ptr ${flag}`);
    if (family !== "saturating") return [v, over];
    // A negative base to an odd power is past MIN.
    let bound = String(max);
    if (signed) {
      const negative = this.computed(`icmp slt ${ty} ${a}, 0`);
      const odd = this.computed(`trunc i32 ${b} to i1`);
      const below = this.computed(`and i1 ${negative}, ${odd}`);
      bound = this.computed(`select i1 ${below}, ${ty} ${min}, ${ty} ${max}`);
    }
    return [this.computed(`select i1 ${over}, ${ty} ${bound}, ${ty} ${v}`)];
  }

  // A new temporary holding what `line` computes.
  computed(this: Mut<this>, line: string): string {
    const v = this.host.temp();
    this.host.emit(`${v} = ${line}`);
    return v;
  }

  saturated(this: Mut<this>, name: string, x: string, y: string, type: Integer): string {
    const { bits, signed } = integerInfo(type);
    const ty = `i${bits}`;
    const intrinsic = `@llvm.${signed ? "s" : "u"}${name}.sat.${ty}`;
    this.host.intrinsics.add(`declare ${ty} ${intrinsic}(${ty}, ${ty})`);
    return this.computed(`call ${ty} ${intrinsic}(${ty} ${x}, ${ty} ${y})`);
  }

  // The wrapped result of `add`, `sub` or `mul` and whether it overflowed.
  overflowing(this: Mut<this>, name: string, a: string, b: string, type: Integer): [string, string] {
    const { bits, signed } = integerInfo(type);
    const ty = `i${bits}`;
    const intrinsic = `@llvm.${signed ? "s" : "u"}${name}.with.overflow.${ty}`;
    this.host.intrinsics.add(`declare { ${ty}, i1 } ${intrinsic}(${ty}, ${ty})`);
    const [pair, v, over] = [this.host.temp(), this.host.temp(), this.host.temp()];
    this.host.emit(`${pair} = call { ${ty}, i1 } ${intrinsic}(${ty} ${a}, ${ty} ${b})`);
    this.host.emit(`${v} = extractvalue { ${ty}, i1 } ${pair}, 0`);
    this.host.emit(`${over} = extractvalue { ${ty}, i1 } ${pair}, 1`);
    return [v, over];
  }

  panicIf(this: Mut<this>, condition: string, reason: string, at: Ref<Span>) {
    const fail = this.host.label();
    const ok = this.host.label();
    this.host.emit(`br i1 ${condition}, label %${fail}, label %${ok}`);
    this.host.startBlock(fail);
    this.host.mayPanic(`call void @fsh_rt_panic(ptr ${this.host.cString(`panicked at ${this.host.where(at)}:\n${reason}\n`)})`);
    this.host.emit("unreachable");
    this.host.startBlock(ok);
  }
}
