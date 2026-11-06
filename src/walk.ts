// Generated from the parser's AST types by `bun scripts/walkgen.ts`; a test fails when it is stale.
// Visits each node a node holds, tagged, in the order its type lists the fields.
import assert from "node:assert";
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

// Hands each node `n` holds to `v`, in the order its type lists the fields, with a list of
// statements given whole.
export function forEachChild(n: AnyNode, v: (c: AnyNode) => void): void {
  switch (n.of) {
    case "typeNode":
      switch (n.node.kind) {
        case "ref":
          for (const x1 of n.node.args) {
            v({ of: "typeNode", node: x1 });
          }
          break;
        case "literal":
          v({ of: "expr", node: n.node.value });
          break;
        case "array":
          v({ of: "typeNode", node: n.node.element });
          break;
        case "tuple":
          for (const x1 of n.node.elements) {
            v({ of: "tupleElement", node: x1 });
          }
          break;
        case "object":
          for (const x1 of n.node.members) {
            v({ of: "typeMember", node: x1 });
          }
          break;
        case "function":
          for (const x1 of n.node.typeParams) {
            v({ of: "typeParam", node: x1 });
          }
          for (const x1 of n.node.params) {
            v({ of: "param", node: x1 });
          }
          v({ of: "typeNode", node: n.node.returns });
          if (n.node.throws !== undefined) {
            v({ of: "typeNode", node: n.node.throws! });
          }
          break;
        case "union":
          for (const x1 of n.node.types) {
            v({ of: "typeNode", node: x1 });
          }
          break;
        case "intersection":
          for (const x1 of n.node.types) {
            v({ of: "typeNode", node: x1 });
          }
          break;
        case "operator":
          v({ of: "typeNode", node: n.node.type });
          break;
        case "indexed":
          v({ of: "typeNode", node: n.node.object });
          v({ of: "typeNode", node: n.node.index });
          break;
        case "query":
          v({ of: "typeNode", node: n.node.target });
          break;
        case "import":
          for (const x1 of n.node.args) {
            v({ of: "typeNode", node: x1 });
          }
          break;
        case "conditional":
          v({ of: "typeNode", node: n.node.check });
          v({ of: "typeNode", node: n.node.extends });
          v({ of: "typeNode", node: n.node.then });
          v({ of: "typeNode", node: n.node.else });
          break;
        case "infer":
          if (n.node.constraint !== undefined) {
            v({ of: "typeNode", node: n.node.constraint! });
          }
          break;
        case "template":
          for (const x1 of n.node.types) {
            v({ of: "typeNode", node: x1 });
          }
          break;
        case "mapped":
          v({ of: "typeNode", node: n.node.constraint });
          if (n.node.as !== undefined) {
            v({ of: "typeNode", node: n.node.as! });
          }
          if (n.node.type !== undefined) {
            v({ of: "typeNode", node: n.node.type! });
          }
          break;
        case "predicate":
          if (n.node.type !== undefined) {
            v({ of: "typeNode", node: n.node.type! });
          }
          break;
      }
      break;
    case "expr":
      switch (n.node.kind) {
        case "template":
          for (const x1 of n.node.exprs) {
            v({ of: "expr", node: x1 });
          }
          break;
        case "tagged":
          v({ of: "expr", node: n.node.tag });
          for (const x1 of n.node.typeArgs) {
            v({ of: "typeNode", node: x1 });
          }
          v({ of: "expr", node: n.node.template });
          break;
        case "spread":
          v({ of: "expr", node: n.node.value });
          break;
        case "array":
          for (const x1 of n.node.elements) {
            if (x1 !== undefined) {
              v({ of: "expr", node: x1! });
            }
          }
          break;
        case "object":
          for (const x1 of n.node.props) {
            v({ of: "objectProp", node: x1 });
          }
          break;
        case "function":
          for (const x1 of n.node.typeParams) {
            v({ of: "typeParam", node: x1 });
          }
          for (const x1 of n.node.params) {
            v({ of: "param", node: x1 });
          }
          if (n.node.returnType !== undefined) {
            v({ of: "typeNode", node: n.node.returnType! });
          }
          v({ of: "stmts", node: n.node.body });
          break;
        case "arrow":
          for (const x1 of n.node.typeParams) {
            v({ of: "typeParam", node: x1 });
          }
          for (const x1 of n.node.params) {
            v({ of: "param", node: x1 });
          }
          if (n.node.returnType !== undefined) {
            v({ of: "typeNode", node: n.node.returnType! });
          }
          if (n.node.throws !== undefined) {
            v({ of: "typeNode", node: n.node.throws! });
          }
          if (Array.isArray(n.node.body)) {
            v({ of: "stmts", node: n.node.body });
          } else {
            v({ of: "expr", node: n.node.body });
          }
          break;
        case "member":
          v({ of: "expr", node: n.node.object });
          break;
        case "index":
          v({ of: "expr", node: n.node.object });
          v({ of: "expr", node: n.node.index });
          break;
        case "call":
          v({ of: "expr", node: n.node.callee });
          for (const x1 of n.node.typeArgs) {
            v({ of: "typeNode", node: x1 });
          }
          for (const x1 of n.node.args) {
            v({ of: "expr", node: x1 });
          }
          break;
        case "new":
          v({ of: "expr", node: n.node.callee });
          for (const x1 of n.node.typeArgs) {
            v({ of: "typeNode", node: x1 });
          }
          if (n.node.args !== undefined) {
            for (const x1 of n.node.args!) {
              v({ of: "expr", node: x1 });
            }
          }
          break;
        case "instantiation":
          v({ of: "expr", node: n.node.expr });
          for (const x1 of n.node.typeArgs) {
            v({ of: "typeNode", node: x1 });
          }
          break;
        case "import":
          for (const x1 of n.node.args) {
            v({ of: "expr", node: x1 });
          }
          break;
        case "nonNull":
          v({ of: "expr", node: n.node.expr });
          if (n.node.narrows !== undefined) {
            v({ of: "typeNode", node: n.node.narrows! });
          }
          break;
        case "throw":
          v({ of: "expr", node: n.node.value });
          break;
        case "class":
          for (const x1 of n.node.decorators) {
            v({ of: "expr", node: x1 });
          }
          for (const x1 of n.node.typeParams) {
            v({ of: "typeParam", node: x1 });
          }
          if (n.node.extends !== undefined) {
            v({ of: "expr", node: n.node.extends! });
          }
          for (const x1 of n.node.implements) {
            v({ of: "typeNode", node: x1 });
          }
          for (const x1 of n.node.members) {
            v({ of: "classMember", node: x1 });
          }
          break;
        case "unary":
          v({ of: "expr", node: n.node.operand });
          break;
        case "update":
          v({ of: "expr", node: n.node.operand });
          break;
        case "binary":
          v({ of: "expr", node: n.node.left });
          v({ of: "expr", node: n.node.right });
          break;
        case "conditional":
          v({ of: "expr", node: n.node.cond });
          v({ of: "expr", node: n.node.then });
          v({ of: "expr", node: n.node.else });
          break;
        case "assign":
          v({ of: "expr", node: n.node.target });
          v({ of: "expr", node: n.node.value });
          break;
        case "pipe":
          v({ of: "expr", node: n.node.value });
          v({ of: "expr", node: n.node.body });
          break;
        case "match":
          v({ of: "expr", node: n.node.subject });
          for (const x1 of n.node.arms) {
            v({ of: "matchArm", node: x1 });
          }
          break;
        case "comptime":
          v({ of: "expr", node: n.node.expr });
          break;
        case "unsafe":
          v({ of: "expr", node: n.node.expr });
          break;
        case "destructure":
          v({ of: "pattern", node: n.node.pattern });
          v({ of: "expr", node: n.node.value });
          break;
        case "sequence":
          for (const x1 of n.node.exprs) {
            v({ of: "expr", node: x1 });
          }
          break;
        case "yield":
          if (n.node.value !== undefined) {
            v({ of: "expr", node: n.node.value! });
          }
          break;
        case "as":
          v({ of: "expr", node: n.node.expr });
          v({ of: "typeNode", node: n.node.type });
          break;
        case "satisfies":
          v({ of: "expr", node: n.node.expr });
          v({ of: "typeNode", node: n.node.type });
          break;
        case "assertion":
          v({ of: "typeNode", node: n.node.type });
          v({ of: "expr", node: n.node.expr });
          break;
      }
      break;
    case "stmt":
      switch (n.node.kind) {
        case "expr":
          v({ of: "expr", node: n.node.expr });
          break;
        case "let":
          for (const x1 of n.node.declarations) {
            v({ of: "declarator", node: x1 });
          }
          break;
        case "return":
          if (n.node.value !== undefined) {
            v({ of: "expr", node: n.node.value! });
          }
          break;
        case "if":
          v({ of: "expr", node: n.node.cond });
          v({ of: "stmts", node: n.node.then });
          if (n.node.else !== undefined) {
            v({ of: "stmts", node: n.node.else! });
          }
          break;
        case "while":
          v({ of: "expr", node: n.node.cond });
          v({ of: "stmts", node: n.node.body });
          break;
        case "doWhile":
          v({ of: "stmts", node: n.node.body });
          v({ of: "expr", node: n.node.cond });
          break;
        case "switch":
          v({ of: "expr", node: n.node.discriminant });
          for (const x1 of n.node.cases) {
            v({ of: "switchCase", node: x1 });
          }
          break;
        case "labeled":
          v({ of: "stmt", node: n.node.body });
          break;
        case "throw":
          v({ of: "expr", node: n.node.value });
          break;
        case "try":
          v({ of: "stmts", node: n.node.block });
          if (n.node.param !== undefined) {
            v({ of: "pattern", node: n.node.param! });
          }
          if (n.node.paramType !== undefined) {
            v({ of: "typeNode", node: n.node.paramType! });
          }
          if (n.node.handler !== undefined) {
            v({ of: "stmts", node: n.node.handler! });
          }
          if (n.node.finalizer !== undefined) {
            v({ of: "stmts", node: n.node.finalizer! });
          }
          break;
        case "for":
          if (n.node.init !== undefined) {
            v({ of: "stmt", node: n.node.init! });
          }
          if (n.node.test !== undefined) {
            v({ of: "expr", node: n.node.test! });
          }
          if (n.node.update !== undefined) {
            v({ of: "expr", node: n.node.update! });
          }
          v({ of: "stmts", node: n.node.body });
          break;
        case "forIn":
          switch (n.node.left.kind) {
            case "expr":
              v({ of: "stmt", node: n.node.left });
              break;
            case "let":
              v({ of: "stmt", node: n.node.left });
              break;
            case "return":
              v({ of: "stmt", node: n.node.left });
              break;
            case "if":
              v({ of: "stmt", node: n.node.left });
              break;
            case "while":
              v({ of: "stmt", node: n.node.left });
              break;
            case "doWhile":
              v({ of: "stmt", node: n.node.left });
              break;
            case "switch":
              v({ of: "stmt", node: n.node.left });
              break;
            case "labeled":
              v({ of: "stmt", node: n.node.left });
              break;
            case "break":
              v({ of: "stmt", node: n.node.left });
              break;
            case "continue":
              v({ of: "stmt", node: n.node.left });
              break;
            case "throw":
              v({ of: "stmt", node: n.node.left });
              break;
            case "try":
              v({ of: "stmt", node: n.node.left });
              break;
            case "for":
              v({ of: "stmt", node: n.node.left });
              break;
            case "forIn":
              v({ of: "stmt", node: n.node.left });
              break;
            case "forOf":
              v({ of: "stmt", node: n.node.left });
              break;
            case "block":
              v({ of: "stmt", node: n.node.left });
              break;
            case "empty":
              v({ of: "stmt", node: n.node.left });
              break;
            case "debugger":
              v({ of: "stmt", node: n.node.left });
              break;
            case "enum":
              v({ of: "stmt", node: n.node.left });
              break;
            case "namespace":
              v({ of: "stmt", node: n.node.left });
              break;
            case "declare":
              v({ of: "stmt", node: n.node.left });
              break;
            case "comptime":
              v({ of: "stmt", node: n.node.left });
              break;
            case "unsafe":
              v({ of: "stmt", node: n.node.left });
              break;
            case "import":
              v({ of: "stmt", node: n.node.left });
              break;
            case "importEquals":
              v({ of: "stmt", node: n.node.left });
              break;
            case "export":
              v({ of: "stmt", node: n.node.left });
              break;
            case "exportDefault":
              v({ of: "stmt", node: n.node.left });
              break;
            case "exportNamed":
              v({ of: "stmt", node: n.node.left });
              break;
            case "exportAll":
              v({ of: "stmt", node: n.node.left });
              break;
            case "exportAssign":
              v({ of: "stmt", node: n.node.left });
              break;
            case "exportAsNamespace":
              v({ of: "stmt", node: n.node.left });
              break;
            case "typeAlias":
              v({ of: "stmt", node: n.node.left });
              break;
            case "interface":
              v({ of: "stmt", node: n.node.left });
              break;
            case "function":
              v({ of: "stmt", node: n.node.left });
              break;
            case "class":
              v({ of: "stmt", node: n.node.left });
              break;
            case "ident":
              v({ of: "pattern", node: n.node.left });
              break;
            case "object":
              v({ of: "pattern", node: n.node.left });
              break;
            case "array":
              v({ of: "pattern", node: n.node.left });
              break;
            case "default":
              v({ of: "pattern", node: n.node.left });
              break;
            case "wildcard":
              v({ of: "pattern", node: n.node.left });
              break;
            case "literal":
              v({ of: "pattern", node: n.node.left });
              break;
            case "variant":
              v({ of: "pattern", node: n.node.left });
              break;
            case "or":
              v({ of: "pattern", node: n.node.left });
              break;
          }
          v({ of: "expr", node: n.node.right });
          v({ of: "stmts", node: n.node.body });
          break;
        case "forOf":
          switch (n.node.left.kind) {
            case "expr":
              v({ of: "stmt", node: n.node.left });
              break;
            case "let":
              v({ of: "stmt", node: n.node.left });
              break;
            case "return":
              v({ of: "stmt", node: n.node.left });
              break;
            case "if":
              v({ of: "stmt", node: n.node.left });
              break;
            case "while":
              v({ of: "stmt", node: n.node.left });
              break;
            case "doWhile":
              v({ of: "stmt", node: n.node.left });
              break;
            case "switch":
              v({ of: "stmt", node: n.node.left });
              break;
            case "labeled":
              v({ of: "stmt", node: n.node.left });
              break;
            case "break":
              v({ of: "stmt", node: n.node.left });
              break;
            case "continue":
              v({ of: "stmt", node: n.node.left });
              break;
            case "throw":
              v({ of: "stmt", node: n.node.left });
              break;
            case "try":
              v({ of: "stmt", node: n.node.left });
              break;
            case "for":
              v({ of: "stmt", node: n.node.left });
              break;
            case "forIn":
              v({ of: "stmt", node: n.node.left });
              break;
            case "forOf":
              v({ of: "stmt", node: n.node.left });
              break;
            case "block":
              v({ of: "stmt", node: n.node.left });
              break;
            case "empty":
              v({ of: "stmt", node: n.node.left });
              break;
            case "debugger":
              v({ of: "stmt", node: n.node.left });
              break;
            case "enum":
              v({ of: "stmt", node: n.node.left });
              break;
            case "namespace":
              v({ of: "stmt", node: n.node.left });
              break;
            case "declare":
              v({ of: "stmt", node: n.node.left });
              break;
            case "comptime":
              v({ of: "stmt", node: n.node.left });
              break;
            case "unsafe":
              v({ of: "stmt", node: n.node.left });
              break;
            case "import":
              v({ of: "stmt", node: n.node.left });
              break;
            case "importEquals":
              v({ of: "stmt", node: n.node.left });
              break;
            case "export":
              v({ of: "stmt", node: n.node.left });
              break;
            case "exportDefault":
              v({ of: "stmt", node: n.node.left });
              break;
            case "exportNamed":
              v({ of: "stmt", node: n.node.left });
              break;
            case "exportAll":
              v({ of: "stmt", node: n.node.left });
              break;
            case "exportAssign":
              v({ of: "stmt", node: n.node.left });
              break;
            case "exportAsNamespace":
              v({ of: "stmt", node: n.node.left });
              break;
            case "typeAlias":
              v({ of: "stmt", node: n.node.left });
              break;
            case "interface":
              v({ of: "stmt", node: n.node.left });
              break;
            case "function":
              v({ of: "stmt", node: n.node.left });
              break;
            case "class":
              v({ of: "stmt", node: n.node.left });
              break;
            case "ident":
              v({ of: "pattern", node: n.node.left });
              break;
            case "object":
              v({ of: "pattern", node: n.node.left });
              break;
            case "array":
              v({ of: "pattern", node: n.node.left });
              break;
            case "default":
              v({ of: "pattern", node: n.node.left });
              break;
            case "wildcard":
              v({ of: "pattern", node: n.node.left });
              break;
            case "literal":
              v({ of: "pattern", node: n.node.left });
              break;
            case "variant":
              v({ of: "pattern", node: n.node.left });
              break;
            case "or":
              v({ of: "pattern", node: n.node.left });
              break;
          }
          v({ of: "expr", node: n.node.right });
          v({ of: "stmts", node: n.node.body });
          break;
        case "block":
          v({ of: "stmts", node: n.node.body });
          break;
        case "enum":
          for (const x1 of n.node.typeParams) {
            v({ of: "typeParam", node: x1 });
          }
          for (const x1 of n.node.members) {
            v({ of: "enumMember", node: x1 });
          }
          if (n.node.decorators !== undefined) {
            for (const x1 of n.node.decorators!) {
              v({ of: "expr", node: x1 });
            }
          }
          break;
        case "namespace":
          if (n.node.body !== undefined) {
            v({ of: "stmts", node: n.node.body! });
          }
          break;
        case "declare":
          v({ of: "stmt", node: n.node.body });
          break;
        case "comptime":
          v({ of: "stmts", node: n.node.body });
          break;
        case "unsafe":
          v({ of: "stmts", node: n.node.body });
          break;
        case "import":
          if (n.node.named !== undefined) {
            for (const x1 of n.node.named!) {
              v({ of: "specifier", node: x1 });
            }
          }
          if (n.node.attributes !== undefined) {
            v({ of: "expr", node: n.node.attributes! });
          }
          break;
        case "export":
          v({ of: "stmt", node: n.node.body });
          break;
        case "exportDefault":
          if (n.node.declaration !== undefined) {
            v({ of: "stmt", node: n.node.declaration! });
          }
          if (n.node.value !== undefined) {
            v({ of: "expr", node: n.node.value! });
          }
          break;
        case "exportNamed":
          for (const x1 of n.node.specifiers) {
            v({ of: "specifier", node: x1 });
          }
          break;
        case "exportAssign":
          v({ of: "expr", node: n.node.value });
          break;
        case "typeAlias":
          for (const x1 of n.node.typeParams) {
            v({ of: "typeParam", node: x1 });
          }
          v({ of: "typeNode", node: n.node.type });
          if (n.node.decorators !== undefined) {
            for (const x1 of n.node.decorators!) {
              v({ of: "expr", node: x1 });
            }
          }
          if (n.node.js !== undefined) {
            v({ of: "jsName", node: n.node.js! });
          }
          break;
        case "interface":
          for (const x1 of n.node.typeParams) {
            v({ of: "typeParam", node: x1 });
          }
          for (const x1 of n.node.extends) {
            v({ of: "typeNode", node: x1 });
          }
          for (const x1 of n.node.members) {
            v({ of: "typeMember", node: x1 });
          }
          if (n.node.decorators !== undefined) {
            for (const x1 of n.node.decorators!) {
              v({ of: "expr", node: x1 });
            }
          }
          if (n.node.js !== undefined) {
            v({ of: "jsName", node: n.node.js! });
          }
          if (n.node.jsClass !== undefined) {
            for (const x1 of n.node.jsClass!.constructors) {
              for (const x2 of x1) {
                v({ of: "param", node: x2 });
              }
            }
            for (const x1 of n.node.jsClass!.statics) {
              v({ of: "typeMember", node: x1 });
            }
          }
          if (n.node.jsSource !== undefined) {
            v({ of: "stmt", node: n.node.jsSource! });
          }
          break;
        case "function":
          for (const x1 of n.node.typeParams) {
            v({ of: "typeParam", node: x1 });
          }
          for (const x1 of n.node.params) {
            v({ of: "param", node: x1 });
          }
          if (n.node.returnType !== undefined) {
            v({ of: "typeNode", node: n.node.returnType! });
          }
          if (n.node.throws !== undefined) {
            v({ of: "typeNode", node: n.node.throws! });
          }
          if (n.node.body !== undefined) {
            v({ of: "stmts", node: n.node.body! });
          }
          if (n.node.decorators !== undefined) {
            for (const x1 of n.node.decorators!) {
              v({ of: "expr", node: x1 });
            }
          }
          if (n.node.js !== undefined) {
            v({ of: "jsName", node: n.node.js! });
          }
          break;
        case "class":
          for (const x1 of n.node.decorators) {
            v({ of: "expr", node: x1 });
          }
          for (const x1 of n.node.typeParams) {
            v({ of: "typeParam", node: x1 });
          }
          if (n.node.extends !== undefined) {
            v({ of: "expr", node: n.node.extends! });
          }
          for (const x1 of n.node.implements) {
            v({ of: "typeNode", node: x1 });
          }
          for (const x1 of n.node.members) {
            v({ of: "classMember", node: x1 });
          }
          break;
      }
      break;
    case "tupleElement":
      v({ of: "typeNode", node: n.node.type });
      break;
    case "typeMember":
      switch (n.node.kind) {
        case "property":
          if (typeof n.node.name !== "string") {
            v({ of: "expr", node: n.node.name });
          }
          if (n.node.type !== undefined) {
            v({ of: "typeNode", node: n.node.type! });
          }
          break;
        case "method":
          if (typeof n.node.name !== "string") {
            v({ of: "expr", node: n.node.name });
          }
          for (const x1 of n.node.typeParams) {
            v({ of: "typeParam", node: x1 });
          }
          for (const x1 of n.node.params) {
            v({ of: "param", node: x1 });
          }
          if (n.node.returns !== undefined) {
            v({ of: "typeNode", node: n.node.returns! });
          }
          if (n.node.throws !== undefined) {
            v({ of: "typeNode", node: n.node.throws! });
          }
          break;
        case "call":
          for (const x1 of n.node.typeParams) {
            v({ of: "typeParam", node: x1 });
          }
          for (const x1 of n.node.params) {
            v({ of: "param", node: x1 });
          }
          if (n.node.returns !== undefined) {
            v({ of: "typeNode", node: n.node.returns! });
          }
          break;
        case "construct":
          for (const x1 of n.node.typeParams) {
            v({ of: "typeParam", node: x1 });
          }
          for (const x1 of n.node.params) {
            v({ of: "param", node: x1 });
          }
          if (n.node.returns !== undefined) {
            v({ of: "typeNode", node: n.node.returns! });
          }
          break;
        case "index":
          for (const x1 of n.node.params) {
            v({ of: "param", node: x1 });
          }
          v({ of: "typeNode", node: n.node.type });
          break;
        case "get":
          if (typeof n.node.name !== "string") {
            v({ of: "expr", node: n.node.name });
          }
          for (const x1 of n.node.params) {
            v({ of: "param", node: x1 });
          }
          if (n.node.returns !== undefined) {
            v({ of: "typeNode", node: n.node.returns! });
          }
          break;
        case "set":
          if (typeof n.node.name !== "string") {
            v({ of: "expr", node: n.node.name });
          }
          for (const x1 of n.node.params) {
            v({ of: "param", node: x1 });
          }
          if (n.node.returns !== undefined) {
            v({ of: "typeNode", node: n.node.returns! });
          }
          break;
      }
      break;
    case "objectProp":
      switch (n.node.kind) {
        case "property":
          if (typeof n.node.key !== "string") {
            v({ of: "expr", node: n.node.key });
          }
          v({ of: "expr", node: n.node.value });
          break;
        case "shorthand":
          if (n.node.default !== undefined) {
            v({ of: "expr", node: n.node.default! });
          }
          break;
        case "spread":
          v({ of: "expr", node: n.node.value });
          break;
        case "method":
          if (typeof n.node.key !== "string") {
            v({ of: "expr", node: n.node.key });
          }
          for (const x1 of n.node.typeParams) {
            v({ of: "typeParam", node: x1 });
          }
          for (const x1 of n.node.params) {
            v({ of: "param", node: x1 });
          }
          if (n.node.returnType !== undefined) {
            v({ of: "typeNode", node: n.node.returnType! });
          }
          v({ of: "stmts", node: n.node.body });
          break;
        case "get":
          if (typeof n.node.key !== "string") {
            v({ of: "expr", node: n.node.key });
          }
          for (const x1 of n.node.params) {
            v({ of: "param", node: x1 });
          }
          if (n.node.returnType !== undefined) {
            v({ of: "typeNode", node: n.node.returnType! });
          }
          v({ of: "stmts", node: n.node.body });
          break;
        case "set":
          if (typeof n.node.key !== "string") {
            v({ of: "expr", node: n.node.key });
          }
          for (const x1 of n.node.params) {
            v({ of: "param", node: x1 });
          }
          if (n.node.returnType !== undefined) {
            v({ of: "typeNode", node: n.node.returnType! });
          }
          v({ of: "stmts", node: n.node.body });
          break;
      }
      break;
    case "classNode":
      for (const x1 of n.node.decorators) {
        v({ of: "expr", node: x1 });
      }
      for (const x1 of n.node.typeParams) {
        v({ of: "typeParam", node: x1 });
      }
      if (n.node.extends !== undefined) {
        v({ of: "expr", node: n.node.extends! });
      }
      for (const x1 of n.node.implements) {
        v({ of: "typeNode", node: x1 });
      }
      for (const x1 of n.node.members) {
        v({ of: "classMember", node: x1 });
      }
      break;
    case "classMember":
      switch (n.node.kind) {
        case "field":
          for (const x1 of n.node.decorators) {
            v({ of: "expr", node: x1 });
          }
          if (typeof n.node.name !== "string") {
            v({ of: "expr", node: n.node.name });
          }
          if (n.node.type !== undefined) {
            v({ of: "typeNode", node: n.node.type! });
          }
          if (n.node.init !== undefined) {
            v({ of: "expr", node: n.node.init! });
          }
          break;
        case "method":
          for (const x1 of n.node.decorators) {
            v({ of: "expr", node: x1 });
          }
          if (typeof n.node.name !== "string") {
            v({ of: "expr", node: n.node.name });
          }
          for (const x1 of n.node.typeParams) {
            v({ of: "typeParam", node: x1 });
          }
          for (const x1 of n.node.params) {
            v({ of: "param", node: x1 });
          }
          if (n.node.returnType !== undefined) {
            v({ of: "typeNode", node: n.node.returnType! });
          }
          if (n.node.throws !== undefined) {
            v({ of: "typeNode", node: n.node.throws! });
          }
          if (n.node.body !== undefined) {
            v({ of: "stmts", node: n.node.body! });
          }
          break;
        case "constructor":
          for (const x1 of n.node.decorators) {
            v({ of: "expr", node: x1 });
          }
          for (const x1 of n.node.params) {
            v({ of: "param", node: x1 });
          }
          if (n.node.throws !== undefined) {
            v({ of: "typeNode", node: n.node.throws! });
          }
          if (n.node.body !== undefined) {
            v({ of: "stmts", node: n.node.body! });
          }
          break;
        case "get":
          for (const x1 of n.node.decorators) {
            v({ of: "expr", node: x1 });
          }
          if (typeof n.node.name !== "string") {
            v({ of: "expr", node: n.node.name });
          }
          for (const x1 of n.node.params) {
            v({ of: "param", node: x1 });
          }
          if (n.node.returnType !== undefined) {
            v({ of: "typeNode", node: n.node.returnType! });
          }
          if (n.node.throws !== undefined) {
            v({ of: "typeNode", node: n.node.throws! });
          }
          if (n.node.body !== undefined) {
            v({ of: "stmts", node: n.node.body! });
          }
          break;
        case "set":
          for (const x1 of n.node.decorators) {
            v({ of: "expr", node: x1 });
          }
          if (typeof n.node.name !== "string") {
            v({ of: "expr", node: n.node.name });
          }
          for (const x1 of n.node.params) {
            v({ of: "param", node: x1 });
          }
          if (n.node.returnType !== undefined) {
            v({ of: "typeNode", node: n.node.returnType! });
          }
          if (n.node.throws !== undefined) {
            v({ of: "typeNode", node: n.node.throws! });
          }
          if (n.node.body !== undefined) {
            v({ of: "stmts", node: n.node.body! });
          }
          break;
        case "index":
          for (const x1 of n.node.decorators) {
            v({ of: "expr", node: x1 });
          }
          for (const x1 of n.node.params) {
            v({ of: "param", node: x1 });
          }
          v({ of: "typeNode", node: n.node.type });
          break;
        case "staticBlock":
          for (const x1 of n.node.decorators) {
            v({ of: "expr", node: x1 });
          }
          v({ of: "stmts", node: n.node.body });
          break;
      }
      break;
    case "param":
      v({ of: "pattern", node: n.node.pattern });
      if (n.node.type !== undefined) {
        v({ of: "typeNode", node: n.node.type! });
      }
      if (n.node.default !== undefined) {
        v({ of: "expr", node: n.node.default! });
      }
      for (const x1 of n.node.decorators) {
        v({ of: "expr", node: x1 });
      }
      break;
    case "pattern":
      switch (n.node.kind) {
        case "object":
          for (const x1 of n.node.props) {
            v({ of: "patternProp", node: x1 });
          }
          if (n.node.rest !== undefined) {
            v({ of: "pattern", node: n.node.rest! });
          }
          break;
        case "array":
          for (const x1 of n.node.elements) {
            if (x1 !== undefined) {
              v({ of: "pattern", node: x1! });
            }
          }
          if (n.node.rest !== undefined) {
            v({ of: "pattern", node: n.node.rest! });
          }
          break;
        case "default":
          v({ of: "pattern", node: n.node.target });
          v({ of: "expr", node: n.node.value });
          break;
        case "expr":
          v({ of: "expr", node: n.node.expr });
          break;
        case "literal":
          v({ of: "expr", node: n.node.value });
          break;
        case "variant":
          if (n.node.args !== undefined) {
            for (const x1 of n.node.args!) {
              v({ of: "pattern", node: x1 });
            }
          }
          break;
        case "or":
          for (const x1 of n.node.patterns) {
            v({ of: "pattern", node: x1 });
          }
          break;
      }
      break;
    case "matchArm":
      v({ of: "pattern", node: n.node.pattern });
      if (n.node.guard !== undefined) {
        v({ of: "expr", node: n.node.guard! });
      }
      switch (n.node.body.kind) {
        case "int":
          v({ of: "expr", node: n.node.body });
          break;
        case "float":
          v({ of: "expr", node: n.node.body });
          break;
        case "bigint":
          v({ of: "expr", node: n.node.body });
          break;
        case "null":
          v({ of: "expr", node: n.node.body });
          break;
        case "this":
          v({ of: "expr", node: n.node.body });
          break;
        case "super":
          v({ of: "expr", node: n.node.body });
          break;
        case "regex":
          v({ of: "expr", node: n.node.body });
          break;
        case "template":
          v({ of: "expr", node: n.node.body });
          break;
        case "tagged":
          v({ of: "expr", node: n.node.body });
          break;
        case "bool":
          v({ of: "expr", node: n.node.body });
          break;
        case "string":
          v({ of: "expr", node: n.node.body });
          break;
        case "ident":
          v({ of: "expr", node: n.node.body });
          break;
        case "spread":
          v({ of: "expr", node: n.node.body });
          break;
        case "array":
          v({ of: "expr", node: n.node.body });
          break;
        case "object":
          v({ of: "expr", node: n.node.body });
          break;
        case "function":
          v({ of: "expr", node: n.node.body });
          break;
        case "arrow":
          v({ of: "expr", node: n.node.body });
          break;
        case "member":
          v({ of: "expr", node: n.node.body });
          break;
        case "index":
          v({ of: "expr", node: n.node.body });
          break;
        case "call":
          v({ of: "expr", node: n.node.body });
          break;
        case "new":
          v({ of: "expr", node: n.node.body });
          break;
        case "instantiation":
          v({ of: "expr", node: n.node.body });
          break;
        case "meta":
          v({ of: "expr", node: n.node.body });
          break;
        case "import":
          v({ of: "expr", node: n.node.body });
          break;
        case "nonNull":
          v({ of: "expr", node: n.node.body });
          break;
        case "throw":
          v({ of: "expr", node: n.node.body });
          break;
        case "class":
          v({ of: "expr", node: n.node.body });
          break;
        case "privateName":
          v({ of: "expr", node: n.node.body });
          break;
        case "unary":
          v({ of: "expr", node: n.node.body });
          break;
        case "update":
          v({ of: "expr", node: n.node.body });
          break;
        case "binary":
          v({ of: "expr", node: n.node.body });
          break;
        case "conditional":
          v({ of: "expr", node: n.node.body });
          break;
        case "assign":
          v({ of: "expr", node: n.node.body });
          break;
        case "pipe":
          v({ of: "expr", node: n.node.body });
          break;
        case "topic":
          v({ of: "expr", node: n.node.body });
          break;
        case "match":
          v({ of: "expr", node: n.node.body });
          break;
        case "comptime":
          v({ of: "expr", node: n.node.body });
          break;
        case "unsafe":
          v({ of: "expr", node: n.node.body });
          break;
        case "destructure":
          v({ of: "expr", node: n.node.body });
          break;
        case "sequence":
          v({ of: "expr", node: n.node.body });
          break;
        case "yield":
          v({ of: "expr", node: n.node.body });
          break;
        case "as":
          v({ of: "expr", node: n.node.body });
          break;
        case "satisfies":
          v({ of: "expr", node: n.node.body });
          break;
        case "assertion":
          v({ of: "expr", node: n.node.body });
          break;
        case "block":
          v({ of: "stmt", node: n.node.body });
          break;
      }
      break;
    case "patternProp":
      if (typeof n.node.key !== "string") {
        v({ of: "expr", node: n.node.key });
      }
      v({ of: "pattern", node: n.node.value });
      break;
    case "specifier":
      break;
    case "enumMember":
      if (n.node.init !== undefined) {
        v({ of: "expr", node: n.node.init! });
      }
      if (n.node.payload !== undefined) {
        for (const x1 of n.node.payload!) {
          v({ of: "typeNode", node: x1 });
        }
      }
      break;
    case "switchCase":
      if (n.node.test !== undefined) {
        v({ of: "expr", node: n.node.test! });
      }
      v({ of: "stmts", node: n.node.body });
      break;
    case "declarator":
      v({ of: "pattern", node: n.node.target });
      if (n.node.type !== undefined) {
        v({ of: "typeNode", node: n.node.type! });
      }
      if (n.node.init !== undefined) {
        v({ of: "expr", node: n.node.init! });
      }
      break;
    case "typeParam":
      if (n.node.constraint !== undefined) {
        v({ of: "typeNode", node: n.node.constraint! });
      }
      if (n.node.default !== undefined) {
        v({ of: "typeNode", node: n.node.default! });
      }
      break;
    case "typeAlias":
      switch (n.node.kind) {
        case "typeAlias":
          for (const x1 of n.node.typeParams) {
            v({ of: "typeParam", node: x1 });
          }
          v({ of: "typeNode", node: n.node.type });
          if (n.node.decorators !== undefined) {
            for (const x1 of n.node.decorators!) {
              v({ of: "expr", node: x1 });
            }
          }
          if (n.node.js !== undefined) {
            v({ of: "jsName", node: n.node.js! });
          }
          break;
      }
      break;
    case "interface":
      switch (n.node.kind) {
        case "interface":
          for (const x1 of n.node.typeParams) {
            v({ of: "typeParam", node: x1 });
          }
          for (const x1 of n.node.extends) {
            v({ of: "typeNode", node: x1 });
          }
          for (const x1 of n.node.members) {
            v({ of: "typeMember", node: x1 });
          }
          if (n.node.decorators !== undefined) {
            for (const x1 of n.node.decorators!) {
              v({ of: "expr", node: x1 });
            }
          }
          if (n.node.js !== undefined) {
            v({ of: "jsName", node: n.node.js! });
          }
          if (n.node.jsClass !== undefined) {
            for (const x1 of n.node.jsClass!.constructors) {
              for (const x2 of x1) {
                v({ of: "param", node: x2 });
              }
            }
            for (const x1 of n.node.jsClass!.statics) {
              v({ of: "typeMember", node: x1 });
            }
          }
          if (n.node.jsSource !== undefined) {
            v({ of: "stmt", node: n.node.jsSource! });
          }
          break;
      }
      break;
    case "jsName":
      if (n.node.overloads !== undefined) {
        for (const x1 of n.node.overloads!) {
          v({ of: "func", node: x1 });
        }
      }
      break;
    case "func":
      switch (n.node.kind) {
        case "function":
          for (const x1 of n.node.typeParams) {
            v({ of: "typeParam", node: x1 });
          }
          for (const x1 of n.node.params) {
            v({ of: "param", node: x1 });
          }
          if (n.node.returnType !== undefined) {
            v({ of: "typeNode", node: n.node.returnType! });
          }
          if (n.node.throws !== undefined) {
            v({ of: "typeNode", node: n.node.throws! });
          }
          if (n.node.body !== undefined) {
            v({ of: "stmts", node: n.node.body! });
          }
          if (n.node.decorators !== undefined) {
            for (const x1 of n.node.decorators!) {
              v({ of: "expr", node: x1 });
            }
          }
          if (n.node.js !== undefined) {
            v({ of: "jsName", node: n.node.js! });
          }
          break;
      }
      break;
    case "stmts":
      for (const x of n.node) {
        v({ of: "stmt", node: x });
      }
      break;
  }
}

// Reborrows `n` so a walk can pass a copy of the tagged reference to a callback.
export function reborrowAnyNode(n: Ref<AnyNode>): AnyNode {
  if (n.of === "typeNode") return { of: "typeNode", node: n.node };
  if (n.of === "expr") return { of: "expr", node: n.node };
  if (n.of === "stmt") return { of: "stmt", node: n.node };
  if (n.of === "tupleElement") return { of: "tupleElement", node: n.node };
  if (n.of === "typeMember") return { of: "typeMember", node: n.node };
  if (n.of === "objectProp") return { of: "objectProp", node: n.node };
  if (n.of === "classNode") return { of: "classNode", node: n.node };
  if (n.of === "classMember") return { of: "classMember", node: n.node };
  if (n.of === "param") return { of: "param", node: n.node };
  if (n.of === "pattern") return { of: "pattern", node: n.node };
  if (n.of === "matchArm") return { of: "matchArm", node: n.node };
  if (n.of === "patternProp") return { of: "patternProp", node: n.node };
  if (n.of === "specifier") return { of: "specifier", node: n.node };
  if (n.of === "enumMember") return { of: "enumMember", node: n.node };
  if (n.of === "switchCase") return { of: "switchCase", node: n.node };
  if (n.of === "declarator") return { of: "declarator", node: n.node };
  if (n.of === "typeParam") return { of: "typeParam", node: n.node };
  if (n.of === "typeAlias") return { of: "typeAlias", node: n.node };
  if (n.of === "interface") return { of: "interface", node: n.node };
  if (n.of === "jsName") return { of: "jsName", node: n.node };
  if (n.of === "func") return { of: "func", node: n.node };
  return { of: "stmts", node: n.node };
}

// Walks down `steps` from `n`, calling `each` on every first child along the way until a leaf
// or a node `each` skips is reached, or gives -1 when `steps[d]` is past the last child at `d`.
export function visitAt(n: AnyNode, steps: Mut<usize[]>, d: usize, each: (n: AnyNode) => boolean): i32 {
  if (d === steps.length) {
    if (n.of !== "stmts" && !each(reborrowAnyNode(n))) return 0;
    steps.push(0);
  }
  const k = steps[d]!;
  let i: usize = 0;
  switch (n.of) {
    case "typeNode":
      switch (n.node.kind) {
        case "ref":
          if (k >= i && k < i + n.node.args.length) return visitAt({ of: "typeNode", node: n.node.args[k - i]! }, steps, d + 1, each);
          i += n.node.args.length;
          break;
        case "literal":
          if (i === k) return visitAt({ of: "expr", node: n.node.value }, steps, d + 1, each);
          i += 1;
          break;
        case "array":
          if (i === k) return visitAt({ of: "typeNode", node: n.node.element }, steps, d + 1, each);
          i += 1;
          break;
        case "tuple":
          if (k >= i && k < i + n.node.elements.length) return visitAt({ of: "tupleElement", node: n.node.elements[k - i]! }, steps, d + 1, each);
          i += n.node.elements.length;
          break;
        case "object":
          if (k >= i && k < i + n.node.members.length) return visitAt({ of: "typeMember", node: n.node.members[k - i]! }, steps, d + 1, each);
          i += n.node.members.length;
          break;
        case "function":
          if (k >= i && k < i + n.node.typeParams.length) return visitAt({ of: "typeParam", node: n.node.typeParams[k - i]! }, steps, d + 1, each);
          i += n.node.typeParams.length;
          if (k >= i && k < i + n.node.params.length) return visitAt({ of: "param", node: n.node.params[k - i]! }, steps, d + 1, each);
          i += n.node.params.length;
          if (i === k) return visitAt({ of: "typeNode", node: n.node.returns }, steps, d + 1, each);
          i += 1;
          if (n.node.throws !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.throws! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "union":
          if (k >= i && k < i + n.node.types.length) return visitAt({ of: "typeNode", node: n.node.types[k - i]! }, steps, d + 1, each);
          i += n.node.types.length;
          break;
        case "intersection":
          if (k >= i && k < i + n.node.types.length) return visitAt({ of: "typeNode", node: n.node.types[k - i]! }, steps, d + 1, each);
          i += n.node.types.length;
          break;
        case "operator":
          if (i === k) return visitAt({ of: "typeNode", node: n.node.type }, steps, d + 1, each);
          i += 1;
          break;
        case "indexed":
          if (i === k) return visitAt({ of: "typeNode", node: n.node.object }, steps, d + 1, each);
          i += 1;
          if (i === k) return visitAt({ of: "typeNode", node: n.node.index }, steps, d + 1, each);
          i += 1;
          break;
        case "query":
          if (i === k) return visitAt({ of: "typeNode", node: n.node.target }, steps, d + 1, each);
          i += 1;
          break;
        case "import":
          if (k >= i && k < i + n.node.args.length) return visitAt({ of: "typeNode", node: n.node.args[k - i]! }, steps, d + 1, each);
          i += n.node.args.length;
          break;
        case "conditional":
          if (i === k) return visitAt({ of: "typeNode", node: n.node.check }, steps, d + 1, each);
          i += 1;
          if (i === k) return visitAt({ of: "typeNode", node: n.node.extends }, steps, d + 1, each);
          i += 1;
          if (i === k) return visitAt({ of: "typeNode", node: n.node.then }, steps, d + 1, each);
          i += 1;
          if (i === k) return visitAt({ of: "typeNode", node: n.node.else }, steps, d + 1, each);
          i += 1;
          break;
        case "infer":
          if (n.node.constraint !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.constraint! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "template":
          if (k >= i && k < i + n.node.types.length) return visitAt({ of: "typeNode", node: n.node.types[k - i]! }, steps, d + 1, each);
          i += n.node.types.length;
          break;
        case "mapped":
          if (i === k) return visitAt({ of: "typeNode", node: n.node.constraint }, steps, d + 1, each);
          i += 1;
          if (n.node.as !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.as! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.type !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.type! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "predicate":
          if (n.node.type !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.type! }, steps, d + 1, each);
            i += 1;
          }
          break;
      }
      break;
    case "expr":
      switch (n.node.kind) {
        case "template":
          if (k >= i && k < i + n.node.exprs.length) return visitAt({ of: "expr", node: n.node.exprs[k - i]! }, steps, d + 1, each);
          i += n.node.exprs.length;
          break;
        case "tagged":
          if (i === k) return visitAt({ of: "expr", node: n.node.tag }, steps, d + 1, each);
          i += 1;
          if (k >= i && k < i + n.node.typeArgs.length) return visitAt({ of: "typeNode", node: n.node.typeArgs[k - i]! }, steps, d + 1, each);
          i += n.node.typeArgs.length;
          if (i === k) return visitAt({ of: "expr", node: n.node.template }, steps, d + 1, each);
          i += 1;
          break;
        case "spread":
          if (i === k) return visitAt({ of: "expr", node: n.node.value }, steps, d + 1, each);
          i += 1;
          break;
        case "array":
          for (const x1 of n.node.elements) {
            if (x1 !== undefined) {
              if (i === k) return visitAt({ of: "expr", node: x1! }, steps, d + 1, each);
              i += 1;
            }
          }
          break;
        case "object":
          if (k >= i && k < i + n.node.props.length) return visitAt({ of: "objectProp", node: n.node.props[k - i]! }, steps, d + 1, each);
          i += n.node.props.length;
          break;
        case "function":
          if (k >= i && k < i + n.node.typeParams.length) return visitAt({ of: "typeParam", node: n.node.typeParams[k - i]! }, steps, d + 1, each);
          i += n.node.typeParams.length;
          if (k >= i && k < i + n.node.params.length) return visitAt({ of: "param", node: n.node.params[k - i]! }, steps, d + 1, each);
          i += n.node.params.length;
          if (n.node.returnType !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.returnType! }, steps, d + 1, each);
            i += 1;
          }
          if (i === k) return visitAt({ of: "stmts", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "arrow":
          if (k >= i && k < i + n.node.typeParams.length) return visitAt({ of: "typeParam", node: n.node.typeParams[k - i]! }, steps, d + 1, each);
          i += n.node.typeParams.length;
          if (k >= i && k < i + n.node.params.length) return visitAt({ of: "param", node: n.node.params[k - i]! }, steps, d + 1, each);
          i += n.node.params.length;
          if (n.node.returnType !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.returnType! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.throws !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.throws! }, steps, d + 1, each);
            i += 1;
          }
          if (Array.isArray(n.node.body)) {
            if (i === k) return visitAt({ of: "stmts", node: n.node.body }, steps, d + 1, each);
            i += 1;
          } else {
            if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "member":
          if (i === k) return visitAt({ of: "expr", node: n.node.object }, steps, d + 1, each);
          i += 1;
          break;
        case "index":
          if (i === k) return visitAt({ of: "expr", node: n.node.object }, steps, d + 1, each);
          i += 1;
          if (i === k) return visitAt({ of: "expr", node: n.node.index }, steps, d + 1, each);
          i += 1;
          break;
        case "call":
          if (i === k) return visitAt({ of: "expr", node: n.node.callee }, steps, d + 1, each);
          i += 1;
          if (k >= i && k < i + n.node.typeArgs.length) return visitAt({ of: "typeNode", node: n.node.typeArgs[k - i]! }, steps, d + 1, each);
          i += n.node.typeArgs.length;
          if (k >= i && k < i + n.node.args.length) return visitAt({ of: "expr", node: n.node.args[k - i]! }, steps, d + 1, each);
          i += n.node.args.length;
          break;
        case "new":
          if (i === k) return visitAt({ of: "expr", node: n.node.callee }, steps, d + 1, each);
          i += 1;
          if (k >= i && k < i + n.node.typeArgs.length) return visitAt({ of: "typeNode", node: n.node.typeArgs[k - i]! }, steps, d + 1, each);
          i += n.node.typeArgs.length;
          if (n.node.args !== undefined) {
            if (k >= i && k < i + n.node.args!.length) return visitAt({ of: "expr", node: n.node.args![k - i]! }, steps, d + 1, each);
            i += n.node.args!.length;
          }
          break;
        case "instantiation":
          if (i === k) return visitAt({ of: "expr", node: n.node.expr }, steps, d + 1, each);
          i += 1;
          if (k >= i && k < i + n.node.typeArgs.length) return visitAt({ of: "typeNode", node: n.node.typeArgs[k - i]! }, steps, d + 1, each);
          i += n.node.typeArgs.length;
          break;
        case "import":
          if (k >= i && k < i + n.node.args.length) return visitAt({ of: "expr", node: n.node.args[k - i]! }, steps, d + 1, each);
          i += n.node.args.length;
          break;
        case "nonNull":
          if (i === k) return visitAt({ of: "expr", node: n.node.expr }, steps, d + 1, each);
          i += 1;
          if (n.node.narrows !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.narrows! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "throw":
          if (i === k) return visitAt({ of: "expr", node: n.node.value }, steps, d + 1, each);
          i += 1;
          break;
        case "class":
          if (k >= i && k < i + n.node.decorators.length) return visitAt({ of: "expr", node: n.node.decorators[k - i]! }, steps, d + 1, each);
          i += n.node.decorators.length;
          if (k >= i && k < i + n.node.typeParams.length) return visitAt({ of: "typeParam", node: n.node.typeParams[k - i]! }, steps, d + 1, each);
          i += n.node.typeParams.length;
          if (n.node.extends !== undefined) {
            if (i === k) return visitAt({ of: "expr", node: n.node.extends! }, steps, d + 1, each);
            i += 1;
          }
          if (k >= i && k < i + n.node.implements.length) return visitAt({ of: "typeNode", node: n.node.implements[k - i]! }, steps, d + 1, each);
          i += n.node.implements.length;
          if (k >= i && k < i + n.node.members.length) return visitAt({ of: "classMember", node: n.node.members[k - i]! }, steps, d + 1, each);
          i += n.node.members.length;
          break;
        case "unary":
          if (i === k) return visitAt({ of: "expr", node: n.node.operand }, steps, d + 1, each);
          i += 1;
          break;
        case "update":
          if (i === k) return visitAt({ of: "expr", node: n.node.operand }, steps, d + 1, each);
          i += 1;
          break;
        case "binary":
          if (i === k) return visitAt({ of: "expr", node: n.node.left }, steps, d + 1, each);
          i += 1;
          if (i === k) return visitAt({ of: "expr", node: n.node.right }, steps, d + 1, each);
          i += 1;
          break;
        case "conditional":
          if (i === k) return visitAt({ of: "expr", node: n.node.cond }, steps, d + 1, each);
          i += 1;
          if (i === k) return visitAt({ of: "expr", node: n.node.then }, steps, d + 1, each);
          i += 1;
          if (i === k) return visitAt({ of: "expr", node: n.node.else }, steps, d + 1, each);
          i += 1;
          break;
        case "assign":
          if (i === k) return visitAt({ of: "expr", node: n.node.target }, steps, d + 1, each);
          i += 1;
          if (i === k) return visitAt({ of: "expr", node: n.node.value }, steps, d + 1, each);
          i += 1;
          break;
        case "pipe":
          if (i === k) return visitAt({ of: "expr", node: n.node.value }, steps, d + 1, each);
          i += 1;
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "match":
          if (i === k) return visitAt({ of: "expr", node: n.node.subject }, steps, d + 1, each);
          i += 1;
          if (k >= i && k < i + n.node.arms.length) return visitAt({ of: "matchArm", node: n.node.arms[k - i]! }, steps, d + 1, each);
          i += n.node.arms.length;
          break;
        case "comptime":
          if (i === k) return visitAt({ of: "expr", node: n.node.expr }, steps, d + 1, each);
          i += 1;
          break;
        case "unsafe":
          if (i === k) return visitAt({ of: "expr", node: n.node.expr }, steps, d + 1, each);
          i += 1;
          break;
        case "destructure":
          if (i === k) return visitAt({ of: "pattern", node: n.node.pattern }, steps, d + 1, each);
          i += 1;
          if (i === k) return visitAt({ of: "expr", node: n.node.value }, steps, d + 1, each);
          i += 1;
          break;
        case "sequence":
          if (k >= i && k < i + n.node.exprs.length) return visitAt({ of: "expr", node: n.node.exprs[k - i]! }, steps, d + 1, each);
          i += n.node.exprs.length;
          break;
        case "yield":
          if (n.node.value !== undefined) {
            if (i === k) return visitAt({ of: "expr", node: n.node.value! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "as":
          if (i === k) return visitAt({ of: "expr", node: n.node.expr }, steps, d + 1, each);
          i += 1;
          if (i === k) return visitAt({ of: "typeNode", node: n.node.type }, steps, d + 1, each);
          i += 1;
          break;
        case "satisfies":
          if (i === k) return visitAt({ of: "expr", node: n.node.expr }, steps, d + 1, each);
          i += 1;
          if (i === k) return visitAt({ of: "typeNode", node: n.node.type }, steps, d + 1, each);
          i += 1;
          break;
        case "assertion":
          if (i === k) return visitAt({ of: "typeNode", node: n.node.type }, steps, d + 1, each);
          i += 1;
          if (i === k) return visitAt({ of: "expr", node: n.node.expr }, steps, d + 1, each);
          i += 1;
          break;
      }
      break;
    case "stmt":
      switch (n.node.kind) {
        case "expr":
          if (i === k) return visitAt({ of: "expr", node: n.node.expr }, steps, d + 1, each);
          i += 1;
          break;
        case "let":
          if (k >= i && k < i + n.node.declarations.length) return visitAt({ of: "declarator", node: n.node.declarations[k - i]! }, steps, d + 1, each);
          i += n.node.declarations.length;
          break;
        case "return":
          if (n.node.value !== undefined) {
            if (i === k) return visitAt({ of: "expr", node: n.node.value! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "if":
          if (i === k) return visitAt({ of: "expr", node: n.node.cond }, steps, d + 1, each);
          i += 1;
          if (i === k) return visitAt({ of: "stmts", node: n.node.then }, steps, d + 1, each);
          i += 1;
          if (n.node.else !== undefined) {
            if (i === k) return visitAt({ of: "stmts", node: n.node.else! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "while":
          if (i === k) return visitAt({ of: "expr", node: n.node.cond }, steps, d + 1, each);
          i += 1;
          if (i === k) return visitAt({ of: "stmts", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "doWhile":
          if (i === k) return visitAt({ of: "stmts", node: n.node.body }, steps, d + 1, each);
          i += 1;
          if (i === k) return visitAt({ of: "expr", node: n.node.cond }, steps, d + 1, each);
          i += 1;
          break;
        case "switch":
          if (i === k) return visitAt({ of: "expr", node: n.node.discriminant }, steps, d + 1, each);
          i += 1;
          if (k >= i && k < i + n.node.cases.length) return visitAt({ of: "switchCase", node: n.node.cases[k - i]! }, steps, d + 1, each);
          i += n.node.cases.length;
          break;
        case "labeled":
          if (i === k) return visitAt({ of: "stmt", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "throw":
          if (i === k) return visitAt({ of: "expr", node: n.node.value }, steps, d + 1, each);
          i += 1;
          break;
        case "try":
          if (i === k) return visitAt({ of: "stmts", node: n.node.block }, steps, d + 1, each);
          i += 1;
          if (n.node.param !== undefined) {
            if (i === k) return visitAt({ of: "pattern", node: n.node.param! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.paramType !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.paramType! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.handler !== undefined) {
            if (i === k) return visitAt({ of: "stmts", node: n.node.handler! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.finalizer !== undefined) {
            if (i === k) return visitAt({ of: "stmts", node: n.node.finalizer! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "for":
          if (n.node.init !== undefined) {
            if (i === k) return visitAt({ of: "stmt", node: n.node.init! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.test !== undefined) {
            if (i === k) return visitAt({ of: "expr", node: n.node.test! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.update !== undefined) {
            if (i === k) return visitAt({ of: "expr", node: n.node.update! }, steps, d + 1, each);
            i += 1;
          }
          if (i === k) return visitAt({ of: "stmts", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "forIn":
          switch (n.node.left.kind) {
            case "expr":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "let":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "return":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "if":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "while":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "doWhile":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "switch":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "labeled":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "break":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "continue":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "throw":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "try":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "for":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "forIn":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "forOf":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "block":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "empty":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "debugger":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "enum":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "namespace":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "declare":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "comptime":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "unsafe":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "import":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "importEquals":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "export":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "exportDefault":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "exportNamed":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "exportAll":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "exportAssign":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "exportAsNamespace":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "typeAlias":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "interface":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "function":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "class":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "ident":
              if (i === k) return visitAt({ of: "pattern", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "object":
              if (i === k) return visitAt({ of: "pattern", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "array":
              if (i === k) return visitAt({ of: "pattern", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "default":
              if (i === k) return visitAt({ of: "pattern", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "wildcard":
              if (i === k) return visitAt({ of: "pattern", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "literal":
              if (i === k) return visitAt({ of: "pattern", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "variant":
              if (i === k) return visitAt({ of: "pattern", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "or":
              if (i === k) return visitAt({ of: "pattern", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
          }
          if (i === k) return visitAt({ of: "expr", node: n.node.right }, steps, d + 1, each);
          i += 1;
          if (i === k) return visitAt({ of: "stmts", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "forOf":
          switch (n.node.left.kind) {
            case "expr":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "let":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "return":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "if":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "while":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "doWhile":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "switch":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "labeled":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "break":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "continue":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "throw":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "try":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "for":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "forIn":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "forOf":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "block":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "empty":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "debugger":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "enum":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "namespace":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "declare":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "comptime":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "unsafe":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "import":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "importEquals":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "export":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "exportDefault":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "exportNamed":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "exportAll":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "exportAssign":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "exportAsNamespace":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "typeAlias":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "interface":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "function":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "class":
              if (i === k) return visitAt({ of: "stmt", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "ident":
              if (i === k) return visitAt({ of: "pattern", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "object":
              if (i === k) return visitAt({ of: "pattern", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "array":
              if (i === k) return visitAt({ of: "pattern", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "default":
              if (i === k) return visitAt({ of: "pattern", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "wildcard":
              if (i === k) return visitAt({ of: "pattern", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "literal":
              if (i === k) return visitAt({ of: "pattern", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "variant":
              if (i === k) return visitAt({ of: "pattern", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
            case "or":
              if (i === k) return visitAt({ of: "pattern", node: n.node.left }, steps, d + 1, each);
              i += 1;
              break;
          }
          if (i === k) return visitAt({ of: "expr", node: n.node.right }, steps, d + 1, each);
          i += 1;
          if (i === k) return visitAt({ of: "stmts", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "block":
          if (i === k) return visitAt({ of: "stmts", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "enum":
          if (k >= i && k < i + n.node.typeParams.length) return visitAt({ of: "typeParam", node: n.node.typeParams[k - i]! }, steps, d + 1, each);
          i += n.node.typeParams.length;
          if (k >= i && k < i + n.node.members.length) return visitAt({ of: "enumMember", node: n.node.members[k - i]! }, steps, d + 1, each);
          i += n.node.members.length;
          if (n.node.decorators !== undefined) {
            if (k >= i && k < i + n.node.decorators!.length) return visitAt({ of: "expr", node: n.node.decorators![k - i]! }, steps, d + 1, each);
            i += n.node.decorators!.length;
          }
          break;
        case "namespace":
          if (n.node.body !== undefined) {
            if (i === k) return visitAt({ of: "stmts", node: n.node.body! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "declare":
          if (i === k) return visitAt({ of: "stmt", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "comptime":
          if (i === k) return visitAt({ of: "stmts", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "unsafe":
          if (i === k) return visitAt({ of: "stmts", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "import":
          if (n.node.named !== undefined) {
            if (k >= i && k < i + n.node.named!.length) return visitAt({ of: "specifier", node: n.node.named![k - i]! }, steps, d + 1, each);
            i += n.node.named!.length;
          }
          if (n.node.attributes !== undefined) {
            if (i === k) return visitAt({ of: "expr", node: n.node.attributes! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "export":
          if (i === k) return visitAt({ of: "stmt", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "exportDefault":
          if (n.node.declaration !== undefined) {
            if (i === k) return visitAt({ of: "stmt", node: n.node.declaration! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.value !== undefined) {
            if (i === k) return visitAt({ of: "expr", node: n.node.value! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "exportNamed":
          if (k >= i && k < i + n.node.specifiers.length) return visitAt({ of: "specifier", node: n.node.specifiers[k - i]! }, steps, d + 1, each);
          i += n.node.specifiers.length;
          break;
        case "exportAssign":
          if (i === k) return visitAt({ of: "expr", node: n.node.value }, steps, d + 1, each);
          i += 1;
          break;
        case "typeAlias":
          if (k >= i && k < i + n.node.typeParams.length) return visitAt({ of: "typeParam", node: n.node.typeParams[k - i]! }, steps, d + 1, each);
          i += n.node.typeParams.length;
          if (i === k) return visitAt({ of: "typeNode", node: n.node.type }, steps, d + 1, each);
          i += 1;
          if (n.node.decorators !== undefined) {
            if (k >= i && k < i + n.node.decorators!.length) return visitAt({ of: "expr", node: n.node.decorators![k - i]! }, steps, d + 1, each);
            i += n.node.decorators!.length;
          }
          if (n.node.js !== undefined) {
            if (i === k) return visitAt({ of: "jsName", node: n.node.js! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "interface":
          if (k >= i && k < i + n.node.typeParams.length) return visitAt({ of: "typeParam", node: n.node.typeParams[k - i]! }, steps, d + 1, each);
          i += n.node.typeParams.length;
          if (k >= i && k < i + n.node.extends.length) return visitAt({ of: "typeNode", node: n.node.extends[k - i]! }, steps, d + 1, each);
          i += n.node.extends.length;
          if (k >= i && k < i + n.node.members.length) return visitAt({ of: "typeMember", node: n.node.members[k - i]! }, steps, d + 1, each);
          i += n.node.members.length;
          if (n.node.decorators !== undefined) {
            if (k >= i && k < i + n.node.decorators!.length) return visitAt({ of: "expr", node: n.node.decorators![k - i]! }, steps, d + 1, each);
            i += n.node.decorators!.length;
          }
          if (n.node.js !== undefined) {
            if (i === k) return visitAt({ of: "jsName", node: n.node.js! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.jsClass !== undefined) {
            for (const x1 of n.node.jsClass!.constructors) {
              if (k >= i && k < i + x1.length) return visitAt({ of: "param", node: x1[k - i]! }, steps, d + 1, each);
              i += x1.length;
            }
            if (k >= i && k < i + n.node.jsClass!.statics.length) return visitAt({ of: "typeMember", node: n.node.jsClass!.statics[k - i]! }, steps, d + 1, each);
            i += n.node.jsClass!.statics.length;
          }
          if (n.node.jsSource !== undefined) {
            if (i === k) return visitAt({ of: "stmt", node: n.node.jsSource! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "function":
          if (k >= i && k < i + n.node.typeParams.length) return visitAt({ of: "typeParam", node: n.node.typeParams[k - i]! }, steps, d + 1, each);
          i += n.node.typeParams.length;
          if (k >= i && k < i + n.node.params.length) return visitAt({ of: "param", node: n.node.params[k - i]! }, steps, d + 1, each);
          i += n.node.params.length;
          if (n.node.returnType !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.returnType! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.throws !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.throws! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.body !== undefined) {
            if (i === k) return visitAt({ of: "stmts", node: n.node.body! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.decorators !== undefined) {
            if (k >= i && k < i + n.node.decorators!.length) return visitAt({ of: "expr", node: n.node.decorators![k - i]! }, steps, d + 1, each);
            i += n.node.decorators!.length;
          }
          if (n.node.js !== undefined) {
            if (i === k) return visitAt({ of: "jsName", node: n.node.js! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "class":
          if (k >= i && k < i + n.node.decorators.length) return visitAt({ of: "expr", node: n.node.decorators[k - i]! }, steps, d + 1, each);
          i += n.node.decorators.length;
          if (k >= i && k < i + n.node.typeParams.length) return visitAt({ of: "typeParam", node: n.node.typeParams[k - i]! }, steps, d + 1, each);
          i += n.node.typeParams.length;
          if (n.node.extends !== undefined) {
            if (i === k) return visitAt({ of: "expr", node: n.node.extends! }, steps, d + 1, each);
            i += 1;
          }
          if (k >= i && k < i + n.node.implements.length) return visitAt({ of: "typeNode", node: n.node.implements[k - i]! }, steps, d + 1, each);
          i += n.node.implements.length;
          if (k >= i && k < i + n.node.members.length) return visitAt({ of: "classMember", node: n.node.members[k - i]! }, steps, d + 1, each);
          i += n.node.members.length;
          break;
      }
      break;
    case "tupleElement":
      if (i === k) return visitAt({ of: "typeNode", node: n.node.type }, steps, d + 1, each);
      i += 1;
      break;
    case "typeMember":
      switch (n.node.kind) {
        case "property":
          if (typeof n.node.name !== "string") {
            if (i === k) return visitAt({ of: "expr", node: n.node.name }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.type !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.type! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "method":
          if (typeof n.node.name !== "string") {
            if (i === k) return visitAt({ of: "expr", node: n.node.name }, steps, d + 1, each);
            i += 1;
          }
          if (k >= i && k < i + n.node.typeParams.length) return visitAt({ of: "typeParam", node: n.node.typeParams[k - i]! }, steps, d + 1, each);
          i += n.node.typeParams.length;
          if (k >= i && k < i + n.node.params.length) return visitAt({ of: "param", node: n.node.params[k - i]! }, steps, d + 1, each);
          i += n.node.params.length;
          if (n.node.returns !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.returns! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.throws !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.throws! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "call":
          if (k >= i && k < i + n.node.typeParams.length) return visitAt({ of: "typeParam", node: n.node.typeParams[k - i]! }, steps, d + 1, each);
          i += n.node.typeParams.length;
          if (k >= i && k < i + n.node.params.length) return visitAt({ of: "param", node: n.node.params[k - i]! }, steps, d + 1, each);
          i += n.node.params.length;
          if (n.node.returns !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.returns! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "construct":
          if (k >= i && k < i + n.node.typeParams.length) return visitAt({ of: "typeParam", node: n.node.typeParams[k - i]! }, steps, d + 1, each);
          i += n.node.typeParams.length;
          if (k >= i && k < i + n.node.params.length) return visitAt({ of: "param", node: n.node.params[k - i]! }, steps, d + 1, each);
          i += n.node.params.length;
          if (n.node.returns !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.returns! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "index":
          if (k >= i && k < i + n.node.params.length) return visitAt({ of: "param", node: n.node.params[k - i]! }, steps, d + 1, each);
          i += n.node.params.length;
          if (i === k) return visitAt({ of: "typeNode", node: n.node.type }, steps, d + 1, each);
          i += 1;
          break;
        case "get":
          if (typeof n.node.name !== "string") {
            if (i === k) return visitAt({ of: "expr", node: n.node.name }, steps, d + 1, each);
            i += 1;
          }
          if (k >= i && k < i + n.node.params.length) return visitAt({ of: "param", node: n.node.params[k - i]! }, steps, d + 1, each);
          i += n.node.params.length;
          if (n.node.returns !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.returns! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "set":
          if (typeof n.node.name !== "string") {
            if (i === k) return visitAt({ of: "expr", node: n.node.name }, steps, d + 1, each);
            i += 1;
          }
          if (k >= i && k < i + n.node.params.length) return visitAt({ of: "param", node: n.node.params[k - i]! }, steps, d + 1, each);
          i += n.node.params.length;
          if (n.node.returns !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.returns! }, steps, d + 1, each);
            i += 1;
          }
          break;
      }
      break;
    case "objectProp":
      switch (n.node.kind) {
        case "property":
          if (typeof n.node.key !== "string") {
            if (i === k) return visitAt({ of: "expr", node: n.node.key }, steps, d + 1, each);
            i += 1;
          }
          if (i === k) return visitAt({ of: "expr", node: n.node.value }, steps, d + 1, each);
          i += 1;
          break;
        case "shorthand":
          if (n.node.default !== undefined) {
            if (i === k) return visitAt({ of: "expr", node: n.node.default! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "spread":
          if (i === k) return visitAt({ of: "expr", node: n.node.value }, steps, d + 1, each);
          i += 1;
          break;
        case "method":
          if (typeof n.node.key !== "string") {
            if (i === k) return visitAt({ of: "expr", node: n.node.key }, steps, d + 1, each);
            i += 1;
          }
          if (k >= i && k < i + n.node.typeParams.length) return visitAt({ of: "typeParam", node: n.node.typeParams[k - i]! }, steps, d + 1, each);
          i += n.node.typeParams.length;
          if (k >= i && k < i + n.node.params.length) return visitAt({ of: "param", node: n.node.params[k - i]! }, steps, d + 1, each);
          i += n.node.params.length;
          if (n.node.returnType !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.returnType! }, steps, d + 1, each);
            i += 1;
          }
          if (i === k) return visitAt({ of: "stmts", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "get":
          if (typeof n.node.key !== "string") {
            if (i === k) return visitAt({ of: "expr", node: n.node.key }, steps, d + 1, each);
            i += 1;
          }
          if (k >= i && k < i + n.node.params.length) return visitAt({ of: "param", node: n.node.params[k - i]! }, steps, d + 1, each);
          i += n.node.params.length;
          if (n.node.returnType !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.returnType! }, steps, d + 1, each);
            i += 1;
          }
          if (i === k) return visitAt({ of: "stmts", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "set":
          if (typeof n.node.key !== "string") {
            if (i === k) return visitAt({ of: "expr", node: n.node.key }, steps, d + 1, each);
            i += 1;
          }
          if (k >= i && k < i + n.node.params.length) return visitAt({ of: "param", node: n.node.params[k - i]! }, steps, d + 1, each);
          i += n.node.params.length;
          if (n.node.returnType !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.returnType! }, steps, d + 1, each);
            i += 1;
          }
          if (i === k) return visitAt({ of: "stmts", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
      }
      break;
    case "classNode":
      if (k >= i && k < i + n.node.decorators.length) return visitAt({ of: "expr", node: n.node.decorators[k - i]! }, steps, d + 1, each);
      i += n.node.decorators.length;
      if (k >= i && k < i + n.node.typeParams.length) return visitAt({ of: "typeParam", node: n.node.typeParams[k - i]! }, steps, d + 1, each);
      i += n.node.typeParams.length;
      if (n.node.extends !== undefined) {
        if (i === k) return visitAt({ of: "expr", node: n.node.extends! }, steps, d + 1, each);
        i += 1;
      }
      if (k >= i && k < i + n.node.implements.length) return visitAt({ of: "typeNode", node: n.node.implements[k - i]! }, steps, d + 1, each);
      i += n.node.implements.length;
      if (k >= i && k < i + n.node.members.length) return visitAt({ of: "classMember", node: n.node.members[k - i]! }, steps, d + 1, each);
      i += n.node.members.length;
      break;
    case "classMember":
      switch (n.node.kind) {
        case "field":
          if (k >= i && k < i + n.node.decorators.length) return visitAt({ of: "expr", node: n.node.decorators[k - i]! }, steps, d + 1, each);
          i += n.node.decorators.length;
          if (typeof n.node.name !== "string") {
            if (i === k) return visitAt({ of: "expr", node: n.node.name }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.type !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.type! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.init !== undefined) {
            if (i === k) return visitAt({ of: "expr", node: n.node.init! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "method":
          if (k >= i && k < i + n.node.decorators.length) return visitAt({ of: "expr", node: n.node.decorators[k - i]! }, steps, d + 1, each);
          i += n.node.decorators.length;
          if (typeof n.node.name !== "string") {
            if (i === k) return visitAt({ of: "expr", node: n.node.name }, steps, d + 1, each);
            i += 1;
          }
          if (k >= i && k < i + n.node.typeParams.length) return visitAt({ of: "typeParam", node: n.node.typeParams[k - i]! }, steps, d + 1, each);
          i += n.node.typeParams.length;
          if (k >= i && k < i + n.node.params.length) return visitAt({ of: "param", node: n.node.params[k - i]! }, steps, d + 1, each);
          i += n.node.params.length;
          if (n.node.returnType !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.returnType! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.throws !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.throws! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.body !== undefined) {
            if (i === k) return visitAt({ of: "stmts", node: n.node.body! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "constructor":
          if (k >= i && k < i + n.node.decorators.length) return visitAt({ of: "expr", node: n.node.decorators[k - i]! }, steps, d + 1, each);
          i += n.node.decorators.length;
          if (k >= i && k < i + n.node.params.length) return visitAt({ of: "param", node: n.node.params[k - i]! }, steps, d + 1, each);
          i += n.node.params.length;
          if (n.node.throws !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.throws! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.body !== undefined) {
            if (i === k) return visitAt({ of: "stmts", node: n.node.body! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "get":
          if (k >= i && k < i + n.node.decorators.length) return visitAt({ of: "expr", node: n.node.decorators[k - i]! }, steps, d + 1, each);
          i += n.node.decorators.length;
          if (typeof n.node.name !== "string") {
            if (i === k) return visitAt({ of: "expr", node: n.node.name }, steps, d + 1, each);
            i += 1;
          }
          if (k >= i && k < i + n.node.params.length) return visitAt({ of: "param", node: n.node.params[k - i]! }, steps, d + 1, each);
          i += n.node.params.length;
          if (n.node.returnType !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.returnType! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.throws !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.throws! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.body !== undefined) {
            if (i === k) return visitAt({ of: "stmts", node: n.node.body! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "set":
          if (k >= i && k < i + n.node.decorators.length) return visitAt({ of: "expr", node: n.node.decorators[k - i]! }, steps, d + 1, each);
          i += n.node.decorators.length;
          if (typeof n.node.name !== "string") {
            if (i === k) return visitAt({ of: "expr", node: n.node.name }, steps, d + 1, each);
            i += 1;
          }
          if (k >= i && k < i + n.node.params.length) return visitAt({ of: "param", node: n.node.params[k - i]! }, steps, d + 1, each);
          i += n.node.params.length;
          if (n.node.returnType !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.returnType! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.throws !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.throws! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.body !== undefined) {
            if (i === k) return visitAt({ of: "stmts", node: n.node.body! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "index":
          if (k >= i && k < i + n.node.decorators.length) return visitAt({ of: "expr", node: n.node.decorators[k - i]! }, steps, d + 1, each);
          i += n.node.decorators.length;
          if (k >= i && k < i + n.node.params.length) return visitAt({ of: "param", node: n.node.params[k - i]! }, steps, d + 1, each);
          i += n.node.params.length;
          if (i === k) return visitAt({ of: "typeNode", node: n.node.type }, steps, d + 1, each);
          i += 1;
          break;
        case "staticBlock":
          if (k >= i && k < i + n.node.decorators.length) return visitAt({ of: "expr", node: n.node.decorators[k - i]! }, steps, d + 1, each);
          i += n.node.decorators.length;
          if (i === k) return visitAt({ of: "stmts", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
      }
      break;
    case "param":
      if (i === k) return visitAt({ of: "pattern", node: n.node.pattern }, steps, d + 1, each);
      i += 1;
      if (n.node.type !== undefined) {
        if (i === k) return visitAt({ of: "typeNode", node: n.node.type! }, steps, d + 1, each);
        i += 1;
      }
      if (n.node.default !== undefined) {
        if (i === k) return visitAt({ of: "expr", node: n.node.default! }, steps, d + 1, each);
        i += 1;
      }
      if (k >= i && k < i + n.node.decorators.length) return visitAt({ of: "expr", node: n.node.decorators[k - i]! }, steps, d + 1, each);
      i += n.node.decorators.length;
      break;
    case "pattern":
      switch (n.node.kind) {
        case "object":
          if (k >= i && k < i + n.node.props.length) return visitAt({ of: "patternProp", node: n.node.props[k - i]! }, steps, d + 1, each);
          i += n.node.props.length;
          if (n.node.rest !== undefined) {
            if (i === k) return visitAt({ of: "pattern", node: n.node.rest! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "array":
          for (const x1 of n.node.elements) {
            if (x1 !== undefined) {
              if (i === k) return visitAt({ of: "pattern", node: x1! }, steps, d + 1, each);
              i += 1;
            }
          }
          if (n.node.rest !== undefined) {
            if (i === k) return visitAt({ of: "pattern", node: n.node.rest! }, steps, d + 1, each);
            i += 1;
          }
          break;
        case "default":
          if (i === k) return visitAt({ of: "pattern", node: n.node.target }, steps, d + 1, each);
          i += 1;
          if (i === k) return visitAt({ of: "expr", node: n.node.value }, steps, d + 1, each);
          i += 1;
          break;
        case "expr":
          if (i === k) return visitAt({ of: "expr", node: n.node.expr }, steps, d + 1, each);
          i += 1;
          break;
        case "literal":
          if (i === k) return visitAt({ of: "expr", node: n.node.value }, steps, d + 1, each);
          i += 1;
          break;
        case "variant":
          if (n.node.args !== undefined) {
            if (k >= i && k < i + n.node.args!.length) return visitAt({ of: "pattern", node: n.node.args![k - i]! }, steps, d + 1, each);
            i += n.node.args!.length;
          }
          break;
        case "or":
          if (k >= i && k < i + n.node.patterns.length) return visitAt({ of: "pattern", node: n.node.patterns[k - i]! }, steps, d + 1, each);
          i += n.node.patterns.length;
          break;
      }
      break;
    case "matchArm":
      if (i === k) return visitAt({ of: "pattern", node: n.node.pattern }, steps, d + 1, each);
      i += 1;
      if (n.node.guard !== undefined) {
        if (i === k) return visitAt({ of: "expr", node: n.node.guard! }, steps, d + 1, each);
        i += 1;
      }
      switch (n.node.body.kind) {
        case "int":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "float":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "bigint":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "null":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "this":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "super":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "regex":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "template":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "tagged":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "bool":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "string":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "ident":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "spread":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "array":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "object":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "function":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "arrow":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "member":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "index":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "call":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "new":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "instantiation":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "meta":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "import":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "nonNull":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "throw":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "class":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "privateName":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "unary":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "update":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "binary":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "conditional":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "assign":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "pipe":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "topic":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "match":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "comptime":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "unsafe":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "destructure":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "sequence":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "yield":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "as":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "satisfies":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "assertion":
          if (i === k) return visitAt({ of: "expr", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
        case "block":
          if (i === k) return visitAt({ of: "stmt", node: n.node.body }, steps, d + 1, each);
          i += 1;
          break;
      }
      break;
    case "patternProp":
      if (typeof n.node.key !== "string") {
        if (i === k) return visitAt({ of: "expr", node: n.node.key }, steps, d + 1, each);
        i += 1;
      }
      if (i === k) return visitAt({ of: "pattern", node: n.node.value }, steps, d + 1, each);
      i += 1;
      break;
    case "specifier":
      break;
    case "enumMember":
      if (n.node.init !== undefined) {
        if (i === k) return visitAt({ of: "expr", node: n.node.init! }, steps, d + 1, each);
        i += 1;
      }
      if (n.node.payload !== undefined) {
        if (k >= i && k < i + n.node.payload!.length) return visitAt({ of: "typeNode", node: n.node.payload![k - i]! }, steps, d + 1, each);
        i += n.node.payload!.length;
      }
      break;
    case "switchCase":
      if (n.node.test !== undefined) {
        if (i === k) return visitAt({ of: "expr", node: n.node.test! }, steps, d + 1, each);
        i += 1;
      }
      if (i === k) return visitAt({ of: "stmts", node: n.node.body }, steps, d + 1, each);
      i += 1;
      break;
    case "declarator":
      if (i === k) return visitAt({ of: "pattern", node: n.node.target }, steps, d + 1, each);
      i += 1;
      if (n.node.type !== undefined) {
        if (i === k) return visitAt({ of: "typeNode", node: n.node.type! }, steps, d + 1, each);
        i += 1;
      }
      if (n.node.init !== undefined) {
        if (i === k) return visitAt({ of: "expr", node: n.node.init! }, steps, d + 1, each);
        i += 1;
      }
      break;
    case "typeParam":
      if (n.node.constraint !== undefined) {
        if (i === k) return visitAt({ of: "typeNode", node: n.node.constraint! }, steps, d + 1, each);
        i += 1;
      }
      if (n.node.default !== undefined) {
        if (i === k) return visitAt({ of: "typeNode", node: n.node.default! }, steps, d + 1, each);
        i += 1;
      }
      break;
    case "typeAlias":
      switch (n.node.kind) {
        case "typeAlias":
          if (k >= i && k < i + n.node.typeParams.length) return visitAt({ of: "typeParam", node: n.node.typeParams[k - i]! }, steps, d + 1, each);
          i += n.node.typeParams.length;
          if (i === k) return visitAt({ of: "typeNode", node: n.node.type }, steps, d + 1, each);
          i += 1;
          if (n.node.decorators !== undefined) {
            if (k >= i && k < i + n.node.decorators!.length) return visitAt({ of: "expr", node: n.node.decorators![k - i]! }, steps, d + 1, each);
            i += n.node.decorators!.length;
          }
          if (n.node.js !== undefined) {
            if (i === k) return visitAt({ of: "jsName", node: n.node.js! }, steps, d + 1, each);
            i += 1;
          }
          break;
      }
      break;
    case "interface":
      switch (n.node.kind) {
        case "interface":
          if (k >= i && k < i + n.node.typeParams.length) return visitAt({ of: "typeParam", node: n.node.typeParams[k - i]! }, steps, d + 1, each);
          i += n.node.typeParams.length;
          if (k >= i && k < i + n.node.extends.length) return visitAt({ of: "typeNode", node: n.node.extends[k - i]! }, steps, d + 1, each);
          i += n.node.extends.length;
          if (k >= i && k < i + n.node.members.length) return visitAt({ of: "typeMember", node: n.node.members[k - i]! }, steps, d + 1, each);
          i += n.node.members.length;
          if (n.node.decorators !== undefined) {
            if (k >= i && k < i + n.node.decorators!.length) return visitAt({ of: "expr", node: n.node.decorators![k - i]! }, steps, d + 1, each);
            i += n.node.decorators!.length;
          }
          if (n.node.js !== undefined) {
            if (i === k) return visitAt({ of: "jsName", node: n.node.js! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.jsClass !== undefined) {
            for (const x1 of n.node.jsClass!.constructors) {
              if (k >= i && k < i + x1.length) return visitAt({ of: "param", node: x1[k - i]! }, steps, d + 1, each);
              i += x1.length;
            }
            if (k >= i && k < i + n.node.jsClass!.statics.length) return visitAt({ of: "typeMember", node: n.node.jsClass!.statics[k - i]! }, steps, d + 1, each);
            i += n.node.jsClass!.statics.length;
          }
          if (n.node.jsSource !== undefined) {
            if (i === k) return visitAt({ of: "stmt", node: n.node.jsSource! }, steps, d + 1, each);
            i += 1;
          }
          break;
      }
      break;
    case "jsName":
      if (n.node.overloads !== undefined) {
        if (k >= i && k < i + n.node.overloads!.length) return visitAt({ of: "func", node: n.node.overloads![k - i]! }, steps, d + 1, each);
        i += n.node.overloads!.length;
      }
      break;
    case "func":
      switch (n.node.kind) {
        case "function":
          if (k >= i && k < i + n.node.typeParams.length) return visitAt({ of: "typeParam", node: n.node.typeParams[k - i]! }, steps, d + 1, each);
          i += n.node.typeParams.length;
          if (k >= i && k < i + n.node.params.length) return visitAt({ of: "param", node: n.node.params[k - i]! }, steps, d + 1, each);
          i += n.node.params.length;
          if (n.node.returnType !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.returnType! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.throws !== undefined) {
            if (i === k) return visitAt({ of: "typeNode", node: n.node.throws! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.body !== undefined) {
            if (i === k) return visitAt({ of: "stmts", node: n.node.body! }, steps, d + 1, each);
            i += 1;
          }
          if (n.node.decorators !== undefined) {
            if (k >= i && k < i + n.node.decorators!.length) return visitAt({ of: "expr", node: n.node.decorators![k - i]! }, steps, d + 1, each);
            i += n.node.decorators!.length;
          }
          if (n.node.js !== undefined) {
            if (i === k) return visitAt({ of: "jsName", node: n.node.js! }, steps, d + 1, each);
            i += 1;
          }
          break;
      }
      break;
    case "stmts":
      if (k < n.node.length) return visitAt({ of: "stmt", node: n.node[k]! }, steps, d + 1, each);
      break;
  }
  if (d + 1 === steps.length && k === 0) {
    steps.pop();
    return 0;
  }
  return -1;
}

// The id of `n`, or -1 when `n` has no id.
export function nodeIdOf(n: Ref<AnyNode>): i64 {
  switch (n.of) {
    case "typeNode":
      switch (n.node.kind) {
        case "ref":
          return n.node.id as i64;
        case "literal":
          return n.node.id as i64;
        case "array":
          return n.node.id as i64;
        case "tuple":
          return n.node.id as i64;
        case "object":
          return n.node.id as i64;
        case "function":
          return n.node.id as i64;
        case "union":
          return n.node.id as i64;
        case "intersection":
          return n.node.id as i64;
        case "operator":
          return n.node.id as i64;
        case "indexed":
          return n.node.id as i64;
        case "query":
          return n.node.id as i64;
        case "import":
          return n.node.id as i64;
        case "conditional":
          return n.node.id as i64;
        case "infer":
          return n.node.id as i64;
        case "template":
          return n.node.id as i64;
        case "mapped":
          return n.node.id as i64;
        default:
          return n.node.id as i64;
      }
    case "expr":
      switch (n.node.kind) {
        case "int":
          return n.node.id as i64;
        case "float":
          return n.node.id as i64;
        case "bigint":
          return n.node.id as i64;
        case "null":
          return n.node.id as i64;
        case "this":
          return n.node.id as i64;
        case "super":
          return n.node.id as i64;
        case "regex":
          return n.node.id as i64;
        case "template":
          return n.node.id as i64;
        case "tagged":
          return n.node.id as i64;
        case "bool":
          return n.node.id as i64;
        case "string":
          return n.node.id as i64;
        case "ident":
          return n.node.id as i64;
        case "spread":
          return n.node.id as i64;
        case "array":
          return n.node.id as i64;
        case "object":
          return n.node.id as i64;
        case "function":
          return n.node.id as i64;
        case "arrow":
          return n.node.id as i64;
        case "member":
          return n.node.id as i64;
        case "index":
          return n.node.id as i64;
        case "call":
          return n.node.id as i64;
        case "new":
          return n.node.id as i64;
        case "instantiation":
          return n.node.id as i64;
        case "meta":
          return n.node.id as i64;
        case "import":
          return n.node.id as i64;
        case "nonNull":
          return n.node.id as i64;
        case "throw":
          return n.node.id as i64;
        case "class":
          return n.node.id as i64;
        case "privateName":
          return n.node.id as i64;
        case "unary":
          return n.node.id as i64;
        case "update":
          return n.node.id as i64;
        case "binary":
          return n.node.id as i64;
        case "conditional":
          return n.node.id as i64;
        case "assign":
          return n.node.id as i64;
        case "pipe":
          return n.node.id as i64;
        case "topic":
          return n.node.id as i64;
        case "match":
          return n.node.id as i64;
        case "comptime":
          return n.node.id as i64;
        case "unsafe":
          return n.node.id as i64;
        case "destructure":
          return n.node.id as i64;
        case "sequence":
          return n.node.id as i64;
        case "yield":
          return n.node.id as i64;
        case "as":
          return n.node.id as i64;
        case "satisfies":
          return n.node.id as i64;
        default:
          return n.node.id as i64;
      }
    case "stmt":
      switch (n.node.kind) {
        case "expr":
          return n.node.id as i64;
        case "let":
          return n.node.id as i64;
        case "return":
          return n.node.id as i64;
        case "if":
          return n.node.id as i64;
        case "while":
          return n.node.id as i64;
        case "doWhile":
          return n.node.id as i64;
        case "switch":
          return n.node.id as i64;
        case "labeled":
          return n.node.id as i64;
        case "break":
          return n.node.id as i64;
        case "continue":
          return n.node.id as i64;
        case "throw":
          return n.node.id as i64;
        case "try":
          return n.node.id as i64;
        case "for":
          return n.node.id as i64;
        case "forIn":
          return n.node.id as i64;
        case "forOf":
          return n.node.id as i64;
        case "block":
          return n.node.id as i64;
        case "empty":
          return n.node.id as i64;
        case "debugger":
          return n.node.id as i64;
        case "enum":
          return n.node.id as i64;
        case "namespace":
          return n.node.id as i64;
        case "declare":
          return n.node.id as i64;
        case "comptime":
          return n.node.id as i64;
        case "unsafe":
          return n.node.id as i64;
        case "import":
          return n.node.id as i64;
        case "importEquals":
          return n.node.id as i64;
        case "export":
          return n.node.id as i64;
        case "exportDefault":
          return n.node.id as i64;
        case "exportNamed":
          return n.node.id as i64;
        case "exportAll":
          return n.node.id as i64;
        case "exportAssign":
          return n.node.id as i64;
        case "exportAsNamespace":
          return n.node.id as i64;
        case "typeAlias":
          return n.node.id as i64;
        case "interface":
          return n.node.id as i64;
        case "function":
          return n.node.id as i64;
        default:
          return n.node.id as i64;
      }
    case "tupleElement":
      return n.node.id as i64;
    case "typeMember":
      switch (n.node.kind) {
        case "property":
          return n.node.id as i64;
        case "method":
          return n.node.id as i64;
        case "call":
          return n.node.id as i64;
        case "construct":
          return n.node.id as i64;
        case "index":
          return n.node.id as i64;
        case "get":
          return n.node.id as i64;
        default:
          return n.node.id as i64;
      }
    case "objectProp":
      switch (n.node.kind) {
        case "property":
          return n.node.id as i64;
        case "shorthand":
          return n.node.id as i64;
        case "spread":
          return n.node.id as i64;
        case "method":
          return n.node.id as i64;
        case "get":
          return n.node.id as i64;
        default:
          return n.node.id as i64;
      }
    case "classNode":
      return n.node.id as i64;
    case "classMember":
      switch (n.node.kind) {
        case "field":
          return n.node.id as i64;
        case "method":
          return n.node.id as i64;
        case "constructor":
          return n.node.id as i64;
        case "get":
          return n.node.id as i64;
        case "set":
          return n.node.id as i64;
        case "index":
          return n.node.id as i64;
        default:
          return n.node.id as i64;
      }
    case "param":
      return n.node.id as i64;
    case "pattern":
      switch (n.node.kind) {
        case "ident":
          return n.node.id as i64;
        case "object":
          return n.node.id as i64;
        case "array":
          return n.node.id as i64;
        case "default":
          return n.node.id as i64;
        case "expr":
          return n.node.id as i64;
        case "wildcard":
          return n.node.id as i64;
        case "literal":
          return n.node.id as i64;
        case "variant":
          return n.node.id as i64;
        default:
          return n.node.id as i64;
      }
    case "matchArm":
      return n.node.id as i64;
    case "patternProp":
      return n.node.id as i64;
    case "specifier":
      return n.node.id as i64;
    case "enumMember":
      return n.node.id as i64;
    case "switchCase":
      return n.node.id as i64;
    case "declarator":
      return n.node.id as i64;
    case "typeParam":
      return n.node.id as i64;
    case "typeAlias":
      return n.node.id as i64;
    case "interface":
      return n.node.id as i64;
    case "jsName":
      return -1;
    case "func":
      return n.node.id as i64;
    default:
      return -1;
  }
}

// A span fingerprint of `n` for detecting two distinct nodes sharing an id.
export function nodeSpanKey(n: Ref<AnyNode>): usize {
  switch (n.of) {
    case "typeNode":
      switch (n.node.kind) {
        case "ref":
          return n.node.start * 1048576 + n.node.end;
        case "literal":
          return n.node.start * 1048576 + n.node.end;
        case "array":
          return n.node.start * 1048576 + n.node.end;
        case "tuple":
          return n.node.start * 1048576 + n.node.end;
        case "object":
          return n.node.start * 1048576 + n.node.end;
        case "function":
          return n.node.start * 1048576 + n.node.end;
        case "union":
          return n.node.start * 1048576 + n.node.end;
        case "intersection":
          return n.node.start * 1048576 + n.node.end;
        case "operator":
          return n.node.start * 1048576 + n.node.end;
        case "indexed":
          return n.node.start * 1048576 + n.node.end;
        case "query":
          return n.node.start * 1048576 + n.node.end;
        case "import":
          return n.node.start * 1048576 + n.node.end;
        case "conditional":
          return n.node.start * 1048576 + n.node.end;
        case "infer":
          return n.node.start * 1048576 + n.node.end;
        case "template":
          return n.node.start * 1048576 + n.node.end;
        case "mapped":
          return n.node.start * 1048576 + n.node.end;
        default:
          return n.node.start * 1048576 + n.node.end;
      }
    case "expr":
      switch (n.node.kind) {
        case "int":
          return n.node.start * 1048576 + n.node.end;
        case "float":
          return n.node.start * 1048576 + n.node.end;
        case "bigint":
          return n.node.start * 1048576 + n.node.end;
        case "null":
          return n.node.start * 1048576 + n.node.end;
        case "this":
          return n.node.start * 1048576 + n.node.end;
        case "super":
          return n.node.start * 1048576 + n.node.end;
        case "regex":
          return n.node.start * 1048576 + n.node.end;
        case "template":
          return n.node.start * 1048576 + n.node.end;
        case "tagged":
          return n.node.start * 1048576 + n.node.end;
        case "bool":
          return n.node.start * 1048576 + n.node.end;
        case "string":
          return n.node.start * 1048576 + n.node.end;
        case "ident":
          return n.node.start * 1048576 + n.node.end;
        case "spread":
          return n.node.start * 1048576 + n.node.end;
        case "array":
          return n.node.start * 1048576 + n.node.end;
        case "object":
          return n.node.start * 1048576 + n.node.end;
        case "function":
          return n.node.start * 1048576 + n.node.end;
        case "arrow":
          return n.node.start * 1048576 + n.node.end;
        case "member":
          return n.node.start * 1048576 + n.node.end;
        case "index":
          return n.node.start * 1048576 + n.node.end;
        case "call":
          return n.node.start * 1048576 + n.node.end;
        case "new":
          return n.node.start * 1048576 + n.node.end;
        case "instantiation":
          return n.node.start * 1048576 + n.node.end;
        case "meta":
          return n.node.start * 1048576 + n.node.end;
        case "import":
          return n.node.start * 1048576 + n.node.end;
        case "nonNull":
          return n.node.start * 1048576 + n.node.end;
        case "throw":
          return n.node.start * 1048576 + n.node.end;
        case "class":
          return n.node.start * 1048576 + n.node.end;
        case "privateName":
          return n.node.start * 1048576 + n.node.end;
        case "unary":
          return n.node.start * 1048576 + n.node.end;
        case "update":
          return n.node.start * 1048576 + n.node.end;
        case "binary":
          return n.node.start * 1048576 + n.node.end;
        case "conditional":
          return n.node.start * 1048576 + n.node.end;
        case "assign":
          return n.node.start * 1048576 + n.node.end;
        case "pipe":
          return n.node.start * 1048576 + n.node.end;
        case "topic":
          return n.node.start * 1048576 + n.node.end;
        case "match":
          return n.node.start * 1048576 + n.node.end;
        case "comptime":
          return n.node.start * 1048576 + n.node.end;
        case "unsafe":
          return n.node.start * 1048576 + n.node.end;
        case "destructure":
          return n.node.start * 1048576 + n.node.end;
        case "sequence":
          return n.node.start * 1048576 + n.node.end;
        case "yield":
          return n.node.start * 1048576 + n.node.end;
        case "as":
          return n.node.start * 1048576 + n.node.end;
        case "satisfies":
          return n.node.start * 1048576 + n.node.end;
        default:
          return n.node.start * 1048576 + n.node.end;
      }
    case "stmt":
      switch (n.node.kind) {
        case "expr":
          return n.node.start * 1048576 + n.node.end;
        case "let":
          return n.node.start * 1048576 + n.node.end;
        case "return":
          return n.node.start * 1048576 + n.node.end;
        case "if":
          return n.node.start * 1048576 + n.node.end;
        case "while":
          return n.node.start * 1048576 + n.node.end;
        case "doWhile":
          return n.node.start * 1048576 + n.node.end;
        case "switch":
          return n.node.start * 1048576 + n.node.end;
        case "labeled":
          return n.node.start * 1048576 + n.node.end;
        case "break":
          return n.node.start * 1048576 + n.node.end;
        case "continue":
          return n.node.start * 1048576 + n.node.end;
        case "throw":
          return n.node.start * 1048576 + n.node.end;
        case "try":
          return n.node.start * 1048576 + n.node.end;
        case "for":
          return n.node.start * 1048576 + n.node.end;
        case "forIn":
          return n.node.start * 1048576 + n.node.end;
        case "forOf":
          return n.node.start * 1048576 + n.node.end;
        case "block":
          return n.node.start * 1048576 + n.node.end;
        case "empty":
          return n.node.start * 1048576 + n.node.end;
        case "debugger":
          return n.node.start * 1048576 + n.node.end;
        case "enum":
          return n.node.start * 1048576 + n.node.end;
        case "namespace":
          return n.node.start * 1048576 + n.node.end;
        case "declare":
          return n.node.start * 1048576 + n.node.end;
        case "comptime":
          return n.node.start * 1048576 + n.node.end;
        case "unsafe":
          return n.node.start * 1048576 + n.node.end;
        case "import":
          return n.node.start * 1048576 + n.node.end;
        case "importEquals":
          return n.node.start * 1048576 + n.node.end;
        case "export":
          return n.node.start * 1048576 + n.node.end;
        case "exportDefault":
          return n.node.start * 1048576 + n.node.end;
        case "exportNamed":
          return n.node.start * 1048576 + n.node.end;
        case "exportAll":
          return n.node.start * 1048576 + n.node.end;
        case "exportAssign":
          return n.node.start * 1048576 + n.node.end;
        case "exportAsNamespace":
          return n.node.start * 1048576 + n.node.end;
        case "typeAlias":
          return n.node.start * 1048576 + n.node.end;
        case "interface":
          return n.node.start * 1048576 + n.node.end;
        case "function":
          return n.node.start * 1048576 + n.node.end;
        default:
          return n.node.start * 1048576 + n.node.end;
      }
    case "tupleElement":
      return n.node.start * 1048576 + n.node.end;
    case "typeMember":
      switch (n.node.kind) {
        case "property":
          return n.node.start * 1048576 + n.node.end;
        case "method":
          return n.node.start * 1048576 + n.node.end;
        case "call":
          return n.node.start * 1048576 + n.node.end;
        case "construct":
          return n.node.start * 1048576 + n.node.end;
        case "index":
          return n.node.start * 1048576 + n.node.end;
        case "get":
          return n.node.start * 1048576 + n.node.end;
        default:
          return n.node.start * 1048576 + n.node.end;
      }
    case "objectProp":
      switch (n.node.kind) {
        case "property":
          return n.node.start * 1048576 + n.node.end;
        case "shorthand":
          return n.node.start * 1048576 + n.node.end;
        case "spread":
          return n.node.start * 1048576 + n.node.end;
        case "method":
          return n.node.start * 1048576 + n.node.end;
        case "get":
          return n.node.start * 1048576 + n.node.end;
        default:
          return n.node.start * 1048576 + n.node.end;
      }
    case "classNode":
      return n.node.start * 1048576 + n.node.end;
    case "classMember":
      switch (n.node.kind) {
        case "field":
          return n.node.start * 1048576 + n.node.end;
        case "method":
          return n.node.start * 1048576 + n.node.end;
        case "constructor":
          return n.node.start * 1048576 + n.node.end;
        case "get":
          return n.node.start * 1048576 + n.node.end;
        case "set":
          return n.node.start * 1048576 + n.node.end;
        case "index":
          return n.node.start * 1048576 + n.node.end;
        default:
          return n.node.start * 1048576 + n.node.end;
      }
    case "param":
      return n.node.start * 1048576 + n.node.end;
    case "pattern":
      switch (n.node.kind) {
        case "ident":
          return n.node.start * 1048576 + n.node.end;
        case "object":
          return n.node.start * 1048576 + n.node.end;
        case "array":
          return n.node.start * 1048576 + n.node.end;
        case "default":
          return n.node.start * 1048576 + n.node.end;
        case "expr":
          return n.node.start * 1048576 + n.node.end;
        case "wildcard":
          return n.node.start * 1048576 + n.node.end;
        case "literal":
          return n.node.start * 1048576 + n.node.end;
        case "variant":
          return n.node.start * 1048576 + n.node.end;
        default:
          return n.node.start * 1048576 + n.node.end;
      }
    case "matchArm":
      return n.node.start * 1048576 + n.node.end;
    case "patternProp":
      return n.node.start * 1048576 + n.node.end;
    case "specifier":
      return n.node.start * 1048576 + n.node.end;
    case "enumMember":
      return n.node.start * 1048576 + n.node.end;
    case "switchCase":
      return n.node.start * 1048576 + n.node.end;
    case "declarator":
      return n.node.start * 1048576 + n.node.end;
    case "typeParam":
      return n.node.start * 1048576 + n.node.end;
    case "typeAlias":
      return n.node.start * 1048576 + n.node.end;
    case "interface":
      return n.node.start * 1048576 + n.node.end;
    case "jsName":
      return 0;
    case "func":
      return n.node.start * 1048576 + n.node.end;
    default:
      return 0;
  }
}

// Collects every distinct node id under `n` in pre-order, refusing two different nodes that
// share one id, and noting in `shared` any id reached more than once.
export function collectIdsNode(n: AnyNode, seen: Mut<Map<usize, usize>>, order: Mut<usize[]>, shared: Mut<Set<usize>>): void {
  const rawId = nodeIdOf(n);
  if (rawId >= 0) {
    const id = rawId as usize;
    const mark = nodeSpanKey(n);
    const was = seen.get(id);
    if (was !== undefined) {
      assert(was === mark, `internal error: two nodes share id ${id}`);
      shared.add(id);
      return;
    }
    seen.set(id, mark);
    order.push(id);
  }
  switch (n.of) {
    case "typeNode":
      switch (n.node.kind) {
        case "ref":
          for (const x1 of n.node.args) {
            collectIdsNode({ of: "typeNode", node: x1 }, seen, order, shared);
          }
          break;
        case "literal":
          collectIdsNode({ of: "expr", node: n.node.value }, seen, order, shared);
          break;
        case "array":
          collectIdsNode({ of: "typeNode", node: n.node.element }, seen, order, shared);
          break;
        case "tuple":
          for (const x1 of n.node.elements) {
            collectIdsNode({ of: "tupleElement", node: x1 }, seen, order, shared);
          }
          break;
        case "object":
          for (const x1 of n.node.members) {
            collectIdsNode({ of: "typeMember", node: x1 }, seen, order, shared);
          }
          break;
        case "function":
          for (const x1 of n.node.typeParams) {
            collectIdsNode({ of: "typeParam", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.params) {
            collectIdsNode({ of: "param", node: x1 }, seen, order, shared);
          }
          collectIdsNode({ of: "typeNode", node: n.node.returns }, seen, order, shared);
          if (n.node.throws !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.throws! }, seen, order, shared);
          }
          break;
        case "union":
          for (const x1 of n.node.types) {
            collectIdsNode({ of: "typeNode", node: x1 }, seen, order, shared);
          }
          break;
        case "intersection":
          for (const x1 of n.node.types) {
            collectIdsNode({ of: "typeNode", node: x1 }, seen, order, shared);
          }
          break;
        case "operator":
          collectIdsNode({ of: "typeNode", node: n.node.type }, seen, order, shared);
          break;
        case "indexed":
          collectIdsNode({ of: "typeNode", node: n.node.object }, seen, order, shared);
          collectIdsNode({ of: "typeNode", node: n.node.index }, seen, order, shared);
          break;
        case "query":
          collectIdsNode({ of: "typeNode", node: n.node.target }, seen, order, shared);
          break;
        case "import":
          for (const x1 of n.node.args) {
            collectIdsNode({ of: "typeNode", node: x1 }, seen, order, shared);
          }
          break;
        case "conditional":
          collectIdsNode({ of: "typeNode", node: n.node.check }, seen, order, shared);
          collectIdsNode({ of: "typeNode", node: n.node.extends }, seen, order, shared);
          collectIdsNode({ of: "typeNode", node: n.node.then }, seen, order, shared);
          collectIdsNode({ of: "typeNode", node: n.node.else }, seen, order, shared);
          break;
        case "infer":
          if (n.node.constraint !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.constraint! }, seen, order, shared);
          }
          break;
        case "template":
          for (const x1 of n.node.types) {
            collectIdsNode({ of: "typeNode", node: x1 }, seen, order, shared);
          }
          break;
        case "mapped":
          collectIdsNode({ of: "typeNode", node: n.node.constraint }, seen, order, shared);
          if (n.node.as !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.as! }, seen, order, shared);
          }
          if (n.node.type !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.type! }, seen, order, shared);
          }
          break;
        case "predicate":
          if (n.node.type !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.type! }, seen, order, shared);
          }
          break;
      }
      break;
    case "expr":
      switch (n.node.kind) {
        case "template":
          for (const x1 of n.node.exprs) {
            collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
          }
          break;
        case "tagged":
          collectIdsNode({ of: "expr", node: n.node.tag }, seen, order, shared);
          for (const x1 of n.node.typeArgs) {
            collectIdsNode({ of: "typeNode", node: x1 }, seen, order, shared);
          }
          collectIdsNode({ of: "expr", node: n.node.template }, seen, order, shared);
          break;
        case "spread":
          collectIdsNode({ of: "expr", node: n.node.value }, seen, order, shared);
          break;
        case "array":
          for (const x1 of n.node.elements) {
            if (x1 !== undefined) {
              collectIdsNode({ of: "expr", node: x1! }, seen, order, shared);
            }
          }
          break;
        case "object":
          for (const x1 of n.node.props) {
            collectIdsNode({ of: "objectProp", node: x1 }, seen, order, shared);
          }
          break;
        case "function":
          for (const x1 of n.node.typeParams) {
            collectIdsNode({ of: "typeParam", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.params) {
            collectIdsNode({ of: "param", node: x1 }, seen, order, shared);
          }
          if (n.node.returnType !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.returnType! }, seen, order, shared);
          }
          collectIdsNode({ of: "stmts", node: n.node.body }, seen, order, shared);
          break;
        case "arrow":
          for (const x1 of n.node.typeParams) {
            collectIdsNode({ of: "typeParam", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.params) {
            collectIdsNode({ of: "param", node: x1 }, seen, order, shared);
          }
          if (n.node.returnType !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.returnType! }, seen, order, shared);
          }
          if (n.node.throws !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.throws! }, seen, order, shared);
          }
          if (Array.isArray(n.node.body)) {
            collectIdsNode({ of: "stmts", node: n.node.body }, seen, order, shared);
          } else {
            collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          }
          break;
        case "member":
          collectIdsNode({ of: "expr", node: n.node.object }, seen, order, shared);
          break;
        case "index":
          collectIdsNode({ of: "expr", node: n.node.object }, seen, order, shared);
          collectIdsNode({ of: "expr", node: n.node.index }, seen, order, shared);
          break;
        case "call":
          collectIdsNode({ of: "expr", node: n.node.callee }, seen, order, shared);
          for (const x1 of n.node.typeArgs) {
            collectIdsNode({ of: "typeNode", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.args) {
            collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
          }
          break;
        case "new":
          collectIdsNode({ of: "expr", node: n.node.callee }, seen, order, shared);
          for (const x1 of n.node.typeArgs) {
            collectIdsNode({ of: "typeNode", node: x1 }, seen, order, shared);
          }
          if (n.node.args !== undefined) {
            for (const x1 of n.node.args!) {
              collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
            }
          }
          break;
        case "instantiation":
          collectIdsNode({ of: "expr", node: n.node.expr }, seen, order, shared);
          for (const x1 of n.node.typeArgs) {
            collectIdsNode({ of: "typeNode", node: x1 }, seen, order, shared);
          }
          break;
        case "import":
          for (const x1 of n.node.args) {
            collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
          }
          break;
        case "nonNull":
          collectIdsNode({ of: "expr", node: n.node.expr }, seen, order, shared);
          if (n.node.narrows !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.narrows! }, seen, order, shared);
          }
          break;
        case "throw":
          collectIdsNode({ of: "expr", node: n.node.value }, seen, order, shared);
          break;
        case "class":
          for (const x1 of n.node.decorators) {
            collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.typeParams) {
            collectIdsNode({ of: "typeParam", node: x1 }, seen, order, shared);
          }
          if (n.node.extends !== undefined) {
            collectIdsNode({ of: "expr", node: n.node.extends! }, seen, order, shared);
          }
          for (const x1 of n.node.implements) {
            collectIdsNode({ of: "typeNode", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.members) {
            collectIdsNode({ of: "classMember", node: x1 }, seen, order, shared);
          }
          break;
        case "unary":
          collectIdsNode({ of: "expr", node: n.node.operand }, seen, order, shared);
          break;
        case "update":
          collectIdsNode({ of: "expr", node: n.node.operand }, seen, order, shared);
          break;
        case "binary":
          collectIdsNode({ of: "expr", node: n.node.left }, seen, order, shared);
          collectIdsNode({ of: "expr", node: n.node.right }, seen, order, shared);
          break;
        case "conditional":
          collectIdsNode({ of: "expr", node: n.node.cond }, seen, order, shared);
          collectIdsNode({ of: "expr", node: n.node.then }, seen, order, shared);
          collectIdsNode({ of: "expr", node: n.node.else }, seen, order, shared);
          break;
        case "assign":
          collectIdsNode({ of: "expr", node: n.node.target }, seen, order, shared);
          collectIdsNode({ of: "expr", node: n.node.value }, seen, order, shared);
          break;
        case "pipe":
          collectIdsNode({ of: "expr", node: n.node.value }, seen, order, shared);
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "match":
          collectIdsNode({ of: "expr", node: n.node.subject }, seen, order, shared);
          for (const x1 of n.node.arms) {
            collectIdsNode({ of: "matchArm", node: x1 }, seen, order, shared);
          }
          break;
        case "comptime":
          collectIdsNode({ of: "expr", node: n.node.expr }, seen, order, shared);
          break;
        case "unsafe":
          collectIdsNode({ of: "expr", node: n.node.expr }, seen, order, shared);
          break;
        case "destructure":
          collectIdsNode({ of: "pattern", node: n.node.pattern }, seen, order, shared);
          collectIdsNode({ of: "expr", node: n.node.value }, seen, order, shared);
          break;
        case "sequence":
          for (const x1 of n.node.exprs) {
            collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
          }
          break;
        case "yield":
          if (n.node.value !== undefined) {
            collectIdsNode({ of: "expr", node: n.node.value! }, seen, order, shared);
          }
          break;
        case "as":
          collectIdsNode({ of: "expr", node: n.node.expr }, seen, order, shared);
          collectIdsNode({ of: "typeNode", node: n.node.type }, seen, order, shared);
          break;
        case "satisfies":
          collectIdsNode({ of: "expr", node: n.node.expr }, seen, order, shared);
          collectIdsNode({ of: "typeNode", node: n.node.type }, seen, order, shared);
          break;
        case "assertion":
          collectIdsNode({ of: "typeNode", node: n.node.type }, seen, order, shared);
          collectIdsNode({ of: "expr", node: n.node.expr }, seen, order, shared);
          break;
      }
      break;
    case "stmt":
      switch (n.node.kind) {
        case "expr":
          collectIdsNode({ of: "expr", node: n.node.expr }, seen, order, shared);
          break;
        case "let":
          for (const x1 of n.node.declarations) {
            collectIdsNode({ of: "declarator", node: x1 }, seen, order, shared);
          }
          break;
        case "return":
          if (n.node.value !== undefined) {
            collectIdsNode({ of: "expr", node: n.node.value! }, seen, order, shared);
          }
          break;
        case "if":
          collectIdsNode({ of: "expr", node: n.node.cond }, seen, order, shared);
          collectIdsNode({ of: "stmts", node: n.node.then }, seen, order, shared);
          if (n.node.else !== undefined) {
            collectIdsNode({ of: "stmts", node: n.node.else! }, seen, order, shared);
          }
          break;
        case "while":
          collectIdsNode({ of: "expr", node: n.node.cond }, seen, order, shared);
          collectIdsNode({ of: "stmts", node: n.node.body }, seen, order, shared);
          break;
        case "doWhile":
          collectIdsNode({ of: "stmts", node: n.node.body }, seen, order, shared);
          collectIdsNode({ of: "expr", node: n.node.cond }, seen, order, shared);
          break;
        case "switch":
          collectIdsNode({ of: "expr", node: n.node.discriminant }, seen, order, shared);
          for (const x1 of n.node.cases) {
            collectIdsNode({ of: "switchCase", node: x1 }, seen, order, shared);
          }
          break;
        case "labeled":
          collectIdsNode({ of: "stmt", node: n.node.body }, seen, order, shared);
          break;
        case "throw":
          collectIdsNode({ of: "expr", node: n.node.value }, seen, order, shared);
          break;
        case "try":
          collectIdsNode({ of: "stmts", node: n.node.block }, seen, order, shared);
          if (n.node.param !== undefined) {
            collectIdsNode({ of: "pattern", node: n.node.param! }, seen, order, shared);
          }
          if (n.node.paramType !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.paramType! }, seen, order, shared);
          }
          if (n.node.handler !== undefined) {
            collectIdsNode({ of: "stmts", node: n.node.handler! }, seen, order, shared);
          }
          if (n.node.finalizer !== undefined) {
            collectIdsNode({ of: "stmts", node: n.node.finalizer! }, seen, order, shared);
          }
          break;
        case "for":
          if (n.node.init !== undefined) {
            collectIdsNode({ of: "stmt", node: n.node.init! }, seen, order, shared);
          }
          if (n.node.test !== undefined) {
            collectIdsNode({ of: "expr", node: n.node.test! }, seen, order, shared);
          }
          if (n.node.update !== undefined) {
            collectIdsNode({ of: "expr", node: n.node.update! }, seen, order, shared);
          }
          collectIdsNode({ of: "stmts", node: n.node.body }, seen, order, shared);
          break;
        case "forIn":
          switch (n.node.left.kind) {
            case "expr":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "let":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "return":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "if":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "while":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "doWhile":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "switch":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "labeled":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "break":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "continue":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "throw":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "try":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "for":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "forIn":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "forOf":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "block":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "empty":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "debugger":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "enum":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "namespace":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "declare":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "comptime":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "unsafe":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "import":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "importEquals":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "export":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "exportDefault":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "exportNamed":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "exportAll":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "exportAssign":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "exportAsNamespace":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "typeAlias":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "interface":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "function":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "class":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "ident":
              collectIdsNode({ of: "pattern", node: n.node.left }, seen, order, shared);
              break;
            case "object":
              collectIdsNode({ of: "pattern", node: n.node.left }, seen, order, shared);
              break;
            case "array":
              collectIdsNode({ of: "pattern", node: n.node.left }, seen, order, shared);
              break;
            case "default":
              collectIdsNode({ of: "pattern", node: n.node.left }, seen, order, shared);
              break;
            case "wildcard":
              collectIdsNode({ of: "pattern", node: n.node.left }, seen, order, shared);
              break;
            case "literal":
              collectIdsNode({ of: "pattern", node: n.node.left }, seen, order, shared);
              break;
            case "variant":
              collectIdsNode({ of: "pattern", node: n.node.left }, seen, order, shared);
              break;
            case "or":
              collectIdsNode({ of: "pattern", node: n.node.left }, seen, order, shared);
              break;
          }
          collectIdsNode({ of: "expr", node: n.node.right }, seen, order, shared);
          collectIdsNode({ of: "stmts", node: n.node.body }, seen, order, shared);
          break;
        case "forOf":
          switch (n.node.left.kind) {
            case "expr":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "let":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "return":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "if":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "while":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "doWhile":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "switch":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "labeled":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "break":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "continue":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "throw":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "try":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "for":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "forIn":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "forOf":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "block":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "empty":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "debugger":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "enum":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "namespace":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "declare":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "comptime":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "unsafe":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "import":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "importEquals":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "export":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "exportDefault":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "exportNamed":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "exportAll":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "exportAssign":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "exportAsNamespace":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "typeAlias":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "interface":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "function":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "class":
              collectIdsNode({ of: "stmt", node: n.node.left }, seen, order, shared);
              break;
            case "ident":
              collectIdsNode({ of: "pattern", node: n.node.left }, seen, order, shared);
              break;
            case "object":
              collectIdsNode({ of: "pattern", node: n.node.left }, seen, order, shared);
              break;
            case "array":
              collectIdsNode({ of: "pattern", node: n.node.left }, seen, order, shared);
              break;
            case "default":
              collectIdsNode({ of: "pattern", node: n.node.left }, seen, order, shared);
              break;
            case "wildcard":
              collectIdsNode({ of: "pattern", node: n.node.left }, seen, order, shared);
              break;
            case "literal":
              collectIdsNode({ of: "pattern", node: n.node.left }, seen, order, shared);
              break;
            case "variant":
              collectIdsNode({ of: "pattern", node: n.node.left }, seen, order, shared);
              break;
            case "or":
              collectIdsNode({ of: "pattern", node: n.node.left }, seen, order, shared);
              break;
          }
          collectIdsNode({ of: "expr", node: n.node.right }, seen, order, shared);
          collectIdsNode({ of: "stmts", node: n.node.body }, seen, order, shared);
          break;
        case "block":
          collectIdsNode({ of: "stmts", node: n.node.body }, seen, order, shared);
          break;
        case "enum":
          for (const x1 of n.node.typeParams) {
            collectIdsNode({ of: "typeParam", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.members) {
            collectIdsNode({ of: "enumMember", node: x1 }, seen, order, shared);
          }
          if (n.node.decorators !== undefined) {
            for (const x1 of n.node.decorators!) {
              collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
            }
          }
          break;
        case "namespace":
          if (n.node.body !== undefined) {
            collectIdsNode({ of: "stmts", node: n.node.body! }, seen, order, shared);
          }
          break;
        case "declare":
          collectIdsNode({ of: "stmt", node: n.node.body }, seen, order, shared);
          break;
        case "comptime":
          collectIdsNode({ of: "stmts", node: n.node.body }, seen, order, shared);
          break;
        case "unsafe":
          collectIdsNode({ of: "stmts", node: n.node.body }, seen, order, shared);
          break;
        case "import":
          if (n.node.named !== undefined) {
            for (const x1 of n.node.named!) {
              collectIdsNode({ of: "specifier", node: x1 }, seen, order, shared);
            }
          }
          if (n.node.attributes !== undefined) {
            collectIdsNode({ of: "expr", node: n.node.attributes! }, seen, order, shared);
          }
          break;
        case "export":
          collectIdsNode({ of: "stmt", node: n.node.body }, seen, order, shared);
          break;
        case "exportDefault":
          if (n.node.declaration !== undefined) {
            collectIdsNode({ of: "stmt", node: n.node.declaration! }, seen, order, shared);
          }
          if (n.node.value !== undefined) {
            collectIdsNode({ of: "expr", node: n.node.value! }, seen, order, shared);
          }
          break;
        case "exportNamed":
          for (const x1 of n.node.specifiers) {
            collectIdsNode({ of: "specifier", node: x1 }, seen, order, shared);
          }
          break;
        case "exportAssign":
          collectIdsNode({ of: "expr", node: n.node.value }, seen, order, shared);
          break;
        case "typeAlias":
          for (const x1 of n.node.typeParams) {
            collectIdsNode({ of: "typeParam", node: x1 }, seen, order, shared);
          }
          collectIdsNode({ of: "typeNode", node: n.node.type }, seen, order, shared);
          if (n.node.decorators !== undefined) {
            for (const x1 of n.node.decorators!) {
              collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
            }
          }
          if (n.node.js !== undefined) {
            collectIdsNode({ of: "jsName", node: n.node.js! }, seen, order, shared);
          }
          break;
        case "interface":
          for (const x1 of n.node.typeParams) {
            collectIdsNode({ of: "typeParam", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.extends) {
            collectIdsNode({ of: "typeNode", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.members) {
            collectIdsNode({ of: "typeMember", node: x1 }, seen, order, shared);
          }
          if (n.node.decorators !== undefined) {
            for (const x1 of n.node.decorators!) {
              collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
            }
          }
          if (n.node.js !== undefined) {
            collectIdsNode({ of: "jsName", node: n.node.js! }, seen, order, shared);
          }
          if (n.node.jsClass !== undefined) {
            for (const x1 of n.node.jsClass!.constructors) {
              for (const x2 of x1) {
                collectIdsNode({ of: "param", node: x2 }, seen, order, shared);
              }
            }
            for (const x1 of n.node.jsClass!.statics) {
              collectIdsNode({ of: "typeMember", node: x1 }, seen, order, shared);
            }
          }
          if (n.node.jsSource !== undefined) {
            collectIdsNode({ of: "stmt", node: n.node.jsSource! }, seen, order, shared);
          }
          break;
        case "function":
          for (const x1 of n.node.typeParams) {
            collectIdsNode({ of: "typeParam", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.params) {
            collectIdsNode({ of: "param", node: x1 }, seen, order, shared);
          }
          if (n.node.returnType !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.returnType! }, seen, order, shared);
          }
          if (n.node.throws !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.throws! }, seen, order, shared);
          }
          if (n.node.body !== undefined) {
            collectIdsNode({ of: "stmts", node: n.node.body! }, seen, order, shared);
          }
          if (n.node.decorators !== undefined) {
            for (const x1 of n.node.decorators!) {
              collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
            }
          }
          if (n.node.js !== undefined) {
            collectIdsNode({ of: "jsName", node: n.node.js! }, seen, order, shared);
          }
          break;
        case "class":
          for (const x1 of n.node.decorators) {
            collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.typeParams) {
            collectIdsNode({ of: "typeParam", node: x1 }, seen, order, shared);
          }
          if (n.node.extends !== undefined) {
            collectIdsNode({ of: "expr", node: n.node.extends! }, seen, order, shared);
          }
          for (const x1 of n.node.implements) {
            collectIdsNode({ of: "typeNode", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.members) {
            collectIdsNode({ of: "classMember", node: x1 }, seen, order, shared);
          }
          break;
      }
      break;
    case "tupleElement":
      collectIdsNode({ of: "typeNode", node: n.node.type }, seen, order, shared);
      break;
    case "typeMember":
      switch (n.node.kind) {
        case "property":
          if (typeof n.node.name !== "string") {
            collectIdsNode({ of: "expr", node: n.node.name }, seen, order, shared);
          }
          if (n.node.type !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.type! }, seen, order, shared);
          }
          break;
        case "method":
          if (typeof n.node.name !== "string") {
            collectIdsNode({ of: "expr", node: n.node.name }, seen, order, shared);
          }
          for (const x1 of n.node.typeParams) {
            collectIdsNode({ of: "typeParam", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.params) {
            collectIdsNode({ of: "param", node: x1 }, seen, order, shared);
          }
          if (n.node.returns !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.returns! }, seen, order, shared);
          }
          if (n.node.throws !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.throws! }, seen, order, shared);
          }
          break;
        case "call":
          for (const x1 of n.node.typeParams) {
            collectIdsNode({ of: "typeParam", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.params) {
            collectIdsNode({ of: "param", node: x1 }, seen, order, shared);
          }
          if (n.node.returns !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.returns! }, seen, order, shared);
          }
          break;
        case "construct":
          for (const x1 of n.node.typeParams) {
            collectIdsNode({ of: "typeParam", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.params) {
            collectIdsNode({ of: "param", node: x1 }, seen, order, shared);
          }
          if (n.node.returns !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.returns! }, seen, order, shared);
          }
          break;
        case "index":
          for (const x1 of n.node.params) {
            collectIdsNode({ of: "param", node: x1 }, seen, order, shared);
          }
          collectIdsNode({ of: "typeNode", node: n.node.type }, seen, order, shared);
          break;
        case "get":
          if (typeof n.node.name !== "string") {
            collectIdsNode({ of: "expr", node: n.node.name }, seen, order, shared);
          }
          for (const x1 of n.node.params) {
            collectIdsNode({ of: "param", node: x1 }, seen, order, shared);
          }
          if (n.node.returns !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.returns! }, seen, order, shared);
          }
          break;
        case "set":
          if (typeof n.node.name !== "string") {
            collectIdsNode({ of: "expr", node: n.node.name }, seen, order, shared);
          }
          for (const x1 of n.node.params) {
            collectIdsNode({ of: "param", node: x1 }, seen, order, shared);
          }
          if (n.node.returns !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.returns! }, seen, order, shared);
          }
          break;
      }
      break;
    case "objectProp":
      switch (n.node.kind) {
        case "property":
          if (typeof n.node.key !== "string") {
            collectIdsNode({ of: "expr", node: n.node.key }, seen, order, shared);
          }
          collectIdsNode({ of: "expr", node: n.node.value }, seen, order, shared);
          break;
        case "shorthand":
          if (n.node.default !== undefined) {
            collectIdsNode({ of: "expr", node: n.node.default! }, seen, order, shared);
          }
          break;
        case "spread":
          collectIdsNode({ of: "expr", node: n.node.value }, seen, order, shared);
          break;
        case "method":
          if (typeof n.node.key !== "string") {
            collectIdsNode({ of: "expr", node: n.node.key }, seen, order, shared);
          }
          for (const x1 of n.node.typeParams) {
            collectIdsNode({ of: "typeParam", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.params) {
            collectIdsNode({ of: "param", node: x1 }, seen, order, shared);
          }
          if (n.node.returnType !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.returnType! }, seen, order, shared);
          }
          collectIdsNode({ of: "stmts", node: n.node.body }, seen, order, shared);
          break;
        case "get":
          if (typeof n.node.key !== "string") {
            collectIdsNode({ of: "expr", node: n.node.key }, seen, order, shared);
          }
          for (const x1 of n.node.params) {
            collectIdsNode({ of: "param", node: x1 }, seen, order, shared);
          }
          if (n.node.returnType !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.returnType! }, seen, order, shared);
          }
          collectIdsNode({ of: "stmts", node: n.node.body }, seen, order, shared);
          break;
        case "set":
          if (typeof n.node.key !== "string") {
            collectIdsNode({ of: "expr", node: n.node.key }, seen, order, shared);
          }
          for (const x1 of n.node.params) {
            collectIdsNode({ of: "param", node: x1 }, seen, order, shared);
          }
          if (n.node.returnType !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.returnType! }, seen, order, shared);
          }
          collectIdsNode({ of: "stmts", node: n.node.body }, seen, order, shared);
          break;
      }
      break;
    case "classNode":
      for (const x1 of n.node.decorators) {
        collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
      }
      for (const x1 of n.node.typeParams) {
        collectIdsNode({ of: "typeParam", node: x1 }, seen, order, shared);
      }
      if (n.node.extends !== undefined) {
        collectIdsNode({ of: "expr", node: n.node.extends! }, seen, order, shared);
      }
      for (const x1 of n.node.implements) {
        collectIdsNode({ of: "typeNode", node: x1 }, seen, order, shared);
      }
      for (const x1 of n.node.members) {
        collectIdsNode({ of: "classMember", node: x1 }, seen, order, shared);
      }
      break;
    case "classMember":
      switch (n.node.kind) {
        case "field":
          for (const x1 of n.node.decorators) {
            collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
          }
          if (typeof n.node.name !== "string") {
            collectIdsNode({ of: "expr", node: n.node.name }, seen, order, shared);
          }
          if (n.node.type !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.type! }, seen, order, shared);
          }
          if (n.node.init !== undefined) {
            collectIdsNode({ of: "expr", node: n.node.init! }, seen, order, shared);
          }
          break;
        case "method":
          for (const x1 of n.node.decorators) {
            collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
          }
          if (typeof n.node.name !== "string") {
            collectIdsNode({ of: "expr", node: n.node.name }, seen, order, shared);
          }
          for (const x1 of n.node.typeParams) {
            collectIdsNode({ of: "typeParam", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.params) {
            collectIdsNode({ of: "param", node: x1 }, seen, order, shared);
          }
          if (n.node.returnType !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.returnType! }, seen, order, shared);
          }
          if (n.node.throws !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.throws! }, seen, order, shared);
          }
          if (n.node.body !== undefined) {
            collectIdsNode({ of: "stmts", node: n.node.body! }, seen, order, shared);
          }
          break;
        case "constructor":
          for (const x1 of n.node.decorators) {
            collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.params) {
            collectIdsNode({ of: "param", node: x1 }, seen, order, shared);
          }
          if (n.node.throws !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.throws! }, seen, order, shared);
          }
          if (n.node.body !== undefined) {
            collectIdsNode({ of: "stmts", node: n.node.body! }, seen, order, shared);
          }
          break;
        case "get":
          for (const x1 of n.node.decorators) {
            collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
          }
          if (typeof n.node.name !== "string") {
            collectIdsNode({ of: "expr", node: n.node.name }, seen, order, shared);
          }
          for (const x1 of n.node.params) {
            collectIdsNode({ of: "param", node: x1 }, seen, order, shared);
          }
          if (n.node.returnType !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.returnType! }, seen, order, shared);
          }
          if (n.node.throws !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.throws! }, seen, order, shared);
          }
          if (n.node.body !== undefined) {
            collectIdsNode({ of: "stmts", node: n.node.body! }, seen, order, shared);
          }
          break;
        case "set":
          for (const x1 of n.node.decorators) {
            collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
          }
          if (typeof n.node.name !== "string") {
            collectIdsNode({ of: "expr", node: n.node.name }, seen, order, shared);
          }
          for (const x1 of n.node.params) {
            collectIdsNode({ of: "param", node: x1 }, seen, order, shared);
          }
          if (n.node.returnType !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.returnType! }, seen, order, shared);
          }
          if (n.node.throws !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.throws! }, seen, order, shared);
          }
          if (n.node.body !== undefined) {
            collectIdsNode({ of: "stmts", node: n.node.body! }, seen, order, shared);
          }
          break;
        case "index":
          for (const x1 of n.node.decorators) {
            collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.params) {
            collectIdsNode({ of: "param", node: x1 }, seen, order, shared);
          }
          collectIdsNode({ of: "typeNode", node: n.node.type }, seen, order, shared);
          break;
        case "staticBlock":
          for (const x1 of n.node.decorators) {
            collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
          }
          collectIdsNode({ of: "stmts", node: n.node.body }, seen, order, shared);
          break;
      }
      break;
    case "param":
      collectIdsNode({ of: "pattern", node: n.node.pattern }, seen, order, shared);
      if (n.node.type !== undefined) {
        collectIdsNode({ of: "typeNode", node: n.node.type! }, seen, order, shared);
      }
      if (n.node.default !== undefined) {
        collectIdsNode({ of: "expr", node: n.node.default! }, seen, order, shared);
      }
      for (const x1 of n.node.decorators) {
        collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
      }
      break;
    case "pattern":
      switch (n.node.kind) {
        case "object":
          for (const x1 of n.node.props) {
            collectIdsNode({ of: "patternProp", node: x1 }, seen, order, shared);
          }
          if (n.node.rest !== undefined) {
            collectIdsNode({ of: "pattern", node: n.node.rest! }, seen, order, shared);
          }
          break;
        case "array":
          for (const x1 of n.node.elements) {
            if (x1 !== undefined) {
              collectIdsNode({ of: "pattern", node: x1! }, seen, order, shared);
            }
          }
          if (n.node.rest !== undefined) {
            collectIdsNode({ of: "pattern", node: n.node.rest! }, seen, order, shared);
          }
          break;
        case "default":
          collectIdsNode({ of: "pattern", node: n.node.target }, seen, order, shared);
          collectIdsNode({ of: "expr", node: n.node.value }, seen, order, shared);
          break;
        case "expr":
          collectIdsNode({ of: "expr", node: n.node.expr }, seen, order, shared);
          break;
        case "literal":
          collectIdsNode({ of: "expr", node: n.node.value }, seen, order, shared);
          break;
        case "variant":
          if (n.node.args !== undefined) {
            for (const x1 of n.node.args!) {
              collectIdsNode({ of: "pattern", node: x1 }, seen, order, shared);
            }
          }
          break;
        case "or":
          for (const x1 of n.node.patterns) {
            collectIdsNode({ of: "pattern", node: x1 }, seen, order, shared);
          }
          break;
      }
      break;
    case "matchArm":
      collectIdsNode({ of: "pattern", node: n.node.pattern }, seen, order, shared);
      if (n.node.guard !== undefined) {
        collectIdsNode({ of: "expr", node: n.node.guard! }, seen, order, shared);
      }
      switch (n.node.body.kind) {
        case "int":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "float":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "bigint":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "null":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "this":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "super":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "regex":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "template":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "tagged":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "bool":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "string":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "ident":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "spread":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "array":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "object":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "function":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "arrow":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "member":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "index":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "call":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "new":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "instantiation":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "meta":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "import":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "nonNull":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "throw":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "class":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "privateName":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "unary":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "update":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "binary":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "conditional":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "assign":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "pipe":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "topic":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "match":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "comptime":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "unsafe":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "destructure":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "sequence":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "yield":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "as":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "satisfies":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "assertion":
          collectIdsNode({ of: "expr", node: n.node.body }, seen, order, shared);
          break;
        case "block":
          collectIdsNode({ of: "stmt", node: n.node.body }, seen, order, shared);
          break;
      }
      break;
    case "patternProp":
      if (typeof n.node.key !== "string") {
        collectIdsNode({ of: "expr", node: n.node.key }, seen, order, shared);
      }
      collectIdsNode({ of: "pattern", node: n.node.value }, seen, order, shared);
      break;
    case "specifier":
      break;
    case "enumMember":
      if (n.node.init !== undefined) {
        collectIdsNode({ of: "expr", node: n.node.init! }, seen, order, shared);
      }
      if (n.node.payload !== undefined) {
        for (const x1 of n.node.payload!) {
          collectIdsNode({ of: "typeNode", node: x1 }, seen, order, shared);
        }
      }
      break;
    case "switchCase":
      if (n.node.test !== undefined) {
        collectIdsNode({ of: "expr", node: n.node.test! }, seen, order, shared);
      }
      collectIdsNode({ of: "stmts", node: n.node.body }, seen, order, shared);
      break;
    case "declarator":
      collectIdsNode({ of: "pattern", node: n.node.target }, seen, order, shared);
      if (n.node.type !== undefined) {
        collectIdsNode({ of: "typeNode", node: n.node.type! }, seen, order, shared);
      }
      if (n.node.init !== undefined) {
        collectIdsNode({ of: "expr", node: n.node.init! }, seen, order, shared);
      }
      break;
    case "typeParam":
      if (n.node.constraint !== undefined) {
        collectIdsNode({ of: "typeNode", node: n.node.constraint! }, seen, order, shared);
      }
      if (n.node.default !== undefined) {
        collectIdsNode({ of: "typeNode", node: n.node.default! }, seen, order, shared);
      }
      break;
    case "typeAlias":
      switch (n.node.kind) {
        case "typeAlias":
          for (const x1 of n.node.typeParams) {
            collectIdsNode({ of: "typeParam", node: x1 }, seen, order, shared);
          }
          collectIdsNode({ of: "typeNode", node: n.node.type }, seen, order, shared);
          if (n.node.decorators !== undefined) {
            for (const x1 of n.node.decorators!) {
              collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
            }
          }
          if (n.node.js !== undefined) {
            collectIdsNode({ of: "jsName", node: n.node.js! }, seen, order, shared);
          }
          break;
      }
      break;
    case "interface":
      switch (n.node.kind) {
        case "interface":
          for (const x1 of n.node.typeParams) {
            collectIdsNode({ of: "typeParam", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.extends) {
            collectIdsNode({ of: "typeNode", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.members) {
            collectIdsNode({ of: "typeMember", node: x1 }, seen, order, shared);
          }
          if (n.node.decorators !== undefined) {
            for (const x1 of n.node.decorators!) {
              collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
            }
          }
          if (n.node.js !== undefined) {
            collectIdsNode({ of: "jsName", node: n.node.js! }, seen, order, shared);
          }
          if (n.node.jsClass !== undefined) {
            for (const x1 of n.node.jsClass!.constructors) {
              for (const x2 of x1) {
                collectIdsNode({ of: "param", node: x2 }, seen, order, shared);
              }
            }
            for (const x1 of n.node.jsClass!.statics) {
              collectIdsNode({ of: "typeMember", node: x1 }, seen, order, shared);
            }
          }
          if (n.node.jsSource !== undefined) {
            collectIdsNode({ of: "stmt", node: n.node.jsSource! }, seen, order, shared);
          }
          break;
      }
      break;
    case "jsName":
      if (n.node.overloads !== undefined) {
        for (const x1 of n.node.overloads!) {
          collectIdsNode({ of: "func", node: x1 }, seen, order, shared);
        }
      }
      break;
    case "func":
      switch (n.node.kind) {
        case "function":
          for (const x1 of n.node.typeParams) {
            collectIdsNode({ of: "typeParam", node: x1 }, seen, order, shared);
          }
          for (const x1 of n.node.params) {
            collectIdsNode({ of: "param", node: x1 }, seen, order, shared);
          }
          if (n.node.returnType !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.returnType! }, seen, order, shared);
          }
          if (n.node.throws !== undefined) {
            collectIdsNode({ of: "typeNode", node: n.node.throws! }, seen, order, shared);
          }
          if (n.node.body !== undefined) {
            collectIdsNode({ of: "stmts", node: n.node.body! }, seen, order, shared);
          }
          if (n.node.decorators !== undefined) {
            for (const x1 of n.node.decorators!) {
              collectIdsNode({ of: "expr", node: x1 }, seen, order, shared);
            }
          }
          if (n.node.js !== undefined) {
            collectIdsNode({ of: "jsName", node: n.node.js! }, seen, order, shared);
          }
          break;
      }
      break;
    case "stmts":
      for (const x of n.node) {
        collectIdsNode({ of: "stmt", node: x }, seen, order, shared);
      }
      break;
  }
}

// What a node's field holds, for a quote to read: text, a number, a boolean, a list, a node by
// its tag and fields, an object of fields that isn't a node, or nothing.
export type QuoteValue =
  | { kind: "none" }
  | { kind: "text"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "int"; value: i64 }
  | { kind: "bigint"; value: bigint }
  | { kind: "float"; value: f64 }
  | { kind: "list"; items: QuoteValue[] }
  | { kind: "node"; of: string; fields: QuoteField[] }
  | { kind: "record"; fields: QuoteField[] };
export type QuoteField = { name: string; value: QuoteValue };

export function quoteTree(n: AnyNode): QuoteValue {
  switch (n.of) {
    case "typeNode":
      return { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.node) };
    case "expr":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n.node) };
    case "stmt":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n.node) };
    case "tupleElement":
      return { kind: "node", of: "tupleElement", fields: fieldsOfTupleElement(n.node) };
    case "typeMember":
      return { kind: "node", of: "typeMember", fields: fieldsOfTypeMember(n.node) };
    case "objectProp":
      return { kind: "node", of: "objectProp", fields: fieldsOfObjectProp(n.node) };
    case "classNode":
      return { kind: "node", of: "classNode", fields: fieldsOfClassNode(n.node) };
    case "classMember":
      return { kind: "node", of: "classMember", fields: fieldsOfClassMember(n.node) };
    case "param":
      return { kind: "node", of: "param", fields: fieldsOfParam(n.node) };
    case "pattern":
      return { kind: "node", of: "pattern", fields: fieldsOfPattern(n.node) };
    case "matchArm":
      return { kind: "node", of: "matchArm", fields: fieldsOfMatchArm(n.node) };
    case "patternProp":
      return { kind: "node", of: "patternProp", fields: fieldsOfPatternProp(n.node) };
    case "specifier":
      return { kind: "node", of: "specifier", fields: fieldsOfSpecifier(n.node) };
    case "enumMember":
      return { kind: "node", of: "enumMember", fields: fieldsOfEnumMember(n.node) };
    case "switchCase":
      return { kind: "node", of: "switchCase", fields: fieldsOfSwitchCase(n.node) };
    case "declarator":
      return { kind: "node", of: "declarator", fields: fieldsOfDeclarator(n.node) };
    case "typeParam":
      return { kind: "node", of: "typeParam", fields: fieldsOfTypeParam(n.node) };
    case "typeAlias":
      return { kind: "node", of: "typeAlias", fields: fieldsOfTypeAlias(n.node) };
    case "interface":
      return { kind: "node", of: "interface", fields: fieldsOfInterface(n.node) };
    case "jsName":
      return { kind: "node", of: "jsName", fields: fieldsOfJsName(n.node) };
    case "func":
      return { kind: "node", of: "func", fields: fieldsOfFunc(n.node) };
    case "stmts": {
      let items134: QuoteValue[] = [];
      for (const x134 of n.node) {
        items134.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x134) });
      }
      return { kind: "list", items: items134 };
    }
  }
  return { kind: "none" };
}

function fieldsOfTypeNode(n: Ref<TypeNode>): QuoteField[] {
  switch (n.kind) {
    case "ref":
      return fieldsOfTypeNode_ref(n);
    case "literal":
      return fieldsOfTypeNode_literal(n);
    case "array":
      return fieldsOfTypeNode_array(n);
    case "tuple":
      return fieldsOfTypeNode_tuple(n);
    case "object":
      return fieldsOfTypeNode_object(n);
    case "function":
      return fieldsOfTypeNode_function(n);
    case "union":
      return fieldsOfTypeNode_union(n);
    case "intersection":
      return fieldsOfTypeNode_intersection(n);
    case "operator":
      return fieldsOfTypeNode_operator(n);
    case "indexed":
      return fieldsOfTypeNode_indexed(n);
    case "query":
      return fieldsOfTypeNode_query(n);
    case "import":
      return fieldsOfTypeNode_import(n);
    case "conditional":
      return fieldsOfTypeNode_conditional(n);
    case "infer":
      return fieldsOfTypeNode_infer(n);
    case "template":
      return fieldsOfTypeNode_template(n);
    case "mapped":
      return fieldsOfTypeNode_mapped(n);
    case "predicate":
      return fieldsOfTypeNode_predicate(n);
  }
  return [];
}

function fieldsOfExpr(n: Ref<Expr>): QuoteField[] {
  switch (n.kind) {
    case "int":
      return fieldsOfExpr_int(n);
    case "float":
      return fieldsOfExpr_float(n);
    case "bigint":
      return fieldsOfExpr_bigint(n);
    case "null":
      return fieldsOfExpr_null(n);
    case "this":
      return fieldsOfExpr_this(n);
    case "super":
      return fieldsOfExpr_super(n);
    case "regex":
      return fieldsOfExpr_regex(n);
    case "template":
      return fieldsOfExpr_template(n);
    case "tagged":
      return fieldsOfExpr_tagged(n);
    case "bool":
      return fieldsOfExpr_bool(n);
    case "string":
      return fieldsOfExpr_string(n);
    case "ident":
      return fieldsOfExpr_ident(n);
    case "spread":
      return fieldsOfExpr_spread(n);
    case "array":
      return fieldsOfExpr_array(n);
    case "object":
      return fieldsOfExpr_object(n);
    case "function":
      return fieldsOfExpr_function(n);
    case "arrow":
      return fieldsOfExpr_arrow(n);
    case "member":
      return fieldsOfExpr_member(n);
    case "index":
      return fieldsOfExpr_index(n);
    case "call":
      return fieldsOfExpr_call(n);
    case "new":
      return fieldsOfExpr_new(n);
    case "instantiation":
      return fieldsOfExpr_instantiation(n);
    case "meta":
      return fieldsOfExpr_meta(n);
    case "import":
      return fieldsOfExpr_import(n);
    case "nonNull":
      return fieldsOfExpr_nonNull(n);
    case "throw":
      return fieldsOfExpr_throw(n);
    case "class":
      return fieldsOfExpr_class(n);
    case "privateName":
      return fieldsOfExpr_privateName(n);
    case "unary":
      return fieldsOfExpr_unary(n);
    case "update":
      return fieldsOfExpr_update(n);
    case "binary":
      return fieldsOfExpr_binary(n);
    case "conditional":
      return fieldsOfExpr_conditional(n);
    case "assign":
      return fieldsOfExpr_assign(n);
    case "pipe":
      return fieldsOfExpr_pipe(n);
    case "topic":
      return fieldsOfExpr_topic(n);
    case "match":
      return fieldsOfExpr_match(n);
    case "comptime":
      return fieldsOfExpr_comptime(n);
    case "unsafe":
      return fieldsOfExpr_unsafe(n);
    case "destructure":
      return fieldsOfExpr_destructure(n);
    case "sequence":
      return fieldsOfExpr_sequence(n);
    case "yield":
      return fieldsOfExpr_yield(n);
    case "as":
      return fieldsOfExpr_as(n);
    case "satisfies":
      return fieldsOfExpr_satisfies(n);
    case "assertion":
      return fieldsOfExpr_assertion(n);
  }
  return [];
}

function fieldsOfStmt(n: Ref<Stmt>): QuoteField[] {
  switch (n.kind) {
    case "expr":
      return fieldsOfStmt_expr(n);
    case "let":
      return fieldsOfStmt_let(n);
    case "return":
      return fieldsOfStmt_return(n);
    case "if":
      return fieldsOfStmt_if(n);
    case "while":
      return fieldsOfStmt_while(n);
    case "doWhile":
      return fieldsOfStmt_doWhile(n);
    case "switch":
      return fieldsOfStmt_switch(n);
    case "labeled":
      return fieldsOfStmt_labeled(n);
    case "break":
      return fieldsOfStmt_break(n);
    case "continue":
      return fieldsOfStmt_continue(n);
    case "throw":
      return fieldsOfStmt_throw(n);
    case "try":
      return fieldsOfStmt_try(n);
    case "for":
      return fieldsOfStmt_for(n);
    case "forIn":
      return fieldsOfStmt_forIn(n);
    case "forOf":
      return fieldsOfStmt_forOf(n);
    case "block":
      return fieldsOfStmt_block(n);
    case "empty":
      return fieldsOfStmt_empty(n);
    case "debugger":
      return fieldsOfStmt_debugger(n);
    case "enum":
      return fieldsOfStmt_enum(n);
    case "namespace":
      return fieldsOfStmt_namespace(n);
    case "declare":
      return fieldsOfStmt_declare(n);
    case "comptime":
      return fieldsOfStmt_comptime(n);
    case "unsafe":
      return fieldsOfStmt_unsafe(n);
    case "import":
      return fieldsOfStmt_import(n);
    case "importEquals":
      return fieldsOfStmt_importEquals(n);
    case "export":
      return fieldsOfStmt_export(n);
    case "exportDefault":
      return fieldsOfStmt_exportDefault(n);
    case "exportNamed":
      return fieldsOfStmt_exportNamed(n);
    case "exportAll":
      return fieldsOfStmt_exportAll(n);
    case "exportAssign":
      return fieldsOfStmt_exportAssign(n);
    case "exportAsNamespace":
      return fieldsOfStmt_exportAsNamespace(n);
    case "typeAlias":
      return fieldsOfTypeAlias_typeAlias(n);
    case "interface":
      return fieldsOfInterface_interface(n);
    case "function":
      return fieldsOfFunc_function(n);
    case "class":
      return fieldsOfStmt_class(n);
  }
  return [];
}

function fieldsOfTupleElement(n: Ref<TupleElement>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  if (n.name === undefined) out.push({ name: "name", value: { kind: "none" } });
  else {
    out.push({ name: "name", value: { kind: "text", value: n.name } });
  }
  out.push({ name: "optional", value: { kind: "boolean", value: n.optional } });
  out.push({ name: "rest", value: { kind: "boolean", value: n.rest } });
  out.push({ name: "type", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.type) } });
  return out;
}

function fieldsOfTypeMember(n: Ref<TypeMember>): QuoteField[] {
  switch (n.kind) {
    case "property":
      return fieldsOfTypeMember_property(n);
    case "method":
      return fieldsOfTypeMember_method(n);
    case "call":
      return fieldsOfTypeMember_call(n);
    case "construct":
      return fieldsOfTypeMember_construct(n);
    case "index":
      return fieldsOfTypeMember_index(n);
    case "get":
      return fieldsOfTypeMember_get(n);
    case "set":
      return fieldsOfTypeMember_set(n);
  }
  return [];
}

function fieldsOfObjectProp(n: Ref<ObjectProp>): QuoteField[] {
  switch (n.kind) {
    case "property":
      return fieldsOfObjectProp_property(n);
    case "shorthand":
      return fieldsOfObjectProp_shorthand(n);
    case "spread":
      return fieldsOfObjectProp_spread(n);
    case "method":
      return fieldsOfObjectProp_method(n);
    case "get":
      return fieldsOfObjectProp_get(n);
    case "set":
      return fieldsOfObjectProp_set(n);
  }
  return [];
}

function fieldsOfClassNode(n: Ref<ClassNode>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  if (n.name === undefined) out.push({ name: "name", value: { kind: "none" } });
  else {
    out.push({ name: "name", value: { kind: "text", value: n.name } });
  }
  out.push({ name: "abstract", value: { kind: "boolean", value: n.abstract } });
  let items93: QuoteValue[] = [];
  for (const x93 of n.decorators) {
    items93.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x93) });
  }
  out.push({ name: "decorators", value: { kind: "list", items: items93 } });
  let items94: QuoteValue[] = [];
  for (const x94 of n.typeParams) {
    items94.push({ kind: "node", of: "typeParam", fields: fieldsOfTypeParam(x94) });
  }
  out.push({ name: "typeParams", value: { kind: "list", items: items94 } });
  if (n.extends === undefined) out.push({ name: "extends", value: { kind: "none" } });
  else {
    out.push({ name: "extends", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.extends) } });
  }
  let items95: QuoteValue[] = [];
  for (const x95 of n.implements) {
    items95.push({ kind: "node", of: "typeNode", fields: fieldsOfTypeNode(x95) });
  }
  out.push({ name: "implements", value: { kind: "list", items: items95 } });
  let items96: QuoteValue[] = [];
  for (const x96 of n.members) {
    items96.push({ kind: "node", of: "classMember", fields: fieldsOfClassMember(x96) });
  }
  out.push({ name: "members", value: { kind: "list", items: items96 } });
  if (n.derives !== undefined) {
    let items97: QuoteValue[] = [];
    for (const x97 of n.derives) {
      items97.push({ kind: "text", value: x97 });
    }
    out.push({ name: "derives", value: { kind: "list", items: items97 } });
  }
  return out;
}

function fieldsOfClassMember(n: Ref<ClassMember>): QuoteField[] {
  switch (n.kind) {
    case "field":
      return fieldsOfClassMember_field(n);
    case "method":
      return fieldsOfClassMember_method(n);
    case "constructor":
      return fieldsOfClassMember_constructor(n);
    case "get":
      return fieldsOfClassMember_get(n);
    case "set":
      return fieldsOfClassMember_set(n);
    case "index":
      return fieldsOfClassMember_index(n);
    case "staticBlock":
      return fieldsOfClassMember_staticBlock(n);
  }
  return [];
}

function fieldsOfParam(n: Ref<Param>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "pattern", value: { kind: "node", of: "pattern", fields: fieldsOfPattern(n.pattern) } });
  if (n.type === undefined) out.push({ name: "type", value: { kind: "none" } });
  else {
    out.push({ name: "type", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.type) } });
  }
  out.push({ name: "optional", value: { kind: "boolean", value: n.optional } });
  out.push({ name: "rest", value: { kind: "boolean", value: n.rest } });
  if (n.default === undefined) out.push({ name: "default", value: { kind: "none" } });
  else {
    out.push({ name: "default", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.default) } });
  }
  let items124: QuoteValue[] = [];
  for (const x124 of n.modifiers) {
    items124.push({ kind: "text", value: x124 });
  }
  out.push({ name: "modifiers", value: { kind: "list", items: items124 } });
  let items125: QuoteValue[] = [];
  for (const x125 of n.decorators) {
    items125.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x125) });
  }
  out.push({ name: "decorators", value: { kind: "list", items: items125 } });
  out.push({ name: "comptime", value: { kind: "boolean", value: n.comptime } });
  return out;
}

function fieldsOfPattern(n: Ref<Pattern>): QuoteField[] {
  switch (n.kind) {
    case "ident":
      return fieldsOfPattern_ident(n);
    case "object":
      return fieldsOfPattern_object(n);
    case "array":
      return fieldsOfPattern_array(n);
    case "default":
      return fieldsOfPattern_default(n);
    case "expr":
      return fieldsOfPattern_expr(n);
    case "wildcard":
      return fieldsOfPattern_wildcard(n);
    case "literal":
      return fieldsOfPattern_literal(n);
    case "variant":
      return fieldsOfPattern_variant(n);
    case "or":
      return fieldsOfPattern_or(n);
  }
  return [];
}

function fieldsOfMatchArm(n: Ref<MatchArm>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "pattern", value: { kind: "node", of: "pattern", fields: fieldsOfPattern(n.pattern) } });
  if (n.guard === undefined) out.push({ name: "guard", value: { kind: "none" } });
  else {
    out.push({ name: "guard", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.guard) } });
  }
  out.push({ name: "body", value: oneOf4(n.body) });
  return out;
}

function fieldsOfPatternProp(n: Ref<PatternProp>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "key", value: oneOf3(n.key) });
  out.push({ name: "value", value: { kind: "node", of: "pattern", fields: fieldsOfPattern(n.value) } });
  return out;
}

function fieldsOfSpecifier(n: Ref<Specifier>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  if (n.alias === undefined) out.push({ name: "alias", value: { kind: "none" } });
  else {
    out.push({ name: "alias", value: { kind: "text", value: n.alias } });
  }
  out.push({ name: "typeOnly", value: { kind: "boolean", value: n.typeOnly } });
  return out;
}

function fieldsOfEnumMember(n: Ref<EnumMember>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  if (n.init === undefined) out.push({ name: "init", value: { kind: "none" } });
  else {
    out.push({ name: "init", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.init) } });
  }
  if (n.payload === undefined) out.push({ name: "payload", value: { kind: "none" } });
  else {
    let items130: QuoteValue[] = [];
    for (const x130 of n.payload) {
      items130.push({ kind: "node", of: "typeNode", fields: fieldsOfTypeNode(x130) });
    }
    out.push({ name: "payload", value: { kind: "list", items: items130 } });
  }
  return out;
}

function fieldsOfSwitchCase(n: Ref<SwitchCase>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  if (n.test === undefined) out.push({ name: "test", value: { kind: "none" } });
  else {
    out.push({ name: "test", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.test) } });
  }
  let items131: QuoteValue[] = [];
  for (const x131 of n.body) {
    items131.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x131) });
  }
  out.push({ name: "body", value: { kind: "list", items: items131 } });
  return out;
}

function fieldsOfDeclarator(n: Ref<Declarator>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "target", value: { kind: "node", of: "pattern", fields: fieldsOfPattern(n.target) } });
  if (n.type === undefined) out.push({ name: "type", value: { kind: "none" } });
  else {
    out.push({ name: "type", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.type) } });
  }
  if (n.init === undefined) out.push({ name: "init", value: { kind: "none" } });
  else {
    out.push({ name: "init", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.init) } });
  }
  return out;
}

function fieldsOfTypeParam(n: Ref<TypeParam>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  if (n.constraint === undefined) out.push({ name: "constraint", value: { kind: "none" } });
  else {
    out.push({ name: "constraint", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.constraint) } });
  }
  if (n.default === undefined) out.push({ name: "default", value: { kind: "none" } });
  else {
    out.push({ name: "default", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.default) } });
  }
  let items132: QuoteValue[] = [];
  for (const x132 of n.modifiers) {
    items132.push({ kind: "text", value: x132 });
  }
  out.push({ name: "modifiers", value: { kind: "list", items: items132 } });
  return out;
}

function fieldsOfTypeAlias(n: Ref<TypeAlias>): QuoteField[] {
  switch (n.kind) {
    case "typeAlias":
      return fieldsOfTypeAlias_typeAlias(n);
  }
  return [];
}

function fieldsOfInterface(n: Ref<Interface>): QuoteField[] {
  switch (n.kind) {
    case "interface":
      return fieldsOfInterface_interface(n);
  }
  return [];
}

function fieldsOfJsName(n: Ref<JsName>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "module", value: { kind: "text", value: n.module } });
  out.push({ name: "package", value: { kind: "int", value: n.package as i64 } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  if (n.const !== undefined) {
    out.push({ name: "const", value: { kind: "boolean", value: n.const } });
  }
  if (n.overloads !== undefined) {
    let items133: QuoteValue[] = [];
    for (const x133 of n.overloads) {
      items133.push({ kind: "node", of: "func", fields: fieldsOfFunc(x133) });
    }
    out.push({ name: "overloads", value: { kind: "list", items: items133 } });
  }
  return out;
}

function fieldsOfFunc(n: Ref<Func>): QuoteField[] {
  switch (n.kind) {
    case "function":
      return fieldsOfFunc_function(n);
  }
  return [];
}

function fieldsOfTypeNode_ref(n: Ref<Extract<TypeNode, { kind: "ref" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  let items1: QuoteValue[] = [];
  for (const x1 of n.args) {
    items1.push({ kind: "node", of: "typeNode", fields: fieldsOfTypeNode(x1) });
  }
  out.push({ name: "args", value: { kind: "list", items: items1 } });
  return out;
}

function fieldsOfTypeNode_literal(n: Ref<Extract<TypeNode, { kind: "literal" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "value", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.value) } });
  return out;
}

function fieldsOfTypeNode_array(n: Ref<Extract<TypeNode, { kind: "array" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "element", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.element) } });
  return out;
}

function fieldsOfTypeNode_tuple(n: Ref<Extract<TypeNode, { kind: "tuple" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items2: QuoteValue[] = [];
  for (const x2 of n.elements) {
    items2.push({ kind: "node", of: "tupleElement", fields: fieldsOfTupleElement(x2) });
  }
  out.push({ name: "elements", value: { kind: "list", items: items2 } });
  return out;
}

function fieldsOfTypeNode_object(n: Ref<Extract<TypeNode, { kind: "object" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items3: QuoteValue[] = [];
  for (const x3 of n.members) {
    items3.push({ kind: "node", of: "typeMember", fields: fieldsOfTypeMember(x3) });
  }
  out.push({ name: "members", value: { kind: "list", items: items3 } });
  return out;
}

function fieldsOfTypeNode_function(n: Ref<Extract<TypeNode, { kind: "function" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items4: QuoteValue[] = [];
  for (const x4 of n.typeParams) {
    items4.push({ kind: "node", of: "typeParam", fields: fieldsOfTypeParam(x4) });
  }
  out.push({ name: "typeParams", value: { kind: "list", items: items4 } });
  let items5: QuoteValue[] = [];
  for (const x5 of n.params) {
    items5.push({ kind: "node", of: "param", fields: fieldsOfParam(x5) });
  }
  out.push({ name: "params", value: { kind: "list", items: items5 } });
  out.push({ name: "returns", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.returns) } });
  if (n.throws !== undefined) {
    out.push({ name: "throws", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.throws) } });
  }
  out.push({ name: "construct", value: { kind: "boolean", value: n.construct } });
  out.push({ name: "abstract", value: { kind: "boolean", value: n.abstract } });
  return out;
}

function fieldsOfTypeNode_union(n: Ref<Extract<TypeNode, { kind: "union" | "intersection" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items6: QuoteValue[] = [];
  for (const x6 of n.types) {
    items6.push({ kind: "node", of: "typeNode", fields: fieldsOfTypeNode(x6) });
  }
  out.push({ name: "types", value: { kind: "list", items: items6 } });
  return out;
}

function fieldsOfTypeNode_intersection(n: Ref<Extract<TypeNode, { kind: "union" | "intersection" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items7: QuoteValue[] = [];
  for (const x7 of n.types) {
    items7.push({ kind: "node", of: "typeNode", fields: fieldsOfTypeNode(x7) });
  }
  out.push({ name: "types", value: { kind: "list", items: items7 } });
  return out;
}

function fieldsOfTypeNode_operator(n: Ref<Extract<TypeNode, { kind: "operator" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "op", value: { kind: "text", value: n.op } });
  out.push({ name: "type", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.type) } });
  return out;
}

function fieldsOfTypeNode_indexed(n: Ref<Extract<TypeNode, { kind: "indexed" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "object", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.object) } });
  out.push({ name: "index", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.index) } });
  return out;
}

function fieldsOfTypeNode_query(n: Ref<Extract<TypeNode, { kind: "query" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "target", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.target) } });
  return out;
}

function fieldsOfTypeNode_import(n: Ref<Extract<TypeNode, { kind: "import" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "module", value: { kind: "text", value: n.module } });
  if (n.name === undefined) out.push({ name: "name", value: { kind: "none" } });
  else {
    out.push({ name: "name", value: { kind: "text", value: n.name } });
  }
  let items8: QuoteValue[] = [];
  for (const x8 of n.args) {
    items8.push({ kind: "node", of: "typeNode", fields: fieldsOfTypeNode(x8) });
  }
  out.push({ name: "args", value: { kind: "list", items: items8 } });
  return out;
}

function fieldsOfTypeNode_conditional(n: Ref<Extract<TypeNode, { kind: "conditional" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "check", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.check) } });
  out.push({ name: "extends", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.extends) } });
  out.push({ name: "then", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.then) } });
  out.push({ name: "else", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.else) } });
  return out;
}

function fieldsOfTypeNode_infer(n: Ref<Extract<TypeNode, { kind: "infer" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  if (n.constraint === undefined) out.push({ name: "constraint", value: { kind: "none" } });
  else {
    out.push({ name: "constraint", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.constraint) } });
  }
  return out;
}

function fieldsOfTypeNode_template(n: Ref<Extract<TypeNode, { kind: "template" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items9: QuoteValue[] = [];
  for (const x9 of n.quasis) {
    items9.push({ kind: "text", value: x9 });
  }
  out.push({ name: "quasis", value: { kind: "list", items: items9 } });
  let items10: QuoteValue[] = [];
  for (const x10 of n.types) {
    items10.push({ kind: "node", of: "typeNode", fields: fieldsOfTypeNode(x10) });
  }
  out.push({ name: "types", value: { kind: "list", items: items10 } });
  return out;
}

function fieldsOfTypeNode_mapped(n: Ref<Extract<TypeNode, { kind: "mapped" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  out.push({ name: "constraint", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.constraint) } });
  if (n.as === undefined) out.push({ name: "as", value: { kind: "none" } });
  else {
    out.push({ name: "as", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.as) } });
  }
  if (n.type === undefined) out.push({ name: "type", value: { kind: "none" } });
  else {
    out.push({ name: "type", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.type) } });
  }
  if (n.readonly === undefined) out.push({ name: "readonly", value: { kind: "none" } });
  else {
    out.push({ name: "readonly", value: { kind: "text", value: n.readonly } });
  }
  if (n.optional === undefined) out.push({ name: "optional", value: { kind: "none" } });
  else {
    out.push({ name: "optional", value: { kind: "text", value: n.optional } });
  }
  return out;
}

function fieldsOfTypeNode_predicate(n: Ref<Extract<TypeNode, { kind: "predicate" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "asserts", value: { kind: "boolean", value: n.asserts } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  if (n.type === undefined) out.push({ name: "type", value: { kind: "none" } });
  else {
    out.push({ name: "type", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.type) } });
  }
  return out;
}

function fieldsOfExpr_int(n: Ref<Extract<Expr, { kind: "int" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "value", value: { kind: "bigint", value: n.value } });
  return out;
}

function fieldsOfExpr_float(n: Ref<Extract<Expr, { kind: "float" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "value", value: { kind: "float", value: n.value } });
  return out;
}

function fieldsOfExpr_bigint(n: Ref<Extract<Expr, { kind: "bigint" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "value", value: { kind: "bigint", value: n.value } });
  return out;
}

function fieldsOfExpr_null(n: Ref<Extract<Expr, { kind: "null" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  return out;
}

function fieldsOfExpr_this(n: Ref<Extract<Expr, { kind: "this" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  return out;
}

function fieldsOfExpr_super(n: Ref<Extract<Expr, { kind: "super" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  return out;
}

function fieldsOfExpr_regex(n: Ref<Extract<Expr, { kind: "regex" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "pattern", value: { kind: "text", value: n.pattern } });
  out.push({ name: "flags", value: { kind: "text", value: n.flags } });
  return out;
}

function fieldsOfExpr_template(n: Ref<Extract<Expr, { kind: "template" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items11: QuoteValue[] = [];
  for (const x11 of n.quasis) {
    items11.push({ kind: "text", value: x11 });
  }
  out.push({ name: "quasis", value: { kind: "list", items: items11 } });
  let items12: QuoteValue[] = [];
  for (const x12 of n.raw) {
    items12.push({ kind: "text", value: x12 });
  }
  out.push({ name: "raw", value: { kind: "list", items: items12 } });
  let items13: QuoteValue[] = [];
  for (const x13 of n.exprs) {
    items13.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x13) });
  }
  out.push({ name: "exprs", value: { kind: "list", items: items13 } });
  return out;
}

function fieldsOfExpr_tagged(n: Ref<Extract<Expr, { kind: "tagged" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "tag", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.tag) } });
  let items14: QuoteValue[] = [];
  for (const x14 of n.typeArgs) {
    items14.push({ kind: "node", of: "typeNode", fields: fieldsOfTypeNode(x14) });
  }
  out.push({ name: "typeArgs", value: { kind: "list", items: items14 } });
  out.push({ name: "template", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.template) } });
  return out;
}

function fieldsOfExpr_bool(n: Ref<Extract<Expr, { kind: "bool" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "value", value: { kind: "boolean", value: n.value } });
  return out;
}

function fieldsOfExpr_string(n: Ref<Extract<Expr, { kind: "string" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "value", value: { kind: "text", value: n.value } });
  return out;
}

function fieldsOfExpr_ident(n: Ref<Extract<Expr, { kind: "ident" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  return out;
}

function fieldsOfExpr_spread(n: Ref<Extract<Expr, { kind: "spread" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "value", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.value) } });
  return out;
}

function fieldsOfExpr_array(n: Ref<Extract<Expr, { kind: "array" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items15: QuoteValue[] = [];
  for (const x15 of n.elements) {
    if (x15 === undefined) items15.push({ kind: "none" });
    else {
      items15.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x15) });
    }
  }
  out.push({ name: "elements", value: { kind: "list", items: items15 } });
  return out;
}

function fieldsOfExpr_object(n: Ref<Extract<Expr, { kind: "object" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items16: QuoteValue[] = [];
  for (const x16 of n.props) {
    items16.push({ kind: "node", of: "objectProp", fields: fieldsOfObjectProp(x16) });
  }
  out.push({ name: "props", value: { kind: "list", items: items16 } });
  return out;
}

function fieldsOfExpr_function(n: Ref<Extract<Expr, { kind: "function" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  if (n.name === undefined) out.push({ name: "name", value: { kind: "none" } });
  else {
    out.push({ name: "name", value: { kind: "text", value: n.name } });
  }
  out.push({ name: "async", value: { kind: "boolean", value: n.async } });
  out.push({ name: "generator", value: { kind: "boolean", value: n.generator } });
  let items17: QuoteValue[] = [];
  for (const x17 of n.typeParams) {
    items17.push({ kind: "node", of: "typeParam", fields: fieldsOfTypeParam(x17) });
  }
  out.push({ name: "typeParams", value: { kind: "list", items: items17 } });
  let items18: QuoteValue[] = [];
  for (const x18 of n.params) {
    items18.push({ kind: "node", of: "param", fields: fieldsOfParam(x18) });
  }
  out.push({ name: "params", value: { kind: "list", items: items18 } });
  if (n.returnType === undefined) out.push({ name: "returnType", value: { kind: "none" } });
  else {
    out.push({ name: "returnType", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.returnType) } });
  }
  let items19: QuoteValue[] = [];
  for (const x19 of n.body) {
    items19.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x19) });
  }
  out.push({ name: "body", value: { kind: "list", items: items19 } });
  return out;
}

function fieldsOfExpr_arrow(n: Ref<Extract<Expr, { kind: "arrow" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "move", value: { kind: "boolean", value: n.move } });
  out.push({ name: "async", value: { kind: "boolean", value: n.async } });
  let items20: QuoteValue[] = [];
  for (const x20 of n.typeParams) {
    items20.push({ kind: "node", of: "typeParam", fields: fieldsOfTypeParam(x20) });
  }
  out.push({ name: "typeParams", value: { kind: "list", items: items20 } });
  let items21: QuoteValue[] = [];
  for (const x21 of n.params) {
    items21.push({ kind: "node", of: "param", fields: fieldsOfParam(x21) });
  }
  out.push({ name: "params", value: { kind: "list", items: items21 } });
  if (n.returnType === undefined) out.push({ name: "returnType", value: { kind: "none" } });
  else {
    out.push({ name: "returnType", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.returnType) } });
  }
  if (n.throws !== undefined) {
    out.push({ name: "throws", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.throws) } });
  }
  out.push({ name: "body", value: oneOf0(n.body) });
  return out;
}

function fieldsOfExpr_member(n: Ref<Extract<Expr, { kind: "member" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "object", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.object) } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  out.push({ name: "optional", value: { kind: "boolean", value: n.optional } });
  return out;
}

function fieldsOfExpr_index(n: Ref<Extract<Expr, { kind: "index" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "object", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.object) } });
  out.push({ name: "index", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.index) } });
  out.push({ name: "optional", value: { kind: "boolean", value: n.optional } });
  return out;
}

function fieldsOfExpr_call(n: Ref<Extract<Expr, { kind: "call" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "callee", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.callee) } });
  let items23: QuoteValue[] = [];
  for (const x23 of n.typeArgs) {
    items23.push({ kind: "node", of: "typeNode", fields: fieldsOfTypeNode(x23) });
  }
  out.push({ name: "typeArgs", value: { kind: "list", items: items23 } });
  let items24: QuoteValue[] = [];
  for (const x24 of n.args) {
    items24.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x24) });
  }
  out.push({ name: "args", value: { kind: "list", items: items24 } });
  out.push({ name: "optional", value: { kind: "boolean", value: n.optional } });
  if (n.implementation !== undefined) {
    out.push({ name: "implementation", value: { kind: "boolean", value: n.implementation } });
  }
  if (n.shown !== undefined) {
    out.push({ name: "shown", value: { kind: "text", value: n.shown } });
  }
  return out;
}

function fieldsOfExpr_new(n: Ref<Extract<Expr, { kind: "new" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "callee", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.callee) } });
  let items25: QuoteValue[] = [];
  for (const x25 of n.typeArgs) {
    items25.push({ kind: "node", of: "typeNode", fields: fieldsOfTypeNode(x25) });
  }
  out.push({ name: "typeArgs", value: { kind: "list", items: items25 } });
  if (n.args === undefined) out.push({ name: "args", value: { kind: "none" } });
  else {
    let items26: QuoteValue[] = [];
    for (const x26 of n.args) {
      items26.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x26) });
    }
    out.push({ name: "args", value: { kind: "list", items: items26 } });
  }
  return out;
}

function fieldsOfExpr_instantiation(n: Ref<Extract<Expr, { kind: "instantiation" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "expr", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.expr) } });
  let items27: QuoteValue[] = [];
  for (const x27 of n.typeArgs) {
    items27.push({ kind: "node", of: "typeNode", fields: fieldsOfTypeNode(x27) });
  }
  out.push({ name: "typeArgs", value: { kind: "list", items: items27 } });
  return out;
}

function fieldsOfExpr_meta(n: Ref<Extract<Expr, { kind: "meta" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  return out;
}

function fieldsOfExpr_import(n: Ref<Extract<Expr, { kind: "import" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items28: QuoteValue[] = [];
  for (const x28 of n.args) {
    items28.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x28) });
  }
  out.push({ name: "args", value: { kind: "list", items: items28 } });
  return out;
}

function fieldsOfExpr_nonNull(n: Ref<Extract<Expr, { kind: "nonNull" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "expr", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.expr) } });
  if (n.narrows !== undefined) {
    out.push({ name: "narrows", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.narrows) } });
  }
  if (n.reason !== undefined) {
    out.push({ name: "reason", value: { kind: "text", value: n.reason } });
  }
  if (n.redundant !== undefined) {
    out.push({ name: "redundant", value: { kind: "boolean", value: n.redundant } });
  }
  return out;
}

function fieldsOfExpr_throw(n: Ref<Extract<Expr, { kind: "throw" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "value", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.value) } });
  return out;
}

function fieldsOfExpr_class(n: Ref<Extract<Expr, { kind: "class" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  if (n.name === undefined) out.push({ name: "name", value: { kind: "none" } });
  else {
    out.push({ name: "name", value: { kind: "text", value: n.name } });
  }
  out.push({ name: "abstract", value: { kind: "boolean", value: n.abstract } });
  let items29: QuoteValue[] = [];
  for (const x29 of n.decorators) {
    items29.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x29) });
  }
  out.push({ name: "decorators", value: { kind: "list", items: items29 } });
  let items30: QuoteValue[] = [];
  for (const x30 of n.typeParams) {
    items30.push({ kind: "node", of: "typeParam", fields: fieldsOfTypeParam(x30) });
  }
  out.push({ name: "typeParams", value: { kind: "list", items: items30 } });
  if (n.extends === undefined) out.push({ name: "extends", value: { kind: "none" } });
  else {
    out.push({ name: "extends", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.extends) } });
  }
  let items31: QuoteValue[] = [];
  for (const x31 of n.implements) {
    items31.push({ kind: "node", of: "typeNode", fields: fieldsOfTypeNode(x31) });
  }
  out.push({ name: "implements", value: { kind: "list", items: items31 } });
  let items32: QuoteValue[] = [];
  for (const x32 of n.members) {
    items32.push({ kind: "node", of: "classMember", fields: fieldsOfClassMember(x32) });
  }
  out.push({ name: "members", value: { kind: "list", items: items32 } });
  if (n.derives !== undefined) {
    let items33: QuoteValue[] = [];
    for (const x33 of n.derives) {
      items33.push({ kind: "text", value: x33 });
    }
    out.push({ name: "derives", value: { kind: "list", items: items33 } });
  }
  return out;
}

function fieldsOfExpr_privateName(n: Ref<Extract<Expr, { kind: "privateName" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  return out;
}

function fieldsOfExpr_unary(n: Ref<Extract<Expr, { kind: "unary" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "op", value: { kind: "text", value: n.op } });
  out.push({ name: "operand", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.operand) } });
  return out;
}

function fieldsOfExpr_update(n: Ref<Extract<Expr, { kind: "update" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "op", value: { kind: "text", value: n.op } });
  out.push({ name: "prefix", value: { kind: "boolean", value: n.prefix } });
  out.push({ name: "operand", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.operand) } });
  return out;
}

function fieldsOfExpr_binary(n: Ref<Extract<Expr, { kind: "binary" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "op", value: { kind: "text", value: n.op } });
  out.push({ name: "left", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.left) } });
  out.push({ name: "right", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.right) } });
  return out;
}

function fieldsOfExpr_conditional(n: Ref<Extract<Expr, { kind: "conditional" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "cond", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.cond) } });
  out.push({ name: "then", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.then) } });
  out.push({ name: "else", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.else) } });
  return out;
}

function fieldsOfExpr_assign(n: Ref<Extract<Expr, { kind: "assign" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "op", value: { kind: "text", value: n.op } });
  out.push({ name: "target", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.target) } });
  out.push({ name: "value", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.value) } });
  return out;
}

function fieldsOfExpr_pipe(n: Ref<Extract<Expr, { kind: "pipe" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "value", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.value) } });
  out.push({ name: "body", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.body) } });
  return out;
}

function fieldsOfExpr_topic(n: Ref<Extract<Expr, { kind: "topic" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  return out;
}

function fieldsOfExpr_match(n: Ref<Extract<Expr, { kind: "match" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "subject", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.subject) } });
  let items34: QuoteValue[] = [];
  for (const x34 of n.arms) {
    items34.push({ kind: "node", of: "matchArm", fields: fieldsOfMatchArm(x34) });
  }
  out.push({ name: "arms", value: { kind: "list", items: items34 } });
  return out;
}

function fieldsOfExpr_comptime(n: Ref<Extract<Expr, { kind: "comptime" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "expr", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.expr) } });
  return out;
}

function fieldsOfExpr_unsafe(n: Ref<Extract<Expr, { kind: "unsafe" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "expr", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.expr) } });
  return out;
}

function fieldsOfExpr_destructure(n: Ref<Extract<Expr, { kind: "destructure" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "pattern", value: { kind: "node", of: "pattern", fields: fieldsOfPattern(n.pattern) } });
  out.push({ name: "value", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.value) } });
  return out;
}

function fieldsOfExpr_sequence(n: Ref<Extract<Expr, { kind: "sequence" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items35: QuoteValue[] = [];
  for (const x35 of n.exprs) {
    items35.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x35) });
  }
  out.push({ name: "exprs", value: { kind: "list", items: items35 } });
  return out;
}

function fieldsOfExpr_yield(n: Ref<Extract<Expr, { kind: "yield" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  if (n.value === undefined) out.push({ name: "value", value: { kind: "none" } });
  else {
    out.push({ name: "value", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.value) } });
  }
  out.push({ name: "delegate", value: { kind: "boolean", value: n.delegate } });
  return out;
}

function fieldsOfExpr_as(n: Ref<Extract<Expr, { kind: "as" | "satisfies" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "expr", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.expr) } });
  out.push({ name: "type", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.type) } });
  return out;
}

function fieldsOfExpr_satisfies(n: Ref<Extract<Expr, { kind: "as" | "satisfies" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "expr", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.expr) } });
  out.push({ name: "type", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.type) } });
  return out;
}

function fieldsOfExpr_assertion(n: Ref<Extract<Expr, { kind: "assertion" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "type", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.type) } });
  out.push({ name: "expr", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.expr) } });
  return out;
}

function fieldsOfStmt_expr(n: Ref<Extract<Stmt, { kind: "expr" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "expr", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.expr) } });
  return out;
}

function fieldsOfStmt_let(n: Ref<Extract<Stmt, { kind: "let" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "keyword", value: { kind: "text", value: n.keyword } });
  let items36: QuoteValue[] = [];
  for (const x36 of n.declarations) {
    items36.push({ kind: "node", of: "declarator", fields: fieldsOfDeclarator(x36) });
  }
  out.push({ name: "declarations", value: { kind: "list", items: items36 } });
  return out;
}

function fieldsOfStmt_return(n: Ref<Extract<Stmt, { kind: "return" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  if (n.value === undefined) out.push({ name: "value", value: { kind: "none" } });
  else {
    out.push({ name: "value", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.value) } });
  }
  return out;
}

function fieldsOfStmt_if(n: Ref<Extract<Stmt, { kind: "if" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "cond", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.cond) } });
  let items37: QuoteValue[] = [];
  for (const x37 of n.then) {
    items37.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x37) });
  }
  out.push({ name: "then", value: { kind: "list", items: items37 } });
  if (n.else === undefined) out.push({ name: "else", value: { kind: "none" } });
  else {
    let items38: QuoteValue[] = [];
    for (const x38 of n.else) {
      items38.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x38) });
    }
    out.push({ name: "else", value: { kind: "list", items: items38 } });
  }
  return out;
}

function fieldsOfStmt_while(n: Ref<Extract<Stmt, { kind: "while" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "cond", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.cond) } });
  let items39: QuoteValue[] = [];
  for (const x39 of n.body) {
    items39.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x39) });
  }
  out.push({ name: "body", value: { kind: "list", items: items39 } });
  return out;
}

function fieldsOfStmt_doWhile(n: Ref<Extract<Stmt, { kind: "doWhile" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items40: QuoteValue[] = [];
  for (const x40 of n.body) {
    items40.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x40) });
  }
  out.push({ name: "body", value: { kind: "list", items: items40 } });
  out.push({ name: "cond", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.cond) } });
  return out;
}

function fieldsOfStmt_switch(n: Ref<Extract<Stmt, { kind: "switch" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "discriminant", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.discriminant) } });
  let items41: QuoteValue[] = [];
  for (const x41 of n.cases) {
    items41.push({ kind: "node", of: "switchCase", fields: fieldsOfSwitchCase(x41) });
  }
  out.push({ name: "cases", value: { kind: "list", items: items41 } });
  return out;
}

function fieldsOfStmt_labeled(n: Ref<Extract<Stmt, { kind: "labeled" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "label", value: { kind: "text", value: n.label } });
  out.push({ name: "body", value: { kind: "node", of: "stmt", fields: fieldsOfStmt(n.body) } });
  return out;
}

function fieldsOfStmt_break(n: Ref<Extract<Stmt, { kind: "break" | "continue" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  if (n.label === undefined) out.push({ name: "label", value: { kind: "none" } });
  else {
    out.push({ name: "label", value: { kind: "text", value: n.label } });
  }
  return out;
}

function fieldsOfStmt_continue(n: Ref<Extract<Stmt, { kind: "break" | "continue" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  if (n.label === undefined) out.push({ name: "label", value: { kind: "none" } });
  else {
    out.push({ name: "label", value: { kind: "text", value: n.label } });
  }
  return out;
}

function fieldsOfStmt_throw(n: Ref<Extract<Stmt, { kind: "throw" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "value", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.value) } });
  return out;
}

function fieldsOfStmt_try(n: Ref<Extract<Stmt, { kind: "try" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items42: QuoteValue[] = [];
  for (const x42 of n.block) {
    items42.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x42) });
  }
  out.push({ name: "block", value: { kind: "list", items: items42 } });
  if (n.param === undefined) out.push({ name: "param", value: { kind: "none" } });
  else {
    out.push({ name: "param", value: { kind: "node", of: "pattern", fields: fieldsOfPattern(n.param) } });
  }
  if (n.paramType === undefined) out.push({ name: "paramType", value: { kind: "none" } });
  else {
    out.push({ name: "paramType", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.paramType) } });
  }
  if (n.handler === undefined) out.push({ name: "handler", value: { kind: "none" } });
  else {
    let items43: QuoteValue[] = [];
    for (const x43 of n.handler) {
      items43.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x43) });
    }
    out.push({ name: "handler", value: { kind: "list", items: items43 } });
  }
  if (n.finalizer === undefined) out.push({ name: "finalizer", value: { kind: "none" } });
  else {
    let items44: QuoteValue[] = [];
    for (const x44 of n.finalizer) {
      items44.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x44) });
    }
    out.push({ name: "finalizer", value: { kind: "list", items: items44 } });
  }
  return out;
}

function fieldsOfStmt_for(n: Ref<Extract<Stmt, { kind: "for" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  if (n.init === undefined) out.push({ name: "init", value: { kind: "none" } });
  else {
    out.push({ name: "init", value: { kind: "node", of: "stmt", fields: fieldsOfStmt(n.init) } });
  }
  if (n.test === undefined) out.push({ name: "test", value: { kind: "none" } });
  else {
    out.push({ name: "test", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.test) } });
  }
  if (n.update === undefined) out.push({ name: "update", value: { kind: "none" } });
  else {
    out.push({ name: "update", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.update) } });
  }
  let items45: QuoteValue[] = [];
  for (const x45 of n.body) {
    items45.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x45) });
  }
  out.push({ name: "body", value: { kind: "list", items: items45 } });
  return out;
}

function fieldsOfStmt_forIn(n: Ref<Extract<Stmt, { kind: "forIn" | "forOf" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "await", value: { kind: "boolean", value: n.await } });
  out.push({ name: "left", value: oneOf1(n.left) });
  out.push({ name: "right", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.right) } });
  let items46: QuoteValue[] = [];
  for (const x46 of n.body) {
    items46.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x46) });
  }
  out.push({ name: "body", value: { kind: "list", items: items46 } });
  return out;
}

function fieldsOfStmt_forOf(n: Ref<Extract<Stmt, { kind: "forIn" | "forOf" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "await", value: { kind: "boolean", value: n.await } });
  out.push({ name: "left", value: oneOf1(n.left) });
  out.push({ name: "right", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.right) } });
  let items47: QuoteValue[] = [];
  for (const x47 of n.body) {
    items47.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x47) });
  }
  out.push({ name: "body", value: { kind: "list", items: items47 } });
  return out;
}

function fieldsOfStmt_block(n: Ref<Extract<Stmt, { kind: "block" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items48: QuoteValue[] = [];
  for (const x48 of n.body) {
    items48.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x48) });
  }
  out.push({ name: "body", value: { kind: "list", items: items48 } });
  return out;
}

function fieldsOfStmt_empty(n: Ref<Extract<Stmt, { kind: "empty" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  return out;
}

function fieldsOfStmt_debugger(n: Ref<Extract<Stmt, { kind: "debugger" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  return out;
}

function fieldsOfStmt_enum(n: Ref<Extract<Stmt, { kind: "enum" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  out.push({ name: "const", value: { kind: "boolean", value: n.const } });
  let items49: QuoteValue[] = [];
  for (const x49 of n.typeParams) {
    items49.push({ kind: "node", of: "typeParam", fields: fieldsOfTypeParam(x49) });
  }
  out.push({ name: "typeParams", value: { kind: "list", items: items49 } });
  let items50: QuoteValue[] = [];
  for (const x50 of n.members) {
    items50.push({ kind: "node", of: "enumMember", fields: fieldsOfEnumMember(x50) });
  }
  out.push({ name: "members", value: { kind: "list", items: items50 } });
  if (n.decorators !== undefined) {
    let items51: QuoteValue[] = [];
    for (const x51 of n.decorators) {
      items51.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x51) });
    }
    out.push({ name: "decorators", value: { kind: "list", items: items51 } });
  }
  if (n.derives !== undefined) {
    let items52: QuoteValue[] = [];
    for (const x52 of n.derives) {
      items52.push({ kind: "text", value: x52 });
    }
    out.push({ name: "derives", value: { kind: "list", items: items52 } });
  }
  return out;
}

function fieldsOfStmt_namespace(n: Ref<Extract<Stmt, { kind: "namespace" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  out.push({ name: "quoted", value: { kind: "boolean", value: n.quoted } });
  out.push({ name: "global", value: { kind: "boolean", value: n.global } });
  if (n.body === undefined) out.push({ name: "body", value: { kind: "none" } });
  else {
    let items53: QuoteValue[] = [];
    for (const x53 of n.body) {
      items53.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x53) });
    }
    out.push({ name: "body", value: { kind: "list", items: items53 } });
  }
  return out;
}

function fieldsOfStmt_declare(n: Ref<Extract<Stmt, { kind: "declare" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "body", value: { kind: "node", of: "stmt", fields: fieldsOfStmt(n.body) } });
  return out;
}

function fieldsOfStmt_comptime(n: Ref<Extract<Stmt, { kind: "comptime" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items54: QuoteValue[] = [];
  for (const x54 of n.body) {
    items54.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x54) });
  }
  out.push({ name: "body", value: { kind: "list", items: items54 } });
  return out;
}

function fieldsOfStmt_unsafe(n: Ref<Extract<Stmt, { kind: "unsafe" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items55: QuoteValue[] = [];
  for (const x55 of n.body) {
    items55.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x55) });
  }
  out.push({ name: "body", value: { kind: "list", items: items55 } });
  return out;
}

function fieldsOfStmt_import(n: Ref<Extract<Stmt, { kind: "import" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "typeOnly", value: { kind: "boolean", value: n.typeOnly } });
  out.push({ name: "defer", value: { kind: "boolean", value: n.defer } });
  if (n.default === undefined) out.push({ name: "default", value: { kind: "none" } });
  else {
    out.push({ name: "default", value: { kind: "text", value: n.default } });
  }
  if (n.namespace === undefined) out.push({ name: "namespace", value: { kind: "none" } });
  else {
    out.push({ name: "namespace", value: { kind: "text", value: n.namespace } });
  }
  if (n.named === undefined) out.push({ name: "named", value: { kind: "none" } });
  else {
    let items56: QuoteValue[] = [];
    for (const x56 of n.named) {
      items56.push({ kind: "node", of: "specifier", fields: fieldsOfSpecifier(x56) });
    }
    out.push({ name: "named", value: { kind: "list", items: items56 } });
  }
  out.push({ name: "module", value: { kind: "text", value: n.module } });
  if (n.attributes === undefined) out.push({ name: "attributes", value: { kind: "none" } });
  else {
    out.push({ name: "attributes", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.attributes) } });
  }
  return out;
}

function fieldsOfStmt_importEquals(n: Ref<Extract<Stmt, { kind: "importEquals" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "typeOnly", value: { kind: "boolean", value: n.typeOnly } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  if (n.require === undefined) out.push({ name: "require", value: { kind: "none" } });
  else {
    out.push({ name: "require", value: { kind: "text", value: n.require } });
  }
  if (n.entity === undefined) out.push({ name: "entity", value: { kind: "none" } });
  else {
    out.push({ name: "entity", value: { kind: "text", value: n.entity } });
  }
  return out;
}

function fieldsOfStmt_export(n: Ref<Extract<Stmt, { kind: "export" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "body", value: { kind: "node", of: "stmt", fields: fieldsOfStmt(n.body) } });
  return out;
}

function fieldsOfStmt_exportDefault(n: Ref<Extract<Stmt, { kind: "exportDefault" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  if (n.declaration === undefined) out.push({ name: "declaration", value: { kind: "none" } });
  else {
    out.push({ name: "declaration", value: { kind: "node", of: "stmt", fields: fieldsOfStmt(n.declaration) } });
  }
  if (n.value === undefined) out.push({ name: "value", value: { kind: "none" } });
  else {
    out.push({ name: "value", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.value) } });
  }
  return out;
}

function fieldsOfStmt_exportNamed(n: Ref<Extract<Stmt, { kind: "exportNamed" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "typeOnly", value: { kind: "boolean", value: n.typeOnly } });
  let items57: QuoteValue[] = [];
  for (const x57 of n.specifiers) {
    items57.push({ kind: "node", of: "specifier", fields: fieldsOfSpecifier(x57) });
  }
  out.push({ name: "specifiers", value: { kind: "list", items: items57 } });
  if (n.module === undefined) out.push({ name: "module", value: { kind: "none" } });
  else {
    out.push({ name: "module", value: { kind: "text", value: n.module } });
  }
  return out;
}

function fieldsOfStmt_exportAll(n: Ref<Extract<Stmt, { kind: "exportAll" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "typeOnly", value: { kind: "boolean", value: n.typeOnly } });
  if (n.alias === undefined) out.push({ name: "alias", value: { kind: "none" } });
  else {
    out.push({ name: "alias", value: { kind: "text", value: n.alias } });
  }
  out.push({ name: "module", value: { kind: "text", value: n.module } });
  return out;
}

function fieldsOfStmt_exportAssign(n: Ref<Extract<Stmt, { kind: "exportAssign" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "value", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.value) } });
  return out;
}

function fieldsOfStmt_exportAsNamespace(n: Ref<Extract<Stmt, { kind: "exportAsNamespace" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  return out;
}

function fieldsOfTypeAlias_typeAlias(n: Ref<Extract<TypeAlias, { kind: "typeAlias" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  let items58: QuoteValue[] = [];
  for (const x58 of n.typeParams) {
    items58.push({ kind: "node", of: "typeParam", fields: fieldsOfTypeParam(x58) });
  }
  out.push({ name: "typeParams", value: { kind: "list", items: items58 } });
  out.push({ name: "type", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.type) } });
  if (n.decorators !== undefined) {
    let items59: QuoteValue[] = [];
    for (const x59 of n.decorators) {
      items59.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x59) });
    }
    out.push({ name: "decorators", value: { kind: "list", items: items59 } });
  }
  if (n.js !== undefined) {
    out.push({ name: "js", value: { kind: "node", of: "jsName", fields: fieldsOfJsName(n.js) } });
  }
  if (n.shown !== undefined) {
    out.push({ name: "shown", value: { kind: "text", value: n.shown } });
  }
  return out;
}

function fieldsOfInterface_interface(n: Ref<Extract<Interface, { kind: "interface" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  let items60: QuoteValue[] = [];
  for (const x60 of n.typeParams) {
    items60.push({ kind: "node", of: "typeParam", fields: fieldsOfTypeParam(x60) });
  }
  out.push({ name: "typeParams", value: { kind: "list", items: items60 } });
  let items61: QuoteValue[] = [];
  for (const x61 of n.extends) {
    items61.push({ kind: "node", of: "typeNode", fields: fieldsOfTypeNode(x61) });
  }
  out.push({ name: "extends", value: { kind: "list", items: items61 } });
  let items62: QuoteValue[] = [];
  for (const x62 of n.members) {
    items62.push({ kind: "node", of: "typeMember", fields: fieldsOfTypeMember(x62) });
  }
  out.push({ name: "members", value: { kind: "list", items: items62 } });
  if (n.decorators !== undefined) {
    let items63: QuoteValue[] = [];
    for (const x63 of n.decorators) {
      items63.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x63) });
    }
    out.push({ name: "decorators", value: { kind: "list", items: items63 } });
  }
  if (n.js !== undefined) {
    out.push({ name: "js", value: { kind: "node", of: "jsName", fields: fieldsOfJsName(n.js) } });
  }
  if (n.jsClass !== undefined) {
    out.push({ name: "jsClass", value: recordOf2(n.jsClass) });
  }
  if (n.jsSource !== undefined) {
    out.push({ name: "jsSource", value: { kind: "node", of: "stmt", fields: fieldsOfStmt(n.jsSource) } });
  }
  return out;
}

function fieldsOfFunc_function(n: Ref<Extract<Func, { kind: "function" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  out.push({ name: "async", value: { kind: "boolean", value: n.async } });
  out.push({ name: "generator", value: { kind: "boolean", value: n.generator } });
  out.push({ name: "macro", value: { kind: "boolean", value: n.macro } });
  let items67: QuoteValue[] = [];
  for (const x67 of n.typeParams) {
    items67.push({ kind: "node", of: "typeParam", fields: fieldsOfTypeParam(x67) });
  }
  out.push({ name: "typeParams", value: { kind: "list", items: items67 } });
  let items68: QuoteValue[] = [];
  for (const x68 of n.params) {
    items68.push({ kind: "node", of: "param", fields: fieldsOfParam(x68) });
  }
  out.push({ name: "params", value: { kind: "list", items: items68 } });
  if (n.returnType === undefined) out.push({ name: "returnType", value: { kind: "none" } });
  else {
    out.push({ name: "returnType", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.returnType) } });
  }
  if (n.throws !== undefined) {
    out.push({ name: "throws", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.throws) } });
  }
  if (n.body === undefined) out.push({ name: "body", value: { kind: "none" } });
  else {
    let items69: QuoteValue[] = [];
    for (const x69 of n.body) {
      items69.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x69) });
    }
    out.push({ name: "body", value: { kind: "list", items: items69 } });
  }
  if (n.decorators !== undefined) {
    let items70: QuoteValue[] = [];
    for (const x70 of n.decorators) {
      items70.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x70) });
    }
    out.push({ name: "decorators", value: { kind: "list", items: items70 } });
  }
  if (n.js !== undefined) {
    out.push({ name: "js", value: { kind: "node", of: "jsName", fields: fieldsOfJsName(n.js) } });
  }
  if (n.overloadNames !== undefined) {
    let items71: QuoteValue[] = [];
    for (const x71 of n.overloadNames) {
      items71.push({ kind: "text", value: x71 });
    }
    out.push({ name: "overloadNames", value: { kind: "list", items: items71 } });
  }
  if (n.signature !== undefined) {
    out.push({ name: "signature", value: { kind: "boolean", value: n.signature } });
  }
  return out;
}

function fieldsOfStmt_class(n: Ref<Extract<Stmt, { kind: "class" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  if (n.name === undefined) out.push({ name: "name", value: { kind: "none" } });
  else {
    out.push({ name: "name", value: { kind: "text", value: n.name } });
  }
  out.push({ name: "abstract", value: { kind: "boolean", value: n.abstract } });
  let items72: QuoteValue[] = [];
  for (const x72 of n.decorators) {
    items72.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x72) });
  }
  out.push({ name: "decorators", value: { kind: "list", items: items72 } });
  let items73: QuoteValue[] = [];
  for (const x73 of n.typeParams) {
    items73.push({ kind: "node", of: "typeParam", fields: fieldsOfTypeParam(x73) });
  }
  out.push({ name: "typeParams", value: { kind: "list", items: items73 } });
  if (n.extends === undefined) out.push({ name: "extends", value: { kind: "none" } });
  else {
    out.push({ name: "extends", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.extends) } });
  }
  let items74: QuoteValue[] = [];
  for (const x74 of n.implements) {
    items74.push({ kind: "node", of: "typeNode", fields: fieldsOfTypeNode(x74) });
  }
  out.push({ name: "implements", value: { kind: "list", items: items74 } });
  let items75: QuoteValue[] = [];
  for (const x75 of n.members) {
    items75.push({ kind: "node", of: "classMember", fields: fieldsOfClassMember(x75) });
  }
  out.push({ name: "members", value: { kind: "list", items: items75 } });
  if (n.derives !== undefined) {
    let items76: QuoteValue[] = [];
    for (const x76 of n.derives) {
      items76.push({ kind: "text", value: x76 });
    }
    out.push({ name: "derives", value: { kind: "list", items: items76 } });
  }
  return out;
}

function fieldsOfTypeMember_property(n: Ref<Extract<TypeMember, { kind: "property" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: oneOf3(n.name) });
  out.push({ name: "optional", value: { kind: "boolean", value: n.optional } });
  out.push({ name: "readonly", value: { kind: "boolean", value: n.readonly } });
  if (n.type === undefined) out.push({ name: "type", value: { kind: "none" } });
  else {
    out.push({ name: "type", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.type) } });
  }
  return out;
}

function fieldsOfTypeMember_method(n: Ref<Extract<TypeMember, { kind: "method" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: oneOf3(n.name) });
  out.push({ name: "optional", value: { kind: "boolean", value: n.optional } });
  let items77: QuoteValue[] = [];
  for (const x77 of n.typeParams) {
    items77.push({ kind: "node", of: "typeParam", fields: fieldsOfTypeParam(x77) });
  }
  out.push({ name: "typeParams", value: { kind: "list", items: items77 } });
  let items78: QuoteValue[] = [];
  for (const x78 of n.params) {
    items78.push({ kind: "node", of: "param", fields: fieldsOfParam(x78) });
  }
  out.push({ name: "params", value: { kind: "list", items: items78 } });
  if (n.returns === undefined) out.push({ name: "returns", value: { kind: "none" } });
  else {
    out.push({ name: "returns", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.returns) } });
  }
  if (n.throws !== undefined) {
    out.push({ name: "throws", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.throws) } });
  }
  return out;
}

function fieldsOfTypeMember_call(n: Ref<Extract<TypeMember, { kind: "call" | "construct" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items79: QuoteValue[] = [];
  for (const x79 of n.typeParams) {
    items79.push({ kind: "node", of: "typeParam", fields: fieldsOfTypeParam(x79) });
  }
  out.push({ name: "typeParams", value: { kind: "list", items: items79 } });
  let items80: QuoteValue[] = [];
  for (const x80 of n.params) {
    items80.push({ kind: "node", of: "param", fields: fieldsOfParam(x80) });
  }
  out.push({ name: "params", value: { kind: "list", items: items80 } });
  if (n.returns === undefined) out.push({ name: "returns", value: { kind: "none" } });
  else {
    out.push({ name: "returns", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.returns) } });
  }
  return out;
}

function fieldsOfTypeMember_construct(n: Ref<Extract<TypeMember, { kind: "call" | "construct" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items81: QuoteValue[] = [];
  for (const x81 of n.typeParams) {
    items81.push({ kind: "node", of: "typeParam", fields: fieldsOfTypeParam(x81) });
  }
  out.push({ name: "typeParams", value: { kind: "list", items: items81 } });
  let items82: QuoteValue[] = [];
  for (const x82 of n.params) {
    items82.push({ kind: "node", of: "param", fields: fieldsOfParam(x82) });
  }
  out.push({ name: "params", value: { kind: "list", items: items82 } });
  if (n.returns === undefined) out.push({ name: "returns", value: { kind: "none" } });
  else {
    out.push({ name: "returns", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.returns) } });
  }
  return out;
}

function fieldsOfTypeMember_index(n: Ref<Extract<TypeMember, { kind: "index" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "readonly", value: { kind: "boolean", value: n.readonly } });
  let items83: QuoteValue[] = [];
  for (const x83 of n.params) {
    items83.push({ kind: "node", of: "param", fields: fieldsOfParam(x83) });
  }
  out.push({ name: "params", value: { kind: "list", items: items83 } });
  out.push({ name: "type", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.type) } });
  return out;
}

function fieldsOfTypeMember_get(n: Ref<Extract<TypeMember, { kind: "get" | "set" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: oneOf3(n.name) });
  let items84: QuoteValue[] = [];
  for (const x84 of n.params) {
    items84.push({ kind: "node", of: "param", fields: fieldsOfParam(x84) });
  }
  out.push({ name: "params", value: { kind: "list", items: items84 } });
  if (n.returns === undefined) out.push({ name: "returns", value: { kind: "none" } });
  else {
    out.push({ name: "returns", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.returns) } });
  }
  return out;
}

function fieldsOfTypeMember_set(n: Ref<Extract<TypeMember, { kind: "get" | "set" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: oneOf3(n.name) });
  let items85: QuoteValue[] = [];
  for (const x85 of n.params) {
    items85.push({ kind: "node", of: "param", fields: fieldsOfParam(x85) });
  }
  out.push({ name: "params", value: { kind: "list", items: items85 } });
  if (n.returns === undefined) out.push({ name: "returns", value: { kind: "none" } });
  else {
    out.push({ name: "returns", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.returns) } });
  }
  return out;
}

function fieldsOfObjectProp_property(n: Ref<Extract<ObjectProp, { kind: "property" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "key", value: oneOf3(n.key) });
  out.push({ name: "value", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.value) } });
  return out;
}

function fieldsOfObjectProp_shorthand(n: Ref<Extract<ObjectProp, { kind: "shorthand" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  if (n.default === undefined) out.push({ name: "default", value: { kind: "none" } });
  else {
    out.push({ name: "default", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.default) } });
  }
  return out;
}

function fieldsOfObjectProp_spread(n: Ref<Extract<ObjectProp, { kind: "spread" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "value", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.value) } });
  return out;
}

function fieldsOfObjectProp_method(n: Ref<Extract<ObjectProp, { kind: "method" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "key", value: oneOf3(n.key) });
  out.push({ name: "async", value: { kind: "boolean", value: n.async } });
  out.push({ name: "generator", value: { kind: "boolean", value: n.generator } });
  let items86: QuoteValue[] = [];
  for (const x86 of n.typeParams) {
    items86.push({ kind: "node", of: "typeParam", fields: fieldsOfTypeParam(x86) });
  }
  out.push({ name: "typeParams", value: { kind: "list", items: items86 } });
  let items87: QuoteValue[] = [];
  for (const x87 of n.params) {
    items87.push({ kind: "node", of: "param", fields: fieldsOfParam(x87) });
  }
  out.push({ name: "params", value: { kind: "list", items: items87 } });
  if (n.returnType === undefined) out.push({ name: "returnType", value: { kind: "none" } });
  else {
    out.push({ name: "returnType", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.returnType) } });
  }
  let items88: QuoteValue[] = [];
  for (const x88 of n.body) {
    items88.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x88) });
  }
  out.push({ name: "body", value: { kind: "list", items: items88 } });
  return out;
}

function fieldsOfObjectProp_get(n: Ref<Extract<ObjectProp, { kind: "get" | "set" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "key", value: oneOf3(n.key) });
  let items89: QuoteValue[] = [];
  for (const x89 of n.params) {
    items89.push({ kind: "node", of: "param", fields: fieldsOfParam(x89) });
  }
  out.push({ name: "params", value: { kind: "list", items: items89 } });
  if (n.returnType === undefined) out.push({ name: "returnType", value: { kind: "none" } });
  else {
    out.push({ name: "returnType", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.returnType) } });
  }
  let items90: QuoteValue[] = [];
  for (const x90 of n.body) {
    items90.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x90) });
  }
  out.push({ name: "body", value: { kind: "list", items: items90 } });
  return out;
}

function fieldsOfObjectProp_set(n: Ref<Extract<ObjectProp, { kind: "get" | "set" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "key", value: oneOf3(n.key) });
  let items91: QuoteValue[] = [];
  for (const x91 of n.params) {
    items91.push({ kind: "node", of: "param", fields: fieldsOfParam(x91) });
  }
  out.push({ name: "params", value: { kind: "list", items: items91 } });
  if (n.returnType === undefined) out.push({ name: "returnType", value: { kind: "none" } });
  else {
    out.push({ name: "returnType", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.returnType) } });
  }
  let items92: QuoteValue[] = [];
  for (const x92 of n.body) {
    items92.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x92) });
  }
  out.push({ name: "body", value: { kind: "list", items: items92 } });
  return out;
}

function fieldsOfClassMember_field(n: Ref<Extract<ClassMember, { kind: "field" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items98: QuoteValue[] = [];
  for (const x98 of n.modifiers) {
    items98.push({ kind: "text", value: x98 });
  }
  out.push({ name: "modifiers", value: { kind: "list", items: items98 } });
  let items99: QuoteValue[] = [];
  for (const x99 of n.decorators) {
    items99.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x99) });
  }
  out.push({ name: "decorators", value: { kind: "list", items: items99 } });
  out.push({ name: "name", value: oneOf3(n.name) });
  out.push({ name: "optional", value: { kind: "boolean", value: n.optional } });
  out.push({ name: "definite", value: { kind: "boolean", value: n.definite } });
  if (n.type === undefined) out.push({ name: "type", value: { kind: "none" } });
  else {
    out.push({ name: "type", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.type) } });
  }
  if (n.init === undefined) out.push({ name: "init", value: { kind: "none" } });
  else {
    out.push({ name: "init", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.init) } });
  }
  return out;
}

function fieldsOfClassMember_method(n: Ref<Extract<ClassMember, { kind: "method" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items100: QuoteValue[] = [];
  for (const x100 of n.modifiers) {
    items100.push({ kind: "text", value: x100 });
  }
  out.push({ name: "modifiers", value: { kind: "list", items: items100 } });
  let items101: QuoteValue[] = [];
  for (const x101 of n.decorators) {
    items101.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x101) });
  }
  out.push({ name: "decorators", value: { kind: "list", items: items101 } });
  out.push({ name: "name", value: oneOf3(n.name) });
  out.push({ name: "optional", value: { kind: "boolean", value: n.optional } });
  out.push({ name: "generator", value: { kind: "boolean", value: n.generator } });
  let items102: QuoteValue[] = [];
  for (const x102 of n.typeParams) {
    items102.push({ kind: "node", of: "typeParam", fields: fieldsOfTypeParam(x102) });
  }
  out.push({ name: "typeParams", value: { kind: "list", items: items102 } });
  let items103: QuoteValue[] = [];
  for (const x103 of n.params) {
    items103.push({ kind: "node", of: "param", fields: fieldsOfParam(x103) });
  }
  out.push({ name: "params", value: { kind: "list", items: items103 } });
  if (n.returnType === undefined) out.push({ name: "returnType", value: { kind: "none" } });
  else {
    out.push({ name: "returnType", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.returnType) } });
  }
  if (n.throws !== undefined) {
    out.push({ name: "throws", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.throws) } });
  }
  if (n.body === undefined) out.push({ name: "body", value: { kind: "none" } });
  else {
    let items104: QuoteValue[] = [];
    for (const x104 of n.body) {
      items104.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x104) });
    }
    out.push({ name: "body", value: { kind: "list", items: items104 } });
  }
  if (n.overloadNames !== undefined) {
    let items105: QuoteValue[] = [];
    for (const x105 of n.overloadNames) {
      items105.push({ kind: "text", value: x105 });
    }
    out.push({ name: "overloadNames", value: { kind: "list", items: items105 } });
  }
  if (n.signature !== undefined) {
    out.push({ name: "signature", value: { kind: "boolean", value: n.signature } });
  }
  return out;
}

function fieldsOfClassMember_constructor(n: Ref<Extract<ClassMember, { kind: "constructor" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items106: QuoteValue[] = [];
  for (const x106 of n.modifiers) {
    items106.push({ kind: "text", value: x106 });
  }
  out.push({ name: "modifiers", value: { kind: "list", items: items106 } });
  let items107: QuoteValue[] = [];
  for (const x107 of n.decorators) {
    items107.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x107) });
  }
  out.push({ name: "decorators", value: { kind: "list", items: items107 } });
  let items108: QuoteValue[] = [];
  for (const x108 of n.params) {
    items108.push({ kind: "node", of: "param", fields: fieldsOfParam(x108) });
  }
  out.push({ name: "params", value: { kind: "list", items: items108 } });
  if (n.throws !== undefined) {
    out.push({ name: "throws", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.throws) } });
  }
  if (n.body === undefined) out.push({ name: "body", value: { kind: "none" } });
  else {
    let items109: QuoteValue[] = [];
    for (const x109 of n.body) {
      items109.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x109) });
    }
    out.push({ name: "body", value: { kind: "list", items: items109 } });
  }
  return out;
}

function fieldsOfClassMember_get(n: Ref<Extract<ClassMember, { kind: "get" | "set" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items110: QuoteValue[] = [];
  for (const x110 of n.modifiers) {
    items110.push({ kind: "text", value: x110 });
  }
  out.push({ name: "modifiers", value: { kind: "list", items: items110 } });
  let items111: QuoteValue[] = [];
  for (const x111 of n.decorators) {
    items111.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x111) });
  }
  out.push({ name: "decorators", value: { kind: "list", items: items111 } });
  out.push({ name: "name", value: oneOf3(n.name) });
  let items112: QuoteValue[] = [];
  for (const x112 of n.params) {
    items112.push({ kind: "node", of: "param", fields: fieldsOfParam(x112) });
  }
  out.push({ name: "params", value: { kind: "list", items: items112 } });
  if (n.returnType === undefined) out.push({ name: "returnType", value: { kind: "none" } });
  else {
    out.push({ name: "returnType", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.returnType) } });
  }
  if (n.throws !== undefined) {
    out.push({ name: "throws", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.throws) } });
  }
  if (n.body === undefined) out.push({ name: "body", value: { kind: "none" } });
  else {
    let items113: QuoteValue[] = [];
    for (const x113 of n.body) {
      items113.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x113) });
    }
    out.push({ name: "body", value: { kind: "list", items: items113 } });
  }
  return out;
}

function fieldsOfClassMember_set(n: Ref<Extract<ClassMember, { kind: "get" | "set" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items114: QuoteValue[] = [];
  for (const x114 of n.modifiers) {
    items114.push({ kind: "text", value: x114 });
  }
  out.push({ name: "modifiers", value: { kind: "list", items: items114 } });
  let items115: QuoteValue[] = [];
  for (const x115 of n.decorators) {
    items115.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x115) });
  }
  out.push({ name: "decorators", value: { kind: "list", items: items115 } });
  out.push({ name: "name", value: oneOf3(n.name) });
  let items116: QuoteValue[] = [];
  for (const x116 of n.params) {
    items116.push({ kind: "node", of: "param", fields: fieldsOfParam(x116) });
  }
  out.push({ name: "params", value: { kind: "list", items: items116 } });
  if (n.returnType === undefined) out.push({ name: "returnType", value: { kind: "none" } });
  else {
    out.push({ name: "returnType", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.returnType) } });
  }
  if (n.throws !== undefined) {
    out.push({ name: "throws", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.throws) } });
  }
  if (n.body === undefined) out.push({ name: "body", value: { kind: "none" } });
  else {
    let items117: QuoteValue[] = [];
    for (const x117 of n.body) {
      items117.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x117) });
    }
    out.push({ name: "body", value: { kind: "list", items: items117 } });
  }
  return out;
}

function fieldsOfClassMember_index(n: Ref<Extract<ClassMember, { kind: "index" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items118: QuoteValue[] = [];
  for (const x118 of n.modifiers) {
    items118.push({ kind: "text", value: x118 });
  }
  out.push({ name: "modifiers", value: { kind: "list", items: items118 } });
  let items119: QuoteValue[] = [];
  for (const x119 of n.decorators) {
    items119.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x119) });
  }
  out.push({ name: "decorators", value: { kind: "list", items: items119 } });
  let items120: QuoteValue[] = [];
  for (const x120 of n.params) {
    items120.push({ kind: "node", of: "param", fields: fieldsOfParam(x120) });
  }
  out.push({ name: "params", value: { kind: "list", items: items120 } });
  out.push({ name: "type", value: { kind: "node", of: "typeNode", fields: fieldsOfTypeNode(n.type) } });
  return out;
}

function fieldsOfClassMember_staticBlock(n: Ref<Extract<ClassMember, { kind: "staticBlock" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items121: QuoteValue[] = [];
  for (const x121 of n.modifiers) {
    items121.push({ kind: "text", value: x121 });
  }
  out.push({ name: "modifiers", value: { kind: "list", items: items121 } });
  let items122: QuoteValue[] = [];
  for (const x122 of n.decorators) {
    items122.push({ kind: "node", of: "expr", fields: fieldsOfExpr(x122) });
  }
  out.push({ name: "decorators", value: { kind: "list", items: items122 } });
  let items123: QuoteValue[] = [];
  for (const x123 of n.body) {
    items123.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x123) });
  }
  out.push({ name: "body", value: { kind: "list", items: items123 } });
  return out;
}

function fieldsOfPattern_ident(n: Ref<Extract<Pattern, { kind: "ident" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  return out;
}

function fieldsOfPattern_object(n: Ref<Extract<Pattern, { kind: "object" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items126: QuoteValue[] = [];
  for (const x126 of n.props) {
    items126.push({ kind: "node", of: "patternProp", fields: fieldsOfPatternProp(x126) });
  }
  out.push({ name: "props", value: { kind: "list", items: items126 } });
  if (n.rest === undefined) out.push({ name: "rest", value: { kind: "none" } });
  else {
    out.push({ name: "rest", value: { kind: "node", of: "pattern", fields: fieldsOfPattern(n.rest) } });
  }
  return out;
}

function fieldsOfPattern_array(n: Ref<Extract<Pattern, { kind: "array" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items127: QuoteValue[] = [];
  for (const x127 of n.elements) {
    if (x127 === undefined) items127.push({ kind: "none" });
    else {
      items127.push({ kind: "node", of: "pattern", fields: fieldsOfPattern(x127) });
    }
  }
  out.push({ name: "elements", value: { kind: "list", items: items127 } });
  if (n.rest === undefined) out.push({ name: "rest", value: { kind: "none" } });
  else {
    out.push({ name: "rest", value: { kind: "node", of: "pattern", fields: fieldsOfPattern(n.rest) } });
  }
  return out;
}

function fieldsOfPattern_default(n: Ref<Extract<Pattern, { kind: "default" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "target", value: { kind: "node", of: "pattern", fields: fieldsOfPattern(n.target) } });
  out.push({ name: "value", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.value) } });
  return out;
}

function fieldsOfPattern_expr(n: Ref<Extract<Pattern, { kind: "expr" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "expr", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.expr) } });
  return out;
}

function fieldsOfPattern_wildcard(n: Ref<Extract<Pattern, { kind: "wildcard" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  return out;
}

function fieldsOfPattern_literal(n: Ref<Extract<Pattern, { kind: "literal" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "value", value: { kind: "node", of: "expr", fields: fieldsOfExpr(n.value) } });
  return out;
}

function fieldsOfPattern_variant(n: Ref<Extract<Pattern, { kind: "variant" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  out.push({ name: "name", value: { kind: "text", value: n.name } });
  if (n.args === undefined) out.push({ name: "args", value: { kind: "none" } });
  else {
    let items128: QuoteValue[] = [];
    for (const x128 of n.args) {
      items128.push({ kind: "node", of: "pattern", fields: fieldsOfPattern(x128) });
    }
    out.push({ name: "args", value: { kind: "list", items: items128 } });
  }
  return out;
}

function fieldsOfPattern_or(n: Ref<Extract<Pattern, { kind: "or" }>>): QuoteField[] {
  let out: QuoteField[] = [];
  out.push({ name: "kind", value: { kind: "text", value: n.kind } });
  out.push({ name: "start", value: { kind: "int", value: n.start as i64 } });
  out.push({ name: "end", value: { kind: "int", value: n.end as i64 } });
  out.push({ name: "id", value: { kind: "int", value: n.id as i64 } });
  let items129: QuoteValue[] = [];
  for (const x129 of n.patterns) {
    items129.push({ kind: "node", of: "pattern", fields: fieldsOfPattern(x129) });
  }
  out.push({ name: "patterns", value: { kind: "list", items: items129 } });
  return out;
}

function oneOf0(n: Ref<Expr | Stmt[]>): QuoteValue {
  if (Array.isArray(n)) {
    let items22: QuoteValue[] = [];
    for (const x22 of n) {
      items22.push({ kind: "node", of: "stmt", fields: fieldsOfStmt(x22) });
    }
    return { kind: "list", items: items22 };
  }
  return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
}

function oneOf1(n: Ref<Stmt | Pattern>): QuoteValue {
  switch (n.kind) {
    case "expr":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "let":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "return":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "if":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "while":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "doWhile":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "switch":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "labeled":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "break":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "continue":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "throw":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "try":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "for":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "forIn":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "forOf":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "block":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "empty":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "debugger":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "enum":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "namespace":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "declare":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "comptime":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "unsafe":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "import":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "importEquals":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "export":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "exportDefault":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "exportNamed":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "exportAll":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "exportAssign":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "exportAsNamespace":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "typeAlias":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "interface":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "function":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "class":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
    case "ident":
      return { kind: "node", of: "pattern", fields: fieldsOfPattern(n) };
    case "object":
      return { kind: "node", of: "pattern", fields: fieldsOfPattern(n) };
    case "array":
      return { kind: "node", of: "pattern", fields: fieldsOfPattern(n) };
    case "default":
      return { kind: "node", of: "pattern", fields: fieldsOfPattern(n) };
    case "wildcard":
      return { kind: "node", of: "pattern", fields: fieldsOfPattern(n) };
    case "literal":
      return { kind: "node", of: "pattern", fields: fieldsOfPattern(n) };
    case "variant":
      return { kind: "node", of: "pattern", fields: fieldsOfPattern(n) };
    case "or":
      return { kind: "node", of: "pattern", fields: fieldsOfPattern(n) };
  }
  return { kind: "none" };
}

function recordOf2(n: Ref<{ constructors: Param[][]; statics: TypeMember[] }>): QuoteValue {
  let out: QuoteField[] = [];
  let items64: QuoteValue[] = [];
  for (const x64 of n.constructors) {
    let items65: QuoteValue[] = [];
    for (const x65 of x64) {
      items65.push({ kind: "node", of: "param", fields: fieldsOfParam(x65) });
    }
    items64.push({ kind: "list", items: items65 });
  }
  out.push({ name: "constructors", value: { kind: "list", items: items64 } });
  let items66: QuoteValue[] = [];
  for (const x66 of n.statics) {
    items66.push({ kind: "node", of: "typeMember", fields: fieldsOfTypeMember(x66) });
  }
  out.push({ name: "statics", value: { kind: "list", items: items66 } });
  return { kind: "record", fields: out };
}

function oneOf3(n: Ref<PropertyName>): QuoteValue {
  if (typeof n === "string") return { kind: "text", value: `${n}` };
  return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
}

function oneOf4(n: Ref<Expr | Extract<Stmt, { kind: "block" }>>): QuoteValue {
  switch (n.kind) {
    case "int":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "float":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "bigint":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "null":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "this":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "super":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "regex":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "template":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "tagged":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "bool":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "string":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "ident":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "spread":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "array":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "object":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "function":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "arrow":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "member":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "index":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "call":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "new":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "instantiation":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "meta":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "import":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "nonNull":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "throw":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "class":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "privateName":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "unary":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "update":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "binary":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "conditional":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "assign":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "pipe":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "topic":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "match":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "comptime":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "unsafe":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "destructure":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "sequence":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "yield":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "as":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "satisfies":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "assertion":
      return { kind: "node", of: "expr", fields: fieldsOfExpr(n) };
    case "block":
      return { kind: "node", of: "stmt", fields: fieldsOfStmt(n) };
  }
  return { kind: "none" };
}
