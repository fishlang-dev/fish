import { checkOverrides, declareClass, extend, type Body, type ClassInfo } from "./classes.ts";
import { CompileError } from "./diag.ts";
import type { ClassNode, Expr, Func as Declared, Interface, ObjectProp, Param, Span, Stmt, TypeAlias } from "./parser.ts";
import { alwaysReturns } from "./flow.ts";
import { genericClasses, instancing } from "./generics.ts";
import { unsatisfied, type Members } from "./interfaces.ts";
import { addAlias, paramName, resolver, storable, typeName } from "./resolve.ts";
import { fits, show, type ClassType, type Type } from "./typing.ts";
import { unsupported, unsupportedDeclaration } from "./unsupported.ts";
import { expressions } from "./values.ts";

export type { Type } from "./typing.ts";
export type { Body } from "./classes.ts";

// A function with a body; overload signatures and `declare function` are rejected first.
type Func = Declared & { body: Stmt[] };

export type Local = { name: string; type: Type; mutable: boolean; param: boolean; id: number };

// Every function to compile: the top-level ones, then each class's constructor and methods.
export type Checked = { instances: Instance[] };

// One compiled function: a body checked with concrete types, and the tables codegen reads
// to lower it. `symbol` names it in the IR.
export type Instance = {
  body: Body;
  symbol: string;
  // What a generic body's type parameters stand for in this instance. An instance holding a
  // type parameter is the definition check, which is never compiled.
  bindings: Map<string, Type>;
  concrete: boolean;
  // How many generic instantiations led to this one, which bounds instantiations that never end.
  depth: number;
  // Its return type, written or inferred.
  returns: Type;
  // Every value expression's type.
  types: Map<Expr, Type>;
  // The binding each name use, declaration, parameter and shorthand property refers to,
  // after shadowing.
  locals: Map<Expr | Stmt | Param | ObjectProp, Local>;
  // The function each call of a user function or method runs, and the getter each read of
  // an accessor runs.
  calls: Map<Expr, Instance>;
  // The setter each assignment to an accessor runs.
  setters: Map<Expr, Instance>;
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

// Resolves every name and gives every value expression a type. Codegen trusts the result.
// A function body is checked when first needed, so return types can be inferred in any order.
export function check(program: Stmt[]): Checked {
  const funcs: Func[] = [];
  const aliases = new Map<string, TypeAlias>();
  const classes = new Map<string, ClassInfo>();
  // Generic classes, declared again for each set of type arguments they are used with.
  const templates = new Map<string, ClassNode & { name: string }>();
  const interfaces = new Map<string, Interface>();
  for (const s of program) {
    if (s.kind === "typeAlias") {
      addAlias(aliases, s, classes, templates, interfaces);
      continue;
    }
    if (s.kind === "interface") {
      typeName(s.name, s, aliases, classes, templates, interfaces);
      interfaces.set(s.name, s);
      continue;
    }
    if (s.kind === "class" && s.name !== undefined) {
      typeName(s.name, s, aliases, classes, templates, interfaces);
      if (s.typeParams.length > 0) templates.set(s.name, { ...s, name: s.name });
      else classes.set(s.name, declareClass({ ...s, name: s.name }));
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
    if (byName.has(f.name) || classes.has(f.name) || templates.has(f.name)) throw new CompileError(`'${f.name}' is already defined`, f.start, f.end);
    byName.set(f.name, f);
  }
  const main = byName.get("main");
  if (!main) throw new CompileError("no main() function; execution starts there", 0, 0);

  // Every class and generic class instance by its type, and those not yet laid out and checked.
  const infoOf = new Map<ClassType, ClassInfo>();
  const unsettled: ClassInfo[] = [];
  classes.forEach(register);
  // The resolver and generic classes need each other, so each reaches the other lazily.
  const { classNamed, construct, start, define } = genericClasses({
    classes, templates, register, layout: (c) => layout(c), members: { classOf: (t) => classOf(t), returnOf: (b, at) => members.returnOf(b, at), paramType: (p) => paramType(p) },
    resolveType: (t) => resolveType(t), withScope: (b, f) => withScope(b, f),
  });
  const { resolveType, paramType, withScope } = resolver(aliases, classNamed, interfaces);
  // The instance being checked, which new instantiations count their depth from.
  let checking: Instance | undefined;
  const done = new Set<Instance>();
  const members: Members = { classOf, returnOf: (b, at) => returnOf(instanceOf(b), at), paramType };
  const { instanceOf, instantiate, paramTypes, definition, pending, all } = instancing({ resolveType, paramType, withScope, members, checking: () => checking });
  // The targets some `break` leaves, and the loops some `continue` repeats.
  const broken = new Set<Stmt>();
  const continued = new Set<Stmt>();
  const inProgress = new Set<Instance>();
  let nextId = 0;

  const linked = new Set<ClassInfo>();
  classes.forEach((c) => link(c, new Set()));
  classes.forEach(checkOverrides);
  const laidOut = new Set<ClassInfo>();
  // Classes are laid out before any body is checked, since checking one may need another's
  // fields. Until the resolver exists, a generic class's instance waits for `start`.
  infoOf.forEach(layout);
  start();
  define();
  funcs.forEach((f) => checkBody(definition(f)));
  while (unsettled.length > 0 || pending.length > 0) {
    if (unsettled.length > 0) settle(unsettled.shift()!);
    else checkBody(pending.shift()!);
  }
  if (main.params.length > 0) throw new CompileError("main() takes no parameters", main.start, main.end);
  if (instanceOf(main).returns !== "void") throw new CompileError("main() can't return a value yet", main.start, main.end);
  const compiled = new Set([...funcs, ...[...infoOf.values()].flatMap(bodiesOf)]);
  return { instances: all().filter((i) => i.concrete && compiled.has(i.body)) };

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
      return { name: f.name, type: instance.returns, access: f.access };
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
    const parts = [...t.fields.map((f) => f.type), ...(t.kind === "class" && t.base ? [t.base] : [])];
    return parts.some((p) => p === inner || contains(p, inner, seen));
  }

  function classOf(t: ClassType): ClassInfo {
    const c = infoOf.get(t)!;
    layout(c);
    return c;
  }

  function returnOf(instance: Instance, at: Span): Type {
    const f = instance.body;
    const declared = f.returnType && withScope(instance.bindings, () => resolveType(f.returnType!));
    if (declared && !isInterface(declared)) return declared;
    if (inProgress.has(instance)) {
      throw new CompileError(`'${f.name}' needs a return type annotation because it calls itself`, at.start, at.end);
    }
    checkBody(instance);
    return instance.returns;
  }

  // Checks an instance with its type arguments in scope.
  function checkBody(instance: Instance) {
    if (done.has(instance)) return;
    const outer = checking;
    checking = instance;
    try {
      withScope(instance.bindings, () => checkInstance(instance));
    } finally {
      checking = outer;
    }
  }

  function checkInstance(instance: Instance) {
    const f = instance.body;
    inProgress.add(instance);
    const { types, locals, coercions, calls, setters, jumps } = instance;
    let declared = f.returnType && resolveType(f.returnType);
    // A function returning an interface returns its one concrete type, which must satisfy it.
    const trait = declared && typeof declared !== "string" && declared.kind === "interface" ? declared : undefined;
    if (trait) declared = undefined;
    let inferred: Type | undefined;
    const scopes: Map<string, Local>[] = [new Map()];
    const targets: Target[] = [];

    // A constructor's fields are unset until assigned, so until then `this` may only appear as
    // the target of an assignment to one of them, and the constructor can't return.
    const unset = new Set(f.self?.constructor ? classOf(f.self.type).required : []);
    let exempt: Expr | undefined;
    // A derived constructor's first statement, `super(...)`, fills the embedded base.
    const superCall = f.self?.constructor && f.self.type.base ? (f.body[0] as Extract<Stmt, { kind: "expr" }>).expr : undefined;
    if (superCall) unset.add(SUPER);

    const { value, condition, effect, coerce } = expressions({
      types, locals, coercions, calls, setters, byName, classes, construct, members, returnOf, classOf, instanceOf, instantiate, paramTypes, lookup,
      self: f.self,
      owner: f.owner,
      superCall,
      thisReady: (e) => unset.size === 0 || e === exempt,
    });

    const params = paramTypes(instance);
    f.params.forEach((p, i) => declare(paramName(p), params[i]!, false, true, p));
    // A field initializer runs before the constructor's body, out of reach of its parameters.
    let hidden = false;
    for (const s of f.body) {
      const assigned = unset.size > 0 ? fieldAssignment(s) : undefined;
      exempt = assigned?.object;
      hidden = f.self?.constructor === true && classOf(f.self.type).initializers.has(s);
      statement(s);
      exempt = undefined;
      hidden = false;
      if (assigned) unset.delete(assigned.name);
      if (s.kind === "expr" && s.expr === superCall) unset.delete(SUPER);
    }
    if (unset.size > 0) {
      const missing = classOf(f.self!.type).fields.find((d) => unset.has(d.name))!;
      throw new CompileError(`property '${missing.name}' has no initializer and is not definitely assigned in the constructor`, missing.start, missing.end);
    }
    const type = declared ?? inferred ?? "void";
    if (type !== "void" && !alwaysReturns(f.body, broken, continued)) {
      const at = f.returnType ?? f;
      throw new CompileError("not all code paths return a value", at.start, at.end);
    }
    instance.returns = type;
    done.add(instance);
    inProgress.delete(instance);

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
          // An interface describes the value, which keeps its own concrete type.
          declare(d.target.name, annotated && !isInterface(annotated) ? annotated : type, s.keyword === "let", false, s);
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
          if (f.self?.constructor && s.value) throw new CompileError("a constructor can't return a value", s.start, s.end);
          if (unset.size > 0) throw new CompileError("a constructor can't return before every field is assigned", s.start, s.end);
          const type = s.value ? value(s.value) : "void";
          const expected = declared ?? inferred;
          const message = `type '${show(type)}' is not assignable to return type '${show(expected ?? type)}'`;
          if (expected && s.value) coerce(s.value, type, expected, message);
          else if (expected && type !== expected) throw new CompileError(message, s.start, s.end);
          const reason = trait && unsatisfied(type, trait, members, s.value ?? s);
          if (reason) throw new CompileError(`type '${show(type)}' is not assignable to return type '${trait!.name}': ${reason}`, (s.value ?? s).start, (s.value ?? s).end);
          inferred = expected ?? type;
          return;
        }
      }
    }

    // The `this.x` a statement assigns, when it is a plain assignment to one of the class's
    // own fields. A setter is a method, which can't run until every field is set.
    function fieldAssignment(s: Stmt): Extract<Expr, { kind: "member" }> | undefined {
      if (s.kind !== "expr" || s.expr.kind !== "assign" || s.expr.op !== "=") return undefined;
      const target = s.expr.target;
      if (target.kind !== "member" || target.object.kind !== "this") return undefined;
      return classOf(f.self!.type).fields.some((d) => d.name === target.name) ? target : undefined;
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
      for (let i = scopes.length - 1; i >= (hidden ? 1 : 0); i--) {
        const local = scopes[i]!.get(name);
        if (local) return local;
      }
      return undefined;
    }
  }

}

// Stands for the base in a derived constructor's unset fields until `super(...)` runs.
const SUPER = "super()";

const isInterface = (t: Type) => typeof t !== "string" && t.kind === "interface";

const hasBody = (f: Declared): f is Func => f.body !== undefined;

