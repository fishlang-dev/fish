// The checker's types. Object types are interned, so two types are structurally identical,
// the same fields with the same types in any order, exactly when they are the same object.

export type Field = { name: string; type: Type };

// Fields are sorted by name, which is also their order in memory.
export type ObjectType = { kind: "object"; fields: Field[] };

export type Type = "i64" | "boolean" | "void" | ObjectType;

const interned = new Map<string, ObjectType>();
const keys = new Map<ObjectType, string>();

export function objectType(fields: Field[]): ObjectType {
  const sorted = fields.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const key = sorted.map((f) => `${JSON.stringify(f.name)}:${typeof f.type === "string" ? f.type : keys.get(f.type)}`).join(",");
  let t = interned.get(key);
  if (!t) {
    t = { kind: "object", fields: sorted };
    interned.set(key, t);
    keys.set(t, key);
  }
  return t;
}

export function field(t: ObjectType, name: string): Field | undefined {
  return t.fields.find((f) => f.name === name);
}

// How a type reads in a diagnostic, as TypeScript would print it.
export function show(t: Type): string {
  if (typeof t === "string") return t;
  if (t.fields.length === 0) return "{}";
  const name = (n: string) => (/^[A-Za-z_$][\w$]*$/.test(n) ? n : JSON.stringify(n));
  return `{ ${t.fields.map((f) => `${name(f.name)}: ${show(f.type)}`).join("; ")} }`;
}
