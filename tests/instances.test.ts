import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Arenas, type InstanceId } from "../src/arenas.ts";
import { compile } from "../src/main.ts";
import { shortened, symbolIn, symbolNames } from "../src/codegen.ts";
import { cachedSession } from "../src/stdcache.ts";
import { unreached, type Body, type Instance } from "../src/check.ts";
import type { Expr } from "../src/parser.ts";
import { NodeMap } from "../src/nodes.ts";
import { Typing, TypeMap, type ClassType, type Type, digest } from "../src/typing.ts";

const session = cachedSession();

// Monomorphization compiles each generic function once per distinct set of type arguments,
// however many calls share it, and never compiles a definition check.
test("one function per instance", () => {
  const file = join(import.meta.dir, "programs", "generics.fsh");
  const ir = compile(session, readFileSync(file, "utf8"), file);
  const defined = (name: string) => ir.match(new RegExp(`^define .*@"fsh\\.${name}#[0-9a-z.]+"`, "gm"))?.length ?? 0;
  // identity runs on i64 (three calls, one explicit), boolean, and two object shapes.
  expect(defined("identity")).toBe(4);
  expect(defined("first")).toBe(2);
  expect(defined("getX")).toBe(3);
  expect(ir).not.toContain("@\"fsh.identity\"(");
});

// A function given a different closure by each caller, which it only calls or hands on to
// itself, is compiled once for all of them; one that uses it any other way is not.
test("one instance for every closure a callback parameter is given", () => {
  const file = join(import.meta.dir, "programs", "callback_shared.fsh");
  const src = readFileSync(file, "utf8").split(/^\/\/ case: .*$/m)[1]!;
  const ir = compile(session, src, file);
  const defined = ir.match(/^define .*@"fsh\.walk#[0-9a-z.]+"/gm) ?? [];
  expect(defined.length).toBe(1);
  const named = new Set([...ir.matchAll(/@("fsh\.walk[^"]*")/g)].map((m) => m[1]));
  expect(named.size).toBe(1);
  const kept = compile(session, `
function keep(f: () => i64): i64 { const g = f; return g(); }
function main() {
  const a = 1;
  const b = 2;
  console.log(keep(() => a), keep(() => b));
}`, file);
  expect(kept.match(/^define .*@"fsh\.keep#[0-9a-z.]+"/gm)?.length).toBe(2);
  const storedInObject = compile(session, `
function keep(f: () => i64): i64 { const r = f(); const _o = { f }; return r; }
function main() {
  const a = 1;
  const b = 2;
  console.log(keep(() => a), keep(() => b));
}`, file);
  expect(storedInObject.match(/^define .*@"fsh\.keep#[0-9a-z.]+"/gm)?.length).toBe(2);
  // One IR shape, two drops: a string and an Rc are both a pointer.
  const results = compile(session, `
function run(f: () => void): void { f(); }
function main() {
  run(() => "a".repeat(2));
  run(() => new Rc<i64>(1));
}`, file);
  expect(results.match(/^define .*@"fsh\.run#[0-9a-z.]+"/gm)?.length).toBe(2);
});

// Two instances whose symbols read alike, as classes made from arguments shown the same way, get
// names of their own in the IR; one alone keeps its symbol.
test("instances that read alike get symbols of their own", () => {
  const arenas = new Arenas();
  const made = (symbol: string) => arenas.addInstance({ body: arenas.addBody({ name: "m" } as Body).bodyId, symbol, bindings: new Map() } as unknown as Omit<Instance, "id">);
  const [a, b, c] = [made("Box<T>.get"), made("Box<T>.get"), made("Box<U>.get")];
  const names = symbolNames(arenas);
  expect([symbolIn(names, arenas, a), symbolIn(names, arenas, b), symbolIn(names, arenas, c)]).toEqual(['@"fsh.Box<T>.get"', '@"fsh.Box<T>.get~2"', '@"fsh.Box<U>.get"']);
});

// An abstract member's signature and a template are checked but never compiled, so no compiled
// code may call one: every Fish symbol a program's IR names is one it defines.
test("abstract classes compile no call to what isn't compiled", () => {
  const file = join(import.meta.dir, "programs", "abstract.fsh");
  const cases = readFileSync(file, "utf8").split(/^\/\/ case: .*$/m).slice(1).filter((c) => !/^\/\/ error:/m.test(c));
  expect(cases.length).toBeGreaterThan(5);
  for (const src of cases) {
    const ir = compile(session, src, file);
    const defined = new Set([...ir.matchAll(/^(?:define [^@]*)?@("fsh\.[^"]+")(?: =|\()/gm)].map((m) => m[1]));
    const named = [...ir.matchAll(/@("fsh\.[^"]+")/g)].map((m) => m[1]!);
    expect(named.filter((n) => !defined.has(n))).toEqual([]);
  }
});

// Once copies of `this` are refused, no program makes a value of an abstract class for '==='
// to compare, so the net under them is tested directly: a comparison reaching an `equals`
// that isn't compiled, through an object holding the class, is refused at its span.
test("a comparison can't reach an equals that isn't compiled", () => {
  const typing = new Typing();
  const shape = typing.classType("Shape");
  typing.rec(shape).abstract = true;
  const arenas = new Arenas();
  const body = (b: object) => arenas.addBody(b as Body).bodyId;
  const equals = arenas.addInstance({ body: body({ name: "Shape.equals", owner: shape }), bindings: new Map(), tables: { arenas } } as unknown as Omit<Instance, "id">);
  const equalities = new TypeMap<ClassType, InstanceId>([[shape, equals.id]]);
  const at = { start: 10, end: 20 };
  const [left, right] = [{ id: 1, kind: "ident", name: "a", ...at }, { id: 2, kind: "ident", name: "b", ...at }] as Expr[];
  const compare = { id: 3, kind: "binary", op: "===", left, right, ...at } as Expr;
  const held = typing.objectType([{ name: "s", type: shape }]);
  const types = new NodeMap<Expr, Type>([[left!, held], [right!, held], [compare, "boolean"]]);
  const caller = arenas.addInstance({ body: body({ name: "check" }), bindings: new Map(), calls: new NodeMap(), setters: new NodeMap(), types, tables: { arenas } } as unknown as Omit<Instance, "id">);
  expect(() => unreached(typing, equalities, arenas, [caller.id], (i) => i === equals)).toThrow(expect.objectContaining({ message: expect.stringContaining("abstract class 'Shape' can't reach 'Shape.equals' to compare them"), start: 10, end: 20 }));
  expect(() => unreached(typing, equalities, arenas, [caller.id], () => false)).not.toThrow();
});

// An instance's symbol is its name and the FNV-1a digest of its type arguments, so it is the same
// in every process and every program, and differs when the arguments do.
test("instance symbols are stable and tell type arguments apart", () => {
  expect(digest("")).toBe((0xcbf29ce484222325n).toString(36).slice(-6));
  expect(digest("a")).toBe((0xaf63dc4c8601ec8cn).toString(36).slice(-6));
  const file = join(import.meta.dir, "programs", "generics.fsh");
  const symbols = (ir: string) => [...ir.matchAll(/^define .*@"(fsh\.identity#[0-9a-z.]+)"/gm)].map((m) => m[1]!).sort();
  const here = symbols(compile(session, readFileSync(file, "utf8"), file));
  const src = (name: string) => JSON.stringify(join(import.meta.dir, "..", "src", name));
  const script = `import { compile } from ${src("main.ts")}; import { cachedSession } from ${src("stdcache.ts")}; import { readFileSync } from "node:fs"; console.log(compile(cachedSession(), readFileSync(${JSON.stringify(file)}, "utf8"), ${JSON.stringify(file)}));`;
  const other = Bun.spawnSync(["bun", "-e", script]);
  expect(symbols(other.stdout.toString())).toEqual(here);
  expect(new Set(here).size).toBe(4);
  expect(here.filter((s) => /#\w+\.\d+$/.test(s))).toEqual([]);
});

test("a long type argument list is hashed whole, past the angle brackets its text holds", () => {
  const name = `C<{ op: ">=" | "<"; f: () => ${"x".repeat(200)} }>.m`;
  expect(shortened(name)).toMatch(/^C<#\w+>\.m$/);
});
