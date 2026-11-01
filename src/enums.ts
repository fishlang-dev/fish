import type { Compilation } from "./compilation.ts";
import { CompileError } from "./diag.ts";
import type { EnumMember, Expr, Span, TypeParam } from "./parser.ts";
import { nextId, type Ids } from "./nodes.ts";
import type { LiteralType, Type, VariantType } from "./typing.ts";

// A C-like enum: named integer or string values, numbered on from the last integer as in
// TypeScript. Each member is a literal that knows its enum, so a plain literal never becomes
// one, while a member still reads as its i64 value. The enum is the union of its members.
export type EnumInfo = { type: Type; members: Map<string, LiteralType>; data?: DataEnum };

// An enum whose members may hold values: a union of variants, made once per set of type
// arguments, since its payload types may name its type parameters.
// `eq` marks one that `@derive(Eq)` lets `===` compare, and `json` one `@derive(Json)` lets
// `JSON` write and read.
export type DataEnum = { name: string; id: usize; params: string[]; members: EnumMember[]; instances: Map<string, EnumInstance>; at: Span; eq: boolean; json: boolean };
export type EnumInstance = { type: Type; variants: Map<string, VariantType> };

type EnumNode = Span & { name: string; const: boolean; typeParams: TypeParam[]; members: EnumMember[]; derives?: string[] };

// What an initializer that isn't a literal is worth, computed while compiling.
export type Evaluate = (enumName: string, member: string, init: Expr) => unknown;

// Each enum's id tells enums of one name apart: their members are literals of the same values.
export function declareEnum(compilation: Compilation, node: EnumNode, evaluate: Evaluate): EnumInfo {
  const { counts } = compilation;
  if (node.typeParams.length > 0 || node.members.some((m) => m.payload)) return dataEnum(node, counts.enums++);
  const seen = new Set<string>();
  for (const m of node.members) {
    if (seen.has(m.name)) throw new CompileError("E0707", `duplicate enum member '${m.name}'`, m.start, m.end);
    seen.add(m.name);
  }
  const id = counts.enums++;
  if (node.members.every((m) => !m.init || literal(m.init) !== undefined)) return settle(compilation, node, id, new Map(), evaluate);
  // A computed member may read another enum's, declared later perhaps, so the enum is settled
  // when it is first read.
  let settled: EnumInfo | undefined;
  let members: Unsettled | undefined;
  const info = () => {
    if (settled) return settled;
    if (members) {
      const [start, end] = innermost(compilation, node);
      throw new CompileError("E0707", `enum '${node.name}' is used while its members are being computed; give its members values that don't depend on the enum itself`, start, end);
    }
    members = new Unsettled(compilation, node, seen);
    // A failed settle starts again from nothing, since the checker may retry the pass that read it.
    try {
      return (settled = settle(compilation, node, id, members, evaluate));
    } finally {
      if (!settled) members = undefined;
    }
  };
  return {
    get type() { return info().type; },
    get members() { return members && !settled ? members : info().members; },
  };
}

// The members of an enum being settled: reading one not yet computed means a value depending on
// itself, or on a member declared after it.
class Unsettled extends Map<string, LiteralType> {
  readonly compilation: Compilation;
  readonly node: EnumNode;
  readonly names: Set<string>;
  constructor(compilation: Compilation, node: EnumNode, names: Set<string>) {
    super();
    this.compilation = compilation;
    this.node = node;
    this.names = names;
  }
  override get(name: string): LiteralType | undefined {
    this.ready(name);
    return super.get(name);
  }
  override has(name: string): boolean {
    this.ready(name);
    return super.has(name);
  }
  ready(name: string) {
    if (!this.names.has(name) || super.has(name)) return;
    const [start, end, member] = innermost(this.compilation, this.node);
    throw new CompileError("E0707", `enum member '${member}' uses '${this.node.name}.${name}', which isn't computed yet; an initializer can only use members declared before it, and no value can depend on itself`, start, end);
  }
}

// The innermost initializer being computed, as the span and name an error points at.
const innermost = ({ enumInits }: Compilation, node: EnumNode): [usize, usize, string] => enumInits.at(-1) ?? [node.start, node.end, node.name];

function settle(compilation: Compilation, node: EnumNode, id: usize, members: Map<string, LiteralType>, evaluate: Evaluate): EnumInfo {
  const typing = compilation.typing;
  let next: bigint | undefined = 0n;
  for (const m of node.members) {
    let value: bigint | string | undefined = m.init ? literal(m.init) : next;
    if (m.init && value === undefined) value = computed(compilation, node, m, m.init, evaluate);
    if (value === undefined) throw new CompileError("E0707", `enum member '${m.name}' must have an initializer`, m.start, m.end);
    if (typeof value === "bigint" && (value > I64_MAX || value < -I64_MAX - 1n)) {
      throw new CompileError("E0707", `enum member '${m.name}' is ${value}, which does not fit in i64`, m.start, m.end);
    }
    members.set(m.name, typing.literalType(value, { enum: node.name, member: m.name, id }));
    next = typeof value === "bigint" ? value + 1n : undefined;
  }
  const type = typing.unionType([...members.values()], node.name);
  for (const member of members.values()) typing.rec(member).owner!.of = type;
  return { type, members: new Map(members) };
}

// A computed initializer's value, where a bare name of one of the enum's members means that
// member, as in TypeScript.
function computed({ enumInits, ids }: Compilation, node: EnumNode, m: EnumMember, init: Expr, evaluate: Evaluate): bigint | string {
  const names = new Set(node.members.map((x) => x.name));
  enumInits.push([init.start, init.end, m.name]);
  let value: unknown;
  try {
    value = evaluate(node.name, m.name, qualified(ids, init, node.name, names) as Expr);
  } finally {
    enumInits.pop();
  }
  if (typeof value === "bigint" || typeof value === "string") return value;
  if (typeof value === "number") throw new CompileError("E0707", `enum member '${m.name}' is ${value}, a float; a numeric enum holds i64 values, so give it an integer`, init.start, init.end);
  throw new CompileError("E0707", `enum member '${m.name}' must be an integer or a string`, init.start, init.end);
}

// A copy of an initializer with the enum's own bare member names qualified. Functions inside
// it bind their own names, and the parsed tree is never changed, since it may be cached. Each
// node copied gets an id of its own.
function qualified(ids: Ids, node: unknown, enumName: string, names: Set<string>): unknown {
  if (Array.isArray(node)) return node.map((n) => qualified(ids, n, enumName, names));
  if (node === null || typeof node !== "object") return node;
  const n = node as { kind?: unknown; name?: unknown; id?: unknown } & Span;
  if (n.kind === "ident" && typeof n.name === "string" && names.has(n.name)) {
    return { id: nextId(ids), kind: "member", object: { id: nextId(ids), kind: "ident", name: enumName, start: n.start, end: n.end }, name: n.name, optional: false, start: n.start, end: n.end };
  }
  if (n.kind === "shorthand" && typeof n.name === "string" && names.has(n.name)) {
    return { id: nextId(ids), kind: "property", key: n.name, value: qualified(ids, { id: nextId(ids), kind: "ident", name: n.name, start: n.start, end: n.end }, enumName, names), start: n.start, end: n.end };
  }
  if (n.kind === "arrow" || n.kind === "function" || n.kind === "class") return node;
  const copy = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, k === "key" ? v : qualified(ids, v, enumName, names)]));
  if (typeof n.id === "number") copy.id = nextId(ids);
  return copy;
}

// An enum either names values or holds data, never both, so each member means one thing.
function dataEnum(node: EnumNode, id: usize): EnumInfo {
  const seen = new Set<string>();
  for (const m of node.members) {
    if (seen.has(m.name)) throw new CompileError("E0707", `duplicate enum member '${m.name}'`, m.start, m.end);
    seen.add(m.name);
    if (m.init) throw new CompileError("E0707", `enum '${node.name}' mixes members with values and members holding data; split it into two enums`, m.start, m.end);
  }
  const params = node.typeParams.map((p) => p.name);
  const derives = node.derives ?? [];
  return { type: "never", members: new Map(), data: { name: node.name, id, params, members: node.members, instances: new Map(), at: node, eq: derives.includes("Eq"), json: derives.includes("Json") } };
}

const I64_MAX = (1n << 63n) - 1n;

// A literal initializer's value, which needs no comptime run.
function literal(e: Expr): bigint | string | undefined {
  if (e.kind === "int" || e.kind === "string") return e.value;
  if (e.kind === "unary" && e.op === "-" && e.operand.kind === "int") return -e.operand.value;
  return undefined;
}
