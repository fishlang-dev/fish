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
// case: recursive_class
// expect: 6
// expect: 11
// expect: 2 3
// expect: y 2
class Node {
  value: i64;
  next: Node | null;
  constructor(value: i64, next: Node | null) {
    this.value = value;
    this.next = next;
  }
  sum(): i64 {
    const next = this.next.clone();
    if (next === null) return this.value;
    return this.value + next.sum();
  }
  replaceNext(this: Mut<this>, v: i64) {
    this.next = new Node(v, null);
  }
}
class A { n: i64; b: B | null; constructor(n: i64, b: B | null) { this.n = n; this.b = b; } }
class B { m: i64; a: A | null; constructor(m: i64, a: A | null) { this.m = m; this.a = a; } }
class Chain<T> {
  head: T;
  tail: Chain<T> | null;
  constructor(head: T, tail: Chain<T> | null) {
    this.head = head;
    this.tail = tail;
  }
  size(): i64 {
    const tail = this.tail.clone();
    return tail === null ? 1 : 1 + tail.size();
  }
}
function main() {
  let list = new Node(1, new Node(2, new Node(3, null)));
  console.log(list.sum());
  list.replaceNext(10);
  console.log(list.sum());
  const a = new A(1, new B(2, new A(3, null)));
  const b = a.b;
  if (b !== null) {
    const inner = b.a;
    if (inner !== null) console.log(b.m, inner.n);
  }
  const cells = new Chain<string>("x", new Chain<string>("y", null));
  const size = cells.size();
  const tail = cells.tail;
  if (tail !== null) console.log(tail.head, size);
}
// case: recursive_enum
// expect: -4
// expect: 10 3
// expect: 7
enum Expr { Num(i64), Add(Expr, Expr), Neg(Expr) }
function ev(e: Ref<Expr>): i64 {
  return match (e) {
    case Expr.Num(n) => n,
    case Expr.Add(a, b) => ev(a) + ev(b),
    case Expr.Neg(x) => -ev(x),
  };
}
function make(n: i64): Expr {
  return n === 0 ? Expr.Num(0) : Expr.Add(Expr.Num(n), make(n - 1));
}
function total(e: Expr): i64 {
  return match (e) {
    case Expr.Num(n) => n,
    case Expr.Add(a, b) => total(a.clone()) + total(b.clone()),
    case Expr.Neg(x) => -total(x.clone()),
  };
}
function left(n: i64): i64 {
  return match (make(n)) {
    case Expr.Num(v) => v,
    case Expr.Add(a, _) => total(a),
    case Expr.Neg(x) => total(x),
  };
}
function main() {
  console.log(ev(Expr.Add(Expr.Num(1), Expr.Neg(Expr.Add(Expr.Num(2), Expr.Num(3))))));
  console.log(total(make(4)), left(3));
  let e = make(2);
  e = Expr.Num(7);
  console.log(total(e));
}
