import { expect, test } from "bun:test";
import { parse, type Param, type PropertyName, type TypeMember, type TypeNode } from "../src/parser.ts";

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
    return p.type ? `${name}: ${show(p.type)}` : name;
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
];

for (const [src, shape] of SHAPES) {
  test(src, () => expect(show(parseType(src))).toBe(shape));
}
