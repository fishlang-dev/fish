import { expect, test } from "bun:test";
import { parse, type Expr, type Param, type PropertyName, type TypeMember, type TypeNode } from "../src/parser.ts";

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
      return `(${prefix}${typeParams}(${showParams(t.params)}) => ${show(t.returns)})`;
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
    const name = `${p.rest ? "..." : ""}${p.name}${p.optional ? "?" : ""}`;
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
    case "arrow": {
      const typeParams = e.typeParams.length ? `<${e.typeParams.map((p) => p.name).join(", ")}>` : "";
      const returns = e.returnType ? `: ${show(e.returnType)}` : "";
      const body = Array.isArray(e.body) ? `{ ${e.body.length} statements }` : showExpr(e.body);
      return `(${e.async ? "async " : ""}${typeParams}(${showParams(e.params)})${returns} => ${body})`;
    }
  }
}

function parseExpr(expr: string): Expr {
  src = `function f() {\n  let x = ${expr}\n}`;
  const [f] = parse(src);
  const [s] = f?.kind === "function" ? f.body : [];
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
  ["() => ({})", "(() => {})"],
  ["(x = 1, ...rest: A[]) => { f(); g() }", "((x = 1, ...rest: (A[])) => { 2 statements })"],
  ["(x): x is T => true", "((x): x is T => true)"],
  ["a ? (b) : c", "(a ? b : c)"],
  ["f(x => x + 1, (a, b) => a)", "f(((x) => (x + 1)), ((a, b) => a))"],
  ["a = () => b", "(a = (() => b))"],
  ["(a) + 1", "(a + 1)"],
];

for (const [src, shape] of EXPRESSIONS) {
  test(src, () => expect(showExpr(parseExpr(src))).toBe(shape));
}

for (const src of ["-a ** b", "typeof a ** b", "a * -b ** c"]) {
  test(`${src} is rejected`, () => expect(() => parseExpr(src)).toThrow("parenthesise the left side of '**'"));
}

// No line break may come before `=>`, so this is `(a)` followed by a stray `=>`.
test("a newline before => ends the expression", () => {
  expect(() => parseExpr("(a)\n  => a")).toThrow("expected an expression, found '=>'");
});
