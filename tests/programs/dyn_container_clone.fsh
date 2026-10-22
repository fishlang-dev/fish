// error: can't clone a value holding a Dyn
interface Counter { bump(): i64; }
class Hits {
  n: Atomic<i64> = new Atomic(0);
  bump(): i64 { return this.n.add(1); }
}
class Tag {
  name: string;
  constructor(name: string) { this.name = name; }
  bump(): i64 { return 0; }
  clone(): Tag { console.log("own clone"); return new Tag(this.name + "'"); }
}
function main() {
  let xs: Dyn<Counter>[] = [new Hits(), new Tag("t" + "")];
  const ys = xs.clone();
  xs[0].bump(); xs[0].bump();
  console.log(xs[0].bump(), ys[0].bump());
}
