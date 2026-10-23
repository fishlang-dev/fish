import { CompileError } from "./diag.ts";
import type { Span } from "./parser.ts";
import { allFields, isNumeric, literalType, objectType, optionalField, show, unionType, withoutNull, type ClassType, type Field, type Type } from "./typing.ts";

// A type-level function: its type arguments, the span of the whole use and of each argument.
type Utility = (args: Type[], at: Span, argAt: Span[]) => Type;

// TypeScript's type-level functions, computed while compiling into ordinary types: `keyof`,
// indexed access, and the utility types. A class's fields are known once it is laid out, which
// `layout` does when first asked, saying whether they are known yet.
export function typeFunctions(layout: (c: ClassType) => boolean) {
  // The fields a type-level function reads: an object type's, or a class's public fields, which
  // are its data (a class's methods aren't values in Fish).
  function fieldsOf(t: Type, what: string, at: Span): Field[] {
    if (typeof t !== "string" && t.kind === "object") return t.fields;
    if (typeof t !== "string" && t.kind === "class") {
      if (!layout(t)) throw new CompileError(`${what} of '${t.name}' can't be used in the types of the class's own fields yet, since they aren't known until those types are`, at.start, at.end);
      return allFields(t).filter((f) => (f.access ?? "public") === "public").map(({ name, type, readonly, optional }) => ({ name, type, ...(readonly && { readonly }), ...(optional && { optional }) }));
    }
    if (typeof t !== "string" && t.kind === "param") {
      throw new CompileError(`${what} of the type parameter '${t.name}' isn't supported yet: it is computed while compiling, from a type known then`, at.start, at.end);
    }
    if (typeof t !== "string" && t.kind === "interface") {
      throw new CompileError(`${what} takes an object type or a class, not the interface '${show(t)}', whose methods aren't values in Fish; write its fields as a 'type'`, at.start, at.end);
    }
    throw new CompileError(`${what} takes an object type or a class, not '${show(t)}'`, at.start, at.end);
  }

  // The keys a type names: a string literal, or a union of them.
  function keysOf(k: Type, what: string, at: Span): string[] {
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
    if (typeof t !== "string" && t.kind === "array") {
      if (isNumeric(k)) return t.element;
      throw new CompileError(`an array type is indexed by 'number', as in '${show(t)}[number]', which gives its element type`, keyAt.start, keyAt.end);
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

  // The utility types by name, and how many type arguments each takes.
  const UTILITIES = new Map<string, [number, Utility]>([
    ["Partial", [1, partialType]],
    ["Required", [1, requiredType]],
    ["Readonly", [1, readonlyType]],
    ["Pick", [2, pickType]],
    ["Omit", [2, omitType]],
    ["Record", [2, recordType]],
  ]);
  return { keyofType, indexedType, UTILITIES };
}
