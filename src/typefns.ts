import { CompileError } from "./diag.ts";
import type { Span } from "./parser.ts";
import { allFields, fits, isNumeric, literalType, objectType, optionalField, show, unionType, withoutNull, type ClassType, type Field, type Type } from "./typing.ts";

// A type-level function: its type arguments, the span of the whole use and of each argument.
type Utility = (args: Type[], at: Span, argAt: Span[]) => Type;

// Thrown by a type function given a generic alias's own type parameter while that alias is
// checked before any use: its result waits for the alias's type arguments.
export class Deferred {}

// A type function can't look inside a type parameter: the type it stands for is known only per
// instance. A generic alias being checked waits; generic function code is refused.
export function opaque(t: Type, what: string, at: Span, deferring: () => boolean): void {
  if (typeof t === "string" || t.kind !== "param" || t.concrete) return;
  if (deferring()) throw new Deferred();
  throw new CompileError(`${what} of the type parameter '${t.name}' isn't supported yet: it is computed while compiling, from a type known then`, at.start, at.end);
}

// TypeScript's type-level functions, computed while compiling into ordinary types: `keyof`,
// indexed access, and the utility types. A class's fields are known once it is laid out, which
// `layout` does when first asked, saying whether they are known yet.
export function typeFunctions(layout: (c: ClassType) => boolean, deferring: () => boolean) {
  // The fields a type-level function reads: an object type's, or a class's public fields, which
  // are its data (a class's methods aren't values in Fish).
  function fieldsOf(t: Type, what: string, at: Span): Field[] {
    if (typeof t !== "string" && t.kind === "object") return t.fields;
    if (typeof t !== "string" && t.kind === "class") {
      if (!layout(t)) throw new CompileError(`${what} of '${t.name}' is needed while the field types of '${t.name}' are being worked out, so it can't be computed yet`, at.start, at.end);
      return allFields(t).filter((f) => (f.access ?? "public") === "public").map(({ name, type, readonly, optional }) => ({ name, type, ...(readonly && { readonly }), ...(optional && { optional }) }));
    }
    if (typeof t !== "string" && t.kind === "param" && t.concrete) return fieldsOf(t.concrete, what, at);
    opaque(t, what, at, deferring);
    if (typeof t !== "string" && t.kind === "interface") {
      throw new CompileError(`${what} takes an object type or a class, not the interface '${show(t)}', whose methods aren't values in Fish; write its fields as a 'type'`, at.start, at.end);
    }
    throw new CompileError(`${what} takes an object type or a class, not '${show(t)}'`, at.start, at.end);
  }

  // The keys a type names: a string literal, or a union of them.
  function keysOf(k: Type, what: string, at: Span): string[] {
    if (typeof k !== "string" && k.kind === "param" && k.concrete) return keysOf(k.concrete, what, at);
    opaque(k, what, at, deferring);
    const members = typeof k !== "string" && k.kind === "union" ? k.members : [k];
    if (members.every((m) => typeof m !== "string" && m.kind === "literal" && typeof m.value === "string")) {
      return members.map((m) => (m as { value: string }).value);
    }
    throw new CompileError(`${what} takes keys written as string literals, like '"a" | "b"', not '${show(k)}'`, at.start, at.end);
  }

  // `keyof T`: the union of T's field names.
  function keyofType(t: Type, at: Span): Type {
    const fields = fieldsOf(t, "'keyof'", at);
    if (fields.length === 0) throw new CompileError(`'${show(t)}' has no public fields, so 'keyof' of it has no keys`, at.start, at.end);
    return unionType(fields.map((f) => literalType(f.name)));
  }

  // `T[K]`: the type of the field K names, or the union of those a union of keys names; an array's
  // `T[number]` is its element type.
  function indexedType(t: Type, k: Type, at: Span, keyAt: Span): Type {
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
    opaque(t, what, at, deferring);
    return typeof t !== "string" && t.kind === "union" ? t.members : [t];
  };
  const kept = (members: Type[]): Type => (members.length === 0 ? "never" : unionType(members));

  // `Exclude<T, U>`: T's members that don't fit U.
  const excludeType: Utility = ([t, u], at) => kept(membersOf(t!, "'Exclude'", at).filter((m) => !fits(m, u!)));

  // `Extract<T, U>`: T's members that fit U.
  const extractType: Utility = ([t, u], at) => kept(membersOf(t!, "'Extract'", at).filter((m) => fits(m, u!)));

  // `NonNullable<T>`: T without the empty value.
  const nonNullableType: Utility = ([t], at) => kept(membersOf(t!, "'NonNullable'", at).filter((m) => m !== "null"));

  // The utility types by name, and how many type arguments each takes.
  const UTILITIES = new Map<string, [number, Utility, string]>([
    ["Partial", [1, partialType, "Partial<User>"]],
    ["Required", [1, requiredType, "Required<User>"]],
    ["Readonly", [1, readonlyType, "Readonly<User>"]],
    ["Pick", [2, pickType, 'Pick<User, "id">']],
    ["Omit", [2, omitType, 'Omit<User, "id">']],
    ["Record", [2, recordType, 'Record<"a" | "b", i64>']],
    ["Exclude", [2, excludeType, 'Exclude<"a" | "b", "a">']],
    ["Extract", [2, extractType, 'Extract<"a" | "b", "a">']],
    ["NonNullable", [1, nonNullableType, "NonNullable<string | null>"]],
  ]);
  return { keyofType, indexedType, UTILITIES };
}
