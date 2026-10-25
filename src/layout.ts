import type { Builder } from "./arithmetic.ts";
import { category, kindTests, ofKind, typeofTest } from "./narrow.ts";
import type { Expr } from "./parser.ts";
import { baseOf, field, fieldPath, INTEGERS, isInteger, lower, membersFor, unfold, type ClassType, type ObjectType, type Type, type UnionType } from "./typing.ts";

// How each type is laid out in LLVM IR, and how a value moves between two types that hold it
// differently.

const PRIMITIVES: Record<Exclude<Type, object>, string> = {
  i8: "i8", i16: "i16", i32: "i32", i64: "i64", isize: "i64", u8: "i8", u16: "i16", u32: "i32", u64: "i64", usize: "i64",
  f32: "float", f64: "double", boolean: "i1", void: "void", null: "{}", never: "{}", string: "ptr",
};

// An object is a literal struct of its fields, in their sorted order. An instance is a
// literal struct of the base it embeds, if any, then its own fields in declaration order. A
// union is its member's index, then enough 64-bit words for its largest member.
export function llvm(t: Type): string {
  if (typeof t === "string") return PRIMITIVES[t];
  if (t.kind === "ref" || t.kind === "pointer" || t.kind === "handle" || t.kind === "shared" || t.kind === "block" || t.kind === "map" || t.kind === "regex" || t.kind === "recursive") return "ptr";
  if (t.kind === "array") return ARRAY;
  if (t.kind === "fixed") return `[${t.size} x ${llvm(t.element)}]`;
  if (t.kind === "dyn") return DYN;
  if (t.kind === "union") return `{ i32, [${words(t)} x i64] }`;
  // Atomic instructions need whole bytes, so an atomic boolean is a byte.
  if (t.kind === "interior") return t.which === "Lock" ? `{ i32, ${llvm(t.of)} }` : t.which === "Atomic" && lower(t.of) === "boolean" ? "i8" : llvm(t.of);
  const parts = [...(t.kind === "class" && t.base ? [llvm(t.base)] : []), ...(t.kind === "generator" || t.kind === "future" ? t.frame : t.fields).map((f) => llvm(f.type))];
  return parts.length === 0 ? "{}" : `{ ${parts.join(", ")} }`;
}

function words(t: UnionType): number {
  return Math.ceil(Math.max(...t.members.map((m) => size(m)[0])) / 8);
}

// A type's size and alignment in bytes, as LLVM lays out its IR type on the 64-bit targets
// Fish supports.
// An array is its elements' buffer, its length and its capacity, in elements.
export const ARRAY = "{ ptr, i64, i64 }";
// A Dyn is a pointer to its value's block, then to its vtable.
export const DYN = "{ ptr, ptr }";

// A type's size in bytes as it is laid out.
export const byteSize = (t: Type): number => size(t)[0];

function size(t: Type): [number, number] {
  if (typeof t !== "string" && t.kind === "array") return [24, 8];
  if (typeof t !== "string" && t.kind === "fixed") {
    const [bytes, align] = size(t.element);
    return [Math.ceil(bytes / align) * align * t.size, align];
  }
  if (typeof t !== "string" && t.kind === "dyn") return [16, 8];
  if (isInteger(t)) return [INTEGERS[t].bits / 8, INTEGERS[t].bits / 8];
  if (t === "f32") return [4, 4];
  if (t === "f64") return [8, 8];
  if (t === "boolean") return [1, 1];
  if (t === "null" || t === "never") return [0, 1];
  if (t === "string") return [8, 8];
  if (typeof t === "string") return [0, 1];
  if (t.kind === "ref" || t.kind === "pointer" || t.kind === "handle" || t.kind === "shared" || t.kind === "block" || t.kind === "map" || t.kind === "regex" || t.kind === "recursive") return [8, 8];
  // The tag is padded to the 8-byte alignment of the payload words, even when there are none.
  if (t.kind === "union") return [8 + 8 * words(t), 8];
  if (t.kind === "interior" && t.which !== "Lock") return size(t.of);
  const parts = t.kind === "interior" ? [[4, 4] as [number, number], size(t.of)] : [...(t.kind === "class" && t.base ? [t.base] : []), ...(t.kind === "generator" || t.kind === "future" ? t.frame : t.fields).map((f) => f.type)].map(size);
  const align = Math.max(1, ...parts.map(([, a]) => a));
  let bytes = 0;
  for (const [n, a] of parts) bytes = Math.ceil(bytes / a) * a + n;
  return [Math.ceil(bytes / align) * align, align];
}

// What converting needs besides emitting: a slot in the function's entry block.
// `text` gives a pointer to a literal's string block, which lives for the whole program.
// `deep` compares two values of one type holding objects, arrays or instances, part by part.
// `inspect` gives the string `console.log` prints for a value laid out as Node lays one out.
export type Slots = Builder & { alloca(type: string): string; text(value: string): string; deep?(a: string, b: string, type: Type): string; inspect?(v: string, type: Type): string };

// Whether values of a type compare part by part rather than as one word.
export const compound = (t: Type): boolean => typeof t !== "string" && ["object", "class", "array", "fixed", "recursive", "variant"].includes(t.kind);

export function conversions(b: Slots) {
  const { emit, temp, label, startBlock, alloca, deep } = b;
  return { convert, test, equals, unionField, holds };

  // Lowers `typeof x === "name"`, `x instanceof Map` and `Array.isArray(x)`, or `x === v` with
  // x a union, to a check of x's tag, and of its payload when v isn't a literal. Undefined for
  // any other comparison.
  function test(e: Expr, value: (e: Expr) => string, typeOf: (e: Expr) => Type): string | undefined {
    const instance = kindTests.get(e);
    if (instance) {
      const tested = e.kind === "call" ? e.args[0]! : (e as Extract<Expr, { kind: "binary" }>).left;
      const [type, v] = [typeOf(tested), value(tested)];
      return holdsWhere(v, type, (m) => ofKind(m, instance));
    }
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
      result = holdsWhere(v, type, (m) => category(m) === name);
    } else {
      const [left, right] = [typeOf(e.left), typeOf(e.right)];
      const unionLeft = typeof left !== "string" && left.kind === "union";
      if (!unionLeft && (typeof right === "string" || right.kind !== "union")) return undefined;
      const [u, o] = [value(e.left), value(e.right)];
      result = equals(u, left, o, right);
    }
    if (e.op === "===") return result;
    const negated = temp();
    emit(`${negated} = xor i1 ${result}, true`);
    return negated;
  }

  // Whether two values are equal, as JavaScript's `===` would find them. A union is compared
  // by the member it holds, so only that member's payload is read; literals compare by value,
  // so two enum members that share a value are equal.
  function equals(a: string, aType: Type, b: string, bType: Type): string {
    // A member that holds itself is compared as what its block holds, unless both sides are it.
    if (typeof aType !== "string" && aType.kind === "recursive" && aType !== bType) {
      const loaded = temp();
      emit(`${loaded} = load ${llvm(aType.of)}, ptr ${a}`);
      return equals(loaded, aType.of, b, bType);
    }
    if (typeof bType !== "string" && bType.kind === "recursive" && aType !== bType) return equals(b, bType, a, aType);
    if (typeof aType !== "string" && aType.kind === "union") {
      return eachMember(a, aType, "boolean", (part, m) => equals(part, m, b, bType));
    }
    if (typeof bType !== "string" && bType.kind === "union") return equals(b, bType, a, aType);
    const value = (t: Type, v: string) => (typeof t !== "string" && t.kind === "literal" ? String(t.value) : v);
    const base = (t: Type) => (typeof t !== "string" && t.kind === "literal" ? (baseOf(t) ?? t) : t);
    if (typeof aType !== "string" && aType.kind === "literal" && typeof bType !== "string" && bType.kind === "literal") {
      return String(aType.value === bType.value);
    }
    if (base(aType) === base(bType) && compound(aType) && deep) return deep(a, b, aType);
    if (base(aType) !== base(bType) || typeof base(aType) !== "string") return "false";
    if (base(aType) === "null") return "true";
    if (base(aType) === "string") {
      const order = temp();
      emit(`${order} = call i32 @fsh_rt_str_compare(ptr ${convert(a, aType, "string")}, ptr ${convert(b, bType, "string")})`);
      const same = temp();
      emit(`${same} = icmp eq i32 ${order}, 0`);
      return same;
    }
    const result = temp();
    const float = base(aType) === "f32" || base(aType) === "f64";
    emit(`${result} = ${float ? "fcmp oeq" : "icmp eq"} ${llvm(base(aType))} ${value(aType, a)}, ${value(bType, b)}`);
    return result;
  }

  // A field every member of the union has, read from whichever member it holds.
  function unionField(v: string, union: UnionType, name: string, to: Type): string {
    return eachMember(v, union, to, (part, member) => {
      // The checker found the field on every member, so each is an object or an instance.
      const holder = member as ObjectType | ClassType;
      const value = temp();
      emit(`${value} = extractvalue ${llvm(member)} ${part}, ${fieldPath(holder, name).join(", ")}`);
      return convert(value, field(holder, name)!.type, to);
    });
  }

  // A value of `to` made from whichever member the union holds, branching on its tag. This
  // also reads an enum, a union of integer literals, as an i64.
  function eachMember(v: string, union: UnionType, to: Type, make: (part: string, member: Type) => string): string {
    const result = alloca(llvm(to));
    const tag = temp();
    emit(`${tag} = extractvalue ${llvm(union)} ${v}, 0`);
    const cases = union.members.map(() => label());
    const end = label();
    emit(`switch i32 ${tag}, label %${end} [ ${cases.map((c, i) => `i32 ${i}, label %${c}`).join(" ")} ]`);
    union.members.forEach((member, i) => {
      startBlock(cases[i]!);
      emit(`store ${llvm(to)} ${make(payload(v, union, member), member)}, ptr ${result}`);
      emit(`br label %${end}`);
    });
    startBlock(end);
    const out = temp();
    emit(`${out} = load ${llvm(to)}, ptr ${result}`);
    return out;
  }

  // Whether a union holds one of these members.
  // Whether `v` holds a member `wanted` says yes to, looking into the block of a member that
  // holds itself, whose own members may answer differently.
  function holdsWhere(v: string, type: Type, wanted: (m: Type) => boolean): string {
    if (typeof type !== "string" && type.kind === "recursive") {
      const loaded = temp();
      emit(`${loaded} = load ${llvm(type.of)}, ptr ${v}`);
      return holdsWhere(loaded, type.of, wanted);
    }
    if (typeof type === "string" || type.kind !== "union") return String(wanted(type));
    const mixed = (m: Type) => {
      const inner = unfold(m);
      return inner !== m && typeof inner !== "string" && inner.kind === "union" && new Set(inner.members.map(wanted)).size > 1;
    };
    const nested = type.members.filter(mixed);
    const direct = holds(v, type, type.members.filter((m) => !mixed(m) && wanted(m)));
    if (nested.length === 0) return direct;
    const result = b.alloca("i1");
    emit(`store i1 ${direct}, ptr ${result}`);
    const tag = temp();
    emit(`${tag} = extractvalue ${llvm(type)} ${v}, 0`);
    const done = b.label();
    for (const m of nested) {
      const [is, inside, next] = [temp(), b.label(), b.label()];
      emit(`${is} = icmp eq i32 ${tag}, ${type.members.indexOf(m)}`);
      emit(`br i1 ${is}, label %${inside}, label %${next}`);
      b.startBlock(inside);
      emit(`store i1 ${holdsWhere(payload(v, type, m), m, wanted)}, ptr ${result}`);
      emit(`br label %${done}`);
      b.startBlock(next);
    }
    emit(`br label %${done}`);
    b.startBlock(done);
    const answer = temp();
    emit(`${answer} = load i1, ptr ${result}`);
    return answer;
  }

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


  // `v`, a value of `from`, as a value of `to`: copied down to fewer fields, built into a class,
  // put into a union, taken out of one, or moved between unions. The checker has made sure
  // `from` fits `to`, through exactly one member when `to` is a union.
  function convert(v: string, from: Type, to: Type): string {
    if (from === to) return v;
    // A recursive type's value lives in its block: read where another type is wanted, it is
    // loaded, and a value meeting one moves into a new block.
    // A union holding the block itself takes it, or gives it, as is.
    const within = (t: Type, u: Type) => typeof u !== "string" && u.kind === "union" && u.members.includes(t);
    if (typeof from !== "string" && from.kind === "recursive" && !within(from, to)) {
      const loaded = temp();
      emit(`${loaded} = load ${llvm(from.of)}, ptr ${v}`);
      return convert(loaded, from.of, to);
    }
    if (typeof to !== "string" && to.kind === "recursive" && !within(to, from)) {
      const block = temp();
      emit(`${block} = call ptr @fsh_rt_alloc(i64 ${byteSize(to.of)})`);
      emit(`store ${llvm(to.of)} ${convert(v, from, to.of)}, ptr ${block}`);
      return block;
    }
    // Raw pointers are addresses, whatever they point at or may write.
    if (typeof from !== "string" && from.kind === "pointer" && typeof to !== "string" && to.kind === "pointer") return v;
    // Every regex is a pointer to its program.
    if (typeof from !== "string" && from.kind === "regex" && typeof to !== "string" && to.kind === "regex") return v;
    // Stored callables taking and giving the same types share a layout and a vtable shape.
    if (typeof from !== "string" && from.kind === "dyn" && typeof to !== "string" && to.kind === "dyn") return v;
    // A string literal's type takes no space; as a string, it is its static block.
    if (to === "string" && typeof from !== "string" && from.kind === "literal") return b.text(String(from.value));
    // Code holding a `never` value never runs.
    if (from === "never") return "undef";
    // A reference read where its value is wanted loads it; a mutable one lent as shared is the
    // same pointer.
    if (typeof from !== "string" && from.kind === "ref") {
      if (typeof to !== "string" && to.kind === "ref") return lend(v, from.to, to.to);
      const loaded = temp();
      emit(`${loaded} = load ${llvm(from.to)}, ptr ${v}`);
      return convert(loaded, from.to, to);
    }
    // A literal's value is known, so leaving one makes a constant, and entering one keeps nothing.
    if (typeof from !== "string" && from.kind === "literal" && (typeof to === "string" || to.kind !== "union")) return String(from.value);
    if (typeof to !== "string" && to.kind === "literal") return "zeroinitializer";
    if (typeof to !== "string" && to.kind === "union") {
      return typeof from !== "string" && from.kind === "union" ? retag(v, from, to) : inject(v, from, to);
    }
    if (typeof from !== "string" && from.kind === "union") {
      // A member of another kind than the narrowed type, an empty one or a scalar where an
      // aggregate is wanted, is one narrowing has left out, so it isn't there.
      const absent = (member: Type) => typeof member === "string" && member !== to
        && (member === "null" || member === "never" || typeof to !== "string" || (member === "string") !== (to === "string") || (member === "boolean") !== (to === "boolean"));
      return from.members.includes(to) ? payload(v, from, to) : eachMember(v, from, to, (part, member) => (absent(member) ? "undef" : convert(part, member, to)));
    }
    if (typeof from === "string" || typeof to === "string" || from.kind === "closure" || to.kind === "closure") return v;
    if (from.kind === "interface" || to.kind === "interface" || from.kind === "param" || to.kind === "param" || from.kind === "function" || to.kind === "function") {
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
      // An optional field the value leaves out is empty.
      if (!field(from, f.name)) return insert(convert("zeroinitializer", "null", f.type), f.type, i + (embeds ? 1 : 0));
      const part = temp();
      emit(`${part} = extractvalue ${llvm(from)} ${v}, ${fieldPath(from as ObjectType | ClassType, f.name).join(", ")}`);
      insert(convert(part, field(from, f.name)!.type, f.type), f.type, i + (embeds ? 1 : 0));
    });
    return result;
  }

  // A pointer to a `from` lent as one to a `to`: the same pointer, its payload when `to` is
  // one member of the union `from`, or else a slot holding a copy converted to `to`.
  function lend(v: string, from: Type, to: Type): string {
    if (from === to) return v;
    // A reference to a place holding a recursive type's block lends the block itself.
    if (typeof from !== "string" && from.kind === "recursive" && to !== from) {
      const block = temp();
      emit(`${block} = load ptr, ptr ${v}`);
      return lend(block, from.of, to);
    }
    if (typeof from !== "string" && from.kind === "union" && from.members.includes(to)) {
      const at = temp();
      emit(`${at} = getelementptr ${llvm(from)}, ptr ${v}, i32 0, i32 1`);
      return at;
    }
    const loaded = temp();
    emit(`${loaded} = load ${llvm(from)}, ptr ${v}`);
    const slot = alloca(llvm(to));
    emit(`store ${llvm(to)} ${convert(loaded, from, to)}, ptr ${slot}`);
    return slot;
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
    // A member that holds itself, which narrowing opened up, gives the member its block holds.
    const opened = (m: Type) => typeof m !== "string" && m.kind === "recursive" && membersFor(m, to).length === 0 && typeof m.of !== "string" && m.of.kind === "union" && m.of.members.some((x) => membersFor(x, to).length > 0);
    const held = from.members.filter((m) => membersFor(m, to).length > 0 || opened(m));
    const cases = held.map(() => label());
    const end = label();
    emit(`switch i32 ${tag}, label %${end} [ ${held.map((m, i) => `i32 ${from.members.indexOf(m)}, label %${cases[i]}`).join(" ")} ]`);
    held.forEach((member, i) => {
      startBlock(cases[i]!);
      emit(`store ${llvm(to)} ${opened(member) ? convert(payload(v, from, member), member, to) : inject(payload(v, from, member), member, to)}, ptr ${result}`);
      emit(`br label %${end}`);
    });
    startBlock(end);
    const out = temp();
    emit(`${out} = load ${llvm(to)}, ptr ${result}`);
    return out;
  }
}
