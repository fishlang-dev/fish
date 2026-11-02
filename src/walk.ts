// Generated from the parser's AST types by `bun scripts/walkgen.ts`; a test fails when it is stale.
// Each `childrenOf` function hands each node a node holds to the visitor, tagged, in the order
// its type lists the fields.
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
export type NodeTypes = {
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
};

// What a walk does at each node it reaches. Its method visits a node's children by calling
// `forEachChild`, or skips them by not calling it.
export interface Visitor {
  node(this: Mut<this>, n: AnyNode): void;
}

// Hands each node `n` holds to `v`, in the order its type lists the fields, with a list of
// statements given whole.
export function forEachChild<V extends Visitor>(n: AnyNode, v: Mut<V>): void {
  switch (n.of) {
    case "typeNode":
      childrenOfTypeNode(n.node, v);
      break;
    case "expr":
      childrenOfExpr(n.node, v);
      break;
    case "stmt":
      childrenOfStmt(n.node, v);
      break;
    case "tupleElement":
      childrenOfTupleElement(n.node, v);
      break;
    case "typeMember":
      childrenOfTypeMember(n.node, v);
      break;
    case "objectProp":
      childrenOfObjectProp(n.node, v);
      break;
    case "classNode":
      childrenOfClassNode(n.node, v);
      break;
    case "classMember":
      childrenOfClassMember(n.node, v);
      break;
    case "param":
      childrenOfParam(n.node, v);
      break;
    case "pattern":
      childrenOfPattern(n.node, v);
      break;
    case "matchArm":
      childrenOfMatchArm(n.node, v);
      break;
    case "patternProp":
      childrenOfPatternProp(n.node, v);
      break;
    case "specifier":
      childrenOfSpecifier(n.node, v);
      break;
    case "enumMember":
      childrenOfEnumMember(n.node, v);
      break;
    case "switchCase":
      childrenOfSwitchCase(n.node, v);
      break;
    case "declarator":
      childrenOfDeclarator(n.node, v);
      break;
    case "typeParam":
      childrenOfTypeParam(n.node, v);
      break;
    case "typeAlias":
      childrenOfTypeAlias(n.node, v);
      break;
    case "interface":
      childrenOfInterface(n.node, v);
      break;
    case "jsName":
      childrenOfJsName(n.node, v);
      break;
    case "func":
      childrenOfFunc(n.node, v);
      break;
    case "stmts":
      childrenOfStmts(n.node, v);
      break;
  }
}

export function childrenOfTypeNode<V extends Visitor>(n: Ref<TypeNode>, v: Mut<V>): void {
  switch (n.kind) {
    case "ref":
      for (const x1 of n.args) {
        v.node({ of: "typeNode", node: x1 });
      }
      break;
    case "literal":
      v.node({ of: "expr", node: n.value });
      break;
    case "array":
      v.node({ of: "typeNode", node: n.element });
      break;
    case "tuple":
      for (const x1 of n.elements) {
        v.node({ of: "tupleElement", node: x1 });
      }
      break;
    case "object":
      for (const x1 of n.members) {
        v.node({ of: "typeMember", node: x1 });
      }
      break;
    case "function":
      for (const x1 of n.typeParams) {
        v.node({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.params) {
        v.node({ of: "param", node: x1 });
      }
      v.node({ of: "typeNode", node: n.returns });
      if (n.throws !== undefined) {
        v.node({ of: "typeNode", node: n.throws! });
      }
      break;
    case "union":
      for (const x1 of n.types) {
        v.node({ of: "typeNode", node: x1 });
      }
      break;
    case "intersection":
      for (const x1 of n.types) {
        v.node({ of: "typeNode", node: x1 });
      }
      break;
    case "operator":
      v.node({ of: "typeNode", node: n.type });
      break;
    case "indexed":
      v.node({ of: "typeNode", node: n.object });
      v.node({ of: "typeNode", node: n.index });
      break;
    case "query":
      v.node({ of: "typeNode", node: n.target });
      break;
    case "import":
      for (const x1 of n.args) {
        v.node({ of: "typeNode", node: x1 });
      }
      break;
    case "conditional":
      v.node({ of: "typeNode", node: n.check });
      v.node({ of: "typeNode", node: n.extends });
      v.node({ of: "typeNode", node: n.then });
      v.node({ of: "typeNode", node: n.else });
      break;
    case "infer":
      if (n.constraint !== undefined) {
        v.node({ of: "typeNode", node: n.constraint! });
      }
      break;
    case "template":
      for (const x1 of n.types) {
        v.node({ of: "typeNode", node: x1 });
      }
      break;
    case "mapped":
      v.node({ of: "typeNode", node: n.constraint });
      if (n.as !== undefined) {
        v.node({ of: "typeNode", node: n.as! });
      }
      if (n.type !== undefined) {
        v.node({ of: "typeNode", node: n.type! });
      }
      break;
    case "predicate":
      if (n.type !== undefined) {
        v.node({ of: "typeNode", node: n.type! });
      }
      break;
  }
}

export function childrenOfExpr<V extends Visitor>(n: Ref<Expr>, v: Mut<V>): void {
  switch (n.kind) {
    case "template":
      for (const x1 of n.exprs) {
        v.node({ of: "expr", node: x1 });
      }
      break;
    case "tagged":
      v.node({ of: "expr", node: n.tag });
      for (const x1 of n.typeArgs) {
        v.node({ of: "typeNode", node: x1 });
      }
      v.node({ of: "expr", node: n.template });
      break;
    case "spread":
      v.node({ of: "expr", node: n.value });
      break;
    case "array":
      for (const x1 of n.elements) {
        if (x1 !== undefined) {
          v.node({ of: "expr", node: x1! });
        }
      }
      break;
    case "object":
      for (const x1 of n.props) {
        v.node({ of: "objectProp", node: x1 });
      }
      break;
    case "function":
      for (const x1 of n.typeParams) {
        v.node({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.params) {
        v.node({ of: "param", node: x1 });
      }
      if (n.returnType !== undefined) {
        v.node({ of: "typeNode", node: n.returnType! });
      }
      v.node({ of: "stmts", node: n.body });
      break;
    case "arrow":
      for (const x1 of n.typeParams) {
        v.node({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.params) {
        v.node({ of: "param", node: x1 });
      }
      if (n.returnType !== undefined) {
        v.node({ of: "typeNode", node: n.returnType! });
      }
      if (n.throws !== undefined) {
        v.node({ of: "typeNode", node: n.throws! });
      }
      visitOneOf0(n.body, v);
      break;
    case "member":
      v.node({ of: "expr", node: n.object });
      break;
    case "index":
      v.node({ of: "expr", node: n.object });
      v.node({ of: "expr", node: n.index });
      break;
    case "call":
      v.node({ of: "expr", node: n.callee });
      for (const x1 of n.typeArgs) {
        v.node({ of: "typeNode", node: x1 });
      }
      for (const x1 of n.args) {
        v.node({ of: "expr", node: x1 });
      }
      break;
    case "new":
      v.node({ of: "expr", node: n.callee });
      for (const x1 of n.typeArgs) {
        v.node({ of: "typeNode", node: x1 });
      }
      if (n.args !== undefined) {
        for (const x1 of n.args!) {
          v.node({ of: "expr", node: x1 });
        }
      }
      break;
    case "instantiation":
      v.node({ of: "expr", node: n.expr });
      for (const x1 of n.typeArgs) {
        v.node({ of: "typeNode", node: x1 });
      }
      break;
    case "import":
      for (const x1 of n.args) {
        v.node({ of: "expr", node: x1 });
      }
      break;
    case "nonNull":
      v.node({ of: "expr", node: n.expr });
      if (n.narrows !== undefined) {
        v.node({ of: "typeNode", node: n.narrows! });
      }
      break;
    case "throw":
      v.node({ of: "expr", node: n.value });
      break;
    case "class":
      for (const x1 of n.decorators) {
        v.node({ of: "expr", node: x1 });
      }
      for (const x1 of n.typeParams) {
        v.node({ of: "typeParam", node: x1 });
      }
      if (n.extends !== undefined) {
        v.node({ of: "expr", node: n.extends! });
      }
      for (const x1 of n.implements) {
        v.node({ of: "typeNode", node: x1 });
      }
      for (const x1 of n.members) {
        v.node({ of: "classMember", node: x1 });
      }
      break;
    case "unary":
      v.node({ of: "expr", node: n.operand });
      break;
    case "update":
      v.node({ of: "expr", node: n.operand });
      break;
    case "binary":
      v.node({ of: "expr", node: n.left });
      v.node({ of: "expr", node: n.right });
      break;
    case "conditional":
      v.node({ of: "expr", node: n.cond });
      v.node({ of: "expr", node: n.then });
      v.node({ of: "expr", node: n.else });
      break;
    case "assign":
      v.node({ of: "expr", node: n.target });
      v.node({ of: "expr", node: n.value });
      break;
    case "pipe":
      v.node({ of: "expr", node: n.value });
      v.node({ of: "expr", node: n.body });
      break;
    case "match":
      v.node({ of: "expr", node: n.subject });
      for (const x1 of n.arms) {
        v.node({ of: "matchArm", node: x1 });
      }
      break;
    case "comptime":
      v.node({ of: "expr", node: n.expr });
      break;
    case "unsafe":
      v.node({ of: "expr", node: n.expr });
      break;
    case "destructure":
      v.node({ of: "pattern", node: n.pattern });
      v.node({ of: "expr", node: n.value });
      break;
    case "sequence":
      for (const x1 of n.exprs) {
        v.node({ of: "expr", node: x1 });
      }
      break;
    case "yield":
      if (n.value !== undefined) {
        v.node({ of: "expr", node: n.value! });
      }
      break;
    case "as":
      v.node({ of: "expr", node: n.expr });
      v.node({ of: "typeNode", node: n.type });
      break;
    case "satisfies":
      v.node({ of: "expr", node: n.expr });
      v.node({ of: "typeNode", node: n.type });
      break;
    case "assertion":
      v.node({ of: "typeNode", node: n.type });
      v.node({ of: "expr", node: n.expr });
      break;
  }
}

export function childrenOfStmt<V extends Visitor>(n: Ref<Stmt>, v: Mut<V>): void {
  switch (n.kind) {
    case "expr":
      v.node({ of: "expr", node: n.expr });
      break;
    case "let":
      for (const x1 of n.declarations) {
        v.node({ of: "declarator", node: x1 });
      }
      break;
    case "return":
      if (n.value !== undefined) {
        v.node({ of: "expr", node: n.value! });
      }
      break;
    case "if":
      v.node({ of: "expr", node: n.cond });
      v.node({ of: "stmts", node: n.then });
      if (n.else !== undefined) {
        v.node({ of: "stmts", node: n.else! });
      }
      break;
    case "while":
      v.node({ of: "expr", node: n.cond });
      v.node({ of: "stmts", node: n.body });
      break;
    case "doWhile":
      v.node({ of: "stmts", node: n.body });
      v.node({ of: "expr", node: n.cond });
      break;
    case "switch":
      v.node({ of: "expr", node: n.discriminant });
      for (const x1 of n.cases) {
        v.node({ of: "switchCase", node: x1 });
      }
      break;
    case "labeled":
      v.node({ of: "stmt", node: n.body });
      break;
    case "throw":
      v.node({ of: "expr", node: n.value });
      break;
    case "try":
      v.node({ of: "stmts", node: n.block });
      if (n.param !== undefined) {
        v.node({ of: "pattern", node: n.param! });
      }
      if (n.paramType !== undefined) {
        v.node({ of: "typeNode", node: n.paramType! });
      }
      if (n.handler !== undefined) {
        v.node({ of: "stmts", node: n.handler! });
      }
      if (n.finalizer !== undefined) {
        v.node({ of: "stmts", node: n.finalizer! });
      }
      break;
    case "for":
      if (n.init !== undefined) {
        v.node({ of: "stmt", node: n.init! });
      }
      if (n.test !== undefined) {
        v.node({ of: "expr", node: n.test! });
      }
      if (n.update !== undefined) {
        v.node({ of: "expr", node: n.update! });
      }
      v.node({ of: "stmts", node: n.body });
      break;
    case "forIn":
      visitOneOf1(n.left, v);
      v.node({ of: "expr", node: n.right });
      v.node({ of: "stmts", node: n.body });
      break;
    case "forOf":
      visitOneOf1(n.left, v);
      v.node({ of: "expr", node: n.right });
      v.node({ of: "stmts", node: n.body });
      break;
    case "block":
      v.node({ of: "stmts", node: n.body });
      break;
    case "enum":
      for (const x1 of n.typeParams) {
        v.node({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.members) {
        v.node({ of: "enumMember", node: x1 });
      }
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          v.node({ of: "expr", node: x1 });
        }
      }
      break;
    case "namespace":
      if (n.body !== undefined) {
        v.node({ of: "stmts", node: n.body! });
      }
      break;
    case "declare":
      v.node({ of: "stmt", node: n.body });
      break;
    case "comptime":
      v.node({ of: "stmts", node: n.body });
      break;
    case "unsafe":
      v.node({ of: "stmts", node: n.body });
      break;
    case "import":
      if (n.named !== undefined) {
        for (const x1 of n.named!) {
          v.node({ of: "specifier", node: x1 });
        }
      }
      if (n.attributes !== undefined) {
        v.node({ of: "expr", node: n.attributes! });
      }
      break;
    case "export":
      v.node({ of: "stmt", node: n.body });
      break;
    case "exportDefault":
      if (n.declaration !== undefined) {
        v.node({ of: "stmt", node: n.declaration! });
      }
      if (n.value !== undefined) {
        v.node({ of: "expr", node: n.value! });
      }
      break;
    case "exportNamed":
      for (const x1 of n.specifiers) {
        v.node({ of: "specifier", node: x1 });
      }
      break;
    case "exportAssign":
      v.node({ of: "expr", node: n.value });
      break;
    case "typeAlias":
      for (const x1 of n.typeParams) {
        v.node({ of: "typeParam", node: x1 });
      }
      v.node({ of: "typeNode", node: n.type });
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          v.node({ of: "expr", node: x1 });
        }
      }
      if (n.js !== undefined) {
        v.node({ of: "jsName", node: n.js! });
      }
      break;
    case "interface":
      for (const x1 of n.typeParams) {
        v.node({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.extends) {
        v.node({ of: "typeNode", node: x1 });
      }
      for (const x1 of n.members) {
        v.node({ of: "typeMember", node: x1 });
      }
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          v.node({ of: "expr", node: x1 });
        }
      }
      if (n.js !== undefined) {
        v.node({ of: "jsName", node: n.js! });
      }
      if (n.jsClass !== undefined) {
        for (const x1 of n.jsClass!.constructors) {
          for (const x2 of x1) {
            v.node({ of: "param", node: x2 });
          }
        }
        for (const x1 of n.jsClass!.statics) {
          v.node({ of: "typeMember", node: x1 });
        }
      }
      if (n.jsSource !== undefined) {
        v.node({ of: "stmt", node: n.jsSource! });
      }
      break;
    case "function":
      for (const x1 of n.typeParams) {
        v.node({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.params) {
        v.node({ of: "param", node: x1 });
      }
      if (n.returnType !== undefined) {
        v.node({ of: "typeNode", node: n.returnType! });
      }
      if (n.throws !== undefined) {
        v.node({ of: "typeNode", node: n.throws! });
      }
      if (n.body !== undefined) {
        v.node({ of: "stmts", node: n.body! });
      }
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          v.node({ of: "expr", node: x1 });
        }
      }
      if (n.js !== undefined) {
        v.node({ of: "jsName", node: n.js! });
      }
      break;
    case "class":
      for (const x1 of n.decorators) {
        v.node({ of: "expr", node: x1 });
      }
      for (const x1 of n.typeParams) {
        v.node({ of: "typeParam", node: x1 });
      }
      if (n.extends !== undefined) {
        v.node({ of: "expr", node: n.extends! });
      }
      for (const x1 of n.implements) {
        v.node({ of: "typeNode", node: x1 });
      }
      for (const x1 of n.members) {
        v.node({ of: "classMember", node: x1 });
      }
      break;
  }
}

export function childrenOfTupleElement<V extends Visitor>(n: Ref<TupleElement>, v: Mut<V>): void {
  v.node({ of: "typeNode", node: n.type });
}

export function childrenOfTypeMember<V extends Visitor>(n: Ref<TypeMember>, v: Mut<V>): void {
  switch (n.kind) {
    case "property":
      visitOneOf2(n.name, v);
      if (n.type !== undefined) {
        v.node({ of: "typeNode", node: n.type! });
      }
      break;
    case "method":
      visitOneOf2(n.name, v);
      for (const x1 of n.typeParams) {
        v.node({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.params) {
        v.node({ of: "param", node: x1 });
      }
      if (n.returns !== undefined) {
        v.node({ of: "typeNode", node: n.returns! });
      }
      break;
    case "call":
      for (const x1 of n.typeParams) {
        v.node({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.params) {
        v.node({ of: "param", node: x1 });
      }
      if (n.returns !== undefined) {
        v.node({ of: "typeNode", node: n.returns! });
      }
      break;
    case "construct":
      for (const x1 of n.typeParams) {
        v.node({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.params) {
        v.node({ of: "param", node: x1 });
      }
      if (n.returns !== undefined) {
        v.node({ of: "typeNode", node: n.returns! });
      }
      break;
    case "index":
      for (const x1 of n.params) {
        v.node({ of: "param", node: x1 });
      }
      v.node({ of: "typeNode", node: n.type });
      break;
    case "get":
      visitOneOf2(n.name, v);
      for (const x1 of n.params) {
        v.node({ of: "param", node: x1 });
      }
      if (n.returns !== undefined) {
        v.node({ of: "typeNode", node: n.returns! });
      }
      break;
    case "set":
      visitOneOf2(n.name, v);
      for (const x1 of n.params) {
        v.node({ of: "param", node: x1 });
      }
      if (n.returns !== undefined) {
        v.node({ of: "typeNode", node: n.returns! });
      }
      break;
  }
}

export function childrenOfObjectProp<V extends Visitor>(n: Ref<ObjectProp>, v: Mut<V>): void {
  switch (n.kind) {
    case "property":
      visitOneOf2(n.key, v);
      v.node({ of: "expr", node: n.value });
      break;
    case "shorthand":
      if (n.default !== undefined) {
        v.node({ of: "expr", node: n.default! });
      }
      break;
    case "spread":
      v.node({ of: "expr", node: n.value });
      break;
    case "method":
      visitOneOf2(n.key, v);
      for (const x1 of n.typeParams) {
        v.node({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.params) {
        v.node({ of: "param", node: x1 });
      }
      if (n.returnType !== undefined) {
        v.node({ of: "typeNode", node: n.returnType! });
      }
      v.node({ of: "stmts", node: n.body });
      break;
    case "get":
      visitOneOf2(n.key, v);
      for (const x1 of n.params) {
        v.node({ of: "param", node: x1 });
      }
      if (n.returnType !== undefined) {
        v.node({ of: "typeNode", node: n.returnType! });
      }
      v.node({ of: "stmts", node: n.body });
      break;
    case "set":
      visitOneOf2(n.key, v);
      for (const x1 of n.params) {
        v.node({ of: "param", node: x1 });
      }
      if (n.returnType !== undefined) {
        v.node({ of: "typeNode", node: n.returnType! });
      }
      v.node({ of: "stmts", node: n.body });
      break;
  }
}

export function childrenOfClassNode<V extends Visitor>(n: Ref<ClassNode>, v: Mut<V>): void {
  for (const x1 of n.decorators) {
    v.node({ of: "expr", node: x1 });
  }
  for (const x1 of n.typeParams) {
    v.node({ of: "typeParam", node: x1 });
  }
  if (n.extends !== undefined) {
    v.node({ of: "expr", node: n.extends! });
  }
  for (const x1 of n.implements) {
    v.node({ of: "typeNode", node: x1 });
  }
  for (const x1 of n.members) {
    v.node({ of: "classMember", node: x1 });
  }
}

export function childrenOfClassMember<V extends Visitor>(n: Ref<ClassMember>, v: Mut<V>): void {
  switch (n.kind) {
    case "field":
      for (const x1 of n.decorators) {
        v.node({ of: "expr", node: x1 });
      }
      visitOneOf2(n.name, v);
      if (n.type !== undefined) {
        v.node({ of: "typeNode", node: n.type! });
      }
      if (n.init !== undefined) {
        v.node({ of: "expr", node: n.init! });
      }
      break;
    case "method":
      for (const x1 of n.decorators) {
        v.node({ of: "expr", node: x1 });
      }
      visitOneOf2(n.name, v);
      for (const x1 of n.typeParams) {
        v.node({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.params) {
        v.node({ of: "param", node: x1 });
      }
      if (n.returnType !== undefined) {
        v.node({ of: "typeNode", node: n.returnType! });
      }
      if (n.throws !== undefined) {
        v.node({ of: "typeNode", node: n.throws! });
      }
      if (n.body !== undefined) {
        v.node({ of: "stmts", node: n.body! });
      }
      break;
    case "constructor":
      for (const x1 of n.decorators) {
        v.node({ of: "expr", node: x1 });
      }
      for (const x1 of n.params) {
        v.node({ of: "param", node: x1 });
      }
      if (n.throws !== undefined) {
        v.node({ of: "typeNode", node: n.throws! });
      }
      if (n.body !== undefined) {
        v.node({ of: "stmts", node: n.body! });
      }
      break;
    case "get":
      for (const x1 of n.decorators) {
        v.node({ of: "expr", node: x1 });
      }
      visitOneOf2(n.name, v);
      for (const x1 of n.params) {
        v.node({ of: "param", node: x1 });
      }
      if (n.returnType !== undefined) {
        v.node({ of: "typeNode", node: n.returnType! });
      }
      if (n.throws !== undefined) {
        v.node({ of: "typeNode", node: n.throws! });
      }
      if (n.body !== undefined) {
        v.node({ of: "stmts", node: n.body! });
      }
      break;
    case "set":
      for (const x1 of n.decorators) {
        v.node({ of: "expr", node: x1 });
      }
      visitOneOf2(n.name, v);
      for (const x1 of n.params) {
        v.node({ of: "param", node: x1 });
      }
      if (n.returnType !== undefined) {
        v.node({ of: "typeNode", node: n.returnType! });
      }
      if (n.throws !== undefined) {
        v.node({ of: "typeNode", node: n.throws! });
      }
      if (n.body !== undefined) {
        v.node({ of: "stmts", node: n.body! });
      }
      break;
    case "index":
      for (const x1 of n.decorators) {
        v.node({ of: "expr", node: x1 });
      }
      for (const x1 of n.params) {
        v.node({ of: "param", node: x1 });
      }
      v.node({ of: "typeNode", node: n.type });
      break;
    case "staticBlock":
      for (const x1 of n.decorators) {
        v.node({ of: "expr", node: x1 });
      }
      v.node({ of: "stmts", node: n.body });
      break;
  }
}

export function childrenOfParam<V extends Visitor>(n: Ref<Param>, v: Mut<V>): void {
  v.node({ of: "pattern", node: n.pattern });
  if (n.type !== undefined) {
    v.node({ of: "typeNode", node: n.type! });
  }
  if (n.default !== undefined) {
    v.node({ of: "expr", node: n.default! });
  }
  for (const x1 of n.decorators) {
    v.node({ of: "expr", node: x1 });
  }
}

export function childrenOfPattern<V extends Visitor>(n: Ref<Pattern>, v: Mut<V>): void {
  switch (n.kind) {
    case "object":
      for (const x1 of n.props) {
        v.node({ of: "patternProp", node: x1 });
      }
      if (n.rest !== undefined) {
        v.node({ of: "pattern", node: n.rest! });
      }
      break;
    case "array":
      for (const x1 of n.elements) {
        if (x1 !== undefined) {
          v.node({ of: "pattern", node: x1! });
        }
      }
      if (n.rest !== undefined) {
        v.node({ of: "pattern", node: n.rest! });
      }
      break;
    case "default":
      v.node({ of: "pattern", node: n.target });
      v.node({ of: "expr", node: n.value });
      break;
    case "expr":
      v.node({ of: "expr", node: n.expr });
      break;
    case "literal":
      v.node({ of: "expr", node: n.value });
      break;
    case "variant":
      if (n.args !== undefined) {
        for (const x1 of n.args!) {
          v.node({ of: "pattern", node: x1 });
        }
      }
      break;
    case "or":
      for (const x1 of n.patterns) {
        v.node({ of: "pattern", node: x1 });
      }
      break;
  }
}

export function childrenOfMatchArm<V extends Visitor>(n: Ref<MatchArm>, v: Mut<V>): void {
  v.node({ of: "pattern", node: n.pattern });
  if (n.guard !== undefined) {
    v.node({ of: "expr", node: n.guard! });
  }
  visitOneOf3(n.body, v);
}

export function childrenOfPatternProp<V extends Visitor>(n: Ref<PatternProp>, v: Mut<V>): void {
  visitOneOf2(n.key, v);
  v.node({ of: "pattern", node: n.value });
}

export function childrenOfSpecifier<V extends Visitor>(_n: Ref<Specifier>, _v: Mut<V>): void {
}

export function childrenOfEnumMember<V extends Visitor>(n: Ref<EnumMember>, v: Mut<V>): void {
  if (n.init !== undefined) {
    v.node({ of: "expr", node: n.init! });
  }
  if (n.payload !== undefined) {
    for (const x1 of n.payload!) {
      v.node({ of: "typeNode", node: x1 });
    }
  }
}

export function childrenOfSwitchCase<V extends Visitor>(n: Ref<SwitchCase>, v: Mut<V>): void {
  if (n.test !== undefined) {
    v.node({ of: "expr", node: n.test! });
  }
  v.node({ of: "stmts", node: n.body });
}

export function childrenOfDeclarator<V extends Visitor>(n: Ref<Declarator>, v: Mut<V>): void {
  v.node({ of: "pattern", node: n.target });
  if (n.type !== undefined) {
    v.node({ of: "typeNode", node: n.type! });
  }
  if (n.init !== undefined) {
    v.node({ of: "expr", node: n.init! });
  }
}

export function childrenOfTypeParam<V extends Visitor>(n: Ref<TypeParam>, v: Mut<V>): void {
  if (n.constraint !== undefined) {
    v.node({ of: "typeNode", node: n.constraint! });
  }
  if (n.default !== undefined) {
    v.node({ of: "typeNode", node: n.default! });
  }
}

export function childrenOfTypeAlias<V extends Visitor>(n: Ref<TypeAlias>, v: Mut<V>): void {
  switch (n.kind) {
    case "typeAlias":
      for (const x1 of n.typeParams) {
        v.node({ of: "typeParam", node: x1 });
      }
      v.node({ of: "typeNode", node: n.type });
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          v.node({ of: "expr", node: x1 });
        }
      }
      if (n.js !== undefined) {
        v.node({ of: "jsName", node: n.js! });
      }
      break;
  }
}

export function childrenOfInterface<V extends Visitor>(n: Ref<Interface>, v: Mut<V>): void {
  switch (n.kind) {
    case "interface":
      for (const x1 of n.typeParams) {
        v.node({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.extends) {
        v.node({ of: "typeNode", node: x1 });
      }
      for (const x1 of n.members) {
        v.node({ of: "typeMember", node: x1 });
      }
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          v.node({ of: "expr", node: x1 });
        }
      }
      if (n.js !== undefined) {
        v.node({ of: "jsName", node: n.js! });
      }
      if (n.jsClass !== undefined) {
        for (const x1 of n.jsClass!.constructors) {
          for (const x2 of x1) {
            v.node({ of: "param", node: x2 });
          }
        }
        for (const x1 of n.jsClass!.statics) {
          v.node({ of: "typeMember", node: x1 });
        }
      }
      if (n.jsSource !== undefined) {
        v.node({ of: "stmt", node: n.jsSource! });
      }
      break;
  }
}

export function childrenOfJsName<V extends Visitor>(n: Ref<JsName>, v: Mut<V>): void {
  if (n.overloads !== undefined) {
    for (const x1 of n.overloads!) {
      v.node({ of: "func", node: x1 });
    }
  }
}

export function childrenOfFunc<V extends Visitor>(n: Ref<Func>, v: Mut<V>): void {
  switch (n.kind) {
    case "function":
      for (const x1 of n.typeParams) {
        v.node({ of: "typeParam", node: x1 });
      }
      for (const x1 of n.params) {
        v.node({ of: "param", node: x1 });
      }
      if (n.returnType !== undefined) {
        v.node({ of: "typeNode", node: n.returnType! });
      }
      if (n.throws !== undefined) {
        v.node({ of: "typeNode", node: n.throws! });
      }
      if (n.body !== undefined) {
        v.node({ of: "stmts", node: n.body! });
      }
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          v.node({ of: "expr", node: x1 });
        }
      }
      if (n.js !== undefined) {
        v.node({ of: "jsName", node: n.js! });
      }
      break;
  }
}

export function childrenOfStmts<V extends Visitor>(n: Ref<Stmt[]>, v: Mut<V>): void {
  for (const x of n) {
    v.node({ of: "stmt", node: x });
  }
}

// Expr | Stmt[]
export function visitOneOf0<V extends Visitor>(n: Ref<Expr | Stmt[]>, v: Mut<V>): void {
  if (Array.isArray(n)) {
    v.node({ of: "stmts", node: n });
    return;
  }
  v.node({ of: "expr", node: n });
}

// Stmt | Pattern
export function visitOneOf1<V extends Visitor>(n: Ref<Stmt | Pattern>, v: Mut<V>): void {
  switch (n.kind) {
    case "expr":
      v.node({ of: "stmt", node: n });
      break;
    case "let":
      v.node({ of: "stmt", node: n });
      break;
    case "return":
      v.node({ of: "stmt", node: n });
      break;
    case "if":
      v.node({ of: "stmt", node: n });
      break;
    case "while":
      v.node({ of: "stmt", node: n });
      break;
    case "doWhile":
      v.node({ of: "stmt", node: n });
      break;
    case "switch":
      v.node({ of: "stmt", node: n });
      break;
    case "labeled":
      v.node({ of: "stmt", node: n });
      break;
    case "break":
      v.node({ of: "stmt", node: n });
      break;
    case "continue":
      v.node({ of: "stmt", node: n });
      break;
    case "throw":
      v.node({ of: "stmt", node: n });
      break;
    case "try":
      v.node({ of: "stmt", node: n });
      break;
    case "for":
      v.node({ of: "stmt", node: n });
      break;
    case "forIn":
      v.node({ of: "stmt", node: n });
      break;
    case "forOf":
      v.node({ of: "stmt", node: n });
      break;
    case "block":
      v.node({ of: "stmt", node: n });
      break;
    case "empty":
      v.node({ of: "stmt", node: n });
      break;
    case "debugger":
      v.node({ of: "stmt", node: n });
      break;
    case "enum":
      v.node({ of: "stmt", node: n });
      break;
    case "namespace":
      v.node({ of: "stmt", node: n });
      break;
    case "declare":
      v.node({ of: "stmt", node: n });
      break;
    case "comptime":
      v.node({ of: "stmt", node: n });
      break;
    case "unsafe":
      v.node({ of: "stmt", node: n });
      break;
    case "import":
      v.node({ of: "stmt", node: n });
      break;
    case "importEquals":
      v.node({ of: "stmt", node: n });
      break;
    case "export":
      v.node({ of: "stmt", node: n });
      break;
    case "exportDefault":
      v.node({ of: "stmt", node: n });
      break;
    case "exportNamed":
      v.node({ of: "stmt", node: n });
      break;
    case "exportAll":
      v.node({ of: "stmt", node: n });
      break;
    case "exportAssign":
      v.node({ of: "stmt", node: n });
      break;
    case "exportAsNamespace":
      v.node({ of: "stmt", node: n });
      break;
    case "typeAlias":
      v.node({ of: "stmt", node: n });
      break;
    case "interface":
      v.node({ of: "stmt", node: n });
      break;
    case "function":
      v.node({ of: "stmt", node: n });
      break;
    case "class":
      v.node({ of: "stmt", node: n });
      break;
    case "ident":
      v.node({ of: "pattern", node: n });
      break;
    case "object":
      v.node({ of: "pattern", node: n });
      break;
    case "array":
      v.node({ of: "pattern", node: n });
      break;
    case "default":
      v.node({ of: "pattern", node: n });
      break;
    case "wildcard":
      v.node({ of: "pattern", node: n });
      break;
    case "literal":
      v.node({ of: "pattern", node: n });
      break;
    case "variant":
      v.node({ of: "pattern", node: n });
      break;
    case "or":
      v.node({ of: "pattern", node: n });
      break;
  }
}

// PropertyName
export function visitOneOf2<V extends Visitor>(n: Ref<PropertyName>, v: Mut<V>): void {
  if (typeof n === "string") return;
  v.node({ of: "expr", node: n });
}

// Expr | Extract<Stmt, { kind: "block" }>
export function visitOneOf3<V extends Visitor>(n: Ref<Expr | Extract<Stmt, { kind: "block" }>>, v: Mut<V>): void {
  switch (n.kind) {
    case "int":
      v.node({ of: "expr", node: n });
      break;
    case "float":
      v.node({ of: "expr", node: n });
      break;
    case "bigint":
      v.node({ of: "expr", node: n });
      break;
    case "null":
      v.node({ of: "expr", node: n });
      break;
    case "this":
      v.node({ of: "expr", node: n });
      break;
    case "super":
      v.node({ of: "expr", node: n });
      break;
    case "regex":
      v.node({ of: "expr", node: n });
      break;
    case "template":
      v.node({ of: "expr", node: n });
      break;
    case "tagged":
      v.node({ of: "expr", node: n });
      break;
    case "bool":
      v.node({ of: "expr", node: n });
      break;
    case "string":
      v.node({ of: "expr", node: n });
      break;
    case "ident":
      v.node({ of: "expr", node: n });
      break;
    case "spread":
      v.node({ of: "expr", node: n });
      break;
    case "array":
      v.node({ of: "expr", node: n });
      break;
    case "object":
      v.node({ of: "expr", node: n });
      break;
    case "function":
      v.node({ of: "expr", node: n });
      break;
    case "arrow":
      v.node({ of: "expr", node: n });
      break;
    case "member":
      v.node({ of: "expr", node: n });
      break;
    case "index":
      v.node({ of: "expr", node: n });
      break;
    case "call":
      v.node({ of: "expr", node: n });
      break;
    case "new":
      v.node({ of: "expr", node: n });
      break;
    case "instantiation":
      v.node({ of: "expr", node: n });
      break;
    case "meta":
      v.node({ of: "expr", node: n });
      break;
    case "import":
      v.node({ of: "expr", node: n });
      break;
    case "nonNull":
      v.node({ of: "expr", node: n });
      break;
    case "throw":
      v.node({ of: "expr", node: n });
      break;
    case "class":
      v.node({ of: "expr", node: n });
      break;
    case "privateName":
      v.node({ of: "expr", node: n });
      break;
    case "unary":
      v.node({ of: "expr", node: n });
      break;
    case "update":
      v.node({ of: "expr", node: n });
      break;
    case "binary":
      v.node({ of: "expr", node: n });
      break;
    case "conditional":
      v.node({ of: "expr", node: n });
      break;
    case "assign":
      v.node({ of: "expr", node: n });
      break;
    case "pipe":
      v.node({ of: "expr", node: n });
      break;
    case "topic":
      v.node({ of: "expr", node: n });
      break;
    case "match":
      v.node({ of: "expr", node: n });
      break;
    case "comptime":
      v.node({ of: "expr", node: n });
      break;
    case "unsafe":
      v.node({ of: "expr", node: n });
      break;
    case "destructure":
      v.node({ of: "expr", node: n });
      break;
    case "sequence":
      v.node({ of: "expr", node: n });
      break;
    case "yield":
      v.node({ of: "expr", node: n });
      break;
    case "as":
      v.node({ of: "expr", node: n });
      break;
    case "satisfies":
      v.node({ of: "expr", node: n });
      break;
    case "assertion":
      v.node({ of: "expr", node: n });
      break;
    case "block":
      v.node({ of: "stmt", node: n });
      break;
  }
}
