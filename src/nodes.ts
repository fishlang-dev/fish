
// Node ids, and the tables keyed by them. Fish's `Map` and `Set` key on strings and integers,
// not objects, so the compiler's per-node tables key on each node's `id`.

// Every node's own number, unique in the process, which the compiler's per-node tables key on.
export type Id = { id: number };

// The counter ids come from, the last one given. Whoever starts a compilation holds it, and one
// counter serves every tree parsed or made, at any time, so none share an id.
export type Ids = { last: number };

// A fresh id from `ids`.
export function nextId(ids: Ids): number {
  return ++ids.last;
}

// Gives every node in `tree` a fresh id: a copy made by `structuredClone` or deserializing shares
// its original's ids, or another process's. A node reached twice, as a shared object, keeps the
// first one it got. `next` gives the ids.
export function renumber<T>(tree: T, next: () => number): T {
  const seen = new Set<unknown>();
  const walk = (v: unknown): void => {
    if (typeof v !== "object" || v === null || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) return v.forEach(walk);
    const node = v as Record<string, unknown>;
    if (typeof node.id === "number") node.id = next();
    Object.values(node).forEach(walk);
  };
  walk(tree);
  return tree;
}

// The node behind each id is kept, so a different object arriving with an id already in use, a
// copy that kept its original's id, fails loudly instead of reading or replacing its entry.
function idOf(node: Id, known: Id | undefined): number {
  const id = node.id;
  if (typeof id !== "number") throw new Error(`internal error: a ${(node as { kind?: string }).kind ?? "node"} node has no id`);
  if (known !== undefined && known !== node) throw new Error(`internal error: two nodes share id ${id}`);
  return id;
}

// A `Map` from nodes, keyed by their ids, holding each node as a `Map` holds its keys.
export class NodeMap<K extends Id, V> {
  private table = new Map<number, { node: K; value: V }>();

  constructor(entries?: Iterable<readonly [K, V]>) {
    if (entries) for (const [node, value] of entries) this.set(node, value);
  }

  get size(): number {
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
  private table = new Map<number, K>();

  constructor(nodes?: Iterable<K>) {
    if (nodes) for (const n of nodes) this.add(n);
  }

  get size(): number {
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
  private table = new Map<number, { node: WeakRef<K>; value: V }>();
  private gone = new FinalizationRegistry<number>((id) => this.table.delete(id));

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
  private table = new Map<number, WeakRef<K>>();
  private gone = new FinalizationRegistry<number>((id) => this.table.delete(id));

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
