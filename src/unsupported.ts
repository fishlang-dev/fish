import { CompileError } from "./diag.ts";
import type { Expr, Span, Stmt, TypeNode } from "./parser.ts";

// The forms that parse but have no meaning yet, and the errors that reject them.

// What each expression form is called when the checker rejects it.
export const EXPRESSION_FORMS: Record<Exclude<Expr["kind"], "int" | "bool" | "string" | "ident" | "member" | "call" | "unary" | "binary" | "assign" | "update" | "conditional" | "object" | "this" | "new" | "arrow" | "float" | "as" | "null" | "nonNull" | "throw">, string> = {
  bigint: "bigint literals",
  super: "'super' expressions",
  regex: "regular expressions",
  spread: "spread elements",
  array: "array literals",
  function: "function expressions",
  class: "class expressions",
  privateName: "private names",
  index: "indexed access expressions",
  instantiation: "instantiation expressions",
  meta: "meta properties",
  import: "dynamic imports",
  destructure: "destructuring assignments",
  pipe: "'|>' expressions",
  topic: "topic references",
  comptime: "comptime expressions",
  match: "match expressions",
  sequence: "comma expressions",
  yield: "'yield' expressions",
  satisfies: "'satisfies' expressions",
  assertion: "type assertions",
  template: "template literals",
  tagged: "tagged templates",
};

// What each type form is called when the checker rejects it.
export const TYPE_FORMS: Record<Exclude<TypeNode["kind"], "ref" | "operator" | "function" | "object" | "literal" | "union">, string> = {
  array: "array types",
  tuple: "tuple types",
  intersection: "intersection types",
  indexed: "indexed access types",
  query: "'typeof' types",
  predicate: "type predicates",
  import: "import types",
  conditional: "conditional types",
  infer: "'infer' types",
  mapped: "mapped types",
  template: "template literal types",
};

// Declarations that parse but have no meaning yet, wherever they appear.
export function unsupportedDeclaration(s: Stmt): CompileError | undefined {
  switch (s.kind) {
    case "typeAlias":
      return unsupported("local type aliases", s);
    case "interface":
      return unsupported("local interfaces", s);
    case "class":
      return unsupported(s.decorators.length > 0 ? "decorators" : "local classes", s);
    case "enum":
      return unsupported("local enums", s);
    case "namespace":
      return unsupported("namespaces", s);
    case "declare":
      return unsupported("ambient declarations", s);
    case "import":
    case "importEquals":
      return unsupported("imports", s);
    case "export":
    case "exportDefault":
    case "exportNamed":
    case "exportAll":
    case "exportAssign":
    case "exportAsNamespace":
      return unsupported("exports", s);
  }
  return undefined;
}

export function unsupported(what: string, at: Span): CompileError {
  return new CompileError(`${what} are not supported yet`, at.start, at.end);
}
