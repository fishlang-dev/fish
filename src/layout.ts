import type { Builder } from "./arithmetic.ts";
import { category, literalValue, typeofTest } from "./narrow.ts";
import type { Expr } from "./parser.ts";
import { field, fieldPath, membersFor, type ClassType, type ObjectType, type Type, type UnionType } from "./typing.ts";

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
  return { convert, test, matches, unionField };

  // Lowers `typeof x === "name"`, or `x === v` with x a union, to a check of x's tag, and of
  // its payload when v isn't a literal. Undefined for any other comparison.
  function test(e: Expr, value: (e: Expr) => string, typeOf: (e: Expr) => Type): string | undefined {
    if (e.kind !== "binary") return undefined;
    if (e.op === "instanceof") {
      const [type, c] = [typeOf(e.left), typeOf(e.right)];
      const v = value(e.left);
      return typeof type !== "string" && type.kind === "union" ? holds(v, type, [c]) : String(type === c);
    }
    if (e.op !== "===" && e.op !== "!==") return undefined;
    const kind = typeofTest(e);
    let result: string;
    if (kind) {
      const [v, type] = [value(kind.operand), typeOf(kind.operand)];
      const name = (kind.name as { value: string }).value;
      result = typeof type !== "string" && type.kind === "union"
        ? holds(v, type, type.members.filter((m) => category(m) === name))
        : String(category(type) === name);
    } else {
      const [left, right] = [typeOf(e.left), typeOf(e.right)];
      const unionLeft = typeof left !== "string" && left.kind === "union";
      if (!unionLeft && (typeof right === "string" || right.kind !== "union")) return undefined;
      const [u, o] = [value(e.left), value(e.right)];
      const [union, v, other, otherType] = (unionLeft ? [left, u, e.right, right] : [right, o, e.left, left]) as [UnionType, string, Expr, Type];
      result = matches(v, union, other, unionLeft ? o : u, otherType);
    }
    if (e.op === "===") return result;
    const negated = temp();
    emit(`${negated} = xor i1 ${result}, true`);
    return negated;
  }

  // Whether union `v` holds the value of `other`: its literal member, or the primitive member
  // the other value's type goes into, holding the same value.
  function matches(v: string, union: UnionType, other: Expr, o: string, otherType: Type): string {
    const literal = literalValue(other);
    const member = union.members.find((m) => typeof m !== "string" && m.kind === "literal" && m.value === literal);
    return member ? holds(v, union, [member]) : holdsValue(v, union, membersFor(otherType, union).find((m) => typeof m === "string")!, o);
  }

  // A field every member of the union has, read from whichever member it holds.
  function unionField(v: string, union: UnionType, name: string, to: Type): string {
    const result = alloca(llvm(to));
    const tag = temp();
    emit(`${tag} = extractvalue ${llvm(union)} ${v}, 0`);
    const cases = union.members.map(() => label());
    const end = label();
    emit(`switch i32 ${tag}, label %${end} [ ${cases.map((c, i) => `i32 ${i}, label %${c}`).join(" ")} ]`);
    union.members.forEach((member, i) => {
      startBlock(cases[i]!);
      // The checker found the field on every member, so each is an object or an instance.
      const holder = member as ObjectType | ClassType;
      const part = temp();
      emit(`${part} = extractvalue ${llvm(member)} ${payload(v, union, member)}, ${fieldPath(holder, name).join(", ")}`);
      emit(`store ${llvm(to)} ${convert(part, field(holder, name)!.type, to)}, ptr ${result}`);
      emit(`br label %${end}`);
    });
    startBlock(end);
    const out = temp();
    emit(`${out} = load ${llvm(to)}, ptr ${result}`);
    return out;
  }

  // Whether a union holds one of these members.
  function holds(v: string, union: UnionType, members: Type[]): string {
    const tag = temp();
    emit(`${tag} = extractvalue ${llvm(union)} ${v}, 0`);
    let result = "false";
    for (const m of members) {
      const [is, next] = [temp(), temp()];
      emit(`${is} = icmp eq i32 ${tag}, ${union.members.indexOf(m)}`);
      emit(`${next} = or i1 ${result}, ${is}`);
      result = next;
    }
    return result;
  }

  // Whether a union holds this primitive member with value `o`. The payload is compared only
  // when the tag matches, since another member's payload may be partly undefined.
  function holdsValue(v: string, union: UnionType, member: Type, o: string): string {
    const is = holds(v, union, [member]);
    const [same, result] = [temp(), temp()];
    emit(`${same} = icmp eq ${llvm(member)} ${payload(v, union, member)}, ${o}`);
    emit(`${result} = select i1 ${is}, i1 ${same}, i1 false`);
    return result;
  }

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
  // member for it, which may sit at another index. Narrowing to fewer members leaves some
  // that can't be held here, and those get no case.
  function retag(v: string, from: UnionType, to: UnionType): string {
    const result = alloca(llvm(to));
    const tag = temp();
    emit(`${tag} = extractvalue ${llvm(from)} ${v}, 0`);
    const held = from.members.filter((m) => membersFor(m, to).length > 0);
    const cases = held.map(() => label());
    const end = label();
    emit(`switch i32 ${tag}, label %${end} [ ${held.map((m, i) => `i32 ${from.members.indexOf(m)}, label %${cases[i]}`).join(" ")} ]`);
    held.forEach((member, i) => {
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
