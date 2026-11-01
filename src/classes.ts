import type { Tables } from "./compilation.ts";
import { CompileError } from "./diag.ts";
import type { RustName, RustTables } from "./rust.ts";
import type { ClassMember, ClassNode, Expr, Id, JsName, Param, Span, Stmt, TypeNode, TypeParam } from "./parser.ts";
import type { Access, ClassType, FunctionType, Type, Typing } from "./typing.ts";
import { unsupported } from "./unsupported.ts";
import type { Instance } from "./check.ts";
import { NodeMap, nextId, NodeSet, type Ids, childrenOf, walk, type AnyNode, type NodeOf, type RootKind } from "./nodes.ts";

// A function to compile: a top-level function, a static method, or a class's constructor or
// instance method, which gets its instance as `this` through a pointer. Only a constructor
// and a method declared with `this: Mut<this>` may change it.
export type Body = Span & Id & {
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
  overloads?: Body[];
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
  copyOf?: Body;
  declared?: ClassType;
  // An arrow function's body, checked inside the instance it is written in. An expression body
  // is a `return` of it, `value`.
  // `expected`, the function type it is given to, types parameters it leaves unwritten.
  // `move`: it captures everything by value.
  // A nested function's closure knows its own name, which its body calls itself by.
  // `made`: the checker wrote it around a function given as a value or a timer's callback.
  closure?: { value?: Expr; parent: Instance; expected?: FunctionType; move: boolean; unsafe?: boolean; self?: string; made?: true };
};

// A type parameter bounded by `Lifetime` names a lifetime, which is checked and erased rather
// than instantiated.
export const isLifetime = (p: TypeParam) => p.constraint?.kind === "ref" && p.constraint.name === "Lifetime" && p.constraint.args.length === 0;

// A field as declared: its annotation, its initializer, or both give its type.
// `written` is an optional field's type as written, before `?` made it nullable.
// `written`: an optional field's type before `?` made it nullable; `undefinedSpelled`: a field
// written `T | undefined`.
export type FieldDecl = Span & { name: string; type: TypeNode | undefined; init: Expr | undefined; access: Access; readonly: boolean; written?: TypeNode; undefinedSpelled?: true };

// A member an abstract class declares without a body, for each concrete class to implement.
export type AbstractMember = Span & { name: string; table: "methods" | "getters" | "setters"; access: Access };

export type ClassInfo = {
  type: ClassType;
  abstracts: AbstractMember[];
  // For a concrete class, its copy of each template it runs, by the template.
  copies: NodeMap<Body, Body>;
  fields: FieldDecl[];
  // Its body starts by assigning the field initializers, then the parameter properties.
  constructor: Body;
  // Every field, each unset until a constructor statement assigns it; until then `this` may
  // only appear as the target of such an assignment.
  required: Set<string>;
  // The prelude's field initializers, which can't see the constructor's parameters.
  initializers: NodeSet<Stmt>;
  methods: Map<string, Body>;
  // Static methods by name, and static accessors as `get x` and `set x`, none with a `this`.
  statics: Map<string, Body>;
  // Each `static readonly` field, a top-level const named `C.x` computed while compiling.
  staticFields: Map<string, FieldDecl>;
  // A getter borrows `this` and returns a value; a setter takes `Mut<this>` and the value.
  getters: Map<string, Body>;
  setters: Map<string, Body>;
  // The class this one embeds and delegates to, named by `extends`.
  baseName: string | undefined;
  base?: ClassInfo;
  // The initializers and parameter properties a derived constructor runs after `super(...)`.
  prelude: Stmt[];
  // For each `From<X>` it implements, X, the static `from` that wraps one, and its parameter's type.
  wraps: [Type, Body, Type][];
  node: ClassNode;
  // For an instance of a generic class: what its type parameters stand for.
  scope: Map<string, Type>;
};

// Collects a class declaration's fields and builds the constructor it compiles to. A generic
// class is declared once per set of type arguments, under a name like `Box<i64>`, with
// `scope` saying what its type parameters stand for.
export function declareClass(tables: Tables, node: ClassNode & { name: string }, name: string = node.name, scope: Map<string, Type> = new Map<string, Type>()): ClassInfo {
  const { genericStatics, ids, rust, typing: { classType } } = tables;
  if (node.decorators.length > 0) throw unsupported("decorators", node.decorators[0]!);
  // A template is copied into each concrete class by the abstract class's one declaration, which a
  // generic class doesn't have.
  if (node.abstract && node.typeParams.length > 0) throw unsupported("generic abstract classes", node);
  if (node.extends && node.extends.kind !== "ident" && !(node.extends.kind === "instantiation" && node.extends.expr.kind === "ident")) {
    throw unsupported("base class expressions", node.extends);
  }
  const fields: FieldDecl[] = [];
  const constructors = node.members.filter((m) => m.kind === "constructor");
  const ctor = constructors[0];
  if (ctor && !ctor.body && constructors.length > 1) throw unsupported("constructor overloads", ctor);
  if (constructors.length > 1) throw new CompileError("a class can have only one constructor", constructors[1]!.start, constructors[1]!.end);
  if (ctor && !ctor.body) throw unsupported("constructor overloads", ctor);

  const type = classType(name, scope.size > 0 ? { name: node.name, args: [...scope.values()] } : undefined);
  if (node.abstract) type.abstract = true;
  const abstracts: AbstractMember[] = [];
  const methods = new Map<string, Body>();
  // A generic class's statics can't use its type parameters, so every instance shares one set.
  const shared = node.typeParams.length > 0 ? genericStatics.get(node) : undefined;
  const statics = shared ?? new Map<string, Body>();
  if (node.typeParams.length > 0 && !shared) genericStatics.set(node, statics);
  const staticFields = new Map<string, FieldDecl>();
  const getters = new Map<string, Body>();
  const setters = new Map<string, Body>();
  for (const m of node.members) {
    if (m.kind === "constructor") continue;
    if ("modifiers" in m && m.modifiers.includes("abstract")) {
      abstractMember(m);
      continue;
    }
    if (m.kind === "method") {
      method(m);
      continue;
    }
    if (m.kind === "get" || m.kind === "set") {
      accessor(m);
      continue;
    }
    if (m.kind !== "field") throw unsupported(MEMBER_FORMS[m.kind], m);
    if (typeof m.name !== "string") throw unsupported("computed property names", m.name);
    if (m.modifiers.includes("static")) {
      staticField(m, m.name);
      continue;
    }
    const access = modifiers(m.modifiers, m, m.name);
    if (m.definite) throw unsupported("definite assignment assertions", m);
    if (!m.type && !m.init) throw new CompileError(`property '${m.name}' implicitly has an 'any' type; add a type annotation`, m.start, m.end);
    // An optional field is an Option, empty until assigned.
    const at = { start: m.start, end: m.end };
    const type: TypeNode | undefined = m.optional && m.type ? { id: nextId(ids), kind: "union", types: [m.type, { id: nextId(ids), kind: "ref", name: "null", args: [], ...at }], ...at } : m.type;
    const init: Expr | undefined = m.optional ? (m.init ?? { id: nextId(ids), kind: "null", ...at }) : m.init;
    add({ name: m.name, type, init, access, readonly: m.modifiers.includes("readonly"), start: m.start, end: m.end, ...(m.optional && m.type && { written: m.type }), ...(!m.optional && m.type && withoutUndefined(ids, m.type) && { undefinedSpelled: true as const }) });
  }
  const properties = (ctor?.params ?? []).filter((p) => p.modifiers.length > 0).map((p) => {
    if (p.pattern.kind !== "ident") throw unsupported("destructuring patterns", p.pattern);
    const access = modifiers(p.modifiers, p, p.pattern.name);
    // An optional parameter property is an Option, as the parameter is.
    const at = { start: p.start, end: p.end };
    const type: TypeNode | undefined = p.optional && p.type ? { id: nextId(ids), kind: "union", types: [p.type, { id: nextId(ids), kind: "ref", name: "null", args: [], ...at }], ...at } : p.type;
    return add({ name: p.pattern.name, type, init: undefined, access, readonly: p.modifiers.includes("readonly"), start: p.start, end: p.end, ...(p.optional && p.type && { written: p.type }), ...(!p.optional && p.type && withoutUndefined(ids, p.type) && { undefinedSpelled: true as const }) });
  });

  for (const [name, f] of staticFields) {
    if (statics.has(name) || statics.has(`get ${name}`) || statics.has(`set ${name}`)) throw new CompileError(`duplicate property '${name}'`, f.start, f.end);
  }
  for (const name of statics.keys()) {
    const accessor = /^[gs]et (.*)$/.exec(name)?.[1];
    if (accessor !== undefined && statics.has(accessor)) {
      const m = statics.get(accessor)!;
      throw new CompileError(`duplicate property '${accessor}'`, m.start, m.end);
    }
  }
  for (const name of [...methods.keys(), ...getters.keys(), ...setters.keys()]) {
    const clash = fields.find((f) => f.name === name);
    if (clash) throw new CompileError(`duplicate property '${name}'`, clash.start, clash.end);
    if (methods.has(name) && (getters.has(name) || setters.has(name))) {
      const m = methods.get(name)!;
      throw new CompileError(`duplicate property '${name}'`, m.start, m.end);
    }
  }
  // An abstract accessor's pair must be abstract too, as in TypeScript.
  for (const a of abstracts) {
    const pair = a.table === "getters" ? setters.get(a.name) : a.table === "setters" ? getters.get(a.name) : undefined;
    if (pair && !pair.abstract) throw new CompileError(`a getter and a setter for '${a.name}' must both be abstract or neither`, a.start, a.end);
  }
  // As in TypeScript, parameter properties are assigned before field initializers run.
  const initializers = fields.filter((f) => f.init).map((f) => assignField(ids, f.name, f.init!, f));
  const prelude = [
    ...properties.map((f) => assignField(ids, f.name, { id: nextId(ids), kind: "ident", name: f.name, start: f.start, end: f.end }, f)),
    ...initializers,
  ];
  const constructor: Body = {
    id: nextId(ids),
    name: `${name}.constructor`,
    scope,
    params: ctor?.params ?? [],
    body: [...prelude, ...(ctor?.body ?? [])],
    returnType: undefined,
    self: { type, constructor: true, mutable: true },
    owner: type,
    start: (ctor ?? node).start,
    end: (ctor ?? node).end,
    ...(ctor && rustOf(rust, ctor)),
    ...(ctor?.throws && { throws: ctor.throws }),
  };
  const required = new Set(fields.map((f) => f.name));
  const named = node.extends?.kind === "instantiation" ? node.extends.expr : node.extends;
  const baseName = named?.kind === "ident" ? named.name : undefined;
  return { type, abstracts, copies: new NodeMap(), fields, constructor, required, initializers: new NodeSet(initializers), scope, methods, statics, staticFields, getters, setters, baseName, prelude, node, wraps: [] };

  // A static field can't change, as a top-level `let` can't, so only `static readonly` is one.
  function staticField(m: Extract<ClassMember, { kind: "field" }>, field: string) {
    if (node.typeParams.length > 0) throw unsupported("static fields in generic classes", m);
    if (!m.modifiers.includes("readonly")) throw new CompileError(`a static field that isn't 'readonly' would be a global that changes; declare it 'static readonly ${field}', whose value is computed while compiling, or hold an Atomic or a Lock in one`, m.start, m.end);
    if (m.optional) throw unsupported("optional static fields", m);
    if (m.definite) throw unsupported("definite assignment assertions", m);
    if (!m.init) throw new CompileError(`a 'static readonly' field needs its value where it is declared, as in 'static readonly ${field} = ...'`, m.start, m.end);
    const access = modifiers(m.modifiers.filter((x) => x !== "static"), m, field);
    if (staticFields.has(field)) throw new CompileError(`duplicate property '${field}'`, m.start, m.end);
    staticFields.set(field, { name: field, type: m.type, init: m.init, access, readonly: true, start: m.start, end: m.end });
  }

  // TypeScript's rules: only an abstract class has abstract members, which are methods or
  // accessors without a body, never private or static.
  function abstractMember(m: ClassMember) {
    if (!node.abstract) throw new CompileError("abstract members can only appear in an abstract class", m.start, m.end);
    if (m.kind === "field") throw unsupported("abstract fields", m);
    if (m.kind !== "method" && m.kind !== "get" && m.kind !== "set") throw unsupported(MEMBER_FORMS[m.kind as keyof typeof MEMBER_FORMS] ?? "abstract members", m);
    if (typeof m.name !== "string") throw unsupported("computed property names", m.name);
    if (m.modifiers.includes("static")) throw new CompileError("'static' can't be used with 'abstract'", m.start, m.end);
    if (m.modifiers.includes("private") || m.name.startsWith("#")) throw new CompileError("an abstract member can't be private, since subclasses must implement it", m.start, m.end);
    if (m.body) throw new CompileError(`'${m.name}' can't have a body because it is marked abstract`, m.start, m.end);
    if (m.kind === "method" && m.optional) throw unsupported("optional methods", m);
    if (m.kind === "method" && m.typeParams.length > 0) throw unsupported("generic abstract methods", m);
    if (m.kind !== "set" && !m.returnType) throw new CompileError(`'${m.name}' needs its return type written, since it is abstract and has no body to infer it from`, m.start, m.end);
    const access = modifiers(m.modifiers.filter((x) => x !== "abstract" && x !== "async"), m, m.name);
    const table = m.kind === "method" ? "methods" : m.kind === "get" ? "getters" : "setters";
    const signature = { ...m, modifiers: m.modifiers.filter((x) => x !== "abstract"), body: [] };
    if (signature.kind === "method") method(signature);
    else accessor(signature);
    ({ methods, getters, setters })[table].get(m.name)!.abstract = true;
    abstracts.push({ name: m.name, table, access, start: m.start, end: m.end });
  }

  function accessor(m: Extract<ClassMember, { kind: "get" | "set" }>) {
    const isStatic = m.modifiers.includes("static");
    if (isStatic && node.typeParams.length > 0) throw unsupported("static accessors in generic classes", m);
    if (typeof m.name !== "string") throw unsupported("computed property names", m.name);
    const access = modifiers(m.modifiers.filter((x) => x !== "static"), m, m.name);
    if (m.name === "constructor") throw new CompileError("'constructor' can't be the name of an accessor", m.start, m.end);
    if (!m.body) throw unsupported("accessors without a body", m);
    // Only a JSDoc `@throws` gives an accessor an error type: reading a property can't fail yet.
    if (m.throws) throw unsupported("accessors that throw", m.throws);
    const table = isStatic ? statics : m.kind === "get" ? getters : setters;
    const key = isStatic ? `${m.kind} ${m.name}` : m.name;
    if (table.has(key)) throw new CompileError(`duplicate ${m.kind === "get" ? "getter" : "setter"} '${m.name}'`, m.start, m.end);
    if (m.kind === "set" && m.params.length !== 1) throw new CompileError("a setter takes exactly one parameter", m.start, m.end);
    if (m.kind === "set" && m.returnType) throw new CompileError("a setter can't have a return type annotation", m.returnType.start, m.returnType.end);
    if (isStatic && m.params[0]?.pattern.kind === "ident" && m.params[0].pattern.name === "this") throw new CompileError("a static accessor has no 'this'", m.params[0].start, m.params[0].end);
    table.set(key, {
      id: nextId(ids),
      name: `${name}.${isStatic ? "static " : ""}${m.kind} ${m.name}`,
      scope,
      params: m.params,
      body: m.body,
      returnType: m.returnType,
      ...(!isStatic && { self: { type, constructor: false, mutable: m.kind === "set" } }),
      accessor: true,
      owner: type,
      access,
      start: m.start,
      end: m.end,
    });
  }

  function method(m: Extract<ClassMember, { kind: "method" }>) {
    const isStatic = m.modifiers.includes("static");
    if (isStatic && shared) return;
    if (typeof m.name !== "string") throw unsupported("computed property names", m.name);
    const access = modifiers(m.modifiers.filter((x) => x !== "static" && x !== "async"), m, m.name);
    if (m.optional) throw unsupported("optional methods", m);
    if (m.generator && !m.modifiers.includes("async")) throw unsupported("generator methods", m);
    if (!m.body) throw new CompileError(`'${m.name}' has no implementation; follow its overload signatures with a '${m.name}' method that has a body`, m.start, m.end);
    if (m.name === "constructor") throw new CompileError("'constructor' can't be the name of a method", m.start, m.end);
    const table = isStatic ? statics : methods;
    if (table.has(m.name)) throw new CompileError(`duplicate method '${m.name}'`, m.start, m.end);
    const [first, ...rest] = m.params;
    const receiver = first?.pattern.kind === "ident" && first.pattern.name === "this" ? first : undefined;
    if (receiver && isStatic) throw new CompileError("a static method has no 'this'", receiver.start, receiver.end);
    if (!isStatic) for (const p of receiver ? rest : m.params) if (p.type) namesClass(p.type);
    if (isStatic) classParamIn(m);
    table.set(m.name, {
      id: nextId(ids),
      // A static method has its own symbol, since an instance method may share its name.
      name: `${isStatic ? node.name : name}.${isStatic ? "static " : ""}${m.name}`,
      scope: isStatic ? new Map() : scope,
      params: receiver ? rest : m.params,
      body: m.body,
      returnType: m.returnType,
      ...(m.throws && { throws: m.throws }),
      ...(m.modifiers.includes("async") && { async: true }),
      ...(m.generator && { generator: true }),
      typeParams: m.typeParams,
      self: isStatic ? undefined : { type, constructor: false, mutable: receiver ? mutates(receiver) : false, owned: receiver ? owns(receiver) : false },
      owner: type,
      access,
      start: m.start,
      end: m.end,
      ...rustOf(rust, m),
      ...((m as { signature?: true }).signature && { signature: true as const }),
    });
    // The implementation comes right after its signatures.
    const overloads = (m as { overloads?: ClassMember[] }).overloads;
    if (overloads) table.get(m.name)!.overloads = overloads.map((w) => table.get((w as typeof m).name as string)!);
  }

  // As in TypeScript, a static member can't name the class's type parameters, only its own.
  function classParamIn(m: Extract<ClassMember, { kind: "method" }>) {
    const outer = new Set(node.typeParams.map((p) => p.name));
    // A function inside declaring its own type parameter of that name hides the class's.
    const find = (n: AnyNode, hidden: Set<string>): (Span & { name: string }) | undefined => {
      if (n.of === "typeNode" && n.node.kind === "ref" && n.node.args.length === 0 && outer.has(n.node.name) && !hidden.has(n.node.name)) return n.node;
      const typeParams = (n.node as { typeParams?: TypeParam[] }).typeParams;
      const inner = typeParams?.length ? new Set([...hidden, ...typeParams.map((p) => p.name)]) : hidden;
      for (const c of childrenOf(n)) {
        const found = find(c, inner);
        if (found) return found;
      }
      return undefined;
    };
    const used = find({ of: "classMember", node: m }, new Set());
    if (used) throw new CompileError(`a static method can't use the class's type parameter '${used.name}'; give the method its own, as in 'static ${m.name as string}<${used.name}>(...)'`, used.start, used.end);
  }

  // In a parameter's type, `this` names the class, as in `equals(other: Ref<this>)`.
  function namesClass(t: TypeNode) {
    walk("typeNode", t, ({ of, node: n }) => {
      if (of !== "typeNode" || n.kind !== "ref" || n.name !== "this" || n.args.length !== 0) return;
      Object.assign(n, { name: node.name, args: node.typeParams.map((p) => ({ id: nextId(ids), kind: "ref", name: p.name, args: [], start: p.start, end: p.end })) });
      return false;
    });
  }

  function add(f: FieldDecl): FieldDecl {
    if (fields.some((other) => other.name === f.name)) throw new CompileError(`duplicate property '${f.name}'`, f.start, f.end);
    fields.push(f);
    return f;
  }
}

// A `#name` belongs to the class whose body declares it, so a subclass declaring a `#name` its
// base also declares gets a separate member: inside its body the name is renamed `#name@Class`,
// and the base's code, its copies included, keeps reaching the base's own.
export function separatePrivateNames(nodes: (ClassNode & { name: string })[]) {
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const baseOf = (n: ClassNode) => {
    const named = n.extends?.kind === "instantiation" ? n.extends.expr : n.extends;
    return named?.kind === "ident" ? byName.get(named.name) : undefined;
  };
  const declared = (n: ClassNode) => n.members.flatMap((m) => ("name" in m && typeof m.name === "string" && m.name.startsWith("#") ? [m.name] : []));
  for (const node of nodes) {
    const inherited = new Set<string>();
    const seen = new NodeSet<ClassNode>();
    for (let b = baseOf(node); b && !seen.has(b); b = baseOf(b)) {
      seen.add(b);
      declared(b).forEach((n) => inherited.add(n));
    }
    for (const name of declared(node).filter((n) => inherited.has(n))) renamePrivate(node.members, name, `${name}@${node.name}`);
  }
}

// Any name spelled `from` is the private member's: a member's, or one reached through `.`.
function renamePrivate(members: ClassMember[], from: string, to: string) {
  walk("classMember", members, ({ node }) => {
    const n = node as { name?: unknown };
    if (n.name === from) n.name = to;
  });
}

// A private name as written, without the class a subclass's own copy of it is renamed for.
export const shownName = (name: string) => (name.startsWith("#") ? name.replace(/@.*$/, "") : name);

// A Rust type's member is a foreign function, called through the shim.
function rustOf(rust: RustTables, m: ClassMember): { foreign?: true; rust?: RustName } {
  const named = rust.names.get(m);
  return named ? { foreign: true, rust: named } : {};
}

// Links a derived class to the base it embeds. Its constructor must start with
// `super(...)`, which fills the embedded base, and then assigns its own initializers. Without
// a constructor of its own it passes its arguments on to the base's.
export function extend(tables: Tables, c: ClassInfo, base: ClassInfo, global: (name: string) => Type) {
  const { defaulted, prologues, ids, typing: { rec } } = tables;
  c.base = base;
  c.type.base = base.type;
  for (let b: ClassInfo | undefined = base; b; b = b.base) {
    const redeclared = c.fields.find((f) => b.fields.some((g) => g.name === f.name));
    if (redeclared) {
      throw new CompileError(`'${redeclared.name}' is already a field of '${rec(b.type).name}'; with 'extends' as embedding it would be a second, separate field, so set it in the constructor after 'super(...)' instead, as in 'this.${redeclared.name} = ...'`, redeclared.start, redeclared.end);
    }
  }
  const explicit = c.node.members.find((m) => m.kind === "constructor");
  const at = { start: c.constructor.start, end: c.constructor.end };
  if (explicit) {
    // Its parameters' defaults are bound first, since `super(...)` may read them.
    const written = c.constructor.body.slice(c.prelude.length);
    const defaults = written.filter((s) => prologues.has(s));
    const [first, ...rest] = written.slice(defaults.length);
    if (first?.kind !== "expr" || first.expr.kind !== "call" || first.expr.callee.kind !== "super") {
      throw new CompileError("a derived class's constructor must start with 'super(...)'", at.start, at.end);
    }
    c.constructor.body = [...defaults, first, ...c.prelude, ...rest];
    return;
  }
  // The base's parameters are typed in its scope, where a name may mean something other than it
  // does here: one of its own type parameters, or a type this class's type parameter hides. Each
  // such name is renamed apart into this constructor's own scope, standing for what it means there.
  const outer = base.constructor.scope ?? new Map<string, Type>();
  const names = new Map([...new Set(base.constructor.params.flatMap((p) => refNames(p.type)))]
    .filter((n) => outer.has(n) || c.scope.has(n)).map((n) => [n, `${n} of ${rec(base.type).name}`]));
  if (names.size > 0) c.constructor.scope = new Map([...c.scope, ...[...names].map(([n, to]): [string, Type] => [to, outer.get(n) ?? global(n)])]);
  // Copies, so each constructor has its own parameters, and none of them is a property here.
  const params = base.constructor.params.map((p) => {
    const copy = { ...p, id: nextId(ids), modifiers: [], ...(p.type && names.size > 0 && { type: renamed(p.type, names) }) };
    const declared = defaulted.get(p);
    if (declared) defaulted.set(copy, declared);
    return copy;
  });
  // A rest parameter is passed on spread, to be packed into the base's again.
  const args: Expr[] = params.map((p) => {
    const name: Expr = { id: nextId(ids), kind: "ident", name: (p.pattern as { name: string }).name, start: p.start, end: p.end };
    return p.rest ? { id: nextId(ids), kind: "spread", value: name, start: p.start, end: p.end } : name;
  });
  const call: Expr = { id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "super", ...at }, typeArgs: [], args, optional: false, ...at };
  c.constructor.params = params;
  c.constructor.body = [{ id: nextId(ids), kind: "expr", expr: call, ...at }, ...c.prelude];
}

// The names a type refers to without type arguments.
function refNames(t: TypeNode | undefined): string[] {
  const found: string[] = [];
  walk("typeNode", t, ({ of, node }) => {
    if (of === "typeNode" && node.kind === "ref" && node.args.length === 0) found.push(node.name);
  });
  return found;
}

// A copy of a type with the type parameters `names` maps renamed.
function renamed<T>(t: T, names: Map<string, string>): T {
  if (Array.isArray(t)) return t.map((x) => renamed(x, names)) as T;
  if (!t || typeof t !== "object") return t;
  const copy = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, renamed(v, names)])) as { kind?: string; name?: string };
  if (copy.kind === "ref" && names.has(copy.name!)) copy.name = names.get(copy.name!);
  return copy as T;
}

// A member of a class or of the bases it embeds, nearest first.
export function inherited(c: ClassInfo, table: "methods" | "statics" | "getters" | "setters", name: string): Body | undefined {
  for (let b: ClassInfo | undefined = c; b; b = b.base) {
    const found = b[table].get(name);
    if (found) return found;
  }
  return undefined;
}

// With embedding, a base's own use of `this.m` keeps reaching the base's `m`, where
// TypeScript would reach an override. Overriding such a member is an error rather than a
// silent change in meaning; overriding one the base never reaches through `this` is fine.
export function checkOverrides({ rec }: Typing, c: ClassInfo) {
  // A copied template is this class's only because a base declared it; the user wrote none of it.
  const own = [...c.methods, ...c.getters, ...c.setters].filter(([, m]) => !m.copyOf);
  const templates: [string, Body][] = [];
  for (let b = c.base; b; b = b.base) for (const table of TABLES) for (const [name, f] of b[table]) if (f.template) templates.push([name, f]);
  for (let b = c.base; b; b = b.base) {
    const base = rec(b.type).name;
    for (const [name, m] of own) {
      if (b.fields.some((f) => f.name === name)) throw new CompileError(`'${name}' is already a field of '${base}'`, m.start, m.end);
      if (!b.methods.has(name) && !b.getters.has(name) && !b.setters.has(name)) continue;
      // A template reaches the override, through the copy this class gets. A base's own code
      // calling one reaches its own copy, and through it the base's member.
      const through = new Set([name]);
      for (let grew = true; grew;) {
        grew = false;
        for (const [t, f] of templates) {
          if (through.has(t) || ![...through].some((n) => usesOnThis("stmt", f.body, n))) continue;
          through.add(t);
          grew = true;
        }
      }
      const bodies = new Set([...b.methods.values(), ...b.getters.values(), ...b.setters.values()].filter((f) => f.template).map((f) => f.body));
      const members = b.node.members.filter((m) => !("body" in m && m.body && bodies.has(m.body)));
      const via = [...through].find((n) => usesOnThis("classMember", members, n));
      if (via === name) {
        throw new CompileError(
          `overriding '${name}' is an error here: '${base}' reaches it through 'this', and with 'extends' as embedding that would still run '${base}.${name}'; extract an interface instead`,
          m.start, m.end);
      }
      if (via !== undefined) {
        throw new CompileError(
          `overriding '${name}' is an error here: '${base}' calls 'this.${via}', which reaches '${name}', and with 'extends' as embedding the copy of '${via}' in '${base}' would still run '${base}.${name}'; extract an interface instead`,
          m.start, m.end);
      }
    }
  }
}

const TABLES = ["methods", "getters", "setters"] as const;
const MEMBER_KINDS = { methods: "method", getters: "getter", setters: "setter" };

// An abstract base's members that reach one of its abstract members through `this`, directly or
// through another such member, become templates. A concrete class must implement every abstract
// member, and gets its own copy of each template, which sees `this` as the concrete class, so
// `this.area()` there runs the concrete class's `area`.
export function implementAbstracts(tables: Tables, c: ClassInfo) {
  const { rec } = tables.typing;
  const bases: ClassInfo[] = [];
  for (let b = c.base; b; b = b.base) bases.push(b);
  for (const b of [c, ...bases].filter((b) => b.node.abstract).reverse()) markTemplates(tables.typing, b);
  if (c.node.abstract) return;
  const abstracts = bases.flatMap((b) => b.abstracts.map((a) => ({ ...a, owner: b })));
  const missing = abstracts.filter((a) => inherited(c, a.table, a.name)!.abstract && !(a.table !== "methods" && [c, ...bases].some((b) => b.fields.some((f) => f.name === a.name))));
  if (missing.length > 0) {
    const named = [...new Set(missing.map((a) => `${MEMBER_KINDS[a.table]} '${a.name}' of '${rec(a.owner.type).name}'`))];
    throw new CompileError(`class '${rec(c.type).name}' must implement the abstract ${named.join(", ")}`, c.node.start, c.node.end);
  }
  for (const a of abstracts) {
    const f = inherited(c, a.table, a.name)!;
    if (!f.abstract && (f.access === "private" || (f.access === "protected" && a.access === "public"))) {
      throw new CompileError(`'${a.name}' implements a ${a.access} abstract member of '${rec(a.owner.type).name}', so it must be ${a.access === "public" ? "public" : "public or protected"}`, f.start, f.end);
    }
  }
  for (const b of bases.filter((b) => b.node.abstract)) {
    for (const table of TABLES) {
      for (const [name, f] of b[table]) {
        const nearest = inherited(c, table, name)!;
        if (f.template && (nearest.copyOf ?? nearest) === f) c[table].set(name, copyFor(tables, c, f));
      }
    }
  }
}

// A concrete class's copy of a template, made once: its own member when nothing overrides it,
// and what `super.name()` runs in the class either way.
export function copyFor({ ids, typing }: Tables, c: ClassInfo, f: Body): Body {
  let copy = c.copies.get(f);
  if (!copy) c.copies.set(f, copy = { ...f, id: nextId(ids), name: `${typing.rec(c.type).name}.${f.name}`, self: { ...f.self!, type: c.type }, owner: c.type, scope: c.scope, template: undefined, copyOf: f, declared: f.owner! });
  return copy;
}

// Marks an abstract class's templates, once its bases' are marked.
function markTemplates({ rec }: Typing, c: ClassInfo) {
  const names = new Set<string>();
  for (let b: ClassInfo | undefined = c; b; b = b.base) {
    b.abstracts.forEach((a) => names.add(a.name));
    for (const table of TABLES) for (const [name, f] of b[table]) if (f.template) names.add(name);
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const table of TABLES) {
      for (const [name, f] of c[table]) {
        // `this` handed on as a value has the abstract class's type, which only a template's own
        // check may ever give a value: every instance made for an abstract class comes from
        // checking a template or a signature, and none is compiled.
        if (f.template || !([...names].some((n) => usesOnThis("stmt", f.body, n, true)) || thisEscapes(f.body))) continue;
        f.template = true;
        names.add(name);
        grew = true;
      }
    }
  }
  // While the base is built, the subclass that implements its abstract members isn't yet. A
  // constructor has no copies, so `this` there would be the abstract class's own value.
  const early = [...names].find((n) => usesOnThis("stmt", c.constructor.body, n, true));
  if (early !== undefined) {
    throw new CompileError(`'${rec(c.type).name}' can't reach its abstract member '${early}' while it is being constructed, since the subclass that implements it isn't built yet`, c.constructor.start, c.constructor.end);
  }
  if (thisEscapes(c.constructor.body)) {
    throw new CompileError(`'${rec(c.type).name}' is abstract, so its constructor can't hand 'this' on as a value: the subclass being built isn't finished yet`, c.constructor.start, c.constructor.end);
  }
}

// Whether a class embeds an abstract class declaring `name` abstract, or is one.
export function abstractIn(c: ClassInfo, name: string): boolean {
  for (let b: ClassInfo | undefined = c; b; b = b.base) if (b.abstracts.some((a) => a.name === name)) return true;
  return false;
}

// Whether `this` appears as a value rather than only as the object of `this.member`.
function thisEscapes(body: Stmt[] | undefined): boolean {
  let escapes = false;
  walk("stmt", body, ({ of, node }) => {
    if (escapes || (of === "expr" && node.kind === "member" && node.object.kind === "this")) return false;
    if (of === "expr" && node.kind === "this") escapes = true;
  });
  return escapes;
}

// Whether any node under `node` is `this.name`, or with `viaSuper`, `super.name` too.
function usesOnThis<K extends RootKind>(of: K, roots: NodeOf<K>[] | undefined, name: string, viaSuper = false): boolean {
  let used = false;
  walk(of, roots, ({ of, node }) => {
    if (used) return false;
    if (of !== "expr") return;
    // An overload signature's call of its own class's implementation is the signature's, which an
    // override replaces along with it.
    if (node.kind === "call" && (node as { implementation?: true }).implementation) {
      used = usesOnThis("expr", node.args, name, viaSuper);
      return false;
    }
    if (node.kind === "member" && (node.object.kind === "this" || (viaSuper && node.object.kind === "super")) && node.name === name) used = true;
  });
  return used;
}

// `this: Mut<this>` mutates the instance; `this: Ref<this>` only reads it, as the default does.
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
function modifiers(list: string[], at: Span, name: string): Access {
  const other = list.find((m) => m !== "public" && m !== "private" && m !== "protected" && m !== "readonly");
  if (other) throw unsupported(`'${other}' modifiers`, at);
  list = list.filter((m) => m !== "readonly");
  if (list.length > 1) throw new CompileError("a member can have only one accessibility modifier", at.start, at.end);
  if (name.startsWith("#") && list.length > 0) {
    throw new CompileError("an accessibility modifier can't be used with a private identifier", at.start, at.end);
  }
  return name.startsWith("#") ? "private" : (list[0] as Access | undefined) ?? "public";
}

function span(nodes: Span[]): Span {
  return { start: nodes[0]!.start, end: nodes.at(-1)!.end };
}

// What each kind of class member besides a field and the constructor is called when rejected.
const MEMBER_FORMS: Record<Exclude<ClassMember["kind"], "field" | "constructor" | "method" | "get" | "set">, string> = {
  index: "index signatures",
  staticBlock: "static blocks",
};

// A type written `T | undefined` without its `undefined`, or nothing when it has none.
export function withoutUndefined(ids: Ids, t: TypeNode): TypeNode | undefined {
  if (t.kind !== "union") return undefined;
  const rest = t.types.filter((u) => !(u.kind === "ref" && u.name === "undefined" && u.args.length === 0));
  if (rest.length === t.types.length || rest.length === 0) return undefined;
  return rest.length === 1 ? rest[0]! : { ...t, id: nextId(ids), types: rest };
}
