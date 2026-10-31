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
