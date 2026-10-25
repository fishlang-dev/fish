// case: print_values
// expect: { a: 1, list: [ 1, 2, 3 ], name: 'x' } Point { x: 1, y: 2 }
// expect: Map(1) { 'k' => [ 'v' ] } Set(2) { 1, 2 }
// expect: Some text { s: "it's" }
class Point { constructor(public x: i64, public y: i64) {} }
function main() {
  console.log({ a: 1, list: [1, 2, 3], name: "x" }, new Point(1, 2));
  let m = new Map<string, string[]>();
  m.set("k", ["v"]);
  let s = new Set<i64>();
  s.add(1);
  s.add(2);
  console.log(m, s);
  console.log("Some", "text", { s: "it's" });
}
// case: print_nested_depth
// expect: { a: { b: { c: [Object] } } }
function main() {
  console.log({ a: { b: { c: { d: 1 } } } });
}
// case: print_optional_spelling
// expect: { b: null } { a: 1, b: 2 }
type P = { a?: i64; b: i64 | null };
function main() {
  const p: P = { b: null };
  const q: P = { a: 1, b: 2 };
  console.log(p, q);
}
// case: print_function
// error: printing a function isn't supported yet
function main() {
  const f = (x: i64) => x;
  console.log(f);
}
