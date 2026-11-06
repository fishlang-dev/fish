import { checkOverrideModifiers, checkOverrides, copySelfTyped, embed, extend, implementAbstracts, type Body, type ClassInfo } from "./classes.ts";
import type { Tables } from "./compilation.ts";
import { nextId } from "./nodes.ts";
import type { Arenas, ClassId } from "./arenas.ts";
import { unsupported } from "./unsupported.ts";
import { rustClassOf } from "./rust.ts";
import type { Instance } from "./check.ts";
import { CompileError } from "./diag.ts";
import { didYouMean } from "./suggest.ts";
import { unsatisfied, type Members } from "./interfaces.ts";
import type { ClassNode, TypeNode } from "./parser.ts";
import { storable, type InScope } from "./resolve.ts";
import { EMBEDDED, type MapType, type RefType, type InterfaceType, type ObjectType, TypeMap, TypeSet, type ClassType, type Type, type VariantType, type Typing } from "./typing.ts";

// A member a class's `override` replaces: its name as shown, its parameters' types and its result.
type Replaced = { name: string; params: (Type | undefined)[]; returns: Type | undefined };

/** @throws {CompileError} */
type SettleRun = () => void;

/** @throws {CompileError} */
type SettleEach = (run: SettleRun) => void;

// Every class the program uses, declared or a generic class's instance: linked to its base,
// laid out, checked against what it claims, and its members checked at their definitions.

// What the registry needs from the checker, which in turn needs it, so each reaches the
// other lazily.
export interface RegistryHost {
  tables: Tables;
  classes: Map<string, ClassId>;
  templates: Map<string, ClassNode>;
  members(this: Mut<this>): Members;
  registryState: RegistryState;
  /** @throws {CompileError} */
  resolveType(t: TypeNode): Type;
  /** @throws {CompileError} */
  withScope<T>(bindings: Map<string, Type>, f: InScope<T>): T;
  /** @throws {CompileError} */
  instanceOf(f: Body): Instance;
  /** @throws {CompileError} */
  definition(f: Body): Instance;
  /** @throws {CompileError} */
  checkBody(i: Instance): void;
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

export class Registry<H extends RegistryHost> {
  host: Mut<H>;

  constructor(host: Mut<H>) {
    this.host = host;
    this.typing = this.host.tables.typing;
    this.ids = this.host.tables.ids;
    this.arenas = this.host.tables.arenas;
  }
  private typing: Typing;
  private ids: Tables["ids"];
  private arenas: Arenas;

  register(this: Mut<this>, c: ClassInfo) {
    this.host.registryState.infoOf.set(c.type, c.classId);
    this.host.registryState.unsettled.push(c.classId);
  }

  // Lays out a class, checks what it claims, and checks each of its members at its definition,
  // each through `each`, which may recover from one member's error to check the next.
  /** @throws {CompileError} */
  settle(this: Mut<this>, c: ClassInfo, each: SettleEach = (run) => run()) {
    this.layout(c);
    this.overrideSignatures(c);
    this.implemented(c);
    this.bodiesOf(c).forEach((f) => each(() => this.host.checkBody(this.host.definition(f))));
  }

  bodiesOf(c: ClassInfo): Body[] {
    return [...new Set([c.constructor, ...c.methods.values(), ...c.statics.values(), ...c.getters.values(), ...c.setters.values(), ...c.copies.values()])].map((b) => this.arenas.bodyOf(b));
  }

  // Bases are linked first, since a derived constructor may take its base's parameters. An abstract
  // class's templates are marked, and a concrete class's copies made, before overrides are checked.
  /** @throws {CompileError} */
  link(this: Mut<this>, c: ClassInfo, path: TypeSet<ClassType>) {
    if (this.host.registryState.linked.has(c.type)) return;
    if (c.baseName === undefined) {
      checkOverrideModifiers(this.arenas, this.typing, c);
      implementAbstracts(this.host.tables, c);
      this.host.registryState.linked.add(c.type);
      return;
    }
    if (path.has(c.type)) throw new CompileError("E0704", `class '${this.typing.rec(c.type).name}' embeds itself through 'extends'`, c.node.start, c.node.end);
    if ((c.baseName === "Map" || c.baseName === "Set") && !this.host.classes.has(c.baseName) && !this.host.templates.has(c.baseName)) {
      embed(this.host.tables, c.classId, c.baseName);
      checkOverrideModifiers(this.arenas, this.typing, c);
      implementAbstracts(this.host.tables, c);
      this.host.registryState.linked.add(c.type);
      return;
    }
    const base = this.baseOf(c, c.baseName);
    // A Rust type's value is Rust's, behind its handle, with no fields to embed.
    const rust = rustClassOf(this.typing, base.type);
    if (rust) throw new CompileError("E1004", `a class can't extend the Rust type '${rust.name}'; hold one in a field instead`, c.node.extends!.start, c.node.extends!.end);
    this.link(base, path.add(c.type));
    const at = c.node.extends!;
    extend(this.host.tables, c.classId, base.classId, (name) => this.host.withScope(new Map(), () => this.host.resolveType({ id: nextId(this.ids), kind: "ref", name, args: [], start: at.start, end: at.end })));
    implementAbstracts(this.host.tables, c);
    copySelfTyped(this.host.tables, c);
    checkOverrides(this.arenas, this.typing, c);
    checkOverrideModifiers(this.arenas, this.typing, c);
    this.host.registryState.linked.add(c.type);
  }

  // A member written `override` takes what the member it replaces takes, as TypeScript checks:
  // each parameter that one is given fits this one's, any further parameter is optional, and its
  // result fits that one's.
  /** @throws {CompileError} */
  private overrideSignatures(this: Mut<this>, c: ClassInfo) {
    for (const o of c.overrides) {
      const tables = o.static ? [["statics", o.name], ["statics", `get ${o.name}`], ["statics", `set ${o.name}`]] as const : [["methods", o.name], ["getters", o.name], ["setters", o.name]] as const;
      for (const [table, key] of tables) {
        const own = this.arenas.bodyOf(c[table].get(key));
        if (!own || own.typeParams?.length) continue;
        const replaced = this.replaced(c, table, key, own);
        if (replaced) this.fitsOverride(own, replaced);
      }
    }
  }

  // What a member of a class replaces: its nearest base's member, or the embedded Map's or Set's.
  private replaced(this: Mut<this>, c: ClassInfo, table: "methods" | "getters" | "setters" | "statics", key: string, own: Body): Replaced | undefined {
    for (let b = this.arenas.classOf(c.base); b; b = this.arenas.classOf(b.base)) {
      const found = this.arenas.bodyOf(b[table].get(key));
      if (found && !found.typeParams?.length) return { name: `${this.typing.rec(b.type).name}.${key}`, params: found.params.map((p) => p.type && this.resolveIn(found, p.type)), returns: found.returnType && this.resolveIn(found, found.returnType) };
      if (found || b[table === "statics" ? "staticFields" : "methods"].has(key) || b.fields.some((f) => f.name === key)) return undefined;
    }
    const embedding = this.embedding(c);
    if (!embedding || table === "statics" || table === "setters") return undefined;
    const { key: k, value: v, set } = this.typing.rec(embedding);
    const name = `${set ? "Set" : "Map"}.${key}`;
    if (table === "getters") return key === "size" ? { name, params: [], returns: "usize" } : undefined;
    const keyed: Record<string, Replaced> = {
      get: { name, params: [k], returns: this.typing.unionType([v, "null"]) },
      has: { name, params: [k], returns: "boolean" },
      delete: { name, params: [k], returns: "boolean" },
      clear: { name, params: [], returns: "void" },
      set: { name, params: set ? [] : [k, v], returns: undefined },
      add: { name, params: set ? [k] : [], returns: undefined },
    };
    return own.name.endsWith(`.${key}`) ? keyed[key] : undefined;
  }

  // The Map or Set a class or its bases embed.
  private embedding(c: ClassInfo): MapType | undefined {
    for (let b: ClassInfo | undefined = c; b; b = this.arenas.classOf(b.base)) {
      if (!b.embedded) continue;
      const field = this.typing.rec(b.type).fields.find((f) => f.name === EMBEDDED);
      return field && (this.typing.lower(field.type) as MapType);
    }
    return undefined;
  }

  private resolveIn(f: Body, t: TypeNode): Type | undefined {
    try {
      return this.host.withScope(f.scope ?? new Map(), () => this.host.resolveType(t));
    } catch {
      return undefined;
    }
  }

  /** @throws {CompileError} */
  private fitsOverride(this: Mut<this>, own: Body, replaced: Replaced) {
    const show = (t: Type) => this.typing.show(t);
    // A parameter naming the class itself, as `Ref<this>` does, names each class in turn.
    const held = (t: Type): Type => (typeof t !== "string" && this.typing.rec(t).kind === "ref" ? held(this.typing.rec(t as RefType).to) : t);
    const related = (x: Type, y: Type) => {
      const [a, b] = [held(x), held(y)];
      if (typeof a === "string" || typeof b === "string" || this.typing.rec(a).kind !== "class" || this.typing.rec(b).kind !== "class") return false;
      return this.typing.derives(a as ClassType, b as ClassType) || this.typing.derives(b as ClassType, a as ClassType);
    };
    const member = own.name.slice(own.name.lastIndexOf(".") + 1);
    own.params.forEach((p, i) => {
      const name = p.pattern.kind === "ident" ? p.pattern.name : `${i + 1}`;
      if (i >= replaced.params.length) {
        if (p.optional || p.default || p.rest) return;
        throw new CompileError("E0704", `'${member}' overrides '${replaced.name}', which takes ${replaced.params.length} parameter${replaced.params.length === 1 ? "" : "s"}, so its parameter '${name}' must be optional`, p.start, p.end);
      }
      const want = replaced.params[i];
      const got = p.type && this.resolveIn(own, p.type);
      if (want === undefined || got === undefined || related(want, got)) return;
      if (!this.typing.fits(want, got)) throw new CompileError("E0704", `'${member}' overrides '${replaced.name}', so its parameter '${name}' takes '${show(want)}' as that one does, not '${show(got)}'`, p.start, p.end);
    });
    const got = own.returnType && this.resolveIn(own, own.returnType);
    if (replaced.returns === undefined || got === undefined || related(replaced.returns, got)) return;
    if (!this.typing.fits(got, replaced.returns)) throw new CompileError("E0704", `'${member}' overrides '${replaced.name}', so it gives '${show(replaced.returns)}' as that one does, not '${show(got)}'`, own.returnType!.start, own.returnType!.end);
  }

  // The class `extends` names, a generic one made from the type arguments it is written with,
  // as this class's own type parameters stand for them.
  /** @throws {CompileError} */
  private baseOf(c: ClassInfo, name: string): ClassInfo {
    const at = c.node.extends!;
    if (!this.host.classes.has(name) && !this.host.templates.has(name)) throw new CompileError("E0401", `cannot find class '${name}'${didYouMean(name, this.host.classNames(at.start))}`, at.start, at.end);
    const args = at.kind === "instantiation" ? at.typeArgs : [];
    // A declared class is found by name: an abstract one is no type a value can have to resolve.
    const declared = at.kind === "instantiation" ? undefined : this.arenas.classOf(this.host.classes.get(name));
    if (declared) return declared;
    const type = this.host.withScope(c.scope, () => this.host.resolveType({ id: nextId(this.ids), kind: "ref", name, args, start: at.start, end: at.end })) as ClassType;
    return this.arenas.classOf(this.host.registryState.infoOf.get(type)!);
  }

  // Resolves a class's field types. An unannotated field takes its initializer's type, which
  // is checked as the body of a function that returns it, so it may use other classes.
  // Whether its fields are known, which they aren't yet while its own fields are being resolved.
  /** @throws {CompileError} */
  layout(this: Mut<this>, c: ClassInfo): boolean {
    const base = this.arenas.classOf(c.base);
    if (this.host.registryState.laidOut.has(c.type)) return !this.host.registryState.laying.has(c.type) && (!base || this.layout(base));
    // A generic class's instance is made after the declared classes are linked.
    this.link(c, new TypeSet());
    this.host.registryState.laidOut.add(c.type);
    this.host.registryState.laying.set(c.type, c.classId);
    if (c.base !== undefined) this.layout(this.arenas.classOf(c.base));
    this.typing.rec(c.type).fields = c.fields.map((f) => {
      const readonly = f.readonly ? { readonly: true } : {};
      if (f.type) {
        const type = storable(this.typing, this.host.withScope(c.scope, () => this.host.resolveType(f.type!)), f);
        const optional = f.written ? this.typing.optionalField(f.name, this.host.withScope(c.scope, () => this.host.resolveType(f.written!))).optional : f.undefinedSpelled && ("undefined" as const);
        return { name: f.name, type, access: f.access, ...readonly, ...(optional && { optional }) };
      }
      if (f.init!.kind === "arrow") throw unsupported("functions stored in fields", f);
      const name = `${this.typing.rec(c.type).name}.${f.name} initializer`;
      const initializer = this.host.tables.arenas.addBody({
        id: nextId(this.ids), name, params: [], body: [{ id: nextId(this.ids), kind: "return", value: f.init!, start: f.start, end: f.end }], returnType: undefined,
        owner: c.type, scope: c.scope, start: f.start, end: f.end,
      });
      const instance = this.host.instanceOf(initializer);
      this.host.checkBody(instance);
      return { name: f.name, type: this.typing.widenEnum(instance.branded?.returns ?? instance.returns), access: f.access, ...readonly };
    });
    // A class is laid out as written, so a pattern in a field would reach the binary; one coming
    // from a generic class's type argument goes when the class is made from the lowered argument.
    const laid = this.typing.rec(c.type);
    const patterned = laid.fields.findIndex((f) => this.typing.holdsPattern(f.type));
    if (patterned >= 0 && !laid.generic?.args.some((t) => this.typing.holdsPattern(t))) throw unsupported("template literal pattern types in class fields", c.fields[patterned]!);
    this.host.registryState.laying.delete(c.type);
    // Before any body reads its fields, a class that contains itself holds itself in a block.
    if (this.contains(c.type, c.type, new TypeSet())) this.holdItself(c.type);
    return true;
  }

  // `implements` is optional, since satisfying an interface is by shape, but checked when written.
  /** @throws {CompileError} */
  private implemented(this: Mut<this>, c: ClassInfo) {
    this.claims(c);
    if (c.node.implements.some((node) => node.kind === "ref" && node.name === "From")) this.wrapsOf(c);
  }

  // Checks the interfaces and types a class says it implements, `From` aside.
  /** @throws {CompileError} */
  claims(this: Mut<this>, c: ClassInfo) {
    for (const node of c.node.implements) {
      if (node.kind === "ref" && node.name === "From") continue;
      const trait = this.host.withScope(c.scope, () => this.host.resolveType(node));
      const named = typeof trait === "string" ? undefined : this.typing.rec(trait);
      const name = this.typing.rec(c.type).name;
      const members = this.host.members();
      const reason = named?.kind === "interface" ? unsatisfied(c.type, trait as InterfaceType, members, node)
        : this.typing.fits(c.type, trait) ? undefined : `type '${name}' doesn't fit '${this.typing.show(trait)}'`;
      if (!reason) continue;
      members.refused.push({ type: this.typing.show(c.type), trait: this.typing.show(trait), reason });
      throw new CompileError("E0702", `class '${name}' incorrectly implements '${this.typing.show(trait)}': ${reason}`, node.start, node.end);
    }
  }

  // `implements From<X>` makes the class's static `from` wrap an X as one, wherever an X is
  // raised where the class is thrown. Worked out when first asked, since a function raising
  // one may be checked before the class is settled.
  /** @throws {CompileError} */
  wrapsOf(this: Mut<this>, c: ClassInfo): ClassInfo["wraps"] {
    if (this.host.registryState.wrapped.has(c.type)) return c.wraps;
    this.host.registryState.wrapped.add(c.type);
    for (const node of c.node.implements) {
      if (node.kind !== "ref" || node.name !== "From") continue;
      if (node.args.length !== 1) throw new CompileError("E0702", "'From' takes the type it wraps, like 'From<DbError>'", node.start, node.end);
      const x = this.host.withScope(c.scope, () => this.host.resolveType(node.args[0]!));
      const from = this.arenas.bodyOf(c.statics.get("from"));
      const name = this.typing.rec(c.type).name;
      const wanted = `class '${name}' implements 'From<${this.typing.show(x)}>', so it needs 'static from(e: ${this.typing.show(x)}): ${name}'`;
      if (!from || from.params.length !== 1 || !from.params[0]!.type || !from.returnType) throw new CompileError("E0702", wanted, node.start, node.end);
      const [param, returns] = this.host.withScope(c.scope, () => [this.host.resolveType(from.params[0]!.type!), this.host.resolveType(from.returnType!)]);
      if (!this.typing.fits(x, param) || returns !== c.type) throw new CompileError("E0702", wanted, from.start, from.end);
      if (from.throws) throw new CompileError("E0702", `'${name}.from' wraps an error, so it can't throw one itself`, from.throws.start, from.throws.end);
      if (from.params[0]!.comptime) throw new CompileError("E1102", `'${name}.from' wraps errors as they are raised at run time, so it can't take a comptime parameter`, from.params[0]!.start, from.params[0]!.end);
      c.wraps.push([x, from.bodyId, param]);
    }
    return c.wraps;
  }

  // A class that contains itself, directly or through other classes, holds itself behind a
  // pointer wherever it appears inside the classes it contains, as an alias that holds itself
  // does.
  private holdItself(c: ClassType) {
    const back = this.typing.blockFor(c, this.typing.rec(c).generic?.args ?? []);
    const holders = new TypeSet<ClassType | VariantType>();
    const reach = (t: Type) => {
      if (typeof t === "string") return;
      const r = this.typing.rec(t);
      if (r.kind === "class" || r.kind === "variant") {
        if (holders.has(t as ClassType | VariantType)) return;
        holders.add(t as ClassType | VariantType);
        r.fields.forEach((f) => reach(f.type));
        if (r.kind === "class" && r.base) reach(r.base);
      } else if (r.kind === "union") r.members.forEach(reach);
      else if (r.kind === "object") r.fields.forEach((f) => reach(f.type));
    };
    reach(c);
    for (const h of holders) for (const f of this.typing.rec(h).fields) f.type = swapped(this.typing, f.type, c, back);
  }

  private contains(t: Type, inner: ClassType, seen: TypeSet<Type>): boolean {
    if (typeof t === "string" || seen.has(t)) return false;
    seen.add(t);
    const r = this.typing.rec(t);
    const parts = [...this.typing.fieldsOf(t).map((f) => f.type), ...(r.kind === "class" && r.base ? [r.base] : []), ...(r.kind === "union" ? r.members : [])];
    return parts.some((p) => p === inner || this.contains(p, inner, seen));
  }

  /** @throws {CompileError} */
  classOf(this: Mut<this>, t: ClassType): ClassInfo {
    const c = this.arenas.classOf(this.host.registryState.infoOf.get(t)!);
    this.layout(c);
    return c;
  }
}

// A type with a class it holds inline, in a union, an object or a tuple, swapped for another.
function swapped(typing: Typing, t: Type, from: ClassType, to: Type): Type {
  if (t === from) return to;
  if (typeof t === "string") return t;
  const r = typing.rec(t);
  if (r.kind === "union") return typing.unionType(r.members.map((m) => swapped(typing, m, from, to)), r.name);
  if (r.kind === "object" && !r.match) return r.tuple ? typing.retuple(t as ObjectType, typing.elementsOf(t as ObjectType).map((e) => swapped(typing, e, from, to)), r.rest !== undefined ? swapped(typing, r.rest, from, to) : undefined) : typing.objectType(r.fields.map((f) => ({ ...f, type: swapped(typing, f.type, from, to) })));
  return t;
}
