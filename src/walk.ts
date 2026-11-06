// Generated from the parser's AST types by `bun scripts/walkgen.ts`; a test fails when it is stale.
// Visits each node a node holds, tagged, in the order its type lists the fields.
import assert from "node:assert";
import type { TypeNode, Expr, Stmt, TupleElement, TypeMember, ObjectProp, ClassNode, ClassMember, Param, Pattern, MatchArm, PatternProp, Specifier, EnumMember, SwitchCase, Declarator, TypeParam, TypeAlias, Interface, JsName, Func } from "./parser.ts";

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
