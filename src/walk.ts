// Generated from the parser's AST types by `bun scripts/walkgen.ts`; a test fails when it is stale.
// Each `childrenOf` function hands each node a node holds to `each`, tagged, in the order its
// type lists the fields.
import type { TypeNode, Expr, Stmt, TupleElement, PropertyName, TypeMember, ObjectProp, ClassNode, ClassMember, Param, Pattern, MatchArm, PatternProp, Specifier, EnumMember, SwitchCase, Declarator, TypeParam, TypeAlias, Interface, JsName, Func } from "./parser.ts";

// A node of any of the parser's types, tagged with which it is, since kinds repeat across them,
// or a list of statements, `stmts`, which is a scope of its own.
export type AnyNode =
  | { of: "typeNode"; node: Ref<TypeNode> }
  | { of: "expr"; node: Ref<Expr> }
  | { of: "stmt"; node: Ref<Stmt> }
  | { of: "tupleElement"; node: Ref<TupleElement> }
  | { of: "typeMember"; node: Ref<TypeMember> }
  | { of: "objectProp"; node: Ref<ObjectProp> }
  | { of: "classNode"; node: Ref<ClassNode> }
  | { of: "classMember"; node: Ref<ClassMember> }
  | { of: "param"; node: Ref<Param> }
  | { of: "pattern"; node: Ref<Pattern> }
  | { of: "matchArm"; node: Ref<MatchArm> }
  | { of: "patternProp"; node: Ref<PatternProp> }
  | { of: "specifier"; node: Ref<Specifier> }
  | { of: "enumMember"; node: Ref<EnumMember> }
  | { of: "switchCase"; node: Ref<SwitchCase> }
  | { of: "declarator"; node: Ref<Declarator> }
  | { of: "typeParam"; node: Ref<TypeParam> }
  | { of: "typeAlias"; node: Ref<TypeAlias> }
  | { of: "interface"; node: Ref<Interface> }
  | { of: "jsName"; node: Ref<JsName> }
  | { of: "func"; node: Ref<Func> }
  | { of: "stmts"; node: Ref<Stmt[]> };

// The type of node each tag names.
export interface NodeTypes {
  typeNode: TypeNode;
  expr: Expr;
  stmt: Stmt;
  tupleElement: TupleElement;
  typeMember: TypeMember;
  objectProp: ObjectProp;
  classNode: ClassNode;
  classMember: ClassMember;
  param: Param;
  pattern: Pattern;
  matchArm: MatchArm;
  patternProp: PatternProp;
  specifier: Specifier;
  enumMember: EnumMember;
  switchCase: SwitchCase;
  declarator: Declarator;
  typeParam: TypeParam;
  typeAlias: TypeAlias;
  interface: Interface;
  jsName: JsName;
  func: Func;
  stmts: Stmt[];
}

// Calls `each` on each node `n` holds, in the order its type lists the fields, with a list of
// statements given whole.
export function forEachChild(n: AnyNode, each: (child: AnyNode) => void): void {
  switch (n.of) {
    case "typeNode":
      childrenOfTypeNode(n.node, each);
      break;
    case "expr":
      childrenOfExpr(n.node, each);
      break;
    case "stmt":
      childrenOfStmt(n.node, each);
      break;
    case "tupleElement":
      childrenOfTupleElement(n.node, each);
      break;
    case "typeMember":
      childrenOfTypeMember(n.node, each);
      break;
    case "objectProp":
      childrenOfObjectProp(n.node, each);
      break;
    case "classNode":
      childrenOfClassNode(n.node, each);
      break;
    case "classMember":
      childrenOfClassMember(n.node, each);
      break;
    case "param":
      childrenOfParam(n.node, each);
      break;
    case "pattern":
      childrenOfPattern(n.node, each);
      break;
    case "matchArm":
      childrenOfMatchArm(n.node, each);
      break;
    case "patternProp":
      childrenOfPatternProp(n.node, each);
      break;
    case "specifier":
      childrenOfSpecifier(n.node, each);
      break;
    case "enumMember":
      childrenOfEnumMember(n.node, each);
      break;
    case "switchCase":
      childrenOfSwitchCase(n.node, each);
      break;
    case "declarator":
      childrenOfDeclarator(n.node, each);
      break;
    case "typeParam":
      childrenOfTypeParam(n.node, each);
      break;
    case "typeAlias":
      childrenOfTypeAlias(n.node, each);
      break;
    case "interface":
      childrenOfInterface(n.node, each);
      break;
    case "jsName":
      childrenOfJsName(n.node, each);
      break;
    case "func":
      childrenOfFunc(n.node, each);
      break;
    case "stmts":
      childrenOfStmts(n.node, each);
      break;
  }
}

export function childrenOfTypeNode(n: Ref<TypeNode>, each: (child: AnyNode) => void): void {
  switch (n.kind) {
    case "ref":
      for (const x1 of n.args) {
        each({ of: "typeNode", node: x1 });
      }
      break;
    case "literal":
      each({ of: "expr", node: n.value });
      break;
    case "array":
      each({ of: "typeNode", node: n.element });
      break;
    case "tuple":
      for (const x1 of n.elements) {
        each({ of: "tupleElement", node: x1 });
      }
      break;
    case "object":
      for (const x1 of n.members) {
        each({ of: "typeMember", node: x1 });
      }
      break;
    case "function":
      for (const x1 of n.typeParams) {
        each({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.params) {
        each({ of: "param", node: x1 });
      }
      each({ of: "typeNode", node: n.returns });
      if (n.throws !== undefined) {
        each({ of: "typeNode", node: n.throws! });
      }
      break;
    case "union":
      for (const x1 of n.types) {
        each({ of: "typeNode", node: x1 });
      }
      break;
    case "intersection":
      for (const x1 of n.types) {
        each({ of: "typeNode", node: x1 });
      }
      break;
    case "operator":
      each({ of: "typeNode", node: n.type });
      break;
    case "indexed":
      each({ of: "typeNode", node: n.object });
      each({ of: "typeNode", node: n.index });
      break;
    case "query":
      each({ of: "typeNode", node: n.target });
      break;
    case "import":
      for (const x1 of n.args) {
        each({ of: "typeNode", node: x1 });
      }
      break;
    case "conditional":
      each({ of: "typeNode", node: n.check });
      each({ of: "typeNode", node: n.extends });
      each({ of: "typeNode", node: n.then });
      each({ of: "typeNode", node: n.else });
      break;
    case "infer":
      if (n.constraint !== undefined) {
        each({ of: "typeNode", node: n.constraint! });
      }
      break;
    case "template":
      for (const x1 of n.types) {
        each({ of: "typeNode", node: x1 });
      }
      break;
    case "mapped":
      each({ of: "typeNode", node: n.constraint });
      if (n.as !== undefined) {
        each({ of: "typeNode", node: n.as! });
      }
      if (n.type !== undefined) {
        each({ of: "typeNode", node: n.type! });
      }
      break;
    case "predicate":
      if (n.type !== undefined) {
        each({ of: "typeNode", node: n.type! });
      }
      break;
  }
}

export function childrenOfExpr(n: Ref<Expr>, each: (child: AnyNode) => void): void {
  switch (n.kind) {
    case "template":
      for (const x1 of n.exprs) {
        each({ of: "expr", node: x1 });
      }
      break;
    case "tagged":
      each({ of: "expr", node: n.tag });
      for (const x1 of n.typeArgs) {
        each({ of: "typeNode", node: x1 });
      }
      each({ of: "expr", node: n.template });
      break;
    case "spread":
      each({ of: "expr", node: n.value });
      break;
    case "array":
      for (const x1 of n.elements) {
        if (x1 !== undefined) {
          each({ of: "expr", node: x1! });
        }
      }
      break;
    case "object":
      for (const x1 of n.props) {
        each({ of: "objectProp", node: x1 });
      }
      break;
    case "function":
      for (const x1 of n.typeParams) {
        each({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.params) {
        each({ of: "param", node: x1 });
      }
      if (n.returnType !== undefined) {
        each({ of: "typeNode", node: n.returnType! });
      }
      each({ of: "stmts", node: n.body });
      break;
    case "arrow":
      for (const x1 of n.typeParams) {
        each({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.params) {
        each({ of: "param", node: x1 });
      }
      if (n.returnType !== undefined) {
        each({ of: "typeNode", node: n.returnType! });
      }
      if (n.throws !== undefined) {
        each({ of: "typeNode", node: n.throws! });
      }
      visitOneOf0(n.body, each);
      break;
    case "member":
      each({ of: "expr", node: n.object });
      break;
    case "index":
      each({ of: "expr", node: n.object });
      each({ of: "expr", node: n.index });
      break;
    case "call":
      each({ of: "expr", node: n.callee });
      for (const x1 of n.typeArgs) {
        each({ of: "typeNode", node: x1 });
      }
      for (const x1 of n.args) {
        each({ of: "expr", node: x1 });
      }
      break;
    case "new":
      each({ of: "expr", node: n.callee });
      for (const x1 of n.typeArgs) {
        each({ of: "typeNode", node: x1 });
      }
      if (n.args !== undefined) {
        for (const x1 of n.args!) {
          each({ of: "expr", node: x1 });
        }
      }
      break;
    case "instantiation":
      each({ of: "expr", node: n.expr });
      for (const x1 of n.typeArgs) {
        each({ of: "typeNode", node: x1 });
      }
      break;
    case "import":
      for (const x1 of n.args) {
        each({ of: "expr", node: x1 });
      }
      break;
    case "nonNull":
      each({ of: "expr", node: n.expr });
      if (n.narrows !== undefined) {
        each({ of: "typeNode", node: n.narrows! });
      }
      break;
    case "throw":
      each({ of: "expr", node: n.value });
      break;
    case "class":
      for (const x1 of n.decorators) {
        each({ of: "expr", node: x1 });
      }
      for (const x1 of n.typeParams) {
        each({ of: "typeParam", node: x1 });
      }
      if (n.extends !== undefined) {
        each({ of: "expr", node: n.extends! });
      }
      for (const x1 of n.implements) {
        each({ of: "typeNode", node: x1 });
      }
      for (const x1 of n.members) {
        each({ of: "classMember", node: x1 });
      }
      break;
    case "unary":
      each({ of: "expr", node: n.operand });
      break;
    case "update":
      each({ of: "expr", node: n.operand });
      break;
    case "binary":
      each({ of: "expr", node: n.left });
      each({ of: "expr", node: n.right });
      break;
    case "conditional":
      each({ of: "expr", node: n.cond });
      each({ of: "expr", node: n.then });
      each({ of: "expr", node: n.else });
      break;
    case "assign":
      each({ of: "expr", node: n.target });
      each({ of: "expr", node: n.value });
      break;
    case "pipe":
      each({ of: "expr", node: n.value });
      each({ of: "expr", node: n.body });
      break;
    case "match":
      each({ of: "expr", node: n.subject });
      for (const x1 of n.arms) {
        each({ of: "matchArm", node: x1 });
      }
      break;
    case "comptime":
      each({ of: "expr", node: n.expr });
      break;
    case "unsafe":
      each({ of: "expr", node: n.expr });
      break;
    case "destructure":
      each({ of: "pattern", node: n.pattern });
      each({ of: "expr", node: n.value });
      break;
    case "sequence":
      for (const x1 of n.exprs) {
        each({ of: "expr", node: x1 });
      }
      break;
    case "yield":
      if (n.value !== undefined) {
        each({ of: "expr", node: n.value! });
      }
      break;
    case "as":
      each({ of: "expr", node: n.expr });
      each({ of: "typeNode", node: n.type });
      break;
    case "satisfies":
      each({ of: "expr", node: n.expr });
      each({ of: "typeNode", node: n.type });
      break;
    case "assertion":
      each({ of: "typeNode", node: n.type });
      each({ of: "expr", node: n.expr });
      break;
  }
}

export function childrenOfStmt(n: Ref<Stmt>, each: (child: AnyNode) => void): void {
  switch (n.kind) {
    case "expr":
      each({ of: "expr", node: n.expr });
      break;
    case "let":
      for (const x1 of n.declarations) {
        each({ of: "declarator", node: x1 });
      }
      break;
    case "return":
      if (n.value !== undefined) {
        each({ of: "expr", node: n.value! });
      }
      break;
    case "if":
      each({ of: "expr", node: n.cond });
      each({ of: "stmts", node: n.then });
      if (n.else !== undefined) {
        each({ of: "stmts", node: n.else! });
      }
      break;
    case "while":
      each({ of: "expr", node: n.cond });
      each({ of: "stmts", node: n.body });
      break;
    case "doWhile":
      each({ of: "stmts", node: n.body });
      each({ of: "expr", node: n.cond });
      break;
    case "switch":
      each({ of: "expr", node: n.discriminant });
      for (const x1 of n.cases) {
        each({ of: "switchCase", node: x1 });
      }
      break;
    case "labeled":
      each({ of: "stmt", node: n.body });
      break;
    case "throw":
      each({ of: "expr", node: n.value });
      break;
    case "try":
      each({ of: "stmts", node: n.block });
      if (n.param !== undefined) {
        each({ of: "pattern", node: n.param! });
      }
      if (n.paramType !== undefined) {
        each({ of: "typeNode", node: n.paramType! });
      }
      if (n.handler !== undefined) {
        each({ of: "stmts", node: n.handler! });
      }
      if (n.finalizer !== undefined) {
        each({ of: "stmts", node: n.finalizer! });
      }
      break;
    case "for":
      if (n.init !== undefined) {
        each({ of: "stmt", node: n.init! });
      }
      if (n.test !== undefined) {
        each({ of: "expr", node: n.test! });
      }
      if (n.update !== undefined) {
        each({ of: "expr", node: n.update! });
      }
      each({ of: "stmts", node: n.body });
      break;
    case "forIn":
      visitOneOf1(n.left, each);
      each({ of: "expr", node: n.right });
      each({ of: "stmts", node: n.body });
      break;
    case "forOf":
      visitOneOf1(n.left, each);
      each({ of: "expr", node: n.right });
      each({ of: "stmts", node: n.body });
      break;
    case "block":
      each({ of: "stmts", node: n.body });
      break;
    case "enum":
      for (const x1 of n.typeParams) {
        each({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.members) {
        each({ of: "enumMember", node: x1 });
      }
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          each({ of: "expr", node: x1 });
        }
      }
      break;
    case "namespace":
      if (n.body !== undefined) {
        each({ of: "stmts", node: n.body! });
      }
      break;
    case "declare":
      each({ of: "stmt", node: n.body });
      break;
    case "comptime":
      each({ of: "stmts", node: n.body });
      break;
    case "unsafe":
      each({ of: "stmts", node: n.body });
      break;
    case "import":
      if (n.named !== undefined) {
        for (const x1 of n.named!) {
          each({ of: "specifier", node: x1 });
        }
      }
      if (n.attributes !== undefined) {
        each({ of: "expr", node: n.attributes! });
      }
      break;
    case "export":
      each({ of: "stmt", node: n.body });
      break;
    case "exportDefault":
      if (n.declaration !== undefined) {
        each({ of: "stmt", node: n.declaration! });
      }
      if (n.value !== undefined) {
        each({ of: "expr", node: n.value! });
      }
      break;
    case "exportNamed":
      for (const x1 of n.specifiers) {
        each({ of: "specifier", node: x1 });
      }
      break;
    case "exportAssign":
      each({ of: "expr", node: n.value });
      break;
    case "typeAlias":
      for (const x1 of n.typeParams) {
        each({ of: "typeParam", node: x1 });
      }
      each({ of: "typeNode", node: n.type });
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          each({ of: "expr", node: x1 });
        }
      }
      if (n.js !== undefined) {
        each({ of: "jsName", node: n.js! });
      }
      break;
    case "interface":
      for (const x1 of n.typeParams) {
        each({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.extends) {
        each({ of: "typeNode", node: x1 });
      }
      for (const x1 of n.members) {
        each({ of: "typeMember", node: x1 });
      }
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          each({ of: "expr", node: x1 });
        }
      }
      if (n.js !== undefined) {
        each({ of: "jsName", node: n.js! });
      }
      if (n.jsClass !== undefined) {
        for (const x1 of n.jsClass!.constructors) {
          for (const x2 of x1) {
            each({ of: "param", node: x2 });
          }
        }
        for (const x1 of n.jsClass!.statics) {
          each({ of: "typeMember", node: x1 });
        }
      }
      if (n.jsSource !== undefined) {
        each({ of: "stmt", node: n.jsSource! });
      }
      break;
    case "function":
      for (const x1 of n.typeParams) {
        each({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.params) {
        each({ of: "param", node: x1 });
      }
      if (n.returnType !== undefined) {
        each({ of: "typeNode", node: n.returnType! });
      }
      if (n.throws !== undefined) {
        each({ of: "typeNode", node: n.throws! });
      }
      if (n.body !== undefined) {
        each({ of: "stmts", node: n.body! });
      }
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          each({ of: "expr", node: x1 });
        }
      }
      if (n.js !== undefined) {
        each({ of: "jsName", node: n.js! });
      }
      break;
    case "class":
      for (const x1 of n.decorators) {
        each({ of: "expr", node: x1 });
      }
      for (const x1 of n.typeParams) {
        each({ of: "typeParam", node: x1 });
      }
      if (n.extends !== undefined) {
        each({ of: "expr", node: n.extends! });
      }
      for (const x1 of n.implements) {
        each({ of: "typeNode", node: x1 });
      }
      for (const x1 of n.members) {
        each({ of: "classMember", node: x1 });
      }
      break;
  }
}

export function childrenOfTupleElement(n: Ref<TupleElement>, each: (child: AnyNode) => void): void {
  each({ of: "typeNode", node: n.type });
}

export function childrenOfTypeMember(n: Ref<TypeMember>, each: (child: AnyNode) => void): void {
  switch (n.kind) {
    case "property":
      visitOneOf2(n.name, each);
      if (n.type !== undefined) {
        each({ of: "typeNode", node: n.type! });
      }
      break;
    case "method":
      visitOneOf2(n.name, each);
      for (const x1 of n.typeParams) {
        each({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.params) {
        each({ of: "param", node: x1 });
      }
      if (n.returns !== undefined) {
        each({ of: "typeNode", node: n.returns! });
      }
      break;
    case "call":
      for (const x1 of n.typeParams) {
        each({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.params) {
        each({ of: "param", node: x1 });
      }
      if (n.returns !== undefined) {
        each({ of: "typeNode", node: n.returns! });
      }
      break;
    case "construct":
      for (const x1 of n.typeParams) {
        each({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.params) {
        each({ of: "param", node: x1 });
      }
      if (n.returns !== undefined) {
        each({ of: "typeNode", node: n.returns! });
      }
      break;
    case "index":
      for (const x1 of n.params) {
        each({ of: "param", node: x1 });
      }
      each({ of: "typeNode", node: n.type });
      break;
    case "get":
      visitOneOf2(n.name, each);
      for (const x1 of n.params) {
        each({ of: "param", node: x1 });
      }
      if (n.returns !== undefined) {
        each({ of: "typeNode", node: n.returns! });
      }
      break;
    case "set":
      visitOneOf2(n.name, each);
      for (const x1 of n.params) {
        each({ of: "param", node: x1 });
      }
      if (n.returns !== undefined) {
        each({ of: "typeNode", node: n.returns! });
      }
      break;
  }
}

export function childrenOfObjectProp(n: Ref<ObjectProp>, each: (child: AnyNode) => void): void {
  switch (n.kind) {
    case "property":
      visitOneOf2(n.key, each);
      each({ of: "expr", node: n.value });
      break;
    case "shorthand":
      if (n.default !== undefined) {
        each({ of: "expr", node: n.default! });
      }
      break;
    case "spread":
      each({ of: "expr", node: n.value });
      break;
    case "method":
      visitOneOf2(n.key, each);
      for (const x1 of n.typeParams) {
        each({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.params) {
        each({ of: "param", node: x1 });
      }
      if (n.returnType !== undefined) {
        each({ of: "typeNode", node: n.returnType! });
      }
      each({ of: "stmts", node: n.body });
      break;
    case "get":
      visitOneOf2(n.key, each);
      for (const x1 of n.params) {
        each({ of: "param", node: x1 });
      }
      if (n.returnType !== undefined) {
        each({ of: "typeNode", node: n.returnType! });
      }
      each({ of: "stmts", node: n.body });
      break;
    case "set":
      visitOneOf2(n.key, each);
      for (const x1 of n.params) {
        each({ of: "param", node: x1 });
      }
      if (n.returnType !== undefined) {
        each({ of: "typeNode", node: n.returnType! });
      }
      each({ of: "stmts", node: n.body });
      break;
  }
}

export function childrenOfClassNode(n: Ref<ClassNode>, each: (child: AnyNode) => void): void {
  for (const x1 of n.decorators) {
    each({ of: "expr", node: x1 });
  }
  for (const x1 of n.typeParams) {
    each({ of: "typeParam", node: x1 });
  }
  if (n.extends !== undefined) {
    each({ of: "expr", node: n.extends! });
  }
  for (const x1 of n.implements) {
    each({ of: "typeNode", node: x1 });
  }
  for (const x1 of n.members) {
    each({ of: "classMember", node: x1 });
  }
}

export function childrenOfClassMember(n: Ref<ClassMember>, each: (child: AnyNode) => void): void {
  switch (n.kind) {
    case "field":
      for (const x1 of n.decorators) {
        each({ of: "expr", node: x1 });
      }
      visitOneOf2(n.name, each);
      if (n.type !== undefined) {
        each({ of: "typeNode", node: n.type! });
      }
      if (n.init !== undefined) {
        each({ of: "expr", node: n.init! });
      }
      break;
    case "method":
      for (const x1 of n.decorators) {
        each({ of: "expr", node: x1 });
      }
      visitOneOf2(n.name, each);
      for (const x1 of n.typeParams) {
        each({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.params) {
        each({ of: "param", node: x1 });
      }
      if (n.returnType !== undefined) {
        each({ of: "typeNode", node: n.returnType! });
      }
      if (n.throws !== undefined) {
        each({ of: "typeNode", node: n.throws! });
      }
      if (n.body !== undefined) {
        each({ of: "stmts", node: n.body! });
      }
      break;
    case "constructor":
      for (const x1 of n.decorators) {
        each({ of: "expr", node: x1 });
      }
      for (const x1 of n.params) {
        each({ of: "param", node: x1 });
      }
      if (n.throws !== undefined) {
        each({ of: "typeNode", node: n.throws! });
      }
      if (n.body !== undefined) {
        each({ of: "stmts", node: n.body! });
      }
      break;
    case "get":
      for (const x1 of n.decorators) {
        each({ of: "expr", node: x1 });
      }
      visitOneOf2(n.name, each);
      for (const x1 of n.params) {
        each({ of: "param", node: x1 });
      }
      if (n.returnType !== undefined) {
        each({ of: "typeNode", node: n.returnType! });
      }
      if (n.throws !== undefined) {
        each({ of: "typeNode", node: n.throws! });
      }
      if (n.body !== undefined) {
        each({ of: "stmts", node: n.body! });
      }
      break;
    case "set":
      for (const x1 of n.decorators) {
        each({ of: "expr", node: x1 });
      }
      visitOneOf2(n.name, each);
      for (const x1 of n.params) {
        each({ of: "param", node: x1 });
      }
      if (n.returnType !== undefined) {
        each({ of: "typeNode", node: n.returnType! });
      }
      if (n.throws !== undefined) {
        each({ of: "typeNode", node: n.throws! });
      }
      if (n.body !== undefined) {
        each({ of: "stmts", node: n.body! });
      }
      break;
    case "index":
      for (const x1 of n.decorators) {
        each({ of: "expr", node: x1 });
      }
      for (const x1 of n.params) {
        each({ of: "param", node: x1 });
      }
      each({ of: "typeNode", node: n.type });
      break;
    case "staticBlock":
      for (const x1 of n.decorators) {
        each({ of: "expr", node: x1 });
      }
      each({ of: "stmts", node: n.body });
      break;
  }
}

export function childrenOfParam(n: Ref<Param>, each: (child: AnyNode) => void): void {
  each({ of: "pattern", node: n.pattern });
  if (n.type !== undefined) {
    each({ of: "typeNode", node: n.type! });
  }
  if (n.default !== undefined) {
    each({ of: "expr", node: n.default! });
  }
  for (const x1 of n.decorators) {
    each({ of: "expr", node: x1 });
  }
}

export function childrenOfPattern(n: Ref<Pattern>, each: (child: AnyNode) => void): void {
  switch (n.kind) {
    case "object":
      for (const x1 of n.props) {
        each({ of: "patternProp", node: x1 });
      }
      if (n.rest !== undefined) {
        each({ of: "pattern", node: n.rest! });
      }
      break;
    case "array":
      for (const x1 of n.elements) {
        if (x1 !== undefined) {
          each({ of: "pattern", node: x1! });
        }
      }
      if (n.rest !== undefined) {
        each({ of: "pattern", node: n.rest! });
      }
      break;
    case "default":
      each({ of: "pattern", node: n.target });
      each({ of: "expr", node: n.value });
      break;
    case "expr":
      each({ of: "expr", node: n.expr });
      break;
    case "literal":
      each({ of: "expr", node: n.value });
      break;
    case "variant":
      if (n.args !== undefined) {
        for (const x1 of n.args!) {
          each({ of: "pattern", node: x1 });
        }
      }
      break;
    case "or":
      for (const x1 of n.patterns) {
        each({ of: "pattern", node: x1 });
      }
      break;
  }
}

export function childrenOfMatchArm(n: Ref<MatchArm>, each: (child: AnyNode) => void): void {
  each({ of: "pattern", node: n.pattern });
  if (n.guard !== undefined) {
    each({ of: "expr", node: n.guard! });
  }
  visitOneOf3(n.body, each);
}

export function childrenOfPatternProp(n: Ref<PatternProp>, each: (child: AnyNode) => void): void {
  visitOneOf2(n.key, each);
  each({ of: "pattern", node: n.value });
}

export function childrenOfSpecifier(_n: Ref<Specifier>, _each: (child: AnyNode) => void): void {
}

export function childrenOfEnumMember(n: Ref<EnumMember>, each: (child: AnyNode) => void): void {
  if (n.init !== undefined) {
    each({ of: "expr", node: n.init! });
  }
  if (n.payload !== undefined) {
    for (const x1 of n.payload!) {
      each({ of: "typeNode", node: x1 });
    }
  }
}

export function childrenOfSwitchCase(n: Ref<SwitchCase>, each: (child: AnyNode) => void): void {
  if (n.test !== undefined) {
    each({ of: "expr", node: n.test! });
  }
  each({ of: "stmts", node: n.body });
}

export function childrenOfDeclarator(n: Ref<Declarator>, each: (child: AnyNode) => void): void {
  each({ of: "pattern", node: n.target });
  if (n.type !== undefined) {
    each({ of: "typeNode", node: n.type! });
  }
  if (n.init !== undefined) {
    each({ of: "expr", node: n.init! });
  }
}

export function childrenOfTypeParam(n: Ref<TypeParam>, each: (child: AnyNode) => void): void {
  if (n.constraint !== undefined) {
    each({ of: "typeNode", node: n.constraint! });
  }
  if (n.default !== undefined) {
    each({ of: "typeNode", node: n.default! });
  }
}

export function childrenOfTypeAlias(n: Ref<TypeAlias>, each: (child: AnyNode) => void): void {
  switch (n.kind) {
    case "typeAlias":
      for (const x1 of n.typeParams) {
        each({ of: "typeParam", node: x1 });
      }
      each({ of: "typeNode", node: n.type });
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          each({ of: "expr", node: x1 });
        }
      }
      if (n.js !== undefined) {
        each({ of: "jsName", node: n.js! });
      }
      break;
  }
}

export function childrenOfInterface(n: Ref<Interface>, each: (child: AnyNode) => void): void {
  switch (n.kind) {
    case "interface":
      for (const x1 of n.typeParams) {
        each({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.extends) {
        each({ of: "typeNode", node: x1 });
      }
      for (const x1 of n.members) {
        each({ of: "typeMember", node: x1 });
      }
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          each({ of: "expr", node: x1 });
        }
      }
      if (n.js !== undefined) {
        each({ of: "jsName", node: n.js! });
      }
      if (n.jsClass !== undefined) {
        for (const x1 of n.jsClass!.constructors) {
          for (const x2 of x1) {
            each({ of: "param", node: x2 });
          }
        }
        for (const x1 of n.jsClass!.statics) {
          each({ of: "typeMember", node: x1 });
        }
      }
      if (n.jsSource !== undefined) {
        each({ of: "stmt", node: n.jsSource! });
      }
      break;
  }
}

export function childrenOfJsName(n: Ref<JsName>, each: (child: AnyNode) => void): void {
  if (n.overloads !== undefined) {
    for (const x1 of n.overloads!) {
      each({ of: "func", node: x1 });
    }
  }
}

export function childrenOfFunc(n: Ref<Func>, each: (child: AnyNode) => void): void {
  switch (n.kind) {
    case "function":
      for (const x1 of n.typeParams) {
        each({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.params) {
        each({ of: "param", node: x1 });
      }
      if (n.returnType !== undefined) {
        each({ of: "typeNode", node: n.returnType! });
      }
      if (n.throws !== undefined) {
        each({ of: "typeNode", node: n.throws! });
      }
      if (n.body !== undefined) {
        each({ of: "stmts", node: n.body! });
      }
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          each({ of: "expr", node: x1 });
        }
      }
      if (n.js !== undefined) {
        each({ of: "jsName", node: n.js! });
      }
      break;
  }
}

export function childrenOfStmts(n: Ref<Stmt[]>, each: (child: AnyNode) => void): void {
  for (const x of n) {
    each({ of: "stmt", node: x });
  }
}

// Expr | Stmt[]
export function visitOneOf0(n: Ref<Expr | Stmt[]>, each: (child: AnyNode) => void): void {
  if (Array.isArray(n)) {
    each({ of: "stmts", node: n });
    return;
  }
  each({ of: "expr", node: n });
}

// Stmt | Pattern
export function visitOneOf1(n: Ref<Stmt | Pattern>, each: (child: AnyNode) => void): void {
  switch (n.kind) {
    case "expr":
      each({ of: "stmt", node: n });
      break;
    case "let":
      each({ of: "stmt", node: n });
      break;
    case "return":
      each({ of: "stmt", node: n });
      break;
    case "if":
      each({ of: "stmt", node: n });
      break;
    case "while":
      each({ of: "stmt", node: n });
      break;
    case "doWhile":
      each({ of: "stmt", node: n });
      break;
    case "switch":
      each({ of: "stmt", node: n });
      break;
    case "labeled":
      each({ of: "stmt", node: n });
      break;
    case "break":
      each({ of: "stmt", node: n });
      break;
    case "continue":
      each({ of: "stmt", node: n });
      break;
    case "throw":
      each({ of: "stmt", node: n });
      break;
    case "try":
      each({ of: "stmt", node: n });
      break;
    case "for":
      each({ of: "stmt", node: n });
      break;
    case "forIn":
      each({ of: "stmt", node: n });
      break;
    case "forOf":
      each({ of: "stmt", node: n });
      break;
    case "block":
      each({ of: "stmt", node: n });
      break;
    case "empty":
      each({ of: "stmt", node: n });
      break;
    case "debugger":
      each({ of: "stmt", node: n });
      break;
    case "enum":
      each({ of: "stmt", node: n });
      break;
    case "namespace":
      each({ of: "stmt", node: n });
      break;
    case "declare":
      each({ of: "stmt", node: n });
      break;
    case "comptime":
      each({ of: "stmt", node: n });
      break;
    case "unsafe":
      each({ of: "stmt", node: n });
      break;
    case "import":
      each({ of: "stmt", node: n });
      break;
    case "importEquals":
      each({ of: "stmt", node: n });
      break;
    case "export":
      each({ of: "stmt", node: n });
      break;
    case "exportDefault":
      each({ of: "stmt", node: n });
      break;
    case "exportNamed":
      each({ of: "stmt", node: n });
      break;
    case "exportAll":
      each({ of: "stmt", node: n });
      break;
    case "exportAssign":
      each({ of: "stmt", node: n });
      break;
    case "exportAsNamespace":
      each({ of: "stmt", node: n });
      break;
    case "typeAlias":
      each({ of: "stmt", node: n });
      break;
    case "interface":
      each({ of: "stmt", node: n });
      break;
    case "function":
      each({ of: "stmt", node: n });
      break;
    case "class":
      each({ of: "stmt", node: n });
      break;
    case "ident":
      each({ of: "pattern", node: n });
      break;
    case "object":
      each({ of: "pattern", node: n });
      break;
    case "array":
      each({ of: "pattern", node: n });
      break;
    case "default":
      each({ of: "pattern", node: n });
      break;
    case "wildcard":
      each({ of: "pattern", node: n });
      break;
    case "literal":
      each({ of: "pattern", node: n });
      break;
    case "variant":
      each({ of: "pattern", node: n });
      break;
    case "or":
      each({ of: "pattern", node: n });
      break;
  }
}

// PropertyName
export function visitOneOf2(n: Ref<PropertyName>, each: (child: AnyNode) => void): void {
  if (typeof n === "string") return;
  each({ of: "expr", node: n });
}

// Expr | Extract<Stmt, { kind: "block" }>
export function visitOneOf3(n: Ref<Expr | Extract<Stmt, { kind: "block" }>>, each: (child: AnyNode) => void): void {
  switch (n.kind) {
    case "int":
      each({ of: "expr", node: n });
      break;
    case "float":
      each({ of: "expr", node: n });
      break;
    case "bigint":
      each({ of: "expr", node: n });
      break;
    case "null":
      each({ of: "expr", node: n });
      break;
    case "this":
      each({ of: "expr", node: n });
      break;
    case "super":
      each({ of: "expr", node: n });
      break;
    case "regex":
      each({ of: "expr", node: n });
      break;
    case "template":
      each({ of: "expr", node: n });
      break;
    case "tagged":
      each({ of: "expr", node: n });
      break;
    case "bool":
      each({ of: "expr", node: n });
      break;
    case "string":
      each({ of: "expr", node: n });
      break;
    case "ident":
      each({ of: "expr", node: n });
      break;
    case "spread":
      each({ of: "expr", node: n });
      break;
    case "array":
      each({ of: "expr", node: n });
      break;
    case "object":
      each({ of: "expr", node: n });
      break;
    case "function":
      each({ of: "expr", node: n });
      break;
    case "arrow":
      each({ of: "expr", node: n });
      break;
    case "member":
      each({ of: "expr", node: n });
      break;
    case "index":
      each({ of: "expr", node: n });
      break;
    case "call":
      each({ of: "expr", node: n });
      break;
    case "new":
      each({ of: "expr", node: n });
      break;
    case "instantiation":
      each({ of: "expr", node: n });
      break;
    case "meta":
      each({ of: "expr", node: n });
      break;
    case "import":
      each({ of: "expr", node: n });
      break;
    case "nonNull":
      each({ of: "expr", node: n });
      break;
    case "throw":
      each({ of: "expr", node: n });
      break;
    case "class":
      each({ of: "expr", node: n });
      break;
    case "privateName":
      each({ of: "expr", node: n });
      break;
    case "unary":
      each({ of: "expr", node: n });
      break;
    case "update":
      each({ of: "expr", node: n });
      break;
    case "binary":
      each({ of: "expr", node: n });
      break;
    case "conditional":
      each({ of: "expr", node: n });
      break;
    case "assign":
      each({ of: "expr", node: n });
      break;
    case "pipe":
      each({ of: "expr", node: n });
      break;
    case "topic":
      each({ of: "expr", node: n });
      break;
    case "match":
      each({ of: "expr", node: n });
      break;
    case "comptime":
      each({ of: "expr", node: n });
      break;
    case "unsafe":
      each({ of: "expr", node: n });
      break;
    case "destructure":
      each({ of: "expr", node: n });
      break;
    case "sequence":
      each({ of: "expr", node: n });
      break;
    case "yield":
      each({ of: "expr", node: n });
      break;
    case "as":
      each({ of: "expr", node: n });
      break;
    case "satisfies":
      each({ of: "expr", node: n });
      break;
    case "assertion":
      each({ of: "expr", node: n });
      break;
    case "block":
      each({ of: "stmt", node: n });
      break;
  }
}
