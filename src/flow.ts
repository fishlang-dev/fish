import type { Expr, Pattern, Stmt } from "./parser.ts";
import { forEachChild, NodeSet, walk, walkWhile, type AnyNode } from "./nodes.ts";

// Whether control never reaches the end of these statements. A loop whose condition is
// always true never finishes unless a `break` leaves it.
export function alwaysReturns(stmts: Ref<Stmt[]>, broken: Ref<NodeSet<Stmt>>, continued: Ref<NodeSet<Stmt>>): boolean {
  return stmts.some((s) => alwaysReturnsStmt(s, broken, continued));
}

function alwaysReturnsStmt(s: Ref<Stmt>, broken: Ref<NodeSet<Stmt>>, continued: Ref<NodeSet<Stmt>>): boolean {
  switch (s.kind) {
    case "return":
    case "throw":
      return true;
    case "if":
      return s.else !== undefined && alwaysReturns(s.then, broken, continued) && alwaysReturns(s.else, broken, continued);
    case "block":
      return alwaysReturns(s.body, broken, continued);
    case "unsafe":
      return alwaysReturns(s.body, broken, continued);
    // Either the block finishes or an error sends control to the catch, so both must leave.
    case "try":
      return (alwaysReturns(s.block, broken, continued) && (s.handler === undefined || alwaysReturns(s.handler, broken, continued)))
        || (s.finalizer !== undefined && alwaysReturns(s.finalizer, broken, continued));
    case "labeled":
      return !broken.has(s) && alwaysReturnsStmt(s.body, broken, continued);
    case "while":
      return isTrue(s.cond) && !broken.has(s);
    case "for":
      return (s.test === undefined || isTrue(s.test)) && !broken.has(s);
    case "doWhile":
      // A `continue` skips the rest of the body to test the condition.
      return !broken.has(s) && (isTrue(s.cond) || (alwaysReturns(s.body, broken, continued) && !continued.has(s)));
    case "switch":
      // Every case falls through to the last body, so it decides, provided some case runs.
      return s.cases.some((c) => c.test === undefined) && !broken.has(s) && alwaysReturns(s.cases[s.cases.length - 1]!.body, broken, continued);
    default:
      return false;
  }
}

const isTrue = (e: Ref<Expr>) => e.kind === "bool" && e.value;

function collectAssigned(root: AnyNode): Set<string> {
  let names = new Set<string>();
  walk(root, (item) => {
    if (item.of !== "expr") return;
    const n = item.node;
    if (n.kind === "assign" && n.target.kind === "ident") names.add(n.target.name);
    if (n.kind === "update" && n.operand.kind === "ident") names.add(n.operand.name);
    // A destructuring assignment assigns each name its pattern holds.
    if (n.kind === "destructure") for (const name of patternNames(n.pattern)) names.add(name);
  });
  return names;
}

// The names any assignment, `++` or `--` in these statements writes to.
export function assignedNames(body: Ref<Stmt[]> | undefined): Set<string> {
  if (body === undefined) return new Set<string>();
  return collectAssigned({ of: "stmts", node: body });
}

// The names the closures and nested functions in these statements assign: a check outside them
// can't tell when a call runs them.
export function closureAssigned(body: Ref<Stmt[]> | undefined): Set<string> {
  let names = new Set<string>();
  if (body === undefined) return names;
  walkWhile({ of: "stmts", node: body }, (item) => {
    if (item.of === "expr" && item.node.kind === "arrow") {
      const n = item.node;
      // A name the function takes as a parameter, or declares, is its own.
      if (Array.isArray(n.body)) {
        for (const name of assignedNames(n.body)) {
          if (!n.params.some((p) => patternNames(p.pattern).includes(name)) && assignsOwn(n.body, name)) names.add(name);
        }
      } else {
        for (const name of collectAssigned({ of: "expr", node: n.body })) {
          if (!n.params.some((p) => patternNames(p.pattern).includes(name)) && assignsOwnNode({ of: "expr", node: n.body }, name)) names.add(name);
        }
      }
      return false;
    }
    if (item.of === "stmt" && item.node.kind === "function") {
      const n = item.node;
      if (n.body !== undefined) {
        for (const name of assignedNames(n.body)) {
          if (!n.params.some((p) => patternNames(p.pattern).includes(name)) && assignsOwn(n.body, name)) names.add(name);
        }
        return false;
      }
    }
    return true;
  });
  return names;
}

function declaresStmt(s: Ref<Stmt>, name: string): boolean {
  if (s.kind === "let") return s.declarations.some((x) => patternNames(x.target).includes(name));
  if (s.kind === "function") return s.name === name;
  return s.kind === "class" && s.name === name;
}

function declares(list: Ref<Stmt[]>, name: string): boolean {
  return list.some((s) => declaresStmt(s, name));
}

function assignsOwnNode(item: AnyNode, name: string): boolean {
  if (item.of === "stmts") {
    if (declares(item.node, name)) return false;
    return item.node.some((s) => assignsOwnNode({ of: "stmt", node: s }, name));
  }
  if (item.of === "expr") {
    const e = item.node;
    if ((e.kind === "assign" && e.target.kind === "ident" && e.target.name === name) || (e.kind === "update" && e.operand.kind === "ident" && e.operand.name === name)) {
      return true;
    }
    if (e.kind === "destructure" && patternNames(e.pattern).includes(name)) {
      return true;
    }
    if (e.kind === "arrow" && e.params.some((p) => patternNames(p.pattern).includes(name))) return false;
    if (e.kind === "function" && e.params.some((p) => patternNames(p.pattern).includes(name))) return false;
  } else if (item.of === "stmt") {
    const s = item.node;
    if (s.kind === "function" && s.params.some((p) => patternNames(p.pattern).includes(name))) return false;
    if (s.kind === "for" && s.init !== undefined && declaresStmt(s.init, name)) return false;
    if (s.kind === "forOf" && s.left.kind === "let" && declaresStmt(s.left, name)) return false;
    if (s.kind === "forIn" && s.left.kind === "let" && declaresStmt(s.left, name)) return false;
    if (s.kind === "try" && s.param !== undefined && patternNames(s.param).includes(name)) {
      if (!declares(s.block, name) && s.block.some((b) => assignsOwnNode({ of: "stmt", node: b }, name))) return true;
      if (s.finalizer !== undefined && !declares(s.finalizer, name) && s.finalizer.some((f) => assignsOwnNode({ of: "stmt", node: f }, name))) return true;
      return false;
    }
  } else if (item.of === "classMember") {
    const m = item.node;
    if (m.kind === "method" && m.params.some((p) => patternNames(p.pattern).includes(name))) return false;
    if (m.kind === "constructor" && m.params.some((p) => patternNames(p.pattern).includes(name))) return false;
    if (m.kind === "set" && m.params.some((p) => patternNames(p.pattern).includes(name))) return false;
  } else if (item.of === "objectProp") {
    const p = item.node;
    if (p.kind === "method" && p.params.some((q) => patternNames(q.pattern).includes(name))) return false;
    if (p.kind === "set" && p.params.some((q) => patternNames(q.pattern).includes(name))) return false;
  }
  let hit = false;
  forEachChild(item, (c) => {
    if (!hit && assignsOwnNode(c, name)) hit = true;
  });
  return hit;
}

// Whether these statements assign `name` where it means the binding they start with. A part
// that declares the name again is passed over: a block or function body declaring it, a
// function taking it as a parameter, a loop declaring it in its head, a catch binding it. A
// switch case or other list declaring it is still read whole, which errs toward "assigned".
export function assignsOwn(body: Ref<Stmt[]>, name: string): boolean {
  return assignsOwnNode({ of: "stmts", node: body }, name);
}

// The variables a destructuring pattern assigns.
export function patternNames(p: Ref<Pattern>): string[] {
  let names: string[] = [];
  collectPatternNames(p, names);
  return names;
}

function collectPatternNames(p: Ref<Pattern>, names: Mut<string[]>): void {
  if (p.kind === "ident") names.push(p.name);
  else if (p.kind === "default") collectPatternNames(p.target, names);
  else if (p.kind === "array") {
    for (const x of p.elements) if (x !== undefined) collectPatternNames(x, names);
    if (p.rest !== undefined) collectPatternNames(p.rest, names);
  } else if (p.kind === "object") {
    for (const x of p.props) collectPatternNames(x.value, names);
    if (p.rest !== undefined) collectPatternNames(p.rest, names);
  }
}

function rootName(e: Ref<Expr>): string {
  if (e.kind === "member") return rootName(e.object);
  if (e.kind === "index") return rootName(e.object);
  if (e.kind === "nonNull") return rootName(e.expr);
  return e.kind === "ident" ? e.name : e.kind === "this" ? "this" : "";
}

// The roots of the fields and elements any assignment, `++`, `--` or destructuring in these
// statements writes, `this` among them: a loop writing one may reach a field narrowed before it.
export function fieldRoots(body: Ref<Stmt[]>): Set<string> {
  let roots = new Set<string>();
  const add = (target: Ref<Expr> | undefined) => {
    if (target === undefined) return;
    if (target.kind === "member") roots.add(rootName(target.object));
    else if (target.kind === "index") roots.add(rootName(target.object));
  };
  walk({ of: "stmts", node: body }, (item) => {
    if (item.of === "expr") {
      if (item.node.kind === "assign") add(item.node.target);
      else if (item.node.kind === "update") add(item.node.operand);
    }
    if (item.of === "pattern" && item.node.kind === "expr") add(item.node.expr);
  });
  return roots;
}
