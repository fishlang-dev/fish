import { CompileError } from "./diag.ts";
import type { ClassNode, Interface, JsName, Param, Span, Stmt, TypeMember, TypeNode } from "./parser.ts";
import type { Declared } from "./typings.ts";

export type { JsName };

// Types a declaration file writes that Fish has under another name: TypeScript's one number
// type is an f64, and a value it leaves untyped is an opaque JS handle.
const LOWERED: Record<string, string> = { number: "f64", any: "JsValue", unknown: "JsValue", object: "JsValue" };

const KINDS: Partial<Record<Stmt["kind"], string>> = { enum: "an enum", namespace: "a namespace" };

// The declaration a name stands for, as a statement of the program: a copy of it under that name,
// its types lowered to Fish's and marked as JS. A function stays one, a const becomes a function
// read as a value, an interface or an object type alias a JS handle's shape, and a class the
// shape of its instances with its constructors and statics. Its spans stay those of its file.
export function jsDeclaration(declared: Declared, name: string, specifier: string, at: Span, exported = name): Stmt {
  const d = unwrap(structuredClone(declared.at));
  const js: JsName = { module: specifier, name: exported };
  lowerTypes(d);
  switch (d.kind) {
    case "function":
      return Object.assign(d, { name, body: undefined, js });
    case "let": {
      const one = d.declarations.find((x) => x.target.kind === "ident" && x.target.name === name) ?? d.declarations[0]!;
      const type: TypeNode = one.type ?? { kind: "ref", name: "JsValue", args: [], start: d.start, end: d.end };
      return { kind: "function", name, async: false, generator: false, macro: false, typeParams: [], params: [], returnType: type, body: undefined, js: { ...js, const: true }, start: one.start, end: one.end };
    }
    case "interface":
      return Object.assign(d, { name, js, members: d.members.map(plainMethod) });
    case "typeAlias":
      return Object.assign(d, { name, js });
    case "class":
      return classShape(d, name, js);
    default:
      throw new CompileError(`'${name}' from '${specifier}' is ${KINDS[d.kind] ?? "a declaration"}, which can't be imported from a package yet`, at.start, at.end);
  }
}

// The other signatures of a function declared more than once, each as a function of its own,
// named apart; the first declared is `name`'s, which lists them, as a call tries them in order.
export function jsOverloads(declared: Declared, made: Stmt, name: string, specifier: string): Stmt[] {
  const first = unwrap(declared.at);
  if (first.kind !== "function" || made.kind !== "function") return [];
  const others = declared.scope.filter((s) => s !== declared.at && unwrap(s).kind === "function" && (unwrap(s) as { name: string }).name === first.name);
  const named = others.map((_, i) => `${name} signature ${i + 2}`);
  if (others.length > 0) made.js = { ...made.js!, overloads: named };
  return others.map((s, i) => {
    const d = unwrap(structuredClone(s)) as Extract<Stmt, { kind: "function" }>;
    lowerTypes(d);
    return Object.assign(d, { name: named[i]!, body: undefined, js: { module: specifier, name } });
  });
}

// A JS method a declaration marks optional is called as any other.
// ponytail: an absent optional method throws in JS when called; `?.()` on handles would check
function plainMethod(m: TypeMember): TypeMember {
  return m.kind === "method" && m.optional ? { ...m, optional: false } : m;
}

// A class as the shape of its instances: its public fields, accessors and methods; its
// constructors' parameters and its static members kept beside them.
function classShape(c: ClassNode, name: string, js: JsName): Interface {
  const members: TypeMember[] = [];
  const statics: TypeMember[] = [];
  const constructors: Param[][] = [];
  const untyped = (at: Span): TypeNode => ({ kind: "ref", name: "JsValue", args: [], start: at.start, end: at.end });
  for (const m of c.members) {
    const hidden = m.modifiers.includes("private") || m.modifiers.includes("protected") || (typeof (m as { name?: unknown }).name === "string" && ((m as { name: string }).name).startsWith("#"));
    if (hidden) continue;
    const into = m.modifiers.includes("static") ? statics : members;
    const known = (n: unknown) => into.some((x) => "name" in x && x.name === n);
    if (m.kind === "constructor") constructors.push(m.params);
    else if (m.kind === "field") into.push({ kind: "property", name: m.name, optional: m.optional, readonly: m.modifiers.includes("readonly"), type: m.type ?? untyped(m), start: m.start, end: m.end });
    else if (m.kind === "method" && !known(m.name)) into.push({ kind: "method", name: m.name, optional: false, typeParams: m.typeParams, params: m.params, returns: m.returnType ?? untyped(m), start: m.start, end: m.end });
    else if (m.kind === "get" && !known(m.name)) {
      const settable = c.members.some((x) => x.kind === "set" && x.name === m.name);
      into.push({ kind: "property", name: m.name, optional: false, readonly: !settable, type: m.returnType ?? untyped(m), start: m.start, end: m.end });
    }
  }
  return { kind: "interface", name, typeParams: c.typeParams, extends: [], members, js, jsClass: { constructors, statics }, start: c.start, end: c.end };
}

function unwrap(s: Stmt): Stmt {
  return s.kind === "declare" || s.kind === "export" ? unwrap(s.body) : s;
}

// Renames the types a declaration names that Fish calls something else. Only type nodes are
// `ref`s, so every one in the declaration is a type it names.
function lowerTypes(node: unknown) {
  if (Array.isArray(node)) return node.forEach(lowerTypes);
  if (typeof node !== "object" || node === null) return;
  const n = node as { kind?: unknown; name?: unknown; args?: unknown };
  if (n.kind === "ref" && typeof n.name === "string" && Array.isArray(n.args) && Object.hasOwn(LOWERED, n.name)) n.name = LOWERED[n.name];
  Object.values(node).forEach(lowerTypes);
}

// The type names a declaration refers to, which the program needs declared beside it.
export function referenced(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    node.forEach((x) => referenced(x, found));
    return found;
  }
  if (typeof node !== "object" || node === null) return found;
  const n = node as { kind?: unknown; name?: unknown; args?: unknown };
  if (n.kind === "ref" && typeof n.name === "string" && Array.isArray(n.args)) found.add(n.name.split(".")[0]!);
  Object.values(node).forEach((x) => referenced(x, found));
  return found;
}
