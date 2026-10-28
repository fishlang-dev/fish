import { CompileError } from "./diag.ts";
import type { Edition } from "./manifest.ts";

// Migrating TypeScript into Fish: the edition a file is in, and the rules that find what a
// TS-compat file has to change before it compiles as native Fish.

// The edition a file's directive names, and where the directive is, or undefined without one. The
// directive is the file's first line, or its second after a shebang.
export function directive(src: string): { edition: Edition; start: number; end: number } | undefined {
  const shebang = src.startsWith("#!");
  const start = shebang ? src.indexOf("\n") + 1 : 0;
  if (shebang && start === 0) return undefined;
  const newline = src.indexOf("\n", start);
  const line = src.slice(start, newline < 0 ? src.length : newline).replace(/\r$/, "");
  if (!/^\/\/\s*@fish-edition(?=\s|$)/.test(line)) return undefined;
  const end = start + line.length;
  const edition = /^\/\/ @fish-edition (native|ts-compat)$/.exec(line)?.[1] as Edition | undefined;
  if (!edition) throw new CompileError("an edition directive is written '// @fish-edition native' or '// @fish-edition ts-compat'", start, end);
  return { edition, start, end };
}

// Refuses a file in the TS-compat edition, by its directive or else its package's, at the
// directive or the file's first line.
export function refuseCompat(src: string, packaged: Edition | undefined) {
  const declared = directive(src);
  if ((declared?.edition ?? packaged) !== "ts-compat") return;
  const newline = src.indexOf("\n");
  const at = declared ?? { start: 0, end: Math.max(newline < 0 ? src.length : newline, 1) };
  throw new CompileError("this file is in the TS-compat edition, which Fish doesn't compile; run 'fishc lint' to find what to change, then mark it '// @fish-edition native'", at.start, at.end);
}

// A construct a migration rule finds, by the rule's id, over a file's text.
export type Hit = { rule: string; start: number; end: number };

// What each reject rule asks for instead, as `fishc lint` says it.
export const REJECTS: Record<string, string> = {
  R1: "eval and new Function run code made while the program runs, and a native binary has no compiler for it; write the code itself, or choose among functions with a Map or a switch",
  R2: "prototype edits and Object.defineProperty change a type after it is declared, and Fish types have fixed layouts; declare the field or method on the class, or wrap the value",
  R3: "delete removes a field, and Fish objects have fixed layouts; make the field an Option and set it to null, or keep the entries in a Map",
  R5: "the arguments object isn't in Fish; take the arguments as a rest parameter, as in '...args: T[]'",
  R6: "Symbol is runtime reflection, which Fish doesn't have; use a string or an enum for a key, and an interface for a protocol",
  R7: "declaration merging and module augmentation reopen a type after it is declared, and Fish types are closed; give everything in one declaration, or a new name",
};

export type Node = { kind: string; start: number; end: number; [key: string]: unknown };
export const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && typeof (v as Node).kind === "string" && typeof (v as Node).start === "number";
export const named = (n: unknown, name: string) => isNode(n) && n.kind === "ident" && n.name === name;
const OWN_MEMBERS = new Set(["field", "method", "get", "set"]);
const MERGING = new Set(["function", "class", "interface", "namespace", "enum"]);

// The reject rules' hits in a file's tree, in no particular order. The walk keeps its own stack,
// so a deeply nested file can't overflow the call stack.
export function rejects(program: unknown[]): Hit[] {
  const nodes = everyNode(program);
  const declared = declaredNames(nodes);
  // A class with its own member named `prototype` reads it as a field, not the JS prototype.
  const ownPrototype = new Set(nodes.flatMap((n) => (n.kind === "class" && typeof n.name === "string" && (n.members as Node[]).some((m) => OWN_MEMBERS.has(m.kind) && m.name === "prototype") ? [n.name] : [])));
  const hits: Hit[] = [];
  const hit = (rule: string, start: number, end: number) => hits.push({ rule, start, end });
  for (const n of nodes) {
    const callee = n.callee as Node | undefined;
    if (n.kind === "call" && (named(callee, "eval") || named(callee, "Function"))) hit("R1", callee!.start, callee!.end);
    if (n.kind === "new" && named(callee, "Function")) hit("R1", n.start, callee!.end);
    if (n.kind === "member" && n.name === "prototype" && !(isNode(n.object) && n.object.kind === "ident" && ownPrototype.has(n.object.name as string))) hit("R2", n.start, n.end);
    if (n.kind === "call" && isNode(callee) && callee.kind === "member" && named(callee.object, "Object") && ["defineProperty", "defineProperties", "setPrototypeOf"].includes(callee.name as string)) {
      hit("R2", callee.end - String(callee.name).length, callee.end);
    }
    if (n.kind === "unary" && n.op === "delete") hit("R3", n.start, n.end);
    const use = n.kind === "ident" || n.kind === "shorthand" || n.kind === "ref" ? (n.name as string) : undefined;
    if (use === "arguments" && n.kind !== "ref" && !declared.has(use)) hit("R5", n.start, n.end);
    if (use === "Symbol" && !declared.has(use)) hit("R6", n.start, n.end);
    if (n.kind === "namespace" && (n.quoted === true || n.global === true)) hit("R7", n.start, n.end);
  }
  for (const list of [program, ...nodes.flatMap((n) => Object.values(n).filter(Array.isArray))]) merged(list, hit);
  return hits;
}

// Every node of a tree, without recursion.
function everyNode(program: unknown[]): Node[] {
  const found: Node[] = [];
  const stack: unknown[] = [program];
  while (stack.length > 0) {
    const v = stack.pop();
    // One push per element: spreading a huge array into push overflows the call stack.
    if (Array.isArray(v)) for (const x of v) stack.push(x);
    else if (typeof v === "object" && v !== null) {
      if (isNode(v)) found.push(v);
      for (const [key, child] of Object.entries(v)) if (key !== "start" && key !== "end" && typeof child === "object") stack.push(child);
    }
  }
  return found;
}

// Each name the file binds, anywhere: a declaration, a parameter, a caught error or an import.
function declaredNames(nodes: Node[]): Set<string> {
  const names = new Set<string>();
  const bind = (pattern: unknown) => {
    for (const p of everyNode([pattern])) if (p.kind === "ident" || p.kind === "shorthand") names.add(p.name as string);
  };
  for (const n of nodes) {
    if (n.kind === "let") for (const d of n.declarations as { target: unknown }[]) bind(d.target);
    if (MERGING.has(n.kind) || n.kind === "typeAlias") if (typeof n.name === "string") names.add(n.name);
    if (Array.isArray(n.params)) for (const p of n.params as { pattern?: unknown }[]) bind(p.pattern);
    if (Array.isArray(n.typeParams)) for (const p of n.typeParams as { name: string }[]) names.add(p.name);
    if (n.kind === "try") bind(n.param);
    if (n.kind === "import") {
      for (const name of [n.default, n.namespace]) if (typeof name === "string") names.add(name);
      for (const sp of (n.named ?? []) as { name: string; alias?: string }[]) names.add(sp.alias ?? sp.name);
    }
  }
  return names;
}

// The declarations in one list of statements that TypeScript would merge with an earlier one of
// the same name, each a hit.
function merged(list: unknown[], hit: (rule: string, start: number, end: number) => void) {
  const seen = new Map<string, string[]>();
  for (const s of list) {
    const d = isNode(s) && (s.kind === "export" || s.kind === "declare") && isNode(s.body) ? s.body : isNode(s) && s.kind === "exportDefault" && isNode(s.declaration) ? s.declaration : s;
    if (!isNode(s) || !isNode(d) || !MERGING.has(d.kind) || typeof d.name !== "string" || d.quoted === true || d.global === true) continue;
    const before = seen.get(d.name) ?? [];
    if (before.some((kind) => merges(kind, d.kind))) hit("R7", s.start, s.end);
    seen.set(d.name, [...before, d.kind]);
  }
}

function merges(a: string, b: string): boolean {
  if (a === b) return a === "interface" || a === "namespace" || a === "enum";
  const pair = new Set([a, b]);
  if (pair.has("enum")) return pair.has("namespace");
  const value = (k: string) => k === "class" || k === "function";
  const open = (k: string) => k === "interface" || k === "namespace";
  return (value(a) && open(b)) || (open(a) && value(b));
}
