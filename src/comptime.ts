import type { Instance } from "./check.ts";
import { bodyOf, type LocalId } from "./arenas.ts";
import { CompileError } from "./diag.ts";
import { fileAt } from "./modules.ts";
import { built, quoted, type Builder, type Free } from "./quote.ts";
import { integerMethod } from "./values.ts";
import type { Expr, Param, Pattern, Span, Stmt } from "./parser.ts";
import type { Tables } from "./compilation.ts";
import { INTEGERS, range, redundantBang, type LiteralType, isFloat, isInteger, type ClassType, type Integer, type ObjectType, type Type, type UnionType, type VariantType, type Typing } from "./typing.ts";

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
export type Value = bigint | f64 | boolean | string | null | undefined | Record | Items | Variant | Interior | Member | Place;

// Where a value lives, as a `Mut` holds it: reading and writing go through to it.
export type Place = { kind: "place"; get(): Value; set(v: Value): void };

// The most steps one evaluation may take, the deepest its calls may nest, and the longest
// string it may make.
const STEPS = 10_000_000;
const DEPTH = 1000;
const LONGEST = 1 << 28;

// What an optional link meeting an empty Option makes of the rest of its chain.
const SHORT = { kind: "short" } as const;

// std's crypto functions, which comptime refuses as it refuses Math.random.
const RANDOM = new Set(["getRandomValues", "randomBytes", "randomUUID"]);

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

// A false `assert`, which fails the build at the assert itself.
class Assertion extends Stop {}

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

type Frame = { instance: Instance; locals: Map<LocalId, Value>; self: Record | undefined };


// The value of `comptime expr`, written in `instance`.
export function comptimeValue(instance: Instance, site: Expr & { kind: "comptime" }): Value {
  return guarded(instance.tables, site, (run) => run.expr(seeded(instance), site.expr));
}

// Runs a `comptime { }` block written in `instance`, for what it checks.
export function comptimeBlock(instance: Instance, site: Stmt & { kind: "comptime" }) {
  guarded(instance.tables, site, (run) => run.block(seeded(instance), site.body));
}

// A comptime parameter's argument at a call written in `instance`.
export function comptimeArgument(instance: Instance, arg: Expr): Value {
  return guarded(instance.tables, arg, (run) => run.expr(seeded(instance), arg));
}

// Renames, in a quote's value, the names spelled `from` in nodes its quotes made.
function renameQuoted({ quotedSpans }: Tables, v: Value, from: string, to: string) {
  const spans = quotedSpans.get(untagged(v) as object) ?? new Set<string>();
  const visit = (x: Value) => {
    const u = untagged(x);
    if (!u || typeof u !== "object") return;
    if (u.kind === "array") return u.items.forEach(visit);
    if (u.kind !== "record") return;
    const kind = u.fields.get("kind");
    const at = `${u.fields.get("start")}:${u.fields.get("end")}`;
    const name = u.fields.get("name");
    if (spans.has(at) && typeof name === "string" && (kind === "ident" || kind === "ref" || kind === "variant")) {
      const [head, ...rest] = name.split(".");
      if (head === from) u.fields.set("name", [to, ...rest].join("."));
    }
    for (const f of u.fields.values()) visit(f);
  };
  visit(v);
}

// A function run while compiling with the given arguments, as a macro runs on a declaration;
// a failure is reported at `site`.
export function comptimeCall(instance: Instance, args: Value[], site: Span): Value {
  return guarded(instance.tables, site, (run) => run.call(instance, args, undefined, site));
}

// How a quoted tree, or a declaration a macro takes, becomes a value while compiling.
export const astValues = (splice: (i: usize, into: Type) => Value, holes: Value[] = [], at: Span = { start: 0, end: 0 }): Builder<Value> => ({
  record: (t, fields) => ({ kind: "record", type: t, fields }),
  array: (items) => ({ kind: "array", items }),
  member: (v, _, m) => ({ kind: "member", type: m, value: v }),
  splice,
  // A splice where a name goes: the name of the identifier it is.
  name: (i) => {
    const v = untagged(holes[i]);
    if (v && typeof v === "object" && v.kind === "record" && v.fields.get("kind") === "ident") return v.fields.get("name");
    throw new Stop("a splice where a name goes takes an identifier, as 'ident(\"name\")' makes", at, false);
  },
  int: (n) => n,
  none: null,
});

// A comptime string array's binding: a literal type standing for exactly that array, so equal
// arrays share an instance. It is never the interned literal of an ordinary string, which a
// string parameter may be given with the same text.
export function stringsType({ typing, stringArrays }: Tables, items: string[]): LiteralType {
  const t = typing.standInLiteral(`strings ${JSON.stringify(items)}`);
  stringArrays.set(t, items);
  return t;
}

// The value an instance's comptime parameter was given, from the literal type it is keyed by.
export function comptimeParameter(instance: Instance, p: Param): Value {
  const t = instance.bindings.get(`comptime ${(p.pattern as { name: string }).name}`);
  const r = t === undefined || typeof t === "string" ? undefined : instance.tables.typing.rec(t);
  if (r?.kind !== "literal") return undefined;
  const strings = instance.tables.stringArrays.get(t as LiteralType);
  if (strings) return { kind: "array", items: [...strings] };
  // An enum's member keeps which enum it is, as members of two enums may share a value.
  return r.owner ? { kind: "member", type: t!, value: r.value } : r.value;
}

// A frame for comptime code in an instance, which knows the instance's comptime parameters.
function seeded(instance: Instance): Frame {
  return { instance, locals: known(instance), self: undefined };
}

// The comptime parameters an instance can read, by local: its own, and in a closure, those of
// the functions it is written in, through what it captures.
function known(instance: Instance): Map<LocalId, Value> {
  const parent = bodyOf(instance).closure?.parent;
  const outer = parent ? known(instance.tables.arenas.instanceOf(parent)) : new Map<LocalId, Value>();
  const locals = new Map<LocalId, Value>();
  for (const p of bodyOf(instance).params) if (p.comptime) locals.set(instance.locals.get(p)!, comptimeParameter(instance, p));
  for (const [alias, from] of instance.captures ?? []) if (from !== "this" && outer.has(from)) locals.set(alias, outer.get(from));
  return locals;
}

// Makes sure an instance is checked before comptime runs it, as a comptime argument may call a
// function the checker hasn't reached yet.
export function comptimeChecks(tables: Tables, check: (instance: Instance) => boolean) {
  tables.ensureChecked = (id) => check(tables.arenas.instanceOf(id));
}

// A top-level const's value, or a `comptime { }` block run at the top level: its body.
export function comptimeBody(instance: Instance): Value {
  const { constants } = instance.tables;
  if (constants.has(instance.id)) return constants.get(instance.id);
  const v = guarded(instance.tables, bodyOf(instance), (run) => run.constant(instance, bodyOf(instance)));
  constants.set(instance.id, v);
  return v;
}

// Runs comptime code; a panic, a refusal or an error it didn't catch is a compile error at the
// comptime site, noting where inside it happened.
function guarded(tables: Tables, site: Span, go: (run: Interpreter) => Value): Value {
  try {
    return go(new Interpreter(tables));
  } catch (e) {
    let stop = e;
    if (e instanceof Thrown) stop = new Stop(`this comptime code threw an error it didn't catch: ${described(tables.typing, e.value)}`, e.at, false);
    // A string or array past what the compiler can hold.
    if (e instanceof RangeError) stop = new Stop("this comptime code made a value too large to hold while compiling", site, false);
    if (!(stop instanceof Stop)) throw e;
    const inside = stop.at.start !== site.start || stop.at.end !== site.end;
    if (stop instanceof Assertion) throw new CompileError("E1101", stop.message, stop.at.start, stop.at.end, inside ? { message: "while running this comptime code", start: site.start, end: site.end } : undefined);
    const what = stop.panic ? `this comptime code panicked: ${stop.message}` : stop.message;
    throw new CompileError("E1101", what, site.start, site.end, inside ? { message: stop.panic ? "it panicked here" : "here", start: stop.at.start, end: stop.at.end } : undefined);
  }
}

const constName = (c: Instance) => bodyOf(c).name.slice("const ".length);

class Interpreter {
  tables: Tables;

  constructor(tables: Tables) {
    this.tables = tables;
    this.equalities = this.tables.equalities;
    this.quotes = this.tables.quotes;
    this.restStarts = this.tables.restStarts;
    this.stringBuilds = this.tables.stringBuilds;
    this.timerNames = this.tables.timerNames;
    this.constants = this.tables.constants;
    this.computing = this.tables.computing;
    this.ensureChecked = this.tables.ensureChecked;
    this.scopes = this.tables.quoteScopes;
    this.frees = this.tables.quoteFrees;
    this.quotedSpans = this.tables.quotedSpans;
    this.typing = this.tables.typing;
    this.files = this.tables.files;
    this.asserts = this.tables.asserts;
    this.clocks = this.tables.clocks;
    this.integerCalls = this.tables.integerCalls;
    this.arenas = this.tables.arenas;
  }
  private equalities: Tables["equalities"];
  private quotes: Tables["quotes"];
  private restStarts: Tables["restStarts"];
  private stringBuilds: Tables["stringBuilds"];
  private timerNames: Tables["timerNames"];
  private constants: Tables["constants"];
  private computing: Tables["computing"];
  private ensureChecked: Tables["ensureChecked"];
  private scopes: Tables["quoteScopes"];
  private frees: Tables["quoteFrees"];
  private quotedSpans: Tables["quotedSpans"];
  private typing: Tables["typing"];
  private files: Tables["files"];
  private asserts: Tables["asserts"];
  private clocks: Tables["clocks"];
  private integerCalls: Tables["integerCalls"];
  private arenas: Tables["arenas"];
  private calledAt(f: Frame, e: Expr) {
    return this.arenas.instanceOf(f.instance.calls.get(e));
  }
  private steps = 0;
  private depth = 0;

  // A block's statements; the checker lets no `return`, `break` or `continue` leave it.
  block(this: Mut<this>, f: Frame, body: Stmt[]): Value {
    this.statements(f, body);
    return undefined;
  }

  // A const's value, computed once; one that reads itself never ends, so it is refused.
  constant(this: Mut<this>, c: Instance, at: Span): Value {
    if (this.constants.has(c.id)) return this.constants.get(c.id);
    if (this.computing.has(c.id)) throw new Stop(`'${constName(c)}' needs its own value to compute its value${this.cycle([...this.computing].slice([...this.computing].indexOf(c.id)).map((i) => this.arenas.instanceOf(i)))}`, at, false);
    this.computing.add(c.id);
    try {
      const v = this.call(c, [], undefined, at);
      this.constants.set(c.id, v);
      return v;
    } finally {
      this.computing.delete(c.id);
    }
  }

  // How consts reading each other in a ring do it, naming their files when they are in several.
  private cycle(ring: Instance[]): string {
    if (ring.length < 2) return "";
    const ringFiles = new Set(ring.map((c) => fileAt(this.files, bodyOf(c).start)));
    const named = [...ring, ring[0]!].map((c) => `'${constName(c)}'${ringFiles.size > 1 ? ` in '${fileAt(this.files, bodyOf(c).start)}'` : ""}`);
    return `: ${named[0]} reads ${named.slice(1).join(", which reads ")}`;
  }

  private step(this: Mut<this>, at: Span) {
    if (++this.steps > STEPS) throw new Stop(`this comptime code took more than ${STEPS.toLocaleString("en-US")} steps; is there a loop that never ends?`, at, false);
  }

  // Code that reaches outside the program, or waits, which comptime never runs.
  private refuse(what: string, at: Span): never {
    throw new Stop(`${what} can't run while compiling: comptime code only computes values`, at, false);
  }

  // A source of randomness, whose one value comptime would bake into every run.
  private random(what: string, at: Span): never {
    throw new Stop(`${what} can't run while compiling; its value would be fixed into the program`, at, false);
  }

  // Pure code the interpreter doesn't run yet.
  private unsupported(what: string, at: Span): never {
    throw new Stop(`${what} isn't supported in comptime code yet`, at, false);
  }

  private panic(message: string, at: Span): never {
    throw new Stop(message, at, true);
  }

  private typeOf(f: Frame, e: Expr): Type {
    return f.instance.coercions.get(e) ?? f.instance.types.get(e)!;
  }

  // Calls a function, a `Mut` parameter given the place its argument names.
  // Instances of a class with an `equals` compare through it, as they do at run time.
  private byEquals(this: Mut<this>, at: Span): Equals {
    return (a, b) => {
      const method = this.typing.rec(a.type).kind === "class" ? this.arenas.instanceOf(this.equalities.get(a.type as ClassType)) : undefined;
      return method && this.call(method, [b], a, at) === true;
    };
  }

  call(this: Mut<this>, callee: Instance, args: Value[], self: Record | undefined, at: Span): Value {
    if (++this.depth > DEPTH) throw new Stop(`this comptime code nests calls more than ${DEPTH} deep; is there a recursion that never ends?`, at, false);
    try {
      if (RANDOM.has(bodyOf(callee).name) && fileAt(this.files, bodyOf(callee).start) === "node:crypto") this.random(`'crypto.${bodyOf(callee).name}'`, at);
      if (bodyOf(callee).async) this.refuse("an async function", at);
      if (bodyOf(callee).generator) this.unsupported("a generator", at);
      if (bodyOf(callee).foreign) this.refuse(`the ${bodyOf(callee).rust ? "Rust" : "C"} function '${bodyOf(callee).name}'`, at);
      if (bodyOf(callee).js) this.refuse(`'${bodyOf(callee).name}' from the package '${bodyOf(callee).js!.module}'`, at);
      if (!this.ensureChecked(callee.id)) throw new Stop(`this comptime code calls '${bodyOf(callee).name}', which is still being checked, so it can't run yet; compute the value without it`, at, false);
      const frame: Frame = { instance: callee, locals: new Map(), self };
      bodyOf(callee).params.forEach((p, i) => frame.locals.set(callee.locals.get(p)!, args[i] ?? null));
      this.statements(frame, bodyOf(callee).body ?? []);
      return undefined;
    } catch (e) {
      if (e instanceof Return) return e.value;
      throw e;
    } finally {
      this.depth--;
    }
  }

  // The arguments of a call: a `Mut` parameter takes its argument's place, the rest values.
  private args(this: Mut<this>, f: Frame, callee: Instance, list: Expr[]): Value[] {
    return list.map((a) => this.expr(f, a));
  }

  private statements(this: Mut<this>, f: Frame, list: Stmt[]) {
    for (const s of list) this.statement(f, s);
  }

  private statement(this: Mut<this>, f: Frame, s: Stmt) {
    this.step(s);
    switch (s.kind) {
      case "expr":
        this.expr(f, s.expr);
        return;
      case "let": {
        // The checker gives a declaration one name, its local keyed by the statement.
        const local = f.instance.locals.get(s);
        const d = s.declarations[0]!;
        if (!local || s.declarations.length !== 1) return this.unsupported("destructuring", s);
        f.locals.set(local, d.init ? this.expr(f, d.init) : undefined);
        return;
      }
      case "return":
        throw new Return(s.value ? this.expr(f, s.value) : undefined);
      case "if":
        if (unwrap(this.expr(f, s.cond))) this.statements(f, s.then);
        else if (s.else) this.statements(f, s.else);
        return;
      case "block":
      case "comptime":
        this.statements(f, s.body);
        return;
      case "unsafe":
        return this.refuse("'unsafe' code", s);
      case "while":
        while (unwrap(this.expr(f, s.cond))) if (!this.loopBody(f, s, s.body)) break;
        return;
      case "doWhile":
        do if (!this.loopBody(f, s, s.body)) break; while (unwrap(this.expr(f, s.cond)));
        return;
      case "for":
        if (s.init) this.statement(f, s.init);
        while (!s.test || unwrap(this.expr(f, s.test))) {
          this.step(s);
          if (!this.loopBody(f, s, s.body)) break;
          if (s.update) this.expr(f, s.update);
        }
        return;
      case "forOf": {
        const over = unwrap(this.expr(f, s.right));
        const local = f.instance.locals.get(s.left as Stmt)!;
        const items = typeof over === "string" ? [...over] : over && typeof over === "object" && over.kind === "array" ? over.items : this.unsupported("looping over this", s.right);
        for (const item of [...items]) {
          f.locals.set(local, item);
          if (!this.loopBody(f, s, s.body)) break;
        }
        return;
      }
      case "switch": {
        const v = this.expr(f, s.discriminant);
        const subject = f.instance.types.get(s.discriminant);
        let at = s.cases.findIndex((c) => c.test !== undefined && equal(this.typing, v, subject, this.expr(f, c.test), f.instance.types.get(c.test)));
        if (at < 0) at = s.cases.findIndex((c) => c.test === undefined);
        if (at < 0) return;
        try {
          for (const c of s.cases.slice(at)) this.statements(f, c.body);
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
          this.statement(f, s.body);
        } catch (e) {
          if (!(e instanceof Jump) || e.target !== s) throw e;
        }
        return;
      case "throw":
        throw new Thrown(this.expr(f, s.value), s);
      case "try":
        return this.attempt(f, s);
      case "empty":
        return;
      default:
        return this.unsupported(`a '${s.kind}' statement`, s);
    }
  }

  // A `try`: its catch takes a thrown error; its `finally` runs however the block is left, but
  // not for a panic, which skips both, as it does at run time.
  private attempt(this: Mut<this>, f: Frame, s: Extract<Stmt, { kind: "try" }>) {
    let left: unknown;
    let leaving = false;
    try {
      this.statements(f, s.block);
    } catch (e) {
      if (e instanceof Thrown && s.handler) {
        const local = s.param ? f.instance.locals.get(s) : undefined;
        if (local) f.locals.set(local, e.value);
        try {
          this.statements(f, s.handler);
        } catch (again) {
          [left, leaving] = [again, true];
        }
      } else [left, leaving] = [e, true];
    }
    if (leaving && (left instanceof Stop || !(left instanceof Return || left instanceof Jump || left instanceof Thrown))) throw left;
    if (s.finalizer) this.statements(f, s.finalizer);
    if (leaving) throw left;
  }

  // Runs a loop's body once: false when a `break` leaves the loop.
  private loopBody(this: Mut<this>, f: Frame, loop: Stmt, body: Stmt[]): boolean {
    try {
      this.statements(f, body);
      return true;
    } catch (e) {
      if (e instanceof Jump && e.target === loop) return e.again;
      throw e;
    }
  }

  expr(this: Mut<this>, f: Frame, e: Expr): Value {
    const v = this.link(f, e);
    return isShort(v) ? this.typed(f, e, null) : v;
  }

  // An expression's value; a member or call in an optional chain that met an empty Option
  // gives SHORT, which ends the chain as an empty Option.
  private link(this: Mut<this>, f: Frame, e: Expr): Value | typeof SHORT {
    this.step(e);
    // A place lent to a `Mut`: the place itself, which reads and writes go through.
    const [own, target] = [f.instance.types.get(e), f.instance.coercions.get(e) ?? f.instance.types.get(e)];
    // A fixed array copies where an array shares, which comptime values don't follow yet.
    const held = deref(this.typing, own);
    if (held !== undefined && typeof held !== "string" && this.typing.rec(held).kind === "fixed") this.unsupported("a FixedArray", e);
    if (mutable(this.typing, target) && !mutable(this.typing, own) && (e.kind === "ident" || e.kind === "member" || e.kind === "index" || e.kind === "this")) return this.place(f, e);
    const v = this.raw(f, e);
    return isShort(v) ? v : this.typed(f, e, v);
  }

  // A value as the type it meets: a `Mut` stays a place, anything else reads through one; a float
  // where a literal meets one; a union's value tagged with the member its type says, in fields and
  // elements too; a member out of its union where a check narrowed it.
  private typed(f: Frame, e: Expr, value: Value): Value {
    const own = f.instance.types.get(e);
    const target = f.instance.coercions.get(e) ?? own;
    if (isPlace(value) && mutable(this.typing, target)) return value;
    const v = isPlace(value) ? value.get() : value;
    const to = deref(this.typing, target);
    if (typeof v === "bigint" && to !== undefined && isFloat(to)) return fit(Number(v), to);
    return retag(this.typing, v, deref(this.typing, own), to);
  }

  private raw(this: Mut<this>, f: Frame, e: Expr): Value | typeof SHORT {
    const type = f.instance.types.get(e)!;
    switch (e.kind) {
      case "int":
        return isFloat(type) ? fit(Number(e.value), type) : BigInt(e.value);
      case "float":
        return fit(e.value, type as "f32" | "f64");
      case "bigint":
        return e.value;
      // A regex is its compiled program, which comptime only hands on; its flags and pattern
      // stand for it, as \`flags/pattern\`.
      case "regex":
        return `${e.flags}/${e.pattern}`;
      case "bool":
        return e.value;
      case "string":
        return e.value;
      case "null":
        return null;
      // A quote's value: its tree as records of the Ast types, each splice its hole's value.
      case "tagged": {
        const types = this.quotes.get(e);
        if (!types) return this.unsupported("this tagged template", e);
        const q = quoted(this.tables, e, e.tag.kind === "ident" && e.tag.name === "quoteType");
        const holes = q.holes.map((x) => ({ value: this.expr(f, x), type: f.instance.types.get(x) }));
        // A quote spliced in shares its bindings with this one, and a name it leaves free means
        // this one's binding of it; what this one leaves free, a quote around it may bind.
        const scope = new Map(holes.flatMap((h) => [...(this.scopes.get(untagged(h.value) as object) ?? [])]));
        const free: Free = new Map();
        const splice = (i: usize, into: Type) => {
          const v = holes[i]!.value;
          const inner = this.frees.get(untagged(v) as object);
          if (inner) {
            for (const [name, spelling] of inner) {
              const to = scope.get(name);
              if (to) renameQuoted(this.tables, v, spelling, to);
              else free.set(name, spelling);
            }
          }
          return retag(this.typing, v, holes[i]!.type, into);
        };
        const made = built<Value>(this.tables, q, types, e, astValues(splice, holes.map((h) => h.value), e), scope, free);
        if (made && typeof made === "object") {
          this.scopes.set(untagged(made) as object, scope);
          this.frees.set(untagged(made) as object, free);
          this.quotedSpans.set(untagged(made) as object, new Set([...holes.flatMap((h) => [...(this.quotedSpans.get(untagged(h.value) as object) ?? [])]), `${e.start}:${e.end}`]));
        }
        return made;
      }
      case "template": {
        let text = e.quasis[0] ?? "";
        e.exprs.forEach((x, i) => {
          text = this.joined(text, display(this.expr(f, x), this.typeOf(f, x)) + (e.quasis[i + 1] ?? ""), e);
        });
        return text;
      }
      case "ident": {
        const literal = literalValue(this.typing, type);
        if (literal !== undefined && !f.instance.locals.has(e)) return literal;
        const read = this.calledAt(f, e);
        if (read && bodyOf(read).comptime === "const") return this.constant(read, e);
        const local = f.instance.locals.get(e);
        if (!local && e.name === "undefined") return null;
        if (!local || !f.locals.has(local)) throw new Stop(`'${e.name}' is only known when the program runs, so comptime code can't read it`, e, false);
        return f.locals.get(local);
      }
      case "this":
        return f.self ?? this.unsupported("'this'", e);
      case "comptime":
        return this.expr(f, e.expr);
      case "conditional":
        return unwrap(this.expr(f, e.cond)) ? this.expr(f, e.then) : this.expr(f, e.else);
      case "unary":
        return this.unary(f, e);
      case "binary":
        return this.binary(f, e);
      case "assign":
        return this.assign(f, e);
      case "update": {
        const at = this.place(f, e.operand);
        const old = unwrap(at.get()) as bigint | f64;
        const one = typeof old === "bigint" ? 1n : 1;
        const next = this.numeric(e.op === "++" ? "+" : "-", old, one, this.typeOf(f, e.operand), e);
        at.set(next);
        return e.prefix ? next : old;
      }
      case "as":
        return this.convert(unwrap(this.expr(f, e.expr)), type, e);
      case "satisfies":
        return this.expr(f, e.expr);
      case "nonNull": {
        // An overload's body narrows the implementation's value to the signature's return type.
        if (e.narrows) {
          const [from, to] = [f.instance.types.get(e.expr), type];
          const held = this.expr(f, e.expr);
          if (from === to) return held;
          const r = typeof to === "string" ? undefined : this.typing.rec(to);
          const kept = r?.kind === "union" ? r.members : [to];
          if (!kept.includes(memberType(this.typing, held, from)!)) this.panic("the implementation returned a value this overload signature doesn't declare", e);
          return retag(this.typing, held, from, to);
        }
        if (redundantBang(e)) return this.expr(f, e.expr);
        const v = unwrap(this.expr(f, e.expr));
        if (v === null) this.panic("called `Option::unwrap()` on a `None` value", e);
        return v;
      }
      case "object": {
        const fields = new Map<string, Value>();
        for (const p of e.props) {
          if (p.kind === "property" && typeof p.key === "string") fields.set(p.key, this.expr(f, p.value));
          else if (p.kind === "shorthand") {
            const local = f.instance.locals.get(p)!;
            if (!f.locals.has(local)) throw new Stop(`'${p.name}' is only known when the program runs, so comptime code can't read it`, p, false);
            const held = f.locals.get(local);
            fields.set(p.name, held);
          } else return this.unsupported("this property", p);
        }
        return { kind: "record", type: type as ObjectType, fields };
      }
      case "array":
        return { kind: "array", items: e.elements.map((x) => (x ? this.expr(f, x) : this.unsupported("a hole in an array", e))) };
      case "new":
        return this.construct(f, e, type);
      case "member":
        return this.member(f, e, type);
      case "index": {
        const object = this.link(f, e.object);
        if (isShort(object)) return SHORT;
        return this.place(f, e, object).get();
      }
      case "call":
        return this.callExpr(f, e, type);
      case "match":
        return this.match(f, e);
      case "throw":
        throw new Thrown(this.expr(f, e.value), e);
      case "pipe":
        return this.unsupported("'|>'", e);
      default:
        return this.unsupported(`a '${e.kind}' expression`, e);
    }
  }

  private construct(this: Mut<this>, f: Frame, e: Extract<Expr, { kind: "new" }>, type: Type): Value {
    const r = typeof type === "string" ? undefined : this.typing.rec(type);
    if (r?.kind === "interior" && r.which !== "Cell" && e.args?.length === 1) return { kind: "interior", value: this.expr(f, e.args[0]!) };
    if (r?.kind !== "class") return this.refuse(`'new ${this.typing.show(type)}'`, e);
    const ctor = this.calledAt(f, e)!;
    const made: Record = { kind: "record", type: type as ClassType, fields: new Map() };
    this.call(ctor, this.args(f, ctor, e.args ?? []), made, e);
    return made;
  }

  private member(this: Mut<this>, f: Frame, e: Extract<Expr, { kind: "member" }>, type: Type): Value | typeof SHORT {
    // An enum's member, as `Color.Red`, is known from its type alone.
    const literal = literalValue(this.typing, type);
    if (literal !== undefined) return literal;
    const r = typeof type === "string" ? undefined : this.typing.rec(type);
    if (r?.kind === "variant" && r.fields.length === 0 && enumName(e.object)) return { kind: "variant", type: type as VariantType, args: [] };
    const linked = this.link(f, e.object);
    if (isShort(linked)) return SHORT;
    const object = unwrap(linked);
    if (object === null && e.optional) return SHORT;
    const getter = this.calledAt(f, e);
    if (getter) return this.call(getter, [], object as Record, e);
    if (e.name === "length" && typeof object === "string") return BigInt(object.length);
    if (object && typeof object === "object" && object.kind === "array" && e.name === "length") return BigInt(object.items.length);
    if (object && typeof object === "object" && object.kind === "record" && this.typing.isTuple(object.type) && e.name === "length") return this.tupleLength(object);
    if (object && typeof object === "object" && object.kind === "record") return object.fields.get(e.name);
    return this.unsupported(`reading '${e.name}' here`, e);
  }

  // A tuple's length, as at run time: its required elements, up to the last optional one there,
  // then its rest.
  private tupleLength(t: Record): bigint {
    const type = t.type as ObjectType;
    const count = this.typing.elementsOf(type).length;
    let length = this.typing.rec(type).required ?? count;
    for (let i = length; i < count; i++) if (unwrap(t.fields.get(String(i))!) !== null) length = i + 1;
    const rest = t.fields.get("...");
    return BigInt(length + (rest && typeof rest === "object" && rest.kind === "array" ? rest.items.length : 0));
  }

  private callExpr(this: Mut<this>, f: Frame, e: Extract<Expr, { kind: "call" }>, type: Type): Value | typeof SHORT {
    const callee = e.callee;
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "console") this.refuse("printing", e);
    if (this.clocks.get(e) === "Math.random") this.random("'Math.random'", e);
    // A data-carrying enum's member, as `Shape.Circle(2)`.
    const r = type === undefined || typeof type === "string" ? undefined : this.typing.rec(type);
    if (r?.kind === "variant" && callee.kind === "member" && enumName(callee.object)) {
      return { kind: "variant", type: type as VariantType, args: e.args.map((a) => this.expr(f, a)) };
    }
    if (this.asserts.has(e)) {
      if (this.expr(f, e.args[0]!) === true) return undefined;
      throw new Assertion(e.args[1] ? String(unwrap(this.expr(f, e.args[1]))) : `assertion failed: ${this.asserts.get(e)}`, e, true);
    }
    const target = this.calledAt(f, e);
    if (target && (callee.kind === "super" || (callee.kind === "member" && callee.object.kind === "super"))) return this.call(target, this.args(f, target, e.args), f.self, e);
    if (target && callee.kind === "member" && bodyOf(target).self) {
      const linked = this.link(f, callee.object);
      if (isShort(linked)) return SHORT;
      const object = unwrap(linked);
      if (object === null && (callee.optional || e.optional)) return SHORT;
      return this.call(target, this.args(f, target, e.args), object as Record, e);
    }
    if (target) return this.call(target, this.args(f, target, e.args), undefined, e);
    if (callee.kind === "ident" && callee.name === "String" && e.args.length === 1) return display(this.expr(f, e.args[0]!), this.typeOf(f, e.args[0]!));
    // `String.fromCharCode` and `String.fromCodePoint`, their arguments gathered into one array.
    const built = this.stringBuilds.get(e);
    if (built) {
      const items = (unwrap(this.expr(f, e.args[0]!)) as { items: Value[] }).items.map((x) => Number(unwrap(x) as bigint));
      if (built === "units") return String.fromCharCode(...items);
      const bad = items.find((x) => x > 0x10ffff);
      if (bad !== undefined) this.panic(`invalid code point ${bad}`, e);
      return String.fromCodePoint(...items);
    }
    // A static call on something that isn't a value, like `TcpListener.bind`, is std's own.
    if (callee.kind === "member" && !f.instance.types.has(callee.object)) return this.refuse(`'${callee.name}'`, e);
    if (callee.kind === "member") {
      const linked = this.link(f, callee.object);
      if (isShort(linked)) return SHORT;
      const held = unwrap(linked);
      if (held === null && (callee.optional || e.optional)) return SHORT;
      if (this.integerCalls.has(e)) return this.integerValue(callee.name, held as bigint, e.args[0] ? (unwrap(this.expr(f, e.args[0])) as bigint) : 0n, this.typing.lower(this.typeOf(f, callee.object)) as Integer, type, e);
      if (typeof held === "string") return this.stringMethod(callee.name, held, e.args.map((a) => unwrap(this.expr(f, a))), e);
      if (callee.name === "clone") return cloned(this.tables, held);
      if (held && typeof held === "object" && held.kind === "array") {
        if (callee.name === "push") return void held.items.push(this.expr(f, e.args[0]!));
        if (callee.name === "pop") return held.items.length > 0 ? held.items.pop()! : null;
      }
      return this.unsupported(`calling '${callee.name}' here`, e);
    }
    return this.refuse(`'${this.timerNames.get(e) ?? (callee.kind === "ident" ? callee.name : "this call")}'`, e);
  }

  private stringMethod(name: string, s: string, args: Value[], at: Span): Value {
    const n = (i: usize) => Number(args[i] as bigint);
    switch (name) {
      case "charCodeAt": {
        const i = args[0] as bigint;
        if (i < 0n || i >= BigInt(s.length)) this.panic(`index out of bounds: the len is ${s.length} but the index is ${i}`, at);
        return BigInt(s.charCodeAt(Number(i)));
      }
      case "indexOf":
        return BigInt(s.indexOf(args[0] as string, args.length > 1 ? n(1) : undefined));
      case "replaceAll":
        return s.replaceAll(args[0] as string, args[1] as string);
      case "concat":
        return s.concat(...(args as string[]));
      case "lastIndexOf":
        return BigInt(s.lastIndexOf(args[0] as string, args.length > 1 ? n(1) : undefined));
      case "at":
        return s.at(n(0)) ?? null;
      case "charAt":
        return s.charAt(n(0));
      case "codePointAt": {
        const point = s.codePointAt(n(0));
        return point === undefined ? null : BigInt(point);
      }
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
        return this.joined("", s.padStart(Math.min(n(0), LONGEST + 1), args.length > 1 ? (args[1] as string) : undefined), at);
      case "padEnd":
        return this.joined("", s.padEnd(Math.min(n(0), LONGEST + 1), args.length > 1 ? (args[1] as string) : undefined), at);
      case "repeat":
        if ((args[0] as bigint) < 0n) this.panic("Invalid count value: " + String(args[0]), at);
        if (BigInt(s.length) * (args[0] as bigint) > BigInt(LONGEST)) this.tooLong(at);
        return s.repeat(n(0));
      case "slice":
        return s.slice(n(0), args.length > 1 ? n(1) : undefined);
      case "substring":
        return s.substring(n(0), args.length > 1 ? n(1) : undefined);
      default:
        return this.unsupported(`the string method '${name}'`, at);
    }
  }

  private tooLong(at: Span): never {
    throw new Stop(`this comptime code made a string longer than ${LONGEST.toLocaleString("en-US")} characters`, at, false);
  }

  // Two strings joined, within the longest string comptime makes.
  private joined(a: string, b: string, at: Span): string {
    if (a.length + b.length > LONGEST) this.tooLong(at);
    return a + b;
  }

  private unary(this: Mut<this>, f: Frame, e: Extract<Expr, { kind: "unary" }>): Value {
    if (e.op === "await") this.refuse("'await'", e);
    const held = this.expr(f, e.operand);
    const v = unwrap(held);
    const type = this.typeOf(f, e);
    if (e.op === "!") return !v;
    if (e.op === "typeof") {
      const from = this.typeOf(f, e.operand);
      const r = typeof from === "string" ? undefined : this.typing.rec(from);
      const member = r?.kind === "union" ? memberOf(this.typing, held, from as UnionType) : from;
      return member === "bigint" ? "bigint" : typeofValue(v);
    }
    if (type === "bigint") return e.op === "-" ? -(v as bigint) : e.op === "~" ? ~(v as bigint) : this.unsupported(`'${e.op}'`, e);
    if (e.op === "-") return typeof v === "number" ? fit(-v, type as "f32" | "f64") : this.checked(-(v as bigint), type as Integer, "negate", e);
    if (e.op === "~") return wrap(~(v as bigint), type as Integer);
    return this.unsupported(`'${e.op}'`, e);
  }

  private binary(this: Mut<this>, f: Frame, e: Extract<Expr, { kind: "binary" }>): Value {
    if (e.op === "&&") return unwrap(this.expr(f, e.left)) ? this.expr(f, e.right) : false;
    if (e.op === "||") return unwrap(this.expr(f, e.left)) ? true : this.expr(f, e.right);
    if (e.op === "??") {
      const v = this.expr(f, e.left);
      return unwrap(v) === null ? this.expr(f, e.right) : v;
    }
    if (e.op === "instanceof") {
      const v = unwrap(this.expr(f, e.left));
      return v !== null && typeof v === "object" && v.kind === "record" && this.typing.isSubclass(v.type, f.instance.types.get(e.right)!);
    }
    const [a, b] = [this.expr(f, e.left), this.expr(f, e.right)];
    switch (e.op) {
      case "===":
        return equal(this.typing, a, f.instance.types.get(e.left), b, f.instance.types.get(e.right), this.byEquals(e));
      case "!==":
        return !equal(this.typing, a, f.instance.types.get(e.left), b, f.instance.types.get(e.right), this.byEquals(e));
      case "<":
        return (unwrap(a) as f64) < (unwrap(b) as f64);
      case "<=":
        return (unwrap(a) as f64) <= (unwrap(b) as f64);
      case ">":
        return (unwrap(a) as f64) > (unwrap(b) as f64);
      case ">=":
        return (unwrap(a) as f64) >= (unwrap(b) as f64);
    }
    const [x, y] = [unwrap(a), unwrap(b)];
    if (e.op === "+" && (typeof x === "string" || typeof y === "string")) return this.joined(display(x, this.typeOf(f, e.left)), display(y, this.typeOf(f, e.right)), e);
    return this.numeric(e.op, x as bigint | f64, y as bigint | f64, this.typeOf(f, e), e);
  }

  // The place is found first, then the value; a compound assignment reads the place once.
  private assign(this: Mut<this>, f: Frame, e: Extract<Expr, { kind: "assign" }>): Value {
    const at = this.place(f, e.target);
    if (e.op === "=") {
      const v = this.expr(f, e.value);
      at.set(v);
      return v;
    }
    const op = e.op.slice(0, -1);
    const old = at.get();
    if (op === "&&" || op === "||" || op === "??") {
      const keep = op === "&&" ? !unwrap(old) : op === "||" ? !!unwrap(old) : unwrap(old) !== null;
      if (keep) return old;
      const v = this.expr(f, e.value);
      at.set(v);
      return v;
    }
    const [x, y] = [unwrap(old), unwrap(this.expr(f, e.value))];
    const v = op === "+" && typeof x === "string" ? this.joined(x, display(y, this.typeOf(f, e.value)), e) : this.numeric(op, x as bigint | f64, y as bigint | f64, this.typeOf(f, e.target), e);
    at.set(v);
    return v;
  }

  // Where an expression's value lives: a variable, a `Mut` parameter's place, an object's field,
  // or an array's element, its index read once.
  private place(this: Mut<this>, f: Frame, target: Expr, object?: Value): Place {
    if (target.kind === "nonNull" && redundantBang(target)) return this.place(f, target.expr, object);
    if (target.kind === "this") return { kind: "place", get: () => f.self, set: () => this.unsupported("replacing 'this'", target) };
    if (target.kind === "ident") {
      const local = f.instance.locals.get(target);
      if (!local || !f.locals.has(local)) throw new Stop(`'${target.name}' is only known when the program runs, so comptime code can't use it here`, target, false);
      const held = f.locals.get(local);
      if (isPlace(held)) return held;
      return { kind: "place", get: () => f.locals.get(local) as Value, set: (v) => void f.locals.set(local, v) };
    }
    if (target.kind === "member" && f.instance.setters.has(target)) {
      const self = unwrap(this.expr(f, target.object)) as Record;
      const getter = this.calledAt(f, target);
      return { kind: "place", get: () => (getter ? this.call(getter, [], self, target) : self.fields.get(target.name)), set: (v) => void this.call(this.arenas.instanceOf(f.instance.setters.get(target)!), [v], self, target) };
    }
    if (target.kind === "member") {
      const holder = unwrap(this.expr(f, target.object));
      if (holder && typeof holder === "object" && holder.kind === "record") {
        const held = holder.fields.get(target.name);
        if (isPlace(held)) return held;
        return { kind: "place", get: () => holder.fields.get(target.name), set: (v) => void holder.fields.set(target.name, v) };
      }
    }
    if (target.kind === "index") {
      const held = unwrap(object ?? this.expr(f, target.object));
      const i = unwrap(this.expr(f, target.index)) as bigint;
      const length = typeof held === "string" ? held.length : held && typeof held === "object" && held.kind === "array" ? held.items.length : this.unsupported("indexing this", target);
      // A rest tuple's array is named as the tuple, its fixed elements counted in.
      const before = BigInt(this.restStarts.get(target.object) ?? 0);
      const inside = () => {
        if (i < 0n || i >= BigInt(length)) this.panic(`index out of bounds: the len is ${BigInt(length) + before} but the index is ${i + before}`, target);
      };
      // The bounds are checked where the place is taken, as a borrow of an element checks them.
      inside();
      if (typeof held === "string") return { kind: "place", get: () => (inside(), held[Number(i)]), set: () => this.unsupported("changing a string's character", target) };
      const array = held as Items;
      return { kind: "place", get: () => (inside(), array.items[Number(i)]), set: (v) => (inside(), void (array.items[Number(i)] = v)) };
    }
    return this.unsupported("changing this", target);
  }

  private match(this: Mut<this>, f: Frame, e: Extract<Expr, { kind: "match" }>): Value {
    const subject = this.expr(f, e.subject);
    for (const arm of e.arms) {
      if (!this.tests(f, arm.pattern, subject)) continue;
      this.bind(f, arm.pattern, subject);
      if (arm.guard && !unwrap(this.expr(f, arm.guard))) continue;
      if (arm.body.kind !== "block") return this.expr(f, arm.body);
      // A block arm gives its value by `return`, which never leaves the function.
      try {
        this.statements(f, arm.body.body);
        return undefined;
      } catch (r) {
        if (r instanceof Return) return r.value;
        throw r;
      }
    }
    return this.unsupported("this match", e);
  }

  private tests(this: Mut<this>, f: Frame, p: Pattern, value: Value): boolean {
    const info = f.instance.patterns.get(p)!;
    const tag = value && typeof value === "object" && value.kind === "member" ? value.type : undefined;
    const v = unwrap(value);
    const r = typeof info.type === "string" ? undefined : this.typing.rec(info.type);
    const union = r?.kind === "union" ? r : undefined;
    switch (info.kind) {
      case "any":
        return true;
      case "literal":
        return info.member ? same(this.typing, v, literalValue(this.typing, info.member) ?? this.typing.rec(info.member).value) : same(this.typing, v, this.expr(f, (p as Extract<Pattern, { kind: "literal" }>).value));
      case "none":
        return v === null;
      case "some":
        return v !== null && this.tests(f, info.arg, v);
      case "variant": {
        const held = v as Variant;
        if (union && held.type !== info.variant) return false;
        return info.args.every((arg, i) => this.tests(f, arg, held.args[i]));
      }
      case "object": {
        const held = v as Record;
        if (union && !info.shapes.includes(tag ?? held.type)) return false;
        return info.fields.every(([key, sub]) => this.tests(f, sub, held.fields.get(key)));
      }
      case "array": {
        const held = v as Items;
        return held.items.length === info.items.length && info.items.every((item, i) => this.tests(f, item, held.items[i]));
      }
      case "or":
        return info.alternatives.some((alt) => this.tests(f, alt, value));
    }
  }

  private bind(f: Frame, p: Pattern, value: Value) {
    const info = f.instance.patterns.get(p)!;
    const v = unwrap(value);
    if (info.kind === "any" && p.kind === "ident") return void f.locals.set(f.instance.locals.get(p as Expr)!, value);
    if (info.kind === "variant") info.args.forEach((arg, i) => this.bind(f, arg, (v as Variant).args[i]));
    if (info.kind === "object") for (const [key, sub] of info.fields) this.bind(f, sub, (v as Record).fields.get(key));
    if (info.kind === "array") info.items.forEach((item, i) => this.bind(f, item, (v as Items).items[i]));
    if (info.kind === "some") this.bind(f, info.arg, v);
  }

  // An arithmetic or bitwise operator on numbers of `type`, panicking where the program would.
  // A bigint's operators as JavaScript has them, panicking where it throws a RangeError.
  private bigNumeric(op: string, a: bigint, b: bigint, at: Span): Value {
    if ((op === "/" || op === "%") && b === 0n) this.panic("Division by zero", at);
    if (op === "**" && b < 0n) this.panic("Exponent must be non-negative", at);
    switch (op) {
      case "+": return a + b;
      case "-": return a - b;
      case "*": return a * b;
      case "/": return a / b;
      case "%": return a % b;
      case "**": return a ** b;
      case "&": return a & b;
      case "|": return a | b;
      case "^": return a ^ b;
      case "<<": return a << b;
      case ">>": return a >> b;
    }
    return this.unsupported(`'${op}' on 'bigint'`, at);
  }

  private numeric(this: Mut<this>, op: string, a: bigint | f64, b: bigint | f64, type: Type, at: Span): Value {
    if (typeof a === "number" || typeof b === "number") {
      const [x, y] = [Number(a), Number(b)];
      const v = op === "+" ? x + y : op === "-" ? x - y : op === "*" ? x * y : op === "/" ? x / y : op === "%" ? x % y : op === "**" ? x ** y : undefined;
      if (v === undefined) return this.unsupported(`'${op}' on floats`, at);
      return fit(v, type as "f32" | "f64");
    }
    if (type === "bigint") return this.bigNumeric(op, a as bigint, b as bigint, at);
    if (!isInteger(type)) return this.unsupported(`'${op}' on '${this.typing.show(type)}'`, at);
    const { bits, signed } = INTEGERS[type];
    switch (op) {
      case "+":
        return this.checked(a + b, type, "add", at);
      case "-":
        return this.checked(a - b, type, "subtract", at);
      case "*":
        return this.checked(a * b, type, "multiply", at);
      case "/":
      case "%": {
        const remainder = op === "%";
        if (b === 0n) this.panic(remainder ? "attempt to calculate the remainder with a divisor of zero" : "attempt to divide by zero", at);
        if (signed && b === -1n && a === -(1n << BigInt(bits - 1))) this.panic(`attempt to ${remainder ? "calculate the remainder" : "divide"} with overflow`, at);
        return remainder ? a % b : a / b;
      }
      // By squaring, as the program does: the base squares only while bits of the exponent remain.
      case "**": {
        let [result, base, exponent] = [1n, a, b];
        while (exponent > 0n) {
          this.step(at);
          if (exponent & 1n) result = this.checked(result * base, type, "multiply", at);
          exponent >>= 1n;
          if (exponent > 0n) base = this.checked(base * base, type, "multiply", at);
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
        if (amount > BigInt(bits - 1)) this.panic(`attempt to shift ${op === "<<" ? "left" : "right"} with overflow`, at);
        if (op === "<<") return wrap(a << amount, type);
        return op === ">>" && signed ? a >> amount : wrap(BigInt.asUintN(bits, a) >> amount, type);
      }
    }
    return this.unsupported(`'${op}'`, at);
  }

  // `x.checkedAdd(y)` and its kin, as the program computes them: the exact result, then null,
  // the wrapped value, the nearest bound, or the wrapped value and whether it overflowed.
  private integerValue(this: Mut<this>, name: string, a: bigint, b: bigint, type: Integer, result: Type, at: Span): Value {
    const [family, operation] = integerMethod(name)!;
    const { bits, signed } = INTEGERS[type];
    const [min, max] = range(type);
    let exact: bigint;
    let over: boolean | undefined;
    switch (operation) {
      case "Add":
        exact = a + b;
        break;
      case "Sub":
        exact = a - b;
        break;
      case "Mul":
        exact = a * b;
        break;
      case "Neg":
        exact = -a;
        break;
      case "Div":
      case "Rem": {
        if (b === 0n && family === "checked") return null;
        if (b === 0n) this.panic(operation === "Div" ? "attempt to divide by zero" : "attempt to calculate the remainder with a divisor of zero", at);
        // MIN % -1 is 0, which fits, but Rust counts it as overflowing with MIN / -1.
        over = signed && a === min && b === -1n;
        exact = operation === "Div" ? a / b : a % b;
        break;
      }
      case "Shl":
      case "Shr": {
        const amount = b & BigInt(bits - 1);
        exact = operation === "Shl" ? wrap(a << amount, type) : a >> amount;
        over = b >= BigInt(bits);
        break;
      }
      default: {
        // By squaring, as the program does, so a power that fits never overflows on the way.
        let [power, base, exponent] = [1n, a, b];
        over = false;
        const times = (x: bigint, y: bigint) => {
          if (wrap(x * y, type) !== x * y) over = true;
          return wrap(x * y, type);
        };
        while (exponent > 0n) {
          this.step(at);
          if (exponent & 1n) power = times(power, base);
          exponent >>= 1n;
          if (exponent > 0n) base = times(base, base);
        }
        // A negative base to an odd power is past MIN.
        if (family === "saturating" && over) return a < 0n && (b & 1n) === 1n ? min : max;
        exact = power;
      }
    }
    over ??= wrap(exact, type) !== exact;
    const wrapped = wrap(exact, type);
    if (family === "checked") return over ? null : wrapped;
    if (family === "wrapping") return wrapped;
    if (family === "saturating") return !over ? wrapped : exact < min ? min : max;
    return { kind: "record", type: result as ObjectType, fields: new Map<string, Value>([["0", wrapped], ["1", over]]) };
  }

  // Comptime checks overflow in every build: a value that would wrap in a release build is a
  // compile error rather than a different number baked.
  private checked(v: bigint, type: Integer, verb: string, at: Span): bigint {
    if (wrap(v, type) !== v) this.panic(`attempt to ${verb} with overflow`, at);
    return v;
  }

  // `x as T` between numbers, as Rust's `as` converts: integers wrap, floats truncate and saturate.
  private convert(v: Value, to: Type, at: Span): Value {
    if (typeof v === "boolean") v = v ? 1n : 0n;
    if (isFloat(to)) return typeof v === "bigint" && to === "f32" ? toF32(v) : fit(Number(v), to);
    if (!isInteger(to)) return v;
    if (typeof v === "bigint") return wrap(v, to);
    if (typeof v !== "number") return this.unsupported(`converting this with 'as'`, at);
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
function deref(typing: Typing, t: Type | undefined): Type | undefined {
  if (t === undefined || typeof t === "string") return t;
  const r = typing.rec(t);
  return r.kind === "ref" ? r.to : t;
}

// A value without a union's tag, read through a `Mut`'s place.
function unwrap(v: Value): Value {
  if (isPlace(v)) return unwrap(v.get());
  return v && typeof v === "object" && v.kind === "member" ? unwrap(v.value) : v;
}

function mutable(typing: Typing, t: Type | undefined): boolean {
  if (t === undefined || typeof t === "string") return false;
  const r = typing.rec(t);
  return r.kind === "ref" && r.mutable;
}

// A value of type `from` as one of type `to`: entering a union it is tagged with the member its
// type is, and a union's fields and elements are tagged the same way, so each is baked as the
// member the program would hold.
function retag(typing: Typing, value: Value, from: Type | undefined, to: Type | undefined): Value {
  // A `Mut` held in a field stays the place it points at.
  if (isPlace(value)) return value;
  const record = (t: Type | undefined) => (t === undefined || typeof t === "string" ? undefined : typing.rec(t));
  const tr = record(to);
  if (to === undefined || from === to) return tr?.kind === "union" ? value : unwrap(value);
  if (tr?.kind === "union") {
    const tag = value && typeof value === "object" && value.kind === "member" ? value.type : undefined;
    if (tag !== undefined && tr.members.includes(tag)) return value;
    const v = unwrap(value);
    const own = tag ?? from;
    const or = record(own);
    const member = own !== undefined && tr.members.includes(own) ? own : or?.kind === "union" ? memberOf(typing, v, own as UnionType) : own !== undefined ? (typing.membersFor(own, to as UnionType)[0] ?? memberOf(typing, v, to as UnionType)) : memberOf(typing, v, to as UnionType);
    return { kind: "member", type: member, value: retag(typing, v, own, member) };
  }
  const v = unwrap(value);
  if (v && typeof v === "object" && v.kind === "record" && (tr?.kind === "object" || tr?.kind === "class")) {
    // A field the value leaves out is an optional one, which is empty.
    for (const f of tr.fields) v.fields.set(f.name, v.fields.has(f.name) ? retag(typing, v.fields.get(f.name), typing.field(v.type, f.name)?.type, f.type) : retag(typing, null, "null", f.type));
  }
  if (v && typeof v === "object" && v.kind === "array" && tr?.kind === "array") {
    const fr = record(from);
    const element = fr?.kind === "array" ? fr.element : undefined;
    v.items = v.items.map((x) => retag(typing, x, element, tr.element));
  }
  return v;
}

// Which member of its union a value is: its tag, or else the type it is written as, a literal
// standing for its base type.
function memberType(typing: Typing, v: Value, t: Type | undefined): Type | undefined {
  if (v && typeof v === "object" && v.kind === "member") return memberType(typing, v.value, v.type);
  const own = deref(typing, t);
  const r = own === undefined || typeof own === "string" ? undefined : typing.rec(own);
  if (r?.kind === "union") return memberOf(typing, v, own as UnionType);
  if (r?.kind === "literal") return typing.baseOf(own as LiteralType) ?? own;
  return own;
}

// `===` on two values of the types they are written as: a union compares its member, then the
// value it holds.
// A class instance's comparison through its `equals`, or nothing for other records.
type Equals = (a: Record, b: Record) => boolean | undefined;

function equal(typing: Typing, a: Value, ta: Type | undefined, b: Value, tb: Type | undefined, eq?: Equals): boolean {
  const [ma, mb] = [memberType(typing, a, ta), memberType(typing, b, tb)];
  // A literal stands for its base type: members of two enums that share a value are equal, as
  // they are at run time.
  const plain = (t: Type | undefined) => {
    const r = t === undefined || typeof t === "string" ? undefined : typing.rec(t);
    return r?.kind === "literal" ? (typing.baseOf(t as LiteralType) ?? t) : t;
  };
  if (ma !== undefined && mb !== undefined && plain(ma) !== plain(mb)) return false;
  return same(typing, a, b, eq);
}

// The value an enum member's literal type stands for, or undefined for any other type.
function literalValue(typing: Typing, type: Type | undefined): Value {
  const r = type === undefined || typeof type === "string" ? undefined : typing.rec(type);
  return r?.kind === "literal" && r.owner ? r.value : undefined;
}

// Whether an expression names an enum rather than a value.
function enumName(e: Expr): boolean {
  return e.kind === "ident" || (e.kind === "member" && enumName(e.object));
}

// Values compare as `===` compares them: primitives by value, variants by member and payload.
function same(typing: Typing, x: Value, y: Value, eq?: Equals): boolean {
  // Two members of a union are equal when they are the same member holding equal values.
  if (x && y && typeof x === "object" && typeof y === "object" && x.kind === "member" && y.kind === "member") {
    const plain = (t: Type) => {
      const r = typeof t === "string" ? undefined : typing.rec(t);
      return r?.kind === "literal" ? (typing.baseOf(t as LiteralType) ?? t) : t;
    };
    if (plain(x.type) !== plain(y.type)) return false;
  }
  const [a, b] = [unwrap(x), unwrap(y)];
  if (a && b && typeof a === "object" && typeof b === "object" && a.kind === "variant" && b.kind === "variant") {
    return a.type === b.type && a.args.every((v, i) => same(typing, v, b.args[i], eq));
  }
  // Objects and arrays compare part by part.
  if (a && b && typeof a === "object" && typeof b === "object" && a.kind === "record" && b.kind === "record") {
    const written = eq?.(a, b);
    if (written !== undefined) return written;
    return a.fields.size === b.fields.size && [...a.fields].every(([k, v]) => b.fields.has(k) && same(typing, v, b.fields.get(k), eq));
  }
  if (a && b && typeof a === "object" && typeof b === "object" && a.kind === "array" && b.kind === "array") {
    return a.items.length === b.items.length && a.items.every((v, i) => same(typing, v, b.items[i], eq));
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
function cloned(tables: Tables, v: Value): Value {
  const { quoteScopes: scopes, quoteFrees: frees, quotedSpans } = tables;
  const copied = (x: Value) => cloned(tables, x);
  if (!v || typeof v !== "object" || v.kind === "interior") return v;
  if (v.kind === "place") return copied(v.get());
  if (v.kind === "member") return { kind: "member", type: v.type, value: copied(v.value) };
  if (v.kind === "array") return { kind: "array", items: v.items.map(copied) };
  if (v.kind === "variant") return { kind: "variant", type: v.type, args: v.args.map(copied) };
  const copy: Record = { kind: "record", type: v.type, fields: new Map([...v.fields].map(([k, x]) => [k, copied(x)])) };
  // A clone of a quote's value keeps its bindings and free names for a quote it is spliced into.
  const scope = scopes.get(v);
  if (scope) scopes.set(copy, scope);
  const free = frees.get(v);
  if (free) frees.set(copy, new Map(free));
  const spans = quotedSpans.get(v);
  if (spans) quotedSpans.set(copy, spans);
  return copy;
}

// What a thrown value is, for the compile error reporting it.
function described(typing: Typing, value: Value): string {
  const v = unwrap(value);
  if (v && typeof v === "object" && v.kind === "record") {
    const message = unwrap(v.fields.get("message"));
    const r = typing.rec(v.type);
    const name = r.kind === "class" ? r.name : "an object";
    return typeof message === "string" ? `${name}: ${message}` : name;
  }
  return display(v, undefined);
}

// An integer wrapped to its type's bits, as the machine holds it.
function wrap(v: bigint, type: Integer): bigint {
  const { bits, signed } = INTEGERS[type];
  return signed ? BigInt.asIntN(bits, v) : BigInt.asUintN(bits, v);
}

function fit(v: f64, type: Type): f64 {
  return type === "f32" ? Math.fround(v) : v;
}

// An integer as the f32 nearest it, rounding once, ties to even.
function toF32(v: bigint): f64 {
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

function shortestF32(v: f64): string {
  if (!Number.isFinite(v) || v === 0) return Object.is(v, -0) ? "0" : String(v);
  for (let digits = 1; digits <= 9; digits++) {
    const near = Number(v.toPrecision(digits));
    if (Math.fround(near) === v) return String(near);
  }
  return String(v);
}

// The member of a union a value is when nothing says: its own type for an aggregate, the
// literal member with its value, or the member of its kind.
export function memberOf(typing: Typing, value: Value, union: UnionType): Type {
  const m = typing.rec(union).members;
  const kindOf = (t: Type) => (typeof t === "string" ? undefined : typing.rec(t).kind);
  if (value && typeof value === "object" && value.kind === "member" && m.includes(value.type)) return value.type;
  const v = unwrap(value);
  if (v === null) return "null";
  if (v && typeof v === "object") {
    if (v.kind === "array") return m.find((t) => kindOf(t) === "array")!;
    if (v.kind === "interior") return m.find((t) => kindOf(t) === "interior")!;
    if (v.kind === "member" || v.kind === "place") return memberOf(typing, unwrap(v), union);
    return m.find((t) => t === v.type) ?? m.find((t) => typing.fits(v.type, t))!;
  }
  const literal = m.find((t) => {
    const r = typeof t === "string" ? undefined : typing.rec(t);
    return r?.kind === "literal" && r.value === v;
  });
  if (literal) return literal;
  if (typeof v === "bigint") return m.find(isInteger) ?? "bigint";
  if (typeof v === "number") return m.find(isFloat)!;
  if (typeof v === "string") return "string";
  return "boolean";
}

// The value inside a union's tag, for baking.
export function untagged(v: Value): Value {
  return unwrap(v);
}
