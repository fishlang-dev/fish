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
// case: print_spelling_everywhere
// expect: { b: null }
// expect: { b: null } C { y: 1 }
// expect: {"b":null} {"b":null} [{"b":null}] {"b":null}
type P = { a: i64 | undefined; b: i64 | null; c?: string };
@derive(Json)
class C {
  x: string | undefined = undefined;
  y: i64 = 1;
  constructor() {}
}
function show<T>(v: Ref<T>): string { return JSON.stringify(v); }
function shown<T>(v: Ref<T>) { console.log(v); }
function main() {
  const p: P = { a: undefined, b: null };
  shown(p);
  console.log(p, new C());
  console.log(JSON.stringify(p), show(p), show([p.clone()]), Response.json(p).body);
}
// case: print_deep_and_signs
// expect: { a: { b: { c: [Object], e: [], f: [Array], g: {}, h: [P] } } }
// expect: -0 [ -0 ] 0 { n: -0 }
// expect: { b: null }
class P { constructor(public x: i64) {} }
type O = { a?: i64 | null; b: i64 | null };
function main() {
  console.log({ a: { b: { c: { d: 1 }, e: [], f: [1], g: {}, h: new P(1) } } });
  const z = -0.0;
  console.log(z, [z], 0.0, { n: z });
  const o: O = { b: null };
  console.log(o);
}
// case: print_union_spelling
// expect: { k: 'x' } Box { v: {} } Box { v: 's' }
type U = { a?: i64; k: "x" } | { a: i64 | string; k: "y" };
type A = { a?: i64 };
class Box<T> { constructor(public v: T) {} }
function main() {
  const x: U = { k: "x" };
  const w: Box<A> | Box<string> = new Box<A>({});
  const u: Box<A> | Box<string> = new Box<string>("s");
  console.log(x, w, u);
}
// case: required_keeps_undefined
// expect: true
type P = { a: i64 | undefined };
function main() {
  const p: Required<P> = { a: undefined };
  console.log(p.a === null);
}
