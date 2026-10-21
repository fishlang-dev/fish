import type { Instance, Local, Origin } from "./check.ts";
import type { Body } from "./classes.ts";
import { CompileError } from "./diag.ts";
import type { Expr, ObjectProp, Stmt } from "./parser.ts";
import { isPrint } from "./values.ts";
import { field, holdsRef, isCopy, lower, type RefType, type Type, type UnionType } from "./typing.ts";

// Moves and borrows: a value that isn't Copy has one owner, so passing, assigning, storing or
// returning it hands it over, and the place it came from can't be used until it is assigned
// again. A place lent to a reference can't change or move while the reference may still be
// used, and one lent mutably can't be used at all. This walks a checked body in evaluation
// order, tracking which places have moved and which are lent.

// Where a place moved, the note explaining it, and the pass of each loop it moved on. A place
// is a local's id, or `this`, followed by a field path, like `3.inner.x`.
type Move = { start: number; end: number; note: string; passes: Map<Stmt, number> };

// A place lent to references: shared or mutable, where it was lent, and who holds it, the
// reference variables or, for an argument or receiver, the call it was lent to.
type Loan = { place: string; mutable: boolean; start: number; end: number; holders: Set<Local>; call?: string; callAt?: Expr };

// The places moved, and the loans made, on the way here, or null where control can't reach.
// Loans are keyed by where they were made.
type State = { moves: Map<string, Move>; loans: Map<number, Loan> } | null;

// How a consuming use hands a value over, as the note says it, given how the place reads.
type Consumer = (place: string) => string;

// What names a place: a variable, `this`, a field, or a shorthand property naming a variable.
type Named = Expr | Extract<ObjectProp, { kind: "shorthand" }>;

// What an access does to a place.
type Access = "read" | "change" | "move" | "lend" | "lend mutably";

const isRef = (t: Type): t is RefType => typeof t !== "string" && t.kind === "ref";

const isUnion = (t: Type): t is UnionType => typeof t !== "string" && t.kind === "union";

// The place a temporary or a copy stands for: a reference into one can't be returned.
const TEMPORARY = "temporary";


export function checkMoves(f: Body, instance: Instance, origins: Origin[]) {
  const { types, locals, calls, setters, jumps, coercions, borrowsFrom } = instance;
  const body = f.body;
  let state: State = { moves: new Map(), loans: new Map() };
  // The states `break` leaves to each statement, and `continue` takes back to each loop.
  const exits = new Map<Stmt, State>();
  const nexts = new Map<Stmt, State>();
  // The pass each enclosing loop is on.
  const passes = new Map<Stmt, number>();
  const last = lastUses(body, instance);
  // What `this` keeps stays held to the end of the body, and after it.
  const kept: Local = { name: "this", type: "void", mutable: false, param: false, id: -1 };
  last.set(kept, Infinity);
  // A reference parameter holds a borrow its caller made, of something outside this function.
  f.params.forEach((p, i) => {
    const local = locals.get(p);
    if (local && holdsRef(local.type)) state!.loans.set(-1 - i, { place: `param ${i}`, mutable: isRef(local.type) && local.type.mutable, start: p.start, end: p.end, holders: new Set([local]) });
  });
  statements(body);

  // The reference variables declared anywhere inside a statement.
  function inside(s: Stmt): Local[] {
    switch (s.kind) {
      case "let":
        return holdsRef(locals.get(s)!.type) ? [locals.get(s)!] : [];
      case "if":
        return [...s.then, ...(s.else ?? [])].flatMap(inside);
      case "block":
      case "while":
      case "doWhile":
        return s.body.flatMap(inside);
      case "for":
        return [...(s.init ? [s.init] : []), ...s.body].flatMap(inside);
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
    for (const s of list) if (s.kind === "let" && holdsRef(locals.get(s)!.type)) release(locals.get(s)!);
  }

  function statement(s: Stmt) {
    switch (s.kind) {
      case "expr":
        return expr(s.expr, undefined, true);
      case "let": {
        const d = s.declarations[0]!;
        const name = d.target.kind === "ident" ? d.target.name : "";
        const local = locals.get(s)!;
        // A declaration run again by a loop makes a fresh variable, which holds nothing yet.
        release(local);
        expr(d.init!, (p) => `'${p}' moved here: '${name}' owns it now; use '${p}.clone()' to keep a copy`);
        revive(String(local.id));
        if (holdsRef(local.type)) rehold(local, d.init!);
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
        return statements(s.body);
      case "while":
        return loop(s, () => s.cond, () => statements(s.body));
      case "doWhile":
        return loop(s, () => s.cond, () => statements(s.body), true);
      case "for":
        if (s.init) statement(s.init);
        return loop(s, () => s.test, () => statements(s.body), false, () => s.update && expr(s.update, undefined, true));
      case "labeled": {
        exits.set(s, null);
        statement(s.body);
        state = join(state, exits.get(s)!);
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
        return;
      }
      case "break":
      case "continue": {
        const target = jumps.get(s)!;
        const table = s.kind === "break" ? exits : nexts;
        table.set(target, join(table.get(target) ?? null, state));
        state = null;
        return;
      }
      case "return":
        if (s.value) {
          expr(s.value, () => "");
          // An arrow's expression body may be a call returning nothing.
          if (types.has(s.value)) returned(s.value);
        }
        state = null;
        return;
    }
  }

  // A loop runs its body until nothing new has moved or been lent by the time it comes round
  // again, so a move late in the body is caught at a use early in it.
  function loop(s: Stmt, test: () => Expr | undefined, body: () => void, bodyFirst = false, update?: () => void) {
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
      // References declared in the body are gone by the time the loop comes round or ends,
      // however it left the body; a `for` loop's initializer outlives every pass.
      for (const local of s.kind === "for" ? s.body.flatMap(inside) : inside(s)) release(local);
      if (bodyFirst) cond();
      else update?.();
      leaving = join(leaving, exits.get(s)!);
      const after = state;
      state = leaving;
      for (const local of inside(s)) release(local);
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
  function expr(e: Expr, consume?: Consumer, discarded = false) {
    // A value lent to a reference stays where it is.
    const lent = coercions.get(e);
    if (lent && isRef(lent) && !isRef(types.get(e)!)) consume = undefined;
    switch (e.kind) {
      case "int":
      case "bool":
      case "string":
        return;
      case "ident":
        return locals.has(e) ? use(e, consume) : undefined;
      case "super":
      case "this":
        free("this", e, "read");
        if (f.self?.owned) return use(e, consume);
        if (consume && state && !isCopy(types.get(e)!)) {
          throw new CompileError("'this' can't be moved, since it is only borrowed here; use 'this.clone()' to hand over a copy", e.start, e.end);
        }
        return;
      case "member":
        if (!types.has(e.object)) return;
        if (key(e) !== undefined) return use(e, consume);
        return expr(e.object);
      case "arrow":
        for (const [place, use] of captured(e)) {
          usable(use, place);
          free(place, use, "read");
        }
        return;
      case "object":
        for (const p of e.props) {
          const into = (place: string) => `'${place}' moved here into the new object; use '${place}.clone()' to keep a copy`;
          if (p.kind === "property") expr(p.value, into);
          // A shorthand holds its variable as narrowed there.
          else if (p.kind === "shorthand") use(p, into, field(types.get(e) as Exclude<Type, string>, p.name)!.type);
        }
        return;
      case "new": {
        const name = e.callee.kind === "ident" ? `'new ${e.callee.name}'` : "the constructor";
        return during(e, () => handOver(e.args ?? [], name, e));
      }
      case "call": {
        if (isPrint(e.callee)) {
          for (const a of e.args) expr(a);
          return;
        }
        const name = e.callee.kind === "member" || e.callee.kind === "ident" ? `'${e.callee.name}'` : "'super'";
        // What the call may keep is held once its own loans have ended.
        let keeps: (() => void) | undefined;
        during(e, () => {
          // A closure is read to call it.
          if (e.callee.kind === "ident" && locals.has(e.callee)) expr(e.callee);
          // A method's receiver is lent to it for the call, mutably when the method changes it.
          // A mutable receiver is lent shared while the arguments run, so they may read it, and
          // mutably for the call itself.
          const object = e.callee.kind === "member" ? e.callee.object : undefined;
          const place = object && key(object);
          const self = calls.get(e)?.body.self;
          // An owning method takes its receiver over, as an argument it is handed.
          if (object && self?.owned) {
            expr(object, (p) => `'${p}' moved here: ${name} takes its object over; call it on '${p}.clone()' to keep a copy`);
            handOver(e.args, name, e);
            return;
          }
          if (object) expr(object);
          if (object && place !== undefined && self) lend(place, false, object, undefined, name, e);
          handOver(e.args, name, e);
          if (object && place !== undefined && self?.mutable && state) {
            state.loans.delete(object.start);
            lend(place, true, object, undefined, name, e, e.end - 1);
          }
          // A method that changes its object, or a base's constructor, may keep what is lent.
          const keeper = object ?? (e.callee.kind === "super" ? e.callee : undefined);
          if (keeper && (self?.mutable || e.callee.kind === "super")) keeps = () => keep(keeper, e.args.filter((a) => holdsRef(coercions.get(a) ?? types.get(a)!)));
        });
        keeps?.();
        return;
      }
      case "unary":
        return expr(e.operand);
      case "update":
        expr(e.operand);
        return change(e.operand);
      case "assign": {
        // A whole value written through a mutable reference changes everything it points to,
        // and can't keep references there, nor be handed on as well.
        if (isRef(types.get(e.target)!) && coercions.has(e.target)) {
          expr(e.target);
          expr(e.value, (p) => `'${p}' moved here into what '${text(e.target)}' points to; use '${p}.clone()' to keep a copy`);
          change(e.target, e.end);
          if (holdsRef(coercions.get(e.value) ?? types.get(e.value)!)) keep(e.target, [e.value]);
          if (consume && !isCopy(types.get(e)!)) {
            throw new CompileError(`this assignment's value can't be used: it was moved into what '${text(e.target)}' points to, which only borrows it`, e.start, e.end);
          }
          return;
        }
        if (e.op !== "=") expr(e.target);
        expr(e.value, (p) => `'${p}' moved here into '${text(e.target)}'; use '${p}.clone()' to keep a copy`);
        // The target changes once the value is ready, after the value's reads.
        assign(e.target, e.end);
        const local = e.target.kind === "ident" ? locals.get(e.target) : undefined;
        // Pointing a reference elsewhere lets go of what it held; a value holding references
        // given another one to hold adds it.
        if (local && holdsRef(local.type)) rehold(local, e.value);
        // A value given a reference to keep, through a field or a setter, holds it; `this` may
        // only be given what outlives the call.
        if (e.target.kind === "member" && holdsRef(coercions.get(e.value) ?? types.get(e.value)!)) keep(e.target.object, [e.value]);
        // An assignment used as a value hands over what it just stored. A setter keeps what it
        // was given, with nothing left to read or hand on.
        if (!discarded && state && !isCopy(types.get(e)!) && setters.has(e.target)) {
          throw new CompileError(`'${text(e.target)}' is a setter, which keeps the value assigned to it, so this assignment can't also be used as a value; assign a clone`, e.start, e.end);
        }
        if (consume && !isCopy(types.get(e)!) && key(e.target) !== undefined) use(e.target, consume);
        return;
      }
      case "conditional": {
        expr(e.cond);
        const before = join(state, null);
        expr(e.then, consume, discarded);
        const then = state;
        state = before;
        expr(e.else, consume, discarded);
        state = join(then, state);
        return;
      }
      case "binary": {
        expr(e.left);
        // The right side of `&&` and `||` may not run.
        const before = join(state, null);
        expr(e.right);
        if (e.op === "&&" || e.op === "||") state = join(before, state);
        return;
      }
    }
  }

  // A value that may keep references given to it holds them: a holder variable, or `this`, which
  // may be given only what points into this function's parameters, since it outlives the call.
  function keep(target: Expr, values: Expr[]) {
    if (values.length === 0) return;
    // Keeping references in what a reference points to would need its owner to hold them.
    for (let p: Expr = target; ; p = (p as Extract<Expr, { kind: "member" }>).object) {
      const t = types.get(p);
      if (t && isRef(t)) {
        throw new CompileError(`keeping references through the reference '${text(p)}' is not supported yet; do it on what '${text(p)}' points to, directly`, target.start, target.end);
      }
      if (p.kind !== "member") break;
    }
    const root = rootOf(target);
    if (root.kind === "this" || root.kind === "super") {
      for (const v of values) {
        stored(v);
        if (f.self && holdsRef(f.self.type)) hold(kept, v);
      }
      return;
    }
    const owner = locals.get(root as never);
    if (owner && holdsRef(owner.type) && !isRef(owner.type)) for (const v of values) hold(owner, v);
  }

  // Arguments are handed over, or lent for the call, in order.
  function handOver(args: Expr[], name: string, call: Expr) {
    for (const a of args) {
      expr(a, (p) => `'${p}' moved here: passing it to ${name} hands it over, as if ${name} kept it; pass '${p}.clone()' to keep a copy`);
      for (const [place, part, mutable] of lent(a)) lend(place, mutable, part, undefined, name, call);
    }
  }

  // The places an expression lends a reference to, and how: a place borrowed, a reference
  // passed on, which lends what it points to again, or either side of a `?:`.
  function lent(e: Expr): [string, Expr, boolean][] {
    if (e.kind === "conditional") return [...lent(e.then), ...lent(e.else)];
    // A call's returned reference lends again what it borrows from, a receiver included.
    const from = borrowsFrom.get(e);
    if (from) return from.flatMap((s) => source(s, (coercions.get(e) ?? types.get(e)!) as RefType));
    const type = types.get(e)!;
    const to = coercions.get(e) ?? type;
    const place = key(e);
    // A shared reference passed on is just another pointer, which needs nothing lent; a
    // mutable one lends itself, shared or mutably as it is passed on.
    if (place === undefined || !isRef(to) || (isRef(type) && !type.mutable)) return [];
    return [[place, e, to.mutable]];
  }

  // What a call's result borrows from one of its sources: what the source lends, or, for a
  // receiver that is a place, the place itself.
  function source(s: Expr, result: RefType): [string, Expr, boolean][] {
    const parts = lent(s);
    const place = key(s);
    if (parts.length > 0 || place === undefined || isRef(types.get(s)!)) return parts;
    return [[place, s, result.mutable]];
  }

  // Runs a call's arguments, then ends the loans made for it.
  function during(call: Expr, run: () => void) {
    run();
    if (!state) return;
    for (const [at, loan] of state.loans) if (loan.call && loan.callAt === call && loan.holders.size === 0) state.loans.delete(at);
  }

  // Reads or hands over a place, which must still hold its value and not be lent so as to
  // forbid it.
  function use(e: Named, consume?: Consumer, type = e.kind === "shorthand" ? locals.get(e)!.type : types.get(e)!) {
    const place = key(e)!;
    usable(e, place);
    const moving = consume !== undefined && !isCopy(type);
    free(place, e, moving ? "move" : "read");
    if (!moving || !state) return;
    const root = locals.get(rootOf(e) as never);
    if (root && instance.captures?.has(root)) {
      throw new CompileError(`'${text(e)}' can't be moved here: this closure only borrows ${e.kind === "member" ? `'${root.name}'` : "it"}; use '${text(e)}.clone()'`, e.start, e.end);
    }
    if (root && isRef(root.type)) {
      throw new CompileError(`'${text(e)}' can't be moved out of '${root.name}', which only borrows it; use '${text(e)}.clone()'`, e.start, e.end);
    }
    // Nor out of a reference a field holds.
    for (let p: Named = e; p.kind === "member"; p = p.object) {
      if (p !== e && isRef(types.get(p)!)) {
        throw new CompileError(`'${text(e)}' can't be moved out of '${text(p)}', which only borrows it; use '${text(e)}.clone()'`, e.start, e.end);
      }
    }
    if (place.startsWith("this") && !f.self?.owned) {
      throw new CompileError(`'${text(e)}' can't be moved out of 'this', since it is only borrowed here; use '${text(e)}.clone()'`, e.start, e.end);
    }
    state.moves.set(place, { start: e.start, end: e.end, note: consume!(text(e)), passes: new Map(passes) });
  }

  // A place can't be used once it, something it is inside, or something inside it moved.
  function usable(e: Named, place: string) {
    if (!state) return;
    for (const [moved, move] of state.moves) {
      if (!overlaps(moved, place)) continue;
      const name = text(e);
      const what = moved === place ? `'${name}' was moved, so it can't be used here`
        : place.startsWith(`${moved}.`) ? `'${name}' can't be used here because '${pathOf(moved)}' was moved`
        : `'${name}' can't be used as a whole here because '${pathOf(moved)}' was moved out of it`;
      const earlier = [...passes].some(([loop, pass]) => (move.passes.get(loop) ?? pass) < pass) ? " (in an earlier pass through this loop)" : "";
      throw new CompileError(what + earlier, e.start, e.end, { message: move.note, start: move.start, end: move.end });
    }
  }

  // A place can't be accessed in a way a live loan of it, of something inside it or of
  // something it is inside forbids: a mutable loan forbids everything, a shared one changes,
  // moves and mutable loans.
  function free(place: string, e: Named, access: Access, at = e.start) {
    if (!state) return;
    for (const loan of state.loans.values()) {
      if (!overlaps(loan.place, place) || !live(loan, at)) continue;
      if (!loan.mutable && (access === "read" || access === "lend")) continue;
      const lent = pathOf(loan.place);
      const verb = { read: "use", change: "change", move: "move", lend: "lend", "lend mutably": "mutably lend" }[access];
      const holders = [...loan.holders].filter((h) => (last.get(h) ?? -1) > at);
      const holder = loan.call
        ? `'${lent}' is lent ${loan.mutable ? "mutably " : ""}to ${loan.call} for this call`
        : `${holders.map((h) => `'${h.name}'`).join(" and ")} ${holders.length > 1 ? "borrow" : "borrows"} '${lent}'${loan.mutable ? " mutably" : ""} and ${holders.length > 1 ? "are" : "is"} used later`;
      const until = loan.call ? "the call returns" : "the borrow's last use";
      const earlier = loan.start >= e.start && [...passes.values()].some((p) => p > 0) ? " on an earlier pass through this loop" : "";
      throw new CompileError(`cannot ${verb} '${text(e)}' while ${holder}`, e.start, e.end, {
        message: `'${lent}' is lent ${loan.mutable ? "mutably " : ""}here${earlier}, so it can't ${loan.mutable ? "be used" : "change or move"} until ${until}`,
        start: loan.start, end: loan.end,
      });
    }
  }

  // Lends a place, which must be free to lend so, to a reference variable or for a call.
  function lend(place: string, mutable: boolean, e: Named, holder?: Local, call?: string, callAt?: Expr, at = e.start) {
    free(place, e, mutable ? "lend mutably" : "lend", at);
    if (!state) return;
    state.loans.set(e.start, { place, mutable, start: e.start, end: e.end, holders: new Set(holder ? [holder] : []), call, callAt });
  }

  // A reference variable given a value holds what it borrows: a place lent to it, or what
  // the reference it copies, or the reference it borrows through, holds.
  function hold(holder: Local, e: Expr) {
    if (!state) return;
    if (e.kind === "conditional") {
      hold(holder, e.then);
      hold(holder, e.else);
      return;
    }
    // A call's returned reference holds what its sources do: a receiver where it lives.
    const from = borrowsFrom.get(e);
    if (from) {
      const result = (coercions.get(e) ?? types.get(e)!) as RefType;
      for (const s of from) {
        if (holdsRef(coercions.get(s) ?? types.get(s)!) && (isRef(coercions.get(s) ?? types.get(s)!) || key(s) === undefined)) hold(holder, s);
        else if (key(s) !== undefined) {
          lend(key(s)!, result.mutable, s, holder);
          inherit(holder, s);
          if (throughUnion(s)) temporary(holder, s);
        } else temporary(holder, s);
      }
      return;
    }
    const type = types.get(e)!;
    const to = coercions.get(e) ?? type;
    // A closure holds what it captures.
    if (e.kind === "arrow") {
      for (const [place, use, from] of captured(e)) {
        lend(place, false, use, holder);
        if (from && holdsRef(from.type)) inheritFrom(holder, from);
      }
      return;
    }
    if (!isRef(to)) {
      // A value holding references holds what its parts do, or what the value it copies does.
      if (!holdsRef(to)) return;
      if (e.kind === "object") {
        for (const p of e.props) {
          if (p.kind === "property") hold(holder, p.value);
          else if (p.kind === "shorthand" && locals.get(p)) {
            const local = locals.get(p)!;
            // A shorthand lent to a reference field lends its variable.
            if (isRef(field(to as Exclude<Type, string>, p.name)!.type) && !isRef(local.type)) lend(String(local.id), false, p, holder);
            else if (holdsRef(local.type)) inheritFrom(holder, local);
          }
        }
      } else inherit(holder, e);
      return;
    }
    // A place borrowed, or a reference copied, is lent to the holder: a mutable reference
    // copied lends itself mutably, so only one of them is used at a time. A copy keeps its
    // source borrowed too, so it can't be told apart from the original while held.
    for (const [lentPlace, part, mutable] of lent(e)) lend(lentPlace, mutable, part, holder);
    inherit(holder, e);
    if (!inPlace(e, to)) temporary(holder, e);
  }

  // Through a reference, or a value holding references, what it holds stays held.
  function inherit(holder: Local, e: Expr) {
    const root = locals.get(rootOf(e) as never);
    if (root && holdsRef(root.type)) inheritFrom(holder, root);
  }

  function inheritFrom(holder: Local, root: Local) {
    if (!state || root === holder) return;
    for (const [at, loan] of state.loans) if (loan.holders.has(root)) state.loans.set(at, { ...loan, holders: new Set([...loan.holders, holder]) });
  }

  // A reference to a temporary or a copy holds that, so it is never returned.
  function temporary(holder: Local, e: Expr) {
    // Keyed beside any loan made at the same place, which it must not replace.
    state?.loans.set(e.start + 0.5, { place: TEMPORARY, mutable: false, start: e.start, end: e.end, holders: new Set([holder]) });
  }

  // Whether a reference made from `e` points where `e` lives, rather than at a copy: a place
  // of exactly the type borrowed, reached through real fields of known layout, or a reference
  // to the same type or to one member of a union.
  function inPlace(e: Expr, to: RefType): boolean {
    const type = types.get(e)!;
    const local = e.kind === "ident" ? locals.get(e) : undefined;
    const narrowed = (t: Type) => local !== undefined && local.type !== type && isUnion(t);
    if (isRef(type)) {
      if (narrowed(type.to)) return false;
      const [from, want] = [lower(type.to), lower(to.to)];
      return from === want || (isUnion(from) && from.members.includes(want));
    }
    if (key(e) === undefined || throughUnion(e) || narrowed(type)) return false;
    return lower(type) === lower(to.to);
  }

  // Whether a field path passes through a union, or ends where a type parameter's concrete type
  // stores the field as another type, so the field is read as a copy. At a definition, where
  // nothing is concrete, each instance decides.
  function throughUnion(e: Expr): boolean {
    for (let p: Expr = e; p.kind === "member"; p = p.object) {
      const holder = types.get(p.object);
      const held = holder && isRef(holder) ? holder.to : holder;
      if (typeof held !== "string" && held?.kind === "union") return true;
    }
    const stored = storedType(e);
    return stored !== undefined && lower(stored) !== lower(types.get(e)!);
  }

  // The type a place is stored as, where an instance knows it: a field read through a type
  // parameter has its concrete type's field type, as codegen lays it out.
  function storedType(e: Expr): Type | undefined {
    if (e.kind !== "member") return types.get(e);
    const holder = storedType(e.object);
    const held = holder && isRef(holder) ? holder.to : holder;
    const concrete = held && typeof held !== "string" ? lower(held) : held;
    if (typeof concrete === "string" || !concrete || concrete.kind === "union" || concrete.kind === "param") return types.get(e);
    return field(concrete, e.name)?.type ?? types.get(e);
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
  function outlives(e: Expr, allowed: Origin[], verb: string, instead: string) {
    const type = coercions.get(e) ?? types.get(e)!;
    if (!holdsRef(type)) return;
    for (const place of pointsInto(e)) {
      if (place === TEMPORARY) {
        throw new CompileError(`can't ${verb} a reference to a temporary or a copy, which is gone once the function returns; ${instead}`, e.start, e.end);
      }
      const param = place.startsWith("param ") ? Number(place.slice(6)) : undefined;
      if (param !== undefined ? allowed.includes(param) : place.startsWith("this") && allowed.includes("this")) continue;
      const names = allowed.map((o) => (o === "this" ? "'this'" : `'${paramName(o)}'`)).join(" or ") || "nothing it was given";
      const what = param !== undefined ? `'${paramName(param)}'` : place.startsWith("this") ? `'${pathOf(place)}'` : undefined;
      const message = what
        ? verb === "return" ? `the returned reference points into ${what}, but its lifetime ties it to ${names}; give ${what} that lifetime, or return an owned value` : `the stored reference points into ${what}, but it may only point into ${names}`
        : `can't ${verb} a reference to '${pathOf(place)}', which belongs to this function and is gone once it returns; ${instead}`;
      throw new CompileError(message, e.start, e.end);
    }
  }

  // The places a reference value points into: places it borrows where they live, what the
  // reference variables it reads through hold, what calls' results borrow, or a temporary.
  function pointsInto(e: Expr): string[] {
    if (e.kind === "conditional") return [...pointsInto(e.then), ...pointsInto(e.else)];
    const from = borrowsFrom.get(e);
    if (from) {
      return from.flatMap((s) => {
        const t = coercions.get(s) ?? types.get(s)!;
        if (isRef(t) || (holdsRef(t) && key(s) === undefined)) return pointsInto(s);
        return key(s) !== undefined && !throughUnion(s) ? within(s) : [TEMPORARY];
      });
    }
    const type = types.get(e)!;
    const to = coercions.get(e) ?? type;
    if (!isRef(to)) {
      // A value holding references points wherever its parts, or the value it copies, do.
      if (!holdsRef(to)) return [];
      if (e.kind === "object") {
        return e.props.flatMap((p) => {
          if (p.kind === "property") return pointsInto(p.value);
          if (p.kind !== "shorthand") return [];
          const local = locals.get(p);
          if (!local) return [];
          return isRef(field(to as Exclude<Type, string>, p.name)!.type) && !isRef(local.type) ? [String(local.id)] : heldBy(local);
        });
      }
      const root = locals.get(rootOf(e) as never);
      return root && holdsRef(root.type) ? heldBy(root) : [];
    }
    if (!inPlace(e, to)) return [TEMPORARY];
    return within(e);
  }

  // The places a holder's loans are on, leaving out those inside other holders, whose own
  // loans are held too.
  function heldBy(root: Local): string[] {
    const refs = new Set([...locals.values()].filter((l) => isRef(l.type)).map((l) => String(l.id)));
    return [...(state?.loans.values() ?? [])].filter((l) => l.holders.has(root) && !refs.has(l.place.split(".")[0]!)).map((l) => l.place);
  }

  // Where a place lives: itself, or, reached through a reference variable, what that holds; a
  // reference read out of a value holding references points where that value's loans are.
  function within(e: Expr): string[] {
    const root = locals.get(rootOf(e) as never);
    if (!root || !(isRef(root.type) || (isRef(types.get(e)!) && holdsRef(root.type)))) return [key(e)!];
    return heldBy(root);
  }

  function paramName(i: number): string {
    const p = f.params[i]!.pattern;
    return p.kind === "ident" ? p.name : `parameter ${i + 1}`;
  }

  // A holder given a new value lets go of what it held and holds what the value does, which
  // may be read from the holder itself, so the new holds are gathered first.
  function rehold(local: Local, e: Expr) {
    if (!state) return;
    const gathering: Local = { ...local, id: -local.id - 1 };
    hold(gathering, e);
    release(local);
    for (const [at, loan] of state.loans) {
      if (!loan.holders.has(gathering)) continue;
      const holders = new Set([...loan.holders].filter((h) => h !== gathering));
      // Nothing holds a loan of itself.
      if (loan.place.split(".")[0] === String(local.id) && holders.size === 0) state.loans.delete(at);
      else state.loans.set(at, { ...loan, holders: new Set([...holders, local]) });
    }
  }

  // A reference pointed elsewhere, or declared again, lets go of what it held.
  function release(holder: Local) {
    if (!state) return;
    for (const [at, loan] of state.loans) {
      if (!loan.holders.has(holder)) continue;
      const holders = new Set([...loan.holders].filter((h) => h !== holder));
      if (holders.size === 0 && !loan.call) state.loans.delete(at);
      else state.loans.set(at, { ...loan, holders });
    }
  }

  // A loan lasts while one of its holders may still be used, or for its call.
  function live(loan: Loan, at: number): boolean {
    return loan.call !== undefined || [...loan.holders].some((h) => (last.get(h) ?? -1) > at);
  }

  // Changing a place needs it free of loans; a setter changes the object it is called on.
  function change(target: Expr, at = target.start) {
    const changed = setters.has(target) && target.kind === "member" ? target.object : target;
    const place = key(changed);
    if (place !== undefined) free(place, changed, "change", at);
  }

  // Assigning a place gives it a value again, along with everything inside it, but nothing
  // can be assigned inside a value that has moved, nor while it is lent.
  function assign(target: Expr, at: number) {
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
        throw new CompileError(`can't assign to '${text(target)}' because '${pathOf(moved)}' was moved`, target.start, target.end, { message: move.note, start: move.start, end: move.end });
      }
    }
    revive(place);
  }

  function revive(place: string) {
    if (!state) return;
    for (const moved of [...state.moves.keys()]) if (moved === place || moved.startsWith(`${place}.`)) state.moves.delete(moved);
  }

  // The place an expression names: a variable or `this`, then fields, but not through a getter.
  function key(e: Named): string | undefined {
    if (e.kind === "shorthand" || e.kind === "ident") {
      const local = locals.get(e);
      return local && String(local.id);
    }
    if (e.kind === "this" || e.kind === "super") return "this";
    if (e.kind !== "member" || calls.has(e) || !types.has(e.object)) return undefined;
    const object = key(e.object);
    return object === undefined ? undefined : `${object}.${e.name}`;
  }

  // The places a closure captures, where it first uses each, and the variable, if not `this`.
  function captured(e: Extract<Expr, { kind: "arrow" }>): [string, Named, Local | undefined][] {
    const inner = calls.get(e)!;
    return [...inner.captures!].flatMap(([alias, from]): [string, Named, Local | undefined][] => {
      const use = inner.captureUses!.get(alias) as Named | undefined;
      if (!use) return [];
      return [from === "this" ? ["this", use, undefined] : [String(from.id), use, from]];
    });
  }

  function rootOf(e: Named): Named {
    return e.kind === "member" ? rootOf(e.object) : e;
  }

  // How a place reads in a message.
  function text(e: Named): string {
    if (e.kind === "member") return `${text(e.object)}.${e.name}`;
    return e.kind === "ident" || e.kind === "shorthand" ? e.name : e.kind === "this" || e.kind === "super" ? "this" : "(...)";
  }

  // A place's path as written, from the variable's name.
  function pathOf(place: string): string {
    const [id, ...fields] = place.split(".");
    const local = [...locals.values()].find((l) => String(l.id) === id);
    return [local?.name ?? id, ...fields].join(".");
  }
}

// Whether two places are one, or one is inside the other.
function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
}

// Where each reference variable is used last: a use as an argument or receiver lasts until
// the call ends, and a use inside a loop the variable was declared outside of lasts until the
// loop ends, since the loop may come round to an earlier use.
function lastUses(body: Stmt[], { locals, types, coercions }: Instance): Map<Local, number> {
  // An argument lent to the call, as a reference, is in use until the call ends.
  const lentTo = (a: Expr) => {
    const t = coercions.get(a) ?? types.get(a);
    return t !== undefined && isRef(t);
  };
  const last = new Map<Local, number>();
  const loops: Stmt[] = [];
  const declared = new Map<Local, Stmt[]>();
  const used = (local: Local | undefined, at: number) => {
    if (!local || !holdsRef(local.type)) return;
    const outer = loops.find((l) => !(declared.get(local) ?? []).includes(l));
    last.set(local, Math.max(last.get(local) ?? -1, at, outer?.end ?? at));
  };
  const stmts = (list: Stmt[]) => list.forEach(stmt);
  function stmt(s: Stmt) {
    switch (s.kind) {
      case "expr":
        return expr(s.expr);
      case "let":
        declared.set(locals.get(s)!, [...loops]);
        return expr(s.declarations[0]!.init!);
      case "if":
        expr(s.cond);
        stmts(s.then);
        if (s.else) stmts(s.else);
        return;
      case "block":
        return stmts(s.body);
      case "while":
      case "doWhile":
        loops.push(s);
        expr(s.cond);
        stmts(s.body);
        loops.pop();
        return;
      case "for":
        if (s.init) stmt(s.init);
        loops.push(s);
        if (s.test) expr(s.test);
        if (s.update) expr(s.update);
        stmts(s.body);
        loops.pop();
        return;
      case "labeled":
        return stmt(s.body);
      case "switch":
        expr(s.discriminant);
        for (const c of s.cases) {
          if (c.test) expr(c.test);
          stmts(c.body);
        }
        return;
      case "return":
        if (s.value) expr(s.value);
        return;
    }
  }
  function expr(e: Expr, call?: number) {
    switch (e.kind) {
      case "ident":
        return used(locals.get(e), call ?? e.end);
      case "member":
        return expr(e.object, call);
      case "object":
        for (const p of e.props) {
          if (p.kind === "property") expr(p.value);
          else if (p.kind === "shorthand") used(locals.get(p), p.end);
        }
        return;
      case "new":
        for (const a of e.args ?? []) expr(a, lentTo(a) ? e.end : undefined);
        return;
      case "call":
        if (e.callee.kind === "member") expr(e.callee.object, e.end);
        // A closure called through a variable is in use until the call ends.
        if (e.callee.kind === "ident") expr(e.callee, e.end);
        for (const a of e.args) expr(a, lentTo(a) ? e.end : undefined);
        return;
      case "unary":
      case "update":
        return expr(e.operand);
      case "assign":
        expr(e.target);
        return expr(e.value);
      case "conditional":
        expr(e.cond);
        expr(e.then, call);
        return expr(e.else, call);
      case "binary":
        expr(e.left);
        return expr(e.right);
    }
  }
  stmts(body);
  return last;
}

// What has moved, and what is lent, on either of two ways here.
function join(a: State, b: State): State {
  if (!a) return b && { moves: new Map(b.moves), loans: new Map(b.loans) };
  if (!b) return { moves: new Map(a.moves), loans: new Map(a.loans) };
  const moves = new Map(a.moves);
  for (const [k, v] of b.moves) if (!moves.has(k)) moves.set(k, v);
  const loans = new Map(a.loans);
  for (const [k, v] of b.loans) {
    const mine = loans.get(k);
    loans.set(k, mine ? { ...mine, holders: new Set([...mine.holders, ...v.holders]) } : v);
  }
  return { moves, loans };
}

function same(a: State, b: State): boolean {
  if (!a || !b) return a === b;
  const loans = (s: NonNullable<State>) => [...s.loans].map(([k, l]) => `${k}:${[...l.holders].map((h) => h.id).sort().join(",")}`).sort().join(";");
  return a.moves.size === b.moves.size && [...a.moves.keys()].every((k) => b.moves.has(k)) && loans(a) === loans(b);
}
