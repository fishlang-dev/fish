import { CompileError } from "./diag.ts";
import type { Expr, Func as Declared, ObjectProp, Param, Span, Stmt, TypeAlias } from "./parser.ts";
import { ASSIGNMENTS, binaryType, SUPPORTED_OPERATORS } from "./operators.ts";
import { declareClass, type Body, type ClassInfo } from "./classes.ts";
import { addAlias, fields, paramName, resolver, typeName } from "./resolve.ts";
import { field, fits, objectType, show, type ClassType, type Field, type Type } from "./typing.ts";
import { EXPRESSION_FORMS, unsupported, unsupportedDeclaration } from "./unsupported.ts";

export type { Type } from "./typing.ts";
export type { Body } from "./classes.ts";

// A function with a body; overload signatures and `declare function` are rejected first.
type Func = Declared & { body: Stmt[] };

export type Local = { name: string; type: Type; mutable: boolean; param: boolean; id: number };

export type Checked = {
  // Every function to compile: the top-level ones, then each class's constructor.
  funcs: Body[];
  // Every value expression's type.
  types: Map<Expr, Type>;
  // The binding each name use, declaration, parameter and shorthand property refers to,
  // after shadowing.
  locals: Map<Expr | Stmt | Param | ObjectProp, Local>;
  // Each function's return type, written or inferred.
  returns: Map<string, Type>;
  // Each expression whose value meets a narrower declared type, and the type it is copied
  // down to.
  coercions: Map<Expr, Type>;
  // The loop, switch or labeled statement each `break` leaves and each `continue` repeats.
  jumps: Map<Stmt, Stmt>;
};

type Jump = Extract<Stmt, { kind: "break" | "continue" }>;

// What a `break` or `continue` can name: a loop, a switch, or a labeled statement, whose
// `loop` is the loop it labels, if any.
type Target = { stmt: Stmt; kind: "loop" | "switch" | "label"; label?: string; loop?: Stmt };

type Call = Extract<Expr, { kind: "call" }>;

const I64_MAX = (1n << 63n) - 1n;

export function isPrint(callee: Expr): boolean {
  if (callee.kind === "ident") return callee.name === "print";
  return callee.kind === "member" && callee.name === "log" &&
    callee.object.kind === "ident" && callee.object.name === "console";
}

// Resolves every name and gives every value expression a type. Codegen trusts the result.
// A function body is checked when first needed, so return types can be inferred in any order.
export function check(program: Stmt[]): Checked {
  const funcs: Func[] = [];
  const aliases = new Map<string, TypeAlias>();
  const classes = new Map<string, ClassInfo>();
  for (const s of program) {
    if (s.kind === "typeAlias") {
      addAlias(aliases, s, classes);
      continue;
    }
    if (s.kind === "class" && s.name !== undefined) {
      typeName(s.name, s, aliases, classes);
      classes.set(s.name, declareClass({ ...s, name: s.name }));
      continue;
    }
    const declaration = unsupportedDeclaration(s);
    if (declaration) throw declaration;
    if (s.kind === "empty") continue;
    // Top-level code with side effects belongs in main(); the migration lint moves it there.
    if (s.kind === "comptime") throw unsupported("comptime blocks", s);
    if (s.kind !== "function") throw new CompileError("only declarations are allowed at the top level; move this into main()", s.start, s.end);
    if (s.macro) throw unsupported("macros", s);
    if (!hasBody(s)) throw unsupported("functions without a body", s);
    funcs.push(s);
  }
  const byName = new Map<string, Func>();
  for (const f of funcs) {
    if (f.async) throw unsupported("async functions", f);
    if (f.generator) throw unsupported("generator functions", f);
    if (f.typeParams.length > 0) {
      throw unsupported("generic functions", { start: f.typeParams[0]!.start, end: f.typeParams.at(-1)!.end });
    }
    if (byName.has(f.name) || classes.has(f.name)) throw new CompileError(`'${f.name}' is already defined`, f.start, f.end);
    byName.set(f.name, f);
  }
  const main = byName.get("main");
  if (!main) throw new CompileError("no main() function; execution starts there", 0, 0);

  const { resolveType, paramType } = resolver(aliases, new Map([...classes].map(([name, c]) => [name, c.type])));
  const types = new Map<Expr, Type>();
  const locals = new Map<Expr | Stmt | Param | ObjectProp, Local>();
  const returns = new Map<string, Type>();

  const jumps = new Map<Stmt, Stmt>();
  const coercions = new Map<Expr, Type>();
  // The targets some `break` leaves, and the loops some `continue` repeats.
  const broken = new Set<Stmt>();
  const continued = new Set<Stmt>();
  const inProgress = new Set<Body>();
  let nextId = 0;

  const laidOut = new Set<ClassInfo>();
  classes.forEach(layout);
  classes.forEach((c) => {
    if (contains(c.type, c.type, new Set())) {
      throw new CompileError(`class '${c.type.name}' contains itself, so it would have infinite size`, c.constructor.start, c.constructor.end);
    }
  });
  const bodies: Body[] = [...funcs, ...[...classes.values()].map((c) => c.constructor)];
  bodies.forEach(checkBody);
  if (main.params.length > 0) throw new CompileError("main() takes no parameters", main.start, main.end);
  if (returns.get("main") !== "void") throw new CompileError("main() can't return a value yet", main.start, main.end);
  return { funcs: bodies, types, locals, returns, coercions, jumps };

  // Resolves a class's field types. An unannotated field takes its initializer's type, which
  // is checked as the body of a function that returns it, so it may use other classes.
  function layout(c: ClassInfo) {
    if (laidOut.has(c)) return;
    laidOut.add(c);
    c.type.fields = c.fields.map((f) => {
      if (f.type) return { name: f.name, type: resolveType(f.type) };
      const name = `${c.type.name}.${f.name} initializer`;
      checkBody({ name, params: [], body: [{ kind: "return", value: f.init!, start: f.start, end: f.end }], returnType: undefined, start: f.start, end: f.end });
      return { name: f.name, type: returns.get(name)! };
    });
  }

  function contains(t: Type, inner: ClassType, seen: Set<Type>): boolean {
    if (typeof t === "string" || seen.has(t)) return false;
    seen.add(t);
    return t.fields.some((f) => f.type === inner || contains(f.type, inner, seen));
  }

  function classOf(t: ClassType): ClassInfo {
    const c = [...classes.values()].find((c) => c.type === t)!;
    layout(c);
    return c;
  }

  function returnOf(f: Body, at: Span): Type {
    if (f.returnType) return resolveType(f.returnType);
    if (inProgress.has(f)) {
      throw new CompileError(`'${f.name}' needs a return type annotation because it calls itself`, at.start, at.end);
    }
    checkBody(f);
    return returns.get(f.name)!;
  }

  function checkBody(f: Body) {
    if (returns.has(f.name)) return;
    inProgress.add(f);
    const declared = f.returnType && resolveType(f.returnType);
    let inferred: Type | undefined;
    const scopes: Map<string, Local>[] = [new Map()];
    const targets: Target[] = [];

    // A constructor's fields are unset until assigned, so until then `this` may only appear as
    // the target of an assignment to one of them, and the constructor can't return.
    const unset = new Set(f.self?.constructor ? classOf(f.self.type).required : []);
    let exempt: Expr | undefined;

    for (const p of f.params) declare(paramName(p), paramType(p, f.self?.constructor), false, true, p);
    for (const s of f.body) {
      const assigned = unset.size > 0 ? fieldAssignment(s) : undefined;
      exempt = assigned?.object;
      statement(s);
      exempt = undefined;
      if (assigned) unset.delete(assigned.name);
    }
    if (unset.size > 0) {
      const missing = classOf(f.self!.type).fields.find((d) => unset.has(d.name))!;
      throw new CompileError(`property '${missing.name}' has no initializer and is not definitely assigned in the constructor`, missing.start, missing.end);
    }
    const type = declared ?? inferred ?? "void";
    if (type !== "void" && !alwaysReturns(f.body)) {
      const at = f.returnType ?? f;
      throw new CompileError("not all code paths return a value", at.start, at.end);
    }
    returns.set(f.name, type);
    inProgress.delete(f);

    function statement(s: Stmt) {
      const declaration = unsupportedDeclaration(s);
      if (declaration) throw declaration;
      switch (s.kind) {
        case "expr":
          effect(s.expr);
          return;
        case "let": {
          if (s.keyword === "var") throw new CompileError("'var' is not supported; use 'let' or 'const'", s.start, s.start + 3);
          if (s.declarations.length > 1) throw unsupported("declarations of several variables at once", s);
          const d = s.declarations[0]!;
          if (d.target.kind !== "ident") throw unsupported("destructuring patterns", d.target);
          if (!d.init) throw unsupported("declarations without an initializer", d);
          const annotated = d.type && resolveType(d.type);
          const type = value(d.init);
          if (annotated) coerce(d.init, type, annotated, `type '${show(type)}' is not assignable to type '${show(annotated)}'`);
          declare(d.target.name, annotated ?? type, s.keyword === "let", false, s);
          return;
        }
        case "if":
          condition(s.cond);
          scoped(s.then);
          if (s.else) scoped(s.else);
          return;
        case "while":
          condition(s.cond);
          within({ stmt: s, kind: "loop" }, () => scoped(s.body));
          return;
        case "function":
          throw unsupported("nested functions", s);
        case "comptime":
          throw unsupported("comptime blocks", s);
        case "block":
          scoped(s.body);
          return;
        case "debugger":
          throw unsupported("'debugger' statements", s);
        case "empty":
          return;
        case "for":
          // A name declared in the head is scoped to the loop.
          scopes.push(new Map());
          if (s.init) statement(s.init);
          if (s.test) condition(s.test);
          if (s.update) effect(s.update);
          within({ stmt: s, kind: "loop" }, () => scoped(s.body));
          scopes.pop();
          return;
        case "forIn":
          throw unsupported("'for...in' loops", s);
        case "forOf":
          throw unsupported(s.await ? "'for await...of' loops" : "'for...of' loops", s);
        case "doWhile":
          within({ stmt: s, kind: "loop" }, () => scoped(s.body));
          condition(s.cond);
          return;
        case "switch": {
          const type = value(s.discriminant);
          if (typeof type !== "string") throw unsupported("comparisons of objects", s.discriminant);
          const defaults = s.cases.filter((c) => !c.test);
          if (defaults.length > 1) throw new CompileError("a 'switch' can have only one 'default'", defaults[1]!.start, defaults[1]!.end);
          // The case bodies share one scope, as in JavaScript.
          scopes.push(new Map());
          within({ stmt: s, kind: "switch" }, () => {
            for (const c of s.cases) {
              const test = c.test && value(c.test);
              if (test && test !== type) {
                throw new CompileError(`type '${show(test)}' is not comparable to type '${show(type)}'`, c.test!.start, c.test!.end);
              }
              c.body.forEach(statement);
            }
          });
          scopes.pop();
          return;
        }
        case "labeled": {
          if (targets.some((t) => t.label === s.label)) {
            throw new CompileError(`duplicate label '${s.label}'`, s.start, s.start + s.label.length);
          }
          let body = s.body;
          while (body.kind === "labeled") body = body.body;
          const loop = ["while", "doWhile", "for", "forIn", "forOf"].includes(body.kind) ? body : undefined;
          within({ stmt: s, kind: "label", label: s.label, loop }, () => statement(s.body));
          return;
        }
        case "break":
        case "continue": {
          const target = jumpTarget(s);
          jumps.set(s, target);
          (s.kind === "break" ? broken : continued).add(target);
          return;
        }
        case "throw":
          throw unsupported("'throw' statements", s);
        case "try":
          throw unsupported("'try' statements", s);
        case "return": {
          if (unset.size > 0) throw new CompileError("a constructor can't return before every field is assigned", s.start, s.end);
          const type = s.value ? value(s.value) : "void";
          const expected = declared ?? inferred;
          const message = `type '${show(type)}' is not assignable to return type '${show(expected ?? type)}'`;
          if (expected && s.value) coerce(s.value, type, expected, message);
          else if (expected && type !== expected) throw new CompileError(message, s.start, s.end);
          inferred = expected ?? type;
          return;
        }
      }
    }

    // The `this.x` a statement assigns, when it is a plain assignment to a field.
    function fieldAssignment(s: Stmt): Extract<Expr, { kind: "member" }> | undefined {
      if (s.kind !== "expr" || s.expr.kind !== "assign" || s.expr.op !== "=") return undefined;
      const target = s.expr.target;
      return target.kind === "member" && target.object.kind === "this" ? target : undefined;
    }

    function within(target: Target, check: () => void) {
      targets.push(target);
      check();
      targets.pop();
    }

    function jumpTarget(s: Jump): Stmt {
      if (s.label === undefined) {
        const target = targets.findLast((t) => t.kind === "loop" || (s.kind === "break" && t.kind === "switch"));
        if (target) return target.stmt;
        const message = s.kind === "break" ? "'break' can only be used inside a loop or 'switch'" : "'continue' can only be used inside a loop";
        throw new CompileError(message, s.start, s.end);
      }
      const target = targets.findLast((t) => t.label === s.label);
      if (!target) throw new CompileError(`cannot find label '${s.label}'`, s.start, s.end);
      if (s.kind === "break") return target.stmt;
      if (!target.loop) throw new CompileError("'continue' can only jump to a label on a loop", s.start, s.end);
      return target.loop;
    }

    // Only a statement may call a function that returns nothing.
    function effect(e: Expr) {
      if (e.kind === "call") call(e);
      else value(e);
    }

    // Checks a call's arguments; returns the user function it calls, or undefined for print.
    function call(e: Call): Func | undefined {
      const { callee } = e;
      if (e.optional || (callee.kind === "member" && callee.optional)) throw unsupported("optional calls", e);
      if (e.typeArgs.length > 0) throw unsupported("type arguments on calls", e);
      const target = callee.kind === "ident" ? byName.get(callee.name) : undefined;
      if (target) {
        args(e.args, target, e);
        return target;
      }
      if (isPrint(callee)) {
        for (const a of e.args) {
          if (a.kind !== "string" && typeof value(a) !== "string") {
            throw new CompileError("printing an object is not supported yet; print its fields", a.start, a.end);
          }
        }
        return undefined;
      }
      const name = callee.kind === "ident" ? `'${callee.name}'` : "this expression";
      throw new CompileError(`unknown function ${name}`, callee.start, callee.end);
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
          if (!found) throw new CompileError(`property '${e.name}' does not exist on type '${show(object)}'`, e.start, e.end);
          return found.type;
        }
        case "object":
          return objectType(fields(e.props.map(property), e.props));
        case "this":
          if (!f.self) throw new CompileError("'this' can only be used inside a class", e.start, e.end);
          if (unset.size > 0 && e !== exempt) throw new CompileError("'this' can't be used until every field is assigned", e.start, e.end);
          return f.self.type;
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
      let root = target;
      let path = "";
      while (root.kind === "member" && !root.optional) {
        path = `.${root.name}${path}`;
        root = root.object;
      }
      if (root.kind === "this") return value(target);
      if (root.kind !== "ident") throw new CompileError("can only assign to a variable or a field", target.start, target.end);
      const type = value(target);
      const local = locals.get(root)!;
      if (local.param) {
        throw new CompileError("assigning to a parameter is not supported yet; copy it into a 'let'", target.start, target.end);
      }
      if (!local.mutable) {
        const what = path ? `'${local.name}${path}' because '${local.name}'` : `'${local.name}' because it`;
        throw new CompileError(`cannot assign to ${what} is a constant`, target.start, target.end);
      }
      return type;
    }

    // Fish has no truthiness: a condition is a boolean, never a number tested against zero.
    function condition(e: Expr) {
      const type = value(e);
      if (type !== "boolean") {
        throw new CompileError(`condition must be a boolean, not '${show(type)}'; compare explicitly, e.g. 'n !== 0'`, e.start, e.end);
      }
    }

    function scoped(stmts: Stmt[]) {
      scopes.push(new Map());
      stmts.forEach(statement);
      scopes.pop();
    }

    function declare(name: string, type: Type, mutable: boolean, param: boolean, node: Stmt | Param) {
      const scope = scopes[scopes.length - 1]!;
      if (scope.has(name)) throw new CompileError(`cannot redeclare '${name}' in the same scope`, node.start, node.end);
      const local = { name, type, mutable, param, id: nextId++ };
      scope.set(name, local);
      locals.set(node, local);
    }

    function lookup(name: string): Local | undefined {
      for (let i = scopes.length - 1; i >= 0; i--) {
        const local = scopes[i]!.get(name);
        if (local) return local;
      }
      return undefined;
    }
  }

  // Whether control never reaches the end of these statements. A loop whose condition is
  // always true never finishes unless a `break` leaves it.
  function alwaysReturns(stmts: Stmt[]): boolean {
    return stmts.some((s) => {
      switch (s.kind) {
        case "return":
          return true;
        case "if":
          return s.else !== undefined && alwaysReturns(s.then) && alwaysReturns(s.else);
        case "block":
          return alwaysReturns(s.body);
        case "labeled":
          return !broken.has(s) && alwaysReturns([s.body]);
        case "while":
          return isTrue(s.cond) && !broken.has(s);
        case "for":
          return (s.test === undefined || isTrue(s.test)) && !broken.has(s);
        case "doWhile":
          // A `continue` skips the rest of the body to test the condition.
          return !broken.has(s) && (isTrue(s.cond) || (alwaysReturns(s.body) && !continued.has(s)));
        case "switch":
          // Every case falls through to the last body, so it decides, provided some case runs.
          return s.cases.some((c) => !c.test) && !broken.has(s) && alwaysReturns(s.cases.at(-1)!.body);
        default:
          return false;
      }
    });
  }
}

const hasBody = (f: Declared): f is Func => f.body !== undefined;

const isTrue = (e: Expr) => e.kind === "bool" && e.value;
