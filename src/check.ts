import { CompileError } from "./diag.ts";
import type { Expr, Func, Stmt, TypeRef } from "./parser.ts";

export type Type = "i64";

export type Local = { name: string; type: Type; mutable: boolean; id: number };

export type Checked = {
  funcs: Func[];
  // Every value expression's type.
  types: Map<Expr, Type>;
  // The binding each name use and declaration refers to, after shadowing.
  locals: Map<Expr | Stmt, Local>;
};

type Call = Extract<Expr, { kind: "call" }>;

const I64_MAX = (1n << 63n) - 1n;

export function isPrint(callee: Expr): boolean {
  if (callee.kind === "ident") return callee.name === "print";
  return callee.kind === "member" && callee.name === "log" &&
    callee.object.kind === "ident" && callee.object.name === "console";
}

// Resolves every name and gives every value expression a type. Codegen trusts the result.
export function check(funcs: Func[]): Checked {
  const defined = new Set<string>();
  for (const f of funcs) {
    if (defined.has(f.name)) throw new CompileError(`'${f.name}' is already defined`, f.start, f.end);
    defined.add(f.name);
  }
  if (!defined.has("main")) throw new CompileError("no main() function; execution starts there", 0, 0);

  const types = new Map<Expr, Type>();
  const locals = new Map<Expr | Stmt, Local>();
  let scopes: Map<string, Local>[] = [];
  let nextId = 0;

  for (const f of funcs) {
    scopes = [new Map()];
    f.body.forEach(statement);
  }
  return { funcs, types, locals };

  function statement(s: Stmt) {
    switch (s.kind) {
      case "expr":
        if (s.expr.kind !== "call") throw new CompileError("only calls are supported as statements so far", s.start, s.end);
        call(s.expr);
        return;
      case "let": {
        const declared = s.type && resolveType(s.type);
        const type = value(s.init);
        if (declared && declared !== type) {
          throw new CompileError(`type '${type}' is not assignable to type '${declared}'`, s.init.start, s.init.end);
        }
        const scope = scopes[scopes.length - 1]!;
        if (scope.has(s.name)) throw new CompileError(`cannot redeclare '${s.name}' in the same scope`, s.start, s.end);
        const local = { name: s.name, type, mutable: s.mutable, id: nextId++ };
        scope.set(s.name, local);
        locals.set(s, local);
        return;
      }
      case "assign": {
        if (s.target.kind !== "ident") throw new CompileError("can only assign to a variable", s.target.start, s.target.end);
        value(s.target);
        const local = locals.get(s.target)!;
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
    }
  }

  // User functions take no arguments and return nothing yet.
  function call(e: Call) {
    const { callee } = e;
    if (callee.kind === "ident" && defined.has(callee.name)) {
      if (e.args.length > 0) throw new CompileError(`'${callee.name}' takes no arguments`, e.start, e.end);
      return;
    }
    if (isPrint(callee)) {
      for (const a of e.args) if (a.kind !== "string") value(a);
      return;
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
          const message = defined.has(e.name) ? `functions can't be used as values yet` : `cannot find name '${e.name}'`;
          throw new CompileError(message, e.start, e.end);
        }
        locals.set(e, local);
        return local.type;
      }
      case "string":
        throw new CompileError("strings can only be passed straight to print for now", e.start, e.end);
      case "member":
        throw new CompileError("member access is not supported yet", e.start, e.end);
      case "call":
        call(e);
        throw new CompileError("this call does not return a value", e.start, e.end);
      case "unary":
        return value(e.operand);
      case "binary":
        value(e.left);
        return value(e.right);
    }
  }

  function lookup(name: string): Local | undefined {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const local = scopes[i]!.get(name);
      if (local) return local;
    }
    return undefined;
  }

  function resolveType(t: TypeRef): Type {
    if (t.name === "i64") return "i64";
    if (t.name === "number") throw new CompileError("'number' (a 64-bit float) is not supported yet; use i64", t.start, t.end);
    throw new CompileError(`cannot find type '${t.name}'`, t.start, t.end);
  }
}
