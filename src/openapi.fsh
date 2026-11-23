// The OpenAPI 3.1 document of the routes a checked program adds to std's routers. A handler that
// says its types has its body and what it answers with described as the JSON those types read
// and write; one that doesn't is listed with a response nothing describes. The document is built
// as compact JSON text, its members in a fixed order, so the same program gives the same text.
import type { LocalId } from "./arenas.fsh";
import type { Route, Tables } from "./compilation.fsh";
import { copyField, isFloat, literalText, tupleElements, type ClassType, type Field, type Type, type Typing } from "./typing.fsh";

// A route the document leaves out, and why.
export type LeftOut = { start: usize; end: usize; why: string };

// The operations an OpenAPI path has, and those a route for every method stands for.
const OPERATIONS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const EVERY = ["get", "post", "put", "patch", "delete"];

function member(key: string, value: string): string {
  return `${JSON.stringify(key)}:${value}`;
}

// A literal type's value as JSON writes it.
function literalJson(typing: Ref<Typing>, t: Type): string | undefined {
  if (typeof t === "string") return undefined;
  const r = typing.rec(t);
  if (r.kind !== "literal") return undefined;
  return typeof r.value === "string" ? JSON.stringify(r.value) : literalText(r.value);
}

// The fields of a class JSON writes, its base's among them.
function classFields(typing: Ref<Typing>, c: ClassType): Field[] {
  const r = typing.rec(c);
  let out: Field[] = [];
  if (r.base !== undefined) for (const f of classFields(typing, r.base!)) out.push(copyField(f));
  for (const f of r.fields) out.push(copyField(f));
  return out;
}

// An object's schema, its properties by name. A field written `name?: T` is left out while it is
// empty, so it isn't required and is never null.
function objectSchema(typing: Ref<Typing>, fields: Ref<Field[]>, components: Mut<Map<string, string>>): string {
  let props: { name: string; schema: string; optional: boolean }[] = [];
  for (const f of fields) {
    if (f.name.startsWith("#")) continue;
    const optional = f.optional !== undefined;
    props.push({ name: f.name, schema: schemaOf(typing, f.type, components, optional), optional });
  }
  props.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  let properties: string[] = [];
  let required: string[] = [];
  for (const p of props) {
    properties.push(member(p.name, p.schema));
    if (!p.optional) required.push(JSON.stringify(p.name));
  }
  return `{"type":"object","properties":{${properties.join(",")}}${required.length > 0 ? `,"required":[${required.join(",")}]` : ""}}`;
}

// The JSON Schema of the text JSON.stringify writes for a `t`. A class, and a type that holds
// itself, is described once under its name in `components` and referred to where it is used,
// which is also what ends a walk over a type holding itself. `present` describes a value that is
// there, an optional field's or element's, which is never written as null.
export function schemaOf(typing: Ref<Typing>, t: Type, components: Mut<Map<string, string>>, present = false): string {
  if (typeof t === "string") {
    if (t === "string" || t === "boolean" || t === "null") return `{"type":"${t}"}`;
    if (isFloat(t)) return `{"type":"number"}`;
    // Nothing JSON writes: a handler's types are refused before they reach here.
    if (t === "void" || t === "never" || t === "bigint") return "{}";
    return `{"type":"integer"}`;
  }
  // A type reaching itself through an array or a Map holds itself with nothing between.
  if (typing.kindOf(t) !== "class" && typing.tiedBy(t) === undefined) return shapeOf(typing, t, components, present);
  return kept(typing, typing.show(t), t, components);
}

// A reference to the schema of `t` kept under `shown`, which is made the first time it is asked for.
function kept(typing: Ref<Typing>, shown: string, t: Exclude<Type, string>, components: Mut<Map<string, string>>): string {
  // ponytail: two types showing as one name share a schema; qualify the names if a program needs both.
  const name = shown.replace(/[^A-Za-z0-9._-]/g, "_");
  if (!components.has(name)) {
    // Held before it is made, so a use of the type inside itself refers to it.
    components.set(name, "");
    const schema = shapeOf(typing, t, components, false);
    components.set(name, schema);
  }
  return `{"$ref":"#/components/schemas/${name}"}`;
}

// The schema of a type's own shape, each type inside it described by `schemaOf`.
function shapeOf(typing: Ref<Typing>, t: Exclude<Type, string>, components: Mut<Map<string, string>>, present: boolean): string {
  const r = typing.rec(t);
  switch (r.kind) {
    case "brand":
      return schemaOf(typing, r.base, components, present);
    case "ref":
      return schemaOf(typing, r.to, components, present);
    case "param":
      return r.concrete !== undefined ? schemaOf(typing, r.concrete!, components, present) : "{}";
    case "literal":
      return `{"const":${typeof r.value === "string" ? JSON.stringify(r.value) : literalText(r.value)}}`;
    case "pattern":
      return `{"type":"string"}`;
    case "array":
      return `{"type":"array","items":${schemaOf(typing, r.element, components)}}`;
    case "fixed":
      return `{"type":"array","items":${schemaOf(typing, r.element, components)},"minItems":${r.size},"maxItems":${r.size}}`;
    case "map":
      return `{"type":"object","additionalProperties":${schemaOf(typing, r.value, components)}}`;
    case "class":
      return objectSchema(typing, classFields(typing, t as ClassType), components);
    case "recursive": {
      // What it stands for is kept under a name of its own, or else under the alias's.
      const of = r.of;
      if (typeof of === "string" || typing.kindOf(of) === "class" || typing.tiedBy(of) !== undefined) return schemaOf(typing, of, components);
      return kept(typing, r.name, of, components);
    }
    case "union": {
      // A union of literals, as a C-like enum is, lists its values. Null is listed last, whatever
      // order the union keeps its members in.
      let values: string[] = [];
      let members: string[] = [];
      let nullable = false;
      for (const m of r.members) {
        if (m === "null") {
          nullable = !present;
          continue;
        }
        const value = literalJson(typing, m);
        if (value !== undefined) values.push(value);
        members.push(schemaOf(typing, m, components));
      }
      if (nullable) members.push(`{"type":"null"}`);
      if (members.length === 1) return members[0]!;
      if (values.length === members.length) return `{"enum":[${values.join(",")}]}`;
      return `{"anyOf":[${members.join(",")}]}`;
    }
    case "object": {
      if (r.tuple !== true) return objectSchema(typing, r.fields, components);
      const required = r.required;
      const rest = r.rest;
      const elements = tupleElements(typing.rec(t).fields);
      let items: string[] = [];
      for (let i: usize = 0; i < elements.length; i++) items.push(schemaOf(typing, elements[i]!, components, required !== undefined && i >= required));
      const least = required !== undefined ? required : items.length;
      return `{"type":"array","prefixItems":[${items.join(",")}],"minItems":${least},"items":${rest !== undefined ? schemaOf(typing, rest, components) : "false"}}`;
    }
    case "variant": {
      // A data enum's member is its name alone, or an object of its name and what it holds.
      if (r.fields.length === 0) return `{"const":${JSON.stringify(r.member)}}`;
      let held: string[] = [];
      for (const f of r.fields) held.push(schemaOf(typing, f.type, components));
      const value = held.length === 1 ? held[0]! : `{"type":"array","prefixItems":[${held.join(",")}],"minItems":${held.length},"items":false}`;
      return `{"type":"object","properties":{${member(r.member, value)}},"required":[${JSON.stringify(r.member)}]}`;
    }
    default:
      return "{}";
  }
}

// The prefixes a router's routes are served under: none of its own for a router mounted nowhere,
// and nothing for one mounted where the table can't follow.
// ponytail: a mount is taken to hold every route of its router, though std's holds only those
// added before it; compare the calls' order if a program adds routes after mounting.
function prefixesOf(router: LocalId, mounts: Ref<Route[]>, depth: usize): string[] | undefined {
  let out: string[] = [];
  let mounted = false;
  for (const m of mounts) {
    if (m.child !== router) continue;
    mounted = true;
    if (m.router === undefined || m.path === undefined || depth > 16) return undefined;
    const outer = prefixesOf(m.router!, mounts, depth + 1);
    if (outer === undefined) return undefined;
    for (const p of outer) out.push(`${p}/${m.path!}`);
  }
  return mounted ? out : [""];
}

// A route's path as OpenAPI writes it, `:id` as `{id}`, and the parameters it names.
function templated(path: string): { path: string; params: string[] } {
  let params: string[] = [];
  let segments: string[] = [];
  for (const s of path.split("/")) {
    if (s === "") continue;
    if (s.startsWith(":")) {
      params.push(s.slice(1));
      segments.push(`{${s.slice(1)}}`);
    } else segments.push(s);
  }
  return { path: `/${segments.join("/")}`, params };
}

// One route's operation: its path parameters, the body it reads and what it answers with.
function operationOf(typing: Ref<Typing>, route: Ref<Route>, params: Ref<string[]>, components: Mut<Map<string, string>>): string {
  let parts: string[] = [];
  if (params.length > 0) {
    let named: string[] = [];
    for (const p of params) named.push(`{"name":${JSON.stringify(p)},"in":"path","required":true,"schema":{"type":"string"}}`);
    parts.push(member("parameters", `[${named.join(",")}]`));
  }
  if (route.body !== undefined) parts.push(member("requestBody", `{"required":true,"content":{"application/json":{"schema":${schemaOf(typing, route.body!, components)}}}}`));
  let responses: string[] = [];
  if (route.response === undefined) responses.push(member("default", `{"description":"the handler's own response"}`));
  else if (route.response === "void") responses.push(member("204", `{"description":"No Content"}`));
  else responses.push(member("200", `{"description":"OK","content":{"application/json":{"schema":${schemaOf(typing, route.response!, components)}}}}`));
  if (route.body !== undefined) responses.push(member("400", `{"description":"Bad Request","content":{"text/plain":{"schema":{"type":"string"}}}}`));
  parts.push(member("responses", `{${responses.join(",")}}`));
  return `{${parts.join(",")}}`;
}

// The document of the routes `tables` holds, as compact JSON, and the routes it leaves out: its
// paths in the order their routes are written, a mounted router's under its prefix, the first
// route for a method and path standing for it as the first is the one that runs.
export function openapiOf(tables: Ref<Tables>, title: string, version: string): { document: string; left: LeftOut[] } {
  const typing: Ref<Typing> = tables.typing;
  let routes: { start: usize; end: usize; route: Route }[] = [];
  let mounts: Route[] = [];
  for (const [node, route] of [...tables.routes]) {
    if (route.mount) mounts.push({ ...route });
    else routes.push({ start: node.start, end: node.end, route: { ...route } });
  }
  routes.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  let paths: string[] = [];
  let operations: { path: string; text: string }[] = [];
  let taken = new Set<string>();
  let components = new Map<string, string>();
  let left: LeftOut[] = [];
  for (const r of routes) {
    const route: Ref<Route> = r.route;
    const method = route.method;
    const prefixes = route.router !== undefined ? prefixesOf(route.router!, mounts, 0) : undefined;
    const why = route.path === undefined ? "its path isn't written as a string"
      : method === undefined ? "its method isn't written as a string"
      : route.router === undefined ? "its router isn't held in a local variable"
      : prefixes === undefined ? "its router is mounted under a prefix that isn't written as a string, or in a router that isn't held in a local variable"
      : method !== "ALL" && !OPERATIONS.includes(method.toLowerCase()) ? `OpenAPI has no operation for the method '${method}'`
      : undefined;
    if (why !== undefined) left.push({ start: r.start, end: r.end, why });
    if (why !== undefined || method === undefined || prefixes === undefined) continue;
    const methods = method === "ALL" ? EVERY.slice() : [method.toLowerCase()];
    for (const prefix of prefixes) {
      const at = templated(`${prefix}/${route.path!}`);
      for (const m of methods) {
        const key = `${m} ${at.path}`;
        if (taken.has(key)) continue;
        taken.add(key);
        if (!paths.includes(at.path)) paths.push(at.path);
        operations.push({ path: at.path, text: member(m, operationOf(typing, route, at.params, components)) });
      }
    }
  }
  let items: string[] = [];
  for (const path of paths) {
    let own: string[] = [];
    for (const o of operations) if (o.path === path) own.push(o.text);
    items.push(member(path, `{${own.join(",")}}`));
  }
  let top = [member("openapi", `"3.1.0"`), member("info", `{${member("title", JSON.stringify(title))},${member("version", JSON.stringify(version))}}`), member("paths", `{${items.join(",")}}`)];
  if (components.size > 0) {
    let names = [...components.keys()];
    names.sort();
    let schemas: string[] = [];
    for (const n of names) schemas.push(member(n, components.get(n)!));
    top.push(member("components", `{"schemas":{${schemas.join(",")}}}`));
  }
  return { document: `{${top.join(",")}}`, left };
}
