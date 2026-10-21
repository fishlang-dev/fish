// The checker's types. Object types are interned, so two types are structurally identical,
// the same fields with the same types in any order, exactly when they are the same object.

// A class member that isn't public is reachable only from inside its class, and never
// counts toward a structural fit, as in TypeScript.
export type Access = "public" | "private" | "protected";

// A readonly field can't be written after construction, at any depth.
export type Field = { name: string; type: Type; access?: Access; readonly?: boolean };

// Fields are sorted by name, which is also their order in memory.
export type ObjectType = { kind: "object"; fields: Field[] };

// A class is nominal: one object per declaration, so `===` is identity. Its own fields are in
// declaration order, filled in once resolved, and follow the base it embeds in memory.
// An instance of a generic class also records the class it came from and its type arguments.
export type ClassType = { kind: "class"; name: string; fields: Field[]; base?: ClassType; generic?: { name: string; args: Type[] } };

// An interface is a trait: fields and method signatures that any value with those members
// satisfies. It describes values but is never one, so it never reaches codegen. Its members
// are filled in once resolved.
export type Method = { name: string; params: Type[]; returns: Type };
export type InterfaceType = { kind: "interface"; name: string; fields: Field[]; methods: Method[] };

// A type parameter: it stands for any type satisfying its bound, and offers only the bound's
// fields. At the definition it stands for nothing in particular. In an instance it also holds
// the concrete type it stands for, so the instance checks exactly as the definition did while
// codegen lays the value out as its concrete type; `lower` removes it before codegen.
export type ParamType = { kind: "param"; name: string; bound: ObjectType | InterfaceType | undefined; fields: Field[]; concrete?: Type };

// A literal type has one value, known at compile time, so on its own it takes no space: it
// has no fields. An integer or boolean literal fits its base type; a string literal has none yet.
// An enum's member is a literal that knows its enum, so a plain literal is never one.
export type LiteralType = {
  kind: "literal"; value: string | bigint | boolean; fields: Field[];
  // For an enum's member: the enum, unique to its declaration, and the enum's own type.
  owner?: { enum: string; member: string; id: number; of?: Type };
};

// A union holds a value of one of its members: a tag naming which, then that member's value.
// It has no fields; reaching into one takes narrowing to a member first.
export type UnionType = { kind: "union"; members: Type[]; fields: Field[]; name?: string };

// A borrow of a value that lives elsewhere: `Ref<T>` shared, `Mut<T>` mutable. It is a pointer
// to the value, reads through to it, and copies like a pointer. A written lifetime names the
// function's lifetime parameter it lives for; it is checked, then erased.
export type RefType = { kind: "ref"; to: Type; mutable: boolean; fields: Field[]; life?: string };

export type Type = "i64" | "boolean" | "void" | ObjectType | ClassType | InterfaceType | ParamType | LiteralType | UnionType | RefType;

const interned = new Map<string, ObjectType>();
const literals = new Map<string, LiteralType>();
const unions = new Map<string, UnionType>();
const keys = new Map<Exclude<Type, string>, string>();
let declared = 0;

// A class's key is unique to its declaration, since two programs may reuse a class name.
export function classType(name: string, generic?: ClassType["generic"]): ClassType {
  const t: ClassType = { kind: "class", name, fields: [], generic };
  keys.set(t, `class ${declared++}`);
  return t;
}

export function interfaceType(name: string): InterfaceType {
  const t: InterfaceType = { kind: "interface", name, fields: [], methods: [] };
  keys.set(t, `interface ${declared++}`);
  return t;
}

export function literalType(value: string | bigint | boolean, owner?: LiteralType["owner"]): LiteralType {
  const key = `literal ${typeof value} ${value}${owner ? ` of ${owner.enum}.${owner.member} ${owner.id}` : ""}`;
  let t = literals.get(key);
  if (!t) {
    t = { kind: "literal", value, fields: [], owner };
    literals.set(key, t);
    keys.set(t, key);
  }
  return t;
}

// Members are flattened, deduplicated and kept in one order, so equal unions are one type,
// and a literal whose base type is also a member adds nothing. A single member is itself.
// An enum's union carries the enum's name, for messages.
export function unionType(parts: Type[], name?: string): Type {
  const flat = parts.flatMap((p) => (typeof p !== "string" && p.kind === "union" ? p.members : [p]));
  const members = [...new Set(flat)]
    .filter((t) => typeof t === "string" || t.kind !== "literal" || !flat.includes(baseOf(t)!))
    .toSorted((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
  if (members.length === 1) return members[0]!;
  const key = `union ${members.map(keyOf).join("|")}`;
  let t = unions.get(key);
  if (!t) {
    t = { kind: "union", members, fields: [], name };
    unions.set(key, t);
    keys.set(t, key);
  }
  return t;
}

// The members of `union` a value of `type` can go into: the one it is, or else every one it
// fits. The checker allows exactly one.
export function membersFor(type: Type, union: UnionType): Type[] {
  return union.members.includes(type) ? [type] : union.members.filter((m) => fits(type, m));
}

// An enum's member widens to its enum where TypeScript widens it: a `let`, a field, a type
// argument or a property, since the place may later hold another member.
export function widenEnum(t: Type): Type {
  return typeof t !== "string" && t.kind === "literal" && t.owner?.of ? t.owner.of : t;
}

// The type a literal's value belongs to, if Fish has it yet.
export function baseOf(t: LiteralType): "i64" | "boolean" | undefined {
  return typeof t.value === "bigint" ? "i64" : typeof t.value === "boolean" ? "boolean" : undefined;
}

export function typeParameter(name: string, bound: ObjectType | InterfaceType | undefined): ParamType {
  const t: ParamType = { kind: "param", name, bound, fields: bound?.fields ?? [] };
  keys.set(t, `param ${declared++}`);
  return t;
}

export function refType(to: Type, mutable: boolean, life?: string): RefType {
  const key = `${mutable ? "mut" : "ref"} ${keyOf(to)}${life ? ` ${life}` : ""}`;
  let t = refs.get(key);
  if (!t) {
    t = { kind: "ref", to, mutable, fields: [], life };
    refs.set(key, t);
    keys.set(t, key);
  }
  return t;
}

const refs = new Map<string, RefType>();

// Primitives, literals, references, and unions of nothing else are copied; objects,
// instances, interface values and type parameters move. A mutable reference passed on is
// lent again rather than moved, so it copies too.
export function isCopy(t: Type): boolean {
  if (typeof t === "string" || t.kind === "literal" || t.kind === "ref") return true;
  return t.kind === "union" && t.members.every(isCopy);
}

// Whether a value of `t` holds a reference anywhere, which only lifetimes could keep valid.
export function holdsRef(t: Type): boolean {
  if (typeof t === "string") return false;
  if (t.kind === "ref") return true;
  if (t.kind === "union") return t.members.some(holdsRef);
  if (t.kind === "class") return t.fields.some((f) => holdsRef(f.type)) || (t.base !== undefined && holdsRef(t.base));
  return t.kind === "object" && t.fields.some((f) => holdsRef(f.type));
}

// A type parameter as an instance sees it: standing for `concrete`, which has no type
// parameter in it.
export function wrapped(name: string, bound: ObjectType | InterfaceType | undefined, concrete: Type): ParamType {
  const key = `param ${name} ${bound ? keyOf(bound) : ""} as ${keyOf(concrete)}`;
  let t = wrappers.get(key);
  if (!t) {
    t = { kind: "param", name, bound, fields: bound?.fields ?? [], concrete };
    wrappers.set(key, t);
    keys.set(t, key);
  }
  return t;
}

const wrappers = new Map<string, ParamType>();

// A type with each instance's type parameter replaced by the concrete type it stands for. A
// generic class made from one becomes the class made from what it stands for.
export function lower(t: Type): Type {
  if (typeof t === "string" || t.kind === "literal" || t.kind === "interface") return t;
  if (t.kind === "param") return t.concrete ?? t;
  let found = lowered.get(t);
  if (!found) {
    if (t.kind === "class") found = t.generic?.args.some((a) => lower(a) !== a) ? instanceClass(t, t.generic.args.map(lower)) : t;
    else if (t.kind === "ref") found = refType(lower(t.to), t.mutable, t.life);
    else found = t.kind === "union" ? unionType(t.members.map(lower), t.name) : objectType(t.fields.map((f) => ({ ...f, type: lower(f.type) })));
    lowered.set(t, found);
  }
  return found;
}

const lowered = new WeakMap<ObjectType | UnionType | ClassType | RefType, Type>();

// A type with some of its parts swapped for others, looking inside objects and unions.
export function replaced(t: Type, swap: Map<Type, Type>): Type {
  const found = swap.get(t);
  if (found) return found;
  if (typeof t !== "string" && t.kind === "class") {
    const args = t.generic?.args.map((a) => replaced(a, swap));
    return args && args.some((a, i) => a !== t.generic!.args[i]) ? instanceClass(t, args) : t;
  }
  if (typeof t !== "string" && t.kind === "ref") return refType(replaced(t.to, swap), t.mutable, t.life);
  if (typeof t === "string" || (t.kind !== "object" && t.kind !== "union")) return t;
  return t.kind === "union" ? unionType(t.members.map((m) => replaced(m, swap)), t.name) : objectType(t.fields.map((f) => ({ ...f, type: replaced(f.type, swap) })));
}

// The class a generic class's type arguments make, which only the checker can declare.
let instanceClass = (c: ClassType, _args: Type[]): ClassType => c;
export function lowersClasses(f: typeof instanceClass) {
  instanceClass = f;
}

// A string that is the same exactly when two types are, for keying instances.
export function keyOf(t: Type): string {
  return typeof t === "string" ? t : `{${keys.get(t)}}`;
}

export function objectType(fields: Field[]): ObjectType {
  const sorted = fields.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  // A nested key is braced, so `{ a: { x }; y }` and `{ a: { x; y } }` get different keys.
  const key = sorted.map((f) => `${f.readonly ? "readonly " : ""}${JSON.stringify(f.name)}:${keyOf(f.type)}`).join(",");
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
  // In an instance, a type parameter and the concrete type it stands for are one value.
  if (from === to || lower(from) === lower(to)) return true;
  // A reference reads the value where it lives, so it fits only a reference to the same type;
  // a mutable one also lends itself as shared. Lifetimes are checked on their own.
  if (typeof to !== "string" && to.kind === "ref") {
    return typeof from !== "string" && from.kind === "ref" && (from.mutable || !to.mutable) && lower(from.to) === lower(to.to);
  }
  if (typeof to !== "string" && to.kind === "union") {
    if (typeof from !== "string" && from.kind === "union") return from.members.every((m) => fits(m, to));
    return to.members.some((m) => fits(from, m));
  }
  // A union fits where every member it may hold does, as an enum fits an i64.
  if (typeof from !== "string" && from.kind === "union") return from.members.every((m) => fits(m, to));
  if (typeof from !== "string" && from.kind === "literal") return baseOf(from) === to;
  if (typeof from !== "string" && from.kind === "ref") return false;
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
  if (t.kind === "literal" && t.owner) return `${t.owner.enum}.${t.owner.member}`;
  if (t.kind === "literal") return typeof t.value === "string" ? JSON.stringify(t.value) : String(t.value);
  if (t.kind === "union") return t.name ?? t.members.map(show).join(" | ");
  if (t.kind === "ref") return `${t.mutable ? "Mut" : "Ref"}<${show(t.to)}>`;
  if (t.kind !== "object") return t.name;
  if (t.fields.length === 0) return "{}";
  const name = (n: string) => (/^[A-Za-z_$][\w$]*$/.test(n) ? n : JSON.stringify(n));
  return `{ ${t.fields.map((f) => `${f.readonly ? "readonly " : ""}${name(f.name)}: ${show(f.type)}`).join("; ")} }`;
}
