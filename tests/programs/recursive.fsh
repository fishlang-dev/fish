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
// case: recursive_comptime
// expect: 6 10 18
// expect: 6
// expect: 10
// expect: 18
type Node = { value: i64; next: Node | null };
type Tree = { v: i64; kids: Tree[] };
enum Expr { Num(i64), Add(Expr, Expr) }
function sum(n: Node): i64 {
  const next = n.next;
  if (next === null) return n.value;
  return n.value + sum(next);
}
function weight(t: Ref<Tree>): i64 {
  let w = t.v;
  for (const k of t.kids) w += weight(k);
  return w;
}
function ev(e: Ref<Expr>): i64 {
  return match (e) {
    case Expr.Num(n) => n,
    case Expr.Add(a, b) => ev(a) + ev(b),
  };
}
const TOTAL = comptime sum({ value: 1, next: { value: 2, next: { value: 3, next: null } } });
const WEIGHT = comptime weight({ v: 1, kids: [{ v: 2, kids: [] }, { v: 3, kids: [{ v: 4, kids: [] }] }] });
const VALUE = comptime ev(Expr.Add(Expr.Num(5), Expr.Add(Expr.Num(6), Expr.Num(7))));
function main() {
  console.log(TOTAL, WEIGHT, VALUE);
  console.log(sum({ value: 1, next: { value: 2, next: { value: 3, next: null } } }));
  console.log(weight({ v: 1, kids: [{ v: 2, kids: [] }, { v: 3, kids: [{ v: 4, kids: [] }] }] }));
  console.log(ev(Expr.Add(Expr.Num(5), Expr.Add(Expr.Num(6), Expr.Num(7)))));
}
// case: recursive_repairs
// expect: 9 1 5
// expect: 2 2 9
// expect: a 2
// expect: 1
type Tree = { v: i64; kids: Tree[] };
type Json = { kind: "num"; n: i64 } | { kind: "arr"; items: Json[] };
type List<T> = { head: T; tail: List<T> | null };
enum Seq<T> { Nil, Cons(T, Seq<T>) }
enum E { Leaf(i64), Wrap(Node) }
class Node {
  e: E;
  constructor(e: E) { this.e = e; }
  depth(): i64 {
    return match (this.e) {
      case E.Leaf(v) => v,
      case E.Wrap(m) => 1 + m.depth(),
    };
  }
}
function sum(ts: Ref<Tree[]>): i64 {
  let s = 0;
  for (const t of ts) s += t.v + sum(t.kids);
  return s;
}
function first(t: Ref<Tree>): Ref<Tree> {
  return t.kids[0];
}
function len<T>(l: Ref<List<T>>): i64 {
  return match (l) {
    case { tail: null } => 1,
    case { tail } => 1 + len<T>(tail!),
  };
}
function size<T>(l: Seq<T>): i64 {
  return match (l) {
    case Seq.Nil => 0,
    case Seq.Cons(_, rest) => 1 + size<T>(rest.clone()),
  };
}
function count(j: Ref<Json>): i64 {
  return match (j) {
    case { kind: "num" } => 1,
    case { kind: "arr", items } => items.map((x) => count(x)).reduce((a, b) => a + b, 0),
  };
}
function main() {
  let t: Tree = { v: 1, kids: [{ v: 2, kids: [] }] };
  t.kids[0] = { v: 9, kids: [] };
  const kids: Tree[] = [{ v: 2, kids: [{ v: 3, kids: [] }] }];
  const u: Tree = { v: 1, kids };
  console.log(t.kids[0].v, u.kids.length, sum(u.kids));
  const l: List<string> = { head: "a", tail: { head: "b", tail: null } };
  const s: Seq<string> = Seq.Cons("a", Seq.Cons("b", Seq.Nil));
  console.log(len<string>(l), size<string>(s), new Node(E.Wrap(new Node(E.Wrap(new Node(E.Leaf(7)))))).depth());
  console.log(first(u).kids[0].v === 3 ? "a" : "b", count({ kind: "arr", items: [{ kind: "num", n: 1 }, { kind: "arr", items: [{ kind: "num", n: 2 }] }] }));
  const j: Json = { kind: "arr", items: [{ kind: "num", n: 1 }, { kind: "arr", items: [] }] };
  console.log(count(j));
}
// case: recursive_array_methods
// expect: 10 20 1 20 1
type Tree = { v: i64; kids: Tree[] };
function double(t: Ref<Tree>): Tree {
  return { v: t.v * 2, kids: t.kids.map((k) => double(k)) };
}
function sum(t: Ref<Tree>): i64 {
  return t.v + t.kids.map((k) => sum(k)).reduce((a, b) => a + b, 0);
}
function main() {
  const t: Tree = { v: 1, kids: [{ v: 2, kids: [{ v: 3, kids: [] }] }, { v: 4, kids: [] }] };
  const d = double(t);
  let m = new Map<string, Tree>();
  m.set("a", d.clone());
  const vs = [...m.values()];
  const direct = m.values();
  console.log(sum(t), sum(d), vs.length, sum(vs[0]), direct.length);
}
// case: recursive_through_arrays
// expect: 2 3
// expect: 1
// expect: 5 6
// expect: 1 -1
// expect: 1 true 2 false
// expect: changed
// expect: 2 0 3 1
type Tree = { v: i64; kids: Tree[] };
type Named = { v: string; kids: Named[] };
type Json = { kind: "num"; n: i64 } | { kind: "arr"; items: Json[] };
type Node = { v: i64; next: Node | null };
enum Expr { Num(i64), Neg(Expr) }
class Holder {
  items: Link[];
  constructor() { this.items = []; }
}
class Link {
  v: i64;
  next: Link | null;
  constructor(v: i64, next: Link | null) { this.v = v; this.next = next; }
}
function two<T>(a: T, b: T): T[] {
  let out: T[] = [];
  out.push(a);
  out.push(b);
  return out;
}
function pick(t: Mut<Named>): Mut<Named> {
  return t.kids[0];
}
function main() {
  const ys = two<Tree>({ v: 1, kids: [] }, { v: 2, kids: [{ v: 3, kids: [] }] });
  console.log(ys[1].v, ys[1].kids[0].v);
  let h = new Holder();
  h.items.push(new Link(1, null));
  console.log(h.items[0].v);
  const items: Json[] = [{ kind: "num", n: 5 }, { kind: "num", n: 6 }];
  const ns = items.map((x) => (x.kind === "num" ? x.n : 0));
  console.log(ns[0], ns[1]);
  const es: Expr[] = [Expr.Num(1), Expr.Neg(Expr.Num(2))];
  const vs = es.map((x) => match (x) {
    case Expr.Num(n) => n,
    case Expr.Neg(_) => -1,
  });
  console.log(vs[0], vs[1]);
  const nodes: Node[] = [{ v: 1, next: null }, { v: 2, next: { v: 3, next: null } }];
  let shown = "";
  for (const n of nodes) {
    const { v } = n;
    shown = shown + (shown === "" ? "" : " ") + `${v} ${n.next === null}`;
  }
  console.log(shown);
  let named: Named = { v: "r", kids: [{ v: "a", kids: [] }] };
  const p = pick(named);
  p.v = "changed";
  console.log(named.kids[0].v);
  const t: Tree = { v: 1, kids: [{ v: 2, kids: [] }, { v: 3, kids: [{ v: 4, kids: [] }] }] };
  let line = "";
  for (const k of t.kids.values()) line = line + (line === "" ? "" : " ") + `${k.v} ${k.kids.length}`;
  console.log(line);
}
// case: recursive_type_functions
// expect: 2 2
// expect: yes 0 1
// expect: 1
type T = T[];
type Tree = { v: i64; kids: Tree[] };
type Json = { kind: "num"; n: i64 } | { kind: "arr"; items: Json[] };
type IsTree<X> = X extends { v: i64 } ? "yes" : "no";
type Arr = Exclude<Json, { kind: "num"; n: i64 }>;
function mk(): Tree {
  return { v: 1, kids: [] };
}
function depth(t: Ref<T>): i64 {
  let d = 0;
  for (const c of t) {
    const x = depth(c) + 1;
    if (x > d) d = x;
  }
  return d;
}
async function main() {
  const x: T = [[], [[]]];
  console.log(depth(x), x.length);
  const y: IsTree<Tree> = "yes";
  const a: Arr = { kind: "arr", items: [] };
  const r: ReturnType<typeof mk> = mk();
  console.log(y, a.items.length, r.v);
  const t: Tree = { v: 1, kids: [{ v: 2, kids: [] }] };
  const h = spawn(async () => t.kids.length);
  const n = await h;
  console.log(n);
}
// case: recursive_comptime_constant
// error: 'Tree' can't be computed while compiling
type Tree = { v: i64; kids: Tree[] };
function mk(n: i64): Tree {
  let t: Tree = { v: n, kids: [] };
  if (n > 0) t.kids.push(mk(n - 1));
  return t;
}
const T = comptime mk(3);
function main() {
  console.log(T.v);
}
