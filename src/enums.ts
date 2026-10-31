import type { Compilation } from "./compilation.ts";
import { CompileError } from "./diag.ts";
import type { EnumMember, Expr, Span, TypeParam } from "./parser.ts";
import type { LiteralType, Type, VariantType } from "./typing.ts";
import { unsupported } from "./unsupported.ts";

// A C-like enum: named integer or string values, numbered on from the last integer as in
// TypeScript. Each member is a literal that knows its enum, so a plain literal never becomes
// one, while a member still reads as its i64 value. The enum is the union of its members.
export type EnumInfo = { type: Type; members: Map<string, LiteralType>; data?: DataEnum };

// An enum whose members may hold values: a union of variants, made once per set of type
// arguments, since its payload types may name its type parameters.
// `eq` marks one that `@derive(Eq)` lets `===` compare, and `json` one `@derive(Json)` lets
// `JSON` write and read.
export type DataEnum = { name: string; id: number; params: string[]; members: EnumMember[]; instances: Map<string, EnumInstance>; at: Span; eq: boolean; json: boolean };
export type EnumInstance = { type: Type; variants: Map<string, VariantType> };

type EnumNode = Span & { name: string; const: boolean; typeParams: TypeParam[]; members: EnumMember[]; derives?: string[] };

// Each enum's id tells enums of one name apart: their members are literals of the same values.
export function declareEnum({ typing, counts }: Compilation, node: EnumNode): EnumInfo {
  const { literalType, unionType } = typing;
  if (node.const) throw unsupported("const enums", node);
  if (node.typeParams.length > 0 || node.members.some((m) => m.payload)) return dataEnum(node, counts.enums++);
  const members = new Map<string, LiteralType>();
  const id = counts.enums++;
  let next: bigint | undefined = 0n;
  for (const m of node.members) {
    if (members.has(m.name)) throw new CompileError(`duplicate enum member '${m.name}'`, m.start, m.end);
    const value: bigint | string | undefined = m.init ? constant(m.init) : next;
    if (value === undefined) throw new CompileError(`enum member '${m.name}' must have an initializer`, m.start, m.end);
    if (typeof value === "bigint" && (value > I64_MAX || value < -I64_MAX - 1n)) {
      throw new CompileError(`enum member '${m.name}' is ${value}, which does not fit in i64`, m.start, m.end);
    }
    members.set(m.name, literalType(value, { enum: node.name, member: m.name, id }));
    next = typeof value === "bigint" ? value + 1n : undefined;
  }
  const type = unionType([...members.values()], node.name);
  for (const member of members.values()) member.owner!.of = type;
  return { type, members };
}

// An enum either names values or holds data, never both, so each member means one thing.
function dataEnum(node: EnumNode, id: number): EnumInfo {
  const seen = new Set<string>();
  for (const m of node.members) {
    if (seen.has(m.name)) throw new CompileError(`duplicate enum member '${m.name}'`, m.start, m.end);
    seen.add(m.name);
    if (m.init) throw new CompileError(`enum '${node.name}' mixes members with values and members holding data; split it into two enums`, m.start, m.end);
  }
  const params = node.typeParams.map((p) => p.name);
  const derives = node.derives ?? [];
  return { type: "never", members: new Map(), data: { name: node.name, id, params, members: node.members, instances: new Map(), at: node, eq: derives.includes("Eq"), json: derives.includes("Json") } };
}

const I64_MAX = (1n << 63n) - 1n;

function constant(e: Expr): bigint | string {
  if (e.kind === "int" || e.kind === "string") return e.value;
  if (e.kind === "unary" && e.op === "-" && e.operand.kind === "int") return -e.operand.value;
  throw unsupported("computed enum members", e);
}
