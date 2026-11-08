import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bodyOf } from "../src/arenas.ts";
import { check } from "../src/check.ts";
import { compiledOf } from "../src/codegen.ts";
import { newCompilation } from "../src/compilation.ts";
import { cachedSession } from "../src/stdcache.ts";
import { CompileError } from "../src/diag.ts";
import { expandMacros } from "../src/macros.ts";
import { analyze } from "../src/main.ts";
import { flatten, load } from "../src/modules.ts";
import type { Id } from "../src/ids.ts";
import { NodeMap, NodeSet, renumberExpr, Rewrites, shiftSpansExpr } from "../src/nodes.ts";
import { parse, type Expr, type Stmt } from "../src/parser.ts";
import { cloneExpr } from "../src/rebuild.ts";
import { stdFor } from "../src/std.ts";
import { stripTests } from "../src/tests.ts";
import { Typing, TypeMap, TypeSet, type Type } from "../src/typing.ts";

const src = join(import.meta.dir, "..", "src");

// What each node lowering replaced was replaced by, noted as each replacement is made: the
// compiler tells nodes apart by id alone, and these tests check the ids by object.
const replacedBy = new WeakMap<object, object>();
const REPLACERS: [keyof Rewrites, keyof Rewrites][] = [
  ["replace", "current"],
  ["replaceStmt", "currentStmt"],
  ["replaceFunc", "currentFunc"],
  ["replaceDeclarator", "currentDeclarator"],
  ["replaceParam", "currentParam"],
  ["replacePattern", "currentPattern"],
  ["replaceTypeNode", "currentTypeNode"],
  ["replaceObjectProp", "currentObjectProp"],
  ["replaceClassMember", "currentClassMember"],
  ["replaceTypeMember", "currentTypeMember"],
  ["replacePatternProp", "currentPatternProp"],
];
// A copy of a node, made as it was at some point, keeps its span; two different nodes under one id
// would have to have been made at the same place.
const sameSpan = (a: object, b: object) => {
  const [x, y] = [a as { start?: unknown; end?: unknown }, b as { start?: unknown; end?: unknown }];
  return typeof x.start === "number" && x.start === y.start && x.end === y.end;
};
// Every object a replacement replaced or made, by node id: a table may hold a copy of any of them.
// Ids start again with each compilation, so each program clears it.
const versions = new Map<number, object[]>();
const isVersion = (id: number, node: object) => versions.get(id)?.some((v) => v === node || Bun.deepEquals(v, node)) ?? false;
// Replacements made through a bare `{ id }`, which the test can't tell the replaced node from:
// lowering passes one where Fish can't lend a node of a wider union as an `Id`.
const madeForStub = new WeakSet<object>();
function noteReplaced(was: object, out: object): void {
  if (was === out) return;
  if (Object.keys(was).length === 1) madeForStub.add(out);
  const oldById = new Map<number, object>();
  const seenOld = new Set<object>();
  const collectOld = (v: unknown) => {
    if (typeof v !== "object" || v === null || seenOld.has(v)) return;
    seenOld.add(v);
    if (Array.isArray(v)) return v.forEach(collectOld);
    const n = v as Record<string, unknown>;
    if (typeof n.id === "number" && !oldById.has(n.id)) oldById.set(n.id, v);
    Object.values(n).forEach(collectOld);
  };
  collectOld(was);
  const seenNew = new Set<object>();
  const linkNew = (v: unknown) => {
    if (typeof v !== "object" || v === null || seenNew.has(v)) return;
    seenNew.add(v);
    if (Array.isArray(v)) return v.forEach(linkNew);
    const n = v as Record<string, unknown>;
    if (typeof n.id === "number" && oldById.has(n.id)) {
      const prev = oldById.get(n.id)!;
      oldById.delete(n.id);
      if (prev !== v) replacedBy.set(prev, v);
      versions.set(n.id, [...(versions.get(n.id) ?? []), prev, v]);
    }
    Object.values(n).forEach(linkNew);
  };
  linkNew(out);
}
for (const [rep, cur] of REPLACERS) {
  const orig = Rewrites.prototype[rep] as (this: Rewrites, node: Id, by: object) => object;
  const get = Rewrites.prototype[cur] as (this: Rewrites, node: Id) => object;
  (Rewrites.prototype as unknown as Record<string, unknown>)[rep] = function (this: Rewrites, node: Id, by: object) {
    const was = get.call(this, node);
    const out = orig.call(this, node, by);
    noteReplaced(was, out);
    return out;
  };
}
// What `node` is now: the last of its replacements, or itself.
function latest(node: object): object {
  let n = node;
  while (replacedBy.has(n)) n = replacedBy.get(n)!;
  return n;
}
const programs = join(import.meta.dir, "programs");

// Every node reachable from `roots`, an object with a span, has an id, and no two objects share
// one. `ids` is shared between calls on one compilation's trees, since ids are unique in it.
function audit(roots: unknown, ids: Map<number, object>, where: string): string[] {
  const problems: string[] = [];
  const visited = new Set<object>();
  const visit = (v: unknown) => {
    if (typeof v !== "object" || v === null || visited.has(v)) return;
    visited.add(v);
    if (Array.isArray(v)) return v.forEach(visit);
    const n = v as Record<string, unknown>;
    if (typeof n.start === "number" && typeof n.end === "number") {
      const at = `${where}: a ${String(n.kind ?? "node")} at ${n.start}`;
      if (typeof n.id !== "number") problems.push(`${at} has no id`);
      // A replacement takes the id of the node it replaces, and a copy the id of what it copies.
      else if (ids.has(n.id) && latest(ids.get(n.id) as Id) !== latest(n as Id) && !madeForStub.has(n) && !sameSpan(ids.get(n.id)!, n)) problems.push(`${at} shares id ${n.id} with another node`);
      else ids.set(n.id, n);
    }
    Object.values(n).forEach(visit);
  };
  visit(roots);
  return problems;
}

// Each program of tests/programs, a case of a file written out on its own as the test runner
// writes it.
function corpus(): { name: string; file: string; src: string }[] {
  const cases = mkdtempSync(join(tmpdir(), "fish-nodes-"));
  const found: { name: string; file: string; src: string }[] = [];
  for (const entry of readdirSync(programs).sort()) {
    const file = entry.endsWith(".fsh") ? join(programs, entry) : join(programs, entry, "main.fsh");
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    if (!entry.endsWith(".fsh") || !/^\/\/ case: /m.test(text)) {
      found.push({ name: entry, file, src: text });
      continue;
    }
    for (const part of text.split(/^\/\/ case: /m).slice(1)) {
      const [name, ...lines] = part.split("\n");
      const file = join(cases, `${name!.trim()}.fsh`);
      writeFileSync(file, lines.join("\n"));
      found.push({ name: `${entry} > ${name!.trim()}`, file, src: lines.join("\n") });
    }
  }
  return found;
}

test("every node of the compiler's own source has an id of its own", () => {
  const ids = new Map<number, object>();
  const counter = { last: 0 };
  const problems = readdirSync(src).filter((f) => f.endsWith(".ts")).flatMap((f) => audit(parse(readFileSync(join(src, f), "utf8"), counter), ids, f));
  expect(problems).toEqual([]);
});

test("every node of the test programs, parsed, expanded and checked, has an id of its own", () => {
  const session = cachedSession();
  const problems: string[] = [];
  for (const p of corpus()) {
    versions.clear();
    const ids = new Map<number, object>();
    let written: Stmt[] = [];
    try {
      if (p.src.includes("// mode: parse")) {
        problems.push(...audit(parse(p.src, { last: 0 }), ids, p.name));
        continue;
      }
      const compilation = newCompilation(session);
      const loaded = load(compilation, p.file, p.src);
      stripTests(loaded);
      expandMacros(compilation, loaded, false, (macros) => check(compilation, macros, false, true));
      written = flatten(compilation, loaded, false);
      problems.push(...audit([written, stdFor(compilation, written)], ids, p.name));
      const checked = check(compilation, written);
      const bodies = compiledOf(checked).map((i) => [bodyOf(checked.tables.arenas, i).params, bodyOf(checked.tables.arenas, i).body]);
      problems.push(...stale(bodies, `${p.name}, compiled`));
    } catch (e) {
      if (!(e instanceof CompileError)) throw new Error(`${p.name}: ${e instanceof Error ? e.message : e}`);
    }
    // Checking replaces parts of the tree, and the replacements need ids too.
    problems.push(...audit(written, ids, `${p.name}, checked`));
  }
  expect(problems.slice(0, 20)).toEqual([]);
}, 120_000);

// No node reachable from `roots` has been replaced: the rebuild put every replacement in place.
function stale(roots: unknown, where: string): string[] {
  const problems: string[] = [];
  const visited = new Set<object>();
  const visit = (v: unknown) => {
    if (typeof v !== "object" || v === null || visited.has(v)) return;
    visited.add(v);
    if (Array.isArray(v)) return v.forEach(visit);
    const n = v as Record<string, unknown>;
    // A copy made as the node was, which Fish's ownership needs where a node held by reference goes
    // into a new one, is no replacement: rewrites reach both by id.
    if (typeof n.id === "number" && latest(n as Id) !== n && !Bun.deepEquals(latest(n as Id), n)) problems.push(`${where}: a ${String(n.kind ?? "node")} at ${n.start} was replaced but is still in the tree`);
    Object.values(n).forEach(visit);
  };
  visit(roots);
  return problems;
}

// Every type reachable from `roots`, through the types it links to, is a primitive or the id of
// a record in its program's arena.
function auditTypes(roots: Type[], typing: Typing, where: string): string[] {
  const problems: string[] = [];
  const seen = new Set<Type>();
  const visit = (t: Type) => {
    if (typeof t === "string" || seen.has(t)) return;
    seen.add(t);
    if (typing.typeOf(t) === undefined) return void problems.push(`${where}: ${t} is no type of its arena`);
    typing.links(t).forEach(visit);
  };
  roots.forEach(visit);
  return problems;
}

test("every type of the checked test programs is in its arena", () => {
  const session = cachedSession();
  const problems: string[] = [];
  let types = 0;
  for (const p of corpus()) {
    versions.clear();
    if (p.src.includes("// mode: parse")) continue;
    try {
      const { checked } = analyze(session, p.src, p.file);
      const roots: Type[] = compiledOf(checked).flatMap((i) => [...i.types.values(), ...i.coercions.values(), ...i.bindings.values(), i.returns, ...(i.throws ? [i.throws] : [])]);
      types += roots.length;
      problems.push(...auditTypes(roots, checked.tables.typing, p.name));
    } catch (e) {
      if (!(e instanceof CompileError)) throw new Error(`${p.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  expect(types).toBeGreaterThan(100_000);
  expect(problems.slice(0, 20)).toEqual([]);
}, 240_000);

// The records of an arena, by id: the module constants', then those the program made.
function records(typing: Typing): [number, Record<string, unknown>][] {
  const found: [number, Record<string, unknown>][] = [];
  for (let id = 21; typing.typeOf(id) !== undefined; id++) found.push([id, typing.typeOf(id) as unknown as Record<string, unknown>]);
  return found;
}

// Every Field array and Field object a record holds, in `fields`, a future's or generator's
// `params` and `frame`, is its own: no two records share one, so each record can be a value.
function sharedFields(typing: Typing, where: string): string[] {
  const owners = new Map<object, number>();
  const problems: string[] = [];
  const own = (o: object, id: number, what: string) => {
    const was = owners.get(o);
    if (was !== undefined && was !== id) problems.push(`${where}: a ${(typing.typeOf(id) as { kind: string }).kind} type shares a ${what} with a ${(typing.typeOf(was) as { kind: string }).kind} type`);
    else owners.set(o, id);
  };
  for (const [id, r] of records(typing)) {
    for (const list of (r.kind === "future" || r.kind === "generator" ? [r.fields, r.params, r.frame] : [r.fields]) as object[][]) {
      own(list, id, "Field array");
      for (const f of list as object[]) own(f, id, "Field");
    }
  }
  return problems;
}

test("no two types of the checked test programs share a Field array or Field", () => {
  const session = cachedSession();
  const problems: string[] = [];
  for (const p of corpus()) {
    versions.clear();
    if (p.src.includes("// mode: parse")) continue;
    try {
      problems.push(...sharedFields(analyze(session, p.src, p.file).checked.tables.typing, p.name));
    } catch (e) {
      if (!(e instanceof CompileError)) throw new Error(`${p.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  const kinds = new Map<string, number>();
  for (const p of problems) kinds.set(p.replace(/^[^:]*: /, ""), (kinds.get(p.replace(/^[^:]*: /, "")) ?? 0) + 1);
  expect([...kinds]).toEqual([]);
}, 240_000);

test("a node table reads one entry for a node and its replacement, and refuses a node without an id", () => {
  const map = new NodeMap<Expr, string>();
  const rewrites = new Rewrites();
  const node: Expr = { id: 7, kind: "ident", name: "x", start: 0, end: 1 };
  map.set(node, "kept");
  const by = rewrites.replace(node, { id: 0, kind: "ident", name: "y", start: 0, end: 1 });
  expect(map.get(by)).toBe("kept");
  expect(new NodeSet<Expr>([node]).has(by)).toBe(true);
  expect(() => new NodeSet<{ id: number }>().has({ kind: "c" } as unknown as { id: number })).toThrow("has no id");
});

test("renumbering and moving spans refuse two different nodes under one id", () => {
  const a: Expr = { id: 5, kind: "ident", name: "a", start: 0, end: 1 };
  const copy: Expr = { ...a, start: 4, end: 5 };
  const sum: Expr = { id: 6, kind: "binary", op: "+", left: a, right: copy, start: 0, end: 5 };
  let last = 100;
  expect(() => renumberExpr(cloneExpr(sum), () => ++last)).toThrow("internal error: two nodes share id 5");
  expect(() => shiftSpansExpr(cloneExpr(sum), 10)).toThrow("internal error: two nodes share id 5");
  const shared: Expr = { id: 6, kind: "binary", op: "+", left: a, right: a, start: 0, end: 5 };
  const renumbered = renumberExpr(cloneExpr(shared), () => ++last) as Extract<Expr, { kind: "binary" }>;
  expect(renumbered.left.id).toBe(renumbered.right.id);
});

// A table holding a bare `{ id }`, as the generated marks are, holds no node to clash with.
// Every node table's reads and writes checked against the node it holds under the id, as the
// tables once checked themselves: one other than that node, a copy of it, or its replacement is a
// clash. Copies share their id on purpose, since a node copied to be owned twice is still one node.
const clashes: string[] = [];
function noting<F extends (this: object, node: Id, ...rest: never[]) => unknown>(method: F, held: (table: object, id: number) => object | undefined): F {
  return function (this: object, node: Id, ...rest: never[]) {
    const was = held(this, node.id);
    if (was !== undefined && was !== node && Object.keys(was).length > 1 && Object.keys(node).length > 1 && latest(was) !== latest(node) && !sameSpan(was, node) && !(isVersion(node.id, was) && isVersion(node.id, node))) clashes.push(`two nodes share id ${node.id}: a ${(was as { kind?: string }).kind} and a ${(node as { kind?: string }).kind}`);
    return method.call(this, node, ...rest);
  } as F;
}
type Held = { table: Map<number, unknown> };
const inMap = (t: object, id: number) => (t as unknown as { nodes: Map<number, object> }).nodes.get(id);
const inSet = (t: object, id: number) => (t as unknown as Held).table.get(id) as object | undefined;
for (const m of ["get", "has", "set", "delete"] as const) NodeMap.prototype[m] = noting(NodeMap.prototype[m] as never, inMap);
for (const m of ["has", "add", "delete"] as const) NodeSet.prototype[m] = noting(NodeSet.prototype[m] as never, inSet);

// The node tables tell nodes apart by id alone, so no table may meet two nodes under one id, but
// for a node and its replacement: std, macros, quotes, comptime and generic classes all make or copy
// nodes.
test("no node table meets two different nodes under one id", () => {
  const session = cachedSession();
  const sample = corpus().filter((p) => /^(macro|comptime|generic|derive|class|std|json)/.test(p.name) && !p.src.includes("// mode: parse"));
  expect(sample.length).toBeGreaterThan(50);
  const a = { id: 1, kind: "a", start: 0, end: 1 };
  new NodeMap<{ id: number; kind: string; start: number; end: number }, string>().set(a, "a").get({ ...a, kind: "b", start: 4, end: 5 });
  expect(clashes).toEqual(["two nodes share id 1: a a and a b"]);
  clashes.length = 0;
  for (const p of sample) {
    versions.clear();
    try {
      analyze(session, p.src, p.file);
    } catch (e) {
      if (!(e instanceof CompileError)) throw new Error(`${p.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  expect([...new Set(clashes)]).toEqual([]);
}, 240_000);

// The AST types a table may not be keyed by: every type in src/parser.ts carrying `Id`, and any
// alias a file gives one, as `type Arrow = Extract<Expr, ...>`, `type Decl = Stmt & ...` or
// `Func as Declared`. Tables
// keyed by `object` or `unknown` are left out: they key reflective walks over any value, arrays
// and non-node objects included.
test("no Map, WeakMap, Set or WeakSet in src is keyed by an AST node", () => {
  const parser = readFileSync(join(src, "parser.ts"), "utf8");
  const nodes = [...parser.matchAll(/^export type (\w+) = Span & Id\b/gm)].map((m) => m[1]!);
  expect(nodes).toContain("Expr");
  const offenders: string[] = [];
  for (const f of readdirSync(src).filter((f) => f.endsWith(".ts"))) {
    const text = readFileSync(join(src, f), "utf8");
    const names = [...nodes];
    const alias = new RegExp(`\\b(?:type (\\w+) = (?:(?:Extract|Exclude)<(?:${names.join("|")}),|(?:${names.join("|")}) [&|;])|(?:${names.join("|")}) as (\\w+))`, "g");
    for (const m of text.matchAll(alias)) names.push(m[1] ?? m[2]!);
    const keyed = new RegExp(`\\b(?:Weak)?(?:Map|Set)<\\s*(?:(?:Extract|Exclude)<\\s*)?(?:${names.join("|")}|Span)\\b(?!\\[)`, "g");
    for (const m of text.matchAll(keyed)) offenders.push(`${f}: ${m[0]}`);
  }
  expect(offenders).toEqual([]);
});

test("a type table keys primitives and types by id, in the order they were added", () => {
  const typing = new Typing();
  const a = typing.arrayType("i64");
  const map = new TypeMap<Type, string>([["i64", "int"], [a, "a"]]);
  expect([map.get("i64"), map.get("string"), map.get(a)]).toEqual(["int", undefined, "a"]);
  expect([...map.keys()]).toEqual(["i64", a]);
  expect([...new TypeSet<Type>(["bigint", a, "bigint"])]).toEqual(["bigint", a]);
});

// The types a table may not be keyed by: `Type`, `Bound`, each kind's id and record in
// src/typing.ts, and any alias a file gives one, as `type Shape = ObjectType | UnionType`. A type
// keys by its id through TypeMap and TypeSet, which give a primitive its own integer.
test("no Map, WeakMap, Set or WeakSet in src is keyed by a type", () => {
  const typing = readFileSync(join(src, "typing.ts"), "utf8");
  const kinds = [...typing.matchAll(/^export type (\w+)Type = Brand<usize, "\w+">;/gm)].flatMap((m) => [`${m[1]!}Type`, `${m[1]!}Record`]);
  expect(kinds).toContain("ObjectType");
  expect(kinds.length).toBe(52);
  const types = ["Type", "Bound", "TypeRecord", ...kinds];
  const offenders: string[] = [];
  for (const f of readdirSync(src).filter((f) => f.endsWith(".ts"))) {
    const text = readFileSync(join(src, f), "utf8");
    const names = [...types];
    const alias = new RegExp(`\\btype (\\w+) = (?:(?:Extract|Exclude)<(?:${names.join("|")})\\b|(?:${names.join("|")})(?: [&|]|;))`, "g");
    for (const m of text.matchAll(alias)) names.push(m[1]!);
    const keyed = new RegExp(`\\b(?:Weak)?(?:Map|Set)<\\s*(?:(?:Extract|Exclude)<\\s*)?(?:${names.join("|")})\\b(?![\\[.])`, "g");
    for (const m of text.matchAll(keyed)) offenders.push(`${f}: ${m[0]}`);
  }
  expect(offenders).toEqual([]);
});


// The checker's other records a table may not be keyed by: an Instance, a Body, a Local and a
// ClassInfo, and a list of type parameters. Instances, bodies and locals key by their ids, a class
// by its type's, and a list by its first parameter.
test("no Map, WeakMap, Set or WeakSet in src is keyed by an instance, body, local, class or type parameter list", () => {
  const offenders: string[] = [];
  for (const f of readdirSync(src).filter((f) => f.endsWith(".ts"))) {
    const text = readFileSync(join(src, f), "utf8");
    for (const m of text.matchAll(/\b(?:Weak)?(?:Map|Set)<\s*(?:Instance|Body|Local|ClassInfo|TypeParam\[\])(?![\w.])/g)) offenders.push(`${f}: ${m[0]}`);
  }
  expect(offenders).toEqual([]);
});

// The checker's records and its tables, by where each is declared. They name one another by id,
// read back through the compilation's arenas, which alone hold the records themselves.
const RECORDS: [string, string][] = [
  ["compilation.ts", "Tables"], ["check.ts", "Checked"], ["check.ts", "Instance"], ["check.ts", "Local"], ["classes.ts", "Body"], ["classes.ts", "ClassInfo"], ["values.ts", "DynTable"],
];

test("no instance, body, local or class holds another, nor does a checker table, but through its id", () => {
  const offenders: string[] = [];
  for (const [f, name] of RECORDS) {
    const text = readFileSync(join(src, f), "utf8");
    const start = text.search(new RegExp(`^export type ${name} = `, "m"));
    expect(start).toBeGreaterThanOrEqual(0);
    const first = text.slice(start, text.indexOf("\n", start));
    // A declaration whose first line opens a brace runs to the line closing it.
    const declared = (first.endsWith("{") ? text.slice(start, text.indexOf("\n};", start)) : first).slice(`export type ${name} = `.length);
    for (const line of declared.replace(/\/\/.*$/gm, "").split("\n")) {
      if (/^\s*arenas: Arenas;$/.test(line)) continue;
      for (const m of line.matchAll(/\b(?:Instance|Body|Local|ClassInfo)\b/g)) offenders.push(`${name}: ${line.trim()} (${m[0]})`);
    }
  }
  expect(offenders).toEqual([]);
});

// The checker's files: the checker, codegen and what they share.
const CHECKER = ["check", "values", "classes", "resolve", "typefns", "operators", "typing", "generics", "interfaces", "flow", "narrow", "match", "moves", "comptime", "unions", "enums", "registry", "unsupported", "compilation", "codegen", "layout", "arithmetic", "runtime", "locals", "warnings"];

// The checker's working tables, its own and codegen's, hold ids too, keys and values alike.
test("no Map or Set in the checker holds an instance, body, local or class", () => {
  const offenders: string[] = [];
  for (const f of CHECKER.map((name) => `${name}.ts`)) {
    const text = readFileSync(join(src, f), "utf8");
    for (const m of text.matchAll(/\b(?:Map|Set)<([^;=()]*)/g)) if (/\b(?:Instance|Body|Local|ClassInfo)\b/.test(m[1]!)) offenders.push(`${f}: ${m[0]}`);
  }
  expect(offenders).toEqual([]);
});

// Tables still keyed by objects, each until it is given a key of its own: a walk's set of the
// values it has visited, and codegen's.
const OBJECT_KEYED = ["check.ts: Set<unknown", "locals.ts: Set<unknown", "warnings.ts: Set<unknown", "codegen.ts: WeakSet<object"];

// Fish's Map and Set key on strings and numbers, so every table the checker keeps does: by a
// string, an integer, an arena id, a string-literal union, or through NodeMap, TypeMap and their
// kin, which key by id. Type parameters, `K` and `T`, are a generic table's own.
test("no Map, WeakMap, Set or WeakSet in the checker is keyed by anything but strings or integers", () => {
  const offenders: string[] = [];
  for (const f of CHECKER.map((name) => `${name}.ts`)) {
    const text = readFileSync(join(src, f), "utf8");
    for (const m of text.matchAll(/\b(?:Weak)?(?:Map|Set)<\s*([A-Za-z_][\w.]*(?:\[\])?|"[^"]*")/g)) {
      if (/^(?:string|usize|isize|[iu](?:8|16|32|64|128)|f32|f64|number|bigint|boolean|BinaryOp|(?:Instance|Body|Local|Class)Id|[KT]|"[^"]*")$/.test(m[1]!)) continue;
      const at = `${f}: ${m[0]}`;
      if (!OBJECT_KEYED.includes(at)) offenders.push(at);
    }
  }
  expect(offenders).toEqual([]);
});


// The passes that lower the tree, before checking and while it runs.
const LOWERING = ["check", "values", "narrow", "classes", "generics", "overloads", "defaults", "keys", "modules", "js", "locals", "macros", "quote", "tests", "parseargs"];
// Fields that hold a node's children, as the generated rebuild writes them; a `name` holds a node
// only when computed, and a rename writes a string.
const CHILDREN = [...new Set([...readFileSync(join(src, "rebuild.ts"), "utf8").matchAll(/^\s+m\.(\w+)/gm)].map((m) => m[1]!))].filter((f) => f !== "name").join("|");
// What may still change in place, each for its reason:
const IN_PLACE = [
  // the spans of nodes just made, before any tree holds them;
  "parseargs.ts: Object.assign(node, { start", "tests.ts: walk(\"func\", made, ({ node }) => void Object.assign(node, { start", "values.ts: walk(\"expr\", e, ({ node }) => void Object.assign(node, { start",
  // a Body's overloads, given as ids, an enum's record and a Body's template mark, which are no nodes;
  "check.ts: for (const f of this.funcs) if (f.overloadNames) f.overloads =", "check.ts: for (const e of this.enums.values())", "classes.ts: f.template = true",
  // lists of statements the checker walks, which it edits as a copy recorded by the list's owner
  // in the rewrite table for the rebuild: a statement that becomes several, nested functions
  // hoisted, statements added after the one being checked, and the same edits given to a later
  // copy of a list; and, before checking, a local declaration hoisted out and an export a library
  // lists, each where the list is read next;
  "check.ts: list.splice(", "check.ts: list[i] = { id: nextId(this.cx.tables.ids), kind: \"block\"", "check.ts: while (added.length > 0) list.splice(", "check.ts: while (parts.length > 0) list.splice(", "check.ts: let removed = list.splice(", "locals.ts: stmts[stmts.indexOf(local)] =",
  "check.ts: if (wrapped !== undefined && wrapped.kind === \"block\"", "check.ts: if (inserted !== undefined && inserted.length > 0",
  "modules.ts: l.body[at] =", "macros.ts: statements.splice(",
];

// Lowering records a replacement in a rewrite table, which a rebuild puts in place, rather than
// changing a node's kind or children where it is, as Fish can't through a shared reference.
test("no lowering pass changes a node's kind or children in place", () => {
  const writes = new RegExp(`\\b(?:e|s|d|p|n|node|x|c|call|callee|loop|impl|decl|main|f|arrow|same|at|made|given|local|m|t)(?:\\.\\w+)*\\.(?:${CHILDREN})(?:\\[[^\\]]*\\])?!? (?:=|\\?\\?=) |\\b(?:e|s|d|p|n|node|x|c|f|decl)\\.(?:${CHILDREN})\\.(?:push|splice|unshift)\\(`);
  const lists = /\b(?:list|stmts|statements|place\.list|l\.body)(?:\.splice\(|\[[^\]]+\] = )/;
  const offenders: string[] = [];
  for (const f of LOWERING.map((name) => `${name}.ts`)) {
    for (const line of readFileSync(join(src, f), "utf8").split("\n")) {
      const text = `${f}: ${line.trim()}`;
      const found = /Object\.assign\((?!\{|<)/.test(line) || /\bdelete \(/.test(line) || writes.test(line) || lists.test(line);
      if (found && !IN_PLACE.some((allowed) => text.startsWith(allowed))) offenders.push(text);
    }
  }
  expect(offenders).toEqual([]);
});
