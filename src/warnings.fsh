import { bodyOf, type Arenas, type InstanceId, type LocalId } from "./arenas.fsh";
import type { Body, Instance } from "./check.fsh";
import type { Tables } from "./compilation.fsh";
import { CompileError } from "./diag.fsh";
import { walk, type AnyNode } from "./nodes.fsh";
import { nodeIdOf } from "./walk.fsh";
import type { Declarator, Expr, ObjectProp, Param, Pattern, Stmt } from "./parser.fsh";
import { stdModuleAt, textAt } from "./program.fsh";
import { STD_BASE } from "./std.fsh";

// What the compiler reports without failing the build: variables and parameters nothing reads,
// statements control can never reach, and calls that block an async function's thread.

// Marks every node of a tree a macro made as `generated`, which no warning points into: their
// author can't change them.
export function markGenerated(generated: Mut<Tables["generated"]>, root: AnyNode) {
  walk(root, (n) => {
    const id = nodeIdOf(n);
    if (id >= 0) generated.add({ id: id as usize });
  });
}

// The warnings for a checked program, in source order. `required` says whether a body's parameters
// are a signature's to decide, as an export's, an override's or an interface method's are.
// `declarations` are the `let` statements and parameters that declare a name, as the checker met
// them; every other node an instance's `locals` holds is a use of one.
export function warnings(tables: Ref<Tables>, compiled: Ref<InstanceId[]>, required: (b: Ref<Body>) => boolean): CompileError[] {
  let used = new Set<LocalId>();
  for (const id of compiled) {
    const i = tables.arenas.instanceOf(id);
    for (const at of i.locals.ids()) if (!tables.declarations.has(at)) used.add(i.locals.getById(at)!);
    if (i.captures !== undefined) for (const from of i.captures.values()) if (from !== "this") used.add(from);
    if (i.envs !== undefined) for (const e of i.envs.values()) for (const l of e.env) used.add(l);
    if (i.made !== undefined) {
      const lists = [...i.made.values()];
      for (const list of lists) for (const e of list) for (const l of e.env) used.add(l);
    }
  }
  // By where the name is written, since a generic body's instances, and a body checked again,
  // each declare it anew: it is unused only when no declaration of it is used.
  let found = new Map<usize, { warning: CompileError; used: boolean }>();
  for (const id of compiled) {
    const i = tables.arenas.instanceOf(id);
    const b = bodyOf(tables.arenas, i);
    if (inStd(tables, b.start) || tables.generated.has(b)) continue;
    for (const [node, lid] of i.locals) {
      if (!tables.declarations.has(node.id)) continue;
      const l = tables.arenas.localOf(lid);
      // A `using` binding holds its value to the end of its scope, which is its use.
      if (l.using === true) continue;
      // A parameter with a default is bound by the body's first statements, under its name.
      const param = l.param || tables.prologues.hasId(node.id);
      if (param && required(b)) continue;
      const at = l.param ? paramPattern(node) : variable(node);
      if (at === undefined || at.kind !== "ident" || tables.generated.has(at) || tables.generated.hasId(node.id) || !warnable(at.name)) continue;
      const what = param ? "parameter" : "variable";
      const seen = found.get(at.start);
      let entry = seen !== undefined ? seen : { warning: new CompileError("W0001", `unused ${what} '${at.name}'; if it's intentional, name it '_${at.name}'`, at.start, at.start + at.name.length), used: false };
      entry.used = entry.used || used.has(lid);
      found.set(at.start, entry);
    }
  }
  let unreachable = new Map<usize, CompileError>();
  for (const id of compiled) {
    const i = tables.arenas.instanceOf(id);
    const b = bodyOf(tables.arenas, i);
    if (!inStd(tables, b.start) && !tables.generated.has(b)) unreachableIn(tables, b.body, i, unreachable);
  }
  let all: CompileError[] = [];
  for (let entries = [...found.values()]; entries.length > 0; ) {
    const e = entries.shift()!;
    if (!e.used) all.push(e.warning);
  }
  all = all.concat([...unreachable.values()]);
  all = all.concat(blockingCalls(tables, compiled));
  all.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return all;
}

// A name `_` starts is meant to go unused, as in Rust and TypeScript; one that isn't an
// identifier is a variable the compiler made.
function warnable(name: string): boolean {
  return /^[A-Za-z$][\w$]*$/.test(name) && name !== "this";
}

// The pattern a parameter declares: of the nodes a name is declared by, only a parameter has no kind.
function paramPattern(node: Ref<Expr | Stmt | Param | ObjectProp>): Ref<Pattern> | undefined {
  return "kind" in node ? undefined : node.pattern;
}

// The name a `let` declares. A nested function is a `const` of the arrow it became, spanning the
// whole function, and is no variable.
function variable(s: Ref<Expr | Stmt | Param | ObjectProp>): Ref<Pattern> | undefined {
  if (!("kind" in s) || s.kind !== "let") return undefined;
  const d: Ref<Declarator> = s.declarations[0]!;
  if (d.init !== undefined && d.init.kind === "arrow" && d.init.start === d.target.start) return undefined;
  return d.target;
}

// Reports the first statement after one control never passes, once per such run, in these
// statements and the blocks inside them.
function unreachableIn(tables: Ref<Tables>, stmts: Ref<Stmt[]>, i: Ref<Instance>, out: Mut<Map<usize, CompileError>>) {
  for (let k: usize = 0; k < stmts.length; k++) {
    const s: Ref<Stmt> = stmts[k]!;
    unreachableInBlocks(tables, s, i, out);
    const why = leaves(tables.arenas, s, i);
    if (why === undefined) continue;
    for (let j = k + 1; j < stmts.length; j++) {
      const x: Ref<Stmt> = stmts[j]!;
      if (HOISTED.has(x.kind) || (x.kind === "let" && variable(x) === undefined) || tables.generated.has(x)) continue;
      if (x.start < STD_BASE) out.set(x.start, new CompileError("W0002", `unreachable code after ${why}`, x.start, x.end));
      break;
    }
    return;
  }
}

// Declarations that stand anywhere in their block, as TypeScript's hoisting allows.
const HOISTED = new Set(["empty", "function", "typeAlias", "interface", "class", "enum", "declare"]);

// What leaves a statement for good: a jump, or a call typed `never`.
function leaves(arenas: Ref<Arenas>, s: Ref<Stmt>, i: Ref<Instance>): string | undefined {
  if (s.kind === "return" || s.kind === "throw" || s.kind === "break" || s.kind === "continue") return `'${s.kind}'`;
  if (s.kind === "expr" && s.expr.kind === "call") {
    const t = i.types.get(s.expr);
    const callee = arenas.instanceOf(i.calls.get(s.expr));
    const returns = t !== undefined ? t : callee !== undefined ? callee.returns : undefined;
    if (returns === "never") return "a call that never returns";
  }
  return undefined;
}

// Reports unreachable code in the statement lists directly inside a statement.
function unreachableInBlocks(tables: Ref<Tables>, s: Ref<Stmt>, i: Ref<Instance>, out: Mut<Map<usize, CompileError>>): void {
  switch (s.kind) {
    case "if":
      unreachableIn(tables, s.then, i, out);
      if (s.else !== undefined) unreachableIn(tables, s.else, i, out);
      return;
    case "block":
    case "unsafe":
    case "comptime":
    case "while":
    case "doWhile":
    case "for":
    case "forOf":
    case "forIn":
      unreachableIn(tables, s.body, i, out);
      return;
    case "labeled":
      unreachableInBlocks(tables, s.body, i, out);
      return;
    case "try":
      unreachableIn(tables, s.block, i, out);
      if (s.handler !== undefined) unreachableIn(tables, s.handler, i, out);
      if (s.finalizer !== undefined) unreachableIn(tables, s.finalizer, i, out);
      return;
    case "switch":
      for (const c of s.cases) unreachableIn(tables, c.body, i, out);
      return;
    default:
      return;
  }
}

// Each call a user's async function or async arrow makes that blocks the thread it runs on, by
// where the call is written: of a function `@blocking` marks, or of sync functions that reach one.
// An async `main`'s own calls of a marked function are left out.
function blockingCalls(tables: Ref<Tables>, compiled: Ref<InstanceId[]>): CompileError[] {
  // Each instance's chain of calls to a blocking function; empty for none, and while being found.
  let chains = new Map<InstanceId, string[]>();
  let out = new Map<usize, CompileError>();
  for (const id of compiled) {
    const b = bodyOf(tables.arenas, tables.arenas.instanceOf(id));
    if (b.async !== true || inStd(tables, b.start) || tables.generated.has(b) || tables.blockingTasks.has(b.start)) continue;
    // A program's async `main` blocks nothing else by calling a blocking function itself, as it
    // starts before any other task; what it calls that blocks still warns.
    const entry = b.name === "main" && b.closure === undefined && b.owner === undefined;
    blockingIn(tables, id, entry, chains, out);
  }
  return [...out.values()];
}

// The blocking calls an async body makes, and those of the sync closures written in it.
function blockingIn(tables: Ref<Tables>, id: InstanceId, entry: boolean, chains: Mut<Map<InstanceId, string[]>>, out: Mut<Map<usize, CompileError>>): void {
  const i = tables.arenas.instanceOf(id);
  for (const at of i.calls.ids()) {
    const callee = i.calls.getById(at)!;
    // A closure written here is looked into on its own, at its calls.
    const c = bodyOf(tables.arenas, tables.arenas.instanceOf(callee)).closure;
    if (c !== undefined && c.parent === id) continue;
    let chain = chainOf(tables, callee, chains);
    const span = i.calls.spanById(at);
    if (chain.length === 0 || (entry && chain.length === 1) || span === undefined || inStd(tables, span.start) || tables.generated.hasId(at)) continue;
    // Named as written: std may run a call by another name, as `readFileSync(p, "utf8")` runs
    // `readFileSyncText`.
    const written = /^[\w$.]+(?=\s*(<.*>)?\s*\()/.exec(textAt(tables.files, span));
    if (written !== null) chain[0] = written[0];
    out.set(span.start, new CompileError("W0004", blockingMessage(chain), span.start, span.end));
  }
  for (const c of inlineClosures(tables, id)) blockingIn(tables, c, entry, chains, out);
}

// The calls by which running an instance reaches a blocking function, from its own name to that
// function's. Empty when it reaches none, and for an async function or a generator, whose call
// only makes a future or a generator.
function chainOf(tables: Ref<Tables>, id: InstanceId, chains: Mut<Map<InstanceId, string[]>>): string[] {
  const known = chains.get(id);
  if (known !== undefined) return [...known];
  const b = bodyOf(tables.arenas, tables.arenas.instanceOf(id));
  if (b.blocking === true) {
    chains.set(id, [b.name]);
    return [b.name];
  }
  chains.set(id, []);
  if (b.async === true || b.generator === true || tables.blockingTasks.has(b.start)) return [];
  // std marks what of its own blocks: a sync std function that isn't marked, like 'Bun.spawn'
  // looking a command up on PATH, blocks only as briefly as any call does. Its overload
  // signatures, lowered to functions named with a space, are looked through to the implementation.
  if (inStd(tables, b.start) && !b.name.includes(" ")) return [];
  const i = tables.arenas.instanceOf(id);
  let found: string[] = [];
  for (const at of i.calls.ids()) {
    if (found.length === 0) found = chainOf(tables, i.calls.getById(at)!, chains);
  }
  for (const c of inlineClosures(tables, id)) {
    if (found.length === 0) found = chainOf(tables, c, chains);
  }
  // A closure is named for the function it is written in, which the chain already names, and an
  // overload signature lowered to a function of its own, by a name with a space, for its
  // implementation.
  if (found.length > 0 && b.closure === undefined && !b.name.includes(" ")) found.unshift(b.name);
  chains.set(id, [...found]);
  return found;
}

// The sync closures written directly in a body, which run on its thread unless `spawnBlocking`
// runs them.
function inlineClosures(tables: Ref<Tables>, id: InstanceId): InstanceId[] {
  let out: InstanceId[] = [];
  const i = tables.arenas.instanceOf(id);
  if (i.inner === undefined) return out;
  for (const c of i.inner) {
    const x = tables.arenas.instanceOf(c);
    const b = bodyOf(tables.arenas, x);
    if (x.retired === true || b.closure === undefined || b.closure.parent !== id) continue;
    if (b.async !== true && b.generator !== true && !tables.blockingTasks.has(b.start)) out.push(c);
  }
  return out;
}

// Whether an offset is in std: its prelude, or one of its modules.
function inStd(tables: Ref<Tables>, offset: usize): boolean {
  return offset >= STD_BASE || stdModuleAt(tables.files, offset) !== undefined;
}

function blockingMessage(chain: Ref<string[]>): string {
  const called = chain[0]!;
  const fix = "call it inside 'spawnBlocking(() => ...)' to run it on the blocking pool";
  if (chain.length === 1) return `'${called}' blocks the thread this async function runs on; ${fix}`;
  return `'${called}' blocks the thread this async function runs on, by calling '${chain[chain.length - 1]!}' (${chain.join(" -> ")}); ${fix}`;
}
