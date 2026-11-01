import { CompileError } from "./diag.ts";
import { nextId, renumber, walk, type Ids } from "./nodes.ts";
import type { ClassMember, ClassNode, Expr, Func, Param, Span, Stmt, TypeNode } from "./parser.ts";
import { unsupported } from "./unsupported.ts";

// Overload signatures are the bodyless declarations of a name right before its implementation.
// Each becomes a function of its own, named apart, whose body calls the implementation and gives
// what it returns as the signature's return type, narrowed at run time where the implementation's
// is wider. The implementation lists them in order, as a call tries them, and only a signature's
// own body calls it directly.

// The implementation's call in a signature's body, which no overload is chosen for.
export type Direct = { implementation?: true };

type Method = Extract<ClassMember, { kind: "method" }>;

export function lowerOverloads(ids: Ids, program: Stmt[]): Stmt[] {
  const out: Stmt[] = [];
  for (let i = 0; i < program.length; i++) {
    const s = program[i]!;
    const f = functionOf(s);
    const run: Func[] = [];
    let j = i;
    while (f && !f.body && !f.js && functionOf(program[j])?.name === f.name && !functionOf(program[j])!.body) run.push(functionOf(program[j++])!);
    const impl = functionOf(program[j]);
    if (run.length === 0 || !impl?.body || impl.name !== f!.name || impl.js) {
      out.push(s);
      continue;
    }
    if (impl.async || impl.generator) throw unsupported("overloads of async functions and generators", impl);
    const wrappers = run.map((sig, n) => {
      const params = signatureParams(ids, sig);
      const call: Expr = { id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "ident", name: impl.name, ...span(sig) }, typeArgs: [], args: params.map((p) => argument(ids, p)), optional: false, ...span(sig) };
      Object.assign(call, { implementation: true });
      return Object.assign({ ...sig, id: nextId(ids), name: `${impl.name} overload ${n + 1}`, params, body: wrapped(ids, sig, call), ...(sig.throws ?? impl.throws ? { throws: sig.throws ?? impl.throws } : {}) }, { signature: true as const });
    });
    out.push(program[j]!, ...wrappers);
    Object.assign(impl, { overloads: wrappers });
    i = j;
  }
  holdsClasses(ids, out);
  return out;
}

function functionOf(s: Stmt | undefined): Func | undefined {
  if (s?.kind === "function") return s;
  if (s?.kind === "export" && s.body.kind === "function") return s.body;
  return undefined;
}

// Every class, declared or written as an expression, has its method overloads lowered.
function holdsClasses(ids: Ids, program: Stmt[]) {
  walk("stmt", program, ({ of, node: c }) => {
    if ((of === "stmt" || of === "expr") && c.kind === "class") c.members = lowerMembers(ids, c);
  });
}

function lowerMembers(ids: Ids, c: ClassNode): ClassMember[] {
  const out: ClassMember[] = [];
  const members = c.members;
  const bodyless = (m: ClassMember | undefined, name: unknown): m is Method => m?.kind === "method" && !m.body && m.name === name && typeof name === "string";
  for (let i = 0; i < members.length; i++) {
    const m = members[i]!;
    let j = i;
    while (m.kind === "method" && bodyless(members[j], m.name)) j++;
    const impl = members[j];
    if (j === i || impl?.kind !== "method" || impl.name !== (m as Method).name || !impl.body) {
      out.push(m);
      continue;
    }
    const isStatic = impl.modifiers.includes("static");
    const run = members.slice(i, j) as Method[];
    const mixed = run.find((s) => s.modifiers.includes("static") !== isStatic);
    if (mixed) throw new CompileError(`the overload signatures of '${impl.name as string}' have to be static or not as its implementation is`, mixed.start, mixed.end);
    if (impl.generator || impl.modifiers.includes("async")) throw unsupported("overloads of async methods and generator methods", impl);
    if (isStatic && c.name === undefined) throw unsupported("static method overloads in unnamed classes", impl);
    const receiver = (p: Param | undefined) => (p?.pattern.kind === "ident" && p.pattern.name === "this" ? p : undefined);
    const own = receiver(impl.params[0]);
    const wrappers = run.map((sig, n): Method => {
      const mine = receiver(sig.params[0]);
      const params = signatureParams(ids, { params: mine ? sig.params.slice(1) : sig.params });
      const object: Expr = isStatic ? { id: nextId(ids), kind: "ident", name: c.name!, ...span(sig) } : { id: nextId(ids), kind: "this", ...span(sig) };
      const call: Expr = { id: nextId(ids), kind: "call", callee: { id: nextId(ids), kind: "member", object, name: impl.name as string, optional: false, ...span(sig) }, typeArgs: [], args: params.map((p) => argument(ids, p)), optional: false, ...span(sig) };
      Object.assign(call, { implementation: true });
      const self = mine ?? (own && renumber("param", structuredClone(own), () => nextId(ids)));
      return Object.assign({ ...sig, id: nextId(ids), name: `${impl.name as string} overload ${n + 1}`, params: self ? [self, ...params] : params, body: wrapped(ids, sig, call), ...(sig.throws ?? impl.throws ? { throws: sig.throws ?? impl.throws } : {}) }, { signature: true as const });
    });
    out.push(...wrappers, impl);
    Object.assign(impl, { overloads: wrappers });
    i = j;
  }
  return out;
}

// A signature's parameters as its function's: a destructured one named, since it is only passed on.
function signatureParams(ids: Ids, sig: { params: Param[] }): Param[] {
  return sig.params.map((p, i) => {
    if (p.default) throw new CompileError("an overload signature can't give a parameter a default; give it in the implementation", p.default.start, p.default.end);
    return p.pattern.kind === "ident" ? p : { ...p, id: nextId(ids), pattern: { id: nextId(ids), kind: "ident", name: `argument ${i}`, ...span(p.pattern) } };
  });
}

function argument(ids: Ids, p: Param): Expr {
  const name: Expr = { id: nextId(ids), kind: "ident", name: (p.pattern as { name: string }).name, ...span(p) };
  return p.rest ? { id: nextId(ids), kind: "spread", value: name, ...span(p) } : name;
}

// The signature's body: the implementation's call, its value given as the signature's type.
function wrapped(ids: Ids, sig: Span & { returnType: TypeNode | undefined }, call: Expr): Stmt[] {
  const returns = sig.returnType;
  if (!returns) throw new CompileError("an overload signature needs its return type, as in 'function f(x: string): string;'", sig.start, sig.end);
  if (returns.kind === "ref" && returns.name === "void" && returns.args.length === 0) return [{ id: nextId(ids), kind: "expr", expr: call, ...span(sig) }];
  const value: Expr = { id: nextId(ids), kind: "nonNull", expr: call, narrows: returns, ...span(sig) };
  return [{ id: nextId(ids), kind: "return", value, ...span(sig) }];
}

function span(at: Span): Span {
  return { start: at.start, end: at.end };
}
