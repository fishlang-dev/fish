import { checkOverrides, extend, implementAbstracts, type Body, type ClassInfo } from "./classes.ts";
import type { Tables } from "./compilation.ts";
import { nextId, NodeSet } from "./nodes.ts";
import { unsupported } from "./unsupported.ts";
import { rustClassOf } from "./rust.ts";
import type { Instance } from "./check.ts";
import { CompileError } from "./diag.ts";
import { didYouMean } from "./suggest.ts";
import { unsatisfied, type Members } from "./interfaces.ts";
import type { ClassNode, TypeNode } from "./parser.ts";
import { storable } from "./resolve.ts";
import { TypeMap, TypeSet, widenEnum, type ClassType, type Type, type VariantType, type Typing } from "./typing.ts";

// Every class the program uses, declared or a generic class's instance: linked to its base,
// laid out, checked against what it claims, and its members checked at their definitions.

// What the registry needs from the checker, which in turn needs it, so each reaches the
// other lazily.
type Checker = {
  tables: Tables;
  classes: Map<string, ClassInfo>;
  templates: Map<string, ClassNode>;
  members: Members;
  resolveType(t: TypeNode): Type;
  withScope<T>(bindings: Map<string, Type>, f: () => T): T;
  instanceOf(f: Body): Instance;
  definition(f: Body): Instance;
  checkBody(i: Instance): void;
  // The names of the classes a use at `at` reaches, for suggesting one.
  classNames(at: usize): string[];
};

export function registry({ tables, classes, templates, members, resolveType, withScope, instanceOf, definition, checkBody, classNames }: Checker) {
  const { typing, ids } = tables;
  const { optionalField, holdsPattern, fits, show, blockFor } = typing;
  // Every class by its type, and those not yet laid out and checked.
  const infoOf = new TypeMap<ClassType, ClassInfo>();
  const unsettled: ClassInfo[] = [];
  // Each class's progress, keyed by its type.
  const linked = new TypeSet<ClassType>();
  const laidOut = new TypeSet<ClassType>();
  const laying = new TypeMap<ClassType, ClassInfo>();
  const wrapped = new TypeSet<ClassType>();
  return { register, settle, link, layout, laying, classOf, bodiesOf, infoOf, unsettled, wrapsOf };

  function register(c: ClassInfo) {
    infoOf.set(c.type, c);
    unsettled.push(c);
  }

  // Lays out a class, checks what it claims, and checks each of its members at its definition.
  function settle(c: ClassInfo) {
    layout(c);
    implemented(c);
    bodiesOf(c).forEach((f) => checkBody(definition(f)));
  }

  function bodiesOf(c: ClassInfo): Body[] {
    return [...new NodeSet([c.constructor, ...c.methods.values(), ...c.statics.values(), ...c.getters.values(), ...c.setters.values(), ...c.copies.values()])];
  }

  // Bases are linked first, since a derived constructor may take its base's parameters. An abstract
  // class's templates are marked, and a concrete class's copies made, before overrides are checked.
  function link(c: ClassInfo, path: TypeSet<ClassType>) {
    if (linked.has(c.type)) return;
    if (c.baseName === undefined) {
      implementAbstracts(ids, c);
      linked.add(c.type);
      return;
    }
    if (path.has(c.type)) throw new CompileError(`class '${c.type.name}' embeds itself through 'extends'`, c.node.start, c.node.end);
    const base = baseOf(c, c.baseName);
    // A Rust type's value is Rust's, behind its handle, with no fields to embed.
    const rust = rustClassOf(base.type);
    if (rust) throw new CompileError(`a class can't extend the Rust type '${rust.name}'; hold one in a field instead`, c.node.extends!.start, c.node.extends!.end);
    link(base, path.add(c.type));
    const at = c.node.extends!;
    extend(tables, c, base, (name) => withScope(new Map(), () => resolveType({ id: nextId(ids), kind: "ref", name, args: [], start: at.start, end: at.end })));
    implementAbstracts(ids, c);
    checkOverrides(c);
    linked.add(c.type);
  }

  // The class `extends` names, a generic one made from the type arguments it is written with,
  // as this class's own type parameters stand for them.
  function baseOf(c: ClassInfo, name: string): ClassInfo {
    const at = c.node.extends!;
    if (!classes.has(name) && !templates.has(name)) throw new CompileError(`cannot find class '${name}'${didYouMean(name, classNames(at.start))}`, at.start, at.end);
    const args = at.kind === "instantiation" ? at.typeArgs : [];
    // A declared class is found by name: an abstract one is no type a value can have to resolve.
    const declared = at.kind === "instantiation" ? undefined : classes.get(name);
    if (declared) return declared;
    const type = withScope(c.scope, () => resolveType({ id: nextId(ids), kind: "ref", name, args, start: at.start, end: at.end })) as ClassType;
    return infoOf.get(type)!;
  }

  // Resolves a class's field types. An unannotated field takes its initializer's type, which
  // is checked as the body of a function that returns it, so it may use other classes.
  // Whether its fields are known, which they aren't yet while its own fields are being resolved.
  function layout(c: ClassInfo): boolean {
    if (laidOut.has(c.type)) return !laying.has(c.type) && (!c.base || layout(c.base));
    // A generic class's instance is made after the declared classes are linked.
    link(c, new TypeSet());
    laidOut.add(c.type);
    laying.set(c.type, c);
    if (c.base) layout(c.base);
    c.type.fields = c.fields.map((f) => {
      const readonly = f.readonly ? { readonly: true } : {};
      if (f.type) {
        const type = storable(typing, withScope(c.scope, () => resolveType(f.type!)), f);
        const optional = f.written ? optionalField(f.name, withScope(c.scope, () => resolveType(f.written!))).optional : f.undefinedSpelled && ("undefined" as const);
        return { name: f.name, type, access: f.access, ...readonly, ...(optional && { optional }) };
      }
      if (f.init!.kind === "arrow") throw unsupported("functions stored in fields", f);
      const name = `${c.type.name}.${f.name} initializer`;
      const initializer: Body = {
        id: nextId(ids), name, params: [], body: [{ id: nextId(ids), kind: "return", value: f.init!, start: f.start, end: f.end }], returnType: undefined,
        owner: c.type, scope: c.scope, start: f.start, end: f.end,
      };
      const instance = instanceOf(initializer);
      checkBody(instance);
      return { name: f.name, type: widenEnum(instance.returns), access: f.access, ...readonly };
    });
    // A class is laid out as written, so a pattern in a field would reach the binary; one coming
    // from a generic class's type argument goes when the class is made from the lowered argument.
    const patterned = c.type.fields.findIndex((f) => holdsPattern(f.type));
    if (patterned >= 0 && !c.type.generic?.args.some(holdsPattern)) throw unsupported("template literal pattern types in class fields", c.fields[patterned]!);
    laying.delete(c.type);
    // Before any body reads its fields, a class that contains itself holds itself in a block.
    if (contains(c.type, c.type, new TypeSet())) holdItself(c.type);
    return true;
  }

  // `implements` is optional, since satisfying an interface is by shape, but checked when written.
  function implemented(c: ClassInfo) {
    for (const node of c.node.implements) {
      if (node.kind === "ref" && node.name === "From") {
        wrapsOf(c);
        continue;
      }
      const trait = withScope(c.scope, () => resolveType(node));
      const reason = typeof trait !== "string" && trait.kind === "interface" ? unsatisfied(c.type, trait, members, node)
        : fits(c.type, trait) ? undefined : `type '${c.type.name}' doesn't fit '${show(trait)}'`;
      if (reason) throw new CompileError(`class '${c.type.name}' incorrectly implements '${show(trait)}': ${reason}`, node.start, node.end);
    }
  }

  // `implements From<X>` makes the class's static `from` wrap an X as one, wherever an X is
  // raised where the class is thrown. Worked out when first asked, since a function raising
  // one may be checked before the class is settled.
  function wrapsOf(c: ClassInfo): ClassInfo["wraps"] {
    if (wrapped.has(c.type)) return c.wraps;
    wrapped.add(c.type);
    for (const node of c.node.implements) {
      if (node.kind !== "ref" || node.name !== "From") continue;
      if (node.args.length !== 1) throw new CompileError("'From' takes the type it wraps, like 'From<DbError>'", node.start, node.end);
      const x = withScope(c.scope, () => resolveType(node.args[0]!));
      const from = c.statics.get("from");
      const name = c.type.name;
      const wanted = `class '${name}' implements 'From<${show(x)}>', so it needs 'static from(e: ${show(x)}): ${name}'`;
      if (!from || from.params.length !== 1 || !from.params[0]!.type || !from.returnType) throw new CompileError(wanted, node.start, node.end);
      const [param, returns] = withScope(c.scope, () => [resolveType(from.params[0]!.type!), resolveType(from.returnType!)]);
      if (!fits(x, param) || returns !== c.type) throw new CompileError(wanted, from.start, from.end);
      if (from.throws) throw new CompileError(`'${name}.from' wraps an error, so it can't throw one itself`, from.throws.start, from.throws.end);
      if (from.params[0]!.comptime) throw new CompileError(`'${name}.from' wraps errors as they are raised at run time, so it can't take a comptime parameter`, from.params[0]!.start, from.params[0]!.end);
      c.wraps.push([x, from, param]);
    }
    return c.wraps;
  }

  // A class that contains itself, directly or through other classes, holds itself behind a
  // pointer wherever it appears inside the classes it contains, as an alias that holds itself
  // does.
  function holdItself(c: ClassType) {
    const back = blockFor(c, c.generic?.args ?? []);
    const holders = new TypeSet<ClassType | VariantType>();
    const reach = (t: Type) => {
      if (typeof t === "string") return;
      if (t.kind === "class" || t.kind === "variant") {
        if (holders.has(t)) return;
        holders.add(t);
        t.fields.forEach((f) => reach(f.type));
        if (t.kind === "class" && t.base) reach(t.base);
      } else if (t.kind === "union") t.members.forEach(reach);
      else if (t.kind === "object") t.fields.forEach((f) => reach(f.type));
    };
    reach(c);
    for (const h of holders) for (const f of h.fields) f.type = swapped(typing, f.type, c, back);
  }

  function contains(t: Type, inner: ClassType, seen: TypeSet<Type>): boolean {
    if (typeof t === "string" || seen.has(t)) return false;
    seen.add(t);
    const parts = [...t.fields.map((f) => f.type), ...(t.kind === "class" && t.base ? [t.base] : []), ...(t.kind === "union" ? t.members : [])];
    return parts.some((p) => p === inner || contains(p, inner, seen));
  }

  function classOf(t: ClassType): ClassInfo {
    const c = infoOf.get(t)!;
    layout(c);
    return c;
  }
}

// A type with a class it holds inline, in a union, an object or a tuple, swapped for another.
function swapped(typing: Typing, t: Type, from: ClassType, to: Type): Type {
  const { unionType, retuple, objectType } = typing;
  if (t === from) return to;
  if (typeof t === "string") return t;
  if (t.kind === "union") return unionType(t.members.map((m) => swapped(typing, m, from, to)), t.name);
  if (t.kind === "object" && !t.match) return t.tuple ? retuple(t, (e) => swapped(typing, e, from, to)) : objectType(t.fields.map((f) => ({ ...f, type: swapped(typing, f.type, from, to) })));
  return t;
}
