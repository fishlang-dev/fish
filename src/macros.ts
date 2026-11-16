import { bodyOf, type InstanceId } from "./arenas.ts";
import type { Checked } from "./check.ts";
import { AstValues, comptimeBody, comptimeCall, type ComptimeHost, type Value } from "./comptime.ts";
import { macroCompilation, type Compilation, type Tables } from "./compilation.ts";
import { CompileError } from "./diag.ts";
import { flatten, type Loaded, type Module } from "./modules.ts";
import { parse, type ClassMember, type Expr, type Func, type Param, type Pattern, type PropertyName, type Span, type Specifier, type Stmt, type TypeMember, type TypeNode, type TypeParam } from "./parser.ts";
import { built, declaredBy, freshName, quoted, type Categories, type Free, type Hygiene, type Quote } from "./quote.ts";
import { STD_BASE } from "./std.ts";
import type { Type } from "./typing.ts";
import { dup, nextId, nodeIdOf, NodeMap, renumberStmts, respanClassMember, Rewrites, walk, type AnyNode, type Ids } from "./nodes.ts";
import { cloneClassMember, cloneExpr, cloneFunc, cloneStmt, cloneStmts, cloneTypeNode, rebuiltStmts } from "./rebuild.ts";
import { unquoteStmt } from "./unquote.ts";
import { markGenerated } from "./warnings.ts";

// Macros on declarations: `@name` before a top-level declaration runs `macro function name` on
// it while compiling, and what the macro gives replaces it in its file, before the files are
// linked, so what it gives is the file's own and is imported as any declaration is. The macros,
// and the declarations they use, are checked and run on their own first, so a macro can't use
// what an expansion makes.

// How many rounds of expansion a program may take: each applies one decorator per declaration,
// and runs the macros its last round gave.
const ROUNDS = 64;
// The declarations a macro may give: what can stand at the top level.
const TOP_LEVEL = new Set(["function", "class", "typeAlias", "interface", "enum", "let", "comptime", "declare"]);
// A declaration given as exported, by a macro wanting it imported from its file.
const isExport = (d: Ref<Stmt>) => d.kind === "export" && TOP_LEVEL.has(d.body.kind);

// A decorated top-level declaration: its file's place in the program and its own place there.
type Site = { module: usize; index: usize };

// Checks the macro code a round gives it, within a compilation of the round's own.
/** @throws {CompileError} */
export type MacroCheck = (compilation: Compilation, program: Stmt[]) => Checked;

// Expands every file's macros in place. A round links a copy of the files, checks the macros
// with every decorator's arguments, then applies each declaration's decorators in turn: its
// members' and parameters', nearest first, then its own. A decorator a macro gave applies in
// the next round.
/** @throws {CompileError | Error} */
export function expandMacros(compilation: Mut<Compilation>, loaded: Mut<Loaded>, library: boolean, checkMacros: MacroCheck) {
  // The pinned names every round's quotes made, which a later round's macro may give back.
  let pins = new Set<string>();
  for (let round = 0; ; round++) {
    const sites = decorated(loaded);
    if (sites.length === 0) return;
    if (round === ROUNDS) {
      const first: Ref<Site> = sites[0]!;
      const found = placed(declOf(loaded.modules[first.module]!.statements[first.index]!));
      const at: Ref<Expr> = found[0]!.decorator;
      throw new CompileError("E1103", `macros gave declarations using macros ${ROUNDS} rounds deep; does a macro give back what it was applied to, with its decorator?`, at.start, at.end);
    }
    // The program as linked, from copies, for checking and running the macros; an import of what
    // an expansion will make isn't there yet, and nothing the macros use may need one.
    let { loaded: copy, of } = copied(compilation.ids, loaded);
    const program = flatten(compilation, copy, library, true);
    const macros = macroFunctions(program);
    let linkedAt = new Map<usize, usize>();
    for (let i: usize = 0; i < program.length; i++) linkedAt.set(program[i]!.id, i);
    // Every decorator of this round, by where it is written: the one linked, and its arguments,
    // each one a macro takes as a value computed while compiling, as a constant checked with
    // the macros.
    let prepared = new NodeMap<Expr, Prepared>();
    let constants: Stmt[] = [];
    let linked = new Set<usize>();
    for (const site of sites) {
      const written: Ref<Stmt> = loaded.modules[site.module]!.statements[site.index]!;
      const fromCopy = of.get(written.id);
      if (fromCopy === undefined) throw new Error("internal error: a decorated declaration has no linked copy");
      // As linked: linking renames the program's statements, not the copies they were made from.
      const at = linkedAt.get(fromCopy.id);
      const twin: Ref<Stmt> = at !== undefined ? program[at]! : fromCopy;
      let own = placed(declOf(written));
      let twins = placed(declOf(twin));
      while (own.length > 0) {
        const d = own.shift()!;
        const t = twins.shift()!;
        const isBuiltin = builtin(t.decorator, macros);
        let args: Argument[] = [];
        if (!isBuiltin) args = argumentsOf(compilation, t.decorator, macros, d.where, constants);
        prepared.set(d.decorator, { linked: t.decorator, args, builtin: isBuiltin });
      }
      linked.add(declOf(twin).id);
    }
    const spans: Span[] = constants.map((c) => ({ start: c.start, end: c.end }));
    // The same code is checked and read after, as checking puts what it lowers in place.
    const [code, forCheck] = dup(macroProgram(program, macros, linked, constants));
    // Checked here rather than in a helper, as a function value can't be lent to one.
    let checked: MacroHost | undefined = undefined;
    try {
      const made = checkMacros(macroCompilation(compilation), forCheck);
      // The ids and counts the check took stay taken, so what the macros make doesn't reuse them.
      compilation.ids.last = made.tables.ids.last;
      compilation.counts = { enums: made.tables.counts.enums, lifts: made.tables.counts.lifts, destructures: made.tables.counts.destructures, expansions: made.tables.counts.expansions, constants: made.tables.counts.constants };
      checked = new MacroHost(made);
    } catch (e) {
      throw argumentError(e as CompileError, spans);
    }
    if (checked === undefined) throw new Error("internal error: the macro code gave no check");
    let host: MacroHost = checked;
    for (let k = sites.length; k > 0; k--) {
      const site: Ref<Site> = sites[k - 1]!;
      // What the site's macros give stands in its file as each one runs, so a later one sees it.
      let count: usize = 1;
      for (;;) {
        const at = nextPrepared(loaded.modules[site.module]!.statements, site.index, count, prepared);
        if (at < 0) break;
        const s: Ref<Stmt> = loaded.modules[site.module]!.statements[site.index + (at as usize)]!;
        const pending = pendingOf(declOf(s));
        const ready = prepared.get(pending.decorator);
        if (ready === undefined) break;
        let out: Stmt[] = [];
        if (ready.builtin) out = derived(compilation, declOf(s), s.kind === "export", pending);
        else {
          const ran = run(declOf(s), s.kind === "export", pending, ready, macros, host, code, compilation, loaded, pins, library);
          pins = ran.pins;
          out = ran.out;
        }
        const made = out.length;
        const statements: Mut<Stmt[]> = loaded.modules[site.module]!.statements;
        // The expansion takes the decorated statement's place, its statements in order.
        statements.splice((site.index as i64) + at, 1);
        let j: i64 = 0;
        while (out.length > 0) {
          statements.splice((site.index as i64) + at + j, 0, out.shift()!);
          j++;
        }
        count = count + made - 1;
      }
    }
  }
}

// Where in the statements from `from`, `count` of them, the first declaration is that holds a
// decorator of this round, or -1.
function nextPrepared(statements: Ref<Stmt[]>, from: usize, count: usize, prepared: Ref<NodeMap<Expr, Prepared>>): i64 {
  for (let i = from; i < from + count && i < statements.length; i++) {
    for (const p of placed(declOf(statements[i]!))) if (prepared.has(p.decorator)) return (i - from) as i64;
  }
  return -1;
}

// What checking the macros and their arguments threw, a constant's type that doesn't fit said
// as the argument's.
function argumentError(e: CompileError, constants: Ref<Span[]>): CompileError {
  if (e instanceof CompileError && constants.some((c) => e.start >= c.start && e.end <= c.end)) {
    const misfit = /^type '(.*)' is not assignable to return type '(.*)'$/.exec(e.message);
    if (misfit !== null) return new CompileError("E1103", `this argument is a '${misfit[1]!}', but the macro takes a '${misfit[2]!}' here`, e.start, e.end);
  }
  return e;
}

type Prepared = { linked: Expr; args: Argument[]; builtin: boolean };

// The checked macro code, as the host comptime runs the macros in: every function in it is
// checked already.
class MacroHost implements ComptimeHost {
  tables: Tables;
  instances: InstanceId[];

  constructor(checked: Checked) {
    this.tables = checked.tables;
    this.instances = checked.instances;
  }

  ensureChecked(this: Mut<this>, _id: InstanceId): boolean {
    return true;
  }
}

// Whether a decorator is `@derive(...)`, which the compiler gives unless the program has its own.
function builtin(d: Ref<Expr>, macros: Ref<Map<string, Func>>): boolean {
  const callee: Ref<Expr> = d.kind === "call" ? d.callee : d;
  return callee.kind === "ident" && callee.name === "derive" && !macros.has("derive");
}

// `@derive(Eq, Json)`: a mark on the class or enum that `===` and `JSON` read, and on a class
// with Eq, the `equals` comparing every field that `===` calls, unless the class has one.
/** @throws {CompileError | Error} */
function derived(compilation: Mut<Compilation>, d: Ref<Stmt>, exported: boolean, pending: Ref<Pending>): Stmt[] {
  const at: Ref<Expr> = pending.decorator;
  const derivable = d.kind === "class" || d.kind === "enum";
  if (pending.where !== "own" || !derivable) throw new CompileError("E1104", "'derive' applies to a class or an enum", at.start, at.end);
  if (at.kind !== "call" || at.args.length === 0) throw new CompileError("E1104", "'derive' names what to derive, as in '@derive(Eq)'", at.start, at.end);
  let names: string[] = [];
  for (const t of at.args) {
    if (t.kind !== "ident" || (t.name !== "Eq" && t.name !== "Json")) throw new CompileError("E1104", `'derive' knows 'Eq' and 'Json' so far; '${t.kind === "ident" ? t.name : "this"}' isn't one it can derive yet`, t.start, t.end);
    names.push(t.name);
  }
  const eq = names.includes("Eq");
  const id = nextId(compilation.ids);
  let decl: Stmt;
  if (d.kind === "enum") decl = { ...d, id, decorators: withoutLast(d.decorators), derives: derivesWith(d.derives, names) };
  else if (d.kind !== "class") throw new CompileError("E1104", "'derive' applies to a class or an enum", at.start, at.end);
  else {
    const derives = derivesWith(d.derives, names);
    let members: ClassMember[] = [...d.members];
    if (eq && !hasEquals(d.members)) {
      const fields = fieldNames(d.members);
      const base = baseName(d.extends);
      if (base === "Map" || base === "Set") {
        const shown = base === "Map" ? "Map" : "Set";
        throw new CompileError("E1104", `'derive(Eq)' can't compare a class extending '${shown}': a ${shown} isn't compared by value; write the class's 'equals', comparing its entries`, at.start, at.end);
      }
      // A base's fields compare through the base's own `equals`.
      let parts: string[] = d.extends !== undefined ? ["super.equals(other)"] : [];
      for (const f of fields) parts.push(`this.${f} === other.${f}`);
      const test = parts.length === 0 ? "true" : parts.join(" && ");
      let made = parse(`class X { equals(other: Ref<this>): boolean { return ${test}; } }`, compilation.ids);
      let made0 = made.shift();
      if (made0 === undefined || made0.kind !== "class") throw new Error("internal error: the derived 'equals' didn't parse as a class");
      const method = respanClassMember(made0.members.shift()!, { start: at.start, end: at.end });
      markGenerated(compilation.generated, { of: "classMember", node: method });
      compilation.upcasts.add(`${at.start}:${at.end}`);
      members.push(method);
    }
    decl = { ...d, id, decorators: withoutLast(d.decorators), derives, members };
  }
  if (!exported) return [decl];
  const start = decl.start;
  const end = decl.end;
  return [{ id: nextId(compilation.ids), kind: "export", body: decl, start, end }];
}

// What a declaration derives, with `names` after what it derived before.
function derivesWith(before: Ref<string[] | undefined>, names: Ref<string[]>): string[] {
  let all: string[] = before !== undefined ? [...before] : [];
  for (const n of names) all.push(n);
  return all;
}

// A list of decorators without its last one, which is applying now.
function withoutLast(list: Ref<Expr[] | undefined>): Expr[] {
  return list === undefined ? [] : list.slice(0, -1);
}

// Whether a class has its own `equals` method.
function hasEquals(members: Ref<ClassMember[]>): boolean {
  for (const m of members) if (m.kind === "method" && memberName(m) === "equals" && !m.modifiers.includes("static")) return true;
  return false;
}

// The fields a class declares, its parameter properties among them.
function fieldNames(members: Ref<ClassMember[]>): string[] {
  let fields: string[] = [];
  for (const m of members) {
    if (m.kind === "field") {
      const name: Ref<PropertyName> = m.name;
      if (typeof name === "string" && !m.modifiers.includes("static")) fields.push(name);
    }
    if (m.kind === "constructor") {
      for (const p of m.params) {
        const pattern: Ref<Pattern> = p.pattern;
        if (p.modifiers.length > 0 && pattern.kind === "ident") fields.push(pattern.name);
      }
    }
  }
  return fields;
}

// The name a class's `extends` writes, through any type arguments.
function baseName(e: Ref<Expr | undefined>): string | undefined {
  if (e === undefined) return undefined;
  const base: Ref<Expr> = e.kind === "instantiation" ? e.expr : e;
  return base.kind === "ident" ? base.name : undefined;
}

// A member's name, when it has one written as a name.
function memberName(m: Ref<ClassMember>): string {
  if (m.kind !== "field" && m.kind !== "method" && m.kind !== "get" && m.kind !== "set") return "";
  const name: Ref<PropertyName> = m.name;
  return typeof name === "string" ? name : "";
}

// A top-level statement's declaration: an export's body, or the statement itself.
function declOf(s: Ref<Stmt>): Ref<Stmt> {
  return s.kind === "export" ? s.body : s;
}

// A declaration's own decorators, none for a kind that can't have any.
function ownDecorators(d: Ref<Stmt>): Ref<Expr[]> | undefined {
  if (d.kind === "class") return d.decorators;
  if (d.kind === "function") return present(d.decorators);
  if (d.kind === "enum") return present(d.decorators);
  if (d.kind === "typeAlias") return present(d.decorators);
  if (d.kind === "interface") return present(d.decorators);
  return undefined;
}

// An optional list, as a borrow of it when there is one.
function present(list: Ref<Expr[] | undefined>): Ref<Expr[]> | undefined {
  if (list === undefined) return undefined;
  return list;
}

// A class member's parameters, for the kinds that have them.
function memberParams(m: Ref<ClassMember>): Ref<Param[]> | undefined {
  if (m.kind === "method") return m.params;
  if (m.kind === "constructor") return m.params;
  if (m.kind === "get" || m.kind === "set") return m.params;
  if (m.kind === "index") return m.params;
  return undefined;
}

type Where = "own" | "member" | "param";
type Placed = { decorator: Expr; where: Where };

// Each decorator a declaration holds, with where it is written: its own, its members' and their
// parameters', then its parameters'.
function placed(d: Ref<Stmt>): Placed[] {
  let out: Placed[] = [];
  const own = ownDecorators(d);
  if (own !== undefined) for (const x of own) out.push({ decorator: cloneExpr(x), where: "own" });
  if (d.kind === "class") {
    for (const m of d.members) {
      for (const x of m.decorators) out.push({ decorator: cloneExpr(x), where: "member" });
      const params = memberParams(m);
      if (params !== undefined) for (const p of params) for (const x of p.decorators) out.push({ decorator: cloneExpr(x), where: "param" });
    }
  }
  if (d.kind === "function") for (const p of d.params) for (const x of p.decorators) out.push({ decorator: cloneExpr(x), where: "param" });
  return out;
}

// Every file's statements copied, so linking the copy leaves the files as written, and the copy
// of each statement, by the id of the one it copies.
function copied(ids: Mut<Ids>, loaded: Ref<Loaded>): { loaded: Loaded; of: Map<usize, Stmt> } {
  let of = new Map<usize, Stmt>();
  let copies = new Map<usize, Module>();
  for (let k: usize = 0; k < loaded.modules.length; k++) {
    const m: Ref<Module> = loaded.modules[k]!;
    let fresh = renumberStmts(cloneStmts(m.statements), () => nextId(ids));
    let statements: Stmt[] = [];
    while (fresh.length > 0) {
      // The copy stands in both, as one statement.
      const [kept, seen] = dup(fresh.shift()!);
      of.set(m.statements[statements.length]!.id, seen);
      statements.push(kept);
    }
    const owner: Ref<{ name: string; dir: string; lib: string } | undefined> = m.owner;
    const made: Module = { path: m.path, file: m.file, base: m.base, src: m.src, statements, targets: new NodeMap<Stmt, Module>(), globals: new Map<string, Module>(), whole: m.whole, owner: owner === undefined ? undefined : { name: owner.name, dir: owner.dir, lib: owner.lib }, pkg: m.pkg };
    copies.set(k, made);
  }
  for (let k: usize = 0; k < loaded.modules.length; k++) {
    const m: Ref<Module> = loaded.modules[k]!;
    let copy = copies.get(k)!;
    for (let i: usize = 0; i < m.statements.length; i++) {
      const target = m.targets.get(m.statements[i]!);
      if (target === undefined) continue;
      const to = copies.get(moduleIndex(loaded, target));
      if (to === undefined) continue;
      const key = cloneStmt(copy.statements[i]!);
      copy.targets.set(key, to);
    }
    let globals = new Map<string, Module>();
    for (const [name, g] of m.globals) {
      const to = copies.get(moduleIndex(loaded, g));
      if (to !== undefined) globals.set(name, to);
    }
    copy.globals = globals;
    copies.set(k, copy);
  }
  return { loaded: { ...loaded, modules: [...copies.values()] }, of };
}

// A file's place in the program, by its path, which names one file.
function moduleIndex(loaded: Ref<Loaded>, m: Ref<Module>): usize {
  for (let i: usize = 0; i < loaded.modules.length; i++) if (loaded.modules[i]!.path === m.path) return i;
  return loaded.modules.length;
}

// The names a file means by itself: its own declarations and its imports.
function namesIn(module: Ref<Module>): Set<string> {
  let names = new Set<string>();
  for (const s of module.statements) for (const n of namesOf(s)) names.add(n);
  for (const s of module.statements) {
    if (s.kind !== "import") continue;
    const fallback = s.default;
    if (fallback !== undefined) names.add(fallback);
    const namespace = s.namespace;
    if (namespace !== undefined) names.add(namespace);
    const named: Ref<Specifier[] | undefined> = s.named;
    if (named === undefined) continue;
    for (const x of named) {
      const alias = x.alias;
      names.add(alias !== undefined ? alias : x.name);
    }
  }
  return names;
}

// The statements of the macro code a macro reaches, its own first, by their places in it.
function reached(code: Ref<Stmt[]>, macro: string): usize[] {
  let byName = new Map<string, usize>();
  for (let i: usize = 0; i < code.length; i++) for (const n of namesOf(code[i]!)) byName.set(n, i);
  let found = new Set<usize>();
  let order: usize[] = [];
  let stack: usize[] = [];
  const first = byName.get(macro);
  if (first !== undefined) stack.push(first);
  // Each is taken before what it uses, and what it uses in order, as a recursive walk would.
  while (stack.length > 0) {
    const i = stack.pop()!;
    if (found.has(i)) continue;
    found.add(i);
    order.push(i);
    const names = [...freeNames(code[i]!)];
    for (let k = names.length; k > 0; k--) {
      const used = byName.get(names[k - 1]!);
      if (used !== undefined) stack.push(used);
    }
  }
  return order;
}

function decorated(loaded: Ref<Loaded>): Site[] {
  let sites: Site[] = [];
  for (let module: usize = 0; module < loaded.modules.length; module++) {
    const statements: Ref<Stmt[]> = loaded.modules[module]!.statements;
    for (let index: usize = 0; index < statements.length; index++) if (placed(declOf(statements[index]!)).length > 0) sites.push({ module, index });
  }
  return sites;
}

// The decorator that applies next: a member's or a parameter's, nearest first, before the
// declaration's own.
type Pending = { where: Where; index: usize; decorator: Expr };
/** @throws {CompileError | Error} */
function pendingOf(d: Ref<Stmt>): Pending {
  if (d.kind === "class") {
    for (const m of d.members) {
      const params = memberParams(m);
      if (params === undefined) continue;
      for (const p of params) {
        if (p.decorators.length > 0) throw new CompileError("E0801", "decorators on method and constructor parameters aren't supported yet; decorate the method, or a top-level function's parameter", p.decorators[0]!.start, p.decorators[0]!.end);
      }
    }
    for (let index: usize = 0; index < d.members.length; index++) {
      const decorators: Ref<Expr[]> = d.members[index]!.decorators;
      if (decorators.length > 0) return { where: "member", index, decorator: cloneExpr(decorators[decorators.length - 1]!) };
    }
  }
  if (d.kind === "function") {
    for (let index: usize = 0; index < d.params.length; index++) {
      const decorators: Ref<Expr[]> = d.params[index]!.decorators;
      if (decorators.length > 0) return { where: "param", index, decorator: cloneExpr(decorators[decorators.length - 1]!) };
    }
  }
  const own = ownDecorators(d);
  if (own === undefined || own.length === 0) throw new Error("internal error: a declaration with no decorator left to apply");
  return { where: "own", index: 0, decorator: cloneExpr(own[own.length - 1]!) };
}

function macroFunctions(program: Ref<Stmt[]>): Map<string, Func> {
  let found = new Map<string, Func>();
  for (const s of program) {
    const d = declOf(s);
    if (d.kind === "function" && d.macro) found.set(d.name, cloneFunc(d));
  }
  return found;
}

// A name as written, without the suffix the linker gives it.
const written = (name: string) => name.replace(/-fsh\d+$/, "");

// The macro a decorator names, `@name` or `@name(args)`.
/** @throws {CompileError} */
function macroOf(d: Ref<Expr>, macros: Ref<Map<string, Func>>): Func {
  const callee: Ref<Expr> = d.kind === "call" ? d.callee : d;
  if (callee.kind !== "ident") throw new CompileError("E1104", "a decorator names a macro, as in '@name' or '@name(args)'", d.start, d.end);
  const macro = macros.get(callee.name);
  if (macro === undefined) throw new CompileError("E1104", `'${written(callee.name)}' isn't a macro; a decorator applies a 'macro function ${written(callee.name)}(input: Ast): Ast'`, callee.start, callee.end);
  return macro;
}

// A decorator's argument: its syntax, for a parameter typed `Ast` or `AstExpr`, or else the
// name of the constant that computes its value.
type Argument = { expr: Expr | undefined; syntax: boolean; name?: string; none?: true };

// Whether a type annotation is an index's, as an array is indexed, `usize`, or as an integer is
// written, `i64`.
function isIndex(t: Ref<TypeNode | undefined>): boolean {
  return t !== undefined && t.kind === "ref" && (t.name === "i64" || t.name === "usize");
}

// A decorator's arguments, the constant computing each one taken as a value added to `constants`.
/** @throws {CompileError} */
function argumentsOf(compilation: Mut<Compilation>, d: Ref<Expr>, macros: Ref<Map<string, Func>>, where: Where, constants: Mut<Stmt[]>): Argument[] {
  const macro = macroOf(d, macros);
  const before: usize = where === "own" ? 1 : 2;
  const indexed = macro.params.length > 1 && isIndex(macro.params[1]!.type);
  if (before === 2 && !indexed) {
    const what = where === "member" ? "the class and the member's index, as in 'macro function log(input: Ast, member: i64): Ast'" : "the function and the parameter's index, as in 'macro function check(input: Ast, param: i64): Ast'";
    throw new CompileError("E1103", `a macro on a ${where === "member" ? "member" : "parameter"} takes ${what}`, d.start, d.end);
  }
  const given: usize = d.kind === "call" ? d.args.length : 0;
  const params = macro.params.slice(before as i64);
  let needed: usize = 0;
  for (const p of params) if (p.default === undefined && !p.optional) needed++;
  if (given < needed || given > params.length) {
    const count = needed === params.length ? `${needed}` : `${needed} to ${params.length}`;
    const index = where === "own" && indexed && given < needed ? "; a macro taking an index applies to a member or a parameter" : "";
    throw new CompileError("E1103", `the macro '${written(macro.name)}' takes ${count} argument${params.length === 1 ? "" : "s"} after what it is applied to, but this gives ${given}${index}`, d.start, d.end);
  }
  // A parameter left out takes its default, the macro's own code computing its value, or else
  // nothing.
  let out: Argument[] = [];
  for (let i: usize = 0; i < params.length; i++) {
    const param: Ref<Param> = params[i]!;
    const t: Ref<TypeNode | undefined> = param.type;
    const fallback: Ref<Expr | undefined> = param.default;
    let expr: Expr;
    if (d.kind === "call" && i < d.args.length) {
      expr = cloneExpr(d.args[i]!);
      if (t !== undefined && t.kind === "ref" && (t.name === "Ast" || t.name === "AstExpr") && t.args.length === 0) {
        out.push({ expr, syntax: true });
        continue;
      }
    } else if (fallback !== undefined) expr = cloneExpr(fallback);
    else {
      out.push({ expr: cloneExpr(d), syntax: false, none: true });
      continue;
    }
    const name = `__fishArgument${compilation.counts.constants++}`;
    const start = expr.start;
    const end = expr.end;
    constants.push({ id: nextId(compilation.ids), kind: "let", keyword: "const", declarations: [{ id: nextId(compilation.ids), target: { id: nextId(compilation.ids), kind: "ident", name, start, end }, type: t === undefined ? undefined : cloneTypeNode(t), init: expr, start, end }], start, end });
    out.push({ expr: undefined, syntax: false, name });
  }
  return out;
}

// What a top-level statement declares.
function namesOf(s: Ref<Stmt>): string[] {
  const d = declOf(s);
  if (d.kind === "let") {
    let out: string[] = [];
    for (const x of d.declarations) {
      const target: Ref<Pattern> = x.target;
      if (target.kind === "ident") out.push(target.name);
    }
    return out;
  }
  if (d.kind === "class") {
    const name = d.name;
    return name !== undefined ? [name] : [];
  }
  if (d.kind === "function" || d.kind === "typeAlias" || d.kind === "interface" || d.kind === "enum" || d.kind === "namespace" || d.kind === "importEquals" || d.kind === "exportAsNamespace") return [d.name];
  return [];
}

// The first name a top-level statement declares.
function firstName(s: Ref<Stmt>): string | undefined {
  const names = namesOf(s);
  return names.length > 0 ? names[0]! : undefined;
}

// The names a statement uses from outside it, as values or types: those it doesn't bind itself.
function freeNames(s: Ref<Stmt>): Set<string> {
  let used = new Set<string>();
  let bound = new Set<string>();
  const top = declOf(s);
  const topId = top.id;
  walk({ of: "stmt", node: top }, (n) => {
    const inner = nodeIdOf(n) !== (topId as i64);
    noteNames(n, inner, used, bound);
  });
  for (const b of bound) used.delete(b);
  return used;
}

// What one node of a statement uses and binds, for `freeNames`: names it reads, the names of the
// declarations inside it, and the names its declarations, parameters and type parameters bind.
function noteNames(n: AnyNode, inner: boolean, used: Mut<Set<string>>, bound: Mut<Set<string>>) {
  if (n.of === "expr") {
    const e = n.node;
    if (e.kind === "ident") used.add(e.name.split(".")[0]!);
    if (inner && e.kind === "function") {
      const name = e.name;
      if (name !== undefined) bound.add(name);
    }
    if (inner && e.kind === "class") {
      const name = e.name;
      if (name !== undefined) bound.add(name);
    }
    if (e.kind === "function") {
      bindParams(e.params, bound);
      bindTypeParams(e.typeParams, bound);
    }
    if (e.kind === "arrow") {
      bindParams(e.params, bound);
      bindTypeParams(e.typeParams, bound);
    }
    if (e.kind === "class") bindTypeParams(e.typeParams, bound);
  } else if (n.of === "typeNode") {
    const t = n.node;
    if (t.kind === "ref") used.add(t.name.split(".")[0]!);
    if (t.kind === "function") {
      bindParams(t.params, bound);
      bindTypeParams(t.typeParams, bound);
    }
  } else if (n.of === "pattern") {
    const p = n.node;
    if (p.kind === "ident" || p.kind === "variant") used.add(p.name.split(".")[0]!);
  } else if (n.of === "stmt") {
    const d = n.node;
    if (inner && d.kind === "class") {
      const name = d.name;
      if (name !== undefined) bound.add(name);
    }
    if (inner && d.kind === "let") for (const x of d.declarations) bindPattern(x.target, bound);
    if (d.kind === "function") {
      if (inner) bound.add(d.name);
      bindParams(d.params, bound);
      bindTypeParams(d.typeParams, bound);
    }
    if (d.kind === "class") bindTypeParams(d.typeParams, bound);
    if (d.kind === "typeAlias") {
      if (inner) bound.add(d.name);
      bindTypeParams(d.typeParams, bound);
    }
    if (d.kind === "interface") {
      if (inner) bound.add(d.name);
      bindTypeParams(d.typeParams, bound);
    }
    if (d.kind === "enum") {
      if (inner) bound.add(d.name);
      bindTypeParams(d.typeParams, bound);
    }
    if (d.kind === "try") bindPattern(d.param, bound);
  } else if (n.of === "func") {
    const f = n.node;
    if (inner) bound.add(f.name);
    bindParams(f.params, bound);
    bindTypeParams(f.typeParams, bound);
  } else if (n.of === "typeAlias") {
    if (inner) bound.add(n.node.name);
    bindTypeParams(n.node.typeParams, bound);
  } else if (n.of === "interface") {
    if (inner) bound.add(n.node.name);
    bindTypeParams(n.node.typeParams, bound);
  } else if (n.of === "classNode") {
    bindTypeParams(n.node.typeParams, bound);
  } else if (n.of === "classMember") {
    const m = n.node;
    const params = memberParams(m);
    if (params !== undefined) bindParams(params, bound);
    if (m.kind === "method") bindTypeParams(m.typeParams, bound);
  } else if (n.of === "typeMember") {
    const m = n.node;
    const params = typeMemberParams(m);
    if (params !== undefined) bindParams(params, bound);
    if (m.kind === "method") bindTypeParams(m.typeParams, bound);
    if (m.kind === "call" || m.kind === "construct") bindTypeParams(m.typeParams, bound);
  } else if (n.of === "objectProp") {
    const p = n.node;
    if (p.kind === "method") bindParams(p.params, bound);
    if (p.kind === "get" || p.kind === "set") bindParams(p.params, bound);
    if (p.kind === "method") bindTypeParams(p.typeParams, bound);
  }
}

// A type member's parameters, for the kinds that have them.
function typeMemberParams(m: Ref<TypeMember>): Ref<Param[]> | undefined {
  if (m.kind === "method") return m.params;
  if (m.kind === "call" || m.kind === "construct") return m.params;
  if (m.kind === "index") return m.params;
  if (m.kind === "get" || m.kind === "set") return m.params;
  return undefined;
}

function bindParams(params: Ref<Param[]>, bound: Mut<Set<string>>) {
  for (const p of params) bindPattern(p.pattern, bound);
}

function bindTypeParams(params: Ref<TypeParam[]>, bound: Mut<Set<string>>) {
  for (const p of params) bound.add(p.name);
}

// The names a binding pattern binds.
function bindPattern(p: Ref<Pattern | undefined>, bound: Mut<Set<string>>): void {
  if (p === undefined) return;
  if (p.kind === "ident") bound.add(p.name);
  if (p.kind === "default") bindPattern(p.target, bound);
  if (p.kind === "object") {
    for (const x of p.props) bindPattern(x.value, bound);
    bindPattern(p.rest, bound);
  }
  if (p.kind === "array") {
    for (const x of p.elements) bindPattern(x, bound);
    bindPattern(p.rest, bound);
  }
}

// What uses a declaration, for the error when what it uses is an expansion's: a macro, by its
// name, or a decorator's argument.
type By = { macro: string | undefined; start: usize; end: usize };
type Visit = { at: usize; via: string | undefined };

// The std library, the macros, and every declaration they use, found by name, then the
// arguments' constants.
/** @throws {CompileError} */
function macroProgram(program: Stmt[], macros: Ref<Map<string, Func>>, sites: Ref<Set<usize>>, constants: Stmt[]): Stmt[] {
  let byName = new Map<string, usize>();
  for (let i: usize = 0; i < program.length; i++) if (program[i]!.start < STD_BASE) for (const n of namesOf(program[i]!)) byName.set(n, i);
  let kept = new Set<usize>();
  for (const m of macros.values()) {
    const at = byName.get(m.name);
    if (at !== undefined) keep(program, byName, sites, kept, at, { macro: m.name, start: m.start, end: m.end });
  }
  for (const c of constants) {
    for (const name of freeNames(c)) {
      const used = byName.get(name);
      if (used !== undefined) keep(program, byName, sites, kept, used, { macro: undefined, start: c.start, end: c.end });
    }
  }
  let std: Stmt[] = [];
  let own: Stmt[] = [];
  let rest = program;
  rest.reverse();
  let i: usize = 0;
  while (rest.length > 0) {
    const s = rest.pop()!;
    if (s.start >= STD_BASE) std.push(s);
    else if (kept.has(i)) own.push(s);
    i++;
  }
  let out = std;
  while (own.length > 0) out.push(own.shift()!);
  let args = constants;
  while (args.length > 0) out.push(args.shift()!);
  return out;
}

// Keeps the statement at `root` and every one it uses, each before what it uses, refusing one
// that a macro makes or changes. `via` names the declaration a use came through.
/** @throws {CompileError} */
function keep(program: Ref<Stmt[]>, byName: Ref<Map<string, usize>>, sites: Ref<Set<usize>>, kept: Mut<Set<usize>>, root: usize, by: Ref<By>) {
  let stack: Visit[] = [{ at: root, via: undefined }];
  while (stack.length > 0) {
    const top = stack.pop()!;
    const at = top.at;
    const via = top.via;
    if (kept.has(at)) continue;
    const s: Ref<Stmt> = program[at]!;
    if (sites.has(declOf(s).id)) {
      const first = firstName(s);
      const name = written(first !== undefined ? first : "");
      const what = by.macro !== undefined ? `the macro '${written(by.macro)}'` : "this argument";
      throw new CompileError("E1103", `${what} uses '${name}'${via !== undefined ? ` through '${written(via)}'` : ""}, which a macro makes or changes; a macro can't depend on an expansion`, by.start, by.end);
    }
    kept.add(at);
    const self = firstName(s);
    const next = by.macro !== undefined && self === by.macro ? via : self;
    let uses: Visit[] = [];
    for (const name of freeNames(s)) {
      const used = byName.get(name);
      if (used !== undefined && used !== at) uses.push({ at: used, via: next });
    }
    while (uses.length > 0) stack.push(uses.pop()!);
  }
}

// The top-level declarations a program's quotes make.
function quoteDeclarations(tables: Mut<Tables>, s: Ref<Stmt>): string[] {
  let quotes: Expr[] = [];
  walk({ of: "stmt", node: s }, (n) => {
    if (n.of !== "expr") return;
    const e = n.node;
    if (e.kind !== "tagged") return;
    const tag: Ref<Expr> = e.tag;
    if (tag.kind === "ident" && (tag.name === "quote" || tag.name === "quoteType")) quotes.push(cloneExpr(e));
  });
  let found: string[] = [];
  for (const q of quotes) {
    if (q.kind !== "tagged") continue;
    const tag: Ref<Expr> = q.tag;
    const asType = tag.kind === "ident" && tag.name === "quoteType";
    try {
      for (const name of declaredBy(quoted(tables, q, asType))) found.push(name);
    } catch {
      // A quote that doesn't parse is reported when the macro is checked.
    }
  }
  return found;
}

// What running a macro gives: the declarations that replace the one it was applied to, and the
// pinned names, which its hygiene held while it ran.
type Ran = { out: Stmt[]; pins: Set<string> };

// Runs the decorator that applies next to a declaration and gives what replaces it. The macro
// takes the declaration without any decorators; those still to apply go back on what it gives,
// on the declaration of the same name, or the same kind, and on its members and parameters of
// the same name, or at the same place.
/** @throws {CompileError | Error} */
function run(decl: Ref<Stmt>, exported: boolean, pending: Ref<Pending>, ready: Ref<Prepared>, macros: Ref<Map<string, Func>>, host: Mut<MacroHost>, code: Ref<Stmt[]>, compilation: Mut<Compilation>, loaded: Ref<Loaded>, pins: Set<string>, library: boolean): Ran {
  const nearest: Ref<Expr> = ready.linked;
  const macro = macroOf(nearest, macros);
  const before: usize = pending.where === "own" ? 1 : 2;
  const id = macroInstance(host, macro);
  // A parameter of an object or interface type makes a function generic, with no instance until
  // it is called.
  if (id === undefined) throw new CompileError("E1103", "a macro's parameters can't be object types or interfaces yet, which make it generic; use a class", macro.start, macro.end);
  const param: Ref<Param> = macro.params[0]!;
  const returns = host.tables.arenas.instanceOf(id).returns;
  if (typeof returns === "string" || host.tables.typing.kindOf(returns) === "literal") throw new CompileError("E1103", `a macro gives the declarations it makes, as an 'Ast' or an 'Ast[]', not '${host.tables.typing.show(returns)}'`, macro.start, macro.end);
  const input = localType(host, id, param);
  const [bare, strip] = stripped(compilation.ids, decl, pending);
  const value = inputValue(host.tables, bare, input, param);
  const suffix = `@m${compilation.counts.expansions++}`;
  // The declarations this macro's quotes make are known from the start, so a quote naming one
  // made by a quote it builds later means it.
  let declared: string[] = [];
  for (const i of reached(code, macro.name)) for (const n of quoteDeclarations(host.tables, code[i]!)) declared.push(n);
  let members = new Set<string>();
  for (const m of loaded.modules) {
    for (const s of m.statements) {
      const d = declOf(s);
      if (d.kind === "enum") for (const x of d.members) members.add(x.name);
    }
  }
  let files = new Map<usize, Set<string>>();
  for (let i: usize = 0; i < loaded.modules.length; i++) files.set(i, namesIn(loaded.modules[i]!));
  let hygiene: Hygiene = { declared: new Map(), namesIn: files, pins, members, suffix, made: new Set() };
  for (const n of declared) {
    const fresh = freshName(hygiene, n);
    hygiene.declared.set(n, fresh);
  }
  // An argument taken as a value is its constant's; one taken as syntax is the argument as written.
  let types: Type[] = [];
  for (let i: usize = 0; i < ready.args.length; i++) types.push(localType(host, id, macro.params[i + before]!));
  // The arguments are computed in the macro's hygiene, so a quote in an argument or a default
  // means its file's names.
  host.tables.hygienes.push(hygiene);
  let back: Hygiene | undefined = undefined;
  let result: Value = null;
  try {
    let args: Value[] = [value];
    if (before === 2) args.push(BigInt(pending.index));
    for (let i: usize = 0; i < ready.args.length; i++) args.push(argumentValue(host, ready.args[i]!, pending.decorator, i, types[i]!));
    result = comptimeCall(host, id, args, { start: nearest.start, end: nearest.end });
  } finally {
    const h = host.tables.hygienes.pop();
    // An error the expansion throws names them as written too.
    if (h !== undefined) {
      for (const n of h.made) compilation.names.local.add(n);
      back = h;
    }
  }
  if (back === undefined) throw new Error("internal error: a macro's hygiene went missing");
  const restored: Hygiene = back;
  const kept = restored.pins;
  givenChecked(result);
  const items = givenValues(result);
  // A name past the linker's suffix is one only a pin may write, as `ident` can't.
  for (const v of items) {
    const forged = forgedIn(v, kept);
    if (forged !== undefined) throw new CompileError("E1103", `the macro '${written(macro.name)}' gave the name '${forged}', which no program can write; 'ident' makes a name as written in the program`, nearest.start, nearest.end);
  }
  for (const v of items) {
    if (!declares(v)) {
      const kind = givenKind(v);
      throw new CompileError("E1103", `the macro '${written(macro.name)}' gave ${kind !== undefined ? `a '${kind}'` : "nothing"}, but a macro gives declarations that can stand at the top level`, nearest.start, nearest.end);
    }
  }
  let made: Stmt[] = [];
  for (const v of items) {
    const s = unquoteStmt(compilation.ids, v);
    markGenerated(compilation.generated, { of: "stmt", node: s });
    made.push(s);
  }
  // A macro on a member gives the class back, and one on a parameter its function.
  if (pending.where !== "own" && !made.some((d) => declOf(d).kind === decl.kind)) {
    throw new CompileError("E1103", `a macro on a ${pending.where === "member" ? "member gives the class back" : "parameter gives the function back"}, changed as it likes, but '${written(macro.name)}' gave none`, nearest.start, nearest.end);
  }
  let rewrites = new Rewrites();
  restore(strip, decl, pending, made, rewrites);
  rebuiltStmts(made, rewrites);
  const name = firstName(decl);
  let out: Stmt[] = [];
  while (made.length > 0) {
    const d = made.shift()!;
    // On an exported declaration, what the macro gives under names the program can see is
    // exported too; its private declarations aren't. A library's exports are C functions, so
    // there only the declaration's own name stays exported.
    const visible = namesOf(d).every((n) => !compilation.names.local.has(n)) && EXPORTABLE.has(d.kind) && (!library || firstName(d) === name);
    if (exported && !isExport(d) && visible) {
      const start = d.start;
      const end = d.end;
      out.push({ id: nextId(compilation.ids), kind: "export", body: d, start, end });
    } else out.push(d);
  }
  return { out, pins: kept };
}

// The instance the checked macro code compiles a macro to, found by where it is written.
function macroInstance(host: Ref<MacroHost>, macro: Ref<Func>): InstanceId | undefined {
  for (const id of host.instances) {
    const b = bodyOf(host.tables.arenas, host.tables.arenas.instanceOf(id));
    if (b.name === macro.name && b.start === macro.start) return id;
  }
  return undefined;
}

// The type of a parameter of a checked instance.
/** @throws {Error} */
function localType(host: Ref<MacroHost>, id: InstanceId, param: Ref<Param>): Type {
  const local = host.tables.arenas.instanceOf(id).locals.get(param);
  if (local === undefined) throw new Error("internal error: a macro's parameter has no local");
  return host.tables.arenas.localOf(local).type;
}

// The declaration a macro is applied to, as the value its parameter takes.
/** @throws {CompileError} */
function inputValue(tables: Mut<Tables>, bare: Stmt, input: Type, param: Ref<Param>): Value {
  const types: Categories = { AstExpr: input, AstStmt: input, AstType: input };
  let quote: Quote = { tree: { of: "stmt", node: bare }, category: "AstStmt", holes: [], asExpressions: new Set(), names: new Set() };
  let values = new AstValues([], [], [], [], { start: 0, end: 0 });
  let scope = new Map<string, string>();
  let free: Free = new Map();
  try {
    return built<Value, AstValues>(tables, quote, types, undefined, values, scope, free);
  } catch (e) {
    if (e instanceof CompileError && e.code !== "E1103") throw e;
    throw new CompileError("E1103", "a macro's parameter takes the declaration it is applied to, so its type is 'Ast' or 'AstStmt'", param.start, param.end);
  }
}

// The value a macro takes for one of a decorator's arguments: nothing, its constant's value, or
// the argument as written, whose syntax is `t`.
/** @throws {CompileError | Error} */
function argumentValue(host: Mut<MacroHost>, a: Ref<Argument>, decorator: Ref<Expr>, i: usize, t: Type): Value {
  if (a.none === true) return null;
  if (!a.syntax) {
    const name = a.name;
    const constant = constantInstance(host, `const ${name !== undefined ? name : ""}`);
    return comptimeBody(host, constant);
  }
  const fallback: Ref<Expr | undefined> = a.expr;
  let node: Expr;
  if (decorator.kind === "call" && i < decorator.args.length) node = cloneExpr(decorator.args[i]!);
  else if (fallback !== undefined) node = cloneExpr(fallback);
  else throw new Error("internal error: an argument taken as syntax has none");
  const types: Categories = { AstExpr: t, AstStmt: t, AstType: t };
  let quote: Quote = { tree: { of: "expr", node }, category: "AstExpr", holes: [], asExpressions: new Set(), names: new Set() };
  let values = new AstValues([], [], [], [], { start: 0, end: 0 });
  let scope = new Map<string, string>();
  let free: Free = new Map();
  return built<Value, AstValues>(host.tables, quote, types, undefined, values, scope, free);
}

// The instance of a constant the macro code checked, by its body's name.
/** @throws {Error} */
function constantInstance(host: Ref<MacroHost>, name: string): InstanceId {
  for (const id of host.instances) if (bodyOf(host.tables.arenas, host.tables.arenas.instanceOf(id)).name === name) return id;
  throw new Error(`internal error: no instance computes '${name}'`);
}

// A declaration without its decorators, and the decorators still to apply, to go back on what a
// macro gives in its place: its own, and each member's or parameter's.
type Strip = { own: Expr[]; members: Expr[][]; params: Expr[][] };

function stripped(ids: Mut<Ids>, decl: Ref<Stmt>, pending: Ref<Pending>): [Stmt, Strip] {
  const all = ownDecorators(decl);
  const own: Expr[] = all === undefined ? [] : pending.where === "own" ? all.slice(0, -1) : [...all];
  let members: Expr[][] = [];
  let params: Expr[][] = [];
  if (decl.kind === "class") for (let i: usize = 0; i < decl.members.length; i++) members.push(later(decl.members[i]!.decorators, i, "member", pending));
  if (decl.kind === "function") for (let i: usize = 0; i < decl.params.length; i++) params.push(later(decl.params[i]!.decorators, i, "param", pending));
  let bare: Stmt;
  const none: Expr[] = [];
  if (decl.kind === "class") bare = { ...decl, id: nextId(ids), decorators: none, members: decl.members.map((m) => withDecorators(m, [])) };
  else if (decl.kind === "function") bare = { ...decl, id: nextId(ids), decorators: undefined, params: decl.params.map((p) => bareParam(p)) };
  else if (decl.kind === "enum") bare = { ...decl, id: nextId(ids), decorators: undefined };
  else if (decl.kind === "typeAlias") bare = { ...decl, id: nextId(ids), decorators: undefined };
  else if (decl.kind === "interface") bare = { ...decl, id: nextId(ids), decorators: undefined };
  else bare = cloneStmt(decl);
  return [bare, { own, members, params }];
}

// A parameter without its decorators.
function bareParam(p: Ref<Param>): Param {
  const none: Expr[] = [];
  return { ...p, decorators: none };
}

// A class member holding `decorators` in place of its own.
function withDecorators(m: Ref<ClassMember>, decorators: Expr[]): ClassMember {
  if (m.kind === "field") return { ...m, decorators };
  if (m.kind === "method") return { ...m, decorators };
  if (m.kind === "constructor") return { ...m, decorators };
  if (m.kind === "get" || m.kind === "set") return { ...m, decorators };
  if (m.kind === "index") return { ...m, decorators };
  if (m.kind === "staticBlock") return { ...m, decorators };
  return cloneClassMember(m);
}

// A member's or parameter's decorators still to apply after this one.
function later(decorators: Ref<Expr[]>, i: usize, where: Where, pending: Ref<Pending>): Expr[] {
  return pending.where === where && pending.index === i ? decorators.slice(0, -1) : [...decorators];
}

// Puts the decorators still to apply back on what a macro gave, each declaration given them
// replaced through `rewrites` by one holding them.
/** @throws {CompileError} */
function restore(strip: Ref<Strip>, decl: Ref<Stmt>, pending: Ref<Pending>, given: Ref<Stmt[]>, rewrites: Mut<Rewrites>) {
  const name = firstName(decl);
  let named = -1;
  let kind = -1;
  for (let i: usize = 0; i < given.length; i++) {
    const d = declOf(given[i]!);
    if (d.kind !== decl.kind) continue;
    if (named < 0 && firstName(d) === name) named = i as i64;
    if (kind < 0) kind = i as i64;
  }
  const at = named >= 0 ? named : kind >= 0 ? kind : pending.where === "own" && given.length > 0 ? 0 : -1;
  // Decorators of members or parameters need their container back to go on.
  if (named < 0) {
    for (const list of [...strip.members, ...strip.params]) {
      if (list.length > 0) throw new CompileError("E1104", `a macro gave no '${name !== undefined ? name : "undefined"}' back, so the decorators still to apply to its ${decl.kind === "class" ? "members" : "parameters"} have nowhere to go`, list[0]!.start, list[0]!.end);
    }
  }
  if (at < 0) return;
  const same = declOf(given[at as usize]!);
  if (strip.own.length > 0) {
    const decorators = [...strip.own, ...allOf(ownDecorators(same))];
    if (same.kind === "class") rewrites.replaceStmt(same, { ...same, decorators });
    else if (same.kind === "function") rewrites.replaceStmt(same, { ...same, decorators });
    else if (same.kind === "enum") rewrites.replaceStmt(same, { ...same, decorators });
    else if (same.kind === "typeAlias") rewrites.replaceStmt(same, { ...same, decorators });
    else if (same.kind === "interface") rewrites.replaceStmt(same, { ...same, decorators });
  }
  // Each goes back to the member of the same kind and name, or the same kind when it has none,
  // or else the same place, a member taking one member's decorators.
  if (same.kind === "class" && decl.kind === "class") restoreMembers(same.members, decl.members, strip.members, rewrites);
  if (same.kind === "function" && decl.kind === "function") restoreParams(same.params, decl.params, strip.params, rewrites);
}

// All of a list of decorators, none when there is no list.
function allOf(list: Ref<Expr[]> | undefined): Expr[] {
  return list === undefined ? [] : [...list];
}

// The key a member's decorators go back by: its kind, whether it is static, and its name.
function memberKey(m: Ref<ClassMember>): string {
  return `${m.kind} ${m.modifiers.includes("static") ? "static " : ""}${memberName(m)}`;
}

/** @throws {CompileError} */
function restoreMembers(list: Ref<ClassMember[]>, before: Ref<ClassMember[]>, saved: Ref<Expr[][]>, rewrites: Mut<Rewrites>) {
  let taken = new Set<usize>();
  for (let i: usize = 0; i < saved.length; i++) {
    const decorators: Ref<Expr[]> = saved[i]!;
    if (decorators.length === 0) continue;
    const want = memberKey(before[i]!);
    let at = -1;
    for (let k: usize = 0; k < list.length && at < 0; k++) if (!taken.has(k) && memberKey(list[k]!) === want) at = k as i64;
    if (at < 0 && i < list.length && !taken.has(i) && list[i]!.kind === before[i]!.kind) at = i as i64;
    if (at < 0) throw new CompileError("E1104", "a macro took away what these decorators were waiting to apply to", decorators[0]!.start, decorators[0]!.end);
    taken.add(at as usize);
    const target: Ref<ClassMember> = list[at as usize]!;
    rewrites.replaceClassMember({ id: target.id }, withDecorators(target, [...decorators, ...target.decorators]));
  }
}

// A parameter's decorators go back to the parameter of the same name, or else the same place.
// One that isn't a name is keyed by its place in the declaration as written, which no parameter
// a macro made is in.
/** @throws {CompileError} */
function restoreParams(list: Ref<Param[]>, before: Ref<Param[]>, saved: Ref<Expr[][]>, rewrites: Mut<Rewrites>) {
  let taken = new Set<usize>();
  for (let i: usize = 0; i < saved.length; i++) {
    const decorators: Ref<Expr[]> = saved[i]!;
    if (decorators.length === 0) continue;
    const pattern: Ref<Pattern> = before[i]!.pattern;
    const want = pattern.kind === "ident" ? pattern.name : `#${i}`;
    let at = -1;
    for (let k: usize = 0; k < list.length && at < 0; k++) {
      const p: Ref<Pattern> = list[k]!.pattern;
      if (!taken.has(k) && (p.kind === "ident" ? p.name : "#-1") === want) at = k as i64;
    }
    if (at < 0 && i < list.length && !taken.has(i)) at = i as i64;
    if (at < 0) throw new CompileError("E1104", "a macro took away what these decorators were waiting to apply to", decorators[0]!.start, decorators[0]!.end);
    taken.add(at as usize);
    const target: Ref<Param> = list[at as usize]!;
    rewrites.replaceParam(target, { ...target, decorators: [...decorators, ...target.decorators] });
  }
}

const EXPORTABLE = new Set(["function", "class", "typeAlias", "interface", "enum"]);

// Refuses a value no `Ast` holds, which the checker's types keep a macro from giving.
/** @throws {Error} */
function givenChecked(v: Ref<Value>): void {
  if (v === null || typeof v !== "object") return;
  if (v.kind === "member") {
    givenChecked(v.value);
    return;
  }
  if (v.kind === "array") {
    for (const x of v.items) givenChecked(x);
    return;
  }
  if (v.kind !== "record") throw new Error(`internal error: an Ast value holding a '${v.kind}'`);
  for (const [_name, x] of v.fields) givenChecked(x);
}

// What a macro gave, one value each: an array's elements, or the one value.
function givenValues(v: Value): Value[] {
  if (v !== null && typeof v === "object" && v.kind === "member") return givenValues(v.value);
  if (v !== null && typeof v === "object" && v.kind === "array") return v.items;
  return [v];
}

// Text a value holds, through an enum member.
function textIn(v: Ref<Value | undefined>): string | undefined {
  if (v !== null && typeof v === "object" && v.kind === "member") return textIn(v.value);
  return typeof v === "string" ? v : undefined;
}

// The kind of a node a macro gave, `undefined` for one that is no node, or nothing when it gave
// none.
function givenKind(v: Ref<Value | undefined>): string | undefined {
  if (v !== null && typeof v === "object" && v.kind === "member") return givenKind(v.value);
  if (v === null || v === undefined || typeof v !== "object") return undefined;
  if (v.kind !== "record") return "undefined";
  const kind = textIn(v.fields.get("kind"));
  return kind !== undefined ? kind : "undefined";
}

// Whether a value a macro gave is a declaration that can stand at the top level, or one exported.
function declares(v: Ref<Value>): boolean {
  if (v !== null && typeof v === "object" && v.kind === "member") return declares(v.value);
  const kind = givenKind(v);
  if (kind !== undefined && TOP_LEVEL.has(kind)) return true;
  if (kind !== "export" || v === null || typeof v !== "object" || v.kind !== "record") return false;
  const body = givenKind(v.fields.get("body"));
  return body !== undefined && TOP_LEVEL.has(body);
}

// The first name in what a macro gave that only the linker writes, unless a pin gave it.
function forgedIn(v: Ref<Value>, pins: Ref<Set<string>>): string | undefined {
  if (v === null || typeof v !== "object") return undefined;
  if (v.kind === "member") return forgedIn(v.value, pins);
  if (v.kind === "array") {
    for (const x of v.items) {
      const found = forgedIn(x, pins);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (v.kind !== "record") return undefined;
  const name = textIn(v.fields.get("name"));
  if (name !== undefined && /-fsh\d+$/.test(name) && !pins.has(name)) return name;
  for (const [_name, x] of v.fields) {
    const found = forgedIn(x, pins);
    if (found !== undefined) return found;
  }
  return undefined;
}
