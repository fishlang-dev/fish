import type { Compilation } from "./compilation.fsh";
import { CompileError } from "./diag.fsh";
import { nextId, renumberTypeNode, respanFunc, Rewrites, walk, walkWhile } from "./nodes.fsh";
import { parse, type Declarator, type Expr, type Func, type Param, type Pattern, type Span, type Stmt, type SwitchCase, type TypeNode } from "./parser.fsh";
import { cloneExpr, cloneStmt, cloneTypeNode, rebuiltStmts } from "./rebuild.fsh";
import { markGenerated } from "./warnings.fsh";

// `@durable async function f(run: Durable, ...)`, lowered as its macro round applies it. Each
// await records what it gave in the run's store, through std:durable's Durable, before the run
// goes on; a run given its id again replays what it recorded, its awaits giving the recorded
// values without running, and records from the first await it hadn't finished. The arguments
// are the first step, so a resumed run has its own back. What a run keeps across an await is
// Json: the lowering types each such variable with a JSON.stringify that never runs.

const WORK = "__durableWork";
const TYPE = "__DurableType";

// A variable in sight, declared, with a value, at `at`.
type Visible = { name: string; at: usize };
type Use = { name: string; at: usize };
// What lowering one function reads as it goes: its run's name, the type its Promise gives, every
// name it reads and where, and the awaits lowered.
type Lowering = { run: string; returns: TypeNode | undefined; uses: Use[]; handled: Set<usize> };

function durableError(message: string, start: usize, end: usize): CompileError {
  return new CompileError("E1108", message, start, end);
}

// `text`, statements, parsed with every span `at`'s.
/** @throws {CompileError | Error} */
function template(compilation: Mut<Compilation>, text: string, at: Ref<Span>): Stmt[] {
  let parsed = parse(`async function __durableTemplate() {\n${text}\n}`, compilation.ids);
  const made = parsed.shift();
  if (made === undefined || made.kind !== "function") throw new Error("internal error: a @durable function's lowering didn't parse");
  let placed = respanFunc(made, at);
  let body = placed.body;
  if (body === undefined) throw new Error("internal error: a @durable function's lowering has no body");
  return body;
}

// `text` with the await's operand for `__durableWork` and `type` for `__DurableType`, each
// place its own copy.
/** @throws {CompileError | Error} */
function step(compilation: Mut<Compilation>, text: string, at: Ref<Span>, work: Ref<Expr | undefined>, type: Ref<TypeNode | undefined>): Stmt[] {
  let made = template(compilation, text, at);
  let rewrites = new Rewrites();
  walk({ of: "stmts", node: made }, (n) => {
    if (n.of === "expr" && n.node.kind === "ident" && n.node.name === WORK && work !== undefined) rewrites.replace(n.node, cloneExpr(work));
    if (n.of === "typeNode" && n.node.kind === "ref" && n.node.name === TYPE && type !== undefined) rewrites.replaceTypeNode(n.node, renumberTypeNode(cloneTypeNode(type), () => nextId(compilation.ids)));
  });
  rebuiltStmts(made, rewrites);
  return made;
}

// Whether `v` is read after the await at `at`, or, inside a loop it was declared before, anywhere
// in the loop, as the loop's next turn reads it.
function lives(l: Ref<Lowering>, v: Ref<Visible>, at: Ref<Span>, loop: Ref<Span | undefined>): boolean {
  for (const u of l.uses) {
    if (u.name !== v.name) continue;
    if (u.at >= at.end) return true;
    if (loop !== undefined && v.at < loop.start && u.at >= loop.start && u.at < loop.end) return true;
  }
  return false;
}

// The checks that what lives across the await at `s` is Json.
/** @throws {CompileError | Error} */
function checks(compilation: Mut<Compilation>, l: Ref<Lowering>, s: Ref<Stmt>, visible: Ref<Visible[]>, loop: Ref<Span | undefined>): Stmt[] {
  let lines: string[] = [];
  for (const v of visible) if (lives(l, v, spanOf(s.start, s.end), loop)) lines.push(`if (${l.run}.__never()) JSON.stringify(${v.name});`);
  if (lines.length === 0) return [];
  let made = template(compilation, lines.join("\n"), spanOf(s.start, s.end));
  markGenerated(compilation.generated, { of: "stmts", node: made });
  return made;
}

// Moves every statement of `from` onto the end of `into`.
function append(into: Mut<Stmt[]>, from: Stmt[]): void {
  let rest = from;
  while (rest.length > 0) into.push(rest.shift()!);
}

function spanOf(start: usize, end: usize): Span {
  return { start, end };
}

function isAwait(e: Ref<Expr | undefined>): boolean {
  return e !== undefined && e.kind === "unary" && e.op === "await";
}

function operandOf(e: Ref<Expr>): Ref<Expr> {
  return e.kind === "unary" ? e.operand : e;
}

function copied(visible: Ref<Visible[]>): Visible[] {
  return visible.map((v) => ({ name: v.name, at: v.at }));
}

/** @throws {CompileError | Error} */
function lowerList(compilation: Mut<Compilation>, l: Mut<Lowering>, list: Ref<Stmt[]>, visible: Ref<Visible[]>, loop: Ref<Span | undefined>): Stmt[] {
  let seen = copied(visible);
  let out: Stmt[] = [];
  for (const s of list) {
    append(out, lowerStmt(compilation, l, s, seen, loop));
    if (s.kind === "let") for (const d of s.declarations) {
      const target: Ref<Pattern> = d.target;
      if (d.init !== undefined && target.kind === "ident") seen.push({ name: target.name, at: s.start });
    }
  }
  return out;
}

// A list lowered as one statement, a block when it became more than one.
/** @throws {CompileError | Error} */
function lowerOne(compilation: Mut<Compilation>, l: Mut<Lowering>, s: Ref<Stmt>, visible: Ref<Visible[]>, loop: Ref<Span | undefined>): Stmt {
  let made = lowerStmt(compilation, l, s, visible, loop);
  if (made.length === 1) return made.pop()!;
  return { id: nextId(compilation.ids), kind: "block", body: made, start: s.start, end: s.end };
}

/** @throws {CompileError | Error} */
function lowerStmt(compilation: Mut<Compilation>, l: Mut<Lowering>, s: Ref<Stmt>, visible: Ref<Visible[]>, loop: Ref<Span | undefined>): Stmt[] {
  const run = l.run;
  if (s.kind === "expr" && isAwait(s.expr)) {
    l.handled.add(s.expr.id);
    let out = checks(compilation, l, s, visible, loop);
    append(out, step(compilation, `await ${run}.__pass(${WORK});`, spanOf(s.start, s.end), operandOf(s.expr), undefined));
    return out;
  }
  if (s.kind === "expr") {
    const e: Ref<Expr> = s.expr;
    if (e.kind === "assign" && isAwait(e.value)) {
      const target: Ref<Expr> = e.target;
      if (e.op !== "=" || target.kind !== "ident") throw durableError("in a @durable function, an await assigned is assigned to a variable with '=', as in 'x = await f();'", s.start, s.end);
      l.handled.add(e.value.id);
      const x = target.name;
      let out = checks(compilation, l, s, visible, loop);
      append(out, step(compilation, `${x} = await ${run}.__step(${WORK});`, spanOf(s.start, s.end), operandOf(e.value), undefined));
      return out;
    }
  }
  if (s.kind === "let" && s.declarations.some((d) => isAwait(d.init))) {
    if (s.keyword === "using" || s.keyword === "await using") throw durableError(`'${s.keyword}' can't hold what an await gives in a @durable function: what an await gives is recorded as JSON`, s.start, s.end);
    if (s.declarations.length !== 1) throw durableError("in a @durable function, a declaration holding an await declares one variable", s.start, s.end);
    const d: Ref<Declarator> = s.declarations[0]!;
    const init: Ref<Expr> = d.init!;
    const target: Ref<Pattern> = d.target;
    if (target.kind !== "ident") throw durableError("in a @durable function, what an await gives is held in a variable, not taken apart, as in 'const x: T = await f();'", d.start, d.end);
    const x = target.name;
    if (d.type === undefined) throw durableError(`write the type of '${x}', as in 'const ${x}: T = await ...': a @durable function records what an await gives as JSON, and reads it back as that type`, d.start, d.end);
    l.handled.add(init.id);
    const keyword = s.keyword;
    let out = checks(compilation, l, s, visible, loop);
    append(out, step(compilation, `${keyword} ${x}: ${TYPE} = await ${run}.__step<${TYPE}>(${WORK});`, spanOf(s.start, s.end), operandOf(init), d.type));
    return out;
  }
  if (s.kind === "return") {
    const value: Ref<Expr | undefined> = s.value;
    const nothing = l.returns === undefined;
    if (value !== undefined && isAwait(value)) {
      l.handled.add(value.id);
      let out = checks(compilation, l, s, visible, loop);
      const text = nothing
        ? `await ${run}.__pass(${WORK});\nawait ${run}.__finished();\nreturn;`
        : `{ const __durableResult: ${TYPE} = await ${run}.__step<${TYPE}>(${WORK}); await ${run}.__finished(); return __durableResult; }`;
      append(out, step(compilation, text, spanOf(s.start, s.end), operandOf(value), l.returns));
      return out;
    }
    if (value === undefined) return step(compilation, `{ await ${run}.__finished(); return; }`, spanOf(s.start, s.end), undefined, undefined);
    return step(compilation, nothing ? `{ ${WORK}; await ${run}.__finished(); return; }` : `{ const __durableResult: ${TYPE} = ${WORK}; await ${run}.__finished(); return __durableResult; }`, spanOf(s.start, s.end), value, l.returns);
  }
  if (s.kind === "if") {
    const then = lowerList(compilation, l, s.then, visible, loop);
    const given: Ref<Stmt[] | undefined> = s.else;
    const otherwise = given === undefined ? undefined : lowerList(compilation, l, given, visible, loop);
    return [{ ...s, cond: cloneExpr(s.cond), then, else: otherwise }];
  }
  if (s.kind === "while") {
    const body = lowerList(compilation, l, s.body, visible, { start: s.start, end: s.end });
    return [{ ...s, cond: cloneExpr(s.cond), body }];
  }
  if (s.kind === "doWhile") {
    const body = lowerList(compilation, l, s.body, visible, { start: s.start, end: s.end });
    return [{ ...s, cond: cloneExpr(s.cond), body }];
  }
  if (s.kind === "for") {
    let inner = copied(visible);
    const init: Ref<Stmt | undefined> = s.init;
    if (init !== undefined && init.kind === "let") for (const d of init.declarations) {
      const target: Ref<Pattern> = d.target;
      if (d.init !== undefined && target.kind === "ident") inner.push({ name: target.name, at: s.start });
    }
    const body = lowerList(compilation, l, s.body, inner, { start: s.start, end: s.end });
    return [{ ...s, body }];
  }
  if (s.kind === "forIn" || s.kind === "forOf") {
    if (s.await) throw durableError("'for await' isn't supported in a @durable function yet; await each value as a statement of its own", s.start, s.end);
    let inner = copied(visible);
    const left: Ref<Stmt | Pattern> = s.left;
    if (left.kind === "let") for (const d of left.declarations) {
      const target: Ref<Pattern> = d.target;
      if (target.kind === "ident") inner.push({ name: target.name, at: s.start });
    }
    const body = lowerList(compilation, l, s.body, inner, { start: s.start, end: s.end });
    return [{ ...s, body }];
  }
  if (s.kind === "block") return [{ ...s, body: lowerList(compilation, l, s.body, visible, loop) }];
  if (s.kind === "unsafe") return [{ ...s, body: lowerList(compilation, l, s.body, visible, loop) }];
  if (s.kind === "labeled") return [{ ...s, body: lowerOne(compilation, l, s.body, visible, loop) }];
  if (s.kind === "try") {
    const block = lowerList(compilation, l, s.block, visible, loop);
    let caught = copied(visible);
    const param: Ref<Pattern | undefined> = s.param;
    if (param !== undefined && param.kind === "ident") caught.push({ name: param.name, at: s.start });
    const given: Ref<Stmt[] | undefined> = s.handler;
    const handler = given === undefined ? undefined : lowerList(compilation, l, given, caught, loop);
    const last: Ref<Stmt[] | undefined> = s.finalizer;
    const finalizer = last === undefined ? undefined : lowerList(compilation, l, last, visible, loop);
    return [{ ...s, block, handler, finalizer }];
  }
  if (s.kind === "switch") {
    let cases: SwitchCase[] = [];
    for (const c of s.cases) cases.push({ ...c, body: lowerList(compilation, l, c.body, visible, loop) });
    return [{ ...s, discriminant: cloneExpr(s.discriminant), cases }];
  }
  return [cloneStmt(s)];
}

// The first await `body` holds outside the statements lowering records, which isn't one: an
// await inside a nested function is that function's.
function stray(body: Ref<Stmt[]>, handled: Ref<Set<usize>>): Span | undefined {
  let found: Span | undefined = undefined;
  walkWhile({ of: "stmts", node: body }, (n) => {
    if (found !== undefined) return false;
    if (n.of === "expr" && (n.node.kind === "arrow" || n.node.kind === "function" || n.node.kind === "class")) return false;
    if (n.of === "stmt" && (n.node.kind === "function" || n.node.kind === "class")) return false;
    if (n.of === "expr" && n.node.kind === "unary" && n.node.op === "await" && !handled.has(n.node.id)) found = { start: n.node.start, end: n.node.end };
    return true;
  });
  return found;
}

function names(body: Ref<Stmt[]>): Use[] {
  let uses: Use[] = [];
  walk({ of: "stmts", node: body }, (n) => {
    if (n.of === "expr" && n.node.kind === "ident") uses.push({ name: n.node.name, at: n.node.start });
  });
  return uses;
}

// What a function's `Promise<T>` gives, undefined for `Promise<void>`.
/** @throws {CompileError} */
function promised(f: Ref<Func>): TypeNode | undefined {
  const written: Ref<TypeNode | undefined> = f.returnType;
  const missing = `write what '${f.name}' gives, as in 'Promise<string>': a @durable function records what it awaits as JSON, and reads it back as that type`;
  if (written === undefined) throw durableError(missing, f.start, f.end);
  if (written.kind !== "ref" || written.name !== "Promise" || written.args.length !== 1) throw durableError(missing, written.start, written.end);
  const t: Ref<TypeNode> = written.args[0]!;
  if (t.kind === "ref" && t.name === "void" && t.args.length === 0) return undefined;
  return cloneTypeNode(t);
}

// The body of `@durable` function `f`, lowered. `at` is the decorator.
/** @throws {CompileError | Error} */
export function durableBody(compilation: Mut<Compilation>, f: Ref<Func>, at: Ref<Expr>): Stmt[] {
  if (!f.async || f.generator) throw durableError("'@durable' marks an async function, whose awaits it records", at.start, at.end);
  const body: Ref<Stmt[] | undefined> = f.body;
  if (body === undefined) throw durableError("'@durable' marks a function with a body", at.start, at.end);
  const wanted = `'${f.name}' takes its run first, a 'Durable' from std:durable, as in 'run: Durable': the run records each await`;
  if (f.params.length === 0) throw durableError(wanted, f.start, f.end);
  const first: Ref<Param> = f.params[0]!;
  const type: Ref<TypeNode | undefined> = first.type;
  const pattern: Ref<Pattern> = first.pattern;
  if (pattern.kind !== "ident" || type === undefined || type.kind !== "ref" || type.name !== "Durable" || type.args.length > 0) throw durableError(wanted, first.start, first.end);
  const run = pattern.name;
  let given: string[] = [];
  for (let i: usize = 1; i < f.params.length; i++) {
    const p: Ref<Param> = f.params[i]!;
    const named: Ref<Pattern> = p.pattern;
    if (named.kind !== "ident" || p.rest || p.optional || p.default !== undefined) throw durableError("a @durable function's arguments after its run are plain names, as in 'amount: i64': they are recorded as its first step", p.start, p.end);
    given.push(named.name);
  }
  let l: Lowering = { run, returns: promised(f), uses: names(body), handled: new Set<usize>() };
  let visible: Visible[] = [];
  let before: Stmt[] = [];
  let out: Stmt[] = [];
  // The arguments recorded, then taken into variables of their names inside the block, so a
  // resumed run reads those it was given first.
  if (given.length > 0) {
    const fields = given.join(", ");
    let args = template(compilation, `const __durableArgs = await ${run}.__args({ ${fields} });`, f);
    let taken = template(compilation, `let { ${fields} } = __durableArgs;`, f);
    markGenerated(compilation.generated, { of: "stmts", node: args });
    markGenerated(compilation.generated, { of: "stmts", node: taken });
    append(before, args);
    append(out, taken);
    for (const name of given) visible.push({ name, at: f.start });
  }
  append(out, lowerList(compilation, l, body, visible, undefined));
  const missed = stray(body, l.handled);
  if (missed !== undefined) throw durableError("in a @durable function, an await is a statement of its own, recorded as a step: 'await f();', 'const x: T = await f();', 'x = await f();' or 'return await f();'", missed.start, missed.end);
  let ends = false;
  if (body.length > 0) {
    const last: Ref<Stmt> = body[body.length - 1]!;
    ends = last.kind === "return" || last.kind === "throw";
  }
  if (!ends) append(out, template(compilation, `await ${run}.__finished();`, f));
  // A block of its own, so the recorded arguments' names hide the parameters'.
  before.push({ id: nextId(compilation.ids), kind: "block", body: out, start: f.start, end: f.end });
  return before;
}
