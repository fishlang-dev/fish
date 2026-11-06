// Generated from the parser's AST types by `bun scripts/walkgen.ts`; a test fails when it is stale.
// Each `rebuilt` function gives a node as the rewrite table has it, each node under it put in
// place the same way, writing the slots that held replaced nodes.
import type { TypeNode, Expr, Stmt, TupleElement, PropertyName, TypeMember, ObjectProp, ClassNode, ClassMember, Param, Pattern, MatchArm, PatternProp, Specifier, EnumMember, SwitchCase, Declarator, TypeParam, TypeAlias, Interface, JsName, Func } from "./parser.ts";

// What a rebuild reads each node's replacement through: the node itself when it has none.
export interface Replacements {
  isEmpty(): boolean;
  currentTypeNode(node: TypeNode): TypeNode;
  current(node: Expr): Expr;
  currentStmt(node: Stmt): Stmt;
  currentTupleElement(node: TupleElement): TupleElement;
  currentTypeMember(node: TypeMember): TypeMember;
  currentObjectProp(node: ObjectProp): ObjectProp;
  currentClassNode(node: ClassNode): ClassNode;
  currentClassMember(node: ClassMember): ClassMember;
  currentParam(node: Param): Param;
  currentPattern(node: Pattern): Pattern;
  currentMatchArm(node: MatchArm): MatchArm;
  currentPatternProp(node: PatternProp): PatternProp;
  currentSpecifier(node: Specifier): Specifier;
  currentEnumMember(node: EnumMember): EnumMember;
  currentSwitchCase(node: SwitchCase): SwitchCase;
  currentDeclarator(node: Declarator): Declarator;
  currentTypeParam(node: TypeParam): TypeParam;
  currentTypeAlias(node: TypeAlias): TypeAlias;
  currentInterface(node: Interface): Interface;
  currentFunc(node: Func): Func;
}

export function rebuiltTypeNode(n: TypeNode, r: Ref<Replacements>): TypeNode {
  let m = r.currentTypeNode(n);
  switch (m.kind) {
    case "ref":
      if (m.args.length > 0) {
        let i1 = m.args.splice(0);
        i1.reverse();
        while (i1.length > 0) {
          let e1 = i1.pop()!;
          e1 = rebuiltTypeNode(e1, r);
          m.args.push(e1);
        }
      }
      break;
    case "literal":
      m.value = rebuiltExpr(m.value, r);
      break;
    case "array":
      m.element = rebuiltTypeNode(m.element, r);
      break;
    case "tuple":
      if (m.elements.length > 0) {
        let i2 = m.elements.splice(0);
        i2.reverse();
        while (i2.length > 0) {
          let e2 = i2.pop()!;
          e2 = rebuiltTupleElement(e2, r);
          m.elements.push(e2);
        }
      }
      break;
    case "object":
      if (m.members.length > 0) {
        let i3 = m.members.splice(0);
        i3.reverse();
        while (i3.length > 0) {
          let e3 = i3.pop()!;
          e3 = rebuiltTypeMember(e3, r);
          m.members.push(e3);
        }
      }
      break;
    case "function":
      if (m.typeParams.length > 0) {
        let i4 = m.typeParams.splice(0);
        i4.reverse();
        while (i4.length > 0) {
          let e4 = i4.pop()!;
          e4 = rebuiltTypeParam(e4, r);
          m.typeParams.push(e4);
        }
      }
      if (m.params.length > 0) {
        let i5 = m.params.splice(0);
        i5.reverse();
        while (i5.length > 0) {
          let e5 = i5.pop()!;
          e5 = rebuiltParam(e5, r);
          m.params.push(e5);
        }
      }
      m.returns = rebuiltTypeNode(m.returns, r);
      if (m.throws !== undefined) {
        let v6 = m.throws!;
        v6 = rebuiltTypeNode(v6, r);
        m.throws = v6;
      }
      break;
    case "union":
      if (m.types.length > 0) {
        let i7 = m.types.splice(0);
        i7.reverse();
        while (i7.length > 0) {
          let e7 = i7.pop()!;
          e7 = rebuiltTypeNode(e7, r);
          m.types.push(e7);
        }
      }
      break;
    case "intersection":
      if (m.types.length > 0) {
        let i8 = m.types.splice(0);
        i8.reverse();
        while (i8.length > 0) {
          let e8 = i8.pop()!;
          e8 = rebuiltTypeNode(e8, r);
          m.types.push(e8);
        }
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
      if (m.args.length > 0) {
        let i10 = m.args.splice(0);
        i10.reverse();
        while (i10.length > 0) {
          let e10 = i10.pop()!;
          e10 = rebuiltTypeNode(e10, r);
          m.args.push(e10);
        }
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
        let o11 = m.constraint!;
        o11 = rebuiltTypeNode(o11, r);
        m.constraint = o11;
      }
      break;
    case "template":
      if (m.types.length > 0) {
        let i13 = m.types.splice(0);
        i13.reverse();
        while (i13.length > 0) {
          let e13 = i13.pop()!;
          e13 = rebuiltTypeNode(e13, r);
          m.types.push(e13);
        }
      }
      break;
    case "mapped":
      m.constraint = rebuiltTypeNode(m.constraint, r);
      if (m.as !== undefined) {
        let o14 = m.as!;
        o14 = rebuiltTypeNode(o14, r);
        m.as = o14;
      }
      if (m.type !== undefined) {
        let o15 = m.type!;
        o15 = rebuiltTypeNode(o15, r);
        m.type = o15;
      }
      break;
    case "predicate":
      if (m.type !== undefined) {
        let o18 = m.type!;
        o18 = rebuiltTypeNode(o18, r);
        m.type = o18;
      }
      break;
  }
  return m;
}

export function rebuiltExpr(n: Expr, r: Ref<Replacements>): Expr {
  let m = r.current(n);
  switch (m.kind) {
    case "template":
      if (m.exprs.length > 0) {
        let i3 = m.exprs.splice(0);
        i3.reverse();
        while (i3.length > 0) {
          let e3 = i3.pop()!;
          e3 = rebuiltExpr(e3, r);
          m.exprs.push(e3);
        }
      }
      break;
    case "tagged":
      m.tag = rebuiltExpr(m.tag, r);
      if (m.typeArgs.length > 0) {
        let i4 = m.typeArgs.splice(0);
        i4.reverse();
        while (i4.length > 0) {
          let e4 = i4.pop()!;
          e4 = rebuiltTypeNode(e4, r);
          m.typeArgs.push(e4);
        }
      }
      m.template = rebuiltExpr(m.template, r);
      break;
    case "spread":
      m.value = rebuiltExpr(m.value, r);
      break;
    case "array":
      if (m.elements.length > 0) {
        let i5 = m.elements.splice(0);
        i5.reverse();
        while (i5.length > 0) {
          const last = i5.pop();
          if (last === undefined) {
            m.elements.push(undefined);
          } else {
            let e5 = last!;
            e5 = rebuiltExpr(e5, r);
            m.elements.push(e5);
          }
        }
      }
      break;
    case "object":
      if (m.props.length > 0) {
        let i6 = m.props.splice(0);
        i6.reverse();
        while (i6.length > 0) {
          let e6 = i6.pop()!;
          e6 = rebuiltObjectProp(e6, r);
          m.props.push(e6);
        }
      }
      break;
    case "function":
      if (m.typeParams.length > 0) {
        let i8 = m.typeParams.splice(0);
        i8.reverse();
        while (i8.length > 0) {
          let e8 = i8.pop()!;
          e8 = rebuiltTypeParam(e8, r);
          m.typeParams.push(e8);
        }
      }
      if (m.params.length > 0) {
        let i9 = m.params.splice(0);
        i9.reverse();
        while (i9.length > 0) {
          let e9 = i9.pop()!;
          e9 = rebuiltParam(e9, r);
          m.params.push(e9);
        }
      }
      if (m.returnType !== undefined) {
        let o10 = m.returnType!;
        o10 = rebuiltTypeNode(o10, r);
        m.returnType = o10;
      }
      rebuiltStmts(m.body, r);
      break;
    case "arrow":
      if (m.typeParams.length > 0) {
        let i11 = m.typeParams.splice(0);
        i11.reverse();
        while (i11.length > 0) {
          let e11 = i11.pop()!;
          e11 = rebuiltTypeParam(e11, r);
          m.typeParams.push(e11);
        }
      }
      if (m.params.length > 0) {
        let i12 = m.params.splice(0);
        i12.reverse();
        while (i12.length > 0) {
          let e12 = i12.pop()!;
          e12 = rebuiltParam(e12, r);
          m.params.push(e12);
        }
      }
      if (m.returnType !== undefined) {
        let o13 = m.returnType!;
        o13 = rebuiltTypeNode(o13, r);
        m.returnType = o13;
      }
      if (m.throws !== undefined) {
        let v14 = m.throws!;
        v14 = rebuiltTypeNode(v14, r);
        m.throws = v14;
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
      if (m.typeArgs.length > 0) {
        let i15 = m.typeArgs.splice(0);
        i15.reverse();
        while (i15.length > 0) {
          let e15 = i15.pop()!;
          e15 = rebuiltTypeNode(e15, r);
          m.typeArgs.push(e15);
        }
      }
      if (m.args.length > 0) {
        let i16 = m.args.splice(0);
        i16.reverse();
        while (i16.length > 0) {
          let e16 = i16.pop()!;
          e16 = rebuiltExpr(e16, r);
          m.args.push(e16);
        }
      }
      break;
    case "new":
      m.callee = rebuiltExpr(m.callee, r);
      if (m.typeArgs.length > 0) {
        let i19 = m.typeArgs.splice(0);
        i19.reverse();
        while (i19.length > 0) {
          let e19 = i19.pop()!;
          e19 = rebuiltTypeNode(e19, r);
          m.typeArgs.push(e19);
        }
      }
      if (m.args !== undefined) {
        let o20 = m.args!;
        if (o20.length > 0) {
          let i21 = o20.splice(0);
          i21.reverse();
          while (i21.length > 0) {
            let e21 = i21.pop()!;
            e21 = rebuiltExpr(e21, r);
            o20.push(e21);
          }
        }
        m.args = o20;
      }
      break;
    case "instantiation":
      m.expr = rebuiltExpr(m.expr, r);
      if (m.typeArgs.length > 0) {
        let i22 = m.typeArgs.splice(0);
        i22.reverse();
        while (i22.length > 0) {
          let e22 = i22.pop()!;
          e22 = rebuiltTypeNode(e22, r);
          m.typeArgs.push(e22);
        }
      }
      break;
    case "import":
      if (m.args.length > 0) {
        let i23 = m.args.splice(0);
        i23.reverse();
        while (i23.length > 0) {
          let e23 = i23.pop()!;
          e23 = rebuiltExpr(e23, r);
          m.args.push(e23);
        }
      }
      break;
    case "nonNull":
      m.expr = rebuiltExpr(m.expr, r);
      if (m.narrows !== undefined) {
        let v24 = m.narrows!;
        v24 = rebuiltTypeNode(v24, r);
        m.narrows = v24;
      }
      break;
    case "throw":
      m.value = rebuiltExpr(m.value, r);
      break;
    case "class":
      if (m.decorators.length > 0) {
        let i28 = m.decorators.splice(0);
        i28.reverse();
        while (i28.length > 0) {
          let e28 = i28.pop()!;
          e28 = rebuiltExpr(e28, r);
          m.decorators.push(e28);
        }
      }
      if (m.typeParams.length > 0) {
        let i29 = m.typeParams.splice(0);
        i29.reverse();
        while (i29.length > 0) {
          let e29 = i29.pop()!;
          e29 = rebuiltTypeParam(e29, r);
          m.typeParams.push(e29);
        }
      }
      if (m.extends !== undefined) {
        let o30 = m.extends!;
        o30 = rebuiltExpr(o30, r);
        m.extends = o30;
      }
      if (m.implements.length > 0) {
        let i31 = m.implements.splice(0);
        i31.reverse();
        while (i31.length > 0) {
          let e31 = i31.pop()!;
          e31 = rebuiltTypeNode(e31, r);
          m.implements.push(e31);
        }
      }
      if (m.members.length > 0) {
        let i32 = m.members.splice(0);
        i32.reverse();
        while (i32.length > 0) {
          let e32 = i32.pop()!;
          e32 = rebuiltClassMember(e32, r);
          m.members.push(e32);
        }
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
      if (m.arms.length > 0) {
        let i35 = m.arms.splice(0);
        i35.reverse();
        while (i35.length > 0) {
          let e35 = i35.pop()!;
          e35 = rebuiltMatchArm(e35, r);
          m.arms.push(e35);
        }
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
      if (m.exprs.length > 0) {
        let i36 = m.exprs.splice(0);
        i36.reverse();
        while (i36.length > 0) {
          let e36 = i36.pop()!;
          e36 = rebuiltExpr(e36, r);
          m.exprs.push(e36);
        }
      }
      break;
    case "yield":
      if (m.value !== undefined) {
        let o37 = m.value!;
        o37 = rebuiltExpr(o37, r);
        m.value = o37;
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
  let m = r.currentStmt(n);
  switch (m.kind) {
    case "expr":
      m.expr = rebuiltExpr(m.expr, r);
      break;
    case "let":
      if (m.declarations.length > 0) {
        let i1 = m.declarations.splice(0);
        i1.reverse();
        while (i1.length > 0) {
          let e1 = i1.pop()!;
          e1 = rebuiltDeclarator(e1, r);
          m.declarations.push(e1);
        }
      }
      break;
    case "return":
      if (m.value !== undefined) {
        let o2 = m.value!;
        o2 = rebuiltExpr(o2, r);
        m.value = o2;
      }
      break;
    case "if":
      m.cond = rebuiltExpr(m.cond, r);
      rebuiltStmts(m.then, r);
      if (m.else !== undefined) {
        let o3 = m.else!;
        rebuiltStmts(o3, r);
        m.else = o3;
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
      if (m.cases.length > 0) {
        let i4 = m.cases.splice(0);
        i4.reverse();
        while (i4.length > 0) {
          let e4 = i4.pop()!;
          e4 = rebuiltSwitchCase(e4, r);
          m.cases.push(e4);
        }
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
        let o7 = m.param!;
        o7 = rebuiltPattern(o7, r);
        m.param = o7;
      }
      if (m.paramType !== undefined) {
        let o8 = m.paramType!;
        o8 = rebuiltTypeNode(o8, r);
        m.paramType = o8;
      }
      if (m.handler !== undefined) {
        let o9 = m.handler!;
        rebuiltStmts(o9, r);
        m.handler = o9;
      }
      if (m.finalizer !== undefined) {
        let o10 = m.finalizer!;
        rebuiltStmts(o10, r);
        m.finalizer = o10;
      }
      break;
    case "for":
      if (m.init !== undefined) {
        let o11 = m.init!;
        o11 = rebuiltStmt(o11, r);
        m.init = o11;
      }
      if (m.test !== undefined) {
        let o12 = m.test!;
        o12 = rebuiltExpr(o12, r);
        m.test = o12;
      }
      if (m.update !== undefined) {
        let o13 = m.update!;
        o13 = rebuiltExpr(o13, r);
        m.update = o13;
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
      if (m.typeParams.length > 0) {
        let i14 = m.typeParams.splice(0);
        i14.reverse();
        while (i14.length > 0) {
          let e14 = i14.pop()!;
          e14 = rebuiltTypeParam(e14, r);
          m.typeParams.push(e14);
        }
      }
      if (m.members.length > 0) {
        let i15 = m.members.splice(0);
        i15.reverse();
        while (i15.length > 0) {
          let e15 = i15.pop()!;
          e15 = rebuiltEnumMember(e15, r);
          m.members.push(e15);
        }
      }
      if (m.decorators !== undefined) {
        let v16 = m.decorators!;
        if (v16.length > 0) {
          let i17 = v16.splice(0);
          i17.reverse();
          while (i17.length > 0) {
            let e17 = i17.pop()!;
            e17 = rebuiltExpr(e17, r);
            v16.push(e17);
          }
        }
        m.decorators = v16;
      }
      break;
    case "namespace":
      if (m.body !== undefined) {
        let o20 = m.body!;
        rebuiltStmts(o20, r);
        m.body = o20;
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
        let o23 = m.named!;
        if (o23.length > 0) {
          let i24 = o23.splice(0);
          i24.reverse();
          while (i24.length > 0) {
            let e24 = i24.pop()!;
            e24 = rebuiltSpecifier(e24, r);
            o23.push(e24);
          }
        }
        m.named = o23;
      }
      if (m.attributes !== undefined) {
        let o25 = m.attributes!;
        o25 = rebuiltExpr(o25, r);
        m.attributes = o25;
      }
      break;
    case "export":
      m.body = rebuiltStmt(m.body, r);
      break;
    case "exportDefault":
      if (m.declaration !== undefined) {
        let o28 = m.declaration!;
        o28 = rebuiltStmt(o28, r);
        m.declaration = o28;
      }
      if (m.value !== undefined) {
        let o29 = m.value!;
        o29 = rebuiltExpr(o29, r);
        m.value = o29;
      }
      break;
    case "exportNamed":
      if (m.specifiers.length > 0) {
        let i30 = m.specifiers.splice(0);
        i30.reverse();
        while (i30.length > 0) {
          let e30 = i30.pop()!;
          e30 = rebuiltSpecifier(e30, r);
          m.specifiers.push(e30);
        }
      }
      break;
    case "exportAssign":
      m.value = rebuiltExpr(m.value, r);
      break;
    case "typeAlias":
      if (m.typeParams.length > 0) {
        let i33 = m.typeParams.splice(0);
        i33.reverse();
        while (i33.length > 0) {
          let e33 = i33.pop()!;
          e33 = rebuiltTypeParam(e33, r);
          m.typeParams.push(e33);
        }
      }
      m.type = rebuiltTypeNode(m.type, r);
      if (m.decorators !== undefined) {
        let v34 = m.decorators!;
        if (v34.length > 0) {
          let i35 = v34.splice(0);
          i35.reverse();
          while (i35.length > 0) {
            let e35 = i35.pop()!;
            e35 = rebuiltExpr(e35, r);
            v34.push(e35);
          }
        }
        m.decorators = v34;
      }
      if (m.js !== undefined) {
        let v36 = m.js!;
        v36 = rebuiltJsName(v36, r);
        m.js = v36;
      }
      break;
    case "interface":
      if (m.typeParams.length > 0) {
        let i38 = m.typeParams.splice(0);
        i38.reverse();
        while (i38.length > 0) {
          let e38 = i38.pop()!;
          e38 = rebuiltTypeParam(e38, r);
          m.typeParams.push(e38);
        }
      }
      if (m.extends.length > 0) {
        let i39 = m.extends.splice(0);
        i39.reverse();
        while (i39.length > 0) {
          let e39 = i39.pop()!;
          e39 = rebuiltTypeNode(e39, r);
          m.extends.push(e39);
        }
      }
      if (m.members.length > 0) {
        let i40 = m.members.splice(0);
        i40.reverse();
        while (i40.length > 0) {
          let e40 = i40.pop()!;
          e40 = rebuiltTypeMember(e40, r);
          m.members.push(e40);
        }
      }
      if (m.decorators !== undefined) {
        let v41 = m.decorators!;
        if (v41.length > 0) {
          let i42 = v41.splice(0);
          i42.reverse();
          while (i42.length > 0) {
            let e42 = i42.pop()!;
            e42 = rebuiltExpr(e42, r);
            v41.push(e42);
          }
        }
        m.decorators = v41;
      }
      if (m.js !== undefined) {
        let v43 = m.js!;
        v43 = rebuiltJsName(v43, r);
        m.js = v43;
      }
      if (m.jsClass !== undefined) {
        let v44 = m.jsClass!;
        if (v44.constructors.length > 0) {
          let i45 = v44.constructors.splice(0);
          i45.reverse();
          while (i45.length > 0) {
            let e45 = i45.pop()!;
            if (e45.length > 0) {
              let i46 = e45.splice(0);
              i46.reverse();
              while (i46.length > 0) {
                let e46 = i46.pop()!;
                e46 = rebuiltParam(e46, r);
                e45.push(e46);
              }
            }
            v44.constructors.push(e45);
          }
        }
        if (v44.statics.length > 0) {
          let i47 = v44.statics.splice(0);
          i47.reverse();
          while (i47.length > 0) {
            let e47 = i47.pop()!;
            e47 = rebuiltTypeMember(e47, r);
            v44.statics.push(e47);
          }
        }
        m.jsClass = v44;
      }
      if (m.jsSource !== undefined) {
        let v48 = m.jsSource!;
        v48 = rebuiltStmt(v48, r);
        m.jsSource = v48;
      }
      break;
    case "function":
      if (m.typeParams.length > 0) {
        let i49 = m.typeParams.splice(0);
        i49.reverse();
        while (i49.length > 0) {
          let e49 = i49.pop()!;
          e49 = rebuiltTypeParam(e49, r);
          m.typeParams.push(e49);
        }
      }
      if (m.params.length > 0) {
        let i50 = m.params.splice(0);
        i50.reverse();
        while (i50.length > 0) {
          let e50 = i50.pop()!;
          e50 = rebuiltParam(e50, r);
          m.params.push(e50);
        }
      }
      if (m.returnType !== undefined) {
        let o51 = m.returnType!;
        o51 = rebuiltTypeNode(o51, r);
        m.returnType = o51;
      }
      if (m.throws !== undefined) {
        let v52 = m.throws!;
        v52 = rebuiltTypeNode(v52, r);
        m.throws = v52;
      }
      if (m.body !== undefined) {
        let o53 = m.body!;
        rebuiltStmts(o53, r);
        m.body = o53;
      }
      if (m.decorators !== undefined) {
        let v54 = m.decorators!;
        if (v54.length > 0) {
          let i55 = v54.splice(0);
          i55.reverse();
          while (i55.length > 0) {
            let e55 = i55.pop()!;
            e55 = rebuiltExpr(e55, r);
            v54.push(e55);
          }
        }
        m.decorators = v54;
      }
      if (m.js !== undefined) {
        let v56 = m.js!;
        v56 = rebuiltJsName(v56, r);
        m.js = v56;
      }
      break;
    case "class":
      if (m.decorators.length > 0) {
        let i61 = m.decorators.splice(0);
        i61.reverse();
        while (i61.length > 0) {
          let e61 = i61.pop()!;
          e61 = rebuiltExpr(e61, r);
          m.decorators.push(e61);
        }
      }
      if (m.typeParams.length > 0) {
        let i62 = m.typeParams.splice(0);
        i62.reverse();
        while (i62.length > 0) {
          let e62 = i62.pop()!;
          e62 = rebuiltTypeParam(e62, r);
          m.typeParams.push(e62);
        }
      }
      if (m.extends !== undefined) {
        let o63 = m.extends!;
        o63 = rebuiltExpr(o63, r);
        m.extends = o63;
      }
      if (m.implements.length > 0) {
        let i64 = m.implements.splice(0);
        i64.reverse();
        while (i64.length > 0) {
          let e64 = i64.pop()!;
          e64 = rebuiltTypeNode(e64, r);
          m.implements.push(e64);
        }
      }
      if (m.members.length > 0) {
        let i65 = m.members.splice(0);
        i65.reverse();
        while (i65.length > 0) {
          let e65 = i65.pop()!;
          e65 = rebuiltClassMember(e65, r);
          m.members.push(e65);
        }
      }
      break;
  }
  return m;
}

export function rebuiltTupleElement(n: TupleElement, r: Ref<Replacements>): TupleElement {
  let m = r.currentTupleElement(n);
  m.type = rebuiltTypeNode(m.type, r);
  return m;
}

export function rebuiltTypeMember(n: TypeMember, r: Ref<Replacements>): TypeMember {
  let m = r.currentTypeMember(n);
  switch (m.kind) {
    case "property":
      m.name = rebuiltOneOf2(m.name, r);
      if (m.type !== undefined) {
        let o1 = m.type!;
        o1 = rebuiltTypeNode(o1, r);
        m.type = o1;
      }
      break;
    case "method":
      m.name = rebuiltOneOf2(m.name, r);
      if (m.typeParams.length > 0) {
        let i2 = m.typeParams.splice(0);
        i2.reverse();
        while (i2.length > 0) {
          let e2 = i2.pop()!;
          e2 = rebuiltTypeParam(e2, r);
          m.typeParams.push(e2);
        }
      }
      if (m.params.length > 0) {
        let i3 = m.params.splice(0);
        i3.reverse();
        while (i3.length > 0) {
          let e3 = i3.pop()!;
          e3 = rebuiltParam(e3, r);
          m.params.push(e3);
        }
      }
      if (m.returns !== undefined) {
        let o4 = m.returns!;
        o4 = rebuiltTypeNode(o4, r);
        m.returns = o4;
      }
      if (m.throws !== undefined) {
        let v5 = m.throws!;
        v5 = rebuiltTypeNode(v5, r);
        m.throws = v5;
      }
      break;
    case "call":
      if (m.typeParams.length > 0) {
        let i6 = m.typeParams.splice(0);
        i6.reverse();
        while (i6.length > 0) {
          let e6 = i6.pop()!;
          e6 = rebuiltTypeParam(e6, r);
          m.typeParams.push(e6);
        }
      }
      if (m.params.length > 0) {
        let i7 = m.params.splice(0);
        i7.reverse();
        while (i7.length > 0) {
          let e7 = i7.pop()!;
          e7 = rebuiltParam(e7, r);
          m.params.push(e7);
        }
      }
      if (m.returns !== undefined) {
        let o8 = m.returns!;
        o8 = rebuiltTypeNode(o8, r);
        m.returns = o8;
      }
      break;
    case "construct":
      if (m.typeParams.length > 0) {
        let i9 = m.typeParams.splice(0);
        i9.reverse();
        while (i9.length > 0) {
          let e9 = i9.pop()!;
          e9 = rebuiltTypeParam(e9, r);
          m.typeParams.push(e9);
        }
      }
      if (m.params.length > 0) {
        let i10 = m.params.splice(0);
        i10.reverse();
        while (i10.length > 0) {
          let e10 = i10.pop()!;
          e10 = rebuiltParam(e10, r);
          m.params.push(e10);
        }
      }
      if (m.returns !== undefined) {
        let o11 = m.returns!;
        o11 = rebuiltTypeNode(o11, r);
        m.returns = o11;
      }
      break;
    case "index":
      if (m.params.length > 0) {
        let i12 = m.params.splice(0);
        i12.reverse();
        while (i12.length > 0) {
          let e12 = i12.pop()!;
          e12 = rebuiltParam(e12, r);
          m.params.push(e12);
        }
      }
      m.type = rebuiltTypeNode(m.type, r);
      break;
    case "get":
      m.name = rebuiltOneOf2(m.name, r);
      if (m.params.length > 0) {
        let i13 = m.params.splice(0);
        i13.reverse();
        while (i13.length > 0) {
          let e13 = i13.pop()!;
          e13 = rebuiltParam(e13, r);
          m.params.push(e13);
        }
      }
      if (m.returns !== undefined) {
        let o14 = m.returns!;
        o14 = rebuiltTypeNode(o14, r);
        m.returns = o14;
      }
      break;
    case "set":
      m.name = rebuiltOneOf2(m.name, r);
      if (m.params.length > 0) {
        let i15 = m.params.splice(0);
        i15.reverse();
        while (i15.length > 0) {
          let e15 = i15.pop()!;
          e15 = rebuiltParam(e15, r);
          m.params.push(e15);
        }
      }
      if (m.returns !== undefined) {
        let o16 = m.returns!;
        o16 = rebuiltTypeNode(o16, r);
        m.returns = o16;
      }
      break;
  }
  return m;
}

export function rebuiltObjectProp(n: ObjectProp, r: Ref<Replacements>): ObjectProp {
  let m = r.currentObjectProp(n);
  switch (m.kind) {
    case "property":
      m.key = rebuiltOneOf2(m.key, r);
      m.value = rebuiltExpr(m.value, r);
      break;
    case "shorthand":
      if (m.default !== undefined) {
        let o1 = m.default!;
        o1 = rebuiltExpr(o1, r);
        m.default = o1;
      }
      break;
    case "spread":
      m.value = rebuiltExpr(m.value, r);
      break;
    case "method":
      m.key = rebuiltOneOf2(m.key, r);
      if (m.typeParams.length > 0) {
        let i2 = m.typeParams.splice(0);
        i2.reverse();
        while (i2.length > 0) {
          let e2 = i2.pop()!;
          e2 = rebuiltTypeParam(e2, r);
          m.typeParams.push(e2);
        }
      }
      if (m.params.length > 0) {
        let i3 = m.params.splice(0);
        i3.reverse();
        while (i3.length > 0) {
          let e3 = i3.pop()!;
          e3 = rebuiltParam(e3, r);
          m.params.push(e3);
        }
      }
      if (m.returnType !== undefined) {
        let o4 = m.returnType!;
        o4 = rebuiltTypeNode(o4, r);
        m.returnType = o4;
      }
      rebuiltStmts(m.body, r);
      break;
    case "get":
      m.key = rebuiltOneOf2(m.key, r);
      if (m.params.length > 0) {
        let i5 = m.params.splice(0);
        i5.reverse();
        while (i5.length > 0) {
          let e5 = i5.pop()!;
          e5 = rebuiltParam(e5, r);
          m.params.push(e5);
        }
      }
      if (m.returnType !== undefined) {
        let o6 = m.returnType!;
        o6 = rebuiltTypeNode(o6, r);
        m.returnType = o6;
      }
      rebuiltStmts(m.body, r);
      break;
    case "set":
      m.key = rebuiltOneOf2(m.key, r);
      if (m.params.length > 0) {
        let i7 = m.params.splice(0);
        i7.reverse();
        while (i7.length > 0) {
          let e7 = i7.pop()!;
          e7 = rebuiltParam(e7, r);
          m.params.push(e7);
        }
      }
      if (m.returnType !== undefined) {
        let o8 = m.returnType!;
        o8 = rebuiltTypeNode(o8, r);
        m.returnType = o8;
      }
      rebuiltStmts(m.body, r);
      break;
  }
  return m;
}

export function rebuiltClassNode(n: ClassNode, r: Ref<Replacements>): ClassNode {
  let m = r.currentClassNode(n);
  if (m.decorators.length > 0) {
    let i2 = m.decorators.splice(0);
    i2.reverse();
    while (i2.length > 0) {
      let e2 = i2.pop()!;
      e2 = rebuiltExpr(e2, r);
      m.decorators.push(e2);
    }
  }
  if (m.typeParams.length > 0) {
    let i3 = m.typeParams.splice(0);
    i3.reverse();
    while (i3.length > 0) {
      let e3 = i3.pop()!;
      e3 = rebuiltTypeParam(e3, r);
      m.typeParams.push(e3);
    }
  }
  if (m.extends !== undefined) {
    let o4 = m.extends!;
    o4 = rebuiltExpr(o4, r);
    m.extends = o4;
  }
  if (m.implements.length > 0) {
    let i5 = m.implements.splice(0);
    i5.reverse();
    while (i5.length > 0) {
      let e5 = i5.pop()!;
      e5 = rebuiltTypeNode(e5, r);
      m.implements.push(e5);
    }
  }
  if (m.members.length > 0) {
    let i6 = m.members.splice(0);
    i6.reverse();
    while (i6.length > 0) {
      let e6 = i6.pop()!;
      e6 = rebuiltClassMember(e6, r);
      m.members.push(e6);
    }
  }
  return m;
}

export function rebuiltClassMember(n: ClassMember, r: Ref<Replacements>): ClassMember {
  let m = r.currentClassMember(n);
  switch (m.kind) {
    case "field":
      if (m.decorators.length > 0) {
        let i2 = m.decorators.splice(0);
        i2.reverse();
        while (i2.length > 0) {
          let e2 = i2.pop()!;
          e2 = rebuiltExpr(e2, r);
          m.decorators.push(e2);
        }
      }
      m.name = rebuiltOneOf2(m.name, r);
      if (m.type !== undefined) {
        let o3 = m.type!;
        o3 = rebuiltTypeNode(o3, r);
        m.type = o3;
      }
      if (m.init !== undefined) {
        let o4 = m.init!;
        o4 = rebuiltExpr(o4, r);
        m.init = o4;
      }
      break;
    case "method":
      if (m.decorators.length > 0) {
        let i6 = m.decorators.splice(0);
        i6.reverse();
        while (i6.length > 0) {
          let e6 = i6.pop()!;
          e6 = rebuiltExpr(e6, r);
          m.decorators.push(e6);
        }
      }
      m.name = rebuiltOneOf2(m.name, r);
      if (m.typeParams.length > 0) {
        let i7 = m.typeParams.splice(0);
        i7.reverse();
        while (i7.length > 0) {
          let e7 = i7.pop()!;
          e7 = rebuiltTypeParam(e7, r);
          m.typeParams.push(e7);
        }
      }
      if (m.params.length > 0) {
        let i8 = m.params.splice(0);
        i8.reverse();
        while (i8.length > 0) {
          let e8 = i8.pop()!;
          e8 = rebuiltParam(e8, r);
          m.params.push(e8);
        }
      }
      if (m.returnType !== undefined) {
        let o9 = m.returnType!;
        o9 = rebuiltTypeNode(o9, r);
        m.returnType = o9;
      }
      if (m.throws !== undefined) {
        let v10 = m.throws!;
        v10 = rebuiltTypeNode(v10, r);
        m.throws = v10;
      }
      if (m.body !== undefined) {
        let o11 = m.body!;
        rebuiltStmts(o11, r);
        m.body = o11;
      }
      break;
    case "constructor":
      if (m.decorators.length > 0) {
        let i16 = m.decorators.splice(0);
        i16.reverse();
        while (i16.length > 0) {
          let e16 = i16.pop()!;
          e16 = rebuiltExpr(e16, r);
          m.decorators.push(e16);
        }
      }
      if (m.params.length > 0) {
        let i17 = m.params.splice(0);
        i17.reverse();
        while (i17.length > 0) {
          let e17 = i17.pop()!;
          e17 = rebuiltParam(e17, r);
          m.params.push(e17);
        }
      }
      if (m.throws !== undefined) {
        let v18 = m.throws!;
        v18 = rebuiltTypeNode(v18, r);
        m.throws = v18;
      }
      if (m.body !== undefined) {
        let o19 = m.body!;
        rebuiltStmts(o19, r);
        m.body = o19;
      }
      break;
    case "get":
      if (m.decorators.length > 0) {
        let i21 = m.decorators.splice(0);
        i21.reverse();
        while (i21.length > 0) {
          let e21 = i21.pop()!;
          e21 = rebuiltExpr(e21, r);
          m.decorators.push(e21);
        }
      }
      m.name = rebuiltOneOf2(m.name, r);
      if (m.params.length > 0) {
        let i22 = m.params.splice(0);
        i22.reverse();
        while (i22.length > 0) {
          let e22 = i22.pop()!;
          e22 = rebuiltParam(e22, r);
          m.params.push(e22);
        }
      }
      if (m.returnType !== undefined) {
        let o23 = m.returnType!;
        o23 = rebuiltTypeNode(o23, r);
        m.returnType = o23;
      }
      if (m.throws !== undefined) {
        let v24 = m.throws!;
        v24 = rebuiltTypeNode(v24, r);
        m.throws = v24;
      }
      if (m.body !== undefined) {
        let o25 = m.body!;
        rebuiltStmts(o25, r);
        m.body = o25;
      }
      break;
    case "set":
      if (m.decorators.length > 0) {
        let i27 = m.decorators.splice(0);
        i27.reverse();
        while (i27.length > 0) {
          let e27 = i27.pop()!;
          e27 = rebuiltExpr(e27, r);
          m.decorators.push(e27);
        }
      }
      m.name = rebuiltOneOf2(m.name, r);
      if (m.params.length > 0) {
        let i28 = m.params.splice(0);
        i28.reverse();
        while (i28.length > 0) {
          let e28 = i28.pop()!;
          e28 = rebuiltParam(e28, r);
          m.params.push(e28);
        }
      }
      if (m.returnType !== undefined) {
        let o29 = m.returnType!;
        o29 = rebuiltTypeNode(o29, r);
        m.returnType = o29;
      }
      if (m.throws !== undefined) {
        let v30 = m.throws!;
        v30 = rebuiltTypeNode(v30, r);
        m.throws = v30;
      }
      if (m.body !== undefined) {
        let o31 = m.body!;
        rebuiltStmts(o31, r);
        m.body = o31;
      }
      break;
    case "index":
      if (m.decorators.length > 0) {
        let i33 = m.decorators.splice(0);
        i33.reverse();
        while (i33.length > 0) {
          let e33 = i33.pop()!;
          e33 = rebuiltExpr(e33, r);
          m.decorators.push(e33);
        }
      }
      if (m.params.length > 0) {
        let i34 = m.params.splice(0);
        i34.reverse();
        while (i34.length > 0) {
          let e34 = i34.pop()!;
          e34 = rebuiltParam(e34, r);
          m.params.push(e34);
        }
      }
      m.type = rebuiltTypeNode(m.type, r);
      break;
    case "staticBlock":
      if (m.decorators.length > 0) {
        let i36 = m.decorators.splice(0);
        i36.reverse();
        while (i36.length > 0) {
          let e36 = i36.pop()!;
          e36 = rebuiltExpr(e36, r);
          m.decorators.push(e36);
        }
      }
      rebuiltStmts(m.body, r);
      break;
  }
  return m;
}

export function rebuiltParam(n: Param, r: Ref<Replacements>): Param {
  let m = r.currentParam(n);
  m.pattern = rebuiltPattern(m.pattern, r);
  if (m.type !== undefined) {
    let o1 = m.type!;
    o1 = rebuiltTypeNode(o1, r);
    m.type = o1;
  }
  if (m.default !== undefined) {
    let o2 = m.default!;
    o2 = rebuiltExpr(o2, r);
    m.default = o2;
  }
  if (m.decorators.length > 0) {
    let i4 = m.decorators.splice(0);
    i4.reverse();
    while (i4.length > 0) {
      let e4 = i4.pop()!;
      e4 = rebuiltExpr(e4, r);
      m.decorators.push(e4);
    }
  }
  return m;
}

export function rebuiltPattern(n: Pattern, r: Ref<Replacements>): Pattern {
  let m = r.currentPattern(n);
  switch (m.kind) {
    case "object":
      if (m.props.length > 0) {
        let i1 = m.props.splice(0);
        i1.reverse();
        while (i1.length > 0) {
          let e1 = i1.pop()!;
          e1 = rebuiltPatternProp(e1, r);
          m.props.push(e1);
        }
      }
      if (m.rest !== undefined) {
        let o2 = m.rest!;
        o2 = rebuiltPattern(o2, r);
        m.rest = o2;
      }
      break;
    case "array":
      if (m.elements.length > 0) {
        let i3 = m.elements.splice(0);
        i3.reverse();
        while (i3.length > 0) {
          const last = i3.pop();
          if (last === undefined) {
            m.elements.push(undefined);
          } else {
            let e3 = last!;
            e3 = rebuiltPattern(e3, r);
            m.elements.push(e3);
          }
        }
      }
      if (m.rest !== undefined) {
        let o4 = m.rest!;
        o4 = rebuiltPattern(o4, r);
        m.rest = o4;
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
        let o5 = m.args!;
        if (o5.length > 0) {
          let i6 = o5.splice(0);
          i6.reverse();
          while (i6.length > 0) {
            let e6 = i6.pop()!;
            e6 = rebuiltPattern(e6, r);
            o5.push(e6);
          }
        }
        m.args = o5;
      }
      break;
    case "or":
      if (m.patterns.length > 0) {
        let i7 = m.patterns.splice(0);
        i7.reverse();
        while (i7.length > 0) {
          let e7 = i7.pop()!;
          e7 = rebuiltPattern(e7, r);
          m.patterns.push(e7);
        }
      }
      break;
  }
  return m;
}

export function rebuiltMatchArm(n: MatchArm, r: Ref<Replacements>): MatchArm {
  let m = r.currentMatchArm(n);
  m.pattern = rebuiltPattern(m.pattern, r);
  if (m.guard !== undefined) {
    let o1 = m.guard!;
    o1 = rebuiltExpr(o1, r);
    m.guard = o1;
  }
  m.body = rebuiltOneOf3(m.body, r);
  return m;
}

export function rebuiltPatternProp(n: PatternProp, r: Ref<Replacements>): PatternProp {
  let m = r.currentPatternProp(n);
  m.key = rebuiltOneOf2(m.key, r);
  m.value = rebuiltPattern(m.value, r);
  return m;
}

export function rebuiltSpecifier(n: Specifier, r: Ref<Replacements>): Specifier {
  let m = r.currentSpecifier(n);
  return m;
}

export function rebuiltEnumMember(n: EnumMember, r: Ref<Replacements>): EnumMember {
  let m = r.currentEnumMember(n);
  if (m.init !== undefined) {
    let o1 = m.init!;
    o1 = rebuiltExpr(o1, r);
    m.init = o1;
  }
  if (m.payload !== undefined) {
    let o2 = m.payload!;
    if (o2.length > 0) {
      let i3 = o2.splice(0);
      i3.reverse();
      while (i3.length > 0) {
        let e3 = i3.pop()!;
        e3 = rebuiltTypeNode(e3, r);
        o2.push(e3);
      }
    }
    m.payload = o2;
  }
  return m;
}

export function rebuiltSwitchCase(n: SwitchCase, r: Ref<Replacements>): SwitchCase {
  let m = r.currentSwitchCase(n);
  if (m.test !== undefined) {
    let o1 = m.test!;
    o1 = rebuiltExpr(o1, r);
    m.test = o1;
  }
  rebuiltStmts(m.body, r);
  return m;
}

export function rebuiltDeclarator(n: Declarator, r: Ref<Replacements>): Declarator {
  let m = r.currentDeclarator(n);
  m.target = rebuiltPattern(m.target, r);
  if (m.type !== undefined) {
    let o1 = m.type!;
    o1 = rebuiltTypeNode(o1, r);
    m.type = o1;
  }
  if (m.init !== undefined) {
    let o2 = m.init!;
    o2 = rebuiltExpr(o2, r);
    m.init = o2;
  }
  return m;
}

export function rebuiltTypeParam(n: TypeParam, r: Ref<Replacements>): TypeParam {
  let m = r.currentTypeParam(n);
  if (m.constraint !== undefined) {
    let o1 = m.constraint!;
    o1 = rebuiltTypeNode(o1, r);
    m.constraint = o1;
  }
  if (m.default !== undefined) {
    let o2 = m.default!;
    o2 = rebuiltTypeNode(o2, r);
    m.default = o2;
  }
  return m;
}

export function rebuiltTypeAlias(n: TypeAlias, r: Ref<Replacements>): TypeAlias {
  let m = r.currentTypeAlias(n);
  switch (m.kind) {
    case "typeAlias":
      if (m.typeParams.length > 0) {
        let i1 = m.typeParams.splice(0);
        i1.reverse();
        while (i1.length > 0) {
          let e1 = i1.pop()!;
          e1 = rebuiltTypeParam(e1, r);
          m.typeParams.push(e1);
        }
      }
      m.type = rebuiltTypeNode(m.type, r);
      if (m.decorators !== undefined) {
        let v2 = m.decorators!;
        if (v2.length > 0) {
          let i3 = v2.splice(0);
          i3.reverse();
          while (i3.length > 0) {
            let e3 = i3.pop()!;
            e3 = rebuiltExpr(e3, r);
            v2.push(e3);
          }
        }
        m.decorators = v2;
      }
      if (m.js !== undefined) {
        let v4 = m.js!;
        v4 = rebuiltJsName(v4, r);
        m.js = v4;
      }
      break;
  }
  return m;
}

export function rebuiltInterface(n: Interface, r: Ref<Replacements>): Interface {
  let m = r.currentInterface(n);
  switch (m.kind) {
    case "interface":
      if (m.typeParams.length > 0) {
        let i1 = m.typeParams.splice(0);
        i1.reverse();
        while (i1.length > 0) {
          let e1 = i1.pop()!;
          e1 = rebuiltTypeParam(e1, r);
          m.typeParams.push(e1);
        }
      }
      if (m.extends.length > 0) {
        let i2 = m.extends.splice(0);
        i2.reverse();
        while (i2.length > 0) {
          let e2 = i2.pop()!;
          e2 = rebuiltTypeNode(e2, r);
          m.extends.push(e2);
        }
      }
      if (m.members.length > 0) {
        let i3 = m.members.splice(0);
        i3.reverse();
        while (i3.length > 0) {
          let e3 = i3.pop()!;
          e3 = rebuiltTypeMember(e3, r);
          m.members.push(e3);
        }
      }
      if (m.decorators !== undefined) {
        let v4 = m.decorators!;
        if (v4.length > 0) {
          let i5 = v4.splice(0);
          i5.reverse();
          while (i5.length > 0) {
            let e5 = i5.pop()!;
            e5 = rebuiltExpr(e5, r);
            v4.push(e5);
          }
        }
        m.decorators = v4;
      }
      if (m.js !== undefined) {
        let v6 = m.js!;
        v6 = rebuiltJsName(v6, r);
        m.js = v6;
      }
      if (m.jsClass !== undefined) {
        let v7 = m.jsClass!;
        if (v7.constructors.length > 0) {
          let i8 = v7.constructors.splice(0);
          i8.reverse();
          while (i8.length > 0) {
            let e8 = i8.pop()!;
            if (e8.length > 0) {
              let i9 = e8.splice(0);
              i9.reverse();
              while (i9.length > 0) {
                let e9 = i9.pop()!;
                e9 = rebuiltParam(e9, r);
                e8.push(e9);
              }
            }
            v7.constructors.push(e8);
          }
        }
        if (v7.statics.length > 0) {
          let i10 = v7.statics.splice(0);
          i10.reverse();
          while (i10.length > 0) {
            let e10 = i10.pop()!;
            e10 = rebuiltTypeMember(e10, r);
            v7.statics.push(e10);
          }
        }
        m.jsClass = v7;
      }
      if (m.jsSource !== undefined) {
        let v11 = m.jsSource!;
        v11 = rebuiltStmt(v11, r);
        m.jsSource = v11;
      }
      break;
  }
  return m;
}

export function rebuiltJsName(n: JsName, r: Ref<Replacements>): JsName {
  let m = n;
  if (m.overloads !== undefined) {
    let v2 = m.overloads!;
    if (v2.length > 0) {
      let i3 = v2.splice(0);
      i3.reverse();
      while (i3.length > 0) {
        let e3 = i3.pop()!;
        e3 = rebuiltFunc(e3, r);
        v2.push(e3);
      }
    }
    m.overloads = v2;
  }
  return m;
}

export function rebuiltFunc(n: Func, r: Ref<Replacements>): Func {
  let m = r.currentFunc(n);
  switch (m.kind) {
    case "function":
      if (m.typeParams.length > 0) {
        let i1 = m.typeParams.splice(0);
        i1.reverse();
        while (i1.length > 0) {
          let e1 = i1.pop()!;
          e1 = rebuiltTypeParam(e1, r);
          m.typeParams.push(e1);
        }
      }
      if (m.params.length > 0) {
        let i2 = m.params.splice(0);
        i2.reverse();
        while (i2.length > 0) {
          let e2 = i2.pop()!;
          e2 = rebuiltParam(e2, r);
          m.params.push(e2);
        }
      }
      if (m.returnType !== undefined) {
        let o3 = m.returnType!;
        o3 = rebuiltTypeNode(o3, r);
        m.returnType = o3;
      }
      if (m.throws !== undefined) {
        let v4 = m.throws!;
        v4 = rebuiltTypeNode(v4, r);
        m.throws = v4;
      }
      if (m.body !== undefined) {
        let o5 = m.body!;
        rebuiltStmts(o5, r);
        m.body = o5;
      }
      if (m.decorators !== undefined) {
        let v6 = m.decorators!;
        if (v6.length > 0) {
          let i7 = v6.splice(0);
          i7.reverse();
          while (i7.length > 0) {
            let e7 = i7.pop()!;
            e7 = rebuiltExpr(e7, r);
            v6.push(e7);
          }
        }
        m.decorators = v6;
      }
      if (m.js !== undefined) {
        let v8 = m.js!;
        v8 = rebuiltJsName(v8, r);
        m.js = v8;
      }
      break;
  }
  return m;
}

export function rebuiltStmts(n: Mut<Stmt[]>, r: Ref<Replacements>): void {
  if (r.isEmpty() || n.length === 0) return;
  let a = n.splice(0);
  a.reverse();
  while (a.length > 0) {
    n.push(rebuiltStmt(a.pop()!, r));
  }
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
      rebuiltStmts(n.body, r);
    return n;
  }
  return n;
}

export function withIdTypeNode(n: TypeNode, id: usize, by: usize, at?: [usize, usize]): TypeNode {
  switch (n.kind) {
    case "ref":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "literal":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "array":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "tuple":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "object":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "function":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "union":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "intersection":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "operator":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "indexed":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "query":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "import":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "conditional":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "infer":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "template":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "mapped":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "predicate":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    default:
      return n;
  }
}

export function idOfTypeNode(n: Ref<TypeNode>): usize {
  switch (n.kind) {
    case "ref":
      return n.id;
    case "literal":
      return n.id;
    case "array":
      return n.id;
    case "tuple":
      return n.id;
    case "object":
      return n.id;
    case "function":
      return n.id;
    case "union":
      return n.id;
    case "intersection":
      return n.id;
    case "operator":
      return n.id;
    case "indexed":
      return n.id;
    case "query":
      return n.id;
    case "import":
      return n.id;
    case "conditional":
      return n.id;
    case "infer":
      return n.id;
    case "template":
      return n.id;
    case "mapped":
      return n.id;
    default:
      return n.id;
  }
}

export function markTypeNode(n: Ref<TypeNode>): [usize, usize] {
  switch (n.kind) {
    case "ref":
      return [n.id, n.start * 1048576 + n.end];
    case "literal":
      return [n.id, n.start * 1048576 + n.end];
    case "array":
      return [n.id, n.start * 1048576 + n.end];
    case "tuple":
      return [n.id, n.start * 1048576 + n.end];
    case "object":
      return [n.id, n.start * 1048576 + n.end];
    case "function":
      return [n.id, n.start * 1048576 + n.end];
    case "union":
      return [n.id, n.start * 1048576 + n.end];
    case "intersection":
      return [n.id, n.start * 1048576 + n.end];
    case "operator":
      return [n.id, n.start * 1048576 + n.end];
    case "indexed":
      return [n.id, n.start * 1048576 + n.end];
    case "query":
      return [n.id, n.start * 1048576 + n.end];
    case "import":
      return [n.id, n.start * 1048576 + n.end];
    case "conditional":
      return [n.id, n.start * 1048576 + n.end];
    case "infer":
      return [n.id, n.start * 1048576 + n.end];
    case "template":
      return [n.id, n.start * 1048576 + n.end];
    case "mapped":
      return [n.id, n.start * 1048576 + n.end];
    default:
      return [n.id, n.start * 1048576 + n.end];
  }
}

export function withIdExpr(n: Expr, id: usize, by: usize, at?: [usize, usize]): Expr {
  switch (n.kind) {
    case "int":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "float":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "bigint":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "null":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "this":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "super":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "regex":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "template":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "tagged":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "bool":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "string":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "ident":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "spread":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "array":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "object":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "function":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "arrow":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "member":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "index":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "call":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "new":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "instantiation":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "meta":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "import":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "nonNull":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "throw":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "class":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "privateName":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "unary":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "update":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "binary":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "conditional":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "assign":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "pipe":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "topic":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "match":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "comptime":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "unsafe":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "destructure":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "sequence":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "yield":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "as":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "satisfies":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "assertion":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    default:
      return n;
  }
}

export function idOfExpr(n: Ref<Expr>): usize {
  switch (n.kind) {
    case "int":
      return n.id;
    case "float":
      return n.id;
    case "bigint":
      return n.id;
    case "null":
      return n.id;
    case "this":
      return n.id;
    case "super":
      return n.id;
    case "regex":
      return n.id;
    case "template":
      return n.id;
    case "tagged":
      return n.id;
    case "bool":
      return n.id;
    case "string":
      return n.id;
    case "ident":
      return n.id;
    case "spread":
      return n.id;
    case "array":
      return n.id;
    case "object":
      return n.id;
    case "function":
      return n.id;
    case "arrow":
      return n.id;
    case "member":
      return n.id;
    case "index":
      return n.id;
    case "call":
      return n.id;
    case "new":
      return n.id;
    case "instantiation":
      return n.id;
    case "meta":
      return n.id;
    case "import":
      return n.id;
    case "nonNull":
      return n.id;
    case "throw":
      return n.id;
    case "class":
      return n.id;
    case "privateName":
      return n.id;
    case "unary":
      return n.id;
    case "update":
      return n.id;
    case "binary":
      return n.id;
    case "conditional":
      return n.id;
    case "assign":
      return n.id;
    case "pipe":
      return n.id;
    case "topic":
      return n.id;
    case "match":
      return n.id;
    case "comptime":
      return n.id;
    case "unsafe":
      return n.id;
    case "destructure":
      return n.id;
    case "sequence":
      return n.id;
    case "yield":
      return n.id;
    case "as":
      return n.id;
    case "satisfies":
      return n.id;
    default:
      return n.id;
  }
}

export function markExpr(n: Ref<Expr>): [usize, usize] {
  switch (n.kind) {
    case "int":
      return [n.id, n.start * 1048576 + n.end];
    case "float":
      return [n.id, n.start * 1048576 + n.end];
    case "bigint":
      return [n.id, n.start * 1048576 + n.end];
    case "null":
      return [n.id, n.start * 1048576 + n.end];
    case "this":
      return [n.id, n.start * 1048576 + n.end];
    case "super":
      return [n.id, n.start * 1048576 + n.end];
    case "regex":
      return [n.id, n.start * 1048576 + n.end];
    case "template":
      return [n.id, n.start * 1048576 + n.end];
    case "tagged":
      return [n.id, n.start * 1048576 + n.end];
    case "bool":
      return [n.id, n.start * 1048576 + n.end];
    case "string":
      return [n.id, n.start * 1048576 + n.end];
    case "ident":
      return [n.id, n.start * 1048576 + n.end];
    case "spread":
      return [n.id, n.start * 1048576 + n.end];
    case "array":
      return [n.id, n.start * 1048576 + n.end];
    case "object":
      return [n.id, n.start * 1048576 + n.end];
    case "function":
      return [n.id, n.start * 1048576 + n.end];
    case "arrow":
      return [n.id, n.start * 1048576 + n.end];
    case "member":
      return [n.id, n.start * 1048576 + n.end];
    case "index":
      return [n.id, n.start * 1048576 + n.end];
    case "call":
      return [n.id, n.start * 1048576 + n.end];
    case "new":
      return [n.id, n.start * 1048576 + n.end];
    case "instantiation":
      return [n.id, n.start * 1048576 + n.end];
    case "meta":
      return [n.id, n.start * 1048576 + n.end];
    case "import":
      return [n.id, n.start * 1048576 + n.end];
    case "nonNull":
      return [n.id, n.start * 1048576 + n.end];
    case "throw":
      return [n.id, n.start * 1048576 + n.end];
    case "class":
      return [n.id, n.start * 1048576 + n.end];
    case "privateName":
      return [n.id, n.start * 1048576 + n.end];
    case "unary":
      return [n.id, n.start * 1048576 + n.end];
    case "update":
      return [n.id, n.start * 1048576 + n.end];
    case "binary":
      return [n.id, n.start * 1048576 + n.end];
    case "conditional":
      return [n.id, n.start * 1048576 + n.end];
    case "assign":
      return [n.id, n.start * 1048576 + n.end];
    case "pipe":
      return [n.id, n.start * 1048576 + n.end];
    case "topic":
      return [n.id, n.start * 1048576 + n.end];
    case "match":
      return [n.id, n.start * 1048576 + n.end];
    case "comptime":
      return [n.id, n.start * 1048576 + n.end];
    case "unsafe":
      return [n.id, n.start * 1048576 + n.end];
    case "destructure":
      return [n.id, n.start * 1048576 + n.end];
    case "sequence":
      return [n.id, n.start * 1048576 + n.end];
    case "yield":
      return [n.id, n.start * 1048576 + n.end];
    case "as":
      return [n.id, n.start * 1048576 + n.end];
    case "satisfies":
      return [n.id, n.start * 1048576 + n.end];
    default:
      return [n.id, n.start * 1048576 + n.end];
  }
}

export function withIdStmt(n: Stmt, id: usize, by: usize, at?: [usize, usize]): Stmt {
  switch (n.kind) {
    case "expr":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "let":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "return":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "if":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "while":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "doWhile":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "switch":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "labeled":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "break":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "continue":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "throw":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "try":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "for":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "forIn":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "forOf":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "block":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "empty":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "debugger":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "enum":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "namespace":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "declare":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "comptime":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "unsafe":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "import":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "importEquals":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "export":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "exportDefault":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "exportNamed":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "exportAll":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "exportAssign":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "exportAsNamespace":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "typeAlias":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "interface":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "function":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "class":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    default:
      return n;
  }
}

export function idOfStmt(n: Ref<Stmt>): usize {
  switch (n.kind) {
    case "expr":
      return n.id;
    case "let":
      return n.id;
    case "return":
      return n.id;
    case "if":
      return n.id;
    case "while":
      return n.id;
    case "doWhile":
      return n.id;
    case "switch":
      return n.id;
    case "labeled":
      return n.id;
    case "break":
      return n.id;
    case "continue":
      return n.id;
    case "throw":
      return n.id;
    case "try":
      return n.id;
    case "for":
      return n.id;
    case "forIn":
      return n.id;
    case "forOf":
      return n.id;
    case "block":
      return n.id;
    case "empty":
      return n.id;
    case "debugger":
      return n.id;
    case "enum":
      return n.id;
    case "namespace":
      return n.id;
    case "declare":
      return n.id;
    case "comptime":
      return n.id;
    case "unsafe":
      return n.id;
    case "import":
      return n.id;
    case "importEquals":
      return n.id;
    case "export":
      return n.id;
    case "exportDefault":
      return n.id;
    case "exportNamed":
      return n.id;
    case "exportAll":
      return n.id;
    case "exportAssign":
      return n.id;
    case "exportAsNamespace":
      return n.id;
    case "typeAlias":
      return n.id;
    case "interface":
      return n.id;
    case "function":
      return n.id;
    default:
      return n.id;
  }
}

export function markStmt(n: Ref<Stmt>): [usize, usize] {
  switch (n.kind) {
    case "expr":
      return [n.id, n.start * 1048576 + n.end];
    case "let":
      return [n.id, n.start * 1048576 + n.end];
    case "return":
      return [n.id, n.start * 1048576 + n.end];
    case "if":
      return [n.id, n.start * 1048576 + n.end];
    case "while":
      return [n.id, n.start * 1048576 + n.end];
    case "doWhile":
      return [n.id, n.start * 1048576 + n.end];
    case "switch":
      return [n.id, n.start * 1048576 + n.end];
    case "labeled":
      return [n.id, n.start * 1048576 + n.end];
    case "break":
      return [n.id, n.start * 1048576 + n.end];
    case "continue":
      return [n.id, n.start * 1048576 + n.end];
    case "throw":
      return [n.id, n.start * 1048576 + n.end];
    case "try":
      return [n.id, n.start * 1048576 + n.end];
    case "for":
      return [n.id, n.start * 1048576 + n.end];
    case "forIn":
      return [n.id, n.start * 1048576 + n.end];
    case "forOf":
      return [n.id, n.start * 1048576 + n.end];
    case "block":
      return [n.id, n.start * 1048576 + n.end];
    case "empty":
      return [n.id, n.start * 1048576 + n.end];
    case "debugger":
      return [n.id, n.start * 1048576 + n.end];
    case "enum":
      return [n.id, n.start * 1048576 + n.end];
    case "namespace":
      return [n.id, n.start * 1048576 + n.end];
    case "declare":
      return [n.id, n.start * 1048576 + n.end];
    case "comptime":
      return [n.id, n.start * 1048576 + n.end];
    case "unsafe":
      return [n.id, n.start * 1048576 + n.end];
    case "import":
      return [n.id, n.start * 1048576 + n.end];
    case "importEquals":
      return [n.id, n.start * 1048576 + n.end];
    case "export":
      return [n.id, n.start * 1048576 + n.end];
    case "exportDefault":
      return [n.id, n.start * 1048576 + n.end];
    case "exportNamed":
      return [n.id, n.start * 1048576 + n.end];
    case "exportAll":
      return [n.id, n.start * 1048576 + n.end];
    case "exportAssign":
      return [n.id, n.start * 1048576 + n.end];
    case "exportAsNamespace":
      return [n.id, n.start * 1048576 + n.end];
    case "typeAlias":
      return [n.id, n.start * 1048576 + n.end];
    case "interface":
      return [n.id, n.start * 1048576 + n.end];
    case "function":
      return [n.id, n.start * 1048576 + n.end];
    default:
      return [n.id, n.start * 1048576 + n.end];
  }
}

export function withIdTupleElement(n: TupleElement, id: usize, by: usize, at?: [usize, usize]): TupleElement {
  n.id = id;
  if (at !== undefined) {
    n.start = at[0];
    n.end = at[1];
  } else if (by !== 0) {
    n.start += by;
    n.end += by;
  }
  return n;
}

export function idOfTupleElement(n: Ref<TupleElement>): usize {
  return n.id;
}

export function markTupleElement(n: Ref<TupleElement>): [usize, usize] {
  return [n.id, n.start * 1048576 + n.end];
}

export function withIdTypeMember(n: TypeMember, id: usize, by: usize, at?: [usize, usize]): TypeMember {
  switch (n.kind) {
    case "property":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "method":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "call":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "construct":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "index":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "get":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "set":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    default:
      return n;
  }
}

export function idOfTypeMember(n: Ref<TypeMember>): usize {
  switch (n.kind) {
    case "property":
      return n.id;
    case "method":
      return n.id;
    case "call":
      return n.id;
    case "construct":
      return n.id;
    case "index":
      return n.id;
    case "get":
      return n.id;
    default:
      return n.id;
  }
}

export function markTypeMember(n: Ref<TypeMember>): [usize, usize] {
  switch (n.kind) {
    case "property":
      return [n.id, n.start * 1048576 + n.end];
    case "method":
      return [n.id, n.start * 1048576 + n.end];
    case "call":
      return [n.id, n.start * 1048576 + n.end];
    case "construct":
      return [n.id, n.start * 1048576 + n.end];
    case "index":
      return [n.id, n.start * 1048576 + n.end];
    case "get":
      return [n.id, n.start * 1048576 + n.end];
    default:
      return [n.id, n.start * 1048576 + n.end];
  }
}

export function withIdObjectProp(n: ObjectProp, id: usize, by: usize, at?: [usize, usize]): ObjectProp {
  switch (n.kind) {
    case "property":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "shorthand":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "spread":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "method":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "get":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "set":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    default:
      return n;
  }
}

export function idOfObjectProp(n: Ref<ObjectProp>): usize {
  switch (n.kind) {
    case "property":
      return n.id;
    case "shorthand":
      return n.id;
    case "spread":
      return n.id;
    case "method":
      return n.id;
    case "get":
      return n.id;
    default:
      return n.id;
  }
}

export function markObjectProp(n: Ref<ObjectProp>): [usize, usize] {
  switch (n.kind) {
    case "property":
      return [n.id, n.start * 1048576 + n.end];
    case "shorthand":
      return [n.id, n.start * 1048576 + n.end];
    case "spread":
      return [n.id, n.start * 1048576 + n.end];
    case "method":
      return [n.id, n.start * 1048576 + n.end];
    case "get":
      return [n.id, n.start * 1048576 + n.end];
    default:
      return [n.id, n.start * 1048576 + n.end];
  }
}

export function withIdClassNode(n: ClassNode, id: usize, by: usize, at?: [usize, usize]): ClassNode {
  n.id = id;
  if (at !== undefined) {
    n.start = at[0];
    n.end = at[1];
  } else if (by !== 0) {
    n.start += by;
    n.end += by;
  }
  return n;
}

export function idOfClassNode(n: Ref<ClassNode>): usize {
  return n.id;
}

export function markClassNode(n: Ref<ClassNode>): [usize, usize] {
  return [n.id, n.start * 1048576 + n.end];
}

export function withIdClassMember(n: ClassMember, id: usize, by: usize, at?: [usize, usize]): ClassMember {
  switch (n.kind) {
    case "field":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "method":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "constructor":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "get":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "set":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "index":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "staticBlock":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    default:
      return n;
  }
}

export function idOfClassMember(n: Ref<ClassMember>): usize {
  switch (n.kind) {
    case "field":
      return n.id;
    case "method":
      return n.id;
    case "constructor":
      return n.id;
    case "get":
      return n.id;
    case "set":
      return n.id;
    case "index":
      return n.id;
    default:
      return n.id;
  }
}

export function markClassMember(n: Ref<ClassMember>): [usize, usize] {
  switch (n.kind) {
    case "field":
      return [n.id, n.start * 1048576 + n.end];
    case "method":
      return [n.id, n.start * 1048576 + n.end];
    case "constructor":
      return [n.id, n.start * 1048576 + n.end];
    case "get":
      return [n.id, n.start * 1048576 + n.end];
    case "set":
      return [n.id, n.start * 1048576 + n.end];
    case "index":
      return [n.id, n.start * 1048576 + n.end];
    default:
      return [n.id, n.start * 1048576 + n.end];
  }
}

export function withIdParam(n: Param, id: usize, by: usize, at?: [usize, usize]): Param {
  n.id = id;
  if (at !== undefined) {
    n.start = at[0];
    n.end = at[1];
  } else if (by !== 0) {
    n.start += by;
    n.end += by;
  }
  return n;
}

export function idOfParam(n: Ref<Param>): usize {
  return n.id;
}

export function markParam(n: Ref<Param>): [usize, usize] {
  return [n.id, n.start * 1048576 + n.end];
}

export function withIdPattern(n: Pattern, id: usize, by: usize, at?: [usize, usize]): Pattern {
  switch (n.kind) {
    case "ident":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "object":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "array":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "default":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "expr":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "wildcard":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "literal":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "variant":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    case "or":
      n.id = id;
      if (at !== undefined) {
        n.start = at[0];
        n.end = at[1];
      } else if (by !== 0) {
        n.start += by;
        n.end += by;
      }
      return n;
    default:
      return n;
  }
}

export function idOfPattern(n: Ref<Pattern>): usize {
  switch (n.kind) {
    case "ident":
      return n.id;
    case "object":
      return n.id;
    case "array":
      return n.id;
    case "default":
      return n.id;
    case "expr":
      return n.id;
    case "wildcard":
      return n.id;
    case "literal":
      return n.id;
    case "variant":
      return n.id;
    default:
      return n.id;
  }
}

export function markPattern(n: Ref<Pattern>): [usize, usize] {
  switch (n.kind) {
    case "ident":
      return [n.id, n.start * 1048576 + n.end];
    case "object":
      return [n.id, n.start * 1048576 + n.end];
    case "array":
      return [n.id, n.start * 1048576 + n.end];
    case "default":
      return [n.id, n.start * 1048576 + n.end];
    case "expr":
      return [n.id, n.start * 1048576 + n.end];
    case "wildcard":
      return [n.id, n.start * 1048576 + n.end];
    case "literal":
      return [n.id, n.start * 1048576 + n.end];
    case "variant":
      return [n.id, n.start * 1048576 + n.end];
    default:
      return [n.id, n.start * 1048576 + n.end];
  }
}

export function withIdMatchArm(n: MatchArm, id: usize, by: usize, at?: [usize, usize]): MatchArm {
  n.id = id;
  if (at !== undefined) {
    n.start = at[0];
    n.end = at[1];
  } else if (by !== 0) {
    n.start += by;
    n.end += by;
  }
  return n;
}

export function idOfMatchArm(n: Ref<MatchArm>): usize {
  return n.id;
}

export function markMatchArm(n: Ref<MatchArm>): [usize, usize] {
  return [n.id, n.start * 1048576 + n.end];
}

export function withIdPatternProp(n: PatternProp, id: usize, by: usize, at?: [usize, usize]): PatternProp {
  n.id = id;
  if (at !== undefined) {
    n.start = at[0];
    n.end = at[1];
  } else if (by !== 0) {
    n.start += by;
    n.end += by;
  }
  return n;
}

export function idOfPatternProp(n: Ref<PatternProp>): usize {
  return n.id;
}

export function markPatternProp(n: Ref<PatternProp>): [usize, usize] {
  return [n.id, n.start * 1048576 + n.end];
}

export function withIdSpecifier(n: Specifier, id: usize, by: usize, at?: [usize, usize]): Specifier {
  n.id = id;
  if (at !== undefined) {
    n.start = at[0];
    n.end = at[1];
  } else if (by !== 0) {
    n.start += by;
    n.end += by;
  }
  return n;
}

export function idOfSpecifier(n: Ref<Specifier>): usize {
  return n.id;
}

export function markSpecifier(n: Ref<Specifier>): [usize, usize] {
  return [n.id, n.start * 1048576 + n.end];
}

export function withIdEnumMember(n: EnumMember, id: usize, by: usize, at?: [usize, usize]): EnumMember {
  n.id = id;
  if (at !== undefined) {
    n.start = at[0];
    n.end = at[1];
  } else if (by !== 0) {
    n.start += by;
    n.end += by;
  }
  return n;
}

export function idOfEnumMember(n: Ref<EnumMember>): usize {
  return n.id;
}

export function markEnumMember(n: Ref<EnumMember>): [usize, usize] {
  return [n.id, n.start * 1048576 + n.end];
}

export function withIdSwitchCase(n: SwitchCase, id: usize, by: usize, at?: [usize, usize]): SwitchCase {
  n.id = id;
  if (at !== undefined) {
    n.start = at[0];
    n.end = at[1];
  } else if (by !== 0) {
    n.start += by;
    n.end += by;
  }
  return n;
}

export function idOfSwitchCase(n: Ref<SwitchCase>): usize {
  return n.id;
}

export function markSwitchCase(n: Ref<SwitchCase>): [usize, usize] {
  return [n.id, n.start * 1048576 + n.end];
}

export function withIdDeclarator(n: Declarator, id: usize, by: usize, at?: [usize, usize]): Declarator {
  n.id = id;
  if (at !== undefined) {
    n.start = at[0];
    n.end = at[1];
  } else if (by !== 0) {
    n.start += by;
    n.end += by;
  }
  return n;
}

export function idOfDeclarator(n: Ref<Declarator>): usize {
  return n.id;
}

export function markDeclarator(n: Ref<Declarator>): [usize, usize] {
  return [n.id, n.start * 1048576 + n.end];
}

export function withIdTypeParam(n: TypeParam, id: usize, by: usize, at?: [usize, usize]): TypeParam {
  n.id = id;
  if (at !== undefined) {
    n.start = at[0];
    n.end = at[1];
  } else if (by !== 0) {
    n.start += by;
    n.end += by;
  }
  return n;
}

export function idOfTypeParam(n: Ref<TypeParam>): usize {
  return n.id;
}

export function markTypeParam(n: Ref<TypeParam>): [usize, usize] {
  return [n.id, n.start * 1048576 + n.end];
}

export function withIdTypeAlias(n: TypeAlias, id: usize, by: usize, at?: [usize, usize]): TypeAlias {
  n.id = id;
  if (at !== undefined) {
    n.start = at[0];
    n.end = at[1];
  } else if (by !== 0) {
    n.start += by;
    n.end += by;
  }
  return n;
}

export function idOfTypeAlias(n: Ref<TypeAlias>): usize {
  return n.id;
}

export function markTypeAlias(n: Ref<TypeAlias>): [usize, usize] {
  return [n.id, n.start * 1048576 + n.end];
}

export function withIdInterface(n: Interface, id: usize, by: usize, at?: [usize, usize]): Interface {
  n.id = id;
  if (at !== undefined) {
    n.start = at[0];
    n.end = at[1];
  } else if (by !== 0) {
    n.start += by;
    n.end += by;
  }
  return n;
}

export function idOfInterface(n: Ref<Interface>): usize {
  return n.id;
}

export function markInterface(n: Ref<Interface>): [usize, usize] {
  return [n.id, n.start * 1048576 + n.end];
}

export function withIdFunc(n: Func, id: usize, by: usize, at?: [usize, usize]): Func {
  n.id = id;
  if (at !== undefined) {
    n.start = at[0];
    n.end = at[1];
  } else if (by !== 0) {
    n.start += by;
    n.end += by;
  }
  return n;
}

export function idOfFunc(n: Ref<Func>): usize {
  return n.id;
}

export function markFunc(n: Ref<Func>): [usize, usize] {
  return [n.id, n.start * 1048576 + n.end];
}

export function cloneTypeNode(n: Ref<TypeNode>): TypeNode {
  switch (n.kind) {
    case "ref":
      return { kind: "ref" as const, start: n.start, end: n.end, id: n.id, name: n.name, args: n.args.map((x1) => cloneTypeNode(x1)) };
    case "literal":
      return { kind: "literal" as const, start: n.start, end: n.end, id: n.id, value: cloneExpr(n.value) };
    case "array":
      return { kind: "array" as const, start: n.start, end: n.end, id: n.id, element: cloneTypeNode(n.element) };
    case "tuple":
      return { kind: "tuple" as const, start: n.start, end: n.end, id: n.id, elements: n.elements.map((x1) => cloneTupleElement(x1)) };
    case "object":
      return { kind: "object" as const, start: n.start, end: n.end, id: n.id, members: n.members.map((x1) => cloneTypeMember(x1)) };
    case "function":
      return { kind: "function" as const, start: n.start, end: n.end, id: n.id, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), params: n.params.map((x1) => cloneParam(x1)), returns: cloneTypeNode(n.returns), throws: n.throws !== undefined ? cloneTypeNode(n.throws!) : undefined, construct: n.construct, abstract: n.abstract };
    case "union":
      return { kind: "union" as const, start: n.start, end: n.end, id: n.id, types: n.types.map((x1) => cloneTypeNode(x1)) };
    case "intersection":
      return { kind: "intersection" as const, start: n.start, end: n.end, id: n.id, types: n.types.map((x1) => cloneTypeNode(x1)) };
    case "operator":
      return { kind: "operator" as const, start: n.start, end: n.end, id: n.id, op: n.op, type: cloneTypeNode(n.type) };
    case "indexed":
      return { kind: "indexed" as const, start: n.start, end: n.end, id: n.id, object: cloneTypeNode(n.object), index: cloneTypeNode(n.index) };
    case "query":
      return { kind: "query" as const, start: n.start, end: n.end, id: n.id, target: cloneTypeNode(n.target) };
    case "import":
      return { kind: "import" as const, start: n.start, end: n.end, id: n.id, module: n.module, name: n.name, args: n.args.map((x1) => cloneTypeNode(x1)) };
    case "conditional":
      return { kind: "conditional" as const, start: n.start, end: n.end, id: n.id, check: cloneTypeNode(n.check), extends: cloneTypeNode(n.extends), then: cloneTypeNode(n.then), else: cloneTypeNode(n.else) };
    case "infer":
      return { kind: "infer" as const, start: n.start, end: n.end, id: n.id, name: n.name, constraint: n.constraint !== undefined ? cloneTypeNode(n.constraint!) : undefined };
    case "template":
      return { kind: "template" as const, start: n.start, end: n.end, id: n.id, quasis: [...n.quasis], types: n.types.map((x1) => cloneTypeNode(x1)) };
    case "mapped":
      return { kind: "mapped" as const, start: n.start, end: n.end, id: n.id, name: n.name, constraint: cloneTypeNode(n.constraint), as: n.as !== undefined ? cloneTypeNode(n.as!) : undefined, type: n.type !== undefined ? cloneTypeNode(n.type!) : undefined, readonly: n.readonly, optional: n.optional };
    case "predicate":
      return { kind: "predicate" as const, start: n.start, end: n.end, id: n.id, asserts: n.asserts, name: n.name, type: n.type !== undefined ? cloneTypeNode(n.type!) : undefined };
    default:
      return cloneTypeNode(n);
  }
}

export function cloneExpr(n: Ref<Expr>): Expr {
  switch (n.kind) {
    case "int":
      return { kind: "int" as const, start: n.start, end: n.end, id: n.id, value: n.value };
    case "float":
      return { kind: "float" as const, start: n.start, end: n.end, id: n.id, value: n.value };
    case "bigint":
      return { kind: "bigint" as const, start: n.start, end: n.end, id: n.id, value: n.value };
    case "null":
      return { kind: "null" as const, start: n.start, end: n.end, id: n.id };
    case "this":
      return { kind: "this" as const, start: n.start, end: n.end, id: n.id };
    case "super":
      return { kind: "super" as const, start: n.start, end: n.end, id: n.id };
    case "regex":
      return { kind: "regex" as const, start: n.start, end: n.end, id: n.id, pattern: n.pattern, flags: n.flags };
    case "template":
      return { kind: "template" as const, start: n.start, end: n.end, id: n.id, quasis: [...n.quasis], raw: [...n.raw], exprs: n.exprs.map((x1) => cloneExpr(x1)) };
    case "tagged":
      return { kind: "tagged" as const, start: n.start, end: n.end, id: n.id, tag: cloneExpr(n.tag), typeArgs: n.typeArgs.map((x1) => cloneTypeNode(x1)), template: cloneExpr(n.template) };
    case "bool":
      return { kind: "bool" as const, start: n.start, end: n.end, id: n.id, value: n.value };
    case "string":
      return { kind: "string" as const, start: n.start, end: n.end, id: n.id, value: n.value };
    case "ident":
      return { kind: "ident" as const, start: n.start, end: n.end, id: n.id, name: n.name };
    case "spread":
      return { kind: "spread" as const, start: n.start, end: n.end, id: n.id, value: cloneExpr(n.value) };
    case "array":
      return { kind: "array" as const, start: n.start, end: n.end, id: n.id, elements: n.elements.map((x1): Extract<Expr, { kind: "array" }>["elements"][usize] => (x1 !== undefined ? cloneExpr(x1!) : undefined)) };
    case "object":
      return { kind: "object" as const, start: n.start, end: n.end, id: n.id, props: n.props.map((x1) => cloneObjectProp(x1)) };
    case "function":
      return { kind: "function" as const, start: n.start, end: n.end, id: n.id, name: n.name, async: n.async, generator: n.generator, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), params: n.params.map((x1) => cloneParam(x1)), returnType: n.returnType !== undefined ? cloneTypeNode(n.returnType!) : undefined, body: cloneStmts(n.body) };
    case "arrow":
      return { kind: "arrow" as const, start: n.start, end: n.end, id: n.id, move: n.move, async: n.async, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), params: n.params.map((x1) => cloneParam(x1)), returnType: n.returnType !== undefined ? cloneTypeNode(n.returnType!) : undefined, throws: n.throws !== undefined ? cloneTypeNode(n.throws!) : undefined, body: cloneOneOf0(n.body) };
    case "member":
      return { kind: "member" as const, start: n.start, end: n.end, id: n.id, object: cloneExpr(n.object), name: n.name, optional: n.optional };
    case "index":
      return { kind: "index" as const, start: n.start, end: n.end, id: n.id, object: cloneExpr(n.object), index: cloneExpr(n.index), optional: n.optional };
    case "call":
      return { kind: "call" as const, start: n.start, end: n.end, id: n.id, callee: cloneExpr(n.callee), typeArgs: n.typeArgs.map((x1) => cloneTypeNode(x1)), args: n.args.map((x1) => cloneExpr(x1)), optional: n.optional, implementation: n.implementation, shown: n.shown };
    case "new":
      return { kind: "new" as const, start: n.start, end: n.end, id: n.id, callee: cloneExpr(n.callee), typeArgs: n.typeArgs.map((x1) => cloneTypeNode(x1)), args: n.args !== undefined ? n.args!.map((x1) => cloneExpr(x1)) : undefined };
    case "instantiation":
      return { kind: "instantiation" as const, start: n.start, end: n.end, id: n.id, expr: cloneExpr(n.expr), typeArgs: n.typeArgs.map((x1) => cloneTypeNode(x1)) };
    case "meta":
      return { kind: "meta" as const, start: n.start, end: n.end, id: n.id, name: n.name };
    case "import":
      return { kind: "import" as const, start: n.start, end: n.end, id: n.id, args: n.args.map((x1) => cloneExpr(x1)) };
    case "nonNull":
      return { kind: "nonNull" as const, start: n.start, end: n.end, id: n.id, expr: cloneExpr(n.expr), narrows: n.narrows !== undefined ? cloneTypeNode(n.narrows!) : undefined, reason: n.reason, redundant: n.redundant };
    case "throw":
      return { kind: "throw" as const, start: n.start, end: n.end, id: n.id, value: cloneExpr(n.value) };
    case "class":
      return { kind: "class" as const, start: n.start, end: n.end, id: n.id, name: n.name, abstract: n.abstract, decorators: n.decorators.map((x1) => cloneExpr(x1)), typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), extends: n.extends !== undefined ? cloneExpr(n.extends!) : undefined, implements: n.implements.map((x1) => cloneTypeNode(x1)), members: n.members.map((x1) => cloneClassMember(x1)), derives: n.derives !== undefined ? [...n.derives!] : undefined };
    case "privateName":
      return { kind: "privateName" as const, start: n.start, end: n.end, id: n.id, name: n.name };
    case "unary":
      return { kind: "unary" as const, start: n.start, end: n.end, id: n.id, op: n.op, operand: cloneExpr(n.operand) };
    case "update":
      return { kind: "update" as const, start: n.start, end: n.end, id: n.id, op: n.op, prefix: n.prefix, operand: cloneExpr(n.operand) };
    case "binary":
      return { kind: "binary" as const, start: n.start, end: n.end, id: n.id, op: n.op, left: cloneExpr(n.left), right: cloneExpr(n.right) };
    case "conditional":
      return { kind: "conditional" as const, start: n.start, end: n.end, id: n.id, cond: cloneExpr(n.cond), then: cloneExpr(n.then), else: cloneExpr(n.else) };
    case "assign":
      return { kind: "assign" as const, start: n.start, end: n.end, id: n.id, op: n.op, target: cloneExpr(n.target), value: cloneExpr(n.value) };
    case "pipe":
      return { kind: "pipe" as const, start: n.start, end: n.end, id: n.id, value: cloneExpr(n.value), body: cloneExpr(n.body) };
    case "topic":
      return { kind: "topic" as const, start: n.start, end: n.end, id: n.id };
    case "match":
      return { kind: "match" as const, start: n.start, end: n.end, id: n.id, subject: cloneExpr(n.subject), arms: n.arms.map((x1) => cloneMatchArm(x1)) };
    case "comptime":
      return { kind: "comptime" as const, start: n.start, end: n.end, id: n.id, expr: cloneExpr(n.expr) };
    case "unsafe":
      return { kind: "unsafe" as const, start: n.start, end: n.end, id: n.id, expr: cloneExpr(n.expr) };
    case "destructure":
      return { kind: "destructure" as const, start: n.start, end: n.end, id: n.id, pattern: clonePattern(n.pattern), value: cloneExpr(n.value) };
    case "sequence":
      return { kind: "sequence" as const, start: n.start, end: n.end, id: n.id, exprs: n.exprs.map((x1) => cloneExpr(x1)) };
    case "yield":
      return { kind: "yield" as const, start: n.start, end: n.end, id: n.id, value: n.value !== undefined ? cloneExpr(n.value!) : undefined, delegate: n.delegate };
    case "as":
      return { kind: "as" as const, start: n.start, end: n.end, id: n.id, expr: cloneExpr(n.expr), type: cloneTypeNode(n.type) };
    case "satisfies":
      return { kind: "satisfies" as const, start: n.start, end: n.end, id: n.id, expr: cloneExpr(n.expr), type: cloneTypeNode(n.type) };
    case "assertion":
      return { kind: "assertion" as const, start: n.start, end: n.end, id: n.id, type: cloneTypeNode(n.type), expr: cloneExpr(n.expr) };
    default:
      return cloneExpr(n);
  }
}

export function cloneStmt(n: Ref<Stmt>): Stmt {
  switch (n.kind) {
    case "expr":
      return { kind: "expr" as const, start: n.start, end: n.end, id: n.id, expr: cloneExpr(n.expr) };
    case "let":
      return { kind: "let" as const, start: n.start, end: n.end, id: n.id, keyword: n.keyword, declarations: n.declarations.map((x1) => cloneDeclarator(x1)) };
    case "return":
      return { kind: "return" as const, start: n.start, end: n.end, id: n.id, value: n.value !== undefined ? cloneExpr(n.value!) : undefined };
    case "if":
      return { kind: "if" as const, start: n.start, end: n.end, id: n.id, cond: cloneExpr(n.cond), then: cloneStmts(n.then), else: n.else !== undefined ? cloneStmts(n.else!) : undefined };
    case "while":
      return { kind: "while" as const, start: n.start, end: n.end, id: n.id, cond: cloneExpr(n.cond), body: cloneStmts(n.body) };
    case "doWhile":
      return { kind: "doWhile" as const, start: n.start, end: n.end, id: n.id, body: cloneStmts(n.body), cond: cloneExpr(n.cond) };
    case "switch":
      return { kind: "switch" as const, start: n.start, end: n.end, id: n.id, discriminant: cloneExpr(n.discriminant), cases: n.cases.map((x1) => cloneSwitchCase(x1)) };
    case "labeled":
      return { kind: "labeled" as const, start: n.start, end: n.end, id: n.id, label: n.label, body: cloneStmt(n.body) };
    case "break":
      return { kind: "break" as const, start: n.start, end: n.end, id: n.id, label: n.label };
    case "continue":
      return { kind: "continue" as const, start: n.start, end: n.end, id: n.id, label: n.label };
    case "throw":
      return { kind: "throw" as const, start: n.start, end: n.end, id: n.id, value: cloneExpr(n.value) };
    case "try":
      return { kind: "try" as const, start: n.start, end: n.end, id: n.id, block: cloneStmts(n.block), param: n.param !== undefined ? clonePattern(n.param!) : undefined, paramType: n.paramType !== undefined ? cloneTypeNode(n.paramType!) : undefined, handler: n.handler !== undefined ? cloneStmts(n.handler!) : undefined, finalizer: n.finalizer !== undefined ? cloneStmts(n.finalizer!) : undefined };
    case "for":
      return { kind: "for" as const, start: n.start, end: n.end, id: n.id, init: n.init !== undefined ? cloneStmt(n.init!) : undefined, test: n.test !== undefined ? cloneExpr(n.test!) : undefined, update: n.update !== undefined ? cloneExpr(n.update!) : undefined, body: cloneStmts(n.body) };
    case "forIn":
      return { kind: "forIn" as const, start: n.start, end: n.end, id: n.id, await: n.await, left: cloneOneOf1(n.left), right: cloneExpr(n.right), body: cloneStmts(n.body) };
    case "forOf":
      return { kind: "forOf" as const, start: n.start, end: n.end, id: n.id, await: n.await, left: cloneOneOf1(n.left), right: cloneExpr(n.right), body: cloneStmts(n.body) };
    case "block":
      return { kind: "block" as const, start: n.start, end: n.end, id: n.id, body: cloneStmts(n.body) };
    case "empty":
      return { kind: "empty" as const, start: n.start, end: n.end, id: n.id };
    case "debugger":
      return { kind: "debugger" as const, start: n.start, end: n.end, id: n.id };
    case "enum":
      return { kind: "enum" as const, start: n.start, end: n.end, id: n.id, name: n.name, const: n.const, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), members: n.members.map((x1) => cloneEnumMember(x1)), decorators: n.decorators !== undefined ? n.decorators!.map((x1) => cloneExpr(x1)) : undefined, derives: n.derives !== undefined ? [...n.derives!] : undefined };
    case "namespace":
      return { kind: "namespace" as const, start: n.start, end: n.end, id: n.id, name: n.name, quoted: n.quoted, global: n.global, body: n.body !== undefined ? cloneStmts(n.body!) : undefined };
    case "declare":
      return { kind: "declare" as const, start: n.start, end: n.end, id: n.id, body: cloneStmt(n.body) };
    case "comptime":
      return { kind: "comptime" as const, start: n.start, end: n.end, id: n.id, body: cloneStmts(n.body) };
    case "unsafe":
      return { kind: "unsafe" as const, start: n.start, end: n.end, id: n.id, body: cloneStmts(n.body) };
    case "import":
      return { kind: "import" as const, start: n.start, end: n.end, id: n.id, typeOnly: n.typeOnly, defer: n.defer, default: n.default, namespace: n.namespace, named: n.named !== undefined ? n.named!.map((x1) => cloneSpecifier(x1)) : undefined, module: n.module, attributes: n.attributes !== undefined ? cloneExpr(n.attributes!) : undefined };
    case "importEquals":
      return { kind: "importEquals" as const, start: n.start, end: n.end, id: n.id, typeOnly: n.typeOnly, name: n.name, require: n.require, entity: n.entity };
    case "export":
      return { kind: "export" as const, start: n.start, end: n.end, id: n.id, body: cloneStmt(n.body) };
    case "exportDefault":
      return { kind: "exportDefault" as const, start: n.start, end: n.end, id: n.id, declaration: n.declaration !== undefined ? cloneStmt(n.declaration!) : undefined, value: n.value !== undefined ? cloneExpr(n.value!) : undefined };
    case "exportNamed":
      return { kind: "exportNamed" as const, start: n.start, end: n.end, id: n.id, typeOnly: n.typeOnly, specifiers: n.specifiers.map((x1) => cloneSpecifier(x1)), module: n.module };
    case "exportAll":
      return { kind: "exportAll" as const, start: n.start, end: n.end, id: n.id, typeOnly: n.typeOnly, alias: n.alias, module: n.module };
    case "exportAssign":
      return { kind: "exportAssign" as const, start: n.start, end: n.end, id: n.id, value: cloneExpr(n.value) };
    case "exportAsNamespace":
      return { kind: "exportAsNamespace" as const, start: n.start, end: n.end, id: n.id, name: n.name };
    case "typeAlias":
      return { kind: "typeAlias" as const, start: n.start, end: n.end, id: n.id, name: n.name, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), type: cloneTypeNode(n.type), decorators: n.decorators !== undefined ? n.decorators!.map((x1) => cloneExpr(x1)) : undefined, js: n.js !== undefined ? cloneJsName(n.js!) : undefined, shown: n.shown };
    case "interface":
      return { kind: "interface" as const, start: n.start, end: n.end, id: n.id, name: n.name, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), extends: n.extends.map((x1) => cloneTypeNode(x1)), members: n.members.map((x1) => cloneTypeMember(x1)), decorators: n.decorators !== undefined ? n.decorators!.map((x1) => cloneExpr(x1)) : undefined, js: n.js !== undefined ? cloneJsName(n.js!) : undefined, jsClass: n.jsClass !== undefined ? { constructors: n.jsClass!.constructors.map((x1) => x1.map((x2) => cloneParam(x2))), statics: n.jsClass!.statics.map((x1) => cloneTypeMember(x1)) } : undefined, jsSource: n.jsSource !== undefined ? cloneStmt(n.jsSource!) : undefined };
    case "function":
      return { kind: "function" as const, start: n.start, end: n.end, id: n.id, name: n.name, async: n.async, generator: n.generator, macro: n.macro, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), params: n.params.map((x1) => cloneParam(x1)), returnType: n.returnType !== undefined ? cloneTypeNode(n.returnType!) : undefined, throws: n.throws !== undefined ? cloneTypeNode(n.throws!) : undefined, body: n.body !== undefined ? cloneStmts(n.body!) : undefined, decorators: n.decorators !== undefined ? n.decorators!.map((x1) => cloneExpr(x1)) : undefined, js: n.js !== undefined ? cloneJsName(n.js!) : undefined, overloadNames: n.overloadNames !== undefined ? [...n.overloadNames!] : undefined, signature: n.signature };
    case "class":
      return { kind: "class" as const, start: n.start, end: n.end, id: n.id, name: n.name, abstract: n.abstract, decorators: n.decorators.map((x1) => cloneExpr(x1)), typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), extends: n.extends !== undefined ? cloneExpr(n.extends!) : undefined, implements: n.implements.map((x1) => cloneTypeNode(x1)), members: n.members.map((x1) => cloneClassMember(x1)), derives: n.derives !== undefined ? [...n.derives!] : undefined };
    default:
      return cloneStmt(n);
  }
}

export function cloneTupleElement(n: Ref<TupleElement>): TupleElement {
  return { start: n.start, end: n.end, id: n.id, name: n.name, optional: n.optional, rest: n.rest, type: cloneTypeNode(n.type) };
}

export function cloneTypeMember(n: Ref<TypeMember>): TypeMember {
  switch (n.kind) {
    case "property":
      return { kind: "property" as const, start: n.start, end: n.end, id: n.id, name: cloneOneOf2(n.name), optional: n.optional, readonly: n.readonly, type: n.type !== undefined ? cloneTypeNode(n.type!) : undefined };
    case "method":
      return { kind: "method" as const, start: n.start, end: n.end, id: n.id, name: cloneOneOf2(n.name), optional: n.optional, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), params: n.params.map((x1) => cloneParam(x1)), returns: n.returns !== undefined ? cloneTypeNode(n.returns!) : undefined, throws: n.throws !== undefined ? cloneTypeNode(n.throws!) : undefined };
    case "call":
      return { kind: "call" as const, start: n.start, end: n.end, id: n.id, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), params: n.params.map((x1) => cloneParam(x1)), returns: n.returns !== undefined ? cloneTypeNode(n.returns!) : undefined };
    case "construct":
      return { kind: "construct" as const, start: n.start, end: n.end, id: n.id, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), params: n.params.map((x1) => cloneParam(x1)), returns: n.returns !== undefined ? cloneTypeNode(n.returns!) : undefined };
    case "index":
      return { kind: "index" as const, start: n.start, end: n.end, id: n.id, readonly: n.readonly, params: n.params.map((x1) => cloneParam(x1)), type: cloneTypeNode(n.type) };
    case "get":
      return { kind: "get" as const, start: n.start, end: n.end, id: n.id, name: cloneOneOf2(n.name), params: n.params.map((x1) => cloneParam(x1)), returns: n.returns !== undefined ? cloneTypeNode(n.returns!) : undefined };
    case "set":
      return { kind: "set" as const, start: n.start, end: n.end, id: n.id, name: cloneOneOf2(n.name), params: n.params.map((x1) => cloneParam(x1)), returns: n.returns !== undefined ? cloneTypeNode(n.returns!) : undefined };
    default:
      return cloneTypeMember(n);
  }
}

export function cloneObjectProp(n: Ref<ObjectProp>): ObjectProp {
  switch (n.kind) {
    case "property":
      return { kind: "property" as const, start: n.start, end: n.end, id: n.id, key: cloneOneOf2(n.key), value: cloneExpr(n.value) };
    case "shorthand":
      return { kind: "shorthand" as const, start: n.start, end: n.end, id: n.id, name: n.name, default: n.default !== undefined ? cloneExpr(n.default!) : undefined };
    case "spread":
      return { kind: "spread" as const, start: n.start, end: n.end, id: n.id, value: cloneExpr(n.value) };
    case "method":
      return { kind: "method" as const, start: n.start, end: n.end, id: n.id, key: cloneOneOf2(n.key), async: n.async, generator: n.generator, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), params: n.params.map((x1) => cloneParam(x1)), returnType: n.returnType !== undefined ? cloneTypeNode(n.returnType!) : undefined, body: cloneStmts(n.body) };
    case "get":
      return { kind: "get" as const, start: n.start, end: n.end, id: n.id, key: cloneOneOf2(n.key), params: n.params.map((x1) => cloneParam(x1)), returnType: n.returnType !== undefined ? cloneTypeNode(n.returnType!) : undefined, body: cloneStmts(n.body) };
    case "set":
      return { kind: "set" as const, start: n.start, end: n.end, id: n.id, key: cloneOneOf2(n.key), params: n.params.map((x1) => cloneParam(x1)), returnType: n.returnType !== undefined ? cloneTypeNode(n.returnType!) : undefined, body: cloneStmts(n.body) };
    default:
      return cloneObjectProp(n);
  }
}

export function cloneClassNode(n: Ref<ClassNode>): ClassNode {
  return { start: n.start, end: n.end, id: n.id, name: n.name, abstract: n.abstract, decorators: n.decorators.map((x1) => cloneExpr(x1)), typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), extends: n.extends !== undefined ? cloneExpr(n.extends!) : undefined, implements: n.implements.map((x1) => cloneTypeNode(x1)), members: n.members.map((x1) => cloneClassMember(x1)), derives: n.derives !== undefined ? [...n.derives!] : undefined };
}

export function cloneClassMember(n: Ref<ClassMember>): ClassMember {
  switch (n.kind) {
    case "field":
      return { kind: "field" as const, start: n.start, end: n.end, id: n.id, modifiers: [...n.modifiers], decorators: n.decorators.map((x1) => cloneExpr(x1)), name: cloneOneOf2(n.name), optional: n.optional, definite: n.definite, type: n.type !== undefined ? cloneTypeNode(n.type!) : undefined, init: n.init !== undefined ? cloneExpr(n.init!) : undefined };
    case "method":
      return { kind: "method" as const, start: n.start, end: n.end, id: n.id, modifiers: [...n.modifiers], decorators: n.decorators.map((x1) => cloneExpr(x1)), name: cloneOneOf2(n.name), optional: n.optional, generator: n.generator, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), params: n.params.map((x1) => cloneParam(x1)), returnType: n.returnType !== undefined ? cloneTypeNode(n.returnType!) : undefined, throws: n.throws !== undefined ? cloneTypeNode(n.throws!) : undefined, body: n.body !== undefined ? cloneStmts(n.body!) : undefined, overloadNames: n.overloadNames !== undefined ? [...n.overloadNames!] : undefined, signature: n.signature };
    case "constructor":
      return { kind: "constructor" as const, start: n.start, end: n.end, id: n.id, modifiers: [...n.modifiers], decorators: n.decorators.map((x1) => cloneExpr(x1)), params: n.params.map((x1) => cloneParam(x1)), throws: n.throws !== undefined ? cloneTypeNode(n.throws!) : undefined, body: n.body !== undefined ? cloneStmts(n.body!) : undefined };
    case "get":
      return { kind: "get" as const, start: n.start, end: n.end, id: n.id, modifiers: [...n.modifiers], decorators: n.decorators.map((x1) => cloneExpr(x1)), name: cloneOneOf2(n.name), params: n.params.map((x1) => cloneParam(x1)), returnType: n.returnType !== undefined ? cloneTypeNode(n.returnType!) : undefined, throws: n.throws !== undefined ? cloneTypeNode(n.throws!) : undefined, body: n.body !== undefined ? cloneStmts(n.body!) : undefined };
    case "set":
      return { kind: "set" as const, start: n.start, end: n.end, id: n.id, modifiers: [...n.modifiers], decorators: n.decorators.map((x1) => cloneExpr(x1)), name: cloneOneOf2(n.name), params: n.params.map((x1) => cloneParam(x1)), returnType: n.returnType !== undefined ? cloneTypeNode(n.returnType!) : undefined, throws: n.throws !== undefined ? cloneTypeNode(n.throws!) : undefined, body: n.body !== undefined ? cloneStmts(n.body!) : undefined };
    case "index":
      return { kind: "index" as const, start: n.start, end: n.end, id: n.id, modifiers: [...n.modifiers], decorators: n.decorators.map((x1) => cloneExpr(x1)), params: n.params.map((x1) => cloneParam(x1)), type: cloneTypeNode(n.type) };
    case "staticBlock":
      return { kind: "staticBlock" as const, start: n.start, end: n.end, id: n.id, modifiers: [...n.modifiers], decorators: n.decorators.map((x1) => cloneExpr(x1)), body: cloneStmts(n.body) };
    default:
      return cloneClassMember(n);
  }
}

export function cloneParam(n: Ref<Param>): Param {
  return { start: n.start, end: n.end, id: n.id, pattern: clonePattern(n.pattern), type: n.type !== undefined ? cloneTypeNode(n.type!) : undefined, optional: n.optional, rest: n.rest, default: n.default !== undefined ? cloneExpr(n.default!) : undefined, modifiers: [...n.modifiers], decorators: n.decorators.map((x1) => cloneExpr(x1)), comptime: n.comptime };
}

export function clonePattern(n: Ref<Pattern>): Pattern {
  switch (n.kind) {
    case "ident":
      return { kind: "ident" as const, start: n.start, end: n.end, id: n.id, name: n.name };
    case "object":
      return { kind: "object" as const, start: n.start, end: n.end, id: n.id, props: n.props.map((x1) => clonePatternProp(x1)), rest: n.rest !== undefined ? clonePattern(n.rest!) : undefined };
    case "array":
      return { kind: "array" as const, start: n.start, end: n.end, id: n.id, elements: n.elements.map((x1): Extract<Pattern, { kind: "array" }>["elements"][usize] => (x1 !== undefined ? clonePattern(x1!) : undefined)), rest: n.rest !== undefined ? clonePattern(n.rest!) : undefined };
    case "default":
      return { kind: "default" as const, start: n.start, end: n.end, id: n.id, target: clonePattern(n.target), value: cloneExpr(n.value) };
    case "expr":
      return { kind: "expr" as const, start: n.start, end: n.end, id: n.id, expr: cloneExpr(n.expr) };
    case "wildcard":
      return { kind: "wildcard" as const, start: n.start, end: n.end, id: n.id };
    case "literal":
      return { kind: "literal" as const, start: n.start, end: n.end, id: n.id, value: cloneExpr(n.value) };
    case "variant":
      return { kind: "variant" as const, start: n.start, end: n.end, id: n.id, name: n.name, args: n.args !== undefined ? n.args!.map((x1) => clonePattern(x1)) : undefined };
    case "or":
      return { kind: "or" as const, start: n.start, end: n.end, id: n.id, patterns: n.patterns.map((x1) => clonePattern(x1)) };
    default:
      return clonePattern(n);
  }
}

export function cloneMatchArm(n: Ref<MatchArm>): MatchArm {
  return { start: n.start, end: n.end, id: n.id, pattern: clonePattern(n.pattern), guard: n.guard !== undefined ? cloneExpr(n.guard!) : undefined, body: cloneOneOf3(n.body) };
}

export function clonePatternProp(n: Ref<PatternProp>): PatternProp {
  return { start: n.start, end: n.end, id: n.id, key: cloneOneOf2(n.key), value: clonePattern(n.value) };
}

export function cloneSpecifier(n: Ref<Specifier>): Specifier {
  return { start: n.start, end: n.end, id: n.id, name: n.name, alias: n.alias, typeOnly: n.typeOnly };
}

export function cloneEnumMember(n: Ref<EnumMember>): EnumMember {
  return { start: n.start, end: n.end, id: n.id, name: n.name, init: n.init !== undefined ? cloneExpr(n.init!) : undefined, payload: n.payload !== undefined ? n.payload!.map((x1) => cloneTypeNode(x1)) : undefined };
}

export function cloneSwitchCase(n: Ref<SwitchCase>): SwitchCase {
  return { start: n.start, end: n.end, id: n.id, test: n.test !== undefined ? cloneExpr(n.test!) : undefined, body: cloneStmts(n.body) };
}

export function cloneDeclarator(n: Ref<Declarator>): Declarator {
  return { start: n.start, end: n.end, id: n.id, target: clonePattern(n.target), type: n.type !== undefined ? cloneTypeNode(n.type!) : undefined, init: n.init !== undefined ? cloneExpr(n.init!) : undefined };
}

export function cloneTypeParam(n: Ref<TypeParam>): TypeParam {
  return { start: n.start, end: n.end, id: n.id, name: n.name, constraint: n.constraint !== undefined ? cloneTypeNode(n.constraint!) : undefined, default: n.default !== undefined ? cloneTypeNode(n.default!) : undefined, modifiers: [...n.modifiers] };
}

export function cloneTypeAlias(n: Ref<TypeAlias>): TypeAlias {
  return { kind: "typeAlias" as const, start: n.start, end: n.end, id: n.id, name: n.name, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), type: cloneTypeNode(n.type), decorators: n.decorators !== undefined ? n.decorators!.map((x1) => cloneExpr(x1)) : undefined, js: n.js !== undefined ? cloneJsName(n.js!) : undefined, shown: n.shown };
}

export function cloneInterface(n: Ref<Interface>): Interface {
  return { kind: "interface" as const, start: n.start, end: n.end, id: n.id, name: n.name, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), extends: n.extends.map((x1) => cloneTypeNode(x1)), members: n.members.map((x1) => cloneTypeMember(x1)), decorators: n.decorators !== undefined ? n.decorators!.map((x1) => cloneExpr(x1)) : undefined, js: n.js !== undefined ? cloneJsName(n.js!) : undefined, jsClass: n.jsClass !== undefined ? { constructors: n.jsClass!.constructors.map((x1) => x1.map((x2) => cloneParam(x2))), statics: n.jsClass!.statics.map((x1) => cloneTypeMember(x1)) } : undefined, jsSource: n.jsSource !== undefined ? cloneStmt(n.jsSource!) : undefined };
}

export function cloneJsName(n: Ref<JsName>): JsName {
  return { module: n.module, package: n.package, name: n.name, const: n.const, overloads: n.overloads !== undefined ? n.overloads!.map((x1) => cloneFunc(x1)) : undefined };
}

export function cloneFunc(n: Ref<Func>): Func {
  return { kind: "function" as const, start: n.start, end: n.end, id: n.id, name: n.name, async: n.async, generator: n.generator, macro: n.macro, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), params: n.params.map((x1) => cloneParam(x1)), returnType: n.returnType !== undefined ? cloneTypeNode(n.returnType!) : undefined, throws: n.throws !== undefined ? cloneTypeNode(n.throws!) : undefined, body: n.body !== undefined ? cloneStmts(n.body!) : undefined, decorators: n.decorators !== undefined ? n.decorators!.map((x1) => cloneExpr(x1)) : undefined, js: n.js !== undefined ? cloneJsName(n.js!) : undefined, overloadNames: n.overloadNames !== undefined ? [...n.overloadNames!] : undefined, signature: n.signature };
}

export function cloneStmts(n: Ref<Stmt[]>): Stmt[] {
  return n.map((s) => cloneStmt(s));
}

// Expr | Stmt[]
export function cloneOneOf0(n: Ref<Expr | Stmt[]>): Expr | Stmt[] {
  if (Array.isArray(n)) return cloneStmts(n);
  return cloneExpr(n) as Expr | Stmt[];
}

// Stmt | Pattern
export function cloneOneOf1(n: Ref<Stmt | Pattern>): Stmt | Pattern {
  switch (n.kind) {
    case "expr":
      return { kind: "expr" as const, start: n.start, end: n.end, id: n.id, expr: cloneExpr(n.expr) };
    case "let":
      return { kind: "let" as const, start: n.start, end: n.end, id: n.id, keyword: n.keyword, declarations: n.declarations.map((x1) => cloneDeclarator(x1)) };
    case "return":
      return { kind: "return" as const, start: n.start, end: n.end, id: n.id, value: n.value !== undefined ? cloneExpr(n.value!) : undefined };
    case "if":
      return { kind: "if" as const, start: n.start, end: n.end, id: n.id, cond: cloneExpr(n.cond), then: cloneStmts(n.then), else: n.else !== undefined ? cloneStmts(n.else!) : undefined };
    case "while":
      return { kind: "while" as const, start: n.start, end: n.end, id: n.id, cond: cloneExpr(n.cond), body: cloneStmts(n.body) };
    case "doWhile":
      return { kind: "doWhile" as const, start: n.start, end: n.end, id: n.id, body: cloneStmts(n.body), cond: cloneExpr(n.cond) };
    case "switch":
      return { kind: "switch" as const, start: n.start, end: n.end, id: n.id, discriminant: cloneExpr(n.discriminant), cases: n.cases.map((x1) => cloneSwitchCase(x1)) };
    case "labeled":
      return { kind: "labeled" as const, start: n.start, end: n.end, id: n.id, label: n.label, body: cloneStmt(n.body) };
    case "break":
      return { kind: "break" as const, start: n.start, end: n.end, id: n.id, label: n.label };
    case "continue":
      return { kind: "continue" as const, start: n.start, end: n.end, id: n.id, label: n.label };
    case "throw":
      return { kind: "throw" as const, start: n.start, end: n.end, id: n.id, value: cloneExpr(n.value) };
    case "try":
      return { kind: "try" as const, start: n.start, end: n.end, id: n.id, block: cloneStmts(n.block), param: n.param !== undefined ? clonePattern(n.param!) : undefined, paramType: n.paramType !== undefined ? cloneTypeNode(n.paramType!) : undefined, handler: n.handler !== undefined ? cloneStmts(n.handler!) : undefined, finalizer: n.finalizer !== undefined ? cloneStmts(n.finalizer!) : undefined };
    case "for":
      return { kind: "for" as const, start: n.start, end: n.end, id: n.id, init: n.init !== undefined ? cloneStmt(n.init!) : undefined, test: n.test !== undefined ? cloneExpr(n.test!) : undefined, update: n.update !== undefined ? cloneExpr(n.update!) : undefined, body: cloneStmts(n.body) };
    case "forIn":
      return { kind: "forIn" as const, start: n.start, end: n.end, id: n.id, await: n.await, left: cloneOneOf1(n.left), right: cloneExpr(n.right), body: cloneStmts(n.body) };
    case "forOf":
      return { kind: "forOf" as const, start: n.start, end: n.end, id: n.id, await: n.await, left: cloneOneOf1(n.left), right: cloneExpr(n.right), body: cloneStmts(n.body) };
    case "block":
      return { kind: "block" as const, start: n.start, end: n.end, id: n.id, body: cloneStmts(n.body) };
    case "empty":
      return { kind: "empty" as const, start: n.start, end: n.end, id: n.id };
    case "debugger":
      return { kind: "debugger" as const, start: n.start, end: n.end, id: n.id };
    case "enum":
      return { kind: "enum" as const, start: n.start, end: n.end, id: n.id, name: n.name, const: n.const, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), members: n.members.map((x1) => cloneEnumMember(x1)), decorators: n.decorators !== undefined ? n.decorators!.map((x1) => cloneExpr(x1)) : undefined, derives: n.derives !== undefined ? [...n.derives!] : undefined };
    case "namespace":
      return { kind: "namespace" as const, start: n.start, end: n.end, id: n.id, name: n.name, quoted: n.quoted, global: n.global, body: n.body !== undefined ? cloneStmts(n.body!) : undefined };
    case "declare":
      return { kind: "declare" as const, start: n.start, end: n.end, id: n.id, body: cloneStmt(n.body) };
    case "comptime":
      return { kind: "comptime" as const, start: n.start, end: n.end, id: n.id, body: cloneStmts(n.body) };
    case "unsafe":
      return { kind: "unsafe" as const, start: n.start, end: n.end, id: n.id, body: cloneStmts(n.body) };
    case "import":
      return { kind: "import" as const, start: n.start, end: n.end, id: n.id, typeOnly: n.typeOnly, defer: n.defer, default: n.default, namespace: n.namespace, named: n.named !== undefined ? n.named!.map((x1) => cloneSpecifier(x1)) : undefined, module: n.module, attributes: n.attributes !== undefined ? cloneExpr(n.attributes!) : undefined };
    case "importEquals":
      return { kind: "importEquals" as const, start: n.start, end: n.end, id: n.id, typeOnly: n.typeOnly, name: n.name, require: n.require, entity: n.entity };
    case "export":
      return { kind: "export" as const, start: n.start, end: n.end, id: n.id, body: cloneStmt(n.body) };
    case "exportDefault":
      return { kind: "exportDefault" as const, start: n.start, end: n.end, id: n.id, declaration: n.declaration !== undefined ? cloneStmt(n.declaration!) : undefined, value: n.value !== undefined ? cloneExpr(n.value!) : undefined };
    case "exportNamed":
      return { kind: "exportNamed" as const, start: n.start, end: n.end, id: n.id, typeOnly: n.typeOnly, specifiers: n.specifiers.map((x1) => cloneSpecifier(x1)), module: n.module };
    case "exportAll":
      return { kind: "exportAll" as const, start: n.start, end: n.end, id: n.id, typeOnly: n.typeOnly, alias: n.alias, module: n.module };
    case "exportAssign":
      return { kind: "exportAssign" as const, start: n.start, end: n.end, id: n.id, value: cloneExpr(n.value) };
    case "exportAsNamespace":
      return { kind: "exportAsNamespace" as const, start: n.start, end: n.end, id: n.id, name: n.name };
    case "typeAlias":
      return { kind: "typeAlias" as const, start: n.start, end: n.end, id: n.id, name: n.name, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), type: cloneTypeNode(n.type), decorators: n.decorators !== undefined ? n.decorators!.map((x1) => cloneExpr(x1)) : undefined, js: n.js !== undefined ? cloneJsName(n.js!) : undefined, shown: n.shown };
    case "interface":
      return { kind: "interface" as const, start: n.start, end: n.end, id: n.id, name: n.name, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), extends: n.extends.map((x1) => cloneTypeNode(x1)), members: n.members.map((x1) => cloneTypeMember(x1)), decorators: n.decorators !== undefined ? n.decorators!.map((x1) => cloneExpr(x1)) : undefined, js: n.js !== undefined ? cloneJsName(n.js!) : undefined, jsClass: n.jsClass !== undefined ? { constructors: n.jsClass!.constructors.map((x1) => x1.map((x2) => cloneParam(x2))), statics: n.jsClass!.statics.map((x1) => cloneTypeMember(x1)) } : undefined, jsSource: n.jsSource !== undefined ? cloneStmt(n.jsSource!) : undefined };
    case "function":
      return { kind: "function" as const, start: n.start, end: n.end, id: n.id, name: n.name, async: n.async, generator: n.generator, macro: n.macro, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), params: n.params.map((x1) => cloneParam(x1)), returnType: n.returnType !== undefined ? cloneTypeNode(n.returnType!) : undefined, throws: n.throws !== undefined ? cloneTypeNode(n.throws!) : undefined, body: n.body !== undefined ? cloneStmts(n.body!) : undefined, decorators: n.decorators !== undefined ? n.decorators!.map((x1) => cloneExpr(x1)) : undefined, js: n.js !== undefined ? cloneJsName(n.js!) : undefined, overloadNames: n.overloadNames !== undefined ? [...n.overloadNames!] : undefined, signature: n.signature };
    case "class":
      return { kind: "class" as const, start: n.start, end: n.end, id: n.id, name: n.name, abstract: n.abstract, decorators: n.decorators.map((x1) => cloneExpr(x1)), typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), extends: n.extends !== undefined ? cloneExpr(n.extends!) : undefined, implements: n.implements.map((x1) => cloneTypeNode(x1)), members: n.members.map((x1) => cloneClassMember(x1)), derives: n.derives !== undefined ? [...n.derives!] : undefined };
    case "ident":
      return { kind: "ident" as const, start: n.start, end: n.end, id: n.id, name: n.name };
    case "object":
      return { kind: "object" as const, start: n.start, end: n.end, id: n.id, props: n.props.map((x1) => clonePatternProp(x1)), rest: n.rest !== undefined ? clonePattern(n.rest!) : undefined };
    case "array":
      return { kind: "array" as const, start: n.start, end: n.end, id: n.id, elements: n.elements.map((x1): Extract<Pattern, { kind: "array" }>["elements"][usize] => (x1 !== undefined ? clonePattern(x1!) : undefined)), rest: n.rest !== undefined ? clonePattern(n.rest!) : undefined };
    case "default":
      return { kind: "default" as const, start: n.start, end: n.end, id: n.id, target: clonePattern(n.target), value: cloneExpr(n.value) };
    case "wildcard":
      return { kind: "wildcard" as const, start: n.start, end: n.end, id: n.id };
    case "literal":
      return { kind: "literal" as const, start: n.start, end: n.end, id: n.id, value: cloneExpr(n.value) };
    case "variant":
      return { kind: "variant" as const, start: n.start, end: n.end, id: n.id, name: n.name, args: n.args !== undefined ? n.args!.map((x1) => clonePattern(x1)) : undefined };
    case "or":
      return { kind: "or" as const, start: n.start, end: n.end, id: n.id, patterns: n.patterns.map((x1) => clonePattern(x1)) };
    default:
      return cloneOneOf1(n);
  }
}

// PropertyName
export function cloneOneOf2(n: Ref<PropertyName>): PropertyName {
  if (typeof n === "string") return n;
  return cloneExpr(n) as PropertyName;
}

// Expr | Extract<Stmt, { kind: "block" }>
export function cloneOneOf3(n: Ref<Expr | Extract<Stmt, { kind: "block" }>>): Expr | Extract<Stmt, { kind: "block" }> {
  switch (n.kind) {
    case "int":
      return { kind: "int" as const, start: n.start, end: n.end, id: n.id, value: n.value };
    case "float":
      return { kind: "float" as const, start: n.start, end: n.end, id: n.id, value: n.value };
    case "bigint":
      return { kind: "bigint" as const, start: n.start, end: n.end, id: n.id, value: n.value };
    case "null":
      return { kind: "null" as const, start: n.start, end: n.end, id: n.id };
    case "this":
      return { kind: "this" as const, start: n.start, end: n.end, id: n.id };
    case "super":
      return { kind: "super" as const, start: n.start, end: n.end, id: n.id };
    case "regex":
      return { kind: "regex" as const, start: n.start, end: n.end, id: n.id, pattern: n.pattern, flags: n.flags };
    case "template":
      return { kind: "template" as const, start: n.start, end: n.end, id: n.id, quasis: [...n.quasis], raw: [...n.raw], exprs: n.exprs.map((x1) => cloneExpr(x1)) };
    case "tagged":
      return { kind: "tagged" as const, start: n.start, end: n.end, id: n.id, tag: cloneExpr(n.tag), typeArgs: n.typeArgs.map((x1) => cloneTypeNode(x1)), template: cloneExpr(n.template) };
    case "bool":
      return { kind: "bool" as const, start: n.start, end: n.end, id: n.id, value: n.value };
    case "string":
      return { kind: "string" as const, start: n.start, end: n.end, id: n.id, value: n.value };
    case "ident":
      return { kind: "ident" as const, start: n.start, end: n.end, id: n.id, name: n.name };
    case "spread":
      return { kind: "spread" as const, start: n.start, end: n.end, id: n.id, value: cloneExpr(n.value) };
    case "array":
      return { kind: "array" as const, start: n.start, end: n.end, id: n.id, elements: n.elements.map((x1): Extract<Expr, { kind: "array" }>["elements"][usize] => (x1 !== undefined ? cloneExpr(x1!) : undefined)) };
    case "object":
      return { kind: "object" as const, start: n.start, end: n.end, id: n.id, props: n.props.map((x1) => cloneObjectProp(x1)) };
    case "function":
      return { kind: "function" as const, start: n.start, end: n.end, id: n.id, name: n.name, async: n.async, generator: n.generator, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), params: n.params.map((x1) => cloneParam(x1)), returnType: n.returnType !== undefined ? cloneTypeNode(n.returnType!) : undefined, body: cloneStmts(n.body) };
    case "arrow":
      return { kind: "arrow" as const, start: n.start, end: n.end, id: n.id, move: n.move, async: n.async, typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), params: n.params.map((x1) => cloneParam(x1)), returnType: n.returnType !== undefined ? cloneTypeNode(n.returnType!) : undefined, throws: n.throws !== undefined ? cloneTypeNode(n.throws!) : undefined, body: cloneOneOf0(n.body) };
    case "member":
      return { kind: "member" as const, start: n.start, end: n.end, id: n.id, object: cloneExpr(n.object), name: n.name, optional: n.optional };
    case "index":
      return { kind: "index" as const, start: n.start, end: n.end, id: n.id, object: cloneExpr(n.object), index: cloneExpr(n.index), optional: n.optional };
    case "call":
      return { kind: "call" as const, start: n.start, end: n.end, id: n.id, callee: cloneExpr(n.callee), typeArgs: n.typeArgs.map((x1) => cloneTypeNode(x1)), args: n.args.map((x1) => cloneExpr(x1)), optional: n.optional, implementation: n.implementation, shown: n.shown };
    case "new":
      return { kind: "new" as const, start: n.start, end: n.end, id: n.id, callee: cloneExpr(n.callee), typeArgs: n.typeArgs.map((x1) => cloneTypeNode(x1)), args: n.args !== undefined ? n.args!.map((x1) => cloneExpr(x1)) : undefined };
    case "instantiation":
      return { kind: "instantiation" as const, start: n.start, end: n.end, id: n.id, expr: cloneExpr(n.expr), typeArgs: n.typeArgs.map((x1) => cloneTypeNode(x1)) };
    case "meta":
      return { kind: "meta" as const, start: n.start, end: n.end, id: n.id, name: n.name };
    case "import":
      return { kind: "import" as const, start: n.start, end: n.end, id: n.id, args: n.args.map((x1) => cloneExpr(x1)) };
    case "nonNull":
      return { kind: "nonNull" as const, start: n.start, end: n.end, id: n.id, expr: cloneExpr(n.expr), narrows: n.narrows !== undefined ? cloneTypeNode(n.narrows!) : undefined, reason: n.reason, redundant: n.redundant };
    case "throw":
      return { kind: "throw" as const, start: n.start, end: n.end, id: n.id, value: cloneExpr(n.value) };
    case "class":
      return { kind: "class" as const, start: n.start, end: n.end, id: n.id, name: n.name, abstract: n.abstract, decorators: n.decorators.map((x1) => cloneExpr(x1)), typeParams: n.typeParams.map((x1) => cloneTypeParam(x1)), extends: n.extends !== undefined ? cloneExpr(n.extends!) : undefined, implements: n.implements.map((x1) => cloneTypeNode(x1)), members: n.members.map((x1) => cloneClassMember(x1)), derives: n.derives !== undefined ? [...n.derives!] : undefined };
    case "privateName":
      return { kind: "privateName" as const, start: n.start, end: n.end, id: n.id, name: n.name };
    case "unary":
      return { kind: "unary" as const, start: n.start, end: n.end, id: n.id, op: n.op, operand: cloneExpr(n.operand) };
    case "update":
      return { kind: "update" as const, start: n.start, end: n.end, id: n.id, op: n.op, prefix: n.prefix, operand: cloneExpr(n.operand) };
    case "binary":
      return { kind: "binary" as const, start: n.start, end: n.end, id: n.id, op: n.op, left: cloneExpr(n.left), right: cloneExpr(n.right) };
    case "conditional":
      return { kind: "conditional" as const, start: n.start, end: n.end, id: n.id, cond: cloneExpr(n.cond), then: cloneExpr(n.then), else: cloneExpr(n.else) };
    case "assign":
      return { kind: "assign" as const, start: n.start, end: n.end, id: n.id, op: n.op, target: cloneExpr(n.target), value: cloneExpr(n.value) };
    case "pipe":
      return { kind: "pipe" as const, start: n.start, end: n.end, id: n.id, value: cloneExpr(n.value), body: cloneExpr(n.body) };
    case "topic":
      return { kind: "topic" as const, start: n.start, end: n.end, id: n.id };
    case "match":
      return { kind: "match" as const, start: n.start, end: n.end, id: n.id, subject: cloneExpr(n.subject), arms: n.arms.map((x1) => cloneMatchArm(x1)) };
    case "comptime":
      return { kind: "comptime" as const, start: n.start, end: n.end, id: n.id, expr: cloneExpr(n.expr) };
    case "unsafe":
      return { kind: "unsafe" as const, start: n.start, end: n.end, id: n.id, expr: cloneExpr(n.expr) };
    case "destructure":
      return { kind: "destructure" as const, start: n.start, end: n.end, id: n.id, pattern: clonePattern(n.pattern), value: cloneExpr(n.value) };
    case "sequence":
      return { kind: "sequence" as const, start: n.start, end: n.end, id: n.id, exprs: n.exprs.map((x1) => cloneExpr(x1)) };
    case "yield":
      return { kind: "yield" as const, start: n.start, end: n.end, id: n.id, value: n.value !== undefined ? cloneExpr(n.value!) : undefined, delegate: n.delegate };
    case "as":
      return { kind: "as" as const, start: n.start, end: n.end, id: n.id, expr: cloneExpr(n.expr), type: cloneTypeNode(n.type) };
    case "satisfies":
      return { kind: "satisfies" as const, start: n.start, end: n.end, id: n.id, expr: cloneExpr(n.expr), type: cloneTypeNode(n.type) };
    case "assertion":
      return { kind: "assertion" as const, start: n.start, end: n.end, id: n.id, type: cloneTypeNode(n.type), expr: cloneExpr(n.expr) };
    case "block":
      return { kind: "block" as const, start: n.start, end: n.end, id: n.id, body: cloneStmts(n.body) };
    default:
      return cloneOneOf3(n);
  }
}
