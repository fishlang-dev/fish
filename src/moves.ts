import type { Instance } from "./check.ts";
import { CompileError } from "./diag.ts";
import type { Expr, ObjectProp, Stmt } from "./parser.ts";
import { isPrint } from "./values.ts";
import { field, type Type } from "./typing.ts";

// Moves: a value that isn't Copy has one owner, so passing, assigning, storing or returning
// it hands it over, and the place it came from can't be used until it is assigned again.
// This walks a checked body in evaluation order, tracking which places have moved.

// Primitives, literals, and unions of nothing else are copied; objects, instances, interface
// values and type parameters move.
export function isCopy(t: Type): boolean {
  if (typeof t === "string" || t.kind === "literal") return true;
  return t.kind === "union" && t.members.every(isCopy);
}

// Where a place moved, the note explaining it, and the pass of each loop it moved on. A place
// is a local's id, or `this`, followed by a field path, like `3.inner.x`.
type Move = { start: number; end: number; note: string; passes: Map<Stmt, number> };

// The places moved on the way here, or null where control can't reach.
type State = Map<string, Move> | null;

// How a consuming use hands a value over, as the note says it, given how the place reads.
type Consumer = (place: string) => string;

// What names a place: a variable, `this`, a field, or a shorthand property naming a variable.
type Named = Expr | Extract<ObjectProp, { kind: "shorthand" }>;

export function checkMoves(body: Stmt[], { types, locals, calls, setters, jumps }: Instance) {
  let state: State = new Map();
  // The states `break` leaves to each statement, and `continue` takes back to each loop.
  const exits = new Map<Stmt, State>();
  const nexts = new Map<Stmt, State>();
  // The pass each enclosing loop is on.
  const passes = new Map<Stmt, number>();
  statements(body);

  function statements(list: Stmt[]) {
    for (const s of list) statement(s);
  }

  function statement(s: Stmt) {
    switch (s.kind) {
      case "expr":
        return expr(s.expr, undefined, true);
      case "let": {
        const d = s.declarations[0]!;
        const name = d.target.kind === "ident" ? d.target.name : "";
        expr(d.init!, (p) => `'${p}' moved here: '${name}' owns it now; use '${p}.clone()' to keep a copy`);
        // A declaration run again by a loop makes a fresh variable.
        revive(String(locals.get(s)!.id));
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

  // A loop runs its body until nothing new has moved by the time it comes round again, so a
  // move late in the body is caught at a use early in it.
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
      if (bodyFirst) cond();
      else update?.();
      leaving = join(leaving, exits.get(s)!);
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
    switch (e.kind) {
      case "int":
      case "bool":
      case "string":
        return;
      case "ident":
        return locals.has(e) ? use(e, consume) : undefined;
      case "this":
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
      case "new":
        return handOver(e.args ?? [], e.callee.kind === "ident" ? `'new ${e.callee.name}'` : "the constructor");
      case "call": {
        if (isPrint(e.callee)) {
          for (const a of e.args) expr(a);
          return;
        }
        if (e.callee.kind === "member") expr(e.callee.object);
        const name = e.callee.kind === "member" || e.callee.kind === "ident" ? `'${e.callee.name}'` : "'super'";
        return handOver(e.args, name);
      }
      case "unary":
      case "update":
        return expr(e.kind === "unary" ? e.operand : e.operand);
      case "assign": {
        if (e.op !== "=") expr(e.target);
        expr(e.value, (p) => `'${p}' moved here into '${text(e.target)}'; use '${p}.clone()' to keep a copy`);
        assign(e.target);
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
        expr(e.then, consume);
        const then = state;
        state = before;
        expr(e.else, consume);
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

  // Arguments are handed over, in order.
  function handOver(args: Expr[], name: string) {
    for (const a of args) {
      expr(a, (p) => `'${p}' moved here: passing it to ${name} hands it over, as if ${name} kept it; pass '${p}.clone()' to keep a copy`);
    }
  }

  // Reads or hands over a place, which must still hold its value.
  function use(e: Named, consume?: Consumer, type = e.kind === "shorthand" ? locals.get(e)!.type : types.get(e)!) {
    const place = key(e)!;
    usable(e, place);
    if (!consume || isCopy(type) || !state) return;
    if (place.startsWith("this")) {
      throw new CompileError(`'${text(e)}' can't be moved out of 'this', since it is only borrowed here; use '${text(e)}.clone()'`, e.start, e.end);
    }
    state.set(place, { start: e.start, end: e.end, note: consume(text(e)), passes: new Map(passes) });
  }

  // A place can't be used once it, something it is inside, or something inside it moved.
  function usable(e: Named, place: string) {
    if (!state) return;
    for (const [moved, move] of state) {
      const inside = place.startsWith(`${moved}.`);
      const holds = moved.startsWith(`${place}.`);
      if (moved !== place && !inside && !holds) continue;
      const name = text(e);
      const what = moved === place ? `'${name}' was moved, so it can't be used here`
        : inside ? `'${name}' can't be used here because '${pathOf(moved)}' was moved`
        : `'${name}' can't be used as a whole here because '${pathOf(moved)}' was moved out of it`;
      const earlier = [...passes].some(([loop, pass]) => (move.passes.get(loop) ?? pass) < pass) ? " (in an earlier pass through this loop)" : "";
      throw new CompileError(what + earlier, e.start, e.end, { message: move.note, start: move.start, end: move.end });
    }
  }

  // Assigning a place gives it a value again, along with everything inside it, but nothing
  // can be assigned inside a value that has moved.
  function assign(target: Expr) {
    const place = key(target);
    if (place === undefined || setters.has(target)) {
      if (target.kind === "member") expr(target.object);
      return;
    }
    if (!state) return;
    for (const [moved, move] of state) {
      if (place.startsWith(`${moved}.`)) {
        throw new CompileError(`can't assign to '${text(target)}' because '${pathOf(moved)}' was moved`, target.start, target.end, { message: move.note, start: move.start, end: move.end });
      }
    }
    revive(place);
  }

  function revive(place: string) {
    if (!state) return;
    for (const moved of [...state.keys()]) if (moved === place || moved.startsWith(`${place}.`)) state.delete(moved);
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

  // How a place reads in a message.
  function text(e: Named): string {
    if (e.kind === "member") return `${text(e.object)}.${e.name}`;
    return e.kind === "ident" || e.kind === "shorthand" ? e.name : e.kind === "this" ? "this" : "(...)";
  }

  // A moved place's path as written, from the variable's name.
  function pathOf(place: string): string {
    const [id, ...fields] = place.split(".");
    const local = [...locals.values()].find((l) => String(l.id) === id);
    return [local?.name ?? id, ...fields].join(".");
  }
}

// What has moved on either of two ways here.
function join(a: State, b: State): State {
  if (!a) return b && new Map(b);
  if (!b) return new Map(a);
  const out = new Map(a);
  for (const [k, v] of b) if (!out.has(k)) out.set(k, v);
  return out;
}

function same(a: State, b: State): boolean {
  if (!a || !b) return a === b;
  return a.size === b.size && [...a.keys()].every((k) => b.has(k));
}
