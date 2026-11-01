// Generated from the parser's AST types by `bun scripts/walkgen.ts`; a test fails when it is stale.
// Each `childrenOf` function hands each node a node holds to the visitor, in the order its type
// lists the fields.
import type { TypeNode, Expr, Stmt, TupleElement, PropertyName, TypeMember, ObjectProp, ClassNode, ClassMember, Param, Pattern, MatchArm, PatternProp, Specifier, EnumMember, SwitchCase, Declarator, TypeParam, TypeAlias, Interface, JsName, Func } from "./parser.ts";

// What a walk does at each node it reaches, by the node's type. A method visits a node's children
// by calling the matching `childrenOf` function, or skips them by not calling it.
export interface Visitor {
  typeNode(this: Mut<this>, n: Ref<TypeNode>): void;
  expr(this: Mut<this>, n: Ref<Expr>): void;
  stmt(this: Mut<this>, n: Ref<Stmt>): void;
  tupleElement(this: Mut<this>, n: Ref<TupleElement>): void;
  typeMember(this: Mut<this>, n: Ref<TypeMember>): void;
  objectProp(this: Mut<this>, n: Ref<ObjectProp>): void;
  classNode(this: Mut<this>, n: Ref<ClassNode>): void;
  classMember(this: Mut<this>, n: Ref<ClassMember>): void;
  param(this: Mut<this>, n: Ref<Param>): void;
  pattern(this: Mut<this>, n: Ref<Pattern>): void;
  matchArm(this: Mut<this>, n: Ref<MatchArm>): void;
  patternProp(this: Mut<this>, n: Ref<PatternProp>): void;
  specifier(this: Mut<this>, n: Ref<Specifier>): void;
  enumMember(this: Mut<this>, n: Ref<EnumMember>): void;
  switchCase(this: Mut<this>, n: Ref<SwitchCase>): void;
  declarator(this: Mut<this>, n: Ref<Declarator>): void;
  typeParam(this: Mut<this>, n: Ref<TypeParam>): void;
  typeAlias(this: Mut<this>, n: Ref<TypeAlias>): void;
  interface(this: Mut<this>, n: Ref<Interface>): void;
  jsName(this: Mut<this>, n: Ref<JsName>): void;
  func(this: Mut<this>, n: Ref<Func>): void;
  // A list of statements, apart from the nodes, as it is a scope of its own.
  stmts(this: Mut<this>, n: Ref<Stmt[]>): void;
}

export function childrenOfTypeNode<V extends Visitor>(n: Ref<TypeNode>, v: Mut<V>): void {
  switch (n.kind) {
    case "ref":
      for (const x1 of n.args) {
        v.typeNode(x1);
      }
      break;
    case "literal":
      v.expr(n.value);
      break;
    case "array":
      v.typeNode(n.element);
      break;
    case "tuple":
      for (const x1 of n.elements) {
        v.tupleElement(x1);
      }
      break;
    case "object":
      for (const x1 of n.members) {
        v.typeMember(x1);
      }
      break;
    case "function":
      for (const x1 of n.typeParams) {
        v.typeParam(x1);
      }
      for (const x1 of n.params) {
        v.param(x1);
      }
      v.typeNode(n.returns);
      if (n.throws !== undefined) {
        v.typeNode(n.throws!);
      }
      break;
    case "union":
      for (const x1 of n.types) {
        v.typeNode(x1);
      }
      break;
    case "intersection":
      for (const x1 of n.types) {
        v.typeNode(x1);
      }
      break;
    case "operator":
      v.typeNode(n.type);
      break;
    case "indexed":
      v.typeNode(n.object);
      v.typeNode(n.index);
      break;
    case "query":
      v.typeNode(n.target);
      break;
    case "import":
      for (const x1 of n.args) {
        v.typeNode(x1);
      }
      break;
    case "conditional":
      v.typeNode(n.check);
      v.typeNode(n.extends);
      v.typeNode(n.then);
      v.typeNode(n.else);
      break;
    case "infer":
      if (n.constraint !== undefined) {
        v.typeNode(n.constraint!);
      }
      break;
    case "template":
      for (const x1 of n.types) {
        v.typeNode(x1);
      }
      break;
    case "mapped":
      v.typeNode(n.constraint);
      if (n.as !== undefined) {
        v.typeNode(n.as!);
      }
      if (n.type !== undefined) {
        v.typeNode(n.type!);
      }
      break;
    case "predicate":
      if (n.type !== undefined) {
        v.typeNode(n.type!);
      }
      break;
  }
}

export function childrenOfExpr<V extends Visitor>(n: Ref<Expr>, v: Mut<V>): void {
  switch (n.kind) {
    case "template":
      for (const x1 of n.exprs) {
        v.expr(x1);
      }
      break;
    case "tagged":
      v.expr(n.tag);
      for (const x1 of n.typeArgs) {
        v.typeNode(x1);
      }
      v.expr(n.template);
      break;
    case "spread":
      v.expr(n.value);
      break;
    case "array":
      for (const x1 of n.elements) {
        if (x1 !== undefined) {
          v.expr(x1!);
        }
      }
      break;
    case "object":
      for (const x1 of n.props) {
        v.objectProp(x1);
      }
      break;
    case "function":
      for (const x1 of n.typeParams) {
        v.typeParam(x1);
      }
      for (const x1 of n.params) {
        v.param(x1);
      }
      if (n.returnType !== undefined) {
        v.typeNode(n.returnType!);
      }
      v.stmts(n.body);
      break;
    case "arrow":
      for (const x1 of n.typeParams) {
        v.typeParam(x1);
      }
      for (const x1 of n.params) {
        v.param(x1);
      }
      if (n.returnType !== undefined) {
        v.typeNode(n.returnType!);
      }
      if (n.throws !== undefined) {
        v.typeNode(n.throws!);
      }
      visitOneOf0(n.body, v);
      break;
    case "member":
      v.expr(n.object);
      break;
    case "index":
      v.expr(n.object);
      v.expr(n.index);
      break;
    case "call":
      v.expr(n.callee);
      for (const x1 of n.typeArgs) {
        v.typeNode(x1);
      }
      for (const x1 of n.args) {
        v.expr(x1);
      }
      break;
    case "new":
      v.expr(n.callee);
      for (const x1 of n.typeArgs) {
        v.typeNode(x1);
      }
      if (n.args !== undefined) {
        for (const x1 of n.args!) {
          v.expr(x1);
        }
      }
      break;
    case "instantiation":
      v.expr(n.expr);
      for (const x1 of n.typeArgs) {
        v.typeNode(x1);
      }
      break;
    case "import":
      for (const x1 of n.args) {
        v.expr(x1);
      }
      break;
    case "nonNull":
      v.expr(n.expr);
      if (n.narrows !== undefined) {
        v.typeNode(n.narrows!);
      }
      break;
    case "throw":
      v.expr(n.value);
      break;
    case "class":
      for (const x1 of n.decorators) {
        v.expr(x1);
      }
      for (const x1 of n.typeParams) {
        v.typeParam(x1);
      }
      if (n.extends !== undefined) {
        v.expr(n.extends!);
      }
      for (const x1 of n.implements) {
        v.typeNode(x1);
      }
      for (const x1 of n.members) {
        v.classMember(x1);
      }
      break;
    case "unary":
      v.expr(n.operand);
      break;
    case "update":
      v.expr(n.operand);
      break;
    case "binary":
      v.expr(n.left);
      v.expr(n.right);
      break;
    case "conditional":
      v.expr(n.cond);
      v.expr(n.then);
      v.expr(n.else);
      break;
    case "assign":
      v.expr(n.target);
      v.expr(n.value);
      break;
    case "pipe":
      v.expr(n.value);
      v.expr(n.body);
      break;
    case "match":
      v.expr(n.subject);
      for (const x1 of n.arms) {
        v.matchArm(x1);
      }
      break;
    case "comptime":
      v.expr(n.expr);
      break;
    case "unsafe":
      v.expr(n.expr);
      break;
    case "destructure":
      v.pattern(n.pattern);
      v.expr(n.value);
      break;
    case "sequence":
      for (const x1 of n.exprs) {
        v.expr(x1);
      }
      break;
    case "yield":
      if (n.value !== undefined) {
        v.expr(n.value!);
      }
      break;
    case "as":
      v.expr(n.expr);
      v.typeNode(n.type);
      break;
    case "satisfies":
      v.expr(n.expr);
      v.typeNode(n.type);
      break;
    case "assertion":
      v.typeNode(n.type);
      v.expr(n.expr);
      break;
  }
}

export function childrenOfStmt<V extends Visitor>(n: Ref<Stmt>, v: Mut<V>): void {
  switch (n.kind) {
    case "expr":
      v.expr(n.expr);
      break;
    case "let":
      for (const x1 of n.declarations) {
        v.declarator(x1);
      }
      break;
    case "return":
      if (n.value !== undefined) {
        v.expr(n.value!);
      }
      break;
    case "if":
      v.expr(n.cond);
      v.stmts(n.then);
      if (n.else !== undefined) {
        v.stmts(n.else!);
      }
      break;
    case "while":
      v.expr(n.cond);
      v.stmts(n.body);
      break;
    case "doWhile":
      v.stmts(n.body);
      v.expr(n.cond);
      break;
    case "switch":
      v.expr(n.discriminant);
      for (const x1 of n.cases) {
        v.switchCase(x1);
      }
      break;
    case "labeled":
      v.stmt(n.body);
      break;
    case "throw":
      v.expr(n.value);
      break;
    case "try":
      v.stmts(n.block);
      if (n.param !== undefined) {
        v.pattern(n.param!);
      }
      if (n.paramType !== undefined) {
        v.typeNode(n.paramType!);
      }
      if (n.handler !== undefined) {
        v.stmts(n.handler!);
      }
      if (n.finalizer !== undefined) {
        v.stmts(n.finalizer!);
      }
      break;
    case "for":
      if (n.init !== undefined) {
        v.stmt(n.init!);
      }
      if (n.test !== undefined) {
        v.expr(n.test!);
      }
      if (n.update !== undefined) {
        v.expr(n.update!);
      }
      v.stmts(n.body);
      break;
    case "forIn":
      visitOneOf1(n.left, v);
      v.expr(n.right);
      v.stmts(n.body);
      break;
    case "forOf":
      visitOneOf1(n.left, v);
      v.expr(n.right);
      v.stmts(n.body);
      break;
    case "block":
      v.stmts(n.body);
      break;
    case "enum":
      for (const x1 of n.typeParams) {
        v.typeParam(x1);
      }
      for (const x1 of n.members) {
        v.enumMember(x1);
      }
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          v.expr(x1);
        }
      }
      break;
    case "namespace":
      if (n.body !== undefined) {
        v.stmts(n.body!);
      }
      break;
    case "declare":
      v.stmt(n.body);
      break;
    case "comptime":
      v.stmts(n.body);
      break;
    case "unsafe":
      v.stmts(n.body);
      break;
    case "import":
      if (n.named !== undefined) {
        for (const x1 of n.named!) {
          v.specifier(x1);
        }
      }
      if (n.attributes !== undefined) {
        v.expr(n.attributes!);
      }
      break;
    case "export":
      v.stmt(n.body);
      break;
    case "exportDefault":
      if (n.declaration !== undefined) {
        v.stmt(n.declaration!);
      }
      if (n.value !== undefined) {
        v.expr(n.value!);
      }
      break;
    case "exportNamed":
      for (const x1 of n.specifiers) {
        v.specifier(x1);
      }
      break;
    case "exportAssign":
      v.expr(n.value);
      break;
    case "typeAlias":
      for (const x1 of n.typeParams) {
        v.typeParam(x1);
      }
      v.typeNode(n.type);
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          v.expr(x1);
        }
      }
      if (n.js !== undefined) {
        v.jsName(n.js!);
      }
      break;
    case "interface":
      for (const x1 of n.typeParams) {
        v.typeParam(x1);
      }
      for (const x1 of n.extends) {
        v.typeNode(x1);
      }
      for (const x1 of n.members) {
        v.typeMember(x1);
      }
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          v.expr(x1);
        }
      }
      if (n.js !== undefined) {
        v.jsName(n.js!);
      }
      if (n.jsClass !== undefined) {
        for (const x1 of n.jsClass!.constructors) {
          for (const x2 of x1) {
            v.param(x2);
          }
        }
        for (const x1 of n.jsClass!.statics) {
          v.typeMember(x1);
        }
      }
      if (n.jsSource !== undefined) {
        v.stmt(n.jsSource!);
      }
      break;
    case "function":
      for (const x1 of n.typeParams) {
        v.typeParam(x1);
      }
      for (const x1 of n.params) {
        v.param(x1);
      }
      if (n.returnType !== undefined) {
        v.typeNode(n.returnType!);
      }
      if (n.throws !== undefined) {
        v.typeNode(n.throws!);
      }
      if (n.body !== undefined) {
        v.stmts(n.body!);
      }
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          v.expr(x1);
        }
      }
      if (n.js !== undefined) {
        v.jsName(n.js!);
      }
      break;
    case "class":
      for (const x1 of n.decorators) {
        v.expr(x1);
      }
      for (const x1 of n.typeParams) {
        v.typeParam(x1);
      }
      if (n.extends !== undefined) {
        v.expr(n.extends!);
      }
      for (const x1 of n.implements) {
        v.typeNode(x1);
      }
      for (const x1 of n.members) {
        v.classMember(x1);
      }
      break;
  }
}

export function childrenOfTupleElement<V extends Visitor>(n: Ref<TupleElement>, v: Mut<V>): void {
  v.typeNode(n.type);
}

export function childrenOfTypeMember<V extends Visitor>(n: Ref<TypeMember>, v: Mut<V>): void {
  switch (n.kind) {
    case "property":
      visitOneOf2(n.name, v);
      if (n.type !== undefined) {
        v.typeNode(n.type!);
      }
      break;
    case "method":
      visitOneOf2(n.name, v);
      for (const x1 of n.typeParams) {
        v.typeParam(x1);
      }
      for (const x1 of n.params) {
        v.param(x1);
      }
      if (n.returns !== undefined) {
        v.typeNode(n.returns!);
      }
      break;
    case "call":
      for (const x1 of n.typeParams) {
        v.typeParam(x1);
      }
      for (const x1 of n.params) {
        v.param(x1);
      }
      if (n.returns !== undefined) {
        v.typeNode(n.returns!);
      }
      break;
    case "construct":
      for (const x1 of n.typeParams) {
        v.typeParam(x1);
      }
      for (const x1 of n.params) {
        v.param(x1);
      }
      if (n.returns !== undefined) {
        v.typeNode(n.returns!);
      }
      break;
    case "index":
      for (const x1 of n.params) {
        v.param(x1);
      }
      v.typeNode(n.type);
      break;
    case "get":
      visitOneOf2(n.name, v);
      for (const x1 of n.params) {
        v.param(x1);
      }
      if (n.returns !== undefined) {
        v.typeNode(n.returns!);
      }
      break;
    case "set":
      visitOneOf2(n.name, v);
      for (const x1 of n.params) {
        v.param(x1);
      }
      if (n.returns !== undefined) {
        v.typeNode(n.returns!);
      }
      break;
  }
}

export function childrenOfObjectProp<V extends Visitor>(n: Ref<ObjectProp>, v: Mut<V>): void {
  switch (n.kind) {
    case "property":
      visitOneOf2(n.key, v);
      v.expr(n.value);
      break;
    case "shorthand":
      if (n.default !== undefined) {
        v.expr(n.default!);
      }
      break;
    case "spread":
      v.expr(n.value);
      break;
    case "method":
      visitOneOf2(n.key, v);
      for (const x1 of n.typeParams) {
        v.typeParam(x1);
      }
      for (const x1 of n.params) {
        v.param(x1);
      }
      if (n.returnType !== undefined) {
        v.typeNode(n.returnType!);
      }
      v.stmts(n.body);
      break;
    case "get":
      visitOneOf2(n.key, v);
      for (const x1 of n.params) {
        v.param(x1);
      }
      if (n.returnType !== undefined) {
        v.typeNode(n.returnType!);
      }
      v.stmts(n.body);
      break;
    case "set":
      visitOneOf2(n.key, v);
      for (const x1 of n.params) {
        v.param(x1);
      }
      if (n.returnType !== undefined) {
        v.typeNode(n.returnType!);
      }
      v.stmts(n.body);
      break;
  }
}

export function childrenOfClassNode<V extends Visitor>(n: Ref<ClassNode>, v: Mut<V>): void {
  for (const x1 of n.decorators) {
    v.expr(x1);
  }
  for (const x1 of n.typeParams) {
    v.typeParam(x1);
  }
  if (n.extends !== undefined) {
    v.expr(n.extends!);
  }
  for (const x1 of n.implements) {
    v.typeNode(x1);
  }
  for (const x1 of n.members) {
    v.classMember(x1);
  }
}

export function childrenOfClassMember<V extends Visitor>(n: Ref<ClassMember>, v: Mut<V>): void {
  switch (n.kind) {
    case "field":
      for (const x1 of n.decorators) {
        v.expr(x1);
      }
      visitOneOf2(n.name, v);
      if (n.type !== undefined) {
        v.typeNode(n.type!);
      }
      if (n.init !== undefined) {
        v.expr(n.init!);
      }
      break;
    case "method":
      for (const x1 of n.decorators) {
        v.expr(x1);
      }
      visitOneOf2(n.name, v);
      for (const x1 of n.typeParams) {
        v.typeParam(x1);
      }
      for (const x1 of n.params) {
        v.param(x1);
      }
      if (n.returnType !== undefined) {
        v.typeNode(n.returnType!);
      }
      if (n.throws !== undefined) {
        v.typeNode(n.throws!);
      }
      if (n.body !== undefined) {
        v.stmts(n.body!);
      }
      break;
    case "constructor":
      for (const x1 of n.decorators) {
        v.expr(x1);
      }
      for (const x1 of n.params) {
        v.param(x1);
      }
      if (n.throws !== undefined) {
        v.typeNode(n.throws!);
      }
      if (n.body !== undefined) {
        v.stmts(n.body!);
      }
      break;
    case "get":
      for (const x1 of n.decorators) {
        v.expr(x1);
      }
      visitOneOf2(n.name, v);
      for (const x1 of n.params) {
        v.param(x1);
      }
      if (n.returnType !== undefined) {
        v.typeNode(n.returnType!);
      }
      if (n.throws !== undefined) {
        v.typeNode(n.throws!);
      }
      if (n.body !== undefined) {
        v.stmts(n.body!);
      }
      break;
    case "set":
      for (const x1 of n.decorators) {
        v.expr(x1);
      }
      visitOneOf2(n.name, v);
      for (const x1 of n.params) {
        v.param(x1);
      }
      if (n.returnType !== undefined) {
        v.typeNode(n.returnType!);
      }
      if (n.throws !== undefined) {
        v.typeNode(n.throws!);
      }
      if (n.body !== undefined) {
        v.stmts(n.body!);
      }
      break;
    case "index":
      for (const x1 of n.decorators) {
        v.expr(x1);
      }
      for (const x1 of n.params) {
        v.param(x1);
      }
      v.typeNode(n.type);
      break;
    case "staticBlock":
      for (const x1 of n.decorators) {
        v.expr(x1);
      }
      v.stmts(n.body);
      break;
  }
}

export function childrenOfParam<V extends Visitor>(n: Ref<Param>, v: Mut<V>): void {
  v.pattern(n.pattern);
  if (n.type !== undefined) {
    v.typeNode(n.type!);
  }
  if (n.default !== undefined) {
    v.expr(n.default!);
  }
  for (const x1 of n.decorators) {
    v.expr(x1);
  }
}

export function childrenOfPattern<V extends Visitor>(n: Ref<Pattern>, v: Mut<V>): void {
  switch (n.kind) {
    case "object":
      for (const x1 of n.props) {
        v.patternProp(x1);
      }
      if (n.rest !== undefined) {
        v.pattern(n.rest!);
      }
      break;
    case "array":
      for (const x1 of n.elements) {
        if (x1 !== undefined) {
          v.pattern(x1!);
        }
      }
      if (n.rest !== undefined) {
        v.pattern(n.rest!);
      }
      break;
    case "default":
      v.pattern(n.target);
      v.expr(n.value);
      break;
    case "expr":
      v.expr(n.expr);
      break;
    case "literal":
      v.expr(n.value);
      break;
    case "variant":
      if (n.args !== undefined) {
        for (const x1 of n.args!) {
          v.pattern(x1);
        }
      }
      break;
    case "or":
      for (const x1 of n.patterns) {
        v.pattern(x1);
      }
      break;
  }
}

export function childrenOfMatchArm<V extends Visitor>(n: Ref<MatchArm>, v: Mut<V>): void {
  v.pattern(n.pattern);
  if (n.guard !== undefined) {
    v.expr(n.guard!);
  }
  visitOneOf3(n.body, v);
}

export function childrenOfPatternProp<V extends Visitor>(n: Ref<PatternProp>, v: Mut<V>): void {
  visitOneOf2(n.key, v);
  v.pattern(n.value);
}

export function childrenOfSpecifier<V extends Visitor>(_n: Ref<Specifier>, _v: Mut<V>): void {
}

export function childrenOfEnumMember<V extends Visitor>(n: Ref<EnumMember>, v: Mut<V>): void {
  if (n.init !== undefined) {
    v.expr(n.init!);
  }
  if (n.payload !== undefined) {
    for (const x1 of n.payload!) {
      v.typeNode(x1);
    }
  }
}

export function childrenOfSwitchCase<V extends Visitor>(n: Ref<SwitchCase>, v: Mut<V>): void {
  if (n.test !== undefined) {
    v.expr(n.test!);
  }
  v.stmts(n.body);
}

export function childrenOfDeclarator<V extends Visitor>(n: Ref<Declarator>, v: Mut<V>): void {
  v.pattern(n.target);
  if (n.type !== undefined) {
    v.typeNode(n.type!);
  }
  if (n.init !== undefined) {
    v.expr(n.init!);
  }
}

export function childrenOfTypeParam<V extends Visitor>(n: Ref<TypeParam>, v: Mut<V>): void {
  if (n.constraint !== undefined) {
    v.typeNode(n.constraint!);
  }
  if (n.default !== undefined) {
    v.typeNode(n.default!);
  }
}

export function childrenOfTypeAlias<V extends Visitor>(n: Ref<TypeAlias>, v: Mut<V>): void {
  switch (n.kind) {
    case "typeAlias":
      for (const x1 of n.typeParams) {
        v.typeParam(x1);
      }
      v.typeNode(n.type);
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          v.expr(x1);
        }
      }
      if (n.js !== undefined) {
        v.jsName(n.js!);
      }
      break;
  }
}

export function childrenOfInterface<V extends Visitor>(n: Ref<Interface>, v: Mut<V>): void {
  switch (n.kind) {
    case "interface":
      for (const x1 of n.typeParams) {
        v.typeParam(x1);
      }
      for (const x1 of n.extends) {
        v.typeNode(x1);
      }
      for (const x1 of n.members) {
        v.typeMember(x1);
      }
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          v.expr(x1);
        }
      }
      if (n.js !== undefined) {
        v.jsName(n.js!);
      }
      if (n.jsClass !== undefined) {
        for (const x1 of n.jsClass!.constructors) {
          for (const x2 of x1) {
            v.param(x2);
          }
        }
        for (const x1 of n.jsClass!.statics) {
          v.typeMember(x1);
        }
      }
      if (n.jsSource !== undefined) {
        v.stmt(n.jsSource!);
      }
      break;
  }
}

export function childrenOfJsName<V extends Visitor>(n: Ref<JsName>, v: Mut<V>): void {
  if (n.overloads !== undefined) {
    for (const x1 of n.overloads!) {
      v.func(x1);
    }
  }
}

export function childrenOfFunc<V extends Visitor>(n: Ref<Func>, v: Mut<V>): void {
  switch (n.kind) {
    case "function":
      for (const x1 of n.typeParams) {
        v.typeParam(x1);
      }
      for (const x1 of n.params) {
        v.param(x1);
      }
      if (n.returnType !== undefined) {
        v.typeNode(n.returnType!);
      }
      if (n.throws !== undefined) {
        v.typeNode(n.throws!);
      }
      if (n.body !== undefined) {
        v.stmts(n.body!);
      }
      if (n.decorators !== undefined) {
        for (const x1 of n.decorators!) {
          v.expr(x1);
        }
      }
      if (n.js !== undefined) {
        v.jsName(n.js!);
      }
      break;
  }
}

export function childrenOfStmts<V extends Visitor>(n: Ref<Stmt[]>, v: Mut<V>): void {
  for (const x of n) {
    v.stmt(x);
  }
}

// Expr | Stmt[]
export function visitOneOf0<V extends Visitor>(n: Ref<Expr | Stmt[]>, v: Mut<V>): void {
  if (Array.isArray(n)) {
    v.stmts(n);
    return;
  }
  v.expr(n);
}

// Stmt | Pattern
export function visitOneOf1<V extends Visitor>(n: Ref<Stmt | Pattern>, v: Mut<V>): void {
  switch (n.kind) {
    case "expr":
      v.stmt(n);
      break;
    case "let":
      v.stmt(n);
      break;
    case "return":
      v.stmt(n);
      break;
    case "if":
      v.stmt(n);
      break;
    case "while":
      v.stmt(n);
      break;
    case "doWhile":
      v.stmt(n);
      break;
    case "switch":
      v.stmt(n);
      break;
    case "labeled":
      v.stmt(n);
      break;
    case "break":
      v.stmt(n);
      break;
    case "continue":
      v.stmt(n);
      break;
    case "throw":
      v.stmt(n);
      break;
    case "try":
      v.stmt(n);
      break;
    case "for":
      v.stmt(n);
      break;
    case "forIn":
      v.stmt(n);
      break;
    case "forOf":
      v.stmt(n);
      break;
    case "block":
      v.stmt(n);
      break;
    case "empty":
      v.stmt(n);
      break;
    case "debugger":
      v.stmt(n);
      break;
    case "enum":
      v.stmt(n);
      break;
    case "namespace":
      v.stmt(n);
      break;
    case "declare":
      v.stmt(n);
      break;
    case "comptime":
      v.stmt(n);
      break;
    case "unsafe":
      v.stmt(n);
      break;
    case "import":
      v.stmt(n);
      break;
    case "importEquals":
      v.stmt(n);
      break;
    case "export":
      v.stmt(n);
      break;
    case "exportDefault":
      v.stmt(n);
      break;
    case "exportNamed":
      v.stmt(n);
      break;
    case "exportAll":
      v.stmt(n);
      break;
    case "exportAssign":
      v.stmt(n);
      break;
    case "exportAsNamespace":
      v.stmt(n);
      break;
    case "typeAlias":
      v.stmt(n);
      break;
    case "interface":
      v.stmt(n);
      break;
    case "function":
      v.stmt(n);
      break;
    case "class":
      v.stmt(n);
      break;
    case "ident":
      v.pattern(n);
      break;
    case "object":
      v.pattern(n);
      break;
    case "array":
      v.pattern(n);
      break;
    case "default":
      v.pattern(n);
      break;
    case "wildcard":
      v.pattern(n);
      break;
    case "literal":
      v.pattern(n);
      break;
    case "variant":
      v.pattern(n);
      break;
    case "or":
      v.pattern(n);
      break;
  }
}

// PropertyName
export function visitOneOf2<V extends Visitor>(n: Ref<PropertyName>, v: Mut<V>): void {
  if (typeof n === "string") return;
  v.expr(n);
}

// Expr | Extract<Stmt, { kind: "block" }>
export function visitOneOf3<V extends Visitor>(n: Ref<Expr | Extract<Stmt, { kind: "block" }>>, v: Mut<V>): void {
  switch (n.kind) {
    case "int":
      v.expr(n);
      break;
    case "float":
      v.expr(n);
      break;
    case "bigint":
      v.expr(n);
      break;
    case "null":
      v.expr(n);
      break;
    case "this":
      v.expr(n);
      break;
    case "super":
      v.expr(n);
      break;
    case "regex":
      v.expr(n);
      break;
    case "template":
      v.expr(n);
      break;
    case "tagged":
      v.expr(n);
      break;
    case "bool":
      v.expr(n);
      break;
    case "string":
      v.expr(n);
      break;
    case "ident":
      v.expr(n);
      break;
    case "spread":
      v.expr(n);
      break;
    case "array":
      v.expr(n);
      break;
    case "object":
      v.expr(n);
      break;
    case "function":
      v.expr(n);
      break;
    case "arrow":
      v.expr(n);
      break;
    case "member":
      v.expr(n);
      break;
    case "index":
      v.expr(n);
      break;
    case "call":
      v.expr(n);
      break;
    case "new":
      v.expr(n);
      break;
    case "instantiation":
      v.expr(n);
      break;
    case "meta":
      v.expr(n);
      break;
    case "import":
      v.expr(n);
      break;
    case "nonNull":
      v.expr(n);
      break;
    case "throw":
      v.expr(n);
      break;
    case "class":
      v.expr(n);
      break;
    case "privateName":
      v.expr(n);
      break;
    case "unary":
      v.expr(n);
      break;
    case "update":
      v.expr(n);
      break;
    case "binary":
      v.expr(n);
      break;
    case "conditional":
      v.expr(n);
      break;
    case "assign":
      v.expr(n);
      break;
    case "pipe":
      v.expr(n);
      break;
    case "topic":
      v.expr(n);
      break;
    case "match":
      v.expr(n);
      break;
    case "comptime":
      v.expr(n);
      break;
    case "unsafe":
      v.expr(n);
      break;
    case "destructure":
      v.expr(n);
      break;
    case "sequence":
      v.expr(n);
      break;
    case "yield":
      v.expr(n);
      break;
    case "as":
      v.expr(n);
      break;
    case "satisfies":
      v.expr(n);
      break;
    case "assertion":
      v.expr(n);
      break;
    case "block":
      v.stmt(n);
      break;
  }
}
