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
  if (!edition) throw new CompileError("E0005", "an edition directive is written '// @fish-edition native' or '// @fish-edition ts-compat'", start, end);
  return { edition, start, end };
}

// Refuses a file in the TS-compat edition, by its directive or else its package's, at the
// directive or the file's first line.
export function refuseCompat(src: string, packaged: Edition | undefined) {
  const declared = directive(src);
  if ((declared?.edition ?? packaged) !== "ts-compat") return;
  const newline = src.indexOf("\n");
  const at = declared ?? { start: 0, end: Math.max(newline < 0 ? src.length : newline, 1) };
  throw new CompileError("E0006", "this file is in the TS-compat edition, which Fish doesn't compile; run 'fishc lint' to find what to change, then mark it '// @fish-edition native'", at.start, at.end);
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
    const fixable = migrations(parseWithComments(text, { last: 0 }), text, fsh).filter((h) => (h.edits ?? []).length > 0).sort((a, b) => a.start - b.start);
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
  if (edited) parseWithComments(text, { last: 0 });
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
  const file = fileOf(parsed.program, nodes, src, parsed.tokens);
  const hits = [...rejects(parsed.program, nodes), ...autoFixes(parsed.program, file, fsh), ...guided(parsed.program, file), ...markers(src, parsed.comments)];
  for (const h of hits) {
    if (!h.edits?.some((e) => parsed.comments.some((c) => c.start >= e.start && c.end <= e.end))) continue;
    delete h.edits;
    h.message = `a comment sits where this change would go, so it can't be made automatically; make it by hand: ${h.message}`;
  }
  return hits;
}

// The hits `fishc survey` counts: the reject and guided rules, and A1, A3 and A8 wherever they
// occur, fixable or not, without working out any edits.
export function surveyHits(program: unknown[]): Hit[] {
  const nodes = everyNode(program);
  const ambient = new Set(nodes.filter((n) => n.kind === "declare").flatMap((n) => everyNode([n.body])));
  // The guided rules read no text or tokens.
  const hits = [...rejects(program, nodes), ...guided(program, fileOf(program, nodes, "", []))];
  const at = (rule: string, n: Node) => hits.push({ rule, action: "auto", start: n.start, end: n.end });
  for (const n of nodes) {
    if (n.kind === "let" && n.keyword === "var" && !ambient.has(n)) at("A1", n);
    if (n.kind === "binary" && (n.op === "==" || n.op === "!=")) at("A3", n);
    if (jsonCast(n)) at("A8", n);
  }
  return hits;
}

const fileOf = (program: unknown[], nodes: Node[], src: string, tokens: Token[]): File => ({ src, tokens, nodes, up: parents(program), bound: bindings(nodes), ...byName(nodes) });

// The reject rules' hits in a file's tree, in no particular order. The walk keeps its own stack,
// so a deeply nested file can't overflow the call stack.
export function rejects(program: unknown[], nodes: Node[] = everyNode(program)): Hit[] {
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
function objectLike(t: Node, declared: Map<string, boolean>, generic: Set<string> = new Set<string>()): boolean {
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
function ownership(f: File, n: Node, declared: Map<string, boolean>, changedParams: Set<number> = new Set<number>()): Hit[] {
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

// What each guided rule suggests, as the hit's message says it.
const GUIDES: Record<string, string> = {
  G1: "'any' turns type checking off, which Fish doesn't do; choose a concrete type, a union, or the dynamic 'Json' value",
  G2: "the promise this call gives is dropped, and a Fish future runs only when it is awaited; add 'await', or wrap the call in 'spawn()' to run it on its own",
  G3: "this 'number' counts or indexes, and a Fish 'number' is a float; make it 'i64', or 'usize' for an index",
  G4: "this class extends one that is also used as a type, so a subclass stands in for its base, which Fish's embedded bases don't allow; extract an interface for what they share, and hold the base as a field",
  G5: "'instanceof' tests a class that others extend, and Fish has no subclass checks at run time; 'match' on an interface or an enum instead",
  G6: "indexing with a string key reads the object as a dictionary, which a Fish object isn't; use a 'Map<string, T>'",
  G7: "top-level code runs when the module loads, which Fish doesn't do; move it into 'main()', or into a 'Lazy<T>' for a value made once",
  G8: "parsing gives an 'Option' in Fish rather than NaN; 'match' on the parsed 'Option' instead of checking 'isNaN'",
  G9: "'.call', '.apply' and '.bind' choose a function's 'this' at run time; pass the receiver as an argument, or use a closure",
  G10: "'forEach' doesn't wait for an async callback; use 'for...of' with 'await', or spawn a task for each",
  G11: "hold one value, changed through one while the other is still used, which Fish's ownership refuses; share it as 'shared<T>', give one its own '.clone()', or restructure so one name is used at a time",
};

const PARSERS = ["parseInt", "parseFloat", "Number"];
// A call that parses a number: `parseInt`, `parseFloat` or `Number`, bare or on `Number`.
const parsing = (e: unknown) => isNode(e) && e.kind === "call" && (PARSERS.some((p) => named(e.callee, p)) || (isNode(e.callee) && e.callee.kind === "member" && named(e.callee.object, "Number") && ["parseInt", "parseFloat"].includes(e.callee.name as string)));
// Where a call's rule points: a method's own name rather than the start of a long chain.
const callAt = (n: Node) => (isNode(n.callee) && n.callee.kind === "member" ? n.callee.end - String(n.callee.name).length : n.start);
const typeName = (t: unknown, name: string) => isNode(t) && t.kind === "ref" && t.name === name;

// The guided rules' hits: each a decision left to a person, with what to do, never an edit.
function guided(program: unknown[], f: File): Hit[] {
  const hits: Hit[] = [];
  const hit = (rule: string, start: number, end: number) => hits.push({ rule, action: "guided", start, end, message: GUIDES[rule] });
  for (const s of program) {
    const top = isNode(s) && (s.kind === "export" || s.kind === "declare") && isNode(s.body) ? s.body : s;
    if (isNode(top) && top.kind === "expr" && !(isNode(top.expr) && top.expr.kind === "string") && !callsMain(top.expr)) hit("G7", top.start, top.end);
  }
  const scopes = scopesOf(f);
  const extended = new Set(f.nodes.flatMap((c) => (c.kind === "class" && baseName(c) ? [baseName(c)!] : [])));
  const typed = new Set(f.nodes.flatMap((n) => (n.kind === "ref" && f.up.get(n)?.key !== "implements" ? [n.name as string] : [])));
  // What a name used as an index or given to `isNaN` holds, read from the binding it resolves to.
  const declarator = (use: Node) => {
    const b = resolve(f, scopes, use);
    return b?.kind === "let" ? b.declarator : undefined;
  };
  const stringy = (use: Node) => {
    const b = resolve(f, scopes, use);
    if (b?.kind === "param") return typeName(b.param.type, "string");
    if (b?.kind !== "let") return false;
    const holder = f.up.get(b.let)?.holder as Node | undefined;
    return (holder?.kind === "forIn" && f.up.get(b.let)?.key === "left") || typeName(b.declarator.type, "string") || (isNode(b.declarator.init) && (literalKind(b.declarator.init) === "string" || b.declarator.init.kind === "template"));
  };
  hits.push(...dropped(f, scopes), ...counts(f, scopes), ...aliases(f));
  for (const n of f.nodes) {
    if (n.kind === "ref" && n.name === "any") hit("G1", n.start, n.end);
    if (n.kind === "class" && baseName(n) && typed.has(baseName(n)!)) hit("G4", n.start, n.end);
    if (n.kind === "binary" && n.op === "instanceof" && isNode(n.right) && n.right.kind === "ident" && extended.has(n.right.name as string)) hit("G5", n.start, n.end);
    if (n.kind === "index" && isNode(n.index) && (n.index.kind === "string" || n.index.kind === "template" || (n.index.kind === "ident" && stringy(n.index)))) hit("G6", n.start, n.end);
    // A call signature in an interface is a `call` too, without arguments.
    if (n.kind !== "call" || !Array.isArray(n.args)) continue;
    const callee = n.callee as Node;
    const [first] = n.args as Node[];
    if ((named(callee, "isNaN") || (callee.kind === "member" && named(callee.object, "Number") && callee.name === "isNaN")) && (parsing(first) || (isNode(first) && first.kind === "ident" && parsing(declarator(first)?.init)))) hit("G8", callAt(n), n.end);
    if (callee.kind !== "member") continue;
    if (["call", "apply", "bind"].includes(callee.name as string)) hit("G9", callAt(n), n.end);
    if (callee.name === "forEach" && isNode(first) && (first.kind === "arrow" || first.kind === "function") && first.async) hit("G10", callAt(n), n.end);
  }
  return hits;
}

// `main()` at the top level, or `main().catch(...)`, which a Fish program's `main` replaces.
function callsMain(e: unknown): boolean {
  if (!isNode(e) || e.kind !== "call") return false;
  if (named(e.callee, "main")) return true;
  return isNode(e.callee) && e.callee.kind === "member" && ["catch", "then"].includes(e.callee.name as string) && callsMain(e.callee.object);
}

// A function or method whose call gives a promise: `async`, by its field or a class method's
// modifier, or declared returning `Promise<...>`; an async generator gives an iterator instead.
const promised = (n: Node) => n.generator !== true && (n.async === true || (Array.isArray(n.modifiers) && n.modifiers.includes("async")) || typeName(n.returnType, "Promise") || typeName(n.returns, "Promise"));

// The class extended, by name, seeing through type arguments as in `extends Base<string>`.
const baseName = (n: Node): string | undefined => {
  const base = isNode(n.extends) && n.extends.kind === "instantiation" ? n.extends.expr : n.extends;
  return isNode(base) && base.kind === "ident" ? (base.name as string) : undefined;
};

type Decl = { target: Node; type?: Node; init?: Node };
// What a name is bound to: a variable's declarator, a parameter, or a declared function.
type Binding = { kind: "let"; declarator: Decl; let: Node } | { kind: "param"; param: Param; fn: Node } | { kind: "function"; fn: Node };
const ROOT = {};

// Each scope's bindings by name: a statement list's under what holds it, a loop head's under its
// loop, the file's under `ROOT`, and a function's parameters under the function.
function scopesOf(f: File): Map<object, Map<string, Binding>> {
  const scopes = new Map<object, Map<string, Binding>>();
  const bind = (scope: object, name: string, b: Binding) => {
    const names = scopes.get(scope) ?? new Map<string, Binding>();
    scopes.set(scope, names);
    if (!names.has(name)) names.set(name, b);
  };
  const scopeOf = (n: Node): object => f.up.get(n)?.holder ?? ROOT;
  for (const n of f.nodes) {
    if (n.kind === "let") for (const d of n.declarations as Decl[]) for (const x of everyNode([d.target])) if (x.kind === "ident") bind(scopeOf(n), x.name as string, { kind: "let", declarator: d, let: n });
    if (n.kind === "function" && "macro" in n && typeof n.name === "string") bind(scopeOf(n), n.name, { kind: "function", fn: n });
    if (isFunction(n) && n.body !== undefined) for (const p of n.params as Param[]) for (const x of everyNode([p.pattern])) if (x.kind === "ident") bind(n, x.name as string, { kind: "param", param: p, fn: n });
  }
  return scopes;
}

// The binding a name's use resolves to: the innermost scope holding it that binds the name.
function resolve(f: File, scopes: Map<object, Map<string, Binding>>, use: Node): Binding | undefined {
  const name = use.name as string;
  for (let at = f.up.get(use); at; at = f.up.get(at.holder)) {
    const found = scopes.get(at.holder)?.get(name);
    if (found) return found;
  }
  return scopes.get(ROOT)?.get(name);
}

// G2: a call whose promise is dropped: a statement of its own, not awaited, returned, assigned or
// given to `void`, of what the file declares giving a promise. A plain call counts through the
// binding its name resolves to; a method call only when its receiver is known from the syntax:
// `this` in the method's class, a name annotated with the class, interface or type, or a local
// made with `new` of the class or with the object literal.
function dropped(f: File, scopes: Map<object, Map<string, Binding>>): Hit[] {
  // Each type or object literal's methods that give a promise, by name.
  const owners = new Map<object, Set<string>>();
  const types = new Map<string, object>();
  for (const n of f.nodes) {
    const members = n.kind === "class" || n.kind === "interface" ? (n.members as Node[]) : n.kind === "typeAlias" && isNode(n.type) && n.type.kind === "object" ? (n.type.members as Node[]) : n.kind === "object" ? (n.props as Node[]) : undefined;
    if (!members) continue;
    if (typeof n.name === "string") types.set(n.name, n);
    const names = new Set(members.flatMap((m) => {
      const name = (m.name ?? m.key) as unknown;
      const value = m.kind === "property" && isNode(m.value) ? m.value : m;
      return typeof name === "string" && (m.kind === "method" || m.kind === "property") && promised(value) ? [name] : [];
    }));
    owners.set(n, names);
  }
  const ownerOf = (b: Binding | undefined): object | undefined => {
    let type = b?.kind === "param" ? b.param.type : b?.kind === "let" ? b.declarator.type : undefined;
    // A borrow of the type is the type for this.
    if (isNode(type) && type.kind === "ref" && (type.name === "Ref" || type.name === "Mut")) type = (type.args as Node[])[0];
    if (isNode(type) && type.kind === "ref") return types.get(type.name as string);
    const init = b?.kind === "let" ? b.declarator.init : undefined;
    if (init?.kind === "new" && isNode(init.callee) && init.callee.kind === "ident") return types.get(init.callee.name as string);
    return init?.kind === "object" ? init : undefined;
  };
  const gives = (callee: Node, call: Node): boolean => {
    if (callee.kind === "ident") {
      const b = resolve(f, scopes, callee);
      if (b?.kind === "function") return promised(b.fn);
      return b?.kind === "let" && isNode(b.declarator.init) && (b.declarator.init.kind === "arrow" || b.declarator.init.kind === "function") && promised(b.declarator.init);
    }
    if (callee.kind !== "member") return false;
    const object = callee.object as Node;
    const owner = object.kind === "this" ? ancestors(f, call).find((x) => x.kind === "class") : object.kind === "ident" ? ownerOf(resolve(f, scopes, object)) : undefined;
    return owner !== undefined && owners.get(owner)?.has(callee.name as string) === true;
  };
  const hits: Hit[] = [];
  for (const n of f.nodes) {
    if (n.kind === "expr" && isNode(n.expr) && n.expr.kind === "call" && gives(n.expr.callee as Node, n.expr)) hits.push({ rule: "G2", action: "guided", start: n.expr.start, end: n.expr.end, message: GUIDES.G2 });
  }
  return hits;
}

const COMPARES = new Set(["<", "<=", ">", ">=", "===", "!==", "==", "!="]);

// G3: a binding declared with a number or annotated `number` that the code uses as an array
// index, or compares with a `.length` as a loop counter does. Each such use is resolved to its
// binding once, and each binding reported once, at its name.
function counts(f: File, scopes: Map<object, Map<string, Binding>>): Hit[] {
  const numeric = (type: unknown, init: unknown) => typeName(type, "number") || (!type && isNode(init) && literalKind(init) === "number");
  const seen = new Set<Node>();
  const hits: Hit[] = [];
  for (const list of f.idents.values()) {
    for (const use of list) {
      const at = f.up.get(use);
      const holder = at?.holder as Node | undefined;
      const other = at?.key === "left" ? holder?.right : at?.key === "right" ? holder?.left : undefined;
      const counting = (holder?.kind === "index" && at!.key === "index") || (holder?.kind === "binary" && COMPARES.has(holder.op as string) && isNode(other) && other.kind === "member" && other.name === "length");
      if (!counting) continue;
      const b = resolve(f, scopes, use);
      const target = b?.kind === "let" && numeric(b.declarator.type, b.declarator.init) ? b.declarator.target : b?.kind === "param" && b.fn.body !== undefined && typeName(b.param.type, "number") ? b.param.pattern : undefined;
      if (target?.kind !== "ident" || seen.has(target)) continue;
      seen.add(target);
      hits.push({ rule: "G3", action: "guided", start: target.start, end: target.end, message: GUIDES.G3 });
    }
  }
  return hits;
}

const VALUES = new Set(["object", "array", "new", "call"]);

// G11: a plain local alias, `const b = a` or `b = a`, of a value that isn't a primitive, after
// which one name changes it while the other is still used. `a` counts when the file declares it
// only with an object, an array, a `new` or a call; uses are those in the alias's scope.
function aliases(f: File): Hit[] {
  const hits: Hit[] = [];
  // Worked out once per name, so many aliases of one name stay cheap.
  const known = new Map<string, boolean>();
  const valued = (name: string) => {
    if (known.has(name)) return known.get(name)!;
    const inits = (f.lets.get(name) ?? []).flatMap((n) => (n.kind === "let" ? (n.declarations as { target: Node; init?: Node }[]).filter((d) => named(d.target, name)).map((d) => d.init) : [undefined]));
    known.set(name, inits.length > 0 && inits.every((init) => isNode(init) && VALUES.has(init.kind)));
    return known.get(name)!;
  };
  // Each name's changes, in source order, found once per name.
  const changes = new Map<string, Node[]>();
  const changesOf = (name: string) => {
    if (!changes.has(name)) changes.set(name, (f.idents.get(name) ?? []).flatMap((u) => mutation(f, u) ?? []).sort((a, b) => a.start - b.start));
    return changes.get(name)!;
  };
  // The first node of `list`, sorted by start, starting at or after `from` and inside `scope`,
  // found by binary search and a walk that stops at the first.
  const first = (list: Node[], from: number, scope: Span) => {
    let [lo, hi] = [0, list.length];
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]!.start < from) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < list.length && list[i]!.start < scope.end; i++) if (list[i]!.end <= scope.end) return list[i];
    return undefined;
  };
  const check = (alias: string, value: string, at: Span, node: Node) => {
    if (alias === value || !valued(value)) return;
    const scope: Span = ancestors(f, node).find(isFunction) ?? { start: 0, end: f.src.length || Infinity };
    for (const [changing, other] of [[alias, value], [value, alias]] as const) {
      const change = first(changesOf(changing), at.end, scope);
      if (change && first(f.idents.get(other) ?? [], change.end, scope)) {
        hits.push({ rule: "G11", action: "guided", start: at.start, end: at.end, message: `'${alias}' and '${value}' ${GUIDES.G11}` });
        return;
      }
    }
  };
  for (const n of f.nodes) {
    if (n.kind === "let") for (const d of n.declarations as { target: Node; init?: Node }[]) if (d.target.kind === "ident" && d.init?.kind === "ident") check(d.target.name as string, d.init.name as string, { start: d.target.start, end: d.init.end }, n);
    if (n.kind === "assign" && n.op === "=" && isNode(n.target) && n.target.kind === "ident" && isNode(n.value) && n.value.kind === "ident") check(n.target.name as string, n.value.name as string, n, n);
  }
  return hits;
}

// The node changing what the name at `use` holds, if it does: an assignment, update or `delete`
// through a member or element of it, a known mutating method called on it, or `Object.assign` onto it.
function mutation(f: File, use: Node): Node | undefined {
  let top = use;
  let at = f.up.get(use);
  while (at && isNode(at.holder) && (at.holder.kind === "member" || at.holder.kind === "index") && at.key === "object") {
    top = at.holder;
    at = f.up.get(top);
  }
  const holder = at?.holder as Node | undefined;
  if (!at || !holder) return undefined;
  if (top !== use) {
    if (holder.kind === "assign" && at.key === "target") return holder;
    if ((holder.kind === "update" || (holder.kind === "unary" && holder.op === "delete")) && at.key === "operand") return holder;
    if (top.kind === "member" && MUTATORS.has(top.name as string) && holder.kind === "call" && at.key === "callee") return holder;
  }
  const callee = holder.callee as Node | undefined;
  if (holder.kind === "call" && at.key === "args" && (holder.args as unknown[])[0] === use && callee?.kind === "member" && named(callee.object, "Object") && callee.name === "assign") return holder;
  return undefined;
}
