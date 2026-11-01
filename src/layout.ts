import type { Builder } from "./arithmetic.ts";
import { category, ofKind, typeofTest } from "./narrow.ts";
import type { Expr } from "./parser.ts";
import { rustClassOf } from "./rust.ts";
import type { Tables } from "./compilation.ts";
import { type LiteralType, INTEGERS, isInteger, type ClassType, type ObjectType, type Type, type UnionType, type Typing } from "./typing.ts";

// How each type is laid out in LLVM IR, and how a value moves between two types that hold it
// differently.

const PRIMITIVES: Record<Exclude<Type, object>, string> = {
  i8: "i8", i16: "i16", i32: "i32", i64: "i64", i128: "i128", isize: "i64", u8: "i8", u16: "i16", u32: "i32", u64: "i64", u128: "i128", usize: "i64",
  f32: "float", f64: "double", boolean: "i1", void: "void", null: "{}", never: "{}", string: "ptr", bigint: "ptr",
};

// An object is a literal struct of its fields, in their sorted order. An instance is a
// literal struct of the base it embeds, if any, then its own fields in declaration order. A
// union is its member's index, then enough 64-bit words for its largest member.
export function layoutOf(typing: Typing): (t: Type) => string {
  const { lower, rec } = typing;
  return function llvm(t: Type): string {
    if (typeof t === "string") return PRIMITIVES[t];
    const r = rec(t);
    // A Rust type's handle is the pointer to its boxed value, the one field its class has.
    if (r.kind === "ref" || r.kind === "pointer" || r.kind === "handle" || r.kind === "shared" || r.kind === "block" || r.kind === "map" || r.kind === "regex" || r.kind === "recursive" || rustClassOf(typing, t)) return "ptr";
    if (r.kind === "array") return ARRAY;
    if (r.kind === "fixed") return `[${r.size} x ${llvm(r.element)}]`;
    if (r.kind === "dyn") return DYN;
    if (r.kind === "union") return `{ i32, [${words(rec, t as UnionType)} x i64] }`;
    // Atomic instructions need whole bytes, so an atomic boolean is a byte.
    if (r.kind === "interior") return r.which === "Lock" ? `{ i32, ${llvm(r.of)} }` : r.which === "Atomic" && lower(r.of) === "boolean" ? "i8" : llvm(r.of);
    const parts = [...(r.kind === "class" && r.base ? [llvm(r.base)] : []), ...(r.kind === "generator" || r.kind === "future" ? r.frame : r.fields).map((f) => llvm(f.type))];
    return parts.length === 0 ? "{}" : `{ ${parts.join(", ")} }`;
  };
}

function words(rec: Typing["rec"], t: UnionType): usize {
  return Math.ceil(Math.max(...rec(t).members.map((m) => size(rec, m)[0])) / 8);
}

// A type's size and alignment in bytes, as LLVM lays out its IR type on the 64-bit targets
// Fish supports.
// An array is its elements' buffer, its length and its capacity, in elements.
export const ARRAY = "{ ptr, i64, i64 }";
// A Dyn is a pointer to its value's block, then to its vtable.
export const DYN = "{ ptr, ptr }";

// A type's size in bytes as it is laid out.
export const byteSize = ({ rec }: Typing, t: Type): usize => size(rec, t)[0];

function size(rec: Typing["rec"], t: Type): [usize, usize] {
  const r = typeof t === "string" ? undefined : rec(t);
  if (r?.kind === "array") return [24, 8];
  if (r?.kind === "fixed") {
    const [bytes, align] = size(rec, r.element);
    return [Math.ceil(bytes / align) * align * r.size, align];
  }
  if (r?.kind === "dyn") return [16, 8];
  if (isInteger(t)) return [INTEGERS[t].bits / 8, INTEGERS[t].bits / 8];
  if (t === "f32") return [4, 4];
  if (t === "f64") return [8, 8];
  if (t === "boolean") return [1, 1];
  if (t === "null" || t === "never") return [0, 1];
  if (t === "string" || t === "bigint") return [8, 8];
  if (r === undefined) return [0, 1];
  if (r.kind === "ref" || r.kind === "pointer" || r.kind === "handle" || r.kind === "shared" || r.kind === "block" || r.kind === "map" || r.kind === "regex" || r.kind === "recursive") return [8, 8];
  // The tag is padded to the 8-byte alignment of the payload words, even when there are none.
  if (r.kind === "union") return [8 + 8 * words(rec, t as UnionType), 8];
  if (r.kind === "interior" && r.which !== "Lock") return size(rec, r.of);
  const parts = r.kind === "interior" ? [[4, 4] as [usize, usize], size(rec, r.of)] : [...(r.kind === "class" && r.base ? [r.base] : []), ...(r.kind === "generator" || r.kind === "future" ? r.frame : r.kind === "param" ? (r.bound ? rec(r.bound).fields : []) : r.fields).map((f) => f.type)].map((p) => size(rec, p));
  const align = Math.max(1, ...parts.map(([, a]) => a));
  let bytes = 0;
  for (const [n, a] of parts) bytes = Math.ceil(bytes / a) * a + n;
  return [Math.ceil(bytes / align) * align, align];
}

// What converting needs besides emitting: a slot in the function's entry block.
// `text` gives a pointer to a literal's string block, which lives for the whole program.
// `deep` compares two values of one type holding objects, arrays or instances, part by part.
// `inspect` gives the string `console.log` prints for a value laid out as Node lays one out.
// `typing` holds the program's types.
export type Slots = Builder & { typing: Typing; alloca(type: string): string; text(value: string): string; deep?(a: string, b: string, type: Type): string; inspect?(v: string, type: Type): string };

// Whether values of a type compare part by part rather than as one word.
export const compound = ({ rec }: Typing, t: Type): boolean => typeof t !== "string" && ["object", "class", "array", "fixed", "recursive", "variant"].includes(rec(t).kind);

export function conversions(b: Slots, kindTests: Tables["kindTests"]) {
  const { emit, temp, label, startBlock, alloca, deep, typing } = b;
  const { baseOf, field, fieldPath, isPlainJs, isSubclass, optionRef, unfold, membersFor, rec } = typing;
  const llvm = layoutOf(typing);
  return { convert, test, equals, unionField, holds, holdsWhere, eachMember };

  // Lowers `typeof x === "name"`, `x instanceof Map` and `Array.isArray(x)`, or `x === v` with
  // x a union, to a check of x's tag, and of its payload when v isn't a literal. Undefined for
  // any other comparison.
  function test(e: Expr, value: (e: Expr) => string, typeOf: (e: Expr) => Type): string | undefined {
    const instance = kindTests.get(e);
    if (instance) {
      const tested = e.kind === "call" ? e.args[0]! : (e as Extract<Expr, { kind: "binary" }>).left;
      const [type, v] = [typeOf(tested), value(tested)];
      return holdsWhere(v, type, (m) => ofKind(typing, m, instance));
    }
    if (e.kind !== "binary") return undefined;
    if (e.op === "instanceof") {
      const [type, c] = [typeOf(e.left), typeOf(e.right)];
      const v = value(e.left);
      const r = typeof type === "string" ? undefined : rec(type);
      return r?.kind === "union" ? holds(v, type as UnionType, r.members.filter((m) => isSubclass(m, c))) : String(isSubclass(type, c));
    }
    if (e.op !== "===" && e.op !== "!==") return undefined;
    const kind = typeofTest(e);
    let result: string;
    if (kind) {
      const [v, type] = [value(kind.operand), typeOf(kind.operand)];
      const name = (kind.name as { value: string }).value;
      const r = typeof type === "string" ? undefined : rec(type);
      const through = r?.kind === "ref" && isPlainJs(r.to);
      if (isPlainJs(type) || through) {
        const [box, found] = [through ? temp() : v, temp()];
        if (through) emit(`${box} = load ptr, ptr ${v}`);
        emit(`${found} = call i32 @fsh_rt_js_typeof(ptr ${box}, ptr ${b.text(name)})`);
        result = temp();
        emit(`${result} = icmp ne i32 ${found}, 0`);
      } else result = holdsWhere(v, type, (m) => category(typing, m) === name);
    } else {
      const [left, right] = [typeOf(e.left), typeOf(e.right)];
      const unionLeft = typeof left !== "string" && rec(left).kind === "union";
      if (!unionLeft && (typeof right === "string" || rec(right).kind !== "union")) return undefined;
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
    const [ar, br] = [typeof aType === "string" ? undefined : rec(aType), typeof bType === "string" ? undefined : rec(bType)];
    if (ar?.kind === "recursive" && aType !== bType) {
      const loaded = temp();
      emit(`${loaded} = load ${llvm(ar.of)}, ptr ${a}`);
      return equals(loaded, ar.of, b, bType);
    }
    if (br?.kind === "recursive" && aType !== bType) return equals(b, bType, a, aType);
    if (ar?.kind === "union") {
      return eachMember(a, aType as UnionType, "boolean", (part, m) => equals(part, m, b, bType));
    }
    if (br?.kind === "union") return equals(b, bType, a, aType);
    const literal = (t: Type) => {
      const r = typeof t === "string" ? undefined : rec(t);
      return r?.kind === "literal" ? r : undefined;
    };
    const value = (t: Type, v: string) => {
      const l = literal(t);
      return l ? String(l.value) : v;
    };
    const base = (t: Type) => (literal(t) ? (baseOf(t as LiteralType) ?? t) : t);
    if (ar?.kind === "literal" && br?.kind === "literal") {
      return String(ar.value === br.value);
    }
    if (base(aType) === base(bType) && compound(typing, aType) && deep) return deep(a, b, aType);
    if (base(aType) !== base(bType) || typeof base(aType) !== "string") return "false";
    if (base(aType) === "null") return "true";
    if (base(aType) === "bigint") {
      const same = temp();
      emit(`${same} = call i1 @fsh_rt_big_equal(ptr ${a}, ptr ${b})`);
      return same;
    }
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
    const { members } = rec(union);
    const cases = members.map(() => label());
    const end = label();
    emit(`switch i32 ${tag}, label %${end} [ ${cases.map((c, i) => `i32 ${i}, label %${c}`).join(" ")} ]`);
    members.forEach((member, i) => {
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
    const r = typeof type === "string" ? undefined : rec(type);
    if (r?.kind === "recursive") {
      const loaded = temp();
      emit(`${loaded} = load ${llvm(r.of)}, ptr ${v}`);
      return holdsWhere(loaded, r.of, wanted);
    }
    if (r?.kind !== "union") return String(wanted(type));
    const mixed = (m: Type) => {
      const inner = unfold(m);
      if (inner === m || typeof inner === "string") return false;
      const ir = rec(inner);
      return ir.kind === "union" && new Set(ir.members.map(wanted)).size > 1;
    };
    const nested = r.members.filter(mixed);
    const direct = holds(v, type as UnionType, r.members.filter((m) => !mixed(m) && wanted(m)));
    if (nested.length === 0) return direct;
    const result = b.alloca("i1");
    emit(`store i1 ${direct}, ptr ${result}`);
    const tag = temp();
    emit(`${tag} = extractvalue ${llvm(type)} ${v}, 0`);
    const done = b.label();
    for (const m of nested) {
      const [is, inside, next] = [temp(), b.label(), b.label()];
      emit(`${is} = icmp eq i32 ${tag}, ${r.members.indexOf(m)}`);
      emit(`br i1 ${is}, label %${inside}, label %${next}`);
      b.startBlock(inside);
      emit(`store i1 ${holdsWhere(payload(v, type as UnionType, m), m, wanted)}, ptr ${result}`);
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
    const all = rec(union).members;
    for (const m of members) {
      const [is, next] = [temp(), temp()];
      emit(`${is} = icmp eq i32 ${tag}, ${all.indexOf(m)}`);
      emit(`${next} = or i1 ${result}, ${is}`);
      result = next;
    }
    return result;
  }


  // `v`, a value of `from`, as a value of `to`: copied down to fewer fields, built into a class,
  // put into a union, taken out of one, or moved between unions. The checker has made sure
  // `from` fits `to`, through exactly one member when `to` is a union.
  function convert(v: string, from: Type, to: Type): string {
    // Types that lower to the same one, as a field's type written with `?` and the type read from
    // it do, are laid out the same.
    if (from === to || typing.lower(from) === typing.lower(to)) return v;
    // A recursive type's value lives in its block: read where another type is wanted, it is
    // loaded, and a value meeting one moves into a new block.
    // A union holding the block itself takes it, or gives it, as is.
    const within = (t: Type, u: Type) => {
      const r = typeof u === "string" ? undefined : rec(u);
      return r?.kind === "union" && r.members.includes(t);
    };
    const fr = typeof from === "string" ? undefined : rec(from);
    const tr = typeof to === "string" ? undefined : rec(to);
    if (fr?.kind === "recursive" && !within(from, to)) {
      const loaded = temp();
      emit(`${loaded} = load ${llvm(fr.of)}, ptr ${v}`);
      return convert(loaded, fr.of, to);
    }
    if (tr?.kind === "recursive" && !within(to, from)) {
      const block = temp();
      emit(`${block} = call ptr @fsh_rt_alloc(i64 ${byteSize(typing, tr.of)})`);
      emit(`store ${llvm(tr.of)} ${convert(v, from, tr.of)}, ptr ${block}`);
      return block;
    }
    // Raw pointers are addresses, whatever they point at or may write.
    if (fr?.kind === "pointer" && tr?.kind === "pointer") return v;
    // Every regex is a pointer to its program.
    if (fr?.kind === "regex" && tr?.kind === "regex") return v;
    // Stored callables taking and giving the same types share a layout and a vtable shape.
    if (fr?.kind === "dyn" && tr?.kind === "dyn") return v;
    // A string literal's type takes no space; as a string, it is its static block.
    if (to === "string" && fr?.kind === "literal") return b.text(String(fr.value));
    // Code holding a `never` value never runs.
    if (from === "never") return "undef";
    // A JS value is the same box whichever declared shape it meets.
    if (fr?.kind === "block" && fr.which === "JsValue" && tr?.kind === "block" && tr.which === "JsValue") return v;
    // An empty array literal holds no element to convert, and an array of JS values holds the
    // same boxes whichever shape each is declared to have.
    const js = (t: Type) => {
      const r = typeof t === "string" ? undefined : rec(t);
      return r?.kind === "block" && r.which === "JsValue";
    };
    if (fr?.kind === "array" && tr?.kind === "array" && (fr.element === "never" || (js(fr.element) && js(tr.element)))) return v;
    // A reference read where its value is wanted loads it; a mutable one lent as shared is the
    // same pointer.
    // A reference going into a `Ref<T> | null` is its pointer, as the payload.
    if (fr?.kind === "ref" && !optionRef(to)) {
      if (tr?.kind === "ref") return lend(v, fr.to, tr.to);
      const loaded = temp();
      emit(`${loaded} = load ${llvm(fr.to)}, ptr ${v}`);
      return convert(loaded, fr.to, to);
    }
    // A literal's value is known, so leaving one makes a constant, and entering one keeps nothing.
    if (fr?.kind === "literal" && tr?.kind !== "union") return String(fr.value);
    if (tr?.kind === "literal") return "zeroinitializer";
    if (tr?.kind === "union") {
      return fr?.kind === "union" ? retag(v, from as UnionType, to as UnionType) : inject(v, from, to as UnionType);
    }
    if (fr?.kind === "union") {
      // A member of another kind than the narrowed type, an empty one or a scalar where an
      // aggregate is wanted, is one narrowing has left out, so it isn't there.
      const absent = (member: Type) => typeof member === "string" && member !== to
        && (member === "null" || member === "never" || typeof to !== "string" || (member === "string") !== (to === "string") || (member === "boolean") !== (to === "boolean"));
      return fr.members.includes(to) ? payload(v, from as UnionType, to) : eachMember(v, from as UnionType, to, (part, member) => (absent(member) ? "undef" : convert(part, member, to)));
    }
    if (typeof from === "string" || typeof to === "string") return v;
    const [source, target] = [fr!, tr!];
    if (source.kind === "closure" || target.kind === "closure") return v;
    if (source.kind === "interface" || target.kind === "interface" || source.kind === "param" || target.kind === "param" || source.kind === "function" || target.kind === "function") {
      throw new Error("internal error: an interface or a type parameter reached codegen");
    }
    // A class built from a literal starts with its embedded base, built the same way.
    const embeds = target.kind === "class" && target.base;
    let result = "undef";
    const insert = (part: string, type: Type, i: usize) => {
      const next = temp();
      emit(`${next} = insertvalue ${llvm(to)} ${result}, ${llvm(type)} ${part}, ${i}`);
      result = next;
    };
    if (embeds) insert(convert(v, from, embeds), embeds, 0);
    target.fields.forEach((f, i) => {
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
    const r = typeof from === "string" ? undefined : rec(from);
    if (r?.kind === "recursive" && to !== from) {
      const block = temp();
      emit(`${block} = load ptr, ptr ${v}`);
      return lend(block, r.of, to);
    }
    if (r?.kind === "union" && r.members.includes(to)) {
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
    emit(`store i32 ${rec(to).members.indexOf(member)}, ptr ${slot}`);
    const value = convert(v, from, member);
    if (typeof member === "string" || rec(member).kind !== "literal") {
      const at = temp();
      emit(`${at} = getelementptr ${llvm(to)}, ptr ${slot}, i32 0, i32 1`);
      // The payload is i64 words, aligned to 8 however wide a member is.
      emit(`store ${llvm(member)} ${value}, ptr ${at}, align 8`);
    }
    const result = temp();
    emit(`${result} = load ${llvm(to)}, ptr ${slot}`);
    return result;
  }

  // The payload of a union known to hold a member of type `to`, or a union of some members.
  function payload(v: string, from: UnionType, to: Type): string {
    if (typeof to !== "string" && rec(to).kind === "literal") return "zeroinitializer";
    const slot = alloca(llvm(from));
    emit(`store ${llvm(from)} ${v}, ptr ${slot}`);
    const at = temp();
    emit(`${at} = getelementptr ${llvm(from)}, ptr ${slot}, i32 0, i32 1`);
    const result = temp();
    emit(`${result} = load ${llvm(to)}, ptr ${at}, align 8`);
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
    const opened = (m: Type) => {
      const r = typeof m === "string" ? undefined : rec(m);
      if (r?.kind !== "recursive" || membersFor(m, to).length > 0 || typeof r.of === "string") return false;
      const of = rec(r.of);
      return of.kind === "union" && of.members.some((x) => membersFor(x, to).length > 0);
    };
    const { members } = rec(from);
    const held = members.filter((m) => membersFor(m, to).length > 0 || opened(m));
    const cases = held.map(() => label());
    const end = label();
    emit(`switch i32 ${tag}, label %${end} [ ${held.map((m, i) => `i32 ${members.indexOf(m)}, label %${cases[i]}`).join(" ")} ]`);
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
