import { walkWhile, type AnyNode } from "./nodes.fsh";
import { parse, type ClassMember, type Func, type Stmt } from "./parser.fsh";

// What an edit to one file changed: the bodies whose text did, numbered in the order the file
// writes its bodies, and the top-level functions whose signatures did, by name; or why the edit
// can't be checked by rechecking bodies alone.
// `moves` maps the old text to the new: each stretch whose text is the same in both, as its old
// start and end and its new start, from the file's start.
// `changed` names each changed body: the class it is in, if any, as written, the function's name
// or the member's key (`m`, `static m`, `get x`, `set x`, `constructor`), and where its text is now.
export type Edit = { bodies: usize[]; signatures: string[]; methods: boolean; moves: [usize, usize, usize][]; changed: Changed[]; fallback: string | undefined };
// `whole` marks a function whose signature changed, its whole text then from `start` to `end`.
export type Changed = { owner: string | undefined; name: string; start: usize; end: usize; whole: boolean };

// A body read again: the function's name, or the class's and the member's key, as the program
// names them, and its statements.
// `func` is set when its signature changed too: the whole function read again.
export type Replaced = { owner: string | undefined; name: string; statements: Stmt[]; func?: Func };

// A file's text cut into its skeleton, everything outside the bodies of its functions, methods,
// accessors and constructors and the signatures of its top-level functions; those bodies, with
// whether each may be rechecked on its own; and those signatures, with their functions' names.
// `pieces` is every stretch of the text in order, the skeleton's, the signatures' and the bodies'.
type Cut = { skeleton: string; bodies: string[]; alone: boolean[]; members: boolean[]; signatures: string[]; names: string[]; spans: [usize, usize][]; pieces: [usize, usize][]; labels: Changed[] };

// How the file's text `after` differs from `before`, when both parse.
export function classified(before: string, after: string): Edit {
  let was: Cut = { skeleton: "", bodies: [], alone: [], members: [], signatures: [], names: [], spans: [], pieces: [], labels: [] };
  let now: Cut = { skeleton: "", bodies: [], alone: [], members: [], signatures: [], names: [], spans: [], pieces: [], labels: [] };
  try {
    was = cut(before, parse(before, { last: 0 }));
    now = cut(after, parse(after, { last: 0 }));
  } catch (_e) {
    // Parsing only throws a CompileError, which the build reports.
    return { bodies: [], signatures: [], methods: false, moves: [], changed: [], fallback: "the file doesn't parse" };
  }
  if (was.skeleton !== now.skeleton || was.names.join(",") !== now.names.join(",")) return { bodies: [], signatures: [], methods: false, moves: [], changed: [], fallback: "something outside a function's signature or body changed" };
  let signatures: string[] = [];
  let changed: Changed[] = [];
  for (let i: usize = 0; i < now.signatures.length; i++) {
    if (was.signatures[i] === now.signatures[i]) continue;
    signatures.push(now.names[i]!);
    const [start, end] = now.spans[i]!;
    changed.push({ owner: undefined, name: now.names[i]!, start, end, whole: true });
  }
  let bodies: usize[] = [];
  let methods = false;
  for (let i: usize = 0; i < now.bodies.length; i++) {
    if (was.bodies[i] === now.bodies[i]) continue;
    if (now.members[i]!) methods = true;
    if (!now.alone[i]! || !was.alone[i]!) return { bodies: [], signatures: [], methods: false, moves: [], changed: [], fallback: "a changed body declares a type, runs comptime or belongs to a decorated declaration" };
    bodies.push(i);
    const l: Ref<Changed> = now.labels[i]!;
    // A function whose signature changed is read again whole.
    if (l.owner === undefined && signatures.includes(l.name)) continue;
    changed.push({ owner: l.owner, name: l.name, start: l.start, end: l.end, whole: false });
  }
  let moves: [usize, usize, usize][] = [];
  for (let i: usize = 0; i < now.pieces.length && i < was.pieces.length; i++) {
    const [a, b] = was.pieces[i]!;
    const [x, y] = now.pieces[i]!;
    if (before.slice(a as i64, b as i64) === after.slice(x as i64, y as i64)) moves.push([a, b, x]);
  }
  return { bodies, signatures, methods, moves, changed, fallback: undefined };
}

function cut(src: string, statements: Ref<Stmt[]>): Cut {
  let c: Cut = { skeleton: "", bodies: [], alone: [], members: [], signatures: [], names: [], spans: [], pieces: [], labels: [] };
  let at: usize = 0;
  for (const s of statements) at = cutStatement(src, s, false, c, at);
  c.skeleton += src.slice(at as i64);
  c.pieces.push([at, src.length]);
  return c;
}

// Cuts the bodies out of one top-level statement, from `at`, giving where the skeleton goes on.
function cutStatement(src: string, s: Ref<Stmt>, decorated: boolean, c: Mut<Cut>, at: usize): usize {
  if (s.kind === "export") return cutStatement(src, s.body, decorated, c, at);
  if (s.kind === "exportDefault" && s.declaration !== undefined) return cutStatement(src, s.declaration, decorated, c, at);
  if (s.kind === "function") {
    if (s.body === undefined) return at;
    const opens = bodyStart(src, s.body, s.end);
    // A decorator or a macro makes what the signature means, so only a plain one stands alone.
    const plain = !decorated && !s.macro && (s.decorators === undefined || s.decorators.length === 0);
    if (plain) {
      c.skeleton += src.slice(at as i64, s.start as i64) + "\u0001";
      c.pieces.push([at, s.start]);
      c.signatures.push(src.slice(s.start as i64, opens as i64));
      c.spans.push([s.start, s.end]);
      c.pieces.push([s.start, opens]);
      c.names.push(s.name);
    }
    return cutBody(src, s.body, s.end, !plain, undefined, s.name, c, plain ? opens : at);
  }
  if (s.kind === "class") {
    let from = at;
    const marked = decorated || s.decorators.length > 0;
    for (const m of s.members) {
      if (m.kind !== "method" && m.kind !== "constructor" && m.kind !== "get" && m.kind !== "set") continue;
      const body: Ref<Stmt[] | undefined> = m.body;
      if (body === undefined) continue;
      from = cutBody(src, body, m.end, marked || m.decorators.length > 0, s.name !== undefined ? s.name : "default", memberKey(m), c, from);
    }
    return from;
  }
  return at;
}

// Where a body's text starts: just after its opening brace, found back from its first statement,
// or from its closing brace at `end`, so an empty body and a full one start alike. A brace in a
// comment there would move the cut, but the skeleton and the bodies still cover all the text.
function bodyStart(src: string, body: Ref<Stmt[]>, end: usize): usize {
  const from = body.length > 0 ? body[0]!.start : end - 1;
  const open = src.lastIndexOf("{", from as i64);
  return open < 0 ? from : (open as usize) + 1;
}

// A class member's key, as the class's tables name it.
export function memberKey(m: Ref<ClassMember>): string {
  if (m.kind === "constructor") return "constructor";
  if (m.kind === "method") return `${m.modifiers.includes("static") ? "static " : ""}${typeof m.name === "string" ? m.name : ""}`;
  if (m.kind === "get" || m.kind === "set") return `${m.modifiers.includes("static") ? "static " : ""}${m.kind} ${typeof m.name === "string" ? m.name : ""}`;
  return "";
}

// Cuts out a body whose statements are `body` and whose closing brace ends at `end`, named by the
// class it is in, if any, and its own name or key.
function cutBody(src: string, body: Ref<Stmt[]>, end: usize, decorated: boolean, owner: string | undefined, name: string, c: Mut<Cut>, at: usize): usize {
  const start = bodyStart(src, body, end);
  const close = end - 1;
  c.skeleton += src.slice(at as i64, start as i64) + "\u0000";
  c.pieces.push([at, start]);
  c.bodies.push(src.slice(start as i64, close as i64));
  c.pieces.push([start, close]);
  c.members.push(owner !== undefined);
  c.labels.push({ owner, name, start, end: close, whole: false });
  c.alone.push(!decorated && !holds(body, (n) => (n.of === "stmt" && (n.node.kind === "class" || n.node.kind === "interface" || n.node.kind === "typeAlias" || n.node.kind === "enum" || n.node.kind === "comptime")) || (n.of === "expr" && n.node.kind === "comptime")));
  return close;
}

// Whether `body` holds a node `found` picks out.
function holds(body: Ref<Stmt[]>, found: (n: AnyNode) => boolean): boolean {
  let hit = false;
  walkWhile({ of: "stmts", node: body }, (n) => {
    if (hit) return false;
    hit = found(n);
    return !hit;
  });
  return hit;
}
