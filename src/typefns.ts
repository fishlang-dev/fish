import { CompileError } from "./diag.ts";
import type { Span } from "./parser.ts";
import { TypeSet, isNumeric, type ClassType, type Field, type Hole, type ParamType, type Type, type Typing } from "./typing.ts";

// The type parameter `t` is, or with `deep` the first anywhere in it, standing for no type yet.
export function openParam(typing: Typing, t: Type, deep: boolean, seen: TypeSet<Type> = new TypeSet<Type>()): ParamType | undefined {
  // A type holding itself is looked into once.
  if (typeof t === "string" || seen.has(t)) return undefined;
  seen.add(t);
  const r = typing.rec(t);
  if (r.kind === "param") return r.concrete ? openParam(typing, r.concrete, deep, seen) : (t as ParamType);
  if (!deep) return undefined;
  const promised = typing.promiseElement(t);
  const parts = promised ? [promised] : r.kind === "union" ? r.members : r.kind === "array" ? [r.element] : r.kind === "ref" ? [r.to]
    : r.kind === "object" ? r.fields.map((f) => f.type) : r.kind === "class" ? (r.generic?.args ?? [])
    : r.kind === "function" || r.kind === "closure" ? [...r.params, r.returns] : [];
  for (const part of parts) {
    const open = openParam(typing, part, deep, seen);
    if (open) return open;
  }
  return undefined;
}

// A type function can't look inside a type parameter: the type it stands for is known only per
// instance. While a generic alias is checked before any use, the parameter stands in for the
// result, so the rest of the alias is still checked; generic function code is refused.
export function standIn(typing: Typing, types: Type[], what: string, at: Span, deep: boolean, deferring: () => boolean): Type | undefined {
  for (const t of types) {
    const open = openParam(typing, t, deep);
    if (!open) continue;
    if (deferring()) return open;
    throw new CompileError("E0114", `${what} of the type parameter '${typing.rec(open).name}' isn't supported yet: it is computed while compiling, from a type known then`, at.start, at.end);
  }
  return undefined;
}

// What the type-level functions ask of the code using them: whether a class's fields are known,
// laying it out when first asked; whether a generic alias is being checked before any use; and
// whether a type fits another, an interface by shape, as `extends` asks.
export interface TypeFunctionsHost {
  fieldsKnown(this: Mut<this>, c: ClassType): boolean;
  isDeferring(): boolean;
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
export class TypeFunctions {
  typing: Typing;
  host: TypeFunctionsHost;

  constructor(typing: Typing, host: TypeFunctionsHost) {
    this.typing = typing;
    this.host = host;
  }

  private recOf(t: Type) {
    return typeof t === "string" ? undefined : this.typing.rec(t);
  }

  // The fields a type-level function reads: an object type's, or a class's public fields, which
  // are its data (a class's methods aren't values in Fish).
  fieldsOf(this: Mut<this>, t: Type, what: string, at: Span): Field[] {
    const r = this.recOf(t);
    if (r?.kind === "object") return r.fields;
    if (r?.kind === "class") {
      if (!this.host.fieldsKnown(t as ClassType)) throw new CompileError("E0114", `${what} of '${r.name}' is needed while the field types of '${r.name}' are being worked out, so it can't be computed yet`, at.start, at.end);
      return this.typing.allFields(t as ClassType).filter((f) => (f.access ?? "public") === "public").map(({ name, type, readonly, optional }) => ({ name, type, ...(readonly && { readonly }), ...(optional && { optional }) }));
    }
    if (r?.kind === "param" && r.concrete) return this.fieldsOf(r.concrete, what, at);
    if (r?.kind === "interface") {
      throw new CompileError("E0114", `${what} takes an object type or a class, not the interface '${this.typing.show(t)}', whose methods aren't values in Fish; write its fields as a 'type'`, at.start, at.end);
    }
    throw new CompileError("E0114", `${what} takes an object type or a class, not '${this.typing.show(t)}'`, at.start, at.end);
  }

  // The keys a type names: a string literal, or a union of them.
  keysOf(k: Type, what: string, at: Span): string[] {
    const r = this.recOf(k);
    if (r?.kind === "param" && r.concrete) return this.keysOf(r.concrete, what, at);
    const members = (r?.kind === "union" ? r.members : [k]).map((m) => this.recOf(m));
    if (members.every((m) => m?.kind === "literal" && typeof m.value === "string")) {
      return members.map((m) => (m as { value: string }).value);
    }
    throw new CompileError("E0114", `${what} takes keys written as string literals, like '"a" | "b"', not '${this.typing.show(k)}'`, at.start, at.end);
  }

  // `keyof T`: the union of T's field names.
  keyofType(this: Mut<this>, t: Type, at: Span): Type {
    const held = standIn(this.typing, [t], "'keyof'", at, false, () => this.host.isDeferring());
    if (held) return held;
    const fields = this.fieldsOf(t, "'keyof'", at);
    if (fields.length === 0) throw new CompileError("E0114", `'${this.typing.show(t)}' has no public fields, so 'keyof' of it has no keys`, at.start, at.end);
    return this.typing.unionType(fields.map((f) => this.typing.literalType(f.name)));
  }

  // `T[K]`: the type of the field K names, or the union of those a union of keys names; an array's
  // `T[number]` is its element type.
  indexedType(this: Mut<this>, t: Type, k: Type, at: Span, keyAt: Span): Type {
    const held = standIn(this.typing, [t, k], "an indexed access type", at, false, () => this.host.isDeferring());
    if (held) return held;
    const r = this.recOf(t);
    if (r?.kind === "param" && r.concrete) return this.indexedType(r.concrete, k, at, keyAt);
    if (r?.kind === "array") {
      if (isNumeric(k)) return r.element;
      throw new CompileError("E0114", `an array type is indexed by 'number', which gives its element type, here '${this.typing.show(r.element)}'`, keyAt.start, keyAt.end);
    }
    const names = this.keysOf(k, "an indexed access type", keyAt);
    // As in TypeScript, a union gives the union of each member's field, which every member must have.
    if (r?.kind === "union") {
      return this.typing.unionType(r.members.flatMap((m) => {
        const kind = this.recOf(m)?.kind;
        if (kind !== "object" && kind !== "class" && kind !== "param") {
          throw new CompileError("E0114", `an indexed access type of a union takes object types or classes, but '${this.typing.show(t)}' has the member '${this.typing.show(m)}'`, at.start, at.end);
        }
        return this.fieldTypes(m, names, at, keyAt, t);
      }));
    }
    return this.typing.unionType(this.fieldTypes(t, names, at, keyAt));
  }

  // The types of the fields `names` of t, which is a member of the union `whole` if given.
  private fieldTypes(this: Mut<this>, t: Type, names: string[], at: Span, keyAt: Span, whole?: Type): Type[] {
    const fields = this.fieldsOf(t, "an indexed access type", at);
    return names.map((name) => {
      const found = fields.find((f) => f.name === name);
      if (!found) throw new CompileError("E0114", `'${name}' isn't a field of '${this.typing.show(t)}'${whole ? `, a member of '${this.typing.show(whole)}'` : ""}`, keyAt.start, keyAt.end);
      return found.type;
    });
  }

  // The utility type `name` applied to its type arguments, the span of the whole use and of each
  // argument, after the arguments it reads are checked for type parameters.
  utility(this: Mut<this>, name: string, args: Type[], at: Span, argAt: Span[]): Type {
    const [, , read, deep] = UTILITIES.get(name)!;
    return standIn(this.typing, read.map((i) => args[i]!), `'${name}'`, at, deep, () => this.host.isDeferring()) ?? this.applyUtility(name, args, at, argAt);
  }

  private applyUtility(this: Mut<this>, name: string, args: Type[], at: Span, argAt: Span[]): Type {
    switch (name) {
      case "Partial": return this.partialType(args, at);
      case "Required": return this.requiredType(args, at);
      case "Readonly": return this.readonlyType(args, at);
      case "Pick": return this.pickType(args, at, argAt);
      case "Omit": return this.omitType(args, at, argAt);
      case "Record": return this.recordType(args, at, argAt);
      case "Exclude": return this.excludeType(args, at);
      case "Extract": return this.extractType(args, at);
      case "NonNullable": return this.nonNullableType(args, at);
      case "ReturnType": return this.returnType(args, at);
      case "Awaited": return this.awaitedType(args, at);
      case "Uppercase": return this.intrinsic("Uppercase", args, at, (s) => s.toUpperCase());
      case "Lowercase": return this.intrinsic("Lowercase", args, at, (s) => s.toLowerCase());
      case "Capitalize": return this.intrinsic("Capitalize", args, at, (s) => s.charAt(0).toUpperCase() + s.slice(1));
      default: return this.intrinsic("Uncapitalize", args, at, (s) => s.charAt(0).toLowerCase() + s.slice(1));
    }
  }

  // `Record<K, V>`: an object type with a field of type V for each key K names.
  private recordType(this: Mut<this>, [k, v]: Type[], at: Span, [keyAt]: Span[]): Type {
    if (k === "string") {
      throw new CompileError("E0114", `'Record<string, ${this.typing.show(v!)}>' is a dictionary whose keys are only known at run time, which needs a Map type Fish doesn't have yet; write its keys, like 'Record<"a" | "b", ${this.typing.show(v!)}>'`, at.start, at.end);
    }
    return this.typing.objectType(this.keysOf(k!, "'Record'", keyAt!).map((name) => ({ name, type: v! })));
  }

  // `Partial<T>`: every field optional.
  private partialType(this: Mut<this>, [t]: Type[], at: Span): Type {
    return this.typing.objectType(this.fieldsOf(t!, "'Partial'", at).map((f) => (f.optional ? f : { ...f, ...this.typing.optionalField(f.name, f.type) })));
  }

  // `Required<T>`: no field optional, each without the empty value `?` added to it.
  private requiredType(this: Mut<this>, [t]: Type[], at: Span): Type {
    return this.typing.objectType(this.fieldsOf(t!, "'Required'", at).map(({ optional, ...f }) => (optional === "added" ? { ...f, type: this.typing.withoutNull(f.type) } : f)));
  }

  // `Readonly<T>`: every field read-only.
  private readonlyType(this: Mut<this>, [t]: Type[], at: Span): Type {
    return this.typing.objectType(this.fieldsOf(t!, "'Readonly'", at).map((f) => ({ ...f, readonly: true })));
  }

  // `Pick<T, K>`: only the fields K names, each of which T must have.
  private pickType(this: Mut<this>, [t, k]: Type[], at: Span, [, keyAt]: Span[]): Type {
    const fields = this.fieldsOf(t!, "'Pick'", at);
    const names = this.keysOf(k!, "'Pick'", keyAt!);
    for (const name of names) if (!fields.some((f) => f.name === name)) throw new CompileError("E0114", `'${name}' isn't a field of '${this.typing.show(t!)}', so 'Pick' can't keep it`, keyAt!.start, keyAt!.end);
    return this.typing.objectType(fields.filter((f) => names.includes(f.name)));
  }

  // `Omit<T, K>`: every field but those K names; as in TypeScript, K may name fields T lacks.
  private omitType(this: Mut<this>, [t, k]: Type[], at: Span, [, keyAt]: Span[]): Type {
    const names = this.keysOf(k!, "'Omit'", keyAt!);
    return this.typing.objectType(this.fieldsOf(t!, "'Omit'", at).filter((f) => !names.includes(f.name)));
  }

  // The members of a union, or the one type that isn't one.
  private membersOf(t: Type, what: string, at: Span): Type[] {
    const r = this.recOf(t);
    if (r?.kind === "param" && r.concrete) return this.membersOf(r.concrete, what, at);
    return r?.kind === "union" ? r.members : [t];
  }

  private kept(this: Mut<this>, members: Type[]): Type {
    return members.length === 0 ? "never" : this.typing.unionType(members);
  }

  // `Exclude<T, U>`: T's members that don't fit U.
  private excludeType(this: Mut<this>, [t, u]: Type[], at: Span): Type {
    return this.kept(this.membersOf(t!, "'Exclude'", at).filter((m) => !this.host.conforms(m, u!, at)));
  }

  // `Extract<T, U>`: T's members that fit U.
  private extractType(this: Mut<this>, [t, u]: Type[], at: Span): Type {
    return this.kept(this.membersOf(t!, "'Extract'", at).filter((m) => this.host.conforms(m, u!, at)));
  }

  // `NonNullable<T>`: T without the empty value.
  private nonNullableType(this: Mut<this>, [t]: Type[], at: Span): Type {
    return this.kept(this.membersOf(t!, "'NonNullable'", at).filter((m) => m !== "null"));
  }

  // `ReturnType<F>`: what a function of type F returns.
  private returnType([given]: Type[], at: Span): Type {
    const f = given!;
    const r = this.recOf(f);
    if (r?.kind === "param" && r.concrete) return this.returnType([r.concrete], at);
    if (r?.kind === "function" || r?.kind === "closure") return r.returns;
    throw new CompileError("E0114", `'ReturnType' takes a function type, like 'ReturnType<() => i64>' or 'ReturnType<typeof f>', not '${this.typing.show(f)}'`, at.start, at.end);
  }

  // `Awaited<T>`: what awaiting a T gives, through promises of promises; any other type is itself.
  private awaitedType([given]: Type[], at: Span): Type {
    const t = given!;
    const r = this.recOf(t);
    if (r?.kind === "param" && r.concrete) return this.awaitedType([r.concrete], at);
    const gives = this.typing.promiseElement(t) ?? (r?.kind === "future" ? r.gives : undefined);
    return gives === undefined ? t : this.awaitedType([gives], at);
  }

  // A template literal type: the union of every string it spells, where each hole is a literal
  // or a union of them, spelled as JavaScript would; a hole of `string` or a number type leaves a
  // pattern, the strings matching it, and a pattern in a hole is spliced in.
  templateType(this: Mut<this>, quasis: string[], holes: Type[], at: Span, holeAt: Span[]): Type {
    let spelled: Spelled[] = [{ quasis: [quasis[0]!], holes: [] }];
    // A hole of `never` spells nothing, and `boolean` is `true | false`.
    if (holes.includes("never")) return "never";
    holes.forEach((hole, i) => {
      const h = this.recOf(hole);
      const members = hole === "boolean" ? [this.typing.literalType(true), this.typing.literalType(false)] : h?.kind === "union" ? h.members : [hole];
      const pieces = members.map((m): Spelled => {
        const r = this.recOf(m);
        if (r?.kind === "literal") return { quasis: [String(r.value)], holes: [] };
        if (m === "string" || isNumeric(m)) return { quasis: ["", ""], holes: [m] };
        if (r?.kind === "pattern") return { quasis: r.quasis, holes: r.holes };
        throw new CompileError("E0114", `a template literal type's hole takes a string, a number type, or string, number or boolean literals, not '${this.typing.show(m)}'`, holeAt[i]!.start, holeAt[i]!.end);
      });
      if (spelled.length * pieces.length > 10_000) throw new CompileError("E0114", "this template literal type spells more than 10000 strings, too many for one union", at.start, at.end);
      spelled = spelled.flatMap((s) => pieces.map((p) => joined(joined(s, p), { quasis: [quasis[i + 1]!], holes: [] })));
      if (spelled.some((s) => s.quasis.some((q) => q.length > 100_000))) throw new CompileError("E0114", "this template literal type spells a string longer than 100000 characters", at.start, at.end);
    });
    return this.kept(spelled.map((s) => (s.holes.length === 0 ? this.typing.literalType(s.quasis[0]!) : this.typing.patternType(s.quasis, s.holes))));
  }

  // `Uppercase<S>` and its kin: each string literal of S changed as JavaScript changes it.
  private intrinsic(this: Mut<this>, what: string, [s]: Type[], at: Span, change: (s: string) => string): Type {
    return this.kept(this.membersOf(s!, `'${what}'`, at).map((m) => {
      const r = this.recOf(m);
      if (r?.kind === "literal" && typeof r.value === "string") return this.typing.literalType(change(r.value));
      throw new CompileError("E0114", `'${what}' takes string literals, like '${what}<"a" | "b">', not '${this.typing.show(m)}'`, at.start, at.end);
    }));
  }
}

// Two templates one after the other: the first's last piece and the second's first run together.
function joined(a: Spelled, b: Spelled): Spelled {
  return {
    quasis: [...a.quasis.slice(0, -1), a.quasis.at(-1)! + b.quasis[0]!, ...b.quasis.slice(1)],
    holes: [...a.holes, ...b.holes],
  };
}
