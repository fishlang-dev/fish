import type { Instance, Local } from "./check.ts";
import { CompileError } from "./diag.ts";
import type { Expr, ObjectProp, Stmt } from "./parser.ts";
import { isPrint } from "./values.ts";
import { field, isCopy, type RefType, type Type } from "./typing.ts";

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


export function checkMoves(body: Stmt[], instance: Instance) {
  const { types, locals, calls, setters, jumps, coercions } = instance;
  let state: State = { moves: new Map(), loans: new Map() };
  // The states `break` leaves to each statement, and `continue` takes back to each loop.
  const exits = new Map<Stmt, State>();
  const nexts = new Map<Stmt, State>();
  // The pass each enclosing loop is on.
  const passes = new Map<Stmt, number>();
  const last = lastUses(body, instance);
  statements(body);

  // The reference variables declared anywhere inside a statement.
  function inside(s: Stmt): Local[] {
    switch (s.kind) {
      case "let":
        return isRef(locals.get(s)!.type) ? [locals.get(s)!] : [];
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
    for (const s of list) if (s.kind === "let" && isRef(locals.get(s)!.type)) release(locals.get(s)!);
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
        if (isRef(local.type)) hold(local, d.init!);
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
        if (s.value) expr(s.value, () => "");
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
      // however it left the body.
      for (const local of inside(s)) release(local);
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
      case "this":
        free("this", e, "read");
        if (consume && state && !isCopy(types.get(e)!)) {
          throw new CompileError("'this' can't be moved, since it is only borrowed here; use 'this.clone()' to hand over a copy", e.start, e.end);
        }
        return;
      case "member":
        if (!types.has(e.object)) return;
        if (key(e) !== undefined) return use(e, consume);
        return expr(e.object);
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
        return during(e, () => {
          // A method's receiver is lent to it for the call, mutably when the method changes it.
          // A mutable receiver is lent shared while the arguments run, so they may read it, and
          // mutably for the call itself.
          const object = e.callee.kind === "member" ? e.callee.object : undefined;
          const place = object && key(object);
          const self = calls.get(e)?.body.self;
          if (object) expr(object);
          if (object && place !== undefined && self) lend(place, false, object, undefined, name, e);
          handOver(e.args, name, e);
          if (object && place !== undefined && self?.mutable && state) {
            state.loans.delete(object.start);
            lend(place, true, object, undefined, name, e, e.end - 1);
          }
        });
      }
      case "unary":
        return expr(e.operand);
      case "update":
        expr(e.operand);
        return change(e.operand);
      case "assign": {
        if (e.op !== "=") expr(e.target);
        expr(e.value, (p) => `'${p}' moved here into '${text(e.target)}'; use '${p}.clone()' to keep a copy`);
        // The target changes once the value is ready, after the value's reads.
        assign(e.target, e.end);
        const local = e.target.kind === "ident" ? locals.get(e.target) : undefined;
        // Pointing a reference elsewhere lets go of what it held.
        if (local && isRef(local.type)) {
          release(local);
          hold(local, e.value);
        }
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
    const type = types.get(e)!;
    const to = coercions.get(e) ?? type;
    const place = key(e);
    // A shared reference passed on is just another pointer, which needs nothing lent; a
    // mutable one lends itself, shared or mutably as it is passed on.
    if (place === undefined || !isRef(to) || (isRef(type) && !type.mutable)) return [];
    return [[place, e, to.mutable]];
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
    if (root && isRef(root.type)) {
      throw new CompileError(`'${text(e)}' can't be moved out of '${root.name}', which only borrows it; use '${text(e)}.clone()'`, e.start, e.end);
    }
    if (place.startsWith("this")) {
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
    const place = key(e);
    if (place === undefined) return;
    // A place borrowed, or a reference copied, is lent to the holder: a mutable reference
    // copied lends itself mutably, so only one of them is used at a time.
    for (const [lentPlace, part, mutable] of lent(e)) lend(lentPlace, mutable, part, holder);
    // Through a reference, what it holds stays held.
    const root = locals.get(rootOf(e) as never);
    if (!root || !isRef(root.type) || root === holder) return;
    for (const [at, loan] of state.loans) if (loan.holders.has(root)) state.loans.set(at, { ...loan, holders: new Set([...loan.holders, holder]) });
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
    if (e.kind === "this") return "this";
    if (e.kind !== "member" || calls.has(e) || !types.has(e.object)) return undefined;
    const object = key(e.object);
    return object === undefined ? undefined : `${object}.${e.name}`;
  }

  function rootOf(e: Named): Named {
    return e.kind === "member" ? rootOf(e.object) : e;
  }

  // How a place reads in a message.
  function text(e: Named): string {
    if (e.kind === "member") return `${text(e.object)}.${e.name}`;
    return e.kind === "ident" || e.kind === "shorthand" ? e.name : e.kind === "this" ? "this" : "(...)";
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
    if (!local || !isRef(local.type)) return;
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
