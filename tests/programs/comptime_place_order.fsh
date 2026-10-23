// expect: 15 21 30 40 2
// expect: 15 21 30 40 2
// A place is found once, before the value: comptime runs assignments in the program's order.
class Ctr {
  n: usize;
  constructor() { this.n = 0; }
  next(this: Mut<this>): usize { this.n += 1; return this.n - 1; }
}
function f(): string {
  let c = new Ctr();
  let a: usize[] = [10, 20, 30, 40];
  a[c.next()] += 5;
  a[c.next()]++;

  return `${a[0]} ${a[1]} ${a[2]} ${a[3]} ${c.n}`;
}
function main() {
  console.log(f());
  console.log(comptime f());
}
