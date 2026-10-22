import type { Instance } from "./check.ts";
import { CompileError } from "./diag.ts";
import type { Expr, Pattern, Span, Stmt } from "./parser.ts";
import { fits, INTEGERS, isFloat, isInteger, show, type ClassType, type Integer, type ObjectType, type Type, type UnionType, type VariantType } from "./typing.ts";

// Comptime: Fish code run while compiling, by interpreting the checked program. What it computes
// is baked into the binary. It is pure computation: anything that would reach outside the
// program, or wait, is refused at the comptime site.

// An object or a class instance, its fields by name (a base's among them).
export type Record = { kind: "record"; type: ObjectType | ClassType; fields: Map<string, Value> };
export type Items = { kind: "array"; items: Value[] };
// A data-carrying enum's member and its payload.
export type Variant = { kind: "variant"; type: VariantType; args: Value[] };

// A value while compiling: an integer as a bigint, a float as a number, a boolean, a string,
// null for an empty Option, or an aggregate. Objects are values in Fish, moved rather than shared,
// so a JS reference stands for one.
export type Value = bigint | number | boolean | string | null | undefined | Record | Items | Variant;

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

// A `return`, unwinding to its function's call or to its match arm.
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

// An error thrown and not yet caught.
class Thrown {
  value: Value;
  at: Span;
  constructor(value: Value, at: Span) {
    this.value = value;
    this.at = at;
  }
}

type Frame = { instance: Instance; locals: Map<number, Value>; self: Record | undefined };

// The value of `comptime expr`, written in `instance`; a panic or refusal is a compile error at
// the comptime expression, noting where inside it happened.
export function comptimeValue(instance: Instance, site: Expr & { kind: "comptime" }): Value {
  let steps = 0;
  let depth = 0;
  try {
    return expr({ instance, locals: new Map(), self: undefined }, site.expr);
  } catch (e) {
    const stop = e instanceof Thrown ? new Stop(`this comptime code threw an error it didn't catch: ${described(e.value)}`, e.at, false) : e;
    if (!(stop instanceof Stop)) throw e;
    const what = stop.panic ? `this comptime code panicked: ${stop.message}` : stop.message;
    const inside = stop.at.start !== site.start || stop.at.end !== site.end;
    throw new CompileError(what, site.start, site.end, inside ? { message: stop.panic ? "it panicked here" : "here", start: stop.at.start, end: stop.at.end } : undefined);
  }

  function step(at: Span) {
    if (++steps > STEPS) throw new Stop(`this comptime code took more than ${STEPS.toLocaleString("en-US")} steps; is there a loop that never ends?`, at, false);
  }

  function refuse(what: string, at: Span): never {
    throw new Stop(`${what} can't run while compiling: comptime code only computes values`, at, false);
  }

  function panic(message: string, at: Span): never {
    throw new Stop(message, at, true);
  }

  function typeOf(f: Frame, e: Expr): Type {
    return f.instance.coercions.get(e) ?? f.instance.types.get(e)!;
  }

  function call(callee: Instance, args: Value[], self: Record | undefined, at: Span): Value {
    if (++depth > DEPTH) throw new Stop(`this comptime code nests calls more than ${DEPTH} deep; is there a recursion that never ends?`, at, false);
    if (callee.body.async) refuse("an async function", at);
    if (callee.body.foreign) refuse(`the C function '${callee.body.name}'`, at);
    const frame: Frame = { instance: callee, locals: new Map(), self };
    callee.body.params.forEach((p, i) => frame.locals.set(callee.locals.get(p)!.id, args[i] ?? null));
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
      case "let": {
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
        statements(f, s.body);
        return;
      case "unsafe":
        return refuse("'unsafe' code", s);
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
      case "forOf": {
        const over = expr(f, s.right);
        const local = f.instance.locals.get(s.left as Stmt)!;
        const items = typeof over === "string" ? [...over] : over && typeof over === "object" && over.kind === "array" ? over.items : refuse("looping over this", s.right);
        for (const item of [...items]) {
          f.locals.set(local.id, item);
          if (!loopBody(f, s, s.body)) break;
        }
        return;
      }
      case "switch": {
        const v = expr(f, s.discriminant);
        let at = s.cases.findIndex((c) => c.test !== undefined && same(v, expr(f, c.test)));
        if (at < 0) at = s.cases.findIndex((c) => c.test === undefined);
        if (at < 0) return;
        try {
          for (const c of s.cases.slice(at)) statements(f, c.body);
        } catch (e) {
          if (!(e instanceof Jump) || e.target !== s) throw e;
        }
        return;
      }
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
      case "throw":
        throw new Thrown(expr(f, s.value), s);
      case "try":
        try {
          try {
            statements(f, s.block);
          } catch (e) {
            if (!(e instanceof Thrown) || !s.handler) throw e;
            const local = s.param ? f.instance.locals.get(s) : undefined;
            if (local) f.locals.set(local.id, e.value);
            statements(f, s.handler);
          }
        } finally {
          if (s.finalizer) statements(f, s.finalizer);
        }
        return;
      case "empty":
        return;
      default:
        return refuse(`a '${s.kind}' statement`, s);
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
    // A literal meeting a float type is converted as it is at run time.
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
      case "null":
        return null;
      case "template": {
        let text = e.quasis[0] ?? "";
        e.exprs.forEach((x, i) => {
          text += display(expr(f, x)) + (e.quasis[i + 1] ?? "");
        });
        return text;
      }
      case "ident": {
        const literal = constant(type);
        if (literal !== undefined && !f.instance.locals.has(e)) return literal;
        const local = f.instance.locals.get(e);
        if (!local || !f.locals.has(local.id)) throw new Stop(`'${e.name}' is only known when the program runs, so comptime code can't read it`, e, false);
        return f.locals.get(local.id);
      }
      case "this":
        return f.self ?? refuse("'this'", e);
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
        const old = expr(f, e.operand) as bigint | number;
        const one = typeof old === "bigint" ? 1n : 1;
        const next = numeric(e.op === "++" ? "+" : "-", old, one, typeOf(f, e.operand), e);
        store(f, e.operand, next);
        return e.prefix ? next : old;
      }
      case "as":
        return convert(expr(f, e.expr), type, e);
      case "nonNull": {
        const v = expr(f, e.expr);
        if (v === null) panic("called `Option::unwrap()` on a `None` value", e);
        return v;
      }
      case "object": {
        const fields = new Map<string, Value>();
        for (const p of e.props) {
          if (p.kind === "property" && typeof p.key === "string") fields.set(p.key, expr(f, p.value));
          else if (p.kind === "shorthand") {
            const local = f.instance.locals.get(p)!;
            if (!f.locals.has(local.id)) throw new Stop(`'${p.name}' is only known when the program runs, so comptime code can't read it`, p, false);
            fields.set(p.name, f.locals.get(local.id));
          } else return refuse("this property", p);
        }
        return { kind: "record", type: type as ObjectType, fields };
      }
      case "array":
        return { kind: "array", items: e.elements.map((x) => (x ? expr(f, x) : refuse("a hole in an array", e))) };
      case "new":
        return construct(f, e, type);
      case "member":
        return member(f, e, type);
      case "index": {
        const v = expr(f, e.object);
        const i = expr(f, e.index) as bigint;
        const length = typeof v === "string" ? v.length : v && typeof v === "object" && v.kind === "array" ? v.items.length : refuse("indexing this", e);
        if (i < 0n || i >= BigInt(length)) panic(`index out of bounds: the len is ${length} but the index is ${i}`, e);
        return typeof v === "string" ? v[Number(i)] : (v as Items).items[Number(i)];
      }
      case "call":
        return callExpr(f, e, type);
      case "match":
        return match(f, e);
      case "throw":
        throw new Thrown(expr(f, e.value), e);
      default:
        return refuse(`a '${e.kind}' expression`, e);
    }
  }

  function construct(f: Frame, e: Extract<Expr, { kind: "new" }>, type: Type): Value {
    if (typeof type === "string" || type.kind !== "class") return refuse(`'new ${show(type)}'`, e);
    const ctor = f.instance.calls.get(e)!;
    const made: Record = { kind: "record", type, fields: new Map() };
    call(ctor, (e.args ?? []).map((a) => expr(f, a)), made, e);
    return made;
  }

  function member(f: Frame, e: Extract<Expr, { kind: "member" }>, type: Type): Value {
    // An enum's member, as `Color.Red`, is known from its type alone.
    const literal = constant(type);
    if (literal !== undefined) return literal;
    if (typeof type !== "string" && type.kind === "variant" && type.fields.length === 0 && enumName(e.object)) return { kind: "variant", type, args: [] };
    const getter = f.instance.calls.get(e);
    const object = expr(f, e.object);
    if (getter) return call(getter, [], object as Record, e);
    if (e.name === "length" && typeof object === "string") return BigInt(object.length);
    if (object && typeof object === "object" && object.kind === "array" && e.name === "length") return BigInt(object.items.length);
    if (object && typeof object === "object" && object.kind === "record") return object.fields.get(e.name);
    if (object === null && e.optional) return null;
    return refuse(`reading '${e.name}' here`, e);
  }

  function callExpr(f: Frame, e: Extract<Expr, { kind: "call" }>, type: Type): Value {
    const callee = e.callee;
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "console") refuse("printing", e);
    // A data-carrying enum's member, as `Shape.Circle(2)`.
    if (type !== undefined && typeof type !== "string" && type.kind === "variant" && callee.kind === "member" && enumName(callee.object)) {
      return { kind: "variant", type, args: e.args.map((a) => expr(f, a)) };
    }
    const target = f.instance.calls.get(e);
    if (target) {
      if (callee.kind === "super") return call(target, e.args.map((a) => expr(f, a)), f.self, e);
      const self = callee.kind === "member" && target.body.self ? (expr(f, callee.object) as Record) : undefined;
      return call(target, e.args.map((a) => expr(f, a)), self, e);
    }
    if (callee.kind === "ident" && callee.name === "String" && e.args.length === 1) return display(expr(f, e.args[0]!));
    if (callee.kind === "member") {
      const object = typeOf(f, callee.object);
      if (object === "string") return stringMethod(callee.name, expr(f, callee.object) as string, e.args.map((a) => expr(f, a)), e);
      const held = expr(f, callee.object);
      if (callee.name === "clone") return cloned(held);
      if (held && typeof held === "object" && held.kind === "array") {
        if (callee.name === "push") return void held.items.push(expr(f, e.args[0]!));
        if (callee.name === "pop") return held.items.length > 0 ? held.items.pop()! : null;
      }
    }
    return refuse(`'${callee.kind === "ident" ? callee.name : callee.kind === "member" ? callee.name : "this call"}'`, e);
  }

  function stringMethod(name: string, s: string, args: Value[], at: Span): Value {
    const n = (i: number) => Number(args[i] as bigint);
    switch (name) {
      case "charCodeAt": {
        const i = args[0] as bigint;
        if (i < 0n || i >= BigInt(s.length)) panic(`index out of bounds: the len is ${s.length} but the index is ${i}`, at);
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
      case "split": {
        const parts = args.length === 0 || args[0] === null ? [s] : s.split(args[0] as string, args.length > 1 ? n(1) : undefined);
        return { kind: "array", items: parts };
      }
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
        if ((args[0] as bigint) < 0n) panic("Invalid count value: " + String(args[0]), at);
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
    if (e.op === "typeof") return typeofValue(v);
    if (e.op === "-") return typeof v === "number" ? fit(-v, type as "f32" | "f64") : checked(-(v as bigint), type as Integer, "negate", e);
    if (e.op === "~") return wrap(~(v as bigint), type as Integer);
    return refuse(`'${e.op}'`, e);
  }

  function binary(f: Frame, e: Extract<Expr, { kind: "binary" }>): Value {
    if (e.op === "&&") return expr(f, e.left) ? expr(f, e.right) : false;
    if (e.op === "||") return expr(f, e.left) ? true : expr(f, e.right);
    if (e.op === "??") {
      const v = expr(f, e.left);
      return v === null ? expr(f, e.right) : v;
    }
    if (e.op === "instanceof") {
      const v = expr(f, e.left);
      return v !== null && typeof v === "object" && v.kind === "record" && v.type === f.instance.types.get(e.right);
    }
    const [a, b] = [expr(f, e.left), expr(f, e.right)];
    switch (e.op) {
      case "===":
        return same(a, b);
      case "!==":
        return !same(a, b);
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
    let v = expr(f, e.value);
    if (e.op !== "=") {
      const op = e.op.slice(0, -1);
      const old = expr(f, e.target);
      if (op === "&&" || op === "||" || op === "??") return refuse(`'${e.op}'`, e);
      v = op === "+" && typeof old === "string" ? old + display(v) : numeric(op, old as bigint | number, v as bigint | number, typeOf(f, e.target), e);
    }
    store(f, e.target, v);
    return v;
  }

  // Writes a value to a place: a variable, an object's field, or an array's element.
  function store(f: Frame, target: Expr, v: Value) {
    if (target.kind === "ident") {
      const local = f.instance.locals.get(target);
      if (!local || !f.locals.has(local.id)) throw new Stop(`'${target.name}' is only known when the program runs, so comptime code can't change it`, target, false);
      f.locals.set(local.id, v);
      return;
    }
    if (target.kind === "member" && f.instance.setters.has(target)) return void call(f.instance.setters.get(target)!, [v], expr(f, target.object) as Record, target);
    if (target.kind === "member") {
      const object = expr(f, target.object);
      if (object && typeof object === "object" && object.kind === "record") return void object.fields.set(target.name, v);
    }
    if (target.kind === "index") {
      const array = expr(f, target.object);
      const i = expr(f, target.index) as bigint;
      if (array && typeof array === "object" && array.kind === "array") {
        if (i < 0n || i >= BigInt(array.items.length)) panic(`index out of bounds: the len is ${array.items.length} but the index is ${i}`, target);
        array.items[Number(i)] = v;
        return;
      }
    }
    refuse("changing this", target);
  }

  function match(f: Frame, e: Extract<Expr, { kind: "match" }>): Value {
    const subject = expr(f, e.subject);
    for (const arm of e.arms) {
      if (!tests(f, arm.pattern, subject)) continue;
      bind(f, arm.pattern, subject);
      if (arm.guard && !expr(f, arm.guard)) continue;
      if (arm.body.kind !== "block") return expr(f, arm.body);
      // A block arm gives its value by `return`, which never leaves the function.
      try {
        statements(f, arm.body.body);
        return undefined;
      } catch (r) {
        if (r instanceof Return) return r.value;
        throw r;
      }
    }
    return refuse("this match", e);
  }

  function tests(f: Frame, p: Pattern, v: Value): boolean {
    const info = f.instance.patterns.get(p)!;
    const union = typeof info.type !== "string" && info.type.kind === "union" ? info.type : undefined;
    switch (info.kind) {
      case "any":
        return true;
      case "literal":
        return info.member ? same(v, constant(info.member) ?? info.member.value) : same(v, expr(f, (p as Extract<Pattern, { kind: "literal" }>).value));
      case "none":
        return v === null;
      case "some":
        return v !== null && tests(f, info.arg, v);
      case "variant": {
        const held = v as Variant;
        if (union && held.type !== info.variant) return false;
        return info.args.every((arg, i) => tests(f, arg, held.args[i]));
      }
      case "object": {
        const held = v as Record;
        if (union && !info.shapes.includes(held.type)) return false;
        return info.fields.every(([key, sub]) => tests(f, sub, held.fields.get(key)));
      }
      case "array": {
        const held = v as Items;
        return held.items.length === info.items.length && info.items.every((item, i) => tests(f, item, held.items[i]));
      }
      case "or":
        return info.alternatives.some((alt) => tests(f, alt, v));
    }
  }

  function bind(f: Frame, p: Pattern, v: Value) {
    const info = f.instance.patterns.get(p)!;
    if (info.kind === "any" && p.kind === "ident") return void f.locals.set(f.instance.locals.get(p as Expr)!.id, v);
    if (info.kind === "variant") info.args.forEach((arg, i) => bind(f, arg, (v as Variant).args[i]));
    if (info.kind === "object") for (const [key, sub] of info.fields) bind(f, sub, (v as Record).fields.get(key));
    if (info.kind === "array") info.items.forEach((item, i) => bind(f, item, (v as Items).items[i]));
    if (info.kind === "some") bind(f, info.arg, v);
  }

  // An arithmetic or bitwise operator on numbers of `type`, panicking where the program would.
  function numeric(op: string, a: bigint | number, b: bigint | number, type: Type, at: Span): Value {
    if (typeof a === "number" || typeof b === "number") {
      const [x, y] = [Number(a), Number(b)];
      const v = op === "+" ? x + y : op === "-" ? x - y : op === "*" ? x * y : op === "/" ? x / y : op === "%" ? x % y : op === "**" ? x ** y : undefined;
      if (v === undefined) return refuse(`'${op}' on floats`, at);
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
        if (b === 0n) panic(remainder ? "attempt to calculate the remainder with a divisor of zero" : "attempt to divide by zero", at);
        if (signed && b === -1n && a === -(1n << BigInt(bits - 1))) panic(`attempt to ${remainder ? "calculate the remainder" : "divide"} with overflow`, at);
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
        if (amount > BigInt(bits - 1)) panic(`attempt to shift ${op === "<<" ? "left" : "right"} with overflow`, at);
        if (op === "<<") return wrap(a << amount, type);
        return op === ">>" && signed ? a >> amount : wrap(BigInt.asUintN(bits, a) >> amount, type);
      }
    }
    return refuse(`'${op}'`, at);
  }

  function checked(v: bigint, type: Integer, verb: string, at: Span): bigint {
    if (wrap(v, type) !== v) panic(`attempt to ${verb} with overflow`, at);
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

// The value an enum member's literal type stands for, or undefined for any other type.
function constant(type: Type): Value {
  return typeof type !== "string" && type.kind === "literal" && type.owner ? type.value : undefined;
}

// Whether an expression names an enum rather than a value.
function enumName(e: Expr): boolean {
  return e.kind === "ident" || (e.kind === "member" && enumName(e.object));
}

// Values compare as `===` compares them: primitives by value, variants by member and payload.
function same(a: Value, b: Value): boolean {
  if (a && b && typeof a === "object" && typeof b === "object" && a.kind === "variant" && b.kind === "variant") {
    return a.type === b.type && a.args.every((x, i) => same(x, b.args[i]));
  }
  return a === b;
}

function typeofValue(v: Value): string {
  if (typeof v === "bigint" || typeof v === "number") return "number";
  if (v === null) return "undefined";
  if (typeof v === "object") return "object";
  return typeof v;
}

// A copy owning all its parts, as `.clone()` makes.
function cloned(v: Value): Value {
  if (!v || typeof v !== "object") return v;
  if (v.kind === "array") return { kind: "array", items: v.items.map(cloned) };
  if (v.kind === "variant") return { kind: "variant", type: v.type, args: v.args.map(cloned) };
  return { kind: "record", type: v.type, fields: new Map([...v.fields].map(([k, x]) => [k, cloned(x)])) };
}

// What a thrown value is, for the compile error reporting it.
function described(v: Value): string {
  if (v && typeof v === "object" && v.kind === "record") {
    const message = v.fields.get("message");
    const name = v.type.kind === "class" ? v.type.name : "an object";
    return typeof message === "string" ? `${name}: ${message}` : name;
  }
  return display(v);
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
  if (v === null) return "null";
  return String(v);
}

// The member of a union a value is: its own type for an aggregate, the literal member with its
// value, or the member of its kind.
export function memberOf(v: Value, union: UnionType): Type {
  const m = union.members;
  if (v === null) return "null";
  if (v && typeof v === "object") {
    if (v.kind === "array") return m.find((t) => typeof t !== "string" && t.kind === "array")!;
    return m.find((t) => t === v.type) ?? m.find((t) => fits(v.type, t))!;
  }
  const literal = m.find((t) => typeof t !== "string" && t.kind === "literal" && t.value === v);
  if (literal) return literal;
  if (typeof v === "bigint") return m.find(isInteger)!;
  if (typeof v === "number") return m.find(isFloat)!;
  if (typeof v === "string") return "string";
  return "boolean";
}
