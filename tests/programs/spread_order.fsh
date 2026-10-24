// expect: 1,2,3,3
// expect: 3 1 2
// expect: 1,2,0
// A spread is cloned when the literal reaches it, before a later part moves or changes it.
function eat(a: i64[]): i64 { return a.length as i64; }
function setFirst(xs: Mut<i64[]>): i64 { xs[0] = 99; return 0; }
class B { items: i64[]; constructor() { this.items = [1, 2]; } grow(this: Mut<this>): i64 { for (let i = 0; i < 100; i++) this.items.push(i); this.items = [7]; return 0; } }
function main() {
  let xs = [1, 2, 3];
  console.log([...xs, eat(xs)].join());
  let b = new B();
  const ys = [...b.items, b.grow()];
  console.log(ys.length, ys[0], ys[1]);
  let zs = [1, 2];
  console.log([...zs, setFirst(zs)].join());
}
