// expect: 3 10 2 null true false
// expect: true false 2
// expect: a,c,b2 10,3,20
// expect: false 103
// expect: a 10
// expect: c 103
// expect: b2 20
// expect: 2 true x,y 2
// Map and Set methods as JavaScript's behave, chaining through set and add, insertion order kept
// after deletes and re-sets.
function main() {
  let m = new Map<string, i64>();
  m.set("a", 1).set("b" + 2, 2);
  m.set("c", 3);
  m.set("a", 10);
  console.log(m.size, m.get("a"), m.get("b2"), m.get("zz"), m.has("c"), m.has("d"));
  console.log(m.delete("b2"), m.delete("b2"), m.size);
  m.set("b2", 20);
  console.log(m.keys().join(), m.values().join());
  m.update("c", (v) => { v = v + 100; });
  console.log(m.update("nope", (v) => { v = 0; }), m.get("c"));
  m.forEach((v, k) => console.log(k, v));
  let s = new Set<string>();
  s.add("x").add("y").add("x");
  console.log(s.size, s.has("x"), s.values().join(), s.entries().length);
}
