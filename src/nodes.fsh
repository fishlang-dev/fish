// Node ids, and the tables keyed by them. Fish's `Map` and `Set` key on strings and integers,
// not objects, so the compiler's per-node tables key on each node's `id`.

import assert from "node:assert";
import type { Id } from "./ids.fsh";
import type {
  ClassMember,
  ClassNode,
  Declarator,
  EnumMember,
  Expr,
  Func,
  Interface,
  MatchArm,
  ObjectProp,
  Param,
  Pattern,
  PatternProp,
  Span,
  Specifier,
  Stmt,
  SwitchCase,
  TupleElement,
  TypeAlias,
  TypeMember,
  TypeNode,
  TypeParam,
} from "./parser.fsh";
import {
  cloneClassMember,
  cloneDeclarator,
  cloneExpr,
  cloneObjectProp,
  cloneParam,
  clonePattern,
  clonePatternProp,
  cloneStmt,
  cloneTypeMember,
  cloneTypeNode,
  idOfClassMember,
  idOfClassNode,
  idOfDeclarator,
  idOfEnumMember,
  idOfExpr,
  idOfFunc,
  idOfInterface,
  idOfMatchArm,
  idOfObjectProp,
  idOfParam,
  idOfPattern,
  idOfPatternProp,
  idOfSpecifier,
  idOfStmt,
  idOfSwitchCase,
  idOfTupleElement,
  idOfTypeAlias,
  idOfTypeMember,
  idOfTypeNode,
  idOfTypeParam,
  markClassMember,
  markClassNode,
  markDeclarator,
  markEnumMember,
  markExpr,
  markFunc,
  markInterface,
  markMatchArm,
  markObjectProp,
  markParam,
  markPattern,
  markPatternProp,
  markSpecifier,
  markStmt,
  markSwitchCase,
  markTupleElement,
  markTypeAlias,
  markTypeMember,
  markTypeNode,
  markTypeParam,
  rebuiltClassMember,
  rebuiltExpr,
  rebuiltFunc,
  rebuiltParam,
  rebuiltStmt,
  rebuiltStmts,
  rebuiltTypeNode,
  rebuiltTypeParam,
  withIdClassMember,
  withIdClassNode,
  withIdDeclarator,
  withIdEnumMember,
  withIdExpr,
  withIdFunc,
  withIdInterface,
  withIdMatchArm,
  withIdObjectProp,
  withIdParam,
  withIdPattern,
  withIdPatternProp,
  withIdSpecifier,
  withIdStmt,
  withIdSwitchCase,
  withIdTupleElement,
  withIdTypeAlias,
  withIdTypeMember,
  withIdTypeNode,
  withIdTypeParam,
  type Replacements,
} from "./rebuild.fsh";
import { collectIdsNode, forEachChild, nodeIdOf, visitAt, type AnyNode, type NodeTypes } from "./walk.fsh";

export { nextId, type Id, type Ids } from "./ids.fsh";
export { forEachChild, nodeIdOf, type AnyNode } from "./walk.fsh";

export type NodeOf<K extends keyof NodeTypes> = NodeTypes[K];
// The node types a walk can start from: nodes, or arrays of them.
export type RootKind = Exclude<keyof NodeTypes, "stmts">;

// Reborrows `root` so `visitAt` can be called repeatedly in a loop.
export function reborrowNode(root: Ref<AnyNode>): AnyNode {
  if (root.of === "typeNode") return { of: "typeNode", node: root.node };
  if (root.of === "expr") return { of: "expr", node: root.node };
  if (root.of === "stmt") return { of: "stmt", node: root.node };
  if (root.of === "tupleElement") return { of: "tupleElement", node: root.node };
  if (root.of === "typeMember") return { of: "typeMember", node: root.node };
  if (root.of === "objectProp") return { of: "objectProp", node: root.node };
  if (root.of === "classNode") return { of: "classNode", node: root.node };
  if (root.of === "classMember") return { of: "classMember", node: root.node };
  if (root.of === "param") return { of: "param", node: root.node };
  if (root.of === "pattern") return { of: "pattern", node: root.node };
  if (root.of === "matchArm") return { of: "matchArm", node: root.node };
  if (root.of === "patternProp") return { of: "patternProp", node: root.node };
  if (root.of === "specifier") return { of: "specifier", node: root.node };
  if (root.of === "enumMember") return { of: "enumMember", node: root.node };
  if (root.of === "switchCase") return { of: "switchCase", node: root.node };
  if (root.of === "declarator") return { of: "declarator", node: root.node };
  if (root.of === "typeParam") return { of: "typeParam", node: root.node };
  if (root.of === "typeAlias") return { of: "typeAlias", node: root.node };
  if (root.of === "interface") return { of: "interface", node: root.node };
  if (root.of === "jsName") return { of: "jsName", node: root.node };
  if (root.of === "func") return { of: "func", node: root.node };
  return { of: "stmts", node: root.node };
}

// Calls `each` on `root` and every node under it, each node before those it holds; `each`
// returning false skips those. Lists of statements are walked through, not given.
export function walkWhile(root: AnyNode, each: (n: AnyNode) => boolean): void {
  let steps: usize[] = [];
  while (true) {
    const r = visitAt(reborrowNode(root), steps, 0, (n) => each(n));
    if (r === 0) {
      if (steps.length === 0) return;
      const last = steps.pop()!;
      steps.push(last + 1);
    } else {
      if (steps.length === 0) return;
      steps.pop();
      if (steps.length === 0) return;
      const prev = steps.pop()!;
      steps.push(prev + 1);
    }
  }
}

// Calls `each` on `root` and every node under it, each node before those it holds. Lists of
// statements are walked through, not given.
export function walk(root: AnyNode, each: (n: AnyNode) => void): void {
  walkWhile(root, (n) => {
    each(n);
    return true;
  });
}

// Whether `found` picks out a node under `root`, itself included.
export function someNode(root: AnyNode, found: (n: AnyNode) => boolean): boolean {
  let hit = false;
  walkWhile(root, (n) => {
    if (found(n)) hit = true;
    return !hit;
  });
  return hit;
}

// Gives two owned handles to `x`: a copy in Fish, and the same object reference in JS so node
// identity checks in `tests/unit/nodes.fsh` see one object.
export function dup<T>(x: T): [T, T] {
  let m = new Map<usize, T>();
  m.set(0, x);
  return [m.get(0)!, m.get(0)!];
}

// Collects every distinct node id under `root` in pre-order, refusing two different nodes that
// share one id.
function collectIds(root: AnyNode): [Map<usize, usize>, usize[], boolean] {
  let seen = new Map<usize, usize>();
  let order: usize[] = [];
  let shared = new Set<usize>();
  collectIdsNode(root, seen, order, shared);
  return [seen, order, shared.size > 0];
}

class Applier implements Replacements {
  seen: Map<usize, usize>;
  assigned: Map<usize, usize>;
  hasShared: boolean;
  renumber: boolean;
  by: i64;
  at: [usize, usize] | undefined;
  constructor(seen: Map<usize, usize>, assigned: Map<usize, usize>, hasShared: boolean, renumber: boolean, by: i64, at?: [usize, usize]) {
    this.seen = seen;
    this.assigned = assigned;
    this.hasShared = hasShared;
    this.renumber = renumber;
    this.by = by;
    this.at = at;
  }
  isEmpty(): boolean {
    return false;
  }
  currentList(_owner: usize, _field: string): Stmt[] | undefined {
    return undefined;
  }
  current(n: Expr): Expr {
    if (!this.hasShared) {
      const id = idOfExpr(n);
      return withIdExpr(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    }
    const [id, mark] = markExpr(n);
    if (this.seen.get(id) === mark) return withIdExpr(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    return n;
  }
  currentStmt(n: Stmt): Stmt {
    if (!this.hasShared) {
      const id = idOfStmt(n);
      return withIdStmt(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    }
    const [id, mark] = markStmt(n);
    if (this.seen.get(id) === mark) return withIdStmt(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    return n;
  }
  currentTypeNode(n: TypeNode): TypeNode {
    if (!this.hasShared) {
      const id = idOfTypeNode(n);
      return withIdTypeNode(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    }
    const [id, mark] = markTypeNode(n);
    if (this.seen.get(id) === mark) return withIdTypeNode(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    return n;
  }
  currentTupleElement(n: TupleElement): TupleElement {
    if (!this.hasShared) {
      const id = idOfTupleElement(n);
      return withIdTupleElement(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    }
    const [id, mark] = markTupleElement(n);
    if (this.seen.get(id) === mark) return withIdTupleElement(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    return n;
  }
  currentTypeMember(n: TypeMember): TypeMember {
    if (!this.hasShared) {
      const id = idOfTypeMember(n);
      return withIdTypeMember(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    }
    const [id, mark] = markTypeMember(n);
    if (this.seen.get(id) === mark) return withIdTypeMember(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    return n;
  }
  currentObjectProp(n: ObjectProp): ObjectProp {
    if (!this.hasShared) {
      const id = idOfObjectProp(n);
      return withIdObjectProp(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    }
    const [id, mark] = markObjectProp(n);
    if (this.seen.get(id) === mark) return withIdObjectProp(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    return n;
  }
  currentClassNode(n: ClassNode): ClassNode {
    if (!this.hasShared) {
      const id = idOfClassNode(n);
      return withIdClassNode(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    }
    const [id, mark] = markClassNode(n);
    if (this.seen.get(id) === mark) return withIdClassNode(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    return n;
  }
  currentClassMember(n: ClassMember): ClassMember {
    if (!this.hasShared) {
      const id = idOfClassMember(n);
      return withIdClassMember(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    }
    const [id, mark] = markClassMember(n);
    if (this.seen.get(id) === mark) return withIdClassMember(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    return n;
  }
  currentParam(n: Param): Param {
    if (!this.hasShared) {
      const id = idOfParam(n);
      return withIdParam(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    }
    const [id, mark] = markParam(n);
    if (this.seen.get(id) === mark) return withIdParam(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    return n;
  }
  currentPattern(n: Pattern): Pattern {
    if (!this.hasShared) {
      const id = idOfPattern(n);
      return withIdPattern(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    }
    const [id, mark] = markPattern(n);
    if (this.seen.get(id) === mark) return withIdPattern(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    return n;
  }
  currentMatchArm(n: MatchArm): MatchArm {
    if (!this.hasShared) {
      const id = idOfMatchArm(n);
      return withIdMatchArm(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    }
    const [id, mark] = markMatchArm(n);
    if (this.seen.get(id) === mark) return withIdMatchArm(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    return n;
  }
  currentPatternProp(n: PatternProp): PatternProp {
    if (!this.hasShared) {
      const id = idOfPatternProp(n);
      return withIdPatternProp(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    }
    const [id, mark] = markPatternProp(n);
    if (this.seen.get(id) === mark) return withIdPatternProp(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    return n;
  }
  currentSpecifier(n: Specifier): Specifier {
    if (!this.hasShared) {
      const id = idOfSpecifier(n);
      return withIdSpecifier(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    }
    const [id, mark] = markSpecifier(n);
    if (this.seen.get(id) === mark) return withIdSpecifier(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    return n;
  }
  currentEnumMember(n: EnumMember): EnumMember {
    if (!this.hasShared) {
      const id = idOfEnumMember(n);
      return withIdEnumMember(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    }
    const [id, mark] = markEnumMember(n);
    if (this.seen.get(id) === mark) return withIdEnumMember(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    return n;
  }
  currentSwitchCase(n: SwitchCase): SwitchCase {
    if (!this.hasShared) {
      const id = idOfSwitchCase(n);
      return withIdSwitchCase(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    }
    const [id, mark] = markSwitchCase(n);
    if (this.seen.get(id) === mark) return withIdSwitchCase(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    return n;
  }
  currentDeclarator(n: Declarator): Declarator {
    if (!this.hasShared) {
      const id = idOfDeclarator(n);
      return withIdDeclarator(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    }
    const [id, mark] = markDeclarator(n);
    if (this.seen.get(id) === mark) return withIdDeclarator(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    return n;
  }
  currentTypeParam(n: TypeParam): TypeParam {
    if (!this.hasShared) {
      const id = idOfTypeParam(n);
      return withIdTypeParam(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    }
    const [id, mark] = markTypeParam(n);
    if (this.seen.get(id) === mark) return withIdTypeParam(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    return n;
  }
  currentTypeAlias(n: TypeAlias): TypeAlias {
    if (!this.hasShared) {
      const id = idOfTypeAlias(n);
      return withIdTypeAlias(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    }
    const [id, mark] = markTypeAlias(n);
    if (this.seen.get(id) === mark) return withIdTypeAlias(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    return n;
  }
  currentInterface(n: Interface): Interface {
    if (!this.hasShared) {
      const id = idOfInterface(n);
      return withIdInterface(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    }
    const [id, mark] = markInterface(n);
    if (this.seen.get(id) === mark) return withIdInterface(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    return n;
  }
  currentFunc(n: Func): Func {
    if (!this.hasShared) {
      const id = idOfFunc(n);
      return withIdFunc(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    }
    const [id, mark] = markFunc(n);
    if (this.seen.get(id) === mark) return withIdFunc(n, this.renumber ? this.assigned.get(id)! : id, this.by, this.at);
    return n;
  }
}

function makeRenumber(root: AnyNode, next: () => usize, by: usize = 0): Applier {
  const [seen, order, hasShared] = collectIds(root);
  let assigned = new Map<usize, usize>();
  for (const id of order) assigned.set(id, next());
  return new Applier(seen, assigned, hasShared, true, by as i64);
}

function makeShift(root: AnyNode, by: i64): Applier {
  const [seen, _order, hasShared] = collectIds(root);
  return new Applier(seen, new Map<usize, usize>(), hasShared, false, by);
}

function makeRespan(root: AnyNode, at: Ref<Span>): Applier {
  const [seen, _order, hasShared] = collectIds(root);
  return new Applier(seen, new Map<usize, usize>(), hasShared, false, 0, [at.start, at.end]);
}

// Gives every node in `tree` a fresh id. A node reached twice, as a shared object, keeps the
// first one it got: nodes are told apart by their ids, which are all found before any changes, as
// a fresh id could equal an old one. `next` gives the ids.
export function renumberExpr(tree: Expr, next: () => usize): Expr {
  const a = makeRenumber({ of: "expr", node: tree }, next);
  return rebuiltExpr(tree, a);
}

export function renumberStmt(tree: Stmt, next: () => usize): Stmt {
  const a = makeRenumber({ of: "stmt", node: tree }, next);
  return rebuiltStmt(tree, a);
}

export function renumberStmts(tree: Stmt[], next: () => usize, by: usize = 0): Stmt[] {
  const a = makeRenumber({ of: "stmts", node: tree }, next, by);
  rebuiltStmts(tree, a);
  return tree;
}

export function renumberParam(tree: Param, next: () => usize): Param {
  const a = makeRenumber({ of: "param", node: tree }, next);
  return rebuiltParam(tree, a);
}

export function renumberTypeNode(tree: TypeNode, next: () => usize): TypeNode {
  const a = makeRenumber({ of: "typeNode", node: tree }, next);
  return rebuiltTypeNode(tree, a);
}

// Moves every span in a parsed tree by `by`, for a source placed past others in one program.
export function shiftSpansExpr(tree: Expr, by: usize): Expr {
  return movedExpr(tree, by as i64);
}

export function shiftSpansStmt(tree: Stmt, by: usize): Stmt {
  return movedStmt(tree, by as i64);
}

export function shiftSpansStmts(tree: Mut<Stmt[]>, by: usize): void {
  const a = makeShift({ of: "stmts", node: tree }, by as i64);
  rebuiltStmts(tree, a);
}

// Every node in a tree moved by `by`, earlier when it is below 0.
export function movedExpr(tree: Expr, by: i64): Expr {
  const a = makeShift({ of: "expr", node: tree }, by);
  return rebuiltExpr(tree, a);
}

export function movedStmt(tree: Stmt, by: i64): Stmt {
  const a = makeShift({ of: "stmt", node: tree }, by);
  return rebuiltStmt(tree, a);
}

export function movedTypeNode(tree: TypeNode, by: i64): TypeNode {
  const a = makeShift({ of: "typeNode", node: tree }, by);
  return rebuiltTypeNode(tree, a);
}

export function movedParam(tree: Param, by: i64): Param {
  const a = makeShift({ of: "param", node: tree }, by);
  return rebuiltParam(tree, a);
}

export function movedTypeParam(tree: TypeParam, by: i64): TypeParam {
  const a = makeShift({ of: "typeParam", node: tree }, by);
  return rebuiltTypeParam(tree, a);
}

// Gives every node in `tree` the span `at`.
export function respanExpr(tree: Expr, at: Ref<Span>): Expr {
  const a = makeRespan({ of: "expr", node: tree }, at);
  return rebuiltExpr(tree, a);
}

export function respanFunc(tree: Func, at: Ref<Span>): Func {
  const a = makeRespan({ of: "func", node: tree }, at);
  return rebuiltFunc(tree, a);
}

export function respanClassMember(tree: ClassMember, at: Ref<Span>): ClassMember {
  const a = makeRespan({ of: "classMember", node: tree }, at);
  return rebuiltClassMember(tree, a);
}

// A node's id, which every table keys it by: a node and the replacement lowering made for it share
// one, so a table reads one entry for either.
function idOf(node: Ref<Id>): usize {
  const id = node.id;
  assert(typeof id === "number", "internal error: node has no id");
  return id;
}

// A `Map` from nodes, keyed by their ids, holding each node as a `Map` holds its keys. Iterating
// gives each node as it was first stored, not a replacement lowering made for it since.
export class NodeMap<K extends Id, V> {
  // Each node and its value under the node's id, apart so a value can change while the node
  // stored for it stays.
  private nodes = new Map<usize, K>();
  private nodeValues = new Map<usize, V>();

  constructor(entries?: [K, V][]) {
    if (entries !== undefined) {
      let a = entries!;
      while (a.length > 0) {
        const [node, value] = a.shift()!;
        this.set(node, value);
      }
    }
  }

  get size(): usize {
    return this.nodes.size;
  }

  get(node: Ref<K>): V | undefined {
    return this.nodeValues.get(idOf(node));
  }

  has(node: Ref<K>): boolean {
    return this.nodes.has(idOf(node));
  }

  // The value for a node by its id, for a reader holding a node of a wider type than `K`.
  getById(id: usize): V | undefined {
    return this.nodeValues.get(id);
  }

  set(this: Mut<this>, node: K, value: V): Mut<this> {
    const id = idOf(node);
    this.nodes.set(id, node);
    this.nodeValues.set(id, value);
    return this;
  }

  // The ids of the nodes held, in the order they were first stored.
  ids(): usize[] {
    let out: usize[] = [];
    for (const id of this.nodes.keys()) out.push(id);
    return out;
  }

  // Gives the node of id `id`, if one is held, a new value, keeping the node stored for it.
  setValueById(this: Mut<this>, id: usize, value: V): void {
    if (this.nodes.has(id)) this.nodeValues.set(id, value);
  }

  delete(this: Mut<this>, node: Ref<K>): boolean {
    const id = idOf(node);
    this.nodeValues.delete(id);
    return this.nodes.delete(id);
  }

  clear(this: Mut<this>): void {
    this.nodes.clear();
    this.nodeValues.clear();
  }

  *keys(): IterableIterator<K> {
    for (const k of this.nodes.keys()) yield this.nodes.get(k)!;
  }

  *values(): IterableIterator<V> {
    for (const k of this.nodes.keys()) yield this.nodeValues.get(k)!;
  }

  *entries(): IterableIterator<[K, V]> {
    for (const k of this.nodes.keys()) yield [this.nodes.get(k)!, this.nodeValues.get(k)!];
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  forEach(each: (value: V, node: K) => void): void {
    for (const k of this.nodes.keys()) each(this.nodeValues.get(k)!, this.nodes.get(k)!);
  }

  copy(): NodeMap<K, V> {
    // The pairs are gathered by hand: spreading this class's own generator here isn't compiled
    // natively yet.
    let pairs: [K, V][] = [];
    for (const k of this.nodes.keys()) pairs.push([this.nodes.get(k)!, this.nodeValues.get(k)!]);
    return new NodeMap<K, V>(pairs);
  }
}

// A `Set` of nodes, keyed by their ids, holding each node as a `Set` holds its members. Iterating
// gives each node as it was first added, not a replacement lowering made for it since.
export class NodeSet<K extends Id> {
  private table = new Map<usize, K>();

  constructor(nodes?: K[]) {
    if (nodes !== undefined) {
      let a = nodes!;
      while (a.length > 0) this.add(a.shift()!);
    }
  }

  get size(): usize {
    return this.table.size;
  }

  has(node: Ref<K>): boolean {
    return this.table.has(idOf(node));
  }
  // Whether a node of this id is in the set, for a node of a type the set doesn't hold.
  hasId(id: usize): boolean {
    return this.table.has(id);
  }


  add(this: Mut<this>, node: K): Mut<this> {
    this.table.set(idOf(node), node);
    return this;
  }

  delete(this: Mut<this>, node: Ref<K>): boolean {
    return this.table.delete(idOf(node));
  }

  clear(this: Mut<this>): void {
    this.table.clear();
  }

  *values(): IterableIterator<K> {
    for (const k of this.table.keys()) yield this.table.get(k)!;
  }

  [Symbol.iterator](): IterableIterator<K> {
    return this.values();
  }

  forEach(each: (node: K) => void): void {
    for (const k of this.table.keys()) each(this.table.get(k)!);
  }

  items(): K[] {
    let out: K[] = [];
    for (const k of this.table.keys()) out.push(this.table.get(k)!);
    return out;
  }

  copy(): NodeSet<K> {
    return new NodeSet<K>(this.items());
  }
}

// The nodes lowering replaced, each under the id of the node it replaced, which the replacement
// takes, so every table keyed by node reads the same entry for either. A tree reads a replacement
// through `current` until a rebuild puts it in place: after a body's check, or at the end of a
// pass that lowers the tree before checking.
// A replacement as a rebuilt body holds it, copied out for its table.
type Refreshed =
  | { of: "stmt"; node: Stmt }
  | { of: "expr"; node: Expr }
  | { of: "declarator"; node: Declarator }
  | { of: "param"; node: Param }
  | { of: "pattern"; node: Pattern }
  | { of: "typeNode"; node: TypeNode }
  | { of: "objectProp"; node: ObjectProp }
  | { of: "classMember"; node: ClassMember }
  | { of: "typeMember"; node: TypeMember }
  | { of: "patternProp"; node: PatternProp };

export class Rewrites implements Replacements {
  private exprs: Map<usize, Expr> = new Map<usize, Expr>();
  private stmts = new Map<usize, Stmt>();
  // Statement lists checking edited, keyed by the body they are in, their owner's id and field:
  // each copy of a generic class's body edits its own. A rebuild reads those of `rebuilding`.
  private lists = new Map<string, Stmt[]>();
  rebuilding: usize | undefined = undefined;
  private funcs = new Map<usize, Func>();
  private typeAliases = new Map<usize, TypeAlias>();
  private interfaces = new Map<usize, Interface>();
  private declarators = new Map<usize, Declarator>();
  private params = new Map<usize, Param>();
  private patterns = new Map<usize, Pattern>();
  private typeNodes = new Map<usize, TypeNode>();
  private objectProps = new Map<usize, ObjectProp>();
  private classMembers = new Map<usize, ClassMember>();
  private typeMembers = new Map<usize, TypeMember>();
  private patternProps = new Map<usize, PatternProp>();
  private hasChanges: boolean = false;

  isEmpty(): boolean {
    return !this.hasChanges;
  }

  // Records `by`, a node made for the purpose, as `node`'s replacement, and gives it.
  replace(this: Mut<this>, node: Ref<Id>, by: Expr): Expr {
    return this.replaceAt(node.id, by);
  }

  // Records `by` as the replacement of the node of id `id`, for a caller holding a node whose
  // type has no `id` field of its own, as a union of nodes has none.
  replaceAt(this: Mut<this>, id: usize, by: Expr): Expr {
    this.hasChanges = true;
    this.made++;
    this.madeAt.set(id, this.made);
    this.exprs.set(id, withIdExpr(by, id, 0));
    return this.exprs.get(id)!;
  }

  // Instances may share a body, each checking and rebuilding it. Its replacements are in place
  // after the first rebuild and keep their nodes' ids, so a later one puts back only those its own
  // check made: another copy's, made since under the same ids, would replace them.
  private made: usize = 0;
  private madeAt = new Map<usize, usize>();
  private rebuilt = new Set<usize>();
  // How many replacements were made before the check of each body being checked began.
  private checks: usize[] = [];
  private from: usize = 0;

  startCheck(this: Mut<this>): void {
    this.checks.push(this.made);
  }

  endCheck(this: Mut<this>): void {
    this.checks.pop();
  }

  startRebuild(this: Mut<this>, body: usize): void {
    this.rebuilding = body;
    this.from = this.rebuilt.has(body) && this.checks.length > 0 ? this.checks[this.checks.length - 1]! + 1 : 0;
    this.rebuilt.add(body);
  }

  // Each replacement as it stands in a rebuilt body: a later check of the body reads replacements
  // through this table, and the body holds rebuilt copies of them, not the table's own.
  refresh(this: Mut<this>, body: Ref<Stmt[]>): void {
    if (!this.hasChanges) return;
    let wanted = new Set<string>();
    for (const id of this.stmts.keys()) wanted.add(`stmt ${id}`);
    for (const id of this.exprs.keys()) wanted.add(`expr ${id}`);
    for (const id of this.declarators.keys()) wanted.add(`declarator ${id}`);
    for (const id of this.params.keys()) wanted.add(`param ${id}`);
    for (const id of this.patterns.keys()) wanted.add(`pattern ${id}`);
    for (const id of this.typeNodes.keys()) wanted.add(`typeNode ${id}`);
    for (const id of this.objectProps.keys()) wanted.add(`objectProp ${id}`);
    for (const id of this.classMembers.keys()) wanted.add(`classMember ${id}`);
    for (const id of this.typeMembers.keys()) wanted.add(`typeMember ${id}`);
    for (const id of this.patternProps.keys()) wanted.add(`patternProp ${id}`);
    let found: Refreshed[] = [];
    for (const s of body) {
      walk({ of: "stmt", node: s }, (n) => {
        if (!wanted.has(`${n.of} ${nodeIdOf(n)}`)) return;
        if (n.of === "stmt") found.push({ of: "stmt", node: cloneStmt(n.node) });
        else if (n.of === "expr") found.push({ of: "expr", node: cloneExpr(n.node) });
        else if (n.of === "declarator") found.push({ of: "declarator", node: cloneDeclarator(n.node) });
        else if (n.of === "param") found.push({ of: "param", node: cloneParam(n.node) });
        else if (n.of === "pattern") found.push({ of: "pattern", node: clonePattern(n.node) });
        else if (n.of === "typeNode") found.push({ of: "typeNode", node: cloneTypeNode(n.node) });
        else if (n.of === "objectProp") found.push({ of: "objectProp", node: cloneObjectProp(n.node) });
        else if (n.of === "classMember") found.push({ of: "classMember", node: cloneClassMember(n.node) });
        else if (n.of === "typeMember") found.push({ of: "typeMember", node: cloneTypeMember(n.node) });
        else if (n.of === "patternProp") found.push({ of: "patternProp", node: clonePatternProp(n.node) });
      });
    }
    while (found.length > 0) {
      const n = found.pop()!;
      switch (n.of) {
        case "stmt": this.stmts.set(idOfStmt(n.node), n.node); break;
        case "expr": this.exprs.set(idOfExpr(n.node), n.node); break;
        case "declarator": this.declarators.set(idOfDeclarator(n.node), n.node); break;
        case "param": this.params.set(idOfParam(n.node), n.node); break;
        case "pattern": this.patterns.set(idOfPattern(n.node), n.node); break;
        case "typeNode": this.typeNodes.set(idOfTypeNode(n.node), n.node); break;
        case "objectProp": this.objectProps.set(idOfObjectProp(n.node), n.node); break;
        case "classMember": this.classMembers.set(idOfClassMember(n.node), n.node); break;
        case "typeMember": this.typeMembers.set(idOfTypeMember(n.node), n.node); break;
        case "patternProp": this.patternProps.set(idOfPatternProp(n.node), n.node); break;
      }
    }
  }

  endRebuild(this: Mut<this>): void {
    // A later check of the body starts from the lists checking edited, so they are rebuilt too:
    // the body holds copies of them, not the lists themselves.
    const prefix = this.rebuilding !== undefined ? `${this.rebuilding} ` : " ";
    const keys = [...this.lists.keys()].filter((k) => k.startsWith(prefix));
    for (const k of keys) {
      let list = this.lists.get(k)!.slice();
      rebuiltStmts(list, this);
      this.lists.set(k, list);
    }
    this.rebuilding = undefined;
    this.from = 0;
  }

  current(node: Expr): Expr {
    if (this.exprs.size === 0) return node;
    const id = idOfExpr(node);
    if (this.from > 0 && (this.madeAt.get(id) ?? 0) < this.from) return node;
    return this.exprs.get(id) ?? node;
  }

  // The node replacing `node`, if one does; for a caller holding `node` by reference, which keeps
  // reading `node` itself when this gives nothing.
  rewritten(node: Ref<Expr>): Expr | undefined {
    if (this.exprs.size === 0) return undefined;
    return this.exprs.get(idOfExpr(node));
  }

  replaceStmt(this: Mut<this>, node: Ref<Stmt>, by: Stmt): Stmt {
    this.hasChanges = true;
    const id = idOfStmt(node);
    const [s, copy] = dup(withIdStmt(by, id, 0));
    this.stmts.set(id, s);
    if (copy.kind === "function") this.funcs.set(id, copy);
    else if (copy.kind === "typeAlias") this.typeAliases.set(id, copy);
    else if (copy.kind === "interface") this.interfaces.set(id, copy);
    return this.stmts.get(id)!;
  }

  currentStmt(node: Stmt): Stmt {
    if (this.stmts.size === 0) return node;
    return this.stmts.get(idOfStmt(node)) ?? node;
  }

  // Records the list `owner` holds in `field`, in the body `body`, once checking has edited it.
  replaceList(this: Mut<this>, body: usize, owner: usize, field: string, list: Stmt[]): void {
    this.hasChanges = true;
    this.lists.set(`${body} ${owner} ${field}`, list);
  }

  listIn(body: usize, owner: usize, field: string): Stmt[] | undefined {
    if (this.lists.size === 0) return undefined;
    return this.lists.get(`${body} ${owner} ${field}`);
  }

  currentList(owner: usize, field: string): Stmt[] | undefined {
    return this.rebuilding === undefined ? undefined : this.listIn(this.rebuilding, owner, field);
  }

  replaceFunc(this: Mut<this>, node: Ref<Id>, by: Func): Func {
    this.hasChanges = true;
    const id = node.id;
    const [f, copy] = dup(withIdFunc(by, id, 0));
    this.funcs.set(id, f);
    this.stmts.set(id, copy);
    return this.funcs.get(id)!;
  }

  replaceDeclarator(this: Mut<this>, node: Ref<Id>, by: Declarator): Declarator {
    this.hasChanges = true;
    const id = node.id;
    this.declarators.set(id, withIdDeclarator(by, id, 0));
    return this.declarators.get(id)!;
  }

  currentDeclarator(node: Declarator): Declarator {
    if (this.declarators.size === 0) return node;
    return this.declarators.get(node.id) ?? node;
  }

  // The declarator replacing `node`, if one does, for a caller holding `node` by reference.
  rewrittenDeclarator(node: Ref<Declarator>): Declarator | undefined {
    if (this.declarators.size === 0) return undefined;
    return this.declarators.get(node.id);
  }

  replaceParam(this: Mut<this>, node: Ref<Id>, by: Param): Param {
    this.hasChanges = true;
    const id = node.id;
    this.params.set(id, withIdParam(by, id, 0));
    return this.params.get(id)!;
  }

  currentParam(node: Param): Param {
    if (this.params.size === 0) return node;
    return this.params.get(node.id) ?? node;
  }

  replacePattern(this: Mut<this>, node: Ref<Id>, by: Pattern): Pattern {
    this.hasChanges = true;
    const id = node.id;
    this.patterns.set(id, withIdPattern(by, id, 0));
    return this.patterns.get(id)!;
  }

  currentPattern(node: Pattern): Pattern {
    if (this.patterns.size === 0) return node;
    return this.patterns.get(idOfPattern(node)) ?? node;
  }

  replaceTypeNode(this: Mut<this>, node: Ref<Id>, by: TypeNode): TypeNode {
    this.hasChanges = true;
    const id = node.id;
    this.typeNodes.set(id, withIdTypeNode(by, id, 0));
    return this.typeNodes.get(id)!;
  }

  currentTypeNode(node: TypeNode): TypeNode {
    if (this.typeNodes.size === 0) return node;
    return this.typeNodes.get(idOfTypeNode(node)) ?? node;
  }

  replaceObjectProp(this: Mut<this>, node: Ref<Id>, by: ObjectProp): ObjectProp {
    this.hasChanges = true;
    const id = node.id;
    this.objectProps.set(id, withIdObjectProp(by, id, 0));
    return this.objectProps.get(id)!;
  }

  currentObjectProp(node: ObjectProp): ObjectProp {
    if (this.objectProps.size === 0) return node;
    return this.objectProps.get(idOfObjectProp(node)) ?? node;
  }

  replaceClassMember(this: Mut<this>, node: Ref<Id>, by: ClassMember): ClassMember {
    this.hasChanges = true;
    const id = node.id;
    this.classMembers.set(id, withIdClassMember(by, id, 0));
    return this.classMembers.get(id)!;
  }

  currentClassMember(node: ClassMember): ClassMember {
    if (this.classMembers.size === 0) return node;
    return this.classMembers.get(idOfClassMember(node)) ?? node;
  }

  replaceTypeMember(this: Mut<this>, node: Ref<Id>, by: TypeMember): TypeMember {
    this.hasChanges = true;
    const id = node.id;
    this.typeMembers.set(id, withIdTypeMember(by, id, 0));
    return this.typeMembers.get(id)!;
  }

  currentTypeMember(node: TypeMember): TypeMember {
    if (this.typeMembers.size === 0) return node;
    return this.typeMembers.get(idOfTypeMember(node)) ?? node;
  }

  replacePatternProp(this: Mut<this>, node: Ref<Id>, by: PatternProp): PatternProp {
    this.hasChanges = true;
    const id = node.id;
    this.patternProps.set(id, withIdPatternProp(by, id, 0));
    return this.patternProps.get(id)!;
  }

  currentPatternProp(node: PatternProp): PatternProp {
    if (this.patternProps.size === 0) return node;
    return this.patternProps.get(node.id) ?? node;
  }

  currentTupleElement(node: TupleElement): TupleElement {
    return node;
  }

  currentClassNode(node: ClassNode): ClassNode {
    return node;
  }

  currentMatchArm(node: MatchArm): MatchArm {
    return node;
  }

  currentSpecifier(node: Specifier): Specifier {
    return node;
  }

  currentEnumMember(node: EnumMember): EnumMember {
    return node;
  }

  currentSwitchCase(node: SwitchCase): SwitchCase {
    return node;
  }

  currentTypeParam(node: TypeParam): TypeParam {
    return node;
  }

  currentTypeAlias(node: TypeAlias): TypeAlias {
    if (this.typeAliases.size === 0) return node;
    return this.typeAliases.get(node.id) ?? node;
  }

  currentInterface(node: Interface): Interface {
    if (this.interfaces.size === 0) return node;
    return this.interfaces.get(node.id) ?? node;
  }

  currentFunc(node: Func): Func {
    if (this.funcs.size === 0) return node;
    return this.funcs.get(node.id) ?? node;
  }

  evictStmt(this: Mut<this>, id: usize, by: Stmt): void {
    this.hasChanges = true;
    this.stmts.set(id, by);
  }

  getExpr(id: usize): Expr | undefined {
    return this.exprs.get(id);
  }

  getStmt(id: usize): Stmt | undefined {
    return this.stmts.get(id);
  }

  getTypeNode(id: usize): TypeNode | undefined {
    return this.typeNodes.get(id);
  }

  getPattern(id: usize): Pattern | undefined {
    return this.patterns.get(id);
  }
}

// What an instance's tables of expressions keep of each one: its id and span, and the few parts
// their readers look at, rather than the expression itself. A copy of a node holds every node under
// it, and an array of expressions holds each at the size of the largest kind, so the types, calls
// and coercions tables keeping a copy per entry held most of the program's expressions many times
// over: a quarter of what checking the compiler keeps live.
export type Site = { id: usize; start: usize; end: usize; kind: Expr["kind"]; name?: string; op?: string; object?: { id: usize; end: usize }; left?: usize; right?: usize; callee?: Callee };

// A call's callee, as a site keeps it: what it is, where, and the name it calls by.
export type Callee = { kind: Expr["kind"]; start: usize; end: usize; name?: string; objectEnd?: usize };

// The site of `e`, as a SiteTable keeps it.
export function siteOf(e: Ref<Expr>): Site {
  let s: Site = { id: e.id, start: e.start, end: e.end, kind: e.kind };
  if (e.kind === "ident") s.name = e.name;
  if (e.kind === "member") {
    s.name = e.name;
    s.object = { id: e.object.id, end: e.object.end };
  }
  if (e.kind === "binary") {
    s.op = e.op;
    s.left = e.left.id;
    s.right = e.right.id;
  }
  if (e.kind === "call" || e.kind === "new") {
    const c: Ref<Expr> = e.callee;
    let callee: Callee = { kind: c.kind, start: c.start, end: c.end };
    if (c.kind === "ident") callee.name = c.name;
    if (c.kind === "member") {
      callee.name = c.name;
      callee.objectEnd = c.object.end;
    }
    s.callee = callee;
  }
  return s;
}

// Each expression's value by its id, beside the expression's site: an instance's `types`, `calls`
// and `coercions`.
export class SiteTable<V> {
  private sites = new Map<usize, Site>();
  private siteValues = new Map<usize, V>();

  get size(): usize {
    return this.sites.size;
  }

  get(node: Ref<Expr>): V | undefined {
    return this.siteValues.get(node.id);
  }

  has(node: Ref<Expr>): boolean {
    return this.sites.has(node.id);
  }

  getById(id: usize): V | undefined {
    return this.siteValues.get(id);
  }

  set(this: Mut<this>, node: Ref<Expr>, value: V): Mut<this> {
    const id = node.id;
    if (!this.sites.has(id)) this.sites.set(id, siteOf(node));
    this.siteValues.set(id, value);
    return this;
  }

  // A value for an expression known by its site, as when a table is rewritten from another.
  setSite(this: Mut<this>, site: Site, value: V): Mut<this> {
    const id = site.id;
    if (!this.sites.has(id)) this.sites.set(id, site);
    this.siteValues.set(id, value);
    return this;
  }

  ids(): usize[] {
    let out: usize[] = [];
    for (const id of this.sites.keys()) out.push(id);
    return out;
  }

  setValueById(this: Mut<this>, id: usize, value: V): void {
    if (this.sites.has(id)) this.siteValues.set(id, value);
  }

  delete(this: Mut<this>, node: Ref<Expr>): boolean {
    const id = node.id;
    this.siteValues.delete(id);
    return this.sites.delete(id);
  }

  clear(this: Mut<this>): void {
    this.sites.clear();
    this.siteValues.clear();
  }

  *keys(): IterableIterator<Site> {
    for (const k of this.sites.keys()) yield this.sites.get(k)!;
  }

  *values(): IterableIterator<V> {
    for (const k of this.sites.keys()) yield this.siteValues.get(k)!;
  }

  *entries(): IterableIterator<[Site, V]> {
    for (const k of this.sites.keys()) yield [this.sites.get(k)!, this.siteValues.get(k)!];
  }

  [Symbol.iterator](): IterableIterator<[Site, V]> {
    return this.entries();
  }
}
