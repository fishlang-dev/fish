// Generated from the parser's AST types by `bun src/astgen.ts`; a test fails when it is stale.
export const AST = String.raw`
type AstType =
  | { start: i64; end: i64; kind: "ref"; name: string; args: AstType[] }
  | { start: i64; end: i64; kind: "literal"; value: AstExpr }
  | { start: i64; end: i64; kind: "array"; element: AstType }
  | { start: i64; end: i64; kind: "tuple"; elements: AstTupleElement[] }
  | { start: i64; end: i64; kind: "object"; members: AstTypeMember[] }
  | { start: i64; end: i64; kind: "function"; typeParams: AstTypeParam[]; params: AstParam[]; returns: AstType; construct: boolean; abstract: boolean }
  | { start: i64; end: i64; kind: "union"; types: AstType[] }
  | { start: i64; end: i64; kind: "intersection"; types: AstType[] }
  | { start: i64; end: i64; kind: "operator"; op: "keyof" | "readonly" | "unique"; type: AstType }
  | { start: i64; end: i64; kind: "indexed"; object: AstType; index: AstType }
  | { start: i64; end: i64; kind: "query"; target: AstType }
  | { start: i64; end: i64; kind: "import"; module: string; name: string | null; args: AstType[] }
  | { start: i64; end: i64; kind: "conditional"; check: AstType; extends: AstType; then: AstType; else: AstType }
  | { start: i64; end: i64; kind: "infer"; name: string; constraint: AstType | null }
  | { start: i64; end: i64; kind: "template"; quasis: string[]; types: AstType[] }
  | { start: i64; end: i64; kind: "mapped"; name: string; constraint: AstType; as: AstType | null; type: AstType | null; readonly: "+" | "-" | null; optional: "+" | "-" | null }
  | { start: i64; end: i64; kind: "predicate"; asserts: boolean; name: string; type: AstType | null };
type AstExpr =
  | { start: i64; end: i64; kind: "int"; value: i64 }
  | { start: i64; end: i64; kind: "float"; value: f64 }
  | { start: i64; end: i64; kind: "bigint"; value: i64 }
  | { start: i64; end: i64; kind: "null" }
  | { start: i64; end: i64; kind: "this" }
  | { start: i64; end: i64; kind: "super" }
  | { start: i64; end: i64; kind: "regex"; pattern: string; flags: string }
  | { start: i64; end: i64; kind: "template"; quasis: string[]; raw: string[]; exprs: AstExpr[] }
  | { start: i64; end: i64; kind: "tagged"; tag: AstExpr; typeArgs: AstType[]; template: AstExpr }
  | { start: i64; end: i64; kind: "bool"; value: boolean }
  | { start: i64; end: i64; kind: "string"; value: string }
  | { start: i64; end: i64; kind: "ident"; name: string }
  | { start: i64; end: i64; kind: "spread"; value: AstExpr }
  | { start: i64; end: i64; kind: "array"; elements: (AstExpr | null)[] }
  | { start: i64; end: i64; kind: "object"; props: AstObjectProp[] }
  | { start: i64; end: i64; kind: "function"; name: string | null; async: boolean; generator: boolean; typeParams: AstTypeParam[]; params: AstParam[]; returnType: AstType | null; body: AstStmt[] }
  | { start: i64; end: i64; kind: "arrow"; move: boolean; async: boolean; typeParams: AstTypeParam[]; params: AstParam[]; returnType: AstType | null; body: AstExpr | AstStmt[] }
  | { start: i64; end: i64; kind: "member"; object: AstExpr; name: string; optional: boolean }
  | { start: i64; end: i64; kind: "index"; object: AstExpr; index: AstExpr; optional: boolean }
  | { start: i64; end: i64; kind: "call"; callee: AstExpr; typeArgs: AstType[]; args: AstExpr[]; optional: boolean }
  | { start: i64; end: i64; kind: "new"; callee: AstExpr; typeArgs: AstType[]; args: AstExpr[] | null }
  | { start: i64; end: i64; kind: "instantiation"; expr: AstExpr; typeArgs: AstType[] }
  | { start: i64; end: i64; kind: "meta"; name: "import.meta" | "new.target" }
  | { start: i64; end: i64; kind: "import"; args: AstExpr[] }
  | { start: i64; end: i64; kind: "nonNull"; expr: AstExpr }
  | { start: i64; end: i64; kind: "throw"; value: AstExpr }
  | { start: i64; end: i64; name: string | null; abstract: boolean; decorators: AstExpr[]; typeParams: AstTypeParam[]; extends: AstExpr | null; implements: AstType[]; members: AstClassMember[]; derives?: string[]; kind: "class" }
  | { start: i64; end: i64; kind: "privateName"; name: string }
  | { start: i64; end: i64; kind: "unary"; op: AstUnaryOp; operand: AstExpr }
  | { start: i64; end: i64; kind: "update"; op: "++" | "--"; prefix: boolean; operand: AstExpr }
  | { start: i64; end: i64; kind: "binary"; op: AstBinaryOp; left: AstExpr; right: AstExpr }
  | { start: i64; end: i64; kind: "conditional"; cond: AstExpr; then: AstExpr; else: AstExpr }
  | { start: i64; end: i64; kind: "assign"; op: AstAssignOp; target: AstExpr; value: AstExpr }
  | { start: i64; end: i64; kind: "pipe"; value: AstExpr; body: AstExpr }
  | { start: i64; end: i64; kind: "topic" }
  | { start: i64; end: i64; kind: "match"; subject: AstExpr; arms: AstMatchArm[] }
  | { start: i64; end: i64; kind: "comptime"; expr: AstExpr }
  | { start: i64; end: i64; kind: "unsafe"; expr: AstExpr }
  | { start: i64; end: i64; kind: "destructure"; pattern: AstPattern; value: AstExpr }
  | { start: i64; end: i64; kind: "sequence"; exprs: AstExpr[] }
  | { start: i64; end: i64; kind: "yield"; value: AstExpr | null; delegate: boolean }
  | { start: i64; end: i64; kind: "as"; expr: AstExpr; type: AstType }
  | { start: i64; end: i64; kind: "satisfies"; expr: AstExpr; type: AstType }
  | { start: i64; end: i64; kind: "assertion"; type: AstType; expr: AstExpr };
type AstStmt =
  | { start: i64; end: i64; kind: "expr"; expr: AstExpr }
  | { start: i64; end: i64; kind: "let"; keyword: "let" | "const" | "var"; declarations: AstDeclarator[] }
  | { start: i64; end: i64; kind: "return"; value: AstExpr | null }
  | { start: i64; end: i64; kind: "if"; cond: AstExpr; then: AstStmt[]; else: AstStmt[] | null }
  | { start: i64; end: i64; kind: "while"; cond: AstExpr; body: AstStmt[] }
  | { start: i64; end: i64; kind: "doWhile"; body: AstStmt[]; cond: AstExpr }
  | { start: i64; end: i64; kind: "switch"; discriminant: AstExpr; cases: AstSwitchCase[] }
  | { start: i64; end: i64; kind: "labeled"; label: string; body: AstStmt }
  | { start: i64; end: i64; kind: "break"; label: string | null }
  | { start: i64; end: i64; kind: "continue"; label: string | null }
  | { start: i64; end: i64; kind: "throw"; value: AstExpr }
  | { start: i64; end: i64; kind: "try"; block: AstStmt[]; param: AstPattern | null; paramType: AstType | null; handler: AstStmt[] | null; finalizer: AstStmt[] | null }
  | { start: i64; end: i64; kind: "for"; init: AstStmt | null; test: AstExpr | null; update: AstExpr | null; body: AstStmt[] }
  | { start: i64; end: i64; kind: "forIn"; await: boolean; left: AstStmt | AstPattern; right: AstExpr; body: AstStmt[] }
  | { start: i64; end: i64; kind: "forOf"; await: boolean; left: AstStmt | AstPattern; right: AstExpr; body: AstStmt[] }
  | { start: i64; end: i64; kind: "block"; body: AstStmt[] }
  | { start: i64; end: i64; kind: "empty" }
  | { start: i64; end: i64; kind: "debugger" }
  | { start: i64; end: i64; kind: "enum"; name: string; const: boolean; typeParams: AstTypeParam[]; members: AstEnumMember[]; decorators?: AstExpr[]; derives?: string[] }
  | { start: i64; end: i64; kind: "namespace"; name: string; quoted: boolean; global: boolean; body: AstStmt[] | null }
  | { start: i64; end: i64; kind: "declare"; body: AstStmt }
  | { start: i64; end: i64; kind: "comptime"; body: AstStmt[] }
  | { start: i64; end: i64; kind: "unsafe"; body: AstStmt[] }
  | { start: i64; end: i64; kind: "import"; typeOnly: boolean; defer: boolean; default: string | null; namespace: string | null; named: AstSpecifier[] | null; module: string; attributes: AstExpr | null }
  | { start: i64; end: i64; kind: "importEquals"; typeOnly: boolean; name: string; require: string | null; entity: string | null }
  | { start: i64; end: i64; kind: "export"; body: AstStmt }
  | { start: i64; end: i64; kind: "exportDefault"; declaration: AstStmt | null; value: AstExpr | null }
  | { start: i64; end: i64; kind: "exportNamed"; typeOnly: boolean; specifiers: AstSpecifier[]; module: string | null }
  | { start: i64; end: i64; kind: "exportAll"; typeOnly: boolean; alias: string | null; module: string }
  | { start: i64; end: i64; kind: "exportAssign"; value: AstExpr }
  | { start: i64; end: i64; kind: "exportAsNamespace"; name: string }
  | { start: i64; end: i64; kind: "typeAlias"; name: string; typeParams: AstTypeParam[]; type: AstType; decorators?: AstExpr[]; js?: AstJsName }
  | { start: i64; end: i64; kind: "interface"; name: string; typeParams: AstTypeParam[]; extends: AstType[]; members: AstTypeMember[]; decorators?: AstExpr[]; js?: AstJsName; jsClass?: { constructors: AstParam[][]; statics: AstTypeMember[] }; jsSource?: AstStmt }
  | { start: i64; end: i64; kind: "function"; name: string; async: boolean; generator: boolean; macro: boolean; typeParams: AstTypeParam[]; params: AstParam[]; returnType: AstType | null; throws?: AstType; body: AstStmt[] | null; decorators?: AstExpr[]; js?: AstJsName }
  | { start: i64; end: i64; name: string | null; abstract: boolean; decorators: AstExpr[]; typeParams: AstTypeParam[]; extends: AstExpr | null; implements: AstType[]; members: AstClassMember[]; derives?: string[]; kind: "class" };
type AstTupleElement =
  | { start: i64; end: i64; name: string | null; optional: boolean; rest: boolean; type: AstType };
type AstPropertyName =
  string | AstExpr;
type AstTypeMember =
  | { start: i64; end: i64; kind: "property"; name: AstPropertyName; optional: boolean; readonly: boolean; type: AstType | null }
  | { start: i64; end: i64; kind: "method"; name: AstPropertyName; optional: boolean; typeParams: AstTypeParam[]; params: AstParam[]; returns: AstType | null }
  | { start: i64; end: i64; kind: "call"; typeParams: AstTypeParam[]; params: AstParam[]; returns: AstType | null }
  | { start: i64; end: i64; kind: "construct"; typeParams: AstTypeParam[]; params: AstParam[]; returns: AstType | null }
  | { start: i64; end: i64; kind: "index"; readonly: boolean; params: AstParam[]; type: AstType }
  | { start: i64; end: i64; kind: "get"; name: AstPropertyName; params: AstParam[]; returns: AstType | null }
  | { start: i64; end: i64; kind: "set"; name: AstPropertyName; params: AstParam[]; returns: AstType | null };
type AstObjectProp =
  | { start: i64; end: i64; kind: "property"; key: AstPropertyName; value: AstExpr }
  | { start: i64; end: i64; kind: "shorthand"; name: string; default: AstExpr | null }
  | { start: i64; end: i64; kind: "spread"; value: AstExpr }
  | { start: i64; end: i64; kind: "method"; key: AstPropertyName; async: boolean; generator: boolean; typeParams: AstTypeParam[]; params: AstParam[]; returnType: AstType | null; body: AstStmt[] }
  | { start: i64; end: i64; kind: "get"; key: AstPropertyName; params: AstParam[]; returnType: AstType | null; body: AstStmt[] }
  | { start: i64; end: i64; kind: "set"; key: AstPropertyName; params: AstParam[]; returnType: AstType | null; body: AstStmt[] };
type AstModifier =
  "public" | "private" | "protected" | "static" | "readonly" | "abstract" | "override" | "declare" | "accessor" | "async";
type AstClassNode =
  | { start: i64; end: i64; name: string | null; abstract: boolean; decorators: AstExpr[]; typeParams: AstTypeParam[]; extends: AstExpr | null; implements: AstType[]; members: AstClassMember[]; derives?: string[] };
type AstClassMember =
  | { start: i64; end: i64; modifiers: AstModifier[]; decorators: AstExpr[]; kind: "field"; name: AstPropertyName; optional: boolean; definite: boolean; type: AstType | null; init: AstExpr | null }
  | { start: i64; end: i64; modifiers: AstModifier[]; decorators: AstExpr[]; kind: "method"; name: AstPropertyName; optional: boolean; generator: boolean; typeParams: AstTypeParam[]; params: AstParam[]; returnType: AstType | null; throws?: AstType; body: AstStmt[] | null }
  | { start: i64; end: i64; modifiers: AstModifier[]; decorators: AstExpr[]; kind: "constructor"; params: AstParam[]; throws?: AstType; body: AstStmt[] | null }
  | { start: i64; end: i64; modifiers: AstModifier[]; decorators: AstExpr[]; kind: "get"; name: AstPropertyName; params: AstParam[]; returnType: AstType | null; body: AstStmt[] | null }
  | { start: i64; end: i64; modifiers: AstModifier[]; decorators: AstExpr[]; kind: "set"; name: AstPropertyName; params: AstParam[]; returnType: AstType | null; body: AstStmt[] | null }
  | { start: i64; end: i64; modifiers: AstModifier[]; decorators: AstExpr[]; kind: "index"; params: AstParam[]; type: AstType }
  | { start: i64; end: i64; modifiers: AstModifier[]; decorators: AstExpr[]; kind: "staticBlock"; body: AstStmt[] };
type AstParam =
  | { start: i64; end: i64; pattern: AstPattern; type: AstType | null; optional: boolean; rest: boolean; default: AstExpr | null; modifiers: AstModifier[]; decorators: AstExpr[]; comptime: boolean };
type AstPattern =
  | { start: i64; end: i64; kind: "ident"; name: string }
  | { start: i64; end: i64; kind: "object"; props: AstPatternProp[]; rest: AstPattern | null }
  | { start: i64; end: i64; kind: "array"; elements: (AstPattern | null)[]; rest: AstPattern | null }
  | { start: i64; end: i64; kind: "default"; target: AstPattern; value: AstExpr }
  | { start: i64; end: i64; kind: "expr"; expr: AstExpr }
  | { start: i64; end: i64; kind: "wildcard" }
  | { start: i64; end: i64; kind: "literal"; value: AstExpr }
  | { start: i64; end: i64; kind: "variant"; name: string; args: AstPattern[] | null }
  | { start: i64; end: i64; kind: "or"; patterns: AstPattern[] };
type AstMatchArm =
  | { start: i64; end: i64; pattern: AstPattern; guard: AstExpr | null; body: AstExpr | { start: i64; end: i64; kind: "block"; body: AstStmt[] } };
type AstPatternProp =
  | { start: i64; end: i64; key: AstPropertyName; value: AstPattern };
type AstSpecifier =
  | { start: i64; end: i64; name: string; alias: string | null; typeOnly: boolean };
type AstEnumMember =
  | { start: i64; end: i64; name: string; init: AstExpr | null; payload: AstType[] | null };
type AstSwitchCase =
  | { start: i64; end: i64; test: AstExpr | null; body: AstStmt[] };
type AstDeclarator =
  | { start: i64; end: i64; target: AstPattern; type: AstType | null; init: AstExpr | null };
type AstTypeParam =
  | { start: i64; end: i64; name: string; constraint: AstType | null; default: AstType | null; modifiers: ("const" | "in" | "out")[] };
type AstTypeAlias =
  | { start: i64; end: i64; kind: "typeAlias"; name: string; typeParams: AstTypeParam[]; type: AstType; decorators?: AstExpr[]; js?: AstJsName };
type AstInterface =
  | { start: i64; end: i64; kind: "interface"; name: string; typeParams: AstTypeParam[]; extends: AstType[]; members: AstTypeMember[]; decorators?: AstExpr[]; js?: AstJsName; jsClass?: { constructors: AstParam[][]; statics: AstTypeMember[] }; jsSource?: AstStmt };
type AstJsName =
  | { module: string; package: i64; name: string; const?: true; overloads?: AstFunc[] };
type AstFunc =
  | { start: i64; end: i64; kind: "function"; name: string; async: boolean; generator: boolean; macro: boolean; typeParams: AstTypeParam[]; params: AstParam[]; returnType: AstType | null; throws?: AstType; body: AstStmt[] | null; decorators?: AstExpr[]; js?: AstJsName };
type AstBinaryOp =
  "??" | "||" | "&&" | "|" | "^" | "&" | "===" | "!==" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "instanceof" | "in" | "<<" | ">>" | ">>>" | "+" | "-" | "*" | "/" | "%" | "**";
type AstUnaryOp =
  "-" | "+" | "!" | "~" | "typeof" | "void" | "delete" | "await";
type AstArithmeticOp =
  "+" | "-" | "*" | "/" | "%";
type AstAssignOp =
  "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "**=" | "<<=" | ">>=" | ">>>=" | "&=" | "|=" | "^=" | "&&=" | "||=" | "??=";
type Ast = AstStmt | AstExpr | AstType | AstPattern;
`;
