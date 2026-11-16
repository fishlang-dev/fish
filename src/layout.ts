import type { Builder } from "./arithmetic.ts";
import assert from "node:assert";
import { category, ofKind, typeofTest, type Kind, type Verdict } from "./narrow.ts";
import type { Expr } from "./parser.ts";
import { rustClassOf } from "./rust.ts";
import { byteSize, words } from "./sizes.ts";
import type { Tables } from "./compilation.ts";
import { idOf, integerInfo, isInteger, isLock, isNumeric, literalText, type ArrayType, type ClassType, type Field, type LiteralType, type ObjectType, type Type, type UnionType, type Typing } from "./typing.ts";

// How each type is laid out in LLVM IR, and how a value moves between two types that hold it
// differently.

function primitive(t: string): string {
  if (t === "i8" || t === "u8") return "i8";
  if (t === "i16" || t === "u16") return "i16";
  if (t === "i32" || t === "u32") return "i32";
  if (t === "i64" || t === "u64" || t === "isize" || t === "usize") return "i64";
  if (t === "i128" || t === "u128") return "i128";
  if (t === "f32") return "float";
  if (t === "f64") return "double";
  if (t === "boolean") return "i1";
  if (t === "void") return "void";
  if (t === "null" || t === "never") return "{}";
  return "ptr";
}

// A type with a brand or a settled type parameter read through, without making any new type.
function settled(typing: Ref<Typing>, t: Type): Type {
  if (typeof t === "string") return t;
  const r = typing.rec(t);
  if (r.kind === "brand") return r.base;
  if (r.kind === "param" && r.concrete !== undefined && r.within !== true) return settled(typing, r.concrete);
  return t;
}

// The LLVM type a value of `t` is held as. An object is a literal struct of its fields, in
// their sorted order. An instance is a literal struct of the base it embeds, if any, then its
// own fields in declaration order. A union is its member's index, then enough 64-bit words for
// its largest member.
export function llvmOf(typing: Ref<Typing>, t: Type): string {
  if (typeof t === "string") return primitive(t);
  const r = typing.rec(t);
  if (r.kind === "brand") return llvmOf(typing, r.base);
  // A Rust type's handle is the pointer to its boxed value, the one field its class has.
  if (r.kind === "ref" || r.kind === "pointer" || r.kind === "handle" || r.kind === "shared" || r.kind === "block" || r.kind === "map" || r.kind === "regex" || r.kind === "recursive" || rustClassOf(typing, t) !== undefined) return "ptr";
  if (r.kind === "array") return ARRAY;
  if (r.kind === "fixed") return `[${r.size} x ${llvmOf(typing, r.element)}]`;
  if (r.kind === "dyn") return DYN;
  if (r.kind === "union") return `{ i32, [${words(typing, t as UnionType)} x i64] }`;
  // Atomic instructions need whole bytes, so an atomic boolean is a byte.
  if (r.kind === "interior") return isLock(r) ? `{ i32, ${llvmOf(typing, r.of)} }` : r.which === "Atomic" && settled(typing, r.of) === "boolean" ? "i8" : llvmOf(typing, r.of);
  let parts: string[] = [];
  if (r.kind === "class" && r.base !== undefined) parts.push(llvmOf(typing, r.base));
  const held: Ref<Field[]> = r.kind === "generator" || r.kind === "future" ? r.frame : r.fields;
  for (const f of held) parts.push(llvmOf(typing, f.type));
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
// `tables` holds what checking recorded, the program's types among it. `operandOf` gives the value of an operand of a test,
// and `valueType` its type.
export interface Slots extends Builder {
  tables: Tables;
  text(this: Mut<this>, value: string): string;
  deep(this: Mut<this>, a: string, b: string, type: Type): string;
  inspect(this: Mut<this>, v: string, type: Type): string;
  operandOf(this: Mut<this>, x: Ref<Expr>, test: Ref<Expr>, guarded: boolean): string;
  valueType(this: Mut<this>, e: Ref<Expr>): Type;
}

// Whether values of a type compare part by part rather than as one word.
export const compound = (typing: Ref<Typing>, t: Type): boolean => typeof t !== "string" && ["object", "class", "array", "fixed", "recursive", "variant"].includes(typing.kindOf(t));

// Which members of a union a test asks for: those of a kind (`instanceof Map`), of a `typeof`
// category, having the key a narrowing test named, holding a value, or giving a type.
export type Wanted =
  | { by: "kind"; kind: Kind }
  | { by: "category"; name: string }
  | { by: "key"; test: usize }
  | { by: "present" }
  | { by: "gives"; type: Type; unknown: boolean };

// A branch per member of a union, each storing its result where the branches join.
export type Branch = { result: string; cases: string[]; end: string; members: Type[] };

// The operand a kind test looks at.
function testedOf(e: Ref<Expr>): Ref<Expr> {
  if (e.kind === "call") return e.args[0]!;
  if (e.kind === "binary") return e.left;
  return e;
}

export const textOf = (e: Ref<Expr>): string => (e.kind === "string" ? e.value : "");

// A literal type's value as text, or undefined for any other type.
function literalOf(typing: Ref<Typing>, t: Type): string | undefined {
  if (typeof t === "string") return undefined;
  const r = typing.rec(t);
  return r.kind === "literal" ? literalText(r.value) : undefined;
}

// A literal type's base type, or the type itself.
function baseOf(typing: Ref<Typing>, t: Type): Type {
  if (literalOf(typing, t) === undefined) return t;
  return typing.baseOf(t as LiteralType);
}

export class Conversions<H extends Slots> {
  host: Mut<H>;

  constructor(host: Mut<H>) {
    this.host = host;
  }

  ll(t: Type): string {
    return llvmOf(this.host.tables.typing, t);
  }

  // A union's members, or none for any other type.
  membersOf(t: Type): Type[] {
    let out: Type[] = [];
    if (typeof t === "string") return out;
    const r = this.host.tables.typing.rec(t);
    if (r.kind === "union") for (const m of r.members) out.push(m);
    return out;
  }

  isUnion(t: Type): boolean {
    return typeof t !== "string" && this.host.tables.typing.kindOf(t) === "union";
  }

  // What a reference points to or a recursive type's block holds, or undefined.
  heldIn(t: Type): Type | undefined {
    if (typeof t === "string") return undefined;
    const r = this.host.tables.typing.rec(t);
    return r.kind === "ref" ? r.to : r.kind === "recursive" ? r.of : undefined;
  }

  // What a recursive type's block holds, or undefined.
  blockOf(t: Type): Type | undefined {
    if (typeof t === "string") return undefined;
    const r = this.host.tables.typing.rec(t);
    return r.kind === "recursive" ? r.of : undefined;
  }

  // What a reference points to, or undefined.
  refTo(t: Type): Type | undefined {
    if (typeof t === "string") return undefined;
    const r = this.host.tables.typing.rec(t);
    return r.kind === "ref" ? r.to : undefined;
  }

  verdict(test: usize, m: Type): Verdict {
    return this.host.tables.keyTests.getById(test)!.get(m)!;
  }

  wants(this: Mut<this>, w: Ref<Wanted>, m: Type): boolean {
    if (w.by === "kind") return ofKind(this.host.tables.typing, m, w.kind);
    if (w.by === "category") return category(this.host.tables.typing, m) === w.name;
    if (w.by === "key") return this.verdict(w.test, m) === "yes";
    if (w.by === "present") return m !== "null";
    return w.unknown ? this.host.tables.typing.unknownGives(m, w.type) : this.host.tables.typing.fits(m, w.type);
  }

  // Lowers `typeof x === "name"`, `x instanceof Map` and `Array.isArray(x)`, or `x === v` with
  // x a union, to a check of x's tag, and of its payload when v isn't a literal. Undefined for
  // any other comparison. `guarded` says the test's left operand is kept from its right one.
  test(this: Mut<this>, e: Ref<Expr>, guarded: boolean): string | undefined {
    const instance = this.host.tables.kindTests.get(e);
    if (instance !== undefined) {
      const tested = testedOf(e);
      const type = this.host.valueType(tested);
      const v = this.host.operandOf(tested, e, guarded);
      return this.holdsWhere(v, type, { by: "kind", kind: instance });
    }
    if (e.kind !== "binary") return undefined;
    if (this.host.tables.keyTests.has(e)) {
      const v = this.host.operandOf(e.right, e, guarded);
      const type = this.host.valueType(e.right);
      return this.hasKey(v, type, e.id, textOf(e.left));
    }
    if (e.op === "instanceof") {
      const type = this.host.valueType(e.left);
      const c = this.host.valueType(e.right);
      const v = this.host.operandOf(e.left, e, guarded);
      if (!this.isUnion(type)) return String(this.host.tables.typing.isSubclass(type, c));
      let sub: Type[] = [];
      for (const m of this.membersOf(type)) if (this.host.tables.typing.isSubclass(m, c)) sub.push(m);
      return this.holds(v, type as UnionType, sub);
    }
    if (e.op !== "===" && e.op !== "!==") return undefined;
    const kind = typeofTest(e);
    let result: string;
    if (kind !== undefined) {
      const v = this.host.operandOf(kind.operand, e, guarded);
      const type = this.host.valueType(kind.operand);
      const name = textOf(kind.name);
      const to = this.refTo(type);
      const through = to !== undefined && this.host.tables.typing.isPlainJs(to);
      if (this.host.tables.typing.isPlainJs(type) || through) {
        const box = through ? this.host.temp() : v;
        const found = this.host.temp();
        if (through) this.host.emit(`${box} = load ptr, ptr ${v}`);
        const text = this.host.text(name);
        this.host.emit(`${found} = call i32 @fsh_rt_js_typeof(ptr ${box}, ptr ${text})`);
        result = this.host.temp();
        this.host.emit(`${result} = icmp ne i32 ${found}, 0`);
      } else result = this.holdsWhere(v, type, { by: "category", name });
    } else {
      const left = this.host.valueType(e.left);
      const right = this.host.valueType(e.right);
      if (!this.isUnion(left) && !this.isUnion(right)) return undefined;
      const u = this.host.operandOf(e.left, e, guarded);
      const o = this.host.operandOf(e.right, e, guarded);
      result = this.equals(u, left, o, right);
    }
    if (e.op === "===") return result;
    const negated = this.host.temp();
    this.host.emit(`${negated} = xor i1 ${result}, true`);
    return negated;
  }

  // Whether `v` has `key`, by the member it holds; a member whose `key` is optional has it when
  // the field holds a value, as Fish can't tell one left out from one set empty. `test` is the
  // narrowing test whose verdicts on each member the checker recorded.
  hasKey(this: Mut<this>, v: string, type: Type, test: usize, key: string): string {
    const inner = this.heldIn(type);
    if (inner !== undefined) {
      const loaded = this.host.temp();
      this.host.emit(`${loaded} = load ${this.ll(inner)}, ptr ${v}`);
      return this.hasKey(loaded, inner, test, key);
    }
    if (this.isUnion(type)) {
      let both = false;
      for (const m of this.membersOf(type)) if (this.verdict(test, m) === "both") both = true;
      if (!both) return this.holdsWhere(v, type, { by: "key", test });
      const b = this.branch(v, type as UnionType, "boolean");
      for (let i: usize = 0; i < b.members.length; i++) {
        const part = this.arm(b, i, v, type as UnionType);
        const made = this.hasKey(part, b.members[i]!, test, key);
        this.armDone(b, "boolean", made);
      }
      return this.joined(b, "boolean");
    }
    const verdict = this.verdict(test, type);
    if (verdict !== "both") return String(verdict === "yes");
    const holder = type as ObjectType | ClassType;
    const field = this.host.tables.typing.field(holder, key)!.type;
    const read = this.host.temp();
    const path = this.host.tables.typing.fieldPath(holder, key).join(", ");
    this.host.emit(`${read} = extractvalue ${this.ll(type)} ${v}, ${path}`);
    return this.holdsWhere(read, field, { by: "present" });
  }

  // Whether two values are equal, as JavaScript's `===` would find them. A union is compared
  // by the member it holds, so only that member's payload is read; literals compare by value,
  // so two enum members that share a value are equal.
  equals(this: Mut<this>, a: string, aType: Type, b: string, bType: Type): string {
    // A member that holds itself is compared as what its block holds, unless both sides are it.
    const aBlock = this.blockOf(aType);
    if (aBlock !== undefined && aType !== bType) {
      const loaded = this.host.temp();
      this.host.emit(`${loaded} = load ${this.ll(aBlock)}, ptr ${a}`);
      return this.equals(loaded, aBlock, b, bType);
    }
    if (this.blockOf(bType) !== undefined && aType !== bType) return this.equals(b, bType, a, aType);
    const bBase = baseOf(this.host.tables.typing, bType);
    if (this.isUnion(aType)) {
      // An unknown holds JavaScript's numbers, which are equal across the kinds Fish has.
      const unknown = this.host.tables.typing.rec(aType as UnionType).unknown === true;
      const other = literalOf(this.host.tables.typing, bType) ?? b;
      const u = this.branch(a, aType as UnionType, "boolean");
      for (let i: usize = 0; i < u.members.length; i++) {
        const m = u.members[i]!;
        const part = this.arm(u, i, a, aType as UnionType);
        const numbers = unknown && isNumeric(m) && isNumeric(bBase) && m !== bBase;
        const made = numbers ? this.sameNumber(part, m, other, bBase) : this.equals(part, m, b, bType);
        this.armDone(u, "boolean", made);
      }
      return this.joined(u, "boolean");
    }
    if (this.isUnion(bType)) return this.equals(b, bType, a, aType);
    // A reference held in a value is compared through, as a reference on its own is.
    const aTo = this.refTo(aType);
    if (aTo !== undefined) {
      const loaded = this.host.temp();
      this.host.emit(`${loaded} = load ${this.ll(aTo)}, ptr ${a}`);
      return this.equals(loaded, aTo, b, bType);
    }
    if (this.refTo(bType) !== undefined) return this.equals(b, bType, a, aType);
    const aLiteral = literalOf(this.host.tables.typing, aType);
    const bLiteral = literalOf(this.host.tables.typing, bType);
    if (aLiteral !== undefined && bLiteral !== undefined) return String(this.sameLiteral(aType, bType));
    const aBase = baseOf(this.host.tables.typing, aType);
    if (aBase === bBase && compound(this.host.tables.typing, aType)) return this.host.deep(a, b, aType);
    if (aBase !== bBase || typeof aBase !== "string") return "false";
    if (aBase === "null") return "true";
    if (aBase === "bigint") {
      const same = this.host.temp();
      this.host.emit(`${same} = call i1 @fsh_rt_big_equal(ptr ${a}, ptr ${b})`);
      return same;
    }
    if (aBase === "string") {
      const order = this.host.temp();
      const left = this.convert(a, aType, "string");
      const right = this.convert(b, bType, "string");
      this.host.emit(`${order} = call i32 @fsh_rt_str_compare(ptr ${left}, ptr ${right})`);
      const same = this.host.temp();
      this.host.emit(`${same} = icmp eq i32 ${order}, 0`);
      return same;
    }
    const result = this.host.temp();
    const float = aBase === "f32" || aBase === "f64";
    this.host.emit(`${result} = ${float ? "fcmp oeq" : "icmp eq"} ${this.ll(aBase)} ${aLiteral ?? a}, ${bLiteral ?? b}`);
    return result;
  }

  // Whether two literal types hold one value.
  sameLiteral(a: Type, b: Type): boolean {
    const x = this.host.tables.typing.rec(a as LiteralType);
    const y = this.host.tables.typing.rec(b as LiteralType);
    return x.value === y.value;
  }

  // A field every member of the union has, read from whichever member it holds.
  unionField(this: Mut<this>, v: string, union: UnionType, name: string, to: Type): string {
    const b = this.branch(v, union, to);
    for (let i: usize = 0; i < b.members.length; i++) {
      const part = this.arm(b, i, v, union);
      const made = this.memberField(part, b.members[i]!, name, to);
      this.armDone(b, to, made);
    }
    return this.joined(b, to);
  }

  memberField(this: Mut<this>, part: string, member: Type, name: string, to: Type): string {
    // A member holding the union again keeps its value in a block.
    const of = this.blockOf(member);
    if (of !== undefined) {
      const loaded = this.host.temp();
      this.host.emit(`${loaded} = load ${this.ll(of)}, ptr ${part}`);
      if (this.isUnion(of)) return this.unionField(loaded, of as UnionType, name, to);
      part = loaded;
      member = of;
    }
    // The checker found the field on every member, so each is an object or an instance.
    const holder = member as ObjectType | ClassType;
    const value = this.host.temp();
    const path = this.host.tables.typing.fieldPath(holder, name).join(", ");
    this.host.emit(`${value} = extractvalue ${this.ll(member)} ${part}, ${path}`);
    const type = this.host.tables.typing.field(holder, name)!.type;
    return this.convert(value, type, to);
  }

  // Starts a value of `to` made from whichever member the union holds, branching on its tag.
  // The caller makes each member's value between `arm` and `armDone`, then reads it with
  // `joined`. This also reads an enum, a union of integer literals, as an i64.
  branch(this: Mut<this>, v: string, union: UnionType, to: Type): Branch {
    const result = this.host.alloca(this.ll(to));
    const tag = this.host.temp();
    this.host.emit(`${tag} = extractvalue ${this.ll(union)} ${v}, 0`);
    const members = this.membersOf(union);
    let cases: string[] = [];
    for (let i: usize = 0; i < members.length; i++) cases.push(this.host.label());
    const end = this.host.label();
    this.host.emit(`switch i32 ${tag}, label %${end} [ ${cases.map((c, i) => `i32 ${i}, label %${c}`).join(" ")} ]`);
    return { result, cases, end, members };
  }

  // Enters the branch for member `i`, giving that member's payload.
  arm(this: Mut<this>, b: Ref<Branch>, i: usize, v: string, union: UnionType): string {
    this.host.startBlock(b.cases[i]!);
    return this.payload(v, union, b.members[i]!);
  }

  armDone(this: Mut<this>, b: Ref<Branch>, to: Type, value: string): void {
    this.host.emit(`store ${this.ll(to)} ${value}, ptr ${b.result}`);
    this.host.emit(`br label %${b.end}`);
  }

  joined(this: Mut<this>, b: Ref<Branch>, to: Type): string {
    this.host.startBlock(b.end);
    const out = this.host.temp();
    this.host.emit(`${out} = load ${this.ll(to)}, ptr ${b.result}`);
    return out;
  }

  // A value of `to` read from an unknown that narrowing has shown holds a member giving one. A
  // number read as JavaScript's `number` is converted to an f64.
  fromUnknown(this: Mut<this>, v: string, from: UnionType, to: Type): string {
    const members = this.membersOf(from);
    let held: Type[] = [];
    for (const m of members) if (this.host.tables.typing.unknownGives(m, to)) held.push(m);
    if (held.length === 1 && held[0] === to) return this.payload(v, from, to);
    const result = this.host.alloca(this.ll(to));
    const tag = this.host.temp();
    this.host.emit(`${tag} = extractvalue ${this.ll(from)} ${v}, 0`);
    let cases: string[] = [];
    for (let i: usize = 0; i < held.length; i++) cases.push(this.host.label());
    const end = this.host.label();
    this.host.emit(`switch i32 ${tag}, label %${end} [ ${held.map((m, i) => `i32 ${members.indexOf(m)}, label %${cases[i as usize]}`).join(" ")} ]`);
    for (let i: usize = 0; i < held.length; i++) {
      const member = held[i]!;
      this.host.startBlock(cases[i]!);
      const part = this.payload(v, from, member);
      const kept = this.isUnion(to) && this.host.tables.typing.membersFor(member, to as UnionType).length > 0;
      const number = isNumeric(member) && member !== "f64" && !kept;
      let made: string;
      if (number) {
        const double = this.asDouble(part, member);
        made = this.convert(double, "f64", to);
      } else made = this.convert(part, member, to);
      this.host.emit(`store ${this.ll(to)} ${made}, ptr ${result}`);
      this.host.emit(`br label %${end}`);
    }
    this.host.startBlock(end);
    const out = this.host.temp();
    this.host.emit(`${out} = load ${this.ll(to)}, ptr ${result}`);
    return out;
  }

  // Two numbers of different kinds, equal by value: integers exactly, as i128, and through f64
  // only when one is a float, as codegen's mixed comparisons do.
  // ponytail: a u128 beside a signed type compares as i128, wrong past i128's range.
  sameNumber(this: Mut<this>, a: string, aType: Type, b: string, bType: Type): string {
    const result = this.host.temp();
    if (isInteger(aType) && isInteger(bType)) {
      const left = this.wide(a, aType);
      const right = this.wide(b, bType);
      this.host.emit(`${result} = icmp eq i128 ${left}, ${right}`);
    } else {
      const left = this.asDouble(a, aType);
      const right = this.asDouble(b, bType);
      this.host.emit(`${result} = fcmp oeq double ${left}, ${right}`);
    }
    return result;
  }

  wide(this: Mut<this>, v: string, from: Type): string {
    if (from === "i128" || from === "u128") return v;
    const result = this.host.temp();
    const signed = isInteger(from) && integerInfo(from).signed;
    this.host.emit(`${result} = ${signed ? "sext" : "zext"} ${this.ll(from)} ${v} to i128`);
    return result;
  }

  asDouble(this: Mut<this>, v: string, from: Type): string {
    if (from === "f64") return v;
    const result = this.host.temp();
    if (from === "f32") this.host.emit(`${result} = fpext float ${v} to double`);
    else {
      const signed = isInteger(from) && integerInfo(from).signed;
      this.host.emit(`${result} = ${signed ? "sitofp" : "uitofp"} ${this.ll(from)} ${v} to double`);
    }
    return result;
  }

  // Whether a member holds itself with members `w` answers differently for, so its block has
  // to be looked into.
  mixed(this: Mut<this>, m: Type, w: Ref<Wanted>): boolean {
    const inner = this.host.tables.typing.unfold(m);
    if (inner === m || !this.isUnion(inner)) return false;
    let yes = false;
    let no = false;
    for (const x of this.membersOf(inner)) {
      if (this.wants(w, x)) yes = true;
      else no = true;
    }
    return yes && no;
  }

  // Whether `v` holds a member `wanted` says yes to, looking into the block of a member that
  // holds itself, whose own members may answer differently.
  holdsWhere(this: Mut<this>, v: string, type: Type, wanted: Ref<Wanted>): string {
    const block = this.blockOf(type);
    if (block !== undefined) {
      const loaded = this.host.temp();
      this.host.emit(`${loaded} = load ${this.ll(block)}, ptr ${v}`);
      return this.holdsWhere(loaded, block, wanted);
    }
    if (!this.isUnion(type)) return String(this.wants(wanted, type));
    const members = this.membersOf(type);
    let nested: Type[] = [];
    let plain: Type[] = [];
    for (const m of members) {
      if (this.mixed(m, wanted)) nested.push(m);
      else if (this.wants(wanted, m)) plain.push(m);
    }
    const direct = this.holds(v, type as UnionType, plain);
    if (nested.length === 0) return direct;
    const result = this.host.alloca("i1");
    this.host.emit(`store i1 ${direct}, ptr ${result}`);
    const tag = this.host.temp();
    this.host.emit(`${tag} = extractvalue ${this.ll(type)} ${v}, 0`);
    const done = this.host.label();
    for (const m of nested) {
      const is = this.host.temp();
      const inside = this.host.label();
      const next = this.host.label();
      this.host.emit(`${is} = icmp eq i32 ${tag}, ${members.indexOf(m)}`);
      this.host.emit(`br i1 ${is}, label %${inside}, label %${next}`);
      this.host.startBlock(inside);
      const part = this.payload(v, type as UnionType, m);
      const held = this.holdsWhere(part, m, wanted);
      this.host.emit(`store i1 ${held}, ptr ${result}`);
      this.host.emit(`br label %${done}`);
      this.host.startBlock(next);
    }
    this.host.emit(`br label %${done}`);
    this.host.startBlock(done);
    const answer = this.host.temp();
    this.host.emit(`${answer} = load i1, ptr ${result}`);
    return answer;
  }

  // Whether a union holds one of these members.
  holds(this: Mut<this>, v: string, union: UnionType, members: Ref<Type[]>): string {
    const tag = this.host.temp();
    this.host.emit(`${tag} = extractvalue ${this.ll(union)} ${v}, 0`);
    let result = "false";
    const all = this.membersOf(union);
    for (const m of members) {
      const is = this.host.temp();
      const next = this.host.temp();
      this.host.emit(`${is} = icmp eq i32 ${tag}, ${all.indexOf(m)}`);
      this.host.emit(`${next} = or i1 ${result}, ${is}`);
      result = next;
    }
    return result;
  }

  // Whether a union holds `t` as one of its members.
  within(t: Type, u: Type): boolean {
    return this.membersOf(u).includes(t);
  }

  isJsValue(t: Type): boolean {
    if (typeof t === "string") return false;
    const r = this.host.tables.typing.rec(t);
    return r.kind === "block" && r.which === "JsValue";
  }

  kindOf(t: Type): string {
    return typeof t === "string" ? "" : this.host.tables.typing.kindOf(t);
  }

  // A member of another kind than the narrowed type, an empty one or a scalar where an
  // aggregate is wanted, is one narrowing has left out, so it isn't there.
  // So is a string or boolean literal where the narrowed type is of another kind.
  absent(member: Type, to: Type): boolean {
    if (typeof member !== "string") {
      const lit = this.host.tables.typing.rec(member);
      if (lit.kind === "literal") return (typeof lit.value === "string" && to !== "string") || (typeof lit.value === "boolean" && to !== "boolean");
      return false;
    }
    return member !== to && (member === "null" || member === "never" || typeof to !== "string" || (member === "string") !== (to === "string") || (member === "boolean") !== (to === "boolean"));
  }

  // `v`, a value of `from`, as a value of `to`: copied down to fewer fields, built into a class,
  // put into a union, taken out of one, or moved between unions. The checker has made sure
  // `from` fits `to`, through exactly one member when `to` is a union.
  convert(this: Mut<this>, v: string, from: Type, to: Type): string {
    // Types that lower to the same one, as a field's type written with `?` and the type read from
    // it do, are laid out the same.
    if (from === to) return v;
    const lowFrom = this.host.tables.typing.lower(from);
    const lowTo = this.host.tables.typing.lower(to);
    if (lowFrom === lowTo) return v;
    // A recursive type's value lives in its block: read where another type is wanted, it is
    // loaded, and a value meeting one moves into a new block.
    // A union holding the block itself takes it, or gives it, as is.
    const fromBlock = this.blockOf(from);
    if (fromBlock !== undefined && !this.within(from, to)) {
      const loaded = this.host.temp();
      this.host.emit(`${loaded} = load ${this.ll(fromBlock)}, ptr ${v}`);
      return this.convert(loaded, fromBlock, to);
    }
    const toBlock = this.blockOf(to);
    if (toBlock !== undefined && !this.within(to, from)) {
      const block = this.host.temp();
      this.host.emit(`${block} = call ptr @fsh_rt_alloc(i64 ${byteSize(this.host.tables.typing, toBlock)})`);
      const inner = this.convert(v, from, toBlock);
      this.host.emit(`store ${this.ll(toBlock)} ${inner}, ptr ${block}`);
      return block;
    }
    const fk = this.kindOf(from);
    const tk = this.kindOf(to);
    // Raw pointers are addresses, whatever they point at or may write.
    if (fk === "pointer" && tk === "pointer") return v;
    // Every regex is a pointer to its program.
    if (fk === "regex" && tk === "regex") return v;
    // Stored callables taking and giving the same types share a layout and a vtable shape.
    if (fk === "dyn" && tk === "dyn") return v;
    // A string literal's type takes no space; as a string, it is its static block.
    const literal = literalOf(this.host.tables.typing, from);
    if (to === "string" && literal !== undefined) return this.host.text(literal);
    // Code holding a `never` value never runs.
    if (from === "never") return "undef";
    // A JS value is the same box whichever declared shape it meets.
    if (this.isJsValue(from) && this.isJsValue(to)) return v;
    // An empty array literal holds no element to convert, and an array of JS values holds the
    // same boxes whichever shape each is declared to have.
    if (fk === "array" && tk === "array") {
      const fromElement = this.host.tables.typing.rec(from as ArrayType).element;
      const toElement = this.host.tables.typing.rec(to as ArrayType).element;
      if (fromElement === "never" || (this.isJsValue(fromElement) && this.isJsValue(toElement))) return v;
    }
    // A reference read where its value is wanted loads it; a mutable one lent as shared is the
    // same pointer.
    // A reference going into a `Ref<T> | null` is its pointer, as the payload.
    const fromTo = this.refTo(from);
    if (fromTo !== undefined && this.host.tables.typing.optionRef(to) === undefined) {
      const toTo = this.refTo(to);
      if (toTo !== undefined) return this.lend(v, fromTo, toTo);
      const loaded = this.host.temp();
      this.host.emit(`${loaded} = load ${this.ll(fromTo)}, ptr ${v}`);
      return this.convert(loaded, fromTo, to);
    }
    // A literal's value is known, so leaving one makes a constant, and entering one keeps nothing.
    if (literal !== undefined && tk !== "union") return literal;
    if (tk === "literal") return "zeroinitializer";
    if (fk === "union" && this.host.tables.typing.rec(from as UnionType).unknown === true) return this.fromUnknown(v, from as UnionType, to);
    if (tk === "union") {
      return fk === "union" ? this.retag(v, from as UnionType, to as UnionType) : this.inject(v, from, to as UnionType);
    }
    if (fk === "union") {
      if (this.within(to, from)) return this.payload(v, from as UnionType, to);
      const b = this.branch(v, from as UnionType, to);
      for (let i: usize = 0; i < b.members.length; i++) {
        const member = b.members[i]!;
        const part = this.arm(b, i, v, from as UnionType);
        const made = this.absent(member, to) ? "undef" : this.convert(part, member, to);
        this.armDone(b, to, made);
      }
      return this.joined(b, to);
    }
    if (typeof from === "string" || typeof to === "string") return v;
    if (fk === "closure" || tk === "closure") return v;
    assert(fk !== "interface" && tk !== "interface" && fk !== "param" && tk !== "param" && fk !== "function" && tk !== "function", "internal error: an interface or a type parameter reached codegen");
    // A class built from a literal starts with its embedded base, built the same way.
    const target = to as ObjectType | ClassType;
    const embeds = this.baseClass(to);
    let result = "undef";
    if (embeds !== undefined) {
      const base = this.convert(v, from, embeds);
      result = this.inserted(result, to, base, embeds, 0);
    }
    const fields = this.fieldsOf(target);
    for (let i: usize = 0; i < fields.length; i++) {
      const name = fields[i]![0];
      const type = fields[i]![1];
      const at = i + (embeds !== undefined ? 1 : 0);
      // An optional field the value leaves out is empty.
      const given = this.host.tables.typing.field(from, name);
      if (given === undefined) {
        const empty = this.convert("zeroinitializer", "null", type);
        result = this.inserted(result, to, empty, type, at);
        continue;
      }
      const givenType = given.type;
      const part = this.host.temp();
      const path = this.host.tables.typing.fieldPath(from as ObjectType | ClassType, name).join(", ");
      this.host.emit(`${part} = extractvalue ${this.ll(from)} ${v}, ${path}`);
      const made = this.convert(part, givenType, type);
      result = this.inserted(result, to, made, type, at);
    }
    return result;
  }

  // The class a class embeds as its base, or undefined.
  baseClass(t: Type): Type | undefined {
    if (typeof t === "string") return undefined;
    const r = this.host.tables.typing.rec(t);
    return r.kind === "class" ? r.base : undefined;
  }

  // An object's or instance's own fields, each as its name and type.
  fieldsOf(t: ObjectType | ClassType): [string, Type][] {
    let out: [string, Type][] = [];
    const r = this.host.tables.typing.rec(t);
    for (const f of r.fields) out.push([f.name, f.type]);
    return out;
  }

  // `result` with `part`, a value of `type`, put in at field `i`.
  inserted(this: Mut<this>, result: string, to: Type, part: string, type: Type, i: usize): string {
    const next = this.host.temp();
    this.host.emit(`${next} = insertvalue ${this.ll(to)} ${result}, ${this.ll(type)} ${part}, ${i}`);
    return next;
  }

  // A pointer to a `from` lent as one to a `to`: the same pointer, its payload when `to` is
  // one member of the union `from`, or else a slot holding a copy converted to `to`.
  lend(this: Mut<this>, v: string, from: Type, to: Type): string {
    if (from === to) return v;
    // A reference to a place holding a recursive type's block lends the block itself.
    const of = this.blockOf(from);
    if (of !== undefined && to !== from) {
      const block = this.host.temp();
      this.host.emit(`${block} = load ptr, ptr ${v}`);
      return this.lend(block, of, to);
    }
    // An unknown narrowed to a number may hold another kind of number, converted on its way out.
    if (this.isUnion(from) && this.lendsPayload(from as UnionType, to)) {
      const at = this.host.temp();
      this.host.emit(`${at} = getelementptr ${this.ll(from)}, ptr ${v}, i32 0, i32 1`);
      return at;
    }
    const loaded = this.host.temp();
    this.host.emit(`${loaded} = load ${this.ll(from)}, ptr ${v}`);
    const slot = this.host.alloca(this.ll(to));
    const made = this.convert(loaded, from, to);
    this.host.emit(`store ${this.ll(to)} ${made}, ptr ${slot}`);
    return slot;
  }

  // Whether a union's payload is already a `to`: it holds `to`, or an object laid out alike,
  // and isn't an unknown holding another member that gives one.
  lendsPayload(this: Mut<this>, from: UnionType, to: Type): boolean {
    const members = this.membersOf(from);
    let holds = false;
    for (const m of members) {
      if (m === to || (this.kindOf(m) === "object" && this.alike(m, to, new Map<string, boolean>()))) {
        holds = true;
        break;
      }
    }
    if (!holds) return false;
    if (this.host.tables.typing.rec(from).unknown !== true) return true;
    for (const m of members) if (m !== to && this.host.tables.typing.unknownGives(m, to)) return false;
    return true;
  }

  // Whether two types are laid out alike: a union holding itself keeps its own records for
  // codegen, while a type narrowed to one of its members was lowered to fresh ones of the same
  // shape. A pair met again inside itself is taken as alike, and each pair is decided once.
  alike(a: Type, b: Type, seen: Mut<Map<string, boolean>>): boolean {
    if (a === b) return true;
    if (typeof a === "string" || typeof b === "string") return false;
    const ak = this.kindOf(a);
    if (ak !== this.kindOf(b)) return false;
    const pair = `${idOf(a)},${idOf(b)}`;
    const known = seen.get(pair);
    if (known !== undefined) return known;
    seen.set(pair, true);
    let same = false;
    if (ak === "recursive") same = this.alike(this.blockOf(a)!, this.blockOf(b)!, seen);
    else if (ak === "array") same = this.alike(this.host.tables.typing.rec(a as ArrayType).element, this.host.tables.typing.rec(b as ArrayType).element, seen);
    else if (ak === "union") {
      const xs = this.membersOf(a);
      const ys = this.membersOf(b);
      same = xs.length === ys.length;
      for (let i: usize = 0; same && i < xs.length; i++) same = this.alike(xs[i]!, ys[i]!, seen);
    } else if (ak === "object" && this.host.tables.typing.rec(a as ObjectType).tuple === this.host.tables.typing.rec(b as ObjectType).tuple) {
      const xs = this.fieldsOf(a as ObjectType);
      const ys = this.fieldsOf(b as ObjectType);
      same = xs.length === ys.length;
      for (let i: usize = 0; same && i < xs.length; i++) same = xs[i]![0] === ys[i]![0] && this.alike(xs[i]![1], ys[i]![1], seen);
    }
    seen.set(pair, same);
    return same;
  }

  // Sets the tag of the member `from` goes into, and stores its value as the payload.
  inject(this: Mut<this>, v: string, from: Type, to: UnionType): string {
    const found = this.host.tables.typing.membersFor(from, to);
    assert(found.length > 0, `internal error: '${this.host.tables.typing.show(from)}' has no member in '${this.host.tables.typing.show(to)}' to go into`);
    const member = found[0]!;
    const slot = this.host.alloca(this.ll(to));
    this.host.emit(`store i32 ${this.membersOf(to).indexOf(member)}, ptr ${slot}`);
    const value = this.convert(v, from, member);
    if (this.kindOf(member) !== "literal") {
      const at = this.host.temp();
      this.host.emit(`${at} = getelementptr ${this.ll(to)}, ptr ${slot}, i32 0, i32 1`);
      // The payload is i64 words, aligned to 8 however wide a member is.
      this.host.emit(`store ${this.ll(member)} ${value}, ptr ${at}, align 8`);
    }
    const result = this.host.temp();
    this.host.emit(`${result} = load ${this.ll(to)}, ptr ${slot}`);
    return result;
  }

  // The payload of a union known to hold a member of type `to`, or a union of some members.
  payload(this: Mut<this>, v: string, from: UnionType, to: Type): string {
    if (this.kindOf(to) === "literal") return "zeroinitializer";
    const slot = this.host.alloca(this.ll(from));
    this.host.emit(`store ${this.ll(from)} ${v}, ptr ${slot}`);
    const at = this.host.temp();
    this.host.emit(`${at} = getelementptr ${this.ll(from)}, ptr ${slot}, i32 0, i32 1`);
    const result = this.host.temp();
    this.host.emit(`${result} = load ${this.ll(to)}, ptr ${at}, align 8`);
    return result;
  }

  // Whether a member that holds itself, which narrowing opened up, gives a member `to` holds
  // through what its block holds.
  opened(this: Mut<this>, m: Type, to: UnionType): boolean {
    const of = this.blockOf(m);
    if (of === undefined || !this.isUnion(of)) return false;
    if (this.host.tables.typing.membersFor(m, to).length > 0) return false;
    for (const x of this.membersOf(of)) if (this.host.tables.typing.membersFor(x, to).length > 0) return true;
    return false;
  }

  // Moves a value between unions: each member the source may hold goes into the target's
  // member for it, which may sit at another index. Narrowing to fewer members leaves some
  // that can't be held here, and those get no case.
  retag(this: Mut<this>, v: string, from: UnionType, to: UnionType): string {
    const result = this.host.alloca(this.ll(to));
    const tag = this.host.temp();
    this.host.emit(`${tag} = extractvalue ${this.ll(from)} ${v}, 0`);
    const members = this.membersOf(from);
    let held: Type[] = [];
    let open: boolean[] = [];
    for (const m of members) {
      const direct = this.host.tables.typing.membersFor(m, to).length > 0;
      const through = !direct && this.opened(m, to);
      if (!direct && !through) continue;
      held.push(m);
      open.push(through);
    }
    let cases: string[] = [];
    for (let i: usize = 0; i < held.length; i++) cases.push(this.host.label());
    const end = this.host.label();
    this.host.emit(`switch i32 ${tag}, label %${end} [ ${held.map((m, i) => `i32 ${members.indexOf(m)}, label %${cases[i as usize]}`).join(" ")} ]`);
    for (let i: usize = 0; i < held.length; i++) {
      const member = held[i]!;
      this.host.startBlock(cases[i]!);
      const part = this.payload(v, from, member);
      const made = open[i]! ? this.convert(part, member, to) : this.inject(part, member, to);
      this.host.emit(`store ${this.ll(to)} ${made}, ptr ${result}`);
      this.host.emit(`br label %${end}`);
    }
    this.host.startBlock(end);
    const out = this.host.temp();
    this.host.emit(`${out} = load ${this.ll(to)}, ptr ${result}`);
    return out;
  }
}
