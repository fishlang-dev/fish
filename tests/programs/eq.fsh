// case: eq_structural
// expect: true false true
// expect: true
// expect: true false
// expect: true false
// expect: true
// expect: true false
// expect: true true
// expect: true true
type P = { x: i64; name: string };
type Tree = { v: i64; kids: Tree[] };
type Node = { v: i64; next: Node | null };
type Shape = { kind: "c"; r: i64 } | { kind: "s"; w: i64; h: i64 };
function eqs(): string {
  const a: P = { x: 1, name: "a" };
  const b: P = { x: 1, name: "a" };
  const c: P = { x: 2, name: "a" };
  return `${a === b} ${a !== c}`;
}
const C = comptime eqs();
function main() {
  const a: P = { x: 1, name: "a" };
  const b: P = { x: 1, name: "a" };
  const c: P = { x: 1, name: "b" };
  console.log(a === b, a === c, a !== c);
  const t1: [i64, string] = [1, "x"];
  const t2: [i64, string] = [1, "x"];
  console.log(t1 === t2);
  const xs = [1, 2, 3];
  const ys = [1, 2, 3];
  const zs = [1, 2];
  console.log(xs === ys, xs === zs);
  const tr1: Tree = { v: 1, kids: [{ v: 2, kids: [] }] };
  const tr2: Tree = { v: 1, kids: [{ v: 2, kids: [] }] };
  const tr3: Tree = { v: 1, kids: [{ v: 3, kids: [] }] };
  console.log(tr1 === tr2, tr1 === tr3);
  const n1: Node = { v: 1, next: { v: 2, next: null } };
  const n2: Node = { v: 1, next: { v: 2, next: null } };
  console.log(n1 === n2);
  const s1: Shape = { kind: "s", w: 1, h: 2 };
  const s2: Shape = { kind: "s", w: 1, h: 2 };
  const s3: Shape = { kind: "c", r: 1 };
  console.log(s1 === s2, s1 === s3);
  const o1: P | null = { x: 1, name: "a" };
  console.log(o1 === a, o1 !== null);
  console.log(C);
}
// case: eq_map
// error: values of type 'Map<string, i64>' can't be compared with '===': a Map isn't compared by value; compare its entries
type Holder = { m: Map<string, i64> };
function main() {
  const a: Holder = { m: new Map() };
  const b: Holder = { m: new Map() };
  console.log(a === b);
}
// case: eq_class_without_equals
// error: a class compares through 'equals(other: Ref<this>): boolean', which 'Point' doesn't have; add one, or '@derive(Eq)'
class Point { x: i64 = 1; }
function main() {
  console.log(new Point() === new Point());
}
// case: eq_no_overlap
// error: have no overlap
type A = { a: i64 };
type B = { b: i64 };
function main() {
  const a: A = { a: 1 };
  const b: B = { b: 1 };
  console.log(a === b);
}
