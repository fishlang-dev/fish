import type { Checked } from "./check.ts";
import { astValues, comptimeBody, comptimeCall, type Value } from "./comptime.ts";
import type { Compilation, Tables } from "./compilation.ts";
import { CompileError } from "./diag.ts";
import { flatten, type Loaded, type Module } from "./modules.ts";
import { parse, type ClassMember, type Expr, type Func, type Stmt } from "./parser.ts";
import { built, declaredBy, quoted, withHygiene, type Category, type Hygiene } from "./quote.ts";
import { STD_BASE } from "./std.ts";
import type { Type } from "./typing.ts";
import { nextId, NodeMap, NodeSet, renumber, type Ids } from "./nodes.ts";
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
const isExport = (d: Decl) => d.kind === "export" && !!d.body && TOP_LEVEL.has(d.body.kind);

type Decl = Stmt & { decorators?: Expr[] };
// A decorated top-level declaration of a file, and whether it is exported.
type Site = { module: Module; index: number; decl: Decl; exported: boolean };

// Expands every file's macros in place. A round links a copy of the files, checks the macros
// with every decorator's arguments, then applies each declaration's decorators in turn: its
// members' and parameters', nearest first, then its own. A decorator a macro gave applies in
// the next round.
export function expandMacros(compilation: Compilation, loaded: Loaded, library: boolean, checkMacros: (program: Stmt[]) => Checked) {
  // The pinned names every round's quotes made, which a later round's macro may give back.
  const pins = new Set<string>();
  for (let round = 0; ; round++) {
    const sites = loaded.modules.flatMap(decorated);
    if (sites.length === 0) return;
    if (round === ROUNDS) {
      const at = allDecorators(sites[0]!.decl)[0]!;
      throw new CompileError(`macros gave declarations using macros ${ROUNDS} rounds deep; does a macro give back what it was applied to, with its decorator?`, at.start, at.end);
    }
    // The program as linked, from copies, for checking and running the macros; an import of what
    // an expansion will make isn't there yet, and nothing the macros use may need one.
    const { loaded: copy, of } = copied(compilation.ids, loaded);
    const program = flatten(compilation, copy, library, true);
    const macros = macroFunctions(program);
    const linked = (site: Site) => {
      const s = of.get(site.module.statements[site.index]!)!;
      return (s.kind === "export" ? s.body : s) as Decl;
    };
    // Every decorator of this round, by where it is written: the one linked, and its arguments,
    // each one a macro takes as a value computed while compiling, as a constant checked with
    // the macros.
    const prepared = new NodeMap<Expr, Prepared>();
    for (const site of sites) {
      const own = placed(site.decl);
      const twins = placed(linked(site));
      own.forEach((d, i) => {
        const twin = twins[i]!.decorator;
        prepared.set(d.decorator, builtin(twin, macros) ? { linked: twin, args: [], builtin: true } : { linked: twin, args: argumentsOf(compilation, twin, macros, d.where) });
      });
    }
    const constants = [...prepared.values()].flatMap((p) => p.args.flatMap((a) => (a.constant ? [a.constant] : [])));
    const macroCode = macroProgram(program, macros, new NodeSet(sites.map(linked)), constants);
    const checked = checkArguments(() => checkMacros(macroCode), constants);
    const context = { compilation, macros, checked, code: macroCode, loaded, pins, library };
    for (const site of [...sites].reverse()) {
      // What the site's macros give stands in its file as each one runs, so a later one sees it.
      const statements = site.module.statements;
      let count = 1;
      for (;;) {
        const range = statements.slice(site.index, site.index + count);
        const at = range.findIndex((s) => {
          const d = (s.kind === "export" ? s.body : s) as Decl;
          return d && allDecorators(d).some((x) => prepared.has(x));
        });
        if (at < 0) break;
        const s = range[at]!;
        const d = (s.kind === "export" ? s.body : s) as Decl;
        const pending = pendingOf(d);
        const ready = prepared.get(pending.decorator);
        if (!ready) break;
        const out = ready.builtin ? derived(compilation, d, s.kind === "export", pending) : run(d, s.kind === "export", site.module, pending, ready, context);
        statements.splice(site.index + at, 1, ...out);
        count += out.length - 1;
      }
    }
  }
}

// Checks the macros and their arguments, a constant's type that doesn't fit said as the
// argument's.
function checkArguments(check: () => Checked, constants: Stmt[]): Checked {
  try {
    return check();
  } catch (e) {
    const argument = e instanceof CompileError && constants.find((c) => e.start >= c.start && e.end <= c.end);
    const misfit = argument && /^type '(.*)' is not assignable to return type '(.*)'$/.exec(e.message);
    if (misfit) throw new CompileError(`this argument is a '${misfit[1]}', but the macro takes a '${misfit[2]}' here`, e.start, e.end);
    throw e;
  }
}

type Prepared = { linked: Expr; args: Argument[]; builtin?: true };
type Context = { compilation: Compilation; macros: Map<string, Func>; checked: Checked; code: Stmt[]; loaded: Loaded; pins: Set<string>; library: boolean };

// Whether a decorator is `@derive(...)`, which the compiler gives unless the program has its own.
function builtin(d: Expr, macros: Map<string, Func>): boolean {
  const callee = d.kind === "call" ? d.callee : d;
  return callee.kind === "ident" && callee.name === "derive" && !macros.has("derive");
}

// `@derive(Eq, Json)`: a mark on the class or enum that `===` and `JSON` read, and on a class
// with Eq, the `equals` comparing every field that `===` calls, unless the class has one.
function derived({ upcasts, ids, generated }: Compilation, d: Decl, exported: boolean, pending: Pending): Stmt[] {
  const at = pending.decorator;
  if (pending.where !== "own" || (d.kind !== "class" && d.kind !== "enum")) throw new CompileError("'derive' applies to a class or an enum", at.start, at.end);
  const traits = at.kind === "call" ? at.args : [];
  if (traits.length === 0) throw new CompileError("'derive' names what to derive, as in '@derive(Eq)'", at.start, at.end);
  const names = traits.map((t) => {
    if (t.kind !== "ident" || (t.name !== "Eq" && t.name !== "Json")) throw new CompileError(`'derive' knows 'Eq' and 'Json' so far; '${t.kind === "ident" ? t.name : "this"}' isn't one it can derive yet`, t.start, t.end);
    return t.name;
  });
  const decl = { ...d, id: nextId(ids), decorators: (d.decorators ?? []).slice(0, -1) } as Decl;
  if (decl.kind === "class" || decl.kind === "enum") decl.derives = [...(decl.derives ?? []), ...names];
  if (decl.kind === "class" && names.includes("Eq") && !decl.members.some((m) => m.kind === "method" && m.name === "equals" && !m.modifiers.includes("static"))) {
    const fields = decl.members.flatMap((m) => {
      if (m.kind === "field" && typeof m.name === "string" && !m.modifiers.includes("static")) return [m.name];
      if (m.kind === "constructor") return m.params.flatMap((p) => (p.modifiers.length > 0 && p.pattern.kind === "ident" ? [p.pattern.name] : []));
      return [];
    });
    // A base's fields compare through the base's own `equals`.
    const parts = [...(decl.extends ? ["super.equals(other)"] : []), ...fields.map((f) => `this.${f} === other.${f}`)];
    const test = parts.length === 0 ? "true" : parts.join(" && ");
    const made = parse(`class X { equals(other: Ref<this>): boolean { return ${test}; } }`, ids)[0] as Extract<Stmt, { kind: "class" }>;
    const method = made.members[0]!;
    respan(method, at);
    markGenerated(generated, method);
    upcasts.add(`${at.start}:${at.end}`);
    decl.members = [...decl.members, method];
  }
  return [exported ? ({ id: nextId(ids), kind: "export", body: decl, start: decl.start, end: decl.end } as Stmt) : decl];
}

// Gives every node of a tree one span, as code a decorator made.
function respan(node: unknown, at: { start: number; end: number }) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((x) => respan(x, at));
  const n = node as Record<string, unknown>;
  if (typeof n.start === "number") n.start = at.start;
  if (typeof n.end === "number") n.end = at.end;
  Object.values(n).forEach((x) => respan(x, at));
}

// Each decorator a declaration holds, with where it is written, in the order `allDecorators`
// gives them.
function placed(d: Decl): { decorator: Expr; where: Pending["where"] }[] {
  const own = (d.decorators ?? []).map((decorator) => ({ decorator, where: "own" as const }));
  const members = d.kind === "class" ? d.members.flatMap((m) => [...m.decorators.map((decorator) => ({ decorator, where: "member" as const })), ...("params" in m ? m.params.flatMap((p) => p.decorators.map((decorator) => ({ decorator, where: "param" as const }))) : [])]) : [];
  const params = d.kind === "function" ? d.params.flatMap((p) => p.decorators.map((decorator) => ({ decorator, where: "param" as const }))) : [];
  return [...own, ...members, ...params];
}

// Every file's statements copied, so linking the copy leaves the files as written, and the copy
// of each statement.
function copied(ids: Ids, loaded: Loaded): { loaded: Loaded; of: NodeMap<Stmt, Stmt> } {
  const copies = new Map<Module, Module>();
  const of = new NodeMap<Stmt, Stmt>();
  for (const m of loaded.modules) {
    const statements = renumber(structuredClone(m.statements), () => nextId(ids));
    m.statements.forEach((s, i) => of.set(s, statements[i]!));
    copies.set(m, { ...m, statements, targets: new NodeMap() });
  }
  for (const m of loaded.modules) {
    const copy = copies.get(m)!;
    m.statements.forEach((s, i) => {
      const target = m.targets.get(s);
      if (target) copy.targets.set(copy.statements[i]!, copies.get(target)!);
    });
    copy.globals = new Map([...m.globals].map(([name, g]) => [name, copies.get(g)!]));
  }
  return { loaded: { ...loaded, modules: loaded.modules.map((m) => copies.get(m)!) }, of };
}

// The names a file means by itself: its own declarations and its imports.
function namesIn(module: Module): Set<string> {
  const names = new Set(module.statements.flatMap(namesOf));
  for (const s of module.statements) {
    if (s.kind !== "import") continue;
    const i = s as { default?: string; namespace?: string; named?: { name: string; alias?: string }[] };
    if (i.default) names.add(i.default);
    if (i.namespace) names.add(i.namespace);
    for (const x of i.named ?? []) names.add(x.alias ?? x.name);
  }
  return names;
}

// The statements of the macro code a macro reaches, its own first.
function reached(code: Stmt[], macro: Func): Stmt[] {
  const byName = new Map(code.flatMap((s) => namesOf(s).map((n) => [n, s] as const)));
  const found = new NodeSet<Stmt>();
  const visit = (s: Stmt | undefined) => {
    if (!s || found.has(s)) return;
    found.add(s);
    for (const name of freeNames(s)) visit(byName.get(name));
  };
  visit(byName.get(macro.name));
  return [...found];
}

function decorated(module: Module): Site[] {
  return module.statements.flatMap((s, index) => {
    const exported = s.kind === "export";
    const decl = (s.kind === "export" ? s.body : s) as Decl;
    return decl && allDecorators(decl).length > 0 ? [{ module, index, decl, exported }] : [];
  });
}

// Every decorator a declaration holds: its own, its members' and its parameters'.
function allDecorators(d: Decl): Expr[] {
  const members = d.kind === "class" ? d.members.flatMap((m) => [...m.decorators, ...("params" in m ? m.params.flatMap((p) => p.decorators) : [])]) : [];
  const params = d.kind === "function" ? d.params.flatMap((p) => p.decorators) : [];
  return [...(d.decorators ?? []), ...members, ...params];
}

// The decorator that applies next: a member's or a parameter's, nearest first, before the
// declaration's own.
type Pending = { where: "own" | "member" | "param"; index: number; decorator: Expr };
function pendingOf(d: Decl): Pending {
  if (d.kind === "class") {
    for (const m of d.members) {
      const p = "params" in m ? m.params.find((x) => x.decorators.length > 0) : undefined;
      if (p) throw new CompileError("decorators on method and constructor parameters aren't supported yet; decorate the method, or a top-level function's parameter", p.decorators[0]!.start, p.decorators[0]!.end);
    }
    const index = d.members.findIndex((m) => m.decorators.length > 0);
    if (index >= 0) return { where: "member", index, decorator: d.members[index]!.decorators.at(-1)! };
  }
  if (d.kind === "function") {
    const index = d.params.findIndex((p) => p.decorators.length > 0);
    if (index >= 0) return { where: "param", index, decorator: d.params[index]!.decorators.at(-1)! };
  }
  return { where: "own", index: 0, decorator: d.decorators!.at(-1)! };
}


function macroFunctions(program: Stmt[]): Map<string, Func> {
  const found = new Map<string, Func>();
  for (const s of program) {
    const d = s.kind === "export" ? s.body : s;
    if (d?.kind === "function" && d.macro) found.set(d.name, d);
  }
  return found;
}

// A name as written, without the suffix the linker gives it.
const written = (name: string) => name.replace(/-fsh\d+$/, "");

// The macro a decorator names, `@name` or `@name(args)`.
function macroOf(d: Expr, macros: Map<string, Func>): Func {
  const callee = d.kind === "call" ? d.callee : d;
  if (callee.kind !== "ident") throw new CompileError("a decorator names a macro, as in '@name' or '@name(args)'", d.start, d.end);
  const macro = macros.get(callee.name);
  if (!macro) throw new CompileError(`'${written(callee.name)}' isn't a macro; a decorator applies a 'macro function ${written(callee.name)}(input: Ast): Ast'`, callee.start, callee.end);
  return macro;
}

// A decorator's argument: its syntax, for a parameter typed `Ast` or `AstExpr`, or else the
// constant that computes its value.
type Argument = { expr: Expr; syntax: boolean; constant?: Stmt; name?: string; none?: true };

function argumentsOf({ counts, ids }: Compilation, d: Expr, macros: Map<string, Func>, where: Pending["where"]): Argument[] {
  const macro = macroOf(d, macros);
  const before = where === "own" ? 1 : 2;
  if (before === 2) {
    const t = macro.params[1]?.type;
    // An index as an array is indexed, `usize`, or as an integer is written, `i64`.
    if (t?.kind !== "ref" || (t.name !== "i64" && t.name !== "usize")) {
      const what = where === "member" ? "the class and the member's index, as in 'macro function log(input: Ast, member: i64): Ast'" : "the function and the parameter's index, as in 'macro function check(input: Ast, param: i64): Ast'";
      throw new CompileError(`a macro on a ${where === "member" ? "member" : "parameter"} takes ${what}`, d.start, d.end);
    }
  }
  const given = d.kind === "call" ? d.args : [];
  const params = macro.params.slice(before);
  const needed = params.filter((p) => !p.default && !p.optional).length;
  if (given.length < needed || given.length > params.length) {
    const count = needed === params.length ? `${needed}` : `${needed} to ${params.length}`;
    const index = where === "own" && macro.params[1]?.type?.kind === "ref" && (macro.params[1].type.name === "i64" || macro.params[1].type.name === "usize") && given.length < needed ? "; a macro taking an index applies to a member or a parameter" : "";
    throw new CompileError(`the macro '${written(macro.name)}' takes ${count} argument${params.length === 1 ? "" : "s"} after what it is applied to, but this gives ${given.length}${index}`, d.start, d.end);
  }
  // A parameter left out takes its default, the macro's own code computing its value, or else
  // nothing.
  return params.map((param, i) => {
    const t = param.type;
    const arg = given[i];
    if (!arg && !param.default) return { expr: d, syntax: false, none: true };
    const expr = arg ?? param.default!;
    if (arg && t?.kind === "ref" && (t.name === "Ast" || t.name === "AstExpr") && t.args.length === 0) return { expr, syntax: true };
    const name = `__fishArgument${counts.constants++}`;
    const at = { start: expr.start, end: expr.end };
    const constant: Stmt = { id: nextId(ids), kind: "let", keyword: "const", declarations: [{ id: nextId(ids), target: { id: nextId(ids), kind: "ident", name, ...at }, type: t, init: expr, ...at }], ...at };
    return { expr, syntax: false, constant, name };
  });
}

// What a top-level statement declares.
function namesOf(s: Stmt): string[] {
  const d = s.kind === "export" ? s.body : s;
  if (!d) return [];
  if (d.kind === "let") return d.declarations.flatMap((x) => (x.target.kind === "ident" ? [x.target.name] : []));
  return "name" in d && typeof d.name === "string" ? [d.name] : [];
}

// The names a statement uses from outside it, as values or types: those it doesn't bind itself.
function freeNames(s: Stmt): Set<string> {
  const used = new Set<string>();
  const bound = new Set<string>();
  const binding = (p: unknown) => {
    if (!p || typeof p !== "object") return;
    const n = p as { kind?: string; name?: unknown; target?: unknown; props?: { value: unknown }[]; elements?: unknown[]; rest?: unknown };
    if (n.kind === "ident" && typeof n.name === "string") bound.add(n.name);
    if (n.kind === "default") binding(n.target);
    for (const x of n.props ?? []) binding(x.value);
    for (const x of n.elements ?? []) binding(x);
    binding(n.rest);
  };
  const visit = (node: unknown, top: boolean) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((x) => visit(x, false));
    const n = node as Record<string, unknown> & { kind?: string };
    if ((n.kind === "ident" || n.kind === "ref" || n.kind === "variant") && typeof n.name === "string") used.add(n.name.split(".")[0]!);
    if (!top && ["function", "class", "typeAlias", "interface", "enum"].includes(n.kind!) && typeof n.name === "string") bound.add(n.name);
    if (n.kind === "let" && !top) for (const d of n.declarations as { target: unknown }[]) binding(d.target);
    if (Array.isArray(n.params)) for (const p of n.params as { pattern: unknown }[]) binding(p.pattern);
    if (Array.isArray(n.typeParams)) for (const p of n.typeParams as { name: string }[]) bound.add(p.name);
    if (n.kind === "try") binding(n.param);
    for (const v of Object.values(n)) visit(v, false);
  };
  visit(s.kind === "export" ? s.body : s, true);
  for (const b of bound) used.delete(b);
  return used;
}

// The std library, the macros, and every declaration they use, found by name.
function macroProgram(program: Stmt[], macros: Map<string, Func>, sites: NodeSet<Decl>, constants: Stmt[] = []): Stmt[] {
  const std = program.filter((s) => s.start >= STD_BASE);
  const own = program.filter((s) => s.start < STD_BASE);
  const byName = new Map(own.flatMap((s) => namesOf(s).map((n) => [n, s] as const)));
  const kept = new NodeSet<Stmt>();
  const visit = (s: Stmt, by: Func | Stmt, via: string | undefined) => {
    if (kept.has(s)) return;
    const d = (s.kind === "export" ? s.body : s) as Decl;
    if (sites.has(d)) {
      const name = written(namesOf(s)[0] ?? "");
      const what = by.kind === "function" ? `the macro '${written(by.name)}'` : "this argument";
      throw new CompileError(`${what} uses '${name}'${via ? ` through '${written(via)}'` : ""}, which a macro makes or changes; a macro can't depend on an expansion`, by.start, by.end);
    }
    kept.add(s);
    const self = namesOf(s)[0];
    for (const name of freeNames(s)) {
      const used = byName.get(name);
      if (used && used !== s) visit(used, by, by.kind === "function" && self === by.name ? via : self);
    }
  };
  for (const m of macros.values()) visit(byName.get(m.name)!, m, undefined);
  for (const c of constants) for (const name of freeNames(c)) {
    const used = byName.get(name);
    if (used) visit(used, c, undefined);
  }
  return [...std, ...own.filter((s) => kept.has(s)), ...constants];
}

// The top-level declarations a program's quotes make.
function quoteDeclarations(tables: Tables, s: Stmt): string[] {
  const found: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const n = node as Expr;
    if (n.kind === "tagged" && n.tag.kind === "ident" && (n.tag.name === "quote" || n.tag.name === "quoteType")) {
      try {
        found.push(...declaredBy(quoted(tables, n, n.tag.name === "quoteType")));
      } catch {
        // A quote that doesn't parse is reported when the macro is checked.
      }
    }
    Object.values(n).forEach(visit);
  };
  visit(s);
  return found;
}

// Runs the decorator that applies next to a declaration and gives what replaces it. The macro
// takes the declaration without any decorators; those still to apply go back on what it gives,
// on the declaration of the same name, or the same kind, and on its members and parameters of
// the same name, or at the same place.
function run(decl: Decl, exported: boolean, module: Module, pending: Pending, ready: Prepared, ctx: Context): Stmt[] {
  const { compilation, macros, checked, code, loaded, pins, library } = ctx;
  const { ids } = compilation;
  const nearest = ready.linked;
  const macro = macroOf(nearest, macros);
  const before = pending.where === "own" ? 1 : 2;
  const instance = checked.instances.find((i) => i.body.name === macro.name && i.body.start === macro.start);
  // A parameter of an object or interface type makes a function generic, with no instance until
  // it is called.
  if (!instance) throw new CompileError("a macro's parameters can't be object types or interfaces yet, which make it generic; use a class", macro.start, macro.end);
  const param = macro.params[0]!;
  const returns = instance.returns;
  if (typeof returns === "string" || returns.kind === "literal") throw new CompileError(`a macro gives the declarations it makes, as an 'Ast' or an 'Ast[]', not '${returns}'`, macro.start, macro.end);
  const input = instance.locals.get(param)!.type;
  const { bare, restore } = stripped(ids, decl, pending);
  const types = { AstExpr: input, AstStmt: input, AstType: input } as Record<Category, Type>;
  let value: Value;
  try {
    value = built<Value>(checked.tables, { tree: bare, category: "AstStmt", holes: [], asExpressions: new Set(), names: new Set() }, types, undefined, astValues(() => null));
  } catch (e) {
    if (e instanceof CompileError) throw e;
    throw new CompileError("a macro's parameter takes the declaration it is applied to, so its type is 'Ast' or 'AstStmt'", param.start, param.end);
  }
  const suffix = `@m${compilation.counts.expansions++}`;
  const fresh = (name: string) => {
    compilation.names.local.add(`${name}${suffix}`);
    return `${name}${suffix}`;
  };
  // The declarations this macro's quotes make are known from the start, so a quote naming one
  // made by a quote it builds later means it.
  const declared = reached(code, macro).flatMap((s) => quoteDeclarations(ctx.checked.tables, s));
  const members = new Set(loaded.modules.flatMap((m) => m.statements.flatMap((s) => {
    const d = s.kind === "export" ? s.body : s;
    return d?.kind === "enum" ? d.members.map((x) => x.name) : [];
  })));
  const hygiene: Hygiene = { declared: new Map(declared.map((n) => [n, fresh(n)])), namesIn: (file) => namesIn(loaded.modules[file]!), pins, members, fresh };
  // An argument taken as syntax is the argument as written; one taken as a value is its constant's.
  const original = pending.decorator.kind === "call" ? pending.decorator.args : [];
  // Computed in the macro's hygiene, so a quote in an argument or a default means its file's names.
  const values = () => ready.args.map((a, i) => {
    const t = instance.locals.get(macro.params[i + before]!)!.type;
    if (a.none) return null;
    if (!a.syntax) return comptimeBody(checked.instances.find((c) => c.body.name === `const ${a.name}`)!);
    return built<Value>(checked.tables, { tree: original[i] ?? a.expr, category: "AstExpr", holes: [], asExpressions: new Set(), names: new Set() }, { AstExpr: t, AstStmt: t, AstType: t }, undefined, astValues(() => null));
  });
  const index = before === 2 ? [BigInt(pending.index)] : [];
  const result = withHygiene(checked.tables, hygiene, () => comptimeCall(instance, [value, ...index, ...values()], nearest));
  const node = nodeOf(ids, result);
  const given = (Array.isArray(node) ? node : [node]) as Decl[];
  markGenerated(compilation.generated, given);
  // A name past the linker's suffix is one only a pin may write, as `ident` can't.
  const forged = findName(given, (n) => /-fsh\d+$/.test(n) && !hygiene.pins.has(n));
  if (forged) throw new CompileError(`the macro '${written(macro.name)}' gave the name '${forged}', which no program can write; 'ident' makes a name as written in the program`, nearest.start, nearest.end);
  for (const d of given) {
    if (!d || typeof d !== "object" || !(TOP_LEVEL.has(d.kind) || isExport(d))) {
      throw new CompileError(`the macro '${written(macro.name)}' gave ${d && typeof d === "object" ? `a '${d.kind}'` : "nothing"}, but a macro gives declarations that can stand at the top level`, nearest.start, nearest.end);
    }
  }
  const bodies = given.map((d) => (isExport(d) ? ((d as { body: Decl }).body) : d));
  // A macro on a member gives the class back, and one on a parameter its function.
  if (pending.where !== "own" && !bodies.some((d) => d.kind === decl.kind)) {
    throw new CompileError(`a macro on a ${pending.where === "member" ? "member gives the class back" : "parameter gives the function back"}, changed as it likes, but '${written(macro.name)}' gave none`, nearest.start, nearest.end);
  }
  restore(bodies);
  const name = namesOf(decl)[0];
  return given.map((decl) => {
    // On an exported declaration, what the macro gives under names the program can see is
    // exported too; its private declarations aren't. A library's exports are C functions, so
    // there only the declaration's own name stays exported.
    const visible = namesOf(decl).every((n) => !compilation.names.local.has(n)) && EXPORTABLE.has(decl.kind) && (!library || namesOf(decl)[0] === name);
    return exported && !isExport(decl) && visible ? ({ id: nextId(ids), kind: "export", body: decl, start: decl.start, end: decl.end } as Stmt) : decl;
  });
}

// A declaration without its decorators, and how to put back those still to apply on what a
// macro gives in its place.
function stripped(ids: Ids, decl: Decl, pending: Pending): { bare: Stmt; restore(given: Decl[]): void } {
  const own = pending.where === "own" ? (decl.decorators ?? []).slice(0, -1) : (decl.decorators ?? []);
  const later = <T extends { decorators: Expr[] }>(x: T, i: number, where: Pending["where"]) => (pending.where === where && pending.index === i ? x.decorators.slice(0, -1) : x.decorators);
  const members = decl.kind === "class" ? decl.members.map((m, i) => later(m, i, "member")) : [];
  const params = decl.kind === "function" ? decl.params.map((p, i) => later(p, i, "param")) : [];
  const clear = <T extends { decorators: Expr[] }>(x: T) => ({ ...x, decorators: [] });
  const bare = decl.kind === "class" ? { ...decl, id: nextId(ids), decorators: [], members: decl.members.map(clear) }
    : decl.kind === "function" ? { ...decl, id: nextId(ids), decorators: undefined, params: decl.params.map(clear) }
    : { ...decl, id: nextId(ids), decorators: undefined };
  const name = namesOf(decl)[0];
  const restore = (given: Decl[]) => {
    const named = given.find((d) => d.kind === decl.kind && namesOf(d)[0] === name);
    const same = named ?? given.find((d) => d.kind === decl.kind) ?? (pending.where === "own" ? given[0] : undefined);
    const waiting = [...members, ...params].some((x) => x.length > 0);
    // Decorators of members or parameters need their container back to go on.
    if (waiting && !named) {
      const at = [...members, ...params].find((x) => x.length > 0)![0]!;
      throw new CompileError(`a macro gave no '${name}' back, so the decorators still to apply to its ${decl.kind === "class" ? "members" : "parameters"} have nowhere to go`, at.start, at.end);
    }
    if (!same) return;
    if (own.length > 0) Object.assign(same, { decorators: [...own, ...(same.decorators ?? [])] });
    // Each goes back to the member of the same kind and name, or the same kind when it has none,
    // or else the same place, a member taking one member's decorators.
    const back = <T extends { decorators: Expr[] }>(list: T[], before: T[], saved: Expr[][], key: (x: T) => string) => {
      const taken = new Set<T>();
      saved.forEach((decorators, i) => {
        if (decorators.length === 0) return;
        const want = key(before[i]!);
        const place = list[i];
        const at = list.find((x) => !taken.has(x) && key(x) === want) ?? (place && !taken.has(place) && kindOf(place) === kindOf(before[i]!) ? place : undefined);
        if (!at) throw new CompileError("a macro took away what these decorators were waiting to apply to", decorators[0]!.start, decorators[0]!.end);
        taken.add(at);
        at.decorators = [...decorators, ...at.decorators];
      });
    };
    const kindOf = (x: unknown) => (x as { kind?: string }).kind ?? "param";
    const memberKey = (m: ClassMember) => `${m.kind} ${m.modifiers.includes("static") ? "static " : ""}${typeof (m as { name?: unknown }).name === "string" ? (m as { name: string }).name : ""}`;
    if (same.kind === "class" && decl.kind === "class") back(same.members, decl.members, members, memberKey);
    if (same.kind === "function" && decl.kind === "function") back(same.params, decl.params, params, (p) => (p.pattern.kind === "ident" ? p.pattern.name : `#${decl.params.indexOf(p)}`));
  };
  return { bare: bare as Stmt, restore };
}

const EXPORTABLE = new Set(["function", "class", "typeAlias", "interface", "enum"]);

// A name in a tree that `bad` picks, if any.
function findName(node: unknown, bad: (name: string) => boolean): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const x of node) {
      const found = findName(x, bad);
      if (found) return found;
    }
    return undefined;
  }
  const n = node as Record<string, unknown>;
  if (typeof n.name === "string" && bad(n.name)) return n.name;
  for (const v of Object.values(n)) {
    const found = findName(v, bad);
    if (found) return found;
  }
  return undefined;
}

// A value made while compiling as the syntax tree it stands for.
function nodeOf(ids: Ids, v: Value): unknown {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== "object") return v;
  if (v.kind === "member") return nodeOf(ids, v.value);
  if (v.kind === "array") return v.items.map((x) => nodeOf(ids, x));
  if (v.kind !== "record") throw new Error(`internal error: an Ast value holding a '${v.kind}'`);
  const node: Record<string, unknown> = {};
  for (const [k, x] of v.fields) node[k] = (k === "start" || k === "end") && typeof x === "bigint" ? Number(x) : nodeOf(ids, x);
  // Ast values carry no ids, so each node made from one gets its own.
  if ("start" in node) node.id = nextId(ids);
  return node;
}
