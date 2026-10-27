// Fish source printed in the one official style, Prettier's defaults: the program is turned into
// a document (src/doc.ts) and laid out at 80 columns.

import { CompileError } from "./diag.ts";
import {
  align, breakParent, conditionalGroup, fill, group, groupId, hardline, ifBreak, indent, indentIfBreak, join, label, line,
  lineSuffixBoundary, literalline, print, softline, type Doc,
} from "./doc.ts";
import { lexer, type Token } from "./lexer.ts";
import {
  parse, parseWithComments, type BinaryOp, type Declarator, type Expr, type ObjectProp, type Param, type Pattern, type PropertyName, type Stmt, type TypeMember, type MatchArm, type ClassMember, type ClassNode, type Interface, type Specifier,
  type TypeNode, type TypeParam,
} from "./parser.ts";

// `src` formatted, ending in one newline; a parse error, or a comment, which would be lost, is a
// CompileError at its place.
export function format(src: string): string {
  const { program, comments } = parseWithComments(src);
  const first = comments[0];
  if (first) throw new CompileError("formatting a file with comments isn't supported yet; comments would be lost", first.start, first.end);
  return printProgram(program, src);
}

// The printer underneath `format`: `src` gives what the tree doesn't keep, such as a literal's
// text as written.
export function printProgram(program: Stmt[], src: string): string {
  // Prettier's output isn't always stable: an object it breaks gains a newline after its `{`,
  // which the keep-expanded rule then honors, so a second run can lay a chain out differently.
  // Printing the output again until it stops changing makes formatting idempotent.
  let out = printOnce(program, src);
  for (let round = 0; round < 3; round++) {
    const again = printOnce(reparse(out), out);
    if (again === out) return out;
    out = again;
  }
  throw new Error("the formatter's output kept changing when formatted again");
}

// The formatter's own output parsed again; failing to parse is the formatter's bug, not the user's.
function reparse(out: string): Stmt[] {
  try {
    return parse(out);
  } catch (e) {
    if (!(e instanceof CompileError)) throw e;
    throw new Error(`the formatter produced output that doesn't parse: ${e.message} at offset ${e.start}`);
  }
}

function printOnce(program: Stmt[], src: string): string {
  const printedProgram = statements(program, undefined, src, true);
  return print(printedProgram.length > 0 ? [printedProgram, hardline] : "");
}

// Where a node sits, as Prettier's AstPath gives it: the key it is under in its parent (named as
// in Prettier's ESTree, such as "callee" or "left"), and the parent's own place. Parentheses and
// several layouts are decided from it.
type Frame =
  | { sort: "stmt"; node: Stmt }
  | { sort: "expr"; node: Expr }
  | { sort: "declarator"; node: Declarator }
  | { sort: "type"; node: TypeNode }
  | { sort: "prop"; node: ObjectProp }
  | { sort: "pattern"; node: Pattern }
  | { sort: "param"; node: Param }
  | { sort: "member"; node: ClassMember }
  | { sort: "arm"; node: MatchArm };
type Path = Frame & { key: string; parent: Path | undefined };
type At<S extends Frame["sort"]> = Extract<Path, { sort: S }>;
type Of<K extends Expr["kind"]> = Extract<Expr, { kind: K }>;

const at = (node: Expr, key: string, parent: Path): At<"expr"> =>
  ({ sort: "expr", node: node.kind === "pipe" ? pipeAsBinary(node) : node, key, parent });

// Statements one per line, empty ones dropped. In a program or function body, the string
// statements that open it are directives; a string statement anywhere else is parenthesized,
// as Prettier does, so it isn't read as one.
function statements(body: Stmt[], parent: Path | undefined, src: string, prologue: boolean): Doc[] {
  let inPrologue = prologue;
  const printedStmts: Doc[] = [];
  for (const s of body) {
    const isString = s.kind === "expr" && s.expr.kind === "string" && s.expr.start === s.start;
    inPrologue &&= isString;
    if (s.kind === "empty") continue;
    const path: At<"stmt"> = { sort: "stmt", node: s, key: "body", parent };
    if (inPrologue && s.kind === "expr") printedStmts.push([directive(src.slice(s.expr.start, s.expr.end)), ";"]);
    else if (s.kind === "expr" && s.expr.kind === "string") printedStmts.push(["(", expr(s.expr, "expression", path, src), ");"]);
    else printedStmts.push(statement(path, src));
  }
  return join(hardline, printedStmts);
}

// A directive keeps its quotes, unless it holds no quote of either kind (or is "use strict").
function directive(raw: string): string {
  const content = raw.slice(1, -1);
  return content === "use strict" || !/["']/.test(content) ? `"${content}"` : raw;
}

// A braced block. An empty one prints `{}` as a function's or loop's body, and `{` and `}` on
// their own lines elsewhere, as Prettier 3 does.
function block(body: Stmt[], parent: Path, src: string, compact = true, prologue = true): Doc {
  const printedBody = statements(body, parent, src, prologue);
  if (printedBody.length === 0) return compact ? "{}" : ["{", hardline, "}"];
  return ["{", indent([hardline, printedBody]), hardline, "}"];
}

// A loop's or `if`'s body: a block after a space, `;` for an empty statement, or one statement
// indented on the next line. The tree holds a block's statements, so whether it was a block is
// read from the source: a lone statement written bare follows its `)` or keyword directly.
function body(list: Stmt[], before: string, key: string, parent: At<"stmt">, src: string, compact: boolean): Doc {
  const only = list[0];
  const bare = list.length === 1 && only !== undefined && follows(src, only.start, before);
  if (!bare) return [" ", block(list, parent, src, compact, false)];
  if (only.kind === "empty") return ";";
  const doc = statement({ sort: "stmt", node: only, key, parent }, src);
  return key === "alternate" && only.kind === "if" ? [" ", doc] : indent([line, doc]);
}

const afterParen = ")";

// Whether `word` ends just before `at`, past whitespace and opening parentheses.
function follows(src: string, at: number, word: string): boolean {
  let i = at;
  while (i > 0 && /[\s(]/.test(src[i - 1]!)) i--;
  return src.slice(i - word.length, i) === word;
}

// A condition in `if`, `while` or `do`, broken inside its parentheses unless it is a negated
// logical expression.
function condition(e: Expr, parent: At<"stmt">, src: string): Doc {
  const doc = expr(e, "test", parent, src);
  let inner = e;
  if (inner.kind === "unary" && inner.op === "!") {
    inner = inner.operand;
    if (inner.kind === "unary" && inner.op === "!") inner = inner.operand;
    if (inner !== e && form(inner) === "logical") return doc;
  }
  return group([indent([softline, doc]), softline]);
}

function statement(path: At<"stmt">, src: string): Doc {
  const s = path.node;
  switch (s.kind) {
    case "expr":
      return [expr(s.expr, "expression", path, src), ";"];
    case "let":
      return [declarations(s.keyword, s.declarations, path, src, false), ";"];
    case "return":
    case "throw":
      return [s.kind, s.value ? [" ", returned(s.value, path, src)] : "", ";"];
    case "block":
      return block(s.body, path, src, false, false);
    case "function":
      return macroDecorators(s.decorators, [s.macro ? "macro " : "", functionDoc(s, path, src, {})], path, src);
    case "typeAlias":
      return macroDecorators(s.decorators, typeAlias(s, path, src), path, src);
    case "comptime":
    case "unsafe":
      return [s.kind, " ", block(s.body, path, src, false, false)];
    case "class":
      return classDoc(s, path, src, false);
    case "interface":
      return macroDecorators(s.decorators, interfaceDoc(s, path, src), path, src);
    case "enum":
      return macroDecorators(s.decorators, enumDoc(s, path, src), path, src);
    case "namespace":
      return namespaceDoc(s, path, src);
    case "declare":
      return ["declare ", statement({ sort: "stmt", node: s.body, key: "declaration", parent: path }, src)];
    case "import":
      return importDoc(s, path, src);
    case "importEquals":
      return ["import ", s.typeOnly ? "type " : "", s.name, " = ", s.require !== undefined ? ["require(", stringAfter(s.start, src), ")"] : s.entity!, ";"];
    case "export":
    case "exportDefault":
    case "exportNamed":
    case "exportAll":
    case "exportAssign":
    case "exportAsNamespace":
      return exportDoc(s, path, src);
    case "empty":
      return "";
    case "debugger":
      return "debugger;";
    case "break":
    case "continue":
      return [s.kind, s.label ? [" ", s.label] : "", ";"];
    case "labeled":
      return [s.label, s.body.kind === "empty" ? ":;" : [": ", statement({ sort: "stmt", node: s.body, key: "body", parent: path }, src)]];
    case "if": {
      const head = group(["if (", condition(s.cond, path, src), ")", body(s.then, afterParen, "consequent", path, src, false)]);
      if (!s.else) return head;
      const thenIsBlock = !(s.then.length === 1 && follows(src, s.then[0]!.start, afterParen));
      return [head, thenIsBlock ? " " : hardline, "else", group(body(s.else, "else", "alternate", path, src, false))];
    }
    case "while":
      return group(["while (", condition(s.cond, path, src), ")", body(s.body, afterParen, "body", path, src, true)]);
    case "doWhile": {
      const loop = body(s.body, "do", "body", path, src, true);
      const isBlock = Array.isArray(loop) && loop[0] === " ";
      return [group(["do", loop]), isBlock ? " " : hardline, "while (", condition(s.cond, path, src), ");"];
    }
    case "for": {
      const loop = body(s.body, afterParen, "body", path, src, true);
      if (!s.init && !s.test && !s.update) return group(["for (;;)", loop]);
      const init = !s.init ? "" : s.init.kind === "expr" ? expr(s.init.expr, "init", path, src)
        : s.init.kind === "let" ? declarations(s.init.keyword, s.init.declarations, { sort: "stmt", node: s.init, key: "init", parent: path }, src, true)
        : statement({ sort: "stmt", node: s.init, key: "init", parent: path }, src);
      const test = s.test ? expr(s.test, "test", path, src) : "";
      const update = s.update ? [line, expr(s.update, "update", path, src)] : "";
      return group(["for (", group([indent([softline, init, ";", line, test, ";", update]), softline]), ")", loop]);
    }
    case "forIn":
    case "forOf": {
      // The parser gives a declaration or, failing that, a pattern.
      const left = s.left.kind === "let"
        ? declarations(s.left.keyword, s.left.declarations, { sort: "stmt", node: s.left, key: "left", parent: path }, src, true)
        : pattern(s.left as Pattern, "left", path, src);
      return group([
        "for", s.await ? " await" : "", " (", left, s.kind === "forOf" ? " of " : " in ", expr(s.right, "right", path, src), ")",
        body(s.body, afterParen, "body", path, src, false),
      ]);
    }
    case "switch": {
      const cases = s.cases.map((c) => {
        const head = c.test ? ["case ", expr(c.test, "test", path, src), ":"] : "default:";
        const consequent = c.body.filter((x) => x.kind !== "empty");
        if (consequent.length === 0) return head;
        const printedBody = statements(consequent, path, src, false);
        return [head, consequent.length === 1 && consequent[0]!.kind === "block" ? [" ", printedBody] : indent([hardline, printedBody])];
      });
      return [
        group(["switch (", indent([softline, expr(s.discriminant, "discriminant", path, src)]), softline, ")"]), " {",
        cases.length > 0 ? indent([hardline, join(hardline, cases)]) : "", hardline, "}",
      ];
    }
    case "try": {
      const parts: Doc[] = ["try ", block(s.block, path, src, false, false)];
      if (s.handler) {
        const param = s.param ? ["(", pattern(s.param, "param", path, src), s.paramType ? [": ", type(s.paramType, "typeAnnotation", path, src)] : "", ") "] : "";
        parts.push(" catch ", param, block(s.handler, path, src, !s.finalizer, false));
      }
      if (s.finalizer) parts.push(" finally ", block(s.finalizer, path, src, false, false));
      return parts;
    }
  }
}

// A returned or thrown binary chain breaks inside parentheses of its own.
function returned(e: Expr, parent: At<"stmt">, src: string): Doc {
  const printedValue = expr(e, "argument", parent, src);
  return e.kind === "binary" ? group([ifBreak("("), indent([softline, printedValue]), softline, ifBreak(")")]) : printedValue;
}

// Declarators after `let`, `const` or `var`, one per line when any has a value, except in a
// `for` head.
function declarations(keyword: string, list: Declarator[], parent: At<"stmt">, src: string, inFor: boolean): Doc {
  const printedList = list.map((d) => declarator({ sort: "declarator", node: d, key: "declarations", parent }, src));
  const valued = list.some((d) => d.init !== undefined);
  const first = printedList.length === 1 ? printedList[0]! : indent(printedList[0]!);
  return group([keyword, " ", first, indent(printedList.slice(1).map((p) => [",", valued && !inFor ? hardline : line, p]))]);
}

function declarator(path: At<"declarator">, src: string): Doc {
  const d = path.node;
  const left = [pattern(d.target, "id", path, src), d.type ? [": ", type(d.type, "typeAnnotation", path, src)] : ""];
  return assignment(path, left, " =", d.init, "init", src);
}

// What a function, arrow or method is printed from.
type Fn = { params: Param[]; typeParams: TypeParam[]; returnType: TypeNode | undefined; throws?: TypeNode };
type FnNamed = Fn & { name: string | undefined; async: boolean; generator: boolean; body: Stmt[] | undefined };

// How a call argument is being printed: hugged as the first or last one, or as the right side
// of an assignment laid out a given way.
type Opts = { expandFirstArg?: boolean; expandLastArg?: boolean; assignmentLayout?: Layout };

// Thrown when an argument can't be hugged, as Prettier's ArgExpansionBailout: its parameters
// would have to break.
const bailout = new Error("the argument can't be hugged");

function functionDoc(f: FnNamed, path: Path, src: string, opts: Opts): Doc {
  const p = parentExpr(path);
  const expandParams = opts.expandLastArg === true && p?.kind === "call" &&
    (p.args.length > 1 || f.params.every((x) => x.pattern.kind === "ident" && !x.rest && x.default === undefined && x.type === undefined));
  return [
    f.async ? "async " : "", "function", f.generator ? "*" : "", " ", f.name ?? "", typeParameters(f.typeParams, path, src),
    signature(f, path, src, expandParams), f.body ? [" ", block(f.body, path, src)] : ";",
  ];
}

// A method's or accessor's type parameters, parameters, return type and body, after its name.
function methodRest(f: Fn & { body: Stmt[] }, path: Path, src: string): Doc {
  return [typeParameters(f.typeParams, path, src), signature(f, path, src, false), " ", block(f.body, path, src)];
}

function signature(f: Fn, path: Path, src: string, expandParams: boolean): Doc {
  const params = parameters(f, path, src, expandParams, "");
  const returned = returnType(f, path, src);
  return group([shouldGroupParameters(f, returned) ? group(params) : params, returned]);
}

// `: T`, and Fish's ` throws E` after it.
function returnType(f: Fn, path: Path, src: string): Doc {
  return [f.returnType ? [": ", type(f.returnType, "returnType", path, src)] : "", f.throws ? [" throws ", type(f.throws, "throws", path, src)] : ""];
}

// One parameter, at most one plain type parameter, and a return type that is an object type or
// breaks: the parentheses stay together.
function shouldGroupParameters(f: Fn, returned: Doc): boolean {
  const t = f.returnType;
  const plainTypeParams = f.typeParams.length === 0 || (f.typeParams.length === 1 && !f.typeParams[0]!.constraint && !f.typeParams[0]!.default);
  return t !== undefined && plainTypeParams && f.params.length === 1 && (isObjectType(t) || willBreak(returned));
}

const isObjectType = (t: TypeNode) => t.kind === "object" || t.kind === "mapped";

// Prettier's printFunctionParameters: one per line when they don't fit, run together inside a
// hugged argument or a test call, and around a lone destructured parameter. `typeParams` is
// printed before the `(` where Prettier puts it inside the parameters' group.
function parameters(f: Fn, path: Path, src: string, expandArg: boolean, typeParams: Doc): Doc {
  if (f.params.length === 0) return [typeParams, "()"];
  const p = parentExpr(path);
  const inTestCall = path.key === "arguments" && p !== undefined && isTestCall(p, undefined);
  const hug = shouldHugTheOnlyParameter(f.params);
  const parts: Doc[] = [];
  f.params.forEach((x, i) => {
    parts.push(param(x, path, src));
    if (i < f.params.length - 1) parts.push(",", inTestCall || hug ? " " : line);
  });
  if (expandArg && !curriedCallbackAssigned(path)) {
    if (willBreak(typeParams) || willBreak(parts)) throw bailout;
    return group([removeLines(typeParams), "(", removeLines(parts), ")"]);
  }
  if ((hug && f.params.every((x) => x.decorators.length === 0)) || inTestCall) return [typeParams, "(", ...parts, ")"];
  return [typeParams, "(", indent([softline, ...parts]), f.params[f.params.length - 1]!.rest ? "" : ifBreak(","), softline, ")"];
}

// `({ a, b }) => ...`: a lone object or array pattern, or a name typed with an object type.
function shouldHugTheOnlyParameter(params: Param[]): boolean {
  const only = params[0];
  if (params.length !== 1 || !only || only.rest) return false;
  const kind = only.pattern.kind;
  const d = only.default;
  if (kind === "object" || kind === "array") {
    return d === undefined || d.kind === "ident" || (d.kind === "object" && d.props.length === 0) || (d.kind === "array" && d.elements.length === 0);
  }
  return kind === "ident" && d === undefined && only.type !== undefined && isObjectType(only.type);
}

// `const x = f(a)(() => { ... })`: the callback's parameters may still break.
function curriedCallbackAssigned(path: Path): boolean {
  const e = path.sort === "expr" ? path.node : undefined;
  if (e?.kind !== "arrow" || !Array.isArray(e.body) || path.key !== "arguments") return false;
  const call = path.parent;
  if (call?.sort !== "expr" || call.node.kind !== "call" || call.node.args.length !== 1 || call.node.callee.kind !== "call") return false;
  const inner = call.node.callee.callee;
  const simple = inner.kind === "ident" || (inner.kind === "member" && inner.object.kind === "ident" && !inner.name.startsWith("#"));
  const owner = call.parent;
  return simple && ((owner?.sort === "declarator" && call.key === "init") || (stmtKind(owner) === "exportDefault") ||
    (owner?.sort === "expr" && owner.node.kind === "assign" && call.key === "right" && dotted(owner.node.target) === "module.exports"));
}

// A parameter's decorators stay on its line unless one was written with a line break after it.
function param(x: Param, fn: Path, src: string): Doc {
  const path: At<"param"> = { sort: "param", node: x, key: "params", parent: fn };
  const doc = [
    x.modifiers.map((m) => [m, " "]), x.comptime ? "comptime " : "", x.rest ? "..." : "", pattern(x.pattern, "pattern", path, src), x.optional ? "?" : "",
    x.type ? [": ", type(x.type, "typeAnnotation", path, src)] : "", x.default ? [" = ", expr(x.default, "right", path, src)] : "",
  ];
  if (x.decorators.length === 0) return doc;
  const brokenAfter = x.decorators.some((d) => /^\)*[ \t]*\r?\n/.test(src.slice(d.end)));
  return group([brokenAfter ? breakParent : "", join(line, x.decorators.map((d) => decorator(d, path, src))), line, doc]);
}

function pattern(p: Pattern, key: string, parent: Path, src: string): Doc {
  const path: At<"pattern"> = { sort: "pattern", node: p, key, parent };
  switch (p.kind) {
    case "ident":
      return p.name;
    case "default":
      return [pattern(p.target, "left", path, src), " = ", expr(p.value, "right", path, src)];
    case "expr":
      return expr(p.expr, "expression", path, src);
    case "array": {
      if (p.elements.length === 0 && !p.rest) return "[]";
      const items: Doc[] = p.elements.map((x, i) => [x ? group(pattern(x, "elements", path, src)) : "", i < p.elements.length - 1 || p.rest ? [",", line] : ""]);
      const last = p.elements[p.elements.length - 1];
      const trailing = p.rest ? "" : last === undefined && p.elements.length > 0 ? "," : ifBreak(",");
      return group(["[", indent([softline, ...items, p.rest ? ["...", pattern(p.rest, "argument", path, src)] : "", trailing]), softline, "]"]);
    }
    case "object":
      return objectPattern(p, path, src);
    case "wildcard":
      return "_";
    case "literal":
      return expr(p.value, "literal", path, src);
    case "variant":
      return variantPattern(p, path, src);
    case "or":
      return orPattern(p, path, src);
  }
}

function objectPattern(p: Extract<Pattern, { kind: "object" }>, path: At<"pattern">, src: string): Doc {
  if (p.props.length === 0 && !p.rest) return "{}";
  const parts = p.props.map((prop) => {
    // Shorthand, as in `{ a }` or `{ a = 1 }`, shares its start with the property.
    if (prop.value.start === prop.start) return pattern(prop.value, "value", path, src);
    const key = propertyKey(prop.key, prop.start, 0, path, src);
    const keyText = flatText(key);
    const layout = !hasLine(key) && keyText !== undefined && [...keyText].length < 5 ? "never-break-after-operator" : "fluid";
    return layoutDoc(layout, key, ":", pattern(prop.value, "value", path, src));
  });
  if (p.rest) parts.push(["...", pattern(p.rest, "argument", path, src)]);
  const up = path.parent;
  const nested = up?.sort !== "param" && !(up?.sort === "pattern" && up.node.kind === "default") && !inMatch(path) &&
    p.props.some((x) => x.value.kind === "object" || x.value.kind === "array");
  const doc = ["{", indent([line, join([",", line], parts)]), p.rest ? "" : ifBreak(","), line, "}"];
  const assigned = up?.sort === "declarator" || (up?.sort === "expr" && up.node.kind === "destructure");
  return huggedParam(path) || (!nested && assigned) ? doc : group(doc, { shouldBreak: nested });
}

// A `match` pattern isn't a destructuring, so a nested object or array in it doesn't force a break.
function inMatch(path: Path): boolean {
  let p: Path | undefined = path;
  while (p?.sort === "pattern") p = p.parent;
  return p?.sort === "arm";
}

// Whether `path` is the pattern, or the type annotation, of a function's lone hugged parameter.
function huggedParam(path: Path): boolean {
  const up = path.parent;
  return up?.sort === "param" && up.parent !== undefined && shouldHugTheOnlyParameter(functionParams(up.parent));
}

function functionParams(path: Path): Param[] {
  const n = path.node;
  if (path.sort === "expr" && (path.node.kind === "arrow" || path.node.kind === "function")) return path.node.params;
  if (path.sort === "stmt" && path.node.kind === "function") return path.node.params;
  if ((path.sort === "prop" || path.sort === "type") && "params" in n) return n.params;
  return [];
}

// `<T extends U = V, ...>` on a declaration; a lone plain one on an arrow prints as `<T,>`, as
// Prettier writes it where the file could be TSX.
function typeParameters(list: TypeParam[], owner: Path, src: string): Doc {
  if (list.length === 0) return "";
  const printedParams = list.map((t) => typeParameter(t, owner, src));
  const lone = list.length === 1 && !list[0]!.constraint && owner.sort === "expr" && owner.node.kind === "arrow";
  return group(["<", indent([softline, join([",", line], printedParams)]), lone ? "," : ifBreak(","), softline, ">"]);
}

function typeParameter(t: TypeParam, owner: Path, src: string): Doc {
  const parts: Doc[] = [t.modifiers.includes("const") ? "const " : "", t.modifiers.includes("in") ? "in " : "", t.modifiers.includes("out") ? "out " : "", t.name];
  if (t.constraint) parts.push(" extends", ...hangingValue(type(t.constraint, "constraint", owner, src)));
  if (t.default) parts.push(" =", ...hangingValue(type(t.default, "default", owner, src)));
  return group(parts);
}

// A value that moves to the next line, indented, when it doesn't fit after its keyword.
function hangingValue(doc: Doc): Doc[] {
  const id = groupId("hanging");
  return [group(indent(line), { id }), lineSuffixBoundary, indentIfBreak(doc, { groupId: id })];
}

function type(t: TypeNode, key: string, parent: Path, src: string, opts: Opts = {}): Doc {
  const path: At<"type"> = { sort: "type", node: t, key, parent };
  const doc = typeDoc(path, src, opts);
  return typeNeedsParens(path) ? ["(", doc, ")"] : doc;
}

function typeDoc(path: At<"type">, src: string, opts: Opts): Doc {
  const t = path.node;
  switch (t.kind) {
    case "ref":
      return [t.name, typeArguments(t.args, path, src)];
    case "literal":
      return expr(t.value, "literal", path, src);
    case "array":
      return [type(t.element, "elementType", path, src), "[]"];
    case "tuple":
      return tupleType(t, path, src);
    case "object":
      return objectType(t, path, src);
    case "function": {
      const f: Fn = { ...t, returnType: t.returns };
      const params = parameters(f, path, src, false, typeParameters(t.typeParams, path, src));
      const returned = [" => ", type(t.returns, "returnType", path, src)];
      const head = [t.abstract ? "abstract " : "", t.construct ? "new " : ""];
      return group([head, shouldGroupParameters(f, returned) ? group(params) : params, returned]);
    }
    case "union":
      return unionType(t, path, src, opts);
    case "intersection":
      return intersectionType(t, path, src);
    case "operator":
      return [t.op, " ", type(t.type, "typeAnnotation", path, src)];
    case "indexed":
      return [type(t.object, "objectType", path, src), "[", type(t.index, "indexType", path, src), "]"];
    case "query":
      return ["typeof ", type(t.target, "exprName", path, src)];
    case "import": {
      const at = src.indexOf("(", t.start) + 1;
      const tokens = lexer(src.slice(at));
      const literal = tokens.next();
      return ["import(", quoted(src.slice(at + literal.start, at + literal.end)), ")", t.name ? [".", t.name] : "", typeArguments(t.args, path, src)];
    }
    case "conditional":
      return conditionalType(t, path, src);
    case "infer":
      return ["infer ", group([t.name, t.constraint ? [" extends", ...hangingValue(type(t.constraint, "constraint", path, src))] : ""])];
    case "template":
      return templateType(t, path, src);
    case "mapped":
      return mappedType(t, path, src);
    case "predicate":
      return [t.asserts ? "asserts " : "", t.name, t.type ? [" is ", type(t.type, "typeAnnotation", path, src)] : ""];
  }
}

// Prettier's needsParens for types: a function, conditional, union or intersection type inside
// another type that would read it differently, and an operator type before `[]` or `[K]`.
function typeNeedsParens(path: At<"type">): boolean {
  const { node: t, key } = path;
  const up = path.parent;
  const p = up?.sort === "type" ? up.node : undefined;
  const inArrayLike = p?.kind === "array" || key === "optionalType" || key === "restType" || (key === "objectType" && p?.kind === "indexed") || p?.kind === "operator";
  switch (t.kind) {
    case "function":
    case "conditional": {
      if (t.kind === "function" && !t.construct && key === "returnType" && up?.sort === "expr" && up.node.kind === "arrow") return true;
      if (p?.kind === "conditional" && (key === "checkType" || (key === "extendsType" && t.kind === "conditional"))) return true;
      if (key === "constraint" && t.kind === "conditional" && up?.sort !== "type") return true;
      if (key === "extendsType" && p?.kind === "conditional" && t.kind === "function") {
        const r = t.returns.kind === "predicate" && t.returns.type ? t.returns.type : t.returns;
        if (r.kind === "infer" && r.constraint) return true;
      }
      return p?.kind === "union" || p?.kind === "intersection" || inArrayLike;
    }
    case "union":
    case "intersection":
      return p?.kind === "union" || p?.kind === "intersection" || inArrayLike;
    case "infer":
      if (key === "restType") return false;
      if (key === "types" && (p?.kind === "union" || p?.kind === "intersection") && t.constraint) return true;
      return inArrayLike;
    case "operator":
      return inArrayLike;
    case "query":
      return (key === "objectType" && p?.kind === "indexed") || (key === "elementType" && p?.kind === "array");
    default:
      return false;
  }
}

// `<A, B>` after a call, a `new`, an instantiation or a type name; one simple or object type
// never breaks.
function typeArguments(args: TypeNode[], parent: Path, src: string): Doc {
  if (args.length === 0) return "";
  const printedArgs = args.map((t) => type(t, "params", parent, src));
  const only = args[0]!;
  const keepsTogether = isSimpleType(only) || isObjectType(only) || (only.kind === "union" && simpleUnion(only.types));
  if (args.length === 1 && keepsTogether) return ["<", printedArgs, ">"];
  return group(["<", indent([softline, join([",", line], printedArgs)]), softline, ">"]);
}

function tupleType(t: Extract<TypeNode, { kind: "tuple" }>, path: At<"type">, src: string): Doc {
  if (t.elements.length === 0) return "[]";
  const items = t.elements.map((x, i) => {
    let doc: Doc;
    if (x.name !== undefined) doc = [x.rest ? "..." : "", x.name, x.optional ? "?" : "", ": ", type(x.type, "elementType", path, src)];
    else if (x.rest) doc = ["...", type(x.type, "restType", path, src)];
    else if (x.optional) doc = [type(x.type, "optionalType", path, src), "?"];
    else doc = type(x.type, "elementTypes", path, src);
    return [group(doc), i < t.elements.length - 1 ? [",", line] : ""];
  });
  return group(["[", indent([softline, items, ifBreak(",")]), softline, "]"]);
}

// `Foo | null` and the like: one object or reference type with only `null` or `void` beside it,
// printed on one line.
function simpleUnion(types: TypeNode[]): boolean {
  const main = types.find((t) => t.kind === "object" || (t.kind === "ref" && !["null", "void"].includes(t.name)));
  return main !== undefined && types.every((t) => t === main || (t.kind === "ref" && (t.name === "null" || t.name === "void") && t.args.length === 0));
}

// A union broken one member per line with a leading `|`, indented under what holds it unless
// that already sets it apart.
function unionType(t: Extract<TypeNode, { kind: "union" | "intersection" }>, path: At<"type">, src: string, opts: Opts): Doc {
  const printedTypes = t.types.map((x) => type(x, "types", path, src));
  if (simpleUnion(t.types)) return join(" | ", printedTypes);
  const members = group(printedTypes.map((d, i) => [i === 0 ? ifBreak("| ") : [line, "| "], align(2, d)]));
  if (typeNeedsParens(path)) return group([indent([softline, members]), softline]);
  const up = path.parent;
  if (path.key === "elementTypes" && up?.sort === "type" && up.node.kind === "tuple" && up.node.elements.length > 1) {
    return group([indent([ifBreak(["(", softline]), members]), softline, ifBreak(")")]);
  }
  const p = up?.sort === "type" ? up.node : undefined;
  const setApart = (path.key === "typeAnnotation" && up?.sort === "expr" && up.node.kind === "assertion") ||
    path.key === "elementTypes" || ((path.key === "trueType" || path.key === "falseType") && p?.kind === "conditional") || path.key === "params";
  return opts.assignmentLayout === "break-after-operator" || setApart ? members : group(indent([softline, members]));
}

// Members joined by ` & `, breaking before each that isn't an object type.
function intersectionType(t: Extract<TypeNode, { kind: "union" | "intersection" }>, path: At<"type">, src: string): Doc {
  let wasIndented = false;
  return group(t.types.map((x, i) => {
    const doc = type(x, "types", path, src);
    if (i === 0) return doc;
    const isObject = isObjectType(x);
    const previousIsObject = isObjectType(t.types[i - 1]!);
    if (previousIsObject && isObject) return [" & ", wasIndented ? indent(doc) : doc];
    if (!previousIsObject && !isObject) return indent([" &", line, doc]);
    if (i > 1) wasIndented = true;
    return [" & ", i > 1 ? indent(doc) : doc];
  }));
}

// An object type literal; members end in `;`, and one written with a line break after its `{`
// stays expanded.
function objectType(t: Extract<TypeNode, { kind: "object" }>, path: At<"type">, src: string): Doc {
  if (t.members.length === 0) return "{}";
  const members = t.members.map((m, i) => [typeMember(m, path, src), i === t.members.length - 1 ? ifBreak(";") : ";"]);
  const doc = ["{", indent([line, join(line, members)]), line, "}"];
  const expanded = src.slice(t.start, t.members[0]!.start).includes("\n");
  return huggedParam(path) && path.key === "typeAnnotation" ? doc : group(doc, { shouldBreak: expanded });
}

function typeMember(m: TypeMember, parent: At<"type">, src: string): Doc {
  switch (m.kind) {
    case "property":
      return [m.readonly ? "readonly " : "", propertyKey(m.name, m.start, m.readonly ? 1 : 0, parent, src), m.optional ? "?" : "",
        m.type ? [": ", type(m.type, "typeAnnotation", parent, src)] : ""];
    case "index": {
      const params = m.params.map((x) => param(x, parent, src));
      return [m.readonly ? "readonly " : "", "[", group([indent([softline, join([", ", softline], params)]), m.params.length > 1 ? ifBreak(",") : "", softline]),
        "]", ": ", type(m.type, "typeAnnotation", parent, src)];
    }
    case "call":
    case "construct":
      return group([m.kind === "construct" ? "new " : "", ...memberSignature(m, parent, src)]);
    case "method":
      return group([propertyKey(m.name, m.start, 0, parent, src), m.optional ? "?" : "", ...memberSignature(m, parent, src, true)]);
    case "get":
    case "set":
      return group([m.kind, " ", propertyKey(m.name, m.start, 1, parent, src), ...memberSignature(m, parent, src, true)]);
  }
}

// A signature's parameters and return type; a method's return type is grouped on its own.
function memberSignature(m: { params: Param[]; returns: TypeNode | undefined; typeParams?: TypeParam[] }, parent: At<"type">, src: string, method = false): Doc[] {
  const f: Fn = { params: m.params, typeParams: m.typeParams ?? [], returnType: m.returns };
  const params = parameters(f, parent, src, false, typeParameters(f.typeParams, parent, src));
  const returned = m.returns ? [": ", type(m.returns, "returnType", parent, src)] : "";
  return [shouldGroupParameters(f, returned) ? group(params) : params, method && m.returns ? group(returned) : returned];
}

// `{ readonly [K in T as N]?: V }`; one written with a line break after its `{` stays expanded.
function mappedType(t: Extract<TypeNode, { kind: "mapped" }>, path: At<"type">, src: string): Doc {
  // The tree records `readonly` and `?` as "+" whether or not a `+` was written.
  const signed = (from: number, sign: "+" | "-" | undefined, text: string) => {
    if (sign === undefined) return "";
    if (sign === "-") return `-${text}`;
    return src.slice(from).trimStart().startsWith("+") ? `+${text}` : text;
  };
  const afterKey = src.indexOf("]", (t.as ?? t.constraint).end) + 1;
  const expanded = /^\s*/.exec(src.slice(t.start + 1))![0].includes("\n");
  const key = group(["[", indent([softline, t.name, " in ", type(t.constraint, "sourceType", path, src), t.as ? [" as ", type(t.as, "nameType", path, src)] : ""]), softline, "]"]);
  return group([
    "{",
    indent([
      line, t.readonly ? [signed(t.start + 1, t.readonly, "readonly"), " "] : "", key, signed(afterKey, t.optional, "?"),
      t.type ? [": ", type(t.type, "typeAnnotation", path, src)] : "", ifBreak(";"),
    ]),
    line, "}",
  ], { shouldBreak: expanded });
}

// A template literal type, its text as written and each `${}` printed as in a template literal.
function templateType(t: Extract<TypeNode, { kind: "template" }>, path: At<"type">, src: string): Doc {
  // The tree keeps the decoded text, so each piece is read again from the source.
  const parts: Doc[] = [lineSuffixBoundary, "`"];
  let from = t.start + 1;
  t.types.forEach((x) => {
    const open = src.lastIndexOf("${", x.start);
    parts.push(join(literalline, src.slice(from, open).split("\n")), group(["${", type(x, "types", path, src), lineSuffixBoundary, "}"]));
    from = src.indexOf("}", x.end) + 1;
  });
  parts.push(join(literalline, src.slice(from, t.end - 1).split("\n")), "`");
  return parts;
}

// A conditional type in Prettier's default layout: a chain in the false branch kept at one
// indentation, as conditional expressions are.
function conditionalType(t: Extract<TypeNode, { kind: "conditional" }>, path: At<"type">, src: string): Doc {
  const up = path.parent;
  const p = up?.sort === "type" ? up.node : undefined;
  const inCheck = p?.kind === "conditional" && (path.key === "checkType" || path.key === "extendsType");
  const forceNoIndent = p?.kind === "conditional" && !inCheck;
  let previous: Path = path;
  let current = up;
  while (current?.sort === "type" && current.node.kind === "conditional" && previous.key !== "checkType" && previous.key !== "extendsType") {
    previous = current;
    current = current.parent;
  }
  const nested = t.then.kind === "conditional";
  const parts = [
    line, "? ", nested ? ifBreak("", "(") : "", align(2, type(t.then, "trueType", path, src)), nested ? ifBreak("", ")") : "",
    line, ": ", align(2, type(t.else, "falseType", path, src)),
  ];
  const head = [type(t.check, "checkType", path, src), " extends ", type(t.extends, "extendsType", path, src)];
  const contents = [p?.kind === "conditional" && path.key === "falseType" ? align(2, head) : head, forceNoIndent ? parts : indent(parts)];
  const result = current === up ? group(contents) : contents;
  return inCheck ? group([indent([softline, result]), softline]) : result;
}

// `type A<T> = ...`, laid out as an assignment: a union breaks after the `=`, as does a
// conditional type testing generic types.
function typeAlias(s: Extract<Stmt, { kind: "typeAlias" }>, path: At<"stmt">, src: string): Doc {
  const left = ["type ", s.name, typeParameters(s.typeParams, path, src)];
  const t = s.type;
  const generic = (x: TypeNode) => (x.kind === "ref" && x.args.length > 0) || (x.kind === "function" && x.typeParams.length > 0);
  let layout: Layout = "fluid";
  if ((t.kind === "union" && !simpleUnion(t.types)) || (t.kind === "conditional" && (generic(t.check) || generic(t.extends)))) layout = "break-after-operator";
  else if (s.typeParams.length > 1 && s.typeParams.some((x) => x.constraint || x.default)) layout = "break-lhs";
  return [layoutDoc(layout, left, " =", type(t, "typeAnnotation", path, src, { assignmentLayout: layout })), ";"];
}

function expr(e: Expr, key: string, parent: Path, src: string): Doc {
  return printed(at(e, key, parent), src);
}

// An expression with the parentheses its place needs, keeping its label.
// Each expression's document, printed once per place as Prettier caches it: hugging prints an
// argument a second time, and without the cache nested callbacks would cost 2^depth.
const printedCache = new WeakMap<Expr, { parent: unknown; key: string; doc: Doc }>();

function printed(path: At<"expr">, src: string, opts: Opts = {}): Doc {
  const plain = opts.expandFirstArg === undefined && opts.expandLastArg === undefined && opts.assignmentLayout === undefined;
  const cached = plain ? printedCache.get(path.node) : undefined;
  if (cached && cached.parent === path.parent?.node && cached.key === path.key) return cached.doc;
  const doc = withParens(path, src, opts);
  if (plain) printedCache.set(path.node, { parent: path.parent?.node, key: path.key, doc });
  return doc;
}

function withParens(path: At<"expr">, src: string, opts: Opts): Doc {
  const doc = expression(path, src, opts);
  if (!needsParens(path)) return doc;
  if (typeof doc === "object" && !Array.isArray(doc) && doc.kind === "label") return label(doc.label, ["(", doc.contents, ")"]);
  return ["(", doc, ")"];
}

function expression(path: At<"expr">, src: string, opts: Opts = {}): Doc {
  const e = path.node;
  switch (e.kind) {
    case "arrow":
      return arrow(e, path, src, opts);
    case "function":
      return functionDoc(e, path, src, opts);
    case "class":
      return classDoc(e, path, src, false);
    case "match":
      return matchDoc(e, path, src);
    case "topic":
      return "%";
    case "pipe":
      return expression({ ...path, node: pipeAsBinary(e) }, src, opts);
    case "comptime":
      return ["comptime ", expr(e.expr, "argument", path, src)];
    case "throw":
      return ["throw ", expr(e.value, "argument", path, src)];
    case "unsafe":
      return group(["unsafe {", indent([line, expr(e.expr, "expression", path, src)]), line, "}"]);
    case "object":
      return object(e, path, src);
    case "array":
      return array(e, path, src);
    case "template":
      return template(e, path, src);
    case "tagged":
      return [expr(e.tag, "tag", path, src), typeArguments(e.typeArgs, path, src), lineSuffixBoundary, expr(e.template, "quasi", path, src)];
    case "regex":
      return `/${e.pattern}/${[...e.flags].sort().join("")}`;
    case "destructure":
      return assignment(path, pattern(e.pattern, "left", path, src), " =", e.value, "right", src);
    case "ident":
      return e.name;
    case "this":
    case "super":
    case "null":
      return e.kind;
    case "bool":
      return String(e.value);
    case "int":
      return number(src.slice(e.start, e.end));
    case "float": {
      // Fish's floats and integers are different types, so `5.` and `1e0` stay floats as `5.0`
      // and `1.0` where Prettier would print `5` and `1`.
      const text = number(src.slice(e.start, e.end));
      return /[.e]/.test(text) ? text : `${text}.0`;
    }
    case "bigint":
      return src.slice(e.start, e.end).toLowerCase();
    case "string":
      return quoted(src.slice(e.start, e.end));
    case "privateName":
    case "meta":
      return e.name;
    case "spread":
      return ["...", expr(e.value, "argument", path, src)];
    case "unary":
      return e.op === "await" ? awaited(e, path, src) : [e.op, /[a-z]$/.test(e.op) ? " " : "", expr(e.operand, "argument", path, src)];
    case "update": {
      const operand = expr(e.operand, "argument", path, src);
      return e.prefix ? [e.op, operand] : [operand, e.op];
    }
    case "yield":
      return [e.delegate ? "yield*" : "yield", e.value ? [" ", expr(e.value, "argument", path, src)] : ""];
    case "binary":
      return binary(e, path, src);
    case "assign":
      return assignment(path, expr(e.target, "left", path, src), [" ", e.op], e.value, "right", src);
    case "sequence":
      return sequence(e, path, src);
    case "conditional":
      return conditional(e, path, src);
    case "as":
    case "satisfies": {
      const parts = [expr(e.expr, "expression", path, src), " ", e.kind, " ", type(e.type, "typeAnnotation", path, src)];
      const p = parentExpr(path);
      const hugged = (path.key === "callee" && (p?.kind === "call" || p?.kind === "new")) || (path.key === "object" && isMember(p));
      return hugged ? group([indent([softline, ...parts]), softline]) : parts;
    }
    case "assertion": {
      const asserted = group(["<", indent([softline, type(e.type, "typeAnnotation", path, src)]), softline, ">"]);
      const operand = expr(e.expr, "expression", path, src);
      if (e.expr.kind === "array" || e.expr.kind === "object") return group([asserted, operand]);
      const broken = group([ifBreak("("), indent([softline, operand]), softline, ifBreak(")")], { shouldBreak: true });
      return conditionalGroup([[asserted, operand], [asserted, broken], [asserted, operand]]);
    }
    case "nonNull":
      return [expr(e.expr, "expression", path, src), "!"];
    case "instantiation":
      return [expr(e.expr, "expression", path, src), typeArguments(e.typeArgs, path, src)];
    case "member":
    case "index":
      return member(e, path, src);
    case "call":
    case "new":
    case "import":
      return call(e, path, src);
  }
}

// Prettier's node types where they split one of ours: `await` is its own, and `&&`, `||` and
// `??` are logical rather than binary.
type Form = Expr["kind"] | "await" | "logical";

// What a `throw` expression's operand, parsed at unary precedence, can't be without parentheses.
const belowUnary = new Set<Form>(["binary", "logical", "conditional", "assign", "arrow", "as", "satisfies", "yield", "sequence", "throw"]);

function form(e: Expr): Form {
  if (e.kind === "unary" && e.op === "await") return "await";
  if (e.kind === "binary" && isLogicalOp(e.op)) return "logical";
  if (e.kind === "destructure") return "assign";
  if (e.kind === "comptime") return "await";
  if (e.kind === "throw") return "throw";
  if (e.kind === "pipe") return "binary";
  return e.kind;
}

const isPipe = (e: Expr) => e.kind === "pipe" || (e.kind === "binary" && (e.op as string) === "|>");
const isLogicalOp = (op: BinaryOp) => op === "&&" || op === "||" || op === "??";
const isMember = (e: Expr | undefined) => e?.kind === "member" || e?.kind === "index";
const isAsLike = (e: Expr | undefined) => e?.kind === "as" || e?.kind === "satisfies";
const isCallOrNew = (e: Expr | undefined) => e?.kind === "call" || e?.kind === "new";
const parentExpr = (path: Path): Expr | undefined => (path.parent?.sort === "expr" ? path.parent.node : undefined);
const stmtKind = (path: Path | undefined) => (path?.sort === "stmt" ? path.node.kind : undefined);

const precedence = new Map<string, number>(
  [["|>"], ["??"], ["||"], ["&&"], ["|"], ["^"], ["&"], ["==", "===", "!=", "!=="], ["<", ">", "<=", ">=", "in", "instanceof"],
    [">>", "<<", ">>>"], ["+", "-"], ["*", "/", "%"], ["**"]].flatMap((ops, i) => ops.map((op): [string, number] => [op, i])),
);
const equality = new Set(["==", "!=", "===", "!=="]);
const multiplicative = new Set(["*", "/", "%"]);
const shifts = new Set([">>", ">>>", "<<"]);
const isBitwise = (op: string) => shifts.has(op) || op === "|" || op === "^" || op === "&";

// Whether `a op1 b op2 c` prints as one chain rather than with the left side in parentheses:
// `%` beside `*` or `/`, two equalities, two shifts and `**` are kept apart for clarity.
function shouldFlatten(parentOp: string, nodeOp: string | undefined): boolean {
  if (nodeOp === undefined || precedence.get(parentOp) !== precedence.get(nodeOp)) return false;
  if (parentOp === "**") return false;
  if (equality.has(parentOp) && equality.has(nodeOp)) return false;
  if ((nodeOp === "%" && multiplicative.has(parentOp)) || (parentOp === "%" && multiplicative.has(nodeOp))) return false;
  if (nodeOp !== parentOp && multiplicative.has(nodeOp) && multiplicative.has(parentOp)) return false;
  return !(shifts.has(parentOp) && shifts.has(nodeOp));
}

// Prettier's needsParens for the expression forms printed so far.
function needsParens(path: At<"expr">): boolean {
  const { node: e, key, parent: up } = path;
  if (!up) return false;
  // An object, function or class at the start of a statement, or an object at the start of an
  // arrow's body, would read as a block or a declaration.
  if (e.kind === "object" || e.kind === "function" || e.kind === "class" || e.kind === "unsafe") {
    let s: Path | undefined = up;
    while (s && !(s.sort === "stmt" && s.node.kind === "expr")) s = s.parent;
    if (s?.sort === "stmt" && s.node.kind === "expr" && leftmost(s.node.expr) === e) return true;
  }
  if (e.kind === "object") {
    let a: Path | undefined = up;
    while (a && !(a.sort === "expr" && a.node.kind === "arrow") && a.sort !== "arm") a = a.parent;
    const body = a?.sort === "expr" && a.node.kind === "arrow" ? a.node.body : a?.sort === "arm" && a.node.body.kind !== "block" ? a.node.body : undefined;
    if (body && !Array.isArray(body) && body.kind !== "sequence" && form(body) !== "assign" && leftmost(body) === e) return true;
  }
  if (e.kind === "binary" && e.op === "in" && inForInit(path)) return true;
  if (key === "superClass" && superClassNeedsParens(e)) return true;
  // A guard is read at binary precedence.
  if (key === "guard" && up.sort === "arm") return ["conditional", "arrow", "yield", "assign", "sequence", "throw"].includes(form(e)) || isPipe(e);
  if (up.sort !== "expr") {
    if (stmtKind(up) === "for") return false;
    if (e.kind === "sequence") return true;
    if (e.kind === "destructure") return stmtKind(up) !== "expr" || e.pattern.kind === "object";
    return e.kind === "assign" && stmtKind(up) !== "expr";
  }
  const p = up.node;
  const pf = form(p);
  if (pf === "throw") return belowUnary.has(form(e));
  switch (form(e)) {
    case "int":
    case "float":
      return key === "object" && isMember(p);
    case "update":
      if (e.kind === "update" && pf === "unary" && p.kind === "unary") {
        return e.prefix && ((e.op === "++" && p.op === "+") || (e.op === "--" && p.op === "-"));
      }
      return unaryParens(e, key, p);
    case "unary":
      return unaryParens(e, key, p);
    case "binary":
      return pf === "update" || binaryishParens(e, key, p);
    case "logical":
    case "as":
    case "satisfies":
    case "assertion":
      return binaryishParens(e, key, p);
    case "sequence":
      return true;
    case "yield":
    case "throw":
      return pf === "await" || pf === "assertion" || awaitParens(key, p);
    case "await":
      return awaitParens(key, p);
    case "assign":
      return !(pf === "assign" || (pf === "sequence" && stmtKind(up.parent) === "for"));
    case "conditional":
      switch (pf) {
        case "tagged": case "unary": case "spread": case "binary": case "logical": case "await":
        case "assertion": case "as": case "satisfies": case "nonNull":
          return true;
        case "call": case "new":
          return key === "callee";
        case "conditional":
          return key === "test";
        case "member": case "index":
          return key === "object";
        default:
          return false;
      }
    case "call": case "member": case "index": case "tagged": case "import": case "nonNull":
      return key === "callee" && pf === "new" && (endsInCall(e) || optionalChain(e));
    case "instantiation":
      return key === "object" && isMember(p);
    // `unsafe { x }` is read at unary precedence, so it can't be looked into or called bare.
    case "unsafe":
      return (key === "object" && isMember(p)) || (key === "callee" && isCallOrNew(p)) || pf === "tagged" || pf === "nonNull" || pf === "update";
    case "function":
      return (key === "callee" && isCallOrNew(p)) || pf === "tagged";
    case "class":
      return key === "callee" && pf === "new";
    case "arrow":
      switch (pf) {
        case "binary": case "as": case "satisfies": case "nonNull": case "tagged": case "unary": case "logical": case "await": case "assertion":
          return true;
        case "call": case "new":
          return key === "callee";
        case "member": case "index":
          return key === "object";
        case "instantiation":
          return key === "expression";
        case "conditional":
          return key === "test";
        default:
          return false;
      }
    default:
      return false;
  }
}

// A class's base that isn't a plain call or lookup chain reads clearer in parentheses.
// Only what the parser reads after `extends` goes bare: a primary, or a chain of lookups and
// calls on one. Prettier also wraps `new`, object literals and tagged templates.
function superClassNeedsParens(e: Expr): boolean {
  if (e.kind === "class") return e.decorators.length > 0;
  return !bareBase.has(e.kind);
}

const bareBase = new Set<Expr["kind"]>([
  "ident", "this", "super", "member", "index", "call", "nonNull", "instantiation", "int", "float", "bigint", "string", "bool",
  "null", "regex", "array", "function", "template", "match", "import", "meta", "privateName", "topic",
]);

// Whether `path` lies inside a `for` head's initializer, where `in` would end it.
function inForInit(path: Path): boolean {
  for (let p: Path | undefined = path; p?.parent; p = p.parent) {
    if (p.key === "init" && stmtKind(p.parent) === "for") return true;
  }
  return false;
}

function unaryParens(e: Expr, key: string, p: Expr): boolean {
  switch (form(p)) {
    case "unary":
      return e.kind === "unary" && p.kind === "unary" && e.op === p.op && (e.op === "+" || e.op === "-");
    case "member": case "index":
      return key === "object";
    case "tagged": case "nonNull":
      return true;
    case "call": case "new":
      return key === "callee";
    case "binary":
      if (p.kind !== "binary" || key !== "left") return false;
      return (e.kind === "unary" && (p.op === "in" || p.op === "instanceof")) || p.op === "**";
    default:
      return false;
  }
}

function binaryishParens(e: Expr, key: string, p: Expr): boolean {
  const pf = form(p);
  switch (pf) {
    case "as": case "satisfies":
      return !isAsLike(e);
    case "conditional":
      return isAsLike(e) || (e.kind === "binary" && (e.op === "??" || (e.op as string) === "|>"));
    case "call": case "new":
      return key === "callee";
    case "assertion": case "tagged": case "spread": case "await": case "nonNull": case "update": case "unary":
      return true;
    case "member": case "index":
      return key === "object";
    case "assign":
      return key === "left" && (e.kind === "assertion" || isAsLike(e));
    case "logical":
    case "binary": {
      if (p.kind !== "binary") return false;
      if (pf === "logical" && e.kind === "binary" && isLogicalOp(e.op)) return p.op !== e.op;
      if (isAsLike(e)) return true;
      const parentPrecedence = precedence.get(p.op)!;
      if (e.kind === "binary") {
        const nodePrecedence = precedence.get(e.op)!;
        if (parentPrecedence > nodePrecedence) return true;
        if (key === "right" && parentPrecedence === nodePrecedence) return true;
        if (parentPrecedence === nodePrecedence && !shouldFlatten(p.op, e.op)) return true;
        if (parentPrecedence < nodePrecedence && e.op === "%" && (p.op === "+" || p.op === "-")) return true;
      }
      return isBitwise(p.op);
    }
    default:
      return false;
  }
}

function awaitParens(key: string, p: Expr): boolean {
  switch (form(p)) {
    case "tagged": case "unary": case "logical": case "spread": case "as": case "satisfies": case "nonNull": case "binary":
      return true;
    case "member": case "index":
      return key === "object";
    case "call": case "new":
      return key === "callee";
    case "conditional":
      return key === "test";
    default:
      return false;
  }
}

// A `new` callee ending in a call needs parentheses, or the call's arguments would be taken
// as the constructor's: `new (a.b())()`.
function endsInCall(e: Expr): boolean {
  for (;;) {
    switch (e.kind) {
      case "call": case "import":
        return true;
      case "member": case "index":
        e = e.object;
        break;
      case "tagged":
        e = e.tag;
        break;
      case "nonNull":
        e = e.expr;
        break;
      default:
        return false;
    }
  }
}

// `new (a?.b)()`: a `new` callee holding an optional link keeps its parentheses, as Prettier
// keeps them around a chain.
function optionalChain(e: Expr): boolean {
  for (;;) {
    if ((e.kind === "member" || e.kind === "index" || e.kind === "call") && e.optional) return true;
    if (e.kind === "member" || e.kind === "index") e = e.object;
    else if (e.kind === "call") e = e.callee;
    else if (e.kind === "nonNull") e = e.expr;
    else if (e.kind === "tagged") e = e.tag;
    else return false;
  }
}

// The leftmost part of `e`, as Prettier's startsWithNoLookaheadToken finds it; nothing past a
// function called or tagged in place, or a prefix update.
function leftmost(e: Expr): Expr | undefined {
  switch (e.kind) {
    case "binary":
      return leftmost(e.left);
    case "assign":
      return leftmost(e.target);
    case "destructure":
      return undefined;
    case "member": case "index":
      return leftmost(e.object);
    case "tagged":
      return e.tag.kind === "function" ? undefined : leftmost(e.tag);
    case "call":
      return e.callee.kind === "function" ? undefined : leftmost(e.callee);
    case "conditional":
      return leftmost(e.cond);
    case "update":
      return e.prefix ? undefined : leftmost(e.operand);
    case "sequence":
      return leftmost(e.exprs[0]!);
    case "nonNull": case "as": case "satisfies":
      return leftmost(e.expr);
    case "pipe":
      return leftmost(e.value);
    default:
      return e;
  }
}

// `await x` called or looked into breaks inside its parentheses, unless an outer `await` starts
// with it and breaks there instead.
function awaited(e: Of<"unary">, path: At<"expr">, src: string): Doc {
  const parts: Doc = ["await ", expr(e.operand, "argument", path, src)];
  const p = parentExpr(path);
  if (!((path.key === "callee" && p?.kind === "call") || (path.key === "object" && isMember(p)))) return parts;
  let ancestor = path.parent;
  while (ancestor?.sort === "expr" && form(ancestor.node) !== "await") ancestor = ancestor.parent;
  const outer = ancestor?.sort === "expr" ? ancestor.node : undefined;
  const broken = [indent([softline, parts]), softline];
  return outer?.kind === "unary" && leftmost(outer.operand) === e ? broken : group(broken);
}

// A chain of binary operators, printed flat with a break allowed before each right operand,
// and indented after the first unless its place already sets it apart.
function binary(e: Of<"binary">, path: At<"expr">, src: string): Doc {
  const { key, parent } = path;
  const p = parentExpr(path);
  const pk = stmtKind(parent);
  const inParens = key !== "body" && (pk === "if" || pk === "while" || pk === "switch" || pk === "doWhile");
  const parts = binaryParts(path, src, inParens);
  if (inParens) return parts;
  if ((e.op as string) === "|>") return group(parts);
  if ((key === "callee" && isCallOrNew(p)) || (p !== undefined && form(p) === "unary") || p?.kind === "member") {
    return group([indent([softline, ...parts]), softline]);
  }
  const grandparent = parent?.parent;
  const shouldNotIndent =
    pk === "return" || pk === "throw" ||
    (key === "body" && (p?.kind === "arrow" || parent?.sort === "arm")) ||
    (key !== "body" && pk === "for") ||
    (p?.kind === "conditional" && stmtKind(grandparent) !== "return" && stmtKind(grandparent) !== "throw" &&
      !(grandparent?.sort === "expr" && isCallOrNew(grandparent.node))) ||
    p?.kind === "template" ||
    (key === "arguments" && p?.kind === "call" && !p.optional && p.args.length === 1 && p.callee.kind === "ident" && p.callee.name === "Boolean");
  const shouldIndentIfInlining = p?.kind === "assign" || parent?.sort === "declarator" || parent?.sort === "member" ||
    (parent?.sort === "prop" && parent.node.kind === "property");
  const left = at(e.left, "left", path).node;
  const samePrecedenceSubExpression = left.kind === "binary" && shouldFlatten(e.op, left.op);
  if (shouldNotIndent || (shouldInline(e) && !samePrecedenceSubExpression) || (!shouldInline(e) && shouldIndentIfInlining)) {
    return group(parts);
  }
  const firstGroup = parts.findIndex((d) => typeof d === "object" && !Array.isArray(d) && d.kind === "group");
  const head = parts.slice(0, firstGroup === -1 ? 1 : firstGroup + 1);
  return group([...head, indent(parts.slice(head.length))]);
}

// The operands and operators of a chain, flattening into the same list a left side Prettier
// prints without parentheses.
function binaryParts(path: At<"expr">, src: string, inParens: boolean): Doc[] {
  const e = path.node;
  if (e.kind !== "binary") return [group(printed(path, src))];
  const left = at(e.left, "left", path);
  // An `in` in a `for` head keeps its parentheses even where its precedence would let it flatten.
  const flatten = left.node.kind === "binary" && shouldFlatten(e.op, left.node.op) && !(left.node.op === "in" && inForInit(left));
  const parts = flatten ? binaryParts(left, src, inParens) : [group(printed(left, src))];
  const isPipe = (e.op as string) === "|>";
  // A pipeline's right side is flattened too, as Prettier does for hack-style pipes.
  const rightDoc = isPipe ? binaryParts(at(e.right, "right", path), src, inParens) : expr(e.right, "right", path, src);
  const right = isPipe ? [line, e.op, " ", rightDoc] : shouldInline(e) ? [e.op, " ", rightDoc] : [e.op, line, rightDoc];
  const p = parentExpr(path);
  const kind = form(e);
  const shouldGroup = !(inParens && kind === "logical") && (p === undefined || form(p) !== kind) && form(e.left) !== kind && form(e.right) !== kind;
  parts.push(isPipe ? "" : " ", shouldGroup ? group(right) : right);
  return parts;
}

// A logical operator whose right side is a non-empty object or array literal keeps it on the line.
function shouldInline(e: Of<"binary">): boolean {
  if (!isLogicalOp(e.op)) return false;
  const r = e.right;
  return (r.kind === "object" && r.props.length > 0) || (r.kind === "array" && r.elements.length > 0);
}

function sequence(e: Of<"sequence">, path: At<"expr">, src: string): Doc {
  const printedExprs = e.exprs.map((x) => expr(x, "expressions", path, src));
  const pk = stmtKind(path.parent);
  if (pk === "expr" || pk === "for") {
    return group([printedExprs[0]!, ...printedExprs.slice(1).map((d) => [",", indent([line, d])])]);
  }
  const joined = join([",", line], printedExprs);
  const ownParens = path.key === "argument" && (pk === "return" || pk === "throw");
  return ownParens ? group(ifBreak([indent([softline, joined]), softline], joined)) : group(joined);
}

// Prettier's default ternary layout: `? then` and `: else` on lines of their own when it
// breaks, with a chain in the alternate kept at one indentation.
function conditional(e: Of<"conditional">, path: At<"expr">, src: string): Doc {
  const p = parentExpr(path);
  const isParentTest = p?.kind === "conditional" && path.key === "test";
  const forceNoIndent = p?.kind === "conditional" && !isParentTest;
  // The first place up the chain that isn't a conditional holding this one outside its test.
  let previous: Path = path;
  let current = path.parent;
  while (current?.sort === "expr" && current.node.kind === "conditional" && previous.key !== "test") {
    previous = current;
    current = current.parent;
  }
  const nested = e.then.kind === "conditional";
  const parts = [
    line, "? ", nested ? ifBreak("", "(") : "", align(2, expr(e.then, "consequent", path, src)), nested ? ifBreak("", ")") : "",
    line, ": ", align(2, expr(e.else, "alternate", path, src)),
  ];
  const extraIndent = shouldExtraIndent(path);
  const test = expr(e.cond, "test", path, src);
  const contents = [
    p?.kind === "conditional" && path.key === "alternate" ? align(2, test) : test,
    forceNoIndent ? parts : indent(parts),
    p?.kind === "member" && !extraIndent ? softline : "",
  ];
  const result = current === path.parent ? group(contents) : contents;
  return isParentTest || extraIndent ? group([indent([softline, result]), softline]) : result;
}

// A conditional heading a member chain that is assigned, returned or awaited is indented once
// more, so the chain doesn't line up with its branches.
function shouldExtraIndent(path: At<"expr">): boolean {
  let chain: Path = path;
  let owner: Path | undefined;
  for (;;) {
    const up: Path | undefined = chain.parent;
    const p = up?.sort === "expr" ? up.node : undefined;
    if (up && ((p?.kind === "nonNull" && chain.key === "expression") || (p?.kind === "call" && chain.key === "callee") || (isMember(p) && chain.key === "object"))) {
      chain = up;
      continue;
    }
    if (up && ((p?.kind === "new" && chain.key === "callee") || (isAsLike(p) && chain.key === "expression"))) {
      chain = up;
      owner = up.parent;
    } else {
      owner = up;
    }
    break;
  }
  if (chain === path || !owner) return false;
  const o = owner.sort === "expr" ? form(owner.node) : owner.sort === "stmt" ? owner.node.kind : owner.sort;
  const valueKey: Record<string, string> = { assign: "right", declarator: "init", return: "argument", throw: "argument", unary: "argument", yield: "argument", await: "argument" };
  return valueKey[o] === chain.key;
}

// `.name`, or `[index]` broken inside the brackets when it doesn't fit.
function lookup(e: Of<"member"> | Of<"index">, path: At<"expr">, src: string): Doc {
  if (e.kind === "member") return [e.optional ? "?." : ".", e.name];
  const optional = e.optional ? "?." : "";
  const index = expr(e.index, "property", path, src);
  if (e.index.kind === "int" || e.index.kind === "float") return [optional, "[", index, "]"];
  return group([optional, "[", indent([softline, index]), softline, "]"]);
}

function member(e: Of<"member"> | Of<"index">, path: At<"expr">, src: string): Doc {
  const object = expr(e.object, "object", path, src);
  let firstOther = path.parent;
  while (firstOther?.sort === "expr" && (isMember(firstOther.node) || firstOther.node.kind === "nonNull")) firstOther = firstOther.parent;
  let firstNotNonNull = path.parent;
  while (firstNotNonNull?.sort === "expr" && firstNotNonNull.node.kind === "nonNull") firstNotNonNull = firstNotNonNull.parent;
  const assigned = (p: Path | undefined) => (p?.sort === "expr" && p.node.kind === "assign") || p?.sort === "declarator";
  const objectLabel = labelOf(object);
  const flat =
    (firstOther?.sort === "expr" && firstOther.node.kind === "assign" && firstOther.node.target.kind !== "ident") ||
    insideNewCallee(path) ||
    e.kind === "index" ||
    (e.object.kind === "ident" && !e.name.startsWith("#") && !(firstNotNonNull?.sort === "expr" && isMember(firstNotNonNull.node))) ||
    (assigned(firstNotNonNull) && (callWithArguments(stripNonNull(e.object)) || objectLabel === "member-chain"));
  const looked = lookup(e, path, src);
  const doc = [object, lineSuffixBoundary, flat ? looked : group(indent([softline, looked]))];
  return objectLabel ? label(objectLabel, doc) : doc;
}

function insideNewCallee(path: At<"expr">): boolean {
  let inner: Path = path;
  for (;;) {
    const up: Path | undefined = inner.parent;
    if (up?.sort !== "expr") return false;
    if ((isMember(up.node) && inner.key === "object") || (up.node.kind === "nonNull" && inner.key === "expression")) {
      inner = up;
      continue;
    }
    return up.node.kind === "new" && inner.key === "callee";
  }
}

const callWithArguments = (e: Expr) => e.kind === "call" && e.args.length > 0;

function stripNonNull(e: Expr): Expr {
  while (e.kind === "nonNull") e = e.expr;
  return e;
}

function labelOf(doc: Doc): string | undefined {
  return typeof doc === "object" && !Array.isArray(doc) && doc.kind === "label" ? doc.label : undefined;
}

// A dotted name such as `require.resolve` or `import.meta.resolve`, when `e` is one.
function dotted(e: Expr): string | undefined {
  if (e.kind === "ident" || e.kind === "meta") return e.name;
  if (e.kind !== "member" || e.optional) return undefined;
  const object = dotted(e.object);
  return object === undefined ? undefined : `${object}.${e.name}`;
}

const moduleCallees = ["require", "require.resolve", "require.resolve.paths", "import.meta.resolve"];

function call(e: Of<"call"> | Of<"new"> | Of<"import">, path: At<"expr">, src: string): Doc {
  const args = e.kind === "import" ? e.args : e.args ?? [];
  const prefix: Doc = e.kind === "import" ? "import" : [e.kind === "new" ? "new " : "", expr(e.callee, "callee", path, src), lineSuffixBoundary];
  const optional = e.kind === "call" && e.optional ? "?." : "";
  const typeArgs: Doc = e.kind !== "import" && e.typeArgs.length > 0 ? [typeArguments(e.typeArgs, path, src), lineSuffixBoundary] : "";
  // `require("x")`, `import("x")`, `require(a, b)`, a lone template literal written over several
  // lines, and the arguments of a test call such as `it("works", () => {})` never break.
  const loneModule =
    args.length === 1 && args[0]!.kind === "string" &&
    (e.kind === "import" || (e.kind === "call" && !e.optional && moduleCallees.includes(dotted(e.callee) ?? "")));
  const requireList = e.kind === "call" && !e.optional && e.callee.kind === "ident" && e.callee.name === "require" && args.length > 1;
  const loneTemplate = args.length === 1 && templateOnItsOwnLine(args[0]!, src);
  const p = parentExpr(path);
  if (loneModule || requireList || loneTemplate || isTestCall(e, p)) {
    return [prefix, optional, typeArgs, "(", join(", ", args.map((a) => expr(a, "arguments", path, src))), ")"];
  }
  if (e.kind === "call" && isMember(e.callee) && !needsParens(at(e.callee, "callee", path))) return memberChain(e, path, src);
  const contents = [prefix, optional, typeArgs, callArguments(e, path, src)];
  return e.kind === "import" || e.callee.kind === "call" ? group(contents) : contents;
}

// A template literal, or tagged template, with a line break in its text and none before it.
function templateOnItsOwnLine(e: Expr, src: string): boolean {
  const t = e.kind === "tagged" ? e.template : e;
  if (t.kind !== "template" || !t.raw.some((q) => q.includes("\n"))) return false;
  let i = e.start;
  while (i > 0 && (src[i - 1] === " " || src[i - 1] === "\t")) i--;
  return src[i - 1] !== "\n";
}

const testCallees = new Set([
  "it", "it.only", "it.skip", "describe", "describe.only", "describe.skip", "test", "test.only", "test.skip", "test.fixme",
  "test.step", "test.describe", "test.describe.only", "test.describe.skip", "test.describe.fixme", "test.describe.parallel",
  "test.describe.parallel.only", "test.describe.serial", "test.describe.serial.only", "skip", "xit", "xdescribe", "xtest",
  "fit", "fdescribe", "ftest",
]);
const isFunction = (e: Expr | undefined) => e?.kind === "function" || e?.kind === "arrow";
const isAngularTestWrapper = (e: Expr | undefined) =>
  e?.kind === "call" && e.callee.kind === "ident" && ["async", "inject", "fakeAsync", "waitForAsync"].includes(e.callee.name);

// Prettier's isTestCall: `it("name", () => {})` and its relatives keep their arguments together.
function isTestCall(e: Expr, parent: Expr | undefined): boolean {
  if (e.kind !== "call" || e.optional) return false;
  const args = e.args;
  if (args.length === 1) {
    if (isAngularTestWrapper(e) && parent !== undefined && isTestCall(parent, undefined)) return isFunction(args[0]);
    if (e.callee.kind === "ident" && ["beforeEach", "beforeAll", "afterEach", "afterAll"].includes(e.callee.name)) return isAngularTestWrapper(args[0]);
    return false;
  }
  if ((args.length !== 2 && args.length !== 3) || !(args[0]!.kind === "template" || args[0]!.kind === "string") || !testCallees.has(dotted(e.callee) ?? "")) return false;
  const third = args[2];
  if (third && third.kind !== "int" && third.kind !== "float") return false;
  const second = args[1]!;
  const callback = args.length === 2
    ? isFunction(second)
    : (second.kind === "function" || (second.kind === "arrow" && Array.isArray(second.body))) && second.params.length <= 1;
  return callback || isAngularTestWrapper(second);
}

// A call whose arguments outnumber its caller's, as in `f(a, b)(c)`, isn't grouped on its own.
function moreArgumentsThanCaller(e: Expr, path: At<"expr">): boolean {
  const p = parentExpr(path);
  return path.key === "callee" && e.kind === "call" && p?.kind === "call" && p.args.length > 0 && e.args.length > p.args.length;
}

// The parenthesized arguments: on one line, one per line, or with a first or last function or
// object hugged, as in `arr.map((x) => { ... })`, whichever Prettier's states choose.
function callArguments(e: Of<"call"> | Of<"new"> | Of<"import">, path: At<"expr">, src: string): Doc {
  const args = e.kind === "import" ? e.args : e.args ?? [];
  if (args.length === 0) return "()";
  if (isReactHookCall(args)) return ["(", expr(args[0]!, "arguments", path, src), ", ", expr(args[1]!, "arguments", path, src), ")"];
  const printedArgs = args.map((a, i) => {
    const doc = expr(a, "arguments", path, src);
    return i === args.length - 1 ? doc : [doc, ",", line];
  });
  const trailing = e.kind === "import" ? "" : ifBreak(",");
  const allBroken = () => group(["(", indent([line, ...printedArgs]), trailing, line, ")"], { shouldBreak: true });
  if (functionArguments(args)) return allBroken();
  const hugged = (i: number, opts: Opts): Doc | undefined => {
    try {
      return printed(at(args[i]!, "arguments", path), src, opts);
    } catch (err) {
      if (err !== bailout) throw err;
      return undefined;
    }
  };
  if (shouldGroupFirst(args)) {
    const rest = printedArgs.slice(1);
    const first = rest.some(willBreak) ? undefined : hugged(0, { expandFirstArg: true });
    if (first === undefined) return allBroken();
    const broken = ["(", group(first, { shouldBreak: true }), ", ", ...rest, ")"];
    return willBreak(first) ? [breakParent, conditionalGroup([broken, allBroken()])] : conditionalGroup([["(", first, ", ", ...rest, ")"], broken, allBroken()]);
  }
  if (shouldGroupLast(args)) {
    const head = printedArgs.slice(0, -1);
    const last = head.some(willBreak) ? undefined : hugged(args.length - 1, { expandLastArg: true });
    if (last === undefined) return allBroken();
    const broken = ["(", ...head, group(last, { shouldBreak: true }), ")"];
    return willBreak(last) ? [breakParent, conditionalGroup([broken, allBroken()])] : conditionalGroup([["(", ...head, last, ")"], broken, allBroken()]);
  }
  const contents = ["(", indent([softline, ...printedArgs]), trailing, softline, ")"];
  return moreArgumentsThanCaller(e, path) ? contents : group(contents, { shouldBreak: printedArgs.some(willBreak) });
}

// `useEffect(() => { ... }, [a, b])`, and `useImperativeHandle(ref, () => { ... }, [a])`.
function isReactHookCall(args: Expr[]): boolean {
  const hook = (i: number) => {
    const f = args[i];
    const deps = args[i + 1];
    return f?.kind === "arrow" && f.params.length === 0 && Array.isArray(f.body) && deps?.kind === "array";
  };
  return args.length === 2 ? hook(0) : args.length === 3 && args[0]!.kind === "ident" && hook(1);
}

// Two function arguments, or a call among the arguments that takes a function, put every argument
// on its own line.
function functionArguments(args: Expr[]): boolean {
  if (args.length <= 1) return false;
  let functions = 0;
  for (const a of args) {
    if (isFunction(a)) {
      if (++functions > 1) return true;
    } else {
      const inner = stripNonNull(a);
      if (inner.kind === "call" && inner.args.some(isFunction)) return true;
    }
  }
  return false;
}

// Whether an argument can be hugged: a non-empty object or array literal, a function, or an
// arrow whose body is a block, a literal of structure, a call or a conditional.
function couldExpandArg(e: Expr, arrowChainRecursion = false): boolean {
  switch (e.kind) {
    case "object":
      return e.props.length > 0;
    case "array":
      return e.elements.length > 0;
    case "as": case "satisfies": case "assertion":
      return couldExpandArg(e.expr);
    case "function":
      return true;
    case "arrow": {
      const body = e.body;
      if (Array.isArray(body)) return true;
      return (body.kind === "object" || body.kind === "array" || (body.kind === "arrow" && couldExpandArg(body, true)) ||
        (!arrowChainRecursion && (body.kind === "conditional" || stripNonNull(body).kind === "call")));
    }
    default:
      return false;
  }
}

function shouldGroupLast(args: Expr[]): boolean {
  const last = args[args.length - 1]!;
  const penultimate = args[args.length - 2];
  return couldExpandArg(last) && (penultimate === undefined || penultimate.kind !== last.kind) &&
    (args.length !== 2 || penultimate?.kind !== "arrow" || last.kind !== "array") &&
    !(args.length > 1 && isConciselyPrintedArray(last));
}

function shouldGroupFirst(args: Expr[]): boolean {
  if (args.length !== 2) return false;
  const [first, second] = args as [Expr, Expr];
  return (first.kind === "function" || (first.kind === "arrow" && Array.isArray(first.body))) &&
    second.kind !== "function" && second.kind !== "arrow" && second.kind !== "conditional" &&
    hopefullyShortArgument(second) && !couldExpandArg(second);
}

// Prettier's isHopefullyShortCallArgument.
function hopefullyShortArgument(e: Expr): boolean {
  if (e.kind === "as" || e.kind === "satisfies") {
    let t = e.type;
    for (let i = 0; i < 2 && t.kind === "array"; i++) t = t.element;
    if (t.kind === "ref" && t.args.length === 1) t = t.args[0]!;
    return isSimpleType(t) && simpleArgument(e.expr, 1);
  }
  if ((e.kind === "call" || e.kind === "new" || e.kind === "import") && (e.args ?? []).length > 1) return false;
  if (e.kind === "binary") return simpleArgument(e.left, 1) && simpleArgument(e.right, 1);
  return e.kind === "regex" || simpleArgument(e);
}

const isSimpleType = (t: TypeNode) => t.kind === "literal" || (t.kind === "ref" && t.args.length === 0);

type Link = { node: Expr; printed: Doc };

// Prettier's member chain: `a.b(c).d(e)` split into groups, each a run of lookups ending in
// calls, printed on one line when it fits and the calls are simple, else a group per line.
function memberChain(e: Of<"call">, path: At<"expr">, src: string): Doc {
  const callLink = (n: Of<"call">, p: At<"expr">): Link => ({ node: n, printed: [n.optional ? "?." : "", typeArguments(n.typeArgs, p, src), callArguments(n, p, src)] });
  const links: Link[] = [callLink(e, path)];
  let link = at(e.callee, "callee", path);
  for (;;) {
    const n = link.node;
    if (n.kind === "call" && (isMember(n.callee) || n.callee.kind === "call") && !needsParens(link)) {
      links.unshift(callLink(n, link));
      link = at(n.callee, "callee", link);
    } else if ((n.kind === "member" || n.kind === "index") && !needsParens(link)) {
      links.unshift({ node: n, printed: lookup(n, link, src) });
      link = at(n.object, "object", link);
    } else if (n.kind === "nonNull" && !needsParens(link)) {
      links.unshift({ node: n, printed: "!" });
      link = at(n.expr, "expression", link);
    } else {
      links.unshift({ node: n, printed: printed(link, src) });
      break;
    }
  }

  const numericIndex = (n: Expr) => n.kind === "index" && (n.index.kind === "int" || n.index.kind === "float");
  // The head: the object with the calls and numeric indexes right on it, or, for a plain name,
  // the lookups before the last, as `a.b` in `a.b.c()`.
  const onHead = (n: Expr) => n.kind === "nonNull" || n.kind === "call" || numericIndex(n);
  let i = 1;
  while (i < links.length && onHead(links[i]!.node)) i++;
  if (links[0]!.node.kind !== "call") {
    while (i + 1 < links.length && isMember(links[i]!.node) && isMember(links[i + 1]!.node)) i++;
  }
  const groups: Link[][] = [links.slice(0, i)];
  let current: Link[] = [];
  let hasSeenCall = false;
  for (; i < links.length; i++) {
    const n = links[i]!.node;
    if (hasSeenCall && isMember(n)) {
      if (numericIndex(n)) {
        current.push(links[i]!);
        continue;
      }
      groups.push(current);
      current = [];
      hasSeenCall = false;
    }
    if (n.kind === "call" || n.kind === "import") hasSeenCall = true;
    current.push(links[i]!);
  }
  if (current.length > 0) groups.push(current);

  // A short or capitalized head, as in `z.object()` or `this.x.y()`, stays on the first line.
  const isFactory = (name: string) => /^[A-Z]|^[$_]+$/.test(name);
  const isStatement = stmtKind(path.parent) === "expr";
  const head = groups[0]!;
  const hasComputed = groups[1]?.[0]?.node.kind === "index";
  const first = head[0]!.node;
  const last = head[head.length - 1]!.node;
  const shouldMerge = groups.length >= 2 && (head.length === 1
    ? first.kind === "this" || (first.kind === "ident" && (isFactory(first.name) || (isStatement && first.name.length <= 2) || hasComputed))
    : last.kind === "member" && !last.name.startsWith("#") && (isFactory(last.name) || hasComputed));

  const printGroup = (g: Link[]): Doc => g.map((l) => l.printed);
  const oneLine = groups.map(printGroup);
  if (groups.length <= (shouldMerge ? 3 : 2)) return moreArgumentsThanCaller(e, path) ? oneLine : group(oneLine);

  const rest = groups.slice(shouldMerge ? 2 : 1);
  const expanded = [printGroup(head), shouldMerge ? printGroup(groups[1]!) : "", indent([hardline, join(hardline, rest.map(printGroup))])];
  const calls = links.map((l) => l.node).filter((n): n is Of<"call"> => n.kind === "call");
  const lastGroup = groups[groups.length - 1]!;
  const lastGroupBreaksAfterFunctions =
    lastGroup[lastGroup.length - 1]!.node.kind === "call" && willBreak(oneLine[oneLine.length - 1]!) &&
    calls.slice(0, -1).some((c) => c.args.some(isFunction));
  const expand =
    (calls.length > 2 && calls.some((c) => c.args.some((a) => !simpleArgument(a)))) ||
    oneLine.slice(0, -1).some(willBreak) ||
    lastGroupBreaksAfterFunctions;
  return label("member-chain", expand ? group(expanded) : [willBreak(oneLine) ? breakParent : "", conditionalGroup([oneLine, expanded])]);
}

// Prettier's isSimpleCallArgument: literals, names, and shallow calls, lookups and literals of
// them, which let a chain of three or more calls stay on one line.
function simpleArgument(e: Expr, depth = 2): boolean {
  if (depth <= 0) return false;
  const simple = (x: Expr) => simpleArgument(x, depth - 1);
  e = stripNonNull(e);
  switch (e.kind) {
    case "regex":
      return [...e.pattern].length <= 5;
    case "int": case "float": case "bigint": case "string": case "bool": case "null":
    case "ident": case "this": case "super": case "privateName":
      return true;
    case "template":
      return e.raw.every((q) => !q.includes("\n")) && e.exprs.every(simple);
    case "object":
      return e.props.every((p) => (p.kind === "property" && typeof p.key === "string" && simple(p.value)) || (p.kind === "shorthand" && p.default === undefined));
    case "array":
      return e.elements.every((x) => x === undefined || simple(x));
    case "import":
      return e.args.length <= depth && e.args.every(simple);
    case "call": case "new":
      return simpleArgument(e.callee, depth) && (e.args ?? []).length <= depth && (e.args ?? []).every(simple);
    case "member":
      return simpleArgument(e.object, depth);
    case "index":
      return simpleArgument(e.object, depth) && simpleArgument(e.index, depth);
    case "unary":
      return ["!", "-", "+", "~"].includes(e.op) && simpleArgument(e.operand, depth);
    case "update":
      return simpleArgument(e.operand, depth);
    default:
      return false;
  }
}

type Layout =
  | "break-after-operator" | "never-break-after-operator" | "fluid" | "break-lhs" | "chain" | "chain-tail" | "chain-tail-arrow-chain"
  | "only-left";

// An assignment, declarator or object property, `left op right`, in the layout Prettier chooses
// for it; the right side learns the layout, which an arrow chain reads.
function assignment(path: At<"expr"> | At<"declarator"> | At<"prop"> | At<"member">, left: Doc, op: Doc, value: Expr | undefined, key: string, src: string): Doc {
  if (!value) return left;
  const layout = assignmentLayout(path, left, value, key, src);
  return layoutDoc(layout, left, op, printed(at(value, key, path), src, { assignmentLayout: layout }));
}

function layoutDoc(layout: Layout, left: Doc, op: Doc, right: Doc): Doc {
  switch (layout) {
    case "break-after-operator":
      return group([group(left), op, group(indent([line, right]))]);
    case "never-break-after-operator":
      return group([group(left), op, " ", right]);
    case "fluid": {
      const id = groupId("assignment");
      return group([group(left), op, group(indent(line), { id }), lineSuffixBoundary, indentIfBreak(right, { groupId: id })]);
    }
    case "break-lhs":
      return group([left, op, " ", group(right)]);
    case "chain":
      return [group(left), op, line, right];
    case "chain-tail":
      return [group(left), op, indent([line, right])];
    case "chain-tail-arrow-chain":
      return [group(left), op, right];
    case "only-left":
      return left;
  }
}

function assignmentLayout(path: At<"expr"> | At<"declarator"> | At<"prop"> | At<"member">, left: Doc, value: Expr, key: string, src: string): Layout {
  const isTail = form(value) !== "assign";
  const up = path.parent;
  const inChain = path.sort === "expr" && up !== undefined && ((up.sort === "expr" && form(up.node) === "assign") || up.sort === "declarator");
  if (inChain && (!isTail || (stmtKind(up.parent) !== "expr" && stmtKind(up.parent) !== "let"))) {
    if (!isTail) return "chain";
    return value.kind === "arrow" && !Array.isArray(value.body) && value.body.kind === "arrow" ? "chain-tail-arrow-chain" : "chain-tail";
  }
  if ((value.kind === "assign" || value.kind === "destructure") && form(value.value) === "assign") return "break-after-operator";
  if (value.kind === "call" && value.callee.kind === "ident" && value.callee.name === "require") return "never-break-after-operator";
  const canBreakLeft = hasLine(left);
  if (complexDestructuring(path) || (path.sort === "declarator" && ((value.kind === "arrow" && canBreakLeft) || complexTypeAnnotation(path.node)))) {
    return "break-lhs";
  }
  // A key printed shorter than the indentation, as in `a: ...`, gains nothing from a break.
  const keyText = path.sort === "prop" ? flatText(left) : undefined;
  const hasShortKey = keyText !== undefined && [...keyText].length < 2 + 3;
  if (shouldBreakAfterOperator(at(value, key, path), src, hasShortKey)) return "break-after-operator";
  const neverBreaks = hasShortKey || ["template", "tagged", "bool", "int", "float", "class"].includes(value.kind);
  return !canBreakLeft && neverBreaks ? "never-break-after-operator" : "fluid";
}

// `const { a, b: c, d = 1 } = x`: more than two properties, one renamed or defaulted.
function complexDestructuring(path: At<"expr"> | At<"declarator"> | At<"prop"> | At<"member">): boolean {
  const target = path.sort === "declarator" ? path.node.target : path.sort === "expr" && path.node.kind === "destructure" ? path.node.pattern : undefined;
  if (target?.kind !== "object" || target.props.length <= 2) return false;
  return target.props.some((p) => p.value.start !== p.start || p.value.kind === "default");
}

// The text of a document made only of strings, as Prettier's cleanDoc leaves it.
function flatText(doc: Doc): string | undefined {
  if (typeof doc === "string") return doc;
  if (!Array.isArray(doc)) return undefined;
  const parts = doc.map(flatText);
  return parts.every((p) => p !== undefined) ? parts.join("") : undefined;
}

// `const x: Map<A<B>, C> = ...`: a declared type with several arguments, one of them generic.
function complexTypeAnnotation(d: Declarator): boolean {
  const t = d.type;
  if (t?.kind !== "ref" || t.args.length < 2) return false;
  return t.args.some((a) => (a.kind === "ref" && a.args.length > 0) || a.kind === "conditional");
}

function shouldBreakAfterOperator(path: At<"expr">, src: string, hasShortKey: boolean): boolean {
  const e = path.node;
  if (e.kind === "binary" && !shouldInline(e)) return true;
  if (e.kind === "sequence") return true;
  if (e.kind === "conditional") return e.cond.kind === "binary" && !shouldInline(e.cond);
  if (e.kind === "class") return e.decorators.length > 0;
  if (hasShortKey) return false;
  let inner = path;
  for (;;) {
    const n = inner.node;
    if (n.kind === "unary") inner = at(n.operand, "argument", inner);
    else if (n.kind === "yield" && n.value) inner = at(n.value, "argument", inner);
    else if (n.kind === "nonNull") inner = at(n.expr, "expression", inner);
    else break;
  }
  return inner.node.kind === "string" || poorlyBreakableChain(inner, src, false);
}

// A short chain such as `this.x.y()` or `a.b(1)`, which reads worse broken than moved after `=`.
function poorlyBreakableChain(path: At<"expr">, src: string, deep: boolean): boolean {
  const e = path.node;
  if (e.kind === "nonNull") return poorlyBreakableChain(at(e.expr, "expression", path), src, true);
  if (e.kind === "call") {
    if (labelOf(printed(path, src)) === "member-chain") return false;
    const short = e.args.length === 0 || (e.args.length === 1 && loneShortArgument(e.args[0]!, src));
    if (!short || complexTypeArguments(e.typeArgs, path, src)) return false;
    return poorlyBreakableChain(at(e.callee, "callee", path), src, true);
  }
  if (e.kind === "member" || e.kind === "index") return poorlyBreakableChain(at(e.object, "object", path), src, true);
  return deep && (e.kind === "ident" || e.kind === "this");
}

function complexTypeArguments(args: TypeNode[], path: At<"expr">, src: string): boolean {
  if (args.length > 1) return true;
  const only = args[0];
  if (only === undefined) return false;
  return only.kind === "union" || only.kind === "intersection" || only.kind === "object" || willBreak(typeArguments(args, path, src));
}

// An argument short enough, a quarter of the line, that a call of it doesn't need to break.
function loneShortArgument(e: Expr, src: string): boolean {
  const limit = 80 * 0.25;
  switch (e.kind) {
    case "this":
      return true;
    case "ident":
      return e.name.length <= limit;
    case "unary":
      return ((e.op === "+" || e.op === "-") && (e.operand.kind === "int" || e.operand.kind === "float")) || loneShortArgument(e.operand, src);
    case "regex":
      return e.pattern.length <= limit;
    case "string":
      return quoted(src.slice(e.start, e.end)).length <= limit;
    case "template":
      return e.exprs.length === 0 && e.raw[0]!.length <= limit && !e.raw[0]!.includes("\n");
    case "call":
      return e.args.length === 0 && e.callee.kind === "ident" && e.callee.name.length <= limit - 2;
    default:
      return ["int", "float", "bigint", "bool", "null"].includes(e.kind);
  }
}

// Prettier's printArrowFunction: a chain `(a) => (b) => ...` prints its signatures together,
// and a body that is a block, a literal of structure or a short form stays on the `=>` line.
function arrow(e: Of<"arrow">, path: At<"expr">, src: string, opts: Opts): Doc {
  const isChain = !opts.expandLastArg && !Array.isArray(e.body) && e.body.kind === "arrow";
  const signatures: Doc[] = [];
  let shouldBreakChain = false;
  let node = e;
  let nodePath = path;
  for (;;) {
    signatures.push(arrowSignature(node, nodePath, src, opts));
    if (isChain) {
      shouldBreakChain ||= (node.returnType !== undefined && node.params.length > 0) || node.typeParams.length > 0 ||
        node.params.some((x) => x.pattern.kind !== "ident" || x.rest || x.default !== undefined || x.modifiers.length > 0);
    }
    const body = node.body;
    if (!isChain || Array.isArray(body) || body.kind !== "arrow") break;
    nodePath = at(body, "body", nodePath);
    node = body;
  }
  const body = node.body;
  const bodyDoc = Array.isArray(body) ? block(body, nodePath, src) : printed(at(body, "body", nodePath), src, opts);
  const sameLine = Array.isArray(body) || body.kind === "sequence" || bodyOnSameLine(body, src) || (!shouldBreakChain && conditionalBody(body));
  const p = parentExpr(path);
  const isCallee = path.key === "callee" && (isCallOrNew(p) || p?.kind === "import");
  const chainId = groupId("arrow-chain");
  const indentSignatures = isChain && (isCallee || opts.assignmentLayout !== undefined);
  const breakSignatures = indentSignatures && (opts.assignmentLayout === "chain-tail-arrow-chain" || (isCallee && !sameLine));
  const signatureDoc = chainSignatures(signatures, path, opts, shouldBreakChain);
  const bodyOut = arrowBody(bodyDoc, body, sameLine, opts);
  return group([
    group(indentSignatures ? indent([softline, signatureDoc]) : signatureDoc, { shouldBreak: breakSignatures, id: chainId }),
    " =>",
    isChain ? indentIfBreak(bodyOut, { groupId: chainId }) : group(bodyOut),
    isChain && isCallee ? ifBreak(softline, "", { groupId: chainId }) : "",
  ]);
}

function arrowSignature(e: Of<"arrow">, path: At<"expr">, src: string, opts: Opts): Doc {
  const expand = opts.expandLastArg === true || opts.expandFirstArg === true;
  let returned = returnType(e, path, src);
  if (expand) {
    if (willBreak(returned)) throw bailout;
    returned = group(removeLines(returned));
  }
  return [e.move ? "move " : "", e.async ? "async " : "", group([parameters(e, path, src, expand, typeParameters(e.typeParams, path, src)), returned])];
}

function chainSignatures(signatures: Doc[], path: At<"expr">, opts: Opts, shouldBreak: boolean): Doc {
  if (signatures.length === 1) return signatures[0]!;
  const p = parentExpr(path);
  if ((path.key !== "callee" && (isCallOrNew(p) || p?.kind === "import")) || p?.kind === "binary") {
    return group([signatures[0]!, " =>", indent([line, join([" =>", line], signatures.slice(1))])], { shouldBreak });
  }
  if ((path.key === "callee" && isCallOrNew(p)) || opts.assignmentLayout !== undefined) return group(join([" =>", line], signatures), { shouldBreak });
  return group(indent(join([" =>", line], signatures)), { shouldBreak });
}

// A body that is an array, object, arrow, block or a template literal written over several
// lines stays on the `=>` line.
function bodyOnSameLine(body: Expr, src: string): boolean {
  return body.kind === "array" || body.kind === "object" || body.kind === "arrow" || templateOnItsOwnLine(body, src);
}

const conditionalBody = (body: Expr | Stmt[]) => !Array.isArray(body) && body.kind === "conditional" && leftmost(body)?.kind !== "object";

function arrowBody(bodyDoc: Doc, body: Expr | Stmt[], sameLine: boolean, opts: Opts): Doc {
  const trailing = opts.expandLastArg ? ifBreak(",") : "";
  const closing = opts.expandLastArg ? softline : "";
  if (sameLine && conditionalBody(body)) {
    return [" ", group([ifBreak("", "("), indent([softline, bodyDoc]), ifBreak("", ")"), trailing, closing])];
  }
  if (sameLine) return [" ", bodyDoc];
  return [indent([line, bodyDoc]), trailing, closing];
}

// An object literal: on one line when it fits, unless it was written with a line break after
// its `{`, which keeps it expanded.
function object(e: Of<"object">, path: At<"expr">, src: string): Doc {
  if (e.props.length === 0) return "{}";
  const props = e.props.map((prop) => objectProp({ sort: "prop", node: prop, key: "properties", parent: path }, src));
  const expanded = src.slice(e.start, e.props[0]!.start).includes("\n");
  return group(["{", indent([line, join([",", line], props)]), ifBreak(","), line, "}"], { shouldBreak: expanded });
}

function objectProp(path: At<"prop">, src: string): Doc {
  const p = path.node;
  switch (p.kind) {
    case "property":
      return assignment(path, propertyKey(p.key, p.start, 0, path, src), ":", p.value, "value", src);
    case "shorthand":
      return p.default ? [p.name, " = ", expr(p.default, "right", path, src)] : p.name;
    case "spread":
      return ["...", expr(p.value, "argument", path, src)];
    case "method":
      return [p.async ? "async " : "", p.generator ? "*" : "", propertyKey(p.key, p.start, (p.async ? 1 : 0) + (p.generator ? 1 : 0), path, src), methodRest(p, path, src)];
    case "get":
    case "set":
      return [p.kind, " ", propertyKey(p.key, p.start, 1, path, src), methodRest({ ...p, typeParams: [] }, path, src)];
  }
}

// A property name as written, with quotes dropped where they aren't needed (Prettier's
// `quoteProps: "as-needed"`): a quoted identifier loses them; a quoted number keeps them.
// A class field's quoted name keeps its quotes, as Prettier's typescript printer leaves them.
function propertyKey(key: PropertyName, start: number, skip: number, parent: Path, src: string, unquote = true): Doc {
  if (typeof key !== "string") return ["[", expr(key, "key", parent, src), "]"];
  // The tree keeps a string key's value, not how it was written, so it is read again from the
  // source, after `skip` tokens such as `async`, `*`, `get` or `set`.
  const tokens = lexer(src.slice(start));
  let t = tokens.next();
  for (let i = 0; i < skip; i++) t = tokens.next();
  const raw = src.slice(start + t.start, start + t.end);
  switch (t.kind) {
    case "string": {
      const printedKey = quoted(raw);
      return unquote && printedKey.slice(1, -1) === key && identifierName.test(key) ? key : printedKey;
    }
    case "int":
    case "float":
      return number(raw);
    case "bigint":
      return raw.toLowerCase();
    default:
      return key;
  }
}

// ponytail: any Unicode identifier loses its quotes; Prettier unquotes only ES5 ones, so a key of newer letters differs.
const identifierName = /^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u;

// An array literal; numbers fill each line, and arrays of several non-trivial arrays or objects
// put each on its own line.
function array(e: Of<"array">, path: At<"expr">, src: string): Doc {
  const elements = e.elements;
  if (elements.length === 0) return "[]";
  const last = elements[elements.length - 1];
  const shouldBreak = elements.length > 1 && elements.every((x, i) => {
    if (x?.kind !== "array" && x?.kind !== "object") return false;
    const next = elements[i + 1];
    if (next && next.kind !== x.kind) return false;
    return (x.kind === "array" ? x.elements.length : x.props.length) > 1;
  });
  const concise = isConciselyPrintedArray(e);
  const id = groupId("array");
  const trailing = last === undefined ? "," : concise ? ifBreak(",", "", { groupId: id }) : ifBreak(",");
  const printedElement = (x: Expr | undefined) => (x ? expr(x, "elements", path, src) : "");
  let items: Doc;
  if (concise) {
    const parts: Doc[] = [];
    elements.forEach((x, i) => {
      const isLast = i === elements.length - 1;
      parts.push([printedElement(x), isLast ? trailing : ","]);
      if (!isLast) parts.push(line);
    });
    items = fill(parts);
  } else {
    items = [elements.map((x, i) => [x ? group(printedElement(x)) : "", i < elements.length - 1 ? [",", line] : ""]), trailing];
  }
  return group(["[", indent([softline, items]), softline, "]"], { shouldBreak, id });
}

// An array of numbers, possibly signed, which prints filling each line.
function isConciselyPrintedArray(e: Expr): boolean {
  return e.kind === "array" && e.elements.length > 0 && e.elements.every((x) =>
    x !== undefined && (x.kind === "int" || x.kind === "float" ||
      (x.kind === "unary" && (x.op === "+" || x.op === "-") && (x.operand.kind === "int" || x.operand.kind === "float"))));
}

// A template literal printed as written, its substitutions printed on one line unless they were
// written over several.
function template(e: Of<"template">, path: At<"expr">, src: string): Doc {
  const parts: Doc[] = [lineSuffixBoundary, "`"];
  let indentSize = 0;
  e.raw.forEach((quasi, i) => {
    parts.push(join(literalline, quasi.split("\n")));
    const x = e.exprs[i];
    if (!x) return;
    if (quasi.includes("\n")) indentSize = columns(quasi.slice(quasi.lastIndexOf("\n") + 1).match(/^[\t ]*/)![0]);
    parts.push(substitution(x, path, src, indentSize, quasi));
  });
  parts.push("`");
  return parts;
}

// The width of leading whitespace, a tab reaching the next stop of two.
function columns(whitespace: string): number {
  let size = 0;
  for (const ch of whitespace) size = ch === "\t" ? size + 2 - (size % 2) : size + 1;
  return size;
}

function substitution(x: Expr, path: At<"expr">, src: string, indentSize: number, previous: string): Doc {
  let doc = expr(x, "expressions", path, src);
  const open = src.lastIndexOf("${", x.start);
  const close = src.indexOf("}", x.end);
  let multiline = src.slice(open, close).includes("\n");
  if (!multiline) {
    const flat = print(doc, Infinity);
    if (flat.includes("\n")) multiline = true;
    else doc = flat;
  }
  const simple = x.kind === "ident" || isMember(stripNonNull(x)) || x.kind === "conditional" || x.kind === "sequence" || isAsLike(x) || x.kind === "binary";
  if (multiline && simple) doc = [indent([softline, doc]), softline];
  if (indentSize === 0 && previous.endsWith("\n")) doc = align(-Infinity, doc);
  else if (indentSize > 0) {
    for (let i = 0; i < Math.floor(indentSize / 2); i++) doc = indent(doc);
    doc = align(-Infinity, align(indentSize % 2, doc));
  }
  return group(["${", doc, lineSuffixBoundary, "}"]);
}

// Prettier's removeLines: a document laid out flat whatever happens, keeping hard breaks.
function removeLines(doc: Doc): Doc {
  if (typeof doc === "string") return doc;
  if (Array.isArray(doc)) return doc.map(removeLines);
  switch (doc.kind) {
    case "line":
      return doc.hard ? doc : doc.soft ? "" : " ";
    case "ifBreak":
      return removeLines(doc.flatContents);
    case "group": {
      const states = doc.expandedStates?.map(removeLines);
      return { ...doc, contents: states ? states[0]! : removeLines(doc.contents), expandedStates: states };
    }
    case "indent": case "align": case "indentIfBreak": case "lineSuffix": case "label":
      return { ...doc, contents: removeLines(doc.contents) };
    case "fill":
      return { ...doc, parts: doc.parts.map(removeLines) };
    default:
      return doc;
  }
}

// A class, as a declaration or an expression. Its decorators go on their own lines, unless they
// were written before an `export` that prints them.
function classDoc(c: ClassNode, path: Path, src: string, decoratorsPrinted: boolean): Doc {
  const head: Doc[] = [c.abstract ? "abstract " : "", "class"];
  const named: Doc[] = c.name !== undefined ? [" ", c.name, typeParameters(c.typeParams, path, src)] : [typeParameters(c.typeParams, path, src)];
  const p = parentExpr(path);
  const inAssignment = p?.kind === "assign";
  const breakHeritage = c.implements.length + (c.extends ? 1 : 0) > 1 ||
    (c.extends ? !inAssignment && c.extends.kind !== "instantiation" && isMember(stripNonNull(c.extends))
      : c.implements[0] !== undefined && dottedType(c.implements[0]));
  const heritage: Doc[] = [];
  if (c.extends) {
    const base = expr(c.extends, "superClass", path, src);
    const extended = ["extends ", inAssignment ? group(ifBreak(["(", indent([softline, base]), softline, ")"], base)) : base];
    heritage.push(breakHeritage ? [line, group(extended)] : [" ", extended]);
  }
  heritage.push(heritageList("implements", c.implements, c.implements.length + (c.extends ? 1 : 0) > 1, breakHeritage, path, src));
  const id = groupId("heritageGroup");
  const header = breakHeritage ? [group([...named, indent(heritage)], { id })] : [...named, ...heritage];
  const members = c.members.map((m) => classMember({ sort: "member", node: m, key: "body", parent: path }, src));
  const classBody = members.length > 0 ? ["{", indent([hardline, join(hardline, members)]), hardline, "}"] : "{}";
  const doc = [head, header, breakHeritage && members.length > 0 ? ifBreak(hardline, " ", { groupId: id }) : " ", classBody];
  if (c.decorators.length === 0 || decoratorsPrinted) return doc;
  const exported = path.sort === "stmt" && path.parent?.sort === "stmt" && (path.parent.node.kind === "export" || path.parent.node.kind === "exportDefault");
  const decorators = [exported ? hardline : breakParent, join(line, c.decorators.map((d) => decorator(d, path, src))), line];
  if (path.sort === "expr") return needsParens(path) ? [indent([softline, decorators, doc]), softline] : [decorators, doc];
  return group([decorators, doc]);
}

// `A.B` with no type arguments, which makes Prettier set a class's heritage apart.
const dottedType = (t: TypeNode) => t.kind === "ref" && t.name.includes(".") && t.args.length === 0;

// `implements A, B` or an interface's `extends A, B`; with more than one heritage clause the
// list breaks indented under its keyword.
function heritageList(keyword: string, list: TypeNode[], several: boolean, breakHeritage: boolean, path: Path, src: string): Doc {
  if (list.length === 0) return "";
  const printedList = join([",", line], list.map((t) => type(t, keyword, path, src)));
  if (!several) return breakHeritage ? [line, group([`${keyword} `, printedList])] : [" ", `${keyword} `, printedList];
  return [line, keyword, group(indent([line, printedList]))];
}

// `@name`, `@a.b(args)`, or anything else in parentheses.
function decorator(e: Expr, parent: Path, src: string): Doc {
  const simpleName = (x: Expr): boolean => x.kind === "ident" || (x.kind === "member" && !x.optional && simpleName(x.object));
  const simple = simpleName(e) || (e.kind === "call" && !e.optional && simpleName(e.callee));
  const doc = expr(e, "expression", parent, src);
  return simple ? ["@", doc] : ["@(", doc, ")"];
}

// A member's decorators stay on its line unless one was written with a line break after it.
function memberDecorators(decorators: Expr[], parent: Path, src: string): Doc {
  if (decorators.length === 0) return "";
  const brokenAfter = decorators.some((d) => /^\)*[ \t]*\r?\n/.test(src.slice(d.end)));
  return group([join(line, decorators.map((d) => decorator(d, parent, src))), brokenAfter ? hardline : line]);
}

// Prettier's modifier order for each kind of member.
const fieldOrder = ["declare", "public", "private", "protected", "static", "abstract", "override", "readonly", "accessor"];
const methodOrder = ["public", "private", "protected", "static", "abstract", "override", "async"];
const ordered = (modifiers: string[], order: string[]) => order.filter((m) => modifiers.includes(m)).map((m) => `${m} `);

function classMember(path: At<"member">, src: string): Doc {
  const m = path.node;
  const decorators = memberDecorators(m.decorators, path, src);
  // Where the member's name begins: after its decorators, then its modifiers and keywords.
  const last = m.decorators[m.decorators.length - 1];
  const from = last ? last.end + /^[\s)]*/.exec(src.slice(last.end))![0].length : m.start;
  switch (m.kind) {
    case "field": {
      const left = [
        decorators, ordered(m.modifiers, fieldOrder), propertyKey(m.name, from, m.modifiers.length, path, src, false),
        m.optional ? "?" : "", m.definite ? "!" : "", m.type ? [": ", type(m.type, "typeAnnotation", path, src)] : "",
      ];
      return [assignment(path, left, " =", m.init, "value", src), ";"];
    }
    case "method":
    case "get":
    case "set":
    case "constructor": {
      const keywords = m.kind === "get" || m.kind === "set" ? 1 : m.kind === "method" && m.generator ? 1 : 0;
      // A method written `"constructor"()` isn't the constructor to Fish, so it keeps its quotes.
      const name = m.kind === "constructor" ? "constructor" : propertyKey(m.name, from, m.modifiers.length + keywords, path, src, m.name !== "constructor");
      const f: Fn = {
        params: m.params, typeParams: m.kind === "method" ? m.typeParams : [], returnType: m.kind === "constructor" ? undefined : m.returnType,
        throws: m.kind === "method" ? m.throws : undefined,
      };
      const params = parameters(f, path, src, false, "");
      const returned = returnType(f, path, src);
      const properties = f.params.length > 1 && f.params.some((x) => x.modifiers.length > 0);
      const grouped = properties ? group(params, { shouldBreak: true }) : shouldGroupParameters(f, returned) ? group(params) : params;
      return [
        decorators, ordered(m.modifiers, methodOrder), m.kind === "get" || m.kind === "set" ? `${m.kind} ` : "",
        m.kind === "method" && m.generator ? "*" : "", name, m.kind === "method" && m.optional ? "?" : "",
        typeParameters(f.typeParams, path, src), group([grouped, returned]), m.body ? [" ", block(m.body, path, src)] : ";",
      ];
    }
    case "index": {
      const params = m.params.map((x) => param(x, path, src));
      return [
        decorators, m.modifiers.includes("static") ? "static " : "", m.modifiers.includes("readonly") ? "readonly " : "", "[",
        group([indent([softline, join([", ", softline], params)]), m.params.length > 1 ? ifBreak(",") : "", softline]), "]: ",
        type(m.type, "typeAnnotation", path, src), ";",
      ];
    }
    case "staticBlock":
      return ["static ", block(m.body, path, src)];
  }
}

function interfaceDoc(s: Interface, path: At<"stmt">, src: string): Doc {
  const breakHeritage = s.extends.length > 1 || (s.extends[0] !== undefined && dottedType(s.extends[0]));
  const named = [" ", s.name, typeParameters(s.typeParams, path, src)];
  const heritage = heritageList("extends", s.extends, s.extends.length > 1, breakHeritage, path, src);
  const header = breakHeritage ? group([...named, indent(heritage)]) : [...named, heritage];
  // Members print as an object type's do, so they hang off an object type standing for the body.
  const owner: At<"type"> = { sort: "type", node: { kind: "object", members: s.members, start: s.start, end: s.end }, key: "body", parent: path };
  const members = s.members.map((m) => [typeMember(m, owner, src), ";"]);
  return ["interface", header, " ", members.length > 0 ? ["{", indent([hardline, join(hardline, members)]), hardline, "}"] : "{}"];
}

function enumDoc(s: Extract<Stmt, { kind: "enum" }>, path: At<"stmt">, src: string): Doc {
  const members = s.members.map((m) => [
    propertyKey(m.name, m.start, 0, path, src), m.payload ? typeList(m.payload, path, src) : "", m.init ? [" = ", expr(m.init, "initializer", path, src)] : "",
  ]);
  const body = members.length > 0 ? group(["{", indent([line, join([",", line], members)]), ifBreak(","), line, "}"], { shouldBreak: true }) : "{}";
  return [s.const ? "const " : "", "enum ", s.name, typeParameters(s.typeParams, path, src), " ", body];
}

function namespaceDoc(s: Extract<Stmt, { kind: "namespace" }>, path: At<"stmt">, src: string): Doc {
  const head = s.global ? "global" : [src.startsWith("module", s.start) ? "module " : "namespace ", s.quoted ? stringAfter(s.start, src) : s.name];
  return [head, s.body ? [" ", block(s.body, path, src, true, false)] : ";"];
}

// The first string literal from `from` on, printed with Prettier's quotes; the tree keeps only
// a module name's value.
function stringAfter(from: number, src: string): string {
  const tokens = lexer(src.slice(from));
  for (let t = tokens.next(); t.kind !== "eof"; t = tokens.next()) {
    if (t.kind === "string") return quoted(src.slice(from + t.start, from + t.end));
  }
  return '""';
}

// The module of an import or export: the string after `from`, or the only one in `import "m"`.
function moduleName(s: Stmt, src: string): string {
  const tokens = lexer(src.slice(s.start, s.end));
  let previous = tokens.next();
  for (let t = tokens.next(); t.kind !== "eof"; previous = t, t = tokens.next()) {
    if (t.kind === "string" && previous.kind === "ident" && (previous.text === "from" || previous.text === "import")) {
      return quoted(src.slice(s.start + t.start, s.start + t.end));
    }
  }
  return '""';
}

// `{ a, b as c }`: one specifier alone stays inline, several break together.
function specifierList(list: Specifier[], src: string, alone: boolean): Doc {
  if (list.length === 0) return "{}";
  const printedList = list.map((sp) => specifier(sp, src));
  if (list.length === 1 && alone) return ["{ ", printedList[0]!, " }"];
  return group(["{", indent([line, join([",", line], printedList)]), ifBreak(","), line, "}"]);
}

function specifier(sp: Specifier, src: string): Doc {
  // A name may be a string, as in `{ "a-b" as ab }`, whose quotes the tree doesn't keep.
  const tokens = lexer(src.slice(sp.start, sp.end));
  let t = tokens.next();
  if (sp.typeOnly) t = tokens.next();
  const raw = (x: Token, value: string) => (x.kind === "string" ? quoted(src.slice(sp.start + x.start, sp.start + x.end)) : value);
  const name = raw(t, sp.name);
  if (sp.alias === undefined || sp.alias === sp.name) return [sp.typeOnly ? "type " : "", name];
  tokens.next();
  return [sp.typeOnly ? "type " : "", name, " as ", raw(tokens.next(), sp.alias)];
}

// The name after `export * as`, which may be a string such as `"a-b"`.
function exportAllAlias(s: Extract<Stmt, { kind: "exportAll" }>, src: string): string {
  const tokens = lexer(src.slice(s.start, s.end));
  for (let t = tokens.next(); t.kind !== "eof"; t = tokens.next()) {
    if (t.kind === "ident" && t.text === "as") {
      const alias = tokens.next();
      return alias.kind === "string" ? quoted(src.slice(s.start + alias.start, s.start + alias.end)) : alias.text;
    }
  }
  return s.alias!;
}

function importDoc(s: Extract<Stmt, { kind: "import" }>, path: At<"stmt">, src: string): Doc {
  const leading = [s.default, s.namespace !== undefined ? `* as ${s.namespace}` : undefined].filter((x): x is string => x !== undefined);
  const sideEffect = leading.length === 0 && s.named === undefined;
  const parts: Doc[] = ["import", s.defer ? " defer" : "", s.typeOnly ? " type" : ""];
  if (!sideEffect) {
    parts.push(" ", join(", ", leading));
    if (s.named !== undefined && (s.named.length > 0 || leading.length === 0)) {
      parts.push(leading.length > 0 ? ", " : "", specifierList(s.named, src, leading.length === 0));
    }
    parts.push(" from");
  }
  parts.push(" ", moduleName(s, src));
  if (s.attributes && s.attributes.kind === "object") {
    const attributes = expr(s.attributes, "attributes", path, src);
    const onlyType = s.attributes.props.length === 1 && s.attributes.props[0]!.kind === "property" && s.attributes.props[0]!.key === "type";
    parts.push(" with ", onlyType ? removeLines(attributes) : attributes);
  }
  return [parts, ";"];
}

// `export default` before an expression that starts with a function or class, as in
// `(class {}).name`, wraps the whole expression in parentheses.
function exportDefaultNeedsParens(e: Expr, parent: At<"stmt">): boolean {
  let path = at(e, "declaration", parent);
  for (let top = true; ; top = false) {
    const n = path.node;
    if (n.kind === "function" || n.kind === "class") return top || !needsParens(path);
    if (!top && needsParens(path)) return false;
    const left = leftSide(n);
    if (!left) return false;
    path = at(left[0], left[1], path);
  }
}

function leftSide(e: Expr): [Expr, string] | undefined {
  switch (e.kind) {
    case "binary":
      return [e.left, "left"];
    case "assign":
      return [e.target, "left"];
    case "member": case "index":
      return [e.object, "object"];
    case "call":
      return [e.callee, "callee"];
    case "tagged":
      return [e.tag, "tag"];
    case "conditional":
      return [e.cond, "test"];
    case "update":
      return e.prefix ? undefined : [e.operand, "argument"];
    case "sequence":
      return [e.exprs[0]!, "expressions"];
    case "nonNull": case "as": case "satisfies":
      return [e.expr, "expression"];
    default:
      return undefined;
  }
}

function exportDoc(s: Stmt, path: At<"stmt">, src: string): Doc {
  switch (s.kind) {
    case "export": {
      const declaration = { sort: "stmt" as const, node: s.body, key: "declaration", parent: path };
      // Decorators written before `export` print before it, one per line.
      const body = s.body;
      if (src[s.start] === "@" && body.kind === "class") {
        return [join(hardline, body.decorators.map((d) => decorator(d, path, src))), hardline, "export ", classDoc(body, declaration, src, true)];
      }
      return ["export ", statement(declaration, src)];
    }
    case "exportDefault": {
      if (s.declaration) return ["export default ", statement({ sort: "stmt", node: s.declaration, key: "declaration", parent: path }, src)];
      const value = s.value!;
      const printedValue = expr(value, "declaration", path, src);
      return ["export default ", exportDefaultNeedsParens(value, path) ? ["(", printedValue, ")"] : printedValue, ";"];
    }
    case "exportNamed":
      return ["export", s.typeOnly ? " type" : "", " ", specifierList(s.specifiers, src, true), s.module !== undefined ? [" from ", moduleName(s, src)] : "", ";"];
    case "exportAll":
      return ["export", s.typeOnly ? " type" : "", " *", s.alias !== undefined ? [" as ", exportAllAlias(s, src)] : "", " from ", moduleName(s, src), ";"];
    case "exportAssign":
      return ["export = ", expr(s.value, "expression", path, src), ";"];
    case "exportAsNamespace":
      return ["export as namespace ", s.name, ";"];
    default:
      throw new Error(`no export layout for '${s.kind}'`);
  }
}

// `match (subject) { case P => body, ... }`, laid out as a `switch`: always expanded, one arm a
// line, each ending in `,`.
function matchDoc(e: Of<"match">, path: At<"expr">, src: string): Doc {
  const arms = e.arms.map((arm) => matchArm({ sort: "arm", node: arm, key: "arms", parent: path }, src));
  return [
    group(["match (", indent([softline, expr(e.subject, "subject", path, src)]), softline, ")"]), " {",
    arms.length > 0 ? indent([hardline, join(hardline, arms)]) : "", hardline, "}",
  ];
}

// `case P if guard => body,`, the body laid out as an arrow function's.
function matchArm(path: At<"arm">, src: string): Doc {
  const arm = path.node;
  const head = ["case ", pattern(arm.pattern, "pattern", path, src), arm.guard ? [" if ", expr(arm.guard, "guard", path, src)] : ""];
  const body = arm.body;
  if (body.kind === "block") return [head, " => ", block(body.body, path, src), ","];
  const bodyDoc = printed(at(body, "body", path), src);
  const sameLine = body.kind === "sequence" || bodyOnSameLine(body, src) || conditionalBody(body);
  return [head, group([" =>", group(arrowBody(bodyDoc, body, sameLine, {}))]), ","];
}

// `P | Q` in a `match`: on one line, or each alternative after the first on its own line with a
// leading `|`, indented. A union type would also lead the first with `|`, which a pattern can't.
function orPattern(p: Extract<Pattern, { kind: "or" }>, path: At<"pattern">, src: string): Doc {
  const [first, ...rest] = p.patterns.map((x) => pattern(x, "patterns", path, src));
  return group([first!, indent(rest.map((x) => [line, "| ", x]))]);
}

// `Some(v)` or `A.B(x, y)`: the arguments laid out as a call's.
function variantPattern(p: Extract<Pattern, { kind: "variant" }>, path: At<"pattern">, src: string): Doc {
  if (p.args === undefined) return p.name;
  if (p.args.length === 0) return [p.name, "()"];
  const args = p.args.map((x) => pattern(x, "arguments", path, src));
  return [p.name, group(["(", indent([softline, join([",", line], args)]), ifBreak(","), softline, ")"])];
}

// Types laid out as call arguments, for an enum member's payload.
function typeList(types: TypeNode[], parent: Path, src: string): Doc {
  if (types.length === 0) return "()";
  return group(["(", indent([softline, join([",", line], types.map((t) => type(t, "params", parent, src)))]), ifBreak(","), softline, ")"]);
}

// Decorators on a function, type alias or interface, where Fish applies them as macros: on
// their own lines when one was written with a line break after it, else inline.
function macroDecorators(decorators: Expr[] | undefined, doc: Doc, path: Path, src: string): Doc {
  if (!decorators?.length) return doc;
  const brokenAfter = decorators.some((d) => /^\)*[ \t]*\r?\n/.test(src.slice(d.end)));
  return group([brokenAfter ? breakParent : "", join(line, decorators.map((d) => decorator(d, path, src))), line, doc]);
}

// A pipeline as Prettier's babel parser gives it: a binary `|>` whose chain breaks before each
// `|>`. The tree's `pipe` node is read through this view.
function pipeAsBinary(e: Of<"pipe">): Of<"binary"> {
  // `|>` isn't one of TypeScript's operators, so the view stretches BinaryOp to hold it.
  return { kind: "binary", op: "|>" as BinaryOp, left: e.value, right: e.body, start: e.start, end: e.end };
}

// Whether laying `doc` out must break a line: a hard line or a group already broken.
function willBreak(doc: Doc): boolean {
  return someDoc(doc, (d) => (d.kind === "group" && d.break) || (d.kind === "line" && d.hard) || d.kind === "breakParent");
}

const hasLine = (doc: Doc) => someDoc(doc, (d) => d.kind === "line");

// Prettier's traversal for these checks: a conditional group's other states aren't visited.
function someDoc(doc: Doc, test: (d: Exclude<Doc, string | Doc[]>) => boolean): boolean {
  if (typeof doc === "string") return false;
  if (Array.isArray(doc)) return doc.some((d) => someDoc(d, test));
  if (test(doc)) return true;
  switch (doc.kind) {
    case "group": case "indent": case "align": case "indentIfBreak": case "lineSuffix": case "label":
      return someDoc(doc.contents, test);
    case "fill":
      return doc.parts.some((d) => someDoc(d, test));
    case "ifBreak":
      return someDoc(doc.breakContents, test) || someDoc(doc.flatContents, test);
    default:
      return false;
  }
}

// A number as Prettier prints it: lower case, no `+` or leading zeros in the exponent, no
// trailing zeros or dot in the fraction, and a digit before a leading dot.
function number(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^([+-]?[\d.]+e)(?:\+|(-))?0*(\d)/, "$1$2$3")
    .replace(/^([+-]?[\d.]+)e[+-]?0+$/, "$1")
    .replace(/^([+-])?\./, "$10.")
    .replace(/(\.\d+?)0+(?=e|$)/, "$1")
    .replace(/\.(?=e|$)/, "");
}

// A string literal in double quotes unless its text holds more double quotes than single. Already
// in that quote it stays exactly as written; moved to it, only the quotes' escapes change.
function quoted(literal: string): string {
  const raw = literal.slice(1, -1);
  const quote = (raw.match(/"/g) ?? []).length > (raw.match(/'/g) ?? []).length ? "'" : '"';
  if (literal[0] === quote) return literal;
  const other = quote === '"' ? "'" : '"';
  const body = raw.replace(/\\(.)|(["'])/gs, (match, escaped: string | undefined, bare: string | undefined) => {
    if (escaped === other) return escaped;
    if (bare === quote) return "\\" + bare;
    return bare ?? match;
  });
  return quote + body + quote;
}
