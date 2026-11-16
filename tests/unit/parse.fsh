// Ports tests/parse.test.ts. Each table is one test looping over its rows, and the source being
// shown is passed along rather than kept in a module-level variable.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { CompileError } from "../compiler/diag.fsh";
import { walk } from "../compiler/nodes.fsh";
import { programShape } from "../compiler/printer.fsh";
import { parse, type ClassMember, type ClassNode, type Expr, type Param, type Pattern, type PropertyName, type Declarator, type Specifier, type Stmt, type TypeMember, type TypeNode, type TypeParam } from "../compiler/parser.fsh";
import { read, root } from "./support.fsh";

function list(xs: Ref<TypeNode[]>, src: string, sep: string): string {
  let out: string[] = [];
  for (const x of xs) out.push(show(x, src));
  return out.join(sep);
}

function typeArgs(xs: Ref<TypeNode[]>, src: string): string {
  return xs.length > 0 ? `<${list(xs, src, ", ")}>` : "";
}

// Prints a type with every composite part parenthesised, so the table shows how it grouped.
function show(t: Ref<TypeNode>, src: string): string {
  switch (t.kind) {
    case "ref":
      return `${t.name}${typeArgs(t.args, src)}`;
    case "literal":
      return src.slice(t.start as i64, t.end as i64);
    case "array":
      return `(${show(t.element, src)}[])`;
    case "union":
      return `(${list(t.types, src, " | ")})`;
    case "intersection":
      return `(${list(t.types, src, " & ")})`;
    case "operator":
      return `${t.op} ${show(t.type, src)}`;
    case "indexed":
      return `(${show(t.object, src)}[${show(t.index, src)}])`;
    case "query":
      return `typeof ${show(t.target, src)}`;
    case "tuple": {
      let out: string[] = [];
      for (const e of t.elements) {
        const name = e.name === undefined ? "" : `${e.name}${e.optional ? "?" : ""}: `;
        out.push(`${e.rest ? "..." : ""}${name}${show(e.type, src)}${e.name === undefined && e.optional ? "?" : ""}`);
      }
      return `[${out.join(", ")}]`;
    }
    case "object": {
      let out: string[] = [];
      for (const m of t.members) out.push(showMember(m, src));
      return `{ ${out.join("; ")} }`;
    }
    case "function": {
      const prefix = t.construct ? `${t.abstract ? "abstract " : ""}new ` : "";
      const throws = t.throws !== undefined ? ` throws ${show(t.throws, src)}` : "";
      return `(${prefix}${typeParams(t.typeParams)}(${showParams(t.params, src)}) => ${show(t.returns, src)}${throws})`;
    }
    case "import":
      return `import("${t.module}")${t.name !== undefined ? `.${t.name}` : ""}${typeArgs(t.args, src)}`;
    case "conditional":
      return `(${show(t.check, src)} extends ${show(t.extends, src)} ? ${show(t.then, src)} : ${show(t.else, src)})`;
    case "infer":
      return `(infer ${t.name}${t.constraint !== undefined ? ` extends ${show(t.constraint, src)}` : ""})`;
    case "mapped": {
      const readonly = t.readonly !== undefined ? `${t.readonly}readonly ` : "";
      const as = t.as !== undefined ? ` as ${show(t.as, src)}` : "";
      const optional = t.optional !== undefined ? `${t.optional}?` : "";
      return `{ ${readonly}[${t.name} in ${show(t.constraint, src)}${as}]${optional}${t.type !== undefined ? `: ${show(t.type, src)}` : ""} }`;
    }
    case "template": {
      let out = "";
      for (let i: usize = 0; i < t.quasis.length; i++) {
        if (i > 0) out += `\${${show(t.types[i - 1]!, src)}}`;
        out += t.quasis[i]!;
      }
      return `\`${out}\``;
    }
    case "predicate":
      return `${t.asserts ? "asserts " : ""}${t.name}${t.type !== undefined ? ` is ${show(t.type, src)}` : ""}`;
  }
  return "";
}

function typeParams(ps: Ref<TypeParam[]>): string {
  let names: string[] = [];
  for (const p of ps) names.push(p.name);
  return names.length > 0 ? `<${names.join(", ")}>` : "";
}

function returns(r: Ref<TypeNode | undefined>, src: string): string {
  return r !== undefined ? `: ${show(r, src)}` : "";
}

// Each member is prefixed with its kind, so a property named `get` can't pass for an accessor.
function showMember(m: Ref<TypeMember>, src: string): string {
  switch (m.kind) {
    case "property":
      return `property ${m.readonly ? "readonly " : ""}${showName(m.name, src)}${m.optional ? "?" : ""}${m.type !== undefined ? `: ${show(m.type, src)}` : ""}`;
    case "method":
      return `method ${showName(m.name, src)}${m.optional ? "?" : ""}(${showParams(m.params, src)})${returns(m.returns, src)}`;
    case "call":
    case "construct":
      return `${m.kind} (${showParams(m.params, src)})${returns(m.returns, src)}`;
    case "index":
      return `index ${m.readonly ? "readonly " : ""}[${showParams(m.params, src)}]: ${show(m.type, src)}`;
    case "get":
    case "set":
      return `${m.kind} ${showName(m.name, src)}(${showParams(m.params, src)})${returns(m.returns, src)}`;
  }
  return "";
}

function showName(name: Ref<PropertyName>, src: string): string {
  return typeof name === "string" ? name : `[${src.slice(name.start as i64, name.end as i64)}]`;
}

function decorators(ds: Ref<Expr[]>, src: string): string {
  let out = "";
  for (const d of ds) out += `@${showExpr(d, src)} `;
  return out;
}

function showParams(params: Ref<Param[]>, src: string): string {
  let out: string[] = [];
  for (const p of params) {
    let modifiers = "";
    for (const m of p.modifiers) modifiers += `${m} `;
    const name = `${p.comptime ? "comptime " : ""}${decorators(p.decorators, src)}${modifiers}${p.rest ? "..." : ""}${showPattern(p.pattern, src)}${p.optional ? "?" : ""}`;
    const fallback = p.default !== undefined ? ` = ${showExpr(p.default, src)}` : "";
    out.push(`${p.type !== undefined ? `${name}: ${show(p.type, src)}` : name}${fallback}`);
  }
  return out.join(", ");
}

function args(xs: Ref<Expr[]>, src: string): string {
  let out: string[] = [];
  for (const x of xs) out.push(showExpr(x, src));
  return `(${out.join(", ")})`;
}

// Prints an expression with every operator application parenthesised. Member chains print
// as written, and a `new` is wrapped whole, so `(new C()).x` and `new (a.b)()` read clearly.
function showExpr(e: Ref<Expr>, src: string): string {
  switch (e.kind) {
    case "int":
    case "float":
    case "bigint":
    case "bool":
    case "string":
    case "null":
    case "this":
    case "super":
    case "regex":
    case "template":
    case "ident":
    case "meta":
    case "object":
    case "function":
    case "privateName":
      return src.slice(e.start as i64, e.end as i64);
    case "spread":
      return `...${showExpr(e.value, src)}`;
    case "array": {
      let out: string[] = [];
      for (const x of e.elements) out.push(x !== undefined ? showExpr(x, src) : "");
      return `[${out.join(", ")}]`;
    }
    case "member":
      return `${showExpr(e.object, src)}${e.optional ? "?." : "."}${e.name}`;
    case "index":
      return `${showExpr(e.object, src)}${e.optional ? "?." : ""}[${showExpr(e.index, src)}]`;
    case "call":
      return `${showExpr(e.callee, src)}${e.optional ? "?." : ""}${typeArgs(e.typeArgs, src)}${args(e.args, src)}`;
    case "new": {
      const callee = e.callee.kind === "ident" || e.callee.kind === "new" ? showExpr(e.callee, src) : `(${showExpr(e.callee, src)})`;
      return `(new ${callee}${typeArgs(e.typeArgs, src)}${e.args !== undefined ? args(e.args, src) : ""})`;
    }
    case "instantiation":
      return `${showExpr(e.expr, src)}${typeArgs(e.typeArgs, src)}`;
    case "tagged":
      return `${showExpr(e.tag, src)}${typeArgs(e.typeArgs, src)}${showExpr(e.template, src)}`;
    case "import":
      return `import${args(e.args, src)}`;
    case "nonNull":
      return `${showExpr(e.expr, src)}!`;
    case "throw":
      return `(throw ${showExpr(e.value, src)})`;
    case "unary":
      return `(${e.op}${/\w/.test(e.op) ? " " : ""}${showExpr(e.operand, src)})`;
    case "update":
      return e.prefix ? `(${e.op}${showExpr(e.operand, src)})` : `(${showExpr(e.operand, src)}${e.op})`;
    case "binary":
      return `(${showExpr(e.left, src)} ${e.op} ${showExpr(e.right, src)})`;
    case "conditional":
      return `(${showExpr(e.cond, src)} ? ${showExpr(e.then, src)} : ${showExpr(e.else, src)})`;
    case "assign":
      return `(${showExpr(e.target, src)} ${e.op} ${showExpr(e.value, src)})`;
    case "sequence": {
      let out: string[] = [];
      for (const x of e.exprs) out.push(showExpr(x, src));
      return `(${out.join(", ")})`;
    }
    case "yield":
      return `(yield${e.delegate ? "*" : ""}${e.value !== undefined ? ` ${showExpr(e.value, src)}` : ""})`;
    case "as":
    case "satisfies":
      return `(${showExpr(e.expr, src)} ${e.kind} ${show(e.type, src)})`;
    case "assertion":
      return `(<${show(e.type, src)}>${showExpr(e.expr, src)})`;
    case "destructure":
      return `(${showPattern(e.pattern, src)} = ${showExpr(e.value, src)})`;
    case "pipe":
      return `(${showExpr(e.value, src)} |> ${showExpr(e.body, src)})`;
    case "topic":
      return "%";
    case "comptime":
      return `(comptime ${showExpr(e.expr, src)})`;
    case "unsafe":
      return `(unsafe ${showExpr(e.expr, src)})`;
    case "match": {
      let arms: string[] = [];
      for (const a of e.arms) {
        const guard = a.guard !== undefined ? ` if ${showExpr(a.guard, src)}` : "";
        const body = a.body.kind === "block" ? `{ ${a.body.body.length} statements }` : showExpr(a.body, src);
        arms.push(`case ${showPattern(a.pattern, src)}${guard} => ${body}`);
      }
      return `match (${showExpr(e.subject, src)}) { ${arms.join(", ")} }`;
    }
    case "class":
      return showClass(e, src);
    case "arrow": {
      const ret = `${returns(e.returnType, src)}${e.throws !== undefined ? ` throws ${show(e.throws, src)}` : ""}`;
      const body = Array.isArray(e.body) ? `{ ${e.body.length} statements }` : showExpr(e.body, src);
      return `(${e.async ? "async " : ""}${typeParams(e.typeParams)}(${showParams(e.params, src)})${ret} => ${body})`;
    }
  }
  return "";
}

// Prints a pattern with every default parenthesised and every property written `key: value`.
function showPattern(p: Ref<Pattern>, src: string): string {
  switch (p.kind) {
    case "ident":
      return p.name;
    case "object": {
      let out: string[] = [];
      for (const x of p.props) out.push(`${showName(x.key, src)}: ${showPattern(x.value, src)}`);
      const rest = p.rest !== undefined ? `${p.props.length > 0 ? ", " : ""}...${showPattern(p.rest, src)}` : "";
      return `{ ${out.join(", ")}${rest} }`;
    }
    case "array": {
      let out: string[] = [];
      for (const x of p.elements) out.push(x !== undefined ? showPattern(x, src) : "");
      const rest = p.rest !== undefined ? `${p.elements.length > 0 ? ", " : ""}...${showPattern(p.rest, src)}` : "";
      return `[${out.join(", ")}${rest}]`;
    }
    case "default":
      return `(${showPattern(p.target, src)} = ${showExpr(p.value, src)})`;
    case "expr":
      return showExpr(p.expr, src);
    case "wildcard":
      return "_";
    case "literal":
      return showExpr(p.value, src);
    case "variant": {
      if (p.args === undefined) return p.name;
      let out: string[] = [];
      for (const x of p.args) out.push(showPattern(x, src));
      return `${p.name}(${out.join(", ")})`;
    }
    case "or": {
      let out: string[] = [];
      for (const x of p.patterns) out.push(showPattern(x, src));
      return `(${out.join(" | ")})`;
    }
  }
  return "";
}

function showStmts(ss: Ref<Stmt[]>, src: string, sep: string): string {
  let out: string[] = [];
  for (const s of ss) out.push(showStmt(s, src));
  return out.join(sep);
}

function showSpecifiers(xs: Ref<Specifier[]>): string {
  let out: string[] = [];
  for (const x of xs) out.push(`${x.typeOnly ? "type " : ""}${x.name}${x.alias !== undefined ? ` as ${x.alias}` : ""}`);
  return out.join(", ");
}

// A loop's left side: a declaration or, failing that, a pattern.
function showLeft(left: Ref<Stmt | Pattern>, src: string): string {
  switch (left.kind) {
    case "let": return showStmt(left, src);
    case "ident": return showPattern(left, src);
    case "default": return showPattern(left, src);
    case "expr": return showPattern(left, src);
    case "array": return showPattern(left, src);
    case "object": return showPattern(left, src);
    case "wildcard": return showPattern(left, src);
    case "literal": return showPattern(left, src);
    case "variant": return showPattern(left, src);
    case "or": return showPattern(left, src);
  }
  return "";
}

// Prints a statement's head: declarations and loop headers, which is where grouping matters.
function showStmt(s: Ref<Stmt>, src: string): string {
  switch (s.kind) {
    case "let": {
      let out: string[] = [];
      for (const d of s.declarations) out.push(`${showPattern(d.target, src)}${d.init !== undefined ? ` = ${showExpr(d.init, src)}` : ""}`);
      return `${s.keyword} ${out.join(", ")}`;
    }
    case "expr":
      return showExpr(s.expr, src);
    case "for":
      return `for (${s.init !== undefined ? showStmt(s.init, src) : ""}; ${s.test !== undefined ? showExpr(s.test, src) : ""}; ${s.update !== undefined ? showExpr(s.update, src) : ""})`;
    case "forIn":
    case "forOf": {
      const left = showLeft(s.left, src);
      return `for${s.await ? " await" : ""} (${left} ${s.kind === "forIn" ? "in" : "of"} ${showExpr(s.right, src)})`;
    }
    case "doWhile":
      return `do { ${s.body.length} statements } while (${showExpr(s.cond, src)})`;
    case "function":
      return `${s.macro ? "macro " : ""}function ${s.name}(${showParams(s.params, src)})${s.body !== undefined ? ` { ${s.body.length} }` : ";"}`;
    case "comptime":
      return `comptime { ${s.body.length} }`;
    case "unsafe":
      return `unsafe { ${s.body.length} }`;
    case "import": {
      let clauses: string[] = [];
      if (s.default !== undefined) clauses.push(s.default);
      if (s.namespace !== undefined) clauses.push(`* as ${s.namespace}`);
      if (s.named !== undefined) clauses.push(`{ ${showSpecifiers(s.named)} }`);
      const from = clauses.length > 0 ? `${clauses.join(", ")} from ` : "";
      return `import ${s.typeOnly ? "type " : ""}${s.defer ? "defer " : ""}${from}"${s.module}"${s.attributes !== undefined ? ` with ${showExpr(s.attributes, src)}` : ""}`;
    }
    case "export":
      return `export ${showStmt(s.body, src)}`;
    case "exportDefault":
      if (s.declaration !== undefined) return `export default ${showStmt(s.declaration, src)}`;
      return `export default (${s.value !== undefined ? showExpr(s.value, src) : ""})`;
    case "exportNamed":
      return `export ${s.typeOnly ? "type " : ""}{ ${showSpecifiers(s.specifiers)} }${s.module !== undefined ? ` from "${s.module}"` : ""}`;
    case "exportAll":
      return `export ${s.typeOnly ? "type " : ""}*${s.alias !== undefined ? ` as ${s.alias}` : ""} from "${s.module}"`;
    case "exportAssign":
      return `export = ${showExpr(s.value, src)}`;
    case "exportAsNamespace":
      return `export as namespace ${s.name}`;
    case "class":
      return showClass(s, src);
    case "interface":
      return `interface ${s.name}`;
    case "importEquals":
      return `import ${s.typeOnly ? "type " : ""}${s.name} = ${s.require !== undefined ? `require("${s.require}")` : s.entity ?? ""}`;
    case "switch": {
      let cases: string[] = [];
      for (const k of s.cases) cases.push(`${k.test !== undefined ? `case ${showExpr(k.test, src)}` : "default"}: ${showStmts(k.body, src, "; ")}`);
      return `switch (${showExpr(s.discriminant, src)}) { ${cases.join(" | ")} }`;
    }
    case "labeled":
      return `${s.label}: ${showStmt(s.body, src)}`;
    case "break":
    case "continue":
      return s.label !== undefined ? `${s.kind} ${s.label}` : s.kind;
    case "throw":
      return `throw ${showExpr(s.value, src)}`;
    case "try": {
      const binding = s.param !== undefined ? ` (${showPattern(s.param, src)}${s.paramType !== undefined ? `: ${show(s.paramType, src)}` : ""})` : "";
      const handler = s.handler !== undefined ? ` catch${binding} { ${s.handler.length} }` : "";
      return `try { ${s.block.length} }${handler}${s.finalizer !== undefined ? ` finally { ${s.finalizer.length} }` : ""}`;
    }
  }
  return s.kind;
}

// A class's header, then each member as `kind name` with its modifiers and decorators.
function showClass(k: Ref<ClassNode & { kind: "class" }>, src: string): string {
  let implemented = "";
  if (k.implements.length > 0) implemented = ` implements ${list(k.implements, src, ", ")}`;
  const heritage = `${k.extends !== undefined ? ` extends ${showExpr(k.extends, src)}` : ""}${implemented}`;
  let members: string[] = [];
  for (const m of k.members) members.push(showClassMember(m, src));
  return `${decorators(k.decorators, src)}${k.abstract ? "abstract " : ""}class${k.name !== undefined ? ` ${k.name}` : ""}${heritage} { ${members.join("; ")} }`;
}

function body(b: Ref<Stmt[] | undefined>): string {
  return b !== undefined ? ` { ${b.length} }` : ";";
}

function showClassMember(m: Ref<ClassMember>, src: string): string {
  let prefix = decorators(m.decorators, src);
  for (const x of m.modifiers) prefix += `${x} `;
  switch (m.kind) {
    case "field":
      return `${prefix}field ${showName(m.name, src)}${m.optional ? "?" : ""}${m.definite ? "!" : ""}${m.type !== undefined ? `: ${show(m.type, src)}` : ""}${m.init !== undefined ? ` = ${showExpr(m.init, src)}` : ""}`;
    case "method":
      return `${prefix}method ${m.generator ? "*" : ""}${showName(m.name, src)}${m.optional ? "?" : ""}(${showParams(m.params, src)})${body(m.body)}`;
    case "constructor":
      return `${prefix}constructor(${showParams(m.params, src)})${body(m.body)}`;
    case "get":
    case "set":
      return `${prefix}${m.kind} ${showName(m.name, src)}(${showParams(m.params, src)})${body(m.body)}`;
    case "index":
      return `${prefix}index [${showParams(m.params, src)}]: ${show(m.type, src)}`;
    case "staticBlock":
      return `static block { ${m.body.length} }`;
  }
  return "";
}

// `src` parsed, as the statements of `function f`'s body, or the error it throws as "error: <message>".
function inFunction(src: string, each: (body: Ref<Stmt[]>) => string): string {
  try {
    const program = parse(src, { last: 0 });
    if (program.length === 0) return "no function";
    const f: Ref<Stmt> = program[0]!;
    if (f.kind !== "function" || f.body === undefined) return "no function";
    return each(f.body);
  } catch (e) {
    return `error: ${e.message}`;
  }
}

function typeShape(type: string): string {
  const src = `function f(): ${type} {}`;
  try {
    const program = parse(src, { last: 0 });
    if (program.length === 0) return "no function";
    const f: Ref<Stmt> = program[0]!;
    if (f.kind !== "function" || f.returnType === undefined) return "no function";
    return show(f.returnType, src);
  } catch (e) {
    return `error: ${e.message}`;
  }
}

function exprShape(expr: string): string {
  const src = `function f() {\n  let x = ${expr}\n}`;
  return inFunction(src, (stmts): string => {
    if (stmts.length === 0) return "expected a let statement";
    const s: Ref<Stmt> = stmts[0]!;
    if (s.kind !== "let") return "expected a let statement";
    const d: Ref<Declarator> = s.declarations[0]!;
    if (d.init === undefined) return "expected an initializer";
    return showExpr(d.init, src);
  });
}

function patternShape(stmt: string): string {
  const src = `function f() {\n  ${stmt}\n}`;
  return inFunction(src, (stmts): string => {
    if (stmts.length === 0) return "expected a statement";
    const s: Ref<Stmt> = stmts[0]!;
    if (s.kind !== "let") return "expected a declaration";
    return showPattern(s.declarations[0]!.target, src);
  });
}

function statementsShape(stmts: string): string {
  const src = `function f() {\n  ${stmts}\n}`;
  return inFunction(src, (body) => showStmts(body, src, "; "));
}

function classShape(stmt: string): string {
  const src = `function f() {\n  ${stmt}\n}`;
  return inFunction(src, (stmts): string => {
    if (stmts.length === 0) return "expected a class";
    const s: Ref<Stmt> = stmts[0]!;
    if (s.kind !== "class") return "expected a class";
    return showClass(s, src);
  });
}

// Checks every row of a table, failing with each row that differs. A row expecting "error" must
// throw a message containing `error`.
function table(rows: Ref<[string, string][]>, shape: (src: string) => string, error: string): void {
  let failed: string[] = [];
  for (const row of rows) {
    const got = shape(row[0]);
    const ok = row[1] === "error" ? got.startsWith("error: ") && got.includes(error) : got === row[1];
    if (!ok) failed.push(`${row[0]}:\n--- expected\n${row[1]}\n--- got\n${got}`);
  }
  assert(failed.length === 0, failed.join("\n\n"));
}

// That `got` is an error whose message holds `message`.
function throwsWith(got: string, message: string, what: string): void {
  assert(got.startsWith("error: ") && got.includes(message), `${what}: expected an error with '${message}', got ${got}`);
}

const SHAPES: [string, string][] = [
  ["A", "A"],
  ["A.B.C<D<E>>", "A.B.C<D<E>>"],
  ["A<B<C>>", "A<B<C>>"],
  ["Map<string, Array<i64>>", "Map<string, Array<i64>>"],
  ["A | B & C", "(A | (B & C))"],
  ["A & B | C", "((A & B) | C)"],
  ["| A | B", "(A | B)"],
  ["& A", "A"],
  ["(A | B)[]", "((A | B)[])"],
  ["keyof A[]", "keyof (A[])"],
  ["keyof A | B", "(keyof A | B)"],
  ["readonly string[][]", "readonly ((string[])[])"],
  ["A[B][]", "((A[B])[])"],
  ["A[keyof B]", "(A[keyof B])"],
  ["unique symbol", "unique symbol"],
  ["typeof a.b<T>[]", "(typeof a.b<T>[])"],
  ["'a' | \"b\" | -1 | 2 | true", "('a' | \"b\" | -1 | 2 | true)"],
  ["[A, B?, ...C[]]", "[A, B?, ...(C[])]"],
  ["[a: A, b?: B, ...rest: C]", "[a: A, b?: B, ...rest: C]"],
  ["[]", "[]"],
  ["{}", "{  }"],
  ["{ a: A; readonly b?: B, c }", "{ property a: A; property readonly b?: B; property c }"],
  ["{ new: T; default: U; get: V; readonly: W }", "{ property new: T; property default: U; property get: V; property readonly: W }"],
  ["{ new (x: A): T; get x(): T; set x(v: T); get(): T }", "{ construct (x: A): T; get x(): T; set x(v: T); method get(): T }"],
  ["{ [k: string]: T; [Symbol.iterator](): T }", "{ index [k: string]: T; method [Symbol.iterator](): T }"],
  ["{ readonly [k: string]: T; readonly [key]: T }", "{ index readonly [k: string]: T; property readonly [key]: T }"],
  ["{ (x: A): B; <T>(x: T): T; m?<T>(x: T): T }", "{ call (x: A): B; call (x: T): T; method m?(x: T): T }"],
  ["{ 'quoted': A; 0: B }", "{ property quoted: A; property 0: B }"],
  ["() => A | B", "(() => (A | B))"],
  ["(A | B)[]", "((A | B)[])"],
  ["(a: A) => B", "((a: A) => B)"],
  ["(a) => B", "((a) => B)"],
  ["(A)", "A"],
  ["(\")\")", "\")\""],
  ["(a?: A, ...rest: B[]) => void", "((a?: A, ...rest: (B[])) => void)"],
  ["(this: Window, a, b) => void", "((this: Window, a, b) => void)"],
  ["<T>(x: T) => T", "(<T>(x: T) => T)"],
  ["new () => T", "(new () => T)"],
  ["abstract new (...args: A) => T", "(abstract new (...args: A) => T)"],
  ["(() => A)[]", "((() => A)[])"],
  ["(x: string) => i64 throws ParseError", "((x: string) => i64 throws ParseError)"],
  ["(() => void throws A | B)[]", "((() => void throws (A | B))[])"],
  ["(x: unknown) => x is string", "((x: unknown) => x is string)"],
  ["(x: unknown) => asserts x is string", "((x: unknown) => asserts x is string)"],
  ["(x: unknown) => asserts x", "((x: unknown) => asserts x)"],
  ["(asserts: unknown) => asserts is string", "((asserts: unknown) => asserts is string)"],
  ["this is Node", "this is Node"],
  ["is", "is"],
  ["asserts", "asserts"],
  ["{ m(x): x is A; get g(): asserts }", "{ method m(x): x is A; get g(): asserts }"],
  ["A extends B ? C : D extends E ? F : G", "(A extends B ? C : (D extends E ? F : G))"],
  ["A | B extends C ? D : E", "((A | B) extends C ? D : E)"],
  ["T extends infer U extends string ? U : never", "(T extends (infer U extends string) ? U : never)"],
  ["T extends [infer U extends string ? A : B] ? U : never", "(T extends [((infer U) extends string ? A : B)] ? U : never)"],
  ["T extends (infer U extends string ? A : B) ? U : never", "(T extends ((infer U) extends string ? A : B) ? U : never)"],
  ["T extends (x: infer A) => infer R ? R : never", "(T extends ((x: (infer A)) => (infer R)) ? R : never)"],
  ["(x: A) => B extends C ? D : E", "((x: A) => (B extends C ? D : E))"],
  ["infer", "infer"],
  ["{ [K in keyof T]: T[K] }", "{ [K in keyof T]: (T[K]) }"],
  ["{ readonly [K in T]?: V }", "{ +readonly [K in T]+?: V }"],
  ["{ -readonly [K in T]-?: V; }", "{ -readonly [K in T]-?: V }"],
  ["{ +readonly [K in T as N]+?: V }", "{ +readonly [K in T as N]+?: V }"],
  ["{ [K in T as Exclude<K, 'a'>]: V }", "{ [K in T as Exclude<K, 'a'>]: V }"],
  ["{ [K in T] }", "{ [K in T] }"],
  ["{ [K: string]: V }", "{ index [K: string]: V }"],
  ["import('m')", "import(\"m\")"],
  ["import(\"./m\").A.B<T>", "import(\"./m\").A.B<T>"],
  ["typeof import('m')", "typeof import(\"m\")"],
  ["`a${B}c`", "`a${B}c`"],
  ["`${A | B}-${`x${C}`}`", "`${(A | B)}-${`x${C}`}`"],
  ["`plain`", "`plain`"],
  ["({ a }: A) => B", "(({ a: a }: A) => B)"],
  ["([a, b]: [A, B], c) => B", "(([a, b]: [A, B], c) => B)"],
  ["({ a } | B)", "({ property a } | B)"],
  ["Extends<<T>() => T extends X ? 1 : 0, Y>", "Extends<(<T>() => (T extends X ? 1 : 0)), Y>"],
  ["1.5 | 0xff | 1n | -1.5", "(1.5 | 0xff | 1n | -1.5)"],
];

test("type shapes", () => table(SHAPES, typeShape, ""));

const EXPRESSIONS: [string, string][] = [
  ["a.b.c", "a.b.c"],
  ["a.default.new", "a.default.new"],
  ["a[b][c]", "a[b][c]"],
  ["f(a)(b)", "f(a)(b)"],
  ["a?.b.c()", "a?.b.c()"],
  ["a?.[k]", "a?.[k]"],
  ["f?.(x)", "f?.(x)"],
  ["a?.b!.c", "a?.b!.c"],
  ["new a.b.C()", "(new (a.b.C)())"],
  ["new C().x", "(new C()).x"],
  ["new C", "(new C)"],
  ["new C.x", "(new (C.x))"],
  ["new new C()()", "(new (new C())())"],
  ["new C<T>(x)", "(new C<T>(x))"],
  ["f<T>(x)", "f<T>(x)"],
  ["f<A, B<C>>(x)", "f<A, B<C>>(x)"],
  ["a?.<T>(x)", "a?.<T>(x)"],
  ["a < b > c", "((a < b) > c)"],
  ["a < b > (c)", "a<b>(c)"],
  ["f<T>", "f<T>"],
  ["tag<T>`x`", "tag<T>`x`"],
  ["import.meta.url", "import.meta.url"],
  ["import('./m', opts)", "import('./m', opts)"],
  ["x!", "x!"],
  ["super.x()", "super.x()"],
  ["a ?? b || c", "(a ?? (b || c))"],
  ["a || b && c", "(a || (b && c))"],
  ["a && b | c", "(a && (b | c))"],
  ["a | b ^ c", "(a | (b ^ c))"],
  ["a ^ b & c", "(a ^ (b & c))"],
  ["a & b == c", "(a & (b == c))"],
  ["a != b < c", "(a != (b < c))"],
  ["a < b << c", "(a < (b << c))"],
  ["a in b instanceof c", "((a in b) instanceof c)"],
  ["a << b + c", "(a << (b + c))"],
  ["a <<= b << c", "(a <<= (b << c))"],
  ["a |> f(%) |> g(%)", "((a |> f(%)) |> g(%))"],
  ["x |> % ? a : b", "(x |> (% ? a : b))"],
  ["x |> % % 2", "(x |> (% % 2))"],
  ["a ? b : c |> f(%)", "(a ? b : (c |> f(%)))"],
  ["(a ? b : c) |> f(%)", "((a ? b : c) |> f(%))"],
  ["y = x |> f(%)", "(y = (x |> f(%)))"],
  ["x |> f(%, y |> g(%))", "(x |> f(%, (y |> g(%))))"],
  ["x |> [%, %]", "(x |> [%, %])"],
  ["x |> % + 1 |> % * 2", "((x |> (% + 1)) |> (% * 2))"],
  ["a || b |> f(%)", "((a || b) |> f(%))"],
  ["comptime fib(10)", "(comptime fib(10))"],
  ["comptime fib(10) + 1", "((comptime fib(10)) + 1)"],
  ["comptime 'text'", "(comptime 'text')"],
  ["comptime new Table()", "(comptime (new Table()))"],
  ["comptime(x)", "comptime(x)"],
  ["comptime[0]", "comptime[0]"],
  ["comptime - 1", "(comptime - 1)"],
  ["comptime`x`", "comptime`x`"],
  ["comptime in x", "(comptime in x)"],
  ["comptime as T", "(comptime as T)"],
  ["match (x) { case Some(v) => v, case None => 0 }", "match (x) { case Some(v) => v, case None => 0 }"],
  ["match (n) { case x if x > 10 => 'big', case _ => 'small', }", "match (n) { case x if (x > 10) => 'big', case _ => 'small' }"],
  ["match (r) { case Ok(v) => v, case Err(e) => { log(e); return 0 } }", "match (r) { case Ok(v) => v, case Err(e) => { 2 statements } }"],
  ["match (x) { case 1 => 'one', case -1 => 'minus', case 'a' => 'a', case true => 1, case null => 0, case 1n => 2 }",
    "match (x) { case 1 => 'one', case (-1) => 'minus', case 'a' => 'a', case true => 1, case null => 0, case 1n => 2 }"],
  ["match (e) { case ApiError.NotFound => 404, case Shape.Circle(r) => r, case Pair(A.B, _) => 1 }",
    "match (e) { case ApiError.NotFound => 404, case Shape.Circle(r) => r, case Pair(A.B, _) => 1 }"],
  ["match (x) { case x if (a) => b }", "match (x) { case x if a => b }"],
  ["match (x) { case _ => (y) => y }", "match (x) { case _ => ((y) => y) }"],
  ["match(x)", "match(x)"],
  ["match (x)\n  {}", "match(x)"],
  ["match (a, b) { case _ => 1 }", "match ((a, b)) { case _ => 1 }"],
  ["match (x) {}", "match (x) {  }"],
  ["f(match (x) { case _ => 1 }, 2)", "f(match (x) { case _ => 1 }, 2)"],
  ["match (r) { case { status: 200, body } | [_, ...rest] => 1 }", "match (r) { case ({ status: 200, body: body } | [_, ...rest]) => 1 }"],
  ["match (x) { case 0 | 1 => 'small', case Some({ id, name: n }) => n, case [first, ...rest] => first, case ApiError.NotFound => 404, case _ => 0, }",
    "match (x) { case (0 | 1) => 'small', case Some({ id: id, name: n }) => n, case [first, ...rest] => first, case ApiError.NotFound => 404, case _ => 0 }"],
  ["match (x) { case (A | B) | C => 1 }", "match (x) { case ((A | B) | C) => 1 }"],
  ["match (x) { case [, b, ..._] => b }", "match (x) { case [, b, ..._] => b }"],
  ["match (x) { case { a: { b: [1, 'two'] } } => 1 }", "match (x) { case { a: { b: [1, 'two'] } } => 1 }"],
  ["match (x) { case Some(1 | 2) => 1 }", "match (x) { case Some((1 | 2)) => 1 }"],
  ["a < < b", "error"],
  ["a + b * c", "(a + (b * c))"],
  ["a - b - c", "((a - b) - c)"],
  ["a * b ** c", "(a * (b ** c))"],
  ["a ** b ** c", "(a ** (b ** c))"],
  ["a >> b >>> c >= d", "(((a >> b) >>> c) >= d)"],
  ["a > b >= c", "((a > b) >= c)"],
  ["(-a) ** b", "((-a) ** b)"],
  ["++a ** b", "((++a) ** b)"],
  ["typeof a === 'x'", "((typeof a) === 'x')"],
  ["!a && -b", "((!a) && (-b))"],
  ["void 0", "(void 0)"],
  ["delete a.b", "(delete a.b)"],
  ["await p.then()", "(await p.then())"],
  ["~+a", "(~(+a))"],
  ["-a++", "(-(a++))"],
  ["a+++b", "((a++) + b)"],
  ["- -a", "(-(-a))"],
  ["a = b = c", "(a = (b = c))"],
  ["a += b ?? c", "(a += (b ?? c))"],
  ["a >>= 1", "(a >>= 1)"],
  ["a >>>= b > c", "(a >>>= (b > c))"],
  ["a ||= b &&= c", "(a ||= (b &&= c))"],
  ["a ? b : c ? d : e", "(a ? b : (c ? d : e))"],
  ["a || b ? c : d", "((a || b) ? c : d)"],
  ["a ? b = 1 : c", "(a ? (b = 1) : c)"],
  ["a ? b : c = d", "(a ? b : (c = d))"],
  ["(a, b, c)", "(a, b, c)"],
  ["f((a, b), c)", "f((a, b), c)"],
  ["x as A as B", "((x as A) as B)"],
  ["x as const", "(x as const)"],
  ["a + b as T", "((a + b) as T)"],
  ["a < b as T", "((a < b) as T)"],
  ["a as T > b", "((a as T) > b)"],
  ["a && b as T", "(a && (b as T))"],
  ["x satisfies Config", "(x satisfies Config)"],
  ["<T>x.y", "(<T>x.y)"],
  ["<T>x + 1", "((<T>x) + 1)"],
  ["<A<B>>x", "(<A<B>>x)"],
  ["yield", "(yield)"],
  ["(yield a, b)", "((yield a), b)"],
  ["yield* g()", "(yield* g())"],
  ["yield a ? b : c", "(yield (a ? b : c))"],
  ["a[b, c]", "a[(b, c)]"],
  ["(a)", "a"],
  ["(a) => a", "((a) => a)"],
  ["(a, b) => a", "((a, b) => a)"],
  ["(a, b)", "(a, b)"],
  ["x => y => x", "((x) => ((y) => x))"],
  ["async (x) => x", "(async (x) => x)"],
  ["async(x)", "async(x)"],
  ["async x => x", "(async (x) => x)"],
  ["async => async", "((async) => async)"],
  ["<T>(x: T) => x", "(<T>(x: T) => x)"],
  ["<T>x", "(<T>x)"],
  ["async <T>(x: T): Promise<T> => x", "(async <T>(x: T): Promise<T> => x)"],
  ["() => {}", "(() => { 0 statements })"],
  ["(x: string): i64 throws ParseError => f(x)", "((x: string): i64 throws ParseError => f(x))"],
  ["(x) throws E => f(x)", "((x) throws E => f(x))"],
  ["() => ({})", "(() => {})"],
  ["(x = 1, ...rest: A[]) => { f(); g() }", "((x = 1, ...rest: (A[])) => { 2 statements })"],
  ["(x): x is T => true", "((x): x is T => true)"],
  ["a ? (b) : c", "(a ? b : c)"],
  ["f(x => x + 1, (a, b) => a)", "f(((x) => (x + 1)), ((a, b) => a))"],
  ["a = () => b", "(a = (() => b))"],
  ["(a) + 1", "(a + 1)"],
  ["({ a, b: [c] }, ...[d]) => a", "(({ a: a, b: [c] }, ...[d]) => a)"],
  ["({ a } = {}) => a", "(({ a: a } = {}) => a)"],
];

test("expression shapes", () => table(EXPRESSIONS, exprShape, ""));

test("'%' outside a pipe", () => throwsWith(exprShape("% + 1"), "'%' is only valid on the right of '|>'", "% + 1"));
test("a pipe body without '%'", () => throwsWith(exprShape("x |> f(y)"), "the right side of '|>' must use the topic '%'", "x |> f(y)"));

test("-a ** b, typeof a ** b and a * -b ** c are rejected", () => {
  for (const src of ["-a ** b", "typeof a ** b", "a * -b ** c"]) throwsWith(exprShape(src), "parenthesise the left side of '**'", src);
});

// No line break may come before `=>`, so this is `(a)` followed by a stray `=>`.
test("a newline before => ends the expression", () => {
  throwsWith(exprShape("(a)\n  => a"), "expected an expression, found '=>'", "(a) => a");
});

const PATTERNS: [string, string][] = [
  ["let { a, b: { c = 1 }, ...rest } = x", "{ a: a, b: { c: (c = 1) }, ...rest }"],
  ["let [a, , [b, c] = d, ...e] = x", "[a, , ([b, c] = d), ...e]"],
  ["let { 'quoted': q, [key]: k, 0: zero } = x", "{ quoted: q, [key]: k, 0: zero }"],
  ["let [, , third] = x", "[, , third]"],
  ["let {} = x", "{  }"],
];

test("binding patterns", () => table(PATTERNS, patternShape, ""));

const DESTRUCTURING: [string, string][] = [
  ["[a, b] = [b, a]", "([a, b] = [b, a])"],
  ["({ a, b: c.d, e = 1, ...f } = obj)", "({ a: a, b: c.d, e: (e = 1), ...f } = obj)"],
  ["[x.y, z[0] = 1, ...[w]] = v", "([x.y, (z[0] = 1), ...[w]] = v)"],
  ["[a] = [b] = c", "([a] = ([b] = c))"],
];

test("destructuring assignments", () => table(DESTRUCTURING, exprShape, ""));

const STATEMENTS: [string, string][] = [
  ["for (x in y) {}", "for (x in y)"],
  ["for (x = (a in b); ;) {}", "for ((x = (a in b)); ; )"],
  ["for (let x = [a in b], y = f(c in d); ;) {}", "for (let x = [(a in b)], y = f((c in d)); ; )"],
  ["for (let f = () => { a in b }; ;) {}", "for (let f = (() => { 1 statements }); ; )"],
  ["for (let x = a ? b in c : d; ;) {}", "for (let x = (a ? (b in c) : d); ; )"],
  ["for (let [k, v] of map) {}", "for (let [k, v] of map)"],
  ["for (const { a, b } of list) {}", "for (const { a: a, b: b } of list)"],
  ["for ([a, b] of pairs) {}", "for ([a, b] of pairs)"],
  ["for (obj.prop in source) {}", "for (obj.prop in source)"],
  ["for (let i = 0, n = a.length; i < n; i++) {}", "for (let i = 0, n = a.length; (i < n); (i++))"],
  ["for (const key in obj) {}", "for (const key in obj)"],
  ["for await (const chunk of stream) {}", "for await (const chunk of stream)"],
  ["for (;;) {}", "for (; ; )"],
  ["for (let of of ofs) {}", "for (let of of ofs)"],
  ["for (x of a, b) {}", "error"],
  ["switch (x) { case 1: case 2: a(); break; default: b() }", "switch (x) { case 1:  | case 2: a(); break | default: b() }"],
  ["switch (x) {}", "switch (x) {  }"],
  ["outer: for (;;) { continue outer }", "outer: for (; ; )"],
  ["a: b: c()", "a: b: c()"],
  ["break\n  outer", "break; outer"],
  ["throw new Error('x')", "throw (new Error('x'))"],
  ["throw\n  x", "error"],
  ["try {} catch {}", "try { 0 } catch { 0 }"],
  ["try { a() } catch (e: unknown) { b() } finally { c() }", "try { 1 } catch (e: unknown) { 1 } finally { 1 }"],
  ["try {} catch ({ message }) {}", "try { 0 } catch ({ message: message }) { 0 }"],
  ["try {} finally {}", "try { 0 } finally { 0 }"],
  ["try {}", "error"],
  ["comptime { setup(); check() }", "comptime { 2 }"],
  ["comptime\n  { setup() }", "comptime; block"],
  ["function f(comptime n: i64, m) {}", "function f(comptime n: i64, m) { 0 }"],
  ["function f(comptime) {}", "function f(comptime) { 0 }"],
  ["macro function m(input: Ast): Ast { return input }", "macro function m(input: Ast) { 1 }"],
  ["macro(x)", "macro(x)"],
  ["macro\n  function f() {}", "macro; function f() { 0 }"],
];

test("statement shapes", () => table(STATEMENTS, statementsShape, ""));

test("function overloads", () => {
  const got = statementsShape("function f(x: string): void\n  function f(x: i64): void;\n  function f(x) {}");
  assert(got === "function f(x: string);; function f(x: i64);; function f(x) { 0 }", got);
});

test("do x(); while (y) z()", () => {
  const got = statementsShape("do x(); while (y) z()");
  assert(got === "do { 1 statements } while (y); z()", got);
});

const CLASSES: [string, string][] = [
  ["class A {}", "class A {  }"],
  ["class A<T> extends B<T> implements C, D.E<T> { x = 1; y: i64; m() {} }", "class A extends B<T> implements C, D.E<T> { field x = 1; field y: i64; method m() { 0 } }"],
  ["class A extends mixin(B, C) {}", "class A extends mixin(B, C) {  }"],
  ["abstract class A {}", "abstract class A {  }"],
  ["class A { constructor(x: i64) { this.x = x } get size() { return 1 } set size(v) {} }", "class A { constructor(x: i64) { 1 }; get size() { 1 }; set size(v) { 0 } }"],
  ["class A { #count = 0; #inc() { this.#count++ } has(o) { return #count in o } }", "class A { field #count = 0; method #inc() { 1 }; method has(o) { 1 } }"],
  ["class A { *gen() {} 'quoted'() {} [key]() {} 42 = 1 }", "class A { method *gen() { 0 }; method quoted() { 0 }; method [key]() { 0 }; field 42 = 1 }"],
  ["class A { get = 1; set() {} constructor = 2 }", "class A { field get = 1; method set() { 0 }; field constructor = 2 }"],
  ["class A { ;; }", "class A {  }"],
  ["class A { static x = 1; private readonly y: T; protected abstract m(): void; public static async *g() {} }",
    "class A { static field x = 1; private readonly field y: T; protected abstract method m();; public static async method *g() { 0 } }"],
  ["class A { static() {} get: i64; readonly?: T; async = 1; declare: boolean }",
    "class A { method static() { 0 }; field get: i64; field readonly?: T; field async = 1; field declare: boolean }"],
  ["class A { declare x: i64; override m() {} accessor y = 1 }", "class A { declare field x: i64; override method m() { 0 }; accessor field y = 1 }"],
  ["class A { static { init() } static x }", "class A { static block { 1 }; static field x }"],
  ["class A { [key: string]: unknown; static readonly [i: number]: T }",
    "class A { index [key: string]: unknown; static readonly index [i: number]: T }"],
  ["class A { x?: i64; y!: i64; m?(): void }", "class A { field x?: i64; field y!: i64; method m?(); }"],
  ["class A { constructor(private readonly x: i64, public y?: T, z) {} }",
    "class A { constructor(private readonly x: i64, public y?: T, z) { 0 } }"],
  ["class A { m(): void; m(x?: i64): void {} abstract get v(): i64 }",
    "class A { method m();; method m(x?: i64) { 0 }; abstract get v(); }"],
  ["class A { declare\n  x: i64 }", "class A { field declare; field x: i64 }"],
  ["@sealed class A {}", "@sealed class A {  }"],
  ["@a.b @c(1, 2) @(d()) abstract class A {}", "@a.b @c(1, 2) @d() abstract class A {  }"],
  ["class A { @observable x = 1; @bind @log('m') static m(@inject(T) private t: T) {} }",
    "class A { @observable field x = 1; @bind @log('m') static method m(@inject(T) private t: T) { 0 } }"],
  ["class A { @dec [key]() {} }", "class A { @dec method [key]() { 0 } }"],
];

test("class shapes", () => table(CLASSES, classShape, ""));

test("class expressions", () => {
  const rows: [string, string][] = [
    ["class extends Base { x = 1 }", "class extends Base { field x = 1 }"],
    ["#x in obj", "(#x in obj)"],
    ["@dec class {}", "@dec class {  }"],
  ];
  table(rows, exprShape, "");
});

const MODULES: [string, string][] = [
  ["import x from 'm'", 'import x from "m"'],
  ["import * as ns from 'm'", 'import * as ns from "m"'],
  ["import { a, b as c, type T, default as d, 'a-b' as ab } from 'm'", 'import { a, b as c, type T, default as d, a-b as ab } from "m"'],
  ["import x, { a } from 'm'", 'import x, { a } from "m"'],
  ["import x, * as ns from 'm'", 'import x, * as ns from "m"'],
  ["import 'side-effect'", 'import "side-effect"'],
  ["import type X from 'm'", 'import type X from "m"'],
  ["import type { A, B } from 'm'", 'import type { A, B } from "m"'],
  ["import type * as ns from 'm'", 'import type * as ns from "m"'],
  ["import type from 'm'", 'import type from "m"'],
  ["import from from 'm'", 'import from from "m"'],
  ["import { type } from 'm'", 'import { type } from "m"'],
  ["import { type as x, type y, type as as z } from 'm'", 'import { type as x, type y, type as as z } from "m"'],
  ["import data from './data.json' with { type: 'json' }", "import data from \"./data.json\" with { type: 'json' }"],
  ["import fs = require('fs')", 'import fs = require("fs")'],
  ["import type T = require('t')", 'import type T = require("t")'],
  ["import Alias = A.B.C", "import Alias = A.B.C"],
  ["import('m')", "import('m')"],
  ["import.meta.url", "import.meta.url"],
  ["import {} from 'm'", 'import {  } from "m"'],
  ["import defer * as ns from 'm'", 'import defer * as ns from "m"'],
  ["import defer from 'm'", 'import defer from "m"'],
  ["import a { b } from 'm'", "error"],
  ["export const x = 1", "export const x = 1"],
  ["export function f() {}", "export function f() { 0 }"],
  ["export default function () {}", "export default function () { 0 }"],
  ["export default function named() {}", "export default function named() { 0 }"],
  ["export default (function () {})", "export default (function () {})"],
  ["export default class {}", "export default class {  }"],
  ["export default abstract class A {}", "export default abstract class A {  }"],
  ["export default interface I {}", "export default interface I"],
  ["export default x + 1", "export default ((x + 1))"],
  ["export default async function () {}", "export default function () { 0 }"],
  ["@dec export class A {}", "export @dec class A {  }"],
  ["export @dec class A {}", "export @dec class A {  }"],
  ["@dec export default class {}", "export default @dec class {  }"],
  ["export { a, b as c, type T, x as default }", "export { a, b as c, type T, x as default }"],
  ["export { a } from 'm'", 'export { a } from "m"'],
  ["export type { T } from 'm'", 'export type { T } from "m"'],
  ["export type T = i64", "export typeAlias"],
  ["export * from 'm'", 'export * from "m"'],
  ["export * as ns from 'm'", 'export * as ns from "m"'],
  ["export type * from 'm'", 'export type * from "m"'],
  ["export = Foo", "export = Foo"],
  ["export as namespace MyLib", "export as namespace MyLib"],
  ["export import A = B.C", "export import A = B.C"],
  ["export declare const x: i64", "export declare"],
  ["export enum E { A }", "export enum"],
  ["export namespace N {}", "export namespace"],
  ["export abstract class A {}", "export abstract class A {  }"],
  ["export async function f() {}", "export function f() { 0 }"],
];

test("import and export shapes", () => table(MODULES, statementsShape, "expected ','"));

// The design doc's bootstrap path: the compiler's own TypeScript is already valid Fish.
test("src and tests parse", () => {
  let failed: string[] = [];
  let parsed = 0;
  for (const dir of ["src", "tests"]) {
    const path = join(root(), dir);
    let files: string[] = [];
    try {
      files = readdirSync(path).filter((f) => f.endsWith(".ts"));
    } catch (e) {
      assert(false, e.message);
    }
    for (const file of files) {
      try {
        parse(read(join(path, file)), { last: 0 });
        parsed++;
      } catch (e) {
        failed.push(`${dir}/${file}: ${e.message}`);
      }
    }
  }
  assert(failed.length === 0, failed.join("\n"));
  assert(parsed > 100, `only ${parsed} files parsed`);
});

// A declaration's kind with its decorators in front.
function decorated(s: Ref<Stmt>, src: string): string {
  switch (s.kind) {
    case "export":
      return decorated(s.body, src);
    case "function":
      return `${s.decorators !== undefined ? decorators(s.decorators, src) : ""}function`;
    case "typeAlias":
      return `${s.decorators !== undefined ? decorators(s.decorators, src) : ""}typeAlias`;
    case "interface":
      return `${s.decorators !== undefined ? decorators(s.decorators, src) : ""}interface`;
    case "enum":
      return `${s.decorators !== undefined ? decorators(s.decorators, src) : ""}enum`;
    case "class":
      return `${decorators(s.decorators, src)}${s.kind}`;
  }
  return s.kind;
}

test("decorators on functions, type aliases, interfaces and enums", () => {
  const src = "function f() {\n  @a function f() {}\n@b @c type T = i64;\n@d interface I {}\n@e enum E { A }\n@f.g(1) async function h() {}\nexport @k const enum K { A }\n}";
  const got = inFunction(src, (stmts): string => {
    let out: string[] = [];
    for (const s of stmts) out.push(decorated(s, src));
    return out.join(", ");
  });
  assert(got === "@a function, @b @c typeAlias, @d interface, @e enum, @f.g(1) function, @k enum", got);
  throwsWith(statementsShape("@a const x = 1;"), "expected a class, function, type, interface or enum after decorators", "@a const x = 1;");
});

// The `throws` type a declaration's JSDoc `@throws` tags give, shown with the text its span covers.
function documented(src: string): string {
  let found: string[] = [];
  const at = (t: Ref<TypeNode>) => `${show(t, src)} at '${src.slice(t.start as i64, t.end as i64)}'`;
  try {
    const program = parse(src, { last: 0 });
    walk({ of: "stmts", node: program }, (n) => {
      if (n.of === "stmt" && n.node.kind === "function" && n.node.throws !== undefined) found.push(at(n.node.throws));
      else if (n.of === "func" && n.node.throws !== undefined) found.push(at(n.node.throws));
      else if (n.of === "expr" && n.node.kind === "arrow" && n.node.throws !== undefined) found.push(at(n.node.throws));
      else if (n.of === "typeNode" && n.node.kind === "function" && n.node.throws !== undefined) found.push(at(n.node.throws));
      else if (n.of === "typeMember" && n.node.kind === "method" && n.node.throws !== undefined) found.push(at(n.node.throws));
      else if (n.of === "classMember" && n.node.kind === "method" && n.node.throws !== undefined) found.push(at(n.node.throws));
      else if (n.of === "classMember" && n.node.kind === "constructor" && n.node.throws !== undefined) found.push(at(n.node.throws));
      else if (n.of === "classMember" && (n.node.kind === "get" || n.node.kind === "set") && n.node.throws !== undefined) found.push(at(n.node.throws));
    });
  } catch (e) {
    return `error: ${e.message}`;
  }
  return found.length > 0 ? found[0]! : "none";
}

const JSDOC_THROWS: [string, string][] = [
  ["/** @throws {E} */ function f() {}", "E at 'E'"],
  ["/** @throws {E} why */\nexport async function f() {}", "E at 'E'"],
  ["/** @throws {E} */ export default function () {}", "E at 'E'"],
  ["/** @throws {A | B} */ declare function f(): void", "(A | B) at 'A | B'"],
  ["/**\n * @throws {A} first\n * @throws {B}\n */\nfunction f() {}", "(A | B) at 'A} first\n * @throws {B'"],
  ["/**\n * @throws {A | B}\n * @throws {C}\n */\nfunction f() {}", "(A | B | C) at 'A | B}\n * @throws {C'"],
  ["/**\n * @throws {A | B}\n * @throws {C}\n */\nfunction f() throws A | B | C {}", "(A | B | C) at 'A | B | C'"],
  ["/** @throws {{ code: i64 }} */ function f() {}", "{ property code: i64 } at '{ code: i64 }'"],
  ["/** @throws E */ function f() {}", "none"],
  ["/**\n * @throws INVALID_PARAM\n */\nfunction f() {}", "none"],
  ["/** @throws if the file is missing */ function f() {}", "none"],
  ["/** @throws E when it fails */ function f() {}", "none"],
  ["/** Fails. @throws{E} */ function f() {}", "E at 'E'"],
  ["/** see x@throws {E} */ function f() {}", "none"],
  ["/* @throws {E} */ function f() {}", "none"],
  ["/** @throws {E} */ g();\nfunction f() {}", "none"],
  ["/** @throws {E} */\n// note\nfunction f() {}", "E at 'E'"],
  ["const x = a.default\n/** @throws {E} */ function f() {}", "E at 'E'"],
  ["const x = a?.export\n/** @throws {E} */ export function f() {}", "E at 'E'"],
  ["/** @throws {E} */ function f() throws E {}", "E at 'E'"],
  ["class A { /** @throws {E} */ m() {} }", "E at 'E'"],
  ["class A { /** @throws {E} */ static async m() {} }", "E at 'E'"],
  ["class A { /** @throws {E} */ constructor() {} }", "E at 'E'"],
  ["class A { /** @throws {E} */ get x() { return 1 } }", "E at 'E'"],
  ["class A { /** @throws {E} */ f = () => 1 }", "E at 'E'"],
  ["/** @throws {E} */ const f = async (x: i64) => x", "E at 'E'"],
  ["/** @throws {E} */ export const f = (x: i64) => x", "E at 'E'"],
  ["/** @throws {E} */ const a = () => 1, b = () => 2", "none"],
  ["/** @throws {E} */ const n = 1", "none"],
  ["/** @throws {E} */ type F = (n: i64) => i64", "E at 'E'"],
  ["/** @throws {E} */\nexport type Parse<T> = (c: Mut<Cursor>) => T", "E at 'E'"],
  ["/**\n * @throws {A}\n * @throws {B}\n */\ntype F = () => void", "(A | B) at 'A}\n * @throws {B'"],
  ["/** @throws {E} */ type F = () => void throws E", "E at 'E'"],
  ["function g() {\n  /** @throws {E} */\n  type F = () => void\n}", "E at 'E'"],
  ["/** @throws {E} */ type F = string", "none"],
  ["/** @throws {E} */ type F = (() => void) | null", "none"],
  ["/** @throws {E} */ type F = { f: () => void }", "none"],
  ["/** @throws E */ type F = () => void", "none"],
  ["function g() {\n  /** @throws {E} */\n  function f() {}\n}", "E at 'E'"],
  ["/** @throws {@link E} */ function f() {}", "none"],
  ["/** @throws {*} */ function f() {}", "none"],
  ["/** @throws {?E} */ function f() {}", "none"],
  ["/** @throws {Error=} */ function f() {}", "none"],
  ["/** @throws {A |} */ function f() {}", "none"],
  ["/** @throws {A */ function f() {}", "none"],
  ["/**\n * @throws {A |\n *   B} when\n */\nfunction f() {}", "none"],
  ["/**\n * @throws {@link E}\n * @throws {F}\n */\nfunction f() {}", "F at 'F'"],
  ["interface I { /** @throws {E} */ m(x: i64): i64 }", "E at 'E'"],
  ["type T = { /** @throws {E} */ m(): void }", "E at 'E'"],
  ["interface I { /** @throws {E} */ x: i64 }", "none"],
];

test("jsdoc @throws tags", () => table(JSDOC_THROWS, documented, ""));

// The program's tree with ids and spans left out, or the error it throws.
function bare(src: string): string {
  try {
    const program = parse(src, { last: 0 });
    return programShape(program);
  } catch (e) {
    return `error: ${e.message}`;
  }
}

test("a JSDoc @throws tag parses as the written clause does", () => {
  const pairs: [string, string][] = [
    ["/** @throws {A | B<i64>} */ function f(): void {}", "function f(): void throws A | B<i64> {}"],
    ["class C { /** @throws {E} */ m(): void {} }", "class C { m(): void throws E {} }"],
    ["/** @throws {E} */ type Parse<T> = (c: Mut<Cursor>) => T;", "type Parse<T> = (c: Mut<Cursor>) => T throws E;"],
    ["interface I { /** @throws {E} */ m(): void }", "interface I { m(): void throws E }"],
  ];
  for (const p of pairs) {
    const a = bare(p[0]);
    const b = bare(p[1]);
    assert(!a.startsWith("error: ") && a === b, `${p[0]}:\n${a}\n--- the written clause\n${b}`);
  }
});

test("JSDoc @throws errors point into the comment", () => {
  try {
    parse("/** @throws {string} */ function f() throws i64 {}", { last: 0 });
    assert(false, "a mismatched @throws parses");
  } catch (e) {
    if (e instanceof CompileError) {
      assert(e.message === "the JSDoc says '@throws {string}' but the function says 'throws i64'; make them the same type, or keep one", e.message);
      assert(e.start === 13 && e.end === 19, `the error spans ${e.start}..${e.end}`);
    } else assert(false, e.message);
  }
  assert(!bare("/** @throws {1} */ function f() throws 1 {}").startsWith("error: "), "a matching @throws {1} is refused");
  throwsWith(bare("/** @throws {1} */ function f() throws 2 {}"), "the JSDoc says '@throws {1}' but the function says 'throws 2'", "throws 2");
  throwsWith(bare("/** @throws {A} */ type F = () => void throws B"), "the JSDoc says '@throws {A}' but the function says 'throws B'", "throws B");
});

test("TypeScript with JSDoc types Fish can't read still parses", () => {
  const src = [
    "/**",
    " * Reads the config.",
    " * @throws {@link ConfigError} when it is missing",
    " * @throws {*} anything else",
    " * @throws {?Error}",
    " * @throws {module:fs~Error=}",
    " * @throws {{",
    " *   code: number",
    " * }}",
    " */",
    "export async function read(path: string): Promise<string> { return path }",
    "class A { /** @throws {!Error} */ m(): void {} }",
  ].join("\n");
  const got = documented(src);
  assert(got === "none", got);
});
