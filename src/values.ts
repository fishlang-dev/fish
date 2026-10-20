import { inherited, type Body, type ClassInfo } from "./classes.ts";
import { unsatisfied, type Members } from "./interfaces.ts";
import { CompileError } from "./diag.ts";
import { ASSIGNMENTS, binaryType, SUPPORTED_OPERATORS } from "./operators.ts";
import type { Expr, ObjectProp, Param, Span, Stmt, TypeNode } from "./parser.ts";
import { fields } from "./resolve.ts";
import { allFields, derives, field, fits, objectType, show, type Access, type ClassType, type Field, type Type } from "./typing.ts";
import { EXPRESSION_FORMS, unsupported } from "./unsupported.ts";
import type { Instance, Local } from "./check.ts";

// Expression checking inside one function body: every value gets a type, every name its
// binding, and every value meeting a narrower declared type its coercion.

type Call = Extract<Expr, { kind: "call" }>;

const I64_MAX = (1n << 63n) - 1n;

export function isPrint(callee: Expr): boolean {
  if (callee.kind === "ident") return callee.name === "print";
  return callee.kind === "member" && callee.name === "log" &&
    callee.object.kind === "ident" && callee.object.name === "console";
}

// What expression checking needs from the program and the function it is in.
export type Context = {
  types: Map<Expr, Type>;
  locals: Map<Expr | Stmt | Param | ObjectProp, Local>;
  coercions: Map<Expr, Type>;
  calls: Map<Expr, Instance>;
  setters: Map<Expr, Instance>;
  byName: Map<string, Body>;
  classes: Map<string, ClassInfo>;
  construct(name: string, typeArgs: TypeNode[], argTypes: Type[], at: Span): ClassInfo | undefined;
  members: Members;
  returnOf(instance: Instance, at: Span): Type;
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
};

export function expressions(ctx: Context) {
  const { types, locals, coercions, calls, setters, byName, classes, construct, members, returnOf, classOf, instanceOf, instantiate, paramTypes, lookup } = ctx;
  const { self, owner, superCall, thisReady } = ctx;
  return { value, condition, effect, coerce };

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
        const type = a.kind === "string" ? "void" : value(a);
        if (typeof type === "string") continue;
        throw new CompileError(type.kind === "param" ? `a value of type '${type.name}' can't be printed`
          : "printing an object is not supported yet; print its fields", a.start, a.end);
      }
      return { type: "void", what: "printing" };
    }
    if (callee.kind === "member" && onParameter(callee)) return traitCall(e, callee);
    const target = callee.kind === "ident" ? byName.get(callee.name) : callee.kind === "member" ? method(callee) : undefined;
    if (!target) {
      const name = callee.kind === "ident" ? `'${callee.name}'` : "this expression";
      throw new CompileError(`unknown function ${name}`, callee.start, callee.end);
    }
    const argTypes = e.args.map(value);
    const instance = instantiate(target, e.typeArgs, e.args, argTypes, e);
    args(e.args, argTypes, instance, e);
    calls.set(e, instance);
    return { type: returnOf(instance, e), what: `'${target.name}'` };
  }

  // Whether a member call's receiver is a value of a type parameter.
  function onParameter(callee: Extract<Expr, { kind: "member" }>): boolean {
    const { object } = callee;
    if (object.kind === "super" || (object.kind === "ident" && !lookup(object.name) && classes.has(object.name))) return false;
    const type = value(object);
    return typeof type !== "string" && type.kind === "param";
  }

  // A method of a type parameter's bound, called while checking a generic body at its
  // definition. Each instance resolves the call to its concrete type's method.
  function traitCall(e: Call, callee: Extract<Expr, { kind: "member" }>): { type: Type; what: string } {
    const param = types.get(callee.object) as Extract<Type, { kind: "param" }>;
    const found = param.bound?.kind === "interface" ? param.bound.methods.find((m) => m.name === callee.name) : undefined;
    if (!found) throw new CompileError(`property '${callee.name}' does not exist on type '${param.name}'`, callee.start, callee.end);
    if (e.typeArgs.length > 0) throw new CompileError("expected 0 type arguments", e.start, e.end);
    if (e.args.length !== found.params.length) {
      throw new CompileError(`expected ${found.params.length} argument${found.params.length === 1 ? "" : "s"}, but got ${e.args.length}`, e.start, e.end);
    }
    e.args.forEach((a, i) => {
      const type = value(a);
      coerce(a, type, found.params[i]!, `argument of type '${show(type)}' is not assignable to parameter of type '${show(found.params[i]!)}'`);
    });
    return { type: found.returns, what: `'${callee.name}'` };
  }

  // The method a member call names: a static one on a class name, or an instance one, whose
  // receiver must be able to change when the method changes it.
  function method(callee: Extract<Expr, { kind: "member" }>): Body {
    const { object, name } = callee;
    const named = object.kind === "ident" && !lookup(object.name) ? classes.get(object.name) : undefined;
    if (named) {
      const found = inherited(named, "statics", name);
      if (!found) throw new CompileError(`property '${name}' does not exist on type 'typeof ${named.type.name}'`, callee.start, callee.end);
      visible(found.access, found.owner!, name, callee);
      return found;
    }
    if (object.kind === "super") return superMethod(callee);
    const type = value(object);
    const found = typeof type !== "string" && type.kind === "class" ? inherited(classOf(type), "methods", name) : undefined;
    if (!found) throw new CompileError(`'${show(type)}' has no method '${name}'`, callee.start, callee.end);
    visible(found.access, found.owner!, name, callee);
    if (found.self!.mutable && place(object)) changeable(object, `call '${name}' on`);
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
            : `cannot find name '${e.name}'`;
          throw new CompileError(message, e.start, e.end);
        }
        locals.set(e, local);
        return local.type;
      }
      case "string":
        throw new CompileError("strings can only be passed straight to print for now", e.start, e.end);
      case "member": {
        if (e.optional) throw unsupported("optional chains", e);
        const object = value(e.object);
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
        return found.type;
      }
      case "object":
        return objectType(fields(e.props.map(property), e.props));
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
        const type = value(e.operand);
        if (type !== (e.op === "!" ? "boolean" : "i64")) {
          throw new CompileError(`operator '${e.op}' cannot be applied to type '${show(type)}'`, e.start, e.end);
        }
        return type;
      }
      case "assign": {
        const op = ASSIGNMENTS[e.op];
        if (!op) throw new CompileError(`operator '${e.op}' is not supported yet`, e.start, e.end);
        const target = assignable(e.target, op !== "=");
        const assigned = value(e.value);
        const type = op === "=" ? assigned : binaryType(op, target, assigned, e);
        coerce(e.value, type, target, `type '${show(type)}' is not assignable to type '${show(target)}'`);
        return target;
      }
      case "update": {
        const target = assignable(e.operand, true);
        if (target !== "i64") throw new CompileError(`operator '${e.op}' cannot be applied to type '${show(target)}'`, e.start, e.end);
        return "i64";
      }
      case "conditional": {
        condition(e.cond);
        const [then, otherwise] = [value(e.then), value(e.else)];
        if (then !== otherwise) {
          throw new CompileError(`both sides of '?:' must have the same type, not '${show(then)}' and '${show(otherwise)}'`, e.start, e.end);
        }
        return then;
      }
      case "binary":
        // The migration lint rewrites loose equality to strict, so native code never uses it.
        if (e.op === "==" || e.op === "!=") throw new CompileError(`'${e.op}' is not supported; use '${e.op}='`, e.start, e.end);
        if (!SUPPORTED_OPERATORS.has(e.op)) throw new CompileError(`operator '${e.op}' is not supported yet`, e.start, e.end);
        return binaryType(e.op, value(e.left), value(e.right), e);
      default:
        throw unsupported(EXPRESSION_FORMS[e.kind], e);
    }
  }

  // A value meeting a declared type must fit it. A wider one is copied down to it, except
  // that a fresh object literal may not name extra properties, as in TypeScript.
  function coerce(e: Expr, type: Type, to: Type, message: string) {
    if (type === to) return;
    if (typeof to !== "string" && to.kind === "interface") {
      const reason = unsatisfied(type, to, members, e);
      if (reason) throw new CompileError(`${message}: ${reason}`, e.start, e.end);
      excess(e, to);
      return;
    }
    if (typeof type !== "string" && type.kind === "class" && typeof to !== "string" && to.kind === "class" && derives(type, to)) {
      throw new CompileError(`'${type.name}' extends '${to.name}' by embedding one, so it can't be used as '${to.name}'; extract an interface both classes implement`, e.start, e.end);
    }
    if (!fits(type, to) && !builds(e, type, to)) throw new CompileError(message, e.start, e.end);
    excess(e, to);
    coercions.set(e, to);
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
      return { name: p.key, type: value(p.value) };
    }
    if (p.kind !== "shorthand") {
      throw unsupported(p.kind === "spread" ? "spread elements" : p.kind === "method" ? "methods in object literals" : "accessors in object literals", p);
    }
    if (p.default) throw new CompileError("'=' in an object literal is only valid in a destructuring pattern", p.start, p.end);
    const local = lookup(p.name);
    if (!local) throw new CompileError(`cannot find name '${p.name}'`, p.start, p.end);
    locals.set(p, local);
    return { name: p.name, type: local.type };
  }

  // The type of what an assignment replaces: a `let` variable, or a field inside one.
  // `const` is deeply immutable, so no field of a constant can change.
  // The type an assignment stores. Through an accessor that is the setter's parameter, and
  // an assignment that also reads, like `+=`, needs the getter too.
  function assignable(target: Expr, reads: boolean): Type {
    const setter = target.kind === "member" ? accessor(target) : undefined;
    if (!place(target)) throw new CompileError("can only assign to a variable or a field", target.start, target.end);
    if (!setter || target.kind !== "member") {
      const type = value(target);
      changeable(target, "assign to");
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

  // The setter an assignment to a class member runs, if it is an accessor. A getter alone
  // makes the property read-only.
  function accessor(target: Extract<Expr, { kind: "member" }>): Body | undefined {
    const object = value(target.object);
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
    while (e.kind === "member" && !e.optional && !calls.has(e)) e = e.object;
    return e.kind === "ident" || e.kind === "this";
  }

  // Checks that a place, already typed, may change. `const` is deeply immutable, so no field
  // of a constant can change, and `this` changes only in a constructor or a method declared
  // `this: Mut<this>`.
  function changeable(target: Expr, action: string) {
    let root = target;
    let path = "";
    while (root.kind === "member") {
      path = `.${root.name}${path}`;
      root = root.object;
    }
    if (root.kind === "this") {
      if (self?.mutable) return;
      throw new CompileError(`cannot ${action} 'this${path}' because 'this' is read-only here; declare 'this: Mut<this>'`, target.start, target.end);
    }
    const local = locals.get(root)!;
    if (local.param) {
      const what = action === "assign to" ? "assigning to" : "calling a mutating method on";
      throw new CompileError(`${what} a parameter is not supported yet; copy it into a 'let'`, target.start, target.end);
    }
    if (!local.mutable) {
      const what = path ? `'${local.name}${path}' because '${local.name}'` : `'${local.name}' because it`;
      throw new CompileError(`cannot ${action} ${what} is a constant`, target.start, target.end);
    }
  }

  // Fish has no truthiness: a condition is a boolean, never a number tested against zero.
  function condition(e: Expr) {
    const type = value(e);
    if (type !== "boolean") {
      throw new CompileError(`condition must be a boolean, not '${show(type)}'; compare explicitly, e.g. 'n !== 0'`, e.start, e.end);
    }
  }
}
