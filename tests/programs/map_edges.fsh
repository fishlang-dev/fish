// expect: 0 0
// expect: x x
// expect: y y
// expect: 1
// A typed Map made from an empty array, a Set's forEach given each member twice, and a key
// made before a panicking value is dropped.
function main() {
  const m = new Map<string, i64>([]);
  const s = new Set<i64>([]);
  console.log(m.size, s.size);
  const t = new Set(["x", "y"]);
  t.forEach((a, b) => console.log(a, b));
  let n = new Map<string, i64>();
  n.set("k" + 1, 1);
  console.log(n.size);
}
