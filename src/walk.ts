// Generated from the parser's AST types by `bun scripts/walkgen.ts`; a test fails when it is stale.
// Each `childrenOf` function hands each node a node holds to the visitor, in the order its type
// lists the fields. Each `rebuilt` function gives a node as the rewrite table has it, with each
// node under it put in place the same way.
import type { Rewrites } from "./ids.ts";
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

export function rebuiltTypeNode(n: TypeNode, r: Ref<Rewrites>): TypeNode {
  const m = r.current(n);
  switch (m.kind) {
    case "ref":
      for (let i1 = 0; i1 < m.args.length; i1++) {
        m.args[i1] = rebuiltTypeNode(m.args[i1]!, r);
      }
      break;
    case "literal":
      m.value = rebuiltExpr(m.value, r);
      break;
    case "array":
      m.element = rebuiltTypeNode(m.element, r);
      break;
    case "tuple":
      for (let i1 = 0; i1 < m.elements.length; i1++) {
        m.elements[i1] = rebuiltTupleElement(m.elements[i1]!, r);
      }
      break;
    case "object":
      for (let i1 = 0; i1 < m.members.length; i1++) {
        m.members[i1] = rebuiltTypeMember(m.members[i1]!, r);
      }
      break;
    case "function":
      for (let i1 = 0; i1 < m.typeParams.length; i1++) {
        m.typeParams[i1] = rebuiltTypeParam(m.typeParams[i1]!, r);
      }
      for (let i1 = 0; i1 < m.params.length; i1++) {
        m.params[i1] = rebuiltParam(m.params[i1]!, r);
      }
      m.returns = rebuiltTypeNode(m.returns, r);
      if (m.throws !== undefined) {
        m.throws = rebuiltTypeNode(m.throws!, r);
      }
      break;
    case "union":
      for (let i1 = 0; i1 < m.types.length; i1++) {
        m.types[i1] = rebuiltTypeNode(m.types[i1]!, r);
      }
      break;
    case "intersection":
      for (let i1 = 0; i1 < m.types.length; i1++) {
        m.types[i1] = rebuiltTypeNode(m.types[i1]!, r);
      }
      break;
    case "operator":
      m.type = rebuiltTypeNode(m.type, r);
      break;
    case "indexed":
      m.object = rebuiltTypeNode(m.object, r);
      m.index = rebuiltTypeNode(m.index, r);
      break;
    case "query":
      m.target = rebuiltTypeNode(m.target, r);
      break;
    case "import":
      for (let i1 = 0; i1 < m.args.length; i1++) {
        m.args[i1] = rebuiltTypeNode(m.args[i1]!, r);
      }
      break;
    case "conditional":
      m.check = rebuiltTypeNode(m.check, r);
      m.extends = rebuiltTypeNode(m.extends, r);
      m.then = rebuiltTypeNode(m.then, r);
      m.else = rebuiltTypeNode(m.else, r);
      break;
    case "infer":
      if (m.constraint !== undefined) {
        m.constraint = rebuiltTypeNode(m.constraint!, r);
      }
      break;
    case "template":
      for (let i1 = 0; i1 < m.types.length; i1++) {
        m.types[i1] = rebuiltTypeNode(m.types[i1]!, r);
      }
      break;
    case "mapped":
      m.constraint = rebuiltTypeNode(m.constraint, r);
      if (m.as !== undefined) {
        m.as = rebuiltTypeNode(m.as!, r);
      }
      if (m.type !== undefined) {
        m.type = rebuiltTypeNode(m.type!, r);
      }
      break;
    case "predicate":
      if (m.type !== undefined) {
        m.type = rebuiltTypeNode(m.type!, r);
      }
      break;
  }
  return m;
}

export function rebuiltExpr(n: Expr, r: Ref<Rewrites>): Expr {
  const m = r.current(n);
  switch (m.kind) {
    case "template":
      for (let i1 = 0; i1 < m.exprs.length; i1++) {
        m.exprs[i1] = rebuiltExpr(m.exprs[i1]!, r);
      }
      break;
    case "tagged":
      m.tag = rebuiltExpr(m.tag, r);
      for (let i1 = 0; i1 < m.typeArgs.length; i1++) {
        m.typeArgs[i1] = rebuiltTypeNode(m.typeArgs[i1]!, r);
      }
      m.template = rebuiltExpr(m.template, r);
      break;
    case "spread":
      m.value = rebuiltExpr(m.value, r);
      break;
    case "array":
      for (let i1 = 0; i1 < m.elements.length; i1++) {
        if (m.elements[i1] !== undefined) {
          m.elements[i1] = rebuiltExpr(m.elements[i1]!, r);
        }
      }
      break;
    case "object":
      for (let i1 = 0; i1 < m.props.length; i1++) {
        m.props[i1] = rebuiltObjectProp(m.props[i1]!, r);
      }
      break;
    case "function":
      for (let i1 = 0; i1 < m.typeParams.length; i1++) {
        m.typeParams[i1] = rebuiltTypeParam(m.typeParams[i1]!, r);
      }
      for (let i1 = 0; i1 < m.params.length; i1++) {
        m.params[i1] = rebuiltParam(m.params[i1]!, r);
      }
      if (m.returnType !== undefined) {
        m.returnType = rebuiltTypeNode(m.returnType!, r);
      }
      rebuiltStmts(m.body, r);
      break;
    case "arrow":
      for (let i1 = 0; i1 < m.typeParams.length; i1++) {
        m.typeParams[i1] = rebuiltTypeParam(m.typeParams[i1]!, r);
      }
      for (let i1 = 0; i1 < m.params.length; i1++) {
        m.params[i1] = rebuiltParam(m.params[i1]!, r);
      }
      if (m.returnType !== undefined) {
        m.returnType = rebuiltTypeNode(m.returnType!, r);
      }
      if (m.throws !== undefined) {
        m.throws = rebuiltTypeNode(m.throws!, r);
      }
      m.body = rebuiltOneOf0(m.body, r);
      break;
    case "member":
      m.object = rebuiltExpr(m.object, r);
      break;
    case "index":
      m.object = rebuiltExpr(m.object, r);
      m.index = rebuiltExpr(m.index, r);
      break;
    case "call":
      m.callee = rebuiltExpr(m.callee, r);
      for (let i1 = 0; i1 < m.typeArgs.length; i1++) {
        m.typeArgs[i1] = rebuiltTypeNode(m.typeArgs[i1]!, r);
      }
      for (let i1 = 0; i1 < m.args.length; i1++) {
        m.args[i1] = rebuiltExpr(m.args[i1]!, r);
      }
      break;
    case "new":
      m.callee = rebuiltExpr(m.callee, r);
      for (let i1 = 0; i1 < m.typeArgs.length; i1++) {
        m.typeArgs[i1] = rebuiltTypeNode(m.typeArgs[i1]!, r);
      }
      if (m.args !== undefined) {
        for (let i1 = 0; i1 < m.args!.length; i1++) {
          m.args![i1] = rebuiltExpr(m.args![i1]!, r);
        }
      }
      break;
    case "instantiation":
      m.expr = rebuiltExpr(m.expr, r);
      for (let i1 = 0; i1 < m.typeArgs.length; i1++) {
        m.typeArgs[i1] = rebuiltTypeNode(m.typeArgs[i1]!, r);
      }
      break;
    case "import":
      for (let i1 = 0; i1 < m.args.length; i1++) {
        m.args[i1] = rebuiltExpr(m.args[i1]!, r);
      }
      break;
    case "nonNull":
      m.expr = rebuiltExpr(m.expr, r);
      if (m.narrows !== undefined) {
        m.narrows = rebuiltTypeNode(m.narrows!, r);
      }
      break;
    case "throw":
      m.value = rebuiltExpr(m.value, r);
      break;
    case "class":
      for (let i1 = 0; i1 < m.decorators.length; i1++) {
        m.decorators[i1] = rebuiltExpr(m.decorators[i1]!, r);
      }
      for (let i1 = 0; i1 < m.typeParams.length; i1++) {
        m.typeParams[i1] = rebuiltTypeParam(m.typeParams[i1]!, r);
      }
      if (m.extends !== undefined) {
        m.extends = rebuiltExpr(m.extends!, r);
      }
      for (let i1 = 0; i1 < m.implements.length; i1++) {
        m.implements[i1] = rebuiltTypeNode(m.implements[i1]!, r);
      }
      for (let i1 = 0; i1 < m.members.length; i1++) {
        m.members[i1] = rebuiltClassMember(m.members[i1]!, r);
      }
      break;
    case "unary":
      m.operand = rebuiltExpr(m.operand, r);
      break;
    case "update":
      m.operand = rebuiltExpr(m.operand, r);
      break;
    case "binary":
      m.left = rebuiltExpr(m.left, r);
      m.right = rebuiltExpr(m.right, r);
      break;
    case "conditional":
      m.cond = rebuiltExpr(m.cond, r);
      m.then = rebuiltExpr(m.then, r);
      m.else = rebuiltExpr(m.else, r);
      break;
    case "assign":
      m.target = rebuiltExpr(m.target, r);
      m.value = rebuiltExpr(m.value, r);
      break;
    case "pipe":
      m.value = rebuiltExpr(m.value, r);
      m.body = rebuiltExpr(m.body, r);
      break;
    case "match":
      m.subject = rebuiltExpr(m.subject, r);
      for (let i1 = 0; i1 < m.arms.length; i1++) {
        m.arms[i1] = rebuiltMatchArm(m.arms[i1]!, r);
      }
      break;
    case "comptime":
      m.expr = rebuiltExpr(m.expr, r);
      break;
    case "unsafe":
      m.expr = rebuiltExpr(m.expr, r);
      break;
    case "destructure":
      m.pattern = rebuiltPattern(m.pattern, r);
      m.value = rebuiltExpr(m.value, r);
      break;
    case "sequence":
      for (let i1 = 0; i1 < m.exprs.length; i1++) {
        m.exprs[i1] = rebuiltExpr(m.exprs[i1]!, r);
      }
      break;
    case "yield":
      if (m.value !== undefined) {
        m.value = rebuiltExpr(m.value!, r);
      }
      break;
    case "as":
      m.expr = rebuiltExpr(m.expr, r);
      m.type = rebuiltTypeNode(m.type, r);
      break;
    case "satisfies":
      m.expr = rebuiltExpr(m.expr, r);
      m.type = rebuiltTypeNode(m.type, r);
      break;
    case "assertion":
      m.type = rebuiltTypeNode(m.type, r);
      m.expr = rebuiltExpr(m.expr, r);
      break;
  }
  return m;
}

export function rebuiltStmt(n: Stmt, r: Ref<Rewrites>): Stmt {
  const m = r.current(n);
  switch (m.kind) {
    case "expr":
      m.expr = rebuiltExpr(m.expr, r);
      break;
    case "let":
      for (let i1 = 0; i1 < m.declarations.length; i1++) {
        m.declarations[i1] = rebuiltDeclarator(m.declarations[i1]!, r);
      }
      break;
    case "return":
      if (m.value !== undefined) {
        m.value = rebuiltExpr(m.value!, r);
      }
      break;
    case "if":
      m.cond = rebuiltExpr(m.cond, r);
      rebuiltStmts(m.then, r);
      if (m.else !== undefined) {
        rebuiltStmts(m.else!, r);
      }
      break;
    case "while":
      m.cond = rebuiltExpr(m.cond, r);
      rebuiltStmts(m.body, r);
      break;
    case "doWhile":
      rebuiltStmts(m.body, r);
      m.cond = rebuiltExpr(m.cond, r);
      break;
    case "switch":
      m.discriminant = rebuiltExpr(m.discriminant, r);
      for (let i1 = 0; i1 < m.cases.length; i1++) {
        m.cases[i1] = rebuiltSwitchCase(m.cases[i1]!, r);
      }
      break;
    case "labeled":
      m.body = rebuiltStmt(m.body, r);
      break;
    case "throw":
      m.value = rebuiltExpr(m.value, r);
      break;
    case "try":
      rebuiltStmts(m.block, r);
      if (m.param !== undefined) {
        m.param = rebuiltPattern(m.param!, r);
      }
      if (m.paramType !== undefined) {
        m.paramType = rebuiltTypeNode(m.paramType!, r);
      }
      if (m.handler !== undefined) {
        rebuiltStmts(m.handler!, r);
      }
      if (m.finalizer !== undefined) {
        rebuiltStmts(m.finalizer!, r);
      }
      break;
    case "for":
      if (m.init !== undefined) {
        m.init = rebuiltStmt(m.init!, r);
      }
      if (m.test !== undefined) {
        m.test = rebuiltExpr(m.test!, r);
      }
      if (m.update !== undefined) {
        m.update = rebuiltExpr(m.update!, r);
      }
      rebuiltStmts(m.body, r);
      break;
    case "forIn":
      m.left = rebuiltOneOf1(m.left, r);
      m.right = rebuiltExpr(m.right, r);
      rebuiltStmts(m.body, r);
      break;
    case "forOf":
      m.left = rebuiltOneOf1(m.left, r);
      m.right = rebuiltExpr(m.right, r);
      rebuiltStmts(m.body, r);
      break;
    case "block":
      rebuiltStmts(m.body, r);
      break;
    case "enum":
      for (let i1 = 0; i1 < m.typeParams.length; i1++) {
        m.typeParams[i1] = rebuiltTypeParam(m.typeParams[i1]!, r);
      }
      for (let i1 = 0; i1 < m.members.length; i1++) {
        m.members[i1] = rebuiltEnumMember(m.members[i1]!, r);
      }
      if (m.decorators !== undefined) {
        for (let i1 = 0; i1 < m.decorators!.length; i1++) {
          m.decorators![i1] = rebuiltExpr(m.decorators![i1]!, r);
        }
      }
      break;
    case "namespace":
      if (m.body !== undefined) {
        rebuiltStmts(m.body!, r);
      }
      break;
    case "declare":
      m.body = rebuiltStmt(m.body, r);
      break;
    case "comptime":
      rebuiltStmts(m.body, r);
      break;
    case "unsafe":
      rebuiltStmts(m.body, r);
      break;
    case "import":
      if (m.named !== undefined) {
        for (let i1 = 0; i1 < m.named!.length; i1++) {
          m.named![i1] = rebuiltSpecifier(m.named![i1]!, r);
        }
      }
      if (m.attributes !== undefined) {
        m.attributes = rebuiltExpr(m.attributes!, r);
      }
      break;
    case "export":
      m.body = rebuiltStmt(m.body, r);
      break;
    case "exportDefault":
      if (m.declaration !== undefined) {
        m.declaration = rebuiltStmt(m.declaration!, r);
      }
      if (m.value !== undefined) {
        m.value = rebuiltExpr(m.value!, r);
      }
      break;
    case "exportNamed":
      for (let i1 = 0; i1 < m.specifiers.length; i1++) {
        m.specifiers[i1] = rebuiltSpecifier(m.specifiers[i1]!, r);
      }
      break;
    case "exportAssign":
      m.value = rebuiltExpr(m.value, r);
      break;
    case "typeAlias":
      for (let i1 = 0; i1 < m.typeParams.length; i1++) {
        m.typeParams[i1] = rebuiltTypeParam(m.typeParams[i1]!, r);
      }
      m.type = rebuiltTypeNode(m.type, r);
      if (m.decorators !== undefined) {
        for (let i1 = 0; i1 < m.decorators!.length; i1++) {
          m.decorators![i1] = rebuiltExpr(m.decorators![i1]!, r);
        }
      }
      if (m.js !== undefined) {
        m.js = rebuiltJsName(m.js!, r);
      }
      break;
    case "interface":
      for (let i1 = 0; i1 < m.typeParams.length; i1++) {
        m.typeParams[i1] = rebuiltTypeParam(m.typeParams[i1]!, r);
      }
      for (let i1 = 0; i1 < m.extends.length; i1++) {
        m.extends[i1] = rebuiltTypeNode(m.extends[i1]!, r);
      }
      for (let i1 = 0; i1 < m.members.length; i1++) {
        m.members[i1] = rebuiltTypeMember(m.members[i1]!, r);
      }
      if (m.decorators !== undefined) {
        for (let i1 = 0; i1 < m.decorators!.length; i1++) {
          m.decorators![i1] = rebuiltExpr(m.decorators![i1]!, r);
        }
      }
      if (m.js !== undefined) {
        m.js = rebuiltJsName(m.js!, r);
      }
      if (m.jsClass !== undefined) {
        for (let i1 = 0; i1 < m.jsClass!.constructors.length; i1++) {
          for (let i2 = 0; i2 < m.jsClass!.constructors[i1]!.length; i2++) {
            m.jsClass!.constructors[i1]![i2] = rebuiltParam(m.jsClass!.constructors[i1]![i2]!, r);
          }
        }
        for (let i1 = 0; i1 < m.jsClass!.statics.length; i1++) {
          m.jsClass!.statics[i1] = rebuiltTypeMember(m.jsClass!.statics[i1]!, r);
        }
      }
      if (m.jsSource !== undefined) {
        m.jsSource = rebuiltStmt(m.jsSource!, r);
      }
      break;
    case "function":
      for (let i1 = 0; i1 < m.typeParams.length; i1++) {
        m.typeParams[i1] = rebuiltTypeParam(m.typeParams[i1]!, r);
      }
      for (let i1 = 0; i1 < m.params.length; i1++) {
        m.params[i1] = rebuiltParam(m.params[i1]!, r);
      }
      if (m.returnType !== undefined) {
        m.returnType = rebuiltTypeNode(m.returnType!, r);
      }
      if (m.throws !== undefined) {
        m.throws = rebuiltTypeNode(m.throws!, r);
      }
      if (m.body !== undefined) {
        rebuiltStmts(m.body!, r);
      }
      if (m.decorators !== undefined) {
        for (let i1 = 0; i1 < m.decorators!.length; i1++) {
          m.decorators![i1] = rebuiltExpr(m.decorators![i1]!, r);
        }
      }
      if (m.js !== undefined) {
        m.js = rebuiltJsName(m.js!, r);
      }
      break;
    case "class":
      for (let i1 = 0; i1 < m.decorators.length; i1++) {
        m.decorators[i1] = rebuiltExpr(m.decorators[i1]!, r);
      }
      for (let i1 = 0; i1 < m.typeParams.length; i1++) {
        m.typeParams[i1] = rebuiltTypeParam(m.typeParams[i1]!, r);
      }
      if (m.extends !== undefined) {
        m.extends = rebuiltExpr(m.extends!, r);
      }
      for (let i1 = 0; i1 < m.implements.length; i1++) {
        m.implements[i1] = rebuiltTypeNode(m.implements[i1]!, r);
      }
      for (let i1 = 0; i1 < m.members.length; i1++) {
        m.members[i1] = rebuiltClassMember(m.members[i1]!, r);
      }
      break;
  }
  return m;
}

export function rebuiltTupleElement(n: TupleElement, r: Ref<Rewrites>): TupleElement {
  const m = r.current(n);
  m.type = rebuiltTypeNode(m.type, r);
  return m;
}

export function rebuiltTypeMember(n: TypeMember, r: Ref<Rewrites>): TypeMember {
  const m = r.current(n);
  switch (m.kind) {
    case "property":
      m.name = rebuiltOneOf2(m.name, r);
      if (m.type !== undefined) {
        m.type = rebuiltTypeNode(m.type!, r);
      }
      break;
    case "method":
      m.name = rebuiltOneOf2(m.name, r);
      for (let i1 = 0; i1 < m.typeParams.length; i1++) {
        m.typeParams[i1] = rebuiltTypeParam(m.typeParams[i1]!, r);
      }
      for (let i1 = 0; i1 < m.params.length; i1++) {
        m.params[i1] = rebuiltParam(m.params[i1]!, r);
      }
      if (m.returns !== undefined) {
        m.returns = rebuiltTypeNode(m.returns!, r);
      }
      break;
    case "call":
      for (let i1 = 0; i1 < m.typeParams.length; i1++) {
        m.typeParams[i1] = rebuiltTypeParam(m.typeParams[i1]!, r);
      }
      for (let i1 = 0; i1 < m.params.length; i1++) {
        m.params[i1] = rebuiltParam(m.params[i1]!, r);
      }
      if (m.returns !== undefined) {
        m.returns = rebuiltTypeNode(m.returns!, r);
      }
      break;
    case "construct":
      for (let i1 = 0; i1 < m.typeParams.length; i1++) {
        m.typeParams[i1] = rebuiltTypeParam(m.typeParams[i1]!, r);
      }
      for (let i1 = 0; i1 < m.params.length; i1++) {
        m.params[i1] = rebuiltParam(m.params[i1]!, r);
      }
      if (m.returns !== undefined) {
        m.returns = rebuiltTypeNode(m.returns!, r);
      }
      break;
    case "index":
      for (let i1 = 0; i1 < m.params.length; i1++) {
        m.params[i1] = rebuiltParam(m.params[i1]!, r);
      }
      m.type = rebuiltTypeNode(m.type, r);
      break;
    case "get":
      m.name = rebuiltOneOf2(m.name, r);
      for (let i1 = 0; i1 < m.params.length; i1++) {
        m.params[i1] = rebuiltParam(m.params[i1]!, r);
      }
      if (m.returns !== undefined) {
        m.returns = rebuiltTypeNode(m.returns!, r);
      }
      break;
    case "set":
      m.name = rebuiltOneOf2(m.name, r);
      for (let i1 = 0; i1 < m.params.length; i1++) {
        m.params[i1] = rebuiltParam(m.params[i1]!, r);
      }
      if (m.returns !== undefined) {
        m.returns = rebuiltTypeNode(m.returns!, r);
      }
      break;
  }
  return m;
}

export function rebuiltObjectProp(n: ObjectProp, r: Ref<Rewrites>): ObjectProp {
  const m = r.current(n);
  switch (m.kind) {
    case "property":
      m.key = rebuiltOneOf2(m.key, r);
      m.value = rebuiltExpr(m.value, r);
      break;
    case "shorthand":
      if (m.default !== undefined) {
        m.default = rebuiltExpr(m.default!, r);
      }
      break;
    case "spread":
      m.value = rebuiltExpr(m.value, r);
      break;
    case "method":
      m.key = rebuiltOneOf2(m.key, r);
      for (let i1 = 0; i1 < m.typeParams.length; i1++) {
        m.typeParams[i1] = rebuiltTypeParam(m.typeParams[i1]!, r);
      }
      for (let i1 = 0; i1 < m.params.length; i1++) {
        m.params[i1] = rebuiltParam(m.params[i1]!, r);
      }
      if (m.returnType !== undefined) {
        m.returnType = rebuiltTypeNode(m.returnType!, r);
      }
      rebuiltStmts(m.body, r);
      break;
    case "get":
      m.key = rebuiltOneOf2(m.key, r);
      for (let i1 = 0; i1 < m.params.length; i1++) {
        m.params[i1] = rebuiltParam(m.params[i1]!, r);
      }
      if (m.returnType !== undefined) {
        m.returnType = rebuiltTypeNode(m.returnType!, r);
      }
      rebuiltStmts(m.body, r);
      break;
    case "set":
      m.key = rebuiltOneOf2(m.key, r);
      for (let i1 = 0; i1 < m.params.length; i1++) {
        m.params[i1] = rebuiltParam(m.params[i1]!, r);
      }
      if (m.returnType !== undefined) {
        m.returnType = rebuiltTypeNode(m.returnType!, r);
      }
      rebuiltStmts(m.body, r);
      break;
  }
  return m;
}

export function rebuiltClassNode(n: ClassNode, r: Ref<Rewrites>): ClassNode {
  const m = r.current(n);
  for (let i1 = 0; i1 < m.decorators.length; i1++) {
    m.decorators[i1] = rebuiltExpr(m.decorators[i1]!, r);
  }
  for (let i1 = 0; i1 < m.typeParams.length; i1++) {
    m.typeParams[i1] = rebuiltTypeParam(m.typeParams[i1]!, r);
  }
  if (m.extends !== undefined) {
    m.extends = rebuiltExpr(m.extends!, r);
  }
  for (let i1 = 0; i1 < m.implements.length; i1++) {
    m.implements[i1] = rebuiltTypeNode(m.implements[i1]!, r);
  }
  for (let i1 = 0; i1 < m.members.length; i1++) {
    m.members[i1] = rebuiltClassMember(m.members[i1]!, r);
  }
  return m;
}

export function rebuiltClassMember(n: ClassMember, r: Ref<Rewrites>): ClassMember {
  const m = r.current(n);
  switch (m.kind) {
    case "field":
      for (let i1 = 0; i1 < m.decorators.length; i1++) {
        m.decorators[i1] = rebuiltExpr(m.decorators[i1]!, r);
      }
      m.name = rebuiltOneOf2(m.name, r);
      if (m.type !== undefined) {
        m.type = rebuiltTypeNode(m.type!, r);
      }
      if (m.init !== undefined) {
        m.init = rebuiltExpr(m.init!, r);
      }
      break;
    case "method":
      for (let i1 = 0; i1 < m.decorators.length; i1++) {
        m.decorators[i1] = rebuiltExpr(m.decorators[i1]!, r);
      }
      m.name = rebuiltOneOf2(m.name, r);
      for (let i1 = 0; i1 < m.typeParams.length; i1++) {
        m.typeParams[i1] = rebuiltTypeParam(m.typeParams[i1]!, r);
      }
      for (let i1 = 0; i1 < m.params.length; i1++) {
        m.params[i1] = rebuiltParam(m.params[i1]!, r);
      }
      if (m.returnType !== undefined) {
        m.returnType = rebuiltTypeNode(m.returnType!, r);
      }
      if (m.throws !== undefined) {
        m.throws = rebuiltTypeNode(m.throws!, r);
      }
      if (m.body !== undefined) {
        rebuiltStmts(m.body!, r);
      }
      break;
    case "constructor":
      for (let i1 = 0; i1 < m.decorators.length; i1++) {
        m.decorators[i1] = rebuiltExpr(m.decorators[i1]!, r);
      }
      for (let i1 = 0; i1 < m.params.length; i1++) {
        m.params[i1] = rebuiltParam(m.params[i1]!, r);
      }
      if (m.throws !== undefined) {
        m.throws = rebuiltTypeNode(m.throws!, r);
      }
      if (m.body !== undefined) {
        rebuiltStmts(m.body!, r);
      }
      break;
    case "get":
      for (let i1 = 0; i1 < m.decorators.length; i1++) {
        m.decorators[i1] = rebuiltExpr(m.decorators[i1]!, r);
      }
      m.name = rebuiltOneOf2(m.name, r);
      for (let i1 = 0; i1 < m.params.length; i1++) {
        m.params[i1] = rebuiltParam(m.params[i1]!, r);
      }
      if (m.returnType !== undefined) {
        m.returnType = rebuiltTypeNode(m.returnType!, r);
      }
      if (m.throws !== undefined) {
        m.throws = rebuiltTypeNode(m.throws!, r);
      }
      if (m.body !== undefined) {
        rebuiltStmts(m.body!, r);
      }
      break;
    case "set":
      for (let i1 = 0; i1 < m.decorators.length; i1++) {
        m.decorators[i1] = rebuiltExpr(m.decorators[i1]!, r);
      }
      m.name = rebuiltOneOf2(m.name, r);
      for (let i1 = 0; i1 < m.params.length; i1++) {
        m.params[i1] = rebuiltParam(m.params[i1]!, r);
      }
      if (m.returnType !== undefined) {
        m.returnType = rebuiltTypeNode(m.returnType!, r);
      }
      if (m.throws !== undefined) {
        m.throws = rebuiltTypeNode(m.throws!, r);
      }
      if (m.body !== undefined) {
        rebuiltStmts(m.body!, r);
      }
      break;
    case "index":
      for (let i1 = 0; i1 < m.decorators.length; i1++) {
        m.decorators[i1] = rebuiltExpr(m.decorators[i1]!, r);
      }
      for (let i1 = 0; i1 < m.params.length; i1++) {
        m.params[i1] = rebuiltParam(m.params[i1]!, r);
      }
      m.type = rebuiltTypeNode(m.type, r);
      break;
    case "staticBlock":
      for (let i1 = 0; i1 < m.decorators.length; i1++) {
        m.decorators[i1] = rebuiltExpr(m.decorators[i1]!, r);
      }
      rebuiltStmts(m.body, r);
      break;
  }
  return m;
}

export function rebuiltParam(n: Param, r: Ref<Rewrites>): Param {
  const m = r.current(n);
  m.pattern = rebuiltPattern(m.pattern, r);
  if (m.type !== undefined) {
    m.type = rebuiltTypeNode(m.type!, r);
  }
  if (m.default !== undefined) {
    m.default = rebuiltExpr(m.default!, r);
  }
  for (let i1 = 0; i1 < m.decorators.length; i1++) {
    m.decorators[i1] = rebuiltExpr(m.decorators[i1]!, r);
  }
  return m;
}

export function rebuiltPattern(n: Pattern, r: Ref<Rewrites>): Pattern {
  const m = r.current(n);
  switch (m.kind) {
    case "object":
      for (let i1 = 0; i1 < m.props.length; i1++) {
        m.props[i1] = rebuiltPatternProp(m.props[i1]!, r);
      }
      if (m.rest !== undefined) {
        m.rest = rebuiltPattern(m.rest!, r);
      }
      break;
    case "array":
      for (let i1 = 0; i1 < m.elements.length; i1++) {
        if (m.elements[i1] !== undefined) {
          m.elements[i1] = rebuiltPattern(m.elements[i1]!, r);
        }
      }
      if (m.rest !== undefined) {
        m.rest = rebuiltPattern(m.rest!, r);
      }
      break;
    case "default":
      m.target = rebuiltPattern(m.target, r);
      m.value = rebuiltExpr(m.value, r);
      break;
    case "expr":
      m.expr = rebuiltExpr(m.expr, r);
      break;
    case "literal":
      m.value = rebuiltExpr(m.value, r);
      break;
    case "variant":
      if (m.args !== undefined) {
        for (let i1 = 0; i1 < m.args!.length; i1++) {
          m.args![i1] = rebuiltPattern(m.args![i1]!, r);
        }
      }
      break;
    case "or":
      for (let i1 = 0; i1 < m.patterns.length; i1++) {
        m.patterns[i1] = rebuiltPattern(m.patterns[i1]!, r);
      }
      break;
  }
  return m;
}

export function rebuiltMatchArm(n: MatchArm, r: Ref<Rewrites>): MatchArm {
  const m = r.current(n);
  m.pattern = rebuiltPattern(m.pattern, r);
  if (m.guard !== undefined) {
    m.guard = rebuiltExpr(m.guard!, r);
  }
  m.body = rebuiltOneOf3(m.body, r);
  return m;
}

export function rebuiltPatternProp(n: PatternProp, r: Ref<Rewrites>): PatternProp {
  const m = r.current(n);
  m.key = rebuiltOneOf2(m.key, r);
  m.value = rebuiltPattern(m.value, r);
  return m;
}

export function rebuiltSpecifier(n: Specifier, r: Ref<Rewrites>): Specifier {
  const m = r.current(n);
  return m;
}

export function rebuiltEnumMember(n: EnumMember, r: Ref<Rewrites>): EnumMember {
  const m = r.current(n);
  if (m.init !== undefined) {
    m.init = rebuiltExpr(m.init!, r);
  }
  if (m.payload !== undefined) {
    for (let i1 = 0; i1 < m.payload!.length; i1++) {
      m.payload![i1] = rebuiltTypeNode(m.payload![i1]!, r);
    }
  }
  return m;
}

export function rebuiltSwitchCase(n: SwitchCase, r: Ref<Rewrites>): SwitchCase {
  const m = r.current(n);
  if (m.test !== undefined) {
    m.test = rebuiltExpr(m.test!, r);
  }
  rebuiltStmts(m.body, r);
  return m;
}

export function rebuiltDeclarator(n: Declarator, r: Ref<Rewrites>): Declarator {
  const m = r.current(n);
  m.target = rebuiltPattern(m.target, r);
  if (m.type !== undefined) {
    m.type = rebuiltTypeNode(m.type!, r);
  }
  if (m.init !== undefined) {
    m.init = rebuiltExpr(m.init!, r);
  }
  return m;
}

export function rebuiltTypeParam(n: TypeParam, r: Ref<Rewrites>): TypeParam {
  const m = r.current(n);
  if (m.constraint !== undefined) {
    m.constraint = rebuiltTypeNode(m.constraint!, r);
  }
  if (m.default !== undefined) {
    m.default = rebuiltTypeNode(m.default!, r);
  }
  return m;
}

export function rebuiltTypeAlias(n: TypeAlias, r: Ref<Rewrites>): TypeAlias {
  const m = r.current(n);
  switch (m.kind) {
    case "typeAlias":
      for (let i1 = 0; i1 < m.typeParams.length; i1++) {
        m.typeParams[i1] = rebuiltTypeParam(m.typeParams[i1]!, r);
      }
      m.type = rebuiltTypeNode(m.type, r);
      if (m.decorators !== undefined) {
        for (let i1 = 0; i1 < m.decorators!.length; i1++) {
          m.decorators![i1] = rebuiltExpr(m.decorators![i1]!, r);
        }
      }
      if (m.js !== undefined) {
        m.js = rebuiltJsName(m.js!, r);
      }
      break;
  }
  return m;
}

export function rebuiltInterface(n: Interface, r: Ref<Rewrites>): Interface {
  const m = r.current(n);
  switch (m.kind) {
    case "interface":
      for (let i1 = 0; i1 < m.typeParams.length; i1++) {
        m.typeParams[i1] = rebuiltTypeParam(m.typeParams[i1]!, r);
      }
      for (let i1 = 0; i1 < m.extends.length; i1++) {
        m.extends[i1] = rebuiltTypeNode(m.extends[i1]!, r);
      }
      for (let i1 = 0; i1 < m.members.length; i1++) {
        m.members[i1] = rebuiltTypeMember(m.members[i1]!, r);
      }
      if (m.decorators !== undefined) {
        for (let i1 = 0; i1 < m.decorators!.length; i1++) {
          m.decorators![i1] = rebuiltExpr(m.decorators![i1]!, r);
        }
      }
      if (m.js !== undefined) {
        m.js = rebuiltJsName(m.js!, r);
      }
      if (m.jsClass !== undefined) {
        for (let i1 = 0; i1 < m.jsClass!.constructors.length; i1++) {
          for (let i2 = 0; i2 < m.jsClass!.constructors[i1]!.length; i2++) {
            m.jsClass!.constructors[i1]![i2] = rebuiltParam(m.jsClass!.constructors[i1]![i2]!, r);
          }
        }
        for (let i1 = 0; i1 < m.jsClass!.statics.length; i1++) {
          m.jsClass!.statics[i1] = rebuiltTypeMember(m.jsClass!.statics[i1]!, r);
        }
      }
      if (m.jsSource !== undefined) {
        m.jsSource = rebuiltStmt(m.jsSource!, r);
      }
      break;
  }
  return m;
}

export function rebuiltJsName(n: JsName, r: Ref<Rewrites>): JsName {
  const m = n;
  if (m.overloads !== undefined) {
    for (let i1 = 0; i1 < m.overloads!.length; i1++) {
      m.overloads![i1] = rebuiltFunc(m.overloads![i1]!, r);
    }
  }
  return m;
}

export function rebuiltFunc(n: Func, r: Ref<Rewrites>): Func {
  const m = r.current(n);
  switch (m.kind) {
    case "function":
      for (let i1 = 0; i1 < m.typeParams.length; i1++) {
        m.typeParams[i1] = rebuiltTypeParam(m.typeParams[i1]!, r);
      }
      for (let i1 = 0; i1 < m.params.length; i1++) {
        m.params[i1] = rebuiltParam(m.params[i1]!, r);
      }
      if (m.returnType !== undefined) {
        m.returnType = rebuiltTypeNode(m.returnType!, r);
      }
      if (m.throws !== undefined) {
        m.throws = rebuiltTypeNode(m.throws!, r);
      }
      if (m.body !== undefined) {
        rebuiltStmts(m.body!, r);
      }
      if (m.decorators !== undefined) {
        for (let i1 = 0; i1 < m.decorators!.length; i1++) {
          m.decorators![i1] = rebuiltExpr(m.decorators![i1]!, r);
        }
      }
      if (m.js !== undefined) {
        m.js = rebuiltJsName(m.js!, r);
      }
      break;
  }
  return m;
}

export function rebuiltStmts(n: Stmt[], r: Ref<Rewrites>): Stmt[] {
  for (let i = 0; i < n.length; i++) {
    n[i] = rebuiltStmt(n[i]!, r);
  }
  return n;
}

// Expr | Stmt[]
export function rebuiltOneOf0(n: Expr | Stmt[], r: Ref<Rewrites>): Expr | Stmt[] {
  if (Array.isArray(n)) {
    rebuiltStmts(n, r);
    return n;
  }
  return rebuiltExpr(n, r) as Expr | Stmt[];
}

// Stmt | Pattern
export function rebuiltOneOf1(n: Stmt | Pattern, r: Ref<Rewrites>): Stmt | Pattern {
  switch (n.kind) {
    case "expr":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "let":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "return":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "if":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "while":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "doWhile":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "switch":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "labeled":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "break":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "continue":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "throw":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "try":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "for":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "forIn":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "forOf":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "block":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "empty":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "debugger":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "enum":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "namespace":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "declare":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "comptime":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "unsafe":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "import":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "importEquals":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "export":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "exportDefault":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "exportNamed":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "exportAll":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "exportAssign":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "exportAsNamespace":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "typeAlias":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "interface":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "function":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "class":
      return rebuiltStmt(n, r) as Stmt | Pattern;
    case "ident":
      return rebuiltPattern(n, r) as Stmt | Pattern;
    case "object":
      return rebuiltPattern(n, r) as Stmt | Pattern;
    case "array":
      return rebuiltPattern(n, r) as Stmt | Pattern;
    case "default":
      return rebuiltPattern(n, r) as Stmt | Pattern;
    case "wildcard":
      return rebuiltPattern(n, r) as Stmt | Pattern;
    case "literal":
      return rebuiltPattern(n, r) as Stmt | Pattern;
    case "variant":
      return rebuiltPattern(n, r) as Stmt | Pattern;
    case "or":
      return rebuiltPattern(n, r) as Stmt | Pattern;
  }
  return n;
}

// PropertyName
export function rebuiltOneOf2(n: PropertyName, r: Ref<Rewrites>): PropertyName {
  if (typeof n === "string") return n;
  return rebuiltExpr(n, r) as PropertyName;
}

// Expr | Extract<Stmt, { kind: "block" }>
export function rebuiltOneOf3(n: Expr | Extract<Stmt, { kind: "block" }>, r: Ref<Rewrites>): Expr | Extract<Stmt, { kind: "block" }> {
  switch (n.kind) {
    case "int":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "float":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "bigint":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "null":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "this":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "super":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "regex":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "template":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "tagged":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "bool":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "string":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "ident":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "spread":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "array":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "object":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "function":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "arrow":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "member":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "index":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "call":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "new":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "instantiation":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "meta":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "import":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "nonNull":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "throw":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "class":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "privateName":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "unary":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "update":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "binary":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "conditional":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "assign":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "pipe":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "topic":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "match":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "comptime":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "unsafe":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "destructure":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "sequence":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "yield":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "as":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "satisfies":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "assertion":
      return rebuiltExpr(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
    case "block":
      return rebuiltStmt(n, r) as Expr | Extract<Stmt, { kind: "block" }>;
  }
  return n;
}
