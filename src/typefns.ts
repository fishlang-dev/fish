import { CompileError } from "./diag.ts";
import type { Span } from "./parser.ts";
import { allFields, isNumeric, literalType, objectType, show, unionType, withoutNull, type ClassType, type Field, type Type } from "./typing.ts";

// TypeScript's type-level functions, computed while compiling into ordinary types: `keyof`,
// indexed access, and the utility types. A class's fields are known once it is laid out, which
// `layout` does when first asked.
export function typeFunctions(layout: (c: ClassType) => void) {
  // The fields a type-level function reads: an object type's, or a class's public fields, which
  // are its data (a class's methods aren't values in Fish).
  function fieldsOf(t: Type, what: string, at: Span): Field[] {
    if (typeof t !== "string" && t.kind === "object") return t.fields;
    if (typeof t !== "string" && t.kind === "class") {
      layout(t);
      return allFields(t).filter((f) => (f.access ?? "public") === "public").map(({ name, type, readonly, optional }) => ({ name, type, ...(readonly && { readonly }), ...(optional && { optional }) }));
    }
    if (typeof t !== "string" && t.kind === "param") {
      throw new CompileError(`${what} of the type parameter '${t.name}' isn't supported yet: it is computed while compiling, from a type known then`, at.start, at.end);
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
    if (fields.length === 0) throw new CompileError(`'${show(t)}' has no fields, so 'keyof' of it has no keys`, at.start, at.end);
    return unionType(fields.map((f) => literalType(f.name)));
}

  // `T[K]`: the type of the field K names, or the union of those a union of keys names; an array's
  // `T[number]` is its element type.
  function indexedType(t: Type, k: Type, at: Span): Type {
    if (typeof t !== "string" && t.kind === "array" && isNumeric(k)) return t.element;
    const fields = fieldsOf(t, "an indexed access type", at);
    return unionType(keysOf(k, "an indexed access type", at).map((name) => {
      const found = fields.find((f) => f.name === name);
      if (!found) throw new CompileError(`'${name}' isn't a field of '${show(t)}'`, at.start, at.end);
      return found.type;
    }));
}

  // `Record<K, V>`: an object type with a field of type V for each key K names.
  function recordType(k: Type, v: Type, at: Span): Type {
    if (k === "string") {
      throw new CompileError(`'Record<string, ${show(v)}>' is a dictionary whose keys are only known at run time, which needs a Map type Fish doesn't have yet; write its keys, like 'Record<"a" | "b", ${show(v)}>'`, at.start, at.end);
    }
    return objectType(keysOf(k, "'Record'", at).map((name) => ({ name, type: v })));
}

  // `Partial<T>`: every field optional.
  function partialType(t: Type, at: Span): Type {
    return objectType(fieldsOf(t, "'Partial'", at).map((f) => (f.optional ? f : { ...f, optional: true, type: unionType([f.type, "null"]) })));
}

  // `Required<T>`: no field optional, each without the empty value `?` added.
  function requiredType(t: Type, at: Span): Type {
    return objectType(fieldsOf(t, "'Required'", at).map(({ optional, ...f }) => (optional ? { ...f, type: withoutNull(f.type) } : f)));
}

  // `Readonly<T>`: every field read-only.
  function readonlyType(t: Type, at: Span): Type {
    return objectType(fieldsOf(t, "'Readonly'", at).map((f) => ({ ...f, readonly: true })));
}

  // `Pick<T, K>`: only the fields K names, each of which T must have.
  function pickType(t: Type, k: Type, at: Span): Type {
    const fields = fieldsOf(t, "'Pick'", at);
    const names = keysOf(k, "'Pick'", at);
    for (const name of names) if (!fields.some((f) => f.name === name)) throw new CompileError(`'${name}' isn't a field of '${show(t)}', so 'Pick' can't keep it`, at.start, at.end);
    return objectType(fields.filter((f) => names.includes(f.name)));
}

  // `Omit<T, K>`: every field but those K names; as in TypeScript, K may name fields T lacks.
  function omitType(t: Type, k: Type, at: Span): Type {
    const names = keysOf(k, "'Omit'", at);
    return objectType(fieldsOf(t, "'Omit'", at).filter((f) => !names.includes(f.name)));
}

  // The utility types by name, and how many type arguments each takes.
  const UTILITIES: Record<string, [number, (args: Type[], at: Span) => Type]> = {
    Partial: [1, ([t], at) => partialType(t!, at)],
    Required: [1, ([t], at) => requiredType(t!, at)],
    Readonly: [1, ([t], at) => readonlyType(t!, at)],
    Pick: [2, ([t, k], at) => pickType(t!, k!, at)],
    Omit: [2, ([t, k], at) => omitType(t!, k!, at)],
    Record: [2, ([k, v], at) => recordType(k!, v!, at)],
  };
  return { keyofType, indexedType, UTILITIES };
}
