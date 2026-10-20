import type { Body, ClassInfo } from "./classes.ts";
import { CompileError } from "./diag.ts";
import { ASSIGNMENTS, binaryType, SUPPORTED_OPERATORS } from "./operators.ts";
import type { Expr, ObjectProp, Param, Span, Stmt } from "./parser.ts";
import { fields } from "./resolve.ts";
import { field, fits, objectType, show, type Access, type ClassType, type Field, type Type } from "./typing.ts";
import { EXPRESSION_FORMS, unsupported } from "./unsupported.ts";
import type { Local } from "./check.ts";

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
  calls: Map<Expr, Body>;
  byName: Map<string, Body>;
  classes: Map<string, ClassInfo>;
  returnOf(f: Body, at: Span): Type;
  classOf(t: ClassType): ClassInfo;
  paramType(p: Param, property?: boolean): Type;
  lookup(name: string): Local | undefined;
  self: Body["self"];
  // The class whose constructor or method this is, which may reach its non-public members.
  owner: ClassType | undefined;
  // Whether this `this` may be used: a constructor's can't until every field is assigned.
  thisReady(e: Expr): boolean;
};

export function expressions(ctx: Context) {
  const { types, locals, coercions, calls, byName, classes, returnOf, classOf, paramType, lookup, self, owner, thisReady } = ctx;
  return { value, condition, effect, coerce };

  // Only a statement may call a function that returns nothing.
  function effect(e: Expr) {
    if (e.kind === "call") call(e);
    else value(e);
  }

  // Checks a call's arguments; returns the user function it calls, or undefined for print.
  function call(e: Call): Body | undefined {
    const { callee } = e;
    if (e.optional || (callee.kind === "member" && callee.optional)) throw unsupported("optional calls", e);
    if (e.typeArgs.length > 0) throw unsupported("type arguments on calls", e);
    if (isPrint(callee)) {
      for (const a of e.args) {
        if (a.kind !== "string" && typeof value(a) !== "string") {
          throw new CompileError("printing an object is not supported yet; print its fields", a.start, a.end);
        }
      }
      return undefined;
    }
    const target = callee.kind === "ident" ? byName.get(callee.name) : callee.kind === "member" ? method(callee) : undefined;
    if (target) {
      args(e.args, target, e);
      calls.set(e, target);
      return target;
    }
    const name = callee.kind === "ident" ? `'${callee.name}'` : "this expression";
    throw new CompileError(`unknown function ${name}`, callee.start, callee.end);
  }

  // The method a member call names: a static one on a class name, or an instance one, whose
  // receiver must be able to change when the method changes it.
  function method(callee: Extract<Expr, { kind: "member" }>): Body {
    const { object, name } = callee;
    const named = object.kind === "ident" && !lookup(object.name) ? classes.get(object.name) : undefined;
    if (named) {
      const found = named.statics.get(name);
      if (!found) throw new CompileError(`property '${name}' does not exist on type 'typeof ${named.type.name}'`, callee.start, callee.end);
      visible(found.access, named.type, name, callee);
      return found;
    }
    const type = value(object);
    const found = typeof type !== "string" && type.kind === "class" ? classOf(type).methods.get(name) : undefined;
    if (!found) throw new CompileError(`'${show(type)}' has no method '${name}'`, callee.start, callee.end);
    visible(found.access, found.owner!, name, callee);
    if (found.self!.mutable && place(object)) changeable(object, `call '${name}' on`);
    return found;
  }

  // TypeScript's access rules: a private or protected member is reachable only from inside
  // its own class.
  function visible(access: Access | undefined, declaring: ClassType, name: string, at: Span) {
    if (!access || access === "public" || owner === declaring) return;
    const message = name.startsWith("#")
      ? `property '${name}' is not accessible outside class '${declaring.name}' because it has a private identifier`
      : `property '${name}' is ${access} and only accessible within class '${declaring.name}'${access === "protected" ? " and its subclasses" : ""}`;
    throw new CompileError(message, at.start, at.end);
  }

  function args(list: Expr[], target: Body, at: Span) {
    const expected = target.params.length;
    if (list.length !== expected) {
      throw new CompileError(`expected ${expected} argument${expected === 1 ? "" : "s"}, but got ${list.length}`, at.start, at.end);
    }
    list.forEach((a, i) => {
      const type = value(a);
      const expected = paramType(target.params[i]!, target.self?.constructor);
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
        if (!found && typeof object !== "string" && object.kind === "class" && classOf(object).methods.has(e.name)) {
          throw new CompileError("methods can't be used as values yet; call it", e.start, e.end);
        }
        if (!found) throw new CompileError(`property '${e.name}' does not exist on type '${show(object)}'`, e.start, e.end);
        if (typeof object !== "string" && object.kind === "class") visible(found.access, object, e.name, e);
        return found.type;
      }
      case "object":
        return objectType(fields(e.props.map(property), e.props));
      case "this":
        if (!self) throw new CompileError("'this' can only be used inside a class", e.start, e.end);
        if (!thisReady(e)) throw new CompileError("'this' can't be used until every field is assigned", e.start, e.end);
        return self.type;
      case "new": {
        const c = e.callee.kind === "ident" ? classes.get(e.callee.name) : undefined;
        if (!c) throw new CompileError("only a class can be constructed with 'new'", e.callee.start, e.callee.end);
        if (e.typeArgs.length > 0) throw unsupported("type arguments on 'new'", e);
        args(e.args ?? [], c.constructor, e);
        return c.type;
      }
      case "call": {
        const target = call(e);
        const type = target ? returnOf(target, e) : "void";
        if (type === "void") {
          const what = target ? `'${target.name}'` : "printing";
          throw new CompileError(`${what} does not return a value`, e.start, e.end);
        }
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
        const target = assignable(e.target);
        const assigned = value(e.value);
        const type = op === "=" ? assigned : binaryType(op, target, assigned, e);
        coerce(e.value, type, target, `type '${show(type)}' is not assignable to type '${show(target)}'`);
        return target;
      }
      case "update": {
        const target = assignable(e.operand);
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
    if (!fits(type, to)) throw new CompileError(message, e.start, e.end);
    excess(e, to);
    coercions.set(e, to);
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
  function assignable(target: Expr): Type {
    if (!place(target)) throw new CompileError("can only assign to a variable or a field", target.start, target.end);
    const type = value(target);
    changeable(target, "assign to");
    return type;
  }

  // A variable, `this`, or a field inside one: somewhere a value lives, rather than a
  // temporary.
  function place(e: Expr): boolean {
    while (e.kind === "member" && !e.optional) e = e.object;
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
