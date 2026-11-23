// Generated from the parser's AST types by `fishc run scripts/unquotegen.fsh`; a test fails when it is stale.
// A value a macro made while compiling, of an `Ast` type, as the syntax tree it stands for: each
// record a node of its kind, its fields read by name, an absent part `undefined`, and a node made
// from one given a fresh id once its parts have theirs.
import type { Value } from "./comptime.fsh";
import { nextId, type Ids } from "./ids.fsh";
import type { TypeNode, Expr, Stmt, TupleElement, PropertyName, TypeMember, ObjectProp, Modifier, ClassNode, ClassMember, Param, Pattern, MatchArm, PatternProp, Specifier, EnumMember, SwitchCase, Declarator, TypeParam, TypeAlias, Interface, JsName, Func, BinaryOp, UnaryOp, AssignOp } from "./parser.fsh";

/** @throws {Error} */
function field(v: Ref<Value>, name: string): Value {
  if (v !== null && typeof v === "object" && v.kind === "member") return field(v.value, name);
  if (v !== null && typeof v === "object" && v.kind === "record") {
    const x = v.fields.get(name);
    return x === undefined ? undefined : x;
  }
  throw new Error(`internal error: an Ast value without a '${name}'`);
}

/** @throws {Error} */
function kindOf(v: Ref<Value>): string {
  const k = field(v, "kind");
  return text(k);
}

function absent(v: Ref<Value>): boolean {
  if (v !== null && typeof v === "object" && v.kind === "member") return absent(v.value);
  return v === null || v === undefined;
}

function isText(v: Ref<Value>): boolean {
  if (v !== null && typeof v === "object" && v.kind === "member") return isText(v.value);
  return typeof v === "string";
}

function isItems(v: Ref<Value>): boolean {
  if (v !== null && typeof v === "object" && v.kind === "member") return isItems(v.value);
  return v !== null && typeof v === "object" && v.kind === "array";
}

/** @throws {Error} */
function text(v: Ref<Value>): string {
  if (v !== null && typeof v === "object" && v.kind === "member") return text(v.value);
  if (typeof v === "string") return v;
  throw new Error("internal error: an Ast value that isn't text where text belongs");
}

/** @throws {Error} */
function flag(v: Ref<Value>): boolean {
  if (v !== null && typeof v === "object" && v.kind === "member") return flag(v.value);
  if (typeof v === "boolean") return v;
  throw new Error("internal error: an Ast value that isn't a boolean where one belongs");
}

/** @throws {Error} */
function count(v: Ref<Value>): usize {
  if (v !== null && typeof v === "object" && v.kind === "member") return count(v.value);
  if (typeof v === "bigint") return Number(v.toString())! as usize;
  throw new Error("internal error: an Ast value that isn't an integer where an offset belongs");
}

/** @throws {Error} */
function float(v: Ref<Value>): f64 {
  if (v !== null && typeof v === "object" && v.kind === "member") return float(v.value);
  if (typeof v === "number") return v;
  throw new Error("internal error: an Ast value that isn't a float where one belongs");
}

/** @throws {Error} */
function big(v: Ref<Value>): bigint {
  if (v !== null && typeof v === "object" && v.kind === "member") return big(v.value);
  if (typeof v === "bigint") return v;
  throw new Error("internal error: an Ast value that isn't an integer where one belongs");
}

/** @throws {Error} */
function itemsOf(v: Ref<Value>): Value[] {
  if (v !== null && typeof v === "object" && v.kind === "member") return itemsOf(v.value);
  if (v !== null && typeof v === "object" && v.kind === "array") return [...v.items];
  throw new Error("internal error: an Ast value that isn't a list where one belongs");
}

/** @throws {Error} */
export function unquoteTypeNode(ids: Mut<Ids>, v: Ref<Value>): TypeNode {
  const kind = kindOf(v);
  switch (kind) {
    case "ref":
      return unquoteTypeNode_ref(ids, v);
    case "literal":
      return unquoteTypeNode_literal(ids, v);
    case "array":
      return unquoteTypeNode_array(ids, v);
    case "tuple":
      return unquoteTypeNode_tuple(ids, v);
    case "object":
      return unquoteTypeNode_object(ids, v);
    case "function":
      return unquoteTypeNode_function(ids, v);
    case "union":
      return unquoteTypeNode_union(ids, v);
    case "intersection":
      return unquoteTypeNode_intersection(ids, v);
    case "operator":
      return unquoteTypeNode_operator(ids, v);
    case "indexed":
      return unquoteTypeNode_indexed(ids, v);
    case "query":
      return unquoteTypeNode_query(ids, v);
    case "import":
      return unquoteTypeNode_import(ids, v);
    case "conditional":
      return unquoteTypeNode_conditional(ids, v);
    case "infer":
      return unquoteTypeNode_infer(ids, v);
    case "template":
      return unquoteTypeNode_template(ids, v);
    case "mapped":
      return unquoteTypeNode_mapped(ids, v);
    case "predicate":
      return unquoteTypeNode_predicate(ids, v);
  }
  throw new Error(`internal error: an Ast value of kind '${kind}', which no node here has`);
}

/** @throws {Error} */
export function unquoteExpr(ids: Mut<Ids>, v: Ref<Value>): Expr {
  const kind = kindOf(v);
  switch (kind) {
    case "int":
      return unquoteExpr_int(ids, v);
    case "float":
      return unquoteExpr_float(ids, v);
    case "bigint":
      return unquoteExpr_bigint(ids, v);
    case "null":
      return unquoteExpr_null(ids, v);
    case "this":
      return unquoteExpr_this(ids, v);
    case "super":
      return unquoteExpr_super(ids, v);
    case "regex":
      return unquoteExpr_regex(ids, v);
    case "template":
      return unquoteExpr_template(ids, v);
    case "tagged":
      return unquoteExpr_tagged(ids, v);
    case "bool":
      return unquoteExpr_bool(ids, v);
    case "string":
      return unquoteExpr_string(ids, v);
    case "ident":
      return unquoteExpr_ident(ids, v);
    case "spread":
      return unquoteExpr_spread(ids, v);
    case "array":
      return unquoteExpr_array(ids, v);
    case "object":
      return unquoteExpr_object(ids, v);
    case "function":
      return unquoteExpr_function(ids, v);
    case "arrow":
      return unquoteExpr_arrow(ids, v);
    case "member":
      return unquoteExpr_member(ids, v);
    case "index":
      return unquoteExpr_index(ids, v);
    case "call":
      return unquoteExpr_call(ids, v);
    case "new":
      return unquoteExpr_new(ids, v);
    case "instantiation":
      return unquoteExpr_instantiation(ids, v);
    case "meta":
      return unquoteExpr_meta(ids, v);
    case "import":
      return unquoteExpr_import(ids, v);
    case "nonNull":
      return unquoteExpr_nonNull(ids, v);
    case "throw":
      return unquoteExpr_throw(ids, v);
    case "class":
      return unquoteExpr_class(ids, v);
    case "privateName":
      return unquoteExpr_privateName(ids, v);
    case "unary":
      return unquoteExpr_unary(ids, v);
    case "update":
      return unquoteExpr_update(ids, v);
    case "binary":
      return unquoteExpr_binary(ids, v);
    case "conditional":
      return unquoteExpr_conditional(ids, v);
    case "assign":
      return unquoteExpr_assign(ids, v);
    case "pipe":
      return unquoteExpr_pipe(ids, v);
    case "topic":
      return unquoteExpr_topic(ids, v);
    case "match":
      return unquoteExpr_match(ids, v);
    case "comptime":
      return unquoteExpr_comptime(ids, v);
    case "unsafe":
      return unquoteExpr_unsafe(ids, v);
    case "destructure":
      return unquoteExpr_destructure(ids, v);
    case "sequence":
      return unquoteExpr_sequence(ids, v);
    case "yield":
      return unquoteExpr_yield(ids, v);
    case "as":
      return unquoteExpr_as(ids, v);
    case "satisfies":
      return unquoteExpr_satisfies(ids, v);
    case "assertion":
      return unquoteExpr_assertion(ids, v);
  }
  throw new Error(`internal error: an Ast value of kind '${kind}', which no node here has`);
}

/** @throws {Error} */
export function unquoteStmt(ids: Mut<Ids>, v: Ref<Value>): Stmt {
  const kind = kindOf(v);
  switch (kind) {
    case "expr":
      return unquoteStmt_expr(ids, v);
    case "let":
      return unquoteStmt_let(ids, v);
    case "return":
      return unquoteStmt_return(ids, v);
    case "if":
      return unquoteStmt_if(ids, v);
    case "while":
      return unquoteStmt_while(ids, v);
    case "doWhile":
      return unquoteStmt_doWhile(ids, v);
    case "switch":
      return unquoteStmt_switch(ids, v);
    case "labeled":
      return unquoteStmt_labeled(ids, v);
    case "break":
      return unquoteStmt_break(ids, v);
    case "continue":
      return unquoteStmt_continue(ids, v);
    case "throw":
      return unquoteStmt_throw(ids, v);
    case "try":
      return unquoteStmt_try(ids, v);
    case "for":
      return unquoteStmt_for(ids, v);
    case "forIn":
      return unquoteStmt_forIn(ids, v);
    case "forOf":
      return unquoteStmt_forOf(ids, v);
    case "block":
      return unquoteStmt_block(ids, v);
    case "empty":
      return unquoteStmt_empty(ids, v);
    case "debugger":
      return unquoteStmt_debugger(ids, v);
    case "enum":
      return unquoteStmt_enum(ids, v);
    case "namespace":
      return unquoteStmt_namespace(ids, v);
    case "declare":
      return unquoteStmt_declare(ids, v);
    case "comptime":
      return unquoteStmt_comptime(ids, v);
    case "unsafe":
      return unquoteStmt_unsafe(ids, v);
    case "import":
      return unquoteStmt_import(ids, v);
    case "importEquals":
      return unquoteStmt_importEquals(ids, v);
    case "export":
      return unquoteStmt_export(ids, v);
    case "exportDefault":
      return unquoteStmt_exportDefault(ids, v);
    case "exportNamed":
      return unquoteStmt_exportNamed(ids, v);
    case "exportAll":
      return unquoteStmt_exportAll(ids, v);
    case "exportAssign":
      return unquoteStmt_exportAssign(ids, v);
    case "exportAsNamespace":
      return unquoteStmt_exportAsNamespace(ids, v);
    case "typeAlias":
      return unquoteTypeAlias_typeAlias(ids, v);
    case "interface":
      return unquoteInterface_interface(ids, v);
    case "function":
      return unquoteFunc_function(ids, v);
    case "class":
      return unquoteStmt_class(ids, v);
  }
  throw new Error(`internal error: an Ast value of kind '${kind}', which no node here has`);
}

/** @throws {Error} */
export function unquoteTupleElement(ids: Mut<Ids>, v: Ref<Value>): TupleElement {
  return { start: count(field(v, "start")), end: count(field(v, "end")), name: absent(field(v, "name")) ? undefined : text(field(v, "name")), optional: flag(field(v, "optional")), rest: flag(field(v, "rest")), type: unquoteTypeNode(ids, field(v, "type")), id: nextId(ids) };
}

/** @throws {Error} */
export function unquoteTypeMember(ids: Mut<Ids>, v: Ref<Value>): TypeMember {
  const kind = kindOf(v);
  switch (kind) {
    case "property":
      return unquoteTypeMember_property(ids, v);
    case "method":
      return unquoteTypeMember_method(ids, v);
    case "call":
      return unquoteTypeMember_call(ids, v);
    case "construct":
      return unquoteTypeMember_construct(ids, v);
    case "index":
      return unquoteTypeMember_index(ids, v);
    case "get":
      return unquoteTypeMember_get(ids, v);
    case "set":
      return unquoteTypeMember_set(ids, v);
  }
  throw new Error(`internal error: an Ast value of kind '${kind}', which no node here has`);
}

/** @throws {Error} */
export function unquoteObjectProp(ids: Mut<Ids>, v: Ref<Value>): ObjectProp {
  const kind = kindOf(v);
  switch (kind) {
    case "property":
      return unquoteObjectProp_property(ids, v);
    case "shorthand":
      return unquoteObjectProp_shorthand(ids, v);
    case "spread":
      return unquoteObjectProp_spread(ids, v);
    case "method":
      return unquoteObjectProp_method(ids, v);
    case "get":
      return unquoteObjectProp_get(ids, v);
    case "set":
      return unquoteObjectProp_set(ids, v);
  }
  throw new Error(`internal error: an Ast value of kind '${kind}', which no node here has`);
}

/** @throws {Error} */
export function unquoteClassNode(ids: Mut<Ids>, v: Ref<Value>): ClassNode {
  return { start: count(field(v, "start")), end: count(field(v, "end")), name: absent(field(v, "name")) ? undefined : text(field(v, "name")), abstract: flag(field(v, "abstract")), decorators: itemsOf(field(v, "decorators")).map((x92): Expr => unquoteExpr(ids, x92)), typeParams: itemsOf(field(v, "typeParams")).map((x93): TypeParam => unquoteTypeParam(ids, x93)), extends: absent(field(v, "extends")) ? undefined : unquoteExpr(ids, field(v, "extends")), implements: itemsOf(field(v, "implements")).map((x94): TypeNode => unquoteTypeNode(ids, x94)), members: itemsOf(field(v, "members")).map((x95): ClassMember => unquoteClassMember(ids, x95)), derives: absent(field(v, "derives")) ? undefined : itemsOf(field(v, "derives")).map((x96): string => text(x96)), id: nextId(ids) };
}

/** @throws {Error} */
export function unquoteClassMember(ids: Mut<Ids>, v: Ref<Value>): ClassMember {
  const kind = kindOf(v);
  switch (kind) {
    case "field":
      return unquoteClassMember_field(ids, v);
    case "method":
      return unquoteClassMember_method(ids, v);
    case "constructor":
      return unquoteClassMember_constructor(ids, v);
    case "get":
      return unquoteClassMember_get(ids, v);
    case "set":
      return unquoteClassMember_set(ids, v);
    case "index":
      return unquoteClassMember_index(ids, v);
    case "staticBlock":
      return unquoteClassMember_staticBlock(ids, v);
  }
  throw new Error(`internal error: an Ast value of kind '${kind}', which no node here has`);
}

/** @throws {Error} */
export function unquoteParam(ids: Mut<Ids>, v: Ref<Value>): Param {
  return { start: count(field(v, "start")), end: count(field(v, "end")), pattern: unquotePattern(ids, field(v, "pattern")), type: absent(field(v, "type")) ? undefined : unquoteTypeNode(ids, field(v, "type")), optional: flag(field(v, "optional")), rest: flag(field(v, "rest")), default: absent(field(v, "default")) ? undefined : unquoteExpr(ids, field(v, "default")), modifiers: itemsOf(field(v, "modifiers")).map((x123): Modifier => word8(x123)), decorators: itemsOf(field(v, "decorators")).map((x124): Expr => unquoteExpr(ids, x124)), comptime: flag(field(v, "comptime")), id: nextId(ids) };
}

/** @throws {Error} */
export function unquotePattern(ids: Mut<Ids>, v: Ref<Value>): Pattern {
  const kind = kindOf(v);
  switch (kind) {
    case "ident":
      return unquotePattern_ident(ids, v);
    case "object":
      return unquotePattern_object(ids, v);
    case "array":
      return unquotePattern_array(ids, v);
    case "default":
      return unquotePattern_default(ids, v);
    case "expr":
      return unquotePattern_expr(ids, v);
    case "wildcard":
      return unquotePattern_wildcard(ids, v);
    case "literal":
      return unquotePattern_literal(ids, v);
    case "variant":
      return unquotePattern_variant(ids, v);
    case "or":
      return unquotePattern_or(ids, v);
  }
  throw new Error(`internal error: an Ast value of kind '${kind}', which no node here has`);
}

/** @throws {Error} */
export function unquoteMatchArm(ids: Mut<Ids>, v: Ref<Value>): MatchArm {
  return { start: count(field(v, "start")), end: count(field(v, "end")), pattern: unquotePattern(ids, field(v, "pattern")), guard: absent(field(v, "guard")) ? undefined : unquoteExpr(ids, field(v, "guard")), body: unquoteUnion3(ids, field(v, "body")), id: nextId(ids) };
}

/** @throws {Error} */
export function unquotePatternProp(ids: Mut<Ids>, v: Ref<Value>): PatternProp {
  return { start: count(field(v, "start")), end: count(field(v, "end")), key: unquoteUnion2(ids, field(v, "key")), value: unquotePattern(ids, field(v, "value")), id: nextId(ids) };
}

/** @throws {Error} */
export function unquoteSpecifier(ids: Mut<Ids>, v: Ref<Value>): Specifier {
  return { start: count(field(v, "start")), end: count(field(v, "end")), name: text(field(v, "name")), alias: absent(field(v, "alias")) ? undefined : text(field(v, "alias")), typeOnly: flag(field(v, "typeOnly")), id: nextId(ids) };
}

/** @throws {Error} */
export function unquoteEnumMember(ids: Mut<Ids>, v: Ref<Value>): EnumMember {
  return { start: count(field(v, "start")), end: count(field(v, "end")), name: text(field(v, "name")), init: absent(field(v, "init")) ? undefined : unquoteExpr(ids, field(v, "init")), payload: absent(field(v, "payload")) ? undefined : itemsOf(field(v, "payload")).map((x129): TypeNode => unquoteTypeNode(ids, x129)), id: nextId(ids) };
}

/** @throws {Error} */
export function unquoteSwitchCase(ids: Mut<Ids>, v: Ref<Value>): SwitchCase {
  return { start: count(field(v, "start")), end: count(field(v, "end")), test: absent(field(v, "test")) ? undefined : unquoteExpr(ids, field(v, "test")), body: itemsOf(field(v, "body")).map((x130): Stmt => unquoteStmt(ids, x130)), id: nextId(ids) };
}

/** @throws {Error} */
export function unquoteDeclarator(ids: Mut<Ids>, v: Ref<Value>): Declarator {
  return { start: count(field(v, "start")), end: count(field(v, "end")), target: unquotePattern(ids, field(v, "target")), type: absent(field(v, "type")) ? undefined : unquoteTypeNode(ids, field(v, "type")), init: absent(field(v, "init")) ? undefined : unquoteExpr(ids, field(v, "init")), id: nextId(ids) };
}

/** @throws {Error} */
export function unquoteTypeParam(ids: Mut<Ids>, v: Ref<Value>): TypeParam {
  return { start: count(field(v, "start")), end: count(field(v, "end")), name: text(field(v, "name")), constraint: absent(field(v, "constraint")) ? undefined : unquoteTypeNode(ids, field(v, "constraint")), default: absent(field(v, "default")) ? undefined : unquoteTypeNode(ids, field(v, "default")), modifiers: itemsOf(field(v, "modifiers")).map((x131): "const" | "in" | "out" => word9(x131)), id: nextId(ids) };
}

/** @throws {Error} */
export function unquoteTypeAlias(ids: Mut<Ids>, v: Ref<Value>): TypeAlias {
  const kind = kindOf(v);
  switch (kind) {
    case "typeAlias":
      return unquoteTypeAlias_typeAlias(ids, v);
  }
  throw new Error(`internal error: an Ast value of kind '${kind}', which no node here has`);
}

/** @throws {Error} */
export function unquoteInterface(ids: Mut<Ids>, v: Ref<Value>): Interface {
  const kind = kindOf(v);
  switch (kind) {
    case "interface":
      return unquoteInterface_interface(ids, v);
  }
  throw new Error(`internal error: an Ast value of kind '${kind}', which no node here has`);
}

/** @throws {Error} */
export function unquoteJsName(ids: Mut<Ids>, v: Ref<Value>): JsName {
  return { module: text(field(v, "module")), package: count(field(v, "package")), name: text(field(v, "name")), const: absent(field(v, "const")) ? undefined : true as const, overloads: absent(field(v, "overloads")) ? undefined : itemsOf(field(v, "overloads")).map((x132): Func => unquoteFunc(ids, x132)) };
}

/** @throws {Error} */
export function unquoteFunc(ids: Mut<Ids>, v: Ref<Value>): Func {
  const kind = kindOf(v);
  switch (kind) {
    case "function":
      return unquoteFunc_function(ids, v);
  }
  throw new Error(`internal error: an Ast value of kind '${kind}', which no node here has`);
}

/** @throws {Error} */
function unquoteUnion0(ids: Mut<Ids>, v: Ref<Value>): Expr | Stmt[] {
  if (isItems(v)) return itemsOf(v).map((x133): Stmt => unquoteStmt(ids, x133));
  return unquoteExpr(ids, v);
}

/** @throws {Error} */
function unquoteUnion1(ids: Mut<Ids>, v: Ref<Value>): Stmt | Pattern {
  const kind = kindOf(v);
  switch (kind) {
    case "expr":
      return unquoteStmt_expr(ids, v);
    case "let":
      return unquoteStmt_let(ids, v);
    case "return":
      return unquoteStmt_return(ids, v);
    case "if":
      return unquoteStmt_if(ids, v);
    case "while":
      return unquoteStmt_while(ids, v);
    case "doWhile":
      return unquoteStmt_doWhile(ids, v);
    case "switch":
      return unquoteStmt_switch(ids, v);
    case "labeled":
      return unquoteStmt_labeled(ids, v);
    case "break":
      return unquoteStmt_break(ids, v);
    case "continue":
      return unquoteStmt_continue(ids, v);
    case "throw":
      return unquoteStmt_throw(ids, v);
    case "try":
      return unquoteStmt_try(ids, v);
    case "for":
      return unquoteStmt_for(ids, v);
    case "forIn":
      return unquoteStmt_forIn(ids, v);
    case "forOf":
      return unquoteStmt_forOf(ids, v);
    case "block":
      return unquoteStmt_block(ids, v);
    case "empty":
      return unquoteStmt_empty(ids, v);
    case "debugger":
      return unquoteStmt_debugger(ids, v);
    case "enum":
      return unquoteStmt_enum(ids, v);
    case "namespace":
      return unquoteStmt_namespace(ids, v);
    case "declare":
      return unquoteStmt_declare(ids, v);
    case "comptime":
      return unquoteStmt_comptime(ids, v);
    case "unsafe":
      return unquoteStmt_unsafe(ids, v);
    case "import":
      return unquoteStmt_import(ids, v);
    case "importEquals":
      return unquoteStmt_importEquals(ids, v);
    case "export":
      return unquoteStmt_export(ids, v);
    case "exportDefault":
      return unquoteStmt_exportDefault(ids, v);
    case "exportNamed":
      return unquoteStmt_exportNamed(ids, v);
    case "exportAll":
      return unquoteStmt_exportAll(ids, v);
    case "exportAssign":
      return unquoteStmt_exportAssign(ids, v);
    case "exportAsNamespace":
      return unquoteStmt_exportAsNamespace(ids, v);
    case "typeAlias":
      return unquoteTypeAlias_typeAlias(ids, v);
    case "interface":
      return unquoteInterface_interface(ids, v);
    case "function":
      return unquoteFunc_function(ids, v);
    case "class":
      return unquoteStmt_class(ids, v);
    case "ident":
      return unquotePattern_ident(ids, v);
    case "object":
      return unquotePattern_object(ids, v);
    case "array":
      return unquotePattern_array(ids, v);
    case "default":
      return unquotePattern_default(ids, v);
    case "wildcard":
      return unquotePattern_wildcard(ids, v);
    case "literal":
      return unquotePattern_literal(ids, v);
    case "variant":
      return unquotePattern_variant(ids, v);
    case "or":
      return unquotePattern_or(ids, v);
  }
  throw new Error(`internal error: an Ast value of kind '${kind}', which no node here has`);
}

/** @throws {Error} */
function unquoteUnion2(ids: Mut<Ids>, v: Ref<Value>): PropertyName {
  if (isText(v)) return text(v);
  return unquoteExpr(ids, v);
}

/** @throws {Error} */
function unquoteUnion3(ids: Mut<Ids>, v: Ref<Value>): Expr | Extract<Stmt, { kind: "block" }> {
  const kind = kindOf(v);
  switch (kind) {
    case "int":
      return unquoteExpr_int(ids, v);
    case "float":
      return unquoteExpr_float(ids, v);
    case "bigint":
      return unquoteExpr_bigint(ids, v);
    case "null":
      return unquoteExpr_null(ids, v);
    case "this":
      return unquoteExpr_this(ids, v);
    case "super":
      return unquoteExpr_super(ids, v);
    case "regex":
      return unquoteExpr_regex(ids, v);
    case "template":
      return unquoteExpr_template(ids, v);
    case "tagged":
      return unquoteExpr_tagged(ids, v);
    case "bool":
      return unquoteExpr_bool(ids, v);
    case "string":
      return unquoteExpr_string(ids, v);
    case "ident":
      return unquoteExpr_ident(ids, v);
    case "spread":
      return unquoteExpr_spread(ids, v);
    case "array":
      return unquoteExpr_array(ids, v);
    case "object":
      return unquoteExpr_object(ids, v);
    case "function":
      return unquoteExpr_function(ids, v);
    case "arrow":
      return unquoteExpr_arrow(ids, v);
    case "member":
      return unquoteExpr_member(ids, v);
    case "index":
      return unquoteExpr_index(ids, v);
    case "call":
      return unquoteExpr_call(ids, v);
    case "new":
      return unquoteExpr_new(ids, v);
    case "instantiation":
      return unquoteExpr_instantiation(ids, v);
    case "meta":
      return unquoteExpr_meta(ids, v);
    case "import":
      return unquoteExpr_import(ids, v);
    case "nonNull":
      return unquoteExpr_nonNull(ids, v);
    case "throw":
      return unquoteExpr_throw(ids, v);
    case "class":
      return unquoteExpr_class(ids, v);
    case "privateName":
      return unquoteExpr_privateName(ids, v);
    case "unary":
      return unquoteExpr_unary(ids, v);
    case "update":
      return unquoteExpr_update(ids, v);
    case "binary":
      return unquoteExpr_binary(ids, v);
    case "conditional":
      return unquoteExpr_conditional(ids, v);
    case "assign":
      return unquoteExpr_assign(ids, v);
    case "pipe":
      return unquoteExpr_pipe(ids, v);
    case "topic":
      return unquoteExpr_topic(ids, v);
    case "match":
      return unquoteExpr_match(ids, v);
    case "comptime":
      return unquoteExpr_comptime(ids, v);
    case "unsafe":
      return unquoteExpr_unsafe(ids, v);
    case "destructure":
      return unquoteExpr_destructure(ids, v);
    case "sequence":
      return unquoteExpr_sequence(ids, v);
    case "yield":
      return unquoteExpr_yield(ids, v);
    case "as":
      return unquoteExpr_as(ids, v);
    case "satisfies":
      return unquoteExpr_satisfies(ids, v);
    case "assertion":
      return unquoteExpr_assertion(ids, v);
    case "block":
      return unquoteStmt_block(ids, v);
  }
  throw new Error(`internal error: an Ast value of kind '${kind}', which no node here has`);
}

/** @throws {Error} */
function unquoteTypeNode_ref(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeNode, { kind: "ref" }> {
  return { kind: "ref", start: count(field(v, "start")), end: count(field(v, "end")), name: text(field(v, "name")), args: itemsOf(field(v, "args")).map((x1): TypeNode => unquoteTypeNode(ids, x1)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeNode_literal(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeNode, { kind: "literal" }> {
  return { kind: "literal", start: count(field(v, "start")), end: count(field(v, "end")), value: unquoteExpr(ids, field(v, "value")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeNode_array(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeNode, { kind: "array" }> {
  return { kind: "array", start: count(field(v, "start")), end: count(field(v, "end")), element: unquoteTypeNode(ids, field(v, "element")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeNode_tuple(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeNode, { kind: "tuple" }> {
  return { kind: "tuple", start: count(field(v, "start")), end: count(field(v, "end")), elements: itemsOf(field(v, "elements")).map((x2): TupleElement => unquoteTupleElement(ids, x2)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeNode_object(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeNode, { kind: "object" }> {
  return { kind: "object", start: count(field(v, "start")), end: count(field(v, "end")), members: itemsOf(field(v, "members")).map((x3): TypeMember => unquoteTypeMember(ids, x3)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeNode_function(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeNode, { kind: "function" }> {
  return { kind: "function", start: count(field(v, "start")), end: count(field(v, "end")), typeParams: itemsOf(field(v, "typeParams")).map((x4): TypeParam => unquoteTypeParam(ids, x4)), params: itemsOf(field(v, "params")).map((x5): Param => unquoteParam(ids, x5)), returns: unquoteTypeNode(ids, field(v, "returns")), throws: absent(field(v, "throws")) ? undefined : unquoteTypeNode(ids, field(v, "throws")), construct: flag(field(v, "construct")), abstract: flag(field(v, "abstract")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeNode_union(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeNode, { kind: "union" | "intersection" }> {
  return { kind: "union", start: count(field(v, "start")), end: count(field(v, "end")), types: itemsOf(field(v, "types")).map((x6): TypeNode => unquoteTypeNode(ids, x6)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeNode_intersection(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeNode, { kind: "union" | "intersection" }> {
  return { kind: "intersection", start: count(field(v, "start")), end: count(field(v, "end")), types: itemsOf(field(v, "types")).map((x7): TypeNode => unquoteTypeNode(ids, x7)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeNode_operator(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeNode, { kind: "operator" }> {
  return { kind: "operator", start: count(field(v, "start")), end: count(field(v, "end")), op: word0(field(v, "op")), type: unquoteTypeNode(ids, field(v, "type")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeNode_indexed(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeNode, { kind: "indexed" }> {
  return { kind: "indexed", start: count(field(v, "start")), end: count(field(v, "end")), object: unquoteTypeNode(ids, field(v, "object")), index: unquoteTypeNode(ids, field(v, "index")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeNode_query(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeNode, { kind: "query" }> {
  return { kind: "query", start: count(field(v, "start")), end: count(field(v, "end")), target: unquoteTypeNode(ids, field(v, "target")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeNode_import(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeNode, { kind: "import" }> {
  return { kind: "import", start: count(field(v, "start")), end: count(field(v, "end")), module: text(field(v, "module")), name: absent(field(v, "name")) ? undefined : text(field(v, "name")), args: itemsOf(field(v, "args")).map((x8): TypeNode => unquoteTypeNode(ids, x8)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeNode_conditional(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeNode, { kind: "conditional" }> {
  return { kind: "conditional", start: count(field(v, "start")), end: count(field(v, "end")), check: unquoteTypeNode(ids, field(v, "check")), extends: unquoteTypeNode(ids, field(v, "extends")), then: unquoteTypeNode(ids, field(v, "then")), else: unquoteTypeNode(ids, field(v, "else")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeNode_infer(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeNode, { kind: "infer" }> {
  return { kind: "infer", start: count(field(v, "start")), end: count(field(v, "end")), name: text(field(v, "name")), constraint: absent(field(v, "constraint")) ? undefined : unquoteTypeNode(ids, field(v, "constraint")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeNode_template(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeNode, { kind: "template" }> {
  return { kind: "template", start: count(field(v, "start")), end: count(field(v, "end")), quasis: itemsOf(field(v, "quasis")).map((x9): string => text(x9)), types: itemsOf(field(v, "types")).map((x10): TypeNode => unquoteTypeNode(ids, x10)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeNode_mapped(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeNode, { kind: "mapped" }> {
  return { kind: "mapped", start: count(field(v, "start")), end: count(field(v, "end")), name: text(field(v, "name")), constraint: unquoteTypeNode(ids, field(v, "constraint")), as: absent(field(v, "as")) ? undefined : unquoteTypeNode(ids, field(v, "as")), type: absent(field(v, "type")) ? undefined : unquoteTypeNode(ids, field(v, "type")), readonly: absent(field(v, "readonly")) ? undefined : word1(field(v, "readonly")), optional: absent(field(v, "optional")) ? undefined : word1(field(v, "optional")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeNode_predicate(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeNode, { kind: "predicate" }> {
  return { kind: "predicate", start: count(field(v, "start")), end: count(field(v, "end")), asserts: flag(field(v, "asserts")), name: text(field(v, "name")), type: absent(field(v, "type")) ? undefined : unquoteTypeNode(ids, field(v, "type")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_int(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "int" }> {
  return { kind: "int", start: count(field(v, "start")), end: count(field(v, "end")), value: big(field(v, "value")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_float(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "float" }> {
  return { kind: "float", start: count(field(v, "start")), end: count(field(v, "end")), value: float(field(v, "value")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_bigint(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "bigint" }> {
  return { kind: "bigint", start: count(field(v, "start")), end: count(field(v, "end")), value: big(field(v, "value")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_null(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "null" }> {
  return { kind: "null", start: count(field(v, "start")), end: count(field(v, "end")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_this(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "this" }> {
  return { kind: "this", start: count(field(v, "start")), end: count(field(v, "end")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_super(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "super" }> {
  return { kind: "super", start: count(field(v, "start")), end: count(field(v, "end")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_regex(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "regex" }> {
  return { kind: "regex", start: count(field(v, "start")), end: count(field(v, "end")), pattern: text(field(v, "pattern")), flags: text(field(v, "flags")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_template(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "template" }> {
  return { kind: "template", start: count(field(v, "start")), end: count(field(v, "end")), quasis: itemsOf(field(v, "quasis")).map((x11): string => text(x11)), raw: itemsOf(field(v, "raw")).map((x12): string => text(x12)), exprs: itemsOf(field(v, "exprs")).map((x13): Expr => unquoteExpr(ids, x13)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_tagged(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "tagged" }> {
  return { kind: "tagged", start: count(field(v, "start")), end: count(field(v, "end")), tag: unquoteExpr(ids, field(v, "tag")), typeArgs: itemsOf(field(v, "typeArgs")).map((x14): TypeNode => unquoteTypeNode(ids, x14)), template: unquoteExpr(ids, field(v, "template")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_bool(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "bool" }> {
  return { kind: "bool", start: count(field(v, "start")), end: count(field(v, "end")), value: flag(field(v, "value")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_string(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "string" }> {
  return { kind: "string", start: count(field(v, "start")), end: count(field(v, "end")), value: text(field(v, "value")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_ident(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "ident" }> {
  return { kind: "ident", start: count(field(v, "start")), end: count(field(v, "end")), name: text(field(v, "name")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_spread(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "spread" }> {
  return { kind: "spread", start: count(field(v, "start")), end: count(field(v, "end")), value: unquoteExpr(ids, field(v, "value")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_array(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "array" }> {
  return { kind: "array", start: count(field(v, "start")), end: count(field(v, "end")), elements: itemsOf(field(v, "elements")).map((x15): Extract<Expr, { kind: "array" }>["elements"][usize] => absent(x15) ? undefined : unquoteExpr(ids, x15)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_object(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "object" }> {
  return { kind: "object", start: count(field(v, "start")), end: count(field(v, "end")), props: itemsOf(field(v, "props")).map((x16): ObjectProp => unquoteObjectProp(ids, x16)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_function(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "function" }> {
  return { kind: "function", start: count(field(v, "start")), end: count(field(v, "end")), name: absent(field(v, "name")) ? undefined : text(field(v, "name")), async: flag(field(v, "async")), generator: flag(field(v, "generator")), typeParams: itemsOf(field(v, "typeParams")).map((x17): TypeParam => unquoteTypeParam(ids, x17)), params: itemsOf(field(v, "params")).map((x18): Param => unquoteParam(ids, x18)), returnType: absent(field(v, "returnType")) ? undefined : unquoteTypeNode(ids, field(v, "returnType")), body: itemsOf(field(v, "body")).map((x19): Stmt => unquoteStmt(ids, x19)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_arrow(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "arrow" }> {
  return { kind: "arrow", start: count(field(v, "start")), end: count(field(v, "end")), move: flag(field(v, "move")), async: flag(field(v, "async")), typeParams: itemsOf(field(v, "typeParams")).map((x20): TypeParam => unquoteTypeParam(ids, x20)), params: itemsOf(field(v, "params")).map((x21): Param => unquoteParam(ids, x21)), returnType: absent(field(v, "returnType")) ? undefined : unquoteTypeNode(ids, field(v, "returnType")), throws: absent(field(v, "throws")) ? undefined : unquoteTypeNode(ids, field(v, "throws")), body: unquoteUnion0(ids, field(v, "body")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_member(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "member" }> {
  return { kind: "member", start: count(field(v, "start")), end: count(field(v, "end")), object: unquoteExpr(ids, field(v, "object")), name: text(field(v, "name")), optional: flag(field(v, "optional")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_index(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "index" }> {
  return { kind: "index", start: count(field(v, "start")), end: count(field(v, "end")), object: unquoteExpr(ids, field(v, "object")), index: unquoteExpr(ids, field(v, "index")), optional: flag(field(v, "optional")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_call(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "call" }> {
  return { kind: "call", start: count(field(v, "start")), end: count(field(v, "end")), callee: unquoteExpr(ids, field(v, "callee")), typeArgs: itemsOf(field(v, "typeArgs")).map((x22): TypeNode => unquoteTypeNode(ids, x22)), args: itemsOf(field(v, "args")).map((x23): Expr => unquoteExpr(ids, x23)), optional: flag(field(v, "optional")), implementation: absent(field(v, "implementation")) ? undefined : true as const, shown: absent(field(v, "shown")) ? undefined : text(field(v, "shown")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_new(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "new" }> {
  return { kind: "new", start: count(field(v, "start")), end: count(field(v, "end")), callee: unquoteExpr(ids, field(v, "callee")), typeArgs: itemsOf(field(v, "typeArgs")).map((x24): TypeNode => unquoteTypeNode(ids, x24)), args: absent(field(v, "args")) ? undefined : itemsOf(field(v, "args")).map((x25): Expr => unquoteExpr(ids, x25)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_instantiation(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "instantiation" }> {
  return { kind: "instantiation", start: count(field(v, "start")), end: count(field(v, "end")), expr: unquoteExpr(ids, field(v, "expr")), typeArgs: itemsOf(field(v, "typeArgs")).map((x26): TypeNode => unquoteTypeNode(ids, x26)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_meta(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "meta" }> {
  return { kind: "meta", start: count(field(v, "start")), end: count(field(v, "end")), name: word2(field(v, "name")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_import(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "import" }> {
  return { kind: "import", start: count(field(v, "start")), end: count(field(v, "end")), args: itemsOf(field(v, "args")).map((x27): Expr => unquoteExpr(ids, x27)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_nonNull(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "nonNull" }> {
  return { kind: "nonNull", start: count(field(v, "start")), end: count(field(v, "end")), expr: unquoteExpr(ids, field(v, "expr")), reason: absent(field(v, "reason")) ? undefined : text(field(v, "reason")), redundant: absent(field(v, "redundant")) ? undefined : flag(field(v, "redundant")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_throw(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "throw" }> {
  return { kind: "throw", start: count(field(v, "start")), end: count(field(v, "end")), value: unquoteExpr(ids, field(v, "value")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_class(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "class" }> {
  return { kind: "class", start: count(field(v, "start")), end: count(field(v, "end")), name: absent(field(v, "name")) ? undefined : text(field(v, "name")), abstract: flag(field(v, "abstract")), decorators: itemsOf(field(v, "decorators")).map((x28): Expr => unquoteExpr(ids, x28)), typeParams: itemsOf(field(v, "typeParams")).map((x29): TypeParam => unquoteTypeParam(ids, x29)), extends: absent(field(v, "extends")) ? undefined : unquoteExpr(ids, field(v, "extends")), implements: itemsOf(field(v, "implements")).map((x30): TypeNode => unquoteTypeNode(ids, x30)), members: itemsOf(field(v, "members")).map((x31): ClassMember => unquoteClassMember(ids, x31)), derives: absent(field(v, "derives")) ? undefined : itemsOf(field(v, "derives")).map((x32): string => text(x32)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_privateName(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "privateName" }> {
  return { kind: "privateName", start: count(field(v, "start")), end: count(field(v, "end")), name: text(field(v, "name")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_unary(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "unary" }> {
  return { kind: "unary", start: count(field(v, "start")), end: count(field(v, "end")), op: word3(field(v, "op")), operand: unquoteExpr(ids, field(v, "operand")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_update(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "update" }> {
  return { kind: "update", start: count(field(v, "start")), end: count(field(v, "end")), op: word4(field(v, "op")), prefix: flag(field(v, "prefix")), operand: unquoteExpr(ids, field(v, "operand")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_binary(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "binary" }> {
  return { kind: "binary", start: count(field(v, "start")), end: count(field(v, "end")), op: word5(field(v, "op")), left: unquoteExpr(ids, field(v, "left")), right: unquoteExpr(ids, field(v, "right")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_conditional(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "conditional" }> {
  return { kind: "conditional", start: count(field(v, "start")), end: count(field(v, "end")), cond: unquoteExpr(ids, field(v, "cond")), then: unquoteExpr(ids, field(v, "then")), else: unquoteExpr(ids, field(v, "else")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_assign(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "assign" }> {
  return { kind: "assign", start: count(field(v, "start")), end: count(field(v, "end")), op: word6(field(v, "op")), target: unquoteExpr(ids, field(v, "target")), value: unquoteExpr(ids, field(v, "value")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_pipe(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "pipe" }> {
  return { kind: "pipe", start: count(field(v, "start")), end: count(field(v, "end")), value: unquoteExpr(ids, field(v, "value")), body: unquoteExpr(ids, field(v, "body")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_topic(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "topic" }> {
  return { kind: "topic", start: count(field(v, "start")), end: count(field(v, "end")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_match(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "match" }> {
  return { kind: "match", start: count(field(v, "start")), end: count(field(v, "end")), subject: unquoteExpr(ids, field(v, "subject")), arms: itemsOf(field(v, "arms")).map((x33): MatchArm => unquoteMatchArm(ids, x33)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_comptime(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "comptime" }> {
  return { kind: "comptime", start: count(field(v, "start")), end: count(field(v, "end")), expr: unquoteExpr(ids, field(v, "expr")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_unsafe(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "unsafe" }> {
  return { kind: "unsafe", start: count(field(v, "start")), end: count(field(v, "end")), expr: unquoteExpr(ids, field(v, "expr")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_destructure(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "destructure" }> {
  return { kind: "destructure", start: count(field(v, "start")), end: count(field(v, "end")), pattern: unquotePattern(ids, field(v, "pattern")), value: unquoteExpr(ids, field(v, "value")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_sequence(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "sequence" }> {
  return { kind: "sequence", start: count(field(v, "start")), end: count(field(v, "end")), exprs: itemsOf(field(v, "exprs")).map((x34): Expr => unquoteExpr(ids, x34)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_yield(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "yield" }> {
  return { kind: "yield", start: count(field(v, "start")), end: count(field(v, "end")), value: absent(field(v, "value")) ? undefined : unquoteExpr(ids, field(v, "value")), delegate: flag(field(v, "delegate")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_as(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "as" | "satisfies" }> {
  return { kind: "as", start: count(field(v, "start")), end: count(field(v, "end")), expr: unquoteExpr(ids, field(v, "expr")), type: unquoteTypeNode(ids, field(v, "type")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_satisfies(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "as" | "satisfies" }> {
  return { kind: "satisfies", start: count(field(v, "start")), end: count(field(v, "end")), expr: unquoteExpr(ids, field(v, "expr")), type: unquoteTypeNode(ids, field(v, "type")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteExpr_assertion(ids: Mut<Ids>, v: Ref<Value>): Extract<Expr, { kind: "assertion" }> {
  return { kind: "assertion", start: count(field(v, "start")), end: count(field(v, "end")), type: unquoteTypeNode(ids, field(v, "type")), expr: unquoteExpr(ids, field(v, "expr")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_expr(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "expr" }> {
  return { kind: "expr", start: count(field(v, "start")), end: count(field(v, "end")), expr: unquoteExpr(ids, field(v, "expr")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_let(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "let" }> {
  return { kind: "let", start: count(field(v, "start")), end: count(field(v, "end")), keyword: word7(field(v, "keyword")), declarations: itemsOf(field(v, "declarations")).map((x35): Declarator => unquoteDeclarator(ids, x35)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_return(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "return" }> {
  return { kind: "return", start: count(field(v, "start")), end: count(field(v, "end")), value: absent(field(v, "value")) ? undefined : unquoteExpr(ids, field(v, "value")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_if(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "if" }> {
  return { kind: "if", start: count(field(v, "start")), end: count(field(v, "end")), cond: unquoteExpr(ids, field(v, "cond")), then: itemsOf(field(v, "then")).map((x36): Stmt => unquoteStmt(ids, x36)), else: absent(field(v, "else")) ? undefined : itemsOf(field(v, "else")).map((x37): Stmt => unquoteStmt(ids, x37)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_while(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "while" }> {
  return { kind: "while", start: count(field(v, "start")), end: count(field(v, "end")), cond: unquoteExpr(ids, field(v, "cond")), body: itemsOf(field(v, "body")).map((x38): Stmt => unquoteStmt(ids, x38)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_doWhile(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "doWhile" }> {
  return { kind: "doWhile", start: count(field(v, "start")), end: count(field(v, "end")), body: itemsOf(field(v, "body")).map((x39): Stmt => unquoteStmt(ids, x39)), cond: unquoteExpr(ids, field(v, "cond")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_switch(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "switch" }> {
  return { kind: "switch", start: count(field(v, "start")), end: count(field(v, "end")), discriminant: unquoteExpr(ids, field(v, "discriminant")), cases: itemsOf(field(v, "cases")).map((x40): SwitchCase => unquoteSwitchCase(ids, x40)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_labeled(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "labeled" }> {
  return { kind: "labeled", start: count(field(v, "start")), end: count(field(v, "end")), label: text(field(v, "label")), body: unquoteStmt(ids, field(v, "body")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_break(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "break" | "continue" }> {
  return { kind: "break", start: count(field(v, "start")), end: count(field(v, "end")), label: absent(field(v, "label")) ? undefined : text(field(v, "label")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_continue(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "break" | "continue" }> {
  return { kind: "continue", start: count(field(v, "start")), end: count(field(v, "end")), label: absent(field(v, "label")) ? undefined : text(field(v, "label")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_throw(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "throw" }> {
  return { kind: "throw", start: count(field(v, "start")), end: count(field(v, "end")), value: unquoteExpr(ids, field(v, "value")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_try(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "try" }> {
  return { kind: "try", start: count(field(v, "start")), end: count(field(v, "end")), block: itemsOf(field(v, "block")).map((x41): Stmt => unquoteStmt(ids, x41)), param: absent(field(v, "param")) ? undefined : unquotePattern(ids, field(v, "param")), paramType: absent(field(v, "paramType")) ? undefined : unquoteTypeNode(ids, field(v, "paramType")), handler: absent(field(v, "handler")) ? undefined : itemsOf(field(v, "handler")).map((x42): Stmt => unquoteStmt(ids, x42)), finalizer: absent(field(v, "finalizer")) ? undefined : itemsOf(field(v, "finalizer")).map((x43): Stmt => unquoteStmt(ids, x43)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_for(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "for" }> {
  return { kind: "for", start: count(field(v, "start")), end: count(field(v, "end")), init: absent(field(v, "init")) ? undefined : unquoteStmt(ids, field(v, "init")), test: absent(field(v, "test")) ? undefined : unquoteExpr(ids, field(v, "test")), update: absent(field(v, "update")) ? undefined : unquoteExpr(ids, field(v, "update")), body: itemsOf(field(v, "body")).map((x44): Stmt => unquoteStmt(ids, x44)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_forIn(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "forIn" | "forOf" }> {
  return { kind: "forIn", start: count(field(v, "start")), end: count(field(v, "end")), await: flag(field(v, "await")), left: unquoteUnion1(ids, field(v, "left")), right: unquoteExpr(ids, field(v, "right")), body: itemsOf(field(v, "body")).map((x45): Stmt => unquoteStmt(ids, x45)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_forOf(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "forIn" | "forOf" }> {
  return { kind: "forOf", start: count(field(v, "start")), end: count(field(v, "end")), await: flag(field(v, "await")), left: unquoteUnion1(ids, field(v, "left")), right: unquoteExpr(ids, field(v, "right")), body: itemsOf(field(v, "body")).map((x46): Stmt => unquoteStmt(ids, x46)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_block(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "block" }> {
  return { kind: "block", start: count(field(v, "start")), end: count(field(v, "end")), body: itemsOf(field(v, "body")).map((x47): Stmt => unquoteStmt(ids, x47)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_empty(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "empty" }> {
  return { kind: "empty", start: count(field(v, "start")), end: count(field(v, "end")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_debugger(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "debugger" }> {
  return { kind: "debugger", start: count(field(v, "start")), end: count(field(v, "end")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_enum(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "enum" }> {
  return { kind: "enum", start: count(field(v, "start")), end: count(field(v, "end")), name: text(field(v, "name")), const: flag(field(v, "const")), typeParams: itemsOf(field(v, "typeParams")).map((x48): TypeParam => unquoteTypeParam(ids, x48)), members: itemsOf(field(v, "members")).map((x49): EnumMember => unquoteEnumMember(ids, x49)), decorators: absent(field(v, "decorators")) ? undefined : itemsOf(field(v, "decorators")).map((x50): Expr => unquoteExpr(ids, x50)), derives: absent(field(v, "derives")) ? undefined : itemsOf(field(v, "derives")).map((x51): string => text(x51)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_namespace(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "namespace" }> {
  return { kind: "namespace", start: count(field(v, "start")), end: count(field(v, "end")), name: text(field(v, "name")), quoted: flag(field(v, "quoted")), global: flag(field(v, "global")), body: absent(field(v, "body")) ? undefined : itemsOf(field(v, "body")).map((x52): Stmt => unquoteStmt(ids, x52)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_declare(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "declare" }> {
  return { kind: "declare", start: count(field(v, "start")), end: count(field(v, "end")), body: unquoteStmt(ids, field(v, "body")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_comptime(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "comptime" }> {
  return { kind: "comptime", start: count(field(v, "start")), end: count(field(v, "end")), body: itemsOf(field(v, "body")).map((x53): Stmt => unquoteStmt(ids, x53)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_unsafe(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "unsafe" }> {
  return { kind: "unsafe", start: count(field(v, "start")), end: count(field(v, "end")), body: itemsOf(field(v, "body")).map((x54): Stmt => unquoteStmt(ids, x54)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_import(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "import" }> {
  return { kind: "import", start: count(field(v, "start")), end: count(field(v, "end")), typeOnly: flag(field(v, "typeOnly")), defer: flag(field(v, "defer")), default: absent(field(v, "default")) ? undefined : text(field(v, "default")), namespace: absent(field(v, "namespace")) ? undefined : text(field(v, "namespace")), named: absent(field(v, "named")) ? undefined : itemsOf(field(v, "named")).map((x55): Specifier => unquoteSpecifier(ids, x55)), module: text(field(v, "module")), attributes: absent(field(v, "attributes")) ? undefined : unquoteExpr(ids, field(v, "attributes")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_importEquals(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "importEquals" }> {
  return { kind: "importEquals", start: count(field(v, "start")), end: count(field(v, "end")), typeOnly: flag(field(v, "typeOnly")), name: text(field(v, "name")), require: absent(field(v, "require")) ? undefined : text(field(v, "require")), entity: absent(field(v, "entity")) ? undefined : text(field(v, "entity")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_export(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "export" }> {
  return { kind: "export", start: count(field(v, "start")), end: count(field(v, "end")), body: unquoteStmt(ids, field(v, "body")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_exportDefault(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "exportDefault" }> {
  return { kind: "exportDefault", start: count(field(v, "start")), end: count(field(v, "end")), declaration: absent(field(v, "declaration")) ? undefined : unquoteStmt(ids, field(v, "declaration")), value: absent(field(v, "value")) ? undefined : unquoteExpr(ids, field(v, "value")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_exportNamed(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "exportNamed" }> {
  return { kind: "exportNamed", start: count(field(v, "start")), end: count(field(v, "end")), typeOnly: flag(field(v, "typeOnly")), specifiers: itemsOf(field(v, "specifiers")).map((x56): Specifier => unquoteSpecifier(ids, x56)), module: absent(field(v, "module")) ? undefined : text(field(v, "module")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_exportAll(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "exportAll" }> {
  return { kind: "exportAll", start: count(field(v, "start")), end: count(field(v, "end")), typeOnly: flag(field(v, "typeOnly")), alias: absent(field(v, "alias")) ? undefined : text(field(v, "alias")), module: text(field(v, "module")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_exportAssign(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "exportAssign" }> {
  return { kind: "exportAssign", start: count(field(v, "start")), end: count(field(v, "end")), value: unquoteExpr(ids, field(v, "value")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_exportAsNamespace(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "exportAsNamespace" }> {
  return { kind: "exportAsNamespace", start: count(field(v, "start")), end: count(field(v, "end")), name: text(field(v, "name")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeAlias_typeAlias(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeAlias, { kind: "typeAlias" }> {
  return { kind: "typeAlias", start: count(field(v, "start")), end: count(field(v, "end")), name: text(field(v, "name")), typeParams: itemsOf(field(v, "typeParams")).map((x57): TypeParam => unquoteTypeParam(ids, x57)), type: unquoteTypeNode(ids, field(v, "type")), decorators: absent(field(v, "decorators")) ? undefined : itemsOf(field(v, "decorators")).map((x58): Expr => unquoteExpr(ids, x58)), js: absent(field(v, "js")) ? undefined : unquoteJsName(ids, field(v, "js")), shown: absent(field(v, "shown")) ? undefined : text(field(v, "shown")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteInterface_interface(ids: Mut<Ids>, v: Ref<Value>): Extract<Interface, { kind: "interface" }> {
  return { kind: "interface", start: count(field(v, "start")), end: count(field(v, "end")), name: text(field(v, "name")), typeParams: itemsOf(field(v, "typeParams")).map((x59): TypeParam => unquoteTypeParam(ids, x59)), extends: itemsOf(field(v, "extends")).map((x60): TypeNode => unquoteTypeNode(ids, x60)), members: itemsOf(field(v, "members")).map((x61): TypeMember => unquoteTypeMember(ids, x61)), decorators: absent(field(v, "decorators")) ? undefined : itemsOf(field(v, "decorators")).map((x62): Expr => unquoteExpr(ids, x62)), js: absent(field(v, "js")) ? undefined : unquoteJsName(ids, field(v, "js")), jsClass: absent(field(v, "jsClass")) ? undefined : { constructors: itemsOf(field(field(v, "jsClass"), "constructors")).map((x63): Param[] => itemsOf(x63).map((x64): Param => unquoteParam(ids, x64))), statics: itemsOf(field(field(v, "jsClass"), "statics")).map((x65): TypeMember => unquoteTypeMember(ids, x65)) }, jsSource: absent(field(v, "jsSource")) ? undefined : unquoteStmt(ids, field(v, "jsSource")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteFunc_function(ids: Mut<Ids>, v: Ref<Value>): Extract<Func, { kind: "function" }> {
  return { kind: "function", start: count(field(v, "start")), end: count(field(v, "end")), name: text(field(v, "name")), async: flag(field(v, "async")), generator: flag(field(v, "generator")), macro: flag(field(v, "macro")), typeParams: itemsOf(field(v, "typeParams")).map((x66): TypeParam => unquoteTypeParam(ids, x66)), params: itemsOf(field(v, "params")).map((x67): Param => unquoteParam(ids, x67)), returnType: absent(field(v, "returnType")) ? undefined : unquoteTypeNode(ids, field(v, "returnType")), throws: absent(field(v, "throws")) ? undefined : unquoteTypeNode(ids, field(v, "throws")), body: absent(field(v, "body")) ? undefined : itemsOf(field(v, "body")).map((x68): Stmt => unquoteStmt(ids, x68)), decorators: absent(field(v, "decorators")) ? undefined : itemsOf(field(v, "decorators")).map((x69): Expr => unquoteExpr(ids, x69)), js: absent(field(v, "js")) ? undefined : unquoteJsName(ids, field(v, "js")), overloadNames: absent(field(v, "overloadNames")) ? undefined : itemsOf(field(v, "overloadNames")).map((x70): string => text(x70)), signature: absent(field(v, "signature")) ? undefined : true as const, id: nextId(ids) };
}

/** @throws {Error} */
function unquoteStmt_class(ids: Mut<Ids>, v: Ref<Value>): Extract<Stmt, { kind: "class" }> {
  return { kind: "class", start: count(field(v, "start")), end: count(field(v, "end")), name: absent(field(v, "name")) ? undefined : text(field(v, "name")), abstract: flag(field(v, "abstract")), decorators: itemsOf(field(v, "decorators")).map((x71): Expr => unquoteExpr(ids, x71)), typeParams: itemsOf(field(v, "typeParams")).map((x72): TypeParam => unquoteTypeParam(ids, x72)), extends: absent(field(v, "extends")) ? undefined : unquoteExpr(ids, field(v, "extends")), implements: itemsOf(field(v, "implements")).map((x73): TypeNode => unquoteTypeNode(ids, x73)), members: itemsOf(field(v, "members")).map((x74): ClassMember => unquoteClassMember(ids, x74)), derives: absent(field(v, "derives")) ? undefined : itemsOf(field(v, "derives")).map((x75): string => text(x75)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeMember_property(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeMember, { kind: "property" }> {
  return { kind: "property", start: count(field(v, "start")), end: count(field(v, "end")), name: unquoteUnion2(ids, field(v, "name")), optional: flag(field(v, "optional")), readonly: flag(field(v, "readonly")), type: absent(field(v, "type")) ? undefined : unquoteTypeNode(ids, field(v, "type")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeMember_method(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeMember, { kind: "method" }> {
  return { kind: "method", start: count(field(v, "start")), end: count(field(v, "end")), name: unquoteUnion2(ids, field(v, "name")), optional: flag(field(v, "optional")), typeParams: itemsOf(field(v, "typeParams")).map((x76): TypeParam => unquoteTypeParam(ids, x76)), params: itemsOf(field(v, "params")).map((x77): Param => unquoteParam(ids, x77)), returns: absent(field(v, "returns")) ? undefined : unquoteTypeNode(ids, field(v, "returns")), throws: absent(field(v, "throws")) ? undefined : unquoteTypeNode(ids, field(v, "throws")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeMember_call(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeMember, { kind: "call" | "construct" }> {
  return { kind: "call", start: count(field(v, "start")), end: count(field(v, "end")), typeParams: itemsOf(field(v, "typeParams")).map((x78): TypeParam => unquoteTypeParam(ids, x78)), params: itemsOf(field(v, "params")).map((x79): Param => unquoteParam(ids, x79)), returns: absent(field(v, "returns")) ? undefined : unquoteTypeNode(ids, field(v, "returns")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeMember_construct(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeMember, { kind: "call" | "construct" }> {
  return { kind: "construct", start: count(field(v, "start")), end: count(field(v, "end")), typeParams: itemsOf(field(v, "typeParams")).map((x80): TypeParam => unquoteTypeParam(ids, x80)), params: itemsOf(field(v, "params")).map((x81): Param => unquoteParam(ids, x81)), returns: absent(field(v, "returns")) ? undefined : unquoteTypeNode(ids, field(v, "returns")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeMember_index(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeMember, { kind: "index" }> {
  return { kind: "index", start: count(field(v, "start")), end: count(field(v, "end")), readonly: flag(field(v, "readonly")), params: itemsOf(field(v, "params")).map((x82): Param => unquoteParam(ids, x82)), type: unquoteTypeNode(ids, field(v, "type")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeMember_get(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeMember, { kind: "get" | "set" }> {
  return { kind: "get", start: count(field(v, "start")), end: count(field(v, "end")), name: unquoteUnion2(ids, field(v, "name")), params: itemsOf(field(v, "params")).map((x83): Param => unquoteParam(ids, x83)), returns: absent(field(v, "returns")) ? undefined : unquoteTypeNode(ids, field(v, "returns")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteTypeMember_set(ids: Mut<Ids>, v: Ref<Value>): Extract<TypeMember, { kind: "get" | "set" }> {
  return { kind: "set", start: count(field(v, "start")), end: count(field(v, "end")), name: unquoteUnion2(ids, field(v, "name")), params: itemsOf(field(v, "params")).map((x84): Param => unquoteParam(ids, x84)), returns: absent(field(v, "returns")) ? undefined : unquoteTypeNode(ids, field(v, "returns")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteObjectProp_property(ids: Mut<Ids>, v: Ref<Value>): Extract<ObjectProp, { kind: "property" }> {
  return { kind: "property", start: count(field(v, "start")), end: count(field(v, "end")), key: unquoteUnion2(ids, field(v, "key")), value: unquoteExpr(ids, field(v, "value")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteObjectProp_shorthand(ids: Mut<Ids>, v: Ref<Value>): Extract<ObjectProp, { kind: "shorthand" }> {
  return { kind: "shorthand", start: count(field(v, "start")), end: count(field(v, "end")), name: text(field(v, "name")), default: absent(field(v, "default")) ? undefined : unquoteExpr(ids, field(v, "default")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteObjectProp_spread(ids: Mut<Ids>, v: Ref<Value>): Extract<ObjectProp, { kind: "spread" }> {
  return { kind: "spread", start: count(field(v, "start")), end: count(field(v, "end")), value: unquoteExpr(ids, field(v, "value")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteObjectProp_method(ids: Mut<Ids>, v: Ref<Value>): Extract<ObjectProp, { kind: "method" }> {
  return { kind: "method", start: count(field(v, "start")), end: count(field(v, "end")), key: unquoteUnion2(ids, field(v, "key")), async: flag(field(v, "async")), generator: flag(field(v, "generator")), typeParams: itemsOf(field(v, "typeParams")).map((x85): TypeParam => unquoteTypeParam(ids, x85)), params: itemsOf(field(v, "params")).map((x86): Param => unquoteParam(ids, x86)), returnType: absent(field(v, "returnType")) ? undefined : unquoteTypeNode(ids, field(v, "returnType")), body: itemsOf(field(v, "body")).map((x87): Stmt => unquoteStmt(ids, x87)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteObjectProp_get(ids: Mut<Ids>, v: Ref<Value>): Extract<ObjectProp, { kind: "get" | "set" }> {
  return { kind: "get", start: count(field(v, "start")), end: count(field(v, "end")), key: unquoteUnion2(ids, field(v, "key")), params: itemsOf(field(v, "params")).map((x88): Param => unquoteParam(ids, x88)), returnType: absent(field(v, "returnType")) ? undefined : unquoteTypeNode(ids, field(v, "returnType")), body: itemsOf(field(v, "body")).map((x89): Stmt => unquoteStmt(ids, x89)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteObjectProp_set(ids: Mut<Ids>, v: Ref<Value>): Extract<ObjectProp, { kind: "get" | "set" }> {
  return { kind: "set", start: count(field(v, "start")), end: count(field(v, "end")), key: unquoteUnion2(ids, field(v, "key")), params: itemsOf(field(v, "params")).map((x90): Param => unquoteParam(ids, x90)), returnType: absent(field(v, "returnType")) ? undefined : unquoteTypeNode(ids, field(v, "returnType")), body: itemsOf(field(v, "body")).map((x91): Stmt => unquoteStmt(ids, x91)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteClassMember_field(ids: Mut<Ids>, v: Ref<Value>): Extract<ClassMember, { kind: "field" }> {
  return { kind: "field", start: count(field(v, "start")), end: count(field(v, "end")), modifiers: itemsOf(field(v, "modifiers")).map((x97): Modifier => word8(x97)), decorators: itemsOf(field(v, "decorators")).map((x98): Expr => unquoteExpr(ids, x98)), name: unquoteUnion2(ids, field(v, "name")), optional: flag(field(v, "optional")), definite: flag(field(v, "definite")), type: absent(field(v, "type")) ? undefined : unquoteTypeNode(ids, field(v, "type")), init: absent(field(v, "init")) ? undefined : unquoteExpr(ids, field(v, "init")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteClassMember_method(ids: Mut<Ids>, v: Ref<Value>): Extract<ClassMember, { kind: "method" }> {
  return { kind: "method", start: count(field(v, "start")), end: count(field(v, "end")), modifiers: itemsOf(field(v, "modifiers")).map((x99): Modifier => word8(x99)), decorators: itemsOf(field(v, "decorators")).map((x100): Expr => unquoteExpr(ids, x100)), name: unquoteUnion2(ids, field(v, "name")), optional: flag(field(v, "optional")), generator: flag(field(v, "generator")), typeParams: itemsOf(field(v, "typeParams")).map((x101): TypeParam => unquoteTypeParam(ids, x101)), params: itemsOf(field(v, "params")).map((x102): Param => unquoteParam(ids, x102)), returnType: absent(field(v, "returnType")) ? undefined : unquoteTypeNode(ids, field(v, "returnType")), throws: absent(field(v, "throws")) ? undefined : unquoteTypeNode(ids, field(v, "throws")), body: absent(field(v, "body")) ? undefined : itemsOf(field(v, "body")).map((x103): Stmt => unquoteStmt(ids, x103)), overloadNames: absent(field(v, "overloadNames")) ? undefined : itemsOf(field(v, "overloadNames")).map((x104): string => text(x104)), signature: absent(field(v, "signature")) ? undefined : true as const, id: nextId(ids) };
}

/** @throws {Error} */
function unquoteClassMember_constructor(ids: Mut<Ids>, v: Ref<Value>): Extract<ClassMember, { kind: "constructor" }> {
  return { kind: "constructor", start: count(field(v, "start")), end: count(field(v, "end")), modifiers: itemsOf(field(v, "modifiers")).map((x105): Modifier => word8(x105)), decorators: itemsOf(field(v, "decorators")).map((x106): Expr => unquoteExpr(ids, x106)), params: itemsOf(field(v, "params")).map((x107): Param => unquoteParam(ids, x107)), throws: absent(field(v, "throws")) ? undefined : unquoteTypeNode(ids, field(v, "throws")), body: absent(field(v, "body")) ? undefined : itemsOf(field(v, "body")).map((x108): Stmt => unquoteStmt(ids, x108)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteClassMember_get(ids: Mut<Ids>, v: Ref<Value>): Extract<ClassMember, { kind: "get" | "set" }> {
  return { kind: "get", start: count(field(v, "start")), end: count(field(v, "end")), modifiers: itemsOf(field(v, "modifiers")).map((x109): Modifier => word8(x109)), decorators: itemsOf(field(v, "decorators")).map((x110): Expr => unquoteExpr(ids, x110)), name: unquoteUnion2(ids, field(v, "name")), params: itemsOf(field(v, "params")).map((x111): Param => unquoteParam(ids, x111)), returnType: absent(field(v, "returnType")) ? undefined : unquoteTypeNode(ids, field(v, "returnType")), throws: absent(field(v, "throws")) ? undefined : unquoteTypeNode(ids, field(v, "throws")), body: absent(field(v, "body")) ? undefined : itemsOf(field(v, "body")).map((x112): Stmt => unquoteStmt(ids, x112)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteClassMember_set(ids: Mut<Ids>, v: Ref<Value>): Extract<ClassMember, { kind: "get" | "set" }> {
  return { kind: "set", start: count(field(v, "start")), end: count(field(v, "end")), modifiers: itemsOf(field(v, "modifiers")).map((x113): Modifier => word8(x113)), decorators: itemsOf(field(v, "decorators")).map((x114): Expr => unquoteExpr(ids, x114)), name: unquoteUnion2(ids, field(v, "name")), params: itemsOf(field(v, "params")).map((x115): Param => unquoteParam(ids, x115)), returnType: absent(field(v, "returnType")) ? undefined : unquoteTypeNode(ids, field(v, "returnType")), throws: absent(field(v, "throws")) ? undefined : unquoteTypeNode(ids, field(v, "throws")), body: absent(field(v, "body")) ? undefined : itemsOf(field(v, "body")).map((x116): Stmt => unquoteStmt(ids, x116)), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteClassMember_index(ids: Mut<Ids>, v: Ref<Value>): Extract<ClassMember, { kind: "index" }> {
  return { kind: "index", start: count(field(v, "start")), end: count(field(v, "end")), modifiers: itemsOf(field(v, "modifiers")).map((x117): Modifier => word8(x117)), decorators: itemsOf(field(v, "decorators")).map((x118): Expr => unquoteExpr(ids, x118)), params: itemsOf(field(v, "params")).map((x119): Param => unquoteParam(ids, x119)), type: unquoteTypeNode(ids, field(v, "type")), id: nextId(ids) };
}

/** @throws {Error} */
function unquoteClassMember_staticBlock(ids: Mut<Ids>, v: Ref<Value>): Extract<ClassMember, { kind: "staticBlock" }> {
  return { kind: "staticBlock", start: count(field(v, "start")), end: count(field(v, "end")), modifiers: itemsOf(field(v, "modifiers")).map((x120): Modifier => word8(x120)), decorators: itemsOf(field(v, "decorators")).map((x121): Expr => unquoteExpr(ids, x121)), body: itemsOf(field(v, "body")).map((x122): Stmt => unquoteStmt(ids, x122)), id: nextId(ids) };
}

/** @throws {Error} */
function unquotePattern_ident(ids: Mut<Ids>, v: Ref<Value>): Extract<Pattern, { kind: "ident" }> {
  return { kind: "ident", start: count(field(v, "start")), end: count(field(v, "end")), name: text(field(v, "name")), id: nextId(ids) };
}

/** @throws {Error} */
function unquotePattern_object(ids: Mut<Ids>, v: Ref<Value>): Extract<Pattern, { kind: "object" }> {
  return { kind: "object", start: count(field(v, "start")), end: count(field(v, "end")), props: itemsOf(field(v, "props")).map((x125): PatternProp => unquotePatternProp(ids, x125)), rest: absent(field(v, "rest")) ? undefined : unquotePattern(ids, field(v, "rest")), id: nextId(ids) };
}

/** @throws {Error} */
function unquotePattern_array(ids: Mut<Ids>, v: Ref<Value>): Extract<Pattern, { kind: "array" }> {
  return { kind: "array", start: count(field(v, "start")), end: count(field(v, "end")), elements: itemsOf(field(v, "elements")).map((x126): Extract<Pattern, { kind: "array" }>["elements"][usize] => absent(x126) ? undefined : unquotePattern(ids, x126)), rest: absent(field(v, "rest")) ? undefined : unquotePattern(ids, field(v, "rest")), id: nextId(ids) };
}

/** @throws {Error} */
function unquotePattern_default(ids: Mut<Ids>, v: Ref<Value>): Extract<Pattern, { kind: "default" }> {
  return { kind: "default", start: count(field(v, "start")), end: count(field(v, "end")), target: unquotePattern(ids, field(v, "target")), value: unquoteExpr(ids, field(v, "value")), id: nextId(ids) };
}

/** @throws {Error} */
function unquotePattern_expr(ids: Mut<Ids>, v: Ref<Value>): Extract<Pattern, { kind: "expr" }> {
  return { kind: "expr", start: count(field(v, "start")), end: count(field(v, "end")), expr: unquoteExpr(ids, field(v, "expr")), id: nextId(ids) };
}

/** @throws {Error} */
function unquotePattern_wildcard(ids: Mut<Ids>, v: Ref<Value>): Extract<Pattern, { kind: "wildcard" }> {
  return { kind: "wildcard", start: count(field(v, "start")), end: count(field(v, "end")), id: nextId(ids) };
}

/** @throws {Error} */
function unquotePattern_literal(ids: Mut<Ids>, v: Ref<Value>): Extract<Pattern, { kind: "literal" }> {
  return { kind: "literal", start: count(field(v, "start")), end: count(field(v, "end")), value: unquoteExpr(ids, field(v, "value")), id: nextId(ids) };
}

/** @throws {Error} */
function unquotePattern_variant(ids: Mut<Ids>, v: Ref<Value>): Extract<Pattern, { kind: "variant" }> {
  return { kind: "variant", start: count(field(v, "start")), end: count(field(v, "end")), name: text(field(v, "name")), args: absent(field(v, "args")) ? undefined : itemsOf(field(v, "args")).map((x127): Pattern => unquotePattern(ids, x127)), id: nextId(ids) };
}

/** @throws {Error} */
function unquotePattern_or(ids: Mut<Ids>, v: Ref<Value>): Extract<Pattern, { kind: "or" }> {
  return { kind: "or", start: count(field(v, "start")), end: count(field(v, "end")), patterns: itemsOf(field(v, "patterns")).map((x128): Pattern => unquotePattern(ids, x128)), id: nextId(ids) };
}

/** @throws {Error} */
function word0(v: Ref<Value>): "keyof" | "readonly" | "unique" {
  const s = text(v);
  if (s === "keyof") return "keyof";
  if (s === "readonly") return "readonly";
  if (s === "unique") return "unique";
  throw new Error(`internal error: '${s}' where an Ast value names one of 'keyof', 'readonly', 'unique'`);
}

/** @throws {Error} */
function word1(v: Ref<Value>): "+" | "-" {
  const s = text(v);
  if (s === "+") return "+";
  if (s === "-") return "-";
  throw new Error(`internal error: '${s}' where an Ast value names one of '+', '-'`);
}

/** @throws {Error} */
function word2(v: Ref<Value>): "import.meta" | "new.target" {
  const s = text(v);
  if (s === "import.meta") return "import.meta";
  if (s === "new.target") return "new.target";
  throw new Error(`internal error: '${s}' where an Ast value names one of 'import.meta', 'new.target'`);
}

/** @throws {Error} */
function word3(v: Ref<Value>): UnaryOp {
  const s = text(v);
  if (s === "-") return "-";
  if (s === "+") return "+";
  if (s === "!") return "!";
  if (s === "~") return "~";
  if (s === "typeof") return "typeof";
  if (s === "void") return "void";
  if (s === "delete") return "delete";
  if (s === "await") return "await";
  throw new Error(`internal error: '${s}' where an Ast value names one of '-', '+', '!', '~', 'typeof', 'void', 'delete', 'await'`);
}

/** @throws {Error} */
function word4(v: Ref<Value>): "++" | "--" {
  const s = text(v);
  if (s === "++") return "++";
  if (s === "--") return "--";
  throw new Error(`internal error: '${s}' where an Ast value names one of '++', '--'`);
}

/** @throws {Error} */
function word5(v: Ref<Value>): BinaryOp {
  const s = text(v);
  if (s === "??") return "??";
  if (s === "||") return "||";
  if (s === "&&") return "&&";
  if (s === "|") return "|";
  if (s === "^") return "^";
  if (s === "&") return "&";
  if (s === "===") return "===";
  if (s === "!==") return "!==";
  if (s === "==") return "==";
  if (s === "!=") return "!=";
  if (s === "<") return "<";
  if (s === "<=") return "<=";
  if (s === ">") return ">";
  if (s === ">=") return ">=";
  if (s === "instanceof") return "instanceof";
  if (s === "in") return "in";
  if (s === "<<") return "<<";
  if (s === ">>") return ">>";
  if (s === ">>>") return ">>>";
  if (s === "+") return "+";
  if (s === "-") return "-";
  if (s === "*") return "*";
  if (s === "/") return "/";
  if (s === "%") return "%";
  if (s === "**") return "**";
  throw new Error(`internal error: '${s}' where an Ast value names one of '??', '||', '&&', '|', '^', '&', '===', '!==', '==', '!=', '<', '<=', '>', '>=', 'instanceof', 'in', '<<', '>>', '>>>', '+', '-', '*', '/', '%', '**'`);
}

/** @throws {Error} */
function word6(v: Ref<Value>): AssignOp {
  const s = text(v);
  if (s === "=") return "=";
  if (s === "+=") return "+=";
  if (s === "-=") return "-=";
  if (s === "*=") return "*=";
  if (s === "/=") return "/=";
  if (s === "%=") return "%=";
  if (s === "**=") return "**=";
  if (s === "<<=") return "<<=";
  if (s === ">>=") return ">>=";
  if (s === ">>>=") return ">>>=";
  if (s === "&=") return "&=";
  if (s === "|=") return "|=";
  if (s === "^=") return "^=";
  if (s === "&&=") return "&&=";
  if (s === "||=") return "||=";
  if (s === "??=") return "??=";
  throw new Error(`internal error: '${s}' where an Ast value names one of '=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??='`);
}

/** @throws {Error} */
function word7(v: Ref<Value>): "let" | "const" | "var" | "using" {
  const s = text(v);
  if (s === "let") return "let";
  if (s === "const") return "const";
  if (s === "var") return "var";
  if (s === "using") return "using";
  throw new Error(`internal error: '${s}' where an Ast value names one of 'let', 'const', 'var', 'using'`);
}

/** @throws {Error} */
function word8(v: Ref<Value>): Modifier {
  const s = text(v);
  if (s === "public") return "public";
  if (s === "private") return "private";
  if (s === "protected") return "protected";
  if (s === "static") return "static";
  if (s === "readonly") return "readonly";
  if (s === "abstract") return "abstract";
  if (s === "override") return "override";
  if (s === "declare") return "declare";
  if (s === "accessor") return "accessor";
  if (s === "async") return "async";
  throw new Error(`internal error: '${s}' where an Ast value names one of 'public', 'private', 'protected', 'static', 'readonly', 'abstract', 'override', 'declare', 'accessor', 'async'`);
}

/** @throws {Error} */
function word9(v: Ref<Value>): "const" | "in" | "out" {
  const s = text(v);
  if (s === "const") return "const";
  if (s === "in") return "in";
  if (s === "out") return "out";
  throw new Error(`internal error: '${s}' where an Ast value names one of 'const', 'in', 'out'`);
}
