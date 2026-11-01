
// Node ids, and the tables keyed by them. Fish's `Map` and `Set` key on strings and integers,
// not objects, so the compiler's per-node tables key on each node's `id`.

import type { Id } from "./ids.ts";
import type { Span } from "./parser.ts";
import { childrenOfClassMember, childrenOfClassNode, childrenOfDeclarator, childrenOfEnumMember, childrenOfExpr, childrenOfFunc, childrenOfInterface, childrenOfJsName, childrenOfMatchArm, childrenOfObjectProp, childrenOfParam, childrenOfPattern, childrenOfPatternProp, childrenOfSpecifier, childrenOfStmt, childrenOfStmts, childrenOfSwitchCase, childrenOfTupleElement, childrenOfTypeAlias, childrenOfTypeMember, childrenOfTypeNode, childrenOfTypeParam, type Visitor } from "./walk.ts";

export { nextId, type Id, type Ids } from "./ids.ts";

// A node of any of the parser's types, tagged with which it is, since kinds repeat across them,
// or a list of statements, `stmts`, which is a scope.
export type AnyNode = { [K in keyof Visitor]: { of: K; node: Parameters<Visitor[K]>[0] } }[keyof Visitor];
export type NodeOf<K extends keyof Visitor> = Parameters<Visitor[K]>[0];
// The node types a walk can start from: nodes, or arrays of them.
export type RootKind = Exclude<keyof Visitor, "stmts">;

const CHILDREN: { [K in keyof Visitor]: (n: NodeOf<K>, v: Visitor) => void } = {
  typeNode: childrenOfTypeNode, expr: childrenOfExpr, stmt: childrenOfStmt, tupleElement: childrenOfTupleElement,
  typeMember: childrenOfTypeMember, objectProp: childrenOfObjectProp, classNode: childrenOfClassNode,
  classMember: childrenOfClassMember, param: childrenOfParam, pattern: childrenOfPattern, matchArm: childrenOfMatchArm,
  patternProp: childrenOfPatternProp, specifier: childrenOfSpecifier, enumMember: childrenOfEnumMember,
  switchCase: childrenOfSwitchCase, declarator: childrenOfDeclarator, typeParam: childrenOfTypeParam,
  typeAlias: childrenOfTypeAlias, interface: childrenOfInterface, jsName: childrenOfJsName, func: childrenOfFunc, stmts: childrenOfStmts,
};
const KINDS = Object.keys(CHILDREN) as (keyof Visitor)[];

// A visitor handing every node it is given to `each`, tagged.
function tagging(each: (n: AnyNode) => void): Visitor {
  const v: Partial<Record<keyof Visitor, (node: never) => void>> = {};
  for (const of of KINDS) v[of] = (node: never) => each({ of, node } as AnyNode);
  return v as Visitor;
}

// Calls `visit` on each node `n` holds, in the order its type lists the fields, with a list of
// statements given whole.
export function forEachChild(n: AnyNode, visit: (child: AnyNode) => void) {
  (CHILDREN[n.of] as (n: unknown, v: Visitor) => void)(n.node, tagging(visit));
}

// The nodes `n` holds, in the order its type lists the fields.
export function childrenOf(n: AnyNode): AnyNode[] {
  const found: AnyNode[] = [];
  forEachChild(n, (c) => found.push(c));
  return found;
}

// Calls `each` on `roots`, nodes of type `of`, and every node under them, each node before those
// it holds; `each` returning false skips those. Lists of statements are walked through, not given.
export function walk<K extends RootKind>(of: K, roots: NodeOf<K> | NodeOf<K>[] | undefined, each: (n: AnyNode) => boolean | void) {
  const v = tagging((n) => {
    if (n.of === "stmts" || each(n) !== false) (CHILDREN[n.of] as (n: unknown, v: Visitor) => void)(n.node, v);
  });
  const list: unknown[] = roots === undefined ? [] : Array.isArray(roots) ? roots : [roots];
  for (const node of list) (v[of] as (n: unknown) => void)(node);
}

// Whether `found` picks out a node under `roots`, nodes of type `of`, themselves included.
export function someNode<K extends RootKind>(of: K, roots: NodeOf<K> | NodeOf<K>[] | undefined, found: (n: AnyNode) => boolean): boolean {
  let hit = false;
  walk(of, roots, (n) => !hit && !(hit = found(n)));
  return hit;
}

// Gives every node in `tree` a fresh id: a copy made by `structuredClone` or deserializing shares
// its original's ids, or another process's. A node reached twice, as a shared object, keeps the
// first one it got. `next` gives the ids.
export function renumber<K extends RootKind, T extends NodeOf<K> | NodeOf<K>[]>(of: K, tree: T, next: () => usize): T {
  const seen = new Set<unknown>();
  walk(of, tree, ({ node }) => {
    if (seen.has(node)) return false;
    seen.add(node);
    if (typeof (node as Partial<Id>).id === "number") (node as Id).id = next();
  });
  return tree;
}

// Moves every span in a parsed tree, nodes of type `of`, by `by`, for a source placed past others
// in one program.
export function shiftSpans<K extends RootKind>(of: K, tree: NodeOf<K> | NodeOf<K>[], by: usize) {
  const seen = new Set<unknown>();
  walk(of, tree, ({ node }) => {
    if (seen.has(node)) return false;
    seen.add(node);
    const n = node as Partial<Span>;
    if (typeof n.start === "number") n.start += by;
    if (typeof n.end === "number") n.end += by;
  });
}

// The node behind each id is kept, so a different object arriving with an id already in use, a
// copy that kept its original's id, fails loudly instead of reading or replacing its entry.
function idOf(node: Id, known: Id | undefined): usize {
  const id = node.id;
  if (typeof id !== "number") throw new Error(`internal error: a ${(node as { kind?: string }).kind ?? "node"} node has no id`);
  if (known !== undefined && known !== node) throw new Error(`internal error: two nodes share id ${id}`);
  return id;
}

// A `Map` from nodes, keyed by their ids, holding each node as a `Map` holds its keys.
export class NodeMap<K extends Id, V> {
  private table = new Map<usize, { node: K; value: V }>();

  constructor(entries?: Iterable<readonly [K, V]>) {
    if (entries) for (const [node, value] of entries) this.set(node, value);
  }

  get size(): usize {
    return this.table.size;
  }

  get(node: K): V | undefined {
    return this.table.get(idOf(node, this.table.get(node.id)?.node))?.value;
  }

  has(node: K): boolean {
    return this.table.has(idOf(node, this.table.get(node.id)?.node));
  }

  set(node: K, value: V): this {
    this.table.set(idOf(node, this.table.get(node.id)?.node), { node, value });
    return this;
  }

  delete(node: K): boolean {
    return this.table.delete(idOf(node, this.table.get(node.id)?.node));
  }

  clear(): void {
    this.table.clear();
  }

  *keys(): IterableIterator<K> {
    for (const e of this.table.values()) yield e.node;
  }

  *values(): IterableIterator<V> {
    for (const e of this.table.values()) yield e.value;
  }

  *entries(): IterableIterator<[K, V]> {
    for (const e of this.table.values()) yield [e.node, e.value];
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  forEach(each: (value: V, node: K) => void): void {
    for (const e of this.table.values()) each(e.value, e.node);
  }
}

// A `Set` of nodes, keyed by their ids, holding each node as a `Set` holds its members.
export class NodeSet<K extends Id> {
  private table = new Map<usize, K>();

  constructor(nodes?: Iterable<K>) {
    if (nodes) for (const n of nodes) this.add(n);
  }

  get size(): usize {
    return this.table.size;
  }

  has(node: K): boolean {
    return this.table.has(idOf(node, this.table.get(node.id)));
  }

  add(node: K): this {
    this.table.set(idOf(node, this.table.get(node.id)), node);
    return this;
  }

  delete(node: K): boolean {
    return this.table.delete(idOf(node, this.table.get(node.id)));
  }

  clear(): void {
    this.table.clear();
  }

  values(): IterableIterator<K> {
    return this.table.values();
  }

  [Symbol.iterator](): IterableIterator<K> {
    return this.table.values();
  }

  forEach(each: (node: K) => void): void {
    for (const node of this.table.values()) each(node);
  }
}

// A `WeakMap` from nodes, keyed by their ids. It holds each node only weakly, for the identity
// check, so a table that outlives a program doesn't keep its tree alive, and drops an entry once
// its node is collected; like a `WeakMap`, it can't be iterated. Unlike one, it holds each value
// strongly, so a value that reaches its own node keeps that node alive.
export class WeakNodeMap<K extends Id, V> {
  private table = new Map<usize, { node: WeakRef<K>; value: V }>();
  private gone = new FinalizationRegistry<usize>((id) => this.table.delete(id));

  get(node: K): V | undefined {
    return this.table.get(idOf(node, this.table.get(node.id)?.node.deref()))?.value;
  }

  has(node: K): boolean {
    return this.table.has(idOf(node, this.table.get(node.id)?.node.deref()));
  }

  set(node: K, value: V): this {
    const held = this.table.get(node.id);
    if (!held) this.gone.register(node, node.id);
    this.table.set(idOf(node, held?.node.deref()), { node: new WeakRef(node), value });
    return this;
  }

  delete(node: K): boolean {
    return this.table.delete(idOf(node, this.table.get(node.id)?.node.deref()));
  }
}

// A `WeakSet` of nodes, keyed by their ids, holding each only weakly as `WeakNodeMap` does.
export class WeakNodeSet<K extends Id> {
  private table = new Map<usize, WeakRef<K>>();
  private gone = new FinalizationRegistry<usize>((id) => this.table.delete(id));

  has(node: K): boolean {
    return this.table.has(idOf(node, this.table.get(node.id)?.deref()));
  }

  add(node: K): this {
    const held = this.table.get(node.id);
    if (!held) this.gone.register(node, node.id);
    this.table.set(idOf(node, held?.deref()), new WeakRef(node));
    return this;
  }

  delete(node: K): boolean {
    return this.table.delete(idOf(node, this.table.get(node.id)?.deref()));
  }
}
