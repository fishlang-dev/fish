import assert from "node:assert";
import type { Instance } from "./check.ts";
import type { Body } from "./classes.ts";
import { bodyOf, type Arenas, type InstanceId, type LocalId } from "./arenas.ts";
import { CompileError } from "./diag.ts";
import { nextId } from "./ids.ts";
import { clonePattern, cloneStmts } from "./rebuild.ts";
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
const LONGEST: usize = 1 << 28;
const INFINITY: f64 = 1.0 / 0.0;

// What an optional link meeting an empty Option makes of the rest of its chain.
type Short = { kind: "short" };

function short(): Short {
  return { kind: "short" };
}

// std's crypto functions, which comptime refuses as it refuses Math.random.
const RANDOM = new Set(["getRandomValues", "randomBytes", "randomUUID"]);

// A panic, or a refusal, while compiling: where it happened, and what it says; `assertion`
// marks a false `assert`, which fails the build at the assert itself.
class Stop {
  message: string;
  at: Span;
  panic: boolean;
  assertion: boolean;
  constructor(message: string, at: Span, panic: boolean, assertion = false) {
    this.message = message;
    this.at = at;
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
  constructor(value: Value, at: Span) {
    this.value = value;
    this.at = at;
  }
}

// A call's locals, the temporaries its places name, and the place of its `this`.
// A node's span, as a panic or an error keeps it.
function span<S extends Span>(at: Ref<S>): Span {
  return { start: at.start, end: at.end };
}

type Frame = { instance: InstanceId; locals: Map<LocalId, Value>; temps: Map<usize, Value>; self: Place | undefined };


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
  const at = `${spanPart(v.fields.get("start"))}:${spanPart(v.fields.get("end"))}`;
  const name = v.fields.get("name");
  let fields = new Map<string, Value>();
  for (const [k, x] of v.fields) fields.set(k, renamed(spans, copyValue(x), from, to));
  if (spans.has(at) && typeof name === "string" && (kind === "ident" || kind === "ref" || kind === "variant")) {
    let parts = name.split(".");
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
      if (this.frees[i] === undefined) continue;
      for (const [name, spelling] of this.frees[i]!) {
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
    const named = identName(this.holes[i]!);
    if (named !== undefined) return named;
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
  return { instance, locals: known(tables, tables.arenas.instanceOf(instance)), temps: new Map<usize, Value>(), self: undefined };
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
    run.host.tables.constants.set(instance, copyValue(v));
    return v;
  } catch (e) {
    throw run.failure(e as Failure, site);
  } finally {
    run.finish();
  }
}

const constName = (arenas: Ref<Arenas>, c: InstanceId) => bodyOf(arenas, arenas.instanceOf(c)).name.slice("const ".length as i64);

// What comptime code may throw out of a run.
type Failure = CompileError | Stop | Return | Jump | Thrown;

class Interpreter<H extends ComptimeHost> {
  host: Mut<H>;
  // When the run started, for the compilation's timings.
  private started: Started;

  constructor(host: Mut<H>) {
    const started = timingStart(host.tables);
    this.host = host;
    this.started = started;
  }

  // Adds the run's time to the comptime stage's.
  finish(this: Mut<this>) {
    timingEnd(this.host.tables, "comptime", this.started);
  }

  // A panic, a refusal or an error comptime code didn't catch, as the compile error at the
  // comptime site that reports it, noting where inside it happened. A `return` or a jump never
  // leaves the function it is in.
  failure<S extends Span>(this: Mut<this>, e: Failure, site: Ref<S>): CompileError {
    if (e instanceof CompileError) return e;
    assert(!(e instanceof Return) && !(e instanceof Jump), "internal error: a return or a jump left comptime code");
    const stop = e instanceof Thrown ? new Stop(`this comptime code threw an error it didn't catch: ${described(this.host.tables.typing, e.value)}`, span(e.at), false) : e;
    const inside = stop.at.start !== site.start || stop.at.end !== site.end;
    if (stop.assertion) return new CompileError("E1101", stop.message, stop.at.start, stop.at.end, inside ? { message: "while running this comptime code", start: site.start, end: site.end } : undefined);
    const what = stop.panic ? `this comptime code panicked: ${stop.message}` : stop.message;
    return new CompileError("E1101", what, site.start, site.end, inside ? { message: stop.panic ? "it panicked here" : "here", start: stop.at.start, end: stop.at.end } : undefined);
  }

  // What `table` holds for `v`, when `v` is a quote's value or a clone of one.
  private quoteEntry<T>(table: Ref<Map<usize, T>>, v: Ref<Value>): T | undefined {
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
    const index = this.frames[f]!.temps.size;
    this.frames[f]!.temps.set(index, v);
    return { kind: "place", of: "temp", frame: f, index, path: [] };
  }

  // The place of a part of what a place holds; an accessor's value is its getter's copy, whose
  // parts a temporary holds.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private extend(this: Mut<this>, p: Ref<Place>, step: Step): Place {
    if (p.of === "local") return { kind: "place", of: "local", frame: p.frame, local: p.local, path: [...p.path, step] };
    if (p.of === "temp") return { kind: "place", of: "temp", frame: p.frame, index: p.index, path: [...p.path, step] };
    const v = this.read(p);
    const held = this.temp(this.frames.length - 1, v);
    return this.extend(held, step);
  }


  // A block's statements; the checker lets no `return`, `break` or `continue` leave it.
  /** @throws {CompileError | Jump | Return | Stop | Thrown} */
  block(this: Mut<this>, f: usize, body: Ref<Stmt[]>): Value {
    this.statements(f, body);
    return undefined;
  }

  // A const's value, computed once; one that reads itself never ends, so it is refused.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  constant<S extends Span>(this: Mut<this>, c: InstanceId, at: Ref<S>): Value {
    if (this.host.tables.constants.has(c)) return this.host.tables.constants.get(c);
    if (this.host.tables.computing.has(c)) {
      const computing = [...this.host.tables.computing];
      throw new Stop(`'${constName(this.host.tables.arenas, c)}' needs its own value to compute its value${this.cycle(computing.slice(computing.indexOf(c)))}`, span(at), false);
    }
    this.host.tables.computing.add(c);
    try {
      const v = this.call(c, [], undefined, at);
      this.host.tables.constants.set(c, copyValue(v));
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
    let distinct = new Set<string>();
    for (const x of files) distinct.add(x);
    const several = distinct.size > 1;
    let named: string[] = [];
    for (let i: usize = 0; i <= ring.length; i++) {
      const at = i === ring.length ? 0 : i;
      named.push(`'${constName(this.host.tables.arenas, ring[at]!)}'${several ? ` in '${files[at]!}'` : ""}`);
    }
    return `: ${named[0]!} reads ${named.slice(1).join(", which reads ")}`;
  }

  /** @throws {Stop} */
  private step<S extends Span>(this: Mut<this>, at: Ref<S>) {
    if (++this.steps > STEPS) throw new Stop(`this comptime code took more than ${grouped(STEPS)} steps; is there a loop that never ends?`, span(at), false);
  }

  // Code that reaches outside the program, or waits, which comptime never runs.
  /** @throws {Stop} */
  private refuse<S extends Span>(this: Mut<this>, what: string, at: Ref<S>): never {
    throw new Stop(`${what} can't run while compiling: comptime code only computes values`, span(at), false);
  }

  // A source of randomness, whose one value comptime would bake into every run.
  /** @throws {Stop} */
  private random<S extends Span>(this: Mut<this>, what: string, at: Ref<S>): never {
    throw new Stop(`${what} can't run while compiling; its value would be fixed into the program`, span(at), false);
  }

  // Pure code the interpreter doesn't run yet.
  /** @throws {Stop} */
  private unsupported<S extends Span>(this: Mut<this>, what: string, at: Ref<S>): never {
    throw new Stop(`${what} isn't supported in comptime code yet`, span(at), false);
  }

  /** @throws {Stop} */
  private panic<S extends Span>(this: Mut<this>, message: string, at: Ref<S>): never {
    throw new Stop(message, span(at), true);
  }

  // What a place holds, an accessor's read through its getter.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private read(this: Mut<this>, p: Ref<Place>): Value {
    if (p.of === "accessor") {
      if (p.getter !== undefined) return this.call(p.getter, [], copyPlace(p.self), p.at);
      const self = this.readValue(p.self);
      return isRecord(self) ? self.fields.get(p.name) : undefined;
    }
    if (p.of === "char") return p.text[toIndex(p.index)];
    const root = this.root(p);
    const followed = follow(root, p.path, 0);
    if (followed.kind === "value") return followed.value;
    let at = followed.place;
    for (const step of followed.rest) at = this.extend(at, copyStep(step));
    return this.read(at);
  }

  // What a local's or a temporary's place starts from.
  private root(p: Ref<Place>): Value {
    if (p.of === "local") return this.frames[p.frame]!.locals.get(p.local);
    if (p.of === "temp") return this.frames[p.frame]!.temps.get(p.index);
    return undefined;
  }

  // Writes `v` where a place is, an accessor's through its setter; `inner` keeps a union's tag
  // around what is there. A `Mut` met on the way is written through.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private write(this: Mut<this>, p: Ref<Place>, v: Value, inner = false): void {
    if (p.of === "accessor") {
      this.call(p.setter, [v], copyPlace(p.self), p.at);
      return;
    }
    if (p.of === "char") return this.unsupported("changing a string's character", p.at);
    const followed = follow(this.root(p), p.path, 0);
    if (followed.kind === "through" && followed.rest.length > 0) {
      let at = followed.place;
      for (const step of followed.rest) at = this.extend(at, copyStep(step));
      this.write(at, v, inner);
      return;
    }
    const next = placed(this.root(p), p.path, 0, v, inner);
    if (p.of === "local") this.frames[p.frame]!.locals.set(p.local, next);
    else this.frames[p.frame]!.temps.set(p.index, next);
  }


  // A value without a union's tag, read through a `Mut`'s place.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private unwrap(this: Mut<this>, v: Value): Value {
    if (isPlace(v)) {
      const read = this.read(v);
      return this.unwrap(read);
    }
    return isMember(v) ? this.unwrap(v.value) : v;
  }

  // An expression's value without its union's tag.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private valueOf(this: Mut<this>, f: usize, e: Ref<Expr>): Value {
    const v = this.expr(f, e);
    return this.unwrap(v);
  }

  // What a place holds, without its union's tag.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private readValue(this: Mut<this>, p: Ref<Place>): Value {
    const v = this.read(p);
    return this.unwrap(v);
  }

  private typeOf(f: usize, e: Ref<Expr>): Type {
    return this.inst(f).coercions.get(e) ?? this.inst(f).types.get(e)!;
  }

  // An instance's comparison through its class's `equals`, or nothing for other records.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private equals<S extends Span>(this: Mut<this>, a: Ref<Record>, b: Ref<Record>, at: Ref<S>): boolean | undefined {
    if (this.host.tables.typing.rec(a.type).kind !== "class") return undefined;
    const method = this.host.tables.equalities.get(a.type as ClassType);
    if (method === undefined) return undefined;
    const self = this.temp(this.frames.length - 1, copyValue(a));
    return this.call(method, [copyValue(b)], self, at) === true;
  }

  // Which member of its union a value is: its tag, or else the type it is written as, a literal
  // standing for its base type.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private memberType(this: Mut<this>, v: Ref<Value>, t: Type | undefined): Type | undefined {
    if (isPlace(v)) {
      const read = this.read(v);
      return this.memberType(read, t);
    }
    if (isMember(v)) return this.memberType(v.value, v.type);
    const own = deref(this.host.tables.typing, t);
    if (own === undefined || typeof own === "string") return own;
    const kind = this.host.tables.typing.rec(own).kind;
    if (kind === "union") return memberOf(this.host.tables.typing, v, own as UnionType);
    if (kind === "literal") return this.host.tables.typing.baseOf(own as LiteralType);
    return own;
  }

  // `===` on two values of the types they are written as: a union compares its member, then the
  // value it holds. Instances of a class with an `equals` compare through it when `at` is given,
  // as they do at run time.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private equal<S extends Span>(this: Mut<this>, a: Value, ta: Type | undefined, b: Value, tb: Type | undefined, at: Ref<S> | undefined): boolean {
    const ma = this.memberType(a, ta);
    const mb = this.memberType(b, tb);
    // A literal stands for its base type: members of two enums that share a value are equal, as
    // they are at run time.
    if (ma !== undefined && mb !== undefined && plainType(this.host.tables.typing, ma) !== plainType(this.host.tables.typing, mb)) return false;
    return this.same(a, b, at);
  }

  // Values compare as `===` compares them: primitives by value, variants by member and payload.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private same<S extends Span>(this: Mut<this>, x: Value, y: Value, at: Ref<S> | undefined): boolean {
    // Two members of a union are equal when they are the same member holding equal values.
    if (x !== null && y !== null && typeof x === "object" && typeof y === "object" && x.kind === "member" && y.kind === "member") {
      if (plainType(this.host.tables.typing, x.type) !== plainType(this.host.tables.typing, y.type)) return false;
    }
    const a = this.unwrap(x);
    const b = this.unwrap(y);
    if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && a.kind === "variant" && b.kind === "variant") {
      if (a.type !== b.type || a.args.length !== b.args.length) return false;
      for (let i: usize = 0; i < a.args.length; i++) if (!this.same(copyValue(a.args[i]!), copyValue(b.args[i]!), at)) return false;
      return true;
    }
    // Objects and arrays compare part by part.
    if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && a.kind === "record" && b.kind === "record") {
      const written = at === undefined ? undefined : this.equals(a, b, at);
      if (written !== undefined) return written;
      if (a.fields.size !== b.fields.size) return false;
      for (const [k, v] of a.fields) {
        if (!b.fields.has(k)) return false;
        if (!this.same(copyValue(v), copyValue(b.fields.get(k)), at)) return false;
      }
      return true;
    }
    if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && a.kind === "array" && b.kind === "array") {
      if (a.items.length !== b.items.length) return false;
      for (let i: usize = 0; i < a.items.length; i++) if (!this.same(copyValue(a.items[i]!), copyValue(b.items[i]!), at)) return false;
      return true;
    }
    return samePrimitive(a, b);
  }

  /** @throws {CompileError | Jump | Stop | Thrown} */
  call<S extends Span>(this: Mut<this>, callee: InstanceId, args: Value[], self: Place | undefined, at: Ref<S>): Value {
    if (++this.depth > DEPTH) throw new Stop(`this comptime code nests calls more than ${DEPTH} deep; is there a recursion that never ends?`, span(at), false);
    try {
      const body = this.body(callee);
      const name = body.name;
      const crypto = RANDOM.has(name) && stdModuleAt(this.host.tables.files, body.start) === "node:crypto";
      const isAsync = body.async === true;
      const generator = body.generator === true;
      const foreign = body.foreign === true;
      const rust = body.rust !== undefined;
      const js = body.js !== undefined ? body.js.module : undefined;
      if (crypto) this.random(`'crypto.${name}'`, at);
      if (isAsync) this.refuse("an async function", at);
      if (generator) this.unsupported("a generator", at);
      if (foreign) this.refuse(`the ${rust ? "Rust" : "C"} function '${name}'`, at);
      if (js !== undefined) this.refuse(`'${name}' from the package '${js}'`, at);
      if (!this.host.ensureChecked(callee)) throw new Stop(`this comptime code calls '${name}', which is still being checked, so it can't run yet; compute the value without it`, span(at), false);
      let frame: Frame = { instance: callee, locals: new Map<LocalId, Value>(), temps: new Map<usize, Value>(), self };
      let given = args;
      const params = this.body(callee).params;
      const instance = this.host.tables.arenas.instanceOf(callee);
      for (let i: usize = 0; i < params.length; i++) {
        const v: Value = given.length > 0 ? given.shift() ?? null : null;
        frame.locals.set(instance.locals.get(params[i]!)!, v);
      }
      // The body runs as a copy of it, as checking another function may change where it lives.
      const code = cloneStmts(this.body(callee).body);
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
  private statements(this: Mut<this>, f: usize, list: Ref<Stmt[]>): void {
    for (const s of list) this.statement(f, s);
  }

  /** @throws {CompileError | Jump | Return | Stop | Thrown} */
  private statement(this: Mut<this>, f: usize, s: Ref<Stmt>): void {
    this.step(s);
    switch (s.kind) {
      case "expr":
        this.expr(f, s.expr);
        return;
      case "let": {
        // The checker gives a declaration one name, its local keyed by the statement.
        const local = this.inst(f).locals.get(s);
        const d = s.declarations[0]!;
        if (local === undefined || s.declarations.length !== 1) return this.unsupported("destructuring", s);
        const v = d.init !== undefined ? this.expr(f, d.init) : undefined;
        this.frames[f]!.locals.set(local, v);
        return;
      }
      case "return":
        throw new Return(s.value !== undefined ? this.expr(f, s.value) : undefined);
      case "if":
        if (this.valueOf(f, s.cond) === true) this.statements(f, s.then);
        else if (s.else !== undefined) this.statements(f, s.else);
        return;
      case "block":
      case "comptime":
        this.statements(f, s.body);
        return;
      case "unsafe":
        return this.refuse("'unsafe' code", s);
      case "while":
        while (this.valueOf(f, s.cond) === true) if (!this.loopBody(f, s, s.body)) break;
        return;
      case "doWhile":
        do if (!this.loopBody(f, s, s.body)) break; while (this.valueOf(f, s.cond) === true);
        return;
      case "for":
        if (s.init) this.statement(f, s.init);
        while (s.test === undefined || this.valueOf(f, s.test) === true) {
          this.step(s);
          if (!this.loopBody(f, s, s.body)) break;
          if (s.update) this.expr(f, s.update);
        }
        return;
      case "forOf": {
        const over = this.valueOf(f, s.right);
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
        throw new Thrown(this.expr(f, s.value), span(s));
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
  private attempt(this: Mut<this>, f: usize, s: Ref<Extract<Stmt, { kind: "try" }>>): void {
    let left: Failure | undefined = undefined;
    try {
      this.statements(f, s.block);
    } catch (e) {
      const failed = e as Failure;
      if (failed instanceof Thrown && s.handler !== undefined) {
        const local = s.param !== undefined ? this.inst(f).locals.get(s) : undefined;
        if (local !== undefined) this.frames[f]!.locals.set(local, failed.value);
        try {
          this.statements(f, s.handler);
        } catch (again) {
          left = again as Failure;
        }
      } else left = failed;
    }
    // A panic skips the `finally`, as it does at run time, and so does an error compiling.
    if (left instanceof Stop || left instanceof CompileError) throw left;
    if (s.finalizer !== undefined) this.statements(f, s.finalizer);
    if (left !== undefined) throw left;
  }

  // Runs a loop's body once: false when a `break` leaves the loop.
  /** @throws {CompileError | Jump | Return | Stop | Thrown} */
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
  // gives short(), which ends the chain as an empty Option.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private link(this: Mut<this>, f: usize, e: Ref<Expr>, keep = false): Value | Short {
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
  private typed(this: Mut<this>, f: usize, e: Ref<Expr>, value: Value): Value {
    const own = this.inst(f).types.get(e);
    const target = this.inst(f).coercions.get(e) ?? own;
    if (isPlace(value) && mutable(this.host.tables.typing, target)) return value;
    const v = isPlace(value) ? this.read(value) : value;
    const to = deref(this.host.tables.typing, target);
    if (typeof v === "bigint" && to !== undefined && isFloat(to)) return fit(toFloat(v), to);
    const from = deref(this.host.tables.typing, own);
    return retag(this.host.tables.typing, v, from, to);
  }

  /** @throws {CompileError | Jump | Stop | Thrown} */
  private raw(this: Mut<this>, f: usize, e: Ref<Expr>): Value | Short {
    const type = this.inst(f).types.get(e)!;
    switch (e.kind) {
      case "int":
        return isFloat(type) ? fit(toFloat(e.value), type) : e.value;
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
          frees.push(inner === undefined ? undefined : copyNames(inner));
          const made = q === undefined ? undefined : this.host.tables.quotedSpans.get(q);
          within.push(made === undefined ? new Set<string>() : copyStrings(made));
        }
        let made: Value;
        try {
          made = built<Value>(this.host.tables, q, types, span(e), new AstValues(values, holeTypes, frees, within, e), scope, free);
        } catch (err) {
          if (err instanceof CompileError && err.code === "E1101") throw new Stop(err.message, span(e), false);
          throw err;
        }
        if (!quotable(made)) return made;
        const at = nextId(this.host.tables.quoteValues);
        made = withQuote(made, at);
        this.host.tables.quoteScopes.set(at, scope);
        this.host.tables.quoteFrees.set(at, free);
        this.host.tables.quotedSpans.set(at, spans);
        return made;
      }
      case "template": {
        let text = e.quasis.length > 0 ? e.quasis[0]! : "";
        for (let i: usize = 0; i < e.exprs.length; i++) {
          const x = e.exprs[i]!;
          const shown = this.expr(f, x);
          const after = i + 1 < e.quasis.length ? e.quasis[i + 1]! : "";
          text = this.joined(text, display(shown, this.typeOf(f, x)) + after, e);
        }
        return text;
      }
      case "ident": {
        const literal = literalValue(this.host.tables.typing, type);
        if (literal !== undefined && !this.inst(f).locals.has(e)) return literal;
        const read = this.calledAt(f, e);
        if (read !== undefined && this.body(read).comptime === "const") return this.constant(read, e);
        const local = this.inst(f).locals.get(e);
        if (local === undefined && e.name === "undefined") return null;
        if (local === undefined || !this.frames[f]!.locals.has(local)) throw new Stop(`'${e.name}' is only known when the program runs, so comptime code can't read it`, span(e), false);
        return this.frames[f]!.locals.get(local);
      }
      case "this": {
        if (this.frames[f]!.self === undefined) return this.unsupported("'this'", e);
        const self = copyPlace(this.frames[f]!.self!);
        return this.read(self);
      }
      case "comptime":
        return this.expr(f, e.expr);
      case "conditional":
        return this.valueOf(f, e.cond) === true ? this.expr(f, e.then) : this.expr(f, e.else);
      case "unary":
        return this.unary(f, e);
      case "binary":
        return this.binary(f, e);
      case "assign":
        return this.assign(f, e);
      case "update": {
        const at = this.place(f, e.operand);
        const old = numberOf(this.readValue(at));
        const one: bigint | f64 = typeof old === "bigint" ? 1n : 1.0;
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
            const shown = this.host.tables.typing.show(type);
            this.panic(`'as ${shown}' failed: union held another member`, e);
          }
          return retag(this.host.tables.typing, held, from, type);
        }
        return this.convert(this.valueOf(f, e.expr), type, e);
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
        const v = this.valueOf(f, e.expr);
        if (v === null) this.panic("called `Option::unwrap()` on a `None` value", e);
        return v;
      }
      case "object": {
        const fields = new Map<string, Value>();
        for (const p of e.props) {
          if (p.kind === "property" && typeof p.key === "string") fields.set(p.key, this.expr(f, p.value));
          else if (p.kind === "shorthand") {
            const local = this.inst(f).locals.get(p)!;
            if (!this.frames[f]!.locals.has(local)) throw new Stop(`'${p.name}' is only known when the program runs, so comptime code can't read it`, span(p), false);
            const held = this.frames[f]!.locals.get(local);
            fields.set(p.name, held);
          } else return this.unsupported("this property", p);
        }
        return { kind: "record", type: type as ObjectType, fields };
      }
      case "array":
        return { kind: "array", items: e.elements.flatMap((x) => (!x ? this.unsupported("a hole in an array", e) : x.kind === "spread" ? this.iterated(this.valueOf(f, x.value), x).map((v) => cloned(this.host.tables, v)) : [this.expr(f, x)])) };
      case "new":
        return this.construct(f, e, type);
      case "member":
        return this.member(f, e, type);
      case "index": {
        const object = this.link(f, e.object);
        if (isShort(object)) return short();
        return this.read(this.place(f, e, object));
      }
      case "call":
        return this.callExpr(f, e, type);
      case "match":
        return this.match(f, e);
      case "throw":
        throw new Thrown(this.expr(f, e.value), span(e));
      case "pipe":
        return this.unsupported("'|>'", e);
      default:
        return this.unsupported(`a '${e.kind}' expression`, e);
    }
  }

  /** @throws {CompileError | Jump | Stop | Thrown} */
  private construct(this: Mut<this>, f: usize, e: Ref<Extract<Expr, { kind: "new" }>>, type: Type): Value {
    const kind = kindOf(this.host.tables.typing, type);
    let which: string | undefined = undefined;
    let isSet = false;
    if (typeof type !== "string") {
      const r = this.host.tables.typing.rec(type);
      if (r.kind === "interior") which = r.which;
      if (r.kind === "map") isSet = r.set === true;
    }
    if (kind === "interior" && which !== "Cell" && e.args !== undefined && e.args.length === 1) return { kind: "interior", value: this.expr(f, e.args[0]!) };
    if (kind === "map") {
      let made: Table = { kind: "map", type: type as MapType, entries: new Map() };
      if (e.args !== undefined && e.args.length > 0) {
        const from = this.valueOf(f, e.args[0]!);
        if (from !== null && from !== undefined) {
          let items = this.iterated(from, e.args[0]!);
          while (items.length > 0) {
            const item: Value = items.shift() ?? null;
            if (isSet) this.put(made, item, undefined);
            else {
              const [k, v] = this.pair(item);
              this.put(made, k, v);
            }
          }
        }
      }
      return made;
    }
    if (kind !== "class") {
      const shown = this.host.tables.typing.show(type);
      return this.refuse(`'new ${shown}'`, e);
    }
    const ctor = this.calledAt(f, e)!;
    const classType = type as ClassType;
    let fields = new Map<string, Value>();
    const made: Value = { kind: "record", type: classType, fields };
    const self = this.temp(f, made);
    const args = e.args !== undefined ? this.args(f, ctor, e.args) : [];
    this.call(ctor, args, copyPlace(self), e);
    return this.read(self);
  }

  /** @throws {CompileError | Jump | Stop | Thrown} */
  private member(this: Mut<this>, f: usize, e: Ref<Extract<Expr, { kind: "member" }>>, type: Type): Value | Short {
    // An enum's member, as `Color.Red`, is known from its type alone.
    const literal = literalValue(this.host.tables.typing, type);
    if (literal !== undefined) return literal;
    const r = typeof type === "string" ? undefined : this.host.tables.typing.rec(type);
    if (r?.kind === "variant" && r.fields.length === 0 && enumName(e.object)) return { kind: "variant", type: type as VariantType, args: [] };
    const getter = this.calledAt(f, e);
    if (getter !== undefined) {
      const self = this.receiver(f, e.object);
      if (isShort(self)) return short();
      if (e.optional && this.readValue(self) === null) return short();
      return this.call(getter, [], self, e);
    }
    const linked = this.link(f, e.object);
    if (isShort(linked)) return short();
    const object = this.unwrap(linked);
    if (object === null && e.optional) return short();
    return this.memberValue(e, object);
  }

  // A member read from a value: a length, a size, or a field.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private memberValue(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>, object: Value): Value {
    if (e.name === "length" && typeof object === "string") return BigInt(object.length);
    if (isItems(object) && e.name === "length") return BigInt(object.items.length);
    if (isTable(object) && e.name === "size") return BigInt(object.entries.size);
    if (isRecord(object) && this.host.tables.typing.isTuple(object.type) && e.name === "length") return this.tupleLength(object);
    if (isRecord(object)) return object.fields.get(e.name);
    return this.unsupported(`reading '${e.name}' here`, e);
  }

  // A tuple's length, as at run time: its required elements, up to the last optional one there,
  // then its rest.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private tupleLength(this: Mut<this>, t: Ref<Record>): bigint {
    const type = t.type as ObjectType;
    const count = this.host.tables.typing.elementsOf(type).length;
    let length = this.host.tables.typing.rec(type).required ?? count;
    for (let i = length; i < count; i++) if (this.unwrap(t.fields.get(String(i))!) !== null) length = i + 1;
    const rest = t.fields.get("...");
    return BigInt(length + (isItems(rest) ? rest.items.length : 0));
  }

  /** @throws {CompileError | Jump | Stop | Thrown} */
  private callExpr(this: Mut<this>, f: usize, e: Ref<Extract<Expr, { kind: "call" }>>, type: Type): Value | Short {
    const callee = e.callee;
    if (callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "console") this.refuse("printing", e);
    if (this.host.tables.clocks.get(e) === "Math.random") this.random("'Math.random'", e);
    // A data-carrying enum's member, as `Shape.Circle(2)`.
    const r = typeof type === "string" ? undefined : this.host.tables.typing.rec(type);
    if (r?.kind === "variant" && callee.kind === "member" && enumName(callee.object)) {
      return { kind: "variant", type: type as VariantType, args: e.args.map((a) => this.expr(f, a)) };
    }
    if (this.host.tables.asserts.has(e)) {
      if (this.expr(f, e.args[0]!) === true) return undefined;
      const said = e.args.length > 1 ? display(this.valueOf(f, e.args[1]!), undefined) : `assertion failed: ${this.host.tables.asserts.get(e) ?? ""}`;
      throw new Stop(said, span(e), true, true);
    }
    const target = this.calledAt(f, e);
    if (target !== undefined && (callee.kind === "super" || (callee.kind === "member" && callee.object.kind === "super"))) {
      const args = this.args(f, target, e.args);
      const self = this.frames[f]!.self === undefined ? undefined : copyPlace(this.frames[f]!.self!);
      return this.call(target, args, self, e);
    }
    if (target !== undefined && callee.kind === "member" && this.body(target).self !== undefined) {
      const self = this.receiver(f, callee.object);
      if (isShort(self)) return short();
      if ((callee.optional || e.optional) && this.readValue(self) === null) return short();
      return this.call(target, this.args(f, target, e.args), self, e);
    }
    if (target !== undefined) return this.call(target, this.args(f, target, e.args), undefined, e);
    if (callee.kind === "ident" && callee.name === "String" && e.args.length === 1) return display(this.expr(f, e.args[0]!), this.typeOf(f, e.args[0]!));
    // `String.fromCharCode` and `String.fromCodePoint`, their arguments gathered into one array.
    const built = this.host.tables.stringBuilds.get(e);
    if (built !== undefined) {
      const list = this.valueOf(f, e.args[0]!);
      let codes: f64[] = [];
      if (isItems(list)) for (const x of list.items) codes.push(toFloat(bigOfValue(x)));
      let text = "";
      if (built === "units") {
        for (const c of codes) text += String.fromCharCode(c as u16);
        return text;
      }
      for (const c of codes) if (c > 0x10ffff) this.panic(`invalid code point ${c}`, e);
      for (const c of codes) text += String.fromCodePoint(c as u32);
      return text;
    }
    // A static call on something that isn't a value, like `TcpListener.bind`, is std's own.
    if (callee.kind === "member" && !this.inst(f).types.has(callee.object)) return this.refuse(`'${callee.name}'`, e);
    if (callee.kind === "member") {
      const self = this.receiver(f, callee.object);
      if (isShort(self)) return short();
      const held = this.readValue(self);
      if (held === null && (callee.optional || e.optional)) return short();
      if (this.host.tables.integerCalls.has(e)) return this.integerValue(callee.name, held as bigint, e.args[0] ? (this.valueOf(f, e.args[0]) as bigint) : 0n, this.host.tables.typing.lower(this.typeOf(f, callee.object)) as Integer, type, e);
      if (typeof held === "string") return this.stringMethod(callee.name, held, e.args.map((a) => this.valueOf(f, a)), e);
      if (callee.name === "clone") return cloned(this.host.tables, held);
      if (isItems(held)) {
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
      if (isTable(held)) return this.tableMethod(f, callee.name, self, held, e);
      return this.unsupported(`calling '${callee.name}' here`, e);
    }
    return this.refuse(`'${this.host.tables.timerNames.get(e) ?? (callee.kind === "ident" ? callee.name : "this call")}'`, e);
  }

  // A Map's or a Set's method, on the table `self` holds; `get` and the arrays of entries hand
  // out clones, as at run time, and `set` and `add` hand back the table's place, to chain.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private tableMethod(this: Mut<this>, f: usize, name: string, self: Place, table: Table, e: Ref<Extract<Expr, { kind: "call" }>>): Value {
    let args: Value[] = [];
    for (const a of e.args) args.push(this.expr(f, a));
    const isSet = this.host.tables.typing.rec(table.type).set === true;
    let held = table;
    switch (name) {
      case "set":
      case "add": {
        const k: Value = args.shift();
        const v: Value = args.shift();
        this.put(held, k, v);
        this.write(self, held, true);
        return self;
      }
      case "get": {
        const found = held.entries.get(this.keyName(args.length > 0 ? args[0]! : null));
        return found !== undefined ? cloned(this.host.tables, found[1]) : null;
      }
      case "has":
        return held.entries.has(this.keyName(args.length > 0 ? args[0]! : null));
      case "delete": {
        const had = held.entries.delete(this.keyName(args.length > 0 ? args[0]! : null));
        this.write(self, held, true);
        return had;
      }
      case "clear":
        held.entries.clear();
        this.write(self, held, true);
        return undefined;
      case "keys":
      case "values":
      case "entries": {
        let listed = this.iterated(held, e);
        if (name === "entries" || isSet) return { kind: "array", items: listed };
        let items: Value[] = [];
        while (listed.length > 0) {
          const x: Value = listed.shift() ?? null;
          items.push(isRecord(x) ? copyValue(x.fields.get(name === "keys" ? "0" : "1")) : x);
        }
        return { kind: "array", items };
      }
      default:
        return this.unsupported(`calling '${name}' on a ${isSet ? "Set" : "Map"}`, e);
    }
  }

  // Puts a key and its value in a table: a key already there keeps its place, as JavaScript's does.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private put(this: Mut<this>, table: Mut<Table>, k: Value, v: Value) {
    const name = this.keyName(k);
    const was = table.entries.get(name);
    // As at run time, a float key of -0 is kept as 0.
    const key: Value = was !== undefined ? copyValue(was[0]) : this.keyValue(k);
    const entry: [Value, Value] = [key, v];
    table.entries.set(name, entry);
  }

  // A key as a table keeps it: as at run time, a float key of -0 is kept as 0.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private keyValue(this: Mut<this>, k: Value): Value {
    const v = this.unwrap(copyValue(k));
    return v === 0 ? 0 : k;
  }

  // The string a key is compared by, which for a float is SameValueZero's: `String` names every
  // NaN alike and -0 as 0.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private keyName(this: Mut<this>, k: Ref<Value>): string {
    if (isPlace(k)) {
      const read = this.read(k);
      return this.keyName(read);
    }
    if (isMember(k)) return this.keyName(payload(k));
    const v = k;
    if (typeof v === "string") return `s${v}`;
    if (typeof v === "bigint") return `i${v.toString()}`;
    return typeof v === "number" ? `i${String(v)}` : "i";
  }

  // A Map's entry as the pair of its key and value.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private pair(this: Mut<this>, item: Value): [Value, Value] {
    const v = this.unwrap(item);
    if (isItems(v)) return [copyValue(v.items[0]!), copyValue(v.items[1]!)];
    if (isRecord(v)) return [copyValue(v.fields.get("0")), copyValue(v.fields.get("1"))];
    assert(false, "internal error: a Map's entry that isn't a pair");
    return [null, null];
  }

  // What looping over a value visits: a string's characters, an array's elements, a Set's
  // members, or a Map's entries as pairs of clones. A dictionary's entries come in the order
  // JavaScript gives an object's keys: integer keys first, from smallest.
  /** @throws {Stop} */
  private iterated<S extends Span>(this: Mut<this>, over: Value, at: Ref<S>): Value[] {
    if (typeof over === "string") {
      let chars: Value[] = [];
      for (const c of over) chars.push(c);
      return chars;
    }
    if (isItems(over)) return over.items;
    if (!isTable(over)) return this.unsupported("looping over this", at);
    const r = this.host.tables.typing.rec(over.type);
    const dict = r.dict === true;
    const isSet = r.set === true;
    const keyType = r.key;
    const valueType = r.value;
    let entries: [Value, Value][] = [];
    for (const entry of over.entries.values()) entries.push([copyValue(entry[0]), copyValue(entry[1])]);
    if (dict) {
      // JavaScript's order of an object's keys: integer keys first, from smallest.
      let numbered: { at: f64; entry: [Value, Value] }[] = [];
      let rest: [Value, Value][] = [];
      while (entries.length > 0) {
        const entry = entries.shift()!;
        const index = integerKey(entry[0]);
        if (index !== undefined) numbered.push({ at: index, entry });
        else rest.push(entry);
      }
      numbered.sort((a, b) => a.at - b.at);
      while (numbered.length > 0) entries.push(numbered.shift()!.entry);
      while (rest.length > 0) entries.push(rest.shift()!);
    }
    let out: Value[] = [];
    if (isSet) {
      for (const entry of entries) out.push(cloned(this.host.tables, entry[0]));
      return out;
    }
    const tuple = this.host.tables.typing.tupleType([keyType, valueType]);
    for (const entry of entries) {
      let fields = new Map<string, Value>();
      fields.set("0", cloned(this.host.tables, entry[0]));
      fields.set("1", cloned(this.host.tables, entry[1]));
      out.push({ kind: "record", type: tuple, fields });
    }
    return out;
  }

  /** @throws {Stop} */
  private stringMethod<S extends Span>(this: Mut<this>, name: string, s: string, args: Ref<Value[]>, at: Ref<S>): Value {
    const more = args.length > 1;
    switch (name) {
      case "charCodeAt": {
        const i = bigArg(args, 0);
        if (i < 0n || i >= BigInt(s.length)) this.panic(`index out of bounds: the len is ${s.length} but the index is ${i}`, at);
        return BigInt(s.charCodeAt(toIndex(i)));
      }
      case "indexOf":
        return BigInt(more ? s.indexOf(textArg(args, 0), intArg(args, 1)) : s.indexOf(textArg(args, 0)));
      case "replaceAll":
        return s.replaceAll(textArg(args, 0), textArg(args, 1));
      case "concat": {
        let out = s;
        for (let i: usize = 0; i < args.length; i++) out = out + textArg(args, i);
        return out;
      }
      case "lastIndexOf":
        return BigInt(more ? s.lastIndexOf(textArg(args, 0), intArg(args, 1)) : s.lastIndexOf(textArg(args, 0)));
      case "at": {
        const c = s.at(intArg(args, 0));
        return c === undefined ? null : c;
      }
      case "charAt":
        return s.charAt(intArg(args, 0));
      case "codePointAt": {
        const point = s.codePointAt(intArg(args, 0) as usize);
        return point === undefined ? null : BigInt(point);
      }
      case "includes":
        return more ? s.includes(textArg(args, 0), intArg(args, 1)) : s.includes(textArg(args, 0));
      case "startsWith":
        return more ? s.startsWith(textArg(args, 0), intArg(args, 1)) : s.startsWith(textArg(args, 0));
      case "endsWith":
        return more ? s.endsWith(textArg(args, 0), intArg(args, 1)) : s.endsWith(textArg(args, 0));
      case "split": {
        let items: Value[] = [];
        if (args.length === 0 || args[0] === null) items.push(s);
        else for (const part of more ? s.split(textArg(args, 0), intArg(args, 1) as usize) : s.split(textArg(args, 0))) items.push(part);
        return { kind: "array", items };
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
        return s.replace(textArg(args, 0), textArg(args, 1));
      case "padStart": {
        const width = Math.max(0, Math.min(intArg(args, 0), (LONGEST as i64) + 1)) as usize;
        return this.joined("", more ? s.padStart(width, textArg(args, 1)) : s.padStart(width), at);
      }
      case "padEnd": {
        const width = Math.max(0, Math.min(intArg(args, 0), (LONGEST as i64) + 1)) as usize;
        return this.joined("", more ? s.padEnd(width, textArg(args, 1)) : s.padEnd(width), at);
      }
      case "repeat": {
        const count = bigArg(args, 0);
        if (count < 0n) this.panic("Invalid count value: " + count.toString(), at);
        if (BigInt(s.length) * count > BigInt(LONGEST)) this.tooLong(at);
        return s.repeat(intArg(args, 0));
      }
      case "slice":
        return more ? s.slice(intArg(args, 0), intArg(args, 1)) : s.slice(intArg(args, 0));
      case "substring":
        return more ? s.substring(intArg(args, 0), intArg(args, 1)) : s.substring(intArg(args, 0));
      default:
        return this.unsupported(`the string method '${name}'`, at);
    }
  }


  /** @throws {Stop} */
  private tooLong<S extends Span>(this: Mut<this>, at: Ref<S>): never {
    throw new Stop(`this comptime code made a string longer than ${grouped(LONGEST as i64)} characters`, span(at), false);
  }

  // Two strings joined, within the longest string comptime makes.
  /** @throws {Stop} */
  private joined<S extends Span>(this: Mut<this>, a: string, b: string, at: Ref<S>): string {
    if (a.length + b.length > LONGEST) this.tooLong(at);
    return a + b;
  }

  /** @throws {CompileError | Jump | Stop | Thrown} */
  private unary(this: Mut<this>, f: usize, e: Ref<Extract<Expr, { kind: "unary" }>>): Value {
    if (e.op === "await") this.refuse("'await'", e);
    let held = this.expr(f, e.operand);
    while (isPlace(held)) held = this.read(held);
    if (e.op === "typeof") {
      const from = this.typeOf(f, e.operand);
      const member = kindOf(this.host.tables.typing, from) === "union" ? memberOf(this.host.tables.typing, held, from as UnionType) : from;
      if (member === "bigint") return "bigint";
      return typeofValue(held);
    }
    const v = this.unwrap(held);
    const type = this.negatedIn(this.typeOf(f, e));
    if (e.op === "!") return v !== true;
    if (type === "bigint") return e.op === "-" ? -bigOfValue(v) : e.op === "~" ? ~bigOfValue(v) : this.unsupported(`'${e.op}'`, e);
    if (e.op === "-") return typeof v === "number" ? fit(-v, type) : this.checked(-bigOfValue(v), type as Integer, "negate", e);
    if (e.op === "~") return wrap(~bigOfValue(v), type as Integer);
    return this.unsupported(`'${e.op}'`, e);
  }

  // The type a unary operator works in: a literal's base type, as for a union of literals, which
  // `as const` gives a negative literal.
  private negatedIn(this: Mut<this>, given: Type): Type {
    if (typeof given === "string") return given;
    const r = this.host.tables.typing.rec(given);
    if (r.kind === "literal") return this.host.tables.typing.baseOf(given as LiteralType);
    if (r.kind !== "union" || r.members.length === 0) return given;
    for (const m of r.members) if (kindOf(this.host.tables.typing, m) !== "literal") return given;
    return this.host.tables.typing.baseOf(r.members[0]! as LiteralType);
  }

  /** @throws {CompileError | Jump | Stop | Thrown} */
  private binary(this: Mut<this>, f: usize, e: Ref<Extract<Expr, { kind: "binary" }>>): Value {
    if (e.op === "&&") return this.valueOf(f, e.left) === true ? this.expr(f, e.right) : false;
    if (e.op === "||") return this.valueOf(f, e.left) === true ? true : this.expr(f, e.right);
    if (e.op === "??") {
      const v = this.expr(f, e.left);
      return this.isNull(v) ? this.expr(f, e.right) : v;
    }
    if (e.op === "in") {
      const v = this.valueOf(f, e.right);
      if (!isRecord(v)) return false;
      const key = e.left.kind === "string" ? e.left.value : "";
      // A literal's record may carry its own type rather than the member's, so a field it holds answers.
      const tests = this.host.tables.keyTests.get(e);
      const said = tests === undefined ? undefined : tests.get(v.type);
      if (said === "yes" || said === "no") return said === "yes";
      const held = v.fields.get(key);
      return held !== undefined && !this.isNull(held);
    }
    if (e.op === "instanceof") {
      const v = this.valueOf(f, e.left);
      return isRecord(v) && this.host.tables.typing.isSubclass(v.type, this.inst(f).types.get(e.right)!);
    }
    const a = this.expr(f, e.left);
    const b = this.expr(f, e.right);
    switch (e.op) {
      case "===":
        return this.equal(a, this.inst(f).types.get(e.left), b, this.inst(f).types.get(e.right), e);
      case "!==":
        return !this.equal(a, this.inst(f).types.get(e.left), b, this.inst(f).types.get(e.right), e);
      case "<":
      case "<=":
      case ">":
      case ">=": {
        const x = this.unwrap(a);
        const y = this.unwrap(b);
        return compared(e.op, x, y);
      }
    }
    const x = this.unwrap(a);
    const y = this.unwrap(b);
    if (e.op === "+" && (typeof x === "string" || typeof y === "string")) return this.joined(display(x, this.typeOf(f, e.left)), display(y, this.typeOf(f, e.right)), e);
    return this.numeric(e.op, numberOf(x), numberOf(y), this.typeOf(f, e), e);
  }

  // Whether a value is an empty Option, through any place and union tag it is in.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private isNull(this: Mut<this>, v: Ref<Value>): boolean {
    if (isPlace(v)) {
      const read = this.read(v);
      return this.isNull(read);
    }
    if (isMember(v)) return this.isNull(v.value);
    return v === null || v === undefined;
  }

  // The place is found first, then the value; a compound assignment reads the place once.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private assign(this: Mut<this>, f: usize, e: Ref<Extract<Expr, { kind: "assign" }>>): Value {
    const at = this.place(f, e.target);
    if (e.op === "=") {
      const v = this.expr(f, e.value);
      this.write(at, copyValue(v));
      return v;
    }
    const op = e.op.slice(0, -1);
    const old = this.read(at);
    if (op === "&&" || op === "||" || op === "??") {
      const keep = op === "??" ? !this.isNull(old) : (this.unwrap(copyValue(old)) === true) === (op === "||");
      if (keep) return old;
      const v = this.expr(f, e.value);
      this.write(at, copyValue(v));
      return v;
    }
    const x = this.unwrap(old);
    const y = this.valueOf(f, e.value);
    const v = op === "+" && typeof x === "string" ? this.joined(x, display(y, this.typeOf(f, e.value)), e) : this.numeric(op, numberOf(x), numberOf(y), this.typeOf(f, e.target), e);
    this.write(at, copyValue(v));
    return v;
  }

  // Where an expression's value lives: a variable, a `Mut` parameter's place, an object's field,
  // or an array's element, its index read once.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private place(this: Mut<this>, f: usize, target: Ref<Expr>, object?: Value): Place {
    if (target.kind === "nonNull" && redundantBang(target)) return this.place(f, target.expr, object);
    if (target.kind === "this") {
      if (this.frames[f]!.self === undefined) return this.unsupported("'this'", target);
      return copyPlace(this.frames[f]!.self!);
    }
    if (target.kind === "ident") {
      const local = this.inst(f).locals.get(target);
      if (local === undefined || !this.frames[f]!.locals.has(local)) throw new Stop(`'${target.name}' is only known when the program runs, so comptime code can't use it here`, span(target), false);
      const held = this.frames[f]!.locals.get(local);
      if (isPlace(held)) return held;
      return { kind: "place", of: "local", frame: f, local, path: [] };
    }
    if (target.kind === "member" && this.inst(f).setters.has(target)) {
      const self = this.holder(f, target.object);
      const getter = this.calledAt(f, target);
      return { kind: "place", of: "accessor", self, name: target.name, getter, setter: this.inst(f).setters.get(target)!, at: span(target) };
    }
    if (target.kind === "member") {
      const base = this.holder(f, target.object);
      const holder = this.readValue(base);
      if (isRecord(holder)) {
        const held = holder.fields.get(target.name);
        if (isPlace(held)) return held;
        return this.extend(base, { kind: "field", name: target.name });
      }
      // A part of a value that isn't an object's, like an array's length, which is only read.
      if (typeof holder === "string" || isItems(holder) || isTable(holder)) return this.temp(f, this.memberValue(target, holder));
    }
    if (target.kind === "index") {
      const base = object === undefined ? this.holder(f, target.object) : isPlace(object) ? object : this.temp(f, object);
      const held = this.readValue(base);
      const i = bigOfValue(this.valueOf(f, target.index));
      const length = typeof held === "string" ? held.length : isItems(held) ? held.items.length : this.unsupported("indexing this", target);
      // A rest tuple's array is named as the tuple, its fixed elements counted in.
      const before = BigInt(this.host.tables.restStarts.get(target.object) ?? 0);
      // The bounds are checked where the place is taken, as a borrow of an element checks them.
      checkedIndex(i, BigInt(length), before, target);
      if (typeof held === "string") return { kind: "place", of: "char", text: held, index: i, length: BigInt(length), before, at: span(target) };
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
  private receiver(this: Mut<this>, f: usize, e: Ref<Expr>): Place | Short {
    if (this.placeable(f, e)) return this.place(f, e);
    const v = this.link(f, e, true);
    if (isShort(v)) return short();
    return isPlace(v) ? v : this.temp(f, v);
  }

  // Where the value a member or an index is read from lives.
  /** @throws {CompileError | Jump | Stop | Thrown} */
  private holder(this: Mut<this>, f: usize, e: Ref<Expr>): Place {
    const p = this.receiver(f, e);
    if (!isShort(p)) return p;
    const empty = this.typed(f, e, null);
    return this.temp(f, empty);
  }

  /** @throws {CompileError | Jump | Stop | Thrown} */
  private match(this: Mut<this>, f: usize, e: Ref<Extract<Expr, { kind: "match" }>>): Value {
    const subject = this.expr(f, e.subject);
    for (const arm of e.arms) {
      if (!this.tests(f, arm.pattern, copyValue(subject))) continue;
      this.bind(f, arm.pattern, copyValue(subject));
      if (arm.guard !== undefined && this.valueOf(f, arm.guard) !== true) continue;
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
    const kind = this.inst(f).patterns.get(p)!.kind;
    if (kind === "any") return true;
    if (kind === "or") {
      const alternatives = this.subPatterns(f, p);
      for (const alt of alternatives) if (this.tests(f, alt, copyValue(value))) return true;
      return false;
    }
    const tag = isMember(value) ? value.type : undefined;
    const v = this.unwrap(value);
    const info = this.inst(f).patterns.get(p)!;
    const t = info.type;
    const union = typeof t !== "string" && this.host.tables.typing.rec(t).kind === "union";
    switch (info.kind) {
      case "literal": {
        const member = info.member;
        if (member !== undefined) {
          const named = literalValue(this.host.tables.typing, member);
          const lit: Value = named !== undefined ? named : this.host.tables.typing.rec(member).value;
          return this.same<Span>(v, lit, undefined);
        }
        if (p.kind !== "literal") return false;
        const written = this.expr(f, p.value);
        return this.same<Span>(v, written, undefined);
      }
      case "none":
        return v === null;
      case "some": {
        const arg = clonePattern(info.arg);
        return v !== null && this.tests(f, arg, v);
      }
      case "variant": {
        const variant = info.variant;
        const args = this.subPatterns(f, p);
        if (!isVariant(v) || (union && v.type !== variant)) return false;
        for (let i: usize = 0; i < args.length; i++) if (!this.tests(f, args[i]!, i < v.args.length ? copyValue(v.args[i]!) : undefined)) return false;
        return true;
      }
      case "object": {
        let shapes: Type[] = [];
        for (const s of info.shapes) shapes.push(s);
        let keys: string[] = [];
        for (const field of info.fields) keys.push(field[0]);
        const subs = this.subPatterns(f, p);
        if (!isRecord(v) || (union && !shapes.includes(tag !== undefined ? tag : v.type))) return false;
        for (let i: usize = 0; i < keys.length; i++) if (!this.tests(f, subs[i]!, copyValue(v.fields.get(keys[i]!)))) return false;
        return true;
      }
      case "array": {
        const items = this.subPatterns(f, p);
        if (!isItems(v) || v.items.length !== items.length) return false;
        for (let i: usize = 0; i < items.length; i++) if (!this.tests(f, items[i]!, copyValue(v.items[i]!))) return false;
        return true;
      }
    }
    return true;
  }

  // The patterns inside a pattern, in the order its information lists them: a variant's
  // arguments, an object's fields, an array's elements, an Option's value or the alternatives.
  private subPatterns(this: Mut<this>, f: usize, p: Ref<Pattern>): Pattern[] {
    const info = this.inst(f).patterns.get(p)!;
    let out: Pattern[] = [];
    if (info.kind === "variant") for (const a of info.args) out.push(clonePattern(a));
    if (info.kind === "object") for (const field of info.fields) out.push(clonePattern(field[1]));
    if (info.kind === "array") for (const a of info.items) out.push(clonePattern(a));
    if (info.kind === "or") for (const a of info.alternatives) out.push(clonePattern(a));
    if (info.kind === "some") out.push(clonePattern(info.arg));
    return out;
  }

  /** @throws {CompileError | Jump | Stop | Thrown} */
  private bind(this: Mut<this>, f: usize, p: Ref<Pattern>, value: Value): void {
    const info = this.inst(f).patterns.get(p)!;
    const kind = info.kind;
    let keys: string[] = [];
    if (info.kind === "object") for (const field of info.fields) keys.push(field[0]);
    if (kind === "any") {
      if (p.kind !== "ident") return;
      const local = this.inst(f).locals.getById(p.id)!;
      this.frames[f]!.locals.set(local, value);
      return;
    }
    const subs = this.subPatterns(f, p);
    const v = this.unwrap(value);
    if (kind === "some") {
      this.bind(f, subs[0]!, v);
      return;
    }
    if (kind === "variant" && isVariant(v)) for (let i: usize = 0; i < subs.length; i++) this.bind(f, subs[i]!, i < v.args.length ? copyValue(v.args[i]!) : undefined);
    if (kind === "object" && isRecord(v)) for (let i: usize = 0; i < subs.length; i++) this.bind(f, subs[i]!, copyValue(v.fields.get(keys[i]!)));
    if (kind === "array" && isItems(v)) for (let i: usize = 0; i < subs.length; i++) this.bind(f, subs[i]!, i < v.items.length ? copyValue(v.items[i]!) : undefined);
  }

  // An arithmetic or bitwise operator on numbers of `type`, panicking where the program would.
  // A bigint's operators as JavaScript has them, panicking where it throws a RangeError.
  /** @throws {Stop} */
  private bigNumeric<S extends Span>(this: Mut<this>, op: string, a: bigint, b: bigint, at: Ref<S>): Value {
    if ((op === "/" || op === "%") && b === 0n) this.panic("Division by zero", at);
    if (op === "**" && b < 0n) this.panic("Exponent must be non-negative", at);
    if ((op === "**" || op === "<<") && tooBig(op, a, b)) throw new Stop("this comptime code made a value too large to hold while compiling", span(at), false);
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
  private numeric<S extends Span>(this: Mut<this>, op: string, a: bigint | f64, b: bigint | f64, type: Type, at: Ref<S>): Value {
    if (typeof a === "number" || typeof b === "number") {
      const x = floatOfValue(a);
      const y = floatOfValue(b);
      const v = op === "+" ? x + y : op === "-" ? x - y : op === "*" ? x * y : op === "/" ? x / y : op === "%" ? x % y : op === "**" ? x ** y : undefined;
      if (v === undefined) return this.unsupported(`'${op}' on floats`, at);
      return fit(v, type as "f32" | "f64");
    }
    if (type === "bigint") return this.bigNumeric(op, a as bigint, b as bigint, at);
    if (!isInteger(type)) {
      const shown = this.host.tables.typing.show(type);
      return this.unsupported(`'${op}' on '${shown}'`, at);
    }
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
          if ((exponent & 1n) !== 0n) result = this.checked(result * base, type, "multiply", at);
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
        const amount = unsigned(b, bits);
        if (amount > BigInt(bits - 1)) this.panic(`attempt to shift ${op === "<<" ? "left" : "right"} with overflow`, at);
        if (op === "<<") return wrap(a << amount, type);
        return op === ">>" && signed ? a >> amount : wrap(unsigned(a, bits) >> amount, type);
      }
    }
    return this.unsupported(`'${op}'`, at);
  }

  // `x.checkedAdd(y)` and its kin, as the program computes them: the exact result, then null,
  // the wrapped value, the nearest bound, or the wrapped value and whether it overflowed.
  /** @throws {Stop} */
  private integerValue<S extends Span>(this: Mut<this>, name: string, a: bigint, b: bigint, type: Integer, result: Type, at: Ref<S>): Value {
    const [family, operation] = integerMethod(name)!;
    const { bits, signed } = integerInfo(type);
    const [min, max] = range(type);
    let exact: bigint;
    let over: boolean | undefined = undefined;
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
        let past = false;
        while (exponent > 0n) {
          this.step(at);
          if ((exponent & 1n) !== 0n) {
            if (wrap(power * base, type) !== power * base) past = true;
            power = wrap(power * base, type);
          }
          exponent >>= 1n;
          if (exponent > 0n) {
            if (wrap(base * base, type) !== base * base) past = true;
            base = wrap(base * base, type);
          }
        }
        over = past;
        // A negative base to an odd power is past MIN.
        if (family === "saturating" && over) return a < 0n && (b & 1n) === 1n ? min : max;
        exact = power;
      }
    }
    if (over === undefined) over = wrap(exact, type) !== exact;
    const wrapped = wrap(exact, type);
    if (family === "checked") return over ? null : wrapped;
    if (family === "wrapping") return wrapped;
    if (family === "saturating") return !over ? wrapped : exact < min ? min : max;
    let fields = new Map<string, Value>();
    fields.set("0", wrapped);
    fields.set("1", over);
    return { kind: "record", type: result as ObjectType, fields };
  }

  // Comptime checks overflow in every build: a value that would wrap in a release build is a
  // compile error rather than a different number baked.
  /** @throws {Stop} */
  private checked<S extends Span>(this: Mut<this>, v: bigint, type: Integer, verb: string, at: Ref<S>): bigint {
    if (wrap(v, type) !== v) this.panic(`attempt to ${verb} with overflow`, at);
    return v;
  }

  // `x as T` between numbers, as Rust's `as` converts: integers wrap, floats truncate and saturate.
  /** @throws {Stop} */
  private convert<S extends Span>(this: Mut<this>, given: Value, to: Type, at: Ref<S>): Value {
    const v: Value = typeof given === "boolean" ? (given ? 1n : 0n) : given;
    if (isFloat(to)) return typeof v === "bigint" && to === "f32" ? toF32(v) : fit(floatOfValue(v), to);
    if (!isInteger(to)) return v;
    if (typeof v === "bigint") return wrap(v, to);
    if (typeof v !== "number") return this.unsupported(`converting this with 'as'`, at);
    if (v !== v) return 0n;
    const { bits, signed } = integerInfo(to);
    const min = signed ? -(1n << BigInt(bits - 1)) : 0n;
    const max = signed ? (1n << BigInt(bits - 1)) - 1n : (1n << BigInt(bits)) - 1n;
    if (v === INFINITY) return max;
    if (v === -INFINITY) return min;
    const t = bigOf(Math.trunc(v));
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

// A node's start or end, as a quote's spans name it.
function spanPart(v: Ref<Value>): string {
  return typeof v === "bigint" ? v.toString() : "";
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
      let t: Table = { kind: "map", type: v.type, entries: new Map() };
      for (const [k, e] of v.entries) t.entries.set(k, [copyValue(e[0]), copyValue(e[1])]);
      return t;
    }
    case "member":
      return { kind: "member", type: v.type, value: copyValue(v.value) };
    case "place":
      return copyPlace(v);
  }
  return null;
}

function copyNames(names: Ref<Free>): Free {
  let out: Free = new Map<string, string>();
  for (const [k, v] of names) out.set(k, v);
  return out;
}

function copyStrings(strings: Ref<Set<string>>): Set<string> {
  let out = new Set<string>();
  for (const x of strings) out.add(x);
  return out;
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
  assert(false, "internal error: a place of no kind");
  return { kind: "place", of: "temp", frame: 0, index: 0, path: [] };
}

function copySteps(steps: Ref<Step[]>): Step[] {
  let out: Step[] = [];
  for (const s of steps) out.push(s.kind === "field" ? { kind: "field", name: s.name } : { kind: "element", index: s.index });
  return out;
}

// A quote's value, a record or an array inside any union's tag, marked as entry `q` of the
// quote tables.
function withQuote(v: Value, q: usize): Value {
  if (isMember(v)) return { kind: "member", type: v.type, value: withQuote(v.value, q) };
  if (isRecord(v)) return { kind: "record", type: v.type, fields: v.fields, quote: q };
  if (isItems(v)) return { kind: "array", items: v.items, quote: q };
  return v;
}

// Whether a value is a record or an array, inside any union's tag, which a quote marks.
function quotable(v: Ref<Value>): boolean {
  if (isMember(v)) return quotable(payload(v));
  return isRecord(v) || isItems(v);
}

// `<`, `<=`, `>` or `>=` on two values, as JavaScript compares numbers and strings.
function compared(op: string, a: Ref<Value>, b: Ref<Value>): boolean {
  if (typeof a === "string" && typeof b === "string") return op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : a >= b;
  if (typeof a === "bigint" && typeof b === "bigint") return op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : a >= b;
  const x = floatOfValue(a);
  const y = floatOfValue(b);
  return op === "<" ? x < y : op === "<=" ? x <= y : op === ">" ? x > y : x >= y;
}

// A number a value holds, as an operator takes it.
function numberOf(v: Ref<Value>): bigint | f64 {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return v;
  return 0;
}

function floatOfValue(v: Ref<Value>): f64 {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return toFloat(v);
  return 0.0 / 0.0;
}

function bigOfValue(v: Ref<Value>): bigint {
  return typeof v === "bigint" ? v : 0n;
}

// A dictionary key that is an integer index, which JavaScript lists first.
function integerKey(k: Ref<Value>): f64 | undefined {
  if (typeof k !== "string" || !/^(0|[1-9]\d*)$/.test(k)) return undefined;
  const n = Number(k)!;
  return n < 4294967295 ? n : undefined;
}

// What is at the end of `path` in `v`, or a `Mut` met on the way with the steps left after it.
type Followed = { kind: "value"; value: Value } | { kind: "through"; place: Place; rest: Step[] };

function follow(v: Value, path: Ref<Step[]>, i: usize): Followed {
  if (i === path.length) return { kind: "value", value: v };
  if (isPlace(v)) {
    let rest: Step[] = [];
    for (let j = i; j < path.length; j++) rest.push(copyStep(path[j]!));
    return { kind: "through", place: v, rest };
  }
  if (isMember(v)) return follow(v.value, path, i);
  const step = copyStep(path[i]!);
  if (step.kind === "field") return follow(isRecord(v) ? v.fields.get(step.name) : undefined, path, i + 1);
  const at = toIndex(step.index);
  return follow(isItems(v) && at < v.items.length ? copyValue(v.items[at]!) : undefined, path, i + 1);
}

// `held` with `v` put at the end of `path`. A union's tag is kept on the way, and at the end
// too when `inner`, as when a call changes the value inside it.
function placed(held: Value, path: Ref<Step[]>, i: usize, v: Value, inner: boolean): Value {
  if (isMember(held) && (i < path.length || inner)) return { kind: "member", type: held.type, value: placed(held.value, path, i, v, inner) };
  if (i === path.length) return v;
  const step = copyStep(path[i]!);
  const last = i + 1 === path.length && !inner;
  if (step.kind === "field" && isRecord(held)) {
    if (last) held.fields.set(step.name, v);
    else held.fields.set(step.name, placed(held.fields.get(step.name), path, i + 1, v, inner));
    return held;
  }
  if (step.kind === "element" && isItems(held)) {
    const at = toIndex(step.index);
    if (last) held.items[at] = v;
    else held.items[at] = placed(copyValue(held.items[at]!), path, i + 1, v, inner);
    return held;
  }
  return held;
}

function copyStep(s: Ref<Step>): Step {
  return s.kind === "field" ? { kind: "field", name: s.name } : { kind: "element", index: s.index };
}

// An argument a string method is given: an integer, as an index or count, or a string.
function bigArg(args: Ref<Value[]>, i: usize): bigint {
  return i < args.length ? bigOfValue(args[i]!) : 0n;
}

function intArg(args: Ref<Value[]>, i: usize): i64 {
  return Number(bigArg(args, i).toString())! as i64;
}

function textArg(args: Ref<Value[]>, i: usize): string {
  if (i >= args.length) return "undefined";
  const v = copyValue(args[i]!);
  return typeof v === "string" ? v : "undefined";
}

// `===` on two values that are neither records, arrays nor variants: equal primitives; a table or
// an interior is never `===` another value, as at run time.
function samePrimitive(a: Ref<Value>, b: Ref<Value>): boolean {
  if (typeof a === "bigint" && typeof b === "bigint") return a === b;
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (typeof a === "string" && typeof b === "string") return a === b;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b;
  if (a === null || a === undefined) return b === null || b === undefined ? a === b : false;
  return false;
}

// `b` as an unsigned integer of `bits` bits.
function unsigned(b: bigint, bits: usize): bigint {
  const size = 1n << BigInt(bits);
  const r = b % size;
  return r < 0n ? r + size : r;
}

// The name an identifier's record gives, through any union's tag.
function identName(v: Ref<Value>): Value | undefined {
  if (isMember(v)) return identName(payload(v));
  if (isRecord(v) && v.fields.get("kind") === "ident") return copyValue(v.fields.get("name"));
  return undefined;
}

// The string a value is, through any union's tag.
function textOf(v: Ref<Value>): string | undefined {
  if (isMember(v)) return textOf(payload(v));
  return typeof v === "string" ? v : undefined;
}

function isShort(v: Ref<Value | Short>): v is Short {
  return v !== null && typeof v === "object" && v.kind === "short";
}

function isPlace(v: Ref<Value | Short>): v is Place {
  return v !== null && typeof v === "object" && v.kind === "place";
}

// The type a reference refers to, or the type itself.
function deref(typing: Ref<Typing>, t: Type | undefined): Type | undefined {
  if (t === undefined || typeof t === "string") return t;
  const r = typing.rec(t);
  return r.kind === "ref" ? r.to : t;
}

// What a union's tag holds.
function payload(m: Ref<Member>): Ref<Value> {
  return m.value;
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
function checkedIndex<S extends Span>(i: bigint, length: bigint, before: bigint, at: Ref<S>) {
  if (i < 0n || i >= length) throw new Stop(`index out of bounds: the len is ${length + before} but the index is ${i + before}`, span(at), true);
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
  if (isMember(v)) return typeofValue(payload(v));
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
    let t: Table = { kind: "map", type: v.type, entries: new Map() };
    for (const [k, e] of v.entries) t.entries.set(k, [cloned(tables, e[0]), cloned(tables, e[1])]);
    return t;
  }
  let fields = new Map<string, Value>();
  for (const [k, x] of v.fields) fields.set(k, cloned(tables, x));
  if (v.quote === undefined) return { kind: "record", type: v.type, fields };
  const was = v.quote;
  const at = nextId(tables.quoteValues);
  const scope = tables.quoteScopes.get(was);
  if (scope !== undefined) tables.quoteScopes.set(at, copyNames(scope));
  const free = tables.quoteFrees.get(was);
  if (free !== undefined) tables.quoteFrees.set(at, copyNames(free));
  const spans = tables.quotedSpans.get(was);
  if (spans !== undefined) tables.quotedSpans.set(at, copyStrings(spans));
  return { kind: "record", type: v.type, fields, quote: at };
}

// What a thrown value is, for the compile error reporting it.
function described(typing: Ref<Typing>, value: Ref<Value>): string {
  if (isMember(value)) return described(typing, payload(value));
  const v = value;
  if (isRecord(v)) {
    const r = typing.rec(v.type);
    const name = r.kind === "class" ? r.name : "an object";
    const held = v.fields.get("message");
    if (held === undefined) return name;
    const message = textOf(held);
    return message !== undefined ? `${name}: ${message}` : name;
  }
  return display(v, undefined);
}

// An integer wrapped to its type's bits, as the machine holds it.
function wrap(v: bigint, type: Integer): bigint {
  const info = integerInfo(type);
  const size = 1n << BigInt(info.bits);
  let r = v % size;
  if (r < 0n) r += size;
  return info.signed && r >= size >> 1n ? r - size : r;
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
  return Number(b.toString())!;
}

// A bigint index as an array's or a string's index.
function toIndex(b: bigint): usize {
  return Number(b.toString())! as usize;
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
  if (isMember(value)) return display(payload(value), type);
  const v = value;
  if (typeof v === "number" && type === "f32") return shortestF32(v);
  if (typeof v === "number") return v === 0 ? "0" : String(v);
  if (v === null) return "null";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return v ? "true" : "false";
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
  const text = exact.toString();
  if (text.length <= digits) return `${v < 0 ? "-" : ""}${text}e${ten}`;
  let head = digitsValue(text.slice(0, digits as i64));
  if (text.charCodeAt(digits) >= 53) head += 1n;
  const scale = (text.length as i64) - (digits as i64) + ten;
  return `${v < 0 ? "-" : ""}${String(head)}e${scale}`;
}

// A string of decimal digits as a bigint.
function digitsValue(text: string): bigint {
  let n = 0n;
  for (let i: usize = 0; i < text.length; i++) n = n * 10n + BigInt(text.charCodeAt(i) - 48);
  return n;
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
  if (isMember(value)) return memberOf(typing, payload(value), union);
  const v = value;
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
  return "never";
}

// The number naming a quote's value in the quote tables, when it is one or a clone of one.
function quoteOf(v: Ref<Value>): usize | undefined {
  if (isMember(v)) return quoteOf(payload(v));
  if (isRecord(v)) return v.quote;
  if (isItems(v)) return v.quote;
  return undefined;
}

// The value inside a union's tag, for baking.
export function untagged(v: Value): Value {
  return unwrapped(v);
}
