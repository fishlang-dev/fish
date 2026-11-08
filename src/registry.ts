import { checkOverrideModifiers, checkOverrides, cloneFieldDecl, copySelfTyped, embed, extend, implementAbstracts, type Body, type ClassInfo, type FieldDecl } from "./classes.ts";
import type { Tables } from "./compilation.ts";
import { nextId } from "./nodes.ts";
import type { BodyId, ClassId } from "./arenas.ts";
import { unsupported } from "./unsupported.ts";
import { rustClassOf } from "./rust.ts";
import { CompileError } from "./diag.ts";
import { didYouMean } from "./suggest.ts";
import { unsatisfied, type Members } from "./interfaces.ts";
import type { ClassNode, Param, Span, TypeNode } from "./parser.ts";
import { cloneTypeNode } from "./rebuild.ts";
import { storable } from "./resolve.ts";
import { EMBEDDED, type Field, type MapType, type InterfaceType, type ObjectType, TypeMap, TypeSet, type ClassType, type Type, type VariantType, type Typing, copyField } from "./typing.ts";

// A member a class's `override` replaces: its name as shown, its parameters' types and its result.
type Replaced = { name: string; params: (Type | undefined)[]; returns: Type | undefined };

type Table = "methods" | "getters" | "setters" | "statics";

// Every class the program uses, declared or a generic class's instance: linked to its base,
// laid out, checked against what it claims, and its members checked at their definitions.

// What the registry needs from the checker, which in turn needs it, so each reaches the
// other lazily.
export interface RegistryHost {
  tables: Tables;
  classes: Map<string, ClassId>;
  templates: Map<string, ClassNode & { name: string }>;
  members(this: Mut<this>): Members;
  registryState: RegistryState;
  // A type written in a scope of type parameters, or in none.
  /** @throws {CompileError} */
  resolveIn(this: Mut<this>, scope: Ref<Map<string, Type>> | undefined, t: Ref<TypeNode>): Type;
  // The type a field initializer's body gives, once checked.
  /** @throws {CompileError} */
  initializerType(this: Mut<this>, body: BodyId): Type;
  // The names of the classes a use at `at` reaches, for suggesting one.
  classNames(at: usize): string[];
}

// The classes the registry has seen and how far each has got, kept by its host between uses.
export class RegistryState {
  // Every class by its type, and those not yet laid out and checked.
  infoOf = new TypeMap<ClassType, ClassId>();
  unsettled: ClassId[] = [];
  // Each class's progress, keyed by its type.
  linked = new TypeSet<ClassType>();
  laidOut = new TypeSet<ClassType>();
  laying = new TypeMap<ClassType, ClassId>();
  wrapped = new TypeSet<ClassType>();
}

// The member of a class's table named `key`.
function memberIn(c: Ref<ClassInfo>, table: Table, key: string): BodyId | undefined {
  if (table === "methods") return c.methods.get(key);
  if (table === "getters") return c.getters.get(key);
  if (table === "setters") return c.setters.get(key);
  return c.statics.get(key);
}

function typed(f: Ref<Body>): boolean {
  return f.typeParams !== undefined && f.typeParams.length > 0;
}

export class Registry<H extends RegistryHost> {
  host: Mut<H>;

  constructor(host: Mut<H>) {
    this.host = host;
  }

  register(this: Mut<this>, c: ClassId) {
    const type = this.host.tables.arenas.classOf(c).type;
    this.host.registryState.infoOf.set(type, c);
    this.host.registryState.unsettled.push(c);
  }

  // Lays out a class and checks what it claims; gives its members, each for the host to check at
  // its definition, so one member's error may be recovered from to check the next.
  /** @throws {CompileError} */
  settle(this: Mut<this>, c: ClassId): BodyId[] {
    this.layout(c);
    this.overrideSignatures(c);
    this.implemented(c);
    return this.bodiesOf(c);
  }

  bodiesOf(c: ClassId): BodyId[] {
    const info = this.host.tables.arenas.classOf(c);
    let out: BodyId[] = [info.constructor];
    const add = (id: BodyId) => {
      if (!out.includes(id)) out.push(id);
    };
    for (const b of info.methods.values()) add(b);
    for (const b of info.statics.values()) add(b);
    for (const b of info.getters.values()) add(b);
    for (const b of info.setters.values()) add(b);
    for (const b of info.copies.values()) add(b);
    return out;
  }

  // Bases are linked first, since a derived constructor may take its base's parameters. An abstract
  // class's templates are marked, and a concrete class's copies made, before overrides are checked.
  /** @throws {CompileError} */
  link(this: Mut<this>, c: ClassId, path: TypeSet<ClassType>): void {
    const type = this.host.tables.arenas.classOf(c).type;
    if (this.host.registryState.linked.has(type)) return;
    const baseName = this.host.tables.arenas.classOf(c).baseName;
    const node = this.host.tables.arenas.classOf(c).node;
    const at = { start: node.start, end: node.end };
    if (baseName === undefined) {
      checkOverrideModifiers(this.host.tables.arenas, this.host.tables.typing, this.host.tables.arenas.classOf(c));
      implementAbstracts(this.host.tables, c);
      this.host.registryState.linked.add(type);
      return;
    }
    if (path.has(type)) throw new CompileError("E0704", `class '${this.host.tables.typing.rec(type).name}' embeds itself through 'extends'`, at.start, at.end);
    if ((baseName === "Map" || baseName === "Set") && !this.host.classes.has(baseName) && !this.host.templates.has(baseName)) {
      embed(this.host.tables, c, baseName === "Map" ? "Map" : "Set");
      checkOverrideModifiers(this.host.tables.arenas, this.host.tables.typing, this.host.tables.arenas.classOf(c));
      implementAbstracts(this.host.tables, c);
      this.host.registryState.linked.add(type);
      return;
    }
    const base = this.baseOf(c, baseName);
    const extendsAt = this.extendsSpan(c);
    // A Rust type's value is Rust's, behind its handle, with no fields to embed.
    const rust = rustClassOf(this.host.tables.typing, this.host.tables.arenas.classOf(base).type);
    if (rust !== undefined) throw new CompileError("E1004", `a class can't extend the Rust type '${rust.name}'; hold one in a field instead`, extendsAt.start, extendsAt.end);
    path.add(type);
    this.link(base, path);
    // What each name of the class's scope means as one of the program's types.
    let names: string[] = [];
    for (const n of this.host.tables.arenas.classOf(c).scope.keys()) names.push(n);
    let globals = new Map<string, Type>();
    let failed = new Map<string, CompileError>();
    for (const name of names) {
      const t: TypeNode = { id: nextId(this.host.tables.ids), kind: "ref", name, args: [], start: extendsAt.start, end: extendsAt.end };
      let resolved: Type;
      try {
        resolved = this.host.resolveIn(undefined, t);
      } catch (e) {
        if (!(e instanceof CompileError)) throw e;
        failed.set(name, e);
        continue;
      }
      globals.set(name, resolved);
    }
    extend(this.host.tables, c, base, globals, failed);
    implementAbstracts(this.host.tables, c);
    copySelfTyped(this.host.tables, c);
    checkOverrides(this.host.tables.arenas, this.host.tables.typing, this.host.tables.arenas.classOf(c));
    checkOverrideModifiers(this.host.tables.arenas, this.host.tables.typing, this.host.tables.arenas.classOf(c));
    this.host.registryState.linked.add(type);
  }

  private extendsSpan(c: ClassId): Span {
    const node = this.host.tables.arenas.classOf(c).node;
    return node.extends !== undefined ? { start: node.extends.start, end: node.extends.end } : { start: node.start, end: node.end };
  }

  // A member written `override` takes what the member it replaces takes, as TypeScript checks:
  // each parameter that one is given fits this one's, any further parameter is optional, and its
  // result fits that one's.
  /** @throws {CompileError} */
  private overrideSignatures(this: Mut<this>, c: ClassId) {
    let wanted: [Table, string][] = [];
    for (const o of this.host.tables.arenas.classOf(c).overrides) {
      if (o.static) {
        wanted.push(["statics", o.name]);
        wanted.push(["statics", `get ${o.name}`]);
        wanted.push(["statics", `set ${o.name}`]);
      } else {
        wanted.push(["methods", o.name]);
        wanted.push(["getters", o.name]);
        wanted.push(["setters", o.name]);
      }
    }
    for (const w of wanted) {
      const own = memberIn(this.host.tables.arenas.classOf(c), w[0], w[1]);
      if (own === undefined || typed(this.host.tables.arenas.bodyOf(own))) continue;
      const replaced = this.replaced(c, w[0], w[1], own);
      if (replaced !== undefined) this.fitsOverride(own, replaced);
    }
  }

  // What a member of a class replaces: its nearest base's member, or the embedded Map's or Set's.
  private replaced(this: Mut<this>, c: ClassId, table: Table, key: string, own: BodyId): Replaced | undefined {
    let at = this.host.tables.arenas.classOf(c).base;
    while (at !== undefined) {
      const b = at;
      const found = memberIn(this.host.tables.arenas.classOf(b), table, key);
      if (found !== undefined && !typed(this.host.tables.arenas.bodyOf(found))) {
        const name = `${this.host.tables.typing.rec(this.host.tables.arenas.classOf(b).type).name}.${key}`;
        let params: (Type | undefined)[] = [];
        const count = this.host.tables.arenas.bodyOf(found).params.length;
        for (let i: usize = 0; i < count; i++) {
          const written = this.host.tables.arenas.bodyOf(found).params[i]!.type;
          params.push(written !== undefined ? this.resolveIn(found, cloneTypeNode(written)) : undefined);
        }
        const returns = this.host.tables.arenas.bodyOf(found).returnType;
        return { name, params, returns: returns !== undefined ? this.resolveIn(found, cloneTypeNode(returns)) : undefined };
      }
      const info = this.host.tables.arenas.classOf(b);
      const shadows = table === "statics" ? info.staticFields.has(key) : info.methods.has(key);
      if (found !== undefined || shadows || info.fields.some((f) => f.name === key)) return undefined;
      at = info.base;
    }
    const embedding = this.embedding(c);
    if (embedding === undefined || table === "statics" || table === "setters") return undefined;
    const r = this.host.tables.typing.rec(embedding);
    const k = r.key;
    const v = r.value;
    const set = r.set;
    const name = `${set ? "Set" : "Map"}.${key}`;
    if (table === "getters") return key === "size" ? { name, params: [], returns: "usize" } : undefined;
    if (!this.host.tables.arenas.bodyOf(own).name.endsWith(`.${key}`)) return undefined;
    switch (key) {
      case "get":
        return { name, params: [k], returns: this.host.tables.typing.unionType([v, "null"]) };
      case "has":
        return { name, params: [k], returns: "boolean" };
      case "delete":
        return { name, params: [k], returns: "boolean" };
      case "clear":
        return { name, params: [], returns: "void" };
      case "set":
        if (set) return { name, params: [], returns: undefined };
        return { name, params: [k, v], returns: undefined };
      case "add":
        if (set) return { name, params: [k], returns: undefined };
        return { name, params: [], returns: undefined };
    }
    return undefined;
  }

  // The Map or Set a class or its bases embed.
  private embedding(this: Mut<this>, c: ClassId): MapType | undefined {
    let at: ClassId | undefined = c;
    while (at !== undefined) {
      const b: Ref<ClassInfo> = this.host.tables.arenas.classOf(at);
      if (b.embedded !== undefined) {
        const laid = this.host.tables.typing.rec(b.type);
        for (const f of laid.fields) if (f.name === EMBEDDED) return this.host.tables.typing.lower(f.type) as MapType;
        return undefined;
      }
      at = b.base;
    }
    return undefined;
  }

  // A type a member writes, in its scope, or nothing when it doesn't resolve.
  private resolveIn(this: Mut<this>, f: BodyId, t: TypeNode): Type | undefined {
    let scope = new Map<string, Type>();
    const written = this.host.tables.arenas.bodyOf(f).scope;
    if (written !== undefined) for (const [n, x] of written) scope.set(n, x);
    try {
      return this.host.resolveIn(scope, t);
    } catch {
      return undefined;
    }
  }

  // A type behind any references, as a parameter naming the class itself, `Ref<this>`, names it.
  private held(t: Type): Type {
    if (typeof t === "string") return t;
    const r = this.host.tables.typing.rec(t);
    return r.kind === "ref" ? this.held(r.to) : t;
  }

  // Whether two types are classes one of which derives from the other.
  private related(x: Type, y: Type): boolean {
    const a = this.held(x);
    const b = this.held(y);
    if (typeof a === "string" || typeof b === "string" || this.host.tables.typing.rec(a).kind !== "class" || this.host.tables.typing.rec(b).kind !== "class") return false;
    return this.host.tables.typing.derives(a as ClassType, b as ClassType) || this.host.tables.typing.derives(b as ClassType, a as ClassType);
  }

  /** @throws {CompileError} */
  private fitsOverride(this: Mut<this>, own: BodyId, replaced: Replaced) {
    const ownName = this.host.tables.arenas.bodyOf(own).name;
    const member = ownName.slice((ownName.lastIndexOf(".") + 1) as i64);
    const count = this.host.tables.arenas.bodyOf(own).params.length;
    for (let i: usize = 0; i < count; i++) {
      const p = paramAt(this.host.tables.arenas.bodyOf(own), i);
      const name = p.name !== undefined ? p.name : `${i + 1}`;
      const at = { start: p.start, end: p.end };
      if (i >= replaced.params.length) {
        if (p.optional) continue;
        throw new CompileError("E0704", `'${member}' overrides '${replaced.name}', which takes ${replaced.params.length} parameter${replaced.params.length === 1 ? "" : "s"}, so its parameter '${name}' must be optional`, at.start, at.end);
      }
      const want = replaced.params[i];
      const got = p.type !== undefined ? this.resolveIn(own, p.type) : undefined;
      if (want === undefined || got === undefined || this.related(want, got)) continue;
      if (!this.host.tables.typing.fits(want, got)) throw new CompileError("E0704", `'${member}' overrides '${replaced.name}', so its parameter '${name}' takes '${this.host.tables.typing.show(want)}' as that one does, not '${this.host.tables.typing.show(got)}'`, at.start, at.end);
    }
    const returnType = this.host.tables.arenas.bodyOf(own).returnType;
    if (returnType === undefined) return;
    const at = { start: returnType.start, end: returnType.end };
    const got = this.resolveIn(own, cloneTypeNode(returnType));
    if (replaced.returns === undefined || got === undefined || this.related(replaced.returns, got)) return;
    if (!this.host.tables.typing.fits(got, replaced.returns)) throw new CompileError("E0704", `'${member}' overrides '${replaced.name}', so it gives '${this.host.tables.typing.show(replaced.returns)}' as that one does, not '${this.host.tables.typing.show(got)}'`, at.start, at.end);
  }

  // The class `extends` names, a generic one made from the type arguments it is written with,
  // as this class's own type parameters stand for them.
  /** @throws {CompileError} */
  private baseOf(this: Mut<this>, c: ClassId, name: string): ClassId {
    const at = this.extendsSpan(c);
    if (!this.host.classes.has(name) && !this.host.templates.has(name)) throw new CompileError("E0401", `cannot find class '${name}'${didYouMean(name, this.host.classNames(at.start))}`, at.start, at.end);
    const written = this.host.tables.arenas.classOf(c).node.extends;
    let args: TypeNode[] = [];
    const instantiated = written !== undefined && written.kind === "instantiation";
    if (written !== undefined && written.kind === "instantiation") for (const a of written.typeArgs) args.push(cloneTypeNode(a));
    // A declared class is found by name: an abstract one is no type a value can have to resolve.
    const declared = instantiated ? undefined : this.host.classes.get(name);
    if (declared !== undefined) return declared;
    let scope = new Map<string, Type>();
    for (const [n, t] of this.host.tables.arenas.classOf(c).scope) scope.set(n, t);
    const refId = nextId(this.host.tables.ids);
    const type = this.host.resolveIn(scope, { id: refId, kind: "ref", name, args, start: at.start, end: at.end }) as ClassType;
    return this.host.registryState.infoOf.get(type)!;
  }

  // Resolves a class's field types. An unannotated field takes its initializer's type, which
  // is checked as the body of a function that returns it, so it may use other classes.
  // Whether its fields are known, which they aren't yet while its own fields are being resolved.
  /** @throws {CompileError} */
  layout(this: Mut<this>, c: ClassId): boolean {
    const type = this.host.tables.arenas.classOf(c).type;
    const base = this.host.tables.arenas.classOf(c).base;
    if (this.host.registryState.laidOut.has(type)) return !this.host.registryState.laying.has(type) && (base === undefined || this.layout(base));
    // A generic class's instance is made after the declared classes are linked.
    this.link(c, new TypeSet<ClassType>());
    this.host.registryState.laidOut.add(type);
    this.host.registryState.laying.set(type, c);
    const linked = this.host.tables.arenas.classOf(c).base;
    if (linked !== undefined) this.layout(linked);
    let written: FieldDecl[] = [];
    for (const f of this.host.tables.arenas.classOf(c).fields) written.push(cloneFieldDecl(f));
    let fields: Field[] = [];
    let spans: Span[] = [];
    for (const f of written) spans.push({ start: f.start, end: f.end });
    while (written.length > 0) fields.push(this.fieldOf(type, this.scopeOf(c), written.shift()!));
    let laid = this.host.tables.typing.rec(type);
    laid.fields = fields;
    this.host.tables.typing.setRec(type, laid);
    // A class is laid out as written, so a pattern in a field would reach the binary; one coming
    // from a generic class's type argument goes when the class is made from the lowered argument.
    const patterned = this.patterned(type);
    if (patterned !== undefined) throw unsupported("template literal pattern types in class fields", { start: spans[patterned]!.start, end: spans[patterned]!.end });
    this.host.registryState.laying.delete(type);
    // Before any body reads its fields, a class that contains itself holds itself in a block.
    let seen = new TypeSet<Type>();
    if (this.contains(type, type, seen)) this.holdItself(type);
    return true;
  }

  // A field's type as laid out.
  /** @throws {CompileError} */
  private fieldOf(this: Mut<this>, type: ClassType, scope: Map<string, Type>, f: FieldDecl): Field {
    const at = { start: f.start, end: f.end };
    if (f.type !== undefined) {
      const written = this.host.resolveIn(scope, f.type);
      const resolved = storable(this.host.tables.typing, written, at);
      let field: Field = { name: f.name, type: resolved, access: f.access };
      if (f.readonly) field.readonly = true;
      if (f.written !== undefined) {
        const written = this.host.resolveIn(scope, f.written);
        const optional = this.host.tables.typing.optionalField(f.name, written).optional;
        if (optional !== undefined) field.optional = optional;
      } else if (f.undefinedSpelled === true) field.optional = "undefined";
      return field;
    }
    const init = f.init!;
    if (init.kind === "arrow") throw unsupported("functions stored in fields", at);
    const name = `${this.host.tables.typing.rec(type).name}.${f.name} initializer`;
    let bodyScope = new Map<string, Type>();
    for (const [n, t] of scope) bodyScope.set(n, t);
    const id = nextId(this.host.tables.ids);
    const initializer = this.host.tables.arenas.addBody({
      id, name, params: [], body: [{ id: nextId(this.host.tables.ids), kind: "return", value: init, start: f.start, end: f.end }], returnType: undefined,
      owner: type, scope: bodyScope, start: f.start, end: f.end,
    }).bodyId;
    let field: Field = { name: f.name, type: this.host.initializerType(initializer), access: f.access };
    if (f.readonly) field.readonly = true;
    return field;
  }

  // The first field holding a template literal pattern type that no type argument brought in.
  private patterned(this: Mut<this>, type: ClassType): usize | undefined {
    const laid = this.host.tables.typing.rec(type);
    if (laid.generic !== undefined) for (const t of laid.generic.args) if (this.host.tables.typing.holdsPattern(t)) return undefined;
    for (let i: usize = 0; i < laid.fields.length; i++) if (this.host.tables.typing.holdsPattern(laid.fields[i]!.type)) return i;
    return undefined;
  }

  // `implements` is optional, since satisfying an interface is by shape, but checked when written.
  /** @throws {CompileError} */
  private implemented(this: Mut<this>, c: ClassId) {
    this.claims(c);
    if (this.host.tables.arenas.classOf(c).node.implements.some((node) => node.kind === "ref" && node.name === "From")) this.wrapsOf(c);
  }

  // The interfaces and types a class says it implements, as written.
  private implementsOf(c: ClassId): TypeNode[] {
    let out: TypeNode[] = [];
    for (const node of this.host.tables.arenas.classOf(c).node.implements) out.push(cloneTypeNode(node));
    return out;
  }

  private scopeOf(c: ClassId): Map<string, Type> {
    let scope = new Map<string, Type>();
    for (const [n, t] of this.host.tables.arenas.classOf(c).scope) scope.set(n, t);
    return scope;
  }

  // Checks the interfaces and types a class says it implements, `From` aside.
  /** @throws {CompileError} */
  claims(this: Mut<this>, c: ClassId) {
    const type = this.host.tables.arenas.classOf(c).type;
    const scope = this.scopeOf(c);
    for (const node of this.implementsOf(c)) {
      if (node.kind === "ref" && node.name === "From") continue;
      const trait = this.host.resolveIn(scope, node);
      const named = typeof trait === "string" ? undefined : this.host.tables.typing.rec(trait);
      const name = this.host.tables.typing.rec(type).name;
      let members = this.host.members();
      const reason = named !== undefined && named.kind === "interface" ? unsatisfied(type, trait as InterfaceType, members, { start: node.start, end: node.end })
        : this.host.tables.typing.fits(type, trait) ? undefined : `type '${name}' doesn't fit '${this.host.tables.typing.show(trait)}'`;
      if (reason === undefined) continue;
      let refused = members.refused();
      refused.push({ type: this.host.tables.typing.show(type), trait: this.host.tables.typing.show(trait), reason });
      throw new CompileError("E0702", `class '${name}' incorrectly implements '${this.host.tables.typing.show(trait)}': ${reason}`, node.start, node.end);
    }
  }

  // `implements From<X>` makes the class's static `from` wrap an X as one, wherever an X is
  // raised where the class is thrown. Worked out when first asked, since a function raising
  // one may be checked before the class is settled.
  /** @throws {CompileError} */
  wrapsOf(this: Mut<this>, c: ClassId): ClassInfo["wraps"] {
    const type = this.host.tables.arenas.classOf(c).type;
    if (this.host.registryState.wrapped.has(type)) return this.wraps(c);
    this.host.registryState.wrapped.add(type);
    const scope = this.scopeOf(c);
    for (const node of this.implementsOf(c)) {
      if (node.kind !== "ref" || node.name !== "From") continue;
      if (node.args.length !== 1) throw new CompileError("E0702", "'From' takes the type it wraps, like 'From<DbError>'", node.start, node.end);
      const x = this.host.resolveIn(scope, node.args[0]!);
      const from = this.host.tables.arenas.classOf(c).statics.get("from");
      const name = this.host.tables.typing.rec(type).name;
      const wanted = `class '${name}' implements 'From<${this.host.tables.typing.show(x)}>', so it needs 'static from(e: ${this.host.tables.typing.show(x)}): ${name}'`;
      if (from === undefined) throw new CompileError("E0702", wanted, node.start, node.end);
      const f = this.host.tables.arenas.bodyOf(from);
      if (f.params.length !== 1 || f.params[0]!.type === undefined || f.returnType === undefined) throw new CompileError("E0702", wanted, node.start, node.end);
      const paramNode = cloneTypeNode(f.params[0]!.type!);
      const returnNode = cloneTypeNode(f.returnType!);
      const param = this.host.resolveIn(scope, paramNode);
      const returns = this.host.resolveIn(scope, returnNode);
      const g = this.host.tables.arenas.bodyOf(from);
      if (!this.host.tables.typing.fits(x, param) || returns !== type) throw new CompileError("E0702", wanted, g.start, g.end);
      if (g.throws !== undefined) throw new CompileError("E0702", `'${name}.from' wraps an error, so it can't throw one itself`, g.throws.start, g.throws.end);
      if (g.params[0]!.comptime) throw new CompileError("E1102", `'${name}.from' wraps errors as they are raised at run time, so it can't take a comptime parameter`, g.params[0]!.start, g.params[0]!.end);
      let info = this.host.tables.arenas.classMut(c);
      info.wraps.push([x, from, param]);
    }
    return this.wraps(c);
  }

  private wraps(c: ClassId): ClassInfo["wraps"] {
    let out: ClassInfo["wraps"] = [];
    for (const w of this.host.tables.arenas.classOf(c).wraps) out.push([w[0], w[1], w[2]]);
    return out;
  }

  // A class that contains itself, directly or through other classes, holds itself behind a
  // pointer wherever it appears inside the classes it contains, as an alias that holds itself
  // does.
  private holdItself(this: Mut<this>, c: ClassType) {
    let args: Type[] = [];
    const generic = this.host.tables.typing.rec(c).generic;
    if (generic !== undefined) for (const a of generic.args) args.push(a);
    const back = this.host.tables.typing.blockFor(c, args);
    let holders = new TypeSet<ClassType | VariantType>();
    this.reach(c, holders);
    for (const h of holders) {
      let fields: Field[] = [];
      for (const f of this.host.tables.typing.fieldsOf(h)) fields.push(copyField(f));
      for (let i: usize = 0; i < fields.length; i++) fields[i]!.type = swapped(this.host.tables.typing, fields[i]!.type, c, back);
      const r = this.host.tables.typing.rec(h);
      if (r.kind === "class") {
        let laid = this.host.tables.typing.rec(h as ClassType);
        laid.fields = fields;
        this.host.tables.typing.setRec(h as ClassType, laid);
      } else {
        let laid = this.host.tables.typing.rec(h as VariantType);
        laid.fields = fields;
        this.host.tables.typing.setRec(h as VariantType, laid);
      }
    }
  }

  // The classes and variants a type holds inline, through unions and objects.
  private reach(t: Type, holders: Mut<TypeSet<ClassType | VariantType>>): void {
    if (typeof t === "string") return;
    const r = this.host.tables.typing.rec(t);
    if (r.kind === "class" || r.kind === "variant") {
      if (holders.has(t as ClassType | VariantType)) return;
      holders.add(t as ClassType | VariantType);
      for (const f of r.fields) this.reach(f.type, holders);
      if (r.kind === "class" && r.base !== undefined) this.reach(r.base, holders);
    } else if (r.kind === "union") for (const m of r.members) this.reach(m, holders);
    else if (r.kind === "object") for (const f of r.fields) this.reach(f.type, holders);
  }

  private contains(t: Type, inner: ClassType, seen: Mut<TypeSet<Type>>): boolean {
    if (typeof t === "string" || seen.has(t)) return false;
    seen.add(t);
    const r = this.host.tables.typing.rec(t);
    let parts: Type[] = [];
    for (const f of this.host.tables.typing.fieldsOf(t)) parts.push(f.type);
    if (r.kind === "class" && r.base !== undefined) parts.push(r.base);
    if (r.kind === "union") for (const m of r.members) parts.push(m);
    for (const p of parts) if (p === inner || this.contains(p, inner, seen)) return true;
    return false;
  }

  /** @throws {CompileError} */
  classOf(this: Mut<this>, t: ClassType): Ref<ClassInfo> {
    const c = this.classIdOf(t);
    return this.host.tables.arenas.classOf(c);
  }

  // The class `t` is an instance of, laid out.
  /** @throws {CompileError} */
  classIdOf(this: Mut<this>, t: ClassType): ClassId {
    const c = this.host.registryState.infoOf.get(t)!;
    this.layout(c);
    return c;
  }
}

// What `override` checking reads of a member's parameter.
function paramAt(f: Ref<Body>, i: usize): { name: string | undefined; start: usize; end: usize; optional: boolean; type: TypeNode | undefined } {
  return paramInfo(f.params[i]!);
}

function paramInfo(p: Ref<Param>): { name: string | undefined; start: usize; end: usize; optional: boolean; type: TypeNode | undefined } {
  return {
    name: p.pattern.kind === "ident" ? p.pattern.name : undefined,
    start: p.start,
    end: p.end,
    optional: p.optional || p.default !== undefined || p.rest,
    type: p.type !== undefined ? cloneTypeNode(p.type) : undefined,
  };
}

// A type with a class it holds inline, in a union, an object or a tuple, swapped for another.
function swapped(typing: Mut<Typing>, t: Type, from: ClassType, to: Type): Type {
  if (t === from) return to;
  if (typeof t === "string") return t;
  const r = typing.rec(t);
  if (r.kind === "union") {
    const name = r.name;
    let members: Type[] = [];
    for (const m of r.members) members.push(m);
    let out: Type[] = [];
    for (const m of members) out.push(swapped(typing, m, from, to));
    return typing.unionType(out, name);
  }
  if (r.kind !== "object" || r.match !== undefined) return t;
  if (r.tuple === true) {
    const rest = r.rest;
    let elements: Type[] = [];
    for (const e of typing.elementsOf(t as ObjectType)) elements.push(swapped(typing, e, from, to));
    const kept = rest !== undefined ? swapped(typing, rest, from, to) : undefined;
    return typing.retuple(t as ObjectType, elements, kept);
  }
  let fields: Field[] = [];
  for (const f of r.fields) fields.push(copyField(f));
  for (let i: usize = 0; i < fields.length; i++) fields[i]!.type = swapped(typing, fields[i]!.type, from, to);
  return typing.objectType(fields);
}
