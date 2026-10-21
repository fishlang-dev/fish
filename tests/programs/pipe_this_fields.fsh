type Box = { name: string; size: i64 };
function make(n: i64): Box { return { name: "box" + n, size: n }; }
class C {
  box: Box;
  n: i64;
  constructor() { this.box = make(3); this.n = 0; }
  set(this: Mut<this>): i64 { this.box |> (this.n = %.size); return this.n; }
}
function main() { let c = new C(); console.log(c.set(), c.box.name); }
// expect: 3 box3
