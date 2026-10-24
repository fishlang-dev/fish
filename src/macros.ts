import type { Checked } from "./check.ts";
import { astValues, comptimeCall, type Value } from "./comptime.ts";
import { CompileError, LOCAL_NAMES } from "./diag.ts";
import { flatten, type Loaded, type Module } from "./modules.ts";
import type { Expr, Func, Stmt } from "./parser.ts";
import { built, declaredBy, quoted, withHygiene, type Category, type Hygiene } from "./quote.ts";
import { STD_BASE } from "./std.ts";
import type { Type } from "./typing.ts";

// Macros on declarations: `@name` before a top-level declaration runs `macro function name` on
// it while compiling, and what the macro gives replaces it in its file, before the files are
// linked, so what it gives is the file's own and is imported as any declaration is. The macros,
// and the declarations they use, are checked and run on their own first, so a macro can't use
// what an expansion makes.

// How many rounds of expansion a program may take, each running the macros its last round gave.
const ROUNDS = 16;
// The declarations a macro may give: what can stand at the top level.
const TOP_LEVEL = new Set(["function", "class", "typeAlias", "interface", "enum", "let", "comptime", "declare"]);
// A declaration given as exported, by a macro wanting it imported from its file.
const isExport = (d: Decl) => d.kind === "export" && !!d.body && TOP_LEVEL.has(d.body.kind);

type Decl = Stmt & { decorators?: Expr[] };
// A decorated top-level declaration of a file, and whether it is exported.
type Site = { module: Module; index: number; decl: Decl; exported: boolean };

let expansions = 0;

// Expands every file's macros in place.
export function expandMacros(loaded: Loaded, library: boolean, checkMacros: (program: Stmt[]) => Checked) {
  // The pinned names every round's quotes made, which a later round's macro may give back.
  const pins = new Set<string>();
  for (let round = 0; ; round++) {
    const sites = loaded.modules.flatMap(decorated);
    if (sites.length === 0) return;
    if (round === ROUNDS) {
      const at = sites[0]!.decl.decorators![0]!;
      throw new CompileError(`macros gave declarations using macros ${ROUNDS} rounds deep; does a macro give back what it was applied to, with its decorator?`, at.start, at.end);
    }
    // The program as linked, from copies, for checking and running the macros; an import of what
    // an expansion will make isn't there yet, and nothing the macros use may need one.
    const { loaded: copy, of } = copied(loaded);
    const program = flatten(copy, library, true);
    const macros = macroFunctions(program);
    const linked = (site: Site) => {
      const s = of.get(site.module.statements[site.index]!)!;
      return (s.kind === "export" ? s.body : s) as Decl;
    };
    for (const site of sites) for (const x of linked(site).decorators!) macroOf(x, macros);
    const macroCode = macroProgram(program, macros, new Set(sites.map(linked)));
    const checked = checkMacros(macroCode);
    for (const site of [...sites].reverse()) run(site, linked(site), macros, checked, macroCode, loaded, pins, library);
  }
}

// Every file's statements copied, so linking the copy leaves the files as written, and the copy
// of each statement.
function copied(loaded: Loaded): { loaded: Loaded; of: Map<Stmt, Stmt> } {
  const copies = new Map<Module, Module>();
  const of = new Map<Stmt, Stmt>();
  for (const m of loaded.modules) {
    const statements = structuredClone(m.statements);
    m.statements.forEach((s, i) => of.set(s, statements[i]!));
    copies.set(m, { ...m, statements, targets: new Map() });
  }
  for (const m of loaded.modules) {
    const copy = copies.get(m)!;
    m.statements.forEach((s, i) => {
      const target = m.targets.get(s);
      if (target) copy.targets.set(copy.statements[i]!, copies.get(target)!);
    });
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
  const found = new Set<Stmt>();
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
    return decl && (decl.decorators?.length ?? 0) > 0 ? [{ module, index, decl, exported }] : [];
  });
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

// The macro a decorator names.
function macroOf(d: Expr, macros: Map<string, Func>): Func {
  if (d.kind === "call") throw new CompileError("decorators with arguments aren't supported yet", d.start, d.end);
  if (d.kind !== "ident") throw new CompileError("a decorator names a macro, as in '@name'", d.start, d.end);
  const macro = macros.get(d.name);
  if (!macro) throw new CompileError(`'${written(d.name)}' isn't a macro; a decorator applies a 'macro function ${written(d.name)}(input: Ast): Ast'`, d.start, d.end);
  return macro;
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
function macroProgram(program: Stmt[], macros: Map<string, Func>, sites: Set<Decl>): Stmt[] {
  const std = program.filter((s) => s.start >= STD_BASE);
  const own = program.filter((s) => s.start < STD_BASE);
  const byName = new Map(own.flatMap((s) => namesOf(s).map((n) => [n, s] as const)));
  const kept = new Set<Stmt>();
  const visit = (s: Stmt, by: Func, via: string | undefined) => {
    if (kept.has(s)) return;
    const d = (s.kind === "export" ? s.body : s) as Decl;
    if (sites.has(d)) {
      const name = written(namesOf(s)[0] ?? "");
      throw new CompileError(`the macro '${written(by.name)}' uses '${name}'${via ? ` through '${written(via)}'` : ""}, which a macro makes or changes; a macro can't depend on an expansion`, by.start, by.end);
    }
    kept.add(s);
    const self = namesOf(s)[0];
    for (const name of freeNames(s)) {
      const used = byName.get(name);
      if (used && used !== s) visit(used, by, self === by.name ? via : self);
    }
  };
  for (const m of macros.values()) visit(byName.get(m.name)!, m, undefined);
  return [...std, ...own.filter((s) => kept.has(s))];
}

// The top-level declarations a program's quotes make.
function quoteDeclarations(s: Stmt): string[] {
  const found: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const n = node as Expr;
    if (n.kind === "tagged" && n.tag.kind === "ident" && (n.tag.name === "quote" || n.tag.name === "quoteType")) {
      try {
        found.push(...declaredBy(quoted(n, n.tag.name === "quoteType")));
      } catch {
        // A quote that doesn't parse is reported when the macro is checked.
      }
    }
    Object.values(n).forEach(visit);
  };
  visit(s);
  return found;
}

// Runs a site's nearest decorator's macro on its declaration, and puts what it gives in the
// declaration's place, the other decorators kept on each declaration given for a later round.
function run(site: Site, linked: Decl, macros: Map<string, Func>, checked: Checked, code: Stmt[], loaded: Loaded, pins: Set<string>, library: boolean) {
  const nearest = linked.decorators!.at(-1)!;
  const rest = site.decl.decorators!.slice(0, -1);
  const macro = macroOf(nearest, macros);
  const instance = checked.instances.find((i) => i.body.name === macro.name && i.body.start === macro.start);
  if (!instance) throw new Error(`internal error: the macro '${macro.name}' wasn't checked`);
  const param = macro.params[0]!;
  const returns = instance.returns;
  if (typeof returns === "string" || returns.kind === "literal") throw new CompileError(`a macro gives the declarations it makes, as an 'Ast' or an 'Ast[]', not '${returns}'`, macro.start, macro.end);
  const input = instance.locals.get(param)!.type;
  const bare = { ...site.decl, decorators: site.decl.kind === "class" ? [] : undefined } as Stmt;
  const types = { AstExpr: input, AstStmt: input, AstType: input } as Record<Category, Type>;
  let value: Value;
  try {
    value = built<Value>({ tree: bare, category: "AstStmt", holes: [], asExpressions: new Set(), names: new Set() }, types, undefined, astValues(() => null));
  } catch (e) {
    if (e instanceof CompileError) throw e;
    throw new CompileError("a macro's parameter takes the declaration it is applied to, so its type is 'Ast' or 'AstStmt'", param.start, param.end);
  }
  const suffix = `@m${expansions++}`;
  const fresh = (name: string) => {
    LOCAL_NAMES.add(`${name}${suffix}`);
    return `${name}${suffix}`;
  };
  // The declarations this macro's quotes make are known from the start, so a quote naming one
  // made by a quote it builds later means it.
  const declared = reached(code, macro).flatMap(quoteDeclarations);
  const members = new Set(loaded.modules.flatMap((m) => m.statements.flatMap((s) => {
    const d = s.kind === "export" ? s.body : s;
    return d?.kind === "enum" ? d.members.map((x) => x.name) : [];
  })));
  const hygiene: Hygiene = { declared: new Map(declared.map((n) => [n, fresh(n)])), namesIn: (file) => namesIn(loaded.modules[file]!), pins, members, fresh };
  const result = withHygiene(hygiene, () => comptimeCall(instance, [value], nearest));
  const node = nodeOf(result);
  const given = (Array.isArray(node) ? node : [node]) as Decl[];
  // A name past the linker's suffix is one only a pin may write, as `ident` can't.
  const forged = findName(given, (n) => /-fsh\d+$/.test(n) && !hygiene.pins.has(n));
  if (forged) throw new CompileError(`the macro '${written(macro.name)}' gave the name '${forged}', which no program can write; 'ident' makes a name as written in the program`, nearest.start, nearest.end);
  const replacing = given.map((d) => {
    if (!d || typeof d !== "object" || !(TOP_LEVEL.has(d.kind) || isExport(d))) {
      throw new CompileError(`the macro '${written(macro.name)}' gave ${d && typeof d === "object" ? `a '${d.kind}'` : "nothing"}, but a macro gives declarations that can stand at the top level`, nearest.start, nearest.end);
    }
    const decl = rest.length > 0 ? ({ ...d, decorators: [...rest, ...(d.decorators ?? [])] } as Decl) : d;
    // On an exported declaration, what the macro gives under names the program can see is
    // exported too; its private declarations aren't. A library's exports are C functions, so
    // there only the declaration's own name stays exported.
    const visible = namesOf(decl).every((n) => !LOCAL_NAMES.has(n)) && EXPORTABLE.has(decl.kind)
      && (!library || namesOf(decl)[0] === namesOf(site.decl)[0]);
    return site.exported && !isExport(decl) && visible ? ({ kind: "export", body: decl, start: decl.start, end: decl.end } as Stmt) : decl;
  });
  site.module.statements.splice(site.index, 1, ...replacing);
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
function nodeOf(v: Value): unknown {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== "object") return v;
  if (v.kind === "member") return nodeOf(v.value);
  if (v.kind === "array") return v.items.map(nodeOf);
  if (v.kind !== "record") throw new Error(`internal error: an Ast value holding a '${v.kind}'`);
  const node: Record<string, unknown> = {};
  for (const [k, x] of v.fields) node[k] = (k === "start" || k === "end") && typeof x === "bigint" ? Number(x) : nodeOf(x);
  return node;
}
