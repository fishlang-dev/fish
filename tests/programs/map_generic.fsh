// expect: 2 2 q
// expect: 2
// Map and Set types inferred in generic calls, and set chained through a Mut borrow.
function count<K>(m: Ref<Map<K, i64>>): usize { return m.size; }
function members<T>(s: Ref<Set<T>>): T[] { return s.values(); }
function fill(m: Mut<Map<string, i64>>) { m.set("a", 1).set("b", 2); }
function main() {
  let m = new Map<u8, i64>();
  m.set(1, 1);
  m.set(255, 2);
  let s = new Set<string>();
  s.add("q");
  console.log(count(m), m.get(255), members(s).join());
  let n = new Map<string, i64>();
  fill(n);
  console.log(n.size);
}
