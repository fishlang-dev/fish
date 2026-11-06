import assert from "node:assert";
import type { Tables } from "./compilation.ts";
import { CompileError } from "./diag.ts";
import type { RustName } from "./rust.ts";
import type { ClassMember, ClassNode, Expr, Id, JsName, Param, Pattern, Span, Stmt, TypeNode, TypeParam } from "./parser.ts";
import { cloneClassNode, cloneExpr, cloneJsName, cloneParam, cloneStmt, cloneTypeNode, cloneTypeParam, rebuiltParam, rebuiltStmts, rebuiltTypeNode } from "./rebuild.ts";
import { EMBEDDED, MAP_METHODS, SET_METHODS, type Access, type ClassType, type FunctionType, type Type, type Typing } from "./typing.ts";
import { unsupported } from "./unsupported.ts";
import { symbolKey } from "./keys.ts";
import type { Arenas, BodyId, ClassId, InstanceId } from "./arenas.ts";
import { forEachChild, nextId, NodeSet, renumberParam, renumberStmts, renumberTypeNode, Rewrites, walk, walkWhile, type AnyNode, type Ids } from "./nodes.ts";

// A function to compile: a top-level function, a static method, or a class's constructor or
// instance method, which gets its instance as `this` through a pointer. Only a constructor
// and a method declared with `this: Mut<this>` may change it.
export type Body = Span & Id & {
  // Its place in the compilation's arena, apart from its node id.
  bodyId: BodyId;
  name: string;
  params: Param[];
  body: Stmt[];
  returnType: TypeNode | undefined;
  // The error type a `throws` clause declares.
  throws?: TypeNode;
  // Whether it is a `function*`, whose call makes a generator.
  generator?: boolean;
  // Whether it is an `async function`, whose call makes a future.
  async?: boolean;
  // Whether it is a C function a `declare function` names, which has no body here.
  foreign?: boolean;
  // A package's function, or a const read as one, typed from its declaration.
  js?: JsName;
  // A Rust function, a foreign one called through the shim generated for its crate.
  rust?: RustName;
  // Whether an `export` names it, so a library builds it into a C function too.
  exported?: boolean;
  // A top-level `const`, as a function giving its value, or a `comptime { }` block, as one giving
  // nothing: each run while compiling, never compiled.
  comptime?: "const" | "block";
  // A generic function's type parameters; each set of type arguments gets its own instance.
  typeParams?: TypeParam[];
  // An accessor's parameter is the property's type, so it is never generic.
  accessor?: boolean;
  // For a member of a generic class's instance: what the class's type parameters stand for.
  scope?: Map<string, Type>;
  // `owned`: a method declared `this: Own<this>` takes its object over.
  self?: { type: ClassType; constructor: boolean; mutable: boolean; owned?: boolean };
  // An overloaded function's signatures, in the order a call tries them.
  overloads?: BodyId[];
  overloadNames?: string[];
  // A signature of an overloaded function, whose body calls the implementation.
  signature?: true;
  // For a class's constructor and methods: the class, and who may call the method.
  owner?: ClassType;
  access?: Access;
  // A member declared `abstract`: a signature with an empty body, which a template is checked
  // against but which is never compiled.
  abstract?: true;
  // An abstract class's member that reaches an abstract member: checked once against the abstract
  // class but never compiled itself, and copied into each concrete class that embeds it.
  template?: true;
  // Such a copy: the member it copies, and the class it was written in, whose access rules it keeps.
  copyOf?: BodyId;
  declared?: ClassType;
  // An arrow function's body, checked inside the instance it is written in. An expression body
  // is a `return` of it, `value`.
  // `expected`, the function type it is given to, types parameters it leaves unwritten.
  // `move`: it captures everything by value.
  // A nested function's closure knows its own name, which its body calls itself by.
  // `made`: the checker wrote it around a function given as a value or a timer's callback.
  closure?: { value?: Expr; parent: InstanceId; expected?: FunctionType; move: boolean; unsafe?: boolean; self?: string; made?: true };
};

// A type parameter bounded by `Lifetime` names a lifetime, which is checked and erased rather
// than instantiated.
export function isLifetime(p: Ref<TypeParam>): boolean {
  return p.constraint !== undefined && p.constraint.kind === "ref" && p.constraint.name === "Lifetime" && p.constraint.args.length === 0;
}

// A field as declared: its annotation, its initializer, or both give its type.
// `written` is an optional field's type as written, before `?` made it nullable.
// `written`: an optional field's type before `?` made it nullable; `undefinedSpelled`: a field
// written `T | undefined`.
export type FieldDecl = Span & { name: string; type: TypeNode | undefined; init: Expr | undefined; access: Access; readonly: boolean; written?: TypeNode; undefinedSpelled?: true };

// A member written `override`, by its name and whether it is static.
export type Overridden = Span & { name: string; static: boolean };

// A member an abstract class declares without a body, for each concrete class to implement.
export type AbstractMember = Span & { name: string; table: "methods" | "getters" | "setters"; access: Access };

export type ClassInfo = {
  classId: ClassId;
  type: ClassType;
  abstracts: AbstractMember[];
  // For a concrete class, its copy of each template it runs, by the template.
  copies: Map<BodyId, BodyId>;
  fields: FieldDecl[];
  // Its body starts by assigning the field initializers, then the parameter properties.
  constructor: BodyId;
  // Every field, each unset until a constructor statement assigns it; until then `this` may
  // only appear as the target of such an assignment.
  required: Set<string>;
  // The prelude's field initializers, which can't see the constructor's parameters.
  initializers: NodeSet<Stmt>;
  methods: Map<string, BodyId>;
  // Static methods by name, and static accessors as `get x` and `set x`, none with a `this`.
  statics: Map<string, BodyId>;
  // Each `static readonly` field, a top-level const named `C.x` computed while compiling.
  staticFields: Map<string, FieldDecl>;
  // A getter borrows `this` and returns a value; a setter takes `Mut<this>` and the value.
  getters: Map<string, BodyId>;
  setters: Map<string, BodyId>;
  // The members written `override`, each checked to replace one its bases have.
  overrides: Overridden[];
  // The class this one embeds and delegates to, named by `extends`.
  baseName: string | undefined;
  // A Map or Set named by `extends`, held in the field `EMBEDDED`, which members the class and
  // its bases don't declare are delegated to.
  embedded?: "Map" | "Set";
  base?: ClassId;
  // The initializers and parameter properties a derived constructor runs after `super(...)`.
  prelude: Stmt[];
  // For each `From<X>` it implements, X, the static `from` that wraps one, and its parameter's type.
  wraps: [Type, BodyId, Type][];
  node: ClassNode;
  // For an instance of a generic class: what its type parameters stand for.
  scope: Map<string, Type>;
  // For a class that extends another: the program's types its own type parameters hide.
  globals?: Map<string, Type>;
};

// Collects a class declaration's fields and builds the constructor it compiles to. A generic
// class is declared once per set of type arguments, under a name like `Box<i64>`, with
// `scope` saying what its type parameters stand for.
// What declaring one class gathers as it goes through its members. `shared` says a generic
// class's statics were declared by an earlier instance, which every instance shares.
type Declaring = {
  name: string;
  scope: Map<string, Type>;
  type: ClassType;
  shared: boolean;
  fields: FieldDecl[];
  abstracts: AbstractMember[];
  methods: Map<string, BodyId>;
  statics: Map<string, BodyId>;
  staticFields: Map<string, FieldDecl>;
  getters: Map<string, BodyId>;
  setters: Map<string, BodyId>;
};

/** @throws {CompileError} */
export function declareClass(tables: Mut<Tables>, node: Ref<ClassNode & { name: string }>, name: string = node.name, scope: Map<string, Type> = new Map<string, Type>()): ClassInfo {
  if (node.decorators.length > 0) throw unsupported("decorators", node.decorators[0]!);
  // A template is copied into each concrete class by the abstract class's one declaration, which a
  // generic class doesn't have.
  if (node.abstract && node.typeParams.length > 0) throw unsupported("generic abstract classes", { start: node.start, end: node.end });
  if (node.extends !== undefined && node.extends.kind !== "ident" && !(node.extends.kind === "instantiation" && node.extends.expr.kind === "ident")) {
    throw unsupported("base class expressions", { start: node.extends.start, end: node.extends.end });
  }
  let constructors: Extract<ClassMember, { kind: "constructor" }>[] = [];
  for (const m of node.members) if (m.kind === "constructor") constructors.push({ ...m });
  const ctor = constructors.length > 0 ? constructors[0] : undefined;
  if (ctor !== undefined && ctor.body === undefined && constructors.length > 1) throw unsupported("constructor overloads", { start: ctor.start, end: ctor.end });
  if (constructors.length > 1) throw new CompileError("E0703", "a class can have only one constructor", constructors[1]!.start, constructors[1]!.end);
  if (ctor !== undefined && ctor.body === undefined) throw unsupported("constructor overloads", { start: ctor.start, end: ctor.end });

  const type = tables.typing.classType(name, scope.size > 0 ? { name: node.name, args: [...scope.values()] } : undefined);
  if (node.abstract) {
    let r = tables.typing.rec(type);
    r.abstract = true;
    tables.typing.setRec(type, r);
  }
  // A generic class's statics can't use its type parameters, so every instance shares one set.
  const shared = node.typeParams.length > 0 ? tables.genericStatics.get(node) : undefined;
  let d: Declaring = { name, scope, type, shared: shared !== undefined, fields: [], abstracts: [], methods: new Map(), statics: shared !== undefined ? shared : new Map(), staticFields: new Map(), getters: new Map(), setters: new Map() };
  for (const m of node.members) {
    if (m.kind === "constructor") continue;
    if ("modifiers" in m && m.modifiers.includes("abstract")) {
      abstractMember(tables, node, d, m);
      continue;
    }
    if (m.kind === "method") {
      method(tables, node, d, m);
      continue;
    }
    if (m.kind === "get" || m.kind === "set") {
      accessor(tables, node, d, m);
      continue;
    }
    if (m.kind !== "field") throw unsupported(memberForm(m.kind), { start: m.start, end: m.end });
    if (typeof m.name !== "string") throw symbolKey(m.name);
    if (m.modifiers.includes("static")) {
      staticField(node, d, m, m.name);
      continue;
    }
    const access = modifiers(m.modifiers, m, m.name);
    if (m.definite) throw unsupported("definite assignment assertions", { start: m.start, end: m.end });
    if (m.type === undefined && m.init === undefined) throw new CompileError("E0104", `property '${m.name}' implicitly has an 'any' type; add a type annotation`, m.start, m.end);
    // An optional field is an Option, empty until assigned.
    add(d, fieldOf(tables.ids, m.name, m.type, m.optional, m.optional ? (m.init !== undefined ? cloneExpr(m.init) : { id: nextId(tables.ids), kind: "null", start: m.start, end: m.end }) : m.init !== undefined ? cloneExpr(m.init) : undefined, access, m.modifiers.includes("readonly"), m));
  }
  if (node.typeParams.length > 0 && shared === undefined) tables.genericStatics.set(cloneClassNode(node), new Map([...d.statics]));
  let properties: FieldDecl[] = [];
  if (ctor !== undefined) {
    for (const p of ctor.params) {
      if (p.modifiers.length === 0) continue;
      if (p.pattern.kind !== "ident") throw unsupported("destructuring patterns", { start: p.pattern.start, end: p.pattern.end });
      const access = modifiers(p.modifiers, p, p.pattern.name);
      // An optional parameter property is an Option, as the parameter is.
      const f = fieldOf(tables.ids, p.pattern.name, p.type, p.optional, undefined, access, p.modifiers.includes("readonly"), p);
      add(d, cloneFieldDecl(f));
      properties.push(f);
    }
  }

  for (const [field, f] of d.staticFields) {
    if (d.statics.has(field) || d.statics.has(`get ${field}`) || d.statics.has(`set ${field}`)) throw new CompileError("E0402", `duplicate property '${field}'`, f.start, f.end);
  }
  for (const key of d.statics.keys()) {
    const found = /^[gs]et (.*)$/.exec(key);
    const accessorName = found !== null ? found[1] : undefined;
    if (accessorName !== undefined && d.statics.has(accessorName)) {
      const m = tables.arenas.bodyOf(d.statics.get(accessorName)!);
      throw new CompileError("E0402", `duplicate property '${accessorName}'`, m.start, m.end);
    }
  }
  for (const member of [...d.methods.keys(), ...d.getters.keys(), ...d.setters.keys()]) {
    const clash = d.fields.find((f) => f.name === member);
    if (clash !== undefined) throw new CompileError("E0402", `duplicate property '${member}'`, clash.start, clash.end);
    if (d.methods.has(member) && (d.getters.has(member) || d.setters.has(member))) {
      const m = tables.arenas.bodyOf(d.methods.get(member)!);
      throw new CompileError("E0402", `duplicate property '${member}'`, m.start, m.end);
    }
  }
  // An abstract accessor's pair must be abstract too, as in TypeScript.
  for (const a of d.abstracts) {
    const pair = tables.arenas.bodyOf(a.table === "getters" ? d.setters.get(a.name) : a.table === "setters" ? d.getters.get(a.name) : undefined);
    if (pair !== undefined && pair.abstract === undefined) throw new CompileError("E0701", `a getter and a setter for '${a.name}' must both be abstract or neither`, a.start, a.end);
  }
  // As in TypeScript, parameter properties are assigned before field initializers run.
  let initializers: Stmt[] = [];
  for (const f of d.fields) if (f.init !== undefined) initializers.push(assignField(tables.ids, f.name, cloneExpr(f.init), f));
  let prelude: Stmt[] = [];
  for (const f of properties) prelude.push(assignField(tables.ids, f.name, { id: nextId(tables.ids), kind: "ident", name: f.name, start: f.start, end: f.end }, f));
  for (const s of initializers) prelude.push(cloneStmt(s));
  let body: Stmt[] = prelude.map((s) => cloneStmt(s));
  if (ctor !== undefined && ctor.body !== undefined) for (const s of ctor.body) body.push(cloneStmt(s));
  const at = ctor !== undefined ? { start: ctor.start, end: ctor.end } : { start: node.start, end: node.end };
  const rustName = ctor !== undefined ? tables.rust.names.get(ctor) : undefined;
  const constructor = tables.arenas.addBody({
    id: nextId(tables.ids),
    name: `${name}.constructor`,
    scope,
    params: ctor !== undefined ? ctor.params : [],
    body,
    returnType: undefined,
    self: { type, constructor: true, mutable: true },
    owner: type,
    start: at.start,
    end: at.end,
    ...(rustName !== undefined && { foreign: true as const, rust: rustName }),
    ...(ctor !== undefined && ctor.throws !== undefined && { throws: ctor.throws }),
  }).bodyId;
  const required = new Set(d.fields.map((f) => f.name));
  let overrides: Overridden[] = [];
  for (const m of node.members) {
    if ("name" in m && m.modifiers.includes("override") && typeof m.name === "string") overrides.push({ name: m.name, static: m.modifiers.includes("static"), start: m.start, end: m.end });
  }
  if (ctor !== undefined) {
    for (const p of ctor.params) if (p.modifiers.includes("override") && p.pattern.kind === "ident") overrides.push({ name: p.pattern.name, static: false, start: p.start, end: p.end });
  }
  const named = node.extends !== undefined && node.extends.kind === "instantiation" ? node.extends.expr : node.extends;
  const baseName = named !== undefined && named.kind === "ident" ? named.name : undefined;
  return tables.arenas.addClass({ type, abstracts: d.abstracts, copies: new Map(), fields: d.fields, constructor, required, initializers: new NodeSet(initializers), scope, overrides, methods: d.methods, statics: d.statics, staticFields: d.staticFields, getters: d.getters, setters: d.setters, baseName, prelude, node: cloneClassNode(node), wraps: [] });
}

// A field as declared, from a field or a parameter property: an optional one is an Option.
function fieldOf(ids: Mut<Ids>, name: string, written: Ref<TypeNode> | undefined, optional: boolean, init: Expr | undefined, access: Access, readonly: boolean, at: Ref<Span>): FieldDecl {
  const span = { start: at.start, end: at.end };
  const type: TypeNode | undefined = written === undefined ? undefined : optional ? { id: nextId(ids), kind: "union", types: [cloneTypeNode(written), { id: nextId(ids), kind: "ref", name: "null", args: [], ...span }], ...span } : cloneTypeNode(written);
  let f: FieldDecl = { name, type, init, access, readonly, start: span.start, end: span.end };
  if (optional && written !== undefined) f.written = cloneTypeNode(written);
  if (!optional && written !== undefined && spellsUndefined(written)) f.undefinedSpelled = true;
  return f;
}

function cloneFieldDecl(f: Ref<FieldDecl>): FieldDecl {
  let out: FieldDecl = { name: f.name, type: f.type !== undefined ? cloneTypeNode(f.type) : undefined, init: f.init !== undefined ? cloneExpr(f.init) : undefined, access: f.access, readonly: f.readonly, start: f.start, end: f.end };
  if (f.written !== undefined) out.written = cloneTypeNode(f.written);
  if (f.undefinedSpelled !== undefined) out.undefinedSpelled = true;
  return out;
}

// A static field can't change, as a top-level `let` can't, so only `static readonly` is one.
/** @throws {CompileError} */
function staticField(node: Ref<ClassNode>, d: Mut<Declaring>, m: Ref<Extract<ClassMember, { kind: "field" }>>, field: string) {
  const at = { start: m.start, end: m.end };
  if (node.typeParams.length > 0) throw unsupported("static fields in generic classes", at);
  if (!m.modifiers.includes("readonly")) throw new CompileError("E0706", `a static field that isn't 'readonly' would be a global that changes; declare it 'static readonly ${field}', whose value is computed while compiling, or hold an Atomic or a Lock in one`, m.start, m.end);
  if (m.optional) throw unsupported("optional static fields", at);
  if (m.definite) throw unsupported("definite assignment assertions", at);
  if (m.init === undefined) throw new CompileError("E0706", `a 'static readonly' field needs its value where it is declared, as in 'static readonly ${field} = ...'`, m.start, m.end);
  const access = modifiers(m.modifiers.filter((x) => x !== "static"), { start: m.start, end: m.end }, field);
  if (d.staticFields.has(field)) throw new CompileError("E0402", `duplicate property '${field}'`, m.start, m.end);
  d.staticFields.set(field, { name: field, type: m.type !== undefined ? cloneTypeNode(m.type) : undefined, init: cloneExpr(m.init), access, readonly: true, start: m.start, end: m.end });
}

// TypeScript's rules: only an abstract class has abstract members, which are methods or
// accessors without a body, never private or static.
/** @throws {CompileError} */
function abstractMember(tables: Mut<Tables>, node: Ref<ClassNode>, d: Mut<Declaring>, m: Ref<ClassMember>) {
  const at = { start: m.start, end: m.end };
  if (!node.abstract) throw new CompileError("E0701", "abstract members can only appear in an abstract class", m.start, m.end);
  if (m.kind === "field") throw unsupported("abstract fields", at);
  if (m.kind !== "method" && m.kind !== "get" && m.kind !== "set") throw unsupported(m.kind === "index" || m.kind === "staticBlock" ? memberForm(m.kind) : "abstract members", at);
  if (typeof m.name !== "string") throw symbolKey(m.name);
  const name = m.name;
  if (m.modifiers.includes("static")) throw new CompileError("E0701", "'static' can't be used with 'abstract'", m.start, m.end);
  if (m.modifiers.includes("private") || name.startsWith("#")) throw new CompileError("E0701", "an abstract member can't be private, since subclasses must implement it", m.start, m.end);
  if (m.body !== undefined) throw new CompileError("E0701", `'${name}' can't have a body because it is marked abstract`, m.start, m.end);
  if (m.kind === "method" && m.optional) throw unsupported("optional methods", at);
  if (m.kind === "method" && m.typeParams.length > 0) throw unsupported("generic abstract methods", at);
  if (m.kind !== "set" && m.returnType === undefined) throw new CompileError("E0701", `'${name}' needs its return type written, since it is abstract and has no body to infer it from`, m.start, m.end);
  const access = modifiers(m.modifiers.filter((x) => x !== "abstract" && x !== "async"), m, name);
  const table = m.kind === "method" ? "methods" : m.kind === "get" ? "getters" : "setters";
  const kept = m.modifiers.filter((x) => x !== "abstract");
  const made = m.kind === "method" ? method(tables, node, d, { ...m, modifiers: kept, body: [] }) : accessor(tables, node, d, { ...m, modifiers: kept, body: [] });
  if (made !== undefined) tables.arenas.bodyMut(made).abstract = true;
  d.abstracts.push({ name, table, access, start: m.start, end: m.end });
}

/** @throws {CompileError} */
function accessor(tables: Mut<Tables>, node: Ref<ClassNode>, d: Mut<Declaring>, m: Ref<Extract<ClassMember, { kind: "get" | "set" }>>): BodyId {
  const isStatic = m.modifiers.includes("static");
  const at = { start: m.start, end: m.end };
  if (isStatic && node.typeParams.length > 0) throw unsupported("static accessors in generic classes", at);
  if (typeof m.name !== "string") throw symbolKey(m.name);
  const name = m.name;
  const access = modifiers(m.modifiers.filter((x) => x !== "static"), { start: m.start, end: m.end }, name);
  if (name === "constructor") throw new CompileError("E0705", "'constructor' can't be the name of an accessor", m.start, m.end);
  if (m.body === undefined) throw unsupported("accessors without a body", at);
  // Only a JSDoc `@throws` gives an accessor an error type: reading a property can't fail yet.
  if (m.throws !== undefined) throw unsupported("accessors that throw", { start: m.throws.start, end: m.throws.end });
  const key = isStatic ? `${m.kind} ${name}` : name;
  const taken = isStatic ? d.statics.has(key) : m.kind === "get" ? d.getters.has(key) : d.setters.has(key);
  if (taken) throw new CompileError("E0705", `duplicate ${m.kind === "get" ? "getter" : "setter"} '${name}'`, m.start, m.end);
  if (m.kind === "set" && m.params.length !== 1) throw new CompileError("E0705", "a setter takes exactly one parameter", m.start, m.end);
  if (m.kind === "set" && m.returnType !== undefined) throw new CompileError("E0705", "a setter can't have a return type annotation", m.returnType.start, m.returnType.end);
  const first = m.params.length > 0 ? m.params[0] : undefined;
  if (isStatic && first !== undefined && first.pattern.kind === "ident" && first.pattern.name === "this") throw new CompileError("E0706", "a static accessor has no 'this'", first.start, first.end);
  const made = tables.arenas.addBody({
    id: nextId(tables.ids),
    name: `${d.name}.${isStatic ? "static " : ""}${m.kind} ${name}`,
    scope: new Map([...d.scope]),
    params: m.params.map((p) => cloneParam(p)),
    body: m.body.map((s) => cloneStmt(s)),
    returnType: m.returnType !== undefined ? cloneTypeNode(m.returnType) : undefined,
    ...(!isStatic && { self: { type: d.type, constructor: false, mutable: m.kind === "set" } }),
    accessor: true,
    owner: d.type,
    access,
    start: m.start,
    end: m.end,
  }).bodyId;
  if (isStatic) d.statics.set(key, made);
  else if (m.kind === "get") d.getters.set(key, made);
  else d.setters.set(key, made);
  return made;
}

/** @throws {CompileError} */
function method(tables: Mut<Tables>, node: Ref<ClassNode & { name?: string }>, d: Mut<Declaring>, m: Ref<Extract<ClassMember, { kind: "method" }>>): BodyId | undefined {
  const isStatic = m.modifiers.includes("static");
  if (isStatic && d.shared) return undefined;
  if (typeof m.name !== "string") throw symbolKey(m.name);
  const name = m.name;
  const access = modifiers(m.modifiers.filter((x) => x !== "static" && x !== "async"), { start: m.start, end: m.end }, name);
  if (m.optional) throw unsupported("optional methods", { start: m.start, end: m.end });
  if (m.body === undefined) throw new CompileError("E0410", `'${name}' has no implementation; follow its overload signatures with a '${name}' method that has a body`, m.start, m.end);
  if (name === "constructor") throw new CompileError("E0407", "'constructor' can't be the name of a method", m.start, m.end);
  if (isStatic ? d.statics.has(name) : d.methods.has(name)) throw new CompileError("E0402", `duplicate method '${name}'`, m.start, m.end);
  const first = m.params.length > 0 ? m.params[0] : undefined;
  const receiver = first !== undefined && first.pattern.kind === "ident" && first.pattern.name === "this" ? first : undefined;
  if (receiver !== undefined && isStatic) throw new CompileError("E0706", "a static method has no 'this'", receiver.start, receiver.end);
  let params: Param[] = [];
  for (let i: usize = receiver !== undefined ? 1 : 0; i < m.params.length; i++) params.push(cloneParam(m.params[i]!));
  if (!isStatic) {
    // Each instance renames its own copy, leaving the written parameters as they are.
    let rewrites = new Rewrites();
    for (const p of params) if (p.type !== undefined) namesClass(tables.ids, rewrites, node, p);
    let rebuilt: Param[] = [];
    for (let p = params.shift(); p !== undefined; p = params.shift()) rebuilt.push(rebuiltParam(p, rewrites));
    params = rebuilt;
  }
  if (isStatic) classParamIn(node, m);
  const rustName = tables.rust.names.get(m);
  const body = tables.arenas.addBody({
    id: nextId(tables.ids),
    // A static method has its own symbol, since an instance method may share its name.
    name: `${isStatic ? node.name! : d.name}.${isStatic ? "static " : ""}${name}`,
    scope: isStatic ? new Map() : new Map([...d.scope]),
    params,
    body: m.body.map((s) => cloneStmt(s)),
    returnType: m.returnType !== undefined ? cloneTypeNode(m.returnType) : undefined,
    ...(m.throws !== undefined && { throws: cloneTypeNode(m.throws) }),
    ...(m.modifiers.includes("async") && { async: true }),
    ...(m.generator && { generator: true }),
    typeParams: m.typeParams.map((p) => cloneTypeParam(p)),
    self: isStatic ? undefined : { type: d.type, constructor: false, mutable: receiver !== undefined ? mutates(receiver) : false, owned: receiver !== undefined ? owns(receiver) : false },
    owner: d.type,
    access,
    start: m.start,
    end: m.end,
    ...(rustName !== undefined && { foreign: true as const, rust: rustName }),
    ...(m.signature !== undefined && { signature: true as const }),
  });
  const made = body.bodyId;
  // The implementation comes right after its signatures.
  if (m.overloadNames !== undefined) {
    let overloads: BodyId[] = [];
    for (const w of m.overloadNames) overloads.push(isStatic ? d.statics.get(w)! : d.methods.get(w)!);
    body.overloads = overloads;
  }
  if (isStatic) d.statics.set(name, made);
  else d.methods.set(name, made);
  return made;
}

// As in TypeScript, a static member can't name the class's type parameters, only its own.
/** @throws {CompileError} */
function classParamIn(node: Ref<ClassNode>, m: Ref<Extract<ClassMember, { kind: "method" }>>) {
  let outer = new Set<string>();
  for (const p of node.typeParams) outer.add(p.name);
  const used = classParamUse({ of: "classMember", node: m }, outer, new Set<string>());
  if (used !== undefined) throw new CompileError("E0706", `a static method can't use the class's type parameter '${used.name}'; give the method its own, as in 'static ${typeof m.name === "string" ? m.name : ""}<${used.name}>(...)'`, used.start, used.end);
}

// Where a node names one of `outer` that isn't `hidden`. A function inside declaring its own type
// parameter of that name hides the class's.
function classParamUse(n: AnyNode, outer: Ref<Set<string>>, hidden: Ref<Set<string>>): { name: string; start: usize; end: usize } | undefined {
  if (n.of === "typeNode" && n.node.kind === "ref" && n.node.args.length === 0 && outer.has(n.node.name) && !hidden.has(n.node.name)) return { name: n.node.name, start: n.node.start, end: n.node.end };
  let inner = new Set<string>([...hidden]);
  for (const name of typeParamNames(n)) inner.add(name);
  let hit: { name: string; start: usize; end: usize } | undefined = undefined;
  forEachChild(n, (c) => {
    if (hit === undefined) hit = classParamUse(c, outer, inner);
  });
  return hit;
}

// The type parameters a node declares.
function typeParamNames(n: AnyNode): string[] {
  if (n.of === "stmt" && (n.node.kind === "function" || n.node.kind === "class" || n.node.kind === "typeAlias" || n.node.kind === "interface")) return n.node.typeParams.map((p) => p.name);
  if (n.of === "expr" && (n.node.kind === "arrow" || n.node.kind === "function" || n.node.kind === "class")) return n.node.typeParams.map((p) => p.name);
  if (n.of === "classMember" && n.node.kind === "method") return n.node.typeParams.map((p) => p.name);
  if (n.of === "objectProp" && n.node.kind === "method") return n.node.typeParams.map((p) => p.name);
  if (n.of === "typeNode" && n.node.kind === "function") return n.node.typeParams.map((p) => p.name);
  if (n.of === "typeMember" && (n.node.kind === "method" || n.node.kind === "call" || n.node.kind === "construct")) return n.node.typeParams.map((p) => p.name);
  if (n.of === "func") return n.node.typeParams.map((p) => p.name);
  if (n.of === "typeAlias") return n.node.typeParams.map((p) => p.name);
  if (n.of === "interface") return n.node.typeParams.map((p) => p.name);
  if (n.of === "classNode") return n.node.typeParams.map((p) => p.name);
  return [];
}

// In a parameter's type, `this` names the class, as in `equals(other: Ref<this>)`.
function namesClass(ids: Mut<Ids>, rewrites: Mut<Rewrites>, node: Ref<ClassNode & { name?: string }>, p: Ref<Param>): void {
  if (p.type === undefined) return;
  walkWhile({ of: "typeNode", node: p.type }, (n) => {
    if (n.of !== "typeNode" || n.node.kind !== "ref" || n.node.name !== "this" || n.node.args.length !== 0) return true;
    const t = n.node;
    const args = node.typeParams.map((q): TypeNode => ({ id: nextId(ids), kind: "ref", name: q.name, args: [], start: q.start, end: q.end }));
    rewrites.replaceTypeNode(t, { ...t, name: node.name!, args });
    return false;
  });
}

/** @throws {CompileError} */
function add(d: Mut<Declaring>, f: FieldDecl): void {
  if (d.fields.some((other) => other.name === f.name)) throw new CompileError("E0402", `duplicate property '${f.name}'`, f.start, f.end);
  d.fields.push(f);
}

// A `#name` belongs to the class whose body declares it, so a subclass declaring a `#name` its
// base also declares gets a separate member: inside its body the name is renamed `#name@Class`,
// and the base's code, its copies included, keeps reaching the base's own.
export function separatePrivateNames(program: Mut<Stmt[]>): void {
  let bases = new Map<string, string>();
  let declared = new Map<string, string[]>();
  for (const s of program) {
    if (s.kind !== "class" || s.name === undefined) continue;
    const named = s.extends !== undefined && s.extends.kind === "instantiation" ? s.extends.expr : s.extends;
    if (named !== undefined && named.kind === "ident") bases.set(s.name, named.name);
    else bases.delete(s.name);
    declared.set(s.name, privateNames(s.members));
  }
  let rewrites = new Rewrites();
  for (const s of program) {
    if (s.kind !== "class" || s.name === undefined) continue;
    let inherited = new Set<string>();
    let seen = new Set<string>();
    for (let b = bases.get(s.name); b !== undefined && declared.has(b) && !seen.has(b); b = bases.get(b)) {
      seen.add(b);
      for (const n of declared.get(b)!) inherited.add(n);
    }
    for (const name of declared.get(s.name)!) if (inherited.has(name)) renamePrivate(rewrites, s.members, name, `${name}@${s.name}`);
  }
  rebuiltStmts(program, rewrites);
}

function privateNames(members: Ref<ClassMember[]>): string[] {
  let names: string[] = [];
  for (const m of members) {
    if ((m.kind === "field" || m.kind === "method" || m.kind === "get" || m.kind === "set") && typeof m.name === "string" && m.name.startsWith("#")) names.push(m.name);
  }
  return names;
}

// Any name spelled `from` is the private member's: a member's, or one reached through `.`.
function renamePrivate(rewrites: Mut<Rewrites>, members: Ref<ClassMember[]>, from: string, to: string): void {
  for (const m of members) {
    walk({ of: "classMember", node: m }, (n) => {
      if (n.of === "classMember") {
        const c = n.node;
        if ((c.kind === "field" || c.kind === "method" || c.kind === "get" || c.kind === "set") && c.name === from) rewrites.replaceClassMember(c, { ...c, name: to });
      } else if (n.of === "expr") {
        const e = n.node;
        if (e.kind === "member" && e.name === from) rewrites.replace(e, { ...e, name: to });
        else if (e.kind === "privateName" && e.name === from) rewrites.replace(e, { ...e, name: to });
      }
    });
  }
}

// A private name as written, without the class a subclass's own copy of it is renamed for.
export const shownName = (name: string) => (name.startsWith("#") ? name.replace(/@.*$/, "") : name);


// Links a derived class to the base it embeds. Its constructor must start with
// `super(...)`, which fills the embedded base, and then assigns its own initializers. Without
// a constructor of its own it passes its arguments on to the base's.
/** @throws {CompileError} */
export type GlobalType = (name: string) => Type;

/** @throws {CompileError} */
export function extend(tables: Mut<Tables>, classId: ClassId, baseId: ClassId, global: GlobalType): void {
  tables.arenas.classMut(classId).base = baseId;
  const c = tables.arenas.classOf(classId);
  const base = tables.arenas.classOf(baseId);
  let record = tables.typing.rec(c.type);
  record.base = base.type;
  tables.typing.setRec(c.type, record);
  // A name that isn't one of the program's types hides nothing.
  let globals = new Map<string, Type>();
  for (const n of c.scope.keys()) {
    try {
      globals.set(n, global(n));
    } catch {
      continue;
    }
  }
  tables.arenas.classMut(classId).globals = globals;
  for (let b: ClassId | undefined = baseId; b !== undefined; b = tables.arenas.classOf(b).base) {
    const of = tables.arenas.classOf(b);
    for (const f of c.fields) {
      if (of.fields.some((g) => g.name === f.name)) {
        throw new CompileError("E0704", `'${f.name}' is already a field of '${tables.typing.rec(of.type).name}'; with 'extends' as embedding it would be a second, separate field, so set it in the constructor after 'super(...)' instead, as in 'this.${f.name} = ...'`, f.start, f.end);
      }
    }
  }
  const ctorId = c.constructor;
  const preludeLength = c.prelude.length;
  if (c.node.members.some((m) => m.kind === "constructor")) {
    // Its parameters' defaults are bound first, since `super(...)` may read them.
    const defaults = superAt(tables, ctorId, preludeLength);
    let ctor = tables.arenas.bodyMut(ctorId);
    let tail = ctor.body.splice(preludeLength);
    let prelude = ctor.body.splice(0);
    let body = tail.splice(0, defaults);
    body.push(tail.shift()!);
    for (const st of prelude) body.push(st);
    for (const st of tail) body.push(st);
    ctor.body = body;
    return;
  }
  // The base's parameters are typed in its scope, where a name may mean something other than it
  // does here: one of its own type parameters, or a type this class's type parameter hides. Each
  // such name is renamed apart into this constructor's own scope, standing for what it means there.
  const baseCtor = tables.arenas.bodyOf(base.constructor);
  const ownCtor = tables.arenas.bodyOf(ctorId);
  const span = { start: ownCtor.start, end: ownCtor.end };
  const baseName = tables.typing.rec(base.type).name;
  let used = new Set<string>();
  for (const p of baseCtor.params) if (p.type !== undefined) refNames({ of: "typeNode", node: p.type }, used);
  let names = new Map<string, string>();
  for (const n of used) if ((baseCtor.scope !== undefined && baseCtor.scope.has(n)) || c.scope.has(n)) names.set(n, apartName(n, baseName));
  let scope: Map<string, Type> | undefined = undefined;
  if (names.size > 0) {
    let s = new Map<string, Type>();
    for (const [n, t] of c.scope) s.set(n, t);
    for (const [n, to] of names) {
      const there = baseCtor.scope !== undefined ? baseCtor.scope.get(n) : undefined;
      s.set(to, there !== undefined ? there : global(n));
    }
    scope = s;
  }
  // Copies, so each constructor has its own parameters, and none of them is a property here.
  let params: Param[] = [];
  let defaulted: [Param, { name: string; empty: boolean }][] = [];
  for (const p of baseCtor.params) {
    let copy = names.size > 0 && p.type !== undefined ? apartParam(tables.ids, p, names) : cloneParam(p);
    copy.id = nextId(tables.ids);
    copy.modifiers = [];
    const declared = tables.defaulted.get(p);
    if (declared !== undefined) defaulted.push([cloneParam(copy), declared]);
    params.push(copy);
  }
  for (const [p, d] of defaulted) tables.defaulted.set(p, d);
  // A rest parameter is passed on spread, to be packed into the base's again.
  let args: Expr[] = [];
  for (const p of params) {
    assert(p.pattern.kind === "ident", "internal error: a base constructor's parameter is not a name");
    const name: Expr = { id: nextId(tables.ids), kind: "ident", name: p.pattern.name, start: p.start, end: p.end };
    args.push(p.rest ? { id: nextId(tables.ids), kind: "spread", value: name, start: p.start, end: p.end } : name);
  }
  const call: Expr = { id: nextId(tables.ids), kind: "call", callee: { id: nextId(tables.ids), kind: "super", ...span }, typeArgs: [], args, optional: false, ...span };
  let body: Stmt[] = [{ id: nextId(tables.ids), kind: "expr", expr: call, ...span }];
  for (const st of c.prelude) body.push(cloneStmt(st));
  let ctor = tables.arenas.bodyMut(ctorId);
  if (scope !== undefined) ctor.scope = scope;
  ctor.params = params;
  ctor.body = body;
}

// Where a derived constructor's `super(...)` is, after the prelude and the parameters' defaults:
// how many defaults come before it.
/** @throws {CompileError} */
function superAt(tables: Ref<Tables>, ctorId: BodyId, preludeLength: usize): usize {
  const ctor = tables.arenas.bodyOf(ctorId);
  let at = preludeLength;
  while (at < ctor.body.length && tables.prologues.has(ctor.body[at]!)) at++;
  const first = ctor.body[at];
  if (first === undefined || first.kind !== "expr" || first.expr.kind !== "call" || first.expr.callee.kind !== "super") {
    throw new CompileError("E0703", "a derived class's constructor must start with 'super(...)'", ctor.start, ctor.end);
  }
  return at - preludeLength;
}

// Links a class to the Map or Set it extends, held in the field `EMBEDDED`. Its constructor's
// `super(...)` makes the collection, as `new Map<K, V>(...)` would; without a constructor of
// its own it makes an empty one.
/** @throws {CompileError} */
export function embed(tables: Mut<Tables>, classId: ClassId, kind: "Map" | "Set"): void {
  const c = tables.arenas.classOf(classId);
  const named = c.node.extends;
  assert(named !== undefined, "internal error: embedding a class that extends nothing");
  const at = { start: named.start, end: named.end };
  let typeArgs: TypeNode[] = [];
  if (named.kind === "instantiation") for (const t of named.typeArgs) typeArgs.push(cloneTypeNode(t));
  const ctorId = c.constructor;
  const preludeLength = c.prelude.length;
  const explicit = c.node.members.some((m) => m.kind === "constructor");
  // JavaScript's constructor adds each entry through `this.set` or `this.add`, so an override of
  // it sees them; that runs once the fields are assigned, before the rest of the constructor.
  const adder = kind === "Set" ? "add" : "set";
  const overridden = c.methods.has(adder);
  const defaults = explicit ? superAt(tables, ctorId, preludeLength) : 0;
  const field: FieldDecl = { name: EMBEDDED, type: { id: nextId(tables.ids), kind: "ref", name: kind, args: cloneTypeNodes(typeArgs), ...at }, init: undefined, access: "private", readonly: false, ...at };
  let info = tables.arenas.classMut(classId);
  info.embedded = kind;
  info.fields.unshift(field);
  info.required.add(EMBEDDED);
  if (!explicit) {
    let body: Stmt[] = [made(tables.ids, kind, typeArgs, [], at, at)];
    let ctor = tables.arenas.bodyMut(ctorId);
    for (const st of ctor.body.splice(0, preludeLength)) body.push(st);
    ctor.body = body;
    return;
  }
  let ctor = tables.arenas.bodyMut(ctorId);
  let tail = ctor.body.splice(preludeLength);
  let prelude = ctor.body.splice(0);
  let body = tail.splice(0, defaults);
  let first = tail.shift()!;
  const s = { start: first.start, end: first.end };
  let args: Expr[] = first.kind === "expr" && first.expr.kind === "call" ? first.expr.args.splice(0) : [];
  if (!overridden || args.length === 0) {
    body.push(made(tables.ids, kind, typeArgs, args, at, s));
    for (const st of prelude) body.push(st);
    for (const st of tail) body.push(st);
    tables.arenas.bodyMut(ctorId).body = body;
    return;
  }
  const given = args.shift()!;
  const ids = tables.ids;
  let names: string[] = kind === "Set" ? ["member"] : ["key", "value"];
  let elements: Pattern[] = [];
  for (const name of names) elements.push({ id: nextId(ids), kind: "ident", name, ...s });
  const target: Pattern = kind === "Set" ? { id: nextId(ids), kind: "ident", name: "member", ...s } : { id: nextId(ids), kind: "array", elements, rest: undefined, ...s };
  const left: Stmt = { id: nextId(ids), kind: "let", keyword: "const", declarations: [{ id: nextId(ids), target, type: undefined, init: undefined, ...s }], ...s };
  let callArgs: Expr[] = [];
  for (const name of names) callArgs.push({ id: nextId(ids), kind: "ident", name, ...s });
  const call: Expr = { id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "member", object: { id: nextId(ids), kind: "this", ...s }, name: adder, optional: false, ...s }, typeArgs: [], args: callArgs, optional: false, ...s };
  const loop: Stmt = { id: nextId(ids), kind: "forOf", await: false, left, right: given, body: [{ id: nextId(ids), kind: "expr", expr: call, ...s }], ...s };
  body.push(made(ids, kind, typeArgs, [], at, s));
  for (const st of prelude) body.push(st);
  body.push(loop);
  for (const st of tail) body.push(st);
  tables.arenas.bodyMut(ctorId).body = body;
}

// `this[EMBEDDED] = new Map<K, V>(args)`, at the span `s`.
function made(ids: Mut<Ids>, kind: "Map" | "Set", typeArgs: Ref<TypeNode[]>, args: Expr[], at: Ref<Span>, s: Ref<Span>): Stmt {
  const value: Expr = { id: nextId(ids), kind: "new", callee: { id: nextId(ids), kind: "ident", name: kind, start: at.start, end: at.end }, typeArgs: cloneTypeNodes(typeArgs), args, start: s.start, end: s.end };
  return assignField(ids, EMBEDDED, value, { start: s.start, end: s.end });
}

function cloneTypeNodes(ts: Ref<TypeNode[]>): TypeNode[] {
  let out: TypeNode[] = [];
  for (const t of ts) out.push(cloneTypeNode(t));
  return out;
}

// The names the types under `n` refer to without type arguments, added to `out`.
function refNames(n: AnyNode, out: Mut<Set<string>>): void {
  walk(n, (x) => {
    if (x.of === "typeNode") {
      const t = x.node;
      if (t.kind === "ref" && t.args.length === 0) out.add(t.name);
    }
  });
}

// Records renaming every type under `n` that `names` maps.
function renameRefs(rewrites: Mut<Rewrites>, n: AnyNode, names: Ref<Map<string, string>>): void {
  walk(n, (x) => {
    if (x.of === "typeNode") {
      const t = x.node;
      if (t.kind === "ref") {
        const to = names.get(t.name);
        if (to !== undefined) rewrites.replaceTypeNode(t, { ...t, name: to });
      }
    }
  });
}

// Copies with fresh ids, each type `names` maps renamed. The copy is renumbered before it is
// renamed, so what the renaming replaces is the copy's, never the original's.
function apartParam(ids: Mut<Ids>, p: Ref<Param>, names: Ref<Map<string, string>>): Param {
  const copy = renumberParam(cloneParam(p), () => nextId(ids));
  let rewrites = new Rewrites();
  renameRefs(rewrites, { of: "param", node: copy }, names);
  return rebuiltParam(copy, rewrites);
}

function apartStmts(ids: Mut<Ids>, body: Ref<Stmt[]>, names: Ref<Map<string, string>>): Stmt[] {
  let copy: Stmt[] = [];
  for (const st of body) copy.push(cloneStmt(st));
  copy = renumberStmts(copy, () => nextId(ids));
  let rewrites = new Rewrites();
  renameRefs(rewrites, { of: "stmts", node: copy }, names);
  rebuiltStmts(copy, rewrites);
  return copy;
}

function apartTypeNode(ids: Mut<Ids>, t: Ref<TypeNode>, names: Ref<Map<string, string>>): TypeNode {
  const copy = renumberTypeNode(cloneTypeNode(t), () => nextId(ids));
  let rewrites = new Rewrites();
  renameRefs(rewrites, { of: "typeNode", node: copy }, names);
  return rebuiltTypeNode(copy, rewrites);
}

// A name a base's member is renamed to in a derived class, apart from that class's own type
// parameters. It stands for a type the base names, an interface included, rather than for a type
// argument, so it never makes an instance a definition check.
const APART = " of ";
const apartName = (name: string, base: string) => `${name}${APART}${base}`;
export const isApart = (name: string) => name.includes(APART);

// A member of a class or of the bases it embeds, nearest first.
export function inherited(arenas: Ref<Arenas>, c: Ref<ClassInfo>, table: "methods" | "statics" | "getters" | "setters", name: string): Ref<Body> | undefined {
  let at: ClassId | undefined = c.classId;
  while (at !== undefined) {
    const b: Ref<ClassInfo> = arenas.classOf(at);
    const found = table === "methods" ? b.methods.get(name) : table === "statics" ? b.statics.get(name) : table === "getters" ? b.getters.get(name) : b.setters.get(name);
    if (found !== undefined) return arenas.bodyOf(found);
    at = b.base;
  }
  return undefined;
}

// With embedding, a base's own use of `this.m` keeps reaching the base's `m`, where
// TypeScript would reach an override. Overriding such a member is an error rather than a
// silent change in meaning; overriding one the base never reaches through `this` is fine.
/** @throws {CompileError} */
export function checkOverrides(arenas: Arenas, typing: Typing, c: ClassInfo) {
  // A copied template is this class's only because a base declared it; the user wrote none of it.
  const own = [...c.methods, ...c.getters, ...c.setters].map(([name, m]): [string, Body] => [name, arenas.bodyOf(m)]).filter(([, m]) => m.copyOf === undefined);
  const templates: [string, Body][] = [];
  for (let b = arenas.classOf(c.base); b; b = arenas.classOf(b.base)) for (const table of TABLES) for (const [name, f] of b[table]) if (arenas.bodyOf(f).template) templates.push([name, arenas.bodyOf(f)]);
  for (let b = arenas.classOf(c.base); b; b = arenas.classOf(b.base)) {
    const base = typing.rec(b.type).name;
    for (const [name, m] of own) {
      if (b.fields.some((f) => f.name === name)) throw new CompileError("E0704", `'${name}' is already a field of '${base}'`, m.start, m.end);
      if (!b.methods.has(name) && !b.getters.has(name) && !b.setters.has(name)) continue;
      // A template reaches the override, through the copy this class gets. A base's own code
      // calling one reaches its own copy, and through it the base's member.
      const through = new Set([name]);
      for (let grew = true; grew;) {
        grew = false;
        for (const [t, f] of templates) {
          if (through.has(t) || ![...through].some((n) => usesOnThis(f.body, n))) continue;
          through.add(t);
          grew = true;
        }
      }
      // A template is known by its member's span, which its body keeps.
      const bodies = new Set([...b.methods.values(), ...b.getters.values(), ...b.setters.values()].map((f) => arenas.bodyOf(f)).filter((f) => f.template).map((f) => `${f.start}:${f.end}`));
      const members = b.node.members.filter((m) => !("body" in m && m.body && bodies.has(`${m.start}:${m.end}`)));
      const via = [...through].find((n) => members.some((m) => usesOnThisIn({ of: "classMember", node: m }, n, false)));
      if (via === name) {
        throw new CompileError(
          "E0704", `overriding '${name}' is an error here: '${base}' reaches it through 'this', and with 'extends' as embedding that would still run '${base}.${name}'; extract an interface instead`,
          m.start, m.end);
      }
      if (via !== undefined) {
        throw new CompileError(
          "E0704", `overriding '${name}' is an error here: '${base}' calls 'this.${via}', which reaches '${name}', and with 'extends' as embedding the copy of '${via}' in '${base}' would still run '${base}.${name}'; extract an interface instead`,
          m.start, m.end);
      }
    }
  }
}

// TypeScript's rule: a member written `override` must replace one of its bases'.
/** @throws {CompileError} */
export function checkOverrideModifiers(arenas: Arenas, typing: Typing, c: ClassInfo) {
  const name = typing.rec(c.type).name;
  for (const o of c.overrides) {
    if (c.baseName === undefined && !c.embedded) throw new CompileError("E0704", `'${o.name}' can't be marked 'override': class '${name}' doesn't extend another class`, o.start, o.end);
    if (!hasMember(arenas, c, o)) {
      throw new CompileError("E0704", `'${o.name}' can't be marked 'override': '${c.embedded ?? c.baseName}' has no ${o.static ? "static " : ""}member '${o.name}' for it to replace`, o.start, o.end);
    }
  }
}

function hasMember(arenas: Arenas, c: ClassInfo, o: Overridden): boolean {
  for (let b = c.embedded ? c : arenas.classOf(c.base); b; b = arenas.classOf(b.base)) {
    if (b.embedded && !o.static && (o.name === "size" || (b.embedded === "Set" ? SET_METHODS : MAP_METHODS).has(o.name))) return true;
    if (b === c) continue;
    const found = o.static
      ? b.statics.has(o.name) || b.statics.has(`get ${o.name}`) || b.statics.has(`set ${o.name}`) || b.staticFields.has(o.name)
      : b.methods.has(o.name) || b.getters.has(o.name) || b.setters.has(o.name) || b.fields.some((f) => f.name === o.name);
    if (found) return true;
  }
  return false;
}

const TABLES = ["methods", "getters", "setters"] as const;
const MEMBER_KINDS = { methods: "method", getters: "getter", setters: "setter" };

// An abstract base's members that reach one of its abstract members through `this`, directly or
// through another such member, become templates. A concrete class must implement every abstract
// member, and gets its own copy of each template, which sees `this` as the concrete class, so
// `this.area()` there runs the concrete class's `area`.
/** @throws {CompileError} */
export function implementAbstracts(tables: Tables, c: ClassInfo) {
  const { arenas, typing } = tables;
  const bases: ClassInfo[] = [];
  for (let b = arenas.classOf(c.base); b; b = arenas.classOf(b.base)) bases.push(b);
  for (const b of [c, ...bases].filter((b) => b.node.abstract).reverse()) markTemplates(arenas, tables.typing, b);
  if (c.node.abstract) return;
  const abstracts = bases.flatMap((b) => b.abstracts.map((a) => ({ ...a, owner: b })));
  const missing = abstracts.filter((a) => inherited(arenas, c, a.table, a.name)!.abstract && !(a.table !== "methods" && [c, ...bases].some((b) => b.fields.some((f) => f.name === a.name))));
  if (missing.length > 0) {
    const named = [...new Set(missing.map((a) => `${MEMBER_KINDS[a.table]} '${a.name}' of '${typing.rec(a.owner.type).name}'`))];
    throw new CompileError("E0701", `class '${typing.rec(c.type).name}' must implement the abstract ${named.join(", ")}`, c.node.start, c.node.end);
  }
  for (const a of abstracts) {
    const f = inherited(arenas, c, a.table, a.name)!;
    if (!f.abstract && (f.access === "private" || (f.access === "protected" && a.access === "public"))) {
      throw new CompileError("E0701", `'${a.name}' implements a ${a.access} abstract member of '${typing.rec(a.owner.type).name}', so it must be ${a.access === "public" ? "public" : "public or protected"}`, f.start, f.end);
    }
  }
  for (const b of bases.filter((b) => b.node.abstract)) {
    for (const table of TABLES) {
      for (const [name, f] of b[table]) {
        const nearest = inherited(arenas, c, table, name)!;
        if (arenas.bodyOf(f).template && (nearest.copyOf ?? nearest.bodyId) === f) c[table].set(name, copyFor(tables, c.classId, f));
      }
    }
  }
}

// A member whose return type names `this` gives the receiver's own class, so a subclass that
// doesn't override it gets its own copy, checked with `this` as the subclass.
export function copySelfTyped(tables: Tables, c: ClassInfo) {
  const { arenas } = tables;
  if (c.node.abstract) return;
  for (let b = arenas.classOf(c.base); b; b = arenas.classOf(b.base)) {
    for (const table of TABLES) {
      for (const [name, f] of b[table]) {
        const nearest = inherited(arenas, c, table, name)!;
        if (selfTyped(arenas.bodyOf(f)) && (nearest.copyOf ?? nearest.bodyId) === f) c[table].set(name, copyFor(tables, c.classId, f));
      }
    }
  }
}

export function selfTyped(f: Body): boolean {
  let found = false;
  const ret = f.self && !f.self.constructor ? f.returnType : undefined;
  if (ret) {
    walk({ of: "typeNode", node: ret }, ({ of, node }) => {
      if (of === "typeNode" && node.kind === "ref" && node.name === "this" && node.args.length === 0) found = true;
    });
  }
  return found;
}

// A concrete class's copy of a template, made once: its own member when nothing overrides it,
// and what `super.name()` runs in the class either way. Its body was written in the base, so a
// type name there that this class's own type parameter would hide, one of the base's type
// parameters or a type of the program, is renamed apart in a copy of the body, standing for what
// it means in the base. Only `this`, through `self`, means this class.
export function copyFor(tables: Mut<Tables>, classId: ClassId, bodyId: BodyId): BodyId {
  const c = tables.arenas.classOf(classId);
  const made = c.copies.get(bodyId);
  if (made !== undefined) return made;
  const f = tables.arenas.bodyOf(bodyId);
  assert(f.owner !== undefined && f.self !== undefined, "internal error: copying a member of no class");
  let used = new Set<string>();
  if (f.returnType !== undefined) refNames({ of: "typeNode", node: f.returnType }, used);
  for (const p of f.params) refNames({ of: "param", node: p }, used);
  refNames({ of: "stmts", node: f.body }, used);
  const ownerName = tables.typing.rec(f.owner).name;
  let names = new Map<string, string>();
  for (const n of used) {
    if (c.scope.has(n) && ((f.scope !== undefined && f.scope.has(n)) || (c.globals !== undefined && c.globals.has(n)))) names.set(n, apartName(n, ownerName));
  }
  let scope = new Map<string, Type>();
  for (const [n, t] of c.scope) scope.set(n, t);
  if (f.scope !== undefined) for (const [n, t] of f.scope) if (!c.scope.has(n)) scope.set(n, t);
  for (const [n, to] of names) {
    const there = f.scope !== undefined ? f.scope.get(n) : undefined;
    scope.set(to, there !== undefined ? there : c.globals!.get(n)!);
  }
  let defaults: ({ name: string; empty: boolean } | undefined)[] = [];
  for (const p of f.params) defaults.push(tables.defaulted.get(p));
  let prologue: boolean[] = [];
  for (const st of f.body) prologue.push(tables.prologues.has(st));
  let copy = cloneBody(f);
  copy.name = `${tables.typing.rec(c.type).name}.${f.name}`;
  copy.self = f.self.owned !== undefined ? { type: c.type, constructor: f.self.constructor, mutable: f.self.mutable, owned: f.self.owned } : { type: c.type, constructor: f.self.constructor, mutable: f.self.mutable };
  copy.owner = c.type;
  copy.declared = f.owner;
  copy.scope = scope;
  copy.template = undefined;
  copy.copyOf = bodyId;
  copy.id = nextId(tables.ids);
  if (names.size > 0) {
    copy.body = apartStmts(tables.ids, f.body, names);
    let params: Param[] = [];
    for (const p of f.params) params.push(apartParam(tables.ids, p, names));
    copy.params = params;
    if (f.returnType !== undefined) copy.returnType = apartTypeNode(tables.ids, f.returnType, names);
    for (let i: usize = 0; i < copy.params.length; i++) {
      const declared = defaults[i];
      if (declared !== undefined) tables.defaulted.set(copy.params[i]!, declared);
    }
    for (let i: usize = 0; i < copy.body.length; i++) if (prologue[i] === true) tables.prologues.add(copy.body[i]!);
  }
  const added = tables.arenas.addBody(copy).bodyId;
  tables.arenas.classMut(classId).copies.set(bodyId, added);
  return added;
}

// A copy of a body as written, keeping its nodes' ids.
function cloneBody(f: Ref<Body>): Body {
  let params: Param[] = [];
  for (const p of f.params) params.push(cloneParam(p));
  let body: Stmt[] = [];
  for (const st of f.body) body.push(cloneStmt(st));
  let out: Body = { id: f.id, start: f.start, end: f.end, bodyId: f.bodyId, name: f.name, params, body, returnType: f.returnType !== undefined ? cloneTypeNode(f.returnType) : undefined };
  if (f.throws !== undefined) out.throws = cloneTypeNode(f.throws);
  if (f.generator !== undefined) out.generator = f.generator;
  if (f.async !== undefined) out.async = f.async;
  if (f.foreign !== undefined) out.foreign = f.foreign;
  if (f.js !== undefined) out.js = cloneJsName(f.js);
  if (f.rust !== undefined) out.rust = { crate: f.rust.crate, path: f.rust.path, symbol: f.rust.symbol };
  if (f.exported !== undefined) out.exported = f.exported;
  if (f.comptime !== undefined) out.comptime = f.comptime;
  if (f.typeParams !== undefined) {
    let typeParams: TypeParam[] = [];
    for (const p of f.typeParams) typeParams.push(cloneTypeParam(p));
    out.typeParams = typeParams;
  }
  if (f.accessor !== undefined) out.accessor = f.accessor;
  if (f.scope !== undefined) {
    let scope = new Map<string, Type>();
    for (const [n, t] of f.scope) scope.set(n, t);
    out.scope = scope;
  }
  if (f.self !== undefined) out.self = f.self.owned !== undefined ? { type: f.self.type, constructor: f.self.constructor, mutable: f.self.mutable, owned: f.self.owned } : { type: f.self.type, constructor: f.self.constructor, mutable: f.self.mutable };
  if (f.overloads !== undefined) out.overloads = [...f.overloads];
  if (f.overloadNames !== undefined) out.overloadNames = [...f.overloadNames];
  if (f.signature !== undefined) out.signature = true;
  if (f.owner !== undefined) out.owner = f.owner;
  if (f.access !== undefined) out.access = f.access;
  if (f.abstract !== undefined) out.abstract = true;
  if (f.template !== undefined) out.template = true;
  if (f.copyOf !== undefined) out.copyOf = f.copyOf;
  if (f.declared !== undefined) out.declared = f.declared;
  if (f.closure !== undefined) {
    const k = f.closure;
    let closure: NonNullable<Body["closure"]> = { parent: k.parent, move: k.move };
    if (k.value !== undefined) closure.value = cloneExpr(k.value);
    if (k.expected !== undefined) closure.expected = k.expected;
    if (k.unsafe !== undefined) closure.unsafe = k.unsafe;
    if (k.self !== undefined) closure.self = k.self;
    if (k.made !== undefined) closure.made = true;
    out.closure = closure;
  }
  return out;
}

// Marks an abstract class's templates, once its bases' are marked.
/** @throws {CompileError} */
function markTemplates(arenas: Arenas, typing: Typing, c: ClassInfo) {
  const names = new Set<string>();
  for (let b: ClassInfo | undefined = c; b; b = arenas.classOf(b.base)) {
    b.abstracts.forEach((a) => names.add(a.name));
    for (const table of TABLES) for (const [name, f] of b[table]) if (arenas.bodyOf(f).template) names.add(name);
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const table of TABLES) {
      for (const [name, id] of c[table]) {
        const f = arenas.bodyOf(id);
        // `this` handed on as a value has the abstract class's type, which only a template's own
        // check may ever give a value: every instance made for an abstract class comes from
        // checking a template or a signature, and none is compiled.
        if (f.template || !([...names].some((n) => usesOnThis(f.body, n, true)) || thisEscapes(f.body))) continue;
        f.template = true;
        names.add(name);
        grew = true;
      }
    }
  }
  // While the base is built, the subclass that implements its abstract members isn't yet. A
  // constructor has no copies, so `this` there would be the abstract class's own value.
  const constructor = arenas.bodyOf(c.constructor);
  const early = [...names].find((n) => usesOnThis(constructor.body, n, true));
  if (early !== undefined) {
    throw new CompileError("E0701", `'${typing.rec(c.type).name}' can't reach its abstract member '${early}' while it is being constructed, since the subclass that implements it isn't built yet`, constructor.start, constructor.end);
  }
  if (thisEscapes(constructor.body)) {
    throw new CompileError("E0701", `'${typing.rec(c.type).name}' is abstract, so its constructor can't hand 'this' on as a value: the subclass being built isn't finished yet`, constructor.start, constructor.end);
  }
}

// Whether a class embeds an abstract class declaring `name` abstract, or is one.
export function abstractIn(arenas: Arenas, c: ClassInfo, name: string): boolean {
  for (let b: ClassInfo | undefined = c; b; b = arenas.classOf(b.base)) if (b.abstracts.some((a) => a.name === name)) return true;
  return false;
}

// Whether `this` appears as a value rather than only as the object of `this.member`.
function thisEscapes(body: Stmt[] | undefined): boolean {
  if (!body) return false;
  let escapes = false;
  walkWhile({ of: "stmts", node: body }, ({ of, node }) => {
    if (escapes || (of === "expr" && node.kind === "member" && node.object.kind === "this")) return false;
    if (of === "expr" && node.kind === "this") escapes = true;
    return true;
  });
  return escapes;
}

// Whether any node under `stmts` is `this.name`, or with `viaSuper`, `super.name` too.
function usesOnThis(stmts: Stmt[] | undefined, name: string, viaSuper = false): boolean {
  if (!stmts) return false;
  return usesOnThisIn({ of: "stmts", node: stmts }, name, viaSuper);
}

function usesOnThisIn(root: AnyNode, name: string, viaSuper: boolean): boolean {
  let used = false;
  walkWhile(root, ({ of, node }) => {
    if (used) return false;
    if (of !== "expr") return true;
    // An overload signature's call of its own class's implementation is the signature's, which an
    // override replaces along with it.
    if (node.kind === "call" && (node as { implementation?: true }).implementation) {
      used = node.args.some((a) => usesOnThisIn({ of: "expr", node: a }, name, viaSuper));
      return false;
    }
    if (node.kind === "member" && (node.object.kind === "this" || (viaSuper && node.object.kind === "super")) && node.name === name) used = true;
    return true;
  });
  return used;
}

// `this: Mut<this>` mutates the instance; `this: Ref<this>` only reads it, as the default does.
/** @throws {CompileError} */
export function mutates(p: Param): boolean {
  if (wraps(p, "Mut") || wraps(p, "Own")) return true;
  if (wraps(p, "Ref")) return false;
  throw unsupported("receivers other than 'this: Ref<this>', 'this: Mut<this>' and 'this: Own<this>'", p);
}

// `this: Own<this>` takes the object over: an owner may change it too.
export const owns = (p: Param) => wraps(p, "Own");

function wraps(p: Param, name: string): boolean {
  const t = p.type;
  return t?.kind === "ref" && t.name === name && t.args.length === 1 && t.args[0]!.kind === "ref" && t.args[0]!.name === "this";
}

// `this.name = value`, as a constructor statement at the span of what it came from.
function assignField(ids: Ids, name: string, value: Expr, at: Span): Stmt {
  const s = { start: at.start, end: at.end };
  const target: Expr = { id: nextId(ids), kind: "member", object: { id: nextId(ids), kind: "this", ...s }, name, optional: false, ...s };
  return { id: nextId(ids), kind: "expr", expr: { id: nextId(ids), kind: "assign", op: "=", target, value, ...s }, ...s };
}

// A member's access, from its modifiers or a `#` name. `readonly` is read by the caller.
/** @throws {CompileError} */
function modifiers(list: string[], at: Span, name: string): Access {
  const other = list.find((m) => m !== "public" && m !== "private" && m !== "protected" && m !== "readonly" && m !== "override");
  if (other) throw unsupported(`'${other}' modifiers`, at);
  list = list.filter((m) => m !== "readonly" && m !== "override");
  if (list.length > 1) throw new CompileError("E0709", "a member can have only one accessibility modifier", at.start, at.end);
  if (name.startsWith("#") && list.length > 0) {
    throw new CompileError("E0709", "an accessibility modifier can't be used with a private identifier", at.start, at.end);
  }
  return name.startsWith("#") ? "private" : (list[0] as Access | undefined) ?? "public";
}

function span(nodes: Span[]): Span {
  return { start: nodes[0]!.start, end: nodes.at(-1)!.end };
}

// What each kind of class member besides a field and the constructor is called when rejected.
function memberForm(kind: "index" | "staticBlock"): string {
  return kind === "index" ? "index signatures" : "static blocks";
}

// Whether a type is written `T | undefined`, spelling out its `undefined` beside other members.
export function spellsUndefined(t: Ref<TypeNode>): boolean {
  if (t.kind !== "union") return false;
  let undefineds: usize = 0;
  for (const u of t.types) if (u.kind === "ref" && u.name === "undefined" && u.args.length === 0) undefineds++;
  return undefineds > 0 && undefineds < t.types.length;
}
