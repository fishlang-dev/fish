import type { Builder } from "./arithmetic.ts";
import { field, fieldPath, membersFor, type Type, type UnionType } from "./typing.ts";

// How each type is laid out in LLVM IR, and how a value moves between two types that hold it
// differently.

const PRIMITIVES = { i64: "i64", boolean: "i1", void: "void" };

// An object is a literal struct of its fields, in their sorted order. An instance is a
// literal struct of the base it embeds, if any, then its own fields in declaration order. A
// union is its member's index, then enough 64-bit words for its largest member.
export function llvm(t: Type): string {
  if (typeof t === "string") return PRIMITIVES[t];
  if (t.kind === "union") return `{ i32, [${words(t)} x i64] }`;
  const parts = [...(t.kind === "class" && t.base ? [llvm(t.base)] : []), ...t.fields.map((f) => llvm(f.type))];
  return parts.length === 0 ? "{}" : `{ ${parts.join(", ")} }`;
}

function words(t: UnionType): number {
  return Math.ceil(Math.max(...t.members.map((m) => size(m)[0])) / 8);
}

// A type's size and alignment in bytes, as LLVM lays out its IR type on the 64-bit targets
// Fish supports.
function size(t: Type): [number, number] {
  if (t === "i64") return [8, 8];
  if (t === "boolean") return [1, 1];
  if (typeof t === "string") return [0, 1];
  if (t.kind === "union") {
    const n = words(t);
    return n === 0 ? [4, 4] : [8 + 8 * n, 8];
  }
  const parts = [...(t.kind === "class" && t.base ? [t.base] : []), ...t.fields.map((f) => f.type)].map(size);
  const align = Math.max(1, ...parts.map(([, a]) => a));
  let bytes = 0;
  for (const [n, a] of parts) bytes = Math.ceil(bytes / a) * a + n;
  return [Math.ceil(bytes / align) * align, align];
}

// What converting needs besides emitting: a slot in the function's entry block.
export type Slots = Builder & { alloca(type: string): string };

export function conversions(b: Slots) {
  const { emit, temp, label, startBlock, alloca } = b;
  return { convert };

  // `v`, a value of `from`, as a value of `to`: copied down to fewer fields, built into a class,
  // put into a union, taken out of one, or moved between unions. The checker has made sure
  // `from` fits `to`, through exactly one member when `to` is a union.
  function convert(v: string, from: Type, to: Type): string {
    if (from === to) return v;
    // A literal's value is known, so leaving one makes a constant, and entering one keeps nothing.
    if (typeof from !== "string" && from.kind === "literal" && (typeof to === "string" || to.kind !== "union")) return String(from.value);
    if (typeof to !== "string" && to.kind === "literal") return "zeroinitializer";
    if (typeof to !== "string" && to.kind === "union") {
      return typeof from !== "string" && from.kind === "union" ? retag(v, from, to) : inject(v, from, to);
    }
    if (typeof from !== "string" && from.kind === "union") return payload(v, from, to);
    if (typeof from === "string" || typeof to === "string") return v;
    if (from.kind === "interface" || to.kind === "interface" || from.kind === "param" || to.kind === "param") {
      throw new Error("internal error: an interface or a type parameter reached codegen");
    }
    // A class built from a literal starts with its embedded base, built the same way.
    const embeds = to.kind === "class" && to.base;
    let result = "undef";
    const insert = (part: string, type: Type, i: number) => {
      const next = temp();
      emit(`${next} = insertvalue ${llvm(to)} ${result}, ${llvm(type)} ${part}, ${i}`);
      result = next;
    };
    if (embeds) insert(convert(v, from, embeds), embeds, 0);
    to.fields.forEach((f, i) => {
      const part = temp();
      emit(`${part} = extractvalue ${llvm(from)} ${v}, ${fieldPath(from as Exclude<typeof from, { kind: "literal" | "union" }>, f.name).join(", ")}`);
      insert(convert(part, field(from, f.name)!.type, f.type), f.type, i + (embeds ? 1 : 0));
    });
    return result;
  }

  // Sets the tag of the member `from` goes into, and stores its value as the payload.
  function inject(v: string, from: Type, to: UnionType): string {
    const member = membersFor(from, to)[0]!;
    const slot = alloca(llvm(to));
    emit(`store i32 ${to.members.indexOf(member)}, ptr ${slot}`);
    const value = convert(v, from, member);
    if (typeof member === "string" || member.kind !== "literal") {
      const at = temp();
      emit(`${at} = getelementptr ${llvm(to)}, ptr ${slot}, i32 0, i32 1`);
      emit(`store ${llvm(member)} ${value}, ptr ${at}`);
    }
    const result = temp();
    emit(`${result} = load ${llvm(to)}, ptr ${slot}`);
    return result;
  }

  // The payload of a union known to hold a member of type `to`, or a union of some members.
  function payload(v: string, from: UnionType, to: Type): string {
    if (typeof to !== "string" && to.kind === "literal") return "zeroinitializer";
    const slot = alloca(llvm(from));
    emit(`store ${llvm(from)} ${v}, ptr ${slot}`);
    const at = temp();
    emit(`${at} = getelementptr ${llvm(from)}, ptr ${slot}, i32 0, i32 1`);
    const result = temp();
    emit(`${result} = load ${llvm(to)}, ptr ${at}`);
    return result;
  }

  // Moves a value between unions: each member the source may hold goes into the target's
  // member for it, which may sit at another index.
  function retag(v: string, from: UnionType, to: UnionType): string {
    const result = alloca(llvm(to));
    const tag = temp();
    emit(`${tag} = extractvalue ${llvm(from)} ${v}, 0`);
    const cases = from.members.map(() => label());
    const end = label();
    emit(`switch i32 ${tag}, label %${end} [ ${cases.map((c, i) => `i32 ${i}, label %${c}`).join(" ")} ]`);
    from.members.forEach((member, i) => {
      startBlock(cases[i]!);
      emit(`store ${llvm(to)} ${inject(payload(v, from, member), member, to)}, ptr ${result}`);
      emit(`br label %${end}`);
    });
    startBlock(end);
    const out = temp();
    emit(`${out} = load ${llvm(to)}, ptr ${result}`);
    return out;
  }
}
