import type { Checked } from "./check.ts";
import { astValues, comptimeCall, type Value } from "./comptime.ts";
import { CompileError } from "./diag.ts";
import type { Expr, Func, Stmt } from "./parser.ts";
import { built, type Category } from "./quote.ts";
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
    const value = built<Value>({ tree: bare, category: "AstStmt", holes: [], asExpressions: new Set() }, types, undefined, astValues(() => null));
    const result = comptimeCall(instance, [value], nearest);
    const given = (Array.isArray(nodeOf(result)) ? nodeOf(result) : [nodeOf(result)]) as Decl[];
    const replacing = given.map((d) => {
      if (!d || typeof d !== "object" || !TOP_LEVEL.has(d.kind)) {
        throw new CompileError(`the macro '${macro.name}' gave ${d && typeof d === "object" ? `a '${d.kind}'` : "nothing"}, but a macro gives declarations that can stand at the top level`, nearest.start, nearest.end);
      }
      const decl = rest.length > 0 ? ({ ...d, decorators: [...rest, ...(d.decorators ?? [])] } as Decl) : d;
      return site.exported ? ({ kind: "export", body: decl, start: decl.start, end: decl.end } as Stmt) : decl;
    });
    out.splice(site.index, 1, ...replacing);
  }
  return out;
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

