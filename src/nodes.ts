
// Node ids, and the tables keyed by them. Fish's `Map` and `Set` key on strings and integers,
// not objects, so the compiler's per-node tables key on each node's `id`.

import type { Id } from "./ids.ts";
import type { ClassMember, Declarator, Expr, ObjectProp, Param, Pattern, PatternProp, Span, Stmt, TypeMember, TypeNode } from "./parser.ts";
import { forEachChild as visitChildren, type AnyNode, type NodeTypes, type Visitor } from "./walk.ts";

export { nextId, type Id, type Ids } from "./ids.ts";
export type { AnyNode } from "./walk.ts";

export type NodeOf<K extends keyof NodeTypes> = NodeTypes[K];
// The node types a walk can start from: nodes, or arrays of them.
export type RootKind = Exclude<keyof NodeTypes, "stmts">;

// A visitor handing each node it is given to `each`.
class Each implements Visitor {
  each: (n: AnyNode) => void;
  constructor(each: (n: AnyNode) => void) {
    this.each = each;
  }
  node(n: AnyNode) {
    this.each(n);
  }
}

// A visitor calling `each` on every node it is given and walking on into its children, unless
// `each` gives false. Lists of statements are walked through, not given.
class Walking implements Visitor {
  each: (n: AnyNode) => boolean | void;
  constructor(each: (n: AnyNode) => boolean | void) {
    this.each = each;
  }
  node(this: Mut<this>, n: AnyNode) {
    if (n.of === "stmts" || this.each(n) !== false) visitChildren(n, this);
  }
}

// Calls `visit` on each node `n` holds, in the order its type lists the fields, with a list of
// statements given whole.
export function forEachChild(n: AnyNode, visit: (child: AnyNode) => void) {
  visitChildren(n, new Each(visit));
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
  const walking = new Walking(each);
  const list: NodeOf<K>[] = roots === undefined ? [] : Array.isArray(roots) ? roots : [roots];
  for (const node of list) walking.node({ of, node } as AnyNode);
}

// Whether `found` picks out a node under `roots`, nodes of type `of`, themselves included.
export function someNode<K extends RootKind>(of: K, roots: NodeOf<K> | NodeOf<K>[] | undefined, found: (n: AnyNode) => boolean): boolean {
  let hit = false;
  walk(of, roots, (n) => !hit && !(hit = found(n)));
  return hit;
}

// The id a node has, if it has one: a list of statements and a JS name have none.
function idIn(n: AnyNode): usize | undefined {
  if (n.of === "stmts" || n.of === "jsName") return undefined;
  const id: unknown = n.node.id;
  return typeof id === "number" ? id : undefined;
}

// What tells a node apart from another under the same id: its kind and its span.
function markOf(n: AnyNode): string {
  const node = n.node as { kind?: string; start?: usize; end?: usize };
  return `${n.of} ${node.kind ?? ""} ${node.start ?? ""} ${node.end ?? ""}`;
}

// Whether `n`, a node with id `id`, was reached already. A different node under an id already
// reached, as a copy that kept its original's id, is an internal error rather than one node.
function reachedBefore(seen: Map<usize, string>, id: usize, n: AnyNode): boolean {
  const was = seen.get(id);
  if (was === undefined) return false;
  if (was !== markOf(n)) throw new Error(`internal error: two nodes share id ${id}`);
  return true;
}

// Gives every node in `tree` a fresh id: a copy made by `structuredClone` or deserializing shares
// its original's ids, or another process's. A node reached twice, as a shared object, keeps the
// first one it got: nodes are told apart by their ids, which are all found before any changes, as
// a fresh id could equal an old one. `next` gives the ids.
export function renumber<T extends object>(of: RootKind, tree: T, next: () => usize): T {
  const seen = new Map<usize, string>();
  const found: Id[] = [];
  walk(of, tree as never, (n) => {
    const id = idIn(n);
    if (id === undefined) return;
    if (reachedBefore(seen, id, n)) return false;
    seen.set(id, markOf(n));
    found.push(n.node as Id);
  });
  for (const node of found) node.id = next();
  return tree;
}

// Moves every span in a parsed tree, nodes of type `of`, by `by`, for a source placed past others
// in one program. A node reached twice, as a shared object, moves once: it is known by its id and
// its span once moved.
export function shiftSpans<K extends RootKind>(of: K, tree: NodeOf<K> | NodeOf<K>[], by: usize) {
  const seen = new Map<usize, string>();
  walk(of, tree, (n) => {
    const id = idIn(n);
    if (id === undefined) return;
    if (reachedBefore(seen, id, n)) return false;
    const node = n.node as Partial<Span>;
    if (typeof node.start === "number") node.start += by;
    if (typeof node.end === "number") node.end += by;
    seen.set(id, markOf(n));
  });
}

// A node's id, which every table keys it by: a node and the replacement lowering made for it share
// one, so a table reads one entry for either.
function idOf(node: Id): usize {
  const id = node.id;
  if (typeof id !== "number") throw new Error(`internal error: a ${(node as { kind?: string }).kind ?? "node"} node has no id`);
  return id;
}

// A `Map` from nodes, keyed by their ids, holding each node as a `Map` holds its keys. Iterating
// gives each node as it was first stored, not a replacement lowering made for it since.
export class NodeMap<K extends Id, V> {
  private table = new Map<usize, { node: K; value: V }>();

  constructor(entries?: Iterable<readonly [K, V]>) {
    if (entries !== undefined) for (const [node, value] of entries) this.set(node, value);
  }

  get size(): usize {
    return this.table.size;
  }

  get(node: K): V | undefined {
    return this.table.get(idOf(node))?.value;
  }

  has(node: K): boolean {
    return this.table.has(idOf(node));
  }

  set(this: Mut<this>, node: K, value: V): Mut<this> {
    this.table.set(idOf(node), { node, value });
    return this;
  }

  delete(node: K): boolean {
    return this.table.delete(idOf(node));
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

// A `Set` of nodes, keyed by their ids, holding each node as a `Set` holds its members. Iterating
// gives each node as it was first added, not a replacement lowering made for it since.
export class NodeSet<K extends Id> {
  private table = new Map<usize, K>();

  constructor(nodes?: Iterable<K>) {
    if (nodes !== undefined) for (const n of nodes) this.add(n);
  }

  get size(): usize {
    return this.table.size;
  }

  has(node: K): boolean {
    return this.table.has(idOf(node));
  }

  add(this: Mut<this>, node: K): Mut<this> {
    this.table.set(idOf(node), node);
    return this;
  }

  delete(node: K): boolean {
    return this.table.delete(idOf(node));
  }

  clear(): void {
    this.table.clear();
  }

  *values(): IterableIterator<K> {
    for (const node of this.table.values()) yield node;
  }

  [Symbol.iterator](): IterableIterator<K> {
    return this.values();
  }

  forEach(each: (node: K) => void): void {
    for (const node of this.table.values()) each(node);
  }
}

// The kinds of node lowering replaces.
type Replacement = Expr | Stmt | Declarator | Param | Pattern | TypeNode | ObjectProp | ClassMember | TypeMember | PatternProp;

// The nodes lowering replaced, each under the id of the node it replaced, which the replacement
// takes, so every table keyed by node reads the same entry for either. A tree reads a replacement
// through `current` until a rebuild puts it in place: after a body's check, or at the end of a
// pass that lowers the tree before checking.
export class Rewrites {
  private table = new Map<usize, Id>();

  // Records `by`, a node made for the purpose, as `node`'s replacement, and gives it.
  replace<T extends Replacement>(node: Ref<Id>, by: T): T {
    by.id = node.id;
    this.table.set(node.id, by);
    return by;
  }

  current<T extends Id>(node: T): T {
    return (this.table.get(node.id) as T | undefined) ?? node;
  }
}
