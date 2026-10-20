import { CompileError } from "./diag.ts";
import type { ArithmeticOp, AssignOp, BinaryOp, Expr, Func as Declared, Param, Span, Stmt, TypeNode } from "./parser.ts";

// A function with a body; overload signatures and `declare function` are rejected first.
type Func = Declared & { body: Stmt[] };

export type Type = "i64" | "boolean" | "void";

export type Local = { name: string; type: Type; mutable: boolean; param: boolean; id: number };

export type Checked = {
  funcs: Func[];
  // Every value expression's type.
  types: Map<Expr, Type>;
  // The binding each name use, declaration and parameter refers to, after shadowing.
  locals: Map<Expr | Stmt | Param, Local>;
  // Each function's return type, written or inferred.
  returns: Map<string, Type>;
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
  for (const s of program) {
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
    if (byName.has(f.name)) throw new CompileError(`'${f.name}' is already defined`, f.start, f.end);
    byName.set(f.name, f);
  }
  const main = byName.get("main");
  if (!main) throw new CompileError("no main() function; execution starts there", 0, 0);

  const types = new Map<Expr, Type>();
  const locals = new Map<Expr | Stmt | Param, Local>();
  const returns = new Map<string, Type>();
  const jumps = new Map<Stmt, Stmt>();
  // The targets some `break` leaves, and the loops some `continue` repeats.
  const broken = new Set<Stmt>();
  const continued = new Set<Stmt>();
  const inProgress = new Set<Func>();
  let nextId = 0;

  funcs.forEach(checkBody);
  if (main.params.length > 0) throw new CompileError("main() takes no parameters", main.start, main.end);
  if (returns.get("main") !== "void") throw new CompileError("main() can't return a value yet", main.start, main.end);
  return { funcs, types, locals, returns, jumps };

  function returnOf(f: Func, at: Span): Type {
    if (f.returnType) return resolveType(f.returnType);
    if (inProgress.has(f)) {
      throw new CompileError(`'${f.name}' needs a return type annotation because it calls itself`, at.start, at.end);
    }
    checkBody(f);
    return returns.get(f.name)!;
  }

  function checkBody(f: Func) {
    if (returns.has(f.name)) return;
    inProgress.add(f);
    const declared = f.returnType && resolveType(f.returnType);
    let inferred: Type | undefined;
    const scopes: Map<string, Local>[] = [new Map()];
    const targets: Target[] = [];

    for (const p of f.params) declare(paramName(p), paramType(p), false, true, p);
    f.body.forEach(statement);
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
          if (annotated && annotated !== type) {
            throw new CompileError(`type '${type}' is not assignable to type '${annotated}'`, d.init.start, d.init.end);
          }
          declare(d.target.name, type, s.keyword === "let", false, s);
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
          const defaults = s.cases.filter((c) => !c.test);
          if (defaults.length > 1) throw new CompileError("a 'switch' can have only one 'default'", defaults[1]!.start, defaults[1]!.end);
          // The case bodies share one scope, as in JavaScript.
          scopes.push(new Map());
          within({ stmt: s, kind: "switch" }, () => {
            for (const c of s.cases) {
              const test = c.test && value(c.test);
              if (test && test !== type) {
                throw new CompileError(`type '${test}' is not comparable to type '${type}'`, c.test!.start, c.test!.end);
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
          const type = s.value ? value(s.value) : "void";
          const expected = declared ?? inferred;
          if (expected && type !== expected) {
            const at = s.value ?? s;
            throw new CompileError(`type '${type}' is not assignable to return type '${expected}'`, at.start, at.end);
          }
          inferred = type;
          return;
        }
      }
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
        const expected = target.params.length;
        if (e.args.length !== expected) {
          throw new CompileError(`expected ${expected} argument${expected === 1 ? "" : "s"}, but got ${e.args.length}`, e.start, e.end);
        }
        e.args.forEach((a, i) => {
          const type = value(a);
          const expected = paramType(target.params[i]!);
          if (type !== expected) {
            throw new CompileError(`argument of type '${type}' is not assignable to parameter of type '${expected}'`, a.start, a.end);
          }
        });
        return target;
      }
      if (isPrint(callee)) {
        for (const a of e.args) if (a.kind !== "string") value(a);
        return undefined;
      }
      const name = callee.kind === "ident" ? `'${callee.name}'` : "this expression";
      throw new CompileError(`unknown function ${name}`, callee.start, callee.end);
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
            const message = byName.has(e.name) ? `functions can't be used as values yet` : `cannot find name '${e.name}'`;
            throw new CompileError(message, e.start, e.end);
          }
          locals.set(e, local);
          return local.type;
        }
        case "string":
          throw new CompileError("strings can only be passed straight to print for now", e.start, e.end);
        case "member":
          throw new CompileError("member access is not supported yet", e.start, e.end);
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
          if (e.op !== "-" && e.op !== "!") throw new CompileError(`operator '${e.op}' is not supported yet`, e.start, e.end);
          const type = value(e.operand);
          if (type !== (e.op === "-" ? "i64" : "boolean")) {
            throw new CompileError(`operator '${e.op}' cannot be applied to type '${type}'`, e.start, e.end);
          }
          return type;
        }
        case "assign": {
          const op = ASSIGNMENTS[e.op];
          if (!op) throw new CompileError(`operator '${e.op}' is not supported yet`, e.start, e.end);
          const local = assignable(e.target);
          const assigned = value(e.value);
          const type = op === "=" ? assigned : binaryType(op, local.type, assigned, e);
          if (type !== local.type) {
            throw new CompileError(`type '${type}' is not assignable to type '${local.type}'`, e.value.start, e.value.end);
          }
          return type;
        }
        case "update": {
          const local = assignable(e.operand);
          if (local.type !== "i64") throw new CompileError(`operator '${e.op}' cannot be applied to type '${local.type}'`, e.start, e.end);
          return "i64";
        }
        case "conditional": {
          condition(e.cond);
          const [then, otherwise] = [value(e.then), value(e.else)];
          if (then !== otherwise) {
            throw new CompileError(`both sides of '?:' must have the same type, not '${then}' and '${otherwise}'`, e.start, e.end);
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

    function assignable(target: Expr): Local {
      if (target.kind !== "ident") throw new CompileError("can only assign to a variable", target.start, target.end);
      value(target);
      const local = locals.get(target)!;
      if (local.param) {
        throw new CompileError("assigning to a parameter is not supported yet; copy it into a 'let'", target.start, target.end);
      }
      if (!local.mutable) {
        throw new CompileError(`cannot assign to '${local.name}' because it is a constant`, target.start, target.end);
      }
      return local;
    }

    // Fish has no truthiness: a condition is a boolean, never a number tested against zero.
    function condition(e: Expr) {
      const type = value(e);
      if (type !== "boolean") {
        throw new CompileError(`condition must be a boolean, not '${type}'; compare explicitly, e.g. 'n !== 0'`, e.start, e.end);
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

  function binaryType(op: BinaryOp, left: Type, right: Type, at: Span): Type {
    if (op === "===" || op === "!==") {
      if (left === right) return "boolean";
      throw new CompileError(`this comparison appears to be unintentional because the types '${left}' and '${right}' have no overlap`, at.start, at.end);
    }
    // Only booleans, so `&&` and `||` always produce a boolean rather than one of their operands.
    const operand = op === "&&" || op === "||" ? "boolean" : "i64";
    if (left !== operand || right !== operand) {
      throw new CompileError(`operator '${op}' cannot be applied to types '${left}' and '${right}'`, at.start, at.end);
    }
    return operand === "boolean" || op === "<" || op === "<=" || op === ">" || op === ">=" ? "boolean" : "i64";
  }

  // TypeScript's strict mode has no implicit `any`, and Fish has no `any` at all.
  function paramType(p: Param): Type {
    if (p.rest) throw unsupported("rest parameters", p);
    if (p.optional) throw unsupported("optional parameters", p);
    const name = paramName(p);
    if (p.decorators.length > 0) throw unsupported("decorators", p);
    if (p.comptime) throw unsupported("comptime parameters", p);
    if (p.modifiers.length > 0) throw unsupported("parameter properties", p);
    if (name === "this") throw unsupported("'this' parameters", p);
    if (p.default) throw unsupported("default parameter values", p);
    if (!p.type) throw new CompileError(`parameter '${name}' implicitly has an 'any' type; add a type annotation`, p.start, p.end);
    return resolveType(p.type);
  }

  function paramName(p: Param): string {
    if (p.pattern.kind !== "ident") throw unsupported("destructuring patterns", p.pattern);
    return p.pattern.name;
  }

  function resolveType(t: TypeNode): Type {
    if (t.kind === "operator") throw unsupported(`'${t.op}' types`, t);
    if (t.kind === "function") throw unsupported(t.construct ? "constructor types" : "function types", t);
    if (t.kind !== "ref") throw unsupported(TYPE_FORMS[t.kind], t);
    if (t.args.length > 0) throw unsupported("generic types", t);
    if (t.name === "i64" || t.name === "boolean" || t.name === "void") return t.name;
    if (t.name === "number") throw new CompileError("'number' (a 64-bit float) is not supported yet; use i64", t.start, t.end);
    throw new CompileError(`cannot find type '${t.name}'`, t.start, t.end);
  }
}

// The binary operators that have a meaning so far.
const SUPPORTED_OPERATORS = new Set<BinaryOp>(["||", "&&", "===", "!==", "<", "<=", ">", ">=", "+", "-", "*", "/", "%"]);

// The assignment operators that have a meaning so far, and the operator each applies.
export const ASSIGNMENTS: Partial<Record<AssignOp, ArithmeticOp | "=">> = { "=": "=", "+=": "+", "-=": "-", "*=": "*", "/=": "/", "%=": "%" };

// What each expression form is called when the checker rejects it.
const EXPRESSION_FORMS: Record<Exclude<Expr["kind"], "int" | "bool" | "string" | "ident" | "member" | "call" | "unary" | "binary" | "assign" | "update" | "conditional">, string> = {
  float: "floating-point numbers",
  bigint: "bigint literals",
  null: "'null' values",
  this: "'this' expressions",
  super: "'super' expressions",
  regex: "regular expressions",
  spread: "spread elements",
  array: "array literals",
  object: "object literals",
  function: "function expressions",
  arrow: "arrow functions",
  class: "class expressions",
  privateName: "private names",
  index: "indexed access expressions",
  new: "'new' expressions",
  instantiation: "instantiation expressions",
  meta: "meta properties",
  import: "dynamic imports",
  nonNull: "non-null assertions",
  destructure: "destructuring assignments",
  pipe: "'|>' expressions",
  topic: "topic references",
  comptime: "comptime expressions",
  match: "match expressions",
  sequence: "comma expressions",
  yield: "'yield' expressions",
  as: "'as' expressions",
  satisfies: "'satisfies' expressions",
  assertion: "type assertions",
  template: "template literals",
  tagged: "tagged templates",
};

// What each type form is called when the checker rejects it.
const TYPE_FORMS: Record<Exclude<TypeNode["kind"], "ref" | "operator" | "function">, string> = {
  literal: "literal types",
  array: "array types",
  tuple: "tuple types",
  object: "object types",
  union: "union types",
  intersection: "intersection types",
  indexed: "indexed access types",
  query: "'typeof' types",
  predicate: "type predicates",
  import: "import types",
  conditional: "conditional types",
  infer: "'infer' types",
  mapped: "mapped types",
  template: "template literal types",
};

// Declarations that parse but have no meaning yet, wherever they appear.
function unsupportedDeclaration(s: Stmt): CompileError | undefined {
  switch (s.kind) {
    case "typeAlias":
      return unsupported("type aliases", s);
    case "interface":
      return unsupported("interfaces", s);
    case "class":
      return unsupported(s.decorators.length > 0 ? "decorators" : "classes", s);
    case "enum":
      return unsupported("enums", s);
    case "namespace":
      return unsupported("namespaces", s);
    case "declare":
      return unsupported("ambient declarations", s);
    case "import":
    case "importEquals":
      return unsupported("imports", s);
    case "export":
    case "exportDefault":
    case "exportNamed":
    case "exportAll":
    case "exportAssign":
    case "exportAsNamespace":
      return unsupported("exports", s);
  }
  return undefined;
}

const hasBody = (f: Declared): f is Func => f.body !== undefined;

function unsupported(what: string, at: Span): CompileError {
  return new CompileError(`${what} are not supported yet`, at.start, at.end);
}

const isTrue = (e: Expr) => e.kind === "bool" && e.value;
