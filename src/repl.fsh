import { isItems, isRecord, type Value } from "./comptime.fsh";
import type { CompileError } from "./diag.fsh";
import { someNode } from "./nodes.fsh";
import { parse, type Stmt } from "./parser.fsh";
import type { Type, Typing } from "./typing.fsh";

// `fishc repl`: what a session keeps, how a line is sorted, the program a line is checked or run
// as, and how a value computed while compiling is printed. The loop that reads lines and runs
// them is the CLI's.

// What a session keeps: the declarations that stand at the top level; the `let` and `const` lines
// that run again, in order, inside `main` before each later line; whether one of those awaits;
// and the errors `main` has had to declare so far.
export type ReplState = { top: string[]; bindings: string[]; awaits: boolean; throws: string[] };

// One statement of a line: a declaration, kept at the top level; a binding, kept and run again; an
// expression, whose value is printed; or any other statement, run once.
// `names`: what a `const` binds when every declarator is a plain name, which is when it may stand
// at the top level.
export type Entry = { kind: "declaration" | "binding" | "expression" | "statement"; text: string; constant: boolean; awaits: boolean; names: string[] };

// The name a line's expression is given as a top-level const, so the checker computes it.
export const REPL_VALUE = "__replValue";

// Whether what was typed can be a whole line: no bracket, string, template or comment is left
// open. A regex holding a bracket or a quote can read as open, which an empty line ends.
export function complete(text: string): boolean {
  let open: string[] = [];
  const length = text.length as i64;
  let i: i64 = 0;
  while (i < length) {
    const c = text.slice(i, i + 1);
    const two = text.slice(i, i + 2);
    const top = open.length > 0 ? open[open.length - 1] : "";
    if (top === "'" || top === '"') {
      if (c === "\\") i++;
      else if (c === top || c === "\n") open.pop();
    } else if (top === "`") {
      if (c === "\\") i++;
      else if (c === "`") open.pop();
      else if (two === "${") {
        open.push("}");
        i++;
      }
    } else if (top === "*/") {
      if (two === "*/") {
        open.pop();
        i++;
      }
    } else if (two === "//") {
      while (i < length && text.slice(i, i + 1) !== "\n") i++;
    } else if (two === "/*") {
      open.push("*/");
      i++;
    } else if (c === "'" || c === '"' || c === "`") open.push(c);
    else if (c === "(") open.push(")");
    else if (c === "[") open.push("]");
    else if (c === "{") open.push("}");
    else if (c === top) open.pop();
    i++;
  }
  return open.length === 0;
}

const DECLARATIONS = ["function", "class", "typeAlias", "interface", "enum", "namespace", "declare", "import", "importEquals", "export", "exportDefault", "exportFrom", "exportAll", "exportAssign"];

// A line's statements, each as its own text.
/** @throws {CompileError} */
export function entries(text: string): Entry[] {
  let out: Entry[] = [];
  const list = parse(text, { last: 0 });
  for (let k: usize = 0; k < list.length; k++) {
    const s: Ref<Stmt> = list[k];
    // A statement's own span can leave out the brackets around it, so its text runs to the next.
    let piece = text.slice(s.start as i64, k + 1 < list.length ? (list[k + 1].start as i64) : (text.length as i64)).trim();
    while (piece.endsWith(";")) piece = piece.slice(0, (piece.length as i64) - 1).trim();
    const awaits = someNode({ of: "stmts", node: parse(piece, { last: 0 }) }, (n) => (n.of === "expr" && n.node.kind === "unary" && n.node.op === "await") || (n.of === "stmt" && (n.node.kind === "forOf" || n.node.kind === "forIn") && n.node.await));
    // The next kept line may begin with a bracket, so each ends in a `;` unless a block ends it.
    const ended = piece.endsWith("}") ? piece : piece + ";";
    if (DECLARATIONS.includes(s.kind)) out.push({ kind: "declaration", text: ended, constant: false, awaits, names: [] });
    else if (s.kind === "let" && (s.keyword === "let" || s.keyword === "const")) {
      let names: string[] = [];
      for (const d of s.declarations) if (d.target.kind === "ident") names.push(d.target.name);
      const plain: string[] = names.length === s.declarations.length ? names : [];
      out.push({ kind: "binding", text: ended, constant: s.keyword === "const", awaits, names: plain });
    } else if (s.kind === "expr" && s.expr.kind !== "assign" && s.expr.kind !== "update" && s.expr.kind !== "destructure") {
      out.push({ kind: "expression", text: piece, constant: false, awaits, names: [] });
    } else out.push({ kind: "statement", text: ended, constant: false, awaits, names: [] });
  }
  return out;
}

// The program a line is checked or run as: the kept declarations and `above`, then a `main`
// running the kept bindings, when `bound`, and `body`. `at` is where the line's own text starts
// in it, `above` when there is one and `body` otherwise, for placing an error in the line.
export function program(kept: Ref<ReplState>, above: string, body: string, bound: boolean, awaits: boolean): { source: string; at: usize } {
  let source = "";
  for (const t of kept.top) source += t + "\n";
  let at = source.length as usize;
  if (above !== "") source += above + "\n";
  const async = awaits || (bound && kept.awaits);
  const throws = kept.throws.length === 0 ? "" : ` throws ${kept.throws.join(" | ")}`;
  source += async ? `async function main(): Promise<void>${throws} {\n` : `function main(): void${throws} {\n`;
  if (bound) for (const b of kept.bindings) source += b + "\n";
  if (above === "") at = source.length as usize;
  source += body + "\n}\n";
  return { source, at };
}

// The errors a check asks `main` to declare, from its message, or none when it asks for nothing.
export function thrownBy(message: string): string[] {
  const head = "'main' must declare 'throws ";
  const end = message.indexOf("' after its return type");
  if (!message.startsWith(head) || end < 0) return [];
  return message.slice(head.length as i64, end).split(" | ");
}

// A string as it prints inside an array or an object, when quoting it needs no thought.
function quoted(s: string): string | undefined {
  for (const c of s) if (c < " " || c > "~" || c === "'" || c === "\\") return undefined;
  return `'${s}'`;
}

// A value computed while compiling as `console.log` prints it, or nothing when that isn't certain:
// the line is then built and run, which prints it as any program does. Numbers, booleans and
// strings are certain, and so are short arrays and plain objects of them on one line.
export function shown(typing: Ref<Typing>, v: Ref<Value>, t: Type, nested: boolean): string | undefined {
  const of: Type = typeof t !== "string" && typing.kindOf(t) === "literal" ? (typeof v === "string" ? "string" : typeof v === "boolean" ? "boolean" : "i64") : t;
  if (typeof v === "string") return of !== "string" ? undefined : nested ? quoted(v) : v;
  if (typeof v === "boolean") return of === "boolean" ? String(v) : undefined;
  if (typeof v === "bigint") return of === "bigint" ? `${v}n` : typeof of === "string" && /^[iu](8|16|32|64|128|size)$/.test(of) ? `${v}` : undefined;
  if (typeof v === "number") return of !== "f64" && of !== "f32" ? undefined : v === 0.0 && 1.0 / v < 0.0 ? "-0" : `${v}`;
  if (typeof of === "string") return undefined;
  const r = typing.rec(of);
  if (isItems(v) && r.kind === "array") {
    if (v.items.length > 6) return undefined;
    let parts: string[] = [];
    for (const item of v.items) {
      const part = shown(typing, item, r.element, true);
      if (part === undefined) return undefined;
      parts.push(part);
    }
    const line = parts.length === 0 ? "[]" : `[ ${parts.join(", ")} ]`;
    return line.length > 72 ? undefined : line;
  }
  if (isRecord(v) && r.kind === "object" && r.tuple !== true) {
    if (nested) return undefined;
    let parts: string[] = [];
    for (const f of r.fields) {
      const held = v.fields.get(f.name);
      if (held === undefined || f.optional !== undefined || !/^[A-Za-z_$][\w$]*$/.test(f.name)) return undefined;
      const part = shown(typing, held, f.type, true);
      if (part === undefined) return undefined;
      parts.push(`${f.name}: ${part}`);
    }
    const line = parts.length === 0 ? "{}" : `{ ${parts.join(", ")} }`;
    return line.length > 72 ? undefined : line;
  }
  return undefined;
}
