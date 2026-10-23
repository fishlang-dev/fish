import type { Instance } from "./check.ts";
import { CompileError } from "./diag.ts";
import { fileAt } from "./modules.ts";
import type { Expr, Param, Pattern, Span, Stmt } from "./parser.ts";
import { baseOf, field, fits, INTEGERS, literalType, type LiteralType, isFloat, isInteger, membersFor, show, type ClassType, type Integer, type ObjectType, type Type, type UnionType, type VariantType } from "./typing.ts";

// Comptime: Fish code run while compiling, by interpreting the checked program. What it computes
// is baked into the binary. It is pure computation: anything that would reach outside the
// program, or wait, is refused at the comptime site.

// An object or a class instance, its fields by name (a base's among them).
export type Record = { kind: "record"; type: ObjectType | ClassType; fields: Map<string, Value> };
export type Items = { kind: "array"; items: Value[] };
// A data-carrying enum's member and its payload.
export type Variant = { kind: "variant"; type: VariantType; args: Value[] };
// An Atomic or a Lock a top-level const holds: a global the program changes at run time, made
// while compiling but never used then.
export type Interior = { kind: "interior"; value: Value };
// A value in a union, and which member it is, as the program's tag says.
export type Member = { kind: "member"; type: Type; value: Value };

// A value while compiling: an integer as a bigint, a float as a number, a boolean, a string,
// null for an empty Option, or an aggregate. Objects are values in Fish, moved rather than shared,
// so a JS reference stands for one.
export type Value = bigint | number | boolean | string | null | undefined | Record | Items | Variant | Interior | Member | Place;

// Where a value lives, as a `Mut` holds it: reading and writing go through to it.
export type Place = { kind: "place"; get(): Value; set(v: Value): void };

// The most steps one evaluation may take, the deepest its calls may nest, and the longest
// string it may make.
const STEPS = 10_000_000;
const DEPTH = 1000;
const LONGEST = 1 << 28;

// What an optional link meeting an empty Option makes of the rest of its chain.
const SHORT = { kind: "short" } as const;

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

type Interpreter = ReturnType<typeof interpreter>;

// The value of `comptime expr`, written in `instance`.
export function comptimeValue(instance: Instance, site: Expr & { kind: "comptime" }): Value {
  return guarded(site, (run) => run.expr(seeded(instance), site.expr));
}

// Runs a `comptime { }` block written in `instance`, for what it checks.
export function comptimeBlock(instance: Instance, site: Stmt & { kind: "comptime" }) {
  guarded(site, (run) => run.block(seeded(instance), site.body));
}

// A comptime parameter's argument at a call written in `instance`.
export function comptimeArgument(instance: Instance, arg: Expr): Value {
  return guarded(arg, (run) => run.expr(seeded(instance), arg));
}

// The value an instance's comptime parameter was given, from the literal type it is keyed by.
// A comptime string array's binding: a literal type standing for exactly that array, so equal
// arrays share an instance.
const stringArrays = new Map<LiteralType, string[]>();

export function stringsType(items: string[]): LiteralType {
  const t = literalType(`strings ${JSON.stringify(items)}`);
  stringArrays.set(t, items);
  return t;
}

export function comptimeParameter(instance: Instance, p: Param): Value {
  const t = instance.bindings.get(`comptime ${(p.pattern as { name: string }).name}`);
  if (typeof t === "string" || t?.kind !== "literal") return undefined;
  const strings = stringArrays.get(t);
  if (strings) return { kind: "array", items: [...strings] };
  // An enum's member keeps which enum it is, as members of two enums may share a value.
  return t.owner ? { kind: "member", type: t, value: t.value } : t.value;
}

// A frame for comptime code in an instance, which knows the instance's comptime parameters.
function seeded(instance: Instance): Frame {
  return { instance, locals: known(instance), self: undefined };
}

// The comptime parameters an instance can read, by local: its own, and in a closure, those of
// the functions it is written in, through what it captures.
function known(instance: Instance): Map<number, Value> {
  const parent = instance.body.closure?.parent;
  const outer = parent ? known(parent) : new Map<number, Value>();
  const locals = new Map<number, Value>();
  for (const p of instance.body.params) if (p.comptime) locals.set(instance.locals.get(p)!.id, comptimeParameter(instance, p));
  for (const [alias, from] of instance.captures ?? []) if (from !== "this" && outer.has(from.id)) locals.set(alias.id, outer.get(from.id));
  return locals;
}

// Makes sure an instance is checked before comptime runs it, as a comptime argument may call a
// function the checker hasn't reached yet.
let ensureChecked: (instance: Instance) => boolean = () => true;

export function comptimeChecks(check: (instance: Instance) => boolean) {
  ensureChecked = check;
}

// Each top-level const's value, once computed, and those being computed, which a const reading
// itself would meet.
const constants = new WeakMap<Instance, Value>();
const computing = new Set<Instance>();

// A top-level const's value, or a `comptime { }` block run at the top level: its body.
export function comptimeBody(instance: Instance): Value {
  if (constants.has(instance)) return constants.get(instance);
  const v = guarded(instance.body, (run) => run.constant(instance, instance.body));
  constants.set(instance, v);
  return v;
}

// Runs comptime code; a panic, a refusal or an error it didn't catch is a compile error at the
// comptime site, noting where inside it happened.
function guarded(site: Span, go: (run: Interpreter) => Value): Value {
  try {
    return go(interpreter());
  } catch (e) {
    let stop = e;
    if (e instanceof Thrown) stop = new Stop(`this comptime code threw an error it didn't catch: ${described(e.value)}`, e.at, false);
    // A string or array past what the compiler can hold.
    if (e instanceof RangeError) stop = new Stop("this comptime code made a value too large to hold while compiling", site, false);
    if (!(stop instanceof Stop)) throw e;
    const what = stop.panic ? `this comptime code panicked: ${stop.message}` : stop.message;
    const inside = stop.at.start !== site.start || stop.at.end !== site.end;
    throw new CompileError(what, site.start, site.end, inside ? { message: stop.panic ? "it panicked here" : "here", start: stop.at.start, end: stop.at.end } : undefined);
  }
}

const constName = (c: Instance) => c.body.name.slice("const ".length);

function interpreter() {
  let steps = 0;
  let depth = 0;
  return { expr, block, constant };

  // A block's statements; the checker lets no `return`, `break` or `continue` leave it.
  function block(f: Frame, body: Stmt[]): Value {
    statements(f, body);
    return undefined;
  }

  // A const's value, computed once; one that reads itself never ends, so it is refused.
  function constant(c: Instance, at: Span): Value {
    if (constants.has(c)) return constants.get(c);
    if (computing.has(c)) throw new Stop(`'${constName(c)}' needs its own value to compute its value${cycle([...computing].slice([...computing].indexOf(c)))}`, at, false);
    computing.add(c);
    try {
      const v = call(c, [], undefined, at);
      constants.set(c, v);
      return v;
    } finally {
      computing.delete(c);
    }
  }

  // How consts reading each other in a ring do it, naming their files when they are in several.
  function cycle(ring: Instance[]): string {
    if (ring.length < 2) return "";
    const files = new Set(ring.map((c) => fileAt(c.body.start)));
    const named = [...ring, ring[0]!].map((c) => `'${constName(c)}'${files.size > 1 ? ` in '${fileAt(c.body.start)}'` : ""}`);
    return `: ${named[0]} reads ${named.slice(1).join(", which reads ")}`;
  }

  function step(at: Span) {
    if (++steps > STEPS) throw new Stop(`this comptime code took more than ${STEPS.toLocaleString("en-US")} steps; is there a loop that never ends?`, at, false);
  }

  // Code that reaches outside the program, or waits, which comptime never runs.
  function refuse(what: string, at: Span): never {
    throw new Stop(`${what} can't run while compiling: comptime code only computes values`, at, false);
  }

  // Pure code the interpreter doesn't run yet.
  function unsupported(what: string, at: Span): never {
    throw new Stop(`${what} isn't supported in comptime code yet`, at, false);
  }

  function panic(message: string, at: Span): never {
    throw new Stop(message, at, true);
  }

  function typeOf(f: Frame, e: Expr): Type {
    return f.instance.coercions.get(e) ?? f.instance.types.get(e)!;
  }

  // Calls a function, a `Mut` parameter given the place its argument names.
  function call(callee: Instance, args: Value[], self: Record | undefined, at: Span): Value {
    if (++depth > DEPTH) throw new Stop(`this comptime code nests calls more than ${DEPTH} deep; is there a recursion that never ends?`, at, false);
    try {
      if (callee.body.async) refuse("an async function", at);
      if (callee.body.generator) unsupported("a generator", at);
      if (callee.body.foreign) refuse(`the C function '${callee.body.name}'`, at);
      if (!ensureChecked(callee)) throw new Stop(`this comptime code calls '${callee.body.name}', which is still being checked, so it can't run yet; compute the value without it`, at, false);
      const frame: Frame = { instance: callee, locals: new Map(), self };
      callee.body.params.forEach((p, i) => frame.locals.set(callee.locals.get(p)!.id, args[i] ?? null));
      statements(frame, callee.body.body ?? []);
      return undefined;
    } catch (e) {
      if (e instanceof Return) return e.value;
      throw e;
    } finally {
      depth--;
    }
  }

  // The arguments of a call: a `Mut` parameter takes its argument's place, the rest values.
  function args(f: Frame, callee: Instance, list: Expr[]): Value[] {
    return list.map((a) => expr(f, a));
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
        if (!local || s.declarations.length !== 1) return unsupported("destructuring", s);
        f.locals.set(local.id, d.init ? expr(f, d.init) : undefined);
        return;
      }
      case "return":
        throw new Return(s.value ? expr(f, s.value) : undefined);
      case "if":
        if (unwrap(expr(f, s.cond))) statements(f, s.then);
        else if (s.else) statements(f, s.else);
        return;
      case "block":
      case "comptime":
        statements(f, s.body);
        return;
      case "unsafe":
        return refuse("'unsafe' code", s);
      case "while":
        while (unwrap(expr(f, s.cond))) if (!loopBody(f, s, s.body)) break;
        return;
      case "doWhile":
        do if (!loopBody(f, s, s.body)) break; while (unwrap(expr(f, s.cond)));
        return;
      case "for":
        if (s.init) statement(f, s.init);
        while (!s.test || unwrap(expr(f, s.test))) {
          step(s);
          if (!loopBody(f, s, s.body)) break;
          if (s.update) expr(f, s.update);
        }
        return;
      case "forOf": {
        const over = unwrap(expr(f, s.right));
        const local = f.instance.locals.get(s.left as Stmt)!;
        const items = typeof over === "string" ? [...over] : over && typeof over === "object" && over.kind === "array" ? over.items : unsupported("looping over this", s.right);
        for (const item of [...items]) {
          f.locals.set(local.id, item);
          if (!loopBody(f, s, s.body)) break;
        }
        return;
      }
      case "switch": {
        const v = expr(f, s.discriminant);
        const subject = f.instance.types.get(s.discriminant);
        let at = s.cases.findIndex((c) => c.test !== undefined && equal(v, subject, expr(f, c.test), f.instance.types.get(c.test)));
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
        return attempt(f, s);
      case "empty":
        return;
      default:
        return unsupported(`a '${s.kind}' statement`, s);
    }
  }

  // A `try`: its catch takes a thrown error; its `finally` runs however the block is left, but
  // not for a panic, which skips both, as it does at run time.
  function attempt(f: Frame, s: Extract<Stmt, { kind: "try" }>) {
    let left: unknown;
    let leaving = false;
    try {
      statements(f, s.block);
    } catch (e) {
      if (e instanceof Thrown && s.handler) {
        const local = s.param ? f.instance.locals.get(s) : undefined;
        if (local) f.locals.set(local.id, e.value);
        try {
          statements(f, s.handler);
        } catch (again) {
          [left, leaving] = [again, true];
        }
      } else [left, leaving] = [e, true];
    }
    if (leaving && (left instanceof Stop || !(left instanceof Return || left instanceof Jump || left instanceof Thrown))) throw left;
    if (s.finalizer) statements(f, s.finalizer);
    if (leaving) throw left;
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
    const v = link(f, e);
    return isShort(v) ? typed(f, e, null) : v;
  }

  // An expression's value; a member or call in an optional chain that met an empty Option
  // gives SHORT, which ends the chain as an empty Option.
  function link(f: Frame, e: Expr): Value | typeof SHORT {
    step(e);
    // A place lent to a `Mut`: the place itself, which reads and writes go through.
    const [own, target] = [f.instance.types.get(e), f.instance.coercions.get(e) ?? f.instance.types.get(e)];
    if (mutable(target) && !mutable(own) && (e.kind === "ident" || e.kind === "member" || e.kind === "index" || e.kind === "this")) return place(f, e);
    const v = raw(f, e);
    return isShort(v) ? v : typed(f, e, v);
  }

  // A value as the type it meets: a `Mut` stays a place, anything else reads through one; a float
  // where a literal meets one; a union's value tagged with the member its type says, in fields and
  // elements too; a member out of its union where a check narrowed it.
  function typed(f: Frame, e: Expr, value: Value): Value {
    const own = f.instance.types.get(e);
    const target = f.instance.coercions.get(e) ?? own;
    if (isPlace(value) && mutable(target)) return value;
    const v = isPlace(value) ? value.get() : value;
    const to = deref(target);
    if (typeof v === "bigint" && to !== undefined && isFloat(to)) return fit(Number(v), to);
    return retag(v, deref(own), to);
  }

  function raw(f: Frame, e: Expr): Value | typeof SHORT {
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
          text = joined(text, display(expr(f, x), typeOf(f, x)) + (e.quasis[i + 1] ?? ""), e);
        });
        return text;
      }
      case "ident": {
        const literal = literalValue(type);
        if (literal !== undefined && !f.instance.locals.has(e)) return literal;
        const read = f.instance.calls.get(e);
        if (read?.body.comptime === "const") return constant(read, e);
        const local = f.instance.locals.get(e);
        if (!local && e.name === "undefined") return null;
        if (!local || !f.locals.has(local.id)) throw new Stop(`'${e.name}' is only known when the program runs, so comptime code can't read it`, e, false);
        return f.locals.get(local.id);
      }
      case "this":
        return f.self ?? unsupported("'this'", e);
      case "comptime":
        return expr(f, e.expr);
      case "conditional":
        return unwrap(expr(f, e.cond)) ? expr(f, e.then) : expr(f, e.else);
      case "unary":
        return unary(f, e);
      case "binary":
        return binary(f, e);
      case "assign":
        return assign(f, e);
      case "update": {
        const at = place(f, e.operand);
        const old = unwrap(at.get()) as bigint | number;
        const one = typeof old === "bigint" ? 1n : 1;
        const next = numeric(e.op === "++" ? "+" : "-", old, one, typeOf(f, e.operand), e);
        at.set(next);
        return e.prefix ? next : old;
      }
      case "as":
        return convert(unwrap(expr(f, e.expr)), type, e);
      case "nonNull": {
        const v = unwrap(expr(f, e.expr));
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
            const held = f.locals.get(local.id);
            fields.set(p.name, held);
          } else return unsupported("this property", p);
        }
        return { kind: "record", type: type as ObjectType, fields };
      }
      case "array":
        return { kind: "array", items: e.elements.map((x) => (x ? expr(f, x) : unsupported("a hole in an array", e))) };
      case "new":
        return construct(f, e, type);
      case "member":
        return member(f, e, type);
      case "index": {
        const object = link(f, e.object);
        if (isShort(object)) return SHORT;
        return place(f, e, object).get();
      }
      case "call":
        return callExpr(f, e, type);
      case "match":
        return match(f, e);
      case "throw":
        throw new Thrown(expr(f, e.value), e);
      case "pipe":
        return unsupported("'|>'", e);
      default:
        return unsupported(`a '${e.kind}' expression`, e);
    }
  }

  function construct(f: Frame, e: Extract<Expr, { kind: "new" }>, type: Type): Value {
    if (typeof type !== "string" && type.kind === "interior" && type.which !== "Cell" && e.args?.length === 1) return { kind: "interior", value: expr(f, e.args[0]!) };
    if (typeof type === "string" || type.kind !== "class") return refuse(`'new ${show(type)}'`, e);
    const ctor = f.instance.calls.get(e)!;
    const made: Record = { kind: "record", type, fields: new Map() };
    call(ctor, args(f, ctor, e.args ?? []), made, e);
    return made;
  }

  function member(f: Frame, e: Extract<Expr, { kind: "member" }>, type: Type): Value | typeof SHORT {
    // An enum's member, as `Color.Red`, is known from its type alone.
    const literal = literalValue(type);
    if (literal !== undefined) return literal;
    if (typeof type !== "string" && type.kind === "variant" && type.fields.length === 0 && enumName(e.object)) return { kind: "variant", type, args: [] };
    const linked = link(f, e.object);
    if (isShort(linked)) return SHORT;
    const object = unwrap(linked);
    if (object === null && e.optional) return SHORT;
    const getter = f.instance.calls.get(e);
    if (getter) return call(getter, [], object as Record, e);
    if (e.name === "length" && typeof object === "string") return BigInt(object.length);
    if (object && typeof object === "object" && object.kind === "array" && e.name === "length") return BigInt(object.items.length);
    if (object && typeof object === "object" && object.kind === "record") return object.fields.get(e.name);
    return unsupported(`reading '${e.name}' here`, e);
  }

  function callExpr(f: Frame, e: Extract<Expr, { kind: "call" }>, type: Type): Value | typeof SHORT {
    const callee = e.callee;
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "console") refuse("printing", e);
    // A data-carrying enum's member, as `Shape.Circle(2)`.
    if (type !== undefined && typeof type !== "string" && type.kind === "variant" && callee.kind === "member" && enumName(callee.object)) {
      return { kind: "variant", type, args: e.args.map((a) => expr(f, a)) };
    }
    const target = f.instance.calls.get(e);
    if (target && (callee.kind === "super" || (callee.kind === "member" && callee.object.kind === "super"))) return call(target, args(f, target, e.args), f.self, e);
    if (target && callee.kind === "member" && target.body.self) {
      const linked = link(f, callee.object);
      if (isShort(linked)) return SHORT;
      const object = unwrap(linked);
      if (object === null && (callee.optional || e.optional)) return SHORT;
      return call(target, args(f, target, e.args), object as Record, e);
    }
    if (target) return call(target, args(f, target, e.args), undefined, e);
    if (callee.kind === "ident" && callee.name === "String" && e.args.length === 1) return display(expr(f, e.args[0]!), typeOf(f, e.args[0]!));
    // A static call on something that isn't a value, like `TcpListener.bind`, is std's own.
    if (callee.kind === "member" && !f.instance.types.has(callee.object)) return refuse(`'${callee.name}'`, e);
    if (callee.kind === "member") {
      const linked = link(f, callee.object);
      if (isShort(linked)) return SHORT;
      const held = unwrap(linked);
      if (held === null && (callee.optional || e.optional)) return SHORT;
      if (typeof held === "string") return stringMethod(callee.name, held, e.args.map((a) => unwrap(expr(f, a))), e);
      if (callee.name === "clone") return cloned(held);
      if (held && typeof held === "object" && held.kind === "array") {
        if (callee.name === "push") return void held.items.push(expr(f, e.args[0]!));
        if (callee.name === "pop") return held.items.length > 0 ? held.items.pop()! : null;
      }
      return unsupported(`calling '${callee.name}' here`, e);
    }
    return refuse(`'${callee.kind === "ident" ? callee.name : "this call"}'`, e);
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
        return s.replace(args[0] as string, args[1] as string);
      case "padStart":
        return joined("", s.padStart(Math.min(n(0), LONGEST + 1), args.length > 1 ? (args[1] as string) : undefined), at);
      case "padEnd":
        return joined("", s.padEnd(Math.min(n(0), LONGEST + 1), args.length > 1 ? (args[1] as string) : undefined), at);
      case "repeat":
        if ((args[0] as bigint) < 0n) panic("Invalid count value: " + String(args[0]), at);
        if (BigInt(s.length) * (args[0] as bigint) > BigInt(LONGEST)) tooLong(at);
        return s.repeat(n(0));
      case "slice":
        return s.slice(n(0), args.length > 1 ? n(1) : undefined);
      case "substring":
        return s.substring(n(0), args.length > 1 ? n(1) : undefined);
      default:
        return unsupported(`the string method '${name}'`, at);
    }
  }

  function tooLong(at: Span): never {
    throw new Stop(`this comptime code made a string longer than ${LONGEST.toLocaleString("en-US")} characters`, at, false);
  }

  // Two strings joined, within the longest string comptime makes.
  function joined(a: string, b: string, at: Span): string {
    if (a.length + b.length > LONGEST) tooLong(at);
    return a + b;
  }

  function unary(f: Frame, e: Extract<Expr, { kind: "unary" }>): Value {
    if (e.op === "await") refuse("'await'", e);
    const v = unwrap(expr(f, e.operand));
    const type = typeOf(f, e);
    if (e.op === "!") return !v;
    if (e.op === "typeof") return typeofValue(v);
    if (e.op === "-") return typeof v === "number" ? fit(-v, type as "f32" | "f64") : checked(-(v as bigint), type as Integer, "negate", e);
    if (e.op === "~") return wrap(~(v as bigint), type as Integer);
    return unsupported(`'${e.op}'`, e);
  }

  function binary(f: Frame, e: Extract<Expr, { kind: "binary" }>): Value {
    if (e.op === "&&") return unwrap(expr(f, e.left)) ? expr(f, e.right) : false;
    if (e.op === "||") return unwrap(expr(f, e.left)) ? true : expr(f, e.right);
    if (e.op === "??") {
      const v = expr(f, e.left);
      return unwrap(v) === null ? expr(f, e.right) : v;
    }
    if (e.op === "instanceof") {
      const v = unwrap(expr(f, e.left));
      return v !== null && typeof v === "object" && v.kind === "record" && v.type === f.instance.types.get(e.right);
    }
    const [a, b] = [expr(f, e.left), expr(f, e.right)];
    switch (e.op) {
      case "===":
        return equal(a, f.instance.types.get(e.left), b, f.instance.types.get(e.right));
      case "!==":
        return !equal(a, f.instance.types.get(e.left), b, f.instance.types.get(e.right));
      case "<":
        return (unwrap(a) as number) < (unwrap(b) as number);
      case "<=":
        return (unwrap(a) as number) <= (unwrap(b) as number);
      case ">":
        return (unwrap(a) as number) > (unwrap(b) as number);
      case ">=":
        return (unwrap(a) as number) >= (unwrap(b) as number);
    }
    const [x, y] = [unwrap(a), unwrap(b)];
    if (e.op === "+" && (typeof x === "string" || typeof y === "string")) return joined(display(x, typeOf(f, e.left)), display(y, typeOf(f, e.right)), e);
    return numeric(e.op, x as bigint | number, y as bigint | number, typeOf(f, e), e);
  }

  // The place is found first, then the value; a compound assignment reads the place once.
  function assign(f: Frame, e: Extract<Expr, { kind: "assign" }>): Value {
    const at = place(f, e.target);
    if (e.op === "=") {
      const v = expr(f, e.value);
      at.set(v);
      return v;
    }
    const op = e.op.slice(0, -1);
    const old = at.get();
    if (op === "&&" || op === "||" || op === "??") {
      const keep = op === "&&" ? !unwrap(old) : op === "||" ? !!unwrap(old) : unwrap(old) !== null;
      if (keep) return old;
      const v = expr(f, e.value);
      at.set(v);
      return v;
    }
    const [x, y] = [unwrap(old), unwrap(expr(f, e.value))];
    const v = op === "+" && typeof x === "string" ? joined(x, display(y, typeOf(f, e.value)), e) : numeric(op, x as bigint | number, y as bigint | number, typeOf(f, e.target), e);
    at.set(v);
    return v;
  }

  // Where an expression's value lives: a variable, a `Mut` parameter's place, an object's field,
  // or an array's element, its index read once.
  function place(f: Frame, target: Expr, object?: Value): Place {
    if (target.kind === "this") return { kind: "place", get: () => f.self, set: () => unsupported("replacing 'this'", target) };
    if (target.kind === "ident") {
      const local = f.instance.locals.get(target);
      if (!local || !f.locals.has(local.id)) throw new Stop(`'${target.name}' is only known when the program runs, so comptime code can't use it here`, target, false);
      const held = f.locals.get(local.id);
      if (isPlace(held)) return held;
      return { kind: "place", get: () => f.locals.get(local.id) as Value, set: (v) => void f.locals.set(local.id, v) };
    }
    if (target.kind === "member" && f.instance.setters.has(target)) {
      const self = unwrap(expr(f, target.object)) as Record;
      const getter = f.instance.calls.get(target);
      return { kind: "place", get: () => (getter ? call(getter, [], self, target) : self.fields.get(target.name)), set: (v) => void call(f.instance.setters.get(target)!, [v], self, target) };
    }
    if (target.kind === "member") {
      const holder = unwrap(expr(f, target.object));
      if (holder && typeof holder === "object" && holder.kind === "record") {
        const held = holder.fields.get(target.name);
        if (isPlace(held)) return held;
        return { kind: "place", get: () => holder.fields.get(target.name), set: (v) => void holder.fields.set(target.name, v) };
      }
    }
    if (target.kind === "index") {
      const held = unwrap(object ?? expr(f, target.object));
      const i = unwrap(expr(f, target.index)) as bigint;
      const length = typeof held === "string" ? held.length : held && typeof held === "object" && held.kind === "array" ? held.items.length : unsupported("indexing this", target);
      const inside = () => {
        if (i < 0n || i >= BigInt(length)) panic(`index out of bounds: the len is ${length} but the index is ${i}`, target);
      };
      // The bounds are checked where the place is taken, as a borrow of an element checks them.
      inside();
      if (typeof held === "string") return { kind: "place", get: () => (inside(), held[Number(i)]), set: () => unsupported("changing a string's character", target) };
      const array = held as Items;
      return { kind: "place", get: () => (inside(), array.items[Number(i)]), set: (v) => (inside(), void (array.items[Number(i)] = v)) };
    }
    return unsupported("changing this", target);
  }

  function match(f: Frame, e: Extract<Expr, { kind: "match" }>): Value {
    const subject = expr(f, e.subject);
    for (const arm of e.arms) {
      if (!tests(f, arm.pattern, subject)) continue;
      bind(f, arm.pattern, subject);
      if (arm.guard && !unwrap(expr(f, arm.guard))) continue;
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
    return unsupported("this match", e);
  }

  function tests(f: Frame, p: Pattern, value: Value): boolean {
    const info = f.instance.patterns.get(p)!;
    const tag = value && typeof value === "object" && value.kind === "member" ? value.type : undefined;
    const v = unwrap(value);
    const union = typeof info.type !== "string" && info.type.kind === "union" ? info.type : undefined;
    switch (info.kind) {
      case "any":
        return true;
      case "literal":
        return info.member ? same(v, literalValue(info.member) ?? info.member.value) : same(v, expr(f, (p as Extract<Pattern, { kind: "literal" }>).value));
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
        if (union && !info.shapes.includes(tag ?? held.type)) return false;
        return info.fields.every(([key, sub]) => tests(f, sub, held.fields.get(key)));
      }
      case "array": {
        const held = v as Items;
        return held.items.length === info.items.length && info.items.every((item, i) => tests(f, item, held.items[i]));
      }
      case "or":
        return info.alternatives.some((alt) => tests(f, alt, value));
    }
  }

  function bind(f: Frame, p: Pattern, value: Value) {
    const info = f.instance.patterns.get(p)!;
    const v = unwrap(value);
    if (info.kind === "any" && p.kind === "ident") return void f.locals.set(f.instance.locals.get(p as Expr)!.id, value);
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
      if (v === undefined) return unsupported(`'${op}' on floats`, at);
      return fit(v, type as "f32" | "f64");
    }
    if (!isInteger(type)) return unsupported(`'${op}' on '${show(type)}'`, at);
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
      // By squaring, as the program does: the base squares only while bits of the exponent remain.
      case "**": {
        let [result, base, exponent] = [1n, a, b];
        while (exponent > 0n) {
          step(at);
          if (exponent & 1n) result = checked(result * base, type, "multiply", at);
          exponent >>= 1n;
          if (exponent > 0n) base = checked(base * base, type, "multiply", at);
        }
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
    return unsupported(`'${op}'`, at);
  }

  // Comptime checks overflow in every build: a value that would wrap in a release build is a
  // compile error rather than a different number baked.
  function checked(v: bigint, type: Integer, verb: string, at: Span): bigint {
    if (wrap(v, type) !== v) panic(`attempt to ${verb} with overflow`, at);
    return v;
  }

  // `x as T` between numbers, as Rust's `as` converts: integers wrap, floats truncate and saturate.
  function convert(v: Value, to: Type, at: Span): Value {
    if (typeof v === "boolean") v = v ? 1n : 0n;
    if (isFloat(to)) return typeof v === "bigint" && to === "f32" ? toF32(v) : fit(Number(v), to);
    if (!isInteger(to)) return v;
    if (typeof v === "bigint") return wrap(v, to);
    if (typeof v !== "number") return unsupported(`converting this with 'as'`, at);
    if (Number.isNaN(v)) return 0n;
    const { bits, signed } = INTEGERS[to];
    const [min, max] = signed ? [-(1n << BigInt(bits - 1)), (1n << BigInt(bits - 1)) - 1n] : [0n, (1n << BigInt(bits)) - 1n];
    if (v === Infinity) return max;
    if (v === -Infinity) return min;
    const t = BigInt(Math.trunc(v));
    return t < min ? min : t > max ? max : t;
  }
}

function isShort(v: Value | typeof SHORT): v is typeof SHORT {
  return v === SHORT;
}

function isPlace(v: Value | Place): v is Place {
  return !!v && typeof v === "object" && v.kind === "place";
}

// The type a reference refers to, or the type itself.
function deref(t: Type | undefined): Type | undefined {
  return typeof t !== "string" && t?.kind === "ref" ? t.to : t;
}

// A value without a union's tag, read through a `Mut`'s place.
function unwrap(v: Value): Value {
  if (isPlace(v)) return unwrap(v.get());
  return v && typeof v === "object" && v.kind === "member" ? unwrap(v.value) : v;
}

function mutable(t: Type | undefined): boolean {
  return typeof t !== "string" && t?.kind === "ref" && t.mutable;
}

// A value of type `from` as one of type `to`: entering a union it is tagged with the member its
// type is, and a union's fields and elements are tagged the same way, so each is baked as the
// member the program would hold.
function retag(value: Value, from: Type | undefined, to: Type | undefined): Value {
  // A `Mut` held in a field stays the place it points at.
  if (isPlace(value)) return value;
  if (to === undefined || from === to) return typeof to !== "string" && to?.kind === "union" ? value : unwrap(value);
  if (typeof to !== "string" && to.kind === "union") {
    const tag = value && typeof value === "object" && value.kind === "member" ? value.type : undefined;
    if (tag !== undefined && to.members.includes(tag)) return value;
    const v = unwrap(value);
    const own = tag ?? from;
    const member = own !== undefined && to.members.includes(own) ? own : own !== undefined && typeof own !== "string" && own.kind === "union" ? memberOf(v, own) : own !== undefined ? (membersFor(own, to)[0] ?? memberOf(v, to)) : memberOf(v, to);
    return { kind: "member", type: member, value: retag(v, own, member) };
  }
  const v = unwrap(value);
  if (v && typeof v === "object" && v.kind === "record" && typeof to !== "string" && (to.kind === "object" || to.kind === "class")) {
    // A field the value leaves out is an optional one, which is empty.
    for (const f of to.fields) v.fields.set(f.name, v.fields.has(f.name) ? retag(v.fields.get(f.name), field(v.type, f.name)?.type, f.type) : retag(null, "null", f.type));
  }
  if (v && typeof v === "object" && v.kind === "array" && typeof to !== "string" && to.kind === "array") {
    const element = typeof from !== "string" && from?.kind === "array" ? from.element : undefined;
    v.items = v.items.map((x) => retag(x, element, to.element));
  }
  return v;
}

// Which member of its union a value is: its tag, or else the type it is written as, a literal
// standing for its base type.
function memberType(v: Value, t: Type | undefined): Type | undefined {
  if (v && typeof v === "object" && v.kind === "member") return memberType(v.value, v.type);
  const own = deref(t);
  if (typeof own !== "string" && own?.kind === "union") return memberOf(v, own);
  if (typeof own !== "string" && own?.kind === "literal") return baseOf(own) ?? own;
  return own;
}

// `===` on two values of the types they are written as: a union compares its member, then the
// value it holds.
function equal(a: Value, ta: Type | undefined, b: Value, tb: Type | undefined): boolean {
  const [ma, mb] = [memberType(a, ta), memberType(b, tb)];
  // A literal stands for its base type: members of two enums that share a value are equal, as
  // they are at run time.
  const plain = (t: Type | undefined) => (typeof t !== "string" && t?.kind === "literal" ? (baseOf(t) ?? t) : t);
  if (ma !== undefined && mb !== undefined && plain(ma) !== plain(mb)) return false;
  return same(a, b);
}

// The value an enum member's literal type stands for, or undefined for any other type.
function literalValue(type: Type | undefined): Value {
  return type !== undefined && typeof type !== "string" && type.kind === "literal" && type.owner ? type.value : undefined;
}

// Whether an expression names an enum rather than a value.
function enumName(e: Expr): boolean {
  return e.kind === "ident" || (e.kind === "member" && enumName(e.object));
}

// Values compare as `===` compares them: primitives by value, variants by member and payload.
function same(x: Value, y: Value): boolean {
  const [a, b] = [unwrap(x), unwrap(y)];
  if (a && b && typeof a === "object" && typeof b === "object" && a.kind === "variant" && b.kind === "variant") {
    return a.type === b.type && a.args.every((v, i) => same(v, b.args[i]));
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
  if (!v || typeof v !== "object" || v.kind === "interior") return v;
  if (v.kind === "place") return cloned(v.get());
  if (v.kind === "member") return { kind: "member", type: v.type, value: cloned(v.value) };
  if (v.kind === "array") return { kind: "array", items: v.items.map(cloned) };
  if (v.kind === "variant") return { kind: "variant", type: v.type, args: v.args.map(cloned) };
  return { kind: "record", type: v.type, fields: new Map([...v.fields].map(([k, x]) => [k, cloned(x)])) };
}

// What a thrown value is, for the compile error reporting it.
function described(value: Value): string {
  const v = unwrap(value);
  if (v && typeof v === "object" && v.kind === "record") {
    const message = unwrap(v.fields.get("message"));
    const name = v.type.kind === "class" ? v.type.name : "an object";
    return typeof message === "string" ? `${name}: ${message}` : name;
  }
  return display(v, undefined);
}

// An integer wrapped to its type's bits, as the machine holds it.
function wrap(v: bigint, type: Integer): bigint {
  const { bits, signed } = INTEGERS[type];
  return signed ? BigInt.asIntN(bits, v) : BigInt.asUintN(bits, v);
}

function fit(v: number, type: Type): number {
  return type === "f32" ? Math.fround(v) : v;
}

// An integer as the f32 nearest it, rounding once, ties to even.
function toF32(v: bigint): number {
  const magnitude = v < 0n ? -v : v;
  const bits = magnitude.toString(2).length;
  if (bits <= 24) return Math.fround(Number(v));
  const shift = BigInt(bits - 24);
  let mantissa = magnitude >> shift;
  const rest = magnitude - (mantissa << shift);
  const half = 1n << (shift - 1n);
  if (rest > half || (rest === half && (mantissa & 1n) === 1n)) mantissa += 1n;
  const rounded = Math.fround(Number(mantissa) * 2 ** Number(shift));
  return v < 0n ? -rounded : rounded;
}

// A value as `String(x)` and templates write it; an f32 as the shortest decimal naming it.
function display(value: Value, type: Type | undefined): string {
  const v = unwrap(value);
  if (typeof v === "number" && type === "f32") return shortestF32(v);
  if (typeof v === "number") return Object.is(v, -0) ? "0" : String(v);
  if (v === null) return "null";
  return String(v);
}

function shortestF32(v: number): string {
  if (!Number.isFinite(v) || v === 0) return Object.is(v, -0) ? "0" : String(v);
  for (let digits = 1; digits <= 9; digits++) {
    const near = Number(v.toPrecision(digits));
    if (Math.fround(near) === v) return String(near);
  }
  return String(v);
}

// The member of a union a value is when nothing says: its own type for an aggregate, the
// literal member with its value, or the member of its kind.
export function memberOf(value: Value, union: UnionType): Type {
  const m = union.members;
  if (value && typeof value === "object" && value.kind === "member" && m.includes(value.type)) return value.type;
  const v = unwrap(value);
  if (v === null) return "null";
  if (v && typeof v === "object") {
    if (v.kind === "array") return m.find((t) => typeof t !== "string" && t.kind === "array")!;
    if (v.kind === "interior") return m.find((t) => typeof t !== "string" && t.kind === "interior")!;
    if (v.kind === "member" || v.kind === "place") return memberOf(unwrap(v), union);
    return m.find((t) => t === v.type) ?? m.find((t) => fits(v.type, t))!;
  }
  const literal = m.find((t) => typeof t !== "string" && t.kind === "literal" && t.value === v);
  if (literal) return literal;
  if (typeof v === "bigint") return m.find(isInteger)!;
  if (typeof v === "number") return m.find(isFloat)!;
  if (typeof v === "string") return "string";
  return "boolean";
}

// The value inside a union's tag, for baking.
export function untagged(v: Value): Value {
  return unwrap(v);
}
