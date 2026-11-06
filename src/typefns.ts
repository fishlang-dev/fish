import { CompileError } from "./diag.ts";
import { collection } from "./resolve.ts";
import type { Span } from "./parser.ts";
import { TypeSet, isNumeric, type ClassType, type Field, type Hole, type ObjectType, type ParamType, type Type, type Typing } from "./typing.ts";

// The type parameter `t` is, or with `deep` the first anywhere in it, standing for no type yet.
export function openParam(typing: Ref<Typing>, t: Type, deep: boolean): ParamType | undefined {
  let seen = new TypeSet<Type>();
  return openParamIn(typing, t, deep, seen);
}

function openParamIn(typing: Ref<Typing>, t: Type, deep: boolean, seen: Mut<TypeSet<Type>>): ParamType | undefined {
  // A type holding itself is looked into once.
  if (typeof t === "string" || seen.has(t)) return undefined;
  seen.add(t);
  const r = typing.rec(t);
  if (r.kind === "param") return r.concrete !== undefined ? openParamIn(typing, r.concrete, deep, seen) : (t as ParamType);
  if (!deep) return undefined;
  for (const part of partsOf(typing, t)) {
    const open = openParamIn(typing, part, deep, seen);
    if (open !== undefined) return open;
  }
  return undefined;
}

// The types a type is made of, looked into for a type parameter.
function partsOf(typing: Ref<Typing>, t: Exclude<Type, string>): Type[] {
  const promised = typing.promiseElement(t);
  if (promised !== undefined) return [promised];
  const r = typing.rec(t);
  let parts: Type[] = [];
  if (r.kind === "union") for (const m of r.members) parts.push(m);
  else if (r.kind === "array") parts.push(r.element);
  else if (r.kind === "ref") parts.push(r.to);
  else if (r.kind === "object") for (const f of r.fields) parts.push(f.type);
  else if (r.kind === "class") {
    if (r.generic !== undefined) for (const a of r.generic.args) parts.push(a);
  } else if (r.kind === "function" || r.kind === "closure") {
    for (const p of r.params) parts.push(p);
    parts.push(r.returns);
  }
  return parts;
}

// A type function can't look inside a type parameter: the type it stands for is known only per
// instance. While a generic alias is checked before any use, the parameter stands in for the
// result, so the rest of the alias is still checked; generic function code is refused.
/** @throws {CompileError} */
export function standIn(typing: Ref<Typing>, types: Ref<Type[]>, what: string, at: Ref<Span>, deep: boolean, deferring: boolean): Type | undefined {
  for (const t of types) {
    const open = openParam(typing, t, deep);
    if (open === undefined) continue;
    if (deferring) return open;
    throw new CompileError("E0114", `${what} of the type parameter '${typing.rec(open).name}' isn't supported yet: it is computed while compiling, from a type known then`, at.start, at.end);
  }
  return undefined;
}

// What the type-level functions ask of the code using them: whether a class's fields are known,
// laying it out when first asked; whether a generic alias is being checked before any use; and
// whether a type fits another, an interface by shape, as `extends` asks.
export interface TypeFunctionsHost {
  typingOf(this: Mut<this>): Mut<Typing>;
  /** @throws {CompileError} */
  fieldsKnown(this: Mut<this>, c: ClassType): boolean;
  isDeferring(): boolean;
  /** @throws {CompileError} */
  conforms(this: Mut<this>, from: Type, to: Type, at: Span): boolean;
}

// The utility types by name: how many type arguments each takes, an example, which arguments it
// reads inside, and whether it compares them by fitting, which a type parameter anywhere in them
// would decide wrongly.
export const UTILITIES = new Map<string, [usize, string, usize[], boolean]>([
  ["Partial", [1, "Partial<User>", [0], false]],
  ["Required", [1, "Required<User>", [0], false]],
  ["Readonly", [1, "Readonly<User>", [0], false]],
  ["Pick", [2, 'Pick<User, "id">', [0, 1], false]],
  ["Omit", [2, 'Omit<User, "id">', [0, 1], false]],
  ["Record", [2, 'Record<"a" | "b", i64>', [0], false]],
  ["Exclude", [2, 'Exclude<"a" | "b", "a">', [0, 1], true]],
  ["Extract", [2, 'Extract<"a" | "b", "a">', [0, 1], true]],
  ["NonNullable", [1, "NonNullable<string | null>", [0], false]],
  ["ReturnType", [1, "ReturnType<typeof f>", [0], false]],
  ["Awaited", [1, "Awaited<Promise<i64>>", [0], false]],
  ["Uppercase", [1, 'Uppercase<"a">', [0], false]],
  ["Lowercase", [1, 'Lowercase<"A">', [0], false]],
  ["Capitalize", [1, 'Capitalize<"a">', [0], false]],
  ["Uncapitalize", [1, 'Uncapitalize<"A">', [0], false]],
]);

type Spelled = { quasis: string[]; holes: Hole[] };

// TypeScript's type-level functions, computed while compiling into ordinary types: `keyof`,
// indexed access, and the utility types. A class's fields are known once it is laid out.
export class TypeFunctions<H extends TypeFunctionsHost> {
  host: Mut<H>;

  constructor(host: Mut<H>) {
    this.host = host;
  }

  get typing(): Mut<Typing> {
    return this.host.typingOf();
  }

  private recOf(t: Type) {
    return typeof t === "string" ? undefined : this.typing.rec(t);
  }

  // What a type parameter that has been given a type stands for.
  private concreteOf(t: Type): Type | undefined {
    const r = this.recOf(t);
    return r !== undefined && r.kind === "param" ? r.concrete : undefined;
  }

  // The fields a type-level function reads: an object type's, or a class's public fields, which
  // are its data (a class's methods aren't values in Fish).
  /** @throws {CompileError} */
  fieldsOf(this: Mut<this>, t: Type, what: string, at: Ref<Span>): Field[] {
    const r = this.recOf(t);
    if (r !== undefined && r.kind === "object") {
      let out: Field[] = [];
      for (const f of r.fields) out.push(copyField(f));
      return out;
    }
    if (r !== undefined && r.kind === "class") {
      const name = r.name;
      if (!this.host.fieldsKnown(t as ClassType)) throw new CompileError("E0114", `${what} of '${name}' is needed while the field types of '${name}' are being worked out, so it can't be computed yet`, at.start, at.end);
      let out: Field[] = [];
      for (const f of this.typing.allFields(t as ClassType)) {
        if (f.access !== undefined && f.access !== "public") continue;
        let kept: Field = { name: f.name, type: f.type };
        if (f.readonly === true) kept.readonly = true;
        if (f.optional !== undefined) kept.optional = f.optional;
        out.push(kept);
      }
      return out;
    }
    const concrete = this.concreteOf(t);
    if (concrete !== undefined) return this.fieldsOf(concrete, what, at);
    if (r !== undefined && r.kind === "interface") {
      throw new CompileError("E0114", `${what} takes an object type or a class, not the interface '${this.typing.show(t)}', whose methods aren't values in Fish; any type with a method is an interface, so move its fields into a 'type' with no methods and use that`, at.start, at.end);
    }
    throw new CompileError("E0114", `${what} takes an object type or a class, not '${this.typing.show(t)}'`, at.start, at.end);
  }

  // The keys a type names: a string literal, or a union of them.
  /** @throws {CompileError} */
  keysOf(this: Mut<this>, k: Type, what: string, at: Ref<Span>): string[] {
    const concrete = this.concreteOf(k);
    if (concrete !== undefined) return this.keysOf(concrete, what, at);
    let keys: string[] = [];
    let all = true;
    for (const m of this.membersOf(k)) {
      const r = this.recOf(m);
      if (r !== undefined && r.kind === "literal" && typeof r.value === "string") keys.push(r.value);
      else all = false;
    }
    if (all) return keys;
    throw new CompileError("E0114", `${what} takes keys written as string literals, like '"a" | "b"', not '${this.typing.show(k)}'`, at.start, at.end);
  }

  // `keyof T`: the union of T's field names.
  /** @throws {CompileError} */
  keyofType(this: Mut<this>, t: Type, at: Ref<Span>): Type {
    const held = standIn(this.typing, [t], "'keyof'", at, false, this.host.isDeferring());
    if (held !== undefined) return held;
    const fields = this.fieldsOf(t, "'keyof'", at);
    if (fields.length === 0) throw new CompileError("E0114", `'${this.typing.show(t)}' has no public fields, so 'keyof' of it has no keys`, at.start, at.end);
    let keys: Type[] = [];
    for (const f of fields) keys.push(this.typing.literalType(f.name));
    return this.typing.unionType(keys);
  }

  // `T[K]`: the type of the field K names, or the union of those a union of keys names; an array's
  // `T[number]` is its element type.
  /** @throws {CompileError} */
  indexedType(this: Mut<this>, t: Type, k: Type, at: Ref<Span>, keyAt: Ref<Span>): Type {
    const held = standIn(this.typing, [t, k], "an indexed access type", at, false, this.host.isDeferring());
    if (held !== undefined) return held;
    const concrete = this.concreteOf(t);
    if (concrete !== undefined) return this.indexedType(concrete, k, at, keyAt);
    const r = this.recOf(t);
    if (r !== undefined && r.kind === "array") {
      if (isNumeric(k)) return r.element;
      throw new CompileError("E0114", `an array type is indexed by 'number', which gives its element type, here '${this.typing.show(r.element)}'`, keyAt.start, keyAt.end);
    }
    // A tuple's `T[number]` is the union of its elements, and `T[0]` its first.
    if (r !== undefined && r.kind === "object" && r.tuple === true) {
      const rest = r.rest;
      if (isNumeric(k)) {
        let all = this.typing.elementsOf(t as ObjectType);
        if (rest !== undefined) all.push(rest);
        return this.typing.unionType(all);
      }
      const kr = this.recOf(k);
      if (kr !== undefined && kr.kind === "literal" && kr.value === "length") return this.typing.tupleLength(t as ObjectType);
      let positions: bigint[] = [];
      let all = true;
      for (const m of this.membersOf(k)) {
        const mr = this.recOf(m);
        if (mr !== undefined && mr.kind === "literal" && typeof mr.value === "bigint") positions.push(mr.value);
        else all = false;
      }
      if (all) {
        const count = BigInt(this.typing.elementsOf(t as ObjectType).length);
        let types: Type[] = [];
        // A position past the fixed elements of a tuple with a rest element is the rest's type.
        for (const p of positions) {
          if (rest !== undefined && p >= count) types.push(rest);
          else types.push(this.fieldType(t, p.toString(), at, keyAt, undefined));
        }
        return this.typing.unionType(types);
      }
    }
    const names = this.keysOf(k, "an indexed access type", keyAt);
    // As in TypeScript, a union gives the union of each member's field, which every member must have.
    if (r !== undefined && r.kind === "union") {
      let types: Type[] = [];
      for (const m of this.membersOf(t)) {
        const mr = this.recOf(m);
        const kind = mr !== undefined ? mr.kind : undefined;
        if (kind !== "object" && kind !== "class" && kind !== "param") {
          throw new CompileError("E0114", `an indexed access type of a union takes object types or classes, but '${this.typing.show(t)}' has the member '${this.typing.show(m)}'`, at.start, at.end);
        }
        for (const name of names) types.push(this.fieldType(m, name, at, keyAt, t));
      }
      return this.typing.unionType(types);
    }
    let types: Type[] = [];
    for (const name of names) types.push(this.fieldType(t, name, at, keyAt, undefined));
    return this.typing.unionType(types);
  }

  // The type of the field `name` of t, which is a member of the union `whole` if given.
  /** @throws {CompileError} */
  private fieldType(this: Mut<this>, t: Type, name: string, at: Ref<Span>, keyAt: Ref<Span>, whole: Type | undefined): Type {
    let found: Type | undefined = undefined;
    for (const f of this.fieldsOf(t, "an indexed access type", at)) if (found === undefined && f.name === name) found = f.type;
    if (found === undefined) throw new CompileError("E0114", `'${name}' isn't a field of '${this.typing.show(t)}'${whole !== undefined ? `, a member of '${this.typing.show(whole)}'` : ""}`, keyAt.start, keyAt.end);
    return found;
  }

  // The utility type `name` applied to its type arguments, the span of the whole use and of each
  // argument, after the arguments it reads are checked for type parameters.
  /** @throws {CompileError} */
  utility(this: Mut<this>, name: string, args: Ref<Type[]>, at: Ref<Span>, argAt: Ref<Span[]>): Type {
    const entry = UTILITIES.get(name)!;
    let read: Type[] = [];
    for (const i of entry[2]) read.push(args[i]!);
    const held = standIn(this.typing, read, `'${name}'`, at, entry[3], this.host.isDeferring());
    return held !== undefined ? held : this.applyUtility(name, args, at, argAt);
  }

  /** @throws {CompileError} */
  private applyUtility(this: Mut<this>, name: string, args: Ref<Type[]>, at: Ref<Span>, argAt: Ref<Span[]>): Type {
    const first = args[0]!;
    switch (name) {
      case "Partial": return this.partialType(first, at);
      case "Required": return this.requiredType(first, at);
      case "Readonly": return this.readonlyType(first, at);
      case "Pick": return this.pickType(first, args[1]!, at, argAt[1]!);
      case "Omit": return this.omitType(first, args[1]!, at, argAt[1]!);
      case "Record": return this.recordType(first, args[1]!, at, argAt[0]!);
      case "Exclude": return this.excludeType(first, args[1]!, at);
      case "Extract": return this.extractType(first, args[1]!, at);
      case "NonNullable": return this.nonNullableType(first);
      case "ReturnType": return this.returnType(first, at);
      case "Awaited": return this.awaitedType(first);
      default: return this.intrinsic(name, first, at);
    }
  }

  // `Record<K, V>`: an object type with a field of type V for each key K names, or a dictionary
  // when K is `string`.
  /** @throws {CompileError} */
  private recordType(this: Mut<this>, k: Type, v: Type, at: Ref<Span>, keyAt: Ref<Span>): Type {
    if (k === "string") return collection(this.typing, "string", v, false, at, true);
    let fields: Field[] = [];
    for (const name of this.keysOf(k, "'Record'", keyAt)) fields.push({ name, type: v });
    return this.typing.objectType(fields);
  }

  // `Partial<T>`: every field optional.
  /** @throws {CompileError} */
  private partialType(this: Mut<this>, t: Type, at: Ref<Span>): Type {
    let fields: Field[] = [];
    for (const f of this.fieldsOf(t, "'Partial'", at)) {
      if (f.optional !== undefined) {
        fields.push(copyField(f));
        continue;
      }
      let made = this.typing.optionalField(f.name, f.type);
      if (f.access !== undefined) made.access = f.access;
      if (f.readonly !== undefined) made.readonly = f.readonly;
      fields.push(made);
    }
    return this.typing.objectType(fields);
  }

  // `Required<T>`: no field optional, each without the empty value `?` added to it.
  /** @throws {CompileError} */
  private requiredType(this: Mut<this>, t: Type, at: Ref<Span>): Type {
    let fields: Field[] = [];
    for (const f of this.fieldsOf(t, "'Required'", at)) {
      let kept: Field = { name: f.name, type: f.optional === "added" ? this.typing.withoutNull(f.type) : f.type };
      if (f.access !== undefined) kept.access = f.access;
      if (f.readonly !== undefined) kept.readonly = f.readonly;
      fields.push(kept);
    }
    return this.typing.objectType(fields);
  }

  // `Readonly<T>`: every field read-only.
  /** @throws {CompileError} */
  private readonlyType(this: Mut<this>, t: Type, at: Ref<Span>): Type {
    let fields: Field[] = [];
    for (const f of this.fieldsOf(t, "'Readonly'", at)) {
      let kept = copyField(f);
      kept.readonly = true;
      fields.push(kept);
    }
    return this.typing.objectType(fields);
  }

  // `Pick<T, K>`: only the fields K names, each of which T must have.
  /** @throws {CompileError} */
  private pickType(this: Mut<this>, t: Type, k: Type, at: Ref<Span>, keyAt: Ref<Span>): Type {
    const fields = this.fieldsOf(t, "'Pick'", at);
    const names = this.keysOf(k, "'Pick'", keyAt);
    for (const name of names) if (!fields.some((f) => f.name === name)) throw new CompileError("E0114", `'${name}' isn't a field of '${this.typing.show(t)}', so 'Pick' can't keep it`, keyAt.start, keyAt.end);
    let kept: Field[] = [];
    for (const f of fields) if (names.includes(f.name)) kept.push(copyField(f));
    return this.typing.objectType(kept);
  }

  // `Omit<T, K>`: every field but those K names; as in TypeScript, K may name fields T lacks.
  /** @throws {CompileError} */
  private omitType(this: Mut<this>, t: Type, k: Type, at: Ref<Span>, keyAt: Ref<Span>): Type {
    const names = this.keysOf(k, "'Omit'", keyAt);
    let kept: Field[] = [];
    for (const f of this.fieldsOf(t, "'Omit'", at)) if (!names.includes(f.name)) kept.push(copyField(f));
    return this.typing.objectType(kept);
  }

  // The members of a union, or the one type that isn't one, through a type parameter given a type.
  private membersOf(t: Type): Type[] {
    const concrete = this.concreteOf(t);
    if (concrete !== undefined) return this.membersOf(concrete);
    const r = this.recOf(t);
    let out: Type[] = [];
    if (r !== undefined && r.kind === "union") for (const m of r.members) out.push(m);
    else out.push(t);
    return out;
  }

  private kept(this: Mut<this>, members: Type[]): Type {
    return members.length === 0 ? "never" : this.typing.unionType(members);
  }

  // `Exclude<T, U>`: T's members that don't fit U.
  /** @throws {CompileError} */
  private excludeType(this: Mut<this>, t: Type, u: Type, at: Ref<Span>): Type {
    let kept: Type[] = [];
    for (const m of this.membersOf(t)) if (!this.host.conforms(m, u, { start: at.start, end: at.end })) kept.push(m);
    return this.kept(kept);
  }

  // `Extract<T, U>`: T's members that fit U.
  /** @throws {CompileError} */
  private extractType(this: Mut<this>, t: Type, u: Type, at: Ref<Span>): Type {
    let kept: Type[] = [];
    for (const m of this.membersOf(t)) if (this.host.conforms(m, u, { start: at.start, end: at.end })) kept.push(m);
    return this.kept(kept);
  }

  // `NonNullable<T>`: T without the empty value.
  private nonNullableType(this: Mut<this>, t: Type): Type {
    let kept: Type[] = [];
    for (const m of this.membersOf(t)) if (m !== "null") kept.push(m);
    return this.kept(kept);
  }

  // `ReturnType<F>`: what a function of type F returns.
  /** @throws {CompileError} */
  private returnType(this: Mut<this>, f: Type, at: Ref<Span>): Type {
    const concrete = this.concreteOf(f);
    if (concrete !== undefined) return this.returnType(concrete, at);
    const r = this.recOf(f);
    if (r !== undefined && (r.kind === "function" || r.kind === "closure")) return r.returns;
    throw new CompileError("E0114", `'ReturnType' takes a function type, like 'ReturnType<() => i64>' or 'ReturnType<typeof f>', not '${this.typing.show(f)}'`, at.start, at.end);
  }

  // `Awaited<T>`: what awaiting a T gives, through promises of promises; any other type is itself.
  private awaitedType(t: Type): Type {
    const concrete = this.concreteOf(t);
    if (concrete !== undefined) return this.awaitedType(concrete);
    const promised = this.typing.promiseElement(t);
    if (promised !== undefined) return this.awaitedType(promised);
    const r = this.recOf(t);
    if (r !== undefined && r.kind === "future") return this.awaitedType(r.gives);
    return t;
  }

  // A template literal type: the union of every string it spells, where each hole is a literal
  // or a union of them, spelled as JavaScript would; a hole of `string` or a number type leaves a
  // pattern, the strings matching it, and a pattern in a hole is spliced in.
  /** @throws {CompileError} */
  templateType(this: Mut<this>, quasis: Ref<string[]>, holes: Ref<Type[]>, at: Ref<Span>, holeAt: Ref<Span[]>): Type {
    let spelled: Spelled[] = [{ quasis: [quasis[0]!], holes: [] }];
    // A hole of `never` spells nothing, and `boolean` is `true | false`.
    if (holes.includes("never")) return "never";
    for (let i: usize = 0; i < holes.length; i++) {
      const hole = holes[i]!;
      let members: Type[] = [];
      if (hole === "boolean") {
        members.push(this.typing.literalType(true));
        members.push(this.typing.literalType(false));
      } else members = this.unionOrSelf(hole);
      let pieces: Spelled[] = [];
      for (const m of members) {
        const r = this.recOf(m);
        if (r !== undefined && r.kind === "literal") pieces.push({ quasis: [spelling(r.value)], holes: [] });
        else if (m === "string" || isNumeric(m)) pieces.push({ quasis: ["", ""], holes: [m] });
        else if (r !== undefined && r.kind === "pattern") pieces.push({ quasis: [...r.quasis], holes: [...r.holes] });
        else throw new CompileError("E0114", `a template literal type's hole takes a string, a number type, or string, number or boolean literals, not '${this.typing.show(m)}'`, holeAt[i]!.start, holeAt[i]!.end);
      }
      if (spelled.length * pieces.length > 10_000) throw new CompileError("E0114", "this template literal type spells more than 10000 strings, too many for one union", at.start, at.end);
      const after: Spelled = { quasis: [quasis[i + 1]!], holes: [] };
      let next: Spelled[] = [];
      for (const s of spelled) for (const p of pieces) next.push(joined(joined(s, p), after));
      spelled = next;
      if (spelled.some((s) => s.quasis.some((q) => q.length > 100_000))) throw new CompileError("E0114", "this template literal type spells a string longer than 100000 characters", at.start, at.end);
    }
    let made: Type[] = [];
    while (spelled.length > 0) {
      const s = spelled.shift()!;
      made.push(s.holes.length === 0 ? this.typing.literalType(s.quasis[0]!) : this.typing.patternType(s.quasis, s.holes));
    }
    return this.kept(made);
  }

  // A union's own members, without looking through a type parameter, or the one type.
  private unionOrSelf(t: Type): Type[] {
    const r = this.recOf(t);
    let out: Type[] = [];
    if (r !== undefined && r.kind === "union") for (const m of r.members) out.push(m);
    else out.push(t);
    return out;
  }

  // `Uppercase<S>` and its kin: each string literal of S changed as JavaScript changes it.
  /** @throws {CompileError} */
  private intrinsic(this: Mut<this>, what: string, s: Type, at: Ref<Span>): Type {
    let made: Type[] = [];
    for (const m of this.membersOf(s)) {
      const r = this.recOf(m);
      if (r === undefined || r.kind !== "literal" || typeof r.value !== "string") throw new CompileError("E0114", `'${what}' takes string literals, like '${what}<"a" | "b">', not '${this.typing.show(m)}'`, at.start, at.end);
      made.push(this.typing.literalType(changed(what, r.value)));
    }
    return this.kept(made);
  }
}

// A literal's value as a template literal type spells it, as JavaScript would.
function spelling(value: string | bigint | boolean): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return value.toString();
}

// A string literal as `Uppercase`, `Lowercase`, `Capitalize` or `Uncapitalize` changes it.
function changed(what: string, s: string): string {
  if (what === "Uppercase") return s.toUpperCase();
  if (what === "Lowercase") return s.toLowerCase();
  if (what === "Capitalize") return s.charAt(0).toUpperCase() + s.slice(1);
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function copyField(f: Ref<Field>): Field {
  let out: Field = { name: f.name, type: f.type };
  if (f.access !== undefined) out.access = f.access;
  if (f.readonly !== undefined) out.readonly = f.readonly;
  if (f.optional !== undefined) out.optional = f.optional;
  return out;
}

// Two templates one after the other: the first's last piece and the second's first run together.
function joined(a: Ref<Spelled>, b: Ref<Spelled>): Spelled {
  let quasis: string[] = [];
  for (let i: usize = 0; i + 1 < a.quasis.length; i++) quasis.push(a.quasis[i]!);
  quasis.push(a.quasis[a.quasis.length - 1]! + b.quasis[0]!);
  for (let i: usize = 1; i < b.quasis.length; i++) quasis.push(b.quasis[i]!);
  let holes: Hole[] = [];
  for (const h of a.holes) holes.push(h);
  for (const h of b.holes) holes.push(h);
  return { quasis, holes };
}
