import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, type Specifier, type ClassMember, type ClassNode, type Expr, type Param, type Pattern, type PropertyName, type Stmt, type TypeMember, type TypeNode } from "../src/parser.ts";

// Prints a type with every composite part parenthesised, so the table shows how it grouped.
function show(t: TypeNode): string {
  switch (t.kind) {
    case "ref":
      return t.args.length ? `${t.name}<${t.args.map(show).join(", ")}>` : t.name;
    case "literal":
      return src.slice(t.start, t.end);
    case "array":
      return `(${show(t.element)}[])`;
    case "union":
    case "intersection":
      return `(${t.types.map(show).join(t.kind === "union" ? " | " : " & ")})`;
    case "operator":
      return `${t.op} ${show(t.type)}`;
    case "indexed":
      return `(${show(t.object)}[${show(t.index)}])`;
    case "query":
      return `typeof ${show(t.target)}`;
    case "tuple":
      return `[${t.elements.map((e) => {
        const name = e.name === undefined ? "" : `${e.name}${e.optional ? "?" : ""}: `;
        return `${e.rest ? "..." : ""}${name}${show(e.type)}${e.name === undefined && e.optional ? "?" : ""}`;
      }).join(", ")}]`;
    case "object":
      return `{ ${t.members.map(showMember).join("; ")} }`;
    case "function": {
      const prefix = t.construct ? `${t.abstract ? "abstract " : ""}new ` : "";
      const typeParams = t.typeParams.length ? `<${t.typeParams.map((p) => p.name).join(", ")}>` : "";
      return `(${prefix}${typeParams}(${showParams(t.params)}) => ${show(t.returns)}${t.throws ? ` throws ${show(t.throws)}` : ""})`;
    }
    case "import":
      return `import("${t.module}")${t.name ? `.${t.name}` : ""}${t.args.length ? `<${t.args.map(show).join(", ")}>` : ""}`;
    case "conditional":
      return `(${show(t.check)} extends ${show(t.extends)} ? ${show(t.then)} : ${show(t.else)})`;
    case "infer":
      return `(infer ${t.name}${t.constraint ? ` extends ${show(t.constraint)}` : ""})`;
    case "mapped": {
      const readonly = t.readonly ? `${t.readonly}readonly ` : "";
      const as = t.as ? ` as ${show(t.as)}` : "";
      const optional = t.optional ? `${t.optional}?` : "";
      return `{ ${readonly}[${t.name} in ${show(t.constraint)}${as}]${optional}${t.type ? `: ${show(t.type)}` : ""} }`;
    }
    case "template":
      return `\`${t.quasis.map((q, i) => (i === 0 ? q : `\${${show(t.types[i - 1]!)}}${q}`)).join("")}\``;
    case "predicate":
      return `${t.asserts ? "asserts " : ""}${t.name}${t.type ? ` is ${show(t.type)}` : ""}`;
  }
}

// Each member is prefixed with its kind, so a property named `get` can't pass for an accessor.
function showMember(m: TypeMember): string {
  const returns = "returns" in m && m.returns ? `: ${show(m.returns)}` : "";
  switch (m.kind) {
    case "property":
      return `property ${m.readonly ? "readonly " : ""}${showName(m.name)}${m.optional ? "?" : ""}${m.type ? `: ${show(m.type)}` : ""}`;
    case "method":
      return `method ${showName(m.name)}${m.optional ? "?" : ""}(${showParams(m.params)})${returns}`;
    case "call":
    case "construct":
      return `${m.kind} (${showParams(m.params)})${returns}`;
    case "index":
      return `index ${m.readonly ? "readonly " : ""}[${showParams(m.params)}]: ${show(m.type)}`;
    case "get":
    case "set":
      return `${m.kind} ${showName(m.name)}(${showParams(m.params)})${returns}`;
  }
}

function showName(name: PropertyName): string {
  return typeof name === "string" ? name : `[${src.slice(name.start, name.end)}]`;
}

function showParams(params: Param[]): string {
  return params.map((p) => {
    const name = `${p.comptime ? "comptime " : ""}${p.decorators.map((d) => `@${showExpr(d)} `).join("")}${p.modifiers.map((m) => `${m} `).join("")}${p.rest ? "..." : ""}${showPattern(p.pattern)}${p.optional ? "?" : ""}`;
    const fallback = p.default ? ` = ${showExpr(p.default)}` : "";
    return `${p.type ? `${name}: ${show(p.type)}` : name}${fallback}`;
  }).join(", ");
}

// The source being shown, so literals print as written.
let src = "";

function parseType(type: string): TypeNode {
  src = `function f(): ${type} {}`;
  const [f] = parse(src);
  if (f?.kind !== "function") throw new Error("expected a function");
  return f.returnType!;
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

for (const [src, shape] of SHAPES) {
  test(src, () => expect(show(parseType(src))).toBe(shape));
}

// Prints an expression with every operator application parenthesised. Member chains print
// as written, and a `new` is wrapped whole, so `(new C()).x` and `new (a.b)()` read clearly.
function showExpr(e: Expr): string {
  const args = (list: Expr[]) => `(${list.map(showExpr).join(", ")})`;
  const typeArgs = (list: TypeNode[]) => (list.length ? `<${list.map(show).join(", ")}>` : "");
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
      return src.slice(e.start, e.end);
    case "spread":
      return `...${showExpr(e.value)}`;
    case "array":
      return `[${e.elements.map((x) => (x ? showExpr(x) : "")).join(", ")}]`;
    case "member":
      return `${showExpr(e.object)}${e.optional ? "?." : "."}${e.name}`;
    case "index":
      return `${showExpr(e.object)}${e.optional ? "?." : ""}[${showExpr(e.index)}]`;
    case "call":
      return `${showExpr(e.callee)}${e.optional ? "?." : ""}${typeArgs(e.typeArgs)}${args(e.args)}`;
    case "new": {
      const callee = e.callee.kind === "ident" || e.callee.kind === "new" ? showExpr(e.callee) : `(${showExpr(e.callee)})`;
      return `(new ${callee}${typeArgs(e.typeArgs)}${e.args ? args(e.args) : ""})`;
    }
    case "instantiation":
      return `${showExpr(e.expr)}${typeArgs(e.typeArgs)}`;
    case "tagged":
      return `${showExpr(e.tag)}${typeArgs(e.typeArgs)}${showExpr(e.template)}`;
    case "import":
      return `import${args(e.args)}`;
    case "nonNull":
      return `${showExpr(e.expr)}!`;
    case "throw":
      return `(throw ${showExpr(e.value)})`;
    case "unary":
      return `(${e.op}${/\w/.test(e.op) ? " " : ""}${showExpr(e.operand)})`;
    case "update":
      return e.prefix ? `(${e.op}${showExpr(e.operand)})` : `(${showExpr(e.operand)}${e.op})`;
    case "binary":
      return `(${showExpr(e.left)} ${e.op} ${showExpr(e.right)})`;
    case "conditional":
      return `(${showExpr(e.cond)} ? ${showExpr(e.then)} : ${showExpr(e.else)})`;
    case "assign":
      return `(${showExpr(e.target)} ${e.op} ${showExpr(e.value)})`;
    case "sequence":
      return `(${e.exprs.map(showExpr).join(", ")})`;
    case "yield":
      return `(yield${e.delegate ? "*" : ""}${e.value ? ` ${showExpr(e.value)}` : ""})`;
    case "as":
    case "satisfies":
      return `(${showExpr(e.expr)} ${e.kind} ${show(e.type)})`;
    case "assertion":
      return `(<${show(e.type)}>${showExpr(e.expr)})`;
    case "destructure":
      return `(${showPattern(e.pattern)} = ${showExpr(e.value)})`;
    case "pipe":
      return `(${showExpr(e.value)} |> ${showExpr(e.body)})`;
    case "topic":
      return "%";
    case "comptime":
      return `(comptime ${showExpr(e.expr)})`;
    case "unsafe":
      return `(unsafe ${showExpr(e.expr)})`;
    case "match": {
      const arms = e.arms.map((a) => {
        const guard = a.guard ? ` if ${showExpr(a.guard)}` : "";
        const body = a.body.kind === "block" ? `{ ${a.body.body.length} statements }` : showExpr(a.body);
        return `case ${showPattern(a.pattern)}${guard} => ${body}`;
      });
      return `match (${showExpr(e.subject)}) { ${arms.join(", ")} }`;
    }
    case "class":
      return showClass(e);
    case "arrow": {
      const typeParams = e.typeParams.length ? `<${e.typeParams.map((p) => p.name).join(", ")}>` : "";
      const returns = `${e.returnType ? `: ${show(e.returnType)}` : ""}${e.throws ? ` throws ${show(e.throws)}` : ""}`;
      const body = Array.isArray(e.body) ? `{ ${e.body.length} statements }` : showExpr(e.body);
      return `(${e.async ? "async " : ""}${typeParams}(${showParams(e.params)})${returns} => ${body})`;
    }
  }
}

function parseExpr(expr: string): Expr {
  src = `function f() {\n  let x = ${expr}\n}`;
  const [f] = parse(src);
  const [s] = f?.kind === "function" ? f.body ?? [] : [];
  if (s?.kind !== "let") throw new Error("expected a let statement");
  return s.declarations[0]!.init!;
}

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

for (const [src, shape] of EXPRESSIONS) {
  if (shape === "error") test(src, () => expect(() => parseExpr(src)).toThrow());
  else test(src, () => expect(showExpr(parseExpr(src))).toBe(shape));
}

test("'%' outside a pipe", () => expect(() => parseExpr("% + 1")).toThrow("'%' is only valid on the right of '|>'"));
test("a pipe body without '%'", () => expect(() => parseExpr("x |> f(y)")).toThrow("the right side of '|>' must use the topic '%'"));

for (const src of ["-a ** b", "typeof a ** b", "a * -b ** c"]) {
  test(`${src} is rejected`, () => expect(() => parseExpr(src)).toThrow("parenthesise the left side of '**'"));
}

// No line break may come before `=>`, so this is `(a)` followed by a stray `=>`.
test("a newline before => ends the expression", () => {
  expect(() => parseExpr("(a)\n  => a")).toThrow("expected an expression, found '=>'");
});

// Prints a pattern with every default parenthesised and every property written `key: value`.
function showPattern(p: Pattern): string {
  const rest = (r: Pattern | undefined, any: boolean) => (r ? `${any ? ", " : ""}...${showPattern(r)}` : "");
  switch (p.kind) {
    case "ident":
      return p.name;
    case "object":
      return `{ ${p.props.map((x) => `${showName(x.key)}: ${showPattern(x.value)}`).join(", ")}${rest(p.rest, p.props.length > 0)} }`;
    case "array":
      return `[${p.elements.map((x) => (x ? showPattern(x) : "")).join(", ")}${rest(p.rest, p.elements.length > 0)}]`;
    case "default":
      return `(${showPattern(p.target)} = ${showExpr(p.value)})`;
    case "expr":
      return showExpr(p.expr);
    case "wildcard":
      return "_";
    case "literal":
      return showExpr(p.value);
    case "variant":
      return `${p.name}${p.args ? `(${p.args.map(showPattern).join(", ")})` : ""}`;
    case "or":
      return `(${p.patterns.map(showPattern).join(" | ")})`;
  }
}

function parseStatement(stmt: string): Stmt {
  src = `function f() {\n  ${stmt}\n}`;
  const [f] = parse(src);
  const [s] = f?.kind === "function" ? f.body ?? [] : [];
  if (!s) throw new Error("expected a statement");
  return s;
}

const PATTERNS: [string, string][] = [
  ["let { a, b: { c = 1 }, ...rest } = x", "{ a: a, b: { c: (c = 1) }, ...rest }"],
  ["let [a, , [b, c] = d, ...e] = x", "[a, , ([b, c] = d), ...e]"],
  ["let { 'quoted': q, [key]: k, 0: zero } = x", "{ quoted: q, [key]: k, 0: zero }"],
  ["let [, , third] = x", "[, , third]"],
  ["let {} = x", "{  }"],
];

for (const [stmt, shape] of PATTERNS) {
  test(stmt, () => {
    const s = parseStatement(stmt);
    if (s.kind !== "let") throw new Error("expected a declaration");
    expect(showPattern(s.declarations[0]!.target)).toBe(shape);
  });
}

const DESTRUCTURING: [string, string][] = [
  ["[a, b] = [b, a]", "([a, b] = [b, a])"],
  ["({ a, b: c.d, e = 1, ...f } = obj)", "({ a: a, b: c.d, e: (e = 1), ...f } = obj)"],
  ["[x.y, z[0] = 1, ...[w]] = v", "([x.y, (z[0] = 1), ...[w]] = v)"],
  ["[a] = [b] = c", "([a] = ([b] = c))"],
];

for (const [expr, shape] of DESTRUCTURING) {
  test(expr, () => expect(showExpr(parseExpr(expr))).toBe(shape));
}

// Prints a statement's head: declarations and loop headers, which is where grouping matters.
function showStmt(s: Stmt): string {
  switch (s.kind) {
    case "let": {
      const declarators = s.declarations.map((d) => `${showPattern(d.target)}${d.init ? ` = ${showExpr(d.init)}` : ""}`);
      return `${s.keyword} ${declarators.join(", ")}`;
    }
    case "expr":
      return showExpr(s.expr);
    case "for": {
      return `for (${s.init ? showStmt(s.init) : ""}; ${s.test ? showExpr(s.test) : ""}; ${s.update ? showExpr(s.update) : ""})`;
    }
    case "forIn":
    case "forOf": {
      const left = "keyword" in s.left ? showStmt(s.left) : showPattern(s.left as Pattern);
      return `for${s.await ? " await" : ""} (${left} ${s.kind === "forIn" ? "in" : "of"} ${showExpr(s.right)})`;
    }
    case "doWhile":
      return `do { ${s.body.length} statements } while (${showExpr(s.cond)})`;
    case "function":
      return `${s.macro ? "macro " : ""}function ${s.name}(${showParams(s.params)})${s.body ? ` { ${s.body.length} }` : ";"}`;
    case "comptime":
      return `comptime { ${s.body.length} }`;
    case "unsafe":
      return `unsafe { ${s.body.length} }`;
    case "import": {
      const clauses = [
        s.default,
        s.namespace && `* as ${s.namespace}`,
        s.named && `{ ${s.named.map(showSpecifier).join(", ")} }`,
      ].filter(Boolean);
      const from = clauses.length ? `${clauses.join(", ")} from ` : "";
      return `import ${s.typeOnly ? "type " : ""}${s.defer ? "defer " : ""}${from}"${s.module}"${s.attributes ? ` with ${showExpr(s.attributes)}` : ""}`;
    }
    case "export":
      return `export ${showStmt(s.body)}`;
    case "exportDefault":
      return `export default ${s.declaration ? showStmt(s.declaration) : `(${showExpr(s.value!)})`}`;
    case "exportNamed":
      return `export ${s.typeOnly ? "type " : ""}{ ${s.specifiers.map(showSpecifier).join(", ")} }${s.module ? ` from "${s.module}"` : ""}`;
    case "exportAll":
      return `export ${s.typeOnly ? "type " : ""}*${s.alias ? ` as ${s.alias}` : ""} from "${s.module}"`;
    case "exportAssign":
      return `export = ${showExpr(s.value)}`;
    case "exportAsNamespace":
      return `export as namespace ${s.name}`;
    case "class":
      return showClass(s);
    case "interface":
      return `interface ${s.name}`;
    case "importEquals":
      return `import ${s.typeOnly ? "type " : ""}${s.name} = ${s.require ? `require("${s.require}")` : s.entity}`;
    case "switch": {
      const cases = s.cases.map((k) => `${k.test ? `case ${showExpr(k.test)}` : "default"}: ${k.body.map(showStmt).join("; ")}`);
      return `switch (${showExpr(s.discriminant)}) { ${cases.join(" | ")} }`;
    }
    case "labeled":
      return `${s.label}: ${showStmt(s.body)}`;
    case "break":
    case "continue":
      return s.label ? `${s.kind} ${s.label}` : s.kind;
    case "throw":
      return `throw ${showExpr(s.value)}`;
    case "try": {
      const binding = s.param ? ` (${showPattern(s.param)}${s.paramType ? `: ${show(s.paramType)}` : ""})` : "";
      const handler = s.handler ? ` catch${binding} { ${s.handler.length} }` : "";
      return `try { ${s.block.length} }${handler}${s.finalizer ? ` finally { ${s.finalizer.length} }` : ""}`;
    }
    default:
      return s.kind;
  }
}

function parseStatements(stmts: string): Stmt[] {
  src = `function f() {\n  ${stmts}\n}`;
  const [f] = parse(src);
  return f?.kind === "function" ? f.body ?? [] : [];
}

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

for (const [stmt, shape] of STATEMENTS) {
  test(stmt, () => {
    if (shape === "error") return void expect(() => parseStatements(stmt)).toThrow();
    expect(parseStatements(stmt).map(showStmt).join("; ")).toBe(shape);
  });
}

test("function overloads", () => {
  const stmts = parseStatements("function f(x: string): void\n  function f(x: i64): void;\n  function f(x) {}");
  expect(stmts.map(showStmt).join("; ")).toBe("function f(x: string);; function f(x: i64);; function f(x) { 0 }");
});

test("do x(); while (y) z()", () => {
  expect(parseStatements("do x(); while (y) z()").map(showStmt).join("; ")).toBe("do { 1 statements } while (y); z()");
});

// A class's header, then each member as `kind name` with its modifiers and decorators.
function showClass(k: ClassNode & { kind: "class" }): string {
  const decorators = k.decorators.map((d) => `@${showExpr(d)} `).join("");
  const heritage = `${k.extends ? ` extends ${showExpr(k.extends)}` : ""}${k.implements.length ? ` implements ${k.implements.map(show).join(", ")}` : ""}`;
  return `${decorators}${k.abstract ? "abstract " : ""}class${k.name ? ` ${k.name}` : ""}${heritage} { ${k.members.map(showClassMember).join("; ")} }`;
}

function showClassMember(m: ClassMember): string {
  const prefix = `${m.decorators.map((d) => `@${showExpr(d)} `).join("")}${m.modifiers.map((x) => `${x} `).join("")}`;
  const body = (b: unknown[] | undefined) => (b ? ` { ${b.length} }` : ";");
  switch (m.kind) {
    case "field":
      return `${prefix}field ${showName(m.name)}${m.optional ? "?" : ""}${m.definite ? "!" : ""}${m.type ? `: ${show(m.type)}` : ""}${m.init ? ` = ${showExpr(m.init)}` : ""}`;
    case "method":
      return `${prefix}method ${m.generator ? "*" : ""}${showName(m.name)}${m.optional ? "?" : ""}(${showParams(m.params)})${body(m.body)}`;
    case "constructor":
      return `${prefix}constructor(${showParams(m.params)})${body(m.body)}`;
    case "get":
    case "set":
      return `${prefix}${m.kind} ${showName(m.name)}(${showParams(m.params)})${body(m.body)}`;
    case "index":
      return `${prefix}index [${showParams(m.params)}]: ${show(m.type)}`;
    case "staticBlock":
      return `static block { ${m.body.length} }`;
  }
}

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

for (const [stmt, shape] of CLASSES) {
  test(stmt, () => {
    const [s] = parseStatements(stmt);
    if (s?.kind !== "class") throw new Error("expected a class");
    expect(showClass(s)).toBe(shape);
  });
}

test("class expressions", () => {
  expect(showExpr(parseExpr("class extends Base { x = 1 }"))).toBe("class extends Base { field x = 1 }");
  expect(showExpr(parseExpr("#x in obj"))).toBe("(#x in obj)");
  expect(showExpr(parseExpr("@dec class {}"))).toBe("@dec class {  }");
});

function showSpecifier(x: Specifier): string {
  return `${x.typeOnly ? "type " : ""}${x.name}${x.alias ? ` as ${x.alias}` : ""}`;
}

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

for (const [stmt, shape] of MODULES) {
  if (shape === "error") test(stmt, () => expect(() => parseStatements(stmt)).toThrow("expected ','"));
  else test(stmt, () => expect(parseStatements(stmt).map(showStmt).join("; ")).toBe(shape));
}

// The design doc's bootstrap path: the compiler's own TypeScript is already valid Fish.
for (const dir of ["src", "tests"]) {
  const path = join(import.meta.dir, "..", dir);
  for (const file of readdirSync(path).filter((f) => f.endsWith(".ts"))) {
    test(`${dir}/${file} parses`, () => {
      parse(readFileSync(join(path, file), "utf8"));
    });
  }
}

test("decorators on functions, type aliases, interfaces and enums", () => {
  const decorated = (src: string) => parseStatements(src).map((s) => {
    const d = s.kind === "export" ? s.body : s;
    const decorators = "decorators" in d ? (d.decorators ?? []) : [];
    return `${decorators.map((x) => `@${showExpr(x)} `).join("")}${d.kind}`;
  });
  expect(decorated("@a function f() {}\n@b @c type T = i64;\n@d interface I {}\n@e enum E { A }\n@f.g(1) async function h() {}\nexport @k const enum K { A }")).toEqual([
    "@a function", "@b @c typeAlias", "@d interface", "@e enum", "@f.g(1) function", "@k enum",
  ]);
  expect(() => parseStatements("@a const x = 1;")).toThrow("expected a class, function, type, interface or enum after decorators");
});
