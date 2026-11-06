import type { Tables } from "./compilation.ts";
import assert from "node:assert";
import { bodyOf, type Arenas, type InstanceId, type LocalId } from "./arenas.ts";
import type { Instance, Local, Origin } from "./check.ts";
import type { Body } from "./classes.ts";
import { CompileError } from "./diag.ts";
import type { Declarator, Expr, ObjectProp, Param, Pattern, Span, Stmt } from "./parser.ts";
import { bindings } from "./match.ts";
import { rustClassOf } from "./rust.ts";
import { indexText, MAP_CHANGES, restBase, restSuffix } from "./values.ts";
import { holdsNode } from "./check.ts";
import { EMBEDDED, redundantBang, bare, type ObjectType, type RefType, type Type, type UnionType } from "./typing.ts";
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

// How a consuming use hands a value over, as the note says it, given how the place reads.
type Consumer = (place: string) => string;

// What names a place: a variable, `this`, a field, or a shorthand property naming a variable.
type Named = Expr | Extract<ObjectProp, { kind: "shorthand" }>;

// What an access does to a place.
type Access = "read" | "change" | "move" | "lend" | "lend mutably";

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
export function checkMoves(tables: Mut<Tables>, f: Ref<Body>, instance: Ref<Instance>, origins: Origin[]): void {
  let checker = new MoveChecker(tables, f, instance, origins);
  checker.run();
}

// Generic over its tables, body and instance, since a parameter of an object type stands for
// any type fitting it, and a field holding a mutable reference needs the exact type.
class MoveChecker<T extends Tables, B extends Body, I extends Instance> {
  tables: Mut<T>;
  f: Ref<B>;
  instance: Ref<I>;
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

  constructor(tables: Mut<T>, f: Ref<B>, instance: Ref<I>, origins: Origin[]) {
    let coercions = new Map<usize, Type>();
    for (const [e, to] of instance.coercions) {
      const ref = tables.typing.optionRef(to);
      const from = instance.types.get(e);
      const fromRef = from !== undefined && typeof from !== "string" && tables.typing.rec(from).kind === "ref";
      let given: Type = to;
      if (ref !== undefined && from !== undefined && from !== "null" && tables.typing.optionRef(from) === undefined && !fromRef) given = ref;
      coercions.set(e.id, given);
    }
    let last = lastUses(tables, f.body, instance);
    const kept = tables.arenas.addLocal({ name: "this", type: "void", mutable: false, param: false, id: SYNTHETIC * 3 }).localId;
    last.set(kept, Infinity);
    this.tables = tables;
    this.f = f;
    this.instance = instance;
    this.origins = origins;
    this.coercions = coercions;
    this.last = last;
    this.kept = kept;
    for (const l of instance.locals.values()) this.byId.set(tables.arenas.localOf(l).id, l);
  }

  /** @throws {CompileError} */
  run(this: Mut<this>): void {
    // A reference parameter holds a borrow its caller made, of something outside this function.
    const f = this.f;
    for (let i: usize = 0; i < f.params.length; i++) {
      const p: Ref<Param> = f.params[i]!;
      const id = this.localAt(p);
      if (id === undefined) continue;
      const type = this.tables.arenas.localOf(id).type;
      if (!this.tables.typing.holdsRef(type) || this.state === null) continue;
      const mutable = this.isRef(type) && this.tables.typing.rec(type).mutable;
      this.state.loans.set(-1 - (i as f64), { place: `param ${i}`, mutable, start: p.start, end: p.end, holders: new Set([id]) });
    }
    this.statements(f.body);
  }

  // The local a name, declaration, parameter or shorthand property refers to.
  localAt(n: Ref<Id>): LocalId | undefined {
    return this.instance.locals.getById(n.id);
  }
  isRef(t: Type): t is RefType {
    return typeof t !== "string" && this.tables.typing.rec(t).kind === "ref";
  }
  isUnion(t: Type): t is UnionType {
    return typeof t !== "string" && this.tables.typing.rec(t).kind === "union";
  }
  // What a reference refers to, or the type itself.
  deref(t: Type): Type {
    return this.isRef(t) ? this.tables.typing.rec(t).to : t;
  }
  // The record of a type that isn't a primitive.
  record(t: Type | undefined) {
    return t === undefined || typeof t === "string" ? undefined : this.tables.typing.rec(t);
  }

  // The reference variables declared anywhere inside a statement.
  inside(s: Ref<Stmt>): LocalId[] {
    let out: LocalId[] = [];
    this.declaredIn(s, out, true);
    return out;
  }

  // The variables declared anywhere inside a statement, or only the reference ones, added to
  // `out`. A catch's parameter counts unless only references do.
  declaredIn(s: Ref<Stmt>, out: Mut<LocalId[]>, refs: boolean): void {
    switch (s.kind) {
      case "let": {
        const id = this.localAt(s)!;
        if (!refs || this.tables.typing.holdsRef(this.tables.arenas.localOf(id).type)) out.push(id);
        return;
      }
      case "if":
        for (const x of s.then) this.declaredIn(x, out, refs);
        if (s.else !== undefined) for (const x of s.else) this.declaredIn(x, out, refs);
        return;
      case "block":
      case "comptime":
      case "unsafe":
      case "while":
      case "doWhile":
        for (const x of s.body) this.declaredIn(x, out, refs);
        return;
      case "for":
        if (s.init !== undefined) this.declaredIn(s.init, out, refs);
        for (const x of s.body) this.declaredIn(x, out, refs);
        return;
      case "forOf": {
        const each = this.localAt(s.left)!;
        if (!refs || this.tables.typing.holdsRef(this.tables.arenas.localOf(each).type)) out.push(each);
        for (const x of s.body) this.declaredIn(x, out, refs);
        return;
      }
      case "labeled":
        return this.declaredIn(s.body, out, refs);
      case "switch":
        for (const c of s.cases) for (const x of c.body) this.declaredIn(x, out, refs);
        return;
      case "try": {
        if (refs) return;
        for (const x of s.block) this.declaredIn(x, out, refs);
        const caught = s.param !== undefined ? this.localAt(s) : undefined;
        if (caught !== undefined) out.push(caught);
        if (s.handler !== undefined) for (const x of s.handler) this.declaredIn(x, out, refs);
        if (s.finalizer !== undefined) for (const x of s.finalizer) this.declaredIn(x, out, refs);
        return;
      }
      default:
        return;
    }
  }

  // A reference declared in a list of statements lets go of what it holds as the list ends.
  /** @throws {CompileError} */
  statements(this: Mut<this>, list: Ref<Stmt[]>) {
    for (const s of list) this.statement(s);
    for (const s of list) if (s.kind === "let" && this.tables.typing.holdsRef(this.tables.arenas.localOf(this.localAt(s)!).type)) this.release(this.localAt(s)!);
    this.ended(list);
  }

  // A list's own variables end with it, so a borrow of one still held by a variable from outside
  // the list, and used after it, would point at a dropped value.
  /** @throws {CompileError} */
  ended(this: Mut<this>, list: Ref<Stmt[]>) {
    if (list.length === 0) return;
    let gone: LocalId[] = [];
    for (const s of list) if (s.kind === "let") gone.push(this.localAt(s)!);
    this.dropped(gone, list[list.length - 1]!.end);
  }

  // Checks that no borrow of a variable that has gone out of scope by `end` is still held by a
  // variable from outside, and used after. A variable that is itself a reference only copies a
  // pointer to what it borrows, whose own loans are checked where that ends.
  /** @throws {CompileError} */
  dropped(this: Mut<this>, gone: Ref<LocalId[]>, end: usize) {
    if (this.state === null || gone.length === 0) return;
    let byName = new Map<string, LocalId>();
    for (const l of gone) byName.set(String(this.tables.arenas.localOf(l).id), l);
    // The first such loan, found before its message is built.
    let found: { place: string; start: usize; end: usize; root: LocalId; outside: LocalId[] } | undefined = undefined;
    for (const loan of this.state.loans.values()) {
      const root = byName.get(loan.place.split(".")[0]!);
      if (root === undefined || this.isRef(this.tables.arenas.localOf(root).type)) continue;
      let outside: LocalId[] = [];
      for (const h of loan.holders) if (!gone.includes(h) && (this.last.get(h) ?? -1) > (end as f64)) outside.push(h);
      if (outside.length === 0) continue;
      found = { place: loan.place, start: loan.start, end: loan.end, root, outside };
      break;
    }
    if (found === undefined) return;
    const lent = this.pathOf(found.place);
    const holders = this.named(found.outside).join(" and ");
    throw new CompileError("E0204", `'${lent}' doesn't live long enough: ${holders} still ${found.outside.length > 1 ? "borrow" : "borrows"} it after its block ends`, found.start, found.end, {
      message: `'${this.tables.arenas.localOf(found.root).name}' is dropped here, at the end of its block; declare it outside the block, or give ${holders} an owned value`,
      start: end, end,
    });
  }

  // Every variable a statement declares, at any depth, which are gone once it has run, however
  // control left it: `let`s, a loop's own variables and a catch's parameter.
  scoped(s: Ref<Stmt>): LocalId[] {
    let out: LocalId[] = [];
    this.declaredIn(s, out, false);
    return out;
  }

  // The reference variables a list of statements declares, at any depth.
  insideList(list: Ref<Stmt[]>): LocalId[] {
    let out: LocalId[] = [];
    for (const s of list) this.declaredIn(s, out, true);
    return out;
  }

  // Every variable a list of statements declares, at any depth.
  scopedList(list: Ref<Stmt[]>): LocalId[] {
    let out: LocalId[] = [];
    for (const s of list) this.declaredIn(s, out, false);
    return out;
  }

  /** @throws {CompileError} */
  statement(this: Mut<this>, s: Ref<Stmt>) {
    switch (s.kind) {
      case "expr":
        this.expr(s.expr, undefined, true);
        return;
      case "let": {
        const d = s.declarations[0]!;
        const name = d.target.kind === "ident" ? d.target.name : "";
        const local = this.tables.arenas.localOf(this.localAt(s)!);
        // A declaration run again by a loop makes a fresh variable, which holds nothing yet.
        this.release(local.localId);
        if (!d.init) {
          if (this.state !== null) this.state.moves.set(String(local.id), { start: d.start, end: d.end, note: `'${name}' is declared here without a value`, passes: new Map(this.passes), unassigned: true });
          return;
        }
        this.expr(d.init, (p) => `'${p}' moved here: '${name}' owns it now; use '${p}.clone()' to keep a copy`);
        this.revive(String(local.id));
        if (this.tables.typing.holdsRef(local.type)) this.rehold(local.localId, d.init);
        return;
      }
      case "if": {
        this.expr(s.cond);
        const before = join(this.state, null);
        this.statements(s.then);
        const then = this.state;
        this.state = before;
        if (s.else) this.statements(s.else);
        this.state = join(then, this.state);
        return;
      }
      case "block":
      case "comptime":
      case "unsafe":
        return this.statements(s.body);
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
          this.statements(s.block);
          const handler = this.frames.pop()!;
          const after = join(this.state, null);
          this.state = handler.acc;
          // A raise left the block wherever it was, its variables gone by the catch.
          this.dropped(this.scopedList(s.block), s.block.length > 0 ? s.block[s.block.length - 1]!.end : s.start);
          const caught = s.param !== undefined ? this.localAt(s) : undefined;
          if (caught !== undefined) this.revive(String(this.tables.arenas.localOf(caught).id));
          this.statements(s.handler);
          if (caught !== undefined) this.dropped([caught], s.handler.length > 0 ? s.handler[s.handler.length - 1]!.end : s.start);
          this.state = join(after, this.state);
        } else this.statements(s.block);
        if (!finalized) return;
        const fin = this.frames.pop()!;
        const normal = join(this.state, null);
        // Ways out that reach the finally in the same state share one check of it, which keeps
        // nested finallies from multiplying the work.
        let ends: [State, State][] = [];
        for (const exit of fin.exits) {
          this.state = this.finish(s, exit.acc, ends);
          if (exit.kind === "raise") this.raising();
          else if (exit.kind === "return") this.returning();
          else this.jumping(exit.target!, exit.which!);
        }
        this.state = this.finish(s, normal, ends);
        return;
      }
      case "while":
      case "doWhile":
        return this.loop(s);
      case "for":
        if (s.init) this.statement(s.init);
        return this.loop(s);
      // The loop reads its array once and keeps it lent, shared, until it ends; its variable,
      // when it is a reference, borrows the array as well.
      case "forOf": {
        // Like JavaScript closing a generator when its loop ends, the loop takes one it owns.
        const taken = this.instance.types.get(s.right);
        if (taken !== undefined && !this.isRef(taken) && (this.tables.typing.yieldsOf(taken) ?? this.tables.typing.yieldsOf(taken, true)) !== undefined) {
          this.expr(s.right, (p) => `'${p}' moved here: the 'for...of' loop takes the generator over, as JavaScript closes it when the loop ends; call 'next()' instead to keep it`);
          // What the generator borrows stays lent until the loop ends.
          const holder = this.loopHolder(s);
          if (this.key(s.right) !== undefined) this.inherit(holder, s.right);
          else this.hold(holder, s.right);
          // Each pass gives the variable a new value, which it owns.
          this.loop(s, String(this.tables.arenas.localOf(this.localAt(s.left)!).id));
          return;
        }
        this.expr(s.right);
        const place = this.key(s.right);
        const each = this.localAt(s.left)!;
        const eachRef = this.tables.typing.holdsRef(this.tables.arenas.localOf(each).type);
        // A string's loop holds a reference of its own, so its variable stays free to change.
        const text = (this.coercions.get(s.right.id) ?? this.instance.types.get(s.right)) === "string";
        // An `Iterable<T>` parameter's loop gives owned values, through the `[Symbol.iterator]()`
        // call it makes of a class, or at the definition, where nothing says what it stands for.
        const owning = text || s.await || this.instance.iterators?.has(s) === true || (taken !== undefined && this.tables.typing.iterableElement(taken) !== undefined && this.tables.typing.lower(taken) === taken);
        if (place !== undefined && this.state !== null && !text) {
          this.free(place, this.spot(s.right), "lend");
          this.state.loans.set(s.right.start, { place, mutable: false, start: s.right.start, end: s.right.end, holders: new Set(), call: "the loop", loop: true });
          if (eachRef) this.state.loans.set(-(s.start as f64) - 1, { place: `${place}.[]`, mutable: false, start: s.right.start, end: s.right.end, holders: new Set([each]) });
          // An array reached through a reference keeps what that reference borrows lent until
          // the loop ends, and an element that is a reference holds it too.
          // One holder per loop, so passes over it reach the same state and the check settles.
          this.inherit(this.loopHolder(s), s.right);
          if (eachRef) this.inherit(each, s.right);
        } else if (this.state !== null && !text && this.fromCall(this.projected(s.right))) {
          // Over a reference a call gave, or a field or element of one, the loop keeps what that
          // reference borrows lent until it ends.
          this.hold(this.loopHolder(s), this.projected(s.right));
          if (eachRef) this.hold(each, this.projected(s.right));
        }
        // Each pass may end the loop, like a condition that may be false. Each pass gives a
        // string's variable a new string, and a Channel's the value it received, which it owns.
        this.loop(s, owning ? String(this.tables.arenas.localOf(each).id) : undefined);
        if (this.state !== null) this.state.loans.delete(s.right.start);
        return;
      }
      case "labeled": {
        this.exits.set(s.id, null);
        this.statement(s.body);
        this.state = join(this.state, this.exits.get(s.id)!);
        this.dropped(this.scoped(s.body), s.end);
        return;
      }
      case "switch": {
        this.expr(s.discriminant);
        for (const c of s.cases) if (c.test) this.expr(c.test);
        this.exits.set(s.id, null);
        const entry = this.state;
        let falling: State = null;
        for (const c of s.cases) {
          this.state = join(entry, falling);
          this.statements(c.body);
          falling = this.state;
        }
        this.state = join(join(falling, this.exits.get(s.id)!), s.cases.some((c) => !c.test) ? null : entry);
        this.dropped(this.scoped(s), s.end);
        return;
      }
      case "break":
      case "continue": {
        const target = this.instance.jumps.get(s)!;
        this.jumping(target, s.kind);
        this.state = null;
        return;
      }
      // A thrown value leaves with the error, as a returned one does, or goes to a catch.
      case "throw":
        this.expr(s.value, (p) => `'${p}' moved here: throwing it hands it on`);
        this.raising();
        this.state = null;
        return;
      case "return":
        // A `return` in a match arm hands its value to the match and leaves the arm.
        if (this.instance.jumps.has(s)) {
          const arm = this.instance.jumps.get(s)!;
          if (s.value) this.expr(s.value, ...this.arms.get(arm.id)!);
          this.jumping(arm, "break");
          this.state = null;
          return;
        }
        if (s.value) {
          this.expr(s.value, () => "");
          // An arrow's expression body may be a call returning nothing.
          if (this.instance.types.has(s.value)) this.returned(s.value);
        }
        this.returning();
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
  loop(this: Mut<this>, s: Ref<Stmt>, revived?: string) {
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
      if (!bodyFirst) leaving = this.loopTest(s);
      if (revived !== undefined) this.revive(revived);
      if (s.kind === "while" || s.kind === "doWhile" || s.kind === "for" || s.kind === "forOf") this.statements(s.body);
      this.state = join(this.state, this.nexts.get(s.id)!);
      // However a pass ended, `continue` included, its body's variables are gone, and a holder
      // used anywhere in the loop is used again on the next pass.
      this.dropped(s.kind === "for" ? this.scopedList(s.body) : this.scoped(s), s.end - 1);
      // References declared in the body are gone by the time the loop comes round or ends,
      // however it left the body; a `for` loop's initializer outlives every pass.
      for (const local of s.kind === "for" ? this.insideList(s.body) : this.inside(s)) this.release(local);
      if (bodyFirst) leaving = this.loopTest(s);
      else if (s.kind === "for" && s.update !== undefined) this.expr(s.update, undefined, true);
      leaving = join(leaving, this.exits.get(s.id)!);
      const after = join(this.state, null);
      this.state = leaving;
      // However the loop ended, `break` included, its variables are gone.
      this.dropped(this.scoped(s), s.end);
      for (const local of this.inside(s)) this.release(local);
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
  loopTest(this: Mut<this>, s: Ref<Stmt>): State {
    if (s.kind === "forOf") return join(this.state, null);
    if (s.kind === "for") return s.test !== undefined ? this.condition(s.test) : null;
    if (s.kind === "while" || s.kind === "doWhile") return this.condition(s.cond);
    return null;
  }

  /** @throws {CompileError} */
  condition(this: Mut<this>, t: Ref<Expr>): State {
    this.expr(t);
    return t.kind === "bool" && t.value ? null : join(this.state, null);
  }

  // The holder of what a `for...of` loop keeps lent while it runs: one per loop, so passes over
  // it reach the same state and the check settles.
  loopHolder(this: Mut<this>, s: Ref<Stmt>): LocalId {
    let holder = this.loopHolders.get(s.id);
    if (holder === undefined) holder = this.tables.arenas.addLocal({ name: "for...of", type: "void", mutable: false, param: false, id: SYNTHETIC + s.start }).localId;
    this.loopHolders.set(s.id, holder);
    this.last.set(holder, s.end);
    return holder;
  }

  // Evaluates an expression. `consume` says how its value is handed over, when it is; a
  // value that is only read, like a receiver or an operand, is borrowed. A statement's value
  // is discarded.
  /** @throws {CompileError} */
  expr(this: Mut<this>, e: Ref<Expr>, consume?: Consumer, discarded = false): void {
    // A value lent to a reference stays where it is.
    const lentAs = this.coercions.get(e.id);
    if (lentAs && this.isRef(lentAs) && !this.isRef(this.instance.types.get(e)!)) consume = undefined;
    switch (e.kind) {
      case "int":
      case "bool":
      case "string":
        return;
      case "ident":
        if (this.instance.envs?.has(e)) return this.made(e);
        // A JsValue read out of JS gives a new value, leaving the JsValue as it was.
        return this.instance.locals.has(e) ? this.use(e, this.instance.copiesOut.has(e) ? undefined : consume) : undefined;
      case "super":
      case "this":
        this.free("this", this.spot(e), "read");
        if (this.f.self?.owned) return this.use(e, consume);
        if (consume && this.state && !this.tables.typing.isCopy(this.instance.types.get(e)!)) {
          throw new CompileError("E0202", this.hinted(this.instance.types.get(e)!, "'this' can't be moved, since it is only borrowed here; use 'this.clone()' to hand over a copy"), e.start, e.end);
        }
        return;
      case "member":
        if (!this.instance.types.has(e.object)) return;
        if (this.key(e) !== undefined) {
          // A tuple's length looks at its optional elements and its rest, so none may have moved.
          const held = this.instance.types.get(e.object)!;
          const low = this.tables.typing.lower(this.deref(held));
          const tuple = typeof low === "string" ? undefined : this.tables.typing.rec(low);
          if (e.name === "length" && tuple?.kind === "object" && tuple.tuple && (tuple.required !== undefined || tuple.rest !== undefined)) this.usable(this.spot(e.object), this.key(e.object)!);
          return this.use(e, consume);
        }
        return this.expr(e.object);
      case "arrow":
        return this.made(e);
      case "object": {
        // One value can't hold a mutable borrow of a place beside another borrow of it.
        let lends: Part[] = [];
        for (const p of e.props) if (p.kind === "property") this.lentInto(p.value, lends);
        for (let i: usize = 0; i < lends.length; i++) {
          const part: Ref<Part> = lends[i]!;
          for (let k: usize = 0; k < i; k++) {
            const other: Ref<Part> = lends[k]!;
            if (!overlaps(part.place, other.place) || !(part.mutable || other.mutable)) continue;
            throw new CompileError("E0203", `'${part.at.shown}' is borrowed ${part.mutable && other.mutable ? "mutably twice" : "mutably and shared"} in one value, which would let one change what the other reads`, part.at.start, part.at.end);
          }
        }
        for (const p of e.props) {
          const into = (place: string) => `'${place}' moved here into the new object; use '${place}.clone()' to keep a copy`;
          if (p.kind === "property") this.expr(p.value, into);
          // A spread of a place reads it, cloning its fields; one made for the literal is taken over.
          else if (p.kind === "spread") this.expr(p.value);
          // A shorthand holds its variable as narrowed there.
          else if (p.kind === "shorthand") this.use(p, into, this.tables.typing.field(this.instance.types.get(e) as Exclude<Type, string>, p.name)!.type);
        }
        return;
      }
      case "new": {
        const name = e.callee.kind === "ident" ? `'new ${e.callee.name}'` : "the constructor";
        if (e.args !== undefined) this.handOver(e.args, name, e);
        this.callEnded(e);
        return;
      }
      case "call":
        this.call(e);
        return;
      // An awaited future is handed to the await, which runs it to completion.
      case "unary":
        if (e.op === "await") {
          // The future runs across suspensions, after this statement's temporaries are gone.
          for (const s of this.awaitedSources(e.operand)) if (this.sourceTemporary(s, true)) throw this.outlived(s, "the awaited Promise");
          this.expr(e.operand, (p) => `'${p}' moved here: awaiting a Promise runs it to completion, after which it is gone`);
          // An awaited async call raises what it throws here, where the await finishes it.
          if (this.instance.raises.has(e)) this.raising();
          return;
        }
        return this.expr(e.operand);
      case "template":
        for (const x of e.exprs) this.expr(x);
        return;
      // A quote's splices move into the value it makes; other tags became calls.
      case "tagged":
        if (e.template.kind === "template") for (const x of e.template.exprs) this.expr(x, (place) => `'${place}' moved here into the quote; use '${place}.clone()' to keep a copy`);
        return;
      case "index":
        if (consume && this.element(e) && !this.tables.typing.isCopy(this.instance.types.get(e)!)) throw this.elementMove(e, this.instance.types.get(e)!);
        if (this.key(e) === undefined) this.expr(e.object);
        else this.use(e, consume);
        return this.expr(e.index);
      case "update":
        this.expr(e.operand);
        return this.change(e.operand);
      case "assign": {
        const target = bare(e.target);
        // A whole value written through a mutable reference changes everything it points to,
        // and can't keep references there, nor be handed on as well.
        if (this.isRef(this.instance.types.get(target)!) && this.coercions.has(target.id)) {
          this.expr(target);
          this.expr(e.value, (p) => `'${p}' moved here into what '${this.text(target)}' points to; use '${p}.clone()' to keep a copy`);
          this.change(target, e.end);
          if (this.tables.typing.holdsRef(this.coercions.get(e.value.id) ?? this.instance.types.get(e.value)!)) this.keepOne(target, e.value);
          if (consume && !this.tables.typing.isCopy(this.instance.types.get(e)!)) {
            throw new CompileError("E0201", `this assignment's value can't be used: it was moved into what '${this.text(target)}' points to, which only borrows it`, e.start, e.end);
          }
          return;
        }
        if (e.op !== "=") this.expr(target);
        // A target's indexes run before the value, as in JavaScript.
        else for (const index of this.indexes(target)) this.expr(index);
        // A place inside a variable is found before the value runs, so a nested function the
        // value calls can't replace the variable from under it.
        const nested = this.instance.envs !== undefined && holdsNode({ of: "expr", node: e.value }, (n) => n.of === "expr" && this.instance.envs!.has(n.node));
        const root = nested && (target.kind === "member" || target.kind === "index") ? this.rootOf(target) : undefined;
        const held = root && this.key(root);
        const hold = -(target.start + 0.75);
        if (held !== undefined) this.lend(held, false, this.spot(root!), undefined, `the assignment to '${this.text(target)}'`, e, root!.start, hold);
        this.expr(e.value, (p) => `'${p}' moved here into '${this.text(target)}'; use '${p}.clone()' to keep a copy`);
        if (held !== undefined && this.state !== null) this.state.loans.delete(hold);
        // The target changes once the value is ready, after the value's reads.
        this.assign(target, e.end);
        const local = target.kind === "ident" ? localRecord(this.tables.arenas, this.localAt(target)) : undefined;
        // Pointing a reference elsewhere lets go of what it held; a value holding references
        // given another one to hold adds it.
        if (local && this.instance.captures?.has(local.localId) && this.tables.typing.holdsRef(this.coercions.get(e.value.id) ?? this.instance.types.get(e.value)!)) this.keepOne(target, e.value);
        if (local && this.tables.typing.holdsRef(local.type)) this.rehold(local.localId, e.value);
        // A value given a reference to keep, through a field or a setter, holds it; `this` may
        // only be given what outlives the call.
        if (target.kind === "member" && this.tables.typing.holdsRef(this.coercions.get(e.value.id) ?? this.instance.types.get(e.value)!)) this.keepOne(target.object, e.value);
        // An assignment used as a value hands over what it just stored. A setter keeps what it
        // was given, with nothing left to read or hand on.
        if (!discarded && this.state && !this.tables.typing.isCopy(this.instance.types.get(e)!) && this.instance.setters.has(target)) {
          throw new CompileError("E0201", `'${this.text(target)}' is a setter, which keeps the value assigned to it, so this assignment can't also be used as a value; assign a clone`, e.start, e.end);
        }
        if (consume && !this.tables.typing.isCopy(this.instance.types.get(e)!) && this.key(target) !== undefined) this.use(target, consume);
        return;
      }
      // Each arm runs from the state after the subject and any guards before it that failed,
      // and the match ends in any of theirs. A binding borrowing from the matched place holds a
      // loan of it until its arm ends; a guard holds one while it runs, since later arms still
      // test the place.
      case "match": {
        this.expr(e.subject);
        const subject = this.through(e.subject);
        const place = this.key(subject);
        let entry = join(this.state, null);
        let after: State = null;
        for (const arm of e.arms) {
          this.state = join(entry, null);
          const bound = bindings(arm.pattern).flatMap((b) => this.localAt(b as Expr) ?? []);
          // Each time an arm is entered, its bindings are new, as a loop's `let` is.
          for (const local of bound) this.revive(String(this.tables.arenas.localOf(local).id));
          const borrowing = bound.filter((l) => this.isRef(this.tables.arenas.localOf(l).type));
          for (const holderId of borrowing) {
            const holder = this.tables.arenas.localOf(holderId);
            if (place !== undefined && this.state) this.state.loans.set(-holder.id - 1_000_000, { place, mutable: false, start: e.subject.start, end: e.subject.end, holders: new Set([holder.localId]) });
            // Through a reference, the binding holds what that reference borrows, a reference a
            // call gave included.
            this.inherit(holder.localId, subject);
            if (place === undefined && this.fromCall(this.projected(subject))) this.hold(holder.localId, this.projected(subject));
          }
          if (arm.guard) {
            const at = -arm.guard.start - 1;
            if (place !== undefined && this.state) this.state.loans.set(at, { place, mutable: false, start: arm.guard.start, end: arm.guard.end, holders: new Set(), guard: true });
            this.guarding.add(arm.guard.start);
            this.expr(arm.guard);
            this.guarding.delete(arm.guard.start);
            if (this.state !== null) this.state.loans.delete(at);
            const passed = this.state;
            this.state = join(passed, null);
            for (const holder of borrowing) this.release(holder);
            entry = join(entry, this.state);
            this.state = passed;
          }
          if (arm.body.kind === "block") {
            this.arms.set(arm.body.id, [consume, discarded]);
            this.exits.set(arm.body.id, null);
            this.statement(arm.body);
            this.state = join(this.state, this.exits.get(arm.body.id)!);
            this.dropped([...this.scoped(arm.body), ...bound], arm.body.end);
          } else {
            this.expr(arm.body, consume, discarded);
            this.dropped(bound, arm.body.end);
          }
          for (const holder of borrowing) this.release(holder);
          after = join(after, this.state);
        }
        this.state = after;
        return;
      }
      case "conditional": {
        this.expr(e.cond);
        if (!this.instance.types.has(e.then)) return this.expr(e.else, consume, discarded);
        if (!this.instance.types.has(e.else)) return this.expr(e.then, consume, discarded);
        const before = join(this.state, null);
        this.expr(e.then, consume, discarded);
        const then = this.state;
        this.state = before;
        this.expr(e.else, consume, discarded);
        this.state = join(then, this.state);
        return;
      }
      case "binary": {
        // `a ?? b` hands over whichever it gives; a Rust value, which is never copied, always.
        const given = e.op === "??" ? (consume ?? (this.tables.typing.holdsPart(this.instance.types.get(e)!, (u) => rustClassOf(this.tables.typing, u) !== undefined) ? (place: string) => `'${place}' moved here: '??' hands over the Rust value it holds` : undefined)) : undefined;
        if (e.op === "??") this.outOfBorrow(e.left, e, consume);
        this.expr(e.left, given);
        // The right side of `&&`, `||` and `??` may not run.
        const before = join(this.state, null);
        this.expr(e.right, given);
        if (e.op === "&&" || e.op === "||" || e.op === "??") this.state = join(before, this.state);
        return;
      }
      // `x!` is x's value, handed over or read as x is.
      case "nonNull":
        if (redundantBang(e)) return this.expr(e.expr, consume, discarded);
        this.outOfBorrow(e.expr, e, consume);
        return this.expr(e.expr, consume);
      case "as":
        if (this.narrowsUnion(e)) {
          this.outOfBorrow(e.expr, e, consume);
          return this.expr(e.expr, consume);
        }
        return this.expr(e.expr, consume, discarded);
      case "satisfies":
      case "unsafe":
        return this.expr(e.expr, consume, discarded);
      // Comptime code runs while compiling, so it moves and borrows nothing at run time.
      case "comptime":
        return;
      // A yielded value is handed to whoever called `next()`.
      case "yield":
        if (e.value) this.expr(e.value, (p) => `'${p}' moved here: yielding it hands it on; use '${p}.clone()' to keep a copy`);
        this.stillBorrowed(e);
        return;
      // A pipe over a value hands it to the topic, new each time the pipe runs.
      // Like a `let`, the topic holds what its value borrows, until the pipe ends.
      case "pipe": {
        const local = this.tables.arenas.localOf(this.localAt(e)!);
        this.release(local.localId);
        this.expr(e.value, (place) => `'${place}' moved here into the pipe's '%'; use '${place}.clone()' to keep a copy`);
        this.revive(String(local.id));
        if (this.tables.typing.holdsRef(local.type)) this.rehold(local.localId, e.value);
        this.expr(e.body, consume, discarded);
        this.release(local.localId);
        return;
      }
      // A spread of a place reads it, cloning its elements; one made for the spread is taken over.
      case "array":
        for (const x of e.elements) {
          if (x?.kind === "spread") this.expr(x.value);
          else if (x) this.expr(x, (place) => `'${place}' moved here into the new array; use '${place}.clone()' to keep a copy`);
        }
        return;
      case "float":
      case "bigint":
      case "regex":
      case "null":
        return;
      // A throw expression hands its value on, and nothing after it runs.
      case "throw":
        this.expr(e.value, (p) => `'${p}' moved here: throwing it hands it on`);
        this.raising();
        this.state = null;
        return;
      default:
        assert(false, `the move checker has no case for '${e.kind}' expressions`);
    }
  }

  // A value that may keep references given to it holds them: a holder variable, or `this`, which
  // may be given only what points into this function's parameters, since it outlives the call.
  /** @throws {CompileError} */
  keep(this: Mut<this>, target: Ref<Expr>, values: Ref<Expr[]>, holdingOnly: boolean) {
    let any = false;
    for (const v of values) if (!holdingOnly || this.holding(v)) any = true;
    if (!any) return;
    const k = this.keeper(target);
    for (const v of values) if (!holdingOnly || this.holding(v)) this.keepValue(k, v);
  }

  /** @throws {CompileError} */
  keepOne(this: Mut<this>, target: Ref<Expr>, v: Ref<Expr>) {
    const k = this.keeper(target);
    this.keepValue(k, v);
  }

  // Whether a value given on holds references, as given.
  holding(v: Ref<Expr>): boolean {
    return this.tables.typing.holdsRef(this.coercions.get(v.id) ?? this.instance.types.get(v)!);
  }

  // What keeps the references a target is given: `this`, through its holder, or the variable it
  // is in, when that holds references of its own.
  /** @throws {CompileError} */
  keeper(this: Mut<this>, target: Ref<Expr>): Keeper {
    // Keeping references in what a reference points to would need its owner to hold them.
    let p: Ref<Expr> = target;
    while (true) {
      const t = this.instance.types.get(p);
      if (t !== undefined && this.isRef(t)) {
        throw new CompileError("E0801", `keeping references through the reference '${this.text(p)}' is not supported yet; do it on what '${this.text(p)}' points to, directly`, target.start, target.end);
      }
      if (p.kind !== "member") break;
      p = p.object;
    }
    const root = this.rootOf(target);
    // What a closure captures outlives the call that keeps it, like what a reference points to.
    const capture = this.localAt(root);
    if (capture !== undefined && this.instance.captures?.has(capture) === true) {
      throw new CompileError("E0801", `keeping references in '${this.tables.arenas.localOf(capture).name}', which this closure captures, is not supported yet; keep them in a variable of the closure's own`, target.start, target.end);
    }
    if (root.kind === "this" || root.kind === "super") return { self: true };
    const owner = this.localAt(root);
    if (owner === undefined) return { self: false };
    const type = this.tables.arenas.localOf(owner).type;
    return this.tables.typing.holdsRef(type) && !this.isRef(type) ? { self: false, owner } : { self: false };
  }

  /** @throws {CompileError} */
  keepValue(this: Mut<this>, k: Ref<Keeper>, v: Ref<Expr>) {
    if (k.self) {
      this.stored(v);
      if (this.f.self !== undefined && this.tables.typing.holdsRef(this.f.self.type)) this.hold(this.kept, v);
    } else if (k.owner !== undefined) this.hold(k.owner, v);
  }

  // Arguments are handed over, or lent for the call, in order.
  /** @throws {CompileError} */
  handOver(this: Mut<this>, args: Ref<Expr[]>, name: string, call: Ref<Expr>) {
    for (let i: usize = 0; i < args.length; i++) this.handOverOne(args[i]!, name, call, i === 0);
  }

  /** @throws {CompileError} */
  handOverOne(this: Mut<this>, a: Ref<Expr>, name: string, call: Ref<Expr>, first: boolean) {
    // What crosses into JS is copied there, so it is only read here; a callback is kept by JS,
    // so it is handed over.
    if (this.tables.jsCrossings.has(call)) {
      const keptByJs = this.tables.typing.keptByJs(this.coercions.get(a.id) ?? "void") || this.tables.typing.keptByJs(this.instance.types.get(a)!);
      this.expr(a, keptByJs ? (p: string) => `'${p}' moved here: JS keeps a callback or a Promise given to it, as it may use it later; pass '${p}.clone()' to keep a copy` : undefined);
      return;
    }
    const helper = call.kind === "call" && call.shown !== undefined && first;
    this.expr(a, (p: string) => (helper ? `'${p}' moved here: ${name} takes its generator over` : `'${p}' moved here: passing it to ${name} hands it over, as if ${name} kept it; pass '${p}.clone()' to keep a copy`));
    const parts = this.lent(a);
    for (let i: usize = 0; i < parts.length; i++) this.lend(parts[i]!.place, parts[i]!.mutable, parts[i]!.at, undefined, name, call, parts[i]!.at.start, this.partKey(parts[i]!.at.start, i));
  }

  // The places an expression lends a reference to, and how: a place borrowed, a reference
  // passed on, which lends what it points to again, or either side of a `?:`.
  lent(this: Mut<this>, given: Ref<Expr>): Part[] {
    let out: Part[] = [];
    this.lentInto(given, out);
    return out;
  }

  lentInto(this: Mut<this>, given: Ref<Expr>, out: Mut<Part[]>): void {
    const lentAs = this.coercionOf(given);
    const e = this.unwrapped(given);
    if (e.kind === "conditional") {
      if (this.instance.types.has(e.then)) this.lentInto(e.then, out);
      if (this.instance.types.has(e.else)) this.lentInto(e.else, out);
      return;
    }
    if (e.kind === "binary" && this.choosing(e)) {
      this.lentInto(e.left, out);
      this.lentInto(e.right, out);
      return;
    }
    // A literal lends what each of its parts does, nested literals included.
    if (e.kind === "object") {
      for (const p of e.props) if (p.kind === "property") this.lentInto(p.value, out);
      return;
    }
    // A closure made for a call lends what it captures for the call.
    if (e.kind === "arrow" || this.instance.envs?.has(e) === true) {
      for (const c of this.captured(e)) if (!c.held || this.reborrows(c.from!)) out.push({ place: c.place, at: c.at, mutable: c.mutable || c.held });
      return;
    }
    // A field, element or unwrapped Option of a returned reference reaches into what that
    // reference borrows, so it lends what the reference does.
    const root = this.projected(e);
    if (root.id !== e.id && this.key(e) === undefined && this.fromCall(root)) {
      this.lentInto(root, out);
      return;
    }
    // A call's returned reference lends again what it borrows from, a receiver included; a
    // future lends it mutably when it holds a mutable reference.
    const from = this.instance.borrowsFrom.get(e);
    if (from !== undefined) {
      const result = lentAs ?? this.instance.types.get(e)!;
      const mutable = this.isRef(result) ? this.tables.typing.rec(result).mutable : this.tables.typing.holdsMut(result);
      for (const s of from) this.sourceInto(s, mutable, out);
      return;
    }
    const type = this.instance.types.get(e);
    const place = this.key(e);
    // A shared reference passed on is just another pointer, which needs nothing lent; a
    // mutable one lends itself, shared or mutably as it is passed on.
    // A mutable reference or nothing passed on lends itself as a mutable reference does.
    const ref = this.refMutability(lentAs ?? type);
    const held = this.refMutability(type);
    if (place === undefined || ref === undefined || held === false) return;
    out.push({ place, at: this.spot(e), mutable: ref });
  }

  // Whether a reference, or an Option holding one, is mutable; undefined for any other type.
  refMutability(t: Type | undefined): boolean | undefined {
    if (t === undefined) return undefined;
    const r = this.isRef(t) ? t : this.tables.typing.optionRef(t);
    return r === undefined ? undefined : this.tables.typing.rec(r).mutable;
  }

  // What a call's result borrows from one of its sources: what the source lends, or, for a
  // receiver that is a place, the place itself.
  sourceInto(this: Mut<this>, s: Ref<Expr>, mutable: boolean, out: Mut<Part[]>): void {
    const before = out.length;
    this.lentInto(s, out);
    const place = this.key(s);
    if (out.length > before || place === undefined || this.isRef(this.instance.types.get(s)!)) return;
    out.push({ place, at: this.spot(s), mutable });
  }

  // A call: what a nested function it calls captures, its callee, its receiver lent to it, its
  // arguments handed over or lent, and what it may keep, held once its own loans have ended.
  /** @throws {CompileError} */
  call(this: Mut<this>, e: Ref<Expr>) {
    if (e.kind !== "call") return;
    // Printing, `format`, `inspect`, `JSON.stringify`, `Array.isArray` and `assert` read their
    // arguments.
    if (this.tables.asserts.has(e) || this.tables.printCalls.has(e) || this.tables.formatCalls.has(e) || this.tables.inspectCalls.has(e) || this.tables.jsonCalls.get(e) === "stringify" || this.tables.kindTests.has(e)) {
      for (const a of e.args) this.expr(a);
      return;
    }
    if (this.tables.joinCalls.has(e)) {
      if (e.callee.kind === "member") this.expr(e.callee.object, (p: string) => `'${p}' moved here: 'join' takes the handle over, as awaiting it would`);
      return;
    }
    // `Promise.all` and `Promise.race` take each future in their list as an argument, so what
    // one borrows is lent while the others are made, and two can't conflict.
    if (this.tables.combinedCalls.has(e)) {
      const name = `'Promise.${e.callee.kind === "member" || e.callee.kind === "ident" ? e.callee.name : ""}'`;
      const list: Ref<Expr> = e.args[0]!;
      if (list.kind === "array") {
        for (const x of list.elements) if (x !== undefined) this.handOverOne(x, name, e, false);
      } else this.handOverOne(list, name, e, false);
      this.callEnded(e);
      return;
    }
    // An iterator helper's call is named by the method written.
    const name = e.shown !== undefined ? `'${e.shown}'` : e.callee.kind === "member" || e.callee.kind === "ident" ? `'${e.callee.name}'` : e.callee.kind === "super" ? "'super'" : "the function";
    // What the call may keep is held once its own loans have ended.
    const keeps = this.callInside(e, name);
    this.callEnded(e);
    if (keeps) {
      const keeper = this.receiver(e);
      if (keeper !== undefined) this.keep(keeper, e.args, true);
      else if (e.callee.kind === "super") this.keep(e.callee, e.args, true);
    }
    if (this.instance.raises.has(e)) this.raising();
  }

  // A function held in a field is what its call lends, not the object holding it.
  fieldCall(this: Mut<this>, e: Ref<Expr>): boolean {
    if (e.kind !== "call" || e.callee.kind !== "member") return false;
    const held = this.tables.typing.lower(this.instance.types.get(e.callee) ?? "void");
    if (typeof held === "string") return false;
    const h = this.tables.typing.rec(held);
    return h.kind === "closure" || (h.kind === "dyn" && this.tables.typing.callableOf.has(h.of));
  }

  // What a call lends as its receiver: a method's object, a field holding the function called,
  // or, through a Dyn, a stored callable, which the call's callee holds.
  receiver(this: Mut<this>, e: Ref<Expr>): Ref<Expr> | undefined {
    if (e.kind !== "call") return undefined;
    if (e.callee.kind === "member") return this.fieldCall(e) ? e.callee : e.callee.object;
    const callable = this.tables.dynCalls.get(e)?.callable;
    return callable === undefined ? undefined : within(e.callee, callable.id);
  }

  // The part of a call checked while its own loans are live: whether what it lends may be kept.
  /** @throws {CompileError} */
  callInside(this: Mut<this>, e: Ref<Expr>, name: string): boolean {
    if (e.kind !== "call") return false;
    // A nested function called by name, itself included, uses what it captures for the
    // call: lent shared while its arguments run, so they may read it, then mutably for the
    // call where it changes it, so nothing borrowed from those may be live across it. Keys
    // below zero and between whole numbers, one per capture, so no other loan can replace
    // these.
    let captures: { alias: LocalId; changes: boolean; key: f64 }[] = [];
    const callee: Span = { start: e.callee.start, end: e.callee.end };
    if (this.tables.selfCalls.has(e)) {
      if (this.instance.captures !== undefined) for (const alias of this.instance.captures.keys()) captures.push({ alias, changes: this.instance.changed?.has(alias) === true, key: 0 });
    } else {
      const built = this.instance.envs?.get(e);
      if (built !== undefined) {
        const inner = this.tables.arenas.instanceOf(built.of);
        let aliases: LocalId[] = [];
        for (const alias of inner.captures!.keys()) aliases.push(alias);
        for (let i: usize = 0; i < built.env.length; i++) captures.push({ alias: built.env[i]!, changes: inner.changed?.has(aliases[i]!) === true, key: 0 });
      }
    }
    for (let i: usize = 0; i < captures.length; i++) captures[i]!.key = -((callee.start as f64) + ((i as f64) + 1) / 8192);
    for (const c of captures) {
      const alias = this.tables.arenas.localOf(c.alias);
      const at: Spot = { start: callee.start, end: callee.end, shown: alias.name };
      const place = String(alias.id);
      const aliasName = alias.name;
      try {
        this.usable(at, place);
      } catch (err) {
        // The variable isn't written at the call, so the message says the function uses it.
        if (err instanceof CompileError && !this.tables.selfCalls.has(e)) throw new CompileError(err.code, `${name} uses '${aliasName}', and ${err.message}`, err.start, err.end, err.note);
        throw err;
      }
      this.lend(place, false, at, undefined, name, e, at.start, c.key);
    }
    // A closure is read to call it, or taken over when it can run only once.
    const run = e.callee.kind === "ident" ? this.tables.typing.lower(this.instance.types.get(e.callee) ?? "void") : undefined;
    if (e.callee.kind === "ident" && this.instance.locals.has(e.callee)) {
      const r = this.record(run);
      const once = r?.kind === "closure" && r.once;
      this.expr(e.callee, once ? (p: string) => `'${p}' moved here: calling it runs it once, since it moves out what it captured` : undefined);
    }
    // A method's receiver is lent to it for the call, mutably when the method changes it.
    // A mutable receiver is lent shared while the arguments run, so they may read it, and
    // mutably for the call itself.
    // A callee that is itself a value, like an arrow called at once, runs first.
    const dyn = this.tables.dynCalls.get(e);
    const dynMutable = dyn !== undefined && (dyn.mutable || dyn.owned);
    const dynOwned = dyn !== undefined && dyn.owned;
    const dynCallable = dyn?.callable !== undefined;
    if (e.callee.kind !== "ident" && e.callee.kind !== "member" && e.callee.kind !== "super" && !dynCallable) this.expr(e.callee);
    // Through a Dyn, the receiver its interface declares; a stored callable called as a name,
    // an element or any other value is itself what is lent to the call.
    const object = this.receiver(e);
    const place = object !== undefined ? this.key(object) : undefined;
    const target = this.instance.calls.get(e);
    const self = target !== undefined ? bodyOf(this.tables.arenas, this.tables.arenas.instanceOf(target)).self : undefined;
    const hasSelf = self !== undefined || dyn !== undefined;
    const selfMutable = self !== undefined ? self.mutable : dynMutable;
    const selfOwned = self !== undefined ? self.owned === true : dynOwned;
    // An owning method takes its receiver over, as an argument it is handed.
    if (object !== undefined && selfOwned) {
      this.expr(object, (p: string) => `'${p}' moved here: ${name} takes its object over; call it on '${p}.clone()' to keep a copy`);
      this.handOver(e.args, name, e);
      return false;
    }
    if (object !== undefined) this.expr(object);
    // An array's `push` and `pop`, and a generator's `next`, change it: it is lent shared
    // while the arguments run, as a mutating method's object is, then changed, which nothing
    // borrowing it may see.
    const method = e.callee.kind === "member" ? e.callee.name : "";
    const builtin = object !== undefined && target === undefined && e.callee.kind === "member" && method !== "clone";
    const changes = builtin && (this.generator(object!) || (this.array(object!) && ARRAY_CHANGES.has(method)) || (this.mapped(object!) && MAP_CHANGES.has(method)));
    // Any other array, Map or Set method reads it, lent shared while its callback runs, as
    // a string is while a regex goes through it.
    // A shared value's, an Rc's or a lock's `update` and `read` hand their callback a pointer
    // into the value the receiver reaches, so the callback can't replace or drop the receiver.
    const reads = builtin && !changes && (this.array(object!) || this.mapped(object!) || this.tables.regexStringCalls.has(e) || (this.locking(object!) && (method === "update" || method === "read")));
    if (object !== undefined && place !== undefined && (hasSelf || changes || reads)) this.lend(place, false, this.spot(object), undefined, name, e);
    // A receiver that is a reference a call gave lends again what that reference borrows
    // from, for the whole call, so its callback can't replace what the reference reaches.
    const parts = object !== undefined && place === undefined && (hasSelf || changes || reads) ? this.lent(object) : [];
    for (let i: usize = 0; i < parts.length; i++) this.lend(parts[i]!.place, false, parts[i]!.at, undefined, name, e, parts[i]!.at.start, this.partKey(parts[i]!.at.start, i));
    this.handOver(e.args, name, e);
    for (const c of captures) {
      if (!c.changes || this.state === null) continue;
      this.state.loans.delete(c.key);
      const alias = this.tables.arenas.localOf(c.alias);
      const at: Spot = { start: callee.start, end: callee.end, shown: alias.name };
      this.lend(String(alias.id), true, at, undefined, name, e, e.end - 1, c.key);
    }
    if (object !== undefined && changes) {
      if (this.state !== null) this.state.loans.delete(object.start as f64);
      this.change(object);
    }
    if (object !== undefined && place !== undefined && selfMutable && this.state !== null) {
      this.state.loans.delete(object.start as f64);
      this.lend(place, true, this.spot(object), undefined, name, e, e.end - 1);
    }
    if (hasSelf && selfMutable && this.state !== null) {
      for (let i: usize = 0; i < parts.length; i++) {
        const key = this.partKey(parts[i]!.at.start, i);
        this.state!.loans.delete(key);
        this.lend(parts[i]!.place, parts[i]!.mutable, parts[i]!.at, undefined, name, e, e.end - 1, key);
      }
    }
    // A method that changes its object, or a base's constructor, may keep what is lent,
    // when the object has somewhere to keep a reference.
    const keeper = object ?? (e.callee.kind === "super" ? e.callee : undefined);
    if (keeper === undefined) return false;
    const keeperType = this.instance.types.get(keeper);
    const holder = keeperType === undefined || this.tables.typing.holdsRef(this.deref(keeperType));
    return holder && (selfMutable || e.callee.kind === "super");
  }

  // Once a call returns, what was lent to it alone is free again.
  callEnded(this: Mut<this>, call: Ref<Expr>) {
    if (this.state === null) return;
    let ended: f64[] = [];
    for (const [at, loan] of this.state.loans) if (loan.call !== undefined && loan.callAt === call.id && loan.holders.size === 0) ended.push(at);
    for (const at of ended) this.state.loans.delete(at);
  }


  // Reads or hands over a place, which must still hold its value and not be lent so as to
  // forbid it.
  /** @throws {CompileError} */
  use(this: Mut<this>, e: Ref<Named>, consume?: Consumer, type: Type = e.kind === "shorthand" ? this.tables.arenas.localOf(this.localAt(e)!).type : this.instance.types.get(e)!) {
    const place = this.key(e)!;
    this.usable(this.spot(e), place);
    const moving = consume !== undefined && !this.tables.typing.isCopy(type);
    if (moving && place.includes(".[]")) throw this.elementMove(e, type);
    this.free(place, this.spot(e), moving ? "move" : "read");
    if (!moving || this.state === null) return;
    const root = localRecord(this.tables.arenas, this.localAt(this.rootOf(e) as never));
    if (root && (this.isRef(root.type) || this.tables.typing.optionRef(root.type))) {
      throw new CompileError("E0202", this.hinted(type, `'${this.text(e)}' can't be moved out of '${root.name}', which only borrows it; use '${this.text(e)}.clone()'`), e.start, e.end);
    }
    // Nor out of a reference a field holds, or a shared value every clone of it uses.
    for (let p: Named = e; p.kind === "member"; p = p.object) {
      const holder = this.record(this.instance.types.get(p.object));
      if (holder?.kind === "shared" || (holder?.kind === "ref" && this.record(holder.to)?.kind === "shared")) {
        throw new CompileError("E0202", `'${this.text(e)}' can't be moved out of '${this.text(p.object)}', which every clone of it shares; use it where it is`, e.start, e.end);
      }
      if (p !== e && this.isRef(this.instance.types.get(p)!)) {
        throw new CompileError("E0202", this.hinted(type, `'${this.text(e)}' can't be moved out of '${this.text(p)}', which only borrows it; use '${this.text(e)}.clone()'`), e.start, e.end);
      }
    }
    if (place.startsWith("this") && !this.f.self?.owned) {
      throw new CompileError("E0202", this.hinted(type, `'${this.text(e)}' can't be moved out of 'this', since it is only borrowed here; use '${this.text(e)}.clone()'`), e.start, e.end);
    }
    // A closure moving out what it captures holds it, and can run only once.
    if (root && this.instance.captures?.has(root.localId)) this.instance.moved!.add(root.localId);
    this.instance.consumes.add(e);
    this.state.moves.set(place, { start: e.start, end: e.end, note: this.hinted(type, consume!(this.text(e))), passes: new Map(this.passes) });
  }

  // A message without its advice to clone, for a value holding a JoinHandle, which can't be.
  hinted(type: Type, message: string): string {
    // A Promise isn't cloned either: its future runs once.
    const counted = this.tables.typing.holdsPart(type, (u) => {
      const r = this.record(u);
      return (r?.kind === "block" && (r.which === "Semaphore" || r.which === "Permit")) || r?.kind === "future";
    }, true);
    return this.tables.typing.holdsHandle(type, true) || counted ? message.replace(/;[^;]*\.clone\(\)'[^;]*$/, "") : message;
  }

  // A place can't be used once it, something it is inside, or something inside it moved.
  /** @throws {CompileError} */
  usable(this: Mut<this>, use: Ref<Spot>, place: string) {
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
      const root = this.pathOf(moved);
      throw new CompileError("E0205", `'${root}' is used before being assigned; give it a value on every path that reaches here, as TypeScript requires`, use.start, use.end, note);
    }
    const name = use.shown;
    const what = moved === place ? `'${name}' was moved, so it can't be used here`
      : place.startsWith(`${moved}.`) ? `'${name}' can't be used here because '${this.pathOf(moved)}' was moved`
      : `'${name}' can't be used as a whole here because '${this.pathOf(moved)}' was moved out of it`;
    let earlier = "";
    for (const [loop, pass] of this.passes) if ((move.passes.get(loop) ?? pass) < pass) earlier = " (in an earlier pass through this loop)";
    throw new CompileError("E0201", what + earlier, use.start, use.end, note);
  }

  // A place can't be accessed in a way a live loan of it, of something inside it or of
  // something it is inside forbids: a mutable loan forbids everything, a shared one changes,
  // moves and mutable loans.
  // Holders as a message names them, each once.
  named(holders: Ref<LocalId[]>): string[] {
    let out: string[] = [];
    for (const id of holders) {
      const name = this.tables.arenas.localOf(id).name;
      const shown = name === "for...of" ? "a 'for...of' loop" : `'${name}'`;
      if (!out.includes(shown)) out.push(shown);
    }
    return out;
  }

  /** @throws {CompileError} */
  free(this: Mut<this>, place: string, use: Ref<Spot>, access: Access, at: usize = use.start) {
    if (this.state === null) return;
    // The first loan forbidding this access, found before its message is built.
    let found: Loan | undefined = undefined;
    for (const loan of this.state.loans.values()) {
      if (!overlaps(loan.place, place) || !this.live(loan, at)) continue;
      if (!loan.mutable && (access === "read" || access === "lend")) continue;
      found = copyLoan(loan);
      break;
    }
    if (found === undefined) return;
    const loan = found;
    const lent = this.pathOf(loan.place);
    const verb = access === "read" ? "use" : access === "lend mutably" ? "mutably lend" : access;
    let holders: LocalId[] = [];
    for (const h of loan.holders) if ((this.last.get(h) ?? -1) > (at as f64)) holders.push(h);
    const names = this.named(holders);
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
  partKey(start: usize, i: usize): f64 {
    return (start as f64) + ((i as f64) + 1) / 8192;
  }

  // Where a place is used and how the source names it there.
  spot(e: Ref<Named>): Spot {
    return { start: e.start, end: e.end, shown: this.text(e) };
  }

  // Lends a place, which must be free to lend so, to a reference variable or for a call.
  // A loan is keyed by where it starts, or by `key` for one no source offset may share.
  /** @throws {CompileError} */
  lend(this: Mut<this>, place: string, mutable: boolean, use: Ref<Spot>, holder?: LocalId, call?: string, callAt?: Ref<Expr>, at: usize = use.start, key: f64 = use.start as f64) {
    this.free(place, use, mutable ? "lend mutably" : "lend", at);
    if (this.state === null) return;
    let holders = new Set<LocalId>();
    if (holder !== undefined) holders.add(holder);
    this.state.loans.set(key, { place, mutable, start: use.start, end: use.end, holders, call, callAt: callAt !== undefined ? callAt.id : undefined });
  }

  // A reference variable given a value holds what it borrows: a place lent to it, or what
  // the reference it copies, or the reference it borrows through, holds.
  /** @throws {CompileError} */
  hold(this: Mut<this>, holder: LocalId, given: Ref<Expr>) {
    if (this.state === null) return;
    const outer = given;
    const heldAs = this.coercionOf(given);
    const e = this.unwrapped(given);
    if (e.kind === "conditional") {
      if (this.instance.types.has(e.then)) this.hold(holder, e.then);
      if (this.instance.types.has(e.else)) this.hold(holder, e.else);
      return;
    }
    if (e.kind === "binary" && this.choosing(e)) {
      this.hold(holder, e.left);
      this.hold(holder, e.right);
      return;
    }
    if (this.lentTemporary(outer)) throw this.outlived(e, `'${this.tables.arenas.localOf(holder).name}'`);
    // A call's returned reference holds what its sources do: a receiver where it lives.
    const from = this.instance.borrowsFrom.get(e);
    if (from) {
      const result = heldAs ?? this.instance.types.get(e)!;
      // A future holding a mutable reference, or a Dyn's async method declaring `Mut<this>`,
      // lends what it borrows mutably until it is done.
      const mutable = this.isRef(result) ? this.tables.typing.rec(result).mutable : this.tables.typing.holdsMut(result) || this.tables.dynCalls.get(e)?.mutable === true;
      for (const s of from) {
        if (this.sourceTemporary(s)) throw this.outlived(s, `'${this.tables.arenas.localOf(holder).name}'`);
        const t = this.coercionOf(s) ?? this.instance.types.get(s)!;
        if (this.tables.typing.holdsRef(t) && (this.isRef(t) || this.key(s) === undefined)) this.hold(holder, s);
        else if (this.key(s) !== undefined) {
          this.lend(this.key(s)!, mutable, this.spot(s), holder);
          this.inherit(holder, s);
          if (this.throughUnion(s)) this.temporary(holder, s);
        } else this.temporary(holder, s);
      }
      return;
    }
    const type = this.instance.types.get(e)!;
    const to = heldAs ?? type;
    // A closure holds what it captures.
    if (e.kind === "arrow" || this.instance.envs?.has(e)) {
      const parts = this.captured(e);
      for (let i: usize = 0; i < parts.length; i++) {
        const c: Ref<Capture> = parts[i]!;
        // A copy of a mutable reference lends it again.
        if (!c.held || this.reborrows(c.from!)) this.lend(c.place, c.mutable || c.held, c.at, holder, undefined, undefined, c.at.start, this.partKey(c.at.start, i));
        if (c.from !== undefined && this.tables.typing.holdsRef(this.tables.arenas.localOf(c.from).type)) this.inheritFrom(holder, c.from);
      }
      return;
    }
    if (!this.isRef(to)) {
      // A value holding references holds what its parts do, or what the value it copies does.
      if (!this.tables.typing.holdsRef(to)) return;
      if (e.kind === "object") {
        for (const p of e.props) {
          if (p.kind === "property") this.hold(holder, p.value);
          else if (p.kind === "shorthand" && this.localAt(p) !== undefined) {
            const local = this.tables.arenas.localOf(this.localAt(p)!);
            // A shorthand lent to a reference field lends its variable; a mutable reference copied
            // lends itself mutably, as `{ m: m }` does, so only one of them is used at a time.
            // Meeting a union, the literal's own type is the member it went into.
            const shape = this.isUnion(to) ? this.instance.types.get(e)! : to;
            if (this.isRef(this.tables.typing.field(shape as Exclude<Type, string>, p.name)!.type) && !this.isRef(local.type)) this.lend(String(local.id), false, this.spot(p), holder);
            else if (this.tables.typing.holdsRef(local.type)) {
              if (this.isRef(local.type) && this.tables.typing.rec(local.type).mutable) this.lend(String(local.id), true, this.spot(p), holder);
              this.inheritFrom(holder, local.localId);
            }
          }
        }
      } else {
        this.lendTo(holder, outer);
        this.inherit(holder, e);
      }
      return;
    }
    // A place borrowed, or a reference copied, is lent to the holder: a mutable reference
    // copied lends itself mutably, so only one of them is used at a time. A copy keeps its
    // source borrowed too, so it can't be told apart from the original while held.
    this.lendTo(holder, outer);
    this.inherit(holder, e);
    if (!this.inPlace(e, to)) this.temporary(holder, e);
  }

  // What a value lends, lent to a holder.
  /** @throws {CompileError} */
  lendTo(this: Mut<this>, holder: LocalId, e: Ref<Expr>) {
    const parts = this.lent(e);
    for (let i: usize = 0; i < parts.length; i++) this.lend(parts[i]!.place, parts[i]!.mutable, parts[i]!.at, holder, undefined, undefined, parts[i]!.at.start, this.partKey(parts[i]!.at.start, i));
  }

  // Through a reference, or a value holding references, what it holds stays held.
  inherit(this: Mut<this>, holder: LocalId, e: Ref<Expr>) {
    const root = localRecord(this.tables.arenas, this.localAt(this.rootOf(e) as never));
    if (root && this.tables.typing.holdsRef(root.type)) this.inheritFrom(holder, root.localId);
  }

  inheritFrom(this: Mut<this>, holder: LocalId, root: LocalId) {
    if (this.state === null || root === holder) return;
    for (const [at, loan] of this.state.loans) if (loan.holders.has(root)) this.state.loans.set(at, { ...loan, holders: new Set([...loan.holders, holder]) });
  }

  // Whether an argument lends a value made for the statement, rather than a place or a
  // reference it already is.
  // `x!` is lent where `x` holds it. A string literal lives for the whole program, so only a
  // body that can stop, losing the slot its pointer is kept in, can't hold one.
  lentTemporary(this: Mut<this>, s: Ref<Expr>, across = false): boolean {
    const lent = this.coercionOf(s);
    const at = this.through(s);
    if (s.kind === "string" && !across && !this.f.generator && !this.f.async) return false;
    // A JsValue read out of JS is made for the statement, though it names a variable.
    return lent !== undefined && this.isRef(lent) && !this.isRef(this.instance.types.get(s)!) && (this.key(at) === undefined || this.instance.copiesOut.has(at));
  }

  // Whether a source a call's result borrows from is a value made for the statement: a lent
  // argument, or a receiver that isn't a place, which `this` borrows with no coercion recorded.
  sourceTemporary(this: Mut<this>, s: Ref<Expr>, across = false): boolean {
    if (this.lentTemporary(s, across)) return true;
    if (s.kind === "string" && !across && !this.f.generator && !this.f.async) return false;
    return this.key(this.through(s)) === undefined && !this.tables.typing.holdsRef(this.coercionOf(s) ?? this.instance.types.get(s)!);
  }

  // What an awaited future borrows from: a combinator's are those of each future in its list.
  awaitedSources(e: Ref<Expr>): Expr[] {
    if (this.tables.combinedCalls.has(e) && e.kind === "call" && e.args.length > 0) {
      let out: Expr[] = [];
      if (this.awaitedIn(e.args[0]!, out)) return out;
    }
    return this.instance.borrowsFrom.get(e) ?? [];
  }

  // A combinator's list of futures: what each borrows from, and whether it is a list written out.
  awaitedIn(list: Ref<Expr>, out: Mut<Expr[]>): boolean {
    if (list.kind !== "array") return false;
    for (const x of list.elements) {
      if (x === undefined) continue;
      for (const y of this.awaitedSources(x)) out.push(y);
    }
    return true;
  }

  // A borrow kept past its statement can't point at a temporary, which is gone once the
  // statement ends.
  outlived(s: Ref<Expr>, holder: string): CompileError {
    if (this.instance.copiesOut.has(s) && s.kind === "ident") return new CompileError("E1005", `${holder} would keep borrowing what '${s.name}' gives here, which is read out of JS anew at each use and gone once its statement ends; keep it in a 'const' first and borrow that`, s.start, s.end);
    return new CompileError("E0204", `${holder} would keep borrowing this temporary, which is gone once its statement ends; give it a name first, as in 'const xs = ...;'`, s.start, s.end);
  }

  // A reference to a temporary or a copy holds that, so it is never returned.
  temporary(this: Mut<this>, holder: LocalId, e: Ref<Expr>) {
    // Keyed beside any loan made at the same place, which it must not replace.
    if (this.state !== null) this.state.loans.set(e.start + 0.5, { place: TEMPORARY, mutable: false, start: e.start, end: e.end, holders: new Set([holder]) });
  }

  // Whether a reference made from `e` points where `e` lives, rather than at a copy: a place
  // of exactly the type borrowed, reached through real fields of known layout, or a reference
  // to the same type or to one member of a union.
  inPlace(this: Mut<this>, e: Ref<Expr>, to: RefType): boolean {
    const type = this.instance.types.get(e)!;
    const local = e.kind === "ident" ? localRecord(this.tables.arenas, this.localAt(e)) : undefined;
    const narrowed = (t: Type) => local !== undefined && local.type !== type && this.isUnion(t);
    const target = this.tables.typing.rec(to).to;
    if (this.isRef(type)) {
      const held = this.tables.typing.rec(type).to;
      if (narrowed(held)) return false;
      const [from, want] = [this.tables.typing.lower(held), this.tables.typing.lower(target)];
      return from === want || (this.isUnion(from) && this.tables.typing.rec(from).members.includes(want));
    }
    if (this.key(e) === undefined || this.throughUnion(e) || narrowed(type)) return false;
    return this.tables.typing.lower(type) === this.tables.typing.lower(target) || this.tables.typing.partOfItself(type, target);
  }

  // Whether a field path passes through a union, or ends where a type parameter's concrete type
  // stores the field as another type, so the field is read as a copy. At a definition, where
  // nothing is concrete, each instance decides.
  throughUnion(this: Mut<this>, e: Ref<Expr>): boolean {
    for (let p: Expr = e; p.kind === "member"; p = p.object) {
      const holder = this.instance.types.get(p.object);
      if (holder && this.record(this.deref(holder))?.kind === "union") return true;
    }
    const stored = this.storedType(e);
    return stored !== undefined && this.tables.typing.lower(stored) !== this.tables.typing.lower(this.instance.types.get(e)!);
  }

  // The type a place is stored as, where an instance knows it: a field read through a type
  // parameter has its concrete type's field type, as codegen lays it out.
  storedType(this: Mut<this>, e: Ref<Expr>): Type | undefined {
    if (e.kind !== "member") return this.instance.types.get(e);
    const holder = this.storedType(e.object);
    const held = holder && this.deref(holder);
    const concrete = held && typeof held !== "string" ? this.tables.typing.lower(held) : held;
    if (typeof concrete === "string" || !concrete) return this.instance.types.get(e);
    const kind = this.tables.typing.rec(concrete).kind;
    if (kind === "union" || kind === "param") return this.instance.types.get(e);
    return this.tables.typing.field(concrete, e.name)?.type ?? this.instance.types.get(e);
  }

  // A returned reference may point only into what its lifetime ties it to: a parameter's
  // borrow, or `this`, never this function's own values.
  /** @throws {CompileError} */
  returned(this: Mut<this>, e: Ref<Expr>) {
    this.outlives(e, this.origins, "return", "return an owned value instead");
  }

  // What a body stores into `this` outlives the call, so it may point only into parameters.
  /** @throws {CompileError} */
  stored(this: Mut<this>, e: Ref<Expr>) {
    this.outlives(e, this.f.params.map((_, i) => i), "store in 'this'", "store an owned value instead");
  }

  // A value leaving the body may point only into what `allowed` says outlives it.
  /** @throws {CompileError} */
  outlives(this: Mut<this>, e: Ref<Expr>, allowed: Origin[], verb: string, instead: string) {
    const type = this.coercions.get(e.id) ?? this.instance.types.get(e)!;
    if (!this.tables.typing.holdsRef(type)) return;
    for (const place of this.pointsInto(e)) {
      if (place === TEMPORARY) {
        throw new CompileError("E0204", `can't ${verb} a reference to a temporary or a copy, which is gone once the function returns; ${instead}`, e.start, e.end);
      }
      const param = place.startsWith("param ") ? Number(place.slice(6)) : undefined;
      if (param !== undefined ? allowed.includes(param) : place.startsWith("this") && allowed.includes("this")) continue;
      const names = allowed.map((o) => (o === "this" ? "'this'" : `'${this.paramName(o)}'`)).join(" or ") || "nothing it was given";
      const what = param !== undefined ? `'${this.paramName(param)}'` : place.startsWith("this") ? `'${this.pathOf(place)}'` : undefined;
      const message = what
        ? verb === "return" ? `the returned reference points into ${what}, but its lifetime ties it to ${names}; give ${what} that lifetime, or return an owned value` : `the stored reference points into ${what}, but it may only point into ${names}`
        : `can't ${verb} a reference to '${this.pathOf(place)}', which belongs to this function and is gone once it returns; ${instead}`;
      throw new CompileError("E0209", message, e.start, e.end);
    }
  }

  // The places a reference value points into: places it borrows where they live, what the
  // reference variables it reads through hold, what calls' results borrow, or a temporary.
  pointsInto(this: Mut<this>, given: Ref<Expr>): string[] {
    const pointsAs = this.coercionOf(given);
    const e = this.unwrapped(given);
    if (e.kind === "conditional") return [...(this.instance.types.has(e.then) ? this.pointsInto(e.then) : []), ...(this.instance.types.has(e.else) ? this.pointsInto(e.else) : [])];
    if (e.kind === "binary" && this.choosing(e)) return [...this.pointsInto(e.left), ...this.pointsInto(e.right)];
    // A closure points at what it borrows, and wherever what it holds points.
    if (e.kind === "arrow" || this.instance.envs?.has(e) === true) {
      let out: string[] = [];
      for (const c of this.captured(e)) {
        if (!c.held) out.push(c.place);
        else if (c.from !== undefined && this.tables.typing.holdsRef(this.tables.arenas.localOf(c.from).type)) for (const p of this.heldBy(c.from)) out.push(p);
      }
      return out;
    }
    const from = this.instance.borrowsFrom.get(e);
    if (from) {
      return from.flatMap((s) => {
        const t = this.coercionOf(s) ?? this.instance.types.get(s)!;
        if (this.isRef(t) || (this.tables.typing.holdsRef(t) && this.key(s) === undefined)) return this.pointsInto(s);
        return this.key(s) !== undefined && !this.throughUnion(s) ? this.within(s) : [TEMPORARY];
      });
    }
    const type = this.instance.types.get(e)!;
    const to = pointsAs ?? type;
    if (!this.isRef(to)) {
      // A value holding references points wherever its parts, or the value it copies, do.
      if (!this.tables.typing.holdsRef(to)) return [];
      if (e.kind === "object") {
        return e.props.flatMap((p) => {
          if (p.kind === "property") return this.pointsInto(p.value);
          if (p.kind !== "shorthand") return [];
          const local = localRecord(this.tables.arenas, this.localAt(p));
          if (!local) return [];
          return this.isRef(this.tables.typing.field(to as Exclude<Type, string>, p.name)!.type) && !this.isRef(local.type) ? [String(local.id)] : this.heldBy(local.localId);
        });
      }
      const root = localRecord(this.tables.arenas, this.localAt(this.rootOf(e) as never));
      return root && this.tables.typing.holdsRef(root.type) ? this.heldBy(root.localId) : [];
    }
    if (!this.inPlace(e, to)) return [TEMPORARY];
    return this.within(e);
  }

  // The places a holder's loans are on, leaving out those inside other holders, whose own
  // loans are held too.
  heldBy(root: LocalId): string[] {
    const refs = new Set([...this.instance.locals.values()].map((l) => this.tables.arenas.localOf(l)).filter((l) => this.isRef(l.type) || this.tables.typing.optionRef(l.type)).map((l) => String(l.id)));
    return [...(this.state?.loans.values() ?? [])].filter((l) => l.holders.has(root) && !refs.has(l.place.split(".")[0]!)).map((l) => l.place);
  }

  // Where a place lives: itself, or, reached through a reference variable, what that holds; a
  // reference read out of a value holding references points where that value's loans are.
  within(this: Mut<this>, e: Ref<Expr>): string[] {
    const root = localRecord(this.tables.arenas, this.localAt(this.rootOf(e) as never));
    if (!root || !(this.isRef(root.type) || this.tables.typing.optionRef(root.type) || (this.isRef(this.instance.types.get(e)!) && this.tables.typing.holdsRef(root.type)))) return [this.key(e)!];
    return this.heldBy(root.localId);
  }

  paramName(i: usize): string {
    return this.f.params[i]!.pattern.kind === "ident" ? identName(this.f.params[i]!.pattern) : `parameter ${i + 1}`;
  }

  // A holder given a new value lets go of what it held and holds what the value does, which
  // may be read from the holder itself, so the new holds are gathered first.
  /** @throws {CompileError} */
  rehold(this: Mut<this>, local: LocalId, e: Ref<Expr>) {
    if (this.state === null) return;
    const was = this.tables.arenas.localOf(local);
    const id = was.id;
    const gathering = this.tables.arenas.addLocal({ name: was.name, type: was.type, mutable: was.mutable, param: was.param, id: SYNTHETIC * 2 + id }).localId;
    this.hold(gathering, e);
    this.release(local);
    for (const [at, loan] of this.state.loans) {
      if (!loan.holders.has(gathering)) continue;
      const holders = new Set([...loan.holders].filter((h) => h !== gathering));
      // Nothing holds a loan of itself.
      if (loan.place.split(".")[0] === String(id) && holders.size === 0) this.state.loans.delete(at);
      else this.state.loans.set(at, { ...loan, holders: new Set([...holders, local]) });
    }
  }

  // A reference pointed elsewhere, or declared again, lets go of what it held.
  release(this: Mut<this>, holder: LocalId) {
    if (this.state === null) return;
    for (const [at, loan] of this.state.loans) {
      if (!loan.holders.has(holder)) continue;
      const holders = new Set([...loan.holders].filter((h) => h !== holder));
      if (holders.size === 0 && !loan.call) this.state.loans.delete(at);
      else this.state.loans.set(at, { ...loan, holders });
    }
  }

  // A loan lasts while one of its holders may still be used, or for its call.
  live(loan: Loan, at: usize): boolean {
    if (loan.guard) return this.guarding.has(loan.start);
    return loan.call !== undefined || [...loan.holders].some((h) => (this.last.get(h) ?? -1) > (at as f64));
  }

  // Changing a place needs it free of loans; a setter changes the object it is called on.
  /** @throws {CompileError} */
  change(this: Mut<this>, target: Ref<Expr>, at: usize = target.start) {
    const changed = this.instance.setters.has(target) && target.kind === "member" ? target.object : target;
    const place = this.key(changed);
    if (place !== undefined) this.free(place, this.spot(changed), "change", at);
  }

  // Assigning a place gives it a value again, along with everything inside it, but nothing
  // can be assigned inside a value that has moved, nor while it is lent.
  /** @throws {CompileError} */
  assign(this: Mut<this>, target: Ref<Expr>, at: usize) {
    const place = this.key(target);
    if (place === undefined || this.instance.setters.has(target)) {
      if (target.kind === "member") this.expr(target.object);
      this.change(target, at);
      return;
    }
    this.change(target, at);
    if (this.state === null) return;
    for (const [moved, move] of this.state.moves) {
      if (place.startsWith(`${moved}.`)) {
        if (move.unassigned) throw new CompileError("E0205", `'${this.pathOf(moved)}' is used before being assigned, so '${this.text(target)}' can't be set; assign all of '${this.pathOf(moved)}' first`, target.start, target.end, { message: move.note, start: move.start, end: move.end });
        throw new CompileError("E0201", `can't assign to '${this.text(target)}' because '${this.pathOf(moved)}' was moved`, target.start, target.end, { message: move.note, start: move.start, end: move.end });
      }
    }
    this.revive(place);
  }

  // A way out of a try through its finally, from the state it left in: whichever way control
  // left the try and its catch, their variables are gone. Ways out leaving in a state one
  // already did share that one's check.
  /** @throws {CompileError} */
  finish(this: Mut<this>, s: Ref<Stmt>, from: Ref<State>, ends: Mut<[State, State][]>): State {
    for (const [start, end] of ends) if (same(start, from)) return join(end, null);
    if (s.kind !== "try") return join(from, null);
    this.state = join(from, null);
    let gone = this.scopedList(s.block);
    const caught = s.param !== undefined ? this.localAt(s) : undefined;
    if (caught !== undefined) gone.push(caught);
    if (s.handler !== undefined) for (const x of s.handler) this.declaredIn(x, gone, false);
    const tail = s.handler !== undefined && s.handler.length > 0 ? s.handler[s.handler.length - 1]!.end : s.block.length > 0 ? s.block[s.block.length - 1]!.end : s.start;
    this.dropped(gone, tail);
    this.statements(s.finalizer!);
    ends.push([join(from, null), join(this.state, null)]);
    return join(this.state, null);
  }

  // An error raised here goes to the innermost catch, which runs from this state too, and any
  // `finally` it leaves through.
  raising(this: Mut<this>) {
    if (this.frames.length === 0) return;
    const i = this.frames.length - 1;
    if (this.frames[i]!.kind === "catch") {
      const acc = join(this.frames[i]!.acc, this.state);
      this.frames[i]!.acc = acc;
      return;
    }
    this.note(i, { kind: "raise", acc: null });
  }

  // A `break` or `continue` reaches its target, or first the innermost finally between them.
  jumping(this: Mut<this>, target: Ref<Site>, which: "break" | "continue") {
    for (let i = this.frames.length; i > 0; i--) {
      const frame: Ref<Frame> = this.frames[i - 1]!;
      if (frame.kind === "catch") continue;
      if (target.start >= frame.start && target.end <= frame.end) break;
      this.note(i - 1, { kind: "jump", target: { id: target.id, start: target.start, end: target.end }, which, acc: null });
      return;
    }
    if (which === "break") this.exits.set(target.id, join(this.exits.get(target.id) ?? null, this.state));
    else this.nexts.set(target.id, join(this.nexts.get(target.id) ?? null, this.state));
  }

  // A `return` passes first through the innermost finally, if any.
  returning(this: Mut<this>) {
    for (let i = this.frames.length; i > 0; i--) {
      if (this.frames[i - 1]!.kind !== "finally") continue;
      this.note(i - 1, { kind: "return", acc: null });
      return;
    }
  }

  // Records a way out through the finally at frame `i`, joining this state into the times it
  // was taken.
  note(this: Mut<this>, i: usize, exit: Exit) {
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

  revive(this: Mut<this>, place: string) {
    if (this.state === null) return;
    for (const moved of [...this.state.moves.keys()]) if (moved === place || moved.startsWith(`${place}.`)) this.state.moves.delete(moved);
  }

  // The place an expression names: a variable or `this`, then fields, but not through a getter.
  key(this: Mut<this>, e: Ref<Named>): string | undefined {
    // `x!` is what `x` holds, so it is borrowed and changed as `x` is, as is `x as T`.
    const inner = this.operandOf(e);
    if (inner !== undefined) return this.key(inner);
    if (e.kind === "shorthand" || e.kind === "ident") {
      const local = localRecord(this.tables.arenas, this.localAt(e));
      return local && String(local.id);
    }
    if (e.kind === "this" || e.kind === "super") return "this";
    // Every element of an array is one place inside it: borrowing any borrows the array.
    if (e.kind === "index") {
      const object = e.kind === "index" && this.element(e) ? this.key(e.object) : undefined;
      return object === undefined ? undefined : `${object}.[]`;
    }
    if (e.kind !== "member" || this.instance.calls.has(e) || this.instance.copiesOut.has(e) || this.tables.computed.has(e) || !this.instance.types.has(e.object)) return undefined;
    const object = this.key(e.object);
    return object === undefined ? undefined : `${object}.${e.name}`;
  }

  // Whether a closure holding a copy of this variable holds a mutable reference it lends again.
  reborrows(from: LocalId): boolean {
    return this.tables.typing.isCopy(this.tables.arenas.localOf(from).type) && this.tables.typing.holdsMut(this.tables.arenas.localOf(from).type);
  }

  // What `x!` or `x ?? d` gives, handed over, can't come out of an Option that `x` only borrows.
  /** @throws {CompileError} */
  outOfBorrow(option: Ref<Expr>, e: Ref<Expr>, consume?: Consumer) {
    const t = this.instance.types.get(option);
    if (consume && this.state && t && this.isRef(t) && !this.tables.typing.isCopy(this.instance.types.get(e)!)) {
      throw new CompileError("E0202", this.hinted(this.instance.types.get(e)!, "can't move a value out of a reference to it, which only borrows it; use '.clone()' to hand over a copy"), e.start, e.end);
    }
  }

  // A closure made here: what it borrows must be free to lend, and what it moves in leaves.
  /** @throws {CompileError} */
  made(this: Mut<this>, e: Ref<Expr>) {
    const parts = this.captured(e);
    // A copy the closure holds of a variable that a nested function it calls changes wouldn't
    // see the change, as JavaScript's closure would.
    for (const c of parts) {
      if (!c.held || !this.tables.typing.isCopy(this.tables.arenas.localOf(c.from!).type)) continue;
      let changed = false;
      for (const q of parts) if (q.place === c.place && q.mutable && !q.held) changed = true;
      if (!changed) continue;
      const name = this.tables.arenas.localOf(c.from!).name;
      throw new CompileError("E0210", `this closure holds its own copy of '${name}', which a nested function it calls changes, so it wouldn't see the change; pass '${name}' as a parameter instead`, c.at.start, c.at.end);
    }
    for (const c of parts) {
      this.usable(c.at, c.place);
      const copied = c.from !== undefined && this.tables.typing.isCopy(this.tables.arenas.localOf(c.from).type);
      if (!c.held || copied) this.free(c.place, c.at, c.mutable || (c.held && this.reborrows(c.from!)) ? "lend mutably" : "read");
      else {
        this.free(c.place, c.at, "move");
        const name = this.tables.arenas.localOf(c.from!).name;
        if (this.state !== null) this.state.moves.set(c.place, { start: c.at.start, end: c.at.end, note: `'${name}' moved here into a closure, which holds it now`, passes: new Map(this.passes) });
        // A closure moving one of this closure's captures into itself moves it out of this one.
        if (this.instance.captures?.has(c.from!) === true) this.instance.moved!.add(c.from!);
      }
    }
  }

  // The places a closure captures, where it first uses each, the variable, if not `this`,
  // whether it changes it, and whether it holds it rather than borrowing it.
  captured(e: Ref<Expr>): Capture[] {
    let out: Capture[] = [];
    // A nested function's declaration makes nothing; each use as a value makes its closure, from
    // this body's bindings for what it uses.
    const built = e.kind === "ident" ? this.instance.envs?.get(e) : undefined;
    if (built !== undefined) {
      this.envCaptures(built.of, built.env, e, out);
      return out;
    }
    if (e.kind !== "arrow" || (this.tables.nestedFunctions.has(e) && !e.async)) return out;
    const inner = this.tables.arenas.instanceOf(this.instance.calls.get(e)!);
    const fields = this.tables.typing.rec(inner.closure!).fields;
    let i: usize = 0;
    for (const [alias, from] of inner.captures!) {
      const use = inner.captureUses!.get(alias);
      const mutable = inner.changed!.has(alias);
      const held = !this.isRef(fields[i]!.type);
      i++;
      if (use === undefined) continue;
      if (from === "this") out.push({ place: "this", at: this.spot(use as Named), mutable, held: false });
      else out.push({ place: String(this.tables.arenas.localOf(from).id), at: this.spot(use as Named), from, mutable, held });
    }
    // A closure owning what it captures holds the nested functions it uses as made here, so it
    // borrows what they use.
    const made = this.instance.made?.get(e);
    if (made !== undefined) for (const m of made) this.envCaptures(m.of, m.env, e, out);
    return out;
  }

  // What a nested function's closure made at `at` captures, from the bindings in `env`.
  envCaptures(of: InstanceId, env: Ref<LocalId[]>, at: Ref<Span>, out: Mut<Capture[]>): void {
    const inner = this.tables.arenas.instanceOf(of);
    let aliases: LocalId[] = [];
    for (const alias of inner.captures!.keys()) aliases.push(alias);
    for (let i: usize = 0; i < env.length; i++) {
      const id = env[i]!;
      const name = this.tables.arenas.localOf(id).name;
      out.push({ place: String(this.tables.arenas.localOf(id).id), at: { start: at.start, end: at.end, shown: name }, from: id, mutable: inner.changed!.has(aliases[i]!), held: false });
    }
  }

  // `a ?? b` holding a reference gives the one either side holds.
  choosing(e: Ref<Named>): boolean {
    return e.kind === "binary" && e.op === "??" && this.tables.typing.holdsRef(this.instance.types.get(e)!);
  }

  rootOf(this: Mut<this>, e: Ref<Named>): Named {
    const inner = this.operandOf(e);
    if (inner !== undefined) return this.rootOf(inner);
    return e.kind === "member" || e.kind === "index" ? this.rootOf(e.object) : e;
  }

  // Whether an expression is a reference a call gave, or a choice between such references.
  fromCall(this: Mut<this>, given: Ref<Expr>): boolean {
    const e = this.unwrapped(given);
    if (e.kind === "conditional") return (this.instance.types.has(e.then) && this.fromCall(this.projected(e.then))) || (this.instance.types.has(e.else) && this.fromCall(this.projected(e.else)));
    if (e.kind === "binary" && this.choosing(e)) return this.fromCall(this.projected(e.left)) || this.fromCall(this.projected(e.right));
    return this.instance.borrowsFrom.has(e);
  }

  // What a chain of field reads, indexes and `!` starts from.
  projected(this: Mut<this>, e: Ref<Expr>): Expr {
    for (e = this.unwrapped(e); ; ) {
      if ((e.kind === "member" && !this.instance.calls.has(e)) || e.kind === "index") e = this.unwrapped(e.object);
      else if (e.kind === "nonNull" || e.kind === "as") e = this.unwrapped(e.expr);
      else return e;
    }
  }

  // `x!` of a reference or nothing borrows what `x` does, so it is followed as `x`, as are
  // `as`, `satisfies` and `unsafe { }`, which hand on their operand.
  // The coercion a value meets, which the checker records on the outermost of its wrappers, so
  // it is read before `unwrapped` takes them off.
  coercionOf(this: Mut<this>, e: Ref<Expr>): Type | undefined {
    for (; ; e = (e as { expr: Expr }).expr) {
      const c = this.coercions.get(e.id);
      if (c !== undefined || this.unwrapped(e) === e) return c;
    }
  }

  unwrapped(this: Mut<this>, e: Ref<Expr>): Expr {
    return (e.kind === "nonNull" && this.tables.typing.optionRef(this.instance.types.get(e.expr))) || (e.kind === "as" && this.narrowsUnion(e) && this.tables.typing.holdsRef(this.instance.types.get(e)!)) || this.transparent(e) ? this.unwrapped((e as { expr: Expr }).expr) : e;
  }

  narrowsUnion(this: Mut<this>, e: Ref<Named>): boolean {
    if (e.kind !== "as") return false;
    const [from, to] = [this.coercions.get(e.expr.id) ?? this.instance.types.get(e.expr), this.instance.types.get(e)];
    return from !== undefined && to !== undefined && this.isUnion(this.tables.typing.lower(from)) && this.tables.typing.lower(from) !== this.tables.typing.lower(to) && !this.tables.typing.fits(this.tables.typing.lower(from), this.tables.typing.lower(to));
  }

  transparent(this: Mut<this>, e: Ref<Named>): boolean {
    return (e.kind === "as" && !this.narrowsUnion(e)) || e.kind === "satisfies" || e.kind === "unsafe";
  }

  // Forms that read the place their operand names: `x!`, whatever the Option holds, and the
  // transparent ones. `unwrapped` follows fewer, since it reads a value's own type and coercion.
  projection(this: Mut<this>, e: Ref<Named>): boolean {
    return e.kind === "nonNull" || e.kind === "as" || this.transparent(e);
  }

  // What a projection reads the place of: its operand.
  operandOf(this: Mut<this>, e: Ref<Named>): Ref<Expr> | undefined {
    if (!this.projection(e)) return undefined;
    if (e.kind === "nonNull") return e.expr;
    if (e.kind === "as" || e.kind === "satisfies") return e.expr;
    if (e.kind === "unsafe") return e.expr;
    return undefined;
  }

  through(this: Mut<this>, e: Ref<Expr>): Ref<Expr> {
    let at = e;
    for (let inner = this.operandOf(at); inner !== undefined; inner = this.operandOf(at)) at = inner;
    return at;
  }

  // The indexes into arrays along a place's path, outermost first.
  indexes(e: Ref<Expr>): Expr[] {
    const found: Expr[] = [];
    for (e = bare(e); e.kind === "member" || e.kind === "index"; e = bare(e.object)) if (e.kind === "index" && this.element(e)) found.unshift(e.index);
    return found;
  }

  // Whether an expression is an index into an array.
  element(e: Ref<Named>): boolean {
    return e.kind === "index" && this.array(e.object);
  }

  // Whether an expression's value is an array, or a reference to one.
  // A generator's variables live in the generator itself, which may move between `next()`
  // calls, so no reference into one may still be in use at a `yield`. What a reference
  // parameter points to, and an array's elements, live elsewhere.
  /** @throws {CompileError} */
  stillBorrowed(this: Mut<this>, e: Ref<Expr>) {
    if (this.state === null) return;
    for (const loan of this.state.loans.values()) {
      if (loan.loop || loan.guard || !this.live(loan, e.end)) continue;
      const [root, ...path] = loan.place.split(".");
      const local = this.byId.get(Number(root));
      if (local === undefined || this.isRef(this.tables.arenas.localOf(local).type) || path.includes("[]")) continue;
      throw new CompileError("E0203", `a reference into '${this.pathOf(loan.place)}' is still in use at this 'yield'; a generator's variables move with it between 'next()' calls, so let the reference end before the yield`, e.start, e.end, {
        message: `'${this.pathOf(loan.place)}' is borrowed here`, start: loan.start, end: loan.end,
      });
    }
  }

  generator(e: Ref<Expr>): boolean {
    const t = this.instance.types.get(e);
    const held = t && this.deref(t);
    return held !== undefined && (this.tables.typing.yieldsOf(held) !== undefined || this.tables.typing.yieldsOf(held, true) !== undefined);
  }

  locking(e: Ref<Expr>): boolean {
    const t = this.instance.types.get(e);
    const r = t && this.record(this.deref(t));
    return r?.kind === "shared" || (r?.kind === "interior" && (r.which === "Lock" || r.which === "RwLock"));
  }

  mapped(e: Ref<Expr>): boolean {
    const t = this.instance.types.get(e);
    return t !== undefined && this.record(this.deref(t))?.kind === "map";
  }

  array(e: Ref<Expr>): boolean {
    const t = this.instance.types.get(e);
    const kind = t && this.record(this.deref(t))?.kind;
    return kind === "array" || kind === "fixed";
  }

  // Moving a value out of an array by index would leave a hole in it, as in Rust.
  elementMove(e: Ref<Named>, type: Type): CompileError {
    const advice = this.tables.typing.holdsHandle(type, true) ? "" : `'${this.text(e)}.clone()' to take a copy, or `;
    const t = this.instance.types.get((e as Extract<Expr, { kind: "index" }>).object);
    const inline = t !== undefined && this.record(this.deref(t))?.kind === "fixed";
    if (inline) return new CompileError("E0202", `'${this.text(e)}' can't be moved out of its fixed array, which keeps every element${advice ? `; use ${advice.slice(0, -5)}` : ""}`, e.start, e.end);
    return new CompileError("E0202", `'${this.text(e)}' can't be moved out of its array; use ${advice}'pop()' to take the last element out`, e.start, e.end);
  }

  // How a place reads in a message.
  text(e: Ref<Named>): string {
    // A tuple's element reads as it is written, `t[0]`.
    if (e.kind !== "shorthand") {
      const base = restBase(this.tables.restStarts, e);
      if (base !== undefined) return `${this.text(base)}${restSuffix(this.tables.restStarts, e)}`;
    }
    if (e.kind === "member" && e.name === EMBEDDED) return this.text(e.object);
    if (e.kind === "member") return /^\d+$/.test(e.name) ? `${this.text(e.object)}[${e.name}]` : `${this.text(e.object)}.${e.name}`;
    if (e.kind === "index") return `${this.text(e.object)}[${indexText(e.index)}]`;
    if (e.kind === "nonNull") return `${this.text(e.expr)}!`;
    return e.kind === "ident" || e.kind === "shorthand" ? e.name : e.kind === "this" || e.kind === "super" ? "this" : "(...)";
  }

  // A place's path as written, from the variable's name.
  pathOf(this: Mut<this>, place: string): string {
    // The rest field's name is dots too, so it is split out before the path is.
    const [id, ...fields] = place.replaceAll("....", ".\0").split(".").map((part) => (part === "\0" ? "..." : part));
    const local = [...this.instance.locals.values()].map((l) => this.tables.arenas.localOf(l)).find((l) => String(l.id) === id);
    // A rest tuple's array is its elements from where its fixed ones end, as `t[1...]`.
    const held = this.record(local && this.tables.typing.lower(local.type));
    const start = held?.kind === "object" && held.rest !== undefined ? held.fields.length - 1 : undefined;
    // The collection a class extending Map or Set embeds reads as the object itself.
    const named = fields.filter((part) => part !== EMBEDDED).map((part, i) => (part === "..." ? (i === 0 && start !== undefined ? `[${start}...]` : "[...]") : part === "[]" ? "[...]" : part));
    return [local?.name ?? id, ...named].join(".").replaceAll(".[", "[").replace(/\.(\d+)(?=\.|\[|$)/g, "[$1]");
  }
}

// The expression inside `root`, through its projections and the objects it reads fields and
// elements of, whose id is `id`.
function within(root: Ref<Expr>, id: usize): Ref<Expr> | undefined {
  let at: Ref<Expr> = root;
  while (true) {
    if (at.id === id) return at;
    if (at.kind === "nonNull" || at.kind === "as" || at.kind === "satisfies" || at.kind === "unsafe") at = at.expr;
    else if (at.kind === "member" || at.kind === "index") at = at.object;
    else return undefined;
  }
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
