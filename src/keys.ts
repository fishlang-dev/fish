import { CompileError } from "./diag.ts";
import type { ClassMember, Expr, Stmt, TypeMember } from "./parser.ts";
import { forEachChild, reborrowNode, Rewrites, walk, type AnyNode } from "./nodes.ts";
import { cloneClassMember, cloneExpr, cloneOneOf2, cloneTypeMember, rebuiltStmts } from "./rebuild.ts";
import { ITERATOR } from "./typing.ts";
import { unsupported } from "./unsupported.ts";

// Computed property names, `[key]`, whose key is known while compiling: an object or class has a
// fixed layout, so each key is a field's name. A key known only at run time belongs in a Map.

/** @throws {CompileError} */
export type KeyLeaf = (e: Ref<Expr>) => string;

// The name a computed key gives, from its literal parts; `leaf` gives the name of anything else,
// or throws. `Symbol.iterator` and the other well-known symbols aren't names, and are refused.
/** @throws {CompileError} */
export function knownKey(key: Ref<Expr>, leaf: KeyLeaf): string {
  let out = "";
  for (const part of keyParts(key)) {
    if (typeof part === "string") out += part;
    else out += leaf(leafOf(part));
  }
  return out;
}

// A key's parts in order: text as it is, and the expressions left for a leaf to name, which
// `leafOf` checks first. A template's parts are taken from a stack rather than by recursion, so
// a leaf is called rather than handed on: Fish has no references to functions, and each closure
// handed on would make another instance of a function.
/** @throws {CompileError} */
export function keyParts(key: Ref<Expr>): (string | Expr)[] {
  let parts: (string | Expr)[] = [];
  // What is left to read, last first: text as it is, or an expression to name.
  let left: (string | Expr)[] = [cloneExpr(key)];
  while (left.length > 0) {
    const part = left.pop()!;
    if (typeof part === "string") {
      parts.push(part);
      continue;
    }
    switch (part.kind) {
      case "string":
        parts.push(part.value);
        continue;
      // A number key is a double's name, as in JavaScript.
      case "int":
        parts.push(String(Number(String(part.value))!));
        continue;
      case "float":
        parts.push(String(part.value));
        continue;
      case "template":
        for (let i = part.quasis.length; i > 0; i--) {
          if (i - 1 < part.exprs.length) left.push(cloneExpr(part.exprs[i - 1]!));
          left.push(part.quasis[i - 1]!);
        }
        continue;
      case "unary":
        if (part.op === "-" && part.operand.kind === "int") {
          parts.push(String(-Number(String(part.operand.value))!));
          continue;
        }
        if (part.op === "-" && part.operand.kind === "float") {
          parts.push(String(-Number(String(part.operand.value))!));
          continue;
        }
        break;
      case "as":
        if (part.type.kind === "ref" && part.type.name === "const") {
          left.push(cloneExpr(part.expr));
          continue;
        }
        break;
    }
    parts.push(part);
  }
  return parts;
}

// A key part a leaf names, with `Symbol.iterator` and the other well-known symbols refused.
/** @throws {CompileError} */
export function leafOf(part: Ref<Expr>): Ref<Expr> {
  if (part.kind === "member" && part.object.kind === "ident" && part.object.name === "Symbol") throw symbolKey(part);
  return part;
}

// The name a number literal, maybe negated or written `as const`, gives as a key.
/** @throws {CompileError} */
export function numberKey(e: Ref<Expr>): string | undefined {
  const isNum =
    e.kind === "as" && e.type.kind === "ref" && e.type.name === "const"
      ? e.expr.kind === "int" || e.expr.kind === "float" || (e.expr.kind === "unary" && e.expr.op === "-" && (e.expr.operand.kind === "int" || e.expr.operand.kind === "float"))
      : e.kind === "int" || e.kind === "float" || (e.kind === "unary" && e.op === "-" && (e.operand.kind === "int" || e.operand.kind === "float"));
  return isNum ? knownKey(e, () => "") : undefined;
}

// Whether `key` is `Symbol.iterator`.
export const isIteratorKey = (key: Ref<Expr>): boolean => key.kind === "member" && key.name === "iterator" && key.object.kind === "ident" && key.object.name === "Symbol";

// A key `Symbol.iterator` and its kind, which no name stands for.
export function symbolKey(key: Ref<Expr>): CompileError {
  return unsupported(key.kind === "member" ? `'[Symbol.${key.name}]' members` : "computed property names", { start: key.start, end: key.end });
}

export function unknownKey(key: Ref<Expr>, what: string): CompileError {
  return new CompileError("E0120", `a computed key has to be known while compiling, and ${what}; use a literal, a const holding one, an enum member or a template of those, or a Map for keys known only at run time`, key.start, key.end);
}

// The names a key there may read: top-level consts and enums, by their written literals.
/** @throws {CompileError} */
export function topKeys(program: Ref<Stmt[]>): TopKeys {
  let consts = new Map<string, Expr>();
  let enums = new Map<string, Extract<Stmt, { kind: "enum" }>>();
  for (const s of program) {
    const d: Ref<Stmt> = s.kind === "export" ? s.body : s.kind === "declare" ? s.body : s;
    if (d.kind === "let" && d.keyword === "const") for (const x of d.declarations) if (x.target.kind === "ident" && x.init !== undefined) consts.set(x.target.name, cloneExpr(x.init));
    if (d.kind === "enum") enums.set(d.name, { ...d });
  }
  return new TopKeys(consts, enums);
}

// The top-level consts and enums a key may read, held as data: Fish has no references to
// functions, so the checker's tables can't hold a closure reading them.
export class TopKeys {
  consts: Map<string, Expr>;
  enums: Map<string, Extract<Stmt, { kind: "enum" }>>;

  constructor(consts: Map<string, Expr>, enums: Map<string, Extract<Stmt, { kind: "enum" }>>) {
    this.consts = consts;
    this.enums = enums;
  }

  // The name a leaf of a key gives, or a CompileError when it gives none.
  /** @throws {CompileError} */
  read(e: Ref<Expr>): string {
    let reading = new Set<string>();
    return readLeaf(e, this.consts, this.enums, reading);
  }
}

function withMemberName(m: Ref<ClassMember>, name: string): ClassMember {
  if (m.kind === "field") return { ...m, name };
  if (m.kind === "method") return { ...m, name };
  if (m.kind === "get" || m.kind === "set") return { ...m, name };
  return cloneClassMember(m);
}

function withTypeMemberName(m: Ref<TypeMember>, name: string): TypeMember {
  if (m.kind === "property") return { ...m, name };
  if (m.kind === "method") return { ...m, name };
  if (m.kind === "get" || m.kind === "set") return { ...m, name };
  return cloneTypeMember(m);
}

/** @throws {CompileError} */
function readLeaf(e: Ref<Expr>, consts: Ref<Map<string, Expr>>, enums: Ref<Map<string, Extract<Stmt, { kind: "enum" }>>>, reading: Mut<Set<string>>): string {
  if (e.kind === "ident" && consts.has(e.name)) {
    if (reading.has(e.name)) throw unknownKey(e, `'${e.name}' is defined in terms of itself`);
    // A const holding a template with values in it is a string, as the checker types it.
    const init = consts.get(e.name)!;
    const isOpenTemplate = init.kind === "as" ? init.expr.kind === "template" && init.expr.exprs.length > 0 : init.kind === "template" && init.exprs.length > 0;
    if (isOpenTemplate) throw unknownKey(e, "this is a 'string'");
    reading.add(e.name);
    try {
      return knownKey(init, (inner) => readLeaf(inner, consts, enums, reading));
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
}

// Gives every class member and type member with a computed name the name its key gives. Their
// layouts are settled before any body is checked, so a key there is a literal, a top-level const
// holding one, a member of a top-level enum, or a template of those. A method keyed
// `Symbol.iterator` is named `ITERATOR`; any other `Symbol` key is left for the checker to refuse.
/** @throws {CompileError} */
export function lowerKeys(program: Mut<Stmt[]>) {
  const leaf = topKeys(program);
  let rewrites = new Rewrites();
  let failure: CompileError | undefined = undefined;
  walk({ of: "stmts", node: program }, (n) => {
    if (failure !== undefined) return;
    if (n.of === "classMember") {
      const m = n.node;
      if (m.kind === "constructor" || m.kind === "staticBlock" || m.kind === "index") return;
      if (typeof m.name === "string" && m.name === ITERATOR) {
        failure = new CompileError("E0120", `'${ITERATOR}' as a quoted name would name a '[Symbol.iterator]' method, which is only written as '[Symbol.iterator]'`, m.start, m.end);
        return;
      }
      const key = cloneOneOf2(m.name);
      if (typeof key === "string") return;
      if (isIteratorKey(key) && m.kind === "method") {
        rewrites.replaceClassMember(m, { ...m, name: ITERATOR });
        return;
      }
      if (key.kind === "member" && key.object.kind === "ident" && key.object.name === "Symbol") return;
      try {
        const name = knownKey(key, (e) => leaf.read(e));
        if (name === ITERATOR) {
          failure = unknownKey(key, `'${name}' would name a '[Symbol.iterator]' method, which is only written as '[Symbol.iterator]'`);
          return;
        }
        if (name.startsWith("#")) {
          failure = unknownKey(key, `'${name}' would name a private field, which is only written as '${name}'`);
          return;
        }
        rewrites.replaceClassMember({ id: m.id }, withMemberName(m, name));
      } catch (err) {
        if (err instanceof CompileError) failure = err;
      }
      return;
    }
    if (n.of === "typeMember") {
      const m = n.node;
      if (m.kind === "property" || m.kind === "method" || m.kind === "get" || m.kind === "set") {
        if (typeof m.name === "string" && m.name === ITERATOR) {
          failure = new CompileError("E0120", `'${ITERATOR}' as a quoted name would name a '[Symbol.iterator]' method, which is only written as '[Symbol.iterator]'`, m.start, m.end);
          return;
        }
        const key = cloneOneOf2(m.name);
        if (typeof key === "string") return;
        if (isIteratorKey(key) && m.kind === "method") {
          rewrites.replaceTypeMember({ id: m.id }, { ...m, name: ITERATOR });
          return;
        }
        if (key.kind === "member" && key.object.kind === "ident" && key.object.name === "Symbol") return;
        try {
          const name = knownKey(key, (e) => leaf.read(e));
          if (name === ITERATOR) {
            failure = unknownKey(key, `'${name}' would name a '[Symbol.iterator]' method, which is only written as '[Symbol.iterator]'`);
            return;
          }
          rewrites.replaceTypeMember({ id: m.id }, withTypeMemberName(m, name));
        } catch (err) {
          if (err instanceof CompileError) failure = err;
        }
      }
    }
  });
  if (failure !== undefined) throw failure!;
  rebuiltStmts(program, rewrites);
}

function memberKeyExpr(n: Ref<AnyNode>): Expr | undefined {
  if (n.of === "classMember") {
    const m = n.node;
    if (m.kind !== "constructor" && m.kind !== "staticBlock" && m.kind !== "index") {
      const key = cloneOneOf2(m.name);
      if (typeof key !== "string") return key;
    }
  }
  if (n.of === "typeMember") {
    const m = n.node;
    if (m.kind === "property" || m.kind === "method" || m.kind === "get" || m.kind === "set") {
      const key = cloneOneOf2(m.name);
      if (typeof key !== "string") return key;
    }
  }
  return undefined;
}

// Refuses a class's or a type's member key, inside a function, that reads one of the function's
// own variables: the member is laid out with the program's top-level names, so a variable there
// shadowing a top-level const would otherwise be read past. Runs before local declarations are
// hoisted out of their functions.
/** @throws {CompileError} */
export function localKeys(program: Ref<Stmt[]>) {
  let failure: CompileError | undefined = undefined;
  for (const s of program) {
    const err = visitLocalKeys({ of: "stmt", node: s }, new Set<string>());
    if (err !== undefined) {
      failure = err;
      break;
    }
  }
  if (failure !== undefined) throw failure;
}

function visitLocalKeys(n: AnyNode, locals: Ref<Set<string>>): CompileError | undefined {
  let failure: CompileError | undefined = undefined;
  const key = memberKeyExpr(reborrowNode(n));
  if (key !== undefined) {
    walk({ of: "expr", node: key }, (k) => {
      if (failure !== undefined) return;
      if (k.of === "expr" && k.node.kind === "ident" && locals.has(k.node.name)) {
        failure = unknownKey(k.node, `'${k.node.name}' is a variable of the function around it; a class's or a type's member name can only read a top-level const or enum`);
      }
    });
  }
  if (failure !== undefined) return failure;
  const inner = bodied(reborrowNode(n)) ? new Set([...locals, ...declared(reborrowNode(n))]) : new Set([...locals]);
  forEachChild(n, (c) => {
    if (failure === undefined) failure = visitLocalKeys(c, inner);
  });
  return failure;
}

const bodied = (n: AnyNode): boolean =>
  (n.of === "stmt" && n.node.kind === "function") || (n.of === "expr" && (n.node.kind === "arrow" || n.node.kind === "function")) ||
  (n.of === "classMember" && ["method", "constructor", "get", "set"].includes(n.node.kind)) || (n.of === "objectProp" && ["method", "get", "set"].includes(n.node.kind));

// Every variable, parameter and nested function a body declares, at any depth.
function declared(n: AnyNode): string[] {
  let names: string[] = [];
  walk(n, (x) => {
    if (x.of === "pattern" && x.node.kind === "ident") names.push(x.node.name);
    if (x.of === "stmt" && x.node.kind === "function") names.push(x.node.name);
  });
  return names;
}

// A member of an enum whose values are written as literals, or counted on from one.
/** @throws {CompileError} */
function enumMember(node: Ref<Extract<Stmt, { kind: "enum" }>>, e: Ref<Extract<Expr, { kind: "member" }>>): string {
  if (node.typeParams.length > 0 || node.members.some((m) => m.payload !== undefined)) throw unknownKey(e, `'${node.name}' is an enum whose members hold values, not names`);
  let next: bigint | undefined = 0n;
  for (const m of node.members) {
    const value: bigint | string | undefined = m.init === undefined ? next : m.init.kind === "int" || m.init.kind === "string" ? m.init.value : m.init.kind === "unary" && m.init.op === "-" && m.init.operand.kind === "int" ? -m.init.operand.value : undefined;
    if (value === undefined) throw unknownKey(e, `'${node.name}.${m.name}' is computed, so its value isn't known before the class or type is laid out`);
    if (m.name === e.name) return typeof value === "string" ? value : `${value}`;
    next = typeof value === "bigint" ? value + 1n : undefined;
  }
  throw new CompileError("E0502", `property '${e.name}' does not exist on type 'typeof ${node.name}'`, e.start, e.end);
}
