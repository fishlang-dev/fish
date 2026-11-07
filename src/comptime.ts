import assert from "node:assert";
import type { Instance } from "./check.ts";
import type { Body } from "./classes.ts";
import { bodyOf, type Arenas, type InstanceId, type LocalId } from "./arenas.ts";
import { CompileError } from "./diag.ts";
import { nextId } from "./ids.ts";
import { cloneStmts } from "./rebuild.ts";
import { fileAt, stdModuleAt } from "./program.ts";
import { built, quoted, type Builder, type Free } from "./quote.ts";
import { integerMethod } from "./values.ts";
import type { Expr, Param, Pattern, Span, Stmt } from "./parser.ts";
import { timingEnd, timingStart, type Started, type Tables } from "./compilation.ts";
import { integerInfo, range, redundantBang, type LiteralType, isFloat, isInteger, type ClassType, type Integer, type MapType, type ObjectType, type Type, type UnionType, type VariantType, type Typing } from "./typing.ts";

// Comptime: Fish code run while compiling, by interpreting the checked program. What it computes
// is baked into the binary. It is pure computation: anything that would reach outside the
// program, or wait, is refused at the comptime site.

// An object or a class instance, its fields by name (a base's among them).
// A quote's value, and a clone of one, holds `quote`, naming its entries in the quote tables.
export type Record = { kind: "record"; type: ObjectType | ClassType; fields: Map<string, Value>; quote?: usize };
export type Items = { kind: "array"; items: Value[]; quote?: usize };
// A data-carrying enum's member and its payload.
export type Variant = { kind: "variant"; type: VariantType; args: Value[] };
// An Atomic or a Lock a top-level const holds: a global the program changes at run time, made
// while compiling but never used then.
export type Interior = { kind: "interior"; value: Value };
// A Map, a Set (each value undefined) or a dictionary: its entries in the order they were made,
// by a string naming the key, as JavaScript's Map compares keys by value.
export type Table = { kind: "map"; type: MapType; entries: Map<string, [Value, Value]> };
// A value in a union, and which member it is, as the program's tag says.
export type Member = { kind: "member"; type: Type; value: Value };

// A value while compiling: an integer as a bigint, a float as a number, a boolean, a string,
// null for an empty Option, or an aggregate. Objects are values in Fish, moved rather than shared,
// so a JS reference stands for one.
export type Value = bigint | f64 | boolean | string | null | undefined | Record | Items | Variant | Interior | Table | Member | Place;

// A step from a value into one of its parts: a field by name, or an element by index.
type Step = { kind: "field"; name: string } | { kind: "element"; index: bigint };

// Where a value lives, as a `Mut` holds it: reading and writing go through to it. Values are
// owned trees, so a local's place, or a temporary's, is its frame and the steps into it. A
// string's character can't be written. An element's or character's index was checked against
// the length when the place was taken, `before` counting a rest tuple's fixed elements. An
// accessor's runs its getter and setter, which only the interpreter can.
export type Place =
  | { kind: "place"; of: "local"; frame: usize; local: LocalId; path: Step[] }
  | { kind: "place"; of: "temp"; frame: usize; index: usize; path: Step[] }
  | { kind: "place"; of: "accessor"; self: Place; name: string; getter: InstanceId | undefined; setter: InstanceId; at: Span }
  | { kind: "place"; of: "char"; text: string; index: bigint; length: bigint; before: bigint; at: Span };

// The most steps one evaluation may take, the deepest its calls may nest, and the longest
// string it may make.
const STEPS = 10_000_000;
const DEPTH = 1000;
const LONGEST = 1 << 28;

// What an optional link meeting an empty Option makes of the rest of its chain.
const SHORT = { kind: "short" } as const;

// std's crypto functions, which comptime refuses as it refuses Math.random.
const RANDOM = new Set(["getRandomValues", "randomBytes", "randomUUID"]);

// A panic, or a refusal, while compiling: where it happened, and what it says; `assertion`
// marks a false `assert`, which fails the build at the assert itself.
class Stop {
  message: string;
  at: Span;
  panic: boolean;
  assertion: boolean;
  constructor(message: string, at: Ref<Span>, panic: boolean, assertion = false) {
    this.message = message;
    this.at = { start: at.start, end: at.end };
    this.panic = panic;
    this.assertion = assertion;
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
  target: usize;
  again: boolean;
  constructor(target: usize, again: boolean) {
    this.target = target;
    this.again = again;
  }
}

// An error thrown and not yet caught.
class Thrown {
  value: Value;
  at: Span;
  constructor(value: Value, at: Ref<Span>) {
    this.value = value;
    this.at = { start: at.start, end: at.end };
  }
}

// A call's locals, the temporaries its places name, and the place of its `this`.
type Frame = { instance: InstanceId; locals: Map<LocalId, Value>; temps: Value[]; self: Place | undefined };


// What runs comptime code: the compilation's tables, and checking a function before comptime
// runs it, as a comptime argument may call one the checker hasn't reached yet.
export interface ComptimeHost {
  tables: Tables;
  /** @throws {CompileError} */
  ensureChecked(this: Mut<this>, id: InstanceId): boolean;
}

// The host of a checked program, every function of which comptime may run.
export class CheckedHost<T extends Tables> {
  tables: Mut<T>;

  constructor(tables: Mut<T>) {
    this.tables = tables;
  }

  ensureChecked(_id: InstanceId): boolean {
    return true;
  }
}

// The value of `comptime expr`, written in `instance`.
/** @throws {CompileError} */
export function comptimeValue<H extends ComptimeHost>(host: Mut<H>, instance: InstanceId, site: Ref<Extract<Expr, { kind: "comptime" }>>): Value {
  const frame = seeded(host.tables, instance);
  let run = new Interpreter(host);
  try {
    const f = run.enter(frame);
    return run.expr(f, site.expr);
  } catch (e) {
    throw run.failure(e as Failure, site);
  } finally {
    run.finish();
  }
}

// Runs a `comptime { }` block written in `instance`, for what it checks.
/** @throws {CompileError} */
export function comptimeBlock<H extends ComptimeHost>(host: Mut<H>, instance: InstanceId, site: Ref<Extract<Stmt, { kind: "comptime" }>>) {
  const frame = seeded(host.tables, instance);
  let run = new Interpreter(host);
  try {
    const f = run.enter(frame);
    run.block(f, site.body);
  } catch (e) {
    throw run.failure(e as Failure, site);
  } finally {
    run.finish();
  }
}

// A comptime parameter's argument at a call written in `instance`.
/** @throws {CompileError} */
export function comptimeArgument<H extends ComptimeHost>(host: Mut<H>, instance: InstanceId, arg: Ref<Expr>): Value {
  const frame = seeded(host.tables, instance);
  let run = new Interpreter(host);
  try {
    const f = run.enter(frame);
    return run.expr(f, arg);
  } catch (e) {
    throw run.failure(e as Failure, arg);
  } finally {
    run.finish();
  }
}

// A quote's value with the names spelled `from`, in nodes its quotes made at `spans`, renamed.
function renamed(spans: Ref<Set<string>>, v: Value, from: string, to: string): Value {
  if (isMember(v)) return { kind: "member", type: v.type, value: renamed(spans, v.value, from, to) };
  if (isItems(v)) {
    let items: Value[] = [];
    for (const x of v.items) items.push(renamed(spans, copyValue(x), from, to));
    return { kind: "array", items, quote: v.quote };
  }
  if (!isRecord(v)) return v;
  const kind = v.fields.get("kind");
  const at = `${String(v.fields.get("start"))}:${String(v.fields.get("end"))}`;
  const name = v.fields.get("name");
  let fields = new Map<string, Value>();
  for (const [k, x] of v.fields) fields.set(k, renamed(spans, copyValue(x), from, to));
  if (spans.has(at) && typeof name === "string" && (kind === "ident" || kind === "ref" || kind === "variant")) {
    const parts = name.split(".");
    if (parts[0] === from) {
      parts[0] = to;
      fields.set("name", parts.join("."));
    }
  }
  return { kind: "record", type: v.type, fields, quote: v.quote };
}

// A function run while compiling with the given arguments, as a macro runs on a declaration;
// a failure is reported at `site`.
/** @throws {CompileError} */
export function comptimeCall<H extends ComptimeHost>(host: Mut<H>, instance: InstanceId, args: Value[], site: Ref<Span>): Value {
  let run = new Interpreter(host);
  try {
    return run.call(instance, args, undefined, site);
  } catch (e) {
    throw run.failure(e as Failure, site);
  } finally {
    run.finish();
  }
}

// How a quoted tree, or a declaration a macro takes, becomes a value while compiling: each
// splice is its hole's value, of the type its hole was written as. A hole made by quotes names
// what they leave free, `frees`, in nodes they made at `spans`.
export class AstValues implements Builder<Value> {
  holes: Value[];
  types: (Type | undefined)[];
  frees: (Free | undefined)[];
  spans: Set<string>[];
  at: Span;

  constructor(holes: Value[], types: (Type | undefined)[], frees: (Free | undefined)[], spans: Set<string>[], at: Ref<Span>) {
    this.holes = holes;
    this.types = types;
    this.frees = frees;
    this.spans = spans;
    this.at = { start: at.start, end: at.end };
  }

  // A name a hole's quotes leave free means this quote's binding of it; what this quote leaves
  // free, a quote around it may bind.
  prepare(this: Mut<this>, scope: Ref<Map<string, string>>, free: Mut<Free>) {
    for (let i: usize = 0; i < this.holes.length; i++) {
      const inner = this.frees[i];
      if (inner === undefined) continue;
      for (const [name, spelling] of inner) {
        const to = scope.get(name);
        if (to === undefined) {
          free.set(name, spelling);
          continue;
        }
        const held = copyValue(this.holes[i]!);
        this.holes[i] = renamed(this.spans[i]!, held, spelling, to);
      }
    }
  }

  record(type: ObjectType, fields: Map<string, Value>): Value {
    return { kind: "record", type, fields };
  }

  array(items: Value[]): Value {
    return { kind: "array", items };
  }

  member(value: Value, _of: Type, member: Type): Value {
    return { kind: "member", type: member, value };
  }

  splice(typing: Mut<Typing>, i: usize, into: Type): Value {
    return retag(typing, copyValue(this.holes[i]!), this.types[i], into);
  }

  // A splice where a name goes: the name of the identifier it is.
  /** @throws {CompileError} */
  name(i: usize): Value {
    const v = untagged(this.holes[i]!);
    if (isRecord(v) && v.fields.get("kind") === "ident") return copyValue(v.fields.get("name"));
    throw new CompileError("E1101", "a splice where a name goes takes an identifier, as 'ident(\"name\")' makes", this.at.start, this.at.end);
  }

  int(n: bigint): Value {
    return n;
  }

  text(s: string): Value {
    return s;
  }

  boolean(b: boolean): Value {
    return b;
  }

  float(f: f64): Value {
    return f;
  }

  literal(value: string | bigint | boolean): Value {
    return value;
  }

  none(): Value {
    return null;
  }
}

// A comptime string array's binding: a literal type standing for exactly that array, so equal
// arrays share an instance. It is never the interned literal of an ordinary string, which a
// string parameter may be given with the same text.
export function stringsType(tables: Mut<Tables>, items: string[]): LiteralType {
  const t = tables.typing.standInLiteral(`strings ${JSON.stringify(items)}`);
  tables.stringArrays.set(t, items);
  return t;
}

// The value an instance's comptime parameter was given, from the literal type it is keyed by.
export function comptimeParameter(tables: Ref<Tables>, instance: Ref<Instance>, p: Ref<Param>): Value {
  const name = p.pattern.kind === "ident" ? p.pattern.name : "";
  const t = instance.bindings.get(`comptime ${name}`);
  if (t === undefined || typeof t === "string") return undefined;
  const r = tables.typing.rec(t);
  if (r.kind !== "literal") return undefined;
  const strings = tables.stringArrays.get(t as LiteralType);
  if (strings !== undefined) {
    let items: Value[] = [];
    for (const x of strings) items.push(x);
    return { kind: "array", items };
  }
  // An enum's member keeps which enum it is, as members of two enums may share a value.
  return r.owner !== undefined ? { kind: "member", type: t, value: r.value } : r.value;
}

// A frame for comptime code in an instance, which knows the instance's comptime parameters.
function seeded(tables: Ref<Tables>, instance: InstanceId): Frame {
  return { instance, locals: known(tables, tables.arenas.instanceOf(instance)), temps: [], self: undefined };
}

// The comptime parameters an instance can read, by local: its own, and in a closure, those of
// the functions it is written in, through what it captures.
function known(tables: Ref<Tables>, instance: Ref<Instance>): Map<LocalId, Value> {
  const body = bodyOf(tables.arenas, instance);
  const parent = body.closure !== undefined ? body.closure.parent : undefined;
  const outer = parent !== undefined ? known(tables, tables.arenas.instanceOf(parent)) : new Map<LocalId, Value>();
  let locals = new Map<LocalId, Value>();
  for (const p of body.params) if (p.comptime === true) locals.set(instance.locals.get(p)!, comptimeParameter(tables, instance, p));
  if (instance.captures !== undefined) {
    for (const [alias, from] of instance.captures) if (from !== "this" && outer.has(from)) locals.set(alias, copyValue(outer.get(from)));
  }
  return locals;
}

// A top-level const's value, or a `comptime { }` block run at the top level: its body.
/** @throws {CompileError} */
export function comptimeBody<H extends ComptimeHost>(host: Mut<H>, instance: InstanceId): Value {
  if (host.tables.constants.has(instance)) return host.tables.constants.get(instance);
  const body = bodyOf(host.tables.arenas, host.tables.arenas.instanceOf(instance));
  const site: Span = { start: body.start, end: body.end };
  let run = new Interpreter(host);
  try {
    const v = run.constant(instance, site);
    run.host.tables.constants.set(instance, v);
    return v;
  } catch (e) {
    throw run.failure(e as Failure, site);
  } finally {
    run.finish();
  }
}

const constName = (arenas: Ref<Arenas>, c: InstanceId) => bodyOf(arenas, arenas.instanceOf(c)).name.slice("const ".length);

// What comptime code may throw out of a run.
type Failure = CompileError | Stop | Return | Jump | Thrown;

class Interpreter<H extends ComptimeHost> {
  host: Mut<H>;
  // When the run started, for the compilation's timings.
  private started: Started | undefined;

  constructor(host: Mut<H>) {
    this.host = host;
    this.started = timingStart(host.tables);
  }

  // Adds the run's time to the comptime stage's.
  finish(this: Mut<this>) {
    timingEnd(this.host.tables, "comptime", this.started);
  }

  // A panic, a refusal or an error comptime code didn't catch, as the compile error at the
  // comptime site that reports it, noting where inside it happened. A `return` or a jump never
  // leaves the function it is in.
  failure(this: Mut<this>, e: Failure, site: Ref<Span>): CompileError {
    if (e instanceof CompileError) return e;
    assert(!(e instanceof Return) && !(e instanceof Jump), "internal error: a return or a jump left comptime code");
    const stop = e instanceof Thrown ? new Stop(`this comptime code threw an error it didn't catch: ${described(this.host.tables.typing, e.value)}`, e.at, false) : e;
    const inside = stop.at.start !== site.start || stop.at.end !== site.end;
    if (stop.assertion) return new CompileError("E1101", stop.message, stop.at.start, stop.at.end, inside ? { message: "while running this comptime code", start: site.start, end: site.end } : undefined);
    const what = stop.panic ? `this comptime code panicked: ${stop.message}` : stop.message;
    return new CompileError("E1101", what, site.start, site.end, inside ? { message: stop.panic ? "it panicked here" : "here", start: stop.at.start, end: stop.at.end } : undefined);
  }

  // What `table` holds for `v`, when `v` is a quote's value or a clone of one.
  private quoteEntry<T>(table: Ref<Map<usize, T>>, v: Ref<Value>): Ref<T> | undefined {
    const q = quoteOf(v);
    return q === undefined ? undefined : table.get(q);
  }

  // The instance a frame runs, and the body an instance checks.
  private inst(f: usize): Ref<Instance> {
    return this.host.tables.arenas.instanceOf(this.frames[f]!.instance);
  }

  private body(id: InstanceId): Ref<Body> {
    return bodyOf(this.host.tables.arenas, this.host.tables.arenas.instanceOf(id));
  }

  private calledAt(f: usize, e: Ref<Expr>): InstanceId | undefined {
    return this.inst(f).calls.get(e);
  }
  private steps = 0;
  private depth = 0;
  // The frames of the calls running, innermost last; a place names its frame by its index here.
  private frames: Frame[] = [];

  enter(this: Mut<this>, frame: Frame): usize {
    this.frames.push(frame);
    return this.frames.length - 1;
  }

  // A place holding a value no variable holds, alive until its frame returns.
  // ponytail: a frame keeps every temporary until it returns, so a long loop grows it; STEPS bounds it.
  private temp(this: Mut<this>, f: usize, v: Value): Place {
    let temps = this.frames[f]!.temps;
    temps.push(v);
    return { kind: "place", of: "temp", frame: f, index: temps.length - 1, path: [] };
  }

  // The place of a part of what a place holds; an accessor's value is its getter's copy, whose
  // parts a temporary holds.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private extend(this: Mut<this>, p: Ref<Place>, step: Step): Place {
    if (p.of === "local") return { kind: "place", of: "local", frame: p.frame, local: p.local, path: [...p.path, step] };
    if (p.of === "temp") return { kind: "place", of: "temp", frame: p.frame, index: p.index, path: [...p.path, step] };
    const held = this.temp(this.frames.length - 1, this.read(p));
    return this.extend(held, step);
  }

  // `held` with `v` put at the end of `path`. A union's tag is kept on the way, and at the end
  // too when `inner`, as when a call changes the value inside it.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private placed(this: Mut<this>, held: Value, path: Step[], i: usize, v: Value, inner: boolean): Value {
    if ((i < path.length || inner) && held !== null && typeof held === "object" && held.kind === "member") {
      held.value = this.placed(held.value, path, i, v, inner);
      return held;
    }
    if (i === path.length) return v;
    // A `Mut` held on the way: what follows is written through it.
    if (isPlace(held)) {
      let at = held;
      for (let j = i; j < path.length; j++) at = this.extend(at, path[j]!);
      this.write(at, v, inner);
      return held;
    }
    const step = path[i]!;
    if (step.kind === "field") {
      const r = held as Record;
      r.fields.set(step.name, this.placed(r.fields.get(step.name), path, i + 1, v, inner));
      return r;
    }
    const a = held as Items;
    a.items[Number(step.index)] = this.placed(a.items[Number(step.index)], path, i + 1, v, inner);
    return a;
  }

  // A block's statements; the checker lets no `return`, `break` or `continue` leave it.
  /** @throws {CompileError | Jump | Return | Stop | Thrown} */
  block(this: Mut<this>, f: usize, body: Ref<Stmt[]>): Value {
    this.statements(f, body);
    return undefined;
  }

  // A const's value, computed once; one that reads itself never ends, so it is refused.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  constant(this: Mut<this>, c: InstanceId, at: Ref<Span>): Value {
    if (this.host.tables.constants.has(c)) return this.host.tables.constants.get(c);
    if (this.host.tables.computing.has(c)) {
      const computing = [...this.host.tables.computing];
      throw new Stop(`'${constName(this.host.tables.arenas, c)}' needs its own value to compute its value${this.cycle(computing.slice(computing.indexOf(c)))}`, at, false);
    }
    this.host.tables.computing.add(c);
    try {
      const v = this.call(c, [], undefined, at);
      this.host.tables.constants.set(c, v);
      return v;
    } finally {
      this.host.tables.computing.delete(c);
    }
  }

  // How consts reading each other in a ring do it, naming their files when they are in several.
  private cycle(ring: Ref<InstanceId[]>): string {
    if (ring.length < 2) return "";
    let files: string[] = [];
    for (const c of ring) files.push(fileAt(this.host.tables.files, this.body(c).start));
    const several = new Set(files).size > 1;
    let named: string[] = [];
    for (let i: usize = 0; i <= ring.length; i++) {
      const at = i === ring.length ? 0 : i;
      named.push(`'${constName(this.host.tables.arenas, ring[at]!)}'${several ? ` in '${files[at]!}'` : ""}`);
    }
    return `: ${named[0]!} reads ${named.slice(1).join(", which reads ")}`;
  }

  /** @throws {Stop} */
  private step(this: Mut<this>, at: Ref<Span>) {
    if (++this.steps > STEPS) throw new Stop(`this comptime code took more than ${STEPS.toLocaleString("en-US")} steps; is there a loop that never ends?`, at, false);
  }

  // Code that reaches outside the program, or waits, which comptime never runs.
  /** @throws {Stop} */
  private refuse(what: string, at: Ref<Span>): never {
    throw new Stop(`${what} can't run while compiling: comptime code only computes values`, at, false);
  }

  // A source of randomness, whose one value comptime would bake into every run.
  /** @throws {Stop} */
  private random(what: string, at: Ref<Span>): never {
    throw new Stop(`${what} can't run while compiling; its value would be fixed into the program`, at, false);
  }

  // Pure code the interpreter doesn't run yet.
  /** @throws {Stop} */
  private unsupported(what: string, at: Ref<Span>): never {
    throw new Stop(`${what} isn't supported in comptime code yet`, at, false);
  }

  /** @throws {Stop} */
  private panic(message: string, at: Ref<Span>): never {
    throw new Stop(message, at, true);
  }

  // What a place holds, an accessor's read through its getter.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private read(this: Mut<this>, p: Ref<Place>): Value {
    switch (p.of) {
      case "accessor":
        if (p.getter !== undefined) return this.call(p.getter, [], p.self, p.at);
        return (this.unwrap(this.read(p.self)) as Record).fields.get(p.name);
      case "char":
        return p.text[Number(p.index)];
      case "local":
      case "temp": {
        const frame = this.frames[p.frame]!;
        let v = p.of === "local" ? frame.locals.get(p.local) : frame.temps[p.index];
        for (const step of p.path) {
          const holder = this.unwrap(v);
          v = step.kind === "field" ? (holder as Record).fields.get(step.name) : (holder as Items).items[Number(step.index)];
        }
        return v;
      }
    }
  }

  // Writes `v` where a place is, an accessor's through its setter; `inner` keeps a union's tag
  // around what is there.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private write(this: Mut<this>, p: Ref<Place>, v: Value, inner = false) {
    switch (p.of) {
      case "accessor":
        this.call(p.setter, [v], p.self, p.at);
        return;
      case "char":
        return this.unsupported("changing a string's character", p.at);
      case "local": {
        let locals = this.frames[p.frame]!.locals;
        locals.set(p.local, this.placed(locals.get(p.local), p.path, 0, v, inner));
        return;
      }
      case "temp": {
        let temps = this.frames[p.frame]!.temps;
        temps[p.index] = this.placed(temps[p.index], p.path, 0, v, inner);
        return;
      }
    }
  }

  // A value without a union's tag, read through a `Mut`'s place.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private unwrap(this: Mut<this>, v: Value): Value {
    if (isPlace(v)) return this.unwrap(this.read(v));
    return v && typeof v === "object" && v.kind === "member" ? this.unwrap(v.value) : v;
  }

  private typeOf(f: usize, e: Ref<Expr>): Type {
    return this.inst(f).coercions.get(e) ?? this.inst(f).types.get(e)!;
  }

  // An instance's comparison through its class's `equals`, or nothing for other records.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private equals(this: Mut<this>, a: Record, b: Record, at: Ref<Span>): boolean | undefined {
    if (this.host.tables.typing.rec(a.type).kind !== "class") return undefined;
    const method = this.host.tables.equalities.get(a.type as ClassType);
    if (method === undefined) return undefined;
    const self = this.temp(this.frames.length - 1, a);
    return this.call(method, [b], self, at) === true;
  }

  // Which member of its union a value is: its tag, or else the type it is written as, a literal
  // standing for its base type.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private memberType(this: Mut<this>, v: Value, t: Type | undefined): Type | undefined {
    if (v !== null && typeof v === "object" && v.kind === "member") return this.memberType(v.value, v.type);
    const own = deref(this.host.tables.typing, t);
    const r = own === undefined || typeof own === "string" ? undefined : this.host.tables.typing.rec(own);
    if (r?.kind === "union") return memberOf(this.host.tables.typing, this.resolved(v), own as UnionType);
    if (r?.kind === "literal") return this.host.tables.typing.baseOf(own as LiteralType) ?? own;
    return own;
  }

  // A value read through any places it is, keeping a union's tag.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private resolved(this: Mut<this>, v: Value): Value {
    return isPlace(v) ? this.resolved(this.read(v)) : v;
  }

  // `===` on two values of the types they are written as: a union compares its member, then the
  // value it holds. Instances of a class with an `equals` compare through it when `at` is given,
  // as they do at run time.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private equal(this: Mut<this>, a: Value, ta: Type | undefined, b: Value, tb: Type | undefined, at: Ref<Span> | undefined): boolean {
    const [ma, mb] = [this.memberType(a, ta), this.memberType(b, tb)];
    // A literal stands for its base type: members of two enums that share a value are equal, as
    // they are at run time.
    if (ma !== undefined && mb !== undefined && plainType(this.host.tables.typing, ma) !== plainType(this.host.tables.typing, mb)) return false;
    return this.same(a, b, at);
  }

  // Values compare as `===` compares them: primitives by value, variants by member and payload.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private same(this: Mut<this>, x: Value, y: Value, at: Ref<Span> | undefined): boolean {
    // Two members of a union are equal when they are the same member holding equal values.
    if (x !== null && y !== null && typeof x === "object" && typeof y === "object" && x.kind === "member" && y.kind === "member") {
      if (plainType(this.host.tables.typing, x.type) !== plainType(this.host.tables.typing, y.type)) return false;
    }
    const [a, b] = [this.unwrap(x), this.unwrap(y)];
    if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && a.kind === "variant" && b.kind === "variant") {
      return a.type === b.type && a.args.every((v, i) => this.same(v, b.args[i], at));
    }
    // Objects and arrays compare part by part.
    if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && a.kind === "record" && b.kind === "record") {
      const written = at === undefined ? undefined : this.equals(a, b, at);
      if (written !== undefined) return written;
      return a.fields.size === b.fields.size && [...a.fields].every(([k, v]) => b.fields.has(k) && this.same(v, b.fields.get(k), at));
    }
    if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && a.kind === "array" && b.kind === "array") {
      return a.items.length === b.items.length && a.items.every((v, i) => this.same(v, b.items[i], at));
    }
    return a === b;
  }

  /** @throws {CompileError | Jump | Stop | Thrown} */
  call(this: Mut<this>, callee: InstanceId, args: Value[], self: Place | undefined, at: Ref<Span>): Value {
    if (++this.depth > DEPTH) throw new Stop(`this comptime code nests calls more than ${DEPTH} deep; is there a recursion that never ends?`, at, false);
    try {
      const body = this.body(callee);
      const name = body.name;
      if (RANDOM.has(name) && stdModuleAt(this.host.tables.files, body.start) === "node:crypto") this.random(`'crypto.${name}'`, at);
      if (body.async === true) this.refuse("an async function", at);
      if (body.generator === true) this.unsupported("a generator", at);
      if (body.foreign === true) this.refuse(`the ${body.rust !== undefined ? "Rust" : "C"} function '${name}'`, at);
      if (body.js !== undefined) this.refuse(`'${name}' from the package '${body.js.module}'`, at);
      if (!this.host.ensureChecked(callee)) throw new Stop(`this comptime code calls '${name}', which is still being checked, so it can't run yet; compute the value without it`, at, false);
      let frame: Frame = { instance: callee, locals: new Map<LocalId, Value>(), temps: [], self };
      const instance = this.host.tables.arenas.instanceOf(callee);
      for (let i: usize = 0; i < body.params.length; i++) frame.locals.set(instance.locals.get(body.params[i]!)!, i < args.length ? args[i]! : null);
      // The body runs as a copy of it, as checking another function may change where it lives.
      const code = cloneStmts(this.body(callee).body ?? []);
      const f = this.enter(frame);
      try {
        this.statements(f, code);
      } finally {
        this.frames.pop();
      }
      return undefined;
    } catch (e) {
      if (e instanceof Return) return e.value;
      throw e;
    } finally {
      this.depth--;
    }
  }

  // The arguments of a call: a `Mut` parameter takes its argument's place, the rest values.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private args(this: Mut<this>, f: usize, callee: InstanceId, list: Ref<Expr[]>): Value[] {
    return list.map((a) => this.expr(f, a));
  }

  /** @throws {CompileError | Jump | Return | Stop | Thrown} */
  private statements(this: Mut<this>, f: usize, list: Ref<Stmt[]>) {
    for (const s of list) this.statement(f, s);
  }

  /** @throws {CompileError | Jump | Return | Stop | Thrown} */
  private statement(this: Mut<this>, f: usize, s: Ref<Stmt>) {
    this.step(s);
    switch (s.kind) {
      case "expr":
        this.expr(f, s.expr);
        return;
      case "let": {
        // The checker gives a declaration one name, its local keyed by the statement.
        const local = this.inst(f).locals.get(s);
        const d = s.declarations[0]!;
        if (!local || s.declarations.length !== 1) return this.unsupported("destructuring", s);
        this.frames[f]!.locals.set(local, d.init ? this.expr(f, d.init) : undefined);
        return;
      }
      case "return":
        throw new Return(s.value ? this.expr(f, s.value) : undefined);
      case "if":
        if (this.unwrap(this.expr(f, s.cond))) this.statements(f, s.then);
        else if (s.else) this.statements(f, s.else);
        return;
      case "block":
      case "comptime":
        this.statements(f, s.body);
        return;
      case "unsafe":
        return this.refuse("'unsafe' code", s);
      case "while":
        while (this.unwrap(this.expr(f, s.cond))) if (!this.loopBody(f, s, s.body)) break;
        return;
      case "doWhile":
        do if (!this.loopBody(f, s, s.body)) break; while (this.unwrap(this.expr(f, s.cond)));
        return;
      case "for":
        if (s.init) this.statement(f, s.init);
        while (!s.test || this.unwrap(this.expr(f, s.test))) {
          this.step(s);
          if (!this.loopBody(f, s, s.body)) break;
          if (s.update) this.expr(f, s.update);
        }
        return;
      case "forOf": {
        const over = this.unwrap(this.expr(f, s.right));
        const local = this.inst(f).locals.get(s.left as Stmt)!;
        const items = this.iterated(over, s.right);
        for (const item of [...items]) {
          this.frames[f]!.locals.set(local, item);
          if (!this.loopBody(f, s, s.body)) break;
        }
        return;
      }
      case "switch": {
        const v = this.expr(f, s.discriminant);
        const subject = this.inst(f).types.get(s.discriminant);
        let at = s.cases.findIndex((c) => c.test !== undefined && this.equal(v, subject, this.expr(f, c.test), this.inst(f).types.get(c.test), undefined));
        if (at < 0) at = s.cases.findIndex((c) => c.test === undefined);
        if (at < 0) return;
        try {
          for (const c of s.cases.slice(at)) this.statements(f, c.body);
        } catch (e) {
          if (!(e instanceof Jump) || e.target !== s.id) throw e;
        }
        return;
      }
      case "break":
      case "continue":
        throw new Jump(this.inst(f).jumps.get(s)!.id, s.kind === "continue");
      case "labeled":
        try {
          this.statement(f, s.body);
        } catch (e) {
          if (!(e instanceof Jump) || e.target !== s.id) throw e;
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
  /** @throws {CompileError | Jump | Return | Stop | Thrown} */
  private attempt(this: Mut<this>, f: usize, s: Ref<Extract<Stmt, { kind: "try" }>>) {
    let left: unknown;
    let leaving = false;
    try {
      this.statements(f, s.block);
    } catch (e) {
      if (e instanceof Thrown && s.handler) {
        const local = s.param ? this.inst(f).locals.get(s) : undefined;
        if (local) this.frames[f]!.locals.set(local, e.value);
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
  /** @throws {CompileError} */
  private loopBody(this: Mut<this>, f: usize, loop: Ref<Stmt>, body: Ref<Stmt[]>): boolean {
    try {
      this.statements(f, body);
      return true;
    } catch (e) {
      if (e instanceof Jump && e.target === loop.id) return e.again;
      throw e;
    }
  }

  /** @throws {CompileError | Jump | Stop | Thrown} */
  expr(this: Mut<this>, f: usize, e: Ref<Expr>): Value {
    const v = this.link(f, e);
    return isShort(v) ? this.typed(f, e, null) : v;
  }

  // An expression's value; a member or call in an optional chain that met an empty Option
  // gives SHORT, which ends the chain as an empty Option.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private link(this: Mut<this>, f: usize, e: Ref<Expr>, keep = false): Value | typeof SHORT {
    this.step(e);
    // A place lent to a `Mut`: the place itself, which reads and writes go through.
    const [own, target] = [this.inst(f).types.get(e), this.inst(f).coercions.get(e) ?? this.inst(f).types.get(e)];
    // A fixed array copies where an array shares, which comptime values don't follow yet.
    const held = deref(this.host.tables.typing, own);
    if (held !== undefined && typeof held !== "string" && this.host.tables.typing.rec(held).kind === "fixed") this.unsupported("a FixedArray", e);
    if (mutable(this.host.tables.typing, target) && !mutable(this.host.tables.typing, own) && (e.kind === "ident" || e.kind === "member" || e.kind === "index" || e.kind === "this")) return this.place(f, e);
    const v = this.raw(f, e);
    return isShort(v) || (keep && isPlace(v)) ? v : this.typed(f, e, v);
  }

  // A value as the type it meets: a `Mut` stays a place, anything else reads through one; a float
  // where a literal meets one; a union's value tagged with the member its type says, in fields and
  // elements too; a member out of its union where a check narrowed it.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private typed(f: usize, e: Ref<Expr>, value: Value): Value {
    const own = this.inst(f).types.get(e);
    const target = this.inst(f).coercions.get(e) ?? own;
    if (isPlace(value) && mutable(this.host.tables.typing, target)) return value;
    const v = isPlace(value) ? this.read(value) : value;
    const to = deref(this.host.tables.typing, target);
    if (typeof v === "bigint" && to !== undefined && isFloat(to)) return fit(Number(v), to);
    return retag(this.host.tables.typing, v, deref(this.host.tables.typing, own), to);
  }

  /** @throws {CompileError | Jump | Stop | Thrown} */
  private raw(this: Mut<this>, f: usize, e: Ref<Expr>): Value | typeof SHORT {
    const type = this.inst(f).types.get(e)!;
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
        const types = this.host.tables.quotes.get(e);
        if (types === undefined) return this.unsupported("this tagged template", e);
        const asType = e.tag.kind === "ident" && e.tag.name === "quoteType";
        const q = quoted(this.host.tables, e, asType);
        let values: Value[] = [];
        let holeTypes: (Type | undefined)[] = [];
        for (const x of q.holes) {
          values.push(this.expr(f, x));
          holeTypes.push(this.inst(f).types.get(x));
        }
        // A quote spliced in shares its bindings with this one, and a name it leaves free means
        // this one's binding of it; what this one leaves free, a quote around it may bind.
        let scope = new Map<string, string>();
        let spans = new Set<string>();
        for (const v of values) {
          const bound = this.quoteEntry(this.host.tables.quoteScopes, v);
          if (bound !== undefined) for (const [k, x] of bound) scope.set(k, x);
          const made = this.quoteEntry(this.host.tables.quotedSpans, v);
          if (made !== undefined) for (const x of made) spans.add(x);
        }
        spans.add(`${e.start}:${e.end}`);
        let free: Free = new Map<string, string>();
        let frees: (Free | undefined)[] = [];
        let within: Set<string>[] = [];
        for (const v of values) {
          const q = quoteOf(v);
          const inner = q === undefined ? undefined : this.host.tables.quoteFrees.get(q);
          frees.push(inner === undefined ? undefined : new Map(inner));
          const made = q === undefined ? undefined : this.host.tables.quotedSpans.get(q);
          within.push(made === undefined ? new Set<string>() : new Set(made));
        }
        let made: Value;
        try {
          made = built<Value>(this.host.tables, q, types, e, new AstValues(values, holeTypes, frees, within, e), scope, free);
        } catch (err) {
          if (err instanceof CompileError && err.code === "E1101") throw new Stop(err.message, e, false);
          throw err;
        }
        const at = nextId(this.host.tables.quoteValues);
        if (!withQuote(made, at)) return made;
        this.host.tables.quoteScopes.set(at, scope);
        this.host.tables.quoteFrees.set(at, free);
        this.host.tables.quotedSpans.set(at, spans);
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
        const literal = literalValue(this.host.tables.typing, type);
        if (literal !== undefined && !this.inst(f).locals.has(e)) return literal;
        const read = this.calledAt(f, e);
        if (read !== undefined && this.body(read).comptime === "const") return this.constant(read, e);
        const local = this.inst(f).locals.get(e);
        if (!local && e.name === "undefined") return null;
        if (!local || !this.frames[f]!.locals.has(local)) throw new Stop(`'${e.name}' is only known when the program runs, so comptime code can't read it`, e, false);
        return this.frames[f]!.locals.get(local);
      }
      case "this": {
        const self = this.frames[f]!.self;
        if (self === undefined) return this.unsupported("'this'", e);
        return this.read(self);
      }
      case "comptime":
        return this.expr(f, e.expr);
      case "conditional":
        return this.unwrap(this.expr(f, e.cond)) ? this.expr(f, e.then) : this.expr(f, e.else);
      case "unary":
        return this.unary(f, e);
      case "binary":
        return this.binary(f, e);
      case "assign":
        return this.assign(f, e);
      case "update": {
        const at = this.place(f, e.operand);
        const old = this.unwrap(this.read(at)) as bigint | f64;
        const one = typeof old === "bigint" ? 1n : 1;
        const next = this.numeric(e.op === "++" ? "+" : "-", old, one, this.typeOf(f, e.operand), e);
        this.write(at, next);
        return e.prefix ? next : old;
      }
      case "as": {
        const from = this.host.tables.typing.lower(this.inst(f).coercions.get(e.expr) ?? this.typeOf(f, e.expr));
        if (typeof from !== "string" && this.host.tables.typing.rec(from).kind === "union" && from !== type && !this.host.tables.typing.fits(from, type)) {
          const held = this.expr(f, e.expr);
          const r = typeof type === "string" ? undefined : this.host.tables.typing.rec(type);
          const kept = r?.kind === "union" ? r.members : [type];
          const actual = this.memberType(held, from);
          if (actual === undefined || (!kept.includes(actual) && !kept.includes(this.host.tables.typing.unfold(actual)))) {
            this.panic(`'as ${this.host.tables.typing.show(type)}' failed: union held another member`, e);
          }
          return retag(this.host.tables.typing, held, from, type);
        }
        return this.convert(this.unwrap(this.expr(f, e.expr)), type, e);
      }
      case "satisfies":
        return this.expr(f, e.expr);
      case "nonNull": {
        // An overload's body narrows the implementation's value to the signature's return type.
        if (e.narrows) {
          const [from, to] = [this.inst(f).types.get(e.expr), type];
          const held = this.expr(f, e.expr);
          if (from === to) return held;
          const r = typeof to === "string" ? undefined : this.host.tables.typing.rec(to);
          const kept = r?.kind === "union" ? r.members : [to];
          if (!kept.includes(this.memberType(held, from)!)) this.panic("the implementation returned a value this overload signature doesn't declare", e);
          return retag(this.host.tables.typing, held, from, to);
        }
        if (redundantBang(e)) return this.expr(f, e.expr);
        const v = this.unwrap(this.expr(f, e.expr));
        if (v === null) this.panic("called `Option::unwrap()` on a `None` value", e);
        return v;
      }
      case "object": {
        const fields = new Map<string, Value>();
        for (const p of e.props) {
          if (p.kind === "property" && typeof p.key === "string") fields.set(p.key, this.expr(f, p.value));
          else if (p.kind === "shorthand") {
            const local = this.inst(f).locals.get(p)!;
            if (!this.frames[f]!.locals.has(local)) throw new Stop(`'${p.name}' is only known when the program runs, so comptime code can't read it`, p, false);
            const held = this.frames[f]!.locals.get(local);
            fields.set(p.name, held);
          } else return this.unsupported("this property", p);
        }
        return { kind: "record", type: type as ObjectType, fields };
      }
      case "array":
        return { kind: "array", items: e.elements.flatMap((x) => (!x ? this.unsupported("a hole in an array", e) : x.kind === "spread" ? this.iterated(this.unwrap(this.expr(f, x.value)), x).map((v) => cloned(this.host.tables, v)) : [this.expr(f, x)])) };
      case "new":
        return this.construct(f, e, type);
      case "member":
        return this.member(f, e, type);
      case "index": {
        const object = this.link(f, e.object);
        if (isShort(object)) return SHORT;
        return this.read(this.place(f, e, object));
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

  /** @throws {CompileError | Jump | Stop | Thrown} */
  private construct(this: Mut<this>, f: usize, e: Ref<Extract<Expr, { kind: "new" }>>, type: Type): Value {
    const r = typeof type === "string" ? undefined : this.host.tables.typing.rec(type);
    if (r?.kind === "interior" && r.which !== "Cell" && e.args?.length === 1) return { kind: "interior", value: this.expr(f, e.args[0]!) };
    if (r?.kind === "map") {
      const made: Table = { kind: "map", type: type as MapType, entries: new Map() };
      const from = e.args?.[0] ? this.unwrap(this.expr(f, e.args[0])) : undefined;
      for (const item of from ? this.iterated(from, e.args![0]!) : []) {
        const [k, v] = r.set ? [item, undefined] : this.pair(item);
        this.put(made, k, v);
      }
      return made;
    }
    if (r?.kind !== "class") return this.refuse(`'new ${this.host.tables.typing.show(type)}'`, e);
    const ctor = this.calledAt(f, e)!;
    const made: Record = { kind: "record", type: type as ClassType, fields: new Map() };
    const self = this.temp(f, made);
    this.call(ctor, this.args(f, ctor, e.args ?? []), self, e);
    return this.read(self);
  }

  /** @throws {CompileError | Jump | Stop | Thrown} */
  private member(this: Mut<this>, f: usize, e: Ref<Extract<Expr, { kind: "member" }>>, type: Type): Value | typeof SHORT {
    // An enum's member, as `Color.Red`, is known from its type alone.
    const literal = literalValue(this.host.tables.typing, type);
    if (literal !== undefined) return literal;
    const r = typeof type === "string" ? undefined : this.host.tables.typing.rec(type);
    if (r?.kind === "variant" && r.fields.length === 0 && enumName(e.object)) return { kind: "variant", type: type as VariantType, args: [] };
    const getter = this.calledAt(f, e);
    if (getter) {
      const self = this.receiver(f, e.object);
      if (isShort(self)) return SHORT;
      if (e.optional && this.unwrap(this.read(self)) === null) return SHORT;
      return this.call(getter, [], self, e);
    }
    const linked = this.link(f, e.object);
    if (isShort(linked)) return SHORT;
    const object = this.unwrap(linked);
    if (object === null && e.optional) return SHORT;
    return this.memberValue(e, object);
  }

  // A member read from a value: a length, a size, or a field.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private memberValue(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>, object: Value): Value {
    if (e.name === "length" && typeof object === "string") return BigInt(object.length);
    if (object && typeof object === "object" && object.kind === "array" && e.name === "length") return BigInt(object.items.length);
    if (object && typeof object === "object" && object.kind === "map" && e.name === "size") return BigInt(object.entries.size);
    if (object && typeof object === "object" && object.kind === "record" && this.host.tables.typing.isTuple(object.type) && e.name === "length") return this.tupleLength(object);
    if (object && typeof object === "object" && object.kind === "record") return object.fields.get(e.name);
    return this.unsupported(`reading '${e.name}' here`, e);
  }

  // A tuple's length, as at run time: its required elements, up to the last optional one there,
  // then its rest.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private tupleLength(t: Ref<Record>): bigint {
    const type = t.type as ObjectType;
    const count = this.host.tables.typing.elementsOf(type).length;
    let length = this.host.tables.typing.rec(type).required ?? count;
    for (let i = length; i < count; i++) if (this.unwrap(t.fields.get(String(i))!) !== null) length = i + 1;
    const rest = t.fields.get("...");
    return BigInt(length + (rest && typeof rest === "object" && rest.kind === "array" ? rest.items.length : 0));
  }

  /** @throws {CompileError | Jump | Stop | Thrown} */
  private callExpr(this: Mut<this>, f: usize, e: Ref<Extract<Expr, { kind: "call" }>>, type: Type): Value | typeof SHORT {
    const callee = e.callee;
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "console") this.refuse("printing", e);
    if (this.host.tables.clocks.get(e) === "Math.random") this.random("'Math.random'", e);
    // A data-carrying enum's member, as `Shape.Circle(2)`.
    const r = type === undefined || typeof type === "string" ? undefined : this.host.tables.typing.rec(type);
    if (r?.kind === "variant" && callee.kind === "member" && enumName(callee.object)) {
      return { kind: "variant", type: type as VariantType, args: e.args.map((a) => this.expr(f, a)) };
    }
    if (this.host.tables.asserts.has(e)) {
      if (this.expr(f, e.args[0]!) === true) return undefined;
      throw new Stop(e.args[1] ? String(this.unwrap(this.expr(f, e.args[1]))) : `assertion failed: ${this.host.tables.asserts.get(e)}`, e, true, true);
    }
    const target = this.calledAt(f, e);
    if (target && (callee.kind === "super" || (callee.kind === "member" && callee.object.kind === "super"))) return this.call(target, this.args(f, target, e.args), this.frames[f]!.self, e);
    if (target !== undefined && callee.kind === "member" && this.body(target).self !== undefined) {
      const self = this.receiver(f, callee.object);
      if (isShort(self)) return SHORT;
      if ((callee.optional || e.optional) && this.unwrap(this.read(self)) === null) return SHORT;
      return this.call(target, this.args(f, target, e.args), self, e);
    }
    if (target) return this.call(target, this.args(f, target, e.args), undefined, e);
    if (callee.kind === "ident" && callee.name === "String" && e.args.length === 1) return display(this.expr(f, e.args[0]!), this.typeOf(f, e.args[0]!));
    // `String.fromCharCode` and `String.fromCodePoint`, their arguments gathered into one array.
    const built = this.host.tables.stringBuilds.get(e);
    if (built) {
      const items = (this.unwrap(this.expr(f, e.args[0]!)) as { items: Value[] }).items.map((x) => Number(this.unwrap(x) as bigint));
      if (built === "units") return String.fromCharCode(...items);
      const bad = items.find((x) => x > 0x10ffff);
      if (bad !== undefined) this.panic(`invalid code point ${bad}`, e);
      return String.fromCodePoint(...items);
    }
    // A static call on something that isn't a value, like `TcpListener.bind`, is std's own.
    if (callee.kind === "member" && !this.inst(f).types.has(callee.object)) return this.refuse(`'${callee.name}'`, e);
    if (callee.kind === "member") {
      const self = this.receiver(f, callee.object);
      if (isShort(self)) return SHORT;
      const held = this.unwrap(this.read(self));
      if (held === null && (callee.optional || e.optional)) return SHORT;
      if (this.host.tables.integerCalls.has(e)) return this.integerValue(callee.name, held as bigint, e.args[0] ? (this.unwrap(this.expr(f, e.args[0])) as bigint) : 0n, this.host.tables.typing.lower(this.typeOf(f, callee.object)) as Integer, type, e);
      if (typeof held === "string") return this.stringMethod(callee.name, held, e.args.map((a) => this.unwrap(this.expr(f, a))), e);
      if (callee.name === "clone") return cloned(this.host.tables, held);
      if (held && typeof held === "object" && held.kind === "array") {
        if (callee.name === "push") {
          held.items.push(this.expr(f, e.args[0]!));
          this.write(self, held, true);
          return undefined;
        }
        if (callee.name === "pop") {
          const last = held.items.length > 0 ? held.items.pop()! : null;
          this.write(self, held, true);
          return last;
        }
      }
      if (held && typeof held === "object" && held.kind === "map") return this.tableMethod(f, callee.name, self, held, e);
      return this.unsupported(`calling '${callee.name}' here`, e);
    }
    return this.refuse(`'${this.host.tables.timerNames.get(e) ?? (callee.kind === "ident" ? callee.name : "this call")}'`, e);
  }

  // A Map's or a Set's method, on the table `self` holds; `get` and the arrays of entries hand
  // out clones, as at run time, and `set` and `add` hand back the table's place, to chain.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private tableMethod(this: Mut<this>, f: usize, name: string, self: Place, table: Table, e: Ref<Extract<Expr, { kind: "call" }>>): Value {
    const args = e.args.map((a) => this.expr(f, a));
    const key = () => this.keyName(args[0]);
    switch (name) {
      case "set":
      case "add":
        this.put(table, args[0], args[1]);
        this.write(self, table, true);
        return self;
      case "get": {
        const found = table.entries.get(key());
        return found ? cloned(this.host.tables, found[1]) : null;
      }
      case "has":
        return table.entries.has(key());
      case "delete": {
        const had = table.entries.delete(key());
        this.write(self, table, true);
        return had;
      }
      case "clear":
        table.entries.clear();
        this.write(self, table, true);
        return undefined;
      case "keys":
      case "values":
      case "entries": {
        const listed = this.iterated(table, e);
        const which = (x: Value) => (x && typeof x === "object" && x.kind === "record" ? x.fields.get(name === "keys" ? "0" : "1") : x);
        return { kind: "array", items: name === "entries" ? listed : listed.map((x) => (this.host.tables.typing.rec(table.type).set ? x : which(x))) };
      }
      default:
        return this.unsupported(`calling '${name}' on a ${this.host.tables.typing.rec(table.type).set ? "Set" : "Map"}`, e);
    }
  }

  // Puts a key and its value in a table: a key already there keeps its place, as JavaScript's does.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private put(table: Table, k: Ref<Value>, v: Value) {
    const name = this.keyName(k);
    const was = table.entries.get(name);
    // As at run time, a float key of -0 is kept as 0.
    table.entries.set(name, [was ? was[0] : this.unwrap(k) === 0 ? 0 : k, v]);
  }

  // The string a key is compared by, which for a float is SameValueZero's: `String` names every
  // NaN alike and -0 as 0.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private keyName(k: Ref<Value>): string {
    const v = this.unwrap(k);
    return typeof v === "string" ? `s${v}` : `i${v as bigint | f64}`;
  }

  // A Map's entry as the pair of its key and value.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private pair(item: Value): [Value, Value] {
    const v = this.unwrap(item);
    if (v && typeof v === "object" && v.kind === "array") return [v.items[0], v.items[1]];
    if (v && typeof v === "object" && v.kind === "record") return [v.fields.get("0"), v.fields.get("1")];
    assert(false, "internal error: a Map's entry that isn't a pair");
  }

  // What looping over a value visits: a string's characters, an array's elements, a Set's
  // members, or a Map's entries as pairs of clones. A dictionary's entries come in the order
  // JavaScript gives an object's keys: integer keys first, from smallest.
  /** @throws {Stop} */
  private iterated(this: Mut<this>, over: Value, at: Ref<Span>): Value[] {
    if (typeof over === "string") return [...over];
    if (over && typeof over === "object" && over.kind === "array") return over.items;
    if (!over || typeof over !== "object" || over.kind !== "map") return this.unsupported("looping over this", at);
    const r = this.host.tables.typing.rec(over.type);
    let entries = [...over.entries.values()];
    if (r.dict) {
      const index = (k: Value) => (typeof k === "string" && /^(0|[1-9]\d*)$/.test(k) && Number(k) < 2 ** 32 - 1 ? Number(k) : undefined);
      const numbered = entries.filter(([k]) => index(k) !== undefined).sort(([a], [b]) => index(a)! - index(b)!);
      entries = [...numbered, ...entries.filter(([k]) => index(k) === undefined)];
    }
    if (r.set) return entries.map(([k]) => cloned(this.host.tables, k));
    const tuple = this.host.tables.typing.tupleType([r.key, r.value]);
    return entries.map(([k, v]): Record => ({ kind: "record", type: tuple, fields: new Map([["0", cloned(this.host.tables, k)], ["1", cloned(this.host.tables, v)]]) }));
  }

  /** @throws {Stop} */
  private stringMethod(name: string, s: string, args: Value[], at: Ref<Span>): Value {
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

  /** @throws {Stop} */
  private tooLong(at: Ref<Span>): never {
    throw new Stop(`this comptime code made a string longer than ${LONGEST.toLocaleString("en-US")} characters`, at, false);
  }

  // Two strings joined, within the longest string comptime makes.
  /** @throws {Stop} */
  private joined(a: string, b: string, at: Ref<Span>): string {
    if (a.length + b.length > LONGEST) this.tooLong(at);
    return a + b;
  }

  /** @throws {CompileError | Jump | Stop | Thrown} */
  private unary(this: Mut<this>, f: usize, e: Ref<Extract<Expr, { kind: "unary" }>>): Value {
    if (e.op === "await") this.refuse("'await'", e);
    const held = this.expr(f, e.operand);
    const v = this.unwrap(held);
    // A negative literal typed as a literal, or a union of them as `as const` gives it, negates
    // in their base type.
    const given = this.typeOf(f, e);
    const r = typeof given === "string" ? undefined : this.host.tables.typing.rec(given);
    const literals = r?.kind === "literal" ? [given] : r?.kind === "union" && r.members.every((m) => this.host.tables.typing.recOf(m)?.kind === "literal") ? r.members : [];
    const type = literals.length > 0 ? this.host.tables.typing.baseOf(literals[0] as LiteralType) : given;
    if (e.op === "!") return !v;
    if (e.op === "typeof") {
      const from = this.typeOf(f, e.operand);
      const r = typeof from === "string" ? undefined : this.host.tables.typing.rec(from);
      const member = r?.kind === "union" ? memberOf(this.host.tables.typing, held, from as UnionType) : from;
      return member === "bigint" ? "bigint" : typeofValue(v);
    }
    if (type === "bigint") return e.op === "-" ? -(v as bigint) : e.op === "~" ? ~(v as bigint) : this.unsupported(`'${e.op}'`, e);
    if (e.op === "-") return typeof v === "number" ? fit(-v, type as "f32" | "f64") : this.checked(-(v as bigint), type as Integer, "negate", e);
    if (e.op === "~") return wrap(~(v as bigint), type as Integer);
    return this.unsupported(`'${e.op}'`, e);
  }

  /** @throws {CompileError | Jump | Stop | Thrown} */
  private binary(this: Mut<this>, f: usize, e: Ref<Extract<Expr, { kind: "binary" }>>): Value {
    if (e.op === "&&") return this.unwrap(this.expr(f, e.left)) ? this.expr(f, e.right) : false;
    if (e.op === "||") return this.unwrap(this.expr(f, e.left)) ? true : this.expr(f, e.right);
    if (e.op === "??") {
      const v = this.expr(f, e.left);
      return this.unwrap(v) === null ? this.expr(f, e.right) : v;
    }
    if (e.op === "in") {
      const v = this.unwrap(this.expr(f, e.right));
      if (v === null || typeof v !== "object" || v.kind !== "record") return false;
      const key = (e.left as { value: string }).value;
      // A literal's record may carry its own type rather than the member's, so a field it holds answers.
      const said = this.host.tables.keyTests.get(e)!.get(v.type);
      return said === "yes" || said === "no" ? said === "yes" : (this.unwrap(v.fields.get(key)) ?? null) !== null;
    }
    if (e.op === "instanceof") {
      const v = this.unwrap(this.expr(f, e.left));
      return v !== null && typeof v === "object" && v.kind === "record" && this.host.tables.typing.isSubclass(v.type, this.inst(f).types.get(e.right)!);
    }
    const [a, b] = [this.expr(f, e.left), this.expr(f, e.right)];
    switch (e.op) {
      case "===":
        return this.equal(a, this.inst(f).types.get(e.left), b, this.inst(f).types.get(e.right), e);
      case "!==":
        return !this.equal(a, this.inst(f).types.get(e.left), b, this.inst(f).types.get(e.right), e);
      case "<":
        return (this.unwrap(a) as f64) < (this.unwrap(b) as f64);
      case "<=":
        return (this.unwrap(a) as f64) <= (this.unwrap(b) as f64);
      case ">":
        return (this.unwrap(a) as f64) > (this.unwrap(b) as f64);
      case ">=":
        return (this.unwrap(a) as f64) >= (this.unwrap(b) as f64);
    }
    const [x, y] = [this.unwrap(a), this.unwrap(b)];
    if (e.op === "+" && (typeof x === "string" || typeof y === "string")) return this.joined(display(x, this.typeOf(f, e.left)), display(y, this.typeOf(f, e.right)), e);
    return this.numeric(e.op, x as bigint | f64, y as bigint | f64, this.typeOf(f, e), e);
  }

  // The place is found first, then the value; a compound assignment reads the place once.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private assign(this: Mut<this>, f: usize, e: Ref<Extract<Expr, { kind: "assign" }>>): Value {
    const at = this.place(f, e.target);
    if (e.op === "=") {
      const v = this.expr(f, e.value);
      this.write(at, v);
      return v;
    }
    const op = e.op.slice(0, -1);
    const old = this.read(at);
    if (op === "&&" || op === "||" || op === "??") {
      const keep = op === "&&" ? !this.unwrap(old) : op === "||" ? !!this.unwrap(old) : this.unwrap(old) !== null;
      if (keep) return old;
      const v = this.expr(f, e.value);
      this.write(at, v);
      return v;
    }
    const [x, y] = [this.unwrap(old), this.unwrap(this.expr(f, e.value))];
    const v = op === "+" && typeof x === "string" ? this.joined(x, display(y, this.typeOf(f, e.value)), e) : this.numeric(op, x as bigint | f64, y as bigint | f64, this.typeOf(f, e.target), e);
    this.write(at, v);
    return v;
  }

  // Where an expression's value lives: a variable, a `Mut` parameter's place, an object's field,
  // or an array's element, its index read once.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private place(this: Mut<this>, f: usize, target: Ref<Expr>, object?: Value): Place {
    if (target.kind === "nonNull" && redundantBang(target)) return this.place(f, target.expr, object);
    if (target.kind === "this") {
      const self = this.frames[f]!.self;
      return self === undefined ? this.unsupported("'this'", target) : self;
    }
    if (target.kind === "ident") {
      const local = this.inst(f).locals.get(target);
      if (!local || !this.frames[f]!.locals.has(local)) throw new Stop(`'${target.name}' is only known when the program runs, so comptime code can't use it here`, target, false);
      const held = this.frames[f]!.locals.get(local);
      if (isPlace(held)) return held;
      return { kind: "place", of: "local", frame: f, local, path: [] };
    }
    if (target.kind === "member" && this.inst(f).setters.has(target)) {
      const self = this.holder(f, target.object);
      const getter = this.calledAt(f, target);
      return { kind: "place", of: "accessor", self, name: target.name, getter, setter: this.inst(f).setters.get(target)!, at: target };
    }
    if (target.kind === "member") {
      const base = this.holder(f, target.object);
      const holder = this.unwrap(this.read(base));
      if (holder && typeof holder === "object" && holder.kind === "record") {
        const held = holder.fields.get(target.name);
        if (isPlace(held)) return held;
        return this.extend(base, { kind: "field", name: target.name });
      }
      // A part of a value that isn't an object's, like an array's length, which is only read.
      if (typeof holder === "string" || (holder && typeof holder === "object" && (holder.kind === "array" || holder.kind === "map"))) return this.temp(f, this.memberValue(target, holder));
    }
    if (target.kind === "index") {
      const base = object === undefined ? this.holder(f, target.object) : isPlace(object) ? object : this.temp(f, object);
      const held = this.unwrap(this.read(base));
      const i = this.unwrap(this.expr(f, target.index)) as bigint;
      const length = typeof held === "string" ? held.length : held && typeof held === "object" && held.kind === "array" ? held.items.length : this.unsupported("indexing this", target);
      // A rest tuple's array is named as the tuple, its fixed elements counted in.
      const before = BigInt(this.host.tables.restStarts.get(target.object) ?? 0);
      // The bounds are checked where the place is taken, as a borrow of an element checks them.
      checkedIndex(i, BigInt(length), before, target);
      if (typeof held === "string") return { kind: "place", of: "char", text: held, index: i, length: BigInt(length), before, at: target };
      return this.extend(base, { kind: "element", index: i });
    }
    return this.unsupported("changing this", target);
  }

  // Whether an expression names where a value lives, so its place can be taken without reading
  // it first. A FixedArray's isn't, so reading it refuses it.
  private placeable(f: usize, e: Ref<Expr>): boolean {
    const held = deref(this.host.tables.typing, this.inst(f).types.get(e));
    if (held !== undefined && typeof held !== "string" && this.host.tables.typing.rec(held).kind === "fixed") return false;
    switch (e.kind) {
      case "nonNull":
        return redundantBang(e) && this.placeable(f, e.expr);
      case "this":
        return this.frames[f]!.self !== undefined;
      case "ident": {
        const local = this.inst(f).locals.get(e);
        return local !== undefined && this.frames[f]!.locals.has(local);
      }
      case "member":
        return !e.optional && this.inst(f).calls.get(e) === undefined && this.placeable(f, e.object);
      case "index":
        return !e.optional && this.placeable(f, e.object);
    }
    return false;
  }

  // A method's receiver: the place it names, or a temporary holding its value, so what the
  // method changes reaches where the value lives.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private receiver(this: Mut<this>, f: usize, e: Ref<Expr>): Place | typeof SHORT {
    if (this.placeable(f, e)) return this.place(f, e);
    const v = this.link(f, e, true);
    if (isShort(v)) return SHORT;
    return isPlace(v) ? v : this.temp(f, v);
  }

  // Where the value a member or an index is read from lives.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private holder(this: Mut<this>, f: usize, e: Ref<Expr>): Place {
    const p = this.receiver(f, e);
    return isShort(p) ? this.temp(f, this.typed(f, e, null)) : p;
  }

  /** @throws {CompileError | Jump | Stop | Thrown} */
  private match(this: Mut<this>, f: usize, e: Ref<Extract<Expr, { kind: "match" }>>): Value {
    const subject = this.expr(f, e.subject);
    for (const arm of e.arms) {
      if (!this.tests(f, arm.pattern, subject)) continue;
      this.bind(f, arm.pattern, subject);
      if (arm.guard && !this.unwrap(this.expr(f, arm.guard))) continue;
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

  /** @throws {CompileError | Jump | Stop | Thrown} */
  private tests(this: Mut<this>, f: usize, p: Ref<Pattern>, value: Value): boolean {
    const info = this.inst(f).patterns.get(p)!;
    const tag = value && typeof value === "object" && value.kind === "member" ? value.type : undefined;
    const v = this.unwrap(value);
    const r = typeof info.type === "string" ? undefined : this.host.tables.typing.rec(info.type);
    const union = r?.kind === "union" ? r : undefined;
    switch (info.kind) {
      case "any":
        return true;
      case "literal":
        return info.member ? this.same(v, literalValue(this.host.tables.typing, info.member) ?? this.host.tables.typing.rec(info.member).value, undefined) : this.same(v, this.expr(f, (p as Extract<Pattern, { kind: "literal" }>).value), undefined);
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

  /** @throws {CompileError | Jump | Stop | Thrown} */
  private bind(f: usize, p: Ref<Pattern>, value: Value) {
    const info = this.inst(f).patterns.get(p)!;
    const v = this.unwrap(value);
    if (info.kind === "any" && p.kind === "ident") return void this.frames[f]!.locals.set(this.inst(f).locals.get(p as Expr)!, value);
    if (info.kind === "variant") info.args.forEach((arg, i) => this.bind(f, arg, (v as Variant).args[i]));
    if (info.kind === "object") for (const [key, sub] of info.fields) this.bind(f, sub, (v as Record).fields.get(key));
    if (info.kind === "array") info.items.forEach((item, i) => this.bind(f, item, (v as Items).items[i]));
    if (info.kind === "some") this.bind(f, info.arg, v);
  }

  // An arithmetic or bitwise operator on numbers of `type`, panicking where the program would.
  // A bigint's operators as JavaScript has them, panicking where it throws a RangeError.
  /** @throws {Stop} */
  private bigNumeric(op: string, a: bigint, b: bigint, at: Ref<Span>): Value {
    if ((op === "/" || op === "%") && b === 0n) this.panic("Division by zero", at);
    if (op === "**" && b < 0n) this.panic("Exponent must be non-negative", at);
    if ((op === "**" || op === "<<") && tooBig(op, a, b)) throw new Stop("this comptime code made a value too large to hold while compiling", at, false);
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

  /** @throws {Stop} */
  private numeric(this: Mut<this>, op: string, a: bigint | f64, b: bigint | f64, type: Type, at: Ref<Span>): Value {
    if (typeof a === "number" || typeof b === "number") {
      const [x, y] = [Number(a), Number(b)];
      const v = op === "+" ? x + y : op === "-" ? x - y : op === "*" ? x * y : op === "/" ? x / y : op === "%" ? x % y : op === "**" ? x ** y : undefined;
      if (v === undefined) return this.unsupported(`'${op}' on floats`, at);
      return fit(v, type as "f32" | "f64");
    }
    if (type === "bigint") return this.bigNumeric(op, a as bigint, b as bigint, at);
    if (!isInteger(type)) return this.unsupported(`'${op}' on '${this.host.tables.typing.show(type)}'`, at);
    const { bits, signed } = integerInfo(type);
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
  /** @throws {Stop} */
  private integerValue(this: Mut<this>, name: string, a: bigint, b: bigint, type: Integer, result: Type, at: Ref<Span>): Value {
    const [family, operation] = integerMethod(name)!;
    const { bits, signed } = integerInfo(type);
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
  /** @throws {Stop} */
  private checked(v: bigint, type: Integer, verb: string, at: Ref<Span>): bigint {
    if (wrap(v, type) !== v) this.panic(`attempt to ${verb} with overflow`, at);
    return v;
  }

  // `x as T` between numbers, as Rust's `as` converts: integers wrap, floats truncate and saturate.
  /** @throws {Stop} */
  private convert(v: Value, to: Type, at: Ref<Span>): Value {
    if (typeof v === "boolean") v = v ? 1n : 0n;
    if (isFloat(to)) return typeof v === "bigint" && to === "f32" ? toF32(v) : fit(Number(v), to);
    if (!isInteger(to)) return v;
    if (typeof v === "bigint") return wrap(v, to);
    if (typeof v !== "number") return this.unsupported(`converting this with 'as'`, at);
    if (Number.isNaN(v)) return 0n;
    const { bits, signed } = integerInfo(to);
    const [min, max] = signed ? [-(1n << BigInt(bits - 1)), (1n << BigInt(bits - 1)) - 1n] : [0n, (1n << BigInt(bits)) - 1n];
    if (v === Infinity) return max;
    if (v === -Infinity) return min;
    const t = BigInt(Math.trunc(v));
    return t < min ? min : t > max ? max : t;
  }
}

// Whether `a ** b` or `a << b` would take more bits than a bigint JavaScript holds, 2^30.
function tooBig(op: string, a: bigint, b: bigint): boolean {
  const bits = BigInt((a < 0n ? -a : a).toString(2).length);
  if (op === "**") return a !== 0n && a !== 1n && a !== -1n && (bits - 1n) * b >= 1n << 30n;
  return a !== 0n && bits + b > 1n << 30n;
}

function isRecord(v: Ref<Value>): v is Record {
  return v !== null && typeof v === "object" && v.kind === "record";
}

function isItems(v: Ref<Value>): v is Items {
  return v !== null && typeof v === "object" && v.kind === "array";
}

function isTable(v: Ref<Value>): v is Table {
  return v !== null && typeof v === "object" && v.kind === "map";
}

function isMember(v: Ref<Value>): v is Member {
  return v !== null && typeof v === "object" && v.kind === "member";
}

function isVariant(v: Ref<Value>): v is Variant {
  return v !== null && typeof v === "object" && v.kind === "variant";
}

// A copy of a value owning all its parts, as reading a value out of where it lives hands one over;
// a quote's value keeps naming its entries in the quote tables, and a `Mut` its place.
function copyValue(v: Ref<Value>): Value {
  if (v === null || typeof v !== "object") return v;
  switch (v.kind) {
    case "record": {
      let fields = new Map<string, Value>();
      for (const [k, x] of v.fields) fields.set(k, copyValue(x));
      return { kind: "record", type: v.type, fields, quote: v.quote };
    }
    case "array":
      return { kind: "array", items: copyValues(v.items), quote: v.quote };
    case "variant":
      return { kind: "variant", type: v.type, args: copyValues(v.args) };
    case "interior":
      return { kind: "interior", value: copyValue(v.value) };
    case "map": {
      let entries = new Map<string, [Value, Value]>();
      for (const [k, e] of v.entries) entries.set(k, [copyValue(e[0]), copyValue(e[1])]);
      return { kind: "map", type: v.type, entries };
    }
    case "member":
      return { kind: "member", type: v.type, value: copyValue(v.value) };
    case "place":
      return copyPlace(v);
  }
}

function copyValues(vs: Ref<Value[]>): Value[] {
  let out: Value[] = [];
  for (const x of vs) out.push(copyValue(x));
  return out;
}

function copyPlace(p: Ref<Place>): Place {
  switch (p.of) {
    case "local":
      return { kind: "place", of: "local", frame: p.frame, local: p.local, path: copySteps(p.path) };
    case "temp":
      return { kind: "place", of: "temp", frame: p.frame, index: p.index, path: copySteps(p.path) };
    case "accessor":
      return { kind: "place", of: "accessor", self: copyPlace(p.self), name: p.name, getter: p.getter, setter: p.setter, at: { start: p.at.start, end: p.at.end } };
    case "char":
      return { kind: "place", of: "char", text: p.text, index: p.index, length: p.length, before: p.before, at: { start: p.at.start, end: p.at.end } };
  }
}

function copySteps(steps: Ref<Step[]>): Step[] {
  let out: Step[] = [];
  for (const s of steps) out.push(s.kind === "field" ? { kind: "field", name: s.name } : { kind: "element", index: s.index });
  return out;
}

// Marks a quote's value, a record or an array inside any union's tag, as entry `q` of the quote
// tables; false when it is neither.
function withQuote(v: Mut<Value>, q: usize): boolean {
  if (isMember(v)) return withQuote(v.value, q);
  if (isRecord(v) || isItems(v)) {
    v.quote = q;
    return true;
  }
  return false;
}

function isShort(v: Ref<Value | typeof SHORT>): v is typeof SHORT {
  return v !== null && typeof v === "object" && v.kind === "short";
}

function isPlace(v: Ref<Value | typeof SHORT>): v is Place {
  return v !== null && typeof v === "object" && v.kind === "place";
}

// The type a reference refers to, or the type itself.
function deref(typing: Ref<Typing>, t: Type | undefined): Type | undefined {
  if (t === undefined || typeof t === "string") return t;
  const r = typing.rec(t);
  return r.kind === "ref" ? r.to : t;
}

// A value without a union's tag, outside a run of the interpreter, which alone reads places.
function unwrap(v: Ref<Value>): Ref<Value> {
  assert(!isPlace(v), "internal error: a place was read outside a run of the interpreter");
  if (isMember(v)) return unwrap(v.value);
  return v;
}

// An owned value without a union's tag.
function unwrapped(v: Value): Value {
  assert(!isPlace(v), "internal error: a place was read outside a run of the interpreter");
  if (isMember(v)) return unwrapped(v.value);
  return v;
}

// Panics on an index outside a string or array of `length`, `before` counting a rest tuple's
// fixed elements in what the message says.
/** @throws {Stop} */
function checkedIndex(i: bigint, length: bigint, before: bigint, at: Ref<Span>) {
  if (i < 0n || i >= length) throw new Stop(`index out of bounds: the len is ${length + before} but the index is ${i + before}`, at, true);
}

function mutable(typing: Ref<Typing>, t: Type | undefined): boolean {
  if (t === undefined || typeof t === "string") return false;
  const r = typing.rec(t);
  return r.kind === "ref" && r.mutable;
}

// The kind of a type's record, for a type that has one.
function kindOf(typing: Ref<Typing>, t: Type | undefined): string | undefined {
  if (t === undefined || typeof t === "string") return undefined;
  return typing.rec(t).kind;
}

// A union's members, a copy the caller may hold while the typing changes.
function membersOf(typing: Ref<Typing>, t: Type): Type[] {
  if (typeof t === "string") return [];
  const r = typing.rec(t);
  if (r.kind !== "union") return [];
  let out: Type[] = [];
  for (const m of r.members) out.push(m);
  return out;
}

// A value of type `from` as one of type `to`: entering a union it is tagged with the member its
// type is, and a union's fields and elements are tagged the same way, so each is baked as the
// member the program would hold.
function retag(typing: Mut<Typing>, value: Value, from: Type | undefined, to: Type | undefined): Value {
  // A `Mut` held in a field stays the place it points at.
  if (isPlace(value)) return value;
  const toKind = kindOf(typing, to);
  if (to === undefined || from === to) return toKind === "union" ? value : unwrapped(value);
  if (toKind === "union") {
    const union = to as UnionType;
    const members = membersOf(typing, union);
    const tag = isMember(value) ? value.type : undefined;
    if (tag !== undefined && members.includes(tag)) return value;
    const v = unwrapped(value);
    const own = tag !== undefined ? tag : from;
    let member: Type;
    if (own !== undefined && members.includes(own)) member = own;
    else if (kindOf(typing, own) === "union") member = memberOf(typing, v, own as UnionType);
    else if (own !== undefined) {
      const fitting = typing.membersFor(own, union);
      member = fitting.length > 0 ? fitting[0]! : memberOf(typing, v, union);
    } else member = memberOf(typing, v, union);
    return { kind: "member", type: member, value: retag(typing, v, own, member) };
  }
  let v = unwrapped(value);
  if (isRecord(v) && (toKind === "object" || toKind === "class")) {
    let fields: { name: string; type: Type }[] = [];
    const r = typing.rec(to as Exclude<Type, string>);
    if (r.kind === "object" || r.kind === "class") for (const f of r.fields) fields.push({ name: f.name, type: f.type });
    // A field the value leaves out is an optional one, which is empty.
    for (const f of fields) {
      const held = v.fields.get(f.name);
      if (held === undefined && !v.fields.has(f.name)) {
        v.fields.set(f.name, retag(typing, null, "null", f.type));
        continue;
      }
      const had = typing.field(v.type, f.name);
      const was = had !== undefined ? had.type : undefined;
      v.fields.set(f.name, retag(typing, copyValue(held), was, f.type));
    }
  }
  if (isItems(v) && toKind === "array") {
    const element = elementOf(typing, from);
    const into = elementOf(typing, to);
    let items: Value[] = [];
    while (v.items.length > 0) items.push(retag(typing, v.items.shift() ?? null, element, into));
    v.items = items;
  }
  return v;
}

// An array type's element.
function elementOf(typing: Ref<Typing>, t: Type | undefined): Type | undefined {
  if (t === undefined || typeof t === "string") return undefined;
  const r = typing.rec(t);
  return r.kind === "array" ? r.element : undefined;
}

// A literal type as its base type, which `===` compares by.
function plainType(typing: Ref<Typing>, t: Type): Type {
  if (typeof t === "string" || typing.rec(t).kind !== "literal") return t;
  return typing.baseOf(t as LiteralType);
}

// The value an enum member's literal type stands for, or undefined for any other type.
function literalValue(typing: Ref<Typing>, type: Type | undefined): Value {
  if (type === undefined || typeof type === "string") return undefined;
  const r = typing.rec(type);
  return r.kind === "literal" && r.owner !== undefined ? r.value : undefined;
}

// Whether an expression names an enum rather than a value.
function enumName(e: Ref<Expr>): boolean {
  if (e.kind === "ident") return true;
  return e.kind === "member" && enumName(e.object);
}

function typeofValue(v: Ref<Value>): string {
  if (typeof v === "bigint" || typeof v === "number") return "number";
  if (v === null) return "undefined";
  if (typeof v === "object") return "object";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "string") return "string";
  return "undefined";
}

// A copy owning all its parts, as `.clone()` makes. A clone of a quote's record is another entry
// of the quote tables, keeping its bindings and free names for a quote it is spliced into.
function cloned(tables: Mut<Tables>, v: Ref<Value>): Value {
  if (v === null || typeof v !== "object" || v.kind === "interior") return copyValue(v);
  assert(v.kind !== "place", "internal error: a place was cloned outside a run of the interpreter");
  if (v.kind === "member") return { kind: "member", type: v.type, value: cloned(tables, v.value) };
  if (v.kind === "array") {
    let items: Value[] = [];
    for (const x of v.items) items.push(cloned(tables, x));
    return { kind: "array", items };
  }
  if (v.kind === "variant") {
    let args: Value[] = [];
    for (const x of v.args) args.push(cloned(tables, x));
    return { kind: "variant", type: v.type, args };
  }
  if (v.kind === "map") {
    let entries = new Map<string, [Value, Value]>();
    for (const [k, e] of v.entries) entries.set(k, [cloned(tables, e[0]), cloned(tables, e[1])]);
    return { kind: "map", type: v.type, entries };
  }
  let fields = new Map<string, Value>();
  for (const [k, x] of v.fields) fields.set(k, cloned(tables, x));
  if (v.quote === undefined) return { kind: "record", type: v.type, fields };
  const was = v.quote;
  const at = nextId(tables.quoteValues);
  const scope = tables.quoteScopes.get(was);
  if (scope !== undefined) tables.quoteScopes.set(at, new Map(scope));
  const free = tables.quoteFrees.get(was);
  if (free !== undefined) tables.quoteFrees.set(at, new Map(free));
  const spans = tables.quotedSpans.get(was);
  if (spans !== undefined) tables.quotedSpans.set(at, new Set(spans));
  return { kind: "record", type: v.type, fields, quote: at };
}

// What a thrown value is, for the compile error reporting it.
function described(typing: Ref<Typing>, value: Ref<Value>): string {
  const v = unwrap(value);
  if (isRecord(v)) {
    const held = v.fields.get("message");
    const message = held === undefined ? undefined : unwrap(held);
    const r = typing.rec(v.type);
    const name = r.kind === "class" ? r.name : "an object";
    return typeof message === "string" ? `${name}: ${message}` : name;
  }
  return display(v, undefined);
}

// An integer wrapped to its type's bits, as the machine holds it.
function wrap(v: bigint, type: Integer): bigint {
  const info = integerInfo(type);
  return info.signed ? BigInt.asIntN(info.bits, v) : BigInt.asUintN(info.bits, v);
}

function fit(v: f64, type: Type): f64 {
  return type === "f32" ? fround(v) : v;
}

// The f32 nearest a float, as Math.fround gives it.
function fround(v: f64): f64 {
  let held = new Float32Array(1);
  held[0] = v as f32;
  return held[0]! as f64;
}

// A bigint as the nearest float, read through its digits, which Fish and JavaScript both parse.
function toFloat(b: bigint): f64 {
  return Number(String(b))!;
}

// A bigint index as an array's or a string's index.
function toIndex(b: bigint): usize {
  return Number(String(b))! as usize;
}

// A float with no fraction as a bigint, halving it into a 64-bit integer first, which leaves its
// value exact as only its exponent changes.
function bigOf(v: f64): bigint {
  let x = v;
  let shift = 0n;
  while (x >= 4611686018427387904 || x <= -4611686018427387904) {
    x = x / 2;
    shift += 1n;
  }
  return BigInt(x as i64) << shift;
}

// An integer as the f32 nearest it, rounding once, ties to even.
function toF32(v: bigint): f64 {
  const magnitude = v < 0n ? -v : v;
  const bits = magnitude.toString(2).length;
  if (bits <= 24) return fround(toFloat(v));
  const shift = BigInt(bits - 24);
  let mantissa = magnitude >> shift;
  const rest = magnitude - (mantissa << shift);
  const half = 1n << (shift - 1n);
  if (rest > half || (rest === half && (mantissa & 1n) === 1n)) mantissa += 1n;
  const rounded = fround(toFloat(mantissa << shift));
  return v < 0n ? -rounded : rounded;
}

// A value as `String(x)` and templates write it; an f32 as the shortest decimal naming it.
function display(value: Ref<Value>, type: Type | undefined): string {
  const v = unwrap(value);
  if (typeof v === "number" && type === "f32") return shortestF32(v);
  if (typeof v === "number") return v === 0 ? "0" : String(v);
  if (v === null) return "null";
  if (typeof v === "bigint" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return v;
  if (typeof v === "object") return "[object Object]";
  return "undefined";
}

function shortestF32(v: f64): string {
  if (v === 0 || v - v !== 0) return v === 0 ? "0" : String(v);
  for (let digits: usize = 1; digits <= 9; digits++) {
    const near = Number(precision(v, digits))!;
    if (fround(near) === v) return String(near);
  }
  return String(v);
}

// A finite, nonzero float to `digits` significant digits, as `toPrecision` rounds it: exactly,
// halves away from zero, written as digits and a power of ten.
function precision(v: f64, digits: usize): string {
  let x = v < 0 ? -v : v;
  // `x` is `whole * 2^power` exactly.
  let power: i64 = 0;
  while (x !== Math.floor(x)) {
    x = x * 2;
    power -= 1;
  }
  let whole = bigOf(x);
  let exact = whole;
  let ten: i64 = 0;
  if (power < 0) {
    exact = whole * 5n ** BigInt(-power);
    ten = power;
  } else exact = whole << BigInt(power);
  const text = String(exact);
  if (text.length <= digits) return `${v < 0 ? "-" : ""}${text}e${ten}`;
  let head = BigInt(text.slice(0, digits as i64));
  if (text.charCodeAt(digits) >= 53) head += 1n;
  const scale = (text.length as i64) - (digits as i64) + ten;
  return `${v < 0 ? "-" : ""}${String(head)}e${scale}`;
}

// A count as English writes it, its digits grouped in threes.
function grouped(n: i64): string {
  const digits = String(n);
  let out = "";
  for (let i: usize = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
    out += digits[i]!;
  }
  return out;
}

// The member of a union a value is when nothing says: its own type for an aggregate, the
// literal member with its value, or the member of its kind.
export function memberOf(typing: Mut<Typing>, value: Ref<Value>, union: UnionType): Type {
  const m = membersOf(typing, union);
  if (isMember(value) && m.includes(value.type)) return value.type;
  const v = unwrap(value);
  if (v === null) return "null";
  if (isItems(v)) return firstOfKind(typing, m, "array");
  if (v !== null && typeof v === "object" && v.kind === "interior") return firstOfKind(typing, m, "interior");
  if (isTable(v)) return m.includes(v.type) ? v.type : firstOfKind(typing, m, "map");
  if (isRecord(v)) {
    if (m.includes(v.type)) return v.type;
    for (const t of m) if (typing.fits(v.type, t)) return t;
    assert(false, "internal error: a record no member of its union holds");
  }
  if (isVariant(v)) {
    if (m.includes(v.type)) return v.type;
    for (const t of m) if (typing.fits(v.type, t)) return t;
    assert(false, "internal error: a variant no member of its union holds");
  }
  for (const t of m) {
    if (typeof t === "string") continue;
    const r = typing.rec(t);
    if (r.kind === "literal" && r.value === v) return t;
  }
  if (typeof v === "bigint") {
    for (const t of m) if (isInteger(t)) return t;
    return "bigint";
  }
  if (typeof v === "number") {
    for (const t of m) if (isFloat(t)) return t;
  }
  if (typeof v === "string") return "string";
  return "boolean";
}

// The first of a union's members whose record is of `kind`.
function firstOfKind(typing: Ref<Typing>, members: Ref<Type[]>, kind: string): Type {
  for (const t of members) if (kindOf(typing, t) === kind) return t;
  assert(false, `internal error: a union with no ${kind} member holds one`);
}

// The number naming a quote's value in the quote tables, when it is one or a clone of one.
function quoteOf(v: Ref<Value>): usize | undefined {
  const u = unwrap(v);
  if (isRecord(u)) return u.quote;
  if (isItems(u)) return u.quote;
  return undefined;
}

// The value inside a union's tag, for baking.
export function untagged(v: Value): Value {
  return unwrapped(v);
}
