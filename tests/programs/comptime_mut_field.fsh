// expect: 11
// expect: 11
// A Mut kept in a field writes through to what it points at, at comptime too.
class D {
  m: Mut<i64>;
  constructor(m: Mut<i64>) { this.m = m; }
  add(this: Mut<this>) { this.m += 10; }
}
function all(): string {
  let x = 1;
  let d = new D(x);
  d.add();
  return `${x}`;
}
function main() { console.log(all()); console.log(comptime all()); }
