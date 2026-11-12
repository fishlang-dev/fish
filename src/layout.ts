import type { Builder } from "./arithmetic.ts";
import { category, ofKind, typeofTest, type Verdict } from "./narrow.ts";
import type { Expr } from "./parser.ts";
import { rustClassOf } from "./rust.ts";
import { byteSize, words } from "./sizes.ts";
import type { Tables } from "./compilation.ts";
import { isLock, isNumeric, type LiteralType, INTEGERS, isInteger, type ClassType, type ObjectType, type Type, type UnionType, type Typing } from "./typing.ts";

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
  return (t) => llvmOf(typing, t);
}

// The LLVM type a value of `t` is held as.
export function llvmOf(typing: Typing, t: Type): string {
  if (typeof t === "string") return PRIMITIVES[t];
  const r = typing.rec(t);
  if (r.kind === "brand") return llvmOf(typing, r.base);
  // A Rust type's handle is the pointer to its boxed value, the one field its class has.
  if (r.kind === "ref" || r.kind === "pointer" || r.kind === "handle" || r.kind === "shared" || r.kind === "block" || r.kind === "map" || r.kind === "regex" || r.kind === "recursive" || rustClassOf(typing, t)) return "ptr";
  if (r.kind === "array") return ARRAY;
  if (r.kind === "fixed") return `[${r.size} x ${llvmOf(typing, r.element)}]`;
  if (r.kind === "dyn") return DYN;
  if (r.kind === "union") return `{ i32, [${words(typing, t as UnionType)} x i64] }`;
  // Atomic instructions need whole bytes, so an atomic boolean is a byte.
  if (r.kind === "interior") return isLock(r) ? `{ i32, ${llvmOf(typing, r.of)} }` : r.which === "Atomic" && typing.lower(r.of) === "boolean" ? "i8" : llvmOf(typing, r.of);
  const parts = [...(r.kind === "class" && r.base ? [llvmOf(typing, r.base)] : []), ...(r.kind === "generator" || r.kind === "future" ? r.frame : r.fields).map((f) => llvmOf(typing, f.type))];
  return parts.length === 0 ? "{}" : `{ ${parts.join(", ")} }`;
}

// An array is its elements' buffer, its length and its capacity, in elements.
export const ARRAY = "{ ptr, i64, i64 }";
// A Dyn is a pointer to its value's block, then to its vtable.
export const DYN = "{ ptr, ptr }";

// What converting needs besides emitting: a slot in the function's entry block.
// `text` gives a pointer to a literal's string block, which lives for the whole program.
// `deep` compares two values of one type holding objects, arrays or instances, part by part.
// `inspect` gives the string `console.log` prints for a value laid out as Node lays one out.
// `typing` holds the program's types.
export interface Slots extends Builder {
  typing: Typing;
  text(this: Mut<this>, value: string): string;
  deep(this: Mut<this>, a: string, b: string, type: Type): string;
  inspect(this: Mut<this>, v: string, type: Type): string;
  kindTests: Tables["kindTests"];
  keyTests: Tables["keyTests"];
}

// Whether values of a type compare part by part rather than as one word.
export const compound = (typing: Typing, t: Type): boolean => typeof t !== "string" && ["object", "class", "array", "fixed", "recursive", "variant"].includes(typing.rec(t).kind);

export class Conversions<H extends Slots> {
  host: Mut<H>;

  constructor(host: Mut<H>) {
    this.host = host;
  }

  // Lowers `typeof x === "name"`, `x instanceof Map` and `Array.isArray(x)`, or `x === v` with
  // x a union, to a check of x's tag, and of its payload when v isn't a literal. Undefined for
  // any other comparison.
  test(this: Mut<this>, e: Expr, value: (e: Expr) => string, typeOf: (e: Expr) => Type): string | undefined {
    const instance = this.host.kindTests.get(e);
    if (instance) {
      const tested = e.kind === "call" ? e.args[0]! : (e as Extract<Expr, { kind: "binary" }>).left;
      const [type, v] = [typeOf(tested), value(tested)];
      return this.holdsWhere(v, type, (m) => ofKind(this.host.typing, m, instance));
    }
    if (e.kind !== "binary") return undefined;
    const keyed = this.host.keyTests.get(e);
    if (keyed) return this.hasKey(value(e.right), typeOf(e.right), (m) => keyed.get(m)!, (e.left as { value: string }).value);
    if (e.op === "instanceof") {
      const [type, c] = [typeOf(e.left), typeOf(e.right)];
      const v = value(e.left);
      const r = typeof type === "string" ? undefined : this.host.typing.rec(type);
      return r?.kind === "union" ? this.holds(v, type as UnionType, r.members.filter((m) => this.host.typing.isSubclass(m, c))) : String(this.host.typing.isSubclass(type, c));
    }
    if (e.op !== "===" && e.op !== "!==") return undefined;
    const kind = typeofTest(e);
    let result: string;
    if (kind) {
      const [v, type] = [value(kind.operand), typeOf(kind.operand)];
      const name = (kind.name as { value: string }).value;
      const r = typeof type === "string" ? undefined : this.host.typing.rec(type);
      const through = r?.kind === "ref" && this.host.typing.isPlainJs(r.to);
      if (this.host.typing.isPlainJs(type) || through) {
        const [box, found] = [through ? this.host.temp() : v, this.host.temp()];
        if (through) this.host.emit(`${box} = load ptr, ptr ${v}`);
        this.host.emit(`${found} = call i32 @fsh_rt_js_typeof(ptr ${box}, ptr ${this.host.text(name)})`);
        result = this.host.temp();
        this.host.emit(`${result} = icmp ne i32 ${found}, 0`);
      } else result = this.holdsWhere(v, type, (m) => category(this.host.typing, m) === name);
    } else {
      const [left, right] = [typeOf(e.left), typeOf(e.right)];
      const unionLeft = typeof left !== "string" && this.host.typing.rec(left).kind === "union";
      if (!unionLeft && (typeof right === "string" || this.host.typing.rec(right).kind !== "union")) return undefined;
      const [u, o] = [value(e.left), value(e.right)];
      result = this.equals(u, left, o, right);
    }
    if (e.op === "===") return result;
    const negated = this.host.temp();
    this.host.emit(`${negated} = xor i1 ${result}, true`);
    return negated;
  }

  // Whether `v` has `key`, by the member it holds; a member whose `key` is optional has it when
  // the field holds a value, as Fish can't tell one left out from one set empty.
  hasKey(this: Mut<this>, v: string, type: Type, verdict: (m: Type) => Verdict, key: string): string {
    const r = typeof type === "string" ? undefined : this.host.typing.rec(type);
    if (r?.kind === "ref" || r?.kind === "recursive") {
      const loaded = this.host.temp();
      this.host.emit(`${loaded} = load ${llvmOf(this.host.typing, r.kind === "ref" ? r.to : r.of)}, ptr ${v}`);
      return this.hasKey(loaded, r.kind === "ref" ? r.to : r.of, verdict, key);
    }
    if (r?.kind === "union") {
      return r.members.some((m) => verdict(m) === "both")
        ? this.eachMember(v, type as UnionType, "boolean", (part, m) => this.hasKey(part, m, verdict, key))
        : this.holdsWhere(v, type, (m) => verdict(m) === "yes");
    }
    if (verdict(type) !== "both") return String(verdict(type) === "yes");
    const holder = type as ObjectType | ClassType;
    const field = this.host.typing.field(holder, key)!.type;
    const read = this.host.temp();
    this.host.emit(`${read} = extractvalue ${llvmOf(this.host.typing, type)} ${v}, ${this.host.typing.fieldPath(holder, key).join(", ")}`);
    return this.holdsWhere(read, field, (m) => m !== "null");
  }

  // Whether two values are equal, as JavaScript's `===` would find them. A union is compared
  // by the member it holds, so only that member's payload is read; literals compare by value,
  // so two enum members that share a value are equal.
  equals(this: Mut<this>, a: string, aType: Type, b: string, bType: Type): string {
    const literal = (t: Type) => {
      const r = typeof t === "string" ? undefined : this.host.typing.rec(t);
      return r?.kind === "literal" ? r : undefined;
    };
    const value = (t: Type, v: string) => {
      const l = literal(t);
      return l ? String(l.value) : v;
    };
    const base = (t: Type) => (literal(t) ? (this.host.typing.baseOf(t as LiteralType) ?? t) : t);
    // A member that holds itself is compared as what its block holds, unless both sides are it.
    const [ar, br] = [typeof aType === "string" ? undefined : this.host.typing.rec(aType), typeof bType === "string" ? undefined : this.host.typing.rec(bType)];
    if (ar?.kind === "recursive" && aType !== bType) {
      const loaded = this.host.temp();
      this.host.emit(`${loaded} = load ${llvmOf(this.host.typing, ar.of)}, ptr ${a}`);
      return this.equals(loaded, ar.of, b, bType);
    }
    if (br?.kind === "recursive" && aType !== bType) return this.equals(b, bType, a, aType);
    if (ar?.kind === "union") {
      // An unknown holds JavaScript's numbers, which are equal across the kinds Fish has.
      const numbers = (m: Type) => ar.unknown === true && isNumeric(m) && isNumeric(base(bType)) && m !== base(bType);
      return this.eachMember(a, aType as UnionType, "boolean", (part, m) => (numbers(m) ? this.sameNumber(part, m, value(bType, b), base(bType)) : this.equals(part, m, b, bType)));
    }
    if (br?.kind === "union") return this.equals(b, bType, a, aType);
    // A reference held in a value is compared through, as a reference on its own is.
    if (ar?.kind === "ref") {
      const loaded = this.host.temp();
      this.host.emit(`${loaded} = load ${llvmOf(this.host.typing, ar.to)}, ptr ${a}`);
      return this.equals(loaded, ar.to, b, bType);
    }
    if (br?.kind === "ref") return this.equals(b, bType, a, aType);
    if (ar?.kind === "literal" && br?.kind === "literal") {
      return String(ar.value === br.value);
    }
    if (base(aType) === base(bType) && compound(this.host.typing, aType)) return this.host.deep(a, b, aType);
    if (base(aType) !== base(bType) || typeof base(aType) !== "string") return "false";
    if (base(aType) === "null") return "true";
    if (base(aType) === "bigint") {
      const same = this.host.temp();
      this.host.emit(`${same} = call i1 @fsh_rt_big_equal(ptr ${a}, ptr ${b})`);
      return same;
    }
    if (base(aType) === "string") {
      const order = this.host.temp();
      this.host.emit(`${order} = call i32 @fsh_rt_str_compare(ptr ${this.convert(a, aType, "string")}, ptr ${this.convert(b, bType, "string")})`);
      const same = this.host.temp();
      this.host.emit(`${same} = icmp eq i32 ${order}, 0`);
      return same;
    }
    const result = this.host.temp();
    const float = base(aType) === "f32" || base(aType) === "f64";
    this.host.emit(`${result} = ${float ? "fcmp oeq" : "icmp eq"} ${llvmOf(this.host.typing, base(aType))} ${value(aType, a)}, ${value(bType, b)}`);
    return result;
  }

  // A field every member of the union has, read from whichever member it holds.
  unionField(this: Mut<this>, v: string, union: UnionType, name: string, to: Type): string {
    return this.eachMember(v, union, to, (part, member) => {
      // A member holding the union again keeps its value in a block.
      const r = this.host.typing.rec(member as Exclude<Type, string>);
      if (r.kind === "recursive") {
        const loaded = this.host.temp();
        this.host.emit(`${loaded} = load ${llvmOf(this.host.typing, r.of)}, ptr ${part}`);
        if (this.host.typing.recOf(r.of)?.kind === "union") return this.unionField(loaded, r.of as UnionType, name, to);
        [part, member] = [loaded, r.of];
      }
      // The checker found the field on every member, so each is an object or an instance.
      const holder = member as ObjectType | ClassType;
      const value = this.host.temp();
      this.host.emit(`${value} = extractvalue ${llvmOf(this.host.typing, member)} ${part}, ${this.host.typing.fieldPath(holder, name).join(", ")}`);
      return this.convert(value, this.host.typing.field(holder, name)!.type, to);
    });
  }

  // A value of `to` made from whichever member the union holds, branching on its tag. This
  // also reads an enum, a union of integer literals, as an i64.
  eachMember(this: Mut<this>, v: string, union: UnionType, to: Type, make: (part: string, member: Type) => string): string {
    const result = this.host.alloca(llvmOf(this.host.typing, to));
    const tag = this.host.temp();
    this.host.emit(`${tag} = extractvalue ${llvmOf(this.host.typing, union)} ${v}, 0`);
    const { members } = this.host.typing.rec(union);
    const cases = members.map(() => this.host.label());
    const end = this.host.label();
    this.host.emit(`switch i32 ${tag}, label %${end} [ ${cases.map((c, i) => `i32 ${i}, label %${c}`).join(" ")} ]`);
    members.forEach((member, i) => {
      this.host.startBlock(cases[i]!);
      this.host.emit(`store ${llvmOf(this.host.typing, to)} ${make(this.payload(v, union, member), member)}, ptr ${result}`);
      this.host.emit(`br label %${end}`);
    });
    this.host.startBlock(end);
    const out = this.host.temp();
    this.host.emit(`${out} = load ${llvmOf(this.host.typing, to)}, ptr ${result}`);
    return out;
  }

  // A value of `to` read from an unknown that narrowing has shown holds a member giving one. A
  // number read as JavaScript's `number` is converted to an f64.
  fromUnknown(this: Mut<this>, v: string, from: UnionType, to: Type): string {
    const { members } = this.host.typing.rec(from);
    const held = members.filter((m) => this.host.typing.unknownGives(m, to));
    if (held.length === 1 && held[0] === to) return this.payload(v, from, to);
    const result = this.host.alloca(llvmOf(this.host.typing, to));
    const tag = this.host.temp();
    this.host.emit(`${tag} = extractvalue ${llvmOf(this.host.typing, from)} ${v}, 0`);
    const cases = held.map(() => this.host.label());
    const end = this.host.label();
    this.host.emit(`switch i32 ${tag}, label %${end} [ ${held.map((m, i) => `i32 ${members.indexOf(m)}, label %${cases[i]}`).join(" ")} ]`);
    held.forEach((member, i) => {
      this.host.startBlock(cases[i]!);
      const part = this.payload(v, from, member);
      const kept = typeof to !== "string" && this.host.typing.rec(to).kind === "union" && this.host.typing.membersFor(member, to as UnionType).length > 0;
      const number = isNumeric(member) && member !== "f64" && !kept;
      this.host.emit(`store ${llvmOf(this.host.typing, to)} ${number ? this.convert(this.asDouble(part, member), "f64", to) : this.convert(part, member, to)}, ptr ${result}`);
      this.host.emit(`br label %${end}`);
    });
    this.host.startBlock(end);
    const out = this.host.temp();
    this.host.emit(`${out} = load ${llvmOf(this.host.typing, to)}, ptr ${result}`);
    return out;
  }

  // Two numbers of different kinds, equal by value: integers exactly, as i128, and through f64
  // only when one is a float, as codegen's mixed comparisons do.
  // ponytail: a u128 beside a signed type compares as i128, wrong past i128's range.
  sameNumber(this: Mut<this>, a: string, aType: Type, b: string, bType: Type): string {
    const result = this.host.temp();
    if (isInteger(aType) && isInteger(bType)) this.host.emit(`${result} = icmp eq i128 ${this.wide(a, aType)}, ${this.wide(b, bType)}`);
    else this.host.emit(`${result} = fcmp oeq double ${this.asDouble(a, aType)}, ${this.asDouble(b, bType)}`);
    return result;
  }

  wide(this: Mut<this>, v: string, from: Type): string {
    if (from === "i128" || from === "u128") return v;
    const result = this.host.temp();
    this.host.emit(`${result} = ${INTEGERS[from as keyof typeof INTEGERS].signed ? "sext" : "zext"} ${llvmOf(this.host.typing, from)} ${v} to i128`);
    return result;
  }

  asDouble(this: Mut<this>, v: string, from: Type): string {
    if (from === "f64") return v;
    const result = this.host.temp();
    if (from === "f32") this.host.emit(`${result} = fpext float ${v} to double`);
    else this.host.emit(`${result} = ${INTEGERS[from as keyof typeof INTEGERS].signed ? "sitofp" : "uitofp"} ${llvmOf(this.host.typing, from)} ${v} to double`);
    return result;
  }

  // Whether a union holds one of these members.
  // Whether `v` holds a member `wanted` says yes to, looking into the block of a member that
  // holds itself, whose own members may answer differently.
  holdsWhere(this: Mut<this>, v: string, type: Type, wanted: (m: Type) => boolean): string {
    const r = typeof type === "string" ? undefined : this.host.typing.rec(type);
    if (r?.kind === "recursive") {
      const loaded = this.host.temp();
      this.host.emit(`${loaded} = load ${llvmOf(this.host.typing, r.of)}, ptr ${v}`);
      return this.holdsWhere(loaded, r.of, wanted);
    }
    if (r?.kind !== "union") return String(wanted(type));
    const mixed = (m: Type) => {
      const inner = this.host.typing.unfold(m);
      if (inner === m || typeof inner === "string") return false;
      const ir = this.host.typing.rec(inner);
      return ir.kind === "union" && new Set(ir.members.map(wanted)).size > 1;
    };
    const nested = r.members.filter(mixed);
    const direct = this.holds(v, type as UnionType, r.members.filter((m) => !mixed(m) && wanted(m)));
    if (nested.length === 0) return direct;
    const result = this.host.alloca("i1");
    this.host.emit(`store i1 ${direct}, ptr ${result}`);
    const tag = this.host.temp();
    this.host.emit(`${tag} = extractvalue ${llvmOf(this.host.typing, type)} ${v}, 0`);
    const done = this.host.label();
    for (const m of nested) {
      const [is, inside, next] = [this.host.temp(), this.host.label(), this.host.label()];
      this.host.emit(`${is} = icmp eq i32 ${tag}, ${r.members.indexOf(m)}`);
      this.host.emit(`br i1 ${is}, label %${inside}, label %${next}`);
      this.host.startBlock(inside);
      this.host.emit(`store i1 ${this.holdsWhere(this.payload(v, type as UnionType, m), m, wanted)}, ptr ${result}`);
      this.host.emit(`br label %${done}`);
      this.host.startBlock(next);
    }
    this.host.emit(`br label %${done}`);
    this.host.startBlock(done);
    const answer = this.host.temp();
    this.host.emit(`${answer} = load i1, ptr ${result}`);
    return answer;
  }

  holds(this: Mut<this>, v: string, union: UnionType, members: Type[]): string {
    const tag = this.host.temp();
    this.host.emit(`${tag} = extractvalue ${llvmOf(this.host.typing, union)} ${v}, 0`);
    let result = "false";
    const all = this.host.typing.rec(union).members;
    for (const m of members) {
      const [is, next] = [this.host.temp(), this.host.temp()];
      this.host.emit(`${is} = icmp eq i32 ${tag}, ${all.indexOf(m)}`);
      this.host.emit(`${next} = or i1 ${result}, ${is}`);
      result = next;
    }
    return result;
  }


  // `v`, a value of `from`, as a value of `to`: copied down to fewer fields, built into a class,
  // put into a union, taken out of one, or moved between unions. The checker has made sure
  // `from` fits `to`, through exactly one member when `to` is a union.
  convert(this: Mut<this>, v: string, from: Type, to: Type): string {
    // Types that lower to the same one, as a field's type written with `?` and the type read from
    // it do, are laid out the same.
    if (from === to || this.host.typing.lower(from) === this.host.typing.lower(to)) return v;
    // A recursive type's value lives in its block: read where another type is wanted, it is
    // loaded, and a value meeting one moves into a new block.
    // A union holding the block itself takes it, or gives it, as is.
    const within = (t: Type, u: Type) => {
      const r = typeof u === "string" ? undefined : this.host.typing.rec(u);
      return r?.kind === "union" && r.members.includes(t);
    };
    const fr = typeof from === "string" ? undefined : this.host.typing.rec(from);
    const tr = typeof to === "string" ? undefined : this.host.typing.rec(to);
    if (fr?.kind === "recursive" && !within(from, to)) {
      const loaded = this.host.temp();
      this.host.emit(`${loaded} = load ${llvmOf(this.host.typing, fr.of)}, ptr ${v}`);
      return this.convert(loaded, fr.of, to);
    }
    if (tr?.kind === "recursive" && !within(to, from)) {
      const block = this.host.temp();
      this.host.emit(`${block} = call ptr @fsh_rt_alloc(i64 ${byteSize(this.host.typing, tr.of)})`);
      this.host.emit(`store ${llvmOf(this.host.typing, tr.of)} ${this.convert(v, from, tr.of)}, ptr ${block}`);
      return block;
    }
    // Raw pointers are addresses, whatever they point at or may write.
    if (fr?.kind === "pointer" && tr?.kind === "pointer") return v;
    // Every regex is a pointer to its program.
    if (fr?.kind === "regex" && tr?.kind === "regex") return v;
    // Stored callables taking and giving the same types share a layout and a vtable shape.
    if (fr?.kind === "dyn" && tr?.kind === "dyn") return v;
    // A string literal's type takes no space; as a string, it is its static block.
    if (to === "string" && fr?.kind === "literal") return this.host.text(String(fr.value));
    // Code holding a `never` value never runs.
    if (from === "never") return "undef";
    // A JS value is the same box whichever declared shape it meets.
    if (fr?.kind === "block" && fr.which === "JsValue" && tr?.kind === "block" && tr.which === "JsValue") return v;
    // An empty array literal holds no element to convert, and an array of JS values holds the
    // same boxes whichever shape each is declared to have.
    const js = (t: Type) => {
      const r = typeof t === "string" ? undefined : this.host.typing.rec(t);
      return r?.kind === "block" && r.which === "JsValue";
    };
    if (fr?.kind === "array" && tr?.kind === "array" && (fr.element === "never" || (js(fr.element) && js(tr.element)))) return v;
    // A reference read where its value is wanted loads it; a mutable one lent as shared is the
    // same pointer.
    // A reference going into a `Ref<T> | null` is its pointer, as the payload.
    if (fr?.kind === "ref" && !this.host.typing.optionRef(to)) {
      if (tr?.kind === "ref") return this.lend(v, fr.to, tr.to);
      const loaded = this.host.temp();
      this.host.emit(`${loaded} = load ${llvmOf(this.host.typing, fr.to)}, ptr ${v}`);
      return this.convert(loaded, fr.to, to);
    }
    // A literal's value is known, so leaving one makes a constant, and entering one keeps nothing.
    if (fr?.kind === "literal" && tr?.kind !== "union") return String(fr.value);
    if (tr?.kind === "literal") return "zeroinitializer";
    if (fr?.kind === "union" && fr.unknown) return this.fromUnknown(v, from as UnionType, to);
    if (tr?.kind === "union") {
      return fr?.kind === "union" ? this.retag(v, from as UnionType, to as UnionType) : this.inject(v, from, to as UnionType);
    }
    if (fr?.kind === "union") {
      // A member of another kind than the narrowed type, an empty one or a scalar where an
      // aggregate is wanted, is one narrowing has left out, so it isn't there.
      // So is a string or boolean literal where the narrowed type is of another kind.
      const absent = (member: Type) => {
        const lit = this.host.typing.recOf(member);
        if (lit?.kind === "literal") return (typeof lit.value === "string" && to !== "string") || (typeof lit.value === "boolean" && to !== "boolean");
        return typeof member === "string" && member !== to
          && (member === "null" || member === "never" || typeof to !== "string" || (member === "string") !== (to === "string") || (member === "boolean") !== (to === "boolean"));
      };
      return fr.members.includes(to) ? this.payload(v, from as UnionType, to) : this.eachMember(v, from as UnionType, to, (part, member) => (absent(member) ? "undef" : this.convert(part, member, to)));
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
      const next = this.host.temp();
      this.host.emit(`${next} = insertvalue ${llvmOf(this.host.typing, to)} ${result}, ${llvmOf(this.host.typing, type)} ${part}, ${i}`);
      result = next;
    };
    if (embeds) insert(this.convert(v, from, embeds), embeds, 0);
    target.fields.forEach((f, i) => {
      // An optional field the value leaves out is empty.
      if (!this.host.typing.field(from, f.name)) return insert(this.convert("zeroinitializer", "null", f.type), f.type, i + (embeds ? 1 : 0));
      const part = this.host.temp();
      this.host.emit(`${part} = extractvalue ${llvmOf(this.host.typing, from)} ${v}, ${this.host.typing.fieldPath(from as ObjectType | ClassType, f.name).join(", ")}`);
      insert(this.convert(part, this.host.typing.field(from, f.name)!.type, f.type), f.type, i + (embeds ? 1 : 0));
    });
    return result;
  }

  // A pointer to a `from` lent as one to a `to`: the same pointer, its payload when `to` is
  // one member of the union `from`, or else a slot holding a copy converted to `to`.
  lend(this: Mut<this>, v: string, from: Type, to: Type): string {
    if (from === to) return v;
    // A reference to a place holding a recursive type's block lends the block itself.
    const r = typeof from === "string" ? undefined : this.host.typing.rec(from);
    if (r?.kind === "recursive" && to !== from) {
      const block = this.host.temp();
      this.host.emit(`${block} = load ptr, ptr ${v}`);
      return this.lend(block, r.of, to);
    }
    // An unknown narrowed to a number may hold another kind of number, converted on its way out.
    if (r?.kind === "union" && r.members.some((m) => m === to || (this.host.typing.recOf(m)?.kind === "object" && this.alike(m, to))) && !(r.unknown && r.members.some((m) => m !== to && this.host.typing.unknownGives(m, to)))) {
      const at = this.host.temp();
      this.host.emit(`${at} = getelementptr ${llvmOf(this.host.typing, from)}, ptr ${v}, i32 0, i32 1`);
      return at;
    }
    const loaded = this.host.temp();
    this.host.emit(`${loaded} = load ${llvmOf(this.host.typing, from)}, ptr ${v}`);
    const slot = this.host.alloca(llvmOf(this.host.typing, to));
    this.host.emit(`store ${llvmOf(this.host.typing, to)} ${this.convert(loaded, from, to)}, ptr ${slot}`);
    return slot;
  }

  // Whether two types are laid out alike: a union holding itself keeps its own records for
  // codegen, while a type narrowed to one of its members was lowered to fresh ones of the same
  // shape. A pair met again inside itself is taken as alike, and each pair is decided once.
  alike(this: Mut<this>, a: Type, b: Type, seen: Map<string, boolean> = new Map<string, boolean>()): boolean {
    if (a === b) return true;
    const x = this.host.typing.recOf(a);
    const y = this.host.typing.recOf(b);
    if (x === undefined || y === undefined || x.kind !== y.kind) return false;
    const pair = `${String(a)},${String(b)}`;
    const known = seen.get(pair);
    if (known !== undefined) return known;
    seen.set(pair, true);
    let same = false;
    if (x.kind === "recursive" && y.kind === "recursive") same = this.alike(x.of, y.of, seen);
    else if (x.kind === "array" && y.kind === "array") same = this.alike(x.element, y.element, seen);
    else if (x.kind === "union" && y.kind === "union") same = x.members.length === y.members.length && x.members.every((m, i) => this.alike(m, y.members[i]!, seen));
    else if (x.kind === "object" && y.kind === "object" && x.tuple === y.tuple) same = x.fields.length === y.fields.length && x.fields.every((f, i) => f.name === y.fields[i]!.name && this.alike(f.type, y.fields[i]!.type, seen));
    seen.set(pair, same);
    return same;
  }

  // Sets the tag of the member `from` goes into, and stores its value as the payload.
  inject(this: Mut<this>, v: string, from: Type, to: UnionType): string {
    const member = this.host.typing.membersFor(from, to)[0];
    if (member === undefined) throw new Error(`internal error: '${this.host.typing.show(from)}' has no member in '${this.host.typing.show(to)}' to go into`);
    const slot = this.host.alloca(llvmOf(this.host.typing, to));
    this.host.emit(`store i32 ${this.host.typing.rec(to).members.indexOf(member)}, ptr ${slot}`);
    const value = this.convert(v, from, member);
    if (typeof member === "string" || this.host.typing.rec(member).kind !== "literal") {
      const at = this.host.temp();
      this.host.emit(`${at} = getelementptr ${llvmOf(this.host.typing, to)}, ptr ${slot}, i32 0, i32 1`);
      // The payload is i64 words, aligned to 8 however wide a member is.
      this.host.emit(`store ${llvmOf(this.host.typing, member)} ${value}, ptr ${at}, align 8`);
    }
    const result = this.host.temp();
    this.host.emit(`${result} = load ${llvmOf(this.host.typing, to)}, ptr ${slot}`);
    return result;
  }

  // The payload of a union known to hold a member of type `to`, or a union of some members.
  payload(this: Mut<this>, v: string, from: UnionType, to: Type): string {
    if (typeof to !== "string" && this.host.typing.rec(to).kind === "literal") return "zeroinitializer";
    const slot = this.host.alloca(llvmOf(this.host.typing, from));
    this.host.emit(`store ${llvmOf(this.host.typing, from)} ${v}, ptr ${slot}`);
    const at = this.host.temp();
    this.host.emit(`${at} = getelementptr ${llvmOf(this.host.typing, from)}, ptr ${slot}, i32 0, i32 1`);
    const result = this.host.temp();
    this.host.emit(`${result} = load ${llvmOf(this.host.typing, to)}, ptr ${at}, align 8`);
    return result;
  }

  // Moves a value between unions: each member the source may hold goes into the target's
  // member for it, which may sit at another index. Narrowing to fewer members leaves some
  // that can't be held here, and those get no case.
  retag(this: Mut<this>, v: string, from: UnionType, to: UnionType): string {
    const result = this.host.alloca(llvmOf(this.host.typing, to));
    const tag = this.host.temp();
    this.host.emit(`${tag} = extractvalue ${llvmOf(this.host.typing, from)} ${v}, 0`);
    // A member that holds itself, which narrowing opened up, gives the member its block holds.
    const opened = (m: Type) => {
      const r = typeof m === "string" ? undefined : this.host.typing.rec(m);
      if (r?.kind !== "recursive" || this.host.typing.membersFor(m, to).length > 0 || typeof r.of === "string") return false;
      const of = this.host.typing.rec(r.of);
      return of.kind === "union" && of.members.some((x) => this.host.typing.membersFor(x, to).length > 0);
    };
    const { members } = this.host.typing.rec(from);
    const held = members.filter((m) => this.host.typing.membersFor(m, to).length > 0 || opened(m));
    const cases = held.map(() => this.host.label());
    const end = this.host.label();
    this.host.emit(`switch i32 ${tag}, label %${end} [ ${held.map((m, i) => `i32 ${members.indexOf(m)}, label %${cases[i]}`).join(" ")} ]`);
    held.forEach((member, i) => {
      this.host.startBlock(cases[i]!);
      this.host.emit(`store ${llvmOf(this.host.typing, to)} ${opened(member) ? this.convert(this.payload(v, from, member), member, to) : this.inject(this.payload(v, from, member), member, to)}, ptr ${result}`);
      this.host.emit(`br label %${end}`);
    });
    this.host.startBlock(end);
    const out = this.host.temp();
    this.host.emit(`${out} = load ${llvmOf(this.host.typing, to)}, ptr ${result}`);
    return out;
  }
}
