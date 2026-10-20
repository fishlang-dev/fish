// The checker's types. Object types are interned, so two types are structurally identical,
// the same fields with the same types in any order, exactly when they are the same object.

// A class member that isn't public is reachable only from inside its class, and never
// counts toward a structural fit, as in TypeScript.
export type Access = "public" | "private" | "protected";

export type Field = { name: string; type: Type; access?: Access };

// Fields are sorted by name, which is also their order in memory.
export type ObjectType = { kind: "object"; fields: Field[] };

// A class is nominal: one object per declaration, so `===` is identity. Its own fields are in
// declaration order, filled in once resolved, and follow the base it embeds in memory.
export type ClassType = { kind: "class"; name: string; fields: Field[]; base?: ClassType };

// An interface is a trait: fields and method signatures that any value with those members
// satisfies. It describes values but is never one, so it never reaches codegen. Its members
// are filled in once resolved.
export type Method = { name: string; params: Type[]; returns: Type };
export type InterfaceType = { kind: "interface"; name: string; fields: Field[]; methods: Method[] };

// A type parameter, as seen while a generic body is checked at its definition: it stands
// for any type satisfying its bound, and offers only the bound's fields. Each instance of
// the body is checked again with concrete types, so a parameter never reaches codegen.
export type ParamType = { kind: "param"; name: string; bound: ObjectType | InterfaceType | undefined; fields: Field[] };

export type Type = "i64" | "boolean" | "void" | ObjectType | ClassType | InterfaceType | ParamType;

const interned = new Map<string, ObjectType>();
const keys = new Map<Exclude<Type, string>, string>();
let declared = 0;

// A class's key is unique to its declaration, since two programs may reuse a class name.
export function classType(name: string): ClassType {
  const t: ClassType = { kind: "class", name, fields: [] };
  keys.set(t, `class ${declared++}`);
  return t;
}

export function interfaceType(name: string): InterfaceType {
  const t: InterfaceType = { kind: "interface", name, fields: [], methods: [] };
  keys.set(t, `interface ${declared++}`);
  return t;
}

export function typeParameter(name: string, bound: ObjectType | InterfaceType | undefined): ParamType {
  const t: ParamType = { kind: "param", name, bound, fields: bound?.fields ?? [] };
  keys.set(t, `param ${declared++}`);
  return t;
}

// A string that is the same exactly when two types are, for keying instances.
export function keyOf(t: Type): string {
  return typeof t === "string" ? t : `{${keys.get(t)}}`;
}

export function objectType(fields: Field[]): ObjectType {
  const sorted = fields.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  // A nested key is braced, so `{ a: { x }; y }` and `{ a: { x; y } }` get different keys.
  const key = sorted.map((f) => `${JSON.stringify(f.name)}:${keyOf(f.type)}`).join(",");
  let t = interned.get(key);
  if (!t) {
    t = { kind: "object", fields: sorted };
    interned.set(key, t);
    keys.set(t, key);
  }
  return t;
}

// A field of an object, or of an instance or the bases it embeds.
export function field(t: Exclude<Type, string>, name: string): Field | undefined {
  const own = t.fields.find((f) => f.name === name);
  return own ?? (t.kind === "class" && t.base ? field(t.base, name) : undefined);
}

// The indices that reach a field inside a value of `t`, through any embedded bases.
export function fieldPath(t: ObjectType | ClassType, name: string): number[] {
  const embeds = t.kind === "class" && t.base;
  const i = t.fields.findIndex((f) => f.name === name);
  if (i >= 0) return [i + (embeds ? 1 : 0)];
  return [0, ...fieldPath((t as ClassType).base!, name)];
}

// Every field of an instance: its bases' first, then its own.
export function allFields(t: ClassType): Field[] {
  return [...(t.base ? allFields(t.base) : []), ...t.fields];
}

// Whether `t` embeds `base`, directly or through another base.
export function derives(t: ClassType, base: ClassType): boolean {
  return t.base !== undefined && (t.base === base || derives(t.base, base));
}

// Whether a value of `from` fits where `to` is declared: the same type, or an object or
// instance with at least the fields of the object type `to`, each fitting in turn.
export function fits(from: Type, to: Type): boolean {
  if (from === to) return true;
  // An interface is satisfied by members, which only the checker can look up.
  if (typeof from === "string" || typeof to === "string" || to.kind !== "object" || from.kind === "interface") return false;
  // A type parameter fits through its bound's fields, as any instance of it would.
  return to.fields.every((f) => {
    const found = field(from, f.name);
    return found !== undefined && (found.access ?? "public") === "public" && fits(found.type, f.type);
  });
}

// How a type reads in a diagnostic, as TypeScript would print it.
export function show(t: Type): string {
  if (typeof t === "string") return t;
  if (t.kind !== "object") return t.name;
  if (t.fields.length === 0) return "{}";
  const name = (n: string) => (/^[A-Za-z_$][\w$]*$/.test(n) ? n : JSON.stringify(n));
  return `{ ${t.fields.map((f) => `${name(f.name)}: ${show(f.type)}`).join("; ")} }`;
}
