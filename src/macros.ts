import type { Checked } from "./check.ts";
import { astValues, comptimeCall, type Value } from "./comptime.ts";
import { CompileError, LOCAL_NAMES } from "./diag.ts";
import type { Expr, Func, Stmt } from "./parser.ts";
import { built, quoted, type Category } from "./quote.ts";
import { STD_BASE } from "./std.ts";
import type { Type } from "./typing.ts";

// Macros on declarations: `@name` before a top-level declaration runs `macro function name` on
// it while compiling, and what the macro gives replaces it. The macros, and the declarations
// they use, are checked and run first on their own, so a macro can't use what an expansion
// makes.

// How many rounds of expansion a program may take, each running the macros its last round gave.
const ROUNDS = 16;
// The declarations a macro may give: what can stand at the top level.
const TOP_LEVEL = new Set(["function", "class", "typeAlias", "interface", "enum", "let", "comptime", "declare"]);

type Decl = Stmt & { decorators?: Expr[] };
// A decorated top-level declaration, and whether it is exported.
type Site = { index: number; decl: Decl; exported: boolean };

export function expandMacros(program: Stmt[], checkMacros: (program: Stmt[]) => Checked): Stmt[] {
  let current = program;
  for (let round = 0; ; round++) {
    const sites = decorated(current);
    if (sites.length === 0) return current;
    if (round === ROUNDS) {
      const at = sites[0]!.decl.decorators![0]!;
      throw new CompileError(`macros gave declarations using macros ${ROUNDS} rounds deep; does a macro give back what it was applied to, with its decorator?`, at.start, at.end);
    }
    const macros = macroFunctions(current);
    for (const site of sites) for (const d of site.decl.decorators!) macroOf(d, macros);
    const checked = checkMacros(macroProgram(current, macros, sites));
    current = expanded(current, sites, macros, checked);
  }
}

// The top-level declarations a decorator stands on, except a class's decorators that name no
// macro, which are TypeScript's and refused where classes are checked.
function decorated(program: Stmt[]): Site[] {
  return program.flatMap((s, index) => {
    const exported = s.kind === "export";
    const decl = (s.kind === "export" ? s.body : s) as Decl;
    return decl && (decl.decorators?.length ?? 0) > 0 ? [{ index, decl, exported }] : [];
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

// The macro a decorator names.
function macroOf(d: Expr, macros: Map<string, Func>): Func {
  if (d.kind === "call") throw new CompileError("decorators with arguments aren't supported yet", d.start, d.end);
  if (d.kind !== "ident") throw new CompileError("a decorator names a macro, as in '@name'", d.start, d.end);
  const macro = macros.get(d.name);
  if (!macro) throw new CompileError(`'${d.name}' isn't a macro; a decorator applies a 'macro function ${d.name}(input: Ast): Ast'`, d.start, d.end);
  return macro;
}

// What a top-level statement declares.
function namesOf(s: Stmt): string[] {
  const d = s.kind === "export" ? s.body : s;
  if (!d) return [];
  if (d.kind === "let") return d.declarations.flatMap((x) => (x.target.kind === "ident" ? [x.target.name] : []));
  return "name" in d && typeof d.name === "string" ? [d.name] : [];
}

// The names a node uses, as values or types.
function namesUsed(node: unknown, found = new Set<string>()): Set<string> {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const x of node) namesUsed(x, found);
    return found;
  }
  const n = node as { kind?: string; name?: unknown };
  if ((n.kind === "ident" || n.kind === "ref" || n.kind === "variant") && typeof n.name === "string") found.add(n.name.split(".")[0]!);
  for (const v of Object.values(n)) namesUsed(v, found);
  return found;
}

// The std library, the macros, and every declaration they use, found by name.
function macroProgram(program: Stmt[], macros: Map<string, Func>, sites: Site[]): Stmt[] {
  const std = program.filter((s) => s.start >= STD_BASE);
  const own = program.filter((s) => s.start < STD_BASE);
  const byName = new Map(own.flatMap((s) => namesOf(s).map((n) => [n, s] as const)));
  const made = new Set(sites.map((s) => program[s.index]!));
  const kept = new Set<Stmt>();
  const visit = (s: Stmt, by: Func) => {
    if (kept.has(s)) return;
    if (made.has(s)) {
      const name = namesOf(s)[0];
      throw new CompileError(`the macro '${by.name}' uses '${name}', which a macro makes or changes; a macro can't depend on an expansion`, by.start, by.end);
    }
    kept.add(s);
    for (const name of namesUsed(s)) {
      const used = byName.get(name);
      if (used) visit(used, by);
    }
  };
  for (const m of macros.values()) visit(byName.get(m.name)!, m);
  return [...std, ...own.filter((s) => kept.has(s))];
}

// The program with each site replaced by what its nearest decorator's macro gives for it, the
// other decorators kept on each declaration given, to apply in the next round.
function expanded(program: Stmt[], sites: Site[], macros: Map<string, Func>, checked: Checked): Stmt[] {
  const out = [...program];
  for (const site of [...sites].reverse()) {
    const decorators = site.decl.decorators!;
    const nearest = decorators.at(-1)!;
    const rest = decorators.slice(0, -1);
    const macro = macroOf(nearest, macros);
    const instance = checked.instances.find((i) => i.body.name === macro.name && i.body.start === macro.start);
    if (!instance) throw new Error(`internal error: the macro '${macro.name}' wasn't checked`);
    const param = macro.params[0];
    if (macro.params.length !== 1 || !param) throw new CompileError(`a macro takes one parameter, the declaration it is applied to, as in 'macro function ${macro.name}(input: Ast): Ast'`, macro.start, macro.end);
    const input = instance.locals.get(param)!.type;
    const bare = { ...site.decl, decorators: site.decl.kind === "class" ? [] : undefined } as Stmt;
    const types = { AstExpr: input, AstStmt: input, AstType: input } as Record<Category, Type>;
    const value = built<Value>({ tree: bare, category: "AstStmt", holes: [], asExpressions: new Set(), names: new Set() }, types, undefined, astValues(() => null));
    const result = comptimeCall(instance, [value], nearest);
    const given = (Array.isArray(nodeOf(result)) ? nodeOf(result) : [nodeOf(result)]) as Decl[];
    const replacing = given.map((d) => {
      if (!d || typeof d !== "object" || !TOP_LEVEL.has(d.kind)) {
        throw new CompileError(`the macro '${macro.name}' gave ${d && typeof d === "object" ? `a '${d.kind}'` : "nothing"}, but a macro gives declarations that can stand at the top level`, nearest.start, nearest.end);
      }
      const decl = rest.length > 0 ? ({ ...d, decorators: [...rest, ...(d.decorators ?? [])] } as Decl) : d;
      return site.exported ? ({ kind: "export", body: decl, start: decl.start, end: decl.end } as Stmt) : decl;
    });
    hygienic(replacing, macro);
    out.splice(site.index, 1, ...replacing);
  }
  return out;
}

let expansions = 0;

// Makes the names a macro's quotes declare private to this expansion: each declaration, binding
// and use written in the macro, of a name its quotes declare, takes a name no other code can
// write. Names from the input, or made with `ident`, are where nothing in the macro is.
function hygienic(given: Stmt[], macro: Func) {
  const declared = quotedNames(macro);
  if (declared.size === 0) return;
  const suffix = `@m${expansions++}`;
  const inMacro = (n: { start?: unknown; end?: unknown }) => typeof n.start === "number" && typeof n.end === "number" && n.start >= macro.start && n.end <= macro.end && n.end > n.start;
  const renamed = (name: string) => {
    LOCAL_NAMES.add(`${name}${suffix}`);
    return `${name}${suffix}`;
  };
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const n = node as { kind?: string; name?: unknown; start?: unknown; end?: unknown };
    if (typeof n.name === "string" && NAMED.has(n.kind!) && inMacro(n)) {
      const [head, ...rest] = n.name.split(".");
      if (declared.has(head!)) n.name = [renamed(head!), ...rest].join(".");
    }
    Object.values(n).forEach(visit);
  };
  visit(given);
}

// The nodes whose `name` is one a quote may declare or use: identifiers, type references,
// declarations and their kin.
const NAMED = new Set(["ident", "ref", "function", "class", "typeAlias", "interface", "enum", "variant"]);

// The names a macro's quotes declare: functions, classes, types and enums, and the variables and
// parameters they bind.
function quotedNames(macro: Func): Set<string> {
  const found = new Set<string>();
  const binding = (p: unknown) => {
    if (!p || typeof p !== "object") return;
    const n = p as { kind?: string; name?: unknown; target?: unknown; props?: { value: unknown }[]; elements?: unknown[]; rest?: unknown };
    if (n.kind === "ident" && typeof n.name === "string") found.add(n.name);
    if (n.kind === "default") binding(n.target);
    for (const x of n.props ?? []) binding(x.value);
    for (const x of n.elements ?? []) binding(x);
    binding(n.rest);
  };
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const n = node as Record<string, unknown> & { kind?: string };
    if (["function", "class", "typeAlias", "interface", "enum"].includes(n.kind!) && typeof n.name === "string") found.add(n.name);
    if (n.kind === "let") for (const d of n.declarations as { target: unknown }[]) binding(d.target);
    if (Array.isArray(n.params)) for (const p of n.params as { pattern: unknown }[]) binding(p.pattern);
    if (n.kind === "try") binding(n.param);
    Object.values(n).forEach(visit);
  };
  const quotes = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(quotes);
    const n = node as Expr;
    if (n.kind === "tagged" && n.tag.kind === "ident" && (n.tag.name === "quote" || n.tag.name === "quoteType")) {
      try {
        visit(quoted(n, n.tag.name === "quoteType").tree);
      } catch {
        // A quote that doesn't parse was reported when the macro was checked.
      }
    }
    Object.values(n).forEach(quotes);
  };
  quotes(macro.body);
  for (const name of [...found]) if (name.startsWith("__fishSplice")) found.delete(name);
  return found;
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

