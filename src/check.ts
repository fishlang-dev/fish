import { CompileError } from "./diag.ts";
import type { BinaryOp, Expr, Func, Param, Span, Stmt, TypeNode } from "./parser.ts";

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
};

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
    if (s.kind === "typeAlias") throw unsupported("type aliases", s);
    if (s.kind === "interface") throw unsupported("interfaces", s);
    if (s.kind === "empty") continue;
    // Top-level code with side effects belongs in main(), as migration rule G7 says.
    if (s.kind !== "function") throw new CompileError("only declarations are allowed at the top level; move this into main()", s.start, s.end);
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
  const inProgress = new Set<Func>();
  let nextId = 0;

  funcs.forEach(checkBody);
  if (main.params.length > 0) throw new CompileError("main() takes no parameters", main.start, main.end);
  if (returns.get("main") !== "void") throw new CompileError("main() can't return a value yet", main.start, main.end);
  return { funcs, types, locals, returns };

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
      switch (s.kind) {
        case "expr":
          if (s.expr.kind === "call") {
            call(s.expr);
            return;
          }
          if (s.expr.kind === "assign") throw new CompileError(`operator '${s.expr.op}' is not supported yet`, s.expr.start, s.expr.end);
          value(s.expr);
          throw new CompileError("only calls are supported as statements so far", s.start, s.end);
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
        case "assign": {
          if (s.target.kind !== "ident") throw new CompileError("can only assign to a variable", s.target.start, s.target.end);
          value(s.target);
          const local = locals.get(s.target)!;
          if (local.param) {
            throw new CompileError("assigning to a parameter is not supported yet; copy it into a 'let'", s.target.start, s.target.end);
          }
          if (!local.mutable) {
            throw new CompileError(`cannot assign to '${local.name}' because it is a constant`, s.target.start, s.target.end);
          }
          const assigned = value(s.value);
          const type = s.op === "=" ? assigned : binaryType(s.op, local.type, assigned, s);
          if (type !== local.type) {
            throw new CompileError(`type '${type}' is not assignable to type '${local.type}'`, s.value.start, s.value.end);
          }
          locals.set(s, local);
          return;
        }
        case "if":
          condition(s.cond);
          scoped(s.then);
          if (s.else) scoped(s.else);
          return;
        case "while":
          condition(s.cond);
          scoped(s.body);
          return;
        case "typeAlias":
          throw unsupported("type aliases", s);
        case "interface":
          throw unsupported("interfaces", s);
        case "function":
          throw unsupported("nested functions", s);
        case "block":
          throw unsupported("block statements", s);
        case "debugger":
          throw unsupported("'debugger' statements", s);
        case "empty":
          return;
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

    // Checks a call's arguments; returns the user function it calls, or undefined for print.
    function call(e: Call): Func | undefined {
      const { callee } = e;
      if (e.optional) throw unsupported("optional calls", e);
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
        case "binary":
          // Migration rule A3 rewrites loose equality to strict, so native code never uses it.
          if (e.op === "==" || e.op === "!=") throw new CompileError(`'${e.op}' is not supported; use '${e.op}='`, e.start, e.end);
          if (!SUPPORTED_OPERATORS.has(e.op)) throw new CompileError(`operator '${e.op}' is not supported yet`, e.start, e.end);
          return binaryType(e.op, value(e.left), value(e.right), e);
        default:
          throw unsupported(EXPRESSION_FORMS[e.kind], e);
      }
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

// What each expression form is called when the checker rejects it.
const EXPRESSION_FORMS: Record<Exclude<Expr["kind"], "int" | "bool" | "string" | "ident" | "member" | "call" | "unary" | "binary">, string> = {
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
  index: "indexed access expressions",
  new: "'new' expressions",
  instantiation: "instantiation expressions",
  meta: "meta properties",
  import: "dynamic imports",
  nonNull: "non-null assertions",
  update: "increment and decrement expressions",
  conditional: "conditional expressions",
  assign: "assignment expressions",
  destructure: "destructuring assignments",
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

function unsupported(what: string, at: Span): CompileError {
  return new CompileError(`${what} are not supported yet`, at.start, at.end);
}

// `while (true)` never finishes, since there is no `break` yet, so nothing after it runs.
function alwaysReturns(stmts: Stmt[]): boolean {
  return stmts.some((s) =>
    s.kind === "return" ||
    (s.kind === "if" && s.else !== undefined && alwaysReturns(s.then) && alwaysReturns(s.else)) ||
    (s.kind === "while" && s.cond.kind === "bool" && s.cond.value));
}
