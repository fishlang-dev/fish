import { readFileSync, realpathSync } from "node:fs";
import { availableParallelism } from "node:os";
import type { Subprocess } from "bun";
import { relative } from "node:path";
import type { Compilation } from "./compilation.fsh";
import { CompileError } from "./diag.fsh";
import { examplesIn, exampleTest, type Example } from "./docs.fsh";
import { renameIn, resolveSpecifier, shiftError, specifierOf, type Loaded, type Module } from "./modules.fsh";
import { nextId, respanFunc, shiftSpansStmts, type Ids } from "./nodes.fsh";
import { parse, parseWithComments, type Expr, type Func, type ObjectProp, type Param, type Span, type Stmt, type TypeNode } from "./parser.fsh";

// Top-level `test("name", () => { ... })` blocks, and `property("name", (x: T, ...) => { ... })`
// ones run over inputs generated from their parameters' types: left out of a build, lifted into
// functions of their own file for `fishc test` and the language server, and run by a generated
// harness.

type Body = Extract<Expr, { kind: "arrow" | "function" }>;
// `index` is the test's place in the harness's numbering; `module` is the file declaring it, by
// its name and its path.
// A test's `timeout` is the limit its options gave it, in milliseconds, or undefined for the run's.
// A doc example's `expect` holds the stdout lines it must print, when it names any.
export type Test = { name: string; module: { file: string; path: string }; index: usize; async: boolean; timeout: usize | undefined; expect?: string[] };

const SHAPE = `a test is written as 'test("name", () => { ... })' at the top level of a file, its name a string literal, with '{ timeout: <ms> }' after the body for a limit of its own`;

// A top-level statement's test: its name, where the name is, whether its body is async, and the
// limit its options give it.
type Found = { name: string; start: usize; end: usize; async: boolean; timeout: usize | undefined; property: boolean };

const PROPERTY_SHAPE = `a property is written as 'property("name", (x: T, ...) => { ... })' at the top level of a file, its name a string literal and each parameter a name with its type written, with '{ timeout: <ms> }' after the body for a limit of its own`;

// The test a top-level statement is, or undefined when it isn't a `test(...)` call.
/** @throws {CompileError} */
export function testOf(s: Ref<Stmt>): Found | undefined {
  if (s.kind !== "expr" || s.expr.kind !== "call" || s.expr.callee.kind !== "ident" || (s.expr.callee.name !== "test" && s.expr.callee.name !== "property")) return undefined;
  const property = s.expr.callee.name === "property";
  const args: Ref<Expr[]> = s.expr.args;
  const shaped = (args.length === 2 || args.length === 3) && s.expr.typeArgs.length === 0 && !s.expr.optional && args[0]!.kind === "string" && (property ? typedParams(args[1]!) : bare(args[1]!));
  if (!shaped) throw new CompileError("E1106", property ? PROPERTY_SHAPE : SHAPE, s.expr.start, s.expr.end);
  let timeout: usize | undefined = undefined;
  if (args.length === 3) timeout = timeoutOf(args[2]!);
  const name: Ref<Expr> = args[0]!;
  const body: Ref<Expr> = args[1]!;
  if (name.kind !== "string") return undefined;
  // `--list` and the report give each test one line.
  if (/[\n\r]/.test(name.value)) throw new CompileError("E1106", "a test's name is one line, so it can't hold a line break", name.start, name.end);
  // A property's harness awaits each run, which goes as a task of its own.
  const async = property || (body.kind === "arrow" ? body.async : body.kind === "function" ? body.async : false);
  return { name: name.value, start: name.start, end: name.end, async, timeout, property };
}

// Whether `e` is an arrow or a function that isn't a generator, each of whose parameters is a
// name with its type written.
function typedParams(e: Ref<Expr>): boolean {
  if (e.kind !== "arrow" && e.kind !== "function") return false;
  if (e.kind === "function" && e.generator) return false;
  if (e.typeParams.length > 0 || e.params.length === 0) return false;
  for (const p of e.params) if (p.pattern.kind !== "ident" || p.type === undefined || p.rest || p.optional || p.default !== undefined) return false;
  return true;
}

// The limit a test's options give it: `{ timeout: <ms> }`, an integer literal, read while
// compiling so the harness knows every test's limit before running any.
/** @throws {CompileError} */
function timeoutOf(options: Ref<Expr>): usize {
  const refused = new CompileError("E1106", "a test's options are '{ timeout: <ms> }', its limit in milliseconds as a whole number above 0", options.start, options.end);
  if (options.kind !== "object" || options.props.length !== 1) throw refused;
  const p: Ref<ObjectProp> = options.props[0]!;
  if (p.kind !== "property" || p.key !== "timeout") throw refused;
  const value: Ref<Expr> = p.value;
  if (value.kind !== "int" || value.value <= 0n || value.value > 86_400_000n) throw refused;
  return (Number(String(value.value)) ?? 0) as usize;
}

// Whether `e` is an arrow or a function that isn't a generator, taking no parameters.
function bare(e: Ref<Expr>): boolean {
  if (e.kind === "arrow") return e.params.length === 0 && e.typeParams.length === 0;
  if (e.kind === "function") return !e.generator && e.params.length === 0 && e.typeParams.length === 0;
  return false;
}

// The names of the tests the file at `path` declares, from its parse alone, so a run can build only
// the files it needs; undefined when it can't be read, doesn't parse or holds a malformed test,
// which its build reports.
export function testNamesIn(path: string): string[] | undefined {
  let ids: Ids = { last: 0 };
  let names: string[] = [];
  try {
    for (const s of parse(readFileSync(path, "utf8"), ids)) {
      const found = testOf(s);
      if (found !== undefined) names.push(found.name);
    }
  } catch (e) {
    return undefined;
  }
  return names;
}

// The files `path` imports or re-exports from by a relative path, as real paths: none when it can't
// be read or doesn't parse, and none for an import that names no file.
export function importsIn(path: string): string[] {
  let ids: Ids = { last: 0 };
  let statements: Stmt[] = [];
  try {
    statements = parse(readFileSync(path, "utf8"), ids);
  } catch (_e) {
    return [];
  }
  let found: string[] = [];
  for (const s of statements) {
    const specifier = specifierOf(s);
    if (specifier === undefined || !/^\.\.?(\/|$)/.test(specifier)) continue;
    let looked: string[] = [];
    let file: string | undefined = undefined;
    try {
      file = realpathSync(resolveSpecifier(path, specifier, { start: s.start, end: s.end }, looked));
    } catch (_e) {}
    if (file !== undefined) found.push(file);
  }
  return found;
}

// Each of `roots` with the files it depends on: itself and every file it imports, directly or
// through others, as real paths.
/** @throws {IoError} */
export function dependencies(roots: Ref<string[]>): Map<string, Set<string>> {
  let imports = new Map<string, string[]>();
  let closures = new Map<string, Set<string>>();
  for (const root of roots) {
    let seen = new Set<string>();
    let pending = [realpathSync(root)];
    while (pending.length > 0) {
      const f = pending.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      if (!imports.has(f)) imports.set(f, importsIn(f));
      const next = imports.get(f)!;
      for (const g of next) if (!seen.has(g)) pending.push(g);
    }
    closures.set(root, seen);
  }
  return closures;
}

// Leaves every file's tests out, as a build does before checking.
/** @throws {CompileError} */
export function stripTests(loaded: Mut<Loaded>) {
  for (let at: usize = 0; at < loaded.modules.length; at++) {
    const m: Mut<Module> = loaded.modules[at]!;
    // Every statement is looked at before any moves, so a refusal leaves the file as it was.
    let tests: boolean[] = [];
    for (const s of m.statements) tests.push(testOf(s) !== undefined);
    let kept: Stmt[] = [];
    let i: usize = 0;
    while (m.statements.length > 0) {
      const s = m.statements.shift()!;
      if (!tests[i]!) kept.push(s);
      i++;
    }
    m.statements = kept;
  }
}

// The function a test is lifted into. Linking renames a qualified name only up to its first dot, so
// the symbol holds none.
function testSymbol(name: string): string {
  return `test ${JSON.stringify(name).replaceAll(".", "\\u002e")}`;
}

// Turns each test of the files at `paths`, in that order, into a function of its own file,
// `test "name"`, which no program can write. A test's function throws Error, so a body may throw,
// and is async when the body is. Names are unique across the files; a second use of one is refused.
/** @throws {CompileError | Error} */
// With `docs`, each ```fsh example in a file's doc comments is a test too, run in that file.
export function liftTests(compilation: Mut<Compilation>, modules: Mut<Module[]>, paths: Ref<string[]>, docs = false): Test[] {
  let tests: Test[] = [];
  for (const path of paths) {
    const at = modules.findIndex((m) => m.path === path);
    if (at < 0) continue;
    const module: Mut<Module> = modules[at as usize]!;
    // Each file's tests are named before any statement moves, so a refusal leaves the file as it was.
    let symbols: (string | undefined)[] = [];
    let properties: boolean[] = [];
    for (const s of module.statements) {
      const found = testOf(s);
      if (found === undefined) {
        symbols.push(undefined);
        properties.push(false);
        continue;
      }
      properties.push(found.property);
      const name = found.name;
      const twin = tests.find((t) => t.name === name);
      if (twin !== undefined) throw new CompileError("E1106", `there is already a test named '${name}' in '${twin.module.file}'; give each test a name of its own`, found.start, found.end);
      tests.push({ name, module: { file: module.file, path: module.path }, index: tests.length, async: found.async, timeout: found.timeout });
      const symbol = testSymbol(name);
      compilation.names.madeUp.set(symbol, `the test '${name}'`);
      symbols.push(symbol);
    }
    const aliases = aliasesOf(module.statements);
    let statements: Stmt[] = [];
    let i: usize = 0;
    while (module.statements.length > 0) {
      const s = module.statements.shift()!;
      const symbol = symbols[i];
      const property = properties[i]!;
      i++;
      if (symbol === undefined) statements.push(s);
      else if (property) {
        const at = tests.findIndex((t) => testSymbol(t.name) === symbol);
        let lifted = liftedProperty(compilation.ids, symbol, s, { k: at as usize, n: 0, src: module.src, base: module.base, aliases: aliases.clone(), out: [], seen: new Set<string>() });
        while (lifted.length > 0) statements.push(lifted.shift()!);
      } else statements.push(liftedTest(compilation.ids, symbol, s));
    }
    if (docs) {
      const comments = parseWithComments(module.src, compilation.ids).comments;
      for (const e of examplesIn(module.src, comments)) {
        const name = `doc example at ${module.file}:${e.line}`;
        tests.push({ name, module: { file: module.file, path: module.path }, index: tests.length, async: e.async, timeout: undefined, expect: e.expect.length > 0 ? e.expect.clone() : undefined });
        const symbol = testSymbol(name);
        compilation.names.madeUp.set(symbol, `the ${name}`);
        const example = exampleStatement(compilation.ids, e, module.base);
        statements.push(liftedTest(compilation.ids, symbol, example));
      }
    }
    module.statements = statements;
  }
  return tests;
}

// A doc example's `test(...)` statement, its code at its offsets in the file at `base`.
/** @throws {CompileError} */
function exampleStatement(ids: Mut<Ids>, e: Ref<Example>, base: usize): Stmt {
  const made = exampleTest(e);
  const by = base - made.before;
  let parsed: Stmt[] = [];
  try {
    parsed = parse(made.text, ids);
  } catch (err) {
    if (err instanceof CompileError) shiftError(err, by);
    throw err;
  }
  shiftSpansStmts(parsed, by);
  return parsed.shift()!;
}

// The function a test's statement becomes, `testOf` having found it to be one.
/** @throws {CompileError | Error} */
function liftedTest(ids: Mut<Ids>, name: string, s: Stmt): Func {
  const at: Span = { start: s.start, end: s.end };
  let call = s;
  if (call.kind === "expr" && call.expr.kind === "call") {
    // The body is the second argument, with the options, when there are any, after it.
    if (call.expr.args.length === 3) call.expr.args.pop();
    const body = call.expr.args.pop();
    if (body !== undefined && (body.kind === "arrow" || body.kind === "function")) return lifted(ids, name, body, at);
  }
  throw new Error("internal error: a test is no longer a call of 'test'");
}

/** @throws {CompileError | Error} */
function lifted(ids: Mut<Ids>, name: string, body: Body, at: Ref<Span>): Func {
  let parsed = parse(`${body.async ? "async " : ""}function f(): ${body.async ? "Promise<void>" : "void"} throws Error {}`, ids);
  const made = parsed.shift();
  if (made === undefined || made.kind !== "function") throw new Error("internal error: a test's function didn't parse as one");
  const placed = respanFunc(made, at);
  let statements: Stmt[] = [];
  if (body.kind === "function") statements = body.body;
  else if (Array.isArray(body.body)) statements = body.body;
  else {
    const start = body.body.start;
    const end = body.body.end;
    statements = [{ id: nextId(ids), kind: "expr", expr: body.body, start, end }];
  }
  return { ...placed, id: nextId(ids), name, body: statements };
}

// A file's top-level type aliases without type parameters, which a property's parameter may name.
function aliasesOf(statements: Ref<Stmt[]>): Map<string, TypeNode> {
  let out = new Map<string, TypeNode>();
  for (const s of statements) {
    const d: Ref<Stmt> = s.kind === "export" ? s.body : s;
    if (d.kind === "typeAlias" && d.typeParams.length === 0) out.set(d.name, d.type.clone());
  }
  return out;
}

// A property's generators are functions of their own: `__propGen<k>_<n>` makes a value of a
// type and `__propShrink<k>_<n>` gives smaller values of it, nearest zero or empty first.
type Generating = { k: usize; n: usize; src: string; base: usize; aliases: Map<string, TypeNode>; out: string[]; seen: Set<string> };

const INTEGERS = new Set<string>(["i8", "i16", "i32", "i64", "isize", "u8", "u16", "u32", "u64", "usize"]);

// The generator and the shrinker for `t`, by their names.
/** @throws {CompileError} */
function generator(g: Mut<Generating>, t: Ref<TypeNode>, depth: usize): [string, string] {
  const name = `__propGen${g.k}_${g.n}`;
  const shrink = `__propShrink${g.k}_${g.n}`;
  g.n++;
  const written = g.src.slice((t.start - g.base) as i64, (t.end - g.base) as i64);
  const refused = (what: string) => new CompileError("E1106", `a property's parameter can't be ${what} yet; properties take numbers, booleans, strings, arrays, tuples, object types, unions of those and of literals, and aliases naming them`, t.start, t.end);
  if (depth > 8) throw refused("a type nested this deeply");
  let gen = "";
  let shr = "return [];";
  // A number or a boolean is shrunk from a copy, anything else from a borrow.
  let copied = false;
  if (t.kind === "ref" && t.args.length === 0 && INTEGERS.has(t.name)) {
    copied = true;
    gen = `return __propInteger(r, size) as ${t.name};`;
    shr = `let out: ${t.name}[] = [];\n  for (const x of __propShrinkInteger(v as i64)) out.push(x as ${t.name});\n  return out;`;
  } else if (t.kind === "ref" && t.args.length === 0 && (t.name === "f64" || t.name === "f32")) {
    copied = true;
    gen = `return __propFloat(r, size) as ${t.name};`;
    shr = `let out: ${t.name}[] = [];\n  for (const x of __propShrinkFloat(v as f64)) out.push(x as ${t.name});\n  return out;`;
  } else if (t.kind === "ref" && t.args.length === 0 && t.name === "boolean") {
    copied = true;
    gen = "return __propBoolean(r);";
    shr = "let out: boolean[] = [];\n  if (v) out.push(false);\n  return out;";
  } else if (t.kind === "ref" && t.args.length === 0 && t.name === "string") {
    gen = "return __propString(r, size);";
    shr = "return __propShrinkString(v);";
  } else if (t.kind === "array" || (t.kind === "ref" && t.name === "Array" && t.args.length === 1)) {
    const element: Ref<TypeNode> = t.kind === "array" ? t.element : t.args[0]!;
    const [eg, es] = generator(g, element, depth + 1);
    gen = `const n = __propLength(r, size);\n  let out: ${written} = [];\n  for (let i = 0; i < n; i++) out.push(${eg}(r, size));\n  return out;`;
    shr = `let out: (${written})[] = [];\n  const n = v.length as i64;\n  if (n > 0) out.push([]);\n  if (n > 1) {\n    out.push(v.slice(0, n / 2));\n    out.push(v.slice(n / 2));\n  }\n  for (let i: i64 = 0; i < n && i < 16; i++) {\n    let fewer = v.slice(0, i);\n    for (const x of v.slice(i + 1)) fewer.push(x.clone());\n    out.push(fewer);\n  }\n  for (let i: i64 = 0; i < n && i < 16; i++) {\n    const smaller = ${es}(v[i as usize]);\n    if (smaller.length > 0) {\n      let c = v.clone();\n      c[i as usize] = smaller[0].clone();\n      out.push(c);\n    }\n  }\n  return out;`;
  } else if (t.kind === "tuple") {
    let parts: string[] = [];
    let shrinks: string[] = [];
    let i: usize = 0;
    for (const e of t.elements) {
      if (e.optional || e.rest) throw refused("a tuple with optional or rest elements");
      const [eg, es] = generator(g, e.type, depth + 1);
      parts.push(`${eg}(r, size)`);
      shrinks.push(`  for (const x of ${es}(v[${i}])) {\n    let c = v.clone();\n    c[${i}] = x.clone();\n    out.push(c);\n  }`);
      i++;
    }
    gen = `return [${parts.join(", ")}];`;
    shr = `let out: (${written})[] = [];\n${shrinks.join("\n")}\n  return out;`;
  } else if (t.kind === "object") {
    let parts: string[] = [];
    let shrinks: string[] = [];
    for (const m of t.members) {
      if (m.kind !== "property" || m.type === undefined || m.optional || typeof m.name !== "string") throw refused("an object type with methods, optional or computed members");
      const [eg, es] = generator(g, m.type!, depth + 1);
      parts.push(`${m.name}: ${eg}(r, size)`);
      shrinks.push(`  for (const x of ${es}(v.${m.name})) {\n    let c = v.clone();\n    c.${m.name} = x.clone();\n    out.push(c);\n  }`);
    }
    gen = `return { ${parts.join(", ")} };`;
    shr = `let out: (${written})[] = [];\n${shrinks.join("\n")}\n  return out;`;
  } else if (t.kind === "literal" || (t.kind === "ref" && t.args.length === 0 && t.name === "null")) {
    gen = `return ${written};`;
    shr = `let out: (${written})[] = [];\n  return out;`;
  } else if (t.kind === "union") {
    let arms: string[] = [];
    let nullable = false;
    for (let i: usize = 0; i < t.types.length; i++) {
      const m: Ref<TypeNode> = t.types[i]!;
      if (m.kind === "ref" && m.name === "null") nullable = true;
      const [eg] = generator(g, m, depth + 1);
      arms.push(i + 1 === t.types.length ? `  return ${eg}(r, size);` : `  if (k === ${i}) return ${eg}(r, size);`);
    }
    gen = `const k = __propPick(r, ${t.types.length});\n${arms.join("\n")}`;
    shr = nullable ? `let out: (${written})[] = [];\n  if (v !== null) out.push(null);\n  return out;` : `let out: (${written})[] = [];\n  return out;`;
  } else if (t.kind === "ref" && t.args.length === 0 && g.aliases.has(t.name)) {
    if (g.seen.has(t.name)) throw refused(`the recursive type '${t.name}'`);
    g.seen.add(t.name);
    const aliased = g.aliases.get(t.name)!;
    const [eg, es] = generator(g, aliased, depth + 1);
    g.seen.delete(t.name);
    gen = `return ${eg}(r, size);`;
    shr = `return ${es}(v);`;
  } else throw refused(`a '${written}'`);
  g.out.push(`function ${name}(r: Mut<PropRandom>, size: i64): ${written} {\n  ${gen}\n}\n`);
  g.out.push(`function ${shrink}(v: ${copied ? written : `Ref<${written}>`}): (${written})[] {\n  ${shr}\n}\n`);
  return [name, shrink];
}

// How many inputs a property is run over before it passes.
const RUNS = 100;
// How many smaller failing inputs a failure is shrunk through, at most.
const SHRINKS = 1000;

// The functions a property's statement becomes: its generators, its body as a task of its own over
// its parameters, a check giving the failure a run ended in, and the test running it over inputs
// growing with each run, then shrinking the first failure and printing it with the seed.
/** @throws {CompileError | Error} */
function liftedProperty(ids: Mut<Ids>, name: string, s: Stmt, g: Generating): Func[] {
  const at: Span = { start: s.start, end: s.end };
  if (s.kind !== "expr" || s.expr.kind !== "call") throw new Error("internal error: a property is no longer a call of 'property'");
  let call = s.expr;
  if (call.args.length === 3) call.args.pop();
  const body = call.args.pop();
  let title = "";
  if (call.args.length > 0) {
    const head: Ref<Expr> = call.args[0]!;
    if (head.kind === "string") title = head.value;
  }
  if (body === undefined || (body.kind !== "arrow" && body.kind !== "function")) throw new Error("internal error: a property has no body");
  const params: Param[] = body.params.clone();
  let names: string[] = [];
  let types: string[] = [];
  let gens: string[] = [];
  let shrinks: string[] = [];
  for (const p of params) {
    names.push(p.pattern.kind === "ident" ? p.pattern.name : "");
    types.push(g.src.slice((p.type!.start - g.base) as i64, (p.type!.end - g.base) as i64));
    const [gen, shrink] = generator(g, p.type!, 0);
    gens.push(gen);
    shrinks.push(shrink);
  }
  const k = g.k;
  const typed = names.map((n, i) => `${n}: ${types[i as usize]!}`).join(", ");
  const argsOf = (prefix: string) => names.map((_n, i) => `${prefix}${i}.clone()`).join(", ");
  let made: string[] = [...g.out];
  made.push(`async function __propTask${k}(): Promise<void> throws Error {}\n`);
  made.push(`async function __propCheck${k}(${typed}): Promise<string | null> {\n  try {\n    await spawn(__propTask${k}(${names.join(", ")})).join();\n    return null;\n  } catch (e) {\n    if (e instanceof TaskPanic) return e.message;\n    return e.message;\n  }\n}\n`);
  let steps: string[] = [];
  for (let i: usize = 0; i < names.length; i++) {
    steps.push(`      if (!shrinking) {\n        const c${i} = ${shrinks[i]!}(b${i});\n        for (const x of c${i}) {\n          const again = await __propCheck${k}(${names.map((_n, j) => (j === (i as i64) ? "x.clone()" : `b${j}.clone()`)).join(", ")});\n          if (again !== null) {\n            b${i} = x.clone();\n            why = again!;\n            shrinks++;\n            shrinking = true;\n            break;\n          }\n        }\n      }`);
  }
  const shown = names.map((n, i) => `    console.error(${JSON.stringify(`  ${n} =`)}, b${i});\n`).join("");
  made.push(`async function __propRun${k}(): Promise<void> throws Error {
  const seed = __propSeed();
  let r = new PropRandom(seed);
  for (let run: i64 = 0; run < ${RUNS}; run++) {
${gens.map((gen, i) => `    const a${i} = ${gen}(r, run);\n`).join("")}    const failed = await __propCheck${k}(${argsOf("a")});
    if (failed === null) continue;
    let why = failed!;
${names.map((_n, i) => `    let b${i} = a${i};\n`).join("")}    let shrinks = 0;
    let shrinking = true;
    while (shrinking && shrinks < ${SHRINKS}) {
      shrinking = false;
${steps.join("\n")}
    }
    console.error("property " + ${JSON.stringify(JSON.stringify(title))} + " failed on run " + String(run + 1) + ", shrunk " + String(shrinks) + " times; 'fishc test --seed " + String(seed) + "' runs it again:");
${shown}    throw new Error(why);
  }
}
`);
  let own = bodyStatements(ids, body);
  let parsed = parse(made.join("\n"), ids);
  let out: Func[] = [];
  while (parsed.length > 0) {
    const f = parsed.shift()!;
    if (f.kind !== "function") throw new Error("internal error: a property's function didn't parse as one");
    let placed = respanFunc(f, at);
    if (placed.name === `__propTask${k}`) {
      // The task is the property's own body over its own parameters, as written.
      placed = { ...placed, params: [...params], body: own.splice(0) };
    }
    if (placed.name === `__propRun${k}`) placed = { ...placed, name };
    out.push(placed);
  }
  return out;
}

// The statements of a test's or a property's body.
function bodyStatements(ids: Mut<Ids>, body: Body): Stmt[] {
  if (body.kind === "function") return body.body;
  if (Array.isArray(body.body)) return body.body;
  const start = body.body.start;
  const end = body.body.end;
  return [{ id: nextId(ids), kind: "expr", expr: body.body, start, end }];
}

// The harness's text before its tests are known: an import of each of the package's files, so
// all of them are loaded, and what its `main` reads the arguments with and exits through. It is
// native Fish whatever the package's edition.
export function harnessImports(dir: string, files: string[]): string {
  return ["// @fish-edition native", ...files.map((f) => `import ${JSON.stringify(`./${relative(dir, f)}`)};`), 'import { argv, exit } from "std:process";', ""].join("\n");
}

// The harness's `main`. Given `--list`, it prints the test names, one per line, in order; given a
// test's index, it runs that test, which passes when the process exits with 0. A test's function
// is reached as `name-fsh<n>`, the name file n declares, which no program can write.
/** @throws {CompileError} */
export function harnessMain(ids: Mut<Ids>, tests: Ref<Test[]>, modules: Ref<Module[]>): Stmt[] {
  const functions = testFunctions(tests, modules);
  const call = (t: Ref<Test>) => `__test${t.index}`;
  const runs = tests.map((t) => `  if (which === "${t.index}") {\n    ${t.async ? "await " : ""}${call(t)}();\n    return;\n  }\n`);
  const text = `async function main(): Promise<void> throws Error {
  const which = argv.length > 2 ? argv[2] : "";
  if (which === "--list") {
${tests.map((t) => `    console.log(${JSON.stringify(t.name)});\n`).join("")}    return;
  }
${runs.join("")}  console.error(\`no test numbered '\${which}'; run one by its index, or list them with --list\`);
  exit(2);
}
`;
  let made = parse(text, ids);
  let named = new Map<string, string>();
  for (const t of tests) named.set(call(t), functions[t.index]!);
  renameIn(ids, made, (name) => named.get(name));
  return made;
}

// The name each of `tests` is linked as, in their order: the name file n declares, as `name-fsh<n>`.
export function testFunctions(tests: Ref<Test[]>, modules: Ref<Module[]>): string[] {
  return tests.map((t) => `${testSymbol(t.name)}-fsh${modules.findIndex((m) => m.path === t.module.path)}`);
}

// Gives the `main` of each file but the first, std's aside, a name no program can write, since
// the harness is the program's `main`; a test or function calling a file's `main` still reaches it.
export function hideMains(compilation: Mut<Compilation>, modules: Mut<Module[]>) {
  compilation.names.madeUp.set("file main", "'main'");
  for (let at: usize = 1; at < modules.length; at++) {
    const m: Mut<Module> = modules[at]!;
    if (m.path.startsWith("std:")) continue;
    renameIn(compilation.ids, m.statements, (name) => (name === "main" ? "file main" : undefined));
  }
}

// How long a test may run when neither it nor the run names a limit, in milliseconds.
export const LIMIT: usize = 10_000;

// How a run goes: the limit for a test that names none, how many tests run at once, and whether
// deterministic simulation mode is enabled with its starting seed and seed count.
// `propSeed`, given with `--seed` and no `--sim`, is the seed every property draws its inputs from.
// `docs` runs the examples in doc comments as tests too. With `interpret`, tests are tried in the
// comptime interpreter before their native build.
export type RunOptions = { timeout: usize; jobs: usize; sim: boolean; seed: u64; seeds: usize; propSeed?: u64; docs: boolean; interpret: boolean };

export type Outcome = { passed: boolean; output: string };

type RunCase = { testAt: usize; seed: u64 | undefined };

// Ends every test running now, along with anything it started: `running` holds the process
// groups of a run's tests while they run.
export function stopTests(running: Mut<Set<i32>>) {
  for (const group of [...running]) ended(running, group);
}

function ended(running: Mut<Set<i32>>, group: i32) {
  running.delete(group);
  try {
    process.kill(-(group as i64), "SIGKILL");
  } catch {
    // The group is already gone.
  }
}

// A test running now: its place in the run, its child and the child's process group, its output
// as it is read, its limit, when it runs past it, and whether it has.
type Running = { at: usize; child: Subprocess; group: i32; output: Promise<[string, string]>; limit: usize; deadline: f64; late: boolean };

// What a round of waiting saw first: the test at `at` exiting, or running past the limit.
type Event = { kind: "exit"; at: usize; code: i64 } | { kind: "timeout"; at: usize };

// Starts `test` in a process group of its own, noted in `running`, its output read as it runs.
/** @throws {IoError} */
function started(running: Mut<Set<i32>>, binary: string, test: Ref<Test>, cwd: string, at: usize, timeout: usize, seed: u64 | undefined, propSeed: u64 | undefined): Running {
  const child = (() => {
    if (seed === undefined && propSeed === undefined) return Bun.spawn([binary, String(test.index)], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true });
    let env: { [name: string]: string } = {};
    for (const [k, v] of Object.entries(process.env)) env[k] = v;
    if (seed !== undefined) env["FISH_SIM_SEED"] = String(seed!);
    if (propSeed !== undefined) env["FISH_PROP_SEED"] = String(propSeed!);
    return Bun.spawn([binary, String(test.index)], { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true });
  })();
  const group = child.pid as i32;
  running.add(group);
  const output: Promise<[string, string]> = outputOf(new Response(child.stdout), new Response(child.stderr));
  const limit = test.timeout ?? timeout;
  return { at, child, group, output, limit, deadline: performance.now() + (limit as f64), late: false };
}

async function outputOf(stdout: Response, stderr: Response): Promise<[string, string]> {
  const [out, err] = await Promise.all([stdout.text(), stderr.text()]);
  return [out, err];
}

// A doc example passes when it printed its expect lines, in order and no others.
function printed(out: string, expect: Ref<string[]>): Outcome {
  const got = out.endsWith("\n") ? out.slice(0, -1) : out;
  const want = expect.join("\n");
  if (got === want) return { passed: true, output: "" };
  return { passed: false, output: `--- expected\n${want}\n--- printed\n${got}\n` };
}

// The first of the running tests to exit, or the one soonest past the limit to get there. Fish
// drops the waits that lose a race, and a child's exit can be waited for again, so each round
// waits afresh.
async function nextEvent(flight: Ref<Running[]>): Promise<Event> {
  let waits: Promise<Event>[] = [];
  let timed = false;
  let soonest: usize = 0;
  let due: f64 = 0;
  for (const r of flight) {
    waits.push(exitOf(r.child.exited, r.at));
    if (!r.late && (!timed || r.deadline < due)) {
      timed = true;
      soonest = r.at;
      due = r.deadline;
    }
  }
  if (timed) waits.push(pastLimit(Math.max(0, Math.ceil(due - performance.now())) as i64, soonest));
  return await Promise.race(waits);
}

async function exitOf(exited: Promise<i64>, at: usize): Promise<Event> {
  const code = await exited;
  return { kind: "exit", at, code };
}

async function pastLimit(ms: i64, at: usize): Promise<Event> {
  await Bun.sleep(ms);
  return { kind: "timeout", at };
}

// A limit as the report shows it: whole seconds as `10s`, anything else in milliseconds.
function shownLimit(ms: usize): string {
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`;
}

// The run's defaults: the standard limit, and a test per core.
export function runDefaults(): RunOptions {
  return { timeout: LIMIT, jobs: availableParallelism() as usize, sim: false, seed: 1 as u64, seeds: 1, docs: true, interpret: false };
}

// A test fails when it exits with anything but 0 or runs past the limit.
function outcome(text: string, code: i64, late: boolean, signal: string | null, limit: usize): Outcome {
  const passed = code === 0 && !late;
  if (late) return { passed, output: `${text}timed out after ${shownLimit(limit)}\n` };
  if (passed || text !== "") return { passed, output: text };
  return { passed, output: signal !== null ? `killed by ${signal}\n` : `exited with ${code}\n` };
}

// Runs each of `tests` in the program `binary`, as many at once as `options.jobs`, and reports them
// in order: `ok` or `FAIL`, the file and the name, a failed test's output, then the counts, noting
// each test's process group in `running` while it runs. A test past its own limit, or the run's, has
// its group killed; once a test exits, the rest of its group is killed, as a child it left behind
// would otherwise hold its output open, and the verdict is the test's own. A test `known` holds by
// its index already ran in the interpreter and isn't started, outside simulation; with
// `options.interpret` each line says which way its test ran. Gives the exit code, 1 when any failed.
export async function runTests(running: Mut<Set<i32>>, binary: string, tests: Ref<Test[]>, cwd: string, options: Ref<RunOptions>, known: Ref<Map<usize, Outcome>>): Promise<i64> {
  let cases: RunCase[] = [];
  if (options.sim) {
    for (let ti: usize = 0; ti < tests.length; ti++) {
      for (let k: usize = 0; k < options.seeds; k++) {
        cases.push({ testAt: ti, seed: options.seed + (k as u64) });
      }
    }
  } else {
    for (let ti: usize = 0; ti < tests.length; ti++) cases.push({ testAt: ti, seed: undefined });
  }
  const width = Math.min(options.jobs as i64, cases.length as i64);
  let flight: Running[] = [];
  let done: (Outcome | undefined)[] = [];
  for (let at: usize = 0; at < cases.length; at++) {
    const o = cases[at]!.seed === undefined ? known.get(tests[cases[at]!.testAt]!.index) : undefined;
    done.push(o === undefined ? undefined : { passed: o.passed, output: o.output });
  }
  let next: usize = 0;
  let shown: usize = 0;
  let failed = 0;
  while (true) {
    while (next < cases.length && (flight.length as i64) < width) {
      const at = next;
      next++;
      const c: Ref<RunCase> = cases[at]!;
      if (done[at] !== undefined) continue;
      try {
        // Started before the push, so `flight` is lent to it only once nothing can throw.
        const r = started(running, binary, tests[c.testAt]!, cwd, at, options.timeout, c.seed, options.propSeed);
        flight.push(r);
      } catch (e) {
        done[at] = { passed: false, output: `the test couldn't be run: ${e instanceof Error ? e.message : (e as IoError).message}\n` };
      }
    }
    while (shown < cases.length) {
      const o: Ref<Outcome | undefined> = done[shown];
      if (o === undefined) break;
      const c: Ref<RunCase> = cases[shown]!;
      const test: Ref<Test> = tests[c.testAt]!;
      if (!o.passed) failed++;
      const seedTag = c.seed !== undefined ? ` (seed ${c.seed!})` : "";
      const way = !options.interpret ? "" : c.seed === undefined && known.has(test.index) ? " (interpreted)" : " (native)";
      process.stdout.write(`${o.passed ? "ok" : "FAIL"} ${test.module.file} > ${test.name}${seedTag}${way}\n${o.passed ? "" : o.output}`);
      shown++;
    }
    if (shown === cases.length) break;
    const event = await nextEvent(flight);
    if (event.kind === "timeout") {
      for (let i: usize = 0; i < flight.length; i++) {
        if (flight[i]!.at !== event.at) continue;
        flight[i]!.late = true;
        ended(running, flight[i]!.group);
      }
      continue;
    }
    let still: Running[] = [];
    let exited: Running | undefined = undefined;
    while (flight.length > 0) {
      const r = flight.shift()!;
      if (r.at === event.at && exited === undefined) exited = r;
      else still.push(r);
    }
    flight = still;
    if (exited === undefined) continue;
    ended(running, exited.group);
    const both = await exited.output;
    const signal = exited.child.signalCode;
    const o = outcome(both[0] + both[1], event.code, exited.late, signal === null ? null : `${signal}`, exited.limit);
    const ran: Ref<Test> = tests[cases[event.at]!.testAt]!;
    done[event.at] = o.passed && ran.expect !== undefined ? printed(both[0], ran.expect!) : o;
  }
  console.log(`${cases.length - failed} passed, ${failed} failed`);
  return failed > 0 ? 1 : 0;
}
