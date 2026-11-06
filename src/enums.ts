import type { Compilation } from "./compilation.ts";
import { CompileError } from "./diag.ts";
import type { EnumMember, Expr, Span, TypeParam } from "./parser.ts";
import { nextId, renumberExpr, Rewrites, walkWhile, type Ids } from "./nodes.ts";
import { cloneEnumMember, cloneExpr, rebuiltExpr } from "./rebuild.ts";
import type { LiteralType, Type, VariantType } from "./typing.ts";

// A C-like enum: named integer or string values, numbered on from the last integer as in
// TypeScript. Each member is a literal that knows its enum, so a plain literal never becomes
// one, while a member still reads as its i64 value. The enum is the union of its members.
// One with computed members is `pending` until first read, and is read through `enumType` and
// `enumMemberOf`, which settle it.
export type EnumInfo = { type: Type; members: Map<string, LiteralType>; data?: DataEnum; pending?: PendingEnum };

// An enum whose initializers run while compiling. While they run, `settling` is set and the
// enum's `members` are those computed so far.
export type PendingEnum = { node: EnumNode; id: usize; names: Set<string>; settling: boolean };

// An enum whose members may hold values: a union of variants, made once per set of type
// arguments, since its payload types may name its type parameters.
// `eq` marks one that `@derive(Eq)` lets `===` compare, and `json` one `@derive(Json)` lets
// `JSON` write and read.
export type DataEnum = { name: string; id: usize; params: string[]; members: EnumMember[]; at: Span; eq: boolean; json: boolean };
export type EnumInstance = { type: Type; variants: Map<string, VariantType> };

type EnumNode = Span & { name: string; const: boolean; typeParams: TypeParam[]; members: EnumMember[]; derives?: string[] };

// What settles an enum: it holds the enums by name and computes an initializer's value. An enum
// is read again by name at each step, since computing a value may read any enum, this one too.
export interface EnumHost {
  enums: Map<string, EnumInfo>;
  compilation: Compilation;
  /** @throws {CompileError} */
  enumMemberValue(this: Mut<this>, owner: string, member: string, init: Expr): unknown;
}

// Each enum's id tells enums of one name apart: their members are literals of the same values.
/** @throws {CompileError} */
export function declareEnum(compilation: Mut<Compilation>, node: Ref<EnumNode>): EnumInfo {
  if (node.typeParams.length > 0 || node.members.some((m) => m.payload !== undefined)) return dataEnum(node, compilation.counts.enums++);
  let seen = new Set<string>();
  for (const m of node.members) {
    if (seen.has(m.name)) throw new CompileError("E0707", `duplicate enum member '${m.name}'`, m.start, m.end);
    seen.add(m.name);
  }
  const id = compilation.counts.enums++;
  // A computed member may read another enum's, declared later perhaps, so the enum is settled
  // when it is first read.
  const kept: EnumNode = { start: node.start, end: node.end, name: node.name, const: node.const, typeParams: [], members: node.members.map((m) => cloneEnumMember(m)) };
  if (node.members.some((m) => m.init !== undefined && literal(m.init) === undefined)) return { type: "never", members: new Map(), pending: { node: kept, id, names: seen, settling: false } };
  let members = new Map<string, LiteralType>();
  let next: bigint | undefined = 0n;
  for (const m of node.members) {
    const value = m.init !== undefined ? literal(m.init) : next;
    next = member(compilation, kept, id, m, value, members);
  }
  return finished(compilation, node.name, members);
}

// Settles the pending enum `name`, if it is one.
/** @throws {CompileError} */
export function settleEnum<H extends EnumHost>(host: Mut<H>, name: string): void {
  const info = host.enums.get(name);
  if (info === undefined || info.pending === undefined) return;
  const p = info.pending;
  if (p.settling) {
    const [start, end] = innermost(host.compilation, p.node);
    throw new CompileError("E0707", `enum '${p.node.name}' is used while its members are being computed; give its members values that don't depend on the enum itself`, start, end);
  }
  host.enums.set(name, { type: info.type, members: new Map(), pending: { node: cloneEnumNode(p.node), id: p.id, names: new Set([...p.names]), settling: true } });
  let done = false;
  try {
    let next: bigint | undefined = 0n;
    for (const m of p.node.members) {
      let value = m.init !== undefined ? literal(m.init) : next;
      if (m.init !== undefined && value === undefined) value = computed(host, p.node, m, m.init);
      let now = host.enums.get(name)!;
      next = member(host.compilation, p.node, p.id, m, value, now.members);
      host.enums.set(name, now);
    }
    host.enums.set(name, finished(host.compilation, p.node.name, host.enums.get(name)!.members));
    done = true;
  } finally {
    // A failed settle starts again from nothing, since the checker may retry the pass that read it.
    if (!done) host.enums.set(name, { type: info.type, members: new Map(), pending: { node: cloneEnumNode(p.node), id: p.id, names: new Set([...p.names]), settling: false } });
  }
}

// An enum's type, once it is settled.
/** @throws {CompileError} */
export function enumType<H extends EnumHost>(host: Mut<H>, name: string): Type {
  settleEnum(host, name);
  return host.enums.get(name)!.type;
}

// An enum's member, once it is settled. While the enum is settling, reading a member not
// computed yet means a value depending on itself, or on a member declared after it.
/** @throws {CompileError} */
export function enumMemberOf<H extends EnumHost>(host: Mut<H>, name: string, member: string): LiteralType | undefined {
  const info = host.enums.get(name)!;
  const p = info.pending;
  if (p === undefined || !p.settling) {
    settleEnum(host, name);
    return host.enums.get(name)!.members.get(member);
  }
  if (p.names.has(member) && !info.members.has(member)) {
    const [start, end, inner] = innermost(host.compilation, p.node);
    throw new CompileError("E0707", `enum member '${inner}' uses '${p.node.name}.${member}', which isn't computed yet; an initializer can only use members declared before it, and no value can depend on itself`, start, end);
  }
  return info.members.get(member);
}

// The names of an enum's members, once it is settled, or those computed so far while it settles.
/** @throws {CompileError} */
export function enumMemberNames<H extends EnumHost>(host: Mut<H>, name: string): string[] {
  const p = host.enums.get(name)!.pending;
  if (p === undefined || !p.settling) settleEnum(host, name);
  return [...host.enums.get(name)!.members.keys()];
}

function cloneEnumNode(node: Ref<EnumNode>): EnumNode {
  return { start: node.start, end: node.end, name: node.name, const: node.const, typeParams: [], members: node.members.map((m) => cloneEnumMember(m)) };
}

// The innermost initializer being computed, as the span and name an error points at.
function innermost(compilation: Ref<Compilation>, node: Ref<EnumNode>): [usize, usize, string] {
  const last = compilation.enumInits.at(-1);
  return last !== undefined ? [last[0], last[1], last[2]] : [node.start, node.end, node.name];
}

// Adds member `m` of value `value` to `members`, giving the value the next member takes unless
// it has an initializer of its own.
/** @throws {CompileError} */
function member(compilation: Mut<Compilation>, node: Ref<EnumNode>, id: usize, m: Ref<EnumMember>, value: bigint | string | undefined, members: Mut<Map<string, LiteralType>>): bigint | undefined {
  if (value === undefined) throw new CompileError("E0707", `enum member '${m.name}' must have an initializer`, m.start, m.end);
  if (typeof value === "bigint" && (value > I64_MAX || value < -I64_MAX - 1n)) {
    throw new CompileError("E0707", `enum member '${m.name}' is ${value}, which does not fit in i64`, m.start, m.end);
  }
  members.set(m.name, compilation.typing.literalType(value, { enum: node.name, member: m.name, id }));
  return typeof value === "bigint" ? value + 1n : undefined;
}

// A settled enum: the union of its members, each knowing it.
function finished(compilation: Mut<Compilation>, name: string, members: Ref<Map<string, LiteralType>>): EnumInfo {
  const type = compilation.typing.unionType([...members.values()], name);
  for (const m of members.values()) {
    let r = compilation.typing.rec(m);
    if (r.owner !== undefined) r.owner.of = type;
    compilation.typing.setRec(m, r);
  }
  return { type, members: new Map([...members]) };
}

// A computed initializer's value, where a bare name of one of the enum's members means that
// member, as in TypeScript.
/** @throws {CompileError} */
function computed<H extends EnumHost>(host: Mut<H>, node: Ref<EnumNode>, m: Ref<EnumMember>, init: Ref<Expr>): bigint | string {
  let names = new Set<string>();
  for (const x of node.members) names.add(x.name);
  host.compilation.enumInits.push([init.start, init.end, m.name]);
  let value: unknown = undefined;
  try {
    value = host.enumMemberValue(node.name, m.name, qualified(host.compilation.ids, init, node.name, names));
  } finally {
    host.compilation.enumInits.pop();
  }
  if (typeof value === "bigint" || typeof value === "string") return value;
  if (typeof value === "number") throw new CompileError("E0707", `enum member '${m.name}' is ${value}, a float; a numeric enum holds i64 values, so give it an integer`, init.start, init.end);
  throw new CompileError("E0707", `enum member '${m.name}' must be an integer or a string`, init.start, init.end);
}

// A copy of an initializer with the enum's own bare member names qualified. Functions inside
// it bind their own names, and the parsed tree is never changed, since it may be cached. Each
// node copied gets an id of its own.
function qualified(ids: Mut<Ids>, init: Ref<Expr>, enumName: string, names: Ref<Set<string>>): Expr {
  let rewrites = new Rewrites();
  walkWhile({ of: "expr", node: init }, (n) => {
    if (n.of === "expr" && (n.node.kind === "arrow" || n.node.kind === "function" || n.node.kind === "class")) return false;
    if (n.of === "expr" && n.node.kind === "ident" && names.has(n.node.name)) {
      const at = { start: n.node.start, end: n.node.end };
      rewrites.replace(n.node, { id: n.node.id, kind: "member", object: { id: nextId(ids), kind: "ident", name: enumName, ...at }, name: n.node.name, optional: false, ...at });
    }
    if (n.of === "objectProp" && n.node.kind === "shorthand" && names.has(n.node.name)) {
      const at = { start: n.node.start, end: n.node.end };
      const read: Expr = { id: nextId(ids), kind: "member", object: { id: nextId(ids), kind: "ident", name: enumName, ...at }, name: n.node.name, optional: false, ...at };
      rewrites.replaceObjectProp(n.node, { id: n.node.id, kind: "property", key: n.node.name, value: read, ...at });
    }
    return true;
  });
  return renumberExpr(rebuiltExpr(cloneExpr(init), rewrites), () => nextId(ids));
}

// An enum either names values or holds data, never both, so each member means one thing.
/** @throws {CompileError} */
function dataEnum(node: Ref<EnumNode>, id: usize): EnumInfo {
  let seen = new Set<string>();
  for (const m of node.members) {
    if (seen.has(m.name)) throw new CompileError("E0707", `duplicate enum member '${m.name}'`, m.start, m.end);
    seen.add(m.name);
    if (m.init !== undefined) throw new CompileError("E0707", `enum '${node.name}' mixes members with values and members holding data; split it into two enums`, m.start, m.end);
  }
  const params = node.typeParams.map((p) => p.name);
  const derives: string[] = node.derives !== undefined ? [...node.derives] : [];
  return { type: "never", members: new Map(), data: { name: node.name, id, params, members: node.members.map((m) => cloneEnumMember(m)), at: { start: node.start, end: node.end }, eq: derives.includes("Eq"), json: derives.includes("Json") } };
}

const I64_MAX = (1n << 63n) - 1n;

// A literal initializer's value, which needs no comptime run.
function literal(e: Ref<Expr>): bigint | string | undefined {
  if (e.kind === "int" || e.kind === "string") return e.value;
  if (e.kind === "unary" && e.op === "-" && e.operand.kind === "int") return -e.operand.value;
  return undefined;
}
