import { CompileError } from "./diag.ts";
import type { Expr, Func, Param, Span, Stmt, TypeRef } from "./parser.ts";

export type Type = "i64" | "void";

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
export function check(funcs: Func[]): Checked {
  const byName = new Map<string, Func>();
  for (const f of funcs) {
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

    for (const p of f.params) declare(p.name, paramType(p), false, true, p);
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
          if (s.expr.kind !== "call") throw new CompileError("only calls are supported as statements so far", s.start, s.end);
          call(s.expr);
          return;
        case "let": {
          const annotated = s.type && resolveType(s.type);
          const type = value(s.init);
          if (annotated && annotated !== type) {
            throw new CompileError(`type '${type}' is not assignable to type '${annotated}'`, s.init.start, s.init.end);
          }
          declare(s.name, type, s.mutable, false, s);
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
          const type = value(s.value);
          if (type !== local.type) {
            throw new CompileError(`type '${type}' is not assignable to type '${local.type}'`, s.value.start, s.value.end);
          }
          locals.set(s, local);
          return;
        }
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
      const target = callee.kind === "ident" ? byName.get(callee.name) : undefined;
      if (target) {
        const expected = target.params.length;
        if (e.args.length !== expected) {
          throw new CompileError(`expected ${expected} argument${expected === 1 ? "" : "s"}, but got ${e.args.length}`, e.start, e.end);
        }
        e.args.forEach((a) => value(a));
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
        case "unary":
          return value(e.operand);
        case "binary":
          value(e.left);
          return value(e.right);
      }
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

  // TypeScript's strict mode has no implicit `any`, and Fish has no `any` at all.
  function paramType(p: Param): Type {
    if (!p.type) throw new CompileError(`parameter '${p.name}' implicitly has an 'any' type; add a type annotation`, p.start, p.end);
    return resolveType(p.type);
  }

  function resolveType(t: TypeRef): Type {
    if (t.name === "i64" || t.name === "void") return t.name;
    if (t.name === "number") throw new CompileError("'number' (a 64-bit float) is not supported yet; use i64", t.start, t.end);
    throw new CompileError(`cannot find type '${t.name}'`, t.start, t.end);
  }
}

function alwaysReturns(stmts: Stmt[]): boolean {
  return stmts.some((s) => s.kind === "return");
}
