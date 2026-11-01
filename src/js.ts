import { CompileError } from "./diag.ts";
import type { ClassNode, Interface, JsName, Param, Span, Stmt, TypeMember, TypeNode } from "./parser.ts";
import type { Declared } from "./typings.ts";
import { nextId, renumber, walk, type Ids } from "./nodes.ts";

export type { JsName };

// Types a declaration file writes that Fish has under another name: TypeScript's one number
// type is an f64, and a value it leaves untyped is an opaque JS handle.
const LOWERED: Record<string, string> = { number: "f64", any: "JsValue", unknown: "JsValue", object: "JsValue" };

const KINDS: Partial<Record<Stmt["kind"], string>> = { enum: "an enum", namespace: "a namespace" };

// The declaration a name stands for, as a statement of the program: a copy of it under that name,
// its types lowered to Fish's and marked as JS. A function stays one, a const becomes a function
// read as a value, an interface or an object type alias a JS handle's shape, and a class the
// shape of its instances with its constructors and statics. Its spans stay those of its file.
export function jsDeclaration(ids: Ids, declared: Declared, name: string, specifier: string, pkg: usize, at: Span, exported: string = name): Stmt {
  const d = unwrap(renumber("stmt", structuredClone(declared.at), () => nextId(ids)));
  const js: JsName = { module: specifier, package: pkg, name: exported };
  lowerTypes(d);
  switch (d.kind) {
    case "function":
      return Object.assign(d, { name, body: undefined, js });
    case "let": {
      const one = d.declarations.find((x) => x.target.kind === "ident" && x.target.name === name) ?? d.declarations[0]!;
      const type: TypeNode = one.type ?? { id: nextId(ids), kind: "ref", name: "JsValue", args: [], start: d.start, end: d.end };
      return { id: nextId(ids), kind: "function", name, async: false, generator: false, macro: false, typeParams: [], params: [], returnType: type, body: undefined, js: { ...js, const: true }, start: one.start, end: one.end };
    }
    case "interface": {
      // Every declaration of the interface where it is declared adds to it, as TypeScript
      // merges them.
      const merged = declared.scope.flatMap((x) => {
        const u = unwrap(x);
        return u !== unwrap(declared.at) && u.kind === "interface" && u.name === d.name ? unwrap(renumber("stmt", structuredClone(x), () => nextId(ids))) : [];
      }) as Interface[];
      merged.forEach(lowerTypes);
      return Object.assign(d, { name, js, jsSource: declared.at, members: shapeMembers(ids, [...d.members, ...merged.flatMap((m) => m.members)]) });
    }
    case "typeAlias":
      return Object.assign(d, { name, js });
    case "class":
      return Object.assign(classShape(ids, d, name, js), { jsSource: declared.at });
    default:
      throw new CompileError(`'${name}' from '${specifier}' is ${KINDS[d.kind] ?? "a declaration"}, which can't be imported from a package yet`, at.start, at.end);
  }
}

// The other signatures of a function declared more than once, each as a function of its own,
// named apart; the first declared is `name`'s, which lists them, as a call tries them in order.
export function jsOverloads(ids: Ids, declared: Declared, made: Stmt, name: string, specifier: string, pkg: usize): Stmt[] {
  const first = unwrap(declared.at);
  if (first.kind !== "function" || made.kind !== "function") return [];
  const others = declared.scope.filter((s) => s !== declared.at && unwrap(s).kind === "function" && (unwrap(s) as { name: string }).name === first.name);
  const signatures = others.map((s, i) => {
    const d = unwrap(renumber("stmt", structuredClone(s), () => nextId(ids))) as Extract<Stmt, { kind: "function" }>;
    lowerTypes(d);
    return Object.assign(d, { name: `${name} signature ${i + 2}`, body: undefined, js: { module: specifier, package: pkg, name } });
  });
  if (others.length > 0) made.js = { ...made.js!, overloads: signatures };
  return signatures;
}

// An interface's members as a shape's: an accessor a property, read-only unless it has a setter;
// a method declared with several signatures by its first; one marked optional as any other.
// ponytail: an absent optional method throws in JS when called; `?.()` on handles would check
function shapeMembers(ids: Ids, members: TypeMember[]): TypeMember[] {
  const seen = new Set<string>();
  return members.flatMap((m): TypeMember[] => {
    const name = "name" in m && typeof m.name === "string" ? m.name : undefined;
    if (m.kind === "set") return [];
    if (name !== undefined && seen.has(name)) return [];
    if (name !== undefined) seen.add(name);
    if (m.kind === "get") {
      const settable = members.some((x) => x.kind === "set" && x.name === name);
      return [{ id: nextId(ids), kind: "property", name: m.name, optional: false, readonly: !settable, type: m.returns ?? { id: nextId(ids), kind: "ref", name: "JsValue", args: [], start: m.start, end: m.end }, start: m.start, end: m.end }];
    }
    return [m.kind === "method" && m.optional ? { ...m, id: nextId(ids), optional: false } : m];
  });
}

// A class as the shape of its instances: its public fields, accessors and methods; its
// constructors' parameters and its static members kept beside them.
function classShape(ids: Ids, c: ClassNode, name: string, js: JsName): Interface {
  const members: TypeMember[] = [];
  const statics: TypeMember[] = [];
  const constructors: Param[][] = [];
  const untyped = (at: Span): TypeNode => ({ id: nextId(ids), kind: "ref", name: "JsValue", args: [], start: at.start, end: at.end });
  for (const m of c.members) {
    const hidden = m.modifiers.includes("private") || m.modifiers.includes("protected") || (typeof (m as { name?: unknown }).name === "string" && ((m as { name: string }).name).startsWith("#"));
    if (hidden) continue;
    const into = m.modifiers.includes("static") ? statics : members;
    const known = (n: unknown) => into.some((x) => "name" in x && x.name === n);
    if (m.kind === "constructor") constructors.push(m.params);
    else if (m.kind === "field") into.push({ id: nextId(ids), kind: "property", name: m.name, optional: m.optional, readonly: m.modifiers.includes("readonly"), type: m.type ?? untyped(m), start: m.start, end: m.end });
    else if (m.kind === "method" && !known(m.name)) into.push({ id: nextId(ids), kind: "method", name: m.name, optional: false, typeParams: m.typeParams, params: m.params, returns: m.returnType ?? untyped(m), start: m.start, end: m.end });
    else if (m.kind === "get" && !known(m.name)) {
      const settable = c.members.some((x) => x.kind === "set" && x.name === m.name);
      into.push({ id: nextId(ids), kind: "property", name: m.name, optional: false, readonly: !settable, type: m.returnType ?? untyped(m), start: m.start, end: m.end });
    }
  }
  // A base class's instances' members are its instances' too, as an interface extends another.
  const base = c.extends?.kind === "instantiation" ? c.extends.expr : c.extends;
  const typeArgs = c.extends?.kind === "instantiation" ? c.extends.typeArgs : [];
  const extended: TypeNode[] = base?.kind === "ident" ? [{ id: nextId(ids), kind: "ref", name: base.name, args: typeArgs, start: base.start, end: base.end }] : [];
  return { id: nextId(ids), kind: "interface", name, typeParams: c.typeParams, extends: extended, members, js, jsClass: { constructors, statics }, start: c.start, end: c.end };
}

function unwrap(s: Stmt): Stmt {
  return s.kind === "declare" || s.kind === "export" ? unwrap(s.body) : s;
}

// Renames the types a declaration names that Fish calls something else. Only type nodes are
// `ref`s, so every one in the declaration is a type it names.
function lowerTypes(declaration: Stmt) {
  walk("stmt", declaration, ({ of, node: n }) => {
    if (of === "typeNode" && n.kind === "ref" && Object.hasOwn(LOWERED, n.name)) n.name = LOWERED[n.name]!;
  });
}

// The type names a declaration refers to, which the program needs declared beside it.
export function referenced(declarations: Stmt[]): Set<string> {
  const found = new Set<string>();
  walk("stmt", declarations, ({ of, node: n }) => {
    if (of === "typeNode" && n.kind === "ref") found.add(n.name.split(".")[0]!);
  });
  return found;
}
