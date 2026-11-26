// A TypeScript client for a program's typed routes, and `.d.ts` declarations for a file's exported
// types, so a frontend reads and writes what the Fish service does. The client covers the routes
// `fishc openapi` describes, through the same walk over the route table.
import type { Route, Tables } from "./compilation.fsh";
import {
  classFields,
  operationsOf,
  type LeftOut,
  type Operation,
} from "./openapi.fsh";
import type {
  ClassMember,
  EnumMember,
  Expr,
  PropertyName,
  Stmt,
  TypeMember,
  TypeNode,
  TypeParam,
} from "./parser.fsh";
import {
  literalText,
  tupleElements,
  type ClassType,
  type Field,
  type Type,
  type Typing,
} from "./typing.fsh";

const NUMBERS = new Set<string>([
  "i8",
  "i16",
  "i32",
  "i64",
  "i128",
  "isize",
  "u8",
  "u16",
  "u32",
  "u64",
  "u128",
  "usize",
  "f32",
  "f64",
  "number",
]);

function key(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

// A type as an array's element: in parentheses when it is a union or a function.
function element(text: string): string {
  return text.includes(" | ") || text.includes("=>")
    ? `(${text})[]`
    : `${text}[]`;
}

// The TypeScript type of the JSON Fish writes for a `t`. A class, and a type that holds itself, is
// declared once in `named`, by its name, and referred to by it. `present` describes a value that
// is there, an optional field's, which is never written as null.
export function tsOf(
  typing: Ref<Typing>,
  t: Type,
  named: Mut<Map<string, string>>,
  present = false,
): string {
  if (typeof t === "string") {
    if (
      t === "string" ||
      t === "boolean" ||
      t === "null" ||
      t === "void" ||
      t === "never"
    )
      return t;
    if (t === "bigint") return "unknown";
    return "number";
  }
  if (typing.kindOf(t) !== "class" && typing.tiedBy(t) === undefined)
    return shapeTs(typing, t, named, present);
  return kept(typing, typing.show(t), t, named);
}

function kept(
  typing: Ref<Typing>,
  shown: string,
  t: Exclude<Type, string>,
  named: Mut<Map<string, string>>,
): string {
  // ponytail: two types showing as one name share a declaration, as openapi's components do.
  const name = shown.replace(/[^A-Za-z0-9_$]/g, "_");
  if (!named.has(name)) {
    named.set(name, "");
    const shape = shapeTs(typing, t, named, false);
    named.set(name, `export type ${name} = ${shape};`);
  }
  return name;
}

function objectTs(
  typing: Ref<Typing>,
  fields: Ref<Field[]>,
  named: Mut<Map<string, string>>,
): string {
  let props: string[] = [];
  let sorted: { name: string; text: string }[] = [];
  for (const f of fields) {
    if (f.name.startsWith("#")) continue;
    const optional = f.optional !== undefined;
    sorted.push({
      name: f.name,
      text: `${key(f.name)}${optional ? "?" : ""}: ${tsOf(typing, f.type, named, optional)}`,
    });
  }
  sorted.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const s of sorted) props.push(s.text);
  return props.length === 0 ? "{}" : `{ ${props.join("; ")} }`;
}

function shapeTs(
  typing: Ref<Typing>,
  t: Exclude<Type, string>,
  named: Mut<Map<string, string>>,
  present: boolean,
): string {
  const r = typing.rec(t);
  switch (r.kind) {
    case "brand":
      return tsOf(typing, r.base, named, present);
    case "ref":
      return tsOf(typing, r.to, named, present);
    case "param":
      return r.concrete !== undefined
        ? tsOf(typing, r.concrete!, named, present)
        : "unknown";
    case "literal":
      return typeof r.value === "string"
        ? JSON.stringify(r.value)
        : literalText(r.value);
    case "pattern":
      return "string";
    case "array":
    case "fixed":
      return element(tsOf(typing, r.element, named));
    case "map":
      return `Record<string, ${tsOf(typing, r.value, named)}>`;
    case "class":
      return objectTs(typing, classFields(typing, t as ClassType), named);
    case "recursive": {
      const of = r.of;
      if (
        typeof of === "string" ||
        typing.kindOf(of) === "class" ||
        typing.tiedBy(of) !== undefined
      )
        return tsOf(typing, of, named);
      return kept(typing, r.name, of, named);
    }
    case "union": {
      let members: string[] = [];
      let nullable = false;
      for (const m of r.members) {
        if (m === "null") {
          nullable = !present;
          continue;
        }
        const text = tsOf(typing, m, named);
        if (!members.includes(text)) members.push(text);
      }
      if (nullable) members.push("null");
      return members.join(" | ");
    }
    case "object": {
      if (r.tuple !== true) return objectTs(typing, r.fields, named);
      const required = r.required;
      const rest = r.rest;
      const elements = tupleElements(typing.rec(t).fields);
      let items: string[] = [];
      for (let i: usize = 0; i < elements.length; i++) {
        const optional = required !== undefined && i >= required;
        items.push(
          `${tsOf(typing, elements[i]!, named, optional)}${optional ? "?" : ""}`,
        );
      }
      if (rest !== undefined)
        items.push(`...${element(tsOf(typing, rest, named))}`);
      return `[${items.join(", ")}]`;
    }
    case "variant": {
      if (r.fields.length === 0) return JSON.stringify(r.member);
      let held: string[] = [];
      for (const f of r.fields) held.push(tsOf(typing, f.type, named));
      return `{ ${key(r.member)}: ${held.length === 1 ? held[0]! : `[${held.join(", ")}]`} }`;
    }
    default:
      return "unknown";
  }
}

// A method's name from its operation: the method, then each word of the path, as `getUsersId`.
function methodName(o: Ref<Operation>): string {
  let name = o.method;
  for (const word of o.path.split(/[^A-Za-z0-9]+/))
    if (word !== "") name += word[0].toUpperCase() + word.slice(1);
  return name === o.method ? `${name}Root` : name;
}

function ident(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_$]/g, "_");
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

function methodText(
  typing: Ref<Typing>,
  o: Ref<Operation>,
  name: string,
  named: Mut<Map<string, string>>,
): string {
  let params: string[] = [];
  let path = o.path;
  for (const p of o.params) {
    params.push(`${ident(p)}: string`);
    path = path.replace(`{${p}}`, `\${encodeURIComponent(${ident(p)})}`);
  }
  const route: Ref<Route> = o.route;
  if (route.body !== undefined)
    params.push(`body: ${tsOf(typing, route.body!, named)}`);
  const sent = `await this.send(${JSON.stringify(o.method.toUpperCase())}, \`${path}\`${route.body !== undefined ? ", body" : ""})`;
  if (route.response === undefined)
    return `  async ${name}(${params.join(", ")}): Promise<Response> {\n    return ${sent};\n  }\n`;
  if (route.response === "void")
    return `  async ${name}(${params.join(", ")}): Promise<void> {\n    ${sent};\n  }\n`;
  const answer = tsOf(typing, route.response!, named);
  return `  async ${name}(${params.join(", ")}): Promise<${answer}> {\n    const res = ${sent};\n    return (await res.json()) as ${answer};\n  }\n`;
}

const PRELUDE = `export class ClientError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(\`request failed with \${status}: \${body}\`);
  }
}

export class Client {
  constructor(readonly baseUrl: string, readonly init: RequestInit = {}) {}

  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    const headers = new Headers(this.init.headers);
    if (body !== undefined) headers.set("content-type", "application/json");
    const res = await fetch(this.baseUrl.replace(/\\/$/, "") + path, { ...this.init, method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw new ClientError(res.status, await res.text());
    return res;
  }

`;

// The client of the routes `tables` holds, as a TypeScript module, and the routes it leaves out.
export function clientOf(
  tables: Ref<Tables>,
  from: string,
): { code: string; left: LeftOut[] } {
  const typing: Ref<Typing> = tables.typing;
  const found = operationsOf(tables);
  let named = new Map<string, string>();
  let methods = "";
  let used = new Set<string>();
  for (const o of found.operations) {
    const base = methodName(o);
    let name = base;
    let n = 2;
    while (used.has(name)) {
      name = `${base}${n}`;
      n++;
    }
    used.add(name);
    methods += methodText(typing, o, name, named);
  }
  let names = [...named.keys()];
  names.sort();
  let declared = "";
  for (const n of names) declared += `${named.get(n)!}\n`;
  const code = `// Written by fishc client from ${from}; change the Fish service and write it again.\n\n${declared}${declared === "" ? "" : "\n"}${PRELUDE}${methods}}\n`;
  return { code, left: found.left };
}

// A written type as TypeScript writes the JSON Fish writes for it: sized numbers as `number`,
// `Option<T>` as `T | null`, `Ref<T>`, `Mut<T>` and `Dyn<T>` as `T`, arrays and fixed arrays as
// arrays and a `Map` with string keys as a record; anything else as written.
export function tsNode(src: string, n: Ref<TypeNode>): string {
  switch (n.kind) {
    case "ref": {
      if (NUMBERS.has(n.name) && n.args.length === 0) return "number";
      if (n.name === "Option" && n.args.length === 1)
        return `${tsNode(src, n.args[0]!)} | null`;
      if (
        (n.name === "Ref" ||
          n.name === "Mut" ||
          n.name === "Dyn" ||
          n.name === "Own") &&
        n.args.length > 0
      )
        return tsNode(src, n.args[0]!);
      if (n.name === "FixedArray" && n.args.length > 0)
        return element(tsNode(src, n.args[0]!));
      if (n.name === "Map" && n.args.length === 2)
        return `Record<string, ${tsNode(src, n.args[1]!)}>`;
      if (n.args.length === 0) return n.name;
      let args: string[] = [];
      for (const a of n.args) args.push(tsNode(src, a));
      return `${n.name}<${args.join(", ")}>`;
    }
    case "array":
      return element(tsNode(src, n.element));
    case "tuple": {
      let items: string[] = [];
      for (const e of n.elements)
        items.push(
          `${e.rest ? "..." : ""}${e.name !== undefined ? `${e.name!}${e.optional ? "?" : ""}: ` : ""}${tsNode(src, e.type)}${e.name === undefined && e.optional ? "?" : ""}`,
        );
      return `[${items.join(", ")}]`;
    }
    case "object":
      return membersTs(src, n.members);
    case "union":
    case "intersection": {
      let parts: string[] = [];
      for (const t of n.types) parts.push(tsNode(src, t));
      return parts.join(n.kind === "union" ? " | " : " & ");
    }
    default:
      return src.slice(n.start as i64, n.end as i64);
  }
}

function membersTs(src: string, members: Ref<TypeMember[]>): string {
  let parts: string[] = [];
  for (const m of members) {
    let done = false;
    if (m.kind === "property") {
      const written: Ref<PropertyName> = m.name;
      if (typeof written === "string") {
        parts.push(
          `${m.readonly ? "readonly " : ""}${key(written)}${m.optional ? "?" : ""}: ${m.type !== undefined ? tsNode(src, m.type!) : "unknown"}`,
        );
        done = true;
      }
    }
    if (!done)
      parts.push(src.slice(m.start as i64, m.end as i64).replace(/;$/, ""));
  }
  return parts.length === 0 ? "{}" : `{ ${parts.join("; ")} }`;
}

function paramsTs(src: string, params: Ref<TypeParam[]>): string {
  if (params.length === 0) return "";
  let parts: string[] = [];
  for (const p of params)
    parts.push(
      `${p.name}${p.constraint !== undefined ? ` extends ${tsNode(src, p.constraint!)}` : ""}`,
    );
  return `<${parts.join(", ")}>`;
}

function fieldsTs(src: string, members: Ref<ClassMember[]>): string {
  let parts: string[] = [];
  for (const m of members) {
    if (
      m.kind !== "field" ||
      m.modifiers.includes("private") ||
      m.modifiers.includes("protected") ||
      m.modifiers.includes("static")
    )
      continue;
    const written: Ref<PropertyName> = m.name;
    if (typeof written !== "string" || written.startsWith("#")) continue;
    parts.push(
      `${key(written)}${m.optional ? "?" : ""}: ${m.type !== undefined ? tsNode(src, m.type!) : "unknown"}`,
    );
  }
  return parts.length === 0 ? "{}" : `{ ${parts.join("; ")} }`;
}

function enumTs(src: string, members: Ref<EnumMember[]>): string {
  let parts: string[] = [];
  let next: i64 | undefined = 0;
  // A data enum's member is its name alone, or an object of its name and what it holds.
  const data = members.some((m) => m.payload !== undefined);
  for (const m of members) {
    if (data) {
      let held: string[] = [];
      if (m.payload !== undefined)
        for (const p of m.payload!) held.push(tsNode(src, p));
      parts.push(
        held.length === 0
          ? JSON.stringify(m.name)
          : `{ ${key(m.name)}: ${held.length === 1 ? held[0]! : `[${held.join(", ")}]`} }`,
      );
      continue;
    }
    if (m.init !== undefined) {
      const e: Ref<Expr> = m.init!;
      if (e.kind === "string") {
        parts.push(JSON.stringify(e.value));
        next = undefined;
        continue;
      }
      const v = e.kind === "int" ? parseInt(`${e.value}`) : null;
      next = v === null ? undefined : v!;
    }
    parts.push(next !== undefined ? `${next!}` : "number");
    if (next !== undefined) next = next! + 1;
  }
  return parts.join(" | ");
}

// The `.d.ts` declarations of a file's exported types: aliases, interfaces, classes by their public
// fields, and enums by the values JSON writes for them.
export function typesOf(
  src: string,
  program: Ref<Stmt[]>,
  from: string,
): string {
  let out = `// Written by fishc client --types from ${from}; change the Fish types and write them again.\n\n`;
  for (const s of program) {
    if (s.kind !== "export") continue;
    const d: Ref<Stmt> = s.body;
    if (d.kind === "typeAlias")
      out += `export type ${d.name}${paramsTs(src, d.typeParams)} = ${tsNode(src, d.type)};\n`;
    else if (d.kind === "interface") {
      let bases: string[] = [];
      for (const b of d.extends) bases.push(tsNode(src, b));
      out += `export interface ${d.name}${paramsTs(src, d.typeParams)}${bases.length > 0 ? ` extends ${bases.join(", ")}` : ""} ${membersTs(src, d.members)}\n`;
    } else if (d.kind === "class" && d.name !== undefined)
      out += `export interface ${d.name!}${paramsTs(src, d.typeParams)} ${fieldsTs(src, d.members)}\n`;
    else if (d.kind === "enum")
      out += `export type ${d.name} = ${enumTs(src, d.members)};\n`;
  }
  return out;
}
