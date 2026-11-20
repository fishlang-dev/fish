import { CompileError } from "./diag.fsh";
import type { ClassMember, ClassNode, Declarator, Expr, Func, Interface, JsName, Param, PropertyName, Span, Stmt, TypeMember, TypeNode } from "./parser.fsh";
import type { Declared } from "./typings.fsh";
import { nextId, renumberStmt, Rewrites, walk, type Ids } from "./nodes.fsh";
import { cloneExpr, cloneParam, cloneStmt, cloneTypeNode, cloneTypeParam, rebuiltStmt } from "./rebuild.fsh";

export type { JsName };

// Types a declaration file writes that Fish has under another name: TypeScript's one number
// type is an f64, and a value it leaves untyped is an opaque JS handle.
const LOWERED = new Map<string, string>([["number", "f64"], ["any", "JsValue"], ["unknown", "JsValue"], ["object", "JsValue"]]);

function kindShown(kind: string): string {
  return kind === "enum" ? "an enum" : kind === "namespace" ? "a namespace" : "a declaration";
}

// The declaration a name stands for, as a statement of the program: a copy of it under that name,
// its types lowered to Fish's and marked as JS. A function stays one, a const becomes a function
// read as a value, an interface or an object type alias a JS handle's shape, and a class the
// shape of its instances with its constructors and statics. Its spans stay those of its file.
/** @throws {CompileError} */
export function jsDeclaration(ids: Mut<Ids>, declared: Ref<Declared>, scope: Ref<Stmt[]>, name: string, specifier: string, pkg: usize, at: Ref<Span>, exported: string = name): Stmt {
  const d = lowerTypes(copied(ids, declared.at));
  const js: JsName = { module: specifier, package: pkg, name: exported };
  switch (d.kind) {
    case "function":
      return { ...d, name, body: undefined, js };
    case "let": {
      const found = d.declarations.findIndex((x) => x.target.kind === "ident" && x.target.name === name);
      const one: Ref<Declarator> = d.declarations[found >= 0 ? (found as usize) : 0]!;
      const type: TypeNode = one.type !== undefined ? cloneTypeNode(one.type) : { id: nextId(ids), kind: "ref", name: "JsValue", args: [], start: d.start, end: d.end };
      const read: JsName = { module: specifier, package: pkg, name: exported, const: true };
      return { id: nextId(ids), kind: "function", name, async: false, generator: false, macro: false, typeParams: [], params: [], returnType: type, body: undefined, js: read, start: one.start, end: one.end };
    }
    case "interface": {
      // Every declaration of the interface where it is declared adds to it, as TypeScript
      // merges them.
      const first = unwrapped(declared.at).id;
      let members: TypeMember[] = [...d.members];
      for (const x of scope) {
        const u = unwrapped(x);
        if (u.id === first || u.kind !== "interface" || u.name !== d.name) continue;
        const other = lowerTypes(copied(ids, x));
        if (other.kind === "interface") members = members.concat(other.members);
      }
      const shape: Interface = { ...d, name, js, jsSource: cloneStmt(declared.at), members: shapeMembers(ids, members) };
      return shape;
    }
    case "typeAlias":
      return { ...d, name, js };
    case "class": {
      const shape: Interface = { ...classShape(ids, d, name, js), jsSource: cloneStmt(declared.at) };
      return shape;
    }
    default:
      throw new CompileError("E1005", `'${name}' from '${specifier}' is ${kindShown(d.kind)}, which can't be imported from a package yet`, at.start, at.end);
  }
}

// The other signatures of a function declared more than once, each as a function of its own,
// named apart; the first declared is `name`'s, which lists them, as a call tries them in order.
export function jsOverloads(ids: Mut<Ids>, declared: Ref<Declared>, scope: Ref<Stmt[]>, made: Ref<Stmt>, name: string, specifier: string, pkg: usize): Func[] {
  const first = unwrapped(declared.at);
  if (first.kind !== "function" || made.kind !== "function") return [];
  const firstId = first.id;
  const firstName = first.name;
  let signatures: Func[] = [];
  for (const s of scope) {
    const u = unwrapped(s);
    if (u.id === firstId || u.kind !== "function" || u.name !== firstName) continue;
    const d = lowerTypes(copied(ids, s));
    if (d.kind !== "function") continue;
    signatures.push({ ...d, name: `${name} signature ${signatures.length + 2}`, body: undefined, js: { module: specifier, package: pkg, name } });
  }
  return signatures;
}

// A member's name, when it is written as one rather than computed.
function memberName(m: Ref<TypeMember>): string | undefined {
  if (m.kind === "property" || m.kind === "method" || m.kind === "get" || m.kind === "set") {
    const name: Ref<PropertyName> = m.name;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
}

function classMemberName(m: Ref<ClassMember>): string | undefined {
  if (m.kind === "field" || m.kind === "method" || m.kind === "get" || m.kind === "set") {
    const name: Ref<PropertyName> = m.name;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
}

function nameCopy(n: Ref<PropertyName>): PropertyName {
  return typeof n === "string" ? n : cloneExpr(n);
}

function untyped(ids: Mut<Ids>, at: Ref<Span>): TypeNode {
  return { id: nextId(ids), kind: "ref", name: "JsValue", args: [], start: at.start, end: at.end };
}

// An interface's members as a shape's: an accessor a property, read-only unless it has a setter;
// a method declared with several signatures by its first; one marked optional as any other.
// ponytail: an absent optional method throws in JS when called; `?.()` on handles would check
function shapeMembers(ids: Mut<Ids>, members: TypeMember[]): TypeMember[] {
  let setters = new Set<string>();
  for (const m of members) {
    const name = memberName(m);
    if (m.kind === "set" && name !== undefined) setters.add(name);
  }
  let seen = new Set<string>();
  let out: TypeMember[] = [];
  while (members.length > 0) {
    const m = members.shift()!;
    const name = memberName(m);
    if (m.kind === "set") continue;
    if (name !== undefined && seen.has(name)) continue;
    if (name !== undefined) seen.add(name);
    if (m.kind === "get") {
      const span = { start: m.start, end: m.end };
      const type = m.returns ?? untyped(ids, span);
      out.push({ id: nextId(ids), kind: "property", name: m.name, optional: false, readonly: name === undefined || !setters.has(name), type, start: m.start, end: m.end });
    } else if (m.kind === "method" && m.optional) out.push({ ...m, id: nextId(ids), optional: false });
    else out.push(m);
  }
  return out;
}

function hasMember(members: Ref<TypeMember[]>, name: string): boolean {
  return members.some((x) => memberName(x) === name);
}

// A class as the shape of its instances: its public fields, accessors and methods; its
// constructors' parameters and its static members kept beside them.
function classShape(ids: Mut<Ids>, c: Ref<ClassNode>, name: string, js: JsName): Interface {
  let members: TypeMember[] = [];
  let statics: TypeMember[] = [];
  let constructors: Param[][] = [];
  let setters = new Set<string>();
  for (const m of c.members) {
    const named = classMemberName(m);
    if (m.kind === "set" && named !== undefined) setters.add(named);
  }
  for (const m of c.members) {
    const named = classMemberName(m);
    const hidden = m.modifiers.includes("private") || m.modifiers.includes("protected") || (named !== undefined && named.startsWith("#"));
    if (hidden) continue;
    const isStatic = m.modifiers.includes("static");
    const known = named !== undefined && (isStatic ? hasMember(statics, named) : hasMember(members, named));
    let made: TypeMember | undefined = undefined;
    if (m.kind === "constructor") constructors.push(m.params.map((p) => cloneParam(p)));
    else if (m.kind === "field") made = { id: nextId(ids), kind: "property", name: nameCopy(m.name), optional: m.optional, readonly: m.modifiers.includes("readonly"), type: m.type !== undefined ? cloneTypeNode(m.type) : untyped(ids, m), start: m.start, end: m.end };
    else if (m.kind === "method" && !known) made = { id: nextId(ids), kind: "method", name: nameCopy(m.name), optional: false, typeParams: m.typeParams.map((p) => cloneTypeParam(p)), params: m.params.map((p) => cloneParam(p)), returns: m.returnType !== undefined ? cloneTypeNode(m.returnType) : untyped(ids, m), start: m.start, end: m.end };
    else if (m.kind === "get" && !known) {
      const settable = named !== undefined && setters.has(named);
      made = { id: nextId(ids), kind: "property", name: nameCopy(m.name), optional: false, readonly: !settable, type: m.returnType !== undefined ? cloneTypeNode(m.returnType) : untyped(ids, m), start: m.start, end: m.end };
    }
    if (made === undefined) continue;
    if (isStatic) statics.push(made);
    else members.push(made);
  }
  // A base class's instances' members are its instances' too, as an interface extends another.
  let extended: TypeNode[] = [];
  const written: Ref<Expr | undefined> = c.extends;
  if (written !== undefined) {
    const base: Ref<Expr> = written.kind === "instantiation" ? written.expr : written;
    const typeArgs: TypeNode[] = written.kind === "instantiation" ? written.typeArgs.map((t) => cloneTypeNode(t)) : [];
    if (base.kind === "ident") extended.push({ id: nextId(ids), kind: "ref", name: base.name, args: typeArgs, start: base.start, end: base.end });
  }
  return { id: nextId(ids), kind: "interface", name, typeParams: c.typeParams.map((p) => cloneTypeParam(p)), extends: extended, members, js, jsClass: { constructors, statics }, start: c.start, end: c.end };
}

// A copy of a declaration, numbered anew, without its `declare` or `export`.
function copied(ids: Mut<Ids>, s: Ref<Stmt>): Stmt {
  return unwrap(renumberStmt(cloneStmt(s), () => nextId(ids)));
}

function unwrap(s: Stmt): Stmt {
  if (s.kind === "declare") return unwrap(s.body);
  if (s.kind === "export") return unwrap(s.body);
  return s;
}

function unwrapped(s: Ref<Stmt>): Ref<Stmt> {
  if (s.kind === "declare") return unwrapped(s.body);
  if (s.kind === "export") return unwrapped(s.body);
  return s;
}

// Renames the types a declaration names that Fish calls something else. Only type nodes are
// `ref`s, so every one in the declaration is a type it names.
function lowerTypes(declaration: Stmt): Stmt {
  let rewrites = new Rewrites();
  walk({ of: "stmt", node: declaration }, (n) => {
    if (n.of !== "typeNode" || n.node.kind !== "ref") return;
    const lowered = LOWERED.get(n.node.name);
    if (lowered !== undefined) rewrites.replaceTypeNode(n.node, { id: n.node.id, kind: "ref", name: lowered, args: n.node.args.map((a) => cloneTypeNode(a)), start: n.node.start, end: n.node.end });
  });
  return rebuiltStmt(declaration, rewrites);
}

// The type names a declaration refers to, which the program needs declared beside it.
export function referenced(declarations: Ref<Stmt[]>): Set<string> {
  let found = new Set<string>();
  walk({ of: "stmts", node: declarations }, (n) => {
    if (n.of === "typeNode" && n.node.kind === "ref") found.add(n.node.name.split(".")[0]!);
  });
  return found;
}
