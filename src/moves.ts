import type { Tables } from "./compilation.ts";
import assert from "node:assert";
import { bodyOf, type Arenas, type InstanceId, type LocalId } from "./arenas.ts";
import type { Instance, Local, Origin } from "./check.ts";
import type { Body } from "./classes.ts";
import { CompileError } from "./diag.ts";
import type { Declarator, Expr, ObjectProp, Param, Pattern, Span, Stmt } from "./parser.ts";
import { bindings } from "./match.ts";
import { rustClassOf } from "./rust.ts";
import { indexText, MAP_CHANGES, restSuffix } from "./values.ts";
import { holdsNode } from "./check.ts";
import { EMBEDDED, redundantBang, type ObjectType, type RefType, type Type, type Typing, type UnionType } from "./typing.ts";
import { nextId } from "./nodes.ts";
import type { Id } from "./ids.ts";

// Moves and borrows: a value that isn't Copy has one owner, so passing, assigning, storing or
// returning it hands it over, and the place it came from can't be used until it is assigned
// again. A place lent to a reference can't change or move while the reference may still be
// used, and one lent mutably can't be used at all. This walks a checked body in evaluation
// order, tracking which places have moved and which are lent.

// Where a place moved, the note explaining it, and the pass of each loop it moved on. A place
// is a local's id, or `this`, followed by a field path, like `3.inner.x`.
// A variable declared without a value is moved from the start, `unassigned`.
type Move = { start: usize; end: usize; note: string; passes: Map<usize, usize>; unassigned?: boolean };

/** @throws {CompileError} */
type MoveStep = () => void;

// A place lent to references: shared or mutable, where it was lent, and who holds it, the
// reference variables or, for an argument or receiver, the call it was lent to.
// A `for...of` loop lends its array for as long as it runs, as a call lends for its duration.
type Loan = { place: string; mutable: boolean; start: usize; end: usize; holders: Set<LocalId>; call?: string; callAt?: usize; loop?: boolean; guard?: boolean };

// The places moved, and the loans made, on the way here, or null where control can't reach.
// Loans are keyed by where they were made.
type State = { moves: Map<string, Move>; loans: Map<f64, Loan> } | null;

// How a consuming use hands a value over: the note saying so, with PLACE where the place goes,
// as it reads.
type Consumer = string;
const PLACE = "\u0001";

// What names a place: a variable, `this`, a field, or a shorthand property naming a variable.
type Named = Expr | Extract<ObjectProp, { kind: "shorthand" }>;

// What an access does to a place.
type Access = "read" | "change" | "move" | "lend" | "lend mutably";

// What a nested function a call calls captures: lent for the call, and changed by it when
// `changes`, under its own key.
type CallCapture = { alias: LocalId; changes: boolean; key: f64 };

// Where a place is used, and how the source names it there, for a message about it.
type Spot = { start: usize; end: usize; shown: string };
// A place an expression lends a reference to, where, and whether mutably.
type Part = { place: string; at: Spot; mutable: boolean };
// A place a closure captures, where it first uses it, the variable, if not `this`, whether it
// changes it, and whether it holds it rather than borrowing it.
type Capture = { place: string; at: Spot; from?: LocalId; mutable: boolean; held: boolean };

// What keeps the references a target is given: `this`, or a variable holding references.
type Keeper = { self: boolean; owner?: LocalId };

// The array methods that change their array.
const ARRAY_CHANGES = new Set(["push", "pop", "sort", "shift", "unshift", "splice", "reverse", "fill", "copyWithin", "reserve", "shrinkToFit"]);
// Where the ids of the checker's own locals start: a loop's holder from here by where the loop
// starts, a holder gathering what it will hold from twice this by its own id, and `this`'s
// holder at three times this, above any variable's id.
const SYNTHETIC: usize = 1_000_000_000_000;
// A last use after every other, for what stays held to the end of the body.
const FOREVER: f64 = 1e300;
// The place a temporary or a copy stands for: a reference into one can't be returned.
const TEMPORARY = "temporary";

// A way out of a try that passes through its finally, and what the times it was taken had in
// common.
// A jump names its target by id and span.
type Exit = { kind: "raise" | "return" | "jump"; target?: Site; which?: "break" | "continue"; acc: State };
// A catch gathers the states raises reach it in; a finally, spanning its try, the ways out
// through it.
type Frame = { kind: "catch" | "finally"; acc: State; start: usize; end: usize; exits: Exit[] };
type Site = { id: usize; start: usize; end: usize };


/** @throws {CompileError} */
export function checkMoves<T extends Tables, B extends Body, I extends Instance>(tables: Mut<T>, f: Ref<B>, instance: Ref<I>, origins: Origin[]): { captures: Set<LocalId>; consumes: Set<usize>; keeps: boolean } {
  let cx = new MoveCx<T, B, I>(tables, f, instance);
  let checker = new MoveChecker<T, B, I>(cx, origins);
  checker.run(cx);
  return { captures: checker.movedOut, consumes: checker.consumed, keeps: checker.keepsInThis };
}

// Generic over its tables, body and instance, since a parameter of an object type stands for
// any type fitting it, and a field holding a mutable reference needs the exact type.
// What the move checker reads and lends from: the compilation's tables, and the body and
// instance it checks.
class MoveCx<T extends Tables, B extends Body, I extends Instance> {
  tables: Mut<T>;
  f: Ref<B>;
  instance: Ref<I>;

  constructor(tables: Mut<T>, f: Ref<B>, instance: Ref<I>) {
    this.tables = tables;
    this.f = f;
    this.instance = instance;
  }
}

// The move checker's own state, kept apart from what it reads, which its methods are given, so a
// method can be passed a reference to one of its caller's values.
class MoveChecker<T extends Tables, B extends Body, I extends Instance> {
  origins: Origin[];
  // A place put into a `Ref<T> | null` is lent to the reference the Option holds.
  coercions: Map<usize, Type>;
  state: State = { moves: new Map<string, Move>(), loans: new Map<f64, Loan>() };
  // The states `break` leaves to each statement, and `continue` takes back to each loop.
  exits = new Map<usize, State>();
  // The catches and finallies enclosing the code being checked, innermost last: what the ways
  // into each had in common, and for a finally, its try and which ways out pass through it.
  frames: Frame[] = [];
  nexts = new Map<usize, State>();
  // The guards running now, by where each starts: a guard's loan lasts only while it runs, even
  // in a state an error carried out of it.
  guarding = new Set<usize>();
  // What each `for...of` over an array reached through a reference holds while it runs.
  loopHolders = new Map<usize, LocalId>();
  // How each match arm's block hands on what its `return`s give, as its match does.
  arms = new Map<usize, [Consumer | undefined, boolean]>();
  // The pass each enclosing loop is on.
  passes = new Map<usize, usize>();
  last: Map<LocalId, f64>;
  byId = new Map<usize, LocalId>();
  // What `this` keeps stays held to the end of the body, and after it.
  kept: LocalId;
  // The captures of this closure that a closure made in it moves into itself, and the places
  // whose values are moved out, by node id.
  movedOut = new Set<LocalId>();
  consumed = new Set<usize>();
  // Whether the body stores a value holding references into `this`.
  keepsInThis = false;

  constructor(cx: Mut<MoveCx<T, B, I>>, origins: Origin[]) {
    const instance = cx.instance;
    let coercions = new Map<usize, Type>();
    for (const [e, to] of instance.coercions) {
      const ref = cx.tables.typing.optionRef(to);
      const from = instance.types.get(e);
      const fromRef = from !== undefined && typeof from !== "string" && cx.tables.typing.rec(from).kind === "ref";
      let given: Type = to;
      if (ref !== undefined && from !== undefined && from !== "null" && cx.tables.typing.optionRef(from) === undefined && !fromRef) given = ref;
      coercions.set(e.id, given);
    }
    const f = cx.f;
    let last = lastUses(cx.tables, f.body, instance);
    const kept = cx.tables.arenas.addLocal({ name: "this", type: "void", mutable: false, param: false, id: SYNTHETIC * 3 }).localId;
    last.set(kept, FOREVER);
    this.origins = origins;
    this.coercions = coercions;
    this.last = last;
    this.kept = kept;
    for (const l of instance.locals.values()) this.byId.set(cx.tables.arenas.localOf(l).id, l);
  }

  /** @throws {CompileError} */
  run(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>): void {
    // A reference parameter holds a borrow its caller made, of something outside this function.
    const f = cx.f;
    for (let i: usize = 0; i < f.params.length; i++) {
      const p: Ref<Param> = f.params[i]!;
      const id = this.localAt(cx, p);
      if (id === undefined) continue;
      const type = cx.tables.arenas.localOf(id).type;
      if (!cx.tables.typing.holdsRef(type) || this.state === null) continue;
      const mutable = this.isRef(cx, type) && cx.tables.typing.rec(type).mutable;
      this.state.loans.set(-1 - (i as f64), { place: `param ${i}`, mutable, start: p.start, end: p.end, holders: new Set([id]) });
    }
    this.statements(cx, f.body);
  }

  // The variable at the root of a place.
  rootLocal(cx: Mut<MoveCx<T, B, I>>, e: Ref<Named>): LocalId | undefined {
    if (projection(cx.tables.typing, cx.instance, this.coercions, e) && (e.kind === "nonNull" || e.kind === "as" || e.kind === "satisfies" || e.kind === "unsafe")) return this.rootLocal(cx, e.expr);
    if (e.kind === "member" || e.kind === "index") return this.rootLocal(cx, e.object);
    return cx.instance.locals.getById(e.id);
  }

  // Whether `this` is at the root of a place.
  rootIsThis(cx: Mut<MoveCx<T, B, I>>, e: Ref<Named>): boolean {
    if (projection(cx.tables.typing, cx.instance, this.coercions, e) && (e.kind === "nonNull" || e.kind === "as" || e.kind === "satisfies" || e.kind === "unsafe")) return this.rootIsThis(cx, e.expr);
    if (e.kind === "member" || e.kind === "index") return this.rootIsThis(cx, e.object);
    return e.kind === "this" || e.kind === "super";
  }

  // The place at the root of a place, and where it is named.
  rootPlace(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Named>): { place: string | undefined; at: Spot } {
    if (projection(cx.tables.typing, cx.instance, this.coercions, e) && (e.kind === "nonNull" || e.kind === "as" || e.kind === "satisfies" || e.kind === "unsafe")) return this.rootPlace(cx, e.expr);
    if (e.kind === "member" || e.kind === "index") return this.rootPlace(cx, e.object);
    return { place: this.key(cx, e), at: this.spot(cx, e) };
  }

  // Whether a value, through its projections, is one JS gives anew at each use.
  copiedOut(cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>): boolean {
    if (projection(cx.tables.typing, cx.instance, this.coercions, e) && (e.kind === "nonNull" || e.kind === "as" || e.kind === "satisfies" || e.kind === "unsafe")) return this.copiedOut(cx, e.expr);
    return cx.instance.copiesOut.has(e);
  }

  // `fromCall` of the place a value a call gave is read from, through its fields, elements and
  // projections; and `hold` and `lentInto` of it.
  fromCallProjected(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>): boolean {
    if (unwraps(cx.tables.typing, cx.instance, this.coercions, e) && (e.kind === "nonNull" || e.kind === "as" || e.kind === "satisfies" || e.kind === "unsafe")) return this.fromCallProjected(cx, e.expr);
    if ((e.kind === "member" && !cx.instance.calls.has(e)) || e.kind === "index") return this.fromCallProjected(cx, e.object);
    if (e.kind === "nonNull" || e.kind === "as") return this.fromCallProjected(cx, e.expr);
    return this.fromCall(cx, e);
  }

  /** @throws {CompileError} */
  holdProjected(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, holder: LocalId, e: Ref<Expr>): void {
    if (unwraps(cx.tables.typing, cx.instance, this.coercions, e) && (e.kind === "nonNull" || e.kind === "as" || e.kind === "satisfies" || e.kind === "unsafe")) {
      this.holdProjected(cx, holder, e.expr);
      return;
    }
    if ((e.kind === "member" && !cx.instance.calls.has(e)) || e.kind === "index") {
      this.holdProjected(cx, holder, e.object);
      return;
    }
    if (e.kind === "nonNull" || e.kind === "as") {
      this.holdProjected(cx, holder, e.expr);
      return;
    }
    this.hold(cx, holder, e);
  }

  lentProjected(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>, out: Mut<Part[]>): void {
    if (unwraps(cx.tables.typing, cx.instance, this.coercions, e) && (e.kind === "nonNull" || e.kind === "as" || e.kind === "satisfies" || e.kind === "unsafe")) {
      this.lentProjected(cx, e.expr, out);
      return;
    }
    if ((e.kind === "member" && !cx.instance.calls.has(e)) || e.kind === "index") {
      this.lentProjected(cx, e.object, out);
      return;
    }
    if (e.kind === "nonNull" || e.kind === "as") {
      this.lentProjected(cx, e.expr, out);
      return;
    }
    this.lentInto(cx, e, out);
  }

  // The local a name, declaration, parameter or shorthand property refers to.
  localAt(cx: Ref<MoveCx<T, B, I>>, n: Ref<Id>): LocalId | undefined {
    return cx.instance.locals.getById(n.id);
  }
  isRef(cx: Ref<MoveCx<T, B, I>>, t: Type): t is RefType {
    return typeof t !== "string" && cx.tables.typing.rec(t).kind === "ref";
  }
  isUnion(cx: Ref<MoveCx<T, B, I>>, t: Type): t is UnionType {
    return typeof t !== "string" && cx.tables.typing.rec(t).kind === "union";
  }
  // What a reference refers to, or the type itself.
  deref(cx: Ref<MoveCx<T, B, I>>, t: Type): Type {
    return this.isRef(cx, t) ? cx.tables.typing.rec(t).to : t;
  }
  // The record of a type that isn't a primitive.
  record(cx: Ref<MoveCx<T, B, I>>, t: Type | undefined) {
    return t === undefined || typeof t === "string" ? undefined : cx.tables.typing.rec(t);
  }

  // The reference variables declared anywhere inside a statement.
  inside(cx: Ref<MoveCx<T, B, I>>, s: Ref<Stmt>): LocalId[] {
    let out: LocalId[] = [];
    this.declaredIn(cx, s, out, true);
    return out;
  }

  // The variables declared anywhere inside a statement, or only the reference ones, added to
  // `out`. A catch's parameter counts unless only references do.
  declaredIn(cx: Ref<MoveCx<T, B, I>>, s: Ref<Stmt>, out: Mut<LocalId[]>, refs: boolean): void {
    switch (s.kind) {
      case "let": {
        const id = this.localAt(cx, s)!;
        if (!refs || cx.tables.typing.holdsRef(cx.tables.arenas.localOf(id).type)) out.push(id);
        return;
      }
      case "if":
        for (const x of s.then) this.declaredIn(cx, x, out, refs);
        if (s.else !== undefined) for (const x of s.else) this.declaredIn(cx, x, out, refs);
        return;
      case "block":
      case "comptime":
      case "unsafe":
      case "while":
      case "doWhile":
        for (const x of s.body) this.declaredIn(cx, x, out, refs);
        return;
      case "for":
        if (s.init !== undefined) this.declaredIn(cx, s.init, out, refs);
        for (const x of s.body) this.declaredIn(cx, x, out, refs);
        return;
      case "forOf": {
        const each = cx.instance.locals.getById(s.left.id)!;
        if (!refs || cx.tables.typing.holdsRef(cx.tables.arenas.localOf(each).type)) out.push(each);
        for (const x of s.body) this.declaredIn(cx, x, out, refs);
        return;
      }
      case "labeled":
        this.declaredIn(cx, s.body, out, refs);
        return;
      case "switch":
        for (const c of s.cases) for (const x of c.body) this.declaredIn(cx, x, out, refs);
        return;
      case "try": {
        if (refs) return;
        for (const x of s.block) this.declaredIn(cx, x, out, refs);
        const caught = s.param !== undefined ? this.localAt(cx, s) : undefined;
        if (caught !== undefined) out.push(caught);
        if (s.handler !== undefined) for (const x of s.handler) this.declaredIn(cx, x, out, refs);
        if (s.finalizer !== undefined) for (const x of s.finalizer) this.declaredIn(cx, x, out, refs);
        return;
      }
      default:
        return;
    }
  }

  // A reference declared in a list of statements lets go of what it holds as the list ends.
  /** @throws {CompileError} */
  statements(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, list: Ref<Stmt[]>): void {
    for (const s of list) this.statement(cx, s);
    for (const s of list) {
      if (s.kind !== "let") continue;
      const id = this.localAt(cx, s)!;
      if (cx.tables.typing.holdsRef(cx.tables.arenas.localOf(id).type)) this.release(cx, id);
    }
    this.ended(cx, list);
  }

  // A list's own variables end with it, so a borrow of one still held by a variable from outside
  // the list, and used after it, would point at a dropped value.
  /** @throws {CompileError} */
  ended(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, list: Ref<Stmt[]>): void {
    if (list.length === 0) return;
    let gone: LocalId[] = [];
    for (const s of list) if (s.kind === "let") gone.push(this.localAt(cx, s)!);
    this.dropped(cx, gone, list[list.length - 1]!.end);
  }

  // Checks that no borrow of a variable that has gone out of scope by `end` is still held by a
  // variable from outside, and used after. A variable that is itself a reference only copies a
  // pointer to what it borrows, whose own loans are checked where that ends.
  /** @throws {CompileError} */
  dropped(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, gone: Ref<LocalId[]>, end: usize): void {
    if (this.state === null || gone.length === 0) return;
    let byName = new Map<string, LocalId>();
    for (const l of gone) byName.set(String(cx.tables.arenas.localOf(l).id), l);
    // The first such loan, found before its message is built.
    let found: { place: string; start: usize; end: usize; root: LocalId; outside: LocalId[] } | undefined = undefined;
    for (const loan of this.state.loans.values()) {
      const root = byName.get(loan.place.split(".")[0]!);
      if (root === undefined || this.isRef(cx, cx.tables.arenas.localOf(root).type)) continue;
      let outside: LocalId[] = [];
      for (const h of loan.holders) if (!gone.includes(h) && (this.last.get(h) ?? -1) > (end as f64)) outside.push(h);
      if (outside.length === 0) continue;
      found = { place: loan.place, start: loan.start, end: loan.end, root, outside };
      break;
    }
    if (found === undefined) return;
    const lent = this.pathOf(cx, found.place);
    const holders = this.named(cx, found.outside).join(" and ");
    throw new CompileError("E0204", `'${lent}' doesn't live long enough: ${holders} still ${found.outside.length > 1 ? "borrow" : "borrows"} it after its block ends`, found.start, found.end, {
      message: `'${cx.tables.arenas.localOf(found.root).name}' is dropped here, at the end of its block; declare it outside the block, or give ${holders} an owned value`,
      start: end, end,
    });
  }

  // Every variable a statement declares, at any depth, which are gone once it has run, however
  // control left it: `let`s, a loop's own variables and a catch's parameter.
  scoped(cx: Ref<MoveCx<T, B, I>>, s: Ref<Stmt>): LocalId[] {
    let out: LocalId[] = [];
    this.declaredIn(cx, s, out, false);
    return out;
  }

  // The reference variables a list of statements declares, at any depth.
  insideList(cx: Ref<MoveCx<T, B, I>>, list: Ref<Stmt[]>): LocalId[] {
    let out: LocalId[] = [];
    for (const s of list) this.declaredIn(cx, s, out, true);
    return out;
  }

  // Every variable a list of statements declares, at any depth.
  scopedList(cx: Ref<MoveCx<T, B, I>>, list: Ref<Stmt[]>): LocalId[] {
    let out: LocalId[] = [];
    for (const s of list) this.declaredIn(cx, s, out, false);
    return out;
  }

  /** @throws {CompileError} */
  statement(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, s: Ref<Stmt>): void {
    switch (s.kind) {
      case "expr":
        this.expr(cx, s.expr, undefined, true);
        return;
      case "let": {
        const d: Ref<Declarator> = s.declarations[0]!;
        const name = d.target.kind === "ident" ? d.target.name : "";
        const local = this.localAt(cx, s)!;
        const place = String(cx.tables.arenas.localOf(local).id);
        const holds = cx.tables.typing.holdsRef(cx.tables.arenas.localOf(local).type);
        // A declaration run again by a loop makes a fresh variable, which holds nothing yet.
        this.release(cx, local);
        if (d.init === undefined) {
          if (this.state !== null) this.state.moves.set(place, { start: d.start, end: d.end, note: `'${name}' is declared here without a value`, passes: copyPasses(this.passes), unassigned: true });
          return;
        }
        this.expr(cx, d.init, `'${PLACE}' moved here: '${name}' owns it now; use '${PLACE}.clone()' to keep a copy`);
        this.revive(cx, place);
        if (holds) this.rehold(cx, local, d.init);
        return;
      }
      case "if": {
        this.expr(cx, s.cond);
        const before = join(this.state, null);
        this.statements(cx, s.then);
        const then = join(this.state, null);
        this.state = before;
        if (s.else !== undefined) this.statements(cx, s.else);
        this.state = join(then, this.state);
        return;
      }
      case "block":
      case "comptime":
      case "unsafe":
        this.statements(cx, s.body);
        return;
      // The catch runs from wherever the block raised, so from what all those points had in
      // common; after the try, either path may have run.
      case "try": {
        // A `finally` runs on every way out. It is checked from each way out's own state, once
        // per distinct state, and each way out then carries on from where it ends; the code
        // after the try carries on from the normal way out.
        const finalized = s.finalizer !== undefined;
        if (finalized) this.frames.push({ kind: "finally", acc: null, start: s.start, end: s.end, exits: [] });
        if (s.handler !== undefined) {
          this.frames.push({ kind: "catch", acc: null, start: s.start, end: s.end, exits: [] });
          this.statements(cx, s.block);
          const handler = this.frames.pop()!;
          const after = join(this.state, null);
          this.state = handler.acc;
          // A raise left the block wherever it was, its variables gone by the catch.
          const gone1 = this.scopedList(cx, s.block);
          this.dropped(cx, gone1, s.block.length > 0 ? s.block[s.block.length - 1]!.end : s.start);
          const caught = s.param !== undefined ? this.localAt(cx, s) : undefined;
          if (caught !== undefined) this.revive(cx, String(cx.tables.arenas.localOf(caught).id));
          this.statements(cx, s.handler);
          if (caught !== undefined) this.dropped(cx, [caught], s.handler.length > 0 ? s.handler[s.handler.length - 1]!.end : s.start);
          this.state = join(after, this.state);
        } else this.statements(cx, s.block);
        if (!finalized) return;
        const fin = this.frames.pop()!;
        const normal = join(this.state, null);
        // Ways out that reach the finally in the same state share one check of it, which keeps
        // nested finallies from multiplying the work.
        let ends: [State, State][] = [];
        for (const exit of fin.exits) {
          this.state = this.finish(cx, s, exit.acc, ends);
          if (exit.kind === "raise") this.raising(cx);
          else if (exit.kind === "return") this.returning(cx);
          else this.jumping(cx, exit.target!, exit.which!);
        }
        this.state = this.finish(cx, s, normal, ends);
        return;
      }
      case "while":
      case "doWhile":
        this.loop(cx, s);
        return;
      case "for":
        if (s.init !== undefined) this.statement(cx, s.init);
        this.loop(cx, s);
        return;
      // The loop reads its array once and keeps it lent, shared, until it ends; its variable,
      // when it is a reference, borrows the array as well.
      case "forOf": {
        // Like JavaScript closing a generator when its loop ends, the loop takes one it owns.
        const taken = cx.instance.types.get(s.right);
        if (taken !== undefined && !this.isRef(cx, taken) && (cx.tables.typing.yieldsOf(taken) ?? cx.tables.typing.yieldsOf(taken, true)) !== undefined) {
          this.expr(cx, s.right, `'${PLACE}' moved here: the 'for...of' loop takes the generator over, as JavaScript closes it when the loop ends; call 'next()' instead to keep it`);
          // What the generator borrows stays lent until the loop ends.
          const holder = this.loopHolder(cx, s);
          if (this.key(cx, s.right) !== undefined) this.inherit(cx, holder, s.right);
          else this.hold(cx, holder, s.right);
          // Each pass gives the variable a new value, which it owns.
          const each = String(cx.tables.arenas.localOf(cx.instance.locals.getById(s.left.id)!).id);
          this.loop(cx, s, each);
          return;
        }
        this.expr(cx, s.right);
        const place = this.key(cx, s.right);
        const each = cx.instance.locals.getById(s.left.id)!;
        const eachRef = cx.tables.typing.holdsRef(cx.tables.arenas.localOf(each).type);
        // A string's loop holds a reference of its own, so its variable stays free to change.
        const text = (this.coercions.get(s.right.id) ?? cx.instance.types.get(s.right)) === "string";
        // An `Iterable<T>` parameter's loop gives owned values, through the `[Symbol.iterator]()`
        // call it makes of a class, or at the definition, where nothing says what it stands for.
        const owning = text || s.await || (cx.instance.iterators !== undefined && cx.instance.iterators.has(s)) || (taken !== undefined && cx.tables.typing.iterableElement(taken) !== undefined && cx.tables.typing.lower(taken) === taken);
        if (place !== undefined && this.state !== null && !text) {
          const at2 = this.spot(cx, s.right);
          this.free(cx, place, at2, "lend");
          if (this.state !== null) this.state.loans.set(s.right.start as f64, { place, mutable: false, start: s.right.start, end: s.right.end, holders: new Set(), call: "the loop", loop: true });
          if (eachRef && this.state !== null) this.state.loans.set(-(s.start as f64) - 1, { place: `${place}.[]`, mutable: false, start: s.right.start, end: s.right.end, holders: new Set([each]) });
          // An array reached through a reference keeps what that reference borrows lent until
          // the loop ends, and an element that is a reference holds it too.
          // One holder per loop, so passes over it reach the same state and the check settles.
          const holder = this.loopHolder(cx, s);
          this.inherit(cx, holder, s.right);
          if (eachRef) this.inherit(cx, each, s.right);
        } else if (this.state !== null && !text && this.fromCallProjected(cx, s.right)) {
          // Over a reference a call gave, or a field or element of one, the loop keeps what that
          // reference borrows lent until it ends.
          const holder = this.loopHolder(cx, s);
          this.holdProjected(cx, holder, s.right);
          if (eachRef) this.holdProjected(cx, each, s.right);
        }
        // Each pass may end the loop, like a condition that may be false. Each pass gives a
        // string's variable a new string, and a Channel's the value it received, which it owns.
        const revived = owning ? String(cx.tables.arenas.localOf(each).id) : undefined;
        this.loop(cx, s, revived);
        if (this.state !== null) this.state.loans.delete(s.right.start as f64);
        return;
      }
      case "labeled": {
        this.exits.set(s.id, null);
        this.statement(cx, s.body);
        this.state = join(this.state, this.exits.get(s.id)!);
        const gone3 = this.scoped(cx, s.body);
        this.dropped(cx, gone3, s.end);
        return;
      }
      case "switch": {
        this.expr(cx, s.discriminant);
        for (const c of s.cases) if (c.test !== undefined) this.expr(cx, c.test);
        this.exits.set(s.id, null);
        const entry = join(this.state, null);
        let falling: State = null;
        for (const c of s.cases) {
          this.state = join(entry, falling);
          this.statements(cx, c.body);
          falling = join(this.state, null);
        }
        this.state = join(join(falling, this.exits.get(s.id)!), s.cases.some((c) => c.test === undefined) ? null : entry);
        const gone4 = this.scoped(cx, s);
        this.dropped(cx, gone4, s.end);
        return;
      }
      case "break":
      case "continue": {
        const target = cx.instance.jumps.get(s)!;
        this.jumping(cx, { id: target.id, start: target.start, end: target.end }, s.kind);
        this.state = null;
        return;
      }
      // A thrown value leaves with the error, as a returned one does, or goes to a catch.
      case "throw":
        this.expr(cx, s.value, `'${PLACE}' moved here: throwing it hands it on`);
        this.raising(cx);
        this.state = null;
        return;
      case "return":
        // A `return` in a match arm hands its value to the match and leaves the arm.
        if (cx.instance.jumps.has(s)) {
          const arm = cx.instance.jumps.get(s)!;
          const [consume, discarded] = this.arms.get(arm.id)!;
          if (s.value !== undefined) this.expr(cx, s.value, consume, discarded);
          this.jumping(cx, { id: arm.id, start: arm.start, end: arm.end }, "break");
          this.state = null;
          return;
        }
        if (s.value !== undefined) {
          this.expr(cx, s.value, "");
          // An arrow's expression body may be a call returning nothing.
          if (cx.instance.types.has(s.value)) this.returned(cx, s.value);
        }
        this.returning(cx);
        this.state = null;
        return;
    }
  }

  // A loop runs its body until nothing new has moved or been lent by the time it comes round
  // again, so a move late in the body is caught at a use early in it.
  /** @throws {CompileError} */
  // Checks a loop until a pass changes nothing: its condition, a `for...of` loop's variable
  // given its new value (`revived`, when it owns that value), the body and a `for` loop's update.
  /** @throws {CompileError} */
  loop(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, s: Ref<Stmt>, revived?: string): void {
    const bodyFirst = s.kind === "doWhile";
    const entry = join(this.state, null);
    let back: State = null;
    for (let pass: usize = 0; ; pass++) {
      this.passes.set(s.id, pass);
      this.state = join(entry, back);
      this.exits.set(s.id, null);
      this.nexts.set(s.id, null);
      // The loop ends when its condition is false, or by a `break`.
      let leaving: State = null;
      if (!bodyFirst) leaving = this.loopTest(cx, s);
      if (revived !== undefined) this.revive(cx, revived);
      if (s.kind === "while" || s.kind === "doWhile" || s.kind === "for" || s.kind === "forOf") this.statements(cx, s.body);
      this.state = join(this.state, this.nexts.get(s.id)!);
      // However a pass ended, `continue` included, its body's variables are gone, and a holder
      // used anywhere in the loop is used again on the next pass.
      const gone5 = s.kind === "for" ? this.scopedList(cx, s.body) : this.scoped(cx, s);
      this.dropped(cx, gone5, s.end - 1);
      // References declared in the body are gone by the time the loop comes round or ends,
      // however it left the body; a `for` loop's initializer outlives every pass.
      for (const local of s.kind === "for" ? this.insideList(cx, s.body) : this.inside(cx, s)) this.release(cx, local);
      if (bodyFirst) leaving = this.loopTest(cx, s);
      else if (s.kind === "for" && s.update !== undefined) this.expr(cx, s.update, undefined, true);
      leaving = join(leaving, this.exits.get(s.id)!);
      const after = join(this.state, null);
      this.state = leaving;
      // However the loop ended, `break` included, its variables are gone.
      const gone6 = this.scoped(cx, s);
      this.dropped(cx, gone6, s.end);
      for (const local of this.inside(cx, s)) this.release(cx, local);
      const left = join(this.state, null);
      this.state = after;
      const next = join(back, this.state);
      if (same(next, back)) {
        this.passes.delete(s.id);
        this.state = left;
        return;
      }
      back = next;
    }
  }

  // Runs a loop's condition, giving the state the loop leaves in when it is false: none for a
  // loop with no condition, or `true`, which ends only by a `break`. Each pass of a `for...of`
  // loop may end it.
  /** @throws {CompileError} */
  loopTest(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, s: Ref<Stmt>): State {
    if (s.kind === "forOf") return join(this.state, null);
    if (s.kind === "for") return s.test !== undefined ? this.condition(cx, s.test) : null;
    if (s.kind === "while" || s.kind === "doWhile") return this.condition(cx, s.cond);
    return null;
  }

  /** @throws {CompileError} */
  condition(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, t: Ref<Expr>): State {
    this.expr(cx, t);
    return t.kind === "bool" && t.value ? null : join(this.state, null);
  }

  // The holder of what a `for...of` loop keeps lent while it runs: one per loop, so passes over
  // it reach the same state and the check settles.
  loopHolder(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, s: Ref<Stmt>): LocalId {
    let holder = this.loopHolders.get(s.id);
    if (holder === undefined) holder = cx.tables.arenas.addLocal({ name: "for...of", type: "void", mutable: false, param: false, id: SYNTHETIC + s.start }).localId;
    this.loopHolders.set(s.id, holder);
    this.last.set(holder, s.end as f64);
    return holder;
  }

  // Evaluates an expression. `consume` says how its value is handed over, when it is; a
  // value that is only read, like a receiver or an operand, is borrowed. A statement's value
  // is discarded.
  /** @throws {CompileError} */
  expr(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>, consume?: Consumer, discarded = false): void {
    // A value lent to a reference stays where it is.
    const lentAs = this.coercions.get(e.id);
    if (lentAs !== undefined && this.isRef(cx, lentAs) && !this.isRef(cx, cx.instance.types.get(e)!)) consume = undefined;
    switch (e.kind) {
      case "int":
      case "bool":
      case "string":
        return;
      case "ident":
        if ((cx.instance.envs !== undefined && cx.instance.envs.has(e))) {
          this.made(cx, e);
          return;
        }
        // A JsValue read out of JS gives a new value, leaving the JsValue as it was.
        if (cx.instance.locals.has(e)) {
          const given = cx.instance.copiesOut.has(e) ? undefined : consume;
          this.use(cx, e, given);
        }
        return;
      case "super":
      case "this":
        const at7 = this.spot(cx, e);
        this.free(cx, "this", at7, "read");
        if (cx.f.self?.owned === true) {
          this.use(cx, e, consume);
          return;
        }
        if (consume !== undefined && this.state !== null && !cx.tables.typing.isCopy(cx.instance.types.get(e)!)) {
          throw new CompileError("E0202", this.hinted(cx, cx.instance.types.get(e)!, "'this' can't be moved, since it is only borrowed here; use 'this.clone()' to hand over a copy"), e.start, e.end);
        }
        return;
      case "member":
        if (!cx.instance.types.has(e.object)) return;
        if (this.key(cx, e) !== undefined) {
          // A tuple's length looks at its optional elements and its rest, so none may have moved.
          const held = cx.instance.types.get(e.object)!;
          const low = cx.tables.typing.lower(this.deref(cx, held));
          const tuple = typeof low === "string" ? undefined : cx.tables.typing.rec(low);
          if (e.name === "length" && tuple?.kind === "object" && tuple.tuple === true && (tuple.required !== undefined || tuple.rest !== undefined)) {
            const at8 = this.spot(cx, e.object);
            const place = this.key(cx, e.object)!;
            this.usable(cx, at8, place);
          }
          this.use(cx, e, consume);
          return;
        }
        this.expr(cx, e.object);
        return;
      case "arrow":
        this.made(cx, e);
        return;
      case "object": {
        // One value can't hold a mutable borrow of a place beside another borrow of it.
        let lends: Part[] = [];
        for (const p of e.props) if (p.kind === "property") this.lentInto(cx, p.value, lends);
        for (let i: usize = 0; i < lends.length; i++) {
          const part: Ref<Part> = lends[i]!;
          for (let k: usize = 0; k < i; k++) {
            const other: Ref<Part> = lends[k]!;
            if (!overlaps(part.place, other.place) || !(part.mutable || other.mutable)) continue;
            throw new CompileError("E0203", `'${part.at.shown}' is borrowed ${part.mutable && other.mutable ? "mutably twice" : "mutably and shared"} in one value, which would let one change what the other reads`, part.at.start, part.at.end);
          }
        }
        for (const p of e.props) {
          const into = `'${PLACE}' moved here into the new object; use '${PLACE}.clone()' to keep a copy`;
          if (p.kind === "property") this.expr(cx, p.value, into);
          // A spread of a place reads it, cloning its fields; one made for the literal is taken over.
          else if (p.kind === "spread") this.expr(cx, p.value);
          // A shorthand holds its variable as narrowed there.
          else if (p.kind === "shorthand") {
            const literal = cx.instance.types.get(e)!;
            const type = typeof literal !== "string" ? cx.tables.typing.field(literal, p.name)!.type : literal;
            this.use(cx, p, into, type);
          }
        }
        return;
      }
      case "new": {
        const name = e.callee.kind === "ident" ? `'new ${e.callee.name}'` : "the constructor";
        if (e.args !== undefined) this.handOver(cx, e.args, name, e);
        this.callEnded(cx, e);
        return;
      }
      case "call":
        this.call(cx, e);
        return;
      // An awaited future is handed to the await, which runs it to completion.
      case "unary":
        if (e.op === "await") {
          // The future runs across suspensions, after this statement's temporaries are gone.
          this.awaited(cx, e.operand);
          this.expr(cx, e.operand, `'${PLACE}' moved here: awaiting a Promise runs it to completion, after which it is gone`);
          // An awaited async call raises what it throws here, where the await finishes it.
          if (cx.instance.raises.has(e)) this.raising(cx);
          return;
        }
        this.expr(cx, e.operand);
        return;
      case "template":
        for (const x of e.exprs) this.expr(cx, x);
        return;
      // A quote's splices move into the value it makes; other tags became calls.
      case "tagged":
        if (e.template.kind === "template") for (const x of e.template.exprs) this.expr(cx, x, `'${PLACE}' moved here into the quote; use '${PLACE}.clone()' to keep a copy`);
        return;
      case "index":
        if (consume !== undefined && this.element(cx, e) && !cx.tables.typing.isCopy(cx.instance.types.get(e)!)) throw this.elementMove(cx, e, cx.instance.types.get(e)!);
        if (this.key(cx, e) === undefined) this.expr(cx, e.object);
        else this.use(cx, e, consume);
        this.expr(cx, e.index);
        return;
      case "update":
        this.expr(cx, e.operand);
        this.change(cx, e.operand);
        return;
      case "assign":
        this.assignment(cx, e, e.target, consume, discarded);
        return;
      // Each arm runs from the state after the subject and any guards before it that failed,
      // and the match ends in any of theirs. A binding borrowing from the matched place holds a
      // loan of it until its arm ends; a guard holds one while it runs, since later arms still
      // test the place.
      case "match": {
        this.expr(cx, e.subject);
        const place = this.key(cx, e.subject);
        let entry = join(this.state, null);
        let after: State = null;
        for (const arm of e.arms) {
          this.state = join(entry, null);
          let bound: LocalId[] = [];
          for (const b of bindings(arm.pattern)) {
            const local = cx.instance.locals.getById(b.id);
            if (local !== undefined) bound.push(local);
          }
          // Each time an arm is entered, its bindings are new, as a loop's `let` is.
          for (const local of bound) this.revive(cx, String(cx.tables.arenas.localOf(local).id));
          let borrowing: LocalId[] = [];
          for (const l of bound) if (this.isRef(cx, cx.tables.arenas.localOf(l).type)) borrowing.push(l);
          for (const holderId of borrowing) {
            const key = -(cx.tables.arenas.localOf(holderId).id as f64) - 1_000_000;
            if (place !== undefined && this.state !== null) this.state.loans.set(key, { place, mutable: false, start: e.subject.start, end: e.subject.end, holders: new Set([holderId]) });
            // Through a reference, the binding holds what that reference borrows, a reference a
            // call gave included.
            this.inherit(cx, holderId, e.subject);
            if (place === undefined && this.fromCallProjected(cx, e.subject)) this.holdProjected(cx, holderId, e.subject);
          }
          if (arm.guard !== undefined) {
            const at = -(arm.guard.start as f64) - 1;
            if (place !== undefined && this.state !== null) this.state.loans.set(at, { place, mutable: false, start: arm.guard.start, end: arm.guard.end, holders: new Set(), guard: true });
            this.guarding.add(arm.guard.start);
            this.expr(cx, arm.guard);
            this.guarding.delete(arm.guard.start);
            if (this.state !== null) this.state.loans.delete(at);
            const passed = join(this.state, null);
            this.state = join(passed, null);
            for (const holder of borrowing) this.release(cx, holder);
            entry = join(entry, this.state);
            this.state = passed;
          }
          if (arm.body.kind === "block") {
            this.arms.set(arm.body.id, [consume, discarded]);
            this.exits.set(arm.body.id, null);
            this.statement(cx, arm.body);
            this.state = join(this.state, this.exits.get(arm.body.id)!);
            const gone9 = [...this.scoped(cx, arm.body), ...bound];
            this.dropped(cx, gone9, arm.body.end);
          } else {
            this.expr(cx, arm.body, consume, discarded);
            this.dropped(cx, bound, arm.body.end);
          }
          for (const holder of borrowing) this.release(cx, holder);
          after = join(after, this.state);
        }
        this.state = after;
        return;
      }
      case "conditional": {
        this.expr(cx, e.cond);
        if (!cx.instance.types.has(e.then)) {
          this.expr(cx, e.else, consume, discarded);
          return;
        }
        if (!cx.instance.types.has(e.else)) {
          this.expr(cx, e.then, consume, discarded);
          return;
        }
        const before = join(this.state, null);
        this.expr(cx, e.then, consume, discarded);
        const then = join(this.state, null);
        this.state = before;
        this.expr(cx, e.else, consume, discarded);
        this.state = join(then, this.state);
        return;
      }
      case "binary": {
        // `a ?? b` hands over whichever it gives; a Rust value, which is never copied, always.
        const given = e.op === "??" ? (consume ?? (cx.tables.typing.holdsPart(cx.instance.types.get(e)!, (u) => rustClassOf(cx.tables.typing, u) !== undefined) ? `'${PLACE}' moved here: '??' hands over the Rust value it holds` : undefined)) : undefined;
        if (e.op === "??") this.outOfBorrow(cx, e.left, e, consume);
        this.expr(cx, e.left, given);
        // The right side of `&&`, `||` and `??` may not run.
        const before = join(this.state, null);
        this.expr(cx, e.right, given);
        if (e.op === "&&" || e.op === "||" || e.op === "??") this.state = join(before, this.state);
        return;
      }
      // `x!` is x's value, handed over or read as x is.
      case "nonNull":
        if (redundantBang(e)) {
          this.expr(cx, e.expr, consume, discarded);
          return;
        }
        this.outOfBorrow(cx, e.expr, e, consume);
        this.expr(cx, e.expr, consume);
        return;
      case "as":
        if (narrowsUnion(cx.tables.typing, cx.instance, this.coercions, e)) {
          this.outOfBorrow(cx, e.expr, e, consume);
          this.expr(cx, e.expr, consume);
          return;
        }
        this.expr(cx, e.expr, consume, discarded);
        return;
      case "satisfies":
      case "unsafe":
        this.expr(cx, e.expr, consume, discarded);
        return;
      // Comptime code runs while compiling, so it moves and borrows nothing at run time.
      case "comptime":
        return;
      // A yielded value is handed to whoever called `next()`.
      case "yield":
        if (e.value !== undefined) this.expr(cx, e.value, `'${PLACE}' moved here: yielding it hands it on; use '${PLACE}.clone()' to keep a copy`);
        this.stillBorrowed(cx, e);
        return;
      // A pipe over a value hands it to the topic, new each time the pipe runs.
      // Like a `let`, the topic holds what its value borrows, until the pipe ends.
      case "pipe": {
        const local = this.localAt(cx, e)!;
        const place = String(cx.tables.arenas.localOf(local).id);
        const holds = cx.tables.typing.holdsRef(cx.tables.arenas.localOf(local).type);
        this.release(cx, local);
        this.expr(cx, e.value, `'${PLACE}' moved here into the pipe's '%'; use '${PLACE}.clone()' to keep a copy`);
        this.revive(cx, place);
        if (holds) this.rehold(cx, local, e.value);
        this.expr(cx, e.body, consume, discarded);
        this.release(cx, local);
        return;
      }
      // A spread of a place reads it, cloning its elements; one made for the spread is taken over.
      case "array":
        for (const x of e.elements) {
          if (x === undefined) continue;
          if (x.kind === "spread") this.expr(cx, x.value);
          else this.expr(cx, x, `'${PLACE}' moved here into the new array; use '${PLACE}.clone()' to keep a copy`);
        }
        return;
      case "float":
      case "bigint":
      case "regex":
      case "null":
        return;
      // A throw expression hands its value on, and nothing after it runs.
      case "throw":
        this.expr(cx, e.value, `'${PLACE}' moved here: throwing it hands it on`);
        this.raising(cx);
        this.state = null;
        return;
      default:
        assert(false, `the move checker has no case for '${e.kind}' expressions`);
    }
  }

  // A value that may keep references given to it holds them: a holder variable, or `this`, which
  // may be given only what points into this function's parameters, since it outlives the call.
  /** @throws {CompileError} */
  keep(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, target: Ref<Expr>, values: Ref<Expr[]>, holdingOnly: boolean): void {
    let any = false;
    for (const v of values) if (!holdingOnly || this.holding(cx, v)) any = true;
    if (!any) return;
    const k = this.keeper(cx, target);
    for (const v of values) if (!holdingOnly || this.holding(cx, v)) this.keepValue(cx, k, v);
  }

  /** @throws {CompileError} */
  keepOne(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, target: Ref<Expr>, v: Ref<Expr>): void {
    const k = this.keeper(cx, target);
    this.keepValue(cx, k, v);
  }

  // Whether a value given on holds references, as given.
  holding(cx: Ref<MoveCx<T, B, I>>, v: Ref<Expr>): boolean {
    return cx.tables.typing.holdsRef(this.coercions.get(v.id) ?? cx.instance.types.get(v)!);
  }

  // What keeps the references a target is given: `this`, through its holder, or the variable it
  // is in, when that holds references of its own.
  /** @throws {CompileError} */
  keeper(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, target: Ref<Expr>): Keeper {
    // Keeping references in what a reference points to would need its owner to hold them.
    const through = this.refThrough(cx, target);
    if (through !== undefined) {
      throw new CompileError("E0801", `keeping references through the reference '${through}' is not supported yet; do it on what '${through}' points to, directly`, target.start, target.end);
    }
    // What a closure captures outlives the call that keeps it, like what a reference points to.
    const capture = this.rootLocal(cx, target);
    if (capture !== undefined && (cx.instance.captures !== undefined && cx.instance.captures.has(capture))) {
      throw new CompileError("E0801", `keeping references in '${cx.tables.arenas.localOf(capture).name}', which this closure captures, is not supported yet; keep them in a variable of the closure's own`, target.start, target.end);
    }
    if (this.rootIsThis(cx, target)) return { self: true };
    const owner = capture;
    if (owner === undefined) return { self: false };
    const type = cx.tables.arenas.localOf(owner).type;
    return cx.tables.typing.holdsRef(type) && !this.isRef(cx, type) ? { self: false, owner } : { self: false };
  }


  // How the target itself, or the object it reads a field of at any depth, reads, when it is
  // a reference.
  refThrough(cx: Ref<MoveCx<T, B, I>>, p: Ref<Expr>): string | undefined {
    const t = cx.instance.types.get(p);
    if (t !== undefined && this.isRef(cx, t)) return this.text(cx, p);
    if (p.kind === "member") return this.refThrough(cx, p.object);
    return undefined;
  }

  /** @throws {CompileError} */
  keepValue(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, k: Ref<Keeper>, v: Ref<Expr>): void {
    if (k.self) {
      this.keepsInThis = true;
      this.stored(cx, v);
      if (cx.f.self !== undefined && cx.tables.typing.holdsRef(cx.f.self.type)) this.hold(cx, this.kept, v);
    } else if (k.owner !== undefined) this.hold(cx, k.owner, v);
  }

  // Arguments are handed over, or lent for the call, in order.
  /** @throws {CompileError} */
  handOver(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, args: Ref<Expr[]>, name: string, call: Ref<Expr>): void {
    for (let i: usize = 0; i < args.length; i++) this.handOverOne(cx, args[i]!, name, call, i === 0);
  }

  /** @throws {CompileError} */
  handOverOne(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, a: Ref<Expr>, name: string, call: Ref<Expr>, first: boolean): void {
    // What crosses into JS is copied there, so it is only read here; a callback is kept by JS,
    // so it is handed over.
    if (cx.tables.jsCrossings.has(call)) {
      const keptByJs = cx.tables.typing.keptByJs(this.coercions.get(a.id) ?? "void") || cx.tables.typing.keptByJs(cx.instance.types.get(a)!);
      this.expr(cx, a, keptByJs ? `'${PLACE}' moved here: JS keeps a callback or a Promise given to it, as it may use it later; pass '${PLACE}.clone()' to keep a copy` : undefined);
      return;
    }
    const helper = call.kind === "call" && call.shown !== undefined && first;
    this.expr(cx, a, (helper ? `'${PLACE}' moved here: ${name} takes its generator over` : `'${PLACE}' moved here: passing it to ${name} hands it over, as if ${name} kept it; pass '${PLACE}.clone()' to keep a copy`));
    const parts = this.lent(cx, a);
    for (let i: usize = 0; i < parts.length; i++) this.lend(cx, parts[i]!.place, parts[i]!.mutable, parts[i]!.at, undefined, name, call.id, parts[i]!.at.start, partKey(parts[i]!.at.start, i));
  }

  // The places an expression lends a reference to, and how: a place borrowed, a reference
  // passed on, which lends what it points to again, or either side of a `?:`.
  lent(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, given: Ref<Expr>): Part[] {
    let out: Part[] = [];
    this.lentInto(cx, given, out);
    return out;
  }

  lentInto(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, given: Ref<Expr>, out: Mut<Part[]>): void {
    const lentAs = this.coercionOf(cx, given);
    this.lentFrom(cx, given, lentAs, out);
  }

  // `lentInto` of a value taken out of its wrappers, which `lentAs` was met as.
  lentFrom(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>, lentAs: Type | undefined, out: Mut<Part[]>): void {
    if (unwraps(cx.tables.typing, cx.instance, this.coercions, e) && (e.kind === "nonNull" || e.kind === "as" || e.kind === "satisfies" || e.kind === "unsafe")) {
      this.lentFrom(cx, e.expr, lentAs, out);
      return;
    }
    if (e.kind === "conditional") {
      if (cx.instance.types.has(e.then)) this.lentInto(cx, e.then, out);
      if (cx.instance.types.has(e.else)) this.lentInto(cx, e.else, out);
      return;
    }
    if (e.kind === "binary" && this.choosing(cx, e)) {
      this.lentInto(cx, e.left, out);
      this.lentInto(cx, e.right, out);
      return;
    }
    // A literal lends what each of its parts does, nested literals included.
    if (e.kind === "object") {
      for (const p of e.props) if (p.kind === "property") this.lentInto(cx, p.value, out);
      return;
    }
    // A closure made for a call lends what it captures for the call.
    if (e.kind === "arrow" || (cx.instance.envs !== undefined && cx.instance.envs.has(e))) {
      for (const c of this.captured(cx, e)) if (!c.held || this.reborrows(cx, c.from!)) out.push({ place: c.place, at: copySpot(c.at), mutable: c.mutable || c.held });
      return;
    }
    // A field, element or unwrapped Option of a returned reference reaches into what that
    // reference borrows, so it lends what the reference does.
    if (projectsAway(cx.instance, e) && this.key(cx, e) === undefined && this.fromCallProjected(cx, e)) {
      this.lentProjected(cx, e, out);
      return;
    }
    // A call's returned reference lends again what it borrows from, a receiver included; a
    // future lends it mutably when it holds a mutable reference.
    const from = cx.instance.borrowsFrom.get(e);
    if (from !== undefined) {
      const result = lentAs ?? cx.instance.types.get(e)!;
      const mutable = this.isRef(cx, result) ? cx.tables.typing.rec(result).mutable : cx.tables.typing.holdsMut(result);
      for (const s of from) this.sourceInto(cx, s, mutable, out);
      return;
    }
    const type = cx.instance.types.get(e);
    const place = this.key(cx, e);
    // A shared reference passed on is just another pointer, which needs nothing lent; a
    // mutable one lends itself, shared or mutably as it is passed on.
    // A mutable reference or nothing passed on lends itself as a mutable reference does.
    const ref = this.refMutability(cx, lentAs ?? type);
    const held = this.refMutability(cx, type);
    if (place === undefined || ref === undefined || held === false) return;
    out.push({ place, at: this.spot(cx, e), mutable: ref });
  }

  // Whether a reference, or an Option holding one, is mutable; undefined for any other type.
  refMutability(cx: Ref<MoveCx<T, B, I>>, t: Type | undefined): boolean | undefined {
    if (t === undefined) return undefined;
    const r = this.isRef(cx, t) ? t : cx.tables.typing.optionRef(t);
    return r === undefined ? undefined : cx.tables.typing.rec(r).mutable;
  }

  // What a call's result borrows from one of its sources: what the source lends, or, for a
  // receiver that is a place, the place itself.
  sourceInto(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, s: Ref<Expr>, mutable: boolean, out: Mut<Part[]>): void {
    const before = out.length;
    this.lentInto(cx, s, out);
    const place = this.key(cx, s);
    if (out.length > before || place === undefined || this.isRef(cx, cx.instance.types.get(s)!)) return;
    out.push({ place, at: this.spot(cx, s), mutable });
  }

  // A call: what a nested function it calls captures, its callee, its receiver lent to it, its
  // arguments handed over or lent, and what it may keep, held once its own loans have ended.
  /** @throws {CompileError} */
  call(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>): void {
    if (e.kind !== "call") return;
    // Printing, `format`, `inspect`, `JSON.stringify`, `Array.isArray` and `assert` read their
    // arguments.
    if (cx.tables.asserts.has(e) || cx.tables.printCalls.has(e) || cx.tables.formatCalls.has(e) || cx.tables.inspectCalls.has(e) || cx.tables.jsonCalls.get(e) === "stringify" || cx.tables.kindTests.has(e)) {
      for (const a of e.args) this.expr(cx, a);
      return;
    }
    if (cx.tables.joinCalls.has(e)) {
      if (e.callee.kind === "member") this.expr(cx, e.callee.object, `'${PLACE}' moved here: 'join' takes the handle over, as awaiting it would`);
      return;
    }
    // `Promise.all` and `Promise.race` take each future in their list as an argument, so what
    // one borrows is lent while the others are made, and two can't conflict.
    if (cx.tables.combinedCalls.has(e)) {
      const name = `'Promise.${e.callee.kind === "member" || e.callee.kind === "ident" ? e.callee.name : ""}'`;
      const list: Ref<Expr> = e.args[0]!;
      if (list.kind === "array") {
        for (const x of list.elements) if (x !== undefined) this.handOverOne(cx, x, name, e, false);
      } else this.handOverOne(cx, list, name, e, false);
      this.callEnded(cx, e);
      return;
    }
    // An iterator helper's call is named by the method written.
    const name = e.shown !== undefined ? `'${e.shown}'` : e.callee.kind === "member" || e.callee.kind === "ident" ? `'${e.callee.name}'` : e.callee.kind === "super" ? "'super'" : "the function";
    // What the call may keep is held once its own loans have ended.
    const keeps = this.callInside(cx, e, name);
    this.callEnded(cx, e);
    if (keeps) this.keepReceiver(cx, e);
    if (cx.instance.raises.has(e)) this.raising(cx);
  }



  // The part of a call checked while its own loans are live: whether what it lends may be kept.
  /** @throws {CompileError} */
  callInside(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>, name: string): boolean {
    if (e.kind !== "call") return false;
    // A nested function called by name, itself included, uses what it captures for the
    // call: lent shared while its arguments run, so they may read it, then mutably for the
    // call where it changes it, so nothing borrowed from those may be live across it. Keys
    // below zero and between whole numbers, one per capture, so no other loan can replace
    // these.
    let captures: CallCapture[] = [];
    const callee: Span = { start: e.callee.start, end: e.callee.end };
    if (cx.tables.selfCalls.has(e)) {
      if (cx.instance.captures !== undefined) for (const alias of cx.instance.captures.keys()) captures.push({ alias, changes: (cx.instance.changed !== undefined && cx.instance.changed.has(alias)), key: 0 });
    } else {
      const built = cx.instance.envs?.get(e);
      if (built !== undefined) {
        const inner = cx.tables.arenas.instanceOf(built.of);
        let aliases: LocalId[] = [];
        for (const alias of inner.captures!.keys()) aliases.push(alias);
        for (let i: usize = 0; i < built.env.length; i++) captures.push({ alias: built.env[i]!, changes: (inner.changed !== undefined && inner.changed.has(aliases[i]!)), key: 0 });
      }
    }
    for (let i: usize = 0; i < captures.length; i++) captures[i]!.key = -((callee.start as f64) + ((i as f64) + 1) / 8192);
    for (const c of captures) {
      const alias = cx.tables.arenas.localOf(c.alias);
      const at: Spot = { start: callee.start, end: callee.end, shown: alias.name };
      const place = String(alias.id);
      const aliasName = alias.name;
      try {
        this.usable(cx, at, place);
      } catch (err) {
        // The variable isn't written at the call, so the message says the function uses it.
        if (err instanceof CompileError && !cx.tables.selfCalls.has(e)) throw new CompileError(err.code, `${name} uses '${aliasName}', and ${err.message}`, err.start, err.end, err.note);
        throw err;
      }
      this.lend(cx, place, false, at, undefined, name, e.id, at.start, c.key);
    }
    // A closure is read to call it, or taken over when it can run only once.
    const run = e.callee.kind === "ident" ? cx.tables.typing.lower(cx.instance.types.get(e.callee) ?? "void") : undefined;
    if (e.callee.kind === "ident" && cx.instance.locals.has(e.callee)) {
      const r = this.record(cx, run);
      const once = r?.kind === "closure" && r.once !== undefined;
      this.expr(cx, e.callee, once ? `'${PLACE}' moved here: calling it runs it once, since it moves out what it captured` : undefined);
    }
    // A method's receiver is lent to it for the call, mutably when the method changes it.
    // A mutable receiver is lent shared while the arguments run, so they may read it, and
    // mutably for the call itself.
    // A callee that is itself a value, like an arrow called at once, runs first.
    const dyn = cx.tables.dynCalls.get(e);
    const dynMutable = dyn !== undefined && (dyn.mutable || dyn.owned);
    const dynOwned = dyn !== undefined && dyn.owned;
    const dynCallable = dyn?.callable !== undefined;
    if (e.callee.kind !== "ident" && e.callee.kind !== "member" && e.callee.kind !== "super" && !dynCallable) this.expr(cx, e.callee);
    // Through a Dyn, the receiver its interface declares; a stored callable called as a name,
    // an element or any other value is itself what is lent to the call.
    if (e.callee.kind === "member") {
      if (fieldCall(cx.tables, cx.instance, e)) return this.callOn(cx, e, name, e.callee, captures);
      return this.callOn(cx, e, name, e.callee.object, captures);
    }
    if (dyn !== undefined && dyn.callable !== undefined) return this.callWithin(cx, e, name, e.callee, dyn.callable.id, captures);
    return this.callOn(cx, e, name, undefined, captures);
  }

  // A stored callable a call's callee holds, found by id, which it calls on.
  /** @throws {CompileError} */
  callWithin(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>, name: string, at: Ref<Expr>, id: usize, captures: Ref<CallCapture[]>): boolean {
    if (at.id === id) return this.callOn(cx, e, name, at, captures);
    if (at.kind === "nonNull" || at.kind === "as" || at.kind === "satisfies" || at.kind === "unsafe") return this.callWithin(cx, e, name, at.expr, id, captures);
    if (at.kind === "member" || at.kind === "index") return this.callWithin(cx, e, name, at.object, id, captures);
    return this.callOn(cx, e, name, undefined, captures);
  }

  // The rest of a call, given what it lends as its receiver.
  /** @throws {CompileError} */
  callOn(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>, name: string, object: Ref<Expr> | undefined, captures: Ref<CallCapture[]>): boolean {
    if (e.kind !== "call") return false;
    const callee: Span = { start: e.callee.start, end: e.callee.end };
    const dyn = cx.tables.dynCalls.get(e);
    const dynMutable = dyn !== undefined && (dyn.mutable || dyn.owned);
    const dynOwned = dyn !== undefined && dyn.owned;
    const place = object !== undefined ? this.key(cx, object) : undefined;
    const target = cx.instance.calls.get(e);
    const self = target !== undefined ? bodyOf(cx.tables.arenas, cx.tables.arenas.instanceOf(target)).self : undefined;
    const hasSelf = self !== undefined || dyn !== undefined;
    const selfMutable = self !== undefined ? self.mutable : dynMutable;
    const selfOwned = self !== undefined ? self.owned === true : dynOwned;
    // An owning method takes its receiver over, as an argument it is handed.
    if (object !== undefined && selfOwned) {
      this.expr(cx, object, `'${PLACE}' moved here: ${name} takes its object over; call it on '${PLACE}.clone()' to keep a copy`);
      this.handOver(cx, e.args, name, e);
      return false;
    }
    if (object !== undefined) this.expr(cx, object);
    // An array's `push` and `pop`, and a generator's `next`, change it: it is lent shared
    // while the arguments run, as a mutating method's object is, then changed, which nothing
    // borrowing it may see.
    const method = e.callee.kind === "member" ? e.callee.name : "";
    const builtin = object !== undefined && target === undefined && e.callee.kind === "member" && method !== "clone";
    const changes = builtin && (this.generator(cx, object!) || (this.array(cx, object!) && ARRAY_CHANGES.has(method)) || (this.mapped(cx, object!) && MAP_CHANGES.has(method)));
    // Any other array, Map or Set method reads it, lent shared while its callback runs, as
    // a string is while a regex goes through it.
    // A shared value's, an Rc's or a lock's `update` and `read` hand their callback a pointer
    // into the value the receiver reaches, so the callback can't replace or drop the receiver.
    const reads = builtin && !changes && (this.array(cx, object!) || this.mapped(cx, object!) || cx.tables.regexStringCalls.has(e) || (this.locking(cx, object!) && (method === "update" || method === "read")));
    if (object !== undefined && place !== undefined && (hasSelf || changes || reads)) {
      const at10 = this.spot(cx, object);
      this.lend(cx, place, false, at10, undefined, name, e.id);
    }
    // A receiver that is a reference a call gave lends again what that reference borrows
    // from, for the whole call, so its callback can't replace what the reference reaches.
    let parts: Part[] = [];
    if (object !== undefined && place === undefined && (hasSelf || changes || reads)) parts = this.lent(cx, object);
    for (let i: usize = 0; i < parts.length; i++) this.lend(cx, parts[i]!.place, false, parts[i]!.at, undefined, name, e.id, parts[i]!.at.start, partKey(parts[i]!.at.start, i));
    this.handOver(cx, e.args, name, e);
    for (const c of captures) {
      if (!c.changes || this.state === null) continue;
      this.state.loans.delete(c.key);
      const at: Spot = { start: callee.start, end: callee.end, shown: cx.tables.arenas.localOf(c.alias).name };
      const place = String(cx.tables.arenas.localOf(c.alias).id);
      this.lend(cx, place, true, at, undefined, name, e.id, e.end - 1, c.key);
    }
    if (object !== undefined && changes) {
      if (this.state !== null) this.state.loans.delete(object.start as f64);
      this.change(cx, object);
    }
    if (object !== undefined && place !== undefined && selfMutable && this.state !== null) {
      this.state.loans.delete(object.start as f64);
      const at11 = this.spot(cx, object);
      this.lend(cx, place, true, at11, undefined, name, e.id, e.end - 1);
    }
    if (hasSelf && selfMutable) {
      for (let i: usize = 0; i < parts.length; i++) {
        const key = partKey(parts[i]!.at.start, i);
        if (this.state !== null) this.state.loans.delete(key);
        this.lend(cx, parts[i]!.place, parts[i]!.mutable, parts[i]!.at, undefined, name, e.id, e.end - 1, key);
      }
    }
    // A method that changes its object, or a base's constructor, may keep what is lent,
    // when the object has somewhere to keep a reference.
    const keeper = object ?? (e.callee.kind === "super" ? e.callee : undefined);
    if (keeper === undefined) return false;
    const keeperType = cx.instance.types.get(keeper);
    const holder = keeperType === undefined || cx.tables.typing.holdsRef(this.deref(cx, keeperType));
    if (!holder || !(selfMutable || e.callee.kind === "super")) return false;
    // A method whose body is known to store nothing holding references in `this` keeps none of
    // what it is given.
    return target === undefined || cx.tables.arenas.instanceOf(target).keeps !== false;
  }

  // A method that changes its object, or a base's constructor, may keep what it is given, held
  // by its receiver.
  /** @throws {CompileError} */
  keepReceiver(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>): void {
    if (e.kind !== "call") return;
    if (e.callee.kind === "member") {
      if (fieldCall(cx.tables, cx.instance, e)) this.keep(cx, e.callee, e.args, true);
      else this.keep(cx, e.callee.object, e.args, true);
      return;
    }
    const callable = cx.tables.dynCalls.get(e)?.callable;
    if (callable !== undefined) this.keepWithin(cx, e.callee, callable.id, e.args);
    else if (e.callee.kind === "super") this.keep(cx, e.callee, e.args, true);
  }

  /** @throws {CompileError} */
  keepWithin(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, at: Ref<Expr>, id: usize, args: Ref<Expr[]>): void {
    if (at.id === id) {
      this.keep(cx, at, args, true);
      return;
    }
    if (at.kind === "nonNull" || at.kind === "as" || at.kind === "satisfies" || at.kind === "unsafe") {
      this.keepWithin(cx, at.expr, id, args);
      return;
    }
    if (at.kind === "member" || at.kind === "index") {
      this.keepWithin(cx, at.object, id, args);
      return;
    }
  }

  // Once a call returns, what was lent to it alone is free again.
  callEnded(this: Mut<this>, cx: Ref<MoveCx<T, B, I>>, call: Ref<Expr>): void {
    if (this.state === null) return;
    let ended: f64[] = [];
    for (const [at, loan] of this.state.loans) if (loan.call !== undefined && loan.callAt === call.id && loan.holders.size === 0) ended.push(at);
    for (const at of ended) this.state.loans.delete(at);
  }


  // Reads or hands over a place, which must still hold its value and not be lent so as to
  // forbid it.
  /** @throws {CompileError} */
  use(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Named>, consume?: Consumer, type: Type = e.kind === "shorthand" ? cx.tables.arenas.localOf(this.localAt(cx, e)!).type : cx.instance.types.get(e)!): void {
    const place = this.key(cx, e)!;
    const at12 = this.spot(cx, e);
    this.usable(cx, at12, place);
    const moving = consume !== undefined && !cx.tables.typing.isCopy(type);
    if (moving && place.includes(".[]")) throw this.elementMove(cx, e, type);
    const at13 = this.spot(cx, e);
    this.free(cx, place, at13, moving ? "move" : "read");
    if (!moving || this.state === null) return;
    const rootId = this.rootLocal(cx, e);
    const root = rootId !== undefined ? cx.tables.arenas.localOf(rootId) : undefined;
    if (root !== undefined && (this.isRef(cx, root.type) || cx.tables.typing.optionRef(root.type) !== undefined)) {
      const name = root.name;
      throw new CompileError("E0202", this.hinted(cx, type, `'${this.text(cx, e)}' can't be moved out of '${name}', which only borrows it; use '${this.text(cx, e)}.clone()'`), e.start, e.end);
    }
    // Nor out of a reference a field holds, or a shared value every clone of it uses.
    this.movedThrough(cx, e, e, type);
    if (place.startsWith("this") && cx.f.self?.owned !== true) {
      throw new CompileError("E0202", this.hinted(cx, type, `'${this.text(cx, e)}' can't be moved out of 'this', since it is only borrowed here; use '${this.text(cx, e)}.clone()'`), e.start, e.end);
    }
    // A closure moving out what it captures holds it, and can run only once.
    if (rootId !== undefined && cx.instance.captures !== undefined && cx.instance.captures.has(rootId)) this.movedOut.add(rootId);
    this.consumed.add(e.id);
    const note = this.hinted(cx, type, consume!.replaceAll(PLACE, this.text(cx, e)));
    if (this.state !== null) this.state.moves.set(place, { start: e.start, end: e.end, note, passes: copyPasses(this.passes) });
  }

  // A message without its advice to clone, for a value holding a JoinHandle, which can't be.
  hinted(cx: Ref<MoveCx<T, B, I>>, type: Type, message: string): string {
    // A Promise isn't cloned either: its future runs once.
    const counted = cx.tables.typing.holdsPart(type, (u) => {
      const r = this.record(cx, u);
      return (r?.kind === "block" && (r.which === "Semaphore" || r.which === "Permit")) || r?.kind === "future";
    }, true);
    return cx.tables.typing.holdsHandle(type, true) || counted ? message.replace(/;[^;]*\.clone\(\)'[^;]*$/, "") : message;
  }

  // A place can't be used once it, something it is inside, or something inside it moved.
  /** @throws {CompileError} */
  usable(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, use: Ref<Spot>, place: string): void {
    if (this.state === null) return;
    // The first move of this place or a part of it, found before its message is built.
    let found: { moved: string; move: Move } | undefined = undefined;
    for (const [moved, move] of this.state.moves) {
      if (!overlaps(moved, place)) continue;
      found = { moved, move: copyMove(move) };
      break;
    }
    if (found === undefined) return;
    const { moved, move } = found;
    const note = { message: move.note, start: move.start, end: move.end };
    if (move.unassigned === true) {
      const root = this.pathOf(cx, moved);
      throw new CompileError("E0205", `'${root}' is used before being assigned; give it a value on every path that reaches here, as TypeScript requires`, use.start, use.end, note);
    }
    const name = use.shown;
    const what = moved === place ? `'${name}' was moved, so it can't be used here`
      : place.startsWith(`${moved}.`) ? `'${name}' can't be used here because '${this.pathOf(cx, moved)}' was moved`
      : `'${name}' can't be used as a whole here because '${this.pathOf(cx, moved)}' was moved out of it`;
    let earlier = "";
    for (const [loop, pass] of this.passes) if ((move.passes.get(loop) ?? pass) < pass) earlier = " (in an earlier pass through this loop)";
    throw new CompileError("E0201", what + earlier, use.start, use.end, note);
  }

  // A place can't be accessed in a way a live loan of it, of something inside it or of
  // something it is inside forbids: a mutable loan forbids everything, a shared one changes,
  // moves and mutable loans.
  // Holders as a message names them, each once.
  named(cx: Ref<MoveCx<T, B, I>>, holders: Ref<LocalId[]>): string[] {
    let out: string[] = [];
    for (const id of holders) {
      const name = cx.tables.arenas.localOf(id).name;
      const shown = name === "for...of" ? "a 'for...of' loop" : `'${name}'`;
      if (!out.includes(shown)) out.push(shown);
    }
    return out;
  }

  /** @throws {CompileError} */
  free(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, place: string, use: Ref<Spot>, access: Access, at: usize = use.start): void {
    if (this.state === null) return;
    // The first loan forbidding this access, found before its message is built.
    let found: Loan | undefined = undefined;
    for (const loan of this.state.loans.values()) {
      if (!overlaps(loan.place, place) || !this.live(cx, loan, at)) continue;
      if (!loan.mutable && (access === "read" || access === "lend")) continue;
      found = copyLoan(loan);
      break;
    }
    if (found === undefined) return;
    const loan = found;
    const lent = this.pathOf(cx, loan.place);
    const verb = access === "read" ? "use" : access === "lend mutably" ? "mutably lend" : access;
    let holders: LocalId[] = [];
    for (const h of loan.holders) if ((this.last.get(h) ?? -1) > (at as f64)) holders.push(h);
    const names = this.named(cx, holders);
    const holder = loan.loop === true ? `a 'for...of' loop is reading '${lent}'`
      : loan.guard === true ? `a match guard is reading '${lent}', and later arms still test it`
      : loan.call !== undefined
      ? `'${lent}' is lent ${loan.mutable ? "mutably " : ""}to ${loan.call} for this call`
      : `${names.join(" and ")} ${names.length > 1 ? "borrow" : "borrows"} '${lent}'${loan.mutable ? " mutably" : ""} and ${names.length > 1 ? "are" : "is"} used later`;
    const until = loan.loop === true ? "the loop ends" : loan.guard === true ? "the guard ends" : loan.call !== undefined ? "the call returns" : "the borrow's last use";
    let again = false;
    for (const p of this.passes.values()) if (p > 0) again = true;
    const earlier = loan.start >= use.start && again ? " on an earlier pass through this loop" : "";
    throw new CompileError("E0203", `cannot ${verb} '${use.shown}' while ${holder}`, use.start, use.end, {
      message: `'${lent}' is lent ${loan.mutable ? "mutably " : ""}here${earlier}, so it can't ${loan.mutable ? "be used" : "change or move"} until ${until}`,
      start: loan.start, end: loan.end,
    });
  }

  // A loan's key for the `i`th place a value lends, apart from the others it lends at the same
  // spot, as a closure's variables are when its environment is made from a call's or a name's.
  // Other loans are keyed by whole numbers, or a temporary's by a half, so these keys and a
  // call's captures and an assignment's hold below take other fractions of an offset, which
  // never equal those.
  // Where a place is used and how the source names it there.
  spot(cx: Ref<MoveCx<T, B, I>>, e: Ref<Named>): Spot {
    return { start: e.start, end: e.end, shown: this.text(cx, e) };
  }

  // Lends a place, which must be free to lend so, to a reference variable or for a call.
  // A loan is keyed by where it starts, or by `key` for one no source offset may share.
  /** @throws {CompileError} */
  lend(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, place: string, mutable: boolean, use: Ref<Spot>, holder?: LocalId, call?: string, callAt?: usize, at: usize = use.start, key: f64 = use.start as f64): void {
    this.free(cx, place, use, mutable ? "lend mutably" : "lend", at);
    if (this.state === null) return;
    let holders = new Set<LocalId>();
    if (holder !== undefined) holders.add(holder);
    this.state.loans.set(key, { place, mutable, start: use.start, end: use.end, holders, call, callAt });
  }

  // A reference variable given a value holds what it borrows: a place lent to it, or what
  // the reference it copies, or the reference it borrows through, holds.
  /** @throws {CompileError} */
  hold(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, holder: LocalId, given: Ref<Expr>): void {
    if (this.state === null) return;
    const heldAs = this.coercionOf(cx, given);
    this.holdFrom(cx, holder, given, given, heldAs);
  }

  // `hold` of a value taken out of its wrappers, given as `outer` and met as `heldAs`.
  /** @throws {CompileError} */
  holdFrom(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, holder: LocalId, outer: Ref<Expr>, e: Ref<Expr>, heldAs: Type | undefined): void {
    if (unwraps(cx.tables.typing, cx.instance, this.coercions, e) && (e.kind === "nonNull" || e.kind === "as" || e.kind === "satisfies" || e.kind === "unsafe")) {
      this.holdFrom(cx, holder, outer, e.expr, heldAs);
      return;
    }
    if (e.kind === "conditional") {
      if (cx.instance.types.has(e.then)) this.hold(cx, holder, e.then);
      if (cx.instance.types.has(e.else)) this.hold(cx, holder, e.else);
      return;
    }
    if (e.kind === "binary" && this.choosing(cx, e)) {
      this.hold(cx, holder, e.left);
      this.hold(cx, holder, e.right);
      return;
    }
    if (this.lentTemporary(cx, outer)) throw this.outlived(cx, e, `'${cx.tables.arenas.localOf(holder).name}'`);
    // A call's returned reference holds what its sources do: a receiver where it lives.
    const instance = cx.instance;
    const from = instance.borrowsFrom.get(e);
    if (from !== undefined) {
      const result = heldAs ?? cx.instance.types.get(e)!;
      // A future holding a mutable reference, or a Dyn's async method declaring `Mut<this>`,
      // lends what it borrows mutably until it is done.
      const mutable = this.isRef(cx, result) ? cx.tables.typing.rec(result).mutable : cx.tables.typing.holdsMut(result) || cx.tables.dynCalls.get(e)?.mutable === true;
      for (const s of from) {
        if (this.sourceTemporary(cx, s)) throw this.outlived(cx, s, `'${cx.tables.arenas.localOf(holder).name}'`);
        const t = this.coercionOf(cx, s) ?? cx.instance.types.get(s)!;
        if (cx.tables.typing.holdsRef(t) && (this.isRef(cx, t) || this.key(cx, s) === undefined)) this.hold(cx, holder, s);
        else if (this.key(cx, s) !== undefined) {
          const place = this.key(cx, s)!;
          const at = this.spot(cx, s);
          this.lend(cx, place, mutable, at, holder);
          this.inherit(cx, holder, s);
          if (this.throughUnion(cx, s)) this.temporary(cx, holder, s);
        } else this.temporary(cx, holder, s);
      }
      return;
    }
    const type = cx.instance.types.get(e)!;
    const to = heldAs ?? type;
    // A closure holds what it captures.
    if (e.kind === "arrow" || (cx.instance.envs !== undefined && cx.instance.envs.has(e))) {
      const parts = this.captured(cx, e);
      for (let i: usize = 0; i < parts.length; i++) {
        const c: Ref<Capture> = parts[i]!;
        // A copy of a mutable reference lends it again.
        if (!c.held || this.reborrows(cx, c.from!)) this.lend(cx, c.place, c.mutable || c.held, c.at, holder, undefined, undefined, c.at.start, partKey(c.at.start, i));
        if (c.from !== undefined && cx.tables.typing.holdsRef(cx.tables.arenas.localOf(c.from).type)) this.inheritFrom(cx, holder, c.from);
      }
      return;
    }
    if (!this.isRef(cx, to)) {
      // A value holding references holds what its parts do, or what the value it copies does.
      if (!cx.tables.typing.holdsRef(to)) return;
      if (e.kind === "object") {
        for (const p of e.props) {
          if (p.kind === "property") this.hold(cx, holder, p.value);
          else if (p.kind === "shorthand" && this.localAt(cx, p) !== undefined) {
            const localId = this.localAt(cx, p)!;
            const type = cx.tables.arenas.localOf(localId).type;
            const place = String(cx.tables.arenas.localOf(localId).id);
            // A shorthand lent to a reference field lends its variable; a mutable reference copied
            // lends itself mutably, as `{ m: m }` does, so only one of them is used at a time.
            // Meeting a union, the literal's own type is the member it went into.
            const shape = this.isUnion(cx, to) ? cx.instance.types.get(e)! : to;
            const field = typeof shape !== "string" ? cx.tables.typing.field(shape, p.name) : undefined;
            const at = this.spot(cx, p);
            if (field !== undefined && this.isRef(cx, field.type) && !this.isRef(cx, type)) this.lend(cx, place, false, at, holder);
            else if (cx.tables.typing.holdsRef(type)) {
              if (this.isRef(cx, type) && cx.tables.typing.rec(type).mutable) this.lend(cx, place, true, at, holder);
              this.inheritFrom(cx, holder, localId);
            }
          }
        }
      } else {
        this.lendTo(cx, holder, outer);
        this.inherit(cx, holder, e);
      }
      return;
    }
    // A place borrowed, or a reference copied, is lent to the holder: a mutable reference
    // copied lends itself mutably, so only one of them is used at a time. A copy keeps its
    // source borrowed too, so it can't be told apart from the original while held.
    this.lendTo(cx, holder, outer);
    this.inherit(cx, holder, e);
    if (!this.inPlace(cx, e, to) && !(this.sameReferent(cx, e, to) && this.heldThrough(cx, holder, outer, e))) this.temporary(cx, holder, e);
  }

  // A holder of a field or element read through a reference a call gives holds what that call's
  // reference does; whether `e` reads through one.
  /** @throws {CompileError} */
  heldThrough(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, holder: LocalId, outer: Ref<Expr>, e: Ref<Expr>): boolean {
    if (e.kind === "call") {
      if (!this.isRef(cx, cx.instance.types.get(e)!)) return false;
      this.holdFrom(cx, holder, outer, e, undefined);
      return true;
    }
    if (e.kind === "member") return !e.optional && !cx.instance.calls.has(e) && this.heldThrough(cx, holder, outer, e.object);
    if (e.kind === "index") return !e.optional && this.heldThrough(cx, holder, outer, e.object);
    if (e.kind === "nonNull") return this.heldThrough(cx, holder, outer, e.expr);
    return false;
  }

  // Whether a field or element read through a reference a call gives is read in place.
  readsReturned(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>): boolean {
    if (e.kind === "call") return this.isRef(cx, cx.instance.types.get(e)!);
    if (e.kind === "member") return !e.optional && !cx.instance.calls.has(e) && this.readsReturned(cx, e.object);
    if (e.kind === "index") return !e.optional && this.readsReturned(cx, e.object);
    if (e.kind === "nonNull") return this.readsReturned(cx, e.expr);
    return false;
  }

  // Whether a reference made from `e` refers to `e` itself, not to a copy of it as another type.
  sameReferent(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>, to: RefType): boolean {
    if (e.kind !== "member" && e.kind !== "index" && e.kind !== "nonNull") return false;
    if (this.throughUnion(cx, e)) return false;
    const type = cx.instance.types.get(e)!;
    const target = cx.tables.typing.rec(to).to;
    return cx.tables.typing.lower(type) === cx.tables.typing.lower(target) || cx.tables.typing.partOfItself(type, target);
  }

  // What a value lends, lent to a holder.
  /** @throws {CompileError} */
  lendTo(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, holder: LocalId, e: Ref<Expr>): void {
    const parts = this.lent(cx, e);
    for (let i: usize = 0; i < parts.length; i++) this.lend(cx, parts[i]!.place, parts[i]!.mutable, parts[i]!.at, holder, undefined, undefined, parts[i]!.at.start, partKey(parts[i]!.at.start, i));
  }

  // Through a reference, or a value holding references, what it holds stays held.
  inherit(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, holder: LocalId, e: Ref<Expr>): void {
    const root = this.rootLocal(cx, e);
    if (root !== undefined && cx.tables.typing.holdsRef(cx.tables.arenas.localOf(root).type)) this.inheritFrom(cx, holder, root);
  }

  inheritFrom(this: Mut<this>, cx: Ref<MoveCx<T, B, I>>, holder: LocalId, root: LocalId): void {
    if (this.state === null || root === holder) return;
    let held: f64[] = [];
    for (const [at, loan] of this.state.loans) if (loan.holders.has(root)) held.push(at);
    for (const at of held) {
      let loan = copyLoan(this.state.loans.get(at)!);
      loan.holders.add(holder);
      this.state.loans.set(at, loan);
    }
  }

  // Whether an argument lends a value made for the statement, rather than a place or a
  // reference it already is.
  // `x!` is lent where `x` holds it. A string literal lives for the whole program, so only a
  // body that can stop, losing the slot its pointer is kept in, can't hold one.
  lentTemporary(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, s: Ref<Expr>, across = false): boolean {
    const lent = this.coercionOf(cx, s);
    if (s.kind === "string" && !across && cx.f.generator !== true && cx.f.async !== true) return false;
    // A JsValue read out of JS is made for the statement, though it names a variable.
    if (lent === undefined || !this.isRef(cx, lent) || this.isRef(cx, cx.instance.types.get(s)!)) return false;
    if (this.key(cx, s) !== undefined) return this.copiedOut(cx, s);
    // What a reference a call gives refers to lives where that reference points.
    return !(this.readsReturned(cx, s) && !this.throughUnion(cx, s));
  }

  // Whether a source a call's result borrows from is a value made for the statement: a lent
  // argument, or a receiver that isn't a place, which `this` borrows with no coercion recorded.
  sourceTemporary(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, s: Ref<Expr>, across = false): boolean {
    if (this.lentTemporary(cx, s, across)) return true;
    if (s.kind === "string" && !across && cx.f.generator !== true && cx.f.async !== true) return false;
    if (this.key(cx, s) !== undefined) return false;
    if (this.readsReturned(cx, s) && !this.throughUnion(cx, s)) return false;
    const type = this.coercionOf(cx, s) ?? cx.instance.types.get(s)!;
    return !cx.tables.typing.holdsRef(type);
  }

  // Nothing an awaited future borrows from may be a temporary: a combinator's future borrows
  // what each future in its list does.
  /** @throws {CompileError} */
  awaited(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>): void {
    if (cx.tables.combinedCalls.has(e) && e.kind === "call" && e.args.length > 0) {
      const list: Ref<Expr> = e.args[0]!;
      if (list.kind === "array") {
        for (const x of list.elements) if (x !== undefined) this.awaited(cx, x);
        return;
      }
    }
    const instance = cx.instance;
    const from = instance.borrowsFrom.get(e);
    if (from !== undefined) for (const s of from) if (this.sourceTemporary(cx, s, true)) throw this.outlived(cx, s, "the awaited Promise");
  }

  // A borrow kept past its statement can't point at a temporary, which is gone once the
  // statement ends.
  outlived(cx: Ref<MoveCx<T, B, I>>, s: Ref<Expr>, holder: string): CompileError {
    if (cx.instance.copiesOut.has(s) && s.kind === "ident") return new CompileError("E1005", `${holder} would keep borrowing what '${s.name}' gives here, which is read out of JS anew at each use and gone once its statement ends; keep it in a 'const' first and borrow that`, s.start, s.end);
    return new CompileError("E0204", `${holder} would keep borrowing this temporary, which is gone once its statement ends; give it a name first, as in 'const xs = ...;'`, s.start, s.end);
  }

  // A reference to a temporary or a copy holds that, so it is never returned.
  temporary(this: Mut<this>, cx: Ref<MoveCx<T, B, I>>, holder: LocalId, e: Ref<Expr>): void {
    // Keyed beside any loan made at the same place, which it must not replace.
    if (this.state !== null) this.state.loans.set((e.start as f64) + 0.5, { place: TEMPORARY, mutable: false, start: e.start, end: e.end, holders: new Set([holder]) });
  }

  // Whether a reference made from `e` points where `e` lives, rather than at a copy: a place
  // of exactly the type borrowed, reached through real fields of known layout, or a reference
  // to the same type or to one member of a union.
  inPlace(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>, to: RefType): boolean {
    const type = cx.instance.types.get(e)!;
    const local = e.kind === "ident" ? this.localAt(cx, e) : undefined;
    // A variable read as narrowed holds its declared union, not the member it was narrowed to.
    const narrowedLocal = local !== undefined && cx.tables.arenas.localOf(local).type !== type;
    const target = cx.tables.typing.rec(to).to;
    if (this.isRef(cx, type)) {
      const held = cx.tables.typing.rec(type).to;
      if (narrowedLocal && this.isUnion(cx, held)) return false;
      const from = cx.tables.typing.lower(held);
      const want = cx.tables.typing.lower(target);
      return from === want || (this.isUnion(cx, from) && cx.tables.typing.rec(from).members.includes(want));
    }
    if (this.key(cx, e) === undefined || this.throughUnion(cx, e) || (narrowedLocal && this.isUnion(cx, type))) return false;
    return cx.tables.typing.lower(type) === cx.tables.typing.lower(target) || cx.tables.typing.partOfItself(type, target);
  }

  // Whether a field path passes through a union, or ends where a type parameter's concrete type
  // stores the field as another type, so the field is read as a copy. At a definition, where
  // nothing is concrete, each instance decides.
  throughUnion(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>): boolean {
    if (this.unionOnPath(cx, e)) return true;
    const stored = this.storedType(cx, e);
    return stored !== undefined && cx.tables.typing.lower(stored) !== cx.tables.typing.lower(cx.instance.types.get(e)!);
  }

  // Whether an object a field path reads through is a union.
  unionOnPath(cx: Ref<MoveCx<T, B, I>>, e: Ref<Expr>): boolean {
    if (e.kind !== "member") return false;
    const holder = cx.instance.types.get(e.object);
    if (holder !== undefined && this.record(cx, this.deref(cx, holder))?.kind === "union") return true;
    return this.unionOnPath(cx, e.object);
  }

  // The type a place is stored as, where an instance knows it: a field read through a type
  // parameter has its concrete type's field type, as codegen lays it out.
  storedType(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>): Type | undefined {
    if (e.kind !== "member") return cx.instance.types.get(e);
    const holder = this.storedType(cx, e.object);
    if (holder === undefined) return cx.instance.types.get(e);
    const held = this.deref(cx, holder);
    if (typeof held === "string") return cx.instance.types.get(e);
    const concrete = cx.tables.typing.lower(held);
    if (typeof concrete === "string") return cx.instance.types.get(e);
    const kind = cx.tables.typing.rec(concrete).kind;
    if (kind === "union" || kind === "param") return cx.instance.types.get(e);
    return cx.tables.typing.field(concrete, e.name)?.type ?? cx.instance.types.get(e);
  }

  // A returned reference may point only into what its lifetime ties it to: a parameter's
  // borrow, or `this`, never this function's own values.
  /** @throws {CompileError} */
  returned(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>): void {
    let origins: Origin[] = [];
    for (const o of this.origins) origins.push(o);
    this.outlives(cx, e, origins, "return", "return an owned value instead");
  }

  // What a body stores into `this` outlives the call, so it may point only into parameters.
  /** @throws {CompileError} */
  stored(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>): void {
    let params: Origin[] = [];
    for (let i: usize = 0; i < cx.f.params.length; i++) params.push(i);
    this.outlives(cx, e, params, "store in 'this'", "store an owned value instead");
  }

  // A value leaving the body may point only into what `allowed` says outlives it.
  /** @throws {CompileError} */
  outlives(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>, allowed: Origin[], verb: string, instead: string): void {
    const type = this.coercions.get(e.id) ?? cx.instance.types.get(e)!;
    if (!cx.tables.typing.holdsRef(type)) return;
    for (const place of this.pointsInto(cx, e)) {
      if (place === TEMPORARY) {
        throw new CompileError("E0204", `can't ${verb} a reference to a temporary or a copy, which is gone once the function returns; ${instead}`, e.start, e.end);
      }
      let param: usize | undefined = undefined;
      if (place.startsWith("param ")) {
        const n = parseInt(place.slice(6));
        if (n !== undefined) param = n as usize;
      }
      if (param !== undefined ? allowed.includes(param) : place.startsWith("this") && allowed.includes("this")) continue;
      let shown: string[] = [];
      for (const o of allowed) shown.push(o === "this" ? "'this'" : `'${this.paramName(cx, o)}'`);
      const names = shown.length > 0 ? shown.join(" or ") : "nothing it was given";
      const what = param !== undefined ? `'${this.paramName(cx, param)}'` : place.startsWith("this") ? `'${this.pathOf(cx, place)}'` : undefined;
      const message = what !== undefined
        ? verb === "return" ? `the returned reference points into ${what}, but its lifetime ties it to ${names}; give ${what} that lifetime, or return an owned value` : `the stored reference points into ${what}, but it may only point into ${names}`
        : `can't ${verb} a reference to '${this.pathOf(cx, place)}', which belongs to this function and is gone once it returns; ${instead}`;
      throw new CompileError("E0209", message, e.start, e.end);
    }
  }

  // The places a reference value points into: places it borrows where they live, what the
  // reference variables it reads through hold, what calls' results borrow, or a temporary.
  pointsInto(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, given: Ref<Expr>): string[] {
    const pointsAs = this.coercionOf(cx, given);
    return this.pointsFrom(cx, given, pointsAs);
  }

  // `pointsInto` of a value taken out of its wrappers, which `pointsAs` was met as.
  pointsFrom(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>, pointsAs: Type | undefined): string[] {
    if (unwraps(cx.tables.typing, cx.instance, this.coercions, e) && (e.kind === "nonNull" || e.kind === "as" || e.kind === "satisfies" || e.kind === "unsafe")) return this.pointsFrom(cx, e.expr, pointsAs);
    if (e.kind === "conditional") {
      let out: string[] = [];
      if (cx.instance.types.has(e.then)) for (const p of this.pointsInto(cx, e.then)) out.push(p);
      if (cx.instance.types.has(e.else)) for (const p of this.pointsInto(cx, e.else)) out.push(p);
      return out;
    }
    if (e.kind === "binary" && this.choosing(cx, e)) {
      let out = this.pointsInto(cx, e.left);
      for (const p of this.pointsInto(cx, e.right)) out.push(p);
      return out;
    }
    // A closure points at what it borrows, and wherever what it holds points.
    if (e.kind === "arrow" || (cx.instance.envs !== undefined && cx.instance.envs.has(e))) {
      let out: string[] = [];
      for (const c of this.captured(cx, e)) {
        if (!c.held) out.push(c.place);
        else if (c.from !== undefined && cx.tables.typing.holdsRef(cx.tables.arenas.localOf(c.from).type)) for (const p of this.heldBy(cx, c.from)) out.push(p);
      }
      return out;
    }
    const instance = cx.instance;
    const from = instance.borrowsFrom.get(e);
    if (from !== undefined) {
      let out: string[] = [];
      for (const s of from) {
        const t = this.coercionOf(cx, s) ?? cx.instance.types.get(s)!;
        if (this.isRef(cx, t) || (cx.tables.typing.holdsRef(t) && this.key(cx, s) === undefined)) for (const p of this.pointsInto(cx, s)) out.push(p);
        else if (this.key(cx, s) !== undefined && !this.throughUnion(cx, s)) for (const p of this.within(cx, s)) out.push(p);
        else {
          // A receiver read through a reference a call gives is lent where that reference points.
          const returned = this.throughUnion(cx, s) ? undefined : this.returnedBase(cx, s);
          if (returned !== undefined) for (const p of returned) out.push(p);
          else out.push(TEMPORARY);
        }
      }
      return out;
    }
    const type = cx.instance.types.get(e)!;
    const to = pointsAs ?? type;
    if (!this.isRef(cx, to)) {
      // A value holding references points wherever its parts, or the value it copies, do.
      if (!cx.tables.typing.holdsRef(to)) return [];
      if (e.kind === "object") {
        let out: string[] = [];
        for (const p of e.props) {
          if (p.kind === "property") for (const q of this.pointsInto(cx, p.value)) out.push(q);
          if (p.kind !== "shorthand") continue;
          const local = cx.instance.locals.getById(p.id);
          if (local === undefined) continue;
          const type = cx.tables.arenas.localOf(local).type;
          const field = typeof to !== "string" ? cx.tables.typing.field(to, p.name) : undefined;
          if (field !== undefined && this.isRef(cx, field.type) && !this.isRef(cx, type)) out.push(String(cx.tables.arenas.localOf(local).id));
          else for (const q of this.heldBy(cx, local)) out.push(q);
        }
        return out;
      }
      const root = this.rootLocal(cx, e);
      return root !== undefined && cx.tables.typing.holdsRef(cx.tables.arenas.localOf(root).type) ? this.heldBy(cx, root) : [];
    }
    if (!this.inPlace(cx, e, to)) {
      const returned = this.throughReturned(cx, e, to);
      return returned !== undefined ? returned : [TEMPORARY];
    }
    return this.within(cx, e);
  }

  // Where a field or element read through a reference a call gives lives: where that reference
  // points, as Rust has it. A read through a union, or one met as another type, is a copy, and a
  // field of a value a call gives owned is a temporary.
  throughReturned(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>, to: RefType): string[] | undefined {
    return this.sameReferent(cx, e, to) ? this.returnedBase(cx, e) : undefined;
  }

  // The places a reference a call gives points into, reached from a read of a field or an
  // element of what it refers to.
  returnedBase(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>): string[] | undefined {
    if (e.kind === "call") return this.isRef(cx, cx.instance.types.get(e)!) ? this.pointsInto(cx, e) : undefined;
    if (e.kind === "member") return e.optional || cx.instance.calls.has(e) ? undefined : this.returnedBase(cx, e.object);
    if (e.kind === "index") return e.optional ? undefined : this.returnedBase(cx, e.object);
    if (e.kind === "nonNull") return this.returnedBase(cx, e.expr);
    return undefined;
  }

  // The places a holder's loans are on, leaving out those inside other holders, whose own
  // loans are held too.
  heldBy(cx: Ref<MoveCx<T, B, I>>, root: LocalId): string[] {
    let refs = new Set<string>();
    for (const l of cx.instance.locals.values()) {
      const local = cx.tables.arenas.localOf(l);
      if (this.isRef(cx, local.type) || cx.tables.typing.optionRef(local.type) !== undefined) refs.add(String(local.id));
    }
    let out: string[] = [];
    if (this.state === null) return out;
    for (const l of this.state.loans.values()) if (l.holders.has(root) && !refs.has(l.place.split(".")[0]!)) out.push(l.place);
    return out;
  }

  // Where a place lives: itself, or, reached through a reference variable, what that holds; a
  // reference read out of a value holding references points where that value's loans are.
  within(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>): string[] {
    const root = this.rootLocal(cx, e);
    if (root === undefined) return [this.key(cx, e)!];
    const type = cx.tables.arenas.localOf(root).type;
    if (!(this.isRef(cx, type) || cx.tables.typing.optionRef(type) !== undefined || (this.isRef(cx, cx.instance.types.get(e)!) && cx.tables.typing.holdsRef(type)))) return [this.key(cx, e)!];
    return this.heldBy(cx, root);
  }

  paramName(cx: Ref<MoveCx<T, B, I>>, i: usize): string {
    return cx.f.params[i]!.pattern.kind === "ident" ? identName(cx.f.params[i]!.pattern) : `parameter ${i + 1}`;
  }

  // A holder given a new value lets go of what it held and holds what the value does, which
  // may be read from the holder itself, so the new holds are gathered first.
  /** @throws {CompileError} */
  rehold(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, local: LocalId, e: Ref<Expr>): void {
    if (this.state === null) return;
    const was = cx.tables.arenas.localOf(local);
    const id = was.id;
    const gathering = cx.tables.arenas.addLocal({ name: was.name, type: was.type, mutable: was.mutable, param: was.param, id: SYNTHETIC * 2 + id }).localId;
    this.hold(cx, gathering, e);
    this.release(cx, local);
    if (this.state === null) return;
    let gathered: f64[] = [];
    for (const [at, loan] of this.state.loans) if (loan.holders.has(gathering)) gathered.push(at);
    for (const at of gathered) {
      let loan = copyLoan(this.state.loans.get(at)!);
      loan.holders.delete(gathering);
      // Nothing holds a loan of itself.
      if (loan.place.split(".")[0] === String(id) && loan.holders.size === 0) this.state.loans.delete(at);
      else {
        loan.holders.add(local);
        this.state.loans.set(at, loan);
      }
    }
  }

  // A reference pointed elsewhere, or declared again, lets go of what it held.
  release(this: Mut<this>, cx: Ref<MoveCx<T, B, I>>, holder: LocalId): void {
    if (this.state === null) return;
    let held: f64[] = [];
    for (const [at, loan] of this.state.loans) if (loan.holders.has(holder)) held.push(at);
    for (const at of held) {
      let loan = copyLoan(this.state.loans.get(at)!);
      loan.holders.delete(holder);
      if (loan.holders.size === 0 && loan.call === undefined) this.state.loans.delete(at);
      else this.state.loans.set(at, loan);
    }
  }

  // A loan lasts while one of its holders may still be used, or for its call.
  live(cx: Ref<MoveCx<T, B, I>>, loan: Ref<Loan>, at: usize): boolean {
    if (loan.guard === true) return this.guarding.has(loan.start);
    return loan.call !== undefined || [...loan.holders].some((h) => (this.last.get(h) ?? -1) > (at as f64));
  }

  // A value can't be moved out of a field read through a reference, or a shared value every
  // clone of it uses, anywhere along the path `p` reads it through.
  /** @throws {CompileError} */
  movedThrough(this: Mut<this>, cx: Ref<MoveCx<T, B, I>>, e: Ref<Named>, p: Ref<Named>, type: Type): void {
    if (p.kind !== "member") return;
    const holder = this.record(cx, cx.instance.types.get(p.object));
    if (holder?.kind === "shared" || (holder?.kind === "ref" && this.record(cx, holder.to)?.kind === "shared")) {
      throw new CompileError("E0202", `'${this.text(cx, e)}' can't be moved out of '${this.text(cx, p.object)}', which every clone of it shares; use it where it is`, e.start, e.end);
    }
    if (p.id !== e.id && this.isRef(cx, cx.instance.types.get(p)!)) {
      throw new CompileError("E0202", this.hinted(cx, type, `'${this.text(cx, e)}' can't be moved out of '${this.text(cx, p)}', which only borrows it; use '${this.text(cx, e)}.clone()'`), e.start, e.end);
    }
    this.movedThrough(cx, e, p.object, type);
  }

  // An assignment to `target`, its written target with any redundant `!` taken off.
  /** @throws {CompileError} */
  assignment(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>, target: Ref<Expr>, consume: Consumer | undefined, discarded: boolean): void {
    if (target.kind === "nonNull" && redundantBang(target)) {
      this.assignment(cx, e, target.expr, consume, discarded);
      return;
    }
    if (e.kind !== "assign") return;
    // A whole value written through a mutable reference changes everything it points to,
    // and can't keep references there, nor be handed on as well.
    if (this.isRef(cx, cx.instance.types.get(target)!) && this.coercions.has(target.id)) {
      this.expr(cx, target);
      const shown1 = this.text(cx, target);
      this.expr(cx, e.value, `'${PLACE}' moved here into what '${shown1}' points to; use '${PLACE}.clone()' to keep a copy`);
      this.change(cx, target, e.end);
      if (cx.tables.typing.holdsRef(this.coercions.get(e.value.id) ?? cx.instance.types.get(e.value)!)) this.keepOne(cx, target, e.value);
      if (consume !== undefined && !cx.tables.typing.isCopy(cx.instance.types.get(e)!)) {
        throw new CompileError("E0201", `this assignment's value can't be used: it was moved into what '${this.text(cx, target)}' points to, which only borrows it`, e.start, e.end);
      }
      return;
    }
    if (e.op !== "=") this.expr(cx, target);
    // A target's indexes run before the value, as in JavaScript.
    else this.indexes(cx, target);
    // A place inside a variable is found before the value runs, so a nested function the
    // value calls can't replace the variable from under it.
    const nested = cx.instance.envs !== undefined && holdsNode({ of: "expr", node: e.value }, (n) => n.of === "expr" && cx.instance.envs!.has(n.node));
    const root = nested && (target.kind === "member" || target.kind === "index") ? this.rootPlace(cx, target) : undefined;
    const held = root !== undefined ? root.place : undefined;
    const hold = -((target.start as f64) + 0.75);
    if (held !== undefined) {
      const shown2 = this.text(cx, target);
      this.lend(cx, held, false, root!.at, undefined, `the assignment to '${shown2}'`, e.id, root!.at.start, hold);
    }
    const shown3 = this.text(cx, target);
    this.expr(cx, e.value, `'${PLACE}' moved here into '${shown3}'; use '${PLACE}.clone()' to keep a copy`);
    if (held !== undefined && this.state !== null) this.state.loans.delete(hold);
    // The target changes once the value is ready, after the value's reads.
    this.assign(cx, target, e.end);
    const local = target.kind === "ident" ? this.localAt(cx, target) : undefined;
    // Pointing a reference elsewhere lets go of what it held; a value holding references
    // given another one to hold adds it.
    if (local !== undefined && cx.instance.captures !== undefined && cx.instance.captures.has(local) && this.holding(cx, e.value)) this.keepOne(cx, target, e.value);
    if (local !== undefined && cx.tables.typing.holdsRef(cx.tables.arenas.localOf(local).type)) this.rehold(cx, local, e.value);
    // A value given a reference to keep, through a field or a setter, holds it; `this` may
    // only be given what outlives the call.
    if (target.kind === "member" && cx.tables.typing.holdsRef(this.coercions.get(e.value.id) ?? cx.instance.types.get(e.value)!)) this.keepOne(cx, target.object, e.value);
    // An assignment used as a value hands over what it just stored. A setter keeps what it
    // was given, with nothing left to read or hand on.
    if (!discarded && this.state !== null && !cx.tables.typing.isCopy(cx.instance.types.get(e)!) && cx.instance.setters.has(target)) {
      throw new CompileError("E0201", `'${this.text(cx, target)}' is a setter, which keeps the value assigned to it, so this assignment can't also be used as a value; assign a clone`, e.start, e.end);
    }
    if (consume !== undefined && !cx.tables.typing.isCopy(cx.instance.types.get(e)!) && this.key(cx, target) !== undefined) this.use(cx, target, consume);
    return;
  }

  // Changing a place needs it free of loans; a setter changes the object it is called on.
  /** @throws {CompileError} */
  change(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, target: Ref<Expr>, at: usize = target.start): void {
    if (cx.instance.setters.has(target) && target.kind === "member") {
      this.changePlace(cx, target.object, at);
      return;
    }
    this.changePlace(cx, target, at);
  }

  /** @throws {CompileError} */
  changePlace(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, changed: Ref<Expr>, at: usize): void {
    const place = this.key(cx, changed);
    if (place === undefined) return;
    const at2 = this.spot(cx, changed);
    this.free(cx, place, at2, "change", at);
  }

  // Assigning a place gives it a value again, along with everything inside it, but nothing
  // can be assigned inside a value that has moved, nor while it is lent.
  /** @throws {CompileError} */
  assign(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, target: Ref<Expr>, at: usize): void {
    const place = this.key(cx, target);
    if (place === undefined || cx.instance.setters.has(target)) {
      if (target.kind === "member") this.expr(cx, target.object);
      this.change(cx, target, at);
      return;
    }
    this.change(cx, target, at);
    if (this.state === null) return;
    // The first move of something this place is inside, found before its message is built.
    let found: { moved: string; move: Move } | undefined = undefined;
    for (const [moved, move] of this.state.moves) if (found === undefined && place.startsWith(`${moved}.`)) found = { moved, move: copyMove(move) };
    if (found !== undefined) {
      const { moved, move } = found;
      const note = { message: move.note, start: move.start, end: move.end };
      const path = this.pathOf(cx, moved);
      if (move.unassigned === true) throw new CompileError("E0205", `'${path}' is used before being assigned, so '${this.text(cx, target)}' can't be set; assign all of '${path}' first`, target.start, target.end, note);
      throw new CompileError("E0201", `can't assign to '${this.text(cx, target)}' because '${path}' was moved`, target.start, target.end, note);
    }
    this.revive(cx, place);
  }

  // A way out of a try through its finally, from the state it left in: whichever way control
  // left the try and its catch, their variables are gone. Ways out leaving in a state one
  // already did share that one's check.
  /** @throws {CompileError} */
  finish(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, s: Ref<Stmt>, from: Ref<State>, ends: Mut<[State, State][]>): State {
    for (const [start, end] of ends) if (same(start, from)) return join(end, null);
    if (s.kind !== "try") return join(from, null);
    this.state = join(from, null);
    let gone = this.scopedList(cx, s.block);
    const caught = s.param !== undefined ? this.localAt(cx, s) : undefined;
    if (caught !== undefined) gone.push(caught);
    if (s.handler !== undefined) for (const x of s.handler) this.declaredIn(cx, x, gone, false);
    const tail = s.handler !== undefined && s.handler.length > 0 ? s.handler[s.handler.length - 1]!.end : s.block.length > 0 ? s.block[s.block.length - 1]!.end : s.start;
    this.dropped(cx, gone, tail);
    this.statements(cx, s.finalizer!);
    ends.push([join(from, null), join(this.state, null)]);
    return join(this.state, null);
  }

  // An error raised here goes to the innermost catch, which runs from this state too, and any
  // `finally` it leaves through.
  raising(this: Mut<this>, cx: Ref<MoveCx<T, B, I>>): void {
    if (this.frames.length === 0) return;
    const i = this.frames.length - 1;
    if (this.frames[i]!.kind === "catch") {
      const acc = join(this.frames[i]!.acc, this.state);
      this.frames[i]!.acc = acc;
      return;
    }
    this.note(cx, i, { kind: "raise", acc: null });
  }

  // A `break` or `continue` reaches its target, or first the innermost finally between them.
  jumping(this: Mut<this>, cx: Ref<MoveCx<T, B, I>>, target: Ref<Site>, which: "break" | "continue"): void {
    for (let i = this.frames.length; i > 0; i--) {
      const frame: Ref<Frame> = this.frames[i - 1]!;
      if (frame.kind === "catch") continue;
      if (target.start >= frame.start && target.end <= frame.end) break;
      this.note(cx, i - 1, { kind: "jump", target: { id: target.id, start: target.start, end: target.end }, which, acc: null });
      return;
    }
    if (which === "break") this.exits.set(target.id, join(this.exits.get(target.id) ?? null, this.state));
    else this.nexts.set(target.id, join(this.nexts.get(target.id) ?? null, this.state));
  }

  // A `return` passes first through the innermost finally, if any.
  returning(this: Mut<this>, cx: Ref<MoveCx<T, B, I>>): void {
    for (let i = this.frames.length; i > 0; i--) {
      if (this.frames[i - 1]!.kind !== "finally") continue;
      this.note(cx, i - 1, { kind: "return", acc: null });
      return;
    }
  }

  // Records a way out through the finally at frame `i`, joining this state into the times it
  // was taken.
  note(this: Mut<this>, cx: Ref<MoveCx<T, B, I>>, i: usize, exit: Exit): void {
    const acc = join(null, this.state);
    for (let k: usize = 0; k < this.frames[i]!.exits.length; k++) {
      const e: Ref<Exit> = this.frames[i]!.exits[k]!;
      if (e.kind !== exit.kind || (e.kind === "jump" && (e.target!.id !== exit.target!.id || e.which !== exit.which))) continue;
      const joined = join(e.acc, acc);
      this.frames[i]!.exits[k]!.acc = joined;
      return;
    }
    this.frames[i]!.exits.push({ kind: exit.kind, target: exit.target, which: exit.which, acc });
  }

  revive(this: Mut<this>, cx: Ref<MoveCx<T, B, I>>, place: string): void {
    if (this.state === null) return;
    for (const moved of [...this.state.moves.keys()]) if (moved === place || moved.startsWith(`${place}.`)) this.state.moves.delete(moved);
  }

  // The place an expression names: a variable or `this`, then fields, but not through a getter.
  key(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Named>): string | undefined {
    // `x!` is what `x` holds, so it is borrowed and changed as `x` is, as is `x as T`.
    if (projection(cx.tables.typing, cx.instance, this.coercions, e) && (e.kind === "nonNull" || e.kind === "as" || e.kind === "satisfies" || e.kind === "unsafe")) return this.key(cx, e.expr);
    if (e.kind === "shorthand" || e.kind === "ident") {
      const local = cx.instance.locals.getById(e.id);
      return local !== undefined ? String(cx.tables.arenas.localOf(local).id) : undefined;
    }
    if (e.kind === "this" || e.kind === "super") return "this";
    // Every element of an array is one place inside it: borrowing any borrows the array.
    if (e.kind === "index") {
      const object = e.kind === "index" && this.element(cx, e) ? this.key(cx, e.object) : undefined;
      return object === undefined ? undefined : `${object}.[]`;
    }
    if (e.kind !== "member" || cx.instance.calls.has(e) || cx.instance.copiesOut.has(e) || cx.tables.computed.has(e) || !cx.instance.types.has(e.object)) return undefined;
    const object = this.key(cx, e.object);
    return object === undefined ? undefined : `${object}.${e.name}`;
  }

  // Whether a closure holding a copy of this variable holds a mutable reference it lends again.
  reborrows(cx: Ref<MoveCx<T, B, I>>, from: LocalId): boolean {
    return cx.tables.typing.isCopy(cx.tables.arenas.localOf(from).type) && cx.tables.typing.holdsMut(cx.tables.arenas.localOf(from).type);
  }

  // What `x!` or `x ?? d` gives, handed over, can't come out of an Option that `x` only borrows.
  /** @throws {CompileError} */
  outOfBorrow(cx: Ref<MoveCx<T, B, I>>, option: Ref<Expr>, e: Ref<Expr>, consume?: Consumer): void {
    const t = cx.instance.types.get(option);
    if (consume !== undefined && this.state !== null && t !== undefined && this.isRef(cx, t) && !cx.tables.typing.isCopy(cx.instance.types.get(e)!)) {
      throw new CompileError("E0202", this.hinted(cx, cx.instance.types.get(e)!, "can't move a value out of a reference to it, which only borrows it; use '.clone()' to hand over a copy"), e.start, e.end);
    }
  }

  // A closure made here: what it borrows must be free to lend, and what it moves in leaves.
  /** @throws {CompileError} */
  made(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>): void {
    const parts = this.captured(cx, e);
    // A copy the closure holds of a variable that a nested function it calls changes wouldn't
    // see the change, as JavaScript's closure would.
    for (const c of parts) {
      if (!c.held || !cx.tables.typing.isCopy(cx.tables.arenas.localOf(c.from!).type)) continue;
      let changed = false;
      for (const q of parts) if (q.place === c.place && q.mutable && !q.held) changed = true;
      if (!changed) continue;
      const name = cx.tables.arenas.localOf(c.from!).name;
      throw new CompileError("E0210", `this closure holds its own copy of '${name}', which a nested function it calls changes, so it wouldn't see the change; pass '${name}' as a parameter instead`, c.at.start, c.at.end);
    }
    for (const c of parts) {
      this.usable(cx, c.at, c.place);
      const copied = c.from !== undefined && cx.tables.typing.isCopy(cx.tables.arenas.localOf(c.from).type);
      if (!c.held || copied) {
        const mutably = c.mutable || (c.held && this.reborrows(cx, c.from!));
        this.free(cx, c.place, c.at, mutably ? "lend mutably" : "read");
      }
      else {
        this.free(cx, c.place, c.at, "move");
        const name = cx.tables.arenas.localOf(c.from!).name;
        if (this.state !== null) this.state.moves.set(c.place, { start: c.at.start, end: c.at.end, note: `'${name}' moved here into a closure, which holds it now`, passes: copyPasses(this.passes) });
        // A closure moving one of this closure's captures into itself moves it out of this one.
        if ((cx.instance.captures !== undefined && cx.instance.captures.has(c.from!))) this.movedOut.add(c.from!);
      }
    }
  }

  // The places a closure captures, where it first uses each, the variable, if not `this`,
  // whether it changes it, and whether it holds it rather than borrowing it.
  captured(cx: Ref<MoveCx<T, B, I>>, e: Ref<Expr>): Capture[] {
    let out: Capture[] = [];
    // A nested function's declaration makes nothing; each use as a value makes its closure, from
    // this body's bindings for what it uses.
    const built = e.kind === "ident" ? cx.instance.envs?.get(e) : undefined;
    if (built !== undefined) {
      this.envCaptures(cx, built.of, built.env, { start: e.start, end: e.end }, out);
      return out;
    }
    if (e.kind !== "arrow" || (cx.tables.nestedFunctions.has(e) && !e.async)) return out;
    const inner = cx.tables.arenas.instanceOf(cx.instance.calls.get(e)!);
    const fields = cx.tables.typing.rec(inner.closure!).fields;
    let i: usize = 0;
    for (const [alias, from] of inner.captures!) {
      const use = inner.captureUses!.get(alias);
      const mutable = inner.changed!.has(alias);
      const held = !this.isRef(cx, fields[i]!.type);
      i++;
      if (use === undefined) continue;
      if (from === "this") out.push({ place: "this", at: this.spot(cx, use as Named), mutable, held: false });
      else out.push({ place: String(cx.tables.arenas.localOf(from).id), at: this.spot(cx, use as Named), from, mutable, held });
    }
    // A closure owning what it captures holds the nested functions it uses as made here, so it
    // borrows what they use.
    const made = cx.instance.made?.get(e);
    if (made !== undefined) for (const m of made) this.envCaptures(cx, m.of, m.env, e, out);
    return out;
  }

  // What a nested function's closure made at `at` captures, from the bindings in `env`.
  envCaptures(cx: Ref<MoveCx<T, B, I>>, of: InstanceId, env: Ref<LocalId[]>, at: Ref<Span>, out: Mut<Capture[]>): void {
    const inner = cx.tables.arenas.instanceOf(of);
    let aliases: LocalId[] = [];
    for (const alias of inner.captures!.keys()) aliases.push(alias);
    for (let i: usize = 0; i < env.length; i++) {
      const id = env[i]!;
      const name = cx.tables.arenas.localOf(id).name;
      out.push({ place: String(cx.tables.arenas.localOf(id).id), at: { start: at.start, end: at.end, shown: name }, from: id, mutable: inner.changed!.has(aliases[i]!), held: false });
    }
  }

  // `a ?? b` holding a reference gives the one either side holds.
  choosing(cx: Ref<MoveCx<T, B, I>>, e: Ref<Named>): boolean {
    return e.kind === "binary" && e.op === "??" && cx.tables.typing.holdsRef(cx.instance.types.get(e)!);
  }


  // Whether an expression is a reference a call gave, or a choice between such references.
  fromCall(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, given: Ref<Expr>): boolean {
    const e = given;
    if (unwraps(cx.tables.typing, cx.instance, this.coercions, e) && (e.kind === "nonNull" || e.kind === "as" || e.kind === "satisfies" || e.kind === "unsafe")) return this.fromCall(cx, e.expr);
    if (e.kind === "conditional") {
      if (cx.instance.types.has(e.then) && this.fromCallProjected(cx, e.then)) return true;
      return cx.instance.types.has(e.else) && this.fromCallProjected(cx, e.else);
    }
    if (e.kind === "binary" && this.choosing(cx, e)) {
      if (this.fromCallProjected(cx, e.left)) return true;
      return this.fromCallProjected(cx, e.right);
    }
    return cx.instance.borrowsFrom.has(e);
  }

  // The coercion a value meets, which the checker records on the outermost of its wrappers, so
  // it is read before its wrappers are taken off.
  coercionOf(cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>): Type | undefined {
    const c = this.coercions.get(e.id);
    if (c !== undefined) return c;
    if (unwraps(cx.tables.typing, cx.instance, this.coercions, e) && (e.kind === "nonNull" || e.kind === "as" || e.kind === "satisfies" || e.kind === "unsafe")) return this.coercionOf(cx, e.expr);
    return undefined;
  }








  // The indexes into arrays along a place's path, outermost first.
  /** @throws {CompileError} */
  indexes(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>): void {
    if (e.kind === "nonNull" && redundantBang(e)) {
      this.indexes(cx, e.expr);
      return;
    }
    if (e.kind !== "member" && e.kind !== "index") return;
    this.indexes(cx, e.object);
    if (e.kind === "index" && this.element(cx, e)) this.expr(cx, e.index);
  }

  // Whether an expression is an index into an array.
  element(cx: Ref<MoveCx<T, B, I>>, e: Ref<Named>): boolean {
    return e.kind === "index" && this.array(cx, e.object);
  }

  // Whether an expression's value is an array, or a reference to one.
  // A generator's variables live in the generator itself, which may move between `next()`
  // calls, so no reference into one may still be in use at a `yield`. What a reference
  // parameter points to, and an array's elements, live elsewhere.
  /** @throws {CompileError} */
  stillBorrowed(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, e: Ref<Expr>): void {
    if (this.state === null) return;
    // The first such loan, found before its message is built.
    let found: Loan | undefined = undefined;
    for (const loan of this.state.loans.values()) {
      if (found !== undefined || loan.loop === true || loan.guard === true || !this.live(cx, loan, e.end)) continue;
      const parts = loan.place.split(".");
      const n = parseInt(parts[0]!);
      const local = n !== undefined ? this.byId.get(n as usize) : undefined;
      if (local === undefined || this.isRef(cx, cx.tables.arenas.localOf(local).type) || parts.slice(1).includes("[]")) continue;
      found = copyLoan(loan);
    }
    if (found === undefined) return;
    const lent = this.pathOf(cx, found.place);
    throw new CompileError("E0203", `a reference into '${lent}' is still in use at this 'yield'; a generator's variables move with it between 'next()' calls, so let the reference end before the yield`, e.start, e.end, {
      message: `'${lent}' is borrowed here`, start: found.start, end: found.end,
    });
  }

  generator(cx: Ref<MoveCx<T, B, I>>, e: Ref<Expr>): boolean {
    const t = cx.instance.types.get(e);
    const held = t !== undefined ? this.deref(cx, t) : undefined;
    return held !== undefined && (cx.tables.typing.yieldsOf(held) !== undefined || cx.tables.typing.yieldsOf(held, true) !== undefined);
  }

  locking(cx: Ref<MoveCx<T, B, I>>, e: Ref<Expr>): boolean {
    const t = cx.instance.types.get(e);
    const r = t !== undefined ? this.record(cx, this.deref(cx, t)) : undefined;
    return r?.kind === "shared" || (r?.kind === "interior" && (r.which === "Lock" || r.which === "RwLock"));
  }

  mapped(cx: Ref<MoveCx<T, B, I>>, e: Ref<Expr>): boolean {
    const t = cx.instance.types.get(e);
    return t !== undefined && this.record(cx, this.deref(cx, t))?.kind === "map";
  }

  array(cx: Ref<MoveCx<T, B, I>>, e: Ref<Expr>): boolean {
    const t = cx.instance.types.get(e);
    const kind = t !== undefined ? this.record(cx, this.deref(cx, t))?.kind : undefined;
    return kind === "array" || kind === "fixed";
  }

  // Moving a value out of an array by index would leave a hole in it, as in Rust.
  elementMove(cx: Ref<MoveCx<T, B, I>>, e: Ref<Named>, type: Type): CompileError {
    const advice = cx.tables.typing.holdsHandle(type, true) ? "" : `'${this.text(cx, e)}.clone()' to take a copy, or `;
    const t = e.kind === "index" ? cx.instance.types.get(e.object) : undefined;
    const inline = t !== undefined && this.record(cx, this.deref(cx, t))?.kind === "fixed";
    if (inline) return new CompileError("E0202", `'${this.text(cx, e)}' can't be moved out of its fixed array, which keeps every element${advice !== "" ? `; use ${advice.slice(0, -5)}` : ""}`, e.start, e.end);
    return new CompileError("E0202", `'${this.text(cx, e)}' can't be moved out of its array; use ${advice}'pop()' to take the last element out`, e.start, e.end);
  }

  // How a place reads in a message.
  text(cx: Ref<MoveCx<T, B, I>>, e: Ref<Named>): string {
    // A tuple's element reads as it is written, `t[0]`.
    if (e.kind !== "shorthand") {
      if (e.kind === "index" && e.index.kind === "int" && cx.tables.restStarts.has(e.object) && e.object.kind === "member") return `${this.text(cx, e.object.object)}${restSuffix(cx.tables.restStarts, e)}`;
      if (e.kind === "member" && cx.tables.restStarts.has(e)) return `${this.text(cx, e.object)}${restSuffix(cx.tables.restStarts, e)}`;
    }
    if (e.kind === "member" && e.name === EMBEDDED) return this.text(cx, e.object);
    if (e.kind === "member") return /^\d+$/.test(e.name) ? `${this.text(cx, e.object)}[${e.name}]` : `${this.text(cx, e.object)}.${e.name}`;
    if (e.kind === "index") return `${this.text(cx, e.object)}[${indexText(e.index)}]`;
    if (e.kind === "nonNull") return `${this.text(cx, e.expr)}!`;
    return e.kind === "ident" || e.kind === "shorthand" ? e.name : e.kind === "this" || e.kind === "super" ? "this" : "(...)";
  }

  // A place's path as written, from the variable's name.
  pathOf(this: Mut<this>, cx: Mut<MoveCx<T, B, I>>, place: string): string {
    // The rest field's name is dots too, so it is split out before the path is.
    const [id, ...fields] = place.replaceAll("....", ".\0").split(".").map((part) => (part === "\0" ? "..." : part));
    let local: LocalId | undefined = undefined;
    for (const l of cx.instance.locals.values()) if (local === undefined && String(cx.tables.arenas.localOf(l).id) === id) local = l;
    const name = local !== undefined ? cx.tables.arenas.localOf(local).name : id;
    // A rest tuple's array is its elements from where its fixed ones end, as `t[1...]`.
    const lowered = local !== undefined ? cx.tables.typing.lower(cx.tables.arenas.localOf(local).type) : undefined;
    const held = this.record(cx, lowered);
    const start = held?.kind === "object" && held.rest !== undefined ? held.fields.length - 1 : undefined;
    // The collection a class extending Map or Set embeds reads as the object itself.
    const named = fields.filter((part) => part !== EMBEDDED).map((part, i) => (part === "..." ? (i === 0 && start !== undefined ? `[${start}...]` : "[...]") : part === "[]" ? "[...]" : part));
    return [name, ...named].join(".").replaceAll(".[", "[").replace(/\.(\d+)(?=\.|\[|$)/g, "[$1]");
  }
}


// Following a value through its wrappers to the place it reads. These take what they read
// rather than the move checker, since a reference a method returns can't point into its
// arguments.
type Coercions = Map<usize, Type>;

function narrowsUnion(typing: Mut<Typing>, instance: Ref<Instance>, coercions: Ref<Coercions>, e: Ref<Named>): boolean {
  if (e.kind !== "as") return false;
  const from = coercions.get(e.expr.id) ?? instance.types.get(e.expr);
  const to = instance.types.get(e);
  if (from === undefined || to === undefined) return false;
  const lowered = typing.lower(from);
  if (typeof lowered === "string" || typing.rec(lowered).kind !== "union") return false;
  const target = typing.lower(to);
  return lowered !== target && !typing.fits(lowered, target);
}

function transparent(typing: Mut<Typing>, instance: Ref<Instance>, coercions: Ref<Coercions>, e: Ref<Named>): boolean {
  return (e.kind === "as" && !narrowsUnion(typing, instance, coercions, e)) || e.kind === "satisfies" || e.kind === "unsafe";
}

// Forms that read the place their operand names: `x!`, whatever the Option holds, and the
// transparent ones. `unwrapped` follows fewer, since it reads a value's own type and coercion.
function projection(typing: Mut<Typing>, instance: Ref<Instance>, coercions: Ref<Coercions>, e: Ref<Named>): boolean {
  return e.kind === "nonNull" || e.kind === "as" || transparent(typing, instance, coercions, e);
}





// Whether a wrapper is taken off a value to read it: `x!` when `x` is an Option holding a
// reference, an `as` narrowing a union to a member holding references, or a transparent form.
function unwraps(typing: Mut<Typing>, instance: Ref<Instance>, coercions: Ref<Coercions>, e: Ref<Expr>): boolean {
  return (e.kind === "nonNull" && typing.optionRef(instance.types.get(e.expr)) !== undefined) || (e.kind === "as" && narrowsUnion(typing, instance, coercions, e) && typing.holdsRef(instance.types.get(e)!)) || transparent(typing, instance, coercions, e);
}

// Whether a value a call gave is read from somewhere else: through a wrapper, a field, an element
// or a projection.
function projectsAway(instance: Ref<Instance>, e: Ref<Expr>): boolean {
  return (e.kind === "member" && !instance.calls.has(e)) || e.kind === "index" || e.kind === "nonNull" || e.kind === "as" || e.kind === "satisfies" || e.kind === "unsafe";
}




// A function held in a field is what its call lends, not the object holding it.
function fieldCall(tables: Mut<Tables>, instance: Ref<Instance>, e: Ref<Expr>): boolean {
  if (e.kind !== "call" || e.callee.kind !== "member") return false;
  const held = tables.typing.lower(instance.types.get(e.callee) ?? "void");
  if (typeof held === "string") return false;
  const h = tables.typing.rec(held);
  return h.kind === "closure" || (h.kind === "dyn" && tables.typing.callableOf.has(h.of));
}


// A loan's key for the `i`th place a value lends, apart from the others it lends at the same
// spot, as a closure's variables are when its environment is made from a call's or a name's.
// Other loans are keyed by whole numbers, or a temporary's by a half, so these keys and a
// call's captures and an assignment's hold take other fractions of an offset, which never
// equal those.
function partKey(start: usize, i: usize): f64 {
  return (start as f64) + ((i as f64) + 1) / 8192;
}

function copyPasses(passes: Ref<Map<usize, usize>>): Map<usize, usize> {
  let out = new Map<usize, usize>();
  for (const [loop, pass] of passes) out.set(loop, pass);
  return out;
}

function copySpot(at: Ref<Spot>): Spot {
  return { start: at.start, end: at.end, shown: at.shown };
}



// Whether two places are one, or one is inside the other.
function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
}

// Where each reference variable is used last: a use as an argument or receiver lasts until
// the call ends, and a use inside a loop the variable was declared outside of lasts until the
// loop ends, since the loop may come round to an earlier use.
function lastUses(tables: Ref<Tables>, body: Ref<Stmt[]>, instance: Ref<Instance>): Map<LocalId, f64> {
  let st: LastUseState = { last: new Map<LocalId, f64>(), loops: [], declared: new Map<LocalId, usize[]>() };
  for (const x of body) stmtUses(tables, instance, st, x);
  return st.last;
}

// The last use of each reference variable so far; the loops around the statement being read,
// innermost last, each by its id and end; and the loops each variable was declared inside.
type LastUseState = { last: Map<LocalId, f64>; loops: { id: usize; end: usize }[]; declared: Map<LocalId, usize[]> };

// An argument lent to the call, as a reference or a value holding references, is in use
// until the call ends.
function lentTo(tables: Ref<Tables>, instance: Ref<Instance>, a: Ref<Expr>): boolean {
  const t = instance.coercions.get(a) ?? instance.types.get(a);
  return t !== undefined && tables.typing.holdsRef(t);
}

function markUsed(tables: Ref<Tables>, st: Mut<LastUseState>, id: LocalId | undefined, at: usize): void {
  if (id === undefined || !tables.typing.holdsRef(tables.arenas.localOf(id).type)) return;
  const inside = st.declared.get(id);
  let outer: usize = at;
  for (const l of st.loops) {
    if (inside !== undefined && inside.includes(l.id)) continue;
    outer = l.end;
    break;
  }
  st.last.set(id, Math.max(st.last.get(id) ?? -1, at as f64, outer as f64));
}

function stmtUses(tables: Ref<Tables>, instance: Ref<Instance>, st: Mut<LastUseState>, s: Ref<Stmt>): void {
  switch (s.kind) {
    case "expr":
      exprUses(tables, instance, st, s.expr);
      return;
    case "let": {
      st.declared.set(instance.locals.get(s)!, loopIds(st.loops));
      const d: Ref<Declarator> = s.declarations[0]!;
      if (d.init !== undefined) exprUses(tables, instance, st, d.init);
      return;
    }
    case "if":
      exprUses(tables, instance, st, s.cond);
      for (const x of s.then) stmtUses(tables, instance, st, x);
      if (s.else !== undefined) for (const x of s.else) stmtUses(tables, instance, st, x);
      return;
    case "try":
      for (const x of s.block) stmtUses(tables, instance, st, x);
      if (s.handler !== undefined) for (const x of s.handler) stmtUses(tables, instance, st, x);
      if (s.finalizer !== undefined) for (const x of s.finalizer) stmtUses(tables, instance, st, x);
      return;
    case "block":
    case "comptime":
    case "unsafe":
      {
        for (const x of s.body) stmtUses(tables, instance, st, x);
        return;
      }
    case "while":
    case "doWhile":
      st.loops.push({ id: s.id, end: s.end });
      exprUses(tables, instance, st, s.cond);
      for (const x of s.body) stmtUses(tables, instance, st, x);
      st.loops.pop();
      return;
    case "for":
      if (s.init !== undefined) stmtUses(tables, instance, st, s.init);
      st.loops.push({ id: s.id, end: s.end });
      if (s.test !== undefined) exprUses(tables, instance, st, s.test);
      if (s.update !== undefined) exprUses(tables, instance, st, s.update);
      for (const x of s.body) stmtUses(tables, instance, st, x);
      st.loops.pop();
      return;
    case "forOf":
      exprUses(tables, instance, st, s.right);
      st.loops.push({ id: s.id, end: s.end });
      for (const x of s.body) stmtUses(tables, instance, st, x);
      st.loops.pop();
      return;
    case "labeled":
      stmtUses(tables, instance, st, s.body);
      return;
    case "switch":
      exprUses(tables, instance, st, s.discriminant);
      for (const c of s.cases) {
        if (c.test !== undefined) exprUses(tables, instance, st, c.test);
        for (const x of c.body) stmtUses(tables, instance, st, x);
      }
      return;
    case "return":
      if (s.value !== undefined) exprUses(tables, instance, st, s.value);
      return;
    case "throw":
      exprUses(tables, instance, st, s.value);
      return;
  }
}
function exprUses(tables: Ref<Tables>, instance: Ref<Instance>, st: Mut<LastUseState>, e: Ref<Expr>, call?: usize): void {
  switch (e.kind) {
    // A nested function used as a value uses what its closure lends from here.
    case "ident": {
      const env = instance.envs?.get(e)?.env;
      if (env !== undefined) for (const l of env) markUsed(tables, st, l, call ?? e.end);
      markUsed(tables, st, instance.locals.get(e), call ?? e.end);
      return;
    }
    case "member":
      exprUses(tables, instance, st, e.object, call);
      return;
    case "object":
      for (const p of e.props) {
        if (p.kind === "property" || p.kind === "spread") exprUses(tables, instance, st, p.value);
        else if (p.kind === "shorthand") markUsed(tables, st, instance.locals.get(p), p.end);
      }
      return;
    case "new": {
      if (e.args !== undefined) for (const a of e.args) exprUses(tables, instance, st, a, lentTo(tables, instance, a) ? e.end : undefined);
      return;
    }
    case "call": {
      if (e.callee.kind === "member") exprUses(tables, instance, st, e.callee.object, e.end);
      // A closure called through a variable is in use until the call ends, as is what a
      // nested function called by name uses.
      if (e.callee.kind === "ident") exprUses(tables, instance, st, e.callee, e.end);
      const env = instance.envs?.get(e)?.env;
      if (env !== undefined) for (const l of env) markUsed(tables, st, l, e.end);
      for (const a of e.args) exprUses(tables, instance, st, a, lentTo(tables, instance, a) ? e.end : undefined);
      return;
    }
    case "unary":
    case "update":
      exprUses(tables, instance, st, e.operand);
      return;
    case "template":
      for (const x of e.exprs) exprUses(tables, instance, st, x);
      return;
    case "tagged":
      if (e.template.kind === "template") for (const x of e.template.exprs) exprUses(tables, instance, st, x);
      return;
    case "index":
      exprUses(tables, instance, st, e.object);
      exprUses(tables, instance, st, e.index);
      return;
    case "assign":
      exprUses(tables, instance, st, e.target);
      exprUses(tables, instance, st, e.value);
      return;
    case "conditional":
      exprUses(tables, instance, st, e.cond);
      if (instance.types.has(e.then)) exprUses(tables, instance, st, e.then, call);
      if (instance.types.has(e.else)) exprUses(tables, instance, st, e.else, call);
      return;
    case "match":
      exprUses(tables, instance, st, e.subject);
      for (const arm of e.arms) {
        if (arm.guard !== undefined) exprUses(tables, instance, st, arm.guard);
        if (arm.body.kind === "block") stmtUses(tables, instance, st, arm.body);
        else exprUses(tables, instance, st, arm.body, call);
      }
      return;
    // A closure uses what it captures where it is made; whatever holds it holds that after.
    case "arrow": {
      for (const from of tables.arenas.instanceOf(instance.calls.get(e)!).captures!.values()) if (from !== "this") markUsed(tables, st, from, call ?? e.end);
      const held = instance.made?.get(e);
      if (held !== undefined) for (const { env } of held) for (const l of env) markUsed(tables, st, l, call ?? e.end);
      return;
    }
    case "throw":
      exprUses(tables, instance, st, e.value);
      return;
    case "comptime":
      return;
    case "nonNull":
    case "as":
    case "satisfies":
    case "unsafe":
      exprUses(tables, instance, st, e.expr, call);
      return;
    case "binary":
      exprUses(tables, instance, st, e.left);
      exprUses(tables, instance, st, e.right);
      return;
    case "array":
      for (const x of e.elements) if (x !== undefined) exprUses(tables, instance, st, x.kind === "spread" ? x.value : x);
      return;
    case "yield":
      if (e.value !== undefined) exprUses(tables, instance, st, e.value);
      return;
    // A pipe's topic is declared where the pipe runs, as a `let` is.
    case "pipe":
      exprUses(tables, instance, st, e.value);
      if (instance.locals.has(e)) st.declared.set(instance.locals.get(e)!, loopIds(st.loops));
      exprUses(tables, instance, st, e.body, call);
      return;
    case "int":
    case "float":
    case "bigint":
    case "regex":
    case "bool":
    case "string":
    case "null":
    case "this":
    case "super":
      return;
    default:
      assert(false, `the last-use walk has no case for '${e.kind}' expressions`);
  }
}

function loopIds(loops: Ref<{ id: usize; end: usize }[]>): usize[] {
  let out: usize[] = [];
  for (const l of loops) out.push(l.id);
  return out;
}

// The local an id names, or nothing without one.
function localRecord<A extends Lifetime>(arenas: Ref<Arenas, A>, id: LocalId | undefined): Ref<Local, A> | undefined {
  return id !== undefined ? arenas.localOf(id) : undefined;
}

// What has moved, and what is lent, on either of two ways here. Moves and loans are never changed
// where they are, only replaced, so each state gets copies of its own.
function join(a: Ref<State>, b: Ref<State>): State {
  if (a === null) return b === null ? null : copyState(b);
  if (b === null) return copyState(a);
  let joined = copyState(a);
  for (const [k, v] of b.moves) if (!joined.moves.has(k)) joined.moves.set(k, copyMove(v));
  for (const [k, v] of b.loans) {
    const mine = joined.loans.get(k);
    if (mine === undefined) {
      joined.loans.set(k, copyLoan(v));
      continue;
    }
    let both = copyLoan(mine);
    for (const h of v.holders) both.holders.add(h);
    joined.loans.set(k, both);
  }
  return joined;
}

function copyState(s: Ref<NonNullable<State>>): NonNullable<State> {
  let moves = new Map<string, Move>();
  for (const [k, v] of s.moves) moves.set(k, copyMove(v));
  let loans = new Map<f64, Loan>();
  for (const [k, v] of s.loans) loans.set(k, copyLoan(v));
  return { moves, loans };
}

function copyMove(m: Ref<Move>): Move {
  let passes = new Map<usize, usize>();
  for (const [loop, pass] of m.passes) passes.set(loop, pass);
  let out: Move = { start: m.start, end: m.end, note: m.note, passes };
  if (m.unassigned !== undefined) out.unassigned = m.unassigned;
  return out;
}

function copyLoan(l: Ref<Loan>): Loan {
  let holders = new Set<LocalId>();
  for (const h of l.holders) holders.add(h);
  let out: Loan = { place: l.place, mutable: l.mutable, start: l.start, end: l.end, holders };
  if (l.call !== undefined) out.call = l.call;
  if (l.callAt !== undefined) out.callAt = l.callAt;
  if (l.loop !== undefined) out.loop = l.loop;
  if (l.guard !== undefined) out.guard = l.guard;
  return out;
}

function same(a: Ref<State>, b: Ref<State>): boolean {
  if (a === null || b === null) return a === null && b === null;
  if (a.moves.size !== b.moves.size) return false;
  for (const k of a.moves.keys()) if (!b.moves.has(k)) return false;
  return loansKey(a) === loansKey(b);
}

function loansKey(s: Ref<NonNullable<State>>): string {
  let parts: string[] = [];
  for (const [k, l] of s.loans) {
    let holders: string[] = [];
    for (const h of l.holders) holders.push(`${h}`);
    holders.sort();
    parts.push(`${k}:${holders.join(",")}`);
  }
  parts.sort();
  return parts.join(";");
}

function identName(p: Ref<Pattern>): string {
  return p.kind === "ident" ? p.name : "";
}
