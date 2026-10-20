import { CompileError } from "./diag.ts";
import type { EnumMember, Expr, Span } from "./parser.ts";
import { literalType, unionType, type LiteralType, type Type } from "./typing.ts";
import { unsupported } from "./unsupported.ts";

// A C-like enum: named integer or string values, numbered on from the last integer as in
// TypeScript. Each member is a literal that knows its enum, so a plain literal never becomes
// one, while a member still reads as its i64 value. The enum is the union of its members.
export type EnumInfo = { type: Type; members: Map<string, LiteralType> };

export function declareEnum(node: Span & { name: string; const: boolean; members: EnumMember[] }): EnumInfo {
  if (node.const) throw unsupported("const enums", node);
  const members = new Map<string, LiteralType>();
  let next: bigint | undefined = 0n;
  for (const m of node.members) {
    if (members.has(m.name)) throw new CompileError(`duplicate enum member '${m.name}'`, m.start, m.end);
    const value: bigint | string | undefined = m.init ? constant(m.init) : next;
    if (value === undefined) throw new CompileError(`enum member '${m.name}' must have an initializer`, m.start, m.end);
    members.set(m.name, literalType(value, { enum: node.name, member: m.name }));
    next = typeof value === "bigint" ? value + 1n : undefined;
  }
  return { type: unionType([...members.values()], node.name), members };
}

function constant(e: Expr): bigint | string {
  if (e.kind === "int" || e.kind === "string") return e.value;
  if (e.kind === "unary" && e.op === "-" && e.operand.kind === "int") return -e.operand.value;
  throw unsupported("computed enum members", e);
}
