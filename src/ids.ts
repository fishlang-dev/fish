// Node ids: what the parser gives every node, apart from the tables in `./nodes.ts` that key on them.

// Every node's own number, unique in its compilation, which the compiler's per-node tables key on.
export type Id = { id: usize };

// The counter ids come from, the last one given. Each compilation holds its own, which serves
// every tree it parses or makes, at any time, so none share an id; a tree parsed on its own, as
// the formatter's, has a counter of its own.
export type Ids = { last: usize };

// A fresh id from `ids`.
export function nextId(ids: Mut<Ids>): usize {
  return ++ids.last;
}

// The nodes lowering replaced while checking, each under the id of the node it replaced, which the
// replacement takes, so every table keyed by node reads the same entry for either. A tree reads a
// replacement through `current` until the rebuild after its body's check puts it in place.
export class Rewrites {
  private table = new Map<usize, Id>();

  // Records `by`, a node made for the purpose, as `node`'s replacement, and gives it.
  replace<T extends Id>(node: Ref<Id>, by: T): T {
    by.id = node.id;
    this.table.set(node.id, by);
    return by;
  }

  current<T extends Id>(node: T): T {
    return (this.table.get(node.id) as T | undefined) ?? node;
  }
}
