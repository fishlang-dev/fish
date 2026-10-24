// case: recursive_list
// expect: 1
// expect: 6
// expect: 6 10
type Node = { value: i64; next: Node | null };
function sum(n: Node): i64 {
  const next = n.next;
  if (next === null) return n.value;
  return n.value + sum(next);
}
function main() {
  const tail: Node = { value: 3, next: null };
  const mid: Node = { value: 2, next: tail };
  const n: Node = { value: 1, next: mid };
  console.log(n.value);
  const copy = n.clone();
  console.log(sum(copy));
  let short: Node = { value: 1, next: { value: 2, next: { value: 3, next: null } } };
  const before = sum(short.clone());
  short.next = { value: 9, next: null };
  console.log(before, sum(short));
}
// case: recursive_union
// expect: -3
// expect: 15
type Expr = { kind: "num"; n: i64 } | { kind: "add"; left: Expr; right: Expr } | { kind: "neg"; of: Expr };
function ev(e: Expr): i64 {
  if (e.kind === "num") return e.n;
  if (e.kind === "add") return ev(e.left) + ev(e.right);
  return -ev(e.of);
}
function main() {
  const one: Expr = { kind: "num", n: 1 };
  const two: Expr = { kind: "num", n: 2 };
  const sum: Expr = { kind: "add", left: one, right: two };
  console.log(ev({ kind: "neg", of: sum }));
  const e: Expr = { kind: "add", left: { kind: "num", n: 4 }, right: { kind: "add", left: { kind: "num", n: 5 }, right: { kind: "num", n: 6 } } };
  console.log(ev(e));
}
// case: recursive_arrays
// expect: 5 a b c d e
// expect: b 1 3
// expect: b B 2
type Tree = { name: string; children: Tree[] };
function count(t: Ref<Tree>): i64 {
  let n = 1;
  for (const c of t.children) n += count(c);
  return n;
}
function names(t: Ref<Tree>): string {
  let out = t.name;
  for (const c of t.children) out = out + " " + names(c);
  return out;
}
function main() {
  const leaf: Tree = { name: "c", children: [] };
  let t: Tree = { name: "a", children: [{ name: "b", children: [leaf] }, { name: "d", children: [] }] };
  t.children.push({ name: "e", children: [] });
  console.log(count(t), names(t));
  console.log(t.children[0].name, t.children[0].children.length, t.children.length);
  const copy = t.children[0].clone();
  t.children[0].name = "B";
  console.log(copy.name, t.children[0].name, count(copy));
}
// case: recursive_generic
// expect: 3 x
// expect: 2
type List<T> = { head: T; tail: List<T> | null };
type Pair<T> = { a: T; b: T };
function length<T>(l: List<T>): i64 {
  const tail = l.tail;
  if (tail === null) return 1;
  return 1 + length(tail);
}
function second<T>(p: Pair<T>): T {
  return p.b;
}
function main() {
  const l: List<string> = { head: "x", tail: { head: "y", tail: { head: "z", tail: null } } };
  const head = l.head;
  console.log(length(l), head);
  console.log(second({ a: 1, b: 2 }));
}
// case: recursive_mutual
// expect: 1 2 3
type A = { n: i64; b: B | null };
type B = { m: i64; a: A | null };
function main() {
  const a: A = { n: 1, b: { m: 2, a: { n: 3, b: null } } };
  const b = a.b;
  if (b !== null) {
    const inner = b.a;
    if (inner !== null) console.log(a.n, b.m, inner.n);
  }
}
