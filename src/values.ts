import { inherited, type Body, type ClassInfo } from "./classes.ts";
import { unsatisfied, type Members } from "./interfaces.ts";
import { CompileError } from "./diag.ts";
import { ASSIGNMENTS, binaryType, SUPPORTED_OPERATORS } from "./operators.ts";
import type { Expr, ObjectProp, Param, Span, Stmt, TypeNode } from "./parser.ts";
import { fields } from "./resolve.ts";
import { allFields, baseOf, derives, field, fits, holdsRef, isCopy, literalType, lower, refType, objectType, show, widenEnum, wrapped } from "./typing.ts";
import type { Access, ClassType, Field, RefType, Type } from "./typing.ts";
import type { EnumInfo } from "./enums.ts";
import { EXPRESSION_FORMS, unsupported } from "./unsupported.ts";
import type { Instance, Local } from "./check.ts";
import { literalValue, type Facts, type Guard } from "./narrow.ts";
import { bothSides, instanceofCheck, intoMember, intoUnion, literalShape, typeofComparison, unionComparison, unionField, type Union } from "./unions.ts";

// Expression checking inside one function body: every value gets a type, every name its
// binding, and every value meeting a narrower declared type its coercion.

type Call = Extract<Expr, { kind: "call" }>;

const I64_MAX = (1n << 63n) - 1n;

export function isPrint(callee: Expr): boolean {
  if (callee.kind === "ident") return callee.name === "print";
  return callee.kind === "member" && callee.name === "log" &&
    callee.object.kind === "ident" && callee.object.name === "console";
}

const printable = (t: Type): boolean =>
  typeof t === "string" || t.kind === "literal" || (t.kind === "union" && t.members.every(printable));

// What expression checking needs from the program and the function it is in.
export type Context = {
  types: Map<Expr, Type>;
  locals: Map<Expr | Stmt | Param | ObjectProp, Local>;
  coercions: Map<Expr, Type>;
  calls: Map<Expr, Instance>;
  setters: Map<Expr, Instance>;
  byName: Map<string, Body>;
  classes: Map<string, ClassInfo>;
  enums: Map<string, EnumInfo>;
  construct(name: string, typeArgs: TypeNode[], argTypes: Type[], at: Span): ClassInfo | undefined;
  members: Members;
  returnOf(instance: Instance, at: Span): Type;
  // What a call returns as the calling body sees it: in terms of the calling instance's own
  // type parameters, where it passed them.
  resultOf(instance: Instance, at: Span): Type;
  classOf(t: ClassType): ClassInfo;
  instanceOf(f: Body): Instance;
  instantiate(f: Body, typeArgs: TypeNode[], args: Expr[], argTypes: Type[], at: Span): Instance;
  paramTypes(instance: Instance): Type[];
  lookup(name: string): Local | undefined;
  self: Body["self"];
  // The class whose constructor or method this is, which may reach its non-public members.
  owner: ClassType | undefined;
  // A derived constructor's `super(...)`, the one place a base constructor may be called.
  superCall: Expr | undefined;
  // Whether this `this` may be used: a constructor's can't until every field is assigned.
  thisReady(e: Expr): boolean;
  // Narrowing: what a condition proves, checking under what was proven, and a variable's
  // type where something narrowed it.
  proves(e: Expr): Guard;
  assume<T>(proven: Facts, check: () => T): T;
  narrowed(l: Local): Type | undefined;
  // False for a binding declared in another case of a switch, which entering this case skips.
  reachable(l: Local): boolean;
  // How deeply nested the scope declaring a binding is.
  depthOf(l: Local): number;
};

export function expressions(ctx: Context) {
  const { types, locals, coercions, calls, setters, byName, classes, enums, construct, members, returnOf, resultOf, classOf, instanceOf, instantiate, paramTypes, lookup } = ctx;
  const { self, owner, superCall, thisReady, proves, assume, narrowed, reachable, depthOf } = ctx;
  const unions: Union = {
    types, coercions, value: (e) => read(e), excess: (e, to) => excess(e, to),
    classNamed: (name) => (lookup(name) ? undefined : classes.get(name)?.type),
  };
  return { value, read, condition, effect, coerce };

  // Only a statement may call a function that returns nothing.
  function effect(e: Expr) {
    if (e.kind === "call") call(e);
    else value(e);
  }

  // Checks a call: what it returns, and how a message names what it calls.
  function call(e: Call): { type: Type; what: string } {
    const { callee } = e;
    if (e.optional || (callee.kind === "member" && callee.optional)) throw unsupported("optional calls", e);
    if (callee.kind === "super") {
      if (e !== superCall) throw new CompileError("'super(...)' can only be the first statement of a derived class's constructor", e.start, e.end);
      const base = classOf(self!.type.base!);
      types.set(callee, base.type);
      const argTypes = e.args.map(value);
      const instance = instantiate(base.constructor, [], e.args, argTypes, e);
      args(e.args, argTypes, instance, e);
      calls.set(e, instance);
      return { type: "void", what: "'super'" };
    }
    if (isPrint(callee)) {
      for (const a of e.args) {
        const type = a.kind === "string" ? "void" : read(a);
        if (printable(type)) continue;
        throw new CompileError(typeof type !== "string" && type.kind === "param" ? `a value of type '${type.name}' can't be printed`
          : "printing an object is not supported yet; print its fields", a.start, a.end);
      }
      return { type: "void", what: "printing" };
    }
    // The receiver is checked once, however its call is resolved.
    const receiver = callee.kind === "member" ? receiverType(callee) : undefined;
    if (callee.kind === "member" && callee.name === "clone" && receiver && copies(receiver)) return cloned(e, callee, receiver);
    if (callee.kind === "member" && typeof receiver !== "string" && (receiver?.kind === "param" || receiver?.kind === "interface")) {
      return traitCall(e, callee, receiver);
    }
    const target = callee.kind === "ident" ? byName.get(callee.name) : callee.kind === "member" ? method(callee, receiver) : undefined;
    if (!target) {
      const name = callee.kind === "ident" ? `'${callee.name}'` : "this expression";
      throw new CompileError(`unknown function ${name}`, callee.start, callee.end);
    }
    const argTypes = e.args.map(value);
    const instance = instantiate(target, e.typeArgs, e.args, argTypes, e);
    args(e.args, argTypes, instance, e);
    calls.set(e, instance);
    return { type: resultOf(instance, e), what: `'${target.name}'` };
  }

  // Whether `x.clone()` is the compiler's copy: for any value whose class doesn't declare a
  // `clone` method of its own. A base's `clone` makes a base, so it doesn't count.
  function copies(t: Type): boolean {
    if (typeof t === "string" || t.kind === "literal") return true;
    if (t.kind === "class") return !classOf(t).methods.has("clone");
    const bound = t.kind === "param" ? t.bound : t.kind === "interface" ? t : undefined;
    return !bound || bound.kind !== "interface" || !bound.methods.some((m) => m.name === "clone");
  }

  // The compiler's copy of a value, or in an instance, the concrete class's own `clone()`.
  function cloned(e: Call, callee: Extract<Expr, { kind: "member" }>, receiver: Type): { type: Type; what: string } {
    if (e.args.length > 0 || e.typeArgs.length > 0) throw new CompileError("'clone' takes no arguments", e.start, e.end);
    const stored = lower(receiver);
    if (stored !== receiver && typeof stored !== "string" && stored.kind === "class" && classOf(stored).methods.has("clone")) {
      return { type: concreteMethod(e, callee, stored, receiver), what: "'clone'" };
    }
    return { type: receiver, what: "'clone'" };
  }

  // The type of a member call's receiver, unless it is `super` or a class's name.
  function receiverType(callee: Extract<Expr, { kind: "member" }>): Type | undefined {
    const { object } = callee;
    if (object.kind === "super" || (object.kind === "ident" && !lookup(object.name) && classes.has(object.name))) return undefined;
    const type = value(object);
    // A method called through a reference gets the pointer itself.
    return typeof type !== "string" && type.kind === "ref" ? type.to : type;
  }

  // A method of an interface, called while checking a generic body at its definition on a
  // value of a type parameter bounded by it, or of an interface a call returned. Each
  // instance resolves the call to its concrete type's method.
  function traitCall(e: Call, callee: Extract<Expr, { kind: "member" }>, receiver: Extract<Type, { kind: "param" | "interface" }>): { type: Type; what: string } {
    const trait = receiver.kind === "param" ? receiver.bound : receiver;
    const found = trait?.kind === "interface" ? trait.methods.find((m) => m.name === callee.name) : undefined;
    if (!found) throw new CompileError(`property '${callee.name}' does not exist on type '${receiver.name}'`, callee.start, callee.end);
    if (e.typeArgs.length > 0) throw new CompileError("expected 0 type arguments", e.start, e.end);
    if (e.args.length !== found.params.length) {
      throw new CompileError(`expected ${found.params.length} argument${found.params.length === 1 ? "" : "s"}, but got ${e.args.length}`, e.start, e.end);
    }
    e.args.forEach((a, i) => {
      const type = value(a);
      coerce(a, type, found.params[i]!, `argument of type '${show(type)}' is not assignable to parameter of type '${show(found.params[i]!)}'`);
    });
    const stored = receiver.kind === "param" ? receiver.concrete : undefined;
    if (typeof stored !== "string" && stored?.kind === "class") return { type: concreteMethod(e, callee, stored, found.returns), what: `'${callee.name}'` };
    return { type: found.returns, what: `'${callee.name}'` };
  }

  // In an instance, a call through a type parameter runs its concrete class's method. An
  // interface it returns is, as for any call, the one concrete type the method returns.
  function concreteMethod(e: Call, callee: Extract<Expr, { kind: "member" }>, c: ClassType, returns: Type): Type {
    const target = inherited(classOf(c), "methods", callee.name)!;
    if (target.self!.mutable) mutates(callee.object, callee.name);
    const instance = instantiate(target, [], e.args, e.args.map((a) => coercions.get(a) ?? types.get(a)!), e);
    calls.set(e, instance);
    if (typeof returns === "string" || returns.kind !== "interface") return returns;
    return wrapped(returns.name, returns, lower(returnOf(instance, e)));
  }

  // A mutating method's receiver must be a place that could change, or a temporary.
  function mutates(object: Expr, name: string) {
    if (object.kind === "conditional") {
      throw new CompileError(`can't call '${name}' on a '?:', which would change a copy; call it in each branch`, object.start, object.end);
    }
    intoMember(object, types, `call '${name}' on`);
    if (place(object)) changeable(object, `call '${name}' on`);
  }

  // The method a member call names: a static one on a class name, or an instance one, whose
  // receiver must be able to change when the method changes it.
  function method(callee: Extract<Expr, { kind: "member" }>, receiver: Type | undefined): Body {
    const { object, name } = callee;
    const named = object.kind === "ident" && !lookup(object.name) ? classes.get(object.name) : undefined;
    if (named) {
      const found = inherited(named, "statics", name);
      if (!found) throw new CompileError(`property '${name}' does not exist on type 'typeof ${named.type.name}'`, callee.start, callee.end);
      visible(found.access, found.owner!, name, callee);
      return found;
    }
    if (object.kind === "super") return superMethod(callee);
    const type = receiver!;
    const found = typeof type !== "string" && type.kind === "class" ? inherited(classOf(type), "methods", name) : undefined;
    if (!found) throw new CompileError(`'${show(type)}' has no method '${name}'`, callee.start, callee.end);
    visible(found.access, found.owner!, name, callee);
    if (found.self!.mutable) mutates(object, name);
    return found;
  }

  // `super.m()` runs the base's `m` on the embedded base.
  function superMethod(callee: Extract<Expr, { kind: "member" }>): Body {
    const base = self?.type.base;
    if (!base) throw new CompileError("'super' can only be used in a class that extends another", callee.start, callee.end);
    if (!thisReady(callee.object)) throw new CompileError("'super' can't be used until every field is assigned", callee.object.start, callee.object.end);
    const found = inherited(classOf(base), "methods", callee.name);
    if (!found) throw new CompileError(`'${base.name}' has no method '${callee.name}'`, callee.start, callee.end);
    visible(found.access, found.owner!, callee.name, callee);
    if (found.self!.mutable && !self!.mutable) {
      throw new CompileError(`cannot call '${callee.name}' on 'super' because 'this' is read-only here; declare 'this: Mut<this>'`, callee.start, callee.end);
    }
    types.set(callee.object, base);
    return found;
  }

  // TypeScript's access rules: a private member is reachable only from inside its class, and
  // a protected one also from the classes that embed it.
  function visible(access: Access | undefined, declaring: ClassType, name: string, at: Span) {
    if (!access || access === "public" || owner === declaring) return;
    if (access === "protected" && owner && derives(owner, declaring)) return;
    const message = name.startsWith("#")
      ? `property '${name}' is not accessible outside class '${declaring.name}' because it has a private identifier`
      : `property '${name}' is ${access} and only accessible within class '${declaring.name}'${access === "protected" ? " and its subclasses" : ""}`;
    throw new CompileError(message, at.start, at.end);
  }

  // The class whose own fields include `name`: `t` itself or a base it embeds.
  function declaring(t: ClassType, name: string): ClassType {
    return t.fields.some((f) => f.name === name) || !t.base ? t : declaring(t.base, name);
  }

  function args(list: Expr[], argTypes: Type[], target: Instance, at: Span) {
    const params = paramTypes(target);
    if (list.length !== params.length) {
      throw new CompileError(`expected ${params.length} argument${params.length === 1 ? "" : "s"}, but got ${list.length}`, at.start, at.end);
    }
    list.forEach((a, i) => {
      const [type, expected] = [argTypes[i]!, params[i]!];
      coerce(a, type, expected, `argument of type '${show(type)}' is not assignable to parameter of type '${show(expected)}'`);
    });
  }

  function value(e: Expr): Type {
    const type = typeOf(e);
    types.set(e, type);
    return type;
  }

  function typeOf(e: Expr): Type {
    switch (e.kind) {
      case "int":
        if (e.value > I64_MAX) throw new CompileError("integer literal does not fit in i64", e.start, e.end);
        return "i64";
      case "bool":
        return "boolean";
      case "ident": {
        const local = lookup(e.name);
        if (!local) {
          const message = byName.has(e.name) ? "functions can't be used as values yet"
            : classes.has(e.name) ? "classes can't be used as values yet; construct one with 'new'"
            : enums.has(e.name) ? "an enum can't be used as a value; name one of its members"
            : `cannot find name '${e.name}'`;
          throw new CompileError(message, e.start, e.end);
        }
        if (!reachable(local)) {
          throw new CompileError(`'${e.name}' is declared in another case of this switch, which jumping straight here skips; declare it before the switch`, e.start, e.end);
        }
        locals.set(e, local);
        return narrowed(local) ?? local.type;
      }
      // Its literal type: Fish has no runtime strings yet, but a literal's value is known.
      case "string":
        return literalType(e.value);
      case "member": {
        if (e.optional) throw unsupported("optional chains", e);
        // `Color.Red` names an enum member, whose value is known; the enum's name is no value.
        const named = e.object.kind === "ident" && !lookup(e.object.name) ? enums.get(e.object.name) : undefined;
        if (named) {
          const found = named.members.get(e.name);
          if (!found) throw new CompileError(`property '${e.name}' does not exist on enum '${(e.object as { name: string }).name}'`, e.start, e.end);
          return found;
        }
        const through = value(e.object);
        const object = typeof through !== "string" && through.kind === "ref" ? through.to : through;
        // A field read through a reference loads what it points to; a getter gets the pointer.
        const load = () => object !== through && coercions.set(e.object, object);
        const shared = typeof object !== "string" && object.kind === "union" ? unionField(object, e.name, e) : undefined;
        if (shared) {
          load();
          return shared;
        }
        if (typeof object !== "string" && object.kind === "class") classOf(object);
        const found = typeof object === "string" ? undefined : field(object, e.name);
        const c = typeof object !== "string" && object.kind === "class" ? classOf(object) : undefined;
        const getter = !found && c ? inherited(c, "getters", e.name) : undefined;
        if (getter) {
          visible(getter.access, getter.owner!, e.name, e);
          calls.set(e, instanceOf(getter));
          return returnOf(instanceOf(getter), e);
        }
        if (!found && c && inherited(c, "methods", e.name)) throw new CompileError("methods can't be used as values yet; call it", e.start, e.end);
        if (!found && c && inherited(c, "setters", e.name)) throw new CompileError(`property '${e.name}' has a setter but no getter`, e.start, e.end);
        if (!found) throw new CompileError(`property '${e.name}' does not exist on type '${show(object)}'`, e.start, e.end);
        if (typeof object !== "string" && object.kind === "class") visible(found.access, declaring(object, e.name), e.name, e);
        // Through a type parameter the field has its bound's type, and in an instance the
        // concrete class may give it with a getter.
        const stored = lower(object);
        if (stored !== object && typeof stored !== "string" && stored.kind === "class" && !field(stored, e.name)) {
          const instance = instanceOf(inherited(classOf(stored), "getters", e.name)!);
          returnOf(instance, e);
          calls.set(e, instance);
        }
        if (!calls.has(e)) load();
        return found.type;
      }
      case "object": {
        const list = e.props.map(property);
        const ref = list.findIndex((f) => holdsRef(f.type));
        if (ref >= 0) throw unsupported("references in fields", e.props[ref]!);
        return objectType(fields(list, e.props));
      }
      case "this":
        if (!self) throw new CompileError("'this' can only be used inside a class", e.start, e.end);
        if (!thisReady(e)) throw new CompileError("'this' can't be used until every field is assigned", e.start, e.end);
        return self.type;
      case "new": {
        const list = e.args ?? [];
        const argTypes = list.map(value);
        const c = e.callee.kind === "ident" ? construct(e.callee.name, e.typeArgs, argTypes, e) : undefined;
        if (!c) throw new CompileError("only a class can be constructed with 'new'", e.callee.start, e.callee.end);
        const constructor = instantiate(c.constructor, [], list, argTypes, e);
        args(list, argTypes, constructor, e);
        calls.set(e, constructor);
        return c.type;
      }
      case "call": {
        const { type, what } = call(e);
        if (type === "void") throw new CompileError(`${what} does not return a value`, e.start, e.end);
        return type;
      }
      case "unary": {
        if (e.op !== "-" && e.op !== "!" && e.op !== "~") throw new CompileError(`operator '${e.op}' is not supported yet`, e.start, e.end);
        const type = operand(e.operand);
        if (type !== (e.op === "!" ? "boolean" : "i64")) {
          throw new CompileError(`operator '${e.op}' cannot be applied to type '${show(type)}'`, e.start, e.end);
        }
        return type;
      }
      case "assign": {
        const op = ASSIGNMENTS[e.op];
        if (!op) throw new CompileError(`operator '${e.op}' is not supported yet`, e.start, e.end);
        const target = assignable(e.target, op !== "=");
        const assigned = op === "=" ? value(e.value) : read(e.value);
        const type = op === "=" ? assigned : binaryType(op, target, widen(e.value, assigned), e);
        coerce(e.value, type, target, `type '${show(type)}' is not assignable to type '${show(target)}'`);
        const local = e.target.kind === "ident" ? locals.get(e.target) : undefined;
        if (local && typeof local.type !== "string" && local.type.kind === "ref") rebind(local, e.value);
        return target;
      }
      case "update": {
        const target = assignable(e.operand, true);
        if (target !== "i64") throw new CompileError(`operator '${e.op}' cannot be applied to type '${show(target)}'`, e.start, e.end);
        return "i64";
      }
      case "conditional": {
        condition(e.cond);
        const proven = proves(e.cond);
        let [then, otherwise] = [assume(proven.yes, () => value(e.then)), assume(proven.no, () => value(e.else))];
        if (then === otherwise) return then;
        // Two references lend shared what both point to, or a type both fit; otherwise a side
        // that borrows gives its value.
        const isRef = (t: Type) => typeof t !== "string" && t.kind === "ref";
        if (isRef(then) && isRef(otherwise)) {
          const [a, b] = [(then as RefType).to, (otherwise as RefType).to];
          if ((then as RefType).mutable && (otherwise as RefType).mutable && lower(a) === lower(b)) return then;
          const bound = (t: Type) => (typeof t !== "string" && t.kind === "param" ? t.bound : undefined);
          const common = [a, b, bound(a), bound(b)].find((t) => t && fits(a, t) && fits(b, t));
          if (common) {
            const shared = refType(common, false);
            coerce(e.then, then, shared, "");
            coerce(e.else, otherwise, shared, "");
            return shared;
          }
        }
        if (isRef(then) || isRef(otherwise)) [then, otherwise] = [loaded(e.then, then), loaded(e.else, otherwise)];
        if (then === otherwise) return then;
        return bothSides(e, then, otherwise, coerce);
      }
      case "binary":
        // The migration lint rewrites loose equality to strict, so native code never uses it.
        if (e.op === "==" || e.op === "!=") throw new CompileError(`'${e.op}' is not supported; use '${e.op}='`, e.start, e.end);
        if (e.op === "&&" || e.op === "||") {
          // The right side runs only when the left is true, for `&&`, or false, for `||`.
          const left = operand(e.left);
          const proven = proves(e.left);
          return binaryType(e.op, left, assume(e.op === "&&" ? proven.yes : proven.no, () => operand(e.right)), e);
        }
        if (e.op === "===" || e.op === "!==") {
          const special = typeofComparison(e, unions) ?? unionComparison(e, unions);
          if (special) return special;
        }
        if (e.op === "instanceof") return instanceofCheck(e, unions);
        if (!SUPPORTED_OPERATORS.has(e.op)) throw new CompileError(`operator '${e.op}' is not supported yet`, e.start, e.end);
        return binaryType(e.op, operand(e.left), operand(e.right), e);
      default:
        throw unsupported(EXPRESSION_FORMS[e.kind], e);
    }
  }

  // A value meeting a declared type must fit it. A wider one is copied down to it, except
  // that a fresh object literal may not name extra properties, as in TypeScript.
  function coerce(e: Expr, type: Type, to: Type, message: string) {
    if (type === to || lower(type) === lower(to)) return;
    if (typeof to !== "string" && to.kind === "ref" && (typeof type === "string" || type.kind !== "ref")) {
      borrow(e, type, to, message);
      return;
    }
    // A reference gives its value where one is wanted only by copying it: nothing moves out of
    // a borrow.
    if (typeof type !== "string" && type.kind === "ref" && (typeof to === "string" || to.kind !== "ref")) {
      if (!isCopy(type.to) && fits(type.to, to)) {
        throw new CompileError(`can't move a value out of a reference to it, which only borrows it; use '.clone()' to hand over a copy`, e.start, e.end);
      }
      coercions.set(e, type.to);
      coerce(e, type.to, to, message);
      return;
    }
    if (typeof to !== "string" && to.kind === "union") {
      intoUnion(e, type, to, message, unions);
      return;
    }
    // A literal type takes exactly its value, so only a literal expression of that value fits.
    if (typeof to !== "string" && to.kind === "literal") {
      if (literalValue(e) !== to.value) throw new CompileError(message, e.start, e.end);
      coercions.set(e, to);
      return;
    }
    const shape = !fits(type, to) ? literalShape(e, to, types) : undefined;
    if (shape) {
      shape.apply(coercions);
      type = shape.type;
    }
    if (typeof to !== "string" && to.kind === "interface") {
      const reason = unsatisfied(type, to, members, e);
      if (reason) throw new CompileError(`${message}: ${reason}`, e.start, e.end);
      excess(e, to);
      return;
    }
    if (typeof type !== "string" && type.kind === "class" && typeof to !== "string" && to.kind === "class" && derives(type, to)) {
      throw new CompileError(`'${type.name}' extends '${to.name}' by embedding one, so it can't be used as '${to.name}'; extract an interface both classes implement`, e.start, e.end);
    }
    if (typeof type !== "string" && type.kind === "ref" && typeof to !== "string" && to.kind === "ref" && !fits(type, to)) {
      // A shared reference to something narrower lends a copy of what this one points to.
      if (!to.mutable && fits(type.to, to.to)) {
        coercions.set(e, to);
        return;
      }
      if (!to.mutable) throw new CompileError(message, e.start, e.end);
      const reason = !type.mutable ? "a shared reference can't lend itself as mutable" : `only a reference to exactly '${show(to.to)}' can be lent mutably`;
      throw new CompileError(`${message}: ${reason}`, e.start, e.end);
    }
    if (!fits(type, to) && !builds(e, type, to)) throw new CompileError(message, e.start, e.end);
    // An instance's concrete class may give a field its bound declares with a getter, which
    // copying field by field can't read, so that copy is rejected in the instance.
    if (lower(type) !== type && !fits(lower(type), lower(to))) throw new CompileError(message, e.start, e.end);
    excess(e, to);
    coercions.set(e, to);
  }

  // A value meeting a reference is lent rather than handed over. A place is lent where it
  // lives, so it must be exactly the type borrowed; a temporary is converted first. Lending
  // mutably needs a place that could be assigned.
  function borrow(e: Expr, type: Type, to: RefType, message: string) {
    // A `?:` choosing between places lends whichever it chooses, where it lives.
    if (e.kind === "conditional" && (rooted(e.then) || rooted(e.else))) {
      // A side read as its value before is lent instead.
      coercions.delete(e.then);
      coercions.delete(e.else);
      coerce(e.then, types.get(e.then)!, to, message);
      coerce(e.else, types.get(e.else)!, to, message);
      types.set(e, to);
      return;
    }
    const exact = lower(type) === lower(to.to);
    if (!exact && !fits(type, to.to)) throw new CompileError(message, e.start, e.end);
    // A shared borrow of anything but such a place lends a copy, but a mutable one of anything
    // that isn't a temporary must reach the place.
    if (to.mutable && rooted(e)) {
      if (!place(e) || !inPlace(e, to)) {
        throw new CompileError(`${message}: only a place holding exactly '${show(to.to)}' can be lent mutably`, e.start, e.end);
      }
      changeable(e, "mutably borrow");
    }
    coercions.set(e, to);
  }

  // Whether an expression reaches into a variable or `this`, rather than being a temporary.
  function rooted(e: Expr): boolean {
    while (e.kind === "member" && !calls.has(e)) e = e.object;
    return e.kind === "this" || (e.kind === "ident" && lookup(e.name) !== undefined);
  }

  // Whether lending a place to `to` points to where it lives, rather than to a copy: it holds
  // exactly that type, and isn't a variable narrowed to part of a union.
  function inPlace(e: Expr, to: RefType): boolean {
    const type = types.get(e)!;
    const local = e.kind === "ident" ? locals.get(e) : undefined;
    const held = typeof type !== "string" && type.kind === "ref" ? type.to : type;
    if (local && local.type !== type && typeof held !== "string" && held.kind === "union") return false;
    return typeof type !== "string" && type.kind === "ref" ? fits(type, to) : lower(type) === lower(to.to);
  }

  // Without lifetimes, a reference variable can only be pointed at something that lives as long
  // as it: a place lent where it lives, or another reference variable, declared in its own
  // scope or an enclosing one.
  function rebind(target: Local, e: Expr) {
    const to = target.type as RefType;
    let root = e;
    while (root.kind === "member" && !calls.has(root)) root = root.object;
    const local = root.kind === "ident" ? locals.get(root) : undefined;
    const lives = root.kind === "this" || (local !== undefined && depthOf(local) <= depthOf(target));
    if (!lives || !place(e) || !inPlace(e, to)) {
      throw new CompileError(`'${target.name}' can only be pointed at a variable, or a field of one, declared in its own scope or an enclosing one, so that it lives as long as '${target.name}'`, e.start, e.end);
    }
  }

  // An object literal builds a class it is declared as, without its constructor, when it
  // gives every field and the class has no field hidden from it. Nested literals may build
  // the classes of nested fields.
  function builds(e: Expr, type: Type, to: Type): boolean {
    if (e.kind !== "object" || typeof type === "string" || typeof to === "string" || to.kind !== "class") return false;
    classOf(to);
    for (const f of allFields(to)) {
      if ((f.access ?? "public") !== "public") {
        throw new CompileError(`an object literal can't build '${to.name}' because '${f.name}' is ${f.access}; use 'new'`, e.start, e.end);
      }
      const given = field(type, f.name);
      if (!given) {
        throw new CompileError(`property '${f.name}' is missing in type '${show(type)}' but required in type '${to.name}'`, e.start, e.end);
      }
      const prop = e.props.find((p) => p.kind === "property" && p.key === f.name);
      if (!fits(given.type, f.type) && !(prop?.kind === "property" && builds(prop.value, given.type, f.type))) {
        throw new CompileError(`type '${show(given.type)}' is not assignable to type '${show(f.type)}'`, (prop ?? e).start, (prop ?? e).end);
      }
    }
    return true;
  }

  function excess(e: Expr, to: Type) {
    if (e.kind !== "object" || typeof to === "string") return;
    for (const p of e.props) {
      const name = p.kind === "shorthand" ? p.name : (p as { key: string }).key;
      const found = field(to, name);
      if (!found) {
        throw new CompileError(`object literal may only specify known properties, and '${name}' does not exist in type '${show(to)}'`, p.start, p.end);
      }
      if (p.kind === "property") excess(p.value, found.type);
    }
  }

  // Properties are checked in source order, which is the order they run in.
  function property(p: ObjectProp): Field {
    if (p.kind === "property") {
      if (typeof p.key !== "string") throw unsupported("computed property names", p.key);
      const type = value(p.value);
      const widened = widenEnum(type);
      if (widened !== type) coerce(p.value, type, widened, "");
      return { name: p.key, type: widened };
    }
    if (p.kind !== "shorthand") {
      throw unsupported(p.kind === "spread" ? "spread elements" : p.kind === "method" ? "methods in object literals" : "accessors in object literals", p);
    }
    if (p.default) throw new CompileError("'=' in an object literal is only valid in a destructuring pattern", p.start, p.end);
    // A shorthand reads its variable like a name does: within its switch case, narrowed, and
    // widened from an enum member to the enum like any property.
    const local = lookup(p.name);
    if (!local) throw new CompileError(`cannot find name '${p.name}'`, p.start, p.end);
    if (!reachable(local)) {
      throw new CompileError(`'${p.name}' is declared in another case of this switch, which jumping straight here skips; declare it before the switch`, p.start, p.end);
    }
    locals.set(p, local);
    return { name: p.name, type: widenEnum(narrowed(local) ?? local.type) };
  }

  // The type of what an assignment replaces: a `let` variable, or a field inside one.
  // `const` is deeply immutable, so no field of a constant can change.
  // The type an assignment stores. Through an accessor that is the setter's parameter, and
  // an assignment that also reads, like `+=`, needs the getter too.
  function assignable(target: Expr, reads: boolean): Type {
    const setter = target.kind === "member" ? accessor(target) : undefined;
    intoMember(target, types);
    if (!place(target)) throw new CompileError("can only assign to a variable or a field", target.start, target.end);
    if (!setter || target.kind !== "member") {
      value(target);
      intoMember(target, types);
      changeable(target, "assign to");
      const type = stored(target);
      types.set(target, type);
      return type;
    }
    const type = paramTypes(instanceOf(setter))[0]!;
    if (reads && value(target) !== type) {
      throw new CompileError(`the getter and setter of '${target.name}' must have the same type`, target.start, target.end);
    }
    changeable(target, "assign to");
    setters.set(target, instanceOf(setter));
    types.set(target, type);
    return type;
  }

  // The type a write stores. Read through a type parameter, a field has its bound's type, but
  // in an instance it is stored as the concrete type's field, which may be narrower.
  function stored(target: Expr): Type {
    if (target.kind !== "member") return types.get(target)!;
    const object = lower(stored(target.object));
    if (typeof object !== "string" && object.kind === "union") {
      throw new CompileError(`can't assign to '${target.name}' through '${show(object)}'; narrow it to one member first`, target.start, target.end);
    }
    return (typeof object !== "string" && field(object, target.name)?.type) || types.get(target)!;
  }

  // The setter an assignment to a class member runs, if it is an accessor. A getter alone
  // makes the property read-only.
  function accessor(target: Extract<Expr, { kind: "member" }>): Body | undefined {
    const object = lower(value(target.object));
    if (typeof object === "string" || object.kind !== "class" || field(object, target.name)) return undefined;
    const c = classOf(object);
    const setter = inherited(c, "setters", target.name);
    if (!setter && inherited(c, "getters", target.name)) {
      throw new CompileError(`cannot assign to '${target.name}' because it is a read-only property`, target.start, target.end);
    }
    if (setter) visible(setter.access, setter.owner!, target.name, target);
    return setter;
  }

  // A variable, `this`, or a field inside one: somewhere a value lives, rather than a
  // temporary.
  // A getter's result is a temporary, so a path through one isn't a place.
  function place(e: Expr): boolean {
    while (e.kind === "member" && !e.optional && !calls.has(e)) {
      // An enum's member, and a field every member of a union shares, are values, not places.
      const object = types.get(e.object);
      const held = typeof object !== "string" && object?.kind === "ref" ? object.to : object;
      if (!held || (typeof held !== "string" && held.kind === "union")) return false;
      e = e.object;
    }
    return e.kind === "this" || (e.kind === "ident" && lookup(e.name) !== undefined);
  }

  // Checks that a place, already typed, may change. `const` is deeply immutable, so no field
  // of a constant can change, and `this` changes only in a constructor or a method declared
  // `this: Mut<this>`.
  function changeable(target: Expr, action: string) {
    let root = target;
    let path = "";
    while (root.kind === "member") {
      readonly(root, target, action);
      path = `.${root.name}${path}`;
      root = root.object;
    }
    if (root.kind === "this") {
      if (self?.mutable) return;
      throw new CompileError(`cannot ${action} 'this${path}' because 'this' is read-only here; declare 'this: Mut<this>'`, target.start, target.end);
    }
    const local = locals.get(root)!;
    // A shared reference never changes what it points to; changing through a mutable one
    // comes later.
    if (path && typeof local.type !== "string" && local.type.kind === "ref") {
      if (local.type.mutable) throw unsupported("changes through 'Mut' references", target);
      throw new CompileError(`cannot ${action} '${local.name}${path}' because '${local.name}' is a shared reference ('Ref'), which only reads`, target.start, target.end);
    }
    if (local.param) {
      const what = action === "assign to" ? "assigning to" : action === "mutably borrow" ? "mutably borrowing" : "calling a mutating method on";
      throw new CompileError(`${what} a parameter is not supported yet; copy it into a 'let'`, target.start, target.end);
    }
    if (!local.mutable) {
      const what = path ? `'${local.name}${path}' because '${local.name}'` : `'${local.name}' because it`;
      throw new CompileError(`cannot ${action} ${what} is a constant`, target.start, target.end);
    }
  }

  // A readonly field can't change once constructed, nor can anything inside it. Only its own
  // class's constructor may assign it, through `this`.
  function readonly(e: Extract<Expr, { kind: "member" }>, target: Expr, action: string) {
    const object = types.get(e.object);
    if (typeof object === "string" || !object || !field(object, e.name)?.readonly) return;
    if (e === target && e.object.kind === "this" && self?.constructor && self.type.fields.some((f) => f.name === e.name)) return;
    const what = e === target ? `'${e.name}' because it is` : `'${placeText(target)}' because '${e.name}' is`;
    throw new CompileError(`cannot ${action} ${what} a read-only property`, target.start, target.end);
  }

  // How a place reads in a message, like `p.inner.x`.
  function placeText(e: Expr): string {
    if (e.kind === "member") return `${placeText(e.object)}.${e.name}`;
    return e.kind === "ident" ? e.name : e.kind === "this" ? "this" : "(...)";
  }

  // An operator works on a literal's base type, so `1` adds like any i64.
  function operand(e: Expr): Type {
    return widen(e, read(e));
  }

  // A value that is only read, seen through a reference to it.
  function read(e: Expr): Type {
    return loaded(e, value(e));
  }

  // A checked value of `type`, loaded from where it points when it is a reference.
  function loaded(e: Expr, type: Type): Type {
    if (typeof type === "string" || type.kind !== "ref") return type;
    coercions.set(e, type.to);
    return type.to;
  }

  // An operand of an enum, a union of integer literals, works as an i64 too.
  function widen(e: Expr, type: Type): Type {
    const literals = typeof type !== "string" && type.kind === "union" ? type.members : [type];
    const bases = new Set(literals.map((t) => (typeof t !== "string" && t.kind === "literal" ? baseOf(t) : undefined)));
    const base = bases.size === 1 ? [...bases][0] : undefined;
    if (!base) return type;
    coercions.set(e, base);
    return base;
  }

  // Fish has no truthiness: a condition is a boolean, never a number tested against zero.
  function condition(e: Expr) {
    const type = operand(e);
    if (type !== "boolean") {
      throw new CompileError(`condition must be a boolean, not '${show(type)}'; compare explicitly, e.g. 'n !== 0'`, e.start, e.end);
    }
  }
}
