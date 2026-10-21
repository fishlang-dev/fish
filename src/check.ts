import { checkOverrides, declareClass, extend, isLifetime, type Body, type ClassInfo } from "./classes.ts";
import { CompileError } from "./diag.ts";
import type { ClassNode, Expr, Func as Declared, Interface, ObjectProp, Param, Span, Stmt, TypeAlias, TypeNode } from "./parser.ts";

type Arrow = Extract<Expr, { kind: "arrow" }>;
import { alwaysReturns, assignedNames } from "./flow.ts";
import { declareEnum, type EnumInfo } from "./enums.ts";
import { either, guard, type Facts } from "./narrow.ts";
import { comparable, objectsMeet } from "./unions.ts";
import { genericClasses, instancing } from "./generics.ts";
import { unsatisfied, type Members } from "./interfaces.ts";
import { registry } from "./registry.ts";
import { addAlias, paramName, resolver, typeName } from "./resolve.ts";
import { closureType, holdsRef, isNumeric, lower, refType, lowersClasses, replaced, show, widenEnum, type ClassType, type ClosureType, type FunctionType, type RefType, type Type } from "./typing.ts";
import { unsupported, unsupportedDeclaration } from "./unsupported.ts";
import { checkMoves } from "./moves.ts";
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
  // The arguments, or the receiver, each call returning a reference borrows from.
  borrowsFrom: Map<Expr, Expr[]>;
  // For a closure: the binding standing in its body for each variable it captures, and that
  // variable, or `this`, in the body it is written in, in the order its environment holds them;
  // and where it, or a closure inside it, first uses each.
  captures?: Map<Local, Local | "this">;
  captureUses?: Map<Local, Expr | ObjectProp>;
  // The captures it changes, which it captures mutably, and those it moves out of itself.
  changed?: Set<Local>;
  moved?: Set<Local>;
  // A closure's own type.
  closure?: ClosureType;
};

// What a closure's body sees of the body it is written in, as it is where the closure is made.
type Outer = {
  lookup(name: string, at?: Expr | ObjectProp): Local | undefined;
  narrowed(l: Local): Type | undefined;
  thisReady(e: Expr): boolean;
  noteThis(e: Expr): void;
  changesLocal(l: Local, path: string, action: string, target: Expr, throughMut: boolean): void;
  changesThis(path: string, action: string, target: Expr): void;
};

type Jump = Extract<Stmt, { kind: "break" | "continue" }>;

// What a `break` or `continue` can name: a loop, a switch, or a labeled statement, whose
// `loop` is the loop it labels, if any.
type Target = { stmt: Stmt; kind: "loop" | "switch" | "label"; label?: string; loop?: Stmt; facts?: number };

// Resolves every name and gives every value expression a type. Codegen trusts the result.
// A function body is checked when first needed, so return types can be inferred in any order.
export function check(program: Stmt[]): Checked {
  const funcs: Func[] = [];
  const aliases = new Map<string, TypeAlias>();
  const classes = new Map<string, ClassInfo>();
  // Generic classes, declared again for each set of type arguments they are used with.
  const templates = new Map<string, ClassNode & { name: string }>();
  const interfaces = new Map<string, Interface>();
  const enums = new Map<string, EnumInfo>();
  // For each class declaring lifetimes, which of its type parameters are lifetimes.
  const slots = new Map<string, boolean[]>();
  for (const s of program) {
    if (s.kind === "enum") {
      typeName(s.name, s, aliases, classes, templates, interfaces, enums);
      enums.set(s.name, declareEnum(s));
      continue;
    }
    if (s.kind === "typeAlias") {
      addAlias(aliases, s, classes, templates, interfaces, enums);
      continue;
    }
    if (s.kind === "interface") {
      typeName(s.name, s, aliases, classes, templates, interfaces, enums);
      interfaces.set(s.name, s);
      continue;
    }
    if (s.kind === "class" && s.name !== undefined) {
      typeName(s.name, s, aliases, classes, templates, interfaces, enums);
      // A class's lifetimes are checked and erased, never instanced, so they are set aside.
      const node = { ...s, name: s.name, typeParams: s.typeParams.filter((p) => !isLifetime(p)) };
      if (s.typeParams.some(isLifetime)) slots.set(s.name, s.typeParams.map(isLifetime));
      if (node.typeParams.length > 0) templates.set(s.name, node);
      else classes.set(s.name, declareClass(node));
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
    if (byName.has(f.name) || classes.has(f.name) || templates.has(f.name) || enums.has(f.name)) throw new CompileError(`'${f.name}' is already defined`, f.start, f.end);
    byName.set(f.name, f);
  }
  const main = byName.get("main");
  if (!main) throw new CompileError("no main() function; execution starts there", 0, 0);

  // A class's members, for interface satisfaction. Like the resolver and generic classes,
  // which need each other, it reaches what is set up below lazily.
  const members: Members = {
    classOf: (t) => classOf(t),
    returnOf: (b, at) => returnOf(definition(b), at),
    paramTypesOf: (b) => declaredParams(b),
  };
  const { register, settle, link, layout, classOf, bodiesOf, infoOf, unsettled } = registry({
    classes, members, resolveType: (t) => resolveType(t), withScope: (b, f) => withScope(b, f),
    instanceOf: (f) => instanceOf(f), definition: (f) => definition(f), checkBody: (i) => checkBody(i),
  });
  classes.forEach(register);
  const { classNamed, construct, start, define } = genericClasses({
    classes, templates, register, layout, members, resolveType: (t) => resolveType(t), withScope: (b, f) => withScope(b, f),
  });
  const { resolveType, paramType, withScope } = resolver(aliases, classNamed, interfaces, enums, slots);
  // A class first made while lowering is reported at the function being checked.
  lowersClasses((c, args) => classNamed(c.generic!.name, args, checking?.body ?? { start: 0, end: 0 })!);
  // The instance being checked, which new instantiations count their depth from.
  let checking: Instance | undefined;
  const done = new Set<Instance>();
  // Each concrete instance's return type as its own body saw it, before lowering.
  const views = new Map<Instance, Type>();
  const { instanceOf, instantiate, paramTypes, scopeOf, declaredParams, implicitOf, definition, pending, all, siteOf, returnTypeOf } = instancing({
    resolveType, paramType, withScope, members, checking: () => checking,
    classParams: (f) => (f.scope?.size && f.owner ? classOf(f.owner).node.typeParams : []),
  });
  // The targets some `break` leaves, and the loops some `continue` repeats.
  const broken = new Set<Stmt>();
  const continued = new Set<Stmt>();
  const inProgress = new Set<Instance>();
  let nextId = 0;
  // Every closure's instance, and the instance each closure type calls.
  const closures: Instance[] = [];
  const closureBodies = new Map<ClosureType, Instance>();

  classes.forEach((c) => link(c, new Set()));
  classes.forEach(checkOverrides);
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
  return { instances: [...all().filter((i) => i.concrete && compiled.has(i.body)), ...closures.filter((i) => i.concrete)] };

  // What a function's returned reference borrows from: the parameters with its written
  // lifetime, or by elision `this` for a method, or the only reference parameter.
  function originsOf(f: Body, params: Type[], returns: RefType): Origin[] {
    const at = f.returnType ?? f;
    if (returns.life) {
      const found: Origin[] = f.params.flatMap((p, i) => (named(p.type).has(returns.life!) ? [i] : []));
      // A lifetime of the method's own class is the object's.
      if (f.owner && classLifetimes(f).has(returns.life)) found.push("this");
      if (found.length === 0) throw new CompileError(`no parameter is borrowed for lifetime '${returns.life}'; write 'Ref<T, ${returns.life}>' on the parameter the result points into`, at.start, at.end);
      return found;
    }
    if (f.self && !f.self.constructor && !f.self.owned) return ["this"];
    const refs = params.flatMap((p, i) => (holdsRef(p) ? [i] : []));
    if (refs.length === 1) return refs;
    throw new CompileError(refs.length === 0
      ? "this function returns a reference but borrows nothing it could point into; return an owned value instead"
      : "this function returns a reference and takes several, so say which it points into: declare '<A extends Lifetime>' and write 'Ref<T, A>' on that parameter and the return type", at.start, at.end);
  }

  // What a value holding references a body returns may point into: the parameters whose
  // annotations name a lifetime its type names, or, naming none, whatever was lent.
  function heldOrigins(f: Body): Origin[] | undefined {
    const names = named(f.returnType);
    if (names.size === 0) return undefined;
    const found: Origin[] = f.params.flatMap((p, i) => ([...named(p.type)].some((n) => names.has(n)) ? [i] : []));
    if ([...classLifetimes(f)].some((n) => names.has(n))) found.push("this");
    return found;
  }

  // The lifetime names an annotation writes: on references, and in classes' lifetime slots.
  function named(t: TypeNode | undefined): Set<string> {
    const found = new Set<string>();
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const node = n as { kind?: string; name?: string; args?: (TypeNode & { name?: string })[] };
      if (node.kind === "ref" && node.args) {
        if ((node.name === "Ref" || node.name === "Mut") && node.args.length === 2) found.add(node.args[1]!.name!);
        const lifetime = slots.get(node.name!);
        if (lifetime && node.args.length === lifetime.length) node.args.forEach((a, i) => lifetime[i] && found.add(a.name!));
      }
      for (const v of Object.values(n)) if (v && typeof v === "object") visit(v);
    };
    visit(t);
    return found;
  }

  // What a call's returned reference, or returned value holding references, borrows from, as
  // the callee's signature says; with no lifetime written, whatever was lent to the call.
  function sourcesOf(instance: Instance, args: Expr[], receiver: Expr | undefined, at: Span, lends: (a: Expr) => boolean): Expr[] {
    const f = instance.body;
    const returns = returnOf(instance, at);
    if (!holdsRef(returns)) return [];
    const origins = isRef(returns) ? originsOf(f, paramTypes(instance), returns) : heldOrigins(f);
    if (!origins) return [...args.filter(lends), ...(receiver ? [receiver] : [])];
    return origins.flatMap((o) => (o === "this" ? (receiver ? [receiver] : []) : [args[o]!]));
  }

  // Every lifetime a body writes must be one it declares.
  function lifetimes(f: Body) {
    const declared = new Set([...(f.typeParams ?? []), ...(f.owner ? classNode(f.owner.name)?.typeParams ?? [] : [])].filter(isLifetime).map((p) => p.name));
    const visit = (t: unknown): void => {
      if (!t || typeof t !== "object") return;
      const node = t as { kind?: string; name?: string; args?: TypeNode[] };
      const lives = node.kind === "ref" && (node.name === "Ref" || node.name === "Mut") && node.args?.length === 2 ? [node.args[1]!]
        : node.kind === "ref" && slots.get(node.name!)?.length === node.args?.length ? node.args!.filter((_, i) => slots.get(node.name!)![i]) : [];
      for (const life of lives as (Span & { name: string })[]) {
        if (!declared.has(life.name)) throw new CompileError(`cannot find lifetime '${life.name}'; declare it as '<${life.name} extends Lifetime>'`, life.start, life.end);
      }
      for (const v of Object.values(t)) if (v && typeof v === "object") visit(v);
    };
    f.params.forEach((p) => visit(p.type));
    visit(f.returnType);
  }

  // The lifetimes a method's class declares.
  function classLifetimes(f: Body): Set<string> {
    return new Set((f.owner ? classNode(f.owner.name)?.typeParams ?? [] : []).filter(isLifetime).map((p) => p.name));
  }

  // A class's declaration as written, lifetimes included.
  function classNode(name: string): ClassNode | undefined {
    const base = name.split("<")[0]!;
    return program.find((s): s is ClassNode & Stmt => s.kind === "class" && s.name === base);
  }

  // Codegen sees each type parameter as the concrete type it stands for.
  function lowerTables(instance: Instance) {
    views.set(instance, instance.returns);
    for (const table of [instance.types, instance.coercions]) table.forEach((t, e) => table.set(e, lower(t)));
    for (const local of new Set(instance.locals.values())) local.type = lower(local.type);
    for (const table of [instance.calls, instance.setters]) table.forEach((target, e) => table.set(e, counterpart(target)));
    instance.returns = lower(instance.returns);
  }

  // A member of a generic class made from a type parameter runs as the same member of the
  // class made from what the parameter stands for. Both come from one template, so their
  // members are in the same order.
  function counterpart(target: Instance): Instance {
    const owner = target.body.owner;
    const to = owner && (lower(owner) as ClassType);
    if (!owner || to === owner) return target;
    const body = bodiesOf(classOf(to!))[bodiesOf(classOf(owner)).indexOf(target.body)]!;
    const implicit = [...implicitOf(body).keys()].map((i): [string, Type] => [`#${i}`, target.bindings.get(`#${i}`)!]);
    return instanceOf(body, new Map([...body.scope!, ...implicit]));
  }

  // A call made inside an instance with one of its type parameters gets the type the definition
  // gave it: the callee's return with the callee's parameters as the ones the call passed.
  function resultOf(instance: Instance, at: Span): Type {
    // Checking the callee may instantiate from this call again, so its site is read first.
    const site = siteOf(at);
    const returns = returnOf(instance, at);
    if (!site) return returns;
    const f = instance.body;
    const declared = returnTypeOf(f, new Map([...instance.bindings, ...site]));
    if (declared && !isInterface(declared)) return declared;
    const own = scopeOf(instance);
    return replaced(views.get(instance) ?? returns, new Map([...site].map(([name, t]) => [own.get(name)!, t])));
  }

  function returnOf(instance: Instance, at: Span): Type {
    const f = instance.body;
    const declared = returnTypeOf(f, instance.bindings);
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
      withScope(scopeOf(instance), () => checkInstance(instance));
    } finally {
      checking = outer;
    }
  }

  function checkInstance(instance: Instance, outer?: Outer) {
    const f = instance.body;
    inProgress.add(instance);
    const { types, locals, coercions, calls, setters, jumps } = instance;
    // A closure returns the number type the function type it meets returns, so its literals
    // take that type.
    const given = f.closure?.expected?.returns;
    let declared = f.closure ? (f.returnType ? resolveType(f.returnType) : given && isNumeric(given) ? given : undefined) : returnTypeOf(f, scopeOf(instance));
    if (typeof declared !== "string" && declared?.kind === "function") throw unsupported("functions returned from functions", f.returnType!);
    // A function returning an interface returns its one concrete type, which must satisfy it.
    const trait = declared && typeof declared !== "string" && declared.kind === "interface" ? declared : undefined;
    if (trait) declared = undefined;
    let inferred: Type | undefined;
    const scopes: Map<string, Local>[] = [new Map()];
    const targets: Target[] = [];
    // What the conditions guarding the code being checked prove, innermost last. A `let`
    // narrows only when nothing assigns to its name.
    const facts: Facts[] = [];
    // Each narrowed `Mut` given a whole value of another member, in order.
    const changed: Local[] = [];
    // The expression an expression statement being checked consists of.
    let whole: Expr | undefined;
    const assigned = assignedNames(f.body);
    // A `Mut` variable is never pointed elsewhere, so assigning it doesn't stop it narrowing.
    // A capture narrows as a variable of the closure's would.
    const narrowable = (l: Local) => (captures?.has(l) ? !assigned.has(l.name) : l.param || !l.mutable || !assigned.has(l.name)) || (isRef(l.type) && l.type.mutable);
    // How many scopes enclose each binding's declaration.
    const depths = new Map<Local, number>();
    // Bindings declared directly in a switch case body whose checking has finished.
    const caseOnly = new Set<Local>();
    const proves = (e: Expr) => guard(e, types, locals as Map<Expr, Local>, narrowable);

    // A constructor's fields are unset until assigned, so until then `this` may only appear as
    // the target of an assignment to one of them, and the constructor can't return.
    const unset = new Set(f.self?.constructor ? classOf(f.self.type).required : []);
    let exempt: Expr | undefined;
    // A derived constructor's first statement, `super(...)`, fills the embedded base.
    const superCall = f.self?.constructor && f.self.type.base ? (f.body[0] as Extract<Stmt, { kind: "expr" }>).expr : undefined;
    if (superCall) unset.add(SUPER);

    // In a member of a generic class's instance, `this` is the class made from the type
    // parameters as this body sees them, so it reads through their bounds as the definition did.
    const generic = f.self?.type.generic;
    const viewed = generic && classNamed(generic.name, classOf(f.self!.type).node.typeParams.map((p) => resolveType({ kind: "ref", name: p.name, args: [], start: f.start, end: f.start })), f)!;
    // A closure sees the `this` of the body it is written in, which it only reads.
    const enclosing = f.closure && selfOf(f);
    const self = f.closure ? enclosing && { ...enclosing, constructor: false, mutable: false, owned: false } : f.self && { ...f.self, type: viewed ?? f.self.type };
    const captures = instance.captures;

    const { value, read, condition, effect, coerce, result, expect, changesLocal, changesThis, adapt, finish } = expressions({
      types, locals, coercions, calls, setters, byName, classes, enums, construct, members, returnOf, resultOf, sourcesOf, borrowsFrom: instance.borrowsFrom, classOf, instanceOf, instantiate, paramTypes, lookup,
      self,
      owner: f.closure ? closureOwner(f) : f.owner && f.owner === f.self?.type ? self!.type : f.owner,
      superCall,
      thisReady,
      proves,
      assume,
      narrowed,
      captured: (l) => captures?.has(l) ?? false,
      noteThis,
      closing: f.closure !== undefined,
      changesCapture,
      reachable: (l) => !caseOnly.has(l),
      rewritten,
      depthOf: (l) => depths.get(l)!,
      closure,
      closureBody: (t) => closureBodies.get(t)!,
      resolveType,
      implicitOf,
    });

    const params = f.closure ? f.params.map((p, i) => closureParam(p, i, f.closure!.expected)) : paramTypes(instance, scopeOf(instance));
    f.params.forEach((p, i) => declare(paramName(p), params[i]!, false, true, p));
    // A field initializer runs before the constructor's body, out of reach of its parameters.
    let hidden = false;
    statements(f.body, (s, check) => {
      const assigned = unset.size > 0 ? fieldAssignment(s) : undefined;
      exempt = assigned?.object;
      hidden = f.self?.constructor === true && classOf(f.self.type).initializers.has(s);
      const after = check(s);
      exempt = undefined;
      hidden = false;
      if (assigned) unset.delete(assigned.name);
      if (s.kind === "expr" && s.expr === superCall) unset.delete(SUPER);
      return after;
    });
    finish();
    if (unset.size > 0) {
      const missing = classOf(f.self!.type).fields.find((d) => unset.has(d.name))!;
      throw new CompileError(`property '${missing.name}' has no initializer and is not definitely assigned in the constructor`, missing.start, missing.end);
    }
    const type = declared ?? inferred ?? "void";
    if (f.closure && holdsRef(type)) throw unsupported("closures returning references", f.returnType ?? f.closure.value ?? f);
    if (!f.closure) lifetimes(f);
    // A returned value holding references may point into any parameter, or `this`.
    const everything: Origin[] = [...f.params.map((_, i) => i), ...(f.self && !f.self.owned ? ["this" as const] : [])];
    const origins = isRef(type) ? originsOf(f, params, type) : holdsRef(type) ? heldOrigins(f) ?? everything : [];
    if (type !== "void" && !alwaysReturns(f.body, broken, continued)) {
      const at = f.returnType ?? f;
      throw new CompileError("not all code paths return a value", at.start, at.end);
    }
    checkMoves(f, instance, origins);
    // A class's own `clone()` replaces the compiler's copy, so it has to make one.
    if (self && classOf(self.type).methods.get("clone") === f && (f.params.length > 0 || type !== self.type)) {
      throw new CompileError(`a 'clone' method must take no parameters and return '${show(self.type)}', since it replaces the compiler's copy`, f.start, f.end);
    }
    instance.returns = type;
    if (instance.concrete) lowerTables(instance);
    done.add(instance);
    inProgress.delete(instance);

    // Checks a list of statements in order. What an `if` that leaves early proves holds for
    // the statements after it.
    function statements(list: Stmt[], each = (s: Stmt, check: (s: Stmt) => Facts | undefined) => check(s)) {
      const before = facts.length;
      for (const s of list) {
        const mark = changed.length;
        const after = each(s, statement);
        if (after) facts.push(current(after, mark));
      }
      facts.length = before;
    }

    // A whole value written through a narrowed `Mut` may be another member, so from here to the
    // end of each narrowing scope it is read as declared. A loop inside such a scope could come
    // back to reads already checked as narrowed.
    function rewritten(l: Local, at: Expr) {
      const outside = captures?.get(l);
      if (outside && outside !== "this" && outer!.narrowed(outside)) {
        throw new CompileError(`can't give '${l.name}' another member inside a closure while a check outside it narrows it; assign its fields instead`, at.start, at.end);
      }
      const from = facts.findIndex((f) => f.has(l));
      if (from < 0) return;
      // Inside a larger expression, a condition could still prove the member it had.
      if (at !== whole) {
        throw new CompileError(`can't give '${l.name}' another member inside a larger expression while a check narrows it; assign it as a statement of its own`, at.start, at.end);
      }
      changed.push(l);
      if (targets.some((t) => t.kind === "loop" && t.facts! > from)) {
        throw new CompileError(`can't give '${l.name}' another member inside a loop here: a check outside the loop narrowed it; assign its fields instead, or check it inside the loop`, at.start, at.end);
      }
      for (let i = from; i < facts.length; i++) facts[i] = new Map(facts[i]).set(l, l.type);
    }

    // Facts proven before a statement that carry past it, less any it gave another member.
    function current(proven: Facts, mark: number): Facts {
      const gone = changed.slice(mark);
      return gone.length === 0 ? proven : new Map([...proven].filter(([l]) => !gone.includes(l)));
    }

    function assume<T>(proven: Facts, check: () => T): T {
      facts.push(proven);
      try {
        return check();
      } finally {
        facts.pop();
      }
    }

    // An arrow function: its own type, and its body checked here, where it is written.
    function closure(e: Arrow, expected?: FunctionType): ClosureType {
      if (e.async) throw unsupported("async arrow functions", e);
      if (e.typeParams.length > 0) throw unsupported("generic arrow functions", e);
      const value = Array.isArray(e.body) ? undefined : e.body;
      const body: Body = {
        name: f.name, params: e.params, returnType: e.returnType, start: e.start, end: e.end, closure: { value, parent: instance, expected, move: e.move },
        body: value ? [{ kind: "return", value, start: value.start, end: value.end }] : (e.body as Stmt[]),
      };
      const inner: Instance = {
        body, symbol: `${instance.symbol}.closure${closures.filter((c) => c.body.closure!.parent === instance).length}`,
        bindings: instance.bindings, concrete: instance.concrete, depth: instance.depth, returns: "void",
        types: new Map(), locals: new Map(), calls: new Map(), setters: new Map(), coercions: new Map(), jumps: new Map(), borrowsFrom: new Map(),
      };
      inner.captures = new Map();
      inner.captureUses = new Map();
      inner.changed = new Set();
      inner.moved = new Set();
      closures.push(inner);
      checkInstance(inner, { lookup, narrowed, thisReady, noteThis, changesLocal, changesThis });
      const sup = [...inner.types.keys()].find((u) => u.kind === "super");
      if (sup) throw unsupported("'super' in closures", sup);
      // A closure holds what it moves, or everything under `move`, and borrows the rest; `this`
      // is a reference either way.
      // In an instance, what a type parameter stands for is laid out.
      const laid = (t: Type) => (inner.concrete ? lower(t) : t);
      const fields = [...inner.captures].map(([alias, from]) => ({
        name: alias.name,
        type: laid(from === "this" ? refType(self!.type, inner.changed!.has(alias)) : e.move || inner.moved!.has(alias) ? from.type : refType(from.type, inner.changed!.has(alias))),
      }));
      const type = closureType(e.params.map(paramName), e.params.map((p) => inner.locals.get(p)!.type), inner.returns, fields, [...inner.moved!][0]?.name, inner.concrete);
      inner.closure = type;
      calls.set(e, inner);
      closureBodies.set(type, inner);
      return type;
    }

    // A parameter's type is written, or else the one the function type the closure meets gives.
    function closureParam(p: Param, i: number, expected: FunctionType | undefined): Type {
      const given = expected?.params[i];
      if (expected && !given && !p.type) {
        const n = expected.params.length;
        throw new CompileError(`'${show(expected)}' passes ${n} argument${n === 1 ? "" : "s"}, so this closure can't take '${paramName(p)}'`, p.start, p.end);
      }
      const plain = !p.rest && !p.optional && !p.default && p.modifiers.length === 0 && p.decorators.length === 0 && !p.comptime && paramName(p) !== "this";
      const type = !p.type && given && plain ? given : paramType(p);
      const to = isRef(type) ? type.to : type;
      if (typeof to !== "string" && to.kind === "interface") throw unsupported("closure parameters of interface types", p);
      return type;
    }

    function statement(s: Stmt): Facts | undefined {
      const declaration = unsupportedDeclaration(s);
      if (declaration) throw declaration;
      switch (s.kind) {
        case "expr":
          whole = s.expr;
          effect(s.expr);
          return;
        case "let": {
          if (s.keyword === "var") throw new CompileError("'var' is not supported; use 'let' or 'const'", s.start, s.start + 3);
          if (s.declarations.length > 1) throw unsupported("declarations of several variables at once", s);
          const d = s.declarations[0]!;
          if (d.target.kind !== "ident") throw unsupported("destructuring patterns", d.target);
          if (!d.init) throw unsupported("declarations without an initializer", d);
          const annotated = d.type && resolveType(d.type);
          if (typeof annotated !== "string" && annotated?.kind === "function") expect(d.init, annotated);
          const type = value(d.init);
          if (annotated) coerce(d.init, type, annotated, `type '${show(type)}' is not assignable to type '${show(annotated)}'`);
          // An interface describes the value, which keeps its own concrete type.
          // A `let` may later hold another member of an enum, so it holds the enum.
          const widened = s.keyword === "let" && !annotated ? widenEnum(type) : type;
          if (widened !== type) coerce(d.init, type, widened, "");
          // So does a function type, which the closure given fits.
          const describes = annotated && (isInterface(annotated) || (typeof annotated !== "string" && annotated.kind === "function"));
          declare(d.target.name, annotated && !describes ? annotated : widened, s.keyword === "let", false, s);
          return;
        }
        case "if": {
          condition(s.cond);
          const proven = proves(s.cond);
          assume(proven.yes, () => scoped(s.then));
          if (s.else) assume(proven.no, () => scoped(s.else!));
          // A branch that never reaches its end leaves the other's facts for what follows.
          const [thenLeaves, elseLeaves] = [leaves(s.then), s.else ? leaves(s.else) : false];
          if (thenLeaves && !elseLeaves) return proven.no;
          if (elseLeaves && !thenLeaves) return proven.yes;
          return undefined;
        }
        case "while":
          condition(s.cond);
          within({ stmt: s, kind: "loop" }, () => assume(proves(s.cond).yes, () => scoped(s.body)));
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
          const type = read(s.discriminant);
          const union = typeof type !== "string" && type.kind === "union" ? type : undefined;
          if (typeof type !== "string" && !union && type.kind !== "literal") throw unsupported("comparisons of objects", s.discriminant);
          const defaults = s.cases.filter((c) => !c.test);
          if (defaults.length > 1) throw new CompileError("a 'switch' can have only one 'default'", defaults[1]!.start, defaults[1]!.end);
          // The case bodies share one scope, as in JavaScript, but any case may be entered
          // directly, skipping the bodies before it, so a binding one case declares is usable
          // only in that case.
          const shared = new Map<string, Local>();
          scopes.push(shared);
          within({ stmt: s, kind: "switch" }, () => {
            // A case narrows a union for its body, and so do the cases that fall through into it.
            // `falling` is what holds for a body the previous one falls into, or null when it leaves.
            let falling: Facts | null = null;
            for (const c of s.cases) {
              const before = new Set(shared.values());
              let test = c.test && value(c.test);
              // A literal case takes the discriminant's type, or its union's one number type.
              const numbers = union ? union.members.filter(isNumeric) : [type];
              if (test && test !== type && numbers.length === 1 && adapt(c.test!, numbers[0]!)) test = numbers[0]!;
              if (test && objectsMeet(type, test)) throw unsupported("comparisons of objects", c.test!);
              if (test && test !== type && !comparable(type, test)) {
                throw new CompileError(`type '${show(test)}' is not comparable to type '${show(type)}'`, c.test!.start, c.test!.end);
              }
              const tested: Facts = c.test ? proves({ kind: "binary", op: "===", left: s.discriminant, right: c.test, start: c.start, end: c.end }).yes : new Map();
              const reaching: Facts = falling ? either(falling, tested) : tested;
              const mark = changed.length;
              assume(reaching, () => statements(c.body));
              for (const local of shared.values()) if (!before.has(local)) caseOnly.add(local);
              falling = leaves(c.body) ? null : current(reaching, mark);
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
          // An arrow's expression body may be a call returning nothing.
          const type = !s.value ? "void" : s.value === f.closure?.value && s.value.kind === "call" ? result(s.value) : value(s.value);
          if (typeof type !== "string" && type.kind === "closure") throw unsupported("functions returned from functions", s.value!);
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
      target.facts = facts.length;
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

    // Whether control never reaches the end of these statements, leaving by `return`, `break`
    // or `continue`.
    function leaves(stmts: Stmt[]): boolean {
      const last = stmts.at(-1);
      return alwaysReturns(stmts, broken, continued) || last?.kind === "break" || last?.kind === "continue";
    }

    function scoped(stmts: Stmt[]) {
      scopes.push(new Map());
      statements(stmts);
      scopes.pop();
    }

    function declare(name: string, type: Type, mutable: boolean, param: boolean, node: Stmt | Param) {
      const scope = scopes[scopes.length - 1]!;
      if (scope.has(name)) throw new CompileError(`cannot redeclare '${name}' in the same scope`, node.start, node.end);
      const local = { name, type, mutable, param, id: nextId++ };
      depths.set(local, scopes.length);
      scope.set(name, local);
      locals.set(node, local);
    }

    function lookup(name: string, at?: Expr | ObjectProp): Local | undefined {
      for (let i = scopes.length - 1; i >= (hidden ? 1 : 0); i--) {
        const local = scopes[i]!.get(name);
        if (local) return local;
      }
      const outside = outer?.lookup(name, at);
      return outside && capture(outside, at);
    }

    // Whether `this` may be used: a constructor's can't until every field is assigned, nor can
    // a closure's made before then.
    function thisReady(e: Expr): boolean {
      return outer ? outer.thisReady(e) : unset.size === 0 || e === exempt;
    }

    // A closure changing what it captures captures it mutably, if it may change where the
    // closure is made.
    function changesCapture(l: Local | undefined, path: string, action: string, target: Expr, throughMut: boolean) {
      const alias = l ?? [...captures!].find(([, from]) => from === "this")![0];
      const from = captures!.get(alias)!;
      instance.changed!.add(alias);
      if (from === "this") outer!.changesThis(path, action, target);
      // What a `move` closure holds is its own to change, unless the change goes through a
      // mutable reference it holds a copy of.
      else if (f.closure!.move && !(isRef(from.type) && (path || throughMut))) return;
      else {
        if (!path && action === "assign to" && isRef(from.type) && !from.type.mutable) throw unsupported("closures that point captured references elsewhere", target);
        outer!.changesLocal(from, path, action, target, throughMut);
      }
    }

    function noteThis(e: Expr) {
      if (!captures || [...captures.values()].includes("this")) return;
      const alias: Local = { name: "this", type: self!.type, mutable: false, param: false, id: nextId++ };
      captures.set(alias, "this");
      instance.captureUses!.set(alias, e);
      outer!.noteThis(e);
    }

    // Who a closure's body counts as for access to private members: its function's class.
    function closureOwner(b: Body): Body["owner"] {
      let outerBody = b;
      while (outerBody.closure) outerBody = outerBody.closure.parent.body;
      return outerBody.owner && outerBody.owner === enclosing?.type ? self!.type : outerBody.owner;
    }

    // A variable's type where something narrowed it: a captured one as it was where the closure
    // was made.
    function narrowed(l: Local): Type | undefined {
      const outside = captures?.get(l);
      return facts.findLast((f) => f.has(l))?.get(l) ?? (outside && outside !== "this" ? outer!.narrowed(outside) : undefined);
    }

    // A closure's body reads a variable it captures through a binding of its own, standing
    // for it.
    function capture(from: Local, at?: Expr | ObjectProp): Local {
      let alias = [...captures!].find(([, l]) => l === from)?.[0];
      if (!alias) {
        alias = { name: from.name, type: from.type, mutable: false, param: false, id: nextId++ };
        depths.set(alias, 0);
        captures!.set(alias, from);
      }
      if (at && !instance.captureUses!.has(alias)) instance.captureUses!.set(alias, at);
      return alias;
    }
  }

}

// The `this` a body sees: a closure's is that of the function it is written in.
export function selfOf(f: Body): Body["self"] {
  return f.closure ? selfOf(f.closure.parent.body) : f.self;
}

// Stands for the base in a derived constructor's unset fields until `super(...)` runs.
const SUPER = "super()";

const isInterface = (t: Type) => typeof t !== "string" && t.kind === "interface";

const isRef = (t: Type): t is RefType => typeof t !== "string" && t.kind === "ref";

// What a returned reference borrows from: a parameter, by index, or `this`.
export type Origin = number | "this";

const hasBody = (f: Declared): f is Func => f.body !== undefined;

