// Generated from the parser's AST types by `bun scripts/dumpgen.ts`; a test fails when it is stale.
import type { TypeNode, Expr, Stmt, TupleElement, PropertyName, TypeMember, ObjectProp, ClassNode, ClassMember, Param, Pattern, MatchArm, PatternProp, Specifier, EnumMember, SwitchCase, Declarator, TypeParam, TypeAlias, Interface, JsName, Func } from "../../src/parser.ts";

export function dumpTypeNode(indent: string, label: string, n: Ref<TypeNode>): void {
  switch (n.kind) {
    case "ref":
      dumpTypeNode_ref(indent, label, n);
      break;
    case "literal":
      dumpTypeNode_literal(indent, label, n);
      break;
    case "array":
      dumpTypeNode_array(indent, label, n);
      break;
    case "tuple":
      dumpTypeNode_tuple(indent, label, n);
      break;
    case "object":
      dumpTypeNode_object(indent, label, n);
      break;
    case "function":
      dumpTypeNode_function(indent, label, n);
      break;
    case "union":
      dumpTypeNode_union(indent, label, n);
      break;
    case "intersection":
      dumpTypeNode_intersection(indent, label, n);
      break;
    case "operator":
      dumpTypeNode_operator(indent, label, n);
      break;
    case "indexed":
      dumpTypeNode_indexed(indent, label, n);
      break;
    case "query":
      dumpTypeNode_query(indent, label, n);
      break;
    case "import":
      dumpTypeNode_import(indent, label, n);
      break;
    case "conditional":
      dumpTypeNode_conditional(indent, label, n);
      break;
    case "infer":
      dumpTypeNode_infer(indent, label, n);
      break;
    case "template":
      dumpTypeNode_template(indent, label, n);
      break;
    case "mapped":
      dumpTypeNode_mapped(indent, label, n);
      break;
    case "predicate":
      dumpTypeNode_predicate(indent, label, n);
      break;
  }
}

export function dumpExpr(indent: string, label: string, n: Ref<Expr>): void {
  switch (n.kind) {
    case "int":
      dumpExpr_int(indent, label, n);
      break;
    case "float":
      dumpExpr_float(indent, label, n);
      break;
    case "bigint":
      dumpExpr_bigint(indent, label, n);
      break;
    case "null":
      dumpExpr_null(indent, label, n);
      break;
    case "this":
      dumpExpr_this(indent, label, n);
      break;
    case "super":
      dumpExpr_super(indent, label, n);
      break;
    case "regex":
      dumpExpr_regex(indent, label, n);
      break;
    case "template":
      dumpExpr_template(indent, label, n);
      break;
    case "tagged":
      dumpExpr_tagged(indent, label, n);
      break;
    case "bool":
      dumpExpr_bool(indent, label, n);
      break;
    case "string":
      dumpExpr_string(indent, label, n);
      break;
    case "ident":
      dumpExpr_ident(indent, label, n);
      break;
    case "spread":
      dumpExpr_spread(indent, label, n);
      break;
    case "array":
      dumpExpr_array(indent, label, n);
      break;
    case "object":
      dumpExpr_object(indent, label, n);
      break;
    case "function":
      dumpExpr_function(indent, label, n);
      break;
    case "arrow":
      dumpExpr_arrow(indent, label, n);
      break;
    case "member":
      dumpExpr_member(indent, label, n);
      break;
    case "index":
      dumpExpr_index(indent, label, n);
      break;
    case "call":
      dumpExpr_call(indent, label, n);
      break;
    case "new":
      dumpExpr_new(indent, label, n);
      break;
    case "instantiation":
      dumpExpr_instantiation(indent, label, n);
      break;
    case "meta":
      dumpExpr_meta(indent, label, n);
      break;
    case "import":
      dumpExpr_import(indent, label, n);
      break;
    case "nonNull":
      dumpExpr_nonNull(indent, label, n);
      break;
    case "throw":
      dumpExpr_throw(indent, label, n);
      break;
    case "class":
      dumpExpr_class(indent, label, n);
      break;
    case "privateName":
      dumpExpr_privateName(indent, label, n);
      break;
    case "unary":
      dumpExpr_unary(indent, label, n);
      break;
    case "update":
      dumpExpr_update(indent, label, n);
      break;
    case "binary":
      dumpExpr_binary(indent, label, n);
      break;
    case "conditional":
      dumpExpr_conditional(indent, label, n);
      break;
    case "assign":
      dumpExpr_assign(indent, label, n);
      break;
    case "pipe":
      dumpExpr_pipe(indent, label, n);
      break;
    case "topic":
      dumpExpr_topic(indent, label, n);
      break;
    case "match":
      dumpExpr_match(indent, label, n);
      break;
    case "comptime":
      dumpExpr_comptime(indent, label, n);
      break;
    case "unsafe":
      dumpExpr_unsafe(indent, label, n);
      break;
    case "destructure":
      dumpExpr_destructure(indent, label, n);
      break;
    case "sequence":
      dumpExpr_sequence(indent, label, n);
      break;
    case "yield":
      dumpExpr_yield(indent, label, n);
      break;
    case "as":
      dumpExpr_as(indent, label, n);
      break;
    case "satisfies":
      dumpExpr_satisfies(indent, label, n);
      break;
    case "assertion":
      dumpExpr_assertion(indent, label, n);
      break;
  }
}

export function dumpStmt(indent: string, label: string, n: Ref<Stmt>): void {
  switch (n.kind) {
    case "expr":
      dumpStmt_expr(indent, label, n);
      break;
    case "let":
      dumpStmt_let(indent, label, n);
      break;
    case "return":
      dumpStmt_return(indent, label, n);
      break;
    case "if":
      dumpStmt_if(indent, label, n);
      break;
    case "while":
      dumpStmt_while(indent, label, n);
      break;
    case "doWhile":
      dumpStmt_doWhile(indent, label, n);
      break;
    case "switch":
      dumpStmt_switch(indent, label, n);
      break;
    case "labeled":
      dumpStmt_labeled(indent, label, n);
      break;
    case "break":
      dumpStmt_break(indent, label, n);
      break;
    case "continue":
      dumpStmt_continue(indent, label, n);
      break;
    case "throw":
      dumpStmt_throw(indent, label, n);
      break;
    case "try":
      dumpStmt_try(indent, label, n);
      break;
    case "for":
      dumpStmt_for(indent, label, n);
      break;
    case "forIn":
      dumpStmt_forIn(indent, label, n);
      break;
    case "forOf":
      dumpStmt_forOf(indent, label, n);
      break;
    case "block":
      dumpStmt_block(indent, label, n);
      break;
    case "empty":
      dumpStmt_empty(indent, label, n);
      break;
    case "debugger":
      dumpStmt_debugger(indent, label, n);
      break;
    case "enum":
      dumpStmt_enum(indent, label, n);
      break;
    case "namespace":
      dumpStmt_namespace(indent, label, n);
      break;
    case "declare":
      dumpStmt_declare(indent, label, n);
      break;
    case "comptime":
      dumpStmt_comptime(indent, label, n);
      break;
    case "unsafe":
      dumpStmt_unsafe(indent, label, n);
      break;
    case "import":
      dumpStmt_import(indent, label, n);
      break;
    case "importEquals":
      dumpStmt_importEquals(indent, label, n);
      break;
    case "export":
      dumpStmt_export(indent, label, n);
      break;
    case "exportDefault":
      dumpStmt_exportDefault(indent, label, n);
      break;
    case "exportNamed":
      dumpStmt_exportNamed(indent, label, n);
      break;
    case "exportAll":
      dumpStmt_exportAll(indent, label, n);
      break;
    case "exportAssign":
      dumpStmt_exportAssign(indent, label, n);
      break;
    case "exportAsNamespace":
      dumpStmt_exportAsNamespace(indent, label, n);
      break;
    case "typeAlias":
      dumpTypeAlias_typeAlias(indent, label, n);
      break;
    case "interface":
      dumpInterface_interface(indent, label, n);
      break;
    case "function":
      dumpFunc_function(indent, label, n);
      break;
    case "class":
      dumpStmt_class(indent, label, n);
      break;
  }
}

export function dumpTupleElement(indent: string, label: string, n: Ref<TupleElement>): void {
  console.log(indent + label + " -");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  if (n.name === undefined) console.log(indent + "  " + "name" + " undefined");
  else {
    console.log(indent + "  " + "name" + " " + JSON.stringify(n.name!));
  }
  console.log(indent + "  " + "optional" + " " + `${n.optional}`);
  console.log(indent + "  " + "rest" + " " + `${n.rest}`);
  dumpTypeNode(indent + "  ", "type", n.type);
}

export function dumpTypeMember(indent: string, label: string, n: Ref<TypeMember>): void {
  switch (n.kind) {
    case "property":
      dumpTypeMember_property(indent, label, n);
      break;
    case "method":
      dumpTypeMember_method(indent, label, n);
      break;
    case "call":
      dumpTypeMember_call(indent, label, n);
      break;
    case "construct":
      dumpTypeMember_construct(indent, label, n);
      break;
    case "index":
      dumpTypeMember_index(indent, label, n);
      break;
    case "get":
      dumpTypeMember_get(indent, label, n);
      break;
    case "set":
      dumpTypeMember_set(indent, label, n);
      break;
  }
}

export function dumpObjectProp(indent: string, label: string, n: Ref<ObjectProp>): void {
  switch (n.kind) {
    case "property":
      dumpObjectProp_property(indent, label, n);
      break;
    case "shorthand":
      dumpObjectProp_shorthand(indent, label, n);
      break;
    case "spread":
      dumpObjectProp_spread(indent, label, n);
      break;
    case "method":
      dumpObjectProp_method(indent, label, n);
      break;
    case "get":
      dumpObjectProp_get(indent, label, n);
      break;
    case "set":
      dumpObjectProp_set(indent, label, n);
      break;
  }
}

export function dumpClassNode(indent: string, label: string, n: Ref<ClassNode>): void {
  console.log(indent + label + " -");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  if (n.name === undefined) console.log(indent + "  " + "name" + " undefined");
  else {
    console.log(indent + "  " + "name" + " " + JSON.stringify(n.name!));
  }
  console.log(indent + "  " + "abstract" + " " + `${n.abstract}`);
  console.log(indent + "  " + "decorators" + ` [${n.decorators.length}]`);
  for (const x91 of n.decorators) {
    dumpExpr(indent + "  " + "  ", "-", x91);
  }
  console.log(indent + "  " + "typeParams" + ` [${n.typeParams.length}]`);
  for (const x92 of n.typeParams) {
    dumpTypeParam(indent + "  " + "  ", "-", x92);
  }
  if (n.extends === undefined) console.log(indent + "  " + "extends" + " undefined");
  else {
    dumpExpr(indent + "  ", "extends", n.extends!);
  }
  console.log(indent + "  " + "implements" + ` [${n.implements.length}]`);
  for (const x93 of n.implements) {
    dumpTypeNode(indent + "  " + "  ", "-", x93);
  }
  console.log(indent + "  " + "members" + ` [${n.members.length}]`);
  for (const x94 of n.members) {
    dumpClassMember(indent + "  " + "  ", "-", x94);
  }
  if (n.derives === undefined) console.log(indent + "  " + "derives" + " undefined");
  else {
    console.log(indent + "  " + "derives" + ` [${n.derives!.length}]`);
    for (const x95 of n.derives!) {
      console.log(indent + "  " + "  " + "-" + " " + JSON.stringify(x95));
    }
  }
}

export function dumpClassMember(indent: string, label: string, n: Ref<ClassMember>): void {
  switch (n.kind) {
    case "field":
      dumpClassMember_field(indent, label, n);
      break;
    case "method":
      dumpClassMember_method(indent, label, n);
      break;
    case "constructor":
      dumpClassMember_constructor(indent, label, n);
      break;
    case "get":
      dumpClassMember_get(indent, label, n);
      break;
    case "set":
      dumpClassMember_set(indent, label, n);
      break;
    case "index":
      dumpClassMember_index(indent, label, n);
      break;
    case "staticBlock":
      dumpClassMember_staticBlock(indent, label, n);
      break;
  }
}

export function dumpParam(indent: string, label: string, n: Ref<Param>): void {
  console.log(indent + label + " -");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpPattern(indent + "  ", "pattern", n.pattern);
  if (n.type === undefined) console.log(indent + "  " + "type" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "type", n.type!);
  }
  console.log(indent + "  " + "optional" + " " + `${n.optional}`);
  console.log(indent + "  " + "rest" + " " + `${n.rest}`);
  if (n.default === undefined) console.log(indent + "  " + "default" + " undefined");
  else {
    dumpExpr(indent + "  ", "default", n.default!);
  }
  console.log(indent + "  " + "modifiers" + ` [${n.modifiers.length}]`);
  for (const x121 of n.modifiers) {
    console.log(indent + "  " + "  " + "-" + " " + JSON.stringify(x121));
  }
  console.log(indent + "  " + "decorators" + ` [${n.decorators.length}]`);
  for (const x122 of n.decorators) {
    dumpExpr(indent + "  " + "  ", "-", x122);
  }
  console.log(indent + "  " + "comptime" + " " + `${n.comptime}`);
}

export function dumpPattern(indent: string, label: string, n: Ref<Pattern>): void {
  switch (n.kind) {
    case "ident":
      dumpPattern_ident(indent, label, n);
      break;
    case "object":
      dumpPattern_object(indent, label, n);
      break;
    case "array":
      dumpPattern_array(indent, label, n);
      break;
    case "default":
      dumpPattern_default(indent, label, n);
      break;
    case "expr":
      dumpPattern_expr(indent, label, n);
      break;
    case "wildcard":
      dumpPattern_wildcard(indent, label, n);
      break;
    case "literal":
      dumpPattern_literal(indent, label, n);
      break;
    case "variant":
      dumpPattern_variant(indent, label, n);
      break;
    case "or":
      dumpPattern_or(indent, label, n);
      break;
  }
}

export function dumpMatchArm(indent: string, label: string, n: Ref<MatchArm>): void {
  console.log(indent + label + " -");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpPattern(indent + "  ", "pattern", n.pattern);
  if (n.guard === undefined) console.log(indent + "  " + "guard" + " undefined");
  else {
    dumpExpr(indent + "  ", "guard", n.guard!);
  }
  dumpUnion3(indent + "  ", "body", n.body);
}

export function dumpPatternProp(indent: string, label: string, n: Ref<PatternProp>): void {
  console.log(indent + label + " -");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpUnion2(indent + "  ", "key", n.key);
  dumpPattern(indent + "  ", "value", n.value);
}

export function dumpSpecifier(indent: string, label: string, n: Ref<Specifier>): void {
  console.log(indent + label + " -");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
  if (n.alias === undefined) console.log(indent + "  " + "alias" + " undefined");
  else {
    console.log(indent + "  " + "alias" + " " + JSON.stringify(n.alias!));
  }
  console.log(indent + "  " + "typeOnly" + " " + `${n.typeOnly}`);
}

export function dumpEnumMember(indent: string, label: string, n: Ref<EnumMember>): void {
  console.log(indent + label + " -");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
  if (n.init === undefined) console.log(indent + "  " + "init" + " undefined");
  else {
    dumpExpr(indent + "  ", "init", n.init!);
  }
  if (n.payload === undefined) console.log(indent + "  " + "payload" + " undefined");
  else {
    console.log(indent + "  " + "payload" + ` [${n.payload!.length}]`);
    for (const x127 of n.payload!) {
      dumpTypeNode(indent + "  " + "  ", "-", x127);
    }
  }
}

export function dumpSwitchCase(indent: string, label: string, n: Ref<SwitchCase>): void {
  console.log(indent + label + " -");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  if (n.test === undefined) console.log(indent + "  " + "test" + " undefined");
  else {
    dumpExpr(indent + "  ", "test", n.test!);
  }
  console.log(indent + "  " + "body" + ` [${n.body.length}]`);
  for (const x128 of n.body) {
    dumpStmt(indent + "  " + "  ", "-", x128);
  }
}

export function dumpDeclarator(indent: string, label: string, n: Ref<Declarator>): void {
  console.log(indent + label + " -");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpPattern(indent + "  ", "target", n.target);
  if (n.type === undefined) console.log(indent + "  " + "type" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "type", n.type!);
  }
  if (n.init === undefined) console.log(indent + "  " + "init" + " undefined");
  else {
    dumpExpr(indent + "  ", "init", n.init!);
  }
}

export function dumpTypeParam(indent: string, label: string, n: Ref<TypeParam>): void {
  console.log(indent + label + " -");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
  if (n.constraint === undefined) console.log(indent + "  " + "constraint" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "constraint", n.constraint!);
  }
  if (n.default === undefined) console.log(indent + "  " + "default" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "default", n.default!);
  }
  console.log(indent + "  " + "modifiers" + ` [${n.modifiers.length}]`);
  for (const x129 of n.modifiers) {
    console.log(indent + "  " + "  " + "-" + " " + JSON.stringify(x129));
  }
}

export function dumpTypeAlias(indent: string, label: string, n: Ref<TypeAlias>): void {
  switch (n.kind) {
    case "typeAlias":
      dumpTypeAlias_typeAlias(indent, label, n);
      break;
  }
}

export function dumpInterface(indent: string, label: string, n: Ref<Interface>): void {
  switch (n.kind) {
    case "interface":
      dumpInterface_interface(indent, label, n);
      break;
  }
}

export function dumpJsName(indent: string, label: string, n: Ref<JsName>): void {
  console.log(indent + label + " -");
  console.log(indent + "  " + "module" + " " + JSON.stringify(n.module));
  console.log(indent + "  " + "package" + " " + `${n.package}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
  if (n.const === undefined) console.log(indent + "  " + "const" + " undefined");
  else {
    console.log(indent + "  " + "const" + " " + `${n.const!}`);
  }
  if (n.overloads === undefined) console.log(indent + "  " + "overloads" + " undefined");
  else {
    console.log(indent + "  " + "overloads" + ` [${n.overloads!.length}]`);
    for (const x130 of n.overloads!) {
      dumpFunc(indent + "  " + "  ", "-", x130);
    }
  }
}

export function dumpFunc(indent: string, label: string, n: Ref<Func>): void {
  switch (n.kind) {
    case "function":
      dumpFunc_function(indent, label, n);
      break;
  }
}

export function dumpUnion0(indent: string, label: string, n: Ref<Expr | Stmt[]>): void {
  if (Array.isArray(n)) {
    console.log(indent + label + ` [${n.length}]`);
    for (const x131 of n) {
      dumpStmt(indent + "  ", "-", x131);
    }
    return;
  }
  dumpExpr(indent, label, n);
}

export function dumpUnion1(indent: string, label: string, n: Ref<Stmt | Pattern>): void {
  switch (n.kind) {
    case "expr":
      dumpStmt_expr(indent, label, n);
      break;
    case "let":
      dumpStmt_let(indent, label, n);
      break;
    case "return":
      dumpStmt_return(indent, label, n);
      break;
    case "if":
      dumpStmt_if(indent, label, n);
      break;
    case "while":
      dumpStmt_while(indent, label, n);
      break;
    case "doWhile":
      dumpStmt_doWhile(indent, label, n);
      break;
    case "switch":
      dumpStmt_switch(indent, label, n);
      break;
    case "labeled":
      dumpStmt_labeled(indent, label, n);
      break;
    case "break":
      dumpStmt_break(indent, label, n);
      break;
    case "continue":
      dumpStmt_continue(indent, label, n);
      break;
    case "throw":
      dumpStmt_throw(indent, label, n);
      break;
    case "try":
      dumpStmt_try(indent, label, n);
      break;
    case "for":
      dumpStmt_for(indent, label, n);
      break;
    case "forIn":
      dumpStmt_forIn(indent, label, n);
      break;
    case "forOf":
      dumpStmt_forOf(indent, label, n);
      break;
    case "block":
      dumpStmt_block(indent, label, n);
      break;
    case "empty":
      dumpStmt_empty(indent, label, n);
      break;
    case "debugger":
      dumpStmt_debugger(indent, label, n);
      break;
    case "enum":
      dumpStmt_enum(indent, label, n);
      break;
    case "namespace":
      dumpStmt_namespace(indent, label, n);
      break;
    case "declare":
      dumpStmt_declare(indent, label, n);
      break;
    case "comptime":
      dumpStmt_comptime(indent, label, n);
      break;
    case "unsafe":
      dumpStmt_unsafe(indent, label, n);
      break;
    case "import":
      dumpStmt_import(indent, label, n);
      break;
    case "importEquals":
      dumpStmt_importEquals(indent, label, n);
      break;
    case "export":
      dumpStmt_export(indent, label, n);
      break;
    case "exportDefault":
      dumpStmt_exportDefault(indent, label, n);
      break;
    case "exportNamed":
      dumpStmt_exportNamed(indent, label, n);
      break;
    case "exportAll":
      dumpStmt_exportAll(indent, label, n);
      break;
    case "exportAssign":
      dumpStmt_exportAssign(indent, label, n);
      break;
    case "exportAsNamespace":
      dumpStmt_exportAsNamespace(indent, label, n);
      break;
    case "typeAlias":
      dumpTypeAlias_typeAlias(indent, label, n);
      break;
    case "interface":
      dumpInterface_interface(indent, label, n);
      break;
    case "function":
      dumpFunc_function(indent, label, n);
      break;
    case "class":
      dumpStmt_class(indent, label, n);
      break;
    case "ident":
      dumpPattern_ident(indent, label, n);
      break;
    case "object":
      dumpPattern_object(indent, label, n);
      break;
    case "array":
      dumpPattern_array(indent, label, n);
      break;
    case "default":
      dumpPattern_default(indent, label, n);
      break;
    case "wildcard":
      dumpPattern_wildcard(indent, label, n);
      break;
    case "literal":
      dumpPattern_literal(indent, label, n);
      break;
    case "variant":
      dumpPattern_variant(indent, label, n);
      break;
    case "or":
      dumpPattern_or(indent, label, n);
      break;
  }
}

export function dumpUnion2(indent: string, label: string, n: Ref<PropertyName>): void {
  if (typeof n === "string") {
    console.log(indent + label + " " + JSON.stringify(n));
    return;
  }
  dumpExpr(indent, label, n);
}

export function dumpUnion3(indent: string, label: string, n: Ref<Expr | Extract<Stmt, { kind: "block" }>>): void {
  switch (n.kind) {
    case "int":
      dumpExpr_int(indent, label, n);
      break;
    case "float":
      dumpExpr_float(indent, label, n);
      break;
    case "bigint":
      dumpExpr_bigint(indent, label, n);
      break;
    case "null":
      dumpExpr_null(indent, label, n);
      break;
    case "this":
      dumpExpr_this(indent, label, n);
      break;
    case "super":
      dumpExpr_super(indent, label, n);
      break;
    case "regex":
      dumpExpr_regex(indent, label, n);
      break;
    case "template":
      dumpExpr_template(indent, label, n);
      break;
    case "tagged":
      dumpExpr_tagged(indent, label, n);
      break;
    case "bool":
      dumpExpr_bool(indent, label, n);
      break;
    case "string":
      dumpExpr_string(indent, label, n);
      break;
    case "ident":
      dumpExpr_ident(indent, label, n);
      break;
    case "spread":
      dumpExpr_spread(indent, label, n);
      break;
    case "array":
      dumpExpr_array(indent, label, n);
      break;
    case "object":
      dumpExpr_object(indent, label, n);
      break;
    case "function":
      dumpExpr_function(indent, label, n);
      break;
    case "arrow":
      dumpExpr_arrow(indent, label, n);
      break;
    case "member":
      dumpExpr_member(indent, label, n);
      break;
    case "index":
      dumpExpr_index(indent, label, n);
      break;
    case "call":
      dumpExpr_call(indent, label, n);
      break;
    case "new":
      dumpExpr_new(indent, label, n);
      break;
    case "instantiation":
      dumpExpr_instantiation(indent, label, n);
      break;
    case "meta":
      dumpExpr_meta(indent, label, n);
      break;
    case "import":
      dumpExpr_import(indent, label, n);
      break;
    case "nonNull":
      dumpExpr_nonNull(indent, label, n);
      break;
    case "throw":
      dumpExpr_throw(indent, label, n);
      break;
    case "class":
      dumpExpr_class(indent, label, n);
      break;
    case "privateName":
      dumpExpr_privateName(indent, label, n);
      break;
    case "unary":
      dumpExpr_unary(indent, label, n);
      break;
    case "update":
      dumpExpr_update(indent, label, n);
      break;
    case "binary":
      dumpExpr_binary(indent, label, n);
      break;
    case "conditional":
      dumpExpr_conditional(indent, label, n);
      break;
    case "assign":
      dumpExpr_assign(indent, label, n);
      break;
    case "pipe":
      dumpExpr_pipe(indent, label, n);
      break;
    case "topic":
      dumpExpr_topic(indent, label, n);
      break;
    case "match":
      dumpExpr_match(indent, label, n);
      break;
    case "comptime":
      dumpExpr_comptime(indent, label, n);
      break;
    case "unsafe":
      dumpExpr_unsafe(indent, label, n);
      break;
    case "destructure":
      dumpExpr_destructure(indent, label, n);
      break;
    case "sequence":
      dumpExpr_sequence(indent, label, n);
      break;
    case "yield":
      dumpExpr_yield(indent, label, n);
      break;
    case "as":
      dumpExpr_as(indent, label, n);
      break;
    case "satisfies":
      dumpExpr_satisfies(indent, label, n);
      break;
    case "assertion":
      dumpExpr_assertion(indent, label, n);
      break;
    case "block":
      dumpStmt_block(indent, label, n);
      break;
  }
}

export function dumpTypeNode_ref(indent: string, label: string, n: Ref<Extract<TypeNode, { kind: "ref" }>>): void {
  console.log(indent + label + " " + "ref");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
  console.log(indent + "  " + "args" + ` [${n.args.length}]`);
  for (const x1 of n.args) {
    dumpTypeNode(indent + "  " + "  ", "-", x1);
  }
}

export function dumpTypeNode_literal(indent: string, label: string, n: Ref<Extract<TypeNode, { kind: "literal" }>>): void {
  console.log(indent + label + " " + "literal");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "value", n.value);
}

export function dumpTypeNode_array(indent: string, label: string, n: Ref<Extract<TypeNode, { kind: "array" }>>): void {
  console.log(indent + label + " " + "array");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpTypeNode(indent + "  ", "element", n.element);
}

export function dumpTypeNode_tuple(indent: string, label: string, n: Ref<Extract<TypeNode, { kind: "tuple" }>>): void {
  console.log(indent + label + " " + "tuple");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "elements" + ` [${n.elements.length}]`);
  for (const x2 of n.elements) {
    dumpTupleElement(indent + "  " + "  ", "-", x2);
  }
}

export function dumpTypeNode_object(indent: string, label: string, n: Ref<Extract<TypeNode, { kind: "object" }>>): void {
  console.log(indent + label + " " + "object");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "members" + ` [${n.members.length}]`);
  for (const x3 of n.members) {
    dumpTypeMember(indent + "  " + "  ", "-", x3);
  }
}

export function dumpTypeNode_function(indent: string, label: string, n: Ref<Extract<TypeNode, { kind: "function" }>>): void {
  console.log(indent + label + " " + "function");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "typeParams" + ` [${n.typeParams.length}]`);
  for (const x4 of n.typeParams) {
    dumpTypeParam(indent + "  " + "  ", "-", x4);
  }
  console.log(indent + "  " + "params" + ` [${n.params.length}]`);
  for (const x5 of n.params) {
    dumpParam(indent + "  " + "  ", "-", x5);
  }
  dumpTypeNode(indent + "  ", "returns", n.returns);
  if (n.throws === undefined) console.log(indent + "  " + "throws" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "throws", n.throws!);
  }
  console.log(indent + "  " + "construct" + " " + `${n.construct}`);
  console.log(indent + "  " + "abstract" + " " + `${n.abstract}`);
}

export function dumpTypeNode_union(indent: string, label: string, n: Ref<Extract<TypeNode, { kind: "union" | "intersection" }>>): void {
  console.log(indent + label + " " + "union");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "types" + ` [${n.types.length}]`);
  for (const x6 of n.types) {
    dumpTypeNode(indent + "  " + "  ", "-", x6);
  }
}

export function dumpTypeNode_intersection(indent: string, label: string, n: Ref<Extract<TypeNode, { kind: "union" | "intersection" }>>): void {
  console.log(indent + label + " " + "intersection");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "types" + ` [${n.types.length}]`);
  for (const x7 of n.types) {
    dumpTypeNode(indent + "  " + "  ", "-", x7);
  }
}

export function dumpTypeNode_operator(indent: string, label: string, n: Ref<Extract<TypeNode, { kind: "operator" }>>): void {
  console.log(indent + label + " " + "operator");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "op" + " " + JSON.stringify(n.op));
  dumpTypeNode(indent + "  ", "type", n.type);
}

export function dumpTypeNode_indexed(indent: string, label: string, n: Ref<Extract<TypeNode, { kind: "indexed" }>>): void {
  console.log(indent + label + " " + "indexed");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpTypeNode(indent + "  ", "object", n.object);
  dumpTypeNode(indent + "  ", "index", n.index);
}

export function dumpTypeNode_query(indent: string, label: string, n: Ref<Extract<TypeNode, { kind: "query" }>>): void {
  console.log(indent + label + " " + "query");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpTypeNode(indent + "  ", "target", n.target);
}

export function dumpTypeNode_import(indent: string, label: string, n: Ref<Extract<TypeNode, { kind: "import" }>>): void {
  console.log(indent + label + " " + "import");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "module" + " " + JSON.stringify(n.module));
  if (n.name === undefined) console.log(indent + "  " + "name" + " undefined");
  else {
    console.log(indent + "  " + "name" + " " + JSON.stringify(n.name!));
  }
  console.log(indent + "  " + "args" + ` [${n.args.length}]`);
  for (const x8 of n.args) {
    dumpTypeNode(indent + "  " + "  ", "-", x8);
  }
}

export function dumpTypeNode_conditional(indent: string, label: string, n: Ref<Extract<TypeNode, { kind: "conditional" }>>): void {
  console.log(indent + label + " " + "conditional");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpTypeNode(indent + "  ", "check", n.check);
  dumpTypeNode(indent + "  ", "extends", n.extends);
  dumpTypeNode(indent + "  ", "then", n.then);
  dumpTypeNode(indent + "  ", "else", n.else);
}

export function dumpTypeNode_infer(indent: string, label: string, n: Ref<Extract<TypeNode, { kind: "infer" }>>): void {
  console.log(indent + label + " " + "infer");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
  if (n.constraint === undefined) console.log(indent + "  " + "constraint" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "constraint", n.constraint!);
  }
}

export function dumpTypeNode_template(indent: string, label: string, n: Ref<Extract<TypeNode, { kind: "template" }>>): void {
  console.log(indent + label + " " + "template");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "quasis" + ` [${n.quasis.length}]`);
  for (const x9 of n.quasis) {
    console.log(indent + "  " + "  " + "-" + " " + JSON.stringify(x9));
  }
  console.log(indent + "  " + "types" + ` [${n.types.length}]`);
  for (const x10 of n.types) {
    dumpTypeNode(indent + "  " + "  ", "-", x10);
  }
}

export function dumpTypeNode_mapped(indent: string, label: string, n: Ref<Extract<TypeNode, { kind: "mapped" }>>): void {
  console.log(indent + label + " " + "mapped");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
  dumpTypeNode(indent + "  ", "constraint", n.constraint);
  if (n.as === undefined) console.log(indent + "  " + "as" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "as", n.as!);
  }
  if (n.type === undefined) console.log(indent + "  " + "type" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "type", n.type!);
  }
  if (n.readonly === undefined) console.log(indent + "  " + "readonly" + " undefined");
  else {
    console.log(indent + "  " + "readonly" + " " + JSON.stringify(n.readonly!));
  }
  if (n.optional === undefined) console.log(indent + "  " + "optional" + " undefined");
  else {
    console.log(indent + "  " + "optional" + " " + JSON.stringify(n.optional!));
  }
}

export function dumpTypeNode_predicate(indent: string, label: string, n: Ref<Extract<TypeNode, { kind: "predicate" }>>): void {
  console.log(indent + label + " " + "predicate");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "asserts" + " " + `${n.asserts}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
  if (n.type === undefined) console.log(indent + "  " + "type" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "type", n.type!);
  }
}

export function dumpExpr_int(indent: string, label: string, n: Ref<Extract<Expr, { kind: "int" }>>): void {
  console.log(indent + label + " " + "int");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "value" + " " + `${n.value}n`);
}

export function dumpExpr_float(indent: string, label: string, n: Ref<Extract<Expr, { kind: "float" }>>): void {
  console.log(indent + label + " " + "float");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "value" + " " + `${n.value}`);
}

export function dumpExpr_bigint(indent: string, label: string, n: Ref<Extract<Expr, { kind: "bigint" }>>): void {
  console.log(indent + label + " " + "bigint");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "value" + " " + `${n.value}n`);
}

export function dumpExpr_null(indent: string, label: string, n: Ref<Extract<Expr, { kind: "null" }>>): void {
  console.log(indent + label + " " + "null");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
}

export function dumpExpr_this(indent: string, label: string, n: Ref<Extract<Expr, { kind: "this" }>>): void {
  console.log(indent + label + " " + "this");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
}

export function dumpExpr_super(indent: string, label: string, n: Ref<Extract<Expr, { kind: "super" }>>): void {
  console.log(indent + label + " " + "super");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
}

export function dumpExpr_regex(indent: string, label: string, n: Ref<Extract<Expr, { kind: "regex" }>>): void {
  console.log(indent + label + " " + "regex");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "pattern" + " " + JSON.stringify(n.pattern));
  console.log(indent + "  " + "flags" + " " + JSON.stringify(n.flags));
}

export function dumpExpr_template(indent: string, label: string, n: Ref<Extract<Expr, { kind: "template" }>>): void {
  console.log(indent + label + " " + "template");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "quasis" + ` [${n.quasis.length}]`);
  for (const x11 of n.quasis) {
    console.log(indent + "  " + "  " + "-" + " " + JSON.stringify(x11));
  }
  console.log(indent + "  " + "raw" + ` [${n.raw.length}]`);
  for (const x12 of n.raw) {
    console.log(indent + "  " + "  " + "-" + " " + JSON.stringify(x12));
  }
  console.log(indent + "  " + "exprs" + ` [${n.exprs.length}]`);
  for (const x13 of n.exprs) {
    dumpExpr(indent + "  " + "  ", "-", x13);
  }
}

export function dumpExpr_tagged(indent: string, label: string, n: Ref<Extract<Expr, { kind: "tagged" }>>): void {
  console.log(indent + label + " " + "tagged");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "tag", n.tag);
  console.log(indent + "  " + "typeArgs" + ` [${n.typeArgs.length}]`);
  for (const x14 of n.typeArgs) {
    dumpTypeNode(indent + "  " + "  ", "-", x14);
  }
  dumpExpr(indent + "  ", "template", n.template);
}

export function dumpExpr_bool(indent: string, label: string, n: Ref<Extract<Expr, { kind: "bool" }>>): void {
  console.log(indent + label + " " + "bool");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "value" + " " + `${n.value}`);
}

export function dumpExpr_string(indent: string, label: string, n: Ref<Extract<Expr, { kind: "string" }>>): void {
  console.log(indent + label + " " + "string");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "value" + " " + JSON.stringify(n.value));
}

export function dumpExpr_ident(indent: string, label: string, n: Ref<Extract<Expr, { kind: "ident" }>>): void {
  console.log(indent + label + " " + "ident");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
}

export function dumpExpr_spread(indent: string, label: string, n: Ref<Extract<Expr, { kind: "spread" }>>): void {
  console.log(indent + label + " " + "spread");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "value", n.value);
}

export function dumpExpr_array(indent: string, label: string, n: Ref<Extract<Expr, { kind: "array" }>>): void {
  console.log(indent + label + " " + "array");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "elements" + ` [${n.elements.length}]`);
  for (const x15 of n.elements) {
    if (x15 === undefined) console.log(indent + "  " + "  " + "-" + " undefined");
    else {
      dumpExpr(indent + "  " + "  ", "-", x15!);
    }
  }
}

export function dumpExpr_object(indent: string, label: string, n: Ref<Extract<Expr, { kind: "object" }>>): void {
  console.log(indent + label + " " + "object");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "props" + ` [${n.props.length}]`);
  for (const x16 of n.props) {
    dumpObjectProp(indent + "  " + "  ", "-", x16);
  }
}

export function dumpExpr_function(indent: string, label: string, n: Ref<Extract<Expr, { kind: "function" }>>): void {
  console.log(indent + label + " " + "function");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  if (n.name === undefined) console.log(indent + "  " + "name" + " undefined");
  else {
    console.log(indent + "  " + "name" + " " + JSON.stringify(n.name!));
  }
  console.log(indent + "  " + "async" + " " + `${n.async}`);
  console.log(indent + "  " + "generator" + " " + `${n.generator}`);
  console.log(indent + "  " + "typeParams" + ` [${n.typeParams.length}]`);
  for (const x17 of n.typeParams) {
    dumpTypeParam(indent + "  " + "  ", "-", x17);
  }
  console.log(indent + "  " + "params" + ` [${n.params.length}]`);
  for (const x18 of n.params) {
    dumpParam(indent + "  " + "  ", "-", x18);
  }
  if (n.returnType === undefined) console.log(indent + "  " + "returnType" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "returnType", n.returnType!);
  }
  console.log(indent + "  " + "body" + ` [${n.body.length}]`);
  for (const x19 of n.body) {
    dumpStmt(indent + "  " + "  ", "-", x19);
  }
}

export function dumpExpr_arrow(indent: string, label: string, n: Ref<Extract<Expr, { kind: "arrow" }>>): void {
  console.log(indent + label + " " + "arrow");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "move" + " " + `${n.move}`);
  console.log(indent + "  " + "async" + " " + `${n.async}`);
  console.log(indent + "  " + "typeParams" + ` [${n.typeParams.length}]`);
  for (const x20 of n.typeParams) {
    dumpTypeParam(indent + "  " + "  ", "-", x20);
  }
  console.log(indent + "  " + "params" + ` [${n.params.length}]`);
  for (const x21 of n.params) {
    dumpParam(indent + "  " + "  ", "-", x21);
  }
  if (n.returnType === undefined) console.log(indent + "  " + "returnType" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "returnType", n.returnType!);
  }
  if (n.throws === undefined) console.log(indent + "  " + "throws" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "throws", n.throws!);
  }
  dumpUnion0(indent + "  ", "body", n.body);
}

export function dumpExpr_member(indent: string, label: string, n: Ref<Extract<Expr, { kind: "member" }>>): void {
  console.log(indent + label + " " + "member");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "object", n.object);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
  console.log(indent + "  " + "optional" + " " + `${n.optional}`);
}

export function dumpExpr_index(indent: string, label: string, n: Ref<Extract<Expr, { kind: "index" }>>): void {
  console.log(indent + label + " " + "index");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "object", n.object);
  dumpExpr(indent + "  ", "index", n.index);
  console.log(indent + "  " + "optional" + " " + `${n.optional}`);
}

export function dumpExpr_call(indent: string, label: string, n: Ref<Extract<Expr, { kind: "call" }>>): void {
  console.log(indent + label + " " + "call");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "callee", n.callee);
  console.log(indent + "  " + "typeArgs" + ` [${n.typeArgs.length}]`);
  for (const x22 of n.typeArgs) {
    dumpTypeNode(indent + "  " + "  ", "-", x22);
  }
  console.log(indent + "  " + "args" + ` [${n.args.length}]`);
  for (const x23 of n.args) {
    dumpExpr(indent + "  " + "  ", "-", x23);
  }
  console.log(indent + "  " + "optional" + " " + `${n.optional}`);
}

export function dumpExpr_new(indent: string, label: string, n: Ref<Extract<Expr, { kind: "new" }>>): void {
  console.log(indent + label + " " + "new");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "callee", n.callee);
  console.log(indent + "  " + "typeArgs" + ` [${n.typeArgs.length}]`);
  for (const x24 of n.typeArgs) {
    dumpTypeNode(indent + "  " + "  ", "-", x24);
  }
  if (n.args === undefined) console.log(indent + "  " + "args" + " undefined");
  else {
    console.log(indent + "  " + "args" + ` [${n.args!.length}]`);
    for (const x25 of n.args!) {
      dumpExpr(indent + "  " + "  ", "-", x25);
    }
  }
}

export function dumpExpr_instantiation(indent: string, label: string, n: Ref<Extract<Expr, { kind: "instantiation" }>>): void {
  console.log(indent + label + " " + "instantiation");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "expr", n.expr);
  console.log(indent + "  " + "typeArgs" + ` [${n.typeArgs.length}]`);
  for (const x26 of n.typeArgs) {
    dumpTypeNode(indent + "  " + "  ", "-", x26);
  }
}

export function dumpExpr_meta(indent: string, label: string, n: Ref<Extract<Expr, { kind: "meta" }>>): void {
  console.log(indent + label + " " + "meta");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
}

export function dumpExpr_import(indent: string, label: string, n: Ref<Extract<Expr, { kind: "import" }>>): void {
  console.log(indent + label + " " + "import");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "args" + ` [${n.args.length}]`);
  for (const x27 of n.args) {
    dumpExpr(indent + "  " + "  ", "-", x27);
  }
}

export function dumpExpr_nonNull(indent: string, label: string, n: Ref<Extract<Expr, { kind: "nonNull" }>>): void {
  console.log(indent + label + " " + "nonNull");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "expr", n.expr);
  if (n.narrows === undefined) console.log(indent + "  " + "narrows" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "narrows", n.narrows!);
  }
}

export function dumpExpr_throw(indent: string, label: string, n: Ref<Extract<Expr, { kind: "throw" }>>): void {
  console.log(indent + label + " " + "throw");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "value", n.value);
}

export function dumpExpr_class(indent: string, label: string, n: Ref<Extract<Expr, { kind: "class" }>>): void {
  console.log(indent + label + " " + "class");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  if (n.name === undefined) console.log(indent + "  " + "name" + " undefined");
  else {
    console.log(indent + "  " + "name" + " " + JSON.stringify(n.name!));
  }
  console.log(indent + "  " + "abstract" + " " + `${n.abstract}`);
  console.log(indent + "  " + "decorators" + ` [${n.decorators.length}]`);
  for (const x28 of n.decorators) {
    dumpExpr(indent + "  " + "  ", "-", x28);
  }
  console.log(indent + "  " + "typeParams" + ` [${n.typeParams.length}]`);
  for (const x29 of n.typeParams) {
    dumpTypeParam(indent + "  " + "  ", "-", x29);
  }
  if (n.extends === undefined) console.log(indent + "  " + "extends" + " undefined");
  else {
    dumpExpr(indent + "  ", "extends", n.extends!);
  }
  console.log(indent + "  " + "implements" + ` [${n.implements.length}]`);
  for (const x30 of n.implements) {
    dumpTypeNode(indent + "  " + "  ", "-", x30);
  }
  console.log(indent + "  " + "members" + ` [${n.members.length}]`);
  for (const x31 of n.members) {
    dumpClassMember(indent + "  " + "  ", "-", x31);
  }
  if (n.derives === undefined) console.log(indent + "  " + "derives" + " undefined");
  else {
    console.log(indent + "  " + "derives" + ` [${n.derives!.length}]`);
    for (const x32 of n.derives!) {
      console.log(indent + "  " + "  " + "-" + " " + JSON.stringify(x32));
    }
  }
}

export function dumpExpr_privateName(indent: string, label: string, n: Ref<Extract<Expr, { kind: "privateName" }>>): void {
  console.log(indent + label + " " + "privateName");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
}

export function dumpExpr_unary(indent: string, label: string, n: Ref<Extract<Expr, { kind: "unary" }>>): void {
  console.log(indent + label + " " + "unary");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "op" + " " + JSON.stringify(n.op));
  dumpExpr(indent + "  ", "operand", n.operand);
}

export function dumpExpr_update(indent: string, label: string, n: Ref<Extract<Expr, { kind: "update" }>>): void {
  console.log(indent + label + " " + "update");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "op" + " " + JSON.stringify(n.op));
  console.log(indent + "  " + "prefix" + " " + `${n.prefix}`);
  dumpExpr(indent + "  ", "operand", n.operand);
}

export function dumpExpr_binary(indent: string, label: string, n: Ref<Extract<Expr, { kind: "binary" }>>): void {
  console.log(indent + label + " " + "binary");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "op" + " " + JSON.stringify(n.op));
  dumpExpr(indent + "  ", "left", n.left);
  dumpExpr(indent + "  ", "right", n.right);
}

export function dumpExpr_conditional(indent: string, label: string, n: Ref<Extract<Expr, { kind: "conditional" }>>): void {
  console.log(indent + label + " " + "conditional");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "cond", n.cond);
  dumpExpr(indent + "  ", "then", n.then);
  dumpExpr(indent + "  ", "else", n.else);
}

export function dumpExpr_assign(indent: string, label: string, n: Ref<Extract<Expr, { kind: "assign" }>>): void {
  console.log(indent + label + " " + "assign");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "op" + " " + JSON.stringify(n.op));
  dumpExpr(indent + "  ", "target", n.target);
  dumpExpr(indent + "  ", "value", n.value);
}

export function dumpExpr_pipe(indent: string, label: string, n: Ref<Extract<Expr, { kind: "pipe" }>>): void {
  console.log(indent + label + " " + "pipe");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "value", n.value);
  dumpExpr(indent + "  ", "body", n.body);
}

export function dumpExpr_topic(indent: string, label: string, n: Ref<Extract<Expr, { kind: "topic" }>>): void {
  console.log(indent + label + " " + "topic");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
}

export function dumpExpr_match(indent: string, label: string, n: Ref<Extract<Expr, { kind: "match" }>>): void {
  console.log(indent + label + " " + "match");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "subject", n.subject);
  console.log(indent + "  " + "arms" + ` [${n.arms.length}]`);
  for (const x33 of n.arms) {
    dumpMatchArm(indent + "  " + "  ", "-", x33);
  }
}

export function dumpExpr_comptime(indent: string, label: string, n: Ref<Extract<Expr, { kind: "comptime" }>>): void {
  console.log(indent + label + " " + "comptime");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "expr", n.expr);
}

export function dumpExpr_unsafe(indent: string, label: string, n: Ref<Extract<Expr, { kind: "unsafe" }>>): void {
  console.log(indent + label + " " + "unsafe");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "expr", n.expr);
}

export function dumpExpr_destructure(indent: string, label: string, n: Ref<Extract<Expr, { kind: "destructure" }>>): void {
  console.log(indent + label + " " + "destructure");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpPattern(indent + "  ", "pattern", n.pattern);
  dumpExpr(indent + "  ", "value", n.value);
}

export function dumpExpr_sequence(indent: string, label: string, n: Ref<Extract<Expr, { kind: "sequence" }>>): void {
  console.log(indent + label + " " + "sequence");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "exprs" + ` [${n.exprs.length}]`);
  for (const x34 of n.exprs) {
    dumpExpr(indent + "  " + "  ", "-", x34);
  }
}

export function dumpExpr_yield(indent: string, label: string, n: Ref<Extract<Expr, { kind: "yield" }>>): void {
  console.log(indent + label + " " + "yield");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  if (n.value === undefined) console.log(indent + "  " + "value" + " undefined");
  else {
    dumpExpr(indent + "  ", "value", n.value!);
  }
  console.log(indent + "  " + "delegate" + " " + `${n.delegate}`);
}

export function dumpExpr_as(indent: string, label: string, n: Ref<Extract<Expr, { kind: "as" | "satisfies" }>>): void {
  console.log(indent + label + " " + "as");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "expr", n.expr);
  dumpTypeNode(indent + "  ", "type", n.type);
}

export function dumpExpr_satisfies(indent: string, label: string, n: Ref<Extract<Expr, { kind: "as" | "satisfies" }>>): void {
  console.log(indent + label + " " + "satisfies");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "expr", n.expr);
  dumpTypeNode(indent + "  ", "type", n.type);
}

export function dumpExpr_assertion(indent: string, label: string, n: Ref<Extract<Expr, { kind: "assertion" }>>): void {
  console.log(indent + label + " " + "assertion");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpTypeNode(indent + "  ", "type", n.type);
  dumpExpr(indent + "  ", "expr", n.expr);
}

export function dumpStmt_expr(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "expr" }>>): void {
  console.log(indent + label + " " + "expr");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "expr", n.expr);
}

export function dumpStmt_let(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "let" }>>): void {
  console.log(indent + label + " " + "let");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "keyword" + " " + JSON.stringify(n.keyword));
  console.log(indent + "  " + "declarations" + ` [${n.declarations.length}]`);
  for (const x35 of n.declarations) {
    dumpDeclarator(indent + "  " + "  ", "-", x35);
  }
}

export function dumpStmt_return(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "return" }>>): void {
  console.log(indent + label + " " + "return");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  if (n.value === undefined) console.log(indent + "  " + "value" + " undefined");
  else {
    dumpExpr(indent + "  ", "value", n.value!);
  }
}

export function dumpStmt_if(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "if" }>>): void {
  console.log(indent + label + " " + "if");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "cond", n.cond);
  console.log(indent + "  " + "then" + ` [${n.then.length}]`);
  for (const x36 of n.then) {
    dumpStmt(indent + "  " + "  ", "-", x36);
  }
  if (n.else === undefined) console.log(indent + "  " + "else" + " undefined");
  else {
    console.log(indent + "  " + "else" + ` [${n.else!.length}]`);
    for (const x37 of n.else!) {
      dumpStmt(indent + "  " + "  ", "-", x37);
    }
  }
}

export function dumpStmt_while(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "while" }>>): void {
  console.log(indent + label + " " + "while");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "cond", n.cond);
  console.log(indent + "  " + "body" + ` [${n.body.length}]`);
  for (const x38 of n.body) {
    dumpStmt(indent + "  " + "  ", "-", x38);
  }
}

export function dumpStmt_doWhile(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "doWhile" }>>): void {
  console.log(indent + label + " " + "doWhile");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "body" + ` [${n.body.length}]`);
  for (const x39 of n.body) {
    dumpStmt(indent + "  " + "  ", "-", x39);
  }
  dumpExpr(indent + "  ", "cond", n.cond);
}

export function dumpStmt_switch(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "switch" }>>): void {
  console.log(indent + label + " " + "switch");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "discriminant", n.discriminant);
  console.log(indent + "  " + "cases" + ` [${n.cases.length}]`);
  for (const x40 of n.cases) {
    dumpSwitchCase(indent + "  " + "  ", "-", x40);
  }
}

export function dumpStmt_labeled(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "labeled" }>>): void {
  console.log(indent + label + " " + "labeled");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "label" + " " + JSON.stringify(n.label));
  dumpStmt(indent + "  ", "body", n.body);
}

export function dumpStmt_break(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "break" | "continue" }>>): void {
  console.log(indent + label + " " + "break");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  if (n.label === undefined) console.log(indent + "  " + "label" + " undefined");
  else {
    console.log(indent + "  " + "label" + " " + JSON.stringify(n.label!));
  }
}

export function dumpStmt_continue(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "break" | "continue" }>>): void {
  console.log(indent + label + " " + "continue");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  if (n.label === undefined) console.log(indent + "  " + "label" + " undefined");
  else {
    console.log(indent + "  " + "label" + " " + JSON.stringify(n.label!));
  }
}

export function dumpStmt_throw(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "throw" }>>): void {
  console.log(indent + label + " " + "throw");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "value", n.value);
}

export function dumpStmt_try(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "try" }>>): void {
  console.log(indent + label + " " + "try");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "block" + ` [${n.block.length}]`);
  for (const x41 of n.block) {
    dumpStmt(indent + "  " + "  ", "-", x41);
  }
  if (n.param === undefined) console.log(indent + "  " + "param" + " undefined");
  else {
    dumpPattern(indent + "  ", "param", n.param!);
  }
  if (n.paramType === undefined) console.log(indent + "  " + "paramType" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "paramType", n.paramType!);
  }
  if (n.handler === undefined) console.log(indent + "  " + "handler" + " undefined");
  else {
    console.log(indent + "  " + "handler" + ` [${n.handler!.length}]`);
    for (const x42 of n.handler!) {
      dumpStmt(indent + "  " + "  ", "-", x42);
    }
  }
  if (n.finalizer === undefined) console.log(indent + "  " + "finalizer" + " undefined");
  else {
    console.log(indent + "  " + "finalizer" + ` [${n.finalizer!.length}]`);
    for (const x43 of n.finalizer!) {
      dumpStmt(indent + "  " + "  ", "-", x43);
    }
  }
}

export function dumpStmt_for(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "for" }>>): void {
  console.log(indent + label + " " + "for");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  if (n.init === undefined) console.log(indent + "  " + "init" + " undefined");
  else {
    dumpStmt(indent + "  ", "init", n.init!);
  }
  if (n.test === undefined) console.log(indent + "  " + "test" + " undefined");
  else {
    dumpExpr(indent + "  ", "test", n.test!);
  }
  if (n.update === undefined) console.log(indent + "  " + "update" + " undefined");
  else {
    dumpExpr(indent + "  ", "update", n.update!);
  }
  console.log(indent + "  " + "body" + ` [${n.body.length}]`);
  for (const x44 of n.body) {
    dumpStmt(indent + "  " + "  ", "-", x44);
  }
}

export function dumpStmt_forIn(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "forIn" | "forOf" }>>): void {
  console.log(indent + label + " " + "forIn");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "await" + " " + `${n.await}`);
  dumpUnion1(indent + "  ", "left", n.left);
  dumpExpr(indent + "  ", "right", n.right);
  console.log(indent + "  " + "body" + ` [${n.body.length}]`);
  for (const x45 of n.body) {
    dumpStmt(indent + "  " + "  ", "-", x45);
  }
}

export function dumpStmt_forOf(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "forIn" | "forOf" }>>): void {
  console.log(indent + label + " " + "forOf");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "await" + " " + `${n.await}`);
  dumpUnion1(indent + "  ", "left", n.left);
  dumpExpr(indent + "  ", "right", n.right);
  console.log(indent + "  " + "body" + ` [${n.body.length}]`);
  for (const x46 of n.body) {
    dumpStmt(indent + "  " + "  ", "-", x46);
  }
}

export function dumpStmt_block(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "block" }>>): void {
  console.log(indent + label + " " + "block");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "body" + ` [${n.body.length}]`);
  for (const x47 of n.body) {
    dumpStmt(indent + "  " + "  ", "-", x47);
  }
}

export function dumpStmt_empty(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "empty" }>>): void {
  console.log(indent + label + " " + "empty");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
}

export function dumpStmt_debugger(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "debugger" }>>): void {
  console.log(indent + label + " " + "debugger");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
}

export function dumpStmt_enum(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "enum" }>>): void {
  console.log(indent + label + " " + "enum");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
  console.log(indent + "  " + "const" + " " + `${n.const}`);
  console.log(indent + "  " + "typeParams" + ` [${n.typeParams.length}]`);
  for (const x48 of n.typeParams) {
    dumpTypeParam(indent + "  " + "  ", "-", x48);
  }
  console.log(indent + "  " + "members" + ` [${n.members.length}]`);
  for (const x49 of n.members) {
    dumpEnumMember(indent + "  " + "  ", "-", x49);
  }
  if (n.decorators === undefined) console.log(indent + "  " + "decorators" + " undefined");
  else {
    console.log(indent + "  " + "decorators" + ` [${n.decorators!.length}]`);
    for (const x50 of n.decorators!) {
      dumpExpr(indent + "  " + "  ", "-", x50);
    }
  }
  if (n.derives === undefined) console.log(indent + "  " + "derives" + " undefined");
  else {
    console.log(indent + "  " + "derives" + ` [${n.derives!.length}]`);
    for (const x51 of n.derives!) {
      console.log(indent + "  " + "  " + "-" + " " + JSON.stringify(x51));
    }
  }
}

export function dumpStmt_namespace(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "namespace" }>>): void {
  console.log(indent + label + " " + "namespace");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
  console.log(indent + "  " + "quoted" + " " + `${n.quoted}`);
  console.log(indent + "  " + "global" + " " + `${n.global}`);
  if (n.body === undefined) console.log(indent + "  " + "body" + " undefined");
  else {
    console.log(indent + "  " + "body" + ` [${n.body!.length}]`);
    for (const x52 of n.body!) {
      dumpStmt(indent + "  " + "  ", "-", x52);
    }
  }
}

export function dumpStmt_declare(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "declare" }>>): void {
  console.log(indent + label + " " + "declare");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpStmt(indent + "  ", "body", n.body);
}

export function dumpStmt_comptime(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "comptime" }>>): void {
  console.log(indent + label + " " + "comptime");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "body" + ` [${n.body.length}]`);
  for (const x53 of n.body) {
    dumpStmt(indent + "  " + "  ", "-", x53);
  }
}

export function dumpStmt_unsafe(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "unsafe" }>>): void {
  console.log(indent + label + " " + "unsafe");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "body" + ` [${n.body.length}]`);
  for (const x54 of n.body) {
    dumpStmt(indent + "  " + "  ", "-", x54);
  }
}

export function dumpStmt_import(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "import" }>>): void {
  console.log(indent + label + " " + "import");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "typeOnly" + " " + `${n.typeOnly}`);
  console.log(indent + "  " + "defer" + " " + `${n.defer}`);
  if (n.default === undefined) console.log(indent + "  " + "default" + " undefined");
  else {
    console.log(indent + "  " + "default" + " " + JSON.stringify(n.default!));
  }
  if (n.namespace === undefined) console.log(indent + "  " + "namespace" + " undefined");
  else {
    console.log(indent + "  " + "namespace" + " " + JSON.stringify(n.namespace!));
  }
  if (n.named === undefined) console.log(indent + "  " + "named" + " undefined");
  else {
    console.log(indent + "  " + "named" + ` [${n.named!.length}]`);
    for (const x55 of n.named!) {
      dumpSpecifier(indent + "  " + "  ", "-", x55);
    }
  }
  console.log(indent + "  " + "module" + " " + JSON.stringify(n.module));
  if (n.attributes === undefined) console.log(indent + "  " + "attributes" + " undefined");
  else {
    dumpExpr(indent + "  ", "attributes", n.attributes!);
  }
}

export function dumpStmt_importEquals(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "importEquals" }>>): void {
  console.log(indent + label + " " + "importEquals");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "typeOnly" + " " + `${n.typeOnly}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
  if (n.require === undefined) console.log(indent + "  " + "require" + " undefined");
  else {
    console.log(indent + "  " + "require" + " " + JSON.stringify(n.require!));
  }
  if (n.entity === undefined) console.log(indent + "  " + "entity" + " undefined");
  else {
    console.log(indent + "  " + "entity" + " " + JSON.stringify(n.entity!));
  }
}

export function dumpStmt_export(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "export" }>>): void {
  console.log(indent + label + " " + "export");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpStmt(indent + "  ", "body", n.body);
}

export function dumpStmt_exportDefault(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "exportDefault" }>>): void {
  console.log(indent + label + " " + "exportDefault");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  if (n.declaration === undefined) console.log(indent + "  " + "declaration" + " undefined");
  else {
    dumpStmt(indent + "  ", "declaration", n.declaration!);
  }
  if (n.value === undefined) console.log(indent + "  " + "value" + " undefined");
  else {
    dumpExpr(indent + "  ", "value", n.value!);
  }
}

export function dumpStmt_exportNamed(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "exportNamed" }>>): void {
  console.log(indent + label + " " + "exportNamed");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "typeOnly" + " " + `${n.typeOnly}`);
  console.log(indent + "  " + "specifiers" + ` [${n.specifiers.length}]`);
  for (const x56 of n.specifiers) {
    dumpSpecifier(indent + "  " + "  ", "-", x56);
  }
  if (n.module === undefined) console.log(indent + "  " + "module" + " undefined");
  else {
    console.log(indent + "  " + "module" + " " + JSON.stringify(n.module!));
  }
}

export function dumpStmt_exportAll(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "exportAll" }>>): void {
  console.log(indent + label + " " + "exportAll");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "typeOnly" + " " + `${n.typeOnly}`);
  if (n.alias === undefined) console.log(indent + "  " + "alias" + " undefined");
  else {
    console.log(indent + "  " + "alias" + " " + JSON.stringify(n.alias!));
  }
  console.log(indent + "  " + "module" + " " + JSON.stringify(n.module));
}

export function dumpStmt_exportAssign(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "exportAssign" }>>): void {
  console.log(indent + label + " " + "exportAssign");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "value", n.value);
}

export function dumpStmt_exportAsNamespace(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "exportAsNamespace" }>>): void {
  console.log(indent + label + " " + "exportAsNamespace");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
}

export function dumpTypeAlias_typeAlias(indent: string, label: string, n: Ref<Extract<TypeAlias, { kind: "typeAlias" }>>): void {
  console.log(indent + label + " " + "typeAlias");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
  console.log(indent + "  " + "typeParams" + ` [${n.typeParams.length}]`);
  for (const x57 of n.typeParams) {
    dumpTypeParam(indent + "  " + "  ", "-", x57);
  }
  dumpTypeNode(indent + "  ", "type", n.type);
  if (n.decorators === undefined) console.log(indent + "  " + "decorators" + " undefined");
  else {
    console.log(indent + "  " + "decorators" + ` [${n.decorators!.length}]`);
    for (const x58 of n.decorators!) {
      dumpExpr(indent + "  " + "  ", "-", x58);
    }
  }
  if (n.js === undefined) console.log(indent + "  " + "js" + " undefined");
  else {
    dumpJsName(indent + "  ", "js", n.js!);
  }
}

export function dumpInterface_interface(indent: string, label: string, n: Ref<Extract<Interface, { kind: "interface" }>>): void {
  console.log(indent + label + " " + "interface");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
  console.log(indent + "  " + "typeParams" + ` [${n.typeParams.length}]`);
  for (const x59 of n.typeParams) {
    dumpTypeParam(indent + "  " + "  ", "-", x59);
  }
  console.log(indent + "  " + "extends" + ` [${n.extends.length}]`);
  for (const x60 of n.extends) {
    dumpTypeNode(indent + "  " + "  ", "-", x60);
  }
  console.log(indent + "  " + "members" + ` [${n.members.length}]`);
  for (const x61 of n.members) {
    dumpTypeMember(indent + "  " + "  ", "-", x61);
  }
  if (n.decorators === undefined) console.log(indent + "  " + "decorators" + " undefined");
  else {
    console.log(indent + "  " + "decorators" + ` [${n.decorators!.length}]`);
    for (const x62 of n.decorators!) {
      dumpExpr(indent + "  " + "  ", "-", x62);
    }
  }
  if (n.js === undefined) console.log(indent + "  " + "js" + " undefined");
  else {
    dumpJsName(indent + "  ", "js", n.js!);
  }
  if (n.jsClass === undefined) console.log(indent + "  " + "jsClass" + " undefined");
  else {
    console.log(indent + "  " + "jsClass");
    console.log(indent + "  " + "  " + "constructors" + ` [${n.jsClass!.constructors.length}]`);
    for (const x63 of n.jsClass!.constructors) {
      console.log(indent + "  " + "  " + "  " + "-" + ` [${x63.length}]`);
      for (const x64 of x63) {
        dumpParam(indent + "  " + "  " + "  " + "  ", "-", x64);
      }
    }
    console.log(indent + "  " + "  " + "statics" + ` [${n.jsClass!.statics.length}]`);
    for (const x65 of n.jsClass!.statics) {
      dumpTypeMember(indent + "  " + "  " + "  ", "-", x65);
    }
  }
  if (n.jsSource === undefined) console.log(indent + "  " + "jsSource" + " undefined");
  else {
    dumpStmt(indent + "  ", "jsSource", n.jsSource!);
  }
}

export function dumpFunc_function(indent: string, label: string, n: Ref<Extract<Func, { kind: "function" }>>): void {
  console.log(indent + label + " " + "function");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
  console.log(indent + "  " + "async" + " " + `${n.async}`);
  console.log(indent + "  " + "generator" + " " + `${n.generator}`);
  console.log(indent + "  " + "macro" + " " + `${n.macro}`);
  console.log(indent + "  " + "typeParams" + ` [${n.typeParams.length}]`);
  for (const x66 of n.typeParams) {
    dumpTypeParam(indent + "  " + "  ", "-", x66);
  }
  console.log(indent + "  " + "params" + ` [${n.params.length}]`);
  for (const x67 of n.params) {
    dumpParam(indent + "  " + "  ", "-", x67);
  }
  if (n.returnType === undefined) console.log(indent + "  " + "returnType" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "returnType", n.returnType!);
  }
  if (n.throws === undefined) console.log(indent + "  " + "throws" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "throws", n.throws!);
  }
  if (n.body === undefined) console.log(indent + "  " + "body" + " undefined");
  else {
    console.log(indent + "  " + "body" + ` [${n.body!.length}]`);
    for (const x68 of n.body!) {
      dumpStmt(indent + "  " + "  ", "-", x68);
    }
  }
  if (n.decorators === undefined) console.log(indent + "  " + "decorators" + " undefined");
  else {
    console.log(indent + "  " + "decorators" + ` [${n.decorators!.length}]`);
    for (const x69 of n.decorators!) {
      dumpExpr(indent + "  " + "  ", "-", x69);
    }
  }
  if (n.js === undefined) console.log(indent + "  " + "js" + " undefined");
  else {
    dumpJsName(indent + "  ", "js", n.js!);
  }
}

export function dumpStmt_class(indent: string, label: string, n: Ref<Extract<Stmt, { kind: "class" }>>): void {
  console.log(indent + label + " " + "class");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  if (n.name === undefined) console.log(indent + "  " + "name" + " undefined");
  else {
    console.log(indent + "  " + "name" + " " + JSON.stringify(n.name!));
  }
  console.log(indent + "  " + "abstract" + " " + `${n.abstract}`);
  console.log(indent + "  " + "decorators" + ` [${n.decorators.length}]`);
  for (const x70 of n.decorators) {
    dumpExpr(indent + "  " + "  ", "-", x70);
  }
  console.log(indent + "  " + "typeParams" + ` [${n.typeParams.length}]`);
  for (const x71 of n.typeParams) {
    dumpTypeParam(indent + "  " + "  ", "-", x71);
  }
  if (n.extends === undefined) console.log(indent + "  " + "extends" + " undefined");
  else {
    dumpExpr(indent + "  ", "extends", n.extends!);
  }
  console.log(indent + "  " + "implements" + ` [${n.implements.length}]`);
  for (const x72 of n.implements) {
    dumpTypeNode(indent + "  " + "  ", "-", x72);
  }
  console.log(indent + "  " + "members" + ` [${n.members.length}]`);
  for (const x73 of n.members) {
    dumpClassMember(indent + "  " + "  ", "-", x73);
  }
  if (n.derives === undefined) console.log(indent + "  " + "derives" + " undefined");
  else {
    console.log(indent + "  " + "derives" + ` [${n.derives!.length}]`);
    for (const x74 of n.derives!) {
      console.log(indent + "  " + "  " + "-" + " " + JSON.stringify(x74));
    }
  }
}

export function dumpTypeMember_property(indent: string, label: string, n: Ref<Extract<TypeMember, { kind: "property" }>>): void {
  console.log(indent + label + " " + "property");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpUnion2(indent + "  ", "name", n.name);
  console.log(indent + "  " + "optional" + " " + `${n.optional}`);
  console.log(indent + "  " + "readonly" + " " + `${n.readonly}`);
  if (n.type === undefined) console.log(indent + "  " + "type" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "type", n.type!);
  }
}

export function dumpTypeMember_method(indent: string, label: string, n: Ref<Extract<TypeMember, { kind: "method" }>>): void {
  console.log(indent + label + " " + "method");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpUnion2(indent + "  ", "name", n.name);
  console.log(indent + "  " + "optional" + " " + `${n.optional}`);
  console.log(indent + "  " + "typeParams" + ` [${n.typeParams.length}]`);
  for (const x75 of n.typeParams) {
    dumpTypeParam(indent + "  " + "  ", "-", x75);
  }
  console.log(indent + "  " + "params" + ` [${n.params.length}]`);
  for (const x76 of n.params) {
    dumpParam(indent + "  " + "  ", "-", x76);
  }
  if (n.returns === undefined) console.log(indent + "  " + "returns" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "returns", n.returns!);
  }
}

export function dumpTypeMember_call(indent: string, label: string, n: Ref<Extract<TypeMember, { kind: "call" | "construct" }>>): void {
  console.log(indent + label + " " + "call");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "typeParams" + ` [${n.typeParams.length}]`);
  for (const x77 of n.typeParams) {
    dumpTypeParam(indent + "  " + "  ", "-", x77);
  }
  console.log(indent + "  " + "params" + ` [${n.params.length}]`);
  for (const x78 of n.params) {
    dumpParam(indent + "  " + "  ", "-", x78);
  }
  if (n.returns === undefined) console.log(indent + "  " + "returns" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "returns", n.returns!);
  }
}

export function dumpTypeMember_construct(indent: string, label: string, n: Ref<Extract<TypeMember, { kind: "call" | "construct" }>>): void {
  console.log(indent + label + " " + "construct");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "typeParams" + ` [${n.typeParams.length}]`);
  for (const x79 of n.typeParams) {
    dumpTypeParam(indent + "  " + "  ", "-", x79);
  }
  console.log(indent + "  " + "params" + ` [${n.params.length}]`);
  for (const x80 of n.params) {
    dumpParam(indent + "  " + "  ", "-", x80);
  }
  if (n.returns === undefined) console.log(indent + "  " + "returns" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "returns", n.returns!);
  }
}

export function dumpTypeMember_index(indent: string, label: string, n: Ref<Extract<TypeMember, { kind: "index" }>>): void {
  console.log(indent + label + " " + "index");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "readonly" + " " + `${n.readonly}`);
  console.log(indent + "  " + "params" + ` [${n.params.length}]`);
  for (const x81 of n.params) {
    dumpParam(indent + "  " + "  ", "-", x81);
  }
  dumpTypeNode(indent + "  ", "type", n.type);
}

export function dumpTypeMember_get(indent: string, label: string, n: Ref<Extract<TypeMember, { kind: "get" | "set" }>>): void {
  console.log(indent + label + " " + "get");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpUnion2(indent + "  ", "name", n.name);
  console.log(indent + "  " + "params" + ` [${n.params.length}]`);
  for (const x82 of n.params) {
    dumpParam(indent + "  " + "  ", "-", x82);
  }
  if (n.returns === undefined) console.log(indent + "  " + "returns" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "returns", n.returns!);
  }
}

export function dumpTypeMember_set(indent: string, label: string, n: Ref<Extract<TypeMember, { kind: "get" | "set" }>>): void {
  console.log(indent + label + " " + "set");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpUnion2(indent + "  ", "name", n.name);
  console.log(indent + "  " + "params" + ` [${n.params.length}]`);
  for (const x83 of n.params) {
    dumpParam(indent + "  " + "  ", "-", x83);
  }
  if (n.returns === undefined) console.log(indent + "  " + "returns" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "returns", n.returns!);
  }
}

export function dumpObjectProp_property(indent: string, label: string, n: Ref<Extract<ObjectProp, { kind: "property" }>>): void {
  console.log(indent + label + " " + "property");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpUnion2(indent + "  ", "key", n.key);
  dumpExpr(indent + "  ", "value", n.value);
}

export function dumpObjectProp_shorthand(indent: string, label: string, n: Ref<Extract<ObjectProp, { kind: "shorthand" }>>): void {
  console.log(indent + label + " " + "shorthand");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
  if (n.default === undefined) console.log(indent + "  " + "default" + " undefined");
  else {
    dumpExpr(indent + "  ", "default", n.default!);
  }
}

export function dumpObjectProp_spread(indent: string, label: string, n: Ref<Extract<ObjectProp, { kind: "spread" }>>): void {
  console.log(indent + label + " " + "spread");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "value", n.value);
}

export function dumpObjectProp_method(indent: string, label: string, n: Ref<Extract<ObjectProp, { kind: "method" }>>): void {
  console.log(indent + label + " " + "method");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpUnion2(indent + "  ", "key", n.key);
  console.log(indent + "  " + "async" + " " + `${n.async}`);
  console.log(indent + "  " + "generator" + " " + `${n.generator}`);
  console.log(indent + "  " + "typeParams" + ` [${n.typeParams.length}]`);
  for (const x84 of n.typeParams) {
    dumpTypeParam(indent + "  " + "  ", "-", x84);
  }
  console.log(indent + "  " + "params" + ` [${n.params.length}]`);
  for (const x85 of n.params) {
    dumpParam(indent + "  " + "  ", "-", x85);
  }
  if (n.returnType === undefined) console.log(indent + "  " + "returnType" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "returnType", n.returnType!);
  }
  console.log(indent + "  " + "body" + ` [${n.body.length}]`);
  for (const x86 of n.body) {
    dumpStmt(indent + "  " + "  ", "-", x86);
  }
}

export function dumpObjectProp_get(indent: string, label: string, n: Ref<Extract<ObjectProp, { kind: "get" | "set" }>>): void {
  console.log(indent + label + " " + "get");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpUnion2(indent + "  ", "key", n.key);
  console.log(indent + "  " + "params" + ` [${n.params.length}]`);
  for (const x87 of n.params) {
    dumpParam(indent + "  " + "  ", "-", x87);
  }
  if (n.returnType === undefined) console.log(indent + "  " + "returnType" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "returnType", n.returnType!);
  }
  console.log(indent + "  " + "body" + ` [${n.body.length}]`);
  for (const x88 of n.body) {
    dumpStmt(indent + "  " + "  ", "-", x88);
  }
}

export function dumpObjectProp_set(indent: string, label: string, n: Ref<Extract<ObjectProp, { kind: "get" | "set" }>>): void {
  console.log(indent + label + " " + "set");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpUnion2(indent + "  ", "key", n.key);
  console.log(indent + "  " + "params" + ` [${n.params.length}]`);
  for (const x89 of n.params) {
    dumpParam(indent + "  " + "  ", "-", x89);
  }
  if (n.returnType === undefined) console.log(indent + "  " + "returnType" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "returnType", n.returnType!);
  }
  console.log(indent + "  " + "body" + ` [${n.body.length}]`);
  for (const x90 of n.body) {
    dumpStmt(indent + "  " + "  ", "-", x90);
  }
}

export function dumpClassMember_field(indent: string, label: string, n: Ref<Extract<ClassMember, { kind: "field" }>>): void {
  console.log(indent + label + " " + "field");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "modifiers" + ` [${n.modifiers.length}]`);
  for (const x96 of n.modifiers) {
    console.log(indent + "  " + "  " + "-" + " " + JSON.stringify(x96));
  }
  console.log(indent + "  " + "decorators" + ` [${n.decorators.length}]`);
  for (const x97 of n.decorators) {
    dumpExpr(indent + "  " + "  ", "-", x97);
  }
  dumpUnion2(indent + "  ", "name", n.name);
  console.log(indent + "  " + "optional" + " " + `${n.optional}`);
  console.log(indent + "  " + "definite" + " " + `${n.definite}`);
  if (n.type === undefined) console.log(indent + "  " + "type" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "type", n.type!);
  }
  if (n.init === undefined) console.log(indent + "  " + "init" + " undefined");
  else {
    dumpExpr(indent + "  ", "init", n.init!);
  }
}

export function dumpClassMember_method(indent: string, label: string, n: Ref<Extract<ClassMember, { kind: "method" }>>): void {
  console.log(indent + label + " " + "method");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "modifiers" + ` [${n.modifiers.length}]`);
  for (const x98 of n.modifiers) {
    console.log(indent + "  " + "  " + "-" + " " + JSON.stringify(x98));
  }
  console.log(indent + "  " + "decorators" + ` [${n.decorators.length}]`);
  for (const x99 of n.decorators) {
    dumpExpr(indent + "  " + "  ", "-", x99);
  }
  dumpUnion2(indent + "  ", "name", n.name);
  console.log(indent + "  " + "optional" + " " + `${n.optional}`);
  console.log(indent + "  " + "generator" + " " + `${n.generator}`);
  console.log(indent + "  " + "typeParams" + ` [${n.typeParams.length}]`);
  for (const x100 of n.typeParams) {
    dumpTypeParam(indent + "  " + "  ", "-", x100);
  }
  console.log(indent + "  " + "params" + ` [${n.params.length}]`);
  for (const x101 of n.params) {
    dumpParam(indent + "  " + "  ", "-", x101);
  }
  if (n.returnType === undefined) console.log(indent + "  " + "returnType" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "returnType", n.returnType!);
  }
  if (n.throws === undefined) console.log(indent + "  " + "throws" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "throws", n.throws!);
  }
  if (n.body === undefined) console.log(indent + "  " + "body" + " undefined");
  else {
    console.log(indent + "  " + "body" + ` [${n.body!.length}]`);
    for (const x102 of n.body!) {
      dumpStmt(indent + "  " + "  ", "-", x102);
    }
  }
}

export function dumpClassMember_constructor(indent: string, label: string, n: Ref<Extract<ClassMember, { kind: "constructor" }>>): void {
  console.log(indent + label + " " + "constructor");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "modifiers" + ` [${n.modifiers.length}]`);
  for (const x103 of n.modifiers) {
    console.log(indent + "  " + "  " + "-" + " " + JSON.stringify(x103));
  }
  console.log(indent + "  " + "decorators" + ` [${n.decorators.length}]`);
  for (const x104 of n.decorators) {
    dumpExpr(indent + "  " + "  ", "-", x104);
  }
  console.log(indent + "  " + "params" + ` [${n.params.length}]`);
  for (const x105 of n.params) {
    dumpParam(indent + "  " + "  ", "-", x105);
  }
  if (n.throws === undefined) console.log(indent + "  " + "throws" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "throws", n.throws!);
  }
  if (n.body === undefined) console.log(indent + "  " + "body" + " undefined");
  else {
    console.log(indent + "  " + "body" + ` [${n.body!.length}]`);
    for (const x106 of n.body!) {
      dumpStmt(indent + "  " + "  ", "-", x106);
    }
  }
}

export function dumpClassMember_get(indent: string, label: string, n: Ref<Extract<ClassMember, { kind: "get" | "set" }>>): void {
  console.log(indent + label + " " + "get");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "modifiers" + ` [${n.modifiers.length}]`);
  for (const x107 of n.modifiers) {
    console.log(indent + "  " + "  " + "-" + " " + JSON.stringify(x107));
  }
  console.log(indent + "  " + "decorators" + ` [${n.decorators.length}]`);
  for (const x108 of n.decorators) {
    dumpExpr(indent + "  " + "  ", "-", x108);
  }
  dumpUnion2(indent + "  ", "name", n.name);
  console.log(indent + "  " + "params" + ` [${n.params.length}]`);
  for (const x109 of n.params) {
    dumpParam(indent + "  " + "  ", "-", x109);
  }
  if (n.returnType === undefined) console.log(indent + "  " + "returnType" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "returnType", n.returnType!);
  }
  if (n.throws === undefined) console.log(indent + "  " + "throws" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "throws", n.throws!);
  }
  if (n.body === undefined) console.log(indent + "  " + "body" + " undefined");
  else {
    console.log(indent + "  " + "body" + ` [${n.body!.length}]`);
    for (const x110 of n.body!) {
      dumpStmt(indent + "  " + "  ", "-", x110);
    }
  }
}

export function dumpClassMember_set(indent: string, label: string, n: Ref<Extract<ClassMember, { kind: "get" | "set" }>>): void {
  console.log(indent + label + " " + "set");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "modifiers" + ` [${n.modifiers.length}]`);
  for (const x111 of n.modifiers) {
    console.log(indent + "  " + "  " + "-" + " " + JSON.stringify(x111));
  }
  console.log(indent + "  " + "decorators" + ` [${n.decorators.length}]`);
  for (const x112 of n.decorators) {
    dumpExpr(indent + "  " + "  ", "-", x112);
  }
  dumpUnion2(indent + "  ", "name", n.name);
  console.log(indent + "  " + "params" + ` [${n.params.length}]`);
  for (const x113 of n.params) {
    dumpParam(indent + "  " + "  ", "-", x113);
  }
  if (n.returnType === undefined) console.log(indent + "  " + "returnType" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "returnType", n.returnType!);
  }
  if (n.throws === undefined) console.log(indent + "  " + "throws" + " undefined");
  else {
    dumpTypeNode(indent + "  ", "throws", n.throws!);
  }
  if (n.body === undefined) console.log(indent + "  " + "body" + " undefined");
  else {
    console.log(indent + "  " + "body" + ` [${n.body!.length}]`);
    for (const x114 of n.body!) {
      dumpStmt(indent + "  " + "  ", "-", x114);
    }
  }
}

export function dumpClassMember_index(indent: string, label: string, n: Ref<Extract<ClassMember, { kind: "index" }>>): void {
  console.log(indent + label + " " + "index");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "modifiers" + ` [${n.modifiers.length}]`);
  for (const x115 of n.modifiers) {
    console.log(indent + "  " + "  " + "-" + " " + JSON.stringify(x115));
  }
  console.log(indent + "  " + "decorators" + ` [${n.decorators.length}]`);
  for (const x116 of n.decorators) {
    dumpExpr(indent + "  " + "  ", "-", x116);
  }
  console.log(indent + "  " + "params" + ` [${n.params.length}]`);
  for (const x117 of n.params) {
    dumpParam(indent + "  " + "  ", "-", x117);
  }
  dumpTypeNode(indent + "  ", "type", n.type);
}

export function dumpClassMember_staticBlock(indent: string, label: string, n: Ref<Extract<ClassMember, { kind: "staticBlock" }>>): void {
  console.log(indent + label + " " + "staticBlock");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "modifiers" + ` [${n.modifiers.length}]`);
  for (const x118 of n.modifiers) {
    console.log(indent + "  " + "  " + "-" + " " + JSON.stringify(x118));
  }
  console.log(indent + "  " + "decorators" + ` [${n.decorators.length}]`);
  for (const x119 of n.decorators) {
    dumpExpr(indent + "  " + "  ", "-", x119);
  }
  console.log(indent + "  " + "body" + ` [${n.body.length}]`);
  for (const x120 of n.body) {
    dumpStmt(indent + "  " + "  ", "-", x120);
  }
}

export function dumpPattern_ident(indent: string, label: string, n: Ref<Extract<Pattern, { kind: "ident" }>>): void {
  console.log(indent + label + " " + "ident");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
}

export function dumpPattern_object(indent: string, label: string, n: Ref<Extract<Pattern, { kind: "object" }>>): void {
  console.log(indent + label + " " + "object");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "props" + ` [${n.props.length}]`);
  for (const x123 of n.props) {
    dumpPatternProp(indent + "  " + "  ", "-", x123);
  }
  if (n.rest === undefined) console.log(indent + "  " + "rest" + " undefined");
  else {
    dumpPattern(indent + "  ", "rest", n.rest!);
  }
}

export function dumpPattern_array(indent: string, label: string, n: Ref<Extract<Pattern, { kind: "array" }>>): void {
  console.log(indent + label + " " + "array");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "elements" + ` [${n.elements.length}]`);
  for (const x124 of n.elements) {
    if (x124 === undefined) console.log(indent + "  " + "  " + "-" + " undefined");
    else {
      dumpPattern(indent + "  " + "  ", "-", x124!);
    }
  }
  if (n.rest === undefined) console.log(indent + "  " + "rest" + " undefined");
  else {
    dumpPattern(indent + "  ", "rest", n.rest!);
  }
}

export function dumpPattern_default(indent: string, label: string, n: Ref<Extract<Pattern, { kind: "default" }>>): void {
  console.log(indent + label + " " + "default");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpPattern(indent + "  ", "target", n.target);
  dumpExpr(indent + "  ", "value", n.value);
}

export function dumpPattern_expr(indent: string, label: string, n: Ref<Extract<Pattern, { kind: "expr" }>>): void {
  console.log(indent + label + " " + "expr");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "expr", n.expr);
}

export function dumpPattern_wildcard(indent: string, label: string, n: Ref<Extract<Pattern, { kind: "wildcard" }>>): void {
  console.log(indent + label + " " + "wildcard");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
}

export function dumpPattern_literal(indent: string, label: string, n: Ref<Extract<Pattern, { kind: "literal" }>>): void {
  console.log(indent + label + " " + "literal");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  dumpExpr(indent + "  ", "value", n.value);
}

export function dumpPattern_variant(indent: string, label: string, n: Ref<Extract<Pattern, { kind: "variant" }>>): void {
  console.log(indent + label + " " + "variant");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "name" + " " + JSON.stringify(n.name));
  if (n.args === undefined) console.log(indent + "  " + "args" + " undefined");
  else {
    console.log(indent + "  " + "args" + ` [${n.args!.length}]`);
    for (const x125 of n.args!) {
      dumpPattern(indent + "  " + "  ", "-", x125);
    }
  }
}

export function dumpPattern_or(indent: string, label: string, n: Ref<Extract<Pattern, { kind: "or" }>>): void {
  console.log(indent + label + " " + "or");
  console.log(indent + "  " + "start" + " " + `${n.start}`);
  console.log(indent + "  " + "end" + " " + `${n.end}`);
  console.log(indent + "  " + "id" + " " + `${n.id}`);
  console.log(indent + "  " + "patterns" + ` [${n.patterns.length}]`);
  for (const x126 of n.patterns) {
    dumpPattern(indent + "  " + "  ", "-", x126);
  }
}
