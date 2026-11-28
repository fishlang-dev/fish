import type { Body } from "./classes.fsh";
import type { Declarator, Expr, Param, Stmt, TypeNode } from "./parser.fsh";
import { forEachChild, reborrowNode, someNode, walk, walkWhile, type AnyNode } from "./nodes.fsh";
import { STD_BASE } from "./std.fsh";
import type { Type, Typing } from "./typing.fsh";

// Ownership inference: a function only its own package can call, and that the program calls only
// by name, takes a parameter it only reads as if `Ref` were written, and one it only reads and
// changes as if `Mut` were, so its signature needs neither. Every caller is in the program, so
// what it passes can be checked too. A program that compiled before means the same: a parameter
// is inferred only where every use reads, or changes, what a reference reaches the same way the
// owned value did, so callers merely keep what they used to hand over. Inferred references live
// for the call; a function returning a reference keeps the lifetimes it writes.

// A parameter open to inference: its place, its name, its type as written, and for a class
// written by name, that name, which a caller's variable must have to be lent mutably.
export type Slot = { index: usize; name: string; type: Type; cls?: string };
export type Candidate = { name: string; slots: Slot[] };
export type Mode = "ref" | "mut";
// Each inferred parameter, by its function's name and its index, as `name#index`.
export type Modes = Map<string, Mode>;

export function slotKey(name: string, index: usize): string {
  return `${name}#${index}`;
}

// Whether a body is a plain top-level function of the program's own, whose parameters and
// result a call sees only through its signature: no method, closure, export, foreign or generic
// function, generator or async function, overload or comptime value.
export function inferable(f: Ref<Body>): boolean {
  if (f.owner !== undefined || f.self !== undefined || f.closure !== undefined || f.js !== undefined || f.rust !== undefined || f.copyOf !== undefined) return false;
  if (f.exported === true || f.foreign === true || f.async === true || f.generator === true || f.comptime !== undefined || f.accessor === true) return false;
  if (f.signature === true || f.overloads !== undefined || (f.typeParams !== undefined && f.typeParams!.length > 0)) return false;
  return f.name !== "main";
}

// Whether a parameter is a plain name with a written type and nothing else said of it.
export function plainParam(p: Ref<Param>): boolean {
  if (p.type === undefined || p.optional || p.rest || p.default !== undefined || p.comptime) return false;
  if (p.modifiers.length > 0 || p.decorators.length > 0) return false;
  return p.pattern.kind === "ident" && p.pattern.name !== "this";
}

// Whether a parameter's reference was inferred rather than written: inference wraps the written
// type in a `Ref` or `Mut` spanning exactly what was written, which no written one does.
export function inferredRef(p: Ref<Param>): boolean {
  if (p.type === undefined) return false;
  const t: Ref<TypeNode> = p.type!;
  if (t.kind !== "ref" || t.args.length !== 1) return false;
  const w: Ref<TypeNode> = t.args[0]!;
  return w.start === t.start && w.end === t.end;
}

// Whether a reference to a value of `t` reads it as the value itself does: an object, instance or
// array that moves rather than copies, holds no reference, and nothing whose drop can be seen.
export function lendable(typing: Ref<Typing>, t: Type): boolean {
  if (typeof t === "string" || typing.isCopy(t) || typing.holdsRef(t) || typing.holdsMoveOnly(t)) return false;
  const r = typing.rec(t);
  if (r.kind === "object") return r.tuple !== true;
  return r.kind === "class" || r.kind === "array";
}

// The array members a shared reference reads, and the methods only a mutable one may call.
const ARRAY_READS = new Set(["length", "includes", "indexOf", "lastIndexOf", "join"]);
const ARRAY_CHANGES = new Set(["push", "pop", "shift", "unshift", "sort", "reverse", "splice", "fill"]);

// How a body uses one parameter: every use, those that only read, those that change what it
// reaches, and whether something else names it, which keeps it owned.
type Scan = { name: string; type: Type; total: usize; safe: usize; writes: usize; bail: boolean };

// What each candidate's parameters are inferred as. A parameter passed on to another candidate
// reads only while that one's does, so every parameter starts borrowed and gives way until none
// changes.
export function inferModes(typing: Ref<Typing>, program: Ref<Stmt[]>, given: Ref<Candidate[]>): Modes {
  let named = new Map<string, Candidate>();
  for (const c of given) named.set(c.name, { name: c.name, slots: c.slots.map((s) => ({ ...s })) });
  calledByName(program, named);
  const lent = mutablyLent(program, named);
  let modes: Modes = new Map<string, Mode>();
  for (const [name, c] of named) for (const s of c.slots) modes.set(slotKey(name, s.index), "ref");
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of program) {
      if (s.kind !== "function" || s.body === undefined || !named.has(s.name)) continue;
      const c = named.get(s.name)!;
      for (const slot of c.slots) {
        const key = slotKey(s.name, slot.index);
        const was = modes.get(key);
        if (was === undefined) continue;
        const now = modeOf(scanned(typing, s.body!, slot, named, modes), lent.has(key));
        if (now === was) continue;
        changed = true;
        if (now === undefined) modes.delete(key);
        else modes.set(key, now);
      }
    }
  }
  return modes;
}

// The modes as one line, which tells two inferences apart.
export function modesText(modes: Ref<Modes>): string {
  let parts: string[] = [];
  for (const [key, mode] of modes) parts.push(`${key}:${mode}`);
  parts.sort();
  return parts.join(",");
}

function modeOf(s: Ref<Scan>, lent: boolean): Mode | undefined {
  if (s.bail) return undefined;
  if (s.safe === s.total) return "ref";
  if (s.writes > 0 && s.safe + s.writes === s.total && lent) return "mut";
  return undefined;
}

function scanned(typing: Ref<Typing>, body: Ref<Stmt[]>, slot: Ref<Slot>, named: Ref<Map<string, Candidate>>, modes: Ref<Modes>): Scan {
  let s: Scan = { name: slot.name, type: slot.type, total: 0, safe: 0, writes: 0, bail: false };
  walk({ of: "stmts", node: body }, (n) => counted(n, s));
  if (!s.bail) visit({ of: "stmts", node: body }, s, typing, named, modes);
  return s;
}

// Counts the parameter's uses, and gives up on it where its name is bound again or read as a
// type: shadowing would make some of them another variable's.
function counted(n: AnyNode, s: Mut<Scan>): void {
  if (n.of === "expr" && n.node.kind === "ident" && n.node.name === s.name) s.total++;
  if (boundName(reborrowNode(n)) === s.name || (n.of === "stmt" && n.node.kind === "function" && n.node.name === s.name)) s.bail = true;
}

// The name a node binds, reads as a shorthand property, or reads as a type with `typeof`.
function boundName(n: AnyNode): string | undefined {
  if (n.of === "pattern") return n.node.kind === "ident" ? n.node.name : undefined;
  if (n.of === "objectProp") return n.node.kind === "shorthand" ? n.node.name : undefined;
  if (n.of === "typeNode" && n.node.kind === "query") return queried(n.node.target);
  return undefined;
}

function queried(t: Ref<TypeNode>): string | undefined {
  if (t.kind !== "ref") return undefined;
  const dot = t.name.indexOf(".");
  return dot < 0 ? t.name : t.name.slice(0, dot);
}

// Judges every place a node holds the parameter, outside nested functions, which may outlive
// the call and so count as uses that don't only read.
function visit(n: AnyNode, s: Mut<Scan>, typing: Ref<Typing>, named: Ref<Map<string, Candidate>>, modes: Ref<Modes>): void {
  if (functionLike(reborrowNode(n))) return;
  forEachChild(reborrowNode(n), (c) => judge(reborrowNode(n), c, s, typing, named, modes));
  forEachChild(n, (c) => visit(c, s, typing, named, modes));
}

function functionLike(n: AnyNode): boolean {
  if (n.of === "expr") return n.node.kind === "function" || n.node.kind === "arrow" || n.node.kind === "class";
  if (n.of === "stmt") return n.node.kind === "function" || n.node.kind === "class";
  if (n.of === "objectProp") return n.node.kind === "method";
  return n.of === "classMember" || n.of === "func" || n.of === "classNode";
}

// What reading the parameter through fields and elements reaches, or undefined for anything else.
function chainType(typing: Ref<Typing>, e: Ref<Expr>, s: Ref<Scan>): Type | undefined {
  if (e.kind === "ident") return e.name === s.name ? s.type : undefined;
  if (e.kind === "member" && !e.optional) {
    const o = chainType(typing, e.object, s);
    if (o === undefined || typeof o === "string") return undefined;
    const k = typing.kindOf(o);
    if (k !== "object" && k !== "class") return undefined;
    const f = typing.field(o, e.name);
    return f !== undefined ? f.type : undefined;
  }
  if (e.kind === "index" && !e.optional) return elementOf(typing, chainType(typing, e.object, s));
  return undefined;
}

function elementOf(typing: Ref<Typing>, t: Type | undefined): Type | undefined {
  if (t === undefined || typeof t === "string") return undefined;
  const r = typing.rec(t);
  if (r.kind === "array") return r.element;
  if (r.kind === "fixed") return r.element;
  return undefined;
}

// How `x` uses the reading `c`, when `c` reads the parameter and `x` reads no further into it: a
// copy taken or an array's length read only reads, as does passing it on to another candidate's
// borrowed parameter of the same type; assigning into it, or calling an array method that changes
// it, changes it; anything else keeps it owned.
function judge(x: AnyNode, c: AnyNode, s: Mut<Scan>, typing: Ref<Typing>, named: Ref<Map<string, Candidate>>, modes: Ref<Modes>): void {
  if (c.of !== "expr") return;
  const at = c.node;
  const ct = chainType(typing, at, s);
  if (ct === undefined) return;
  // A destructuring pattern holding it assigns into it.
  if (x.of === "pattern") {
    if (at.kind !== "ident") s.writes++;
    return;
  }
  if (x.of === "stmt") {
    const st = x.node;
    if (st.kind === "forOf" && st.right.id === at.id) {
      const element = elementOf(typing, ct);
      if (element !== undefined && typing.isCopy(element)) s.safe++;
      return;
    }
    if (typing.isCopy(ct)) s.safe++;
    return;
  }
  if (x.of !== "expr") {
    if (typing.isCopy(ct)) s.safe++;
    return;
  }
  const e = x.node;
  if ((e.kind === "member" || e.kind === "index") && e.object.id === at.id && chainType(typing, e, s) !== undefined) return;
  if (e.kind === "assign" && e.target.id === at.id) {
    if (at.kind !== "ident") s.writes++;
    return;
  }
  if (e.kind === "update" && e.operand.id === at.id) {
    if (at.kind !== "ident") s.writes++;
    return;
  }
  if (e.kind === "unary" && e.op === "delete") return;
  if (typing.isCopy(ct)) {
    s.safe++;
    return;
  }
  if (e.kind === "member" && e.object.id === at.id) {
    const element = elementOf(typing, ct);
    if (element === undefined) return;
    if (ARRAY_READS.has(e.name) && (e.name === "length" || typing.isCopy(element))) s.safe++;
    else if (ARRAY_CHANGES.has(e.name)) s.writes++;
    return;
  }
  if (e.kind === "call" && e.callee.kind === "ident" && !e.args.some((a) => a.kind === "spread")) {
    const g = named.get(e.callee.name);
    if (g === undefined) return;
    const i = e.args.findIndex((a) => a.id === at.id);
    if (i < 0) return;
    const slot = g.slots.find((sl) => sl.index === (i as usize));
    if (slot !== undefined && modes.get(slotKey(e.callee.name, i as usize)) === "ref" && slot.type === ct) s.safe++;
  }
}

// What names the program gives each candidate: one function declaration, and calls of it by name.
type Naming = { total: Map<string, usize>; calls: Map<string, usize>; decls: Map<string, usize>; bad: Set<string> };

// Leaves only the candidates the program names nowhere but as a callee, so no function value of
// theirs, whose type the parameters' modes are part of, is made.
function calledByName(program: Ref<Stmt[]>, named: Mut<Map<string, Candidate>>): void {
  let w: Naming = { total: new Map<string, usize>(), calls: new Map<string, usize>(), decls: new Map<string, usize>(), bad: new Set<string>() };
  for (const s of program) {
    if (s.start < STD_BASE) walk({ of: "stmt", node: s }, (n) => naming(n, named, w));
  }
  let gone: string[] = [];
  for (const name of named.keys()) {
    if (w.bad.has(name) || (w.total.get(name) ?? 0) !== (w.calls.get(name) ?? 0) || (w.decls.get(name) ?? 0) !== 1) gone.push(name);
  }
  for (const name of gone) named.delete(name);
}

function naming(n: AnyNode, named: Ref<Map<string, Candidate>>, w: Mut<Naming>): void {
  if (n.of === "expr") {
    const e = n.node;
    if (e.kind === "ident" && named.has(e.name)) w.total.set(e.name, (w.total.get(e.name) ?? 0) + 1);
    if (e.kind === "call" && e.callee.kind === "ident" && named.has(e.callee.name)) {
      w.calls.set(e.callee.name, (w.calls.get(e.callee.name) ?? 0) + 1);
      if (e.args.some((a) => a.kind === "spread")) w.bad.add(e.callee.name);
    }
    return;
  }
  if (n.of === "stmt" && n.node.kind === "function" && named.has(n.node.name)) w.decls.set(n.node.name, (w.decls.get(n.node.name) ?? 0) + 1);
  const name = boundName(reborrowNode(n));
  if (name !== undefined && named.has(name)) w.bad.add(name);
}

// The parameters, as `name#index`, a class is written for whose every call passes a variable the
// calling function declares with `let` as an instance of exactly that class, and reads nowhere
// else, so lending it mutably changes nothing the caller could see before.
function mutablyLent(program: Ref<Stmt[]>, named: Ref<Map<string, Candidate>>): Set<string> {
  let open = new Set<string>();
  for (const [name, c] of named) for (const s of c.slots) if (s.cls !== undefined) open.add(slotKey(name, s.index));
  if (open.size === 0) return open;
  let bad = new Set<string>();
  for (const s of program) if (s.start < STD_BASE) sites({ of: "stmt", node: s }, { of: "stmts", node: [] }, true, named, bad);
  let out = new Set<string>();
  for (const k of open) if (!bad.has(k)) out.add(k);
  return out;
}

// Judges each call of a candidate under `n`, `scope` the innermost function holding it, `top`
// when there is none.
function sites(n: AnyNode, scope: AnyNode, top: boolean, named: Ref<Map<string, Candidate>>, bad: Mut<Set<string>>): void {
  if (n.of === "expr") {
    const e = n.node;
    if (e.kind === "call" && e.callee.kind === "ident" && named.has(e.callee.name)) {
      const c = named.get(e.callee.name)!;
      for (const slot of c.slots) {
        if (slot.cls === undefined) continue;
        if (top || slot.index >= e.args.length) {
          bad.add(slotKey(e.callee.name, slot.index));
          continue;
        }
        const a: Ref<Expr> = e.args[slot.index]!;
        if (a.kind !== "ident" || !letOf(reborrowNode(scope), a.name, slot.cls!)) bad.add(slotKey(e.callee.name, slot.index));
      }
    }
  }
  if (functionLike(reborrowNode(n))) forEachChild(reborrowNode(n), (c) => sites(c, reborrowNode(n), false, named, bad));
  else forEachChild(n, (c) => sites(c, reborrowNode(scope), top, named, bad));
}

type Binding = { bindings: usize; found: boolean; nested: boolean; root: boolean };

// Whether `scope` declares `x` once, with `let`, as an instance of `cls`, and no function inside
// it names `x`.
function letOf(scope: AnyNode, x: string, cls: string): boolean {
  let b: Binding = { bindings: 0, found: false, nested: false, root: true };
  walkWhile(scope, (n) => bound(n, x, cls, b));
  return b.bindings === 1 && b.found && !b.nested;
}

function bound(n: AnyNode, x: string, cls: string, b: Mut<Binding>): boolean {
  if (!b.root && functionLike(reborrowNode(n))) {
    if (someNode(n, (m) => (m.of === "expr" && m.node.kind === "ident" && m.node.name === x) || boundName(reborrowNode(m)) === x)) b.nested = true;
    return false;
  }
  b.root = false;
  if (n.of === "pattern" && n.node.kind === "ident" && n.node.name === x) b.bindings++;
  if (n.of === "stmt" && n.node.kind === "let" && n.node.keyword === "let") {
    for (const d of n.node.declarations) if (d.target.kind === "ident" && d.target.name === x && classed(d, cls)) b.found = true;
  }
  return true;
}

function classed(d: Ref<Declarator>, cls: string): boolean {
  if (d.type !== undefined) return d.type.kind === "ref" && d.type.name === cls && d.type.args.length === 0;
  return d.init !== undefined && d.init.kind === "new" && d.init.callee.kind === "ident" && d.init.callee.name === cls && d.init.typeArgs.length === 0;
}
