import { extend, type Body, type ClassInfo } from "./classes.ts";
import type { Instance } from "./check.ts";
import { CompileError } from "./diag.ts";
import { unsatisfied, type Members } from "./interfaces.ts";
import type { TypeNode } from "./parser.ts";
import { storable } from "./resolve.ts";
import { fits, show, widenEnum, type ClassType, type Type } from "./typing.ts";

// Every class the program uses, declared or a generic class's instance: linked to its base,
// laid out, checked against what it claims, and its members checked at their definitions.

// What the registry needs from the checker, which in turn needs it, so each reaches the
// other lazily.
type Checker = {
  classes: Map<string, ClassInfo>;
  members: Members;
  resolveType(t: TypeNode): Type;
  withScope<T>(bindings: Map<string, Type>, f: () => T): T;
  instanceOf(f: Body): Instance;
  definition(f: Body): Instance;
  checkBody(i: Instance): void;
};

export function registry({ classes, members, resolveType, withScope, instanceOf, definition, checkBody }: Checker) {
  // Every class by its type, and those not yet laid out and checked.
  const infoOf = new Map<ClassType, ClassInfo>();
  const unsettled: ClassInfo[] = [];
  const linked = new Set<ClassInfo>();
  const laidOut = new Set<ClassInfo>();
  return { register, settle, link, layout, classOf, bodiesOf, infoOf, unsettled };

  function register(c: ClassInfo) {
    infoOf.set(c.type, c);
    unsettled.push(c);
  }

  // Lays out a class, checks what it claims, and checks each of its members at its definition.
  function settle(c: ClassInfo) {
    layout(c);
    implemented(c);
    if (contains(c.type, c.type, new Set())) {
      throw new CompileError(`class '${c.type.name}' contains itself, so it would have infinite size`, c.constructor.start, c.constructor.end);
    }
    bodiesOf(c).forEach((f) => checkBody(definition(f)));
  }

  function bodiesOf(c: ClassInfo): Body[] {
    return [c.constructor, ...c.methods.values(), ...c.statics.values(), ...c.getters.values(), ...c.setters.values()];
  }

  // Bases are linked first, since a derived constructor may take its base's parameters.
  function link(c: ClassInfo, path: Set<ClassInfo>) {
    if (linked.has(c) || c.baseName === undefined) return;
    if (path.has(c)) throw new CompileError(`class '${c.type.name}' embeds itself through 'extends'`, c.node.start, c.node.end);
    const base = classes.get(c.baseName);
    if (!base) throw new CompileError(`cannot find class '${c.baseName}'`, c.node.extends!.start, c.node.extends!.end);
    link(base, path.add(c));
    extend(c, base);
    linked.add(c);
  }

  // Resolves a class's field types. An unannotated field takes its initializer's type, which
  // is checked as the body of a function that returns it, so it may use other classes.
  function layout(c: ClassInfo) {
    if (laidOut.has(c)) return;
    laidOut.add(c);
    if (c.base) layout(c.base);
    c.type.fields = c.fields.map((f) => {
      if (f.type) return { name: f.name, type: storable(withScope(c.scope, () => resolveType(f.type!)), f), access: f.access };
      const name = `${c.type.name}.${f.name} initializer`;
      const initializer: Body = {
        name, params: [], body: [{ kind: "return", value: f.init!, start: f.start, end: f.end }], returnType: undefined,
        owner: c.type, scope: c.scope, start: f.start, end: f.end,
      };
      const instance = instanceOf(initializer);
      checkBody(instance);
      return { name: f.name, type: widenEnum(instance.returns), access: f.access };
    });
  }

  // `implements` is optional, since satisfying an interface is by shape, but checked when written.
  function implemented(c: ClassInfo) {
    for (const node of c.node.implements) {
      const trait = withScope(c.scope, () => resolveType(node));
      const reason = typeof trait !== "string" && trait.kind === "interface" ? unsatisfied(c.type, trait, members, node)
        : fits(c.type, trait) ? undefined : `type '${c.type.name}' doesn't fit '${show(trait)}'`;
      if (reason) throw new CompileError(`class '${c.type.name}' incorrectly implements '${show(trait)}': ${reason}`, node.start, node.end);
    }
  }

  function contains(t: Type, inner: ClassType, seen: Set<Type>): boolean {
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
