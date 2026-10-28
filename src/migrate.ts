import { CompileError } from "./diag.ts";
import { isToken, type Comment, type Token } from "./lexer.ts";
import type { Edition } from "./manifest.ts";
import { parseWithComments } from "./parser.ts";

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

// A construct a migration rule finds, by the rule's id, over a file's text. An auto rule's hit
// carries the edits that fix it, applied together or not at all, and says what they change.
export type Action = "auto" | "guided" | "reject";
export type Edit = { start: number; end: number; text: string };
export type Hit = { rule: string; action: Action; start: number; end: number; edits?: Edit[]; message?: string };

// The comment the lint leaves after each ownership type it inserts, for a person to confirm.
export const MARKER = "/* fish: review */";

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

// Applies the auto rules' edits to `src` in rounds: each round takes the hits whose edits overlap
// none taken before them, and the next round finds what is left, up to five rounds. `fsh` says
// whether a relative `.ts` import's `.fsh` file is there, or will be. Gives the text and how many
// hits were fixed. Throws a CompileError when `src` doesn't parse, or when the fixes give text
// that doesn't, which would be the lint's mistake.
export function fix(src: string, fsh?: Imported): { text: string; fixed: number } {
  let [text, fixed, edited] = [src, 0, false];
  for (let round = 0; round < 5; round++) {
    const fixable = migrations(parseWithComments(text), text, fsh).filter((h) => (h.edits ?? []).length > 0).sort((a, b) => a.start - b.start);
    const taken: Edit[] = [];
    let count = 0;
    for (const { edits } of fixable) {
      if (edits!.some((e) => taken.some((t) => overlaps(e, t)))) continue;
      taken.push(...edits!);
      count++;
    }
    edited = count > 0;
    if (!edited) break;
    // Edits at one place apply in the order their hit gave them.
    for (const e of taken.map((e, i) => ({ e, i })).sort((a, b) => b.e.start - a.e.start || b.i - a.i)) text = text.slice(0, e.e.start) + e.e.text + text.slice(e.e.end);
    fixed += count;
  }
  if (edited) parseWithComments(text);
  return { text, fixed };
}

// Two edits over the same text, or one inside the other's, can't both apply in one round; nor
// can two inserted at one place by different hits.
const overlaps = (a: Edit, b: Edit) => (a.start === b.start && (a.start === a.end || b.start === b.end)) || (a.start < b.end && b.start < a.end);

export type Parsed = { program: unknown[]; comments: Comment[]; tokens: Token[] };
// What a relative `.ts` import's target is to become: renamed to `.fsh` when that file is there or
// will be, ambiguous when both the `.ts` and the `.fsh` file are there, or nothing to change.
export type Imported = (specifier: string) => "rename" | "ambiguous" | undefined;

// Every migration rule's hits in a parsed file, in no particular order: the reject rules, the auto
// rules with their edits, and the review markers among its comments. An edit that would delete a
// comment is dropped, its hit reported but not fixed. `fsh` is as for `fix`.
export function migrations(parsed: Parsed, src: string, fsh: Imported = () => "rename"): Hit[] {
  const nodes = everyNode(parsed.program);
  const file: File = { src, tokens: parsed.tokens, nodes, up: parents(parsed.program), bound: bindings(nodes), ...byName(nodes) };
  const hits = [...rejects(parsed.program, nodes), ...autoFixes(parsed.program, file, fsh), ...markers(src, parsed.comments)];
  for (const h of hits) {
    if (!h.edits?.some((e) => parsed.comments.some((c) => c.start >= e.start && c.end <= e.end))) continue;
    delete h.edits;
    h.message = `a comment sits where this change would go, so it can't be made automatically; make it by hand: ${h.message}`;
  }
  return hits;
}

// The hits `fishc survey` counts: the reject rules, and A1, A3 and A8 wherever they occur, fixable
// or not, without working out any edits.
export function surveyHits(program: unknown[]): Hit[] {
  const nodes = everyNode(program);
  const ambient = new Set(nodes.filter((n) => n.kind === "declare").flatMap((n) => everyNode([n.body])));
  const hits = rejects(program, nodes);
  const at = (rule: string, n: Node) => hits.push({ rule, action: "auto", start: n.start, end: n.end });
  for (const n of nodes) {
    if (n.kind === "let" && n.keyword === "var" && !ambient.has(n)) at("A1", n);
    if (n.kind === "binary" && (n.op === "==" || n.op === "!=")) at("A3", n);
    if (jsonCast(n)) at("A8", n);
  }
  return hits;
}

// The reject rules' hits in a file's tree, in no particular order. The walk keeps its own stack,
// so a deeply nested file can't overflow the call stack.
export function rejects(program: unknown[], nodes = everyNode(program)): Hit[] {
  const declared = bindings(nodes);
  // A class with its own member named `prototype` reads it as a field, not the JS prototype.
  const ownPrototype = new Set(nodes.flatMap((n) => (n.kind === "class" && typeof n.name === "string" && (n.members as Node[]).some((m) => OWN_MEMBERS.has(m.kind) && m.name === "prototype") ? [n.name] : [])));
  const hits: Hit[] = [];
  const hit = (rule: string, start: number, end: number) => hits.push({ rule, action: "reject", start, end });
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

function byName(nodes: Node[]): { idents: Map<string, Node[]>; lets: Map<string, Node[]>; calls: Map<string, Node[]> } {
  const [idents, lets, calls] = [new Map<string, Node[]>(), new Map<string, Node[]>(), new Map<string, Node[]>()];
  const add = (map: Map<string, Node[]>, name: string, n: Node) => {
    const list = map.get(name);
    if (list) list.push(n);
    else map.set(name, [n]);
  };
  for (const n of nodes) {
    if (n.kind === "ident") add(idents, n.name as string, n);
    if (n.kind === "call" && isNode(n.callee) && n.callee.kind === "ident") add(calls, n.callee.name as string, n);
    if (n.kind === "let") for (const t of declarationsOf(n)) for (const x of everyNode([t])) if (x.kind === "ident") add(lets, x.name as string, n);
    // A function or class declared by name is a declaration of that name too.
    if (((n.kind === "function" && "macro" in n) || n.kind === "class") && typeof n.name === "string") add(lets, n.name, n);
  }
  for (const map of [idents, lets, calls]) for (const list of map.values()) list.sort((a, b) => a.start - b.start);
  return { idents, lets, calls };
}

// How many times the file binds each name, anywhere: a declaration, a parameter, a caught error or
// an import.
function bindings(nodes: Node[]): Map<string, number> {
  const names = new Map<string, number>();
  const add = (name: string) => names.set(name, (names.get(name) ?? 0) + 1);
  const bind = (pattern: unknown) => {
    for (const p of everyNode([pattern])) if (p.kind === "ident" || p.kind === "shorthand") add(p.name as string);
  };
  for (const n of nodes) {
    if (n.kind === "let") for (const d of n.declarations as { target: unknown }[]) bind(d.target);
    if (MERGING.has(n.kind) || n.kind === "typeAlias") if (typeof n.name === "string") add(n.name);
    if (Array.isArray(n.params)) for (const p of n.params as { pattern?: unknown }[]) bind(p.pattern);
    if (Array.isArray(n.typeParams)) for (const p of n.typeParams as { name: string }[]) add(p.name);
    if (n.kind === "try") bind(n.param);
    if (n.kind === "import") {
      for (const name of [n.default, n.namespace]) if (typeof name === "string") add(name);
      for (const sp of (n.named ?? []) as { name: string; alias?: string }[]) add(sp.alias ?? sp.name);
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


type Param = { pattern: Node; type?: Node; default?: Node; optional: boolean; rest: boolean; start: number; end: number };
// What holds each object of a tree: the object, never an array, and the key it sits under.
type Up = { holder: Record<string, unknown>; key: string; listed: boolean };
// A file as the auto rules read it: its text and tokens, its nodes, what holds each, and how many
// times it binds each name.
// `idents`, `lets` and `calls` are the file's identifiers, its declarations of variables, functions
// and classes, and its calls of a name, by the name, each list in source order.
type File = { src: string; tokens: Token[]; nodes: Node[]; up: Map<object, Up>; bound: Map<string, number>; idents: Map<string, Node[]>; lets: Map<string, Node[]>; calls: Map<string, Node[]> };
type Span = { start: number; end: number };

const PRIMITIVES = new Set(["number", "string", "boolean", "bigint", "symbol", "any", "unknown", "never", "void", "null", "undefined", "object", "i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64", "f32", "f64", "isize", "usize"]);
const MUTATORS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin", "set", "delete", "clear", "add"]);
const LOOPS = new Set(["for", "forIn", "forOf", "while", "doWhile"]);
const nullish = (t: Node) => t.kind === "ref" && (t.name === "null" || t.name === "undefined");
const isFunction = (n: Node) => n.kind === "function" || n.kind === "arrow" || n.kind === "method" || n.kind === "get" || n.kind === "set" || n.kind === "constructor";
const jsonCast = (n: Node) => n.kind === "as" && isNode(n.expr) && n.expr.kind === "call" && isNode(n.expr.callee) && n.expr.callee.kind === "member" && named(n.expr.callee.object, "JSON") && n.expr.callee.name === "parse";

function parents(program: unknown[]): Map<object, Up> {
  const up = new Map<object, Up>();
  const stack: [unknown, Up | undefined][] = [[program, undefined]];
  while (stack.length > 0) {
    const [v, at] = stack.pop()!;
    if (Array.isArray(v)) {
      for (const x of v) stack.push([x, at && { ...at, listed: true }]);
    } else if (typeof v === "object" && v !== null) {
      if (at) up.set(v, at);
      for (const [key, child] of Object.entries(v)) if (key !== "start" && key !== "end" && typeof child === "object") stack.push([child, { holder: v as Record<string, unknown>, key, listed: false }]);
    }
  }
  return up;
}

// The index of the first token starting at or after `at`.
function tokenAt(f: File, at: number): number {
  let [lo, hi] = [0, f.tokens.length];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (f.tokens[mid]!.start < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// The first token at or after `at`, and the last one ending at or before it.
const next = (f: File, at: number) => f.tokens[tokenAt(f, at)];
const previous = (f: File, at: number) => {
  let i = tokenAt(f, at) - 1;
  while (i >= 0 && f.tokens[i]!.end > at) i--;
  return f.tokens[i];
};

// A type's span, taken on past the `)` tokens its own tokens leave open: a parenthesized type's
// span stops short of its closing parenthesis.
function closed(f: File, start: number, end: number): Span {
  let open = 0;
  let i = tokenAt(f, start);
  for (; i < f.tokens.length && f.tokens[i]!.start < end; i++) open += isToken(f.tokens[i]!, "(") ? 1 : isToken(f.tokens[i]!, ")") ? -1 : 0;
  for (; open > 0 && i < f.tokens.length && isToken(f.tokens[i]!, ")"); i++, open--) end = f.tokens[i]!.end;
  return { start, end };
}

// The span of the type written after the `:` that follows `from`, or undefined when no `:` does.
function annotation(f: File, from: number, type: Node): { colon: Token; type: Span } | undefined {
  const colon = previous(f, type.start);
  if (!colon || colon.start < from) return undefined;
  // A parenthesized type's own span starts inside its parentheses, so its first token is the one
  // after the `:`.
  let i = tokenAt(f, from);
  while (i < f.tokens.length && f.tokens[i]!.start < type.start && !isToken(f.tokens[i]!, ":")) i++;
  const at = f.tokens[i];
  const first = f.tokens[i + 1];
  if (!at || !first || !isToken(at, ":")) return undefined;
  return { colon: at, type: closed(f, first.start, type.end) };
}

const text = (f: File, s: Span) => f.src.slice(s.start, s.end);

// The auto rules' hits, each with its edits when the fix is certain from the source alone.
function autoFixes(program: unknown[], f: File, fsh: Imported): Hit[] {
  const hits: Hit[] = [];
  const auto = (rule: string, at: Span, message: string, edits?: Edit[]) => hits.push({ rule, action: "auto", start: at.start, end: at.end, message, ...(edits && { edits }) });
  const ambient = new Set(f.nodes.filter((n) => n.kind === "declare").flatMap((n) => everyNode([n.body])));
  const assigned = assignedNames(f.nodes);
  const literals = literalKinds(f, assigned);
  const objects = objectTypes(f.nodes);
  const changes = changed(f);
  for (const n of f.nodes) {
    if (n.kind === "let" && n.keyword === "var" && !ambient.has(n)) hits.push(varHit(f, n, assigned));
    if (n.kind === "binary" && (n.op === "==" || n.op === "!=")) {
      const [left, right] = [evident(n.left as Node, literals), evident(n.right as Node, literals)];
      let i = tokenAt(f, (n.left as Node).end);
      while (i < f.tokens.length && !isToken(f.tokens[i]!, n.op as string) && f.tokens[i]!.start < (n.right as Node).start) i++;
      const op = f.tokens[i];
      if (left !== undefined && left === right && op && isToken(op, n.op as string)) auto("A3", n, `'${n.op}' becomes '${n.op}=', as both sides are ${left === "boolean" ? "booleans" : `${left}s`}`, [{ start: op.end, end: op.end, text: "=" }]);
      else hits.push({ rule: "A3", action: "guided", start: n.start, end: n.end, message: `'${n.op}' converts between types, which Fish doesn't; compare with '${n.op}=' once both sides have the same type` });
    }
    if (jsonCast(n)) {
      const call = n.expr as Node;
      const callee = call.callee as Node;
      const as = next(f, call.end);
      const type = as && isToken(as, "as") && next(f, as.end);
      const span = type && closed(f, type.start, (n.type as Node).end);
      // `as const` names no type.
      const edits = span && (call.typeArgs as unknown[]).length === 0 && text(f, span) !== "const" ? [{ start: callee.end, end: callee.end, text: `<${text(f, span)}>` }, { start: call.end, end: span.end, text: "" }] : undefined;
      auto("A8", n, "'JSON.parse(s) as T' becomes 'JSON.parse<T>(s)', which checks the value as it parses it", edits);
    }
    if (n.kind === "function" && !("macro" in n) && Array.isArray(n.body)) {
      const edits = arrowEdits(f, n);
      if (edits) auto("A9", { start: n.start, end: edits[0]!.end }, "the function expression becomes an arrow function, as it doesn't use its own 'this'", edits);
    }
    if ((n.kind === "import" || n.kind === "exportAll" || n.kind === "exportNamed") && typeof n.module === "string" && /^\.\.?\/.*\.ts$/.test(n.module) && !n.module.endsWith(".d.ts") && !n.attributes) {
      const specifier = previous(f, n.end);
      const literal = specifier?.kind === "string" ? specifier : previous(f, specifier?.start ?? 0);
      const target = fsh(n.module);
      const fshName = `${n.module.slice(0, -3)}.fsh`;
      if (target && literal?.kind === "string" && literal.start >= n.start && f.src.slice(literal.start + 1, literal.end - 1) === n.module) {
        if (target === "rename") auto("A10", literal, `'${n.module}' becomes '${fshName}', the file's Fish name`, [{ start: literal.end - 4, end: literal.end - 1, text: ".fsh" }]);
        else hits.push({ rule: "A10", action: "guided", start: literal.start, end: literal.end, message: `both '${n.module}' and '${fshName}' are there, so which this imports is yours to choose` });
      }
    }
    if (n.kind === "union") {
      const hit = optionHit(f, n);
      if (hit) hits.push(hit);
    }
    const optionals: { start: number; type?: Node }[] = [...(Array.isArray(n.params) ? (n.params as Param[]).filter((p) => p.optional) : []), ...((n.kind === "property" || n.kind === "field") && n.optional === true ? [n] : [])];
    for (const p of optionals) {
      if (!isNode(p.type)) continue;
      const written = annotation(f, p.start, p.type);
      const question = written && previous(f, written.colon.start);
      if (!written || !question || !isToken(question, "?")) continue;
      const wrapped = (p.type.kind === "union" && (p.type.types as Node[]).some(nullish)) || (p.type.kind === "ref" && p.type.name === "Option");
      const type = text(f, written.type);
      const edits = [{ start: question.start, end: question.end, text: "" }, ...(wrapped ? [] : [{ start: written.type.start, end: written.type.start, text: "Option<" }, { start: written.type.end, end: written.type.end, text: ">" }])];
      auto("A2", { start: question.start, end: written.type.end }, wrapped ? "the '?' goes, as the type's Option says it may be absent" : `the optional '?: ${type}' becomes ': Option<${type}>'`, edits);
    }
    if (isFunction(n) && n.kind !== "constructor" && Array.isArray(n.params) && n.body !== undefined) hits.push(...ownership(f, n, objects, changes.params.get(n)));
    // A class's method has modifiers; an object literal's doesn't, and its `this` is the object.
    if (n.kind === "method" && changes.methods.has(n) && !(n.params as Param[]).some((p) => named(p.pattern, "this"))) {
      const hit = receiver(f, n);
      if (hit) hits.push(hit);
    }
  }
  hits.push(...counters(program, f));
  return hits;
}

// A1: a `var` becomes `const` when nothing assigns it again, else `let`, but only where `var`'s
// function scoping can't matter; anywhere else it is guided, saying why.
function varHit(f: File, n: Node, assigned: Set<string>): Hit {
  const declarations = n.declarations as { target: Node; init?: Node }[];
  const names = declarations.flatMap((d) => everyNode([d.target]).filter((x) => x.kind === "ident").map((x) => x.name as string));
  const why = varScoping(f, n, new Set(names));
  const at = { start: n.start, end: n.start + 3 };
  if (why) return { rule: "A1", action: "guided", ...at, message: `'var' belongs to the whole function, and here that matters: ${why}; rename or move it, then use 'let' or 'const'` };
  const reassigned = declarations.some((d) => !d.init) || names.some((name) => assigned.has(name));
  const keyword = reassigned ? "let" : "const";
  return { rule: "A1", action: "auto", ...at, message: `'var' becomes '${keyword}', as ${reassigned ? "it is assigned after its declaration" : "nothing assigns it again"}`, edits: [{ ...at, text: keyword }] };
}

// Why a `var` can't simply become block scoped, or undefined when it can: declared again in its
// function, used outside its block or before its declaration, or in a loop, where a `let` is a
// new variable each turn, with a value that carries over or a closure capturing it.
function varScoping(f: File, n: Node, names: Set<string>): string | undefined {
  const chain = ancestors(f, n);
  const fn = chain.find(isFunction);
  const scope: Span = fn ?? { start: 0, end: f.src.length };
  const held = f.up.get(n);
  // A `let` in a loop's head belongs to the loop; one in a list of statements, to that list, which
  // a `try` or a loop's body is without a node of its own.
  const list = held?.listed ? (held.holder[held.key] as Node[]) : undefined;
  const region: Span = list ? { start: list[0]!.start, end: list.at(-1)!.end } : held && isNode(held.holder) ? held.holder : scope;
  const within = (x: Span, s: Span) => x.start >= s.start && x.end <= s.end;
  // The functions between a node and the var's function, innermost first.
  const between = (x: Node) => {
    const found: Node[] = [];
    for (const a of ancestors(f, x)) {
      if (a === fn) break;
      if (isFunction(a)) found.push(a);
    }
    return found;
  };
  const binds = (pattern: unknown) => everyNode([pattern]).some((y) => y.kind === "ident" && names.has(y.name as string));
  // A declared function's own name belongs to the scope holding it, not to its body.
  const declaredAgain = [...names].some((name) => inside(f.lets.get(name), scope).some((x) => x !== n && x !== fn && ancestors(f, x).find(isFunction) === fn));
  if (declaredAgain || ((fn?.params ?? []) as Param[]).some((p) => binds(p.pattern))) return "it is declared again in the same function";
  const targets = declarationsOf(n);
  const uses = [...names].flatMap((name) => inside(f.idents.get(name), scope)).filter((x) => !targets.some((t) => within(x, t)));
  if (uses.some((x) => !within(x, region))) return "it is used outside the block it is declared in";
  if (uses.some((x) => x.start < n.start)) return "it is used before its declaration";
  // A function declared in the scope runs wherever it is called, even before the declaration.
  for (const use of uses) {
    for (const g of between(use)) {
      if (g.kind === "function" && "macro" in g && typeof g.name === "string" && inside(f.calls.get(g.name), scope).some((c) => c.start < n.start)) return "a function using it is called before its declaration";
    }
  }
  const loops = chain.slice(0, fn ? chain.indexOf(fn) : chain.length).filter((x) => LOOPS.has(x.kind));
  if (loops.length === 0) return undefined;
  const declarators = n.declarations as { init?: Node }[];
  if (declarators.some((d) => !d.init || everyNode([d.init]).some((x) => x.kind === "ident" && names.has(x.name as string)))) return "its value carries from one turn of the loop to the next";
  if (uses.some((x) => between(x).some((g) => loops.some((l) => within(g, l))))) return "a closure in the loop captures it";
  return undefined;
}

// The nodes of `list`, sorted by where they start, that lie within `span`, found by binary search
// so a check per declaration stays cheap in a large file.
function inside(list: Node[] = [], span: Span): Node[] {
  let [lo, hi] = [0, list.length];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.start < span.start) lo = mid + 1;
    else hi = mid;
  }
  const found: Node[] = [];
  for (let i = lo; i < list.length && list[i]!.start < span.end; i++) if (list[i]!.end <= span.end) found.push(list[i]!);
  return found;
}

// The nodes holding `n`, innermost first.
function ancestors(f: File, n: object): Node[] {
  const found: Node[] = [];
  for (let at = f.up.get(n); at; at = f.up.get(at.holder)) if (isNode(at.holder)) found.push(at.holder);
  return found;
}

const declarationsOf = (n: Node) => (n.declarations as { target: Node }[]).map((d) => d.target);

// A2: a union holding `null` or `undefined` becomes an Option of its other members. Members are
// told apart by the `|` tokens between them, since a parenthesized member's span starts inside
// its parentheses.
function optionHit(f: File, n: Node): Hit | undefined {
  const types = n.types as Node[];
  if (!types.some(nullish) || types.every(nullish)) return undefined;
  const whole = closed(f, n.start, n.end);
  const spans = types.map((t, i): Span => {
    // Between a member and the `|` before it there can only be its own opening parentheses.
    let pipe = previous(f, t.start);
    while (pipe && isToken(pipe, "(")) pipe = previous(f, pipe.start);
    const lead = next(f, whole.start)!;
    const start = i > 0 ? next(f, pipe!.end)!.start : isToken(lead, "|") ? next(f, lead.end)!.start : whole.start;
    return { start, end: i === types.length - 1 ? whole.end : closed(f, start, t.end).end };
  });
  const kept = spans.filter((_, i) => !nullish(types[i]!));
  const [first, last] = [kept[0]!, kept.at(-1)!];
  const edits: Edit[] = [{ start: whole.start, end: first.start, text: "Option<" }];
  // A nullish member between two kept ones goes with the space and `|` before it.
  types.forEach((t, i) => {
    if (nullish(t) && spans[i]!.start > first.start && spans[i]!.end < last.end) edits.push({ start: spans[i - 1]!.end, end: spans[i]!.end, text: "" });
  });
  edits.push({ start: last.end, end: whole.end, text: ">" });
  const option = `Option<${kept.map((s) => text(f, s)).join(" | ")}>`;
  return { rule: "A2", action: "auto", ...whole, message: `'${text(f, whole)}' becomes '${option}'`, edits };
}

// The names something assigns after their declaration: by `=` and its compound forms, `++` and
// `--`, a destructuring assignment, or a loop head that isn't a declaration.
function assignedNames(nodes: Node[]): Set<string> {
  const names = new Set<string>();
  const add = (target: unknown) => {
    if (isNode(target) && target.kind === "ident") names.add(target.name as string);
  };
  for (const n of nodes) {
    if (n.kind === "assign") add(n.target);
    if (n.kind === "update") add(n.operand);
    if (n.kind === "destructure") for (const x of everyNode([n.pattern])) add(x);
    if (n.kind === "forOf" || n.kind === "forIn") add(n.left);
  }
  return names;
}

// The kind of literal each name is declared with, for a name the file binds once, without a
// type written, as a `const` or as a variable nothing assigns again.
function literalKinds(f: File, assigned: Set<string>): Map<string, string> {
  const kinds = new Map<string, string>();
  for (const n of f.nodes) {
    if (n.kind !== "let") continue;
    for (const d of n.declarations as { target: Node; init?: Node; type?: Node }[]) {
      const name = d.target.kind === "ident" ? (d.target.name as string) : undefined;
      if (!name || d.type || !d.init || f.bound.get(name) !== 1 || (n.keyword !== "const" && assigned.has(name))) continue;
      const kind = literalKind(d.init);
      if (kind) kinds.set(name, kind);
    }
  }
  return kinds;
}

function literalKind(e: Node): string | undefined {
  if (e.kind === "int" || e.kind === "float" || (e.kind === "unary" && e.op === "-" && isNode(e.operand) && (e.operand.kind === "int" || e.operand.kind === "float"))) return "number";
  if (e.kind === "string" || (e.kind === "template" && (e.exprs as unknown[]).length === 0)) return "string";
  if (e.kind === "bool") return "boolean";
  return undefined;
}

// The type of an operand when the source shows it: a literal, `typeof x`, `.length`, or a name
// declared with a literal.
function evident(e: Node, literals: Map<string, string>): string | undefined {
  if (e.kind === "unary" && e.op === "typeof") return "string";
  if (e.kind === "member" && e.name === "length") return "number";
  if (e.kind === "ident") return literals.get(e.name as string);
  return literalKind(e);
}

// Whether a function expression sits where an arrow function means the same and parses: an
// argument, a variable's initializer, an assignment's value, a return value, a property's value
// or an array's element. As an operand, a callee or an object, an arrow would read otherwise.
function arrowSlot(f: File, n: Node): boolean {
  const at = f.up.get(n);
  if (!at) return false;
  const { holder, key } = at;
  return ((holder.kind === "call" || holder.kind === "new") && key === "args") || (key === "init" && "target" in holder && !("kind" in holder)) || ((holder.kind === "assign" || holder.kind === "return" || holder.kind === "property") && key === "value") || (holder.kind === "array" && key === "elements");
}

// A9: a function expression's edits into an arrow function: `function` and an unused name dropped,
// and `=>` before its body. None when it uses its own `this`, `arguments` or `new.target`, is a
// generator, calls itself by name, is constructed or given a prototype under the name it is
// bound to, or sits where an arrow function would read otherwise.
function arrowEdits(f: File, n: Node): Edit[] | undefined {
  if (n.generator === true || !arrowSlot(f, n)) return undefined;
  const inner = everyNode([n.params, n.body]);
  const own = (x: Node) => x.kind === "this" || x.kind === "super" || (x.kind === "meta" && x.name === "new.target") || (x.kind === "ident" && (x.name === "arguments" || x.name === "this" || (typeof n.name === "string" && x.name === n.name)));
  if (inner.some(own)) return undefined;
  const at = f.up.get(n)!;
  const bound = at.key === "init" ? (at.holder.target as Node) : at.holder.kind === "assign" ? (at.holder.target as Node) : undefined;
  // A function held by an object's property and constructed through it, as `new o.f()`, too.
  if (at.holder.kind === "property" && typeof at.holder.key === "string" && f.nodes.some((x) => x.kind === "new" && isNode(x.callee) && x.callee.kind === "member" && x.callee.name === at.holder.key)) return undefined;
  if (bound?.kind === "ident" && f.nodes.some((x) => (x.kind === "new" && named(x.callee, bound.name as string)) || (x.kind === "member" && x.name === "prototype" && named(x.object, bound.name as string)))) return undefined;
  let i = tokenAt(f, n.start);
  while (i < f.tokens.length && !isToken(f.tokens[i]!, "function")) i++;
  const keyword = f.tokens[i];
  const last = typeof n.name === "string" ? f.tokens[i + 1] : keyword;
  // The body's `{` is the one matching the `}` that ends the function.
  let j = tokenAt(f, n.end) - 1;
  for (let depth = 0; j >= 0; j--) {
    depth += isToken(f.tokens[j]!, "}") ? 1 : isToken(f.tokens[j]!, "{") ? -1 : 0;
    if (depth === 0) break;
  }
  const brace = f.tokens[j];
  if (!keyword || !last || !brace || !isToken(brace, "{")) return undefined;
  let cut = last.end;
  // After `return`, a line break left where `function` was would end the statement there, so the
  // deletion runs on through it; a comment in the way stops the fix.
  const returned = at.holder.kind === "return";
  while (f.src[cut] === " " || f.src[cut] === "\t" || (returned && /\s/.test(f.src[cut] ?? ""))) cut++;
  if (returned && cut !== f.tokens[i + (typeof n.name === "string" ? 2 : 1)]?.start) return undefined;
  return [{ start: keyword.start, end: cut, text: "" }, { start: brace.start, end: brace.start, text: /\s/.test(f.src[brace.start - 1] ?? "") ? "=> " : " => " }];
}

// The type names declared in the file as object types: classes and interfaces, and aliases of
// object types; an enum or an alias of anything else isn't one.
function objectTypes(nodes: Node[]): Map<string, boolean> {
  const types = new Map<string, boolean>();
  for (const n of nodes) {
    if (typeof n.name !== "string") continue;
    if (n.kind === "class" || n.kind === "interface") types.set(n.name, true);
    if (n.kind === "enum") types.set(n.name, false);
    if (n.kind === "typeAlias") types.set(n.name, isNode(n.type) && n.type.kind !== "ref" && objectLike(n.type, new Map()));
  }
  return types;
}

// Whether a parameter's type is an object, which a function borrows rather than copies: an
// object type, an array or tuple, or a name that isn't a primitive, an enum or a type parameter.
function objectLike(t: Node, declared: Map<string, boolean>, generic = new Set<string>()): boolean {
  if (t.kind === "object" || t.kind === "array" || t.kind === "tuple") return true;
  if (t.kind !== "ref") return false;
  const name = t.name as string;
  if (PRIMITIVES.has(name) || generic.has(name) || ["Ref", "Mut", "Option", "Atomic"].includes(name)) return false;
  return declared.get(name) ?? true;
}

// Which parameters of the file's functions, by index, and which methods' receivers, the file
// changes: from the syntax, then through calls to the file's own functions and methods, until
// nothing more is found. A parameter or receiver already written `Mut` counts as changed.
function changed(f: File): { params: Map<Node, Set<number>>; methods: Set<Node> } {
  const functions = f.nodes.filter((n) => isFunction(n) && n.body !== undefined);
  const byName = new Map<string, Node>();
  for (const n of functions) {
    const at = f.up.get(n);
    if (n.kind === "function" && "macro" in n && typeof n.name === "string") byName.set(n.name, n);
    else if (at?.key === "init" && isNode(at.holder.target) && at.holder.target.kind === "ident") byName.set(at.holder.target.name as string, n);
  }
  const mutType = (t: unknown) => isNode(t) && t.kind === "ref" && t.name === "Mut";
  const params = new Map(functions.map((n) => [n, new Set((n.params as Param[]).flatMap((p, i) => (mutType(p.type) ? [i] : [])))]));
  const methods = new Set(functions.filter((n) => n.kind === "method" && (n.params as Param[]).some((p) => named(p.pattern, "this") && mutType(p.type))));
  const classOf = (m: Node) => f.up.get(m)?.holder as Node | undefined;
  const bodies = new Map(functions.map((n) => [n, everyNode([n.body])]));
  const receivers = new Map(functions.filter((n) => n.kind === "method" && Array.isArray(n.modifiers) && !(n.modifiers as string[]).includes("static")).map((n) => [n, ownScope(n)]));
  const mutating = (object: unknown, name: string, cls: Node | undefined) => [...methods].some((m) => m.name === name && (!cls || classOf(m) === cls));
  for (let more = true; more; ) {
    more = false;
    for (const [n, body] of bodies) {
      (n.params as Param[]).forEach((p, i) => {
        if (p.pattern.kind !== "ident" || params.get(n)!.has(i)) return;
        const root = (r: unknown) => named(r, p.pattern.name as string);
        if (body.some((x) => changes(x, root, params, byName, (o, m) => mutating(o, m, undefined)))) {
          params.get(n)!.add(i);
          more = true;
        }
      });
    }
    for (const [m, body] of receivers) {
      if (methods.has(m)) continue;
      const aliases = new Set(body.flatMap((x) => (x.kind === "let" ? (x.declarations as { target: Node; init?: Node }[]).filter((d) => d.target.kind === "ident" && d.init?.kind === "this").map((d) => d.target.name as string) : [])));
      const root = (r: unknown) => isNode(r) && (r.kind === "this" || (r.kind === "ident" && aliases.has(r.name as string)));
      if (body.some((x) => changes(x, root, params, byName, (o, name) => mutating(o, name, classOf(m))))) {
        methods.add(m);
        more = true;
      }
    }
  }
  return { params, methods };
}

// A method's own nodes: its body without the functions and classes in it that have their own
// `this`; arrow functions share the method's.
function ownScope(n: Node): Node[] {
  const found: Node[] = [];
  const stack: unknown[] = [n.body];
  while (stack.length > 0) {
    const v = stack.pop();
    if (Array.isArray(v)) for (const x of v) stack.push(x);
    else if (typeof v === "object" && v !== null) {
      if (isNode(v)) {
        found.push(v);
        if (v.kind === "function" || v.kind === "class") continue;
      }
      for (const [key, child] of Object.entries(v)) if (key !== "start" && key !== "end" && typeof child === "object") stack.push(child);
    }
  }
  return found;
}

// Whether `x` changes a place rooted at what `root` accepts: assigning, incrementing or deleting a
// field or element of it, destructuring into one, `Object.assign` onto it, calling a method known
// to change it, or passing it to one of the file's functions that changes that parameter.
function changes(x: Node, root: (r: unknown) => boolean, params: Map<Node, Set<number>>, byName: Map<string, Node>, mutating: (object: unknown, method: string) => boolean): boolean {
  const rooted = (e: unknown): boolean => {
    let at = e;
    while (isNode(at) && (at.kind === "member" || at.kind === "index")) at = at.object;
    return at !== e && root(at);
  };
  const reaches = (e: unknown) => root(e) || rooted(e);
  if (x.kind === "assign") return rooted(x.target);
  if (x.kind === "update" || (x.kind === "unary" && x.op === "delete")) return rooted(x.operand);
  if (x.kind === "destructure") return everyNode([x.pattern]).some((m) => (m.kind === "member" || m.kind === "index") && rooted(m));
  if (x.kind !== "call") return false;
  const callee = x.callee as Node;
  const args = x.args as unknown[];
  if (callee.kind === "member" && named(callee.object, "Object") && callee.name === "assign") return reaches(args[0]);
  if (callee.kind === "member" && (MUTATORS.has(callee.name as string) || mutating(callee.object, callee.name as string)) && reaches(callee.object)) return true;
  const target = callee.kind === "ident" ? byName.get(callee.name as string) : undefined;
  return target !== undefined && args.some((a, i) => reaches(a) && params.get(target)?.has(i) === true);
}

// A5 and A6: each object parameter used only through its fields and as an argument, borrowed as
// `Mut<T>` when the file finds it changed and `Ref<T>` otherwise, marked for review. A parameter
// used any other way, as a value stored or returned, is the function's to own, and keeps its type.
function ownership(f: File, n: Node, declared: Map<string, boolean>, changedParams = new Set<number>()): Hit[] {
  const hits: Hit[] = [];
  const generic = new Set(((n.typeParams ?? []) as { name: string }[]).map((p) => p.name));
  const body = everyNode([n.body]);
  (n.params as Param[]).forEach((p, i) => {
    // A default would be a temporary the borrow outlives.
    if (p.pattern.kind !== "ident" || p.pattern.name === "this" || p.rest || p.optional || p.default || !isNode(p.type) || !objectLike(p.type, declared, generic)) return;
    const name = p.pattern.name as string;
    const uses = body.filter((x) => x.kind === "ident" && x.name === name);
    if (uses.length === 0 || body.some((x) => x.kind === "shorthand" && x.name === name)) return;
    const through = new Set(body.flatMap((x) => (x.kind === "member" || x.kind === "index" ? [x.object] : x.kind === "call" || x.kind === "new" ? ((x.args ?? []) as unknown[]) : [])));
    if (!uses.every((u) => through.has(u))) return;
    const written = annotation(f, p.pattern.end, p.type);
    if (!written) return;
    const [rule, wrapper] = changedParams.has(i) ? ["A6", "Mut"] : ["A5", "Ref"];
    const type = text(f, written.type);
    const message = `'${name}' is ${wrapper === "Mut" ? "changed" : "only read"} here, so it is borrowed as '${wrapper}<${type}>'; the marker asks you to confirm it`;
    hits.push({ rule, action: "auto", ...written.type, message, edits: [{ start: written.type.start, end: written.type.start, text: `${wrapper}<` }, { start: written.type.end, end: written.type.end, text: `> ${MARKER}` }] });
  });
  return hits;
}

// A7: a method changing its object's fields takes `this: Mut<this>`, marked for review, as the
// first parameter.
function receiver(f: File, n: Node): Hit | undefined {
  const params = n.params as Param[];
  const from = ((n.typeParams ?? []) as Node[]).at(-1)?.end ?? (isNode(n.name) ? n.name.end : (((n.decorators ?? []) as Node[]).at(-1)?.end ?? n.start));
  let i = tokenAt(f, from);
  while (i < f.tokens.length && !isToken(f.tokens[i]!, "(")) i++;
  const open = f.tokens[i];
  if (!open) return undefined;
  const at = params[0]?.start ?? open.end;
  const added = `this: Mut<this> ${MARKER}${params.length > 0 ? ", " : ""}`;
  return { rule: "A7", action: "auto", start: n.start, end: open.end, message: "the method changes its object's fields, so it takes 'this: Mut<this>'; the marker asks you to confirm it", edits: [{ start: at, end: at, text: added }] };
}

// A4: a top-level `let` holding an integer, bound nowhere else and not exported, that is updated
// only by `++`, `--`, `+=` or `-=` of an integer in statements of their own and is otherwise read,
// becomes a const `Atomic`.
function counters(program: unknown[], f: File): Hit[] {
  const hits: Hit[] = [];
  const statements = new Set(f.nodes.flatMap((n) => (n.kind === "expr" ? [n.expr] : [])));
  const exported = new Set(f.nodes.flatMap((n) => (n.kind === "exportNamed" && n.module === undefined ? (n.specifiers as { name: string }[]).map((s) => s.name) : n.kind === "exportDefault" && isNode(n.value) && n.value.kind === "ident" ? [n.value.name as string] : [])));
  const updated = new Set(f.nodes.flatMap((n) => (n.kind === "update" && isNode(n.operand) && n.operand.kind === "ident" ? [n.operand.name as string] : n.kind === "assign" && isNode(n.target) && n.target.kind === "ident" ? [n.target.name as string] : [])));
  const uses = new Map<string, Node[]>();
  for (const n of f.nodes) {
    if (n.kind !== "ident" && n.kind !== "shorthand") continue;
    const list = uses.get(n.name as string);
    if (list) list.push(n);
    else uses.set(n.name as string, [n]);
  }
  for (const s of program) {
    if (!isNode(s) || s.kind !== "let" || s.keyword !== "let") continue;
    const [d, ...more] = s.declarations as { target: Node; init?: Node; type?: Node }[];
    if (!d || more.length > 0 || d.target.kind !== "ident" || !d.init || !isInteger(d.init)) continue;
    const name = d.target.name as string;
    if (f.bound.get(name) !== 1 || exported.has(name) || !updated.has(name)) continue;
    const edits = counterEdits(f, name, d.target, uses.get(name) ?? [], statements);
    if (!edits) continue;
    const init = text(f, d.init);
    const written = d.type && annotation(f, d.target.end, d.type);
    if (d.type && !written) continue;
    edits.push({ start: s.start, end: s.start + 3, text: "const" }, ...(written ? [{ start: written.colon.start, end: written.type.end, text: "" }] : []), { start: d.init.start, end: d.init.end, text: `new Atomic(${init})` });
    hits.push({ rule: "A4", action: "auto", start: s.start, end: d.init.end, message: `the top-level counter becomes 'const ${name} = new Atomic(${init})', updated with 'add' and 'sub' and read with 'load()'`, edits });
  }
  return hits;
}

const isInteger = (e: Node) => e.kind === "int" || (e.kind === "unary" && e.op === "-" && isNode(e.operand) && e.operand.kind === "int");

// The edits turning each use of a counter into an Atomic's, or undefined when one is used any
// other way.
function counterEdits(f: File, name: string, declaration: Node, uses: Node[], statements: Set<unknown>): Edit[] | undefined {
  const edits: Edit[] = [];
  for (const use of uses) {
    if (use === declaration) continue;
    if (use.kind === "shorthand") return undefined;
    const at = f.up.get(use);
    const holder = at?.holder as Node | undefined;
    if (holder?.kind === "update" && at!.key === "operand") {
      if (!statements.has(holder)) return undefined;
      edits.push({ start: holder.start, end: holder.end, text: `${name}.${holder.op === "++" ? "add" : "sub"}(1)` });
    } else if (holder?.kind === "assign" && at!.key === "target") {
      if (!statements.has(holder) || (holder.op !== "+=" && holder.op !== "-=") || !isNode(holder.value) || !isInteger(holder.value)) return undefined;
      edits.push({ start: holder.start, end: holder.end, text: `${name}.${holder.op === "+=" ? "add" : "sub"}(${text(f, holder.value)})` });
    } else edits.push({ start: use.start, end: use.end, text: `${name}.load()` });
  }
  return edits;
}

// Each review marker still in the file, as a guided hit: A6 after a `Mut`, A5 after a `Ref`.
function markers(src: string, comments: Comment[]): Hit[] {
  return comments.filter((c) => c.text === MARKER).map((c) => {
    const before = src.slice(0, c.start);
    const rule = before.lastIndexOf("Mut<") > before.lastIndexOf("Ref<") ? "A6" : "A5";
    return { rule, action: "guided", start: c.start, end: c.end, message: "an ownership type the lint inserted: check it, then remove the marker" };
  });
}
