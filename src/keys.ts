import { CompileError } from "./diag.ts";
import type { ClassMember, Expr, Stmt, TypeMember } from "./parser.ts";
import { Rewrites, walk } from "./nodes.ts";
import { rebuiltStmts } from "./rebuild.ts";
import { unsupported } from "./unsupported.ts";

// Computed property names, `[key]`, whose key is known while compiling: an object or class has a
// fixed layout, so each key is a field's name. A key known only at run time belongs in a Map.

// The name a computed key gives, from its literal parts; `leaf` gives the name of anything else,
// or throws. `Symbol.iterator` and the other well-known symbols aren't names, and are refused.
export function knownKey(key: Expr, leaf: (e: Expr) => string): string {
  switch (key.kind) {
    case "string":
      return key.value;
    case "int":
      return String(key.value);
    case "float":
      return String(key.value);
    case "template":
      return key.quasis.map((q, i) => q + (i < key.exprs.length ? knownKey(key.exprs[i]!, leaf) : "")).join("");
    case "unary":
      if (key.op === "-" && (key.operand.kind === "int" || key.operand.kind === "float")) return String(-key.operand.value);
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

// A key `Symbol.iterator` and its kind, which no name stands for.
export function symbolKey(key: Expr): CompileError {
  return unsupported(key.kind === "member" ? `'[Symbol.${key.name}]' members` : "computed property names", key);
}

export function unknownKey(key: Expr, what: string): CompileError {
  return new CompileError("E0120", `a computed key has to be known while compiling, and ${what}; use a literal, a const holding one, an enum member or a template of those, or a Map for keys known only at run time`, key.start, key.end);
}

// Gives every class member and type member with a computed name the name its key gives. Their
// layouts are settled before any body is checked, so a key there is a literal, a top-level const
// holding one, a member of a top-level enum, or a template of those. A `Symbol` key is left for
// the checker to refuse.
export function lowerKeys(program: Stmt[]) {
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
        return knownKey(consts.get(e.name)!, leaf);
      } finally {
        reading.delete(e.name);
      }
    }
    if (e.kind === "member" && e.object.kind === "ident" && enums.has(e.object.name)) return enumMember(enums.get(e.object.name)!, e);
    throw unknownKey(e, "a class's or a type's member name can only read a top-level const or enum");
  };
  const rewrites = new Rewrites();
  walk("stmt", program, (n) => {
    if (n.of !== "classMember" && n.of !== "typeMember") return;
    const m = n.node as (ClassMember | TypeMember) & { name?: unknown };
    if (typeof m.name !== "object" || m.name === null) return;
    const key = m.name as Expr;
    if (key.kind === "member" && key.object.kind === "ident" && key.object.name === "Symbol") return;
    rewrites.replace(m, { ...m, name: knownKey(key, leaf) } as ClassMember | TypeMember);
  });
  rebuiltStmts(program, rewrites);
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
