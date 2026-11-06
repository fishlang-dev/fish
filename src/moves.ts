import type { Tables } from "./compilation.ts";
import assert from "node:assert";
import { bodyOf, type Arenas, type LocalId } from "./arenas.ts";
import type { Instance, Local, Origin } from "./check.ts";
import type { Body } from "./classes.ts";
import { CompileError } from "./diag.ts";
import type { Declarator, Expr, ObjectProp, Param, Pattern, Stmt } from "./parser.ts";
import { bindings } from "./match.ts";
import { rustClassOf } from "./rust.ts";
import { indexText, MAP_CHANGES, restBase, restSuffix } from "./values.ts";
import { holdsNode } from "./check.ts";
import { EMBEDDED, redundantBang, bare, type ObjectType, type RefType, type Type, type UnionType } from "./typing.ts";
import { nextId, NodeMap } from "./nodes.ts";

// Moves and borrows: a value that isn't Copy has one owner, so passing, assigning, storing or
// returning it hands it over, and the place it came from can't be used until it is assigned
// again. A place lent to a reference can't change or move while the reference may still be
// used, and one lent mutably can't be used at all. This walks a checked body in evaluation
// order, tracking which places have moved and which are lent.

// Where a place moved, the note explaining it, and the pass of each loop it moved on. A place
// is a local's id, or `this`, followed by a field path, like `3.inner.x`.
// A variable declared without a value is moved from the start, `unassigned`.
type Move = { start: usize; end: usize; note: string; passes: NodeMap<Stmt, usize>; unassigned?: boolean };

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

// The array methods that change their array.
const ARRAY_CHANGES = new Set(["push", "pop", "sort", "shift", "unshift", "splice", "reverse", "fill", "copyWithin", "reserve", "shrinkToFit"]);
// The place a temporary or a copy stands for: a reference into one can't be returned.
const TEMPORARY = "temporary";

// A way out of a try that passes through its finally, and what the times it was taken had in
// common.
type Exit = ({ kind: "raise" } | { kind: "return" } | { kind: "jump"; target: Stmt; which: "break" | "continue" }) & { acc: State };
type Frame = { kind: "catch"; acc: State } | { kind: "finally"; at: Stmt; exits: Exit[] };


export function checkMoves(tables: Tables, f: Body, instance: Instance, origins: Origin[]) {
  const { types, locals, calls, setters, jumps, borrowsFrom } = instance;
  const { kindTests, asserts, computed, jsCrossings, dynCalls, joinCalls, printCalls, formatCalls, inspectCalls, combinedCalls, jsonCalls, regexStringCalls, nestedFunctions, selfCalls, restStarts, typing, ids, arenas } = tables;
  // The local a name, declaration, parameter or shorthand property refers to.
  const localAt = (n: Expr | Stmt | Param | ObjectProp): LocalId | undefined => locals.get(n);
  const isRef = (t: Type): t is RefType => typeof t !== "string" && typing.rec(t).kind === "ref";
  const isUnion = (t: Type): t is UnionType => typeof t !== "string" && typing.rec(t).kind === "union";
  // What a reference refers to, or the type itself.
  const deref = (t: Type): Type => (isRef(t) ? typing.rec(t).to : t);
  // The record of a type that isn't a primitive.
  const record = (t: Type | undefined) => (t === undefined || typeof t === "string" ? undefined : typing.rec(t));
  // A place put into a `Ref<T> | null` is lent to the reference the Option holds.
  const coercions = new NodeMap([...instance.coercions]);
  for (const [e, to] of coercions) {
    const ref = typing.optionRef(to);
    const from = types.get(e);
    if (ref && from !== undefined && from !== "null" && !typing.optionRef(from) && !isRef(from)) coercions.set(e, ref);
  }
  const body = f.body;
  let state: State = { moves: new Map(), loans: new Map() };
  // The states `break` leaves to each statement, and `continue` takes back to each loop.
  const exits = new NodeMap<Stmt, State>();
  // The catches and finallies enclosing the code being checked, innermost last: what the ways
  // into each had in common, and for a finally, its try and which ways out pass through it.
  const frames: Frame[] = [];
  const nexts = new NodeMap<Stmt, State>();
  // The guards running now, by where each starts: a guard's loan lasts only while it runs, even
  // in a state an error carried out of it.
  const guarding = new Set<usize>();
  // What each `for...of` over an array reached through a reference holds while it runs.
  const loopHolders = new NodeMap<Stmt, LocalId>();
  // How each match arm's block hands on what its `return`s give, as its match does.
  const arms = new NodeMap<Stmt, [Consumer | undefined, boolean]>();
  // The pass each enclosing loop is on.
  const passes = new NodeMap<Stmt, usize>();
  const last = lastUses(tables, body, instance);
  const byId = new Map([...locals.values()].map((l) => arenas.localOf(l)).map((l) => [l.id, l]));
  // What `this` keeps stays held to the end of the body, and after it.
  const kept = arenas.addLocal({ name: "this", type: "void", mutable: false, param: false, id: -1 });
  last.set(kept.localId, Infinity);
  // A reference parameter holds a borrow its caller made, of something outside this function.
  f.params.forEach((p, i) => {
    const local = localRecord(arenas, localAt(p));
    if (local !== undefined && typing.holdsRef(local.type)) state!.loans.set(-1 - i, { place: `param ${i}`, mutable: isRef(local.type) && typing.rec(local.type).mutable, start: p.start, end: p.end, holders: new Set([local.localId]) });
  });
  statements(body);

  // The reference variables declared anywhere inside a statement.
  function inside(s: Stmt): LocalId[] {
    switch (s.kind) {
      case "let":
        return typing.holdsRef(arenas.localOf(localAt(s)!).type) ? [localAt(s)!] : [];
      case "if":
        return [...s.then, ...(s.else ?? [])].flatMap(inside);
      case "block":
      case "comptime":
      case "unsafe":
      case "while":
      case "doWhile":
        return s.body.flatMap(inside);
      case "for":
        return [...(s.init ? [s.init] : []), ...s.body].flatMap(inside);
      case "forOf": {
        const each = localAt(s.left as Stmt)!;
        return [...(typing.holdsRef(arenas.localOf(each).type) ? [each] : []), ...s.body.flatMap(inside)];
      }
      case "labeled":
        return inside(s.body);
      case "switch":
        return s.cases.flatMap((c) => c.body.flatMap(inside));
      default:
        return [];
    }
  }

  // A reference declared in a list of statements lets go of what it holds as the list ends.
  function statements(list: Stmt[]) {
    for (const s of list) statement(s);
    for (const s of list) if (s.kind === "let" && typing.holdsRef(arenas.localOf(localAt(s)!).type)) release(arenas.localOf(localAt(s)!));
    ended(list);
  }

  // A list's own variables end with it, so a borrow of one still held by a variable from outside
  // the list, and used after it, would point at a dropped value.
  function ended(list: Stmt[]) {
    const tail = list.at(-1);
    if (tail) dropped(list.flatMap((s) => (s.kind === "let" ? [localAt(s)!] : [])), tail.end);
  }

  // Checks that no borrow of a variable that has gone out of scope by `end` is still held by a
  // variable from outside, and used after. A variable that is itself a reference only copies a
  // pointer to what it borrows, whose own loans are checked where that ends.
  /** @throws {CompileError} */
  function dropped(gone: LocalId[], end: usize) {
    if (!state || gone.length === 0) return;
    const ids = new Map(gone.map((l) => [String(arenas.localOf(l).id), l]));
    const goneIds = new Set(gone);
    for (const loan of state.loans.values()) {
      const root = localRecord(arenas, ids.get(loan.place.split(".")[0]!));
      if (root === undefined || isRef(root.type)) continue;
      const outside = [...loan.holders].filter((h) => !goneIds.has(h) && (last.get(h) ?? -1) > (end as f64));
      if (outside.length === 0) continue;
      const lent = pathOf(loan.place);
      throw new CompileError("E0204", `'${lent}' doesn't live long enough: ${named(outside).join(" and ")} still ${outside.length > 1 ? "borrow" : "borrows"} it after its block ends`, loan.start, loan.end, {
        message: `'${root.name}' is dropped here, at the end of its block; declare it outside the block, or give ${named(outside).join(" and ")} an owned value`,
        start: end, end,
      });
    }
  }

  // Every variable a statement declares, at any depth, which are gone once it has run, however
  // control left it: `let`s, a loop's own variables and a catch's parameter.
  function scoped(s: Stmt): LocalId[] {
    switch (s.kind) {
      case "let":
        return [localAt(s)!];
      case "if":
        return [...s.then, ...(s.else ?? [])].flatMap(scoped);
      case "block":
      case "comptime":
      case "unsafe":
      case "while":
      case "doWhile":
        return s.body.flatMap(scoped);
      case "for":
        return [...(s.init ? [s.init] : []), ...s.body].flatMap(scoped);
      case "forOf":
        return [localAt(s.left as Stmt)!, ...s.body.flatMap(scoped)];
      case "labeled":
        return scoped(s.body);
      case "switch":
        return s.cases.flatMap((c) => c.body.flatMap(scoped));
      case "try": {
        const caught = s.param !== undefined ? localAt(s) : undefined;
        return [...s.block.flatMap(scoped), ...(caught ? [caught] : []), ...(s.handler ?? []).flatMap(scoped), ...(s.finalizer ?? []).flatMap(scoped)];
      }
      default:
        return [];
    }
  }

  function statement(s: Stmt) {
    switch (s.kind) {
      case "expr":
        return expr(s.expr, undefined, true);
      case "let": {
        const d = s.declarations[0]!;
        const name = d.target.kind === "ident" ? d.target.name : "";
        const local = arenas.localOf(localAt(s)!);
        // A declaration run again by a loop makes a fresh variable, which holds nothing yet.
        release(local);
        if (!d.init) {
          state?.moves.set(String(local.id), { start: d.start, end: d.end, note: `'${name}' is declared here without a value`, passes: new NodeMap([...passes]), unassigned: true });
          return;
        }
        expr(d.init, (p) => `'${p}' moved here: '${name}' owns it now; use '${p}.clone()' to keep a copy`);
        revive(String(local.id));
        if (typing.holdsRef(local.type)) rehold(local, d.init);
        return;
      }
      case "if": {
        expr(s.cond);
        const before = join(state, null);
        statements(s.then);
        const then = state;
        state = before;
        if (s.else) statements(s.else);
        state = join(then, state);
        return;
      }
      case "block":
      case "comptime":
      case "unsafe":
        return statements(s.body);
      // The catch runs from wherever the block raised, so from what all those points had in
      // common; after the try, either path may have run.
      case "try": {
        // A `finally` runs on every way out. It is checked from each way out's own state, once
        // per distinct state, and each way out then carries on from where it ends; the code
        // after the try carries on from the normal way out.
        const fin: Frame | undefined = s.finalizer ? { kind: "finally", at: s, exits: [] } : undefined;
        if (fin) frames.push(fin);
        if (s.handler) {
          const handler: Frame = { kind: "catch", acc: null };
          frames.push(handler);
          statements(s.block);
          frames.pop();
          const after = state;
          state = handler.acc;
          // A raise left the block wherever it was, its variables gone by the catch.
          dropped(s.block.flatMap(scoped), s.block.at(-1)?.end ?? s.start);
          const caught = s.param !== undefined ? localAt(s) : undefined;
          if (caught !== undefined) revive(String(arenas.localOf(caught).id));
          statements(s.handler);
          if (caught) dropped([caught], s.handler.at(-1)?.end ?? s.start);
          state = join(after, state);
        } else statements(s.block);
        if (!fin) return;
        frames.pop();
        const normal = state;
        // Ways out that reach the finally in the same state share one check of it, which keeps
        // nested finallies from multiplying the work.
        const ends: [State, State][] = [];
        const through = (from: State): State => {
          const known = ends.find(([start]) => same(start, from));
          if (known) return known[1];
          state = from;
          // Whichever way control left the try and its catch, their variables are gone.
          dropped([...s.block.flatMap(scoped), ...(s.param && localAt(s) ? [localAt(s)!] : []), ...(s.handler ?? []).flatMap(scoped)], [...s.block, ...(s.handler ?? [])].at(-1)?.end ?? s.start);
          statements(s.finalizer!);
          ends.push([from, state]);
          return state;
        };
        if (fin.kind === "finally") {
          for (const exit of fin.exits) {
            state = through(exit.acc);
            if (exit.kind === "raise") raising();
            else if (exit.kind === "return") returning();
            else jumping(exit.target, exit.which);
          }
        }
        state = through(normal);
        return;
      }
      case "while":
        return loop(s, () => s.cond, () => statements(s.body));
      case "doWhile":
        return loop(s, () => s.cond, () => statements(s.body), true);
      case "for":
        if (s.init) statement(s.init);
        return loop(s, () => s.test, () => statements(s.body), false, () => s.update && expr(s.update, undefined, true));
      // The loop reads its array once and keeps it lent, shared, until it ends; its variable,
      // when it is a reference, borrows the array as well.
      case "forOf": {
        // Like JavaScript closing a generator when its loop ends, the loop takes one it owns.
        const taken = types.get(s.right);
        if (taken !== undefined && !isRef(taken) && (typing.yieldsOf(taken) ?? typing.yieldsOf(taken, true)) !== undefined) {
          expr(s.right, (p) => `'${p}' moved here: the 'for...of' loop takes the generator over, as JavaScript closes it when the loop ends; call 'next()' instead to keep it`);
          // What the generator borrows stays lent until the loop ends.
          const holder = arenas.localOf(loopHolders.get(s)) ?? arenas.addLocal({ name: "for...of", type: "void", mutable: false, param: false, id: -s.start - 2_000_000 });
          loopHolders.set(s, holder.localId);
          last.set(holder.localId, s.end);
          if (key(s.right) !== undefined) inherit(holder, s.right);
          else hold(holder, s.right);
          // Each pass gives the variable a new value, which it owns.
          const each = arenas.localOf(localAt(s.left as Stmt)!);
          loop(s, () => ({ id: nextId(ids), kind: "bool", value: false, start: s.start, end: s.start }), () => {
            revive(String(each.id));
            statements(s.body);
          });
          return;
        }
        expr(s.right);
        const place = key(s.right);
        const each = arenas.localOf(localAt(s.left as Stmt)!);
        // A string's loop holds a reference of its own, so its variable stays free to change.
        const text = (coercions.get(s.right) ?? types.get(s.right)) === "string";
        // An `Iterable<T>` parameter's loop gives owned values, through the `[Symbol.iterator]()`
        // call it makes of a class, or at the definition, where nothing says what it stands for.
        const owning = text || s.await || instance.iterators?.has(s) === true || (taken !== undefined && typing.iterableElement(taken) !== undefined && typing.lower(taken) === taken);
        if (place !== undefined && state && !text) {
          free(place, s.right, "lend");
          state.loans.set(s.right.start, { place, mutable: false, start: s.right.start, end: s.right.end, holders: new Set(), call: "the loop", loop: true });
          if (typing.holdsRef(each.type)) state.loans.set(-s.start - 1, { place: `${place}.[]`, mutable: false, start: s.right.start, end: s.right.end, holders: new Set([each.localId]) });
          // An array reached through a reference keeps what that reference borrows lent until
          // the loop ends, and an element that is a reference holds it too.
          // One holder per loop, so passes over it reach the same state and the check settles.
          const loop = arenas.localOf(loopHolders.get(s)) ?? arenas.addLocal({ name: "for...of", type: "void", mutable: false, param: false, id: -s.start - 2_000_000 });
          loopHolders.set(s, loop.localId);
          last.set(loop.localId, s.end);
          inherit(loop, s.right);
          if (typing.holdsRef(each.type)) inherit(each, s.right);
        } else if (state && !text && fromCall(projected(s.right))) {
          // Over a reference a call gave, or a field or element of one, the loop keeps what that
          // reference borrows lent until it ends.
          const loop = arenas.localOf(loopHolders.get(s)) ?? arenas.addLocal({ name: "for...of", type: "void", mutable: false, param: false, id: -s.start - 2_000_000 });
          loopHolders.set(s, loop.localId);
          last.set(loop.localId, s.end);
          hold(loop, projected(s.right));
          if (typing.holdsRef(each.type)) hold(each, projected(s.right));
        }
        // Each pass may end the loop, like a condition that may be false.
        loop(s, () => ({ id: nextId(ids), kind: "bool", value: false, start: s.start, end: s.start }), () => {
          // Each pass gives a string's variable a new string, and a Channel's the value it
          // received, which it owns.
          if (owning) revive(String(each.id));
          statements(s.body);
        });
        state?.loans.delete(s.right.start);
        return;
      }
      case "labeled": {
        exits.set(s, null);
        statement(s.body);
        state = join(state, exits.get(s)!);
        dropped(scoped(s.body), s.end);
        return;
      }
      case "switch": {
        expr(s.discriminant);
        for (const c of s.cases) if (c.test) expr(c.test);
        exits.set(s, null);
        const entry = state;
        let falling: State = null;
        for (const c of s.cases) {
          state = join(entry, falling);
          statements(c.body);
          falling = state;
        }
        state = join(join(falling, exits.get(s)!), s.cases.some((c) => !c.test) ? null : entry);
        dropped(scoped(s), s.end);
        return;
      }
      case "break":
      case "continue": {
        const target = jumps.get(s)!;
        jumping(target, s.kind);
        state = null;
        return;
      }
      // A thrown value leaves with the error, as a returned one does, or goes to a catch.
      case "throw":
        expr(s.value, (p) => `'${p}' moved here: throwing it hands it on`);
        raising();
        state = null;
        return;
      case "return":
        // A `return` in a match arm hands its value to the match and leaves the arm.
        if (jumps.has(s)) {
          const arm = jumps.get(s)!;
          if (s.value) expr(s.value, ...arms.get(arm)!);
          jumping(arm, "break");
          state = null;
          return;
        }
        if (s.value) {
          expr(s.value, () => "");
          // An arrow's expression body may be a call returning nothing.
          if (types.has(s.value)) returned(s.value);
        }
        returning();
        state = null;
        return;
    }
  }

  // A loop runs its body until nothing new has moved or been lent by the time it comes round
  // again, so a move late in the body is caught at a use early in it.
  /** @throws {CompileError} */
  function loop(s: Stmt, test: () => Expr | undefined, body: MoveStep, bodyFirst = false, update?: MoveStep) {
    const entry = state;
    let back: State = null;
    for (let pass = 0; ; pass++) {
      passes.set(s, pass);
      state = join(entry, back);
      exits.set(s, null);
      nexts.set(s, null);
      // The loop ends when its condition is false, or by a `break`.
      let leaving: State = null;
      const cond = () => {
        const t = test();
        if (t) expr(t);
        // A loop with no condition, or `true`, ends only by a `break`.
        leaving = t && !(t.kind === "bool" && t.value) ? join(state, null) : null;
      };
      if (!bodyFirst) cond();
      body();
      state = join(state, nexts.get(s)!);
      // However a pass ended, `continue` included, its body's variables are gone, and a holder
      // used anywhere in the loop is used again on the next pass.
      dropped(s.kind === "for" ? s.body.flatMap(scoped) : scoped(s), s.end - 1);
      // References declared in the body are gone by the time the loop comes round or ends,
      // however it left the body; a `for` loop's initializer outlives every pass.
      for (const local of s.kind === "for" ? s.body.flatMap(inside) : inside(s)) release(arenas.localOf(local));
      if (bodyFirst) cond();
      else update?.();
      leaving = join(leaving, exits.get(s)!);
      const after = state;
      state = leaving;
      // However the loop ended, `break` included, its variables are gone.
      dropped(scoped(s), s.end);
      for (const local of inside(s)) release(arenas.localOf(local));
      leaving = state;
      state = after;
      const next = join(back, state);
      if (same(next, back)) {
        passes.delete(s);
        state = leaving;
        return;
      }
      back = next;
    }
  }

  // Evaluates an expression. `consume` says how its value is handed over, when it is; a
  // value that is only read, like a receiver or an operand, is borrowed. A statement's value
  // is discarded.
  /** @throws {CompileError} */
  function expr(e: Expr, consume?: Consumer, discarded = false) {
    // A value lent to a reference stays where it is.
    const lentAs = coercions.get(e);
    if (lentAs && isRef(lentAs) && !isRef(types.get(e)!)) consume = undefined;
    switch (e.kind) {
      case "int":
      case "bool":
      case "string":
        return;
      case "ident":
        if (instance.envs?.has(e)) return made(e);
        // A JsValue read out of JS gives a new value, leaving the JsValue as it was.
        return locals.has(e) ? use(e, instance.copiesOut.has(e) ? undefined : consume) : undefined;
      case "super":
      case "this":
        free("this", e, "read");
        if (f.self?.owned) return use(e, consume);
        if (consume && state && !typing.isCopy(types.get(e)!)) {
          throw new CompileError("E0202", hinted(types.get(e)!, "'this' can't be moved, since it is only borrowed here; use 'this.clone()' to hand over a copy"), e.start, e.end);
        }
        return;
      case "member":
        if (!types.has(e.object)) return;
        if (key(e) !== undefined) {
          // A tuple's length looks at its optional elements and its rest, so none may have moved.
          const held = types.get(e.object)!;
          const low = typing.lower(deref(held));
          const tuple = typeof low === "string" ? undefined : typing.rec(low);
          if (e.name === "length" && tuple?.kind === "object" && tuple.tuple && (tuple.required !== undefined || tuple.rest !== undefined)) usable(e.object as Named, key(e.object)!);
          return use(e, consume);
        }
        return expr(e.object);
      case "arrow":
        return made(e);
      case "object": {
        // One value can't hold a mutable borrow of a place beside another borrow of it.
        const lends = e.props.flatMap((p) => (p.kind === "property" ? lent(p.value) : []));
        lends.forEach(([place, part, mutable], i) => {
          const other = lends.slice(0, i).find(([q, , m]) => overlaps(place, q) && (mutable || m));
          if (other) throw new CompileError("E0203", `'${text(part as Named)}' is borrowed ${mutable && other[2] ? "mutably twice" : "mutably and shared"} in one value, which would let one change what the other reads`, part.start, part.end);
        });
        for (const p of e.props) {
          const into = (place: string) => `'${place}' moved here into the new object; use '${place}.clone()' to keep a copy`;
          if (p.kind === "property") expr(p.value, into);
          // A spread of a place reads it, cloning its fields; one made for the literal is taken over.
          else if (p.kind === "spread") expr(p.value);
          // A shorthand holds its variable as narrowed there.
          else if (p.kind === "shorthand") use(p, into, typing.field(types.get(e) as Exclude<Type, string>, p.name)!.type);
        }
        return;
      }
      case "new": {
        const name = e.callee.kind === "ident" ? `'new ${e.callee.name}'` : "the constructor";
        return during(e, () => handOver(e.args ?? [], name, e));
      }
      case "call": {
        // Printing, `format`, `inspect`, `JSON.stringify`, `Array.isArray` and `assert` read their
        // arguments.
        if (asserts.has(e) || printCalls.has(e) || formatCalls.has(e) || inspectCalls.has(e) || jsonCalls.get(e) === "stringify" || kindTests.has(e)) {
          for (const a of e.args) expr(a);
          return;
        }
        if (joinCalls.has(e)) return expr((e.callee as Extract<Expr, { kind: "member" }>).object, (p) => `'${p}' moved here: 'join' takes the handle over, as awaiting it would`);
        // `Promise.all` and `Promise.race` take each future in their list as an argument, so what
        // one borrows is lent while the others are made, and two can't conflict.
        if (combinedCalls.has(e)) {
          const [list] = e.args as [Expr];
          return during(e, () => handOver(list.kind === "array" ? (list.elements as Expr[]) : [list], `'Promise.${(e.callee as { name: string }).name}'`, e));
        }
        // An iterator helper's call is named by the method written.
        const shown = (e as { shown?: string }).shown;
        const name = shown ? `'${shown}'` : e.callee.kind === "member" || e.callee.kind === "ident" ? `'${e.callee.name}'` : e.callee.kind === "super" ? "'super'" : "the function";
        // What the call may keep is held once its own loans have ended.
        let keeps: MoveStep | undefined;
        during(e, () => {
          // A nested function called by name, itself included, uses what it captures for the
          // call: lent shared while its arguments run, so they may read it, then mutably for the
          // call where it changes it, so nothing borrowed from those may be live across it. Keys
          // below zero and between whole numbers, one per capture, so no other loan can replace
          // these.
          const built = instance.envs?.get(e);
          const using = selfCalls.has(e) ? [...(instance.captures ?? [])].map(([alias]) => ({ alias: arenas.localOf(alias), changes: instance.changed?.has(alias) === true }))
            : built ? built.env.map((alias, i) => ({ alias: arenas.localOf(alias), changes: arenas.instanceOf(built.of).changed?.has([...arenas.instanceOf(built.of).captures!.keys()][i]!) === true })) : [];
          const captures = using.map(({ alias, changes }, i) => ({ alias, changes, key: -(e.callee.start + (i + 1) / 8192), at: { id: nextId(ids), kind: "ident", name: alias.name, start: e.callee.start, end: e.callee.end } as Named }));
          for (const c of captures) {
            try {
              usable(c.at, String(c.alias.id));
            } catch (err) {
              // The variable isn't written at the call, so the message says the function uses it.
              if (err instanceof CompileError && !selfCalls.has(e)) throw new CompileError(err.code, `${name} uses '${c.alias.name}', and ${err.message}`, err.start, err.end, err.note);
              throw err;
            }
            lend(String(c.alias.id), false, c.at, undefined, name, e, c.at.start, c.key);
          }
          // A closure is read to call it, or taken over when it can run only once.
          const run = e.callee.kind === "ident" ? typing.lower(types.get(e.callee) ?? "void") : undefined;
          if (e.callee.kind === "ident" && locals.has(e.callee)) {
            const r = record(run);
            const once = r?.kind === "closure" && r.once;
            expr(e.callee, once ? (p) => `'${p}' moved here: calling it runs it once, since it moves out what it captured` : undefined);
          }
          // A method's receiver is lent to it for the call, mutably when the method changes it.
          // A mutable receiver is lent shared while the arguments run, so they may read it, and
          // mutably for the call itself.
          // A callee that is itself a value, like an arrow called at once, runs first.
          if (e.callee.kind !== "ident" && e.callee.kind !== "member" && e.callee.kind !== "super" && !dynCalls.get(e)?.callable) expr(e.callee);
          // Through a Dyn, the receiver its interface declares; a stored callable called as a name,
          // an element or any other value is itself what is lent to the call.
          const dyn = dynCalls.get(e);
          // A function held in a field is what its call lends, not the object holding it.
          const held = e.callee.kind === "member" ? typing.lower(types.get(e.callee) ?? "void") : undefined;
          const h = record(held);
          const fieldCall = h?.kind === "closure" || (h?.kind === "dyn" && typing.callableOf.has(h.of));
          const object = e.callee.kind === "member" ? (fieldCall ? e.callee : e.callee.object) : dyn?.callable;
          const place = object && key(object);
          const self: { mutable: boolean; owned?: boolean } | undefined = (calls.has(e) ? bodyOf(arenas, arenas.instanceOf(calls.get(e)!)).self : undefined) ?? (dyn && { mutable: dyn.mutable || dyn.owned, owned: dyn.owned });
          // An owning method takes its receiver over, as an argument it is handed.
          if (object && self?.owned) {
            expr(object, (p) => `'${p}' moved here: ${name} takes its object over; call it on '${p}.clone()' to keep a copy`);
            handOver(e.args, name, e);
            return;
          }
          if (object) expr(object);
          // An array's `push` and `pop`, and a generator's `next`, change it: it is lent shared
          // while the arguments run, as a mutating method's object is, then changed, which nothing
          // borrowing it may see.
          const builtin = object !== undefined && !calls.has(e) && e.callee.kind === "member" && e.callee.name !== "clone";
          const method = (e.callee as { name: string }).name;
          const changes = builtin && (generator(object) || (array(object) && ARRAY_CHANGES.has(method)) || (mapped(object) && MAP_CHANGES.has(method)));
          // Any other array, Map or Set method reads it, lent shared while its callback runs, as
          // a string is while a regex goes through it.
          // A shared value's, an Rc's or a lock's `update` and `read` hand their callback a pointer
          // into the value the receiver reaches, so the callback can't replace or drop the receiver.
          const reads = builtin && !changes && (array(object) || mapped(object) || regexStringCalls.has(e) || (locking(object) && (method === "update" || method === "read")));
          if (object && place !== undefined && (self || changes || reads)) lend(place, false, object, undefined, name, e);
          // A receiver that is a reference a call gave lends again what that reference borrows
          // from, for the whole call, so its callback can't replace what the reference reaches.
          const origins = object && place === undefined && (self || changes || reads) ? lent(object) : [];
          origins.forEach(([p, part], i) => lend(p, false, part, undefined, name, e, part.start, partKey(part, i)));
          handOver(e.args, name, e);
          for (const c of captures) {
            if (!c.changes || !state) continue;
            state.loans.delete(c.key);
            lend(String(c.alias.id), true, c.at, undefined, name, e, e.end - 1, c.key);
          }
          if (object && changes) {
            state?.loans.delete(object.start);
            change(object);
          }
          if (object && place !== undefined && self?.mutable && state) {
            state.loans.delete(object.start);
            lend(place, true, object, undefined, name, e, e.end - 1);
          }
          const loans = state?.loans;
          if (self?.mutable && loans) {
            origins.forEach(([p, part, mutable], i) => {
              loans.delete(partKey(part, i));
              lend(p, mutable, part, undefined, name, e, e.end - 1, partKey(part, i));
            });
          }
          // A method that changes its object, or a base's constructor, may keep what is lent,
          // when the object has somewhere to keep a reference.
          const keeper = object ?? (e.callee.kind === "super" ? e.callee : undefined);
          const keeperType = keeper && types.get(keeper);
          const holder = keeperType === undefined || typing.holdsRef(deref(keeperType));
          if (keeper && holder && (self?.mutable || e.callee.kind === "super")) keeps = () => keep(keeper, e.args.filter((a) => typing.holdsRef(coercions.get(a) ?? types.get(a)!)));
        });
        keeps?.();
        if (instance.raises.has(e)) raising();
        return;
      }
      // An awaited future is handed to the await, which runs it to completion.
      case "unary":
        if (e.op === "await") {
          // The future runs across suspensions, after this statement's temporaries are gone.
          for (const s of awaitedSources(e.operand)) if (sourceTemporary(s, true)) throw outlived(s, "the awaited Promise");
          expr(e.operand, (p) => `'${p}' moved here: awaiting a Promise runs it to completion, after which it is gone`);
          // An awaited async call raises what it throws here, where the await finishes it.
          if (instance.raises.has(e)) raising();
          return;
        }
        return expr(e.operand);
      case "template":
        for (const x of e.exprs) expr(x);
        return;
      // A quote's splices move into the value it makes; other tags became calls.
      case "tagged":
        if (e.template.kind === "template") for (const x of e.template.exprs) expr(x, (place) => `'${place}' moved here into the quote; use '${place}.clone()' to keep a copy`);
        return;
      case "index":
        if (consume && element(e) && !typing.isCopy(types.get(e)!)) throw elementMove(e, types.get(e)!);
        if (key(e) === undefined) expr(e.object);
        else use(e, consume);
        return expr(e.index);
      case "update":
        expr(e.operand);
        return change(e.operand);
      case "assign": {
        const target = bare(e.target);
        // A whole value written through a mutable reference changes everything it points to,
        // and can't keep references there, nor be handed on as well.
        if (isRef(types.get(target)!) && coercions.has(target)) {
          expr(target);
          expr(e.value, (p) => `'${p}' moved here into what '${text(target)}' points to; use '${p}.clone()' to keep a copy`);
          change(target, e.end);
          if (typing.holdsRef(coercions.get(e.value) ?? types.get(e.value)!)) keep(target, [e.value]);
          if (consume && !typing.isCopy(types.get(e)!)) {
            throw new CompileError("E0201", `this assignment's value can't be used: it was moved into what '${text(target)}' points to, which only borrows it`, e.start, e.end);
          }
          return;
        }
        if (e.op !== "=") expr(target);
        // A target's indexes run before the value, as in JavaScript.
        else for (const index of indexes(target)) expr(index);
        // A place inside a variable is found before the value runs, so a nested function the
        // value calls can't replace the variable from under it.
        const nested = instance.envs !== undefined && holdsNode({ of: "expr", node: e.value }, (n) => n.of === "expr" && instance.envs!.has(n.node));
        const root = nested && (target.kind === "member" || target.kind === "index") ? rootOf(target) : undefined;
        const held = root && key(root);
        const hold = -(target.start + 0.75);
        if (held !== undefined) lend(held, false, root!, undefined, `the assignment to '${text(target)}'`, e, root!.start, hold);
        expr(e.value, (p) => `'${p}' moved here into '${text(target)}'; use '${p}.clone()' to keep a copy`);
        if (held !== undefined) state?.loans.delete(hold);
        // The target changes once the value is ready, after the value's reads.
        assign(target, e.end);
        const local = target.kind === "ident" ? localRecord(arenas, localAt(target)) : undefined;
        // Pointing a reference elsewhere lets go of what it held; a value holding references
        // given another one to hold adds it.
        if (local && instance.captures?.has(local.localId) && typing.holdsRef(coercions.get(e.value) ?? types.get(e.value)!)) keep(target, [e.value]);
        if (local && typing.holdsRef(local.type)) rehold(local, e.value);
        // A value given a reference to keep, through a field or a setter, holds it; `this` may
        // only be given what outlives the call.
        if (target.kind === "member" && typing.holdsRef(coercions.get(e.value) ?? types.get(e.value)!)) keep(target.object, [e.value]);
        // An assignment used as a value hands over what it just stored. A setter keeps what it
        // was given, with nothing left to read or hand on.
        if (!discarded && state && !typing.isCopy(types.get(e)!) && setters.has(target)) {
          throw new CompileError("E0201", `'${text(target)}' is a setter, which keeps the value assigned to it, so this assignment can't also be used as a value; assign a clone`, e.start, e.end);
        }
        if (consume && !typing.isCopy(types.get(e)!) && key(target) !== undefined) use(target, consume);
        return;
      }
      // Each arm runs from the state after the subject and any guards before it that failed,
      // and the match ends in any of theirs. A binding borrowing from the matched place holds a
      // loan of it until its arm ends; a guard holds one while it runs, since later arms still
      // test the place.
      case "match": {
        expr(e.subject);
        const subject = through(e.subject);
        const place = key(subject);
        let entry = join(state, null);
        let after: State = null;
        for (const arm of e.arms) {
          state = join(entry, null);
          const bound = bindings(arm.pattern).flatMap((b) => localAt(b as Expr) ?? []);
          // Each time an arm is entered, its bindings are new, as a loop's `let` is.
          for (const local of bound) revive(String(arenas.localOf(local).id));
          const borrowing = bound.filter((l) => isRef(arenas.localOf(l).type));
          for (const holderId of borrowing) {
            const holder = arenas.localOf(holderId);
            if (place !== undefined && state) state.loans.set(-holder.id - 1_000_000, { place, mutable: false, start: e.subject.start, end: e.subject.end, holders: new Set([holder.localId]) });
            // Through a reference, the binding holds what that reference borrows, a reference a
            // call gave included.
            inherit(holder, subject);
            if (place === undefined && fromCall(projected(subject))) hold(holder, projected(subject));
          }
          if (arm.guard) {
            const at = -arm.guard.start - 1;
            if (place !== undefined && state) state.loans.set(at, { place, mutable: false, start: arm.guard.start, end: arm.guard.end, holders: new Set(), guard: true });
            guarding.add(arm.guard.start);
            expr(arm.guard);
            guarding.delete(arm.guard.start);
            state?.loans.delete(at);
            const passed = state;
            state = join(passed, null);
            for (const holder of borrowing) release(arenas.localOf(holder));
            entry = join(entry, state);
            state = passed;
          }
          if (arm.body.kind === "block") {
            arms.set(arm.body, [consume, discarded]);
            exits.set(arm.body, null);
            statement(arm.body);
            state = join(state, exits.get(arm.body)!);
            dropped([...scoped(arm.body), ...bound], arm.body.end);
          } else {
            expr(arm.body, consume, discarded);
            dropped(bound, arm.body.end);
          }
          for (const holder of borrowing) release(arenas.localOf(holder));
          after = join(after, state);
        }
        state = after;
        return;
      }
      case "conditional": {
        expr(e.cond);
        if (!types.has(e.then)) return expr(e.else, consume, discarded);
        if (!types.has(e.else)) return expr(e.then, consume, discarded);
        const before = join(state, null);
        expr(e.then, consume, discarded);
        const then = state;
        state = before;
        expr(e.else, consume, discarded);
        state = join(then, state);
        return;
      }
      case "binary": {
        // `a ?? b` hands over whichever it gives; a Rust value, which is never copied, always.
        const given = e.op === "??" ? (consume ?? (typing.holdsPart(types.get(e)!, (u) => rustClassOf(typing, u) !== undefined) ? (place: string) => `'${place}' moved here: '??' hands over the Rust value it holds` : undefined)) : undefined;
        if (e.op === "??") outOfBorrow(e.left, e, consume);
        expr(e.left, given);
        // The right side of `&&`, `||` and `??` may not run.
        const before = join(state, null);
        expr(e.right, given);
        if (e.op === "&&" || e.op === "||" || e.op === "??") state = join(before, state);
        return;
      }
      // `x!` is x's value, handed over or read as x is.
      case "nonNull":
        if (redundantBang(e)) return expr(e.expr, consume, discarded);
        outOfBorrow(e.expr, e, consume);
        return expr(e.expr, consume);
      case "as":
        if (narrowsUnion(e)) {
          outOfBorrow(e.expr, e, consume);
          return expr(e.expr, consume);
        }
        return expr(e.expr, consume, discarded);
      case "satisfies":
      case "unsafe":
        return expr(e.expr, consume, discarded);
      // Comptime code runs while compiling, so it moves and borrows nothing at run time.
      case "comptime":
        return;
      // A yielded value is handed to whoever called `next()`.
      case "yield":
        if (e.value) expr(e.value, (p) => `'${p}' moved here: yielding it hands it on; use '${p}.clone()' to keep a copy`);
        stillBorrowed(e);
        return;
      // A pipe over a value hands it to the topic, new each time the pipe runs.
      // Like a `let`, the topic holds what its value borrows, until the pipe ends.
      case "pipe": {
        const local = arenas.localOf(localAt(e)!);
        release(local);
        expr(e.value, (place) => `'${place}' moved here into the pipe's '%'; use '${place}.clone()' to keep a copy`);
        revive(String(local.id));
        if (typing.holdsRef(local.type)) rehold(local, e.value);
        expr(e.body, consume, discarded);
        release(local);
        return;
      }
      // A spread of a place reads it, cloning its elements; one made for the spread is taken over.
      case "array":
        for (const x of e.elements) {
          if (x?.kind === "spread") expr(x.value);
          else if (x) expr(x, (place) => `'${place}' moved here into the new array; use '${place}.clone()' to keep a copy`);
        }
        return;
      case "float":
      case "bigint":
      case "regex":
      case "null":
        return;
      // A throw expression hands its value on, and nothing after it runs.
      case "throw":
        expr(e.value, (p) => `'${p}' moved here: throwing it hands it on`);
        raising();
        state = null;
        return;
      default:
        assert(false, `the move checker has no case for '${e.kind}' expressions`);
    }
  }

  // A value that may keep references given to it holds them: a holder variable, or `this`, which
  // may be given only what points into this function's parameters, since it outlives the call.
  /** @throws {CompileError} */
  function keep(target: Expr, values: Expr[]) {
    if (values.length === 0) return;
    // Keeping references in what a reference points to would need its owner to hold them.
    for (let p: Expr = target; ; p = (p as Extract<Expr, { kind: "member" }>).object) {
      const t = types.get(p);
      if (t && isRef(t)) {
        throw new CompileError("E0801", `keeping references through the reference '${text(p)}' is not supported yet; do it on what '${text(p)}' points to, directly`, target.start, target.end);
      }
      if (p.kind !== "member") break;
    }
    const root = rootOf(target);
    // What a closure captures outlives the call that keeps it, like what a reference points to.
    const capture = localRecord(arenas, localAt(root as never));
    if (capture && instance.captures?.has(capture.localId)) {
      throw new CompileError("E0801", `keeping references in '${capture.name}', which this closure captures, is not supported yet; keep them in a variable of the closure's own`, target.start, target.end);
    }
    if (root.kind === "this" || root.kind === "super") {
      for (const v of values) {
        stored(v);
        if (f.self && typing.holdsRef(f.self.type)) hold(kept, v);
      }
      return;
    }
    const owner = localRecord(arenas, localAt(root as never));
    if (owner && typing.holdsRef(owner.type) && !isRef(owner.type)) for (const v of values) hold(owner, v);
  }

  // Arguments are handed over, or lent for the call, in order.
  function handOver(args: Expr[], name: string, call: Expr) {
    // What crosses into JS is copied there, so it is only read here; a callback is kept by JS,
    // so it is handed over.
    if (jsCrossings.has(call)) {
      return args.forEach((a) => {
        const kept = typing.keptByJs(coercions.get(a) ?? "void") || typing.keptByJs(types.get(a)!);
        expr(a, kept ? (p) => `'${p}' moved here: JS keeps a callback or a Promise given to it, as it may use it later; pass '${p}.clone()' to keep a copy` : undefined);
      });
    }
    const helper = (call as { shown?: string }).shown;
    for (const a of args) {
      expr(a, (p) => (helper && a === args[0] ? `'${p}' moved here: ${name} takes its generator over` : `'${p}' moved here: passing it to ${name} hands it over, as if ${name} kept it; pass '${p}.clone()' to keep a copy`));
      lent(a).forEach(([place, part, mutable], i) => lend(place, mutable, part, undefined, name, call, part.start, partKey(part, i)));
    }
  }

  // The places an expression lends a reference to, and how: a place borrowed, a reference
  // passed on, which lends what it points to again, or either side of a `?:`.
  function lent(e: Expr): [string, Expr, boolean][] {
    const lentAs = coercionOf(e);
    e = unwrapped(e);
    if (e.kind === "conditional") return [...(types.has(e.then) ? lent(e.then) : []), ...(types.has(e.else) ? lent(e.else) : [])];
    if (e.kind === "binary" && choosing(e)) return [...lent(e.left), ...lent(e.right)];
    // A literal lends what each of its parts does, nested literals included.
    if (e.kind === "object") return e.props.flatMap((p) => (p.kind === "property" ? lent(p.value) : []));
    // A closure made for a call lends what it captures for the call.
    if (e.kind === "arrow" || instance.envs?.has(e)) {
      return captured(e).filter(([, , from, , held]) => !held || reborrows(from!)).map(([place, use, , mutable, held]) => [place, use as Expr, mutable || held]);
    }
    // A field, element or unwrapped Option of a returned reference reaches into what that
    // reference borrows, so it lends what the reference does.
    const root = projected(e);
    if (root !== e && key(e) === undefined && fromCall(root)) return lent(root);
    // A call's returned reference lends again what it borrows from, a receiver included; a
    // future lends it mutably when it holds a mutable reference.
    const from = borrowsFrom.get(e);
    if (from) {
      const result = lentAs ?? types.get(e)!;
      return from.flatMap((s) => source(s, isRef(result) ? typing.rec(result).mutable : typing.holdsMut(result)));
    }
    const type = types.get(e)!;
    const to = lentAs ?? type;
    const place = key(e);
    // A shared reference passed on is just another pointer, which needs nothing lent; a
    // mutable one lends itself, shared or mutably as it is passed on.
    // A mutable reference or nothing passed on lends itself as a mutable reference does.
    const asRef = (t: Type) => {
      const r = isRef(t) ? t : typing.optionRef(t);
      return r && typing.rec(r);
    };
    const ref = to && asRef(to);
    const held = type && asRef(type);
    if (place === undefined || !ref || (held && !held.mutable)) return [];
    return [[place, e, ref.mutable]];
  }

  // What a call's result borrows from one of its sources: what the source lends, or, for a
  // receiver that is a place, the place itself.
  function source(s: Expr, mutable: boolean): [string, Expr, boolean][] {
    const parts = lent(s);
    const place = key(s);
    if (parts.length > 0 || place === undefined || isRef(types.get(s)!)) return parts;
    return [[place, s, mutable]];
  }

  // Runs a call's arguments, then ends the loans made for it.
  /** @throws {CompileError} */
  function during(call: Expr, run: MoveStep) {
    run();
    if (!state) return;
    for (const [at, loan] of state.loans) if (loan.call !== undefined && loan.callAt === call.id && loan.holders.size === 0) state.loans.delete(at);
  }

  // Reads or hands over a place, which must still hold its value and not be lent so as to
  // forbid it.
  /** @throws {CompileError} */
  function use(e: Named, consume?: Consumer, type: Type = e.kind === "shorthand" ? arenas.localOf(localAt(e)!).type : types.get(e)!) {
    const place = key(e)!;
    usable(e, place);
    const moving = consume !== undefined && !typing.isCopy(type);
    if (moving && place.includes(".[]")) throw elementMove(e, type);
    free(place, e, moving ? "move" : "read");
    if (!moving || !state) return;
    const root = localRecord(arenas, localAt(rootOf(e) as never));
    if (root && (isRef(root.type) || typing.optionRef(root.type))) {
      throw new CompileError("E0202", hinted(type, `'${text(e)}' can't be moved out of '${root.name}', which only borrows it; use '${text(e)}.clone()'`), e.start, e.end);
    }
    // Nor out of a reference a field holds, or a shared value every clone of it uses.
    for (let p: Named = e; p.kind === "member"; p = p.object) {
      const holder = record(types.get(p.object));
      if (holder?.kind === "shared" || (holder?.kind === "ref" && record(holder.to)?.kind === "shared")) {
        throw new CompileError("E0202", `'${text(e)}' can't be moved out of '${text(p.object)}', which every clone of it shares; use it where it is`, e.start, e.end);
      }
      if (p !== e && isRef(types.get(p)!)) {
        throw new CompileError("E0202", hinted(type, `'${text(e)}' can't be moved out of '${text(p)}', which only borrows it; use '${text(e)}.clone()'`), e.start, e.end);
      }
    }
    if (place.startsWith("this") && !f.self?.owned) {
      throw new CompileError("E0202", hinted(type, `'${text(e)}' can't be moved out of 'this', since it is only borrowed here; use '${text(e)}.clone()'`), e.start, e.end);
    }
    // A closure moving out what it captures holds it, and can run only once.
    if (root && instance.captures?.has(root.localId)) instance.moved!.add(root.localId);
    instance.consumes.add(e);
    state.moves.set(place, { start: e.start, end: e.end, note: hinted(type, consume!(text(e))), passes: new NodeMap([...passes]) });
  }

  // A message without its advice to clone, for a value holding a JoinHandle, which can't be.
  function hinted(type: Type, message: string): string {
    // A Promise isn't cloned either: its future runs once.
    const counted = typing.holdsPart(type, (u) => {
      const r = record(u);
      return (r?.kind === "block" && (r.which === "Semaphore" || r.which === "Permit")) || r?.kind === "future";
    }, true);
    return typing.holdsHandle(type, true) || counted ? message.replace(/;[^;]*\.clone\(\)'[^;]*$/, "") : message;
  }

  // A place can't be used once it, something it is inside, or something inside it moved.
  /** @throws {CompileError} */
  function usable(e: Named, place: string) {
    if (!state) return;
    for (const [moved, move] of state.moves) {
      if (!overlaps(moved, place)) continue;
      const name = text(e);
      if (move.unassigned) {
        const root = pathOf(moved);
        throw new CompileError("E0205", `'${root}' is used before being assigned; give it a value on every path that reaches here, as TypeScript requires`, e.start, e.end, { message: move.note, start: move.start, end: move.end });
      }
      const what = moved === place ? `'${name}' was moved, so it can't be used here`
        : place.startsWith(`${moved}.`) ? `'${name}' can't be used here because '${pathOf(moved)}' was moved`
        : `'${name}' can't be used as a whole here because '${pathOf(moved)}' was moved out of it`;
      const earlier = [...passes].some(([loop, pass]) => (move.passes.get(loop) ?? pass) < pass) ? " (in an earlier pass through this loop)" : "";
      throw new CompileError("E0201", what + earlier, e.start, e.end, { message: move.note, start: move.start, end: move.end });
    }
  }

  // A place can't be accessed in a way a live loan of it, of something inside it or of
  // something it is inside forbids: a mutable loan forbids everything, a shared one changes,
  // moves and mutable loans.
  // Holders as a message names them, each once.
  function named(holders: LocalId[]): string[] {
    let out: string[] = [];
    for (const id of holders) {
      const name = arenas.localOf(id).name;
      const shown = name === "for...of" ? "a 'for...of' loop" : `'${name}'`;
      if (!out.includes(shown)) out.push(shown);
    }
    return out;
  }

  /** @throws {CompileError} */
  function free(place: string, e: Named, access: Access, at: usize = e.start) {
    if (!state) return;
    for (const loan of state.loans.values()) {
      if (!overlaps(loan.place, place) || !live(loan, at)) continue;
      if (!loan.mutable && (access === "read" || access === "lend")) continue;
      const lent = pathOf(loan.place);
      const verb = { read: "use", change: "change", move: "move", lend: "lend", "lend mutably": "mutably lend" }[access];
      const holders = [...loan.holders].filter((h) => (last.get(h) ?? -1) > (at as f64));
      const holder = loan.loop ? `a 'for...of' loop is reading '${lent}'`
        : loan.guard ? `a match guard is reading '${lent}', and later arms still test it`
        : loan.call
        ? `'${lent}' is lent ${loan.mutable ? "mutably " : ""}to ${loan.call} for this call`
        : `${named(holders).join(" and ")} ${named(holders).length > 1 ? "borrow" : "borrows"} '${lent}'${loan.mutable ? " mutably" : ""} and ${named(holders).length > 1 ? "are" : "is"} used later`;
      const until = loan.loop ? "the loop ends" : loan.guard ? "the guard ends" : loan.call ? "the call returns" : "the borrow's last use";
      const earlier = loan.start >= e.start && [...passes.values()].some((p) => p > 0) ? " on an earlier pass through this loop" : "";
      throw new CompileError("E0203", `cannot ${verb} '${text(e)}' while ${holder}`, e.start, e.end, {
        message: `'${lent}' is lent ${loan.mutable ? "mutably " : ""}here${earlier}, so it can't ${loan.mutable ? "be used" : "change or move"} until ${until}`,
        start: loan.start, end: loan.end,
      });
    }
  }

  // A loan's key for the `i`th place a value lends, apart from the others it lends at the same
  // spot, as a closure's variables are when its environment is made from a call's or a name's.
  // Other loans are keyed by whole numbers, or a temporary's by a half, so these keys and a
  // call's captures and an assignment's hold below take other fractions of an offset, which
  // never equal those.
  function partKey(part: Named, i: usize): f64 {
    return (part.start as f64) + ((i as f64) + 1) / 8192;
  }

  // Lends a place, which must be free to lend so, to a reference variable or for a call.
  // A loan is keyed by where it starts, or by `key` for one no source offset may share.
  function lend(place: string, mutable: boolean, e: Named, holder?: Local, call?: string, callAt?: Expr, at: usize = e.start, key: f64 = e.start as f64) {
    free(place, e, mutable ? "lend mutably" : "lend", at);
    if (!state) return;
    state.loans.set(key, { place, mutable, start: e.start, end: e.end, holders: new Set(holder ? [holder.localId] : []), call, callAt: callAt !== undefined ? callAt.id : undefined });
  }

  // A reference variable given a value holds what it borrows: a place lent to it, or what
  // the reference it copies, or the reference it borrows through, holds.
  /** @throws {CompileError} */
  function hold(holder: Local, e: Expr) {
    if (!state) return;
    const outer = e;
    const heldAs = coercionOf(e);
    e = unwrapped(e);
    if (e.kind === "conditional") {
      if (types.has(e.then)) hold(holder, e.then);
      if (types.has(e.else)) hold(holder, e.else);
      return;
    }
    if (e.kind === "binary" && choosing(e)) {
      hold(holder, e.left);
      hold(holder, e.right);
      return;
    }
    if (lentTemporary(outer)) throw outlived(e, `'${holder.name}'`);
    // A call's returned reference holds what its sources do: a receiver where it lives.
    const from = borrowsFrom.get(e);
    if (from) {
      const result = heldAs ?? types.get(e)!;
      // A future holding a mutable reference, or a Dyn's async method declaring `Mut<this>`,
      // lends what it borrows mutably until it is done.
      const mutable = isRef(result) ? typing.rec(result).mutable : typing.holdsMut(result) || dynCalls.get(e)?.mutable === true;
      for (const s of from) {
        if (sourceTemporary(s)) throw outlived(s, `'${holder.name}'`);
        const t = coercionOf(s) ?? types.get(s)!;
        if (typing.holdsRef(t) && (isRef(t) || key(s) === undefined)) hold(holder, s);
        else if (key(s) !== undefined) {
          lend(key(s)!, mutable, s, holder);
          inherit(holder, s);
          if (throughUnion(s)) temporary(holder, s);
        } else temporary(holder, s);
      }
      return;
    }
    const type = types.get(e)!;
    const to = heldAs ?? type;
    // A closure holds what it captures.
    if (e.kind === "arrow" || instance.envs?.has(e)) {
      captured(e).forEach(([place, use, from, mutable, held], i) => {
        // A copy of a mutable reference lends it again.
        if (!held || reborrows(from!)) lend(place, mutable || held, use, holder, undefined, undefined, use.start, partKey(use, i));
        if (from && typing.holdsRef(from.type)) inheritFrom(holder, from);
      });
      return;
    }
    if (!isRef(to)) {
      // A value holding references holds what its parts do, or what the value it copies does.
      if (!typing.holdsRef(to)) return;
      if (e.kind === "object") {
        for (const p of e.props) {
          if (p.kind === "property") hold(holder, p.value);
          else if (p.kind === "shorthand" && localAt(p) !== undefined) {
            const local = arenas.localOf(localAt(p)!);
            // A shorthand lent to a reference field lends its variable; a mutable reference copied
            // lends itself mutably, as `{ m: m }` does, so only one of them is used at a time.
            // Meeting a union, the literal's own type is the member it went into.
            const shape = isUnion(to) ? types.get(e)! : to;
            if (isRef(typing.field(shape as Exclude<Type, string>, p.name)!.type) && !isRef(local.type)) lend(String(local.id), false, p, holder);
            else if (typing.holdsRef(local.type)) {
              if (isRef(local.type) && typing.rec(local.type).mutable) lend(String(local.id), true, p, holder);
              inheritFrom(holder, local);
            }
          }
        }
      } else {
        lent(outer).forEach(([lentPlace, part, mutable], i) => lend(lentPlace, mutable, part, holder, undefined, undefined, part.start, partKey(part, i)));
        inherit(holder, e);
      }
      return;
    }
    // A place borrowed, or a reference copied, is lent to the holder: a mutable reference
    // copied lends itself mutably, so only one of them is used at a time. A copy keeps its
    // source borrowed too, so it can't be told apart from the original while held.
    lent(outer).forEach(([lentPlace, part, mutable], i) => lend(lentPlace, mutable, part, holder, undefined, undefined, part.start, partKey(part, i)));
    inherit(holder, e);
    if (!inPlace(e, to)) temporary(holder, e);
  }

  // Through a reference, or a value holding references, what it holds stays held.
  function inherit(holder: Local, e: Expr) {
    const root = localRecord(arenas, localAt(rootOf(e) as never));
    if (root && typing.holdsRef(root.type)) inheritFrom(holder, root);
  }

  function inheritFrom(holder: Local, root: Local) {
    if (!state || root === holder) return;
    for (const [at, loan] of state.loans) if (loan.holders.has(root.localId)) state.loans.set(at, { ...loan, holders: new Set([...loan.holders, holder.localId]) });
  }

  // Whether an argument lends a value made for the statement, rather than a place or a
  // reference it already is.
  // `x!` is lent where `x` holds it. A string literal lives for the whole program, so only a
  // body that can stop, losing the slot its pointer is kept in, can't hold one.
  function lentTemporary(s: Expr, across = false): boolean {
    const lent = coercionOf(s);
    const at = through(s);
    if (s.kind === "string" && !across && !f.generator && !f.async) return false;
    // A JsValue read out of JS is made for the statement, though it names a variable.
    return lent !== undefined && isRef(lent) && !isRef(types.get(s)!) && (key(at) === undefined || instance.copiesOut.has(at));
  }

  // Whether a source a call's result borrows from is a value made for the statement: a lent
  // argument, or a receiver that isn't a place, which `this` borrows with no coercion recorded.
  function sourceTemporary(s: Expr, across = false): boolean {
    if (lentTemporary(s, across)) return true;
    if (s.kind === "string" && !across && !f.generator && !f.async) return false;
    return key(through(s)) === undefined && !typing.holdsRef(coercionOf(s) ?? types.get(s)!);
  }

  // What an awaited future borrows from: a combinator's are those of each future in its list.
  function awaitedSources(e: Ref<Expr>): Expr[] {
    if (combinedCalls.has(e) && e.kind === "call" && e.args.length > 0) {
      let out: Expr[] = [];
      if (awaitedIn(e.args[0]!, out)) return out;
    }
    return borrowsFrom.get(e) ?? [];
  }

  // A combinator's list of futures: what each borrows from, and whether it is a list written out.
  function awaitedIn(list: Ref<Expr>, out: Mut<Expr[]>): boolean {
    if (list.kind !== "array") return false;
    for (const x of list.elements) {
      if (x === undefined) continue;
      for (const y of awaitedSources(x)) out.push(y);
    }
    return true;
  }

  // A borrow kept past its statement can't point at a temporary, which is gone once the
  // statement ends.
  function outlived(s: Expr, holder: string): CompileError {
    if (instance.copiesOut.has(s) && s.kind === "ident") return new CompileError("E1005", `${holder} would keep borrowing what '${s.name}' gives here, which is read out of JS anew at each use and gone once its statement ends; keep it in a 'const' first and borrow that`, s.start, s.end);
    return new CompileError("E0204", `${holder} would keep borrowing this temporary, which is gone once its statement ends; give it a name first, as in 'const xs = ...;'`, s.start, s.end);
  }

  // A reference to a temporary or a copy holds that, so it is never returned.
  function temporary(holder: Local, e: Expr) {
    // Keyed beside any loan made at the same place, which it must not replace.
    state?.loans.set(e.start + 0.5, { place: TEMPORARY, mutable: false, start: e.start, end: e.end, holders: new Set([holder.localId]) });
  }

  // Whether a reference made from `e` points where `e` lives, rather than at a copy: a place
  // of exactly the type borrowed, reached through real fields of known layout, or a reference
  // to the same type or to one member of a union.
  function inPlace(e: Expr, to: RefType): boolean {
    const type = types.get(e)!;
    const local = e.kind === "ident" ? localRecord(arenas, localAt(e)) : undefined;
    const narrowed = (t: Type) => local !== undefined && local.type !== type && isUnion(t);
    const target = typing.rec(to).to;
    if (isRef(type)) {
      const held = typing.rec(type).to;
      if (narrowed(held)) return false;
      const [from, want] = [typing.lower(held), typing.lower(target)];
      return from === want || (isUnion(from) && typing.rec(from).members.includes(want));
    }
    if (key(e) === undefined || throughUnion(e) || narrowed(type)) return false;
    return typing.lower(type) === typing.lower(target) || typing.partOfItself(type, target);
  }

  // Whether a field path passes through a union, or ends where a type parameter's concrete type
  // stores the field as another type, so the field is read as a copy. At a definition, where
  // nothing is concrete, each instance decides.
  function throughUnion(e: Expr): boolean {
    for (let p: Expr = e; p.kind === "member"; p = p.object) {
      const holder = types.get(p.object);
      if (holder && record(deref(holder))?.kind === "union") return true;
    }
    const stored = storedType(e);
    return stored !== undefined && typing.lower(stored) !== typing.lower(types.get(e)!);
  }

  // The type a place is stored as, where an instance knows it: a field read through a type
  // parameter has its concrete type's field type, as codegen lays it out.
  function storedType(e: Expr): Type | undefined {
    if (e.kind !== "member") return types.get(e);
    const holder = storedType(e.object);
    const held = holder && deref(holder);
    const concrete = held && typeof held !== "string" ? typing.lower(held) : held;
    if (typeof concrete === "string" || !concrete) return types.get(e);
    const kind = typing.rec(concrete).kind;
    if (kind === "union" || kind === "param") return types.get(e);
    return typing.field(concrete, e.name)?.type ?? types.get(e);
  }

  // A returned reference may point only into what its lifetime ties it to: a parameter's
  // borrow, or `this`, never this function's own values.
  function returned(e: Expr) {
    outlives(e, origins, "return", "return an owned value instead");
  }

  // What a body stores into `this` outlives the call, so it may point only into parameters.
  function stored(e: Expr) {
    outlives(e, f.params.map((_, i) => i), "store in 'this'", "store an owned value instead");
  }

  // A value leaving the body may point only into what `allowed` says outlives it.
  /** @throws {CompileError} */
  function outlives(e: Expr, allowed: Origin[], verb: string, instead: string) {
    const type = coercions.get(e) ?? types.get(e)!;
    if (!typing.holdsRef(type)) return;
    for (const place of pointsInto(e)) {
      if (place === TEMPORARY) {
        throw new CompileError("E0204", `can't ${verb} a reference to a temporary or a copy, which is gone once the function returns; ${instead}`, e.start, e.end);
      }
      const param = place.startsWith("param ") ? Number(place.slice(6)) : undefined;
      if (param !== undefined ? allowed.includes(param) : place.startsWith("this") && allowed.includes("this")) continue;
      const names = allowed.map((o) => (o === "this" ? "'this'" : `'${paramName(o)}'`)).join(" or ") || "nothing it was given";
      const what = param !== undefined ? `'${paramName(param)}'` : place.startsWith("this") ? `'${pathOf(place)}'` : undefined;
      const message = what
        ? verb === "return" ? `the returned reference points into ${what}, but its lifetime ties it to ${names}; give ${what} that lifetime, or return an owned value` : `the stored reference points into ${what}, but it may only point into ${names}`
        : `can't ${verb} a reference to '${pathOf(place)}', which belongs to this function and is gone once it returns; ${instead}`;
      throw new CompileError("E0209", message, e.start, e.end);
    }
  }

  // The places a reference value points into: places it borrows where they live, what the
  // reference variables it reads through hold, what calls' results borrow, or a temporary.
  function pointsInto(e: Expr): string[] {
    const pointsAs = coercionOf(e);
    e = unwrapped(e);
    if (e.kind === "conditional") return [...(types.has(e.then) ? pointsInto(e.then) : []), ...(types.has(e.else) ? pointsInto(e.else) : [])];
    if (e.kind === "binary" && choosing(e)) return [...pointsInto(e.left), ...pointsInto(e.right)];
    // A closure points at what it borrows, and wherever what it holds points.
    if (e.kind === "arrow" || instance.envs?.has(e)) return captured(e).flatMap(([place, , from, , held]) => (held ? (from && typing.holdsRef(from.type) ? heldBy(from) : []) : [place]));
    const from = borrowsFrom.get(e);
    if (from) {
      return from.flatMap((s) => {
        const t = coercionOf(s) ?? types.get(s)!;
        if (isRef(t) || (typing.holdsRef(t) && key(s) === undefined)) return pointsInto(s);
        return key(s) !== undefined && !throughUnion(s) ? within(s) : [TEMPORARY];
      });
    }
    const type = types.get(e)!;
    const to = pointsAs ?? type;
    if (!isRef(to)) {
      // A value holding references points wherever its parts, or the value it copies, do.
      if (!typing.holdsRef(to)) return [];
      if (e.kind === "object") {
        return e.props.flatMap((p) => {
          if (p.kind === "property") return pointsInto(p.value);
          if (p.kind !== "shorthand") return [];
          const local = localRecord(arenas, localAt(p));
          if (!local) return [];
          return isRef(typing.field(to as Exclude<Type, string>, p.name)!.type) && !isRef(local.type) ? [String(local.id)] : heldBy(local);
        });
      }
      const root = localRecord(arenas, localAt(rootOf(e) as never));
      return root && typing.holdsRef(root.type) ? heldBy(root) : [];
    }
    if (!inPlace(e, to)) return [TEMPORARY];
    return within(e);
  }

  // The places a holder's loans are on, leaving out those inside other holders, whose own
  // loans are held too.
  function heldBy(root: Local): string[] {
    const refs = new Set([...locals.values()].map((l) => arenas.localOf(l)).filter((l) => isRef(l.type) || typing.optionRef(l.type)).map((l) => String(l.id)));
    return [...(state?.loans.values() ?? [])].filter((l) => l.holders.has(root.localId) && !refs.has(l.place.split(".")[0]!)).map((l) => l.place);
  }

  // Where a place lives: itself, or, reached through a reference variable, what that holds; a
  // reference read out of a value holding references points where that value's loans are.
  function within(e: Expr): string[] {
    const root = localRecord(arenas, localAt(rootOf(e) as never));
    if (!root || !(isRef(root.type) || typing.optionRef(root.type) || (isRef(types.get(e)!) && typing.holdsRef(root.type)))) return [key(e)!];
    return heldBy(root);
  }

  function paramName(i: usize): string {
    return f.params[i]!.pattern.kind === "ident" ? identName(f.params[i]!.pattern) : `parameter ${i + 1}`;
  }

  // A holder given a new value lets go of what it held and holds what the value does, which
  // may be read from the holder itself, so the new holds are gathered first.
  function rehold(local: Local, e: Expr) {
    if (!state) return;
    const gathering = arenas.addLocal({ ...local, id: -local.id - 1 });
    hold(gathering, e);
    release(local);
    for (const [at, loan] of state.loans) {
      if (!loan.holders.has(gathering.localId)) continue;
      const holders = new Set([...loan.holders].filter((h) => h !== gathering.localId));
      // Nothing holds a loan of itself.
      if (loan.place.split(".")[0] === String(local.id) && holders.size === 0) state.loans.delete(at);
      else state.loans.set(at, { ...loan, holders: new Set([...holders, local.localId]) });
    }
  }

  // A reference pointed elsewhere, or declared again, lets go of what it held.
  function release(holder: Local) {
    if (!state) return;
    for (const [at, loan] of state.loans) {
      if (!loan.holders.has(holder.localId)) continue;
      const holders = new Set([...loan.holders].filter((h) => h !== holder.localId));
      if (holders.size === 0 && !loan.call) state.loans.delete(at);
      else state.loans.set(at, { ...loan, holders });
    }
  }

  // A loan lasts while one of its holders may still be used, or for its call.
  function live(loan: Loan, at: usize): boolean {
    if (loan.guard) return guarding.has(loan.start);
    return loan.call !== undefined || [...loan.holders].some((h) => (last.get(h) ?? -1) > (at as f64));
  }

  // Changing a place needs it free of loans; a setter changes the object it is called on.
  function change(target: Expr, at: usize = target.start) {
    const changed = setters.has(target) && target.kind === "member" ? target.object : target;
    const place = key(changed);
    if (place !== undefined) free(place, changed, "change", at);
  }

  // Assigning a place gives it a value again, along with everything inside it, but nothing
  // can be assigned inside a value that has moved, nor while it is lent.
  /** @throws {CompileError} */
  function assign(target: Expr, at: usize) {
    const place = key(target);
    if (place === undefined || setters.has(target)) {
      if (target.kind === "member") expr(target.object);
      change(target, at);
      return;
    }
    change(target, at);
    if (!state) return;
    for (const [moved, move] of state.moves) {
      if (place.startsWith(`${moved}.`)) {
        if (move.unassigned) throw new CompileError("E0205", `'${pathOf(moved)}' is used before being assigned, so '${text(target)}' can't be set; assign all of '${pathOf(moved)}' first`, target.start, target.end, { message: move.note, start: move.start, end: move.end });
        throw new CompileError("E0201", `can't assign to '${text(target)}' because '${pathOf(moved)}' was moved`, target.start, target.end, { message: move.note, start: move.start, end: move.end });
      }
    }
    revive(place);
  }

  // An error raised here goes to the innermost catch, which runs from this state too, and any
  // `finally` it leaves through.
  function raising() {
    for (let i = frames.length - 1; i >= 0; i--) {
      const frame = frames[i]!;
      if (frame.kind === "catch") return void (frame.acc = join(frame.acc, state));
      return note(frame, { kind: "raise", acc: null });
    }
  }

  // A `break` or `continue` reaches its target, or first the innermost finally between them.
  function jumping(target: Stmt, which: "break" | "continue") {
    for (let i = frames.length - 1; i >= 0; i--) {
      const frame = frames[i]!;
      if (frame.kind === "catch") continue;
      if (target.start >= frame.at.start && target.end <= frame.at.end) break;
      return note(frame, { kind: "jump", target, which, acc: null });
    }
    const table = which === "break" ? exits : nexts;
    table.set(target, join(table.get(target) ?? null, state));
  }

  // A `return` passes first through the innermost finally, if any.
  function returning() {
    const frame = frames.findLast((f) => f.kind === "finally");
    if (frame && frame.kind === "finally") note(frame, { kind: "return", acc: null });
  }

  // Records a way out through a finally, joining this state into the times it was taken.
  function note(frame: Extract<Frame, { kind: "finally" }>, exit: Exit) {
    const same = (e: Exit) => e.kind === exit.kind && (e.kind !== "jump" || (exit.kind === "jump" && e.target === exit.target && e.which === exit.which));
    const found = frame.exits.find(same);
    if (found) found.acc = join(found.acc, state);
    else frame.exits.push({ ...exit, acc: join(null, state) });
  }

  function revive(place: string) {
    if (!state) return;
    for (const moved of [...state.moves.keys()]) if (moved === place || moved.startsWith(`${place}.`)) state.moves.delete(moved);
  }

  // The place an expression names: a variable or `this`, then fields, but not through a getter.
  function key(e: Named): string | undefined {
    // `x!` is what `x` holds, so it is borrowed and changed as `x` is, as is `x as T`.
    const inner = operandOf(e);
    if (inner !== undefined) return key(inner);
    if (e.kind === "shorthand" || e.kind === "ident") {
      const local = localRecord(arenas, localAt(e));
      return local && String(local.id);
    }
    if (e.kind === "this" || e.kind === "super") return "this";
    // Every element of an array is one place inside it: borrowing any borrows the array.
    if (e.kind === "index") {
      const object = e.kind === "index" && element(e) ? key(e.object) : undefined;
      return object === undefined ? undefined : `${object}.[]`;
    }
    if (e.kind !== "member" || calls.has(e) || instance.copiesOut.has(e) || computed.has(e) || !types.has(e.object)) return undefined;
    const object = key(e.object);
    return object === undefined ? undefined : `${object}.${e.name}`;
  }

  // Whether a closure holding a copy of this variable holds a mutable reference it lends again.
  function reborrows(from: Local): boolean {
    return typing.isCopy(from.type) && typing.holdsMut(from.type);
  }

  // What `x!` or `x ?? d` gives, handed over, can't come out of an Option that `x` only borrows.
  /** @throws {CompileError} */
  function outOfBorrow(option: Expr, e: Expr, consume?: Consumer) {
    const t = types.get(option);
    if (consume && state && t && isRef(t) && !typing.isCopy(types.get(e)!)) {
      throw new CompileError("E0202", hinted(types.get(e)!, "can't move a value out of a reference to it, which only borrows it; use '.clone()' to hand over a copy"), e.start, e.end);
    }
  }

  // A closure made here: what it borrows must be free to lend, and what it moves in leaves.
  /** @throws {CompileError} */
  function made(e: Expr) {
    const parts = captured(e);
    // A copy the closure holds of a variable that a nested function it calls changes wouldn't
    // see the change, as JavaScript's closure would.
    const stale = parts.find(([place, , from, , held]) => held && typing.isCopy(from!.type) && parts.some(([q, , , m, h]) => q === place && m && !h));
    if (stale) {
      const [, use, from] = stale;
      throw new CompileError("E0210", `this closure holds its own copy of '${from!.name}', which a nested function it calls changes, so it wouldn't see the change; pass '${from!.name}' as a parameter instead`, use.start, use.end);
    }
    for (const [place, use, from, mutable, held] of parts) {
      usable(use, place);
      if (!held || typing.isCopy(from!.type)) free(place, use, mutable || (held && reborrows(from!)) ? "lend mutably" : "read");
      else {
        free(place, use, "move");
        state?.moves.set(place, { start: use.start, end: use.end, note: `'${from!.name}' moved here into a closure, which holds it now`, passes: new NodeMap([...passes]) });
        // A closure moving one of this closure's captures into itself moves it out of this one.
        if (instance.captures?.has(from!.localId)) instance.moved!.add(from!.localId);
      }
    }
  }

  // The places a closure captures, where it first uses each, the variable, if not `this`,
  // whether it changes it, and whether it holds it rather than borrowing it.
  function captured(e: Expr): [string, Named, Local | undefined, boolean, boolean][] {
    // A nested function's declaration makes nothing; each use as a value makes its closure, from
    // this body's bindings for what it uses.
    const built = e.kind === "ident" ? instance.envs?.get(e) : undefined;
    if (built) {
      const of = arenas.instanceOf(built.of);
      const aliases = [...of.captures!.keys()];
      return built.env.map((id, i) => {
        const l = arenas.localOf(id);
        return [String(l.id), { id: nextId(ids), kind: "ident", name: l.name, start: e.start, end: e.end } as Named, l, of.changed!.has(aliases[i]!), false];
      });
    }
    if (e.kind !== "arrow" || (nestedFunctions.has(e) && !e.async)) return [];
    const inner = arenas.instanceOf(calls.get(e)!);
    // A closure owning what it captures holds the nested functions it uses as made here, so it
    // borrows what they use.
    const through = (instance.made?.get(e) ?? []).flatMap(({ of: id, env }) => {
      const of = arenas.instanceOf(id);
      const aliases = [...of.captures!.keys()];
      return env.map((id, i): [string, Named, Local | undefined, boolean, boolean] => {
        const l = arenas.localOf(id);
        return [String(l.id), { id: nextId(ids), kind: "ident", name: l.name, start: e.start, end: e.end } as Named, l, of.changed!.has(aliases[i]!), false];
      });
    });
    return [...[...inner.captures!].flatMap(([alias, from], i): [string, Named, Local | undefined, boolean, boolean][] => {
      const use = inner.captureUses!.get(alias) as Named | undefined;
      const mutable = inner.changed!.has(alias);
      const held = !isRef(typing.rec(inner.closure!).fields[i]!.type);
      if (!use) return [];
      return [from === "this" ? ["this", use, undefined, mutable, false] : [String(arenas.localOf(from).id), use, arenas.localOf(from), mutable, held]];
    }), ...through];
  }

  // `a ?? b` holding a reference gives the one either side holds.
  function choosing(e: Ref<Named>): boolean {
    return e.kind === "binary" && e.op === "??" && typing.holdsRef(types.get(e)!);
  }

  function rootOf(e: Named): Named {
    const inner = operandOf(e);
    if (inner !== undefined) return rootOf(inner);
    return e.kind === "member" || e.kind === "index" ? rootOf(e.object) : e;
  }

  // Whether an expression is a reference a call gave, or a choice between such references.
  function fromCall(e: Expr): boolean {
    e = unwrapped(e);
    if (e.kind === "conditional") return (types.has(e.then) && fromCall(projected(e.then))) || (types.has(e.else) && fromCall(projected(e.else)));
    if (e.kind === "binary" && choosing(e)) return fromCall(projected(e.left)) || fromCall(projected(e.right));
    return borrowsFrom.has(e);
  }

  // What a chain of field reads, indexes and `!` starts from.
  function projected(e: Expr): Expr {
    for (e = unwrapped(e); ; ) {
      if ((e.kind === "member" && !calls.has(e)) || e.kind === "index") e = unwrapped(e.object);
      else if (e.kind === "nonNull" || e.kind === "as") e = unwrapped(e.expr);
      else return e;
    }
  }

  // `x!` of a reference or nothing borrows what `x` does, so it is followed as `x`, as are
  // `as`, `satisfies` and `unsafe { }`, which hand on their operand.
  // The coercion a value meets, which the checker records on the outermost of its wrappers, so
  // it is read before `unwrapped` takes them off.
  function coercionOf(e: Expr): Type | undefined {
    for (; ; e = (e as { expr: Expr }).expr) {
      const c = coercions.get(e);
      if (c !== undefined || unwrapped(e) === e) return c;
    }
  }

  function unwrapped(e: Expr): Expr {
    return (e.kind === "nonNull" && typing.optionRef(types.get(e.expr))) || (e.kind === "as" && narrowsUnion(e) && typing.holdsRef(types.get(e)!)) || transparent(e) ? unwrapped((e as { expr: Expr }).expr) : e;
  }

  function narrowsUnion(e: Named): boolean {
    if (e.kind !== "as") return false;
    const [from, to] = [coercions.get(e.expr) ?? types.get(e.expr), types.get(e)];
    return from !== undefined && to !== undefined && isUnion(typing.lower(from)) && typing.lower(from) !== typing.lower(to) && !typing.fits(typing.lower(from), typing.lower(to));
  }

  function transparent(e: Ref<Named>): boolean {
    return (e.kind === "as" && !narrowsUnion(e)) || e.kind === "satisfies" || e.kind === "unsafe";
  }

  // Forms that read the place their operand names: `x!`, whatever the Option holds, and the
  // transparent ones. `unwrapped` follows fewer, since it reads a value's own type and coercion.
  function projection(e: Ref<Named>): boolean {
    return e.kind === "nonNull" || e.kind === "as" || transparent(e);
  }

  // What a projection reads the place of: its operand.
  function operandOf(e: Ref<Named>): Ref<Expr> | undefined {
    if (!projection(e)) return undefined;
    if (e.kind === "nonNull") return e.expr;
    if (e.kind === "as" || e.kind === "satisfies") return e.expr;
    if (e.kind === "unsafe") return e.expr;
    return undefined;
  }

  function through(e: Ref<Expr>): Ref<Expr> {
    let at = e;
    for (let inner = operandOf(at); inner !== undefined; inner = operandOf(at)) at = inner;
    return at;
  }

  // The indexes into arrays along a place's path, outermost first.
  function indexes(e: Expr): Expr[] {
    const found: Expr[] = [];
    for (e = bare(e); e.kind === "member" || e.kind === "index"; e = bare(e.object)) if (e.kind === "index" && element(e)) found.unshift(e.index);
    return found;
  }

  // Whether an expression is an index into an array.
  function element(e: Ref<Named>): boolean {
    return e.kind === "index" && array(e.object);
  }

  // Whether an expression's value is an array, or a reference to one.
  // A generator's variables live in the generator itself, which may move between `next()`
  // calls, so no reference into one may still be in use at a `yield`. What a reference
  // parameter points to, and an array's elements, live elsewhere.
  /** @throws {CompileError} */
  function stillBorrowed(e: Expr) {
    if (!state) return;
    for (const loan of state.loans.values()) {
      if (loan.loop || loan.guard || !live(loan, e.end)) continue;
      const [root, ...path] = loan.place.split(".");
      const local = byId.get(Number(root));
      if (!local || isRef(local.type) || path.includes("[]")) continue;
      throw new CompileError("E0203", `a reference into '${pathOf(loan.place)}' is still in use at this 'yield'; a generator's variables move with it between 'next()' calls, so let the reference end before the yield`, e.start, e.end, {
        message: `'${pathOf(loan.place)}' is borrowed here`, start: loan.start, end: loan.end,
      });
    }
  }

  function generator(e: Expr): boolean {
    const t = types.get(e);
    const held = t && deref(t);
    return held !== undefined && (typing.yieldsOf(held) !== undefined || typing.yieldsOf(held, true) !== undefined);
  }

  function locking(e: Expr): boolean {
    const t = types.get(e);
    const r = t && record(deref(t));
    return r?.kind === "shared" || (r?.kind === "interior" && (r.which === "Lock" || r.which === "RwLock"));
  }

  function mapped(e: Expr): boolean {
    const t = types.get(e);
    return t !== undefined && record(deref(t))?.kind === "map";
  }

  function array(e: Expr): boolean {
    const t = types.get(e);
    const kind = t && record(deref(t))?.kind;
    return kind === "array" || kind === "fixed";
  }

  // Moving a value out of an array by index would leave a hole in it, as in Rust.
  function elementMove(e: Named, type: Type): CompileError {
    const advice = typing.holdsHandle(type, true) ? "" : `'${text(e)}.clone()' to take a copy, or `;
    const t = types.get((e as Extract<Expr, { kind: "index" }>).object);
    const inline = t !== undefined && record(deref(t))?.kind === "fixed";
    if (inline) return new CompileError("E0202", `'${text(e)}' can't be moved out of its fixed array, which keeps every element${advice ? `; use ${advice.slice(0, -5)}` : ""}`, e.start, e.end);
    return new CompileError("E0202", `'${text(e)}' can't be moved out of its array; use ${advice}'pop()' to take the last element out`, e.start, e.end);
  }

  // How a place reads in a message.
  function text(e: Ref<Named>): string {
    // A tuple's element reads as it is written, `t[0]`.
    if (e.kind !== "shorthand") {
      const base = restBase(restStarts, e);
      if (base !== undefined) return `${text(base)}${restSuffix(restStarts, e)}`;
    }
    if (e.kind === "member" && e.name === EMBEDDED) return text(e.object);
    if (e.kind === "member") return /^\d+$/.test(e.name) ? `${text(e.object)}[${e.name}]` : `${text(e.object)}.${e.name}`;
    if (e.kind === "index") return `${text(e.object)}[${indexText(e.index)}]`;
    if (e.kind === "nonNull") return `${text(e.expr)}!`;
    return e.kind === "ident" || e.kind === "shorthand" ? e.name : e.kind === "this" || e.kind === "super" ? "this" : "(...)";
  }

  // A place's path as written, from the variable's name.
  function pathOf(place: string): string {
    // The rest field's name is dots too, so it is split out before the path is.
    const [id, ...fields] = place.replaceAll("....", ".\0").split(".").map((f) => (f === "\0" ? "..." : f));
    const local = [...locals.values()].map((l) => arenas.localOf(l)).find((l) => String(l.id) === id);
    // A rest tuple's array is its elements from where its fixed ones end, as `t[1...]`.
    const held = record(local && typing.lower(local.type));
    const start = held?.kind === "object" && held.rest !== undefined ? held.fields.length - 1 : undefined;
    // The collection a class extending Map or Set embeds reads as the object itself.
    const named = fields.filter((f) => f !== EMBEDDED).map((f, i) => (f === "..." ? (i === 0 && start !== undefined ? `[${start}...]` : "[...]") : f === "[]" ? "[...]" : f));
    return [local?.name ?? id, ...named].join(".").replaceAll(".[", "[").replace(/\.(\d+)(?=\.|\[|$)/g, "[$1]");
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
  let passes = new NodeMap<Stmt, usize>();
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
