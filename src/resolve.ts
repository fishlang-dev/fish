import type { Declarations, Tables } from "./compilation.ts";
import { CompileError } from "./diag.ts";
import { didYouMean } from "./suggest.ts";
import { holdsNull } from "./defaults.ts";
import type { EnumMember, Expr, Interface, Param, PropertyName, Span, Stmt, TupleElement, TypeAlias, TypeMember, TypeNode, TypeParam } from "./parser.ts";
import { nextId, NodeMap, walkWhile, type Ids } from "./nodes.ts";
import type { DataEnum, EnumInfo, EnumInstance } from "./enums.ts";
import { placeholders } from "./generics.ts";
import { cloneEnumMember, cloneParam, cloneStmt, cloneTypeAlias, cloneTypeMember, cloneTypeNode, cloneTypeParam } from "./rebuild.ts";
import { unitPowers, isNumeric, type UnionType, type InteriorRecord, TypeMap, ANY_REGEX, INTERIORS, familyHeld, type RecursiveType, isFloat, splitTemplate, type BlockType, isInteger, typedNamed, type MapType, INTEGERS, type Integer, type ClassType, type Field, type InteriorType, type SharedType, type InterfaceType, type LiteralType, type Method, type ObjectType, type ParamType, type Type, type Typing, type VariantType, type FunctionType, type BrandHow, type FamilyNode, type BlockRecord, type ArrayType, type FutureType, type RefType, type ClosureType, copyField, copyMethod } from "./typing.ts";
import { typeForm, unsupported } from "./unsupported.ts";
import { symbolKey } from "./keys.ts";
import { byteSize } from "./sizes.ts";
import { openParam, standIn, TypeFunctions, UTILITIES, type TypeFunctionsHost } from "./typefns.ts";
import { mutates, owns, spellsUndefined } from "./classes.ts";
import type { BodyId, LocalId } from "./arenas.ts";

// Type annotations and the top-level type aliases they name, resolved to the checker's types.

// Aliases, classes and interfaces share one namespace of type names; `named` says whether a
// class, template, interface or enum already has the alias's name.
/** @throws {CompileError} */
export function addAlias(aliases: Mut<Map<string, TypeAlias>>, s: TypeAlias, named: boolean) {
  typeName(s.name, s, aliases.has(s.name) || named);
  aliases.set(s.name, s);
}

// An object type with a method describes values by what they do, as an interface does, so an
// alias of one is that interface.
export function traitAlias(ids: Mut<Ids>, a: Ref<TypeAlias>): Interface | undefined {
  const t: Ref<TypeNode> = a.type;
  if (t.kind !== "object" || !t.members.some((m) => m.kind === "method")) return undefined;
  let typeParams: TypeParam[] = [];
  for (const p of a.typeParams) typeParams.push(cloneTypeParam(p));
  let members: TypeMember[] = [];
  for (const m of t.members) members.push(cloneTypeMember(m));
  return { id: nextId(ids), kind: "interface", name: a.name, typeParams, extends: [], members, start: a.start, end: a.end };
}

// Whether a parameter is written as a tag's strings: `comptime` and a string array.
export function tagStrings(p: Ref<Param> | undefined): boolean {
  if (p === undefined || !p.comptime || p.type === undefined) return false;
  if (p.type.kind === "ref") return p.type.name === "TemplateStringsArray";
  return p.type.kind === "array" && p.type.element.kind === "ref" && p.type.element.name === "string";
}

/** @throws {CompileError} */
export function paramName(p: Ref<Param>): string {
  if (p.pattern.kind !== "ident") throw unsupported("destructuring patterns", { start: p.pattern.start, end: p.pattern.end });
  return p.pattern.name;
}

// The classes every program's prelude declares.
const STD_CLASSES = new Set(["AbortError", "IoError", "TextEncoder", "TextDecoder"]);

/** @throws {CompileError} */
// `taken` says whether a type of the name is already declared.
export function typeName(name: string, at: Ref<Span>, taken: boolean) {
  if (BUILT_IN_TYPES.has(name)) throw new CompileError("E0407", `'${name}' is a built-in type`, at.start, at.end);
  if (STD_CLASSES.has(name) && taken) throw new CompileError("E0407", `'${name}' is a std class; give yours another name`, at.start, at.end);
  if (taken) throw new CompileError("E0402", `duplicate type name '${name}'`, at.start, at.end);
}

// A field holds a value, and an interface type describes values without being one. A
// function type in a field would be a boxed callable, which needs the heap.
/** @throws {CompileError} */
export function storable(typing: Mut<Typing>, written: Type, at: Ref<Span>): Type {
  const w = typeof written === "string" ? undefined : typing.rec(written);
  if (w?.kind === "function" && w.generic !== undefined) throw new CompileError("E0115", familyHeld("a field"), at.start, at.end);
  const type = typing.stored(written);
  const r = typeof type === "string" ? undefined : typing.rec(type);
  if (r?.kind === "interface") {
    throw new CompileError("E0115", `a field can't have the interface type '${r.name}'; use a type parameter instead`, at.start, at.end);
  }
  if (r?.kind === "closure") throw unsupported("functions stored in fields", at);
  return type;
}

// What resolving asks of the checker: the class a name and type arguments refer to, a generic
// one instantiated on first use; a class laid out, saying whether its fields are known yet; the
// type of a value `typeof` names; whether a type fits another as `extends` asks; and the type
// names in sight at an offset, for suggestions.
/** @throws {CompileError} */
export type InScope<T> = () => T;

export interface ResolverHost {
  tables: Tables;
  decls: Declarations;
  enums: Map<string, EnumInfo>;
  // An enum's type and a member of it, read once the enum is settled.
  /** @throws {CompileError} */
  enumType(this: Mut<this>, name: string): Type;
  /** @throws {CompileError} */
  enumMember(this: Mut<this>, name: string, member: string): LiteralType | undefined;
  resolverState: ResolverState;
  /** @throws {CompileError} */
  classNamed(this: Mut<this>, name: string, args: Type[], at: Span): ClassType | undefined;
  /** @throws {CompileError} */
  fieldsLaid(this: Mut<this>, c: ClassType): boolean;
  /** @throws {CompileError} */
  valueType(this: Mut<this>, name: string, at: Span, shadowed: boolean): Type;
  /** @throws {CompileError} */
  conforms(this: Mut<this>, from: Type, to: Type, at: Span): boolean;
  typeNames(at: usize): string[];
  /** @throws {CompileError} */
  replaced(this: Mut<this>, t: Type, swap: Ref<TypeMap<Type, Type>>): Type;
  /** @throws {CompileError} */
  resolveIn(this: Mut<this>, scope: Ref<Map<string, Type>> | undefined, t: Ref<TypeNode>): Type;
}

// What a body being checked keeps in sight of a type written in it: its parameters, read from the
// body, the scopes its checker opens and closes as it goes, and the sight of the body it is written
// in. Kept here rather than in the checker, so resolving a `typeof` reads it without reaching back
// into the checker.
export type Sight = { body: BodyId; scopes: Map<string, LocalId>[]; outer: usize | undefined };


// The alias each written alias has resolved first. In a group of aliases that name one another,
// a type read inside one member while the group is still being made meets placeholders for the
// others, so the group is always entered at one fixed member, the one declared first, and its
// types don't depend on which alias a program reads first.
function aliasRoots(aliases: Ref<Map<string, TypeAlias>>): Map<string, string> {
  let names: string[] = [];
  for (const n of aliases.keys()) names.push(n);
  let edges = new Map<string, string[]>();
  for (const n of names) {
    let out: string[] = [];
    walkWhile({ of: "typeNode", node: aliases.get(n)!.type }, (x) => {
      if (x.of === "typeNode" && x.node.kind === "ref" && aliases.has(x.node.name) && !out.includes(x.node.name)) out.push(x.node.name);
      return true;
    });
    edges.set(n, out);
  }
  let reach = new Map<string, Set<string>>();
  for (const n of names) {
    let seen = new Set<string>();
    let stack: string[] = [];
    const direct = edges.get(n)!;
    for (const m of direct) stack.push(m);
    while (stack.length > 0) {
      const m = stack.pop()!;
      if (seen.has(m)) continue;
      seen.add(m);
      const next = edges.get(m)!;
      for (const k of next) if (!seen.has(k)) stack.push(k);
    }
    reach.set(n, seen);
  }
  let roots = new Map<string, string>();
  for (const n of names) {
    const reached = reach.get(n)!;
    if (!reached.has(n)) continue;
    let group: string[] = [n];
    for (const m of reached) if (m !== n && reach.get(m)!.has(n)) group.push(m);
    let root = n;
    for (const m of group) if (aliases.get(m)!.start < aliases.get(root)!.start) root = m;
    // The compiler's own AST, where `Expr`, `Stmt` and `TypeNode` name one another, starts at `Expr`.
    for (const m of group) {
      const suffix = m === "Expr" ? "" : m.startsWith("Expr-fsh") ? m.slice(4) : undefined;
      if (suffix !== undefined && group.includes(`Stmt${suffix}`)) root = m;
    }
    if (root !== n) roots.set(n, root);
  }
  return roots;
}
// The literal string a written object type, or an intersection holding one, declares for `name`.
function writtenLiteral(node: Ref<TypeNode>, name: string): string | undefined {
  if (node.kind === "object") {
    for (const m of node.members) {
      if (m.kind === "property" && m.name === name && m.type !== undefined && m.type.kind === "literal" && m.type.value.kind === "string") return m.type.value.value;
    }
    return undefined;
  }
  if (node.kind === "intersection") {
    for (const t of node.types) {
      const k = writtenLiteral(t, name);
      if (k !== undefined) return k;
    }
  }
  return undefined;
}

// The fields of an object type that hold a literal string, as `kind` in `{ kind: "block" }`.
function literalFields(typing: Ref<Typing>, t: Type): { name: string; value: string }[] {
  if (typeof t === "string") return [];
  const r = typing.rec(t);
  if (r.kind !== "object") return [];
  let found: { name: string; value: string }[] = [];
  for (const f of r.fields) {
    if (typeof f.type === "string") continue;
    const k = typing.rec(f.type);
    if (k.kind === "literal" && typeof k.value === "string") found.push({ name: f.name, value: k.value });
  }
  return found;
}


// What resolving has made and where it is, kept by the host between uses.
export class ResolverState {
  // What was being resolved as each class layout under way began: an alias met again inside one
  // reads the fields of a class whose own field types need it.
  layouts: Set<string>[] = [];
  resolved = new Map<string, Type>();
  resolving = new Set<string>();
  // The alias each written alias resolves first, worked out once from the declarations.
  aliasRoots = new Map<string, string>();
  aliasRootsMade = false;
  // Where an alias instance leads back to itself, by its key, and the alias each is made from.
  recursives = new Map<string, RecursiveType>();
  recursiveAliases = new TypeMap<RecursiveType, string>();
  traits = new Map<usize, Map<string, InterfaceType>>();
  // Each combined interface `A & B`, by its sides.
  combined = new Map<string, InterfaceType>();
  // Each object type with a method written in place, as the interface it stands for.
  inline = new Map<string, Interface>();
  // The interface standing for each shape of inline object type with a method.
  shapes = new Map<string, InterfaceType>();
  // The type parameters in scope, bound to what they stand for in the body being checked.
  scope = new Map<string, Type>();
  // Above zero while a generic alias is checked with placeholders, before any use.
  deferring = 0;
  // How many alias instances computing the outermost type has needed, against the budget.
  computed = 0;
  // Every body's sight, by the index its checker holds, and the one types are resolved in, which
  // `typeof` can't name the locals and parameters of yet; unset where only top-level names are.
  sights: Sight[] = [];
  sight: usize | undefined = undefined;
  // The sight of each body's signature, which sees only its parameters, made once per body.
  signatures = new Map<BodyId, usize>();
  // The data-carrying enums being made, to catch one that holds itself.
  making = new Map<usize, string>();
  // Each data-carrying enum's instances, by enum and type arguments.
  enumInstances = new Map<string, EnumInstance>();
  // Where a data-carrying enum instance holds itself, by enum and type arguments.
  enumBlocks = new Map<string, RecursiveType>();
}

// Resolves type annotations and aliases. A generic alias is checked with placeholders for its
// type parameters, and resolved again per set of type arguments.
export class Resolver<H extends ResolverHost> implements TypeFunctionsHost {
  host: Mut<H>;

  constructor(host: Mut<H>) {
    this.host = host;
  }
  private recOf<T extends Type>(t: T | undefined) {
    return t === undefined || typeof t === "string" ? undefined : this.host.tables.typing.rec(t as Exclude<T, string>);
  }
  // A class laid out for a type-level function, with no names in sight.
  /** @throws {CompileError} */
  fieldsKnown(this: Mut<this>, c: ClassType): boolean {
    let resolving = new Set<string>();
    for (const name of this.host.resolverState.resolving) resolving.add(name);
    this.host.resolverState.layouts.push(resolving);
    const outer = this.enterSight(undefined);
    try {
      return this.host.fieldsLaid(c);
    } finally {
      this.host.resolverState.sight = outer;
      this.host.resolverState.layouts.pop();
    }
  }
  isDeferring(): boolean {
    return this.host.resolverState.deferring > 0;
  }
  /** @throws {CompileError} */
  conforms(this: Mut<this>, from: Type, to: Type, at: Ref<Span>): boolean {
    // An alias met again while it is still being made has no shape yet, as when `Extract<Stmt, ...>`
    // is read inside a member `Stmt` holds; a member of a discriminated union says its
    // discriminant where it is declared, which decides it.
    const decided = this.decidedWhilePending(from, to);
    if (decided !== undefined) return decided;
    return this.host.conforms(from, to, { start: at.start, end: at.end });
  }
  // Whether an alias still being made fits `to`, by the literal fields written where it's declared;
  // undefined when they don't settle it.
  private decidedWhilePending(this: Mut<this>, from: Type, to: Type): boolean | undefined {
    if (typeof from === "string") return undefined;
    const r = this.host.tables.typing.rec(from);
    if (r.kind !== "recursive" || r.of !== "never") return undefined;
    const alias = this.host.decls.aliases.get(r.name);
    if (alias === undefined) return undefined;
    const wanted = literalFields(this.host.tables.typing, to);
    let settled = wanted.length > 0;
    for (const { name, value } of wanted) {
      const written = writtenLiteral(alias.type, name);
      if (written === undefined) settled = false;
      else if (written !== value) return false;
    }
    return settled ? true : undefined;
  }
  typingOf(this: Mut<this>): Mut<Typing> {
    return this.host.tables.typing;
  }
  private typeFns(this: Mut<this>): TypeFunctions<Resolver<H>> {
    return new TypeFunctions(this);
  }
  // A new sight for `body`, written in the body whose sight is `outer`, with one scope open.
  openSight(this: Mut<this>, body: BodyId, outer: usize | undefined): usize {
    this.host.resolverState.sights.push({ body, scopes: [new Map()], outer });
    return this.host.resolverState.sights.length - 1;
  }
  // The sight a body's signature is resolved in: its parameters' names, where written inside it.
  signatureSight(this: Mut<this>, body: BodyId): usize {
    const known = this.host.resolverState.signatures.get(body);
    if (known !== undefined) return known;
    const made = this.openSight(body, undefined);
    this.host.resolverState.signatures.set(body, made);
    return made;
  }
  setSight(this: Mut<this>, names: usize | undefined) {
    this.host.resolverState.sight = names;
  }
  // Whether a name is a local or parameter in sight of a type written at `at`: in a scope or the
  // parameters of a body the type is written in, or of one around it.
  inSight(name: string, at: Ref<Span>): boolean {
    let i = this.host.resolverState.sight;
    while (i !== undefined) {
      const s: Ref<Sight> = this.host.resolverState.sights[i]!;
      const f = this.host.tables.arenas.bodyOf(s.body);
      if (!(at.start >= f.start && at.end <= f.end)) return false;
      for (const scope of s.scopes) if (scope.has(name)) return true;
      for (const p of f.params) if (p.pattern.kind === "ident" && p.pattern.name === name) return true;
      i = s.outer;
    }
    return false;
  }
  /** @throws {CompileError} */
  withSight<T>(this: Mut<this>, names: usize | undefined, f: InScope<T>): T {
    const outer = this.enterSight(names);
    try {
      return f();
    } finally {
      this.host.resolverState.sight = outer;
    }
  }
  // Resolves in the sight `names`, giving the sight it replaces, which is put back after.
  enterSight(this: Mut<this>, names: usize | undefined): usize | undefined {
    const outer = this.host.resolverState.sight;
    this.host.resolverState.sight = names;
    return outer;
  }
  // The instance of a generic interface for other type arguments.
  /** @throws {CompileError} */
  interfaceInstance(this: Mut<this>, t: InterfaceType, args: Type[]) {
    const name = this.host.tables.typing.rec(t).generic!.name;
    const found = this.host.decls.interfaces.get(name);
    if (found !== undefined) {
      const named = cloneInterface(found);
      return this.interfaceOf(named, args, named);
    }
    // An inline interface is made while resolving, so it is read from a copy.
    const written = cloneInterface(this.host.resolverState.inline.get(name)!);
    const inline = this.interfaceOf(written, args, written);
    return this.sameShape(inline);
  }
  // A recursive alias's type made again with other type arguments.
  /** @throws {CompileError} */
  remakeRecursive(this: Mut<this>, t: RecursiveType, args: Type[]): RecursiveType {
    const name = this.host.resolverState.recursiveAliases.get(t);
    if (name === undefined) return t;
    const a = cloneTypeAlias(this.host.decls.aliases.get(name)!);
    let keys: string[] = [];
    for (const x of args) keys.push(this.host.tables.typing.keyOf(x));
    const key = `${name}<${keys.join(",")}>`;
    const of = this.aliasType(a, args, a);
    let back = this.host.resolverState.recursives.get(key);
    if (back === undefined) {
      let shown: string[] = [];
      for (const x of args) shown.push(this.host.tables.typing.show(x));
      let given: Type[] = [];
      for (const x of args) given.push(x);
      const made = this.host.tables.typing.recursiveType(`${name}<${shown.join(", ")}>`, given);
      this.host.resolverState.recursives.set(key, made);
      this.host.tables.typing.standsFor(made, of);
      this.host.resolverState.recursiveAliases.set(made, name);
      back = made;
    }
    this.host.tables.typing.noteRecursiveInstance(name, key, back);
    this.remakeLowered(back, args);
    return back;
  }

  // A recursive type remade from type arguments with their brands lowered, and fully lowered,
  // when either differs, so lowering finds those instances made.
  /** @throws {CompileError} */
  remakeLowered(this: Mut<this>, back: RecursiveType, args: Ref<Type[]>) {
    let branded: Type[] = [];
    let changed = false;
    for (const x of args) {
      const lowered = this.host.tables.typing.lowerKeepingBrands(x);
      if (lowered !== x) changed = true;
      branded.push(lowered);
    }
    if (changed) this.remakeRecursive(back, branded);
    let lowered: Type[] = [];
    changed = false;
    for (const x of args) {
      const l = this.host.tables.typing.lower(x);
      if (l !== x) changed = true;
      lowered.push(l);
    }
    if (changed) this.remakeRecursive(back, lowered);
  }

  // Resolves every alias and interface once, so a mistake in one is reported even when nothing
  // uses it. Run once classes are linked, since an alias may read a class's fields.
  /** @throws {CompileError} */
  validate(this: Mut<this>) {
    let aliases: string[] = [];
    for (const name of this.host.decls.aliases.keys()) aliases.push(name);
    for (const name of aliases) {
      const a = cloneTypeAlias(this.host.decls.aliases.get(name)!);
      const scope = placeholders(this.host, a.typeParams, undefined, undefined);
      let args: Type[] = [];
      for (const t of scope.values()) args.push(t);
      if (a.typeParams.length > 0) this.host.resolverState.deferring++;
      try {
        this.aliasType(a, args, a);
      } finally {
        if (a.typeParams.length > 0) this.host.resolverState.deferring--;
      }
    }
    // A generic interface is checked once with placeholders for its parameters.
    let interfaces: string[] = [];
    for (const name of this.host.decls.interfaces.keys()) interfaces.push(name);
    for (const name of interfaces) {
      const i = cloneInterface(this.host.decls.interfaces.get(name)!);
      let args: Type[] = [];
      const scope = placeholders(this.host, i.typeParams, undefined, undefined);
      for (const t of scope.values()) args.push(t);
      this.interfaceOf(i, args, i);
    }
  }

  // A data-carrying enum made with these type arguments: a variant per member, its payload
  // types resolved with the type parameters bound, and the enum as their union. An enum
  // holding itself would be infinitely large.
  /** @throws {CompileError} */
  enumInstance(this: Mut<this>, enumName: string, given: Ref<Type[]>, at: Ref<Span>): EnumInstance {
    for (const a of given) unboxedClosure(this.host.tables.typing, a, at);
    let args: Type[] = [];
    for (const t of given) args.push(this.host.tables.typing.heldArgument(t));
    const declared = this.host.enums.get(enumName)!.data!;
    const data = { id: declared.id, name: declared.name, params: copyStrings(declared.params) };
    if (args.length !== data.params.length) {
      const n = data.params.length;
      throw new CompileError("E0707", `enum '${data.name}' takes ${n} type argument${n === 1 ? "" : "s"}`, at.start, at.end);
    }
    let keys: string[] = [];
    for (const t of args) keys.push(this.host.tables.typing.keyOf(t));
    const key = keys.join(",");
    const made = this.host.resolverState.enumInstances.get(`${data.id} ${key}`);
    if (made !== undefined) return copyInstance(made);
    let shownArgs: string[] = [];
    for (const t of args) shownArgs.push(this.host.tables.typing.show(t));
    const shown = args.length > 0 ? `${data.name}<${shownArgs.join(", ")}>` : data.name;
    // Met again while its members are made, it holds itself there, in a block.
    if (this.host.resolverState.making.get(data.id) === key) {
      const known = this.host.resolverState.enumBlocks.get(`${data.id} ${key}`);
      if (known !== undefined) return { type: known, variants: new Map<string, VariantType>() };
      const back = this.host.tables.typing.recursiveType(shown, args);
      this.host.resolverState.enumBlocks.set(`${data.id} ${key}`, back);
      return { type: back, variants: new Map<string, VariantType>() };
    }
    if (this.host.resolverState.making.has(data.id)) throw new CompileError("E0707", `enum '${data.name}' holds itself with other type arguments, which would make it infinitely large`, at.start, at.end);
    this.host.resolverState.making.set(data.id, key);
    let instance: EnumInstance;
    try {
      let bindings = new Map<string, Type>();
      for (let i: usize = 0; i < data.params.length; i++) bindings.set(data.params[i]!, args[i]!);
      let variants = new Map<string, VariantType>();
      const outer = this.enterScope(bindings);
      try {
        let members: EnumMember[] = [];
        const written = this.host.enums.get(enumName)!.data!;
        for (const m of written.members) members.push(cloneEnumMember(m));
        for (const m of members) {
          const payload = this.payloadOf(m, args, at);
          let given: Type[] = [];
          for (const a of args) given.push(a);
          variants.set(m.name, this.host.tables.typing.variantType(data.name, data.id, m.name, given, payload));
        }
      } finally {
        this.host.resolverState.scope = outer;
      }
      let made: Type[] = [];
      for (const v of variants.values()) made.push(v);
      const type = this.host.tables.typing.unionType(made, shown);
      for (const v of variants.values()) {
        let r = this.host.tables.typing.rec(v);
        r.of = type;
        this.host.tables.typing.setRec(v, r);
      }
      const back = this.host.resolverState.enumBlocks.get(`${data.id} ${key}`);
      const union = this.recOf(type);
      if (back !== undefined && union?.kind === "union") {
        this.host.tables.typing.standsFor(back, type);
        this.host.tables.typing.holdsBlock(type as UnionType, back);
      }
      instance = { type, variants };
      this.host.resolverState.enumInstances.set(`${data.id} ${key}`, copyInstance(instance));
    } finally {
      this.host.resolverState.making.delete(data.id);
    }
    // Lowering reads the instance made from the lowered arguments, made once this one is done.
    let lowered: Type[] = [];
    let changed = false;
    for (const a of args) {
      const l = this.host.tables.typing.lower(a);
      if (l !== a) changed = true;
      lowered.push(l);
    }
    if (changed) this.enumInstance(enumName, lowered, at);
    return instance;
  }

  // The types of an enum member's payload, resolved with the enum's type parameters in scope.
  /** @throws {CompileError} */
  private payloadOf(this: Mut<this>, m: Ref<DataEnum["members"][usize]>, args: Ref<Type[]>, at: Ref<Span>): Type[] {
    let out: Type[] = [];
    if (m.payload === undefined) return out;
    for (const t of m.payload) {
      const resolved = this.resolveType(t);
      const type = storable(this.host.tables.typing, resolved, spanOf(t));
      // A held reference would need its enum tracked as a borrower.
      // Said where the enum is used when its type argument brought the reference.
      if (this.host.tables.typing.holdsRef(type)) {
        let given = false;
        for (const a of args) if (this.host.tables.typing.holdsRef(a)) given = true;
        throw unsupported("enum members holding references", given ? at : t);
      }
      // An enum is laid out as written; one made from a pattern type argument is remade from its lowered argument.
      if (this.host.tables.typing.holdsPattern(type)) {
        let patterned = false;
        for (const a of args) if (this.host.tables.typing.holdsPattern(a)) patterned = true;
        if (!patterned) throw unsupported("template literal pattern types in enum members", t);
      }
      out.push(type);
    }
    return out;
  }

  // A type resolved with `scope`, or no type parameters, in scope.
  /** @throws {CompileError} */
  resolveIn(this: Mut<this>, scope: Ref<Map<string, Type>> | undefined, t: Ref<TypeNode>): Type {
    let bindings = new Map<string, Type>();
    if (scope !== undefined) for (const [n, x] of scope) bindings.set(n, x);
    const outer = this.enterScope(bindings);
    try {
      return this.resolveType(t);
    } finally {
      this.host.resolverState.scope = outer;
    }
  }

  /** @throws {CompileError} */
  withScope<T>(this: Mut<this>, bindings: Map<string, Type>, f: InScope<T>): T {
    const outer = this.enterScope(bindings);
    try {
      return f();
    } finally {
      this.host.resolverState.scope = outer;
    }
  }
  // Puts `bindings` in scope, giving a copy of the scope they replace, which is put back after.
  enterScope(this: Mut<this>, bindings: Map<string, Type>): Map<string, Type> {
    const outer = this.scopeCopy();
    this.host.resolverState.scope = bindings;
    return outer;
  }
  // The scope there, with `extra` added over it.
  scopeAnd(extra: Ref<Map<string, Type>>): Map<string, Type> {
    let out = this.scopeCopy();
    for (const [name, t] of extra) out.set(name, t);
    return out;
  }
  // A type written where its declaration is, with only top-level names in sight and `bindings`
  // in scope.
  /** @throws {CompileError} */
  resolveDeclared(this: Mut<this>, bindings: Ref<Map<string, Type>>, t: Ref<TypeNode>): Type {
    const outer = this.enterSight(undefined);
    try {
      return this.resolveIn(bindings, t);
    } finally {
      this.host.resolverState.sight = outer;
    }
  }
  // The type parameters in scope, and what each stands for, copied.
  scopeCopy(): Map<string, Type> {
    let out = new Map<string, Type>();
    for (const [name, t] of this.host.resolverState.scope) out.set(name, t);
    return out;
  }

  // TypeScript's strict mode has no implicit `any`, and Fish has no `any` at all. Only a
  // constructor's parameters may carry modifiers, which make them parameter properties.
  /** @throws {CompileError} */
  paramType(this: Mut<this>, p: Ref<Param>, property = false): Type {
    const name = paramName(p);
    if (p.decorators.length > 0) throw unsupported("decorators", p);
    if (p.modifiers.length > 0 && !property) throw unsupported("parameter properties", p);
    if (name === "this") throw unsupported("'this' parameters", p);
    if (p.default !== undefined) throw unsupported("default parameter values", p);
    if (p.type === undefined) throw new CompileError("E0104", `parameter '${name}' implicitly has an 'any' type; add a type annotation`, p.start, p.end);
    // A parameter with a default is optional to callers, and holds its declared type in the body.
    const lowered = this.host.tables.defaulted.get(p);
    if (lowered !== undefined) {
      const declared = this.resolveType(p.type!);
      const low = this.host.tables.typing.lower(declared);
      const kind = this.recOf(low)?.kind;
      if (kind !== undefined && ["function", "closure", "dyn", "interface", "param", "ref", "future", "generator", "handle"].includes(kind)) {
        throw new CompileError("E0801", `defaults on parameters of type '${this.host.tables.typing.show(declared)}' are not supported yet`, p.start, p.end);
      }
      if (holdsNull(this.host.tables.typing, declared) && !lowered.empty) throw new CompileError("E0801", `a parameter that may be null can have only 'null' as its default so far, since a passed null and a missing argument would look the same; write '${lowered.name}?: ...' and give the default in the body`, p.start, p.end);
      this.host.tables.declaredTypes.set(cloneParam(p), declared);
    }
    // A call may leave out an optional parameter, which is then empty.
    let type: Type;
    if (p.optional) {
      const member = this.unionMember(p.type);
      type = this.host.tables.typing.unionType([member, "null"]);
    } else type = this.resolveType(p.type!);
    const r = this.recOf(type);
    if (p.rest && r?.kind !== "array") throw new CompileError("E0408", `a rest parameter takes an array of the values, as in '...${name}: ${this.host.tables.typing.show(type)}[]'`, p.type.start, p.type.end);
    // A comptime parameter makes an instance per value, so its type is one whose values compare.

    // A tag's strings, `TemplateStringsArray`, are an array of strings.
    const strings = r?.kind === "array" && r.element === "string";
    if (p.comptime && (p.optional || !(keyed(this.host.tables.typing, type) || strings))) throw new CompileError("E1102", `a comptime parameter takes an integer, a boolean, a string, an enum member or a string array, not '${this.host.tables.typing.show(type)}'`, p.type.start, p.type.end);
    return type;
  }

  // A function value is one compiled function, so a function it is given is a stored callable,
  // as in `(resolve: (value: T) => void) => void`.
  /** @throws {CompileError} */
  private callbackParam(this: Mut<this>, p: Ref<Param>): Type {
    const t = this.paramType(p);
    const r = this.recOf(t);
    return r?.kind === "function" && r.generic === undefined ? this.host.tables.typing.stored(t) : t;
  }

  // What a function type's `throws` clause names, as a declared function's may name.
  /** @throws {CompileError} */
  private thrownBy(this: Mut<this>, t: Ref<Extract<TypeNode, { kind: "function" }>>, returns: Type): Type | undefined {
    if (t.throws === undefined) return undefined;
    const thrown: Ref<TypeNode> = t.throws;
    // An async function's error comes at the `await`, with its future, not from the call.
    if (this.host.tables.typing.promiseElement(returns) !== undefined) throw unsupported("function types giving a Promise that throw", thrown);
    const error = this.resolveType(t.throws!);
    if (error === "void") throw new CompileError("E0118", "a function can't throw 'void'; throw a value", thrown.start, thrown.end);
    if (this.host.tables.typing.holdsRef(error)) throw unsupported("errors holding references", thrown);
    return error;
  }

  // An array of an element type. Arrays of functions, which would need their calls boxed,
  // aren't supported yet.
  /** @throws {CompileError} */
  private array(this: Mut<this>, element: Type, at: Ref<TypeNode>): Type {
    const e = this.recOf(element);
    if (e?.kind === "closure") throw unsupported("arrays of functions", at);
    if (e?.kind === "function" && e.generic !== undefined) throw new CompileError("E0115", familyHeld("an array"), at.start, at.end);
    if (e?.kind === "function") {
      const stored = this.host.tables.typing.stored(element);
      return this.host.tables.typing.arrayType(stored);
    }
    if (e?.kind === "interface") {
      const stored = this.host.tables.typing.stored(element);
      if (stored !== element) return this.host.tables.typing.arrayType(stored);
    }
    // An interface describes values of many types, each laid out its own way, so an array of
    // them has no one element size.
    if (e?.kind === "interface") {
      throw new CompileError("E0115", `an array can't hold the interface type '${e.name}' directly, since its values may each be a different type; use 'Dyn<${e.name}>[]' to hold any of them`, at.start, at.end);
    }
    return this.host.tables.typing.arrayType(element);
  }

  // `FixedArray<T, N>`: N elements of T held inline, N a number written in place.
  /** @throws {CompileError} */
  private fixedArray(this: Mut<this>, t: Ref<Extract<TypeNode, { kind: "ref" }>>): Type {
    if (t.args.length !== 2) throw new CompileError("E0116", "'FixedArray' takes an element type and a length, like 'FixedArray<i64, 4>'", t.start, t.end);
    const of: Ref<TypeNode> = t.args[0]!;
    const n: Ref<TypeNode> = t.args[1]!;
    if (n.kind === "literal" && n.value.kind === "unary" && n.value.op === "-") throw new CompileError("E0116", "a FixedArray's length can't be negative", n.start, n.end);
    const size = n.kind === "literal" && n.value.kind === "int" ? n.value.value : undefined;
    if (size === undefined) throw new CompileError("E0116", "a FixedArray's length is a number written in place, like 'FixedArray<i64, 4>'", n.start, n.end);
    const resolved = this.resolveType(of);
    const element = storable(this.host.tables.typing, resolved, spanOf(of));
    // A fixed array copies when its elements do, and a copy of a mutable reference would be a second one.
    if (this.host.tables.typing.holdsMut(element)) throw unsupported("fixed arrays of mutable references", spanOf(of));
    // Its elements live where it does, often the stack, so all of them together are limited.
    if (size * BigInt(byteSize(this.host.tables.typing, element)) > 65536n) throw new CompileError("E0116", "a FixedArray holds at most 64 KiB inline, whatever its elements hold inline counted; use an array, 'T[]', for more", n.start, n.end);
    const e = this.recOf(element);
    if (e?.kind === "interface") throw new CompileError("E0115", `a FixedArray can't hold the interface type '${e.name}' directly; use 'Dyn<${e.name}>'`, of.start, of.end);
    return this.host.tables.typing.fixedType(element, parseInt(size.toString())! as usize);
  }

  /** @throws {CompileError} */
  resolveType(this: Mut<this>, t: Ref<TypeNode>): Type {
    const preset = this.host.tables.presetTypes.get(t);
    if (preset !== undefined) {
      let swap = new TypeMap<Type, Type>();
      for (const u of this.host.tables.typing.partsOf(preset, true)) {
        const r = this.recOf(u);
        const bound = r?.kind === "param" ? this.host.resolverState.scope.get(r.name) : undefined;
        if (bound !== undefined && bound !== u) swap.set(u, bound);
      }
      return swap.size > 0 ? this.host.replaced(preset, swap) : preset;
    }
    // `readonly T[]` is a shared borrow of an array.
    if (t.kind === "operator" && t.op === "readonly" && t.type.kind === "array") {
      const element = this.resolveType(t.type.element);
      const array = this.host.tables.typing.arrayType(element);
      return this.host.tables.typing.refType(array, false);
    }
    // `readonly [A, B]` is the tuple with its positions read-only, a value like any tuple.
    if (t.kind === "operator" && t.op === "readonly" && t.type.kind === "tuple") {
      const tuple = this.resolveType(t.type) as ObjectType;
      const required = this.host.tables.typing.rec(tuple).required;
      const rest = this.host.tables.typing.rec(tuple).rest;
      const elements = this.host.tables.typing.elementsOf(tuple);
      const count = elements.length;
      return this.host.tables.typing.tupleType(elements, required ?? count, rest, true);
    }
    if (t.kind === "operator" && t.op === "keyof") {
      const of = this.resolveType(t.type);
      return this.typeFns().keyofType(of, spanOf(t));
    }
    if (t.kind === "operator") throw unsupported(`'${t.op}' types`, t);
    if (t.kind === "indexed") {
      const object = this.resolveType(t.object);
      const index = this.resolveType(t.index);
      return this.typeFns().indexedType(object, index, spanOf(t), spanOf(t.index));
    }
    if (t.kind === "conditional") return this.conditional(t);
    if (t.kind === "mapped") return this.mapped(t);
    if (t.kind === "template") {
      let holes: Type[] = [];
      let holeAt: Span[] = [];
      for (const hole of t.types) {
        holes.push(this.resolveType(hole));
        holeAt.push(spanOf(hole));
      }
      const held = standIn(this.host.tables.typing, holes, "a template literal type", spanOf(t), false, this.host.resolverState.deferring > 0);
      if (held !== undefined) return held;
      return this.typeFns().templateType(t.quasis, holes, spanOf(t), holeAt);
    }
    if (t.kind === "infer") throw new CompileError("E0114", `'infer ${t.name}' declares a type only inside a conditional type's 'extends' clause, like 'T extends (infer U)[] ? U : never'`, t.start, t.end);
    if (t.kind === "function") {
      if (t.construct) throw unsupported("constructor types", t);
      const rest = t.params.find((p) => p.rest);
      if (rest !== undefined) throw unsupported("rest parameters in function types", rest);
      // A generic one is shown and compared with its own parameters standing for themselves.
      if (t.typeParams.length > 0) {
        if (t.throws !== undefined) throw unsupported("generic function types that throw", t.throws);
        const around = this.scopeCopy();
        const own = placeholders(this.host, t.typeParams, scopes(around, new Map<string, Type>()), undefined);
        const outer = this.enterScope(scopes(around, own));
        let fn: FunctionType;
        try {
          let names: string[] = [];
          let params: Type[] = [];
          for (const p of t.params) names.push(paramName(p));
          for (const p of t.params) params.push(this.callbackParam(p));
          const returns = this.resolveType(t.returns);
          fn = this.host.tables.typing.functionType(names, params, returns);
        } finally {
          this.host.resolverState.scope = outer;
        }
        let typeNames: string[] = [];
        for (const p of t.typeParams) typeNames.push(p.name);
        let typeParams: TypeParam[] = [];
        for (const p of t.typeParams) typeParams.push(cloneTypeParam(p));
        let written: Param[] = [];
        for (const p of t.params) written.push(cloneParam(p));
        const node: FamilyNode = { typeParams, params: written, returns: cloneTypeNode(t.returns) };
        let ownTypes: Type[] = [];
        for (const x of own.values()) ownTypes.push(x);
        let r = this.host.tables.typing.rec(fn);
        r.name = `<${typeNames.join(", ")}>${r.name}`;
        r.generic = { names: typeNames, node, scope: around, own: ownTypes };
        this.host.tables.typing.setRec(fn, r);
        return fn;
      }
      const returns = this.resolveType(t.returns);
      let names: string[] = [];
      for (const p of t.params) names.push(paramName(p));
      let params: Type[] = [];
      for (const p of t.params) params.push(this.callbackParam(p));
      const thrown = this.thrownBy(t, returns);
      const fn = this.host.tables.typing.functionType(names, params, returns, thrown);
      if ([this.host.tables.typing.rec(fn).returns, ...this.host.tables.typing.rec(fn).params].some((t) => this.host.tables.typing.holdsPattern(t))) throw unsupported("template literal pattern types in function types", t);
      return fn;
    }
    if (t.kind === "object") {
      const index = t.members.find((m) => m.kind === "index");
      if (index?.kind === "index") return this.dictionary(index, t.members.length);
      if (t.members.some((m) => m.kind === "method")) return this.inlineTrait(t);
      let members: Field[] = [];
      let at: Span[] = [];
      for (const m of t.members) {
        members.push(this.member(m));
        at.push({ start: m.start, end: m.end });
      }
      return this.host.tables.typing.objectType(fields(members, at));
    }
    if (t.kind === "literal") return this.literal(t.value);
    if (t.kind === "union") return this.union(t.types);
    if (t.kind === "intersection") return this.intersection(t.types);
    if (t.kind === "array") {
      const element = this.resolveType(t.element);
      return this.array(element, t);
    }
    if (t.kind === "tuple") {
      let rest: usize | undefined = undefined;
      for (let k: usize = 0; k < t.elements.length; k++) if (rest === undefined && t.elements[k]!.rest) rest = k;
      if (rest !== undefined && rest < t.elements.length - 1) throw unsupported("rest elements before the end of a tuple type", t.elements[rest]!);
      const fixed: usize = rest === undefined ? t.elements.length : rest;
      let required: usize | undefined = undefined;
      for (let k: usize = 0; k < fixed; k++) if (required === undefined && t.elements[k]!.optional) required = k;
      if (required !== undefined) {
        for (let k: usize = required; k < fixed; k++) {
          const late: Ref<TupleElement> = t.elements[k]!;
          if (!late.optional) throw new CompileError("E0117", "a required element can't follow an optional one; move it before the optional elements", late.start, late.end);
        }
      }
      if (rest !== undefined && required !== undefined) throw unsupported("tuple types with both optional and rest elements", t.elements[rest]!);
      const many = rest === undefined ? undefined : this.resolveType(t.elements[rest]!.type);
      const m = this.recOf(many);
      if (many !== undefined && m?.kind !== "array") throw new CompileError("E0117", `a tuple's rest element is an array type, like '...${this.host.tables.typing.show(many)}[]'`, t.elements[rest!]!.start, t.elements[rest!]!.end);
      const restOf = m?.kind === "array" ? m.element : undefined;
      let elements: Type[] = [];
      for (let k: usize = 0; k < fixed; k++) {
        const e: Ref<TupleElement> = t.elements[k]!;
        const element = this.resolveType(e.type);
        const held = storable(this.host.tables.typing, element, e);
        elements.push(e.optional ? this.host.tables.typing.unionType([held, "null"]) : held);
      }
      const count = elements.length;
      return this.host.tables.typing.tupleType(elements, required ?? count, restOf);
    }
    // `typeof f` or `typeof X`: a top-level function's or const's type.
    if (t.kind === "query") {
      if (t.target.kind !== "ref" || t.target.args.length > 0 || t.target.name.includes(".")) throw unsupported("'typeof' types other than of a top-level function or const", t);
      const shadowed = this.inSight(t.target.name, t);
      return this.host.valueType(t.target.name, spanOf(t), shadowed);
    }
    if (t.kind !== "ref") throw unsupported(typeForm(t.kind)!, t);
    const bound = this.host.resolverState.scope.get(t.name);
    if (bound !== undefined && t.args.length === 0) return bound;
    if (INTEGER_NAMES.includes(t.name) || ["boolean", "void", "number", "f32", "f64", "string", "bigint"].includes(t.name)) {
      if (t.args.length > 0) throw new CompileError("E0106", `type '${t.name}' is not generic`, t.start, t.end);
      // `number` is JavaScript's 64-bit float.
      return primitiveNamed(t.name);
    }
    if (t.name === "Array" && t.args.length === 1) {
      const element = this.resolveType(t.args[0]!);
      return this.array(element, t);
    }
    if (t.name === "FixedArray") return this.fixedArray(t);
    if (t.name === "Array" || t.name === "ReadonlyArray") throw unsupported(t.name === "Array" ? "'Array' without one type argument" : "'ReadonlyArray' types", t);
    if (t.name === "Ref" || t.name === "Mut") return this.reference(t);
    if (t.name === "never" && t.args.length === 0) return "never";
    if (t.name === "unknown" && t.args.length === 0) return this.host.tables.typing.unknownType();
    if (t.name === "null" || t.name === "undefined") {
      if (t.args.length > 0) throw new CompileError("E0106", `type '${t.name}' is not generic`, t.start, t.end);
      return "null";
    }
    if (t.name === "Ptr" || t.name === "MutPtr") {
      if (t.args.length !== 1) throw new CompileError("E0116", `'${t.name}' takes the type it points to, like '${t.name}<u8>'`, t.start, t.end);
      const to = this.resolveType(t.args[0]!);
      return this.host.tables.typing.pointerType(to, t.name === "MutPtr");
    }
    if (INTERIORS.has(t.name)) {
      if (t.args.length !== 1) throw new CompileError("E0116", `'${t.name}' takes the type it holds, like '${t.name}<i64>'`, t.start, t.end);
      const held = this.resolveType(t.args[0]!);
      return interior(this.host.tables.typing, interiorNamed(t.name), held, spanOf(t));
    }
    if (t.name === "Dyn") {
      const of = t.args.length === 1 ? this.resolveType(t.args[0]!) : undefined;
      const o = this.recOf(of);
      if (o?.kind !== "interface" || this.host.tables.typing.promiseElement(of!) !== undefined || this.host.tables.typing.generatorElement(of!) !== undefined) {
        throw new CompileError("E0116", "'Dyn' takes the interface its values implement, like 'Dyn<Handler>'", t.start, t.end);
      }
      return this.host.tables.typing.dynType(of as InterfaceType);
    }
    if (t.name === "RegExp") {
      if (t.args.length !== 0) throw new CompileError("E0106", "'RegExp' takes no type arguments", t.start, t.end);
      return ANY_REGEX;
    }
    const block = blockNamed(t.name);
    if (block !== undefined) {
      if (t.args.length !== 0) throw new CompileError("E0106", `'${t.name}' takes no type arguments`, t.start, t.end);
      return this.host.tables.typing.blockType(block);
    }
    // std's FileHandle's counted descriptor, which closes its file when the last count goes.
    if (t.name === "__FileDescriptor" && t.args.length === 0) return this.host.tables.typing.blockType("FileDescriptor");
    if (t.name === "Channel") {
      if (t.args.length !== 1) throw new CompileError("E0116", "'Channel' takes the type it carries, like 'Channel<string>'", t.start, t.end);
      const held = this.resolveType(t.args[0]!);
      return channel(this.host.tables.typing, held, t);
    }
    if (t.name === "Map" || t.name === "Set") {
      const set = t.name === "Set";
      if (t.args.length !== (set ? 1 : 2)) throw new CompileError("E0116", set ? "'Set' takes the type of its members, like 'Set<string>'" : "'Map' takes its key and value types, like 'Map<string, i64>'", t.start, t.end);
      const key = this.resolveType(t.args[0]!);
      const value = set ? "void" : this.resolveType(t.args[1]!);
      return collection(this.host.tables.typing, key, value, set, t);
    }
    if (t.name === "shared") {
      if (t.args.length !== 1) throw new CompileError("E0116", "'shared' takes the type it holds, like 'shared<State>'", t.start, t.end);
      const held = this.resolveType(t.args[0]!);
      return shareable(this.host.tables.typing, held, t);
    }
    if (t.name === "Rc" || t.name === "Weak") {
      if (t.args.length !== 1) throw new CompileError("E0116", `'${t.name}' takes the type it holds, like '${t.name}<Node>'`, t.start, t.end);
      const held = this.resolveType(t.args[0]!);
      return counted(this.host.tables.typing, held, t.name === "Rc" ? "Rc" : "Weak", spanOf(t));
    }
    // A `JoinHandle<T>` written out is one whose task can't throw.
    if (t.name === "JoinHandle") {
      if (t.args.length !== 1) throw new CompileError("E0116", "'JoinHandle' takes the type its task gives, like 'JoinHandle<i64>'", t.start, t.end);
      const of = this.resolveType(t.args[0]!);
      const held = this.host.tables.typing.heldArgument(of);
      return this.host.tables.typing.handleType(held, undefined);
    }
    if (t.name === "Promise") {
      if (t.args.length !== 1) throw new CompileError("E0116", "'Promise' takes the type it gives once awaited, like 'Promise<i64>'", t.start, t.end);
      const of = this.resolveType(t.args[0]!);
      const gives = this.host.tables.typing.heldArgument(of);
      if (this.host.tables.typing.holdsPattern(gives)) throw unsupported("template literal pattern types in promises", t);
      return this.host.tables.typing.promiseInterface(gives);
    }
    // `Generator<T, R, N>`: what it yields, what it returns, which is nothing yet, and what
    // `next(x)` sends it.
    if (t.name === "Generator" || t.name === "AsyncGenerator") {
      if (t.args.length < 1 || t.args.length > 3) throw new CompileError("E0116", `'${t.name}' takes the type it yields, like '${t.name}<i64>', then optionally 'void' and the type 'next' sends`, t.start, t.end);
      if (t.args.length > 1) {
        const returned: Ref<TypeNode> = t.args[1]!;
        if (this.resolveType(returned) !== "void" && !(returned.kind === "ref" && returned.name === "undefined")) throw unsupported("generator return values", returned);
      }
      const sends = t.args.length > 2 ? this.resolveType(t.args[2]!) : undefined;
      if (sends !== undefined && t.name === "AsyncGenerator") throw unsupported("values sent into an async generator's 'next'", t.args[2]!);
      if (sends !== undefined && this.host.tables.typing.holdsRef(sends)) throw unsupported("references sent into generators", t.args[2]!);
      const yields = this.resolveType(t.args[0]!);
      return t.name === "Generator" ? this.host.tables.typing.generatorInterface(yields, sends) : this.host.tables.typing.asyncGeneratorInterface(yields);
    }
    if (t.name === "Option") {
      if (t.args.length !== 1) throw new CompileError("E0116", "'Option' takes the type it may hold, like 'Option<i64>'", t.start, t.end);
      const member = this.unionMember(t.args[0]!, true);
      return this.host.tables.typing.unionType([member, "null"]);
    }
    // A class's lifetimes, written or left out, are no type arguments.
    const slots = this.host.decls.slots.get(t.name);
    const lifetime = slots === undefined ? undefined : [...slots];
    const skipping = lifetime !== undefined && t.args.length === lifetime.length;
    let args: Type[] = [];
    for (let i: usize = 0; i < t.args.length; i++) if (!skipping || !lifetime![i]!) args.push(this.resolveType(t.args[i]!));
    const written = this.host.decls.aliases.get(t.name);
    const alias = written === undefined ? undefined : cloneTypeAlias(written);
    // A package's object type is a JS handle of that shape; its other aliases are what they say.
    if (alias !== undefined && alias.js !== undefined) {
      const aliased = this.aliasType(alias, args, t);
      const r = this.recOf(aliased);
      if (r?.kind === "object" && r.tuple !== true) return this.host.tables.typing.blockType("JsValue", aliased);
      return aliased;
    }
    if (alias !== undefined) return this.aliasType(alias, args, t);
    const named = this.host.classNamed(t.name, copyTypes(args), spanOf(t));
    if (named !== undefined && this.host.tables.typing.rec(named).abstract === true) throw new CompileError("E0701", `'${t.name}' is an abstract class, which only exists embedded in its subclasses, so it can't be a value's type; describe what they share with an interface instead`, t.start, t.end);
    if (named !== undefined) return named;
    const parts = t.name.split(".");
    const owner = parts[0]!;
    const name = parts.length > 1 ? parts[1] : undefined;
    const isEnum = this.host.enums.has(owner);
    const data = isEnum && this.host.enums.get(owner)!.data !== undefined;
    if (data) {
      const instance = this.enumInstance(owner, args, t);
      if (name === undefined) return instance.type;
      const variant = instance.variants.get(name);
      if (variant !== undefined) return variant;
    }
    if (isEnum && name === undefined) return this.host.enumType(owner);
    const found = isEnum ? this.host.enumMember(owner, name!) : undefined;
    if (found !== undefined) return found;
    const declared = this.host.decls.interfaces.get(t.name);
    const trait = declared === undefined ? undefined : cloneInterface(declared);
    // A package's interface or class is a JS handle of its shape.
    if (trait !== undefined && trait.js !== undefined) {
      const viewed = this.interfaceOf(trait, args, t);
      return this.host.tables.typing.blockType("JsValue", viewed);
    }
    if (trait !== undefined) {
      let held: Type[] = [];
      for (const a of args) held.push(this.host.tables.typing.heldArgument(a));
      return this.interfaceOf(trait, held, t);
    }
    // JavaScript's typed arrays, unless the program declares its own of the name.
    const typed = typedNamed(t.name);
    if (typed !== undefined) {
      if (t.args.length > 0) throw new CompileError("E0106", `'${t.name}' takes no type arguments`, t.start, t.end);
      return this.host.tables.typing.typedArray(typed);
    }
    // Brands and units, unless the program declares its own of the name.
    if (t.name === "Unit") {
      let written: string | undefined = undefined;
      if (t.args.length > 1) {
        const text: Ref<TypeNode> = t.args[1]!;
        if (text.kind === "literal" && text.value.kind === "string") written = text.value.value;
      }
      const powers = written !== undefined ? unitPowers(written) : undefined;
      const base = t.args.length > 0 ? args[0] : undefined;
      if (t.args.length !== 2 || base === undefined || !isNumeric(base) || powers === undefined) throw new CompileError("E0116", "'Unit' takes a number type and its unit, like 'Unit<f64, \"m/s\">', the unit names with powers over at most one '/'", t.start, t.end);
      let cancels = true;
      for (const p of Object.values(powers)) if (p !== 0) cancels = false;
      if (cancels) throw new CompileError("E0116", `the unit '${written!}' cancels to none, so this is a plain '${this.host.tables.typing.show(base)}'; write that instead`, t.start, t.end);
      return this.host.tables.typing.unitType(base, powers);
    }
    if (t.name === "Brand") {
      if (t.args.length !== 2) throw new CompileError("E0116", "'Brand' takes the type it brands and a tag naming it, like 'Brand<usize, \"UserId\">'", t.start, t.end);
      return this.brand(args[0]!, args[1]!, spanOf(t.args[0]!), spanOf(t.args[1]!), {});
    }
    // TypeScript's utility types, unless the program declares its own of the name.
    const utility = UTILITIES.get(t.name);
    if (utility !== undefined) {
      const count = utility[0];
      const example = utility[1];
      if (args.length !== count) throw new CompileError("E0106", `'${t.name}' takes ${count === 1 ? "one type argument" : "two type arguments"}, like '${example}'`, t.start, t.end);
      let argAt: Span[] = [];
      for (const a of t.args) argAt.push(spanOf(a));
      // Over a JS handle, a utility type remakes its shape's fields, and gives a handle again.
      let shapes: (Type | undefined)[] = [];
      let handles = false;
      for (const a of args) {
        const shape = this.host.tables.typing.jsShape(a);
        if (shape !== undefined) handles = true;
        shapes.push(shape);
      }
      if (handles) {
        let given: Type[] = [];
        for (let k: usize = 0; k < args.length; k++) {
          const shape = shapes[k];
          if (shape === undefined) {
            given.push(args[k]!);
            continue;
          }
          let fields: Field[] = [];
          const record = this.host.tables.typing.rec(shape as Exclude<Type, string>);
          for (const f of record.fields) fields.push(copyField(f));
          given.push(this.host.tables.typing.objectType(fields));
        }
        const made = this.typeFns().utility(t.name, given, spanOf(t), argAt);
        const r = this.recOf(made);
        if (r?.kind === "object" && r.tuple !== true) return this.host.tables.typing.blockType("JsValue", made);
        return made;
      }
      return this.typeFns().utility(t.name, args, spanOf(t), argAt);
    }
    // TypeScript's iterator types, unless the program declares its own of the name: an iterator is
    // what a generator is, and an iterable anything `for...of` reads.
    if (ITERATORS.includes(t.name)) {
      if (args.length !== 1) throw new CompileError("E0116", `'${t.name}' takes the type it gives, like '${t.name}<i64>'`, t.start, t.end);
      return t.name === "Iterable" ? this.host.tables.typing.iterableInterface(args[0]!) : this.host.tables.typing.generatorInterface(args[0]!);
    }
    if (t.name === "this") throw new CompileError("E0105", "'this' as a type is supported only in a class's instance methods: in the return type, where it is the receiver's own class, and in parameter types, where it is the class that declares the method", t.start, t.end);
    throw new CompileError("E0105", `cannot find type '${t.name}'${didYouMean(t.name, [...this.host.resolverState.scope.keys(), ...BUILT_IN_TYPES, "Array", "FixedArray", "Brand", "Unit", "never", ...ITERATORS, ...UTILITIES.keys(), ...this.host.typeNames(t.start)])}`, t.start, t.end);
  }

  // TypeScript's brand idiom, `usize & { readonly __brand: "X" }`: a primitive and an object of
  // one property, whose type names the brand. An optional property makes a loose brand, which
  // the base fits too, as it does in TypeScript.
  /** @throws {CompileError} */
  private brandIdiom(this: Mut<this>, nodes: Ref<TypeNode[]>, sides: Ref<Type[]>): Type | undefined {
    if (sides.length !== 2) return undefined;
    const at: usize = typeof sides[0] === "string" ? 0 : 1;
    const base = sides[at]!;
    const other = sides[1 - at]!;
    const r = this.recOf(other);
    if (typeof base !== "string" || r?.kind !== "object" || r.tuple === true || r.fields.length !== 1) return undefined;
    const field = copyField(r.fields[0]!);
    const tag = field.optional === "added" ? this.host.tables.typing.withoutNull(field.type) : field.type;
    // A property of a plain type, as in `i64 & { a: i64 }`, describes a value rather than naming one.
    if (typeof tag === "string") return undefined;
    let how: BrandHow = { field: field.name };
    if (field.optional !== undefined) how.loose = true;
    return this.brand(base, tag, spanOf(nodes[at]!), spanOf(nodes[1 - at]!), how);
  }

  // A brand's base is a primitive, and its tag is known where it is written, since nothing infers
  // a tag from a value.
  /** @throws {CompileError} */
  private brand(this: Mut<this>, base: Type, tag: Type, baseNode: Ref<Span>, tagNode: Ref<Span>, how: BrandHow): Type {
    if (typeof base !== "string" || base === "void" || base === "null" || base === "never") {
      throw new CompileError("E0116", `a brand's base is a number, boolean, string or bigint type, not '${this.host.tables.typing.show(base)}'`, baseNode.start, baseNode.end);
    }
    for (const u of this.host.tables.typing.partsOf(tag)) if (this.recOf(u)?.kind === "param") throw unsupported("brand tags holding type parameters", tagNode);
    return this.host.tables.typing.brandType(base, tag, how);
  }

  // `Ref<T>` borrows a T, and `Mut<T>` borrows it mutably.
  // `Ref<T, A>` also names the lifetime parameter it lives for, checked by the function.
  /** @throws {CompileError} */
  private reference(this: Mut<this>, t: Ref<Extract<TypeNode, { kind: "ref" }>>): Type {
    if (t.args.length !== 1 && t.args.length !== 2) {
      throw new CompileError("E0209", `type '${t.name}' takes the type it borrows, and optionally a lifetime`, t.start, t.end);
    }
    const to = this.resolveType(t.args[0]!);
    if (to === "void") throw new CompileError("E0118", "there is no 'void' value to borrow", t.start, t.end);
    if (this.recOf(to)?.kind === "function") throw unsupported("references to functions", t);
    // A type parameter standing for a reference makes one too.
    const lowered = this.host.tables.typing.lower(to);
    if (this.recOf(lowered)?.kind === "ref") throw unsupported("references to references", t);
    if (t.args.length < 2) return this.host.tables.typing.refType(to, t.name === "Mut", undefined);
    const life: Ref<TypeNode> = t.args[1]!;
    if (life.kind !== "ref" || life.args.length > 0) throw new CompileError("E0209", "a lifetime is a name declared as '<A extends Lifetime>'", life.start, life.end);
    return this.host.tables.typing.refType(to, t.name === "Mut", life.name);
  }

  // A union holds a bare reference only as a reference or nothing, `Ref<T> | null`, as Rust's
  // `Option<&T>` is; other references sit in object members a tag tells apart.
  /** @throws {CompileError} */
  private union(this: Mut<this>, nodes: Ref<TypeNode[]>): Type {
    let present: usize = 0;
    for (const n of nodes) if (!(n.kind === "ref" && (n.name === "null" || n.name === "undefined") && n.args.length === 0)) present++;
    const option = present === 1;
    let members: Type[] = [];
    for (const n of nodes) members.push(this.unionMember(n, option));
    return this.host.tables.typing.unionType(members);
  }

  // A union holds values, so an interface, which describes values without being one, can't be
  // a member, and neither can `void`.
  /** @throws {CompileError} */
  private unionMember(this: Mut<this>, node: Ref<TypeNode>, option = false): Type {
    const t = this.resolveType(node);
    if (t === "void") throw new CompileError("E0118", "'void' can't be a union member", node.start, node.end);
    const r = this.recOf(t);
    if (r?.kind === "interface") throw new CompileError("E0115", `an interface can't be a union member; '${r.name}' describes values without being one`, node.start, node.end);
    // A union holds a value, so a function type in one is a stored callable.
    if (r?.kind === "function" && r.generic !== undefined) throw new CompileError("E0115", familyHeld("a union"), node.start, node.end);
    if (r?.kind === "function") return this.host.tables.typing.stored(t);
    if (r?.kind === "ref" && !option) throw new CompileError("E0801", `unions of bare references are not supported yet; hold each in an object member with a tag, like '{ kind: "a"; node: Ref<A> }'`, node.start, node.end);
    return t;
  }

  /** @throws {CompileError} */
  private literal(this: Mut<this>, e: Ref<Expr>): Type {
    if (e.kind === "string" || e.kind === "bool") return this.host.tables.typing.literalType(e.value);
    let value: bigint;
    if (e.kind === "unary" && e.op === "-" && e.operand.kind === "int") value = -e.operand.value;
    else if (e.kind === "int") value = e.value;
    else throw unsupported("literal types of this kind", e);
    if (value > I64_MAX || value < -I64_MAX - 1n) throw new CompileError("E0110", "integer literal does not fit in i64", e.start, e.end);
    return this.host.tables.typing.literalType(value);
  }

  // `A & B` of object types is one object type with the fields of both. With an interface it
  // is a combined bound: an interface with every side's fields and methods. A union of object
  // types as a side distributes, as in TypeScript: `A & (B | C)` is `(A & B) | (A & C)`.
  /** @throws {CompileError} */
  private intersection(this: Mut<this>, nodes: Ref<TypeNode[]>): Type {
    let resolved: Type[] = [];
    for (const node of nodes) resolved.push(this.resolveType(node));
    // A generic alias checked before any use, as `type Brand<K, T> = K & { __brand: T }`, is
    // known only per use.
    let open: ParamType | undefined = undefined;
    if (this.host.resolverState.deferring > 0) {
      for (const t of resolved) {
        const found = openParam(this.host.tables.typing, t, true);
        if (open === undefined) open = found;
      }
    }
    if (open !== undefined) return open;
    const branded = this.brandIdiom(nodes, resolved);
    if (branded !== undefined) return branded;
    let sides: Type[] = [];
    for (let i: usize = 0; i < nodes.length; i++) {
      const s = resolved[i]!;
      const kind = this.recOf(s)?.kind;
      if (kind === "object" || kind === "interface") {
        sides.push(s);
        continue;
      }
      if (kind === "union" && this.objectMembers(s)) {
        sides.push(s);
        continue;
      }
      const what = kind === undefined || kind === "literal" ? "primitive types" : kind === "union" ? "unions of other than object types" : SIDE_FORMS.get(kind)!;
      throw unsupported(`intersections with ${what}`, nodes[i]!);
    }
    const from = spanOf(nodes[0]!);
    const to = spanOf(nodes[nodes.length - 1]!);
    let distributes = false;
    for (const s of sides) if (this.host.tables.typing.rec(s as Exclude<Type, string>).kind === "union") distributes = true;
    if (distributes) {
      for (let i: usize = 0; i < sides.length; i++) {
        if (this.host.tables.typing.rec(sides[i]! as Exclude<Type, string>).kind === "interface") throw unsupported("intersections of interfaces with unions", nodes[i]!);
      }
      let combos: ObjectType[][] = [[]];
      for (const s of sides) {
        let choices: Type[] = [];
        const r = this.host.tables.typing.rec(s as Exclude<Type, string>);
        if (r.kind === "union") for (const m of r.members) choices.push(m);
        else choices.push(s);
        let unfolded: ObjectType[] = [];
        for (const m of choices) unfolded.push((r.kind === "union" ? this.host.tables.typing.unfold(m) : m) as ObjectType);
        let next: ObjectType[][] = [];
        for (const c of combos) {
          for (const m of unfolded) {
            let combo: ObjectType[] = [];
            for (const x of c) combo.push(x);
            combo.push(m);
            next.push(combo);
          }
        }
        combos = next;
      }
      let members: Type[] = [];
      for (const c of combos) {
        let acc = c[0]!;
        for (let k: usize = 1; k < c.length; k++) acc = merged(this.host.tables.typing, acc, c[k]!, from, to);
        members.push(acc);
      }
      return this.host.tables.typing.unionType(members);
    }
    let objects: ObjectType[] = [];
    for (const s of sides) {
      let copied: Field[] = [];
      const record1 = this.host.tables.typing.rec(s as Exclude<Type, string>);
      for (const f of record1.fields) copied.push(copyField(f));
      objects.push(this.host.tables.typing.objectType(copied));
    }
    let fields = objects[0]!;
    for (let k: usize = 1; k < objects.length; k++) fields = merged(this.host.tables.typing, fields, objects[k]!, from, to);
    let allObjects = true;
    for (const s of sides) if (this.host.tables.typing.rec(s as Exclude<Type, string>).kind !== "object") allObjects = false;
    if (allObjects) return fields;
    let keys: string[] = [];
    for (const s of sides) keys.push(this.host.tables.typing.keyOf(s));
    const key = keys.join(" & ");
    const known = this.host.resolverState.combined.get(key);
    if (known !== undefined) return known;
    let shown: string[] = [];
    for (const s of sides) shown.push(this.host.tables.typing.show(s));
    const found = this.host.tables.typing.interfaceType(shown.join(" & "));
    this.host.resolverState.combined.set(key, found);
    let r = this.host.tables.typing.rec(found);
    const record2 = this.host.tables.typing.rec(fields);
    for (const f of record2.fields) r.fields.push(copyField(f));
    this.host.tables.typing.setRec(found, r);
    let methods: Method[] = [];
    for (const s of sides) {
      const side = this.host.tables.typing.rec(s as Exclude<Type, string>);
      if (side.kind === "interface") for (const m of side.methods) methods.push(copyMethod(m));
    }
    for (const m of methods) {
      let at: usize | undefined = undefined;
      const have = this.host.tables.typing.rec(found).methods;
      for (let k: usize = 0; k < have.length; k++) if (at === undefined && have[k]!.name === m.name) at = k;
      if (at === undefined) {
        let added = this.host.tables.typing.rec(found);
        added.methods.push(copyMethod(m));
        this.host.tables.typing.setRec(found, added);
        continue;
      }
      const same = copyMethod(this.host.tables.typing.rec(found).methods[at]!);
      if (this.differ(same, m)) throw new CompileError("E0114", `method '${m.name}' has different types on each side of '&'`, from.start, to.end);
      if (same.omittable === true && m.omittable !== true) {
        // A side requiring the method makes the whole require it.
        let replaced = this.host.tables.typing.rec(found);
        replaced.methods[at] = copyMethod(m);
        this.host.tables.typing.setRec(found, replaced);
      }
    }
    return found;
  }

  // Whether two methods of one name have different types.
  private differ(this: Mut<this>, a: Ref<Method>, b: Ref<Method>): boolean {
    if (this.host.tables.typing.shapeKey(a.returns) !== this.host.tables.typing.shapeKey(b.returns)) return true;
    const thrownA = a.throws !== undefined ? this.host.tables.typing.shapeKey(a.throws) : undefined;
    const thrownB = b.throws !== undefined ? this.host.tables.typing.shapeKey(b.throws) : undefined;
    if (thrownA !== thrownB) return true;
    if (a.params.length !== b.params.length) return true;
    for (let i: usize = 0; i < a.params.length; i++) if (this.host.tables.typing.shapeKey(a.params[i]!) !== this.host.tables.typing.shapeKey(b.params[i]!)) return true;
    return false;
  }

  // Whether every member of a union, unfolded, is an object type.
  private objectMembers(this: Mut<this>, u: Type): boolean {
    if (typeof u === "string") return false;
    const count = this.host.tables.typing.rec(u).kind === "union" ? (this.host.tables.typing.rec(u as UnionType)).members.length : 0;
    for (let k: usize = 0; k < count; k++) {
      const m = this.host.tables.typing.rec(u as UnionType).members[k]!;
      if (this.recOf(this.host.tables.typing.unfold(m))?.kind !== "object") return false;
    }
    return true;
  }

  // An object type with a method, written in place, is an interface of its own, generic over the
  // type parameters around it, since its members may name them.
  /** @throws {CompileError} */
  private inlineTrait(this: Mut<this>, t: Ref<Extract<TypeNode, { kind: "object" }>>): InterfaceType {
    const scope = this.scopeCopy();
    let names: string[] = [];
    let args: Type[] = [];
    for (const [k, v] of scope) {
      names.push(k);
      args.push(v);
    }
    const name = `{} ${t.id} ${names.join(",")}`;
    let seen: string[] = [];
    for (const m of t.members) {
      const name = memberName(m);
      if (name === undefined) continue;
      if (seen.includes(name)) throw new CompileError("E0402", `duplicate member '${name}'`, m.start, m.end);
      seen.push(name);
    }
    if (!this.host.resolverState.inline.has(name)) {
      let typeParams: TypeParam[] = [];
      for (const k of names) typeParams.push({ id: nextId(this.host.tables.ids), name: k, constraint: undefined, default: undefined, modifiers: [], start: t.start, end: t.end });
      let members: TypeMember[] = [];
      for (const m of t.members) members.push(cloneTypeMember(m));
      this.host.resolverState.inline.set(name, { id: nextId(this.host.tables.ids), kind: "interface", name, typeParams, extends: [], members, start: t.start, end: t.end });
    }
    // An inline interface is made while resolving, so it is read from a copy.
    const i = cloneInterface(this.host.resolverState.inline.get(name)!);
    const made = this.interfaceOf(i, args, t);
    return this.sameShape(made);
  }

  // Inline object types with the same members are one type wherever they are written, as in
  // TypeScript, so the first interface made with a shape stands for every other.
  private sameShape(this: Mut<this>, made: InterfaceType): InterfaceType {
    const shape = this.shapeOf(made, false);
    const found = this.host.resolverState.shapes.get(shape);
    if (found !== undefined) return found;
    this.host.resolverState.shapes.set(shape, made);
    const shown = this.shapeOf(made, true);
    let r = this.host.tables.typing.rec(made);
    r.name = `{ ${shown} }`;
    this.host.tables.typing.setRec(made, r);
    return made;
  }

  // An interface's members as one string: keyed by each type's shape, or shown as written.
  private shapeOf(this: Mut<this>, made: InterfaceType, shown: boolean): string {
    let parts: string[] = [];
    const fieldCount = this.host.tables.typing.rec(made).fields.length;
    for (let k: usize = 0; k < fieldCount; k++) {
      const f = copyField(this.host.tables.typing.rec(made).fields[k]!);
      const optional = f.optional !== undefined ? "?" : "";
      if (shown) parts.push(`${f.name}${optional}: ${this.host.tables.typing.show(f.type)}`);
      else parts.push(`${f.name}${optional}:${this.host.tables.typing.shapeKey(f.type)}${f.readonly === true ? " readonly" : ""}`);
    }
    const methodCount = this.host.tables.typing.rec(made).methods.length;
    for (let k: usize = 0; k < methodCount; k++) {
      const record = this.host.tables.typing.rec(made);
      const m: Ref<Method> = record.methods[k]!;
      const name = m.name;
      const omittable = m.omittable === true ? "?" : "";
      let params: Type[] = [];
      for (const p of m.params) params.push(p);
      const returns = m.returns;
      const throws = m.throws;
      const flags = `${m.mutable === true ? " mut" : ""}${m.owned === true ? " owned" : ""}`;
      let each: string[] = [];
      for (const p of params) each.push(shown ? this.host.tables.typing.show(p) : this.host.tables.typing.shapeKey(p));
      if (shown) {
        const thrown = throws !== undefined ? ` throws ${this.host.tables.typing.show(throws)}` : "";
        parts.push(`${name}${omittable}(${each.join(", ")}): ${this.host.tables.typing.show(returns)}${thrown}`);
      } else {
        const thrown = throws !== undefined ? ` throws ${this.host.tables.typing.shapeKey(throws)}` : "";
        parts.push(`${name}${omittable}(${each.join(",")}):${this.host.tables.typing.shapeKey(returns)}${thrown}${flags}`);
      }
    }
    return parts.join(shown ? "; " : ";");
  }

  // The interface is registered before its members resolve, so a member may name it. A generic
  // interface is one interface per list of type arguments, its members seeing them.
  /** @throws {CompileError} */
  private interfaceOf(this: Mut<this>, i: Ref<Interface>, args: Type[], at: Ref<Span>): InterfaceType {
    if (args.length !== i.typeParams.length) {
      throw new CompileError("E0106", `interface '${i.name}' expects ${i.typeParams.length} type argument${i.typeParams.length === 1 ? "" : "s"}, but got ${args.length}`, at.start, at.end);
    }
    // Every copy of a package's interface, one per import of it, is one type.
    const owner = i.jsSource !== undefined ? i.jsSource.id : i.id;
    if (!this.host.resolverState.traits.has(owner)) this.host.resolverState.traits.set(owner, new Map<string, InterfaceType>());
    let keys: string[] = [];
    for (const a of args) keys.push(this.host.tables.typing.keyOf(a));
    const key = keys.join(",");
    const found = this.host.resolverState.traits.get(owner)!.get(key);
    if (found !== undefined) return found;
    if (this.host.resolverState.traits.get(owner)!.size > 64) throw new CompileError("E0113", `instantiating interface '${i.name}' never ends: each instance needs another with larger type arguments`, at.start, at.end);
    let shown: string[] = [];
    for (const a of args) shown.push(this.host.tables.typing.show(a));
    const t = this.host.tables.typing.interfaceType(args.length > 0 ? `${i.name}<${shown.join(", ")}>` : i.name);
    if (args.length > 0) {
      let r = this.host.tables.typing.rec(t);
      let given: Type[] = [];
      for (const a of args) given.push(a);
      r.generic = { name: i.name, args: given };
      this.host.tables.typing.setRec(t, r);
    }
    let byArgs = this.host.resolverState.traits.get(owner)!;
    byArgs.set(key, t);
    this.host.resolverState.traits.set(owner, byArgs);
    const isInline = this.host.resolverState.inline.has(i.name);
    if (args.length > 0 && !isInline) this.host.tables.typing.noteInterfaceInstance(i.name, key, t);
    // Its members are written where it is declared, with its parameters standing for the arguments.
    const sight = this.enterSight(undefined);
    const scope = this.enterScope(paramBindings(i.typeParams, args));
    let res: InterfaceType;
    try {
      res = this.members(i, t);
    } finally {
      this.host.resolverState.scope = scope;
      this.host.resolverState.sight = sight;
    }
    if (args.length > 0) {
      const noted = isInline ? this.sameShape(res) : res;
      this.host.tables.typing.noteInterfaceInstance(i.name, key, noted);
      let lowered: Type[] = [];
      let changed = false;
      for (const a of args) {
        const l = this.host.tables.typing.lower(a);
        if (l !== a) changed = true;
        lowered.push(l);
      }
      if (changed) this.interfaceOf(i, lowered, at);
    }
    return res;
  }

  /** @throws {CompileError} */
  private members(this: Mut<this>, i: Ref<Interface>, t: InterfaceType): InterfaceType {
    // A package's interface or class may declare again what it inherits, narrowing it, as
    // TypeScript lets a derived member replace its base's.
    let inherited = new Set<string>();
    for (const node of i.extends) {
      // A package's interface or class extends another's shape, which a JS handle holds.
      const resolved = this.resolveType(node);
      const shape = this.host.tables.typing.jsShape(resolved);
      const base: Type = shape !== undefined ? shape : resolved;
      const b = this.recOf(base);
      if (b === undefined || (b.kind !== "interface" && !(i.js !== undefined && b.kind === "object"))) throw new CompileError("E0702", "an interface can only extend interfaces", node.start, node.end);
      let fields: Field[] = [];
      for (const f of b.fields) fields.push(copyField(f));
      let methods: Method[] = [];
      if (b.kind === "interface") for (const m of b.methods) methods.push(copyMethod(m));
      for (const f of fields) {
        this.noteMember(i, t, inherited, f.name, node, false, false);
        let r = this.host.tables.typing.rec(t);
        r.fields.push(copyField(f));
        this.host.tables.typing.setRec(t, r);
        inherited.add(f.name);
      }
      for (const m of methods) {
        const name = m.name;
        this.noteMember(i, t, inherited, name, node, false, false);
        let r = this.host.tables.typing.rec(t);
        r.methods.push(copyMethod(m));
        this.host.tables.typing.setRec(t, r);
        inherited.add(name);
      }
    }
    for (const m of i.members) {
      // A package's member Fish can't type is refused only where a program uses it.
      if (i.js === undefined) {
        this.addMember(i, t, inherited, m);
        continue;
      }
      try {
        this.addMember(i, t, inherited, m);
      } catch (e) {
        if (!(e instanceof CompileError)) throw e;
        // A member without a name, as an index or call signature, is never reached by one, but
        // still comes only with a value JS made.
        const key = memberName(m) ?? `[${m.kind}]`;
        if (!this.host.tables.typing.jsUntyped.has(t)) this.host.tables.typing.jsUntyped.set(t, new Map<string, CompileError>());
        let untyped = this.host.tables.typing.jsUntyped.get(t)!;
        untyped.set(key, e);
        this.host.tables.typing.jsUntyped.set(t, untyped);
        if ("optional" in m && m.optional) {
          if (!this.host.tables.typing.jsOptional.has(t)) this.host.tables.typing.jsOptional.set(t, new Set<string>());
          let optional = this.host.tables.typing.jsOptional.get(t)!;
          optional.add(key);
          this.host.tables.typing.jsOptional.set(t, optional);
        } else if (this.host.tables.typing.jsOptional.has(t)) {
          let optional = this.host.tables.typing.jsOptional.get(t)!;
          optional.delete(key);
          this.host.tables.typing.jsOptional.set(t, optional);
        }
      }
    }
    return t;
  }

  // Records a member an interface declares or inherits, written at `at`: an interface may
  // require a method its base leaves optional, as TypeScript lets it, and a package's may
  // narrow what it inherits; otherwise each name is declared once.
  /** @throws {CompileError} */
  private noteMember<S extends Span>(this: Mut<this>, i: Ref<Interface>, t: InterfaceType, inherited: Mut<Set<string>>, name: string, at: Ref<S>, method: boolean, optional: boolean): void {
    let omittable = false;
    const record3 = this.host.tables.typing.rec(t);
    for (const m of record3.methods) if (m.name === name && m.omittable === true) omittable = true;
    const requires = method && !optional && omittable;
    if ((i.js !== undefined || requires) && inherited.delete(name)) {
      let r = this.host.tables.typing.rec(t);
      let fields: Field[] = [];
      for (const f of r.fields) if (f.name !== name) fields.push(copyField(f));
      let methods: Method[] = [];
      for (const m of r.methods) if (m.name !== name) methods.push(copyMethod(m));
      r.fields = fields;
      r.methods = methods;
      this.host.tables.typing.setRec(t, r);
      return;
    }
    let field = false;
    const record4 = this.host.tables.typing.rec(t);
    for (const f of record4.fields) if (f.name === name) field = true;
    let declared = false;
    const record5 = this.host.tables.typing.rec(t);
    for (const m of record5.methods) if (m.name === name) declared = true;
    if (field || declared) {
      if (method && declared) throw new CompileError("E0402", `'${name}' is declared twice in interface '${i.name}'; method overloads in interfaces aren't supported yet, so give each signature its own name`, at.start, at.end);
      throw new CompileError("E0402", `duplicate member '${name}' in interface '${i.name}'`, at.start, at.end);
    }
  }

  // Adds a member an interface writes to its type.
  /** @throws {CompileError} */
  private addMember(this: Mut<this>, i: Ref<Interface>, t: InterfaceType, inherited: Mut<Set<string>>, m: Ref<TypeMember>): void {
    if (m.kind === "method") {
      if (typeof m.name !== "string") throw symbolKey(m.name);
      if (m.optional && i.js !== undefined) throw unsupported("optional methods", m);
      if (m.returns === undefined) throw new CompileError("E0104", `method '${m.name}' implicitly returns 'any'; add a return type`, m.start, m.end);
      this.noteMember(i, t, inherited, m.name, m, true, m.optional);
      const self = m.params.length > 0 && isThisParam(m.params[0]!);
      for (const p of m.params) if (p.rest) throw unsupported("rest parameters in interface methods", p);
      // A generic method's own type parameters stand for themselves in its signature.
      const around = this.scopeCopy();
      const own = m.typeParams.length > 0 ? placeholders(this.host, m.typeParams, scopes(around, new Map<string, Type>()), undefined) : new Map<string, Type>();
      const returns: Ref<TypeNode> = m.returns;
      let params: Type[] = [];
      let result: Type;
      let throws: Type | undefined = undefined;
      const outer = this.enterScope(scopes(around, own));
      try {
        for (let k: usize = self ? 1 : 0; k < m.params.length; k++) params.push(this.paramType(m.params[k]!));
        result = this.resolveType(returns);
        if (m.throws !== undefined) throws = this.resolveType(m.throws);
      } finally {
        this.host.resolverState.scope = outer;
      }
      if (throws === "void") throw new CompileError("E0118", "a function can't throw 'void'; throw a value", m.throws!.start, m.throws!.end);
      if (throws !== undefined && this.host.tables.typing.holdsRef(throws)) throw unsupported("errors holding references", m.throws!);
      if (throws !== undefined && this.host.tables.typing.promiseElement(result) !== undefined) throw unsupported("interface methods giving a Promise that throw", m.throws!);
      let method: Method = { name: m.name, params, returns: result, mutable: self ? mutates(m.params[0]!) : false, owned: self ? owns(m.params[0]!) : false };
      if (throws !== undefined) method.throws = throws;
      if (m.optional) method.omittable = true;
      if (i.js !== undefined) {
        let optional: boolean[] = [];
        for (let k: usize = self ? 1 : 0; k < m.params.length; k++) optional.push(m.params[k]!.optional);
        method.optional = optional;
      }
      if (m.typeParams.length > 0) {
        let typeParams: TypeParam[] = [];
        for (const p of m.typeParams) typeParams.push(cloneTypeParam(p));
        let written: Param[] = [];
        for (let k: usize = self ? 1 : 0; k < m.params.length; k++) written.push(cloneParam(m.params[k]!));
        let node: FamilyNode = { typeParams, params: written, returns: cloneTypeNode(returns) };
        if (m.throws !== undefined) node.throws = cloneTypeNode(m.throws);
        let names: string[] = [];
        for (const p of m.typeParams) names.push(p.name);
        let placeholdersOwn: Type[] = [];
        for (const x of own.values()) placeholdersOwn.push(x);
        method.generic = { names, node, scope: around, own: placeholdersOwn };
      }
      let patterned = this.host.tables.typing.holdsPattern(method.returns);
      for (const p of method.params) if (this.host.tables.typing.holdsPattern(p)) patterned = true;
      if (method.throws !== undefined && this.host.tables.typing.holdsPattern(method.throws)) patterned = true;
      if (patterned) throw unsupported("template literal pattern types in interface methods", m);
      let r = this.host.tables.typing.rec(t);
      r.methods.push(method);
      this.host.tables.typing.setRec(t, r);
    } else {
      const f = this.member(m);
      if (this.host.tables.typing.holdsPattern(f.type)) throw unsupported("template literal pattern types in interface fields", m);
      const name = f.name;
      this.noteMember(i, t, inherited, name, m, false, false);
      let r = this.host.tables.typing.rec(t);
      r.fields.push(f);
      this.host.tables.typing.setRec(t, r);
    }
  }

  // An alias met again while its own type is made leads back to itself: that is where the
  // compiler puts a pointer, a recursive type standing for the alias's type.
  /** @throws {CompileError} */
  private aliasType(this: Mut<this>, a: Ref<TypeAlias>, args: Ref<Type[]>, at: Ref<Span>): Type {
    if (args.length !== a.typeParams.length) {
      throw new CompileError("E0106", `type '${a.name}' expects ${a.typeParams.length} type argument${a.typeParams.length === 1 ? "" : "s"}, but got ${args.length}`, at.start, at.end);
    }
    let keys: string[] = [];
    for (const x of args) keys.push(this.host.tables.typing.keyOf(x));
    const key = `${a.name}<${keys.join(",")}>`;
    const done = this.host.resolverState.resolved.get(key);
    if (done !== undefined) return done;
    // A group of aliases naming one another is entered at its root, whichever member is read.
    if (!this.host.resolverState.resolving.has(key) && args.length === 0) {
      if (!this.host.resolverState.aliasRootsMade) {
        this.host.resolverState.aliasRoots = aliasRoots(this.host.decls.aliases);
        this.host.resolverState.aliasRootsMade = true;
      }
      const root = this.host.resolverState.aliasRoots.get(a.name);
      const rootKey = root !== undefined ? `${root}<>` : "";
      const rootWritten = root === undefined ? undefined : this.host.decls.aliases.get(root);
      const rootAlias = rootWritten === undefined ? undefined : cloneTypeAlias(rootWritten);
      if (rootAlias !== undefined && rootAlias.typeParams.length === 0 && !this.host.resolverState.resolving.has(rootKey) && !this.host.resolverState.resolved.has(rootKey)) {
        this.aliasType(rootAlias, [], rootAlias);
        const nowDone = this.host.resolverState.resolved.get(key);
        if (nowDone !== undefined) return nowDone;
      }
    }
    // Inside a generic alias checked before any use, another alias given its placeholders is only
    // checked for its arguments: following it could recurse without end.
    let open: ParamType | undefined = undefined;
    if (this.host.resolverState.deferring > 0 && this.host.resolverState.resolving.size > 0) {
      for (const t of args) {
        const found = openParam(this.host.tables.typing, t, true);
        if (open === undefined) open = found;
      }
    }
    if (open !== undefined) return open;
    let laying = false;
    for (const layout of this.host.resolverState.layouts) if (layout.has(key)) laying = true;
    if (laying) {
      throw new CompileError("E0113", `type '${a.name}' reads a class's fields while that class's own field types are being worked out from it, so it can't be computed yet`, at.start, at.end);
    }
    if (this.host.resolverState.resolving.has(key)) {
      const known = this.host.resolverState.recursives.get(key);
      if (known !== undefined) return known;
      // A std alias may be shown by another name than the one it is linked under.
      const name = a.shown ?? a.name;
      let shown: string[] = [];
      for (const x of args) shown.push(this.host.tables.typing.show(x));
      let given: Type[] = [];
      for (const x of args) given.push(x);
      const back = this.host.tables.typing.recursiveType(args.length > 0 ? `${name}<${shown.join(", ")}>` : name, given);
      this.host.resolverState.recursives.set(key, back);
      return back;
    }
    // A type that branches as it recurses grows exponentially, so the whole program's type
    // evaluation has a budget, as TypeScript caps instantiations.
    if (this.host.resolverState.resolving.size === 0) this.host.resolverState.computed = 0;
    if (++this.host.resolverState.computed > 20_000) throw new CompileError("E0113", `computing type '${a.name}' needed more than 20000 alias instances; a type that branches as it recurses grows exponentially`, at.start, at.end);
    if (this.host.resolverState.resolving.size > 64) throw new CompileError("E0113", `type '${a.name}' is nested more than 64 alias instances deep while being computed; a type that uses itself must reach a branch that stops sooner`, at.start, at.end);
    this.host.resolverState.resolving.add(key);
    let type: Type;
    try {
      // An alias's body sees the names where it is declared, not where it is used.
      const bindings = paramBindings(a.typeParams, args);
      type = this.resolveDeclared(bindings, a.type);
    } finally {
      this.host.resolverState.resolving.delete(key);
    }
    const back = this.host.resolverState.recursives.get(key);
    // Only a structure can hold a type again: `type A = B | null` with `type B = A` would be a
    // name for nothing but itself.
    const r = this.recOf(type);
    if (back !== undefined && (type === back || (r?.kind === "union" && r.members.includes(back)))) {
      throw new CompileError("E0113", `type '${a.name}' circularly references itself; a type can hold itself only inside an object, a tuple or an array`, a.start, a.end);
    }
    if (back !== undefined) {
      this.host.tables.typing.standsFor(back, type);
      this.host.resolverState.recursiveAliases.set(back, a.name);
      this.host.tables.typing.noteRecursiveInstance(a.name, key, back);
      this.remakeLowered(back, args);
    }
    this.host.resolverState.resolved.set(key, type);
    return type;
  }

  // `{ [K in C as N]: X }`: a field for each key C names, its type X with K bound to the key. Over
  // `keyof T` it keeps T's optional and readonly fields unless a modifier says otherwise, and
  // `as` renames each key, or drops one renamed to `never`.
  /** @throws {CompileError} */
  private mapped(this: Mut<this>, t: Ref<Extract<TypeNode, { kind: "mapped" }>>): Type {
    const homomorphic = t.constraint.kind === "operator" && t.constraint.op === "keyof" ? this.resolveType(t.constraint.type) : undefined;
    const keys = this.resolveType(t.constraint);
    if (t.type === undefined) throw new CompileError("E0114", `a mapped type needs the type of its fields, like '{ [${t.name} in keyof T]: i64 }'`, t.start, t.end);
    const held = standIn(this.host.tables.typing, homomorphic !== undefined ? [homomorphic, keys] : [keys], "a mapped type", spanOf(t.constraint), false, this.host.resolverState.deferring > 0);
    if (held !== undefined) {
      let bound = this.scopeCopy();
      bound.set(t.name, held);
      if (t.as !== undefined) this.resolveIn(bound, t.as);
      this.resolveIn(bound, t.type);
      return held;
    }
    const source: Field[] = homomorphic !== undefined ? this.typeFns().fieldsOf(homomorphic, "a mapped type", spanOf(t.constraint)) : [];
    let fields: Field[] = [];
    const names: string[] = keys === "never" ? [] : this.typeFns().keysOf(keys, "a mapped type", spanOf(t.constraint));
    for (const key of names) {
      let bound = this.scopeCopy();
      bound.set(t.name, this.host.tables.typing.literalType(key));
      const renamed = t.as !== undefined ? this.resolveIn(bound, t.as) : this.host.tables.typing.literalType(key);
      const asAt = t.as !== undefined ? spanOf(t.as) : spanOf(t);
      const names: string[] = renamed === "never" ? [] : this.typeFns().keysOf(renamed, "a mapped type's 'as' clause", asAt);
      const resolved = this.resolveIn(bound, t.type);
      const value = storable(this.host.tables.typing, resolved, spanOf(t.type));
      let from: Field | undefined = undefined;
      for (const f of source) if (from === undefined && f.name === key) from = copyField(f);
      const readonly = t.readonly !== undefined ? t.readonly === "+" : from !== undefined && from.readonly === true;
      const optional = from !== undefined ? from.optional : undefined;
      for (const name of names) {
        for (const f of fields) if (f.name === name) throw new CompileError("E0114", `two keys of this mapped type are both renamed '${name}', and an object type has each field once`, asAt.start, asAt.end);
        let field: Field;
        if (t.optional === "+") field = this.host.tables.typing.optionalField(name, value);
        else if (t.optional === "-") field = { name, type: optional === "added" ? this.host.tables.typing.withoutNull(value) : value };
        else if (optional === "added" || optional === "held") field = this.kept(name, value, optional);
        else field = { name, type: value };
        if (readonly) field.readonly = true;
        fields.push(field);
      }
    }
    return this.host.tables.typing.objectType(fields);
  }

  // A field a homomorphic mapped type keeps optional: its null is the one `?` added unless the
  // new type held one of its own as the old did.
  private kept(this: Mut<this>, name: string, value: Type, was: "added" | "held"): Field {
    const r = this.recOf(value);
    const own = value === "null" || (r?.kind === "union" && r.members.includes("null"));
    const type = own ? value : this.host.tables.typing.unionType([value, "null"]);
    let field: Field = { name, type, optional: "added" };
    if (was === "held" && own) field.optional = "held";
    return field;
  }

  // `T extends U ? X : Y`: X when every value of T fits U. A check type that is a bare type
  // parameter distributes over the union it stands for, each member checked on its own, as in
  // TypeScript.
  /** @throws {CompileError} */
  private conditional(this: Mut<this>, t: Ref<Extract<TypeNode, { kind: "conditional" }>>): Type {
    const naked = t.check.kind === "ref" && t.check.args.length === 0 && this.host.resolverState.scope.has(t.check.name) ? t.check.name : undefined;
    let check = this.resolveType(t.check);
    const c = this.recOf(check);
    if (c?.kind === "param" && c.concrete !== undefined) check = c.concrete;
    const held = standIn(this.host.tables.typing, [check], "a conditional type", spanOf(t.check), true, this.host.resolverState.deferring > 0);
    if (held !== undefined) return this.branches(t, held);
    try {
      if (naked !== undefined && check === "never") return "never";
      const r = this.recOf(check);
      if (naked !== undefined && r?.kind === "union") {
        let members: Type[] = [];
        for (const m of r.members) members.push(m);
        const outer = this.scopeCopy();
        let decided: Type[] = [];
        try {
          for (const m of members) {
            let bound = scopes(outer, new Map<string, Type>());
            bound.set(naked, m);
            this.host.resolverState.scope = bound;
            decided.push(this.decide(t, m));
          }
        } finally {
          this.host.resolverState.scope = outer;
        }
        return this.host.tables.typing.unionType(decided);
      }
      return this.decide(t, check);
    } catch (e) {
      if (e instanceof Open) return this.branches(t, e.param);
      throw e;
    }
  }

  // A conditional a generic alias's placeholder decides, while the alias is checked before any
  // use: both branches are still checked, each `infer` name standing for an unknown type, and the
  // placeholder stands in for the result.
  /** @throws {CompileError} */
  private branches(this: Mut<this>, t: Ref<Extract<TypeNode, { kind: "conditional" }>>, held: Type): Type {
    let names = new Map<string, Type>();
    for (const n of inferNames(t.extends)) names.set(n, this.host.tables.typing.typeParameter(n, undefined));
    const bound = this.scopeAnd(names);
    this.resolveIn(bound, t.then);
    this.resolveType(t.else);
    return held;
  }

  // One check type's branch: the true one, with what each `infer` matched in scope, when the
  // check type fits the extends type.
  /** @throws {CompileError | Open} */
  private decide(this: Mut<this>, t: Ref<TypeNode>, check: Type): Type {
    if (t.kind !== "conditional") return check;
    const names = inferNames(t.extends);
    if (names.size === 0) {
      const extended = this.resolveType(t.extends);
      const against = this.comparable(extended, spanOf(t.extends));
      if (this.conforms(check, against, spanOf(t.extends))) return this.resolveType(t.then);
      return this.resolveType(t.else);
    }
    let found = new Map<string, Type>();
    if (!this.matches(t.extends, check, found)) return this.resolveType(t.else);
    for (const name of names) {
      if (!found.has(name)) throw new CompileError("E0114", `'infer ${name}' matched nothing in '${this.host.tables.typing.show(check)}', since the optional field holding it is missing; TypeScript would give 'unknown' for it`, t.extends.start, t.extends.end);
    }
    return this.resolveIn(this.scopeAnd(found), t.then);
  }

  // A type a conditional compares against, which can't hold a type parameter of generic code,
  // since fitting it would be decided once for every instance.
  /** @throws {CompileError | Open} */
  private comparable(this: Mut<this>, type: Type, at: Ref<Span>): Type {
    const open = openParam(this.host.tables.typing, type, true);
    if (open !== undefined && this.host.resolverState.deferring > 0) throw new Open(open);
    standIn(this.host.tables.typing, [type], "a conditional type", at, true, false);
    return type;
  }

  // Whether `t` fits the pattern `p`, recording in `found` the type each `infer` in it stands
  // for; a name inferred twice stands for the union of both. The pattern's form is checked
  // before the type it is matched against, so a refused form is refused for every type.
  /** @throws {CompileError | Open} */
  private matches(this: Mut<this>, p: Ref<TypeNode>, t: Type, found: Mut<Map<string, Type>>): boolean {
    if (inferNames(p).size === 0) {
      const resolved = this.resolveType(p);
      const against = this.comparable(resolved, spanOf(p));
      return this.conforms(t, against, spanOf(p));
    }
    const kind = this.recOf(t)?.kind;
    if (kind === "param") {
      const concrete = this.host.tables.typing.rec(t as ParamType).concrete;
      if (concrete !== undefined) return this.matches(p, concrete, found);
    }
    if (p.kind === "infer") {
      if (p.constraint !== undefined) {
        const constraint = this.resolveType(p.constraint);
        const against = this.comparable(constraint, spanOf(p.constraint));
        if (!this.conforms(t, against, spanOf(p.constraint))) return false;
      }
      const prior = found.get(p.name);
      found.set(p.name, prior !== undefined ? this.host.tables.typing.unionType([prior, t]) : t);
      return true;
    }
    if (p.kind === "array") {
      if (kind !== "array") return false;
      return this.matches(p.element, this.host.tables.typing.rec(t as ArrayType).element, found);
    }
    if (p.kind === "ref" && p.name === "Array" && p.args.length === 1) {
      if (kind !== "array") return false;
      return this.matches(p.args[0]!, this.host.tables.typing.rec(t as ArrayType).element, found);
    }
    if (p.kind === "ref" && p.name === "Promise" && p.args.length === 1) {
      const promised = this.host.tables.typing.promiseElement(t);
      const gives = promised !== undefined ? promised : kind === "future" ? this.host.tables.typing.rec(t as FutureType).gives : undefined;
      return gives !== undefined && this.matches(p.args[0]!, gives, found);
    }
    // `Option<infer U>` is `U | null`: the empty value matches with nothing for U, anything else is U.
    if (p.kind === "ref" && p.name === "Option" && p.args.length === 1) {
      if (t === "null") return this.matches(p.args[0]!, "never", found);
      const present = this.host.tables.typing.withoutNull(t);
      return this.matches(p.args[0]!, present, found);
    }
    if (p.kind === "ref" && (p.name === "Ref" || p.name === "Mut") && p.args.length === 1) {
      if (kind !== "ref") return false;
      const mutable = this.host.tables.typing.rec(t as RefType).mutable;
      const to = this.host.tables.typing.rec(t as RefType).to;
      return mutable === (p.name === "Mut") && this.matches(p.args[0]!, to, found);
    }
    if (p.kind === "ref") {
      if (kind !== "class") return false;
      const generic = this.host.tables.typing.rec(t as ClassType).generic;
      if (generic === undefined || generic.name !== p.name) return false;
      let args: Type[] = [];
      for (const a of generic.args) args.push(a);
      if (args.length !== p.args.length) return false;
      for (let i: usize = 0; i < p.args.length; i++) if (!this.matches(p.args[i]!, args[i]!, found)) return false;
      return true;
    }
    if (p.kind === "function") {
      const any = p.params.length === 1 && anyArgs(p.params[0]!);
      for (const q of p.params) if (!any && q.rest) throw unsupported("rest parameters other than '...args: any[]' in an 'infer' pattern, which need tuple types,", q);
      if (kind !== "function" && kind !== "closure") return false;
      let params: Type[] = [];
      let returns: Type;
      const record = this.host.tables.typing.rec(t as FunctionType | ClosureType);
      for (const x of record.params) params.push(x);
      returns = record.returns;
      if (!any && p.params.length !== params.length) return false;
      // A parameter fits the other way round: the function must take what the pattern passes.
      if (!any) {
        for (let i: usize = 0; i < p.params.length; i++) {
          const q: Ref<Param> = p.params[i]!;
          if (q.type !== undefined && inferNames(q.type).size > 0) {
            if (!this.matches(q.type, params[i]!, found)) return false;
            continue;
          }
          const taken = this.paramType(q);
          const comparable = this.comparable(taken, q);
          if (!this.host.tables.typing.fits(comparable, params[i]!)) return false;
        }
      }
      return this.matches(p.returns, returns, found);
    }
    if (p.kind === "object") {
      for (const m of p.members) if (m.kind !== "property" || memberName(m) === undefined || m.type === undefined) throw unsupported("members other than properties in an 'infer' pattern", m);
      if (kind !== "object" && kind !== "class") return false;
      for (const m of p.members) {
        if (m.kind !== "property") continue;
        const name = memberName(m)!;
        const f = this.host.tables.typing.field(t as ClassType | ObjectType, name);
        if (f === undefined || (f.access ?? "public") !== "public") {
          if (m.optional !== true) return false;
          continue;
        }
        const type = f.type;
        if (!this.matches(m.type!, type, found)) return false;
      }
      return true;
    }
    if (p.kind === "template" && kind === "pattern") throw unsupported("'infer' patterns matched against template literal pattern types", p);
    // A template takes a string literal's text apart; each `infer` hole is its piece of text, as
    // a literal of the type its bound asks for.
    if (p.kind === "template") {
      if (kind !== "literal") return false;
      const literal = this.host.tables.typing.rec(t as LiteralType);
      if (typeof literal.value !== "string" || literal.owner !== undefined) return false;
      const parts = splitTemplate(literal.value, p.quasis);
      if (parts === undefined) return false;
      for (let i: usize = 0; i < p.types.length; i++) {
        const hole: Ref<TypeNode> = p.types[i]!;
        const text = parts[i]!;
        if (hole.kind !== "infer") {
          if (inferNames(hole).size > 0) throw unsupported("template literal holes holding 'infer' inside other types", hole);
          const resolved = this.resolveType(hole);
          const comparable = this.comparable(resolved, spanOf(hole));
          if (!this.host.tables.typing.textFits(text, comparable)) return false;
          continue;
        }
        let bound: Type = "string";
        if (hole.constraint !== undefined) {
          const constraint = this.resolveType(hole.constraint);
          bound = this.comparable(constraint, spanOf(hole.constraint));
        }
        const value = inferredText(this.host.tables.typing, text, bound);
        if (value === undefined) return false;
        const prior = found.get(hole.name);
        found.set(hole.name, prior !== undefined ? this.host.tables.typing.unionType([prior, value]) : value);
      }
      return true;
    }
    throw unsupported(p.kind === "union" ? "unions holding 'infer'" : `${typeForm(p.kind) ?? "these types"} holding 'infer'`, p);
  }

  // `{ [k: string]: V }`: a dictionary, whose keys are known only when the program runs.
  /** @throws {CompileError} */
  private dictionary(this: Mut<this>, index: Extract<TypeMember, { kind: "index" }>, members: usize): MapType {
    if (members > 1) throw unsupported("index signatures beside other members", index);
    if (index.readonly) throw unsupported("readonly index signatures", index);
    const key: Ref<Param> = index.params[0]!;
    const keyType = key.type !== undefined ? this.resolveType(key.type) : undefined;
    const keyAt: Span = key.type !== undefined ? spanOf(key.type) : { start: key.start, end: key.end };
    if (keyType !== "string") throw new CompileError("E0116", `an index signature is keyed by 'string' so far; for keys of another type use a 'Map'${keyType !== undefined && isInteger(this.host.tables.typing.lower(keyType)) ? ", or an array for consecutive numbers" : ""}`, keyAt.start, keyAt.end);
    const value = this.resolveType(index.type);
    return collection(this.host.tables.typing, "string", value, false, index, true);
  }

  /** @throws {CompileError} */
  private member(this: Mut<this>, m: Ref<TypeMember>): Field {
    if (m.kind !== "property") throw unsupported(MEMBER_FORMS.get(m.kind)!, m);
    if (typeof m.name !== "string") throw symbolKey(m.name);
    if (m.type === undefined) throw new CompileError("E0104", `property '${m.name}' implicitly has an 'any' type; add a type annotation`, m.start, m.end);
    // An object may leave out an optional property, which is then empty; one spelled
    // `T | undefined` may be left out too, and printing and JSON leave it out while empty.
    let f: Field;
    if (m.optional) {
      const member = this.unionMember(m.type!);
      f = this.host.tables.typing.optionalField(m.name, member);
    } else if (spellsUndefined(m.type)) f = { name: m.name, type: this.resolveType(m.type!), optional: "undefined" };
    else f = { name: m.name, type: this.resolveType(m.type!) };
    let out = copyField(f);
    out.type = storable(this.host.tables.typing, f.type, m);
    if (m.readonly) out.readonly = true;
    return out;
  }
}

// Thrown inside a conditional whose extends side holds a placeholder of the generic alias being
// checked, and caught by that conditional, which then can't pick a branch.
// A run of decimal digits, with an optional leading '-', as the integer it writes.
function digitsOf(text: string): bigint {
  let n = 0n;
  const negative = text.startsWith("-");
  for (let i: usize = negative ? 1 : 0; i < text.length; i++) n = n * 10n + BigInt(text.charCodeAt(i) - 48);
  return negative ? -n : n;
}

function copyTypes(list: Ref<Type[]>): Type[] {
  let out: Type[] = [];
  for (const x of list) out.push(x);
  return out;
}

function copyStrings(list: Ref<string[]>): string[] {
  let out: string[] = [];
  for (const x of list) out.push(x);
  return out;
}

function copyInstance(made: Ref<EnumInstance>): EnumInstance {
  let variants = new Map<string, VariantType>();
  for (const [name, v] of made.variants) variants.set(name, v);
  return { type: made.type, variants };
}

// Whether a comptime parameter's type has values that compare, so an instance can be made per
// value: integers, booleans, strings, literals and unions of them.
function keyed(typing: Ref<Typing>, t: Type): boolean {
  if (isInteger(t) || t === "boolean" || t === "string") return true;
  if (typeof t === "string") return false;
  const k = typing.rec(t);
  if (k.kind === "literal") return true;
  if (k.kind !== "union") return false;
  for (const m of k.members) if (!keyed(typing, m)) return false;
  return true;
}

function kindOf(typing: Ref<Typing>, t: Type | undefined): string | undefined {
  return t === undefined || typeof t === "string" ? undefined : typing.rec(t).kind;
}

// Whether a parameter is written `...args: any[]` or `...args: unknown[]`.
function anyArgs(p: Ref<Param>): boolean {
  return p.rest && p.type !== undefined && p.type.kind === "array" && p.type.element.kind === "ref" && ["any", "unknown"].includes(p.type.element.name);
}

// The handle type a built-in name taking no type arguments is.
function blockNamed(name: string): BlockRecord["which"] | undefined {
  if (name === "Semaphore") return "Semaphore";
  if (name === "Permit") return "Permit";
  if (name === "AbortController") return "AbortController";
  if (name === "AbortSignal") return "AbortSignal";
  if (name === "TcpListener") return "TcpListener";
  if (name === "TcpStream") return "TcpStream";
  if (name === "UnixListener") return "UnixListener";
  if (name === "UnixStream") return "UnixStream";
  if (name === "UdpSocket") return "UdpSocket";
  if (name === "JsValue") return "JsValue";
  return undefined;
}

// The kind of interior a built-in name makes.
function interiorNamed(name: string): InteriorRecord["which"] {
  if (name === "Atomic") return "Atomic";
  if (name === "Lock") return "Lock";
  if (name === "RwLock") return "RwLock";
  return "Cell";
}

// The primitive type a built-in name is, `number` being `f64`.
const PRIMITIVES: Type[] = ["i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize", "f32", "f64", "boolean", "void", "string", "bigint"];
function primitiveNamed(name: string): Type {
  if (name === "number") return "f64";
  for (const p of PRIMITIVES) if (p === name) return p;
  return "never";
}

// Whether a parameter is a method's `this`.
function isThisParam(p: Ref<Param>): boolean {
  return p.pattern.kind === "ident" && p.pattern.name === "this";
}

// The name a member is written with, when it is a string.
function memberName(m: Ref<TypeMember>): string | undefined {
  if (m.kind !== "property" && m.kind !== "method" && m.kind !== "get" && m.kind !== "set") return undefined;
  const name: Ref<PropertyName> = m.name;
  if (typeof name === "string") return name;
  return undefined;
}

// Where a node is, as a span of its own.
function spanOf(n: Ref<TypeNode>): Span {
  return { start: n.start, end: n.end };
}

function cloneInterface(i: Ref<Interface>): Interface {
  const copy = cloneStmt(i);
  if (copy.kind === "interface") return copy;
  return cloneInterface(i);
}

// The bindings of `a`, then of `b` over them.
function scopes(a: Ref<Map<string, Type>>, b: Ref<Map<string, Type>>): Map<string, Type> {
  let out = new Map<string, Type>();
  for (const [name, t] of a) out.set(name, t);
  for (const [name, t] of b) out.set(name, t);
  return out;
}

// Each type parameter bound to its argument.
function paramBindings(params: Ref<TypeParam[]>, args: Ref<Type[]>): Map<string, Type> {
  let out = new Map<string, Type>();
  for (let i: usize = 0; i < params.length; i++) out.set(params[i]!.name, args[i]!);
  return out;
}

class Open {
  readonly param: ParamType;
  constructor(param: ParamType) {
    this.param = param;
  }
}

// The literal an `infer` hole's text stands for under its bound: an i64 literal or another
// integer type for an integer's text, a boolean literal, a float type, or the text itself, the
// first of these the bound takes; or nothing when the bound takes none.
function inferredText(typing: Mut<Typing>, text: string, bound: Type): Type | undefined {
  const b = typeof bound === "string" ? undefined : typing.rec(bound);
  const members = b?.kind === "union" ? b.members : [bound];
  // A bound taking any string keeps the text as written, as TypeScript does.
  if (members.includes("string")) return typing.literalType(text);
  let candidates: Type[] = [];
  for (const m of members) {
    if (m === "i64" && typing.textFits(text, m)) candidates.push(typing.literalType(digitsOf(text)));
    else if ((isInteger(m) || isFloat(m)) && typing.textFits(text, m)) candidates.push(m);
    else if (m === "boolean" && typing.textFits(text, m)) candidates.push(typing.literalType(text === "true"));
  }
  candidates.push(typing.literalType(text));
  return candidates.find((c) => typing.fits(c, bound));
}

// The names a type pattern declares with `infer`.
function inferNames(t: Ref<TypeNode>): Set<string> {
  let names = new Set<string>();
  walkWhile({ of: "typeNode", node: t }, (n) => {
    if (n.of !== "typeNode" || n.node.kind !== "infer") return true;
    names.add(n.node.name);
    return false;
  });
  return names;
}

// A field both sides of `&` declare keeps its type, merging nested object types; other types
// conflict, since no value could have both. It is readonly only when both sides say so, as in
// TypeScript.
/** @throws {CompileError} */
function merged(typing: Mut<Typing>, a: ObjectType, b: ObjectType, from: Ref<Span>, to: Ref<Span>): ObjectType {
  let fields: Field[] = [];
  const ours = typing.rec(a);
  for (const f of ours.fields) fields.push(copyField(f));
  const theirs = typing.rec(b).fields.length;
  for (let k: usize = 0; k < theirs; k++) {
    const f = copyField(typing.rec(b).fields[k]!);
    let i: usize | undefined = undefined;
    for (let j: usize = 0; j < fields.length; j++) if (i === undefined && fields[j]!.name === f.name) i = j;
    if (i === undefined) {
      fields.push(f);
      continue;
    }
    const g = copyField(fields[i]!);
    const x = objectTypeOf(typing, g.type);
    const y = objectTypeOf(typing, f.type);
    const both = g.readonly === true && f.readonly === true;
    // A side where the field is optional gives way to one where it's required, as in
    // `Partial<T> & Pick<T, "id">`.
    const gRequired = g.optional !== undefined && f.optional === undefined;
    const fRequired = f.optional !== undefined && g.optional === undefined;
    if (gRequired || fRequired) {
      let required: Field;
      let other: Field;
      if (gRequired) {
        required = copyField(f);
        other = copyField(g);
      } else {
        required = copyField(g);
        other = copyField(f);
      }
      if (typing.fits(required.type, other.type)) {
        let kept: Field = { name: required.name, type: required.type };
        if (required.access !== undefined) kept.access = required.access;
        if (required.optional !== undefined) kept.optional = required.optional;
        if (both) kept.readonly = true;
        fields[i] = kept;
        continue;
      }
    }
    // A side met while an alias it reaches was still being made holds that alias as a recursive
    // type, where the other holds the finished type: one type either way, kept as the finished one.
    const finished = g.type !== f.type && settled(typing, g.type) && settled(typing, f.type) && typing.unfolded(g.type) === typing.unfolded(f.type) ? typing.unfolded(f.type) : undefined;
    if (g.type !== f.type && finished === undefined && !(x !== undefined && y !== undefined)) {
      throw new CompileError("E0114", `property '${f.name}' has type '${typing.show(g.type)}' on one side of '&' and '${typing.show(f.type)}' on the other`, from.start, to.end);
    }
    const type = x !== undefined && y !== undefined ? merged(typing, x, y, from, to) : finished ?? f.type;
    let field: Field = { name: f.name, type };
    if (both) field.readonly = true;
    if (g.optional !== undefined && f.optional !== undefined) field.optional = f.optional;
    fields[i] = field;
  }
  return typing.objectType(fields);
}

// A type, when it is an object type.
function objectTypeOf(typing: Ref<Typing>, t: Type): ObjectType | undefined {
  if (typeof t === "string") return undefined;
  return typing.rec(t).kind === "object" ? (t as ObjectType) : undefined;
}

// Whether every recursive type `t` is, or holds as a union member, knows the type it stands for.
function settled(typing: Ref<Typing>, t: Type): boolean {
  const r = typing.recOf(t);
  const parts = r?.kind === "union" ? r.members : [t];
  return parts.every((m) => { const p = typing.recOf(m); return p?.kind !== "recursive" || p.of !== "never"; });
}

// What each other kind of type is called when it can't be a side of `&`.
const SIDE_FORMS = new Map<string, string>([["pattern", "template literal types"], ["brand", "brands"], ["class", "classes"], ["param", "type parameters"], ["union", "unions"], ["ref", "references"], ["closure", "functions"], ["function", "function types"], ["array", "arrays"], ["fixed", "fixed arrays"], ["map", "maps and sets"], ["variant", "enum members"], ["generator", "generators"], ["pointer", "raw pointers"], ["future", "promises"], ["handle", "join handles"], ["interior", "atomics, locks and cells"], ["shared", "shared values"], ["block", "semaphores and channels"], ["dyn", "Dyn values"], ["regex", "regexes"], ["recursive", "types that hold themselves"], ["unknown", "unknown"]]);

const I64_MAX = (1n << 63n) - 1n;

// A closure inferred for a type parameter is compiled as its own type, so where the body holds
// that parameter in a type argument it would need boxing the caller never did; refused there.
/** @throws {CompileError} */
export function unboxedClosure(typing: Mut<Typing>, t: Type, at: Ref<Span>) {
  if (typeof t === "string") return;
  const p = typing.rec(t);
  if (p.kind !== "param" || p.concrete === undefined) return;
  const lowered = typing.lower(t);
  if (typeof lowered === "string") return;
  const c = typing.rec(lowered);
  if ((c.kind !== "closure" && c.kind !== "function") || c.generic !== undefined) return;
  throw new CompileError("E0115", `'${p.name}' is a closure's own type here, which a type argument can't hold; write '${p.name}' where it is called, as in '<${c.name}>', or name it in a type argument of the signature, as in 'Box<${p.name}>'`, at.start, at.end);
}

// An `Atomic<T>`, `Lock<T>` or `Cell<T>` holding a T it can hold: an Atomic, an integer or a
// boolean, which the processor changes in one step.
/** @throws {CompileError} */
export function interior(typing: Mut<Typing>, which: InteriorRecord["which"], given: Type, at: Ref<Span>): InteriorType {
  unboxedClosure(typing, given, at);
  const of = typing.heldArgument(given);
  const held = typing.lower(of);
  if (which === "Atomic" && (held === "i128" || held === "u128")) {
    throw new CompileError("E0116", `'Atomic' holds integers of up to 64 bits, not '${typing.show(of)}', which not every processor changes in one step; use a 'Lock'`, at.start, at.end);
  }
  if (which === "Atomic" && held !== "boolean" && !isInteger(held) && !(typeof held !== "string" && typing.rec(held).kind === "param")) {
    throw new CompileError("E0116", `'Atomic' holds an integer or a boolean, not '${typing.show(of)}'; use a 'Lock' for other values`, at.start, at.end);
  }
  if (typing.holdsRef(of)) throw new CompileError("E0801", `'${which}' can't hold a reference yet ('${typing.show(of)}')`, at.start, at.end);
  // Its methods take and give its value as lowered, which would let a plain string in.
  if (typing.holdsPattern(of)) throw unsupported(`template literal pattern types in '${which}' values`, at);
  abstractless(typing, of, `'${which}'`, at);
  return typing.interiorType(which, of);
}

// What only describes values, an interface (a written `Promise<T>` or `Generator<T>` is one) or a
// function type, can't be held where its value is laid out once for every use, as a channel, a
// shared value and a lock hold theirs.
/** @throws {CompileError} */
function abstractless(typing: Mut<Typing>, of: Type, holder: string, at: Ref<Span>) {
  const lowered = typing.lower(of);
  let found: Type | undefined = undefined;
  for (const u of typing.partsOf(lowered)) if (found === undefined && typeof u !== "string" && ["interface", "function"].includes(typing.rec(u).kind)) found = u;
  if (found !== undefined) throw new CompileError("E0801", `${holder} can't hold a '${typing.show(found)}' yet: name a concrete type`, at.start, at.end);
}

// A `shared<T>` holding a T every thread may use at once: nothing in it borrows, points
// unchecked, or changes without a lock.
/** @throws {CompileError} */
export function shareable(typing: Mut<Typing>, given: Type, at: Ref<Span>): SharedType {
  unboxedClosure(typing, given, at);
  const of = typing.heldArgument(given);
  const held = typing.lower(of);
  abstractless(typing, of, "a 'shared' value", at);
  let blocker: Type | undefined = undefined;
  for (const u of typing.partsOf(held)) if (blocker === undefined && unlocked(typing, u)) blocker = u;
  if (typing.holdsHandle(held)) throw new CompileError("E0303", "a 'shared' value can't hold a JoinHandle: every clone could await it, and a task's result can be awaited in one place only", at.start, at.end);
  if (blocker !== undefined) {
    const why = kindOf(typing, blocker) === "interior" ? "changes without a lock; use an 'Atomic' or a 'Lock' instead" : kindOf(typing, blocker) === "pointer" ? "is a raw pointer no thread can vouch for" : kindOf(typing, blocker) === "shared" ? COUNTED_UNLOCKED : "borrows from one place, which other threads can't keep alive";
    throw new CompileError("E0303", `a 'shared' value is used from many threads at once, so it can't hold a '${typing.show(blocker)}', which ${why}`, at.start, at.end);
  }
  return typing.sharedType(of);
}

// An `Rc<T>` or `Weak<T>`: one thread's counted handle, whose T every clone reads in place, so
// it can't borrow from one of them or hold a task's result one of them could await.
/** @throws {CompileError} */
export function counted(typing: Mut<Typing>, given: Type, which: "Rc" | "Weak", at: Ref<Span>): SharedType {
  unboxedClosure(typing, given, at);
  const of = typing.heldArgument(given);
  abstractless(typing, of, `an '${which}'`, at);
  if (typing.holdsRef(of)) throw new CompileError("E0801", `an '${which}' can't hold a reference ('${typing.show(of)}'), which borrows from one place that every clone would outlive`, at.start, at.end);
  const lowered = typing.lower(of);
  if (typing.holdsHandle(lowered)) throw new CompileError("E0303", `an '${which}' can't hold a JoinHandle: every clone could await it, and a task's result can be awaited in one place only`, at.start, at.end);
  return typing.sharedType(of, which);
}

// A `Channel<T>` carrying values from one task to another: nothing in them borrows, points
// unchecked, or changes without a lock.
/** @throws {CompileError} */
export function channel(typing: Mut<Typing>, given: Type, at: Ref<Span>): BlockType {
  unboxedClosure(typing, given, at);
  const of = typing.heldArgument(given);
  const held = typing.lower(of);
  const h = typeof held === "string" ? undefined : typing.rec(held);
  if (h?.kind === "union" && h.members.includes("null") || held === "null") {
    throw new CompileError("E0116", `a 'Channel' can't carry '${typing.show(held)}': 'receive' gives null once the channel is closed, so a null sent through it would look the same; wrap it, as in 'Channel<{ value: ${typing.show(held)} }>'`, at.start, at.end);
  }
  abstractless(typing, of, "a 'Channel'", at);
  if (typing.holdsPattern(of)) throw unsupported("template literal pattern types in channels", at);
  const lowered = typing.lower(of);
  let blocker: Type | undefined = undefined;
  for (const u of typing.partsOf(lowered)) if (blocker === undefined && unlocked(typing, u)) blocker = u;
  if (blocker !== undefined) throw new CompileError("E0303", `a 'Channel' carries values to other tasks, so it can't carry a '${typing.show(blocker)}', which ${kindOf(typing, blocker) === "interior" ? "changes without a lock" : kindOf(typing, blocker) === "pointer" ? "is a raw pointer no thread can vouch for" : kindOf(typing, blocker) === "shared" ? COUNTED_UNLOCKED : "borrows from where it was made"}`, at.start, at.end);
  return typing.blockType("Channel", of);
}

// Why an Rc or a Weak can't cross to another thread.
export const COUNTED_UNLOCKED = "counts its owners without atomics, so only one thread may use it; use a 'shared' value instead";

// Whether a part of a value can't cross to another thread: a reference, a raw pointer, a Cell,
// an Rc or a Weak.
function unlocked(typing: Ref<Typing>, u: Type): boolean {
  if (typeof u === "string") return false;
  const r = typing.rec(u);
  return r.kind === "ref" || r.kind === "pointer" || (r.kind === "interior" && r.which === "Cell") || (r.kind === "shared" && r.which !== "shared");
}

// A key a Map or a Set hashes: a string or a sized integer, or a union of literals of one of
// them, such as an enum's members. A type parameter is checked again in each instance.
function keyable(typing: Mut<Typing>, t: Type): boolean {
  const lowered = typing.lower(t);
  // A key is hashed as 64 bits, which a 128-bit integer doesn't fit.
  if (lowered === "string" || isFloat(lowered) || (isInteger(lowered) && lowered !== "i128" && lowered !== "u128")) return true;
  if (typeof lowered === "string") return false;
  const k = typing.rec(lowered);
  if (k.kind === "param") return k.concrete === undefined;
  if (k.kind === "literal") return typeof k.value !== "boolean";
  if (k.kind !== "union") return false;
  let bases = new Set<string>();
  for (const m of k.members) {
    const r = typeof m === "string" ? undefined : typing.rec(m);
    if (r?.kind !== "literal") bases.add("");
    else if (typeof r.value === "string") bases.add("string");
    else if (typeof r.value === "boolean") bases.add("boolean");
    else if (typeof r.value === "bigint") bases.add("bigint");
    else bases.add("number");
  }
  return bases.size === 1 && !bases.has("") && !bases.has("boolean");
}

// A `Map<K, V>`, or a `Set<K>` when `set`: keys it can hash, and values it can own.
/** @throws {CompileError} */
export function collection(typing: Mut<Typing>, key: Type, value: Type, set: boolean, at: Ref<Span>, dict?: true): MapType {
  const what = set ? "a 'Set'" : "a 'Map'";
  if (!keyable(typing, key)) throw new CompileError("E0116", `${what} ${set ? "holds" : "is keyed by"} strings or numbers, or unions of their literals, not '${typing.show(key)}'; objects as keys aren't supported yet`, at.start, at.end);
  if (typing.holdsRef(value)) throw unsupported("maps of references", at);
  const lowered = typing.lower(value);
  const v = typeof lowered === "string" ? undefined : typing.rec(lowered);
  if ((v?.kind === "closure" || v?.kind === "function") && v.generic !== undefined) throw unsupported("maps of generic functions", at);
  if (v?.kind === "interface") throw new CompileError("E0115", `a 'Map' can't hold the interface type '${v.name}' directly, since its values may each be a different type; use 'Dyn<${v.name}>'`, at.start, at.end);
  unboxedClosure(typing, value, at);
  const held = typing.heldArgument(value);
  const stored = typing.stored(held);
  return typing.mapType(key, stored, set, dict);
}

const ITERATORS = ["Iterator", "IterableIterator", "Iterable"];

const INTEGER_NAMES = ["i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize"];
const BUILT_IN_TYPES = new Set(["Map", "Set", ...INTEGER_NAMES, "f32", "f64", "boolean", "void", "number", "string", "bigint", "Ref", "Mut", "Lifetime", "Option", "Generator", "AsyncGenerator", "Promise", "JoinHandle", "Ptr", "MutPtr", "Atomic", "Lock", "RwLock", "Cell", "shared", "Rc", "Weak", "Semaphore", "Permit", "Channel", "AbortController", "AbortSignal", "TcpListener", "TcpStream", "UnixListener", "UnixStream", "UdpSocket", "JsValue", "Dyn", "RegExp", "null", "undefined", "unknown"]);

// What each kind of object type member besides a property is called when rejected.
const MEMBER_FORMS = new Map<string, string>([
  ["method", "methods in object types"],
  ["call", "call signatures"],
  ["construct", "construct signatures"],
  ["index", "index signatures"],
  ["get", "accessors in object types"],
  ["set", "accessors in object types"],
]);

// Fields with their source spans, checked for a name given twice.
/** @throws {CompileError} */
export function fields(list: Field[], at: Ref<Span[]>): Field[] {
  for (let i: usize = 0; i < list.length; i++) {
    for (let k: usize = 0; k < i; k++) if (list[k]!.name === list[i]!.name) throw new CompileError("E0402", `duplicate property '${list[i]!.name}'`, at[i]!.start, at[i]!.end);
  }
  return list;
}

