import { CompileError } from "./diag.ts";
import type { ClassMember, Expr, Stmt, TypeMember } from "./parser.ts";
import { forEachChild, Rewrites, walk, type AnyNode } from "./nodes.ts";
import { rebuiltStmts } from "./rebuild.ts";
import { ITERATOR } from "./typing.ts";
import { unsupported } from "./unsupported.ts";

// Computed property names, `[key]`, whose key is known while compiling: an object or class has a
// fixed layout, so each key is a field's name. A key known only at run time belongs in a Map.

// The name a computed key gives, from its literal parts; `leaf` gives the name of anything else,
// or throws. `Symbol.iterator` and the other well-known symbols aren't names, and are refused.
export function knownKey(key: Expr, leaf: (e: Expr) => string): string {
  switch (key.kind) {
    case "string":
      return key.value;
    // A number key is a double's name, as in JavaScript.
    case "int":
      return String(Number(key.value));
    case "float":
      return String(key.value);
    case "template":
      return key.quasis.map((q, i) => q + (i < key.exprs.length ? knownKey(key.exprs[i]!, leaf) : "")).join("");
    case "unary":
      if (key.op === "-" && (key.operand.kind === "int" || key.operand.kind === "float")) return String(-Number(key.operand.value));
      break;
    case "as":
      if (key.type.kind === "ref" && key.type.name === "const") return knownKey(key.expr, leaf);
      break;
    case "member":
      if (key.object.kind === "ident" && key.object.name === "Symbol") throw symbolKey(key);
      break;
  }
  return leaf(key);
}

// The name a number literal, maybe negated or written `as const`, gives as a key.
export function numberKey(e: Expr): string | undefined {
  const x = e.kind === "as" && e.type.kind === "ref" && e.type.name === "const" ? e.expr : e;
  const n = x.kind === "unary" && x.op === "-" ? x.operand : x;
  return n.kind === "int" || n.kind === "float" ? knownKey(x, () => "") : undefined;
}

// Whether `key` is `Symbol.iterator`.
export const isIteratorKey = (key: Expr): boolean => key.kind === "member" && key.name === "iterator" && key.object.kind === "ident" && key.object.name === "Symbol";

// A key `Symbol.iterator` and its kind, which no name stands for.
export function symbolKey(key: Expr): CompileError {
  return unsupported(key.kind === "member" ? `'[Symbol.${key.name}]' members` : "computed property names", key);
}

export function unknownKey(key: Expr, what: string): CompileError {
  return new CompileError("E0120", `a computed key has to be known while compiling, and ${what}; use a literal, a const holding one, an enum member or a template of those, or a Map for keys known only at run time`, key.start, key.end);
}

// The names a key there may read: top-level consts and enums, by their written literals.
export function topKeys(program: Stmt[]): (e: Expr) => string {
  const consts = new Map<string, Expr>();
  const enums = new Map<string, Extract<Stmt, { kind: "enum" }>>();
  for (const s of program) {
    const d = s.kind === "export" || s.kind === "declare" ? s.body : s;
    if (d.kind === "let" && d.keyword === "const") for (const x of d.declarations) if (x.target.kind === "ident" && x.init) consts.set(x.target.name, x.init);
    if (d.kind === "enum") enums.set(d.name, d);
  }
  const reading = new Set<string>();
  const leaf = (e: Expr): string => {
    if (e.kind === "ident" && consts.has(e.name)) {
      if (reading.has(e.name)) throw unknownKey(e, `'${e.name}' is defined in terms of itself`);
      // A const holding a template with values in it is a string, as the checker types it.
      const init = consts.get(e.name)!;
      const held = init.kind === "as" ? init.expr : init;
      if (held.kind === "template" && held.exprs.length > 0) throw unknownKey(e, "this is a 'string'");
      reading.add(e.name);
      try {
        return knownKey(init, leaf);
      } catch (err) {
        // Pointing at the key, which is what has to change, rather than inside the const.
        if (err instanceof CompileError && err.code === "E0120" && (err.start < e.start || err.start >= e.end)) throw unknownKey(e, `'${e.name}' doesn't hold a literal`);
        throw err;
      } finally {
        reading.delete(e.name);
      }
    }
    if (e.kind === "member" && e.object.kind === "ident" && enums.has(e.object.name)) return enumMember(enums.get(e.object.name)!, e);
    throw unknownKey(e, "a class's or a type's member name can only read a top-level const or enum");
  };
  return leaf;
}

// Gives every class member and type member with a computed name the name its key gives. Their
// layouts are settled before any body is checked, so a key there is a literal, a top-level const
// holding one, a member of a top-level enum, or a template of those. A method keyed
// `Symbol.iterator` is named `ITERATOR`; any other `Symbol` key is left for the checker to refuse.
export function lowerKeys(program: Stmt[]) {
  const leaf = topKeys(program);
  const rewrites = new Rewrites();
  walk("stmt", program, (n) => {
    if (n.of !== "classMember" && n.of !== "typeMember") return;
    const m = n.node as (ClassMember | TypeMember) & { name?: unknown };
    if (m.name === ITERATOR) throw new CompileError("E0120", `'${ITERATOR}' as a quoted name would name a '[Symbol.iterator]' method, which is only written as '[Symbol.iterator]'`, m.start, m.end);
    if (typeof m.name !== "object" || m.name === null) return;
    const key = m.name as Expr;
    if (isIteratorKey(key) && m.kind === "method") return void rewrites.replace(m, { ...m, name: ITERATOR } as ClassMember | TypeMember);
    if (key.kind === "member" && key.object.kind === "ident" && key.object.name === "Symbol") return;
    const name = knownKey(key, leaf);
    if (name === ITERATOR) throw unknownKey(key, `'${name}' would name a '[Symbol.iterator]' method, which is only written as '[Symbol.iterator]'`);
    if (n.of === "classMember" && name.startsWith("#")) throw unknownKey(key, `'${name}' would name a private field, which is only written as '${name}'`);
    rewrites.replace(m, { ...m, name } as ClassMember | TypeMember);
  });
  rebuiltStmts(program, rewrites);
}

// Refuses a class's or a type's member key, inside a function, that reads one of the function's
// own variables: the member is laid out with the program's top-level names, so a variable there
// shadowing a top-level const would otherwise be read past. Runs before local declarations are
// hoisted out of their functions.
export function localKeys(program: Stmt[]) {
  const visit = (n: AnyNode, locals: Set<string>) => {
    if ((n.of === "classMember" || n.of === "typeMember") && typeof (n.node as { name?: unknown }).name === "object") {
      walk("expr", (n.node as { name: Expr }).name, (k) => {
        if (k.of === "expr" && k.node.kind === "ident" && locals.has(k.node.name)) throw unknownKey(k.node, `'${k.node.name}' is a variable of the function around it; a class's or a type's member name can only read a top-level const or enum`);
      });
    }
    const inner = bodied(n) ? new Set([...locals, ...declared(n)]) : locals;
    forEachChild(n, (c) => visit(c, inner));
  };
  for (const s of program) visit({ of: "stmt", node: s }, new Set<string>());
}

const bodied = (n: AnyNode): boolean =>
  (n.of === "stmt" && n.node.kind === "function") || (n.of === "expr" && (n.node.kind === "arrow" || n.node.kind === "function")) ||
  (n.of === "classMember" && ["method", "constructor", "get", "set"].includes(n.node.kind)) || (n.of === "objectProp" && ["method", "get", "set"].includes(n.node.kind));

// Every variable, parameter and nested function a body declares, at any depth.
function declared(n: AnyNode): string[] {
  const names: string[] = [];
  walk(n.of as Exclude<AnyNode["of"], "stmts">, n.node as never, (x) => {
    if (x.of === "pattern" && x.node.kind === "ident") names.push(x.node.name);
    if (x.of === "stmt" && x.node.kind === "function" && x.node.name !== undefined) names.push(x.node.name);
  });
  return names;
}

// A member of an enum whose values are written as literals, or counted on from one.
function enumMember(node: Extract<Stmt, { kind: "enum" }>, e: Extract<Expr, { kind: "member" }>): string {
  if (node.typeParams.length > 0 || node.members.some((m) => m.payload)) throw unknownKey(e, `'${node.name}' is an enum whose members hold values, not names`);
  let next: bigint | undefined = 0n;
  for (const m of node.members) {
    const init = m.init;
    const value: bigint | string | undefined = init === undefined ? next : init.kind === "int" || init.kind === "string" ? init.value : init.kind === "unary" && init.op === "-" && init.operand.kind === "int" ? -init.operand.value : undefined;
    if (value === undefined) throw unknownKey(e, `'${node.name}.${m.name}' is computed, so its value isn't known before the class or type is laid out`);
    if (m.name === e.name) return String(value);
    next = typeof value === "bigint" ? value + 1n : undefined;
  }
  throw new CompileError("E0502", `property '${e.name}' does not exist on type 'typeof ${node.name}'`, e.start, e.end);
}
