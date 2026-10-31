import { CompileError } from "./diag.ts";
import type { Span } from "./parser.ts";
import { allFields, isNumeric, patternType, promiseElement, literalType, objectType, optionalField, show, unionType, withoutNull, type ClassType, type Field, type Hole, type ParamType, type Type } from "./typing.ts";

// A type-level function: its type arguments, the span of the whole use and of each argument.
type Utility = (args: Type[], at: Span, argAt: Span[]) => Type;

// The type parameter `t` is, or with `deep` the first anywhere in it, standing for no type yet.
export function openParam(t: Type, deep: boolean, seen: Set<Type> = new Set<Type>()): ParamType | undefined {
  // A type holding itself is looked into once.
  if (typeof t === "string" || seen.has(t)) return undefined;
  seen.add(t);
  if (t.kind === "param") return t.concrete ? openParam(t.concrete, deep, seen) : t;
  if (!deep) return undefined;
  const promised = promiseElement(t);
  const parts = promised ? [promised] : t.kind === "union" ? t.members : t.kind === "array" ? [t.element] : t.kind === "ref" ? [t.to]
    : t.kind === "object" ? t.fields.map((f) => f.type) : t.kind === "class" ? (t.generic?.args ?? [])
    : t.kind === "function" || t.kind === "closure" ? [...t.params, t.returns] : [];
  for (const part of parts) {
    const open = openParam(part, deep, seen);
    if (open) return open;
  }
  return undefined;
}

// A type function can't look inside a type parameter: the type it stands for is known only per
// instance. While a generic alias is checked before any use, the parameter stands in for the
// result, so the rest of the alias is still checked; generic function code is refused.
export function standIn(types: Type[], what: string, at: Span, deep: boolean, deferring: () => boolean): Type | undefined {
  for (const t of types) {
    const open = openParam(t, deep);
    if (!open) continue;
    if (deferring()) return open;
    throw new CompileError(`${what} of the type parameter '${open.name}' isn't supported yet: it is computed while compiling, from a type known then`, at.start, at.end);
  }
  return undefined;
}

// TypeScript's type-level functions, computed while compiling into ordinary types: `keyof`,
// indexed access, and the utility types. A class's fields are known once it is laid out, which
// `layout` does when first asked, saying whether they are known yet.
// `conforms` is whether a type fits another, an interface by shape, as `extends` asks.
export function typeFunctions(layout: (c: ClassType) => boolean, deferring: () => boolean, conforms: (from: Type, to: Type, at: Span) => boolean) {
  // The fields a type-level function reads: an object type's, or a class's public fields, which
  // are its data (a class's methods aren't values in Fish).
  function fieldsOf(t: Type, what: string, at: Span): Field[] {
    if (typeof t !== "string" && t.kind === "object") return t.fields;
    if (typeof t !== "string" && t.kind === "class") {
      if (!layout(t)) throw new CompileError(`${what} of '${t.name}' is needed while the field types of '${t.name}' are being worked out, so it can't be computed yet`, at.start, at.end);
      return allFields(t).filter((f) => (f.access ?? "public") === "public").map(({ name, type, readonly, optional }) => ({ name, type, ...(readonly && { readonly }), ...(optional && { optional }) }));
    }
    if (typeof t !== "string" && t.kind === "param" && t.concrete) return fieldsOf(t.concrete, what, at);
    if (typeof t !== "string" && t.kind === "interface") {
      throw new CompileError(`${what} takes an object type or a class, not the interface '${show(t)}', whose methods aren't values in Fish; write its fields as a 'type'`, at.start, at.end);
    }
    throw new CompileError(`${what} takes an object type or a class, not '${show(t)}'`, at.start, at.end);
  }

  // The keys a type names: a string literal, or a union of them.
  function keysOf(k: Type, what: string, at: Span): string[] {
    if (typeof k !== "string" && k.kind === "param" && k.concrete) return keysOf(k.concrete, what, at);
    const members = typeof k !== "string" && k.kind === "union" ? k.members : [k];
    if (members.every((m) => typeof m !== "string" && m.kind === "literal" && typeof m.value === "string")) {
      return members.map((m) => (m as { value: string }).value);
    }
    throw new CompileError(`${what} takes keys written as string literals, like '"a" | "b"', not '${show(k)}'`, at.start, at.end);
  }

  // `keyof T`: the union of T's field names.
  function keyofType(t: Type, at: Span): Type {
    const held = standIn([t], "'keyof'", at, false, deferring);
    if (held) return held;
    const fields = fieldsOf(t, "'keyof'", at);
    if (fields.length === 0) throw new CompileError(`'${show(t)}' has no public fields, so 'keyof' of it has no keys`, at.start, at.end);
    return unionType(fields.map((f) => literalType(f.name)));
  }

  // `T[K]`: the type of the field K names, or the union of those a union of keys names; an array's
  // `T[number]` is its element type.
  function indexedType(t: Type, k: Type, at: Span, keyAt: Span): Type {
    const held = standIn([t, k], "an indexed access type", at, false, deferring);
    if (held) return held;
    if (typeof t !== "string" && t.kind === "param" && t.concrete) return indexedType(t.concrete, k, at, keyAt);
    if (typeof t !== "string" && t.kind === "array") {
      if (isNumeric(k)) return t.element;
      throw new CompileError(`an array type is indexed by 'number', which gives its element type, here '${show(t.element)}'`, keyAt.start, keyAt.end);
    }
    const fields = fieldsOf(t, "an indexed access type", at);
    return unionType(keysOf(k, "an indexed access type", keyAt).map((name) => {
      const found = fields.find((f) => f.name === name);
      if (!found) throw new CompileError(`'${name}' isn't a field of '${show(t)}'`, keyAt.start, keyAt.end);
      return found.type;
    }));
  }

  // `Record<K, V>`: an object type with a field of type V for each key K names.
  const recordType: Utility = ([k, v], at, [keyAt]) => {
    if (k === "string") {
      throw new CompileError(`'Record<string, ${show(v!)}>' is a dictionary whose keys are only known at run time, which needs a Map type Fish doesn't have yet; write its keys, like 'Record<"a" | "b", ${show(v!)}>'`, at.start, at.end);
    }
    return objectType(keysOf(k!, "'Record'", keyAt!).map((name) => ({ name, type: v! })));
  };

  // `Partial<T>`: every field optional.
  const partialType: Utility = ([t], at) => objectType(fieldsOf(t!, "'Partial'", at).map((f) => (f.optional ? f : { ...f, ...optionalField(f.name, f.type) })));

  // `Required<T>`: no field optional, each without the empty value `?` added to it.
  const requiredType: Utility = ([t], at) => objectType(fieldsOf(t!, "'Required'", at).map(({ optional, ...f }) => (optional === "added" ? { ...f, type: withoutNull(f.type) } : f)));

  // `Readonly<T>`: every field read-only.
  const readonlyType: Utility = ([t], at) => objectType(fieldsOf(t!, "'Readonly'", at).map((f) => ({ ...f, readonly: true })));

  // `Pick<T, K>`: only the fields K names, each of which T must have.
  const pickType: Utility = ([t, k], at, [, keyAt]) => {
    const fields = fieldsOf(t!, "'Pick'", at);
    const names = keysOf(k!, "'Pick'", keyAt!);
    for (const name of names) if (!fields.some((f) => f.name === name)) throw new CompileError(`'${name}' isn't a field of '${show(t!)}', so 'Pick' can't keep it`, keyAt!.start, keyAt!.end);
    return objectType(fields.filter((f) => names.includes(f.name)));
  };

  // `Omit<T, K>`: every field but those K names; as in TypeScript, K may name fields T lacks.
  const omitType: Utility = ([t, k], at, [, keyAt]) => {
    const names = keysOf(k!, "'Omit'", keyAt!);
    return objectType(fieldsOf(t!, "'Omit'", at).filter((f) => !names.includes(f.name)));
  };

  // The members of a union, or the one type that isn't one.
  const membersOf = (t: Type, what: string, at: Span): Type[] => {
    if (typeof t !== "string" && t.kind === "param" && t.concrete) return membersOf(t.concrete, what, at);
    return typeof t !== "string" && t.kind === "union" ? t.members : [t];
  };
  const kept = (members: Type[]): Type => (members.length === 0 ? "never" : unionType(members));

  // `Exclude<T, U>`: T's members that don't fit U.
  const excludeType: Utility = ([t, u], at) => kept(membersOf(t!, "'Exclude'", at).filter((m) => !conforms(m, u!, at)));

  // `Extract<T, U>`: T's members that fit U.
  const extractType: Utility = ([t, u], at) => kept(membersOf(t!, "'Extract'", at).filter((m) => conforms(m, u!, at)));

  // `NonNullable<T>`: T without the empty value.
  const nonNullableType: Utility = ([t], at) => kept(membersOf(t!, "'NonNullable'", at).filter((m) => m !== "null"));

  // `ReturnType<F>`: what a function of type F returns.
  const returnType: Utility = ([given], at) => {
    const f = given!;
    if (typeof f !== "string" && f.kind === "param" && f.concrete) return returnType([f.concrete], at, []);
    if (typeof f !== "string" && (f.kind === "function" || f.kind === "closure")) return f.returns;
    throw new CompileError(`'ReturnType' takes a function type, like 'ReturnType<() => i64>' or 'ReturnType<typeof f>', not '${show(f)}'`, at.start, at.end);
  };

  // `Awaited<T>`: what awaiting a T gives, through promises of promises; any other type is itself.
  const awaitedType: Utility = ([given], at) => {
    const t = given!;
    if (typeof t !== "string" && t.kind === "param" && t.concrete) return awaitedType([t.concrete], at, []);
    const gives = promiseElement(t) ?? (typeof t !== "string" && t.kind === "future" ? t.gives : undefined);
    return gives === undefined ? t : awaitedType([gives], at, []);
  };

  // A template literal type: the union of every string it spells, where each hole is a literal
  // or a union of them, spelled as JavaScript would; a hole of `string` or a number type leaves a
  // pattern, the strings matching it, and a pattern in a hole is spliced in.
  function templateType(quasis: string[], holes: Type[], at: Span, holeAt: Span[]): Type {
    let spelled: { quasis: string[]; holes: Hole[] }[] = [{ quasis: [quasis[0]!], holes: [] }];
    // A hole of `never` spells nothing, and `boolean` is `true | false`.
    if (holes.includes("never")) return "never";
    holes.forEach((hole, i) => {
      const members = hole === "boolean" ? [literalType(true), literalType(false)] : typeof hole !== "string" && hole.kind === "union" ? hole.members : [hole];
      const pieces = members.map((m): { quasis: string[]; holes: Hole[] } => {
        if (typeof m !== "string" && m.kind === "literal") return { quasis: [String(m.value)], holes: [] };
        if (m === "string" || isNumeric(m)) return { quasis: ["", ""], holes: [m] };
        if (typeof m !== "string" && m.kind === "pattern") return { quasis: m.quasis, holes: m.holes };
        throw new CompileError(`a template literal type's hole takes a string, a number type, or string, number or boolean literals, not '${show(m)}'`, holeAt[i]!.start, holeAt[i]!.end);
      });
      if (spelled.length * pieces.length > 10_000) throw new CompileError("this template literal type spells more than 10000 strings, too many for one union", at.start, at.end);
      spelled = spelled.flatMap((s) => pieces.map((p) => join(join(s, p), { quasis: [quasis[i + 1]!], holes: [] })));
      if (spelled.some((s) => s.quasis.some((q) => q.length > 100_000))) throw new CompileError("this template literal type spells a string longer than 100000 characters", at.start, at.end);
    });
    return kept(spelled.map((s) => (s.holes.length === 0 ? literalType(s.quasis[0]!) : patternType(s.quasis, s.holes))));
  }
  // Two templates one after the other: the first's last piece and the second's first run together.
  const join = (a: { quasis: string[]; holes: Hole[] }, b: { quasis: string[]; holes: Hole[] }) => ({
    quasis: [...a.quasis.slice(0, -1), a.quasis.at(-1)! + b.quasis[0]!, ...b.quasis.slice(1)],
    holes: [...a.holes, ...b.holes],
  });

  // `Uppercase<S>` and its kin: each string literal of S changed as JavaScript changes it.
  const intrinsic = (what: string, change: (s: string) => string): Utility => ([s], at) => kept(membersOf(s!, `'${what}'`, at).map((m) => {
    if (typeof m !== "string" && m.kind === "literal" && typeof m.value === "string") return literalType(change(m.value));
    throw new CompileError(`'${what}' takes string literals, like '${what}<"a" | "b">', not '${show(m)}'`, at.start, at.end);
  }));

  // The utility types by name, and how many type arguments each takes.
  // Each takes its type argument count, the function, an example, which arguments it reads
  // inside, and whether it compares them by fitting, which a type parameter anywhere in them
  // would decide wrongly.
  const entries: [string, number, Utility, string, number[], boolean][] = [
    ["Partial", 1, partialType, "Partial<User>", [0], false],
    ["Required", 1, requiredType, "Required<User>", [0], false],
    ["Readonly", 1, readonlyType, "Readonly<User>", [0], false],
    ["Pick", 2, pickType, 'Pick<User, "id">', [0, 1], false],
    ["Omit", 2, omitType, 'Omit<User, "id">', [0, 1], false],
    ["Record", 2, recordType, 'Record<"a" | "b", i64>', [0], false],
    ["Exclude", 2, excludeType, 'Exclude<"a" | "b", "a">', [0, 1], true],
    ["Extract", 2, extractType, 'Extract<"a" | "b", "a">', [0, 1], true],
    ["NonNullable", 1, nonNullableType, "NonNullable<string | null>", [0], false],
    ["ReturnType", 1, returnType, "ReturnType<typeof f>", [0], false],
    ["Awaited", 1, awaitedType, "Awaited<Promise<i64>>", [0], false],
    ["Uppercase", 1, intrinsic("Uppercase", (s) => s.toUpperCase()), 'Uppercase<"a">', [0], false],
    ["Lowercase", 1, intrinsic("Lowercase", (s) => s.toLowerCase()), 'Lowercase<"A">', [0], false],
    ["Capitalize", 1, intrinsic("Capitalize", (s) => s.charAt(0).toUpperCase() + s.slice(1)), 'Capitalize<"a">', [0], false],
    ["Uncapitalize", 1, intrinsic("Uncapitalize", (s) => s.charAt(0).toLowerCase() + s.slice(1)), 'Uncapitalize<"A">', [0], false],
  ];
  const UTILITIES = new Map(entries.map(([name, count, apply, example, read, deep]): [string, [number, Utility, string]] => [name, [count, (args, at, argAt) =>
    standIn(read.map((i) => args[i]!), `'${name}'`, at, deep, deferring) ?? apply(args, at, argAt), example]]));
  return { keyofType, indexedType, fieldsOf, keysOf, templateType, UTILITIES };
}
