// Generated from the parser's AST types by `bun scripts/walkgen.ts`; a test fails when it is stale.
// Each `rebuilt` function gives a node as the rewrite table has it, each node under it put in
// place the same way, writing the slots that held replaced nodes.
import type { Replacements } from "./ids.ts";
import type { TypeNode, Expr, Stmt, TupleElement, PropertyName, TypeMember, ObjectProp, ClassNode, ClassMember, Param, Pattern, MatchArm, PatternProp, Specifier, EnumMember, SwitchCase, Declarator, TypeParam, TypeAlias, Interface, JsName, Func } from "./parser.ts";

export function rebuiltTypeNode(n: TypeNode, r: Ref<Replacements>): TypeNode {
  let m = r.current(n);
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

export function rebuiltExpr(n: Expr, r: Ref<Replacements>): Expr {
  let m = r.current(n);
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

export function rebuiltStmt(n: Stmt, r: Ref<Replacements>): Stmt {
  let m = r.current(n);
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

export function rebuiltTupleElement(n: TupleElement, r: Ref<Replacements>): TupleElement {
  let m = r.current(n);
  m.type = rebuiltTypeNode(m.type, r);
  return m;
}

export function rebuiltTypeMember(n: TypeMember, r: Ref<Replacements>): TypeMember {
  let m = r.current(n);
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

export function rebuiltObjectProp(n: ObjectProp, r: Ref<Replacements>): ObjectProp {
  let m = r.current(n);
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

export function rebuiltClassNode(n: ClassNode, r: Ref<Replacements>): ClassNode {
  let m = r.current(n);
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

export function rebuiltClassMember(n: ClassMember, r: Ref<Replacements>): ClassMember {
  let m = r.current(n);
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

export function rebuiltParam(n: Param, r: Ref<Replacements>): Param {
  let m = r.current(n);
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

export function rebuiltPattern(n: Pattern, r: Ref<Replacements>): Pattern {
  let m = r.current(n);
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

export function rebuiltMatchArm(n: MatchArm, r: Ref<Replacements>): MatchArm {
  let m = r.current(n);
  m.pattern = rebuiltPattern(m.pattern, r);
  if (m.guard !== undefined) {
    m.guard = rebuiltExpr(m.guard!, r);
  }
  m.body = rebuiltOneOf3(m.body, r);
  return m;
}

export function rebuiltPatternProp(n: PatternProp, r: Ref<Replacements>): PatternProp {
  let m = r.current(n);
  m.key = rebuiltOneOf2(m.key, r);
  m.value = rebuiltPattern(m.value, r);
  return m;
}

export function rebuiltSpecifier(n: Specifier, r: Ref<Replacements>): Specifier {
  let m = r.current(n);
  return m;
}

export function rebuiltEnumMember(n: EnumMember, r: Ref<Replacements>): EnumMember {
  let m = r.current(n);
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

export function rebuiltSwitchCase(n: SwitchCase, r: Ref<Replacements>): SwitchCase {
  let m = r.current(n);
  if (m.test !== undefined) {
    m.test = rebuiltExpr(m.test!, r);
  }
  rebuiltStmts(m.body, r);
  return m;
}

export function rebuiltDeclarator(n: Declarator, r: Ref<Replacements>): Declarator {
  let m = r.current(n);
  m.target = rebuiltPattern(m.target, r);
  if (m.type !== undefined) {
    m.type = rebuiltTypeNode(m.type!, r);
  }
  if (m.init !== undefined) {
    m.init = rebuiltExpr(m.init!, r);
  }
  return m;
}

export function rebuiltTypeParam(n: TypeParam, r: Ref<Replacements>): TypeParam {
  let m = r.current(n);
  if (m.constraint !== undefined) {
    m.constraint = rebuiltTypeNode(m.constraint!, r);
  }
  if (m.default !== undefined) {
    m.default = rebuiltTypeNode(m.default!, r);
  }
  return m;
}

export function rebuiltTypeAlias(n: TypeAlias, r: Ref<Replacements>): TypeAlias {
  let m = r.current(n);
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

export function rebuiltInterface(n: Interface, r: Ref<Replacements>): Interface {
  let m = r.current(n);
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

export function rebuiltJsName(n: JsName, r: Ref<Replacements>): JsName {
  let m = n;
  if (m.overloads !== undefined) {
    for (let i1 = 0; i1 < m.overloads!.length; i1++) {
      m.overloads![i1] = rebuiltFunc(m.overloads![i1]!, r);
    }
  }
  return m;
}

export function rebuiltFunc(n: Func, r: Ref<Replacements>): Func {
  let m = r.current(n);
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

export function rebuiltStmts(n: Stmt[], r: Ref<Replacements>): Stmt[] {
  for (let i = 0; i < n.length; i++) {
    n[i] = rebuiltStmt(n[i]!, r);
  }
  return n;
}

// Expr | Stmt[]
export function rebuiltOneOf0(n: Expr | Stmt[], r: Ref<Replacements>): Expr | Stmt[] {
  if (Array.isArray(n)) {
    rebuiltStmts(n, r);
    return n;
  }
  return rebuiltExpr(n, r) as Expr | Stmt[];
}

// Stmt | Pattern
export function rebuiltOneOf1(n: Stmt | Pattern, r: Ref<Replacements>): Stmt | Pattern {
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
export function rebuiltOneOf2(n: PropertyName, r: Ref<Replacements>): PropertyName {
  if (typeof n === "string") return n;
  return rebuiltExpr(n, r) as PropertyName;
}

// Expr | Extract<Stmt, { kind: "block" }>
export function rebuiltOneOf3(n: Expr | Extract<Stmt, { kind: "block" }>, r: Ref<Replacements>): Expr | Extract<Stmt, { kind: "block" }> {
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
