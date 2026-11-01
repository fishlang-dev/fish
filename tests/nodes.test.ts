import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, compiledOf } from "../src/check.ts";
import { newCompilation } from "../src/compilation.ts";
import { cachedSession } from "../src/stdcache.ts";
import { CompileError } from "../src/diag.ts";
import { expandMacros } from "../src/macros.ts";
import { analyze } from "../src/main.ts";
import { flatten, load } from "../src/modules.ts";
import { NodeMap, NodeSet, WeakNodeMap, WeakNodeSet } from "../src/nodes.ts";
import { parse, type Stmt } from "../src/parser.ts";
import { stdFor } from "../src/std.ts";
import { stripTests } from "../src/tests.ts";
import { newTyping, TypeMap, TypeSet, type Type, type Typing } from "../src/typing.ts";

const src = join(import.meta.dir, "..", "src");
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
      else if (ids.has(n.id) && ids.get(n.id) !== n) problems.push(`${at} shares id ${n.id} with another node`);
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
      check(compilation, written);
    } catch (e) {
      if (!(e instanceof CompileError)) throw new Error(`${p.name}: ${e instanceof Error ? e.message : e}`);
    }
    // Checking rewrites parts of the tree in place, and those parts need ids too.
    problems.push(...audit(written, ids, `${p.name}, checked`));
  }
  expect(problems.slice(0, 20)).toEqual([]);
}, 120_000);

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
    if (p.src.includes("// mode: parse")) continue;
    try {
      const { checked } = analyze(session, p.src, p.file);
      const roots: Type[] = compiledOf(checked).flatMap((i) => [...i.types.values(), ...i.coercions.values(), ...i.bindings.values(), i.returns, ...(i.throws ? [i.throws] : [])]);
      types += roots.length;
      problems.push(...auditTypes(roots, checked.compilation.typing, p.name));
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
    if (p.src.includes("// mode: parse")) continue;
    try {
      problems.push(...sharedFields(analyze(session, p.src, p.file).checked.compilation.typing, p.name));
    } catch (e) {
      if (!(e instanceof CompileError)) throw new Error(`${p.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  const kinds = new Map<string, number>();
  for (const p of problems) kinds.set(p.replace(/^[^:]*: /, ""), (kinds.get(p.replace(/^[^:]*: /, "")) ?? 0) + 1);
  expect([...kinds]).toEqual([]);
}, 240_000);

test("a node table refuses a second node with an id already in use", () => {
  const a = { id: 1, kind: "a" };
  const b = { id: 1, kind: "b" };
  const map = new NodeMap<{ id: number }, string>().set(a, "a");
  expect(map.get(a)).toBe("a");
  expect(() => map.get(b)).toThrow("internal error: two nodes share id 1");
  const set = new NodeSet<{ id: number }>([a]);
  expect(() => set.add(b)).toThrow("internal error: two nodes share id 1");
  expect(() => set.has({ kind: "c" } as unknown as { id: number })).toThrow("has no id");
  const weak = new WeakNodeMap<{ id: number }, string>().set(a, "a");
  expect(weak.get(a)).toBe("a");
  expect(() => weak.has(b)).toThrow("internal error: two nodes share id 1");
  expect(() => new WeakNodeSet<{ id: number }>().add(a).add(b)).toThrow("internal error: two nodes share id 1");
});

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
  const typing = newTyping();
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
  const kinds = [...typing.matchAll(/^export type (\w+Type) = TypeId<(\w+Record)>;/gm)].flatMap((m) => [m[1]!, m[2]!]);
  expect(kinds).toContain("ObjectType");
  expect(kinds.length).toBe(48);
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
// values it has visited, the quote, call and scope tables keyed by tree nodes without ids, and
// refusals held aside.
const OBJECT_KEYED = [
  "check.ts: Set<unknown", "locals.ts: Set<unknown", "warnings.ts: Set<unknown",
  "compilation.ts: WeakMap<Stmt[]", "compilation.ts: WeakMap<object", "codegen.ts: WeakSet<object", "typing.ts: WeakSet<CompileError",
];

// Fish's Map and Set key on strings and integers, so every table the checker keeps does: by a
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

