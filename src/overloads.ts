import assert from "node:assert";
import { CompileError } from "./diag.ts";
import { dup, nextId, renumberParam, renumberTypeNode, Rewrites, walkWhile, type Ids } from "./nodes.ts";
import type { ClassMember, ClassNode, Expr, Func, Param, Span, Stmt, TypeNode } from "./parser.ts";
import { cloneClassMember, cloneClassNode, cloneFunc, cloneParam, cloneTypeNode, rebuiltStmts } from "./rebuild.ts";
import { unsupported } from "./unsupported.ts";

// Overload signatures are the bodyless declarations of a name right before its implementation.
// Each becomes a function of its own, named apart, whose body calls the implementation and gives
// what it returns as the signature's return type, narrowed at run time where the implementation's
// is wider. The implementation lists them in order, as a call tries them, and only a signature's
// own body calls it directly.

// The implementation's call in a signature's body, which no overload is chosen for.
export type Direct = { implementation?: true };

type Method = Extract<ClassMember, { kind: "method" }>;

function sigName(s: Ref<Stmt>): string | undefined {
  if (s.kind === "function" && s.body === undefined && s.js === undefined) return s.name;
  if (s.kind === "export" && s.body.kind === "function" && s.body.body === undefined && s.body.js === undefined) return s.body.name;
  return undefined;
}

function isImplFor(s: Ref<Stmt>, name: string): boolean {
  if (s.kind === "function") return s.body !== undefined && s.js === undefined && s.name === name;
  if (s.kind === "export" && s.body.kind === "function") return s.body.body !== undefined && s.body.js === undefined && s.body.name === name;
  return false;
}

function takeFunc(s: Stmt): Func {
  if (s.kind === "function") return s;
  assert(s.kind === "export" && s.body.kind === "function", "internal error: takeFunc on a statement that is no function");
  return s.body;
}

/** @throws {CompileError} */
function replaceStmtFunc(rewrites: Mut<Rewrites>, s: Ref<Stmt>, overloadNames: string[]): void {
  if (s.kind === "function") {
    if (s.async || s.generator) throw unsupported("overloads of async functions and generators", span(s));
    let implClone = cloneFunc(s);
    implClone.overloadNames = overloadNames;
    rewrites.replaceFunc(s, implClone);
  } else if (s.kind === "export" && s.body.kind === "function") {
    if (s.body.async || s.body.generator) throw unsupported("overloads of async functions and generators", span(s.body));
    let implClone = cloneFunc(s.body);
    implClone.overloadNames = overloadNames;
    rewrites.replaceFunc(s.body, implClone);
  }
}

function implThrowsClone(ids: Mut<Ids>, s: Ref<Stmt>): TypeNode | undefined {
  if (s.kind === "function" && s.throws !== undefined) return renumberTypeNode(cloneTypeNode(s.throws), () => nextId(ids));
  if (s.kind === "export" && s.body.kind === "function" && s.body.throws !== undefined) return renumberTypeNode(cloneTypeNode(s.body.throws), () => nextId(ids));
  return undefined;
}

/** @throws {CompileError} */
export function lowerOverloads(ids: Mut<Ids>, program: Mut<Stmt[]>): Stmt[] {
  let rem = program.splice(0);
  let out: Stmt[] = [];
  let rewrites = new Rewrites();
  while (rem.length > 0) {
    const fname = sigName(rem[0]!);
    let k: usize = 0;
    if (fname !== undefined) {
      while (k < rem.length && sigName(rem[k]!) === fname) k++;
    }
    if (k === 0 || k >= rem.length || fname === undefined || !isImplFor(rem[k]!, fname)) {
      out.push(rem.shift()!);
      continue;
    }
    let run: Func[] = [];
    for (let m: usize = 0; m < k; m++) run.push(takeFunc(rem.shift()!));
    const implStmt = rem.shift()!;
    // Check async/generator before building wrappers.
    replaceStmtFunc(rewrites, implStmt, []);
    let wrappers: Func[] = [];
    let overloadNames: string[] = [];
    for (let n: usize = 0; run.length > 0; n++) {
      let sig = run.shift()!;
      const params = signatureParams(ids, sig.params);
      let args: Expr[] = [];
      for (const p of params) args.push(argument(ids, p));
      const call: Expr = { id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "ident", name: fname, start: sig.start, end: sig.end }, typeArgs: [], args, optional: false, implementation: true, start: sig.start, end: sig.end };
      const throws = sig.throws !== undefined ? sig.throws : implThrowsClone(ids, implStmt);
      const [retType, body] = wrapped(ids, sig.start, sig.end, sig.returnType, call);
      const overloadName = `${fname} overload ${n + 1}`;
      overloadNames.push(overloadName);
      sig.id = nextId(ids);
      sig.name = overloadName;
      sig.params = params;
      sig.returnType = retType;
      sig.body = body;
      sig.signature = true;
      sig.throws = throws;
      wrappers.push(sig);
    }
    replaceStmtFunc(rewrites, implStmt, overloadNames);
    out.push(implStmt);
    for (let w = wrappers; w.length > 0; ) out.push(w.shift()!);
  }
  holdsClasses(ids, rewrites, out);
  rebuiltStmts(out, rewrites);
  let res: Stmt[] = [];
  for (let x = out; x.length > 0; ) {
    const [a, b] = dup(x.shift()!);
    program.push(a);
    res.push(b);
  }
  return res;
}

// Every class, declared or written as an expression, has its method overloads lowered.
/** @throws {CompileError} */
function holdsClasses(ids: Mut<Ids>, rewrites: Mut<Rewrites>, program: Ref<Stmt[]>) {
  let failed: CompileError | undefined = undefined;
  walkWhile({ of: "stmts", node: program }, (item) => {
    try {
      if (item.of === "stmt" && item.node.kind === "class") {
        const c = item.node;
        if (hasMethodOverloads(c.members)) {
          const members = lowerMembers(ids, rewrites, c);
          let cloned = cloneClassNode(c);
          cloned.members = members;
          rewrites.replaceStmt(c, { kind: "class" as const, ...cloned });
        }
      } else if (item.of === "expr" && item.node.kind === "class") {
        const c = item.node;
        if (hasMethodOverloads(c.members)) {
          const members = lowerMembers(ids, rewrites, c);
          let cloned = cloneClassNode(c);
          cloned.members = members;
          rewrites.replace(c, { kind: "class" as const, ...cloned });
        }
      }
      return true;
    } catch (e) {
      if (e instanceof CompileError) failed = e;
      return false;
    }
  });
  if (failed !== undefined) throw failed!;
}

function asMethod(m: Ref<ClassMember>): Method | undefined {
  const c = cloneClassMember(m);
  return c.kind === "method" ? c : undefined;
}

function isBodylessMethod(m: Ref<ClassMember> | undefined, name: Ref<string | Expr>): boolean {
  if (m === undefined || m.kind !== "method" || m.body !== undefined) return false;
  return typeof m.name === "string" && typeof name === "string" && m.name === name;
}

function hasMethodOverloads(members: Ref<ClassMember[]>): boolean {
  for (let i: usize = 0; i < members.length; i++) {
    const m: Ref<ClassMember> = members[i]!;
    let j = i;
    if (m.kind === "method") {
      while (j < members.length && isBodylessMethod(members[j]!, m.name)) j++;
    }
    if (j > i && j < members.length) {
      const impl: Ref<ClassMember> = members[j]!;
      if (impl.kind === "method" && typeof impl.name === "string" && m.kind === "method" && typeof m.name === "string" && impl.name === m.name && impl.body !== undefined) {
        return true;
      }
    }
  }
  return false;
}

/** @throws {CompileError} */
function lowerMembers(ids: Mut<Ids>, rewrites: Mut<Rewrites>, c: Ref<ClassNode>): ClassMember[] {
  let out: ClassMember[] = [];
  const members: Ref<ClassMember[]> = c.members;
  for (let i: usize = 0; i < members.length; i++) {
    const m: Ref<ClassMember> = members[i]!;
    let j = i;
    if (m.kind === "method") {
      while (j < members.length && isBodylessMethod(members[j]!, m.name)) j++;
    }
    if (j === i || j >= members.length) {
      out.push(cloneClassMember(m));
      continue;
    }
    const impl: Ref<ClassMember> = members[j]!;
    if (impl.kind !== "method" || typeof impl.name !== "string" || m.kind !== "method" || typeof m.name !== "string" || impl.name !== m.name || impl.body === undefined) {
      out.push(cloneClassMember(m));
      continue;
    }
    const implName = impl.name;
    const isStatic = impl.modifiers.includes("static");
    let run: Method[] = [];
    for (let k = i; k < j; k++) run.push(asMethod(members[k]!)!);
    const mixed = run.find((s) => s.modifiers.includes("static") !== isStatic);
    if (mixed !== undefined) throw new CompileError("E0410", `the overload signatures of '${implName}' have to be static or not as its implementation is`, mixed.start, mixed.end);
    if (impl.generator || impl.modifiers.includes("async")) throw unsupported("overloads of async methods and generator methods", span(impl));
    if (isStatic && c.name === undefined) throw unsupported("static method overloads in unnamed classes", span(impl));
    const receiver = (params: Ref<Param[]>): Param | undefined => {
      if (params.length === 0) return undefined;
      const first: Ref<Param> = params[0]!;
      return first.pattern.kind === "ident" && first.pattern.name === "this" ? cloneParam(first) : undefined;
    };
    const own = receiver(impl.params);
    let wrappers: Method[] = [];
    let overloadNames: string[] = [];
    for (let n: usize = 0; run.length > 0; n++) {
      let sig = run.shift()!;
      const mine = receiver(sig.params);
      if (mine !== undefined) sig.params.shift();
      const params = signatureParams(ids, sig.params);
      let args: Expr[] = [];
      for (const p of params) args.push(argument(ids, p));
      const object: Expr = isStatic ? { id: nextId(ids), kind: "ident", name: c.name!, start: sig.start, end: sig.end } : { id: nextId(ids), kind: "this", start: sig.start, end: sig.end };
      const call: Expr = { id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "member", object, name: implName, optional: false, start: sig.start, end: sig.end }, typeArgs: [], args, optional: false, implementation: true, start: sig.start, end: sig.end };
      const self = mine !== undefined ? mine : own !== undefined ? renumberParam(cloneParam(own), () => nextId(ids)) : undefined;
      const throws = sig.throws !== undefined ? sig.throws : impl.throws !== undefined ? renumberTypeNode(cloneTypeNode(impl.throws), () => nextId(ids)) : undefined;
      const [retType, body] = wrapped(ids, sig.start, sig.end, sig.returnType, call);
      const overloadName = `${implName} overload ${n + 1}`;
      overloadNames.push(overloadName);
      sig.id = nextId(ids);
      sig.name = overloadName;
      sig.params = self !== undefined ? [self, ...params] : params;
      sig.returnType = retType;
      sig.body = body;
      sig.signature = true;
      sig.throws = throws;
      wrappers.push(sig);
    }
    for (let w = wrappers; w.length > 0; ) out.push(w.shift()!);
    let implClone = asMethod(impl)!;
    implClone.overloadNames = overloadNames;
    out.push(rewrites.replaceClassMember(impl, implClone));
    i = j;
  }
  return out;
}

// A signature's parameters as its function's: a destructured one named, since it is only passed on.
/** @throws {CompileError} */
function signatureParams(ids: Mut<Ids>, sigParams: Param[]): Param[] {
  let out: Param[] = [];
  for (let i: usize = 0; sigParams.length > 0; i++) {
    let param = sigParams.shift()!;
    if (param.default !== undefined) throw new CompileError("E0410", "an overload signature can't give a parameter a default; give it in the implementation", param.default.start, param.default.end);
    if (param.pattern.kind !== "ident") {
      param.id = nextId(ids);
      param.pattern = { id: nextId(ids), kind: "ident", name: `argument ${i}`, start: param.pattern.start, end: param.pattern.end };
    }
    out.push(param);
  }
  return out;
}

function argument(ids: Mut<Ids>, p: Ref<Param>): Expr {
  const pname = p.pattern.kind === "ident" ? p.pattern.name : "";
  const name: Expr = { id: nextId(ids), kind: "ident", name: pname, start: p.start, end: p.end };
  return p.rest ? { id: nextId(ids), kind: "spread", value: name, start: p.start, end: p.end } : name;
}

// The signature's body: the implementation's call, its value given as the signature's type.
/** @throws {CompileError} */
function wrapped(ids: Mut<Ids>, start: usize, end: usize, returnType: TypeNode | undefined, call: Expr): [TypeNode | undefined, Stmt[]] {
  if (returnType === undefined) throw new CompileError("E0410", "an overload signature needs its return type, as in 'function f(x: string): string;'", start, end);
  if (returnType.kind === "ref" && returnType.name === "void" && returnType.args.length === 0) {
    return [returnType, [{ id: nextId(ids), kind: "expr", expr: call, start, end }]];
  }
  const [ret1, ret2] = dup(returnType);
  const value: Expr = { id: nextId(ids), kind: "nonNull", expr: call, narrows: ret2, start, end };
  return [ret1, [{ id: nextId(ids), kind: "return", value, start, end }]];
}

function span(at: Ref<Span>): Span {
  return { start: at.start, end: at.end };
}
