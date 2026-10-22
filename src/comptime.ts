import type { Instance } from "./check.ts";
import { CompileError } from "./diag.ts";
import type { Expr, Span, Stmt } from "./parser.ts";
import { INTEGERS, isFloat, isInteger, show, type Integer, type Type } from "./typing.ts";

// Comptime: Fish code run while compiling, by interpreting the checked program. What it computes
// is baked into the binary. It is pure computation: anything that would reach outside the
// program, or wait, is refused at the comptime site.

// A value while compiling: an integer as a bigint, a float as a number, a boolean or a string.
export type Value = bigint | number | boolean | string | undefined;

// The most steps one evaluation may take, and the deepest its calls may nest.
const STEPS = 10_000_000;
const DEPTH = 1000;

// A panic, or a refusal, while compiling: where it happened, and what it says.
class Stop {
  message: string;
  at: Span;
  panic: boolean;
  constructor(message: string, at: Span, panic: boolean) {
    this.message = message;
    this.at = at;
    this.panic = panic;
  }
}

// A `return`, unwinding to its function's call.
class Return {
  value: Value;
  constructor(value: Value) {
    this.value = value;
  }
}

// A `break` or `continue`, unwinding to the statement it leaves or repeats.
class Jump {
  target: Stmt;
  again: boolean;
  constructor(target: Stmt, again: boolean) {
    this.target = target;
    this.again = again;
  }
}

type Frame = { instance: Instance; locals: Map<number, Value> };

// The value of `comptime expr`, written in `instance`; a panic or refusal is a compile error at
// the comptime expression, noting where inside it happened.
export function comptimeValue(instance: Instance, site: Expr & { kind: "comptime" }): Value {
  let steps = 0;
  let depth = 0;
  try {
    return expr({ instance, locals: new Map() }, site.expr);
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    const what = e.panic ? `this comptime code panicked: ${e.message}` : e.message;
    const inside = e.at.start !== site.start || e.at.end !== site.end;
    throw new CompileError(what, site.start, site.end, inside ? { message: e.panic ? "it panicked here" : "here", start: e.at.start, end: e.at.end } : undefined);
  }

  function step(at: Span) {
    if (++steps > STEPS) throw new Stop(`this comptime code took more than ${STEPS.toLocaleString("en-US")} steps; is there a loop that never ends?`, at, false);
  }

  function refuse(what: string, at: Span): never {
    throw new Stop(`${what} can't run while compiling: comptime code only computes values`, at, false);
  }

  function typeOf(f: Frame, e: Expr): Type {
    return f.instance.coercions.get(e) ?? f.instance.types.get(e)!;
  }

  function call(callee: Instance, args: Value[], at: Span): Value {
    if (++depth > DEPTH) throw new Stop(`this comptime code nests calls more than ${DEPTH} deep; is there a recursion that never ends?`, at, false);
    if (callee.body.async) refuse("an async function", at);
    const frame: Frame = { instance: callee, locals: new Map() };
    callee.body.params.forEach((p, i) => frame.locals.set(callee.locals.get(p)!.id, args[i]));
    try {
      statements(frame, callee.body.body ?? []);
      return undefined;
    } catch (e) {
      if (e instanceof Return) return e.value;
      throw e;
    } finally {
      depth--;
    }
  }

  function statements(f: Frame, list: Stmt[]) {
    for (const s of list) statement(f, s);
  }

  function statement(f: Frame, s: Stmt) {
    step(s);
    switch (s.kind) {
      case "expr":
        expr(f, s.expr);
        return;
      case "let":
      {
        // The checker gives a declaration one name, its local keyed by the statement.
        const local = f.instance.locals.get(s);
        const d = s.declarations[0]!;
        if (!local || s.declarations.length !== 1) return refuse("destructuring", s);
        f.locals.set(local.id, d.init ? expr(f, d.init) : undefined);
        return;
      }
      case "return":
        throw new Return(s.value ? expr(f, s.value) : undefined);
      case "if":
        if (expr(f, s.cond)) statements(f, s.then);
        else if (s.else) statements(f, s.else);
        return;
      case "block":
      case "unsafe":
        if (s.kind === "unsafe") refuse("'unsafe' code", s);
        statements(f, s.body);
        return;
      case "while":
        while (expr(f, s.cond)) if (!loopBody(f, s, s.body)) break;
        return;
      case "doWhile":
        do if (!loopBody(f, s, s.body)) break; while (expr(f, s.cond));
        return;
      case "for":
        if (s.init) statement(f, s.init);
        while (!s.test || expr(f, s.test)) {
          if (!loopBody(f, s, s.body)) break;
          if (s.update) expr(f, s.update);
        }
        return;
      case "break":
      case "continue":
        throw new Jump(f.instance.jumps.get(s)!, s.kind === "continue");
      case "labeled":
        try {
          statement(f, s.body);
        } catch (e) {
          if (!(e instanceof Jump) || e.target !== s) throw e;
        }
        return;
      case "empty":
        return;
      default:
        refuse(`a '${s.kind}' statement`, s);
    }
  }

  // Runs a loop's body once: false when a `break` leaves the loop.
  function loopBody(f: Frame, loop: Stmt, body: Stmt[]): boolean {
    try {
      statements(f, body);
      return true;
    } catch (e) {
      if (e instanceof Jump && e.target === loop) return e.again;
      throw e;
    }
  }

  function expr(f: Frame, e: Expr): Value {
    step(e);
    const v = raw(f, e);
    // A literal meeting a float type, or a narrower declared type, is converted as it is at run time.
    const to = f.instance.coercions.get(e);
    if (to !== undefined && typeof v === "bigint" && isFloat(to)) return fit(Number(v), to);
    return v;
  }

  function raw(f: Frame, e: Expr): Value {
    const type = f.instance.types.get(e)!;
    switch (e.kind) {
      case "int":
        return isFloat(type) ? fit(Number(e.value), type) : BigInt(e.value);
      case "float":
        return fit(e.value, type as "f32" | "f64");
      case "bool":
        return e.value;
      case "string":
        return e.value;
      case "template": {
        let text = e.quasis[0] ?? "";
        e.exprs.forEach((x, i) => {
          text += display(expr(f, x)) + (e.quasis[i + 1] ?? "");
        });
        return text;
      }
      case "ident": {
        const local = f.instance.locals.get(e);
        if (!local || !f.locals.has(local.id)) throw new Stop(`'${e.name}' is only known when the program runs, so comptime code can't read it`, e, false);
        return f.locals.get(local.id);
      }
      case "comptime":
        return expr(f, e.expr);
      case "conditional":
        return expr(f, e.cond) ? expr(f, e.then) : expr(f, e.else);
      case "unary":
        return unary(f, e);
      case "binary":
        return binary(f, e);
      case "assign":
        return assign(f, e);
      case "update": {
        const local = f.instance.locals.get(e.operand);
        if (e.operand.kind !== "ident" || !local) return refuse("changing this", e);
        const old = f.locals.get(local.id) as bigint | number;
        const one = typeof old === "bigint" ? 1n : 1;
        const next = numeric(e.op === "++" ? "+" : "-", old, one, typeOf(f, e.operand), e);
        f.locals.set(local.id, next);
        return e.prefix ? next : old;
      }
      case "as":
        return convert(expr(f, e.expr), type, e);
      case "member":
        if (e.name === "length" && typeof typeOf(f, e.object) === "string" && typeOf(f, e.object) === "string") return BigInt((expr(f, e.object) as string).length);
        return refuse("reading this member", e);
      case "index": {
        const s = expr(f, e.object);
        const i = expr(f, e.index) as bigint;
        if (typeof s !== "string") return refuse("indexing this", e);
        if (i < 0n || i >= BigInt(s.length)) throw new Stop(`index out of bounds: the len is ${s.length} but the index is ${i}`, e, true);
        return s[Number(i)];
      }
      case "call":
        return callExpr(f, e);
      default:
        return refuse(`a '${e.kind}' expression`, e);
    }
  }

  function callExpr(f: Frame, e: Extract<Expr, { kind: "call" }>): Value {
    const callee = e.callee;
    if (callee.kind === "member" && (callee.object.kind === "ident" && callee.object.name === "console")) refuse("printing", e);
    const target = f.instance.calls.get(e);
    if (target) {
      if (callee.kind === "member" && target.body.self && !target.body.self.constructor) refuse("calling a method", e);
      return call(target, e.args.map((a) => expr(f, a)), e);
    }
    if (callee.kind === "ident" && callee.name === "String" && e.args.length === 1) return display(expr(f, e.args[0]!));
    if (callee.kind === "member" && typeOf(f, callee.object) === "string") return stringMethod(callee.name, expr(f, callee.object) as string, e.args.map((a) => expr(f, a)), e);
    return refuse(`'${callee.kind === "ident" ? callee.name : callee.kind === "member" ? callee.name : "this call"}'`, e);
  }

  function stringMethod(name: string, s: string, args: Value[], at: Span): Value {
    const n = (i: number) => Number(args[i] as bigint);
    switch (name) {
      case "charCodeAt": {
        const i = args[0] as bigint;
        if (i < 0n || i >= BigInt(s.length)) throw new Stop(`index out of bounds: the len is ${s.length} but the index is ${i}`, at, true);
        return BigInt(s.charCodeAt(Number(i)));
      }
      case "indexOf":
        return BigInt(s.indexOf(args[0] as string, args.length > 1 ? n(1) : undefined));
      case "includes":
        return s.includes(args[0] as string, args.length > 1 ? n(1) : undefined);
      case "startsWith":
        return s.startsWith(args[0] as string, args.length > 1 ? n(1) : undefined);
      case "endsWith":
        return s.endsWith(args[0] as string, args.length > 1 ? n(1) : undefined);
      case "trim":
        return s.trim();
      case "trimStart":
        return s.trimStart();
      case "trimEnd":
        return s.trimEnd();
      case "toUpperCase":
        return s.toUpperCase();
      case "toLowerCase":
        return s.toLowerCase();
      case "replace":
        return s.replace(args[0] as string, () => args[1] as string);
      case "padStart":
        return s.padStart(n(0), args.length > 1 ? (args[1] as string) : undefined);
      case "padEnd":
        return s.padEnd(n(0), args.length > 1 ? (args[1] as string) : undefined);
      case "repeat":
        if ((args[0] as bigint) < 0n) throw new Stop("Invalid count value: " + String(args[0]), at, true);
        return s.repeat(n(0));
      case "slice":
        return s.slice(n(0), args.length > 1 ? n(1) : undefined);
      case "substring":
        return s.substring(n(0), args.length > 1 ? n(1) : undefined);
      default:
        return refuse(`the string method '${name}'`, at);
    }
  }

  function unary(f: Frame, e: Extract<Expr, { kind: "unary" }>): Value {
    if (e.op === "await") refuse("'await'", e);
    const v = expr(f, e.operand);
    const type = typeOf(f, e);
    if (e.op === "!") return !v;
    if (e.op === "-") return typeof v === "number" ? fit(-v, type as "f32" | "f64") : checked(-(v as bigint), type as Integer, "negate", e);
    if (e.op === "~") return wrap(~(v as bigint), type as Integer);
    return refuse(`'${e.op}'`, e);
  }

  function binary(f: Frame, e: Extract<Expr, { kind: "binary" }>): Value {
    if (e.op === "&&") return expr(f, e.left) ? expr(f, e.right) : false;
    if (e.op === "||") return expr(f, e.left) ? true : expr(f, e.right);
    const [a, b] = [expr(f, e.left), expr(f, e.right)];
    switch (e.op) {
      case "===":
        return a === b;
      case "!==":
        return a !== b;
      case "<":
        return (a as number) < (b as number);
      case "<=":
        return (a as number) <= (b as number);
      case ">":
        return (a as number) > (b as number);
      case ">=":
        return (a as number) >= (b as number);
    }
    if (e.op === "+" && (typeof a === "string" || typeof b === "string")) return display(a) + display(b);
    return numeric(e.op, a as bigint | number, b as bigint | number, typeOf(f, e), e);
  }

  function assign(f: Frame, e: Extract<Expr, { kind: "assign" }>): Value {
    const local = f.instance.locals.get(e.target);
    if (e.target.kind !== "ident" || !local) return refuse("assigning to this", e);
    let v = expr(f, e.value);
    if (e.op !== "=") {
      const op = e.op.slice(0, -1);
      const old = f.locals.get(local.id);
      if (op === "&&" || op === "||" || op === "??") return refuse(`'${e.op}'`, e);
      v = op === "+" && typeof old === "string" ? old + display(v) : numeric(op, old as bigint | number, v as bigint | number, typeOf(f, e.target), e);
    }
    f.locals.set(local.id, v);
    return v;
  }

  // An arithmetic or bitwise operator on numbers of `type`, panicking where the program would.
  function numeric(op: string, a: bigint | number, b: bigint | number, type: Type, at: Span): Value {
    if (typeof a === "number" || typeof b === "number") {
      const [x, y] = [Number(a), Number(b)];
      const v = op === "+" ? x + y : op === "-" ? x - y : op === "*" ? x * y : op === "/" ? x / y : op === "%" ? x % y : op === "**" ? x ** y : NaN;
      if (Number.isNaN(v) && !["+", "-", "*", "/", "%", "**"].includes(op)) return refuse(`'${op}'`, at);
      return fit(v, type as "f32" | "f64");
    }
    if (!isInteger(type)) return refuse(`'${op}' on '${show(type)}'`, at);
    const { bits, signed } = INTEGERS[type];
    switch (op) {
      case "+":
        return checked(a + b, type, "add", at);
      case "-":
        return checked(a - b, type, "subtract", at);
      case "*":
        return checked(a * b, type, "multiply", at);
      case "/":
      case "%": {
        const remainder = op === "%";
        if (b === 0n) throw new Stop(remainder ? "attempt to calculate the remainder with a divisor of zero" : "attempt to divide by zero", at, true);
        if (signed && b === -1n && a === -(1n << BigInt(bits - 1))) throw new Stop(`attempt to ${remainder ? "calculate the remainder" : "divide"} with overflow`, at, true);
        return remainder ? a % b : a / b;
      }
      case "**": {
        let result = 1n;
        for (let i = 0n; i < b; i++) result = checked(result * a, type, "multiply", at);
        return result;
      }
      case "&":
        return wrap(a & b, type);
      case "|":
        return wrap(a | b, type);
      case "^":
        return wrap(a ^ b, type);
      case "<<":
      case ">>":
      case ">>>": {
        const amount = BigInt.asUintN(bits, b);
        if (amount > BigInt(bits - 1)) throw new Stop(`attempt to shift ${op === "<<" ? "left" : "right"} with overflow`, at, true);
        if (op === "<<") return wrap(a << amount, type);
        return op === ">>" && signed ? a >> amount : wrap(BigInt.asUintN(bits, a) >> amount, type);
      }
    }
    return refuse(`'${op}'`, at);
  }

  function checked(v: bigint, type: Integer, verb: string, at: Span): bigint {
    if (wrap(v, type) !== v) throw new Stop(`attempt to ${verb} with overflow`, at, true);
    return v;
  }

  // `x as T` between numbers, as Rust's `as` converts: integers wrap, floats truncate and saturate.
  function convert(v: Value, to: Type, at: Span): Value {
    if (isFloat(to)) return fit(Number(v), to);
    if (!isInteger(to)) return v;
    if (typeof v === "bigint") return wrap(v, to);
    if (typeof v !== "number") return refuse(`converting this with 'as'`, at);
    if (Number.isNaN(v)) return 0n;
    const { bits, signed } = INTEGERS[to];
    const [min, max] = signed ? [-(1n << BigInt(bits - 1)), (1n << BigInt(bits - 1)) - 1n] : [0n, (1n << BigInt(bits)) - 1n];
    if (v === Infinity) return max;
    if (v === -Infinity) return min;
    const t = BigInt(Math.trunc(v));
    return t < min ? min : t > max ? max : t;
  }
}

// An integer wrapped to its type's bits, as the machine holds it.
function wrap(v: bigint, type: Integer): bigint {
  const { bits, signed } = INTEGERS[type];
  return signed ? BigInt.asIntN(bits, v) : BigInt.asUintN(bits, v);
}

function fit(v: number, type: Type): number {
  return type === "f32" ? Math.fround(v) : v;
}

// A value as `String(x)` and templates write it.
function display(v: Value): string {
  if (typeof v === "number") return Object.is(v, -0) ? "0" : String(v);
  return String(v);
}
