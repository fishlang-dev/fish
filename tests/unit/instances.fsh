// Instances and bodies are made whole, with empty tables, even where a function reads only a few
// of their fields.
import { join } from "node:path";
import { Arenas, type BodyId, type InstanceId } from "../../src/arenas.fsh";
import { emptyTables, unreached } from "../../src/check.fsh";
import { shortened, symbolIn, symbolNames } from "../../src/codegen.fsh";
import { CompileError } from "../../src/diag.fsh";
import { compile } from "../../src/main.fsh";
import type { Expr } from "../../src/parser.fsh";
import { cachedSession } from "../../src/stdcache.fsh";
import { Typing, TypeMap, digest, type ClassType, type Type } from "../../src/typing.fsh";
import { read, root } from "./support.fsh";

function program(name: string): string {
  return join(root(), "tests", "programs", name);
}

// The IR of `src`, compiled as `file`; a compile error fails the test.
function compiled(src: string, file: string): string {
  try {
    return compile(cachedSession(), src, file);
  } catch (e) {
    assert(false, `${file}: ${e.message}`);
    return "";
  }
}

// How many times `re` matches `ir`.
function count(ir: string, matches: string[] | null): usize {
  return matches === null ? 0 : matches.length;
}

// Monomorphization compiles each generic function once per distinct set of type arguments,
// however many calls share it, and never compiles a definition check.
test("one function per instance", () => {
  const file = program("generics.fsh");
  const ir = compiled(read(file), file);
  // identity runs on i64 (three calls, one explicit), boolean, and two object shapes.
  const identity = count(ir, ir.match(/^define .*@"fsh\.identity#[0-9a-z.]+"/gm));
  assert(identity === 4, `${identity} instances of identity`);
  const first = count(ir, ir.match(/^define .*@"fsh\.first#[0-9a-z.]+"/gm));
  assert(first === 2, `${first} instances of first`);
  const getX = count(ir, ir.match(/^define .*@"fsh\.getX#[0-9a-z.]+"/gm));
  assert(getX === 3, `${getX} instances of getX`);
  assert(!ir.includes("@\"fsh.identity\"("), "the definition check of identity is called");
});

// A function given a different closure by each caller, which it only calls or hands on to
// itself, is compiled once for all of them; one that uses it any other way is not.
test("one instance for every closure a callback parameter is given", () => {
  const file = program("callback_shared.fsh");
  const parts = read(file).split(/^\/\/ case: .*$/m);
  const ir = compiled(parts[1], file);
  const defined = count(ir, ir.match(/^define .*@"fsh\.walk#[0-9a-z.]+"/gm));
  assert(defined === 1, `${defined} instances of walk`);
  let named = new Set<string>();
  for (const m of ir.matchAll(/@("fsh\.walk[^"]*")/g)) named.add(m[1]);
  assert(named.size === 1, `walk is named ${named.size} ways`);
  const kept = compiled(`
function keep(f: () => i64): i64 { const g = f; return g(); }
function main() {
  const a = 1;
  const b = 2;
  console.log(keep(() => a), keep(() => b));
}`, file);
  const keeps = count(kept, kept.match(/^define .*@"fsh\.keep#[0-9a-z.]+"/gm));
  assert(keeps === 2, `${keeps} instances of keep, which keeps its closure`);
  const storedInObject = compiled(`
function keep(f: () => i64): i64 { const r = f(); const _o = { f }; return r; }
function main() {
  const a = 1;
  const b = 2;
  console.log(keep(() => a), keep(() => b));
}`, file);
  const stored = count(storedInObject, storedInObject.match(/^define .*@"fsh\.keep#[0-9a-z.]+"/gm));
  assert(stored === 2, `${stored} instances of keep, which stores its closure in an object`);
  // One IR shape, two drops: a string and an Rc are both a pointer.
  const results = compiled(`
function run(f: () => void): void { f(); }
function main() {
  run(() => "a".repeat(2));
  run(() => new Rc<i64>(1));
}`, file);
  const runs = count(results, results.match(/^define .*@"fsh\.run#[0-9a-z.]+"/gm));
  assert(runs === 2, `${runs} instances of run, whose closures drop different results`);
});

// A body with no code, named `name`, owned by `owner`.
function body(arenas: Mut<Arenas>, name: string, owner?: ClassType): BodyId {
  return arenas.addBody({ id: 0, start: 0, end: 0, name, params: [], body: [], returnType: undefined, owner }).bodyId;
}

// An instance of `of` named `symbol`, with empty tables.
function instance(arenas: Mut<Arenas>, of: BodyId, symbol: string): InstanceId {
  return arenas.addInstance({ body: of, symbol, bindings: new Map<string, Type>(), concrete: true, depth: 0, returns: "void", ...emptyTables() }).id;
}

// An instance named `symbol` of a body named `m`.
function made(arenas: Mut<Arenas>, symbol: string): InstanceId {
  const of = body(arenas, "m");
  return instance(arenas, of, symbol);
}

// Two instances whose symbols read alike, as classes made from arguments shown the same way, get
// names of their own in the IR, each by a digest of its whole symbol and a count when those are
// the same too, so a name doesn't depend on which was made first; one alone keeps its symbol.
test("instances that read alike get symbols of their own", () => {
  let arenas = new Arenas();
  const a = made(arenas, "Box<T>.get");
  const b = made(arenas, "Box<T>.get");
  const c = made(arenas, "Box<U>.get");
  const names = symbolNames(arenas);
  const got = [symbolIn(arenas, arenas.instanceOf(a), names), symbolIn(arenas, arenas.instanceOf(b), names), symbolIn(arenas, arenas.instanceOf(c), names)].join(" ");
  assert(got === '@"fsh.Box<T>.get~r07hia" @"fsh.Box<T>.get~r07hia.2" @"fsh.Box<U>.get"', got);
});

// An abstract member's signature and a template are checked but never compiled, so no compiled
// code may call one: every Fish symbol a program's IR names is one it defines.
test("abstract classes compile no call to what isn't compiled", () => {
  const file = program("abstract.fsh");
  let cases: string[] = [];
  for (const c of read(file).split(/^\/\/ case: .*$/m).slice(1)) if (!/^\/\/ error:/m.test(c)) cases.push(c);
  assert(cases.length > 5, `only ${cases.length} cases`);
  let missing: string[] = [];
  for (const src of cases) {
    const ir = compiled(src, file);
    let defined = new Set<string>();
    for (const m of ir.matchAll(/^(?:define [^@]*)?@("fsh\.[^"]+")(?: =|\()/gm)) defined.add(m[1]);
    for (const m of ir.matchAll(/@("fsh\.[^"]+")/g)) if (!defined.has(m[1])) missing.push(m[1]);
  }
  assert(missing.length === 0, missing.join(", "));
});

// Once copies of `this` are refused, no program makes a value of an abstract class for '==='
// to compare, so the net under them is tested directly: a comparison reaching an `equals`
// that isn't compiled, through an object holding the class, is refused at its span.
test("a comparison can't reach an equals that isn't compiled", () => {
  let typing = new Typing();
  const shape = typing.classType("Shape");
  let r = typing.rec(shape);
  r.abstract = true;
  typing.setRec(shape, r);
  let arenas = new Arenas();
  const equalsBody = body(arenas, "Shape.equals", shape);
  const equals = instance(arenas, equalsBody, "Shape.equals");
  const entries: (readonly [ClassType, InstanceId])[] = [[shape, equals]];
  const equalities = new TypeMap<ClassType, InstanceId>(entries);
  const left: Expr = { id: 1, kind: "ident", name: "a", start: 10, end: 20 };
  const right: Expr = { id: 2, kind: "ident", name: "b", start: 10, end: 20 };
  const compare: Expr = { id: 3, kind: "binary", op: "===", left: left.clone(), right: right.clone(), start: 10, end: 20 };
  const held = typing.objectType([{ name: "s", type: shape }]);
  let tables = emptyTables();
  tables.types.set(left, held);
  tables.types.set(right, held);
  tables.types.set(compare, "boolean");
  const checkBody = body(arenas, "check");
  const caller = arenas.addInstance({ body: checkBody, symbol: "check", bindings: new Map<string, Type>(), concrete: true, depth: 0, returns: "void", ...tables }).id;
  const compiled = [caller];
  let shown = "";
  try {
    unreached(typing, equalities, arenas, compiled, (i) => i.id === equals);
  } catch (e) {
    if (e instanceof CompileError) {
      assert(e.message.includes("abstract class 'Shape' can't reach 'Shape.equals' to compare them") && e.start === 10 && e.end === 20, `${e.message} at ${e.start}-${e.end}`);
      shown = e.message;
    } else assert(false, e.message);
  }
  assert(shown !== "", "a comparison reaching an equals that isn't compiled is let through");
  try {
    unreached(typing, equalities, arenas, compiled, (_i) => false);
  } catch (e) {
    assert(false, `refused with nothing dropped: ${e.message}`);
  }
});

// The sorted symbols of identity's instances in `ir`.
function symbols(ir: string): string[] {
  let found: string[] = [];
  for (const m of ir.matchAll(/^define .*@"(fsh\.identity#[0-9a-z.]+)"/gm)) found.push(m[1]);
  return found.toSorted();
}

// An instance's symbol is its name and the FNV-1a digest of its type arguments, so it is the same
// in every compilation and every program, and differs when the arguments do.
test("instance symbols are stable and tell type arguments apart", () => {
  assert(digest("") === (0xcbf29ce484222325n).toString(36).slice(-6), `digest("") is ${digest("")}`);
  assert(digest("a") === (0xaf63dc4c8601ec8cn).toString(36).slice(-6), `digest("a") is ${digest("a")}`);
  const file = program("generics.fsh");
  const here = symbols(compiled(read(file), file));
  const other = symbols(compiled(read(file), file));
  assert(other.join(" ") === here.join(" "), `${other.join(" ")} against ${here.join(" ")}`);
  assert(new Set<string>(here.clone()).size === 4, here.join(" "));
  let numbered: string[] = [];
  for (const s of here) if (/#\w+\.\d+$/.test(s)) numbered.push(s);
  assert(numbered.length === 0, numbered.join(" "));
});

test("a long type argument list is hashed whole, past the angle brackets its text holds", () => {
  const name = `C<{ op: ">=" | "<"; f: () => ${"x".repeat(200)} }>.m`;
  assert(/^C<#\w+>\.m$/.test(shortened(name)), shortened(name));
});
