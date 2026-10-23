import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CompileError, locate } from "./diag.ts";
import { parse } from "./parser.ts";

// `fishc survey`: how hard an existing TypeScript project is to port, read from its syntax alone.
// Each construct found is one of the migration lint's actions: rejected (no Fish equivalent),
// not supported yet (named by the planned feature that brings it), guided (a person rewrites it)
// or auto-fixed.

export type Action = "reject" | "unsupported" | "guided" | "auto";
type Rule = { id: string; action: Action; title: string };
type Example = { file: string; line: number; col: number };
export type RuleCount = Rule & { count: number; examples: Example[] };
export type Report = {
  files: number; lines: number; score: number; grade: string;
  counts: Record<Action, number>; rules: RuleCount[];
};

const RULES: Rule[] = [
  { id: "R1", action: "reject", title: "eval and new Function: a native binary has no compiler to run code made at run time" },
  { id: "R2", action: "reject", title: "prototype edits and Object.defineProperty: Fish types have fixed layouts" },
  { id: "R3", action: "reject", title: "delete: Fish objects have fixed layouts; use an Option field or a Map" },
  { id: "parse", action: "unsupported", title: "files Fish's parser can't read" },
  { id: "modules", action: "unsupported", title: "imports and exports between files (multi-file programs)" },
  { id: "destructuring", action: "unsupported", title: "destructuring patterns (destructuring)" },
  { id: "defaults", action: "unsupported", title: "default parameter values" },
  { id: "declarators", action: "unsupported", title: "several declarators, or a declaration assigned later" },
  { id: "tuples", action: "unsupported", title: "tuple types" },
  { id: "spread", action: "unsupported", title: "rest parameters and spread (rest parameters and array spread, object spread)" },
  { id: "arrayMethods", action: "unsupported", title: "array methods such as map, filter and reduce" },
  { id: "collections", action: "unsupported", title: "Map and Set" },
  { id: "regex", action: "unsupported", title: "regex literals" },
  { id: "forIn", action: "unsupported", title: "for...in loops over an object's keys" },
  { id: "decorators", action: "unsupported", title: "decorators (macros, decorators and derive)" },
  { id: "namespaces", action: "unsupported", title: "namespaces and module declarations" },
  { id: "genericMethods", action: "unsupported", title: "type parameters on methods and arrow functions (generic methods, interfaces and arrows)" },
  { id: "classForms", action: "unsupported", title: "#private names and abstract classes" },
  { id: "tagged", action: "unsupported", title: "tagged templates" },
  { id: "math", action: "unsupported", title: "Math, parseInt, parseFloat and Number() (number parsing and Math)" },
  { id: "process", action: "unsupported", title: "process (process environment)" },
  { id: "fetch", action: "unsupported", title: "fetch (HTTP client)" },
  { id: "timers", action: "unsupported", title: "setTimeout and setInterval" },
  { id: "stderr", action: "unsupported", title: "console.error, console.warn, Date.now and performance.now (logging to stderr and clocks)" },
  { id: "json", action: "unsupported", title: "JSON.parse and JSON.stringify (derive for Json)" },
  { id: "promiseAll", action: "unsupported", title: "Promise.all and Promise.race" },
  { id: "localDeclarations", action: "unsupported", title: "types, interfaces, enums and classes declared inside a function" },
  { id: "nestedFunctions", action: "unsupported", title: "function declarations inside a function (nested functions)" },
  { id: "G1", action: "guided", title: "any: choose a concrete type, a union, or the dynamic Json value" },
  { id: "G4", action: "guided", title: "class extends: Fish embeds the base, so a polymorphic hierarchy becomes an interface" },
  { id: "G5", action: "guided", title: "instanceof: match on an interface or an enum instead" },
  { id: "G6", action: "guided", title: "indexing an object with a string key: use a Map" },
  { id: "G7", action: "guided", title: "top-level code with side effects: move it into main() or a comptime const" },
  { id: "G8", action: "guided", title: "isNaN after parsing: Fish's parsing gives an Option to check" },
  { id: "G9", action: "guided", title: ".call, .apply and .bind: pass the receiver explicitly or use a closure" },
  { id: "G10", action: "guided", title: "an async callback passed to forEach: use for...of with await, or spawned tasks" },
  { id: "A1", action: "auto", title: "var: const or let" },
  { id: "A2", action: "auto", title: "null, undefined and ?: Option" },
  { id: "A3", action: "auto", title: "== and !=: === and !==" },
  { id: "A4", action: "auto", title: "a top-level let: a const holding an Atomic" },
  { id: "A8", action: "auto", title: "JSON.parse(s) as T: JSON.parse<T>(s)" },
  { id: "A9", action: "auto", title: "function expressions: arrow functions" },
];

const WEIGHTS: Record<Action, number> = { reject: 10, unsupported: 10, guided: 3, auto: 0 };
const ARRAY_METHODS = new Set(["map", "filter", "find", "findIndex", "some", "every", "reduce", "forEach", "flatMap", "sort", "splice"]);
const MODULE_FORMS = new Set(["import", "importEquals", "exportAll", "exportAsNamespace", "exportAssign", "exportDefault", "exportNamed"]);
const LOCAL_FORMS = new Set(["class", "enum", "typeAlias", "interface"]);

type Node = { kind: string; start: number; end: number; [key: string]: unknown };
const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && typeof (v as Node).kind === "string" && typeof (v as Node).start === "number";
const named = (n: unknown, name: string) => isNode(n) && n.kind === "ident" && n.name === name;
const memberOf = (n: unknown, object: string, names: string[]) => isNode(n) && n.kind === "member" && named(n.object, object) && names.includes(n.name as string);

// Every TypeScript file under `dir`, skipping dependencies, hidden directories and declarations.
export function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name.startsWith(".") ? [] : sources(path);
    return /\.(ts|tsx|mts)$/.test(name) && !/\.d\.(ts|mts)$/.test(name) ? [path] : [];
  });
}

export function survey(dir: string): Report {
  const files = sources(dir).sort();
  const found = new Map<string, { count: number; examples: Example[] }>();
  let lines = 0;
  for (const path of files) {
    const src = readFileSync(path, "utf8");
    const file = relative(dir, path);
    lines += src.split("\n").filter((l) => l.trim() !== "").length;
    const note = (id: string, offset: number) => {
      const entry = found.get(id) ?? { count: 0, examples: [] };
      found.set(id, entry);
      entry.count++;
      if (entry.examples.length < 3) entry.examples.push({ file, line: locate(src, offset).line, col: locate(src, offset).col });
    };
    let program: unknown[];
    try {
      program = parse(src);
    } catch (e) {
      if (!(e instanceof CompileError)) throw e;
      note("parse", e.start);
      continue;
    }
    for (const s of program) {
      if (!isNode(s)) continue;
      if (s.kind === "expr") note("G7", s.start);
      if (s.kind === "let" && s.keyword === "let") note("A4", s.start);
      walk(s, 0, note);
    }
  }
  const rules = RULES.flatMap((r) => {
    const f = found.get(r.id);
    return f ? [{ ...r, ...f }] : [];
  }).sort((a, b) => WEIGHTS[b.action] - WEIGHTS[a.action] || b.count - a.count);
  const counts: Record<Action, number> = { reject: 0, unsupported: 0, guided: 0, auto: 0 };
  for (const r of rules) counts[r.action] += r.count;
  const weighted = rules.reduce((sum, r) => sum + WEIGHTS[r.action] * r.count, 0);
  const score = lines === 0 ? 0 : Math.round((weighted * 1000) / lines * 10) / 10;
  return { files: files.length, lines, score, grade: grade(score), counts, rules };
}

function grade(score: number): string {
  return score <= 5 ? "A" : score <= 20 ? "B" : score <= 50 ? "C" : score <= 120 ? "D" : "F";
}

// Visits every node, `depth` counting the functions it sits in.
function walk(n: Node, depth: number, note: (id: string, offset: number) => void) {
  if ((n.kind === "forOf" || n.kind === "forIn") && isNode(n.left)) heads.add(n.left);
  for (const id of classify(n, depth)) note(id, n.start);
  const inner = Array.isArray(n.params) && ("body" in n) ? depth + 1 : depth;
  if (Array.isArray(n.params)) {
    for (const p of n.params as Record<string, unknown>[]) {
      if (p.default) note("defaults", (p.default as Node).start);
      if (p.rest) note("spread", p.start as number);
      if (isNode(p.pattern) && p.pattern.kind !== "ident") note("destructuring", p.pattern.start);
      if (p.optional) note("A2", p.start as number);
    }
  }
  if (Array.isArray(n.decorators)) for (const d of n.decorators) if (isNode(d)) note("decorators", d.start);
  for (const [key, value] of Object.entries(n)) {
    if (key === "start" || key === "end") continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (isNode(child)) walk(child, inner, note);
      else if (typeof child === "object" && child !== null) walkPlain(child as Record<string, unknown>, inner, note);
    }
  }
}

// A part with no kind of its own, like a parameter, a declarator or a class member list entry.
function walkPlain(o: Record<string, unknown>, depth: number, note: (id: string, offset: number) => void) {
  if (Array.isArray(o.decorators)) for (const d of o.decorators) if (isNode(d)) note("decorators", d.start);
  for (const value of Object.values(o)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      if (isNode(child)) walk(child, depth, note);
      else if (typeof child === "object" && child !== null) walkPlain(child as Record<string, unknown>, depth, note);
    }
  }
}

// The declarations heading `for...of` and `for...in` loops, which the loop assigns.
const heads = new WeakSet<Node>();

// The rules a node shows by itself.
function classify(n: Node, depth: number): string[] {
  const ids: string[] = [];
  switch (n.kind) {
    case "call": {
      const callee = n.callee as Node;
      if (named(callee, "eval")) ids.push("R1");
      if (memberOf(callee, "Object", ["defineProperty", "defineProperties", "setPrototypeOf"])) ids.push("R2");
      if (named(callee, "isNaN") || memberOf(callee, "Number", ["isNaN"])) ids.push("G8");
      if (["parseInt", "parseFloat", "Number"].some((name) => named(callee, name)) || (isNode(callee) && callee.kind === "member" && named(callee.object, "Math"))) ids.push("math");
      if (named(callee, "fetch")) ids.push("fetch");
      if (["setTimeout", "setInterval", "clearTimeout", "clearInterval"].some((name) => named(callee, name))) ids.push("timers");
      if (memberOf(callee, "console", ["error", "warn"]) || memberOf(callee, "Date", ["now"]) || memberOf(callee, "performance", ["now"])) ids.push("stderr");
      if (memberOf(callee, "JSON", ["parse", "stringify"])) ids.push("json");
      if (memberOf(callee, "Promise", ["all", "race", "allSettled", "any"])) ids.push("promiseAll");
      if (isNode(callee) && callee.kind === "member") {
        const name = callee.name as string;
        if (["call", "apply", "bind"].includes(name)) ids.push("G9");
        const [first] = n.args as Node[];
        if (name === "forEach" && isNode(first) && (first.kind === "arrow" || first.kind === "function") && first.async) ids.push("G10");
        if (ARRAY_METHODS.has(name)) ids.push("arrayMethods");
      }
      break;
    }
    case "new":
      if (named(n.callee, "Function")) ids.push("R1");
      if (["Map", "Set", "WeakMap", "WeakSet"].some((name) => named(n.callee, name))) ids.push("collections");
      break;
    case "member":
      if (n.name === "prototype") ids.push("R2");
      if (named(n.object, "process")) ids.push("process");
      break;
    case "unary":
      if (n.op === "delete") ids.push("R3");
      break;
    case "binary":
      if (n.op === "instanceof") ids.push("G5");
      if (n.op === "==" || n.op === "!=") ids.push("A3");
      break;
    case "index":
      if (isNode(n.index) && (n.index.kind === "string" || n.index.kind === "template")) ids.push("G6");
      break;
    case "ref":
      if (n.name === "any") ids.push("G1");
      if (n.name === "null" || n.name === "undefined") ids.push("A2");
      if (["Map", "Set", "ReadonlyMap", "ReadonlySet"].includes(n.name as string)) ids.push("collections");
      break;
    case "tuple":
      ids.push("tuples");
      break;
    case "let": {
      const declarations = n.declarations as { target: Node; init: unknown }[];
      if (n.keyword === "var") ids.push("A1");
      if (declarations.length > 1 || (!heads.has(n) && declarations.some((d) => !d.init))) ids.push("declarators");
      if (declarations.some((d) => d.target.kind !== "ident")) ids.push("destructuring");
      break;
    }
    case "destructure":
      ids.push("destructuring");
      break;
    case "spread":
      ids.push("spread");
      break;
    case "regex":
      ids.push("regex");
      break;
    case "tagged":
      ids.push("tagged");
      break;
    case "forIn":
      ids.push("forIn");
      break;
    case "namespace":
      ids.push("namespaces");
      break;
    case "privateName":
      ids.push("classForms");
      break;
    case "as":
      if (isNode(n.expr) && n.expr.kind === "call" && memberOf(n.expr.callee, "JSON", ["parse"])) ids.push("A8");
      break;
    case "arrow":
      if ((n.typeParams as unknown[]).length > 0) ids.push("genericMethods");
      break;
    case "method":
      if (Array.isArray(n.typeParams) && n.typeParams.length > 0) ids.push("genericMethods");
      if (Array.isArray(n.modifiers) && n.modifiers.includes("abstract")) ids.push("classForms");
      break;
    case "function":
      // A declaration carries `macro`; an expression doesn't.
      if (!("macro" in n)) ids.push("A9");
      else if (depth > 0) ids.push("nestedFunctions");
      break;
    case "property":
    case "field":
      if (n.optional === true) ids.push("A2");
      if (typeof n.name === "string" && n.name.startsWith("#")) ids.push("classForms");
      break;
  }
  if (MODULE_FORMS.has(n.kind)) ids.push("modules");
  if (LOCAL_FORMS.has(n.kind) && depth > 0) ids.push("localDeclarations");
  // A class's base is one expression; an interface's are a list, which Fish keeps.
  if ("members" in n && isNode(n.extends)) ids.push("G4");
  if (n.abstract === true && "members" in n) ids.push("classForms");
  return [...new Set(ids)];
}

// The report as text: what was read, the grade, then the rules that cost most.
export function formatReport(r: Report): string {
  const top = (action: (a: Action) => boolean) => r.rules.filter((x) => action(x.action)).slice(0, 10)
    .map((x) => `  ${String(x.count).padStart(5)}  ${x.title}\n         e.g. ${x.examples[0]!.file}:${x.examples[0]!.line}:${x.examples[0]!.col}`);
  const blockers = top((a) => a === "reject" || a === "unsupported");
  const guided = top((a) => a === "guided");
  return [
    `fishc survey: ${r.files} file${r.files === 1 ? "" : "s"}, ${r.lines} line${r.lines === 1 ? "" : "s"}`,
    `grade ${r.grade} (score ${r.score} per 1000 lines)`,
    `  blockers: ${r.counts.reject + r.counts.unsupported} (rejected ${r.counts.reject}, not supported yet ${r.counts.unsupported})`,
    `  guided:   ${r.counts.guided}`,
    `  auto-fix: ${r.counts.auto}`,
    ...(blockers.length ? ["", "top blockers", ...blockers] : []),
    ...(guided.length ? ["", "top guided rewrites", ...guided] : []),
  ].join("\n");
}
